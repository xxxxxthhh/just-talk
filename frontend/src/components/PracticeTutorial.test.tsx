import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { TutorialHelp, TutorialProvider } from "./PracticeTutorial";
import { fetchTutorial, finishTutorial } from "../api";
vi.mock("../api", () => ({ fetchTutorial: vi.fn(), finishTutorial: vi.fn() }));
beforeEach(() => {
  vi.mocked(fetchTutorial).mockResolvedValue({ completed_version: 0 });
  vi.mocked(finishTutorial).mockResolvedValue({ completed_version: 1 });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
function Fixture({ account = "a", mobile = false }: { account?: string; mobile?: boolean }) {
  return <TutorialProvider key={account}><TutorialHelp /><div className={mobile ? "m-app" : ""}>
    <section data-tutorial="practice"><button data-tutorial="listen">Play</button><button data-tutorial="record">Record</button><button data-tutorial="score" disabled>Score</button></section>
    <section data-tutorial="feedback">No results yet</section>
  </div></TutorialProvider>;
}
test("first visit can skip, reopen, go back and complete without practice actions", async () => {
  const calls = vi.fn(); window.addEventListener("keydown", calls);
  render(<Fixture />);
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "跳过" }));
  await waitFor(() => expect(finishTutorial).toHaveBeenCalledWith(1));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "使用引导" }));
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByRole("heading", { name: "先听示范，再跟读" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
  expect(calls).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "上一步" }));
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByText(/现在没有结果也没关系/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "开始练习" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  window.removeEventListener("keydown", calls);
});
test("completed account does not auto-open; another account has separate state", async () => {
  vi.mocked(fetchTutorial).mockResolvedValueOnce({ completed_version: 1 });
  const view = render(<Fixture />);
  await waitFor(() => expect(fetchTutorial).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.rerender(<Fixture account="b" />);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
test("late preference response from previous account cannot open next account", async () => {
  let resolve!: (value: { completed_version: number }) => void;
  vi.mocked(fetchTutorial).mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValueOnce({ completed_version: 1 });
  const view = render(<Fixture />); view.rerender(<Fixture account="b" />);
  await act(async () => { resolve({ completed_version: 0 }); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
test("mobile explains the result entry honestly and missing targets have a fallback", async () => {
  render(<Fixture mobile />); await screen.findByRole("dialog");
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByText(/点它打开详情/)).toBeInTheDocument();
  expect(screen.getByText(/当前页面未显示/)).toBeInTheDocument();
});
test("failed save is recoverable without forcing tutorial to remain open", async () => {
  vi.mocked(finishTutorial).mockRejectedValueOnce(new Error("offline"));
  render(<Fixture />); await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "关闭引导" }));
  expect(await screen.findByRole("status")).toHaveTextContent("引导偏好未保存");
  fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
});
