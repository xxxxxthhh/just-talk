# Game Mode v2 Design

## Goal

v1 made the run correct; v2 makes it feel like a game. In the owner's own run, six spoken items took 83 seconds, mostly spent finding Stop, waiting, and reading flat feedback. Two of eight score calls were wasted on stopping too early or too late. Every valid reading scored 80–100, so the 60-point heart line never came into play.

v2 has three parts:
- **Rhythm**: auto-stop when you finish speaking.
- **Stakes for every level**: tiers, a chain, a 1000-point run score, S–C ratings, and a personal best.
- **A redesigned run UI**: one ring that changes shape throughout the run, six stones for progress, tier-colored glow, a bottom thumb zone, an immersive full screen, a climactic summary, and a rebuilt review.

This is the merged outcome of independent proposals from Fable and Codex (GPT-6-Astra), a lead decision pass, and a cross-review round. Inputs are in `/tmp/justtalk-game/v2-*.md` and screenshots in `/tmp/justtalk-game/ui/`.

## Principles

1. **Penalties stay on the robust line.** Hearts and run endings use only the v1 rules: fixed 60, confirmed twice, technical failures never cost a heart. Tiers, chain, score, rating, and personal best (PB) may absorb scorer noise because they never cost anything.
2. **Animation never decides or blocks.** Every game fact is derived from reducer state before an animation starts. Buttons are usable from the first frame.
3. **Scoring is derived.** Tier, chain, score, rating, and badges are pure functions of `RunState`. The reducer changes in one place only: `LOCAL_REJECT`.
4. **No backend changes.**

## Mechanics

### Tiers

The game uses its own palette, not `scoreTone`. Compare raw values: 84.9 is Good even if it displays as 85.

| Tier | Raw accuracy | Color |
| --- | --- | --- |
| Perfect | ≥ 95 | gold (new token; used only for Perfect and S) |
| Great | ≥ 85 | mint (good) |
| Good | ≥ 60 | warm amber |
| Re-listen | < 60 | soft coral |

- Re-listen is the same line as the Challenge rescue line (`PASS_ACCURACY = 60`) and `RunReview` `LOW = 60`.
- Re-listen is the only user-facing low word. Never show "Miss", "wrong", or "fail".
- Unjudged, NoMatch, pending, and local rejects have no tier.
- `RunReview` must color scores by tier, not `scoreTone`.

### Chain

- `q_i` is the accuracy of item *i*'s **first valid reading**. A re-record after an unjudged result can become `q_i`. A rescue never rewrites it.
- `c_i = q_i ≥ 85 ? c_{i−1} + 1 : 0`.
- The chain is shown from ×2 upward.
- An item that is still unjudged holds the chain. Leaving an item without a valid reading breaks the chain. This covers skip, unknown, and cannot-confirm. Example: 95, unknown, 95 never shows ×2.
- The chain can't be farmed. After a valid first reading, only unjudged items may be re-recorded (`runModel.ts` `canRecord`), and extra attempts are capped at two (`nextCapture`).

### Run score and rating

`P = round(1.5 × Σ q_i + (100/15) × Σ max(c_i − 1, 0))`

- The total is rounded once. Full marks are 1000: 900 base plus 100 chain.
- The **base is continuous and the chain bonus is a step function**. One point at 85 can swing about 75 points.
- **S ≥ 950, A ≥ 850, B ≥ 700, C < 700.**
- In practice, S requires a full six-item chain and an average of about 94.4. One reading below 85 caps the run at 944 (A).
- The summary always shows "Longest chain n/6", so an A from a broken chain reads as a chain issue, not a score issue.
- C is neutral grey with the copy "Logged." A cleared Challenge can be a C, and must never look like a failure.

Worked examples:

| Readings | Score | Rating |
| --- | --- | --- |
| Owner's run: 100, 80, 95, 92, 86, 94 | 861 | A |
| Same run with 80 → 86 | 930 | A |
| 100, 100, 84.9, 100, 100, 100 | 904 | A |
| 100, 100, 85, 100, 100, 100 | 978 | S |
| All 95 | 955 | S |
| All 85 | 865 | A |
| All 60 | 540 | C |

**Rating eligibility** is checked per item, not from `endReason`. A run is rated only when every item has a valid first reading and the run is either a Route or a cleared Challenge. Route `"completed"` can include skips and unjudged items.

Unrated runs show the points earned so far and the stones, labelled "Not rated · <reason>". This covers Out of hearts, incomplete, quit, quota, and Routes with gaps. Points earned so far use the same fixed formula: missing slots add nothing and break the chain. The score is never re-normalized by the number of items practiced.

### Personal best

- Stored in localStorage key `jt.runBest.v1`, bucketed by **(mode, focus phoneme frozen at run start, rules version)**.
- The bucket uses the focus phoneme frozen at run start, not stats that change after the run.
- It is a game record, not a skill measure. Warm-ups vary between runs, so wording is "Best · /ð/", never "improved X%".
- Written only for rated runs.
- "New best" is decided and frozen before the write, so it is idempotent across remounts.
  - "New best" only when strictly higher than the stored record.
  - "First record" when nothing was stored.
  - A tie shows nothing.
- Public-mode entries expire 7 days after they are written or updated; reading an entry doesn't extend it.
- "Delete my data" clears it, along with the sound and auto-stop preferences.
- `PRIVACY.md` lists these keys.
- Corrupt data and write failures degrade silently.

### Badges

These don't add points and appear only on rated runs:
- **Full combo**: all six first readings are Great or better.
- **New best** or **First record**.

Flawless is dropped because its "no retries" definition could pair with a C.

### Local reject

Some takes are discarded without calling Azure. They use no budget and no extra slot.

- **New reducer action `LOCAL_REJECT { key, reason }`.** It requires the attempt to still be `capturing`. It removes the attempt, clears `activeAttemptId`, returns to ready or rescue, and sets `lastRejection`.
  - It doesn't use the `SCORE_FAILED` refund path, because the budget only moves at `SCORE_SENT`.
- `handleBlob` branches before `BLOB_READY`/`SCORE_SENT` and before creating a review URL.
- The rejection is shown as its own copy, not wrapped in "That recording wasn't scored…".

### Hard difficulty (second cut)

A player-chosen Standard 60 or Hard 85 line, locked at start, with its own PB bucket. It needs a separate Challenge status vocabulary, because 60–84.99 would be both Good and a rescue. It is not in this cut.

## Auto-stop

This is end-of-speech detection from signal energy, not semantic sentence completion. It is on by default for words and sentences. One preference, `jt.autoStop`, can be toggled from the entry card and in-run. Toggling during a take applies from the next take.

The manual Stop button stays at the same bottom position at all times.

### Pipeline

- `game/vad.ts` is a pure state machine fed `(dBFS, tMs)` frames and tested with synthetic sequences.
- The session drives it from the run capture:
  - one shared `AudioContext`, created in the "Start run" gesture and also used by the sound effects;
  - an `AnalyserNode` with `fftSize` 1024 and `getFloatTimeDomainData`;
  - RMS converted to dBFS;
  - sampling about every 25 ms by `setInterval`.
- The analyser is attached inside the same capture initialization that starts the recorder.
- The clock starts at `recorder.start()`, so a permission prompt never eats the timeout.
- The UI gets `level` 0..1, `silenceProgress` 0..1, and `autoStopState`. The states are off, calibrating, listening, tail, fallback, and stopping.

### Parameters

These are first-pass values, tuned on real devices.

| | Word | Sentence |
| --- | --- | --- |
| Noise floor N | Rolling 10th percentile of the take so far, starting at −55 dBFS, drifting up at most +1 dB/s. If the first 250 ms are already above −40 dBFS, treat it as speech from t=0 and keep N at −55 | same |
| Onset `T_on` | `clamp(N + 10, −48, −28)`, with 3 of the last 5 frames above it | same |
| Offset `T_off` | `T_on − 6 dB`. Silence means **continuously** below `T_off` | same |
| Minimum voiced time | 250 ms (measured by monotonic time) | 500 ms |
| Trailing silence to stop | 650 ms | 1000 ms |
| No-onset timeout | 4 s → local reject (`no-speech`) | 6 s |
| Auto-mode cap | 6 s | 14 s |
| Noise fallback | N > −32 dBFS, or calibration spread P90−P10 > 12 dB over the first 8 frames → auto-stop off for this take, "Noisy · tap Stop" | same |
| Detection invalid | Sampling gap > 250 ms, context not running, or page hidden → auto-stop off for this take. A gap is never counted as silence. Hidden pages already pause the run | same |

The rolling floor replaces calibration on the first 250 ms. That rule broke when the learner spoke immediately: a quiet speaker at −36 dBFS would never cross the onset and would be rejected.

Trailing silence is kept in the blob; nothing is trimmed.

### Stop decisions

Every stop path is one stop-once call. The capture's callback receives an immutable summary: `captureId`, `stopReason`, `durationMs`, `detectionValid`, `speechSeen`, and `voicedMs`.

| Stop reason / state | Result |
| --- | --- |
| Pause, quit, exit, or replaced by a new capture | Discard silently |
| Manual Stop, < 0.45 s | `LOCAL_REJECT` with "Too short · try once more" |
| Manual Stop, ≥ 0.45 s | **Submit. VAD never vetoes a manual stop** |
| Healthy detection, onset seen, minimum voiced time met, trailing silence reached | Submit once |
| Healthy detection, no onset by the timeout | `LOCAL_REJECT` with "Didn't catch anything" plus a one-tap **"Use manual Stop"** for the next take |
| Healthy detection, onset seen but trailing silence reached before the minimum voiced time | `LOCAL_REJECT` with "Too short" |
| Healthy detection, auto-mode cap reached | Submit if the minimum voiced time is met; otherwise `LOCAL_REJECT` |
| Auto-stop off, noisy, or detection invalid | No VAD stops or rejects. Manual Stop plus the session's existing hard cap (30 s) |

Microphone keep-warm across takes is deferred.

## UI

### Visual language: ring, stones, glow

The run stays inside the existing warm brown and orange brand.

- **Ring**:
  - One element on every run screen that changes shape between states:
    - idle: breathing;
    - recording: level and silence arc;
    - scoring: orbiting arcs;
    - verdict: becomes the score plate;
    - summary: becomes the rating plate.
  - 200 px diameter, `min(200px, 26dvh)` on short screens, with a 224 px layout slot.
  - Level changes use transforms only, so text never jumps.
  - Implemented as SVG or canvas plus CSS variables, animating only transform and opacity.
  - In the ready state it is decoration (`aria-hidden`). While recording, tapping it stops the take, with a 400 ms debounce that applies to the ring only.
- **Stones**:
  - Six 28 px hexagons in three groups (2 + 2 + 2), labelled Warm-up, Focus, and In context.
  - Fill color is the tier. The current stone breathes.
  - Status marks: skipped is dashed, unjudged is striped, pending has an orange outline.
  - A rescued item shows a tier fill plus a coral outline.
- **Glow**: a radial gradient from the ring in the current tier color, at opacity 0.18 or less. Gold appears only for Perfect and S.
- **Type**:
  - Outfit for display: words 44–56 px, sentences 24–28 px, score 88 px with `tabular-nums`, tier labels 14 px uppercase with 0.18em tracking.
  - Inter for body text at 15–16 px.
- **Motion**: enter 200–280 ms `cubic-bezier(.22,1,.36,1)`, pop 320–420 ms `cubic-bezier(.34,1.56,.64,1)`, exit 160 ms.
- **Sound**:
  - Synthesized with WebAudio, so there are no asset files.
  - **On by default.** One mute toggle on the entry card and in the run header, stored in `jt.sfx`.
  - Cues: good (pop), great (two-note rise), perfect (arpeggio), heart (soft crack), clear (fanfare; shorter for B and C), rescue-saved (light double tone).
  - No sound at all while the microphone is open, including a recording-start cue.
  - Muting stops sound output only; it never suspends the shared context that auto-stop uses.
  - A rejected `play()` degrades silently.
- **Haptics**: `navigator.vibrate` by feature detection. It doesn't exist in iOS Safari, and the design never promises it.
- **Copy**: short, second person, no exclamation stacks. The word "wrong" never appears.

### Screens

The layout targets 390×844 with the tab bar hidden. Fable's and Codex's layouts both fit at about 705–763 px.

The bottom thumb zone is fixed at about 144 px: a chain or auto-stop row, a 60 px primary button, then a 24 px secondary action. The middle area shrinks and scrolls on short screens or large text.

1. **Entry (hero card, replaces the Quick run strip)**:
   - "This run's sound" with the IPA large, plus six empty stones.
   - "Best · /ð/ 861 A" or "No best yet".
   - A Route or Challenge choice, each with a one-line explanation.
   - Auto-stop and sound toggles, and a full-width Start.
   - In public mode, a usage line.
   - About 220–260 px tall.
   - Start stays disabled while a normal recording or score is in flight.
2. **Ready and recording**:
   - Header: Pause (since the tab bar is hidden), mode, hearts, sound.
   - Then the stones, the stage label, and the prompt.
   - The ring shows elapsed time and a live level, and a silence arc fills toward auto-stop.
   - Hint text: "Speak. I'll stop for you.", "Noisy · tap Stop", or "Auto-stop off · tap Stop".
   - The primary button switches between Record and Stop in place. The secondary action is "Cancel take", never a disguised skip.
3. **Scoring**:
   - Orbiting arcs and "Got it, listening…", with no fake score or color.
   - After about 5 s, "Still waiting for your result…". There is no timeout claim and no resend.
   - Pause and Quit stay available.
4. **Verdict**:
   - The ring pops (1.0 → 1.18 → 1.0, 420 ms) into the tier color.
   - The score rolls from 0 to the final value in 450 ms. Scores below 60 appear without rolling.
   - The tier label fades in, followed by a points line ("+129 · ×3 +13") and its stone filling.
   - Perfect adds a gold sweep and a few particles.
   - At most one evidence-based hint, with what it belongs to stated, e.g. "Revisit 'birds' · word 31".
   - A compact one-line Next preview. The bottom primary button reads "Record next" (advance and record).
   - Tier, hearts, and chain are final before the animation starts.
5. **Rescue** (Challenge, first valid reading below 60):
   - "One more listen", with the score secondary.
   - Two steps, "1 Listen → 2 Read again". The bottom primary button is Hear it, which becomes Record again once the reference audio has loaded.
   - Secondary: "Skip rescue · this challenge won't count as cleared".
   - The at-risk heart pulses slowly; other hearts are static. Text: "No heart lost yet".
   - The Next preview is dimmed text only, with no disabled big buttons.
6. **Heart lost**:
   - Shows both readings, "45 → 52", and "Two low readings. One heart used."
   - The heart cracks and empties (400 ms), with one soft red glow pulse.
   - At zero hearts, a crack overlay of about 800 ms plays on top of the summary. It uses `pointer-events: none` and `aria-hidden`, and buttons stay live.
   - A successful rescue shows "Heart kept · 45 → 72" and the rescue-saved cue.
7. **Summary**:
   - Buttons are rendered and enabled from frame 0. Tapping one acts immediately and ends the sequence.
   - Sequence, about 1.55 s or less:
     - 0–400 ms: the ring moves into place;
     - 240–520 ms: the rating letter pops;
     - 350–800 ms: the score rolls;
     - 650–1250 ms: the stones light in order with each item's score;
     - 1250–1550 ms: badges appear.
   - Underneath: "Longest chain n/6", Best comparison, and "One thing to revisit" (the single most useful low word or sound, with its score source labelled).
   - Challenge line: "Cleared ♥♥".
   - Unrated runs use the same full layout, neutral, with "Not rated · <reason>":
     - Out of hearts shows a cracked heart where the letter goes;
     - no fanfare.
   - Buttons: See review, Play again (note that it uses new score calls), Done.
8. **Review (rebuilt)**:
   - A compact summary bar at the top (rating, score, stones; tapping a stone jumps to its item).
   - "What to practice next": up to three items, deduplicated so one recording never appears as both a sound card and a word card.
   - A custom dark mini player, "▶ You" and "▶ Coach", with Take 1 and Take 2 for rescued items. **Only one player sounds at a time.**
   - Word-level chips under sentences, e.g. "birds 31", with "word score" and "sentence score" labelled.
   - Unreached items are collapsed. Items without a recording show no empty player.
   - "Generate a drill" keeps its progress and error after moving to Practice.
9. **Immersion**: the tab bar is hidden during a run. Quit asks for confirmation and then calls `run.quit` (results kept, go to summary), not `run.exit`.

### Reduced motion and VoiceOver

| Effect | Reduced-motion version |
| --- | --- |
| Ring and stone breathing | Static outline |
| Ring scaling with level while recording | Fixed ring with a small inner level bar |
| Silence arc | Kept (it's functional), updated directly with no easing |
| Scoring arcs | Static ring and text |
| Score roll, gold sweep, particles | Final value shown directly, no effects |
| Heart pulse and crack | Orange outline for risk; the heart empties directly |
| Summary sequence | Everything shown at once (fade of 100 ms or less) |
| Review stagger | None |

- Each state announces itself once through `aria-live=polite`, e.g. "95. Perfect. Chain 3.". Level readings are never announced.
- The rolling number is `aria-hidden`.
- Focus is never stolen from buttons.

## Architecture and files

| Area | Files |
| --- | --- |
| VAD | `game/vad.ts` (+ test, new); capture metadata and analyser in `usePracticeSession.ts`, `hooks/useRecorder.ts`; shared AudioContext |
| Local reject | `game/runModel.ts` (`LOCAL_REJECT`), `types.ts`, `hooks/usePracticeRun.ts` (`handleBlob` branch) |
| Scoring | `game/scoring.ts` (+ test, new): tier, chain, points, rating, eligibility, badges, top revisit item |
| Personal best | `game/personalBest.ts` (+ test, new); `PRIVACY.md`; delete-my-data hook in `components/PublicGate.tsx` |
| Sound effects | `game/sfx.ts` (new) |
| Ring | `components/RunRing.tsx` (new) |
| Run screens | `components/PracticeRun.tsx`, `game/game.css` |
| Review | `components/RunReview.tsx` (+ mini player) |
| Entry, immersion, Pause | `mobile/screens/PracticeScreen.tsx`, `mobile/MobileApp.tsx`, `mobile/mobile.css` |

`types.ts` and `game.css` each have a single owner.

## Testing

- **Scoring**: 59.6, 60, 84.9, 85, 94.9, and 95; all of the worked examples; the gap-breaks-chain rule; rating eligibility with Route skips and gaps.
- **VAD**: synthetic sequences for:
  - a quiet speaker from t=0 (must not be rejected);
  - onset with too little voiced time;
  - a 1.05 s mid-sentence pause;
  - a noisy floor;
  - sampling gaps;
  - the auto-mode cap;
  - manual Stop at 0.4 s and at 3 s with no onset (the 3 s take must submit).
- **`LOCAL_REJECT`**: the budget stays 0; a rescue local reject keeps extras unchanged; duplicate or late rejects are no-ops; manual, silence, and cap stops racing each other submit only once.
- **Personal best**: buckets, strict "New best", idempotence across remounts, expiry, corrupt data.
- **UI**:
  - buttons are live during every animation;
  - reduced-motion variants;
  - one player at a time;
  - the tab bar is hidden and Pause works;
  - Quit calls `quit`, not `exit`.
- **Device** (owner as pilot): iOS Safari and desktop Chrome.
  - Auto-stop: quiet voice, final fricatives (/θ/, /s/), slow sentences with pauses, a fan or TV in the background, lock and resume.
  - Sound: the iOS silent switch, the rescue reference audio followed by recording.

## Estimate

About 7–9 days for one engineer, or about 5 days for two in parallel:
- Track A: VAD, recorder, session, reducer, scoring, PB, sound effects.
- Track B: ring, stones, every run screen, review, entry.

Fix the capture metadata, `LOCAL_REJECT`, the scoring selectors, and the ring's props first; then the tracks split.
