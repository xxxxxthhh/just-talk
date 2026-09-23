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
import { lazy, Suspense } from "react";

import { apiUrl } from "./api";
import { AudioPlayer } from "./components/AudioPlayer";
import { AudioVisualizer } from "./components/AudioVisualizer";
import { BrandMark } from "./components/BrandMark";
import { HistoryList } from "./components/HistoryList";
import {
  MaterialImportAction,
  MaterialLibrary
} from "./components/MaterialLibrary";
import {
  PassageAudioControls,
  PassageReadAlong
} from "./components/PassagePlayback";
import { ResultsPanel } from "./components/ResultsPanel";
import { ScoredPassage } from "./components/ScoredPassage";
import { SidebarSection } from "./components/SidebarSection";
import { StatusPill } from "./components/StatusPill";
import { WordBankPanel } from "./components/WordBankPanel";
import { usePracticeSession } from "./usePracticeSession";

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

export default function DesktopApp() {
  const {
    theme,
    toggleTheme,
    passage,
    activeMaterial,
    passageInputRef,
    issues,
    setIssues,
    selectedWordIndex,
    result,
    setResult,
    setCurrentSessionId,
    noMatchNotice,
    appView,
    setAppView,
    expandedSidebarPanel,
    activeCoachPhoneme,
    setActiveCoachPhoneme,
    wordBankTab,
    setWordBankTab,
    practiceMode,
    setPracticeMode,
    status,
    isChecking,
    isScoring,
    isSavingWords,
    isImportingMaterials,
    error,
    health,
    sessions,
    vocabulary,
    materials,
    refreshServerState,
    insights,
    activity,
    speakingText,
    speechStatus,
    isSpeechBusy,
    speechCurrentTime,
    speechDuration,
    speechWordBoundaries,
    activeSpeechBoundaryIndex,
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
    stopRecording,
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
    passageCoachBoundaries,
    passageCoachDuration,
    selectedWord,
    weakWords,
    trimmedPassage,
    isPassageSpeechActive,
    isPassageSpeechLoading,
    isPassageSpeechPlaying,
    activeSpokenWordIndex,
    readAlongParts,
    showPassageReadAlong,
    savedWords,
    requiredSuccesses,
    dueWordCount,
    reviewQueue,
    reviewIndex,
    reviewJustScored,
    reviewSummaryCount,
    setReviewSummaryCount,
    reviewScoredCount,
    isReviewActive,
    startRecording,
    submitRecording,
    runPassageCheck,
    loadSession,
    addManualWord,
    saveWeakWord,
    saveWeakWords,
    removeVocabularyWord,
    practiceVocabularyWord,
    practiceMaterial,
    startReview,
    showNextReviewWord,
    endReview,
    importMaterialFile,
    deleteMaterialGroupFromLibrary,
    startDrillFromInsights,
    selectWeakWord,
    handleVisualizerSeek,
    handleTrackClick,
    selectScoredWord,
    playWord,
    seekPassageReadAlongWord,
    togglePassageSpeech,
    preloadCurrentPassage,
    handlePassageChange,
    copyMaterialToFreePractice,
    toggleSidebarPanel,
    isCoachDataMatching
  } = usePracticeSession();

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <BrandMark />
          </div>
          <div className="brand-copy">
            <h1 className="brand-name">Just Talk</h1>
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
          <a className="icon-button" href={apiUrl("/api/export")} download title="Download backup (JSON)">
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
