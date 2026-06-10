# Just Talk

Just Talk is a local-first pronunciation coaching app. It records speech in the browser, scores pronunciation with Azure AI Speech, shows word and phoneme feedback, plays standard pronunciation with Azure Text-to-Speech, and keeps a local word bank for targeted practice.

The app is designed for personal learning workflows: read a passage, inspect weak words, save them to the word bank, then drill one word at a time.

## Features

- Browser recording with a configurable duration limit.
- Short Drill mode for focused practice and Long Passage mode for continuous scoring.
- Azure Pronunciation Assessment scoring for accuracy, fluency, completeness, prosody, and overall pronunciation.
- Word-level and phoneme-level review, including likely heard alternatives when Azure returns them.
- Standard pronunciation playback for passages and selected words.
- Built-in original practice materials plus local JSON material import.
- Local history stored in SQLite.
- Local word bank for weak words and manual vocabulary practice, with in-progress and graduated views and spaced-repetition review scheduling (successful drills double the review interval; failures make the word due immediately).
- Optional passage quality check through an OpenAI-compatible LLM endpoint.

## Tech Stack

- Frontend: React, TypeScript, Vite, Vitest, Testing Library.
- Backend: FastAPI, SQLite, Azure Cognitive Services Speech SDK.
- Audio processing: browser `MediaRecorder` plus server-side ffmpeg conversion to 16 kHz mono WAV.

## Run

1. Install prerequisites:

- Python 3.11
- Node.js
- ffmpeg

2. Create a local environment file:

```bash
cp .env.example .env
```

3. Fill the Azure values in `.env`:

```env
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=...
```

`AZURE_TTS_VOICE` is optional and defaults to `en-US-JennyNeural`.

4. Start both services:

```bash
./scripts/dev.sh
```

5. Open http://127.0.0.1:5173.

The app records in the browser, sends the audio to FastAPI, converts it to 16 kHz mono WAV with ffmpeg, scores it with Azure, saves local history in SQLite, and can play correct pronunciation through Azure Text-to-Speech.

Short Drill is limited by `MAX_AUDIO_SECONDS` and uses Azure single-shot pronunciation assessment. Long Passage is limited by `MAX_LONG_AUDIO_SECONDS` and uses Azure continuous pronunciation assessment for longer readings. History rows restore full word and phoneme feedback. Low-scoring words can be saved into the local word bank, then clicked to practice one word at a time. Word drills graduate automatically after repeated scores above the configured threshold, and later low-scoring passage results move them back into the in-progress list.

## Material Import

The Materials panel includes a few original built-in passages and accepts local JSON imports. Imported materials stay in the local SQLite database and can be selected as the current passage.

Use `schema_version: 1`:

```json
{
  "schema_version": 1,
  "pack": {
    "id": "custom-pack",
    "title": "Custom Pack",
    "source": "user-imported",
    "license": "user-provided"
  },
  "lessons": [
    {
      "id": "custom-1",
      "title": "Clear Morning",
      "book": "Custom",
      "lesson": 1,
      "text": "A clear morning is a good time to practice careful speaking.",
      "tags": ["short", "custom"]
    }
  ]
}
```

Only import material you have the right to use. The project does not vendor third-party copyrighted course text or audio.

## Optional Passage Check

The passage check button stays disabled unless these are set in `.env`:

```env
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=...
LLM_MODEL=gpt-4o-mini
```

## Test

```bash
./scripts/test.sh
```

The test script runs backend lint (ruff) and unit tests (pytest), frontend lint (ESLint), unit/component tests, and a production frontend build.

## Project Layout

```text
backend/             FastAPI app, Azure adapters, scoring normalization, SQLite storage
backend/tests/       Backend unittest suite
frontend/            React/Vite app
frontend/src/        Frontend components, API client, types, and tests
scripts/dev.sh       Starts FastAPI and Vite together
scripts/test.sh      Runs backend tests, frontend tests, and frontend build
docs/materials/      Example material import files
docs/research/       Initial technical research and provider evaluation
docs/design/         Product and architecture design notes
docs/development/    Implementation planning notes
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `AZURE_SPEECH_KEY` | Yes | Azure AI Speech resource key. |
| `AZURE_SPEECH_REGION` | Yes | Azure AI Speech resource region, such as `eastus`. |
| `AZURE_TTS_VOICE` | No | Azure neural voice used for standard pronunciation playback. |
| `DATABASE_URL` | No | SQLite database URL. Defaults to `sqlite:///./data/just_talk.db`. |
| `MAX_AUDIO_SECONDS` | No | Recording duration limit for the current short-practice mode. |
| `MAX_LONG_AUDIO_SECONDS` | No | Recording duration limit for Long Passage continuous scoring. Defaults to `180`. |
| `VOCABULARY_GRADUATION_SCORE` | No | Score threshold a word must exceed to count as a successful drill. Defaults to `85`. |
| `VOCABULARY_GRADUATION_STREAK` | No | Consecutive successful single-word drills required before graduation. Defaults to `2`. |
| `LLM_BASE_URL` | No | OpenAI-compatible endpoint for optional passage review. |
| `LLM_API_KEY` | No | API key for optional passage review. |
| `LLM_MODEL` | No | Model name for optional passage review. |

## Notes

- Keep recordings at or under `MAX_AUDIO_SECONDS` because v1 uses Azure's single-shot scripted assessment path with miscue enabled.
- Do not put the Azure key in frontend code. The browser only talks to the local FastAPI backend.
- `.env`, local SQLite data, virtual environments, dependencies, and build outputs are intentionally ignored by git.
