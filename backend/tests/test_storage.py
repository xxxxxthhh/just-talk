import tempfile
import unittest
from pathlib import Path


class StorageTests(unittest.TestCase):
    def test_saves_and_lists_practice_sessions(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize()

            created = store.create_session(
                reference_text="Hello world.",
                audio_duration_ms=1200,
                normalized_result={
                    "scores": {"pronunciation": 86.0},
                    "segments": [{"index": 1, "transcript": "Hello world."}],
                    "words": [{"word": "hello"}],
                    "raw": {"ok": True},
                },
            )

            sessions = store.list_sessions()
            loaded = store.get_session(created["id"])

        self.assertEqual(created["reference_text"], "Hello world.")
        self.assertEqual(sessions[0]["id"], created["id"])
        self.assertEqual(loaded["scores"]["pronunciation"], 86.0)
        self.assertEqual(loaded["segments"][0]["transcript"], "Hello world.")
        self.assertEqual(loaded["words"][0]["word"], "hello")

    def test_creates_dedupes_updates_and_deletes_vocabulary_words(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize()

            created = store.create_word(" Quiet ", source="manual")
            duplicate = store.create_word("quiet", source="manual")
            practiced = store.record_word_practice("quiet", latest_score=73.0)
            words_after_practice = store.list_words()
            deleted = store.delete_word(created["id"])
            words_after_delete = store.list_words()

        self.assertEqual(created["id"], duplicate["id"])
        self.assertEqual(created["word"], "Quiet")
        self.assertEqual(practiced["latest_score"], 73.0)
        self.assertEqual(practiced["practice_count"], 1)
        self.assertEqual(words_after_practice[0]["word"], "Quiet")
        self.assertTrue(deleted)
        self.assertEqual(words_after_delete, [])

    def test_creates_vocabulary_words_from_low_scoring_session_words(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize()
            session = store.create_session(
                reference_text="Quiet streets quickly.",
                audio_duration_ms=1400,
                normalized_result={
                    "scores": {"pronunciation": 82.0},
                    "words": [
                        {"word": "Quiet", "accuracy": 73.0, "phonemes": []},
                        {"word": "streets", "accuracy": 94.0, "phonemes": []},
                        {"word": "quickly", "accuracy": 82.0, "phonemes": []},
                        {"word": "quiet", "accuracy": 80.0, "phonemes": []},
                    ],
                    "raw": {"ok": True},
                },
            )

            added = store.create_words_from_session(session["id"], max_score=85.0)
            words = store.list_words()

        self.assertEqual([item["word"] for item in added], ["Quiet", "quickly"])
        self.assertEqual([item["word"] for item in words], ["Quiet", "quickly"])
        self.assertEqual(words[0]["source"], "weak-word")
        self.assertEqual(words[0]["latest_score"], 73.0)

    def test_graduates_word_after_consecutive_successful_practice_scores(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize()
            store.create_word("quiet")

            first_practice = store.record_word_practice("quiet", latest_score=86.0)
            second_practice = store.record_word_practice("quiet", latest_score=90.0)
            active_words = store.list_words(status="active")
            graduated_words = store.list_words(status="graduated")

        self.assertEqual(first_practice["status"], "active")
        self.assertEqual(first_practice["consecutive_successes"], 1)
        self.assertEqual(second_practice["status"], "graduated")
        self.assertEqual(second_practice["consecutive_successes"], 2)
        self.assertIsNotNone(second_practice["graduated_at"])
        self.assertEqual(active_words, [])
        self.assertEqual(graduated_words[0]["word"], "quiet")

    def test_low_scoring_session_word_reactivates_graduated_word(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize()
            store.create_word("Quiet")
            store.record_word_practice("quiet", latest_score=90.0)
            store.record_word_practice("quiet", latest_score=91.0)
            session = store.create_session(
                reference_text="Quiet streets.",
                audio_duration_ms=1400,
                normalized_result={
                    "scores": {"pronunciation": 82.0},
                    "words": [
                        {"word": "Quiet", "accuracy": 73.0, "phonemes": []},
                    ],
                    "raw": {"ok": True},
                },
            )

            added = store.create_words_from_session(session["id"], max_score=85.0)
            active_words = store.list_words(status="active")
            graduated_words = store.list_words(status="graduated")

        self.assertEqual(added[0]["word"], "Quiet")
        self.assertEqual(added[0]["status"], "active")
        self.assertEqual(added[0]["consecutive_successes"], 0)
        self.assertIsNone(added[0]["graduated_at"])
        self.assertEqual(active_words[0]["word"], "Quiet")
        self.assertEqual(graduated_words, [])


if __name__ == "__main__":
    unittest.main()
