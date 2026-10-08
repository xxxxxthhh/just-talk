import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bestBucketForRun, bestBucketKey, finalizeRunBest, readBest, RUN_BEST_KEY, type RunBestBucket } from "./personalBest";
import { runReducer } from "./runModel";
import { RUN_RULES_VERSION } from "./scoring";
import type { RunMode, RunPrompt, RunRating, RunScoreView, RunState } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1);
const BUCKET: RunBestBucket = { mode: "challenge", focus: "ð", rulesVersion: RUN_RULES_VERSION };
const PERSONAL = { publicMode: false, now: T0 };

function view(points: number, rating: RunRating | null = "A", rated = true): RunScoreView {
  return { items: [], points, currentChain: 0, longestChain: 0, rated, rating, unratedReason: null, fullCombo: false };
}

function run(mode: RunMode, focus: string): RunState {
  const prompts: RunPrompt[] = ["warmup", "warmup", "focus", "focus", "context", "context"].map((stage, i) => ({
    itemId: `item-${i}`,
    stage: stage as RunPrompt["stage"],
    kind: stage === "context" ? "sentence" : "word",
    text: `text${i}`,
    targetPhoneme: stage === "warmup" ? null : focus,
    targetWord: null,
    source: "starter"
  }));
  return runReducer(null, { type: "START", runId: "run", mode, prompts }) as RunState;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("personal best", () => {
  it("best_uses_mode_frozen_focus_and_rules_version", () => {
    expect(bestBucketForRun(run("challenge", "ð"))).toEqual(BUCKET);
    expect(bestBucketForRun(run("route", "θ"))).toEqual({ mode: "route", focus: "θ", rulesVersion: RUN_RULES_VERSION });

    finalizeRunBest(BUCKET, "run-1", view(861), PERSONAL);
    expect(readBest(BUCKET)?.points).toBe(861);
    for (const other of [
      { ...BUCKET, mode: "route" as const },
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

    // A remount finalizing the same run again keeps its receipt and does not rewrite.
    const stored = window.localStorage.getItem(RUN_BEST_KEY);
    expect(finalizeRunBest(BUCKET, "run-4", view(955, "S"), { publicMode: false, now: T0 + 2 * DAY })).toEqual({
      runId: "run-4",
      previousPoints: 861,
      outcome: "new-best"
    });
    expect(window.localStorage.getItem(RUN_BEST_KEY)).toBe(stored);

    // Unrated runs never write.
    expect(finalizeRunBest(BUCKET, "run-5", view(990, null, false), later)).toBeNull();
    expect(readBest(BUCKET)?.points).toBe(955);
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
    expect(readBest({ mode: "route", focus: "θ", rulesVersion: 1 })).toBeNull();
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
});
