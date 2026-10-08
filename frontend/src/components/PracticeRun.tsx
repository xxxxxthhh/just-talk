import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

import "../game/game.css";
import type { RunPreferences } from "../game/preferences";
import type { TelemetryStore } from "../game/runAudio";
import { canAdvance, canRecord, MAX_EXTRA_ATTEMPTS, runReducer } from "../game/runModel";
import { firstValid, latestValid, tierForAccuracy, validAccuracy } from "../game/scoring";
import type {
  AutoStopState,
  RunPrompt,
  RevisitSuggestion,
  RunBestReceipt,
  RunItem,
  RunRating,
  RunScoreView,
  RunState,
  RunTier,
  ScoreResult
} from "../types";
import { formatRunScore, LiveRunRing, TIER_LABELS, useRolledNumber, type RunRingProps } from "./RunRing";
import { RunStones } from "./RunStones";
import { REPLAY_FAILED } from "./useReplay";

export const SLOW_SCORE_MS = 5000;
const SUMMARY_ROLL_DELAY_MS = 350;

const TIER_LINES: Record<RunTier, string> = {
  perfect: "Clean.",
  great: "Strong.",
  good: "Solid.",
  relisten: "Worth a re-listen."
};

const RATING_LINES: Record<RunRating, string> = {
  S: "Outstanding run.",
  A: "Strong run.",
  B: "Solid run.",
  C: "Logged."
};

const STAGE_LABELS: Record<RunItem["prompt"]["stage"], string> = {
  warmup: "Warm-up",
  focus: "Focus",
  context: "In context",
  words: "My words"
};

export type PracticeRunProps = {
  run: RunState;
  score: RunScoreView;
  topRevisit: RevisitSuggestion | null;
  receipt: RunBestReceipt | null;
  // Subscribed beside the ring; the rest of the run only follows the auto-stop state.
  telemetryStore: TelemetryStore;
  preferences: RunPreferences;
  reducedMotion: boolean;
  // Run-lifetime feedback already shown, so remounts don't replay pops, rolls, haptics or announcements.
  consumedFeedbackIds: ReadonlySet<string>;
  onFeedbackConsumed: (id: string) => void;
  onSetPreference: (name: keyof RunPreferences, value: boolean) => void;
  onRecord: () => void;
  onStop: () => void;
  // Not offered until the controller can cancel a take without skipping it.
  onCancelTake?: () => void;
  // Advances to the next item and starts recording it in one tap.
  onRecordNext: () => void;
  // Route only: plays the current item's reference from Ready; never blocks Record.
  onHearFirst: () => void;
  // Route only: advances to the next item and previews it, staying Ready with Record usable.
  onHearNextFirst: () => void;
  onFinish: () => void;
  onSkip: () => void;
  onPlayReference: () => void;
  onUseManualStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onQuit: () => void;
  onOpenReview: () => void;
  // Starts the new run inside the tap; its pending state and failure come back as props.
  onPlayAgain: () => void;
  // A new run's deck is loading (from Start or Play again).
  starting: boolean;
  // The last Play again could not build a new run; the finished run is still shown.
  replayFailed: boolean;
  onDone: () => void;
  // Plays the Coach reference for the summary's "One thing to revisit" word.
  onPlayRevisit: (prompt: RunPrompt) => void;
  // Public mode's score requests left today, for the Play again note; null when unknown.
  scoresLeft: number | null;
};

function canRecordNext(run: RunState): boolean {
  const item = run.items[run.index];
  if (!item || !canAdvance(run)) return false;
  const advanced = runReducer(run, { type: "ADVANCE", runId: run.runId, itemId: item.prompt.itemId });
  return advanced !== null && canRecord(advanced);
}

// One hint, labelled with what it belongs to: the weakest sound if one is low, else the weakest word.
function evidenceHint(result: ScoreResult): string | null {
  const word = result.words
    .filter((candidate) => typeof candidate.accuracy === "number" && candidate.accuracy < 80)
    .sort((left, right) => (left.accuracy ?? 0) - (right.accuracy ?? 0))[0];
  if (!word || word.accuracy === null) return null;
  const phoneme = word.phonemes
    .filter((candidate) => typeof candidate.accuracy === "number" && candidate.accuracy < 80)
    .sort((left, right) => (left.accuracy ?? 0) - (right.accuracy ?? 0))[0];
  if (phoneme && phoneme.accuracy !== null) {
    return `/${phoneme.phoneme}/ in “${word.word}” · sound ${formatRunScore(phoneme.accuracy)}`;
  }
  return `Revisit “${word.word}” · word ${formatRunScore(word.accuracy)}`;
}

function feedbackIdFor(run: RunState): string | null {
  const item = run.items[run.index];
  if (run.phase === "summary") return `summary:${run.runId}`;
  if (!item || run.paused) return null;
  if (run.phase === "rescue" && item.firstLowAttemptId) return `rescue:${item.firstLowAttemptId}`;
  if (run.phase === "feedback") {
    const last = item.attempts[item.attempts.length - 1];
    return `feedback:${item.verdict}:${last?.key.attemptId ?? item.prompt.itemId}`;
  }
  return null;
}

// The item-level phases a rejected take returns to; the summary is a new event of its own.
const REJECTION_PHASES: ReadonlySet<RunState["phase"]> = new Set(["ready", "feedback", "rescue"]);

// A rejected take is its own event, wherever the reducer returns to: ready, feedback or rescue.
function rejectionIdFor(run: RunState): string | null {
  if (run.paused || !REJECTION_PHASES.has(run.phase)) return null;
  const rejection = run.items[run.index]?.lastRejection;
  return rejection ? `rejection:${rejection.attemptId}` : null;
}

function rejectionText(rejection: NonNullable<RunItem["lastRejection"]>): string {
  return rejection.localReason ? rejection.message : `That recording wasn't scored and didn't count: ${rejection.message}`;
}

// Freshness is decided at first sight of each id and kept for that id, so marking it consumed
// never cuts its own animation short; a remount sees it already consumed.
function useFreshFeedback(id: string | null, consumed: ReadonlySet<string>, onConsumed: (id: string) => void): boolean {
  const [seen, setSeen] = useState(() => ({ id, fresh: id !== null && !consumed.has(id) }));
  let current = seen;
  if (seen.id !== id) {
    current = { id, fresh: id !== null && !consumed.has(id) };
    setSeen(current);
  }
  useEffect(() => {
    if (id !== null && !consumed.has(id)) onConsumed(id);
  }, [id, consumed, onConsumed]);
  return current.fresh;
}

function useSlowScoring(run: RunState): boolean {
  const waitingId = run.phase === "scoring" && !run.paused ? run.activeAttemptId : null;
  const [slowId, setSlowId] = useState<string | null>(null);
  useEffect(() => {
    if (waitingId === null) return;
    const timer = setTimeout(() => setSlowId(waitingId), SLOW_SCORE_MS);
    return () => clearTimeout(timer);
  }, [waitingId]);
  return waitingId !== null && slowId === waitingId;
}

function autoStopHint(autoStopState: AutoStopState): string {
  if (autoStopState === "off") return "Auto-stop off · tap Stop";
  if (autoStopState === "fallback") return "Noisy · tap Stop";
  return "Speak. I'll stop for you.";
}

export function PracticeRun(props: PracticeRunProps) {
  const { run, score, telemetryStore, preferences, reducedMotion, consumedFeedbackIds, onFeedbackConsumed } = props;
  // A primitive snapshot, so audio frames that keep the same state never re-render the run.
  const autoStopState = useSyncExternalStore(telemetryStore.subscribe, () => telemetryStore.get().autoStopState);
  const feedbackId = feedbackIdFor(run);
  const fresh = useFreshFeedback(feedbackId, consumedFeedbackIds, onFeedbackConsumed);
  const rejectionFresh = useFreshFeedback(rejectionIdFor(run), consumedFeedbackIds, onFeedbackConsumed);
  const slow = useSlowScoring(run);
  const item = run.items[run.index];

  // Optional haptic, once per newly shown valid reading; remounts see the feedback already consumed.
  const vibratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!fresh || !item || feedbackId === vibratedFor.current) return;
    if (run.phase !== "feedback" && run.phase !== "rescue") return;
    vibratedFor.current = feedbackId;
    const last = item.attempts[item.attempts.length - 1];
    if (last && validAccuracy(last) !== null && typeof navigator.vibrate === "function") navigator.vibrate(30);
  }, [fresh, feedbackId, item, run.phase]);

  if (run.phase === "review" || !item) return null;

  const focusSound = run.items.find((candidate) => candidate.prompt.stage === "focus")?.prompt.targetPhoneme ?? null;
  const shape = run.config.target === null ? `Route · ${run.config.length} items` : `Challenge · Target ${run.config.target}`;
  const title = `${shape}${focusSound ? ` · /${focusSound}/` : ""}`;
  const summary = run.phase === "summary";

  return (
    <section
      className={`run run-play${reducedMotion ? " is-reduced" : ""}`}
      aria-label={run.mode === "challenge" ? "Challenge run" : "Route run"}
    >
      <header className="run-bar">
        {!summary ? (
          <button
            type="button"
            className="run-icon-button"
            aria-label="Pause run"
            disabled={run.paused}
            onClick={props.onPause}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 5v14M15 5v14" />
            </svg>
          </button>
        ) : (
          <span className="run-icon-spacer" />
        )}
        <span className="run-bar-title">{title}</span>
        <span className="run-bar-end">
          <Hearts run={run} fresh={fresh} />
          <button
            type="button"
            className="run-icon-button"
            aria-label="Sound"
            aria-pressed={preferences.sfx}
            onClick={() => props.onSetPreference("sfx", !preferences.sfx)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M11 5 6 9H3v6h3l5 4V5z" />
              {preferences.sfx ? <path d="M16 9a4 4 0 0 1 0 6" /> : <path d="m16 9 5 6m0-6-5 6" />}
            </svg>
          </button>
        </span>
      </header>

      <RunStones
        items={run.items}
        scores={score.items}
        currentIndex={summary ? null : run.index}
        reducedMotion={reducedMotion}
      />

      {summary ? (
        <RunSummary {...props} fresh={fresh} feedbackId={feedbackId} />
      ) : (
        <PlayScreen
          {...props}
          item={item}
          fresh={fresh}
          feedbackId={feedbackId}
          slow={slow}
          autoStopState={autoStopState}
        />
      )}

      <p className="visually-hidden" aria-live="polite">
        {announcement(run, score, autoStopState, fresh, rejectionFresh, slow)}
      </p>
    </section>
  );
}

function Hearts({ run, fresh }: { run: RunState; fresh: boolean }) {
  if (run.hearts === null) return null;
  const hearts = run.hearts;
  const atRisk = run.phase === "rescue" && !run.paused;
  const lostNow = fresh && run.items[run.index]?.verdict === "heart-lost";
  const label = `${hearts} of 2 hearts left${atRisk ? ", one at risk" : ""}`;
  return (
    <span className="run-hearts-v2" role="img" aria-label={label}>
      {[0, 1].map((slot) => {
        const spent = slot >= hearts;
        const className = [
          "run-heart",
          spent ? "is-spent" : "",
          spent && slot === hearts && lostNow ? "is-cracking" : "",
          !spent && atRisk && slot === hearts - 1 ? "is-at-risk" : ""
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span key={slot} className={className}>
            ♥
          </span>
        );
      })}
    </span>
  );
}

type ScreenProps = PracticeRunProps & { fresh: boolean; feedbackId: string | null };

const ONE_SHOT_PHASES: ReadonlySet<RunRingProps["phase"]> = new Set(["verdict", "rescue", "summary"]);

type RingFace = Omit<RunRingProps, "telemetry">;

function ringProps(props: ScreenProps, overrides: Pick<RingFace, "phase"> & Partial<RingFace>): RingFace {
  return {
    accuracy: null,
    tier: null,
    rating: null,
    reducedMotion: props.reducedMotion,
    feedbackId: props.feedbackId,
    // Only one-shot feedback can be already shown; idle breathing and live recording never settle.
    settled: ONE_SHOT_PHASES.has(overrides.phase) && !props.fresh,
    onStop: props.onStop,
    ...overrides
  };
}

type Action = { label: ReactNode; onClick?: () => void; disabled?: boolean; tone?: "stop" };

function PlayScreen(props: ScreenProps & { item: RunItem; slow: boolean; autoStopState: AutoStopState }) {
  const { run, item, score, autoStopState, preferences, slow } = props;
  const [confirmingQuit, setConfirmingQuit] = useState(false);
  const secondaryRef = useRef<HTMLButtonElement | null>(null);
  // Focus returns to Quit run only after the dialog has gone and the background is no longer inert.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (confirmingQuit || !returnFocus.current) return;
    returnFocus.current = false;
    secondaryRef.current?.focus();
  }, [confirmingQuit]);
  const recordable = canRecord(run);
  const next = run.items[run.index + 1] ?? null;
  const itemScore = score.items[run.index];
  const first = firstValid(item);
  const latest = latestValid(item);
  const last = item.attempts[item.attempts.length - 1];
  const syncing = item.attempts.some((attempt) => attempt.sync === "pending");
  const reviewing = run.phase === "feedback" || run.phase === "rescue";
  const stage = `${run.index + 1} / ${run.items.length} · ${STAGE_LABELS[item.prompt.stage]}`;

  let ring: RingFace;
  let status: ReactNode;
  let primary: Action;
  let secondary: Action | null = null;
  let heading: ReactNode = null;

  if (run.paused) {
    ring = ringProps(props, { phase: "ready", settled: true });
    status = <p className="run-status-main">Paused.</p>;
    primary = { label: "Resume", onClick: props.onResume };
    secondary = { label: "Quit run", onClick: () => setConfirmingQuit(true) };
  } else if (run.phase === "recording") {
    ring = ringProps(props, { phase: "recording" });
    status = (
      <>
        <p className="run-status-main">{autoStopHint(autoStopState)}</p>
        {autoStopState !== "off" && autoStopState !== "fallback" ? (
          <p className="run-status-sub">The orange arc fills while you're quiet</p>
        ) : null}
      </>
    );
    primary = { label: "Stop", onClick: props.onStop, tone: "stop" };
    secondary = props.onCancelTake ? { label: "Cancel take", onClick: props.onCancelTake } : null;
  } else if (run.phase === "scoring") {
    ring = ringProps(props, { phase: "scoring" });
    status = (
      <p className="run-status-main">
        {slow ? "Still waiting for your result…" : "Got it, listening…"}
      </p>
    );
    primary = { label: "Listening…", disabled: true };
  } else if (run.phase === "rescue") {
    const low = item.attempts.find((attempt) => attempt.key.attemptId === item.firstLowAttemptId);
    const lowAccuracy = low ? validAccuracy(low) : null;
    const hint = low?.result ? evidenceHint(low.result) : null;
    const rescueMiss = last && last.purpose === "rescue" && last.status === "scored" && validAccuracy(last) === null;
    const loaded = item.referenceLoad === "ready";
    ring = ringProps(props, { phase: "rescue", accuracy: lowAccuracy, tier: tierForAccuracy(lowAccuracy) });
    heading = (
      <>
        <h2 className="run-heading">One more listen</h2>
        <p className="run-status-sub">No heart lost yet</p>
      </>
    );
    status = (
      <>
        {/* The tier stays on the ring; the run's own target is a separate fact. */}
        <p className="run-target-line">
          Below this run's target {run.config.target} ·<br />
          listen, then read again
        </p>
        {hint ? <p className="run-evidence-hint">{hint}</p> : null}
        <ol className="run-rescue-steps">
          <li className={loaded ? "is-done" : "is-active"}>
            <span className="run-rescue-step-number">1</span> Listen
          </li>
          <li className={loaded ? "is-active" : ""}>
            <span className="run-rescue-step-number">2</span> Read again
          </li>
        </ol>
        {rescueMiss ? <p className="run-status-sub">Couldn't score that one cleanly. Try again.</p> : null}
        <Rejection item={item} onUseManualStop={props.onUseManualStop} />
      </>
    );
    primary = loaded
      ? { label: "Record again", onClick: props.onRecord, disabled: !recordable }
      : {
          label: item.referenceLoad === "pending" ? "Loading…" : "Hear it",
          onClick: props.onPlayReference,
          disabled: item.referenceLoad === "pending"
        };
    secondary = { label: "Skip rescue · this challenge won't count as cleared", onClick: props.onSkip };
  } else if (run.phase === "feedback") {
    // The ring shows the reading just returned; points and chain only ever come from the first reading.
    const shown = last && validAccuracy(last) !== null ? validAccuracy(last) : (latest?.accuracy ?? null);
    const firstLow = item.attempts.find((attempt) => attempt.key.attemptId === item.firstLowAttemptId);
    const firstLowAccuracy = firstLow ? validAccuracy(firstLow) : null;
    const isFirstReading = first !== null && last !== undefined && first.attempt.key.attemptId === last.key.attemptId;
    const hint = latest?.attempt.result ? evidenceHint(latest.attempt.result) : null;
    ring = ringProps(props, { phase: "verdict", accuracy: shown, tier: tierForAccuracy(shown) });
    // A take rejected after this feedback (a re-record of an unjudged item) replaces the stale outcome.
    status = item.lastRejection ? (
      <Rejection item={item} onUseManualStop={props.onUseManualStop} />
    ) : (
      <>
        {isFirstReading && itemScore && itemScore.firstAccuracy !== null ? (
          <p className="run-points">
            <span className="run-points-base">+{Math.round(itemScore.basePoints)}</span>
            {itemScore.chain >= 2 ? (
              <span className="run-chain-chip">
                ×{itemScore.chain} in a row +{Math.round(itemScore.chainPoints)}
              </span>
            ) : null}
          </p>
        ) : null}
        <FeedbackLine item={item} shown={shown} firstLow={firstLowAccuracy} target={run.config.target} />
        {hint ? <p className="run-evidence-hint">{hint}</p> : null}
        {syncing ? <p className="run-status-sub">Checking words from that sentence…</p> : null}
      </>
    );
    if (recordable) {
      primary = { label: "Try again", onClick: props.onRecord };
      secondary = { label: next ? "Move on" : "Finish", onClick: props.onFinish, disabled: !canAdvance(run) };
    } else if (next) {
      primary = { label: "Record next", onClick: props.onRecordNext, disabled: !canRecordNext(run) };
      // Route previews the next item instead of replaying this one; Challenge keeps its fast path.
      secondary =
        run.mode === "route"
          ? { label: "Hear next first", onClick: props.onHearNextFirst, disabled: !canAdvance(run) }
          : { label: "Hear it again", onClick: props.onPlayReference };
    } else {
      primary = { label: "Finish", onClick: props.onFinish, disabled: !canAdvance(run) };
      secondary = { label: "Hear it again", onClick: props.onPlayReference };
    }
  } else {
    ring = ringProps(props, { phase: "ready" });
    status = (
      <>
        {run.mode === "route" ? (
          <>
            <button
              type="button"
              className="run-hear-first"
              disabled={item.referenceLoad === "pending"}
              onClick={props.onHearFirst}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M11 5 6 9H3v6h3l5 4V5z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.5 5.5a9 9 0 0 1 0 13" />
              </svg>
              {item.referenceLoad === "pending" ? "Loading…" : "Hear it first"}
            </button>
            <p className="run-status-hint">
              {item.referenceLoad === "failed" ? "Couldn't load it" : "Optional"} · Record works any time
            </p>
          </>
        ) : null}
        <Rejection item={item} onUseManualStop={props.onUseManualStop} />
      </>
    );
    primary = { label: "Record", onClick: props.onRecord, disabled: !recordable };
    secondary = { label: "Skip", onClick: props.onSkip };
  }

  const chain = score.currentChain;
  const showAutoStopToggle = run.phase !== "recording" && run.phase !== "scoring";

  return (
    <>
      <div className="run-middle">
        <div className="run-prompt-block">
          <span className="run-stage-label">{stage}</span>
          {heading}
          {/* The material to read stays on screen in every state, rescue included. */}
          <p
            className={`run-prompt-v2 ${item.prompt.kind === "sentence" ? "is-sentence" : "is-word"}${reviewing ? " is-quiet" : ""}`}
          >
            {item.prompt.text}
          </p>
        </div>
        <LiveRunRing {...ring} store={props.telemetryStore} />
        <div className="run-status">{status}</div>
      </div>

      <footer className="run-thumb">
        {reviewing && next ? (
          <div className={`run-next-v2${run.phase === "rescue" ? " is-dim" : ""}`}>
            <span className="run-next-label">Next · {STAGE_LABELS[next.prompt.stage]}</span>
            <span className="run-next-text">{next.prompt.text}</span>
          </div>
        ) : null}
        <div className="run-thumb-row">
          {chain >= 2 ? <span className="run-chain-chip">×{chain} in a row</span> : <span />}
          {showAutoStopToggle ? (
            <button
              type="button"
              className="run-toggle"
              aria-pressed={preferences.autoStop}
              onClick={() => props.onSetPreference("autoStop", !preferences.autoStop)}
            >
              <span className={`run-toggle-dot${preferences.autoStop ? " is-on" : ""}`} aria-hidden="true" />
              Auto-stop {preferences.autoStop ? "on" : "off"}
            </button>
          ) : (
            <span className="run-toggle is-static">
              <span className={`run-toggle-dot${autoStopState !== "off" ? " is-on" : ""}`} aria-hidden="true" />
              {autoStopState === "off" ? "Auto-stop off" : "Auto-stop on"}
            </span>
          )}
        </div>
        <button
          type="button"
          className={`run-primary-v2${primary.tone === "stop" ? " is-stop" : ""}`}
          disabled={primary.disabled}
          onClick={primary.onClick}
        >
          {primary.label}
        </button>
        {secondary ? (
          <button
            ref={secondaryRef}
            type="button"
            className="run-secondary"
            disabled={secondary.disabled}
            onClick={secondary.onClick}
          >
            {secondary.label}
          </button>
        ) : (
          <span className="run-secondary-spacer" aria-hidden="true" />
        )}
      </footer>
      {confirmingQuit && run.paused ? (
        <QuitDialog
          onCancel={() => {
            returnFocus.current = true;
            setConfirmingQuit(false);
          }}
          onConfirm={() => {
            setConfirmingQuit(false);
            props.onQuit();
          }}
        />
      ) : null}
    </>
  );
}

// Only reachable while paused, so no capture is open to be submitted while it waits. Modal in
// full: the rest of the run is inert and Tab wraps inside, so nothing behind it can be reached.
function QuitDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const id = useId();
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const background = backdrop?.parentElement
      ? [...backdrop.parentElement.children].filter(
          (element) => element !== backdrop && !element.hasAttribute("inert") && !element.hasAttribute("aria-live")
        )
      : [];
    background.forEach((element) => element.setAttribute("inert", ""));
    cancelRef.current?.focus();
    return () => background.forEach((element) => element.removeAttribute("inert"));
  }, []);

  const keepFocusInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="run-dialog-backdrop" ref={backdropRef}>
      <div
        className="run-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={keepFocusInside}
      >
        <h2 id={`${id}-title`} className="run-dialog-title">
          End this run?
        </h2>
        <p id={`${id}-body`} className="run-status-sub">
          Your readings so far are kept and you'll see the summary.
        </p>
        <div className="run-summary-buttons">
          <button ref={cancelRef} type="button" className="run-secondary-v2" onClick={onCancel}>
            Keep paused
          </button>
          <button type="button" className="run-primary-v2" onClick={onConfirm}>
            End run
          </button>
        </div>
      </div>
    </div>
  );
}

function Rejection({ item, onUseManualStop }: { item: RunItem; onUseManualStop: () => void }) {
  // The reducer clears lastRejection when the next capture begins.
  const rejection = item.lastRejection;
  if (!rejection) return null;
  if (rejection.localReason) {
    return (
      <div className="run-rejection">
        <p className="run-status-main">{rejection.message}</p>
        {rejection.localReason === "no-speech" ? (
          <button type="button" className="run-link-button" onClick={onUseManualStop}>
            Use manual Stop
          </button>
        ) : null}
      </div>
    );
  }
  return <p className="run-status-sub">{rejectionText(rejection)}</p>;
}

function FeedbackLine({
  item,
  shown,
  firstLow,
  target
}: {
  item: RunItem;
  shown: number | null;
  firstLow: number | null;
  target: number | null;
}) {
  switch (item.verdict) {
    case "passed":
    case "practiced": {
      const tier = tierForAccuracy(shown);
      return tier ? <p className="run-status-main">{TIER_LINES[tier]}</p> : null;
    }
    case "saved":
      return (
        <p className="run-status-main">
          Heart kept · {firstLow !== null ? formatRunScore(firstLow) : "--"} → {shown !== null ? formatRunScore(shown) : "--"}
        </p>
      );
    case "heart-lost":
      return (
        <>
          {/* Both readings keep their own tier color: two Goods below 85 stay amber. */}
          <p className="run-readings" data-tier={tierForAccuracy(shown) ?? undefined}>
            {firstLow !== null ? formatRunScore(firstLow) : "--"} → {shown !== null ? formatRunScore(shown) : "--"}
          </p>
          <p className="run-status-main">Both readings below {target} · one heart used</p>
          <p className="run-status-sub">Both takes are saved for the review.</p>
        </>
      );
    case "cannot-confirm":
      return <p className="run-status-main">{cannotConfirmLine(item)}</p>;
    case "no-match":
    case "unjudged":
    case "pending":
      return <p className="run-status-main">{NONJUDGMENT_LINES[item.verdict]}</p>;
    default:
      return null;
  }
}

// Outcomes without a score; pending means the result is unknown, never that it will be resent.
const NONJUDGMENT_LINES = {
  "no-match": "Didn't catch any speech that time.",
  unjudged: "Couldn't score that one cleanly.",
  pending: "Still waiting on that score. You can keep going."
} as const;

// Each cause says what actually happened; only an exhausted rescue implies an earlier low reading.
const CANNOT_CONFIRM_LINES: Record<NonNullable<RunItem["cannotConfirmReason"]>, string> = {
  "rescue-budget": "No rescue scores left · not confirmed. No heart lost.",
  "unjudged-budget": "No extra scores left · this item has no valid reading. No heart lost.",
  "reference-unavailable": "Couldn't load the reference · not confirmed. No heart lost."
};

function cannotConfirmLine(item: RunItem): string {
  return item.cannotConfirmReason ? CANNOT_CONFIRM_LINES[item.cannotConfirmReason] : "Not confirmed. No heart lost.";
}

function summaryKicker(run: RunState): string {
  if (run.mode === "route") return run.endReason === "completed" ? "Route complete" : "Run ended";
  if (run.challengeOutcome === "cleared") return "Challenge cleared";
  if (run.challengeOutcome === "failed") return "Out of hearts";
  return "Challenge incomplete";
}

function RunSummary(props: ScreenProps) {
  const { run, score, receipt, topRevisit, reducedMotion, fresh } = props;
  // Any button ends the entrance sequence at once; reduced motion and remounts start settled.
  const [ended, setEnded] = useState(false);
  const settled = ended || !fresh || reducedMotion;
  const points = useRolledNumber(score.points, props.feedbackId, !settled, 450, SUMMARY_ROLL_DELAY_MS);
  const outOfHearts = run.endReason === "hearts-exhausted";
  const act = (handler: () => void) => () => {
    setEnded(true);
    handler();
  };
  const revisit = topRevisit?.evidence[0] ?? null;
  // The Coach says just the word, even when it came from a sentence.
  const revisitItem = revisit ? run.items.find((candidate) => candidate.prompt.itemId === revisit.itemId) : undefined;
  const revisitPrompt: RunPrompt | null =
    revisit && revisitItem
      ? {
          ...revisitItem.prompt,
          itemId: `revisit:${revisitItem.prompt.itemId}`,
          kind: "word",
          text: revisit.word,
          targetWord: revisit.word
        }
      : null;
  const playAgainCost = run.items.length + MAX_EXTRA_ATTEMPTS;
  const unratedLine = score.unratedReason ? `Not rated · ${score.unratedReason}` : "Not rated";

  return (
    <>
      <div
        className={`run-middle run-summary-v2${settled ? " is-settled" : ""}`}
        data-rating={score.rated && score.rating ? score.rating : "none"}
      >
        <h2 className="run-summary-kicker">
          {summaryKicker(run)}
          {run.challengeOutcome === "cleared" && run.hearts ? (
            <span className="run-summary-hearts" aria-label={`${run.hearts} hearts kept`}>
              {" · "}
              {"♥".repeat(run.hearts)}
            </span>
          ) : null}
        </h2>
        {run.endReason === "quota" ? (
          <p className="run-status-sub">Trial usage ran out for today. Your results so far are kept.</p>
        ) : null}
        <div className="run-summary-ring">
          <LiveRunRing {...ringProps(props, { phase: "summary", rating: score.rating, settled })} store={props.telemetryStore} />
          {outOfHearts ? (
            <span className="run-summary-cracked" aria-hidden="true">
              ♥
            </span>
          ) : null}
        </div>
        <p className="run-summary-points">
          <span className="run-summary-total" aria-hidden="true">
            {Math.round(points ?? score.points)}
          </span>
          <span className="visually-hidden">{score.points}</span>
          <span className="run-summary-max">/ 1000</span>
        </p>
        <p className="run-status-main">{score.rated && score.rating ? RATING_LINES[score.rating] : unratedLine}</p>
        {score.rated ? (
          <ul className="run-badges">
            {receipt?.outcome === "new-best" ? (
              <li className="run-badge is-gold">New best · was {receipt.previousPoints}</li>
            ) : null}
            {receipt?.outcome === "first-record" ? <li className="run-badge is-gold">First record</li> : null}
            {score.fullCombo ? <li className="run-badge">Full combo</li> : null}
          </ul>
        ) : null}
        <ol className="run-summary-scores" aria-label="Item scores">
          {score.items.map((itemScore, index) => (
            <li
              key={itemScore.itemId}
              data-tier={itemScore.tier ?? undefined}
              style={settled ? undefined : { animationDelay: `${650 + index * 100}ms` }}
            >
              {itemScore.firstAccuracy !== null ? formatRunScore(itemScore.firstAccuracy) : "–"}
            </li>
          ))}
        </ol>
        <div className="run-tiles">
          <div className="run-tile">
            <span className="run-tile-label">Longest chain</span>
            <span className="run-tile-value">
              {score.longestChain} <span className="run-tile-of">/ {score.items.length}</span>
            </span>
          </div>
          {receipt ? (
            <div className="run-tile">
              <span className="run-tile-label">
                Best · <span className="run-ipa">{focusLabel(run)}</span>
              </span>
              <span className="run-tile-value">
                {receipt.previousPoints !== null ? receipt.previousPoints : "None yet"}
              </span>
            </div>
          ) : null}
        </div>
        {revisit ? (
          <div className="run-revisit">
            <span className="run-revisit-text">
              <span className="run-tile-label">One thing to revisit</span>
              <span className="run-revisit-word">
                {revisit.phoneme ? `/${revisit.phoneme}/ in “${revisit.word}”` : revisit.word}{" "}
                <span className="run-revisit-score">
                  {revisit.scoreSource === "phoneme" ? "sound" : "word"} {formatRunScore(revisit.accuracy)}
                </span>
              </span>
            </span>
            {revisitPrompt ? (
              <button
                type="button"
                className="run-revisit-play"
                aria-label={`Hear ${revisit.word}`}
                onClick={() => props.onPlayRevisit(revisitPrompt)}
              >
                <span aria-hidden="true">▶</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="run-thumb run-summary-actions">
        <div className="run-summary-buttons">
          <button type="button" className="run-secondary-v2" onClick={act(props.onOpenReview)}>
            See review
          </button>
          <button type="button" className="run-primary-v2" disabled={props.starting} onClick={act(props.onPlayAgain)}>
            {props.starting ? "Starting…" : "Play again"}
          </button>
        </div>
        {props.replayFailed ? (
          <p className="run-replay-error" role="alert">
            {REPLAY_FAILED}
          </p>
        ) : null}
        <p className="run-summary-note">
          Play again uses up to {playAgainCost} new scores
          {props.scoresLeft !== null ? ` · ${props.scoresLeft} left today` : ""}
        </p>
        <button type="button" className="run-secondary" onClick={act(props.onDone)}>
          Done
        </button>
      </footer>

      {outOfHearts && !settled ? <div className="run-crack" aria-hidden="true" style={{ pointerEvents: "none" }} /> : null}
    </>
  );
}

function focusLabel(run: RunState): string {
  const focus = run.items.find((candidate) => candidate.prompt.stage === "focus")?.prompt.targetPhoneme;
  return focus ? `/${focus}/` : run.mode === "challenge" ? "Challenge" : "Route";
}

function announcement(
  run: RunState,
  score: RunScoreView,
  autoStopState: AutoStopState,
  fresh: boolean,
  rejectionFresh: boolean,
  slow: boolean
): string {
  const item = run.items[run.index];
  if (!item) return "";
  if (run.paused) return "Paused.";
  // The latest rejected take outranks the feedback it returned to.
  if (item.lastRejection && REJECTION_PHASES.has(run.phase)) {
    return rejectionFresh ? rejectionText(item.lastRejection) : "";
  }
  switch (run.phase) {
    case "ready":
      return `${run.index + 1} of ${run.items.length}: ${item.prompt.text}`;
    case "recording":
      return autoStopState === "fallback" ? "Recording. Noisy, tap Stop." : "Recording.";
    case "scoring":
      return slow ? "Still waiting for your result." : "Got it, listening.";
    case "rescue": {
      if (!fresh) return "";
      const low = item.attempts.find((attempt) => attempt.key.attemptId === item.firstLowAttemptId);
      const accuracy = low ? validAccuracy(low) : null;
      const tier = tierForAccuracy(accuracy);
      const reading = accuracy !== null && tier ? `${formatRunScore(accuracy)}. ${TIER_LABELS[tier]}. ` : "";
      return `${reading}Below this run's target ${run.config.target}. Listen, then read again. No heart lost yet.`;
    }
    case "feedback": {
      if (!fresh) return "";
      const latest = latestValid(item);
      const tier = tierForAccuracy(latest?.accuracy ?? null);
      const value = latest ? `${formatRunScore(latest.accuracy)}. ` : "";
      const tierText = tier ? `${TIER_LABELS[tier]}. ` : "";
      if (item.verdict === "heart-lost") return `${value}${tierText}Both readings below ${run.config.target}. One heart used.`;
      if (item.verdict === "saved") return `${value}${tierText}Heart kept.`;
      if ((item.verdict === "passed" || item.verdict === "practiced") && tier) {
        const chain = score.items[run.index]?.chain ?? 0;
        return `${value}${TIER_LABELS[tier]}.${chain >= 2 ? ` Chain ${chain}.` : ""}`;
      }
      if (item.verdict === "no-match" || item.verdict === "unjudged") {
        return `${NONJUDGMENT_LINES[item.verdict]} ${canRecord(run) ? "You can try again." : "You can move on."}`;
      }
      if (item.verdict === "cannot-confirm") return cannotConfirmLine(item);
      if (item.verdict === "pending") return NONJUDGMENT_LINES[item.verdict];
      return "";
    }
    case "summary": {
      if (!fresh) return "";
      const rating = score.rated && score.rating ? `Rating ${score.rating}.` : `Not rated${score.unratedReason ? `, ${score.unratedReason}` : ""}.`;
      return `${summaryKicker(run)}. ${score.points} points. ${rating}`;
    }
    default:
      return "";
  }
}
