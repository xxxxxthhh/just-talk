# Game Mode v2 Acceptance (Track B)

Layout and verification evidence for the v2 run interface ([design](../design/game-mode-v2.md), [plan](../development/game-mode-v2-implementation-plan.md), Task 9). Each line records what was actually run. Anything not run is marked **not verified**. Passing jsdom tests and headless renders are not proof of real layout on a device, browser audio policy, or latency.

The owner's device pilot (iOS Safari, desktop Chrome, auto-stop, audio, VoiceOver on a device) is recorded in the [device checklist](game-mode-v2-device-checklist.md). This document does not repeat its rows.

## Automated checks

Run from the repository root at `2517246` with a clean working tree. Tests use mocks and fake services; nothing calls Azure, TTS or an LLM.

| Command | Result | Date / commit |
| --- | --- | --- |
| `git status --short` | Empty (clean tree) | 2026-10-08 / `2517246` |
| `git diff --check` | Exit 0 | 2026-10-08 / `2517246` |
| `npm --prefix frontend test -- --run src/game src/hooks/useRecorder.test.tsx src/usePracticeSession.test.tsx src/hooks/usePracticeRun.test.tsx src/hooks/useSpeech.test.tsx` | 12 files, 143 tests passed | 2026-10-08 / `2517246` |
| `npm --prefix frontend test -- --run src/components/RunRing.test.tsx src/components/RunStones.test.tsx src/components/PracticeRun.test.tsx src/components/RunReview.test.tsx src/components/RunMiniPlayer.test.tsx src/components/PublicGate.test.tsx src/mobile/MobileApp.test.tsx` | 7 files, 60 tests: 59 passed, **1 failed** (see below) | 2026-10-08 / `2517246` |
| `bash scripts/test.sh` | **Exit 1.** Ruff clean; 115 backend tests passed; lint 0 errors (7 warnings in files v2 did not touch); frontend 308 tests, 307 passed, the same 1 failed; the build step did not run because the script stops at the first failure | 2026-10-08 / `2517246` |
| `npm --prefix frontend run build` (run separately) | Exit 0 (TypeScript and Vite) | 2026-10-08 / `2517246` |
| `bash scripts/test.sh` (re-run after the B4 fixes) | **Exit 0.** Ruff clean; 115 backend tests passed; lint 0 errors (same 7 warnings); 30 files, 314 frontend tests passed; build succeeded | 2026-10-08 / `837a479` |

**Known failure at `2517246`, resolved at `837a479`:** `RunReview.test.tsx` › "pausing a mounted review stops and blocks playback, and resume never replays". Core's `a831e26` made PAUSE a no-op in summary and review, so this test's premise no longer held. Following the lead's B4 decision, `d54e749` replaced it with a document-hidden test and two full-app tests (Quit → See review → You plays; completed review survives hidden → visible without replaying).

## Layout evidence

### Method

- **Harness, not the live app.** Each state is rendered by the real `PracticeRun`, `RunReview` and `RunHero` components with the committed `styles.css`, `mobile.css` and `game.css`, inside the real mobile shell (`.m-app` → `.m-screen-slot` → `.m-practice.m-run-surface`, tab bar hidden as during a run). Run states come from the real reducer and selectors via `frontend/src/components/runV2Fixtures.ts`. Reduced motion is on, so every frame is a final state. There is no backend, recorder or live telemetry. The recording frames use fixed telemetry (level 0.62, silence 0.35, 1.2 s).
- **Exact viewports.** Headless Chrome 153 (new headless mode) enforces a 500 px minimum window width and reserves 87 px of window height, so `--window-size` alone cannot produce a 390 px viewport. Each state was loaded in an iframe of exactly the target size, and the page reported its own `innerWidth × innerHeight` to confirm it.
  - **390×844:** the target phone.
  - **390×640:** a short screen, about the height left on a small phone with browser chrome.
  - **Large-text proxy:** a 300×649 CSS viewport scaled 1.3×, which is what 130% page zoom gives on a 390×844 phone. Real Dynamic Type / browser text-size is **not verified** (see below).
- **Checks in each page.**
  - No document-level horizontal overflow.
  - No container that can scroll sideways.
  - Every thumb-zone or action button lies entirely inside the viewport.
  - Whether the middle area scrolls.
  - The ring's rendered width.
- Raw per-state results: [layout-measurements.tsv](game-mode-v2/layout-measurements.tsv).

### States covered

| | |
| --- | --- |
| Entry | Entry card (Route selected; Best 861 A; 14 scores left today) |
| Run | Ready, recording (auto-stop listening), recording (noisy fallback), scoring, paused, Quit confirmation |
| Verdict | Perfect 98 with ×3 chain, 84.9 Good boundary, NoMatch, local no-speech rejection with Use manual Stop, sentence still collecting words |
| Rescue | Rescue before reference load, rescue after load, heart lost (46 → 52), rescue saved (46 → 72) |
| Summary | Rated A with new best, cleared C ("Logged."), out of hearts (Not rated) |
| Review | Rated A, out of hearts |

### Results

All 21 states × 3 viewports = 63 renders pass every check at `2517246`.

| Check | 390×844 | 390×640 | 130% zoom |
| --- | --- | --- | --- |
| Horizontal overflow / sideways scroll | None | None | None |
| All thumb-zone and action buttons on screen | 21 / 21 | 21 / 21 | 21 / 21 |
| Middle area scrolls (content below the fold) | 4 states: rated and cleared-C summaries, both reviews | 13 states: verdicts, rescues, heart lost/saved, sentence collection, summaries, reviews | Same 13 states |
| Ring diameter | 200 px | 166 px (26dvh) | 169 px (26dvh of 649) |

Contact sheets (reduced motion, final frames):

- [390×844](game-mode-v2/run-states-390x844.jpg)
- [390×640](game-mode-v2/run-states-390x640.jpg)
- [130% zoom](game-mode-v2/run-states-zoom130.jpg)

**Defects this evidence found, fixed in `2517246` before the final capture:**

- At 130% zoom, the heart-lost and rescue-saved screens pushed their thumb-zone buttons off screen. The long next-sentence preview (`nowrap`) widened the thumb zone, because grid children default to `min-width: auto`, and the run surface scrolled sideways.
- On every run screen, the middle area could be scrolled sideways, because the ring's glow extends past the column.

**Observations (not failures):**

- The entry card is about 495 px tall, versus the design's 220–260 px. The lead accepted this for now, pending the final browser check.
- At 390×844 the summaries keep "One thing to revisit" partly below the fold. The middle scrolls to it, and the summary buttons stay fixed.
- At 130% zoom, the review's score bar wraps its headline into a narrow column beside the jump stones. It is readable but cramped, a polish candidate.

## Not verified

These remain gaps. None is implied by the evidence above.

- **Real devices and the live app:** any screen on an iPhone or in desktop Chrome with the real backend, recorder, live telemetry and cues. This is the owner's pilot in the device checklist.
- **Real large text:** iOS Dynamic Type and browser text-size settings. Run typography is set in `px`, so it may not follow text-size settings at all. 130% page zoom is only a proxy.
- **VoiceOver:** no screen reader was run. Only jsdom checks of accessible names, the single live region and focus were done.
- **Normal-motion visuals:** ring breathing, pop, score roll, Perfect sweep and particles, heart pulse and crack, summary sequence, and the out-of-hearts overlay. Renders were reduced-motion final frames; the `prefers-reduced-motion` media query was not exercised on a device.
- **Safari SVG paint:** the striped (unjudged) and gold-gradient (Perfect) stone fills reference a shared hidden SVG; they render in Chrome only.
- **Safe-area insets** (notch, home indicator), landscape, and widths other than 390 (320, 428).
- **The entry card in its full Practice screen context.** It was rendered inside the practice scroll container in isolation, without the material header and recorder below it.
- **Quit dialog with a real keyboard and screen reader:** `837a479` contains Tab/Shift+Tab inside the dialog and marks the rest of the run `inert` (tested in jsdom with simulated keyboard). Real browser `inert` behaviour and VoiceOver reading of the alert dialog are not verified.
- **Later changes not re-captured:** the screenshots and measurements are from `2517246`. Later commits (`d54e749`, `6f78e48`, `837a479`) add the entry card's "Starting…" label and start-error line and change behaviour only; the captured states' layout CSS is unchanged.
