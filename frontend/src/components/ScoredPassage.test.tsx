import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { WordResult } from "../types";
import { ScoredPassage } from "./ScoredPassage";

function makeWord(overrides: Partial<WordResult> = {}): WordResult {
  return {
    word: "hello",
    accuracy: 90,
    bucket: "good",
    error_type: "None",
    offset_ms: 0,
    duration_ms: 300,
    phonemes: [],
    ...overrides
  };
}

describe("ScoredPassage", () => {
  test("shows a prosody indicator with an explanatory tooltip when a word has prosody issues", () => {
    const words = [makeWord({ word: "hello", prosody_issues: ["monotone"] })];
    render(
      <ScoredPassage
        words={words}
        selectedWordIndex={-1}
        activeSpokenWordIndex={-1}
        onSelectWord={vi.fn()}
      />
    );

    const token = screen.getByRole("button", { name: /hello/i });
    expect(token).toHaveAttribute("title", "Flat/monotone delivery");
    expect(token.querySelector(".prosody-issue-dot")).not.toBeNull();
  });

  test("joins multiple prosody issues into one tooltip", () => {
    const words = [
      makeWord({ word: "quiet", prosody_issues: ["unexpected_break", "missing_break"] })
    ];
    render(
      <ScoredPassage
        words={words}
        selectedWordIndex={-1}
        activeSpokenWordIndex={-1}
        onSelectWord={vi.fn()}
      />
    );

    const token = screen.getByRole("button", { name: /quiet/i });
    expect(token).toHaveAttribute(
      "title",
      "Unexpected pause before this word; Missing pause before this word"
    );
  });

  test("does not render an indicator when prosody_issues is absent", () => {
    const words = [makeWord({ word: "streets" })];
    render(
      <ScoredPassage
        words={words}
        selectedWordIndex={-1}
        activeSpokenWordIndex={-1}
        onSelectWord={vi.fn()}
      />
    );

    const token = screen.getByRole("button", { name: /streets/i });
    expect(token).not.toHaveAttribute("title");
    expect(token.querySelector(".prosody-issue-dot")).toBeNull();
  });
});
