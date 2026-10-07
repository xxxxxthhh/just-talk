import { accountEpoch, accountFetch } from "./auth";
import type {
  ActivityStats,
  Health,
  MaterialItem,
  MaterialPackImportPayload,
  MaterialPackImportResponse,
  PassageIssue,
  PhonemeStat,
  PracticeSession,
  QuotaStatus,
  ScoreResponse,
  SpeechResponse,
  VocabularyItem
} from "./types";
import { PUBLIC_MODE, USAGE_CHANGED_EVENT, VISITOR_REQUIRED_EVENT } from "./publicMode";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiUrl(path: string): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  return baseUrl ? `${baseUrl.replace(/\/+$/, "")}${path}` : path;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (PUBLIC_MODE) return accountFetch(apiUrl(path), init);
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
    const code = typeof payload.code === "string" ? payload.code : undefined;
    if (PUBLIC_MODE && code === "auth_required") {
      window.dispatchEvent(new Event(VISITOR_REQUIRED_EVENT));
    }
    throw new ApiError(detail, response.status, code);
  }
  return payload as T;
}

function notifyUsageChanged() {
  if (PUBLIC_MODE) {
    window.dispatchEvent(new Event(USAGE_CHANGED_EVENT));
  }
}

export async function downloadBackup(): Promise<void> {
  const epoch = accountEpoch();
  const response = await apiFetch("/api/export");
  if (!response.ok) { await parseResponse(response); return; }
  const blob = await response.blob();
  if (PUBLIC_MODE && epoch !== accountEpoch()) throw new DOMException("Account changed", "AbortError");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "just-talk-export.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function fetchQuota(): Promise<QuotaStatus> {
  return parseResponse<QuotaStatus>(await apiFetch("/api/me/quota"));
}

export type AdminUsage = {
  scored_audio_ms: number | null;
  measured_score_requests: number;
  unmeasured_score_requests: number;
  score_attempts: number;
  quota_score_seconds: number;
  tts_characters: number;
  tts_attempts: number;
};

export type AdminUser = {
  account_id: string;
  email: string | null;
  registered_at: string | null;
  first_seen_at: string | null;
  last_active_at: string | null;
  retained: AdminUsage;
  last_7_days: AdminUsage;
  this_month: AdminUsage;
};

export type AdminSummary = {
  generated_at: string;
  timezone: string;
  retention_days: number;
  audio_tracking_since: string;
  oldest_usage_at: string | null;
  users: AdminUser[];
};

export async function fetchAdminAccess(): Promise<{ admin: boolean }> {
  return parseResponse(await apiFetch("/api/me/access"));
}

export async function fetchAdminUsers(signal?: AbortSignal): Promise<AdminSummary> {
  return parseResponse(await apiFetch("/api/admin/users", { signal }));
}

export async function fetchTutorial(): Promise<{ completed_version: number }> {
  return parseResponse(await apiFetch("/api/me/tutorial"));
}

export async function finishTutorial(version: number): Promise<{ completed_version: number }> {
  return parseResponse(await apiFetch("/api/me/tutorial", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version })
  }));
}

export async function deleteMyData(): Promise<{ deleted: boolean }> {
  return parseResponse<{ deleted: boolean }>(await apiFetch("/api/me", { method: "DELETE" }));
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
  try {
    return await parseResponse<ScoreResponse>(
      await apiFetch("/api/score", {
        method: "POST",
        body
      })
    );
  } finally {
    notifyUsageChanged();
  }
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
  try {
    return await parseResponse<SpeechResponse>(
      await apiFetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
    );
  } finally {
    notifyUsageChanged();
  }
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
