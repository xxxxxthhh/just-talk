"""Owner reporting from identity metadata and aggregate usage, never practice files."""

import sqlite3
from contextlib import closing
from datetime import UTC, timedelta
from pathlib import Path
from uuid import UUID

from .quota import LEDGER_RETENTION_DAYS, QuotaLedger


def _empty_usage() -> dict:
    return {
        "scored_audio_ms": 0,
        "measured_score_requests": 0,
        "unmeasured_score_requests": 0,
        "score_attempts": 0,
        "quota_score_seconds": 0,
        "tts_characters": 0,
        "tts_attempts": 0,
    }


def users_summary(ledger: QuotaLedger, accounts_path: Path) -> dict:
    now = ledger._clock().astimezone(UTC)
    recent_day = (now - timedelta(days=6)).strftime("%Y-%m-%d")
    month = now.strftime("%Y-%m")
    users: dict[str, dict] = {}

    def account(raw_id: str | None) -> dict | None:
        try:
            account_id = str(UUID(raw_id))
        except (ValueError, TypeError, AttributeError):
            return None
        return users.setdefault(
            account_id,
            {
                "account_id": account_id,
                "email": None,
                "registered_at": None,
                "first_seen_at": None,
                "last_active_at": None,
                "retained": _empty_usage(),
                "last_7_days": _empty_usage(),
                "this_month": _empty_usage(),
            },
        )

    def activity(user: dict, first: str | None, last: str | None) -> None:
        if first:
            user["first_seen_at"] = min(filter(None, (user["first_seen_at"], first)))
        if last:
            user["last_active_at"] = max(filter(None, (user["last_active_at"], last)))

    # This registry contains identities/timestamps only. No account's practice
    # database is opened, and the summary does not touch expiry/last activity.
    if accounts_path.exists():
        with closing(sqlite3.connect(f"{accounts_path.as_uri()}?mode=ro", uri=True)) as connection:
            for raw_id, first, last in connection.execute(
                "SELECT id, created_at, last_seen_at FROM visitors"
            ):
                user = account(raw_id)
                if user is not None:
                    activity(user, first, last)

    with ledger._transaction(immediate=False) as connection:
        for row in connection.execute(
            "SELECT account_id, email, registered_at, first_seen_at, last_seen_at "
            "FROM account_profiles"
        ):
            user = account(row["account_id"])
            if user is not None:
                user["email"] = row["email"]
                user["registered_at"] = row["registered_at"]
                activity(user, row["first_seen_at"], row["last_seen_at"])
        # Aggregates only: no attempt IDs, recordings, text, result/score values,
        # sessions, vocabulary, material names, or provider error payloads.
        rows = connection.execute(
            "SELECT visitor_id, day, month, kind, status, COUNT(*) AS attempts, "
            "SUM(units) AS units, SUM(audio_duration_ms) AS audio_ms, "
            "COUNT(audio_duration_ms) AS measured, MIN(created_at) AS first_at, "
            "MAX(created_at) AS last_at FROM usage_attempts "
            "WHERE visitor_id IS NOT NULL AND status != 'released' "
            "GROUP BY visitor_id, day, month, kind, status"
        )
        for row in rows:
            user = account(row["visitor_id"])
            if user is None:
                continue
            activity(user, row["first_at"], row["last_at"])
            periods = ["retained"]
            if recent_day <= row["day"] <= now.strftime("%Y-%m-%d"):
                periods.append("last_7_days")
            if row["month"] == month:
                periods.append("this_month")
            for period in periods:
                metrics = user[period]
                if row["kind"] == "score":
                    metrics["quota_score_seconds"] += row["units"]
                    metrics["score_attempts"] += row["attempts"]
                    if row["status"] == "succeeded":
                        metrics["scored_audio_ms"] += row["audio_ms"] or 0
                        metrics["measured_score_requests"] += row["measured"]
                        metrics["unmeasured_score_requests"] += row["attempts"] - row["measured"]
                elif row["kind"] == "tts":
                    metrics["tts_characters"] += row["units"]
                    metrics["tts_attempts"] += row["attempts"]
        tracking_since = connection.execute(
            "SELECT value FROM usage_metadata WHERE key = 'audio_tracking_since'"
        ).fetchone()["value"]
        oldest = connection.execute("SELECT MIN(created_at) FROM usage_attempts").fetchone()[0]

    for user in users.values():
        for period in ("retained", "last_7_days", "this_month"):
            metrics = user[period]
            if metrics["unmeasured_score_requests"] and not metrics["measured_score_requests"]:
                metrics["scored_audio_ms"] = None
    return {
        "generated_at": now.isoformat(),
        "timezone": "UTC",
        "retention_days": LEDGER_RETENTION_DAYS,
        "audio_tracking_since": tracking_since,
        "oldest_usage_at": oldest,
        "users": sorted(
            users.values(), key=lambda user: user["last_active_at"] or "", reverse=True
        ),
    }
