import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addWordsFromSession, ApiError, fetchPhonemeStats, listWords, scoreRecording } from "../api";
import { readBest, RUN_BEST_KEY } from "../game/personalBest";
import { configForChoice } from "../game/runConfig";
import { buildRunDeck } from "../game/runDeck";
import { setRunPreference } from "../game/preferences";
import { RUN_RULES_VERSION } from "../game/scoring";
import { cancelCues, playCue, resetCueEvents } from "../game/sfx";
import type {
  CaptureStopReason,
  CaptureSummary,
  RunCaptureOptions,
  RunConfig,
  RunMode,
  ScoreResponse,
  WordResult
} from "../types";
import { usePracticeRun, type RunSession } from "./usePracticeRun";

// A test may shrink the starter pack to two items per stage, as v2 shipped it.
const pack = vi.hoisted(() => ({ small: false }));
vi.mock("../game/starterPack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/starterPack")>();
  const small = actual.STARTER_PACK.filter((item) => Number(item.id.at(-1)) <= 2);
  return {
    ...actual,
    get STARTER_PACK() {
      return pack.small ? small : actual.STARTER_PACK;
    }
  };
});

vi.mock("../game/runDeck", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/runDeck")>();
  return { ...actual, buildRunDeck: vi.fn(actual.buildRunDeck) };
});

vi.mock("../game/sfx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/sfx")>()),
  playCue: vi.fn(() => true),
  cancelCues: vi.fn(),
  resetCueEvents: vi.fn()
}));

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  scoreRecording: vi.fn(),
  addWordsFromSession: vi.fn(),
  fetchPhonemeStats: vi.fn(),
  listWords: vi.fn()
}));

function word(text: string, accuracy: number): WordResult {
  return { word: text, accuracy, bucket: "watch", error_type: "None", offset_ms: 0, duration_ms: 100, phonemes: [] };
}

let sessionCounter = 0;
function scored(accuracy: number, words: WordResult[] = [word("thin", accuracy)]): ScoreResponse {
  const scores = { accuracy, fluency: null, completeness: null, prosody: null, pronunciation: null };
  sessionCounter += 1;
  return {
    result: { transcript: "", recognition_status: "success", scores, words, raw: {} },
    session: { id: `session-${sessionCounter}`, created_at: "", reference_text: "", audio_duration_ms: 0, scores }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A stand-in for the shared recorder: one capture at a time, one blob and summary per stop.
function fakeSession() {
  let active: ((blob: Blob, summary: CaptureSummary) => void) | null = null;
  let activeId = "";
  const loads: ((ok: boolean) => void)[] = [];
  // What the next delivered take reports, on top of a healthy manual stop.
  const take: { summary: Partial<CaptureSummary> } = { summary: {} };
  const fire = (reason: CaptureStopReason) => {
    const onReady = active;
    active = null;
    onReady?.(new Blob(["audio"], { type: "audio/mp4" }), {
      captureId: activeId,
      stopReason: reason,
      durationMs: 1000,
      detectionValid: true,
      speechSeen: true,
      voicedMs: 800,
      ...take.summary
    });
  };
  const session = {
    enterRun: vi.fn(),
    exitRun: vi.fn(),
    prepareRunAudio: vi.fn(),
    startRunCapture: vi.fn(async (options: RunCaptureOptions, onReady: (blob: Blob, summary: CaptureSummary) => void) => {
      active = onReady;
      activeId = options.key.attemptId;
      return true;
    }),
    cancelRunCapture: vi.fn((reason: CaptureStopReason = "cancel") => fire(reason)),
    stopRunCapture: vi.fn((reason: CaptureStopReason = "manual") => fire(reason)),
    runCaptureTelemetry: { get: vi.fn(), set: vi.fn(), subscribe: vi.fn() },
    playCorrect: vi.fn(async (_text: string, options?: { onLoadResult?: (ok: boolean) => void }) => {
      if (options?.onLoadResult) loads.push(options.onLoadResult);
    }),
    stopCurrentSpeech: vi.fn(),
    speakingText: "",
    speechStatus: "idle",
    speechCurrentTime: 0,
    speechDuration: 0,
    refreshVocabulary: vi.fn(async () => undefined),
    setError: vi.fn()
  };
  return { session: session as unknown as RunSession & typeof session, loads, take, fire };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const ROUTE = configForChoice({ selection: "route", routeLength: 6 });
const CHALLENGE = configForChoice({ selection: "target60", routeLength: 6 });

async function setup(choice: RunMode | RunConfig) {
  const config = choice === "route" ? ROUTE : choice === "challenge" ? CHALLENGE : choice;
  const fake = fakeSession();
  const hook = renderHook(() => usePracticeRun(fake.session));
  await act(async () => {
    await hook.result.current.start(config);
  });
  return { ...fake, hook, run: () => hook.result.current };
}

type Harness = Awaited<ReturnType<typeof setup>>;

async function attempt(h: Harness, outcome: ScoreResponse | unknown, fails = false) {
  if (fails) vi.mocked(scoreRecording).mockRejectedValueOnce(outcome);
  else vi.mocked(scoreRecording).mockResolvedValueOnce(outcome as ScoreResponse);
  await act(async () => {
    await h.run().record();
  });
  act(() => h.run().stop());
  await flush();
}

function current(h: Harness) {
  const state = h.run().state;
  if (!state) throw new Error("no run");
  return state.items[state.index];
}

describe("usePracticeRun", () => {
  let urlCounter = 0;

  beforeEach(() => {
    urlCounter = 0;
    window.localStorage.clear();
    setRunPreference("autoStop", true);
    vi.mocked(fetchPhonemeStats).mockResolvedValue([]);
    vi.mocked(listWords).mockResolvedValue([]);
    vi.mocked(addWordsFromSession).mockResolvedValue([]);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:attempt-${++urlCounter}`),
      revokeObjectURL: vi.fn()
    });
  });

  afterEach(() => {
    pack.small = false;
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts_from_fetched_stats_and_vocabulary", async () => {
    vi.mocked(fetchPhonemeStats).mockResolvedValue([
      { phoneme: "v", average_accuracy: 40, attempts: 5 } as never,
      { phoneme: "θ", average_accuracy: 90, attempts: 5 } as never
    ]);
    vi.mocked(listWords).mockRejectedValue(new Error("offline"));
    const h = await setup("route");
    expect(h.session.enterRun).toHaveBeenCalledTimes(1);
    expect(h.run().state?.items.find((item) => item.prompt.stage === "focus")?.prompt.targetPhoneme).toBe("v");
    expect(h.run().state?.items).toHaveLength(6);
  });

  it("one_stop_submits_once_despite_double_tap_or_autostop", async () => {
    const h = await setup("route");
    const pending = deferred<ScoreResponse>();
    vi.mocked(scoreRecording).mockReturnValueOnce(pending.promise);
    await act(async () => {
      await Promise.all([h.run().record(), h.run().record()]);
    });
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(1);
    const onReady = h.session.startRunCapture.mock.calls[0][1];
    act(() => {
      h.run().stop();
      h.run().stop();
      // An auto-stop racing the manual stop delivers the same capture again.
      onReady(new Blob(["late"]), { captureId: h.session.startRunCapture.mock.calls[0][0].key.attemptId, stopReason: "silence", durationMs: 900, detectionValid: true, speechSeen: true, voicedMs: 700 });
    });
    expect(scoreRecording).toHaveBeenCalledTimes(1);
    expect(vi.mocked(scoreRecording).mock.calls[0][2]).toBe("short");
    expect(h.run().state?.budgetUsed).toBe(1);
    // Nothing else can be captured while the score is in flight.
    await act(async () => {
      await h.run().record();
    });
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(1);
    pending.resolve(scored(90));
    await flush();
    expect(current(h).verdict).toBe("practiced");
  });

  it("status_only_rejection_refunds_unknown_continues_and_429_ends", async () => {
    const h = await setup("challenge");
    for (const status of [400, 413, 503]) {
      await attempt(h, new ApiError("Recording too short", status), true);
      expect(h.run().state?.budgetUsed).toBe(0);
      expect(h.run().state?.index).toBe(0);
      expect(current(h).lastRejection?.message).toBe("Recording too short");
    }
    // Codes and messages never override status.
    await attempt(h, new ApiError("Daily limit reached", 500, "quota_exhausted"), true);
    expect(current(h).resolution).toBe("pending");
    expect(h.run().state?.budgetUsed).toBe(1);
    act(() => h.run().finish());

    await attempt(h, {});
    expect(current(h).resolution).toBe("pending");
    act(() => h.run().finish());

    await attempt(h, { result: scored(80).result, session: null });
    expect(current(h).resolution).toBe("pending");
    act(() => h.run().finish());

    // An unknown rescue outcome stops confirmation without losing a heart.
    await attempt(h, scored(40));
    expect(h.run().state?.phase).toBe("rescue");
    act(() => h.run().playReference());
    act(() => h.loads[0](true));
    await attempt(h, new TypeError("Failed to fetch"), true);
    expect(current(h).resolution).toBe("pending");
    expect(h.run().state?.hearts).toBe(2);
    expect(h.run().state?.challengeIncomplete).toBe(true);
    act(() => h.run().finish());

    await attempt(h, new ApiError("Trial usage ran out", 429), true);
    expect(h.run().state?.endReason).toBe("quota");
    expect(h.run().state?.phase).toBe("summary");
    expect(scoreRecording).toHaveBeenCalledTimes(9);
  });

  it("sentence_score_precedes_collection_and_next_waits_until_settled", async () => {
    const h = await setup("route");
    for (let i = 0; i < 4; i += 1) {
      await attempt(h, scored(90));
      act(() => h.run().finish());
    }
    expect(current(h).prompt.kind).toBe("sentence");

    const collection = deferred<never[]>();
    vi.mocked(addWordsFromSession).mockReturnValueOnce(collection.promise);
    const sentence = scored(65, [word("path", 50), word("leads", 75)]);
    await attempt(h, sentence);
    const shown = current(h);
    expect(shown.attempts[0].result).toEqual(sentence.result);
    expect(shown.attempts[0].sync).toBe("pending");
    expect(shown.attempts[0].candidates).toEqual([{ word: "path", status: "unconfirmed" }]);
    expect(addWordsFromSession).toHaveBeenCalledWith(sentence.session?.id, 70);

    const captures = h.session.startRunCapture.mock.calls.length;
    act(() => h.run().recordNext());
    await flush();
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(captures);
    expect(h.run().state?.index).toBe(4);

    // A successful call that returns no rows has not confirmed any candidate.
    collection.resolve([]);
    await flush();
    expect(current(h).attempts[0].candidates).toEqual([{ word: "path", status: "unconfirmed" }]);
    act(() => h.run().finish());

    vi.mocked(addWordsFromSession).mockRejectedValueOnce(new Error("Word bank is full"));
    await attempt(h, scored(60, [word("river", 55)]));
    expect(current(h).attempts[0].sync).toBe("manual");
    expect(current(h).attempts[0].candidates).toEqual([{ word: "river", status: "save-manually" }]);
    act(() => h.run().finish());
    expect(h.run().state?.phase).toBe("summary");
    act(() => h.run().openReview());
    expect(h.run().state?.phase).toBe("review");
  });

  it("word_attempt_never_posts_from_session", async () => {
    const h = await setup("route");
    await attempt(h, scored(40));
    act(() => h.run().finish());
    await attempt(h, scored(90));
    expect(current(h).prompt.kind).toBe("word");
    expect(addWordsFromSession).not.toHaveBeenCalled();
  });

  it("pause_allows_matching_submitted_result_without_new_capture", async () => {
    const h = await setup("route");
    await act(async () => {
      await h.run().record();
    });
    act(() => h.run().pause());
    expect(h.session.cancelRunCapture).toHaveBeenCalledTimes(1);
    expect(h.session.cancelRunCapture).toHaveBeenCalledWith("pause");
    expect(cancelCues).toHaveBeenCalled();
    expect(h.session.stopCurrentSpeech).toHaveBeenCalled();
    expect(scoreRecording).not.toHaveBeenCalled();
    expect(current(h).attempts).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      await h.run().record();
    });
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(1);
    act(() => h.run().resume());

    const pending = deferred<ScoreResponse>();
    vi.mocked(scoreRecording).mockReturnValueOnce(pending.promise);
    await act(async () => {
      await h.run().record();
    });
    act(() => h.run().stop());
    act(() => h.run().pause());
    pending.resolve(scored(80));
    await flush();
    expect(current(h).verdict).toBe("practiced");
    expect(h.run().state?.paused).toBe(true);
    // Settled while paused: no new capture and no cue.
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(2);
    expect(playCue).not.toHaveBeenCalled();
  });

  it("rescue_record_requires_reference_ready_without_waiting_for_ended", async () => {
    const h = await setup("challenge");
    await attempt(h, scored(40));
    expect(h.run().state?.phase).toBe("rescue");
    await act(async () => {
      await h.run().record();
    });
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(1);

    act(() => h.run().playReference());
    act(() => h.run().playReference());
    expect(h.session.playCorrect).toHaveBeenCalledTimes(1);
    expect(current(h).referenceLoad).toBe("pending");
    await act(async () => {
      await h.run().record();
    });
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(1);

    act(() => h.loads[0](true));
    await attempt(h, scored(70));
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(2);
    expect(current(h).verdict).toBe("saved");

    act(() => h.run().finish());
    await attempt(h, scored(40));
    act(() => h.run().playReference());
    act(() => h.loads[1](false));
    expect(current(h).verdict).toBe("cannot-confirm");
    expect(h.run().state?.hearts).toBe(2);
  });

  it("review_audio_matches_attempt_and_rejected_or_exited_audio_is_released", async () => {
    const h = await setup("challenge");
    await attempt(h, new ApiError("Recording too short", 400), true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attempt-1");
    expect(h.run().attemptAudioUrls).toEqual({});

    await attempt(h, scored(40));
    act(() => h.run().playReference());
    act(() => h.loads[0](true));
    await attempt(h, scored(70));
    const [first, rescue] = current(h).attempts;
    expect(h.run().attemptAudioUrls).toEqual({
      [first.key.attemptId]: "blob:attempt-2",
      [rescue.key.attemptId]: "blob:attempt-3"
    });
    expect(first.recording).toBeInstanceOf(Blob);

    act(() => h.run().exit());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attempt-2");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attempt-3");
    expect(h.run().attemptAudioUrls).toEqual({});
    expect(h.run().state).toBeNull();
    expect(h.session.exitRun).toHaveBeenCalledTimes(1);
  });

  it("review_refreshes_only_vocabulary_once_and_never_claims_added_count", async () => {
    vi.mocked(addWordsFromSession).mockResolvedValue([
      { id: "1", word: "path" },
      { id: "2", word: "leads" },
      { id: "3", word: "narrow" }
    ] as never);
    const h = await setup("challenge");
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(90, i < 4 ? [word("thin", 90)] : [word("narrow", 65), word("leads", 90)]));
      act(() => h.run().finish());
    }
    expect(h.run().state?.phase).toBe("summary");
    // Once when the run ends, then once more when Review opens.
    expect(h.session.refreshVocabulary).toHaveBeenCalledTimes(1);
    act(() => h.run().openReview());
    act(() => h.run().openReview());
    expect(h.run().state?.phase).toBe("review");
    expect(h.session.refreshVocabulary).toHaveBeenCalledTimes(2);
    const candidates = h.run().state?.items.flatMap((item) => item.attempts.flatMap((a) => a.candidates));
    expect(candidates).toEqual([
      { word: "narrow", status: "processed" },
      { word: "narrow", status: "processed" }
    ]);

    await act(async () => {
      await h.run().playAgain();
    });
    // Replacing the run keeps the audio unlocked by this gesture: no exitRun in between.
    expect(h.session.exitRun).not.toHaveBeenCalled();
    expect(h.session.prepareRunAudio).toHaveBeenCalledTimes(2);
    expect(h.session.enterRun).toHaveBeenCalledTimes(2);
    expect(h.run().state?.items[0].prompt.text).toBe("narrow");
    expect(h.run().state?.items[0].prompt.source).toBe("previous-run");
  });

  it("collection_marks_only_returned_rows_processed", async () => {
    const h = await setup("route");
    for (let i = 0; i < 4; i += 1) {
      await attempt(h, scored(90));
      act(() => h.run().finish());
    }
    // The bank filled after PATH: river was skipped, town is only a hint.
    vi.mocked(addWordsFromSession).mockResolvedValueOnce([{ id: "1", word: "PATH" }] as never);
    await attempt(h, scored(60, [word("path", 50), word("river", 55), word("town", 75)]));
    expect(current(h).attempts[0].sync).toBe("done");
    expect(current(h).attempts[0].candidates).toEqual([
      { word: "path", status: "processed" },
      { word: "river", status: "unconfirmed" }
    ]);
  });

  it("start_abandoned_by_exit_does_not_take_over_practice", async () => {
    const fake = fakeSession();
    const hook = renderHook(() => usePracticeRun(fake.session));
    const stats = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(stats.promise);
    let starting!: Promise<void>;
    act(() => {
      starting = hook.result.current.start(ROUTE);
    });
    act(() => hook.result.current.exit());
    await act(async () => {
      stats.resolve([]);
      await starting;
    });
    expect(hook.result.current.state).toBeNull();
    expect(fake.session.enterRun).not.toHaveBeenCalled();
  });

  it("play_again_abandoned_by_exit_does_not_take_over_practice", async () => {
    const h = await setup("route");
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(90));
      act(() => h.run().finish());
    }
    expect(h.run().state?.phase).toBe("summary");
    const stats = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(stats.promise);
    let again!: Promise<void>;
    act(() => {
      again = h.run().playAgain();
    });
    act(() => h.run().exit());
    expect(h.run().state).toBeNull();
    await act(async () => {
      stats.resolve([]);
      await again;
    });
    expect(h.run().state).toBeNull();
    expect(h.session.enterRun).toHaveBeenCalledTimes(1);
    expect(h.session.exitRun).toHaveBeenCalledTimes(1);

    // A later start still works.
    await act(async () => {
      await h.run().start(CHALLENGE);
    });
    expect(h.run().state?.mode).toBe("challenge");
  });

  it("malformed_nested_score_is_unknown_but_legitimate_unjudged_is_not", async () => {
    const valid = scored(90);
    const malformed: [string, unknown][] = [
      ["empty scores", { ...valid, result: { ...valid.result, scores: {} } }],
      ["string accuracy", { ...valid, result: { ...valid.result, scores: { ...valid.result.scores, accuracy: "90" } } }],
      ["word without phonemes", { ...valid, result: { ...valid.result, words: [{ word: "thin", accuracy: 90 }] } }],
      ["null word", { ...valid, result: { ...valid.result, words: [null] } }],
      ["null phoneme", { ...valid, result: { ...valid.result, words: [{ ...word("thin", 90), phonemes: [null] }] } }],
      [
        "string phoneme accuracy",
        {
          ...valid,
          result: {
            ...valid.result,
            words: [{ ...word("thin", 90), phonemes: [{ phoneme: "θ", accuracy: "40", bucket: "", offset_ms: 0, duration_ms: 0, n_best: [] }] }]
          }
        }
      ],
      ["array result", { ...valid, result: [] }],
      ["session without id", { ...valid, session: { created_at: "" } }]
    ];
    for (const [label, response] of malformed) {
      const h = await setup("route");
      await attempt(h, response);
      expect(current(h).resolution, label).toBe("pending");
      expect(h.run().state?.budgetUsed, label).toBe(1);
      h.hook.unmount();
    }

    const noMatch = { result: { ...valid.result, recognition_status: "no_match", words: [] }, session: null };
    const nullAccuracy = scored(90);
    (nullAccuracy.result.scores as { accuracy: number | null }).accuracy = null;
    const omission = scored(90, [word("thin", 90), { ...word("path", 0), error_type: "Omission" }]);
    for (const [label, response] of [
      ["NoMatch", noMatch],
      ["null accuracy", nullAccuracy],
      ["Omission", omission]
    ] as const) {
      const h = await setup("route");
      await attempt(h, response);
      expect(current(h).resolution, label).toBe("unjudged");
      h.hook.unmount();
    }
    expect(addWordsFromSession).not.toHaveBeenCalled();

    // Well-formed phonemes, including a null score, are still judged normally.
    const phonemes = [
      { phoneme: "θ", accuracy: 40, bucket: "needs-work", offset_ms: 0, duration_ms: 50, n_best: [] },
      { phoneme: "ɪ", accuracy: null, bucket: "unknown", offset_ms: 50, duration_ms: 50, n_best: [] }
    ];
    const h = await setup("route");
    await attempt(h, scored(90, [{ ...word("thin", 90), phonemes }]));
    expect(current(h).verdict).toBe("practiced");
  });

  it("local_reject_never_sends_or_allocates_review_url", async () => {
    const h = await setup("challenge");
    const capture = h.session.startRunCapture;
    for (const summary of [
      { speechSeen: false, voicedMs: 0, durationMs: 4000 },
      { durationMs: 400 }
    ] as const) {
      await act(async () => {
        await h.run().record();
      });
      expect(capture.mock.lastCall?.[0]).toMatchObject({ kind: "word", autoStop: true });
      h.take.summary = summary;
      act(() => h.fire(summary.durationMs === 4000 ? "no-speech" : "manual"));
    }
    expect(scoreRecording).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(h.run().state).toMatchObject({ budgetUsed: 0, phase: "ready", activeAttemptId: null });
    expect(current(h).attempts).toEqual([]);
    expect(current(h).lastRejection?.localReason).toBe("too-short");

    h.take.summary = {};
    await attempt(h, scored(90));
    expect(scoreRecording).toHaveBeenCalledTimes(1);
    expect(current(h).lastRejection).toBeNull();
  });

  it("manual_stop_without_onset_still_submits", async () => {
    const h = await setup("route");
    h.take.summary = { durationMs: 3000, speechSeen: false, voicedMs: 0 };
    await attempt(h, scored(80));
    expect(scoreRecording).toHaveBeenCalledTimes(1);
    expect(current(h).verdict).toBe("practiced");
  });

  it("manual_silence_cap_race_submits_once", async () => {
    const h = await setup("route");
    vi.mocked(scoreRecording).mockReturnValue(deferred<ScoreResponse>().promise);
    await act(async () => {
      await h.run().record();
    });
    const [options, onReady] = h.session.startRunCapture.mock.calls[0];
    act(() => h.fire("silence"));
    act(() => {
      h.run().stop();
      const late = { captureId: options.key.attemptId, durationMs: 1200, detectionValid: true, speechSeen: true, voicedMs: 900 };
      onReady(new Blob(["manual"]), { ...late, stopReason: "manual" });
      onReady(new Blob(["cap"]), { ...late, stopReason: "auto-cap" });
    });
    expect(scoreRecording).toHaveBeenCalledTimes(1);
    expect(h.run().state?.budgetUsed).toBe(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("cancel_take_does_not_skip_or_use_budget", async () => {
    const h = await setup("challenge");
    // The cancelled take's blob arrives later.
    h.session.cancelRunCapture.mockImplementationOnce(() => undefined);
    await act(async () => {
      await h.run().record();
    });
    act(() => h.run().cancelTake());
    expect(h.session.cancelRunCapture).toHaveBeenCalledWith("cancel");
    expect(h.run().state).toMatchObject({ phase: "ready", index: 0, budgetUsed: 0, extraUsed: 0 });
    expect(current(h).resolution).toBe("open");
    expect(current(h).verdict).toBeNull();

    // The lock holds until delivery, then the item records normally.
    await act(async () => {
      await h.run().record();
    });
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(1);
    act(() => h.fire("cancel"));
    expect(scoreRecording).not.toHaveBeenCalled();
    await attempt(h, scored(90));
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(2);
    expect(h.run().state?.budgetUsed).toBe(1);
  });

  it("pb_receipt_survives_summary_remount_without_rewrite", async () => {
    const h = await setup("challenge");
    const bucket = { mode: "challenge" as const, focus: current(h).prompt.targetPhoneme, rulesVersion: RUN_RULES_VERSION };
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(95));
      act(() => h.run().finish());
    }
    expect(h.run().state?.challengeOutcome).toBe("cleared");
    const receipt = h.run().receipt;
    expect(receipt).toMatchObject({ outcome: "first-record", previousPoints: null });
    expect(h.run().score).toMatchObject({ points: 955, rating: "S" });
    expect(playCue).toHaveBeenCalledWith("clear", `summary-${h.run().state?.runId}`);

    // Another tab stores a better run, then the public record would have expired: the summary and
    // review keep this run's receipt, and nothing is rewritten.
    const bucketKey = `challenge|${bucket.focus}|${RUN_RULES_VERSION}`;
    const other = { runId: "other-tab", points: 978, rating: "S", updatedAt: Date.now(), expiresAt: null };
    window.localStorage.setItem(RUN_BEST_KEY, JSON.stringify({ [bucketKey]: other }));
    const stored = window.localStorage.getItem(RUN_BEST_KEY);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 8 * 24 * 60 * 60 * 1000);
    h.hook.rerender();
    act(() => h.run().openReview());
    h.hook.rerender();
    expect(h.run().receipt).toBe(receipt);
    expect(window.localStorage.getItem(RUN_BEST_KEY)).toBe(stored);

    // A non-winning run keeps its own frozen comparison.
    await act(async () => {
      await h.run().playAgain();
    });
    expect(h.run().receipt).toBeNull();
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(85));
      act(() => h.run().finish());
    }
    const losing = h.run().receipt;
    expect(losing).toMatchObject({ outcome: "none", previousPoints: 978 });
    window.localStorage.clear();
    h.hook.rerender();
    act(() => h.run().openReview());
    expect(h.run().receipt).toBe(losing);
    expect(window.localStorage.getItem(RUN_BEST_KEY)).toBeNull();
  });

  it("new_stats_do_not_change_pb_bucket", async () => {
    vi.mocked(fetchPhonemeStats).mockResolvedValue([{ phoneme: "v", average_accuracy: 40, attempts: 5 } as never]);
    const h = await setup("route");
    expect(current(h).prompt.stage).toBe("warmup");
    vi.mocked(fetchPhonemeStats).mockResolvedValue([{ phoneme: "θ", average_accuracy: 10, attempts: 5 } as never]);
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(95));
      act(() => h.run().finish());
    }
    expect(h.run().receipt?.outcome).toBe("first-record");
    expect(readBest({ config: ROUTE, focus: "v", rulesVersion: RUN_RULES_VERSION })?.points).toBe(955);
    expect(readBest({ config: ROUTE, focus: "θ", rulesVersion: RUN_RULES_VERSION })).toBeNull();
  });

  it("quit_exit_play_again_drop_late_capture_and_cues", async () => {
    const h = await setup("route");
    // Takes are delivered late, after the run has moved on.
    h.session.cancelRunCapture.mockImplementation(() => undefined);
    await act(async () => {
      await h.run().record();
    });
    act(() => h.run().quit());
    expect(h.session.cancelRunCapture).toHaveBeenLastCalledWith("quit");
    expect(cancelCues).toHaveBeenCalled();
    act(() => h.fire("manual"));
    expect(scoreRecording).not.toHaveBeenCalled();
    expect(h.run().state?.endReason).toBe("quit");

    vi.mocked(resetCueEvents).mockClear();
    await act(async () => {
      await h.run().playAgain();
    });
    expect(resetCueEvents).toHaveBeenCalled();
    const pending = deferred<ScoreResponse>();
    vi.mocked(scoreRecording).mockReturnValueOnce(pending.promise);
    await act(async () => {
      await h.run().record();
    });
    act(() => h.run().stop());
    expect(scoreRecording).toHaveBeenCalledTimes(1);

    // Exit drops the in-flight score's late result and its cue.
    act(() => h.run().exit());
    expect(h.session.exitRun).toHaveBeenCalledTimes(1);
    pending.resolve(scored(95));
    await flush();
    expect(h.run().state).toBeNull();
    // Only the unrated quit summary asked, and it has no cue.
    expect(vi.mocked(playCue).mock.calls.filter(([cue]) => cue !== null)).toEqual([]);
  });

  it("start_exit_token_and_sentence_collection_regressions_hold", async () => {
    // Start unlocks audio synchronously, before the deck fetch resolves; exiting meanwhile abandons it.
    const fake = fakeSession();
    const hook = renderHook(() => usePracticeRun(fake.session));
    const stats = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(stats.promise);
    let starting!: Promise<void>;
    act(() => {
      starting = hook.result.current.start(ROUTE);
    });
    expect(fake.session.prepareRunAudio).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.exit());
    await act(async () => {
      stats.resolve([]);
      await starting;
    });
    expect(hook.result.current.state).toBeNull();
    expect(fake.session.enterRun).not.toHaveBeenCalled();

    // An auto-stopped sentence still shows its score before collection, and Next waits for it.
    const h = await setup("route");
    for (let i = 0; i < 4; i += 1) {
      await attempt(h, scored(90));
      act(() => h.run().finish());
    }
    const collection = deferred<never[]>();
    vi.mocked(addWordsFromSession).mockReturnValueOnce(collection.promise);
    vi.mocked(scoreRecording).mockResolvedValueOnce(scored(65, [word("path", 50)]));
    await act(async () => {
      await h.run().record();
    });
    expect(h.session.startRunCapture.mock.lastCall?.[0]).toMatchObject({ kind: "sentence", autoStop: true });
    act(() => h.fire("silence"));
    await flush();
    expect(current(h).attempts[0].sync).toBe("pending");
    const captures = h.session.startRunCapture.mock.calls.length;
    act(() => h.run().recordNext());
    await flush();
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(captures);
    collection.resolve([]);
    await flush();
    expect(current(h).attempts[0].sync).toBe("done");
  });

  it("feedback_ids_and_manual_stop_fallback_last_the_run", async () => {
    const h = await setup("route");
    const ids = h.run().consumedFeedbackIds;
    act(() => h.run().markFeedbackConsumed("attempt-1"));
    h.hook.rerender();
    expect(h.run().consumedFeedbackIds).toBe(ids);
    expect(h.run().consumedFeedbackIds.has("attempt-1")).toBe(true);

    act(() => h.run().useManualStopNextTake());
    expect(h.run().preferences.autoStop).toBe(false);
    await act(async () => {
      await h.run().record();
    });
    expect(h.session.startRunCapture.mock.lastCall?.[0]).toMatchObject({ autoStop: false });
    expect(h.run().state?.budgetUsed).toBe(0);
    act(() => h.run().stop());
    await flush();

    await act(async () => {
      await h.run().playAgain();
    });
    expect(h.run().consumedFeedbackIds).not.toBe(ids);
    expect(h.run().consumedFeedbackIds.size).toBe(0);
  });

  it("take_cancelled_during_permission_settles_its_lock_once", async () => {
    const h = await setup("challenge");
    const permission = deferred<boolean>();
    h.session.startRunCapture.mockImplementationOnce(() => permission.promise);
    h.session.cancelRunCapture.mockImplementationOnce(() => undefined);
    let recording!: Promise<void>;
    act(() => {
      recording = h.run().record();
    });
    act(() => h.run().cancelTake());
    expect(h.run().state).toMatchObject({ phase: "ready", activeAttemptId: null, budgetUsed: 0 });
    // The session reports the obsolete capture as never started, with no blob to follow.
    await act(async () => {
      permission.resolve(false);
      await recording;
    });
    expect(h.run().state).toMatchObject({ phase: "ready", budgetUsed: 0 });
    await attempt(h, scored(90));
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(2);
    expect(scoreRecording).toHaveBeenCalledTimes(1);
  });

  it("stale_start_failure_never_reports_into_a_newer_run", async () => {
    const h = await setup("route");
    const old = deferred<boolean>();
    h.session.startRunCapture.mockImplementationOnce(() => old.promise);
    let recording!: Promise<void>;
    act(() => {
      recording = h.run().record();
    });
    act(() => h.run().exit());
    await act(async () => {
      await h.run().start(CHALLENGE);
    });
    await act(async () => {
      old.reject(new Error("Old permission denied"));
      await recording;
    });
    expect(h.session.setError).not.toHaveBeenCalled();
    expect(h.run().state?.mode).toBe("challenge");

    // The take still being captured reports its own failure.
    h.session.startRunCapture.mockRejectedValueOnce(new Error("Microphone blocked"));
    await act(async () => {
      await h.run().record();
    });
    expect(h.session.setError).toHaveBeenCalledWith("Microphone blocked");
    expect(h.run().state).toMatchObject({ phase: "ready", activeAttemptId: null, budgetUsed: 0 });
  });

  it("terminal_pause_only_silences_audio", async () => {
    // Quit from a paused run ends on an unpaused summary.
    let h = await setup("challenge");
    await attempt(h, scored(90));
    act(() => h.run().pause());
    expect(h.run().state?.paused).toBe(true);
    act(() => h.run().quit());
    expect(h.run().state).toMatchObject({ phase: "summary", paused: false });

    // Pausing a finished run's summary or review changes nothing but stops the voice and cues.
    h = await setup("challenge");
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(95));
      act(() => h.run().finish());
    }
    act(() => h.run().markFeedbackConsumed("summary:run"));
    const summary = h.run().state;
    const receipt = h.run().receipt;
    const consumed = h.run().consumedFeedbackIds;
    expect(summary?.phase).toBe("summary");
    vi.mocked(cancelCues).mockClear();
    h.session.stopCurrentSpeech.mockClear();
    act(() => h.run().pause());
    expect(h.run().state).toBe(summary);
    expect(cancelCues).toHaveBeenCalledTimes(1);
    expect(h.session.stopCurrentSpeech).toHaveBeenCalledTimes(1);

    act(() => h.run().openReview());
    const review = h.run().state;
    act(() => h.run().pause());
    expect(h.run().state).toBe(review);
    expect(review?.paused).toBe(false);
    expect(h.run().receipt).toBe(receipt);
    expect(h.run().consumedFeedbackIds).toBe(consumed);
    expect(consumed.has("summary:run")).toBe(true);
    expect(review?.items.every((item) => item.attempts.length === 1)).toBe(true);
    expect(h.session.cancelRunCapture).not.toHaveBeenCalled();
  });

  it("starting_tracks_the_accepted_start_until_its_deck_resolves_or_cannot_be_built", async () => {
    const fake = fakeSession();
    const hook = renderHook(() => usePracticeRun(fake.session));
    const run = () => hook.result.current;
    expect(run().starting).toBe(false);

    // Start: true at once, false when the deck lands.
    const first = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(first.promise);
    let starting!: Promise<void>;
    act(() => {
      starting = run().start(ROUTE);
    });
    expect(run().starting).toBe(true);
    expect(run().state).toBeNull();
    await act(async () => {
      first.resolve([]);
      await starting;
    });
    expect(run().starting).toBe(false);
    expect(run().state?.mode).toBe("route");

    // A superseded start never clears the newer start's flag.
    const older = deferred<never[]>();
    const newer = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let olderStart!: Promise<void>;
    let newerStart!: Promise<void>;
    act(() => {
      olderStart = run().playAgain();
    });
    act(() => {
      newerStart = run().start(CHALLENGE);
    });
    await act(async () => {
      older.resolve([]);
      await olderStart;
    });
    expect(run().starting).toBe(true);
    await act(async () => {
      newer.resolve([]);
      await newerStart;
    });
    expect(run().starting).toBe(false);
    expect(run().state?.mode).toBe("challenge");
    expect(fake.session.enterRun).toHaveBeenCalledTimes(2);

    // Exit clears it at once; the abandoned deck never takes over.
    const abandoned = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(abandoned.promise);
    act(() => {
      starting = run().start(ROUTE);
    });
    act(() => run().exit());
    expect(run().starting).toBe(false);
    await act(async () => {
      abandoned.resolve([]);
      await starting;
    });
    expect(run().starting).toBe(false);
    expect(run().state).toBeNull();

    // An unrecoverable deck build failure clears it and rejects start. (A failed stats or word
    // fetch is not one: the run falls back to the starter deck.)
    vi.mocked(buildRunDeck).mockImplementationOnce(() => {
      throw new Error("No deck");
    });
    await act(async () => {
      await expect(run().start(ROUTE)).rejects.toThrow("No deck");
    });
    expect(run().starting).toBe(false);
    expect(run().state).toBeNull();
  });

  it("heart_cue_plays_in_the_foreground_but_not_for_a_result_settled_while_paused", async () => {
    // Lose the first heart in the foreground: the heart cue plays.
    const h = await setup("challenge");
    await attempt(h, scored(40));
    act(() => h.run().playReference());
    act(() => h.loads[0](true));
    await attempt(h, scored(40));
    expect(h.run().state?.hearts).toBe(1);
    expect(playCue).toHaveBeenCalledWith("heart", expect.any(String));
    act(() => h.run().finish());

    // The final rescue's result settles while paused and ends the run: summary, unpaused, silent.
    await attempt(h, scored(40));
    act(() => h.run().playReference());
    act(() => h.loads[1](true));
    const pending = deferred<ScoreResponse>();
    vi.mocked(scoreRecording).mockReturnValueOnce(pending.promise);
    await act(async () => {
      await h.run().record();
    });
    act(() => h.run().stop());
    act(() => h.run().pause());
    vi.mocked(playCue).mockClear();
    pending.resolve(scored(40));
    await flush();
    expect(h.run().state).toMatchObject({ phase: "summary", endReason: "hearts-exhausted", paused: false });
    expect(vi.mocked(playCue).mock.calls.filter(([cue]) => cue !== null)).toEqual([]);
  });

  it("failed_stats_and_word_fetches_still_start_a_starter_route", async () => {
    vi.mocked(fetchPhonemeStats).mockRejectedValue(new Error("offline"));
    vi.mocked(listWords).mockRejectedValue(new Error("offline"));
    const fake = fakeSession();
    const hook = renderHook(() => usePracticeRun(fake.session));
    await act(async () => {
      await hook.result.current.start(ROUTE);
    });
    expect(hook.result.current.starting).toBe(false);
    expect(hook.result.current.state?.mode).toBe("route");
    expect(hook.result.current.state?.items).toHaveLength(6);
    expect(hook.result.current.state?.items.every((item) => item.prompt.source === "starter")).toBe(true);
    expect(fake.session.enterRun).toHaveBeenCalledTimes(1);
    expect(fake.session.setError).not.toHaveBeenCalled();
  });

  it("owner_unmount_drops_pending_start_scores_collection_and_urls", async () => {
    // Unmounted during a deferred Start, while a newer owner starts: the old deck never lands.
    const oldFake = fakeSession();
    const oldOwner = renderHook(() => usePracticeRun(oldFake.session));
    const stats = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(stats.promise);
    let oldStart!: Promise<void>;
    act(() => {
      oldStart = oldOwner.result.current.start(ROUTE);
    });
    oldOwner.unmount();
    const newer = await setup("challenge");
    vi.mocked(resetCueEvents).mockClear();
    await act(async () => {
      stats.resolve([]);
      await oldStart;
    });
    expect(oldFake.session.enterRun).not.toHaveBeenCalled();
    expect(resetCueEvents).not.toHaveBeenCalled();
    expect(newer.run().state?.mode).toBe("challenge");

    // Unmounted with a scored take kept for review and a sentence score in flight: the review
    // URL is released, and the late score plays no cue and collects no words.
    const h = await setup("route");
    for (let i = 0; i < 4; i += 1) {
      await attempt(h, scored(95));
      act(() => h.run().finish());
    }
    const pending = deferred<ScoreResponse>();
    vi.mocked(scoreRecording).mockReturnValueOnce(pending.promise);
    await act(async () => {
      await h.run().record();
    });
    act(() => h.run().stop());
    const urls = Object.values(h.run().attemptAudioUrls);
    expect(urls).toHaveLength(5);
    vi.mocked(playCue).mockClear();
    h.hook.unmount();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining(urls));
    await act(async () => {
      pending.resolve(scored(95, [word("path", 50)]));
    });
    await flush();
    expect(playCue).not.toHaveBeenCalled();
    expect(addWordsFromSession).not.toHaveBeenCalled();
    expect(h.session.setError).not.toHaveBeenCalled();
  });

  it("owner_unmount_cancels_its_capture_and_strict_mode_replay_stays_usable", async () => {
    const h = await setup("route");
    h.session.cancelRunCapture.mockImplementationOnce(() => undefined);
    await act(async () => {
      await h.run().record();
    });
    h.hook.unmount();
    expect(h.session.cancelRunCapture).toHaveBeenCalledWith("exit");
    // The take delivered after unmount is dropped before anything is sent.
    act(() => h.fire("manual"));
    expect(scoreRecording).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    // StrictMode mounts, cleans up and re-runs effects: the controller still works.
    const fake = fakeSession();
    const strict = renderHook(() => usePracticeRun(fake.session), { wrapper: StrictMode });
    await act(async () => {
      await strict.result.current.start(ROUTE);
    });
    expect(strict.result.current.state?.mode).toBe("route");
    vi.mocked(scoreRecording).mockResolvedValueOnce(scored(95));
    await act(async () => {
      await strict.result.current.record();
    });
    act(() => strict.result.current.stop());
    await flush();
    expect(scoreRecording).toHaveBeenCalledTimes(1);
    expect(strict.result.current.state?.items[0].verdict).toBe("practiced");
    expect(playCue).toHaveBeenCalledWith("perfect", expect.any(String));
  });

  it("start_freezes_its_config_and_play_again_keeps_it", async () => {
    const target85 = { ...configForChoice({ selection: "target85", routeLength: 12 }) };
    const h = await setup(target85);
    expect(h.run().state?.config).toEqual({ source: "starter", mode: "challenge", length: 6, target: 85, maxExtra: 4 });
    expect(h.run().state?.mode).toBe("challenge");
    (target85 as { maxExtra: number }).maxExtra = 2;
    expect(h.run().state?.config.maxExtra).toBe(4);

    // An 80 is below this run's target, so it asks for a rescue.
    await attempt(h, scored(80));
    expect(current(h).verdict).toBe("relisten");
    act(() => h.run().quit());
    const before = h.run().state?.runId;
    await act(async () => {
      await h.run().playAgain();
    });
    expect(h.run().state?.runId).not.toBe(before);
    expect(h.run().state?.config).toEqual({ source: "starter", mode: "challenge", length: 6, target: 85, maxExtra: 4 });
  });

  it("invalid_start_throws_before_teardown_and_preserves_results", async () => {
    const h = await setup("route");
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(90));
      act(() => h.run().finish());
    }
    const finished = h.run().state;
    const receipt = h.run().receipt;
    const urls = h.run().attemptAudioUrls;
    expect(finished?.phase).toBe("summary");
    expect(receipt?.outcome).toBe("first-record");
    expect(Object.keys(urls)).toHaveLength(6);
    vi.mocked(resetCueEvents).mockClear();
    vi.mocked(fetchPhonemeStats).mockClear();
    h.session.prepareRunAudio.mockClear();

    const unchanged = () => {
      expect(h.run().state).toBe(finished);
      expect(h.run().receipt).toBe(receipt);
      expect(h.run().attemptAudioUrls).toBe(urls);
      expect(h.run().starting).toBe(false);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      expect(h.session.enterRun).toHaveBeenCalledTimes(1);
      expect(h.session.cancelRunCapture).not.toHaveBeenCalled();
      expect(resetCueEvents).not.toHaveBeenCalled();
    };

    // An invalid configuration is refused before audio, data, or the current run is touched.
    const challenge12 = { source: "starter", mode: "challenge", length: 12, target: 60, maxExtra: 4 } as unknown as RunConfig;
    await act(async () => {
      await expect(h.run().start(challenge12)).rejects.toThrow();
    });
    expect(h.session.prepareRunAudio).not.toHaveBeenCalled();
    expect(fetchPhonemeStats).not.toHaveBeenCalled();
    unchanged();

    // A valid Route 12 against a two-per-stage pack builds no deck it can accept: it throws after
    // loading and still leaves the finished run, its receipt, and its replays intact.
    pack.small = true;
    await act(async () => {
      await expect(h.run().start(configForChoice({ selection: "route", routeLength: 12 }))).rejects.toThrow();
    });
    pack.small = false;
    expect(buildRunDeck).toHaveBeenCalled();
    unchanged();

    // Retrying a valid six-item start then replaces the run normally.
    await act(async () => {
      await h.run().start(CHALLENGE);
    });
    expect(h.run().state?.mode).toBe("challenge");
    expect(h.run().receipt).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(6);
  });

  async function finishRoute(h: Harness, accuracy = 95, words?: WordResult[]) {
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(accuracy, words));
      act(() => h.run().finish());
    }
    expect(h.run().state?.phase).toBe("summary");
  }

  function focusOf(h: Harness) {
    return h.run().state?.items.find((item) => item.prompt.stage === "focus")?.prompt.targetPhoneme;
  }

  it("start_snapshots_config_before_await", async () => {
    const fake = fakeSession();
    const hook = renderHook(() => usePracticeRun(fake.session));
    const stats = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(stats.promise);
    const config = { ...configForChoice({ selection: "target85", routeLength: 6 }) };
    let starting!: Promise<void>;
    act(() => {
      starting = hook.result.current.start(config);
    });
    // Audio is unlocked in the gesture, before the data arrives.
    expect(fake.session.prepareRunAudio).toHaveBeenCalledTimes(1);
    Object.assign(config, { target: 60, maxExtra: 2 });
    await act(async () => {
      stats.resolve([]);
      await starting;
    });
    const run = hook.result.current;
    expect(run.state?.config).toEqual({ source: "starter", mode: "challenge", length: 6, target: 85, maxExtra: 4 });
    expect(run.config).toBe(run.state?.config);
    expect(Object.isFrozen(run.config)).toBe(true);
    expect(run.maxScores).toBe(10);
    expect(run.practisedCount).toBe(0);
    expect(run.nextSoundPhoneme).toBeNull();
  });

  it("insufficient_pack_throws_before_teardown", async () => {
    const h = await setup("route");
    await finishRoute(h);
    const finished = h.run().state;
    const receipt = h.run().receipt;
    const urls = h.run().attemptAudioUrls;
    pack.small = true;
    await act(async () => {
      await expect(h.run().start(configForChoice({ selection: "route", routeLength: 12 }))).rejects.toThrow("cannot fill");
    });
    pack.small = false;
    expect(h.run().state).toBe(finished);
    expect(h.run().receipt).toBe(receipt);
    expect(h.run().attemptAudioUrls).toBe(urls);
    expect(h.run().starting).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(h.session.enterRun).toHaveBeenCalledTimes(1);

    // The approved sixty-item pack fills it.
    await act(async () => {
      await h.run().start(configForChoice({ selection: "route", routeLength: 12 }));
    });
    expect(h.run().state?.items).toHaveLength(12);
    expect(h.run().maxScores).toBe(16);
  });

  it("next_sound_cycles_with_same_config", async () => {
    const h = await setup("route");
    expect(focusOf(h)).toBe("θ");
    expect(h.run().nextSoundPhoneme).toBeNull();
    // Not finished yet: nothing starts.
    await act(async () => {
      await h.run().nextSound();
    });
    expect(h.session.enterRun).toHaveBeenCalledTimes(1);

    await finishRoute(h, 90, [word("bright", 50)]);
    expect(h.run().practisedCount).toBe(6);
    expect(h.run().nextSoundPhoneme).toBe("ð");
    vi.mocked(fetchPhonemeStats).mockClear();
    await act(async () => {
      await h.run().nextSound();
    });
    expect(focusOf(h)).toBe("ð");
    expect(h.run().config).toEqual(ROUTE);
    // The destination is the cycle's, not the stats': no stats are fetched for it.
    expect(fetchPhonemeStats).not.toHaveBeenCalled();
    // Eligible weak words from the finished run still lead the warm-ups.
    expect(h.run().state?.items[0].prompt).toMatchObject({ text: "bright", source: "previous-run" });

    act(() => h.run().quit());
    expect(h.run().nextSoundPhoneme).toBe("ɹ");
    await act(async () => {
      await h.run().nextSound();
    });
    expect(focusOf(h)).toBe("ɹ");

    // Challenge never offers it.
    const challenge = await setup("challenge");
    act(() => challenge.run().quit());
    expect(challenge.run().nextSoundPhoneme).toBeNull();
    await act(async () => {
      await challenge.run().nextSound();
    });
    expect(challenge.session.prepareRunAudio).toHaveBeenCalledTimes(1);
    expect(challenge.session.enterRun).toHaveBeenCalledTimes(1);
  });

  it("play_again_keeps_stats_policy_not_rotation", async () => {
    const h = await setup("route");
    act(() => h.run().quit());
    vi.mocked(fetchPhonemeStats).mockResolvedValueOnce([{ phoneme: "v", average_accuracy: 40, attempts: 5 } as never]);
    await act(async () => {
      await h.run().playAgain();
    });
    expect(focusOf(h)).toBe("v");
    expect(h.run().config).toEqual(ROUTE);

    act(() => h.run().quit());
    await act(async () => {
      await h.run().playAgain();
    });
    // No stats: the default sound again, not the next one in the cycle.
    expect(focusOf(h)).toBe("θ");
  });

  it("hear_first_failure_does_not_block_record", async () => {
    const h = await setup("route");
    act(() => h.run().hearFirst());
    expect(h.session.playCorrect).toHaveBeenCalledTimes(1);
    expect(h.session.playCorrect).toHaveBeenCalledWith(current(h).prompt.text, expect.objectContaining({ onLoadResult: expect.any(Function) }));
    act(() => h.loads[0](false));
    expect(current(h).referenceLoad).toBe("failed");
    expect(h.run().state?.phase).toBe("ready");
    await act(async () => {
      await h.run().record();
    });
    expect(h.session.startRunCapture).toHaveBeenCalledTimes(1);
    expect(h.run().state?.phase).toBe("recording");
    // Never while recording or paused, and never implicitly.
    act(() => h.run().hearFirst());
    expect(h.session.playCorrect).toHaveBeenCalledTimes(1);
    act(() => h.run().cancelTake());
    act(() => h.run().pause());
    act(() => h.run().hearFirst());
    expect(h.session.playCorrect).toHaveBeenCalledTimes(1);

    // Challenge has no listen before the first reading.
    const challenge = await setup("challenge");
    act(() => challenge.run().hearFirst());
    expect(challenge.session.playCorrect).not.toHaveBeenCalled();
  });

  it("preview_cancel_on_advance_skip_record_next_finish_pause_exit", async () => {
    const h = await setup("route");
    const stop = h.session.stopCurrentSpeech;

    // A refused move (nothing to finish while Ready) leaves the reference playing.
    act(() => h.run().hearFirst());
    stop.mockClear();
    act(() => h.run().finish());
    expect(stop).not.toHaveBeenCalled();

    act(() => h.run().skip());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(h.run().state?.index).toBe(1);

    await attempt(h, scored(90));
    stop.mockClear();
    act(() => h.run().finish());
    expect(stop).toHaveBeenCalledTimes(1);

    await attempt(h, scored(90));
    stop.mockClear();
    await act(async () => {
      h.run().recordNext();
      await Promise.resolve();
    });
    // The old item's audio stops before the new item's capture begins.
    expect(stop).toHaveBeenCalled();
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(h.session.startRunCapture.mock.invocationCallOrder.at(-1)!);
    act(() => h.run().cancelTake());

    stop.mockClear();
    act(() => h.run().pause());
    expect(stop).toHaveBeenCalled();
    stop.mockClear();
    act(() => h.run().exit());
    expect(stop).toHaveBeenCalled();
  });

  it("hear_next_first_advances_once_then_previews_ready_item", async () => {
    const h = await setup("route");
    await attempt(h, scored(90));
    expect(h.run().state?.phase).toBe("feedback");
    h.session.stopCurrentSpeech.mockClear();
    act(() => h.run().hearNextFirst());
    expect(h.run().state).toMatchObject({ index: 1, phase: "ready" });
    expect(h.session.playCorrect).toHaveBeenCalledTimes(1);
    expect(h.session.playCorrect).toHaveBeenCalledWith(current(h).prompt.text, expect.anything());
    // The old item stopped before the new one started to load.
    expect(h.session.stopCurrentSpeech.mock.invocationCallOrder[0]).toBeLessThan(
      h.session.playCorrect.mock.invocationCallOrder[0]
    );
    expect(current(h).referenceLoad).toBe("pending");

    // Already Ready: the move is refused, so nothing advances and nothing plays.
    act(() => h.run().hearNextFirst());
    expect(h.run().state?.index).toBe(1);
    expect(h.session.playCorrect).toHaveBeenCalledTimes(1);

    // The last item offers Finish instead.
    for (let i = 1; i < 5; i += 1) {
      await attempt(h, scored(90));
      act(() => h.run().finish());
    }
    await attempt(h, scored(90));
    expect(h.run().state?.index).toBe(5);
    act(() => h.run().hearNextFirst());
    expect(h.run().state).toMatchObject({ index: 5, phase: "feedback", endReason: null });
    expect(h.session.playCorrect).toHaveBeenCalledTimes(1);

    // Challenge keeps its own controls.
    const challenge = await setup("challenge");
    await attempt(challenge, scored(90));
    act(() => challenge.run().hearNextFirst());
    expect(challenge.run().state?.index).toBe(0);
    expect(challenge.session.playCorrect).not.toHaveBeenCalled();
  });

  it("next_sound_failure_keeps_old_results_and_receipt", async () => {
    const h = await setup("route");
    await finishRoute(h);
    const finished = h.run().state;
    const receipt = h.run().receipt;
    const urls = h.run().attemptAudioUrls;
    expect(receipt?.outcome).toBe("first-record");
    vi.mocked(resetCueEvents).mockClear();

    vi.mocked(buildRunDeck).mockImplementationOnce(() => {
      throw new Error("No deck");
    });
    await act(async () => {
      await expect(h.run().nextSound()).rejects.toThrow("No deck");
    });
    expect(h.run().state).toBe(finished);
    expect(h.run().receipt).toBe(receipt);
    expect(h.run().attemptAudioUrls).toBe(urls);
    expect(h.run().starting).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(resetCueEvents).not.toHaveBeenCalled();
    expect(h.run().nextSoundPhoneme).toBe("ð");

    // Retrying goes to the same sound, not one further.
    await act(async () => {
      await h.run().nextSound();
    });
    expect(focusOf(h)).toBe("ð");
    expect(h.run().receipt).toBeNull();
    expect(resetCueEvents).toHaveBeenCalledTimes(1);
  });

  it("restart_exit_or_owner_unmount_drops_late_success_error_finally", async () => {
    // Exit while Next sound loads: the late result never takes over, and starting stays cleared.
    const h = await setup("route");
    await finishRoute(h);
    const words = deferred<never[]>();
    vi.mocked(listWords).mockReturnValueOnce(words.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = h.run().nextSound();
    });
    expect(h.run().starting).toBe(true);
    act(() => h.run().exit());
    expect(h.run().starting).toBe(false);
    await act(async () => {
      words.reject(new Error("offline"));
      await expect(pending).resolves.toBeUndefined();
    });
    expect(h.run().state).toBeNull();
    expect(h.run().starting).toBe(false);
    expect(h.session.enterRun).toHaveBeenCalledTimes(1);
    expect(h.session.setError).not.toHaveBeenCalled();

    // The owner unmounts while Play again loads: a late success changes nothing.
    const owner = await setup("route");
    await finishRoute(owner);
    const stats = deferred<never[]>();
    vi.mocked(fetchPhonemeStats).mockReturnValueOnce(stats.promise);
    let again!: Promise<void>;
    act(() => {
      again = owner.run().playAgain();
    });
    owner.hook.unmount();
    await act(async () => {
      stats.resolve([]);
      await again;
    });
    expect(owner.session.enterRun).toHaveBeenCalledTimes(1);
    expect(owner.session.setError).not.toHaveBeenCalled();
    expect(buildRunDeck).toHaveBeenCalledTimes(2);
  });

  it("pb_receipt_stays_frozen_across_tabs_expiry_and_surfaces", async () => {
    const target85 = configForChoice({ selection: "target85", routeLength: 6 });
    const h = await setup(target85);
    const focus = current(h).prompt.targetPhoneme;
    for (let i = 0; i < 6; i += 1) {
      await attempt(h, scored(95));
      act(() => h.run().finish());
    }
    expect(h.run().state?.challengeOutcome).toBe("cleared");
    const receipt = h.run().receipt;
    expect(receipt).toMatchObject({ outcome: "first-record", previousPoints: null });
    // Written under Target 85's own key; the legacy Target 60 key is untouched.
    const stored = JSON.parse(window.localStorage.getItem(RUN_BEST_KEY) as string);
    expect(Object.keys(stored)).toEqual([`challenge|${focus}|1|85`]);

    // Another tab stores a better Target 85 run, time passes beyond public expiry, Review opens,
    // and a failed Play again comes back: the receipt is the one decided at the end of this run.
    const key = `challenge|${focus}|1|85`;
    window.localStorage.setItem(RUN_BEST_KEY, JSON.stringify({ [key]: { runId: "other", points: 990, rating: "S", updatedAt: Date.now(), expiresAt: null } }));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 8 * 24 * 60 * 60 * 1000);
    h.hook.rerender();
    act(() => h.run().openReview());
    vi.mocked(buildRunDeck).mockImplementationOnce(() => {
      throw new Error("No deck");
    });
    await act(async () => {
      await expect(h.run().playAgain()).rejects.toThrow("No deck");
    });
    h.hook.rerender();
    expect(h.run().receipt).toBe(receipt);
    expect(readBest({ config: target85, focus, rulesVersion: RUN_RULES_VERSION })?.runId).toBe("other");
  });

  it("terminal_transition_refreshes_vocabulary_once", async () => {
    const h = await setup("route");
    h.session.refreshVocabulary.mockRejectedValue(new Error("offline"));
    for (let i = 0; i < 5; i += 1) {
      await attempt(h, scored(90));
      act(() => h.run().finish());
    }
    expect(h.session.refreshVocabulary).not.toHaveBeenCalled();
    await attempt(h, scored(90));
    act(() => h.run().finish());
    // Summary appears at once; the refresh runs alongside and its failure is caught.
    expect(h.run().state?.phase).toBe("summary");
    expect(h.session.refreshVocabulary).toHaveBeenCalledTimes(1);
    act(() => h.run().pause());
    h.hook.rerender();
    await flush();
    expect(h.session.refreshVocabulary).toHaveBeenCalledTimes(1);
    // Review keeps its own refresh.
    act(() => h.run().openReview());
    expect(h.session.refreshVocabulary).toHaveBeenCalledTimes(2);

    // A quit ends the run too.
    const quitter = await setup("challenge");
    act(() => quitter.run().quit());
    expect(quitter.session.refreshVocabulary).toHaveBeenCalledTimes(1);
  });
});
