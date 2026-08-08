import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ActivityStats, PhonemeStat } from "../types";
import { InsightsPanel } from "./InsightsPanel";

const defaultDate = "2026-05-26T00:00:00.000Z";

function makeStat(
  phoneme: string,
  average_accuracy: number,
  bucket: PhonemeStat["bucket"] = "watch"
): PhonemeStat {
  return {
    phoneme,
    average_accuracy,
    attempts: 5,
    needs_work_count: bucket === "needs-work" ? 3 : 1,
    watch_count: bucket === "watch" ? 2 : 0,
    good_count: bucket === "good" ? 4 : 0,
    bucket,
    last_seen_at: defaultDate,
    example_words: [
      {
        word: "turn",
        accuracy: average_accuracy,
        session_id: `session-${phoneme}`,
        reference_text: "turn",
        created_at: defaultDate,
      },
    ],
    attempts_history: [
      {
        word: "turn",
        accuracy: average_accuracy,
        session_id: `session-${phoneme}`,
        created_at: defaultDate,
      },
    ],
  };
}

function renderPanel(
  stats: PhonemeStat[],
  expandedPhoneme: string | null = null,
  drillProps: Partial<Parameters<typeof InsightsPanel>[0]> = {}
) {
  return render(
    <InsightsPanel
      stats={stats}
      loading={false}
      error=""
      expandedPhoneme={expandedPhoneme}
      setExpandedPhoneme={vi.fn()}
      onDrill={vi.fn()}
      onRefresh={vi.fn()}
      {...drillProps}
    />
  );
}

describe("InsightsPanel", () => {
  test("renders a fixed phoneme map with r-controlled vowels and no-data slots", () => {
    renderPanel([makeStat("t", 72, "watch"), makeStat("ɝ", 64, "needs-work")]);

    expect(screen.getByRole("heading", { name: "Stops" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Simple Vowels" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "R-Controlled Vowels" })).toBeVisible();

    expect(screen.getByRole("button", { name: /Open \/t\/ coach, score 72/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /\/p\/ has no practice data yet/ })).toBeDisabled();

    const rControlled = screen.getByRole("group", { name: "R-Controlled Vowels" });
    expect(within(rControlled).getByRole("button", { name: /Open \/ɝ\/ coach, score 64/ })).toBeVisible();
    expect(within(rControlled).getByText("/ɔɹ/")).toBeVisible();
  });

  test("keeps weakest sounds available in a sorted priority view", () => {
    renderPanel([
      makeStat("t", 72, "watch"),
      makeStat("p", 91, "good"),
      makeStat("ɝ", 64, "needs-work"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Priority" }));

    const priorityList = screen.getByRole("list", { name: "Weakest sounds" });
    const rows = within(priorityList).getAllByRole("button", { name: /Open \// });

    expect(rows[0]).toHaveAccessibleName(/Open \/ɝ\/ coach, score 64/);
    expect(rows[1]).toHaveAccessibleName(/Open \/t\/ coach, score 72/);
    expect(rows[2]).toHaveAccessibleName(/Open \/p\/ coach, score 91/);
  });

  test("offers drill generation for the expanded phoneme when drills are enabled", () => {
    const onGenerateDrill = vi.fn();
    renderPanel([makeStat("ɝ", 64, "needs-work")], "ɝ", {
      drillsEnabled: true,
      onGenerateDrill,
    });

    const button = screen.getByRole("button", { name: /Generate drill passage/ });
    fireEvent.click(button);

    expect(onGenerateDrill).toHaveBeenCalledWith("ɝ");
  });

  test("hides drill generation when the LLM endpoint is not configured", () => {
    renderPanel([makeStat("ɝ", 64, "needs-work")], "ɝ", {
      onGenerateDrill: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: /Generate drill passage/ })
    ).toBeNull();
  });

  test("disables generation while another phoneme drill is in flight", () => {
    renderPanel([makeStat("ɝ", 64, "needs-work"), makeStat("t", 72, "watch")], "ɝ", {
      drillsEnabled: true,
      generatingPhoneme: "t",
      onGenerateDrill: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: /Generate drill passage/ })
    ).toBeDisabled();
  });

  test("shows a busy label for the phoneme being generated", () => {
    renderPanel([makeStat("ɝ", 64, "needs-work")], "ɝ", {
      drillsEnabled: true,
      generatingPhoneme: "ɝ",
      onGenerateDrill: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /Generating drill/ })).toBeDisabled();
  });

  test("surfaces drill generation errors inline", () => {
    renderPanel([makeStat("ɝ", 64, "needs-work")], null, {
      drillsEnabled: true,
      drillError: "Drill generation returned no passage.",
      onGenerateDrill: vi.fn(),
    });

    expect(
      screen.getByText("Drill generation returned no passage.")
    ).toBeVisible();
  });

  test("renders the Progress section streak tile, weekly tile, and score trend sparkline", () => {
    const activityStats: ActivityStats = {
      days: [{ date: "2026-05-26", sessions: 1 }],
      streak_days: 4,
      sessions_this_week: 3,
      recent_scores: [
        { created_at: defaultDate, pron_score: 70, accuracy_score: 72, fluency_score: 68, prosody_score: 65, mode: "short" },
        { created_at: defaultDate, pron_score: null, accuracy_score: null, fluency_score: null, prosody_score: null, mode: "short" },
        { created_at: defaultDate, pron_score: 90, accuracy_score: 88, fluency_score: 91, prosody_score: 84, mode: "short" },
      ],
    };

    renderPanel([], null, { activityStats });

    const progressSection = screen.getByRole("region", { name: "Progress" });
    expect(within(progressSection).getByText("4")).toBeVisible();
    expect(within(progressSection).getByText("Day streak")).toBeVisible();
    expect(within(progressSection).getByText("3")).toBeVisible();
    expect(within(progressSection).getByText("Sessions this week")).toBeVisible();

    const sparkline = within(progressSection).getByRole("img");
    expect(sparkline.getAttribute("aria-label")).toMatch(/minimum 70, maximum 90, latest 90/i);
    expect(within(progressSection).getByText("Min 70")).toBeVisible();
    expect(within(progressSection).getByText("Max 90")).toBeVisible();
    expect(within(progressSection).getByText("Latest 90")).toBeVisible();
  });

  test("shows an empty state in the Progress section when there is no activity yet", () => {
    const activityStats: ActivityStats = {
      days: [],
      streak_days: 0,
      sessions_this_week: 0,
      recent_scores: [],
    };

    renderPanel([], null, { activityStats });

    const progressSection = screen.getByRole("region", { name: "Progress" });
    expect(
      within(progressSection).getByText("Practice a session to start tracking your progress.")
    ).toBeVisible();
    expect(within(progressSection).queryByRole("img")).toBeNull();
  });

  test("shows a distinct unavailable note in the Progress section on a fetch error, not the empty state", () => {
    renderPanel([], null, { activityStats: null, activityError: true });

    const progressSection = screen.getByRole("region", { name: "Progress" });
    expect(within(progressSection).getByText(/Progress unavailable/i)).toBeVisible();
    expect(
      within(progressSection).queryByText("Practice a session to start tracking your progress.")
    ).toBeNull();
  });
});
