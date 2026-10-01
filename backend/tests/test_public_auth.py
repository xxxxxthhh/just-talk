"""Public mode auth/quota regressions. No real Google, Supabase or Azure calls."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient
from test_api import FakeScorer, FakeSynthesizer, make_wav_bytes

from app.accounts import AccountRegistry
from app.auth import SupabaseVerifier, public_key
from app.config import PublicSettings, Settings
from app.main import create_app
from app.public import PublicApiError
from app.quota import QuotaExceededError, QuotaLedger

ORIGIN = "https://preview.example.com"
URL = "https://example.supabase.co"
KEY = "sb_publishable_test-only"
USER_A = "3b406981-3eca-40f6-a6ea-e345993dc351"
USER_B = "d664c062-39c8-42a3-a940-fc0e62fb5a8c"


def headers(token="account-a"):
    return {"Origin": ORIGIN, "Authorization": f"Bearer {token}"}


@pytest.fixture
def env(tmp_path, monkeypatch):
    verification = []

    def get_user(url, *, headers, timeout):
        assert url == f"{URL}/auth/v1/user"
        assert headers["apikey"] == KEY
        verification.append(headers["Authorization"])
        token = headers["Authorization"].removeprefix("Bearer ")
        if token in {"expired", "invalid"}:
            return httpx.Response(401, request=httpx.Request("GET", url))
        if token == "offline":
            raise httpx.ConnectError("offline")
        user = {
            "id": USER_B if token == "account-b" else USER_A,
            "is_anonymous": token == "anonymous",
            "identities": [{"provider": "google"}],
        }
        if token == "email-only":
            user["identities"] = [{"provider": "email"}]
            user["user_metadata"] = {"provider": "google"}
        return httpx.Response(200, json=user, request=httpx.Request("GET", url))

    monkeypatch.setattr("app.auth.httpx.get", get_user)
    monkeypatch.setattr("app.main.decode_to_wav_16k_mono", lambda *args, **kwargs: 1.0)
    public = PublicSettings(
        enabled=True,
        data_dir=str(tmp_path / "public"),
        allowed_origins=(ORIGIN,),
        supabase_url=URL,
        supabase_publishable_key=KEY,
    )
    scorer, synthesizer = FakeScorer(), FakeSynthesizer()
    app = create_app(settings=Settings(public=public), scorer=scorer, synthesizer=synthesizer)
    return app, public, scorer, synthesizer, verification


@pytest.mark.parametrize("token", [None, "expired", "invalid", "anonymous", "email-only"])
def test_unauthorized_never_calls_azure_or_creates_account(env, token):
    app, public, scorer, synth, calls = env
    with TestClient(app) as client:
        client.cookies.set("jt_visitor", "old-anonymous-cookie")
        h = headers(token) if token else {"Origin": ORIGIN}
        for path in [
            "/api/me/quota",
            "/api/sessions",
            "/api/words",
            "/api/export",
            "/api/materials",
        ]:
            assert client.get(path, headers=h).status_code == 401
        assert client.post("/api/speak", json={"text": "hello"}, headers=h).status_code == 401
        assert (
            client.post(
                "/api/score",
                data={"reference_text": "Hello."},
                files={"audio": ("a.wav", make_wav_bytes())},
                headers=h,
            ).status_code
            == 401
        )
        assert client.delete("/api/me", headers=h).status_code == 401
    assert synth.calls == []
    assert not hasattr(scorer, "wav_path")
    assert not list((Path(public.data_dir) / "accounts").glob("*.db"))


def test_legacy_visitor_creation_removed(env):
    with TestClient(env[0]) as client:
        assert client.post("/api/visitor", headers={"Origin": ORIGIN}).status_code == 410
        assert client.get("/api/health").json()["passage_check_configured"] is False


def test_cross_browser_same_account_and_different_account_isolation(env):
    app, _, _, synth, _ = env
    with TestClient(app) as one, TestClient(app) as two:
        word = one.post("/api/words", headers=headers(), json={"word": "private"}).json()
        assert two.get("/api/words", headers=headers()).json()[0]["id"] == word["id"]
        assert two.get("/api/words", headers=headers("account-b")).json() == []
        assert two.delete(f"/api/words/{word['id']}", headers=headers("account-b")).json() == {
            "deleted": False
        }
        assert one.get("/api/words", headers=headers()).json()[0]["id"] == word["id"]
        assert (
            one.post("/api/speak", headers=headers(), json={"text": "private"}).status_code == 200
        )
        assert two.get("/api/me/quota", headers=headers()).json()["tts"]["visitor_day"]["used"] == 7
        assert (
            two.get("/api/me/quota", headers=headers("account-b")).json()["tts"]["visitor_day"][
                "used"
            ]
            == 0
        )
        assert two.get("/api/export", headers=headers("account-b")).json()["vocabulary"] == []
    assert synth.calls == ["private"]


def test_delete_practice_data_retains_account_usage_after_relogin_and_restart(env):
    app, public, scorer, synth, _ = env
    with TestClient(app) as client:
        client.post("/api/words", headers=headers(), json={"word": "private"})
        client.post("/api/speak", headers=headers(), json={"text": "private"})
        scored = client.post(
            "/api/score",
            headers=headers(),
            data={"reference_text": "Hello."},
            files={"audio": ("a.wav", make_wav_bytes())},
        )
        assert scored.status_code == 200
        before = client.get("/api/me/quota", headers=headers()).json()
        assert client.delete("/api/me", headers=headers()).json()["quota_retained"]
        assert client.get("/api/words", headers=headers()).json() == []
        assert client.get("/api/sessions", headers=headers()).json() == []
        assert client.get("/api/me/quota", headers=headers()).json() == before
    restarted = create_app(settings=Settings(public=public), scorer=scorer, synthesizer=synth)
    with TestClient(restarted) as client:
        assert client.get("/api/me/quota", headers=headers()).json() == before
        assert (
            client.post("/api/speak", headers=headers(), json={"text": "private"}).status_code
            == 200
        )
    assert synth.calls == ["private", "private"]  # private cached audio was deleted


def test_tts_private_cache_never_shared_between_accounts(env):
    app, _, _, synth, _ = env
    with TestClient(app) as client:
        for token in ["account-a", "account-a", "account-b"]:
            assert (
                client.post(
                    "/api/speak", headers=headers(token), json={"text": "private phrase"}
                ).status_code
                == 200
            )
        assert (
            client.get("/api/me/quota", headers=headers()).json()["tts"]["visitor_day"][
                "attempts_used"
            ]
            == 1
        )
    assert synth.calls == ["private phrase", "private phrase"]


def test_verification_outage_fails_closed_without_azure(env):
    with TestClient(env[0]) as client:
        assert (
            client.post(
                "/api/speak", headers=headers("offline"), json={"text": "hello"}
            ).status_code
            == 503
        )
    assert env[3].calls == []


@pytest.mark.parametrize("scope", ["visitor", "global_daily", "global_monthly"])
def test_atomic_parallel_caps(tmp_path, scope):
    public = replace(
        PublicSettings(),
        **{f"{scope}_tts_chars": 5} if scope != "visitor" else {"visitor_daily_tts_chars": 5},
    )
    ledger = QuotaLedger(tmp_path / "usage.db", public)
    ledger.initialize()
    other_ledger = QuotaLedger(tmp_path / "usage.db", public)
    barrier = threading.Barrier(12)

    def reserve(index):
        barrier.wait()
        try:
            (ledger if index % 2 else other_ledger).reserve(
                visitor_id=USER_A if scope == "visitor" else str(index), kind="tts", units=1
            )
            return True
        except QuotaExceededError:
            return False

    with ThreadPoolExecutor(max_workers=12) as pool:
        assert sum(pool.map(reserve, range(12))) == 5


def test_expiry_and_deletion_leave_quota_bound_to_stable_account(tmp_path):
    now = [datetime(2026, 10, 1, tzinfo=UTC)]
    public = PublicSettings(data_dir=str(tmp_path), visitor_ttl_days=1)
    registry = AccountRegistry(tmp_path, public, clock=lambda: now[0])
    registry.initialize()
    uid = UUID(USER_A).hex
    registry.ensure_account(uid)
    ledger = QuotaLedger(tmp_path / "usage.db", public, clock=lambda: now[0])
    ledger.initialize()
    attempt = ledger.reserve(visitor_id=uid, kind="tts", units=9)
    ledger.mark_sent(attempt)
    ledger.complete(attempt, succeeded=True)
    now[0] += timedelta(days=2)
    registry.cleanup_expired()
    registry.ensure_account(uid)
    assert ledger.status(visitor_id=uid)["tts"]["global_month"]["used"] == 9
    registry.delete(uid)
    with ledger._transaction() as connection:
        assert connection.execute("SELECT visitor_id FROM usage_attempts").fetchone()[0] == uid


def test_delete_waits_for_inflight_and_blocks_new_requests(tmp_path):
    registry = AccountRegistry(tmp_path, PublicSettings())
    registry.initialize()
    uid = UUID(USER_A).hex
    registry.ensure_account(uid)
    finished = threading.Event()
    with registry.use(uid):
        thread = threading.Thread(target=lambda: (registry.delete(uid), finished.set()))
        thread.start()
        # Synchronize on deletion barrier, without invoking any billable service.
        for _ in range(100):
            with registry._lock:
                deleting = uid in registry._deleting
            if deleting:
                break
            finished.wait(0.01)
        assert deleting
        with pytest.raises(PublicApiError):
            registry.ensure_account(uid)
        assert not finished.is_set()
        with pytest.raises(PublicApiError) as concurrent_delete:
            registry.delete(uid)
        assert concurrent_delete.value.code == "data_deleting"
    thread.join(timeout=2)
    assert finished.is_set()
    registry.ensure_account(uid)
    with registry.use(uid) as store:
        assert store.list_words() == []


def test_exact_supabase_origin_in_csp_and_public_key_only(tmp_path):
    (tmp_path / "index.html").write_text("<html>Just Talk</html>")
    settings = Settings(
        static_dir=str(tmp_path),
        public=PublicSettings(
            enabled=True,
            data_dir=str(tmp_path / "data"),
            supabase_url=URL,
            supabase_publishable_key=KEY,
        ),
    )
    with TestClient(create_app(settings=settings)) as client:
        assert f"connect-src 'self' {URL};" in client.get("/").headers["content-security-policy"]
        assert client.get("/api/health").json()["public"]["auth"]["publishable_key"] == KEY
    assert not public_key("sb_secret_not-client-safe")
    assert not SupabaseVerifier(URL + "/api", KEY).configured
    assert not SupabaseVerifier(URL, "sb_secret_bad").configured


def test_azure_concurrency_cap_is_retained(env):
    _, public, scorer, _, _ = env
    lock = threading.Lock()
    active = 0
    maximum = 0

    class BlockingSynthesizer:
        def synthesize(self, text):
            nonlocal active, maximum
            with lock:
                active += 1
                maximum = max(maximum, active)
            time.sleep(0.03)
            with lock:
                active -= 1
            return b"audio", "audio/mpeg", []

    app = create_app(
        settings=Settings(public=public), scorer=scorer, synthesizer=BlockingSynthesizer()
    )
    with TestClient(app) as client:

        def request(index):
            return client.post(
                "/api/speak", headers=headers(), json={"text": f"phrase {index}"}
            ).status_code

        with ThreadPoolExecutor(max_workers=8) as pool:
            assert list(pool.map(request, range(8))) == [200] * 8
    assert maximum == public.max_concurrent_azure
