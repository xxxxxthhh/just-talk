"""HTTP-level guards and same-origin static serving for public mode."""

import json
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class PublicApiError(Exception):
    """Error with a machine-readable code the frontend can explain to users."""

    def __init__(self, status_code: int, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra

    def payload(self) -> dict[str, Any]:
        return {"detail": self.message, "code": self.code, **self.extra}


class _BodyTooLargeError(Exception):
    pass


class PublicGuardMiddleware:
    """Pure ASGI guard for /api requests in public mode.

    - Unsafe methods must carry an allowed ``Origin``; a missing or foreign
      Origin is rejected before the body is read (CSRF defense on top of the
      SameSite=Lax cookie).
    - Request bodies are capped while they stream in, including chunked
      uploads without Content-Length, so an oversized upload is cut off before
      multipart parsing can spool it to memory or disk.
    - API responses are marked ``no-store`` so identity-bound data is never
      cached by browsers or intermediaries.
    """

    def __init__(
        self,
        app: Any,
        *,
        allowed_origins: tuple[str, ...],
        upload_paths: tuple[str, ...],
        max_upload_bytes: int,
        max_body_bytes: int,
    ) -> None:
        self.app = app
        self.allowed_origins = set(allowed_origins)
        self.upload_paths = upload_paths
        self.max_upload_bytes = max_upload_bytes
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope["headers"]}
        if scope["method"] in _UNSAFE_METHODS:
            origin = headers.get("origin", "")
            if not origin or origin not in self.allowed_origins:
                await _send_json(send, 403, {"detail": "Cross-site request refused.", "code": "bad_origin"})
                return

        limit = self.max_upload_bytes if scope["path"] in self.upload_paths else self.max_body_bytes
        declared = headers.get("content-length")
        if declared is not None:
            try:
                too_large = int(declared) > limit
            except ValueError:
                too_large = True
            if too_large:
                await _send_json(send, 413, _too_large_payload(limit))
                return

        received = 0
        exceeded = False
        response_started = False

        async def limited_receive() -> dict:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _BodyTooLargeError
            return message

        async def guarded_send(message: dict) -> None:
            nonlocal response_started
            if exceeded:
                return  # replaced by the 413 below
            if message["type"] == "http.response.start":
                response_started = True
                message = dict(message)
                message["headers"] = [
                    *[
                        (key, value)
                        for key, value in message.get("headers", [])
                        if key.lower() != b"cache-control"
                    ],
                    (b"cache-control", b"no-store"),
                    (b"vary", b"Cookie"),
                ]
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _BodyTooLargeError:
            pass
        except Exception:
            if not exceeded:
                raise
        if exceeded and not response_started:
            await _send_json(send, 413, _too_large_payload(limit))


def _too_large_payload(limit: int) -> dict[str, Any]:
    return {"detail": f"Request is larger than {limit} bytes.", "code": "request_too_large"}


async def _send_json(send: Any, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"cache-control", b"no-store"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


def verify_turnstile(secret: str, token: str, remote_ip: str | None) -> bool:
    if not token or len(token) > 2048:
        return False
    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        response = httpx.post(TURNSTILE_VERIFY_URL, data=data, timeout=5.0)
        return bool(response.json().get("success"))
    except (httpx.HTTPError, ValueError):
        return False


def client_address(request: Request, header: str) -> str | None:
    if header:
        value = request.headers.get(header, "").split(",")[0].strip()
        if value:
            return value
    return request.client.host if request.client else None


def mount_static(app: FastAPI, static_dir: str, *, turnstile: bool) -> None:
    """Serve the built frontend from the same origin, with SPA fallback."""
    root = Path(static_dir).resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"STATIC_DIR {static_dir!r} has no index.html.")

    challenge = " https://challenges.cloudflare.com" if turnstile else ""
    frame_src = "https://challenges.cloudflare.com" if turnstile else "'none'"
    security_headers = {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
        "Content-Security-Policy": (
            "default-src 'self'; "
            f"script-src 'self'{challenge}; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "media-src 'self' data: blob:; "
            "connect-src 'self'; "
            f"frame-src {frame_src}; "
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        ),
    }

    @app.api_route("/{requested_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def serve_frontend(requested_path: str) -> FileResponse:
        if requested_path == "api" or requested_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found.")
        candidate = (root / requested_path).resolve()
        if requested_path and candidate.is_file() and candidate.is_relative_to(root):
            headers = dict(security_headers)
            if requested_path.startswith("assets/"):
                headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return FileResponse(candidate, headers=headers)
        return FileResponse(index, headers={**security_headers, "Cache-Control": "no-cache"})
