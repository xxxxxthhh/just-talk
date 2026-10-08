import { afterEach, describe, expect, it, vi } from "vitest";

import type { RevisitWordSeed, RunPrompt, VocabularyItem } from "../types";
import { isValidRunDeck, wordsConfig } from "./runConfig";
import { buildWordsDeck, NO_REVISIT_WORDS, snapshotDueWordIds, wordsBankSnapshot } from "./wordDeck";

const NOW = Date.UTC(2026, 9, 9, 12);
const PAST = "2026-10-01T00:00:00Z";
const FUTURE = "2026-12-01T00:00:00Z";

function row(word: string, patch: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: `id-${word.toLowerCase()}`,
    word,
    source: "manual",
    notes: "",
    latest_score: 50,
    practice_count: 1,
    last_practiced_at: null,
    status: "active",
    consecutive_successes: 0,
    graduated_at: null,
    interval_days: 1,
    due_at: FUTURE,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...patch
  };
}

function seed(word: string, firstAccuracy: number, itemIndex = 0): RevisitWordSeed {
  return { word, firstAccuracy, itemIndex, itemId: `item-${itemIndex}`, attemptId: `a-${itemIndex}` };
}

function deck(vocabulary: VocabularyItem[], length: 6 | 12 = 6, reviewSeeds?: RevisitWordSeed[]) {
  return buildWordsDeck({ config: wordsConfig(length), vocabulary, dueWordIds: snapshotDueWordIds(vocabulary), reviewSeeds });
}

function texts(prompts: readonly RunPrompt[]): string[] {
  return prompts.map((prompt) => prompt.text);
}

afterEach(() => vi.restoreAllMocks());

describe("words deck", () => {
  it("words_due_order_then_low_score_null_last", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const vocabulary = [
      row("unscored", { latest_score: null }),
      row("high", { latest_score: 90 }),
      row("low", { latest_score: 20 }),
      row("lateDue", { due_at: "2026-10-05T00:00:00Z", latest_score: 99 }),
      row("earlyDue", { due_at: "2026-10-02T00:00:00Z", latest_score: 99 }),
      row("never", { due_at: null, latest_score: 99 }),
      row("tieB", { latest_score: 40, id: "id-b" }),
      row("tieA", { latest_score: 40, id: "id-z" }),
      row("nan", { latest_score: Number.NaN })
    ];
    const prompts = deck(vocabulary, 6);
    // Due first in the review queue's order (missing dates first), then lowest latest score; equal
    // scores by word; unscored last.
    expect(texts(prompts)).toEqual(["never", "earlyDue", "lateDue", "low", "tieA", "tieB"]);
    expect(prompts.every((prompt) => prompt.source === "word-bank")).toBe(true);
    const twelve = buildWordsDeck({
      config: wordsConfig(12),
      vocabulary: [...vocabulary, row("w1"), row("w2"), row("w3")],
      dueWordIds: snapshotDueWordIds(vocabulary)
    });
    expect(texts(twelve).slice(6)).toEqual(["w1", "w2", "w3", "high", "nan", "unscored"]);

    // The order is the same on every call and ignores the bank's input order.
    expect(deck([...vocabulary].reverse(), 6)).toEqual(prompts);
  });

  it("words_single_key_dedupe_and_graduated_exclusion", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const vocabulary = [
      row("think!", { id: "id-1", latest_score: 10 }),
      row("Think", { id: "id-2", latest_score: 5 }),
      row("path", { id: "id-3", latest_score: 10 }),
      row("(path)", { id: "id-4", status: "graduated" }),
      row("done", { status: "graduated", latest_score: 1 }),
      row("two words", { latest_score: 1 }),
      ...["a1", "a2", "a3", "a4", "a5"].map((word) => row(word))
    ];
    const snapshot = wordsBankSnapshot(vocabulary);
    // One row per key (smallest ID); a key with any graduated row is gone; multi-word rows never enter.
    expect(snapshot.map((item) => item.id)).toEqual(["id-a1", "id-a2", "id-a3", "id-a4", "id-a5", "id-1"]);
    const prompts = deck(vocabulary, 6);
    expect(texts(prompts)).toEqual(["think!", "a1", "a2", "a3", "a4", "a5"]);
    expect(texts(prompts)).not.toContain("done");
  });

  it("words_preserve_display_and_reference_case", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const vocabulary = [
      row("Paris", { id: "id-a", latest_score: 10 }),
      row("paris", { id: "id-b", latest_score: 5 }),
      row("  iPhone ", { latest_score: 20 }),
      ...["b1", "b2", "b3", "b4"].map((word) => row(word))
    ];
    const prompts = deck(vocabulary, 6);
    expect(prompts[0]).toMatchObject({ text: "Paris", targetWord: "Paris" });
    expect(prompts[1]).toMatchObject({ text: "iPhone", targetWord: "iPhone" });
    expect(prompts.map((prompt) => prompt.itemId)).toEqual(["words-1", "words-2", "words-3", "words-4", "words-5", "words-6"]);
    for (const prompt of prompts) {
      expect(prompt).toMatchObject({ stage: "words", kind: "word", targetPhoneme: null, targetWord: prompt.text });
    }
    expect(isValidRunDeck(wordsConfig(6), prompts)).toBe(true);
    expect(Object.isFrozen(prompts)).toBe(true);
    expect(prompts.every((prompt) => Object.isFrozen(prompt))).toBe(true);
  });

  it("words_exact_6_12_no_padding_or_autoshrink", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const five = ["c1", "c2", "c3", "c4", "c5"].map((word) => row(word));
    expect(() => deck(five, 6)).toThrow("Add more active single words to start a 6-word run.");
    const eight = [...five, row("c6"), row("c7"), row("c8")];
    expect(deck(eight, 6)).toHaveLength(6);
    expect(() => deck(eight, 12)).toThrow("Need 12 active words · 8 available");
    // Graduated rows are never used to reach N.
    const padded = [...eight, ...["g1", "g2", "g3", "g4"].map((word) => row(word, { status: "graduated" }))];
    expect(() => deck(padded, 12)).toThrow("Need 12 active words · 8 available");
    expect(deck([...eight, row("c9"), row("c10"), row("c11"), row("c12"), row("c13")], 12)).toHaveLength(12);
  });

  it("revisit_excludes_graduated_and_fills_after_absent_seeds", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const vocabulary = [
      row("due", { due_at: PAST }),
      row("Brother", { latest_score: 30 }),
      row("done", { status: "graduated" }),
      ...["d1", "d2", "d3", "d4"].map((word) => row(word))
    ];
    const seeds = [seed("brother", 40, 5), seed("done", 50, 1), seed("window", 70, 4)];
    const prompts = deck(vocabulary, 6, seeds);
    // Seeds first (keeping their own case, absent-bank seeds included), then due, then low score.
    expect(prompts.map((prompt) => [prompt.text, prompt.source])).toEqual([
      ["brother", "run-review"],
      ["window", "run-review"],
      ["due", "word-bank"],
      ["d1", "word-bank"],
      ["d2", "word-bank"],
      ["d3", "word-bank"]
    ]);

    // Every seed graduated: nothing to revisit, never a bank-only run instead.
    expect(() => deck(vocabulary, 6, [seed("done", 50)])).toThrow(NO_REVISIT_WORDS);
    // Seeds plus bank still short of N ("Brother" in the bank is the same word as the seed).
    expect(() => deck(vocabulary, 12, seeds)).toThrow("Need 12 active words · 7 available");
  });
});
