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
      fillText: vi.fn(),
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

  test("renders independent semantic sliders in dual comparison mode with correct aria values", () => {
    const mockResult = {
      transcript: "morning",
      scores: { pronunciation: 92, accuracy: 92, fluency: 92, completeness: 92, prosody: 92 },
      words: [],
      raw: {},
    };

    const { getByLabelText } = render(
      <AudioVisualizer
        {...baseProps}
        recorderState="recorded"
        result={mockResult}
        coachDuration={1.2}
        userDuration={1.8}
        coachCurrentTime={0.4}
        userCurrentTime={0.9}
        activeTrack="coach"
      />
    );

    const coachSlider = getByLabelText("Coach standard accent playback position slider") as HTMLInputElement;
    const userSlider = getByLabelText("Your recorded accent playback position slider") as HTMLInputElement;

    expect(coachSlider).toBeInTheDocument();
    expect(userSlider).toBeInTheDocument();

    expect(coachSlider.max).toBe("1.2");
    expect(coachSlider.value).toBe("0.4");
    expect(coachSlider.getAttribute("aria-valuemax")).toBe("1.2");
    expect(coachSlider.getAttribute("aria-valuenow")).toBe("0.4");
    expect(coachSlider.getAttribute("aria-valuetext")).toContain("Playback at 0.4s of 1.2s");

    expect(userSlider.max).toBe("1.8");
    expect(userSlider.value).toBe("0.9");
    expect(userSlider.getAttribute("aria-valuemax")).toBe("1.8");
    expect(userSlider.getAttribute("aria-valuenow")).toBe("0.9");
    expect(userSlider.getAttribute("aria-valuetext")).toContain("Playback at 0.9s of 1.8s");
  });
});
