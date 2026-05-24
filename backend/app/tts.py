from .azure_client import AzureSpeechConfigurationError
from .config import Settings


class AzureTextToSpeechSynthesizer:
    def __init__(self, settings: Settings) -> None:
        if not settings.azure_configured:
            raise AzureSpeechConfigurationError(
                "Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env."
            )
        self.settings = settings

    def synthesize(self, text: str) -> tuple[bytes, str]:
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
        result = synthesizer.speak_text_async(text).get()
        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return bytes(result.audio_data), "audio/mpeg"

        details = speechsdk.SpeechSynthesisCancellationDetails(result)
        raise RuntimeError(details.error_details or "Speech synthesis failed.")
