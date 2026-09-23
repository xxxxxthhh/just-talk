import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import MobileApp from "./MobileApp";

function mockApi(payloads: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = payloads[url];
      if (payload === undefined) {
        return {
          ok: false,
          json: async () => ({ detail: `No mock for ${url}` }),
        };
      }
      return {
        ok: true,
        json: async () => payload,
      };
    }),
  );
}

const health = {
  ok: true,
  azure_configured: true,
  passage_check_configured: false,
  max_audio_seconds: 30,
  max_long_audio_seconds: 180,
  vocabulary_graduation_score: 85,
  vocabulary_graduation_streak: 2,
};

function installApi(sessions: unknown[] = []) {
  mockApi({
    "/api/health": health,
    "/api/sessions": sessions,
    "/api/words": [],
    "/api/materials": [],
  });
}

function installHistoryResult() {
  const scores = {
    pronunciation: 90,
    accuracy: 88,
    fluency: 91,
    completeness: 100,
    prosody: 84,
  };
  const session = {
    id: "session-1",
    created_at: "2026-05-24T10:00:00Z",
    reference_text: "Quiet streets.",
    audio_duration_ms: 1400,
    scores,
  };

  mockApi({
    "/api/health": health,
    "/api/sessions": [session],
    "/api/words": [],
    "/api/materials": [],
    "/api/sessions/session-1": {
      ...session,
      transcript: "Quiet streets.",
      words: [
        {
          word: "Quiet",
          accuracy: 88,
          bucket: "good",
          error_type: "None",
          offset_ms: 0,
          duration_ms: 600,
          phonemes: [],
        },
      ],
    },
  });
}

describe("MobileApp", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders the practice screen by default", async () => {
    installApi();

    render(<MobileApp />);

    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Short Drill" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("dialog", { name: "Materials" })).toBeInTheDocument();
  });

  test("shows all four bottom tabs", async () => {
    installApi();

    render(<MobileApp />);

    expect(screen.getByRole("tab", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Words" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Insights" })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });

  test("switches screens when a tab is tapped", async () => {
    installApi([
      {
        id: "session-1",
        created_at: "2026-05-24T10:00:00Z",
        reference_text: "Quiet streets.",
        audio_duration_ms: 1400,
        scores: {
          pronunciation: 90,
          accuracy: 88,
          fluency: 91,
          completeness: 100,
          prosody: 84,
        },
      },
    ]);

    render(<MobileApp />);
    await userEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByRole("heading", { name: "History" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /90/ })).toBeInTheDocument();
  });

  test("opens the score sheet when a result is loaded", async () => {
    installHistoryResult();

    render(<MobileApp />);
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await userEvent.click(await screen.findByRole("button", { name: /90/ }));

    const sheet = await screen.findByRole("dialog", { name: "Score" });
    expect(within(sheet).getByText("Pronunciation")).toBeInTheDocument();
    expect(within(sheet).getByText("90")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Close score" })).toHaveFocus();
  });

  test("keeps a score entry point after closing and reopens the sheet", async () => {
    installHistoryResult();

    render(<MobileApp />);
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    await userEvent.click(await screen.findByRole("button", { name: /90/ }));

    expect(await screen.findByRole("dialog", { name: "Score" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close score" }));

    expect(screen.queryByRole("dialog", { name: "Score" })).not.toBeInTheDocument();
    const scoreChip = screen.getByRole("button", { name: "View score 90" });
    expect(scoreChip).toBeInTheDocument();
    expect(scoreChip).toHaveFocus();
    await userEvent.click(scoreChip);

    expect(await screen.findByRole("dialog", { name: "Score" })).toBeInTheDocument();
  });
});
