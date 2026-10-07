import { getDueWordsForReview } from "../components/WordBankPanel";
import type { PhonemeStat, RunPrompt, VocabularyItem } from "../types";
import { DEFAULT_STARTER_PHONEME, STARTER_PACK, type StarterItem, type StarterPhoneme } from "./starterPack";

const PACK_PHONEMES = new Set<string>(STARTER_PACK.map((item) => item.phoneme));

function packPhoneme(phoneme: string): string {
  return phoneme === "r" ? "ɹ" : phoneme;
}

// Weakest measured phoneme the pack covers; shown as "today's sound", never
// as a diagnosis.
export function chooseFocusPhoneme(stats: readonly PhonemeStat[]): StarterPhoneme {
  let focus: StarterPhoneme = DEFAULT_STARTER_PHONEME;
  let lowest = Infinity;
  for (const stat of stats) {
    const phoneme = packPhoneme(stat.phoneme);
    if (PACK_PHONEMES.has(phoneme) && Number.isFinite(stat.average_accuracy) && stat.average_accuracy < lowest) {
      focus = phoneme as StarterPhoneme;
      lowest = stat.average_accuracy;
    }
  }
  return focus;
}

const BOUNDARY_PUNCTUATION = /^[.,!?;:"'()[\]{}]+|[.,!?;:"'()[\]{}]+$/g;

// Mirrors the backend's _single_word_reference: the scoring target of a word
// prompt, or "" when the text is not one word. Used lowercased as the dedupe key.
function singleWordKey(text: string): string {
  const stripped = text.trim().replace(BOUNDARY_PUNCTUATION, "").trim();
  return stripped && stripped.split(/\s+/).length === 1 ? stripped.toLowerCase() : "";
}

function starterPrompt(item: StarterItem, itemId: string): RunPrompt {
  return {
    itemId,
    stage: item.stage,
    kind: item.stage === "context" ? "sentence" : "word",
    text: item.text,
    targetPhoneme: item.phoneme,
    targetWord: item.targetWord,
    source: "starter",
  };
}

export type RunDeckInput = {
  phonemeStats: readonly PhonemeStat[];
  vocabulary: VocabularyItem[];
  previousWeakWords?: readonly string[];
};

// Two Warmup, two Focus, and two Context prompts, frozen at run start.
export function buildRunDeck({ phonemeStats, vocabulary, previousWeakWords = [] }: RunDeckInput): readonly RunPrompt[] {
  const phoneme = chooseFocusPhoneme(phonemeStats);
  const group = STARTER_PACK.filter((item) => item.phoneme === phoneme);
  const taken = new Set(group.filter((item) => item.stage !== "context").map((item) => singleWordKey(item.text)));
  taken.add(singleWordKey(group.filter((item) => item.stage === "context")[1].targetWord));

  const warmups: RunPrompt[] = [];
  const external: [string, RunPrompt["source"]][] = [
    ...previousWeakWords.map((word): [string, RunPrompt["source"]] => [word, "previous-run"]),
    ...getDueWordsForReview(vocabulary).map((item): [string, RunPrompt["source"]] => [item.word, "due-word"]),
  ];
  for (const [raw, source] of external) {
    if (warmups.length === 2) break;
    const text = raw.trim();
    const key = singleWordKey(text);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    warmups.push({
      itemId: `warmup-${warmups.length + 1}`,
      stage: "warmup",
      kind: "word",
      text,
      targetPhoneme: null,
      targetWord: text,
      source,
    });
  }
  for (const item of group.filter((starter) => starter.stage === "warmup")) {
    if (warmups.length === 2) break;
    warmups.push(starterPrompt(item, `warmup-${warmups.length + 1}`));
  }

  const rest = group
    .filter((item) => item.stage !== "warmup")
    .map((item, index) => starterPrompt(item, `${item.stage}-${(index % 2) + 1}`));
  return Object.freeze([...warmups, ...rest].map((prompt) => Object.freeze(prompt)));
}
