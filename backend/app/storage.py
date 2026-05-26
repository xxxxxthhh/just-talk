import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .scoring import score_bucket


VOCABULARY_STATUSES = {"active", "graduated"}
PHONEME_STAT_MIN_ATTEMPTS = 3
PHONEME_STAT_MAX_EXAMPLES = 5
MATERIAL_SCHEMA_VERSION = 1

BUILTIN_MATERIAL_PACK: dict[str, Any] = {
    "schema_version": MATERIAL_SCHEMA_VERSION,
    "pack": {
        "id": "just-talk-starter",
        "title": "Just Talk Starter",
        "source": "built-in",
        "license": "Just Talk original",
    },
    "lessons": [
        {
            "id": "jt-starter-quiet-streets",
            "title": "Quiet Streets",
            "book": "Starter",
            "lesson": 1,
            "text": (
                "The weather changed quickly, but we kept walking through the "
                "quiet streets and talked about the plans we wanted to finish this week."
            ),
            "tags": ["starter", "long-passage"],
        },
        {
            "id": "jt-starter-clear-morning",
            "title": "Clear Morning",
            "book": "Starter",
            "lesson": 2,
            "text": (
                "A clear morning is a good time to practice careful speaking, "
                "steady breathing, and simple sentences."
            ),
            "tags": ["starter", "short"],
        },
        {
            "id": "jt-starter-small-project",
            "title": "Small Project",
            "book": "Starter",
            "lesson": 3,
            "text": (
                "We finished a small project after dinner, then reviewed every "
                "detail before sending the final message."
            ),
            "tags": ["starter", "short"],
        },
    ],
}


class SessionStore:
    def __init__(self, database_url: str) -> None:
        if not database_url.startswith("sqlite:///"):
            raise ValueError("Only sqlite:/// DATABASE_URL values are supported.")
        self.database_path = Path(database_url.removeprefix("sqlite:///"))

    def initialize(self, *, seed_builtin_materials: bool = True) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS practice_sessions (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    reference_text TEXT NOT NULL,
                    audio_duration_ms INTEGER NOT NULL,
                    overall_scores_json TEXT NOT NULL,
                    words_json TEXT NOT NULL,
                    segments_json TEXT NOT NULL DEFAULT '[]',
                    raw_azure_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS vocabulary_items (
                    id TEXT PRIMARY KEY,
                    word TEXT NOT NULL,
                    normalized_word TEXT NOT NULL UNIQUE,
                    source TEXT NOT NULL,
                    notes TEXT NOT NULL,
                    latest_score REAL,
                    practice_count INTEGER NOT NULL,
                    last_practiced_at TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    consecutive_successes INTEGER NOT NULL DEFAULT 0,
                    graduated_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS material_packs (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    source TEXT NOT NULL,
                    license TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS materials (
                    id TEXT PRIMARY KEY,
                    pack_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    text TEXT NOT NULL,
                    book TEXT NOT NULL,
                    lesson TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(pack_id) REFERENCES material_packs(id)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_materials_pack_position
                ON materials (pack_id, position)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS speech_cache (
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
                CREATE INDEX IF NOT EXISTS idx_speech_cache_text_voice
                ON speech_cache (text_hash, voice)
                """
            )
            self._ensure_speech_cache_columns(connection)
            self._ensure_practice_session_columns(connection)
            self._ensure_vocabulary_columns(connection)
        if seed_builtin_materials:
            self.import_material_pack(BUILTIN_MATERIAL_PACK)

    def get_speech_cache(
        self,
        *,
        cache_key: str,
        text_hash: str,
        voice: str,
    ) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT content_type, audio_bytes, word_boundaries_json
                FROM speech_cache
                WHERE cache_key = ?
                  AND text_hash = ?
                  AND voice = ?
                """,
                (cache_key, text_hash, voice),
            ).fetchone()
        if row is None:
            return None
        return {
            "content_type": row["content_type"],
            "audio_bytes": bytes(row["audio_bytes"]),
            "word_boundaries": json.loads(row["word_boundaries_json"]),
        }

    def save_speech_cache(
        self,
        *,
        cache_key: str,
        text_hash: str,
        voice: str,
        content_type: str,
        audio_bytes: bytes,
        word_boundaries: list[dict[str, Any]] | None = None,
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO speech_cache (
                    cache_key,
                    text_hash,
                    voice,
                    content_type,
                    audio_bytes,
                    word_boundaries_json,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    text_hash = excluded.text_hash,
                    voice = excluded.voice,
                    content_type = excluded.content_type,
                    audio_bytes = excluded.audio_bytes,
                    word_boundaries_json = excluded.word_boundaries_json,
                    updated_at = excluded.updated_at
                """,
                (
                    cache_key,
                    text_hash,
                    voice,
                    content_type,
                    audio_bytes,
                    json.dumps(word_boundaries or []),
                    now,
                    now,
                ),
            )

    def create_session(
        self,
        *,
        reference_text: str,
        audio_duration_ms: int,
        normalized_result: dict[str, Any],
    ) -> dict[str, Any]:
        session_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO practice_sessions (
                    id,
                    created_at,
                    reference_text,
                    audio_duration_ms,
                    overall_scores_json,
                    words_json,
                    segments_json,
                    raw_azure_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    created_at,
                    reference_text,
                    audio_duration_ms,
                    json.dumps(normalized_result.get("scores", {})),
                    json.dumps(normalized_result.get("words", [])),
                    json.dumps(normalized_result.get("segments", [])),
                    json.dumps(normalized_result.get("raw", {})),
                ),
            )
        return self.get_session(session_id)

    def list_sessions(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT id, created_at, reference_text, audio_duration_ms, overall_scores_json
                FROM practice_sessions
                ORDER BY created_at DESC
                LIMIT 50
                """
            ).fetchall()
        return [
            {
                "id": row["id"],
                "created_at": row["created_at"],
                "reference_text": row["reference_text"],
                "audio_duration_ms": row["audio_duration_ms"],
                "scores": json.loads(row["overall_scores_json"]),
            }
            for row in rows
        ]

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT *
                FROM practice_sessions
                WHERE id = ?
                """,
                (session_id,),
            ).fetchone()
        if row is None:
            raise KeyError(session_id)
        return {
            "id": row["id"],
            "created_at": row["created_at"],
            "reference_text": row["reference_text"],
            "audio_duration_ms": row["audio_duration_ms"],
            "scores": json.loads(row["overall_scores_json"]),
            "segments": json.loads(row["segments_json"]),
            "words": json.loads(row["words_json"]),
            "raw": json.loads(row["raw_azure_json"]),
        }

    def list_materials(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT
                    materials.*,
                    material_packs.title AS pack_title,
                    material_packs.source AS source,
                    material_packs.license AS license
                FROM materials
                JOIN material_packs ON material_packs.id = materials.pack_id
                ORDER BY material_packs.title COLLATE NOCASE ASC,
                         materials.position ASC,
                         materials.title COLLATE NOCASE ASC
                """
            ).fetchall()
        return [self._row_to_material(row) for row in rows]

    def import_material_pack(self, payload: dict[str, Any]) -> dict[str, Any]:
        pack, lessons = self._normalize_material_pack(payload)
        now = datetime.now(timezone.utc).isoformat()
        with self._connection() as connection:
            existing_pack = connection.execute(
                """
                SELECT imported_at
                FROM material_packs
                WHERE id = ?
                """,
                (pack["id"],),
            ).fetchone()
            imported_at = existing_pack["imported_at"] if existing_pack else now
            connection.execute(
                """
                INSERT INTO material_packs (
                    id,
                    title,
                    source,
                    license,
                    imported_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    source = excluded.source,
                    license = excluded.license,
                    updated_at = excluded.updated_at
                """,
                (
                    pack["id"],
                    pack["title"],
                    pack["source"],
                    pack["license"],
                    imported_at,
                    now,
                ),
            )
            lesson_ids = [lesson["id"] for lesson in lessons]
            placeholders = ", ".join("?" for _ in lesson_ids)
            conflicting_lesson = connection.execute(
                f"""
                SELECT id
                FROM materials
                WHERE id IN ({placeholders})
                  AND pack_id != ?
                LIMIT 1
                """,
                (*lesson_ids, pack["id"]),
            ).fetchone()
            if conflicting_lesson is not None:
                raise ValueError(
                    f"lesson id already exists in another material pack: {conflicting_lesson['id']}"
                )
            connection.execute(
                """
                DELETE FROM materials
                WHERE pack_id = ?
                """,
                (pack["id"],),
            )
            for position, lesson in enumerate(lessons):
                connection.execute(
                    """
                    INSERT INTO materials (
                        id,
                        pack_id,
                        title,
                        text,
                        book,
                        lesson,
                        tags_json,
                        position,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        lesson["id"],
                        pack["id"],
                        lesson["title"],
                        lesson["text"],
                        lesson["book"],
                        lesson["lesson"],
                        json.dumps(lesson["tags"]),
                        position,
                        now,
                        now,
                    ),
                )
            pack_row = connection.execute(
                """
                SELECT *
                FROM material_packs
                WHERE id = ?
                """,
                (pack["id"],),
            ).fetchone()
            material_rows = connection.execute(
                """
                SELECT
                    materials.*,
                    material_packs.title AS pack_title,
                    material_packs.source AS source,
                    material_packs.license AS license
                FROM materials
                JOIN material_packs ON material_packs.id = materials.pack_id
                WHERE materials.pack_id = ?
                ORDER BY materials.position ASC
                """,
                (pack["id"],),
            ).fetchall()
        if pack_row is None:
            raise KeyError(pack["id"])
        return {
            "pack": self._row_to_material_pack(pack_row),
            "materials": [self._row_to_material(row) for row in material_rows],
        }

    def create_word(
        self,
        word: str,
        *,
        source: str = "manual",
        notes: str = "",
    ) -> dict[str, Any]:
        display_word, normalized_word = self._normalize_word(word)
        with self._connection() as connection:
            existing = self._find_word(connection, normalized_word)
            if existing is not None:
                return self._row_to_word(existing)

            now = datetime.now(timezone.utc).isoformat()
            word_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO vocabulary_items (
                    id,
                    word,
                    normalized_word,
                    source,
                    notes,
                    latest_score,
                    practice_count,
                    last_practiced_at,
                    status,
                    consecutive_successes,
                    graduated_at,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    word_id,
                    display_word,
                    normalized_word,
                    source,
                    notes.strip(),
                    None,
                    0,
                    None,
                    "active",
                    0,
                    None,
                    now,
                    now,
                ),
            )
            created = self._find_word(connection, normalized_word)
        if created is None:
            raise KeyError(display_word)
        return self._row_to_word(created)

    def list_words(self, status: str | None = None) -> list[dict[str, Any]]:
        if status is not None and status not in VOCABULARY_STATUSES:
            raise ValueError("status must be active or graduated.")

        where_clause = ""
        parameters: tuple[str, ...] = ()
        if status is not None:
            where_clause = "WHERE status = ?"
            parameters = (status,)

        with self._connection() as connection:
            rows = connection.execute(
                f"""
                SELECT *
                FROM vocabulary_items
                {where_clause}
                ORDER BY
                    CASE status WHEN 'active' THEN 0 ELSE 1 END,
                    CASE WHEN latest_score IS NULL THEN 1 ELSE 0 END,
                    latest_score ASC,
                    updated_at DESC
                """,
                parameters,
            ).fetchall()
        return [self._row_to_word(row) for row in rows]

    def delete_word(self, word_id: str) -> bool:
        with self._connection() as connection:
            cursor = connection.execute(
                """
                DELETE FROM vocabulary_items
                WHERE id = ?
                """,
                (word_id,),
            )
        return cursor.rowcount > 0

    def record_word_practice(
        self,
        word: str,
        *,
        latest_score: float | None,
        increment: bool = True,
        graduation_score: float = 85.0,
        graduation_streak: int = 2,
    ) -> dict[str, Any]:
        display_word, normalized_word = self._normalize_word(word)
        with self._connection() as connection:
            existing = self._find_word(connection, normalized_word)
            if existing is None:
                self.create_word(display_word, source="practice")
                existing = self._find_word(connection, normalized_word)
            if existing is None:
                raise KeyError(display_word)

            now = datetime.now(timezone.utc).isoformat()
            next_count = int(existing["practice_count"]) + (1 if increment else 0)
            next_status = existing["status"]
            next_streak = int(existing["consecutive_successes"])
            next_graduated_at = existing["graduated_at"]
            if latest_score is not None:
                if float(latest_score) > graduation_score:
                    next_streak += 1 if increment else 0
                    next_status = "graduated" if next_streak >= graduation_streak else "active"
                    next_graduated_at = (
                        next_graduated_at
                        if next_status == "graduated" and next_graduated_at
                        else now
                        if next_status == "graduated"
                        else None
                    )
                else:
                    next_status = "active"
                    next_streak = 0
                    next_graduated_at = None

            connection.execute(
                """
                UPDATE vocabulary_items
                SET latest_score = ?,
                    practice_count = ?,
                    last_practiced_at = ?,
                    status = ?,
                    consecutive_successes = ?,
                    graduated_at = ?,
                    updated_at = ?
                WHERE normalized_word = ?
                """,
                (
                    latest_score,
                    next_count,
                    now if increment else existing["last_practiced_at"],
                    next_status,
                    next_streak,
                    next_graduated_at,
                    now,
                    normalized_word,
                ),
            )
            updated = self._find_word(connection, normalized_word)
        if updated is None:
            raise KeyError(display_word)
        return self._row_to_word(updated)

    def create_words_from_session(
        self,
        session_id: str,
        *,
        max_score: float = 85.0,
    ) -> list[dict[str, Any]]:
        session = self.get_session(session_id)
        added: list[dict[str, Any]] = []
        seen: set[str] = set()
        for word_result in session.get("words", []):
            word = str(word_result.get("word", "")).strip()
            score = word_result.get("accuracy")
            if not word or score is None or float(score) > max_score:
                continue
            _, normalized_word = self._normalize_word(word)
            if normalized_word in seen:
                continue
            seen.add(normalized_word)
            item = self.create_word(word, source="weak-word")
            item = self.record_word_practice(
                item["word"],
                latest_score=float(score),
                increment=False,
            )
            added.append(item)
        return added

    def list_phoneme_stats(
        self,
        *,
        min_attempts: int = PHONEME_STAT_MIN_ATTEMPTS,
        max_examples_per_phoneme: int = PHONEME_STAT_MAX_EXAMPLES,
    ) -> list[dict[str, Any]]:
        with self._connection() as connection:
            # Select the 100 most recent sessions, then sort them chronologically (ascending)
            rows = connection.execute(
                """
                SELECT id, created_at, reference_text, words_json
                FROM (
                    SELECT id, created_at, reference_text, words_json
                    FROM practice_sessions
                    ORDER BY created_at DESC
                    LIMIT 100
                )
                ORDER BY created_at ASC
                """
            ).fetchall()

        aggregates: dict[str, dict[str, Any]] = {}
        for row in rows:
            session_id = row["id"]
            created_at = row["created_at"]
            reference_text = row["reference_text"]
            words = json.loads(row["words_json"])
            for word in words:
                word_text = str(word.get("word", "")).strip()
                for phoneme in word.get("phonemes", []) or []:
                    symbol = str(phoneme.get("phoneme", "")).strip()
                    accuracy = phoneme.get("accuracy")
                    if not symbol or accuracy is None:
                        continue
                    score = float(accuracy)
                    bucket = score_bucket(score)
                    if symbol not in aggregates:
                        aggregates[symbol] = {
                            "phoneme": symbol,
                            "score_sum": 0.0,
                            "attempts": 0,
                            "needs_work_count": 0,
                            "watch_count": 0,
                            "good_count": 0,
                            "last_seen_at": created_at,
                            "_examples_by_word": {},
                            "attempts_history": [],
                        }
                    entry = aggregates[symbol]
                    entry["score_sum"] += score
                    entry["attempts"] += 1
                    entry["attempts_history"].append({
                        "accuracy": score,
                        "word": word_text,
                        "created_at": created_at,
                        "session_id": session_id,
                    })
                    if bucket == "good":
                        entry["good_count"] += 1
                    elif bucket == "watch":
                        entry["watch_count"] += 1
                    else:
                        entry["needs_work_count"] += 1
                    if created_at > entry["last_seen_at"]:
                        entry["last_seen_at"] = created_at
                    if word_text:
                        word_key = word_text.casefold()
                        # Overwrite with latest chronological attempt (since rows are sorted ASC)
                        entry["_examples_by_word"][word_key] = {
                            "word": word_text,
                            "accuracy": score,
                            "session_id": session_id,
                            "reference_text": reference_text,
                            "created_at": created_at,
                        }

        results: list[dict[str, Any]] = []
        for entry in aggregates.values():
            if entry["attempts"] < min_attempts:
                continue
            average = round(entry["score_sum"] / entry["attempts"], 2)
            examples = sorted(
                entry["_examples_by_word"].values(),
                key=lambda x: (x["accuracy"], x["word"].casefold()),
            )[:max_examples_per_phoneme]
            # Extract last 12 attempts chronologically
            history = entry["attempts_history"][-12:]
            results.append({
                "phoneme": entry["phoneme"],
                "average_accuracy": average,
                "attempts": entry["attempts"],
                "needs_work_count": entry["needs_work_count"],
                "watch_count": entry["watch_count"],
                "good_count": entry["good_count"],
                "bucket": score_bucket(average),
                "last_seen_at": entry["last_seen_at"],
                "example_words": examples,
                "attempts_history": history,
            })
        results.sort(key=lambda x: (x["average_accuracy"], x["phoneme"]))
        return results

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _ensure_practice_session_columns(self, connection: sqlite3.Connection) -> None:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(practice_sessions)").fetchall()
        }
        if "segments_json" not in columns:
            connection.execute(
                "ALTER TABLE practice_sessions ADD COLUMN segments_json TEXT NOT NULL DEFAULT '[]'"
            )

    def _ensure_speech_cache_columns(self, connection: sqlite3.Connection) -> None:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(speech_cache)").fetchall()
        }
        if "word_boundaries_json" not in columns:
            connection.execute(
                "ALTER TABLE speech_cache ADD COLUMN word_boundaries_json TEXT NOT NULL DEFAULT '[]'"
            )

    def _ensure_vocabulary_columns(self, connection: sqlite3.Connection) -> None:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(vocabulary_items)").fetchall()
        }
        if "status" not in columns:
            connection.execute(
                "ALTER TABLE vocabulary_items ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
            )
        if "consecutive_successes" not in columns:
            connection.execute(
                "ALTER TABLE vocabulary_items ADD COLUMN consecutive_successes INTEGER NOT NULL DEFAULT 0"
            )
        if "graduated_at" not in columns:
            connection.execute("ALTER TABLE vocabulary_items ADD COLUMN graduated_at TEXT")

    def _find_word(
        self,
        connection: sqlite3.Connection,
        normalized_word: str,
    ) -> sqlite3.Row | None:
        return connection.execute(
            """
            SELECT *
            FROM vocabulary_items
            WHERE normalized_word = ?
            """,
            (normalized_word,),
        ).fetchone()

    def _normalize_word(self, word: str) -> tuple[str, str]:
        display_word = word.strip()
        if not display_word:
            raise ValueError("word is required.")
        return display_word, display_word.casefold()

    def _row_to_word(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "word": row["word"],
            "source": row["source"],
            "notes": row["notes"],
            "latest_score": row["latest_score"],
            "practice_count": row["practice_count"],
            "last_practiced_at": row["last_practiced_at"],
            "status": row["status"],
            "consecutive_successes": row["consecutive_successes"],
            "graduated_at": row["graduated_at"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _normalize_material_pack(
        self,
        payload: dict[str, Any],
    ) -> tuple[dict[str, str], list[dict[str, Any]]]:
        if payload.get("schema_version") != MATERIAL_SCHEMA_VERSION:
            raise ValueError("schema_version must be 1.")
        pack_payload = payload.get("pack")
        if not isinstance(pack_payload, dict):
            raise ValueError("pack is required.")
        pack = {
            "id": self._required_text(pack_payload.get("id"), "pack id is required."),
            "title": self._required_text(pack_payload.get("title"), "pack title is required."),
            "source": self._optional_text(pack_payload.get("source")) or "user-imported",
            "license": self._optional_text(pack_payload.get("license")) or "user-provided",
        }

        lesson_payloads = payload.get("lessons")
        if not isinstance(lesson_payloads, list) or not lesson_payloads:
            raise ValueError("lessons are required.")

        lessons: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for lesson_payload in lesson_payloads:
            if not isinstance(lesson_payload, dict):
                raise ValueError("lesson must be an object.")
            lesson_id = self._required_text(
                lesson_payload.get("id"),
                "lesson id is required.",
            )
            if lesson_id in seen_ids:
                raise ValueError("lesson id must be unique.")
            seen_ids.add(lesson_id)
            tags_payload = lesson_payload.get("tags", [])
            if tags_payload is None:
                tags_payload = []
            if not isinstance(tags_payload, list):
                raise ValueError("lesson tags must be a list.")
            lessons.append({
                "id": lesson_id,
                "title": self._required_text(
                    lesson_payload.get("title"),
                    "lesson title is required.",
                ),
                "text": self._required_text(
                    lesson_payload.get("text"),
                    "lesson text is required.",
                ),
                "book": self._optional_text(lesson_payload.get("book")),
                "lesson": self._optional_text(lesson_payload.get("lesson")),
                "tags": [
                    tag
                    for tag in (self._optional_text(item) for item in tags_payload)
                    if tag
                ],
            })
        return pack, lessons

    def _required_text(self, value: Any, message: str) -> str:
        text = self._optional_text(value)
        if not text:
            raise ValueError(message)
        return text

    def _optional_text(self, value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()

    def _row_to_material_pack(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "title": row["title"],
            "source": row["source"],
            "license": row["license"],
            "imported_at": row["imported_at"],
            "updated_at": row["updated_at"],
        }

    def _row_to_material(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "pack_id": row["pack_id"],
            "pack_title": row["pack_title"],
            "title": row["title"],
            "text": row["text"],
            "book": row["book"],
            "lesson": row["lesson"],
            "tags": json.loads(row["tags_json"]),
            "source": row["source"],
            "license": row["license"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
