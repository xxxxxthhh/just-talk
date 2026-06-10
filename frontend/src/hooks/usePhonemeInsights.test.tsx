import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { usePhonemeInsights } from "./usePhonemeInsights";
import type { MaterialItem } from "../types";

const DRILL_MATERIAL = {
  id: "drill-1",
  pack_id: "phoneme-drills",
  pack_title: "Phoneme Drills",
  title: "Sit With It",
  text: "Sit with it a little bit.",
  book: "/ɪ/",
  lesson: "",
  tags: ["sit", "it", "bit"],
  source: "generated",
  license: "Personal use",
  created_at: "2026-06-11T00:00:00+00:00",
  updated_at: "2026-06-11T00:00:00+00:00"
} as MaterialItem;

function renderInsights(onDrillCreated?: (material: MaterialItem) => void) {
  let controls!: ReturnType<typeof usePhonemeInsights>;
  function Harness() {
    controls = usePhonemeInsights(onDrillCreated);
    return null;
  }
  render(<Harness />);
  return () => controls;
}

describe("usePhonemeInsights drill generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("marks the phoneme busy while generating and reports the new material", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    const onDrillCreated = vi.fn();
    const controls = renderInsights(onDrillCreated);

    const pending = controls().generateDrill("ɪ");
    await waitFor(() => expect(controls().generatingPhoneme).toBe("ɪ"));

    resolveFetch({ ok: true, json: async () => DRILL_MATERIAL });
    await pending;

    await waitFor(() => expect(controls().generatingPhoneme).toBeNull());
    expect(onDrillCreated).toHaveBeenCalledWith(DRILL_MATERIAL);
    expect(controls().drillError).toBe("");
    expect(fetch).toHaveBeenCalledWith(
      "/api/drills/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phoneme: "ɪ" })
      })
    );
  });

  test("surfaces backend errors and clears the busy state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Drill generation returned no passage." })
      })
    );
    const onDrillCreated = vi.fn();
    const controls = renderInsights(onDrillCreated);

    await controls().generateDrill("θ");

    await waitFor(() => expect(controls().generatingPhoneme).toBeNull());
    expect(controls().drillError).toBe("Drill generation returned no passage.");
    expect(onDrillCreated).not.toHaveBeenCalled();
  });
});
