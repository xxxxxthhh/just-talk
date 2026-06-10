# Targeted Phoneme Drills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LLM-generated drill passages for weak phonemes, saved as materials and launched from the insights panel. Design: `docs/design/targeted-phoneme-drills.md`.

**Architecture:** New `drills.py` module modeled on `passage.py`, one new endpoint that persists into the existing materials tables, and a generate button in the insights panel that reuses the existing material-selection flow.

**Tech Stack:** FastAPI, SQLite, React, TypeScript, Vitest, unittest.

---

### Task 1: Backend Drill Generator

**Files:**
- Create: `backend/app/drills.py`
- Create: `backend/tests/test_drills.py`

- [x] **Step 1: Write failing tests for `generate_drill`**

Cover: valid LLM response returns title/passage/focus_words; malformed JSON raises `RuntimeError`; missing `passage` raises; passage over 600 characters raises; not-configured settings raise. Inject the transport the same way the passage-check tests fake the LLM.

- [x] **Step 2: Run and verify failure**

Run: `PYTHONPATH=backend python3.11 -m unittest backend.tests.test_drills`

Expected: fail because `drills.py` does not exist.

- [x] **Step 3: Implement `generate_drill`**

Mirror `check_passage` structure: build the chat-completions payload with a drill-generation system prompt, `response_format: json_object`, 30 s timeout, and validate the parsed result.

- [x] **Step 4: Run and verify pass**

Run: `PYTHONPATH=backend python3.11 -m unittest backend.tests.test_drills`

### Task 2: Drill Persistence and Endpoint

**Files:**
- Modify: `backend/app/storage.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_storage.py`
- Modify: `backend/tests/test_api.py`

- [x] **Step 1: Write failing tests**

Storage: `save_drill_material(phoneme, title, passage, focus_words)` creates the `phoneme-drills` pack on first use, inserts a material grouped by phoneme (book `/θ/`, focus words as tags), and returns the row in `list_materials` shape. API: `POST /api/drills/generate` success persists and returns the material and passes seed words from phoneme stats; 503 when LLM not configured; 502 when the generator raises; 400 for a blank phoneme.

- [x] **Step 2: Run and verify failure**

Run: `PYTHONPATH=backend python3.11 -m unittest backend.tests.test_storage backend.tests.test_api`

- [x] **Step 3: Implement storage method and endpoint**

Endpoint validates the phoneme parameter is non-empty, looks up seed words (the learner's lowest-scoring words for that phoneme from `list_phoneme_stats`), calls `generate_drill`, persists, and maps errors per the design.

- [x] **Step 4: Run and verify pass**

Run: `PYTHONPATH=backend python3.11 -m unittest backend.tests.test_storage backend.tests.test_api`

### Task 3: Frontend API and Insights Hook

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/api.test.ts`
- Modify: `frontend/src/hooks/usePhonemeInsights.ts`

- [x] **Step 1: Write failing tests**

Cover `generateDrill(phoneme)` request shape and error propagation, and the hook's `generatingPhoneme` busy state transitions on success and failure (new `usePhonemeInsights.test.tsx`).

- [x] **Step 2: Run and verify failure**

Run: `cd frontend && npm test -- --run`

- [x] **Step 3: Implement API function and hook changes**

Hook exposes `generateDrill(phoneme)` and invokes an `onDrillCreated(material)` callback supplied by the app. No `types.ts` change was needed — the endpoint returns the existing `MaterialItem` shape.

- [x] **Step 4: Run and verify pass**

Run: `cd frontend && npm test -- --run`

### Task 4: Insights Panel UI and App Wiring

**Files:**
- Modify: `frontend/src/components/InsightsPanel.tsx`
- Modify: `frontend/src/components/InsightsPanel.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [x] **Step 1: Write failing panel tests**

Button hidden when passage check is not configured; busy state disables other rows; failure renders inline error.

- [x] **Step 2: Implement button and wiring**

`App.tsx` passes configured-state from health info and an `onDrillCreated` handler that refreshes the material list and selects the new drill into the passage input. The button lives in `ExpandedPhonemeDetails`, so it appears in both the map and priority views when a phoneme is expanded.

- [x] **Step 3: Run tests and build**

Run: `cd frontend && npm test -- --run && npm run build`

### Task 5: End-to-End Verification

- [x] **Step 1: Manual loop check**

Verified against the live backend (uvicorn on a test port) with Ollama `qwen3:4b-instruct`: `POST /api/drills/generate` for the learner's weakest phoneme /ŋ/ pulled real seed words (wrong, songs, speaking, sang), generated a natural passage in ~5 s, and persisted it under Phoneme Drills; group delete by book removed it. Prompt was tightened after the first live run to forbid meta-text about phonetics in the passage. Record-and-score and the hidden-button-when-unconfigured path are covered by unit tests.

- [x] **Step 2: Full test pass**

Run: `PYTHONPATH=backend python3.11 -m unittest discover backend/tests && cd frontend && npm test -- --run && npm run build`

Result: 77 backend + 86 frontend tests pass, ruff clean, production build succeeds.
