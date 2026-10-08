import { describe, expect, it } from "vitest";

import type { RunConfig, StarterRunConfig, WordsRunConfig } from "../types";
import { ALL_CONFIGS, STARTER_CONFIGS, WORDS_CONFIGS } from "./runV3Fixtures";

// The production TypeScript build checks this file, so each @ts-expect-error below is a
// compile-time proof that the combination cannot be constructed. Runtime validation of untrusted
// configs (isRunConfig) belongs to A2.
const invalid: readonly RunConfig[] = [
  // @ts-expect-error Challenge has no 12-item run.
  { source: "starter", mode: "challenge", length: 12, target: 85, maxExtra: 4 },
  // @ts-expect-error Target 85 shares a four-slot extra pool.
  { source: "starter", mode: "challenge", length: 6, target: 85, maxExtra: 2 },
  // @ts-expect-error Target 60 keeps the v2 two-slot pool.
  { source: "starter", mode: "challenge", length: 6, target: 60, maxExtra: 4 },
  // @ts-expect-error Route has no target.
  { source: "starter", mode: "route", length: 6, target: 60, maxExtra: 2 },
  // @ts-expect-error Route 12 needs four extra slots.
  { source: "starter", mode: "route", length: 12, target: null, maxExtra: 2 },
  // @ts-expect-error My words is Route only.
  { source: "words", mode: "challenge", length: 6, target: 60, maxExtra: 2 },
  // @ts-expect-error My words accepts exactly 6 or 12 items.
  { source: "words", mode: "route", length: 8, target: null, maxExtra: 2 }
];

describe("runV3Fixtures", () => {
  it("four_starter_and_two_words_configs_are_constructible", () => {
    const starter: readonly StarterRunConfig[] = STARTER_CONFIGS;
    const words: readonly WordsRunConfig[] = WORDS_CONFIGS;

    expect(starter.map((config) => [config.mode, config.length, config.target, config.maxExtra])).toEqual([
      ["route", 6, null, 2],
      ["route", 12, null, 4],
      ["challenge", 6, 60, 2],
      ["challenge", 6, 85, 4]
    ]);
    expect(words.map((config) => [config.mode, config.length, config.target, config.maxExtra])).toEqual([
      ["route", 6, null, 2],
      ["route", 12, null, 4]
    ]);
    expect(starter.every((config) => config.source === "starter")).toBe(true);
    expect(words.every((config) => config.source === "words")).toBe(true);
    expect(ALL_CONFIGS.every((config) => Object.isFrozen(config))).toBe(true);
    expect(invalid).toHaveLength(7);
  });
});
