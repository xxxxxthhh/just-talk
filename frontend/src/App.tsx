import {
  AlertCircle,
  BookmarkPlus,
  BookOpenCheck,
  Clock3,
  History,
  Loader2,
  Mic,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Sun,
  Trash2,
  UploadCloud,
  Volume2
} from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  addWordsFromSession,
  checkHealth,
  checkPassage,
  createWord,
  deleteWord,
  fetchPhonemeStats,
  getSession,
  importMaterialPack,
  listMaterials,
  listSessions,
  listWords,
  scoreLongRecording,
  scoreRecording
} from "./api";
import { AudioPlayer } from "./components/AudioPlayer";
import { InsightsPanel } from "./components/InsightsPanel";
import { MaterialLibrary } from "./components/MaterialLibrary";
import { PhonemeInspector } from "./components/PhonemeInspector";
import { ScoreGrid } from "./components/ScoreGrid";
import { StatusPill } from "./components/StatusPill";
import { useSpeech } from "./hooks/useSpeech";
import { formatDuration, scoreTone, scoreValue, weakWordsFromResult } from "./scoreUtils";
import type {
  Health,
  MaterialItem,
  MaterialPackImportPayload,
  PassageIssue,
  PhonemeStat,
  PracticeSession,
  ScoreResult,
  VocabularyItem,
  WordResult
} from "./types";

const DEFAULT_PASSAGE =
  "The weather changed quickly, but we kept walking through the quiet streets and talked about the plans we wanted to finish this week.";

type RecorderState = "idle" | "recording" | "recorded";
type WordBankTab = "active" | "graduated";
type PracticeMode = "short" | "long";
type AppView = "practice" | "insights";

function normalizedWord(word: string): string {
  return word.trim().toLocaleLowerCase();
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
  const [issues, setIssues] = useState<PassageIssue[]>([]);
  const [selectedWordIndex, setSelectedWordIndex] = useState(0);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [appView, setAppView] = useState<AppView>("practice");
  const [phonemeStats, setPhonemeStats] = useState<PhonemeStat[]>([]);
  const [phonemeStatsLoading, setPhonemeStatsLoading] = useState(false);
  const [phonemeStatsError, setPhonemeStatsError] = useState("");
  const [expandedPhoneme, setExpandedPhoneme] = useState<string | null>(null);

  const [newWord, setNewWord] = useState("");
  const [wordBankTab, setWordBankTab] = useState<WordBankTab>("active");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("short");
  const [status, setStatus] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [isSavingWords, setIsSavingWords] = useState(false);
  const [isImportingMaterials, setIsImportingMaterials] = useState(false);
  const [error, setError] = useState("");

  const { speakingText, preloadSpeech, playCorrect, stopCurrentSpeech } =
    useSpeech(setError);

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
    if (selectedWord?.word) {
      void preloadSpeech(selectedWord.word);
    }
  }, [selectedWord?.word, preloadSpeech]);

  useEffect(() => {
    for (const word of weakWords.slice(0, 5)) {
      void preloadSpeech(word.word);
    }
  }, [weakWords, preloadSpeech]);

  const waveBars = useMemo(
    () =>
      Array.from({ length: 36 }, (_, index) => {
        const seed = Math.sin(index * 1.7) + Math.cos(index * 0.45);
        return 26 + Math.abs(seed) * 34;
      }),
    []
  );

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
      const response = isLongMode
        ? await scoreLongRecording(passage, audioBlob)
        : await scoreRecording(passage, audioBlob);
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
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setPassage(item.word);
    setResult(null);
    setCurrentSessionId("");
    setSelectedWordIndex(0);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecorderState("idle");
    setElapsedMs(0);
    setStatus("Word drill ready");
  }

  function practiceMaterial(material: MaterialItem) {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setPassage(material.text);
    setResult(null);
    setCurrentSessionId("");
    setIssues([]);
    setSelectedWordIndex(0);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecorderState("idle");
    setElapsedMs(0);
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
      const payload = JSON.parse(await file.text()) as MaterialPackImportPayload;
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
    if (audioUrl) URL.revokeObjectURL(audioUrl);
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

  function preloadCurrentPassage() {
    void preloadSpeech(passage);
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
            onRefresh={() => void loadPhonemeStats()}
          />
        ) : null}
        <aside className="history-panel side-panel" hidden={appView === "insights"}>
          <MaterialLibrary
            materials={materials}
            isImporting={isImportingMaterials}
            onSelect={practiceMaterial}
            onImport={(event) => void importMaterialFile(event)}
          />

          <section className="sidebar-section">
            <div className="panel-heading">
              <History size={18} />
              <h2>History</h2>
            </div>
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
          </section>

          <section className="sidebar-section">
            <div className="panel-heading">
              <BookmarkPlus size={18} />
              <h2>Word Bank</h2>
            </div>
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
          </section>
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
                onClick={() => void playCorrect(passage)}
                disabled={!passage.trim() || Boolean(speakingText)}
              >
                {speakingText === passage.trim() ? (
                  <Loader2 className="spin" size={17} />
                ) : (
                  <Volume2 size={17} />
                )}
                Play
              </button>
              {result?.words?.length ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setResult(null);
                    setCurrentSessionId("");
                    setIssues([]);
                  }}
                  title="Edit Passage"
                >
                  ✏️ Edit
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

          <textarea
            value={passage}
            onChange={(event) => setPassage(event.target.value)}
            onBlur={preloadCurrentPassage}
            className={`passage-input ${result?.words?.length ? "hidden-declutter" : ""}`}
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
                    }`}
                    onClick={() => setSelectedWordIndex(index)}
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
              <div className="wave" aria-hidden="true">
                {waveBars.map((height, index) => (
                  <span
                    className={recorderState === "recording" ? "active" : ""}
                    key={index}
                    style={{ height: `${height}%`, animationDelay: `${index * 45}ms` }}
                  />
                ))}
              </div>
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

            {audioUrl ? <AudioPlayer audioUrl={audioUrl} /> : null}
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
                        onClick={() => void playCorrect(word.word)}
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
              onPlay={() => void playCorrect(selectedWord.word)}
              isSpeaking={speakingText === selectedWord.word}
            />
          ) : null}
        </section>
      </section>
    </main>
  );
}

export default App;
