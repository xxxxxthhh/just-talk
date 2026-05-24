import base64
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .audio import (
    AudioTooLongError,
    convert_to_wav_16k_mono,
    ensure_audio_duration_allowed,
    probe_audio_duration_seconds,
)
from .azure_client import AzurePronunciationScorer
from .config import Settings
from .passage import check_passage
from .scoring import normalize_azure_result, normalize_continuous_azure_results
from .storage import SessionStore
from .tts import AzureTextToSpeechSynthesizer


class WordCreateRequest(BaseModel):
    word: str
    notes: str = ""


class SpeakRequest(BaseModel):
    text: str


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

    @app.post("/api/score")
    async def score(
        reference_text: str = Form(...),
        audio: UploadFile = File(...),
    ) -> dict[str, Any]:
        cleaned_reference = reference_text.strip()
        if not cleaned_reference:
            raise HTTPException(status_code=400, detail="reference_text is required.")
        if active_scorer is None:
            raise HTTPException(
                status_code=503,
                detail="Azure Speech is not configured. Fill AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.",
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
                    max_seconds=active_settings.max_audio_seconds,
                )
                convert_to_wav_16k_mono(input_path, wav_path)
            except AudioTooLongError as exc:
                raise HTTPException(status_code=413, detail=str(exc)) from exc
            except (subprocess.CalledProcessError, KeyError, ValueError) as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Could not read the uploaded audio. Please record again.",
                ) from exc

            raw_result = active_scorer.score(wav_path, cleaned_reference)

        normalized = normalize_azure_result(raw_result)
        session = active_store.create_session(
            reference_text=cleaned_reference,
            audio_duration_ms=round(duration_seconds * 1000),
            normalized_result=normalized,
        )
        single_word = _single_word_reference(cleaned_reference)
        if single_word:
            active_store.record_word_practice(
                single_word,
                latest_score=normalized.get("scores", {}).get("accuracy"),
                graduation_score=active_settings.vocabulary_graduation_score,
                graduation_streak=active_settings.vocabulary_graduation_streak,
            )
        return {"result": normalized, "session": session}

    @app.post("/api/score/long")
    async def score_long(
        reference_text: str = Form(...),
        audio: UploadFile = File(...),
    ) -> dict[str, Any]:
        cleaned_reference = reference_text.strip()
        if not cleaned_reference:
            raise HTTPException(status_code=400, detail="reference_text is required.")
        if active_scorer is None:
            raise HTTPException(
                status_code=503,
                detail="Azure Speech is not configured. Fill AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.",
            )
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
                    max_seconds=active_settings.max_long_audio_seconds,
                )
                convert_to_wav_16k_mono(input_path, wav_path)
            except AudioTooLongError as exc:
                raise HTTPException(status_code=413, detail=str(exc)) from exc
            except (subprocess.CalledProcessError, KeyError, ValueError) as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Could not read the uploaded audio. Please record again.",
                ) from exc

            try:
                raw_results = continuous_score(wav_path, cleaned_reference)
            except RuntimeError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc

        normalized = normalize_continuous_azure_results(raw_results)
        session = active_store.create_session(
            reference_text=cleaned_reference,
            audio_duration_ms=round(duration_seconds * 1000),
            normalized_result=normalized,
        )
        return {"result": normalized, "session": session}

    @app.get("/api/sessions")
    def list_sessions() -> list[dict[str, Any]]:
        return active_store.list_sessions()

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
    def speak(request: SpeakRequest) -> dict[str, str]:
        text = request.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required.")
        if active_synthesizer is None:
            raise HTTPException(
                status_code=503,
                detail="Azure Speech is not configured. Fill AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.",
            )
        try:
            audio_bytes, content_type = active_synthesizer.synthesize(text)
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {
            "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
            "content_type": content_type,
        }

    @app.post("/api/passage-check")
    async def passage_check(text: str = Form(...)) -> dict[str, Any]:
        if not active_settings.passage_check_configured:
            raise HTTPException(
                status_code=503,
                detail="Passage check is optional. Set LLM_BASE_URL and LLM_API_KEY to enable it.",
            )
        return check_passage(active_settings, text.strip())

    return app


def _single_word_reference(text: str) -> str:
    stripped = text.strip().strip(".,!?;:\"'()[]{}")
    if not stripped or len(stripped.split()) != 1:
        return ""
    return stripped


app = create_app()
