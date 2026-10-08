import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useReplay, type RestartActions } from "./useReplay";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// One owner above Summary and Review, as PracticeScreen mounts it.
function owner(actions: RestartActions, runId = "run-1") {
  return renderHook(({ id }) => useReplay(actions, id), { initialProps: { id: runId as string | null } });
}

describe("useReplay", () => {
  it("next_sound_retry_repeats_destination", async () => {
    const playAgain = vi.fn(async () => {});
    const nextSound = vi.fn(async () => {
      throw new Error("no deck");
    });
    const hook = owner({ "play-again": playAgain, "next-sound": nextSound, "revisit-words": async () => {} });

    await act(async () => hook.result.current.restart("next-sound"));
    expect(hook.result.current.failedAction).toBe("next-sound");
    expect(hook.result.current.failed).toBe(true);

    // Retry repeats Next sound, never Play again; the finished run still decides the sound.
    await act(async () => hook.result.current.retry());
    expect(nextSound).toHaveBeenCalledTimes(2);
    expect(playAgain).not.toHaveBeenCalled();
    expect(hook.result.current.failedAction).toBe("next-sound");
  });

  it("restart_failure_survives_summary_to_review", async () => {
    const gate = deferred();
    const hook = owner({ "play-again": () => gate.promise, "next-sound": async () => {}, "revisit-words": async () => {} });

    act(() => hook.result.current.restart("play-again"));
    expect(hook.result.current.pendingAction).toBe("play-again");
    // Summary gives way to Review while the deck loads: the owner and its run are the same.
    hook.rerender({ id: "run-1" });
    await act(async () => gate.reject(new Error("no deck")));
    expect(hook.result.current.failedAction).toBe("play-again");
    expect(hook.result.current.pendingAction).toBeNull();
    hook.rerender({ id: "run-1" });
    expect(hook.result.current.failed).toBe(true);

    // A successful replacement is a different run; the old error no longer applies.
    hook.rerender({ id: "run-2" });
    expect(hook.result.current.failed).toBe(false);
  });

  it("abandoned_or_older_restart_cannot_set_error", async () => {
    const first = deferred();
    const second = deferred();
    const calls = [first, second];
    const hook = owner({
      "play-again": () => calls.shift()!.promise,
      "next-sound": async () => {},
      "revisit-words": async () => {}
    });

    act(() => hook.result.current.restart("play-again"));
    act(() => hook.result.current.restart("play-again"));
    // The superseded attempt's late failure says nothing about the newer one.
    await act(async () => first.reject(new Error("old")));
    expect(hook.result.current.failed).toBe(false);
    expect(hook.result.current.pendingAction).toBe("play-again");

    // Done abandons the newer one too: its failure is ignored and nothing is pending.
    act(() => hook.result.current.abandon());
    expect(hook.result.current.pendingAction).toBeNull();
    await act(async () => second.reject(new Error("late")));
    expect(hook.result.current.failed).toBe(false);
    expect(hook.result.current.failedAction).toBeNull();
  });

  it("revisit_failure_keeps_its_reason_and_retry_keeps_action", async () => {
    const revisit = vi.fn(async () => {
      throw new Error("Need 12 active words · 9 available");
    });
    const playAgain = vi.fn(async () => {});
    const hook = owner({ "play-again": playAgain, "next-sound": async () => {}, "revisit-words": revisit });

    await act(async () => hook.result.current.restart("revisit-words"));
    expect(hook.result.current.failedAction).toBe("revisit-words");
    expect(hook.result.current.failureMessage).toBe("Need 12 active words · 9 available");
    await act(async () => hook.result.current.retry());
    expect(revisit).toHaveBeenCalledTimes(2);
    expect(playAgain).not.toHaveBeenCalled();
    // A newer action replaces the old error.
    await act(async () => hook.result.current.restart("play-again"));
    expect(hook.result.current.failedAction).toBeNull();
    expect(hook.result.current.failureMessage).toBeNull();
  });
});
