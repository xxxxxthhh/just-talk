import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, test, vi } from "vitest";

import { useRecorder } from "./useRecorder";

function installMediaDevices() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }]
      })
    }
  });
}

function stubUrl() {
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:recording"),
    revokeObjectURL: vi.fn()
  });
}

type MediaRecorderMockInstance = {
  state: string;
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function makeMediaRecorderMock(
  isSupported: (type: string) => boolean,
  negotiatedFallbackMimeType = ""
) {
  return vi.fn(function MediaRecorderMock(
    this: MediaRecorderMockInstance,
    _stream: unknown,
    options?: { mimeType?: string }
  ) {
    this.state = "inactive";
    this.mimeType = options?.mimeType ?? negotiatedFallbackMimeType;
    this.ondataavailable = null;
    this.onstop = null;
    this.start = () => {
      this.state = "recording";
    };
    this.stop = () => {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"]) });
      this.onstop?.();
    };
  }) as unknown as typeof MediaRecorder & { isTypeSupported: (type: string) => boolean };
}

async function recordOnce() {
  let controls!: ReturnType<typeof useRecorder>;
  function Harness() {
    controls = useRecorder({ maxMs: 30_000, onUnsupported: vi.fn(), onRecordingReady: vi.fn() });
    return null;
  }
  render(<Harness />);

  await act(async () => {
    await controls.startRecording();
  });
  act(() => {
    controls.stopRecording();
  });

  return controls;
}

function makeDeferredStopRecorderMock() {
  const instances: (MediaRecorderMockInstance & { fireStop: () => void })[] = [];
  const MediaRecorderMock = vi.fn(function MediaRecorderMock(this: MediaRecorderMockInstance & { fireStop: () => void }) {
    this.state = "inactive";
    this.mimeType = "audio/mp4";
    this.ondataavailable = null;
    this.onstop = null;
    this.start = () => {
      this.state = "recording";
    };
    // Real browsers fire onstop asynchronously after stop().
    this.stop = () => {
      this.state = "inactive";
    };
    this.fireStop = () => {
      this.ondataavailable?.({ data: new Blob(["audio"]) });
      this.onstop?.();
    };
    instances.push(this);
  }) as unknown as typeof MediaRecorder & { isTypeSupported: (type: string) => boolean };
  MediaRecorderMock.isTypeSupported = vi.fn((type: string) => type === "audio/mp4");
  return { MediaRecorderMock, instances };
}

describe("useRecorder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("prefers opus-in-webm when the browser supports it (Chrome/Firefox path)", async () => {
    installMediaDevices();
    stubUrl();
    const MediaRecorderMock = makeMediaRecorderMock((type) => type === "audio/webm;codecs=opus");
    MediaRecorderMock.isTypeSupported = vi.fn((type: string) => type === "audio/webm;codecs=opus");
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);

    const controls = await recordOnce();

    expect(controls.audioBlob?.type).toBe("audio/webm;codecs=opus");
  });

  test("falls back to mp4 when opus-in-webm is unsupported (Safari path)", async () => {
    installMediaDevices();
    stubUrl();
    const MediaRecorderMock = makeMediaRecorderMock((type) => type === "audio/mp4");
    MediaRecorderMock.isTypeSupported = vi.fn((type: string) => type === "audio/mp4");
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);

    const controls = await recordOnce();

    expect(controls.audioBlob?.type).toBe("audio/mp4");
  });

  test("labels the blob with the browser's own negotiated mimeType when neither preferred type is supported", async () => {
    installMediaDevices();
    stubUrl();
    // Simulates a browser where MediaRecorder is constructed without an
    // explicit mimeType and negotiates its own default codec.
    const MediaRecorderMock = makeMediaRecorderMock(() => false, "audio/ogg");
    MediaRecorderMock.isTypeSupported = vi.fn(() => false);
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);

    const controls = await recordOnce();

    expect(controls.audioBlob?.type).toBe("audio/ogg");
  });

  it("ready_passes_current_blob_and_preserves_browser_mime", async () => {
    installMediaDevices();
    stubUrl();
    const MediaRecorderMock = makeMediaRecorderMock((type) => type === "audio/mp4");
    MediaRecorderMock.isTypeSupported = vi.fn((type: string) => type === "audio/mp4");
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);
    const onRecordingReady = vi.fn();
    let controls!: ReturnType<typeof useRecorder>;
    function Harness() {
      controls = useRecorder({ maxMs: 30_000, onUnsupported: vi.fn(), onRecordingReady });
      return null;
    }
    render(<Harness />);

    await act(async () => {
      await controls.startRecording();
    });
    act(() => {
      controls.stopRecording();
    });

    expect(onRecordingReady).toHaveBeenCalledTimes(1);
    const blob = onRecordingReady.mock.calls[0][0] as Blob;
    expect(blob).toBe(controls.audioBlob);
    expect(blob.type).toBe("audio/mp4");
  });

  it("late_onstop_reaches_its_own_capture_callback", async () => {
    installMediaDevices();
    stubUrl();
    const { MediaRecorderMock, instances } = makeDeferredStopRecorderMock();
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);
    const onRecordingReady = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    let controls!: ReturnType<typeof useRecorder>;
    function Harness() {
      controls = useRecorder({ maxMs: 30_000, onUnsupported: vi.fn(), onRecordingReady });
      return null;
    }
    render(<Harness />);

    await act(async () => {
      await controls.startRecording(first);
    });
    act(() => {
      controls.stopRecording();
    });
    // A newer capture installs its own callback before the old onstop arrives.
    await act(async () => {
      await controls.startRecording(second);
    });
    act(() => {
      instances[0].fireStop();
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(onRecordingReady).not.toHaveBeenCalled();

    act(() => {
      controls.stopRecording();
      instances[1].fireStop();
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("analyser_attaches_before_capture_clock_starts", async () => {
    installMediaDevices();
    stubUrl();
    const { MediaRecorderMock, instances } = makeDeferredStopRecorderMock();
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);
    const order: string[] = [];
    let controls!: ReturnType<typeof useRecorder>;
    function Harness() {
      controls = useRecorder({ maxMs: 30_000, onUnsupported: vi.fn(), onRecordingReady: vi.fn() });
      return null;
    }
    render(<Harness />);
    const onReady = vi.fn();

    await act(async () => {
      await controls.startRecording(onReady, {
        onStream: () => order.push(`stream:${instances[0].state}`),
        onStart: () => order.push(`start:${instances[0].state}`),
        onStop: (stop) => order.push(`stop:${stop.reason}`)
      });
    });
    expect(order).toEqual(["stream:inactive", "start:recording"]);

    act(() => controls.stopRecording());
    expect(order.at(-1)).toBe("stop:manual");
    act(() => instances[0].fireStop());
    expect(onReady).toHaveBeenCalledWith(expect.any(Blob), false, { reason: "manual", durationMs: expect.any(Number) });

    // A throwing hook never stops the recording.
    await act(async () => {
      await controls.startRecording(vi.fn(), {
        onStream: () => {
          throw new Error("no analyser");
        }
      });
    });
    expect(controls.recorderState).toBe("recording");
  });

  it("stop_latch_keeps_first_reason_duration_and_later_discard", async () => {
    installMediaDevices();
    stubUrl();
    const { MediaRecorderMock, instances } = makeDeferredStopRecorderMock();
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let controls!: ReturnType<typeof useRecorder>;
    function Harness() {
      controls = useRecorder({ maxMs: 30_000, onUnsupported: vi.fn(), onRecordingReady: vi.fn() });
      return null;
    }
    render(<Harness />);

    const kept = vi.fn();
    await act(async () => {
      await controls.startRecording(kept);
    });
    now = 3000;
    act(() => controls.stopRecordingWith("silence"));
    now = 3500;
    act(() => controls.stopRecording());
    now = 4000;
    act(() => instances[0].fireStop());
    expect(kept).toHaveBeenCalledTimes(1);
    const [, discarded, stop] = kept.mock.calls[0];
    expect(discarded).toBe(false);
    expect(stop).toEqual({ reason: "silence", durationMs: 2000 });
    expect(Object.isFrozen(stop)).toBe(true);

    // Cancelled after the stop was accepted but before onstop: delivered as a discard.
    const cancelled = vi.fn();
    await act(async () => {
      await controls.startRecording(cancelled);
    });
    act(() => controls.stopRecordingWith("silence"));
    act(() => controls.discardRecording("pause"));
    act(() => instances[1].fireStop());
    expect(cancelled.mock.calls[0].slice(1)).toEqual([true, { reason: "pause", durationMs: 0 }]);
    expect(controls.audioBlob).toBeNull();

    // A stop the browser made on its own was never accepted.
    const lost = vi.fn();
    await act(async () => {
      await controls.startRecording(lost);
    });
    now = 4800;
    act(() => instances[2].fireStop());
    expect(lost.mock.calls[0].slice(1)).toEqual([false, { reason: "cancel", durationMs: 800 }]);
  });

  it("newer_start_supersedes_a_pending_permission", async () => {
    stubUrl();
    const { MediaRecorderMock, instances } = makeDeferredStopRecorderMock();
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);
    const pending: ((stream: unknown) => void)[] = [];
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise((resolve) => pending.push(resolve))) }
    });
    let controls!: ReturnType<typeof useRecorder>;
    function Harness() {
      controls = useRecorder({ maxMs: 30_000, onUnsupported: vi.fn(), onRecordingReady: vi.fn() });
      return null;
    }
    render(<Harness />);

    const older = vi.fn();
    let olderStarted!: Promise<boolean>;
    let newerStarted!: Promise<boolean>;
    act(() => {
      olderStarted = controls.startRecording(older);
      newerStarted = controls.startRecording(vi.fn());
    });
    await act(async () => {
      pending[1]({ getTracks: () => [tracks[1]] });
      expect(await newerStarted).toBe(true);
      pending[0]({ getTracks: () => [tracks[0]] });
      expect(await olderStarted).toBe(false);
    });
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
    expect(controls.recorderState).toBe("recording");
    act(() => controls.stopRecording());
    expect(instances[0].state).toBe("inactive");
    expect(older).not.toHaveBeenCalled();
  });

  it("stale_permission_denial_resolves_false_and_current_denial_throws", async () => {
    stubUrl();
    const { MediaRecorderMock } = makeDeferredStopRecorderMock();
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);
    const pending: { resolve: (stream: unknown) => void; reject: (error: Error) => void }[] = [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject }))) }
    });
    let controls!: ReturnType<typeof useRecorder>;
    function Harness() {
      controls = useRecorder({ maxMs: 30_000, onUnsupported: vi.fn(), onRecordingReady: vi.fn() });
      return null;
    }
    render(<Harness />);

    // Replaced, then cancelled: both late denials belong to nobody.
    let replaced!: Promise<boolean>;
    let cancelled!: Promise<boolean>;
    act(() => {
      replaced = controls.startRecording(vi.fn());
      cancelled = controls.startRecording(vi.fn());
    });
    act(() => controls.discardRecording("exit"));
    await act(async () => {
      pending[0].reject(new Error("NotAllowedError"));
      pending[1].reject(new Error("NotAllowedError"));
      expect(await replaced).toBe(false);
      expect(await cancelled).toBe(false);
    });

    // The current request's denial still reaches its caller.
    let current!: Promise<boolean>;
    act(() => {
      current = controls.startRecording(vi.fn());
    });
    await act(async () => {
      pending[2].reject(new Error("NotAllowedError"));
      await expect(current).rejects.toThrow("NotAllowedError");
    });
  });
});
