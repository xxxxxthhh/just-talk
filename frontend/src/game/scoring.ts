import { normalizedWord } from "../scoreUtils";
import type {
  Attempt,
  RevisitEvidence,
  RevisitSuggestion,
  RunItem,
  RunItemScore,
  RunRating,
  RunScoreView,
  RunState,
  RunTier,
  WordResult
} from "../types";
import { judge, PASS_ACCURACY } from "./runModel";

// Game facts derived from RunState. Nothing here costs a heart: hearts stay on the reducer's 60 line.

// Bumped when tiers, points or ratings change, so personal bests never compare across rules.
export const RUN_RULES_VERSION = 1;
export const PERFECT_ACCURACY = 95;
export const GREAT_ACCURACY = 85;
const BASE_PER_POINT = 1.5;
const CHAIN_BONUS = 100;
const CHAIN_STEPS = 15;
const BORDERLINE = 80;
const MAX_SUGGESTIONS = 3;

// Compares raw values: 84.9 is Good even though it displays as 85.
export function tierForAccuracy(accuracy: number | null): RunTier | null {
  if (accuracy === null || !Number.isFinite(accuracy)) return null;
  if (accuracy >= PERFECT_ACCURACY) return "perfect";
  if (accuracy >= GREAT_ACCURACY) return "great";
  if (accuracy >= PASS_ACCURACY) return "good";
  return "relisten";
}

export function ratingForPoints(points: number): RunRating {
  if (points >= 950) return "S";
  if (points >= 850) return "A";
  if (points >= 700) return "B";
  return "C";
}

// Sentence word collection still syncing is not part of judgeability.
export function validAccuracy(attempt: Attempt): number | null {
  if (attempt.status !== "scored" || !attempt.result) return null;
  const judgment = judge(attempt.result);
  return judgment.kind === "valid" ? judgment.accuracy : null;
}

// The item's first valid reading: the score its chain and points use. A rescue never replaces it.
export function firstValid(item: RunItem): { attempt: Attempt; accuracy: number } | null {
  for (const attempt of item.attempts) {
    const accuracy = validAccuracy(attempt);
    if (accuracy !== null) return { attempt, accuracy };
  }
  return null;
}

export function latestValid(item: RunItem): { attempt: Attempt; accuracy: number } | null {
  for (let i = item.attempts.length - 1; i >= 0; i -= 1) {
    const accuracy = validAccuracy(item.attempts[i]);
    if (accuracy !== null) return { attempt: item.attempts[i], accuracy };
  }
  return null;
}

function unratedReason(run: RunState, complete: boolean): string {
  if (run.endReason === "hearts-exhausted") return "Out of hearts";
  if (run.endReason === "quit") return "Quit";
  if (run.endReason === "quota") return "Usage limit reached";
  // A Challenge whose rescue was skipped has every first reading but did not clear.
  return complete ? "Incomplete" : "Not every item scored";
}

// Points are 1.5 × each first reading plus 100/15 per chain step past the first, rounded once over the
// whole run. Missing slots add nothing, so a partial run is never re-normalized. While the run is live,
// rated is false and unratedReason is null.
export function selectRunScore(run: RunState): RunScoreView {
  const ended = run.endReason !== null;
  const items: RunItemScore[] = [];
  let carry = 0;
  let longestChain = 0;
  let currentChain = 0;
  let sumQ = 0;
  let sumSteps = 0;
  run.items.forEach((item, index) => {
    const itemId = item.prompt.itemId;
    const reached = index <= run.index;
    const accuracy = reached ? firstValid(item)?.accuracy ?? null : null;
    if (accuracy === null) {
      // Still on an unjudged item holds the chain; leaving it without a valid reading breaks it.
      if (reached && (ended || index < run.index)) carry = 0;
      items.push({ itemId, firstAccuracy: null, tier: null, chain: 0, basePoints: 0, chainPoints: 0 });
    } else {
      carry = accuracy >= GREAT_ACCURACY ? carry + 1 : 0;
      const steps = Math.max(carry - 1, 0);
      sumQ += accuracy;
      sumSteps += steps;
      longestChain = Math.max(longestChain, carry);
      items.push({
        itemId,
        firstAccuracy: accuracy,
        tier: tierForAccuracy(accuracy),
        chain: carry,
        basePoints: BASE_PER_POINT * accuracy,
        chainPoints: (CHAIN_BONUS * steps) / CHAIN_STEPS
      });
    }
    if (reached) currentChain = carry;
  });
  // Summed before dividing so .5 totals (860.5 → 861) cannot drift below the rounding edge.
  const points = Math.round(BASE_PER_POINT * sumQ + (CHAIN_BONUS * sumSteps) / CHAIN_STEPS);
  const complete = items.every((item) => item.firstAccuracy !== null);
  const finished = run.mode === "route" ? run.endReason === "completed" : run.challengeOutcome === "cleared";
  const rated = ended && complete && finished;
  return {
    items,
    points,
    currentChain,
    longestChain,
    rated,
    rating: rated ? ratingForPoints(points) : null,
    unratedReason: rated || !ended ? null : unratedReason(run, complete),
    fullCombo: rated && items.every((item) => (item.firstAccuracy ?? 0) >= GREAT_ACCURACY)
  };
}

type WordReading = { item: RunItem; attempt: Attempt; word: WordResult };

// Review evidence uses each item's latest valid reading, as in v1.
function latestWords(run: RunState): WordReading[] {
  return run.items.flatMap((item) => {
    const latest = latestValid(item);
    if (!latest) return [];
    return (latest.attempt.result?.words ?? [])
      .filter((word) => normalizedWord(word.word))
      .map((word) => ({ item, attempt: latest.attempt, word }));
  });
}

function evidence(reading: WordReading, accuracy: number, phoneme: string | null): RevisitEvidence {
  return {
    itemId: reading.item.prompt.itemId,
    attemptId: reading.attempt.key.attemptId,
    word: reading.word.word.trim(),
    phoneme,
    accuracy,
    scoreSource: phoneme === null ? "word" : "phoneme"
  };
}

// The weakest reading of each distinct word in [min, max), weakest first.
function wordEvidence(run: RunState, min: number, max: number): RevisitEvidence[] {
  const weakest = new Map<string, RevisitEvidence>();
  for (const reading of latestWords(run)) {
    const accuracy = reading.word.accuracy;
    if (typeof accuracy !== "number" || accuracy < min || accuracy >= max) continue;
    const key = normalizedWord(reading.word.word);
    const existing = weakest.get(key);
    if (!existing || accuracy < existing.accuracy) weakest.set(key, evidence(reading, accuracy, null));
  }
  return [...weakest.values()].sort((left, right) => left.accuracy - right.accuracy);
}

function lowAndBorderline(run: RunState): [RevisitEvidence[], RevisitEvidence[]] {
  const low = wordEvidence(run, -Infinity, PASS_ACCURACY);
  const lowKeys = new Set(low.map((item) => normalizedWord(item.word)));
  const borderline = wordEvidence(run, PASS_ACCURACY, BORDERLINE).filter(
    (item) => !lowKeys.has(normalizedWord(item.word))
  );
  return [low, borderline];
}

// Words from this run worth warming up with next time, weakest first.
export function runWeakWords(run: RunState): string[] {
  return lowAndBorderline(run)
    .flat()
    .map((item) => normalizedWord(item.word));
}

// The low phoneme seen in the most distinct items (at least two), with the weakest occurrence per item.
function repeatedLowPhoneme(run: RunState): { phoneme: string; evidence: RevisitEvidence[] } | null {
  const byPhoneme = new Map<string, Map<string, RevisitEvidence>>();
  for (const reading of latestWords(run)) {
    for (const phoneme of reading.word.phonemes) {
      if (typeof phoneme.accuracy !== "number" || phoneme.accuracy >= PASS_ACCURACY) continue;
      const perItem = byPhoneme.get(phoneme.phoneme) ?? new Map<string, RevisitEvidence>();
      const existing = perItem.get(reading.item.prompt.itemId);
      if (!existing || phoneme.accuracy < existing.accuracy) {
        perItem.set(reading.item.prompt.itemId, evidence(reading, phoneme.accuracy, phoneme.phoneme));
      }
      byPhoneme.set(phoneme.phoneme, perItem);
    }
  }
  let best: { phoneme: string; evidence: RevisitEvidence[] } | null = null;
  for (const [phoneme, perItem] of byPhoneme) {
    if (perItem.size >= 2 && (!best || perItem.size > best.evidence.length)) {
      best = { phoneme, evidence: [...perItem.values()].sort((left, right) => left.accuracy - right.accuracy) };
    }
  }
  return best;
}

// Up to three suggestions. A recording backs at most one of them, so the same take never
// appears as both a sound card and a word card.
export function selectReviewSuggestions(run: RunState): readonly RevisitSuggestion[] {
  const candidates: RevisitSuggestion[] = [];
  const phoneme = repeatedLowPhoneme(run);
  if (phoneme) {
    candidates.push({
      id: "phoneme",
      summary: `The /${phoneme.phoneme}/ sound was low in ${phoneme.evidence.length} items.`,
      evidence: phoneme.evidence
    });
  }
  const [low, borderline] = lowAndBorderline(run);
  candidates.push({ id: "low", summary: "Re-listen and repeat these words.", evidence: low });
  candidates.push({ id: "borderline", summary: "Almost there.", evidence: borderline });

  const used = new Set<string>();
  const suggestions: RevisitSuggestion[] = [];
  for (const candidate of candidates) {
    const fresh = candidate.evidence.filter((item) => !used.has(item.attemptId));
    if (fresh.length === 0) continue;
    fresh.forEach((item) => used.add(item.attemptId));
    suggestions.push({ ...candidate, evidence: fresh });
  }
  return suggestions.slice(0, MAX_SUGGESTIONS);
}

// The summary's single "One thing to revisit": the first suggestion's weakest evidence.
export function topRevisitOf(suggestions: readonly RevisitSuggestion[]): RevisitSuggestion | null {
  const [top] = suggestions;
  return top ? { ...top, evidence: top.evidence.slice(0, 1) } : null;
}

export function selectTopRevisit(run: RunState): RevisitSuggestion | null {
  return topRevisitOf(selectReviewSuggestions(run));
}
