import type {
  ActivityStats,
  Health,
  MaterialItem,
  MaterialPackImportPayload,
  MaterialPackImportResponse,
  PassageIssue,
  PhonemeStat,
  PracticeSession,
  ScoreResponse,
  SpeechResponse,
  VocabularyItem
} from "./types";

export function apiUrl(path: string): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  return baseUrl ? `${baseUrl.replace(/\/+$/, "")}${path}` : path;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = import.meta.env.VITE_API_TOKEN ?? "";
  if (!token) {
    return init === undefined ? fetch(apiUrl(path)) : fetch(apiUrl(path), init);
  }

  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(apiUrl(path), { ...init, headers });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : "Request failed.";
    throw new Error(detail);
  }
  return payload as T;
}

export async function checkHealth(): Promise<Health> {
  return parseResponse<Health>(await apiFetch("/api/health"));
}

export async function listSessions(): Promise<PracticeSession[]> {
  return parseResponse<PracticeSession[]>(await apiFetch("/api/sessions"));
}

export async function getSession(sessionId: string): Promise<PracticeSession> {
  return parseResponse<PracticeSession>(
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`)
  );
}

export async function scoreRecording(
  referenceText: string,
  audioBlob: Blob,
  mode: "short" | "long" = "short"
): Promise<ScoreResponse> {
  const body = new FormData();
  body.append("reference_text", referenceText);
  body.append("mode", mode);
  body.append("audio", audioBlob, "recording.webm");
  return parseResponse<ScoreResponse>(
    await apiFetch("/api/score", {
      method: "POST",
      body
    })
  );
}

export async function fetchActivityStats(): Promise<ActivityStats> {
  return parseResponse<ActivityStats>(await apiFetch("/api/stats/activity"));
}

export async function fetchPhonemeStats(minAttempts?: number): Promise<PhonemeStat[]> {
  const url = minAttempts !== undefined
    ? `/api/phoneme-stats?min_attempts=${minAttempts}`
    : "/api/phoneme-stats";
  return parseResponse<PhonemeStat[]>(await apiFetch(url));
}

export async function listMaterials(): Promise<MaterialItem[]> {
  return parseResponse<MaterialItem[]>(await apiFetch("/api/materials"));
}

export async function importMaterialPack(
  payload: MaterialPackImportPayload
): Promise<MaterialPackImportResponse> {
  return parseResponse<MaterialPackImportResponse>(
    await apiFetch("/api/material-packs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function generateDrill(phoneme: string): Promise<MaterialItem> {
  return parseResponse<MaterialItem>(
    await apiFetch("/api/drills/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneme })
    })
  );
}

export async function deleteMaterialGroup(
  packId: string,
  book: string
): Promise<{ deleted: number }> {
  const params = new URLSearchParams({ pack_id: packId, book });
  return parseResponse<{ deleted: number }>(
    await apiFetch(`/api/material-groups?${params.toString()}`, {
      method: "DELETE"
    })
  );
}

export async function listWords(): Promise<VocabularyItem[]> {
  return parseResponse<VocabularyItem[]>(await apiFetch("/api/words"));
}

export async function createWord(word: string): Promise<VocabularyItem> {
  return parseResponse<VocabularyItem>(
    await apiFetch("/api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word })
    })
  );
}

export async function addWordsFromSession(sessionId: string): Promise<VocabularyItem[]> {
  return parseResponse<VocabularyItem[]>(
    await apiFetch(`/api/words/from-session/${encodeURIComponent(sessionId)}`, {
      method: "POST"
    })
  );
}

export async function deleteWord(wordId: string): Promise<{ deleted: boolean }> {
  return parseResponse<{ deleted: boolean }>(
    await apiFetch(`/api/words/${encodeURIComponent(wordId)}`, {
      method: "DELETE"
    })
  );
}

export type SpeakTextOptions = {
  cacheKey?: string;
};

export async function speakText(
  text: string,
  options: SpeakTextOptions = {}
): Promise<SpeechResponse> {
  const body: { text: string; cache_key?: string } = { text };
  if (options.cacheKey) {
    body.cache_key = options.cacheKey;
  }
  return parseResponse<SpeechResponse>(
    await apiFetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

export async function checkPassage(text: string): Promise<{ issues: PassageIssue[] }> {
  const body = new FormData();
  body.append("text", text);
  return parseResponse<{ issues: PassageIssue[] }>(
    await apiFetch("/api/passage-check", {
      method: "POST",
      body
    })
  );
}
