# Pronunciation Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add correct-pronunciation playback, a persistent word bank, and usable history review to Just Talk.

**Architecture:** Extend the existing FastAPI + SQLite backend with vocabulary and TTS endpoints, then update the React app to consume those endpoints while reusing the existing recording/scoring flow. Keep the feature local-first and configuration-free beyond the existing Azure key and region.

**Tech Stack:** FastAPI, SQLite, Azure Speech SDK, React, TypeScript, Vitest, unittest.

---

### Task 1: Backend Vocabulary Storage

**Files:**
- Modify: `backend/app/storage.py`
- Modify: `backend/tests/test_storage.py`

- [ ] **Step 1: Write failing tests for vocabulary persistence**

Add tests that initialize the store, create a word, update it from a score, dedupe a repeated word, and delete it.

- [ ] **Step 2: Run the storage tests and verify failure**

Run: `PYTHONPATH=backend python3.11 -m unittest backend.tests.test_storage`

Expected: fail because vocabulary methods do not exist.

- [ ] **Step 3: Implement vocabulary table and store methods**

Add `vocabulary_items` schema plus `create_word`, `list_words`, `delete_word`, `record_word_practice`, and `create_words_from_session`.

- [ ] **Step 4: Run storage tests and verify pass**

Run: `PYTHONPATH=backend python3.11 -m unittest backend.tests.test_storage`

Expected: pass.

### Task 2: Backend API and TTS

**Files:**
- Create: `backend/app/tts.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`

- [ ] **Step 1: Write failing API tests**

Cover `GET /api/words`, `POST /api/words`, `DELETE /api/words/{id}`, `POST /api/words/from-session/{id}`, and `POST /api/speak` with a fake synthesizer.

- [ ] **Step 2: Run API tests and verify failure**

Run: `PYTHONPATH=backend python3.11 -m unittest backend.tests.test_api`

Expected: fail because endpoints and synthesizer injection do not exist.

- [ ] **Step 3: Implement TTS adapter and endpoints**

Add injectable speech synthesis, base64 audio response, and word bank routes.

- [ ] **Step 4: Run API tests and verify pass**

Run: `PYTHONPATH=backend python3.11 -m unittest backend.tests.test_api`

Expected: pass.

### Task 3: Frontend API and Weak Word Utilities

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/api.test.ts`
- Modify: `frontend/src/scoreUtils.ts`
- Modify: `frontend/src/scoreUtils.test.ts`

- [ ] **Step 1: Write failing frontend tests**

Cover session detail loading, word bank API calls, TTS API call, and weak-word sorting/deduping.

- [ ] **Step 2: Run frontend tests and verify failure**

Run: `cd frontend && npm test -- --run`

Expected: fail because functions and types do not exist.

- [ ] **Step 3: Implement frontend API functions and utilities**

Add typed functions for the new routes and the weak-word extractor.

- [ ] **Step 4: Run frontend tests and verify pass**

Run: `cd frontend && npm test -- --run`

Expected: pass.

### Task 4: Frontend UI

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Wire state and actions**

Load words on startup, fetch full session details from history, auto-refresh words after scoring, and add playback handlers.

- [ ] **Step 2: Add word bank and weak-word UI**

Render manual add, saved words, weak words, save buttons, delete buttons, and play buttons.

- [ ] **Step 3: Polish responsive CSS**

Keep the three-column desktop layout and make the sidebar/coach panels stack cleanly on narrow screens.

- [ ] **Step 4: Run frontend tests and build**

Run: `cd frontend && npm test -- --run && npm run build`

Expected: pass.

### Task 5: End-to-End Verification

**Files:**
- No planned code edits.

- [ ] **Step 1: Run full project verification**

Run: `./scripts/test.sh`

Expected: backend tests, frontend tests, and frontend build pass.

- [ ] **Step 2: Verify in browser**

Open `http://127.0.0.1:5173`, confirm Azure is ready, click history, inspect restored words, play correct pronunciation, add weak words, and select a word bank word for practice.

- [ ] **Step 3: Restart dev server if needed**

If the server was running before backend changes, restart `./scripts/dev.sh` so new endpoints are loaded.
