import { ChevronRight, Loader2, Sparkles, Volume2 } from "lucide-react";
import { scoreTone, scoreValue, topAlternative } from "../scoreUtils";
import type { WordResult } from "../types";

export function PhonemeInspector({
  word,
  onPlay,
  isSpeaking,
  onSelectPhoneme,
}: {
  word: WordResult;
  onPlay: () => void;
  isSpeaking: boolean;
  onSelectPhoneme?: (phoneme: string) => void;
}) {
  return (
    <div className="phoneme-inspector">
      <div className="inspector-title">
        <div>
          <span>Selected word</span>
          <strong>{word.word}</strong>
        </div>
        <div className="inspector-actions">
          <button
            className="icon-button small"
            onClick={onPlay}
            title={`Play ${word.word}`}
            disabled={isSpeaking}
          >
            {isSpeaking ? <Loader2 className="spin" size={15} /> : <Volume2 size={15} />}
          </button>
          <ChevronRight size={18} />
        </div>
      </div>
      <div className="phoneme-list" role="list">
        {word.phonemes.map((phoneme, index) => {
          const alternative = topAlternative(phoneme.phoneme, phoneme.n_best);
          const isClickable = Boolean(onSelectPhoneme);

          return (
            <button
              type="button"
              className={`phoneme-row ${isClickable ? "interactive-row" : ""}`}
              key={`${phoneme.phoneme}-${index}`}
              onClick={isClickable ? () => onSelectPhoneme?.(phoneme.phoneme) : undefined}
              title={isClickable ? `Learn how to pronounce /${phoneme.phoneme}/` : undefined}
            >
              <div className={`phoneme-symbol ${scoreTone(phoneme.accuracy)}`}>
                {phoneme.phoneme}
              </div>
              <div className="phoneme-meta">
                <strong>{scoreValue(phoneme.accuracy)}</strong>
                {alternative ? (
                  <span>
                    heard near /{alternative.phoneme}/ at {scoreValue(alternative.score)}
                  </span>
                ) : (
                  <span>no strong alternative</span>
                )}
              </div>
              {isClickable && (
                <div className="coach-trigger-icon-wrapper" aria-hidden="true">
                  <Sparkles size={13} className="coach-trigger-icon" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

