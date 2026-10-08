import { useState } from "react";

// Play again from a finished run's Summary or Review. The finished run stays on screen until the
// new deck is ready; a start that fails says so on that surface and leaves the results in place.
export function useReplay(onPlayAgain: () => Promise<void>): { failed: boolean; playAgain: () => void } {
  const [failed, setFailed] = useState(false);
  const playAgain = () => {
    setFailed(false);
    // Called within the tap, so the controller unlocks run audio inside the gesture.
    Promise.resolve(onPlayAgain()).catch(() => setFailed(true));
  };
  return { failed, playAgain };
}

export const REPLAY_FAILED = "Couldn't start a new run. Your results are still here. Try again.";
