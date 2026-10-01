import { beforeEach, describe, expect, test, vi } from "vitest";

const mock = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: unknown) => void),
  session: null as null | { access_token: string; user: { id: string } },
  createClient: vi.fn(),
  getSession: vi.fn()
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.createClient }));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  mock.session = { access_token: "supabase-token", user: { id: "account-a" } };
  mock.getSession.mockImplementation(async () => ({ data: { session: mock.session } }));
  mock.createClient.mockReturnValue({ auth: {
    getSession: mock.getSession,
    onAuthStateChange: (callback: typeof mock.callback) => { mock.callback = callback; }
  } });
});

describe("account API authentication", () => {
  test("uses PKCE and only the current Supabase token in a header", async () => {
    const { configureAuth, accountFetch } = await import("./auth");
    configureAuth("https://example.supabase.co", "sb_publishable_safe");
    mock.callback?.("SIGNED_IN", mock.session);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const response = await accountFetch("/api/me/quota", { headers: { Authorization: "Bearer stale-token" } });
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/me/quota");
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer supabase-token");
    expect(mock.createClient.mock.lastCall?.[2].auth.flowType).toBe("pkce");
  });

  test("logout removes authorization instead of falling back to a cookie or static token", async () => {
    const { configureAuth, accountFetch } = await import("./auth");
    configureAuth("https://example.supabase.co", "sb_publishable_safe");
    mock.callback?.("SIGNED_IN", mock.session);
    mock.session = null;
    mock.callback?.("SIGNED_OUT", null);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await accountFetch("/api/score", { headers: { Authorization: "Bearer old-local-token" } });
    expect(fetchMock.mock.calls[0][1].headers.has("Authorization")).toBe(false);
  });

  test("logout aborts an in-flight upload or export and discards its response", async () => {
    const { configureAuth, accountFetch } = await import("./auth");
    configureAuth("https://example.supabase.co", "sb_publishable_safe");
    mock.callback?.("SIGNED_IN", mock.session);
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = accountFetch("/api/export");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    mock.session = null;
    mock.callback?.("SIGNED_OUT", null);
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    resolve(new Response('{"private":true}'));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("changing accounts rejects a response even when fetch completed", async () => {
    const { configureAuth, accountFetch } = await import("./auth");
    configureAuth("https://example.supabase.co", "sb_publishable_safe");
    mock.callback?.("SIGNED_IN", mock.session);
    let resolve!: (value: ArrayBuffer) => void;
    const response = new Response("private");
    vi.spyOn(response, "arrayBuffer").mockImplementation(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const pending = accountFetch("/api/speak");
    await vi.waitFor(() => expect(resolve).toBeDefined());
    mock.session = { access_token: "new-token", user: { id: "account-b" } };
    mock.callback?.("SIGNED_IN", mock.session);
    resolve(new ArrayBuffer(0));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
