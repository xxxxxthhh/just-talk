# Game Mode v2 Implementation Plan

**Goal:** Deliver automatic end-of-speech stopping, derived tiers/chain/1000-point scoring, local personal bests, and the immersive ring/stones/glow interface specified in [Game Mode v2](../design/game-mode-v2.md).

**Architecture:** Keep the existing reducer, frozen deck, shared recorder, short-score API, and session ownership. Add a pure VAD machine, capture-bound stop metadata, one `LOCAL_REJECT` transition, pure scoring selectors, local preferences/PB, and a shared run AudioContext for analysis and synthesized effects. UI consumes facts; animation never changes gameplay or delays controls. No backend changes.

**Tech Stack:** React, TypeScript, MediaRecorder, WebAudio, SVG/CSS, Vitest/Testing Library; existing Python/fake-service regression suite.

**Baseline:** `f5835dee07360e9a9eb9ac51a3b9ee17a1820f64`. The uncommitted design is authoritative; its SHA-256 at planning time is `53154f4d2005f62fa3d4af22a5980fd4ac2188a64096291d9ef5756d4562099a`. Preserve it and unrelated work. This plan does not authorize commits, publishing, deployment, or quota changes.

**Schedule:** Approximately 60–72 engineer-hours: 7–9 days for one engineer, about 5 days for two, including integration/device contingency. Track A owns behavior/audio/data; Track B owns presentation/navigation. Day 1 contracts unblock fixture-driven UI; final wiring waits for real APIs. Estimates below are working time, not elapsed dependency waits.

**Ownership:** A alone edits `frontend/src/types.ts`; B alone edits `frontend/src/game/game.css`. Each track remains the sole writer of its other listed files across tasks. A never patches B's components to resolve integration; B never patches A's hooks/types. Request the owning track's change. No task owns the backend, `api.ts`, starter pack, ordinary `scoreTone`, or the design document. All checkboxes describe future work, not completed checks.

---

### Task 0: Freeze Day 1 Contracts

**Files:**
- A — Modify: `frontend/src/types.ts` (v2 contracts and rejection typing only).
- B — Create: `frontend/src/components/RunRing.tsx` (props and minimal accessible scaffold), `frontend/src/components/runV2Fixtures.ts` (typed UI fixtures).
- Contract signatures and responsibilities are specified below; later implementation files retain their task owners.

**Depends on:** Final v2 design and the verified baseline; no implementation tasks.

**Estimate:** 2 hours per track, together at the start of Day 1.

- [ ] Freeze capture summary/options, rejection reasons, scoring/evidence view models, PB receipts, session/controller methods, and RunRing props before splitting. Keep ordinary recorder consumers backward compatible through an adapter.
- [ ] A publishes the shared types; B imports them and compiles fixtures for ready, recording, fallback, scoring, every tier, rescue, heart loss, rated/unrated summary, and review. Freeze LOCAL_REJECT's shape now, but extend the RunAction union together with its handler in A1 so the intermediate build remains complete. Do not invent alternate UI-only scoring rules.
- [ ] Specify synchronous audio unlock on Start/Play again before any await, immutable per-take preference snapshots, and immutable metadata delivered with the matching blob.
- [ ] Agree that UI remounts reuse a run-lifetime PB receipt and consumed feedback IDs held above conditional screens; do not create component-global event trackers.
- [ ] Record the design's rolling-floor limitation: starting at −55 with upward drift capped at +1 dB/s cannot reach N > −32 within a healthy 6/14-second auto take. Implement the stated spread fallback/caps; do not silently remove the drift bound or claim steady TV/fan rejection. Device observations may motivate a separate design revision.

**Acceptance:** `v2_contract_fixtures_typecheck` — `npm --prefix frontend run build`; fixtures use the real contract, not unsafe casts. The following contracts must be readable before A/B implementation begins.

## Day 1 Contract Draft

Shared types belong to A in `types.ts`; function implementations belong to the tasks below. These signatures establish the boundary, not new reducer phases or persisted run history.

```ts
export type AutoStopState = "off" | "calibrating" | "listening" | "tail" | "fallback" | "stopping";
export type LocalRejectReason = "too-short" | "no-speech";
export type CaptureStopReason = "manual" | "silence" | "no-speech" | "short-voice"
  | "auto-cap" | "hard-cap" | "cancel" | "pause" | "quit" | "exit" | "replaced";
export type CaptureSummary = Readonly<{
  captureId: string; // Equal to the owning attemptId; callback also closes over AttemptKey.
  stopReason: CaptureStopReason;
  durationMs: number; // Monotonic; recorder.start() to first accepted stop, not onstop delivery.
  detectionValid: boolean;
  speechSeen: boolean;
  voicedMs: number;
}>;
export type RunCaptureOptions = Readonly<{
  key: AttemptKey; kind: "word" | "sentence"; autoStop: boolean;
}>;
export type CaptureTelemetry = Readonly<{
  captureId: string | null; level: number; silenceProgress: number;
  autoStopState: AutoStopState; elapsedMs: number;
}>;
// Extend RunAction with exactly this transition; leave existing actions intact.
// | { type: "LOCAL_REJECT"; key: AttemptKey; reason: LocalRejectReason }
// Extend lastRejection with optional localReason; preserve existing server messages.
export type RunTier = "perfect" | "great" | "good" | "relisten";
export type RunRating = "S" | "A" | "B" | "C";
export type RunItemScore = Readonly<{
  itemId: string; firstAccuracy: number | null; tier: RunTier | null;
  chain: number; basePoints: number; chainPoints: number;
}>;
export type RunScoreView = Readonly<{
  items: readonly RunItemScore[]; points: number; currentChain: number;
  longestChain: number; rated: boolean; rating: RunRating | null;
  unratedReason: string | null; fullCombo: boolean;
}>;
export type RevisitEvidence = Readonly<{
  itemId: string; attemptId: string; word: string; phoneme: string | null;
  accuracy: number; scoreSource: "word" | "phoneme";
}>;
export type RevisitSuggestion = Readonly<{
  id: string; summary: string; evidence: readonly RevisitEvidence[];
}>;
export type RunBestReceipt = Readonly<{
  runId: string; previousPoints: number | null;
  outcome: "first-record" | "new-best" | "none";
}>;
```

Selectors in `game/scoring.ts`: `tierForAccuracy(number | null): RunTier | null`, `selectRunScore(RunState): RunScoreView`, `selectReviewSuggestions(RunState): readonly RevisitSuggestion[]`, `selectTopRevisit(RunState): RevisitSuggestion | null`, and `runWeakWords(RunState): string[]`. Keep judgeability and attempt selection centralized; selectors never access storage/audio or import UI modules.

Session boundary: `prepareRunAudio(): void` attempts synchronous gesture-based context creation/resume; `startRunCapture(options, onReady: (blob, summary) => void): Promise<boolean>`; `stopRunCapture(reason): void`; `cancelRunCapture(reason): void`; and read-only `runCaptureTelemetry`. Preserve ordinary `stopRecording`/explicit Score. Cancellation still delivers the old capture's callback for releasing its lock, but never republishes shared preview.

Controller boundary: expose score view, PB receipt/current bucket best, shared sound/auto-stop preferences and setters, telemetry, `cancelTake()`, and existing start/stop/pause/resume/quit/exit actions. `useManualStopNextTake()` persists Auto-stop off for the next capture. `playReference` and `stopReference` use existing speech cancellation; expose reference playback state/time for the review controls. B's owned player stops before Coach starts; starting You invalidates pending Coach playback.

RunRing props belong to B in `RunRing.tsx`:

```ts
export type RunRingProps = {
  phase: "ready" | "recording" | "scoring" | "verdict" | "rescue" | "summary";
  telemetry: CaptureTelemetry;
  accuracy: number | null; tier: RunTier | null; rating: RunRating | null;
  reducedMotion: boolean; feedbackId: string | null;
  onStop: () => void;
};
```

The ring is decorative in ready. In recording, its accessible stop target has a 400 ms guard keyed to capture start; the bottom Stop never inherits that guard. RunRing owns no network, recorder, scoring, PB, or SFX side effects. B maps props from fixtures first and the controller later. A supplies real selectors/controllers without changing these props unilaterally.

---

### Task A1: Implement Pure VAD and LOCAL_REJECT

**Files:**
- A — Create: `frontend/src/game/vad.ts`, `frontend/src/game/vad.test.ts`.
- A — Modify: `frontend/src/game/runModel.ts`, `frontend/src/game/runModel.test.ts`, `frontend/src/types.ts`.

**Depends on:** Task 0.

**Estimate:** 5–6 hours.

- [ ] Implement pure timestamped-frame processing and one terminal decision per capture. Use the design's rolling 10th-percentile floor, −55 initial value, +1 dB/s upward bound, and immediate-speech rule for the opening 250 ms above −40. Specify the percentile convention and replay opening frames without counting them twice.
- [ ] Apply onset clamp/3-of-5 detection, 6 dB hysteresis, voiced time 250/500 ms, continuous tail 650/1000 ms, no-onset timeout 4/6 s, and auto cap 6/14 s. Keep the tail in the recording. Do not add the superseded first-250ms static floor or keep-warm behavior.
- [ ] Apply first-eight-frame spread fallback, running-context checks and >250 ms gap invalidation. Integrate time monotonically; a scheduling gap contributes neither silence nor invented voiced time. Auto-off/fallback has no VAD stop or reject; manual/hard-cap remains available.
- [ ] Cover onset followed by insufficient voice: after the tail, reject too-short; at the auto cap, always terminate, submitting only when minimum voice is met. Manual ≥450 ms always submits regardless of VAD; manual <450 ms rejects. Cancellation always discards silently.
- [ ] Add `LOCAL_REJECT` for the matching capturing attempt: remove it, clear active identity, return to ready/rescue, and set local rejection metadata. Do not reserve/refund budget, change first-low evidence, or touch heart arithmetic. Next BEGIN_CAPTURE clears the notice.

**Acceptance:** In `vad.test.ts`: `quiet_voice_from_t0_is_detected`, `rolling_floor_obeys_percentile_and_drift`, `short_onset_rejects_without_hanging`, `sentence_pause_1050ms_documents_energy_endpoint_limit`, `noisy_spread_falls_back_and_steady_noise_has_bounded_cap`, `sample_gap_never_counts_as_silence`, `word_and_sentence_caps_terminate_once`, `manual_400ms_rejects_but_3000ms_without_onset_submits`. In `runModel.test.ts`: `local_reject_keeps_main_budget_zero`, `rescue_local_reject_preserves_extra_and_first_low`, `duplicate_stale_and_submitted_local_reject_are_noops`.

### Task A2: Add Scoring, Personal Bests, and Shared Preferences

**Files:**
- A — Create: `frontend/src/game/scoring.ts`, `scoring.test.ts`, `personalBest.ts`, `personalBest.test.ts`, `preferences.ts`, `preferences.test.ts` (all under `frontend/src/game/`).
- A — Modify: `frontend/src/types.ts`, `frontend/src/components/PublicGate.tsx`, `PRIVACY.md`.
- A — Create: `frontend/src/components/PublicGate.test.tsx`.

**Depends on:** Task 0; independent of A1 runtime. B2/B3 can use fixtures while this lands.

**Estimate:** 6–7 hours.

- [ ] Implement raw 95/85/60 tiers, first-valid q per original slot, chain hold while the current item remains unjudged, and chain break when leaving a gap. Rescue never replaces q. Compute base plus chain exactly as designed, round once, and never re-normalize partial runs.
- [ ] Require normal terminal completion AND per-item valid/resolved evidence for rated Route; require cleared Challenge. Never rely on endReason alone, rate an in-progress/quit run, or treat sentence-collection pending as an unknown pronunciation result. Derive S/A/B/C, longest chain, and Full combo without new reducer state.
- [ ] Move evidence selection out of UI: preserve v1 low/borderline and previous-weak-word behavior, deduplicate suggestion evidence by attempt, return at most three suggestions and one top revisit with score source. Avoid a scoring→RunReview→PracticeRun import cycle; B removes old helpers/re-exports as needed in B3.
- [ ] Implement `jt.runBest.v1` buckets by mode/frozen focus/rules version, rated-only writes, strict improvement, First record, ties, public seven-day expiry, and tolerant storage parsing/writes. A4 owns the run-lifetime receipt; storage code accepts a frozen comparison, rather than recomputing after writing.
- [ ] Implement one shared preference source for `jt.sfx` and `jt.autoStop`, both default true. Each capture snapshots Auto-stop; toggling either direction during a take applies to the next take. Sound mute applies immediately to output only.
- [ ] Clear all three keys after successful Delete my data and before reload; leave unrelated keys intact. Document these exact keys/retention in PRIVACY.md. Storage failures must not block practice or deletion completion.

**Acceptance:** In `scoring.test.ts`: `tiers_compare_raw_boundary_values`, `design_examples_score_861_930_904_978_955_865_540`, `rescue_never_rewrites_first_score`, `unjudged_holds_but_left_gap_breaks_chain`, `route_completed_with_gaps_is_unrated`, `quit_quota_and_heart_exhaustion_are_unrated`, `partial_points_keep_fixed_denominator_and_round_once`, `suggestions_are_deduplicated_and_label_score_source`. In PB/preferences/Gate tests: `best_uses_mode_frozen_focus_and_rules_version`, `strict_best_first_record_and_tie`, `public_expiry_does_not_slide_on_read`, `corrupt_or_unwritable_storage_is_nonfatal`, `preferences_share_defaults_and_persistence`, `delete_data_clears_only_game_storage_before_reload`.

### Task A3: Integrate Capture Analysis and the Shared Audio Runtime

**Files:**
- A — Modify: `frontend/src/hooks/useRecorder.ts`, `useRecorder.test.tsx` (same directory), `frontend/src/usePracticeSession.ts`, `frontend/src/usePracticeSession.test.tsx`.
- A — Create: `frontend/src/game/runAudio.ts`, `runAudio.test.ts`, `sfx.ts`, `sfx.test.ts` (same game directory).

**Depends on:** Tasks 0, A1, A2 preferences; ordinary `useSpeech` public methods stay intact.

**Estimate:** 9–11 hours, including mocked MediaRecorder/AudioContext races.

- [ ] Keep one MediaRecorder/MediaStream per take, browser MIME detection, per-recorder chunks, and the discarded/superseded preview guard. Add capture-initialization hooks so analysis attaches before recording starts; create no second microphone stream and do not route microphone input to speakers.
- [ ] Start the monotonic capture clock at recorder.start. Connect fftSize 1024/RMS/dBFS sampling at about 25 ms, exposing bounded telemetry without re-rendering the entire run per audio frame. Connect cancellation and device failure to the pure VAD decisions.
- [ ] Use one stop-once latch for manual, silence, short-voice, no-speech, auto-cap and the existing hard cap. Latch duration and initial reason at the accepted stop, not delayed onstop. A later cancel before handoff overrides delivery disposition to discard; freeze the final delivered summary at handoff. Keep the callback bound until it fires, including late permission resolution.
- [ ] Pass the fresh blob and immutable summary to the capture's callback. Preserve the existing ordinary `(blob, discarded)` behavior via adapter; normal explicit Score must not become auto-submit or subject to run-only rejection policy.
- [ ] Create/resume the shared run AudioContext from a user gesture; a failed/suspended context degrades to manual recording, never fabricated silence. Muting controls SFX gain/sources, not context state. Dispose nodes/timers on every stop/exit; release context ownership after the run, without affecting ordinary playback.
- [ ] Synthesize good/great/perfect/heart/clear/rescue-saved cues. Cancel scheduled cues and stop Coach/You before microphone acquisition; suppress all UI sounds throughout acquisition/recording. Use event IDs for one cue per accepted result; prefer heart over duplicate low-result cues, and no fanfare for unrated runs. Sound failures are nonfatal.

**Acceptance:** Recorder/session tests: `analyser_attaches_before_capture_clock_starts`, `permission_wait_does_not_consume_capture_timeout`, `racing_stop_sources_deliver_one_frozen_summary`, `cancel_after_stop_before_onstop_discards_delivery`, `late_permission_and_cancelled_onstop_do_not_publish_preview`, `normal_to_run_and_run_to_normal_keep_capture_ownership`, `auto_preference_change_applies_next_take`, `fallback_retains_manual_and_session_hard_cap`, `ordinary_explicit_score_is_unchanged`. Audio tests: `mute_keeps_analysis_context_running`, `microphone_open_cancels_and_suppresses_all_cues`, `cue_is_once_per_event_and_cancelled_on_exit`, `audio_unlock_failure_keeps_manual_flow`.

### Task A4: Wire the Run Controller, Rejection Path, and Result Receipts

**Files:**
- A — Modify: `frontend/src/hooks/usePracticeRun.ts`, `frontend/src/hooks/usePracticeRun.test.tsx`.
- A — Modify if required for the frozen bridge: `frontend/src/usePracticeSession.ts`, `frontend/src/usePracticeSession.test.tsx`, `frontend/src/types.ts` (same owner, after A3).

**Depends on:** A1–A3; exposes the live boundary consumed by B4.

**Estimate:** 6–7 hours.

- [ ] Unlock audio synchronously at start/playAgain before deck-fetch awaits; retain the existing start/exit token. Freeze focus from the accepted deck and rules version for PB. Preserve weak-word priority and short-mode entry from Long Passage.
- [ ] Give each capture its key/kind/preference snapshot. In handleBlob, reject stale/cancelled summaries, then classify local rejection BEFORE BLOB_READY/SCORE_SENT and before creating run review URLs. Only valid submission crosses SCORE_SENT once. Do not refund a local reject or retry unknown results.
- [ ] Implement cancelTake as cancellation of the current capture, not SKIP; keep its in-flight lock until callback delivery. Provide the next-take manual fallback action without consuming an attempt. Preserve server failure classifications, single refund, sentence cutoff/order, and processed/unconfirmed mapping.
- [ ] Expose selectors, preferences, telemetry, and frozen PB receipt. Finalize PB once per completed rated run above conditional screens, before rendering celebratory feedback. Preserve receipt/event IDs across summary/review remounts; reset them only with a new run/exit, not every render.
- [ ] Route reference playback through existing speech generation cancellation; expose stopReference and reference status/time. Stop run audio/cues on pause/quit/exit and new capture; retain reference-loaded rescue eligibility without waiting for ended. UI-owned You playback is stopped through B's lifecycle/wiring.
- [ ] Preserve submitted-result settlement while paused, and disposal of late callbacks after quit/exit/playAgain. Never write run results into session.result or release another context's busy state. Keep URL ownership and release rules unchanged.

**Acceptance:** In `usePracticeRun.test.tsx`: `local_reject_never_sends_or_allocates_review_url`, `manual_stop_without_onset_still_submits`, `manual_silence_cap_race_submits_once`, `cancel_take_does_not_skip_or_use_budget`, `pb_receipt_survives_summary_remount_without_rewrite`, `new_stats_do_not_change_pb_bucket`, `pause_allows_matching_submitted_result_without_new_capture`, `quit_exit_play_again_drop_late_capture_and_cues`, `start_exit_token_and_sentence_collection_regressions_hold`.

### Task B1: Build Ring, Stones, Tokens, and Responsive Layout

**Files:**
- B — Modify: `frontend/src/components/RunRing.tsx`, `frontend/src/game/game.css`.
- B — Create: `frontend/src/components/RunRing.test.tsx`, `RunStones.tsx`, `RunStones.test.tsx` (same components directory).
- B — Modify: `frontend/src/components/runV2Fixtures.ts` (B's fixture file throughout B tasks).

**Depends on:** Task 0; no live audio/network dependency.

**Estimate:** 5–6 hours.

- [ ] Implement a single SVG ring with ready/recording/scoring/verdict/rescue/summary shapes; use CSS transforms/opacity for decorative animation. Directly update functional silence arc/level; keep it separate from decorative timing.
- [ ] Use a 200px diameter, min(200px,26dvh) on short screens, 224px normal slot, and responsive slot shrinkage. Level/pop transforms never move text. Bound glow to opacity 0.18; reserve gold for Perfect/S. Scope tier tokens to the game; do not modify ordinary scoreTone.
- [ ] Render six 28px stones in labelled 2+2+2 groups; preserve distinct skip/unjudged/pending marks and rescued coral outline. Expose first-reading evidence separately from rescue outcome so a saved stone cannot imply rewritten score.
- [ ] Make ready ring decorative and recording ring an accessible stop target; apply the 400ms guard only to it. Keep the bottom action independently operable. Freeze DOM layout while the ring animates.
- [ ] Implement the design's complete reduced-motion table, including static scoring arcs, direct final numbers and functional uneased silence arc. Test all fixtures at 390×844 and a short viewport; middle content scrolls while the thumb zone remains usable.

**Acceptance:** `ring_ready_is_decorative_and_recording_can_stop`, `ring_guard_never_disables_bottom_stop`, `ring_motion_has_static_reduced_variants`, `stones_encode_tier_and_nonjudgment_status`, `ring_and_stones_do_not_shift_prompt_layout`. Component tests cover semantics/timing; visual layout evidence is recorded in Task 9, not inferred from jsdom.

### Task B2: Rebuild Every Run Screen and Nonblocking Summary

**Files:**
- B — Modify: `frontend/src/components/PracticeRun.tsx`, `frontend/src/components/PracticeRun.test.tsx`, `frontend/src/game/game.css`, `frontend/src/components/runV2Fixtures.ts`.

**Depends on:** B1; A2 selectors for final binding, with Task 0 fixtures sufficient to start.

**Estimate:** 8–9 hours.

- [ ] Replace stacked cards with header/stones/prompt/ring/status and the fixed thumb zone. Add Pause, stable Record/Stop, Cancel take, Auto-stop state, and compact Next. Render local rejection copy directly and the one-tap manual fallback; retain separate server-rejection wording.
- [ ] Show neutral scoring immediately and slower-wait copy after about five seconds; invent no request timeout, predicted score, or automatic resend. Pause/Quit remain usable.
- [ ] Bind tier/chain/points to final selector values. Roll valid ≥60 scores for 450ms, show lows directly, and keep boundary values such as 84.9 distinguishable from the 85 threshold. Per-item points lines must distinguish base/chain and not change total rounding.
- [ ] Implement two-step rescue with only the currently actionable primary control, No heart lost yet, at-risk heart pulse, and labelled Skip rescue. On a second low, show both readings, one heart loss, and an optional nonblocking 800ms decorative overlay at zero hearts.
- [ ] Show rated S–C or neutral Not rated with earned points, actual hearts, longest chain, PB receipt and one top revisit. C says Logged even when Challenge cleared. Render all summary buttons at frame zero; the ≤1.55s sequence ends immediately when any button acts. Do not append the crack overlay to a second full sequence.
- [ ] Remove the old module-level vibration tracker. Consume A's run-lifetime feedback identities for optional haptics; do not replay feedback on sync updates/remount. Announce each semantic state once, keep rolling digits aria-hidden, and preserve button focus.

**Acceptance:** `verdict_uses_game_tier_not_score_tone`, `rolling_score_never_changes_game_facts_or_blocks_next`, `local_rejection_has_own_copy_and_manual_fallback`, `rescue_has_one_primary_action_and_preserves_reference_gate`, `heart_overlay_never_intercepts_summary_buttons`, `summary_frame_zero_actions_cancel_animation`, `unrated_and_cleared_c_have_honest_summary`, `aria_announces_final_state_once_and_keeps_focus`.

### Task B3: Rebuild Review and Coordinate You/Coach Playback

**Files:**
- B — Modify: `frontend/src/components/RunReview.tsx`, `frontend/src/components/RunReview.test.tsx`, `frontend/src/game/game.css`.
- B — Create: `frontend/src/components/RunMiniPlayer.tsx`, `frontend/src/components/RunMiniPlayer.test.tsx`.

**Depends on:** B1 and A2 evidence selectors; A4 reference controls for final live integration.

**Estimate:** 6–7 hours.

- [ ] Use A's pure evidence selectors and remove duplicate UI calculations/import cycles; retain compatibility re-exports temporarily if existing tests/imports need them. Preserve weak-word replay ordering and candidate-status facts, not old duplicated player markup.
- [ ] Render compact score/stones navigation, at most three deduplicated suggestions, labelled word/phoneme/sentence scores, and collapsed unreached items. All-readings rows link to the selected shared playback surface instead of duplicating audio controls for the same attempt.
- [ ] Build a dark DOM-accessible mini player backed by one You audio element and existing Coach service. Show Take 1/Take 2 with their actual scores. No recording means no empty player; playback errors are readable and do not change a judgment.
- [ ] Selecting Coach first stops You; selecting You stops/cancels pending Coach. Item/take changes, pause, unmount, exit, and playAgain stop audio; late play/load completion cannot resume the prior source. Reuse controller URLs without making/revoking their ownership copies.
- [ ] Keep existing processed/unconfirmed/save-manually labels, public-mode restrictions, and personal Generate drill behavior. Do not add a new save-word API pathway or pretend that requesting collection means success.

**Acceptance:** `review_deduplicates_suggestions_and_preserves_score_source`, `rescue_takes_keep_matching_audio_and_scores`, `one_you_or_coach_source_plays_at_a_time`, `late_coach_load_cannot_interrupt_you`, `review_unmount_stops_audio_without_revoking_controller_urls`, `unreached_collapses_and_missing_audio_has_no_player`, `review_keeps_candidate_and_public_drill_boundaries`.

### Task B4: Integrate Entry, Immersion, Pause, and Exit Paths

**Files:**
- B — Modify: `frontend/src/mobile/screens/PracticeScreen.tsx`, `frontend/src/mobile/MobileApp.tsx`, `frontend/src/mobile/MobileApp.test.tsx`, `frontend/src/mobile/mobile.css`, `frontend/src/game/game.css`.

**Depends on:** A4, B2, B3 for live integration; entry fixture work may start after Task 0.

**Estimate:** 5–6 hours.

- [ ] Replace Quick run with a 220–260px responsive hero: frozen-theme preview, six stones, bucket Best, Route/Challenge explanations, shared toggles, full-width Start, and public usage. Say This run's sound; do not add a daily lock. Disable Start during ordinary recording/scoring and run start in flight.
- [ ] Hide tabs while a run owns practice, including paused/summary/review; restore them on Done/exit. Add explicit Pause/Resume without automatically recording. Use existing 100dvh/safe-area layout with a shrinking/scrolling center and ~144px thumb zone; support long prompts and large text.
- [ ] Use an accessible in-app Quit confirmation. Pause/discard active unsubmitted capture before presenting it, so modal waiting cannot trigger auto-submit. Cancel remains paused with explicit Resume; confirm calls run.quit and retains review, never run.exit. Keep submitted requests single-shot and their existing terminal semantics.
- [ ] Wire frame-zero summary Review/Play again/Done and cancel their UI sequences. Preserve other-context confirmation before shared-session mutations; browser hiding still pauses/discards. Neither run results nor run recording preview may open the normal result sheet.
- [ ] Preserve Generate drill's exit-before-context-change behavior and progress/error on Practice. Validate from Long Passage, personal/public mode, and rapid repeated start/exit/playAgain actions.

**Acceptance:** In `MobileApp.test.tsx`: `entry_preferences_and_frozen_focus_best_are_shared`, `immersive_run_hides_tabs_and_pause_resume_is_explicit`, `quit_confirmation_calls_quit_not_exit`, `quit_dialog_cancels_capture_before_waiting`, `cancel_quit_keeps_paused_run_and_results`, `run_result_never_opens_normal_sheet`, `long_passage_run_stays_short_and_play_again_is_fresh`, `drill_progress_and_error_survive_return_to_practice`.

### Task 9: Integrated Verification and Owner Device Pilot

**Files:**
- B — Create: `docs/testing/game-mode-v2-acceptance.md` (sole evidence-document owner).
- A/B fix only their own implementation/test files listed above; no ownership transfers during integration.

**Depends on:** A1–A4 and B1–B4.

**Estimate:** 3–4 hours per track, reserved for integrated checks, the owner pilot and initial fixes. Larger device/audio failures extend the estimate rather than disappearing from the evidence.

- [ ] A runs the focused and full commands below; B records commands, actual exit results, exact revision/dirty state, and any unresolved failures. Replace obsolete v1 visual expectations with v2 expectations while retaining v1 behavioral race/budget assertions.
- [ ] B records 390×844 and short-screen evidence for every state, plus large text, reduced motion, and VoiceOver. Do not use unit-test success as proof of real layout, browser audio policy, or device latency.
- [ ] Conduct the owner's pilot on iOS Safari and desktop Chrome using the checklist below. No three-person gate. Prefer local recordings for endpoint experiments; scoring remains manual/intentional and bounded by available trial quota. Never retry unknown submissions automatically.
- [ ] Record actual word/sentence parameters used and any false cut, missed onset, noisy submission, or fallback. Keep untested items explicitly Not verified; an unavailable device does not block an internal playable build but is not device approval.

**Acceptance:** `v2_regression_lint_and_build_pass`, `v2_390x844_and_short_viewport_evidence_recorded`, `owner_ios_safari_and_desktop_chrome_pilot_recorded` — artifact-backed checklist with pass/fail/not-verified per item, not fabricated automated test names.

## Code Seams

Line numbers refer to baseline `f5835de`; locate the named symbols after edits. All frontend paths below are relative to `frontend/src`.

| File and baseline lines | Owner/task | Required seam |
| --- | --- | --- |
| `types.ts:236–316` | A / 0,A1 | Run types/action; capture and selector contracts, local rejection discriminant. |
| `game/runModel.ts:224–270,290–308` | A / A1 | Capturing identity, cancel removal, send-only budget increment; local reject must not refund. |
| `game/runModel.ts:352–384` | A / A1,A4 | Pause/quit/exit invalidation; preserve late-response policy. |
| `hooks/useRecorder.ts:5–9,35–49` | A / A3 | Backward-compatible callback adapter and one stop entry. |
| `hooks/useRecorder.ts:55–111,117–133` | A / A3 | Stream/MIME, preview ownership, start clock, hard cap, discard/reset. |
| `usePracticeSession.ts:130–154,547–584` | A / A3 | Short-mode cap, shared recorder, run entry and capture cancellation. |
| `usePracticeSession.ts:328–415,828–833,1001–1005` | A / A3,A4 | Preserve normal score-first/context behavior and shortcut isolation; expose run bridge. |
| `hooks/usePracticeRun.ts:82–103,125–170` | A / A4 | Run-lifetime receipts/event IDs, start token, metadata, pre-send reject. |
| `hooks/usePracticeRun.ts:172–211,215–306` | A / A4 | Single submit/collection, reference gate, cancellation, URL release and playAgain. |
| `game/runDeck.ts:13–23,54–89` | Read-only | Derive frozen focus; keep varying warm-ups and previous weak-word priority. |
| `components/RunReview.tsx:15–108` | A selectors / B3 UI | Extract evidence/weak-word derivation without cross-editing or circular imports. |
| `components/PracticeRun.tsx:123–134,142–217,241–355` | B / B2 | Replace global vibration bookkeeping, stacked controls, scoreTone and summary. |
| `components/RunReview.tsx:157–290` | B / B3 | Review props, duplicated native players, candidate statuses and action placement. |
| `mobile/screens/PracticeScreen.tsx:173–203,276–298` | B / B4 | Separate run surface, drill exit, controller wiring and hero replacement. |
| `mobile/MobileApp.tsx:15–55,59–84` | B / B4 | Persistent controller, visibility pause, exit vs quit, conditional tabs. |
| `mobile/mobile.css:1–28,621–628`; `game/game.css:1–64` | B / B1,B4 | Dynamic viewport, nested overflow, safe area, ring slot and thumb zone. |
| `components/PublicGate.tsx:236–245`; `PRIVACY.md:37` | A / A2 | Clear local keys before reload; document local retention/deletion. |
| `hooks/useSpeech.ts:359–372` | Read-only | Existing play/stop/time methods support Coach coordination; preserve load callback semantics. |

## Real-Device Checklist

Record browser/OS, viewport, input device, sound/auto-stop settings, observed stop reason, and evidence location for each row. Default status is Not verified; device observations are not inferred from mocks.

- [ ] **Pilot platforms:** iOS Safari and desktop Chrome; optional vibration-capable browser for haptics. iOS Safari receives no vibration promise.
- [ ] **Immediate/quiet voice:** speak from t=0, including the −36dBFS synthetic scenario's real-world analogue; confirm opening audio survives and manual fallback can submit.
- [ ] **Endpoint quality:** short words, final /θ/ and /s/, quiet tails, slow sentences and a ~1.05s pause; replay the captured end. Document premature sentence stops rather than claiming semantic completion.
- [ ] **Noise/caps:** fan/TV, transient noise, no speech, very short onset, prolonged speech; verify fallback or bounded single submission and the 6/14s vs existing hard-cap distinction.
- [ ] **Manual control:** Stop at ~0.4s and at ~3s without detected onset; bottom Stop remains responsive during ring guard. Cancel take uses no score call and does not skip the item.
- [ ] **Ownership/races:** permission denial/delay, stop then pause, lock/background/resume, quit dialog, rapid playAgain; no late blob reaches the wrong run or ordinary preview. Microphone indicator shuts down after each take/exit.
- [ ] **Audio:** default-on cues, entry/in-run mute persistence, iOS silent switch, suspended context, rescue Coach→record, You↔Coach including delayed load. No UI sound enters an open microphone; mute leaves VAD working.
- [ ] **UI/accessibility:** every screen at 390×844, shorter viewport/browser chrome, long prompt, large text, VoiceOver and reduced motion. Correctly labelled buttons stay visible/live throughout verdict, crack and summary animations.
- [ ] **Gameplay/data:** Route gaps are unrated; cleared C says Logged; rescue/heart exhaustion/quota behave as v1; PB first/new/tie, remount and Delete my data; review take/score matching, drill progress/error and ordinary Score regression.

## Final Verification Commands

Run from the repository root after implementation. Tests use mocks/fake backend services; these commands do not call paid Azure endpoints. Do not install dependencies, deploy, or alter production quotas as part of verification without separate scope.

```sh
git status --short
git diff --check
npm --prefix frontend test -- src/game src/hooks/useRecorder.test.tsx src/usePracticeSession.test.tsx src/hooks/usePracticeRun.test.tsx src/hooks/useSpeech.test.tsx
npm --prefix frontend test -- src/components/RunRing.test.tsx src/components/RunStones.test.tsx src/components/PracticeRun.test.tsx src/components/RunReview.test.tsx src/components/RunMiniPlayer.test.tsx src/components/PublicGate.test.tsx src/mobile/MobileApp.test.tsx
bash scripts/test.sh
```

`scripts/test.sh` runs backend ruff/pytest, frontend lint/full tests, and the production TypeScript/Vite build. Record unavailable tools/dependencies as unavailable checks. Complete the real-device checklist separately. Only repeat passing checks after changes or newly identified concerns.

## Parallel Delivery Order

| Day | Track A | Track B | Integration checkpoint |
| --- | --- | --- | --- |
| 1 | Task 0, A1 | Task 0, B1 | Types/props frozen; VAD and UI use the same states/reasons. |
| 2 | A2; begin A3 | B2 against fixtures/selectors | Exact scoring examples and every static screen work. |
| 3 | A3 | B3; entry fixture work | Capture metadata/SFX and single-player contracts proven separately. |
| 4 | A4 | B4, finish B2/B3 live binding | End-to-end Route/Challenge with real controller, no competing file writes. |
| 5 | Task 9 and A-owned fixes | Task 9, evidence and B-owned fixes | Full checks, owner pilot, explicit remaining verification gaps. |

Hard difficulty, microphone keep-warm, sentence-tier retuning, mastery maps, leaderboards and backend persistence remain outside this cut.
