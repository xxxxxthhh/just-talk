import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addWordsFromSession, ApiError, fetchPhonemeStats, listWords, scoreRecording } from "../api";
import type { RunMode, ScoreResponse, WordResult } from "../types";
import { usePracticeRun, type RunSession } from "./usePracticeRun";

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

// A stand-in for the shared recorder: one capture at a time, one blob per stop.
function fakeSession() {
  let active: ((blob: Blob) => void) | null = null;
  const loads: ((ok: boolean) => void)[] = [];
  const fire = () => {
    const onReady = active;
    active = null;
    onReady?.(new Blob(["audio"], { type: "audio/mp4" }));
  };
  const session = {
    enterRun: vi.fn(),
    exitRun: vi.fn(),
    startRunCapture: vi.fn(async (onReady: (blob: Blob) => void) => {
      active = onReady;
      return true;
    }),
    cancelRunCapture: vi.fn(fire),
    stopRecording: vi.fn(fire),
    playCorrect: vi.fn(async (_text: string, options?: { onLoadResult?: (ok: boolean) => void }) => {
      if (options?.onLoadResult) loads.push(options.onLoadResult);
    }),
    refreshVocabulary: vi.fn(async () => undefined),
    setError: vi.fn()
  };
  return { session: session as unknown as RunSession & typeof session, loads };
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
    const onReady = h.session.startRunCapture.mock.calls[0][0];
    act(() => {
      h.run().stop();
      h.run().stop();
      // An auto-stop racing the manual stop delivers the same capture again.
      onReady(new Blob(["late"]));
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

  it("pause_discards_capture_but_accepts_matching_inflight_result", async () => {
    const h = await setup("route");
    await act(async () => {
      await h.run().record();
    });
    act(() => h.run().pause());
    expect(h.session.cancelRunCapture).toHaveBeenCalledTimes(1);
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
    expect(h.session.exitRun).toHaveBeenCalledTimes(1);
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
    expect(h.run().state?.phase).toBe("review");
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
});
