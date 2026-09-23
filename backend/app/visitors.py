"""Anonymous visitors for the hosted public trial.

A visitor is a server-issued random token kept in an HttpOnly cookie; only its
SHA-256 hash is stored. Each visitor owns one SQLite file whose name is the
server-generated id, never anything the client sends. The number of active
visitors, the issuance rate, and inactivity (TTL) all bound how many files can
exist. The cookie is a convenience identity, not an abuse control: anyone can
drop it and ask for a new one, which is why billable usage is also capped
site-wide in ``quota.QuotaLedger``.
"""

import hashlib
import re
import secrets
import sqlite3
import threading
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .config import PublicSettings
from .storage import SessionStore

VISITOR_COOKIE = "jt_visitor"
_VISITOR_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_TOUCH_INTERVAL = timedelta(minutes=5)
_CLEANUP_INTERVAL = timedelta(minutes=10)
_DELETE_WAIT_SECONDS = 5.0


class VisitorLimitError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason  # "active_limit" | "issuance_rate" | "client_rate"


class VisitorStore(SessionStore):
    """SessionStore that refuses to recreate a deleted database file."""

    def __init__(self, database_path: Path) -> None:
        super().__init__(f"sqlite:///{database_path}")
        self._allow_create = False

    def initialize(self, *, seed_builtin_materials: bool = True) -> None:
        self._allow_create = True
        try:
            super().initialize(seed_builtin_materials=seed_builtin_materials)
        finally:
            self._allow_create = False

    def _connect(self) -> sqlite3.Connection:
        mode = "rwc" if self._allow_create else "rw"
        connection = sqlite3.connect(f"file:{self.database_path}?mode={mode}", uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class VisitorRegistry:
    def __init__(
        self,
        data_dir: Path,
        settings: PublicSettings,
        *,
        clock: Callable[[], datetime] | None = None,
        on_delete: Callable[[str], None] | None = None,
    ) -> None:
        self.settings = settings
        self.database_path = data_dir / "visitors.db"
        self.visitors_dir = data_dir / "visitors"
        self._clock = clock or (lambda: datetime.now(UTC))
        self._on_delete = on_delete
        self._lock = threading.RLock()
        self._idle = threading.Condition(self._lock)
        self._stores: dict[str, VisitorStore] = {}
        self._in_flight: dict[str, int] = defaultdict(int)
        self._client_issuances: dict[str, deque[float]] = {}
        self._last_cleanup: datetime | None = None

    # ----- lifecycle ---------------------------------------------------

    def initialize(self) -> None:
        self.visitors_dir.mkdir(parents=True, exist_ok=True)
        with self._db() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS visitors (
                    id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL
                )
                """
            )
            # Separate from `visitors` so deleting data can't be used to reset
            # the issuance rate.
            connection.execute(
                "CREATE TABLE IF NOT EXISTS visitor_issuances (issued_at TEXT NOT NULL)"
            )
        self.cleanup_expired()

    def issue(self, *, client_key: str | None = None) -> tuple[str, str]:
        """Create a visitor and its database. Returns (visitor_id, token)."""
        with self._lock:
            self._maybe_cleanup()
            now = self._clock()
            self._check_client_rate(client_key)
            with self._db() as connection:
                active = connection.execute("SELECT COUNT(*) FROM visitors").fetchone()[0]
                if active >= self.settings.max_active_visitors:
                    raise VisitorLimitError("active_limit")
                hour_ago = (now - timedelta(hours=1)).isoformat()
                recent = connection.execute(
                    "SELECT COUNT(*) FROM visitor_issuances WHERE issued_at > ?",
                    (hour_ago,),
                ).fetchone()[0]
                if recent >= self.settings.new_visitors_per_hour:
                    raise VisitorLimitError("issuance_rate")

                visitor_id = uuid.uuid4().hex
                token = secrets.token_urlsafe(32)
                store = VisitorStore(self._path_for(visitor_id))
                store.initialize()
                connection.execute(
                    "INSERT INTO visitors (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
                    (visitor_id, hash_token(token), now.isoformat(), now.isoformat()),
                )
                connection.execute(
                    "INSERT INTO visitor_issuances (issued_at) VALUES (?)", (now.isoformat(),)
                )
                connection.execute(
                    "DELETE FROM visitor_issuances WHERE issued_at < ?",
                    ((now - timedelta(days=1)).isoformat(),),
                )
            self._record_client_issuance(client_key)
            self._stores[visitor_id] = store
            return visitor_id, token

    def resolve(self, token: str | None) -> str | None:
        if not token or len(token) > 256:
            return None
        with self._db() as connection:
            row = connection.execute(
                "SELECT id, last_seen_at FROM visitors WHERE token_hash = ?",
                (hash_token(token),),
            ).fetchone()
            if row is None:
                return None
            now = self._clock()
            last_seen = datetime.fromisoformat(row["last_seen_at"])
            if now - last_seen > timedelta(days=self.settings.visitor_ttl_days):
                return None
            if now - last_seen > _TOUCH_INTERVAL:
                connection.execute(
                    "UPDATE visitors SET last_seen_at = ? WHERE id = ?",
                    (now.isoformat(), row["id"]),
                )
        return row["id"]

    @contextmanager
    def use(self, visitor_id: str) -> Iterator[SessionStore]:
        """Hold a visitor's store for the duration of one request."""
        with self._lock:
            store = self._store_for(visitor_id)
            self._in_flight[visitor_id] += 1
        try:
            yield store
        finally:
            with self._lock:
                self._in_flight[visitor_id] -= 1
                if self._in_flight[visitor_id] <= 0:
                    del self._in_flight[visitor_id]
                    self._idle.notify_all()

    def delete(self, visitor_id: str) -> None:
        with self._lock:
            with self._db() as connection:
                connection.execute("DELETE FROM visitors WHERE id = ?", (visitor_id,))
            # New requests can no longer resolve the visitor; give in-flight
            # ones a moment to finish before removing files. A straggler after
            # that fails instead of recreating the file (VisitorStore opens rw).
            deadline = time.monotonic() + _DELETE_WAIT_SECONDS
            while self._in_flight.get(visitor_id, 0) > 0:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._idle.wait(remaining)
            self._stores.pop(visitor_id, None)
            self._remove_files(visitor_id)
        if self._on_delete is not None:
            self._on_delete(visitor_id)

    def cleanup_expired(self) -> int:
        with self._lock:
            self._last_cleanup = self._clock()
            cutoff = (self._clock() - timedelta(days=self.settings.visitor_ttl_days)).isoformat()
            with self._db() as connection:
                expired = [
                    row["id"]
                    for row in connection.execute(
                        "SELECT id FROM visitors WHERE last_seen_at < ?", (cutoff,)
                    )
                ]
                known = {row["id"] for row in connection.execute("SELECT id FROM visitors")}
            for visitor_id in expired:
                self.delete(visitor_id)
            # Files without a registry row (e.g. a crash mid-issue) are orphans.
            orphans = 0
            for path in self.visitors_dir.glob("*.db"):
                if path.stem not in known and _VISITOR_ID_PATTERN.match(path.stem):
                    self._remove_files(path.stem)
                    orphans += 1
            return len(expired) + orphans

    def active_count(self) -> int:
        with self._db() as connection:
            return connection.execute("SELECT COUNT(*) FROM visitors").fetchone()[0]

    # ----- internals ---------------------------------------------------

    def _maybe_cleanup(self) -> None:
        if self._last_cleanup is None or self._clock() - self._last_cleanup > _CLEANUP_INTERVAL:
            self.cleanup_expired()

    def _check_client_rate(self, client_key: str | None) -> None:
        # Soft, in-memory, per-client-address throttle so one client can't use
        # up the whole hourly issuance budget. Addresses are shared and
        # spoofable; this is not an identity or a strong abuse control.
        if not client_key or self.settings.new_visitors_per_client_per_hour <= 0:
            return
        window = self._client_issuances.get(client_key)
        if window is None:
            return
        cutoff = time.monotonic() - 3600
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= self.settings.new_visitors_per_client_per_hour:
            raise VisitorLimitError("client_rate")

    def _record_client_issuance(self, client_key: str | None) -> None:
        if not client_key:
            return
        if len(self._client_issuances) > 10_000:
            self._client_issuances.clear()
        self._client_issuances.setdefault(client_key, deque()).append(time.monotonic())

    def _store_for(self, visitor_id: str) -> VisitorStore:
        store = self._stores.get(visitor_id)
        if store is None:
            # After a restart the file exists but this process hasn't opened
            # it: run migrations once (idempotent) without re-seeding.
            store = VisitorStore(self._path_for(visitor_id))
            if not store.database_path.exists():
                raise KeyError(visitor_id)
            store.initialize(seed_builtin_materials=False)
            self._stores[visitor_id] = store
        return store

    def _path_for(self, visitor_id: str) -> Path:
        if not _VISITOR_ID_PATTERN.match(visitor_id):
            raise ValueError("Invalid visitor id.")
        return self.visitors_dir / f"{visitor_id}.db"

    def _remove_files(self, visitor_id: str) -> None:
        base = self._path_for(visitor_id)
        for suffix in ("", "-wal", "-shm"):
            Path(f"{base}{suffix}").unlink(missing_ok=True)

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA busy_timeout=5000")
            with connection:
                yield connection
        finally:
            connection.close()
