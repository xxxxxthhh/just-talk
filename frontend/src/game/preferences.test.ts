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
    const { clearRunStorage, AUTO_STOP_KEY, RUN_CONFIG_KEY, SFX_KEY } = await load();
    for (const key of [RUN_BEST_KEY, SFX_KEY, AUTO_STOP_KEY, RUN_CONFIG_KEY, "theme"]) window.localStorage.setItem(key, "x");
    clearRunStorage();
    expect(Object.keys(window.localStorage)).toEqual(["theme"]);

    // One key that cannot be removed does not stop the others.
    for (const key of [RUN_BEST_KEY, SFX_KEY, AUTO_STOP_KEY, RUN_CONFIG_KEY]) window.localStorage.setItem(key, "x");
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === SFX_KEY) throw new Error("SecurityError");
      remove.call(this, key);
    });
    expect(() => clearRunStorage()).not.toThrow();
    expect(Object.keys(window.localStorage).sort()).toEqual([SFX_KEY, "theme"].sort());
  });

  it("run_choice_survives_mode_switch_and_corrupt_storage", async () => {
    const preferences = await load();
    expect(preferences.RUN_CONFIG_KEY).toBe("jt.runConfig.v1");
    expect(preferences.getRunChoice()).toEqual({ selection: "route", routeLength: 6 });
    expect(window.localStorage.getItem(preferences.RUN_CONFIG_KEY)).toBeNull();

    const entry = renderHook(() => preferences.useRunChoice());
    act(() => preferences.setRunChoice({ selection: "route", routeLength: 12 }));
    expect(entry.result.current).toEqual({ selection: "route", routeLength: 12 });
    // Switching to a Challenge keeps the remembered Route length for the next Route.
    act(() => preferences.setRunChoice({ ...entry.result.current, selection: "target85" }));
    expect(entry.result.current).toEqual({ selection: "target85", routeLength: 12 });
    expect(JSON.parse(window.localStorage.getItem(preferences.RUN_CONFIG_KEY) as string)).toEqual({
      selection: "target85",
      routeLength: 12
    });
    // The boolean preferences are separate and unchanged.
    expect(preferences.getRunPreferences()).toEqual({ sfx: true, autoStop: true });

    const reloaded = await load();
    expect(reloaded.getRunChoice()).toEqual({ selection: "target85", routeLength: 12 });

    // Unknown values fall back field by field; unreadable JSON falls back entirely.
    const cases: [string, unknown][] = [
      ['{"selection":"target85","routeLength":9}', { selection: "target85", routeLength: 6 }],
      ['{"selection":"hard","routeLength":12}', { selection: "route", routeLength: 12 }],
      ['{"selection":"challenge","routeLength":"12"}', { selection: "route", routeLength: 6 }],
      ["[1,2]", { selection: "route", routeLength: 6 }],
      ["null", { selection: "route", routeLength: 6 }],
      ["{not json", { selection: "route", routeLength: 6 }]
    ];
    for (const [raw, expected] of cases) {
      window.localStorage.setItem(reloaded.RUN_CONFIG_KEY, raw);
      expect((await load()).getRunChoice(), raw).toEqual(expected);
    }

    // An invalid choice from a caller is ignored rather than stored.
    const guarded = await load();
    guarded.setRunChoice({ selection: "target60", routeLength: 6 });
    guarded.setRunChoice({ selection: "challenge", routeLength: 12 } as never);
    expect(guarded.getRunChoice()).toEqual({ selection: "target60", routeLength: 6 });

    // Blocked storage keeps the default and the in-page choice.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const blocked = await load();
    expect(blocked.getRunChoice()).toEqual({ selection: "route", routeLength: 6 });
    blocked.setRunChoice({ selection: "route", routeLength: 12 });
    expect(blocked.getRunChoice()).toEqual({ selection: "route", routeLength: 12 });
  });
});
