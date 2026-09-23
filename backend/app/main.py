import asyncio
import base64
import contextlib
import hashlib
import shutil
import subprocess
import tempfile
import threading
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .audio import (
    AudioTooLongError,
    AudioTooShortError,
    decode_to_wav_16k_mono,
    ensure_audio_duration_allowed,
)
from .azure_client import AzurePronunciationScorer
from .config import Settings
from .drills import generate_drill
from .passage import check_passage
from .public import (
    PublicApiError,
    PublicGuardMiddleware,
    client_address,
    mount_static,
    verify_turnstile,
)
from .quota import (
    QuotaExceededError,
    QuotaLedger,
    billable_audio_seconds,
    billable_tts_characters,
)
from .scoring import normalize_azure_result, normalize_continuous_azure_results
from .storage import BUILTIN_MATERIAL_PACK, DRILL_PACK_ID, SessionStore
from .tts import AzureTextToSpeechSynthesizer
from .visitors import VISITOR_COOKIE, VisitorLimitError, VisitorRegistry


class WordCreateRequest(BaseModel):
    word: str
    notes: str = ""


class SpeakRequest(BaseModel):
    text: str
    cache_key: str | None = Field(default=None, max_length=200)


class MaterialPackMetaRequest(BaseModel):
    id: str
    title: str
    source: str = "user-imported"
    license: str = "user-provided"


class MaterialLessonRequest(BaseModel):
    id: str
    title: str
    text: str
    book: str | int | None = None
    lesson: str | int | None = None
    tags: list[str] = Field(default_factory=list)


class MaterialPackImportRequest(BaseModel):
    schema_version: int
    pack: MaterialPackMetaRequest
    lessons: list[MaterialLessonRequest]


class DrillGenerateRequest(BaseModel):
    phoneme: str


class VisitorCreateRequest(BaseModel):
    turnstile_token: str = Field(default="", max_length=2048)


@dataclass(frozen=True)
class Actor:
    """Who a request acts for: the single local user, or a public visitor."""

    visitor_id: str | None
    store: SessionStore
    # Held around capacity check + write in public mode; a no-op locally.
    write_lock: contextlib.AbstractContextManager[Any] = contextlib.nullcontext()


RESERVED_PACK_IDS = frozenset({BUILTIN_MATERIAL_PACK["pack"]["id"], DRILL_PACK_ID})
# Only these published built-in texts may share synthesized audio across
# visitors; anything a visitor typed is cached in their own database.
BUILTIN_TEXTS = frozenset(lesson["text"] for lesson in BUILTIN_MATERIAL_PACK["lessons"])
MAINTENANCE_INTERVAL_SECONDS = 600
MAX_MATERIAL_META_CHARS = 200

_VISITOR_LIMIT_MESSAGES = {
    "active_limit": "The public trial is full right now. Please try again later.",
    "issuance_rate": "Too many new visitors right now. Please try again in a while.",
    "client_rate": "Too many new sessions from this network. Please try again later.",
}
_QUOTA_MESSAGES = {
    "visitor_day": "You've used today's free {what}. It resets at 00:00 UTC.",
    "global_day": "Today's shared free {what} for all visitors is used up. It resets at 00:00 UTC.",
    "global_month": "This month's shared free {what} is used up. It resets on the 1st (UTC).",
}


def create_app(
    *,
    settings: Settings | None = None,
    store: SessionStore | None = None,
    scorer: Any | None = None,
    synthesizer: Any | None = None,
    clock: Callable[[], datetime] | None = None,
    turnstile_verifier: Callable[[str, str, str | None], bool] | None = None,
) -> FastAPI:
    active_settings = settings or Settings.from_env()
    public = active_settings.public
    active_scorer = scorer
    if active_scorer is None and active_settings.azure_configured:
        active_scorer = AzurePronunciationScorer(active_settings)
    active_synthesizer = synthesizer
    if active_synthesizer is None and active_settings.azure_configured:
        active_synthesizer = AzureTextToSpeechSynthesizer(active_settings)
    verify_turnstile_token = turnstile_verifier or verify_turnstile

    personal_store: SessionStore | None = None
    ledger: QuotaLedger | None = None
    registry: VisitorRegistry | None = None
    shared_speech_cache: SessionStore | None = None
    azure_slots: threading.BoundedSemaphore | None = None
    if public.enabled:
        data_dir = Path(public.data_dir)
        ledger = QuotaLedger(data_dir / "usage.db", public, clock=clock)
        ledger.initialize()
        ledger.prune()
        registry = VisitorRegistry(
            data_dir, public, clock=clock, on_delete=ledger.anonymize_visitor
        )
        registry.initialize()
        # Built-in material audio only; see BUILTIN_TEXTS.
        shared_speech_cache = SessionStore(f"sqlite:///{data_dir / 'speech_cache.db'}")
        shared_speech_cache.initialize(seed_builtin_materials=False)
        azure_slots = threading.BoundedSemaphore(public.max_concurrent_azure)
    else:
        personal_store = store or SessionStore(active_settings.database_url)
        personal_store.initialize()

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        maintenance = None
        if registry is not None and ledger is not None:

            async def maintain() -> None:
                # Expire idle visitors (TTL) and prune old ledger rows even
                # when no new visitor arrives to trigger cleanup.
                while True:
                    await asyncio.sleep(MAINTENANCE_INTERVAL_SECONDS)
                    with contextlib.suppress(Exception):
                        await asyncio.to_thread(registry.cleanup_expired)
                        await asyncio.to_thread(ledger.prune)

            maintenance = asyncio.create_task(maintain())
        try:
            yield
        finally:
            if maintenance is not None:
                maintenance.cancel()

    app = FastAPI(title="Just Talk API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(active_settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    if public.enabled:
        app.add_middleware(
            PublicGuardMiddleware,
            allowed_origins=public.allowed_origins,
            upload_paths=("/api/score",),
            max_upload_bytes=public.max_upload_bytes,
            max_body_bytes=public.max_json_bytes,
        )

    @app.exception_handler(PublicApiError)
    def handle_public_api_error(request: Request, exc: PublicApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.payload())

    @app.exception_handler(QuotaExceededError)
    def handle_quota_exceeded(request: Request, exc: QuotaExceededError) -> JSONResponse:
        what = "recording time" if exc.kind == "score" else "listening allowance"
        if exc.metric == "attempts":
            what = "scoring attempts" if exc.kind == "score" else "listening requests"
        return JSONResponse(
            status_code=429,
            content={
                "detail": _QUOTA_MESSAGES[exc.scope].format(what=what),
                "code": "quota_exhausted",
                "kind": exc.kind,
                "scope": exc.scope,
                "metric": exc.metric,
                "resets_at": exc.resets_at,
            },
        )

    def _require_visitor_id(request: Request) -> str:
        assert registry is not None
        visitor_id = registry.resolve(request.cookies.get(VISITOR_COOKIE))
        if visitor_id is None:
            raise PublicApiError(
                401, "visitor_required", "Start a practice session to continue."
            )
        return visitor_id

    def get_actor(request: Request) -> Iterator[Actor]:
        if not public.enabled:
            assert personal_store is not None
            yield Actor(visitor_id=None, store=personal_store)
            return
        assert registry is not None
        visitor_id = _require_visitor_id(request)
        usage = registry.use(visitor_id)
        try:
            visitor_store = usage.__enter__()
        except KeyError as exc:
            raise PublicApiError(
                401, "visitor_required", "Start a practice session to continue."
            ) from exc
        try:
            yield Actor(
                visitor_id=visitor_id,
                store=visitor_store,
                write_lock=registry.write_lock(visitor_id),
            )
        finally:
            usage.__exit__(None, None, None)

    def _azure_slot() -> contextlib.AbstractContextManager[None]:
        if azure_slots is None:
            return contextlib.nullcontext()

        @contextlib.contextmanager
        def slot() -> Iterator[None]:
            if not azure_slots.acquire(timeout=public.azure_queue_wait_seconds):
                raise PublicApiError(
                    503, "busy", "The scoring service is busy. Please try again in a moment."
                )
            try:
                yield
            finally:
                azure_slots.release()

        return slot()

    def _ensure_public_scoring_enabled() -> None:
        if public.enabled and not public.scoring_enabled:
            raise PublicApiError(
                503,
                "scoring_paused",
                "Scoring and playback are paused on this public trial right now.",
            )

    @contextlib.contextmanager
    def _billable_call(actor: Actor, kind: str, units: int) -> Iterator[None]:
        """Reserve usage, mark it sent, and never refund once Azure is called."""
        if ledger is None or actor.visitor_id is None:
            yield
            return
        attempt_id = ledger.reserve(visitor_id=actor.visitor_id, kind=kind, units=units)
        try:
            ledger.mark_sent(attempt_id)
        except BaseException:
            ledger.release(attempt_id)
            raise
        succeeded = False
        try:
            yield
            succeeded = True
        finally:
            ledger.complete(attempt_id, succeeded=succeeded)

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": True,
            "azure_configured": active_settings.azure_configured,
            "passage_check_configured": active_settings.passage_check_configured,
            "max_audio_seconds": active_settings.max_audio_seconds,
            "max_long_audio_seconds": active_settings.max_long_audio_seconds,
            "vocabulary_graduation_score": active_settings.vocabulary_graduation_score,
            "vocabulary_graduation_streak": active_settings.vocabulary_graduation_streak,
        }
        if public.enabled:
            payload["public"] = {
                "scoring_enabled": public.scoring_enabled,
                "turnstile_site_key": public.turnstile_site_key if public.turnstile_enabled else "",
                "max_tts_chars_per_request": public.max_tts_chars_per_request,
                "max_reference_chars": public.max_reference_chars,
                "visitor_ttl_days": public.visitor_ttl_days,
            }
        return payload

    if public.enabled:

        @app.post("/api/visitor")
        def create_visitor(
            request: Request,
            response: Response,
            body: VisitorCreateRequest | None = None,
        ) -> dict[str, Any]:
            assert registry is not None
            if registry.resolve(request.cookies.get(VISITOR_COOKIE)) is not None:
                return {"created": False}
            remote = client_address(request, public.client_ip_header)
            if public.turnstile_enabled:
                token = body.turnstile_token if body else ""
                if not verify_turnstile_token(public.turnstile_secret_key, token, remote):
                    raise PublicApiError(
                        403, "challenge_failed", "Please complete the verification and try again."
                    )
            try:
                _, token = registry.issue(client_key=remote)
            except VisitorLimitError as exc:
                raise PublicApiError(
                    429, "visitor_limit", _VISITOR_LIMIT_MESSAGES[exc.reason]
                ) from exc
            response.set_cookie(
                VISITOR_COOKIE,
                token,
                max_age=public.visitor_ttl_days * 86400,
                path="/api",
                secure=public.cookie_secure,
                httponly=True,
                samesite="lax",
            )
            response.status_code = 201
            return {"created": True}

        @app.get("/api/me/quota")
        def my_quota(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
            assert ledger is not None and actor.visitor_id is not None
            return ledger.status(visitor_id=actor.visitor_id)

        @app.delete("/api/me")
        def delete_me(request: Request, response: Response) -> dict[str, bool]:
            assert registry is not None
            visitor_id = _require_visitor_id(request)
            registry.delete(visitor_id)
            response.delete_cookie(
                VISITOR_COOKIE,
                path="/api",
                secure=public.cookie_secure,
                httponly=True,
                samesite="lax",
            )
            return {"deleted": True}

    def _score_uploaded_recording(
        *,
        actor: Actor,
        reference_text: str,
        audio: UploadFile,
        mode: str,
    ) -> dict[str, Any]:
        cleaned_reference = reference_text.strip()
        if not cleaned_reference:
            raise HTTPException(status_code=400, detail="reference_text is required.")
        if public.enabled and len(cleaned_reference) > public.max_reference_chars:
            raise HTTPException(
                status_code=400,
                detail=f"Text is too long; keep it under {public.max_reference_chars} characters.",
            )
        score_mode = mode.strip().lower()
        if score_mode not in {"short", "long"}:
            raise HTTPException(status_code=400, detail='mode must be "short" or "long".')
        if active_scorer is None:
            raise HTTPException(
                status_code=503,
                detail="Azure Speech is not configured. Fill AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.",
            )
        continuous_score = None
        if score_mode == "long":
            continuous_score = getattr(active_scorer, "score_continuous", None)
            if continuous_score is None:
                raise HTTPException(
                    status_code=503,
                    detail="Long Passage scoring is not available for this scorer.",
                )
        max_seconds = (
            active_settings.max_long_audio_seconds
            if score_mode == "long"
            else active_settings.max_audio_seconds
        )
        _ensure_public_scoring_enabled()
        if ledger is not None and actor.visitor_id is not None:
            ledger.precheck(visitor_id=actor.visitor_id, kind="score")

        with _azure_slot():
            suffix = Path(audio.filename or "recording.webm").suffix[:10] or ".webm"
            with tempfile.TemporaryDirectory() as temp_dir:
                input_path = Path(temp_dir) / f"upload{suffix}"
                wav_path = Path(temp_dir) / "recording.wav"
                with input_path.open("wb") as destination:
                    shutil.copyfileobj(audio.file, destination)

                try:
                    duration_seconds = decode_to_wav_16k_mono(
                        input_path, wav_path, max_seconds=max_seconds
                    )
                    ensure_audio_duration_allowed(
                        duration_seconds=duration_seconds, max_seconds=max_seconds
                    )
                    if public.enabled and duration_seconds < public.min_audio_seconds:
                        raise AudioTooShortError("Recording is too short.")
                except AudioTooLongError as exc:
                    raise HTTPException(status_code=413, detail=str(exc)) from exc
                except AudioTooShortError as exc:
                    raise HTTPException(
                        status_code=400,
                        detail="The recording is too short. Please record again.",
                    ) from exc
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError) as exc:
                    raise HTTPException(
                        status_code=400,
                        detail="Could not read the uploaded audio. Please record again.",
                    ) from exc

                with _billable_call(actor, "score", billable_audio_seconds(duration_seconds)):
                    if score_mode == "long":
                        try:
                            raw_results, scoring_warnings = continuous_score(
                                wav_path, cleaned_reference
                            )
                        except RuntimeError as exc:
                            raise HTTPException(status_code=502, detail=str(exc)) from exc
                        normalized = normalize_continuous_azure_results(raw_results)
                        if scoring_warnings:
                            normalized["warnings"] = scoring_warnings
                    else:
                        raw_result = active_scorer.score(wav_path, cleaned_reference)
                        normalized = normalize_azure_result(raw_result)

        if normalized.get("recognition_status") == "no_match":
            # Azure recognized no speech at all; skip persisting a session and
            # word-bank practice update so empty results don't pollute history/stats.
            return {"result": normalized, "session": None}

        session = actor.store.create_session(
            reference_text=cleaned_reference,
            audio_duration_ms=round(duration_seconds * 1000),
            normalized_result=normalized,
        )
        single_word = _single_word_reference(cleaned_reference) if score_mode == "short" else ""
        with actor.write_lock:
            if single_word and _word_slots_left(actor) == 0:
                known = {item["word"].casefold() for item in actor.store.list_words()}
                if single_word.casefold() not in known:
                    single_word = ""
            if single_word:
                actor.store.record_word_practice(
                    single_word,
                    latest_score=normalized.get("scores", {}).get("accuracy"),
                    graduation_score=active_settings.vocabulary_graduation_score,
                    graduation_streak=active_settings.vocabulary_graduation_streak,
                )
        return {"result": normalized, "session": session}

    def _word_slots_left(actor: Actor) -> int | None:
        if not public.enabled:
            return None
        return max(public.max_words - len(actor.store.list_words()), 0)

    def _word_bank_full_error() -> HTTPException:
        return HTTPException(
            status_code=400,
            detail=f"The word bank is full ({public.max_words} words). Remove some words first.",
        )

    def _validate_public_import(payload: dict[str, Any], actor: Actor) -> None:
        pack = payload["pack"]
        if pack["id"] in RESERVED_PACK_IDS:
            raise HTTPException(status_code=400, detail="This pack id is reserved.")
        # Never trust client labels: imports are always user content.
        pack["source"] = "user-imported"
        for field_name in ("id", "title", "license"):
            if len(str(pack[field_name])) > MAX_MATERIAL_META_CHARS:
                raise HTTPException(
                    status_code=400,
                    detail=f"pack {field_name} must be at most {MAX_MATERIAL_META_CHARS} characters.",
                )
        for lesson in payload["lessons"]:
            for field_name in ("id", "book", "lesson"):
                if len(str(lesson.get(field_name) or "")) > MAX_MATERIAL_META_CHARS:
                    raise HTTPException(
                        status_code=400,
                        detail=f"lesson {field_name} must be at most {MAX_MATERIAL_META_CHARS} characters.",
                    )
            if len(lesson["title"]) > public.max_lesson_title_chars:
                raise HTTPException(
                    status_code=400,
                    detail=f"lesson title must be at most {public.max_lesson_title_chars} characters.",
                )
            if len(lesson["text"]) > public.max_lesson_text_chars:
                raise HTTPException(
                    status_code=400,
                    detail=f"lesson text must be at most {public.max_lesson_text_chars} characters.",
                )
            tags = lesson.get("tags") or []
            if len(tags) > public.max_lesson_tags or any(
                len(str(tag)) > public.max_tag_chars for tag in tags
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"lessons may have at most {public.max_lesson_tags} tags of "
                        f"{public.max_tag_chars} characters."
                    ),
                )
        # Count every stored non-reserved lesson except the pack being
        # replaced (an import replaces all lessons of its pack).
        existing = [
            item
            for item in actor.store.list_materials()
            if item["pack_id"] not in RESERVED_PACK_IDS and item["pack_id"] != pack["id"]
        ]
        lesson_count = len(existing) + len(payload["lessons"])
        char_count = sum(len(item["text"]) + len(item["title"]) for item in existing) + sum(
            len(lesson["text"]) + len(lesson["title"]) for lesson in payload["lessons"]
        )
        if lesson_count > public.max_imported_lessons:
            raise HTTPException(
                status_code=400,
                detail=f"Imported materials are limited to {public.max_imported_lessons} lessons.",
            )
        if char_count > public.max_imported_chars:
            raise HTTPException(
                status_code=400,
                detail=f"Imported materials are limited to {public.max_imported_chars} characters in total.",
            )

    @app.post("/api/score")
    def score(
        reference_text: str = Form(...),
        audio: UploadFile = File(...),
        mode: str = Form("short"),
        actor: Actor = Depends(get_actor),
    ) -> dict[str, Any]:
        return _score_uploaded_recording(
            actor=actor,
            reference_text=reference_text,
            audio=audio,
            mode=mode,
        )

    @app.get("/api/sessions")
    def list_sessions(actor: Actor = Depends(get_actor)) -> list[dict[str, Any]]:
        return actor.store.list_sessions()

    @app.get("/api/export")
    def export_data(response: Response, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
        response.headers["Content-Disposition"] = (
            'attachment; filename="just-talk-export.json"'
        )
        return actor.store.export_data()

    @app.get("/api/sessions/{session_id}")
    def get_session(session_id: str, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
        try:
            return actor.store.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Session not found.") from exc

    @app.get("/api/words")
    def list_words(
        status: str | None = None, actor: Actor = Depends(get_actor)
    ) -> list[dict[str, Any]]:
        try:
            return actor.store.list_words(status=status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/stats/activity")
    def get_activity_stats(actor: Actor = Depends(get_actor)) -> dict[str, Any]:
        return actor.store.get_activity_stats()

    @app.get("/api/phoneme-stats")
    def list_phoneme_stats(
        min_attempts: int | None = None, actor: Actor = Depends(get_actor)
    ) -> list[dict[str, Any]]:
        if min_attempts is None:
            return actor.store.list_phoneme_stats()
        return actor.store.list_phoneme_stats(min_attempts=max(min_attempts, 1))

    @app.get("/api/materials")
    def list_materials(actor: Actor = Depends(get_actor)) -> list[dict[str, Any]]:
        return actor.store.list_materials()

    @app.post("/api/material-packs/import")
    def import_material_pack(
        request: MaterialPackImportRequest, actor: Actor = Depends(get_actor)
    ) -> dict[str, Any]:
        payload = request.model_dump()
        with actor.write_lock:
            if public.enabled:
                _validate_public_import(payload, actor)
            try:
                return actor.store.import_material_pack(payload)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/material-groups")
    def delete_material_group(
        pack_id: str, book: str = "", actor: Actor = Depends(get_actor)
    ) -> dict[str, int]:
        try:
            return {"deleted": actor.store.delete_material_group(pack_id=pack_id, book=book)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/words")
    def create_word(
        request: WordCreateRequest, actor: Actor = Depends(get_actor)
    ) -> dict[str, Any]:
        if public.enabled:
            if len(request.word.strip()) > public.max_word_chars:
                raise HTTPException(
                    status_code=400,
                    detail=f"Words must be at most {public.max_word_chars} characters.",
                )
            if len(request.notes) > public.max_notes_chars:
                raise HTTPException(
                    status_code=400,
                    detail=f"Notes must be at most {public.max_notes_chars} characters.",
                )
        with actor.write_lock:
            if public.enabled and _word_slots_left(actor) == 0:
                raise _word_bank_full_error()
            try:
                return actor.store.create_word(
                    request.word,
                    source="manual",
                    notes=request.notes,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/words/{word_id}")
    def delete_word(word_id: str, actor: Actor = Depends(get_actor)) -> dict[str, bool]:
        return {"deleted": actor.store.delete_word(word_id)}

    @app.post("/api/words/from-session/{session_id}")
    def create_words_from_session(
        session_id: str,
        max_score: float | None = None,
        actor: Actor = Depends(get_actor),
    ) -> list[dict[str, Any]]:
        cutoff = (
            active_settings.vocabulary_graduation_score
            if max_score is None
            else max_score
        )
        with actor.write_lock:
            slots = _word_slots_left(actor)
            if slots == 0:
                raise _word_bank_full_error()
            try:
                return actor.store.create_words_from_session(
                    session_id, max_score=cutoff, max_new_words=slots
                )
            except KeyError as exc:
                raise HTTPException(status_code=404, detail="Session not found.") from exc

    @app.post("/api/speak")
    def speak(request: SpeakRequest, actor: Actor = Depends(get_actor)) -> dict[str, Any]:
        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required.")
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        voice = active_settings.azure_tts_voice
        if public.enabled:
            if len(text) > public.max_tts_chars_per_request:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Text is too long to play at once; keep it under "
                        f"{public.max_tts_chars_per_request} characters."
                    ),
                )
            # Ignore the client's cache_key and key on the full text. Built-in
            # passages share one cache; anything else stays in the visitor's
            # own database and is deleted with it.
            cache_store = shared_speech_cache if text in BUILTIN_TEXTS else actor.store
            cache_key = f"text:{text_hash}"
        else:
            cache_store = actor.store
            cache_key = request.cache_key.strip() if request.cache_key else ""
        assert cache_store is not None
        if cache_key:
            cached = cache_store.get_speech_cache(
                cache_key=cache_key,
                text_hash=text_hash,
                voice=voice,
            )
            if cached is not None and (
                cached["word_boundaries"] or active_synthesizer is None
            ):
                return {
                    "audio_base64": base64.b64encode(cached["audio_bytes"]).decode("ascii"),
                    "content_type": cached["content_type"],
                    "word_boundaries": cached["word_boundaries"],
                }
        if active_synthesizer is None:
            raise HTTPException(
                status_code=503,
                detail="Azure Speech is not configured. Fill AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.",
            )
        _ensure_public_scoring_enabled()
        with _azure_slot(), _billable_call(actor, "tts", billable_tts_characters(text)):
            try:
                synthesis_result = active_synthesizer.synthesize(text)
            except RuntimeError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
        audio_bytes, content_type = synthesis_result[:2]
        word_boundaries = synthesis_result[2] if len(synthesis_result) > 2 else []
        if cache_key:
            cache_store.save_speech_cache(
                cache_key=cache_key,
                text_hash=text_hash,
                voice=voice,
                content_type=content_type,
                audio_bytes=audio_bytes,
                word_boundaries=word_boundaries,
            )
        return {
            "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
            "content_type": content_type,
            "word_boundaries": word_boundaries,
        }

    @app.post("/api/passage-check")
    def passage_check(text: str = Form(...)) -> dict[str, Any]:
        if not active_settings.passage_check_configured:
            raise HTTPException(
                status_code=503,
                detail="Passage check is optional. Set LLM_BASE_URL and LLM_API_KEY to enable it.",
            )
        try:
            return check_passage(active_settings, text.strip())
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.post("/api/drills/generate")
    def generate_drill_material(
        request: DrillGenerateRequest, actor: Actor = Depends(get_actor)
    ) -> dict[str, Any]:
        if not active_settings.passage_check_configured:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Drill generation is optional. "
                    "Set LLM_BASE_URL and LLM_API_KEY to enable it."
                ),
            )
        phoneme = request.phoneme.strip().strip("/")
        if not phoneme:
            raise HTTPException(status_code=400, detail="phoneme is required.")
        seed_words = _seed_words_for_phoneme(actor.store, phoneme)
        try:
            drill = generate_drill(active_settings, phoneme, seed_words=seed_words)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return actor.store.save_drill_material(
            phoneme=phoneme,
            title=drill["title"],
            passage=drill["passage"],
            focus_words=drill["focus_words"],
        )

    if active_settings.static_dir:
        mount_static(app, active_settings.static_dir, turnstile=public.turnstile_enabled)

    return app


def _seed_words_for_phoneme(store: SessionStore, phoneme: str) -> list[str]:
    for stat in store.list_phoneme_stats(min_attempts=1):
        if stat["phoneme"] == phoneme:
            return [example["word"] for example in stat["example_words"]]
    return []


def _single_word_reference(text: str) -> str:
    stripped = text.strip().strip(".,!?;:\"'()[]{}")
    if not stripped or len(stripped.split()) != 1:
        return ""
    return stripped


app = create_app()
