import "../game/game.css";
import { judge } from "../game/runModel";
import { normalizedWord, scoreTone, scoreValue } from "../scoreUtils";
import type { Attempt, RunItem, RunPrompt, RunState, WordCandidate } from "../types";
import { latestValid, validAccuracy } from "./PracticeRun";

// Matches the Challenge pass line: a phoneme or word under it counts as low.
const LOW = 60;
const BORDERLINE = 80;
const MAX_ACTIONS = 3;
const MAX_EVIDENCE = 3;

// What a suggestion rests on: the word (and phoneme) score returned for one
// attempt, so the review can show that score beside its recording.
export type Evidence = {
  item: RunItem;
  attempt: Attempt;
  word: string;
  phoneme: string | null;
  accuracy: number;
};

export type ReviewAction = { id: "phoneme" | "low" | "borderline"; summary: string; evidence: Evidence[] };

function latestWords(run: RunState) {
  return run.items.flatMap((item) => {
    const latest = latestValid(item);
    if (!latest) return [];
    return (latest.attempt.result?.words ?? [])
      .filter((word) => normalizedWord(word.word))
      .map((word) => ({ item, attempt: latest.attempt, word }));
  });
}

// The weakest reading of each distinct word in [min, max), weakest first.
function wordEvidence(run: RunState, min: number, max: number): Evidence[] {
  const weakest = new Map<string, Evidence>();
  for (const { item, attempt, word } of latestWords(run)) {
    if (typeof word.accuracy !== "number" || word.accuracy < min || word.accuracy >= max) continue;
    const key = normalizedWord(word.word);
    const existing = weakest.get(key);
    if (!existing || word.accuracy < existing.accuracy) {
      weakest.set(key, { item, attempt, word: word.word.trim(), phoneme: null, accuracy: word.accuracy });
    }
  }
  return [...weakest.values()].sort((left, right) => left.accuracy - right.accuracy);
}

function lowAndBorderline(run: RunState): [Evidence[], Evidence[]] {
  const low = wordEvidence(run, -Infinity, LOW);
  const lowKeys = new Set(low.map((evidence) => normalizedWord(evidence.word)));
  const borderline = wordEvidence(run, LOW, BORDERLINE).filter(
    (evidence) => !lowKeys.has(normalizedWord(evidence.word))
  );
  return [low, borderline];
}

// Words from this run worth warming up with next time, weakest first.
export function runWeakWords(run: RunState): string[] {
  return lowAndBorderline(run)
    .flat()
    .map((evidence) => normalizedWord(evidence.word));
}

// The low phoneme seen in the most distinct items (at least two), with the
// weakest occurrence from each item.
function repeatedLowPhoneme(run: RunState): { phoneme: string; evidence: Evidence[] } | null {
  const byPhoneme = new Map<string, Map<string, Evidence>>();
  for (const { item, attempt, word } of latestWords(run)) {
    for (const phoneme of word.phonemes) {
      if (typeof phoneme.accuracy !== "number" || phoneme.accuracy >= LOW) continue;
      const perItem = byPhoneme.get(phoneme.phoneme) ?? new Map<string, Evidence>();
      const existing = perItem.get(item.prompt.itemId);
      if (!existing || phoneme.accuracy < existing.accuracy) {
        perItem.set(item.prompt.itemId, {
          item,
          attempt,
          word: word.word.trim(),
          phoneme: phoneme.phoneme,
          accuracy: phoneme.accuracy,
        });
      }
      byPhoneme.set(phoneme.phoneme, perItem);
    }
  }
  let best: { phoneme: string; evidence: Evidence[] } | null = null;
  for (const [phoneme, perItem] of byPhoneme) {
    if (perItem.size >= 2 && (!best || perItem.size > best.evidence.length)) {
      best = { phoneme, evidence: [...perItem.values()].sort((left, right) => left.accuracy - right.accuracy) };
    }
  }
  return best;
}

export function reviewActions(run: RunState): ReviewAction[] {
  const actions: ReviewAction[] = [];
  const phoneme = repeatedLowPhoneme(run);
  if (phoneme) {
    actions.push({
      id: "phoneme",
      summary: `The /${phoneme.phoneme}/ sound was low in ${phoneme.evidence.length} items.`,
      evidence: phoneme.evidence,
    });
  }
  const [low, borderline] = lowAndBorderline(run);
  if (low.length) actions.push({ id: "low", summary: "Re-listen and repeat these words.", evidence: low });
  if (borderline.length) actions.push({ id: "borderline", summary: "Almost there.", evidence: borderline });
  return actions.slice(0, MAX_ACTIONS);
}

function itemStatus(item: RunItem, reached: boolean): string {
  const practiced = latestValid(item) !== null;
  if (!reached) return "Not reached";
  if (item.resolution === "skipped") return practiced ? "Practiced · rescue skipped" : "Skipped";
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
            <li key={action.id}>
              <p>{action.summary}</p>
              <ul className="run-evidence">
                {action.evidence.slice(0, MAX_EVIDENCE).map((evidence) => {
                  const url = attemptAudioUrls[evidence.attempt.key.attemptId];
                  const label = evidence.phoneme
                    ? `/${evidence.phoneme}/ in “${evidence.word}”`
                    : `“${evidence.word}”`;
                  return (
                    <li key={`${evidence.attempt.key.attemptId}-${evidence.word}-${evidence.phoneme ?? ""}`}>
                      <span>{label}</span>
                      <strong className={`run-review-score ${scoreTone(evidence.accuracy)}`}>
                        {scoreValue(evidence.accuracy)}
                      </strong>
                      {evidence.item.prompt.kind === "sentence" ? (
                        <span className="run-note">{evidence.item.prompt.text}</span>
                      ) : null}
                      <button
                        type="button"
                        className="m-small-button"
                        onClick={() => onPlayReference(evidence.item.prompt)}
                      >
                        Hear it
                      </button>
                      {url ? (
                        <audio controls preload="none" src={url} aria-label={`Your recording for ${label}`} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
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
      {weakWords.length ? <p className="run-note">Lowest words this run: {weakWords.slice(0, 2).join(", ")}</p> : null}
    </section>
  );
}
