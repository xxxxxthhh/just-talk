import {
  AlertCircle,
  BookmarkPlus,
  BookOpen,
  BookOpenCheck,
  Clock3,
  Download,
  History,
  Loader2,
  Mic,
  Moon,
  Pause,
  RefreshCw,
  Sparkles,
  Square,
  Sun,
  UploadCloud,
  Volume2
} from "lucide-react";
import type { ChangeEvent } from "react";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
import { AudioPlayer } from "./components/AudioPlayer";
import { AudioVisualizer } from "./components/AudioVisualizer";
import { BrandMark } from "./components/BrandMark";
import { HistoryList } from "./components/HistoryList";
import {
  MaterialImportAction,
  MaterialLibrary,
  type MaterialGroupDeleteTarget
} from "./components/MaterialLibrary";
import {
  buildPassageReadAlongParts,
  PassageAudioControls,
  PassageReadAlong
} from "./components/PassagePlayback";
import { ResultsPanel } from "./components/ResultsPanel";
import { ScoredPassage } from "./components/ScoredPassage";
import { SidebarSection } from "./components/SidebarSection";
import { StatusPill } from "./components/StatusPill";
import {
  countDueWords,
  getDueWordsForReview,
  WordBankPanel,
  type WordBankTab
} from "./components/WordBankPanel";
import { useActivityStats } from "./hooks/useActivityStats";
import { usePhonemeInsights } from "./hooks/usePhonemeInsights";
import { useRecorder } from "./hooks/useRecorder";
import { useRecordingPlayback } from "./hooks/useRecordingPlayback";
import { useServerState } from "./hooks/useServerState";
import { useSpeech, type SpeechOptions } from "./hooks/useSpeech";
import { useTheme } from "./hooks/useTheme";
import { validateMaterialPackImportPayload } from "./materialImport";
import { normalizedWord, weakWordsFromResult } from "./scoreUtils";
import type {
  MaterialItem,
  PassageIssue,
  PracticeSession,
  ScoreResult,
  SpeechWordBoundary,
  VocabularyItem,
  WordResult
} from "./types";

const DEFAULT_PASSAGE =
  "The weather changed quickly, but we kept walking through the quiet streets and talked about the plans we wanted to finish this week.";

const WORD_REPLAY_LEAD_IN_SECONDS = 0.15;
const NO_MATCH_MESSAGE = "No speech detected — check your microphone and try again.";

type PracticeMode = "short" | "long";
type AppView = "practice" | "insights";
type SidebarPanel = "materials" | "history" | "word-bank";

// Lazy-loaded so the phoneme guide data, mouth visualizer, and coach card
// (only reachable through these two) stay out of the initial bundle.
const InsightsPanel = lazy(() =>
  import("./components/InsightsPanel").then((module) => ({ default: module.InsightsPanel }))
);
const PhonemeCoachModal = lazy(() =>
  import("./components/PhonemeCoachModal").then((module) => ({ default: module.PhonemeCoachModal }))
);

const lazyPanelFallback = (
  <div style={{ display: "flex", justifyContent: "center", padding: "2rem" }}>
    <Loader2 className="spin" size={20} />
  </div>
);

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

function App() {
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
  const maxMs = (isLongMode ? longLimitSeconds : shortLimitSeconds) * 1000;

  const {
    recorderState,
    elapsedMs,
    audioBlob,
    audioUrl,
    recordingStream,
    startRecording: startRecorderCapture,
    stopRecording,
    resetRecording
  } = useRecorder({
    maxMs,
    onUnsupported: () => setError("This browser cannot access the microphone."),
    onRecordingReady: () => setStatus("Recording ready")
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
    for (const word of weakWords.slice(0, 5)) {
      void preloadSpeech(word.word, { cacheKey: wordSpeechCacheKey(word.word) });
    }
  }, [weakWords, preloadSpeech]);

  async function startRecording() {
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
    setIsScoring(true);
    setError("");
    setStatus(isLongMode ? "Scoring long passage" : "Scoring pronunciation");
    try {
      const response = await scoreRecording(passage, audioBlob, practiceMode);
      if (practiceContextRef.current !== requestContext) {
        // The user moved on (next/end review, loaded a material or history
        // session, or reset practice) while this request was in flight. The
        // response no longer matches what's on screen, so drop it silently.
        return;
      }
      if (response.result.recognition_status === "no_match") {
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
      // now (the token check above just confirmed it). Latch "practiced" and
      // flip the button label immediately so neither depends on the ancillary
      // refreshes below succeeding, or survives them being abandoned.
      if (isReviewActive) {
        reviewWordScoredRef.current = true;
        setReviewJustScored(true);
      }

      const sessionId = response.session.id;
      const addedWords = await addWordsFromSession(sessionId);
      // Scoring only changes history and the word bank; skip refetching
      // materials and health.
      await Promise.all([refreshSessions(), refreshVocabulary()]);
      void activity.loadActivityStats();

      if (practiceContextRef.current !== requestContext) {
        // The user moved on while these ancillary refreshes were in flight.
        // The score was already latched above; none of this response's
        // display state belongs to whatever is on screen now.
        return;
      }

      setNoMatchNotice("");
      setResult(response.result);
      setCurrentSessionId(sessionId);
      setSelectedWordIndex(0);
      setStatus(
        addedWords.length
          ? `Score complete · ${addedWords.length} weak words saved`
          : "Score complete"
      );
    } catch (err) {
      if (practiceContextRef.current !== requestContext) {
        return;
      }
      setError(err instanceof Error ? err.message : "Scoring failed.");
      setStatus("");
    } finally {
      setIsScoring(false);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <BrandMark />
          </div>
          <div className="brand-copy">
            <h1 className="brand-name">Mimic</h1>
            <p>AI speech coach for clearer English</p>
          </div>
        </div>
        <nav className="view-switch" aria-label="App view">
          <button
            type="button"
            className={`view-tab ${appView === "practice" ? "selected" : ""}`}
            aria-pressed={appView === "practice"}
            onClick={() => setAppView("practice")}
          >
            <Mic size={15} />
            <span>Practice</span>
          </button>
          <button
            type="button"
            className={`view-tab ${appView === "insights" ? "selected" : ""}`}
            aria-pressed={appView === "insights"}
            disabled={recorderState === "recording"}
            title={recorderState === "recording" ? "Stop recording before switching views" : undefined}
            onClick={() => { setAppView("insights"); void insights.loadStats(); void activity.loadActivityStats(); }}
          >
            <Sparkles size={15} />
            <span>Phoneme Insights</span>
          </button>
        </nav>
        <div className="topbar-actions">
          <StatusPill health={health} />
          <a className="icon-button" href="/api/export" download title="Download backup (JSON)">
            <Download size={18} />
          </a>
          <button
            className="icon-button"
            onClick={toggleTheme}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button className="icon-button" onClick={refreshServerState} title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="banner" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {noMatchNotice ? (
        <div className="banner" role="alert">
          <AlertCircle size={18} />
          <span>{noMatchNotice}</span>
        </div>
      ) : null}

      <section className="workspace">
        {appView === "insights" ? (
          <Suspense fallback={lazyPanelFallback}>
            <InsightsPanel
              stats={insights.stats}
              loading={insights.loading}
              error={insights.error}
              expandedPhoneme={insights.expandedPhoneme}
              setExpandedPhoneme={insights.setExpandedPhoneme}
              onDrill={startDrillFromInsights}
              onPlayWord={playWord}
              speakingText={speakingText}
              speechStatus={speechStatus}
              onRefresh={() => { void insights.loadStats(); void activity.loadActivityStats(); }}
              drillsEnabled={Boolean(health?.passage_check_configured)}
              generatingPhoneme={insights.generatingPhoneme}
              drillError={insights.drillError}
              onGenerateDrill={(phoneme) => void insights.generateDrill(phoneme)}
              activityStats={activity.activityStats}
              activityLoading={activity.activityLoading}
              activityError={activity.activityError}
            />
          </Suspense>
        ) : null}
        <aside className="history-panel side-panel" hidden={appView === "insights"}>
          <SidebarSection
            id="materials-section"
            title="Materials"
            icon={<BookOpen size={18} />}
            count={materials.length}
            isExpanded={expandedSidebarPanel === "materials"}
            onToggle={() => toggleSidebarPanel("materials")}
          >
            <MaterialLibrary
              materials={materials}
              onSelect={practiceMaterial}
              onDeleteGroup={deleteMaterialGroupFromLibrary}
              importAction={
                <MaterialImportAction
                  isImporting={isImportingMaterials}
                  onImport={(event) => void importMaterialFile(event)}
                />
              }
            />
          </SidebarSection>

          <SidebarSection
            id="history-section"
            title="History"
            icon={<History size={18} />}
            count={sessions.length}
            isExpanded={expandedSidebarPanel === "history"}
            onToggle={() => toggleSidebarPanel("history")}
          >
            <HistoryList sessions={sessions} onSelect={(session) => void loadSession(session)} />
          </SidebarSection>

          <SidebarSection
            id="word-bank-section"
            title="Word Bank"
            icon={<BookmarkPlus size={18} />}
            count={vocabulary.length}
            badge={dueWordCount > 0 ? `${dueWordCount} due` : undefined}
            isExpanded={expandedSidebarPanel === "word-bank"}
            onToggle={() => toggleSidebarPanel("word-bank")}
          >
            <WordBankPanel
              vocabulary={vocabulary}
              tab={wordBankTab}
              onTabChange={setWordBankTab}
              requiredSuccesses={requiredSuccesses}
              isSaving={isSavingWords}
              onAddWord={addManualWord}
              onPracticeWord={practiceVocabularyWord}
              onDeleteWord={(wordId) => void removeVocabularyWord(wordId)}
              onStartReview={startReview}
            />
          </SidebarSection>
        </aside>

        <section className="practice-panel" hidden={appView === "insights"}>
          {isReviewActive ? (
            <div className="review-banner" role="status">
              <div className="review-banner-info">
                <strong>Review {reviewIndex + 1}/{reviewQueue.length}</strong>
                <span>{reviewQueue[reviewIndex]?.word}</span>
              </div>
              <div className="review-banner-actions">
                <button
                  type="button"
                  className={`secondary-button compact ${reviewJustScored ? "review-next-highlight" : ""}`}
                  onClick={showNextReviewWord}
                  title={reviewJustScored ? "Advance to the next due word" : "Move on without scoring this word"}
                >
                  {reviewJustScored ? "Next word" : "Skip word"}
                </button>
                <button type="button" className="secondary-button compact" onClick={endReview}>
                  End review
                </button>
              </div>
            </div>
          ) : reviewSummaryCount !== null ? (
            <div className="review-banner review-summary" role="status">
              <div className="review-banner-info">
                <strong>Review complete</strong>
                <span>
                  {reviewScoredCount} practiced, {reviewSummaryCount - reviewScoredCount} skipped
                </span>
              </div>
              <div className="review-banner-actions">
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => setReviewSummaryCount(null)}
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}

          <div className="mode-switch" aria-label="Practice mode">
            <button
              type="button"
              className={`mode-option ${practiceMode === "short" ? "selected" : ""}`}
              aria-pressed={practiceMode === "short"}
              onClick={() => setPracticeMode("short")}
              disabled={recorderState === "recording"}
            >
              <Clock3 size={17} />
              <span>
                <strong>Short Drill</strong>
                <small>{shortLimitSeconds} seconds max</small>
              </span>
            </button>
            <button
              type="button"
              className={`mode-option ${practiceMode === "long" ? "selected" : ""}`}
              aria-pressed={practiceMode === "long"}
              onClick={() => setPracticeMode("long")}
              disabled={recorderState === "recording"}
            >
              <BookOpenCheck size={17} />
              <span>
                <strong>Long Passage</strong>
                <small>{longLimitSeconds} seconds max</small>
              </span>
            </button>
          </div>
          <p className="mode-note">
            {isLongMode
              ? `Long Passage allows manual stop up to ${longLimitSeconds} seconds.`
              : `Short Drill is limited to ${shortLimitSeconds} seconds.`}
          </p>
          <div className="panel-heading split">
            <div>
              <h2>Passage</h2>
              <p>{passage.length} characters</p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary-button"
                onClick={togglePassageSpeech}
                disabled={!trimmedPassage || (isSpeechBusy && !isPassageSpeechActive)}
                title={isPassageSpeechPlaying ? "Pause passage audio (Space)" : "Play passage audio (Space)"}
              >
                {isPassageSpeechLoading ? (
                  <Loader2 className="spin" size={17} />
                ) : isPassageSpeechPlaying ? (
                  <Pause size={17} />
                ) : (
                  <Volume2 size={17} />
                )}
                {isPassageSpeechLoading ? "Loading" : isPassageSpeechPlaying ? "Pause" : "Play"}
              </button>
              {result?.words?.length ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setResult(null);
                    setCurrentSessionId("");
                    setIssues([]);
                  }}
                  title={activeMaterial ? "Review Material" : "Edit Passage"}
                >
                  {activeMaterial ? "Review Material" : "✏️ Edit"}
                </button>
              ) : (
                <button
                  className="secondary-button"
                  onClick={runPassageCheck}
                  disabled={!health?.passage_check_configured || isChecking}
                >
                  {isChecking ? <Loader2 className="spin" size={17} /> : <BookOpenCheck size={17} />}
                  Check
                </button>
              )}
            </div>
          </div>

          {activeMaterial ? (
            <div className="practice-source-banner">
              <span>Material Practice</span>
              <strong>{activeMaterial.title}</strong>
              <small>{activeMaterial.pack_title}</small>
              <button
                type="button"
                className="secondary-button compact"
                onClick={copyMaterialToFreePractice}
              >
                Copy to Free Practice
              </button>
            </div>
          ) : null}

          {isPassageSpeechActive && !result ? (
            <PassageAudioControls
              currentTime={speechCurrentTime}
              duration={speechDuration}
              disabled={isPassageSpeechLoading}
              onSkip={skipCurrentSpeech}
              onSeek={seekCurrentSpeech}
            />
          ) : null}

          {showPassageReadAlong ? (
            <PassageReadAlong
              parts={readAlongParts}
              activeBoundaryIndex={activeSpeechBoundaryIndex}
              onWordClick={(boundaryIndex) =>
                seekPassageReadAlongWord(speechWordBoundaries[boundaryIndex])
              }
            />
          ) : null}

          <textarea
            ref={passageInputRef}
            value={passage}
            onChange={handlePassageChange}
            onBlur={preloadCurrentPassage}
            className={`passage-input ${
              result?.words?.length || showPassageReadAlong ? "hidden-declutter" : ""
            }`}
            readOnly={Boolean(activeMaterial)}
            spellCheck
          />

          {result?.words?.length ? (
            <ScoredPassage
              words={result.words}
              selectedWordIndex={selectedWordIndex}
              activeSpokenWordIndex={activeSpokenWordIndex}
              onSelectWord={selectScoredWord}
            />
          ) : null}

          {!result?.words?.length && issues.length > 0 ? (
            <div className="issues">
              {issues.map((issue, index) => (
                <div className="issue" key={`${issue.span}-${index}`}>
                  <strong>{issue.span}</strong>
                  <span>{issue.suggestion}</span>
                  <p>{issue.explanation}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="recorder">
            <div className="meter">
              <AudioVisualizer
                recorderState={recorderState}
                audioStream={recordingStream}
                playbackTime={isPassageSpeechActive ? speechCurrentTime : recordingPlaybackTime}
                playbackDuration={isPassageSpeechActive ? speechDuration : audioDuration}
                isAudioPlaying={isPassageSpeechActive ? (speechStatus === "playing") : isAudioPlaying}
                activeTrack={isPassageSpeechActive ? "coach" : "user"}
                coachBoundaries={isCoachDataMatching ? passageCoachBoundaries : null}
                coachDuration={isCoachDataMatching ? passageCoachDuration : 0}
                userDuration={audioDuration}
                coachCurrentTime={speechCurrentTime}
                userCurrentTime={recordingPlaybackTime}
                result={result}
                recordedAmplitudes={recordedAmplitudes}
                onAmplitudesChange={setRecordedAmplitudes}
                onSeek={handleVisualizerSeek}
                onTrackClick={handleTrackClick}
                maxMs={maxMs}
              />
              <div className="timer">
                <Clock3 size={17} />
                <span>
                  {(elapsedMs / 1000).toFixed(1)}s /{" "}
                  {isLongMode ? longLimitSeconds : shortLimitSeconds}s
                </span>
              </div>
            </div>

            <div className="record-actions">
              {recorderState === "recording" ? (
                <button
                  className="danger-button recording-pulse"
                  onClick={stopRecording}
                  title="Stop recording (Enter)"
                >
                  <Square size={18} />
                  Stop
                </button>
              ) : (
                <button
                  className="primary-button"
                  onClick={startRecording}
                  title="Start recording (Enter; Shift+Enter to re-record without scoring)"
                >
                  <Mic size={18} />
                  Record
                </button>
              )}
              <button
                className="secondary-button"
                disabled={!audioBlob || isScoring}
                onClick={submitRecording}
                title="Score recording (Enter)"
              >
                {isScoring ? <Loader2 className="spin" size={18} /> : <UploadCloud size={18} />}
                Score
              </button>
              <span className="inline-status" aria-live="polite">{status}</span>
            </div>

            {audioUrl ? (
              <AudioPlayer
                audioUrl={audioUrl}
                onPlayStart={stopCurrentSpeech}
                onTimeChange={setRecordingPlaybackTime}
                seekRequest={recordingPlaybackSeekRequest}
                stopSignal={recordingPlaybackStopSignal}
                onIsPlayingChange={setIsAudioPlaying}
                onDurationChange={setAudioDuration}
              />
            ) : null}

            <p className="shortcut-legend" aria-label="Keyboard shortcuts">
              <span><kbd>Space</kbd> play/pause</span>
              <span><kbd>Enter</kbd> record/score</span>
              <span><kbd>Shift</kbd> + <kbd>Enter</kbd> re-record</span>
            </p>
          </div>
        </section>

        <ResultsPanel
          hidden={appView === "insights"}
          result={result}
          weakWords={weakWords}
          savedWords={savedWords}
          selectedWord={selectedWord}
          speakingText={speakingText}
          isSpeechBusy={isSpeechBusy}
          noMatchNotice={noMatchNotice}
          isSavingWords={isSavingWords}
          onSaveWeakWords={() => void saveWeakWords()}
          onSaveWeakWord={(word) => void saveWeakWord(word)}
          onSelectWeakWord={selectWeakWord}
          onPlayWord={playWord}
          onSelectPhoneme={setActiveCoachPhoneme}
        />
      </section>

      {/* Reusable Phoneme Pronunciation Coach Overlay */}
      {activeCoachPhoneme ? (
        <Suspense fallback={null}>
          <PhonemeCoachModal
            phoneme={activeCoachPhoneme}
            onClose={() => setActiveCoachPhoneme(null)}
            onDrill={startDrillFromInsights}
            onPlayWord={playWord}
            onStopAudio={stopCurrentSpeech}
            speakingText={speakingText}
            speechStatus={speechStatus}
          />
        </Suspense>
      ) : null}
    </main>
  );
}

export default App;
