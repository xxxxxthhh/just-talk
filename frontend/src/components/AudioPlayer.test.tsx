import { fireEvent, render, screen } from "@testing-library/react";
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
});
