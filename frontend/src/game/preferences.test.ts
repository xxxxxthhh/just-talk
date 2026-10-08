import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RUN_BEST_KEY } from "./personalBest";

// Each case loads a fresh module so its in-memory preferences start from storage.
async function load() {
  vi.resetModules();
  return import("./preferences");
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("run preferences", () => {
  it("preferences_share_defaults_and_persistence", async () => {
    const preferences = await load();
    expect(preferences.getRunPreferences()).toEqual({ sfx: true, autoStop: true });

    const entry = renderHook(() => preferences.useRunPreferences());
    const run = renderHook(() => preferences.useRunPreferences());
    const takeSnapshot = preferences.getRunPreferences();
    act(() => preferences.setRunPreference("autoStop", false));
    expect(entry.result.current).toEqual({ sfx: true, autoStop: false });
    expect(run.result.current).toBe(entry.result.current);
    // A capture that already started keeps its own snapshot.
    expect(takeSnapshot.autoStop).toBe(true);
    expect(window.localStorage.getItem(preferences.AUTO_STOP_KEY)).toBe("false");

    act(() => preferences.setRunPreference("sfx", false));
    act(() => preferences.setRunPreference("autoStop", true));
    const reloaded = await load();
    expect(reloaded.getRunPreferences()).toEqual({ sfx: false, autoStop: true });

    // Unreadable or unwritable storage keeps the defaults and the in-page choice.
    window.localStorage.setItem(preferences.SFX_KEY, "garbage");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const blocked = await load();
    expect(blocked.getRunPreferences()).toEqual({ sfx: true, autoStop: true });
    blocked.setRunPreference("sfx", false);
    expect(blocked.getRunPreferences().sfx).toBe(false);
  });

  it("clear_run_storage_removes_only_game_keys", async () => {
    const { clearRunStorage, AUTO_STOP_KEY, SFX_KEY } = await load();
    for (const key of [RUN_BEST_KEY, SFX_KEY, AUTO_STOP_KEY, "theme"]) window.localStorage.setItem(key, "x");
    clearRunStorage();
    expect(Object.keys(window.localStorage)).toEqual(["theme"]);
  });
});
