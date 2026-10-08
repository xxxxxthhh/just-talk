import { PUBLIC_MODE } from "../publicMode";
import type { RunBestReceipt, RunMode, RunRating, RunScoreView, RunState } from "../types";
import { RUN_RULES_VERSION } from "./scoring";

// A game record kept only in this browser, not a skill measure: warm-ups vary between runs.
export const RUN_BEST_KEY = "jt.runBest.v1";
const PUBLIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RATINGS: readonly string[] = ["S", "A", "B", "C"];

export type RunBestBucket = Readonly<{ mode: RunMode; focus: string | null; rulesVersion: number }>;
export type RunBestRecord = Readonly<{
  runId: string;
  points: number;
  rating: RunRating;
  previousPoints: number | null;
  updatedAt: number;
  expiresAt: number | null;
}>;
type StoreOptions = { publicMode?: boolean; now?: number };

// The focus phoneme comes from the frozen deck, so stats that change after the run never move it.
export function bestBucketForRun(run: RunState): RunBestBucket {
  const focus = run.items.find((item) => item.prompt.stage === "focus")?.prompt.targetPhoneme ?? null;
  return { mode: run.mode, focus, rulesVersion: RUN_RULES_VERSION };
}

export function bestBucketKey(bucket: RunBestBucket): string {
  return `${bucket.mode}|${bucket.focus ?? ""}|${bucket.rulesVersion}`;
}

function isRecord(value: unknown): value is RunBestRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const optionalNumber = (field: unknown) => field === null || (typeof field === "number" && Number.isFinite(field));
  return (
    typeof record.runId === "string" &&
    typeof record.points === "number" &&
    Number.isFinite(record.points) &&
    typeof record.rating === "string" &&
    RATINGS.includes(record.rating) &&
    optionalNumber(record.previousPoints) &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt) &&
    optionalNumber(record.expiresAt)
  );
}

// Unreadable storage or entries degrade to "no record"; one bad entry never discards the others.
function readAll(): Record<string, RunBestRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(window.localStorage.getItem(RUN_BEST_KEY) ?? "{}");
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([, record]) => isRecord(record)));
}

function live(record: RunBestRecord | undefined, now: number): RunBestRecord | null {
  return record && (record.expiresAt === null || now < record.expiresAt) ? record : null;
}

// Reading never extends a public entry's expiry.
export function readBest(bucket: RunBestBucket, now = Date.now()): RunBestRecord | null {
  return live(readAll()[bestBucketKey(bucket)], now);
}

// Decides the receipt before writing, and writes only for a rated first record or a strictly
// higher score. Finalizing the same run again returns its original receipt without rewriting.
export function finalizeRunBest(
  bucket: RunBestBucket,
  runId: string,
  score: RunScoreView,
  { publicMode = PUBLIC_MODE, now = Date.now() }: StoreOptions = {}
): RunBestReceipt | null {
  if (!score.rated || score.rating === null) return null;
  const key = bestBucketKey(bucket);
  const records = readAll();
  const previous = live(records[key], now);
  if (previous?.runId === runId) {
    return { runId, previousPoints: previous.previousPoints, outcome: previous.previousPoints === null ? "first-record" : "new-best" };
  }
  const outcome = previous === null ? "first-record" : score.points > previous.points ? "new-best" : "none";
  const receipt: RunBestReceipt = { runId, previousPoints: previous?.points ?? null, outcome };
  if (outcome === "none") return receipt;

  const kept = Object.fromEntries(Object.entries(records).filter(([, record]) => live(record, now)));
  kept[key] = {
    runId,
    points: score.points,
    rating: score.rating,
    previousPoints: receipt.previousPoints,
    updatedAt: now,
    expiresAt: publicMode ? now + PUBLIC_RETENTION_MS : null
  };
  try {
    window.localStorage.setItem(RUN_BEST_KEY, JSON.stringify(kept));
  } catch {
    // A full or blocked store keeps the receipt for this run; nothing else depends on the write.
  }
  return receipt;
}
