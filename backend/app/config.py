import os
from dataclasses import dataclass, field
from pathlib import Path

_DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "capacitor://localhost",
)


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


def _int_env(env: dict[str, str], key: str, default: str) -> int:
    raw = env.get(key, default)
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{key} must be an integer, got {raw!r}.") from exc


def _float_env(env: dict[str, str], key: str, default: str) -> float:
    raw = env.get(key, default)
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{key} must be a number, got {raw!r}.") from exc


def _cors_origins_env(env: dict[str, str]) -> tuple[str, ...]:
    raw = env.get("CORS_ORIGINS", ",".join(_DEFAULT_CORS_ORIGINS))
    return tuple(origin.strip() for origin in raw.split(",") if origin.strip())


def _bool_env(env: dict[str, str], key: str, default: str) -> bool:
    raw = env.get(key, default).strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off", ""}:
        return False
    raise ValueError(f"{key} must be a boolean, got {raw!r}.")


def _non_negative_int_env(env: dict[str, str], key: str, default: str) -> int:
    value = _int_env(env, key, default)
    if value < 0:
        raise ValueError(f"{key} must not be negative, got {value}.")
    return value


@dataclass(frozen=True)
class PublicSettings:
    """Hosted "public trial" mode: anonymous visitors, per-visitor data, and
    persistent site-wide caps on billable Azure usage. Off by default so the
    personal/local and iOS setups behave exactly as before."""

    enabled: bool = False
    data_dir: str = "./data/public"
    allowed_origins: tuple[str, ...] = ()
    cookie_secure: bool = True
    scoring_enabled: bool = True
    visitor_ttl_days: int = 7
    max_active_visitors: int = 300
    new_visitors_per_hour: int = 30
    new_visitors_per_client_per_hour: int = 5
    client_ip_header: str = ""
    # Billable usage caps. Windows are UTC calendar days/months.
    global_monthly_score_seconds: int = 4 * 3600
    global_monthly_tts_chars: int = 100_000
    global_daily_score_seconds: int = 30 * 60
    global_daily_tts_chars: int = 5_000
    visitor_daily_score_seconds: int = 3 * 60
    visitor_daily_tts_chars: int = 1_000
    global_monthly_score_attempts: int = 1_500
    global_monthly_tts_attempts: int = 3_000
    global_daily_score_attempts: int = 120
    global_daily_tts_attempts: int = 200
    visitor_daily_score_attempts: int = 20
    visitor_daily_tts_attempts: int = 40
    # Request shape limits.
    max_upload_bytes: int = 5_000_000
    max_json_bytes: int = 262_144
    max_tts_chars_per_request: int = 600
    max_reference_chars: int = 1_500
    min_audio_seconds: float = 0.3
    max_words: int = 500
    max_imported_lessons: int = 200
    max_concurrent_azure: int = 2
    azure_queue_wait_seconds: float = 10.0
    turnstile_site_key: str = ""
    turnstile_secret_key: str = ""

    @property
    def turnstile_enabled(self) -> bool:
        return bool(self.turnstile_site_key and self.turnstile_secret_key)

    @classmethod
    def from_env(cls, env: dict[str, str], cors_origins: tuple[str, ...]) -> "PublicSettings":
        defaults = cls()

        def n(key: str, default: int) -> int:
            return _non_negative_int_env(env, key, str(default))

        raw_origins = env.get("PUBLIC_ALLOWED_ORIGINS", "")
        allowed_origins = tuple(
            origin.strip() for origin in raw_origins.split(",") if origin.strip()
        ) or cors_origins
        return cls(
            enabled=_bool_env(env, "PUBLIC_MODE", "0"),
            data_dir=env.get("PUBLIC_DATA_DIR", defaults.data_dir),
            allowed_origins=allowed_origins,
            cookie_secure=_bool_env(env, "PUBLIC_COOKIE_SECURE", "1"),
            scoring_enabled=_bool_env(env, "PUBLIC_SCORING_ENABLED", "1"),
            visitor_ttl_days=max(n("PUBLIC_VISITOR_TTL_DAYS", defaults.visitor_ttl_days), 1),
            max_active_visitors=n("PUBLIC_MAX_ACTIVE_VISITORS", defaults.max_active_visitors),
            new_visitors_per_hour=n("PUBLIC_NEW_VISITORS_PER_HOUR", defaults.new_visitors_per_hour),
            new_visitors_per_client_per_hour=n(
                "PUBLIC_NEW_VISITORS_PER_CLIENT_PER_HOUR",
                defaults.new_visitors_per_client_per_hour,
            ),
            client_ip_header=env.get("PUBLIC_CLIENT_IP_HEADER", "").strip(),
            global_monthly_score_seconds=n(
                "PUBLIC_GLOBAL_MONTHLY_SCORE_SECONDS", defaults.global_monthly_score_seconds
            ),
            global_monthly_tts_chars=n(
                "PUBLIC_GLOBAL_MONTHLY_TTS_CHARS", defaults.global_monthly_tts_chars
            ),
            global_daily_score_seconds=n(
                "PUBLIC_GLOBAL_DAILY_SCORE_SECONDS", defaults.global_daily_score_seconds
            ),
            global_daily_tts_chars=n("PUBLIC_GLOBAL_DAILY_TTS_CHARS", defaults.global_daily_tts_chars),
            visitor_daily_score_seconds=n(
                "PUBLIC_VISITOR_DAILY_SCORE_SECONDS", defaults.visitor_daily_score_seconds
            ),
            visitor_daily_tts_chars=n(
                "PUBLIC_VISITOR_DAILY_TTS_CHARS", defaults.visitor_daily_tts_chars
            ),
            global_monthly_score_attempts=n(
                "PUBLIC_GLOBAL_MONTHLY_SCORE_ATTEMPTS", defaults.global_monthly_score_attempts
            ),
            global_monthly_tts_attempts=n(
                "PUBLIC_GLOBAL_MONTHLY_TTS_ATTEMPTS", defaults.global_monthly_tts_attempts
            ),
            global_daily_score_attempts=n(
                "PUBLIC_GLOBAL_DAILY_SCORE_ATTEMPTS", defaults.global_daily_score_attempts
            ),
            global_daily_tts_attempts=n(
                "PUBLIC_GLOBAL_DAILY_TTS_ATTEMPTS", defaults.global_daily_tts_attempts
            ),
            visitor_daily_score_attempts=n(
                "PUBLIC_VISITOR_DAILY_SCORE_ATTEMPTS", defaults.visitor_daily_score_attempts
            ),
            visitor_daily_tts_attempts=n(
                "PUBLIC_VISITOR_DAILY_TTS_ATTEMPTS", defaults.visitor_daily_tts_attempts
            ),
            max_upload_bytes=n("PUBLIC_MAX_UPLOAD_BYTES", defaults.max_upload_bytes),
            max_json_bytes=n("PUBLIC_MAX_JSON_BYTES", defaults.max_json_bytes),
            max_tts_chars_per_request=n(
                "PUBLIC_MAX_TTS_CHARS_PER_REQUEST", defaults.max_tts_chars_per_request
            ),
            max_reference_chars=n("PUBLIC_MAX_REFERENCE_CHARS", defaults.max_reference_chars),
            min_audio_seconds=_float_env(
                env, "PUBLIC_MIN_AUDIO_SECONDS", str(defaults.min_audio_seconds)
            ),
            max_words=n("PUBLIC_MAX_WORDS", defaults.max_words),
            max_imported_lessons=n("PUBLIC_MAX_IMPORTED_LESSONS", defaults.max_imported_lessons),
            max_concurrent_azure=max(
                n("PUBLIC_MAX_CONCURRENT_AZURE", defaults.max_concurrent_azure), 1
            ),
            azure_queue_wait_seconds=_float_env(
                env, "PUBLIC_AZURE_QUEUE_WAIT_SECONDS", str(defaults.azure_queue_wait_seconds)
            ),
            turnstile_site_key=env.get("TURNSTILE_SITE_KEY", ""),
            turnstile_secret_key=env.get("TURNSTILE_SECRET_KEY", ""),
        )


@dataclass(frozen=True)
class Settings:
    azure_speech_key: str = ""
    azure_speech_region: str = ""
    azure_tts_voice: str = "en-US-JennyNeural"
    database_url: str = "sqlite:///./data/just_talk.db"
    max_audio_seconds: int = 30
    max_long_audio_seconds: int = 180
    vocabulary_graduation_score: float = 85.0
    vocabulary_graduation_streak: int = 2
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    cors_origins: tuple[str, ...] = _DEFAULT_CORS_ORIGINS
    static_dir: str = ""
    public: PublicSettings = field(default_factory=PublicSettings)

    @property
    def azure_configured(self) -> bool:
        return bool(self.azure_speech_key and self.azure_speech_region)

    @property
    def passage_check_configured(self) -> bool:
        # LLM features are never offered on the hosted public trial.
        if self.public.enabled:
            return False
        return bool(self.llm_base_url and self.llm_api_key)

    @classmethod
    def from_env(cls) -> "Settings":
        env = _env_with_dotenv()
        cors_origins = _cors_origins_env(env)
        public = PublicSettings.from_env(env, cors_origins)
        # Public trial defaults to 90s long passages to keep each attempt cheap.
        long_default = "90" if public.enabled else "180"
        return cls(
            azure_speech_key=env.get("AZURE_SPEECH_KEY", ""),
            azure_speech_region=env.get("AZURE_SPEECH_REGION", ""),
            azure_tts_voice=env.get("AZURE_TTS_VOICE", "en-US-JennyNeural"),
            database_url=env.get("DATABASE_URL", "sqlite:///./data/just_talk.db"),
            max_audio_seconds=_int_env(env, "MAX_AUDIO_SECONDS", "30"),
            max_long_audio_seconds=_int_env(env, "MAX_LONG_AUDIO_SECONDS", long_default),
            vocabulary_graduation_score=_float_env(env, "VOCABULARY_GRADUATION_SCORE", "85"),
            vocabulary_graduation_streak=_int_env(env, "VOCABULARY_GRADUATION_STREAK", "2"),
            llm_base_url=env.get("LLM_BASE_URL", ""),
            llm_api_key=env.get("LLM_API_KEY", ""),
            llm_model=env.get("LLM_MODEL", "gpt-4o-mini"),
            cors_origins=cors_origins,
            static_dir=env.get("STATIC_DIR", ""),
            public=public,
        )
