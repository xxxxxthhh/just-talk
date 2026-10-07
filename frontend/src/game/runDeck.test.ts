import { describe, expect, it } from "vitest";

import type { PhonemeStat, VocabularyItem } from "../types";
import { buildRunDeck, chooseFocusPhoneme } from "./runDeck";
import { STARTER_PACK } from "./starterPack";

function stat(phoneme: string, average_accuracy: number): PhonemeStat {
  return {
    phoneme,
    average_accuracy,
    attempts: 5,
    needs_work_count: 0,
    watch_count: 0,
    good_count: 0,
    bucket: "watch",
    last_seen_at: "2026-10-01T00:00:00Z",
    example_words: [],
  };
}

function vocab(word: string, due_at: string | null, status: VocabularyItem["status"] = "active"): VocabularyItem {
  return {
    id: `id-${word}`,
    word,
    source: "manual",
    notes: "",
    latest_score: 50,
    practice_count: 1,
    last_practiced_at: null,
    status,
    consecutive_successes: 0,
    graduated_at: null,
    interval_days: 1,
    due_at,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

function wordsIn(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

describe("starter pack", () => {
  it("starter_pack_has_thirty_items_and_valid_six_item_groups", () => {
    expect(STARTER_PACK).toHaveLength(30);
    expect(new Set(STARTER_PACK.map((item) => item.id)).size).toBe(30);
    expect(new Set(STARTER_PACK.map((item) => item.text)).size).toBe(30);

    const groups = new Map<string, typeof STARTER_PACK>();
    for (const item of STARTER_PACK) {
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    }
    expect([...groups.keys()].sort()).toEqual(["eth", "l", "r", "theta", "v"]);

    for (const items of groups.values()) {
      expect(new Set(items.map((item) => item.phoneme)).size).toBe(1);
      expect(items.map((item) => item.stage)).toEqual([
        "warmup",
        "warmup",
        "focus",
        "focus",
        "context",
        "context",
      ]);
      const wordItems = items.filter((item) => item.stage !== "context");
      for (const item of wordItems) {
        expect(item.targetWord).toBe(item.text);
        expect(wordsIn(item.text)).toHaveLength(1);
      }
      const [reuse, fresh] = items.filter((item) => item.stage === "context");
      for (const sentence of [reuse, fresh]) {
        const words = wordsIn(sentence.text);
        expect(words.length).toBeGreaterThanOrEqual(5);
        expect(words.length).toBeLessThanOrEqual(9);
        expect(words).toContain(sentence.targetWord);
      }
      const focusWords = items.filter((item) => item.stage === "focus").map((item) => item.text);
      expect(focusWords).toContain(reuse.targetWord);
      expect(wordItems.map((item) => item.text)).not.toContain(fresh.targetWord);
    }
  });
});

describe("chooseFocusPhoneme", () => {
  it("focus_intersects_stats_with_pack_or_uses_default", () => {
    // The weakest overall (ʃ) is outside the pack; r maps to the pack's ɹ.
    expect(chooseFocusPhoneme([stat("ʃ", 30), stat("v", 70), stat("r", 55), stat("l", 60)])).toBe("ɹ");
    expect(chooseFocusPhoneme([stat("ɹ", 80), stat("ð", 40)])).toBe("ð");
    expect(chooseFocusPhoneme([stat("ʃ", 30), stat("æ", 40)])).toBe("θ");
    expect(chooseFocusPhoneme([])).toBe("θ");
  });
});

describe("buildRunDeck", () => {
  const past = (day: number) => `2026-09-${String(day).padStart(2, "0")}T00:00:00Z`;

  it("deck_freezes_due_order_and_filters_external_word_collisions", () => {
    const vocabulary = [
      vocab("later", past(20)),
      vocab("Think", past(1)), // focus word of the θ group
      vocab("path", past(2)), // new-context target of the θ group
      vocab("earliest", past(5)),
      vocab("graduated", past(3), "graduated"),
      vocab("future", "2999-01-01T00:00:00Z"),
    ];

    const deck = buildRunDeck({ phonemeStats: [], vocabulary });

    expect(deck.map((prompt) => [prompt.stage, prompt.kind, prompt.text, prompt.source])).toEqual([
      ["warmup", "word", "earliest", "due-word"],
      ["warmup", "word", "later", "due-word"],
      ["focus", "word", "think", "starter"],
      ["focus", "word", "thank", "starter"],
      ["context", "sentence", "I think we can walk home now.", "starter"],
      ["context", "sentence", "The narrow path leads to our house.", "starter"],
    ]);
    expect(new Set(deck.map((prompt) => prompt.itemId)).size).toBe(6);
    expect(deck.slice(2).every((prompt) => prompt.targetPhoneme === "θ")).toBe(true);
    expect(deck[0].targetPhoneme).toBeNull();
    expect(deck[4].targetWord).toBe("think");
    expect(deck[5].targetWord).toBe("path");

    expect(Object.isFrozen(deck)).toBe(true);
    expect(deck.every((prompt) => Object.isFrozen(prompt))).toBe(true);
    vocabulary.splice(0, vocabulary.length);
    expect(deck[0].text).toBe("earliest");
  });

  it("play_again_prefers_eligible_previous_weak_words", () => {
    const vocabulary = [vocab("water", past(1)), vocab("bright", past(2))];

    const replay = buildRunDeck({
      phonemeStats: [stat("l", 40)],
      vocabulary,
      previousWeakWords: [" Late ", "", "Water", "lake"],
    });
    // "late" and "lake" collide with the l group; "water" is not repeated by the due list.
    expect(replay.slice(0, 2).map((prompt) => [prompt.text, prompt.source])).toEqual([
      ["Water", "previous-run"],
      ["bright", "due-word"],
    ]);
    expect(replay[2].text).toBe("late");

    const empty = buildRunDeck({ phonemeStats: [stat("l", 40)], vocabulary: [], previousWeakWords: ["late"] });
    expect(empty.slice(0, 2).map((prompt) => [prompt.text, prompt.source])).toEqual([
      ["light", "starter"],
      ["leaf", "starter"],
    ]);
    expect(empty[0].targetPhoneme).toBe("l");
  });
});
