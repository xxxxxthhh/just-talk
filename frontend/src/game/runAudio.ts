import { useSyncExternalStore } from "react";

import type { CaptureTelemetry } from "../types";

// One AudioContext per run, created in the Start gesture, shared by capture analysis and sound
// effects. Ordinary playback uses media elements and never depends on it.

type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;

// Synchronous so it runs inside the user gesture, before any await. Failure means manual Stop only.
export function prepareRunAudio(): AudioContext | null {
  try {
    const Context: AudioContextConstructor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Context) return null;
    if (!context || context.state === "closed") context = new Context();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

export function runAudioContext(): AudioContext | null {
  return context;
}

export function releaseRunAudio(): void {
  const released = context;
  context = null;
  if (released && released.state !== "closed") void released.close().catch(() => undefined);
}

export function rmsToDbfs(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return 10 * Math.log10(sum / samples.length);
}

export type LevelMeter = { read(): number; dispose(): void };

// Reads the microphone's level in dBFS. Connected to an analyser only, never to the speakers.
export function createLevelMeter(stream: MediaStream): LevelMeter | null {
  const audio = context;
  if (!audio) return null;
  try {
    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    return {
      read() {
        analyser.getFloatTimeDomainData(samples);
        return rmsToDbfs(samples);
      },
      dispose() {
        source.disconnect();
        analyser.disconnect();
      }
    };
  } catch {
    return null;
  }
}

export const IDLE_TELEMETRY: CaptureTelemetry = Object.freeze({
  captureId: null,
  level: 0,
  silenceProgress: 0,
  autoStopState: "off",
  elapsedMs: 0
});

export type TelemetryStore = {
  get(): CaptureTelemetry;
  set(next: CaptureTelemetry): void;
  subscribe(listener: () => void): () => void;
};

// Telemetry changes every audio frame, so only components that subscribe re-render.
export function createTelemetryStore(): TelemetryStore {
  let current = IDLE_TELEMETRY;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      current = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function useCaptureTelemetry(store: TelemetryStore): CaptureTelemetry {
  return useSyncExternalStore(store.subscribe, store.get);
}
