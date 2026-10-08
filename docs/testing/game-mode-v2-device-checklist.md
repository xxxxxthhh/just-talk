# Game Mode v2 Device Checklist

The owner's real-device pilot for Game Mode v2 ([design](../design/game-mode-v2.md), [plan](../development/game-mode-v2-implementation-plan.md), Real-Device Checklist). Every row starts as **Not verified**. A row changes only after the check has been run on that device. Mocked tests and the passing automated suite are not device evidence. The v2 acceptance record (`game-mode-v2-acceptance.md`, Track B) owns the final evidence and can link here.

Scoring calls are manual and intentional, within the available trial quota. Prefer local recordings for endpoint experiments. Never retry an unknown submission automatically.

## Automated baseline (Track A, before the pilot)

Run from the repository root at `7f57940` with a clean tree. These commands use mocks and fake services and make no Azure calls.

| Command | Result |
| --- | --- |
| `git diff --check` | Exit 0 |
| `npm --prefix frontend test -- --run src/game src/hooks/useRecorder.test.tsx src/usePracticeSession.test.tsx src/hooks/usePracticeRun.test.tsx src/hooks/useSpeech.test.tsx` | Exit 0; 12 files, 138 tests passed |
| `npm --prefix frontend test -- --run src/components/RunRing.test.tsx src/components/RunStones.test.tsx src/components/PracticeRun.test.tsx src/components/RunReview.test.tsx src/components/RunMiniPlayer.test.tsx src/components/PublicGate.test.tsx src/mobile/MobileApp.test.tsx` | Exit 0; 7 files, 50 tests passed |
| `bash scripts/test.sh` | Exit 0. Ruff clean; 115 backend tests passed; lint 0 errors (7 warnings in files v2 did not touch); 30 files, 293 frontend tests passed; build succeeded |

`--run` was added to the plan's two test commands so Vitest exits instead of watching.

## Session record

Fill in one row per pilot session. Every result row below refers to a session here.

| Session | Date | Browser / OS | Viewport | Input device | Sound | Auto-stop | Build commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | 2026-10-08 | iOS Safari (via Tailscale Serve HTTPS) | | | | | 6caab28 |
| S2 | 2026-10-08 | Desktop Chrome | | | | | 6caab28 |

**Owner pilot result (S1, S2):** the owner played full runs end to end on both devices and reported no problems. That report covers the flow as a whole. The rows below were not checked individually, so they stay **Not verified** until a specific check is run.

## Auto-stop parameters in this build

From `frontend/src/game/vad.ts`. If the pilot uses different values, record them here.

| Parameter | Word | Sentence |
| --- | --- | --- |
| Minimum voiced time | 250 ms | 500 ms |
| Trailing silence to stop | 650 ms | 1000 ms |
| No-onset timeout (local reject "no-speech") | 4 s | 6 s |
| Auto-mode cap | 6 s | 14 s |
| Session hard cap (manual and fallback) | 30 s | 30 s |
| Manual Stop shorter than this is rejected "too-short" | 450 ms | 450 ms |

These apply to both kinds:

- **Noise floor:** starts at −55 dBFS. It is the rolling nearest-rank 10th percentile of the take, rising at most 1 dB/s.
- **Onset:** the threshold is the floor plus 10 dB, clamped to −48…−28. Three of the last five frames must be above it.
- **Offset:** 6 dB below the onset threshold.
- **Immediate speech:** if every frame in the first 250 ms is above −40, the floor stays at −55 for that opening.
- **Noisy fallback:** the spread (P90 − P10) of the first 8 frames exceeds 12 dB. It is decided once, after the opening, and only when no onset was seen.
- **Detection off for the take:** a sampling gap over 250 ms, a context that isn't running, or a hidden page.

## Results

Status values: **Pass**, **Fail**, **Not verified**. For every auto-stop row, record the stop reason you observed (silence, no-speech, short-voice, auto-cap, hard-cap, manual) and where the evidence is (recording file, screen capture, notes).

### Immediate and quiet voice

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| Speaking from the first moment (no pause after Record) is detected and auto-stops; the opening is audible in the replay | Not verified | Not verified | | |
| A quiet voice (real-world analogue of −36 dBFS) is detected, not rejected | Not verified | Not verified | | |
| Starting to speak at about 75–200 ms keeps auto-stop on (no "Noisy · tap Stop") | Not verified | Not verified | | |
| Manual Stop always works as a fallback and submits | Not verified | Not verified | | |

### Endpoint quality

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| Short words stop cleanly without cutting the word | Not verified | Not verified | | |
| Final /θ/ and /s/ survive in the replayed end | Not verified | Not verified | | |
| Quiet word tails are not cut | Not verified | Not verified | | |
| Slow sentences are not cut early | Not verified | Not verified | | |
| A ~1.05 s mid-sentence pause: record whether it stops early (an expected limit of energy endpointing) | Not verified | Not verified | | |

### Noise and caps

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| Fan or TV in the background: record fallback or the single bounded submission | Not verified | Not verified | | |
| Transient noise (a clap or a knock) before speaking | Not verified | Not verified | | |
| No speech: "Didn't catch anything" after 4 s (word) or 6 s (sentence), with no score call | Not verified | Not verified | | |
| A very short onset gives "Too short" with no score call | Not verified | Not verified | | |
| Prolonged speech ends at the 6/14 s auto cap and submits once | Not verified | Not verified | | |
| With auto-stop off or noisy, the take runs until manual Stop or the 30 s hard cap | Not verified | Not verified | | |

### Manual control

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| Stop at about 0.4 s gives "Too short · try once more", with no score call | Not verified | Not verified | | |
| Stop at about 3 s with no detected onset still submits | Not verified | Not verified | | |
| The bottom Stop responds immediately while the ring's 400 ms guard is active | Not verified | Not verified | | |
| Cancel take uses no score call and does not skip the item | Not verified | Not verified | | |
| "Use manual Stop" makes the next take manual and keeps it manual | Not verified | Not verified | | |

### Ownership and races

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| Permission denied shows an error and starts no attempt | Not verified | Not verified | | |
| A delayed permission prompt does not shorten the take (the clock starts at recording) | Not verified | Not verified | | |
| Stop then Pause: no late take reaches the run | Not verified | Not verified | | |
| Lock or background while recording discards the take; Resume does not record by itself | Not verified | Not verified | | |
| Quit confirmation while recording: the take is discarded and the run's results are kept | Not verified | Not verified | | |
| Rapid Play again: no late take reaches the new run or the ordinary preview | Not verified | Not verified | | |
| The microphone indicator turns off after each take and after exit | Not verified | Not verified | | |

### Audio

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| Cues play by default (good, great, perfect, heart, clear, rescue saved) | Not verified | Not verified | | |
| Mute on the entry card and in the run persists across reloads | Not verified | Not verified | | |
| iOS silent switch: record whether cues play | Not verified | n/a | | |
| A suspended audio context degrades to manual recording with no error | Not verified | Not verified | | |
| Rescue: Coach audio, then Record again, works in order | Not verified | Not verified | | |
| You ↔ Coach: only one plays at a time, including when Coach audio loads late | Not verified | Not verified | | |
| No UI sound is heard while the microphone is open | Not verified | Not verified | | |
| Mute leaves auto-stop working | Not verified | Not verified | | |

### UI and accessibility

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| Every run screen at 390×844 | Not verified | Not verified | | |
| A shorter viewport, with browser chrome visible | Not verified | Not verified | | |
| A long prompt and large text: the middle scrolls and the thumb zone stays usable | Not verified | Not verified | | |
| VoiceOver announces each state once; focus stays on buttons | Not verified | Not verified | | |
| Reduced motion uses the static variants | Not verified | Not verified | | |
| Buttons stay visible and live during the verdict, heart-crack and summary animations | Not verified | Not verified | | |

### Gameplay and data

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| A Route with a gap ends on "Not rated" | Not verified | Not verified | | |
| A cleared Challenge rated C reads "Logged" | Not verified | Not verified | | |
| Rescue, heart exhaustion and the quota end behave as in v1 | Not verified | Not verified | | |
| Personal best: first record, new best and a tie | Not verified | Not verified | | |
| The best survives a summary/review remount without changing | Not verified | Not verified | | |
| Delete my data clears the best and both preferences | Not verified | Not verified | | |
| Review: each take's audio matches its score | Not verified | Not verified | | |
| Generate a drill keeps its progress and errors on Practice | Not verified | Not verified | | |
| Ordinary explicit Score still works as before | Not verified | Not verified | | |

## Known limits to watch

- Energy endpointing cannot tell a thinking pause from the end of a sentence. A pause of about 1 s or longer can stop a sentence early. That is expected and should be recorded, not fixed in the pilot.
- Steady noise above the onset threshold, such as a TV or fan, reads as voice. The take runs to the auto cap and submits once. The −32 dBFS floor fallback cannot trigger within a 6/14 s take, because the floor rises at most 1 dB/s.
- The noisy fallback uses the min/max spread of the first eight frames. Unsteady noise before speech can turn auto-stop off for that take. The take is never rejected because of it.
- The elapsed display and the 30 s hard cap use the wall clock. Stop durations and auto-stop timing use the monotonic clock.
- iOS Safari has no `navigator.vibrate`. Haptics are never promised there.
