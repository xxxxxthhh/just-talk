import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { ApiError, checkHealth, createVisitor, deleteMyData, fetchQuota } from "../api";
import { USAGE_CHANGED_EVENT, VISITOR_REQUIRED_EVENT } from "../publicMode";
import type { Health, QuotaStatus, QuotaWindow } from "../types";
import "./PublicGate.css";

const SOURCE_URL = "https://github.com/xxxxxthhh/just-talk";

type GateState = "checking" | "welcome" | "ready" | "unavailable";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Wraps the app on the hosted public trial: explains what happens to a
 * recording, creates the anonymous visitor only after the user chooses to
 * start, shows remaining free usage, and offers data deletion.
 */
export default function PublicGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState("");

  const probe = useCallback(async () => {
    try {
      const nextHealth = await checkHealth();
      setHealth(nextHealth);
      await fetchQuota();
      setState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.code === "visitor_required") {
        setState("welcome");
      } else {
        setMessage(error instanceof Error ? error.message : "The service is unavailable.");
        setState("unavailable");
      }
    }
  }, []);

  useEffect(() => {
    void probe();
    const onVisitorRequired = () => setState("welcome");
    window.addEventListener(VISITOR_REQUIRED_EVENT, onVisitorRequired);
    return () => window.removeEventListener(VISITOR_REQUIRED_EVENT, onVisitorRequired);
  }, [probe]);

  if (state === "checking") {
    return <div className="pg-shell pg-center" aria-busy="true">Loading…</div>;
  }
  if (state === "unavailable") {
    return (
      <div className="pg-shell pg-center">
        <div className="pg-card" role="alert">
          <h1>Just Talk is unavailable</h1>
          <p>{message}</p>
          <button type="button" className="primary-button" onClick={() => void probe()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (state === "welcome") {
    return <Welcome health={health} onReady={() => setState("ready")} />;
  }
  return (
    <>
      <PublicBar health={health} />
      {children}
    </>
  );
}

function Welcome({ health, onReady }: { health: Health | null; onReady: () => void }) {
  const siteKey = health?.public?.turnstile_site_key ?? "";
  const ttlDays = health?.public?.visitor_ttl_days ?? 7;
  const scoringEnabled = health?.public?.scoring_enabled ?? true;
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey || !widgetRef.current) return;
    const element = widgetRef.current;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.turnstile || element.childElementCount > 0) return;
      window.turnstile.render(element, {
        sitekey: siteKey,
        callback: (value: string) => setToken(value),
        "expired-callback": () => setToken(""),
      });
    };
    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      await createVisitor(token);
      onReady();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start a session.");
      if (siteKey) {
        window.turnstile?.reset();
        setToken("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pg-shell pg-center">
      <div className="pg-card pg-welcome">
        <h1>Just Talk</h1>
        <p className="pg-lede">
          Practice English pronunciation: read a passage aloud and get word- and sound-level
          feedback, then drill the words you missed.
        </p>
        <ul className="pg-points">
          <li>
            <strong>Free trial with daily limits.</strong> Each visitor gets a few minutes of
            recording and listening per day, and the whole site shares a daily and monthly
            allowance. When it runs out, scoring pauses until it resets (UTC).
          </li>
          <li>
            <strong>How your recording is used.</strong> The audio is uploaded to this server,
            converted, and sent to Microsoft Azure AI Speech for scoring. The server deletes its
            temporary audio files after processing; it keeps your text, scores, and the generated
            model audio.
          </li>
          <li>
            <strong>Your practice data.</strong> History and saved words are tied to an anonymous
            cookie in this browser, removed after {ttlDays} days without use, and you can delete
            them at any time. No account, email, or name is collected.
          </li>
          <li>
            <strong>Logs you should know about.</strong> The hosting network (Cloudflare) and
            Microsoft Azure may keep their own logs, which can include IP addresses.
          </li>
        </ul>
        {!scoringEnabled ? (
          <p className="pg-warning">Scoring and playback are paused on this trial right now.</p>
        ) : null}
        {siteKey ? <div ref={widgetRef} className="pg-turnstile" /> : null}
        {error ? <p className="pg-error" role="alert">{error}</p> : null}
        <button
          type="button"
          className="primary-button"
          disabled={busy || (Boolean(siteKey) && !token)}
          onClick={() => void start()}
        >
          {busy ? "Starting…" : "Start practicing"}
        </button>
        <p className="pg-fineprint">
          Microphone access is requested only when you press record. Just Talk is open source
          (MIT): you can run it yourself with your own Azure key.{" "}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            Source code
          </a>
        </p>
      </div>
    </div>
  );
}

function remaining(windows: QuotaWindow[]): { left: number; limit: number } {
  const personal = windows[0];
  const left = Math.min(...windows.map((window) => Math.max(window.limit - window.used, 0)));
  return { left, limit: personal.limit };
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function PublicBar({ health }: { health: Health | null }) {
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    fetchQuota().then(setQuota, () => undefined);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(USAGE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(USAGE_CHANGED_EVENT, refresh);
  }, [refresh]);

  async function deleteData() {
    setDeleting(true);
    setError("");
    try {
      await deleteMyData();
      window.location.reload();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete data.");
      setDeleting(false);
    }
  }

  const score = quota
    ? remaining([quota.score.visitor_day, quota.score.global_day, quota.score.global_month])
    : null;
  const tts = quota
    ? remaining([quota.tts.visitor_day, quota.tts.global_day, quota.tts.global_month])
    : null;
  const sharedExhausted =
    quota !== null &&
    (["global_day", "global_month"] as const).some(
      (scope) =>
        quota.score[scope].used >= quota.score[scope].limit ||
        quota.score[scope].attempts_used >= quota.score[scope].attempts_limit
    );

  return (
    <div className="pg-bar" role="region" aria-label="Public trial">
      <span className="pg-bar-tag">Free trial</span>
      {health?.public?.scoring_enabled === false ? (
        <span className="pg-bar-warning">Scoring is paused right now.</span>
      ) : score && tts ? (
        <span className="pg-bar-usage">
          Recording left today {formatSeconds(score.left)} / {formatSeconds(score.limit)}
          <span aria-hidden="true"> · </span>
          Listening {tts.left} / {tts.limit} chars
          {sharedExhausted ? (
            <span className="pg-bar-warning"> · Shared allowance used up; resets 00:00 UTC</span>
          ) : null}
        </span>
      ) : null}
      <span className="pg-bar-actions">
        <a className="pg-bar-link" href={SOURCE_URL} target="_blank" rel="noreferrer">
          Source
        </a>
        {confirming ? (
          <>
            <span>Delete all your history and words from this server?</span>
            <button
              type="button"
              className="secondary-button compact pg-danger"
              disabled={deleting}
              onClick={() => void deleteData()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              className="secondary-button compact"
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => setConfirming(true)}
          >
            Delete my data
          </button>
        )}
      </span>
      {error ? <span className="pg-error" role="alert">{error}</span> : null}
    </div>
  );
}
