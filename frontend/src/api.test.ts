import { afterEach, describe, expect, test, vi } from "vitest";

import {
  addWordsFromSession,
  checkHealth,
  createWord,
  deleteWord,
  getSession,
  listWords,
  scoreRecording,
  speakText
} from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api client", () => {
  test("loads backend health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, azure_configured: false })
      })
    );

    const health = await checkHealth();

    expect(fetch).toHaveBeenCalledWith("/api/health");
    expect(health.azure_configured).toBe(false);
  });

  test("uploads recording with reference text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { scores: { pronunciation: 91 } } })
      })
    );

    const audio = new Blob(["abc"], { type: "audio/webm" });
    const response = await scoreRecording("Hello.", audio);

    expect(fetch).toHaveBeenCalledWith(
      "/api/score",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) })
    );
    expect(response.result.scores.pronunciation).toBe(91);
  });

  test("loads a full session by id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "session-1", words: [{ word: "quiet" }] })
      })
    );

    const session = await getSession("session-1");

    expect(fetch).toHaveBeenCalledWith("/api/sessions/session-1");
    expect(session.words?.[0].word).toBe("quiet");
  });

  test("manages word bank entries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "word-1", word: "quiet" }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "word-2", word: "wanted" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "word-3", word: "quickly" }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deleted: true })
      });
    vi.stubGlobal("fetch", fetchMock);

    const words = await listWords();
    const created = await createWord("wanted");
    const added = await addWordsFromSession("session-1");
    const deleted = await deleteWord("word-2");

    expect(words[0].word).toBe("quiet");
    expect(created.word).toBe("wanted");
    expect(added[0].word).toBe("quickly");
    expect(deleted.deleted).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/words");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/words",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ word: "wanted" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/words/from-session/session-1",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/words/word-2",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("requests synthesized speech audio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ audio_base64: "YXVkaW8=", content_type: "audio/mpeg" })
      })
    );

    const response = await speakText("quiet");

    expect(fetch).toHaveBeenCalledWith(
      "/api/speak",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "quiet" }) })
    );
    expect(response.content_type).toBe("audio/mpeg");
  });

  test("throws backend detail on failed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Azure Speech is not configured." })
      })
    );

    await expect(scoreRecording("Hello.", new Blob())).rejects.toThrow(
      "Azure Speech is not configured."
    );
  });
});
