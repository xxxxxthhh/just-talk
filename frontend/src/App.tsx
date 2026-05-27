import {
  AlertCircle,
  BookmarkPlus,
  BookOpen,
  BookOpenCheck,
  Clock3,
  FastForward,
  History,
  Loader2,
  Mic,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rewind,
  Sparkles,
  Square,
  Sun,
  Trash2,
  UploadCloud,
  Volume2
} from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  addWordsFromSession,
  checkHealth,
  checkPassage,
  createWord,
  deleteMaterialGroup,
  deleteWord,
  fetchPhonemeStats,
  getSession,
  importMaterialPack,
  listMaterials,
  listSessions,
  listWords,
  scoreRecording
} from "./api";
import { AudioPlayer, type AudioSeekRequest } from "./components/AudioPlayer";
import { AudioVisualizer } from "./components/AudioVisualizer";
import { InsightsPanel } from "./components/InsightsPanel";
import {
  MaterialImportAction,
  MaterialLibrary,
  type MaterialGroupDeleteTarget
} from "./components/MaterialLibrary";
import { PhonemeInspector } from "./components/PhonemeInspector";
import { PhonemeCoachModal } from "./components/PhonemeCoachModal";
import { ScoreGrid } from "./components/ScoreGrid";
import { SidebarSection } from "./components/SidebarSection";
import { StatusPill } from "./components/StatusPill";
import { useSpeech, type SpeechOptions } from "./hooks/useSpeech";
import { validateMaterialPackImportPayload } from "./materialImport";
import { formatDuration, scoreTone, scoreValue, weakWordsFromResult } from "./scoreUtils";
import type {
  Health,
  MaterialItem,
  PassageIssue,
  PhonemeStat,
  PracticeSession,
  ScoreResult,
  SpeechWordBoundary,
  VocabularyItem,
  WordResult
} from "./types";

const DEFAULT_PASSAGE =
  "The weather changed quickly, but we kept walking through the quiet streets and talked about the plans we wanted to finish this week.";

const WORD_REPLAY_LEAD_IN_SECONDS = 0.15;

type RecorderState = "idle" | "recording" | "recorded";
type WordBankTab = "active" | "graduated";
type PracticeMode = "short" | "long";
type AppView = "practice" | "insights";
type SidebarPanel = "materials" | "history" | "word-bank";
type PassageReadAlongPart =
  | { kind: "text"; key: string; text: string }
  | { kind: "word"; boundaryIndex: number; key: string; text: string };

function normalizedWord(word: string): string {
  return word.trim().toLocaleLowerCase();
}

function materialSpeechCacheKey(material: MaterialItem): string {
  return `material:${material.id}`;
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
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

function buildPassageReadAlongParts(
  text: string,
  boundaries: SpeechWordBoundary[]
): PassageReadAlongPart[] {
  if (!text || boundaries.length === 0) return [];

  const parts: PassageReadAlongPart[] = [];
  let cursor = 0;
  const orderedBoundaries = boundaries
    .map((boundary, index) => ({ boundary, index }))
    .filter(({ boundary }) => boundary.word_length > 0 && boundary.text_offset >= 0)
    .sort((left, right) => left.boundary.text_offset - right.boundary.text_offset);

  for (const { boundary, index } of orderedBoundaries) {
    const start = Math.min(Math.max(Math.floor(boundary.text_offset), 0), text.length);
    const end = Math.min(start + Math.max(Math.floor(boundary.word_length), 0), text.length);
    if (end <= cursor || start < cursor) {
      continue;
    }
    if (start > cursor) {
      parts.push({
        kind: "text",
        key: `text-${cursor}-${start}`,
        text: text.slice(cursor, start)
      });
    }
    parts.push({
      kind: "word",
      boundaryIndex: index,
      key: `word-${index}-${start}`,
      text: text.slice(start, end) || boundary.text
    });
    cursor = end;
  }

  if (cursor < text.length) {
    parts.push({
      kind: "text",
      key: `text-${cursor}-end`,
      text: text.slice(cursor)
    });
  }

  return parts;
}

function safeGetLocalStorage(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch (e) {
    // Ignore security or accessibility errors in JSDOM sandbox
  }
  return null;
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    // Ignore security or accessibility errors in JSDOM sandbox
  }
}

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = safeGetLocalStorage("theme");
    if (saved === "light" || saved === "dark") return saved;
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  });

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
    safeSetLocalStorage("theme", theme);
  }, [theme]);

  const [health, setHealth] = useState<Health | null>(null);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [passage, setPassage] = useState(DEFAULT_PASSAGE);
  const [activeMaterial, setActiveMaterial] = useState<MaterialItem | null>(null);
  const passageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [issues, setIssues] = useState<PassageIssue[]>([]);
  const [selectedWordIndex, setSelectedWordIndex] = useState(0);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingPlaybackSeekRequest, setRecordingPlaybackSeekRequest] =
    useState<AudioSeekRequest | null>(null);
  const [recordingPlaybackStopSignal, setRecordingPlaybackStopSignal] = useState(0);
  const [recordingPlaybackTime, setRecordingPlaybackTime] = useState(0);

  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [recordedAmplitudes, setRecordedAmplitudes] = useState<number[] | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);

  const [appView, setAppView] = useState<AppView>("practice");
  const [expandedSidebarPanel, setExpandedSidebarPanel] = useState<SidebarPanel | null>("materials");
  const [phonemeStats, setPhonemeStats] = useState<PhonemeStat[]>([]);
  const [phonemeStatsLoading, setPhonemeStatsLoading] = useState(false);
  const [phonemeStatsError, setPhonemeStatsError] = useState("");
  const [expandedPhoneme, setExpandedPhoneme] = useState<string | null>(null);
  const [activeCoachPhoneme, setActiveCoachPhoneme] = useState<string | null>(null);

  const [newWord, setNewWord] = useState("");
  const [wordBankTab, setWordBankTab] = useState<WordBankTab>("active");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("short");
  const [status, setStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [isSavingWords, setIsSavingWords] = useState(false);
  const [isImportingMaterials, setIsImportingMaterials] = useState(false);
  const [error, setError] = useState("");

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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const selectedWord = result?.words[selectedWordIndex] ?? null;
  const shortLimitSeconds = health?.max_audio_seconds ?? 30;
  const longLimitSeconds = health?.max_long_audio_seconds ?? 180;
  const isLongMode = practiceMode === "long";
  const maxMs = (isLongMode ? longLimitSeconds : shortLimitSeconds) * 1000;
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
  const activeVocabulary = useMemo(
    () => vocabulary.filter((item) => item.status !== "graduated"),
    [vocabulary]
  );
  const graduatedVocabulary = useMemo(
    () => vocabulary.filter((item) => item.status === "graduated"),
    [vocabulary]
  );
  const visibleVocabulary =
    wordBankTab === "active" ? activeVocabulary : graduatedVocabulary;

  useEffect(() => {
    void refreshServerState();
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      stopCurrentSpeech();
    };
  }, [audioUrl, stopCurrentSpeech]);

  useEffect(() => {
    setRecordingPlaybackSeekRequest(null);
    setRecordingPlaybackTime(0);
  }, [audioUrl]);

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

  async function refreshServerState() {
    try {
      setError("");
      const [nextHealth, nextSessions, nextWords, nextMaterials] = await Promise.all([
        checkHealth(),
        listSessions(),
        listWords(),
        listMaterials()
      ]);
      setHealth(nextHealth);
      setSessions(nextSessions);
      setVocabulary(nextWords);
      setMaterials(nextMaterials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backend is not reachable.");
    }
  }

  async function refreshVocabulary() {
    setVocabulary(await listWords());
  }

  async function refreshMaterials() {
    setMaterials(await listMaterials());
  }

  async function startRecording() {
    setError("");
    setStatus("");
    stopCurrentSpeech();
    stopRecordingPlayback();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot access the microphone.");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunksRef.current, {
        type: mimeType || "audio/webm"
      });
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
      setRecorderState("recorded");
      setStatus("Recording ready");
      setRecordingStream(null);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setAudioBlob(null);
    setResult(null);
    setCurrentSessionId("");
    setSelectedWordIndex(0);
    setRecorderState("recording");
    setRecordingStream(stream);
    setRecordedAmplitudes(null);
    setIsAudioPlaying(false);
    setAudioDuration(0);
    timerRef.current = window.setInterval(() => {
      const nextElapsed = Date.now() - startedAtRef.current;
      setElapsedMs(nextElapsed);
      if (nextElapsed >= maxMs) {
        stopRecording();
      }
    }, 150);
  }

  function stopRecording() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
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

  async function addManualWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = newWord.trim();
    if (!word) {
      return;
    }
    setIsSavingWords(true);
    setError("");
    try {
      await createWord(word);
      setNewWord("");
      setWordBankTab("active");
      await refreshVocabulary();
      setStatus(`${word} added to word bank`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add word.");
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

  function practiceVocabularyWord(item: VocabularyItem) {
    stopCurrentSpeech();
    stopRecordingPlayback();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setActiveMaterial(null);
    setPassage(item.word);
    setResult(null);
    setCurrentSessionId("");
    setSelectedWordIndex(0);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecorderState("idle");
    setElapsedMs(0);
    setRecordedAmplitudes(null);
    setAudioDuration(0);
    setStatus("Word drill ready");
  }

  function practiceMaterial(material: MaterialItem) {
    stopCurrentSpeech();
    stopRecordingPlayback();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setActiveMaterial(material);
    setPassage(material.text);
    setResult(null);
    setCurrentSessionId("");
    setIssues([]);
    setSelectedWordIndex(0);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecorderState("idle");
    setElapsedMs(0);
    setRecordedAmplitudes(null);
    setAudioDuration(0);
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

  async function loadPhonemeStats() {
    setPhonemeStatsLoading(true);
    setPhonemeStatsError("");
    try {
      setPhonemeStats(await fetchPhonemeStats());
    } catch (err) {
      setPhonemeStats([]);
      setPhonemeStatsError(
        err instanceof Error ? err.message : "Could not load phoneme stats."
      );
    } finally {
      setPhonemeStatsLoading(false);
    }
  }

  function startDrillFromInsights(word: string) {
    stopCurrentSpeech();
    stopRecordingPlayback();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setActiveMaterial(null);
    setPassage(word);
    setPracticeMode("short");
    setResult(null);
    setCurrentSessionId("");
    setIssues([]);
    setSelectedWordIndex(0);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecorderState("idle");
    setElapsedMs(0);
    setRecordedAmplitudes(null);
    setAudioDuration(0);
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

  function stopRecordingPlayback() {
    setRecordingPlaybackSeekRequest(null);
    setRecordingPlaybackTime(0);
    setRecordingPlaybackStopSignal((signal) => signal + 1);
    setIsAudioPlaying(false);
  }

  function handleVisualizerSeek(timeSeconds: number) {
    setRecordingPlaybackTime(timeSeconds);
    setRecordingPlaybackSeekRequest((request) => ({
      id: (request?.id ?? 0) + 1,
      timeSeconds,
      play: isAudioPlaying
    }));
  }

  function selectScoredWord(index: number) {
    setSelectedWordIndex(index);
    const word = result?.words[index];
    if (!word || !audioUrl) {
      return;
    }

    stopCurrentSpeech();
    const timeSeconds = wordReplayStartSeconds(word);
    setRecordingPlaybackTime(timeSeconds);
    setRecordingPlaybackSeekRequest((request) => ({
      id: (request?.id ?? 0) + 1,
      timeSeconds,
      play: true
    }));
  }

  function playPronunciation(text: string, options?: SpeechOptions) {
    stopRecordingPlayback();
    void playCorrect(text, options);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Volume2 size={22} />
          </div>
          <div>
            <h1>Just Talk</h1>
            <p>Pronunciation practice</p>
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
            onClick={() => { setAppView("insights"); void loadPhonemeStats(); }}
          >
            <Sparkles size={15} />
            <span>Phoneme Insights</span>
          </button>
        </nav>
        <div className="topbar-actions">
          <StatusPill health={health} />
          <button
            className="icon-button"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
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
            stats={phonemeStats}
            loading={phonemeStatsLoading}
            error={phonemeStatsError}
            expandedPhoneme={expandedPhoneme}
            setExpandedPhoneme={setExpandedPhoneme}
            onDrill={startDrillFromInsights}
            onPlayWord={playPronunciation}
            speakingText={speakingText}
            speechStatus={speechStatus}
            onRefresh={() => void loadPhonemeStats()}
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
            <div className="history-list">
              {sessions.length === 0 ? (
                <p className="muted">No sessions yet.</p>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    className="history-row"
                    onClick={() => void loadSession(session)}
                  >
                    <span>{new Date(session.created_at).toLocaleDateString()}</span>
                    <strong>{scoreValue(session.scores.pronunciation)}</strong>
                    <small>{formatDuration(session.audio_duration_ms)}</small>
                  </button>
                ))
              )}
            </div>
          </SidebarSection>

          <SidebarSection
            id="word-bank-section"
            title="Word Bank"
            icon={<BookmarkPlus size={18} />}
            count={vocabulary.length}
            isExpanded={expandedSidebarPanel === "word-bank"}
            onToggle={() => toggleSidebarPanel("word-bank")}
          >
            <form className="word-form" onSubmit={(event) => void addManualWord(event)}>
              <input
                value={newWord}
                onChange={(event) => setNewWord(event.target.value)}
                placeholder="Add a word"
                aria-label="Add a word"
              />
              <button className="icon-button" disabled={isSavingWords} title="Add word">
                {isSavingWords ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
              </button>
            </form>
            <div className="word-tabs" aria-label="Word bank status">
              <button
                type="button"
                className={`word-tab ${wordBankTab === "active" ? "selected" : ""}`}
                aria-pressed={wordBankTab === "active"}
                onClick={() => setWordBankTab("active")}
              >
                In Progress <span>{activeVocabulary.length}</span>
              </button>
              <button
                type="button"
                className={`word-tab ${wordBankTab === "graduated" ? "selected" : ""}`}
                aria-pressed={wordBankTab === "graduated"}
                onClick={() => setWordBankTab("graduated")}
              >
                Graduated <span>{graduatedVocabulary.length}</span>
              </button>
            </div>
            <div className="word-bank-list">
              {vocabulary.length === 0 ? (
                <p className="muted">No saved words yet.</p>
              ) : visibleVocabulary.length === 0 ? (
                <p className="muted">
                  {wordBankTab === "active"
                    ? "No in-progress words."
                    : "No graduated words yet."}
                </p>
              ) : (
                visibleVocabulary.map((item) => (
                  <div className="bank-row" key={item.id}>
                    <button
                      className={`bank-word ${
                        item.status === "graduated"
                          ? "graduated-word"
                          : `active-word ${scoreTone(item.latest_score)}`
                      }`}
                      onClick={() => practiceVocabularyWord(item)}
                    >
                      <strong>{item.word}</strong>
                      <span>{scoreValue(item.latest_score)}</span>
                      <small>
                        {item.status === "graduated"
                          ? "Graduated"
                          : `${Math.min(
                              item.consecutive_successes ?? 0,
                              requiredSuccesses
                            )}/${requiredSuccesses} streak`}{" "}
                        · {item.practice_count} reps
                      </small>
                    </button>
                    <button
                      className="icon-button small"
                      onClick={() => void removeVocabularyWord(item.id)}
                      title={`Delete ${item.word}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
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

          {isPassageSpeechActive ? (
            <div className="passage-audio-controls">
              <button
                type="button"
                className="passage-audio-step"
                onClick={() => skipCurrentSpeech(-5)}
                aria-label="Back 5 seconds"
                disabled={isPassageSpeechLoading}
              >
                <Rewind size={15} />
                5s
              </button>
              <input
                type="range"
                min={0}
                max={speechDuration || 1}
                step={0.05}
                value={Math.min(speechCurrentTime, speechDuration || 1)}
                onChange={(event) => seekCurrentSpeech(parseFloat(event.target.value))}
                className="passage-audio-slider"
                aria-label="Passage audio progress"
                disabled={isPassageSpeechLoading}
              />
              <span className="passage-audio-time">
                {formatPlaybackTime(speechCurrentTime)} / {formatPlaybackTime(speechDuration)}
              </span>
              <button
                type="button"
                className="passage-audio-step"
                onClick={() => skipCurrentSpeech(5)}
                aria-label="Forward 5 seconds"
                disabled={isPassageSpeechLoading}
              >
                <FastForward size={15} />
                5s
              </button>
            </div>
          ) : null}

          {showPassageReadAlong ? (
            <div className="passage-read-along" aria-label="Passage read-along">
              {readAlongParts.map((part) =>
                part.kind === "word" ? (
                  <button
                    type="button"
                    key={part.key}
                    className={`passage-read-word ${
                      part.boundaryIndex === activeSpeechBoundaryIndex ? "playing" : ""
                    }`}
                    onClick={() =>
                      seekPassageReadAlongWord(speechWordBoundaries[part.boundaryIndex])
                    }
                  >
                    {part.text}
                  </button>
                ) : (
                  <span className="passage-read-text" key={part.key}>
                    {part.text}
                  </span>
                )
              )}
            </div>
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
            <div className="scored-passage-container">
              <div className="scored-passage-box">
                {result.words.map((word, index) => (
                  <button
                    type="button"
                    key={`${word.word}-${index}`}
                    className={`scored-word-token ${word.bucket} ${
                      index === selectedWordIndex ? "selected" : ""
                    } ${index === activeSpokenWordIndex ? "playing" : ""}`}
                    onClick={() => selectScoredWord(index)}
                  >
                    <span>{word.word} </span>
                    <strong>{scoreValue(word.accuracy)}</strong>
                  </button>
                ))}
              </div>
              <p className="muted" style={{ marginTop: "4px", fontSize: "11.5px" }}>
                💡 Tip: Click any colored word token above to inspect its detailed sound/phoneme analysis.
              </p>
            </div>
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
                playbackTime={recordingPlaybackTime}
                playbackDuration={audioDuration}
                isAudioPlaying={isAudioPlaying}
                result={result}
                recordedAmplitudes={recordedAmplitudes}
                onAmplitudesChange={setRecordedAmplitudes}
                onSeek={handleVisualizerSeek}
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

        <section className="results-panel" hidden={appView === "insights"}>
          <div className="panel-heading split">
            <div>
              <h2>Score</h2>
              <p className="result-transcript hidden-declutter">
                {result?.transcript || "Waiting for recording"}
              </p>
            </div>
            <Sparkles size={20} />
          </div>

          <ScoreGrid scores={result?.scores ?? null} />

          {result?.segments?.length ? (
            <section className="segment-section">
              <div className="section-heading">
                <div>
                  <h3>Passage segments</h3>
                  <p>{result.segments.length} continuous scoring segments</p>
                </div>
              </div>
              <div className="segment-list">
                {result.segments.map((segment) => (
                  <div className="segment-row" key={segment.index}>
                    <div>
                      <strong>Segment {segment.index}</strong>
                      <p>{segment.transcript || "No transcript"}</p>
                    </div>
                    <span>{scoreValue(segment.scores.pronunciation)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {weakWords.length ? (
            <section className="weak-section">
              <div className="section-heading">
                <div>
                  <h3>Needs practice</h3>
                  <p>{weakWords.length} words to drill</p>
                </div>
                <button
                  className="secondary-button compact"
                  onClick={() => void saveWeakWords()}
                  disabled={isSavingWords}
                >
                  {isSavingWords ? <Loader2 className="spin" size={16} /> : <BookmarkPlus size={16} />}
                  Save all
                </button>
              </div>
              <div className="weak-list">
                {weakWords.map((word) => {
                  const saved = savedWords.has(normalizedWord(word.word));
                  return (
                    <div className={`weak-row ${scoreTone(word.accuracy)}`} key={word.word}>
                      <button className="weak-main" onClick={() => selectWeakWord(word)}>
                        <strong>{word.word}</strong>
                        <span>{scoreValue(word.accuracy)}</span>
                      </button>
                      <button
                        className="icon-button small"
                        onClick={() => playPronunciation(word.word)}
                        title={`Play ${word.word}`}
                        disabled={Boolean(speakingText)}
                      >
                        <Volume2 size={15} />
                      </button>
                      <button
                        className="secondary-button compact"
                        onClick={() => void saveWeakWord(word)}
                        disabled={saved || isSavingWords}
                      >
                        {saved ? "Saved" : "Save"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {!result?.words.length ? (
            <div className="words">
              <div className="empty-state">
                <Play size={22} />
                <p>Record a passage to see word and phoneme feedback.</p>
              </div>
            </div>
          ) : null}

          {selectedWord ? (
            <PhonemeInspector
              word={selectedWord}
              onPlay={() => playPronunciation(selectedWord.word)}
              isSpeaking={speakingText === selectedWord.word}
              onSelectPhoneme={setActiveCoachPhoneme}
            />
          ) : null}
        </section>
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
