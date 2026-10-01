import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, checkHealth, deleteMyData, fetchQuota } from "../api";
import { authClient, configureAuth } from "../auth";
import { USAGE_CHANGED_EVENT, VISITOR_REQUIRED_EVENT } from "../publicMode";
import type { Health, QuotaStatus, QuotaWindow } from "../types";
import { TutorialProvider, TutorialHelp } from "./PracticeTutorial";
import "./PublicGate.css";

const SOURCE_URL = "https://github.com/xxxxxthhh/just-talk";
type GateState = "checking" | "welcome" | "ready" | "unavailable";

export default function PublicGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [health, setHealth] = useState<Health | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const authRejected = useRef(false);

  const probe = useCallback(async () => {
    const current = ++generation.current;
    setState("checking");
    try {
      const session = (await authClient()?.auth.getSession())?.data.session;
      if (current !== generation.current) return;
      setAccount(session?.user.id ?? null);
      if (!session) { setState("welcome"); return; }
      await fetchQuota();
      if (current === generation.current) { authRejected.current = false; setState("ready"); }
    } catch (error) {
      if (current !== generation.current) return;
      if (error instanceof ApiError && error.code === "auth_required") {
        authRejected.current = true;
        setState("welcome");
      } else {
        setMessage(error instanceof Error ? error.message : "The service is unavailable.");
        setState("unavailable");
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    checkHealth().then((nextHealth) => {
      if (cancelled) return;
      setHealth(nextHealth);
      if (!nextHealth.public?.auth) { setState("welcome"); return; }
      const client = configureAuth(nextHealth.public.auth.url, nextHealth.public.auth.publishable_key);
      let previousAccount: string | null | undefined;
      const subscription = client.auth.onAuthStateChange((event, session) => {
        // The callback is synchronous: defer SDK calls to avoid its auth lock.
        const nextAccount = session?.user.id ?? null;
        if (event === "SIGNED_OUT" || nextAccount !== previousAccount ||
            (authRejected.current && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN"))) {
          previousAccount = nextAccount;
          generation.current += 1;
          setState("checking");
          window.setTimeout(() => { if (!cancelled) void probe(); }, 0);
        }
      }).data.subscription;
      unsubscribe = () => subscription.unsubscribe();
      void probe();
    }).catch((error: unknown) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "The service is unavailable.");
        setState("unavailable");
      }
    });
    const onAuthRequired = () => { authRejected.current = true; generation.current += 1; setState("welcome"); };
    window.addEventListener(VISITOR_REQUIRED_EVENT, onAuthRequired);
    return () => {
      cancelled = true;
      generation.current += 1;
      unsubscribe?.();
      window.removeEventListener(VISITOR_REQUIRED_EVENT, onAuthRequired);
    };
  }, [probe]);

  if (state === "checking") return <div className="pg-shell pg-center" aria-busy="true">Loading…</div>;
  if (state === "unavailable") return (
    <div className="pg-shell pg-center"><div className="pg-card" role="alert">
      <h1>Just Talk is unavailable</h1><p>{message}</p>
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>Try again</button>
    </div></div>
  );
  if (state === "welcome") return <Welcome health={health} />;
  return <TutorialProvider key={account}><PublicBar health={health} />{children}</TutorialProvider>;
}

function Welcome({ health }: { health: Health | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("error") ? "Google sign-in was cancelled or could not finish. Please try again." : "";
  });
  const configured = Boolean(health?.public?.auth);
  async function signIn() {
    setBusy(true);
    setError("");
    try {
    const result = await authClient()?.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: "select_account" } }
    });
    if (result?.error) { setError(result.error.message); setBusy(false); }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not open Google sign-in."); setBusy(false); }
  }
  return (
    <div className="pg-shell pg-center"><div className="pg-card pg-welcome">
      <h1>Just Talk</h1>
      <p className="pg-lede">Practice English pronunciation with word- and sound-level feedback.</p>
      <ul className="pg-points">
        <li><strong>Free practice funded by Just Talk.</strong> Sign in with Google. Your account shares the same daily allowance across browsers. Recording and listening also share site-wide daily and monthly limits, resetting in UTC.</li>
        <li><strong>Recordings.</strong> Audio and reference text are sent to Microsoft Azure AI Speech. Temporary recordings are deleted after processing; text, scores and model audio are stored.</li>
        <li><strong>Your account and data.</strong> Google and Supabase manage sign-in. Just Talk uses your Supabase account ID for history, saved words and quota. Practice data expires after {health?.public?.visitor_ttl_days ?? 7} days without use or can be deleted immediately. Account-linked usage records and tutorial preferences remain for about 70 days; deleting practice data or signing out does not reset allowance.</li>
        <li><strong>Provider logs.</strong> Google, Supabase, Cloudflare and Microsoft may retain logs including IP addresses.</li>
      </ul>
      {!configured ? <p className="pg-warning">Google sign-in is being set up. Please check back soon.</p> : null}
      {health?.public?.scoring_enabled === false ? <p className="pg-warning">Scoring and playback are paused right now.</p> : null}
      {error ? <p className="pg-error" role="alert">{error}</p> : null}
      <button type="button" className="primary-button" disabled={busy || !configured} onClick={() => void signIn()}>{busy ? "Opening Google…" : "Continue with Google"}</button>
      <p className="pg-fineprint">Microphone access is requested when you press record. <a href={SOURCE_URL} target="_blank" rel="noreferrer">Open source (MIT)</a></p>
    </div></div>
  );
}

function isExhausted(window: QuotaWindow): boolean {
  return window.used >= window.limit || window.attempts_used >= window.attempts_limit;
}

// What this account can still use: the smallest amount left across their own
// and the shared windows, and nothing once any window runs out of requests.
function remaining(windows: QuotaWindow[]): { left: number; limit: number } {
  const personal = windows[0];
  const left = windows.some(isExhausted)
    ? 0
    : Math.min(...windows.map((window) => Math.max(window.limit - window.used, 0)));
  return { left, limit: personal.limit };
}

function formatReset(resetsAt: string): string {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return resetsAt;
  return `${date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  })} UTC`;
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
  // When shared allowances run out, report the latest reset among them (a
  // used-up month outlasts the daily reset).
  const sharedResetsAt = quota
    ? (["score", "tts"] as const)
        .flatMap((kind) => (["global_day", "global_month"] as const).map((scope) => quota[kind][scope]))
        .filter(isExhausted)
        .map((window) => window.resets_at)
        .sort()
        .pop()
    : undefined;

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
          {sharedResetsAt ? (
            <span className="pg-bar-warning">
              {" "}· Shared free allowance used up until {formatReset(sharedResetsAt)}
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="pg-bar-actions">
        <TutorialHelp />
        <a className="pg-bar-link" href={SOURCE_URL} target="_blank" rel="noreferrer">
          Source
        </a>
        <button type="button" className="secondary-button compact" onClick={() => { void authClient()?.auth.signOut({ scope: "local" }).then((result) => { if (result.error) setError(result.error.message); }); }}>Sign out</button>
        {confirming ? (
          <>
            <span>Delete practice data? Your account and used allowance are retained.</span>
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
