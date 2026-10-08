import { useRef, useState } from "react";

// The restarts a finished run's Summary and Review offer. Next sound is starter Route only;
// revisit-words starts My words from the finished run's first readings below 85.
export type RestartKind = "play-again" | "next-sound" | "revisit-words";
export type RestartActions = Readonly<Record<RestartKind, () => Promise<void>>>;

// A restart from a finished run's Summary or Review. It lives in the screen that owns both
// surfaces, so a failure still shows after Summary gives way to Review while the deck loads. The
// finished run stays on screen until the new deck is ready; a start that can't be built leaves the
// results in place with a retryable error that names the action that failed.
export function useReplay(actions: RestartActions, runId: string | null) {
  const attempt = useRef(0);
  // The latest restart still in flight, so its own button can say Starting….
  const [pending, setPending] = useState<{ id: number; kind: RestartKind } | null>(null);
  // The run whose restart failed, and which restart it was; cleared by a new restart or by leaving.
  const [failure, setFailure] = useState<{ runId: string | null; kind: RestartKind; message: string } | null>(null);

  const restart = (kind: RestartKind) => {
    const id = ++attempt.current;
    const failedFor = runId;
    setFailure(null);
    setPending({ id, kind });
    // Called within the tap, so the controller unlocks run audio inside the gesture.
    Promise.resolve(actions[kind]()).then(
      () => {
        if (attempt.current === id) setPending(null);
      },
      (error: unknown) => {
        // An abandoned or superseded restart's late failure says nothing.
        if (attempt.current !== id) return;
        setPending(null);
        setFailure({ runId: failedFor, kind, message: error instanceof Error ? error.message : "" });
      }
    );
  };

  // Done or exit: forget any restart in flight and its error.
  const abandon = () => {
    attempt.current += 1;
    setPending(null);
    setFailure(null);
  };

  // A successful replacement is a different run, so the old error no longer applies.
  const current = failure !== null && failure.runId === runId ? failure : null;
  const failedAction = current?.kind ?? null;
  return {
    failed: failedAction !== null,
    failedAction,
    // The controller's own reason, such as a word-bank shortage; empty when it gave none.
    failureMessage: current?.message ?? null,
    pendingAction: pending?.kind ?? null,
    restart,
    // Repeats the failed action; Next sound keeps its destination because the finished run does.
    retry: () => {
      if (failedAction) restart(failedAction);
    },
    abandon
  };
}

export const REPLAY_FAILED = "Couldn't start a new run. Your results are still here. Try again.";

// A My words Play again rebuilds from the fresh bank, so its shortage reason tells the learner what to
// change; starter runs keep the generic line.
export function playAgainFailed(reason: string | null): string {
  return reason ? `Couldn't start a new run. ${reason} Your results are still here.` : REPLAY_FAILED;
}

export function nextSoundFailed(phoneme: string): string {
  return `Couldn't start /${phoneme}/. Your results are still here.`;
}

export function revisitWordsFailed(reason: string | null): string {
  return `Couldn't start the revisit run.${reason ? ` ${reason}` : ""} Your results are still here.`;
}
