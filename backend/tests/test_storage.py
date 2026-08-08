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

    def test_create_word_survives_a_row_already_inserted_by_a_concurrent_caller(self):
        # Simulates the race create_word used to lose: another connection
        # already inserted the row (e.g. a concurrent request) by the time
        # this call's INSERT runs. The ON CONFLICT DO NOTHING path must not
        # raise sqlite3.IntegrityError, and should return the existing row.
        import sqlite3

        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)
            with sqlite3.connect(database_path) as raw_connection:
                raw_connection.execute(
                    """
                    INSERT INTO vocabulary_items (
                        id, word, normalized_word, source, notes,
                        latest_score, practice_count, last_practiced_at,
                        status, consecutive_successes, graduated_at,
                        created_at, updated_at
                    )
                    VALUES ('existing-id', 'Quiet', 'quiet', 'manual', '',
                            NULL, 0, NULL, 'active', 0, NULL,
                            '2024-01-01T00:00:00+00:00', '2024-01-01T00:00:00+00:00')
                    """
                )

            created = store.create_word("quiet", source="weak-word")

        self.assertEqual(created["id"], "existing-id")
        self.assertEqual(created["source"], "manual")

    def test_record_word_practice_survives_a_row_already_inserted_by_a_concurrent_caller(self):
        import sqlite3

        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)
            with sqlite3.connect(database_path) as raw_connection:
                raw_connection.execute(
                    """
                    INSERT INTO vocabulary_items (
                        id, word, normalized_word, source, notes,
                        latest_score, practice_count, last_practiced_at,
                        status, consecutive_successes, graduated_at,
                        created_at, updated_at
                    )
                    VALUES ('existing-id', 'Quiet', 'quiet', 'manual', '',
                            NULL, 0, NULL, 'active', 0, NULL,
                            '2024-01-01T00:00:00+00:00', '2024-01-01T00:00:00+00:00')
                    """
                )

            practiced = store.record_word_practice("quiet", latest_score=73.0)

        self.assertEqual(practiced["id"], "existing-id")
        self.assertEqual(practiced["source"], "manual")
        self.assertEqual(practiced["latest_score"], 73.0)
        self.assertEqual(practiced["practice_count"], 1)

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

    def test_speech_cache_keeps_both_voices_and_cascade_clears_both(self):
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
                ],
            })
            store.save_speech_cache(
                cache_key="material:book-1-a",
                text_hash="hash",
                voice="en-US-JennyNeural",
                content_type="audio/mpeg",
                audio_bytes=b"jenny-audio",
            )
            store.save_speech_cache(
                cache_key="material:book-1-a",
                text_hash="hash",
                voice="en-US-GuyNeural",
                content_type="audio/mpeg",
                audio_bytes=b"guy-audio",
            )

            jenny = store.get_speech_cache(
                cache_key="material:book-1-a", text_hash="hash", voice="en-US-JennyNeural"
            )
            guy = store.get_speech_cache(
                cache_key="material:book-1-a", text_hash="hash", voice="en-US-GuyNeural"
            )

            deleted = store.delete_material_group(pack_id="custom", book="Book 1")

            jenny_after = store.get_speech_cache(
                cache_key="material:book-1-a", text_hash="hash", voice="en-US-JennyNeural"
            )
            guy_after = store.get_speech_cache(
                cache_key="material:book-1-a", text_hash="hash", voice="en-US-GuyNeural"
            )

        self.assertEqual(jenny["audio_bytes"], b"jenny-audio")
        self.assertEqual(guy["audio_bytes"], b"guy-audio")
        self.assertEqual(deleted, 1)
        self.assertIsNone(jenny_after)
        self.assertIsNone(guy_after)

    def test_save_speech_cache_evicts_oldest_entries_beyond_cap(self):
        import sqlite3

        from app.storage import MAX_SPEECH_CACHE_ENTRIES, SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            for index in range(MAX_SPEECH_CACHE_ENTRIES + 5):
                store.save_speech_cache(
                    cache_key=f"material:item-{index}",
                    text_hash="hash",
                    voice="en-US-JennyNeural",
                    content_type="audio/mpeg",
                    audio_bytes=b"audio",
                )

            with sqlite3.connect(database_path) as connection:
                count = connection.execute("SELECT COUNT(*) FROM speech_cache").fetchone()[0]

            newest = store.get_speech_cache(
                cache_key=f"material:item-{MAX_SPEECH_CACHE_ENTRIES + 4}",
                text_hash="hash",
                voice="en-US-JennyNeural",
            )
            oldest = store.get_speech_cache(
                cache_key="material:item-0", text_hash="hash", voice="en-US-JennyNeural"
            )

        self.assertEqual(count, MAX_SPEECH_CACHE_ENTRIES)
        self.assertIsNotNone(newest)
        self.assertIsNone(oldest)

    def test_get_speech_cache_read_bumps_recency_and_protects_from_eviction(self):
        from app.storage import MAX_SPEECH_CACHE_ENTRIES, SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            for index in range(MAX_SPEECH_CACHE_ENTRIES):
                store.save_speech_cache(
                    cache_key=f"material:item-{index}",
                    text_hash="hash",
                    voice="en-US-JennyNeural",
                    content_type="audio/mpeg",
                    audio_bytes=b"audio",
                )

            # Reading the oldest entry should mark it as recently used, so a
            # plain FIFO eviction would wrongly drop it; a true LRU keeps it.
            store.get_speech_cache(
                cache_key="material:item-0", text_hash="hash", voice="en-US-JennyNeural"
            )
            store.save_speech_cache(
                cache_key="material:item-new",
                text_hash="hash",
                voice="en-US-JennyNeural",
                content_type="audio/mpeg",
                audio_bytes=b"audio",
            )

            item_0 = store.get_speech_cache(
                cache_key="material:item-0", text_hash="hash", voice="en-US-JennyNeural"
            )
            item_1 = store.get_speech_cache(
                cache_key="material:item-1", text_hash="hash", voice="en-US-JennyNeural"
            )

        self.assertIsNotNone(item_0)
        self.assertIsNone(item_1)

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

    def test_export_data_returns_seeded_rows_without_blob_fields(self):
        import json

        from app.storage import SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "sessions.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)
            store.create_session(
                reference_text="Hello world.",
                audio_duration_ms=1200,
                normalized_result={
                    "scores": {"pronunciation": 86.0},
                    "words": [{"word": "hello"}],
                    "raw": {"ok": True},
                },
            )
            store.create_word("quiet")
            store.import_material_pack({
                "schema_version": 1,
                "pack": {"id": "custom", "title": "Custom Pack"},
                "lessons": [
                    {"id": "custom-1", "title": "One", "text": "One text."},
                ],
            })
            store.save_speech_cache(
                cache_key="material:custom-1",
                text_hash="hash",
                voice="voice",
                content_type="audio/mpeg",
                audio_bytes=b"binary-audio",
            )

            export = store.export_data()

        self.assertEqual(set(export.keys()), {
            "schema_version", "exported_at", "sessions", "vocabulary", "materials",
        })
        self.assertEqual(export["schema_version"], 1)
        self.assertEqual(export["sessions"][0]["reference_text"], "Hello world.")
        self.assertEqual(export["vocabulary"][0]["word"], "quiet")
        self.assertEqual(export["materials"][0]["id"], "custom-1")
        # No speech_cache table (and thus no audio_bytes blob) is exported.
        self.assertNotIn("binary-audio", json.dumps(export))


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


class SpacedRepetitionTests(unittest.TestCase):
    def _store(self, temp_dir: str):
        from app.storage import SessionStore

        store = SessionStore(f"sqlite:///{Path(temp_dir) / 'db.db'}")
        store.initialize(seed_builtin_materials=False)
        return store

    def test_new_words_have_no_schedule_and_count_as_due(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self._store(temp_dir)
            created = store.create_word("quiet")

        self.assertEqual(created["interval_days"], 0)
        self.assertIsNone(created["due_at"])

    def test_successful_drills_double_the_review_interval(self):
        from datetime import UTC, datetime

        with tempfile.TemporaryDirectory() as temp_dir:
            store = self._store(temp_dir)
            store.create_word("quiet")
            first = store.record_word_practice(
                "quiet", latest_score=92.0, graduation_streak=5
            )
            second = store.record_word_practice(
                "quiet", latest_score=93.0, graduation_streak=5
            )

        self.assertEqual(first["interval_days"], 1)
        self.assertEqual(second["interval_days"], 2)
        due_at = datetime.fromisoformat(second["due_at"])
        days_until_due = (due_at - datetime.now(UTC)).total_seconds() / 86400
        self.assertGreater(days_until_due, 1.9)
        self.assertLess(days_until_due, 2.1)

    def test_review_interval_is_capped(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self._store(temp_dir)
            store.create_word("quiet")
            item = None
            for _ in range(10):
                item = store.record_word_practice(
                    "quiet", latest_score=95.0, graduation_streak=99
                )

        from app.storage import MAX_REVIEW_INTERVAL_DAYS

        self.assertEqual(item["interval_days"], MAX_REVIEW_INTERVAL_DAYS)

    def test_failed_drill_resets_schedule_to_due_now(self):
        from datetime import UTC, datetime

        with tempfile.TemporaryDirectory() as temp_dir:
            store = self._store(temp_dir)
            store.create_word("quiet")
            store.record_word_practice("quiet", latest_score=92.0, graduation_streak=5)
            failed = store.record_word_practice(
                "quiet", latest_score=60.0, graduation_streak=5
            )

        self.assertEqual(failed["interval_days"], 0)
        due_at = datetime.fromisoformat(failed["due_at"])
        self.assertLessEqual(due_at, datetime.now(UTC))

    def test_low_passage_score_makes_scheduled_word_due_immediately(self):
        from datetime import UTC, datetime

        with tempfile.TemporaryDirectory() as temp_dir:
            store = self._store(temp_dir)
            store.create_word("quiet")
            store.record_word_practice("quiet", latest_score=92.0, graduation_streak=5)
            # A weak result from a passage review (increment=False).
            flagged = store.record_word_practice(
                "quiet", latest_score=58.0, increment=False, graduation_streak=5
            )

        self.assertEqual(flagged["interval_days"], 0)
        due_at = datetime.fromisoformat(flagged["due_at"])
        self.assertLessEqual(due_at, datetime.now(UTC))

    def test_successful_passage_result_does_not_reschedule(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self._store(temp_dir)
            store.create_word("quiet")
            drilled = store.record_word_practice(
                "quiet", latest_score=92.0, graduation_streak=5
            )
            passage = store.record_word_practice(
                "quiet", latest_score=96.0, increment=False, graduation_streak=5
            )

        self.assertEqual(passage["interval_days"], drilled["interval_days"])
        self.assertEqual(passage["due_at"], drilled["due_at"])


class MigrationTests(unittest.TestCase):
    def _user_version(self, database_path: Path) -> int:
        import sqlite3

        with sqlite3.connect(database_path) as connection:
            return connection.execute("PRAGMA user_version").fetchone()[0]

    def test_initialize_stamps_latest_schema_version(self):
        from app.storage import MIGRATIONS, SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "db.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            self.assertEqual(self._user_version(database_path), len(MIGRATIONS))

    def test_initialize_is_idempotent(self):
        from app.storage import MIGRATIONS, SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "db.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)
            store.initialize(seed_builtin_materials=False)

            self.assertEqual(self._user_version(database_path), len(MIGRATIONS))

    def test_initialize_upgrades_pre_versioning_database(self):
        import sqlite3

        from app.storage import MIGRATIONS, SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "db.db"
            # A database created before versioning: tables exist but
            # user_version is 0 and newer columns are missing.
            with sqlite3.connect(database_path) as connection:
                connection.execute(
                    """
                    CREATE TABLE vocabulary_items (
                        id TEXT PRIMARY KEY,
                        word TEXT NOT NULL,
                        normalized_word TEXT NOT NULL UNIQUE,
                        source TEXT NOT NULL,
                        notes TEXT NOT NULL,
                        latest_score REAL,
                        practice_count INTEGER NOT NULL,
                        last_practiced_at TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )

            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            with sqlite3.connect(database_path) as connection:
                columns = {
                    row[1]
                    for row in connection.execute(
                        "PRAGMA table_info(vocabulary_items)"
                    ).fetchall()
                }
            self.assertIn("status", columns)
            self.assertIn("consecutive_successes", columns)
            self.assertIn("graduated_at", columns)
            self.assertEqual(self._user_version(database_path), len(MIGRATIONS))

    def test_speech_cache_migration_preserves_existing_cached_audio(self):
        import sqlite3

        from app.storage import MIGRATIONS, SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "db.db"
            # Simulate a DB on the pre-voice-identity schema (cache_key-only
            # primary key, with the now-dead text/voice index) that already
            # holds a real cached row, stamped just before the two speech_cache
            # migrations this release adds.
            with sqlite3.connect(database_path) as connection:
                connection.execute(
                    """
                    CREATE TABLE speech_cache (
                        cache_key TEXT PRIMARY KEY,
                        text_hash TEXT NOT NULL,
                        voice TEXT NOT NULL,
                        content_type TEXT NOT NULL,
                        audio_bytes BLOB NOT NULL,
                        word_boundaries_json TEXT NOT NULL DEFAULT '[]',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    CREATE INDEX idx_speech_cache_text_voice
                    ON speech_cache (text_hash, voice)
                    """
                )
                connection.execute(
                    """
                    INSERT INTO speech_cache (
                        cache_key, text_hash, voice, content_type, audio_bytes,
                        word_boundaries_json, created_at, updated_at
                    )
                    VALUES ('material:quiet', 'hash', 'en-US-JennyNeural', 'audio/mpeg',
                            ?, '[]', '2024-01-01T00:00:00+00:00', '2024-01-01T00:00:00+00:00')
                    """,
                    (b"pre-existing-audio",),
                )
                connection.execute(f"PRAGMA user_version = {len(MIGRATIONS) - 2}")

            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            cached = store.get_speech_cache(
                cache_key="material:quiet", text_hash="hash", voice="en-US-JennyNeural"
            )
            with sqlite3.connect(database_path) as connection:
                indexes = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'index'"
                    ).fetchall()
                }
            version = self._user_version(database_path)

        self.assertIsNotNone(cached)
        self.assertEqual(cached["audio_bytes"], b"pre-existing-audio")
        self.assertNotIn("idx_speech_cache_text_voice", indexes)
        self.assertEqual(version, len(MIGRATIONS))

    def test_initialize_only_runs_pending_migrations(self):
        from unittest import mock

        from app.storage import MIGRATIONS, SessionStore

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "db.db"
            store = SessionStore(f"sqlite:///{database_path}")
            store.initialize(seed_builtin_materials=False)

            extra_migration = mock.Mock()
            with mock.patch(
                "app.storage.MIGRATIONS", [*MIGRATIONS, extra_migration]
            ):
                store.initialize(seed_builtin_materials=False)

            extra_migration.assert_called_once()
            self.assertEqual(self._user_version(database_path), len(MIGRATIONS) + 1)


class DrillMaterialTests(unittest.TestCase):
    def _store(self, temp_dir: str):
        from app.storage import SessionStore

        store = SessionStore(f"sqlite:///{Path(temp_dir) / 'sessions.db'}")
        store.initialize(seed_builtin_materials=False)
        return store

    def test_save_drill_material_creates_pack_and_returns_material_shape(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self._store(temp_dir)

            material = store.save_drill_material(
                phoneme="θ",
                title="Thirty Thankful Thinkers",
                passage="Think about three things.",
                focus_words=["think", "three", "things"],
            )

            self.assertEqual(material["pack_id"], "phoneme-drills")
            self.assertEqual(material["pack_title"], "Phoneme Drills")
            self.assertEqual(material["title"], "Thirty Thankful Thinkers")
            self.assertEqual(material["text"], "Think about three things.")
            self.assertEqual(material["book"], "/θ/")
            self.assertEqual(material["tags"], ["think", "three", "things"])

            listed = store.list_materials()
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0], material)

    def test_save_drill_material_appends_and_group_delete_removes_one_phoneme(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = self._store(temp_dir)

            first = store.save_drill_material(
                phoneme="θ", title="First", passage="One.", focus_words=[]
            )
            second = store.save_drill_material(
                phoneme="θ", title="Second", passage="Two.", focus_words=[]
            )
            store.save_drill_material(
                phoneme="ɪ", title="Vowel", passage="Three.", focus_words=[]
            )

            self.assertNotEqual(first["id"], second["id"])
            self.assertEqual(len(store.list_materials()), 3)

            deleted = store.delete_material_group(pack_id="phoneme-drills", book="/θ/")
            self.assertEqual(deleted, 2)
            remaining = store.list_materials()
            self.assertEqual(len(remaining), 1)
            self.assertEqual(remaining[0]["book"], "/ɪ/")


class ActivityStatsTests(unittest.TestCase):
    def _store(self, temp_dir: str):
        from app.storage import SessionStore

        store = SessionStore(f"sqlite:///{Path(temp_dir) / 'db.db'}")
        store.initialize(seed_builtin_materials=False)
        return store, Path(temp_dir) / "db.db"

    def _session_at(self, store, database_path, when_local, *, segments=None):
        # `when_local` is a local-timezone-aware datetime (the server's own
        # local time, matching get_activity_stats' day-bucketing). Convert
        # to UTC before storing, matching how create_session really writes
        # created_at (datetime.now(UTC).isoformat()).
        import sqlite3
        from datetime import UTC

        session = store.create_session(
            reference_text="Quiet streets.",
            audio_duration_ms=1000,
            normalized_result={
                "scores": {
                    "pronunciation": 80.0,
                    "accuracy": 82.0,
                    "fluency": 78.0,
                    "prosody": 70.0,
                },
                "words": [],
                "segments": segments or [],
                "raw": {},
            },
        )
        with sqlite3.connect(database_path) as connection:
            connection.execute(
                "UPDATE practice_sessions SET created_at = ? WHERE id = ?",
                (when_local.astimezone(UTC).isoformat(), session["id"]),
            )
        return session

    def _local_now(self):
        from datetime import UTC, datetime

        return datetime.now(UTC).astimezone()

    def test_streak_counts_consecutive_days_ending_today(self):
        from datetime import timedelta

        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            for offset in (0, 1, 2):
                self._session_at(store, database_path, now - timedelta(days=offset))

            stats = store.get_activity_stats()

        self.assertEqual(stats["streak_days"], 3)

    def test_gap_breaks_streak(self):
        from datetime import timedelta

        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            # Yesterday and three days ago, with a gap at two days ago.
            self._session_at(store, database_path, now - timedelta(days=1))
            self._session_at(store, database_path, now - timedelta(days=3))

            stats = store.get_activity_stats()

        self.assertEqual(stats["streak_days"], 1)

    def test_today_empty_but_yesterday_active_still_counts(self):
        from datetime import timedelta

        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            self._session_at(store, database_path, now - timedelta(days=1))

            stats = store.get_activity_stats()

        self.assertEqual(stats["streak_days"], 1)

    def test_no_recent_activity_gives_zero_streak(self):
        from datetime import timedelta

        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            # Two days ago only: neither today nor yesterday has a session.
            self._session_at(store, database_path, now - timedelta(days=2))

            stats = store.get_activity_stats()

        self.assertEqual(stats["streak_days"], 0)

    def test_days_only_include_days_with_sessions_within_last_30(self):
        from datetime import timedelta

        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            recent_day = now - timedelta(days=2)
            self._session_at(store, database_path, recent_day)
            self._session_at(store, database_path, now - timedelta(days=40))

            stats = store.get_activity_stats()

        dates = [entry["date"] for entry in stats["days"]]
        self.assertEqual(dates, [recent_day.date().isoformat()])
        self.assertEqual(stats["days"][0]["sessions"], 1)

    def test_day_boundary_uses_server_local_time_not_utc(self):
        from datetime import datetime, timedelta

        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            local_midnight = datetime.combine(
                now.date(), datetime.min.time(), tzinfo=now.tzinfo
            )
            # 30 minutes into today in server-local time. Whenever the
            # server's UTC offset is non-zero, the equivalent UTC instant
            # falls on a *different* UTC calendar date — this is exactly
            # the case UTC-day bucketing gets wrong and local-day bucketing
            # must get right.
            just_after_local_midnight = local_midnight + timedelta(minutes=30)
            self._session_at(store, database_path, just_after_local_midnight)

            stats = store.get_activity_stats()

        dates = [entry["date"] for entry in stats["days"]]
        self.assertEqual(dates, [now.date().isoformat()])

    def test_recent_scores_are_chronological_oldest_first_and_capped_at_30(self):
        from datetime import timedelta

        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            for offset in range(35):
                self._session_at(
                    store, database_path, now - timedelta(days=offset, seconds=offset)
                )

            stats = store.get_activity_stats()

        self.assertEqual(len(stats["recent_scores"]), 30)
        created_ats = [item["created_at"] for item in stats["recent_scores"]]
        self.assertEqual(created_ats, sorted(created_ats))

    def test_recent_scores_map_score_fields_and_infer_mode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            self._session_at(store, database_path, now, segments=[])
            self._session_at(store, database_path, now, segments=[{"index": 1}])

            stats = store.get_activity_stats()

        modes = [item["mode"] for item in stats["recent_scores"]]
        self.assertEqual(modes, ["short", "long"])
        first = stats["recent_scores"][0]
        self.assertEqual(first["pron_score"], 80.0)
        self.assertEqual(first["accuracy_score"], 82.0)
        self.assertEqual(first["fluency_score"], 78.0)
        self.assertEqual(first["prosody_score"], 70.0)

    def test_sessions_this_week_counts_last_seven_local_days(self):
        from datetime import timedelta

        with tempfile.TemporaryDirectory() as temp_dir:
            store, database_path = self._store(temp_dir)
            now = self._local_now()
            # Today and exactly 6 days back: inside the 7-day window.
            self._session_at(store, database_path, now)
            self._session_at(store, database_path, now - timedelta(days=6))
            # Exactly 7 days back: just outside the window.
            self._session_at(store, database_path, now - timedelta(days=7))

            stats = store.get_activity_stats()

        self.assertEqual(stats["sessions_this_week"], 2)

    def test_empty_database_returns_zeroed_stats(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, _ = self._store(temp_dir)

            stats = store.get_activity_stats()

        self.assertEqual(stats["days"], [])
        self.assertEqual(stats["streak_days"], 0)
        self.assertEqual(stats["sessions_this_week"], 0)
        self.assertEqual(stats["recent_scores"], [])


if __name__ == "__main__":
    unittest.main()
