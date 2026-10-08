# Game Mode v3 Design

**Status:** Revised for the owner-confirmed My words addendum in [the owner decisions](game-mode-v3-decisions.md). Work is on `feat/game-mode-v3`; A1 was delivered in `83c1113` and all 60 r1 rows were approved in `ceb6144`. A5's approval prerequisite is satisfied; runtime integration and verification remain work to do.

## Goal

Give Route a listening-led practice identity, offer a longer Route, and make Challenge's target selectable. Keep v2's recorder, auto-stop, scoring evidence, review, and asynchronous ownership protections.

The owner chose Route 12, listening before reading, Challenge Target 85, and a Route using the learner's own words. The 60 starter texts and Route feedback variant B are now approved. Earlier alternatives and pending mockup choices are superseded by the addendum.

## Principles

1. **Penalties use the chosen run target, confirmed twice.** The target is fixed at Start. Only two valid readings below that target on the same item cost one heart. Technical failures, unavailable reference audio, local rejects, and exhausted rescue allowances never cost a heart. This explicitly replaces v2 Principle 1's fixed-60 heart rule. Target 85 is an optional game requirement, not evidence that the scorer has become a more reliable skill test.
2. **Target and tier describe different facts.** Target 85 can require a rescue after an 80, while 80 remains Good. Tiers, weak-word evidence, and word collection thresholds do not move with the target.
3. **Choose before starting; keep the choice.** Freeze source, mode, length, target, and extra pool for the accepted Start. Play again retains them; Next sound is starter Route only. The separate summary action to practise words creates a new words-source Route, without altering the finished run. Done returns to entry choices. Sound and Auto-stop retain their existing behavior.
4. **Animation never decides or blocks.** Final facts and usable controls exist on the first frame. Selectors derive score, chain, rating, and progress; UI does not spend budget, judge readings, write PBs, or start audio effects through rendering.
5. **Preserve the existing service boundary.** Only the starter-text TTS allowlist changes on the backend. No API, scoring, quota, VAD, or storage-service redesign.

## Starter-source gameplay matrix

| Parameter | Route 6 | Route 12 | Challenge · Target 60 | Challenge · Target 85 |
| --- | --- | --- | --- | --- |
| Planned items | 6 | 12 | 6 | 6 |
| Warm-up / Focus / In context | 2 / 2 / 2 | 4 / 4 / 4 | 2 / 2 / 2 | 2 / 2 / 2 |
| Challenge target | None | None | 60 | 85 |
| Starting hearts | None | None | 2 | 2 |
| Shared extra pool | 2 | 4 | 2 | 4 |
| Maximum counted scores | 8 | 16 | 8 | 10 |
| Optional first-reading reference | Yes | Yes | No | No |
| Valid below-target first reading | Continue | Continue | Reference → rescue | Reference → rescue |
| Chain threshold | 85 | 85 | 85 | 85 |
| Tier thresholds | 95 / 85 / 60 | Same | Same | Same |
| Summary headline | Practised n/6 | Practised n/12 | Cleared / Failed / Incomplete | Cleared / Failed / Incomplete |
| PB bucket | Legacy key | New length bucket | Legacy key | New target bucket |

The extra pool is shared by rescue submissions and eligible re-recordings after unjudged/NoMatch results. It is not four rescues plus four retries. One main submission slot belongs to each planned item. Counted scores are net reservations under the existing rejection/refund rules, not an upper bound on HTTP attempts after pre-billable refusals.

Business `RunMode` stays `route | challenge`. RunConfig adds `source: "starter" | "words"`. The four configurations above use starter; words permits Route 6 (two extras) or Route 12 (four extras) only, for six valid configurations in total. No words Challenge. Maximum counted scores is length + maxExtra. Config/deck validation is source-aware: starter has three stages and a focus sound; words has N single-word prompts and no shared focus sound.

## Rules

### Challenge target, rescue, and hearts

`PASS_ACCURACY = 60` remains the tier/low-evidence constant. Challenge comparisons instead use the frozen run target. The raw first valid accuracy is compared without rounding.

- At or above the target: resolve the item as passed.
- Below the target with an extra slot available: require the existing reference-load step, then allow a rescue. Loading the reference remains distinct from requiring playback to finish.
- A valid rescue at or above the target keeps the heart. A second valid reading below the target loses exactly one heart and resolves the item. A third valid reading cannot farm score or hearts.
- Unjudged/NoMatch rescue results may use another remaining extra slot; they do not confirm a low reading. A technical unknown remains pending under the existing no-resend rule.
- If the extra pool is exhausted before a confirming valid rescue, use `cannot-confirm`, mark Challenge incomplete, and lose no heart. Copy: **“No rescue scores left · not confirmed. No heart lost.”** This is the `rescue-budget` cause.
- A first reading can instead be unjudged/NoMatch when the extra pool is already empty, with no valid low reading at all. Its `unjudged-budget` copy is **“No extra scores left · this item has no valid reading. No heart lost.”** Reference-load failure uses `reference-unavailable` and its own explanation. Never call all three cases an exhausted rescue or imply a low score where none exists.
- Skip rescue is a voluntary skip, not a confirmed second low. It leaves the run incomplete without charging a heart.
- Zero hearts ends on Summary as Failed. With hearts remaining, finishing all items without an unresolved/skip condition is Cleared; otherwise Incomplete. A confirmed heart-loss item is resolved and does not itself make a surviving run incomplete.

Budget moves only at the accepted `SCORE_SENT`. A matching pre-billable rejection/quota response refunds its reservation once; duplicate failures cannot refund twice. Unknown responses retain their reservation. `LOCAL_REJECT`, Cancel take, a pending permission cancellation, and discarded late blobs neither consume nor refund a slot. Keep the existing run/item/attempt identities and terminal guards.

### Tier and target copy

| Raw accuracy | Tier | Color |
| --- | --- | --- |
| ≥95 | Perfect | Gold gradient |
| ≥85 | Great | Mint |
| ≥60 | Good | Existing warm amber |
| <60 | Re-listen | Soft coral |

Target 85 examples:

| Readings | Tier/evidence | Separate challenge status |
| --- | --- | --- |
| 80 | Good, amber | “Below this run's target 85 · listen, then read again” and “No heart lost yet” |
| 80 → 88 | First-reading stone remains Good; latest result is Great | “Heart kept · 80 → 88” |
| 80 → 82 | Both readings remain Good | “Both readings below 85 · one heart used” |
| 84.9 | Good; shown as 84.9 | Below 85; rescue if available |
| 85 | Great | Passed |

Use the same target-aware vocabulary for Target 60, including “Both readings below 60.” Do not recolor an 80 as Re-listen or call it wrong. Review evidence retains its existing low/borderline cutoffs; sentence collection stays at 70. A Target 85 rescue is not permission to collect every word below 85.

All score displays and announcements retain the boundary-safe v2 formatter: normally whole numbers, one truncated decimal when rounding would cross 60, 85, or 95. Verify 59.6/60, 84.9/85, and 94.9/95 on the ring, stones, summary, and review.

### Chain, points, and rating

For planned length `N ∈ {6,12}`, let `q_i` be each slot's first valid accuracy. A rescue never replaces it. A missing slot contributes zero base points and breaks a completed sequence. While the current item is still unjudged, the displayed chain holds until the learner leaves it, as in v2.

`c_i = q_i ≥ 85 ? c_(i−1) + 1 : 0`

`P = round((9/N) × Σq_i + 100 × Σmax(c_i − 1, 0) / (N(N−1)/2))`

- Chain is not capped; Route 12 can reach ×12.
- Denominators always use the planned N, including partial, skipped, quit, and quota-ended runs. Never divide by the number of valid readings.
- Sum before dividing and round the total once. Item-level display rounding must not feed the total. Full marks remain 1000: 900 base + 100 chain.
- Rating eligibility is unchanged: every planned item needs a first valid reading, and the run must be a completed Route or a cleared Challenge. Unrated runs still show earned points and an honest reason.
- **S: points ≥950 and Full combo. A: points ≥850 otherwise. B: points ≥700 otherwise. C: the rest.** Thus 972 with a broken chain is A.
- Full combo means a rated run with every first valid reading ≥85. Rescue success cannot restore it. Badges add no points.
- Target 85 completion and S are independent: all 85 clears, but earns 865 A. A Target 60 cleared C still says “Logged.”

Worked examples, assuming rating eligibility unless stated:

| N | First valid readings in order | Points | Rating / Full combo |
| --- | --- | --- | --- |
| 6 | 100, 80, 95, 92, 86, 94 | 861 | A / No |
| 6 | 100, 86, 95, 92, 86, 94 | 930 | A / Yes |
| 6 | 100, 100, 84.9, 100, 100, 100 | 904 | A / No |
| 6 | 100, 100, 85, 100, 100, 100 | 978 | S / Yes |
| 6 or 12 | All 95 | 955 | S / Yes |
| 6 or 12 | All 85 | 865 | A / Yes |
| 6 or 12 | All 60 | 540 | C / No; Target 85 cannot clear with only these readings |
| 12 | All 100 | 1000 | S / Yes |
| 12 | Eleven 100, then 84.9 | 972 | A / No |
| 12 | Five 100, 84.9, six 100 | 927 | A / No |
| 12 | Six 95, then six missing slots | 450 | Not rated / No |
| 12 | Five 95, one skipped slot, six 95 | 822 | Not rated / No |

For the 972 example, `Σq=1184.9` and chain steps are 55 of 66. A threshold-only rating would wrongly produce S. N=6 retains all v2 point and rating results; the explicit Full combo condition changes no existing six-item bucket.

### Personal best compatibility

For starter-source runs, keep `RUN_RULES_VERSION = 1` and localStorage key `jt.runBest.v1`. Distinguish new configurations without migrating or hiding existing records. Freeze the bucket's focus from the accepted deck, never from stats fetched after scoring.

| Configuration | Exact key form; `focus` may be an empty string for the legacy null case |
| --- | --- |
| Route 6 | `route|focus|1` — byte-for-byte legacy form |
| Target 60 | `challenge|focus|1` — byte-for-byte legacy form |
| Route 12 | `route|focus|1|12` |
| Target 85 | `challenge|focus|1|85` |

Words-source runs have no PB bucket, read, write, or receipt; a rated words run must never fall through to the legacy null-focus bucket. Starter-source New best remains strictly greater; an absent live record yields First record; ties yield neither. The persistent controller decides and freezes one receipt per run before writing. Summary/Review remounts, a different tab's write, expiry, and a failed replay cannot recompute that receipt. A write must not replace a concurrently stored better record.

Public PBs expire seven days after creation/improvement; reads and ties do not extend expiry. Personal PBs have no expiry. There is no global reset, rules-version bump, or eager rewrite. Different decks make these game records, not calibrated skill comparisons. In particular, the 60-item pack changes which content subsets can appear in the retained Route 6 and Target 60 buckets: unchanged key bytes and scoring do not make old and new content equally difficult. The lead must tell the owner about this comparison limitation before the whole v3 cut is merged; existing Best records remain visible as agreed. Include in that owner notice the existing bank behavior below: scored game words already enter the word bank, so starter warm-up/focus words can naturally appear in My words.

## Route identity and new-run actions

### Hear it first

Ready offers **Hear it first**, using the existing reference service. It is optional, never automatic, never requires listening to the end, and never disables Record. The owner selected **variant B**: Route feedback keeps **Record next** primary and uses **Hear next first** secondary, replacing v2's current-item Hear it again on that screen. Hear next first accepts ADVANCE, previews the new item, and stays Ready with Record usable. Both starter and words Routes use this behavior. The final item offers Finish instead; Challenge retains its existing controls. Variant A is not implemented and no runtime variant setting is added.

Starting any recording already cancels playing and pending reference audio before microphone acquisition through the v2 session/speech guards; v3 adds regression coverage rather than changing speech or VAD code. The existing load-result callback can arrive before the playback-token check and update Route reference metadata; that alone is not audible playback or a challenge outcome. Assert that late success/failure cannot play into the microphone or publish a stale error.

Add controller cancellation for every accepted item change: ADVANCE, skip, recordNext, finish, and the approved Hear next first. Stop both playing and pending old-item reference audio before the new item's playback or capture; a rejected/no-op transition must not accidentally advance or play the wrong item. Pause, quit, exit, and replacement keep their existing cancellation. A current TTS failure may show readable feedback but never disables Route recording or spends a score slot.

Challenge has no new reference button before the first valid reading. Its existing rescue and review Coach controls remain. Do not describe Challenge as a controlled cold-reading assessment: the learner may already know these texts.

### Play again and Next sound

For starter runs, Play again keeps the frozen configuration and existing deck-rebuild policy: use the previous run's weak words as eligible warm-ups and choose focus from refreshed stats, with the existing starter fallback. It is not silently changed into a rotation command and does not guarantee an identical deck or focus.

Starter Route Summary additionally offers **Next sound /x/**; words-source summaries do not. Cycle explicitly through `θ → ð → ɹ → l → v → θ`, starting from the finished run's frozen focus. Retain Route length and extra allowance, use a fresh runId for selection, and retain eligible weak-word warm-ups. Label the destination sound, never “your next weakest sound.”

Both actions use the same gesture-time audio preparation, start token, navigation ownership, cancellation, and retryable error path. Configuration/deck validation failures must throw from `start()` before `teardown(true)` or any old-run lifetime reset; reducer validation is only a defensive backstop. Keep the finished results until a new deck is accepted. Pending buttons show Starting…; Review and Done stay usable. A failure remains visible after Summary → Review. Done cancels the pending action and prevents late success/failure from reopening or altering practice. Failed Next sound retries the same destination; it must not advance the cycle twice.

## My words run

Scored single-word game prompts already enter the word bank with source `"practice"` through the existing backend; this predates v3 (NoMatch and public full-bank insertion limits still apply). Active vocabulary therefore includes manually added/reviewed words and scored Route/Challenge starter warm-up/focus words: seeing these among due My words candidates is expected.

My words is a **words-source Route**, not a third RunMode. It has no hearts, optional Hear it first, approved Record next / Hear next first, auto-stop/manual controls, and Practised n/N Summary. Offer exactly 6 or 12 words: two or four shared retry slots respectively, at most 8 or 16 counted scores. Every prompt is `kind: "word"`, `stage: "words"`, targetWord equal to its trimmed, case-preserved single-word reference, and targetPhoneme null. Show one labelled **My words** progress group, wrapping six/twelve stones as needed; do not pretend these words form Warm-up/Focus/In-context stages or share an IPA target.

### Selection and insufficient words

1. Fetch a fresh vocabulary snapshot on accepted Start. The Words-page count is a preview, not a reservation. Exclude graduated rows for both ordinary candidates and summary seeds matched to the bank; never use them merely to reach N. Exclude a key if any matching row is graduated; bank keys are already casefold-unique, so this extra collision rule concerns boundary punctuation stripped by singleWordKey.
2. Reuse `singleWordKey` from runDeck for acceptance and dedupe only: trim, strip the same boundary punctuation, reject empty/multi-token references, lowercase. Display and submitted reference preserve the bank row's trimmed `word`, including case; seeds preserve the original trimmed `prompt.targetWord` (word-prompt text fallback where needed). Never substitute the lowercased key for prompt text. Do not invent a new “letters only” validator: existing internal apostrophes/hyphens remain accepted under that helper. Resolve duplicate eligible bank rows by lexicographically smallest stable ID; order the canonical bank snapshot by normalized word then ID before invoking the existing due helper, making equal-date ties deterministic.
3. Take eligible due rows in the exact `getDueWordsForReview` ordering, evaluated once at Start; missing/invalid due dates retain that helper's due-first behavior. For equal due dates preserve its input order, using the stable canonical bank snapshot as input. Equal-date ties may differ from ordinary Start review, which uses API order; ordinary review ordering is unchanged. Fill with remaining eligible active rows by finite `latest_score` ascending; null/nonfinite scores follow known scores. Tie-break by normalized word then stable ID. No seeded randomization for words decks: priority order is meaningful.
4. Deduplicate by singleWordKey, take the first N, freeze prompts and order for the run. Word-bank refresh, graduation/deletion or a newer score cannot change an accepted deck. No personal words are added to the curated TTS allowlist.

**Decided: require the full selected N.** With fewer than 6 eligible unique candidates, disable Start and say “Add more active single words to start a 6-word run.” With 6–11, six is available and twelve is disabled with “Need 12 active words · X available”; the user can explicitly choose six. Never silently reduce a chosen twelve to six or produce a 3–5-item run, and never pad with starter/graduated words. Revalidate after fetching; a shortage throws before teardown, preserving old results with a clear retryable message. This keeps N restricted to 6/12, the approved extras and the existing normalized score formula. No new denominators, short-run rating policy or division-by-zero case is introduced.

### Run again with words to revisit

Every terminal Summary, from either source and either mode, exposes **Run with words to revisit** in its scrollable next-step area. This is a distinct new-run action, not Play again or Next sound. It creates a words-source Route of the finished run's length; a Challenge thus starts a six-word Route with two extras. Never mutate the completed run's configuration or PB receipt.

- Inspect each item's **first valid reading** with raw overall accuracy <85. Equality 85 is excluded. For a word prompt retain its original trimmed targetWord (text fallback where needed), using singleWordKey only for acceptance/dedupe; for a sentence use only its explicit `prompt.targetWord` if that is a valid single word occurring as a whole word in the reference. A missing target or absent first-valid reading yields no seed. Do not scrape arbitrary low-scoring result words or use the latest/rescue score to rewrite eligibility.
- A sentence's low overall reading is a cue to revisit its target, **not proof that the target word was pronounced incorrectly**. Copy says “Words from first readings below 85,” not “wrong words.” An 80→88 rescue still yields an 80 run-local seed; fresh-bank validation excludes it if that key is now graduated.
- Dedupe seeds by singleWordKey, retaining the lowest qualifying first accuracy and then earliest original item position. Order seeds by that accuracy ascending, then original position. Eligible seeds precede bank fill; fill remaining slots with the due-first/low-score algorithm above, skipping seed keys. This seed-first exception applies only to this explicit action.
- **Decided:** a valid absent-bank seed may be included in memory, principally a sentence target not saved by collection (also a word not inserted because the public bank was full); exclude matching graduated keys. Ordinary scored word prompts already enter the bank, so no separate ordinary-word-missing mechanism is needed. Inclusion does not add a word before scoring or promise later persistence. Apart from general busy/starting guards, disable Summary's action only for run-local `no-seeds`: no first-valid reading below 85 with a valid target, with copy “No words from first readings below 85.” Cached eligible counts and shortages are hints, never disable conditions. Fresh Start rejects if all seeds are graduated or seed + bank candidates total less than N, preserving the old run and showing the relevant no-eligible-seed/exact-N error. Never substitute a bank-only run or starter filler.
- Freeze seed evidence from the originating run when the action is clicked; refresh the bank for current status/fill. Failed replacement retains that run and seeds; retry the same action/length. Done/newer start/owner unmount invalidates late work exactly as for Play again. No automatic request retry after an unknown score result.

Refresh vocabulary nonblockingly once on the first terminal transition (`next.endReason !== null && previous?.endReason === null`), catching refresh failure through the existing session boundary; retain the existing Review refresh. Summary does not wait for refresh, and Start remains authoritative for current membership, graduation and exact-N availability.

### Score, restart, PB, and entry

Use the same first-valid 1000-point formula with planned N, uncapped ≥85 chain, tiers, Full combo S gate, and Route rating eligibility. Missing/unjudged/skipped items make a completed words Route unrated. **No PB reads, writes, first/new-best badges or receipt**, even on a rated S; words runs never touch a starter bucket. Full combo and this-run score/rating remain visible.

Words-page entry: **Start a run with my words**, local `[6] [12]` choice (default 6), eligible count, “Due words first · no hearts,” and the existing public usage line. Header: **My words · 6 words** / **My words · 12 words**; no focus IPA or Best. Use source labels “Word bank” / “From this run” where provenance helps, not a false daily sound. Current ordinary recording/scoring, drill generation or a pending start disables launch. Use the same `recorderState`, `isScoring`, and `generatingPhoneme` facts as Practice entry plus controller.starting. With a run present the Words tab is unreachable, so this new entry does not call confirmLeaveRun; existing ordinary context-change confirmations stay intact. Starting belongs to the persistent controller above Words/Practice; error/pending state must survive navigation, and synchronous audio preparation stays in the original gesture.

The existing **Start review** remains a separate ordinary due-word queue using explicit Score and its existing completion count. It is not renamed, removed, capped at 6/12, or silently routed into the game. Its existing graduated tab/manual word practice also stays available; “graduated excluded” is a deck rule, not removal of access to those words.

Words **Play again** keeps source/length and rebuilds from the fresh active bank, without automatically pinning previous low words; the explicit revisit action supplies seeds when desired. Existing SRS resets any latest score ≤ its configured graduation threshold (default 85) to interval 0 / due now, so Play again can naturally repeat low words without deck seeds. The two actions may overlap heavily: explicit revisit uses first-valid <85 plus sentence targets, whereas SRS uses the latest single-word score ≤ the configured threshold. Neither action promises novel words. No Next sound button or callback action for words runs, and `nextSoundPhoneme` is null. Starter Play again/Next sound and all legacy PB bytes remain unchanged. Words entry length and review seeds are in-memory only: no new local key, separate saved-run word list, or resumed-run store. Existing backend word/history persistence from actual scoring still applies. `jt.runConfig.v1` still describes starter entry choices; existing successful-delete clearing suffices. Document this no-extra-storage boundary in PRIVACY.

### Existing backend behavior and public limits

All takes use existing `/api/score` short mode. `backend/app/main.py:488–499` identifies a single-word reference and calls `record_word_practice`; there is no new frontend SRS write or backend endpoint. It updates the existing word's practice history/schedule and may add a previously unknown word. SRS's configured graduation rule is independent of the game's ≥85 chain: storage currently uses **strictly greater than** graduation_score, not ≥85 by definition. At the default 85 threshold, an 85 can be Great in the game without being an SRS success.

The score endpoint returns NoMatch before session/SRS persistence. Other responses may already update SRS even if the client later treats the pronunciation as unjudged; the backend does not use the run reducer's judgeability or first-reading latch. Each real submitted single-word score can update SRS, including an eligible retry, while the game's points still count only the first valid reading. Local rejects send nothing. Cancellation or an unknown network outcome cannot undo a backend update already performed; do not claim guaranteed “not saved” or automatically resend.

**Sentence scoring does not increment word-practice SRS.** Its existing separate collection path can add/update flagged vocabulary, but is not the single-word spaced-review success path. A sentence target used later as an isolated words-run prompt then qualifies for single-word SRS behavior. Keep candidate-save labels honest and do not interpret a score response as confirmation of every collection/update.

In public mode, `_word_slots_left` (`main.py:503–506`) counts bank capacity, including graduated rows. At zero slots, the endpoint still scores and updates an already-known word; for an unknown seed it suppresses the new word-bank update while returning the score/session. At positive capacity a new seed may be stored; capacity can change during a run. There is no capacity reservation and no score refund merely because the word was not saved. Do not disable known-word practice because the bank is full, and never show “Added”/“SRS updated” per word without response evidence that the current API does not provide. When relevant, say “Your word bank is full. New words may not be saved; scores still count.”

Normal public score-attempt and recording-duration limits still apply: up to 8/16 counted scores, with no preallocation or automatic shortening. Fewer than N scores left can lead to quota-ended partway through; usage is not a completion promise. Word-bank capacity and score quota are different limits. Personal words' Coach audio keeps existing visitor/private cache handling; no assumption that all reference listening is a shared-cache hit or free synthesis.

## Content expansion

Expand from 30 to 60 project-original, AI-drafted items: five phonemes, each with four Warm-up words, four Focus words, and four In-context sentences. No CEFR, level, or new difficulty metadata.

1. A1 delivered and the owner approved exactly 30 additions in r1 (`ceb6144`): two per stage per phoneme. The delivered review table combines existing 30 and new 30, with stable ID, existing/new, phoneme, stage, text, target word, target sound position and approval status. Use initial/medial/final or an explicit combination where needed; sentence position is a separate concept.
2. The approval record covers all existing and new rows of r1, despite historical draft labels still present in the table. A5 reconciles those labels/provenance with the recorded approval; do not ask for the same approval again. Any subsequent wording change requires review of that changed text.
3. With approval now recorded, A5 integrates the final 60 into `starterPack.json`, the backend `GAME_STARTER_TEXTS` allowlist, tests, and `CONTENT-PROVENANCE.md`. Rejected additions stay out of runtime. Draft tables are not loaded by the application.
4. The whole v3 cut merges to main only after A5 integrates the approved pack and final checks pass. No partial release or availability flag. Before A5 runtime integration, the feature branch can complete B5 using the real production pack for all three six-item configurations and a `vi.mock`-injected synthetic 60-item pack for Route 12. This is test-only evidence, not production Route 12 approval. Against the actual 30-item pack, a starter twelve-item start must throw before clearing old results; never repeat, invent, or silently shrink content.

### Starter deck construction

One focus phoneme per starter run; stages stay in Warm-up → Focus → In context order. Six-item runs select two of four eligible starter items per stage using a stable runId seed. Selection changes membership, not presentation order: sort the selected subset back into the pack's canonical order. Twelve-item runs use four slots per stage.

Warm-ups still prioritize eligible previous-run weak words, then due words, then enough seeded starter warm-ups to fill two or four slots. Deduplicate normalized single-word candidates and full prompt texts within the run. The personal-warm-up exclusion set contains the full phoneme group's starter word rows and **every context targetWord**, including context items not sampled into this run. Twelve slots do not promise twelve target-phoneme texts when personal warm-ups replace starter words; those personal prompts retain their honest metadata.

The A1 draft pairs some context targets with focus words at pack level. Six-item sampling does **not** require `context-3` and its matching focus word to be selected together (nor any other context/focus pair). Independently sample each stage; do not introduce a pairing constraint that changes the approved selection rule.

Same runId plus the same inputs yields the same frozen deck. A new seed may repeat a previous subset; do not promise novelty on every replay or randomize order to manufacture it. Use stable unique slot IDs through `warmup-4`, `focus-4`, and `context-4` where applicable. Deck creation validates exact length and per-stage counts before Start is accepted.

New starter texts join the public shared TTS cache allowlist. Cache hits can avoid synthesis; cold or insufficient cached entries may still require it. Hear it first is not advertised as universally free. Existing public score-attempt, duration, and TTS limits remain unchanged.

## Screens

### Entry

Use a three-way selector labelled **Route / Target 60 / Target 85**; accessible names include “Challenge, target 60/85.” Only Route shows `[6] [12]` length chips. Do not offer a settings dialog or an invalid Challenge 12 combination.

One explanation line states length and target/hearts. In public mode it does not repeat the maximum score count, which appears only in the usage line; personal mode may retain that cost explanation. Remove the six decorative placeholder stones. Retain sound preview, configuration-specific Best, Sound, Auto-stop, and Start. Use “Start Challenge” for either target and “Start Route” for Route; Best labels include “Best · /θ/ · Route 12” or “Best · /θ/ · Target 85”. At the same viewport/text settings, the card must not exceed the existing baseline height; use actual before/after measurements, not a new arbitrary height promise. All hit targets are at least 44 px; no horizontal overflow.

Remember last selection and last Route length in one new key, `jt.runConfig.v1`, storing `{selection: "route" | "target60" | "target85", routeLength: 6 | 12}`. Defaults are Route and 6. Selecting Challenge preserves the remembered Route length. Parse only known values; blocked/corrupt storage falls back without blocking practice. Disable mode/length changes while starting; after a failed initial Start the choices become available again. A changed preference never changes a starting or active run. This key remembers starter entry choices only; the Words page uses an in-memory length choice, default 6, and does not overwrite it.

Include this key in `clearRunStorage` and `PRIVACY.md`. Delete my data clears game keys only after successful server deletion, leaves them on server failure, and preserves unrelated local storage. Preference persistence is not a saved/resumable run.

Public usage reads **“Up to N scores · M left today”**, where N is 8, 16, 8, or 10 and M is the existing attempt-count availability. It reserves nothing and does not promise sufficient duration/TTS quota. Never shrink a chosen run automatically. Ordinary recording/scoring and an accepted start continue to disable opening another run.

### Ready, recording, and feedback

Header identifies `Route · 12 items · /θ/` or `Challenge · Target 85 · /θ/`. Display item position against the planned total. Keep Pause, preferences, ring, stable bottom Record/Stop, Cancel take, and manual fallback. Route Ready places a Hear it first capsule below the ring with “Optional · Record works any time”; playback follows an explicit listening action, and Record next is an explicit recording action in approved variant B.

Target 85 rescue and heart-loss screens show the tier and target outcome separately as above. An internal `relisten` verdict for an 80 must not leak a user-facing Re-listen tier label: it remains Good on the run screen, stones, review, and live region. Live announcements use the same final values, including the target. First-reading points and chain are final from frame zero. Technical rejection copy and “Use manual Stop” retain v2 semantics.

### Stones: six or twelve

Retain 28 px hexagons and labelled Warm-up / Focus / In context groups. Six uses 2+2+2. Twelve uses four per group, with a 2×2 arrangement inside each group as the initial narrow-screen layout. Preserve source/DOM order within each group and allow further responsive wrapping without sideways scrolling.

Fill remains the first valid tier. Only `saved` gets the orange `#FB923C` rescue outline. A confirmed `heart-lost` gets a distinct red cracked outer mark plus an accessible “one heart used” label over that original fill. No mark for a mere first below-target reading or cannot-confirm. Keep dashed skips, unjudged stripes, and pending marks. Do not introduce a second tier palette or a Target 85 theme.

Decorative stones need no enlarged interaction area; any review navigation using them must have a ≥44 px hit area. Labels retain ordinal, prompt, first-reading tier/score, rescue/heart outcome, and unresolved status without hiding the first-reading fact.

### Summary and review

Route leads with **Practised n/N**, counting slots with a valid first reading once, not number of attempts or reached slots. If some items are unscored, say so. Place one evidence-backed next-step suggestion next to the headline. Without evidence, starter Route offers the labelled next sound; words Route suggests another bank-based run through Play again, never a fictitious weakness or IPA. Remove the large Route rating ring. Show points, rating/Not rated and chain in three compact tiles as in the approved mockup; starter PB receipt/badges remain secondary and words runs omit all PB UI.

Challenge leads with **Cleared / Failed / Incomplete**, target, and hearts. Rating remains a separate game fact. Review continues to expose matching recordings, first vs rescue readings, actual candidate-save statuses, and shared You/Coach playback.

Summary scores adapt to N: six columns × one row for six, up to six columns × two rows for twelve, reducing columns when text/width requires. Preserve v2's CSS fade durations: score cells take 240 ms and badges take 300 ms. Cell reveal **starts** span 650–1150 ms, `step=500/(N−1)` ms; badges start at 1250 ms. Thus the last cell starts at 1150 and finishes at 1390 ms, while badges finish at 1550 ms. “Badges no earlier than the last stone” compares start times, not completed fades; overlap is intentional. N=6 timing is unchanged, and N=12 does not lengthen the sequence. All underlying values and accessible facts are final immediately.

Review, Play again, Next sound (starter Route Summary), the revisit-words action, and Done remain usable throughout decoration. Starting a new run disables only competing start actions; Done still cancels. One screen owner retains all terminal restart failures across Summary → Review. Review's existing Play again and Done remain available, with configuration-correct cost copy.

The approved starter Route Summary footer places See review and Play again side by side, Next sound full-width below, and usage/Done on the final row, as in [the Route Summary mockup](game-mode-v3-mockup/Route-Summary.png). This decision is settled. The newly added words-to-revisit action lives in the scrollable next-step area above this footer, avoiding a fifth fixed-footer button. Words Route omits the Next sound row; Challenge retains its existing footer and gains the same scrollable words action. All actions remain reachable at 390×667/large text with ≥44 px targets.

### Approved mockup details

Use variant B, the Ready capsule/helper line, the three compact Route summary tiles, Challenge Start label, explicit Best variants and heart-lost red ring plus crack. Copy follows the approved mockups except the lead's explicit removal of duplicate public “up to N scores” explanation. Mockup illustration scores are not scoring fixtures; the real selectors determine numbers. The words entry/header/summary addition requires responsive evidence, but does not reopen the approved starter layouts.

## Accessibility, motion, and sound

- One run live region announces each accepted semantic change once, using the persistent consumed-feedback IDs. Rolling digits and decorative marks are hidden from accessibility APIs. Do not announce both “Good” and a contradictory generic low-score label.
- Selection controls expose checked state and support standard keyboard radio navigation; length chips have explicit names. Preserve focus through layout updates. The Quit dialog retains focus containment, inert background, Escape behavior, and returns to the paused screen on cancellation.
- Keep game styles scoped to run surfaces. Ordinary score colors and explicit Score flow are unchanged. IPA never inherits uppercase styling.

| Element | Normal motion | Reduced motion |
| --- | --- | --- |
| Ready ring/current stone | Existing breath | Static |
| Recording level/silence arc | Functional telemetry | Direct functional updates, no easing |
| Scoring arcs | Existing orbit | Static scoring indicator |
| Score/points | Existing brief roll; final semantic value from frame zero | Final number immediately |
| Rescue/heart marks | Existing bounded emphasis/crack | Static, readable marks |
| Summary scores/badges | N-aware bounded sequence | All final immediately |

No new sound assets or per-stone sound cascade. Preserve verdict-based SFX: first below-target rescue prompt is quiet even if the tier is Good; confirmed loss uses heart, saved uses rescue-saved, passed/practised use existing tier cues. Summary fanfare follows actual rated status and rating, never points alone. Mute does not suspend the shared AudioContext. No cue or reference audio may play into an open microphone; paused transitions remain silent even when the result ends the run.

## Preserved v2 boundaries

Auto-stop parameters and stop decisions are unchanged, including opening replay/onset precedence, gap/context invalidation, manual Stop ≥450 ms never vetoed by VAD, capture identity, one stop/submit, and microphone release. Start/Play again/Next sound synchronously prepare audio within the gesture before awaiting data. Starter stats/vocabulary fetch failures retain the starter-deck fallback. Words runs require a fresh word-bank fetch and fail visibly if it fails; they never substitute starter prompts.

Hidden active runs pause and discard unsubmitted takes; returning visible requires explicit Resume. Terminal Summary/Review never becomes paused but playback stops on hide. Quit retains results; exit/Done invalidates pending work and releases owned URLs. A persistent controller owns all of this above conditional screens. Ordinary practice keeps explicit Score and protects newer contexts from older responses/finally blocks.

## Non-goals

No Route 3, Challenge 12, 10/15 items, arbitrary difficulty/ratio sliders, CEFR/level fields, timers, changed hearts, changed Target 60 extra pool, automatic target adjustment, automatic sound rotation, weakest-sound alternation, random presentation order, generic settings panel, new theme, VAD tuning, microphone keep-warm, backend API/quota changes, server PB/history, or rules-version bump. No claim that an owner pilot establishes scorer fairness or general device support.

## Verification and device checklist

Automated checks must cover the four configurations, all worked examples, raw boundaries, exhausted/shared extras, refunds exactly once, old PB keys, frozen receipts, content approval/allowlist parity, seeded membership with stable order, audio races, and ordinary Score. These are planned checks, not results.

Record device/browser/OS, viewport/text size, input, settings, revision, and observed evidence. Start every row as **Not verified**; owner reports, automated checks, and direct observations remain distinct.

- [ ] iOS Safari and desktop Chrome: complete Route 6, Route 12, Target 60, and Target 85; confirm summary/review and replay/Done.
- [ ] Target 85 owner pilot: record first readings, rescues, heart losses, cannot-confirm reasons, and subjective experience over several runs. Observations locate problems; they never automatically lower 85.
- [ ] Hear it first: cold and cached TTS, loading → Record, playing → Record, TTS failure, rapid taps, hidden page, and delayed completion after exit; no playback in the open mic.
- [ ] Existing auto-stop/manual/cancel behavior: quiet/immediate speech, final fricatives, sentence pauses, noise/fallback, and microphone indicator release. Preserve known energy-endpoint limitations rather than claiming them fixed.
- [ ] Twelve stones and Summary at 390×844, a short viewport (for example 390×667), narrow width, large text, and reduced motion; controls reachable, no sideways scroll, badge reveal starts after the last cell reveal starts with the existing fades retained.
- [ ] VoiceOver/keyboard: named mode/length groups, target vs tier announcements, heart-lost stone, one live region, review navigation, Quit focus containment.
- [ ] Pending Play again/Next sound → Review → error/retry; pending action → Done; hidden → visible; no stale route, error, audio, or receipt update.
- [ ] Legacy personal PB survives upgrade; four buckets stay separate; first/tie/new-best/expiry and successful/failed Delete my data behave honestly.
- [ ] My words 6/12 from Words and every mode's Summary: due/low-score order, first-valid seeds, no graduated filler, exact-N shortage, frozen deck, no IPA/PB/Next sound, and ordinary Start review still using explicit Score.
- [ ] Full public bank: known-word SRS updates vs unknown-seed scores without insertion; NoMatch, sentence-vs-word behavior and 85 game/SRS distinction. Separate mocked backend evidence from actual trial observations.
- [ ] Words entry error survives navigation; revisit failure survives Review, retry preserves action/length, Done suppresses late work. New action is reachable on short screens without expanding the fixed starter footer.
- [ ] Ordinary word/sentence/Long Passage practice, explicit Score, score-before-collection display, late old response, and Generate drill remain intact.

Content approval is recorded in ceb6144; runtime integration and device verification remain separate. Unavailable device checks stay explicitly Not verified.
