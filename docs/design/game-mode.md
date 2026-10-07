# Game Mode Design

## Goal

Make practice feel like a game without turning a noisy scorer into a judge. The learner plays a short "run" of six items, gets one clear verdict per item seconds after speaking, and ends on a review screen that turns mistakes into the next thing to practice. An opt-in Challenge variant adds lives for learners who want stakes.

This design is the merged outcome of two independent reviews (Claude and Codex), each reading the current code. Where they disagreed, the decision and both arguments are recorded under [Where the Reviews Diverged](#where-the-reviews-diverged).

## Current Problems

- The unit of feedback is too large: read a passage, wait, then study a full results table. There is no "short action → verdict → next" rhythm.
- On mobile, every `result` update auto-opens the result sheet (`mobile/screens/PracticeScreen.tsx`), interrupting any attempt at back-to-back practice.
- After a successful score, `usePracticeSession` awaits auto word collection and history/word-bank refreshes before showing the result, so feedback waits on unrelated work, and a collection failure can surface as a scoring failure.
- Weak-word TTS prefetch fires after each result; at game tempo this becomes a stream of billable TTS calls.
- Existing stats track practice days (`streak_days`) and saved session count (`sessions_this_week`), but nothing tracks a finished unit of practice. There is no goal to finish and no reason to "play again". A multi-item run adds several sessions, so session counts cannot be read as run counts.

## Constraints

- Every item is an Azure call: roughly 1–3 s latency (assumed, not yet measured for single words) and real cost.
- Public mode defaults to 20 score attempts and 180 s of audio per visitor per day (`config.py`), plus site-wide caps. One six-item run is up to 8 attempts, so a visitor gets about two runs per day.
- Azure scores are noisy; reading the same word twice can differ by 5–10 points. Two low readings in a row are **not** independent trials (same mic, room, word, and model bias), so confirmation lowers but does not eliminate false failures.
- Public mode has no LLM, so run content cannot depend on generation.
- A successful single-word score already updates SRS in the backend (`main.py` → `record_word_practice`). Game verdicts must not try to roll that back.

## Recommended Scope

Mobile first. One "Start a run" entry on the Practice screen with two modes sharing one state machine:

- **Route** (default): six items, no lives, no fail state.
- **Challenge** (opt-in): the same six items with 2 hearts and a confirm-twice rule.

Both modes ship in the MVP. Lives were raised as a possible direction in the original request, and Challenge is a thin rules layer on top of Route, not a separate engine.

Out of scope: XP currency, leaderboards, paid stamina, streak bonuses for speed, persisted run history, desktop game layout, quota-based run resizing, SRS changes, LLM generation on the run's critical path.

## User Experience

### A run

Six items frozen at start, de-duplicated by word:

1. **Warm-up (2)**: due word-bank words, ordered by due date (not lowest score).
2. **Focus (2)**: words or short phrases for one target phoneme, from phoneme insights examples, falling back to a curated starter pack.
3. **In context (2)**: natural 5–9 word sentences, one containing a focus word, one using the same sound in a new word.

A first-time visitor with an empty word bank gets a curated starter run, with no placement test. The starter pack (30 items: 5 phonemes × 6) is the **primary** content source, not a fallback. Public visitor data expires after 7 days, phoneme stats need several attempts, and public mode has no LLM. The focus phoneme is the learner's weakest phoneme intersected with the pack's coverage, with a pack default when the intersection is empty. Focus and context items come from that pack group. The MVP always labels it "today's sound", never "your weak sound".

### Per-item loop

`see prompt → tap record → tap stop (auto-submits) → verdict card → tap record for the next item`

- Stop submits automatically. There is no separate Score tap, and the request is sent only after the new blob's `onstop` fires.
- While Azure scores, show "Got it, listening…". Do not show a fake verdict animation.
- The verdict card shows one line, at most one word and one sound hint, taken from returned phoneme data. A single low score reads "worth a re-listen", not "wrong".
- The next prompt is already shown under the verdict. Its record button both advances and starts recording: the learner takes one tap and keeps control of preparation time. Nothing advances on a timer.
- A route node lights up on any valid scored result. Skipped items show as hollow nodes, and the end screen says "practiced 4/6, skipped 2".

### Challenge rules (2 hearts, max 8 counted attempts)

| Situation | Outcome |
| --- | --- |
| First valid `accuracy ≥ 60` | Item passed |
| First valid `accuracy < 60` | No heart lost yet. Rescue: tap "listen" to load and play the reference audio, then re-read the same item. Rescue recording is enabled once the reference audio has loaded; playback does not need to finish |
| Rescue `accuracy ≥ 60` | Heart kept ("saved"); both results shown |
| Both `< 60` | Lose 1 heart; no third try. At 0 hearts → end run, go to review |
| NoMatch, null score, or incomplete alignment | Not judged, no heart lost, does not count as a pass; manual re-record allowed |
| A rescue or re-record is needed but the extra pool is empty, or TTS is unavailable for the rescue | Cannot confirm, so no heart lost; challenge marked "incomplete" |
| User skips a main item or the rescue, or quits | Challenge incomplete; no heart lost, results kept |
| Rejected before scoring (HTTP 400, 413, or 503, all raised before the billable Azure call) | Not counted against the budget, no heart lost; the item stays and can be re-recorded for free |
| Unknown outcome (500, 502, network error, malformed success) | Item marked "pending"; the run continues to the next item; Challenge marked "incomplete"; never auto-retried |
| 429 | Trial usage ran out; end the run and go to review |

- Six main attempts, plus one **shared** pool of 2 extra attempts used by rescues and NoMatch re-records alike. The run makes at most 8 counted attempts that may reach Azure. Pre-scoring rejections are refunded, so HTTP requests can exceed 8. An empty pool does not end the run by itself. It only matters when another rescue or re-record is needed, so the remaining main items stay playable after the last extra attempt is used.
- **Challenge cleared** means all six main items were resolved (none skipped, unjudged, or awaiting a rescue) and at least one heart remains. An item that loses a heart after confirmation counts as resolved, not as passed.
- While a rescue is pending, the next item's record button is disabled. The learner can do the rescue or leave the challenge for normal practice.
- Compare raw accuracy, not the rounded display value: 59.6 fails. All items use top-level `scores.accuracy`, which is the same input the backend SRS uses. A result is judgeable only if it is not NoMatch, `scores.accuracy` is a finite number, `words[]` is non-empty, and no word has `error_type` Omission or Insertion. Otherwise the item is "not judged". A 60–85 score passes Challenge but still fails SRS (`> 85`), which is expected.
- 60 is the existing `needs-work` bucket edge, used as an uncalibrated starting parameter. It is not a mastery line, and passing does not graduate a word.

### Review

- Header facts: practiced/skipped counts, items added to the word bank, and the challenge outcome if any. No averaged "power score".
- At most three action items, prioritized as: a sound that failed across several items, then clearly low words, then single borderline results. Each item shows the prompt, the word or sound, the score, and buttons to replay your recording and the reference audio. If nothing qualifies, say so rather than inventing three.
- Recordings live only for this run: one blob per attempt (up to 8), so a rescued item replays both readings next to their own scores. They are released on exit and do not survive a page refresh.
- Personal mode: offer "Generate a drill for /θ/" via the existing `/api/drills/generate`.
- "Play again" builds the next run with this run's weak items first.

## Data Flow

- Single-word items: the backend already updates SRS on score. Use that path; do not add a parallel hit/miss write. Each scored attempt applies the existing SRS rules in order. A first low score makes the word due now. A rescue above the graduation threshold then advances the schedule normally, for example from interval 0 to 1 day. Keeping a heart never rolls back the first record, and the game never blocks the rescue's normal SRS update.
- Sentence items: in game mode, skip the default "≤85 auto-collect". Call `POST /api/words/from-session/{id}?max_score=70` (the parameter already exists). Scores from 71 to 85 stay as review hints.
- Ordering: show the score immediately. The next attempt is enabled only after the previous sentence's `from-session` call settles (success, rejection, or error). Any failure marks the candidates "save manually" and the run continues. Failed calls are never auto-retried. Accepted risk: a late write could reset one word's `due_at`/streak, the same exposure the normal flow has today. Single-word SRS is written inside `/api/score`, so there is no separate sync for word items.
- Refresh history, word bank, and insights once, at review time.
- Phoneme stats need no change, because scored sessions already feed `/api/phoneme-stats`.

## Backend Design

One backend change and no new tables for the MVP. The change adds the starter pack texts to `BUILTIN_TEXTS` in `main.py` so public-mode TTS uses the shared cache instead of a billable call per visitor. Each attempt that Azure recognizes becomes a normal `practice_sessions` row. NoMatch creates no row, and a rescued item has two rows. The run model is `item → attempts[]`, and each attempt carries attemptId, sessionId, result, and recording. If whole runs need persisting later, add `practice_runs` in the per-actor store, covered by export, delete, and visitor expiry, never in the shared quota database.

## Frontend Design

| File | Responsibility |
| --- | --- |
| `frontend/src/game/runModel.ts` (new) | Pure state machine and verdict/heart rules; explicit states for valid, skipped, NoMatch, unknown, and quota-ended |
| `frontend/src/game/runDeck.ts`, `starterPack.ts` (new) | Frozen, de-duplicated item selection and the curated pack |
| `frontend/src/hooks/usePracticeRun.ts` (new) | Run queue (`item → attempts[]`), per-attempt blobs, the 8-call budget, and a single-submit lock; composes the shared session, with no second recorder |
| `frontend/src/usePracticeSession.ts` | Bridge the shared recorder to the run; force short mode and limit; disable global shortcuts and weak-word TTS prefetch during a run. Run scores never enter `session.result`. Score-before-collection in the normal flow is an optional, separate cleanup |
| `frontend/src/hooks/useRecorder.ts` | Pass the blob to the ready callback. The existing stop guard already prevents a double `onstop`; the single-submit lock and the stale-attempt check live in the run hook |
| `frontend/src/components/PracticeRun.tsx`, `RunReview.tsx` (new) | Route, verdict card, hearts, review |
| `frontend/src/mobile/screens/PracticeScreen.tsx`, `MobileApp.tsx` | Entry point; no auto result sheet during a run; pause the run on tab switch |
| `frontend/src/api.ts`, `types.ts` | `addWordsFromSession(id, maxScore?)`; run types |

The run state lives above `PracticeScreen` so switching tabs pauses the run instead of losing it. Late responses are checked against runId, itemId, and attemptId.

## Error Handling

- Each attempt sends at most one score request. An item has a first reading plus any rescue or re-record the budget allows. Never auto-retry Azure, because a timed-out call may still be billed.
- Classify score errors by status only. 400, 413, and 503 are rejected before scoring and refunded. 429 ends the run as a quota stop. Anything else is unknown: the item goes "pending" and the run continues. Without an idempotency key, do not guess the matching session by text.
- On a mid-run 429, end the run, keep the results, and label it "trial usage ran out", not as a failure.
- If the reference audio fails to load, the rescue cannot be offered, which feeds the Challenge rule above. Replaying your own recording still works.

## Testing

1. A six-item run sends exactly one score request per stop, including when auto-stop and manual stop race or the user double-taps. NoMatch never lights a node.
2. A collection failure or full word bank after a good score still shows the score and lets the run continue. A late response never lands on the next item or run.
3. Challenge arithmetic: 2 hearts can reach 0 within 8 counted attempts. A low first score with the extra pool empty ends as "incomplete", not as a lost heart. After a successful rescue uses the last extra attempt, the remaining main items still play and the challenge can still be cleared. A skipped main item makes it "incomplete". The next item cannot start while a rescue is pending.
4. Sync ordering: the next attempt waits for the previous `from-session` call to settle, and any failure continues with "save manually".
5. Per-attempt blobs replay in review next to the matching result and are released on exit. Run iOS Safari `onstop`, permission, and backgrounding checks on a real device.
6. Regression tests for normal word drill and long passage flows.

## Estimate

One engineer familiar with the code needs about 3 days for a playable mobile flow and about 5 days for a mobile MVP verified on device. Two engineers working in parallel from Day 1 can bring this to about 4 days. The task breakdown is in `docs/development/game-mode-implementation-plan.md`.

## Where the Reviews Diverged

| Fork | Claude's first position | Codex's first position | Decision |
| --- | --- | --- | --- |
| Lives at all | Yes: tension is what makes it a game; "flat" was the complaint | No: a noisy score should not end a run; a route plus nodes is enough | Lives ship as opt-in Challenge. Codex conceded that a route alone does not answer "flat"; Claude conceded that a forced fail state for everyone is premature |
| Heart rule | 3 hearts, judged against a personal baseline, rescue restores a heart | No hearts; a personal baseline is manipulable and mixes item types | 2 hearts, absolute threshold of 60, confirm twice before a loss. Codex showed that 3 hearts with 2 rescues can never reach 0 |
| Noise handling | Two low reads make a false fail unlikely | The reads are correlated, so the squared probability is wrong | Confirm-twice is kept as evidence, not proof; the verdict copy never says "you can't pronounce X" |
| Pacing | Auto-advance 0.8 s after the verdict | Never force tempo | No timers; the record button on the next pre-rendered prompt advances and records in one tap |
| Scope | Both platforms, 2–3 days | Both platforms with a quota-resizing matrix, 4–6 days | Mobile first, 429 ends the run, no resizing; about 5 days for one engineer, about 4 for two |
| Quota as "energy" | Show quota as daily energy | Do not gamify service limits | Quota stays labeled as service usage |

Codex's alternative if Challenge tests poorly is a fixed six-call "check" variant. The first four items come with reference audio and hints. The last two are unseen transfer sentences on the same sound, where the learner chooses to go straight in or listen first. Going straight in earns an independent "check passed" result. Listening first completes the route with all results kept, but does not count as the independent check. The stake is relying on help, not hearts, and no retries are bought.

## Open Questions

- Measure p50/p95 single-word scoring latency. If p95 is over 2.5 s, the loop will not feel fast, and upload-while-preparing becomes worth designing.
- Is 60 the right Challenge threshold? Collect pass/fail rates from internal play before tuning.
- Should Challenge become the default after testing? Decide from completion, replay, and perceived-fairness feedback, not from call volume.
