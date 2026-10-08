import { useEffect, useRef, useState } from "react";

import { tierForAccuracy } from "../game/scoring";
import type { CaptureTelemetry, RunRating, RunTier } from "../types";

export type RunRingProps = {
  phase: "ready" | "recording" | "scoring" | "verdict" | "rescue" | "summary";
  telemetry: CaptureTelemetry;
  accuracy: number | null;
  tier: RunTier | null;
  rating: RunRating | null;
  reducedMotion: boolean;
  feedbackId: string | null;
  // This feedback was already shown (e.g. before a remount): render its final state with no entrance motion.
  settled: boolean;
  onStop: () => void;
};

// Telemetry when no capture is open.
export const IDLE_TELEMETRY: CaptureTelemetry = {
  captureId: null,
  level: 0,
  silenceProgress: 0,
  autoStopState: "off",
  elapsedMs: 0
};

// Taps on the ring within this window of a capture starting are ignored; the bottom Stop has no guard.
export const RING_STOP_GUARD_MS = 400;
export const SCORE_ROLL_MS = 450;
const ROLL_FROM = 60;

export const TIER_LABELS: Record<RunTier, string> = {
  perfect: "Perfect",
  great: "Great",
  good: "Good",
  relisten: "Re-listen"
};

// Full circle from 12 o'clock, clockwise, normalized so dash lengths are fractions.
const CIRCLE = "M100 4a96 96 0 1 1 0 192a96 96 0 1 1 0-192";
const ORBIT = "M100 4a96 96 0 0 1 96 96";
const ORBIT_REVERSE = "M100 196a96 96 0 0 1-96-96";
const SPARKS = "M34 44l9 7M166 40l-9 8M18 120l11-2M182 128l-11-4M100 -6v11M56 184l6-9M144 186l-6-10";

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// Whole numbers, except where rounding would cross a tier line: 84.9 shows as 84.9, not 85.
export function formatRunScore(accuracy: number): string {
  const rounded = Math.round(accuracy);
  if (tierForAccuracy(rounded) === tierForAccuracy(accuracy)) return String(rounded);
  return (Math.floor(accuracy * 10) / 10).toFixed(1);
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

// Counts up to the target once per key; game facts are already final, so this is display only.
export function useRolledNumber(
  target: number | null,
  rollKey: string | null,
  enabled: boolean,
  durationMs = SCORE_ROLL_MS,
  delayMs = 0
): number | null {
  const [frame, setFrame] = useState<{ key: string; value: number } | null>(null);
  const active = enabled && target !== null && rollKey !== null;

  useEffect(() => {
    if (!active) return;
    const startedAt = performance.now();
    let handle = 0;
    const tick = () => {
      const progress = Math.min(1, Math.max(0, performance.now() - startedAt - delayMs) / durationMs);
      setFrame({ key: rollKey, value: target * (1 - (1 - progress) ** 3) });
      if (progress < 1) handle = requestAnimationFrame(tick);
    };
    setFrame({ key: rollKey, value: 0 });
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [active, rollKey, target, durationMs, delayMs]);

  if (!active) return target;
  return frame?.key === rollKey ? frame.value : 0;
}

export function RunRing({ phase, telemetry, accuracy, tier, rating, reducedMotion, feedbackId, settled, onStop }: RunRingProps) {
  const captureStart = useRef<{ captureId: string | null; at: number }>({ captureId: null, at: 0 });

  // Anchored to when the capture began, not when the ring mounted; a late telemetry sample only
  // estimates a later start, so the earliest estimate for the capture wins.
  useEffect(() => {
    const at = performance.now() - telemetry.elapsedMs;
    const known = captureStart.current;
    captureStart.current =
      known.captureId === telemetry.captureId ? { ...known, at: Math.min(known.at, at) } : { captureId: telemetry.captureId, at };
  }, [telemetry.captureId, telemetry.elapsedMs]);

  const showsScore = (phase === "verdict" || phase === "rescue") && accuracy !== null;
  const still = reducedMotion || settled;
  const rolls = showsScore && phase === "verdict" && !still && (accuracy ?? 0) >= ROLL_FROM;
  const shownScore = useRolledNumber(showsScore ? accuracy : null, feedbackId, rolls);

  const recording = phase === "recording";
  const level = clamp01(telemetry.level);
  const silence = clamp01(telemetry.silenceProgress);
  const sparkle = phase === "verdict" && tier === "perfect" && !still;

  const art = (
    <svg className="run-ring-art" viewBox="0 0 200 200" aria-hidden="true" focusable="false" key={feedbackId ?? phase}>
      <path className="run-ring-track" d={CIRCLE} />
      {recording ? (
        <path className="run-ring-silence" d={CIRCLE} pathLength={1} style={{ strokeDasharray: `${silence} 1`, opacity: silence > 0 ? 1 : 0 }} />
      ) : null}
      {recording && !reducedMotion ? (
        <circle className="run-ring-level" cx="100" cy="100" r="82" style={{ transform: `scale(${0.84 + level * 0.16})` }} />
      ) : null}
      <circle className="run-ring-edge" cx="100" cy="100" r="82" />
      <circle className="run-ring-core" cx="100" cy="100" r="70" />
      {recording && reducedMotion ? (
        <rect className="run-ring-level-bar" x="70" y="122" width="60" height="6" rx="3" style={{ transform: `scaleX(${level})` }} />
      ) : null}
      {phase === "scoring" ? <path className="run-ring-orbit" d={ORBIT} /> : null}
      {phase === "scoring" && !reducedMotion ? <path className="run-ring-orbit reverse" d={ORBIT_REVERSE} /> : null}
      {sparkle ? <path className="run-ring-sweep" d={ORBIT} /> : null}
      {sparkle ? <path className="run-ring-sparks" d={SPARKS} /> : null}
    </svg>
  );

  const face = (
    <div className="run-ring-face" aria-hidden="true">
      {recording ? <span className="run-ring-time">{formatElapsed(telemetry.elapsedMs)}</span> : null}
      {showsScore && shownScore !== null ? (
        <span className={`run-ring-score${accuracy !== null && !Number.isInteger(Number(formatRunScore(accuracy))) ? " is-decimal" : ""}`}>
          {shownScore === accuracy ? formatRunScore(shownScore) : Math.floor(shownScore)}
        </span>
      ) : null}
      {phase === "verdict" && tier ? <span className="run-ring-tier">{TIER_LABELS[tier]}</span> : null}
      {phase === "summary" && rating ? <span className="run-ring-rating">{rating}</span> : null}
    </div>
  );

  const stop = () => {
    const { captureId, at } = captureStart.current;
    if (captureId !== telemetry.captureId || performance.now() - at < RING_STOP_GUARD_MS) return;
    onStop();
  };

  return (
    <div
      className={`run-ring${reducedMotion ? " is-reduced" : ""}${settled ? " is-settled" : ""}`}
      data-phase={phase}
      data-tier={phase === "summary" ? undefined : (tier ?? undefined)}
      data-rating={phase === "summary" ? (rating ?? "none") : undefined}
      aria-hidden={recording ? undefined : true}
    >
      <div className="run-ring-glow" aria-hidden="true" />
      {art}
      {face}
      {recording ? <button type="button" className="run-ring-stop" aria-label="Stop recording" onClick={stop} /> : null}
    </div>
  );
}
