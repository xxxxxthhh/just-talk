# Just Talk

Just Talk is a pronunciation coaching app for English learners. It records speech in the browser, scores pronunciation with Azure AI Speech, shows word and phoneme feedback, plays standard pronunciation with Azure Text-to-Speech, and keeps a word bank for targeted practice.

Practice loop: read a passage, inspect weak words, save them to the word bank, then drill one word at a time.

It runs in three ways:

- **Personal / local** (default): one user, your own Azure key, data in a local SQLite file. See [Run](#run).
- **iPhone app**: the same frontend packaged with Capacitor, talking to your own backend. See [iOS](#ios).
- **Public trial** (`PUBLIC_MODE=1`): anonymous visitors use a server-held Azure key under per-visitor and site-wide usage caps, with per-visitor data they can delete. See [Public trial](#public-trial).

## Features

- Browser recording with a configurable duration limit.
- Short Drill mode for focused practice and Long Passage mode for continuous scoring.
- Azure Pronunciation Assessment scoring for accuracy, fluency, completeness, prosody, and overall pronunciation.
- Word-level and phoneme-level review, including likely heard alternatives when Azure returns them.
- Standard pronunciation playback for passages and selected words.
- Built-in sample passages plus JSON material import.
- History stored in SQLite.
- Local word bank for weak words and manual vocabulary practice, with in-progress and graduated views and spaced-repetition review scheduling (successful drills double the review interval; failures make the word due immediately).
- Optional passage quality check through an OpenAI-compatible LLM endpoint (personal mode only).
- LLM-generated phoneme drill passages from the insights panel, seeded with your weakest words for that sound (works with any OpenAI-compatible endpoint, including local Ollama; personal mode only).

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

## iOS

The same frontend is packaged as an iPhone app with Capacitor, using `VITE_API_BASE_URL` and `VITE_API_TOKEN` as build-time backend configuration.

For the shortest local path, the Simulator can keep the backend on `127.0.0.1`; a physical iPhone needs the backend on `0.0.0.0` and `VITE_API_BASE_URL` set to the Mac's LAN IP:

```bash
# Terminal 1; use ./scripts/dev.sh without BACKEND_HOST for the Simulator.
BACKEND_HOST=0.0.0.0 ./scripts/dev.sh

# Terminal 2
cd frontend
npm run build:ios      # Simulator: build the bundle, then run from Xcode
npm run ios:device     # Physical iPhone: build, sign, and install in one step
```

`ios:device` reads your iPhone UDID and Apple signing team ID from the environment: `IOS_DEVICE_ID=<udid> IOS_DEVELOPMENT_TEAM=<team-id> npm run ios:device`. When running from Xcode instead, pick your team under Signing & Capabilities. Free Apple ID signing expires after 7 days, so rerun that one command to reinstall.

Alternatively, open `frontend/ios/App/App.xcworkspace` in Xcode and run the App target. `frontend/.env.ios.local` is git-ignored build-time configuration; copy its shape from `frontend/.env.example`. See the [iOS deployment guide](docs/development/ios-deploy.md) for VPS, Tailscale, signing, and reinstall instructions.

## Public Trial

Hosted trial: https://justtalk.randomnessk.com. This address works only once the maintainer confirms the launch; until then it may be unreachable.

Public mode lets people try Just Talk without setting anything up, while keeping Azure usage bounded:

- Visitors start with one click. The server issues an anonymous HttpOnly cookie and stores only a hash of the token. There are no accounts.
- Each visitor's history, words, and imported materials live in their own SQLite file. **Delete my data** removes it, and idle visitors are removed after 7 days.
- Billable calls go through a persistent usage ledger:
  - per-visitor daily caps, plus site-wide daily and monthly caps (UTC windows) on audio seconds, TTS characters, and request counts;
  - audio is measured by decoding it, not from container metadata;
  - a call counts once it reaches Azure, even if it then fails.
- Uploads and request bodies are size-capped while they stream. State-changing requests must come from an allowed `Origin`, and API responses are not cached.
- LLM features are off. The frontend is built with `VITE_PUBLIC_MODE=1` and served by FastAPI on the same origin.

Deployment, defaults, cost estimate, and known limits are in [docs/deploy-public.md](docs/deploy-public.md). What happens to user data is described in [PRIVACY.md](PRIVACY.md).

Anonymous cookies can be reset, so per-visitor caps only share the allowance fairly. The site-wide caps are what bound usage, and a determined client can still use up the shared daily allowance.

## Material Import

The Materials panel includes three built-in sample passages and accepts JSON imports. Imported materials stay in the local SQLite database and can be selected as the current passage.

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
deploy/              Personal backend compose (Tailscale) and deploy/public/ public trial stack
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
| `LLM_BASE_URL` | No | OpenAI-compatible endpoint for optional passage review and phoneme drill generation. |
| `LLM_API_KEY` | No | API key for optional passage review and phoneme drill generation. |
| `LLM_MODEL` | No | Model name for optional passage review and phoneme drill generation. |
| `CORS_ORIGINS` | No | Comma-separated origins allowed to call the API. Defaults to the Vite dev origins plus `capacitor://localhost`. |
| `STATIC_DIR` | No | Serve a built frontend from this directory on the same origin (used by the public image). |
| `PUBLIC_MODE` | No | `1` enables the public trial. All `PUBLIC_*` settings are listed in [deploy/public/.env.example](deploy/public/.env.example). |

## Notes

- Keep recordings at or under `MAX_AUDIO_SECONDS` because v1 uses Azure's single-shot scripted assessment path with miscue enabled.
- Do not put the Azure key in frontend code. The browser only talks to the local FastAPI backend.
- `.env`, local SQLite data, virtual environments, dependencies, and build outputs are intentionally ignored by git.
- Personal mode has no authentication. Bind it to `0.0.0.0` only temporarily on a trusted LAN for physical-device testing, and use the Tailscale path in the iOS guide for remote access. Only public mode is designed to face the internet; see [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). Where the bundled sample content comes from, and what has not been verified, is listed in [docs/CONTENT-PROVENANCE.md](docs/CONTENT-PROVENANCE.md).
