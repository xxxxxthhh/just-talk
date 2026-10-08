import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLevelMeter,
  createTelemetryStore,
  IDLE_TELEMETRY,
  prepareRunAudio,
  releaseRunAudio,
  rmsToDbfs,
  runAudioContext,
  useCaptureTelemetry
} from "./runAudio";

let amplitude = 0;

class FakeNode {
  connect = vi.fn((node: unknown) => node);
  disconnect = vi.fn();
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  getFloatTimeDomainData = vi.fn((samples: Float32Array) => samples.fill(amplitude));
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "suspended";
  destination = new FakeNode();
  sources: FakeNode[] = [];
  analysers: FakeAnalyser[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  suspend = vi.fn();
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createMediaStreamSource = vi.fn(() => {
    const source = new FakeNode();
    this.sources.push(source);
    return source;
  });
  createAnalyser = vi.fn(() => {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser;
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

const stream = {} as MediaStream;

beforeEach(() => {
  FakeAudioContext.instances = [];
  amplitude = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  releaseRunAudio();
  vi.unstubAllGlobals();
});

describe("run audio", () => {
  it("prepare_creates_one_context_in_the_gesture_and_release_closes_it", () => {
    const context = prepareRunAudio() as unknown as FakeAudioContext;
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(prepareRunAudio()).toBe(context);
    expect(FakeAudioContext.instances).toHaveLength(1);

    releaseRunAudio();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(runAudioContext()).toBeNull();
    expect(prepareRunAudio()).not.toBe(context);
  });

  it("unavailable_or_throwing_context_returns_null", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(prepareRunAudio()).toBeNull();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function Throwing() {
        throw new Error("NotAllowedError");
      })
    );
    expect(prepareRunAudio()).toBeNull();
    expect(createLevelMeter(stream)).toBeNull();
  });

  it("level_meter_reads_dbfs_without_reaching_the_speakers", () => {
    const context = prepareRunAudio() as unknown as FakeAudioContext;
    const meter = createLevelMeter(stream);
    expect(meter).not.toBeNull();
    const [source] = context.sources;
    const [analyser] = context.analysers;
    expect(analyser.fftSize).toBe(1024);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.connect).not.toHaveBeenCalled();
    expect(context.destination.connect).not.toHaveBeenCalled();

    amplitude = 0.1;
    expect(meter?.read()).toBeCloseTo(-20, 5);
    amplitude = 0;
    expect(meter?.read()).toBe(-Infinity);
    meter?.dispose();
    expect(source.disconnect).toHaveBeenCalled();
    expect(analyser.disconnect).toHaveBeenCalled();
    expect(rmsToDbfs(new Float32Array([0.5, -0.5]))).toBeCloseTo(-6.0206, 3);
  });

  it("telemetry_store_updates_only_subscribers", () => {
    const store = createTelemetryStore();
    const { result } = renderHook(() => useCaptureTelemetry(store));
    expect(result.current).toBe(IDLE_TELEMETRY);
    const next = { ...IDLE_TELEMETRY, captureId: "a-1", level: 0.4, autoStopState: "listening" as const };
    act(() => store.set(next));
    expect(result.current).toBe(next);
  });
});
