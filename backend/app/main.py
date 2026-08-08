import base64
import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .audio import (
    AudioTooLongError,
    convert_to_wav_16k_mono,
    ensure_audio_duration_allowed,
    probe_audio_duration_seconds,
)
from .azure_client import AzurePronunciationScorer
from .config import Settings
from .drills import generate_drill
from .passage import check_passage
from .scoring import normalize_azure_result, normalize_continuous_azure_results
from .storage import SessionStore
from .tts import AzureTextToSpeechSynthesizer


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


def create_app(
    *,
    settings: Settings | None = None,
    store: SessionStore | None = None,
    scorer: Any | None = None,
    synthesizer: Any | None = None,
) -> FastAPI:
    active_settings = settings or Settings.from_env()
    active_store = store or SessionStore(active_settings.database_url)
    active_store.initialize()
    active_scorer = scorer
    if active_scorer is None and active_settings.azure_configured:
        active_scorer = AzurePronunciationScorer(active_settings)
    active_synthesizer = synthesizer
    if active_synthesizer is None and active_settings.azure_configured:
        active_synthesizer = AzureTextToSpeechSynthesizer(active_settings)

    app = FastAPI(title="Just Talk API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "azure_configured": active_settings.azure_configured,
            "passage_check_configured": active_settings.passage_check_configured,
            "max_audio_seconds": active_settings.max_audio_seconds,
            "max_long_audio_seconds": active_settings.max_long_audio_seconds,
            "vocabulary_graduation_score": active_settings.vocabulary_graduation_score,
            "vocabulary_graduation_streak": active_settings.vocabulary_graduation_streak,
        }

    def _score_uploaded_recording(
        *,
        reference_text: str,
        audio: UploadFile,
        mode: str,
    ) -> dict[str, Any]:
        cleaned_reference = reference_text.strip()
        if not cleaned_reference:
            raise HTTPException(status_code=400, detail="reference_text is required.")
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

        suffix = Path(audio.filename or "recording.webm").suffix or ".webm"
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / f"upload{suffix}"
            wav_path = Path(temp_dir) / "recording.wav"
            with input_path.open("wb") as destination:
                shutil.copyfileobj(audio.file, destination)

            try:
                duration_seconds = probe_audio_duration_seconds(input_path)
                ensure_audio_duration_allowed(
                    duration_seconds=duration_seconds,
                    max_seconds=(
                        active_settings.max_long_audio_seconds
                        if score_mode == "long"
                        else active_settings.max_audio_seconds
                    ),
                )
                convert_to_wav_16k_mono(input_path, wav_path)
            except AudioTooLongError as exc:
                raise HTTPException(status_code=413, detail=str(exc)) from exc
            except (subprocess.CalledProcessError, KeyError, ValueError) as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Could not read the uploaded audio. Please record again.",
                ) from exc

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

        session = active_store.create_session(
            reference_text=cleaned_reference,
            audio_duration_ms=round(duration_seconds * 1000),
            normalized_result=normalized,
        )
        if score_mode == "short" and (single_word := _single_word_reference(cleaned_reference)):
            active_store.record_word_practice(
                single_word,
                latest_score=normalized.get("scores", {}).get("accuracy"),
                graduation_score=active_settings.vocabulary_graduation_score,
                graduation_streak=active_settings.vocabulary_graduation_streak,
            )
        return {"result": normalized, "session": session}

    @app.post("/api/score")
    def score(
        reference_text: str = Form(...),
        audio: UploadFile = File(...),
        mode: str = Form("short"),
    ) -> dict[str, Any]:
        return _score_uploaded_recording(
            reference_text=reference_text,
            audio=audio,
            mode=mode,
        )

    @app.get("/api/sessions")
    def list_sessions() -> list[dict[str, Any]]:
        return active_store.list_sessions()

    @app.get("/api/export")
    def export_data(response: Response) -> dict[str, Any]:
        response.headers["Content-Disposition"] = (
            'attachment; filename="just-talk-export.json"'
        )
        return active_store.export_data()

    @app.get("/api/sessions/{session_id}")
    def get_session(session_id: str) -> dict[str, Any]:
        try:
            return active_store.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Session not found.") from exc

    @app.get("/api/words")
    def list_words(status: str | None = None) -> list[dict[str, Any]]:
        try:
            return active_store.list_words(status=status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/stats/activity")
    def get_activity_stats() -> dict[str, Any]:
        return active_store.get_activity_stats()

    @app.get("/api/phoneme-stats")
    def list_phoneme_stats(min_attempts: int | None = None) -> list[dict[str, Any]]:
        if min_attempts is None:
            return active_store.list_phoneme_stats()
        return active_store.list_phoneme_stats(min_attempts=max(min_attempts, 1))

    @app.get("/api/materials")
    def list_materials() -> list[dict[str, Any]]:
        return active_store.list_materials()

    @app.post("/api/material-packs/import")
    def import_material_pack(request: MaterialPackImportRequest) -> dict[str, Any]:
        payload = request.model_dump()
        try:
            return active_store.import_material_pack(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/material-groups")
    def delete_material_group(pack_id: str, book: str = "") -> dict[str, int]:
        try:
            return {"deleted": active_store.delete_material_group(pack_id=pack_id, book=book)}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/words")
    def create_word(request: WordCreateRequest) -> dict[str, Any]:
        try:
            return active_store.create_word(
                request.word,
                source="manual",
                notes=request.notes,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/words/{word_id}")
    def delete_word(word_id: str) -> dict[str, bool]:
        return {"deleted": active_store.delete_word(word_id)}

    @app.post("/api/words/from-session/{session_id}")
    def create_words_from_session(
        session_id: str,
        max_score: float | None = None,
    ) -> list[dict[str, Any]]:
        try:
            cutoff = (
                active_settings.vocabulary_graduation_score
                if max_score is None
                else max_score
            )
            return active_store.create_words_from_session(session_id, max_score=cutoff)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Session not found.") from exc

    @app.post("/api/speak")
    def speak(request: SpeakRequest) -> dict[str, Any]:
        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required.")
        cache_key = request.cache_key.strip() if request.cache_key else ""
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        voice = active_settings.azure_tts_voice
        if cache_key:
            cached = active_store.get_speech_cache(
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
        try:
            synthesis_result = active_synthesizer.synthesize(text)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        audio_bytes, content_type = synthesis_result[:2]
        word_boundaries = synthesis_result[2] if len(synthesis_result) > 2 else []
        if cache_key:
            active_store.save_speech_cache(
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
    def generate_drill_material(request: DrillGenerateRequest) -> dict[str, Any]:
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
        seed_words = _seed_words_for_phoneme(active_store, phoneme)
        try:
            drill = generate_drill(active_settings, phoneme, seed_words=seed_words)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return active_store.save_drill_material(
            phoneme=phoneme,
            title=drill["title"],
            passage=drill["passage"],
            focus_words=drill["focus_words"],
        )

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
