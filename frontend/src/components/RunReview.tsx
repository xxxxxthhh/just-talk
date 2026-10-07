import "../game/game.css";
import { judge } from "../game/runModel";
import { normalizedWord, scoreTone, scoreValue } from "../scoreUtils";
import type { Attempt, RunItem, RunPrompt, RunState, WordCandidate } from "../types";
import { latestValid, validAccuracy } from "./PracticeRun";

// Matches the Challenge pass line: a phoneme or word under it counts as low.
const LOW = 60;
const BORDERLINE = 80;
const MAX_ACTIONS = 3;

type WordScore = { word: string; accuracy: number };

function latestWordScores(run: RunState): WordScore[][] {
  return run.items.map((item) => {
    const result = latestValid(item)?.attempt.result;
    return (result?.words ?? []).flatMap((word) =>
      typeof word.accuracy === "number" && normalizedWord(word.word)
        ? [{ word: word.word.trim(), accuracy: word.accuracy }]
        : []
    );
  });
}

function wordsInRange(run: RunState, min: number, max: number): string[] {
  const seen = new Set<string>();
  return latestWordScores(run)
    .flat()
    .filter((score) => score.accuracy >= min && score.accuracy < max)
    .sort((left, right) => left.accuracy - right.accuracy)
    .flatMap((score) => {
      const key = normalizedWord(score.word);
      if (seen.has(key)) return [];
      seen.add(key);
      return [key];
    });
}

// Words from this run worth warming up with next time, weakest first.
export function runWeakWords(run: RunState): string[] {
  const low = wordsInRange(run, -Infinity, LOW);
  return [...low, ...wordsInRange(run, LOW, BORDERLINE).filter((word) => !low.includes(word))];
}

function repeatedLowPhoneme(run: RunState): { phoneme: string; words: string[] } | null {
  const byPhoneme = new Map<string, { items: Set<string>; words: string[] }>();
  for (const item of run.items) {
    const result = latestValid(item)?.attempt.result;
    for (const word of result?.words ?? []) {
      for (const phoneme of word.phonemes) {
        if (typeof phoneme.accuracy !== "number" || phoneme.accuracy >= LOW) continue;
        const entry = byPhoneme.get(phoneme.phoneme) ?? { items: new Set(), words: [] };
        entry.items.add(item.prompt.itemId);
        const key = normalizedWord(word.word);
        if (!entry.words.includes(key)) entry.words.push(key);
        byPhoneme.set(phoneme.phoneme, entry);
      }
    }
  }
  let best: { phoneme: string; words: string[]; count: number } | null = null;
  for (const [phoneme, entry] of byPhoneme) {
    if (entry.items.size >= 2 && (!best || entry.items.size > best.count)) {
      best = { phoneme, words: entry.words, count: entry.items.size };
    }
  }
  return best;
}

export function reviewActions(run: RunState): string[] {
  const actions: string[] = [];
  const phoneme = repeatedLowPhoneme(run);
  if (phoneme) actions.push(`The /${phoneme.phoneme}/ sound was low in more than one item: ${phoneme.words.join(", ")}.`);
  const low = wordsInRange(run, -Infinity, LOW);
  if (low.length) actions.push(`Re-listen and repeat: ${low.join(", ")}.`);
  const borderline = wordsInRange(run, LOW, BORDERLINE).filter((word) => !low.includes(word));
  if (borderline.length) actions.push(`Almost there: ${borderline.join(", ")}.`);
  return actions.slice(0, MAX_ACTIONS);
}

function itemStatus(item: RunItem, reached: boolean): string {
  const practiced = latestValid(item) !== null;
  if (!reached) return "Not reached";
  if (item.resolution === "skipped") return "Skipped";
  if (item.resolution === "pending") return practiced ? "Practiced · score pending" : "Score pending";
  if (item.resolution === "unjudged") {
    const reason = item.verdict === "cannot-confirm" ? "not confirmed" : "unscored";
    return practiced ? `Practiced · ${reason}` : reason[0].toUpperCase() + reason.slice(1);
  }
  if (item.resolution === "open") return practiced ? "Practiced · unresolved" : "Unresolved";
  return "Practiced";
}

function attemptLabel(attempt: Attempt): string {
  if (attempt.status === "pending") return "Score pending";
  if (!attempt.result) return "Unscored";
  const judgment = judge(attempt.result);
  if (judgment.kind === "valid") return scoreValue(judgment.accuracy);
  return judgment.kind === "no-match" ? "No speech heard" : "Unscored";
}

const CANDIDATE_LABELS: Record<WordCandidate["status"], string> = {
  processed: "sent to word bank",
  unconfirmed: "not confirmed",
  "save-manually": "save manually",
};

function CandidateStatus({ attempt }: { attempt: Attempt }) {
  if (attempt.sync === "not-needed" || attempt.sync === "done" && attempt.candidates.length === 0) return null;
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

type RunReviewProps = {
  run: RunState;
  // Object URLs for retained attempt recordings, owned by the run hook.
  attemptAudioUrls: Readonly<Record<string, string>>;
  publicMode: boolean;
  drillsEnabled: boolean;
  onPlayReference: (prompt: RunPrompt) => void;
  onPlayAgain: () => void;
  onGenerateDrill?: (phoneme: string) => void;
  onExit: () => void;
};

export function RunReview({
  run,
  attemptAudioUrls,
  publicMode,
  drillsEnabled,
  onPlayReference,
  onPlayAgain,
  onGenerateDrill,
  onExit,
}: RunReviewProps) {
  const reached = (index: number) => index <= run.index;
  const practiced = run.items.filter((item) => latestValid(item) !== null).length;
  const skipped = run.items.filter((item) => item.resolution === "skipped").length;
  const unresolved = run.items.filter(
    (item, index) => reached(index) && item.resolution !== "resolved" && item.resolution !== "skipped"
  ).length;
  const unreached = run.items.length - (run.index + 1);
  const actions = reviewActions(run);
  const weakWords = runWeakWords(run);
  const drillPhoneme =
    repeatedLowPhoneme(run)?.phoneme ??
    run.items.find((item) => item.prompt.stage === "focus")?.prompt.targetPhoneme ??
    null;

  return (
    <section className="run run-review" aria-label="Run review">
      <header className="run-review-header">
        <h2>{run.mode === "challenge" ? "Challenge review" : "Route review"}</h2>
        {run.mode === "challenge" && run.challengeOutcome ? (
          <p>
            {run.challengeOutcome === "cleared"
              ? "Cleared"
              : run.challengeOutcome === "failed"
                ? "Out of hearts"
                : "Incomplete"}
            {run.hearts !== null ? ` · ${run.hearts} of 2 hearts left` : ""}
          </p>
        ) : null}
        {run.endReason === "quota" ? <p>Trial usage ran out for today. Your results so far are kept.</p> : null}
        <ul className="run-review-stats">
          <li>
            Practiced {practiced} of {run.items.length}
          </li>
          {skipped ? <li>Skipped {skipped}</li> : null}
          {unresolved ? <li>Unresolved {unresolved}</li> : null}
          {unreached > 0 ? <li>Not reached {unreached}</li> : null}
        </ul>
      </header>

      {actions.length ? (
        <ol className="run-review-actions" aria-label="What to practice next">
          {actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
      ) : null}

      <ol className="run-review-items">
        {run.items.map((item, index) => (
          <li key={item.prompt.itemId} className="run-review-item">
            <div className="run-review-item-head">
              <span className="run-stage">{item.prompt.stage}</span>
              <p className="run-prompt-text">{item.prompt.text}</p>
              <span className="run-review-status">{itemStatus(item, reached(index))}</span>
              <button type="button" className="m-small-button" onClick={() => onPlayReference(item.prompt)}>
                Hear it
              </button>
            </div>
            {item.attempts.map((attempt, attemptIndex) => {
              const url = attemptAudioUrls[attempt.key.attemptId];
              return (
                <div key={attempt.key.attemptId} className="run-review-attempt">
                  <strong className={`run-review-score ${scoreTone(validAccuracy(attempt))}`}>
                    {attemptLabel(attempt)}
                  </strong>
                  {url ? (
                    <audio
                      controls
                      preload="none"
                      src={url}
                      aria-label={`Your recording ${attemptIndex + 1} of “${item.prompt.text}”`}
                    />
                  ) : null}
                  <CandidateStatus attempt={attempt} />
                </div>
              );
            })}
          </li>
        ))}
      </ol>

      <div className="run-actions">
        <button type="button" className="run-primary" onClick={onPlayAgain}>
          Play again
        </button>
        {drillsEnabled && !publicMode && onGenerateDrill && drillPhoneme ? (
          <button type="button" className="m-small-button" onClick={() => onGenerateDrill(drillPhoneme)}>
            Generate a drill for /{drillPhoneme}/
          </button>
        ) : null}
        <button type="button" className="m-small-button" onClick={onExit}>
          Done
        </button>
      </div>
      {weakWords.length ? <p className="run-note">Play again warms up with: {weakWords.slice(0, 2).join(", ")}</p> : null}
    </section>
  );
}
