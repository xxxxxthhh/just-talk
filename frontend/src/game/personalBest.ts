import { PUBLIC_MODE } from "../publicMode";
import type { RunBestReceipt, RunRating, RunScoreView, RunState, StarterRunConfig } from "../types";
import { RUN_RULES_VERSION } from "./scoring";

// A game record kept only in this browser, not a skill measure: warm-ups vary between runs.
export const RUN_BEST_KEY = "jt.runBest.v1";
const PUBLIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RATINGS: readonly string[] = ["S", "A", "B", "C"];

export type RunBestBucket = Readonly<{ config: StarterRunConfig; focus: string | null; rulesVersion: number }>;
export type RunBestRecord = Readonly<{
  runId: string;
  points: number;
  rating: RunRating;
  updatedAt: number;
  expiresAt: number | null;
}>;
type StoreOptions = { publicMode?: boolean; now?: number };

// The focus phoneme comes from the frozen deck, so stats that change after the run never move it.
// My words runs keep no best: null means no read, write, or receipt.
export function bestBucketForRun(run: RunState): RunBestBucket | null {
  const { config } = run;
  if (config.source !== "starter") return null;
  const focus = run.items.find((item) => item.prompt.stage === "focus")?.prompt.targetPhoneme ?? null;
  return { config, focus, rulesVersion: RUN_RULES_VERSION };
}

// Route 6 and Target 60 keep v2's key bytes, so their existing records stay visible; Route 12 and
// Target 85 add a suffix.
export function bestBucketKey(bucket: RunBestBucket): string {
  const base = `${bucket.config.mode}|${bucket.focus ?? ""}|${bucket.rulesVersion}`;
  if (bucket.config.length === 12) return `${base}|12`;
  if (bucket.config.target === 85) return `${base}|85`;
  return base;
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

// Decides a rated run's receipt against the record it replaces. Pure: the run owner calls it once
// and keeps the receipt for the whole run, so later storage changes never alter it.
export function decideRunBest(
  previous: RunBestRecord | null,
  runId: string,
  score: RunScoreView
): RunBestReceipt | null {
  if (!score.rated || score.rating === null) return null;
  const outcome = previous === null ? "first-record" : score.points > previous.points ? "new-best" : "none";
  return { runId, previousPoints: previous?.points ?? null, outcome };
}

// Writes a winning receipt's score, unless a record at least as high has been stored since.
export function persistRunBest(
  bucket: RunBestBucket,
  runId: string,
  score: RunScoreView,
  receipt: RunBestReceipt,
  { publicMode = PUBLIC_MODE, now = Date.now() }: StoreOptions = {}
): void {
  if (receipt.outcome === "none" || score.rating === null) return;
  const key = bestBucketKey(bucket);
  const records = readAll();
  const stored = live(records[key], now);
  if (stored && stored.points >= score.points) return;

  const kept = Object.fromEntries(Object.entries(records).filter(([, record]) => live(record, now)));
  kept[key] = {
    runId,
    points: score.points,
    rating: score.rating,
    updatedAt: now,
    expiresAt: publicMode ? now + PUBLIC_RETENTION_MS : null
  };
  try {
    window.localStorage.setItem(RUN_BEST_KEY, JSON.stringify(kept));
  } catch {
    // A full or blocked store keeps the receipt for this run; nothing else depends on the write.
  }
}

// Decides and writes once. Not idempotent: calling it again compares against whatever is stored
// then, so the caller must keep the first receipt for the rest of the run.
export function finalizeRunBest(
  bucket: RunBestBucket,
  runId: string,
  score: RunScoreView,
  options: StoreOptions = {}
): RunBestReceipt | null {
  const receipt = decideRunBest(readBest(bucket, options.now), runId, score);
  if (receipt) persistRunBest(bucket, runId, score, receipt, options);
  return receipt;
}
