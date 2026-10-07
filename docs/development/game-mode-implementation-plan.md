# Game Mode Implementation Plan

**Goal:** Ship a mobile six-item Route and opt-in Challenge with automatic scoring on stop, immediate verdicts, reference-assisted rescues, and a useful review. Design: [Game Mode](../design/game-mode.md).

**Architecture:** A pure reducer and frozen deck feed `usePracticeRun`, mounted beside the existing session in `MobileApp`. Reuse the session's recorder and speech player; call `scoreRecording(text, blob, "short")` directly and keep run results outside `session.result`. The only backend product change adds public starter texts to the existing shared TTS cache allowlist. No new tables or persisted runs.

**Tech Stack:** React, TypeScript, MediaRecorder, Vitest/Testing Library, FastAPI, SQLite, pytest with existing fake scorer/synthesizer fixtures.

**Schedule:** Approximately five working days for one engineer, or four with two engineers sharing the non-overlapping tasks below. Task 4 needs 8–10 hours; retain 4–8 hours across integration and real-device troubleshooting. Task 0 is a parallel, non-blocking exercise. Task 7 is optional and can be dropped. Content publication requires the repository owner's review.

**Ownership:** Each task owns its listed files. Task 3 hands its session files to Task 7 sequentially. Task 1 alone owns run types, Task 2 alone owns `main.py`, and Task 4 alone owns `api.ts`. Preserve unrelated working-tree changes. All checkboxes below are implementation work, not claims of completed validation.

---

### Task 0: Measure Ten Local Word Attempts

**Files:**
- Create: `/tmp/justtalk-game/latency-final.md` (measurements and one-paragraph conclusion).

**Depends on:** None; never blocks implementation.

**Estimate:** At most one hour on Day 1.

- [ ] In local personal mode, record ten 1–2 second word attempts and submit through `/api/score` with `mode=short`. Use the existing frontend/API or temporary DevTools instrumentation; do not build a benchmark framework.
- [ ] Measure actual stop invocation to verdict rendering on the next animation frame. Also note blob-ready and response times. Render the score immediately in the measurement path rather than waiting for ordinary word collection.
- [ ] Record each duration/status and compute nearest-rank p50/p95: for ten sorted successful samples, the fifth and tenth values. If fewer succeed, report the actual successful sample count and failures separately. Do not discard slow samples or automatically replace failed attempts.
- [ ] If p95 exceeds 2.5 seconds, retain honest waiting copy and next-prompt preview; record the finding without gating development or adding pipelined uploads. Missing credentials/device access means “not measured,” not a blocker. Mobile timings are collected during Task 6.

Instrumentation sketch: timestamp immediately before `recorder.stop()`; in `onstop`, pass the new blob to `scoreRecording(word, blob, "short")`, render `response.result.scores.accuracy`, then record elapsed time in `requestAnimationFrame`. The current normal flow waits on collection (`usePracticeSession.ts:351–367`), so its UI latency is not Azure latency. Local personal-mode results also exclude public queue behavior (`main.py:249–264`).

**Acceptance:** `local_latency_samples_are_reproducible` — raw timings, outcomes, sample count, p50/p95, and a short conclusion, or a clear statement that measurement was unavailable. No new benchmark tests.

### Task 1: Freeze Types and Implement the Run Reducer

**Files:**
- Modify: `frontend/src/types.ts` (run types only).
- Create: `frontend/src/game/runModel.ts`, `frontend/src/game/runModel.test.ts`.

**Depends on:** The contracts below; not Task 0.

**Estimate:** 4–5 hours; freeze and commit the run types within the first 1–2 hours so UI work can start.

- [ ] Publish the TypeScript contracts below first. Implement Route transitions, then add Challenge rules in the same reducer.
- [ ] Freeze six prompts. Allow six main slots plus two shared extra slots for rescues and unjudged re-recordings. Reserve a slot before sending; refund exactly once after a rejected response. A new recording gets a new attempt ID. HTTP requests may exceed eight, but counted attempts must not.
- [ ] Judge all items using raw top-level `scores.accuracy`. Require a finite number, non-empty `words`, no NoMatch, and no `Omission` or `Insertion`. Mispronunciation remains judgeable. Do not add token alignment or apostrophe normalization.
- [ ] Route resolves any valid result without hearts. Challenge starts with two hearts: first valid accuracy below 60 requests rescue; rescue at least 60 saves the heart; two valid lows lose one heart. No third valid judgment. A NoMatch between valid readings consumes an extra slot without becoming a confirming low.
- [ ] Exhausted extras or failed reference loading make the item unconfirmed and Challenge incomplete without losing a heart; remaining main items remain available. A pending rescue blocks ordinary advancement until resolved, explicitly skipped, or marked cannot-confirm. Cleared requires all six items resolved and at least one heart remaining; confirmed heart loss still resolves an item.
- [ ] Unknown scoring marks the item pending, preserves its consumed slot, makes Challenge incomplete, and enables the next item through the normal user-controlled advance action. Never retry it or infer a session by text. Only quota, exhausted hearts, completion, or quitting end the run.
- [ ] Validate run/item/attempt IDs on asynchronous actions; duplicate results cannot refund twice, deduct twice, or overwrite the next item. Pause is orthogonal: an already-submitted result may settle while no capture or automatic advancement occurs.

**Acceptance:**
1. `route_resolves_six_valid_items_without_hearts`.
2. `judgment_uses_raw_overall_accuracy_and_simple_alignment` — include 59.6, conflicting word accuracy, null, empty words, NoMatch, Omission, and Insertion.
3. `challenge_confirms_before_losing_a_heart_and_can_clear_with_one`.
4. `two_confirmed_failures_end_at_zero_hearts` — 50/50 followed by 50/50.
5. `shared_extras_never_consume_remaining_main_slots` — last successful rescue preserves subsequent main attempts; exhausted rescue budget never costs a heart.
6. `rejected_refunds_exact_slot_once_and_keeps_current_item`.
7. `unknown_and_skipped_items_prevent_clear_but_allow_next_item` — unknown during rescue also stops confirmation without a heart loss.
8. `stale_or_duplicate_responses_cannot_change_new_state`.

### Task 2: Build the Starter Deck and Enable Shared TTS Caching

**Files:**
- Create: `frontend/src/game/starterPack.json`, `frontend/src/game/starterPack.ts`, `frontend/src/game/runDeck.ts`, `frontend/src/game/runDeck.test.ts`.
- Modify: `backend/app/main.py` (builtin text allowlist only), `docs/CONTENT-PROVENANCE.md` (one entry).
- Create: `backend/tests/test_game_starter_cache.py`.

**Depends on:** Task 1 types for the selector; content and cache preparation can start immediately.

**Estimate:** 4–5 hours, excluding the owner's review turnaround.

- [ ] Enter the 30 starter items below and request repository-owner review before publication. Use the small schema below; no per-item license/reviewer/date fields.
- [ ] Choose the lowest `average_accuracy` phoneme among available stats intersecting pack coverage, mapping `r` to `ɹ`; default to θ when the intersection is empty. Always display “today's sound.” Both Focus words and both Context sentences come from this fixed group.
- [ ] Fill two Warmup slots with eligible previous-run weak words first, then due words ordered by due date, then the group's starter Warmup words. Reuse the existing due-word helper. Filter external candidates against the group's word items and new-context target, and avoid selecting the same external word twice. The authored pack needs no runtime internal deduplication machinery.
- [ ] Freeze the resulting 2 Warmup + 2 Focus + 2 Context prompts at start. The first sentence intentionally repeats a Focus word; the second has a new target word. Do not generate sentences from arbitrary historical examples.
- [ ] Add a `GAME_STARTER_TEXTS` constant to `main.py` and union its exact 30 texts into `BUILTIN_TEXTS`. Keep the existing passage texts. Maintain this small duplicate text list with a test comparing it to frontend JSON; do not change deployment paths or speech/cache routes.
- [ ] Test in public mode, where shared caching exists. Include non-empty `word_boundaries` in fake synthesis responses because the existing cache-hit check requires them when a synthesizer is configured. Keep arbitrary visitor text in the visitor cache.

**Acceptance:**
1. `starter_pack_has_thirty_items_and_valid_six_item_groups` — five groups, correct stages/targets, 5–9 word sentences.
2. `focus_intersects_stats_with_pack_or_uses_default`.
3. `deck_freezes_due_order_and_filters_external_word_collisions`.
4. `play_again_prefers_eligible_previous_weak_words`.
5. `test_starter_texts_match_frontend_and_share_cache_between_visitors` — fake synthesizer, complete text-set equality, repeat text synthesized once across two visitors.
6. `test_custom_text_remains_in_visitor_cache`.

### Task 3: Add Minimal Recorder and Speech Integration

**Files:**
- Modify: `frontend/src/hooks/useRecorder.ts`, `frontend/src/hooks/useRecorder.test.tsx`, `frontend/src/usePracticeSession.ts`, `frontend/src/hooks/useSpeech.ts`, `frontend/src/hooks/useSpeech.test.tsx`.
- Create: `frontend/src/usePracticeSession.test.tsx`.

**Depends on:** Task 1 identity/type agreement. Own `SpeechOptions` changes here; do not modify `api.ts`.

**Estimate:** 4–5 hours.

- [ ] Change `onRecordingReady` to `(blob: Blob) => void` and pass the blob already constructed in `onstop`. Keep the existing MediaRecorder stop-state guard. Do not add an audioBlob-effect auto-submitter or a new recorder generation/permission state machine.
- [ ] Provide thin session wiring for run ownership and one capture-bound callback. Install a callback closing over its attempt ID before start; do not replace it until that start/onstop cycle finishes. The run's ref lock blocks a second start during starting/recording/stopping. Cancellation invalidates the attempt and calls existing stop; late onstop reaches the old callback and is discarded. If permission resolves after cancellation, stop and discard that capture.
- [ ] Entering a run clears the old normal result through existing reset behavior. Lock run mode and recorder `maxMs` to the short limit, including entry from Long Passage; complete this configuration before the next Record click. Expose the existing shared capture controls without adding a second recorder or a session facade.
- [ ] Disable the ordinary Enter/Space handler while the run owns practice, including pause/summary/review. Add `if (runActive) return` to the weak-word prefetch effect at `usePracticeSession.ts:288–292`, including `runActive` in its dependencies. Run scoring never populates `session.result`; the selected-word prefetch has no new run results to consume.
- [ ] Define `SpeechOptions = SpeakTextOptions & { onLoadResult?: (ok: boolean) => void }` inside `useSpeech.ts`. Wrap only `loadSpeechUrl` in an inner try/catch: report true on load success and false on load failure, unconditionally before any playback request-ID check. The outer playback catch must never report load failure. Existing loaded-audio reuse reports true once without another fetch.
- [ ] Enable rescue Record only after `referenceLoad === "ready"`; loading failure yields cannot-confirm without consuming a score slot or heart. Do not wait for `ended`, and do not record early or hold a blob waiting for reference loading. Preserve ordinary playback-error reporting; stopping playback or autoplay rejection is not a failed TTS request.

**Acceptance:**
1. `ready_passes_current_blob_and_preserves_browser_mime`.
2. `cancelled_capture_keeps_old_identity_until_late_onstop`.
3. `run_uses_shared_short_recorder_and_disables_normal_shortcuts`.
4. `ordinary_recording_still_requires_explicit_score`.
5. `reference_load_callback_precedes_request_guard_and_ignores_play_errors` — cached success, cancelled playback then load failure, and autoplay rejection.
6. `run_results_stay_outside_session_and_weak_prefetch_is_suppressed`.

### Task 4: Implement Run Submission and Sentence Collection

**Files:**
- Create: `frontend/src/hooks/usePracticeRun.ts`, `frontend/src/hooks/usePracticeRun.test.tsx`.
- Modify: `frontend/src/api.ts`, `frontend/src/api.test.ts`.

**Depends on:** Tasks 1 and 3; consume Task 2's deck when available.

**Estimate:** 8–10 hours.

- [ ] Call `scoreRecording(prompt.text, newBlob, "short")` directly. Acquire the synchronous attempt lock and reserve its slot before fetch; never call ordinary `submitRecording` or write a run score to `session.result`.
- [ ] Classify score failures by status only: `ApiError.status` 400/413/503 → rejected/refund/stay; 429 → quota stop; all other errors → unknown/pending/continue. Do not match codes or message text. Validate successful payload shape too: malformed result/scores/words/session data is unknown, since current parsing can return `{}`. A null session is valid for NoMatch, not for a recognized result.
- [ ] Unknown consumes its slot, does not launch collection without a known session, and exposes the next prompt without retrying. A still-unsettled request remains scoring; Quit stays available. Do not add AbortSignal or a client timeout.
- [ ] Add optional `maxScore` to `addWordsFromSession`. For every sentence response with a session, display the result first, then collect with `70`; normal callers keep their current default URL. Word attempts never call from-session because score already handles their SRS.
- [ ] Mark sentence sync pending atomically when accepting its score. Disable the next capture/submission until collection settles. Every collection failure becomes “save manually” and permits continuing; never auto-replay it. No cross-run synchronization barrier. A late server write remains an accepted ordering limitation.
- [ ] Keep sentence candidates at word accuracy ≤70 with processed/unconfirmed/save-manually status; do not equate returned rows with newly added words. Review shows candidates and results without an exact added count or a new manual-save/createWord action. Scores 71–85 remain hints only.
- [ ] Own each retained attempt's blob and review object URL. Release rejected/cancelled recordings immediately; retain at most eight counted attempts' audio. Keep only the latest rejection message per item. Refresh vocabulary once on review entry; do not initiate history/insights/activity refreshes there. A refresh failure preserves results and unconfirmed labels. Exit/play-again releases old URLs.

**Acceptance:**
1. `one_stop_submits_once_despite_double_tap_or_autostop`.
2. `status_only_rejection_refunds_unknown_continues_and_429_ends` — include malformed 2xx and unknown rescue outcomes.
3. `sentence_score_precedes_collection_and_next_waits_until_settled` — cutoff 70, default URL unchanged, any failure continues.
4. `word_attempt_never_posts_from_session`.
5. `pause_discards_capture_but_accepts_matching_inflight_result`.
6. `rescue_record_requires_reference_ready_without_waiting_for_ended`.
7. `review_audio_matches_attempt_and_rejected_or_exited_audio_is_released`.
8. `review_refreshes_only_vocabulary_once_and_never_claims_added_count`.

### Task 5: Build Run Feedback, Challenge Summary, and Review

**Files:**
- Create: `frontend/src/components/PracticeRun.tsx`, `frontend/src/components/PracticeRun.test.tsx`, `frontend/src/components/RunReview.tsx`, `frontend/src/components/RunReview.test.tsx`, `frontend/src/game/game.css`.

**Depends on:** Task 1's committed types before any static UI work; Task 4 for live wiring.

**Estimate:** 4–5 hours.

- [ ] Render the prompt, six nodes, verdict, and pre-rendered next prompt. One next-item Record click advances and records. Use no automatic timers. Valid results light a node; unjudged/pending/skipped states must remain distinguishable. Preserve prior valid evidence when a rescue becomes pending.
- [ ] Use a large score with existing `scoreTone` colors and one optional `navigator.vibrate(30)` per accepted valid attempt. Keep consumed feedback IDs at run lifetime so re-renders/tab remounts do not vibrate again; unsupported vibration is harmless.
- [ ] Show Challenge's independent cleared/hearts-exhausted/incomplete summary before review; the learner clicks to open review. Route may go directly to review. Unknown scoring shows pending and the next-item action, not a terminal summary. Quota is service usage, never a pronunciation failure.
- [ ] Show at most three evidence-based review actions: the same low phoneme across at least two items, then words below 60, then borderline words 60–79. Use returned phonemes/words only. Keep both recordings beside their own scores after a rescue, and do not invent advice when evidence is absent.
- [ ] Display practiced items, explicit skips, unresolved/pending information, and candidate-word statuses; distinguish unreached items from deliberate skips. Practiced means at least one valid reading, so a valid first reading followed by unknown rescue is practiced but still unresolved. Avoid pretending these overlapping facts are an additive total.
- [ ] Offer reference/own-recording replay and Play again with eligible prior weak words. In configured personal mode, retain the existing Generate a drill action; hide it in public mode. Do not add a review save-word pathway.

**Acceptance:**
1. `verdict_uses_large_score_tone_and_one_optional_vibration`.
2. `next_prompt_is_visible_without_timer_and_pending_rescue_blocks_advance`.
3. `challenge_summary_requires_user_action_before_review`.
4. `review_limits_actions_to_real_evidence_and_matching_attempt_audio`.
5. `review_shows_candidate_status_without_added_count_or_save_action`.
6. `route_and_public_mode_hide_inapplicable_controls`.

### Task 6: Integrate Mobile Navigation and Verify Delivery

**Files:**
- Modify: `frontend/src/mobile/MobileApp.tsx`, `frontend/src/mobile/MobileApp.test.tsx`, `frontend/src/mobile/screens/PracticeScreen.tsx`, `frontend/src/mobile/screens/WordsScreen.tsx`, `frontend/src/mobile/screens/HistoryScreen.tsx`, `frontend/src/mobile/screens/InsightsScreen.tsx`.
- Modify if needed: `frontend/src/mobile/mobile.css`.
- Create: `docs/testing/game-mode-acceptance.md`.

**Depends on:** Tasks 2–5.

**Estimate:** 5 hours plus the shared 4–8 hour integration/device allowance.

- [ ] Mount the run hook in MobileApp beside the session; offer Route by default and opt-in Challenge. Render run and normal practice as separate surfaces. Leave normal result-sheet effects unchanged: run results never reach them. Clear old normal results on entry and leftover run capture on exit.
- [ ] On tab switch or browser backgrounding, discard unsubmitted capture and stop it without uploading. Let already-submitted scoring/collection settle into the original run while paused. Require explicit Resume when returning; never auto-open the microphone. Keep existing Insights tab loading behavior.
- [ ] Pass a small `confirmLeaveRun(): boolean` callback to Words/History/Insights practice-entry handlers. Ask before changing shared context, not afterward. Cancel does nothing; confirm quits/discards the run then performs the requested action. A plain tab switch only pauses. Do not introduce a protected session facade or unknown-write guard.
- [ ] Keep submitted requests single-shot after quitting; late results cannot update a new run or normal result. Confirmed exit does not claim to undo server work. Keep Quit usable while waiting for a response.
- [ ] Run focused tests, existing backend/frontend regression suites, lint, and build using the commands below. Record failures honestly; backend scoring/SRS behavior stays under existing fake-scorer coverage.
- [ ] On a real iPhone Safari, exercise MP4 capture, permission denial, manual/limit stop, background discard, rescue after reference loading, per-attempt review audio, and microphone shutdown on exit. Note browser/OS versions and stop-to-verdict timings; record Insertion frequency during sentence trials. An unavailable device remains an explicit verification gap, not a blocker to sharing an internal playable build.

**Acceptance:**
1. `run_result_never_opens_normal_sheet_but_history_still_does`.
2. `tab_pause_resume_preserves_run_without_auto_recording`.
3. `other_practice_entries_confirm_before_mutating_session`.
4. `starting_from_long_uses_short_limit_and_clears_old_score`.
5. `route_and_challenge_complete_and_replay_with_budget_and_pending_rules`.
6. `existing_regression_lint_and_build_pass` — retain existing automatic/manual score-sheet tests.
7. `real_ios_record_rescue_review_and_exit_verified` — artifact-backed checklist, or explicitly unverified items.

### Task 7: Optional Normal-Flow Score-First Cleanup

**Files:**
- Modify after Task 3 hands them over: `frontend/src/usePracticeSession.ts`, `frontend/src/usePracticeSession.test.tsx`.
- Modify if needed: `frontend/src/App.test.tsx`.

**Depends on:** Task 3; schedule last. Not a dependency of the game.

**Estimate:** 1–2 additional hours; omit if it threatens the MVP schedule.

- [ ] Move accepted normal result/session/latch updates before collection and refresh. Preserve ordinary default collection threshold and explicit Score behavior for short/long practice.
- [ ] Separate ancillary errors from scoring errors. Retain context checks around late responses and prevent an old finally from releasing a newer request's busy state.
- [ ] Run the related session/App regression tests without weakening stale-context assertions.

**Acceptance:** `ordinary_score_visible_while_collection_pending`, `collection_failure_preserves_score_and_review_latch`, `late_response_and_finally_cannot_modify_new_context`.

## Code Seams

Line references use implementation baseline `aed03b9ff321490929f4d2ec0210b12124a481cf`; locate the named symbols after edits. Frontend paths below are relative to `frontend/src`, backend paths to `backend/app`.

| File and lines | Required seam |
| --- | --- |
| `hooks/useRecorder.ts:5–9,72–86` | Deliver the freshly constructed blob through ready callback. |
| `hooks/useRecorder.ts:34–41,95–100` | Keep existing stop guard; put submission/capture single-flight lock in the run. |
| `hooks/useRecorder.ts:23–32,79–83` | Recorder URLs are revoked; review owns separate URLs from retained blobs. |
| `usePracticeSession.ts:129–146` | Force short recording limit and bridge shared recorder callback. |
| `usePracticeSession.ts:282–292` | Run never sets ordinary result; add runActive short-circuit to weak prefetch at 288–292. |
| `usePracticeSession.ts:501–513,716–759` | Reset old ordinary result; suppress ordinary global shortcuts throughout run ownership. |
| `usePracticeSession.ts:315–383` | Optional Task 7: collection/refresh at 351–355 currently precede result display at 365–373; preserve context/latch checks. |
| `hooks/useSpeech.ts:15,200–235,251–253,339–344` | Local SpeechOptions extension; load-only callback before request checks, never from playback catch. |
| `mobile/screens/PracticeScreen.tsx:91–117,309–321,363–423` | Keep normal sheet behavior; render run separately without feeding session.result. |
| `mobile/MobileApp.tsx:14–22,30–39` | Persist run above conditionally mounted screens; pause on navigation. |
| `mobile/screens/WordsScreen.tsx:31–38`, `HistoryScreen.tsx:12–14` | Confirm before entering another practice context. |
| `api.ts:46–57,97–115,181–186` | Handle malformed success at run boundary; direct short score call; optional collection cutoff. |
| `main.py:249–272,376–439` | Short-score 400/413/503 are pre-billable; classify by status alone. |
| `main.py:464–476`, `storage.py:947–967` | Backend single-word SRS uses top-level accuracy; 60–85 can pass Challenge while remaining due. Full bank can skip a new word. |
| `main.py:102,700–717` | Union pack texts into shared TTS allowlist; public cache fixture needs word boundaries. |

## TypeScript Contract Draft

Task 1 owns these run types in `types.ts`; use existing `ScoreResult`/`ScoreResponse`. Signatures only:

```ts
export type RunMode = "route" | "challenge";
export type RunPhase = "ready" | "recording" | "scoring" | "feedback" | "rescue" | "summary" | "review";
export type AttemptKey = { runId: string; itemId: string; attemptId: string };
export type AttemptPurpose = "initial" | "rerecord" | "rescue";
export type ScoreFailure = { kind: "rejected" | "quota" | "unknown"; message: string };
export type Verdict = "practiced" | "passed" | "relisten" | "saved" | "heart-lost"
  | "no-match" | "unjudged" | "cannot-confirm" | "rejected" | "skipped" | "pending" | "quota-ended";
export type WordCandidate = { word: string; status: "processed" | "unconfirmed" | "save-manually" };
export type Attempt = {
  key: AttemptKey;
  purpose: AttemptPurpose;
  slot: "main" | "extra";
  status: "capturing" | "submitted" | "scored" | "pending";
  recording: Blob | null;
  sessionId: string | null;
  result: ScoreResult | null;
  sync: "not-needed" | "pending" | "done" | "manual";
  candidates: readonly WordCandidate[];
};
export type RunPrompt = {
  itemId: string;
  stage: "warmup" | "focus" | "context";
  kind: "word" | "sentence";
  text: string;
  targetPhoneme: string | null;
  targetWord: string | null;
  source: "due-word" | "starter" | "previous-run";
};
export type RunItem = {
  prompt: Readonly<RunPrompt>;
  attempts: readonly Attempt[];
  resolution: "open" | "resolved" | "skipped" | "unjudged" | "pending";
  verdict: Verdict | null;
  firstLowAttemptId: string | null;
  referenceLoad: "idle" | "pending" | "ready" | "failed";
  lastRejection: { attemptId: string; message: string } | null;
};
export type RunState = {
  runId: string;
  mode: RunMode;
  phase: RunPhase;
  paused: boolean;
  items: readonly RunItem[];
  index: number;
  activeAttemptId: string | null;
  hearts: 0 | 1 | 2 | null;
  budgetUsed: number; // Reserved on send; refunded for rejected, not total HTTP requests.
  mainItemIdsUsed: readonly string[];
  extraUsed: 0 | 1 | 2;
  challengeIncomplete: boolean;
  endReason: "completed" | "hearts-exhausted" | "quit" | "quota" | null;
  challengeOutcome: "cleared" | "failed" | "incomplete" | null;
};
export type RunAction =
  | { type: "START"; runId: string; mode: RunMode; prompts: readonly RunPrompt[] }
  | { type: "BEGIN_CAPTURE"; key: AttemptKey; purpose: AttemptPurpose; slot: "main" | "extra" }
  | { type: "BLOB_READY"; key: AttemptKey; blob: Blob }
  | { type: "CANCEL_CAPTURE"; key: AttemptKey }
  | { type: "SCORE_SENT"; key: AttemptKey }
  | { type: "SCORE_RECEIVED"; key: AttemptKey; response: ScoreResponse }
  | { type: "SCORE_FAILED"; key: AttemptKey; failure: ScoreFailure }
  | { type: "SYNC_SETTLED"; key: AttemptKey; candidates: readonly WordCandidate[]; failed: boolean }
  | { type: "REFERENCE_CLICKED"; runId: string; itemId: string }
  | { type: "REFERENCE_LOADED"; runId: string; itemId: string; ok: boolean }
  | { type: "SKIP" | "ADVANCE" | "CANNOT_CONFIRM"; runId: string; itemId: string }
  | { type: "PAUSE" | "RESUME" | "QUIT" | "OPEN_REVIEW" | "EXIT"; runId: string };
export declare function runReducer(state: RunState | null, action: RunAction): RunState | null;
export declare function judge(result: ScoreResult):
  | { kind: "valid"; accuracy: number } | { kind: "no-match" | "unjudged" };
export declare function canRecord(state: RunState): boolean;
export declare function canSubmit(state: RunState, key: AttemptKey): boolean;
```

Unknown scoring leaves the item pending and advances only through the learner's next-item action; at the last item it completes the traversal with an incomplete Challenge. It is not a run end reason. Never retry that attempt. `SCORE_RECEIVED` sets sentence sync pending atomically; any `SYNC_SETTLED` permits continuing. Reject handling removes that recording and preserves only its latest message. Reference requests are single-flight per item; late callbacks validate run/item identity. There is no reference-ended state or pre-load rescue recording buffer.

## Starter Pack and Provenance

Task 2 enters this fixed 30-item pack: five groups, each with two Warmup words, two Focus words, and two Context sentences. All sentences contain seven words. Bold below identifies the sentence target; do not include Markdown in stored text.

| IPA | Warmup: two items | Focus: two items | Context: Focus reuse | Context: new target |
| --- | --- | --- | --- | --- |
| θ | thin; thick | think; thank | I **think** we can walk home now. | The narrow **path** leads to our house. |
| ð | this; that | these; those | **These** little birds wait by the window. | My **brother** walks home after the rain. |
| ɹ | rain; red | room; road | This **room** feels warm in the morning. | A **river** runs beside the quiet town. |
| l | light; leaf | late; long | We stayed **late** to finish our work. | The **lake** looks calm in the morning. |
| v | vine; van | voice; visit | Her **voice** sounds clear across the room. | We **save** fresh bread for the morning. |

```ts
export type StarterItem = {
  id: string;
  group: "theta" | "eth" | "r" | "l" | "v";
  stage: "warmup" | "focus" | "context";
  text: string;
  phoneme: "θ" | "ð" | "ɹ" | "l" | "v";
  targetWord: string;
};
```

Use en-US IPA without slashes, matching `azure_client.py:29,44`; support the existing `r`/`ɹ` alias (`PhonemeGuideData.ts:1064`). A word item's targetWord is itself. Tags identify a target sound, not a full pronunciation transcription; feedback uses returned phonemes.

Provenance: project-original content drafted with AI assistance, to be reviewed by the repository owner before publication. The implementer owns data entry and structural checks; the owner reviews wording and target sounds. Add one row to `docs/CONTENT-PROVENANCE.md`, accurately retaining “awaiting owner review” until review occurs. Preserve existing provenance entries. Bundle no third-party course text/audio; use existing runtime TTS. Do not infer content provenance from the code's MIT license or add per-item license/review-date fields. Frontend JSON and backend allowlist must contain exactly the same final plain text, including punctuation.

## Final Verification Commands

Run from the repository root after implementation; unit/contract tests use fake services, not billable Azure calls. Record actual results in the acceptance document.

```sh
npm --prefix frontend test -- src/game src/hooks/usePracticeRun.test.tsx src/hooks/useRecorder.test.tsx src/usePracticeSession.test.tsx src/hooks/useSpeech.test.tsx src/components/PracticeRun.test.tsx src/components/RunReview.test.tsx src/mobile/MobileApp.test.tsx src/api.test.ts
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_game_starter_cache.py
bash scripts/test.sh
```

The full script covers ruff, backend tests, frontend lint/tests, and production build. Complete Task 6's real-device checklist separately; passing mocked tests is not device or latency proof. Task 0 remains informational. No deployment or production quota changes are part of this plan.

## Day 1 Parallel Start

- **Task 0:** Ten local measurements, at most one hour; report unavailable conditions without blocking others.
- **Task 1:** Freeze and commit `types.ts` within 1–2 hours, then build the reducer and Challenge arithmetic.
- **Task 2:** Prepare the content table/JSON, owner review, and shared-cache allowlist/tests; connect the selector after types land.
- **Task 3:** Implement the small blob callback, short-mode ownership, shortcut/prefetch guard, and load-only speech callback against the agreed identities.
- **Task 5 static work:** Start only after Task 1's type commit; use fixtures for verdict, summary, and review, then integrate Task 4.

Task 4 follows the model/recorder contracts; Task 6 integrates and verifies the complete flow. Task 7 stays last and optional. With two engineers, keep one on the model/recorder/orchestration path and the other on content/UI, then share integration and device checks without overlapping file ownership.
