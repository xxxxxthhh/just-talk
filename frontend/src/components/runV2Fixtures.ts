// Typed UI fixtures for Game Mode v2 screens. Run states come from the real reducer and every
// score, suggestion and revisit from the real selectors.
import { nextCapture, runReducer } from "../game/runModel";
import { selectReviewSuggestions, selectRunScore, selectTopRevisit, tierForAccuracy } from "../game/scoring";
import type {
  AttemptKey,
  CaptureTelemetry,
  LocalRejectReason,
  RevisitSuggestion,
  RunAction,
  RunBestReceipt,
  RunMode,
  RunPrompt,
  RunScoreView,
  RunState,
  ScoreResponse
} from "../types";
import type { PracticeRunProps } from "./PracticeRun";
import { IDLE_TELEMETRY, type RunRingProps } from "./RunRing";

export type RunV2Fixture = Readonly<{
  run: RunState;
  score: RunScoreView;
  topRevisit: RevisitSuggestion | null;
  suggestions: readonly RevisitSuggestion[];
  receipt: RunBestReceipt | null;
  ring: RunRingProps;
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

type WordReading = readonly [word: string, accuracy: number, phoneme?: readonly [string, number]];

const BIRDS_WORDS: readonly WordReading[] = [
  ["these", 94],
  ["little", 97],
  ["birds", 31],
  ["wait", 85],
  ["by", 96],
  ["the", 92],
  ["window", 90]
];

function step(state: RunState | null, action: RunAction): RunState {
  const next = runReducer(state, action);
  if (!next) throw new Error(`fixture step ${action.type} ended the run`);
  return next;
}

function start(mode: RunMode): RunState {
  return step(null, { type: "START", runId: `fixture-${mode}`, mode, prompts: PROMPTS });
}

function response(accuracy: number, words: readonly WordReading[], sessionId: string | null = null): ScoreResponse {
  const scores = { accuracy, fluency: null, completeness: null, prosody: null, pronunciation: null };
  return {
    result: {
      transcript: words.map(([word]) => word).join(" "),
      scores,
      words: words.map(([word, wordAccuracy, phoneme]) => ({
        word,
        accuracy: wordAccuracy,
        bucket: "watch",
        error_type: "None",
        offset_ms: 0,
        duration_ms: 300,
        phonemes: phoneme
          ? [{ phoneme: phoneme[0], accuracy: phoneme[1], bucket: "watch", offset_ms: 0, duration_ms: 100, n_best: [] }]
          : []
      })),
      raw: null
    },
    session: sessionId
      ? { id: sessionId, created_at: "2026-10-08T00:00:00Z", reference_text: "", audio_duration_ms: 2000, scores }
      : null
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

// Words carry a weak /ð/ when the reading is low, so rescue and verdict hints have evidence.
function wordsFor(prompt: RunPrompt, accuracy: number): readonly WordReading[] {
  if (prompt.itemId === "context-1") return BIRDS_WORDS;
  const word = prompt.targetWord ?? prompt.text;
  return [[word, accuracy, prompt.targetPhoneme && accuracy < 80 ? [prompt.targetPhoneme, accuracy - 8] : undefined]];
}

function scored(state: RunState, accuracy: number, sessionId: string | null = null): RunState {
  const sent = send(state);
  const prompt = state.items[state.index].prompt;
  return step(sent.state, {
    type: "SCORE_RECEIVED",
    key: sent.key,
    response: response(accuracy, wordsFor(prompt, accuracy), sessionId)
  });
}

function loadReference(state: RunState): RunState {
  const itemId = state.items[state.index].prompt.itemId;
  const clicked = step(state, { type: "REFERENCE_CLICKED", runId: state.runId, itemId });
  return step(clicked, { type: "REFERENCE_LOADED", runId: state.runId, itemId, ok: true });
}

function advance(state: RunState): RunState {
  return step(state, { type: "ADVANCE", runId: state.runId, itemId: state.items[state.index].prompt.itemId });
}

function readings(mode: RunMode, accuracies: readonly number[], from = start(mode)): RunState {
  return accuracies.reduce((state, accuracy) => advance(scored(state, accuracy)), from);
}

function lastAttemptId(state: RunState): string {
  const attempts = state.items[state.index].attempts;
  return attempts[attempts.length - 1].key.attemptId;
}

function ring(phase: RunRingProps["phase"], overrides: Partial<Omit<RunRingProps, "phase" | "onStop">> = {}): RunRingProps {
  return {
    phase,
    telemetry: IDLE_TELEMETRY,
    accuracy: null,
    tier: null,
    rating: null,
    reducedMotion: false,
    feedbackId: null,
    settled: false,
    onStop: () => {},
    ...overrides
  };
}

function fixture(run: RunState, ringProps: RunRingProps, receipt: RunBestReceipt | null = null): RunV2Fixture {
  return {
    run,
    score: selectRunScore(run),
    topRevisit: selectTopRevisit(run),
    suggestions: selectReviewSuggestions(run),
    receipt,
    ring: ringProps
  };
}

// The ring shows the reading just returned, rescue readings included, in that reading's tier.
function verdictRing(run: RunState, accuracy: number): RunRingProps {
  return ring("verdict", { accuracy, tier: tierForAccuracy(accuracy), feedbackId: lastAttemptId(run) });
}

// 100, 92: Perfect then Great, chain ×2 going into the focus words.
const opening = readings("challenge", [100, 92]);
const openingRoute = readings("route", [100, 92]);

const ready = fixture(start("challenge"), ring("ready"));

const recordingRun = record(opening).state;
const recordingTelemetry: CaptureTelemetry = {
  captureId: recordingRun.activeAttemptId,
  level: 0.62,
  silenceProgress: 0.35,
  autoStopState: "tail",
  elapsedMs: 1200
};
const recording = fixture(recordingRun, ring("recording", { telemetry: recordingTelemetry }));
const fallback = fixture(
  recordingRun,
  ring("recording", { telemetry: { ...recordingTelemetry, level: 0.4, silenceProgress: 0, autoStopState: "fallback" } })
);

const scoring = fixture(send(opening).state, ring("scoring"));

function verdict(mode: RunMode, accuracy: number): RunV2Fixture {
  const run = scored(mode === "route" ? openingRoute : opening, accuracy);
  return fixture(run, verdictRing(run, accuracy));
}

const verdictPerfect = verdict("challenge", 98);
const verdictGreat = verdict("challenge", 88);
const verdictGood = verdict("challenge", 72);
// A Challenge reading below 60 goes to rescue; a Route shows Re-listen directly.
const verdictRelisten = verdict("route", 45);
// Raw values decide the tier: 84.9 is Good and breaks the chain, 85 is Great and extends it.
const boundaryGood = verdict("challenge", 84.9);
const boundaryGreat = verdict("challenge", 85);

// Two local rejects on the third item: discarded before sending, no slot used.
function localReject(reason: LocalRejectReason): RunV2Fixture {
  const recorded = record(opening);
  return fixture(step(recorded.state, { type: "LOCAL_REJECT", key: recorded.key, reason }), ring("ready"));
}
const localRejectTooShort = localReject("too-short");
const localRejectNoSpeech = localReject("no-speech");

// A server rejection keeps v1's wording.
function serverReject(): RunV2Fixture {
  const sent = send(opening);
  const run = step(sent.state, { type: "SCORE_FAILED", key: sent.key, failure: { kind: "rejected", message: "Recording too short." } });
  return fixture(run, ring("ready"));
}
const serverRejected = serverReject();

// 100, 92, 98, then "those" at 46: one more listen, no heart lost yet.
const rescueRun = scored(readings("challenge", [100, 92, 98]), 46);
const rescue = fixture(rescueRun, ring("rescue", { accuracy: 46, tier: "relisten", feedbackId: lastAttemptId(rescueRun) }));
const rescueLoadedRun = loadReference(rescueRun);
const rescueLoaded = fixture(
  rescueLoadedRun,
  ring("rescue", { accuracy: 46, tier: "relisten", feedbackId: lastAttemptId(rescueRun) })
);

// The rescue reads 52: the first reading still scores, and one heart is used.
const heartLostRun = scored(rescueLoadedRun, 52);
const heartLost = fixture(heartLostRun, verdictRing(heartLostRun, 52));

// The rescue reads 72 instead: the stone keeps the first reading's tier and adds the rescued mark.
const savedRun = scored(rescueLoadedRun, 72);
const rescueSaved = fixture(savedRun, verdictRing(savedRun, 72));

// A Route mid-run with every non-judgment mark: 100, skipped, no match, result unknown, now on item 5.
function noMatch(state: RunState): RunState {
  const sent = send(state);
  const empty = response(0, []);
  return step(sent.state, {
    type: "SCORE_RECEIVED",
    key: sent.key,
    response: { ...empty, result: { ...empty.result, recognition_status: "no_match" } }
  });
}

function unknownResult(state: RunState): RunState {
  const sent = send(state);
  return step(sent.state, { type: "SCORE_FAILED", key: sent.key, failure: { kind: "unknown", message: "No reply" } });
}

const routeSkipped = step(advance(scored(start("route"), 100)), { type: "SKIP", runId: "fixture-route", itemId: "warmup-2" });
const noMatchRun = noMatch(routeSkipped);
const verdictNoMatch = fixture(noMatchRun, ring("verdict", { feedbackId: lastAttemptId(noMatchRun) }));
const routeGaps = fixture(advance(unknownResult(advance(noMatchRun))), ring("ready"));

// The first sentence was scored and its words are still being collected, which blocks moving on.
const syncingRun = scored(readings("challenge", [100, 80, 95, 92]), 86, "session-birds");
const sentenceSyncing = fixture(syncingRun, verdictRing(syncingRun, 86));

// The owner's run from the design: 100, 80, 95, 92, 86, 94 → 861 A, Challenge cleared.
const ratedRun = readings("challenge", [100, 80, 95, 92, 86, 94]);
const ratedReceipt: RunBestReceipt = { runId: ratedRun.runId, previousPoints: 790, outcome: "new-best" };
const summaryRated = fixture(ratedRun, ring("summary", { rating: "A", feedbackId: `summary:${ratedRun.runId}` }), ratedReceipt);

// Every reading at 60 clears the Challenge but rates C: 540, which must read as logged, not failed.
const clearedCRun = readings("challenge", [60, 60, 60, 60, 60, 60]);
const summaryClearedC = fixture(
  clearedCRun,
  ring("summary", { rating: "C", feedbackId: `summary:${clearedCRun.runId}` }),
  { runId: clearedCRun.runId, previousPoints: null, outcome: "first-record" }
);

// Two failed rescues: 44 → 50 and 40 → 55 use both hearts.
const outOfHearts = scored(loadReference(scored(advance(scored(loadReference(scored(start("challenge"), 44)), 50)), 40)), 55);
const summaryUnrated = fixture(outOfHearts, ring("summary", { feedbackId: `summary:${outOfHearts.runId}` }));

const review = fixture(step(ratedRun, { type: "OPEN_REVIEW", runId: ratedRun.runId }), ring("summary", { rating: "A" }), ratedReceipt);

export const runV2Fixtures = {
  ready,
  recording,
  fallback,
  scoring,
  verdictPerfect,
  verdictGreat,
  verdictGood,
  verdictRelisten,
  boundaryGood,
  boundaryGreat,
  verdictNoMatch,
  localRejectTooShort,
  localRejectNoSpeech,
  serverRejected,
  rescue,
  rescueLoaded,
  heartLost,
  rescueSaved,
  routeGaps,
  sentenceSyncing,
  summaryRated,
  summaryClearedC,
  summaryUnrated,
  review
} satisfies Record<string, RunV2Fixture>;

// PracticeRun props for a run with no-op actions; tests override what they observe.
export function practiceRunProps(run: RunState, overrides: Partial<PracticeRunProps> = {}): PracticeRunProps {
  const noop = () => {};
  return {
    run,
    score: selectRunScore(run),
    topRevisit: selectTopRevisit(run),
    receipt: null,
    telemetry: IDLE_TELEMETRY,
    preferences: { sfx: true, autoStop: true },
    reducedMotion: false,
    consumedFeedbackIds: new Set<string>(),
    onFeedbackConsumed: noop,
    onSetPreference: noop,
    onRecord: noop,
    onStop: noop,
    onCancelTake: noop,
    onRecordNext: noop,
    onFinish: noop,
    onSkip: noop,
    onPlayReference: noop,
    onUseManualStop: noop,
    onPause: noop,
    onResume: noop,
    onQuit: noop,
    onOpenReview: noop,
    onPlayAgain: noop,
    onDone: noop,
    ...overrides
  };
}
