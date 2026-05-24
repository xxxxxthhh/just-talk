import os
from dataclasses import dataclass
from pathlib import Path


def _read_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _env_with_dotenv() -> dict[str, str]:
    values: dict[str, str] = {}
    for candidate in (Path(".env"), Path("backend/.env")):
        values.update(_read_dotenv(candidate))
    values.update(os.environ)
    return values


@dataclass(frozen=True)
class Settings:
    azure_speech_key: str = ""
    azure_speech_region: str = ""
    azure_tts_voice: str = "en-US-JennyNeural"
    database_url: str = "sqlite:///./data/just_talk.db"
    max_audio_seconds: int = 30
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"

    @property
    def azure_configured(self) -> bool:
        return bool(self.azure_speech_key and self.azure_speech_region)

    @property
    def passage_check_configured(self) -> bool:
        return bool(self.llm_base_url and self.llm_api_key)

    @classmethod
    def from_env(cls) -> "Settings":
        env = _env_with_dotenv()
        return cls(
            azure_speech_key=env.get("AZURE_SPEECH_KEY", ""),
            azure_speech_region=env.get("AZURE_SPEECH_REGION", ""),
            azure_tts_voice=env.get("AZURE_TTS_VOICE", "en-US-JennyNeural"),
            database_url=env.get("DATABASE_URL", "sqlite:///./data/just_talk.db"),
            max_audio_seconds=int(env.get("MAX_AUDIO_SECONDS", "30")),
            llm_base_url=env.get("LLM_BASE_URL", ""),
            llm_api_key=env.get("LLM_API_KEY", ""),
            llm_model=env.get("LLM_MODEL", "gpt-4o-mini"),
        )
