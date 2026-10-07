import { useEffect } from "react";

import "../game/game.css";
import { canAdvance, canRecord, judge, runReducer } from "../game/runModel";
import { scoreTone, scoreValue } from "../scoreUtils";
import type { Attempt, RunItem, RunState, ScoreResult, Verdict } from "../types";

// Vibrated attempt IDs for the current run, kept outside the component so a
// tab switch that remounts it never vibrates for the same attempt twice.
let vibrated = { runId: "", attemptIds: new Set<string>() };

function canRecordNext(run: RunState): boolean {
  const item = run.items[run.index];
  if (!item || !canAdvance(run)) return false;
  const advanced = runReducer(run, { type: "ADVANCE", runId: run.runId, itemId: item.prompt.itemId });
  return advanced !== null && canRecord(advanced);
}

export function validAccuracy(attempt: Attempt): number | null {
  if (attempt.status !== "scored" || !attempt.result) return null;
  const judgment = judge(attempt.result);
  return judgment.kind === "valid" ? judgment.accuracy : null;
}

export function latestValid(item: RunItem): { attempt: Attempt; accuracy: number } | null {
  for (let i = item.attempts.length - 1; i >= 0; i -= 1) {
    const accuracy = validAccuracy(item.attempts[i]);
    if (accuracy !== null) return { attempt: item.attempts[i], accuracy };
  }
  return null;
}

// One word and one sound to listen for, only when the result shows a weak one.
function weakestHint(result: ScoreResult): { word: string; phoneme: string | null } | null {
  const word = result.words
    .filter((candidate) => typeof candidate.accuracy === "number" && candidate.accuracy < 80)
    .sort((left, right) => (left.accuracy ?? 0) - (right.accuracy ?? 0))[0];
  if (!word) return null;
  const phoneme = word.phonemes
    .filter((candidate) => typeof candidate.accuracy === "number" && candidate.accuracy < 80)
    .sort((left, right) => (left.accuracy ?? 0) - (right.accuracy ?? 0))[0];
  return { word: word.word, phoneme: phoneme?.phoneme ?? null };
}

function verdictLine(verdict: Verdict | null, accuracy: number | null): string {
  switch (verdict) {
    case "practiced":
      if (scoreTone(accuracy) === "good") return "Clear. Nice one.";
      return scoreTone(accuracy) === "watch" ? "Close. Keep it moving." : "Worth a re-listen.";
    case "passed":
      return "Passed.";
    case "relisten":
      return "Worth a re-listen. Hear it, then try once more.";
    case "saved":
      return "Saved. Your heart is safe.";
    case "heart-lost":
      return "Still low after a re-listen. One heart used.";
    case "no-match":
      return "Didn't catch any speech that time.";
    case "unjudged":
      return "Couldn't score that one cleanly.";
    case "cannot-confirm":
      return "Not confirmed. No heart lost.";
    case "pending":
      return "Still waiting on that score. You can keep going.";
    default:
      return "";
  }
}

type NodeState = { className: string; label: string };

function nodeState(item: RunItem, index: number, current: number): NodeState {
  const lit = item.attempts.some((attempt) => validAccuracy(attempt) !== null);
  const parts = [lit ? "lit" : item.resolution === "skipped" ? "skipped" : "unlit"];
  const labels = [lit ? "practiced" : item.resolution === "skipped" ? "skipped" : "not practiced"];
  if (item.resolution === "pending") {
    parts.push("pending");
    labels.push("score pending");
  } else if (item.resolution === "unjudged") {
    parts.push("unjudged");
    labels.push(item.verdict === "cannot-confirm" ? "not confirmed" : "unscored");
  }
  if (index === current) {
    parts.push("current");
    labels.push("current");
  }
  return { className: parts.join(" "), label: labels.join(", ") };
}

type PracticeRunProps = {
  run: RunState;
  onRecord: () => void;
  onStop: () => void;
  // Advances to the next item and starts recording it in one tap.
  onRecordNext: () => void;
  onFinish: () => void;
  onSkip: () => void;
  onCannotConfirm: () => void;
  onPlayReference: () => void;
  onQuit: () => void;
  onResume: () => void;
  onOpenReview: () => void;
};

// The run surface up to the Challenge summary; the parent renders RunReview
// once the run reaches its review phase.
export function PracticeRun({
  run,
  onRecord,
  onStop,
  onRecordNext,
  onFinish,
  onSkip,
  onCannotConfirm,
  onPlayReference,
  onQuit,
  onResume,
  onOpenReview,
}: PracticeRunProps) {
  useEffect(() => {
    if (vibrated.runId !== run.runId) vibrated = { runId: run.runId, attemptIds: new Set() };
    let accepted = false;
    for (const item of run.items) {
      for (const attempt of item.attempts) {
        if (validAccuracy(attempt) === null || vibrated.attemptIds.has(attempt.key.attemptId)) continue;
        vibrated.attemptIds.add(attempt.key.attemptId);
        accepted = true;
      }
    }
    if (accepted && typeof navigator.vibrate === "function") navigator.vibrate(30);
  }, [run]);

  if (run.phase === "review") return null;

  const item = run.items[run.index];
  const next = run.items[run.index + 1] ?? null;
  const focusSound = run.items.find((candidate) => candidate.prompt.stage === "focus")?.prompt.targetPhoneme;

  return (
    <section className="run" aria-label={run.mode === "challenge" ? "Challenge run" : "Route run"}>
      <header className="run-header">
        <div className="run-title">
          <strong>{run.mode === "challenge" ? "Challenge" : "Route"}</strong>
          {focusSound ? <span>Today's sound: /{focusSound}/</span> : null}
        </div>
        {run.hearts !== null ? (
          <span className="run-hearts" aria-label={`${run.hearts} of 2 hearts left`}>
            {"♥".repeat(run.hearts)}
            <span className="run-hearts-spent">{"♥".repeat(2 - run.hearts)}</span>
          </span>
        ) : null}
        {run.phase !== "summary" ? (
          <button type="button" className="m-small-button" onClick={onQuit}>
            Quit
          </button>
        ) : null}
      </header>

      <ol className="run-nodes" aria-label="Run progress">
        {run.items.map((candidate, index) => {
          const state = nodeState(candidate, index, run.index);
          return (
            <li
              key={candidate.prompt.itemId}
              className={`run-node ${state.className}`}
              aria-label={`Item ${index + 1}: ${state.label}`}
            />
          );
        })}
      </ol>

      {run.phase === "summary" ? (
        <ChallengeSummary run={run} onOpenReview={onOpenReview} />
      ) : run.paused ? (
        <div className="run-paused">
          <p>Paused.</p>
          <button type="button" className="run-primary" onClick={onResume}>
            Resume
          </button>
        </div>
      ) : item ? (
        <>
          <CurrentItem
            run={run}
            item={item}
            onRecord={onRecord}
            onStop={onStop}
            onSkip={onSkip}
            onCannotConfirm={onCannotConfirm}
            onPlayReference={onPlayReference}
          />
          {run.phase === "feedback" || run.phase === "rescue" ? (
            next ? (
              <div className="run-next">
                <span className="run-stage">Next · {next.prompt.stage}</span>
                <p className="run-prompt-text">{next.prompt.text}</p>
                <button type="button" className="run-primary" disabled={!canRecordNext(run)} onClick={onRecordNext}>
                  Record next
                </button>
                {run.phase === "rescue" ? <p className="run-note">Finish this one first.</p> : null}
              </div>
            ) : (
              <div className="run-next">
                <button type="button" className="run-primary" disabled={!canAdvance(run)} onClick={onFinish}>
                  Finish
                </button>
              </div>
            )
          ) : null}
          {item.attempts.some((attempt) => attempt.sync === "pending") ? (
            <p className="run-note">Checking words from that sentence…</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

type CurrentItemProps = {
  run: RunState;
  item: RunItem;
  onRecord: () => void;
  onStop: () => void;
  onSkip: () => void;
  onCannotConfirm: () => void;
  onPlayReference: () => void;
};

function CurrentItem({ run, item, onRecord, onStop, onSkip, onCannotConfirm, onPlayReference }: CurrentItemProps) {
  const best = latestValid(item);
  const recordable = canRecord(run);
  const prompt = (
    <div className="run-prompt">
      <span className="run-stage">
        {run.index + 1}/{run.items.length} · {item.prompt.stage}
      </span>
      <p className="run-prompt-text">{item.prompt.text}</p>
    </div>
  );
  // The reducer clears lastRejection when the next capture begins.
  const rejection = item.lastRejection ? (
    <p className="run-note" role="status">
      That recording wasn't scored and didn't count: {item.lastRejection.message}
    </p>
  ) : null;

  if (run.phase === "recording") {
    return (
      <>
        {prompt}
        <button type="button" className="run-primary run-stop" onClick={onStop}>
          Stop
        </button>
      </>
    );
  }
  if (run.phase === "scoring") {
    return (
      <>
        {prompt}
        <p className="run-listening" role="status">
          Got it, listening…
        </p>
      </>
    );
  }
  if (run.phase === "ready") {
    return (
      <>
        {prompt}
        {rejection}
        <div className="run-actions">
          <button type="button" className="run-primary" disabled={!recordable} onClick={onRecord}>
            Record
          </button>
          <button type="button" className="m-small-button" onClick={onSkip}>
            Skip
          </button>
        </div>
      </>
    );
  }

  const shown = run.phase === "rescue" ? item.attempts.find((a) => a.key.attemptId === item.firstLowAttemptId) : null;
  const accuracy = shown ? validAccuracy(shown) : best?.accuracy ?? null;
  const result = shown?.result ?? best?.attempt.result ?? null;
  const hint = result && accuracy !== null ? weakestHint(result) : null;
  const verdict = run.phase === "rescue" ? "relisten" : item.verdict;
  // A rescue reading that could not be judged keeps the first low on screen.
  const lastAttempt = item.attempts[item.attempts.length - 1];
  const lastJudgment = lastAttempt?.result ? judge(lastAttempt.result) : null;
  const rescueMiss =
    run.phase === "rescue" && lastAttempt && lastAttempt.purpose === "rescue" && lastJudgment?.kind !== "valid"
      ? lastJudgment?.kind === "no-match"
        ? "Didn't catch that. Try again."
        : "Couldn't score that one cleanly. Try again."
      : null;

  return (
    <>
      {prompt}
      <div className={`run-verdict ${scoreTone(accuracy)}`} role="status">
        {accuracy !== null ? <strong className="run-score">{scoreValue(accuracy)}</strong> : null}
        <p>{verdictLine(verdict, accuracy)}</p>
        {hint ? (
          <p className="run-hint">
            Listen for “{hint.word}”{hint.phoneme ? ` · /${hint.phoneme}/` : ""}
          </p>
        ) : null}
      </div>
      {rescueMiss ? <p className="run-note">{rescueMiss}</p> : null}
      {rejection}
      {run.phase === "rescue" ? (
        <div className="run-actions">
          <button
            type="button"
            className="m-small-button"
            disabled={item.referenceLoad === "pending"}
            onClick={onPlayReference}
          >
            {item.referenceLoad === "pending" ? "Loading…" : "Hear it"}
          </button>
          <button type="button" className="run-primary" disabled={!recordable} onClick={onRecord}>
            Record again
          </button>
          <button type="button" className="m-small-button" onClick={onCannotConfirm}>
            Move on
          </button>
        </div>
      ) : recordable ? (
        <div className="run-actions">
          <button type="button" className="m-small-button" onClick={onRecord}>
            Try again
          </button>
        </div>
      ) : null}
    </>
  );
}

function ChallengeSummary({ run, onOpenReview }: { run: RunState; onOpenReview: () => void }) {
  const headline =
    run.challengeOutcome === "cleared"
      ? "Challenge cleared"
      : run.challengeOutcome === "failed"
        ? "Out of hearts"
        : "Challenge incomplete";
  return (
    <div className="run-summary" role="status">
      <h2>{headline}</h2>
      {run.endReason === "quota" ? (
        <p>Trial usage ran out for today. Your results so far are kept.</p>
      ) : run.challengeOutcome === "incomplete" ? (
        <p>Some items weren't confirmed, so this one doesn't count as cleared. No hearts were taken for them.</p>
      ) : null}
      <button type="button" className="run-primary" onClick={onOpenReview}>
        See review
      </button>
    </div>
  );
}
