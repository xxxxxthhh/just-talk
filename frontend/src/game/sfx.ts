import type { RunScoreView, RunTier, Verdict } from "../types";
import { getRunPreferences, subscribeRunPreferences } from "./preferences";
import { runAudioContext } from "./runAudio";

// Synthesized cues on the shared run context: no asset files, never while the microphone is open,
// at most once per event, and every failure is silent.

export type Cue = "good" | "great" | "perfect" | "heart" | "clear" | "clear-short" | "rescue-saved";

// [frequency Hz, start s, duration s]
const NOTES: Record<Cue, readonly (readonly [number, number, number])[]> = {
  good: [[660, 0, 0.12]],
  great: [
    [660, 0, 0.1],
    [880, 0.1, 0.14]
  ],
  perfect: [
    [523, 0, 0.09],
    [659, 0.08, 0.09],
    [784, 0.16, 0.09],
    [1047, 0.24, 0.2]
  ],
  heart: [
    [220, 0, 0.16],
    [165, 0.07, 0.22]
  ],
  clear: [
    [523, 0, 0.12],
    [659, 0.12, 0.12],
    [784, 0.24, 0.12],
    [1047, 0.36, 0.32]
  ],
  "clear-short": [
    [523, 0, 0.12],
    [784, 0.12, 0.2]
  ],
  "rescue-saved": [
    [587, 0, 0.1],
    [880, 0.12, 0.14]
  ]
};
const PEAK_GAIN = 0.18;

const active = new Set<OscillatorNode>();
const played = new Set<string>();
let microphoneHolds = 0;

// Muting stops output only; the shared context keeps running for auto-stop.
subscribeRunPreferences(() => {
  if (!getRunPreferences().sfx) cancelCues();
});

export function cancelCues(): void {
  for (const oscillator of active) {
    try {
      oscillator.stop();
    } catch {
      // Already stopped.
    }
  }
  active.clear();
}

// Held from microphone acquisition until the take is handed off. Counted, so an old take's late
// release cannot unmute a newer capture.
export function holdMicrophone(): () => void {
  microphoneHolds += 1;
  cancelCues();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    microphoneHolds -= 1;
  };
}

// Forgets consumed events, for a new run or exit.
export function resetCueEvents(): void {
  played.clear();
  cancelCues();
}

// Plays a cue for one event. The event counts as consumed even when muted or suppressed, so it is
// never replayed later.
export function playCue(cue: Cue | null, eventId: string): boolean {
  if (cue === null || played.has(eventId)) return false;
  played.add(eventId);
  const audio = runAudioContext();
  if (microphoneHolds > 0 || !getRunPreferences().sfx || !audio || audio.state !== "running") return false;
  try {
    const start = audio.currentTime;
    for (const [frequency, offset, duration] of NOTES[cue]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const at = start + offset;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.onended = () => active.delete(oscillator);
      active.add(oscillator);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.02);
    }
    return true;
  } catch {
    cancelCues();
    return false;
  }
}

// A heart lost replaces the low-result cue; a first low reading and Re-listen tiers stay quiet.
export function cueForVerdict(verdict: Verdict | null, tier: RunTier | null): Cue | null {
  if (verdict === "heart-lost") return "heart";
  if (verdict === "saved") return "rescue-saved";
  if (verdict !== "practiced" && verdict !== "passed") return null;
  if (tier === "perfect" || tier === "great" || tier === "good") return tier;
  return null;
}

// No fanfare for unrated runs; B and C get the shorter one.
export function cueForSummary(score: RunScoreView): Cue | null {
  if (!score.rated || score.rating === null) return null;
  return score.rating === "S" || score.rating === "A" ? "clear" : "clear-short";
}
