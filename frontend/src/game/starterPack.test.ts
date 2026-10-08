import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { STARTER_PACK } from "./starterPack";

// The owner-approved review table is the source of truth for the runtime pack. It is read here
// only; the application never loads it.
const REVIEW = readFileSync(resolve(__dirname, "../../../docs/materials/game-mode-v3-content-review.md"), "utf-8");
const GROUPS = ["theta", "eth", "r", "l", "v"] as const;
const STAGES = ["warmup", "focus", "context"] as const;

function reviewRows() {
  return REVIEW.split("\n")
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length === 8 && /^(theta|eth|r|l|v)-(warmup|focus|context)-\d$/.test(cells[0]))
    .map(([id, origin, phoneme, stage, text, targetWord, position, status]) => ({
      id,
      origin,
      phoneme,
      stage,
      text,
      targetWord,
      position,
      status
    }));
}

function wordsIn(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

describe("starter pack", () => {
  it("approved_pack_has_60_unique_items_in_4_4_4_groups", () => {
    expect(STARTER_PACK).toHaveLength(60);
    expect(new Set(STARTER_PACK.map((item) => item.id)).size).toBe(60);
    expect(new Set(STARTER_PACK.map((item) => item.text.trim().toLowerCase())).size).toBe(60);

    // Canonical order: sound by sound, then Warm-up, Focus, In context, each numbered 1–4.
    expect(STARTER_PACK.map((item) => item.id)).toEqual(
      GROUPS.flatMap((group) => STAGES.flatMap((stage) => [1, 2, 3, 4].map((n) => `${group}-${stage}-${n}`)))
    );
    for (const group of GROUPS) {
      const items = STARTER_PACK.filter((item) => item.group === group);
      expect(new Set(items.map((item) => item.phoneme)).size).toBe(1);
      const wordRows = items.filter((item) => item.stage !== "context");
      for (const item of wordRows) {
        expect(item.targetWord).toBe(item.text);
        expect(wordsIn(item.text)).toHaveLength(1);
      }
      // Every In-context sentence, not just the first pair, is short and holds its target word.
      for (const sentence of items.filter((item) => item.stage === "context")) {
        const words = wordsIn(sentence.text);
        expect(words.length, sentence.id).toBeGreaterThanOrEqual(5);
        expect(words.length, sentence.id).toBeLessThanOrEqual(9);
        expect(words, sentence.id).toContain(sentence.targetWord);
      }
      // No level or difficulty metadata.
      for (const item of items) expect(Object.keys(item).sort()).toEqual(["group", "id", "phoneme", "stage", "targetWord", "text"]);
    }
  });

  it("runtime_pack_matches_approved_review_rows", () => {
    expect(REVIEW).toMatch(/\| All 60 rows \(r1\) \| Approved \| Unchanged from r1 \|/);
    const rows = reviewRows();
    expect(rows).toHaveLength(60);
    expect(rows.filter((row) => row.origin === "existing")).toHaveLength(30);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const item of STARTER_PACK) {
      const row = byId.get(item.id);
      expect(row, item.id).toBeDefined();
      expect({ phoneme: row?.phoneme, stage: row?.stage, text: row?.text, targetWord: row?.targetWord }, item.id).toEqual({
        phoneme: item.phoneme,
        stage: item.stage,
        text: item.text,
        targetWord: item.targetWord
      });
      expect(row?.status, item.id).toBe("Approved (r1, 2026-10-08)");
    }
  });
});
