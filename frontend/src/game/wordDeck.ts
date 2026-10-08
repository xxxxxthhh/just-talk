import { getDueWordsForReview } from "../components/WordBankPanel";
import type { RevisitWordSeed, RunPrompt, VocabularyItem, WordsRunConfig } from "../types";
import { singleWordKey } from "./runDeck";

// My words decks: N single words from the word bank, in a meaningful priority order. No seeding,
// no starter filler, no padding or shrinking.

function graduatedKeys(vocabulary: readonly VocabularyItem[]): Set<string> {
  return new Set(vocabulary.filter((row) => row.status === "graduated").map((row) => singleWordKey(row.word)));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// The bank rows a words run may use, one per key, ordered by key then ID. A key with any graduated
// row is left out, even if another spelling of it is still active; duplicate active rows keep the
// smallest ID.
export function wordsBankSnapshot(vocabulary: readonly VocabularyItem[]): VocabularyItem[] {
  const graduated = graduatedKeys(vocabulary);
  const byKey = new Map<string, VocabularyItem>();
  for (const row of vocabulary) {
    const key = singleWordKey(row.word);
    if (!key || row.status === "graduated" || graduated.has(key)) continue;
    const kept = byKey.get(key);
    if (!kept || row.id < kept.id) byKey.set(key, row);
  }
  return [...byKey.entries()].sort(([left], [right]) => compareText(left, right)).map(([, row]) => row);
}

// The existing review queue's due order, taken once at Start from the canonical snapshot so that
// equal due dates break ties the same way every time. Reads the clock; the deck builder does not.
export function snapshotDueWordIds(vocabulary: readonly VocabularyItem[]): string[] {
  return getDueWordsForReview(wordsBankSnapshot(vocabulary)).map((row) => row.id);
}

function latestScore(row: VocabularyItem): number {
  return typeof row.latest_score === "number" && Number.isFinite(row.latest_score) ? row.latest_score : Infinity;
}

export type WordsDeckInput = Readonly<{
  config: WordsRunConfig;
  vocabulary: readonly VocabularyItem[];
  dueWordIds: readonly string[];
  reviewSeeds?: readonly RevisitWordSeed[];
}>;

export function wordsShortageMessage(length: number, available: number): string {
  return length === 6
    ? "Add more active single words to start a 6-word run."
    : `Need ${length} active words · ${available} available`;
}

export const NO_REVISIT_WORDS = "None of these words are still active in your word bank.";

// Revisit seeds come first (a seed may be absent from the bank), then due words, then the rest by
// lowest latest score, unscored last, ties by word then ID. Graduated keys never enter. Throws when
// seeds were given but none survive, or when fewer than N words are available.
export function buildWordsDeck({ config, vocabulary, dueWordIds, reviewSeeds = [] }: WordsDeckInput): readonly Readonly<RunPrompt>[] {
  const bank = wordsBankSnapshot(vocabulary);
  const graduated = graduatedKeys(vocabulary);
  const taken = new Set<string>();
  const prompts: RunPrompt[] = [];
  const add = (raw: string, source: RunPrompt["source"]) => {
    const text = raw.trim();
    const key = singleWordKey(text);
    if (!key || taken.has(key) || graduated.has(key)) return;
    taken.add(key);
    prompts.push({ itemId: "", stage: "words", kind: "word", text, targetPhoneme: null, targetWord: text, source });
  };

  for (const seed of reviewSeeds) add(seed.word, "run-review");
  if (reviewSeeds.length > 0 && prompts.length === 0) throw new Error(NO_REVISIT_WORDS);
  const byId = new Map(bank.map((row) => [row.id, row]));
  for (const id of dueWordIds) {
    const row = byId.get(id);
    if (row) add(row.word, "word-bank");
  }
  const rest = bank
    .filter((row) => !taken.has(singleWordKey(row.word)))
    .sort(
      (left, right) =>
        latestScore(left) - latestScore(right) ||
        compareText(singleWordKey(left.word), singleWordKey(right.word)) ||
        compareText(left.id, right.id)
    );
  for (const row of rest) add(row.word, "word-bank");

  if (prompts.length < config.length) throw new Error(wordsShortageMessage(config.length, prompts.length));
  return Object.freeze(
    prompts.slice(0, config.length).map((prompt, index) => Object.freeze({ ...prompt, itemId: `words-${index + 1}` }))
  );
}
