import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import App from "./App";

function mockApi(payloads: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url === "/api/materials" && payloads[url] === undefined
        ? []
        : payloads[url];
      if (payload === undefined) {
        return {
          ok: false,
          json: async () => ({ detail: `No mock for ${url}` })
        };
      }
      return {
        ok: true,
        json: async () => payload
      };
    })
  );
}

const health = {
  ok: true,
  azure_configured: true,
  passage_check_configured: false,
  max_audio_seconds: 30,
  max_long_audio_seconds: 180,
  vocabulary_graduation_score: 85,
  vocabulary_graduation_streak: 2
};

const scoredRecordingWords = [
  {
    word: "do",
    accuracy: 88,
    bucket: "good",
    error_type: "None",
    offset_ms: 0,
    duration_ms: 240,
    phonemes: []
  },
  {
    word: "you",
    accuracy: 100,
    bucket: "good",
    error_type: "None",
    offset_ms: 320,
    duration_ms: 260,
    phonemes: []
  },
  {
    word: "think",
    accuracy: 94,
    bucket: "good",
    error_type: "None",
    offset_ms: 900,
    duration_ms: 430,
    phonemes: []
  },
  {
    word: "singapore",
    accuracy: 97,
    bucket: "good",
    error_type: "None",
    offset_ms: 1500,
    duration_ms: 700,
    phonemes: []
  }
];

function installRecordingMocks() {
  const trackStop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: trackStop }]
      })
    }
  });
  class MediaRecorderMock {
    static isTypeSupported = vi.fn(() => true);
    state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", MediaRecorderMock);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:recording"),
    revokeObjectURL: vi.fn()
  });
}

async function renderScoredRecording(extraPayloads: Record<string, unknown> = {}) {
  installRecordingMocks();
  mockApi({
    "/api/health": health,
    "/api/sessions": [],
    "/api/words": [],
    "/api/score": {
      result: {
        transcript: "do you think singapore",
        scores: { pronunciation: 93, accuracy: 95, fluency: 90, completeness: 100, prosody: 88 },
        segments: [],
        words: scoredRecordingWords,
        raw: {}
      },
      session: { id: "session-1" }
    },
    "/api/words/from-session/session-1": [],
    ...extraPayloads
  });

  const view = render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /^Record$/ }));
  await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: /^Score$/ })).not.toBeDisabled());
  await userEvent.click(screen.getByRole("button", { name: /^Score$/ }));
  await screen.findByRole("button", { name: /singapore\s*97/i });

  return view;
}

describe("App", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("offers a JSON backup download near the health pill", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": []
    });

    render(<App />);

    const exportLink = await screen.findByRole("link", { name: /Download backup/i });
    expect(exportLink).toHaveAttribute("href", "/api/export");
    expect(exportLink).toHaveAttribute("download");
  });

  test("fetches and renders activity stats when the Insights tab opens", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/phoneme-stats": [],
      "/api/stats/activity": {
        days: [{ date: "2026-06-09", sessions: 2 }],
        streak_days: 5,
        sessions_this_week: 4,
        recent_scores: [
          { created_at: "2026-06-09T00:00:00Z", pron_score: 82, accuracy_score: 80, fluency_score: 85, prosody_score: 78, mode: "short" }
        ]
      }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Phoneme Insights/i }));

    const progressSection = await screen.findByRole("region", { name: "Progress" });
    expect(within(progressSection).getByText("5")).toBeInTheDocument();
    expect(within(progressSection).getByText("Day streak")).toBeInTheDocument();
    expect(within(progressSection).getByText("4")).toBeInTheDocument();
    expect(within(progressSection).getByText("Sessions this week")).toBeInTheDocument();
  });

  test("clears stale passage-check issues when a history session is loaded", async () => {
    mockApi({
      "/api/health": { ...health, passage_check_configured: true },
      "/api/sessions": [
        {
          id: "session-1",
          created_at: "2026-05-24T10:00:00Z",
          reference_text: "Quiet streets.",
          audio_duration_ms: 1400,
          scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 }
        }
      ],
      "/api/words": [],
      "/api/passage-check": {
        issues: [
          {
            span: "quikly",
            problem: "Misspelled word",
            suggestion: "quickly",
            explanation: "Likely a typo for 'quickly'."
          }
        ]
      },
      "/api/sessions/session-1": {
        id: "session-1",
        created_at: "2026-05-24T10:00:00Z",
        reference_text: "Quiet streets.",
        audio_duration_ms: 1400,
        scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
        words: [],
        raw: {}
      }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /^Check$/ }));

    expect(await screen.findByText("quikly")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /History/i }));
    await userEvent.click(await screen.findByRole("button", { name: /90/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Quiet streets.")).toBeInTheDocument();
    });
    expect(screen.queryByText("quikly")).not.toBeInTheDocument();
  });

  test("loads full history details when a session row is clicked", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [
        {
          id: "session-1",
          created_at: "2026-05-24T10:00:00Z",
          reference_text: "Quiet streets.",
          audio_duration_ms: 1400,
          scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 }
        }
      ],
      "/api/words": [],
      "/api/sessions/session-1": {
        id: "session-1",
        created_at: "2026-05-24T10:00:00Z",
        reference_text: "Quiet streets.",
        audio_duration_ms: 1400,
        scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
        words: [
          {
            word: "quiet",
            accuracy: 73,
            bucket: "watch",
            error_type: "None",
            offset_ms: 0,
            duration_ms: 300,
            phonemes: []
          }
        ],
        warnings: ["Azure Speech stopped early, so the score may be incomplete."],
        raw: {}
      }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /History/i }));
    await userEvent.click(await screen.findByRole("button", { name: /90/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/sessions/session-1");
      expect(screen.getByDisplayValue("Quiet streets.")).toBeInTheDocument();
    });
    expect(await screen.findAllByRole("button", { name: /quiet\s*73/i })).toHaveLength(2);
    expect(screen.getByText(/score may be incomplete/i)).toBeInTheDocument();
  });

  test("uses a word bank entry as the next practice prompt", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [
        {
          id: "word-1",
          word: "quiet",
          source: "manual",
          notes: "",
          latest_score: 73,
          practice_count: 2,
          last_practiced_at: "2026-05-24T10:00:00Z",
          status: "active",
          consecutive_successes: 0,
          graduated_at: null,
          created_at: "2026-05-24T09:00:00Z",
          updated_at: "2026-05-24T10:00:00Z"
        }
      ]
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
    await userEvent.click(await screen.findByRole("button", { name: /quiet.*73.*2/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("quiet")).toBeInTheDocument();
    });
  });

  test("groups word bank entries into due and scheduled reviews", async () => {
    const baseWord = {
      source: "manual",
      notes: "",
      latest_score: 88,
      practice_count: 1,
      last_practiced_at: "2026-06-09T10:00:00Z",
      status: "active",
      consecutive_successes: 1,
      graduated_at: null,
      created_at: "2026-06-01T09:00:00Z",
      updated_at: "2026-06-09T10:00:00Z"
    };
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [
        { ...baseWord, id: "word-1", word: "quiet", interval_days: 0, due_at: null },
        {
          ...baseWord,
          id: "word-2",
          word: "streets",
          interval_days: 4,
          due_at: new Date(Date.now() + 3 * 86_400_000).toISOString()
        }
      ]
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));

    expect(await screen.findByText(/Due for review \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Scheduled \(1\)/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /streets.*review in 3d/i })
    ).toBeInTheDocument();
  });

  test("uses a material as the next practice passage", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/materials": [
        {
          id: "starter-clear-morning",
          pack_id: "just-talk-starter",
          pack_title: "Just Talk Starter",
          title: "Clear Morning",
          text: "A clear morning is a good time to practice careful speaking.",
          book: "Starter",
          lesson: "2",
          tags: ["starter", "short"],
          source: "built-in",
          license: "Just Talk original",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        }
      ]
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Clear Morning/i }));

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("A clear morning is a good time to practice careful speaking.")
      ).toBeInTheDocument();
    });
  });

  test("locks selected materials and lets users copy them to free practice", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/materials": [
        {
          id: "starter-clear-morning",
          pack_id: "just-talk-starter",
          pack_title: "Just Talk Starter",
          title: "Clear Morning",
          text: "A clear morning is a good time to practice careful speaking.",
          book: "Starter",
          lesson: "2",
          tags: ["starter", "short"],
          source: "built-in",
          license: "Just Talk original",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        }
      ]
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Clear Morning/i }));

    const materialPassage = await screen.findByDisplayValue(
      "A clear morning is a good time to practice careful speaking."
    );
    expect(materialPassage).toHaveAttribute("readonly");
    expect(screen.getByText("Material Practice")).toBeInTheDocument();
    expect(screen.getAllByText("Clear Morning").length).toBeGreaterThan(0);

    fireEvent.change(materialPassage, { target: { value: "Changed text." } });
    expect(materialPassage).toHaveValue("A clear morning is a good time to practice careful speaking.");

    await userEvent.click(screen.getByRole("button", { name: "Copy to Free Practice" }));
    expect(materialPassage).not.toHaveAttribute("readonly");

    fireEvent.change(materialPassage, { target: { value: "Changed text." } });
    expect(materialPassage).toHaveValue("Changed text.");
  });

  test("opens a grouped material library and filters lessons quickly", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/materials": [
        {
          id: "nce-1-001",
          pack_id: "new-concept",
          pack_title: "New Concept English",
          title: "A Private Conversation",
          text: "Last week I went to the theatre.",
          book: "Book 1",
          lesson: "1",
          tags: ["nce", "conversation"],
          source: "user-imported",
          license: "user-provided",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        },
        {
          id: "nce-1-002",
          pack_id: "new-concept",
          pack_title: "New Concept English",
          title: "Breakfast or Lunch",
          text: "It was Sunday.",
          book: "Book 1",
          lesson: "2",
          tags: ["nce"],
          source: "user-imported",
          license: "user-provided",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        },
        {
          id: "nce-2-001",
          pack_id: "new-concept",
          pack_title: "New Concept English",
          title: "A Puma at Large",
          text: "Pumas are large, cat-like animals.",
          book: "Book 2",
          lesson: "1",
          tags: ["nce"],
          source: "user-imported",
          license: "user-provided",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        }
      ]
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Open Library/i }));

    expect(screen.getByRole("button", { name: /Book 1\s*2/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Book 2\s*1/i })).toBeInTheDocument();
    expect(screen.getByText(/Showing 3 of 3 lessons/i)).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox", { name: /Search materials/i }), "puma");

    expect(await screen.findByRole("button", { name: /A Puma at Large/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /A Private Conversation/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 3 lessons/i)).toBeInTheDocument();
  });

  test("closes the material library when the dialog loses focus", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/materials": [
        {
          id: "starter-clear-morning",
          pack_id: "just-talk-starter",
          pack_title: "Just Talk Starter",
          title: "Clear Morning",
          text: "A clear morning is a good time to practice.",
          book: "Starter",
          lesson: "2",
          tags: ["starter"],
          source: "built-in",
          license: "Just Talk original",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        }
      ]
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Open Library/i }));

    const dialog = await screen.findByRole("dialog", { name: /Materials/i });
    fireEvent.blur(dialog, { relatedTarget: document.body });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Materials/i })).not.toBeInTheDocument();
    });
  });

  test("deletes the selected material group and refreshes the library", async () => {
    const user = userEvent.setup();
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const beforeDelete = [
      {
        id: "nce-1-001",
        pack_id: "new-concept",
        pack_title: "New Concept English",
        title: "A Private Conversation",
        text: "Last week I went to the theatre.",
        book: "Book 1",
        lesson: "1",
        tags: ["nce"],
        source: "user-imported",
        license: "user-provided",
        created_at: "2026-05-25T00:00:00Z",
        updated_at: "2026-05-25T00:00:00Z"
      },
      {
        id: "nce-1-002",
        pack_id: "new-concept",
        pack_title: "New Concept English",
        title: "Breakfast or Lunch",
        text: "It was Sunday.",
        book: "Book 1",
        lesson: "2",
        tags: ["nce"],
        source: "user-imported",
        license: "user-provided",
        created_at: "2026-05-25T00:00:00Z",
        updated_at: "2026-05-25T00:00:00Z"
      },
      {
        id: "nce-2-001",
        pack_id: "new-concept",
        pack_title: "New Concept English",
        title: "A Puma at Large",
        text: "Pumas are large, cat-like animals.",
        book: "Book 2",
        lesson: "1",
        tags: ["nce"],
        source: "user-imported",
        license: "user-provided",
        created_at: "2026-05-25T00:00:00Z",
        updated_at: "2026-05-25T00:00:00Z"
      }
    ];
    let materialListCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/health") return { ok: true, json: async () => health };
      if (url === "/api/sessions" || url === "/api/words") {
        return { ok: true, json: async () => [] };
      }
      if (url === "/api/materials") {
        materialListCalls += 1;
        return {
          ok: true,
          json: async () => (materialListCalls === 1 ? beforeDelete : [beforeDelete[2]])
        };
      }
      if (url.startsWith("/api/material-groups") && init?.method === "DELETE") {
        return { ok: true, json: async () => ({ deleted: 2 }) };
      }
      return {
        ok: false,
        json: async () => ({ detail: `No mock for ${url}` })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Open Library/i }));
    await user.click(await screen.findByRole("button", { name: /Book 1\s*2/i }));

    expect(screen.getByRole("button", { name: /Book 1\s*2/i })).toHaveAttribute("aria-current", "true");

    await user.click(screen.getByRole("button", { name: /Delete group/i }));

    expect(nativeConfirm).not.toHaveBeenCalled();
    const confirmation = await screen.findByRole("alertdialog", {
      name: /Delete material group/i
    });
    expect(confirmation).toHaveTextContent(
      /Delete 2 lessons from "Book 1"\? This cannot be undone\./i
    );

    await user.click(screen.getByRole("button", { name: /Delete 2 lessons/i }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(([input, init]) =>
        String(input).startsWith("/api/material-groups") && init?.method === "DELETE"
      );
      expect(deleteCall).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Book 1\s*2/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Book 2\s*1/i })).toBeInTheDocument();
    });
    const deleteUrl = new URL(
      String(fetchMock.mock.calls.find(([input]) => String(input).startsWith("/api/material-groups"))?.[0]),
      "http://localhost"
    );
    expect(deleteUrl.searchParams.get("pack_id")).toBe("new-concept");
    expect(deleteUrl.searchParams.get("book")).toBe("Book 1");
  });

  test("keeps the selected material group visible in the sidebar preview", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/materials": [
        {
          id: "starter-quiet-streets",
          pack_id: "just-talk-starter",
          pack_title: "Just Talk Starter",
          title: "Quiet Streets",
          text: "The weather changed quickly.",
          book: "Starter",
          lesson: "1",
          tags: ["starter"],
          source: "built-in",
          license: "Just Talk original",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        },
        {
          id: "starter-clear-morning",
          pack_id: "just-talk-starter",
          pack_title: "Just Talk Starter",
          title: "Clear Morning",
          text: "A clear morning is a good time to practice.",
          book: "Starter",
          lesson: "2",
          tags: ["starter"],
          source: "built-in",
          license: "Just Talk original",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        },
        {
          id: "nce-1-001",
          pack_id: "new-concept",
          pack_title: "New Concept English",
          title: "A Private Conversation",
          text: "Last week I went to the theatre.",
          book: "Book 1",
          lesson: "1",
          tags: ["nce"],
          source: "user-imported",
          license: "user-provided",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        },
        {
          id: "nce-1-002",
          pack_id: "new-concept",
          pack_title: "New Concept English",
          title: "Breakfast or Lunch",
          text: "It was Sunday.",
          book: "Book 1",
          lesson: "2",
          tags: ["nce"],
          source: "user-imported",
          license: "user-provided",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        },
        {
          id: "nce-1-003",
          pack_id: "new-concept",
          pack_title: "New Concept English",
          title: "Please Send Me a Card",
          text: "Postcards always spoil my holidays.",
          book: "Book 1",
          lesson: "3",
          tags: ["nce"],
          source: "user-imported",
          license: "user-provided",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        },
        {
          id: "nce-1-004",
          pack_id: "new-concept",
          pack_title: "New Concept English",
          title: "An Exciting Trip",
          text: "I have just received a letter from my brother.",
          book: "Book 1",
          lesson: "4",
          tags: ["nce"],
          source: "user-imported",
          license: "user-provided",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        }
      ]
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Quiet Streets/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Open Library/i }));
    await userEvent.click(screen.getByRole("button", { name: /Book 1\s*4/i }));
    await userEvent.click(screen.getByRole("button", { name: /Close library/i }));

    expect(screen.getByLabelText(/Current material queue/i)).toBeInTheDocument();
    expect(screen.getByText("Book 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /A Private Conversation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Breakfast or Lunch/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Please Send Me a Card/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /An Exciting Trip/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Quiet Streets/i })).not.toBeInTheDocument();
  });

  test("imports a material JSON file and refreshes the material list", async () => {
    const user = userEvent.setup();
    const importedMaterial = {
      id: "custom-1",
      pack_id: "custom-pack",
      pack_title: "Custom Pack",
      title: "Imported Lesson",
      text: "Imported practice text.",
      book: "",
      lesson: "",
      tags: [],
      source: "user-imported",
      license: "user-provided",
      created_at: "2026-05-25T00:00:00Z",
      updated_at: "2026-05-25T00:00:00Z"
    };
    let materialListCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/health") {
        return { ok: true, json: async () => health };
      }
      if (url === "/api/sessions" || url === "/api/words") {
        return { ok: true, json: async () => [] };
      }
      if (url === "/api/materials") {
        materialListCalls += 1;
        return {
          ok: true,
          json: async () => (materialListCalls === 1 ? [] : [importedMaterial])
        };
      }
      if (url === "/api/material-packs/import") {
        return {
          ok: true,
          json: async () => ({
            pack: { id: "custom-pack", title: "Custom Pack" },
            materials: [importedMaterial]
          })
        };
      }
      return {
        ok: false,
        json: async () => ({ detail: `No mock for ${url}` })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const file = new File(
      [
        JSON.stringify({
          schema_version: 1,
          pack: { id: "custom-pack", title: "Custom Pack" },
          lessons: [{ id: "custom-1", title: "Imported Lesson", text: "Imported practice text." }]
        })
      ],
      "materials.json",
      { type: "application/json" }
    );

    await user.upload(await screen.findByLabelText(/Import material JSON/i), file);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/material-packs/import",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Imported Lesson")
        })
      );
      expect(screen.getByRole("button", { name: /Imported Lesson/i })).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/material-packs/import",
      expect.objectContaining({
        body: expect.stringContaining("Imported practice text.")
      })
    );
  });

  test("shows material import help near the import action", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/materials": []
    });

    render(<App />);

    expect(
      await screen.findByRole("button", { name: /Material import format/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/schema_version: 1, pack \{ id, title \}, lessons \[\{ id, title, text \}\]/i)
    ).toBeInTheDocument();
  });

  test("validates material JSON before calling the import API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health") {
        return { ok: true, json: async () => health };
      }
      if (url === "/api/sessions" || url === "/api/words" || url === "/api/materials") {
        return { ok: true, json: async () => [] };
      }
      if (url === "/api/material-packs/import") {
        return {
          ok: true,
          json: async () => ({ pack: { id: "bad", title: "Bad" }, materials: [] })
        };
      }
      return {
        ok: false,
        json: async () => ({ detail: `No mock for ${url}` })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const file = new File(
      [
        JSON.stringify({
          schema_version: 1,
          pack: { id: "custom-pack", title: "Custom Pack" },
          lessons: [{ id: "custom-1", title: "Imported Lesson", text: " " }]
        })
      ],
      "materials.json",
      { type: "application/json" }
    );

    await user.upload(await screen.findByLabelText(/Import material JSON/i), file);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Each lesson needs id, title, and text."
    );
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === "/api/material-packs/import")
    ).toBe(false);
  });

  test("collapses left sidebar sections and expands one section at a time", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [
        {
          id: "session-1",
          created_at: "2026-05-24T10:00:00Z",
          reference_text: "Quiet streets.",
          audio_duration_ms: 1400,
          scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 }
        }
      ],
      "/api/words": [
        {
          id: "word-1",
          word: "quiet",
          source: "manual",
          notes: "",
          latest_score: 73,
          practice_count: 2,
          last_practiced_at: "2026-05-24T10:00:00Z",
          status: "active",
          consecutive_successes: 0,
          graduated_at: null,
          created_at: "2026-05-24T09:00:00Z",
          updated_at: "2026-05-24T10:00:00Z"
        }
      ],
      "/api/materials": [
        {
          id: "starter-clear-morning",
          pack_id: "just-talk-starter",
          pack_title: "Just Talk Starter",
          title: "Clear Morning",
          text: "A clear morning is a good time to practice careful speaking.",
          book: "Starter",
          lesson: "2",
          tags: ["starter", "short"],
          source: "built-in",
          license: "Just Talk original",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        }
      ]
    });

    render(<App />);

    const materialsToggle = await screen.findByRole("button", { name: /Materials\s*1/i });
    const historyToggle = screen.getByRole("button", { name: /History\s*1/i });
    const wordBankToggle = screen.getByRole("button", { name: /Word Bank\s*1/i });

    expect(materialsToggle).toHaveAttribute("aria-expanded", "true");
    expect(historyToggle).toHaveAttribute("aria-expanded", "false");
    expect(wordBankToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Clear Morning/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /90/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /quiet.*73/i })).not.toBeInTheDocument();

    await userEvent.click(historyToggle);

    expect(historyToggle).toHaveAttribute("aria-expanded", "true");
    expect(materialsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /90/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear Morning/i })).not.toBeInTheDocument();

    await userEvent.click(wordBankToggle);

    expect(wordBankToggle).toHaveAttribute("aria-expanded", "true");
    expect(historyToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /quiet.*73.*0\/2/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /90/ })).not.toBeInTheDocument();
  });

  test("separates in-progress and graduated word bank entries into tabs", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [
        {
          id: "word-1",
          word: "quiet",
          source: "manual",
          notes: "",
          latest_score: 73,
          practice_count: 2,
          last_practiced_at: "2026-05-24T10:00:00Z",
          status: "active",
          consecutive_successes: 0,
          graduated_at: null,
          created_at: "2026-05-24T09:00:00Z",
          updated_at: "2026-05-24T10:00:00Z"
        },
        {
          id: "word-2",
          word: "through",
          source: "practice",
          notes: "",
          latest_score: 91,
          practice_count: 4,
          last_practiced_at: "2026-05-24T10:20:00Z",
          status: "graduated",
          consecutive_successes: 2,
          graduated_at: "2026-05-24T10:20:00Z",
          created_at: "2026-05-24T09:30:00Z",
          updated_at: "2026-05-24T10:20:00Z"
        }
      ]
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));

    expect(await screen.findByRole("button", { name: /quiet.*73.*0\/2/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /through.*91/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Graduated\s*1/i }));

    expect(await screen.findByRole("button", { name: /through.*91.*graduated/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /quiet.*73/i })).not.toBeInTheDocument();
  });

  test("shows practice mode limits and keeps long passage recording available", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": []
    });

    render(<App />);

    const shortDrill = await screen.findByRole("button", {
      name: /Short Drill.*30 seconds max/i
    });
    expect(shortDrill).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: /Long Passage/i }));

    expect(screen.getByRole("button", { name: /Long Passage.*180 seconds max/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText(/Long Passage allows manual stop up to 180 seconds/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Record$/ })).not.toBeDisabled();
  });

  test("auto-expands the passage input so long text does not need an inner scroll", async () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
      .mockReturnValue(360);
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": []
    });

    render(<App />);

    const passageInput = await screen.findByDisplayValue(/The weather changed quickly/);
    await waitFor(() => expect(passageInput).toHaveStyle({ height: "360px" }));
    expect(passageInput).toHaveStyle({ overflowY: "hidden" });

    scrollHeightSpy.mockRestore();
  });

  test("preloads passage speech only after the passage input loses focus", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/speak": { audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }
    });

    render(<App />);
    await screen.findByRole("button", { name: /^Play$/ });
    const passageInput = screen.getByDisplayValue(/The weather changed quickly/);

    const speechCalls = () =>
      vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === "/api/speak");

    await new Promise((resolve) => window.setTimeout(resolve, 900));
    expect(speechCalls()).toHaveLength(0);

    fireEvent.change(passageInput, { target: { value: "Quiet streets." } });
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    expect(speechCalls()).toHaveLength(0);

    fireEvent.blur(passageInput);

    await waitFor(() => expect(speechCalls()).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/speak",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Quiet streets." })
      })
    );
  });

  test("preloads selected material speech with a persistent cache key", async () => {
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/materials": [
        {
          id: "starter-clear-morning",
          pack_id: "just-talk-starter",
          pack_title: "Just Talk Starter",
          title: "Clear Morning",
          text: "A clear morning is a good time to practice careful speaking.",
          book: "Starter",
          lesson: "2",
          tags: ["starter", "short"],
          source: "built-in",
          license: "Just Talk original",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        }
      ],
      "/api/speak": { audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Clear Morning/i }));
    fireEvent.blur(
      await screen.findByDisplayValue("A clear morning is a good time to practice careful speaking.")
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/speak",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            text: "A clear morning is a good time to practice careful speaking.",
            cache_key: "material:starter-clear-morning"
          })
        })
      )
    );
  });

  test("does not offer to edit a fixed material after scoring", async () => {
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: trackStop }]
        })
      }
    });
    class MediaRecorderMock {
      static isTypeSupported = vi.fn(() => true);
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:recording"),
      revokeObjectURL: vi.fn()
    });
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/materials": [
        {
          id: "starter-clear-morning",
          pack_id: "just-talk-starter",
          pack_title: "Just Talk Starter",
          title: "Clear Morning",
          text: "A clear morning is a good time to practice careful speaking.",
          book: "Starter",
          lesson: "2",
          tags: ["starter", "short"],
          source: "built-in",
          license: "Just Talk original",
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-25T00:00:00Z"
        }
      ],
      "/api/score": {
        result: {
          transcript: "A clear morning is a good time to practice careful speaking.",
          scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
          segments: [],
          words: [
            {
              word: "clear",
              accuracy: 88,
              bucket: "good",
              error_type: "None",
              offset_ms: 0,
              duration_ms: 300,
              phonemes: []
            }
          ],
          raw: {}
        },
        session: { id: "session-1" }
      },
      "/api/words/from-session/session-1": []
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Clear Morning/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Score$/ }));

    expect(await screen.findByRole("button", { name: "Review Material" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
  });

  test("highlights the scored word that matches recording playback time", async () => {
    const { container } = await renderScoredRecording();
    const audio = container.querySelector("audio");
    const doToken = await screen.findByRole("button", { name: /do\s*88/i });
    const thinkToken = await screen.findByRole("button", { name: /think\s*94/i });
    const singaporeToken = screen.getByRole("button", { name: /singapore\s*97/i });

    if (!audio) throw new Error("Recording audio element was not rendered.");
    expect(doToken).not.toHaveClass("playing");

    audio.currentTime = 1.05;
    fireEvent.timeUpdate(audio);

    expect(thinkToken).toHaveClass("playing");
    expect(singaporeToken).not.toHaveClass("playing");
  });

  test("seeks recording playback to the clicked scored word", async () => {
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const { container } = await renderScoredRecording();
    const audio = container.querySelector("audio");
    const singaporeToken = screen.getByRole("button", { name: /singapore\s*97/i });

    if (!audio) throw new Error("Recording audio element was not rendered.");
    await userEvent.click(singaporeToken);

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(audio.currentTime).toBeCloseTo(1.35);
    expect(singaporeToken).toHaveClass("selected");
  });

  test("highlights the spoken word during passage pronunciation playback", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
      duration: number;
      ontimeupdate?: () => void;
    }[] = [];
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
          duration: 3,
        };
        audioInstances.push(instance);
        return instance;
      })
    );

    await renderScoredRecording({
      "/api/speak": {
        audio_base64: "YXVkaW8=",
        content_type: "audio/mpeg",
        word_boundaries: [
          { text: "do", text_offset: 0, word_length: 2, audio_offset_ms: 0, duration_ms: 240 },
          { text: "you", text_offset: 3, word_length: 3, audio_offset_ms: 320, duration_ms: 260 },
          { text: "think", text_offset: 7, word_length: 5, audio_offset_ms: 900, duration_ms: 430 },
          {
            text: "singapore",
            text_offset: 13,
            word_length: 9,
            audio_offset_ms: 1500,
            duration_ms: 700
          }
        ]
      }
    });
    await userEvent.click(await screen.findByRole("button", { name: /^Play$/ }));
    await waitFor(() => expect(audioInstances).toHaveLength(1));

    audioInstances[0].currentTime = 1.6;
    act(() => {
      audioInstances[0].ontimeupdate?.();
    });

    expect(screen.getByRole("button", { name: /singapore\s*97/i })).toHaveClass("playing");
    expect(screen.getByRole("button", { name: /think\s*94/i })).not.toHaveClass("playing");
  });

  test("shows and seeks read-along words while passage pronunciation plays before scoring", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
      duration: number;
      ontimeupdate?: () => void;
    }[] = [];
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
          duration: 3,
        };
        audioInstances.push(instance);
        return instance;
      })
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn()
    });
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/speak": {
        audio_base64: "YXVkaW8=",
        content_type: "audio/mpeg",
        word_boundaries: [
          { text: "do", text_offset: 0, word_length: 2, audio_offset_ms: 0, duration_ms: 240 },
          { text: "you", text_offset: 3, word_length: 3, audio_offset_ms: 320, duration_ms: 260 },
          { text: "think", text_offset: 7, word_length: 5, audio_offset_ms: 900, duration_ms: 430 },
          {
            text: "singapore",
            text_offset: 13,
            word_length: 9,
            audio_offset_ms: 1500,
            duration_ms: 700
          }
        ]
      }
    });

    render(<App />);
    fireEvent.change(await screen.findByDisplayValue(/The weather changed quickly/), {
      target: { value: "do you think singapore" }
    });
    await userEvent.click(await screen.findByRole("button", { name: /^Play$/ }));
    await waitFor(() => expect(audioInstances).toHaveLength(1));

    audioInstances[0].currentTime = 0.95;
    act(() => {
      audioInstances[0].ontimeupdate?.();
    });
    const thinkWord = await screen.findByRole("button", { name: "think" });
    expect(thinkWord).toHaveClass("playing");

    await userEvent.click(screen.getByRole("button", { name: "singapore" }));

    expect(audioInstances[0].currentTime).toBeCloseTo(1.5);
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "singapore" })).toHaveClass("playing");
  });

  test("pauses passage pronunciation audio without starting overlapping playback", async () => {
    const audioInstances: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; currentTime: number }[] = [];
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0
        };
        audioInstances.push(instance);
        return instance;
      })
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn()
    });
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/speak": { audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }
    });

    render(<App />);
    const playButton = await screen.findByRole("button", { name: /^Play$/ });
    await userEvent.click(playButton);
    await waitFor(() => expect(audioInstances).toHaveLength(1));
    audioInstances[0].currentTime = 4;
    await userEvent.click(await screen.findByRole("button", { name: /^Pause$/ }));

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(4);
    expect(audioInstances).toHaveLength(1);
  });

  test("turns the passage play button into pause while pronunciation audio is active", async () => {
    const audioInstances: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; currentTime: number }[] = [];
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0
        };
        audioInstances.push(instance);
        return instance;
      })
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn()
    });
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/speak": { audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play$/ }));
    await waitFor(() => expect(audioInstances).toHaveLength(1));
    audioInstances[0].currentTime = 5;

    const pauseButton = await screen.findByRole("button", { name: /^Pause$/ });
    await userEvent.click(pauseButton);

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(5);
    expect(await screen.findByRole("button", { name: /^Play$/ })).toBeInTheDocument();
  });

  test("lets the standard passage playback be scrubbed and skipped", async () => {
    const audioInstances: {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
      duration: number;
      ondurationchange?: () => void;
      ontimeupdate?: () => void;
    }[] = [];
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0,
          duration: 12,
        };
        audioInstances.push(instance);
        return instance;
      })
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn()
    });
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/speak": { audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play$/ }));
    await waitFor(() => expect(audioInstances).toHaveLength(1));

    act(() => {
      audioInstances[0].ondurationchange?.();
    });
    const progress = await screen.findByLabelText("Passage audio progress");
    fireEvent.change(progress, { target: { value: "8" } });
    await userEvent.click(screen.getByRole("button", { name: "Back 5 seconds" }));

    expect(audioInstances[0].currentTime).toBe(3);
    expect(screen.getByText("0:03 / 0:12")).toBeInTheDocument();
  });

  test("stops passage pronunciation audio before recording starts", async () => {
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: trackStop }]
        })
      }
    });
    class MediaRecorderMock {
      static isTypeSupported = vi.fn(() => true);
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", MediaRecorderMock);
    const audioInstances: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; currentTime: number }[] = [];
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0
        };
        audioInstances.push(instance);
        return instance;
      })
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn()
    });
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/speak": { audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /^Play$/ }));
    await waitFor(() => expect(audioInstances).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /^Stop$/ })).toBeInTheDocument();
  });

  test("advances record, stop, score, and re-record with the Enter key", async () => {
    installRecordingMocks();
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/score": {
        result: {
          transcript: "do you think singapore",
          scores: { pronunciation: 93, accuracy: 95, fluency: 90, completeness: 100, prosody: 88 },
          segments: [],
          words: scoredRecordingWords,
          raw: {}
        },
        session: { id: "session-1" }
      },
      "/api/words/from-session/session-1": []
    });

    render(<App />);
    await screen.findByRole("button", { name: /^Record/ });

    fireEvent.keyDown(window, { key: "Enter" });
    await screen.findByRole("button", { name: /^Stop/ });

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Score/ })).not.toBeDisabled());

    fireEvent.keyDown(window, { key: "Enter" });
    expect(await screen.findByRole("button", { name: /singapore\s*97/i })).toBeInTheDocument();

    // After results, Enter starts a fresh take; Shift+Enter re-records a pending
    // take without scoring it.
    fireEvent.keyDown(window, { key: "Enter" });
    await screen.findByRole("button", { name: /^Stop/ });
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Score/ })).not.toBeDisabled());
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    await screen.findByRole("button", { name: /^Stop/ });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const scoreCalls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/score");
    expect(scoreCalls).toHaveLength(1);
  });

  test("keeps native Space and Enter activation on focused buttons", async () => {
    const audioInstances: { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; currentTime: number }[] = [];
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock() {
        const instance = {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
          currentTime: 0
        };
        audioInstances.push(instance);
        return instance;
      })
    );
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pronunciation"),
      revokeObjectURL: vi.fn()
    });
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/speak": { audio_base64: "YXVkaW8=", content_type: "audio/mpeg" }
    });

    render(<App />);
    const recordButton = await screen.findByRole("button", { name: /^Record/ });
    recordButton.focus();

    // Shortcuts must not call preventDefault when a button is focused, so the
    // browser's native Space/Enter activation still works.
    expect(fireEvent.keyDown(recordButton, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(recordButton, { key: "Enter" })).toBe(true);
    expect(audioInstances).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Stop/ })).toBeNull();

    // Away from interactive elements, Space still toggles passage audio.
    expect(fireEvent.keyDown(document.body, { key: " " })).toBe(false);
    await waitFor(() => expect(audioInstances).toHaveLength(1));
  });

  test("ignores shortcuts while typing in the passage input", async () => {
    installRecordingMocks();
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": []
    });

    render(<App />);
    const passageInput = await screen.findByRole("textbox");

    fireEvent.keyDown(passageInput, { key: "Enter" });

    expect(screen.queryByRole("button", { name: /^Stop/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Record/ })).toBeInTheDocument();
  });

  test("surfaces an error instead of crashing if a successful score response has no session", async () => {
    installRecordingMocks();
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/score": {
        result: {
          transcript: "do you think singapore",
          scores: { pronunciation: 93, accuracy: 95, fluency: 90, completeness: 100, prosody: 88 },
          segments: [],
          words: scoredRecordingWords,
          raw: {}
        },
        // Inconsistent server response: recognition succeeded but no session
        // was persisted. Nothing downstream should assume session is non-null.
        session: null
      }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /^Record$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Score$/ })).not.toBeDisabled());
    await userEvent.click(screen.getByRole("button", { name: /^Score$/ }));

    expect(await screen.findByText(/no session was returned/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /singapore/i })).not.toBeInTheDocument();
  });

  test("shows a no-match banner and replaces the onboarding state instead of scoring", async () => {
    installRecordingMocks();
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/score": {
        result: {
          transcript: "",
          recognition_status: "no_match",
          scores: { pronunciation: null, accuracy: null, fluency: null, completeness: null, prosody: null },
          segments: [],
          words: [],
          raw: {}
        },
        session: null
      }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /^Record$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Score$/ })).not.toBeDisabled());

    const sessionFetchesBeforeScoring = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => String(call[0]) === "/api/sessions"
    ).length;

    await userEvent.click(screen.getByRole("button", { name: /^Score$/ }));

    const banners = await screen.findAllByRole("alert");
    expect(banners.some((banner) => /No speech detected/i.test(banner.textContent ?? ""))).toBe(true);
    expect(screen.queryByText("Ready when you are")).not.toBeInTheDocument();

    // Nothing was saved server-side, so history must not be refetched.
    const sessionFetchesAfterScoring = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => String(call[0]) === "/api/sessions"
    ).length;
    expect(sessionFetchesAfterScoring).toBe(sessionFetchesBeforeScoring);
  });

  test("clears the no-match banner when a new recording starts", async () => {
    installRecordingMocks();
    mockApi({
      "/api/health": health,
      "/api/sessions": [],
      "/api/words": [],
      "/api/score": {
        result: {
          transcript: "",
          recognition_status: "no_match",
          scores: { pronunciation: null, accuracy: null, fluency: null, completeness: null, prosody: null },
          segments: [],
          words: [],
          raw: {}
        },
        session: null
      }
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /^Record$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Score$/ })).not.toBeDisabled());
    await userEvent.click(screen.getByRole("button", { name: /^Score$/ }));
    await screen.findAllByText(/No speech detected/i);

    await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));

    expect(screen.queryAllByText(/No speech detected/i)).toHaveLength(0);
  });

  describe("guided review session", () => {
    const reviewWordBase = {
      source: "manual",
      notes: "",
      latest_score: 80,
      practice_count: 1,
      last_practiced_at: "2026-06-01T00:00:00Z",
      status: "active",
      consecutive_successes: 1,
      graduated_at: null,
      created_at: "2026-05-20T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z"
    };

    function dueWords() {
      return [
        {
          ...reviewWordBase,
          id: "w-recent",
          word: "recent",
          interval_days: 2,
          due_at: new Date(Date.now() - 1 * 86_400_000).toISOString()
        },
        {
          ...reviewWordBase,
          id: "w-oldest",
          word: "oldest",
          interval_days: 5,
          due_at: new Date(Date.now() - 5 * 86_400_000).toISOString()
        },
        {
          ...reviewWordBase,
          id: "w-not-due",
          word: "notdue",
          interval_days: 4,
          due_at: new Date(Date.now() + 3 * 86_400_000).toISOString()
        }
      ];
    }

    test("starts a review queue with due-only words ordered most-overdue-first", async () => {
      mockApi({
        "/api/health": health,
        "/api/sessions": [],
        "/api/materials": [],
        "/api/words": dueWords()
      });

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));

      expect(await screen.findByText("Review 1/2")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByDisplayValue("oldest")).toBeInTheDocument());
    });

    test("advances the review queue one word at a time via Skip word (unscored)", async () => {
      mockApi({
        "/api/health": health,
        "/api/sessions": [],
        "/api/materials": [],
        "/api/words": dueWords()
      });

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));

      await screen.findByText("Review 1/2");
      expect(screen.getByDisplayValue("oldest")).toBeInTheDocument();
      // The word has not been scored yet, so the advance button reads "Skip word".
      expect(screen.getByRole("button", { name: /^Skip word$/i })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^Skip word$/i }));

      expect(await screen.findByText("Review 2/2")).toBeInTheDocument();
      expect(screen.getByDisplayValue("recent")).toBeInTheDocument();
    });

    test("labels the advance button Next word once the current word is scored, and reports practiced vs skipped in the completion summary", async () => {
      installRecordingMocks();
      mockApi({
        "/api/health": health,
        "/api/sessions": [],
        "/api/materials": [],
        "/api/words": dueWords(),
        "/api/score": {
          result: {
            transcript: "oldest",
            scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
            segments: [],
            words: [
              { word: "oldest", accuracy: 90, bucket: "good", error_type: "None", offset_ms: 0, duration_ms: 300, phonemes: [] }
            ],
            raw: {}
          },
          session: { id: "session-1" }
        },
        "/api/words/from-session/session-1": []
      });

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));

      await screen.findByText("Review 1/2");
      expect(screen.getByRole("button", { name: /^Skip word$/i })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));
      await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /^Score$/ })).not.toBeDisabled());
      await userEvent.click(screen.getByRole("button", { name: /^Score$/ }));

      // Scored: the advance button now reads "Next word".
      await userEvent.click(await screen.findByRole("button", { name: /^Next word$/i }));

      await screen.findByText("Review 2/2");
      // The second word is skipped without scoring.
      await userEvent.click(await screen.findByRole("button", { name: /^Skip word$/i }));

      expect(await screen.findByText("Review complete")).toBeInTheDocument();
      expect(screen.getByText("1 practiced, 1 skipped")).toBeInTheDocument();
    });

    test("discards a stale score response for a word the user has already skipped past", async () => {
      installRecordingMocks();

      let resolveScore!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
      const scorePromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveScore = resolve;
      });
      const payloads: Record<string, unknown> = {
        "/api/health": health,
        "/api/sessions": [],
        "/api/materials": [],
        "/api/words": dueWords(),
        "/api/words/from-session/session-1": []
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === "/api/score") {
            return scorePromise;
          }
          const payload = url === "/api/materials" && payloads[url] === undefined ? [] : payloads[url];
          if (payload === undefined) {
            return { ok: false, json: async () => ({ detail: `No mock for ${url}` }) };
          }
          return { ok: true, json: async () => payload };
        })
      );

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));

      await screen.findByText("Review 1/2");
      expect(screen.getByDisplayValue("oldest")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));
      await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /^Score$/ })).not.toBeDisabled());

      // Start scoring word A ("oldest"); the response is held back deliberately.
      await userEvent.click(screen.getByRole("button", { name: /^Score$/ }));

      // Before the response arrives, skip ahead to word B ("recent").
      await userEvent.click(screen.getByRole("button", { name: /^Skip word$/i }));
      await screen.findByText("Review 2/2");
      expect(screen.getByDisplayValue("recent")).toBeInTheDocument();

      const sessionFetchesBeforeResolve = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => String(call[0]) === "/api/sessions"
      ).length;

      // Now let word A's stale score response resolve.
      await act(async () => {
        resolveScore({
          ok: true,
          json: async () => ({
            result: {
              transcript: "oldest",
              scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
              segments: [],
              words: [
                { word: "oldest", accuracy: 90, bucket: "good", error_type: "None", offset_ms: 0, duration_ms: 300, phonemes: [] }
              ],
              raw: {}
            },
            session: { id: "session-1" }
          })
        });
      });

      // The stale response must not overwrite word B's view: still on
      // "recent", no scored word token rendered, and no history refresh.
      expect(screen.getByDisplayValue("recent")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /oldest\s*90/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Score complete/i)).not.toBeInTheDocument();
      const sessionFetchesAfterResolve = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => String(call[0]) === "/api/sessions"
      ).length;
      expect(sessionFetchesAfterResolve).toBe(sessionFetchesBeforeResolve);
    });

    test("discards a stale score response when the user advances during the post-score refreshes (not /api/score itself)", async () => {
      installRecordingMocks();

      let resolveAddedWords!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
      const addedWordsPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
        resolveAddedWords = resolve;
      });
      const payloads: Record<string, unknown> = {
        "/api/health": health,
        "/api/sessions": [],
        "/api/materials": [],
        "/api/words": dueWords(),
        "/api/stats/activity": { days: [], streak_days: 0, sessions_this_week: 0, recent_scores: [] },
        "/api/score": {
          result: {
            transcript: "oldest",
            scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
            segments: [],
            words: [
              { word: "oldest", accuracy: 90, bucket: "good", error_type: "None", offset_ms: 0, duration_ms: 300, phonemes: [] }
            ],
            raw: {}
          },
          session: { id: "session-1" }
        }
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          // /api/score resolves immediately; only the ancillary word-bank
          // refresh that follows it is held back deliberately.
          if (url === "/api/words/from-session/session-1") {
            return addedWordsPromise;
          }
          const payload = url === "/api/materials" && payloads[url] === undefined ? [] : payloads[url];
          if (payload === undefined) {
            return { ok: false, json: async () => ({ detail: `No mock for ${url}` }) };
          }
          return { ok: true, json: async () => payload };
        })
      );

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));

      await screen.findByText("Review 1/2");
      expect(screen.getByDisplayValue("oldest")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));
      await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /^Score$/ })).not.toBeDisabled());
      await userEvent.click(screen.getByRole("button", { name: /^Score$/ }));

      // /api/score already resolved, so the "practiced" latch and the button
      // label flip immediately — even though the word-bank refresh below is
      // still pending.
      await screen.findByRole("button", { name: /^Next word$/i });

      // Advance to word B while that refresh is still in flight.
      await userEvent.click(screen.getByRole("button", { name: /^Next word$/i }));
      await screen.findByText("Review 2/2");
      expect(screen.getByDisplayValue("recent")).toBeInTheDocument();

      const sessionFetchesBeforeResolve = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => String(call[0]) === "/api/sessions"
      ).length;

      // Now let the stale ancillary refresh resolve and settle.
      await act(async () => {
        resolveAddedWords({ ok: true, json: async () => [] });
      });
      await waitFor(() => {
        const sessionFetchesAfterResolve = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: unknown[]) => String(call[0]) === "/api/sessions"
        ).length;
        expect(sessionFetchesAfterResolve).toBeGreaterThan(sessionFetchesBeforeResolve);
      });

      // Word B's view must be untouched: still "recent", no scored word
      // token for "oldest" leaking in, no stray "Score complete" status, and
      // the advance button still reads "Skip word" for the new, unscored word.
      expect(screen.getByDisplayValue("recent")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /oldest\s*90/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Score complete/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Skip word$/i })).toBeInTheDocument();
    });

    test("still counts a word as practiced if the user re-records without re-scoring before advancing", async () => {
      installRecordingMocks();
      mockApi({
        "/api/health": health,
        "/api/sessions": [],
        "/api/materials": [],
        "/api/words": dueWords(),
        "/api/score": {
          result: {
            transcript: "oldest",
            scores: { pronunciation: 90, accuracy: 88, fluency: 91, completeness: 100, prosody: 84 },
            segments: [],
            words: [
              { word: "oldest", accuracy: 90, bucket: "good", error_type: "None", offset_ms: 0, duration_ms: 300, phonemes: [] }
            ],
            raw: {}
          },
          session: { id: "session-1" }
        },
        "/api/words/from-session/session-1": []
      });

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));
      await screen.findByText("Review 1/2");

      // Score the word once.
      await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));
      await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
      await waitFor(() => expect(screen.getByRole("button", { name: /^Score$/ })).not.toBeDisabled());
      await userEvent.click(screen.getByRole("button", { name: /^Score$/ }));
      await screen.findByRole("button", { name: /^Next word$/i });

      // Re-record without scoring again. The button label reverts to "Skip
      // word" (reviewJustScored is UX-only and resets on re-record)...
      await userEvent.click(screen.getByRole("button", { name: /^Record$/ }));
      await userEvent.click(await screen.findByRole("button", { name: /^Stop$/ }));
      expect(await screen.findByRole("button", { name: /^Skip word$/i })).toBeInTheDocument();

      // ...but advancing still counts the word as practiced: the score was
      // genuinely accepted once, and that latch is not cleared by a re-record.
      await userEvent.click(screen.getByRole("button", { name: /^Skip word$/i }));
      await screen.findByText("Review 2/2");
      await userEvent.click(screen.getByRole("button", { name: /^Skip word$/i }));

      expect(await screen.findByText("Review complete")).toBeInTheDocument();
      expect(screen.getByText("1 practiced, 1 skipped")).toBeInTheDocument();
    });

    test("shows a completion summary after the last due word and closes the queue", async () => {
      mockApi({
        "/api/health": health,
        "/api/sessions": [],
        "/api/materials": [],
        "/api/words": dueWords()
      });

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));

      await screen.findByText("Review 1/2");
      await userEvent.click(screen.getByRole("button", { name: /^Skip word$/i }));
      await screen.findByText("Review 2/2");
      await userEvent.click(screen.getByRole("button", { name: /^Skip word$/i }));

      expect(await screen.findByText("Review complete")).toBeInTheDocument();
      expect(screen.getByText("0 practiced, 2 skipped")).toBeInTheDocument();
      expect(screen.queryByText(/^Review \d\/\d$/)).not.toBeInTheDocument();
    });

    test("auto-exits the review when a material is loaded instead", async () => {
      mockApi({
        "/api/health": health,
        "/api/sessions": [],
        "/api/words": dueWords(),
        "/api/materials": [
          {
            id: "starter-clear-morning",
            pack_id: "just-talk-starter",
            pack_title: "Just Talk Starter",
            title: "Clear Morning",
            text: "A clear morning is a good time to practice careful speaking.",
            book: "Starter",
            lesson: "2",
            tags: ["starter", "short"],
            source: "built-in",
            license: "Just Talk original",
            created_at: "2026-05-25T00:00:00Z",
            updated_at: "2026-05-25T00:00:00Z"
          }
        ]
      });

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));
      await screen.findByText("Review 1/2");

      await userEvent.click(screen.getByRole("button", { name: /Materials/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Clear Morning/i }));

      await waitFor(() => {
        expect(
          screen.getByDisplayValue("A clear morning is a good time to practice careful speaking.")
        ).toBeInTheDocument();
      });
      expect(screen.queryByText(/^Review \d\/\d$/)).not.toBeInTheDocument();
    });

    test("clears a lingering completion summary when a material is loaded afterward", async () => {
      mockApi({
        "/api/health": health,
        "/api/sessions": [],
        "/api/words": dueWords(),
        "/api/materials": [
          {
            id: "starter-clear-morning",
            pack_id: "just-talk-starter",
            pack_title: "Just Talk Starter",
            title: "Clear Morning",
            text: "A clear morning is a good time to practice careful speaking.",
            book: "Starter",
            lesson: "2",
            tags: ["starter", "short"],
            source: "built-in",
            license: "Just Talk original",
            created_at: "2026-05-25T00:00:00Z",
            updated_at: "2026-05-25T00:00:00Z"
          }
        ]
      });

      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: /Word Bank/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Start review \(2\)/i }));
      await screen.findByText("Review 1/2");
      await userEvent.click(screen.getByRole("button", { name: /^Skip word$/i }));
      await screen.findByText("Review 2/2");
      await userEvent.click(screen.getByRole("button", { name: /^Skip word$/i }));
      await screen.findByText("Review complete");

      await userEvent.click(screen.getByRole("button", { name: /Materials/i }));
      await userEvent.click(await screen.findByRole("button", { name: /Clear Morning/i }));

      await waitFor(() => {
        expect(
          screen.getByDisplayValue("A clear morning is a good time to practice careful speaking.")
        ).toBeInTheDocument();
      });
      expect(screen.queryByText("Review complete")).not.toBeInTheDocument();
    });
  });
});
