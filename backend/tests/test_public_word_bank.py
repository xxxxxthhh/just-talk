import io
import tempfile
import unittest
import wave
from pathlib import Path

ORIGIN = "http://testserver"


def _wav_bytes() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        # One second: public mode refuses very short recordings before scoring.
        wav_file.writeframes(b"\x00\x00" * 16000)
    return buffer.getvalue()


class FakeScorer:
    """Scores every reference as one recognized word at a fixed accuracy."""

    def __init__(self, accuracy: float = 40) -> None:
        self.accuracy = accuracy
        self.references: list[str] = []

    def score(self, wav_path: Path, reference_text: str) -> dict:
        self.references.append(reference_text)
        return {
            "RecognitionStatus": "Success",
            "DisplayText": reference_text,
            "NBest": [
                {
                    "PronunciationAssessment": {
                        "AccuracyScore": self.accuracy,
                        "FluencyScore": 80,
                        "CompletenessScore": 100,
                        "PronScore": 70,
                    },
                    "Words": [
                        {
                            "Word": reference_text,
                            "PronunciationAssessment": {
                                "AccuracyScore": self.accuracy,
                                "ErrorType": "None",
                            },
                            "Phonemes": [],
                        }
                    ],
                }
            ],
        }


class PublicWordBankTests(unittest.TestCase):
    """Existing public-mode behavior that My words relies on: a full word bank still scores, and
    only known words keep their spaced-review history. These pin current backend behavior."""

    def _public_app(self, data_dir: str, scorer: FakeScorer):
        from app.config import PublicSettings, Settings
        from app.main import create_app

        return create_app(
            settings=Settings(
                max_audio_seconds=30,
                public=PublicSettings(
                    enabled=True,
                    data_dir=data_dir,
                    allowed_origins=(ORIGIN,),
                    cookie_secure=False,
                    max_words=1,
                ),
            ),
            scorer=scorer,
        )

    def _visitor(self, app):
        from fastapi.testclient import TestClient

        client = TestClient(app, headers={"Origin": ORIGIN})
        response = client.post("/api/visitor")
        self.assertEqual(response.status_code, 201)
        return client

    def _score(self, client, reference: str):
        return client.post(
            "/api/score",
            data={"reference_text": reference},
            files={"audio": ("sample.wav", _wav_bytes(), "audio/wav")},
        )

    def test_full_bank_known_word_still_updates_srs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            client = self._visitor(self._public_app(temp_dir, FakeScorer(accuracy=40)))
            self.assertEqual(client.post("/api/words", json={"word": "quiet"}).status_code, 200)

            response = self._score(client, "quiet")
            words = client.get("/api/words").json()

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()["session"])
        self.assertEqual(len(words), 1)
        self.assertEqual(words[0]["word"], "quiet")
        self.assertEqual(words[0]["practice_count"], 1)
        self.assertEqual(words[0]["latest_score"], 40.0)
        # A score at or below the graduation score makes the word due again.
        self.assertEqual(words[0]["interval_days"], 0)
        self.assertIsNotNone(words[0]["due_at"])

    def test_full_bank_unknown_word_scores_without_insertion(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            scorer = FakeScorer(accuracy=40)
            client = self._visitor(self._public_app(temp_dir, scorer))
            self.assertEqual(client.post("/api/words", json={"word": "quiet"}).status_code, 200)

            response = self._score(client, "window")
            words = client.get("/api/words").json()

        # The score and its session still count; the new word is simply not saved.
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"]["scores"]["accuracy"], 40)
        self.assertIsNotNone(response.json()["session"])
        self.assertEqual(scorer.references, ["window"])
        self.assertEqual([item["word"] for item in words], ["quiet"])
        self.assertEqual(words[0]["practice_count"], 0)

    def test_positive_capacity_unknown_word_is_added(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            client = self._visitor(self._public_app(temp_dir, FakeScorer(accuracy=40)))

            response = self._score(client, "window")
            words = client.get("/api/words").json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual([(item["word"], item["practice_count"]) for item in words], [("window", 1)])


if __name__ == "__main__":
    unittest.main()
