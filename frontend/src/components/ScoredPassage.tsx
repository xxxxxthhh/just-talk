import { scoreValue } from "../scoreUtils";
import type { ProsodyIssue, WordResult } from "../types";

type ScoredPassageProps = {
  words: WordResult[];
  selectedWordIndex: number;
  activeSpokenWordIndex: number;
  onSelectWord: (index: number) => void;
};

const PROSODY_ISSUE_LABELS: Record<ProsodyIssue, string> = {
  unexpected_break: "Unexpected pause before this word",
  missing_break: "Missing pause before this word",
  monotone: "Flat/monotone delivery"
};

function prosodyIssueTitle(issues: ProsodyIssue[]): string {
  return issues.map((issue) => PROSODY_ISSUE_LABELS[issue] ?? issue).join("; ");
}

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
            title={word.prosody_issues?.length ? prosodyIssueTitle(word.prosody_issues) : undefined}
          >
            <span>{word.word} </span>
            <strong>{scoreValue(word.accuracy)}</strong>
            {word.prosody_issues?.length ? (
              <span className="prosody-issue-dot" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: "4px", fontSize: "11.5px" }}>
        💡 Tip: Click any colored word token above to inspect its detailed sound/phoneme analysis.
      </p>
      <p className="muted prosody-legend" style={{ fontSize: "11.5px" }}>
        <span className="prosody-issue-dot" aria-hidden="true" /> = prosody issue (pause or flat delivery near this word)
      </p>
    </div>
  );
}
