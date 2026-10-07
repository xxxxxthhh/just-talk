import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nextCapture, runReducer } from "../game/runModel";
import type { RunMode, RunPrompt, RunState, ScoreFailure, ScoreResponse } from "../types";
import { PracticeRun } from "./PracticeRun";

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

function start(mode: RunMode): RunState {
  return runReducer(null, { type: "START", runId: `run-${++counter}`, mode, prompts: PROMPTS }) as RunState;
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
          error_type: accuracy < 60 ? "Mispronunciation" : "None",
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
  let next = runReducer(state, { type: "BEGIN_CAPTURE", key, ...capture }) as RunState;
  next = runReducer(next, { type: "BLOB_READY", key, blob: new Blob(["audio"]) }) as RunState;
  next = runReducer(next, { type: "SCORE_SENT", key }) as RunState;
  return { key, state: next };
}

function score(state: RunState, accuracy: number): RunState {
  const sent = send(state);
  return runReducer(sent.state, { type: "SCORE_RECEIVED", key: sent.key, response: response(accuracy) }) as RunState;
}

function fail(state: RunState, failure: ScoreFailure): RunState {
  const sent = send(state);
  return runReducer(sent.state, { type: "SCORE_FAILED", key: sent.key, failure }) as RunState;
}

function advance(state: RunState): RunState {
  return runReducer(state, { type: "ADVANCE", runId: state.runId, itemId: state.items[state.index].prompt.itemId }) as RunState;
}

function loadReference(state: RunState, ok = true): RunState {
  const itemId = state.items[state.index].prompt.itemId;
  const clicked = runReducer(state, { type: "REFERENCE_CLICKED", runId: state.runId, itemId }) as RunState;
  return runReducer(clicked, { type: "REFERENCE_LOADED", runId: state.runId, itemId, ok }) as RunState;
}

function handlers() {
  return {
    onRecord: vi.fn(),
    onStop: vi.fn(),
    onRecordNext: vi.fn(),
    onFinish: vi.fn(),
    onSkip: vi.fn(),
    onCannotConfirm: vi.fn(),
    onPlayReference: vi.fn(),
    onQuit: vi.fn(),
    onResume: vi.fn(),
    onOpenReview: vi.fn(),
  };
}

const vibrate = vi.fn();

beforeEach(() => {
  vibrate.mockClear();
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "vibrate");
});

describe("PracticeRun", () => {
  it("verdict_uses_large_score_tone_and_one_optional_vibration", () => {
    const callbacks = handlers();
    let run = score(start("route"), 92);
    const view = render(<PracticeRun run={run} {...callbacks} />);

    const verdict = screen.getByText("92").closest(".run-verdict");
    expect(verdict).toHaveClass("good");
    expect(within(verdict as HTMLElement).getByText("Clear. Nice one.")).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(30);

    view.rerender(<PracticeRun run={{ ...run }} {...callbacks} />);
    view.unmount();
    render(<PracticeRun run={run} {...callbacks} />);
    expect(vibrate).toHaveBeenCalledTimes(1);

    run = score(advance(run), 52);
    const remounted = render(<PracticeRun run={run} {...callbacks} />);
    expect(vibrate).toHaveBeenCalledTimes(2);
    expect(within(remounted.container).getByText("52").closest(".run-verdict")).toHaveClass("needs-work");
    expect(within(remounted.container).getByText("Worth a re-listen.")).toBeInTheDocument();
    expect(within(remounted.container).getByText(/Listen for “think” · \/θ\//)).toBeInTheDocument();

    // A no-match never lights a node or vibrates.
    const noMatch = runReducer(send(advance(run)).state, {
      type: "SCORE_RECEIVED",
      key: { runId: run.runId, itemId: "focus-1", attemptId: `a-${counter}` },
      response: { result: { ...response(0).result, recognition_status: "no_match", words: [] }, session: null },
    }) as RunState;
    const noMatchView = render(<PracticeRun run={noMatch} {...callbacks} />);
    expect(vibrate).toHaveBeenCalledTimes(2);
    expect(within(noMatchView.container).getByLabelText("Item 3: not practiced, unscored, current")).toBeInTheDocument();

    Reflect.deleteProperty(navigator, "vibrate");
    expect(() => render(<PracticeRun run={score(start("route"), 80)} {...callbacks} />)).not.toThrow();
  });

  it("next_prompt_is_visible_without_timer_and_pending_rescue_blocks_advance", () => {
    vi.useFakeTimers();
    const callbacks = handlers();
    const route = score(start("route"), 80);
    const view = render(<PracticeRun run={route} {...callbacks} />);

    expect(screen.getByText("bright")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(callbacks.onRecordNext).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Record next" }));
    expect(callbacks.onRecordNext).toHaveBeenCalledTimes(1);
    view.unmount();

    let rescue = score(start("challenge"), 40);
    const rescueView = render(<PracticeRun run={rescue} {...callbacks} />);
    expect(screen.getByText("bright")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record again" })).toBeDisabled();
    expect(screen.getByText("Finish this one first.")).toBeInTheDocument();

    rescue = loadReference(rescue);
    rescueView.rerender(<PracticeRun run={rescue} {...callbacks} />);
    expect(screen.getByRole("button", { name: "Record again" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Record next" })).toBeDisabled();

    // Unknown scoring on the rescue keeps the first valid reading and lets the learner move on.
    const pending = fail(rescue, { kind: "unknown", message: "network" });
    rescueView.rerender(<PracticeRun run={pending} {...callbacks} />);
    expect(screen.getByLabelText("Item 1: practiced, score pending, current")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Still waiting on that score. You can keep going.")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record next" })).toBeEnabled();
  });

  it("rejection_message_shows_until_the_next_capture_begins", () => {
    const callbacks = handlers();
    const rejected = fail(start("challenge"), { kind: "rejected", message: "Recording too short." });
    const view = render(<PracticeRun run={rejected} {...callbacks} />);
    expect(screen.getByText(/didn't count: Recording too short\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();

    view.rerender(<PracticeRun run={score(rejected, 90)} {...callbacks} />);
    expect(screen.queryByText(/Recording too short/)).not.toBeInTheDocument();
  });

  it("challenge_summary_requires_user_action_before_review", () => {
    const callbacks = handlers();
    let run = start("challenge");
    for (let i = 0; i < PROMPTS.length; i += 1) {
      run = score(run, 90);
      if (i < PROMPTS.length - 1) run = advance(run);
    }
    const view = render(<PracticeRun run={run} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(callbacks.onFinish).toHaveBeenCalledTimes(1);

    run = advance(run);
    expect(run.phase).toBe("summary");
    view.rerender(<PracticeRun run={run} {...callbacks} />);
    expect(screen.getByRole("heading", { name: "Challenge cleared" })).toBeInTheDocument();
    expect(callbacks.onOpenReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "See review" }));
    expect(callbacks.onOpenReview).toHaveBeenCalledTimes(1);

    // A quota stop on the second item is service usage, not a pronunciation failure.
    const quota = fail(advance(score(start("challenge"), 90)), { kind: "quota", message: "limit" });
    expect(quota.endReason).toBe("quota");
    view.rerender(<PracticeRun run={quota} {...callbacks} />);
    expect(screen.getByRole("heading", { name: "Challenge incomplete" })).toBeInTheDocument();
    expect(screen.getByText(/Trial usage ran out/)).toBeInTheDocument();
    expect(screen.queryByText(/Out of hearts/)).not.toBeInTheDocument();
  });
});
