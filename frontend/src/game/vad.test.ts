import { describe, expect, it } from "vitest";

import { classifyCapture, createVad, percentile, type Vad, type VadKind } from "./vad";
import type { CaptureStopReason, CaptureSummary } from "../types";

const STEP = 25;
const ROOM = -60;
const VOICE = -30;

type Stop = { reason: string; tMs: number };

// Feeds one frame every 25 ms from t=25 through untilMs and collects every stop the machine returns.
function feed(vad: Vad, levelAt: (tMs: number) => number, untilMs: number, fromMs = STEP): Stop[] {
  const stops: Stop[] = [];
  for (let tMs = fromMs; tMs <= untilMs; tMs += STEP) {
    const reason = vad.push({ dbfs: levelAt(tMs), tMs });
    if (reason) stops.push({ reason, tMs });
  }
  return stops;
}

function between(start: number, end: number, inside: number, outside = ROOM) {
  return (tMs: number) => (tMs >= start && tMs < end ? inside : outside);
}

function summary(vad: Vad, stopReason: CaptureStopReason, durationMs: number): CaptureSummary {
  const { detectionValid, speechSeen, voicedMs } = vad.snapshot();
  return { captureId: "a-1", stopReason, durationMs, detectionValid, speechSeen, voicedMs };
}

function auto(kind: VadKind): Vad {
  return createVad(kind, { autoStop: true });
}

describe("vad", () => {
  it("quiet_voice_from_t0_is_detected", () => {
    // A quiet speaker at −36 dBFS from the first frame: the opening is speech, not calibration.
    const word = auto("word");
    feed(word, () => -36, 250);
    expect(word.snapshot().speechSeen).toBe(true);
    expect(word.snapshot().noiseFloor).toBeCloseTo(-55, 1);
    const stops = feed(word, between(0, 300, -36, -58), 3000, 275);
    expect(stops).toEqual([{ reason: "silence", tMs: 300 + 650 - STEP }]);
    expect(word.snapshot().voicedMs).toBe(275);
    expect(classifyCapture(summary(word, "silence", 925), "word")).toBe("submit");

    const sentence = auto("sentence");
    expect(feed(sentence, between(0, 1500, -36, -58), 4000)).toEqual([{ reason: "silence", tMs: 1500 + 1000 - STEP }]);
    expect(sentence.snapshot().voicedMs).toBe(1475);
  });

  it("rolling_floor_obeys_percentile_and_drift", () => {
    expect(percentile([-60, -50, -45, -40, -30, -30, -30, -30, -30, -30], 0.1)).toBe(-60);
    expect(percentile([-60, -50, -45, -40, -30, -30, -30, -30, -30, -30, -30], 0.1)).toBe(-50);
    expect(percentile([-60, -59, -58, -57, -56, -55, -54, -20], 0.9)).toBe(-20);

    // A −50 room lifts the floor by at most 1 dB/s from −55, then holds at its 10th percentile.
    const rising = auto("sentence");
    feed(rising, () => -50, 1000);
    expect(rising.snapshot().noiseFloor).toBeCloseTo(-54, 5);
    feed(rising, () => -50, 5500, 1025);
    expect(rising.snapshot().noiseFloor).toBe(-50);
    expect(rising.snapshot().speechSeen).toBe(false);

    // A quieter room lowers it immediately.
    const quiet = auto("sentence");
    feed(quiet, () => -65, 300);
    expect(quiet.snapshot().noiseFloor).toBe(-65);
  });

  it("short_onset_rejects_without_hanging", () => {
    const word = auto("word");
    const stops = feed(word, between(500, 650, VOICE), 6000);
    expect(stops).toEqual([{ reason: "short-voice", tMs: 650 + 650 - STEP }]);
    expect(word.snapshot().voicedMs).toBe(150);
    expect(word.snapshot().autoStopState).toBe("stopping");
    expect(classifyCapture(summary(word, "short-voice", 1275), "word")).toBe("too-short");

    const sentence = auto("sentence");
    expect(feed(sentence, between(500, 900, VOICE), 14000)).toEqual([{ reason: "short-voice", tMs: 900 + 1000 - STEP }]);
    expect(sentence.snapshot().voicedMs).toBe(400);
  });

  it("sentence_pause_1050ms_documents_energy_endpoint_limit", () => {
    // Energy cannot tell a 1.05 s thinking pause from the end of a sentence: it stops in the pause
    // and submits what was said so far. Device piloting records how often this cuts real sentences.
    const speech = (pauseMs: number) => (tMs: number) =>
      (tMs >= 300 && tMs < 1500) || (tMs >= 1500 + pauseMs && tMs < 3500) ? VOICE : ROOM;
    const paused = auto("sentence");
    expect(feed(paused, speech(1050), 6000)).toEqual([{ reason: "silence", tMs: 1500 + 1000 - STEP }]);
    expect(classifyCapture(summary(paused, "silence", 2475), "sentence")).toBe("submit");

    // A 900 ms pause is bridged and the stop comes after the whole sentence.
    const bridged = auto("sentence");
    expect(feed(bridged, speech(900), 6000)).toEqual([{ reason: "silence", tMs: 3500 + 1000 - STEP }]);
  });

  it("noisy_spread_falls_back_and_steady_noise_has_bounded_cap", () => {
    // Wide spread over the first eight frames: auto-stop is off for this take, nothing is rejected.
    const noisy = auto("word");
    expect(feed(noisy, (tMs) => ((tMs / STEP) % 2 === 0 ? -40 : -60), 20000)).toEqual([]);
    expect(noisy.snapshot().autoStopState).toBe("fallback");
    expect(classifyCapture(summary(noisy, "manual", 3000), "word")).toBe("submit");
    expect(classifyCapture(summary(noisy, "hard-cap", 30000), "word")).toBe("submit");

    // Steady fan noise never reaches the −32 floor under the drift bound; it reads as voice and the
    // auto cap ends the take once.
    for (const [kind, cap] of [["word", 6000], ["sentence", 14000]] as const) {
      const steady = auto(kind);
      expect(feed(steady, () => -30, 20000)).toEqual([{ reason: "auto-cap", tMs: cap }]);
      expect(steady.snapshot().noiseFloor).toBeLessThan(-32);
      expect(classifyCapture(summary(steady, "auto-cap", cap), kind)).toBe("submit");
    }
  });

  it("sample_gap_never_counts_as_silence", () => {
    // A gap over 250 ms after speech turns detection off: no stop past the tail or the cap.
    const gapped = auto("word");
    feed(gapped, between(300, 400, VOICE), 375);
    expect(gapped.snapshot().speechSeen).toBe(true);
    expect(gapped.push({ dbfs: ROOM, tMs: 700 })).toBeNull();
    expect(gapped.snapshot()).toMatchObject({ detectionValid: false, autoStopState: "off", silenceProgress: 0 });
    expect(feed(gapped, () => ROOM, 20000, 725)).toEqual([]);
    expect(classifyCapture(summary(gapped, "manual", 3000), "word")).toBe("submit");

    // A late frame under 250 ms credits only 50 ms, so the tail ends 150 ms later than wall time.
    const late = auto("word");
    feed(late, between(300, 600, VOICE), 575);
    expect(late.push({ dbfs: ROOM, tMs: 775 })).toBeNull();
    expect(feed(late, () => ROOM, 3000, 800)).toEqual([{ reason: "silence", tMs: 775 + 600 }]);

    // The same bound applies to voiced time.
    const voiced = auto("word");
    feed(voiced, between(300, 400, VOICE), 375);
    const before = voiced.snapshot().voicedMs;
    voiced.push({ dbfs: VOICE, tMs: 575 });
    expect(voiced.snapshot().voicedMs).toBe(before + 50);

    for (const health of [{ contextRunning: false }, { hidden: true }]) {
      const unhealthy = auto("word");
      feed(unhealthy, between(300, 400, VOICE), 375);
      expect(unhealthy.push({ dbfs: ROOM, tMs: 400, ...health })).toBeNull();
      expect(unhealthy.snapshot().detectionValid).toBe(false);
      expect(feed(unhealthy, () => ROOM, 20000, 425)).toEqual([]);
    }
  });

  it("word_and_sentence_caps_terminate_once", () => {
    for (const [kind, cap] of [["word", 6000], ["sentence", 14000]] as const) {
      const held = auto(kind);
      expect(feed(held, between(300, 30000, VOICE), 20000)).toEqual([{ reason: "auto-cap", tMs: cap }]);
      expect(classifyCapture(summary(held, "auto-cap", cap), kind)).toBe("submit");
    }

    // An onset followed by isolated blips never completes the tail; at the cap the take ends
    // but is rejected because the minimum voiced time was never met.
    const blips = auto("sentence");
    const level = (tMs: number) => (tMs >= 300 && tMs < 375) || (tMs > 375 && (tMs - 375) % 900 === 0) ? VOICE : ROOM;
    expect(feed(blips, level, 20000)).toEqual([{ reason: "auto-cap", tMs: 14000 }]);
    expect(blips.snapshot().voicedMs).toBeLessThan(500);
    expect(classifyCapture(summary(blips, "auto-cap", 14000), "sentence")).toBe("too-short");

    // Auto-stop off never stops.
    const off = createVad("word", { autoStop: false });
    expect(feed(off, between(300, 400, VOICE), 20000)).toEqual([]);
    expect(off.snapshot().autoStopState).toBe("off");
  });

  it("manual_400ms_rejects_but_3000ms_without_onset_submits", () => {
    const early = auto("word");
    feed(early, between(0, 400, VOICE), 400);
    expect(classifyCapture(summary(early, "manual", 400), "word")).toBe("too-short");

    const silent = auto("word");
    expect(feed(silent, () => ROOM, 3000)).toEqual([]);
    expect(silent.snapshot().speechSeen).toBe(false);
    expect(classifyCapture(summary(silent, "manual", 3000), "word")).toBe("submit");
    expect(classifyCapture(summary(silent, "manual", 450), "sentence")).toBe("submit");

    for (const reason of ["cancel", "pause", "quit", "exit", "replaced"] as const) {
      expect(classifyCapture(summary(silent, reason, 3000), "word")).toBe("discard");
    }
    expect(classifyCapture(summary(silent, "no-speech", 4000), "word")).toBe("no-speech");
  });
});
