import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { setRunChoice, setRunPreference } from "../game/preferences";
import MobileApp from "./MobileApp";

// Six-item decks draw two of four items per stage, seeded by a runId that includes the time. Tests
// that follow fixed words use v2's two items per stage, which makes every six-item deck the same;
// the production-pack tests switch to the real 60 items and read the prompts from the screen.
const pack = vi.hoisted(() => ({ small: true }));
vi.mock("../game/starterPack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/starterPack")>();
  const small = actual.STARTER_PACK.filter((item) => Number(item.id.at(-1)) <= 2);
  return {
    ...actual,
    get STARTER_PACK() {
      return pack.small ? small : actual.STARTER_PACK;
    }
  };
});

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
    // The run entry card loads the phoneme stats its sound preview uses.
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
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
    // The run entry card loads the phoneme stats its sound preview uses.
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
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
  // Holds a request until the returned promise settles; undefined answers at once.
  hold?: (url: string) => Promise<void> | undefined;
  score?: (text: string) => FakeReply | Promise<FakeReply>;
  drill?: () => FakeReply | Promise<FakeReply>;
  // A function answers each /api/words request in turn.
  words?: unknown[] | (() => unknown[]);
  extra?: Record<string, unknown>;
};

function installRunApi({
  hold,
  score = (text) => scoreReply(text, 90),
  drill,
  words = [],
  extra = {},
}: RunApiOptions = {}) {
  const scoredTexts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      await hold?.(url);
      let reply: FakeReply | undefined;
      if (url === "/api/score") {
        const text = String((init?.body as FormData).get("reference_text"));
        scoredTexts.push(text);
        reply = await score(text);
      } else if (url === "/api/drills/generate" && drill) {
        reply = await drill();
      } else if (url.startsWith("/api/words/from-session/")) {
        reply = { body: [] };
      } else {
        const payloads: Record<string, unknown> = {
          "/api/health": health,
          "/api/sessions": [],
          "/api/words": typeof words === "function" ? words() : words,
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

async function startRun(user: ReturnType<typeof userEvent.setup>, mode: "Route" | "Challenge" = "Route") {
  await user.click(await screen.findByRole("radio", { name: mode === "Route" ? "Route" : "Challenge, target 60" }));
  await user.click(await screen.findByRole("button", { name: `Start ${mode}` }));
  return screen.findByRole("region", { name: `${mode} run` });
}

// Quit lives behind Pause while the tab bar is hidden, and asks before ending the run.
async function quitRun(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole("button", { name: "Quit run" })) await user.click(await screen.findByRole("button", { name: "Pause run" }));
  await user.click(await screen.findByRole("button", { name: "Quit run" }));
  await user.click(await screen.findByRole("button", { name: "End run" }));
}

// Takes shorter than the manual minimum are rejected locally, so each take lasts 600 ms on the
// capture's monotonic clock. The clock only ever moves forward (see beforeEach).
let clockOffset = 0;

async function recordAndStop(user: ReturnType<typeof userEvent.setup>, recordName = "Record") {
  await user.click(screen.getByRole("button", { name: recordName }));
  const stop = await screen.findByRole("button", { name: "Stop" });
  clockOffset += 600;
  await user.click(stop);
}

describe("MobileApp game run", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const realNow = performance.now.bind(performance);
    clockOffset = 0;
    vi.spyOn(performance, "now").mockImplementation(() => realNow() + clockOffset);
    FakeMediaRecorder.instances = [];
    setRunPreference("autoStop", true);
    setRunPreference("sfx", true);
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
    // The entry choice is remembered across mounts; each test starts from the default.
    setRunChoice({ selection: "route", routeLength: 6 });
    window.localStorage.removeItem("jt.runConfig.v1");
    pack.small = true;
  });

  // Records every item in turn, reading each prompt from the screen, then finishes to the Summary.
  async function playToSummary(user: ReturnType<typeof userEvent.setup>, items: number, scored: readonly string[]) {
    const shown: string[] = [];
    for (let index = 0; index < items; index += 1) {
      if (index > 0) await waitFor(() => expect(screen.getByRole("button", { name: "Record next" })).toBeEnabled());
      await recordAndStop(user, index === 0 ? "Record" : "Record next");
      await screen.findByText(new RegExp(`^${index + 1} / ${items} · `), { selector: ".run-stage-label" });
      await waitFor(() => expect(scored).toHaveLength(index + 1));
      shown.push(document.querySelector(".run-prompt-v2")?.textContent ?? "");
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Finish" }));
    return shown;
  }

  function speakTexts(): string[] {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url) === "/api/speak")
      .map(([, init]) => JSON.parse(String(init?.body)).text as string);
  }

  test("three_six_item_configs_complete_with_production_pack", async () => {
    pack.small = false;
    const user = userEvent.setup();
    const scored = installRunApi();
    render(<MobileApp />);

    for (const [radio, header, kicker, cost] of [
      ["Route", "Route · 6 items · /θ/", /^Route complete · \/θ\//, "Each new run uses up to 8 scores"],
      ["Challenge, target 60", "Challenge · Target 60 · /θ/", /^Challenge cleared · Target 60/, "Play again uses up to 8 new scores"],
      ["Challenge, target 85", "Challenge · Target 85 · /θ/", /^Challenge cleared · Target 85/, "Play again uses up to 10 new scores"]
    ] as const) {
      scored.length = 0;
      await user.click(await screen.findByRole("radio", { name: radio }));
      await user.click(screen.getByRole("button", { name: radio === "Route" ? "Start Route" : "Start Challenge" }));
      expect(await screen.findByText(header, { selector: ".run-bar-title" })).toBeInTheDocument();
      const shown = await playToSummary(user, 6, scored);
      // Six distinct production prompts, scored in the order shown.
      expect(new Set(shown).size).toBe(6);
      expect(scored).toEqual(shown);
      expect(await screen.findByRole("heading", { name: kicker })).toBeInTheDocument();
      expect(document.querySelector("footer")).toHaveTextContent(cost);
      expect(Boolean(screen.queryByRole("button", { name: "Next sound /ð/" }))).toBe(radio === "Route");
      await user.click(screen.getByRole("button", { name: "See review" }));
      expect(screen.getByRole("list", { name: "All readings" }).children).toHaveLength(6);
      await user.click(screen.getByRole("button", { name: "Done" }));
    }
  });

  test("route12_production_pack_completes_summary_review_and_replay", async () => {
    pack.small = false;
    const user = userEvent.setup();
    const scored = installRunApi();
    render(<MobileApp />);
    await user.click(await screen.findByRole("radio", { name: "12 items" }));
    await user.click(screen.getByRole("button", { name: "Start Route" }));
    expect(await screen.findByText("Route · 12 items · /θ/", { selector: ".run-bar-title" })).toBeInTheDocument();
    expect(document.querySelectorAll(".run-stones-group > ol.is-grid")).toHaveLength(3);

    const shown = await playToSummary(user, 12, scored);
    expect(new Set(shown).size).toBe(12);
    expect(scored).toEqual(shown);
    expect(await screen.findByRole("heading", { name: "Route complete · /θ/" })).toBeInTheDocument();
    expect(document.querySelector(".run-summary-practised")).toHaveTextContent("12 / 12Practised");
    expect(document.querySelectorAll(".run-summary-scores li")).toHaveLength(12);
    expect(document.querySelector("footer")).toHaveTextContent("Each new run uses up to 16 scores");

    await user.click(screen.getByRole("button", { name: "See review" }));
    expect(screen.getByRole("list", { name: "All readings" }).children).toHaveLength(12);
    expect(document.querySelectorAll("audio")).toHaveLength(1);

    // Play again keeps Route 12.
    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(await screen.findByText("1 / 12 · Warm-up", { selector: ".run-stage-label" })).toBeInTheDocument();
    expect(screen.getByText("Route · 12 items · /θ/", { selector: ".run-bar-title" })).toBeInTheDocument();
    await quitRun(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));
  });

  test("route_hear_first_and_hear_next_first_use_the_controller", async () => {
    const user = userEvent.setup();
    const scored = installRunApi();
    render(<MobileApp />);
    await startRun(user);

    // Hear it first asks for this item's reference; the test API has none, which never blocks Record.
    await user.click(screen.getByRole("button", { name: "Hear it first" }));
    await waitFor(() => expect(speakTexts()).toEqual(["thin"]));
    expect(await screen.findByText("Couldn't load it · Record works any time")).toBeInTheDocument();
    await recordAndStop(user);
    expect(await screen.findByText("Strong.", { selector: ".run-status-main" })).toBeInTheDocument();

    // Hear next first moves on once and previews the new item, without recording it.
    await user.click(screen.getByRole("button", { name: "Hear next first" }));
    expect(await screen.findByText("2 / 6 · Warm-up", { selector: ".run-stage-label" })).toBeInTheDocument();
    await waitFor(() => expect(speakTexts()).toEqual(["thin", "thick"]));
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
    expect(scored).toEqual(["thin"]);
  });

  test("next_sound_starts_the_next_focus_and_owns_navigation_while_pending", async () => {
    const user = userEvent.setup();
    const gate = deckGate("/api/words");
    installRunApi({ hold: gate.hold });
    render(<MobileApp />);
    await finishWithOneTake(user, "summary");

    gate.close();
    await user.click(screen.getByRole("button", { name: "Next sound /ð/" }));
    // Pending: only Next sound says Starting…; the finished run stays, tabs stay hidden.
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Play again" })).toBeDisabled();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await act(async () => gate.open());
    expect(await screen.findByText("Route · 6 items · /ð/", { selector: ".run-bar-title" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  test("next_sound_failure_survives_review_and_retry_keeps_destination", async () => {
    const user = userEvent.setup();
    let broken = 0;
    const gate = deckGate("/api/words");
    installRunApi({
      hold: gate.hold,
      words: () => {
        if (broken === 0) return [];
        broken -= 1;
        return [{ id: "bad", word: null, status: "active", due_at: null }];
      }
    });
    render(<MobileApp />);
    await finishWithOneTake(user, "summary");

    broken = 1;
    gate.close();
    await user.click(screen.getByRole("button", { name: "Next sound /ð/" }));
    await user.click(screen.getByRole("button", { name: "See review" }));
    await act(async () => gate.open());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't start /ð/. Your results are still here.");

    // Retry from Review repeats Next sound to the same /ð/.
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Route · 6 items · /ð/", { selector: ".run-bar-title" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("deferred_next_sound_then_done_never_reopens_run", async () => {
    const user = userEvent.setup();
    const gate = deckGate("/api/words");
    installRunApi({ hold: gate.hold });
    render(<MobileApp />);
    await finishWithOneTake(user, "summary");

    gate.close();
    await user.click(screen.getByRole("button", { name: "Next sound /ð/" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
    await act(async () => gate.open());
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Route" })).toBeInTheDocument();
  });

  // Active single words in the bank, all due, with a known low latest score.
  function bankRows(words: readonly string[], status: "active" | "graduated" = "active") {
    return words.map((word, index) => ({
      id: `${status}-${index + 1}`,
      word,
      source: "manual",
      notes: "",
      latest_score: 60,
      practice_count: 1,
      last_practiced_at: null,
      status,
      consecutive_successes: 0,
      graduated_at: null,
      interval_days: 0,
      due_at: "2026-10-01T00:00:00Z",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z"
    }));
  }
  const BANK = ["river", "Garden", "window", "coffee", "yellow", "basket", "Monday", "candle", "orange", "pocket", "ladder", "silver"];

  async function openWords(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("tab", { name: /^Words/ }));
    return screen.findByRole("region", { name: "Start a run with my words" });
  }

  test("words_entry_counts_5_6_11_12_and_never_silently_shrinks", async () => {
    for (const [count, start6, start12, hint] of [
      [5, false, false, "Add more active single words to start a 6-word run."],
      [6, true, false, "Need 12 active words · 6 available"],
      [11, true, false, "Need 12 active words · 11 available"],
      [12, true, true, null]
    ] as const) {
      const user = userEvent.setup();
      installRunApi({ words: bankRows(BANK.slice(0, count)) });
      const view = render(<MobileApp />);
      const card = await openWords(user);
      await within(card).findByText(`${count} active words`);
      expect(within(card).getByText("Due words first · no hearts")).toBeInTheDocument();
      expect(within(card).getByRole("radio", { name: "6 words" })).toHaveProperty("disabled", !start6);
      expect(within(card).getByRole("radio", { name: "12 words" })).toHaveProperty("disabled", !start12);
      expect(within(card).getByRole("button", { name: "Start 6 words" })).toHaveProperty("disabled", !start6);
      if (hint) expect(within(card).getByText(hint)).toBeInTheDocument();
      else expect(card.querySelector(".m-words-run-hint")).toBeNull();
      if (count === 12) {
        // Twelve is chosen explicitly and starts twelve, never six.
        await user.click(within(card).getByRole("radio", { name: "12 words" }));
        await user.click(within(card).getByRole("button", { name: "Start 12 words" }));
        expect(await screen.findByText("My words · 12 words", { selector: ".run-bar-title" })).toBeInTheDocument();
        expect(screen.getByText("1 / 12 · Word bank", { selector: ".run-stage-label" })).toBeInTheDocument();
      }
      view.unmount();
    }
  });

  test("words_entry_pending_cancel_and_late_failure_say_nothing", async () => {
    const user = userEvent.setup();
    const gate = deckGate("/api/words");
    let fresh = BANK.slice(0, 6);
    installRunApi({ hold: gate.hold, words: () => bankRows(fresh) });
    render(<MobileApp />);
    const card = await openWords(user);
    await within(card).findByText("6 active words");

    gate.close();
    await user.click(within(card).getByRole("button", { name: "Start 6 words" }));
    // Pending: tabs hidden, choices locked, the bank inert, Cancel available.
    expect(within(card).getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(within(card).getByRole("radio", { name: "6 words" })).toBeDisabled();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(document.querySelector(".m-words-content")).toHaveAttribute("inert");
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
    // The abandoned start fails late (the bank shrank): no error, no navigation.
    fresh = BANK.slice(0, 2);
    await act(async () => gate.open());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Start a run with my words" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
  });

  test("words_entry_pending_error_survives_navigation", async () => {
    const user = userEvent.setup();
    let fresh = BANK.slice(0, 6);
    installRunApi({ words: () => bankRows(fresh) });
    render(<MobileApp />);
    const card = await openWords(user);
    await within(card).findByText("6 active words");
    // The cached preview said six; the fresh bank at Start has three.
    fresh = BANK.slice(0, 3);
    await user.click(within(card).getByRole("button", { name: "Start 6 words" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Add more active single words to start a 6-word run.");
    await user.click(screen.getByRole("tab", { name: "Practice" }));
    const again = await openWords(user);
    expect(within(again).getByRole("alert")).toHaveTextContent("Add more active single words to start a 6-word run.");
  });

  test("start_review_still_uses_ordinary_explicit_score", async () => {
    const user = userEvent.setup();
    installRunApi({ words: bankRows(BANK.slice(0, 6)) });
    render(<MobileApp />);
    await openWords(user);
    await user.click(await screen.findByRole("button", { name: /^Start review \(6\)$/ }));
    // The ordinary queue: Review 1/6 with explicit Score, not a game run.
    expect(await screen.findByText("Review 1/6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Score" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  // One take of the first item at 70 (below 85), then quit: one word to revisit. With bank words
  // present the first warm-up is a due bank word, so the word is read from the screen.
  async function finishWithALowWord(user: ReturnType<typeof userEvent.setup>) {
    await startRun(user);
    const word = document.querySelector(".run-prompt-v2")?.textContent ?? "";
    await recordAndStop(user);
    expect(await screen.findByText("Solid.", { selector: ".run-status-main" })).toBeInTheDocument();
    await quitRun(user);
    expect(await screen.findByRole("heading", { name: /^Run ended/ })).toBeInTheDocument();
    return word;
  }

  test("each_summary_revisit_preserves_original_until_start_succeeds", async () => {
    const user = userEvent.setup();
    const gate = deckGate("/api/words");
    installRunApi({ hold: gate.hold, score: (text) => scoreReply(text, 70), words: () => bankRows(BANK.slice(0, 6)) });
    render(<MobileApp />);
    const word = await finishWithALowWord(user);
    expect(screen.getByText("1 word first, then your word bank · 6 words")).toBeInTheDocument();

    gate.close();
    await user.click(screen.getByRole("button", { name: "Run with words to revisit" }));
    // Pending: the finished run stays, only this action says Starting…, the tabs stay hidden.
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: /^Run ended/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play again" })).toBeDisabled();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await act(async () => gate.open());
    // The new words run leads with the word from this run, then the bank.
    expect(await screen.findByText("My words · 6 words", { selector: ".run-bar-title" })).toBeInTheDocument();
    expect(screen.getByText(word, { selector: ".run-prompt-v2" })).toBeInTheDocument();
    expect(screen.getByText("1 / 6 · From this run", { selector: ".run-stage-label" })).toBeInTheDocument();
  });

  test("revisit_failure_survives_review_and_retry_keeps_action", async () => {
    const user = userEvent.setup();
    const gate = deckGate("/api/words");
    let fresh = BANK.slice(0, 2);
    installRunApi({ hold: gate.hold, score: (text) => scoreReply(text, 70), words: () => bankRows(fresh) });
    render(<MobileApp />);
    const word = await finishWithALowWord(user);

    gate.close();
    await user.click(screen.getByRole("button", { name: "Run with words to revisit" }));
    await user.click(screen.getByRole("button", { name: "See review" }));
    await act(async () => gate.open());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't start the revisit run. Add more active single words to start a 6-word run. Your results are still here."
    );

    // The bank has grown: Try again from Review repeats the revisit run, with the same seed first.
    fresh = BANK.slice(0, 6);
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("My words · 6 words", { selector: ".run-bar-title" })).toBeInTheDocument();
    expect(screen.getByText(word, { selector: ".run-prompt-v2" })).toBeInTheDocument();
    expect(screen.getByText("1 / 6 · From this run", { selector: ".run-stage-label" })).toBeInTheDocument();
  });

  test("words_done_drops_late_entry_or_revisit_error", async () => {
    const user = userEvent.setup();
    const gate = deckGate("/api/words");
    installRunApi({ hold: gate.hold, score: (text) => scoreReply(text, 70), words: () => bankRows(BANK.slice(0, 2)) });
    render(<MobileApp />);
    await finishWithALowWord(user);

    gate.close();
    await user.click(screen.getByRole("button", { name: "Run with words to revisit" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("tablist")).toBeInTheDocument();
    await act(async () => gate.open());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
  });

  test("production_has_no_interim_fixture_wiring", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const screenSource = read("src/mobile/screens/PracticeScreen.tsx");
    const appSource = read("src/mobile/MobileApp.tsx");
    for (const source of [screenSource, appSource]) {
      expect(source).not.toMatch(/runV[23]Fixtures|Interim|needs the A4|Promise\.reject/);
    }
    expect(screenSource).toMatch(/onHearFirst=\{run\.hearFirst\}/);
    expect(screenSource).toMatch(/onHearNextFirst=\{run\.hearNextFirst\}/);
    expect(screenSource).toMatch(/"next-sound": run\.nextSound/);
    expect(read("src/components/PracticeRun.tsx")).not.toMatch(/MAX_EXTRA_ATTEMPTS/);
  });

  test("entry_uses_shared_choice_without_mutating_active_config", async () => {
    const user = userEvent.setup();
    installRunApi();
    const first = render(<MobileApp />);
    await user.click(await screen.findByRole("radio", { name: "12 items" }));
    await user.click(screen.getByRole("radio", { name: "Challenge, target 60" }));
    expect(JSON.parse(window.localStorage.getItem("jt.runConfig.v1") ?? "null")).toEqual({
      selection: "target60",
      routeLength: 12
    });
    first.unmount();

    // A new mount reads the same remembered choice, Route length included.
    render(<MobileApp />);
    expect(await screen.findByRole("radio", { name: "Challenge, target 60" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Start Challenge" }));
    const run = await screen.findByRole("region", { name: "Challenge run" });
    const header = within(run).getByText(/^Challenge/, { selector: ".run-bar-title" }).textContent;

    // Changing the remembered choice mid-run leaves the frozen run alone.
    act(() => setRunChoice({ selection: "route", routeLength: 12 }));
    expect(within(run).getByText(/^Challenge/, { selector: ".run-bar-title" })).toHaveTextContent(header ?? "");
    expect(within(run).getByRole("img", { name: /of 2 hearts left/ })).toBeInTheDocument();
    await quitRun(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByRole("radio", { name: "Route" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "12 items" })).toHaveAttribute("aria-checked", "true");
  });

  test("entry_costs_are_8_16_8_10", async () => {
    const user = userEvent.setup();
    installRunApi();
    render(<MobileApp />);
    expect(await screen.findByText("6 items · no hearts · up to 8 scores")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "12 items" }));
    expect(screen.getByText("12 items · no hearts · up to 16 scores")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Challenge, target 60" }));
    expect(screen.getByText("6 items · target 60 · 2 hearts · up to 8 scores")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Challenge, target 85" }));
    expect(screen.getByText("6 items · target 85 · 2 hearts · up to 10 scores")).toBeInTheDocument();
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
    expect(await screen.findByText(/^77\. Good\. \d+ points\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Score" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View score/ })).not.toBeInTheDocument();

    // History is reachable once the run is over, and its sheet still opens.
    await quitRun(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("tab", { name: "History" }));
    await user.click(await screen.findByRole("button", { name: /90/ }));
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Score" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
  });

  test("immersive_run_hides_tabs_and_pause_resume_is_explicit", async () => {
    const user = userEvent.setup();
    const scored = installRunApi();
    render(<MobileApp />);
    expect(screen.getByRole("tab", { name: "Words" })).toBeInTheDocument();

    await startRun(user);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record" }));
    await screen.findByRole("button", { name: "Stop" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // Pause discards the open take and never records again on its own.
    await user.click(screen.getByRole("button", { name: "Pause run" }));
    expect(FakeMediaRecorder.instances[0].state).toBe("inactive");
    expect(screen.getByText("Paused.", { selector: ".run-status-main" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(scored).toEqual([]);

    // Backgrounding the page pauses the same way.
    await recordAndStop(user);
    expect(await screen.findByText("Strong.", { selector: ".run-status-main" })).toBeInTheDocument();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("Paused.", { selector: ".run-status-main" })).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(scored).toEqual(["thin"]);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });

    // The tabs stay hidden through the summary and come back on Done.
    await quitRun(user);
    expect(await screen.findByRole("heading", { name: /^Run ended/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("tab", { name: "Words" })).toBeInTheDocument();
  });

  test("entry_preferences_and_frozen_focus_best_are_shared", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "jt.runBest.v1",
      JSON.stringify({ "route|θ|1": { runId: "old", points: 861, rating: "A", updatedAt: 1, expiresAt: null } })
    );
    installRunApi();
    render(<MobileApp />);

    // No stats yet means the starter focus /θ/, the same rule the run freezes.
    const hero = await screen.findByRole("region", { name: "This run's sound" });
    expect(await within(hero).findByText("/θ/")).toBeInTheDocument();
    expect(within(hero).getByText("Best · /θ/ · Route 6").parentElement).toHaveTextContent("861A");
    await user.click(within(hero).getByRole("radio", { name: "Challenge, target 60" }));
    expect(within(hero).getByText("No best yet")).toBeInTheDocument();
    await user.click(within(hero).getByRole("radio", { name: "Route" }));

    // One preference, shared by the card and the run.
    await user.click(within(hero).getByRole("button", { name: "Auto-stop on" }));
    expect(within(hero).getByRole("button", { name: "Auto-stop off" })).toHaveAttribute("aria-pressed", "false");
    await startRun(user);
    expect(screen.getByText("Route · 6 items · /θ/")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto-stop off" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sound" }));
    await quitRun(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Sound off" })).toHaveAttribute("aria-pressed", "false");
    window.localStorage.removeItem("jt.runBest.v1");
  });

  test("quit_confirmation_calls_quit_not_exit", async () => {
    const user = userEvent.setup();
    const scored = installRunApi();
    render(<MobileApp />);
    await startRun(user);
    await recordAndStop(user);
    expect(await screen.findByText("Strong.", { selector: ".run-status-main" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pause run" }));
    await user.click(screen.getByRole("button", { name: "Quit run" }));
    const dialog = screen.getByRole("alertdialog", { name: "End this run?" });
    expect(within(dialog).getByRole("button", { name: "Keep paused" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "End run" }));

    // Quit keeps the results: the summary and its review are still there.
    expect(await screen.findByRole("heading", { name: /^Run ended/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "See review" }));
    expect(await screen.findByRole("region", { name: "Run review" })).toBeInTheDocument();
    expect(scored).toEqual(["thin"]);
  });

  test("quit_dialog_cancels_capture_before_waiting", async () => {
    const user = userEvent.setup();
    const scored = installRunApi();
    render(<MobileApp />);
    await startRun(user);
    await user.click(screen.getByRole("button", { name: "Record" }));
    await screen.findByRole("button", { name: "Stop" });

    // Quit is behind Pause, which has already discarded the open take.
    await user.click(screen.getByRole("button", { name: "Pause run" }));
    expect(FakeMediaRecorder.instances[0].state).toBe("inactive");
    await user.click(screen.getByRole("button", { name: "Quit run" }));
    expect(screen.getByRole("alertdialog", { name: "End this run?" })).toBeInTheDocument();
    // Waiting on the dialog never lets a take reach the scorer.
    clockOffset += 31_000;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scored).toEqual([]);
    await user.click(screen.getByRole("button", { name: "End run" }));
    expect(await screen.findByRole("heading", { name: /^Run ended/ })).toBeInTheDocument();
    expect(scored).toEqual([]);
  });

  test("quit_with_a_recording_then_review_plays_it", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    installRunApi();
    render(<MobileApp />);
    await startRun(user);
    await recordAndStop(user);
    expect(await screen.findByText("Strong.", { selector: ".run-status-main" })).toBeInTheDocument();

    // Quit always starts from Pause; the finished run is no longer paused.
    await quitRun(user);
    await user.click(await screen.findByRole("button", { name: "See review" }));
    const you = await screen.findByRole("button", { name: /Play your take of thin/ });
    expect(you).toBeEnabled();
    await user.click(you);
    expect(play).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".run-review audio")?.getAttribute("src")).toMatch(/^blob:take-/);
  });

  test("completed_review_survives_hidden_and_visible_without_replaying", async () => {
    const user = userEvent.setup();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    installRunApi();
    render(<MobileApp />);
    await startRun(user);
    await recordAndStop(user);
    for (let i = 1; i < STARTER_TEXTS.length; i += 1) {
      await waitFor(() => expect(screen.getByRole("button", { name: "Record next" })).toBeEnabled());
      await recordAndStop(user, "Record next");
      await screen.findByText(STARTER_TEXTS[i], { selector: ".run-prompt-v2" });
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await user.click(await screen.findByRole("button", { name: "See review" }));
    await user.click((await screen.findAllByRole("button", { name: /Play your take of/ }))[0]);
    expect(play).toHaveBeenCalledTimes(1);

    const setVisibility = (state: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    };
    setVisibility("hidden");
    expect(document.querySelector(".run-review audio")).not.toHaveAttribute("src");
    setVisibility("visible");
    // Back on the page: everything is playable again and nothing restarted by itself.
    const buttons = screen.getAllByRole("button", { name: /Play your take of/ });
    for (const button of buttons) expect(button).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Stop your take of/ })).not.toBeInTheDocument();
    expect(play).toHaveBeenCalledTimes(1);
    await user.click(buttons[0]);
    expect(play).toHaveBeenCalledTimes(2);
  });

  test("deferred_start_hides_tabs_until_the_run_appears", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let statsCalls = 0;
    // The entry card's own preview answers at once; the run's deck request waits.
    installRunApi({ hold: (url) => (url === "/api/phoneme-stats" && ++statsCalls > 1 ? gate : undefined) });
    render(<MobileApp />);
    await screen.findByText("/θ/");

    await user.click(screen.getByRole("button", { name: "Start Route" }));
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    const pending = screen.getByRole("button", { name: "Starting…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(statsCalls).toBe(2);

    await act(async () => release());
    expect(await screen.findByRole("region", { name: "Route run" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  test("failed_start_brings_tabs_back_with_an_error", async () => {
    const user = userEvent.setup();
    // A due word with no text, served only to the run's own request, makes the deck itself
    // unbuildable, so start() rejects.
    let broken = false;
    installRunApi({ words: () => (broken ? [{ id: "bad", word: null, status: "active", due_at: null }] : []) });
    render(<MobileApp />);
    await screen.findByText("/θ/");
    broken = true;
    await user.click(screen.getByRole("button", { name: "Start Route" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't start the run. Try again.");
    expect(screen.getByRole("tab", { name: "Words" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Route" })).toBeEnabled();
  });

  test("a start abandoned by a remount never takes over the new app", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let statsCalls = 0;
    installRunApi({ hold: (url) => (url === "/api/phoneme-stats" && ++statsCalls === 2 ? gate : undefined) });
    const first = render(<MobileApp />);
    await screen.findByText("/θ/");
    await user.click(screen.getByRole("button", { name: "Start Route" }));
    first.unmount();

    render(<MobileApp />);
    await screen.findByText("/θ/");
    await act(async () => release());
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Words" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Route" })).toBeEnabled();
  });

  // A gate the next deck requests wait behind, opened by the test.
  // Holds the deck's stats request (Start, Play again) or, for Next sound, its vocabulary request.
  function deckGate(url = "/api/phoneme-stats") {
    let release: () => void = () => {};
    let promise = Promise.resolve();
    let closed = false;
    return {
      close() {
        closed = true;
        promise = new Promise<void>((resolve) => (release = resolve));
      },
      open() {
        closed = false;
        release();
      },
      hold: (requested: string) => (closed && requested === url ? promise : undefined),
    };
  }

  async function finishWithOneTake(user: ReturnType<typeof userEvent.setup>, surface: "summary" | "review") {
    await startRun(user);
    await recordAndStop(user);
    expect(await screen.findByText("Strong.", { selector: ".run-status-main" })).toBeInTheDocument();
    await quitRun(user);
    expect(await screen.findByRole("heading", { name: /^Run ended/ })).toBeInTheDocument();
    if (surface === "review") {
      await user.click(screen.getByRole("button", { name: "See review" }));
      expect(await screen.findByRole("region", { name: "Run review" })).toBeInTheDocument();
    }
  }

  test("deferred_replay_from_summary_and_review_is_pending_and_single", async () => {
    for (const surface of ["summary", "review"] as const) {
      const user = userEvent.setup();
      const gate = deckGate();
      let deckRequests = 0;
      installRunApi({
        hold: (url) => {
          if (url === "/api/phoneme-stats") deckRequests += 1;
          return gate.hold(url);
        },
      });
      const view = render(<MobileApp />);
      await finishWithOneTake(user, surface);

      gate.close();
      const before = deckRequests;
      await user.click(screen.getByRole("button", { name: "Play again" }));
      const pending = screen.getByRole("button", { name: "Starting…" });
      expect(pending, surface).toBeDisabled();
      expect(screen.getByRole("button", { name: "Done" }), surface).toBeEnabled();
      // A second tap starts nothing more.
      await user.click(pending);
      expect(deckRequests - before, surface).toBe(1);
      // The finished run stays on screen until the new deck is ready.
      expect(screen.getByRole("region", { name: surface === "review" ? "Run review" : "Route run" })).toBeInTheDocument();

      await act(async () => gate.open());
      expect(await screen.findByRole("button", { name: "Record" }), surface).toBeEnabled();
      expect(screen.getByText("1 / 6 · Warm-up")).toBeInTheDocument();
      view.unmount();
    }
  });

  test("done_during_replay_abandons_it", async () => {
    const user = userEvent.setup();
    const gate = deckGate();
    installRunApi({ hold: gate.hold });
    render(<MobileApp />);
    await finishWithOneTake(user, "summary");

    gate.close();
    await user.click(screen.getByRole("button", { name: "Play again" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("tab", { name: "Words" })).toBeInTheDocument();
    // The deck that arrives later never takes over.
    await act(async () => gate.open());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Route" })).toBeEnabled();
  });

  test("failed_replay_keeps_results_then_retry_succeeds", async () => {
    for (const surface of ["summary", "review"] as const) {
      const user = userEvent.setup();
      // A due word with no text makes only the replay's deck unbuildable.
      let broken = false;
      installRunApi({ words: () => (broken ? [{ id: "bad", word: null, status: "active", due_at: null }] : []) });
      const view = render(<MobileApp />);
      await finishWithOneTake(user, surface);

      broken = true;
      await user.click(screen.getByRole("button", { name: "Play again" }));
      expect(await screen.findByRole("alert"), surface).toHaveTextContent(
        "Couldn't start a new run. Your results are still here. Try again."
      );
      // The old results are still all there.
      if (surface === "summary") {
        expect(screen.getByRole("heading", { name: /^Run ended/ })).toBeInTheDocument();
        expect(screen.getByLabelText(/^1\. thin: first reading Great 90/)).toBeInTheDocument();
      } else {
        expect(screen.getByRole("region", { name: "Run review" })).toBeInTheDocument();
        expect(within(screen.getByRole("list", { name: "Takes of thin" })).getByText("90")).toBeInTheDocument();
      }

      broken = false;
      await user.click(screen.getByRole("button", { name: "Play again" }));
      expect(await screen.findByRole("button", { name: "Record" }), surface).toBeEnabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      view.unmount();
    }
  });

  test("replay_failure_survives_summary_to_review_while_pending", async () => {
    const user = userEvent.setup();
    // Only the replay's own request gets the unbuildable word; Review's refresh stays valid.
    let broken = false;
    const gate = deckGate();
    installRunApi({
      hold: gate.hold,
      words: () => {
        if (!broken) return [];
        broken = false;
        return [{ id: "bad", word: null, status: "active", due_at: null }];
      },
    });
    render(<MobileApp />);
    await finishWithOneTake(user, "summary");

    broken = true;
    gate.close();
    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "See review" }));
    expect(screen.getByRole("region", { name: "Run review" })).toBeInTheDocument();
    await act(async () => gate.open());
    expect(await screen.findByRole("button", { name: "Play again" })).toBeEnabled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't start a new run. Your results are still here. Try again."
    );

    // Done clears it; the next run's screens start clean.
    await user.click(screen.getByRole("button", { name: "Done" }));
    await startRun(user);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("an_abandoned_replay_that_fails_late_shows_nothing", async () => {
    const user = userEvent.setup();
    let broken = false;
    const gate = deckGate();
    installRunApi({ hold: gate.hold, words: () => (broken ? [{ id: "bad", word: null, status: "active", due_at: null }] : []) });
    render(<MobileApp />);
    await finishWithOneTake(user, "summary");

    broken = true;
    gate.close();
    await user.click(screen.getByRole("button", { name: "Play again" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await act(async () => gate.open());
    await new Promise((resolve) => setTimeout(resolve, 20));
    broken = false;
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await startRun(user);
    await recordAndStop(user);
    await quitRun(user);
    expect(await screen.findByRole("heading", { name: /^Run ended/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("cancel_quit_keeps_paused_run_and_results", async () => {
    const user = userEvent.setup();
    const scored = installRunApi();
    render(<MobileApp />);
    await startRun(user);
    await recordAndStop(user);
    expect(await screen.findByText("Strong.", { selector: ".run-status-main" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pause run" }));
    const quit = screen.getByRole("button", { name: "Quit run" });
    await user.click(quit);
    await user.click(screen.getByRole("button", { name: "Keep paused" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(quit).toHaveFocus();
    expect(screen.getByText("Paused.", { selector: ".run-status-main" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText("Strong.", { selector: ".run-status-main" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^1\. thin: first reading Great 90/)).toBeInTheDocument();
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

    // During a run the other tabs, and their practice entries, are out of reach.
    await startRun(user);
    expect(screen.queryByRole("tab", { name: /Words/ })).not.toBeInTheDocument();
    await quitRun(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.getByRole("textbox", { name: "Passage" })).not.toHaveValue("water");

    // Without a run, an entry practises directly with no confirmation.
    await user.click(screen.getByRole("tab", { name: /Words/ }));
    await user.click(await screen.findByRole("button", { name: /^water/ }));
    expect(confirm).not.toHaveBeenCalled();
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

    await quitRun(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: /View score/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Score" })).not.toBeInTheDocument();
  });

  async function generateDrillFromReview(user: ReturnType<typeof userEvent.setup>) {
    await startRun(user);
    await quitRun(user);
    // A finished or quit Route shows its summary first.
    await user.click(await screen.findByRole("button", { name: "See review" }));
    await user.click(await screen.findByRole("button", { name: "Generate a drill for /θ/" }));
  }

  test("generate_drill_failure_from_review_is_visible_on_practice", async () => {
    const user = userEvent.setup();
    let fail: (reply: FakeReply) => void = () => undefined;
    installRunApi({
      extra: { "/api/health": { ...health, passage_check_configured: true } },
      drill: () => new Promise<FakeReply>((resolve) => (fail = resolve)),
    });
    render(<MobileApp />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/health"));

    await generateDrillFromReview(user);
    expect(screen.queryByRole("region", { name: "Route run" })).not.toBeInTheDocument();
    expect(await screen.findByText("Generating a drill for /θ/…")).toBeInTheDocument();
    // A drill landing mid-run would replace the run's material, so no run starts meanwhile.
    expect(screen.getByRole("button", { name: "Start Route" })).toBeDisabled();

    act(() => fail({ status: 503, body: { detail: "Drill unavailable." } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Drill unavailable.");
    expect(screen.queryByText(/Generating a drill/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Route" })).toBeEnabled();
  });

  test("generate_drill_success_from_review_loads_the_drill", async () => {
    const user = userEvent.setup();
    let succeed: (reply: FakeReply) => void = () => undefined;
    const material = {
      id: "drill-1",
      pack_id: "generated-drills",
      pack_title: "Generated drills",
      title: "θ drill",
      text: "Three thin thinkers thank Thelma.",
      book: "",
      lesson: "",
      tags: [],
      source: "generated",
      license: "",
      created_at: "2026-10-07T00:00:00Z",
      updated_at: "2026-10-07T00:00:00Z",
    };
    installRunApi({
      extra: { "/api/health": { ...health, passage_check_configured: true } },
      drill: () => new Promise<FakeReply>((resolve) => (succeed = resolve)),
    });
    render(<MobileApp />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/health"));

    await generateDrillFromReview(user);
    expect(await screen.findByText("Generating a drill for /θ/…")).toBeInTheDocument();
    act(() => succeed({ body: material }));

    expect(await screen.findByRole("textbox", { name: "Passage" })).toHaveValue("Three thin thinkers thank Thelma.");
    expect(screen.getByTitle("θ drill")).toBeInTheDocument();
    expect(screen.queryByText(/Generating a drill/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
      await screen.findByText(STARTER_TEXTS[i], { selector: ".run-prompt-v2" });
      await waitFor(() => expect(scored).toHaveLength(i + 1));
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: /^Route complete/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "See review" }));
    expect(await screen.findByRole("region", { name: "Run review" })).toBeInTheDocument();
    expect(screen.getByText(/^Route complete · chain \d\/6$/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "All readings" }).children).toHaveLength(6);
    expect(scored).toEqual(STARTER_TEXTS);

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(await screen.findByRole("region", { name: "Route run" })).toBeInTheDocument();
    expect(scored).toHaveLength(6);
    await quitRun(user);
    await user.click(await screen.findByRole("button", { name: "Done" }));

    // Challenge: an unknown failure leaves the item pending and lets the learner continue.
    await startRun(user, "Challenge");
    failNext = true;
    await recordAndStop(user);
    expect(
      await screen.findByText("Still waiting on that score. You can keep going.", { selector: ".run-status-main" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("1. thin: result pending")).toBeInTheDocument();
    await recordAndStop(user, "Record next");
    expect(await screen.findByText("Strong.")).toBeInTheDocument();
    await quitRun(user);
    expect(await screen.findByRole("heading", { name: /^Challenge incomplete/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "See review" }));
    const pendingItem = (await screen.findByText("thin", { selector: ".run-reading .run-prompt-text" })).closest("li");
    expect(within(pendingItem as HTMLElement).getByText("Score pending", { selector: ".run-review-status" })).toBeInTheDocument();
    expect(scored).toHaveLength(8);
  });
});
