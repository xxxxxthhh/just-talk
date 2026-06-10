import { Loader2, Plus, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import { scoreTone, scoreValue } from "../scoreUtils";
import type { VocabularyItem } from "../types";

export type WordBankTab = "active" | "graduated";

type WordBankPanelProps = {
  vocabulary: VocabularyItem[];
  tab: WordBankTab;
  onTabChange: (tab: WordBankTab) => void;
  requiredSuccesses: number;
  isSaving: boolean;
  onAddWord: (word: string) => Promise<void>;
  onPracticeWord: (item: VocabularyItem) => void;
  onDeleteWord: (wordId: string) => void;
};

export function WordBankPanel({
  vocabulary,
  tab,
  onTabChange,
  requiredSuccesses,
  isSaving,
  onAddWord,
  onPracticeWord,
  onDeleteWord
}: WordBankPanelProps) {
  const [newWord, setNewWord] = useState("");
  const activeVocabulary = useMemo(
    () => vocabulary.filter((item) => item.status !== "graduated"),
    [vocabulary]
  );
  const graduatedVocabulary = useMemo(
    () => vocabulary.filter((item) => item.status === "graduated"),
    [vocabulary]
  );
  const visibleVocabulary = tab === "active" ? activeVocabulary : graduatedVocabulary;

  async function handleAddWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const word = newWord.trim();
    if (!word) {
      return;
    }
    try {
      await onAddWord(word);
      setNewWord("");
    } catch {
      // The parent surfaced the error; keep the input so the user can retry.
    }
  }

  return (
    <>
      <form className="word-form" onSubmit={(event) => void handleAddWord(event)}>
        <input
          value={newWord}
          onChange={(event) => setNewWord(event.target.value)}
          placeholder="Add a word"
          aria-label="Add a word"
        />
        <button className="icon-button" disabled={isSaving} title="Add word">
          {isSaving ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
        </button>
      </form>
      <div className="word-tabs" aria-label="Word bank status">
        <button
          type="button"
          className={`word-tab ${tab === "active" ? "selected" : ""}`}
          aria-pressed={tab === "active"}
          onClick={() => onTabChange("active")}
        >
          In Progress <span>{activeVocabulary.length}</span>
        </button>
        <button
          type="button"
          className={`word-tab ${tab === "graduated" ? "selected" : ""}`}
          aria-pressed={tab === "graduated"}
          onClick={() => onTabChange("graduated")}
        >
          Graduated <span>{graduatedVocabulary.length}</span>
        </button>
      </div>
      <div className="word-bank-list">
        {vocabulary.length === 0 ? (
          <p className="muted">No saved words yet.</p>
        ) : visibleVocabulary.length === 0 ? (
          <p className="muted">
            {tab === "active" ? "No in-progress words." : "No graduated words yet."}
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
                onClick={() => onPracticeWord(item)}
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
                onClick={() => onDeleteWord(item.id)}
                title={`Delete ${item.word}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
