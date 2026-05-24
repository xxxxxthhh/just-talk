import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class SessionStore:
    def __init__(self, database_url: str) -> None:
        if not database_url.startswith("sqlite:///"):
            raise ValueError("Only sqlite:/// DATABASE_URL values are supported.")
        self.database_path = Path(database_url.removeprefix("sqlite:///"))

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS practice_sessions (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    reference_text TEXT NOT NULL,
                    audio_duration_ms INTEGER NOT NULL,
                    overall_scores_json TEXT NOT NULL,
                    words_json TEXT NOT NULL,
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
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
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
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO practice_sessions (
                    id,
                    created_at,
                    reference_text,
                    audio_duration_ms,
                    overall_scores_json,
                    words_json,
                    raw_azure_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    created_at,
                    reference_text,
                    audio_duration_ms,
                    json.dumps(normalized_result.get("scores", {})),
                    json.dumps(normalized_result.get("words", [])),
                    json.dumps(normalized_result.get("raw", {})),
                ),
            )
        return self.get_session(session_id)

    def list_sessions(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
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
        with self._connect() as connection:
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
            "words": json.loads(row["words_json"]),
            "raw": json.loads(row["raw_azure_json"]),
        }

    def create_word(
        self,
        word: str,
        *,
        source: str = "manual",
        notes: str = "",
    ) -> dict[str, Any]:
        display_word, normalized_word = self._normalize_word(word)
        with self._connect() as connection:
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
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    now,
                    now,
                ),
            )
            created = self._find_word(connection, normalized_word)
        if created is None:
            raise KeyError(display_word)
        return self._row_to_word(created)

    def list_words(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT *
                FROM vocabulary_items
                ORDER BY
                    CASE WHEN latest_score IS NULL THEN 1 ELSE 0 END,
                    latest_score ASC,
                    updated_at DESC
                """
            ).fetchall()
        return [self._row_to_word(row) for row in rows]

    def delete_word(self, word_id: str) -> bool:
        with self._connect() as connection:
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
    ) -> dict[str, Any]:
        display_word, normalized_word = self._normalize_word(word)
        with self._connect() as connection:
            existing = self._find_word(connection, normalized_word)
            if existing is None:
                self.create_word(display_word, source="practice")
                existing = self._find_word(connection, normalized_word)
            if existing is None:
                raise KeyError(display_word)

            now = datetime.now(timezone.utc).isoformat()
            next_count = int(existing["practice_count"]) + (1 if increment else 0)
            connection.execute(
                """
                UPDATE vocabulary_items
                SET latest_score = ?,
                    practice_count = ?,
                    last_practiced_at = ?,
                    updated_at = ?
                WHERE normalized_word = ?
                """,
                (
                    latest_score,
                    next_count,
                    now if increment else existing["last_practiced_at"],
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

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

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
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
