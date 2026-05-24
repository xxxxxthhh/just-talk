import io
import tempfile
import unittest
import wave
from pathlib import Path


def make_wav_bytes() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x00\x00" * 1600)
    return buffer.getvalue()


class FakeScorer:
    def score(self, wav_path: Path, reference_text: str) -> dict:
        self.wav_path = wav_path
        self.reference_text = reference_text
        return {
            "RecognitionStatus": "Success",
            "DisplayText": "Hello.",
            "NBest": [
                {
                    "PronunciationAssessment": {
                        "AccuracyScore": 90,
                        "FluencyScore": 88,
                        "CompletenessScore": 100,
                        "ProsodyScore": 81,
                        "PronScore": 89,
                    },
                    "Words": [],
                }
            ],
        }


class FakeSynthesizer:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        self.text = text
        return b"audio-bytes", "audio/mpeg"


class ApiTests(unittest.TestCase):
    def test_score_endpoint_returns_normalized_result_and_saves_history(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}")
            scorer = FakeScorer()
            app = create_app(
                settings=Settings(
                    database_url=f"sqlite:///{Path(temp_dir) / 'sessions.db'}",
                    max_audio_seconds=30,
                ),
                store=store,
                scorer=scorer,
            )
            client = TestClient(app)

            response = client.post(
                "/api/score",
                data={"reference_text": "Hello."},
                files={"audio": ("sample.wav", make_wav_bytes(), "audio/wav")},
            )
            history = client.get("/api/sessions")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"]["scores"]["pronunciation"], 89.0)
        self.assertEqual(response.json()["session"]["reference_text"], "Hello.")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json()[0]["scores"]["pronunciation"], 89.0)
        self.assertEqual(scorer.reference_text, "Hello.")

    def test_health_reports_missing_azure_config(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app

        app = create_app(settings=Settings())
        client = TestClient(app)

        response = client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["azure_configured"], False)

    def test_word_bank_endpoints_create_list_auto_add_and_delete_words(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}")
            app = create_app(
                settings=Settings(database_url=f"sqlite:///{Path(temp_dir) / 'sessions.db'}"),
                store=store,
            )
            client = TestClient(app)
            session = store.create_session(
                reference_text="Quiet streets quickly.",
                audio_duration_ms=1400,
                normalized_result={
                    "scores": {"pronunciation": 82.0},
                    "words": [
                        {"word": "Quiet", "accuracy": 73.0, "phonemes": []},
                        {"word": "streets", "accuracy": 94.0, "phonemes": []},
                        {"word": "quickly", "accuracy": 82.0, "phonemes": []},
                    ],
                    "raw": {"ok": True},
                },
            )

            empty = client.get("/api/words")
            created = client.post("/api/words", json={"word": "wanted"})
            auto_added = client.post(f"/api/words/from-session/{session['id']}")
            words = client.get("/api/words")
            deleted = client.delete(f"/api/words/{created.json()['id']}")

        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.json(), [])
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["word"], "wanted")
        self.assertEqual(auto_added.status_code, 200)
        self.assertEqual([item["word"] for item in auto_added.json()], ["Quiet", "quickly"])
        self.assertEqual(words.status_code, 200)
        self.assertEqual([item["word"] for item in words.json()], ["Quiet", "quickly", "wanted"])
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["deleted"], True)

    def test_speak_endpoint_returns_base64_audio_from_synthesizer(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app

        synthesizer = FakeSynthesizer()
        app = create_app(settings=Settings(), synthesizer=synthesizer)
        client = TestClient(app)

        response = client.post("/api/speak", json={"text": "quiet"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["audio_base64"], "YXVkaW8tYnl0ZXM=")
        self.assertEqual(response.json()["content_type"], "audio/mpeg")
        self.assertEqual(synthesizer.text, "quiet")

    def test_speak_endpoint_requires_azure_configuration_without_fake(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app

        app = create_app(settings=Settings())
        client = TestClient(app)

        response = client.post("/api/speak", json={"text": "quiet"})

        self.assertEqual(response.status_code, 503)
        self.assertIn("Azure Speech is not configured", response.json()["detail"])

    def test_single_word_score_updates_word_bank_practice_score(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}")
            scorer = FakeScorer()
            app = create_app(
                settings=Settings(
                    database_url=f"sqlite:///{Path(temp_dir) / 'sessions.db'}",
                    max_audio_seconds=30,
                ),
                store=store,
                scorer=scorer,
            )
            client = TestClient(app)
            client.post("/api/words", json={"word": "quiet"})

            response = client.post(
                "/api/score",
                data={"reference_text": "quiet"},
                files={"audio": ("sample.wav", make_wav_bytes(), "audio/wav")},
            )
            words = client.get("/api/words")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(words.json()[0]["word"], "quiet")
        self.assertEqual(words.json()[0]["latest_score"], 90.0)
        self.assertEqual(words.json()[0]["practice_count"], 1)


if __name__ == "__main__":
    unittest.main()
