# Building a Pronunciation-Coaching Web App: A Technical Plan with Genuine Acoustic Phoneme Scoring

## TL;DR

- **Build the MVP on Microsoft Azure AI Speech "Pronunciation Assessment"**: it is the only mainstream cloud API that returns true phoneme-level acoustic accuracy scores plus prosody, fluency, completeness, and miscue detection, runs at ~$1.30/hour of audio ($1.00/hr Standard real-time STT + $0.30/hr Pronunciation Assessment add-on), works directly from a browser SDK, and supports English (en-US) prosody. Layer an LLM (Claude/GPT) for grammar/word-usage review of the reference text.
- **For phoneme-level pronunciation scoring, the *real* options are very narrow**: Azure Speech, SpeechAce, ELSA API, and iFlytek ISE all do genuine acoustic phoneme-level scoring; Google, AWS, Speechmatics, Deepgram, AssemblyAI do NOT — they are ASR-only. On the open-source side, only Kaldi's `gop_speechocean762` recipe, MIT's GOPT, wav2vec2-phoneme + Charsiu/MFA alignment, and a handful of research repos give you genuine GOP — all of which require non-trivial backend engineering and a Linux server (CPU works; a GPU is nice-to-have).
- **Recommended phasing**: Phase 1 (1–2 weeks) — React + FastAPI + Azure Pronunciation Assessment, scripted "read this passage" flow, LLM grammar pass on the script. Phase 2 — add prosody visualization, history, and personalized weakness drills. Phase 3 (optional) — self-host a Kaldi/GOPT or wav2vec2-phoneme + MFA backend behind the same API to remove cloud dependency. Personal-use cost at 30 min/day of practice ≈ $13–$20/month on Azure, ~€4/month on a Hetzner CX22 if self-hosted (excluding any GPU).

---

## Key Findings

### 1. Only a handful of providers do TRUE acoustic phoneme scoring; most "pronunciation" features are ASR-then-text-compare in disguise

The acid test for genuine acoustic pronunciation assessment is whether the system returns a per-phoneme acoustic confidence (a GOP-style posterior) that is independent of whether the ASR transcribed the word correctly. A second tell is whether the system can detect a *mispronunciation* of a word whose correct text is given as reference (miscue detection) — pure ASR cannot do this because if the ASR mishears the phoneme, it has nothing to compare to the reference.

| Provider | True phoneme-level acoustic scoring? | What it actually does |
|---|---|---|
| **Microsoft Azure AI Speech – Pronunciation Assessment** | ✅ Yes | Returns AccuracyScore per phoneme/syllable/word/sentence, FluencyScore, CompletenessScore, ProsodyScore (en-US), and an overall PronScore (0–100). Phoneme alphabet: IPA or SAPI. Supports miscue detection, "scripted" (reference-text) and "unscripted" (open-ended) modes; unscripted adds Vocabulary/Grammar/Topic content scores. |
| **SpeechAce** | ✅ Yes (patented) | "Pinpoint individual syllable and phoneme-level mistakes." Returns phoneme/syllable/word/sentence quality scores, fluency (WCPM, pauses), IELTS/PTE/TOEFL-aligned scores. Patented in US/EU/JP/CN. |
| **ELSA Speak / ELSA API** | ✅ Yes | "Phonetic and suprasegmental analysis of the user's speech." Scripted and unscripted modes, returns pronunciation/prosody/intonation/fluency/grammar/vocabulary. Built on proprietary models. |
| **iFlytek ISE (语音评测)** | ✅ Yes | Streaming "全维度评测" (multi-dimension) returns word-, syllable-, and phoneme-level scores for English. Uses iFlytek's proprietary phonetic alphabet (not IPA). |
| **Google Cloud Speech / Chirp / Gemini** | ❌ No | ASR only. The "phoneme" support in Google docs refers to *Text-to-Speech* SSML, not assessment. No pronunciation scoring product. |
| **Amazon Transcribe / Polly** | ❌ No | ASR + TTS only; no pronunciation assessment product. |
| **Speechmatics** | ❌ No | ASR, TTS, translation, voice-agent (Flow) only. The `sounds_like` feature is for improving ASR recognition of unusual words, not for scoring learners. |
| **Deepgram / AssemblyAI** | ❌ No | ASR-focused. |
| **Carnegie Speech** | ⚠️ Yes, but no self-serve API | NativeAccent / CSA include phoneme-level scoring, but the API is enterprise-licensed via partnerships only (e.g., Emmersion's TrueNorth). |
| **Pearson Versant** | ⚠️ Enterprise only | B2B HR-test product; "integration with various systems" available by quotation, but exposes only test-level scores (Overall + four subscores 20–80), not raw phoneme GOP. No self-serve developer API. |

### 2. The text "review" feature is the easy part — use an LLM or LanguageTool

Grammar and word-usage review of the passage being read is a solved problem. The two viable approaches:

- **LLM API (GPT-4o-mini, Claude Sonnet, Gemini)** — best quality, gives explanations, costs $0.000150 per 1,000 input tokens for GPT-4o-mini ($0.15 per 1M input tokens, $0.60 per 1M output tokens, per OpenAI's pricing page) so essentially free for short passages.
- **LanguageTool** — open-source, self-hostable in Docker (`erikvl87/languagetool` image), exposes `POST /v2/check`, supports 30+ languages, free.

The interesting design choice is *what* you review: review the **reference text** the user is about to read (so they don't practice with broken English) and/or, for unscripted mode, review the **ASR transcript** of what they actually said.

### 3. Open-source phoneme-level pronunciation assessment is real but engineering-heavy

The serious open-source path goes through one of these:

1. **Kaldi `egs/gop_speechocean762`** — the canonical DNN-GOP recipe (Hu et al. 2015), shipped in mainline Kaldi, uses a TDNN-F acoustic model trained on Librispeech and the SpeechOcean762 corpus (5,000 English utterances from 250 native-Mandarin non-native speakers, half children, free for commercial use, on OpenSLR-101). Returns per-phone GOP scores. Production-quality but the Kaldi build pipeline is notorious.
2. **GOPT (MIT, ICASSP 2022)** — `YuanGongND/gopt` on GitHub. Takes Kaldi GOP features as input and a Transformer outputs phoneme/word/utterance scores on accuracy, fluency, completeness, prosody. State-of-the-art on SpeechOcean762 at publication: per Gong et al., ICASSP 2022 (DOI: 10.1109/ICASSP43922.2022.9746743), "0.612 phone-level Pearson correlation coefficient (PCC), 0.549 word-level PCC, and 0.742 sentence-level PCC, all are the best results on SpeechOcean762." Recipes provided so you can skip building Kaldi by using their cached features.
3. **wav2vec2-phoneme + forced alignment** — fine-tune `wav2vec2-base` or `wav2vec2-xls-r` on phoneme labels (e.g., `facebook/wav2vec2-lv-60-espeak-cv-ft`), CTC-decode actual phonemes, then compare to canonical phonemes from a G2P (`g2p_en`, `espeak`) and a forced aligner (Charsiu or MFA). This is what most 2022–2024 research papers use; CharSiu (`lingjzhu/charsiu`, ICASSP 2022) provides ready-to-use neural phone aligners (`charsiu/en_w2v2_fc_10ms`).
4. **Montreal Forced Aligner (MFA)** — Kaldi-based GMM-HMM forced aligner, pretrained acoustic + G2P models for many languages, gives you accurate phone-level time alignments. A 2024 ISCA paper (MAPS) confirms MFA still outperforms WhisperX/MMS on phoneme alignment on TIMIT and Buckeye.
5. **GOP-pykaldi (Vidal et al., UBA)** — Python port of the Kaldi GOP recipe; easier to integrate than full Kaldi.
6. **Segmentation-Free GOP (arXiv 2507.16838, 2025)** — newer CTC-based GOP variants that don't require explicit pre-segmentation, achieving state-of-the-art on SpeechOcean762.

Whisper is *not* a good basis for phoneme-level assessment: it has no native phoneme output (HuggingFace community confirmed). WhisperX adds wav2vec2-phoneme alignment as a *post-processing* step for word-level timestamps, but it's still not designed for GOP scoring.

### 4. Browser audio capture has well-understood pitfalls — record opus/webm, transcode server-side

Azure (and SpeechAce, ELSA) require 16 kHz, 16-bit, mono PCM/WAV. Chrome's `MediaRecorder` only outputs `audio/webm;codecs=opus`. The clean architecture is: record opus/webm client-side, POST to your FastAPI backend, transcode to WAV with ffmpeg, forward to Azure. Direct browser-to-Azure with the JS SDK is also possible (`AudioConfig.fromStreamInput`) and gives lower latency but exposes the subscription key — must use a short-lived auth token from your backend.

### 5. Client-side phoneme assessment in the browser is theoretically possible but not advisable for v1

Transformers.js v4 (released February 9, 2026 per Hugging Face's announcement blog) + ONNX Runtime Web with WebGPU can run wav2vec2 models in-browser. There are ONNX wav2vec2 models on Hugging Face (`onnx-community/*`, `Xenova/*`). However: (a) the GOP pipeline needs forced alignment with a pronunciation lexicon, which is heavy; (b) wav2vec2-phoneme models large enough for good English accuracy are 300–600 MB to download; (c) GOPT depends on Kaldi-extracted features, which is impractical client-side. For v1, do all assessment server-side.

---

## Details

### A. Azure AI Speech — Pronunciation Assessment (the recommended MVP backbone)

**What it returns** (from Microsoft Learn `how-to-pronunciation-assessment`):
- **AccuracyScore** at phoneme / syllable (en-US) / word / full-text level. "Indicates how closely the phonemes match a native speaker's pronunciation."
- **FluencyScore** — silent breaks vs. native baseline.
- **CompletenessScore** — ratio of pronounced words to reference text.
- **ProsodyScore** (en-US only, SDK ≥ 1.35.0) — naturalness, stress, intonation, speaking speed, rhythm.
- **PronScore** — weighted overall (lowest score weighted most heavily; scores sorted s0..s3 then s0×0.4 + s1×0.2 + s2×0.2 + s3×0.2).
- **Miscue detection** — `EnableMiscue=true` flags omissions, insertions, mispronunciations against the reference.
- **N-best phoneme** — `NBestPhonemeCount` returns the top-N phonemes Azure actually heard at each position, so you can show "you said /æ/ instead of /ɛ/".
- **Phoneme alphabet** — IPA (recommended) or SAPI.
- **Unscripted mode** adds Vocabulary/Grammar/Topic content scores via an LLM-style content evaluator (en-US).

**Pricing** (current as of late 2025/early 2026 per Microsoft Q&A and the Azure pricing page):
- Pronunciation Assessment is billed at the Standard real-time Speech-to-Text rate of $1.00/hour plus a $0.30/hour add-on for the assessment feature in real-time = **$1.30/hour of audio** (Microsoft Q&A learn.microsoft.com/en-us/answers/questions/5608069 quotes "$1.32 per hour (or ~$0.000367 per second) for Standard real-time transcription" — the small difference is rounding). Billed per second.
- The **Fast Transcription** endpoint ($0.36/hour to $0.66/hour depending on source) does NOT support Pronunciation Assessment (Microsoft confirmed in Q&A).
- For short audio files (≤30 s) you can use the REST short-audio endpoint, still billed at the Standard rate, prorated per second.
- **Free tier (F0)**: 5 audio hours/month of STT including Pronunciation Assessment — enough for the entire MVP and personal use of ~10 minutes/day.

**SDK / API**: Speech SDK in C#/C++/Java/JS/Python/Objective-C/Swift, plus REST. The JS Speech SDK runs in the browser; pass `PronunciationAssessmentConfig` to the recognizer.

**Privacy**: Audio is processed in Azure; you can pick a region (e.g., westus, eastus, westeurope). Microsoft commits to not using your audio to train baseline models by default.

**Latency**: Sub-second per utterance; the SDK streams partial recognition.

### B. SpeechAce

**Pricing** (verbatim from `speechace.com/api-plans/`):
- **Basic — $40/mo**: 5,000 fifteen-second requests/mo, word + sentence pronunciation, phoneme + syllable feedback, custom phoneme/markup scoring. Max 30-second audio. Overage **$0.008 per 15-sec audio**.
- **Pro — $80/mo**: 10,000 requests/mo + Fluency, lexical stress, intonation, IELTS/CEFR/PTE/TOEIC scoring, 45-sec max audio.
- **Premium — $125/mo**: 10,000 requests + transcription, vocabulary/grammar/coherence scoring, relevance/task achievement, 2-min max audio, overage $0.0125 per 15 sec.
- Languages: English (US/UK), French (FR/CA), Spanish (ES/MX).
- **Accuracy claim**: "Delivers scores within 0.68 IELTS points from human examiners; 0.9 Pearson correlation in hold-out evaluations." Patented in US/EU/JP/CN.
- **CORS is disabled by default** — must call from backend (or request CORS enable, which exposes the key).

For an indie developer doing personal practice, the $40/mo Basic plan provides ~20 hours/month of practice — comparable to Azure's free tier but more expensive at scale.

### C. ELSA Speak API

- Both scripted and unscripted modes; "ELSA AI technology evaluates spoken English in five major dimensions: pronunciation, prosody, fluency, grammar, vocabulary."
- Deployed in three AWS regions; expects flac/wav, internally normalized to 16 kHz mono 16-bit.
- File mode up to 100 MB; **rate limit 650 requests/minute**.
- **Pricing**: Not public. Custom quotation via the contact form ("Request API Key"). Reports from ELSA Business indicate it is enterprise-priced and not aimed at indie developers.

### D. iFlytek ISE (Intelligent Speech Evaluation, 语音评测)

- WebSocket streaming API at `ise-api-sg.xf-yun.com/v2/ise` (Singapore) or `ise-api.xfyun.cn` (China).
- Supports English at word / phrase / sentence / paragraph item types, plus situational response, free-talk, picture-talk, oral-composition with paid paper-customization.
- Uses iFlytek's proprietary phonetic alphabet (not IPA) — minor differences from IPA. Returns scores for total/accuracy/standard/fluency/completeness; sentence-level returns per-word scores.
- **Pricing** (from `global.xfyun.cn/products/ise`, USD):
  - **Free New User Package**: 100,000 calls, 3 months, 5 concurrent — $0 (list $150).
  - **Business Package A**: 100,000 calls, 1 year, 5 concurrent — $150.
  - **Business Package B**: 200,000 calls, 1 year, 50 concurrent — $280.
  - **Business Package C**: 1,000,000 calls, 1 year, 50 concurrent — $1,300.
  - Plus customizable VPC.
- Strong for Chinese/English bilingual use cases but the non-IPA alphabet and Chinese-language docs are friction for a Western indie developer.

### E. Open-source phoneme-level stack — engineering reality check

**The cleanest open-source MVP path** (if you choose self-host later):

1. **Reference phonemization**: `g2p_en` (Park & Kim, PyPI `g2p_en`) gives ARPAbet for English text. Use Charsiu or MFA's English G2P for IPA.
2. **Forced alignment**: `lingjzhu/charsiu` with `charsiu/en_w2v2_fc_10ms` — a wav2vec2-based phone aligner returning 10-ms-resolution phone segments. Takes audio + text, returns `[(start, end, phone), ...]`. Pure PyTorch, easy install.
3. **Acoustic GOP scoring**: Either (a) Kaldi `gop_speechocean762` recipe (DNN-GOP with TDNN-F), or (b) for a pure-Python stack, use a wav2vec2-phoneme CTC model (e.g., `facebook/wav2vec2-lv-60-espeak-cv-ft` or `vitouphy/wav2vec2-xls-r-300m-phoneme`) and compute frame-wise log-posteriors over the segments from step 2; mean-normalize per segment for a posterior GOP.
4. **Higher-level scoring**: Plug GOP features into GOPT (`YuanGongND/gopt`) for multi-aspect (accuracy/fluency/prosody/completeness) phoneme/word/utterance scoring trained on SpeechOcean762.

**Hardware**:
- A 4-core CPU can run wav2vec2-base + Charsiu at ~1× real-time for short utterances. A consumer GPU (RTX 3060, T4) does it at ~10–20× real-time.
- Kaldi GOP runs on CPU acceptably.
- A single Hetzner GPU instance (~$0.30/hr on demand, or rent a CCX-line CPU instance for ~€20/mo) covers personal use.

**Accuracy vs. Azure**: Published numbers on SpeechOcean762 (the standard benchmark): GOPT achieves 0.612 phone-PCC, 0.549 word-PCC, 0.742 sentence-PCC. Microsoft's own Hierarchical Transformer (the engine behind Azure Pronunciation Assessment) reports beating these numbers on internal data. **In practice, expect a self-hosted stack to be 70–85% as good as Azure on edge cases**, especially for prosody (where Azure has invested heavily in a separate model). The accuracy gap is real but not crippling for a personal coaching app.

**Engineering effort**: Realistically 2–3 weekends for a wav2vec2 + Charsiu pipeline; 1–2 weeks for Kaldi GOP; another week to wire in GOPT. AI-assisted coding (Claude Code) shortens this materially because the recipes are well-trodden.

### F. Web app architecture

**Recommended stack** (matches the user's profile — Claude Code/PLAN.md, Python-friendly):

```
Browser (React + Vite + TypeScript)
  - MediaRecorder API (opus/webm) for capture
  - WaveSurfer.js for waveform visualization
  - Or: Azure JS Speech SDK direct (with short-lived auth token)
        │
        ▼ (HTTPS POST multipart audio + reference text)
FastAPI backend (Python 3.11+)
  - /score endpoint: ffmpeg transcode webm→16kHz mono WAV
  - Calls Azure Speech REST or SDK with PronunciationAssessmentConfig
  - /grammar endpoint: passes reference text to Claude/GPT or LanguageTool
  - Persists sessions to SQLite (single-user) or Postgres (multi-user)
        │
        ▼
Azure AI Speech (West US / East US / region of choice)
LanguageTool (Docker, optional) or Anthropic/OpenAI API
```

**Frontend gotchas**:
- Use `MediaRecorder.isTypeSupported('audio/webm;codecs=opus')` with fallbacks.
- Set `audioBitsPerSecond: 128000`; sample at the default (48 kHz) and downsample server-side — the Web Audio API's `AudioContext` can be set to 16 kHz but Safari ignores it.
- Always validate audio length client-side (Azure's short-audio endpoint = 30 s, scripted PA = up to 1 minute; for longer use continuous mode).
- Use `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` for cleaner signal.

**Backend gotchas**:
- Azure REST PA endpoint expects pronunciation parameters in a `Pronunciation-Assessment` request header as a base64-encoded JSON blob — easy to get wrong (multiple Microsoft Q&A threads report a stuck `PronScore=100` from header misuse).
- For audio ≤30 s use the short-audio REST endpoint; for longer use the SDK's continuous recognition with `pronunciationAssessmentContinuousWithFile`.

**Real-time vs. batch**: Start batch. Real-time streaming (Azure supports it, mic→partial results) is nice-to-have but adds significant frontend complexity and roughly the same cost.

### G. Text review feature

For the reading-comprehension/grammar review:

- **For passage selection / generation**: Use an LLM (Claude or GPT-4o-mini) to (a) generate level-appropriate passages, (b) check user-supplied text for grammar errors before they record, (c) explain why a flagged construction is wrong, and (d) suggest more natural phrasings (word-usage). Cost is negligible (a few cents per session).
- **For deterministic style/grammar checking**: Self-host LanguageTool in Docker (`docker-compose` template widely available; ~1 GB RAM, optionally +15 GB n-grams for context-sensitive errors). Free, private, but no "explain why" — strict rule-based.
- **For unscripted mode**: Azure's PA "unscripted" already returns VocabularyScore/GrammarScore/TopicScore; if you need explanations, post the ASR transcript to an LLM.

The pragmatic answer: **LLM for explanations + LanguageTool optionally as a secondary deterministic check**.

### H. Detailed comparison: Cloud vs. local/open-source

| Dimension | Azure PA | SpeechAce | iFlytek ISE | Kaldi GOP + GOPT (self-host) | wav2vec2-phoneme + Charsiu (self-host) |
|---|---|---|---|---|---|
| Phoneme-level acoustic score | Yes (IPA/SAPI) | Yes | Yes (proprietary alphabet) | Yes | Yes |
| Prosody/intonation/stress | Yes (en-US) | Yes (lexical stress, intonation) | Limited | Via GOPT (prosody score) | Manual; needs separate model |
| Miscue detection | Yes | Yes | Yes | Possible via decoding lattice | Possible via CTC vs. reference |
| Unscripted (open-ended) mode | Yes + content scores | Yes (Premium) | Yes | Hard (needs separate ASR) | Possible via decoded phonemes |
| Languages | 30+ for PA | EN, FR, ES | EN, ZH | EN (recipes), extendable | Multilingual via XLS-R |
| Accuracy on SpeechOcean762 | ~SOTA (Hierarchical Transformer) | ~0.9 Pearson vs. human | Not benchmarked publicly | 0.612 phone-PCC, 0.742 sent-PCC | Comparable when fine-tuned |
| Cost (personal use, ~15 hr/month) | ~$13–$20/mo (or free under 5 hr) | $40/mo (Basic) | $0 (free tier covers it) | Server cost ~€4–€20/mo | Same |
| Latency | <1 s | <2 s | <2 s | 2–10 s on CPU; <1 s on GPU | <1 s on GPU |
| Privacy | Cloud | Cloud | Cloud (China/SG region) | Fully local | Fully local |
| Integration effort | Low (1–2 days) | Low | Medium (docs, alphabet) | High (Kaldi build, 1–2 weeks) | Medium (1–2 weekends) |
| Vendor lock-in | High | High | High | None | None |
| Scalability | Managed | Managed | Managed | Self-managed | Self-managed |

---

## Recommendations

### Phase 1 — MVP in ~1–2 weekends (use AI-assisted coding)

**Goal: working "read this passage and get phoneme-level feedback + grammar review."**

1. **Backend** (FastAPI, Python 3.11): two endpoints, `/score` and `/passage-check`.
   - `/score`: accepts `audio` (webm) + `reference_text`; uses `ffmpeg` to convert to 16 kHz mono WAV; calls Azure PA via the `azure-cognitiveservices-speech` SDK with `enableProsodyAssessment=True`, `enableMiscue=True`, `granularity=Phoneme`, `phonemeAlphabet=IPA`, `nBestPhonemeCount=5`; returns the full JSON.
   - `/passage-check`: passes the reference text to Anthropic Claude (or OpenAI) with a system prompt: "Review this English passage for grammar errors and unnatural word choices. Output JSON with a list of issues: {span, problem, suggestion, explanation}."
2. **Frontend** (Vite + React + TypeScript + Tailwind):
   - Text-area for passage; "Check passage" button → calls `/passage-check`, renders inline highlights.
   - Big record button using `MediaRecorder`; show waveform with WaveSurfer.js.
   - On stop, POST to `/score`, render: per-word colored chips (green ≥80, yellow 60–79, red <60), expand chip to show per-phoneme score and the "you said /ð/ instead of /θ/" diagnostic from N-best phonemes, plus an audio player for instant replay.
   - Show four big-number scores: Accuracy, Fluency, Completeness, Prosody, and the overall PronScore.
3. **Hosting**: Single Docker Compose on a Hetzner CX22 (€3.79/month for 2 vCPU, 4 GB RAM, 40 GB disk per Hetzner's CX-plans announcement) or Fly.io free tier. Store Azure key in `.env`. Use SQLite for session history.

**Why Azure first**: lowest engineering effort, best documentation, phoneme alphabet is IPA (universal), free tier covers personal use, and it is the only API that bundles prosody scoring in en-US out of the box.

### Phase 2 — Personalization (weeks 3–6)

- Aggregate weakness data: which phonemes consistently score below 70 across sessions; auto-generate drill passages targeting those phonemes (LLM-assisted).
- Add a "minimal pairs" mode (e.g., ship/sheep) using the N-best phoneme output.
- Add prosody visualization: stress pattern bars from Azure's ProsodyScore breakdown (`Monotone`, `UnexpectedBreak`, `MissingBreak` feedback).
- Add a Whisper-based unscripted "free-talk" mode using Azure PA in unscripted mode for content/grammar scoring + LLM coaching on the transcript.

### Phase 3 — Optional: Replace cloud with self-hosted GOP (months 2–3)

Only if you (a) hit cost ceilings, (b) want a portfolio/learning project, or (c) have hard privacy needs.

1. Stand up `lingjzhu/charsiu` + a wav2vec2-phoneme model (e.g., `facebook/wav2vec2-lv-60-espeak-cv-ft`) in a Python service. CPU-only is fine to start.
2. Compute posterior-GOP from CTC log-probabilities for the canonical phone sequence.
3. Optionally pull in `YuanGongND/gopt` for multi-aspect Transformer scoring on top.
4. Keep the same `/score` HTTP contract so the frontend doesn't change.
5. Validate against SpeechOcean762 — aim for ≥0.55 phone-PCC before cutting over.

### Cost estimates (personal use, ~30 min audio/day = ~15 hr/month)

| Backend | Monthly cost |
|---|---|
| Azure PA only | 5 hr free + 10 hr × $1.30 = **$13.00** |
| Azure PA + Claude Sonnet for grammar (light use) | ~$15–20 |
| SpeechAce Basic | $40 (fixed, includes 20 hr) |
| iFlytek ISE | $0 (free 100k-call package lasts months for personal use) |
| Self-hosted (Hetzner CX22) | ~€4 |
| Self-hosted GPU (Runpod RTX 4000 Ada, 4 hr/day) | ~$60–120 |

### Triggers to change the recommendation

- **If monthly Azure bill > $50** (≈30 hr practice): start Phase 3 self-host.
- **If you need Chinese pronunciation too**: switch to iFlytek (or run Azure ZH locale, which is supported but without prosody).
- **If you need offline/edge**: Phase 3 with wav2vec2-phoneme; the model is ~360 MB and runs on CPU.
- **If accuracy on edge phonemes (e.g., /θ/ vs /s/ for Mandarin speakers) is unsatisfactory**: try SpeechAce's $40 tier and A/B against Azure.

---

## Caveats

1. **"Pronunciation Assessment" branding ≠ acoustic scoring**. Several smaller vendors market "pronunciation feedback" that is in fact ASR + Levenshtein distance against the reference text. Validate any candidate by feeding it a recording where you deliberately mispronounce one phoneme of an in-vocabulary word — a true acoustic scorer will mark that phoneme red while still recognizing the word; an ASR-pretender will either transcribe a different word (and call it a miscue) or score 100%.
2. **Azure's prosody scoring is English-only (en-US)** — this is explicit in the Microsoft Learn docs. Other locales return accuracy/fluency/completeness but not prosody.
3. **Azure's pronunciation models are themselves not perfectly aligned with all native dialects**; Microsoft's "Transparency Note" admits the model was trained on 100k+ hours of native-speaker data and warns against using it for high-stakes assessment of accented native speech.
4. **Pricing volatility**: Azure restructured Speech-to-Text pricing in 2024–2025 (Fast Transcription added, PA add-on at $0.30/hr formalized). Recheck `azure.microsoft.com/pricing/details/speech` before committing.
5. **SpeechOcean762 is built from speakers whose L1 is Mandarin** (5,000 utterances, 250 speakers, half children, per Zhang et al. arXiv:2104.01378). Benchmark numbers (e.g., GOPT's 0.612 phone-PCC) may not transfer to other L1 backgrounds. For your own use, the right validation set is *your own recordings* with self-rated targets.
6. **Open-source GOP implementations are research code**. Expect to debug Kaldi build issues, Python dependency conflicts, and missing pronunciation lexicons for any non-vanilla vocabulary. Budget accordingly.
7. **Direct browser-to-cloud calls leak API keys.** Even Azure's recommended pattern routes a short-lived token through your backend; don't put the long-lived subscription key in client JS.
8. **Claude/GPT will sometimes hallucinate grammar errors** in correct English. For a deterministic baseline, run LanguageTool alongside.