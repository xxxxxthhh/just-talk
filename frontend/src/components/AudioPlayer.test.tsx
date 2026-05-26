import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AudioPlayer } from "./AudioPlayer";

describe("AudioPlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("notifies the parent before recording playback starts", () => {
    const onPlayStart = vi.fn();
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

    render(<AudioPlayer audioUrl="blob:recording" onPlayStart={onPlayStart} />);

    fireEvent.click(screen.getByTitle("Play recording"));

    expect(onPlayStart).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  test("pauses recording playback when the parent sends a stop signal", () => {
    const pause = vi
      .spyOn(window.HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    const { rerender } = render(<AudioPlayer audioUrl="blob:recording" stopSignal={0} />);

    rerender(<AudioPlayer audioUrl="blob:recording" stopSignal={1} />);

    expect(pause).toHaveBeenCalledTimes(1);
  });

  test("seeks and starts playback when the parent sends a seek request", async () => {
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const onPlayStart = vi.fn();
    const onTimeChange = vi.fn();
    const { container, rerender } = render(
      <AudioPlayer
        audioUrl="blob:recording"
        onPlayStart={onPlayStart}
        onTimeChange={onTimeChange}
        seekRequest={null}
      />
    );

    const audio = container.querySelector("audio");
    rerender(
      <AudioPlayer
        audioUrl="blob:recording"
        onPlayStart={onPlayStart}
        onTimeChange={onTimeChange}
        seekRequest={{ id: 1, timeSeconds: 1.25, play: true }}
      />
    );

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(audio?.currentTime).toBeCloseTo(1.25);
    expect(onPlayStart).toHaveBeenCalledTimes(1);
    expect(onTimeChange).toHaveBeenLastCalledWith(1.25);
  });
});
