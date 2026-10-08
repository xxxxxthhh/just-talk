import { describe, expect, it } from "vitest";

import { configForChoice, wordsConfig } from "./runConfig";
import { canAdvance, canRecord, canSubmit, judge, nextCapture, runReducer } from "./runModel";
import type {
  AttemptKey,
  RunAction,
  RunConfig,
  RunMode,
  RunPrompt,
  RunState,
  ScoreResponse,
  ScoreResult,
  WordResult
} from "../types";

const RUN = "run-1";

const ROUTE_6 = configForChoice({ selection: "route", routeLength: 6 });
const ROUTE_12 = configForChoice({ selection: "route", routeLength: 12 });
const TARGET_60 = configForChoice({ selection: "target60", routeLength: 6 });
const TARGET_85 = configForChoice({ selection: "target85", routeLength: 6 });

function prompts(length = 6): RunPrompt[] {
  const perStage = length / 3;
  return Array.from({ length }, (_, i) => {
    const sentence = i >= 2 * perStage;
    return {
      itemId: `item-${i}`,
      stage: i < perStage ? "warmup" : sentence ? "context" : "focus",
      kind: sentence ? "sentence" : "word",
      text: sentence ? `a short sentence number ${i}` : `word${i}`,
      targetPhoneme: "θ",
      targetWord: `word${i}`,
      source: "starter"
    };
  });
}

function word(text: string, accuracy: number | null, errorType = "None"): WordResult {
  return { word: text, accuracy, bucket: "watch", error_type: errorType, offset_ms: 0, duration_ms: 100, phonemes: [] };
}

function result(accuracy: number | null, words: WordResult[] = [word("word", accuracy)]): ScoreResult {
  return {
    transcript: "word",
    recognition_status: "success",
    scores: { accuracy, fluency: null, completeness: null, prosody: null, pronunciation: null },
    words,
    raw: {}
  };
}

function scored(accuracy: number | null, words?: WordResult[]): ScoreResponse {
  const scoreResult = result(accuracy, words);
  return {
    result: scoreResult,
    session: { id: `s-${Math.random()}`, created_at: "", reference_text: "", audio_duration_ms: 0, scores: scoreResult.scores }
  };
}

const noMatch: ScoreResponse = { result: { ...result(null, []), recognition_status: "no_match" }, session: null };

function reduce(state: RunState | null, ...actions: RunAction[]): RunState {
  const next = actions.reduce<RunState | null>((current, action) => runReducer(current, action), state);
  if (!next) throw new Error("run ended");
  return next;
}

function start(choice: RunMode | RunConfig): RunState {
  const config = choice === "route" ? ROUTE_6 : choice === "challenge" ? TARGET_60 : choice;
  return reduce(null, { type: "START", runId: RUN, config, prompts: prompts(config.length) });
}

let counter = 0;

// Captures and submits one attempt on the current item; returns the state after SCORE_SENT and its key.
function send(state: RunState): [RunState, AttemptKey] {
  const capture = nextCapture(state);
  if (!capture) throw new Error("no slot");
  const key = { runId: state.runId, itemId: state.items[state.index].prompt.itemId, attemptId: `a-${++counter}` };
  const next = reduce(
    state,
    { type: "BEGIN_CAPTURE", key, ...capture },
    { type: "BLOB_READY", key, blob: new Blob(["audio"]) },
    { type: "SCORE_SENT", key }
  );
  expect(next.activeAttemptId).toBe(key.attemptId);
  return [next, key];
}

// Begins one capture on the current item with its blob ready but not yet sent.
function capture(state: RunState): [RunState, AttemptKey] {
  const slot = nextCapture(state);
  if (!slot) throw new Error("no slot");
  const key = { runId: state.runId, itemId: state.items[state.index].prompt.itemId, attemptId: `a-${++counter}` };
  const next = reduce(state, { type: "BEGIN_CAPTURE", key, ...slot }, { type: "BLOB_READY", key, blob: new Blob(["audio"]) });
  return [next, key];
}

function play(state: RunState, response: ScoreResponse): RunState {
  const [sent, key] = send(state);
  const next = reduce(sent, { type: "SCORE_RECEIVED", key, response });
  const attempt = next.items.find((item) => item.prompt.itemId === key.itemId)?.attempts.at(-1);
  if (attempt?.sync === "pending") return reduce(next, { type: "SYNC_SETTLED", key, candidates: [], failed: false });
  return next;
}

function itemId(state: RunState): string {
  return state.items[state.index].prompt.itemId;
}

function advance(state: RunState): RunState {
  return reduce(state, { type: "ADVANCE", runId: RUN, itemId: itemId(state) });
}

function loadReference(state: RunState, ok = true): RunState {
  return reduce(
    state,
    { type: "REFERENCE_CLICKED", runId: RUN, itemId: itemId(state) },
    { type: "REFERENCE_LOADED", runId: RUN, itemId: itemId(state), ok }
  );
}

function rescue(state: RunState, response: ScoreResponse): RunState {
  expect(state.phase).toBe("rescue");
  return play(loadReference(state), response);
}

function expectBudgetInvariant(state: RunState) {
  expect(state.budgetUsed).toBe(state.mainItemIdsUsed.length + state.extraUsed);
}

describe("run model", () => {
  it("route_resolves_six_valid_items_without_hearts", () => {
    let state = start("route");
    expect(state.hearts).toBeNull();
    for (const accuracy of [20, 45, 59, 61, 90, 30]) {
      state = play(state, scored(accuracy));
      expect(state.items[state.index].resolution).toBe("resolved");
      expect(state.items[state.index].verdict).toBe("practiced");
      expect(state.phase).toBe("feedback");
      state = advance(state);
    }
    expect(state.items.every((item) => item.resolution === "resolved")).toBe(true);
    expect(state.endReason).toBe("completed");
    expect(state.phase).toBe("summary");
    expect(state.challengeOutcome).toBeNull();
    expect(reduce(state, { type: "OPEN_REVIEW", runId: RUN }).phase).toBe("review");
    expect(state.budgetUsed).toBe(6);
    expectBudgetInvariant(state);
  });

  it("judgment_uses_raw_overall_accuracy_and_simple_alignment", () => {
    expect(judge(result(59.6))).toEqual({ kind: "valid", accuracy: 59.6 });
    expect(judge(result(60))).toEqual({ kind: "valid", accuracy: 60 });
    expect(judge(result(55, [word("think", 95), word("now", 90)]))).toEqual({ kind: "valid", accuracy: 55 });
    expect(judge(result(null))).toEqual({ kind: "unjudged" });
    expect(judge(result(Number.NaN))).toEqual({ kind: "unjudged" });
    expect(judge(result(80, []))).toEqual({ kind: "unjudged" });
    expect(judge(noMatch.result)).toEqual({ kind: "no-match" });
    expect(judge(result(80, [word("think", 80), word("now", 0, "Omission")]))).toEqual({ kind: "unjudged" });
    expect(judge(result(80, [word("think", 80), word("uh", 0, "Insertion")]))).toEqual({ kind: "unjudged" });
    expect(judge(result(70, [word("think", 40, "Mispronunciation")]))).toEqual({ kind: "valid", accuracy: 70 });

    const state = play(start("challenge"), scored(59.6, [word("word0", 95)]));
    expect(state.phase).toBe("rescue");
    expect(state.items[0].verdict).toBe("relisten");
  });

  it("challenge_confirms_before_losing_a_heart_and_can_clear_with_one", () => {
    let state = play(start("challenge"), scored(50));
    expect(state.hearts).toBe(2);
    expect(state.items[0].resolution).toBe("open");
    expect(state.items[0].firstLowAttemptId).toBe(state.items[0].attempts[0].key.attemptId);

    state = rescue(state, scored(70));
    expect(state.hearts).toBe(2);
    expect(state.items[0].verdict).toBe("saved");
    expect(state.items[0].attempts.map((attempt) => attempt.purpose)).toEqual(["initial", "rescue"]);
    state = advance(state);

    state = rescue(play(state, scored(40)), scored(45));
    expect(state.hearts).toBe(1);
    expect(state.items[1].resolution).toBe("resolved");
    expect(state.items[1].verdict).toBe("heart-lost");
    state = advance(state);

    for (let i = 2; i < 6; i += 1) {
      state = advance(play(state, scored(60)));
      expect(state.items[i].verdict).toBe("passed");
    }
    expect(state.endReason).toBe("completed");
    expect(state.phase).toBe("summary");
    expect(state.challengeOutcome).toBe("cleared");
    expect(state.hearts).toBe(1);
    expect(state.budgetUsed).toBe(8);
    expectBudgetInvariant(state);

    expect(reduce(state, { type: "OPEN_REVIEW", runId: RUN }).phase).toBe("review");
  });

  it("two_confirmed_failures_end_at_zero_hearts", () => {
    let state = rescue(play(start("challenge"), scored(50)), scored(50));
    expect(state.hearts).toBe(1);
    state = rescue(play(advance(state), scored(50)), scored(50));
    expect(state.hearts).toBe(0);
    expect(state.endReason).toBe("hearts-exhausted");
    expect(state.challengeOutcome).toBe("failed");
    expect(state.phase).toBe("summary");
    expect(state.budgetUsed).toBe(4);
    expect(canRecord(state)).toBe(false);
  });

  it("shared_extras_never_consume_remaining_main_slots", () => {
    let state = advance(rescue(play(start("challenge"), scored(40)), scored(80)));
    state = rescue(play(state, scored(40)), scored(80));
    expect(state.extraUsed).toBe(2);
    expect(state.items[1].verdict).toBe("saved");
    state = advance(state);

    // A third low reading needs a rescue the pool cannot pay for.
    state = play(state, scored(30));
    expect(state.items[2].verdict).toBe("cannot-confirm");
    expect(state.items[2].resolution).toBe("unjudged");
    expect(state.hearts).toBe(2);
    expect(state.challengeIncomplete).toBe(true);
    expect(state.phase).toBe("feedback");
    state = advance(state);

    for (let i = 3; i < 6; i += 1) {
      expect(nextCapture(state)).toEqual({ purpose: "initial", slot: "main" });
      state = advance(play(state, scored(90)));
    }
    expect(state.budgetUsed).toBe(8);
    expectBudgetInvariant(state);
    expect(state.challengeOutcome).toBe("incomplete");
    expect(state.hearts).toBe(2);
  });

  it("no_match_during_rescue_consumes_extra_without_confirming", () => {
    let state = loadReference(play(start("challenge"), scored(40)));
    state = play(state, noMatch);
    expect(state.phase).toBe("rescue");
    expect(state.hearts).toBe(2);
    expect(state.extraUsed).toBe(1);
    state = play(state, noMatch);
    expect(state.items[0].verdict).toBe("cannot-confirm");
    expect(state.hearts).toBe(2);
    expect(nextCapture(advance(state))).toEqual({ purpose: "initial", slot: "main" });
  });

  it("unjudged_reading_with_empty_pool_cannot_confirm", () => {
    let state = advance(rescue(play(start("challenge"), scored(40)), scored(80)));
    state = advance(rescue(play(state, scored(40)), scored(80)));
    state = play(state, noMatch);
    expect(state.items[2].verdict).toBe("cannot-confirm");
    expect(state.challengeIncomplete).toBe(true);
    expect(state.hearts).toBe(2);
    expect(canRecord(state)).toBe(false);
    expect(canAdvance(state)).toBe(true);
  });

  it.each([
    ["NoMatch", noMatch],
    ["null accuracy", scored(null)],
    ["Omission", scored(80, [word("word0", 80), word("now", 0, "Omission")])]
  ])("nomatch_then_two_valid_lows_loses_one_heart (%s first)", (_label, firstReading) => {
    let state = play(start("challenge"), firstReading);
    expect(state.items[0].resolution).toBe("unjudged");
    expect(nextCapture(state)).toEqual({ purpose: "rerecord", slot: "extra" });
    state = play(state, scored(50));
    expect(state.items[0].resolution).toBe("open");
    expect(state.items[0].verdict).toBe("relisten");
    expect(state.phase).toBe("rescue");
    expect(nextCapture(state)).toEqual({ purpose: "rescue", slot: "extra" });
    expect(state.hearts).toBe(2);

    state = rescue(state, scored(50));
    expect(state.items[0].verdict).toBe("heart-lost");
    expect(state.items[0].resolution).toBe("resolved");
    expect(state.hearts).toBe(1);
    expect(state.budgetUsed).toBe(3);
  });

  it("rerecorded_first_low_can_be_skipped", () => {
    let state = play(play(start("challenge"), noMatch), scored(50));
    expect(state.phase).toBe("rescue");
    state = reduce(state, { type: "SKIP", runId: RUN, itemId: "item-0" });
    expect(state.items[0].resolution).toBe("skipped");
    expect(state.index).toBe(1);
    expect(state.hearts).toBe(2);
    expect(state.challengeIncomplete).toBe(true);
  });

  it.each([false, true])("quit_after_sixth_valid_result_is_incomplete (paused: %s)", (paused) => {
    let state = start("challenge");
    for (let i = 0; i < 5; i += 1) state = advance(play(state, scored(90)));
    state = play(state, scored(90));
    expect(state.items.every((item) => item.resolution === "resolved")).toBe(true);
    expect(state.endReason).toBeNull();

    // Advancing past the sixth item clears; quitting there does not.
    expect(advance(state).challengeOutcome).toBe("cleared");
    if (paused) state = reduce(state, { type: "PAUSE", runId: RUN });
    const quit = reduce(state, { type: "QUIT", runId: RUN });
    expect(quit.endReason).toBe("quit");
    expect(quit.challengeOutcome).toBe("incomplete");
    expect(quit.hearts).toBe(2);
    expect(quit.items.every((item) => item.resolution === "resolved")).toBe(true);
  });

  it("lastRejection_clears_when_a_new_capture_begins", () => {
    const [sent, key] = send(start("route"));
    let state = reduce(sent, { type: "SCORE_FAILED", key, failure: { kind: "rejected", message: "too short" } });
    expect(state.items[0].lastRejection?.message).toBe("too short");
    expect(state.items[0].verdict).toBe("rejected");
    const next = { ...key, attemptId: "retry" };
    state = reduce(state, { type: "BEGIN_CAPTURE", key: next, purpose: "initial", slot: "main" });
    expect(state.items[0].lastRejection).toBeNull();
    expect(state.items[0].verdict).toBeNull();
  });

  it("nomatch_then_valid_reading_resolves_route_item", () => {
    const state = play(play(start("route"), noMatch), scored(50));
    expect(state.items[0].resolution).toBe("resolved");
    expect(state.items[0].verdict).toBe("practiced");
  });

  it("rejected_refunds_exact_slot_once_and_keeps_current_item", () => {
    let [state, key] = send(start("challenge"));
    expect(state.budgetUsed).toBe(1);
    const failure: RunAction = { type: "SCORE_FAILED", key, failure: { kind: "rejected", message: "too short" } };
    state = reduce(state, failure);
    expect(state.budgetUsed).toBe(0);
    expect(state.mainItemIdsUsed).toEqual([]);
    expect(state.index).toBe(0);
    expect(state.phase).toBe("ready");
    expect(state.items[0].attempts).toEqual([]);
    expect(state.items[0].lastRejection).toEqual({ attemptId: key.attemptId, message: "too short" });
    expect(reduce(state, failure)).toBe(state);

    // A rejected rescue returns its extra slot and stays in rescue.
    state = loadReference(play(state, scored(40)));
    [state, key] = send(state);
    expect(state.extraUsed).toBe(1);
    state = reduce(state, { type: "SCORE_FAILED", key, failure: { kind: "rejected", message: "busy" } });
    expect(state.extraUsed).toBe(0);
    expect(state.phase).toBe("rescue");
    expect(state.items[0].verdict).toBe("relisten");
    expect(canRecord(state)).toBe(true);
    expectBudgetInvariant(state);
  });

  it("unknown_and_skipped_items_prevent_clear_but_allow_next_item", () => {
    let [state, key] = send(start("challenge"));
    state = reduce(state, { type: "SCORE_FAILED", key, failure: { kind: "unknown", message: "502" } });
    expect(state.items[0].resolution).toBe("pending");
    expect(state.items[0].attempts[0].status).toBe("pending");
    expect(state.budgetUsed).toBe(1);
    expect(state.challengeIncomplete).toBe(true);
    expect(canRecord(state)).toBe(false);
    expect(canAdvance(state)).toBe(true);
    state = advance(state);

    // Unknown during rescue stops confirmation without a heart loss.
    state = loadReference(play(state, scored(40)));
    [state, key] = send(state);
    state = reduce(state, { type: "SCORE_FAILED", key, failure: { kind: "unknown", message: "network" } });
    expect(state.items[1].resolution).toBe("pending");
    expect(state.items[1].attempts[0].result?.scores.accuracy).toBe(40);
    expect(state.hearts).toBe(2);
    state = advance(state);

    state = reduce(state, { type: "SKIP", runId: RUN, itemId: itemId(state) });
    expect(state.items[2].resolution).toBe("skipped");
    expect(state.index).toBe(3);

    // A pending rescue blocks advancing until it is skipped.
    state = play(state, scored(30));
    expect(canAdvance(state)).toBe(false);
    expect(advance(state)).toBe(state);
    expect(canRecord(state)).toBe(false);
    state = reduce(state, { type: "SKIP", runId: RUN, itemId: itemId(state) });
    expect(state.items[3].verdict).toBe("skipped");
    expect(state.hearts).toBe(2);

    state = advance(play(advance(play(state, scored(90))), scored(90)));
    expect(state.endReason).toBe("completed");
    expect(state.challengeOutcome).toBe("incomplete");
  });

  it("stale_or_duplicate_responses_cannot_change_new_state", () => {
    const [sent, key] = send(start("challenge"));
    const received: RunAction = { type: "SCORE_RECEIVED", key, response: scored(90) };
    let state = reduce(sent, received);
    expect(reduce(state, received)).toBe(state);
    expect(reduce(state, { type: "SCORE_FAILED", key, failure: { kind: "rejected", message: "x" } })).toBe(state);
    state = advance(state);

    const [sending, nextKey] = send(state);
    expect(reduce(sending, received)).toBe(sending);
    expect(reduce(sending, { type: "SCORE_RECEIVED", key: { ...nextKey, runId: "old-run" }, response: scored(10) })).toBe(sending);
    expect(reduce(sending, { type: "SCORE_RECEIVED", key: { ...nextKey, itemId: "item-0" }, response: scored(10) })).toBe(sending);
    expect(canSubmit(sending, nextKey)).toBe(false);
    expect(reduce(sending, { type: "SCORE_SENT", key: nextKey })).toBe(sending);

    // A second capture cannot start while one is in flight.
    expect(canRecord(sending)).toBe(false);
    const other = { ...nextKey, attemptId: "other" };
    expect(reduce(sending, { type: "BEGIN_CAPTURE", key: other, purpose: "rerecord", slot: "extra" })).toBe(sending);

    // Pause keeps the submitted attempt, and its result still settles.
    const paused = reduce(sending, { type: "PAUSE", runId: RUN });
    const settled = reduce(paused, { type: "SCORE_RECEIVED", key: nextKey, response: scored(80) });
    expect(settled.items[1].verdict).toBe("passed");
    expect(settled.paused).toBe(true);
    expect(canAdvance(settled)).toBe(false);

    // A new run ignores the old run's responses entirely.
    const fresh = start("route");
    expect(reduce(fresh, { type: "SCORE_RECEIVED", key: nextKey, response: scored(80) })).toBe(fresh);
  });

  it("pause_discards_capture_and_quit_marks_inflight_pending", () => {
    const key = { runId: RUN, itemId: "item-0", attemptId: "cap" };
    let state = reduce(start("route"), { type: "BEGIN_CAPTURE", key, purpose: "initial", slot: "main" });
    state = reduce(state, { type: "PAUSE", runId: RUN });
    expect(state.items[0].attempts).toEqual([]);
    expect(state.activeAttemptId).toBeNull();
    expect(state.phase).toBe("ready");
    expect(canRecord(state)).toBe(false);
    state = reduce(state, { type: "RESUME", runId: RUN });
    expect(canRecord(state)).toBe(true);

    const [sending, sentKey] = send(state);
    const quit = reduce(sending, { type: "QUIT", runId: RUN });
    expect(quit.endReason).toBe("quit");
    expect(quit.phase).toBe("summary");
    expect(quit.items[0].resolution).toBe("pending");
    expect(reduce(quit, { type: "SCORE_RECEIVED", key: sentKey, response: scored(90) })).toBe(quit);
    expect(runReducer(quit, { type: "EXIT", runId: RUN })).toBeNull();
  });

  it("sentence_sync_blocks_next_capture_until_settled", () => {
    let state = start("route");
    for (let i = 0; i < 4; i += 1) state = advance(play(state, scored(90)));
    const [sent, key] = send(state);
    state = reduce(sent, { type: "SCORE_RECEIVED", key, response: scored(65, [word("path", 50), word("now", 75)]) });
    expect(state.items[4].attempts[0].sync).toBe("pending");
    expect(state.items[4].attempts[0].candidates).toEqual([{ word: "path", status: "unconfirmed" }]);
    expect(canAdvance(state)).toBe(false);
    state = reduce(state, {
      type: "SYNC_SETTLED",
      key,
      candidates: [{ word: "sentence", status: "save-manually" }],
      failed: true
    });
    expect(state.items[4].attempts[0].sync).toBe("manual");
    expect(canAdvance(state)).toBe(true);
  });

  it("quota_ends_run_without_counting_the_attempt", () => {
    const [state, key] = send(start("challenge"));
    const ended = reduce(state, { type: "SCORE_FAILED", key, failure: { kind: "quota", message: "limit" } });
    expect(ended.endReason).toBe("quota");
    expect(ended.phase).toBe("summary");
    expect(ended.challengeOutcome).toBe("incomplete");
    expect(ended.items[0].verdict).toBe("quota-ended");
    expect(ended.budgetUsed).toBe(0);
  });

  it("failed_reference_load_cannot_confirm_without_cost", () => {
    let state = play(start("challenge"), scored(40));
    expect(canRecord(state)).toBe(false);
    state = loadReference(state, false);
    expect(state.items[0].verdict).toBe("cannot-confirm");
    expect(state.hearts).toBe(2);
    expect(state.extraUsed).toBe(0);
    expect(state.challengeIncomplete).toBe(true);
    expect(canAdvance(state)).toBe(true);
  });

  it("local_reject_keeps_main_budget_zero", () => {
    let [state, key] = capture(start("challenge"));
    state = reduce(state, { type: "LOCAL_REJECT", key, reason: "too-short" });
    expect(state.budgetUsed).toBe(0);
    expect(state.mainItemIdsUsed).toEqual([]);
    expect(state.activeAttemptId).toBeNull();
    expect(state.phase).toBe("ready");
    expect(state.items[0].attempts).toEqual([]);
    expect(state.items[0].verdict).toBeNull();
    expect(state.items[0].lastRejection).toMatchObject({ attemptId: key.attemptId, localReason: "too-short" });
    expect(nextCapture(state)).toEqual({ purpose: "initial", slot: "main" });
    expect(canRecord(state)).toBe(true);

    [state, key] = capture(state);
    expect(state.items[0].lastRejection).toBeNull();
    state = reduce(state, { type: "LOCAL_REJECT", key, reason: "no-speech" });
    expect(state.items[0].lastRejection?.localReason).toBe("no-speech");
    expect(state.budgetUsed).toBe(0);
    expectBudgetInvariant(state);
  });

  it("rescue_local_reject_preserves_extra_and_first_low", () => {
    let state = loadReference(play(start("challenge"), scored(40)));
    const firstLow = state.items[0].firstLowAttemptId;
    expect(firstLow).not.toBeNull();
    const [capturing, key] = capture(state);
    expect(capturing.phase).toBe("recording");
    state = capturing;
    state = reduce(state, { type: "LOCAL_REJECT", key, reason: "no-speech" });
    expect(state.phase).toBe("rescue");
    expect(state.extraUsed).toBe(0);
    expect(state.budgetUsed).toBe(1);
    expect(state.hearts).toBe(2);
    expect(state.items[0].firstLowAttemptId).toBe(firstLow);
    expect(state.items[0].verdict).toBe("relisten");
    expect(state.items[0].referenceLoad).toBe("ready");
    expect(nextCapture(state)).toEqual({ purpose: "rescue", slot: "extra" });
    expect(canRecord(state)).toBe(true);
    expectBudgetInvariant(state);
  });

  it("duplicate_stale_and_submitted_local_reject_are_noops", () => {
    const [capturing, key] = capture(start("route"));
    const rejected = reduce(capturing, { type: "LOCAL_REJECT", key, reason: "too-short" });
    expect(reduce(rejected, { type: "LOCAL_REJECT", key, reason: "too-short" })).toBe(rejected);
    expect(reduce(capturing, { type: "LOCAL_REJECT", key: { ...key, runId: "other" }, reason: "too-short" })).toBe(capturing);
    expect(reduce(capturing, { type: "LOCAL_REJECT", key: { ...key, attemptId: "other" }, reason: "too-short" })).toBe(
      capturing
    );

    const [sent, sentKey] = send(start("route"));
    expect(reduce(sent, { type: "LOCAL_REJECT", key: sentKey, reason: "too-short" })).toBe(sent);
    const paused = reduce(capturing, { type: "PAUSE", runId: RUN });
    expect(reduce(paused, { type: "LOCAL_REJECT", key, reason: "no-speech" })).toBe(paused);
  });

  it("terminal_phases_are_never_paused", () => {
    // Quit while paused ends on an unpaused summary, keeping its attempts.
    let state = play(start("challenge"), scored(90));
    state = reduce(state, { type: "PAUSE", runId: RUN });
    expect(state.paused).toBe(true);
    const quit = reduce(state, { type: "QUIT", runId: RUN });
    expect(quit).toMatchObject({ phase: "summary", endReason: "quit", paused: false });
    expect(quit.items[0].attempts).toHaveLength(1);

    // Pause in summary and in review changes nothing.
    expect(reduce(quit, { type: "PAUSE", runId: RUN })).toBe(quit);
    const review = reduce(quit, { type: "OPEN_REVIEW", runId: RUN });
    expect(review.phase).toBe("review");
    expect(reduce(review, { type: "PAUSE", runId: RUN })).toBe(review);

    // A paused run whose in-flight result exhausts the last heart also ends unpaused.
    let hearts = play(start("challenge"), scored(40));
    hearts = advance(rescue(hearts, scored(40)));
    hearts = loadReference(play(hearts, scored(40)));
    const [sent, key] = send(hearts);
    const paused = reduce(sent, { type: "PAUSE", runId: RUN });
    const ended = reduce(paused, { type: "SCORE_RECEIVED", key, response: scored(40) });
    expect(ended).toMatchObject({ endReason: "hearts-exhausted", phase: "summary", paused: false });
  });
});

describe("run configurations", () => {
  // Uses every extra of the current item's rescue: a low first reading, then unjudged rescues
  // until the pool is empty. Returns the state after the last extra.
  function lowThenUnjudged(state: RunState, first: number, unjudged: number): RunState {
    let next = loadReference(play(state, scored(first)));
    for (let i = 0; i < unjudged; i += 1) next = play(next, noMatch);
    return next;
  }

  it("config_matrix_is_exact_and_start_freezes_it", () => {
    const config = { ...TARGET_85 };
    const state = reduce(null, { type: "START", runId: RUN, config, prompts: prompts() });
    expect(state.config).toEqual(TARGET_85);
    expect(Object.isFrozen(state.config)).toBe(true);
    expect(state.mode).toBe("challenge");
    expect(state.hearts).toBe(2);
    expect(state.items.every((item) => item.cannotConfirmReason === null)).toBe(true);
    // The caller's object cannot change the accepted run.
    (config as { maxExtra: number }).maxExtra = 2;
    expect(state.config.maxExtra).toBe(4);

    const route = start(ROUTE_12);
    expect(route).toMatchObject({ mode: "route", hearts: null, extraUsed: 0 });
    expect(route.items).toHaveLength(12);
    expect(route.config).toEqual(ROUTE_12);
  });

  it("defensive_reducer_rejects_invalid_start", () => {
    const deck = prompts();
    const invalid: [unknown, readonly RunPrompt[]][] = [
      [{ source: "starter", mode: "challenge", length: 12, target: 60, maxExtra: 4 }, prompts(12)],
      [{ ...TARGET_85, maxExtra: 2 }, deck],
      ["challenge", deck],
      [ROUTE_12, deck],
      [ROUTE_6, prompts(12)],
      [wordsConfig(6), deck],
      [ROUTE_6, deck.map((p, i) => (i === 1 ? { ...p, itemId: "item-0" } : p))],
      [ROUTE_6, deck.map((p, i) => (i === 1 ? { ...p, text: "WORD0" } : p))],
      [ROUTE_6, deck.map((p, i) => (i === 2 ? { ...p, stage: "context" as const } : p))],
      [ROUTE_6, deck.map((p, i) => (i === 5 ? { ...p, targetPhoneme: "v" } : p))]
    ];
    const existing = play(start("challenge"), scored(90));
    for (const [config, candidate] of invalid) {
      const action = { type: "START", runId: "run-2", config, prompts: candidate } as RunAction;
      expect(runReducer(null, action)).toBeNull();
      expect(runReducer(existing, action)).toBe(existing);
    }
  });

  it("target60_59_6_vs_60_and_target85_84_9_vs_85", () => {
    for (const [config, below, at] of [
      [TARGET_60, 59.6, 60],
      [TARGET_85, 84.9, 85]
    ] as const) {
      const low = play(start(config), scored(below));
      expect(low.items[0]).toMatchObject({ resolution: "open", verdict: "relisten" });
      expect(low.phase).toBe("rescue");
      expect(nextCapture(low)).toEqual({ purpose: "rescue", slot: "extra" });
      const pass = play(start(config), scored(at));
      expect(pass.items[0]).toMatchObject({ resolution: "resolved", verdict: "passed" });
      expect(pass.phase).toBe("feedback");
    }
    // Target 60 is unchanged from v2: an 80 passes there, while Target 85 asks for a rescue.
    expect(play(start(TARGET_60), scored(80)).items[0].verdict).toBe("passed");
    expect(play(start(TARGET_85), scored(80)).items[0].verdict).toBe("relisten");
    // Route never judges against a target.
    expect(play(start(ROUTE_12), scored(20)).items[0].verdict).toBe("practiced");
  });

  it("target85_80_then_82_loses_one_heart", () => {
    let state = play(start(TARGET_85), scored(80));
    const firstLow = state.items[0].firstLowAttemptId;
    state = rescue(state, scored(82));
    expect(state.items[0]).toMatchObject({ resolution: "resolved", verdict: "heart-lost", firstLowAttemptId: firstLow });
    expect(state.items[0].attempts[0].result?.scores.accuracy).toBe(80);
    expect(state.hearts).toBe(1);
    expect(state.extraUsed).toBe(1);
    expect(state.phase).toBe("feedback");
    // The item is settled: no third reading can farm a heart or a score.
    expect(canRecord(state)).toBe(false);
    expectBudgetInvariant(state);
  });

  it("target85_80_then_88_saves_first_reading", () => {
    let state = play(start(TARGET_85), scored(80));
    const firstLow = state.items[0].attempts[0].key.attemptId;
    // An unjudged rescue keeps the first-low evidence and waits for a valid one.
    state = play(loadReference(state), noMatch);
    expect(state.phase).toBe("rescue");
    expect(state.items[0].firstLowAttemptId).toBe(firstLow);
    state = play(state, scored(88));
    expect(state.items[0]).toMatchObject({ resolution: "resolved", verdict: "saved", firstLowAttemptId: firstLow });
    expect(state.items[0].attempts[0].result?.scores.accuracy).toBe(80);
    expect(state.hearts).toBe(2);
    expect(state.extraUsed).toBe(2);
    expectBudgetInvariant(state);
  });

  it("route12_and_target85_share_four_extras", () => {
    // Target 85: rescues and unjudged re-records draw on one pool of four.
    let challenge = play(lowThenUnjudged(start(TARGET_85), 80, 1), scored(88));
    expect(challenge.items[0].verdict).toBe("saved");
    expect(challenge.extraUsed).toBe(2);
    challenge = play(advance(challenge), noMatch);
    expect(nextCapture(challenge)).toEqual({ purpose: "rerecord", slot: "extra" });
    challenge = play(challenge, scored(70));
    expect(challenge.extraUsed).toBe(3);
    expect(nextCapture(challenge)).toEqual({ purpose: "rescue", slot: "extra" });
    challenge = rescue(challenge, scored(95));
    expect(challenge.items[1].verdict).toBe("saved");
    expect(challenge.extraUsed).toBe(4);
    // Every remaining item still has its own main slot.
    challenge = advance(challenge);
    expect(nextCapture(challenge)).toEqual({ purpose: "initial", slot: "main" });
    expect(challenge.budgetUsed).toBe(2 + 4);
    expectBudgetInvariant(challenge);

    // Route 12: four unjudged re-records, then none; the item can still be left.
    let route = start(ROUTE_12);
    for (let i = 0; i < 4; i += 1) {
      route = play(route, noMatch);
      expect(route.extraUsed).toBe(i);
      expect(nextCapture(route)).toEqual({ purpose: "rerecord", slot: "extra" });
    }
    route = play(route, noMatch);
    expect(route.extraUsed).toBe(4);
    expect(nextCapture(route)).toBeNull();
    expect(canRecord(route)).toBe(false);
    expect(route.items[0].verdict).toBe("no-match");
    expect(canAdvance(route)).toBe(true);
    route = advance(route);
    expect(nextCapture(route)).toEqual({ purpose: "initial", slot: "main" });

    // Target 60 and Route 6 keep two.
    let target60 = advance(lowThenUnjudged(start(TARGET_60), 40, 2));
    expect(target60.extraUsed).toBe(2);
    target60 = play(target60, scored(40));
    expect(target60.items[1].verdict).toBe("cannot-confirm");
  });

  it("fifth_needed_extra_cannot_confirm_without_heart_loss", () => {
    let state = advance(lowThenUnjudged(start(TARGET_85), 80, 4));
    expect(state.items[0]).toMatchObject({ verdict: "cannot-confirm", cannotConfirmReason: "rescue-budget" });
    expect(state.extraUsed).toBe(4);
    expect(state.hearts).toBe(2);

    // A later first low with the pool empty is not confirmed and costs nothing.
    state = play(state, scored(84.9));
    expect(state.items[1]).toMatchObject({
      resolution: "unjudged",
      verdict: "cannot-confirm",
      cannotConfirmReason: "rescue-budget"
    });
    expect(state.items[1].firstLowAttemptId).not.toBeNull();
    expect(state.hearts).toBe(2);
    expect(state.challengeIncomplete).toBe(true);
    expect(state.phase).toBe("feedback");
    expect(canRecord(state)).toBe(false);
    expect(canAdvance(state)).toBe(true);
    expectBudgetInvariant(state);
  });

  it("unjudged_first_reading_with_empty_pool_has_no_low_evidence", () => {
    let state = advance(lowThenUnjudged(start(TARGET_85), 80, 3));
    state = rescue(state, scored(90));
    expect(state.extraUsed).toBe(4);
    state = play(advance(state), noMatch);
    expect(state.items[1]).toMatchObject({
      resolution: "unjudged",
      verdict: "cannot-confirm",
      cannotConfirmReason: "unjudged-budget",
      firstLowAttemptId: null
    });
    expect(state.hearts).toBe(2);
    expect(state.challengeIncomplete).toBe(true);
  });

  it("failed_reference_records_reference_unavailable", () => {
    const failed = loadReference(play(start(TARGET_85), scored(80)), false);
    expect(failed.items[0]).toMatchObject({ verdict: "cannot-confirm", cannotConfirmReason: "reference-unavailable" });
    expect(failed.extraUsed).toBe(0);
    expect(failed.hearts).toBe(2);

    const declined = reduce(play(start(TARGET_85), scored(80)), { type: "CANNOT_CONFIRM", runId: RUN, itemId: "item-0" });
    expect(declined.items[0]).toMatchObject({ verdict: "cannot-confirm", cannotConfirmReason: "reference-unavailable" });
  });

  it("refund_once_at_extra_slot_four", () => {
    let state = lowThenUnjudged(start(TARGET_85), 80, 3);
    expect(state.extraUsed).toBe(3);
    const [sent, key] = send(state);
    expect(sent.extraUsed).toBe(4);
    expect(canSubmit(sent, key)).toBe(false);
    const rejected: RunAction = { type: "SCORE_FAILED", key, failure: { kind: "rejected", message: "Too long" } };
    state = reduce(sent, rejected);
    expect(state.extraUsed).toBe(3);
    expect(state.phase).toBe("rescue");
    expect(reduce(state, rejected)).toBe(state);
    expectBudgetInvariant(state);
    // The refunded slot is usable again, once.
    state = play(state, scored(88));
    expect(state.items[0].verdict).toBe("saved");
    expect(state.extraUsed).toBe(4);
    expectBudgetInvariant(state);
  });

  it("unknown_does_not_refund_or_retry", () => {
    const state = lowThenUnjudged(start(TARGET_85), 80, 3);
    const [sent, key] = send(state);
    const unknown = reduce(sent, { type: "SCORE_FAILED", key, failure: { kind: "unknown", message: "Network" } });
    expect(unknown.extraUsed).toBe(4);
    expect(unknown.items[0]).toMatchObject({ resolution: "pending", verdict: "pending" });
    expect(unknown.challengeIncomplete).toBe(true);
    expect(canRecord(unknown)).toBe(false);
    expect(nextCapture(unknown)).toBeNull();
    // A late answer for the same take is not accepted.
    expect(reduce(unknown, { type: "SCORE_RECEIVED", key, response: scored(90) })).toBe(unknown);
    expectBudgetInvariant(unknown);
  });

  it("local_reject_preserves_main_and_rescue_budget", () => {
    let [state, key] = capture(start(TARGET_85));
    state = reduce(state, { type: "LOCAL_REJECT", key, reason: "too-short" });
    expect(state).toMatchObject({ budgetUsed: 0, mainItemIdsUsed: [], extraUsed: 0, phase: "ready" });

    state = lowThenUnjudged(state, 80, 3);
    const firstLow = state.items[0].firstLowAttemptId;
    [state, key] = capture(state);
    state = reduce(state, { type: "LOCAL_REJECT", key, reason: "no-speech" });
    expect(state).toMatchObject({ extraUsed: 3, phase: "rescue" });
    expect(state.items[0].firstLowAttemptId).toBe(firstLow);
    expect(nextCapture(state)).toEqual({ purpose: "rescue", slot: "extra" });
    expectBudgetInvariant(state);
  });
});
