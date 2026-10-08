// Typed UI fixtures for Game Mode v3 screens: the six frozen configurations from the real
// constructors, run states from the real reducer, and every score from the real selectors.
import { configForChoice, wordsConfig } from "../game/runConfig";
import { selectRunScore } from "../game/scoring";
import type { RunConfig, RunPrompt, RunScoreView, RunState, StarterRunConfig, WordsRunConfig } from "../types";
import { advance, loadReference, noMatch, response, send, step } from "./runV2Fixtures";

export const STARTER_ROUTE_6 = configForChoice({ selection: "route", routeLength: 6 });
export const STARTER_ROUTE_12 = configForChoice({ selection: "route", routeLength: 12 });
export const TARGET_60 = configForChoice({ selection: "target60", routeLength: 6 });
export const TARGET_85 = configForChoice({ selection: "target85", routeLength: 6 });
export const WORDS_ROUTE_6 = wordsConfig(6);
export const WORDS_ROUTE_12 = wordsConfig(12);

export const STARTER_CONFIGS: readonly StarterRunConfig[] = [STARTER_ROUTE_6, STARTER_ROUTE_12, TARGET_60, TARGET_85];
export const WORDS_CONFIGS: readonly WordsRunConfig[] = [WORDS_ROUTE_6, WORDS_ROUTE_12];
export const ALL_CONFIGS: readonly RunConfig[] = [...STARTER_CONFIGS, ...WORDS_CONFIGS];

export type RunV3Fixture = Readonly<{ run: RunState; score: RunScoreView }>;

function word(itemId: string, text: string): RunPrompt {
  const stage = itemId.startsWith("warmup") ? "warmup" : "focus";
  return { itemId, stage, kind: "word", text, targetPhoneme: "θ", targetWord: text, source: "starter" };
}

function sentence(itemId: string, text: string, targetWord: string): RunPrompt {
  return { itemId, stage: "context", kind: "sentence", text, targetPhoneme: "θ", targetWord, source: "starter" };
}

// A /θ/ deck in canonical order: twelve items for Route 12, the first two of each stage for six.
const WARMUPS = [word("warmup-1", "thin"), word("warmup-2", "thick"), word("warmup-3", "thumb"), word("warmup-4", "thing")];
const FOCUS = [word("focus-1", "think"), word("focus-2", "thank"), word("focus-3", "three"), word("focus-4", "teeth")];
const CONTEXT = [
  sentence("context-1", "I think we can walk home now.", "think"),
  sentence("context-2", "The narrow path leads to our house.", "path"),
  sentence("context-3", "We bought three tickets for the show.", "three"),
  sentence("context-4", "Both cups of tea are still hot.", "both")
];
export const PROMPTS_12: readonly RunPrompt[] = [...WARMUPS, ...FOCUS, ...CONTEXT];
export const PROMPTS_6: readonly RunPrompt[] = [...WARMUPS.slice(0, 2), ...FOCUS.slice(0, 2), ...CONTEXT.slice(0, 2)];

let runs = 0;

function start(config: StarterRunConfig): RunState {
  const prompts = config.length === 12 ? PROMPTS_12 : PROMPTS_6;
  return step(null, { type: "START", runId: `v3-fixture-${++runs}`, config, prompts });
}

function scored(state: RunState, accuracy: number): RunState {
  const sent = send(state);
  const prompt = state.items[state.index].prompt;
  const target = prompt.targetWord ?? prompt.text;
  return step(sent.state, { type: "SCORE_RECEIVED", key: sent.key, response: response(accuracy, [[target, accuracy]]) });
}

function readings(state: RunState, accuracies: readonly number[]): RunState {
  return accuracies.reduce((current, accuracy) => advance(scored(current, accuracy)), state);
}

function fixture(run: RunState): RunV3Fixture {
  return { run, score: selectRunScore(run) };
}

// Route 12 from the owner mockup: 92, 100, 72, 95, 86, then Ready on item 6 ("thank").
export const ROUTE_12_READINGS = [92, 100, 72, 95, 86, 88, 90, 97, 85, 64, 93, 96] as const;
const route12Ready = fixture(readings(start(STARTER_ROUTE_12), ROUTE_12_READINGS.slice(0, 5)));
const route12Complete = fixture(readings(start(STARTER_ROUTE_12), ROUTE_12_READINGS));
// Item 6 ("thank") reads 88: Great, ×3 in a row, with "three" next.
const route12Feedback = fixture(scored(route12Ready.run, ROUTE_12_READINGS[5]));
// The last item's feedback offers Finish rather than a next item.
const route12LastFeedback = fixture(scored(readings(start(STARTER_ROUTE_12), ROUTE_12_READINGS.slice(0, 11)), 96));
// Eleven 100s, then 84.9: 972 points but a broken chain, so A rather than S.
const route12BrokenChain = fixture(readings(start(STARTER_ROUTE_12), [...Array<number>(11).fill(100), 84.9]));
// Six 95s, then quit: the planned twelve still divide the score (450, not rated).
const partialRun = readings(start(STARTER_ROUTE_12), Array<number>(6).fill(95));
const route12Partial = fixture(
  step(step(partialRun, { type: "PAUSE", runId: partialRun.runId }), { type: "QUIT", runId: partialRun.runId })
);

// Target 85: 100, 98, then "thank" reads 80 — Good, but below this run's target.
const target85RescueRun = scored(readings(start(TARGET_85), [100, 98]), 80);
const target85Rescue = fixture(target85RescueRun);
const target85Loaded = loadReference(target85RescueRun);
// 80 → 82: both readings below 85, one heart used; the stone keeps the first reading's Good.
const target85HeartLost = fixture(scored(target85Loaded, 82));
// 80 → 88: the heart is kept and the first reading still scores 80.
const target85Saved = fixture(scored(target85Loaded, 88));

// The raw first reading decides: 84.9 is below 85 (and shows as 84.9); a rescue at 85 keeps the heart.
const target85Boundary = fixture(scored(loadReference(scored(start(TARGET_85), 84.9)), 85));

// The shared pool runs out: an 80, then four rescues with no match use all four extras, so the
// item cannot be confirmed and no heart is lost.
const exhaustedRun = [1, 2, 3, 4].reduce(noMatch, loadReference(scored(start(TARGET_85), 80)));
const target85Exhausted = fixture(exhaustedRun);
// With the pool empty, the next item's first reading finds no match: no valid reading exists.
const target85UnjudgedEmpty = fixture(noMatch(advance(exhaustedRun)));

// The reference for a rescue cannot load: not confirmed, and no low second reading is implied.
const referenceFailedRun = scored(start(TARGET_85), 80);
const target85ReferenceFailed = fixture(
  step(step(referenceFailedRun, { type: "REFERENCE_CLICKED", runId: referenceFailedRun.runId, itemId: "warmup-1" }), {
    type: "REFERENCE_LOADED",
    runId: referenceFailedRun.runId,
    itemId: "warmup-1",
    ok: false
  })
);

// The owner mockup's Target 85: 100, 98, 80 → 82 (one heart used), 96, 95, 97: cleared, 876 A.
const target85Cleared = fixture(readings(advance(scored(target85Loaded, 82)), [96, 95, 97]));

// A Target 85 run whose third item passes at 96: Challenge keeps Record next / Hear it again.
const target85Passed = fixture(scored(readings(start(TARGET_85), [100, 98]), 96));

// Target 60 keeps v2's rule at its own target: 46 → 52 uses a heart.
const target60HeartLost = fixture(scored(loadReference(scored(start(TARGET_60), 46)), 52));

const route6Ready = fixture(start(STARTER_ROUTE_6));

export const runV3Fixtures = {
  route6Ready,
  route12Ready,
  route12Complete,
  route12Feedback,
  route12LastFeedback,
  route12BrokenChain,
  route12Partial,
  target85Rescue,
  target85HeartLost,
  target85Saved,
  target85Boundary,
  target85Exhausted,
  target85UnjudgedEmpty,
  target85ReferenceFailed,
  target85Passed,
  target85Cleared,
  target60HeartLost
} satisfies Record<string, RunV3Fixture>;
