import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useActivityStats } from "./useActivityStats";
import type { ActivityStats } from "../types";

const FIRST_STATS: ActivityStats = {
  days: [{ date: "2026-06-01", sessions: 1 }],
  streak_days: 1,
  sessions_this_week: 1,
  recent_scores: []
};

const SECOND_STATS: ActivityStats = {
  days: [{ date: "2026-06-09", sessions: 4 }],
  streak_days: 5,
  sessions_this_week: 4,
  recent_scores: []
};

function renderActivity() {
  let controls!: ReturnType<typeof useActivityStats>;
  function Harness() {
    controls = useActivityStats();
    return null;
  }
  render(<Harness />);
  return () => controls;
}

describe("useActivityStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("ignores an out-of-order response that resolves after a newer request", async () => {
    const pendingResolvers: ((value: unknown) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            pendingResolvers.push(resolve);
          })
      )
    );

    const controls = renderActivity();

    const firstLoad = controls().loadActivityStats();
    await waitFor(() => expect(pendingResolvers).toHaveLength(1));
    const secondLoad = controls().loadActivityStats();
    await waitFor(() => expect(pendingResolvers).toHaveLength(2));

    // The newer (second) request resolves first.
    pendingResolvers[1]({ ok: true, json: async () => SECOND_STATS });
    await secondLoad;
    await waitFor(() => expect(controls().activityStats).toEqual(SECOND_STATS));

    // The older (first) request resolves late; it must not overwrite the
    // newer snapshot that's already on screen.
    pendingResolvers[0]({ ok: true, json: async () => FIRST_STATS });
    await firstLoad;

    expect(controls().activityStats).toEqual(SECOND_STATS);
    expect(controls().activityLoading).toBe(false);
  });

  test("tracks a fetch error separately from an empty snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: "Backend unavailable." }) })
    );

    const controls = renderActivity();
    await controls().loadActivityStats();

    await waitFor(() => expect(controls().activityLoading).toBe(false));
    expect(controls().activityStats).toBeNull();
    expect(controls().activityError).toBe(true);
  });

  test("clears a previous error once a later request succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ detail: "Backend unavailable." }) })
      .mockResolvedValueOnce({ ok: true, json: async () => SECOND_STATS });
    vi.stubGlobal("fetch", fetchMock);

    const controls = renderActivity();
    await controls().loadActivityStats();
    await waitFor(() => expect(controls().activityError).toBe(true));

    await controls().loadActivityStats();

    await waitFor(() => expect(controls().activityStats).toEqual(SECOND_STATS));
    expect(controls().activityError).toBe(false);
  });
});
