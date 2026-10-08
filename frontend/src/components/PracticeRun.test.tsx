import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configForChoice } from "../game/runConfig";
import { nextCapture, runReducer } from "../game/runModel";
import type { RunAction, RunMode, RunPrompt, RunState, ScoreFailure, ScoreResponse } from "../types";
import { PracticeRun, SLOW_SCORE_MS } from "./PracticeRun";
import { SCORE_ROLL_MS } from "./RunRing";
import { practiceRunProps, runV2Fixtures } from "./runV2Fixtures";
import { runV3Fixtures } from "./runV3Fixtures";

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
  const started = runReducer(null, {
    type: "START",
    runId: `run-${++counter}`,
    config: configForChoice({ selection: mode === "route" ? "route" : "target60", routeLength: 6 }),
    prompts: PROMPTS
  });
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
    onHearFirst: vi.fn(),
    onHearNextFirst: vi.fn(),
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

function renderRun(run: RunState, overrides: Parameters<typeof practiceRunProps>[1] = {}) {
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
    expect(status(server.container).getByText("That recording wasn't scored and didn't count: Recording too short.")).toBeInTheDocument();
    expect(liveRegion(server.container)).toBe("That recording wasn't scored and didn't count: Recording too short.");
    server.rerender(<PracticeRun {...practiceRunProps(score(rejected, 90), callbacks)} />);
    expect(screen.queryByText(/Recording too short/)).not.toBeInTheDocument();
  });

  it("local rejection shows and announces in every phase it can return to", () => {
    function begin(state: RunState) {
      const capture = nextCapture(state);
      if (!capture) throw new Error("no capture available");
      const key = { runId: state.runId, itemId: state.items[state.index].prompt.itemId, attemptId: `local-${++counter}` };
      return { key, state: step(state, { type: "BEGIN_CAPTURE", key, ...capture }) };
    }
    function localReject(state: RunState, reason: "too-short" | "no-speech") {
      const begun = begin(state);
      return step(begun.state, { type: "LOCAL_REJECT", key: begun.key, reason });
    }
    const copy = { "too-short": "Too short · try once more", "no-speech": "Didn't catch anything" } as const;

    for (const reason of ["too-short", "no-speech"] as const) {
      for (const [where, before, phase] of [
        ["ready", runV2Fixtures.ready.run, "ready"],
        ["unjudged re-record", runV2Fixtures.verdictNoMatch.run, "feedback"],
        ["rescue", runV2Fixtures.rescueLoaded.run, "rescue"],
      ] as const) {
        const callbacks = handlers();
        const rejected = localReject(before, reason);
        expect(rejected.phase, where).toBe(phase);
        expect(rejected.budgetUsed, where).toBe(before.budgetUsed);
        expect(rejected.extraUsed, where).toBe(before.extraUsed);
        expect(rejected.hearts, where).toBe(before.hearts);

        const view = renderRun(rejected, callbacks);
        expect(status(view.container).getByText(copy[reason])).toBeInTheDocument();
        expect(liveRegion(view.container)).toBe(copy[reason]);
        // The stale no-match outcome gives way to the newer rejection.
        expect(screen.queryByText("Didn't catch any speech that time.")).not.toBeInTheDocument();
        const fallback = screen.queryByRole("button", { name: "Use manual Stop" });
        if (reason === "no-speech") {
          expect(fallback, where).toBeEnabled();
          fireEvent.click(fallback as HTMLElement);
          expect(callbacks.onUseManualStop).toHaveBeenCalledTimes(1);
        } else {
          expect(fallback, where).toBeNull();
        }

        // The next capture clears it.
        view.rerender(<PracticeRun {...practiceRunProps(begin(rejected).state, callbacks)} />);
        expect(screen.queryByText(copy[reason])).not.toBeInTheDocument();
        view.unmount();
      }
    }
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
    expect(screen.getByText("Both readings below 60 · one heart used")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 of 2 hearts left" })).toBeInTheDocument();
  });

  it("a rejection left on the last item never hides the summary announcement", () => {
    function rejectNow(state: RunState, kind: "too-short" | "no-speech" | "server") {
      const capture = nextCapture(state);
      if (!capture) throw new Error("no capture available");
      const key = { runId: state.runId, itemId: state.items[state.index].prompt.itemId, attemptId: `end-${++counter}` };
      const begun = step(state, { type: "BEGIN_CAPTURE", key, ...capture });
      if (kind !== "server") return step(begun, { type: "LOCAL_REJECT", key, reason: kind });
      const sent = step(step(begun, { type: "BLOB_READY", key, blob: new Blob(["audio"]) }), { type: "SCORE_SENT", key });
      return step(sent, { type: "SCORE_FAILED", key, failure: { kind: "rejected", message: "Recording too short." } });
    }

    for (const kind of ["too-short", "no-speech", "server"] as const) {
      for (const ending of ["final skip", "quit"] as const) {
        // The controller's consumed set is live and never re-renders on its own.
        const consumed = new Set<string>();
        const live = { consumedFeedbackIds: consumed, onFeedbackConsumed: (id: string) => void consumed.add(id) };
        let run = ending === "final skip" ? start("route") : start("challenge");
        if (ending === "final skip") {
          for (let i = 0; i < 5; i += 1) run = step(run, { type: "SKIP", runId: run.runId, itemId: run.items[run.index].prompt.itemId });
        }
        run = rejectNow(run, kind);
        const view = renderRun(run, live);
        expect(liveRegion(view.container), `${kind}/${ending}`).toMatch(/Too short|Didn't catch anything|didn't count/);

        const ended =
          ending === "final skip"
            ? step(run, { type: "SKIP", runId: run.runId, itemId: run.items[run.index].prompt.itemId })
            : step(run, { type: "QUIT", runId: run.runId });
        expect(ended.phase).toBe("summary");
        expect(ended.items[ended.index].lastRejection).not.toBeNull();
        view.rerender(<PracticeRun {...practiceRunProps(ended, live)} />);
        const expected = ending === "final skip" ? /^Route complete\. 0 points\. Not rated/ : /^Challenge incomplete\. 0 points\. Not rated/;
        expect(liveRegion(view.container), `${kind}/${ending}`).toMatch(expected);
        // Its own event: the same summary does not change on a later render.
        const text = liveRegion(view.container);
        view.rerender(<PracticeRun {...practiceRunProps({ ...ended }, live)} />);
        expect(liveRegion(view.container)).toBe(text);
        view.unmount();
      }
    }
  });

  it("rescue keeps the current word or sentence on screen before and after the reference loads", () => {
    const prompt = (container: HTMLElement) => container.querySelector(".run-middle .run-prompt-v2");
    const word = renderRun(runV2Fixtures.rescue.run);
    expect(prompt(word.container)).toHaveTextContent("those");
    word.rerender(<PracticeRun {...practiceRunProps(runV2Fixtures.rescueLoaded.run)} />);
    expect(prompt(word.container)).toHaveTextContent("those");
    expect(screen.getByRole("heading", { name: "One more listen" })).toBeInTheDocument();
    word.unmount();

    let sentence = start("challenge");
    for (let i = 0; i < 4; i += 1) sentence = advance(score(sentence, 90));
    sentence = score(sentence, 40);
    expect(sentence.phase).toBe("rescue");
    const view = renderRun(sentence);
    expect(prompt(view.container)).toHaveTextContent("I think we can walk home now.");
    const loaded = step(
      step(sentence, { type: "REFERENCE_CLICKED", runId: sentence.runId, itemId: "context-1" }),
      { type: "REFERENCE_LOADED", runId: sentence.runId, itemId: "context-1", ok: true }
    );
    view.rerender(<PracticeRun {...practiceRunProps(loaded)} />);
    expect(prompt(view.container)).toHaveTextContent("I think we can walk home now.");
    expect(screen.getByRole("button", { name: "Record again" })).toBeEnabled();
  });

  it("feedback without a score announces its outcome once", () => {
    const unjudgedSent = send(start("route"));
    const unjudged = step(unjudgedSent.state, {
      type: "SCORE_RECEIVED",
      key: unjudgedSent.key,
      response: { result: { ...response(70).result, words: [] }, session: null },
    });
    const low = score(start("challenge"), 40);
    const failedReference = step(
      step(low, { type: "REFERENCE_CLICKED", runId: low.runId, itemId: "warmup-1" }),
      { type: "REFERENCE_LOADED", runId: low.runId, itemId: "warmup-1", ok: false }
    );
    const pending = fail(start("challenge"), { kind: "unknown", message: "network" });

    for (const [run, verdict, text] of [
      [runV2Fixtures.verdictNoMatch.run, "no-match", "Didn't catch any speech that time. You can try again."],
      [unjudged, "unjudged", "Couldn't score that one cleanly. You can try again."],
      [failedReference, "cannot-confirm", "Couldn't load the reference · not confirmed. No heart lost."],
      [pending, "pending", "Still waiting on that score. You can keep going."],
    ] as const) {
      expect(run.phase).toBe("feedback");
      expect(run.items[run.index].verdict).toBe(verdict);
      const view = renderRun(run);
      expect(view.container.querySelectorAll("[aria-live]")).toHaveLength(1);
      expect(liveRegion(view.container)).toBe(text);
      // Same event, new object: the announcement neither repeats nor changes.
      view.rerender(<PracticeRun {...practiceRunProps({ ...run })} />);
      expect(liveRegion(view.container)).toBe(text);
      expect(liveRegion(view.container)).not.toMatch(/resend|timed out/i);
      view.unmount();
    }
  });

  it("the ready ring breathes unless the run is paused or motion is reduced", () => {
    const ready = runV2Fixtures.ready.run;
    const normal = renderRun(ready);
    expect(ring(normal.container)).not.toHaveClass("is-settled");
    expect(ring(normal.container)).not.toHaveClass("is-reduced");
    normal.unmount();

    const paused = renderRun(step(ready, { type: "PAUSE", runId: ready.runId }));
    expect(ring(paused.container)).toHaveClass("is-settled");
    paused.unmount();

    const reduced = renderRun(ready, { reducedMotion: true });
    expect(ring(reduced.container)).toHaveClass("is-reduced");
    reduced.unmount();

    // Recording and scoring are never treated as consumed feedback either.
    for (const run of [runV2Fixtures.recording.run, runV2Fixtures.scoring.run]) {
      const view = renderRun(run);
      expect(ring(view.container)).not.toHaveClass("is-settled");
      view.unmount();
    }
  });

  it("live telemetry drives the ring while the run follows only the auto-stop state", () => {
    const recording = runV2Fixtures.recording;
    const props = practiceRunProps(recording.run, { telemetry: recording.ring.telemetry });
    const { container } = render(<PracticeRun {...props} />);
    expect(container.querySelector(".run-ring-silence")).toHaveStyle({ strokeDasharray: "0.35 1" });
    expect(screen.getByText("Speak. I'll stop for you.")).toBeInTheDocument();

    act(() => props.telemetryStore.set({ ...recording.ring.telemetry, silenceProgress: 0.8, level: 0.2 }));
    expect(container.querySelector(".run-ring-silence")).toHaveStyle({ strokeDasharray: "0.8 1" });
    act(() => props.telemetryStore.set({ ...recording.ring.telemetry, autoStopState: "fallback" }));
    expect(screen.getByText("Noisy · tap Stop")).toBeInTheDocument();
    expect(liveRegion(container)).toBe("Recording. Noisy, tap Stop.");
  });

  it("summary revisit plays the word and play again states its cost", () => {
    const onPlayRevisit = vi.fn();
    const rated = runV2Fixtures.summaryRated;
    const view = renderRun(rated.run, { receipt: rated.receipt, reducedMotion: true, onPlayRevisit, scoresLeft: 14 });
    fireEvent.click(screen.getByRole("button", { name: "Hear birds" }));
    expect(onPlayRevisit).toHaveBeenCalledWith(expect.objectContaining({ kind: "word", text: "birds" }));
    expect(screen.getByText("Play again uses up to 8 new scores · 14 left today")).toBeInTheDocument();
    view.unmount();

    renderRun(rated.run, { receipt: rated.receipt, reducedMotion: true });
    expect(screen.getByText("Play again uses up to 8 new scores")).toBeInTheDocument();
  });

  it("the quit dialog contains focus and leaves the run behind it unreachable", async () => {
    // Keyboard simulation needs real time; nothing here is timed.
    vi.useRealTimers();
    const user = userEvent.setup();
    const callbacks = handlers();
    const paused = step(runV2Fixtures.ready.run, { type: "PAUSE", runId: runV2Fixtures.ready.run.runId });
    const { container } = renderRun(paused, callbacks);
    const resume = screen.getByRole("button", { name: "Resume" });
    await user.click(screen.getByRole("button", { name: "Quit run" }));
    const dialog = screen.getByRole("alertdialog", { name: "End this run?" });
    const keep = within(dialog).getByRole("button", { name: "Keep paused" });
    const end = within(dialog).getByRole("button", { name: "End run" });
    expect(keep).toHaveFocus();

    // Reverse and forward Tab wrap inside the dialog.
    await user.tab({ shift: true });
    expect(end).toHaveFocus();
    await user.tab();
    expect(keep).toHaveFocus();
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    // Everything behind it is inert, except the live region that keeps announcing.
    expect(resume.closest("[inert]")).not.toBeNull();
    expect(container.querySelector(".run-bar")?.closest("[inert]")).not.toBeNull();
    expect(container.querySelector("[aria-live]")?.closest("[inert]")).toBeNull();
    await user.keyboard("{Enter}");
    expect(callbacks.onResume).not.toHaveBeenCalled();

    // Escape closes it, lifts the inert background and returns focus to Quit run.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(container.querySelector("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Quit run" })).toHaveFocus();
    expect(callbacks.onQuit).not.toHaveBeenCalled();
  });

  it("the quit dialog closes on Escape and keeps the run", () => {
    const callbacks = handlers();
    const paused = step(runV2Fixtures.ready.run, { type: "PAUSE", runId: runV2Fixtures.ready.run.runId });
    renderRun(paused, callbacks);
    fireEvent.click(screen.getByRole("button", { name: "Quit run" }));
    const dialog = screen.getByRole("alertdialog", { name: "End this run?" });
    expect(within(dialog).getByRole("button", { name: "Keep paused" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quit run" })).toHaveFocus();
    expect(callbacks.onQuit).not.toHaveBeenCalled();
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
    expect(callbacks.onQuit).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "End this run?" })).getByRole("button", { name: "End run" }));
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
    const view = renderRun(pending, callbacks);
    expect(status(view.container).getByText("Still waiting on that score. You can keep going.")).toBeInTheDocument();
    expect(ringScore(document.body)).toBe("40");
    expect(screen.getByLabelText(/1\. water: first reading Re-listen 40, result pending/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record next" })).toBeEnabled();
  });

  describe("Game Mode v3 run screens", () => {
    const title = (container: HTMLElement) => container.querySelector(".run-bar-title")?.textContent;

    it("route_hear_first_does_not_block_record", () => {
      const callbacks = handlers();
      const ready = runV3Fixtures.route12Ready.run;
      const view = renderRun(ready, callbacks);
      expect(title(view.container)).toBe("Route · 12 items · /θ/");
      expect(view.container.querySelector(".run-stage-label")).toHaveTextContent("6 / 12 · Focus");
      expect(status(view.container).getByText("Optional · Record works any time")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Hear it first" }));
      expect(callbacks.onHearFirst).toHaveBeenCalledTimes(1);
      expect(callbacks.onPlayReference).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();

      // Loading: the capsule waits, Record never does.
      const itemId = ready.items[ready.index].prompt.itemId;
      const loading = step(ready, { type: "REFERENCE_CLICKED", runId: ready.runId, itemId });
      view.rerender(<PracticeRun {...practiceRunProps(loading, callbacks)} />);
      expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Record" }));
      expect(callbacks.onRecord).toHaveBeenCalledTimes(1);

      // Failure: readable, retryable, and still no block on Record.
      const failed = step(loading, { type: "REFERENCE_LOADED", runId: ready.runId, itemId, ok: false });
      view.rerender(<PracticeRun {...practiceRunProps(failed, callbacks)} />);
      expect(status(view.container).getByText("Couldn't load it · Record works any time")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Hear it first" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
    });

    it("route_record_next_and_hear_next_first_are_distinct", () => {
      const callbacks = handlers();
      const view = renderRun(runV3Fixtures.route12Feedback.run, callbacks);
      expect(view.container.querySelector(".run-next-v2")).toHaveTextContent("Next · Focusthree");
      fireEvent.click(screen.getByRole("button", { name: "Record next" }));
      fireEvent.click(screen.getByRole("button", { name: "Hear next first" }));
      expect(callbacks.onRecordNext).toHaveBeenCalledTimes(1);
      expect(callbacks.onHearNextFirst).toHaveBeenCalledTimes(1);
      expect(callbacks.onPlayReference).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Hear it again" })).not.toBeInTheDocument();
      view.unmount();

      // The last item finishes; with nothing next, the secondary replays this item.
      renderRun(runV3Fixtures.route12LastFeedback.run, callbacks);
      expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Hear next first" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Hear it again" }));
      expect(callbacks.onPlayReference).toHaveBeenCalledTimes(1);
    });

    it("challenge_controls_unchanged", () => {
      const callbacks = handlers();
      const view = renderRun(runV3Fixtures.target85Passed.run, callbacks);
      expect(title(view.container)).toBe("Challenge · Target 85 · /θ/");
      fireEvent.click(screen.getByRole("button", { name: "Hear it again" }));
      expect(callbacks.onPlayReference).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Record next" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Hear next first" })).not.toBeInTheDocument();
      view.unmount();

      // Challenge Ready has no listen-first capsule.
      const ready = renderRun(advance(runV3Fixtures.target85Passed.run), callbacks);
      expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Hear it first" })).not.toBeInTheDocument();
      expect(ready.container.querySelector(".run-status-hint")).toBeNull();
      ready.unmount();

      renderRun(runV3Fixtures.route6Ready.run);
      expect(screen.getByText("Route · 6 items · /θ/")).toBeInTheDocument();
    });

    it("target85_good_tier_and_rescue_status_are_separate", () => {
      const view = renderRun(runV3Fixtures.target85Rescue.run);
      expect(ringScore(view.container)).toBe("80");
      expect(ring(view.container)).toHaveAttribute("data-tier", "good");
      expect(view.container.querySelector(".run-ring-tier")).toHaveTextContent("Good");
      expect(screen.getByRole("heading", { name: "One more listen" })).toBeInTheDocument();
      expect(screen.getByText("No heart lost yet")).toBeInTheDocument();
      expect(view.container.querySelector(".run-target-line")).toHaveTextContent(
        "Below this run's target 85 ·listen, then read again"
      );
      view.unmount();

      // 80 → 88: the heart is kept, the ring shows the rescue's Great, the first reading still scores.
      const saved = renderRun(runV3Fixtures.target85Saved.run, { reducedMotion: true });
      expect(ringScore(saved.container)).toBe("88");
      expect(saved.container.querySelector(".run-ring-tier")).toHaveTextContent("Great");
      expect(status(saved.container).getByText("Heart kept · 80 → 88")).toBeInTheDocument();
      expect(screen.getByLabelText("3. think: first reading Good 80, rescued")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "2 of 2 hearts left" })).toBeInTheDocument();
      saved.unmount();

      // 84.9 is below 85 and keeps its decimal; a rescue at 85 is Great.
      const boundary = renderRun(runV3Fixtures.target85Boundary.run);
      expect(status(boundary.container).getByText("Heart kept · 84.9 → 85")).toBeInTheDocument();
    });

    it("target85_relisten_verdict_never_labels_80_relisten", () => {
      const rescue = runV3Fixtures.target85Rescue.run;
      // The reducer's verdict for the first 80 is relisten; nothing shown may say so.
      expect(rescue.items[rescue.index].verdict).toBe("relisten");
      const view = renderRun(rescue);
      expect(view.container).not.toHaveTextContent(/re-listen/i);
      expect(liveRegion(view.container)).not.toMatch(/re-listen/i);
      expect(screen.getByLabelText("3. think: first reading Good 80")).toBeInTheDocument();
      view.unmount();

      const lost = renderRun(runV3Fixtures.target85HeartLost.run);
      expect(lost.container).not.toHaveTextContent(/re-listen/i);
      expect(liveRegion(lost.container)).not.toMatch(/re-listen/i);
    });

    it("target85_both_good_readings_can_lose_one_heart", () => {
      const view = renderRun(runV3Fixtures.target85HeartLost.run, { reducedMotion: true });
      expect(ringScore(view.container)).toBe("82");
      expect(view.container.querySelector(".run-ring-tier")).toHaveTextContent("Good");
      const readings = view.container.querySelector(".run-readings");
      expect(readings).toHaveTextContent("80 → 82");
      expect(readings).toHaveAttribute("data-tier", "good");
      expect(status(view.container).getByText("Both readings below 85 · one heart used")).toBeInTheDocument();
      expect(status(view.container).getByText("Both takes are saved for the review.")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "1 of 2 hearts left" })).toBeInTheDocument();
      expect(screen.getByLabelText("3. think: first reading Good 80, one heart used")).toBeInTheDocument();
      // Challenge keeps its fast path after a heart loss.
      expect(screen.getByRole("button", { name: "Record next" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Hear it again" })).toBeEnabled();
    });

    it("cannot_confirm_distinguishes_rescue_unjudged_and_reference_failure", () => {
      for (const [fixture, reason, text] of [
        [runV3Fixtures.target85Exhausted, "rescue-budget", "No rescue scores left · not confirmed. No heart lost."],
        [
          runV3Fixtures.target85UnjudgedEmpty,
          "unjudged-budget",
          "No extra scores left · this item has no valid reading. No heart lost."
        ],
        [
          runV3Fixtures.target85ReferenceFailed,
          "reference-unavailable",
          "Couldn't load the reference · not confirmed. No heart lost."
        ]
      ] as const) {
        const item = fixture.run.items[fixture.run.index];
        expect(item.cannotConfirmReason).toBe(reason);
        const view = renderRun(fixture.run);
        expect(status(view.container).getByText(text)).toBeInTheDocument();
        expect(liveRegion(view.container)).toBe(text);
        // No heart is charged and no second low reading is shown.
        expect(screen.getByRole("img", { name: "2 of 2 hearts left" })).toBeInTheDocument();
        expect(view.container.querySelector(".run-readings")).toBeNull();
        expect(view.container.querySelector(".run-stone-crack")).toBeNull();
        view.unmount();
      }
    });

    it("single_announcement_uses_final_target_tier_and_points", () => {
      for (const [fixture, text] of [
        [runV3Fixtures.target85Rescue, "80. Good. Below this run's target 85. Listen, then read again. No heart lost yet."],
        [runV3Fixtures.target85HeartLost, "82. Good. Both readings below 85. One heart used."],
        [runV3Fixtures.target85Saved, "88. Great. Heart kept."],
        [runV3Fixtures.route12Feedback, "88. Great. Chain 3."]
      ] as const) {
        const view = renderRun(fixture.run);
        expect(view.container.querySelectorAll("[aria-live]")).toHaveLength(1);
        expect(liveRegion(view.container)).toBe(text);
        view.rerender(<PracticeRun {...practiceRunProps({ ...fixture.run })} />);
        expect(liveRegion(view.container)).toBe(text);
        view.unmount();
      }

      // First-reading points come from the planned-twelve selector, shown once on the feedback.
      const feedback = renderRun(runV3Fixtures.route12Feedback.run);
      const item = runV3Fixtures.route12Feedback.score.items[5];
      expect(feedback.container.querySelector(".run-points-base")).toHaveTextContent(`+${Math.round(item.basePoints)}`);
      expect(feedback.container.querySelector(".run-points .run-chain-chip")).toHaveTextContent(
        `×3 in a row +${Math.round(item.chainPoints)}`
      );
      expect(Math.round(item.basePoints)).toBe(66);
    });

    it("v2_local_reject_stop_guard_and_live_controls_hold", () => {
      const callbacks = handlers();
      const ready = runV3Fixtures.route12Ready.run;
      const capture = nextCapture(ready);
      if (!capture) throw new Error("no capture");
      const key = { runId: ready.runId, itemId: ready.items[ready.index].prompt.itemId, attemptId: "thank-take1" };
      const recording = step(step(ready, { type: "BEGIN_CAPTURE", key, ...capture }), { type: "BLOB_READY", key, blob: new Blob(["a"]) });
      // While recording, Stop and Cancel take stay live and the capsule is gone.
      const view = renderRun(step(ready, { type: "BEGIN_CAPTURE", key, ...capture }), callbacks);
      expect(screen.queryByRole("button", { name: "Hear it first" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel take" }));
      expect(callbacks.onStop).toHaveBeenCalledTimes(1);
      expect(callbacks.onCancelTake).toHaveBeenCalledTimes(1);

      // A local no-speech reject returns to Ready with Use manual Stop beside Hear it first.
      const rejected = step(recording, { type: "LOCAL_REJECT", key, reason: "no-speech" });
      view.rerender(<PracticeRun {...practiceRunProps(rejected, callbacks)} />);
      expect(screen.getByRole("button", { name: "Hear it first" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Use manual Stop" }));
      expect(callbacks.onUseManualStop).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
      expect(rejected.extraUsed).toBe(0);
    });
  });
});

