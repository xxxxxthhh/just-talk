import { useEffect, useRef, useState } from "react";
import { ApiError, fetchAdminUsers, type AdminSummary, type AdminUsage } from "../api";
import { authClient } from "../auth";
import { useTheme } from "../hooks/useTheme";
import "./PublicGate.css";
import "./AdminDashboard.css";

function date(value: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not available" : parsed.toLocaleString(undefined, {
    timeZone: "UTC", dateStyle: "medium", timeStyle: "short"
  });
}

function duration(ms: number | null): string {
  if (ms === null) return "Not tracked";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function AdminDashboard() {
  const { theme, toggleTheme } = useTheme();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [period, setPeriod] = useState<"retained" | "last_7_days" | "this_month">("last_7_days");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const generation = ++request.current;
    const controller = new AbortController();
    setLoading(true); setError(""); setSummary(null); setRestricted(false);
    fetchAdminUsers(controller.signal).then((next) => {
      if (generation === request.current && !controller.signal.aborted) setSummary(next);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || generation !== request.current) return;
      const denied = reason instanceof ApiError && [401, 403].includes(reason.status);
      setRestricted(denied);
      setError(denied ? "Owner access is required." : "Could not load usage. Please try again.");
    }).finally(() => {
      if (generation === request.current && !controller.signal.aborted) setLoading(false);
    });
    return () => { request.current += 1; controller.abort(); };
  }, [refresh]);

  async function signOut() {
    request.current += 1; setSummary(null); setLoading(true);
    try {
      const result = await authClient()?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
    } catch {
      setLoading(false); setError("Could not sign out. Please try again.");
    }
  }

  const totalAudio = summary?.users.reduce((sum, user) => sum + (user[period].scored_audio_ms ?? 0), 0) ?? 0;
  const missing = summary?.users.reduce((sum, user) => sum + user[period].unmeasured_score_requests, 0) ?? 0;
  const totalAttempts = summary?.users.reduce((sum, user) => sum + user[period].score_attempts, 0) ?? 0;

  return <main className="pg-shell admin-shell">
    <header className="admin-header">
      <div><p className="admin-eyebrow">Just Talk · Owner</p><h1>Trial usage</h1></div>
      <nav aria-label="Owner navigation"><a href="/">Back to practice</a>
        <button type="button" className="secondary-button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} onClick={toggleTheme}>{theme === "light" ? "Dark" : "Light"} theme</button>
        <button type="button" className="secondary-button" onClick={() => void signOut()}>Sign out</button></nav>
    </header>
    <p className="admin-intro">Users and aggregate usage. No recordings, practice text or scores.</p>
    <section className="admin-tools" aria-label="Usage period">
      <label>Period <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
        <option value="last_7_days">Last 7 days</option><option value="this_month">This month</option>
        <option value="retained">Recorded history</option>
      </select></label>
      <button type="button" className="secondary-button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
      {summary ? <span>Updated {date(summary.generated_at)} UTC</span> : null}
    </section>
    {loading ? <p role="status">Loading usage…</p> : null}
    {error ? <div className="pg-card admin-error" role="alert"><h2>{restricted ? "Access restricted" : "Usage unavailable"}</h2><p>{error}</p></div> : null}
    {summary ? <>
      <section className="admin-totals" aria-label="Usage overview">
        <article><span>Users recorded</span><strong>{summary.users.length}</strong></article>
        <article><span>Measured scoring audio</span><strong>{missing && totalAudio === 0 ? "Not tracked" : duration(totalAudio)}</strong>
          {missing ? <small>{missing} earlier scoring {missing === 1 ? "request was" : "requests were"} not measured.</small> : null}</article>
        <article><span>Scoring attempts</span><strong>{totalAttempts}</strong></article>
      </section>
      <div className="admin-table-wrap"><table className="admin-table">
        <caption>Accounts observed by this app; this deployment only.</caption>
        <thead><tr><th scope="col">User</th><th scope="col">Registered</th><th scope="col">Last activity</th>
          <th scope="col">Measured scoring audio</th><th scope="col">Scoring attempts</th>
          <th scope="col">Quota charged</th><th scope="col">Listening use</th></tr></thead>
        <tbody>{summary.users.map((user) => <tr key={user.account_id}>
          <th scope="row"><span>{user.email ?? "Email not recorded yet"}</span><small>{user.account_id}</small></th>
          <td>{date(user.registered_at)}</td><td>{date(user.last_active_at)}</td>
          <td><AudioUsage usage={user[period]} /></td><td>{user[period].score_attempts}</td>
          <td>{duration(user[period].quota_score_seconds * 1000)}</td>
          <td>{user[period].tts_characters.toLocaleString()} chars<small>{user[period].tts_attempts} requests</small></td>
        </tr>)}</tbody>
      </table>{summary.users.length === 0 ? <p className="admin-empty">No app users recorded yet.</p> : null}</div>
      <footer className="admin-notes">
        <p><strong>Measured audio</strong> is the uploaded recording duration for successful scoring calls, including recordings with no speech match. It is not time on site or speaking-only time. Measurement began {date(summary.audio_tracking_since)} UTC; earlier duration is unavailable.</p>
        <p><strong>Quota charged</strong> rounds each recording up to seconds and includes failed or unfinished attempts. Listening use counts new synthesis requests, including failed attempts; cached playback is not counted. These are app estimates, not the provider bill.</p>
        <p>History is retained for about {summary.retention_days} days, not a lifetime total. All dates and periods use UTC. Last 7 days includes today and the previous 6 UTC days. Last activity is the latest authenticated app request or recorded usage; viewing this page does not change it.</p>
        <p>Email and registration appear after a verified app request on this version. Accounts that have never opened the app may be absent; deleted or expired identities can remain as account IDs within retained usage. This page does not combine other deployments.</p>
      </footer>
    </> : null}
  </main>;
}

function AudioUsage({ usage }: { usage: AdminUsage }) {
  return <><span>{duration(usage.scored_audio_ms)}</span>
    {usage.unmeasured_score_requests ? <small>{usage.unmeasured_score_requests} earlier requests not measured</small> : null}</>;
}
