import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bestBucketForRun,
  bestBucketKey,
  decideRunBest,
  finalizeRunBest,
  persistRunBest,
  readBest,
  RUN_BEST_KEY,
  type RunBestBucket
} from "./personalBest";
import { configForChoice, wordsConfig } from "./runConfig";
import { runReducer } from "./runModel";
import { RUN_RULES_VERSION } from "./scoring";
import type { RunConfig, RunPrompt, RunRating, RunScoreView, RunState } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1);
const ROUTE_6 = configForChoice({ selection: "route", routeLength: 6 });
const ROUTE_12 = configForChoice({ selection: "route", routeLength: 12 });
const TARGET_60 = configForChoice({ selection: "target60", routeLength: 6 });
const TARGET_85 = configForChoice({ selection: "target85", routeLength: 6 });
const BUCKET: RunBestBucket = { config: TARGET_60, focus: "ð", rulesVersion: RUN_RULES_VERSION };
const PERSONAL = { publicMode: false, now: T0 };

function view(points: number, rating: RunRating | null = "A", rated = true): RunScoreView {
  return { items: [], points, currentChain: 0, longestChain: 0, rated, rating, unratedReason: null, fullCombo: false };
}

function run(config: RunConfig, focus: string): RunState {
  const perStage = config.length / 3;
  const prompts: RunPrompt[] = Array.from({ length: config.length }, (_, i) => {
    const stage = (["warmup", "focus", "context"] as const)[Math.floor(i / perStage)];
    if (config.source === "words") {
      return { itemId: `item-${i}`, stage: "words", kind: "word", text: `text${i}`, targetPhoneme: null, targetWord: `text${i}`, source: "word-bank" };
    }
    return {
      itemId: `item-${i}`,
      stage,
      kind: stage === "context" ? "sentence" : "word",
      text: `text${i}`,
      targetPhoneme: stage === "warmup" ? null : focus,
      targetWord: null,
      source: "starter"
    };
  });
  const started = runReducer(null, { type: "START", runId: "run", config, prompts });
  if (!started) throw new Error("run did not start");
  return started;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("personal best", () => {
  it("best_uses_mode_frozen_focus_and_rules_version", () => {
    expect(bestBucketForRun(run(TARGET_60, "ð"))).toEqual(BUCKET);
    expect(bestBucketForRun(run(ROUTE_6, "θ"))).toEqual({ config: ROUTE_6, focus: "θ", rulesVersion: RUN_RULES_VERSION });

    finalizeRunBest(BUCKET, "run-1", view(861), PERSONAL);
    expect(readBest(BUCKET)?.points).toBe(861);
    for (const other of [
      { ...BUCKET, config: ROUTE_6 },
      { ...BUCKET, focus: "θ" },
      { ...BUCKET, rulesVersion: RUN_RULES_VERSION + 1 }
    ]) {
      expect(bestBucketKey(other)).not.toBe(bestBucketKey(BUCKET));
      expect(readBest(other)).toBeNull();
      expect(finalizeRunBest(other, "run-2", view(700, "B"), PERSONAL)?.outcome).toBe("first-record");
    }
    expect(readBest(BUCKET)).toMatchObject({ runId: "run-1", points: 861, rating: "A" });
  });

  it("strict_best_first_record_and_tie", () => {
    expect(finalizeRunBest(BUCKET, "run-1", view(861), PERSONAL)).toEqual({
      runId: "run-1",
      previousPoints: null,
      outcome: "first-record"
    });
    const later = { publicMode: false, now: T0 + DAY };
    expect(finalizeRunBest(BUCKET, "run-2", view(861), later)).toEqual({
      runId: "run-2",
      previousPoints: 861,
      outcome: "none"
    });
    expect(finalizeRunBest(BUCKET, "run-3", view(700, "B"), later)?.outcome).toBe("none");
    expect(readBest(BUCKET)).toMatchObject({ runId: "run-1", updatedAt: T0 });

    expect(finalizeRunBest(BUCKET, "run-4", view(955, "S"), later)).toEqual({
      runId: "run-4",
      previousPoints: 861,
      outcome: "new-best"
    });
    expect(readBest(BUCKET)).toMatchObject({ runId: "run-4", points: 955, rating: "S" });

    // Unrated runs never write.
    expect(finalizeRunBest(BUCKET, "run-5", view(990, null, false), later)).toBeNull();
    expect(readBest(BUCKET)?.points).toBe(955);
  });

  it("stale_receipts_never_clobber_a_newer_or_higher_record", () => {
    // Deciding is pure: it reads nothing and writes nothing.
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const previous = { runId: "run-0", points: 865, rating: "A" as const, updatedAt: T0, expiresAt: null };
    const winning = decideRunBest(previous, "run-1", view(955, "S"));
    expect(winning).toEqual({ runId: "run-1", previousPoints: 865, outcome: "new-best" });
    expect(decideRunBest(previous, "run-1", view(955, "S"))).toEqual(winning);
    expect(decideRunBest(previous, "run-2", view(990, null, false))).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();

    // An intervening better run (another tab) stays stored when an older winning receipt is persisted.
    finalizeRunBest(BUCKET, "run-0", view(865), PERSONAL);
    finalizeRunBest(BUCKET, "run-2", view(978, "S"), PERSONAL);
    const stored = window.localStorage.getItem(RUN_BEST_KEY);
    persistRunBest(BUCKET, "run-1", view(955, "S"), winning!, PERSONAL);
    expect(window.localStorage.getItem(RUN_BEST_KEY)).toBe(stored);

    // A non-winning receipt never writes, whatever is stored by then.
    window.localStorage.clear();
    persistRunBest(BUCKET, "run-3", view(700, "B"), { runId: "run-3", previousPoints: 955, outcome: "none" }, PERSONAL);
    expect(readBest(BUCKET)).toBeNull();

    // Once its own record has expired, a stale receipt still cannot replace the live higher record.
    // (Never re-deciding an expired run is the run owner's latch, tested in usePracticeRun.)
    finalizeRunBest(BUCKET, "run-4", view(955, "S"), { publicMode: true, now: T0 });
    finalizeRunBest(BUCKET, "run-5", view(978, "S"), { publicMode: true, now: T0 + 3 * DAY });
    persistRunBest(BUCKET, "run-4", view(955, "S"), winning!, { publicMode: true, now: T0 + 8 * DAY });
    expect(readBest(BUCKET, T0 + 8 * DAY)?.runId).toBe("run-5");
  });

  it("public_expiry_does_not_slide_on_read", () => {
    finalizeRunBest(BUCKET, "run-1", view(861), { publicMode: true, now: T0 });
    expect(readBest(BUCKET, T0 + 6 * DAY)?.points).toBe(861);
    expect(readBest(BUCKET, T0 + 7 * DAY - 1)?.points).toBe(861);
    expect(readBest(BUCKET, T0 + 7 * DAY)).toBeNull();
    expect(finalizeRunBest(BUCKET, "run-2", view(700, "B"), { publicMode: true, now: T0 + 8 * DAY })?.outcome).toBe(
      "first-record"
    );
    expect(readBest(BUCKET, T0 + 14 * DAY)?.runId).toBe("run-2");

    // An update restarts the window from the write.
    finalizeRunBest(BUCKET, "run-3", view(800, "B"), { publicMode: true, now: T0 + 10 * DAY });
    expect(readBest(BUCKET, T0 + 16 * DAY)?.runId).toBe("run-3");

    const personal: RunBestBucket = { ...BUCKET, focus: "θ" };
    finalizeRunBest(personal, "run-4", view(861), PERSONAL);
    expect(readBest(personal, T0 + 365 * DAY)?.points).toBe(861);
  });

  it("corrupt_or_unwritable_storage_is_nonfatal", () => {
    window.localStorage.setItem(RUN_BEST_KEY, "{not json");
    expect(readBest(BUCKET)).toBeNull();
    expect(finalizeRunBest(BUCKET, "run-1", view(861), PERSONAL)?.outcome).toBe("first-record");
    expect(readBest(BUCKET)?.points).toBe(861);

    // One malformed entry is dropped without losing the others.
    const records = JSON.parse(window.localStorage.getItem(RUN_BEST_KEY) as string);
    records["route|θ|1"] = { runId: "x", points: "lots", rating: "A", previousPoints: null, updatedAt: T0, expiresAt: null };
    window.localStorage.setItem(RUN_BEST_KEY, JSON.stringify(records));
    expect(readBest({ config: ROUTE_6, focus: "θ", rulesVersion: 1 })).toBeNull();
    expect(readBest(BUCKET)?.points).toBe(861);
    window.localStorage.setItem(RUN_BEST_KEY, "[1,2]");
    expect(readBest(BUCKET)).toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(finalizeRunBest(BUCKET, "run-2", view(955, "S"), PERSONAL)?.outcome).toBe("first-record");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readBest(BUCKET)).toBeNull();
    expect(finalizeRunBest(BUCKET, "run-3", view(955, "S"), PERSONAL)?.outcome).toBe("first-record");
  });

  it("legacy_pb_keys_and_records_remain_readable", () => {
    // Records stored by v2 under their literal key strings, including the null-focus form.
    const legacy = {
      "route|θ|1": { runId: "v2-route", points: 861, rating: "A", updatedAt: T0, expiresAt: null },
      "challenge|ð|1": { runId: "v2-challenge", points: 904, rating: "A", updatedAt: T0, expiresAt: null },
      "route||1": { runId: "v2-null", points: 700, rating: "B", updatedAt: T0, expiresAt: null }
    };
    window.localStorage.setItem(RUN_BEST_KEY, JSON.stringify(legacy));

    expect(bestBucketKey({ config: ROUTE_6, focus: "θ", rulesVersion: 1 })).toBe("route|θ|1");
    expect(bestBucketKey({ config: TARGET_60, focus: "ð", rulesVersion: 1 })).toBe("challenge|ð|1");
    expect(bestBucketKey({ config: ROUTE_6, focus: null, rulesVersion: 1 })).toBe("route||1");
    expect(bestBucketKey({ config: ROUTE_12, focus: "θ", rulesVersion: 1 })).toBe("route|θ|1|12");
    expect(bestBucketKey({ config: TARGET_85, focus: "θ", rulesVersion: 1 })).toBe("challenge|θ|1|85");

    expect(readBest({ config: ROUTE_6, focus: "θ", rulesVersion: 1 })?.runId).toBe("v2-route");
    expect(readBest({ config: TARGET_60, focus: "ð", rulesVersion: 1 })?.runId).toBe("v2-challenge");
    expect(readBest({ config: ROUTE_6, focus: null, rulesVersion: 1 })?.runId).toBe("v2-null");
    // The new configurations never read a legacy record as their own.
    expect(readBest({ config: ROUTE_12, focus: "θ", rulesVersion: 1 })).toBeNull();
    expect(readBest({ config: TARGET_85, focus: "ð", rulesVersion: 1 })).toBeNull();

    // Writing a new configuration leaves every legacy entry byte-identical.
    finalizeRunBest({ config: ROUTE_12, focus: "θ", rulesVersion: 1 }, "run-12", view(955, "S"), PERSONAL);
    const stored = JSON.parse(window.localStorage.getItem(RUN_BEST_KEY) as string);
    for (const [key, record] of Object.entries(legacy)) expect(stored[key]).toEqual(record);
    expect(stored["route|θ|1|12"]).toMatchObject({ runId: "run-12", points: 955 });
  });

  it("four_configs_have_isolated_buckets", () => {
    const configs = [ROUTE_6, ROUTE_12, TARGET_60, TARGET_85];
    const buckets = configs.map((config) => bestBucketForRun(run(config, "θ")));
    expect(buckets.map((bucket) => bucket?.config)).toEqual(configs);
    expect(new Set(buckets.map((bucket) => bestBucketKey(bucket!))).size).toBe(4);

    buckets.forEach((bucket, i) => {
      expect(finalizeRunBest(bucket!, `run-${i}`, view(800 + i, "B"), PERSONAL)?.outcome).toBe("first-record");
    });
    buckets.forEach((bucket, i) => expect(readBest(bucket!)?.runId).toBe(`run-${i}`));

    // My words runs have no bucket at all: no read, write or receipt.
    expect(bestBucketForRun(run(wordsConfig(6), "θ"))).toBeNull();
    expect(bestBucketForRun(run(wordsConfig(12), "θ"))).toBeNull();
  });

  it("receipt_first_tie_new_and_public_expiry", () => {
    const target85: RunBestBucket = { config: TARGET_85, focus: "l", rulesVersion: RUN_RULES_VERSION };
    const publicAt = (now: number) => ({ publicMode: true, now });
    expect(finalizeRunBest(target85, "run-1", view(865), publicAt(T0))).toEqual({
      runId: "run-1",
      previousPoints: null,
      outcome: "first-record"
    });
    expect(finalizeRunBest(target85, "run-2", view(865), publicAt(T0 + DAY))?.outcome).toBe("none");
    expect(readBest(target85, T0 + 7 * DAY - 1)?.runId).toBe("run-1");
    expect(finalizeRunBest(target85, "run-3", view(899), publicAt(T0 + 2 * DAY))).toEqual({
      runId: "run-3",
      previousPoints: 865,
      outcome: "new-best"
    });
    // Seven days from the improvement, not from reads or ties.
    expect(readBest(target85, T0 + 9 * DAY - 1)?.runId).toBe("run-3");
    expect(readBest(target85, T0 + 9 * DAY)).toBeNull();
    // The Target 60 bucket for the same sound never saw any of it.
    expect(readBest({ ...target85, config: TARGET_60 }, T0)).toBeNull();
  });
});
