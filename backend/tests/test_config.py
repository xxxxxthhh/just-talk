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
