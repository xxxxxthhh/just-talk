import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunLength } from "../../types";
import { usePracticeSession } from "../../usePracticeSession";
import WordsScreen, { type WordsRunEntry } from "./WordsScreen";

type Session = ReturnType<typeof usePracticeSession>;

const health = {
  ok: true,
  azure_configured: true,
  passage_check_configured: false,
  max_audio_seconds: 30,
  max_long_audio_seconds: 180,
  vocabulary_graduation_score: 85,
  vocabulary_graduation_streak: 2
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const payloads: Record<string, unknown> = {
        "/api/health": health,
        "/api/sessions": [],
        "/api/words": [],
        "/api/materials": [],
        "/api/phoneme-stats": []
      };
      const url = String(input);
      return url in payloads
        ? { ok: true, status: 200, json: async () => payloads[url] }
        : { ok: false, status: 404, json: async () => ({ detail: `No mock for ${url}` }) };
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function entry(overrides: Partial<WordsRunEntry> = {}): WordsRunEntry {
  return {
    availability: { eligibleCount: 12, canStart6: true, canStart12: true },
    length: 6,
    onLengthChange: vi.fn(),
    starting: false,
    error: null,
    onStart: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  };
}

// The real session, with only the busy facts under test changed.
function Harness({ busy, wordsRun, confirmLeaveRun }: { busy?: Partial<Session>; wordsRun: WordsRunEntry; confirmLeaveRun: () => boolean }) {
  const session = usePracticeSession();
  return (
    <WordsScreen
      session={{ ...session, ...busy }}
      onOpenPractice={vi.fn()}
      confirmLeaveRun={confirmLeaveRun}
      wordsRun={wordsRun}
    />
  );
}

describe("WordsScreen My words entry", () => {
  it("words_entry_uses_session_guards_without_leave_confirmation", async () => {
    const user = userEvent.setup();
    const confirmLeaveRun = vi.fn(() => true);
    const wordsRun = entry();
    render(<Harness wordsRun={wordsRun} confirmLeaveRun={confirmLeaveRun} />);
    const card = await screen.findByRole("region", { name: "Start a run with my words" });
    await user.click(within(card).getByRole("button", { name: "Start 6 words" }));
    // With a run present the Words tab is unreachable, so starting never asks to leave one.
    expect(wordsRun.onStart).toHaveBeenCalledWith(6);
    expect(confirmLeaveRun).not.toHaveBeenCalled();
  });

  it("words_busy_and_starting_guards_hold", async () => {
    const confirmLeaveRun = () => true;
    // An ordinary take, its scoring, or a drill in progress blocks Start, as on the Practice entry.
    for (const busy of [{ recorderState: "recording" as const }, { isScoring: true }]) {
      const view = render(<Harness busy={busy} wordsRun={entry()} confirmLeaveRun={confirmLeaveRun} />);
      const card = await screen.findByRole("region", { name: "Start a run with my words" });
      expect(within(card).getByRole("button", { name: "Start 6 words" })).toBeDisabled();
      expect(within(card).getByRole("radio", { name: "12 words" })).toBeEnabled();
      view.unmount();
    }

    // A pending start locks the choices, guards the bank, and keeps Cancel.
    const wordsRun = entry({ starting: true });
    const view = render(<Harness wordsRun={wordsRun} confirmLeaveRun={confirmLeaveRun} />);
    const card = await screen.findByRole("region", { name: "Start a run with my words" });
    expect(within(card).getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(within(card).getByRole("radio", { name: "6 words" })).toBeDisabled();
    expect(view.container.querySelector(".m-words-content")).toHaveAttribute("inert");
    await userEvent.setup().click(within(card).getByRole("button", { name: "Cancel" }));
    expect(wordsRun.onCancel).toHaveBeenCalledTimes(1);
  });

  // MobileApp owns the length; this stands in for it.
  function Lengths({ onChange, ...overrides }: Partial<WordsRunEntry> & { onChange: (length: RunLength) => void }) {
    const [length, setLength] = useState<RunLength>(6);
    const wordsRun = entry({
      ...overrides,
      length,
      onLengthChange: (next) => {
        onChange(next);
        setLength(next);
      }
    });
    return <Harness wordsRun={wordsRun} confirmLeaveRun={() => true} />;
  }

  it("words_length_radios_follow_arrow_keys_with_one_tab_stop", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Lengths onChange={onChange} />);
    const card = await screen.findByRole("region", { name: "Start a run with my words" });
    const six = within(card).getByRole("radio", { name: "6 words" });
    const twelve = within(card).getByRole("radio", { name: "12 words" });
    // One tab stop for the group, on the checked length.
    expect([six.tabIndex, twelve.tabIndex]).toEqual([0, -1]);
    six.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(12);
    expect(twelve).toHaveFocus();
    expect(twelve).toHaveAttribute("aria-checked", "true");
    expect([six.tabIndex, twelve.tabIndex]).toEqual([-1, 0]);
    expect(within(card).getByRole("button", { name: "Start 12 words" })).toBeEnabled();
    // Wraps, as native radios do.
    await user.keyboard("{ArrowDown}");
    expect(six).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(6);
    await user.keyboard("{ArrowLeft}");
    expect(twelve).toHaveFocus();
  });

  it("words_length_arrow_keys_skip_an_unavailable_length", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Lengths onChange={onChange} availability={{ eligibleCount: 8, canStart6: true, canStart12: false }} />);
    const card = await screen.findByRole("region", { name: "Start a run with my words" });
    const six = within(card).getByRole("radio", { name: "6 words" });
    const twelve = within(card).getByRole("radio", { name: "12 words" });
    expect([six.tabIndex, twelve.tabIndex]).toEqual([0, -1]);
    six.focus();
    await user.keyboard("{ArrowRight}");
    // Twelve is never chosen while it is unavailable.
    expect(onChange).not.toHaveBeenCalledWith(12);
    expect(six).toHaveFocus();
    expect(six).toHaveAttribute("aria-checked", "true");
    expect(within(card).getByRole("button", { name: "Start 6 words" })).toBeEnabled();
  });

  it("words_length_arrow_keys_do_nothing_while_starting", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Lengths onChange={onChange} starting />);
    const card = await screen.findByRole("region", { name: "Start a run with my words" });
    const group = within(card).getByRole("radiogroup", { name: "Words run length" });
    const six = within(card).getByRole("radio", { name: "6 words" });
    expect(six).toBeDisabled();
    // Even a key event reaching the group cannot change a pending start's length.
    group.focus();
    await user.keyboard("{ArrowRight}");
    six.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
    expect(six).toHaveAttribute("aria-checked", "true");
  });
});
