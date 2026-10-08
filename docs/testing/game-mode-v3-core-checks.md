# Game Mode v3 core checks

Track A's record of the core (non-UI) acceptance for Game Mode v3 ([design](../design/game-mode-v3.md), [plan](../development/game-mode-v3-implementation-plan.md), Task A6). It maps the plan's checks to tests that exist in the repository and to command output, and it names what is not yet verified. Mocked and fake-service tests are not device evidence; browser layout, audio policy and physical recording stay **Not verified** here and belong to Track B's unified device checklist (`game-mode-v3-device-checklist.md`).

**Status:** Partial. Everything below that does not depend on B7 (My words UI) is recorded. The final end-to-end pass, including B7's `WordsScreen.test.tsx` and B's post-A5 `route12_production_pack_completes_summary_review_and_replay`, is added after B7 lands.

## Automated results

Revision `1859254` (`feat/game-mode-v3`). The shared working tree held impl-ui's uncommitted changes at the time, so every command ran from a clean `git archive` export of that commit, with the repository's own `frontend/node_modules` and `.venv` linked in. Mocks and fake synthesizers only; no Azure calls.

| Command | Exit | Result |
| --- | --- | --- |
| `git diff --check` (export is a clean commit) | 0 | Clean |
| `npm --prefix frontend test -- --run src/game` | 0 | 11 files, 109 passed |
| `npm --prefix frontend test -- --run src/hooks/usePracticeRun.test.tsx src/hooks/useRecorder.test.tsx src/hooks/useSpeech.test.tsx src/usePracticeSession.test.tsx` | 0 | 4 files, 107 passed |
| `npm --prefix frontend test -- --run src/components/RunHero.test.tsx src/components/RunStones.test.tsx src/components/RunRing.test.tsx src/components/PracticeRun.test.tsx src/components/RunReview.test.tsx src/components/RunMiniPlayer.test.tsx src/components/useReplay.test.tsx src/components/PublicGate.test.tsx src/mobile/MobileApp.test.tsx` | 0 | 9 files, 115 passed |
| `npm --prefix frontend test -- --run src/mobile/screens/WordsScreen.test.tsx` | 1 | **Not run: the file does not exist yet (B7).** |
| `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_game_starter_cache.py backend/tests/test_api.py backend/tests/test_public_word_bank.py` | 0 | 33 passed |
| `bash scripts/test.sh` | 0 | Ruff clean; 120 backend tests passed; lint 0 errors; 36 files, 437 frontend tests passed; production build succeeded |

`--run` was added to the plan's Vitest commands so they exit instead of watching.

Existing warnings, none from v3 code:

- ESLint, 7 `react-hooks/exhaustive-deps` warnings: `components/AudioVisualizer.tsx` 166, 519; `hooks/useAudioPlayer.ts` 34, 44, 64; `hooks/useSpeech.ts` 189, 355.
- Vite's notice that `vite.config.ts` uses ESM syntax in a file loaded as CommonJS (the build still succeeds).

## Implementation the plan keeps unchanged

`git diff --stat 7995c5e 1859254` is empty for `game/vad.ts`, `game/runAudio.ts`, `game/sfx.ts`, `hooks/useRecorder.ts`, `hooks/useSpeech.ts`, `usePracticeSession.ts`, `components/PublicGate.tsx` and `api.ts`. Their A-owned tests were extended; their code was not. The one controller-side fix for an existing speech seam (`ff1f1f5`, repeat Hear it first) lives in `hooks/usePracticeRun.ts`.

### Auto-stop parameters (unchanged from v2)

From `frontend/src/game/vad.ts`:

| Parameter | Word | Sentence |
| --- | --- | --- |
| Minimum voiced time | 250 ms | 500 ms |
| Trailing silence to stop | 650 ms | 1000 ms |
| No-onset timeout | 4 s | 6 s |
| Auto-mode cap | 6 s | 14 s |
| Manual Stop shorter than this is "too-short" | 450 ms | 450 ms |

Floor −55 dBFS rising at most 1 dB/s; onset = floor + 10 dB clamped to −48…−28 with 3 of 5 frames; offset 6 dB below onset; immediate speech above −40 dBFS in the first 250 ms; noisy fallback when the first 8 frames spread over 12 dB, decided once; detection off for a gap over 250 ms. The known limits in `game-mode-v2-device-checklist.md` still apply unchanged: a pause of about 1 s or more can end a sentence early, steady noise runs to the auto cap, and the −32 dBFS floor fallback cannot trigger within a take.

## Preserved v2 regression matrix

Each row of the plan's matrix, with the A-owned tests that hold it. B-owned halves are listed for routing, not claimed here.

| Boundary | A-owned tests | B-owned part |
| --- | --- | --- |
| Accepted async Start | `usePracticeRun`: `start_abandoned_by_exit_does_not_take_over_practice`, `stale_start_failure_never_reports_into_a_newer_run`, `starting_tracks_the_accepted_start_until_its_deck_resolves_or_cannot_be_built`, `owner_unmount_drops_pending_start_scores_collection_and_urls`, `failed_stats_and_word_fetches_still_start_a_starter_route`, `restart_exit_or_owner_unmount_drops_late_success_error_finally`, `start_snapshots_config_before_await`, `words_stale_start_blob_and_retry_guards_hold` | Navigation while starting |
| Capture ownership | `usePracticeSession`: `cancelled_capture_settles_once_and_stops_its_late_stream`, `late_permission_cannot_take_over_a_newer_capture`, `late_permission_denial_after_cancel_settles_false_and_current_denial_reports`, `late_permission_and_cancelled_onstop_do_not_publish_preview`, `normal_to_run_and_run_to_normal_keep_capture_ownership`, `setup_failure_and_unmount_release_the_microphone`, `late_onstop_after_unmount_never_releases_another_hold`; `useRecorder`: `newer_start_supersedes_a_pending_permission`, `stale_permission_denial_resolves_false_and_current_denial_throws`; `usePracticeRun`: `take_cancelled_during_permission_settles_its_lock_once` | — |
| Stop/submit | `usePracticeSession`: `racing_stop_sources_deliver_one_frozen_summary`, `cancel_after_stop_before_onstop_discards_delivery`; `useRecorder`: `stop_latch_keeps_first_reason_duration_and_later_discard`; `usePracticeRun`: `one_stop_submits_once_despite_double_tap_or_autostop`, `manual_silence_cap_race_submits_once`, `manual_stop_without_onset_still_submits`, `quit_exit_play_again_drop_late_capture_and_cues`; `vad`: `manual_400ms_rejects_but_3000ms_without_onset_submits` | — |
| VAD | `vad`: `quiet_voice_from_t0_is_detected`, `early_onsets_inside_calibration_keep_auto_stop`, `rolling_floor_obeys_percentile_and_drift`, `noisy_spread_falls_back_and_steady_noise_has_bounded_cap`, `sample_gap_never_counts_as_silence`, `word_and_sentence_caps_terminate_once`, `short_onset_rejects_without_hanging`, `sentence_pause_1050ms_documents_energy_endpoint_limit`; `usePracticeSession`: `fallback_retains_manual_and_session_hard_cap`, `audio_unlock_failure_keeps_manual_flow` | — |
| LOCAL_REJECT/refund | `runModel`: `local_reject_keeps_main_budget_zero`, `rescue_local_reject_preserves_extra_and_first_low`, `duplicate_stale_and_submitted_local_reject_are_noops`, `rejected_refunds_exact_slot_once_and_keeps_current_item`, `refund_once_at_extra_slot_four`, `unknown_does_not_refund_or_retry`, `local_reject_preserves_main_and_rescue_budget`, `target85_quota_fourth_extra_refunds_once_and_terminal_stays_unpaused`; `usePracticeRun`: `local_reject_never_sends_or_allocates_review_url`, `status_only_rejection_refunds_unknown_continues_and_429_ends`, `cancel_take_does_not_skip_or_use_budget` | — |
| Pause/quit/exit | `runModel`: `pause_discards_capture_and_quit_marks_inflight_pending`, `quit_after_sixth_valid_result_is_incomplete`, `terminal_phases_are_never_paused`; `usePracticeRun`: `pause_allows_matching_submitted_result_without_new_capture`, `heart_cue_plays_in_the_foreground_but_not_for_a_result_settled_while_paused`, `terminal_pause_only_silences_audio`, `review_audio_matches_attempt_and_rejected_or_exited_audio_is_released`; `usePracticeSession`: `exit_run_does_not_restore_cancelled_audio_after_async_stop` | Quit dialog, hidden-page handling |
| Sentence collection | `usePracticeRun`: `sentence_score_precedes_collection_and_next_waits_until_settled`, `collection_marks_only_returned_rows_processed`, `word_attempt_never_posts_from_session`, `start_exit_token_and_sentence_collection_regressions_hold`; `runModel`: `sentence_sync_blocks_next_capture_until_settled`; `usePracticeSession`: `collection_failure_preserves_score_and_review_latch` | — |
| PB/events | `usePracticeRun`: `pb_receipt_survives_summary_remount_without_rewrite`, `pb_receipt_stays_frozen_across_tabs_expiry_and_surfaces` (unexpired concurrent record and a really expired public record), `new_stats_do_not_change_pb_bucket`, `next_sound_failure_keeps_old_results_and_receipt`, `feedback_ids_and_manual_stop_fallback_last_the_run`; `personalBest`: `stale_receipts_never_clobber_a_newer_or_higher_record`, `receipt_first_tie_new_and_public_expiry`; `sfx`: `cue_is_once_per_event_and_cancelled_on_exit` | Pending replay surfaces |
| Playback | `usePracticeSession`: `existing_preview_guards_suppress_late_audio_and_error`, `replayed_reference_late_play_rejection_cannot_mutate_record` / `_next-preview`, `pending_old_reference_settlement_after_skip_leaves_new_preview_alone_true` / `_false`; `useSpeech`: `reference_load_callback_precedes_request_guard_and_ignores_play_errors`, `does not start playback when stopped before synthesis finishes`; `usePracticeRun`: `preview_cancel_on_advance_skip_record_next_finish_pause_exit`, `hear_next_first_advances_once_then_previews_ready_item`, `hear_first_failure_does_not_block_record`, `rescue_record_requires_reference_ready_without_waiting_for_ended`; `sfx`: `mute_keeps_analysis_context_running`, `microphone_open_cancels_and_suppresses_all_cues` | You/Coach mutual cancel, hide stops both |
| Restart lifetime | `usePracticeRun`: `play_again_abandoned_by_exit_does_not_take_over_practice`, `restart_exit_or_owner_unmount_drops_late_success_error_finally`, `next_sound_failure_keeps_old_results_and_receipt` (retry targets the same sound) | `useReplay` failure/retry across Summary→Review |
| Ordinary practice | `usePracticeSession`: `ordinary_recording_still_requires_explicit_score`, `ordinary_explicit_score_is_unchanged`, `late_response_and_finally_cannot_modify_new_context`, `ordinary_score_visible_while_collection_pending`, `run_results_stay_outside_session_and_weak_prefetch_is_suppressed`, `rerecord_without_rescoring_still_counts_as_practiced` | Long Passage entry, Generate drill exit order |

### Words-source additions

| Check | Tests |
| --- | --- |
| Fresh-bank fetch failure or shortage keeps the old run | `usePracticeRun`: `words_fetch_or_shortage_preserves_old_run`; `wordDeck`: `words_exact_6_12_no_padding_or_autoshrink` |
| Due order, then lowest score, unscored last; dedupe; case | `wordDeck`: `words_due_order_then_low_score_null_last`, `words_single_key_dedupe_and_graduated_exclusion`, `words_preserve_display_and_reference_case` |
| First-valid seeds below 85, graduated excluded, absent-bank seeds allowed | `scoring`: `revisit_first_valid_below85_seed_order_and_target_rules`; `wordDeck`: `revisit_excludes_graduated_and_fills_after_absent_seeds`; `usePracticeRun`: `challenge_revisit_creates_route6_without_mutating_receipt`, `summary_cached_shortage_does_not_disable_revisit`, `summary_no_local_seeds_disables_revisit` |
| No PB, no Next sound, no fake stages | `usePracticeRun`: `rated_words_never_read_write_or_finalize_pb` (populated `route\|\|1` and starter keys; no `jt.runBest.v1` read or write at the Storage level, no finalize; mutation-checked), `words_play_again_refreshes_bank_and_next_sound_is_noop`; `personalBest`: `four_configs_have_isolated_buckets`; `runConfig`: `words_source_validation_has_no_fake_stages_or_focus` |
| SRS replay overlap | `usePracticeRun`: `words_play_again_can_repeat_srs_due_low_words_without_seeds` |
| Backend boundaries (fake services, no backend changes) | `test_public_word_bank.py`: `test_full_bank_known_word_still_updates_srs`, `test_full_bank_unknown_word_scores_without_insertion`, `test_positive_capacity_unknown_word_is_added`; `test_api.py`: `test_score_endpoint_skips_persisting_no_match_result`, `test_single_word_score_updates_word_bank_practice_score`, `test_single_word_practice_graduates_word_and_status_filter_separates_it`, `test_sentence_score_does_not_increment_word_practice`, `test_score_equal_to_graduation_score_is_not_an_srs_success` |
| Ordinary Start review unchanged | `components/WordBankPanel.tsx` and the session's review queue are untouched; My words only reads `getDueWordsForReview`. |

## Content gate

- Owner approval of all 60 r1 rows: `ceb6144` (Owner decisions table in `docs/materials/game-mode-v3-content-review.md`).
- Integration: `49db251`. The 30 existing entries of `starterPack.json` are byte-identical (insertions-only diff); all 60 table rows match ceb6144 except the reconciled status cell.
- Checks: `starterPack.test.ts` `approved_pack_has_60_unique_items_in_4_4_4_groups` and `runtime_pack_matches_approved_review_rows` (runtime pack against the approved table); `runDeck.test.ts` `all_config_decks_build_from_approved_runtime_pack` (5 sounds × 4 configurations, empty data and personal warm-ups); backend `test_starter_texts_match_frontend_and_share_cache_between_visitors` (60 texts, old and new cache hits) and `test_custom_text_remains_in_visitor_cache`.
- These are structural checks. The AI pronunciation judgments are not independent phonetic verification.

## Differences from the Day 1 contract

All were reported in their task's DONE block; the lead accepted them.

- **Words decks have their own builder.** `buildWordsDeck` in `game/wordDeck.ts` takes `{ config, vocabulary, dueWordIds, reviewSeeds }`; `buildRunDeck` keeps the starter-only input, and the controller chooses by `config.source`. The contract's single `RunDeckInput` union would have made `runDeck` and `wordDeck` import each other.
- `selectRevisitWordSeeds` is in `game/scoring.ts`, and `RevisitWordSeed` in `types.ts`, rather than in `runDeck.ts`.
- `snapshotDueWordIds` (reads the clock) sits beside the pure builder, which never reads it.
- `start(config)` accepts a words configuration too; `startWords` is the intended entry.
- The manual `CANNOT_CONFIRM` action and `cannotConfirm()` were removed (`8fd8366`); declining a rescue is Skip.
- `buildRunDeck` throws "The starter pack cannot fill this run." rather than returning a short deck.
- `nextSoundPhoneme` is non-null only when `nextSound()` would be accepted.
- `MAX_EXTRA_ATTEMPTS` is removed (`1859254`) after impl-ui's last import went in B4.

## Device and browser checks

Not verified. Fake-service and jsdom tests do not show browser audio policy, real microphone behavior, layout or assistive-technology output. For Track B's unified checklist, the core-relevant rows are:

| Check | Status |
| --- | --- |
| Hear it first cached/cold/failed/deferred TTS; Record, Skip, Pause, Quit, Done during load or play; no late audio into an open microphone; repeat Hear it first then Record | Not verified |
| Existing auto-stop and manual Stop behavior with the unchanged parameters above | Not verified |
| Capture lifetime and microphone indicator after each take and exit | Not verified |
| Target 85 rescue, heart loss and cannot-confirm causes in owner runs | Not verified |
| Next sound across all five sounds, including v→θ | Not verified |
| Legacy PB upgrade, four isolated buckets, public expiry, Delete my data keys | Not verified |
| My words 6/12 order, counts 5/6/11/12, no graduated filler, no PB; revisit from a Summary | Not verified |
| Full-bank known vs unknown words and score quota vs word capacity on the public trial | Not verified (fake-service evidence only) |

## Pending until B7

- Run `src/mobile/screens/WordsScreen.test.tsx` and the post-A5 `route12_production_pack_completes_summary_review_and_replay` once they exist, then rerun `bash scripts/test.sh` at the final revision.
- Record the final revision and results here, and mark this record complete.
