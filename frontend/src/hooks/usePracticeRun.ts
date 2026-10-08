import { useRef, useState } from "react";

import { addWordsFromSession, ApiError, fetchPhonemeStats, listWords, scoreRecording } from "../api";
import { runWeakWords } from "../components/RunReview";
import { buildRunDeck } from "../game/runDeck";
import { canRecord, nextCapture, runReducer, SENTENCE_COLLECT_MAX } from "../game/runModel";
import { normalizedWord, weakWordsFromResult } from "../scoreUtils";
import type {
  AttemptKey,
  PhonemeStat,
  RunAction,
  RunMode,
  RunPrompt,
  RunState,
  ScoreFailure,
  ScoreResponse,
  VocabularyItem
} from "../types";
import type { usePracticeSession } from "../usePracticeSession";

export type RunSession = Pick<
  ReturnType<typeof usePracticeSession>,
  | "enterRun"
  | "exitRun"
  | "startRunCapture"
  | "cancelRunCapture"
  | "stopRecording"
  | "playCorrect"
  | "refreshVocabulary"
  | "setError"
>;

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

// Status alone decides: 400/413/503 are refused before the billable Azure call.
function classifyScoreError(err: unknown): ScoreFailure {
  const message = err instanceof Error ? err.message : "Scoring failed.";
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 413 || err.status === 503) return { kind: "rejected", message };
    if (err.status === 429) return { kind: "quota", message };
  }
  return { kind: "unknown", message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScore(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isWordResult(word: unknown): boolean {
  if (!isObject(word) || typeof word.word !== "string" || !Array.isArray(word.phonemes)) return false;
  return word.phonemes.every(
    (phoneme) => isObject(phoneme) && typeof phoneme.phoneme === "string" && isScore(phoneme.accuracy)
  );
}

// parseResponse trusts the payload, so a malformed 2xx would otherwise look
// scored. Checks only the fields the run and review read; a well-formed
// NoMatch, null accuracy, or Omission still goes on to be judged.
function isScoreResponse(value: unknown): value is ScoreResponse {
  if (!isObject(value) || !isObject(value.result) || !isObject(value.result.scores)) return false;
  const { result, session } = value as Partial<ScoreResponse> & { result: ScoreResponse["result"] };
  if (!isScore(result.scores.accuracy)) return false;
  const words: unknown = result.words;
  if (!Array.isArray(words) || !words.every(isWordResult)) return false;
  if (result.recognition_status === "no_match") return session === null || session === undefined;
  return isObject(session) && typeof session.id === "string" && session.id !== "";
}

function referenceCacheKey(prompt: RunPrompt): string {
  const text = prompt.text.trim().toLowerCase();
  return prompt.kind === "word" ? `word:${text}` : `game:${text}`;
}

export function usePracticeRun(session: RunSession) {
  const [state, setState] = useState<RunState | null>(null);
  const [attemptAudioUrls, setAttemptAudioUrls] = useState<Readonly<Record<string, string>>>({});
  // Mirrors state synchronously so double taps and racing callbacks see the latest run.
  const stateRef = useRef<RunState | null>(null);
  // Held from startRunCapture until that capture's blob arrives, even after cancellation.
  const captureRef = useRef<AttemptKey | null>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());
  // Bumped by every start and exit; a start whose token moved on while it
  // fetched deck data is abandoned.
  const startTokenRef = useRef(0);

  function dispatch(action: RunAction): RunState | null {
    const previous = stateRef.current;
    const next = runReducer(previous, action);
    if (next === previous) return next;
    stateRef.current = next;
    setState(next);
    if (next?.phase === "review" && previous?.phase !== "review") {
      // History, insights, and activity refresh when their own screens open.
      session.refreshVocabulary().catch(() => undefined);
    }
    return next;
  }

  function releaseUrl(attemptId: string) {
    const url = urlsRef.current.get(attemptId);
    if (!url) return;
    URL.revokeObjectURL(url);
    urlsRef.current.delete(attemptId);
    setAttemptAudioUrls(Object.fromEntries(urlsRef.current));
  }

  function releaseAllUrls() {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    setAttemptAudioUrls({});
  }

  function cancelCapture() {
    if (captureRef.current) session.cancelRunCapture();
  }

  async function start(mode: RunMode, previousWeakWords: readonly string[] = []) {
    startTokenRef.current += 1;
    const token = startTokenRef.current;
    const [phonemeStats, vocabulary] = await Promise.all([
      fetchPhonemeStats().catch((): PhonemeStat[] => []),
      listWords().catch((): VocabularyItem[] => [])
    ]);
    if (startTokenRef.current !== token) return;
    const prompts = buildRunDeck({ phonemeStats, vocabulary, previousWeakWords });
    if (stateRef.current) teardown();
    session.enterRun();
    dispatch({ type: "START", runId: newId("run"), mode, prompts });
  }

  async function record() {
    const current = stateRef.current;
    if (!current || captureRef.current || !canRecord(current)) return;
    const capture = nextCapture(current);
    if (!capture) return;
    const key = { runId: current.runId, itemId: current.items[current.index].prompt.itemId, attemptId: newId("attempt") };
    if (dispatch({ type: "BEGIN_CAPTURE", key, ...capture }) === current) return;
    captureRef.current = key;
    let started = false;
    try {
      // Auto-stop stays off until the run classifies local rejects before sending.
      const kind = current.items[current.index].prompt.kind;
      started = await session.startRunCapture({ key, kind, autoStop: false }, (blob) => handleBlob(key, blob));
    } catch (err) {
      session.setError(err instanceof Error ? err.message : "Could not start the microphone.");
    }
    if (!started) {
      if (captureRef.current === key) captureRef.current = null;
      dispatch({ type: "CANCEL_CAPTURE", key });
    }
  }

  function handleBlob(key: AttemptKey, blob: Blob) {
    if (captureRef.current?.attemptId === key.attemptId) captureRef.current = null;
    // Cancelled, stale, or repeated blobs leave the run unchanged and are discarded.
    const before = stateRef.current;
    const ready = dispatch({ type: "BLOB_READY", key, blob });
    if (ready === before || dispatch({ type: "SCORE_SENT", key }) === ready) return;
    const prompt = ready?.items.find((item) => item.prompt.itemId === key.itemId)?.prompt;
    if (!prompt) return;
    urlsRef.current.set(key.attemptId, URL.createObjectURL(blob));
    setAttemptAudioUrls(Object.fromEntries(urlsRef.current));
    void submit(key, blob, prompt);
  }

  async function submit(key: AttemptKey, blob: Blob, prompt: RunPrompt) {
    let response: unknown;
    try {
      response = await scoreRecording(prompt.text, blob, "short");
    } catch (err) {
      const failure = classifyScoreError(err);
      dispatch({ type: "SCORE_FAILED", key, failure });
      if (failure.kind !== "unknown") releaseUrl(key.attemptId);
      return;
    }
    if (!isScoreResponse(response)) {
      dispatch({ type: "SCORE_FAILED", key, failure: { kind: "unknown", message: "Scoring returned an unexpected response." } });
      return;
    }
    const before = stateRef.current;
    if (dispatch({ type: "SCORE_RECEIVED", key, response }) === before) return;
    // Word attempts update SRS inside /api/score; only sentences collect words.
    if (prompt.kind !== "sentence" || !response.session) return;

    const words = weakWordsFromResult(response.result, SENTENCE_COLLECT_MAX).map((word) => word.word);
    try {
      const rows = await addWordsFromSession(response.session.id, SENTENCE_COLLECT_MAX);
      // A full word bank can skip candidates while the call still succeeds.
      const returned = new Set((Array.isArray(rows) ? rows : []).map((row) => normalizedWord(String(row?.word ?? ""))));
      dispatch({
        type: "SYNC_SETTLED",
        key,
        candidates: words.map((word) => ({
          word,
          status: returned.has(normalizedWord(word)) ? "processed" : "unconfirmed"
        })),
        failed: false
      });
    } catch {
      dispatch({
        type: "SYNC_SETTLED",
        key,
        candidates: words.map((word) => ({ word, status: "save-manually" })),
        failed: true
      });
    }
  }

  function stop() {
    if (captureRef.current) session.stopRecording();
  }

  function itemAction(type: "SKIP" | "ADVANCE" | "CANNOT_CONFIRM") {
    const current = stateRef.current;
    if (!current) return null;
    return dispatch({ type, runId: current.runId, itemId: current.items[current.index].prompt.itemId });
  }

  function recordNext() {
    const before = stateRef.current;
    if (itemAction("ADVANCE") === before) return;
    void record();
  }

  function playReference(prompt?: RunPrompt) {
    const current = stateRef.current;
    if (!current) return;
    const item = current.items[current.index];
    const target = prompt ?? item.prompt;
    const options = { cacheKey: referenceCacheKey(target) };
    if (current.endReason !== null || target.itemId !== item.prompt.itemId) {
      void session.playCorrect(target.text, options);
      return;
    }
    if (item.referenceLoad === "pending") return;
    if (item.referenceLoad === "ready") {
      void session.playCorrect(target.text, options);
      return;
    }
    const { runId } = current;
    const { itemId } = target;
    dispatch({ type: "REFERENCE_CLICKED", runId, itemId });
    void session.playCorrect(target.text, {
      ...options,
      onLoadResult: (ok) => dispatch({ type: "REFERENCE_LOADED", runId, itemId, ok })
    });
  }

  function runAction(type: "PAUSE" | "RESUME" | "QUIT" | "OPEN_REVIEW") {
    const current = stateRef.current;
    if (current) dispatch({ type, runId: current.runId });
  }

  // Each ends the attempt first, so a blob that arrives while the capture
  // stops is discarded.
  function pause() {
    runAction("PAUSE");
    cancelCapture();
  }

  function quit() {
    runAction("QUIT");
    cancelCapture();
  }

  function teardown() {
    const current = stateRef.current;
    if (current) dispatch({ type: "EXIT", runId: current.runId });
    cancelCapture();
    releaseAllUrls();
    session.exitRun();
  }

  function exit() {
    startTokenRef.current += 1;
    teardown();
  }

  async function playAgain() {
    const current = stateRef.current;
    if (current) await start(current.mode, runWeakWords(current));
  }

  return {
    state,
    attemptAudioUrls,
    start,
    record,
    stop,
    recordNext,
    finish: () => void itemAction("ADVANCE"),
    skip: () => void itemAction("SKIP"),
    cannotConfirm: () => void itemAction("CANNOT_CONFIRM"),
    playReference,
    pause,
    resume: () => runAction("RESUME"),
    quit,
    openReview: () => runAction("OPEN_REVIEW"),
    exit,
    playAgain
  };
}
