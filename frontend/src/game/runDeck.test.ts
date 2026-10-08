import { afterEach, describe, expect, it, vi } from "vitest";

import type { PhonemeStat, RunFocusPhoneme, RunPrompt, VocabularyItem } from "../types";
import { configForChoice, isValidRunDeck } from "./runConfig";
import { buildRunDeck, chooseFocusPhoneme } from "./runDeck";
import { STARTER_PACK, type StarterItem } from "./starterPack";

// Tests may swap in a synthetic four-per-stage pack; the others read the shipped one.
const pack = vi.hoisted(() => ({ override: null as readonly unknown[] | null }));
vi.mock("./starterPack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./starterPack")>();
  return {
    ...actual,
    get STARTER_PACK() {
      return pack.override ?? actual.STARTER_PACK;
    }
  };
});

const ROUTE_6 = configForChoice({ selection: "route", routeLength: 6 });
const ROUTE_12 = configForChoice({ selection: "route", routeLength: 12 });
const GROUPS: [StarterItem["group"], RunFocusPhoneme][] = [
  ["theta", "θ"],
  ["eth", "ð"],
  ["r", "ɹ"],
  ["l", "l"],
  ["v", "v"]
];

// Four items per stage and sound. context-1/-3 reuse focus-1/-3; context-2/-4 bring fresh targets,
// as the approved pack does.
function syntheticPack(): StarterItem[] {
  return GROUPS.flatMap(([group, phoneme]) => {
    const item = (stage: StarterItem["stage"], n: number, text: string, targetWord: string): StarterItem => ({
      id: `${group}-${stage}-${n}`,
      group,
      stage,
      text,
      phoneme,
      targetWord
    });
    return [
      ...[1, 2, 3, 4].map((n) => item("warmup", n, `${group}w${n}`, `${group}w${n}`)),
      ...[1, 2, 3, 4].map((n) => item("focus", n, `${group}f${n}`, `${group}f${n}`)),
      ...[1, 2, 3, 4].map((n) => {
        const target = n % 2 === 1 ? `${group}f${n}` : `${group}c${n}`;
        return item("context", n, `We say ${target} in sentence ${n}.`, target);
      })
    ];
  });
}

function build(runId: string, focusPhoneme: RunFocusPhoneme = "θ", config = ROUTE_6, previousWeakWords: string[] = [], vocabulary: VocabularyItem[] = []) {
  return buildRunDeck({ runId, config, focusPhoneme, vocabulary, previousWeakWords });
}

function texts(deck: readonly RunPrompt[], stage: RunPrompt["stage"]): string[] {
  return deck.filter((prompt) => prompt.stage === stage).map((prompt) => prompt.text);
}

afterEach(() => {
  pack.override = null;
});

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
  it("starter_pack_has_sixty_items_and_valid_twelve_item_groups", () => {
    expect(STARTER_PACK).toHaveLength(60);
    expect(new Set(STARTER_PACK.map((item) => item.id)).size).toBe(60);
    expect(new Set(STARTER_PACK.map((item) => item.text)).size).toBe(60);

    const groups = new Map<string, typeof STARTER_PACK>();
    for (const item of STARTER_PACK) {
      groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    }
    expect([...groups.keys()].sort()).toEqual(["eth", "l", "r", "theta", "v"]);

    for (const items of groups.values()) {
      expect(new Set(items.map((item) => item.phoneme)).size).toBe(1);
      expect(items.map((item) => item.stage)).toEqual([
        ...Array(4).fill("warmup"),
        ...Array(4).fill("focus"),
        ...Array(4).fill("context"),
      ]);
      const wordItems = items.filter((item) => item.stage !== "context");
      for (const item of wordItems) {
        expect(item.targetWord).toBe(item.text);
        expect(wordsIn(item.text)).toHaveLength(1);
      }
      // Every sentence holds its target. At pack level, contexts 1 and 3 reuse a focus word and
      // contexts 2 and 4 bring a fresh one; six-item sampling does not keep the pairs together.
      const focusWords = items.filter((item) => item.stage === "focus").map((item) => item.text);
      items
        .filter((item) => item.stage === "context")
        .forEach((sentence, index) => {
          const words = wordsIn(sentence.text);
          expect(words.length, sentence.id).toBeGreaterThanOrEqual(5);
          expect(words.length, sentence.id).toBeLessThanOrEqual(9);
          expect(words, sentence.id).toContain(sentence.targetWord);
          if (index % 2 === 0) expect(focusWords, sentence.id).toContain(sentence.targetWord);
          else expect(wordItems.map((item) => item.text), sentence.id).not.toContain(sentence.targetWord);
        });
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

    const deck = buildRunDeck({ runId: "run", config: ROUTE_6, focusPhoneme: "θ", vocabulary });

    expect(deck.slice(0, 2).map((prompt) => [prompt.stage, prompt.kind, prompt.text, prompt.source])).toEqual([
      ["warmup", "word", "earliest", "due-word"],
      ["warmup", "word", "later", "due-word"],
    ]);
    // "Think" (a focus word) and "path" (a context target) never become personal warm-ups.
    const theta = STARTER_PACK.filter((item) => item.phoneme === "θ");
    expect(deck.slice(2).map((prompt) => [prompt.stage, prompt.kind, prompt.source])).toEqual([
      ["focus", "word", "starter"],
      ["focus", "word", "starter"],
      ["context", "sentence", "starter"],
      ["context", "sentence", "starter"],
    ]);
    for (const prompt of deck.slice(2)) {
      expect(theta.some((item) => item.text === prompt.text && item.stage === prompt.stage)).toBe(true);
    }
    expect(new Set(deck.map((prompt) => prompt.itemId)).size).toBe(6);
    expect(deck.slice(2).every((prompt) => prompt.targetPhoneme === "θ")).toBe(true);
    expect(deck[0].targetPhoneme).toBeNull();

    expect(Object.isFrozen(deck)).toBe(true);
    expect(deck.every((prompt) => Object.isFrozen(prompt))).toBe(true);
    vocabulary.splice(0, vocabulary.length);
    expect(deck[0].text).toBe("earliest");
  });

  it("does_not_label_a_multiword_due_entry_as_a_word_prompt", () => {
    const deck = buildRunDeck({
      runId: "run",
      config: ROUTE_6,
      focusPhoneme: "θ",
      vocabulary: [vocab("new york", null), vocab("good morning", past(1)), vocab("bright", past(2))],
      previousWeakWords: ["ice cream", "  "],
    });

    expect(deck[0]).toMatchObject({ text: "bright", source: "due-word" });
    // The remaining slot is a seeded starter warm-up.
    expect(deck[1].source).toBe("starter");
    expect(["thin", "thick", "thumb", "thing"]).toContain(deck[1].text);
    for (const prompt of deck.filter((candidate) => candidate.kind === "word")) {
      expect(prompt.text.trim().split(/\s+/)).toHaveLength(1);
    }
  });

  it("filters_an_external_focus_word_with_boundary_punctuation", () => {
    const deck = buildRunDeck({
      runId: "run",
      config: ROUTE_6,
      focusPhoneme: "θ",
      vocabulary: [vocab("Think!", past(1)), vocab("(path)", past(2)), vocab("don't", past(3)), vocab("well-known", past(4))],
      previousWeakWords: ['"thank,"'],
    });

    // Internal apostrophes and hyphens are kept; only boundary punctuation is cleaned.
    expect(deck.slice(0, 2).map((prompt) => [prompt.text, prompt.source])).toEqual([
      ["don't", "due-word"],
      ["well-known", "due-word"],
    ]);
    const wordTargets = deck
      .filter((prompt) => prompt.kind === "word")
      .map((prompt) => prompt.text.toLowerCase());
    expect(new Set(wordTargets).size).toBe(4);
  });

  it("play_again_prefers_eligible_previous_weak_words", () => {
    const vocabulary = [vocab("water", past(1)), vocab("bright", past(2))];

    const replay = buildRunDeck({
      runId: "run",
      config: ROUTE_6,
      focusPhoneme: chooseFocusPhoneme([stat("l", 40)]),
      vocabulary,
      previousWeakWords: [" Late ", "", "Water", "lake"],
    });
    // "late" and "lake" collide with the l group; "water" is not repeated by the due list.
    expect(replay.slice(0, 2).map((prompt) => [prompt.text, prompt.source])).toEqual([
      ["Water", "previous-run"],
      ["bright", "due-word"],
    ]);
    expect(replay[2].targetPhoneme).toBe("l");

    const empty = buildRunDeck({ runId: "run", config: ROUTE_6, focusPhoneme: "l", vocabulary: [], previousWeakWords: ["late"] });
    const lWarmups = STARTER_PACK.filter((item) => item.phoneme === "l" && item.stage === "warmup").map((item) => item.text);
    expect(empty.slice(0, 2).every((prompt) => prompt.source === "starter" && lWarmups.includes(prompt.text))).toBe(true);
    expect(empty[0].targetPhoneme).toBe("l");
  });
});

// Pinned outputs of the seeded selection over the synthetic pack. A change here changes which items
// existing run IDs would have drawn.
const GOLDEN: [string, string][] = [
  ["warmup-1", "thetaw1"],
  ["warmup-2", "thetaw4"],
  ["focus-1", "thetaf1"],
  ["focus-2", "thetaf4"],
  ["context-1", "We say thetaf3 in sentence 3."],
  ["context-2", "We say thetac4 in sentence 4."]
];
const UNPAIRED_SEED = "seed-2";

describe("seeded decks", () => {
  it("seeded_deck_is_repeatable_and_canonically_ordered", () => {
    pack.override = syntheticPack();
    const deck = build("golden-run");
    expect(build("golden-run")).toEqual(deck);
    // Golden membership for this seed; the presentation order is always the pack's own.
    expect(deck.map((prompt) => [prompt.itemId, prompt.text])).toEqual(GOLDEN);

    const canonical = (pack.override as StarterItem[]).map((item) => item.text);
    const subsets = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const sampled = build(`run-${i}`);
      const positions = sampled.map((prompt) => canonical.indexOf(prompt.text));
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      subsets.add(texts(sampled, "focus").join(","));
    }
    // Different seeds pick different subsets (and may also repeat one).
    expect(subsets.size).toBeGreaterThan(1);
  });

  it("six_samples_membership_and_twelve_has_four_per_stage", () => {
    pack.override = syntheticPack();
    for (const [group, phoneme] of GROUPS) {
      const six = build(`six-${group}`, phoneme);
      expect(six.map((prompt) => prompt.stage)).toEqual(["warmup", "warmup", "focus", "focus", "context", "context"]);
      expect(six.map((prompt) => prompt.itemId)).toEqual(["warmup-1", "warmup-2", "focus-1", "focus-2", "context-1", "context-2"]);
      expect(six.every((prompt) => prompt.text.includes(group) && prompt.targetPhoneme === phoneme)).toBe(true);

      const twelve = build(`twelve-${group}`, phoneme, ROUTE_12);
      expect(twelve).toHaveLength(12);
      for (const stage of ["warmup", "focus", "context"] as const) {
        expect(texts(twelve, stage)).toEqual(
          (pack.override as StarterItem[]).filter((item) => item.group === group && item.stage === stage).map((item) => item.text)
        );
      }
      expect(twelve.map((prompt) => prompt.itemId).slice(8)).toEqual(["context-1", "context-2", "context-3", "context-4"]);
    }

    // Personal words replace only starter warm-up slots.
    const personal = build("twelve-personal", "θ", ROUTE_12, ["water", "bright"]);
    expect(personal.slice(0, 4).map((prompt) => prompt.source)).toEqual(["previous-run", "previous-run", "starter", "starter"]);
    expect(texts(personal, "warmup").slice(0, 2)).toEqual(["water", "bright"]);
    expect(texts(personal, "focus")).toEqual(texts(build("twelve-personal", "θ", ROUTE_12), "focus"));
    expect(texts(personal, "context")).toEqual(texts(build("twelve-personal", "θ", ROUTE_12), "context"));

    // A pack with two items per stage cannot fill twelve: the builder refuses rather than repeat or shrink.
    pack.override = syntheticPack().filter((item) => Number(item.id.at(-1)) <= 2);
    expect(build("six-small", "θ")).toHaveLength(6);
    expect(() => build("twelve-small", "θ", ROUTE_12)).toThrow("cannot fill");
  });

  it("all_context_targets_excluded_from_personal_warmups", () => {
    pack.override = syntheticPack();
    // Every θ word row and context target, sampled into this run or not, plus one fresh word.
    const weak = ["thetac2", "THETAC4!", "thetaf3", "thetaw4", "fresh"];
    for (let i = 0; i < 10; i += 1) {
      const deck = build(`exclude-${i}`, "θ", ROUTE_6, weak);
      expect(deck[0]).toMatchObject({ text: "fresh", source: "previous-run", targetPhoneme: null });
      expect(deck[1].source).toBe("starter");
    }
  });

  it("context_focus_pairs_need_not_cooccur", () => {
    pack.override = syntheticPack();
    // This seed samples context-3 (target thetaf3) without the matching focus word.
    const deck = build(UNPAIRED_SEED);
    expect(deck.filter((prompt) => prompt.stage === "context").map((prompt) => prompt.targetWord)).toContain("thetaf3");
    expect(texts(deck, "focus")).not.toContain("thetaf3");
  });

  it("warmup_priority_dedupe_and_frozen_focus_hold", () => {
    pack.override = syntheticPack();
    const past = "2026-09-01T00:00:00Z";
    const vocabulary = [vocab("due", past), vocab("Water", past)];
    // Previous weak words first, then due words; duplicates by normalized key appear once.
    const deck = build("priority", "l", ROUTE_12, ["water ", "WATER", "lf2"], vocabulary);
    expect(deck.slice(0, 4).map((prompt) => [prompt.text, prompt.source])).toEqual([
      ["water", "previous-run"],
      ["due", "due-word"],
      [texts(deck, "warmup")[2], "starter"],
      [texts(deck, "warmup")[3], "starter"]
    ]);
    expect(deck.slice(2, 4).every((prompt) => prompt.targetPhoneme === "l")).toBe(true);
    // The focus sound is the one passed in: stats are not consulted again.
    expect(deck.slice(4).every((prompt) => prompt.targetPhoneme === "l")).toBe(true);
    expect(new Set(deck.map((prompt) => prompt.text.toLowerCase())).size).toBe(12);
    expect(Object.isFrozen(deck)).toBe(true);
  });
});

describe("approved runtime pack", () => {
  it("all_config_decks_build_from_approved_runtime_pack", () => {
    const configs = [
      ROUTE_6,
      ROUTE_12,
      configForChoice({ selection: "target60", routeLength: 6 }),
      configForChoice({ selection: "target85", routeLength: 6 })
    ];
    const personal = [vocab("water", "2026-09-01T00:00:00Z")];
    for (const [group, phoneme] of GROUPS) {
      const items = STARTER_PACK.filter((item) => item.group === group);
      for (const config of configs) {
        for (const [label, vocabulary, weak] of [
          ["empty", [], []],
          ["personal", personal, ["bright"]]
        ] as const) {
          const where = `${phoneme} ${config.mode} ${config.length} ${config.target} ${label}`;
          const deck = buildRunDeck({
            runId: `${where}`,
            config,
            focusPhoneme: phoneme,
            vocabulary: [...vocabulary],
            previousWeakWords: [...weak]
          });
          expect(isValidRunDeck(config, deck), where).toBe(true);
          const perStage = config.length / 3;
          const starters = deck.filter((prompt) => prompt.source === "starter");
          for (const prompt of starters) {
            expect(items.some((item) => item.text === prompt.text && item.stage === prompt.stage), where).toBe(true);
          }
          if (label === "empty") expect(starters, where).toHaveLength(config.length);
          else expect(texts(deck, "warmup").slice(0, 2), where).toEqual(["bright", "water"]);
          expect(texts(deck, "focus"), where).toHaveLength(perStage);
          expect(texts(deck, "context"), where).toHaveLength(perStage);
        }
      }
    }
  });
});
