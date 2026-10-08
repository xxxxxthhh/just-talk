import { useRef, useState } from "react";

// Play again from a finished run's Summary or Review. It lives in the screen that owns both
// surfaces, so a failure still shows after Summary gives way to Review while the deck loads. The
// finished run stays on screen until the new deck is ready; a start that can't be built leaves the
// results in place with a retryable error.
export function useReplay(start: () => Promise<void>, runId: string | null) {
  const attempt = useRef(0);
  // The run whose replay failed; cleared by a new replay or by leaving.
  const [failedFor, setFailedFor] = useState<string | null>(null);

  const playAgain = () => {
    const id = ++attempt.current;
    setFailedFor(null);
    // Called within the tap, so the controller unlocks run audio inside the gesture.
    Promise.resolve(start()).catch(() => {
      // An abandoned or superseded replay's late failure says nothing.
      if (attempt.current === id) setFailedFor(runId);
    });
  };

  // Done or exit: forget any replay in flight and its error.
  const abandon = () => {
    attempt.current += 1;
    setFailedFor(null);
  };

  // A successful replacement is a different run, so the old error no longer applies.
  return { failed: failedFor !== null && failedFor === runId, playAgain, abandon };
}

export const REPLAY_FAILED = "Couldn't start a new run. Your results are still here. Try again.";
