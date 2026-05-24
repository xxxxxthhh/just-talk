import { describe, expect, test } from "vitest";

import { formatDuration, scoreTone, topAlternative, weakWordsFromResult } from "./scoreUtils";
import type { ScoreResult, WordResult } from "./types";

function word(wordText: string, accuracy: number): WordResult {
  return {
    word: wordText,
    accuracy,
    bucket: "watch",
    error_type: "None",
    offset_ms: 0,
    duration_ms: 100,
    phonemes: []
  };
}

describe("score utilities", () => {
  test("maps numeric scores to visual tones", () => {
    expect(scoreTone(92)).toBe("good");
    expect(scoreTone(72)).toBe("watch");
    expect(scoreTone(40)).toBe("needs-work");
    expect(scoreTone(null)).toBe("unknown");
  });

  test("formats millisecond durations for history rows", () => {
    expect(formatDuration(1200)).toBe("1.2s");
    expect(formatDuration(63_000)).toBe("1m 03s");
  });

  test("finds the strongest non-expected phoneme alternative", () => {
    const alternative = topAlternative("ɛ", [
      { phoneme: "ɛ", score: 47 },
      { phoneme: "ə", score: 52 },
      { phoneme: "ɪ", score: 17 }
    ]);

    expect(alternative?.phoneme).toBe("ə");
  });

  test("extracts weak words sorted by score and deduped case-insensitively", () => {
    const result = {
      transcript: "Quiet streets quickly quiet",
      scores: {
        accuracy: 80,
        fluency: 90,
        completeness: 100,
        prosody: 70,
        pronunciation: 82
      },
      words: [word("quiet", 80), word("streets", 94), word("quickly", 82), word("Quiet", 73)],
      raw: {}
    } satisfies ScoreResult;

    const weakWords = weakWordsFromResult(result, 85);

    expect(weakWords.map((item) => `${item.word}:${item.accuracy}`)).toEqual([
      "Quiet:73",
      "quickly:82"
    ]);
  });
});
