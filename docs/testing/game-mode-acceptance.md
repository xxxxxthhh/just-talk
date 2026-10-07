# Game Mode Acceptance

Results for the mobile Route and Challenge MVP ([design](../design/game-mode.md), [plan](../development/game-mode-implementation-plan.md)). Each line records what was actually run. Anything not run is marked **not verified**. Passing mocked tests is not proof that the flow works on a device or that latency is acceptable.

## Automated checks

Run from the repository root with fake scorer and synthesizer services. These commands make no Azure calls.

| Command | Result | Date / commit |
| --- | --- | --- |
| `npm --prefix frontend test -- src/game src/hooks/usePracticeRun.test.tsx src/hooks/useRecorder.test.tsx src/usePracticeSession.test.tsx src/hooks/useSpeech.test.tsx src/components/PracticeRun.test.tsx src/components/RunReview.test.tsx src/mobile/MobileApp.test.tsx src/api.test.ts` | 10 files, 98 tests passed | 2026-10-07 / `4127096` |
| `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests/test_game_starter_cache.py` | 2 passed | 2026-10-07 / `4127096` |
| `bash scripts/test.sh` (ruff, backend tests, frontend lint/tests, production build) | Exit 0. Ruff clean; 115 backend tests passed; lint 0 errors (7 warnings in files this work did not touch); 20 files, 188 frontend tests passed; build succeeded | 2026-10-07 / `4127096` |

The mobile acceptance tests in `frontend/src/mobile/MobileApp.test.tsx` drive a whole run through `MobileApp`. They use a fake `MediaRecorder` whose `onstop` fires asynchronously, as in real browsers, and a stubbed `fetch`:

- `run_result_never_opens_normal_sheet_but_history_still_does`
- `tab_pause_resume_preserves_run_without_auto_recording`
- `other_practice_entries_confirm_before_mutating_session`
- `starting_from_long_uses_short_limit_and_clears_old_score`
- `route_and_challenge_complete_and_replay_with_budget_and_pending_rules`

The existing automatic and manual score-sheet tests remain in the same file and pass.

## Real iPhone Safari checklist

Not run: no iPhone was available to this implementation session. Every row below remains an explicit verification gap. It does not block sharing an internal playable build.

| Check | Result | Notes |
| --- | --- | --- |
| MP4 capture produces a scored attempt | Not verified | |
| Microphone permission denied shows an error and starts no attempt | Not verified | |
| Manual stop submits exactly once | Not verified | |
| Stopping at the recording limit submits exactly once | Not verified | |
| Backgrounding the browser while recording discards the capture without uploading | Not verified | |
| Rescue Record unlocks only after reference audio has loaded | Not verified | |
| Review replays each attempt's own recording beside its score | Not verified | |
| Exiting the run shuts the microphone off (indicator clears) | Not verified | |

## Stop-to-verdict timings (device)

Not measured: requires the device run above. Record each sample's duration and outcome, then nearest-rank p50/p95.

## Sentence trials: Insertion frequency

Not measured: requires real sentence attempts on a device.

## Known gaps

- Every real-device check above is unverified, including iOS `onstop` timing, permission handling, and background discard on Safari.
- Stop-to-verdict latency on mobile is not measured.
- How often Insertion makes a sentence unscorable is unknown.
- Mocked tests do not prove real audio playback, vibration, or Azure scoring behavior.
