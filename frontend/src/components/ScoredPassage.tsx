import { scoreValue } from "../scoreUtils";
import type { WordResult } from "../types";

type ScoredPassageProps = {
  words: WordResult[];
  selectedWordIndex: number;
  activeSpokenWordIndex: number;
  onSelectWord: (index: number) => void;
};

export function ScoredPassage({
  words,
  selectedWordIndex,
  activeSpokenWordIndex,
  onSelectWord
}: ScoredPassageProps) {
  return (
    <div className="scored-passage-container">
      <div className="scored-passage-box">
        {words.map((word, index) => (
          <button
            type="button"
            key={`${word.word}-${index}`}
            className={`scored-word-token ${word.bucket} ${
              index === selectedWordIndex ? "selected" : ""
            } ${index === activeSpokenWordIndex ? "playing" : ""}`}
            onClick={() => onSelectWord(index)}
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
  );
}
