"""Stateless online verification against the configured Supabase Auth service."""

import base64
import json
from dataclasses import dataclass
from urllib.parse import urlparse
from uuid import UUID

import httpx

from .public import PublicApiError


@dataclass(frozen=True)
class VerifiedIdentity:
    account_id: str
    email: str | None = None
    registered_at: str | None = None


def public_key(key: str) -> bool:
    if key.startswith("sb_publishable_"):
        return True
    # Accept legacy anon keys, but refuse privileged keys even in server config:
    # the same key is deliberately returned to the browser in /api/health.
    try:
        payload = key.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return claims.get("role") == "anon"
    except (ValueError, IndexError, TypeError):
        return False


class SupabaseVerifier:
    def __init__(self, url: str, key: str) -> None:
        self.url = url
        self.key = key
        parsed = urlparse(url)
        self.configured = bool(
            parsed.scheme == "https"
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and public_key(key)
        )

    def verify(self, token: str) -> str:
        return self.verify_identity(token).account_id

    def verify_identity(self, token: str) -> VerifiedIdentity:
        if not self.configured:
            raise PublicApiError(503, "auth_unavailable", "Google sign-in is not configured yet.")
        try:
            # Equivalent to auth.get_user(jwt): verified online on every request,
            # with no shared mutable Supabase session and no locally trusted JWT.
            response = httpx.get(
                f"{self.url}/auth/v1/user",
                headers={"apikey": self.key, "Authorization": f"Bearer {token}"},
                timeout=5.0,
            )
            if response.status_code in {400, 401, 403, 422}:
                raise PublicApiError(401, "auth_required", "Your session expired. Sign in again.")
            response.raise_for_status()
            user = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise PublicApiError(
                503, "auth_unavailable", "Sign-in verification is unavailable. Try again."
            ) from exc
        # These are server-verified identity records, never user_metadata.
        if (
            user.get("is_anonymous") is not False
            or user.get("deleted_at")
            or not any(
                identity.get("provider") == "google" for identity in user.get("identities", [])
            )
        ):
            raise PublicApiError(401, "auth_required", "Sign in with a Google account to continue.")
        try:
            account_id = UUID(user["id"]).hex
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise PublicApiError(
                401, "auth_required", "Invalid account identity. Sign in again."
            ) from exc
        # Minimal display fields from the online Auth response. Metadata is
        # deliberately neither copied nor used for owner authorization.
        email = user.get("email")
        registered_at = user.get("created_at")
        return VerifiedIdentity(
            account_id,
            email[:320] if isinstance(email, str) else None,
            registered_at[:64] if isinstance(registered_at, str) else None,
        )
