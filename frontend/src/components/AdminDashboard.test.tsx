import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApiError, fetchAdminUsers, type AdminSummary } from "../api";
import { authClient } from "../auth";
import AdminDashboard from "./AdminDashboard";

vi.mock("../api", async (original) => ({ ...await original<typeof import("../api")>(), fetchAdminUsers: vi.fn() }));
vi.mock("../auth", () => ({ authClient: vi.fn() }));

const usage = {
  scored_audio_ms: 1250, measured_score_requests: 1, unmeasured_score_requests: 0,
  score_attempts: 2, quota_score_seconds: 4, tts_characters: 100, tts_attempts: 1
};
const fixture: AdminSummary = {
  generated_at: "2026-10-07T10:00:00Z", timezone: "UTC", retention_days: 70,
  audio_tracking_since: "2026-10-07T00:00:00Z", oldest_usage_at: "2026-10-01T10:00:00Z",
  users: [{ account_id: "00000000-0000-4000-8000-000000000001", email: "friend@example.test",
    registered_at: "2026-10-01T09:00:00Z", first_seen_at: "2026-10-01T10:00:00Z",
    last_active_at: "2026-10-07T10:00:00Z", last_7_days: usage, this_month: usage,
    retained: { ...usage, scored_audio_ms: null, measured_score_requests: 0, unmeasured_score_requests: 2 } }]
};

beforeEach(() => {
  vi.mocked(fetchAdminUsers).mockResolvedValue(fixture);
});
afterEach(() => { vi.clearAllMocks(); });

test("shows aggregate metrics and distinguishes missing duration, quota and site time", async () => {
  render(<AdminDashboard />);
  expect(await screen.findByText("friend@example.test")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Quota charged" })).toBeInTheDocument();
  expect(screen.getByText(/not time on site/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "retained" } });
  expect(screen.getAllByText("Not tracked")).toHaveLength(2);
  expect(screen.getByText("2 earlier requests not measured")).toBeInTheDocument();
  expect(screen.queryByRole("audio")).not.toBeInTheDocument();
});

test.each([401, 403])("denies %s without showing any users", async (status) => {
  vi.mocked(fetchAdminUsers).mockRejectedValue(new ApiError("Denied", status));
  render(<AdminDashboard />);
  expect(await screen.findByText("Access restricted")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText("friend@example.test")).not.toBeInTheDocument();
});

test("clears existing private rows when refresh loses permission", async () => {
  render(<AdminDashboard />);
  await screen.findByText("friend@example.test");
  vi.mocked(fetchAdminUsers).mockRejectedValue(new ApiError("Denied", 403));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(screen.queryByText("friend@example.test")).not.toBeInTheDocument();
  expect(await screen.findByText("Access restricted")).toBeInTheDocument();
});

test("aborts pending fetch on unmount and ignores late data", async () => {
  let resolve: (value: AdminSummary) => void = () => {};
  vi.mocked(fetchAdminUsers).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const view = render(<AdminDashboard />);
  const signal = vi.mocked(fetchAdminUsers).mock.calls[0][0];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { resolve(fixture); });
  expect(screen.queryByText("friend@example.test")).not.toBeInTheDocument();
});

test("signing out removes the summary immediately", async () => {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  vi.mocked(authClient).mockReturnValue({ auth: { signOut } } as unknown as NonNullable<ReturnType<typeof authClient>>);
  render(<AdminDashboard />);
  await screen.findByText("friend@example.test");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(screen.queryByText("friend@example.test")).not.toBeInTheDocument();
  await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: "local" }));
});

test("empty usage states no users without implying complete lifetime coverage", async () => {
  vi.mocked(fetchAdminUsers).mockResolvedValue({ ...fixture, users: [] });
  render(<AdminDashboard />);
  expect(await screen.findByText("No app users recorded yet.")).toBeInTheDocument();
  expect(screen.getByText(/not a lifetime total/)).toBeInTheDocument();
});
