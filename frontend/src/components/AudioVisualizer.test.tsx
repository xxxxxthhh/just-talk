import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AudioVisualizer } from "./AudioVisualizer";

const baseProps = {
  audioStream: null,
  playbackTime: 0,
  playbackDuration: 0,
  isAudioPlaying: false,
  result: null,
  recordedAmplitudes: null,
  maxMs: 30000,
};

describe("AudioVisualizer", () => {
  let canvasContext: CanvasRenderingContext2D;

  beforeEach(() => {
    canvasContext = ({
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      fill: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      scale: vi.fn(),
      stroke: vi.fn(),
    } as unknown) as CanvasRenderingContext2D;
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 320,
      height: 80,
      top: 0,
      right: 320,
      bottom: 80,
      left: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("does not save fake recorded amplitudes when no recording samples were captured", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const onAmplitudesChange = vi.fn();
    const { rerender } = render(
      <AudioVisualizer
        {...baseProps}
        recorderState="recording"
        onAmplitudesChange={onAmplitudesChange}
      />
    );

    rerender(
      <AudioVisualizer
        {...baseProps}
        recorderState="recorded"
        onAmplitudesChange={onAmplitudesChange}
      />
    );

    expect(onAmplitudesChange).not.toHaveBeenCalled();
  });

  test("draws the idle state as a thin waveform stroke instead of filled bars", () => {
    render(
      <AudioVisualizer
        {...baseProps}
        recorderState="idle"
      />
    );

    expect(canvasContext.stroke).toHaveBeenCalled();
    expect(canvasContext.fill).not.toHaveBeenCalled();
  });
});
