// Typed UI fixtures for Game Mode v2 screens. Run states come from the real reducer; score views are
// hand-checked against the design's formula until the scoring selectors land.
import { nextCapture, runReducer } from "../game/runModel";
import type {
  AttemptKey,
  CaptureTelemetry,
  RevisitSuggestion,
  RunAction,
  RunBestReceipt,
  RunItemScore,
  RunMode,
  RunPrompt,
  RunScoreView,
  RunState,
  RunTier,
  ScoreResponse
} from "../types";
import type { RunRingProps } from "./RunRing";

export type RunV2Fixture = Readonly<{
  run: RunState;
  score: RunScoreView;
  ring: RunRingProps;
  receipt: RunBestReceipt | null;
  suggestions: readonly RevisitSuggestion[];
}>;

const PROMPTS: readonly RunPrompt[] = [
  { itemId: "warmup-1", stage: "warmup", kind: "word", text: "for", targetPhoneme: null, targetWord: "for", source: "starter" },
  { itemId: "warmup-2", stage: "warmup", kind: "word", text: "songs", targetPhoneme: null, targetWord: "songs", source: "starter" },
  { itemId: "focus-1", stage: "focus", kind: "word", text: "these", targetPhoneme: "ð", targetWord: "these", source: "starter" },
  { itemId: "focus-2", stage: "focus", kind: "word", text: "those", targetPhoneme: "ð", targetWord: "those", source: "starter" },
  {
    itemId: "context-1",
    stage: "context",
    kind: "sentence",
    text: "These little birds wait by the window.",
    targetPhoneme: "ð",
    targetWord: "these",
    source: "starter"
  },
  {
    itemId: "context-2",
    stage: "context",
    kind: "sentence",
    text: "Their brother sat over there.",
    targetPhoneme: "ð",
    targetWord: "their",
    source: "starter"
  }
];

const BIRDS_WORDS: readonly (readonly [string, number])[] = [
  ["these", 94],
  ["little", 97],
  ["birds", 31],
  ["wait", 85],
  ["by", 96],
  ["the", 92],
  ["window", 90]
];

const IDLE_TELEMETRY: CaptureTelemetry = { captureId: null, level: 0, silenceProgress: 0, autoStopState: "off", elapsedMs: 0 };

function step(state: RunState | null, action: RunAction): RunState {
  const next = runReducer(state, action);
  if (!next) throw new Error(`fixture step ${action.type} ended the run`);
  return next;
}

function start(mode: RunMode): RunState {
  return step(null, { type: "START", runId: `fixture-${mode}`, mode, prompts: PROMPTS });
}

function response(accuracy: number, words: readonly (readonly [string, number])[]): ScoreResponse {
  return {
    result: {
      transcript: words.map(([word]) => word).join(" "),
      scores: { accuracy, fluency: null, completeness: null, prosody: null, pronunciation: null },
      words: words.map(([word, wordAccuracy]) => ({
        word,
        accuracy: wordAccuracy,
        bucket: "watch",
        error_type: "None",
        offset_ms: 0,
        duration_ms: 300,
        phonemes: []
      })),
      raw: null
    },
    session: null
  };
}

function record(state: RunState): { state: RunState; key: AttemptKey } {
  const capture = nextCapture(state);
  if (!capture) throw new Error("fixture has no capture available");
  const item = state.items[state.index];
  const key = { runId: state.runId, itemId: item.prompt.itemId, attemptId: `${item.prompt.itemId}-take${item.attempts.length + 1}` };
  let next = step(state, { type: "BEGIN_CAPTURE", key, ...capture });
  next = step(next, { type: "BLOB_READY", key, blob: new Blob(["audio"]) });
  return { state: next, key };
}

function send(state: RunState): { state: RunState; key: AttemptKey } {
  const recorded = record(state);
  return { state: step(recorded.state, { type: "SCORE_SENT", key: recorded.key }), key: recorded.key };
}

function scored(state: RunState, accuracy: number): RunState {
  const sent = send(state);
  const prompt = state.items[state.index].prompt;
  const words = prompt.itemId === "context-1" ? BIRDS_WORDS : [[prompt.targetWord ?? prompt.text, accuracy] as const];
  return step(sent.state, { type: "SCORE_RECEIVED", key: sent.key, response: response(accuracy, words) });
}

function loadReference(state: RunState): RunState {
  const itemId = state.items[state.index].prompt.itemId;
  const clicked = step(state, { type: "REFERENCE_CLICKED", runId: state.runId, itemId });
  return step(clicked, { type: "REFERENCE_LOADED", runId: state.runId, itemId, ok: true });
}

function advance(state: RunState): RunState {
  return step(state, { type: "ADVANCE", runId: state.runId, itemId: state.items[state.index].prompt.itemId });
}

function readings(mode: RunMode, accuracies: readonly number[]): RunState {
  return accuracies.reduce((state, accuracy) => advance(scored(state, accuracy)), start(mode));
}

function lastAttemptId(state: RunState): string {
  const attempts = state.items[state.index].attempts;
  return attempts[attempts.length - 1].key.attemptId;
}

const CHAIN_STEP = 100 / 15;

function itemScore(index: number, firstAccuracy: number, tier: RunTier, chain: number): RunItemScore {
  return {
    itemId: PROMPTS[index].itemId,
    firstAccuracy,
    tier,
    chain,
    basePoints: 1.5 * firstAccuracy,
    chainPoints: CHAIN_STEP * Math.max(chain - 1, 0)
  };
}

function unreached(index: number): RunItemScore {
  return { itemId: PROMPTS[index].itemId, firstAccuracy: null, tier: null, chain: 0, basePoints: 0, chainPoints: 0 };
}

function scoreView(
  items: readonly RunItemScore[],
  view: Pick<RunScoreView, "points" | "currentChain" | "longestChain"> & Partial<RunScoreView>
): RunScoreView {
  const padded = PROMPTS.map((_, index) => items[index] ?? unreached(index));
  return { rated: false, rating: null, unratedReason: null, fullCombo: false, ...view, items: padded };
}

function ring(
  phase: RunRingProps["phase"],
  overrides: Partial<Omit<RunRingProps, "phase" | "onStop">> = {}
): RunRingProps {
  return {
    phase,
    telemetry: IDLE_TELEMETRY,
    accuracy: null,
    tier: null,
    rating: null,
    reducedMotion: false,
    feedbackId: null,
    onStop: () => {},
    ...overrides
  };
}

function fixture(run: RunState, score: RunScoreView, ringProps: RunRingProps, extra: Partial<RunV2Fixture> = {}): RunV2Fixture {
  return { run, score, ring: ringProps, receipt: null, suggestions: [], ...extra };
}

// 100, 92: Perfect then Great, chain ×2 going into the focus words.
const OPENING = [itemScore(0, 100, "perfect", 1), itemScore(1, 92, "great", 2)];
const opening = readings("challenge", [100, 92]);
const openingRoute = readings("route", [100, 92]);

const ready = fixture(start("challenge"), scoreView([], { points: 0, currentChain: 0, longestChain: 0 }), ring("ready"));

const recordingRun = record(opening).state;
const recordingTelemetry: CaptureTelemetry = {
  captureId: recordingRun.activeAttemptId,
  level: 0.62,
  silenceProgress: 0.35,
  autoStopState: "tail",
  elapsedMs: 1200
};
const openingScore = scoreView(OPENING, { points: 295, currentChain: 2, longestChain: 2 });
const recording = fixture(recordingRun, openingScore, ring("recording", { telemetry: recordingTelemetry }));
const fallback = fixture(
  recordingRun,
  openingScore,
  ring("recording", { telemetry: { ...recordingTelemetry, level: 0.4, silenceProgress: 0, autoStopState: "fallback" } })
);

const scoringRun = send(opening).state;
const scoring = fixture(scoringRun, openingScore, ring("scoring"));

function verdict(mode: RunMode, accuracy: number, tier: RunTier, chain: number, points: number): RunV2Fixture {
  const run = scored(mode === "route" ? openingRoute : opening, accuracy);
  const score = scoreView([...OPENING, itemScore(2, accuracy, tier, chain)], {
    points,
    currentChain: chain,
    longestChain: Math.max(chain, 2)
  });
  return fixture(run, score, ring("verdict", { accuracy, tier, feedbackId: lastAttemptId(run) }));
}

// Totals: 150 + 138 + 1.5q + chain bonus, rounded once.
const verdictPerfect = verdict("challenge", 98, "perfect", 3, 455);
const verdictGreat = verdict("challenge", 88, "great", 3, 440);
const verdictGood = verdict("challenge", 72, "good", 0, 403);
// A Challenge reading below 60 goes to rescue; a Route shows Re-listen directly.
const verdictRelisten = verdict("route", 45, "relisten", 0, 362);

// 100, 92, 98, then "those" at 46: one more listen, no heart lost yet.
const RESCUE_ITEMS = [...OPENING, itemScore(2, 98, "perfect", 3), itemScore(3, 46, "relisten", 0)];
const rescueScore = scoreView(RESCUE_ITEMS, { points: 524, currentChain: 0, longestChain: 3 });
const rescueRun = scored(readings("challenge", [100, 92, 98]), 46);
const rescue = fixture(rescueRun, rescueScore, ring("rescue", { accuracy: 46, tier: "relisten" }));

// The rescue reads 52: the first reading still scores, and one heart is used.
const heartLostRun = scored(loadReference(rescueRun), 52);
const heartLost = fixture(
  heartLostRun,
  rescueScore,
  ring("verdict", { accuracy: 52, tier: "relisten", feedbackId: lastAttemptId(heartLostRun) })
);

// The owner's run from the design: 100, 80, 95, 92, 86, 94 → 861 A, Challenge cleared.
const ratedRun = readings("challenge", [100, 80, 95, 92, 86, 94]);
const ratedScore = scoreView(
  [
    itemScore(0, 100, "perfect", 1),
    itemScore(1, 80, "good", 0),
    itemScore(2, 95, "perfect", 1),
    itemScore(3, 92, "great", 2),
    itemScore(4, 86, "great", 3),
    itemScore(5, 94, "great", 4)
  ],
  { points: 861, currentChain: 4, longestChain: 4, rated: true, rating: "A" }
);
const ratedReceipt: RunBestReceipt = { runId: ratedRun.runId, previousPoints: 790, outcome: "new-best" };
const birdsAttempt = ratedRun.items[4].attempts[0].key.attemptId;
const songsAttempt = ratedRun.items[1].attempts[0].key.attemptId;
const ratedSuggestions: readonly RevisitSuggestion[] = [
  {
    id: "word:birds",
    summary: "Revisit “birds” · word 31",
    evidence: [{ itemId: "context-1", attemptId: birdsAttempt, word: "birds", phoneme: null, accuracy: 31, scoreSource: "word" }]
  },
  {
    id: "word:songs",
    summary: "Revisit “songs” · word 80",
    evidence: [{ itemId: "warmup-2", attemptId: songsAttempt, word: "songs", phoneme: null, accuracy: 80, scoreSource: "word" }]
  }
];
const summaryRated = fixture(ratedRun, ratedScore, ring("summary", { rating: "A" }), {
  receipt: ratedReceipt,
  suggestions: ratedSuggestions
});

// Two failed rescues: 44 → 50 and 40 → 55 use both hearts.
const outOfHearts = scored(loadReference(scored(advance(scored(loadReference(scored(start("challenge"), 44)), 50)), 40)), 55);
const summaryUnrated = fixture(
  outOfHearts,
  scoreView([itemScore(0, 44, "relisten", 0), itemScore(1, 40, "relisten", 0)], {
    points: 126,
    currentChain: 0,
    longestChain: 0,
    unratedReason: "Out of hearts"
  }),
  ring("summary")
);

const review = fixture(step(ratedRun, { type: "OPEN_REVIEW", runId: ratedRun.runId }), ratedScore, ring("summary", { rating: "A" }), {
  receipt: ratedReceipt,
  suggestions: ratedSuggestions
});

export const runV2Fixtures = {
  ready,
  recording,
  fallback,
  scoring,
  verdictPerfect,
  verdictGreat,
  verdictGood,
  verdictRelisten,
  rescue,
  heartLost,
  summaryRated,
  summaryUnrated,
  review
} satisfies Record<string, RunV2Fixture>;
