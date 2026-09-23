"""Persistent usage ledger for billable Azure calls in public mode.

Every billable call is recorded as an *attempt* row before Azure is contacted:

- ``reserve`` checks all caps and inserts a ``reserved`` row in one
  ``BEGIN IMMEDIATE`` transaction, so concurrent requests (threads or
  processes) can't jointly overshoot a cap.
- ``mark_sent`` flips the row to ``sent`` immediately before the Azure call.
  From then on the attempt always counts, whatever the outcome: a failed or
  timed-out call may still have been billed, so it is never refunded or
  retried automatically.
- ``release`` only removes the charge of an attempt that is still
  ``reserved``, i.e. provably never sent.

Rows that are ``reserved`` when the process dies keep counting (the safe
direction). Windows are UTC calendar days and months. Deleting a visitor only
anonymizes its rows, so clearing data, cookies, or restarting never resets
site-wide usage.
"""

import math
import sqlite3
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .config import PublicSettings

KINDS = ("score", "tts")
LEDGER_RETENTION_DAYS = 70


class QuotaExceededError(Exception):
    def __init__(self, kind: str, scope: str, metric: str, resets_at: str) -> None:
        super().__init__(f"{kind} quota exhausted ({scope}, {metric}).")
        self.kind = kind
        self.scope = scope  # "visitor_day" | "global_day" | "global_month"
        self.metric = metric  # "units" | "attempts"
        self.resets_at = resets_at


@dataclass(frozen=True)
class _Limit:
    scope: str
    units: int
    attempts: int


def billable_tts_characters(text: str) -> int:
    # Azure counts some non-Latin characters (e.g. CJK) as two; counting every
    # non-ASCII character as two keeps the estimate on the safe side.
    return sum(1 if ord(character) < 0x80 else 2 for character in text)


def billable_audio_seconds(duration_seconds: float) -> int:
    return max(1, math.ceil(duration_seconds))


class QuotaLedger:
    def __init__(
        self,
        database_path: Path,
        settings: PublicSettings,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.database_path = database_path
        self.settings = settings
        self._clock = clock or (lambda: datetime.now(UTC))
        self._lock = threading.Lock()

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._transaction() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS usage_attempts (
                    id TEXT PRIMARY KEY,
                    visitor_id TEXT,
                    kind TEXT NOT NULL,
                    units INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    day TEXT NOT NULL,
                    month TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_usage_attempts_kind_month
                ON usage_attempts(kind, month, day)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_usage_attempts_visitor_day
                ON usage_attempts(visitor_id, kind, day)
                """
            )

    # ----- limits -------------------------------------------------------

    def _limits(self, kind: str) -> tuple[_Limit, _Limit, _Limit]:
        s = self.settings
        if kind == "score":
            return (
                _Limit("global_month", s.global_monthly_score_seconds, s.global_monthly_score_attempts),
                _Limit("global_day", s.global_daily_score_seconds, s.global_daily_score_attempts),
                _Limit("visitor_day", s.visitor_daily_score_seconds, s.visitor_daily_score_attempts),
            )
        if kind == "tts":
            return (
                _Limit("global_month", s.global_monthly_tts_chars, s.global_monthly_tts_attempts),
                _Limit("global_day", s.global_daily_tts_chars, s.global_daily_tts_attempts),
                _Limit("visitor_day", s.visitor_daily_tts_chars, s.visitor_daily_tts_attempts),
            )
        raise ValueError(f"Unknown quota kind {kind!r}.")

    def _windows(self) -> tuple[datetime, str, str, str, str]:
        now = self._clock().astimezone(UTC)
        day = now.strftime("%Y-%m-%d")
        month = now.strftime("%Y-%m")
        next_day = (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
        first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        next_month = (first_of_month + timedelta(days=32)).replace(day=1)
        return now, day, month, next_day.isoformat(), next_month.isoformat()

    def _usage(
        self,
        connection: sqlite3.Connection,
        *,
        kind: str,
        scope: str,
        visitor_id: str | None,
        day: str,
        month: str,
    ) -> tuple[int, int]:
        if scope == "global_month":
            where, params = "kind = ? AND month = ?", (kind, month)
        elif scope == "global_day":
            where, params = "kind = ? AND day = ?", (kind, day)
        else:
            where, params = "kind = ? AND day = ? AND visitor_id = ?", (kind, day, visitor_id)
        row = connection.execute(
            f"""
            SELECT COALESCE(SUM(units), 0) AS units, COUNT(*) AS attempts
            FROM usage_attempts
            WHERE {where} AND status != 'released'
            """,
            params,
        ).fetchone()
        return int(row["units"]), int(row["attempts"])

    def _check(
        self,
        connection: sqlite3.Connection,
        *,
        windows: tuple[datetime, str, str, str, str],
        visitor_id: str,
        kind: str,
        units: int,
    ) -> None:
        _, day, month, next_day, next_month = windows
        for limit in self._limits(kind):
            used_units, used_attempts = self._usage(
                connection, kind=kind, scope=limit.scope, visitor_id=visitor_id, day=day, month=month
            )
            resets_at = next_month if limit.scope == "global_month" else next_day
            if used_attempts + 1 > limit.attempts:
                raise QuotaExceededError(kind, limit.scope, "attempts", resets_at)
            if used_units + units > limit.units:
                raise QuotaExceededError(kind, limit.scope, "units", resets_at)

    # ----- attempt lifecycle -------------------------------------------

    def precheck(self, *, visitor_id: str, kind: str, units: int = 1) -> None:
        """Cheap early rejection before expensive work (e.g. decoding)."""
        with self._transaction(immediate=False) as connection:
            self._check(
                connection, windows=self._windows(), visitor_id=visitor_id, kind=kind, units=units
            )

    def reserve(self, *, visitor_id: str, kind: str, units: int) -> str:
        if units < 1:
            raise ValueError("units must be positive.")
        attempt_id = uuid.uuid4().hex
        with self._transaction() as connection:
            # Sample the UTC window once, after taking the write lock, so the
            # check and the insert always agree across a day/month boundary.
            windows = self._windows()
            now, day, month, _, _ = windows
            self._check(connection, windows=windows, visitor_id=visitor_id, kind=kind, units=units)
            connection.execute(
                """
                INSERT INTO usage_attempts (
                    id, visitor_id, kind, units, status, day, month, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?, ?)
                """,
                (attempt_id, visitor_id, kind, units, day, month, now.isoformat(), now.isoformat()),
            )
        return attempt_id

    def mark_sent(self, attempt_id: str) -> None:
        self._set_status(attempt_id, "sent", only_from=("reserved",))

    def complete(self, attempt_id: str, *, succeeded: bool) -> None:
        self._set_status(
            attempt_id,
            "succeeded" if succeeded else "failed",
            only_from=("sent",),
        )

    def release(self, attempt_id: str) -> bool:
        """Refund an attempt that was never sent. Returns False otherwise."""
        return self._set_status(attempt_id, "released", only_from=("reserved",))

    def _set_status(self, attempt_id: str, status: str, *, only_from: tuple[str, ...]) -> bool:
        placeholders = ",".join("?" for _ in only_from)
        with self._transaction() as connection:
            cursor = connection.execute(
                f"""
                UPDATE usage_attempts
                SET status = ?, updated_at = ?
                WHERE id = ? AND status IN ({placeholders})
                """,
                (status, self._clock().astimezone(UTC).isoformat(), attempt_id, *only_from),
            )
        return cursor.rowcount == 1

    # ----- reporting & maintenance ------------------------------------

    def status(self, *, visitor_id: str) -> dict[str, Any]:
        report: dict[str, Any] = {}
        with self._transaction(immediate=False) as connection:
            _, day, month, next_day, next_month = self._windows()
            for kind in KINDS:
                entries = {}
                for limit in self._limits(kind):
                    used_units, used_attempts = self._usage(
                        connection,
                        kind=kind,
                        scope=limit.scope,
                        visitor_id=visitor_id,
                        day=day,
                        month=month,
                    )
                    entries[limit.scope] = {
                        "used": used_units,
                        "limit": limit.units,
                        "attempts_used": used_attempts,
                        "attempts_limit": limit.attempts,
                        "resets_at": next_month if limit.scope == "global_month" else next_day,
                    }
                report[kind] = entries
        return report

    def anonymize_visitor(self, visitor_id: str) -> None:
        with self._transaction() as connection:
            connection.execute(
                "UPDATE usage_attempts SET visitor_id = NULL WHERE visitor_id = ?",
                (visitor_id,),
            )

    def prune(self) -> int:
        cutoff = (self._clock() - timedelta(days=LEDGER_RETENTION_DAYS)).strftime("%Y-%m-%d")
        with self._transaction() as connection:
            cursor = connection.execute("DELETE FROM usage_attempts WHERE day < ?", (cutoff,))
        return cursor.rowcount

    # ----- sqlite ------------------------------------------------------

    @contextmanager
    def _transaction(self, *, immediate: bool = True) -> Iterator[sqlite3.Connection]:
        with self._lock:
            connection = sqlite3.connect(self.database_path, isolation_level=None)
            connection.row_factory = sqlite3.Row
            try:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("PRAGMA busy_timeout=5000")
                connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
                try:
                    yield connection
                except BaseException:
                    connection.execute("ROLLBACK")
                    raise
                connection.execute("COMMIT")
            finally:
                connection.close()
