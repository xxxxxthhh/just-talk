import { ChevronRight, Loader2, Volume2 } from "lucide-react";
import { scoreTone, scoreValue, topAlternative } from "../scoreUtils";
import type { WordResult } from "../types";

export function PhonemeInspector({
  word,
  onPlay,
  isSpeaking,
}: {
  word: WordResult;
  onPlay: () => void;
  isSpeaking: boolean;
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
      <div className="phoneme-list">
        {word.phonemes.map((phoneme, index) => {
          const alternative = topAlternative(phoneme.phoneme, phoneme.n_best);
          return (
            <div className="phoneme-row" key={`${phoneme.phoneme}-${index}`}>
              <div className={`phoneme-symbol ${scoreTone(phoneme.accuracy)}`}>
                {phoneme.phoneme}
              </div>
              <div>
                <strong>{scoreValue(phoneme.accuracy)}</strong>
                {alternative ? (
                  <span>
                    heard near /{alternative.phoneme}/ at {scoreValue(alternative.score)}
                  </span>
                ) : (
                  <span>no strong alternative</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
