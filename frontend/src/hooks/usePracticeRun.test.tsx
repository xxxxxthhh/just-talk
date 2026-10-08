import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addWordsFromSession, ApiError, fetchPhonemeStats, listWords, scoreRecording } from "../api";
import { readBest, RUN_BEST_KEY } from "../game/personalBest";
import { setRunPreference } from "../game/preferences";
import { RUN_RULES_VERSION } from "../game/scoring";
import { cancelCues, playCue, resetCueEvents } from "../game/sfx";
import type { CaptureStopReason, CaptureSummary, RunCaptureOptions, RunMode, ScoreResponse, WordResult } from "../types";
import { usePracticeRun, type RunSession } from "./usePracticeRun";

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

async function setup(mode: RunMode) {
  const fake = fakeSession();
  const hook = renderHook(() => usePracticeRun(fake.session));
  await act(async () => {
    await hook.result.current.start(mode);
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
    expect(h.session.refreshVocabulary).not.toHaveBeenCalled();
    act(() => h.run().openReview());
    act(() => h.run().openReview());
    expect(h.run().state?.phase).toBe("review");
    expect(h.session.refreshVocabulary).toHaveBeenCalledTimes(1);
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
      starting = hook.result.current.start("route");
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
      await h.run().start("challenge");
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
    expect(readBest({ mode: "route", focus: "v", rulesVersion: RUN_RULES_VERSION })?.points).toBe(955);
    expect(readBest({ mode: "route", focus: "θ", rulesVersion: RUN_RULES_VERSION })).toBeNull();
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
      starting = hook.result.current.start("route");
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
});
