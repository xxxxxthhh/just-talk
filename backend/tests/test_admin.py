"""Owner reporting privacy and access regressions; synthetic identities only."""

import json
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import httpx
import pytest
import test_public_auth
from fastapi.testclient import TestClient
from test_api import make_wav_bytes
from test_public_auth import USER_A, USER_B, headers

from app import auth
from app.admin import users_summary
from app.config import PublicSettings, Settings
from app.main import create_app
from app.quota import QuotaExceededError, QuotaLedger
from app.storage import SessionStore


@pytest.fixture
def env(tmp_path, monkeypatch):
    return test_public_auth.env.__wrapped__(tmp_path, monkeypatch)


def owner_app(env, **kwargs):
    _, public, scorer, synth, _ = env
    return create_app(
        settings=Settings(public=replace(public, admin_user_id=USER_A)),
        scorer=scorer,
        synthesizer=synth,
        **kwargs,
    )


@pytest.mark.parametrize(
    "token", [None, "expired", "invalid", "anonymous", "email-only", "account-b", "offline"]
)
def test_owner_api_denies_every_other_identity(env, token):
    with TestClient(owner_app(env)) as client:
        client.cookies.set("jt_visitor", "legacy-cookie")
        response = client.get("/api/admin/users", headers=headers(token) if token else {})
        assert response.status_code == (503 if token == "offline" else 403 if token == "account-b" else 401)
        assert "users" not in response.json()
    assert env[3].calls == []


def test_empty_grant_and_user_editable_metadata_cannot_authorize(env, monkeypatch):
    def get_user(url, **kwargs):
        return httpx.Response(
            200,
            request=httpx.Request("GET", url),
            json={
                "id": USER_A,
                "is_anonymous": False,
                "identities": [{"provider": "google"}],
                "user_metadata": {"admin": True, "role": "owner", "id": USER_A},
                "app_metadata": {"role": "owner"},
            },
        )

    monkeypatch.setattr("app.auth.httpx.get", get_user)
    with TestClient(env[0]) as client:
        assert client.get("/api/me/access", headers=headers()).json() == {"admin": False}
        assert client.get("/api/admin/users", headers=headers()).status_code == 403
    with TestClient(owner_app(env)) as client:
        monkeypatch.setattr(
            "app.auth.httpx.get",
            lambda url, **kw: httpx.Response(
                200,
                request=httpx.Request("GET", url),
                json={
                    "id": USER_B,
                    "is_anonymous": False,
                    "identities": [{"provider": "google"}],
                    "user_metadata": {"admin": True, "owner_id": USER_A},
                },
            ),
        )
        assert client.get("/api/admin/users", headers=headers("account-b")).status_code == 403


def test_summary_does_not_open_practice_stores_or_touch_activity(env, monkeypatch):
    app = owner_app(env)
    with TestClient(app) as client:
        client.post("/api/words", headers=headers("account-b"), json={"word": "PRIVATE_SENTINEL"})
        client.post(
            "/api/score",
            headers=headers("account-b"),
            data={"reference_text": "PRIVATE_SENTINEL"},
            files={"audio": ("a.wav", make_wav_bytes())},
        )
        database = Path(env[1].data_dir) / "accounts.db"
        with sqlite3.connect(database) as connection:
            before = connection.execute("SELECT id,last_seen_at FROM visitors").fetchall()
        monkeypatch.setattr(
            SessionStore, "_connect", lambda *args: pytest.fail("practice file read")
        )
        response = client.get("/api/admin/users", headers=headers())
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        payload = response.json()
        serialized = json.dumps(payload)
        assert "PRIVATE_SENTINEL" not in serialized
        assert all(
            key not in serialized
            for key in ["reference_text", "accuracy", "vocabulary", "recording", "session_id"]
        )
        assert len(payload["users"]) == 1
        user = payload["users"][0]
        assert user["account_id"] == USER_B
        assert user["retained"]["scored_audio_ms"] == 1000
        assert user["registered_at"] is None
        with sqlite3.connect(database) as connection:
            assert connection.execute("SELECT id,last_seen_at FROM visitors").fetchall() == before
        assert client.get("/api/me/access", headers=headers()).json() == {"admin": True}


def test_upgrade_preserves_legacy_quota_and_unknown_duration(tmp_path):
    path = tmp_path / "usage.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE usage_attempts (id TEXT PRIMARY KEY, visitor_id TEXT, "
            "kind TEXT, units INTEGER, status TEXT, day TEXT, month TEXT, "
            "created_at TEXT, updated_at TEXT)"
        )
        connection.execute(
            "INSERT INTO usage_attempts VALUES (?,?,?,?,?,?,?,?,?)",
            (
                "legacy",
                UUID(USER_A).hex,
                "score",
                19,
                "succeeded",
                "2026-10-01",
                "2026-10",
                "2026-10-01T10:00:00+00:00",
                "2026-10-01T10:00:00+00:00",
            ),
        )
    now = datetime(2026, 10, 7, tzinfo=UTC)
    ledger = QuotaLedger(path, PublicSettings(), clock=lambda: now)
    ledger.initialize()
    ledger.initialize()
    result = users_summary(ledger, tmp_path / "accounts.db")
    usage = result["users"][0]["retained"]
    assert usage["quota_score_seconds"] == 19
    assert usage["scored_audio_ms"] is None
    assert usage["unmeasured_score_requests"] == 1
    assert ledger.status(visitor_id=UUID(USER_A).hex)["score"]["global_month"]["used"] == 19


def test_precise_audio_failed_released_and_recent_windows(tmp_path):
    now = datetime(2026, 10, 7, 12, tzinfo=UTC)
    ledger = QuotaLedger(tmp_path / "usage.db", PublicSettings(), clock=lambda: now)
    ledger.initialize()

    def attempt(seconds, ms, success=True, release=False):
        key = ledger.reserve(
            visitor_id=UUID(USER_A).hex, kind="score", units=seconds, audio_duration_ms=ms
        )
        if release:
            ledger.release(key)
        else:
            ledger.mark_sent(key)
            ledger.complete(key, succeeded=success)

    now -= timedelta(days=7)
    attempt(2, 1250)
    now += timedelta(days=7)
    attempt(2, 1500)
    attempt(3, 2200, success=False)
    attempt(10, 9500, release=True)
    summary = users_summary(ledger, tmp_path / "accounts.db")
    user = summary["users"][0]
    assert user["retained"]["scored_audio_ms"] == 2750
    assert user["last_7_days"]["scored_audio_ms"] == 1500
    assert user["last_7_days"]["quota_score_seconds"] == 5
    assert user["last_7_days"]["score_attempts"] == 2
    assert user["this_month"]["quota_score_seconds"] == 5
    assert user["retained"]["quota_score_seconds"] == 7


def test_deleting_practice_keeps_summary_and_usage(env):
    with TestClient(owner_app(env)) as client:
        client.post("/api/speak", headers=headers("account-b"), json={"text": "private"})
        before = client.get("/api/admin/users", headers=headers()).json()["users"][0]["retained"]
        client.delete("/api/me", headers=headers("account-b"))
        after = client.get("/api/admin/users", headers=headers()).json()["users"][0]["retained"]
        assert before == after
        assert after["tts_characters"] == 7


def test_profile_is_from_verified_response_and_not_metadata(env, monkeypatch):
    def get_user(url, **kwargs):
        return httpx.Response(
            200,
            request=httpx.Request("GET", url),
            json={
                "id": USER_B,
                "email": "friend@example.test",
                "created_at": "2026-10-01T09:00:00Z",
                "is_anonymous": False,
                "identities": [{"provider": "google"}],
                "user_metadata": {"email": "owner@example.test", "role": "admin"},
            },
        )

    app = owner_app(env)
    with TestClient(app) as client:
        old = auth.httpx.get
        monkeypatch.setattr("app.auth.httpx.get", get_user)
        client.get("/api/me/quota", headers=headers("account-b"))
        monkeypatch.setattr("app.auth.httpx.get", old)
        user = client.get("/api/admin/users", headers=headers()).json()["users"][0]
        assert user["email"] == "friend@example.test"
        assert user["registered_at"] == "2026-10-01T09:00:00Z"


def test_retention_and_caps_remain_enforced(tmp_path):
    now = datetime(2026, 10, 7, tzinfo=UTC)
    ledger = QuotaLedger(
        tmp_path / "usage.db", PublicSettings(visitor_daily_score_seconds=1), clock=lambda: now
    )
    ledger.initialize()
    ledger.observe_account(UUID(USER_A).hex, email="old@example.test", registered_at=None)
    key = ledger.reserve(visitor_id=UUID(USER_A).hex, kind="score", units=1, audio_duration_ms=900)
    ledger.mark_sent(key)
    ledger.complete(key, succeeded=True)
    with pytest.raises(QuotaExceededError):
        ledger.reserve(visitor_id=UUID(USER_A).hex, kind="score", units=1, audio_duration_ms=900)
    now += timedelta(days=71)
    ledger.prune()
    assert users_summary(ledger, tmp_path / "accounts.db")["users"] == []


def test_admin_id_configuration_is_explicit_and_validated():
    assert (
        PublicSettings.from_env({"PUBLIC_ADMIN_USER_ID": USER_A}, ()).admin_user_id
        == UUID(USER_A).hex
    )
    assert PublicSettings().admin_user_id == ""
    with pytest.raises(ValueError):
        PublicSettings.from_env({"PUBLIC_ADMIN_USER_ID": "email@example.test"}, ())
