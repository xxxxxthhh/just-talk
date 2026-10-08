import { useSyncExternalStore } from "react";

import { RUN_BEST_KEY } from "./personalBest";

// Shared by the entry card and the run: one value per browser, both on by default.
export const SFX_KEY = "jt.sfx";
export const AUTO_STOP_KEY = "jt.autoStop";

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

// Delete my data removes exactly the game's local keys and nothing else.
export function clearRunStorage(): void {
  for (const key of [RUN_BEST_KEY, SFX_KEY, AUTO_STOP_KEY]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Deletion still completes on the server and the page reloads.
    }
  }
}
