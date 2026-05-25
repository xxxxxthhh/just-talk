import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("App", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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

  test("stops passage pronunciation audio without starting overlapping playback", async () => {
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
    await userEvent.click(playButton);

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(0);
    expect(audioInstances).toHaveLength(1);
  });

  test("turns the passage play button into stop while pronunciation audio is active", async () => {
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

    const stopButton = await screen.findByRole("button", { name: /^Stop$/ });
    await userEvent.click(stopButton);

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(0);
    expect(await screen.findByRole("button", { name: /^Play$/ })).toBeInTheDocument();
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
});
