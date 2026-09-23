import unittest
from unittest import mock

from app.config import Settings


class SettingsFromEnvTests(unittest.TestCase):
    def test_invalid_integer_value_names_the_variable(self):
        with mock.patch.dict("os.environ", {"MAX_AUDIO_SECONDS": "abc"}):
            with self.assertRaises(ValueError) as context:
                Settings.from_env()

        self.assertIn("MAX_AUDIO_SECONDS", str(context.exception))
        self.assertIn("abc", str(context.exception))

    def test_invalid_float_value_names_the_variable(self):
        with mock.patch.dict("os.environ", {"VOCABULARY_GRADUATION_SCORE": "high"}):
            with self.assertRaises(ValueError) as context:
                Settings.from_env()

        self.assertIn("VOCABULARY_GRADUATION_SCORE", str(context.exception))

    def test_valid_numeric_values_parse(self):
        with mock.patch.dict(
            "os.environ",
            {"MAX_AUDIO_SECONDS": "45", "VOCABULARY_GRADUATION_SCORE": "90.5"},
        ):
            settings = Settings.from_env()

        self.assertEqual(settings.max_audio_seconds, 45)
        self.assertEqual(settings.vocabulary_graduation_score, 90.5)

    def test_cors_origins_default(self):
        with mock.patch("app.config._env_with_dotenv", return_value={}):
            settings = Settings.from_env()

        self.assertEqual(
            settings.cors_origins,
            (
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "capacitor://localhost",
            ),
        )

    def test_cors_origins_parse_comma_separated_values(self):
        with mock.patch(
            "app.config._env_with_dotenv",
            return_value={"CORS_ORIGINS": "https://one.example,https://two.example"},
        ):
            settings = Settings.from_env()

        self.assertEqual(
            settings.cors_origins,
            ("https://one.example", "https://two.example"),
        )

    def test_cors_origins_strip_whitespace(self):
        with mock.patch(
            "app.config._env_with_dotenv",
            return_value={"CORS_ORIGINS": "  https://one.example , https://two.example  "},
        ):
            settings = Settings.from_env()

        self.assertEqual(
            settings.cors_origins,
            ("https://one.example", "https://two.example"),
        )

    def test_cors_origins_ignore_empty_items(self):
        with mock.patch(
            "app.config._env_with_dotenv",
            return_value={"CORS_ORIGINS": ",https://one.example,, ,https://two.example,"},
        ):
            settings = Settings.from_env()

        self.assertEqual(
            settings.cors_origins,
            ("https://one.example", "https://two.example"),
        )
