import type { ScoreResult, WordResult } from "./types";

export type ScoreTone = "good" | "watch" | "needs-work" | "unknown";

export function scoreValue(score: number | null | undefined): string {
  return score === null || score === undefined ? "--" : Math.round(score).toString();
}

export type PhonemeCandidate = {
  phoneme: string;
  score: number | null;
};

export function scoreTone(score: number | null | undefined): ScoreTone {
  if (score === null || score === undefined) {
    return "unknown";
  }
  if (score >= 80) {
    return "good";
  }
  if (score >= 60) {
    return "watch";
  }
  return "needs-work";
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}m ${seconds}s`;
}

export function topAlternative(
  expectedPhoneme: string,
  candidates: PhonemeCandidate[]
): PhonemeCandidate | null {
  const alternatives = candidates
    .filter((candidate) => candidate.phoneme !== expectedPhoneme)
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  return alternatives[0] ?? null;
}

export function weakWordsFromResult(result: ScoreResult, maxScore = 85): WordResult[] {
  const weakestByWord = new Map<string, WordResult>();

  for (const word of result.words) {
    if (word.accuracy === null || word.accuracy === undefined || word.accuracy > maxScore) {
      continue;
    }
    const normalizedWord = word.word.trim().toLocaleLowerCase();
    if (!normalizedWord) {
      continue;
    }
    const existing = weakestByWord.get(normalizedWord);
    if (!existing || (word.accuracy ?? 101) < (existing.accuracy ?? 101)) {
      weakestByWord.set(normalizedWord, word);
    }
  }

  return [...weakestByWord.values()].sort((left, right) => {
    const scoreDelta = (left.accuracy ?? 101) - (right.accuracy ?? 101);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.word.localeCompare(right.word);
  });
}
