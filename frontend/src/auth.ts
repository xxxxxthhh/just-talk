import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let accountId: string | null = null;
let epoch = 0;
const requests = new Set<AbortController>();

export function configureAuth(url: string, key: string): SupabaseClient {
  if (!client) {
    client = createClient(url, key, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
    });
    client.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? null;
      if (nextId !== accountId) {
        accountId = nextId;
        epoch += 1;
        for (const controller of requests) controller.abort();
        requests.clear();
      }
    });
  }
  return client;
}

export function authClient(): SupabaseClient | null { return client; }
export function accountEpoch(): number { return epoch; }

export async function accountFetch(url: string, init?: RequestInit): Promise<Response> {
  const currentEpoch = epoch;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  init?.signal?.addEventListener("abort", onAbort, { once: true });
  if (init?.signal?.aborted) controller.abort();
  requests.add(controller);
  try {
    const session = client ? (await client.auth.getSession()).data.session : null;
    if (currentEpoch !== epoch) throw new DOMException("Account changed", "AbortError");
    const headers = new Headers(init?.headers);
    headers.delete("Authorization");
    if (session) headers.set("Authorization", `Bearer ${session.access_token}`);
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    // Consume while abortable; detached callers must never finish a download
    // or recreate private state after logout/account change.
    const body = await response.arrayBuffer();
    if (currentEpoch !== epoch) throw new DOMException("Account changed", "AbortError");
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    requests.delete(controller);
    init?.signal?.removeEventListener("abort", onAbort);
  }
}
