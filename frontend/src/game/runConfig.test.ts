import { describe, expect, it } from "vitest";

import {
  configForChoice,
  isRunConfig,
  isValidRunDeck,
  maxCountedScores,
  nextFocusPhoneme,
  wordsConfig
} from "./runConfig";
import type { RunConfig, RunPrompt, StarterRunConfig, WordsRunConfig } from "../types";

function starterDeck(length: number, focus = "θ"): RunPrompt[] {
  const perStage = length / 3;
  return Array.from({ length }, (_, i) => {
    const stage = (["warmup", "focus", "context"] as const)[Math.floor(i / perStage)];
    return {
      itemId: `${stage}-${(i % perStage) + 1}`,
      stage,
      kind: stage === "context" ? "sentence" : "word",
      text: stage === "context" ? `A short sentence number ${i}.` : `word${i}`,
      targetPhoneme: stage === "warmup" ? null : focus,
      targetWord: `word${i}`,
      source: "starter"
    };
  });
}

function wordsDeck(length: number): RunPrompt[] {
  return Array.from({ length }, (_, i) => ({
    itemId: `words-${i + 1}`,
    stage: "words",
    kind: "word",
    text: `Word${i}`,
    targetPhoneme: null,
    targetWord: `Word${i}`,
    source: "word-bank"
  }));
}

describe("run config", () => {
  it("config_matrix_is_exact_and_start_freezes_it", () => {
    expect(configForChoice({ selection: "route", routeLength: 6 })).toEqual({
      source: "starter", mode: "route", length: 6, target: null, maxExtra: 2
    });
    expect(configForChoice({ selection: "route", routeLength: 12 })).toEqual({
      source: "starter", mode: "route", length: 12, target: null, maxExtra: 4
    });
    // Challenge is always six items; the remembered Route length does not leak into it.
    for (const routeLength of [6, 12] as const) {
      expect(configForChoice({ selection: "target60", routeLength })).toEqual({
        source: "starter", mode: "challenge", length: 6, target: 60, maxExtra: 2
      });
      expect(configForChoice({ selection: "target85", routeLength })).toEqual({
        source: "starter", mode: "challenge", length: 6, target: 85, maxExtra: 4
      });
    }
    expect(wordsConfig(6)).toEqual({ source: "words", mode: "route", length: 6, target: null, maxExtra: 2 });
    expect(wordsConfig(12)).toEqual({ source: "words", mode: "route", length: 12, target: null, maxExtra: 4 });

    const all: RunConfig[] = [
      configForChoice({ selection: "route", routeLength: 6 }),
      configForChoice({ selection: "route", routeLength: 12 }),
      configForChoice({ selection: "target60", routeLength: 6 }),
      configForChoice({ selection: "target85", routeLength: 6 }),
      wordsConfig(6),
      wordsConfig(12)
    ];
    expect(all.map(maxCountedScores)).toEqual([8, 16, 8, 10, 8, 16]);
    for (const config of all) {
      expect(Object.isFrozen(config)).toBe(true);
      expect(isRunConfig(config)).toBe(true);
      expect(isRunConfig({ ...config })).toBe(true);
    }

    expect(["θ", "ð", "ɹ", "l", "v"].map((focus) => nextFocusPhoneme(focus as "θ"))).toEqual(["ð", "ɹ", "l", "v", "θ"]);
  });

  it("four_starter_and_two_words_configs_are_constructible", () => {
    const valid: [StarterRunConfig, StarterRunConfig, StarterRunConfig, StarterRunConfig, WordsRunConfig, WordsRunConfig] = [
      { source: "starter", mode: "route", length: 6, target: null, maxExtra: 2 },
      { source: "starter", mode: "route", length: 12, target: null, maxExtra: 4 },
      { source: "starter", mode: "challenge", length: 6, target: 60, maxExtra: 2 },
      { source: "starter", mode: "challenge", length: 6, target: 85, maxExtra: 4 },
      { source: "words", mode: "route", length: 6, target: null, maxExtra: 2 },
      { source: "words", mode: "route", length: 12, target: null, maxExtra: 4 }
    ];
    expect(valid.every(isRunConfig)).toBe(true);

    // @ts-expect-error Challenge has no twelve-item variant.
    const challenge12: RunConfig = { source: "starter", mode: "challenge", length: 12, target: 60, maxExtra: 4 };
    // @ts-expect-error My words has no Challenge.
    const wordsChallenge: RunConfig = { source: "words", mode: "challenge", length: 6, target: 60, maxExtra: 2 };
    // @ts-expect-error Target 85 owns four extras, not two.
    const target85Two: RunConfig = { source: "starter", mode: "challenge", length: 6, target: 85, maxExtra: 2 };
    // @ts-expect-error Route has no target.
    const routeTarget: RunConfig = { source: "starter", mode: "route", length: 6, target: 60, maxExtra: 2 };
    const invalid: unknown[] = [
      challenge12,
      wordsChallenge,
      target85Two,
      routeTarget,
      { source: "starter", mode: "route", length: 9, target: null, maxExtra: 2 },
      { source: "starter", mode: "route", length: "6", target: null, maxExtra: 2 },
      { source: "starter", mode: "route", length: 6, maxExtra: 2 },
      { source: "starter", mode: "route", length: 6, target: null, maxExtra: 2, hearts: 5 },
      "route",
      null,
      undefined,
      []
    ];
    for (const value of invalid) expect(isRunConfig(value)).toBe(false);
  });

  it("deck_validation_is_source_aware_and_exact", () => {
    const route6 = configForChoice({ selection: "route", routeLength: 6 });
    const route12 = configForChoice({ selection: "route", routeLength: 12 });
    expect(isValidRunDeck(route6, starterDeck(6))).toBe(true);
    expect(isValidRunDeck(route12, starterDeck(12))).toBe(true);
    expect(isValidRunDeck(wordsConfig(6), wordsDeck(6))).toBe(true);
    expect(isValidRunDeck(wordsConfig(12), wordsDeck(12))).toBe(true);

    // Exact size; no padding, shrinking, or source crossover.
    expect(isValidRunDeck(route12, starterDeck(6))).toBe(false);
    expect(isValidRunDeck(route6, starterDeck(12))).toBe(false);
    expect(isValidRunDeck(wordsConfig(6), starterDeck(6))).toBe(false);
    expect(isValidRunDeck(route6, wordsDeck(6))).toBe(false);

    const deck = starterDeck(6);
    const replace = (index: number, patch: Partial<RunPrompt>) => deck.map((p, i) => (i === index ? { ...p, ...patch } : p));
    expect(isValidRunDeck(route6, replace(1, { itemId: "warmup-1" }))).toBe(false);
    expect(isValidRunDeck(route6, replace(1, { text: " WORD0 " }))).toBe(false);
    expect(isValidRunDeck(route6, replace(1, { text: "  " }))).toBe(false);
    expect(isValidRunDeck(route6, replace(2, { stage: "warmup" }))).toBe(false);
    expect(isValidRunDeck(route6, replace(4, { kind: "word" }))).toBe(false);
    expect(isValidRunDeck(route6, replace(5, { targetPhoneme: "ð" }))).toBe(false);
    expect(isValidRunDeck(route6, starterDeck(6, "ʃ"))).toBe(false);
    // Personal warm-ups carry no phoneme; a starter warm-up carries the run's focus.
    expect(isValidRunDeck(route6, replace(0, { targetPhoneme: "θ", source: "starter" }))).toBe(true);
    expect(isValidRunDeck(route6, replace(0, { targetPhoneme: "v" }))).toBe(false);

    const words = wordsDeck(6);
    const replaceWord = (patch: Partial<RunPrompt>) => words.map((p, i) => (i === 0 ? { ...p, ...patch } : p));
    // One word is judged as the scorer and the bank judge it: boundary punctuation around it is fine.
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ text: "( Paris )", targetWord: "( Paris )" }))).toBe(true);
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ text: "two words", targetWord: "two words" }))).toBe(false);
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ text: "(...)", targetWord: "(...)" }))).toBe(false);
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ text: " Word0 ", targetWord: " Word0 " }))).toBe(false);
    // Two spellings of one word are one word.
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ text: "word1!", targetWord: "word1!" }))).toBe(false);
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ targetPhoneme: "θ" }))).toBe(false);
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ stage: "warmup" }))).toBe(false);
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ targetWord: "other" }))).toBe(false);
    expect(isValidRunDeck(wordsConfig(6), replaceWord({ text: "word1", targetWord: "word1" }))).toBe(false);
  });

  it("words_source_validation_has_no_fake_stages_or_focus", () => {
    const words = wordsDeck(6);
    const six = wordsConfig(6);
    expect(isValidRunDeck(six, words)).toBe(true);
    expect(isValidRunDeck(six, words.map((p, i) => (i === 0 ? { ...p, source: "run-review" as const } : p)))).toBe(true);
    // A words deck has no Warm-up/Focus/In-context split, no target sound and no starter prompts.
    const mixed: Partial<RunPrompt>[] = [
      { stage: "focus" },
      { targetPhoneme: "θ" },
      { source: "starter" },
      { source: "due-word" },
      { kind: "sentence", text: "A whole sentence here.", targetWord: "A whole sentence here." }
    ];
    for (const patch of mixed) {
      expect(isValidRunDeck(six, words.map((p, i) => (i === 3 ? { ...p, ...patch } : p))), JSON.stringify(patch)).toBe(false);
    }
    // A starter deck never carries words-run prompts.
    const route6 = configForChoice({ selection: "route", routeLength: 6 });
    const deck = starterDeck(6);
    expect(isValidRunDeck(route6, deck.map((p, i) => (i === 0 ? { ...p, source: "word-bank" as const } : p)))).toBe(false);
    expect(isValidRunDeck(route6, deck.map((p, i) => (i === 0 ? { ...p, stage: "words" as const } : p)))).toBe(false);
  });
});
