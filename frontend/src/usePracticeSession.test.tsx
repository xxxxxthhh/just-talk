import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRunPreferences, setRunPreference } from "./game/preferences";
import { configForChoice } from "./game/runConfig";
import { prepareRunAudio, releaseRunAudio } from "./game/runAudio";
import { holdMicrophone, playCue } from "./game/sfx";
import { classifyCapture } from "./game/vad";
import type { CaptureSummary, RunCaptureOptions, ScoreResult, WordResult } from "./types";
import { usePracticeRun } from "./hooks/usePracticeRun";
import { usePracticeSession } from "./usePracticeSession";

const health = {
  ok: true,
  azure_configured: true,
  passage_check_configured: false,
  max_audio_seconds: 30,
  max_long_audio_seconds: 180,
  vocabulary_graduation_score: 85,
  vocabulary_graduation_streak: 2
};

function word(text: string, accuracy: number): WordResult {
  return { word: text, accuracy, bucket: "needs-work", error_type: "None", offset_ms: 0, duration_ms: 100, phonemes: [] };
}

const weakResult: ScoreResult = {
  transcript: "thin path",
  scores: { accuracy: 40, fluency: null, completeness: null, prosody: null, pronunciation: null },
  words: [word("thin", 40), word("path", 40)],
  raw: {}
};

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
// Per-URL handlers for tests that hold or fail a specific request.
let overrides: Record<string, () => Promise<FetchResponse>> = {};

function respond(payload: unknown, status = 200): FetchResponse {
  return { ok: status < 400, status, json: async () => payload };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (overrides[url]) return overrides[url]();
      const payload =
        url === "/api/health"
          ? health
          : url === "/api/speak"
          ? { audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }
          : url === "/api/score"
          ? { result: weakResult, session: { id: "s1", created_at: "", reference_text: "", audio_duration_ms: 0, scores: weakResult.scores } }
          : [];
      return { ok: true, status: 200, json: async () => payload };
    })
  );
}

function fetchCalls(path: string) {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === path);
}

function spokenTexts() {
  return fetchCalls("/api/speak").map(([, init]) => JSON.parse(String(init?.body)).text as string);
}

type RecorderInstance = { state: string; ondataavailable: ((e: { data: Blob }) => void) | null; onstop: (() => void) | null };

let captureCounter = 0;
function runOptions(autoStop = false): RunCaptureOptions {
  captureCounter += 1;
  return { key: { runId: "run", itemId: "item", attemptId: `attempt-${captureCounter}` }, kind: "word", autoStop };
}

// The latest pending permission prompt; permissions holds every one in request order.
type Permission = { resolve: () => void; reject: (error: Error) => void };
let permission: Permission | null;
let permissions: Permission[] = [];
let deferPermission = false;
// Real browsers fire onstop after stop() returns; asyncStop leaves it to fireStop.
let asyncStop = false;
// MediaRecorder.start() throws while set.
let failStart = false;
let recorders: (RecorderInstance & { fireStop: () => void })[] = [];
// One microphone track per getUserMedia call, in request order.
let tracks: { stop: ReturnType<typeof vi.fn> }[] = [];

function installRecorder() {
  permissions = [];
  tracks = [];
  recorders = [];
  failStart = false;
  const getUserMedia = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        const track = { stop: vi.fn() };
        tracks.push(track);
        const stream = { getTracks: () => [track] };
        if (deferPermission) {
          permission = { resolve: () => resolve(stream), reject };
          permissions.push(permission);
        } else {
          resolve(stream);
        }
      })
  );
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const MediaRecorderMock = vi.fn(function MediaRecorderMock(this: RecorderInstance & Record<string, unknown>) {
    this.state = "inactive";
    this.mimeType = "audio/mp4";
    this.ondataavailable = null;
    this.onstop = null;
    this.start = () => {
      if (failStart) throw new Error("NotSupportedError");
      this.state = "recording";
    };
    this.fireStop = () => {
      this.ondataavailable?.({ data: new Blob([`take-${recorders.indexOf(this as never)}`]) });
      this.onstop?.();
    };
    this.stop = () => {
      this.state = "inactive";
      if (!asyncStop) (this.fireStop as () => void)();
    };
    recorders.push(this as never);
  }) as unknown as typeof MediaRecorder & { isTypeSupported: (type: string) => boolean };
  MediaRecorderMock.isTypeSupported = vi.fn((type: string) => type === "audio/mp4");
  vi.stubGlobal("MediaRecorder", MediaRecorderMock);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:recording"), revokeObjectURL: vi.fn() });
  return getUserMedia;
}

async function renderSession() {
  const ref: { current: ReturnType<typeof usePracticeSession> } = { current: null as never };
  function Harness() {
    ref.current = usePracticeSession();
    return null;
  }
  const { unmount } = render(<Harness />);
  await waitFor(() => expect(ref.current.health).not.toBeNull());
  return Object.assign(ref, { unmount });
}

function pressEnter() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  });
}

describe("usePracticeSession run wiring", () => {
  beforeEach(() => {
    overrides = {};
    deferPermission = false;
    asyncStop = false;
    recorders = [];
    permission = null;
    installFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("cancelled_capture_settles_once_and_stops_its_late_stream", async () => {
    installRecorder();
    const session = await renderSession();
    act(() => session.current.enterRun());

    deferPermission = true;
    const onReady = vi.fn();
    let started!: Promise<boolean>;
    act(() => {
      started = session.current.startRunCapture(runOptions(), onReady);
    });
    // Cancelled while the permission prompt is still open: the late stream is closed and the
    // capture never starts, so false is its one settlement and no blob follows.
    act(() => session.current.cancelRunCapture());
    await act(async () => {
      permission?.resolve();
      expect(await started).toBe(false);
    });

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(0);
    expect(onReady).not.toHaveBeenCalled();
    expect(session.current.recorderState).toBe("idle");
    expect(session.current.audioBlob).toBeNull();
    expect(session.current.status).toBe("");
  });

  it("exit_run_does_not_restore_cancelled_audio_after_async_stop", async () => {
    installRecorder();
    const session = await renderSession();
    act(() => session.current.enterRun());
    asyncStop = true;
    const onReady = vi.fn();
    await act(async () => {
      await session.current.startRunCapture(runOptions(), onReady);
    });
    act(() => session.current.exitRun());
    expect(session.current.audioBlob).toBeNull();

    act(() => recorders[0].fireStop());
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(session.current.runActive).toBe(false);
    expect(session.current.audioBlob).toBeNull();
    expect(session.current.audioUrl).toBeNull();
    expect(session.current.recorderState).toBe("idle");
  });

  it("normal_enter_does_not_score_a_cancelled_run_take", async () => {
    const getUserMedia = installRecorder();
    const session = await renderSession();
    act(() => session.current.enterRun());
    asyncStop = true;
    await act(async () => {
      await session.current.startRunCapture(runOptions(), vi.fn());
    });
    act(() => session.current.exitRun());
    act(() => recorders[0].fireStop());
    act(() => session.current.setPassage("a different passage"));

    pressEnter();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(session.current.recorderState).toBe("recording"));
    expect(fetchCalls("/api/score")).toHaveLength(0);
  });

  it("normal_take_stopping_during_enter_run_never_reaches_the_run", async () => {
    installRecorder();
    const session = await renderSession();
    asyncStop = true;
    await act(async () => {
      await session.current.startRecording();
    });
    act(() => session.current.enterRun());
    expect(session.current.recorderState).toBe("idle");

    // The run starts its own capture before the normal take's onstop arrives.
    const onReady = vi.fn();
    await act(async () => {
      await session.current.startRunCapture(runOptions(), onReady);
    });
    act(() => recorders[0].fireStop());
    expect(session.current.status).toBe("");
    expect(session.current.audioBlob).toBeNull();
    expect(session.current.recorderState).toBe("recording");
    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      session.current.stopRecording();
      recorders[1].fireStop();
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(await (onReady.mock.calls[0][0] as Blob).text()).toBe("take-1");
    expect(session.current.audioBlob).toBe(onReady.mock.calls[0][0]);
  });

  it("run_uses_shared_short_recorder_and_disables_normal_shortcuts", async () => {
    const getUserMedia = installRecorder();
    const session = await renderSession();
    act(() => session.current.setPracticeMode("long"));
    expect(session.current.maxMs).toBe(180_000);

    act(() => session.current.enterRun());
    expect(session.current.runActive).toBe(true);
    expect(session.current.maxMs).toBe(30_000);
    expect(session.current.practiceMode).toBe("long");

    pressEnter();
    expect(getUserMedia).not.toHaveBeenCalled();

    const onReady = vi.fn();
    await act(async () => {
      await session.current.startRunCapture(runOptions(), onReady);
    });
    expect(session.current.recorderState).toBe("recording");
    pressEnter();
    expect(session.current.recorderState).toBe("recording");
    act(() => session.current.stopRecording());
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    act(() => session.current.exitRun());
    expect(session.current.runActive).toBe(false);
    expect(session.current.maxMs).toBe(180_000);
    expect(session.current.audioBlob).toBeNull();
    pressEnter();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  });

  it("ordinary_recording_still_requires_explicit_score", async () => {
    installRecorder();
    const session = await renderSession();
    act(() => session.current.setPassage("thin path"));

    await act(async () => {
      await session.current.startRecording();
    });
    act(() => session.current.stopRecording());

    expect(session.current.status).toBe("Recording ready");
    expect(session.current.audioBlob).toBeInstanceOf(Blob);
    expect(fetchCalls("/api/score")).toHaveLength(0);

    await act(async () => {
      await session.current.submitRecording();
    });
    expect(fetchCalls("/api/score")).toHaveLength(1);
    expect(session.current.result).toEqual(weakResult);
  });

  it("run_results_stay_outside_session_and_weak_prefetch_is_suppressed", async () => {
    installRecorder();
    const session = await renderSession();
    act(() => session.current.setResult(weakResult));
    await waitFor(() => expect(spokenTexts()).toEqual(expect.arrayContaining(["thin", "path"])));

    act(() => session.current.enterRun());
    expect(session.current.result).toBeNull();

    const onReady = vi.fn();
    await act(async () => {
      await session.current.startRunCapture(runOptions(), onReady);
    });
    act(() => session.current.stopRecording());
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(session.current.result).toBeNull();
    expect(session.current.status).toBe("");
    expect(fetchCalls("/api/score")).toHaveLength(0);

    vi.mocked(fetch).mockClear();
    const runOnlyResult = { ...weakResult, words: [word("then", 40), word("those", 40)] };
    act(() => session.current.setResult(runOnlyResult));
    await act(async () => {
      await Promise.resolve();
    });
    expect(spokenTexts()).not.toContain("those");

    act(() => session.current.exitRun());
    act(() => session.current.setResult(runOnlyResult));
    await waitFor(() => expect(spokenTexts()).toContain("those"));
  });
  it("existing_preview_guards_suppress_late_audio_and_error", async () => {
    installRecorder();
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        return { play, pause: vi.fn(), currentTime: 0 };
      })
    );
    const session = await renderSession();
    act(() => session.current.enterRun());

    // A Route preview still loading when Record starts: the late audio never plays into the take.
    const loaded = deferred<FetchResponse>();
    overrides["/api/speak"] = () => loaded.promise;
    const onLoadResult = vi.fn();
    let preview!: Promise<void>;
    act(() => {
      preview = session.current.playCorrect("thin", { cacheKey: "word:thin", onLoadResult });
    });
    await act(async () => {
      expect(await session.current.startRunCapture(runOptions(), vi.fn())).toBe(true);
    });
    await act(async () => {
      loaded.resolve(respond({ audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }));
      await preview;
    });
    expect(play).not.toHaveBeenCalled();
    expect(session.current.speechStatus).not.toBe("playing");
    act(() => session.current.cancelRunCapture("cancel"));

    // A preview that fails after Record started reports its load, but no stale error.
    const failed = deferred<FetchResponse>();
    overrides["/api/speak"] = () => failed.promise;
    act(() => {
      preview = session.current.playCorrect("path", { cacheKey: "word:path", onLoadResult });
    });
    await act(async () => {
      expect(await session.current.startRunCapture(runOptions(), vi.fn())).toBe(true);
    });
    await act(async () => {
      failed.resolve(respond({ detail: "TTS unavailable" }, 503));
      await preview;
    });
    expect(play).not.toHaveBeenCalled();
    expect(session.current.error).toBeFalsy();
    expect(onLoadResult.mock.calls).toEqual([[true], [false]]);
  });
});

const dueWord = {
  id: "w1",
  word: "thin",
  source: "manual",
  notes: "",
  latest_score: null,
  practice_count: 0,
  last_practiced_at: null,
  status: "active",
  consecutive_successes: 0,
  graduated_at: null,
  interval_days: 0,
  due_at: null,
  created_at: "",
  updated_at: ""
};

const otherResult: ScoreResult = { ...weakResult, transcript: "then", words: [word("then", 95)] };

function scoreResponse(result: ScoreResult, id: string) {
  return respond({ result, session: { id, created_at: "", reference_text: "", audio_duration_ms: 0, scores: result.scores } });
}

async function recordTake(session: Awaited<ReturnType<typeof renderSession>>) {
  await act(async () => {
    await session.current.startRecording();
  });
  act(() => session.current.stopRecording());
}

describe("usePracticeSession normal scoring order", () => {
  beforeEach(() => {
    overrides = {};
    asyncStop = false;
    recorders = [];
    installFetch();
    installRecorder();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ordinary_score_visible_while_collection_pending", async () => {
    const collection = deferred<FetchResponse>();
    overrides["/api/words/from-session/s1"] = () => collection.promise;
    const session = await renderSession();
    await recordTake(session);

    act(() => {
      void session.current.submitRecording();
    });
    await waitFor(() => expect(session.current.result).toEqual(weakResult));
    expect(session.current.currentSessionId).toBe("s1");
    expect(session.current.isScoring).toBe(false);
    expect(session.current.status).toBe("Score complete");

    await act(async () => {
      collection.resolve(respond([{ id: "1", word: "thin" }, { id: "2", word: "path" }]));
    });
    await waitFor(() => expect(session.current.status).toBe("Score complete · 2 weak words saved"));
    expect(session.current.error).toBe("");
  });

  it("collection_failure_preserves_score_and_review_latch", async () => {
    overrides["/api/words"] = async () => respond([dueWord]);
    overrides["/api/words/from-session/s1"] = async () => respond({ detail: "Word bank is full" }, 409);
    const session = await renderSession();
    await waitFor(() => expect(session.current.vocabulary).toHaveLength(1));
    act(() => session.current.startReview());
    expect(session.current.isReviewActive).toBe(true);
    await recordTake(session);

    await act(async () => {
      await session.current.submitRecording();
    });
    expect(session.current.result).toEqual(weakResult);
    expect(session.current.reviewWordScoredRef.current).toBe(true);
    expect(session.current.reviewJustScored).toBe(true);
    expect(session.current.status).toBe("Score complete");
    expect(session.current.error).toBe("Score saved, but the word bank could not be updated: Word bank is full");
    expect(session.current.isScoring).toBe(false);
  });

  it("late_response_and_finally_cannot_modify_new_context", async () => {
    const first = deferred<FetchResponse>();
    const second = deferred<FetchResponse>();
    const scores = [first, second];
    overrides["/api/score"] = () => scores.shift()!.promise;
    const session = await renderSession();
    await recordTake(session);
    act(() => {
      void session.current.submitRecording();
    });

    // Move on and score a new take while the first request is still out.
    act(() => session.current.resetPractice());
    await recordTake(session);
    act(() => {
      void session.current.submitRecording();
    });
    expect(session.current.isScoring).toBe(true);

    await act(async () => {
      first.resolve(scoreResponse(weakResult, "s-old"));
    });
    expect(session.current.result).toBeNull();
    expect(session.current.isScoring).toBe(true);
    expect(fetchCalls("/api/words/from-session/s-old")).toHaveLength(0);

    const collection = deferred<FetchResponse>();
    overrides["/api/words/from-session/s-new"] = () => collection.promise;
    await act(async () => {
      second.resolve(scoreResponse(otherResult, "s-new"));
    });
    await waitFor(() => expect(session.current.result).toEqual(otherResult));
    expect(session.current.isScoring).toBe(false);

    // A collection failure that lands after the context moved on changes nothing.
    act(() => session.current.resetPractice());
    await act(async () => {
      collection.resolve(respond({ detail: "Word bank is full" }, 409));
    });
    expect(session.current.error).toBe("");
    expect(session.current.result).toBeNull();
    expect(session.current.status).toBe("Score complete");
  });

  it.each([
    ["recording", "success"],
    ["recording", "failure"],
    ["stopped", "success"],
    ["stopped", "failure"],
    ["rescoring", "success"],
    ["rescoring", "failure"]
  ] as const)("old_collection_settling_while_new_take_is_%s_changes_nothing (%s)", async (phase, outcome) => {
    const collection = deferred<FetchResponse>();
    overrides["/api/words/from-session/s1"] = () => collection.promise;
    const rescore = deferred<FetchResponse>();
    const scores = [async () => scoreResponse(weakResult, "s1"), () => rescore.promise];
    overrides["/api/score"] = () => scores.shift()!();
    const session = await renderSession();
    await recordTake(session);
    act(() => {
      void session.current.submitRecording();
    });
    await waitFor(() => expect(session.current.result).toEqual(weakResult));

    await act(async () => {
      await session.current.startRecording();
    });
    if (phase !== "recording") act(() => session.current.stopRecording());
    if (phase === "rescoring") {
      act(() => {
        void session.current.submitRecording();
      });
    }
    const before = {
      status: session.current.status,
      error: session.current.error,
      result: session.current.result,
      isScoring: session.current.isScoring
    };

    await act(async () => {
      collection.resolve(
        outcome === "success" ? respond([{ id: "1", word: "thin" }]) : respond({ detail: "old word bank failure" }, 409)
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect({
      status: session.current.status,
      error: session.current.error,
      result: session.current.result,
      isScoring: session.current.isScoring
    }).toEqual(before);
    expect(before.isScoring).toBe(phase === "rescoring");
  });

  it("rerecord_without_rescoring_still_counts_as_practiced", async () => {
    overrides["/api/words"] = async () => respond([dueWord]);
    const session = await renderSession();
    await waitFor(() => expect(session.current.vocabulary).toHaveLength(1));
    act(() => session.current.startReview());
    await recordTake(session);
    await act(async () => {
      await session.current.submitRecording();
    });
    expect(session.current.reviewJustScored).toBe(true);

    await recordTake(session);
    expect(session.current.reviewJustScored).toBe(false);
    expect(session.current.reviewWordScoredRef.current).toBe(true);

    act(() => session.current.showNextReviewWord());
    expect(session.current.reviewSummaryCount).toBe(1);
    expect(session.current.reviewScoredCount).toBe(1);
  });
});

// The microphone level every analyser read reports, in dBFS.
let micDbfs = -60;

class FakeNode {
  connect = vi.fn((node: unknown) => node);
  disconnect = vi.fn();
}

class FakeAudioContext {
  static constructed = 0;
  state: AudioContextState = "running";
  currentTime = 0;
  destination = new FakeNode();
  resume = vi.fn(async () => undefined);
  suspend = vi.fn();
  close = vi.fn(async () => undefined);
  createMediaStreamSource = vi.fn(() => new FakeNode());
  createAnalyser = vi.fn(() =>
    Object.assign(new FakeNode(), {
      fftSize: 0,
      getFloatTimeDomainData: (samples: Float32Array) => samples.fill(10 ** (micDbfs / 20))
    })
  );
  createGain = vi.fn(() => Object.assign(new FakeNode(), { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }));
  createOscillator = vi.fn(() => Object.assign(new FakeNode(), { frequency: { value: 0 }, onended: null, start: vi.fn(), stop: vi.fn() }));
  constructor() {
    FakeAudioContext.constructed += 1;
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Feeds one level per 25 ms frame.
async function frames(levels: readonly number[]) {
  for (const level of levels) {
    micDbfs = level;
    await advance(25);
  }
}

async function startTake(
  session: Awaited<ReturnType<typeof renderSession>>,
  options: RunCaptureOptions,
  onReady: (blob: Blob, summary: CaptureSummary) => void
) {
  let started = false;
  await act(async () => {
    started = await session.current.startRunCapture(options, onReady);
  });
  return started;
}

function summaryOf(onReady: ReturnType<typeof vi.fn>, call = 0): CaptureSummary {
  return onReady.mock.calls[call][1] as CaptureSummary;
}

describe("usePracticeSession run capture analysis", () => {
  // Opens the run with fake time; waitFor is not used after this point.
  async function openRun(audio = true) {
    installRecorder();
    const session = await renderSession();
    act(() => session.current.enterRun());
    if (audio) act(() => session.current.prepareRunAudio());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    return session;
  }

  beforeEach(() => {
    overrides = {};
    deferPermission = false;
    asyncStop = false;
    recorders = [];
    permission = null;
    micDbfs = -60;
    FakeAudioContext.constructed = 0;
    window.localStorage.clear();
    setRunPreference("autoStop", true);
    installFetch();
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.useRealTimers();
    releaseRunAudio();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("permission_wait_does_not_consume_capture_timeout", async () => {
    const session = await openRun();
    deferPermission = true;
    const onReady = vi.fn();
    let started!: Promise<boolean>;
    act(() => {
      started = session.current.startRunCapture(runOptions(true), onReady);
    });
    await advance(10_000);
    await act(async () => {
      permission?.resolve();
      expect(await started).toBe(true);
    });

    await advance(3_900);
    expect(onReady).not.toHaveBeenCalled();
    expect(session.current.recorderState).toBe("recording");
    await advance(200);
    expect(onReady).toHaveBeenCalledTimes(1);
    const summary = summaryOf(onReady);
    expect(summary).toMatchObject({ stopReason: "no-speech", speechSeen: false, detectionValid: true });
    expect(summary.durationMs).toBeGreaterThanOrEqual(4_000);
    expect(summary.durationMs).toBeLessThan(4_100);
    expect(classifyCapture(summary, "word")).toBe("no-speech");
  });

  it("racing_stop_sources_deliver_one_frozen_summary", async () => {
    const session = await openRun();
    asyncStop = true;
    const onReady = vi.fn();
    await startTake(session, runOptions(true), onReady);
    micDbfs = -30;
    await advance(600);
    micDbfs = -60;
    await advance(700);
    expect(session.current.runCaptureTelemetry.get().autoStopState).toBe("stopping");

    // Manual Stop and the hard cap arrive after the silence stop was accepted, before onstop.
    act(() => session.current.stopRecording());
    act(() => session.current.stopRunCapture("manual"));
    await advance(30_000);
    act(() => recorders[0].fireStop());

    expect(onReady).toHaveBeenCalledTimes(1);
    const summary = summaryOf(onReady);
    expect(summary).toMatchObject({ stopReason: "silence", speechSeen: true, detectionValid: true, voicedMs: 600 });
    expect(summary.durationMs).toBe(1_250);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(classifyCapture(summary, "word")).toBe("submit");
    expect(session.current.runCaptureTelemetry.get().captureId).toBeNull();
  });

  it("cancel_after_stop_before_onstop_discards_delivery", async () => {
    const session = await openRun();
    asyncStop = true;
    const onReady = vi.fn();
    await startTake(session, runOptions(true), onReady);
    micDbfs = -30;
    await advance(600);
    micDbfs = -60;
    await advance(700);
    act(() => session.current.cancelRunCapture("pause"));
    act(() => recorders[0].fireStop());

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(summaryOf(onReady).stopReason).toBe("pause");
    expect(classifyCapture(summaryOf(onReady), "word")).toBe("discard");
    expect(session.current.audioBlob).toBeNull();
    expect(session.current.status).toBe("");
  });

  it("late_permission_and_cancelled_onstop_do_not_publish_preview", async () => {
    const session = await openRun();
    deferPermission = true;
    const late = vi.fn();
    let started!: Promise<boolean>;
    act(() => {
      started = session.current.startRunCapture(runOptions(true), late);
    });
    act(() => session.current.cancelRunCapture("quit"));
    // No stream was open, so the cue hold ends with the cancellation.
    expect(playCue("good", "after-cancelled-permission")).toBe(true);
    await act(async () => {
      permission?.resolve();
      expect(await started).toBe(false);
    });
    expect(late).not.toHaveBeenCalled();
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(session.current.audioBlob).toBeNull();
    expect(session.current.recorderState).toBe("idle");

    deferPermission = false;
    asyncStop = true;
    const exited = vi.fn();
    await startTake(session, runOptions(true), exited);
    expect(playCue("good", "while-recording")).toBe(false);
    act(() => session.current.exitRun());
    act(() => recorders[0].fireStop());
    expect(summaryOf(exited).stopReason).toBe("exit");
    expect(session.current.audioBlob).toBeNull();
    expect(session.current.audioUrl).toBeNull();
  });

  it("normal_to_run_and_run_to_normal_keep_capture_ownership", async () => {
    const session = await openRun();
    act(() => session.current.exitRun());
    asyncStop = true;
    await act(async () => {
      await session.current.startRecording();
    });
    act(() => session.current.enterRun());
    act(() => session.current.prepareRunAudio());
    const run = vi.fn();
    await startTake(session, runOptions(true), run);
    // The normal take's late onstop reaches neither the run nor the preview.
    act(() => recorders[0].fireStop());
    expect(run).not.toHaveBeenCalled();
    expect(session.current.status).toBe("");
    expect(session.current.recorderState).toBe("recording");

    // The run take outlives the run; its late onstop never reaches the normal flow.
    act(() => session.current.exitRun());
    await act(async () => {
      await session.current.startRecording();
    });
    act(() => recorders[1].fireStop());
    expect(summaryOf(run).stopReason).toBe("exit");
    expect(session.current.status).toBe("");
    expect(session.current.recorderState).toBe("recording");
    act(() => {
      session.current.stopRecording();
      recorders[2].fireStop();
    });
    expect(session.current.status).toBe("Recording ready");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("auto_preference_change_applies_next_take", async () => {
    const session = await openRun();
    // The run snapshots the preference when each take starts.
    const first = vi.fn();
    await startTake(session, runOptions(getRunPreferences().autoStop), first);
    setRunPreference("autoStop", false);
    micDbfs = -30;
    await advance(600);
    micDbfs = -60;
    await advance(700);
    expect(summaryOf(first).stopReason).toBe("silence");

    const second = vi.fn();
    await startTake(session, runOptions(getRunPreferences().autoStop), second);
    setRunPreference("autoStop", true);
    micDbfs = -30;
    await advance(600);
    micDbfs = -60;
    await advance(5_000);
    expect(second).not.toHaveBeenCalled();
    expect(session.current.runCaptureTelemetry.get().autoStopState).toBe("off");
    act(() => session.current.stopRunCapture());
    expect(summaryOf(second)).toMatchObject({ stopReason: "manual", speechSeen: false });
  });

  it("fallback_retains_manual_and_session_hard_cap", async () => {
    const session = await openRun();
    const spread = [-60, -42, -60, -60, -60, -60, -42, -60, -60, -60];
    const manual = vi.fn();
    await startTake(session, runOptions(true), manual);
    await frames(spread);
    expect(session.current.runCaptureTelemetry.get().autoStopState).toBe("fallback");
    await advance(3_000);
    expect(manual).not.toHaveBeenCalled();
    act(() => session.current.stopRunCapture());
    expect(classifyCapture(summaryOf(manual), "word")).toBe("submit");

    const capped = vi.fn();
    await startTake(session, runOptions(true), capped);
    await frames(spread);
    await advance(20_000);
    expect(capped).not.toHaveBeenCalled();
    await advance(10_000);
    expect(capped).toHaveBeenCalledTimes(1);
    expect(summaryOf(capped)).toMatchObject({ stopReason: "hard-cap", durationMs: 30_000 });
    expect(classifyCapture(summaryOf(capped), "word")).toBe("submit");
  });

  it("audio_unlock_failure_keeps_manual_flow", async () => {
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function Blocked() {
        throw new Error("NotAllowedError");
      })
    );
    const session = await openRun();
    const onReady = vi.fn();
    expect(await startTake(session, runOptions(true), onReady)).toBe(true);
    expect(session.current.runCaptureTelemetry.get().autoStopState).toBe("off");
    await advance(8_000);
    expect(onReady).not.toHaveBeenCalled();
    expect(session.current.runCaptureTelemetry.get().elapsedMs).toBeGreaterThanOrEqual(7_975);
    act(() => session.current.stopRunCapture());
    const summary = summaryOf(onReady);
    expect(summary).toMatchObject({ stopReason: "manual", detectionValid: false, speechSeen: false });
    expect(classifyCapture(summary, "word")).toBe("submit");
  });

  it("ordinary_explicit_score_is_unchanged", async () => {
    installRecorder();
    const session = await renderSession();
    act(() => session.current.setPassage("thin path"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    await act(async () => {
      await session.current.startRecording();
    });
    await advance(10_000);
    expect(session.current.recorderState).toBe("recording");
    // No run audio: nothing analyses or stops an ordinary take.
    expect(FakeAudioContext.constructed).toBe(0);
    act(() => session.current.stopRecording());
    expect(session.current.status).toBe("Recording ready");
    expect(fetchCalls("/api/score")).toHaveLength(0);
    await act(async () => {
      await session.current.submitRecording();
    });
    expect(fetchCalls("/api/score")).toHaveLength(1);
  });

  it("late_permission_cannot_take_over_a_newer_capture", async () => {
    // Run → normal: the run's take is cancelled by exit while permission is pending.
    let session = await openRun();
    deferPermission = true;
    const runTake = vi.fn();
    let runStarted!: Promise<boolean>;
    act(() => {
      runStarted = session.current.startRunCapture(runOptions(true), runTake);
    });
    act(() => session.current.exitRun());
    deferPermission = false;
    await act(async () => {
      await session.current.startRecording();
    });
    expect(session.current.recorderState).toBe("recording");
    await act(async () => {
      permissions[0].resolve();
      expect(await runStarted).toBe(false);
    });
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(1);
    expect(runTake).not.toHaveBeenCalled();
    expect(session.current.recorderState).toBe("recording");
    expect(vi.getTimerCount()).toBe(1);
    act(() => session.current.stopRecording());
    expect(recorders[0].state).toBe("inactive");
    expect(session.current.status).toBe("Recording ready");
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    session.unmount();
    vi.useRealTimers();

    // Normal → run: the ordinary take is abandoned by entering the run while permission is pending.
    session = await openRun(false);
    act(() => session.current.exitRun());
    deferPermission = true;
    let normalStarted!: Promise<void>;
    act(() => {
      normalStarted = session.current.startRecording();
    });
    act(() => session.current.enterRun());
    deferPermission = false;
    const runReady = vi.fn();
    await startTake(session, runOptions(), runReady);
    await act(async () => {
      permissions[0].resolve();
      await normalStarted;
    });
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(1);
    act(() => session.current.stopRunCapture());
    expect(recorders[0].state).toBe("inactive");
    expect(runReady).toHaveBeenCalledTimes(1);
    expect(session.current.status).not.toBe("Recording ready");
  });

  it("setup_failure_and_unmount_release_the_microphone", async () => {
    // The recorder fails to start after permission and analysis: its stream closes, then cues resume.
    let session = await openRun();
    failStart = true;
    let failure: unknown = null;
    await act(async () => {
      await session.current.startRunCapture(runOptions(true), vi.fn()).catch((error: unknown) => {
        failure = error;
      });
    });
    expect(failure).toBeInstanceOf(Error);
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(playCue("good", "after-failed-start")).toBe(true);
    failStart = false;

    // Unmounting with an active manual take stops the take, its tracks, timers, meter and context.
    const take = vi.fn();
    await startTake(session, runOptions(false), take);
    expect(vi.getTimerCount()).toBe(2);
    expect(playCue("good", "while-recording")).toBe(false);
    session.unmount();
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(recorders[1].state).toBe("inactive");
    expect(vi.getTimerCount()).toBe(0);
    expect(take).toHaveBeenCalledTimes(1);
    expect(summaryOf(take).stopReason).toBe("exit");
    expect(classifyCapture(summaryOf(take), "word")).toBe("discard");
    vi.useRealTimers();

    // Unmounting while permission is pending: the late stream is closed and nothing starts.
    session = await openRun();
    deferPermission = true;
    let pending!: Promise<boolean>;
    act(() => {
      pending = session.current.startRunCapture(runOptions(true), vi.fn());
    });
    session.unmount();
    // Unmount closed this owner's context; with a fresh one, cues are no longer held.
    prepareRunAudio();
    expect(playCue("good", "after-pending-unmount")).toBe(true);
    await act(async () => {
      permissions[0].resolve();
      expect(await pending).toBe(false);
    });
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("late_onstop_after_unmount_never_releases_another_hold", async () => {
    const session = await openRun();
    asyncStop = true;
    const take = vi.fn();
    await startTake(session, runOptions(false), take);
    session.unmount();
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    // A newer owner opens run audio and holds the microphone before the old take's onstop arrives.
    prepareRunAudio();
    const releaseNewer = holdMicrophone();
    act(() => recorders[0].fireStop());
    expect(take).toHaveBeenCalledTimes(1);
    expect(summaryOf(take).stopReason).toBe("exit");
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(playCue("good", "newer-hold")).toBe(false);
    releaseNewer();
    expect(playCue("good", "after-newer-hold")).toBe(true);
  });

  it("late_permission_denial_after_cancel_settles_false_and_current_denial_reports", async () => {
    const session = await openRun();
    deferPermission = true;
    const cancelledTake = vi.fn();
    let cancelled!: Promise<boolean>;
    act(() => {
      cancelled = session.current.startRunCapture(runOptions(true), cancelledTake);
    });
    act(() => session.current.exitRun());
    deferPermission = false;
    await act(async () => {
      await session.current.startRecording();
    });
    await act(async () => {
      permissions[0].reject(new Error("NotAllowedError"));
      expect(await cancelled).toBe(false);
    });
    expect(cancelledTake).not.toHaveBeenCalled();
    expect(session.current.recorderState).toBe("recording");
    act(() => session.current.stopRecording());
    expect(session.current.status).toBe("Recording ready");

    // A denial for the capture still waiting rejects, and its cue hold is released.
    act(() => session.current.enterRun());
    act(() => session.current.prepareRunAudio());
    deferPermission = true;
    let current!: Promise<boolean>;
    act(() => {
      current = session.current.startRunCapture(runOptions(true), vi.fn());
    });
    await act(async () => {
      permissions[1].reject(new Error("NotAllowedError"));
      await expect(current).rejects.toThrow("NotAllowedError");
    });
    expect(playCue("good", "after-current-denial")).toBe(true);
  });
});

// The run controller over the real session and speech hooks: only fetch, MediaRecorder and Audio are
// fakes. Astra's A4 seam cases, kept as written.
async function renderCombined() {
  let session!: ReturnType<typeof usePracticeSession>;
  let run!: ReturnType<typeof usePracticeRun>;
  function Combined() {
    session = usePracticeSession();
    run = usePracticeRun(session);
    return null;
  }
  const view = render(<Combined />);
  await waitFor(() => expect(session.health).not.toBeNull());
  await act(async () => { await run.start(configForChoice({ selection: "route", routeLength: 6 })); });
  return { session: () => session, run: () => run, ...view };
}

describe("A4 real controller and speech seams", () => {
  beforeEach(() => {
    overrides = {}; deferPermission = false; asyncStop = false; recorders = []; permission = null;
    installFetch(); installRecorder();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(["record", "next-preview"] as const)("replayed_reference_late_play_rejection_cannot_mutate_%s", async (destination) => {
    let rejectReplay!: (e: Error) => void;
    const replay = new Promise<void>((_resolve, reject) => { rejectReplay = reject; });
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("Audio", vi.fn(function AudioMock() {
      return { play, pause: vi.fn(), currentTime: 0, duration: 1 };
    }));
    const h = await renderCombined();
    await act(async () => { h.run().hearFirst(); });
    expect(play).toHaveBeenCalledTimes(1);
    expect(h.run().state?.items[0].referenceLoad).toBe("ready");
    // The already loaded Audio takes the reuse branch on this second Hear it first.
    play.mockReturnValueOnce(replay);
    await act(async () => { h.run().hearFirst(); });
    expect(play).toHaveBeenCalledTimes(2);
    if (destination === "record") {
      await act(async () => { await h.run().record(); });
      expect(h.run().state?.phase).toBe("recording");
    } else {
      act(() => h.run().skip());
      await act(async () => { h.run().hearFirst(); });
      expect(h.run().state?.index).toBe(1);
      expect(h.session().speechStatus).toBe("playing");
    }
    expect(h.session().error).toBeFalsy();
    await act(async () => {
      rejectReplay(new Error("AbortError: obsolete replay was interrupted"));
      await Promise.resolve();
    });
    expect.soft(h.session().error).toBeFalsy();
    if (destination === "next-preview") expect(h.session().speechStatus).toBe("playing");
  });

  it.each([true, false])("pending_old_reference_settlement_after_skip_leaves_new_preview_alone_%s", async (ok) => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("Audio", vi.fn(function AudioMock() { return { play, pause: vi.fn(), currentTime: 0 }; }));
    const h = await renderCombined();
    const old = deferred<FetchResponse>();
    overrides["/api/speak"] = () => old.promise;
    act(() => h.run().hearFirst());
    expect(h.session().speechStatus).toBe("loading");
    act(() => h.run().skip());
    delete overrides["/api/speak"];
    await act(async () => { h.run().hearFirst(); });
    expect(play).toHaveBeenCalledTimes(1);
    const newText = h.run().state!.items[1].prompt.text;
    await act(async () => {
      old.resolve(ok ? respond({ audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }) : respond({ detail: "old failure" }, 503));
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(1);
    expect(h.session().speechStatus).toBe("playing");
    expect(h.session().speakingText).toBe(newText);
    expect(h.session().error).toBeFalsy();
    expect(h.run().state?.items[1].referenceLoad).toBe("ready");
  });
});
