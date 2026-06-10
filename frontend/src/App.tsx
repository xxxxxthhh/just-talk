import {
  AlertCircle,
  BookmarkPlus,
  BookOpen,
  BookOpenCheck,
  Clock3,
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
import { AudioPlayer } from "./components/AudioPlayer";
import { AudioVisualizer } from "./components/AudioVisualizer";
import { BrandMark } from "./components/BrandMark";
import { HistoryList } from "./components/HistoryList";
import { InsightsPanel } from "./components/InsightsPanel";
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
import { PhonemeCoachModal } from "./components/PhonemeCoachModal";
import { ResultsPanel } from "./components/ResultsPanel";
import { ScoredPassage } from "./components/ScoredPassage";
import { SidebarSection } from "./components/SidebarSection";
import { StatusPill } from "./components/StatusPill";
import { countDueWords, WordBankPanel, type WordBankTab } from "./components/WordBankPanel";
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

type PracticeMode = "short" | "long";
type AppView = "practice" | "insights";
type SidebarPanel = "materials" | "history" | "word-bank";

function materialSpeechCacheKey(material: MaterialItem): string {
  return `material:${material.id}`;
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
    refreshVocabulary,
    refreshMaterials
  } = useServerState(setError);

  const insights = usePhonemeInsights();

  const {
    speakingText,
    speechStatus,
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
      void preloadSpeech(selectedWord.word);
    }
  }, [selectedWord?.word, preloadSpeech]);

  useEffect(() => {
    for (const word of weakWords.slice(0, 5)) {
      void preloadSpeech(word.word);
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
    setSelectedWordIndex(0);
    setRecordedAmplitudes(null);
    setIsAudioPlaying(false);
    setAudioDuration(0);
  }

  async function submitRecording() {
    if (!audioBlob) {
      return;
    }
    setIsScoring(true);
    setError("");
    setStatus(isLongMode ? "Scoring long passage" : "Scoring pronunciation");
    try {
      const response = await scoreRecording(passage, audioBlob, practiceMode);
      setResult(response.result);
      setCurrentSessionId(response.session.id);
      setSelectedWordIndex(0);
      const addedWords = await addWordsFromSession(response.session.id);
      await refreshServerState();
      setStatus(
        addedWords.length
          ? `Score complete · ${addedWords.length} weak words saved`
          : "Score complete"
      );
    } catch (err) {
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

  async function loadSession(session: PracticeSession) {
    setError("");
    setStatus("Loading history");
    try {
      const loaded = await getSession(session.id);
      setActiveMaterial(null);
      setPassage(loaded.reference_text);
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
    stopCurrentSpeech();
    stopRecordingPlayback();
    resetRecording();
    setResult(null);
    setCurrentSessionId("");
    setSelectedWordIndex(0);
    setRecordedAmplitudes(null);
    setAudioDuration(0);
  }

  function practiceVocabularyWord(item: VocabularyItem) {
    resetPractice();
    setActiveMaterial(null);
    setPassage(item.word);
    setStatus("Word drill ready");
  }

  function practiceMaterial(material: MaterialItem) {
    resetPractice();
    setActiveMaterial(material);
    setPassage(material.text);
    setIssues([]);
    setStatus(`Material ready: ${material.title}`);
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

  function startDrillFromInsights(word: string) {
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
            onClick={() => { setAppView("insights"); void insights.loadStats(); }}
          >
            <Sparkles size={15} />
            <span>Phoneme Insights</span>
          </button>
        </nav>
        <div className="topbar-actions">
          <StatusPill health={health} />
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

      <section className="workspace">
        {appView === "insights" ? (
          <InsightsPanel
            stats={insights.stats}
            loading={insights.loading}
            error={insights.error}
            expandedPhoneme={insights.expandedPhoneme}
            setExpandedPhoneme={insights.setExpandedPhoneme}
            onDrill={startDrillFromInsights}
            onPlayWord={playPronunciation}
            speakingText={speakingText}
            speechStatus={speechStatus}
            onRefresh={() => void insights.loadStats()}
          />
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
            />
          </SidebarSection>
        </aside>

        <section className="practice-panel" hidden={appView === "insights"}>
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
                disabled={!trimmedPassage || (Boolean(speakingText) && !isPassageSpeechActive)}
                title={isPassageSpeechPlaying ? "Pause passage audio" : "Play passage audio"}
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
                <button className="danger-button recording-pulse" onClick={stopRecording}>
                  <Square size={18} />
                  Stop
                </button>
              ) : (
                <button className="primary-button" onClick={startRecording}>
                  <Mic size={18} />
                  Record
                </button>
              )}
              <button
                className="secondary-button"
                disabled={!audioBlob || isScoring}
                onClick={submitRecording}
              >
                {isScoring ? <Loader2 className="spin" size={18} /> : <UploadCloud size={18} />}
                Score
              </button>
              {status ? <span className="inline-status">{status}</span> : null}
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
          </div>
        </section>

        <ResultsPanel
          hidden={appView === "insights"}
          result={result}
          weakWords={weakWords}
          savedWords={savedWords}
          selectedWord={selectedWord}
          speakingText={speakingText}
          isSavingWords={isSavingWords}
          onSaveWeakWords={() => void saveWeakWords()}
          onSaveWeakWord={(word) => void saveWeakWord(word)}
          onSelectWeakWord={selectWeakWord}
          onPlayWord={(text) => playPronunciation(text)}
          onSelectPhoneme={setActiveCoachPhoneme}
        />
      </section>

      {/* Reusable Phoneme Pronunciation Coach Overlay */}
      <PhonemeCoachModal
        phoneme={activeCoachPhoneme}
        onClose={() => setActiveCoachPhoneme(null)}
        onDrill={startDrillFromInsights}
        onPlayWord={playPronunciation}
        onStopAudio={stopCurrentSpeech}
        speakingText={speakingText}
        speechStatus={speechStatus}
      />
    </main>
  );
}

export default App;
