// Typed UI fixtures for Game Mode v3 screens. For now these are the six frozen configurations
// only; run states from the real reducer and selectors join them once A2/A3 land (B2).
import type { RunConfig, StarterRunConfig, WordsRunConfig } from "../types";

export const STARTER_ROUTE_6 = Object.freeze({
  source: "starter",
  mode: "route",
  length: 6,
  target: null,
  maxExtra: 2
} as const satisfies StarterRunConfig);

export const STARTER_ROUTE_12 = Object.freeze({
  source: "starter",
  mode: "route",
  length: 12,
  target: null,
  maxExtra: 4
} as const satisfies StarterRunConfig);

export const TARGET_60 = Object.freeze({
  source: "starter",
  mode: "challenge",
  length: 6,
  target: 60,
  maxExtra: 2
} as const satisfies StarterRunConfig);

export const TARGET_85 = Object.freeze({
  source: "starter",
  mode: "challenge",
  length: 6,
  target: 85,
  maxExtra: 4
} as const satisfies StarterRunConfig);

export const WORDS_ROUTE_6 = Object.freeze({
  source: "words",
  mode: "route",
  length: 6,
  target: null,
  maxExtra: 2
} as const satisfies WordsRunConfig);

export const WORDS_ROUTE_12 = Object.freeze({
  source: "words",
  mode: "route",
  length: 12,
  target: null,
  maxExtra: 4
} as const satisfies WordsRunConfig);

export const STARTER_CONFIGS: readonly StarterRunConfig[] = [STARTER_ROUTE_6, STARTER_ROUTE_12, TARGET_60, TARGET_85];
export const WORDS_CONFIGS: readonly WordsRunConfig[] = [WORDS_ROUTE_6, WORDS_ROUTE_12];
export const ALL_CONFIGS: readonly RunConfig[] = [...STARTER_CONFIGS, ...WORDS_CONFIGS];
