import { describe, expect, it } from "vitest";

import { configForChoice } from "./runConfig";
import { nextCapture, runReducer } from "./runModel";
import {
  runWeakWords,
  selectReviewSuggestions,
  selectRunScore,
  selectTopRevisit,
  tierForAccuracy
} from "./scoring";
import type { AttemptKey, PhonemeResult, RunAction, RunMode, RunPrompt, RunState, ScoreResponse, WordResult } from "../types";

const RUN = "run-1";

function prompts(): RunPrompt[] {
  return Array.from({ length: 6 }, (_, i) => ({
    itemId: `item-${i}`,
    stage: i < 2 ? "warmup" : i < 4 ? "focus" : "context",
    kind: i < 4 ? "word" : "sentence",
    text: i < 4 ? `word${i}` : `a short sentence number ${i}`,
    targetPhoneme: "θ",
    targetWord: `word${i}`,
    source: "starter"
  }));
}

function phoneme(symbol: string, accuracy: number): PhonemeResult {
  return { phoneme: symbol, accuracy, bucket: "watch", offset_ms: 0, duration_ms: 50, n_best: [] };
}

function word(text: string, accuracy: number, phonemes: PhonemeResult[] = []): WordResult {
  return { word: text, accuracy, bucket: "watch", error_type: "None", offset_ms: 0, duration_ms: 100, phonemes };
}

let counter = 0;

function scored(accuracy: number, words: WordResult[] = [word("word", accuracy)]): ScoreResponse {
  const scores = { accuracy, fluency: null, completeness: null, prosody: null, pronunciation: null };
  counter += 1;
  return {
    result: { transcript: "", recognition_status: "success", scores, words, raw: {} },
    session: { id: `s-${counter}`, created_at: "", reference_text: "", audio_duration_ms: 0, scores }
  };
}

const noMatch: ScoreResponse = { result: { ...scored(0).result, recognition_status: "no_match", words: [] }, session: null };

function reduce(state: RunState | null, ...actions: RunAction[]): RunState {
  const next = actions.reduce<RunState | null>((current, action) => runReducer(current, action), state);
  if (!next) throw new Error("run ended");
  return next;
}

function start(mode: RunMode): RunState {
  const config = configForChoice({ selection: mode === "route" ? "route" : "target60", routeLength: 6 });
  return reduce(null, { type: "START", runId: RUN, config, prompts: prompts() });
}

function itemId(state: RunState): string {
  return state.items[state.index].prompt.itemId;
}

function send(state: RunState): [RunState, AttemptKey] {
  const capture = nextCapture(state);
  if (!capture) throw new Error("no slot");
  const key = { runId: RUN, itemId: itemId(state), attemptId: `a-${++counter}` };
  const next = reduce(
    state,
    { type: "BEGIN_CAPTURE", key, ...capture },
    { type: "BLOB_READY", key, blob: new Blob(["audio"]) },
    { type: "SCORE_SENT", key }
  );
  return [next, key];
}

// Scores one take on the current item; sentence collection settles unless asked to stay pending.
function play(state: RunState, response: ScoreResponse, settle = true): RunState {
  const [sent, key] = send(state);
  const next = reduce(sent, { type: "SCORE_RECEIVED", key, response });
  const attempt = next.items[next.index].attempts.at(-1);
  if (settle && attempt?.sync === "pending") return reduce(next, { type: "SYNC_SETTLED", key, candidates: [], failed: false });
  return next;
}

function advance(state: RunState): RunState {
  return reduce(state, { type: "ADVANCE", runId: RUN, itemId: itemId(state) });
}

function loadReference(state: RunState): RunState {
  return reduce(
    state,
    { type: "REFERENCE_CLICKED", runId: RUN, itemId: itemId(state) },
    { type: "REFERENCE_LOADED", runId: RUN, itemId: itemId(state), ok: true }
  );
}

// Plays the given first readings in order, advancing after each (the last advance ends the run).
function route(readings: readonly number[], state = start("route")): RunState {
  return readings.reduce((current, accuracy) => advance(play(current, scored(accuracy))), state);
}

describe("run scoring", () => {
  it("tiers_compare_raw_boundary_values", () => {
    expect(tierForAccuracy(59.6)).toBe("relisten");
    expect(tierForAccuracy(60)).toBe("good");
    expect(tierForAccuracy(84.9)).toBe("good");
    expect(tierForAccuracy(85)).toBe("great");
    expect(tierForAccuracy(94.9)).toBe("great");
    expect(tierForAccuracy(95)).toBe("perfect");
    expect(tierForAccuracy(null)).toBeNull();
    expect(tierForAccuracy(Number.NaN)).toBeNull();
  });

  it("design_examples_score_861_930_904_978_955_865_540", () => {
    const examples: [number[], number, string][] = [
      [[100, 80, 95, 92, 86, 94], 861, "A"],
      [[100, 86, 95, 92, 86, 94], 930, "A"],
      [[100, 100, 84.9, 100, 100, 100], 904, "A"],
      [[100, 100, 85, 100, 100, 100], 978, "S"],
      [[95, 95, 95, 95, 95, 95], 955, "S"],
      [[85, 85, 85, 85, 85, 85], 865, "A"],
      [[60, 60, 60, 60, 60, 60], 540, "C"]
    ];
    for (const [readings, points, rating] of examples) {
      const state = route(readings);
      expect(state.endReason).toBe("completed");
      const score = selectRunScore(state);
      expect(score).toMatchObject({ points, rating, rated: true, unratedReason: null });
    }

    const owner = selectRunScore(route([100, 80, 95, 92, 86, 94]));
    expect(owner.items.map((item) => item.chain)).toEqual([1, 0, 1, 2, 3, 4]);
    expect(owner.items.map((item) => item.tier)).toEqual(["perfect", "good", "perfect", "great", "great", "great"]);
    expect(owner.items[5]).toMatchObject({ basePoints: 141, chainPoints: 20 });
    expect(owner.longestChain).toBe(4);
    expect(owner.fullCombo).toBe(false);
    expect(selectRunScore(route([85, 85, 85, 85, 85, 85])).fullCombo).toBe(true);
    expect(selectRunScore(route([100, 100, 84.9, 100, 100, 100])).longestChain).toBe(3);
  });

  it("rescue_never_rewrites_first_score", () => {
    let state = play(start("challenge"), scored(40));
    state = advance(play(loadReference(state), scored(90)));
    expect(state.items[0].verdict).toBe("saved");
    state = route([95, 95, 95, 95, 95], state);
    expect(state.challengeOutcome).toBe("cleared");

    const score = selectRunScore(state);
    expect(score.items[0]).toMatchObject({ firstAccuracy: 40, tier: "relisten", chain: 0, basePoints: 60 });
    // 1.5 × (40 + 5 × 95) + 100/15 × (0+0+1+2+3+4) = 772.5 + 66.67
    expect(score).toMatchObject({ points: 839, rating: "B", rated: true, longestChain: 5, fullCombo: false });
  });

  it("unjudged_holds_but_left_gap_breaks_chain", () => {
    // Still on an unjudged item: the chain holds; a re-record can become the first valid reading.
    let state = play(advance(play(start("route"), scored(95))), noMatch);
    expect(state.items[1].resolution).toBe("unjudged");
    let score = selectRunScore(state);
    expect(score.currentChain).toBe(1);
    expect(score.items[1]).toMatchObject({ firstAccuracy: null, tier: null, chain: 0 });
    state = play(state, scored(95));
    expect(selectRunScore(state)).toMatchObject({ currentChain: 2, longestChain: 2 });

    // 95, unknown, 95 never shows ×2.
    state = play(start("route"), scored(95));
    const [sent, key] = send(advance(state));
    state = reduce(sent, { type: "SCORE_FAILED", key, failure: { kind: "unknown", message: "502" } });
    expect(selectRunScore(state).currentChain).toBe(1);
    state = play(advance(state), scored(95));
    score = selectRunScore(state);
    expect(score.items.map((item) => item.chain).slice(0, 3)).toEqual([1, 0, 1]);
    expect(score.longestChain).toBe(1);

    // A skipped item breaks it too.
    state = route([95, 95], reduce(start("route"), { type: "SKIP", runId: RUN, itemId: "item-0" }));
    expect(selectRunScore(state).items.map((item) => item.chain).slice(0, 3)).toEqual([0, 1, 2]);

    // Sentence word collection still syncing is not an unknown score.
    state = route([95, 95, 95, 95]);
    state = play(state, scored(95), false);
    expect(state.items[4].attempts[0].sync).toBe("pending");
    expect(selectRunScore(state)).toMatchObject({ currentChain: 5 });
    expect(selectRunScore(state).items[4].firstAccuracy).toBe(95);
  });

  it("route_completed_with_gaps_is_unrated", () => {
    let state = reduce(start("route"), { type: "SKIP", runId: RUN, itemId: "item-0" });
    state = route([95, 95, 95, 95, 95], state);
    expect(state.endReason).toBe("completed");
    // 1.5 × 475 + 100/15 × (0+1+2+3+4) = 712.5 + 66.67
    expect(selectRunScore(state)).toMatchObject({
      points: 779,
      rated: false,
      rating: null,
      unratedReason: "Not every item scored",
      fullCombo: false
    });

    // An unjudged item left behind also leaves a gap.
    state = advance(play(start("route"), noMatch));
    state = route([95, 95, 95, 95, 95], state);
    expect(state.endReason).toBe("completed");
    expect(selectRunScore(state)).toMatchObject({ rated: false, unratedReason: "Not every item scored" });
  });

  it("quit_quota_and_heart_exhaustion_are_unrated", () => {
    const live = route([95, 95]);
    expect(selectRunScore(live)).toMatchObject({ rated: false, rating: null, unratedReason: null });

    const quit = reduce(live, { type: "QUIT", runId: RUN });
    expect(selectRunScore(quit)).toMatchObject({ rated: false, rating: null, unratedReason: "Quit" });

    const [sent, key] = send(live);
    const quota = reduce(sent, { type: "SCORE_FAILED", key, failure: { kind: "quota", message: "limit" } });
    expect(quota.endReason).toBe("quota");
    expect(selectRunScore(quota)).toMatchObject({ rated: false, unratedReason: "Usage limit reached" });

    let hearts = start("challenge");
    for (let i = 0; i < 2; i += 1) {
      hearts = play(loadReference(play(hearts, scored(40))), scored(40));
      if (hearts.endReason === null) hearts = advance(hearts);
    }
    expect(hearts.endReason).toBe("hearts-exhausted");
    expect(selectRunScore(hearts)).toMatchObject({ rated: false, rating: null, unratedReason: "Out of hearts" });

    // Every first reading exists, but a skipped rescue keeps the Challenge from clearing.
    let skipped = play(start("challenge"), scored(40));
    skipped = reduce(skipped, { type: "SKIP", runId: RUN, itemId: "item-0" });
    skipped = route([95, 95, 95, 95, 95], skipped);
    expect(skipped.challengeOutcome).toBe("incomplete");
    expect(selectRunScore(skipped)).toMatchObject({ rated: false, unratedReason: "Incomplete" });
  });

  it("partial_points_keep_fixed_denominator_and_round_once", () => {
    const state = reduce(route([100, 95]), { type: "QUIT", runId: RUN });
    const score = selectRunScore(state);
    // 150 + 142.5 + 6.67 = 299.17: rounding each item first would give 300, re-normalizing far more.
    expect(score.points).toBe(299);
    expect(score.items.slice(2).every((item) => item.basePoints === 0 && item.chainPoints === 0)).toBe(true);
  });

  it("suggestions_are_deduplicated_and_label_score_source", () => {
    const readings: ScoreResponse[] = [
      scored(50, [word("think", 50, [phoneme("θ", 40)])]),
      scored(55, [word("thin", 55, [phoneme("θ", 45)])]),
      scored(70, [word("fish", 70)]),
      scored(95, [word("ship", 95)]),
      scored(65, [word("birds", 31, [phoneme("ɝ", 30)]), word("the", 90)]),
      scored(95, [word("sing", 95)])
    ];
    const state = readings.reduce((current, response) => advance(play(current, response)), start("route"));

    const suggestions = selectReviewSuggestions(state);
    expect(suggestions.map((suggestion) => suggestion.id)).toEqual(["phoneme", "low", "borderline"]);
    expect(suggestions[0].evidence).toEqual([
      expect.objectContaining({ itemId: "item-0", word: "think", phoneme: "θ", accuracy: 40, scoreSource: "phoneme" }),
      expect.objectContaining({ itemId: "item-1", word: "thin", phoneme: "θ", accuracy: 45, scoreSource: "phoneme" })
    ]);
    // think and thin come from recordings the sound card already uses.
    expect(suggestions[1].evidence).toEqual([
      expect.objectContaining({ itemId: "item-4", word: "birds", phoneme: null, accuracy: 31, scoreSource: "word" })
    ]);
    expect(suggestions[2].evidence.map((evidence) => evidence.word)).toEqual(["fish"]);
    const attempts = suggestions.flatMap((suggestion) => suggestion.evidence.map((evidence) => evidence.attemptId));
    expect(new Set(attempts).size).toBe(attempts.length);

    const top = selectTopRevisit(state);
    expect(top?.id).toBe("phoneme");
    expect(top?.evidence).toEqual([expect.objectContaining({ word: "think", accuracy: 40, scoreSource: "phoneme" })]);

    // Next run's warm-ups still see every weak word.
    expect(runWeakWords(state)).toEqual(["birds", "think", "thin", "fish"]);
    expect(selectTopRevisit(route([95, 95, 95, 95, 95, 95]))).toBeNull();
  });
});
