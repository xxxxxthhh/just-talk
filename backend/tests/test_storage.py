import tempfile
import unittest
from pathlib import Path


class StorageTests(unittest.TestCase):
    def test_store_closes_sqlite_connections_after_operations(self):
        import sqlite3

        from app.storage import SessionStore

        closed_connections: list[sqlite3.Connection] = []

        class TrackingConnection(sqlite3.Connection):
            def close(self) -> None:
                closed_connections.append(self)
                super().close()

        class TrackingStore(SessionStore):
            def _connect(self) -> sqlite3.Connection:
                connection = sqlite3.connect(self.database_path, factory=TrackingConnection)
                connection.row_factory = sqlite3.Row
                return connection

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = TrackingStore(f"sqlite:///{database_path}")

            store.initialize(seed_builtin_materials=False)
            session = store.create_session(
                reference_text="Hello world.",
                audio_duration_ms=1200,
                normalized_result={
                    "scores": {"pronunciation": 86.0},
                    "words": [],
                    "raw": {"ok": True},
                },
            )
            store.get_session(session["id"])

        self.assertEqual(len(closed_connections), 4)

    def test_saves_and_lists_practice_sessions(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

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
            store.initialize(seed_builtin_materials=False)

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
            store.initialize(seed_builtin_materials=False)
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
            store.initialize(seed_builtin_materials=False)
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
            store.initialize(seed_builtin_materials=False)
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

    def test_imports_material_pack_and_lists_materials_in_pack_order(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            imported = store.import_material_pack({
                "schema_version": 1,
                "pack": {
                    "id": "starter-originals",
                    "title": "Starter Originals",
                    "source": "built-in",
                    "license": "CC0",
                },
                "lessons": [
                    {
                        "id": "starter-1",
                        "title": "Morning Walk",
                        "book": "Starter",
                        "lesson": 1,
                        "text": "The morning air was cool and clear.",
                        "tags": ["short", "starter"],
                    },
                    {
                        "id": "starter-2",
                        "title": "Small Plans",
                        "book": "Starter",
                        "lesson": 2,
                        "text": "We made small plans before lunch.",
                        "tags": ["short"],
                    },
                ],
            })
            materials = store.list_materials()

        self.assertEqual(imported["pack"]["id"], "starter-originals")
        self.assertEqual([item["id"] for item in imported["materials"]], ["starter-1", "starter-2"])
        self.assertEqual([item["id"] for item in materials], ["starter-1", "starter-2"])
        self.assertEqual(materials[0]["pack_title"], "Starter Originals")
        self.assertEqual(materials[0]["source"], "built-in")
        self.assertEqual(materials[0]["license"], "CC0")
        self.assertEqual(materials[0]["tags"], ["short", "starter"])

    def test_reimporting_material_pack_replaces_existing_pack_contents(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            store.import_material_pack({
                "schema_version": 1,
                "pack": {"id": "custom", "title": "Custom Pack"},
                "lessons": [
                    {"id": "old-lesson", "title": "Old", "text": "Old text."},
                    {"id": "shared-lesson", "title": "Shared", "text": "Before."},
                ],
            })
            imported = store.import_material_pack({
                "schema_version": 1,
                "pack": {"id": "custom", "title": "Custom Pack Updated"},
                "lessons": [
                    {"id": "shared-lesson", "title": "Shared Updated", "text": "After."},
                ],
            })
            materials = store.list_materials()

        self.assertEqual(imported["pack"]["title"], "Custom Pack Updated")
        self.assertEqual(len(materials), 1)
        self.assertEqual(materials[0]["id"], "shared-lesson")
        self.assertEqual(materials[0]["title"], "Shared Updated")
        self.assertEqual(materials[0]["text"], "After.")

    def test_deletes_material_group_and_related_speech_cache(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)
            store.import_material_pack({
                "schema_version": 1,
                "pack": {"id": "custom", "title": "Custom Pack"},
                "lessons": [
                    {"id": "book-1-a", "title": "One", "book": "Book 1", "text": "One text."},
                    {"id": "book-1-b", "title": "Two", "book": "Book 1", "text": "Two text."},
                    {"id": "book-2-a", "title": "Three", "book": "Book 2", "text": "Three text."},
                ],
            })
            store.save_speech_cache(
                cache_key="material:book-1-a",
                text_hash="hash",
                voice="voice",
                content_type="audio/mpeg",
                audio_bytes=b"audio",
            )

            deleted = store.delete_material_group(pack_id="custom", book="Book 1")
            materials = store.list_materials()
            cached = store.get_speech_cache(
                cache_key="material:book-1-a",
                text_hash="hash",
                voice="voice",
            )

        self.assertEqual(deleted, 2)
        self.assertEqual([item["id"] for item in materials], ["book-2-a"])
        self.assertIsNone(cached)

    def test_rejects_deleting_builtin_material_group(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize()

            with self.assertRaisesRegex(ValueError, "built-in material groups cannot be deleted"):
                store.delete_material_group(pack_id="just-talk-starter", book="Starter")

    def test_material_pack_import_rejects_empty_lesson_text(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            with self.assertRaisesRegex(ValueError, "lesson text is required"):
                store.import_material_pack({
                    "schema_version": 1,
                    "pack": {"id": "broken", "title": "Broken"},
                    "lessons": [
                        {"id": "empty", "title": "Empty", "text": "   "},
                    ],
                })

    def test_material_pack_import_rejects_lesson_id_from_another_pack(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize()

            with self.assertRaisesRegex(ValueError, "lesson id already exists"):
                store.import_material_pack({
                    "schema_version": 1,
                    "pack": {"id": "custom", "title": "Custom"},
                    "lessons": [
                        {
                            "id": "jt-starter-clear-morning",
                            "title": "Collision",
                            "text": "This id belongs to the built-in starter pack.",
                        },
                    ],
                })

    def test_initialization_seeds_original_builtin_materials(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize()

            materials = store.list_materials()

        self.assertGreaterEqual(len(materials), 3)
        self.assertEqual(materials[0]["pack_id"], "just-talk-starter")
        self.assertEqual(materials[0]["source"], "built-in")
        self.assertEqual(materials[0]["license"], "Just Talk original")


class PhonemeStatsTests(unittest.TestCase):
    def _make_phoneme(self, symbol, accuracy):
        return {"phoneme": symbol, "accuracy": accuracy, "bucket": "good", "offset_ms": 0, "duration_ms": 100, "n_best": []}

    def _make_session(self, store, words):
        return store.create_session(
            reference_text="test",
            audio_duration_ms=1000,
            normalized_result={"scores": {}, "words": words, "raw": {}},
        )

    def _make_word(self, word_text, phonemes):
        return {"word": word_text, "accuracy": 80.0, "bucket": "good", "error_type": "None", "phonemes": phonemes}

    def test_phoneme_stats_empty_database_returns_empty_list(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'db.db'}")
            store.initialize()
            result = store.list_phoneme_stats()
        self.assertEqual(result, [])

    def test_phoneme_stats_aggregates_single_session_phonemes(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'db.db'}")
            store.initialize()
            self._make_session(store, [
                self._make_word("think", [
                    self._make_phoneme("th", 30.0),
                    self._make_phoneme("th", 40.0),
                    self._make_phoneme("th", 50.0),
                ]),
            ])
            result = store.list_phoneme_stats(min_attempts=3)

        self.assertEqual(len(result), 1)
        stat = result[0]
        self.assertEqual(stat["phoneme"], "th")
        self.assertAlmostEqual(stat["average_accuracy"], 40.0)
        self.assertEqual(stat["attempts"], 3)
        self.assertEqual(stat["needs_work_count"], 3)
        self.assertEqual(stat["watch_count"], 0)
        self.assertEqual(stat["good_count"], 0)
        self.assertEqual(stat["bucket"], "needs-work")
        self.assertEqual(len(stat["example_words"]), 1)
        self.assertEqual(stat["example_words"][0]["word"], "think")
        self.assertAlmostEqual(stat["example_words"][0]["accuracy"], 50.0)
        self.assertEqual([item["accuracy"] for item in stat["attempts_history"]], [30.0, 40.0, 50.0])
        self.assertEqual([item["word"] for item in stat["attempts_history"]], ["think", "think", "think"])

    def test_phoneme_stats_aggregates_across_multiple_sessions(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'db.db'}")
            store.initialize()
            self._make_session(store, [self._make_word("think", [self._make_phoneme("th", 40.0)])])
            self._make_session(store, [self._make_word("through", [self._make_phoneme("th", 50.0)])])
            self._make_session(store, [self._make_word("there", [self._make_phoneme("th", 60.0)])])
            result = store.list_phoneme_stats(min_attempts=3)

        self.assertEqual(len(result), 1)
        stat = result[0]
        self.assertEqual(stat["attempts"], 3)
        self.assertAlmostEqual(stat["average_accuracy"], 50.0)
        # last_seen_at should be from the latest session
        self.assertIsNotNone(stat["last_seen_at"])

    def test_phoneme_stats_min_attempts_filter_excludes_under_threshold(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'db.db'}")
            store.initialize()
            # "k" appears 2 times, "p" appears 4 times
            self._make_session(store, [
                self._make_word("kick", [self._make_phoneme("k", 70.0), self._make_phoneme("k", 72.0)]),
                self._make_word("pop", [
                    self._make_phoneme("p", 65.0),
                    self._make_phoneme("p", 67.0),
                    self._make_phoneme("p", 69.0),
                    self._make_phoneme("p", 71.0),
                ]),
            ])

            default_result = store.list_phoneme_stats()  # default min=3
            low_result = store.list_phoneme_stats(min_attempts=2)

        phonemes_default = {r["phoneme"] for r in default_result}
        phonemes_low = {r["phoneme"] for r in low_result}
        self.assertNotIn("k", phonemes_default)
        self.assertIn("p", phonemes_default)
        self.assertIn("k", phonemes_low)
        self.assertIn("p", phonemes_low)

    def test_phoneme_stats_example_words_dedupe_by_word_keep_latest(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'db.db'}")
            store.initialize()
            # "think" appears twice with different scores for phoneme "th" - keep latest (80.0)
            self._make_session(store, [self._make_word("think", [self._make_phoneme("th", 30.0)])])
            self._make_session(store, [self._make_word("think", [self._make_phoneme("th", 80.0)])])
            self._make_session(store, [self._make_word("through", [self._make_phoneme("th", 55.0)])])
            result = store.list_phoneme_stats(min_attempts=3)

        self.assertEqual(len(result), 1)
        stat = result[0]
        # Should dedupe "think" — keep only the latest occurrence (80.0)
        words = {ex["word"].casefold(): ex["accuracy"] for ex in stat["example_words"]}
        self.assertIn("think", words)
        self.assertAlmostEqual(words["think"], 80.0)
        self.assertIn("through", words)
        self.assertEqual(len(stat["example_words"]), 2)

    def test_phoneme_stats_ignores_none_accuracy_and_empty_phoneme(self):
        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(f"sqlite:///{Path(temp_dir) / 'db.db'}")
            store.initialize()
            phonemes_with_noise = [
                {"phoneme": "th", "accuracy": None, "bucket": "unknown", "offset_ms": 0, "duration_ms": 0, "n_best": []},
                {"phoneme": "", "accuracy": 50.0, "bucket": "watch", "offset_ms": 0, "duration_ms": 0, "n_best": []},
                self._make_phoneme("th", 45.0),
                self._make_phoneme("th", 50.0),
                self._make_phoneme("th", 55.0),
            ]
            self._make_session(store, [self._make_word("think", phonemes_with_noise)])
            result = store.list_phoneme_stats(min_attempts=3)

        # Only 3 valid "th" phonemes should be counted (None and "" filtered)
        self.assertEqual(len(result), 1)
        stat = result[0]
        self.assertEqual(stat["attempts"], 3)
        self.assertAlmostEqual(stat["average_accuracy"], 50.0)


if __name__ == "__main__":
    unittest.main()
