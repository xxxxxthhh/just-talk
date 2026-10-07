import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { nextCapture, runReducer } from "../game/runModel";
import type { RunMode, RunPrompt, RunState, ScoreResponse, WordCandidate, WordResult } from "../types";
import { PracticeRun } from "./PracticeRun";
import { RunReview } from "./RunReview";

const PROMPTS: RunPrompt[] = [
  ["warmup-1", "warmup", "word", "room"],
  ["warmup-2", "warmup", "word", "late"],
  ["focus-1", "focus", "word", "think"],
  ["focus-2", "focus", "word", "thank"],
  ["context-1", "context", "sentence", "A river runs beside the quiet town."],
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
  return runReducer(null, { type: "START", runId: `review-run-${++counter}`, mode, prompts: PROMPTS }) as RunState;
}

function word(text: string, accuracy: number, phoneme = "ə", phonemeAccuracy = accuracy): WordResult {
  return {
    word: text,
    accuracy,
    bucket: "watch",
    error_type: "None",
    offset_ms: 0,
    duration_ms: 300,
    phonemes: [{ phoneme, accuracy: phonemeAccuracy, bucket: "watch", offset_ms: 0, duration_ms: 100, n_best: [] }],
  };
}

function response(accuracy: number, words: WordResult[], sessionId: string | null = null): ScoreResponse {
  return {
    result: {
      transcript: words.map((candidate) => candidate.word).join(" "),
      scores: { accuracy, fluency: null, completeness: null, prosody: null, pronunciation: null },
      words,
      raw: null,
    },
    session: sessionId
      ? {
          id: sessionId,
          created_at: "2026-10-07T00:00:00Z",
          reference_text: "",
          audio_duration_ms: 1000,
          scores: { accuracy, fluency: null, completeness: null, prosody: null, pronunciation: null },
        }
      : null,
  };
}

function score(state: RunState, scored: ScoreResponse) {
  const capture = nextCapture(state);
  if (!capture) throw new Error("no capture available");
  const key = { runId: state.runId, itemId: state.items[state.index].prompt.itemId, attemptId: `r-${++counter}` };
  let next = runReducer(state, { type: "BEGIN_CAPTURE", key, ...capture }) as RunState;
  next = runReducer(next, { type: "BLOB_READY", key, blob: new Blob(["audio"]) }) as RunState;
  next = runReducer(next, { type: "SCORE_SENT", key }) as RunState;
  return { key, state: runReducer(next, { type: "SCORE_RECEIVED", key, response: scored }) as RunState };
}

function advance(state: RunState): RunState {
  return runReducer(state, { type: "ADVANCE", runId: state.runId, itemId: state.items[state.index].prompt.itemId }) as RunState;
}

function act(state: RunState, type: "SKIP" | "QUIT"): RunState {
  const itemId = state.items[state.index].prompt.itemId;
  return runReducer(state, type === "QUIT" ? { type, runId: state.runId } : { type, runId: state.runId, itemId }) as RunState;
}

function settle(state: RunState, key: { runId: string; itemId: string; attemptId: string }, candidates: WordCandidate[], failed = false) {
  return runReducer(state, { type: "SYNC_SETTLED", key, candidates, failed }) as RunState;
}

function renderReview(run: RunState, overrides: Partial<Parameters<typeof RunReview>[0]> = {}) {
  const props = {
    run,
    attemptAudioUrls: {},
    publicMode: false,
    drillsEnabled: false,
    onPlayReference: vi.fn(),
    onPlayAgain: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<RunReview {...props} />) };
}

describe("RunReview", () => {
  it("review_limits_actions_to_real_evidence_and_matching_attempt_audio", () => {
    let run = start("route");
    run = advance(score(run, response(40, [word("room", 40, "ɹ", 35)])).state);
    run = advance(score(run, response(55, [word("late", 55)])).state);
    run = act(run, "SKIP");
    run = act(run, "QUIT");

    const first = renderReview(run);
    const actions = within(screen.getByRole("list", { name: "What to practice next" })).getAllByRole("listitem");
    expect(actions.map((item) => item.textContent)).toEqual(["Re-listen and repeat: room, late."]);
    expect(screen.getByText("Practiced 2 of 6")).toBeInTheDocument();
    expect(screen.getByText("Skipped 1")).toBeInTheDocument();
    expect(screen.getByText("Not reached 2")).toBeInTheDocument();
    expect(screen.getByText("Unresolved 1")).toBeInTheDocument();
    first.unmount();

    // Repeated low phoneme across two items, then low words, then borderline words; at most three.
    let evidence = start("route");
    evidence = advance(score(evidence, response(45, [word("room", 45, "ɹ", 30)])).state);
    evidence = advance(score(evidence, response(72, [word("late", 72)])).state);
    evidence = advance(evidence);
    evidence = advance(evidence);
    evidence = advance(evidence);
    evidence = score(evidence, response(65, [word("river", 50, "ɹ", 40), word("town", 75)])).state;
    const { unmount } = renderReview(evidence);
    const listed = within(screen.getByRole("list", { name: "What to practice next" })).getAllByRole("listitem");
    expect(listed.map((item) => item.textContent)).toEqual([
      "The /ɹ/ sound was low in more than one item: room, river.",
      "Re-listen and repeat: room, river.",
      "Almost there: late, town.",
    ]);
    unmount();

    let clean = start("route");
    clean = score(clean, response(95, [word("room", 95)])).state;
    const cleanView = renderReview(clean);
    expect(screen.queryByRole("list", { name: "What to practice next" })).not.toBeInTheDocument();
    cleanView.unmount();

    // A rescue keeps both recordings, each beside its own score.
    const low = score(start("challenge"), response(40, [word("room", 40)]));
    const itemId = "warmup-1";
    let rescued = runReducer(low.state, { type: "REFERENCE_CLICKED", runId: low.state.runId, itemId }) as RunState;
    rescued = runReducer(rescued, { type: "REFERENCE_LOADED", runId: rescued.runId, itemId, ok: true }) as RunState;
    const rescue = score(rescued, response(75, [word("room", 75)]));
    renderReview(act(rescue.state, "QUIT"), {
      attemptAudioUrls: { [low.key.attemptId]: "blob:first", [rescue.key.attemptId]: "blob:rescue" },
    });
    const attempts = screen.getAllByText(/^(40|75)$/).map((label) => label.closest(".run-review-attempt") as HTMLElement);
    expect(within(attempts[0]).getByText("40")).toBeInTheDocument();
    expect(attempts[0].querySelector("audio")).toHaveAttribute("src", "blob:first");
    expect(within(attempts[1]).getByText("75")).toBeInTheDocument();
    expect(attempts[1].querySelector("audio")).toHaveAttribute("src", "blob:rescue");
  });

  it("review_shows_candidate_status_without_added_count_or_save_action", () => {
    let run = start("route");
    for (let i = 0; i < 4; i += 1) run = act(run, "SKIP");
    const sentence = score(run, response(62, [word("river", 50), word("town", 68)], "session-1"));
    run = settle(sentence.state, sentence.key, [
      { word: "river", status: "processed" },
      { word: "town", status: "unconfirmed" },
    ]);
    run = advance(run);
    const failed = score(run, response(70, [word("path", 66)], "session-2"));
    run = advance(settle(failed.state, failed.key, [], true));

    renderReview(run);
    expect(screen.getByText("river · sent to word bank")).toBeInTheDocument();
    expect(screen.getByText("town · not confirmed")).toBeInTheDocument();
    expect(screen.getByText("Couldn't sync these words. Save them manually.")).toBeInTheDocument();
    expect(screen.queryByText(/added/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("route_and_public_mode_hide_inapplicable_controls", () => {
    const route = score(start("route"), response(50, [word("room", 50)])).state;
    const onGenerateDrill = vi.fn();

    const publicView = renderReview(route, { publicMode: true, drillsEnabled: true, onGenerateDrill });
    expect(screen.queryByText(/hearts left/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cleared|Incomplete|Out of hearts/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate a drill/ })).not.toBeInTheDocument();
    publicView.unmount();

    const unconfigured = renderReview(route, { publicMode: false, drillsEnabled: false, onGenerateDrill });
    expect(screen.queryByRole("button", { name: /Generate a drill/ })).not.toBeInTheDocument();
    unconfigured.unmount();

    const personal = renderReview(route, { publicMode: false, drillsEnabled: true, onGenerateDrill });
    fireEvent.click(screen.getByRole("button", { name: "Generate a drill for /θ/" }));
    expect(onGenerateDrill).toHaveBeenCalledWith("θ");
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(personal.props.onPlayAgain).toHaveBeenCalledTimes(1);
    personal.unmount();

    const challenge = act(score(start("challenge"), response(90, [word("room", 90)])).state, "QUIT");
    const challengeView = renderReview(challenge);
    expect(screen.getByText("Incomplete · 2 of 2 hearts left")).toBeInTheDocument();
    challengeView.unmount();

    const runCallbacks = {
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
    const routeRun = render(<PracticeRun run={start("route")} {...runCallbacks} />);
    expect(screen.queryByLabelText(/hearts left/)).not.toBeInTheDocument();
    routeRun.unmount();
    render(<PracticeRun run={start("challenge")} {...runCallbacks} />);
    expect(screen.getByLabelText("2 of 2 hearts left")).toBeInTheDocument();
  });
});
