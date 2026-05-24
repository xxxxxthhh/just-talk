import unittest


class AudioPolicyTests(unittest.TestCase):
    def test_rejects_audio_over_configured_limit(self):
        from app.audio import AudioTooLongError, ensure_audio_duration_allowed

        with self.assertRaises(AudioTooLongError) as context:
            ensure_audio_duration_allowed(duration_seconds=30.25, max_seconds=30)

        self.assertIn("30", str(context.exception))

    def test_accepts_audio_at_configured_limit(self):
        from app.audio import ensure_audio_duration_allowed

        ensure_audio_duration_allowed(duration_seconds=30.0, max_seconds=30)


if __name__ == "__main__":
    unittest.main()
