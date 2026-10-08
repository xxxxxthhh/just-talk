import type {
  RunChoice,
  RunConfig,
  RunFocusPhoneme,
  RunLength,
  RunPrompt,
  StarterRunConfig,
  WordsRunConfig
} from "../types";

// The six accepted run configurations, frozen once. Pure: no preferences, storage, or audio.
const ROUTE_6: StarterRunConfig = Object.freeze({ source: "starter", mode: "route", length: 6, target: null, maxExtra: 2 });
const ROUTE_12: StarterRunConfig = Object.freeze({ source: "starter", mode: "route", length: 12, target: null, maxExtra: 4 });
const TARGET_60: StarterRunConfig = Object.freeze({ source: "starter", mode: "challenge", length: 6, target: 60, maxExtra: 2 });
const TARGET_85: StarterRunConfig = Object.freeze({ source: "starter", mode: "challenge", length: 6, target: 85, maxExtra: 4 });
const WORDS_6: WordsRunConfig = Object.freeze({ source: "words", mode: "route", length: 6, target: null, maxExtra: 2 });
const WORDS_12: WordsRunConfig = Object.freeze({ source: "words", mode: "route", length: 12, target: null, maxExtra: 4 });
const CONFIGS: readonly RunConfig[] = [ROUTE_6, ROUTE_12, TARGET_60, TARGET_85, WORDS_6, WORDS_12];
const CONFIG_KEYS = ["source", "mode", "length", "target", "maxExtra"] as const;

const FOCUS_CYCLE: readonly RunFocusPhoneme[] = ["θ", "ð", "ɹ", "l", "v"];
const STARTER_STAGES = ["warmup", "focus", "context"] as const;

// Challenge is always six items; the remembered Route length only applies to Route.
export function configForChoice(choice: RunChoice): StarterRunConfig {
  if (choice.selection === "target60") return TARGET_60;
  if (choice.selection === "target85") return TARGET_85;
  return choice.routeLength === 12 ? ROUTE_12 : ROUTE_6;
}

export function wordsConfig(length: RunLength): WordsRunConfig {
  return length === 12 ? WORDS_12 : WORDS_6;
}

// Exactly one of the six configurations, with no extra fields.
export function isRunConfig(value: unknown): value is RunConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== CONFIG_KEYS.length) return false;
  return CONFIGS.some((config) => CONFIG_KEYS.every((key) => key in record && record[key] === config[key]));
}

export function maxCountedScores(config: RunConfig): number {
  return config.length + config.maxExtra;
}

export function nextFocusPhoneme(focus: RunFocusPhoneme): RunFocusPhoneme {
  return FOCUS_CYCLE[(FOCUS_CYCLE.indexOf(focus) + 1) % FOCUS_CYCLE.length];
}

export function isFocusPhoneme(value: unknown): value is RunFocusPhoneme {
  return FOCUS_CYCLE.some((focus) => focus === value);
}

// The deck Start may accept for this configuration: exact size, unique IDs and texts, and the
// source's shape. Starter: N/3 Warm-up, Focus, and In-context prompts sharing one focus sound.
// Words: N single words with no stage split or target sound.
export function isValidRunDeck(config: RunConfig, prompts: readonly Readonly<RunPrompt>[]): boolean {
  if (prompts.length !== config.length) return false;
  const texts = prompts.map((prompt) => prompt.text.trim().toLowerCase());
  if (texts.some((text) => text === "")) return false;
  if (new Set(texts).size !== prompts.length) return false;
  if (new Set(prompts.map((prompt) => prompt.itemId)).size !== prompts.length) return false;

  if (config.source === "words") {
    return prompts.every(
      (prompt) =>
        prompt.stage === "words" &&
        prompt.kind === "word" &&
        prompt.targetPhoneme === null &&
        prompt.targetWord === prompt.text &&
        /^\S+$/.test(prompt.text)
    );
  }
  const perStage = config.length / STARTER_STAGES.length;
  const focus = prompts[perStage].targetPhoneme;
  if (!isFocusPhoneme(focus)) return false;
  return prompts.every((prompt, index) => {
    const stage = STARTER_STAGES[Math.floor(index / perStage)];
    if (prompt.stage !== stage || prompt.kind !== (stage === "context" ? "sentence" : "word")) return false;
    // A personal warm-up has no target sound; a starter one carries the run's focus.
    if (stage === "warmup") return prompt.targetPhoneme === null || prompt.targetPhoneme === focus;
    return prompt.targetPhoneme === focus;
  });
}
