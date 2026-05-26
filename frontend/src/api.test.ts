import { afterEach, describe, expect, test, vi } from "vitest";

import {
  addWordsFromSession,
  checkHealth,
  createWord,
  deleteWord,
  getSession,
  importMaterialPack,
  listMaterials,
  listWords,
  scoreRecording,
  speakText
} from "./api";
import type { MaterialPackImportPayload } from "./types";

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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { scores: { pronunciation: 91 } } })
    });
    vi.stubGlobal("fetch", fetchMock);

    const audio = new Blob(["abc"], { type: "audio/webm" });
    const response = await scoreRecording("Hello.", audio);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/score",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) })
    );
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("mode")).toBe("short");
    expect(response.result.scores.pronunciation).toBe(91);
  });

  test("uploads long passage recordings to the unified scoring endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { segments: [{ transcript: "Long passage." }] } })
    });
    vi.stubGlobal("fetch", fetchMock);

    const audio = new Blob(["abc"], { type: "audio/webm" });
    const response = await scoreRecording("Long passage.", audio, "long");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/score",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) })
    );
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("mode")).toBe("long");
    expect(response.result.segments?.[0].transcript).toBe("Long passage.");
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

  test("manages material library entries", async () => {
    const payload: MaterialPackImportPayload = {
      schema_version: 1,
      pack: { id: "custom-pack", title: "Custom Pack" },
      lessons: [{ id: "custom-1", title: "Custom Lesson", text: "Practice clearly." }]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "starter-1", title: "Starter", text: "Start here." }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pack: { id: "custom-pack", title: "Custom Pack" },
          materials: [{ id: "custom-1", title: "Custom Lesson", text: "Practice clearly." }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const materials = await listMaterials();
    const imported = await importMaterialPack(payload);

    expect(materials[0].title).toBe("Starter");
    expect(imported.materials[0].id).toBe("custom-1");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/materials");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/material-packs/import",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
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
