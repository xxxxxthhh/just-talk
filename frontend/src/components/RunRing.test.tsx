import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RING_STOP_GUARD_MS, RunRing, SCORE_ROLL_MS, type RunRingProps } from "./RunRing";
import { RunStones } from "./RunStones";
import { runV2Fixtures, type RunV2Fixture } from "./runV2Fixtures";

function ringOf(container: HTMLElement): HTMLElement {
  const ring = container.querySelector<HTMLElement>(".run-ring");
  if (!ring) throw new Error("ring not rendered");
  return ring;
}

// Element structure without inline styles or text: what layout depends on.
function shape(element: Element): string {
  const children = Array.from(element.children).map(shape).join("");
  return `<${element.tagName.toLowerCase()} class="${element.getAttribute("class") ?? ""}">${children}</>`;
}

function score(container: HTMLElement): string | null {
  return container.querySelector(".run-ring-score")?.textContent ?? null;
}

describe("RunRing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ring_ready_is_decorative_and_recording_can_stop", () => {
    const onStop = vi.fn();
    const { container, rerender } = render(<RunRing {...runV2Fixtures.ready.ring} onStop={onStop} />);
    expect(ringOf(container)).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).toBeNull();

    const recording = runV2Fixtures.recording.ring;
    rerender(<RunRing {...recording} onStop={onStop} />);
    const stop = screen.getByRole("button", { name: "Stop recording" });
    expect(ringOf(container)).not.toHaveAttribute("aria-hidden");

    fireEvent.click(stop);
    expect(onStop).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(RING_STOP_GUARD_MS));
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);

    // A new take restarts the guard.
    rerender(<RunRing {...recording} telemetry={{ ...recording.telemetry, captureId: "next-take" }} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(RING_STOP_GUARD_MS));
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it("ring_guard_never_disables_bottom_stop", () => {
    const onStop = vi.fn();
    render(
      <>
        <RunRing {...runV2Fixtures.recording.ring} onStop={onStop} />
        <button type="button" onClick={onStop}>
          Stop
        </button>
      </>
    );
    const ringStop = screen.getByRole("button", { name: "Stop recording" });
    expect(ringStop).toBeEnabled();

    fireEvent.click(ringStop);
    expect(onStop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("ring_motion_has_static_reduced_variants", () => {
    const recording = runV2Fixtures.recording.ring;
    const { container, rerender } = render(<RunRing {...recording} />);
    expect(container.querySelector(".run-ring-level")).toHaveStyle({ transform: `scale(${0.84 + 0.62 * 0.16})` });
    expect(container.querySelector(".run-ring-level-bar")).toBeNull();
    expect(container.querySelector(".run-ring-silence")).toHaveStyle({ strokeDasharray: "0.35 1" });

    rerender(<RunRing {...recording} reducedMotion />);
    expect(ringOf(container)).toHaveClass("is-reduced");
    expect(container.querySelector(".run-ring-level")).toBeNull();
    expect(container.querySelector(".run-ring-level-bar")).toHaveStyle({ transform: "scaleX(0.62)" });
    // The silence arc is functional, so it stays.
    expect(container.querySelector(".run-ring-silence")).toHaveStyle({ strokeDasharray: "0.35 1" });

    rerender(<RunRing {...runV2Fixtures.scoring.ring} />);
    expect(container.querySelectorAll(".run-ring-orbit")).toHaveLength(2);
    rerender(<RunRing {...runV2Fixtures.scoring.ring} reducedMotion />);
    expect(container.querySelectorAll(".run-ring-orbit")).toHaveLength(1);

    const perfect = runV2Fixtures.verdictPerfect.ring;
    rerender(<RunRing {...perfect} reducedMotion />);
    expect(score(container)).toBe("98");
    expect(container.querySelector(".run-ring-sweep")).toBeNull();
    expect(container.querySelector(".run-ring-sparks")).toBeNull();
    expect(container.querySelector(".run-ring-face")).toHaveAttribute("aria-hidden", "true");
  });

  it("verdict score rolls once per feedback and lows appear directly", () => {
    const perfect = runV2Fixtures.verdictPerfect.ring;
    const { container, rerender } = render(<RunRing {...perfect} />);
    expect(score(container)).toBe("0");
    expect(container.querySelector(".run-ring-sweep")).not.toBeNull();
    act(() => vi.advanceTimersByTime(SCORE_ROLL_MS + 50));
    expect(score(container)).toBe("98");

    // A re-render with the same feedback does not replay the roll.
    rerender(<RunRing {...perfect} reducedMotion={false} />);
    expect(score(container)).toBe("98");

    rerender(<RunRing {...runV2Fixtures.verdictRelisten.ring} />);
    expect(score(container)).toBe("45");
    expect(container.querySelector(".run-ring-sweep")).toBeNull();
  });

  it("ring_and_stones_do_not_shift_prompt_layout", () => {
    const recording = runV2Fixtures.recording.ring;
    const quiet: RunRingProps = { ...recording, telemetry: { ...recording.telemetry, level: 0, silenceProgress: 0 } };
    const loud: RunRingProps = { ...recording, telemetry: { ...recording.telemetry, level: 1, silenceProgress: 0.9, elapsedMs: 4800 } };
    const { container, rerender } = render(<RunRing {...quiet} />);
    const before = shape(ringOf(container));
    rerender(<RunRing {...loud} />);
    expect(shape(ringOf(container))).toBe(before);

    // Inline transforms only ever live inside the SVG art; the text face is a sibling, never transformed.
    const art = container.querySelector(".run-ring-art");
    for (const element of container.querySelectorAll<HTMLElement | SVGElement>("[style]")) {
      if (element.style.transform) expect(art?.contains(element)).toBe(true);
    }
    expect(art?.contains(container.querySelector(".run-ring-face"))).toBe(false);

    const perfect = runV2Fixtures.verdictPerfect.ring;
    rerender(<RunRing {...perfect} />);
    const rolling = shape(ringOf(container));
    act(() => vi.advanceTimersByTime(SCORE_ROLL_MS + 50));
    expect(shape(ringOf(container))).toBe(rolling);

    const stones = (fixture: RunV2Fixture) => (
      <RunStones
        items={fixture.run.items}
        scores={fixture.score.items}
        currentIndex={fixture.run.index}
        reducedMotion={false}
      />
    );
    const { container: stoneBox, rerender: rerenderStones } = render(stones(runV2Fixtures.recording));
    const stonesBefore = shape(stoneBox).replace(/ is-current/g, "");
    rerenderStones(stones(runV2Fixtures.verdictPerfect));
    expect(shape(stoneBox).replace(/ is-current/g, "")).toBe(stonesBefore);
  });
});
