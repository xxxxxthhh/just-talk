import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nextCapture, runReducer } from "../game/runModel";
import type { RunAction, RunMode, RunPrompt, RunState, ScoreFailure, ScoreResponse } from "../types";
import { PracticeRun, SLOW_SCORE_MS, type PracticeRunProps } from "./PracticeRun";
import { SCORE_ROLL_MS } from "./RunRing";
import { practiceRunProps, runV2Fixtures } from "./runV2Fixtures";

const PROMPTS: RunPrompt[] = [
  ["warmup-1", "warmup", "word", "water"],
  ["warmup-2", "warmup", "word", "bright"],
  ["focus-1", "focus", "word", "think"],
  ["focus-2", "focus", "word", "thank"],
  ["context-1", "context", "sentence", "I think we can walk home now."],
  ["context-2", "context", "sentence", "The narrow path leads to our house."],
].map(([itemId, stage, kind, text]) => ({
  itemId,
  stage: stage as RunPrompt["stage"],
  kind: kind as RunPrompt["kind"],
  text,
  targetPhoneme: stage === "warmup" ? null : "θ",
  targetWord: text,
  source: "starter",
}));

let counter = 0;

function step(state: RunState, action: RunAction): RunState {
  const next = runReducer(state, action);
  if (!next) throw new Error("run ended");
  return next;
}

function start(mode: RunMode): RunState {
  const started = runReducer(null, { type: "START", runId: `run-${++counter}`, mode, prompts: PROMPTS });
  if (!started) throw new Error("run did not start");
  return started;
}

function response(accuracy: number, word = "think"): ScoreResponse {
  return {
    result: {
      transcript: word,
      scores: { accuracy, fluency: null, completeness: null, prosody: null, pronunciation: null },
      words: [
        {
          word,
          accuracy,
          bucket: "watch",
          error_type: "None",
          offset_ms: 0,
          duration_ms: 300,
          phonemes: [{ phoneme: "θ", accuracy, bucket: "watch", offset_ms: 0, duration_ms: 100, n_best: [] }],
        },
      ],
      raw: null,
    },
    session: null,
  };
}

function send(state: RunState) {
  const capture = nextCapture(state);
  if (!capture) throw new Error("no capture available");
  const key = { runId: state.runId, itemId: state.items[state.index].prompt.itemId, attemptId: `a-${++counter}` };
  let next = step(state, { type: "BEGIN_CAPTURE", key, ...capture });
  next = step(next, { type: "BLOB_READY", key, blob: new Blob(["audio"]) });
  next = step(next, { type: "SCORE_SENT", key });
  return { key, state: next };
}

function score(state: RunState, accuracy: number): RunState {
  const sent = send(state);
  return step(sent.state, { type: "SCORE_RECEIVED", key: sent.key, response: response(accuracy) });
}

function fail(state: RunState, failure: ScoreFailure): RunState {
  const sent = send(state);
  return step(sent.state, { type: "SCORE_FAILED", key: sent.key, failure });
}

function advance(state: RunState): RunState {
  return step(state, { type: "ADVANCE", runId: state.runId, itemId: state.items[state.index].prompt.itemId });
}

function handlers() {
  return {
    onRecord: vi.fn(),
    onStop: vi.fn(),
    onCancelTake: vi.fn(),
    onRecordNext: vi.fn(),
    onFinish: vi.fn(),
    onSkip: vi.fn(),
    onPlayReference: vi.fn(),
    onUseManualStop: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onQuit: vi.fn(),
    onOpenReview: vi.fn(),
    onPlayAgain: vi.fn(),
    onDone: vi.fn(),
    onFeedbackConsumed: vi.fn(),
    onSetPreference: vi.fn(),
  };
}

function renderRun(run: RunState, overrides: Partial<PracticeRunProps> = {}) {
  const props = practiceRunProps(run, overrides);
  return { ...render(<PracticeRun {...props} />), props };
}

function liveRegion(container: HTMLElement): string {
  return container.querySelector("[aria-live='polite']")?.textContent ?? "";
}

function ring(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".run-ring");
  if (!element) throw new Error("ring not rendered");
  return element;
}

// The visible status area, apart from the single live region that announces it.
function status(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>(".run-status");
  if (!element) throw new Error("status not rendered");
  return within(element);
}

function ringScore(container: HTMLElement): string | null {
  return container.querySelector(".run-ring-score")?.textContent ?? null;
}

const vibrate = vi.fn();

beforeEach(() => {
  vibrate.mockClear();
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "vibrate");
});

describe("PracticeRun", () => {
  it("verdict_uses_game_tier_not_score_tone", () => {
    const good = renderRun(runV2Fixtures.boundaryGood.run, { reducedMotion: true });
    expect(ring(good.container)).toHaveAttribute("data-tier", "good");
    expect(ringScore(good.container)).toBe("84.9");
    expect(within(ring(good.container)).getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("Solid.")).toBeInTheDocument();
    expect(screen.getByText("+127")).toBeInTheDocument();
    expect(screen.queryByText(/in a row/)).not.toBeInTheDocument();
    expect(good.container.querySelector(".good, .watch, .needs-work")).toBeNull();
    good.unmount();

    const great = renderRun(runV2Fixtures.boundaryGreat.run, { reducedMotion: true });
    expect(ring(great.container)).toHaveAttribute("data-tier", "great");
    expect(ringScore(great.container)).toBe("85");
    expect(within(ring(great.container)).getByText("Great")).toBeInTheDocument();
    expect(screen.getByText("×3 in a row +13")).toBeInTheDocument();
    great.unmount();

    // 72 is Good in the game palette, whatever the ordinary score tone calls it.
    const solid = renderRun(runV2Fixtures.verdictGood.run, { reducedMotion: true });
    expect(ring(solid.container)).toHaveAttribute("data-tier", "good");
    expect(solid.container.querySelector(".good, .watch, .needs-work")).toBeNull();
  });

  it("rolling_score_never_changes_game_facts_or_blocks_next", () => {
    const callbacks = handlers();
    const { container } = renderRun(runV2Fixtures.verdictPerfect.run, callbacks);
    // Frame zero: the ring is still rolling, but every fact is final and Next is live.
    expect(ringScore(container)).toBe("0");
    expect(ring(container)).toHaveAttribute("data-tier", "perfect");
    expect(screen.getByText("+147")).toBeInTheDocument();
    expect(screen.getByText("×3 in a row +13")).toBeInTheDocument();
    expect(liveRegion(container)).toBe("98. Perfect. Chain 3.");
    const next = screen.getByRole("button", { name: "Record next" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(callbacks.onRecordNext).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(SCORE_ROLL_MS + 50));
    expect(ringScore(container)).toBe("98");
    expect(screen.getByText("+147")).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("local_rejection_has_own_copy_and_manual_fallback", () => {
    const callbacks = handlers();
    const noSpeech = renderRun(runV2Fixtures.localRejectNoSpeech.run, callbacks);
    expect(status(noSpeech.container).getByText("Didn't catch anything")).toBeInTheDocument();
    expect(liveRegion(noSpeech.container)).toBe("Didn't catch anything");
    expect(screen.queryByText(/didn't count/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use manual Stop" }));
    expect(callbacks.onUseManualStop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
    noSpeech.unmount();

    const tooShort = renderRun(runV2Fixtures.localRejectTooShort.run, callbacks);
    expect(status(tooShort.container).getByText("Too short · try once more")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use manual Stop" })).not.toBeInTheDocument();
    tooShort.unmount();

    // A server rejection keeps its wording, and the next capture clears it.
    const rejected = runV2Fixtures.serverRejected.run;
    const server = renderRun(rejected, callbacks);
    expect(screen.getByText("That recording wasn't scored and didn't count: Recording too short.")).toBeInTheDocument();
    server.rerender(<PracticeRun {...practiceRunProps(score(rejected, 90), callbacks)} />);
    expect(screen.queryByText(/Recording too short/)).not.toBeInTheDocument();
  });

  it("rescue_has_one_primary_action_and_preserves_reference_gate", () => {
    const callbacks = handlers();
    const rescue = runV2Fixtures.rescue.run;
    const view = renderRun(rescue, callbacks);
    expect(screen.getByRole("heading", { name: "One more listen" })).toBeInTheDocument();
    expect(screen.getByText("No heart lost yet")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "2 of 2 hearts left, one at risk" })).toBeInTheDocument();
    expect(ringScore(view.container)).toBe("46");
    // Before the reference loads, Hear it is the only primary; there is no disabled Record or Next button.
    expect(screen.getByRole("button", { name: "Hear it" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Record again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record next" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".run-next-v2.is-dim")).toHaveTextContent("These little birds wait by the window.");
    fireEvent.click(screen.getByRole("button", { name: "Hear it" }));
    expect(callbacks.onPlayReference).toHaveBeenCalledTimes(1);

    const itemId = rescue.items[rescue.index].prompt.itemId;
    const loading = step(rescue, { type: "REFERENCE_CLICKED", runId: rescue.runId, itemId });
    view.rerender(<PracticeRun {...practiceRunProps(loading, callbacks)} />);
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();

    view.rerender(<PracticeRun {...practiceRunProps(runV2Fixtures.rescueLoaded.run, callbacks)} />);
    fireEvent.click(screen.getByRole("button", { name: "Record again" }));
    expect(callbacks.onRecord).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Hear it" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip rescue · this challenge won't count as cleared" }));
    expect(callbacks.onSkip).toHaveBeenCalledTimes(1);
    view.unmount();

    renderRun(runV2Fixtures.heartLost.run);
    expect(screen.getByText("46 → 52")).toBeInTheDocument();
    expect(screen.getByText("Two low readings. One heart used.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 of 2 hearts left" })).toBeInTheDocument();
  });

  it("heart_overlay_never_intercepts_summary_buttons", () => {
    const callbacks = handlers();
    const { container } = renderRun(runV2Fixtures.summaryUnrated.run, callbacks);
    const overlay = container.querySelector<HTMLElement>(".run-crack");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay?.style.pointerEvents).toBe("none");
    for (const [name, handler] of [
      ["See review", callbacks.onOpenReview],
      ["Play again", callbacks.onPlayAgain],
      ["Done", callbacks.onDone],
    ] as const) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(handler).toHaveBeenCalledTimes(1);
    }
    // The first tap ended the sequence, overlay included.
    expect(container.querySelector(".run-crack")).toBeNull();
  });

  it("summary_frame_zero_actions_cancel_animation", () => {
    const callbacks = handlers();
    const fixture = runV2Fixtures.summaryRated;
    const view = renderRun(fixture.run, { ...callbacks, receipt: fixture.receipt });
    const total = () => view.container.querySelector(".run-summary-total")?.textContent;
    expect(view.container.querySelector(".run-summary-v2")).not.toHaveClass("is-settled");
    expect(total()).toBe("0");
    for (const name of ["See review", "Play again", "Done"]) expect(screen.getByRole("button", { name })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "See review" }));
    expect(callbacks.onOpenReview).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".run-summary-v2")).toHaveClass("is-settled");
    expect(total()).toBe("861");
    expect(ring(view.container)).toHaveClass("is-settled");
    view.unmount();

    const reduced = renderRun(fixture.run, { receipt: fixture.receipt, reducedMotion: true });
    expect(reduced.container.querySelector(".run-summary-v2")).toHaveClass("is-settled");
    expect(reduced.container.querySelector(".run-summary-total")).toHaveTextContent("861");
    reduced.unmount();

    // Still a tap away from the review, and a quota stop never reads as running out of hearts.
    const quota = fail(advance(score(start("challenge"), 90)), { kind: "quota", message: "limit" });
    renderRun(quota, callbacks);
    expect(screen.getByRole("heading", { name: "Challenge incomplete" })).toBeInTheDocument();
    expect(screen.getByText(/Trial usage ran out/)).toBeInTheDocument();
    expect(screen.queryByText(/Out of hearts/)).not.toBeInTheDocument();
    expect(callbacks.onOpenReview).toHaveBeenCalledTimes(1);
  });

  it("unrated_and_cleared_c_have_honest_summary", () => {
    const cleared = runV2Fixtures.summaryClearedC;
    const c = renderRun(cleared.run, { receipt: cleared.receipt, reducedMotion: true });
    expect(screen.getByRole("heading", { name: /Challenge cleared/ })).toBeInTheDocument();
    expect(c.container.querySelector(".run-ring-rating")).toHaveTextContent("C");
    expect(c.container.querySelector(".run-summary-total")).toHaveTextContent("540");
    expect(screen.getByText("Logged.")).toBeInTheDocument();
    expect(screen.getByText("First record")).toBeInTheDocument();
    expect(c.container).not.toHaveTextContent(/not rated|fail|wrong|miss/i);
    c.unmount();

    const unrated = renderRun(runV2Fixtures.summaryUnrated.run, { reducedMotion: true });
    expect(screen.getByRole("heading", { name: "Out of hearts" })).toBeInTheDocument();
    expect(screen.getByText("Not rated · Out of hearts")).toBeInTheDocument();
    expect(unrated.container.querySelector(".run-summary-total")).toHaveTextContent("126");
    expect(unrated.container.querySelector(".run-ring-rating")).toBeNull();
    expect(unrated.container.querySelector(".run-summary-cracked")).not.toBeNull();
    expect(unrated.container.querySelector(".run-badges")).toBeNull();
    unrated.unmount();

    const rated = runV2Fixtures.summaryRated;
    renderRun(rated.run, { receipt: rated.receipt, reducedMotion: true });
    expect(screen.getByText("Strong run.")).toBeInTheDocument();
    expect(screen.getByText("New best · was 790")).toBeInTheDocument();
    expect(screen.getByText("Longest chain").closest(".run-tile")).toHaveTextContent("4 / 6");
    expect(screen.getByText("One thing to revisit").closest(".run-revisit")).toHaveTextContent("birds word 31");
  });

  it("aria_announces_final_state_once_and_keeps_focus", () => {
    const callbacks = handlers();
    const verdict = runV2Fixtures.verdictPerfect.run;
    const first = renderRun(verdict, callbacks);
    expect(liveRegion(first.container)).toBe("98. Perfect. Chain 3.");
    expect(callbacks.onFeedbackConsumed).toHaveBeenCalledTimes(1);
    const [consumedId] = callbacks.onFeedbackConsumed.mock.calls[0];
    first.rerender(<PracticeRun {...practiceRunProps({ ...verdict }, callbacks)} />);
    expect(liveRegion(first.container)).toBe("98. Perfect. Chain 3.");
    expect(vibrate).toHaveBeenCalledTimes(1);
    first.unmount();

    // A remount after the feedback was shown: no replayed announcement, roll, pop or haptic.
    const remount = renderRun(verdict, { ...callbacks, consumedFeedbackIds: new Set([consumedId]) });
    expect(liveRegion(remount.container)).toBe("");
    expect(ring(remount.container)).toHaveClass("is-settled");
    expect(ringScore(remount.container)).toBe("98");
    expect(vibrate).toHaveBeenCalledTimes(1);
    remount.unmount();

    // Record turns into Stop in place, so focus stays on the same button.
    const ready = runV2Fixtures.recording.run;
    const readyRun = step(ready, { type: "PAUSE", runId: ready.runId });
    const resumed = step(readyRun, { type: "RESUME", runId: ready.runId });
    const view = renderRun(resumed, callbacks);
    const record = screen.getByRole("button", { name: "Record" });
    record.focus();
    view.rerender(<PracticeRun {...practiceRunProps(runV2Fixtures.recording.run, callbacks)} />);
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(stop).toBe(record);
    expect(document.activeElement).toBe(stop);
    fireEvent.click(stop);
    expect(callbacks.onStop).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel take" }));
    expect(callbacks.onCancelTake).toHaveBeenCalledTimes(1);
    expect(liveRegion(view.container)).toBe("Recording.");
  });

  it("scoring waits without a timeout claim or a resend", () => {
    const callbacks = handlers();
    const { container } = renderRun(runV2Fixtures.scoring.run, callbacks);
    expect(status(container).getByText("Got it, listening…")).toBeInTheDocument();
    expect(liveRegion(container)).toBe("Got it, listening.");
    expect(screen.getByRole("button", { name: "Listening…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pause run" })).toBeEnabled();
    act(() => vi.advanceTimersByTime(SLOW_SCORE_MS));
    expect(status(container).getByText("Still waiting for your result…")).toBeInTheDocument();
    expect(liveRegion(container)).toBe("Still waiting for your result.");
    expect(container).not.toHaveTextContent(/timed out|try again|resend/i);
    expect(callbacks.onRecord).not.toHaveBeenCalled();
  });

  it("recording hints follow this take's auto-stop state", () => {
    const recording = runV2Fixtures.recording;
    const view = renderRun(recording.run, { telemetry: recording.ring.telemetry });
    expect(screen.getByText("Speak. I'll stop for you.")).toBeInTheDocument();
    view.rerender(<PracticeRun {...practiceRunProps(recording.run, { telemetry: runV2Fixtures.fallback.ring.telemetry })} />);
    expect(screen.getByText("Noisy · tap Stop")).toBeInTheDocument();
    view.rerender(
      <PracticeRun {...practiceRunProps(recording.run, { telemetry: { ...recording.ring.telemetry, autoStopState: "off" } })} />
    );
    expect(screen.getByText("Auto-stop off · tap Stop")).toBeInTheDocument();
    // Without a controller cancel, the secondary slot stays empty rather than offering a skip.
    view.rerender(<PracticeRun {...practiceRunProps(recording.run, { onCancelTake: undefined })} />);
    expect(screen.queryByRole("button", { name: "Cancel take" })).not.toBeInTheDocument();
  });

  it("pause, preferences and sentence collection gate the next step", () => {
    const callbacks = handlers();
    const view = renderRun(runV2Fixtures.ready.run, callbacks);
    fireEvent.click(screen.getByRole("button", { name: "Pause run" }));
    expect(callbacks.onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sound" }));
    expect(callbacks.onSetPreference).toHaveBeenCalledWith("sfx", false);
    fireEvent.click(screen.getByRole("button", { name: "Auto-stop on" }));
    expect(callbacks.onSetPreference).toHaveBeenCalledWith("autoStop", false);

    const paused = step(runV2Fixtures.ready.run, { type: "PAUSE", runId: runV2Fixtures.ready.run.runId });
    view.rerender(<PracticeRun {...practiceRunProps(paused, callbacks)} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(callbacks.onResume).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Quit run" }));
    expect(callbacks.onQuit).toHaveBeenCalledTimes(1);
    view.unmount();

    renderRun(runV2Fixtures.sentenceSyncing.run, callbacks);
    expect(screen.getByText("Checking words from that sentence…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record next" })).toBeDisabled();
  });

  it("an unknown result keeps the first reading and lets the learner move on", () => {
    const callbacks = handlers();
    const low = score(start("challenge"), 40);
    const rescue = step(low, { type: "REFERENCE_CLICKED", runId: low.runId, itemId: "warmup-1" });
    const loaded = step(rescue, { type: "REFERENCE_LOADED", runId: rescue.runId, itemId: "warmup-1", ok: true });
    const pending = fail(loaded, { kind: "unknown", message: "network" });
    renderRun(pending, callbacks);
    expect(screen.getByText("Still waiting on that score. You can keep going.")).toBeInTheDocument();
    expect(ringScore(document.body)).toBe("40");
    expect(screen.getByLabelText(/1\. water: first reading Re-listen 40, result pending/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record next" })).toBeEnabled();
  });
});
