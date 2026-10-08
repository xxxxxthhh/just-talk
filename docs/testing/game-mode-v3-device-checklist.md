# Game Mode v3 Device Checklist

The owner's real-device pilot for Game Mode v3 ([design](../design/game-mode-v3.md), [plan](../development/game-mode-v3-implementation-plan.md), Real-device checklist). Every row starts as **Not verified**. A row changes only after that check has been run on that device. Mocked tests, headless renders and the passing automated suite are not device evidence, and v2's pilot does not carry over to v3.

- **Automated checks and layout evidence:** [game-mode-v3-acceptance.md](game-mode-v3-acceptance.md) (Track B).
- **Core checks:** [game-mode-v3-core-checks.md](game-mode-v3-core-checks.md) (Track A).

iOS Safari and desktop Chrome are the pilot targets. No general device-support claim follows from two devices.

Scoring calls are manual and intentional, within the available trial quota. Never retry an unknown submission automatically. Don't publish private words, recordings or local storage contents in the evidence.

## Build under test

Automated baseline: `bash scripts/test.sh` exits 0 at `6a84702` (see the acceptance record). Record the commit you actually deploy for the pilot in each session row.

## Session record

Fill in one row per pilot session. Every result row below refers to a session here. Observer is **direct** (you watched it happen) or **report** (someone told you).

| Session | Date | Browser / OS | Viewport / text size | Input device | Sound | Auto-stop | Observer | Build commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | | iOS Safari | | | | | | |
| S2 | | Desktop Chrome | | | | | | |

## Auto-stop parameters in this build

Unchanged from v2; the table and known limits are in [game-mode-v3-core-checks.md](game-mode-v3-core-checks.md) and [game-mode-v2-device-checklist.md](game-mode-v2-device-checklist.md). If the pilot uses different values, record them here.

## Results

Status values: **Pass**, **Fail**, **Not verified**. For auto-stop rows, record the stop reason you observed (silence, no-speech, short-voice, auto-cap, hard-cap, manual). For every row, record where the evidence is (screen recording, screenshot, notes).

### The four starter configurations

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| Route 6: entry → every item → Summary → Review → Play again → Done | Not verified | Not verified | | |
| Route 12: the same, with twelve stones in 2×2 groups and a twelve-cell score grid | Not verified | Not verified | | |
| Target 60: the same, including a rescue and a heart loss below 60 | Not verified | Not verified | | |
| Target 85: the same, including a rescue below 85 | Not verified | Not verified | | |
| Personalised warm-ups appear when the bank has due or weak words | Not verified | Not verified | | |
| All five sounds over several runs; Next sound follows θ → ð → ɹ → l → v → θ, including the v → θ wrap | Not verified | Not verified | | |
| The entry remembers the last choice and Route length after a reload; choosing a target keeps the Route length | Not verified | Not verified | | |

### Target 85 pilot

Several owner runs. Observations locate problems; they never lower 85 automatically. Mark each count as **real** (from actual scores) or **fixture** (seen only in the automated fixtures).

| Run | Session | First readings below 85 (rescues) | Rescues saved (e.g. 80 → 88) | Hearts used (e.g. 80 → 82) | Cannot-confirm (cause) | Outcome / rating | How it felt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| A first reading of 80 shows amber "80 GOOD" and "Below this run's target 85 · listen, then read again", never Re-listen | Not verified | Not verified | | |
| 80 → 82 reads "Both readings below 85 · one heart used"; the stone keeps amber with a red cracked ring | Not verified | Not verified | | |
| 80 → 88 reads "Heart kept · 80 → 88"; the first reading's points are unchanged | Not verified | Not verified | | |
| An exhausted rescue pool, an unjudged reading with the pool empty, and a reference that won't load each show their own cause, with no heart lost | Not verified | Not verified | | |

### Hear it first and Hear next first

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| Hear it first with cached TTS plays on tap; nothing plays by itself | Not verified | Not verified | | |
| Hear it first with cold TTS shows Loading…; Record works while it loads | Not verified | Not verified | | |
| Record while the reference is playing stops it before the microphone opens | Not verified | Not verified | | |
| A TTS failure shows "Couldn't load it · Record works any time"; Record still works; Hear it first retries | Not verified | Not verified | | |
| Skip, Pause, Quit or Done while the reference loads: no audio arrives later, and nothing plays into an open microphone | Not verified | Not verified | | |
| Tapping Hear it first twice, then Record: no overlapping audio | Not verified | Not verified | | |
| Hear next first moves on once and previews the next item; Record next records without a preview | Not verified | Not verified | | |
| You never have to wait for the reference to end | Not verified | Not verified | | |

### Auto-stop and manual Stop (unchanged from v2)

| Check | iOS Safari | Desktop Chrome | Observed stop reason | Evidence |
| --- | --- | --- | --- | --- |
| Immediate and quiet speech is detected and auto-stops | Not verified | Not verified | | |
| Final /θ/ and /s/ survive in the replay | Not verified | Not verified | | |
| Slow sentences; a ~1.05 s pause (record whether it stops early: a known limit) | Not verified | Not verified | | |
| Fan or TV: fallback, or a single bounded submission | Not verified | Not verified | | |
| No onset: "Didn't catch anything", no score call; a short onset: "Too short", no score call | Not verified | Not verified | | |
| Auto cap ends once; manual Stop at 0.4 s is rejected and at ≥0.45 s submits | Not verified | Not verified | | |

### Capture lifetime

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| A delayed permission prompt and a denial; rapid cancel and retry | Not verified | Not verified | | |
| Stop, then hide or lock: no late take reaches the run; Resume is explicit | Not verified | Not verified | | |
| Quit dialog while recording: the take is discarded and the results are kept | Not verified | Not verified | | |
| Play again, Next sound, a revisit run and Done: no old take reaches the new run or the ordinary preview | Not verified | Not verified | | |
| The microphone indicator turns off after each take and after exit | Not verified | Not verified | | |

### Audio

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| Mute persists across reloads and auto-stop still works when muted | Not verified | Not verified | | |
| iOS silent switch: record whether cues play | Not verified | n/a | | |
| Rescue: Coach, then Record again, in order | Not verified | Not verified | | |
| You ↔ Coach: only one plays at a time | Not verified | Not verified | | |
| No cue plays into an open microphone; no terminal cue when a result settles while paused | Not verified | Not verified | | |
| Haptics only where supported (none on iOS Safari) | Not verified | Not verified | | |

### Layout

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| The entry card is no taller than before v3 at the same text size | Not verified | Not verified | | |
| Twelve grouped stones and the Route 12 Summary at 390×844 | Not verified | Not verified | | |
| A shorter viewport with browser chrome visible (about 390×667) | Not verified | Not verified | | |
| A narrower width (about 320) | Not verified | Not verified | | |
| A long sentence prompt and large text: the middle scrolls, the thumb zone stays usable, the run title wraps instead of truncating | Not verified | Not verified | | |
| No sideways scroll anywhere; every control is easy to tap (≥44 px) | Not verified | Not verified | | |
| Review jump stones: 44×44 tap areas in rows of six; twelve items wrap 6+6, six items keep one row; each stone jumps to its reading | Not verified | Not verified | | |

### Motion and accessibility

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| Reduced motion: static decoration; the silence arc still works; final facts from the first frame | Not verified | Not verified | | |
| Summary: badges start fading after the last score cell starts (240 ms cells, 300 ms badges) | Not verified | Not verified | | |
| VoiceOver / keyboard: entry and Words-length radio names, arrow keys and one tab stop per group; one announcement per change | Not verified | Not verified | | |
| VoiceOver: target vs tier wording (an 80 is Good, below the target); the heart-loss stone reads "one heart used" | Not verified | Not verified | | |
| Quit dialog: focus stays inside; Escape and Keep paused return to the paused run | Not verified | Not verified | | |

### Restarts

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| Pending Play again or Next sound → See review → failure: the error stays on Review; Try again repeats the same action and sound | Not verified | Not verified | | |
| Pending restart → Done: no stale run, error or navigation appears later | Not verified | Not verified | | |
| The old results stay until the replacement run has started | Not verified | Not verified | | |
| Public usage reads "Up to N scores · M left today" with the real count, and no promise about recording time | Not verified | Not verified | | |

### Personal best and data

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| A v2 personal best still shows under Route 6 / Target 60 after the upgrade | Not verified | Not verified | | |
| Four separate buckets (Route 6, Route 12, Target 60, Target 85): first record, new best and a tie | Not verified | Not verified | | |
| Public best expiry (seven days) | Not verified | Not verified | | |
| Delete my data (success and failure): the stored choice and the game's keys are removed only on success | Not verified | Not verified | | |

### Ordinary practice

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| Word, sentence and Long Passage practice with explicit Score | Not verified | Not verified | | |
| Score shows before sentence collection; a failed collection keeps the score | Not verified | Not verified | | |
| A context switch with an old response in flight does not change the new context | Not verified | Not verified | | |
| Generate drill keeps its progress and errors | Not verified | Not verified | | |
| A run never opens the ordinary result panel | Not verified | Not verified | | |

### My words

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| Words page: 5 / 6 / 11 / 12 active words give the right Start and 6/12 availability and copy | Not verified | Not verified | | |
| A 6- and a 12-word run: due words first, then lowest scores; no graduated filler; the deck does not change mid-run | Not verified | Not verified | | |
| Header "My words · N words", one My words stone group, "Word bank" / "From this run" labels, no IPA and no Best | Not verified | Not verified | | |
| Summary shows points, rating and chain with no personal best and no Next sound | Not verified | Not verified | | |
| Start review stays separate and still uses explicit Score | Not verified | Not verified | | |
| Words entry: loading and error survive switching tabs; Cancel drops a late result | Not verified | Not verified | | |
| "Run with words to revisit" from Route, Challenge and My words Summaries: first readings below 85 lead, at the finished run's length (Challenge → 6) | Not verified | Not verified | | |
| Revisit → See review → failure → Try again; revisit → Done → nothing late | Not verified | Not verified | | |
| On a short screen the revisit action scrolls with the Summary; the footer keeps its four actions | Not verified | Not verified | | |
| Coach audio for personal words with a cold visitor cache: record TTS quota behaviour (twelve new references may run out of synthesis before scores) | Not verified | Not verified | | |

### Public trial boundaries

Fake-service tests cover these in the core record. Those tests are not device evidence.

| Check | iOS Safari | Desktop Chrome | Observed | Evidence |
| --- | --- | --- | --- | --- |
| With a full word bank, a known word still updates its review schedule; an unknown word is scored but not added | Not verified | Not verified | | |
| Score quota and word-bank capacity behave as separate limits | Not verified | Not verified | | |
| An 85 in a game can be Great without counting as a review success (graduation needs more than the configured threshold) | Not verified | Not verified | | |

The design's full-bank warning is not implemented: the API exposes no word-bank capacity, and the lead ruled it out of this cut. Nothing in the run claims a word was saved.

## Known limits to watch

- Energy endpointing cannot tell a thinking pause from the end of a sentence; a pause of about 1 s can stop a sentence early. Record it; don't tune VAD in this cut.
- Steady noise above the onset threshold reads as voice and runs to the auto cap.
- iOS Safari has no `navigator.vibrate`.
- Route 6 and Target 60 keep their v2 personal-best keys, but the 60-item pack changes which items those runs draw, so old and new bests are not like-for-like comparisons.
