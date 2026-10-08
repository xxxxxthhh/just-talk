import { useEffect, useRef, useState } from "react";

import "../game/game.css";
import { judge } from "../game/runModel";
import { latestValid, tierForAccuracy, validAccuracy } from "../game/scoring";
import type {
  Attempt,
  RevisitEvidence,
  RevisitSuggestion,
  RunItem,
  RunPrompt,
  RunScoreView,
  RunState,
  WordCandidate
} from "../types";
import { RunMiniPlayer, useYouPlayer, type CoachPlayback, type YouPlayer, type YouTake } from "./RunMiniPlayer";
import { formatRunScore, TIER_LABELS } from "./RunRing";
import { REPLAY_FAILED } from "./useReplay";

const MAX_EVIDENCE = 3;

const STAGE_LABELS: Record<RunPrompt["stage"], string> = {
  warmup: "Warm-up",
  focus: "Focus",
  context: "In context",
  words: "My words"
};

function itemStatus(item: RunItem): string | null {
  const practiced = latestValid(item) !== null;
  if (item.resolution === "skipped") return practiced ? "Rescue skipped" : "Skipped";
  if (item.resolution === "pending") return "Score pending";
  if (item.resolution === "unjudged") return item.verdict === "cannot-confirm" ? "Not confirmed" : "Unscored";
  if (item.resolution === "open") return "Unresolved";
  if (item.verdict === "saved") return "Rescued · heart kept";
  if (item.verdict === "heart-lost") return "Heart used";
  return null;
}

function attemptLabel(attempt: Attempt): string {
  if (attempt.status === "pending") return "Score pending";
  if (!attempt.result) return "Unscored";
  const judgment = judge(attempt.result);
  if (judgment.kind === "valid") return formatRunScore(judgment.accuracy);
  return judgment.kind === "no-match" ? "No speech heard" : "Unscored";
}

function takesOf(item: RunItem, urls: Readonly<Record<string, string>>): YouTake[] {
  return item.attempts.map((attempt, index) => ({
    attemptId: attempt.key.attemptId,
    label: `Take ${index + 1} · ${attemptLabel(attempt)}`,
    url: urls[attempt.key.attemptId] ?? null
  }));
}

function outcomeLabel(run: RunState): string {
  if (run.mode === "challenge") {
    if (run.challengeOutcome === "cleared") return "Challenge cleared";
    if (run.challengeOutcome === "failed") return "Out of hearts";
    return "Challenge incomplete";
  }
  if (run.endReason === "completed") return "Route complete";
  if (run.endReason === "quota") return "Usage limit reached";
  return "Route ended early";
}

const CANDIDATE_LABELS: Record<WordCandidate["status"], string> = {
  processed: "sent to word bank",
  unconfirmed: "not confirmed",
  "save-manually": "save manually"
};

function CandidateStatus({ attempt }: { attempt: Attempt }) {
  if (attempt.sync === "not-needed" || (attempt.sync === "done" && attempt.candidates.length === 0)) return null;
  if (attempt.sync === "pending") return <p className="run-note">Checking words…</p>;
  return (
    <div className="run-candidates">
      {attempt.sync === "manual" ? <p className="run-note">Couldn't sync these words. Save them manually.</p> : null}
      {attempt.candidates.length ? (
        <ul>
          {attempt.candidates.map((candidate) => (
            <li key={candidate.word}>
              {candidate.word} · {CANDIDATE_LABELS[candidate.status]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Every word score of a sentence reading, then the sentence's own score, each labelled as such.
function WordChips({ attempt }: { attempt: Attempt }) {
  const words = attempt.result?.words.filter((word) => typeof word.accuracy === "number") ?? [];
  const sentence = validAccuracy(attempt);
  if (words.length === 0) return null;
  return (
    <ul className="run-word-chips" aria-label="Word scores">
      {words.map((word, index) => (
        <li key={`${word.word}-${index}`} className="run-word-chip" data-tier={tierForAccuracy(word.accuracy) ?? undefined}>
          {word.word} {formatRunScore(word.accuracy ?? 0)}
        </li>
      ))}
      {sentence !== null ? <li className="run-word-chip is-sentence">sentence {formatRunScore(sentence)}</li> : null}
    </ul>
  );
}

function evidenceLabel(evidence: RevisitEvidence): string {
  return evidence.phoneme ? `/${evidence.phoneme}/ in “${evidence.word}”` : evidence.word;
}

type Shared = {
  player: YouPlayer;
  coach: CoachPlayback;
  attemptAudioUrls: Readonly<Record<string, string>>;
  onPlayReference: (prompt: RunPrompt) => void;
  onStopReference: () => void;
};

function SuggestionCard({ run, suggestion, shared }: { run: RunState; suggestion: RevisitSuggestion; shared: Shared }) {
  // One block per recording: a take backs one set of evidence and one player, never two.
  const groups = new Map<string, RevisitEvidence[]>();
  for (const evidence of suggestion.evidence.slice(0, MAX_EVIDENCE)) {
    groups.set(evidence.attemptId, [...(groups.get(evidence.attemptId) ?? []), evidence]);
  }
  return (
    <li className="run-suggestion" id={`run-suggestion-${suggestion.id}`}>
      <p className="run-suggestion-summary">{suggestion.summary}</p>
      {[...groups.entries()].map(([attemptId, evidence]) => {
        const item = run.items.find((candidate) => candidate.prompt.itemId === evidence[0].itemId);
        const attempt = item?.attempts.find((candidate) => candidate.key.attemptId === attemptId);
        if (!item || !attempt) return null;
        const url = shared.attemptAudioUrls[attemptId] ?? null;
        return (
          <div key={attemptId} className="run-suggestion-take">
            <ul className="run-evidence-v2">
              {evidence.map((entry) => (
                <li key={`${entry.word}-${entry.phoneme ?? ""}`}>
                  <span className="run-evidence-word">{evidenceLabel(entry)}</span>
                  <span className="run-evidence-score">
                    <strong data-tier={tierForAccuracy(entry.accuracy) ?? undefined}>{formatRunScore(entry.accuracy)}</strong>
                    <span>{entry.scoreSource === "phoneme" ? "sound score" : "word score"}</span>
                  </span>
                </li>
              ))}
            </ul>
            {item.prompt.kind === "sentence" ? (
              <>
                <p className="run-evidence-sentence">{item.prompt.text}</p>
                <WordChips attempt={attempt} />
              </>
            ) : null}
            <RunMiniPlayer
              player={shared.player}
              takes={[{ attemptId, label: attemptLabel(attempt), url }]}
              subject={evidence[0].word}
              coachPrompt={item.prompt}
              coach={shared.coach}
              onPlayCoach={shared.onPlayReference}
              onStopCoach={shared.onStopReference}
            />
          </div>
        );
      })}
    </li>
  );
}

function ReadingRow({
  item,
  index,
  score,
  featured,
  shared
}: {
  item: RunItem;
  index: number;
  score: RunScoreView;
  featured: ReadonlyMap<string, string>;
  shared: Shared;
}) {
  const itemScore = score.items[index];
  const status = itemStatus(item);
  const takes = takesOf(item, shared.attemptAudioUrls);
  // A take already playable in a suggestion card links there instead of getting a second player.
  const ownTakes = takes.filter((take) => !featured.has(take.attemptId));
  const featuredIn = takes.map((take) => featured.get(take.attemptId)).find((id) => id !== undefined) ?? null;

  return (
    <li className="run-reading" id={`run-reading-${item.prompt.itemId}`}>
      <div className="run-reading-head">
        <span className="run-reading-stone" data-tier={itemScore?.tier ?? undefined} aria-hidden="true" />
        <span className="run-reading-text">
          <span className="run-reading-stage">{STAGE_LABELS[item.prompt.stage]}</span>
          <span className="run-prompt-text">{item.prompt.text}</span>
        </span>
        {itemScore?.tier && itemScore.firstAccuracy !== null ? (
          <span className="run-reading-score" data-tier={itemScore.tier}>
            <span className="run-reading-tier">{TIER_LABELS[itemScore.tier]}</span>
            <strong>{formatRunScore(itemScore.firstAccuracy)}</strong>
          </span>
        ) : null}
      </div>
      {status ? <p className="run-review-status">{status}</p> : null}
      {item.attempts.length ? (
        <ol className="run-review-takes" aria-label={`Takes of ${item.prompt.text}`}>
          {item.attempts.map((attempt, attemptIndex) => (
            <li key={attempt.key.attemptId} className="run-review-attempt">
              <span className="run-review-take">Take {attemptIndex + 1}</span>{" "}
              <strong className="run-review-score" data-tier={tierForAccuracy(validAccuracy(attempt)) ?? undefined}>
                {attemptLabel(attempt)}
              </strong>
              <CandidateStatus attempt={attempt} />
            </li>
          ))}
        </ol>
      ) : null}
      {featuredIn ? (
        <button
          type="button"
          className="run-link-button"
          onClick={() => document.getElementById(`run-suggestion-${featuredIn}`)?.scrollIntoView?.({ block: "start" })}
        >
          Listen in What to practice next
        </button>
      ) : null}
      <RunMiniPlayer
        compact
        player={shared.player}
        takes={ownTakes}
        subject={item.prompt.text}
        coachPrompt={item.prompt}
        coach={shared.coach}
        onPlayCoach={shared.onPlayReference}
        onStopCoach={shared.onStopReference}
      />
    </li>
  );
}

type RunReviewProps = {
  run: RunState;
  score: RunScoreView;
  suggestions: readonly RevisitSuggestion[];
  // Object URLs for retained attempt recordings, owned and released by the run hook.
  attemptAudioUrls: Readonly<Record<string, string>>;
  coach: CoachPlayback;
  publicMode: boolean;
  drillsEnabled: boolean;
  onPlayReference: (prompt: RunPrompt) => void;
  onStopReference: () => void;
  // Starts the new run inside the tap; its pending state and failure come back as props.
  onPlayAgain: () => void;
  // The new run's deck is loading.
  starting: boolean;
  // The last Play again could not build a new run; the finished run is still shown.
  replayFailed: boolean;
  onGenerateDrill?: (phoneme: string) => void;
  onExit: () => void;
};

export function RunReview({
  run,
  score,
  suggestions,
  attemptAudioUrls,
  coach,
  publicMode,
  drillsEnabled,
  onPlayReference,
  onStopReference,
  onPlayAgain,
  starting,
  replayFailed,
  onGenerateDrill,
  onExit
}: RunReviewProps) {
  const [player, playerElement] = useYouPlayer(coach, onStopReference, run.paused);
  const [showUnreached, setShowUnreached] = useState(false);
  const shared: Shared = { player, coach, attemptAudioUrls, onPlayReference, onStopReference };

  // Leaving the review stops the Coach too; the recording element stops itself.
  const stopReference = useRef(onStopReference);
  useEffect(() => {
    stopReference.current = onStopReference;
  }, [onStopReference]);
  useEffect(() => () => stopReference.current(), []);

  const featured = new Map<string, string>();
  for (const suggestion of suggestions) {
    for (const evidence of suggestion.evidence.slice(0, MAX_EVIDENCE)) {
      if (!featured.has(evidence.attemptId)) featured.set(evidence.attemptId, suggestion.id);
    }
  }
  const reached = run.items.slice(0, run.index + 1);
  const unreached = run.items.slice(run.index + 1);
  const drillPhoneme =
    suggestions.find((suggestion) => suggestion.id === "phoneme")?.evidence[0]?.phoneme ??
    run.items.find((item) => item.prompt.stage === "focus")?.prompt.targetPhoneme ??
    null;
  const focus = run.items.find((item) => item.prompt.stage === "focus")?.prompt.targetPhoneme ?? null;
  const subline = [
    outcomeLabel(run),
    run.hearts !== null ? `${run.hearts} of 2 hearts left` : null,
    `chain ${score.longestChain}/${run.items.length}`
  ]
    .filter(Boolean)
    .join(" · ");

  const leave = (handler: () => void) => () => {
    player.stop();
    onStopReference();
    handler();
  };

  const jumpTo = (itemId: string, index: number) => {
    if (index > run.index) setShowUnreached(true);
    // After the unreached group opens, so its rows exist.
    setTimeout(() => document.getElementById(`run-reading-${itemId}`)?.scrollIntoView?.({ block: "start" }), 0);
  };

  return (
    <section className="run run-review" aria-label="Run review">
      <header className="run-review-bar">
        <span className="run-review-rating" data-rating={score.rated && score.rating ? score.rating : "none"}>
          {score.rated && score.rating ? score.rating : "–"}
        </span>
        <span className="run-review-headline">
          <h2>
            {score.points} <span className="run-review-of">/ 1000{focus ? ` · /${focus}/` : ""}</span>
          </h2>
          <span className="run-review-sub">{subline}</span>
          {!score.rated ? (
            <span className="run-review-sub">{score.unratedReason ? `Not rated · ${score.unratedReason}` : "Not rated"}</span>
          ) : null}
        </span>
        <nav className="run-review-stones" aria-label="Jump to item">
          {run.items.map((item, index) => (
            <button
              key={item.prompt.itemId}
              type="button"
              className="run-review-stone"
              data-tier={score.items[index]?.tier ?? undefined}
              aria-label={`Go to ${index + 1}. ${item.prompt.text}`}
              onClick={() => jumpTo(item.prompt.itemId, index)}
            />
          ))}
        </nav>
      </header>

      <div className="run-review-body">
        {run.endReason === "quota" ? (
          <p className="run-note">Trial usage ran out for today. Your results so far are kept.</p>
        ) : null}

        {suggestions.length ? (
          <section className="run-review-section">
            <h3 className="run-review-heading">What to practice next</h3>
            <ol className="run-suggestions" aria-label="What to practice next">
              {suggestions.map((suggestion) => (
                <SuggestionCard key={suggestion.id} run={run} suggestion={suggestion} shared={shared} />
              ))}
            </ol>
          </section>
        ) : null}

        <section className="run-review-section">
          <h3 className="run-review-heading">All readings</h3>
          <ol className="run-reading-list" aria-label="All readings">
            {reached.map((item, index) => (
              <ReadingRow key={item.prompt.itemId} item={item} index={index} score={score} featured={featured} shared={shared} />
            ))}
          </ol>
          {unreached.length ? (
            <details
              className="run-review-unreached"
              open={showUnreached}
              onToggle={(event) => setShowUnreached(event.currentTarget.open)}
            >
              <summary>Not reached · {unreached.length}</summary>
              <ol className="run-reading-list">
                {unreached.map((item) => (
                  <li key={item.prompt.itemId} className="run-reading is-unreached" id={`run-reading-${item.prompt.itemId}`}>
                    <span className="run-reading-stage">{STAGE_LABELS[item.prompt.stage]}</span>
                    <span className="run-prompt-text">{item.prompt.text}</span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      </div>

      <footer className="run-review-actions-v2">
        {replayFailed ? (
          <p className="run-replay-error" role="alert">
            {REPLAY_FAILED}
          </p>
        ) : null}
        {drillsEnabled && !publicMode && onGenerateDrill && drillPhoneme ? (
          <button type="button" className="run-secondary" onClick={leave(() => onGenerateDrill(drillPhoneme))}>
            Generate a drill for /{drillPhoneme}/
          </button>
        ) : null}
        <div className="run-summary-buttons">
          <button type="button" className="run-secondary-v2" onClick={leave(onExit)}>
            Done
          </button>
          <button type="button" className="run-primary-v2" disabled={starting} onClick={leave(onPlayAgain)}>
            {starting ? "Starting…" : "Play again"}
          </button>
        </div>
      </footer>

      {/* The one element that plays every recording in the review. */}
      {playerElement}
    </section>
  );
}
