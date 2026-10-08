import { act as flush, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configForChoice } from "../game/runConfig";
import { nextCapture, runReducer } from "../game/runModel";
import { selectReviewSuggestions, selectRunScore } from "../game/scoring";
import type { RunMode, RunPrompt, RunState, ScoreResponse, WordCandidate, WordResult } from "../types";
import { PracticeRun } from "./PracticeRun";
import { practiceRunProps, runV2Fixtures } from "./runV2Fixtures";
import { runV3Fixtures } from "./runV3Fixtures";
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
  return runReducer(null, {
    type: "START",
    runId: `review-run-${++counter}`,
    config: configForChoice({ selection: mode === "route" ? "route" : "target60", routeLength: 6 }),
    prompts: PROMPTS
  }) as RunState;
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

function readSuggestions() {
  const list = screen.getByRole("list", { name: "What to practice next" });
  return [...list.children].map((card) => ({
    summary: card.querySelector(".run-suggestion-summary")?.textContent,
    evidence: [...card.querySelectorAll(".run-evidence-v2 > li")].map(
      (row) =>
        `${row.querySelector(".run-evidence-word")?.textContent} ${row.querySelector(".run-evidence-score strong")?.textContent} ${row.querySelector(".run-evidence-score span")?.textContent}`
    ),
  }));
}

function renderReview(run: RunState, overrides: Partial<Parameters<typeof RunReview>[0]> = {}) {
  const props = {
    run,
    score: selectRunScore(run),
    suggestions: selectReviewSuggestions(run),
    attemptAudioUrls: {},
    coach: { text: "", status: "idle" as const },
    publicMode: false,
    drillsEnabled: false,
    onPlayReference: vi.fn(),
    onStopReference: vi.fn(),
    onPlayAgain: vi.fn(),
    starting: false,
    replayFailed: false,
    onExit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<RunReview {...props} />) };
}

let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function reading(text: string): HTMLElement {
  const row = screen.getByText(text, { selector: ".run-reading .run-prompt-text" }).closest("li");
  if (!row) throw new Error(`no reading for ${text}`);
  return row;
}

describe("RunReview", () => {
  it("review_deduplicates_suggestions_and_preserves_score_source", () => {
    // Two items share a low /ɹ/; the low and borderline words come from the same takes.
    let evidence = start("route");
    evidence = advance(score(evidence, response(45, [word("room", 45, "ɹ", 30)])).state);
    const late = score(evidence, response(72, [word("late", 72)]));
    evidence = advance(late.state);
    evidence = act(evidence, "SKIP");
    evidence = act(evidence, "SKIP");
    const river = score(evidence, response(65, [word("river", 50, "ɹ", 40), word("town", 75)]));
    renderReview(act(river.state, "QUIT"), {
      attemptAudioUrls: { [late.key.attemptId]: "blob:late", [river.key.attemptId]: "blob:river" },
    });

    // Each take backs one card only, and each score says whether it is a sound or a word score.
    expect(readSuggestions()).toEqual([
      {
        summary: "The /ɹ/ sound was low in 2 items.",
        evidence: ["/ɹ/ in “room” 30 sound score", "/ɹ/ in “river” 40 sound score"],
      },
      { summary: "Almost there.", evidence: ["late 72 word score"] },
    ]);
    const suggestions = screen.getByRole("list", { name: "What to practice next" });
    expect(within(suggestions).getAllByRole("button", { name: "Play your take of river" })).toHaveLength(1);
    // The sentence take shows its word scores and its own sentence score, labelled.
    expect(within(suggestions).getByRole("list", { name: "Word scores" })).toHaveTextContent("river 50town 75sentence 65");

    // All readings link to those players instead of adding a second one for the same take.
    const riverRow = reading("A river runs beside the quiet town.");
    expect(within(riverRow).queryByRole("button", { name: /Play your take/ })).not.toBeInTheDocument();
    expect(within(riverRow).getByRole("button", { name: "Listen in What to practice next" })).toBeInTheDocument();
    expect(within(riverRow).getByRole("button", { name: /Play coach reference/ })).toBeInTheDocument();
  });

  it("rescue_takes_keep_matching_audio_and_scores", () => {
    const low = score(start("challenge"), response(40, [word("room", 40)]));
    const itemId = "warmup-1";
    let rescued = runReducer(low.state, { type: "REFERENCE_CLICKED", runId: low.state.runId, itemId }) as RunState;
    rescued = runReducer(rescued, { type: "REFERENCE_LOADED", runId: rescued.runId, itemId, ok: true }) as RunState;
    const rescue = score(rescued, response(90, [word("room", 90)]));
    const view = renderReview(act(rescue.state, "QUIT"), {
      attemptAudioUrls: { [low.key.attemptId]: "blob:first", [rescue.key.attemptId]: "blob:rescue" },
    });

    const row = reading("room");
    // The row keeps the first reading as its score and lists both takes with their own scores.
    expect(within(row).getByText("Re-listen")).toBeInTheDocument();
    expect(within(row).getByText("Rescued · heart kept")).toBeInTheDocument();
    const takes = within(row).getByRole("list", { name: "Takes of room" });
    expect(within(takes).getAllByRole("listitem").map((take) => take.textContent)).toEqual(["Take 1 40", "Take 2 90"]);

    const audio = view.container.querySelector("audio");
    fireEvent.click(within(row).getByRole("button", { name: "Play your take of room, Take 2 · 90" }));
    expect(audio).toHaveAttribute("src", "blob:rescue");
    fireEvent.click(within(row).getByRole("button", { name: "Take 1 · 40" }));
    fireEvent.click(within(row).getByRole("button", { name: "Play your take of room, Take 1 · 40" }));
    expect(audio).toHaveAttribute("src", "blob:first");
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("review_unmount_stops_audio_without_revoking_controller_urls", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const room = score(start("route"), response(90, [word("room", 90)]));
    const view = renderReview(act(room.state, "QUIT"), { attemptAudioUrls: { [room.key.attemptId]: "blob:room" } });
    fireEvent.click(screen.getByRole("button", { name: "Play your take of room" }));
    const pauses = pause.mock.calls.length;
    view.unmount();
    expect(pause.mock.calls.length).toBeGreaterThan(pauses);
    expect(view.props.onStopReference).toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();

    // Done and Play again also stop both voices before leaving.
    const again = renderReview(act(room.state, "QUIT"), { attemptAudioUrls: { [room.key.attemptId]: "blob:room" } });
    fireEvent.click(screen.getByRole("button", { name: "Play your take of room" }));
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(again.container.querySelector("audio")).not.toHaveAttribute("src");
    expect(again.props.onStopReference).toHaveBeenCalled();
    expect(again.props.onPlayAgain).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("hiding the page stops review playback, and returning never replays", async () => {
    const room = score(start("route"), response(90, [word("room", 90)]));
    const ended = act(room.state, "QUIT");
    const stopReference = vi.fn();
    // The controller hands over a new stop function on every render.
    const props = () => ({ attemptAudioUrls: { [room.key.attemptId]: "blob:room" }, onStopReference: () => stopReference() });
    const view = renderReview(ended, props());
    const audio = view.container.querySelector("audio");
    const setVisibility = (state: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
      flush(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    };

    try {
      fireEvent.click(screen.getByRole("button", { name: "Play your take of room" }));
      expect(audio).toHaveAttribute("src", "blob:room");
      const pauses = pause.mock.calls.length;
      const stops = stopReference.mock.calls.length;
      setVisibility("hidden");
      expect(pause.mock.calls.length).toBeGreaterThan(pauses);
      expect(stopReference.mock.calls.length).toBeGreaterThan(stops);
      expect(audio).not.toHaveAttribute("src");
      setVisibility("visible");
      view.rerender(<RunReview {...view.props} {...props()} />);
      expect(screen.getByRole("button", { name: "Play your take of room" })).toBeEnabled();
      expect(play).toHaveBeenCalledTimes(1);

      // A play() still pending when the page hides can't bring the take back.
      let settle: () => void = () => {};
      play.mockImplementationOnce(() => new Promise<void>((resolve) => (settle = resolve)));
      fireEvent.click(screen.getByRole("button", { name: "Play your take of room" }));
      setVisibility("hidden");
      settle();
      await Promise.resolve();
      setVisibility("visible");
      expect(screen.getByRole("button", { name: "Play your take of room" })).toBeEnabled();
      expect(audio).not.toHaveAttribute("src");
      expect(play).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    }
  });

  it("unreached_collapses_and_missing_audio_has_no_player", () => {
    let run = start("route");
    run = advance(score(run, response(90, [word("room", 90)])).state);
    run = act(run, "SKIP");
    run = act(run, "QUIT");
    const view = renderReview(run);

    const unreached = view.container.querySelector("details");
    expect(unreached).not.toHaveAttribute("open");
    expect(within(unreached as HTMLElement).getByText("Not reached · 3")).toBeInTheDocument();
    // No recording URL: no You control at all, only the Coach.
    const row = reading("room");
    expect(within(row).queryByRole("button", { name: /Play your take/ })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Play coach reference of room" })).toBeInTheDocument();
    expect(within(reading("late")).getByText("Skipped")).toBeInTheDocument();

    // The stones in the bar jump to an item, opening the unreached group when needed.
    fireEvent.click(screen.getByRole("button", { name: "Go to 5. A river runs beside the quiet town." }));
    expect(view.container.querySelector("details")).toHaveAttribute("open");
  });

  it("review_keeps_candidate_and_public_drill_boundaries", () => {
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

    const candidates = renderReview(run);
    expect(screen.getByText("river · sent to word bank")).toBeInTheDocument();
    expect(screen.getByText("town · not confirmed")).toBeInTheDocument();
    expect(screen.getByText("Couldn't sync these words. Save them manually.")).toBeInTheDocument();
    expect(screen.queryByText(/added/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    candidates.unmount();

    const route = score(start("route"), response(50, [word("room", 50)])).state;
    const onGenerateDrill = vi.fn();
    const publicView = renderReview(route, { publicMode: true, drillsEnabled: true, onGenerateDrill });
    expect(screen.queryByText(/hearts left/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate a drill/ })).not.toBeInTheDocument();
    publicView.unmount();

    const unconfigured = renderReview(route, { publicMode: false, drillsEnabled: false, onGenerateDrill });
    expect(screen.queryByRole("button", { name: /Generate a drill/ })).not.toBeInTheDocument();
    unconfigured.unmount();

    const personal = renderReview(route, { publicMode: false, drillsEnabled: true, onGenerateDrill });
    fireEvent.click(screen.getByRole("button", { name: "Generate a drill for /θ/" }));
    expect(onGenerateDrill).toHaveBeenCalledWith("θ");
    expect(personal.props.onStopReference).toHaveBeenCalled();
    personal.unmount();

    const routeRun = render(<PracticeRun {...practiceRunProps(start("route"))} />);
    expect(screen.queryByLabelText(/hearts left/)).not.toBeInTheDocument();
    routeRun.unmount();
    render(<PracticeRun {...practiceRunProps(start("challenge"))} />);
    expect(screen.getByLabelText("2 of 2 hearts left")).toBeInTheDocument();
  });

  it("the score bar shows rating, points and an honest unrated line", () => {
    const rated = runV2Fixtures.review;
    const view = renderReview(rated.run);
    expect(view.container.querySelector(".run-review-rating")).toHaveTextContent("A");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("861 / 1000 · /ð/");
    expect(screen.getByText("Challenge cleared · 2 of 2 hearts left · chain 4/6")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Word scores" })).toHaveTextContent(/birds 31.*sentence 86/);
    view.unmount();

    const unrated = runV2Fixtures.summaryUnrated.run;
    renderReview(step(unrated, { type: "OPEN_REVIEW", runId: unrated.runId }));
    expect(screen.getByText("Not rated · Out of hearts")).toBeInTheDocument();
    expect(screen.getByText("Out of hearts · 0 of 2 hearts left · chain 0/6")).toBeInTheDocument();
  });
});

function step(state: RunState, action: Parameters<typeof runReducer>[1]): RunState {
  const next = runReducer(state, action);
  if (!next) throw new Error("run ended");
  return next;
}

describe("RunReview under Target 85", () => {
  it("target85_relisten_verdict_never_labels_80_relisten", () => {
    // Target 85's first 80 carries an internal relisten verdict; the review reads it as Good.
    const lost = runV3Fixtures.target85HeartLost.run;
    const ended = step(step(lost, { type: "PAUSE", runId: lost.runId }), { type: "QUIT", runId: lost.runId });
    const { container } = renderReview(step(ended, { type: "OPEN_REVIEW", runId: lost.runId }));
    expect(container).not.toHaveTextContent(/re-listen/i);
    expect(container).toHaveTextContent("Good");
  });
});
