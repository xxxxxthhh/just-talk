import { Clock3, Loader2, Mic, Square, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { AudioPlayer } from "../../components/AudioPlayer";
import { AudioVisualizer } from "../../components/AudioVisualizer";
import {
  MaterialImportAction,
  MaterialLibrary,
} from "../../components/MaterialLibrary";
import { ScoredPassage } from "../../components/ScoredPassage";
import { ScoreGrid } from "../../components/ScoreGrid";
import { scoreValue } from "../../scoreUtils";
import { usePracticeSession } from "../../usePracticeSession";

type PracticeSessionState = ReturnType<typeof usePracticeSession>;

type PracticeScreenProps = {
  session: PracticeSessionState;
};

export default function PracticeScreen({ session }: PracticeScreenProps) {
  const materialLibraryRef = useRef<HTMLDivElement | null>(null);
  const resultSheetRef = useRef<HTMLDialogElement | null>(null);
  const resultSheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const resultChipRef = useRef<HTMLButtonElement | null>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const [isResultSheetOpen, setIsResultSheetOpen] = useState(false);
  const {
    activeMaterial,
    activeSpokenWordIndex,
    audioBlob,
    audioDuration,
    audioUrl,
    deleteMaterialGroupFromLibrary,
    elapsedMs,
    endReview,
    handlePassageChange,
    handleTrackClick,
    handleVisualizerSeek,
    importMaterialFile,
    isAudioPlaying,
    isCoachDataMatching,
    isImportingMaterials,
    isLongMode,
    isPassageSpeechActive,
    isReviewActive,
    isScoring,
    issues,
    longLimitSeconds,
    maxMs,
    noMatchNotice,
    passage,
    passageCoachBoundaries,
    passageCoachDuration,
    passageInputRef,
    practiceMaterial,
    practiceMode,
    preloadCurrentPassage,
    recordedAmplitudes,
    recorderState,
    recordingPlaybackSeekRequest,
    recordingPlaybackStopSignal,
    recordingPlaybackTime,
    recordingStream,
    result,
    reviewIndex,
    reviewJustScored,
    reviewQueue,
    reviewScoredCount,
    reviewSummaryCount,
    selectedWordIndex,
    selectScoredWord,
    setAudioDuration,
    setIsAudioPlaying,
    setPracticeMode,
    setRecordedAmplitudes,
    setRecordingPlaybackTime,
    setReviewSummaryCount,
    shortLimitSeconds,
    showNextReviewWord,
    speechCurrentTime,
    speechDuration,
    speechStatus,
    startRecording,
    status,
    stopCurrentSpeech,
    stopRecording,
    submitRecording,
  } = session;

  useEffect(() => {
    if (!result) {
      setIsResultSheetOpen(false);
      return;
    }

    const activeElement = document.activeElement;
    focusReturnRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    setIsResultSheetOpen(true);
  }, [result]);

  useEffect(() => {
    const dialog = resultSheetRef.current;
    if (!dialog) return;

    if (isResultSheetOpen && result) {
      if (!dialog.open) {
        dialog.showModal();
      }
      resultSheetCloseRef.current?.focus({ preventScroll: true });
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isResultSheetOpen, result]);

  useEffect(() => {
    if (recorderState === "recording") {
      setIsResultSheetOpen(false);
    }
  }, [recorderState]);

  function openMaterialLibrary() {
    materialLibraryRef.current?.querySelector<HTMLButtonElement>("button")?.click();
  }

  function openResultSheet(event: MouseEvent<HTMLButtonElement>) {
    focusReturnRef.current = event.currentTarget;
    setIsResultSheetOpen(true);
  }

  function closeResultSheet() {
    const dialog = resultSheetRef.current;
    if (dialog?.open) {
      dialog.close();
    } else {
      setIsResultSheetOpen(false);
    }
  }

  function handleResultSheetClose() {
    setIsResultSheetOpen(false);
    const focusTarget = focusReturnRef.current?.isConnected
      ? focusReturnRef.current
      : resultChipRef.current;
    focusTarget?.focus({ preventScroll: true });
  }

  function handleResultSheetBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const clickedOutside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (clickedOutside) closeResultSheet();
  }

  function handleStartRecording() {
    setIsResultSheetOpen(false);
    void startRecording();
  }

  const currentTitle = activeMaterial?.title ?? "Free practice";
  const limitSeconds = isLongMode ? longLimitSeconds : shortLimitSeconds;
  const primaryScore = scoreValue(result?.scores.pronunciation);

  return (
    <section
      className={`m-practice ${isResultSheetOpen ? "m-result-sheet-open" : ""}`}
      aria-label="Practice"
    >
      <header className="m-practice-header">
        <div className="m-practice-title">
          <span>Current material</span>
          <strong title={currentTitle}>{currentTitle}</strong>
        </div>
        <button className="m-switch-button" type="button" onClick={openMaterialLibrary}>
          Change
        </button>
        <div className="m-material-library-host" ref={materialLibraryRef}>
          <MaterialLibrary
            materials={session.materials}
            onSelect={practiceMaterial}
            onDeleteGroup={deleteMaterialGroupFromLibrary}
            importAction={
              <MaterialImportAction
                isImporting={isImportingMaterials}
                onImport={(event) => void importMaterialFile(event)}
              />
            }
          />
        </div>
      </header>

      <div className="m-practice-scroll">
        {isReviewActive ? (
          <div className="m-review" role="status">
            <div className="m-review-info">
              <strong>Review {reviewIndex + 1}/{reviewQueue.length}</strong>
              <span>{reviewQueue[reviewIndex]?.word}</span>
            </div>
            <div className="m-review-actions">
              <button className="m-small-button" type="button" onClick={showNextReviewWord}>
                {reviewJustScored ? "Next word" : "Skip word"}
              </button>
              <button className="m-small-button" type="button" onClick={endReview}>
                End review
              </button>
            </div>
          </div>
        ) : reviewSummaryCount !== null ? (
          <div className="m-review" role="status">
            <div className="m-review-info">
              <strong>Review complete</strong>
              <span>
                {reviewScoredCount} practiced, {reviewSummaryCount - reviewScoredCount} skipped
              </span>
            </div>
            <button className="m-small-button" type="button" onClick={() => setReviewSummaryCount(null)}>
              Done
            </button>
          </div>
        ) : null}

        <div className="m-segmented" aria-label="Practice mode">
          <button
            className={`m-segment ${practiceMode === "short" ? "m-segment-active" : ""}`}
            type="button"
            aria-pressed={practiceMode === "short"}
            disabled={recorderState === "recording"}
            onClick={() => setPracticeMode("short")}
          >
            Short Drill
          </button>
          <button
            className={`m-segment ${practiceMode === "long" ? "m-segment-active" : ""}`}
            type="button"
            aria-pressed={practiceMode === "long"}
            disabled={recorderState === "recording"}
            onClick={() => setPracticeMode("long")}
          >
            Long Passage
          </button>
        </div>

        {noMatchNotice ? (
          <p className="m-notice" role="alert">{noMatchNotice}</p>
        ) : null}

        <div className="m-passage">
          {result ? (
            <p className="m-passage-text">{passage}</p>
          ) : (
            <textarea
              ref={passageInputRef}
              className="m-passage-input"
              value={passage}
              onChange={handlePassageChange}
              onBlur={preloadCurrentPassage}
              readOnly={Boolean(activeMaterial)}
              spellCheck
              aria-label="Passage"
            />
          )}
        </div>

        {!result?.words.length && issues.length > 0 ? (
          <div className="m-issue-list">
            {issues.map((issue, index) => (
              <div className="m-issue" key={`${issue.span}-${index}`}>
                <strong>{issue.span}</strong>
                <span>{issue.suggestion}</span>
                <p>{issue.explanation}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="m-recorder">
        <div className={`m-wave-row ${result ? "m-wave-row-with-score" : ""}`}>
          <AudioVisualizer
            recorderState={recorderState}
            audioStream={recordingStream}
            playbackTime={isPassageSpeechActive ? speechCurrentTime : recordingPlaybackTime}
            playbackDuration={isPassageSpeechActive ? speechDuration : audioDuration}
            isAudioPlaying={isPassageSpeechActive ? speechStatus === "playing" : isAudioPlaying}
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
          <div className="m-timer" aria-label="Recording duration">
            <Clock3 size={15} />
            <span>{(elapsedMs / 1000).toFixed(1)} / {limitSeconds}s</span>
          </div>
          {result ? (
            <button
              ref={resultChipRef}
              className="m-result-chip"
              type="button"
              aria-label={`View score ${primaryScore}`}
              aria-haspopup="dialog"
              onClick={openResultSheet}
            >
              <span>Score</span>
              <strong>{primaryScore}</strong>
            </button>
          ) : null}
        </div>

        {audioUrl && !result ? (
          <div className="m-audio-player">
            <AudioPlayer
              audioUrl={audioUrl}
              onPlayStart={stopCurrentSpeech}
              onTimeChange={setRecordingPlaybackTime}
              seekRequest={recordingPlaybackSeekRequest}
              stopSignal={recordingPlaybackStopSignal}
              onIsPlayingChange={setIsAudioPlaying}
              onDurationChange={setAudioDuration}
            />
          </div>
        ) : null}

        <div className="m-record-actions">
          {recorderState === "recording" ? (
            <button className="m-record-button m-record-button-stop" type="button" onClick={stopRecording}>
              <Square size={20} />
              Stop
            </button>
          ) : (
            <button className="m-record-button" type="button" onClick={handleStartRecording}>
              <Mic size={21} />
              Record
            </button>
          )}
          <button
            className="m-score-button"
            type="button"
            disabled={!audioBlob || isScoring}
            onClick={() => void submitRecording()}
          >
            {isScoring ? <Loader2 className="m-spinner" size={20} /> : <UploadCloud size={20} />}
            Score
          </button>
        </div>
        <p className="m-status" aria-live="polite">{status}</p>
      </div>

      {result ? (
        <dialog
          ref={resultSheetRef}
          className="m-result-sheet"
          aria-labelledby="m-result-sheet-title"
          onClick={handleResultSheetBackdropClick}
          onClose={handleResultSheetClose}
        >
          <div className="m-result-sheet-grabber" aria-hidden="true" />
          <header className="m-result-sheet-header">
            <h2 id="m-result-sheet-title">Score</h2>
            <button
              ref={resultSheetCloseRef}
              className="m-result-sheet-close"
              type="button"
              aria-label="Close score"
              onClick={closeResultSheet}
            >
              <X size={20} />
            </button>
          </header>
          <div className="m-result-sheet-body">
            <section className="m-result-score" aria-label="Score breakdown">
              <div className="m-score-grid">
                <ScoreGrid scores={result.scores} />
              </div>
            </section>

            {audioUrl ? (
              <section className="m-result-recording" aria-labelledby="m-result-recording-title">
                <h3 id="m-result-recording-title">Recording</h3>
                <AudioPlayer
                  audioUrl={audioUrl}
                  onPlayStart={stopCurrentSpeech}
                  onTimeChange={setRecordingPlaybackTime}
                  seekRequest={recordingPlaybackSeekRequest}
                  stopSignal={recordingPlaybackStopSignal}
                  onIsPlayingChange={setIsAudioPlaying}
                  onDurationChange={setAudioDuration}
                />
              </section>
            ) : null}

            <section className="m-result-passage" aria-labelledby="m-result-passage-title">
              <h3 id="m-result-passage-title">Passage feedback</h3>
              {result.words.length ? (
                <div className="m-scored-passage">
                  <ScoredPassage
                    words={result.words}
                    selectedWordIndex={selectedWordIndex}
                    activeSpokenWordIndex={activeSpokenWordIndex}
                    onSelectWord={selectScoredWord}
                  />
                </div>
              ) : (
                <p className="m-result-passage-text">{passage}</p>
              )}
            </section>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
