import { act, render, screen, waitFor, within } from "@testing-library/react";
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

type FakeReply = { status?: number; body: unknown };

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (type: string) => type === "audio/mp4";
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/mp4";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  // Real browsers deliver onstop asynchronously after stop().
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["take"], { type: "audio/mp4" }) });
    setTimeout(() => this.onstop?.(), 0);
  }
}

function scoreReply(text: string, accuracy: number): FakeReply {
  const words = text.match(/[A-Za-z']+/g) ?? [text];
  return {
    body: {
      result: {
        transcript: text,
        recognition_status: "success",
        scores: { accuracy, fluency: 90, completeness: 100, prosody: null, pronunciation: accuracy },
        words: words.map((word) => ({
          word,
          accuracy,
          bucket: "good",
          error_type: "None",
          offset_ms: 0,
          duration_ms: 300,
          phonemes: [],
        })),
        raw: null,
      },
      session: {
        id: `score-${text}`,
        created_at: "2026-10-07T00:00:00Z",
        reference_text: text,
        audio_duration_ms: 900,
        scores: { accuracy, fluency: 90, completeness: 100, prosody: null, pronunciation: accuracy },
      },
    },
  };
}

type RunApiOptions = {
  score?: (text: string) => FakeReply | Promise<FakeReply>;
  words?: unknown[];
  extra?: Record<string, unknown>;
};

function installRunApi({ score = (text) => scoreReply(text, 90), words = [], extra = {} }: RunApiOptions = {}) {
  const scoredTexts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let reply: FakeReply | undefined;
      if (url === "/api/score") {
        const text = String((init?.body as FormData).get("reference_text"));
        scoredTexts.push(text);
        reply = await score(text);
      } else if (url.startsWith("/api/words/from-session/")) {
        reply = { body: [] };
      } else {
        const payloads: Record<string, unknown> = {
          "/api/health": health,
          "/api/sessions": [],
          "/api/words": words,
          "/api/materials": [],
          "/api/phoneme-stats": [],
          ...extra,
        };
        reply = url in payloads ? { body: payloads[url] } : undefined;
      }
      if (!reply) return { ok: false, status: 404, json: async () => ({ detail: `No mock for ${url}` }) };
      const status = reply.status ?? 200;
      return { ok: status < 400, status, json: async () => reply.body };
    }),
  );
  return scoredTexts;
}

const STARTER_TEXTS = [
  "thin",
  "thick",
  "think",
  "thank",
  "I think we can walk home now.",
  "The narrow path leads to our house.",
];

async function startRun(user: ReturnType<typeof userEvent.setup>, mode: "Start a run" | "Challenge" = "Start a run") {
  await user.click(await screen.findByRole("button", { name: mode }));
  return screen.findByRole("region", { name: mode === "Challenge" ? "Challenge run" : "Route run" });
}

async function recordAndStop(user: ReturnType<typeof userEvent.setup>, recordName = "Record") {
  await user.click(screen.getByRole("button", { name: recordName }));
  await user.click(await screen.findByRole("button", { name: "Stop" }));
}

describe("MobileApp game run", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: () => undefined }] }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    let urlCounter = 0;
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:take-${++urlCounter}`),
      revokeObjectURL: vi.fn(),
    }));
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
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "mediaDevices");
    Reflect.deleteProperty(document, "visibilityState");
  });

  test("run_result_never_opens_normal_sheet_but_history_still_does", async () => {
    const user = userEvent.setup();
    installRunApi({
      extra: {
        "/api/sessions": [
          {
            id: "session-1",
            created_at: "2026-05-24T10:00:00Z",
            reference_text: "Quiet streets.",
            audio_duration_ms: 1400,
            scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
          },
        ],
        "/api/sessions/session-1": {
          id: "session-1",
          created_at: "2026-05-24T10:00:00Z",
          reference_text: "Quiet streets.",
          audio_duration_ms: 1400,
          scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
          transcript: "Quiet streets.",
          words: [],
        },
      },
      score: (text) => scoreReply(text, 77),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MobileApp />);

    await startRun(user);
    await recordAndStop(user);
    expect(await screen.findByText("77")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Score" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View score/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: /90/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("dialog", { name: "Score" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
  });

  test("tab_pause_resume_preserves_run_without_auto_recording", async () => {
    const user = userEvent.setup();
    const scored = installRunApi();
    render(<MobileApp />);

    await startRun(user);
    await user.click(screen.getByRole("button", { name: "Record" }));
    await screen.findByRole("button", { name: "Stop" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: "Words" }));
    expect(FakeMediaRecorder.instances[0].state).toBe("inactive");
    await user.click(screen.getByRole("tab", { name: "Practice" }));

    expect(screen.getByText("Paused.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(scored).toEqual([]);

    // Backgrounding the page pauses the same way.
    await recordAndStop(user);
    expect(await screen.findByText("Clear. Nice one.")).toBeInTheDocument();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("Paused.")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(scored).toEqual(["thin"]);
  });

  test("other_practice_entries_confirm_before_mutating_session", async () => {
    const user = userEvent.setup();
    const water = {
      id: "word-1",
      word: "water",
      source: "manual",
      notes: "",
      latest_score: 50,
      practice_count: 1,
      last_practiced_at: null,
      status: "active",
      consecutive_successes: 0,
      graduated_at: null,
      interval_days: 1,
      due_at: null,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    };
    installRunApi({ words: [water] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MobileApp />);

    await startRun(user);
    await user.click(screen.getByRole("tab", { name: /Words/ }));
    await user.click(await screen.findByRole("button", { name: /^water/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Word Bank" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Practice" }));
    expect(screen.getByRole("region", { name: "Route run" })).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("tab", { name: /Words/ }));
    await user.click(await screen.findByRole("button", { name: /^water/ }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Passage" })).toHaveValue("water");
  });

  test("starting_from_long_uses_short_limit_and_clears_old_score", async () => {
    const user = userEvent.setup();
    const scored = installRunApi({
      extra: {
        "/api/sessions": [
          {
            id: "session-1",
            created_at: "2026-05-24T10:00:00Z",
            reference_text: "Quiet streets.",
            audio_duration_ms: 1400,
            scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
          },
        ],
        "/api/sessions/session-1": {
          id: "session-1",
          created_at: "2026-05-24T10:00:00Z",
          reference_text: "Quiet streets.",
          audio_duration_ms: 1400,
          scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
          transcript: "Quiet streets.",
          words: [],
        },
      },
    });
    render(<MobileApp />);

    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: /90/ }));
    await user.click(await screen.findByRole("button", { name: "Close score" }));
    await user.click(screen.getByRole("button", { name: "Long Passage" }));
    expect(screen.getByRole("button", { name: "Long Passage" })).toHaveAttribute("aria-pressed", "true");

    await startRun(user);
    await user.click(screen.getByRole("button", { name: "Record" }));
    await screen.findByRole("button", { name: "Stop" });
    // 31 s later the short 30 s limit has stopped the take; the long limit is 180 s.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 31_000);
    await waitFor(() => expect(scored).toEqual(["thin"]));
    vi.mocked(Date.now).mockRestore();

    await user.click(await screen.findByRole("button", { name: "Quit" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: /View score/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Score" })).not.toBeInTheDocument();
  });

  test("route_and_challenge_complete_and_replay_with_budget_and_pending_rules", async () => {
    const user = userEvent.setup();
    let failNext = false;
    const scored = installRunApi({
      score: (text) => {
        if (failNext) {
          failNext = false;
          return { status: 502, body: { detail: "Upstream timeout." } };
        }
        return scoreReply(text, 90);
      },
    });
    render(<MobileApp />);

    await startRun(user);
    await recordAndStop(user);
    for (let i = 1; i < STARTER_TEXTS.length; i += 1) {
      await waitFor(() => expect(screen.getByRole("button", { name: "Record next" })).toBeEnabled());
      await recordAndStop(user, "Record next");
      await screen.findByText(STARTER_TEXTS[i], { selector: ".run-prompt .run-prompt-text" });
      await waitFor(() => expect(scored).toHaveLength(i + 1));
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Route review" })).toBeInTheDocument();
    expect(screen.getByText("Practiced 6 of 6")).toBeInTheDocument();
    expect(scored).toEqual(STARTER_TEXTS);

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(await screen.findByRole("region", { name: "Route run" })).toBeInTheDocument();
    expect(scored).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: "Quit" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));

    // Challenge: an unknown failure leaves the item pending and lets the learner continue.
    await startRun(user, "Challenge");
    failNext = true;
    await recordAndStop(user);
    expect(await screen.findByText("Still waiting on that score. You can keep going.")).toBeInTheDocument();
    expect(screen.getByLabelText("Item 1: not practiced, score pending, current")).toBeInTheDocument();
    await recordAndStop(user, "Record next");
    expect(await screen.findByText("Passed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quit" }));
    expect(await screen.findByRole("heading", { name: "Challenge incomplete" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "See review" }));
    const pendingItem = (await screen.findByText("thin", { selector: ".run-review-item .run-prompt-text" })).closest("li");
    expect(within(pendingItem as HTMLElement).getByText("Score pending", { selector: ".run-review-status" })).toBeInTheDocument();
    expect(scored).toHaveLength(8);
  });
});
