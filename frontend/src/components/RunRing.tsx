import { useEffect, useRef } from "react";

import type { CaptureTelemetry, RunRating, RunTier } from "../types";

export type RunRingProps = {
  phase: "ready" | "recording" | "scoring" | "verdict" | "rescue" | "summary";
  telemetry: CaptureTelemetry;
  accuracy: number | null;
  tier: RunTier | null;
  rating: RunRating | null;
  reducedMotion: boolean;
  feedbackId: string | null;
  onStop: () => void;
};

// Taps on the ring within this window of a capture starting are ignored; the bottom Stop has no guard.
export const RING_STOP_GUARD_MS = 400;

export function RunRing({ phase, telemetry, accuracy, tier, rating, reducedMotion, onStop }: RunRingProps) {
  const captureStart = useRef<{ captureId: string | null; at: number }>({ captureId: null, at: 0 });

  useEffect(() => {
    captureStart.current = { captureId: telemetry.captureId, at: performance.now() };
  }, [telemetry.captureId]);

  const className = `run-ring${reducedMotion ? " is-reduced" : ""}`;

  if (phase === "recording") {
    const stop = () => {
      const { captureId, at } = captureStart.current;
      if (captureId !== telemetry.captureId || performance.now() - at < RING_STOP_GUARD_MS) return;
      onStop();
    };
    return (
      <div className={className} data-phase={phase}>
        <button type="button" className="run-ring-stop" aria-label="Stop recording" onClick={stop} />
      </div>
    );
  }

  return (
    <div className={className} data-phase={phase} data-tier={tier ?? undefined} data-rating={rating ?? undefined} aria-hidden="true">
      <div className="run-ring-face">
        {phase === "summary" && rating ? <span className="run-ring-rating">{rating}</span> : null}
        {(phase === "verdict" || phase === "rescue") && accuracy !== null ? (
          <span className="run-ring-score">{Math.round(accuracy)}</span>
        ) : null}
      </div>
    </div>
  );
}
