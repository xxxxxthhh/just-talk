import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunPrompt } from "../types";
import { RunMiniPlayer, useYouPlayer, type CoachPlayback } from "./RunMiniPlayer";

const THESE: RunPrompt = {
  itemId: "focus-1",
  stage: "focus",
  kind: "word",
  text: "these",
  targetPhoneme: "ð",
  targetWord: "these",
  source: "starter",
};
const THOSE: RunPrompt = { ...THESE, itemId: "focus-2", text: "those", targetWord: "those" };

type HarnessProps = { coach: CoachPlayback; onPlayCoach: (prompt: RunPrompt) => void; onStopCoach: () => void };

// Two players over one shared recording element, as the review uses them.
function Harness({ coach, onPlayCoach, onStopCoach }: HarnessProps) {
  const [player, element] = useYouPlayer(coach, onStopCoach);
  return (
    <>
      <RunMiniPlayer
        player={player}
        takes={[{ attemptId: "a-these", label: "92", url: "blob:these" }]}
        subject="these"
        coachPrompt={THESE}
        coach={coach}
        onPlayCoach={onPlayCoach}
        onStopCoach={onStopCoach}
      />
      <RunMiniPlayer
        player={player}
        takes={[
          { attemptId: "a-those-1", label: "Take 1 · 46", url: "blob:those-1" },
          { attemptId: "a-those-2", label: "Take 2 · 72", url: "blob:those-2" },
        ]}
        subject="those"
        coachPrompt={THOSE}
        coach={coach}
        onPlayCoach={onPlayCoach}
        onStopCoach={onStopCoach}
      />
      {element}
    </>
  );
}

const IDLE: CoachPlayback = { text: "", status: "idle" };

let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function audio(container: HTMLElement): HTMLAudioElement {
  const element = container.querySelector("audio");
  if (!element) throw new Error("no audio element");
  return element;
}

describe("RunMiniPlayer", () => {
  it("one_you_or_coach_source_plays_at_a_time", () => {
    const onPlayCoach = vi.fn();
    const onStopCoach = vi.fn();
    const view = render(<Harness coach={IDLE} onPlayCoach={onPlayCoach} onStopCoach={onStopCoach} />);

    // You first stops the Coach, then plays its own take through the single element.
    fireEvent.click(screen.getByRole("button", { name: "Play your take of these" }));
    expect(onStopCoach).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(audio(view.container).getAttribute("src")).toBe("blob:these");
    expect(screen.getByRole("button", { name: "Stop your take of these" })).toBeInTheDocument();

    // Another take replaces it on the same element; there is never a second element.
    fireEvent.click(screen.getByRole("button", { name: "Play your take of those, Take 2 · 72" }));
    expect(view.container.querySelectorAll("audio")).toHaveLength(1);
    expect(audio(view.container).getAttribute("src")).toBe("blob:those-2");
    expect(screen.getByRole("button", { name: "Play your take of these" })).toBeInTheDocument();

    // Coach first stops You.
    const pausesBefore = pause.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Play coach reference of these" }));
    expect(pause.mock.calls.length).toBeGreaterThan(pausesBefore);
    expect(audio(view.container).hasAttribute("src")).toBe(false);
    expect(onPlayCoach).toHaveBeenCalledWith(THESE);
    expect(screen.getByRole("button", { name: "Play your take of those, Take 2 · 72" })).toBeInTheDocument();

    view.rerender(<Harness coach={{ text: "these", status: "playing" }} onPlayCoach={onPlayCoach} onStopCoach={onStopCoach} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop coach reference of these" }));
    expect(onStopCoach).toHaveBeenCalledTimes(3);

    // Switching takes stops the take that was playing.
    fireEvent.click(screen.getByRole("button", { name: "Play your take of those, Take 2 · 72" }));
    fireEvent.click(screen.getByRole("button", { name: "Take 1 · 46" }));
    expect(audio(view.container).hasAttribute("src")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Play your take of those, Take 1 · 46" }));
    expect(audio(view.container).getAttribute("src")).toBe("blob:those-1");
  });

  it("late_coach_load_cannot_interrupt_you", () => {
    const onPlayCoach = vi.fn();
    const onStopCoach = vi.fn();
    const view = render(<Harness coach={IDLE} onPlayCoach={onPlayCoach} onStopCoach={onStopCoach} />);
    fireEvent.click(screen.getByRole("button", { name: "Play coach reference of these" }));
    view.rerender(<Harness coach={{ text: "these", status: "loading" }} onPlayCoach={onPlayCoach} onStopCoach={onStopCoach} />);
    expect(screen.getByRole("button", { name: "Stop coach reference of these" })).toHaveTextContent("loading…");

    // You while the Coach is still loading cancels that load first.
    fireEvent.click(screen.getByRole("button", { name: "Play your take of these" }));
    expect(onStopCoach).toHaveBeenCalledTimes(1);
    const pausesWhilePlaying = pause.mock.calls.length;

    // If the load still lands, the Coach is stopped and You keeps playing.
    view.rerender(<Harness coach={{ text: "these", status: "playing" }} onPlayCoach={onPlayCoach} onStopCoach={onStopCoach} />);
    expect(onStopCoach).toHaveBeenCalledTimes(2);
    expect(pause.mock.calls.length).toBe(pausesWhilePlaying);
    expect(audio(view.container).getAttribute("src")).toBe("blob:these");
    expect(screen.getByRole("button", { name: "Stop your take of these" })).toBeInTheDocument();
  });

  it("a stale play() failure never marks the newer take as failed", async () => {
    let rejectFirst: (error: Error) => void = () => {};
    play.mockImplementationOnce(() => new Promise<void>((_, reject) => (rejectFirst = reject)));
    render(<Harness coach={IDLE} onPlayCoach={vi.fn()} onStopCoach={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Play your take of these" }));
    fireEvent.click(screen.getByRole("button", { name: "Play your take of those, Take 2 · 72" }));
    rejectFirst(new Error("aborted"));
    await Promise.resolve();
    expect(screen.queryByText(/Couldn't play that recording/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop your take of those, Take 2 · 72" })).toBeInTheDocument();

    // A failure of the current take is readable and says the score stands.
    play.mockRejectedValueOnce(new Error("decode"));
    fireEvent.click(screen.getByRole("button", { name: "Play your take of these" }));
    expect(await screen.findByText("Couldn't play that recording. Its score is unchanged.")).toBeInTheDocument();
  });
});
