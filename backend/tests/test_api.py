import hashlib
import inspect
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

    continuous_warnings: list[str] = []

    def score_continuous(
        self, wav_path: Path, reference_text: str
    ) -> tuple[list[dict], list[str]]:
        self.continuous_wav_path = wav_path
        self.continuous_reference_text = reference_text
        return [
            {
                "RecognitionStatus": "Success",
                "DisplayText": "Quiet streets.",
                "NBest": [
                    {
                        "PronunciationAssessment": {
                            "AccuracyScore": 80,
                            "FluencyScore": 76,
                            "CompletenessScore": 100,
                            "ProsodyScore": 74,
                            "PronScore": 79,
                        },
                        "Words": [
                            {
                                "Word": "quiet",
                                "PronunciationAssessment": {
                                    "AccuracyScore": 72,
                                    "ErrorType": "None",
                                },
                                "Phonemes": [],
                            }
                        ],
                    }
                ],
            },
            {
                "RecognitionStatus": "Success",
                "DisplayText": "We kept walking.",
                "NBest": [
                    {
                        "PronunciationAssessment": {
                            "AccuracyScore": 90,
                            "FluencyScore": 88,
                            "CompletenessScore": 100,
                            "ProsodyScore": 82,
                            "PronScore": 89,
                        },
                        "Words": [],
                    }
                ],
            },
        ], self.continuous_warnings


class FakeSynthesizer:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def synthesize(self, text: str) -> tuple[bytes, str, list[dict]]:
        self.text = text
        self.calls.append(text)
        return b"audio-bytes", "audio/mpeg", [
            {
                "text": text.split()[0],
                "text_offset": 0,
                "word_length": len(text.split()[0]),
                "audio_offset_ms": 0,
                "duration_ms": 320,
            }
        ]


class ApiTests(unittest.TestCase):
    def test_blocking_io_endpoints_are_sync_handlers(self):
        from fastapi.routing import APIRoute

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            app = create_app(
                settings=Settings(
                    database_url=f"sqlite:///{Path(temp_dir) / 'sessions.db'}",
                    llm_base_url="http://example.test",
                    llm_api_key="test-key",
                ),
                store=SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}"),
                scorer=FakeScorer(),
            )

        endpoints = {
            route.path: route.endpoint
            for route in app.routes
            if isinstance(route, APIRoute)
        }
        self.assertFalse(inspect.iscoroutinefunction(endpoints["/api/score"]))
        self.assertFalse(inspect.iscoroutinefunction(endpoints["/api/passage-check"]))

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
        self.assertEqual(response.json()["max_long_audio_seconds"], 180)

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
        self.assertEqual(
            response.json()["word_boundaries"],
            [
                {
                    "text": "quiet",
                    "text_offset": 0,
                    "word_length": 5,
                    "audio_offset_ms": 0,
                    "duration_ms": 320,
                }
            ],
        )
        self.assertEqual(synthesizer.text, "quiet")

    def test_speak_endpoint_reuses_cached_audio_for_material_cache_key(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}")
            synthesizer = FakeSynthesizer()
            app = create_app(
                settings=Settings(database_url=f"sqlite:///{Path(temp_dir) / 'sessions.db'}"),
                store=store,
                synthesizer=synthesizer,
            )
            client = TestClient(app)

            first = client.post(
                "/api/speak",
                json={"text": "Quiet streets.", "cache_key": "material:quiet-streets"},
            )
            second = client.post(
                "/api/speak",
                json={"text": "Quiet streets.", "cache_key": "material:quiet-streets"},
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(synthesizer.calls, ["Quiet streets."])

    def test_speak_endpoint_refreshes_cached_audio_without_word_boundaries(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_url = f"sqlite:///{Path(temp_dir) / 'sessions.db'}"
            store = SessionStore(database_url)
            text = "Quiet streets."
            store.initialize()
            store.save_speech_cache(
                cache_key="material:quiet-streets",
                text_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                voice=Settings().azure_tts_voice,
                content_type="audio/mpeg",
                audio_bytes=b"stale-audio",
                word_boundaries=[],
            )
            synthesizer = FakeSynthesizer()
            app = create_app(
                settings=Settings(database_url=database_url),
                store=store,
                synthesizer=synthesizer,
            )
            client = TestClient(app)

            response = client.post(
                "/api/speak",
                json={"text": text, "cache_key": "material:quiet-streets"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["audio_base64"], "YXVkaW8tYnl0ZXM=")
        self.assertEqual(response.json()["word_boundaries"][0]["text"], "Quiet")
        self.assertEqual(synthesizer.calls, [text])

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

    def test_single_word_practice_graduates_word_and_status_filter_separates_it(self):
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

            first = client.post(
                "/api/score",
                data={"reference_text": "quiet"},
                files={"audio": ("sample.wav", make_wav_bytes(), "audio/wav")},
            )
            second = client.post(
                "/api/score",
                data={"reference_text": "quiet"},
                files={"audio": ("sample.wav", make_wav_bytes(), "audio/wav")},
            )
            active_words = client.get("/api/words?status=active")
            graduated_words = client.get("/api/words?status=graduated")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(active_words.status_code, 200)
        self.assertEqual(active_words.json(), [])
        self.assertEqual(graduated_words.status_code, 200)
        self.assertEqual(graduated_words.json()[0]["word"], "quiet")
        self.assertEqual(graduated_words.json()[0]["status"], "graduated")
        self.assertEqual(graduated_words.json()[0]["consecutive_successes"], 2)

    def test_score_endpoint_long_mode_uses_continuous_scorer_and_saves_segmented_result(self):
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
                    max_long_audio_seconds=180,
                ),
                store=store,
                scorer=scorer,
            )
            client = TestClient(app)

            response = client.post(
                "/api/score",
                data={
                    "reference_text": "Quiet streets. We kept walking.",
                    "mode": "long",
                },
                files={"audio": ("sample.wav", make_wav_bytes(), "audio/wav")},
            )
            history = client.get("/api/sessions")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"]["transcript"], "Quiet streets. We kept walking.")
        self.assertEqual(response.json()["result"]["scores"]["pronunciation"], 84.0)
        self.assertEqual(response.json()["result"]["segments"][0]["transcript"], "Quiet streets.")
        self.assertEqual(response.json()["result"]["words"][0]["word"], "quiet")
        self.assertEqual(response.json()["session"]["reference_text"], "Quiet streets. We kept walking.")
        self.assertEqual(response.json()["session"]["segments"][0]["transcript"], "Quiet streets.")
        self.assertEqual(history.json()[0]["scores"]["pronunciation"], 84.0)
        self.assertEqual(scorer.continuous_reference_text, "Quiet streets. We kept walking.")

    def test_score_endpoint_long_mode_surfaces_scoring_warnings(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}")
            scorer = FakeScorer()
            scorer.continuous_warnings = [
                "Azure Speech stopped early, so the score may be incomplete."
            ]
            app = create_app(
                settings=Settings(database_url=f"sqlite:///{Path(temp_dir) / 'sessions.db'}"),
                store=store,
                scorer=scorer,
            )
            client = TestClient(app)

            response = client.post(
                "/api/score",
                data={
                    "reference_text": "Quiet streets. We kept walking.",
                    "mode": "long",
                },
                files={"audio": ("sample.wav", make_wav_bytes(), "audio/wav")},
            )
            session_id = response.json()["session"]["id"]
            reloaded = client.get(f"/api/sessions/{session_id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["result"]["warnings"],
            ["Azure Speech stopped early, so the score may be incomplete."],
        )
        self.assertEqual(
            reloaded.json()["warnings"],
            ["Azure Speech stopped early, so the score may be incomplete."],
        )

    def test_passage_check_endpoint_maps_runtime_error_to_502(self):
        from unittest import mock

        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            app = create_app(
                settings=Settings(
                    database_url=f"sqlite:///{Path(temp_dir) / 'sessions.db'}",
                    llm_base_url="http://example.test",
                    llm_api_key="test-key",
                ),
                store=SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}"),
            )
            client = TestClient(app)

            with mock.patch(
                "app.main.check_passage",
                side_effect=RuntimeError("Passage check returned an invalid response."),
            ):
                response = client.post("/api/passage-check", data={"text": "Hello."})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json()["detail"],
            "Passage check returned an invalid response.",
        )

    def test_material_endpoints_import_and_list_materials(self):
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

            initial = client.get("/api/materials")
            imported = client.post(
                "/api/material-packs/import",
                json={
                    "schema_version": 1,
                    "pack": {
                        "id": "custom-pack",
                        "title": "Custom Pack",
                        "source": "user-imported",
                        "license": "user-provided",
                    },
                    "lessons": [
                        {
                            "id": "custom-1",
                            "title": "Clear Morning",
                            "book": "Custom",
                            "lesson": 1,
                            "text": "A clear morning is a good time to practice.",
                            "tags": ["custom", "short"],
                        }
                    ],
                },
            )
            materials = client.get("/api/materials")

        self.assertEqual(initial.status_code, 200)
        self.assertTrue(any(item["pack_id"] == "just-talk-starter" for item in initial.json()))
        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.json()["pack"]["id"], "custom-pack")
        self.assertEqual(imported.json()["materials"][0]["id"], "custom-1")
        self.assertEqual(materials.status_code, 200)
        custom_material = next(item for item in materials.json() if item["id"] == "custom-1")
        self.assertEqual(custom_material["title"], "Clear Morning")
        self.assertEqual(custom_material["pack_title"], "Custom Pack")

    def test_material_import_endpoint_returns_400_for_invalid_pack(self):
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

            response = client.post(
                "/api/material-packs/import",
                json={
                    "schema_version": 1,
                    "pack": {"id": "broken", "title": "Broken"},
                    "lessons": [{"id": "empty", "title": "Empty", "text": " "}],
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("lesson text is required", response.json()["detail"])

    def test_material_group_delete_endpoint_removes_matching_lessons(self):
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
            client.post(
                "/api/material-packs/import",
                json={
                    "schema_version": 1,
                    "pack": {"id": "custom-pack", "title": "Custom Pack"},
                    "lessons": [
                        {"id": "custom-1", "title": "One", "book": "Book 1", "text": "One text."},
                        {"id": "custom-2", "title": "Two", "book": "Book 1", "text": "Two text."},
                        {"id": "custom-3", "title": "Three", "book": "Book 2", "text": "Three text."},
                    ],
                },
            )

            deleted = client.delete(
                "/api/material-groups",
                params={"pack_id": "custom-pack", "book": "Book 1"},
            )
            materials = client.get("/api/materials")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"deleted": 2})
        self.assertEqual(
            [item["id"] for item in materials.json() if item["pack_id"] == "custom-pack"],
            ["custom-3"],
        )


class PhonemeStatsApiTests(unittest.TestCase):
    def test_phoneme_stats_endpoint_returns_aggregated_and_sorted_data(self):
        from fastapi.testclient import TestClient

        from app.config import Settings
        from app.main import create_app
        from app.storage import SessionStore

        def make_phoneme(symbol, accuracy):
            return {"phoneme": symbol, "accuracy": accuracy, "bucket": "good", "offset_ms": 0, "duration_ms": 100, "n_best": []}

        def make_word(word_text, phonemes):
            return {"word": word_text, "accuracy": 70.0, "bucket": "watch", "error_type": "None", "phonemes": phonemes}

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}")
            store.initialize()
            # "th" at ~40 avg, "r" at ~75 avg — 3+ each
            for _ in range(3):
                store.create_session(
                    reference_text="think",
                    audio_duration_ms=1000,
                    normalized_result={
                        "scores": {},
                        "words": [make_word("think", [make_phoneme("th", 40.0)])],
                        "raw": {},
                    },
                )
                store.create_session(
                    reference_text="right",
                    audio_duration_ms=1000,
                    normalized_result={
                        "scores": {},
                        "words": [make_word("right", [make_phoneme("r", 75.0)])],
                        "raw": {},
                    },
                )

            app = create_app(
                settings=Settings(database_url=f"sqlite:///{Path(temp_dir) / 'sessions.db'}"),
                store=store,
            )
            client = TestClient(app)

            response_default = client.get("/api/phoneme-stats")
            response_filter = client.get("/api/phoneme-stats?min_attempts=10")

        self.assertEqual(response_default.status_code, 200)
        data = response_default.json()
        self.assertIsInstance(data, list)
        # Sorted ascending by average_accuracy — "th" (40) before "r" (75)
        phonemes = [item["phoneme"] for item in data]
        self.assertIn("th", phonemes)
        self.assertIn("r", phonemes)
        self.assertLess(phonemes.index("th"), phonemes.index("r"))
        for item in data:
            self.assertIn("phoneme", item)
            self.assertIn("average_accuracy", item)
            self.assertIn("attempts", item)
            self.assertIn("bucket", item)
            self.assertIn("example_words", item)

        # min_attempts=10 should return empty (only 3 of each)
        self.assertEqual(response_filter.json(), [])


if __name__ == "__main__":
    unittest.main()
