import { getDueWordsForReview } from "../components/WordBankPanel";
import type { PhonemeStat, RunFocusPhoneme, RunPrompt, StarterRunConfig, VocabularyItem } from "../types";
import { DEFAULT_STARTER_PHONEME, STARTER_PACK, type StarterItem } from "./starterPack";

const PACK_PHONEMES = new Set<string>(STARTER_PACK.map((item) => item.phoneme));
const STAGES = ["warmup", "focus", "context"] as const;

function packPhoneme(phoneme: string): string {
  return phoneme === "r" ? "ɹ" : phoneme;
}

// Weakest measured phoneme the pack covers; shown as "today's sound", never
// as a diagnosis.
export function chooseFocusPhoneme(stats: readonly PhonemeStat[]): RunFocusPhoneme {
  let focus: RunFocusPhoneme = DEFAULT_STARTER_PHONEME;
  let lowest = Infinity;
  for (const stat of stats) {
    const phoneme = packPhoneme(stat.phoneme);
    if (PACK_PHONEMES.has(phoneme) && Number.isFinite(stat.average_accuracy) && stat.average_accuracy < lowest) {
      focus = phoneme as RunFocusPhoneme;
      lowest = stat.average_accuracy;
    }
  }
  return focus;
}

const BOUNDARY_PUNCTUATION = /^[.,!?;:"'()[\]{}]+|[.,!?;:"'()[\]{}]+$/g;

// Mirrors the backend's _single_word_reference: the scoring target of a word
// prompt, or "" when the text is not one word. Used lowercased as the dedupe key.
export function singleWordKey(text: string): string {
  const stripped = text.trim().replace(BOUNDARY_PUNCTUATION, "").trim();
  return stripped && stripped.split(/\s+/).length === 1 ? stripped.toLowerCase() : "";
}

// FNV-1a over the seed's UTF-16 code units, feeding a mulberry32 generator. Deterministic for a seed
// on every platform; never Math.random.
function seededRandom(seed: string): () => number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Chooses count items by a partial Fisher–Yates shuffle seeded with `${runId}|${phoneme}|${stage}`,
// then restores the pack's canonical order: the seed changes membership, never presentation order.
function seededSubset<T>(pool: readonly T[], count: number, seed: string): T[] {
  if (pool.length < count) throw new Error("The starter pack cannot fill this run.");
  const random = seededRandom(seed);
  const indices = pool.map((_, index) => index);
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (indices.length - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices
    .slice(0, count)
    .sort((left, right) => left - right)
    .map((index) => pool[index]);
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

// The runId is allocated before the deck, so the same run always rebuilds the same deck.
export type RunDeckInput = Readonly<{
  runId: string;
  config: StarterRunConfig;
  focusPhoneme: RunFocusPhoneme;
  vocabulary: VocabularyItem[];
  previousWeakWords?: readonly string[];
}>;

// N/3 Warm-up, Focus, and In-context prompts for one focus sound, frozen at run start. Six-item runs
// sample two of each stage's starter items; twelve use four. Warm-ups take eligible previous weak
// words, then due words, then seeded starter warm-ups.
export function buildRunDeck({
  runId,
  config,
  focusPhoneme,
  vocabulary,
  previousWeakWords = [],
}: RunDeckInput): readonly Readonly<RunPrompt>[] {
  const perStage = config.length / STAGES.length;
  const group = STARTER_PACK.filter((item) => item.phoneme === focusPhoneme);
  const stage = (name: (typeof STAGES)[number]) => group.filter((item) => item.stage === name);
  const sample = (name: (typeof STAGES)[number], count: number) =>
    seededSubset(stage(name), count, `${runId}|${focusPhoneme}|${name}`);

  // Personal warm-ups never repeat a word this sound's starter items use, sampled into this run or not.
  const taken = new Set(group.filter((item) => item.stage !== "context").map((item) => singleWordKey(item.text)));
  for (const item of stage("context")) taken.add(singleWordKey(item.targetWord));

  const personal: RunPrompt[] = [];
  const external: [string, RunPrompt["source"]][] = [
    ...previousWeakWords.map((word): [string, RunPrompt["source"]] => [word, "previous-run"]),
    ...getDueWordsForReview(vocabulary).map((item): [string, RunPrompt["source"]] => [item.word, "due-word"]),
  ];
  for (const [raw, source] of external) {
    if (personal.length === perStage) break;
    const text = raw.trim();
    const key = singleWordKey(text);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    personal.push({ itemId: "", stage: "warmup", kind: "word", text, targetPhoneme: null, targetWord: text, source });
  }
  const warmups = [
    ...personal,
    ...sample("warmup", perStage - personal.length).map((item) => starterPrompt(item, "")),
  ].map((prompt, index) => ({ ...prompt, itemId: `warmup-${index + 1}` }));

  const rest = (["focus", "context"] as const).flatMap((name) =>
    sample(name, perStage).map((item, index) => starterPrompt(item, `${name}-${index + 1}`))
  );
  return Object.freeze([...warmups, ...rest].map((prompt) => Object.freeze(prompt)));
}
