import json
import threading
from pathlib import Path

from .config import Settings


class AzureSpeechConfigurationError(RuntimeError):
    """Raised when Azure credentials are missing for a live scoring request."""


class AzurePronunciationScorer:
    def __init__(self, settings: Settings) -> None:
        if not settings.azure_configured:
            raise AzureSpeechConfigurationError(
                "Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env."
            )
        self.settings = settings

    def _build_recognizer(
        self, wav_path: Path, reference_text: str, enable_miscue: bool
    ) -> object:
        import azure.cognitiveservices.speech as speechsdk

        speech_config = speechsdk.SpeechConfig(
            subscription=self.settings.azure_speech_key,
            region=self.settings.azure_speech_region,
        )
        speech_config.speech_recognition_language = "en-US"

        audio_config = speechsdk.audio.AudioConfig(filename=str(wav_path))
        recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
            language="en-US",
        )

        pronunciation_config = speechsdk.PronunciationAssessmentConfig(
            reference_text=reference_text,
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
            enable_miscue=enable_miscue,
        )
        pronunciation_config.phoneme_alphabet = "IPA"
        pronunciation_config.nbest_phoneme_count = 5
        pronunciation_config.enable_prosody_assessment()
        pronunciation_config.apply_to(recognizer)

        return recognizer

    def score(self, wav_path: Path, reference_text: str) -> dict:
        import azure.cognitiveservices.speech as speechsdk

        recognizer = self._build_recognizer(wav_path, reference_text, enable_miscue=True)
        result = recognizer.recognize_once()
        payload = result.properties.get(
            speechsdk.PropertyId.SpeechServiceResponse_JsonResult
        )
        return json.loads(payload)

    def score_continuous(
        self, wav_path: Path, reference_text: str
    ) -> tuple[list[dict], list[str]]:
        import azure.cognitiveservices.speech as speechsdk

        recognizer = self._build_recognizer(wav_path, reference_text, enable_miscue=False)

        done = threading.Event()
        segments: list[dict] = []
        errors: list[str] = []

        def on_recognized(event: object) -> None:
            result = event.result
            if result.reason == speechsdk.ResultReason.RecognizedSpeech:
                payload = result.properties.get(
                    speechsdk.PropertyId.SpeechServiceResponse_JsonResult
                )
                if payload:
                    segments.append(json.loads(payload))

        def on_canceled(event: object) -> None:
            if event.reason == speechsdk.CancellationReason.Error:
                detail = str(event.reason)
                error_details = getattr(event, "error_details", "")
                if error_details:
                    detail = f"{detail}: {error_details}"
                errors.append(detail)
            done.set()

        def on_session_stopped(event: object) -> None:
            done.set()

        recognizer.recognized.connect(on_recognized)
        recognizer.canceled.connect(on_canceled)
        recognizer.session_stopped.connect(on_session_stopped)

        recognizer.start_continuous_recognition()
        timeout_seconds = max(30, self.settings.max_long_audio_seconds + 30)
        finished = done.wait(timeout_seconds)
        recognizer.stop_continuous_recognition()

        if not finished:
            raise RuntimeError("Timed out while scoring long passage audio.")
        if not segments:
            detail = "; ".join(errors) or "no speech was recognized"
            raise RuntimeError(f"Azure Speech returned no long passage segments ({detail}).")
        warnings = [
            f"Azure Speech stopped early, so the score may be incomplete ({error})."
            for error in errors
        ]
        return segments, warnings
