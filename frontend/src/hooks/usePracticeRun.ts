import { useMemo, useRef, useState } from "react";

import { addWordsFromSession, ApiError, fetchPhonemeStats, listWords, scoreRecording } from "../api";
import { bestBucketForRun, finalizeRunBest, readBest } from "../game/personalBest";
import { getRunPreferences, setRunPreference, useRunPreferences } from "../game/preferences";
import { buildRunDeck } from "../game/runDeck";
import { canRecord, nextCapture, runReducer, SENTENCE_COLLECT_MAX } from "../game/runModel";
import {
  runWeakWords,
  selectReviewSuggestions,
  selectRunScore,
  selectTopRevisit,
  tierForAccuracy,
  validAccuracy
} from "../game/scoring";
import { cancelCues, cueForSummary, cueForVerdict, playCue, resetCueEvents } from "../game/sfx";
import { classifyCapture } from "../game/vad";
import { normalizedWord, weakWordsFromResult } from "../scoreUtils";
import type {
  AttemptKey,
  CaptureStopReason,
  CaptureSummary,
  PhonemeStat,
  RunAction,
  RunBestReceipt,
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
  | "prepareRunAudio"
  | "startRunCapture"
  | "stopRunCapture"
  | "cancelRunCapture"
  | "runCaptureTelemetry"
  | "playCorrect"
  | "stopCurrentSpeech"
  | "speakingText"
  | "speechStatus"
  | "speechCurrentTime"
  | "speechDuration"
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
  // True from an accepted Start or Play again until its deck is in or the start is abandoned, so the
  // run owns navigation while the deck loads.
  const [starting, setStarting] = useState(false);
  // Decided once when a rated run ends and kept for the run's lifetime, across summary and
  // review remounts, so later storage changes never alter it.
  const [receipt, setReceipt] = useState<RunBestReceipt | null>(null);
  const receiptRunRef = useRef<string | null>(null);
  // Feedback already shown this run (pops, rolls, haptics, announcements); live, never re-renders.
  const [consumedFeedbackIds, setConsumedFeedbackIds] = useState<Set<string>>(() => new Set());
  const preferences = useRunPreferences();

  function resetRunLifetime() {
    receiptRunRef.current = null;
    setReceipt(null);
    setConsumedFeedbackIds(new Set());
    resetCueEvents();
  }

  // Facts are final before anything renders: the receipt and cues come from the same transition.
  function settle(previous: RunState | null, next: RunState, action: RunAction) {
    if (action.type === "SCORE_RECEIVED" && !next.paused) {
      const item = next.items.find((candidate) => candidate.prompt.itemId === action.key.itemId);
      const attempt = item?.attempts.find((candidate) => candidate.key.attemptId === action.key.attemptId);
      if (item && attempt) {
        playCue(cueForVerdict(item.verdict, tierForAccuracy(validAccuracy(attempt))), attempt.key.attemptId);
      }
    }
    if (next.endReason === null || previous?.endReason !== null || receiptRunRef.current === next.runId) return;
    receiptRunRef.current = next.runId;
    const score = selectRunScore(next);
    setReceipt(finalizeRunBest(bestBucketForRun(next), next.runId, score));
    if (!next.paused) playCue(cueForSummary(score), `summary-${next.runId}`);
  }

  function dispatch(action: RunAction): RunState | null {
    const previous = stateRef.current;
    const next = runReducer(previous, action);
    if (next === previous) return next;
    stateRef.current = next;
    if (next) settle(previous, next, action);
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

  function cancelCapture(reason: CaptureStopReason) {
    if (captureRef.current) session.cancelRunCapture(reason);
  }

  // Unlocks run audio inside the Start or Play again gesture, before any await.
  async function start(mode: RunMode, previousWeakWords: readonly string[] = []) {
    session.prepareRunAudio();
    startTokenRef.current += 1;
    const token = startTokenRef.current;
    setStarting(true);
    try {
      const [phonemeStats, vocabulary] = await Promise.all([
        fetchPhonemeStats().catch((): PhonemeStat[] => []),
        listWords().catch((): VocabularyItem[] => [])
      ]);
      if (startTokenRef.current !== token) return;
      const prompts = buildRunDeck({ phonemeStats, vocabulary, previousWeakWords });
      // Replacing a run keeps the session's run audio that this gesture just unlocked.
      if (stateRef.current) teardown(true);
      session.enterRun();
      resetRunLifetime();
      dispatch({ type: "START", runId: newId("run"), mode, prompts });
    } finally {
      // A newer start owns the flag; exit has already cleared it.
      if (startTokenRef.current === token) setStarting(false);
    }
  }

  async function record() {
    const current = stateRef.current;
    if (!current || captureRef.current || !canRecord(current)) return;
    const capture = nextCapture(current);
    if (!capture) return;
    const { itemId, kind } = current.items[current.index].prompt;
    const key = { runId: current.runId, itemId, attemptId: newId("attempt") };
    if (dispatch({ type: "BEGIN_CAPTURE", key, ...capture }) === current) return;
    captureRef.current = key;
    let started = false;
    try {
      // Each take keeps the auto-stop preference it started with.
      const options = { key, kind, autoStop: getRunPreferences().autoStop };
      started = await session.startRunCapture(options, (blob, summary) => handleBlob(key, kind, blob, summary));
    } catch (err) {
      // Only the take still being captured in this run may report its failure.
      const active = stateRef.current;
      if (active?.runId === key.runId && active.activeAttemptId === key.attemptId) {
        session.setError(err instanceof Error ? err.message : "Could not start the microphone.");
      }
    }
    if (!started) {
      if (captureRef.current === key) captureRef.current = null;
      dispatch({ type: "CANCEL_CAPTURE", key });
    }
  }

  function handleBlob(key: AttemptKey, kind: RunPrompt["kind"], blob: Blob, summary: CaptureSummary) {
    if (captureRef.current?.attemptId === key.attemptId) captureRef.current = null;
    if (summary.captureId !== key.attemptId) return;
    // Local decisions come before anything is sent or kept: no budget, no review URL.
    const disposition = classifyCapture(summary, kind);
    if (disposition === "discard") {
      dispatch({ type: "CANCEL_CAPTURE", key });
      return;
    }
    if (disposition !== "submit") {
      dispatch({ type: "LOCAL_REJECT", key, reason: disposition });
      return;
    }
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
    if (captureRef.current) session.stopRunCapture("manual");
  }

  // Abandons the current take without skipping the item or using a score. The lock holds until
  // the take's blob is delivered, so no second capture can start meanwhile.
  function cancelTake() {
    const key = captureRef.current;
    if (!key) return;
    dispatch({ type: "CANCEL_CAPTURE", key });
    session.cancelRunCapture("cancel");
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

  function silenceRunAudio() {
    cancelCues();
    session.stopCurrentSpeech();
  }

  // Each ends the attempt first, so a blob that arrives while the capture
  // stops is discarded.
  // In summary or review the reducer ignores PAUSE, but the voice and cues still stop.
  function pause() {
    runAction("PAUSE");
    cancelCapture("pause");
    silenceRunAudio();
  }

  function quit() {
    runAction("QUIT");
    cancelCapture("quit");
    silenceRunAudio();
  }

  function teardown(replacing: boolean) {
    const current = stateRef.current;
    if (current) dispatch({ type: "EXIT", runId: current.runId });
    cancelCapture(replacing ? "replaced" : "exit");
    releaseAllUrls();
    silenceRunAudio();
    if (!replacing) session.exitRun();
  }

  function exit() {
    startTokenRef.current += 1;
    setStarting(false);
    teardown(false);
    resetRunLifetime();
  }

  async function playAgain() {
    const current = stateRef.current;
    if (current) await start(current.mode, runWeakWords(current));
  }

  const score = useMemo(() => (state ? selectRunScore(state) : null), [state]);
  const suggestions = useMemo(() => (state ? selectReviewSuggestions(state) : []), [state]);
  const topRevisit = useMemo(() => (state ? selectTopRevisit(state) : null), [state]);
  // The bucket comes from the frozen deck; the record itself may change in another tab.
  const currentBest = state ? readBest(bestBucketForRun(state)) : null;

  return {
    state,
    starting,
    attemptAudioUrls,
    score,
    suggestions,
    topRevisit,
    receipt,
    currentBest,
    preferences,
    setPreference: setRunPreference,
    // Persists Auto-stop off, so the next take is manual; no attempt is used.
    useManualStopNextTake: () => setRunPreference("autoStop", false),
    telemetryStore: session.runCaptureTelemetry,
    consumedFeedbackIds: consumedFeedbackIds as ReadonlySet<string>,
    markFeedbackConsumed: (id: string) => void consumedFeedbackIds.add(id),
    reference: {
      text: session.speakingText,
      status: session.speechStatus,
      currentTime: session.speechCurrentTime,
      duration: session.speechDuration
    },
    stopReference: () => session.stopCurrentSpeech(),
    start,
    record,
    stop,
    cancelTake,
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
