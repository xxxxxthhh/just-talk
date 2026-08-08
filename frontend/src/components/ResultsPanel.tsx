import { AlertCircle, BookmarkPlus, Loader2, Play, Sparkles, Volume2 } from "lucide-react";

import { normalizedWord, scoreTone, scoreValue } from "../scoreUtils";
import type { ScoreResult, WordResult } from "../types";
import { PhonemeInspector } from "./PhonemeInspector";
import { ScoreGrid } from "./ScoreGrid";

type ResultsPanelProps = {
  hidden: boolean;
  result: ScoreResult | null;
  weakWords: WordResult[];
  savedWords: Set<string>;
  selectedWord: WordResult | null;
  speakingText: string;
  isSpeechBusy: boolean;
  noMatchNotice: string;
  isSavingWords: boolean;
  onSaveWeakWords: () => void;
  onSaveWeakWord: (word: WordResult) => void;
  onSelectWeakWord: (word: WordResult) => void;
  onPlayWord: (text: string) => void;
  onSelectPhoneme: (phoneme: string | null) => void;
};

export function ResultsPanel({
  hidden,
  result,
  weakWords,
  savedWords,
  selectedWord,
  speakingText,
  isSpeechBusy,
  noMatchNotice,
  isSavingWords,
  onSaveWeakWords,
  onSaveWeakWord,
  onSelectWeakWord,
  onPlayWord,
  onSelectPhoneme
}: ResultsPanelProps) {
  return (
    <section className="results-panel" hidden={hidden}>
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

      {result?.warnings?.length ? (
        <div className="banner" role="alert">
          <AlertCircle size={16} />
          <span>{result.warnings.join(" ")}</span>
        </div>
      ) : null}

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
              onClick={onSaveWeakWords}
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
                  <button className="weak-main" onClick={() => onSelectWeakWord(word)}>
                    <strong>{word.word}</strong>
                    <span>{scoreValue(word.accuracy)}</span>
                  </button>
                  <button
                    className="icon-button small"
                    onClick={() => onPlayWord(word.word)}
                    title={`Play ${word.word}`}
                    disabled={isSpeechBusy}
                  >
                    <Volume2 size={15} />
                  </button>
                  <button
                    className="secondary-button compact"
                    onClick={() => onSaveWeakWord(word)}
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
          {noMatchNotice ? (
            <div className="empty-state" role="alert">
              <AlertCircle size={22} />
              <p className="empty-state-title">{noMatchNotice}</p>
            </div>
          ) : (
            <div className="empty-state">
              <Play size={22} />
              <p className="empty-state-title">Ready when you are</p>
              <ol className="practice-steps">
                <li>
                  <span className="step-dot">1</span>
                  Pick a passage, material, or word
                </li>
                <li>
                  <span className="step-dot">2</span>
                  Hit Record and read it aloud
                </li>
                <li>
                  <span className="step-dot">3</span>
                  Score it to see word and phoneme feedback
                </li>
              </ol>
            </div>
          )}
        </div>
      ) : null}

      {selectedWord ? (
        <PhonemeInspector
          word={selectedWord}
          onPlay={() => onPlayWord(selectedWord.word)}
          isSpeaking={speakingText === selectedWord.word && isSpeechBusy}
          onSelectPhoneme={onSelectPhoneme}
        />
      ) : null}
    </section>
  );
}
