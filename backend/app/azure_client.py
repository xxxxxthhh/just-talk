import json
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

    def score(self, wav_path: Path, reference_text: str) -> dict:
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
            enable_miscue=True,
        )
        pronunciation_config.phoneme_alphabet = "IPA"
        pronunciation_config.nbest_phoneme_count = 5
        pronunciation_config.enable_prosody_assessment()
        pronunciation_config.apply_to(recognizer)

        result = recognizer.recognize_once()
        payload = result.properties.get(
            speechsdk.PropertyId.SpeechServiceResponse_JsonResult
        )
        return json.loads(payload)
