import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { checkHealth, fetchAdminAccess, fetchQuota } from "../api";
import PublicGate from "./PublicGate";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../api", async (original) => ({ ...await original<typeof import("../api")>(),
  checkHealth: vi.fn(), fetchAdminAccess: vi.fn(), fetchQuota: vi.fn() }));
vi.mock("../auth", () => {
  const client = { auth: { getSession,
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } };
  return { authClient: () => client, configureAuth: () => client };
});

beforeEach(() => {
  window.history.replaceState({}, "", "/admin");
  vi.mocked(checkHealth).mockResolvedValue({ ok: true, public: { auth: {
    url: "https://example.supabase.co", publishable_key: "sb_publishable_test"
  } } } as unknown as Awaited<ReturnType<typeof checkHealth>>);
  getSession.mockResolvedValue({ data: { session: { user: { id: "owner" } } } });
});
afterEach(() => { window.history.replaceState({}, "", "/"); vi.clearAllMocks(); });

test("ordinary user cannot mount the admin screen or load practice data", async () => {
  vi.mocked(fetchAdminAccess).mockResolvedValue({ admin: false });
  render(<PublicGate><div>PRIVATE ADMIN SCREEN</div></PublicGate>);
  expect(await screen.findByText("Owner access required")).toBeInTheDocument();
  expect(screen.queryByText("PRIVATE ADMIN SCREEN")).not.toBeInTheDocument();
  expect(fetchQuota).not.toHaveBeenCalled();
});

test("approved owner mounts admin without loading quota or tutorial", async () => {
  vi.mocked(fetchAdminAccess).mockResolvedValue({ admin: true });
  render(<PublicGate><div>ADMIN SCREEN</div></PublicGate>);
  expect(await screen.findByText("ADMIN SCREEN")).toBeInTheDocument();
  expect(fetchQuota).not.toHaveBeenCalled();
});

test("missing session shows sign in and never requests admin access", async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  render(<PublicGate><div>ADMIN SCREEN</div></PublicGate>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument());
  expect(fetchAdminAccess).not.toHaveBeenCalled();
  expect(screen.queryByText("ADMIN SCREEN")).not.toBeInTheDocument();
});
