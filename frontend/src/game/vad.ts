import type { AutoStopState, CaptureStopReason, CaptureSummary, LocalRejectReason } from "../types";

// End-of-speech detection from signal energy, fed timestamped dBFS frames from recorder.start().
// It detects silence after speech, not semantic sentence completion.

export type VadKind = "word" | "sentence";
export type VadParams = Readonly<{ minVoicedMs: number; tailMs: number; noOnsetMs: number; capMs: number }>;

export const VAD_PARAMS: Readonly<Record<VadKind, VadParams>> = {
  word: { minVoicedMs: 250, tailMs: 650, noOnsetMs: 4000, capMs: 6000 },
  sentence: { minVoicedMs: 500, tailMs: 1000, noOnsetMs: 6000, capMs: 14000 }
};
// A manual Stop shorter than this is rejected locally; anything longer always submits.
export const MANUAL_MIN_MS = 450;

const INITIAL_FLOOR_DBFS = -55;
const FLOOR_RISE_DB_PER_MS = 1 / 1000;
const OPENING_MS = 250;
const IMMEDIATE_SPEECH_DBFS = -40;
const ONSET_ABOVE_FLOOR_DB = 10;
const ONSET_MIN_DBFS = -48;
const ONSET_MAX_DBFS = -28;
const OFFSET_HYSTERESIS_DB = 6;
const ONSET_WINDOW_FRAMES = 5;
const ONSET_FRAMES = 3;
const NOISY_FLOOR_DBFS = -32;
const SPREAD_FRAMES = 8;
const MAX_SPREAD_DB = 12;
const MAX_GAP_MS = 250;
// A late frame (under the invalidating gap) credits at most two nominal 25 ms periods.
const MAX_FRAME_CREDIT_MS = 50;
const SILENT_DBFS = -100;
const LEVEL_MIN_DBFS = -60;
const LEVEL_RANGE_DB = 50;

export type VadFrame = Readonly<{ dbfs: number; tMs: number; contextRunning?: boolean; hidden?: boolean }>;
export type VadStopReason = Extract<CaptureStopReason, "silence" | "no-speech" | "short-voice" | "auto-cap">;
export type VadSnapshot = Readonly<{
  autoStopState: AutoStopState;
  level: number;
  silenceProgress: number;
  speechSeen: boolean;
  voicedMs: number;
  detectionValid: boolean;
  noiseFloor: number;
}>;
export type CaptureDisposition = "submit" | "discard" | LocalRejectReason;

// Nearest-rank percentile of an ascending array: index ceil(p·n) − 1. Over 8 frames P10/P90 are the min/max.
export function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function insertSorted(sorted: number[], value: number) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] <= value) low = mid + 1;
    else high = mid;
  }
  sorted.splice(low, 0, value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type Vad = { push(frame: VadFrame): VadStopReason | null; snapshot(): VadSnapshot };

// One machine per take. push returns a stop reason exactly once; auto-off, fallback and invalid
// detection never stop or reject, leaving manual Stop and the session's hard cap.
export function createVad(kind: VadKind, options: { autoStop: boolean }): Vad {
  const params = VAD_PARAMS[kind];
  let state: AutoStopState = options.autoStop ? "calibrating" : "off";
  let detectionValid = true;
  let lastT = 0;
  let level = 0;
  let floor = INITIAL_FLOOR_DBFS;
  const history: number[] = [];
  const spread: number[] = [];
  let spreadDecided = false;
  let immediate = false;
  let opening: { dbfs: number; dt: number; tMs: number }[] | null = [];
  const recent: { above: boolean; dt: number }[] = [];
  let speechSeen = false;
  let voicedMs = 0;
  let silentMs = 0;

  function analyse(dbfs: number, dt: number, tMs: number, countsTowardFloor: boolean): VadStopReason | null {
    if (state === "fallback") return null;
    if (countsTowardFloor) {
      insertSorted(history, dbfs);
      floor = Math.min(percentile(history, 0.1), floor + dt * FLOOR_RISE_DB_PER_MS);
    }
    if (floor > NOISY_FLOOR_DBFS) {
      state = "fallback";
      return null;
    }
    const onset = clamp(floor + ONSET_ABOVE_FLOOR_DB, ONSET_MIN_DBFS, ONSET_MAX_DBFS);
    if (!speechSeen) {
      recent.push({ above: dbfs > onset, dt });
      if (recent.length > ONSET_WINDOW_FRAMES) recent.shift();
      const voiced = recent.filter((frame) => frame.above);
      if (voiced.length >= ONSET_FRAMES) {
        speechSeen = true;
        voicedMs = voiced.reduce((sum, frame) => sum + frame.dt, 0);
      } else if (tMs >= params.noOnsetMs) {
        return "no-speech";
      }
      state = "listening";
    } else if (dbfs >= onset - OFFSET_HYSTERESIS_DB) {
      voicedMs += dt;
      silentMs = 0;
      state = "listening";
    } else {
      // Silence must be continuous: any voiced frame above resets it.
      silentMs += dt;
      state = "tail";
      if (silentMs >= params.tailMs) return voicedMs >= params.minVoicedMs ? "silence" : "short-voice";
    }
    return tMs >= params.capMs ? "auto-cap" : null;
  }

  function push(frame: VadFrame): VadStopReason | null {
    const dbfs = Number.isFinite(frame.dbfs) ? Math.max(frame.dbfs, SILENT_DBFS) : SILENT_DBFS;
    level = clamp((dbfs - LEVEL_MIN_DBFS) / LEVEL_RANGE_DB, 0, 1);
    const gap = frame.tMs - lastT;
    if (gap > 0) lastT = frame.tMs;
    if (state === "off" || state === "fallback" || state === "stopping") return null;
    if (gap > MAX_GAP_MS || frame.contextRunning === false || frame.hidden === true) {
      // A gap is never silence: detection stops deciding for the rest of this take.
      detectionValid = false;
      state = "off";
      silentMs = 0;
      return null;
    }
    if (gap <= 0) return null;
    const dt = Math.min(gap, MAX_FRAME_CREDIT_MS);

    if (spread.length < SPREAD_FRAMES) insertSorted(spread, dbfs);
    if (opening) {
      if (frame.tMs < OPENING_MS) {
        opening.push({ dbfs, dt, tMs: frame.tMs });
        return null;
      }
      // Speech from t=0 keeps the floor at its start instead of learning from the voice.
      immediate = opening.length > 0 && opening.every((buffered) => buffered.dbfs > IMMEDIATE_SPEECH_DBFS);
      const buffered = opening;
      opening = null;
      for (const replayed of buffered) {
        const stop = analyse(replayed.dbfs, replayed.dt, replayed.tMs, !immediate);
        if (stop) return finish(stop);
      }
    }
    const stop = analyse(dbfs, dt, frame.tMs, true);
    if (stop) return finish(stop);
    decideSpread();
    return null;
  }

  // The spread measures noise, not speech: it is decided once, after the opening has been analysed,
  // and only when no onset (or immediate speech) came first.
  function decideSpread() {
    if (spreadDecided || spread.length < SPREAD_FRAMES || state === "fallback") return;
    spreadDecided = true;
    if (speechSeen || immediate) return;
    if (percentile(spread, 0.9) - percentile(spread, 0.1) > MAX_SPREAD_DB) state = "fallback";
  }

  function finish(stop: VadStopReason): VadStopReason {
    state = "stopping";
    return stop;
  }

  function snapshot(): VadSnapshot {
    const counting = state === "tail" || state === "stopping";
    return {
      autoStopState: state,
      level,
      silenceProgress: counting ? Math.min(1, silentMs / params.tailMs) : 0,
      speechSeen,
      voicedMs,
      detectionValid,
      noiseFloor: floor
    };
  }

  return { push, snapshot };
}

// What a finished capture becomes. VAD never vetoes a manual Stop of at least MANUAL_MIN_MS.
export function classifyCapture(summary: CaptureSummary, kind: VadKind): CaptureDisposition {
  switch (summary.stopReason) {
    case "manual":
      return summary.durationMs < MANUAL_MIN_MS ? "too-short" : "submit";
    case "silence":
    case "hard-cap":
      return "submit";
    case "auto-cap":
      return summary.voicedMs >= VAD_PARAMS[kind].minVoicedMs ? "submit" : "too-short";
    case "short-voice":
      return "too-short";
    case "no-speech":
      return "no-speech";
    case "cancel":
    case "pause":
    case "quit":
    case "exit":
    case "replaced":
      return "discard";
  }
}
