# Game Mode v3 Implementation Plan

**Goal:** Implement four starter configurations plus My words Route 6/12, source-aware replay/summary actions, N-normalized scoring, compatible starter PBs and the approved 60-item pack, as in [the v3 design](../design/game-mode-v3.md).

**Authority:** [the owner decisions](../design/game-mode-v3-decisions.md), including the My words, mockup and content-approval addendum, and the lead's acceptance of every design-review finding. Earlier discussion proposals do not override these decisions.

**Architecture:** Extend the existing frozen deck and reducer with a validated, immutable RunConfig. Keep pure selectors, the persistent controller, session/audio ownership, short-score API, and once-per-run PB receipt. Route preview uses existing cancellable speech. B renders A's facts and invokes callbacks; it never reimplements target/budget/scoring rules. Backend implementation changes are limited to approved starter-text allowlist parity; additional fake-service tests pin existing SRS and public word-bank capacity behavior.

**Tech stack:** Existing React/TypeScript, Vitest/Testing Library, SVG/CSS, MediaRecorder/WebAudio, Python/pytest fake-service tests. No new dependencies.

**Baseline / progress:** Runtime-code baseline remains `7995c5e3b095f8e7c7239ab6085b8bf517b02299`; work is now on `feat/game-mode-v3`. A1 landed in `83c1113`; the owner approved all 60 r1 rows in `ceb6144`, the current HEAD at this revision. The tree was clean. Code-line references remain against the unchanged runtime baseline, with corrected anchors below. A5 approval is satisfied; runtime integration remains pending. Preserve shared-tree work; this plan does not authorize deployment, pushing, paid API experiments, or quota changes.

**Estimate:** Add A7 (9–13 h, including 1–2 h for public-mode test fixtures) and B7 (6–9 h) for My words: original 52–76 h becomes **67–98 engineer-hours** (A 37–53, B 30–45). A1's planned 4–6 h is delivered, leaving approximately **63–92 h**, around 8–12 person-days / 7–10 parallel working days including integration. Actual elapsed effort is not inferred from these estimates. Content approval no longer adds a wait; A5 integration and any later changed-text review remain separate. Whole-v3 merge still waits for final verification; no partial release/flag. New A7/B7 execute before A6/B6 without renumbering the earlier tasks.

## File ownership

| Owner | Exclusive write scope |
| --- | --- |
| A — impl-core | `frontend/src/types.ts`; `frontend/src/game/*.ts` and their tests, including new `runConfig.ts`, runDeck/runModel/scoring/personalBest/preferences/sfx/starterPack; `frontend/src/game/starterPack.json`; `frontend/src/hooks/*` and tests; `frontend/src/usePracticeSession.ts` and its test |
| A — explicit component exception | `frontend/src/components/PublicGate.tsx`, `PublicGate.test.tsx` only; v3 plans changes to the test only, since the component already calls clearRunStorage |
| A — content/privacy/backend/evidence | `PRIVACY.md`, `docs/CONTENT-PROVENANCE.md`, existing A1 `docs/materials/game-mode-v3-content-review.md`, `backend/app/main.py` (starter allowlist only), `backend/tests/test_game_starter_cache.py`, `backend/tests/test_api.py` (existing SRS behavior tests only), new `backend/tests/test_public_word_bank.py` (existing public capacity behavior tests only), new `docs/testing/game-mode-v3-core-checks.md` |
| B — impl-ui | `frontend/src/components/*` except PublicGate and its test; includes `useReplay.ts`, its new test, existing `runV2Fixtures.ts`, and new `runV3Fixtures.ts`; `frontend/src/game/game.css`; `frontend/src/mobile/*` including screens, styles, and tests |
| B — evidence | New `docs/testing/game-mode-v3-acceptance.md` and `docs/testing/game-mode-v3-device-checklist.md`; task-owned layout evidence under `docs/testing/game-mode-v3-evidence/` |
| Lead | Final design/plan publication and adjudication. Executors do not edit these specifications to excuse a failing test. |

`types.ts` has one writer (A). `game.css` has one writer (B). The component exception is explicit; A's ownership of hooks does not include B's `components/useReplay.ts`. Same-track tasks revisit their own files in dependency order; cross-track changes go to the owner. `api.ts`, backend quota/config/service code, ordinary score utilities, and dependencies are read-only. Existing late-speech/microphone guards and VAD are verified with tests, not rewritten in this plan. `useSpeech.ts`, `usePracticeSession.ts`, recorder/VAD implementation, `sfx.ts` and `PublicGate.tsx` remain unchanged for the listed work; their A-owned tests may be extended. A newly demonstrated defect requires a separately scoped fix.

---

### Task 0: Freeze Day 1 contracts and typed fixtures

**Objective / deliverables:** Shared configuration vocabulary, source-aware type-level B scaffolding, and migration of existing six-item fixtures to START(config). Four-variant run-state fixtures wait for A2/A3.

**Files:** A — `frontend/src/types.ts` (new shared declarations). B — new `frontend/src/components/runV3Fixtures.ts`, existing `runV2Fixtures.ts` and affected component test fixtures; `PracticeRun.tsx` and `RunReview.tsx` for their STAGE_LABELS words keys only. No CSS or recorder work.

**Depends on:** Approved decisions and this contract review. **Estimate:** A 2 h; B 1 h.

- [ ] Freeze the signatures below, source-specific validation/PB rules, key bytes, preference schema, planned N, seed/order rules and starter-Route-only Next sound. My words accepts only exact 6/12, uses approved variant B and no new persisted choice.
- [ ] A publishes shared standalone types first. Apply the active RunState/START union migration atomically with A2's reducer/controller compatibility changes; B updates its fixtures in the same integration checkpoint. Do not leave an unhandled START shape in a green intermediate build.
- [ ] B creates type-level scaffolding for four starter and two words configs and migrates only existing six-item fixtures at the A2 START(config) checkpoint. Real Route 12/Target 85 states and selector-derived scores follow A2/A3 during B2/B3. No unsafe RunState casts, hand-computed replacement selectors, or future-state fixtures passed through the old reducer.
- [ ] Freeze the cross-track compile handoff: A retains the `MAX_EXTRA_ATTEMPTS` export while B's PracticeRun still imports it; A's rules stop using it in A2. B switches to `maxScores` in B4 and reports the last import removed, then A removes the obsolete export during A6. Coordinate A3's bucket signature with B1's `RunHero.tsx:52` migration.
- [ ] Freeze the stage-union handoff: when A adds `"words"` to RunPrompt.stage, B adds `words: "My words"` to both `PracticeRun.tsx:41` and `RunReview.tsx:22` STAGE_LABELS maps at the same Task 0 checkpoint. RunStones' words group and words visual fixtures/acceptance wait for B7; its current fixed STAGES iteration must not be used as proof that words render.
- [ ] Preserve v2 RunRing props, capture contracts, stop reasons, telemetry store, receipt, and consumed-feedback identities. New UI props are callbacks/facts, not permission to acquire audio or mutate a run.

**Acceptance:** `v3_contract_fixtures_typecheck` (production TypeScript build, including both exhaustive STAGE_LABELS maps); `four_starter_and_two_words_configs_are_constructible` (compile-time invalid examples plus runtime validation in A2). Fixtures contain no unsafe casts or runtime imports of the review document or test-only content.

## Day 1 Contract Draft

The following declarations are the cross-track agreement. Shared domain types belong to A in `types.ts`; implementations stay in the listed A modules. B owns component prop declarations and imports these types.

```ts
export type RunMode = "route" | "challenge"; // Existing vocabulary, unchanged.
export type RunLength = 6 | 12;
export type RunFocusPhoneme = "θ" | "ð" | "ɹ" | "l" | "v";
export type RunSelection = "route" | "target60" | "target85";
export type StarterRunConfig = Readonly<
  | { source: "starter"; mode: "route"; length: 6; target: null; maxExtra: 2 }
  | { source: "starter"; mode: "route"; length: 12; target: null; maxExtra: 4 }
  | { source: "starter"; mode: "challenge"; length: 6; target: 60; maxExtra: 2 }
  | { source: "starter"; mode: "challenge"; length: 6; target: 85; maxExtra: 4 }
>;
export type WordsRunConfig = Readonly<
  | { source: "words"; mode: "route"; length: 6; target: null; maxExtra: 2 }
  | { source: "words"; mode: "route"; length: 12; target: null; maxExtra: 4 }
>;
export type RunConfig = StarterRunConfig | WordsRunConfig;
// RunPrompt.stage adds "words"; RunPrompt.source adds "word-bank" | "run-review".
// Same Task 0 checkpoint: B adds words: "My words" to both STAGE_LABELS maps; stones wait for B7.
// Word prompts have targetPhoneme:null; no invented focus/stage split.
export type RunChoice = Readonly<{
  selection: RunSelection; routeLength: RunLength;
}>;
export type RunStartAction = Readonly<{
  type: "START"; runId: string; config: RunConfig;
  prompts: readonly Readonly<RunPrompt>[];
}>;
// Replace START in RunAction with RunStartAction; do not accept independent mode/target overrides.
// RunState gains readonly config: RunConfig. Existing mode remains a read-only compatibility
// field assigned ONLY from config.mode at START; consumers can migrate without split authority.
// extraUsed becomes 0 | 1 | 2 | 3 | 4; reducer enforces <= config.maxExtra.

// game/runConfig.ts — pure, no preferences/storage/audio imports.
export function configForChoice(choice: RunChoice): StarterRunConfig;
export function wordsConfig(length: RunLength): WordsRunConfig;
export function isRunConfig(value: unknown): value is RunConfig;
export function maxCountedScores(config: RunConfig): number;
export function nextFocusPhoneme(focus: RunFocusPhoneme): RunFocusPhoneme;

// game/runDeck.ts — generate runId before deck construction, not after it.
export type RevisitWordSeed = Readonly<{
  word: string; // Trimmed original case; never replace display/reference with singleWordKey.
  firstAccuracy: number; itemIndex: number;
  itemId: string; attemptId: string;
}>;
export type RunDeckInput = Readonly<{ runId: string }> & (
  | { config: StarterRunConfig; focusPhoneme: RunFocusPhoneme;
      vocabulary: VocabularyItem[]; previousWeakWords?: readonly string[] }
  | { config: WordsRunConfig; vocabulary: VocabularyItem[];
      dueWordIds: readonly string[]; reviewSeeds?: readonly RevisitWordSeed[] }
);
export function chooseFocusPhoneme(stats: readonly PhonemeStat[]): RunFocusPhoneme;
export function singleWordKey(text: string): string; // Export/reuse current implementation; acceptance/dedupe key only.
export function buildRunDeck(input: RunDeckInput): readonly Readonly<RunPrompt>[];
// Controller snapshots existing getDueWordsForReview ordering once from canonically ordered
// bank rows. Pure words builder consumes dueWordIds, no Date.now/storage inside its ranking.
// Starter: exact N/3 per stage/focus; words: exact N single-word "words" prompts, no focus.
export function selectRevisitWordSeeds(run: RunState): readonly RevisitWordSeed[];
// First valid raw overall <85; targetWord only for sentences; seeds never depend on latest rescue.
// game/scoring.ts — pure selectors, all coefficients derive from planned N.
export function selectRunScore(run: RunState): RunScoreView;
// N comes only from run.config.length; no public override or partial-run rescaling parameter.
export function ratingForPoints(points: number, fullCombo: boolean): RunRating;
export function selectPractisedCount(run: RunState): number;
// Count slots with a first valid reading once. No attempt-count or reached-slot approximation.

// game/personalBest.ts — frozen config selects the bucket; existing record schema stays intact.
export type RunBestBucket = Readonly<{
  config: StarterRunConfig; focus: string | null; rulesVersion: number;
}>;
export function bestBucketForRun(run: RunState): RunBestBucket | null; // null for words; never read/write PB.
export function bestBucketKey(bucket: RunBestBucket): string;
// base = `${config.mode}|${focus ?? ""}|${rulesVersion}`
// Starter Route 6 / Target 60: base; Route 12: `${base}|12`; Target 85: `${base}|85`.

// game/preferences.ts — separate typed entry-choice API; retain existing boolean preferences.
export const RUN_CONFIG_KEY = "jt.runConfig.v1";
export function getRunChoice(): RunChoice;
export function setRunChoice(choice: RunChoice): void;
export function useRunChoice(): RunChoice;
// RunChoice persists starter selection only; Words length/seeds live in memory, no new key.
// clearRunStorage adds RUN_CONFIG_KEY, preserving existing deletion semantics.
```

The preference parser validates untrusted persisted **RunChoice**, then configForChoice produces a valid RunConfig. In `start()`, validate/copy/freeze RunConfig before awaiting data, and validate the built deck before `teardown(true)`, enterRun, or resetRunLifetime. Invalid config/deck must **throw from start()**, giving the existing error owner a rejected promise while preserving the previous run/receipt/URLs. Reducer START validation is defense in depth, not the user-visible failure path. Keep the start-token check before accepting data or touching old state; do not use widening casts for budget arithmetic.

```ts
// Additions/changes to hooks/usePracticeRun.ts return contract.
type RunControllerV3 = {
  config: RunConfig | null; // state?.config; entry choice remains separate.
  starting: boolean;        // Existing controller-owned start-token flag.
  maxScores: number | null;
  practisedCount: number;
  nextSoundPhoneme: RunFocusPhoneme | null; // Starter Route only; null for words.
  start(config: RunConfig): Promise<void>;
  playAgain(): Promise<void>; // Frozen source/config; starter stats policy / fresh active-word bank.
  nextSound(): Promise<void>; // Terminal starter Route only; no-op for words, never changes source.
  hearFirst(): void;          // Ready, unpaused Route only; never an implicit play.
  hearNextFirst(): void;      // Approved B, both Route sources: ADVANCE then preview new item.
  startWords(length: RunLength): Promise<void>; // Words entry; same private start/token lifecycle.
  runWithRevisitWords(): Promise<void>; // Any terminal run -> words Route of same length.
  revisitWordSeeds: readonly RevisitWordSeed[];
  wordsEntry: Readonly<{ eligibleCount: number; canStart6: boolean; canStart12: boolean }>;
  revisitWords: Readonly<{ seedCount: number; eligibleCount: number; canStart: boolean;
    reason: "no-seeds" | null }>; // canStart/seedCount use run-local seeds only.
  // eligibleCount is a cached-bank hint, never a Summary disable condition; fresh Start validates.
  // General busy/starting guards apply separately.
  // Existing record, stop, cancelTake, playReference, stopReference, pause/resume,
  // quit/exit, receipt, telemetryStore, consumedFeedbackIds and preferences remain.
};
// A-owned private start helper may accept previousWeakWords and a focus override.
// Do not expose arbitrary mutable target/length setters for an active run.

// B-owned components/useReplay.ts — extend the existing owner, do not mount one per surface.
// Final contract: B4 implements play-again/next-sound; B7 adds revisit-words after A7.
// No placeholder action before the matching controller API is available.
type RestartKind = "play-again" | "next-sound" | "revisit-words";
type RestartActions = Record<RestartKind, () => Promise<void>>;
declare function useReplay(actions: RestartActions, runId: string | null): {
  failed: boolean;
  failedAction: RestartKind | null;
  restart(kind: RestartKind): void;
  retry(): void;
  abandon(): void;
};
// PracticeScreen owns this hook above Summary/Review; callbacks call A synchronously in the
// gesture, not after a timer/effect. Retry repeats the failed action. Done calls abandon + exit.
```

B's RunHero starts StarterRunConfig only; WordsScreen calls startWords. PracticeRun binds onHearFirst/onHearNextFirst (approved B), onNextSound, onRunWithRevisitWords and A's counts/availability; it never ranks candidates. Extend RunSession's vocabulary read boundary for wordsEntry preview; Start refreshes the bank. Summary/Review share all three restart error identities; only starter Route exposes Next sound, and every Summary exposes the revisit action. bestBucketForRun=null makes receipt null without a storage call; mark terminal receipt processing once even when skipped. Words entry pending/error ownership lives above WordsScreen/PracticeScreen unmounts in MobileApp, with start invoked synchronously inside the gesture. Keep the existing screen-level restart owner for terminal actions.

Cannot-confirm reason is a reducer fact: add `RunItem.cannotConfirmReason: "rescue-budget" | "unjudged-budget" | "reference-unavailable" | null`, initialized/reset at the relevant transitions. An exhausted pool with first-low evidence sets rescue-budget; an unjudged/NoMatch first reading with no retry allowance sets unjudged-budget (no valid low exists). Failed reference sets reference-unavailable; voluntary Skip stays skipped. Copy respectively says “No rescue scores left…”, “No extra scores left · this item has no valid reading…”, or reference unavailable; all retain “No heart lost.” UI does not infer a prior low from pool exhaustion.

---

### Task A1: Draft the 60-row content review, without runtime integration

**Status:** Delivered as a drafting task in `83c1113` on feat/game-mode-v3: the 60-row r1 review and provenance link exist, with all 60 r1 rows subsequently approved in ceb6144. Do not repeat drafting or integrate this content early. The checklist below records the delivered artifact scope, not independent phonetic verification. A1 handoff is incorporated into A4/A5: pack-shape hardcodes, runDeck.test's 2-2-2 assertions, and no mandatory context-3/focus pairing in six-item sampling.

**Objective / deliverables:** Exactly 30 proposed additions plus the actual existing 30 in one owner-review artifact.

**Files:** A — create `docs/materials/game-mode-v3-content-review.md`; modify `docs/CONTENT-PROVENANCE.md` only to identify the draft and its status. Read runtime pack/allowlist; do not edit them here.

**Depends on:** Completed drafting/approval record. **Original estimate:** 4–6 h; not remaining work.

- [x] Deliver the existing 30 entries plus two proposed words/sentences per stage per phoneme, in the r1 table. Existing text remains unchanged; runtime JSON/allowlist are unchanged by A1.
- [x] Include ID, existing/new, phoneme, stage, text, targetWord, sound position, status, pronunciation assumptions, and owner-decision space. AI judgments are explicitly not independent phonetic verification.
- [x] Record AI-assisted drafting/provenance; ceb6144 subsequently approves all r1 rows. A5 updates residual historical row labels/provenance without requesting approval again.
- [x] Owner approved exact r1 wording/metadata (ceb6144); A5 may proceed. Later changed text alone would require new review.

**Acceptance / evidence:** A1's table has 60 rows/30 additions and unchanged existing 30; its commit has no runtime-pack diff. Owner approval is explicit in ceb6144. These structural/progress facts do not claim independent phonetic validation or completed A5 integration.

### Task A2: Freeze configuration and generalize reducer budgets/targets

**Objective / deliverables:** Valid six-configuration source-aware RunConfig, target-based Challenge judgments, correct 0–4 shared pool, and Start/deck validation.

**Files:** A — `types.ts`; new `game/runConfig.ts`, `runConfig.test.ts`; `game/runModel.ts`, `runModel.test.ts`; `hooks/usePracticeRun.ts` and its test only for the minimal Start/config compatibility bridge. B handles its own fixture/call-site migration through Task 0/B1.

**Depends on:** Task 0. **Estimate:** 5–7 h.

- [ ] Implement pure config constructors/validation, maximum cost, and fixed phoneme cycle. Keep `RunMode` and PASS_ACCURACY unchanged; widen budget types without unchecked 1|2 / 0|1 assertions.
- [ ] Controller start snapshots config and throws on invalid config or deck **before teardown(true)**; enforce exact size, unique IDs/text and source-specific shape (starter N/3 stages/focus; words N single words without focus). Reducer validates defensively. A starter twelve-item start against the old production pack rejects without erasing old results; six-item starts remain usable on the feature branch.
- [ ] Use `config.target` solely for Challenge comparisons and `config.maxExtra` in capture/send/refund bounds. Remove A's rule reliance on MAX_EXTRA_ATTEMPTS but keep its export until B4 removes B's imports; A6 deletes it after the handoff.
- [ ] Preserve first valid accuracy/first-low evidence across unjudged retries; valid rescue ends that item and loses at most one heart. Record cannot-confirm cause for exact copy.
- [ ] Retain duplicate/stale no-ops, confirmed heart-loss resolution, skip-rescue semantics, unknown continuation, pause/terminal/quit behavior, and LOCAL_REJECT before any budget reservation.

**Acceptance:** `config_matrix_is_exact_and_start_freezes_it`; `invalid_start_throws_before_teardown_and_preserves_results`; `defensive_reducer_rejects_invalid_start`; `target60_59_6_vs_60_and_target85_84_9_vs_85`; `target85_80_then_82_loses_one_heart`; `target85_80_then_88_saves_first_reading`; `route12_and_target85_share_four_extras`; `fifth_needed_extra_cannot_confirm_without_heart_loss`; `unjudged_first_reading_with_empty_pool_has_no_low_evidence`; `refund_once_at_extra_slot_four`; `unknown_does_not_refund_or_retry`; `local_reject_preserves_main_and_rescue_budget`; existing pause/quit/duplicate reducer tests.

### Task A3: Normalize score and preserve PB/preferences semantics

**Objective / deliverables:** Planned-N points, explicit S gate, byte-compatible old PB keys, and remembered entry choice with honest deletion.

**Files:** A — `game/scoring.ts/.test.ts`, `personalBest.ts/.test.ts`, `preferences.ts/.test.ts`; `game/sfx.test.ts` and `components/PublicGate.test.tsx` (tests only; their implementations already have the needed behavior); `types.ts` if needed for shared facts; `PRIVACY.md`. No B-owned render files.

**Depends on:** A2. **Estimate:** 5–7 h.

- [ ] Calculate `(9/N)Σq + 100Σsteps/(N(N−1)/2)` once, preserving floating-point summation order at .5 boundaries. Missing items break chains; current unjudged holds until left. Keep uncapped chain and first-valid score/tier semantics.
- [ ] Compute eligibility and fullCombo before calling ratingForPoints. Return A for ≥950 without fullCombo; unrated runs have no rating. Add pure practised-count selector. Keep latest-valid review evidence and low/borderline/collection thresholds unchanged.
- [ ] Implement exact key forms, keeping rules version 1 and record payload. Coordinate B1's RunHero.tsx:52 bucket call-site change at A3 integration. Exercise records inserted under actual legacy strings; record the expanded-pack content-comparability limitation for the lead's owner notice.
- [ ] Retain decision-once receipt API, higher-record write protection, first/new/tie behavior, public seven-day expiry and personal no-expiry. A4 remains the lifetime latch owner.
- [ ] Reserve the source gate now: words produces no bucket/receipt/storage access; starter null-focus compatibility stays byte-identical. A7 tests rated words and starter→words replacement against the populated actual legacy key `route||1`, asserting readBest is never called as well as no finalize/write.
- [ ] Add typed choice persistence using only `jt.runConfig.v1`; preserve the boolean preference API and per-take Auto-stop snapshots. Defaults Route/6; Target 85 switching preserves remembered Route length.
- [ ] Add the new key to clearRunStorage in preferences; PublicGate's existing call after successful server deletion needs no implementation change. Extend its tests for success/failure, unrelated keys and storage errors. Update PRIVACY's “three settings” / “these three keys” to four, with exact schema/retention.
- [ ] Add tests for existing verdict-based cue selection, without changing sfx.ts: Target 85 first 80 has relisten verdict and is quiet, 80→82 uses heart, 80→88 saved; 972 A follows A summary behavior. No new assets or audio side effects in selectors.

**Acceptance:** `v2_examples_861_930_904_978_955_865_540_unchanged`; `n12_examples_1000_955_865_540_972_927_450_822`; `s_requires_full_combo`; `partial_run_uses_config_length_and_rounds_once`; `rescue_changes_neither_q_nor_chain`; `practised_counts_valid_items_once`; `legacy_pb_keys_and_records_remain_readable`; `four_configs_have_isolated_buckets`; `receipt_first_tie_new_and_public_expiry`; `run_choice_survives_mode_switch_and_corrupt_storage`; `delete_success_only_clears_exact_game_keys`; `target85_cues_follow_verdict_not_tier`.

### Task A4: Integrate seeded decks, Hear first, and shared restart lifecycle

**Objective / deliverables:** Pure seeded selection plus controller APIs with no stale audio/start/PB regressions.

**Files:** A — `game/runDeck.ts/.test.ts`, `game/starterPack.ts` (types/helpers only before A5), `hooks/usePracticeRun.ts/.test.tsx`; `hooks/useSpeech.test.tsx`, `usePracticeSession.test.tsx` for regression coverage only. Do not change speech/session/VAD implementation: pre-mic cancellation and late-playback/error guards already exist. New item-change cancellation belongs in the controller. B owns useReplay/navigation changes.

**Depends on:** A2/A3; can test a typed 60-item synthetic pack before A5. Production twelve-item acceptance waits for A5. **Estimate:** 6–9 h.

- [ ] Allocate runId before deck construction; use a specified deterministic seeded subset algorithm (stable hash of runId + phoneme + stage, local PRNG, no Math.random). Restore chosen items to canonical pack order. Golden tests pin behavior; different seeds may legitimately choose the same subset.
- [ ] Replace all four shape hardcodes in runDeck.ts:58/66/82/88: context `[1]`, both warm-up `=== 2` limits, and `index % 2` IDs. Fill N/3 warm-ups from eligible previous weak words, due words, then seeded starters; exclude the full group's word rows and **all context targetWord values**, not only sampled contexts. Keep source metadata, normalized dedupe and stable IDs.
- [ ] Six selects 2/4 per stage; twelve uses 4/4/4, replacing only starter warm-up slots with personal words. Existing 2/2/2 production pack supports six until A5. Parameterize runDeck.test's deck assertions by N and cover a synthetic 4/4/4 pack; leave actual runtime count-of-30 assertions until A5. Stage samples are independent: context-3 and its matching focus word need not co-occur. Add a seed case proving that is allowed.
- [ ] Refactor one private start path with frozen config, weak words and optional focus override. Keep gesture-time prepareRunAudio, fallback on failed stats/vocabulary fetches, start-token ownership and disposal guard. Config/deck failures **throw before teardown(true)** (existing :199), enterRun, URL release or receipt reset; the prior results survive and the UI gets a retryable rejection. After async work, stale starts return without changing the current owner.
- [ ] Play again retains config and refreshed-stats focus policy. Next sound accepts only terminal starter Route (words is a no-op), uses the fixed successor of the old frozen focus, and shares exactly the same start/error/cancel path. Retry does not mutate the destination; new run success resets lifetime state once.
- [ ] Add guarded hearFirst for ready/unpaused Route. Test the existing pre-mic stopCurrentSpeech and playback-request guards: late TTS cannot play or set a stale error. Do not “fix” speech/VAD or suppress the existing load-result callback solely because it can harmlessly update Route referenceLoad before the request check; preserve rescue's real reference-load gate.
- [ ] Stop old-item playing/pending speech on every accepted ADVANCE/skip/recordNext/finish, before new-item playback/capture. For approved Route variant B, add hearNextFirst: accept ADVANCE once, verify a new Ready item, then call hearFirst; never play on a refused transition or at the final item. Both starter and words Routes use B; no A variant is implemented. Item-change cancellation remains required.
- [ ] On the first terminal transition, add `if (next.endReason !== null && previous?.endReason === null) session.refreshVocabulary().catch(() => undefined);` in dispatch. Keep the existing Review refresh. Do not await this for Summary or repeat it on terminal rerenders; A7 uses the preview and revalidates on Start.
- [ ] Preserve one controller above conditional screens, one receipt per run/bucket, consumed IDs, capture lock release, URL ownership, submit-before-collection sequence, and prev+next cue pause gate. No telemetry subscription that rerenders the entire run.

**Acceptance:** `seeded_deck_is_repeatable_and_canonically_ordered`; `six_samples_membership_and_twelve_has_four_per_stage`; `all_context_targets_excluded_from_personal_warmups`; `context_focus_pairs_need_not_cooccur`; `warmup_priority_dedupe_and_frozen_focus_hold`; `insufficient_pack_throws_before_teardown`; `start_snapshots_config_before_await`; `next_sound_cycles_with_same_config`; `play_again_keeps_stats_policy_not_rotation`; `existing_preview_guards_suppress_late_audio_and_error`; `hear_first_failure_does_not_block_record`; `preview_cancel_on_advance_skip_record_next_finish_pause_exit`; approved B `hear_next_first_advances_once_then_previews_ready_item`; `next_sound_failure_keeps_old_results_and_receipt`; `restart_exit_or_owner_unmount_drops_late_success_error_finally`; `pb_receipt_stays_frozen_across_tabs_expiry_and_surfaces`; `terminal_transition_refreshes_vocabulary_once` (nonblocking, rejection caught, Review refresh retained); existing recorder/session/speech suites.

### Task A5: Integrate the approved 60-item runtime pack

**Objective / deliverables:** Exact owner-approved content in both runtime pack and shared-cache allowlist; enable complete Route 12 production decks.

**Files:** A — `docs/materials/game-mode-v3-content-review.md` (approval evidence/status); `game/starterPack.json`, `starterPack.ts`, new `starterPack.test.ts`; `game/runDeck.test.ts`; `backend/app/main.py` (GAME_STARTER_TEXTS only), `backend/tests/test_game_starter_cache.py`; `docs/CONTENT-PROVENANCE.md`.

**Depends on:** A1 and approval **already satisfied by ceb6144**; remaining dependency A4. **Estimate:** 3–4 h of runtime integration; do not wait for or request duplicate approval.

- [ ] Consume the recorded approval of all r1 rows, reconcile historical status labels/provenance and integrate the exact approved text. Only later wording changes need fresh review; no new approval wait for r1.
- [ ] Integrate 60 approved rows while retaining existing IDs where text identity remains. Validate targetWord occurrence, phoneme/stage counts, duplicate IDs/text and order. Update runDeck.test.ts's runtime 30-item/2-2-2 assertions to 60/4-4-4 and inspect every context sentence instead of only destructuring the first pair; retain all six-item deck assertions that still apply. Pack-level paired examples do not impose same-run pair sampling. No level/CEFR fields.
- [ ] Synchronize exact runtime texts with GAME_STARTER_TEXTS, update the current backend count-of-30 assertion to 60, and test old and new word/sentence cache hits with fake synthesis.
- [ ] Update provenance from awaiting review only for what was actually approved. Drafts never become a general public-TTS allowlist. Keep custom texts visitor-scoped and cache-hit billing behavior unchanged.
- [ ] Run production deck tests for all five sounds × four configs, empty data and personal warm-ups. B5's test-mocked twelve-item flow can already be complete; after A5, B adds `route12_production_pack_completes_summary_review_and_replay` in its owned MobileApp test. No A edit to B files, runtime test-pack import, availability flag or partial merge to main. Lead records the owner notice that new subsets change legacy Best content comparability and that scored game words already populate the bank and may reappear in My words.

**Acceptance:** `approved_pack_has_60_unique_items_in_4_4_4_groups`; `runtime_pack_matches_approved_review_rows`; `test_starter_texts_match_frontend_and_share_cache_between_visitors` (expanded to 60 + new texts); `test_custom_text_remains_in_visitor_cache` (preserved); `all_config_decks_build_from_approved_runtime_pack`; B-owned post-A5 `route12_production_pack_completes_summary_review_and_replay`. Approval evidence is required in addition to structural tests.

### Task A7: My words config/deck/controller and existing SRS boundaries

**Objective / deliverables:** Two words-source Routes, exact-N ranking, summary-seeded runs, no PB, and one start/capture lifecycle. Added task ID executes before A6.

**Files:** A — `types.ts`, `game/runConfig.ts/.test.ts`, `runDeck.ts/.test.ts`, new `game/wordDeck.ts/.test.ts`, `scoring.ts/.test.ts`, `personalBest.ts/.test.ts`, `hooks/usePracticeRun.ts/.test.tsx`, `PRIVACY.md`; `backend/tests/test_api.py` for existing API/SRS behavior and new `backend/tests/test_public_word_bank.py` for existing public full-bank behavior. Read WordBankPanel/getDueWordsForReview, backend main/storage; do not edit those implementations or ordinary review.

**Depends on:** A2/A3/A4; independent of A5 text integration. Task 0 already reserves source/stage/API contracts. **Estimate:** 9–13 h additional (includes 1–2 h for public-mode fixture/test coverage).

- [ ] Export/reuse current singleWordKey only for acceptance/dedupe; preserve trimmed original case in bank/seed display and submitted references. Filter non-graduated bank rows, conservatively exclude graduated boundary-punctuation collisions (backend casefold keys are already unique), choose stable-ID metadata for duplicate active keys, then obtain due IDs once using existing helper order on the canonical bank snapshot; equal-date ties may differ from ordinary review API order, which stays unchanged. Pure words builder takes due IDs and ranks remaining finite latest_score ascending, null last, normalized-word/ID ties. No Math.random, new word validator or starter fallback.
- [ ] Enforce exact 6/12 and 2/4 extras. All N prompts use words stage/kind word/null phoneme; freeze IDs/text/order. Extend source-specific START validation so starter stage/focus checks never reject a valid words deck or accept malformed mixed sources. Preview availability derives from session.vocabulary; accepted Start refreshes listWords and throws shortage/fetch failure before teardown. Bank changes after acceptance do not rewrite the deck.
- [ ] Add pure selectRevisitWordSeeds: first valid overall <85; word text or explicit single-word sentence target occurring in reference; skip unknown/no-match/invalid target; dedupe by lowest qualifying q then earliest item, sort by q/index. Filter matching graduated keys against fresh bank, admit absent-bank seeds in memory (primarily sentence targets, also public full-bank insertion omissions), then due/low-score fill. Ordinary scored word prompts already enter the bank; use one shared membership filter rather than a separate missing-word mechanism. Require at least one eligible seed and N total. Tests distinguish q=84.9/85, first80→rescue88, repeated target, and a low sentence with no individually low target evidence.
- [ ] Add startWords and runWithRevisitWords to the same token-guarded private start path. Starter still has its fetch fallback; words list failure must reject. Revisit creates words Route of the old run's length (Challenge→Route6), holding old results/receipt until accepted. Words Play again keeps source/length and refreshes active bank without seeded carryover; words Next sound is unavailable/no-op. Test that existing SRS latest-score ≤ configured threshold (default 85) can make low words due again without explicit seeds; do not promise a different deck or change SRS. No fetch of phoneme stats or fake focus for words.
- [ ] bestBucketForRun returns null for words. Guard both receipt creation and all PB storage calls; prepopulate the actual `route||1` legacy key and assert no readBest, finalize or write for rated words or starter→words replacement; rated words still have score/rating/fullCombo. Do not append words to legacy keys or use null focus as a substitute. Preserve restart retry action/seeds, disposed-owner behavior, telemetry/cue/URL ownership, late callbacks, and no paid unknown retry.
- [ ] Add fake-service backend tests without backend logic changes. In new A-owned `backend/tests/test_public_word_bank.py`, follow the `_public_app` / `_visitor` approach from `test_game_starter_cache.py:32–55`, with isolated tmp data, `PublicSettings(enabled=True, max_words=1)`, allowed Origin/visitor setup and FakeScorer; no paid calls or test-class coupling. Cover: known word updates at full capacity; unknown seed still scores but is not inserted when full; NoMatch does not update; sentence score does not increment word-practice SRS. Preserve configured strictly-greater graduation comparison and distinguish it from game ≥85. Client never issues an extra record-word/update request or promises per-word persistence from a score response.
- [ ] Document no additional local storage key for My words: length/seeds in memory; explicitly retain existing backend word/history writes from actual scores. Consume A4's once-on-first-terminal-transition refresh and retained Review refresh, without optimistic SRS graduation or frozen-deck edits. Summary canStart/reason uses run-local no-seeds only; eligibleCount/shortage is a cached hint. Fresh Start rejects no surviving seeds or insufficient N before teardown, keeping retryable old results.

**Acceptance:** `words_due_order_then_low_score_null_last`; `words_single_key_dedupe_and_graduated_exclusion`; `words_preserve_display_and_reference_case` (Paris and stable-ID duplicates); `words_exact_6_12_no_padding_or_autoshrink`; `words_source_validation_has_no_fake_stages_or_focus`; `revisit_first_valid_below85_seed_order_and_target_rules`; `revisit_excludes_graduated_and_fills_after_absent_seeds`; `words_fetch_or_shortage_preserves_old_run`; `challenge_revisit_creates_route6_without_mutating_receipt`; `words_play_again_refreshes_bank_and_next_sound_is_noop`; `words_play_again_can_repeat_srs_due_low_words_without_seeds`; `summary_cached_shortage_does_not_disable_revisit`; `summary_no_local_seeds_disables_revisit`; `rated_words_never_read_write_or_finalize_pb`; `words_stale_start_blob_and_retry_guards_hold`; backend `test_full_bank_known_word_still_updates_srs`, `test_full_bank_unknown_word_scores_without_insertion`, `test_score_endpoint_skips_persisting_no_match_result`, `test_single_word_score_updates_word_bank_practice_score`, `test_single_word_practice_graduates_word_and_status_filter_separates_it` (existing test_api regressions), and `test_sentence_score_does_not_increment_word_practice`.

### Task A6: Core integration regressions and evidence handoff

**Objective / deliverables:** Artifact-backed core acceptance, including old race counterexamples and honest limits.

**Files:** A — new `docs/testing/game-mode-v3-core-checks.md`; fixes only in A-owned files already listed. No edits to B's evidence or UI.

**Depends on:** A2–A5, A7, B5 and B7, including B's post-A5 production Route 12 test for final end-to-end sign-off. Core regression preparation can run before A5 integration. **Estimate:** 3–5 h.

- [ ] Run focused/core/full checks below; record exact revision, commands, exits, failures, and existing warnings. Repair A-owned failures and give B concrete seam evidence.
- [ ] After B4 confirms its last MAX_EXTRA_ATTEMPTS import is gone, A removes the obsolete export and verifies no remaining consumers. Never delete it before the cross-track handoff.
- [ ] Execute all rows of the preserved-v2 matrix below, retaining prior regression assertions instead of replacing them with only happy-path v3 tests.
- [ ] Report actual VAD parameters/limits as unchanged. Supply the core/device observations to B for the unified checklist; do not mark browser policy, layouts, or physical audio verified from fake tests.

**Acceptance:** `v3_core_regressions_recorded` — actual command output and test coverage mapping, no unresolved core regression; content gate evidence attached. Unavailable device checks remain Not verified.

### Task B1: Entry choices, configuration copy, and PB preview

**Objective / deliverables:** Compact three-way entry, Route length chips, shared remembered choice, correct bucket preview and cost.

**Files:** B — `components/RunHero.tsx`, new `RunHero.test.tsx`; `game/game.css`; `components/runV3Fixtures.ts`; B-owned existing fixtures/call sites needed by Task 0. Do not edit preferences/PB/types.

**Depends on:** Task 0 for type-only scaffolding/mockups; A2/A3 for live contracts/real-state fixtures. **Estimate:** 4–6 h.

- [ ] Replace Route/Challenge with Route/Target 60/Target 85; expose full accessible challenge names and radio keyboard behavior. Route alone shows 6/12. Use A's choice/config APIs; do not duplicate maxExtra or PB-key branching. Lock mode/length controls while starting; failed initial Start unlocks them, active runs change configuration only after Done.
- [ ] At A3's integration checkpoint, migrate **RunHero.tsx:52** from `{mode, focus, rulesVersion}` to `{config, focus, rulesVersion}`. Coordinate this B-owned call site so the new bucket signature does not leave an intermediate broken build.
- [ ] Remove decorative placeholder stones and now-unused entry-only CSS/component exports if no other consumer remains. Keep sound preview, Best, toggles, Start, and Starting/error states. Ordinary recording/scoring remains a start guard.
- [ ] Render length/target/hearts once; in public mode omit the duplicate score-cost explanation and show it only in “Up to N scores · M left today.” Use Start Challenge for both targets and explicit Best · /θ/ · Route 12 / Target 85 labels. No quota preallocation, silent shorter deck, or claim that attempt count guarantees enough recording seconds.
- [ ] Compare entry card height against the same baseline viewport/text size; require no growth and no horizontal overflow. All interactive targets ≥44 px; retain IPA case.

**Acceptance:** `entry_exposes_three_modes_and_route_lengths`; `entry_uses_shared_choice_without_mutating_active_config`; `entry_best_uses_selected_legacy_or_new_bucket`; `entry_costs_are_8_16_8_10`; `entry_starting_and_ordinary_busy_guards_hold`; measured `entry_height_does_not_exceed_baseline` at B6, not a jsdom assertion.

### Task B2: Six/twelve stones and explicit heart-loss marks

**Objective / deliverables:** Readable 2+2+2 / 4+4+4 progress and independent outcome marks.

**Files:** B — `components/RunStones.tsx/.test.tsx`, `game/game.css`, `runV3Fixtures.ts`; `RunRing.tsx/.test.tsx` only if shared score-label presentation needs a scoped change.

**Depends on:** Task 0 for type-level work; A2/A3 before constructing the new real reducer/selector fixtures. Parallel with B1, serialized where sharing game.css. **Estimate:** 3–5 h.

- [ ] Now that A2/A3 exist, populate runV3Fixtures with all four starter configs, Target 85 80→88/80→82, exhausted/unjudged pools, 972 A and partial Route, using real reducer/selectors and typed test prompts. No unsafe casts or runtime draft-content import. B3 completes scenario coverage.

- [ ] Derive group counts from items; twelve defaults to 2×2 within each of three groups. Preserve stage names/order, first-reading fills, 28 px hexagons, saved-only #FB923C outline, skip/unjudged/pending semantics.
- [ ] Add a visible red cracked outer mark only for confirmed heart-lost; label “one heart used” in addition to first-reading tier/score. No alternate Target 85 palette.
- [ ] Keep noninteractive progress decorative beyond its accessible text, and review navigation hit areas ≥44 px. Handle 390 px/short/narrow/large-text layouts without shrinking buttons below the target.
- [ ] Preserve static reduced-motion states, glow ≤0.18, Perfect gold gradient, and existing Good amber. No effects, storage, timers deciding game facts, or audio in stone rendering.

**Acceptance:** `stones_render_labelled_2_2_2_and_4_4_4`; `heart_lost_mark_preserves_first_good_fill`; `only_saved_has_rescue_outline`; `stone_labels_keep_raw_boundary_and_outcome`; `stones_have_static_reduced_motion`; B6 visual evidence verifies actual fit.

### Task B3: Route Ready and target-aware feedback/rescue

**Objective / deliverables:** Optional Route listening before each item, honest Target 85 states, and unchanged live recording controls.

**Files:** B — `components/PracticeRun.tsx/.test.tsx`, `game/game.css`, `runV3Fixtures.ts`.

**Depends on:** B2 and A2/A3 for real-state fixtures; A4 callbacks for final wiring. Owner selected variant B; bind the approved mockup without another choice gate. **Estimate:** 4–6 h.

- [ ] Implement approved variant B: Record next primary, Hear next first secondary (replacing Hear it again), using A's advance-then-preview callback. Ready shows the Hear it first capsule below the ring with “Optional · Record works any time”; Record works during load/play/failure. Finish handles the last item; Challenge controls stay unchanged. No A variant/toggle or repeat approval.
- [ ] Show explicit mode/length/target/focus header. Separate the unchanged tier from below-target status, including 80→82 and 80→88. Map cannotConfirmReason accurately; never charge a heart in UI or render a technical failure as a second low.
- [ ] Apply target-aware copy and boundary-safe formatting everywhere. Assert explicitly that Target 85's internal `relisten` verdict at 80 displays/announces **Good**, never a Re-listen tier, on the run, stones and review. Preserve first-valid points/chain, rescue gate, local reject/manual fallback and skip semantics. Cover rescue-budget, unjudged-budget with no low evidence, and reference-unavailable copy separately.
- [ ] Keep ring guard limited to the ring; bottom Stop, Cancel take, Pause/Quit and Next remain live during animations. Use existing feedback IDs and telemetry child boundary; do not add whole-run meter subscriptions.

**Acceptance:** `route_hear_first_does_not_block_record`; `route_record_next_and_hear_next_first_are_distinct`; `challenge_controls_unchanged`; `target85_good_tier_and_rescue_status_are_separate`; `target85_relisten_verdict_never_labels_80_relisten`; `target85_both_good_readings_can_lose_one_heart`; `cannot_confirm_distinguishes_rescue_unjudged_and_reference_failure`; `single_announcement_uses_final_target_tier_and_points`; `v2_local_reject_stop_guard_and_live_controls_hold`.

### Task B4: Route-first summary, N-aware motion, and shared restart errors

**Objective / deliverables:** Practised n/N hierarchy, explicit Next sound, correct costs/ratings, responsive summary/review, and persistent retryable failures.

**Files:** B — `components/PracticeRun.tsx/.test.tsx`, `RunReview.tsx/.test.tsx`, `useReplay.ts`, new `useReplay.test.tsx`; `game/game.css`, `runV3Fixtures.ts`. B5 owns final PracticeScreen binding; same owner.

**Depends on:** B2/B3; A3 score/PB facts and A4 restart callbacks for live binding. **Estimate:** 5–7 h.

- [ ] Route headline uses A's valid-item count and one next-step suggestion; remove the large rating ring and show points/rating/chain in three small tiles. Starter PB stays secondary; words has no PB. Challenge leads with outcome/target/hearts. Preserve Not rated reason, first/new/tie receipt, and Longest chain n/N.
- [ ] Implement the approved starter Route footer: See review / Play again side by side, Next sound full-width below, usage/Done final row. Next sound is starter Route Summary only; Review may retry its inherited error. B7 adds the words-to-revisit action in the scrollable next-step area, preserving this approved footer and avoiding a fifth fixed action. Verify short screen/large text without another layout approval gate.
- [ ] Use A's maxScores in Summary/Review; remove PracticeRun's MAX_EXTRA_ATTEMPTS import and notify A, which then removes the retained export in A6. Keep Play again and Next sound distinct; retry repeats the failed action and destination.
- [ ] Preserve v2 CSS fades (cells 240 ms, badges 300 ms). For N cells use start delays 650–1150 ms, step 500/(N−1); badges start at 1250 ms. Compare start-after-start: last cell finishes 1390 ms and badges 1550 ms, with intentional overlap. Do not shorten cells to 100 ms. Reduced motion/consumed feedback is final immediately; frame-zero controls cancel decoration.
- [ ] Extend existing useReplay with play-again/next-sound action identity only; B7 extends RestartKind/RestartActions with revisit-words after A7, without a placeholder callback. Keep one owner above Summary/Review. Older rejected promises/finally must not change a newer action/run. Preserve results on failed replacement; Done abandons error ownership as well as controller work.
- [ ] Review retains its shared You/Coach player, hide/unmount silence, take-score pairing, save-status facts, ordinary drill boundaries, and accessible heart/target labels. Twelve items do not create twelve audio elements.

**Acceptance:** `route_summary_prioritizes_practised_and_next_step`; `n12_972_without_full_combo_shows_a`; `summary_badge_start_follows_last_cell_start_with_v2_fades`; `summary_uses_max_scores_without_legacy_constant`; `summary_buttons_live_at_frame_zero_and_reduced_motion_final`; `next_sound_retry_repeats_destination`; `restart_failure_survives_summary_to_review`; `abandoned_or_older_restart_cannot_set_error`; `review_twelve_items_share_one_player_and_correct_takes`; footer placement has mockup/viewport evidence.

### Task B5: Bind the persistent controller and complete all four starter flows

**Objective / deliverables:** Real entry → take → summary → review → restart/Done with no interim fixture wiring.

**Files:** B — `mobile/screens/PracticeScreen.tsx`, `mobile/MobileApp.tsx/.test.tsx`, `mobile/mobile.css`, `mobile/usePublicScoresLeft.ts` only if needed for existing count plumbing; components touched in B1–B4 and game.css remain B-owned.

**Depends on:** A4 and B1–B4, **not A5**. Starter Route 12 may use a test-only injected pack until A5 integration; approval is already satisfied. Whole-v3 merge and production Route 12 acceptance still wait for A5. **Estimate:** 4–6 h, including the small post-A5 production follow-up.

- [ ] Bind config/cost/count/hearFirst/nextSound and the approved hearNextFirst action to A's API. PracticeScreen owns one useReplay and error state across Summary/Review; Done and Generate drill abandon it before exit/context change.
- [ ] Keep usePracticeRun at MobileApp owner lifetime. Tabs remain hidden for run.state or starting, including deferred entry/restarts. Preserve start error on the current surface and stop previous You/Coach before a new-run action.
- [ ] Verify hidden active run pauses/discards; terminal hides only silence playback. Quit dialog first pauses and later calls quit, retaining results. Cancel stays paused; Done calls exit. No late blob/request may publish ordinary preview or reopen a result sheet.
- [ ] Test **Route 6, Target 60, Target 85 against the production pack**. Test **Route 12 with vi.mock injecting a typed synthetic 60-item starterPack.json** (use the test file's correct relative module path). Real controller/reducer/selectors remain in both paths. Keep the mock in test-only setup, reset module/mocks between cases, and never bundle or load the owner's review table in production.
- [ ] Remove interim runtime fixture wiring and obsolete UI constants/styles without losing v2 assertions. B5's pre-approval handoff reports the production-vs-mock split explicitly. After A5 lands, B adds `route12_production_pack_completes_summary_review_and_replay` without the pack mock; this follow-up is required before whole-v3 merge, not a dependency blocking initial B5 completion.

**Acceptance before A5 integration:** `three_six_item_configs_complete_with_production_pack`; `route12_mocked_60_item_pack_completes_summary_review_and_replay`; `run_starting_owns_navigation_for_entry_and_restarts`; `quit_retains_review_done_exits`; `hidden_active_vs_terminal_behavior_is_preserved`; `deferred_restart_then_done_never_reopens_run`; `summary_review_transition_retains_restart_failure`; `run_result_never_opens_ordinary_sheet`; `ordinary_explicit_score_and_drill_progress_still_work`; `production_has_no_interim_fixture_wiring`. **Post-A5 follow-up:** `route12_production_pack_completes_summary_review_and_replay`.

### Task B7: Words entry, mixed-word presentation and summary revisit

**Objective / deliverables:** Start My words from Words or any Summary without altering ordinary Start review, approved starter footer, or persistent controller ownership. Added task executes before B6.

**Files:** B — `mobile/screens/WordsScreen.tsx`, new `WordsScreen.test.tsx`, `mobile/MobileApp.tsx/.test.tsx`, `mobile/screens/PracticeScreen.tsx`, `mobile/mobile.css`; `components/PracticeRun.tsx/.test.tsx`, `RunStones.tsx/.test.tsx`, `RunReview.tsx/.test.tsx`, `useReplay.ts/.test.tsx`, `runV3Fixtures.ts`, `game/game.css`. WordBankPanel may be read; ordinary Start review implementation stays unchanged.

**Depends on:** A7 API (type/mockup work after Task 0), B2/B3/B4/B5. Independent of A5 text approval/integration. **Estimate:** 6–9 h additional.

- [ ] Add Words-page “Start a run with my words”, local 6/12 choice, eligible count and shortage explanations, due-first/no-hearts copy and public usage. Use A's availability; don't count/filter/rank words independently. Keep Start review and ordinary manual word practice intact and visibly distinct. Use the same three session facts as PracticeScreen: recorderState !== "recording", !isScoring, !generatingPhoneme, plus !run.starting; no independent busy state. The Words tab is unreachable while a run exists, so the new entry does not call confirmLeaveRun. Preserve the existing ordinary controls' context guards. While a words start is pending, guard/inert other Words context-changing controls (Start review and individual practice) as well as repeated Start, keeping Cancel available; do not alter their normal idle behavior.
- [ ] MobileApp owns Words-entry pending/error across Words/Practice mounts. Invoke startWords synchronously in the click so audio prep keeps the gesture; hide tabs through starting, navigate on accepted success or preserve a visible pending/error surface, and keep cancellation available. Do not call confirmLeaveRun/exit preemptively for Summary revisit: it is a replacement start preserving old results until success. Existing ordinary navigation confirmation remains before actual context changes.
- [ ] Add My words · N words header, no IPA/Best, one named words progress group wrapping 6/12 stones, and unchanged Route B controls. Ready capsule/helper and compact points/rating/chain Summary follow approved Route styling; hide PB receipt/badges and Next sound for words. Do not relabel positions as Warm-up/Focus/In context.
- [ ] Add “Run with words to revisit” to every terminal Summary's scrollable next-step area, outside the approved fixed footer. Show “Words from first readings below 85” with counts and shortage hints. Apart from general busy/starting guards, disable only A's run-local no-seeds; cached shortage/graduated counts must not disable it. Fresh Start owns no-surviving-seed/shortage rejection. Copy never calls a sentence target wrong. It starts a new words Route at the finished length; no user-facing target/heart carryover from Challenge. Starter Route's four footer actions stay as approved; words omits Next sound.
- [ ] Extend useReplay with revisit-words identity and retry. Failure after Summary→Review remains visible with the same origin/length/seeds; Done/newer action invalidates it. Words entry errors have MobileApp lifetime; do not duplicate controllers or put entry errors only in an unmounted WordsScreen. A full word bank warning distinguishes scored from stored without fake success labels.

**Acceptance:** `words_entry_counts_5_6_11_12_and_never_silently_shrinks`; `words_busy_and_starting_guards_hold`; `words_entry_uses_session_guards_without_leave_confirmation`; `summary_cached_shortage_does_not_disable_revisit`; `summary_no_local_seeds_disables_revisit`; `words_entry_pending_error_survives_navigation`; `start_review_still_uses_ordinary_explicit_score`; `words_header_stones_have_no_ipa_or_fake_stages`; `words_summary_shows_rating_without_pb_or_next_sound`; `each_summary_revisit_preserves_original_until_start_succeeds`; `revisit_failure_survives_review_and_retry_keeps_action`; `words_done_drops_late_entry_or_revisit_error`; `full_bank_copy_never_promises_unknown_word_saved`; actual short-screen/large-text evidence for new entry and scrollable action.

### Task B6: Layout, accessibility, owner pilot, and final evidence

**Objective / deliverables:** A single honest acceptance report and device checklist with evidence for each implemented surface.

**Files:** B — new `docs/testing/game-mode-v3-acceptance.md`, `game-mode-v3-device-checklist.md`, task-owned layout evidence directory; fixes only in B-owned files. A supplies its own test receipt.

**Depends on:** A6, B5 and B7 plus A5 production integration; content approval is already recorded. Prepare the checklist earlier. **Estimate:** 3–5 h; additional pilot/fix time reported separately.

- [ ] Run/record final commands and exact revision. Map automated checks to requirements and distinguish them from actual browser layout and owner-reported device use.
- [ ] Capture baseline/new entry height at identical settings; all twelve-stone/summary/rescue layouts at 390×844 and short/narrow/large-text settings. Verify actual overflow, touch targets, scrolling and first-frame controls.
- [ ] Execute the real-device checklist below where devices are available. Record Pass/Fail/Not verified per row, not a blanket “tested on mobile.” Keep approved content and untested audio/accessibility separate.
- [ ] Complete final cross-track seam review, retaining named tests for stale starts, late audio, receipt lifetime and restart-error ownership. File unresolved issues rather than relaxing the specification or automatically changing Target 85.

**Acceptance:** `v3_full_checks_and_seam_review_recorded`; `v3_responsive_and_accessibility_evidence_recorded`; `v3_owner_pilot_recorded_with_limits`. No invented device proof from mocks or prior v2 approval.

## Approved mockup and new-source evidence

The owner selected variant B and the lead's other mockup recommendations. Implement the existing approved HTML/PNG references under `docs/design/game-mode-v3-mockup/`: Route Ready capsule/helper line, feedback B, Route Summary compact tiles/footer, entry labels and heart-loss mark. Explicit addendum copy overrides the mockup's duplicate public cost line. Illustration scores are not scoring fixtures.

B7 adds evidence for Words entry (empty/5/6/11/12 eligible, busy/loading/failure), mixed-word header/stones, no-PB Summary, starter/words/Challenge revisit action and shortage/error cases. Place the extra action in the scrollable next-step area; this does not reopen the settled four-action starter footer. Record 390×844/390×667, large text and accessibility checks. Content approval ceb6144 is complete; lead still records the owner's notice about changed starter PB content subsets and existing game-score insertion into the word bank.

## Code seams

Paths below are relative to `frontend/src` unless prefixed otherwise. Line anchors refer to `7995c5e`; find the symbols after edits. Ownership in this table does not transfer any file.

| Baseline file:lines / symbol | Owner / task | Change or preserved seam |
| --- | --- | --- |
| `types.ts:235,287–302,304–317` RunMode, RunState, START | A / 0,A2 | Config union; START snapshot; extraUsed 0..4; three cannot-confirm causes. |
| `types.ts:106–125,267–275`; `game/runDeck.ts:30–33`; `components/WordBankPanel.tsx:10–35` | A / A7 (B helper read-only) | Vocabulary status/score/due facts; words source/stage; reuse singleWordKey and snapshot existing due ordering without changing ordinary review. |
| `game/runModel.ts:16–17,46–53,78–89` | A / A2 | Keep PASS_ACCURACY; replace global extra limit in capture/send guards. |
| `game/runModel.ts:149–195,199–224` | A / A2 | Frozen target judgments, first-low/rescue, validated config START. |
| `game/runModel.ts:268–321,373–407` | A / A2,A6 | LOCAL_REJECT/send/refund, pause/quit/terminal invariants. |
| `game/runDeck.ts:13–24,47–90`, especially `:58/:66/:82/:88`; `game/starterPack.ts:6–19` | A / A4,A5 | Replace context [1], both warm-up ===2 limits and modulo-2 IDs; full-group context target exclusions, seeded membership/order. |
| `game/runDeck.test.ts:48–89` starter-pack assertions | A / A4,A5 | A4 adds synthetic 4/4/4 and independent stage sampling tests; A5 changes runtime 30/2-2-2 expectations and validates all contexts, not just first pair. |
| `game/scoring.ts:16–40,79–126` | A / A3 | N coefficients, complete/fullCombo before rating; update stale fixed-60/six comments. |
| `game/scoring.ts:129–240` | A / A3 | Preserve latest-valid evidence, low/borderline cutoffs and deduplication. |
| `game/personalBest.ts:10–28,63–118` | A / A3 | Byte-compatible legacy buckets and new dimensions; receipt API unchanged. |
| `game/preferences.ts:6–59`; `components/PublicGate.tsx:237–245`; repo `PRIVACY.md:43–49` | A / A3 | Parse RunChoice/add fourth key; existing Gate implementation unchanged, test deletion ordering; change both “three” phrases to “four”. |
| `game/sfx.ts:85–127` | A / A3,A6 | Existing cue rules unchanged; add tests for Target 85 relisten verdict at Good 80. |
| `hooks/usePracticeRun.ts:107–160,185–210` | A / A2,A4 | Gesture prep/token; config/deck failure throws before teardown at :199 and preserves receipt/results. |
| `hooks/usePracticeRun.ts:160–163` dispatch refresh | A / A4,A7 | Add nonblocking once-per-terminal-transition refresh; retain Review refresh; cached shortage never disables Summary revisit. |
| `hooks/usePracticeRun.ts:213–258,316–353,364–438` | A / A4 | New item-change speech cancellation in ADVANCE/skip/recordNext/finish; guarded hearNextFirst; restart/owner lifetime. |
| `usePracticeSession.ts:678–685`; `hooks/useSpeech.ts:75–83,252–265,348–355` | A / A4,A6, tests only | Pre-mic stop and request-token/error guards already exist; test them without speech/session/VAD edits. Load-result callback precedes playback guard. |
| `components/RunHero.tsx:13–36,52,59–73,91–157` | B / B1 | :52 bucket call migrates with A3; three choices/length/cost; remove placeholder/local mode duplication. |
| `components/PracticeRun.tsx:41`; `components/RunReview.tsx:22`; `types.ts:269` | B + A / Task 0 | Stage union and both words: "My words" STAGE_LABELS entries land together; production typecheck must pass. |
| `components/RunStones.tsx:74–76` fixed STAGES | B / B7 | Add words group and words visual fixtures here; Task 0 is label/type scaffolding only. |
| `components/RunStones.tsx:39–107,123+`; `game/game.css:344–448` | B / B2 | Existing first-score labels/groups; twelve layout and heart-loss mark. |
| `components/PracticeRun.tsx:309–445,613–652,818–864` | B / B3 | Approved Route B for both sources; target-aware copy without leaking relisten verdict as tier. |
| `components/PracticeRun.tsx:6,685,731–807`; `game/game.css:82,928–937,957–974` | B / B4 + A / A6 cleanup | B removes legacy import after maxScores binding; preserve 240 ms cell/300 ms badge fades and compare start times. |
| `components/RunReview.tsx:253–284,405–419`; `components/useReplay.ts:7–32` | B / B4 | Shared restart identity/error, config copy, preserved player cancellation. |
| `mobile/screens/PracticeScreen.tsx:52–57,201–250,323–339`; `mobile/MobileApp.tsx:18–36,82+` | B / B5 | Existing screen-level replay owner, controller props, visibility and starting-owned tabs. |
| `mobile/screens/WordsScreen.tsx:7–49`; `mobile/MobileApp.tsx:18–20,52–65`; `usePracticeSession.ts:767–799` | B / B7; session read-only | Words entry and persistent error; keep ordinary Start review/Score; no preemptive exit for Summary replacement. |
| Repo `backend/app/main.py:477–506`; `backend/app/storage.py:887–990`; `backend/tests/test_api.py:463–536` | A / A7, tests only | NoMatch early return, single-word SRS, full-bank known/new distinction, strict-greater graduation; no endpoint/rule changes. |
| Repo `backend/tests/test_game_starter_cache.py:32–55` public fixtures | A / A7 | Fixture approach for new owned test_public_word_bank.py; enabled public mode, visitor and max_words=1 with FakeScorer. |
| Repo `backend/app/main.py:102–125,727+`; `backend/tests/test_game_starter_cache.py:56–79` | A / A5 | Exact allowlist parity, count 30→60, cache behavior preserved. |
| Repo `docs/CONTENT-PROVENANCE.md:10–15` | A / A1,A5 | Distinguish draft, shipped existing content, exact approved version; no invented approval. |

## Preserved v2 regression matrix

| Boundary | Required counterexample/assertion | Owner |
| --- | --- | --- |
| Accepted async Start | Delayed stats/list fetch → exit, newer Start, owner unmount; no stale run, error, or starting=false. Both data fetches failing still build a six/approved-twelve starter deck. | A controller / B navigation |
| Capture ownership | Pending permission → cancel/exit → late grant/denial; started cancelled capture releases exactly once, never shared preview; normal→run and run→normal handoff. | A |
| Stop/submit | Manual/auto/cap/onstop race produces one summary/blob/submission; cancelled/pause/quit/exit blobs discarded; manual ≥450 ms never vetoed. | A |
| VAD | Opening replay/onset wins spread fallback; one-time spread check; P10 drift, gap/hidden/context invalidation, caps and unchanged limits. | A, full existing suite |
| LOCAL_REJECT/refund | No BLOB_READY/URL/request/budget on local reject; no heart or extra changes; stale/duplicate rejects no-op; rejected/quota refund only once; unknown never auto-resends. | A |
| Pause/quit/exit | Submitted response may settle while paused; no cue before/after paused transition; terminal never paused; quit keeps evidence; exit invalidates and releases URLs. | A/B |
| Sentence collection | Show accepted score first; retain run's sync gating/candidate status mapping; collection failure never rewrites score; no stale follow-on mutation. | A |
| PB/events | Freeze first receipt once across Summary/Review, another tab's write and expiry; no replay on rerender/remount; pending replay retains old receipt until replacement accepted. | A/B |
| Playback | Test existing late reference/recording/error guards; controller now cancels playing/pending old reference on ADVANCE/skip/recordNext/finish. You/Coach mutually cancel, hide stops both; muted cues consumed, context never suspended. | A/B |
| Restart lifetime | Deferred Play again/Next sound → Summary→Review → failure stays visible; failure retry uses original action; Done makes late rejection/success inert. | B useReplay + A token |
| Ordinary practice | Explicit Score unchanged; old score/collection/finally cannot alter new context; failed collection retains score/review latch; no run result in normal sheet; Long Passage entry and Generate drill exit order. | A/B |

Words-source additions: fresh-bank fetch failure/shortage preserves the old run; first-valid seeds/due order; no graduated filler/PB/Next sound; ordinary Start review unchanged; entry/revisit errors survive their owner surfaces. Backend tests pin full-bank known updates vs unknown score-only, NoMatch and sentence boundaries, and no duplicate frontend SRS call.

Keep these assertions when updating fixtures/signatures. Passing a happy-path replacement test is not evidence that an old race is closed.

## Real-device checklist

Default every row to **Not verified**. Record exact revision, device/OS/browser, viewport/text scaling, input and settings, observer (direct/owner report), and evidence path. iOS Safari and desktop Chrome are the pilot targets; no general device-support claim follows from two devices.

- [ ] Complete Route 6, Route 12, Target 60 and Target 85 through Summary, Review, Play again and Done. Check personalised warm-ups and all five sounds, including explicit v→θ wrap on Next sound.
- [ ] Target 85: several owner runs, recording rescue/heart-loss/cannot-confirm counts and causes, as well as subjective feel. Include 80→82 vs 80→88 through fixtures if real scores do not happen; identify fixture vs real evidence. No automatic threshold change.
- [ ] Hear first cached/cold/failed/deferred TTS; Record during load/play; Skip/Pause/Quit/Done during load; no late speaker audio reaches an open microphone and no required wait-to-end.
- [ ] Existing auto-stop/manual: immediate/quiet speech, final θ/s, slow sentences and ~1.05 s pause, fan/TV, no onset, short onset, cap; 0.4 s vs ≥0.45 s manual Stop. Record known false endpoints/fallbacks, do not tune VAD in this cut.
- [ ] Capture lifetime: delayed permission, denial, rapid cancel/retry, stop then hide/lock, explicit Resume, quit dialog, restart/exit. Mic indicator turns off after each take/exit; no old preview leaks into ordinary practice.
- [ ] Audio: mute persists but detection works; iOS silent-switch behavior; rescue Coach→record; You↔Coach; no cue into open mic, no terminal cue when result settles while paused. Haptics only if supported.
- [ ] Layout: entry baseline comparison, twelve grouped stones and summary at 390×844 and 390×667, narrower width, browser chrome, long prompt, large text; no sideways scroll, thumb controls remain reachable, targets ≥44 px.
- [ ] Motion/accessibility: reduced-motion static decoration, functional silence arc, final facts from frame zero; badge fade starts after the last cell fade starts (existing 240/300 ms durations). VoiceOver/keyboard names, one announcement, target/tier distinction, heart mark, radio keys, Quit focus containment/return.
- [ ] Pending Next sound/Play again → Review → failure/retry, and pending → Done; old result stays until replacement succeeds, no stale error/navigation. Public usage copy shows actual attempt count without promising duration availability.
- [ ] Personal legacy PB upgrade, separate four buckets, first/new/tie, public expiry, successful/failed Delete my data; verify stored choice and exact removed keys without publishing private data.
- [ ] Ordinary word/sentence/Long Passage, explicit Score, score-before-collection, failed collection, context switch with old response, Generate drill progress/error. Runs never trigger the ordinary result panel.

- [ ] My words Coach audio with cold visitor cache: record TTS quota behavior (twelve new references may exhaust synthesis before score quota); no rule change or shared-cache assumption.
- [ ] My words 6/12: due/score order, counts 5/6/11/12, frozen deck, no graduated fillers, honest header/stones and no PB; Start review stays separate. Summary revisit uses first-valid seeds/exact length.
- [ ] Words entry loading/error → navigation; revisit → Review → retry; Done → late result. Short-screen action placement preserves the approved footer and ≥44 px targets.
- [ ] Fake-service or bounded owner evidence distinguishes full-bank known updates from unknown score-only, score quota from word capacity, and game 85 from configured SRS graduation. Do not call mocked capacity checks device proof.

Content approval is recorded in ceb6144; A5 integration still needs verification. Unavailable device checks remain Not verified, not device approval.

## Final verification commands

Run from the repository root after implementation/integration. Use installed tools; mocks/fake synthesizers only. No paid Azure calls or dependency/production changes are authorized by this checklist.

```sh
git status --short
git diff --check
npm --prefix frontend test -- src/game
npm --prefix frontend test -- src/hooks/usePracticeRun.test.tsx src/hooks/useRecorder.test.tsx src/hooks/useSpeech.test.tsx src/usePracticeSession.test.tsx
npm --prefix frontend test -- src/components/RunHero.test.tsx src/components/RunStones.test.tsx src/components/RunRing.test.tsx src/components/PracticeRun.test.tsx src/components/RunReview.test.tsx src/components/RunMiniPlayer.test.tsx src/components/useReplay.test.tsx src/components/PublicGate.test.tsx src/mobile/MobileApp.test.tsx
npm --prefix frontend test -- src/mobile/screens/WordsScreen.test.tsx
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_game_starter_cache.py backend/tests/test_api.py backend/tests/test_public_word_bank.py
bash scripts/test.sh
```

The final script runs backend ruff/pytest and frontend lint/full tests/production build. Record command results and existing warnings; missing dependencies are unavailable checks, not passes. Separately audit the approved table/runtime match, browser measurements, and device checklist. Only repeat passing suites after changed code or new evidence warrants it.

## Parallel delivery order

| Checkpoint | Track A | Track B | Exit condition |
| --- | --- | --- | --- |
| Delivered | A1 83c1113; r1 content approval ceb6144 | Starter mockup decisions accepted | No duplicate content or variant approval request; A5 integration remains. |
| Days 1–3 | Task 0, A2/A3 source-aware config/scoring/PB | Type scaffolding, B1–B3; real fixtures after A2/A3 | Six configurations typed; approved B; legacy bucket/constant and simultaneous stage/STAGE_LABELS handoffs stay green; words visuals wait for B7. |
| Days 3–5 | A4, A5; begin A7 words selectors/deck | B4/B5 starter binding; begin B7 entry/layout | Starter Route 12 can test-mock before A5; post-A5 production proof remains mandatory. |
| Days 5–7 | A7 words controller/SRS boundary tests | B7 live Words/summary binding | Due/low-score selection, shortage, no PB, source routing and cross-screen start errors work. |
| Days 7–10 | A6 and A-owned fixes | B6 and B-owned fixes | All-source regressions, real-pack starter 12, Words 6/12 and owner device evidence; whole-v3 merge only. |

Approval is satisfied; do not hold A5 for an already-recorded decision. All v3 features, including My words, merge together after their dependencies and final checks. No partial release/flag and no runtime synthetic pack. The original B5 testing split remains useful until A5 integration; a mocked twelve-item pass does not establish production content correctness.

## 已裁决记录

The lead accepted every item in Fable's second plan review. These decisions are final; no further confirmation gate remains.

1. **Insufficient vocabulary — exact N:** require 6 or 12 unique eligible candidates; fewer than 6 cannot start, 6–11 can explicitly choose six. Never auto-shrink, introduce 3–5-item runs, or use graduated/starter fillers. Summary's cached shortage is only a hint; fresh Start validates exact N before teardown.
2. **Summary revisit seeds — admit absent-bank targets, exclude graduated:** allow valid absent-bank sentence targets (also word seeds not inserted because the public bank was full); matching graduated keys are excluded. First-valid overall <85 selects the seed without claiming the target itself was wrong. Inclusion permits practice, not guaranteed persistence.
3. **Review fixes accepted:** Task 0 B owns both `words: "My words"` stage labels; A4/A7 refresh once on terminal entry and Summary disables only for run-local no-seeds; A7 owns new public word-bank tests and the additional 1–2 h. Preserve original reference casing, document SRS replay overlap and due-date ties, and stage the third restart kind in B7.
4. **Prior decisions retained:** variant B, approved starter footer, all 60 content rows, legacy PB bytes, Next sound cycle and whole-v3 integration are settled. Lead's owner notice covers expanded-pack PB comparability and existing game-word insertion into vocabulary.

Known-score ordering, seed ordering and independent stage sampling remain the deterministic rules stated above. My words adds no local storage key, API, quota or SRS rule; actual scores still write existing backend word/history data.
