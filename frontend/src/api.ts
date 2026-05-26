import type {
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


async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : "Request failed.";
    throw new Error(detail);
  }
  return payload as T;
}

export async function checkHealth(): Promise<Health> {
  return parseResponse<Health>(await fetch("/api/health"));
}

export async function listSessions(): Promise<PracticeSession[]> {
  return parseResponse<PracticeSession[]>(await fetch("/api/sessions"));
}

export async function getSession(sessionId: string): Promise<PracticeSession> {
  return parseResponse<PracticeSession>(
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`)
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
    await fetch("/api/score", {
      method: "POST",
      body
    })
  );
}

export async function fetchPhonemeStats(minAttempts?: number): Promise<PhonemeStat[]> {
  const url = minAttempts !== undefined
    ? `/api/phoneme-stats?min_attempts=${minAttempts}`
    : "/api/phoneme-stats";
  return parseResponse<PhonemeStat[]>(await fetch(url));
}

export async function listMaterials(): Promise<MaterialItem[]> {
  return parseResponse<MaterialItem[]>(await fetch("/api/materials"));
}

export async function importMaterialPack(
  payload: MaterialPackImportPayload
): Promise<MaterialPackImportResponse> {
  return parseResponse<MaterialPackImportResponse>(
    await fetch("/api/material-packs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function listWords(): Promise<VocabularyItem[]> {
  return parseResponse<VocabularyItem[]>(await fetch("/api/words"));
}

export async function createWord(word: string): Promise<VocabularyItem> {
  return parseResponse<VocabularyItem>(
    await fetch("/api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word })
    })
  );
}

export async function addWordsFromSession(sessionId: string): Promise<VocabularyItem[]> {
  return parseResponse<VocabularyItem[]>(
    await fetch(`/api/words/from-session/${encodeURIComponent(sessionId)}`, {
      method: "POST"
    })
  );
}

export async function deleteWord(wordId: string): Promise<{ deleted: boolean }> {
  return parseResponse<{ deleted: boolean }>(
    await fetch(`/api/words/${encodeURIComponent(wordId)}`, {
      method: "DELETE"
    })
  );
}

export async function speakText(text: string): Promise<SpeechResponse> {
  return parseResponse<SpeechResponse>(
    await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    })
  );
}

export async function checkPassage(text: string): Promise<{ issues: PassageIssue[] }> {
  const body = new FormData();
  body.append("text", text);
  return parseResponse<{ issues: PassageIssue[] }>(
    await fetch("/api/passage-check", {
      method: "POST",
      body
    })
  );
}
