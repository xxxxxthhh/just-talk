import { useState } from "react";

import { WordBankPanel, type WordBankTab } from "../../components/WordBankPanel";
import { radioKeys } from "../../components/radioKeys";
import { maxCountedScores, wordsConfig } from "../../game/runConfig";
import type { RunLength } from "../../types";
import { usePracticeSession } from "../../usePracticeSession";
import { usePublicScoresLeft } from "../usePublicScoresLeft";

type PracticeSessionState = ReturnType<typeof usePracticeSession>;

// The My words entry's state lives in MobileApp, above this screen, so a pending start or its error
// survives switching tabs.
export type WordsRunEntry = {
  // From the cached bank: a preview, not a reservation. Start checks the fresh bank.
  availability: Readonly<{ eligibleCount: number; canStart6: boolean; canStart12: boolean }>;
  length: RunLength;
  onLengthChange: (length: RunLength) => void;
  // The controller's accepted start, until its deck is ready or abandoned.
  starting: boolean;
  error: string | null;
  onStart: (length: RunLength) => void;
  onCancel: () => void;
};

type WordsScreenProps = {
  session: PracticeSessionState;
  onOpenPractice: () => void;
  // Asked before a practice entry changes the shared session; false cancels it.
  confirmLeaveRun: () => boolean;
  wordsRun: WordsRunEntry;
};

const LENGTHS: readonly RunLength[] = [6, 12];

export default function WordsScreen({ session, onOpenPractice, confirmLeaveRun, wordsRun }: WordsScreenProps) {
  const [wordTab, setWordTab] = useState<WordBankTab>("active");

  return (
    <section className="m-screen" aria-labelledby="m-words-title">
      <header className="m-screen-header">
        <h1 id="m-words-title">Word Bank</h1>
        <p>{session.dueWordCount > 0 ? `${session.dueWordCount} due for review` : "All caught up"}</p>
      </header>
      <div className="m-screen-scroll">
        <WordsRunCard session={session} wordsRun={wordsRun} />
        {/* While a words run is starting, nothing here may change the practice context. */}
        <div className="m-component-surface m-words-content" inert={wordsRun.starting || undefined}>
          <WordBankPanel
            vocabulary={session.vocabulary}
            tab={wordTab}
            onTabChange={setWordTab}
            requiredSuccesses={session.requiredSuccesses}
            isSaving={session.isSavingWords}
            onAddWord={session.addManualWord}
            onPracticeWord={(item) => {
              if (!confirmLeaveRun()) return;
              session.practiceVocabularyWord(item);
              onOpenPractice();
            }}
            onDeleteWord={(wordId) => void session.removeVocabularyWord(wordId)}
            onStartReview={() => {
              if (!confirmLeaveRun()) return;
              session.startReview();
              onOpenPractice();
            }}
          />
        </div>
      </div>
    </section>
  );
}

// "Start a run with my words": a no-hearts Route of exactly 6 or 12 active single words, due first.
// It never shrinks a chosen 12 or pads with other words; with too few, it says how many there are.
function WordsRunCard({ session, wordsRun }: { session: PracticeSessionState; wordsRun: WordsRunEntry }) {
  const scoresLeft = usePublicScoresLeft();
  const { availability, length, starting } = wordsRun;
  // The same busy facts as the Practice entry: an ordinary take, its scoring, or a drill.
  const busy = session.recorderState === "recording" || session.isScoring || Boolean(session.insights.generatingPhoneme);
  const canStart = length === 12 ? availability.canStart12 : availability.canStart6;
  // One tab stop: the checked length, or the first available one when that is unavailable.
  const available = LENGTHS.filter((option) => (option === 12 ? availability.canStart12 : availability.canStart6));
  const tabStop = available.includes(length) ? length : available[0];
  const shortage = !availability.canStart6
    ? "Add more active single words to start a 6-word run."
    : !availability.canStart12
      ? `Need 12 active words · ${availability.eligibleCount} available`
      : null;

  return (
    <section className="m-words-run" aria-labelledby="m-words-run-title">
      <div className="m-words-run-head">
        <h2 id="m-words-run-title">Start a run with my words</h2>
        <p>Due words first · no hearts</p>
      </div>
      <div className="m-words-run-row">
        <div
          className="m-words-run-lengths"
          role="radiogroup"
          aria-label="Words run length"
          onKeyDown={starting ? undefined : radioKeys(available, length, wordsRun.onLengthChange)}
        >
          {LENGTHS.map((option) => {
            const available = option === 12 ? availability.canStart12 : availability.canStart6;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === length}
                aria-label={`${option} words`}
                tabIndex={option === tabStop ? 0 : -1}
                data-radio-value={option}
                className="m-words-run-length"
                disabled={starting || !available}
                onClick={() => wordsRun.onLengthChange(option)}
              >
                {option}
              </button>
            );
          })}
        </div>
        <p className="m-words-run-count">
          {availability.eligibleCount} active {availability.eligibleCount === 1 ? "word" : "words"}
        </p>
      </div>
      {shortage ? <p className="m-words-run-hint">{shortage}</p> : null}
      <div className="m-words-run-actions">
        <button
          type="button"
          className="m-words-run-start"
          disabled={busy || starting || !canStart}
          onClick={() => wordsRun.onStart(length)}
        >
          {starting ? "Starting…" : `Start ${length} words`}
        </button>
        {starting ? (
          <button type="button" className="m-small-button" onClick={wordsRun.onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {wordsRun.error ? (
        <p className="m-words-run-error" role="alert">
          {wordsRun.error}
        </p>
      ) : null}
      {scoresLeft !== null ? (
        <p className="m-words-run-usage">
          Up to {maxCountedScores(wordsConfig(length))} scores · {scoresLeft} left today
        </p>
      ) : null}
    </section>
  );
}
