import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunScoreView } from "../types";

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class FakeNode {
  connect = vi.fn((node: unknown) => node);
  disconnect = vi.fn();
}

class FakeOscillator extends FakeNode {
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  static last: FakeAudioContext;
  state: AudioContextState = "running";
  currentTime = 0;
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  resume = vi.fn(async () => undefined);
  suspend = vi.fn();
  close = vi.fn(async () => undefined);
  createMediaStreamSource = vi.fn(() => new FakeNode());
  createAnalyser = vi.fn(() => ({ ...new FakeNode(), fftSize: 0, getFloatTimeDomainData: vi.fn() }));
  createGain = vi.fn(() => ({ ...new FakeNode(), gain: new FakeParam() }));
  createOscillator = vi.fn(() => {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  });
  constructor() {
    FakeAudioContext.last = this;
  }
}

// Fresh modules per case so preferences, consumed events and microphone holds start clean.
async function load() {
  vi.resetModules();
  const [sfx, audio, preferences] = await Promise.all([import("./sfx"), import("./runAudio"), import("./preferences")]);
  audio.prepareRunAudio();
  return { sfx, audio, preferences, context: FakeAudioContext.last };
}

function stopped(context: FakeAudioContext) {
  return context.oscillators.filter((oscillator) => oscillator.stop.mock.calls.some((call) => call.length === 0));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => vi.unstubAllGlobals());

describe("sound effects", () => {
  it("mute_keeps_analysis_context_running", async () => {
    const { sfx, audio, preferences, context } = await load();
    expect(sfx.playCue("perfect", "e-1")).toBe(true);
    expect(context.oscillators).toHaveLength(4);
    expect(context.oscillators.every((oscillator) => oscillator.start.mock.calls.length === 1)).toBe(true);

    preferences.setRunPreference("sfx", false);
    expect(stopped(context)).toHaveLength(4);
    expect(sfx.playCue("good", "e-2")).toBe(false);
    expect(context.oscillators).toHaveLength(4);
    expect(context.suspend).not.toHaveBeenCalled();
    expect(context.state).toBe("running");
    expect(audio.createLevelMeter({} as MediaStream)).not.toBeNull();

    // Unmuting never replays an event consumed while muted.
    preferences.setRunPreference("sfx", true);
    expect(sfx.playCue("good", "e-2")).toBe(false);
    expect(sfx.playCue("good", "e-3")).toBe(true);
  });

  it("microphone_open_cancels_and_suppresses_all_cues", async () => {
    const { sfx, context } = await load();
    sfx.playCue("clear", "e-1");
    const releaseOld = sfx.holdMicrophone();
    expect(stopped(context)).toHaveLength(4);

    expect(sfx.playCue("great", "e-2")).toBe(false);
    const releaseNew = sfx.holdMicrophone();
    // An older take's late release leaves the newer capture's microphone silent.
    releaseOld();
    releaseOld();
    expect(sfx.playCue("great", "e-3")).toBe(false);
    releaseNew();
    expect(sfx.playCue("great", "e-4")).toBe(true);
    expect(context.oscillators).toHaveLength(6);
  });

  it("cue_is_once_per_event_and_cancelled_on_exit", async () => {
    const { sfx, audio, context } = await load();
    expect(sfx.playCue("good", "attempt-1")).toBe(true);
    expect(sfx.playCue("good", "attempt-1")).toBe(false);
    expect(sfx.playCue(null, "attempt-2")).toBe(false);
    expect(context.oscillators).toHaveLength(1);

    sfx.playCue("clear", "summary-run-1");
    sfx.resetCueEvents();
    expect(stopped(context)).toHaveLength(5);
    expect(sfx.playCue("good", "attempt-1")).toBe(true);

    // A suspended or released context plays nothing and throws nothing.
    context.state = "suspended";
    expect(sfx.playCue("good", "attempt-5")).toBe(false);
    audio.releaseRunAudio();
    expect(sfx.playCue("good", "attempt-6")).toBe(false);
    audio.prepareRunAudio();
    FakeAudioContext.last.createOscillator.mockImplementation(() => {
      throw new Error("InvalidStateError");
    });
    expect(sfx.playCue("good", "attempt-7")).toBe(false);
  });

  it("cue_choice_prefers_heart_and_skips_unrated_fanfare", async () => {
    const { sfx } = await load();
    expect(sfx.cueForVerdict("heart-lost", "relisten")).toBe("heart");
    expect(sfx.cueForVerdict("relisten", "relisten")).toBeNull();
    expect(sfx.cueForVerdict("saved", "good")).toBe("rescue-saved");
    expect(sfx.cueForVerdict("practiced", "relisten")).toBeNull();
    expect(sfx.cueForVerdict("practiced", "perfect")).toBe("perfect");
    expect(sfx.cueForVerdict("passed", "great")).toBe("great");
    expect(sfx.cueForVerdict("passed", "good")).toBe("good");
    expect(sfx.cueForVerdict("no-match", null)).toBeNull();

    const view = (rated: boolean, rating: RunScoreView["rating"]): RunScoreView => ({
      items: [],
      points: 0,
      currentChain: 0,
      longestChain: 0,
      rated,
      rating,
      unratedReason: null,
      fullCombo: false
    });
    expect(sfx.cueForSummary(view(true, "S"))).toBe("clear");
    expect(sfx.cueForSummary(view(true, "A"))).toBe("clear");
    expect(sfx.cueForSummary(view(true, "B"))).toBe("clear-short");
    expect(sfx.cueForSummary(view(true, "C"))).toBe("clear-short");
    expect(sfx.cueForSummary(view(false, null))).toBeNull();
  });
});
