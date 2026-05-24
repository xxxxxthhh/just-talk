# Pronunciation Coach Enhancement Design

## Goal

Turn Just Talk from a single-pass scoring screen into a coaching loop where the learner can hear the target pronunciation, identify weak words, save them to a word bank, and drill those words individually.

## Current Problems

- Clicking a history row does not restore the full scoring review, so past results cannot be inspected.
- The score panel shows word and phoneme data, but it does not summarize what the learner should practice next.
- The app has no way to play a correct pronunciation for the full passage or a selected word.
- There is no persistent word bank for targeted practice.

## Recommended Scope

Build a v1 loop with three focused capabilities:

1. Restore history details when a session is selected.
2. Add Azure Text-to-Speech playback for passages and individual words.
3. Add a word bank that is auto-filled from weak scored words and can also accept manual words.

The first version does not need accounts, cloud sync, spaced repetition scheduling, IPA dictionary lookup, or multi-accent voice selection. It should be immediately usable after the Azure Speech key and region are configured.

## User Experience

The main screen remains a work-focused three-column app:

- Left column becomes a practice sidebar with two sections: History and Word Bank.
- Middle column remains the passage recorder.
- Right column becomes the coaching panel.

After a passage is scored:

- The score grid remains visible.
- A "Needs practice" strip shows the lowest-scoring words first.
- Each weak word can be saved to the word bank.
- The learner can click a word to inspect phonemes.
- The learner can play correct pronunciation for the passage or selected word.

For word bank practice:

- The learner can add a word manually.
- Clicking a word sets the passage input to that word, so the existing record-and-score flow is reused.
- When a word is scored, its latest score and practice count are saved.

## Backend Design

Add storage support for vocabulary items in SQLite:

- `id`
- `word`
- `source`
- `notes`
- `latest_score`
- `practice_count`
- `last_practiced_at`
- `created_at`
- `updated_at`

Add API endpoints:

- `GET /api/words`
- `POST /api/words`
- `DELETE /api/words/{word_id}`
- `POST /api/words/from-session/{session_id}`
- `POST /api/speak`

`POST /api/speak` uses the same Azure Speech resource as pronunciation assessment. It returns base64 audio and a content type so the browser can play it without a separate file lifecycle.

## Frontend Design

Add API client functions and types for:

- Loading session details.
- Loading, adding, deleting, and auto-adding word bank items.
- Requesting speech audio.

Add utility behavior:

- `weakWordsFromResult(result)` returns low-scoring words sorted by ascending score.
- Duplicate words are deduped case-insensitively.

UI changes:

- History rows fetch and display full session details.
- A word bank section lists saved words with score and practice count.
- A manual add field saves a word.
- "Play correct" buttons appear for the passage and selected word.
- Weak words can be saved to the word bank.

## Error Handling

- If Azure is not configured, pronunciation scoring and speech synthesis return a clear 503 error.
- If TTS fails, show the backend error banner and keep the current recording state.
- If a duplicate word is added, update the existing item instead of creating a duplicate.
- If history loading fails, keep the current result and show an error.

## Testing

Backend tests cover:

- Vocabulary storage create/list/delete/update behavior.
- Weak words added from a session.
- TTS endpoint with a fake synthesizer.
- Missing Azure TTS configuration.

Frontend tests cover:

- API client functions.
- Weak word extraction.
- History detail loading support at API level.

Manual browser verification covers:

- History row restores scoring details.
- Passage and selected word playback buttons work.
- Weak words appear after scoring and can be added.
- Word bank words can be selected for individual practice.
