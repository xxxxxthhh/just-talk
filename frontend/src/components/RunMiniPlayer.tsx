import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import type { SpeechStatus } from "../hooks/useSpeech";
import type { RunPrompt } from "../types";

// The reference voice as the shared speech service reports it.
export type CoachPlayback = Readonly<{ text: string; status: SpeechStatus }>;

export type YouTake = Readonly<{ attemptId: string; label: string; url: string | null }>;

type YouState = { attemptId: string | null; status: "idle" | "playing" | "error" };

export type YouPlayer = Readonly<{
  attemptId: string | null;
  status: YouState["status"];
  // While the run is paused nothing plays; buttons stay visible but disabled.
  paused: boolean;
  play: (attemptId: string, url: string) => void;
  stop: () => void;
}>;

// One audio element for every recording in the review. Starting it stops the Coach first; a
// play() that settles after a newer request (or a stop) never changes what is shown; and a Coach
// load that lands while You plays is stopped rather than mixed in.
export function useYouPlayer(
  coach: CoachPlayback,
  stopCoach: () => void,
  paused: boolean
): [YouPlayer, ReactElement] {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const request = useRef(0);
  const pausedRef = useRef(paused);
  const [state, setState] = useState<YouState>({ attemptId: null, status: "idle" });

  const stop = useCallback(() => {
    request.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    setState({ attemptId: null, status: "idle" });
  }, []);

  const play = useCallback(
    (attemptId: string, url: string) => {
      if (pausedRef.current) return;
      stopCoach();
      const audio = audioRef.current;
      if (!audio) return;
      const id = ++request.current;
      audio.pause();
      audio.src = url;
      setState({ attemptId, status: "playing" });
      const failed = () => {
        if (request.current === id) setState({ attemptId, status: "error" });
      };
      try {
        void audio.play()?.catch(failed);
      } catch {
        failed();
      }
    },
    [stopCoach]
  );

  // Pausing the run silences both voices and invalidates a play() still pending; resuming never
  // replays on its own.
  const stopCoachRef = useRef(stopCoach);
  useEffect(() => {
    stopCoachRef.current = stopCoach;
  }, [stopCoach]);
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) return;
    stop();
    stopCoachRef.current();
  }, [paused, stop]);

  const youPlaying = state.status === "playing";
  useEffect(() => {
    if (coach.status === "playing" && youPlaying) stopCoach();
  }, [coach.status, youPlaying, stopCoach]);

  // Leaving the review silences the recording; the controller still owns and releases its URL.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      request.current += 1;
      audio?.pause();
      audio?.removeAttribute("src");
    };
  }, []);

  const current = state.attemptId;
  const element = (
    <audio
      ref={audioRef}
      preload="none"
      hidden
      onEnded={() => {
        if (current !== null) setState({ attemptId: null, status: "idle" });
      }}
      onError={() => {
        if (current !== null && state.status === "playing") setState({ attemptId: current, status: "error" });
      }}
    />
  );
  return [{ attemptId: current, status: state.status, paused, play, stop }, element];
}

export function coachIsActive(coach: CoachPlayback, prompt: RunPrompt): boolean {
  if (coach.status !== "loading" && coach.status !== "playing") return false;
  return coach.text.trim().toLocaleLowerCase() === prompt.text.trim().toLocaleLowerCase();
}

type RunMiniPlayerProps = {
  player: YouPlayer;
  takes: readonly YouTake[];
  // Whose take this is, for button names: "these", "birds".
  subject: string;
  coachPrompt: RunPrompt;
  coach: CoachPlayback;
  onPlayCoach: (prompt: RunPrompt) => void;
  onStopCoach: () => void;
  compact?: boolean;
};

export function RunMiniPlayer({
  player,
  takes,
  subject,
  coachPrompt,
  coach,
  onPlayCoach,
  onStopCoach,
  compact = false
}: RunMiniPlayerProps) {
  const playable = takes.filter((take) => take.url !== null);
  const [selectedId, setSelectedId] = useState<string | null>(playable[playable.length - 1]?.attemptId ?? null);
  const selected = playable.find((take) => take.attemptId === selectedId) ?? playable[playable.length - 1] ?? null;
  const youPlaying = selected !== null && player.attemptId === selected.attemptId && player.status === "playing";
  const youFailed = selected !== null && player.attemptId === selected.attemptId && player.status === "error";
  const coachActive = coachIsActive(coach, coachPrompt);

  const toggleYou = () => {
    if (!selected?.url) return;
    if (youPlaying) player.stop();
    else player.play(selected.attemptId, selected.url);
  };

  const toggleCoach = () => {
    if (player.paused) return;
    if (coachActive) {
      onStopCoach();
      return;
    }
    player.stop();
    onPlayCoach(coachPrompt);
  };

  // Changing take silences both voices, including a Coach still loading, until asked again.
  const chooseTake = (attemptId: string) => {
    if (attemptId === selected?.attemptId) return;
    if (player.attemptId !== null) player.stop();
    if (coachActive) onStopCoach();
    setSelectedId(attemptId);
  };

  return (
    <div className={`run-mini-player${compact ? " is-compact" : ""}`}>
      {playable.length > 1 ? (
        <div className="run-take-picker" role="group" aria-label={`Takes of ${subject}`}>
          {playable.map((take) => (
            <button
              key={take.attemptId}
              type="button"
              className="run-take"
              aria-pressed={take.attemptId === selected?.attemptId}
              disabled={player.paused}
              onClick={() => chooseTake(take.attemptId)}
            >
              {take.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="run-mini-buttons">
        {selected ? (
          <button
            type="button"
            className={`run-mini-button is-you${youPlaying ? " is-playing" : ""}`}
            disabled={player.paused}
            aria-label={`${youPlaying ? "Stop" : "Play"} your take of ${subject}${playable.length > 1 ? `, ${selected.label}` : ""}`}
            onClick={toggleYou}
          >
            <span className="run-mini-icon" aria-hidden="true">
              {youPlaying ? "■" : "▶"}
            </span>
            <span className="run-mini-text">
              <span className="run-mini-name">You</span>
              {!compact ? <span className="run-mini-meta">{playable.length > 1 ? selected.label : "your take"}</span> : null}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className={`run-mini-button is-coach${coachActive ? " is-playing" : ""}`}
          disabled={player.paused}
          aria-label={`${coachActive ? "Stop" : "Play"} coach reference of ${coachPrompt.text}`}
          onClick={toggleCoach}
        >
          <span className="run-mini-icon" aria-hidden="true">
            {coachActive ? "■" : "▶"}
          </span>
          <span className="run-mini-text">
            <span className="run-mini-name">Coach</span>
            {!compact ? (
              <span className="run-mini-meta">{coachActive && coach.status === "loading" ? "loading…" : "reference"}</span>
            ) : null}
          </span>
        </button>
      </div>
      {youFailed ? <p className="run-mini-error">Couldn't play that recording. Its score is unchanged.</p> : null}
    </div>
  );
}
