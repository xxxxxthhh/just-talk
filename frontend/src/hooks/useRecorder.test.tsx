import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

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
});
