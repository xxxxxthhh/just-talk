from .azure_client import AzureSpeechConfigurationError
from .config import Settings

AZURE_TICKS_PER_MILLISECOND = 10_000


def _duration_to_ms(value: object) -> int:
    if value is None:
        return 0
    total_seconds = getattr(value, "total_seconds", None)
    if callable(total_seconds):
        return round(total_seconds() * 1000)
    return round(float(value) / AZURE_TICKS_PER_MILLISECOND)


class AzureTextToSpeechSynthesizer:
    def __init__(self, settings: Settings) -> None:
        if not settings.azure_configured:
            raise AzureSpeechConfigurationError(
                "Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env."
            )
        self.settings = settings

    def synthesize(self, text: str) -> tuple[bytes, str, list[dict]]:
        import azure.cognitiveservices.speech as speechsdk

        speech_config = speechsdk.SpeechConfig(
            subscription=self.settings.azure_speech_key,
            region=self.settings.azure_speech_region,
        )
        speech_config.speech_synthesis_voice_name = self.settings.azure_tts_voice
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
        )

        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=speech_config,
            audio_config=None,
        )
        word_boundaries: list[dict] = []

        def on_word_boundary(event: object) -> None:
            boundary_text = str(getattr(event, "text", "") or "")
            if not any(character.isalnum() for character in boundary_text):
                return
            word_boundaries.append(
                {
                    "text": boundary_text,
                    "text_offset": int(getattr(event, "text_offset", 0) or 0),
                    "word_length": int(getattr(event, "word_length", 0) or 0),
                    "audio_offset_ms": round(
                        float(getattr(event, "audio_offset", 0) or 0)
                        / AZURE_TICKS_PER_MILLISECOND
                    ),
                    "duration_ms": _duration_to_ms(getattr(event, "duration", None)),
                }
            )

        synthesizer.synthesis_word_boundary.connect(on_word_boundary)
        result = synthesizer.speak_text_async(text).get()
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return bytes(result.audio_data), "audio/mpeg", word_boundaries

        details = speechsdk.SpeechSynthesisCancellationDetails(result)
        raise RuntimeError(details.error_details or "Speech synthesis failed.")
