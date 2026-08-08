import { Loader2, Plus, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import { scoreTone, scoreValue } from "../scoreUtils";
import type { VocabularyItem } from "../types";

export type WordBankTab = "active" | "graduated";

function isDueForReview(item: VocabularyItem, nowMs: number): boolean {
  if (!item.due_at) return true;
  const dueMs = Date.parse(item.due_at);
  return Number.isNaN(dueMs) || dueMs <= nowMs;
}

export function countDueWords(vocabulary: VocabularyItem[]): number {
  const nowMs = Date.now();
  return vocabulary.filter(
    (item) => item.status !== "graduated" && isDueForReview(item, nowMs)
  ).length;
}

function dueSortValue(item: VocabularyItem): number {
  if (!item.due_at) return -Infinity;
  const dueMs = Date.parse(item.due_at);
  return Number.isNaN(dueMs) ? -Infinity : dueMs;
}

// Snapshot of due words for a guided review session, ordered by due_at
// ascending so the most overdue word comes first.
export function getDueWordsForReview(vocabulary: VocabularyItem[]): VocabularyItem[] {
  const nowMs = Date.now();
  return vocabulary
    .filter((item) => item.status !== "graduated" && isDueForReview(item, nowMs))
    .sort((a, b) => dueSortValue(a) - dueSortValue(b));
}

function daysUntilDue(item: VocabularyItem, nowMs: number): number {
  if (!item.due_at) return 0;
  const dueMs = Date.parse(item.due_at);
  if (Number.isNaN(dueMs)) return 0;
  return Math.max(0, Math.ceil((dueMs - nowMs) / 86_400_000));
}

type WordBankPanelProps = {
  vocabulary: VocabularyItem[];
  tab: WordBankTab;
  onTabChange: (tab: WordBankTab) => void;
  requiredSuccesses: number;
  isSaving: boolean;
  onAddWord: (word: string) => Promise<void>;
  onPracticeWord: (item: VocabularyItem) => void;
  onDeleteWord: (wordId: string) => void;
  onStartReview: () => void;
};

export function WordBankPanel({
  vocabulary,
  tab,
  onTabChange,
  requiredSuccesses,
  isSaving,
  onAddWord,
  onPracticeWord,
  onDeleteWord,
  onStartReview
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
  const { dueVocabulary, scheduledVocabulary } = useMemo(() => {
    // Grouping intentionally uses the clock at vocabulary refresh time.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    return {
      dueVocabulary: activeVocabulary.filter((item) => isDueForReview(item, nowMs)),
      scheduledVocabulary: activeVocabulary
        .filter((item) => !isDueForReview(item, nowMs))
        .map((item) => ({ item, dueInDays: daysUntilDue(item, nowMs) }))
    };
  }, [activeVocabulary]);
  const showReviewGroups = tab === "active" && scheduledVocabulary.length > 0;

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
      {tab === "active" && dueVocabulary.length > 0 ? (
        <button
          type="button"
          className="secondary-button start-review-button"
          onClick={onStartReview}
        >
          Start review ({dueVocabulary.length})
        </button>
      ) : null}
      <div className="word-bank-list">
        {vocabulary.length === 0 ? (
          <p className="muted">No saved words yet.</p>
        ) : visibleVocabulary.length === 0 ? (
          <p className="muted">
            {tab === "active" ? "No in-progress words." : "No graduated words yet."}
          </p>
        ) : showReviewGroups ? (
          <>
            {dueVocabulary.length > 0 ? (
              <>
                <p className="muted word-group-label">Due for review ({dueVocabulary.length})</p>
                {dueVocabulary.map((item) => renderWordRow(item))}
              </>
            ) : (
              <p className="muted">All caught up — nothing due for review.</p>
            )}
            <p className="muted word-group-label">Scheduled ({scheduledVocabulary.length})</p>
            {scheduledVocabulary.map(({ item, dueInDays }) => renderWordRow(item, dueInDays))}
          </>
        ) : (
          visibleVocabulary.map((item) => renderWordRow(item))
        )}
      </div>
    </>
  );

  function renderWordRow(item: VocabularyItem, dueInDays?: number) {
    return (
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
            {dueInDays !== undefined ? ` · review in ${dueInDays}d` : ""}
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
    );
  }
}
