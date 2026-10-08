// Typed UI fixtures for Game Mode v3 screens. For now these are the six frozen configurations,
// taken from the real constructors; run states from the real reducer and selectors follow (B2).
import { configForChoice, wordsConfig } from "../game/runConfig";
import type { RunConfig, StarterRunConfig, WordsRunConfig } from "../types";

export const STARTER_ROUTE_6 = configForChoice({ selection: "route", routeLength: 6 });
export const STARTER_ROUTE_12 = configForChoice({ selection: "route", routeLength: 12 });
export const TARGET_60 = configForChoice({ selection: "target60", routeLength: 6 });
export const TARGET_85 = configForChoice({ selection: "target85", routeLength: 6 });
export const WORDS_ROUTE_6 = wordsConfig(6);
export const WORDS_ROUTE_12 = wordsConfig(12);

export const STARTER_CONFIGS: readonly StarterRunConfig[] = [STARTER_ROUTE_6, STARTER_ROUTE_12, TARGET_60, TARGET_85];
export const WORDS_CONFIGS: readonly WordsRunConfig[] = [WORDS_ROUTE_6, WORDS_ROUTE_12];
export const ALL_CONFIGS: readonly RunConfig[] = [...STARTER_CONFIGS, ...WORDS_CONFIGS];
