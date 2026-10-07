import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoreResult, WordResult } from "./types";
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

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
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

let permission: { resolve: () => void } | null;
let deferPermission = false;
// Real browsers fire onstop after stop() returns; asyncStop leaves it to fireStop.
let asyncStop = false;
let recorders: (RecorderInstance & { fireStop: () => void })[] = [];

function installRecorder() {
  const getUserMedia = vi.fn(
    () =>
      new Promise((resolve) => {
        const stream = { getTracks: () => [{ stop: vi.fn() }] };
        if (deferPermission) {
          permission = { resolve: () => resolve(stream) };
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
  render(<Harness />);
  await waitFor(() => expect(ref.current.health).not.toBeNull());
  return ref;
}

function pressEnter() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  });
}

describe("usePracticeSession run wiring", () => {
  beforeEach(() => {
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

  it("cancelled_capture_keeps_old_identity_until_late_onstop", async () => {
    installRecorder();
    const session = await renderSession();
    act(() => session.current.enterRun());

    deferPermission = true;
    const onReady = vi.fn();
    let started!: Promise<boolean>;
    act(() => {
      started = session.current.startRunCapture(onReady);
    });
    // Cancelled while the permission prompt is still open.
    act(() => session.current.cancelRunCapture());
    await act(async () => {
      permission?.resolve();
      expect(await started).toBe(true);
    });

    // The capture was stopped as soon as it opened, and its blob went to its own callback.
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0]).toBeInstanceOf(Blob);
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
      await session.current.startRunCapture(onReady);
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
      await session.current.startRunCapture(vi.fn());
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
      await session.current.startRunCapture(onReady);
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
      await session.current.startRunCapture(onReady);
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
      await session.current.startRunCapture(onReady);
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
});
