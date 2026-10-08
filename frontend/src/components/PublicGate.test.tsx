import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkHealth, deleteMyData, fetchQuota } from "../api";
import { RUN_BEST_KEY } from "../game/personalBest";
import { AUTO_STOP_KEY, RUN_CONFIG_KEY, SFX_KEY } from "../game/preferences";
import type { Health, QuotaStatus, QuotaWindow } from "../types";
import PublicGate from "./PublicGate";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  checkHealth: vi.fn(),
  fetchQuota: vi.fn(),
  deleteMyData: vi.fn()
}));

const health: Health = {
  ok: true,
  azure_configured: true,
  passage_check_configured: false,
  max_audio_seconds: 30,
  max_long_audio_seconds: 120,
  vocabulary_graduation_score: 85,
  vocabulary_graduation_streak: 3
};
const window_: QuotaWindow = { used: 0, limit: 600, attempts_used: 0, attempts_limit: 100, resets_at: "2026-10-09T00:00:00Z" };
const scopes = { visitor_day: window_, global_day: window_, global_month: window_ };
const quota: QuotaStatus = { score: scopes, tts: scopes };

const originalLocation = window.location;
let keysAtReload: string[] | null;

beforeEach(() => {
  window.localStorage.clear();
  for (const key of [RUN_BEST_KEY, SFX_KEY, AUTO_STOP_KEY, RUN_CONFIG_KEY, "theme"]) window.localStorage.setItem(key, "x");
  keysAtReload = null;
  const reload = vi.fn(() => {
    keysAtReload = Object.keys(window.localStorage).sort();
  });
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
  vi.mocked(checkHealth).mockResolvedValue(health);
  vi.mocked(fetchQuota).mockResolvedValue(quota);
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  vi.clearAllMocks();
});

async function confirmDelete() {
  render(
    <PublicGate>
      <p>app</p>
    </PublicGate>
  );
  await screen.findByText("app");
  fireEvent.click(screen.getByRole("button", { name: "Delete my data" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
}

describe("PublicGate", () => {
  it("delete_data_clears_only_game_storage_before_reload", async () => {
    vi.mocked(deleteMyData).mockResolvedValue({ deleted: true });
    await confirmDelete();
    await waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1));
    expect(keysAtReload).toEqual(["theme"]);
  });

  it("failed_delete_keeps_game_storage", async () => {
    vi.mocked(deleteMyData).mockRejectedValue(new Error("Could not reach the server."));
    await confirmDelete();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(Object.keys(window.localStorage).sort()).toEqual(
      [AUTO_STOP_KEY, SFX_KEY, RUN_BEST_KEY, RUN_CONFIG_KEY, "theme"].sort()
    );
  });

  it("delete_success_only_clears_exact_game_keys", async () => {
    // Look-alike keys are not game keys.
    for (const key of ["jt.runConfig.v2", "jt.runBest", "jt.other"]) window.localStorage.setItem(key, "x");
    // A key that cannot be removed does not block the rest or the reload.
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === RUN_BEST_KEY) throw new Error("SecurityError");
      remove.call(this, key);
    });
    vi.mocked(deleteMyData).mockResolvedValue({ deleted: true });
    await confirmDelete();
    await waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1));
    expect(keysAtReload).toEqual([RUN_BEST_KEY, "jt.other", "jt.runBest", "jt.runConfig.v2", "theme"].sort());
    vi.restoreAllMocks();
  });
});
