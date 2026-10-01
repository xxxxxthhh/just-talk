"""Local practice stores bound to stable, verified Supabase user UUIDs.

The legacy visitor storage machinery supplies file isolation, TTL and locks;
no cookie identity is issued or accepted. Quota rows retain the stable UUID
when practice files expire or are deleted, until ledger retention prunes them.
"""

import time
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

from .public import PublicApiError
from .visitors import _TOUCH_INTERVAL, VisitorLimitError, VisitorRegistry, VisitorStore


class AccountRegistry(VisitorRegistry):
    def __init__(self, data_dir: Path, settings, *, clock=None) -> None:
        super().__init__(data_dir, settings, clock=clock)
        self.database_path = data_dir / "accounts.db"
        self.visitors_dir = data_dir / "accounts"
        self._deleting: set[str] = set()

    def ensure_account(self, account_id: str) -> None:
        account_id = UUID(account_id).hex
        with self._lock:
            if account_id in self._deleting:
                raise PublicApiError(
                    409, "data_deleting", "Practice data is being deleted. Try again."
                )
            self._maybe_cleanup()
            now = self._clock()
            with self._db() as connection:
                row = connection.execute(
                    "SELECT last_seen_at FROM visitors WHERE id = ?", (account_id,)
                ).fetchone()
                if row:
                    if now - datetime.fromisoformat(row["last_seen_at"]) > _TOUCH_INTERVAL:
                        connection.execute(
                            "UPDATE visitors SET last_seen_at = ? WHERE id = ?",
                            (now.isoformat(), account_id),
                        )
                    return
                if (
                    connection.execute("SELECT COUNT(*) FROM visitors").fetchone()[0]
                    >= self.settings.max_active_visitors
                ):
                    raise VisitorLimitError("active_limit")
                recent = connection.execute(
                    "SELECT COUNT(*) FROM visitor_issuances WHERE issued_at > ?",
                    ((now - timedelta(hours=1)).isoformat(),),
                ).fetchone()[0]
                if recent >= self.settings.new_visitors_per_hour:
                    raise VisitorLimitError("issuance_rate")
                store = VisitorStore(self._path_for(account_id))
                store.initialize()
                connection.execute(
                    "INSERT INTO visitors VALUES (?, ?, ?, ?)",
                    (account_id, account_id, now.isoformat(), now.isoformat()),
                )
                connection.execute("INSERT INTO visitor_issuances VALUES (?)", (now.isoformat(),))
                connection.execute(
                    "DELETE FROM visitor_issuances WHERE issued_at < ?",
                    ((now - timedelta(days=1)).isoformat(),),
                )
                self._stores[account_id] = store

    def _store_for(self, account_id: str) -> VisitorStore:
        if account_id in self._deleting:
            raise PublicApiError(409, "data_deleting", "Practice data is being deleted. Try again.")
        return super()._store_for(account_id)

    def delete(self, account_id: str) -> None:
        # Block new uses before waiting. Never replace files while an old
        # request could write to them after deletion and resurrect private data.
        with self._lock:
            self._deleting.add(account_id)
            try:
                deadline = time.monotonic() + 5.0
                while self._in_flight.get(account_id, 0):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise PublicApiError(
                            409, "practice_busy", "Wait for practice to finish, then delete again."
                        )
                    self._idle.wait(remaining)
                super().delete(account_id)
            finally:
                self._deleting.discard(account_id)
