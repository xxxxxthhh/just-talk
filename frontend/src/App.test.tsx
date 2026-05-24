import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import App from "./App";

function mockApi(payloads: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = payloads[url];
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
  max_audio_seconds: 30
};

describe("App", () => {
  afterEach(() => {
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
          created_at: "2026-05-24T09:00:00Z",
          updated_at: "2026-05-24T10:00:00Z"
        }
      ]
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /quiet.*73.*2/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("quiet")).toBeInTheDocument();
    });
  });

  test("stops the previous pronunciation audio before playing another one", async () => {
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
    await waitFor(() => expect(audioInstances).toHaveLength(2));

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(audioInstances[0].currentTime).toBe(0);
    expect(audioInstances[1].play).toHaveBeenCalledTimes(1);
  });
});
