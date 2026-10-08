import type { ChangeEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  addWordsFromSession,
  checkPassage,
  createWord,
  deleteMaterialGroup,
  deleteWord,
  getSession,
  importMaterialPack,
  scoreRecording
} from "./api";
import type { MaterialGroupDeleteTarget } from "./components/MaterialLibrary";
import { buildPassageReadAlongParts } from "./components/PassagePlayback";
import {
  countDueWords,
  getDueWordsForReview,
  type WordBankTab
} from "./components/WordBankPanel";
import {
  createLevelMeter,
  createTelemetryStore,
  IDLE_TELEMETRY,
  prepareRunAudio,
  releaseRunAudio,
  runAudioContext,
  type LevelMeter
} from "./game/runAudio";
import { holdMicrophone, resetCueEvents } from "./game/sfx";
import { createVad, type Vad } from "./game/vad";
import { useActivityStats } from "./hooks/useActivityStats";
import { usePhonemeInsights } from "./hooks/usePhonemeInsights";
import { useRecorder, type CaptureStop } from "./hooks/useRecorder";
import { useRecordingPlayback } from "./hooks/useRecordingPlayback";
import { useServerState } from "./hooks/useServerState";
import { useSpeech, type SpeechOptions } from "./hooks/useSpeech";
import { useTheme } from "./hooks/useTheme";
import { validateMaterialPackImportPayload } from "./materialImport";
import { normalizedWord, weakWordsFromResult } from "./scoreUtils";
import type {
  CaptureStopReason,
  CaptureSummary,
  MaterialItem,
  PassageIssue,
  PracticeSession,
  RunCaptureOptions,
  ScoreResult,
  SpeechWordBoundary,
  VocabularyItem,
  WordResult
} from "./types";

const DEFAULT_PASSAGE =
  "The weather changed quickly, but we kept walking through the quiet streets and talked about the plans we wanted to finish this week.";

const WORD_REPLAY_LEAD_IN_SECONDS = 0.15;
const NO_MATCH_MESSAGE = "No speech detected — check your microphone and try again.";

const RUN_SAMPLE_MS = 25;

type PracticeMode = "short" | "long";

// One run take's analysis, from microphone acquisition to handoff.
type RunCapture = {
  id: string;
  kind: RunCaptureOptions["kind"];
  vad: Vad;
  meter: LevelMeter | null;
  timer: number | null;
  startedAt: number | null;
  stopped: boolean;
  releaseMicrophone: () => void;
};
type AppView = "practice" | "insights";
type SidebarPanel = "materials" | "history" | "word-bank";


function materialSpeechCacheKey(material: MaterialItem): string {
  return `material:${material.id}`;
}

function wordSpeechCacheKey(word: string): string {
  return `word:${word.trim().toLowerCase()}`;
}

function wordReplayStartSeconds(word: WordResult): number {
  return Math.max(0, word.offset_ms / 1000 - WORD_REPLAY_LEAD_IN_SECONDS);
}

function activeWordIndexForRecordingTime(words: WordResult[], currentTimeSeconds: number): number {
  if (!Number.isFinite(currentTimeSeconds)) return -1;
  const currentTimeMs = currentTimeSeconds * 1000;
  return words.findIndex((word, index) => {
    const durationEndMs = word.offset_ms + Math.max(word.duration_ms, 0);
    const nextWordStartMs = words[index + 1]?.offset_ms;
    const endMs = Math.max(durationEndMs, nextWordStartMs ?? durationEndMs);
    return currentTimeMs >= word.offset_ms && currentTimeMs < endMs;
  });
}

export function usePracticeSession() {
  const { theme, toggleTheme } = useTheme();

  const [passage, setPassage] = useState(DEFAULT_PASSAGE);
  const [activeMaterial, setActiveMaterial] = useState<MaterialItem | null>(null);
  const passageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [issues, setIssues] = useState<PassageIssue[]>([]);
  const [selectedWordIndex, setSelectedWordIndex] = useState(0);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [noMatchNotice, setNoMatchNotice] = useState("");

  const [appView, setAppView] = useState<AppView>("practice");
  const [expandedSidebarPanel, setExpandedSidebarPanel] = useState<SidebarPanel | null>("materials");
  const [activeCoachPhoneme, setActiveCoachPhoneme] = useState<string | null>(null);

  const [wordBankTab, setWordBankTab] = useState<WordBankTab>("active");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("short");
  const [status, setStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [isSavingWords, setIsSavingWords] = useState(false);
  const [isImportingMaterials, setIsImportingMaterials] = useState(false);
  const [error, setError] = useState("");
  // A game run owns the shared recorder from enterRun until exitRun, including
  // its pause, summary, and review screens.
  const [runActive, setRunActive] = useState(false);
  const runCaptureRef = useRef<RunCapture | null>(null);
  // The run AudioContext this session prepared; it never closes another owner's.
  const runAudioRef = useRef<AudioContext | null>(null);
  // Changes every audio frame; only subscribers re-render.
  const [runCaptureTelemetry] = useState(createTelemetryStore);

  const {
    health,
    sessions,
    vocabulary,
    materials,
    refreshServerState,
    refreshSessions,
    refreshVocabulary,
    refreshMaterials
  } = useServerState(setError);

  const insights = usePhonemeInsights(practiceGeneratedDrill);
  const activity = useActivityStats();

  const {
    speakingText,
    speechStatus,
    isSpeechBusy,
    speechCurrentTime,
    speechDuration,
    speechWordBoundaries,
    activeSpeechBoundaryIndex,
    preloadSpeech,
    playCorrect,
    pauseCurrentSpeech,
    seekCurrentSpeech,
    skipCurrentSpeech,
    stopCurrentSpeech
  } = useSpeech(setError);

  const shortLimitSeconds = health?.max_audio_seconds ?? 30;
  const longLimitSeconds = health?.max_long_audio_seconds ?? 180;
  const isLongMode = practiceMode === "long";
  const maxMs = (isLongMode && !runActive ? longLimitSeconds : shortLimitSeconds) * 1000;

  const {
    recorderState,
    elapsedMs,
    audioBlob,
    audioUrl,
    recordingStream,
    startRecording: startRecorderCapture,
    stopRecording,
    stopRecordingWith,
    discardRecording,
    resetRecording
  } = useRecorder({
    maxMs,
    onUnsupported: () => setError("This browser cannot access the microphone."),
    onRecordingReady: (_blob, discarded) => {
      if (!discarded) setStatus("Recording ready");
    }
  });

  const {
    seekRequest: recordingPlaybackSeekRequest,
    stopSignal: recordingPlaybackStopSignal,
    playbackTime: recordingPlaybackTime,
    setPlaybackTime: setRecordingPlaybackTime,
    isPlaying: isAudioPlaying,
    setIsPlaying: setIsAudioPlaying,
    duration: audioDuration,
    setDuration: setAudioDuration,
    recordedAmplitudes,
    setRecordedAmplitudes,
    stopPlayback: stopRecordingPlayback,
    seekTo: seekRecordingPlayback,
    resetForNewAudio
  } = useRecordingPlayback();

  const [passageCoachBoundaries, setPassageCoachBoundaries] = useState<SpeechWordBoundary[] | null>(null);
  const [passageCoachDuration, setPassageCoachDuration] = useState<number>(0);
  const [passageCoachText, setPassageCoachText] = useState<string>("");

  useEffect(() => {
    const trimmedPassage = passage.trim().toLowerCase();
    const trimmedSpeaking = speakingText.trim().toLowerCase();
    const trimmedCoach = passageCoachText.trim().toLowerCase();

    // 1. Capture boundaries if the speech hook is loading/playing the current passage
    if (speakingText && trimmedSpeaking === trimmedPassage) {
      if (speechWordBoundaries && speechWordBoundaries.length > 0) {
        setPassageCoachBoundaries(speechWordBoundaries);
        setPassageCoachText(speakingText);
      }
      if (speechDuration > 0) {
        setPassageCoachDuration(speechDuration);
      }
    }

    // 2. Clear captured boundaries if the passage input has changed and no longer matches
    if (passageCoachText && trimmedCoach !== trimmedPassage) {
      setPassageCoachBoundaries(null);
      setPassageCoachDuration(0);
      setPassageCoachText("");
    }
  }, [speakingText, speechWordBoundaries, speechDuration, passage, passageCoachText]);

  const selectedWord = result?.words[selectedWordIndex] ?? null;
  const weakWords = useMemo(() => (result ? weakWordsFromResult(result) : []), [result]);
  const trimmedPassage = passage.trim();
  const isPassageSpeechActive = Boolean(trimmedPassage && speakingText === trimmedPassage);
  const isPassageSpeechLoading = isPassageSpeechActive && speechStatus === "loading";
  const isPassageSpeechPlaying = isPassageSpeechActive && speechStatus === "playing";
  const activeRecordingWordIndex = useMemo(
    () =>
      audioUrl &&
      result?.words?.length &&
      (recordingPlaybackSeekRequest !== null || recordingPlaybackTime > 0)
        ? activeWordIndexForRecordingTime(result.words, recordingPlaybackTime)
        : -1,
    [audioUrl, recordingPlaybackSeekRequest, recordingPlaybackTime, result?.words]
  );
  const activeSpokenWordIndex = useMemo(
    () =>
      isPassageSpeechActive && activeSpeechBoundaryIndex >= 0
        ? activeSpeechBoundaryIndex
        : activeRecordingWordIndex,
    [activeRecordingWordIndex, activeSpeechBoundaryIndex, isPassageSpeechActive]
  );
  const passageSpeechOptions: SpeechOptions | undefined = activeMaterial
    ? { cacheKey: materialSpeechCacheKey(activeMaterial) }
    : undefined;
  const readAlongParts = useMemo(
    () =>
      isPassageSpeechActive && !result?.words?.length
        ? buildPassageReadAlongParts(passage, speechWordBoundaries)
        : [],
    [isPassageSpeechActive, passage, result?.words?.length, speechWordBoundaries]
  );
  const showPassageReadAlong = readAlongParts.length > 0;

  useLayoutEffect(() => {
    const input = passageInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.overflowY = "hidden";
    input.style.height = `${input.scrollHeight}px`;
  }, [passage, result?.words?.length, showPassageReadAlong]);

  const savedWords = useMemo(
    () => new Set(vocabulary.map((item) => normalizedWord(item.word))),
    [vocabulary]
  );
  const requiredSuccesses = health?.vocabulary_graduation_streak ?? 2;
  const dueWordCount = useMemo(() => countDueWords(vocabulary), [vocabulary]);

  // Guided "Review due words" session: a frozen snapshot of due words taken
  // when the review starts, walked one word at a time via the existing
  // single-word practice flow. reviewIndex -1 means no review is active.
  const [reviewQueue, setReviewQueue] = useState<VocabularyItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState(-1);
  const [reviewJustScored, setReviewJustScored] = useState(false);
  const [reviewSummaryCount, setReviewSummaryCount] = useState<number | null>(null);
  const [reviewScoredCount, setReviewScoredCount] = useState(0);
  const isReviewActive = reviewIndex >= 0 && reviewIndex < reviewQueue.length;
  // "Practiced" latch for the word currently at reviewIndex: flips true the
  // moment a score for it is accepted (passes the context-token check below),
  // and stays true regardless of a later re-record or a failed ancillary
  // refresh. showNextReviewWord consults this — not reviewJustScored, which
  // is reset on re-record and exists only for the button label/highlight.
  const reviewWordScoredRef = useRef(false);

  // Bumped whenever the practice context changes (next/end review, loading a
  // material or history session, or otherwise resetting practice). A scoring
  // request captures the token when it starts; if the token has moved on by
  // the time the response arrives, the response no longer matches what's on
  // screen and is dropped rather than applied.
  const practiceContextRef = useRef(0);
  const scoreRequestRef = useRef(0);
  // Bumped when a new take starts. A request for an earlier take of the same
  // word may still latch "practiced", but never changes what's on screen.
  const takeRef = useRef(0);
  function bumpPracticeContext() {
    practiceContextRef.current += 1;
  }

  useEffect(() => {
    void refreshServerState();
  }, [refreshServerState]);

  useEffect(() => {
    return () => {
      stopCurrentSpeech();
    };
  }, [audioUrl, stopCurrentSpeech]);

  useEffect(() => {
    resetForNewAudio();
  }, [audioUrl, resetForNewAudio]);

  useEffect(() => {
    if (selectedWord?.word) {
      void preloadSpeech(selectedWord.word, { cacheKey: wordSpeechCacheKey(selectedWord.word) });
    }
  }, [selectedWord?.word, preloadSpeech]);

  useEffect(() => {
    if (runActive) return;
    for (const word of weakWords.slice(0, 5)) {
      void preloadSpeech(word.word, { cacheKey: wordSpeechCacheKey(word.word) });
    }
  }, [runActive, weakWords, preloadSpeech]);

  async function startRecording() {
    takeRef.current += 1;
    setError("");
    setStatus("");
    stopCurrentSpeech();
    stopRecordingPlayback();
    const started = await startRecorderCapture();
    if (!started) {
      return;
    }
    setResult(null);
    setCurrentSessionId("");
    setNoMatchNotice("");
    setSelectedWordIndex(0);
    setRecordedAmplitudes(null);
    setIsAudioPlaying(false);
    setAudioDuration(0);
    if (isReviewActive) {
      setReviewJustScored(false);
    }
  }

  async function submitRecording() {
    if (!audioBlob) {
      return;
    }
    const requestContext = practiceContextRef.current;
    const requestTake = takeRef.current;
    const isOnScreen = () =>
      practiceContextRef.current === requestContext && takeRef.current === requestTake;
    scoreRequestRef.current += 1;
    const requestId = scoreRequestRef.current;
    // An older request settling late must not clear a newer request's busy state.
    const releaseScoring = () => {
      if (scoreRequestRef.current === requestId) setIsScoring(false);
    };
    setIsScoring(true);
    setError("");
    setStatus(isLongMode ? "Scoring long passage" : "Scoring pronunciation");
    let sessionId: string;
    try {
      const response = await scoreRecording(passage, audioBlob, practiceMode);
      if (practiceContextRef.current !== requestContext) {
        // The user moved on (next/end review, loaded a material or history
        // session, or reset practice) while this request was in flight. The
        // response no longer matches what's on screen, so drop it silently.
        return;
      }
      if (response.result.recognition_status === "no_match") {
        if (!isOnScreen()) return;
        setResult(null);
        setCurrentSessionId("");
        setNoMatchNotice(NO_MATCH_MESSAGE);
        setStatus("");
        return;
      }
      if (!response.session) {
        throw new Error("Scoring succeeded but no session was returned.");
      }

      // The score was genuinely accepted for the word/passage on screen right
      // now (the token check above just confirmed it). Show it and latch
      // "practiced" before word collection, so neither waits on or depends on
      // the ancillary work below.
      if (isReviewActive) {
        reviewWordScoredRef.current = true;
      }
      sessionId = response.session.id;
      // A newer take of the same word keeps its own screen; this score is
      // still saved and its words still collected below.
      if (isOnScreen()) {
        if (isReviewActive) {
          setReviewJustScored(true);
        }
        setNoMatchNotice("");
        setResult(response.result);
        setCurrentSessionId(sessionId);
        setSelectedWordIndex(0);
        setStatus("Score complete");
      }
    } catch (err) {
      if (isOnScreen()) {
        setError(err instanceof Error ? err.message : "Scoring failed.");
        setStatus("");
      }
      return;
    } finally {
      releaseScoring();
    }

    try {
      const addedWords = await addWordsFromSession(sessionId);
      // Scoring only changes history and the word bank; skip refetching
      // materials and health.
      await Promise.all([refreshSessions(), refreshVocabulary()]);
      void activity.loadActivityStats();
      if (isOnScreen() && addedWords.length) {
        setStatus(`Score complete · ${addedWords.length} weak words saved`);
      }
    } catch (err) {
      // The score stands; only the word bank or history refresh failed.
      if (isOnScreen()) {
        setError(
          `Score saved, but the word bank could not be updated${
            err instanceof Error ? `: ${err.message}` : "."
          }`
        );
      }
    }
  }

  async function runPassageCheck() {
    setIsChecking(true);
    setError("");
    try {
      const response = await checkPassage(passage);
      setIssues(response.issues ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passage check failed.");
    } finally {
      setIsChecking(false);
    }
  }

  function exitReviewIfActive() {
    if (reviewIndex < 0 && reviewQueue.length === 0 && reviewSummaryCount === null) return;
    setReviewQueue([]);
    setReviewIndex(-1);
    setReviewJustScored(false);
    setReviewSummaryCount(null);
    setReviewScoredCount(0);
    reviewWordScoredRef.current = false;
  }

  async function loadSession(session: PracticeSession) {
    exitReviewIfActive();
    bumpPracticeContext();
    setError("");
    setStatus("Loading history");
    try {
      const loaded = await getSession(session.id);
      setActiveMaterial(null);
      setPassage(loaded.reference_text);
      setNoMatchNotice("");
      setIssues([]);
      setResult({
        transcript: loaded.reference_text,
        scores: loaded.scores,
        segments: loaded.segments ?? [],
        words: loaded.words ?? [],
        warnings: loaded.warnings ?? [],
        raw: loaded.raw ?? {}
      });
      setCurrentSessionId(loaded.id);
      setSelectedWordIndex(0);
      setRecordedAmplitudes(null);
      setAudioDuration(0);
      setStatus("History loaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history.");
      setStatus("");
    }
  }

  async function addManualWord(word: string) {
    setIsSavingWords(true);
    setError("");
    try {
      await createWord(word);
      setWordBankTab("active");
      await refreshVocabulary();
      setStatus(`${word} added to word bank`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add word.");
      throw err;
    } finally {
      setIsSavingWords(false);
    }
  }

  async function saveWeakWord(word: WordResult) {
    setIsSavingWords(true);
    setError("");
    try {
      await createWord(word.word);
      setWordBankTab("active");
      await refreshVocabulary();
      setStatus(`${word.word} saved`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save word.");
    } finally {
      setIsSavingWords(false);
    }
  }

  async function saveWeakWords() {
    if (!weakWords.length) {
      return;
    }
    setIsSavingWords(true);
    setError("");
    try {
      if (currentSessionId) {
        await addWordsFromSession(currentSessionId);
      } else {
        await Promise.all(weakWords.map((word) => createWord(word.word)));
      }
      setWordBankTab("active");
      await refreshVocabulary();
      setStatus("Weak words saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save weak words.");
    } finally {
      setIsSavingWords(false);
    }
  }

  async function removeVocabularyWord(wordId: string) {
    setError("");
    try {
      await deleteWord(wordId);
      await refreshVocabulary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete word.");
    }
  }

  function resetPractice() {
    bumpPracticeContext();
    reviewWordScoredRef.current = false;
    stopCurrentSpeech();
    stopRecordingPlayback();
    resetRecording();
    setResult(null);
    setCurrentSessionId("");
    setNoMatchNotice("");
    setSelectedWordIndex(0);
    setRecordedAmplitudes(null);
    setAudioDuration(0);
  }

  function enterRun() {
    exitReviewIfActive();
    // A normal take still stopping must not reappear in, or after, the run.
    discardRecording();
    resetPractice();
    setError("");
    setStatus("");
    setRunActive(true);
  }

  function exitRun() {
    cancelRunCapture("exit");
    resetPractice();
    setRunActive(false);
    resetCueEvents();
    releaseRunAudio(runAudioRef.current);
    runAudioRef.current = null;
    runCaptureTelemetry.set(IDLE_TELEMETRY);
  }

  function prepareSessionRunAudio() {
    runAudioRef.current = prepareRunAudio();
  }

  // Leaving the page or the gate: no analysis timer, meter, cue hold, or run context outlives it.
  // The recorder's own unmount stops the microphone and releases started captures.
  const disposeRunRef = useRef(() => {});
  disposeRunRef.current = () => {
    const capture = runCaptureRef.current;
    if (capture) {
      finishRunAnalysis(capture);
      if (capture.startedAt === null) capture.releaseMicrophone();
    }
    releaseRunAudio(runAudioRef.current);
  };
  useEffect(() => () => disposeRunRef.current(), []);

  function publishRunTelemetry(capture: RunCapture) {
    if (capture.startedAt === null) return;
    const snapshot = capture.vad.snapshot();
    runCaptureTelemetry.set({
      captureId: capture.id,
      level: snapshot.level,
      silenceProgress: snapshot.silenceProgress,
      autoStopState: capture.stopped ? "stopping" : snapshot.autoStopState,
      elapsedMs: performance.now() - capture.startedAt
    });
  }

  // Ends analysis at the accepted stop: no more frames, decisions, or open audio nodes.
  function finishRunAnalysis(capture: RunCapture) {
    if (capture.stopped) return;
    capture.stopped = true;
    if (capture.timer !== null) window.clearInterval(capture.timer);
    capture.timer = null;
    try {
      capture.meter?.dispose();
    } catch {
      // The context may already be closed.
    }
    publishRunTelemetry(capture);
  }

  function sampleRunCapture(capture: RunCapture) {
    if (capture.stopped || capture.startedAt === null) return;
    if (capture.meter) {
      const reason = capture.vad.push({
        dbfs: capture.meter.read(),
        tMs: performance.now() - capture.startedAt,
        contextRunning: runAudioContext()?.state === "running",
        hidden: document.visibilityState === "hidden"
      });
      // The recorder's latch makes this one stop among manual, hard-cap and cancel.
      if (reason && runCaptureRef.current === capture) {
        stopRecordingWith(reason);
        return;
      }
    }
    publishRunTelemetry(capture);
  }

  function runCaptureSummary(capture: RunCapture, stop: CaptureStop): CaptureSummary {
    const snapshot = capture.vad.snapshot();
    return Object.freeze({
      captureId: capture.id,
      stopReason: stop.reason,
      durationMs: stop.durationMs,
      detectionValid: capture.meter !== null && snapshot.detectionValid,
      speechSeen: snapshot.speechSeen,
      voicedMs: snapshot.voicedMs
    });
  }

  // Starts one run capture on the shared recorder. The run passes a callback
  // closed over its attempt ID; true means that callback will receive this
  // capture's blob and frozen summary exactly once, even after cancellation,
  // so the run must not start another capture until it has. Cues stay silent
  // from here until that handoff.
  async function startRunCapture(
    options: RunCaptureOptions,
    onReady: (blob: Blob, summary: CaptureSummary) => void
  ): Promise<boolean> {
    const previous = runCaptureRef.current;
    if (previous && !previous.stopped) cancelRunCapture("replaced");
    stopCurrentSpeech();
    stopRecordingPlayback();
    const capture: RunCapture = {
      id: options.key.attemptId,
      kind: options.kind,
      vad: createVad(options.kind, { autoStop: options.autoStop }),
      meter: null,
      timer: null,
      startedAt: null,
      stopped: false,
      releaseMicrophone: holdMicrophone()
    };
    runCaptureRef.current = capture;
    let started = false;
    try {
      started = await startRecorderCapture(
        (blob, _discarded, stop) => {
          finishRunAnalysis(capture);
          if (runCaptureTelemetry.get().captureId === capture.id) runCaptureTelemetry.set(IDLE_TELEMETRY);
          onReady(blob, runCaptureSummary(capture, stop));
        },
        {
          onStream: (stream) => {
            capture.meter = createLevelMeter(stream);
          },
          onStart: (startedAt) => {
            capture.startedAt = startedAt;
            // Without analysis the take is manual only, never fabricated silence.
            if (!capture.meter) capture.vad = createVad(capture.kind, { autoStop: false });
            publishRunTelemetry(capture);
            capture.timer = window.setInterval(() => sampleRunCapture(capture), RUN_SAMPLE_MS);
          },
          onStop: () => finishRunAnalysis(capture),
          // Cues may play again only once this take's microphone tracks have stopped.
          onRelease: () => capture.releaseMicrophone()
        }
      );
    } finally {
      // Not started: denied, failed after the recorder released its stream, or made obsolete while
      // permission was pending (its late stream is stopped on arrival). The run's lock settles here.
      if (!started) {
        finishRunAnalysis(capture);
        capture.releaseMicrophone();
      }
    }
    return started;
  }

  function stopRunCapture(reason: CaptureStopReason = "manual") {
    const capture = runCaptureRef.current;
    if (capture && !capture.stopped) stopRecordingWith(reason);
  }

  // The take's late onstop still reaches the run's callback, but never the
  // shared preview that normal Score and Enter read.
  function cancelRunCapture(reason: CaptureStopReason = "cancel") {
    const capture = runCaptureRef.current;
    if (capture) {
      // Still waiting for permission: no stream is open, and the obsolete one will be stopped.
      if (capture.startedAt === null) capture.releaseMicrophone();
    }
    discardRecording(reason);
  }

  function practiceVocabularyWord(item: VocabularyItem, options?: { fromReview?: boolean }) {
    if (!options?.fromReview) {
      exitReviewIfActive();
    }
    resetPractice();
    setActiveMaterial(null);
    setPassage(item.word);
    setStatus("Word drill ready");
  }

  function practiceMaterial(material: MaterialItem) {
    exitReviewIfActive();
    resetPractice();
    setActiveMaterial(material);
    setPassage(material.text);
    setIssues([]);
    setStatus(`Material ready: ${material.title}`);
  }

  function startReview() {
    const snapshot = getDueWordsForReview(vocabulary);
    if (snapshot.length === 0) {
      return;
    }
    setReviewQueue(snapshot);
    setReviewIndex(0);
    setReviewJustScored(false);
    setReviewSummaryCount(null);
    setReviewScoredCount(0);
    practiceVocabularyWord(snapshot[0], { fromReview: true });
  }

  function showNextReviewWord() {
    // reviewWordScoredRef — not reviewJustScored — is the source of truth for
    // the tally: it latches true the instant a score is accepted and, unlike
    // reviewJustScored, survives a re-record of the same word.
    const scoredCountAfterThisWord = reviewScoredCount + (reviewWordScoredRef.current ? 1 : 0);
    const nextIndex = reviewIndex + 1;
    if (nextIndex >= reviewQueue.length) {
      bumpPracticeContext();
      reviewWordScoredRef.current = false;
      setReviewSummaryCount(reviewQueue.length);
      setReviewScoredCount(scoredCountAfterThisWord);
      setReviewQueue([]);
      setReviewIndex(-1);
      setReviewJustScored(false);
      return;
    }
    setReviewScoredCount(scoredCountAfterThisWord);
    setReviewIndex(nextIndex);
    setReviewJustScored(false);
    practiceVocabularyWord(reviewQueue[nextIndex], { fromReview: true });
  }

  function endReview() {
    exitReviewIfActive();
    bumpPracticeContext();
  }

  async function importMaterialFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    setIsImportingMaterials(true);
    setError("");
    try {
      const payload = validateMaterialPackImportPayload(JSON.parse(await file.text()));
      const imported = await importMaterialPack(payload);
      await refreshMaterials();
      setStatus(`${imported.materials.length} materials imported`);
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "Material JSON is invalid."
          : err instanceof Error
          ? err.message
          : "Could not import materials."
      );
    } finally {
      input.value = "";
      setIsImportingMaterials(false);
    }
  }

  async function deleteMaterialGroupFromLibrary(group: MaterialGroupDeleteTarget) {
    setError("");
    try {
      const result = await deleteMaterialGroup(group.packId, group.book);
      await refreshMaterials();
      if (
        activeMaterial &&
        activeMaterial.pack_id === group.packId &&
        (activeMaterial.book || "") === group.book
      ) {
        setActiveMaterial(null);
      }
      setStatus(`Deleted ${result.deleted} materials from ${group.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete material group.");
      throw err;
    }
  }

  function practiceGeneratedDrill(material: MaterialItem) {
    void refreshMaterials();
    practiceMaterial(material);
    setAppView("practice");
  }

  function startDrillFromInsights(word: string) {
    exitReviewIfActive();
    resetPractice();
    setActiveMaterial(null);
    setPassage(word);
    setPracticeMode("short");
    setIssues([]);
    setStatus(`Drill ready: ${word}`);
    setAppView("practice");
  }

  function selectWeakWord(word: WordResult) {
    if (!result) {
      return;
    }
    const index = result.words.findIndex((candidate) => candidate === word);
    if (index >= 0) {
      setSelectedWordIndex(index);
    }
  }

  function handleVisualizerSeek(timeSeconds: number) {
    seekRecordingPlayback(timeSeconds, isAudioPlaying);
  }

  function handleTrackClick(track: "coach" | "user", timeSeconds: number, percent?: number) {
    if (track === "coach") {
      stopRecordingPlayback();
      playPronunciation(passage, passageSpeechOptions, timeSeconds, percent);
    } else {
      stopCurrentSpeech();
      seekRecordingPlayback(timeSeconds, true);
      setIsAudioPlaying(true);
    }
  }

  function selectScoredWord(index: number) {
    setSelectedWordIndex(index);
    const word = result?.words[index];
    if (!word || !audioUrl) {
      return;
    }

    stopCurrentSpeech();
    seekRecordingPlayback(wordReplayStartSeconds(word), true);
  }

  function playPronunciation(
    text: string,
    options?: SpeechOptions,
    startAtSeconds?: number,
    startAtPercent?: number
  ) {
    stopRecordingPlayback();
    void playCorrect(text, options, startAtSeconds, startAtPercent);
  }

  // Single words get a stable cache key so the synthesized audio persists in
  // the server speech cache and is reused across reloads instead of re-hitting
  // Azure TTS each time.
  function playWord(text: string) {
    playPronunciation(text, { cacheKey: wordSpeechCacheKey(text) });
  }

  function seekPassageReadAlongWord(boundary: SpeechWordBoundary | undefined) {
    if (!boundary) {
      return;
    }
    seekCurrentSpeech(boundary.audio_offset_ms / 1000);
    if (speechStatus !== "playing") {
      playPronunciation(passage, passageSpeechOptions);
    }
  }

  function togglePassageSpeech() {
    if (isPassageSpeechActive && speechStatus === "playing") {
      pauseCurrentSpeech();
      return;
    }
    if (isPassageSpeechActive && speechStatus === "loading") {
      stopCurrentSpeech();
      return;
    }
    playPronunciation(passage, passageSpeechOptions);
  }

  function preloadCurrentPassage() {
    void preloadSpeech(passage, passageSpeechOptions);
  }

  const shortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcutHandlerRef.current = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (runActive) return;
    if (appView !== "practice" || activeCoachPhoneme) return;
    // Keep native keyboard behavior on focused interactive elements: typing in
    // fields, and Space/Enter activation of buttons and links.
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest("button, a, input, textarea, select, [role='button'], [role='link']"))
    ) {
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      if (isAudioPlaying) {
        stopRecordingPlayback();
      } else if (isSpeechBusy && !isPassageSpeechActive) {
        stopCurrentSpeech();
      } else if (trimmedPassage) {
        togglePassageSpeech();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Enter advances the practice loop: record -> stop -> score -> record again.
      // Shift+Enter re-records without scoring the pending take.
      if (recorderState === "recording") {
        stopRecording();
      } else if (isScoring) {
        return;
      } else if (!event.shiftKey && audioBlob && !result) {
        void submitRecording();
      } else {
        void startRecording();
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => shortcutHandlerRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handlePassageChange(event: ChangeEvent<HTMLTextAreaElement>) {
    if (activeMaterial) return;
    setPassage(event.target.value);
  }

  function copyMaterialToFreePractice() {
    setActiveMaterial(null);
    setStatus("Copied to free practice");
  }

  function toggleSidebarPanel(panel: SidebarPanel) {
    setExpandedSidebarPanel((current) => (current === panel ? null : panel));
  }

  const isCoachDataMatching = passageCoachText.trim().toLowerCase() === passage.trim().toLowerCase();


  return {
    // --- core practice state（移动端也要用）---
    theme,
    toggleTheme,
    passage,
    setPassage,
    activeMaterial,
    setActiveMaterial,
    passageInputRef,
    issues,
    setIssues,
    selectedWordIndex,
    setSelectedWordIndex,
    result,
    setResult,
    currentSessionId,
    setCurrentSessionId,
    noMatchNotice,
    setNoMatchNotice,
    activeCoachPhoneme,
    setActiveCoachPhoneme,
    practiceMode,
    setPracticeMode,
    status,
    setStatus,
    isChecking,
    setIsChecking,
    isScoring,
    setIsScoring,
    isSavingWords,
    setIsSavingWords,
    isImportingMaterials,
    setIsImportingMaterials,
    error,
    setError,
    health,
    sessions,
    vocabulary,
    materials,
    refreshServerState,
    refreshSessions,
    refreshVocabulary,
    refreshMaterials,
    insights,
    activity,
    speakingText,
    speechStatus,
    isSpeechBusy,
    speechCurrentTime,
    speechDuration,
    speechWordBoundaries,
    activeSpeechBoundaryIndex,
    preloadSpeech,
    playCorrect,
    pauseCurrentSpeech,
    seekCurrentSpeech,
    skipCurrentSpeech,
    stopCurrentSpeech,
    shortLimitSeconds,
    longLimitSeconds,
    isLongMode,
    maxMs,
    recorderState,
    elapsedMs,
    audioBlob,
    audioUrl,
    recordingStream,
    startRecorderCapture,
    stopRecording,
    resetRecording,
    recordingPlaybackSeekRequest,
    recordingPlaybackStopSignal,
    recordingPlaybackTime,
    setRecordingPlaybackTime,
    isAudioPlaying,
    setIsAudioPlaying,
    audioDuration,
    setAudioDuration,
    recordedAmplitudes,
    setRecordedAmplitudes,
    stopRecordingPlayback,
    seekRecordingPlayback,
    resetForNewAudio,
    passageCoachBoundaries,
    setPassageCoachBoundaries,
    passageCoachDuration,
    setPassageCoachDuration,
    passageCoachText,
    setPassageCoachText,
    selectedWord,
    weakWords,
    trimmedPassage,
    isPassageSpeechActive,
    isPassageSpeechLoading,
    isPassageSpeechPlaying,
    activeRecordingWordIndex,
    activeSpokenWordIndex,
    passageSpeechOptions,
    readAlongParts,
    showPassageReadAlong,
    savedWords,
    requiredSuccesses,
    dueWordCount,
    reviewQueue,
    setReviewQueue,
    reviewIndex,
    setReviewIndex,
    reviewJustScored,
    setReviewJustScored,
    reviewSummaryCount,
    setReviewSummaryCount,
    reviewScoredCount,
    setReviewScoredCount,
    isReviewActive,
    reviewWordScoredRef,
    practiceContextRef,
    bumpPracticeContext,
    startRecording,
    submitRecording,
    runPassageCheck,
    exitReviewIfActive,
    loadSession,
    addManualWord,
    saveWeakWord,
    saveWeakWords,
    removeVocabularyWord,
    resetPractice,
    practiceVocabularyWord,
    practiceMaterial,
    startReview,
    showNextReviewWord,
    endReview,
    importMaterialFile,
    deleteMaterialGroupFromLibrary,
    practiceGeneratedDrill,
    startDrillFromInsights,
    selectWeakWord,
    handleVisualizerSeek,
    handleTrackClick,
    selectScoredWord,
    playPronunciation,
    playWord,
    seekPassageReadAlongWord,
    togglePassageSpeech,
    preloadCurrentPassage,
    shortcutHandlerRef,
    handlePassageChange,
    copyMaterialToFreePractice,
    toggleSidebarPanel,
    isCoachDataMatching,
    runActive,
    enterRun,
    exitRun,
    prepareRunAudio: prepareSessionRunAudio,
    startRunCapture,
    stopRunCapture,
    cancelRunCapture,
    runCaptureTelemetry,

    // --- desktop shell navigation（移动端会另建导航，可忽略）---
    appView,
    setAppView,
    expandedSidebarPanel,
    setExpandedSidebarPanel,
    wordBankTab,
    setWordBankTab
  };
}
