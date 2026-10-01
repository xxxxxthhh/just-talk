import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import PublicGate from "./PublicGate";

const mock = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  callback: null as null | ((event: string, session: unknown) => void),
  signIn: vi.fn(), signOut: vi.fn(), quota: vi.fn(), health: vi.fn()
}));
vi.mock("../auth", () => {
  const client = { auth: {
    getSession: async () => ({ data: { session: mock.session } }),
    onAuthStateChange: (callback: typeof mock.callback) => {
      mock.callback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } };
    }, signInWithOAuth: mock.signIn, signOut: mock.signOut
  } };
  return { authClient: () => client, configureAuth: () => client };
});
vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {}, checkHealth: mock.health,
  fetchQuota: mock.quota, deleteMyData: vi.fn(),
  fetchTutorial: vi.fn().mockResolvedValue({ completed_version: 1 }),
  finishTutorial: vi.fn().mockResolvedValue({ completed_version: 1 })
}));

beforeEach(() => {
  mock.session = null;
  mock.signIn.mockResolvedValue({ error: null });
  mock.signOut.mockImplementation(async () => {
    mock.session = null; mock.callback?.("SIGNED_OUT", null); return { error: null };
  });
  mock.quota.mockResolvedValue(null);
  mock.health.mockResolvedValue({ public: { auth: { url: "https://example.supabase.co", publishable_key: "sb_publishable_safe" }, visitor_ttl_days: 7 } });
});

test("offers Google only and uses a fixed same-origin redirect", async () => {
  render(<PublicGate><p>private practice</p></PublicGate>);
  fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
  expect(mock.signIn).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: "select_account" } } });
  expect(screen.queryByText("private practice")).not.toBeInTheDocument();
});

test("shows a recoverable Google sign-in failure", async () => {
  mock.signIn.mockResolvedValue({ error: { message: "Google sign-in cancelled" } });
  render(<PublicGate><p>private practice</p></PublicGate>);
  fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Google sign-in cancelled");
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

test("unmounts private practice on logout and rechecks the next account", async () => {
  mock.session = { user: { id: "account-a" } };
  const cleanup = vi.fn();
  const { useEffect } = await import("react");
  function Practice() { useEffect(() => cleanup, []); return <p>private practice</p>; }
  render(<PublicGate><Practice /></PublicGate>);
  expect(await screen.findByText("private practice")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeEnabled();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(screen.queryByText("private practice")).not.toBeInTheDocument();
  await act(async () => {
    mock.session = { user: { id: "account-b" } }; mock.callback?.("SIGNED_IN", mock.session);
  });
  await waitFor(() => expect(screen.getByText("private practice")).toBeInTheDocument());
});

test("disables sign-in while provider setup is missing", async () => {
  mock.health.mockResolvedValue({ public: { auth: null } });
  render(<PublicGate><p>private practice</p></PublicGate>);
  expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeDisabled();
  expect(screen.getByText(/sign-in is being set up/)).toBeInTheDocument();
});

test("recovers from an expired-token rejection when the same account refreshes", async () => {
  const { VISITOR_REQUIRED_EVENT } = await import("../publicMode");
  mock.session = { user: { id: "account-a" } };
  render(<PublicGate><p>private practice</p></PublicGate>);
  expect(await screen.findByText("private practice")).toBeInTheDocument();
  await act(async () => { mock.callback?.("INITIAL_SESSION", mock.session); });
  await screen.findByText("private practice");
  act(() => { window.dispatchEvent(new Event(VISITOR_REQUIRED_EVENT)); });
  expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeEnabled();
  expect(screen.queryByText("private practice")).not.toBeInTheDocument();
  await act(async () => { mock.callback?.("TOKEN_REFRESHED", mock.session); });
  expect(await screen.findByText("private practice")).toBeInTheDocument();
});

test("focus sign-in and token refresh keep an authenticated practice mounted", async () => {
  mock.session = { user: { id: "account-a" } };
  const cleanup = vi.fn();
  const { useEffect } = await import("react");
  function Practice() { useEffect(() => cleanup, []); return <p>private practice</p>; }
  render(<PublicGate><Practice /></PublicGate>);
  await screen.findByText("private practice");
  await act(async () => { mock.callback?.("INITIAL_SESSION", mock.session); });
  await screen.findByText("private practice");
  cleanup.mockClear();
  await act(async () => {
    mock.callback?.("SIGNED_IN", mock.session);
    mock.callback?.("TOKEN_REFRESHED", mock.session);
  });
  expect(screen.getByText("private practice")).toBeInTheDocument();
  expect(cleanup).not.toHaveBeenCalled();
});
