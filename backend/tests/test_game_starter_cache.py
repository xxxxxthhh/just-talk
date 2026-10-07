import json
import tempfile
import unittest
from pathlib import Path

STARTER_PACK_JSON = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "game" / "starterPack.json"
)
ORIGIN = "http://testserver"


class FakeSynthesizer:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def synthesize(self, text: str) -> tuple[bytes, str, list[dict]]:
        self.calls.append(text)
        # The cache-hit check requires word boundaries when a synthesizer is set.
        first = text.split()[0]
        return b"audio-bytes", "audio/mpeg", [
            {
                "text": first,
                "text_offset": 0,
                "word_length": len(first),
                "audio_offset_ms": 0,
                "duration_ms": 320,
            }
        ]


class GameStarterCacheTests(unittest.TestCase):
    def _public_app(self, data_dir: str, synthesizer: FakeSynthesizer):
        from app.config import PublicSettings, Settings
        from app.main import create_app

        return create_app(
            settings=Settings(
                public=PublicSettings(
                    enabled=True,
                    data_dir=data_dir,
                    allowed_origins=(ORIGIN,),
                    cookie_secure=False,
                )
            ),
            synthesizer=synthesizer,
        )

    def _visitor(self, app):
        from fastapi.testclient import TestClient

        client = TestClient(app, headers={"Origin": ORIGIN})
        response = client.post("/api/visitor")
        self.assertEqual(response.status_code, 201)
        return client

    def test_starter_texts_match_frontend_and_share_cache_between_visitors(self):
        from app.main import BUILTIN_TEXTS, GAME_STARTER_TEXTS

        items = json.loads(STARTER_PACK_JSON.read_text(encoding="utf-8"))
        frontend_texts = [item["text"] for item in items]
        self.assertEqual(len(frontend_texts), 30)
        self.assertEqual(set(frontend_texts), GAME_STARTER_TEXTS)
        self.assertTrue(GAME_STARTER_TEXTS <= BUILTIN_TEXTS)

        synthesizer = FakeSynthesizer()
        with tempfile.TemporaryDirectory() as temp_dir:
            app = self._public_app(temp_dir, synthesizer)
            first = self._visitor(app)
            second = self._visitor(app)
            for client in (first, second):
                for text in ("think", "I think we can walk home now."):
                    response = client.post("/api/speak", json={"text": text})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["word_boundaries"][0]["duration_ms"], 320)

        self.assertEqual(synthesizer.calls, ["think", "I think we can walk home now."])

    def test_custom_text_remains_in_visitor_cache(self):
        synthesizer = FakeSynthesizer()
        with tempfile.TemporaryDirectory() as temp_dir:
            app = self._public_app(temp_dir, synthesizer)
            first = self._visitor(app)
            second = self._visitor(app)
            for client in (first, second, first):
                response = client.post("/api/speak", json={"text": "thinking about it"})
                self.assertEqual(response.status_code, 200)

        # The second visitor cannot reuse the first visitor's audio; a repeat by
        # the first visitor hits their own cache.
        self.assertEqual(synthesizer.calls, ["thinking about it", "thinking about it"])


if __name__ == "__main__":
    unittest.main()
