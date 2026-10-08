import { useSyncExternalStore } from "react";

import type { RunChoice, RunLength, RunSelection } from "../types";
import { RUN_BEST_KEY } from "./personalBest";

// Shared by the entry card and the run: one value per browser, both on by default.
export const SFX_KEY = "jt.sfx";
export const AUTO_STOP_KEY = "jt.autoStop";
// The entry card's last starter choice. Never a saved run: it only preselects the next Start.
export const RUN_CONFIG_KEY = "jt.runConfig.v1";

export type RunPreferences = Readonly<{ sfx: boolean; autoStop: boolean }>;

const KEYS: Record<keyof RunPreferences, string> = { sfx: SFX_KEY, autoStop: AUTO_STOP_KEY };
const listeners = new Set<() => void>();
let current: RunPreferences | null = null;

function stored(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

// Captures snapshot this when they start, so a toggle mid-take applies from the next take.
export function getRunPreferences(): RunPreferences {
  current ??= { sfx: stored(SFX_KEY), autoStop: stored(AUTO_STOP_KEY) };
  return current;
}

export function setRunPreference(name: keyof RunPreferences, value: boolean): void {
  const preferences = getRunPreferences();
  if (preferences[name] === value) return;
  current = { ...preferences, [name]: value };
  try {
    window.localStorage.setItem(KEYS[name], String(value));
  } catch {
    // The choice still holds for this page when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeRunPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunPreferences(): RunPreferences {
  return useSyncExternalStore(subscribeRunPreferences, getRunPreferences);
}

const SELECTIONS: readonly RunSelection[] = ["route", "target60", "target85"];
const LENGTHS: readonly RunLength[] = [6, 12];
const DEFAULT_CHOICE: RunChoice = Object.freeze({ selection: "route", routeLength: 6 });
const choiceListeners = new Set<() => void>();
let currentChoice: RunChoice | null = null;

// Keeps each known field and falls back per field, so a corrupt value never blocks practice.
function parseChoice(value: unknown): RunChoice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_CHOICE;
  const record = value as Record<string, unknown>;
  const selection = SELECTIONS.find((known) => known === record.selection) ?? DEFAULT_CHOICE.selection;
  const routeLength = LENGTHS.find((known) => known === record.routeLength) ?? DEFAULT_CHOICE.routeLength;
  return Object.freeze({ selection, routeLength });
}

function storedChoice(): RunChoice {
  try {
    return parseChoice(JSON.parse(window.localStorage.getItem(RUN_CONFIG_KEY) ?? "null"));
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function getRunChoice(): RunChoice {
  currentChoice ??= storedChoice();
  return currentChoice;
}

// Choosing a Challenge keeps routeLength, so the next Route remembers its length. Changing the
// choice never alters a starting or active run, which froze its own configuration.
export function setRunChoice(choice: RunChoice): void {
  const previous = getRunChoice();
  if (!SELECTIONS.includes(choice.selection) || !LENGTHS.includes(choice.routeLength)) return;
  if (previous.selection === choice.selection && previous.routeLength === choice.routeLength) return;
  currentChoice = Object.freeze({ selection: choice.selection, routeLength: choice.routeLength });
  try {
    window.localStorage.setItem(RUN_CONFIG_KEY, JSON.stringify(currentChoice));
  } catch {
    // The choice still holds for this page when storage is unavailable.
  }
  choiceListeners.forEach((listener) => listener());
}

function subscribeRunChoice(listener: () => void): () => void {
  choiceListeners.add(listener);
  return () => choiceListeners.delete(listener);
}

export function useRunChoice(): RunChoice {
  return useSyncExternalStore(subscribeRunChoice, getRunChoice);
}

// Delete my data removes exactly the game's local keys and nothing else.
export function clearRunStorage(): void {
  for (const key of [RUN_BEST_KEY, SFX_KEY, AUTO_STOP_KEY, RUN_CONFIG_KEY]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Deletion still completes on the server and the page reloads.
    }
  }
}
