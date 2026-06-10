# Targeted Phoneme Drills Design

## Goal

Close the personalization loop: the insights panel already tells the learner which phonemes are weak, but the learner has to invent practice content alone. This enhancement generates short drill passages dense in a chosen weak phoneme, saves them as practice materials, and feeds them into the existing record-and-score flow.

## Current Problems

- `GET /api/phoneme-stats` and the insights panel surface weak phonemes, but there is no action attached to a weak phoneme beyond reading the static articulation guide.
- The material library only contains built-in packs and manually imported JSON, so practicing a specific phoneme means hunting for suitable sentences elsewhere.
- The LLM endpoint configured for passage checks is idle outside of that single feature.

## Recommended Scope

One focused capability: a "Generate drill" action on each weak phoneme in the insights panel.

1. Backend endpoint `POST /api/drills/generate` that takes a phoneme and asks the configured OpenAI-compatible LLM for a drill passage dense in that phoneme.
2. Generated drills are stored as ordinary materials in a dedicated "Phoneme Drills" pack, so the existing library UI, selection flow, TTS playback, scoring, and group deletion all work unchanged.
3. The insights panel gains a generate button per phoneme row; on success the new drill is loaded into the passage input, ready to record.

Out of scope for this version: minimal-pair interactive mode, prosody word-level feedback, unscripted free talk, difficulty levels, and regeneration history. These stay on the backlog below.

## User Experience

- In the insights panel, each phoneme row with attempts shows a small "Drill" button next to the existing guide toggle.
- Clicking it shows a busy state on that row, then loads the generated passage into the passage input and refreshes the material library, where the drill appears under the "Phoneme Drills" group titled like `/θ/ drill · Jun 11`.
- If the LLM endpoint is not configured, the button is hidden (same readiness signal the passage check uses).
- Failures show the existing inline error style in the insights panel; nothing is saved on failure.

## Backend Design

- New module `backend/app/drills.py`, modeled on `passage.py`: one function `generate_drill(settings, phoneme) -> dict` that posts to `{llm_base_url}/chat/completions` with `response_format: json_object`.
- Prompt asks for JSON with `title`, `passage` (3–5 sentences, 40–70 words, everyday vocabulary, high density of the target phoneme), and `focus_words` (the words containing the phoneme).
- Seed words: the endpoint looks up the learner's lowest-scoring words for the phoneme (the `example_words` already aggregated by `list_phoneme_stats`) and instructs the LLM to build the passage around those exact words plus same-sound neighbors. This converts the task from phonetic knowledge (where small local models confuse the letter "i" with /ɪ/) into pattern imitation, which they handle well.
- Validation: reject responses missing `passage`, longer than ~600 characters, or whose `focus_words` is not a list of strings. Raise `RuntimeError` with a stable message, mapped to HTTP 502 like passage check failures.
- Storage: reuse the materials tables. Ensure a `phoneme-drills` material pack exists, then insert one material with the generated title, the passage as content, and the phoneme stored in the existing book/tag-style grouping column so drills for one phoneme group together.
- Endpoint returns the created material in the same shape as `GET /api/materials` rows so the frontend can use it directly.
- The LLM call stays synchronous like `check_passage`; the known async-blocking issue is tracked in the review doc and should be fixed for both call sites together, not piecemeal here.

## Frontend Design

- `api.ts`: `generateDrill(phoneme: string): Promise<Material>`.
- `usePhonemeInsights`: add `generatingPhoneme: string | null` and a `generateDrill(phoneme)` callback that calls the API, then signals the app to refresh materials and select the new drill.
- `InsightsPanel`: render the button only when the server health response reports passage check configured (already exposed via `/api/health`); disable other rows' buttons while one generation is in flight.
- `App.tsx` wires the success callback to the existing material-selection path so the passage input, TTS, and scoring need no changes.

## Error Handling

- LLM not configured: endpoint returns 503 with the same "not configured" message pattern as passage check; frontend hides the button based on health info, so this is a fallback.
- LLM returns malformed JSON or an over-long passage: 502 with a user-readable message; insights panel shows it inline and clears the busy state.
- Duplicate generations are allowed; each click appends a new material. Cleanup uses the existing material group deletion flow.

## Testing

- Backend: unit tests for `generate_drill` against a fake transport (valid response, malformed JSON, missing fields, oversized passage), and API tests for `POST /api/drills/generate` covering success persists a material, not-configured 503, and upstream-failure 502.
- Frontend: tests for `generateDrill` API call, insights panel button visibility (configured vs not), busy state, and the success path selecting the new material.

## Backlog After This

In recommended order:

1. **Word-level prosody feedback.** Azure already returns per-word `UnexpectedBreak` / `MissingBreak` / `Monotone` feedback when prosody assessment is on, and `scoring.py` currently discards it — only the aggregate prosody number is kept. Surfacing it is pure plumbing with no new dependencies.
2. **Minimal-pair drill mode.** Use the N-best phoneme output ("you said /s/ instead of /θ/") to pick the contrast pair, then reuse this feature's generator with a minimal-pair prompt.
3. **Unscripted free-talk mode.** Azure PA unscripted mode plus LLM coaching on the transcript; biggest scope, needs its own design doc.
