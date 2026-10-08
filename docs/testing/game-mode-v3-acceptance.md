# Game Mode v3 Acceptance (Track B)

Layout, accessibility and UI evidence for Game Mode v3 ([design](../design/game-mode-v3.md), [owner decisions](../design/game-mode-v3-decisions.md), [plan](../development/game-mode-v3-implementation-plan.md), Task B6). Track A's core record is [game-mode-v3-core-checks.md](game-mode-v3-core-checks.md); the owner's device pilot goes in [game-mode-v3-device-checklist.md](game-mode-v3-device-checklist.md). This document does not repeat either.

Each line records what was actually run. Anything not run is marked **Not verified**. Passing jsdom tests and headless renders are not proof of layout on a real device, browser audio policy, assistive-technology output or latency.

**Status:** Automated checks and headless layout evidence are recorded. The owner pilot has not started, so every device row is **Not verified**.

## Automated checks

Run from the repository root at `6a84702` (`feat/game-mode-v3`) with a clean working tree (`git status --short` empty). Tests use mocks and fake services; nothing calls Azure, TTS or an LLM. `--run` was added to the plan's Vitest commands so they exit instead of watching.

| Command | Exit | Result |
| --- | --- | --- |
| `git diff --check` | 0 | Clean |
| `npm --prefix frontend test -- --run src/game` | 0 | 11 files, 110 passed |
| `npm --prefix frontend test -- --run src/hooks/usePracticeRun.test.tsx src/hooks/useRecorder.test.tsx src/hooks/useSpeech.test.tsx src/usePracticeSession.test.tsx` | 0 | 4 files, 108 passed |
| `npm --prefix frontend test -- --run src/components/RunHero.test.tsx src/components/RunStones.test.tsx src/components/RunRing.test.tsx src/components/PracticeRun.test.tsx src/components/RunReview.test.tsx src/components/RunMiniPlayer.test.tsx src/components/useReplay.test.tsx src/components/PublicGate.test.tsx src/mobile/MobileApp.test.tsx` | 0 | 9 files, 129 passed |
| `npm --prefix frontend test -- --run src/mobile/screens/WordsScreen.test.tsx` | 0 | 1 file, 2 passed |
| `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_game_starter_cache.py backend/tests/test_api.py backend/tests/test_public_word_bank.py` | 0 | 33 passed |
| `bash scripts/test.sh` | 0 | Ruff clean; 120 backend tests passed; lint 0 errors (7 existing `react-hooks/exhaustive-deps` warnings, none in v3 code); 37 files, 455 frontend tests passed; production build succeeded |
| `bash scripts/test.sh` (re-run at `3cfd9fa`, after the review fixes) | 0 | Ruff clean; 120 backend tests passed; lint 0 errors (same 7 warnings); 37 files, 464 frontend tests passed; production build succeeded |

Vite also prints its existing notice that `vite.config.ts` uses ESM syntax in a file loaded as CommonJS; the build succeeds.

## Requirements and the tests that hold them (Track B)

Test names are the acceptance names from the plan where one exists. Where an existing test already covered a named requirement, the existing name is listed.

| Requirement | Tests |
| --- | --- |
| Entry: three choices, Route-only 6/12, keyboard radios, shared remembered choice, bucket preview, costs 8/16/8/10, starting/busy guards (B1) | `RunHero.test.tsx`: `entry_exposes_three_modes_and_route_lengths`, `entry_radios_follow_standard_keyboard_behaviour`, `entry_starting_and_ordinary_busy_guards_hold`, `entry_states_the_given_cost_once`, `entry_best_uses_selected_legacy_or_new_bucket`; `MobileApp.test.tsx`: `entry_uses_shared_choice_without_mutating_active_config`, `entry_costs_are_8_16_8_10` |
| Stones 2+2+2 / 4+4+4 / My words, heart-loss mark, saved-only outline, labels (B2) | `RunStones.test.tsx`: `stones_render_labelled_2_2_2_and_4_4_4`, `heart_lost_mark_preserves_first_good_fill`, `only_saved_has_rescue_outline`, `stone_labels_keep_raw_boundary_and_outcome`, `stones_have_static_reduced_motion`; `PracticeRun.test.tsx`: `words_header_stones_have_no_ipa_or_fake_stages` |
| Route Hear it first, variant B, Challenge controls, Target 85 tier vs target, cannot-confirm causes, one announcement (B3) | `PracticeRun.test.tsx`: `route_hear_first_does_not_block_record`, `route_record_next_and_hear_next_first_are_distinct`, `challenge_controls_unchanged`, `target85_good_tier_and_rescue_status_are_separate`, `target85_relisten_verdict_never_labels_80_relisten` (also in `RunReview.test.tsx`), `target85_both_good_readings_can_lose_one_heart`, `mixed_tier_readings_keep_their_own_colour`, `cannot_confirm_distinguishes_rescue_unjudged_and_reference_failure`, `single_announcement_uses_final_target_tier_and_points`, `v2_local_reject_stop_guard_and_live_controls_hold` |
| Route-first Summary, 972 A, N-aware cell timing, costs from maxScores, restart errors (B4) | `PracticeRun.test.tsx`: `route_summary_prioritizes_practised_and_next_step`, `n12_972_without_full_combo_shows_a`, `summary_badge_start_follows_last_cell_start_with_v2_fades`, `summary_uses_max_scores_without_legacy_constant`, `summary_buttons_live_at_frame_zero_and_reduced_motion_final`, `challenge_summary_leads_with_outcome_target_and_hearts`, `next_sound_failure_names_its_sound_and_retries_it`; `useReplay.test.tsx`: `next_sound_retry_repeats_destination`, `restart_failure_survives_summary_to_review`, `abandoned_or_older_restart_cannot_set_error`; `RunReview.test.tsx`: `review_twelve_items_share_one_player_and_correct_takes`, `review_retries_an_inherited_next_sound_failure` |
| Live controller binding, all four starter flows (B5) | `MobileApp.test.tsx`: `three_six_item_configs_complete_with_production_pack`, `route12_production_pack_completes_summary_review_and_replay`, `route_hear_first_and_hear_next_first_use_the_controller`, `next_sound_starts_the_next_focus_and_owns_navigation_while_pending`, `next_sound_failure_survives_review_and_retry_keeps_destination`, `deferred_next_sound_then_done_never_reopens_run`, `production_has_no_interim_fixture_wiring` |
| B5 names covered by existing tests | `run_starting_owns_navigation_for_entry_and_restarts` → `deferred_start_hides_tabs_until_the_run_appears`, `next_sound_starts_the_next_focus_and_owns_navigation_while_pending`; `quit_retains_review_done_exits` → `quit_confirmation_calls_quit_not_exit`, `quit_with_a_recording_then_review_plays_it`, `cancel_quit_keeps_paused_run_and_results`; `hidden_active_vs_terminal_behavior_is_preserved` → `immersive_run_hides_tabs_and_pause_resume_is_explicit`, `completed_review_survives_hidden_and_visible_without_replaying`; `deferred_restart_then_done_never_reopens_run` → `done_during_replay_abandons_it`, `deferred_next_sound_then_done_never_reopens_run`; `summary_review_transition_retains_restart_failure` → `replay_failure_survives_summary_to_review_while_pending`, `next_sound_failure_survives_review_and_retry_keeps_destination`; `run_result_never_opens_ordinary_sheet` → `run_result_never_opens_normal_sheet_but_history_still_does`; `ordinary_explicit_score_and_drill_progress_still_work` → the existing ordinary-practice and drill tests in `MobileApp.test.tsx` |
| My words entry, header/stones, no-PB Summary, revisit action, errors (B7) | `WordsScreen.test.tsx`: `words_entry_uses_session_guards_without_leave_confirmation`, `words_busy_and_starting_guards_hold`, `words_length_radios_follow_arrow_keys_with_one_tab_stop`, `words_length_arrow_keys_skip_an_unavailable_length`, `words_length_arrow_keys_do_nothing_while_starting`; `MobileApp.test.tsx`: `words_entry_counts_5_6_11_12_and_never_silently_shrinks`, `words_entry_pending_cancel_and_late_failure_say_nothing`, `words_entry_pending_error_survives_navigation`, `start_review_still_uses_ordinary_explicit_score`, `each_summary_revisit_preserves_original_until_start_succeeds`, `revisit_failure_survives_review_and_retry_keeps_action`, `words_done_drops_late_entry_or_revisit_error`; `PracticeRun.test.tsx`: `words_summary_shows_rating_without_pb_or_next_sound`, `summary_no_local_seeds_disables_revisit`, `summary_cached_shortage_does_not_disable_revisit`, `revisit_failure_names_its_reason_and_retries_it`, `full_bank_copy_never_promises_unknown_word_saved`; `useReplay.test.tsx`: `revisit_failure_keeps_its_reason_and_retry_keeps_action` |

| Review fixes after B6 | B4-S1: `summary_done_tap_area_is_at_least_44px`; B5-S1: `summary_restart_gesture_stops_the_coach_first` (Play again, Next sound), `summary_try_again_stops_the_coach_first`, `summary_restart_drops_a_coach_still_loading`; B7-S1: `words_play_again_failure_names_the_shortage_6`, `_12`; B7-S2: `old_words_entry_error_does_not_survive_a_newer_run`; jump stones: `review_jump_stones_are_44px_six_per_row` |

**Not added:** `route12_mocked_60_item_pack_completes_summary_review_and_replay`. A5 integrated the approved pack before B5, so Route 12 runs on the production pack in `route12_production_pack_completes_summary_review_and_replay`. The other `MobileApp` tests that follow fixed words mock the pack down to v2's two items per stage, because six-item decks are seeded by a time-based run ID.

### Cross-track seam review

The seams the plan names, with the tests on each side. Track A's halves are listed in full in the core record.

| Seam | Track A | Track B |
| --- | --- | --- |
| Stale starts (entry, Play again, Next sound, My words, revisit) | `start_abandoned_by_exit_does_not_take_over_practice`, `stale_start_failure_never_reports_into_a_newer_run`, `restart_exit_or_owner_unmount_drops_late_success_error_finally`, `words_stale_start_blob_and_retry_guards_hold` | `deferred_start_hides_tabs_until_the_run_appears`, `failed_start_brings_tabs_back_with_an_error`, `a start abandoned by a remount never takes over the new app`, `done_during_replay_abandons_it`, `deferred_next_sound_then_done_never_reopens_run`, `words_entry_pending_cancel_and_late_failure_say_nothing`, `words_done_drops_late_entry_or_revisit_error`, `abandoned_or_older_restart_cannot_set_error` |
| Late audio (reference, cues) | `preview_cancel_on_advance_skip_record_next_finish_pause_exit`, `hear_next_first_advances_once_then_previews_ready_item`, `existing_preview_guards_suppress_late_audio_and_error`, `quit_exit_play_again_drop_late_capture_and_cues` | `route_hear_first_and_hear_next_first_use_the_controller`, `summary_restart_gesture_stops_the_coach_first`, `summary_try_again_stops_the_coach_first`, `summary_restart_drops_a_coach_still_loading`, `one_you_or_coach_source_plays_at_a_time`, `late_coach_load_cannot_interrupt_you`, `changing take stops a loading or playing Coach`, `completed_review_survives_hidden_and_visible_without_replaying` |
| Receipt lifetime | `pb_receipt_survives_summary_remount_without_rewrite`, `pb_receipt_stays_frozen_across_tabs_expiry_and_surfaces`, `next_sound_failure_keeps_old_results_and_receipt`, `rated_words_never_read_write_or_finalize_pb` | `summary_buttons_live_at_frame_zero_and_reduced_motion_final`, `words_summary_shows_rating_without_pb_or_next_sound`, `each_summary_revisit_preserves_original_until_start_succeeds` |
| Restart-error ownership | `next_sound_failure_keeps_old_results_and_receipt`, `words_fetch_or_shortage_preserves_old_run` | One `useReplay` owner in `PracticeScreen` above Summary and Review: `restart_failure_survives_summary_to_review`, `replay_failure_survives_summary_to_review_while_pending`, `next_sound_failure_survives_review_and_retry_keeps_destination`, `revisit_failure_survives_review_and_retry_keeps_action`; Words-entry errors live in `MobileApp`: `words_entry_pending_error_survives_navigation` |

No open cross-track defect is known. A7-S1 (boundary punctuation at START) was fixed by Track A in `7cc465a`.

## Layout evidence

### Method

- **Harness, not the live app.** Each state is rendered by the real `RunHero`, `PracticeRun`, `RunReview` and `MobileApp` components with the committed `styles.css`, `mobile.css` and `game.css`, inside the real mobile shell. Run states come from the real reducer and selectors through `frontend/src/components/runV3Fixtures.ts`. The Words-page states render the whole `MobileApp` with a mocked API (5, 6, 11 or 12 bank words; a held fetch for pending; a fresh fetch of three words for the error). Reduced motion is on, so every frame is final. There is no backend, recorder or live telemetry.
- **Revision.** Re-captured after the review fixes. The component, mobile and CSS files are those of `3cfd9fa`: the first capture was at `6a84702`, and this one adds the jump-stone layout and the B5/B7 fixes. The baseline entry card is rendered the same way from `7995c5e`, the v2 revision before v3 began.
- **Exact viewports.** Headless Chrome (new headless mode) enforces a 500 px minimum window width, so each state was loaded in an iframe of exactly the target size, and each page measured itself.
  - **390×844:** the target phone.
  - **390×667:** a short screen.
  - **320×568:** a narrow screen.
  - **130% proxy:** a 300×649 CSS viewport scaled 1.3×, as 130% page zoom gives on a 390×844 phone. Real Dynamic Type or browser text-size is **not verified**.
- **Checks in each page.**
  - Page-level horizontal overflow, and any element that can scroll sideways.
  - Every fixed-zone button (thumb zone, Summary and Review footers, entry card, Words entry card, run bar) lies inside the viewport.
  - Effective tap size: every button or radio under 44 px is probed with `elementFromPoint` 21.5 px either side of its centre on each short axis. This counts invisible hit-area extensions and catches overlaps.
  - Every interactive element has an accessible name (text, `aria-label` or `title`).
  - The run bar title is not truncated.
  - How far the middle area scrolls, the entry card height and the ring size.
- Raw per-state results: [layout-measurements.tsv](game-mode-v3-evidence/layout-measurements.tsv). A `-` means none, or not applicable to that state.

### States covered (35)

| | |
| --- | --- |
| Entry | v2 baseline card; Route 6, Route 12, Target 60, Target 85; Starting…; start error |
| Run | Route 12 Ready (Hear it first), Route 12 feedback (variant B), last-item feedback (Finish); Target 85 rescue at 80, heart lost 80 → 82, saved 80 → 88, mixed 80 → 50, 84.9 → 85; cannot-confirm rescue budget, unjudged budget, reference unavailable; My words 6 and 12 Ready |
| Summary | Route 12 (Practised 12/12, revisit, Next sound), Route 12 partial (6/12, not rated), 972 A, Next sound error; Target 85 cleared (876 A, one heart used); My words 6; My words revisit error |
| Review | Route 12 (twelve readings), Target 85 |
| Words page | 5, 6, 11 and 12 eligible words; pending start; fresh-bank shortage error |

### Results

All 35 states × 4 viewports = 140 renders.

| Check | 390×844 | 390×667 | 320×568 | 130% |
| --- | --- | --- | --- | --- |
| Horizontal overflow / sideways scroll | None | None | None | None |
| Fixed-zone buttons on screen | 35 / 35 | 35 / 35 | 35 / 35 | 35 / 35 |
| Controls without an accessible name | 0 | 0 | 0 | 0 |
| Run bar title truncated | 0 | 0 | 0 | 0 |
| Effective tap area under 44 px | None | None | None | None |
| Ring diameter | 200 px | 173 px | 148 px | 169 px |

**Middle area scrolling.** Content scrolls behind fixed controls in these places:

- **At 390×844:** both Reviews (the jump stones' own row adds 44 or 88 px to the Review header), the Target 85 Summary (50 px) and the Words page.
- **At 390×667:** most Summaries scroll 19–184 px, with the Route 12 Summary at 117 px. The Target 85 rescue scrolls 83 px and the Route 12 feedback 33 px.
- **At 320×568 and 130%:** most run screens scroll too. The largest is the Target 85 Summary, at 316 px at 320 wide.

In every case the fixed controls stay on screen and reachable. Per-state values are in the TSV.

**Entry card height.** Same viewport and the same settings (public usage line shown, non-public cost line):

| Card | 390×844 | 390×667 | 320×568 | 130% |
| --- | --- | --- | --- | --- |
| v2 baseline (`7995c5e`, Route selected) | 497 | 497 | 529 | 529 |
| v3 Route 6 | 489 | 489 | 489 | 512 |
| v3 Route 12 | 482 | 482 | 482 | 505 |
| v3 Target 60 | 482 | 482 | 482 | 512 |
| v3 Target 85 | 489 | 489 | 489 | 503 |
| v3 Starting… | 482 | 482 | 482 | 505 |
| v3 start error (adds the error line) | 518 | 518 | 532 | 540 |

The v3 card is shorter than the baseline in every steady state. The start-error state adds one alert line; v2 had the same line, which the baseline row does not include.

Contact sheets (reduced motion, final frames, numbered in the order above):

- [390×844](game-mode-v3-evidence/v3-states-844.jpg)
- [390×667](game-mode-v3-evidence/v3-states-667.jpg)
- [320×568](game-mode-v3-evidence/v3-states-320.jpg)
- [130% proxy](game-mode-v3-evidence/v3-states-zoom130.jpg)

**Defects this evidence found, fixed before the final capture:**

- At 320 px wide and at 130%, the run bar truncated "Challenge · Target 85 · /θ/" to "Challenge · …" on every Target 85 screen (18 renders). The title now wraps to two centred lines inside the 48 px bar.
- Compact controls were under 44 px, including on the entry card, where the spec requires 44 px:
  - the Auto-stop and Sound toggles (32 px tall);
  - the text buttons Skip, Hear next first, Hear it again, Skip rescue and Done (32–36 px).

  Each now takes taps across at least 44 px through an invisible extension, so the entry card keeps its height. The Summary's Done also gained a 44 px minimum width. Both fixes are in `6a84702`; `5a9aadd` pins the Done contract in a test (astra B4-S1).
- Review's jump stones were 20×44 px, below the plan's 44 px requirement for review navigation (the same size shipped in v2). Following the lead's ruling, `3cfd9fa` gives them their own row under the headline: six 44×44 stones per row, so twelve items wrap 6+6 and six items keep one row. This also removes the cramped Review headline seen at 130%.

### Open issues

None from the layout evidence.

### Observations (not failures)

- Summaries scroll on short screens. The fixed footer (Route: See review | Play again, Next sound, cost and Done; about 156 px) stays on screen, and the revisit action lives in the scrolling area as the plan requires.
- At 130% the Target 85 Summary kicker wraps to two lines.
- The Words page's word list is the existing `WordBankPanel`; its trash buttons are named by `title`, not `aria-label`.

## Accessibility checks

Automated (jsdom). These are not VoiceOver or real-keyboard checks.

- **Radios and names:**
  - Practice entry card: the radio groups are named "Route", "Challenge, target 60", "Challenge, target 85" and "6 items", "12 items". Arrow keys move the checked option, wrapping, with one tab stop per group (`entry_radios_follow_standard_keyboard_behaviour`).
  - Words page: the "Words run length" group ("6 words", "12 words") has one tab stop on the checked length and arrow keys that move and wrap (`words_length_radios_follow_arrow_keys_with_one_tab_stop`). Arrow keys skip a length that is unavailable (`words_length_arrow_keys_skip_an_unavailable_length`) and change nothing while a start is pending (`words_length_arrow_keys_do_nothing_while_starting`). Both groups share one helper, `components/radioKeys.ts`. These are jsdom keyboard events, not a real keyboard or screen reader.
  - Stage groups and stones are named; heart-lost stones add "one heart used", and cannot-confirm items read "not confirmed" (`RunStones.test.tsx`).
- **One live region:** it announces each accepted change once, using the final tier, target and first-reading points. It does not repeat on rerender and is silent after a remount (`single_announcement_uses_final_target_tier_and_points`, `aria_announces_final_state_once_and_keeps_focus`). An 80 under Target 85 is never announced or labelled as Re-listen (`target85_relisten_verdict_never_labels_80_relisten`).
- **Quit dialog:** it contains focus, closes on Escape and returns focus to the paused screen (`the quit dialog contains focus and leaves the run behind it unreachable`, `the quit dialog closes on Escape and keeps the run`).
- **Reduced motion:** final facts render from the first frame (`summary_buttons_live_at_frame_zero_and_reduced_motion_final`, `stones_have_static_reduced_motion`, `ring_motion_has_static_reduced_variants`).
- **Pending Words start:** the word bank is marked `inert`, so Start review and individual practice can't be reached (`words_busy_and_starting_guards_hold`).

## Decisions recorded here

- **No "word bank is full" warning (lead ruling).** The design asks for "Your word bank is full. New words may not be saved; scores still count." when relevant. The API exposes no word-bank capacity to the frontend, so the warning would need backend data, which is outside this cut. Instead, no My words UI claims that a word was added or saved (`full_bank_copy_never_promises_unknown_word_saved`). The fake-service backend tests in the core record pin the known-versus-unknown behavior.
- **Copy proposed by Track B and accepted in review:**
  - "Couldn't load it · Record works any time" (Ready, failed reference).
  - "Couldn't load the reference · not confirmed. No heart lost." (rescue, failed reference).
  - "Couldn't start /ð/. Your results are still here." with Try again.
  - "Couldn't start the revisit run. <reason> Your results are still here." with Try again.
  - "N active words", "1 word first, then your word bank · 6 words" and "Start 6 words" / "Start 12 words".
- **Owner notices still owed by the lead before merge** (design, Personal best compatibility):
  - The 60-item pack changes which content subsets appear in the retained Route 6 and Target 60 buckets.
  - Scored starter warm-up and focus words already enter the word bank, so they can appear in My words.

## Not verified

These remain gaps. None is implied by the evidence above.

- **Real devices and the live app:** every row of the [device checklist](game-mode-v3-device-checklist.md), on iOS Safari and desktop Chrome with the real backend, recorder, live telemetry, TTS and cues.
- **Real large text:** iOS Dynamic Type and browser text-size settings. Run typography is set in `px`, so it may not follow text-size settings; 130% page zoom is a proxy.
- **VoiceOver and a real keyboard:** names, the single announcement, target vs tier wording, the heart mark, radio keys and Quit focus return.
- **Normal-motion visuals:** score roll, ring pop, cell and badge fades (start-after-start timing is unit-tested from CSS values only), heart crack and the out-of-hearts overlay.
- **Safari SVG paint:** the striped and gold-gradient stone fills, and the new heart-loss crack, render in Chrome only so far.
- **Safe-area insets and landscape.**
- **The full-bank warning** (not implemented; see decisions).
