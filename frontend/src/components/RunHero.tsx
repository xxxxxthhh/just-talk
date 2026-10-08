import { useEffect, useState } from "react";

import { fetchPhonemeStats } from "../api";
import "../game/game.css";
import { readBest } from "../game/personalBest";
import type { RunPreferences } from "../game/preferences";
import { chooseFocusPhoneme } from "../game/runDeck";
import { RUN_RULES_VERSION } from "../game/scoring";
import { STARTER_PACK } from "../game/starterPack";
import type { PhonemeStat, RunMode } from "../types";
import { RunStonePlaceholders } from "./RunStones";

const MODES: readonly { mode: RunMode; name: string; line: string }[] = [
  { mode: "route", name: "Route", line: "Six items, no hearts" },
  { mode: "challenge", name: "Challenge", line: "Two hearts · aim for S" }
];

type RunHeroProps = {
  // False while an ordinary take is recording or scoring, or a drill is generating.
  canStart: boolean;
  // The controller's accepted start, until its deck is ready or abandoned.
  starting: boolean;
  preferences: RunPreferences;
  onSetPreference: (name: keyof RunPreferences, value: boolean) => void;
  onStart: (mode: RunMode) => Promise<void>;
  // Public mode only; null hides the usage line.
  scoresLeft: number | null;
};

// The run's entry card. The sound it previews comes from the same stats and rule the run uses
// to freeze its focus, so the Best shown here is the bucket the run will be compared with.
export function RunHero({ canStart, starting, preferences, onSetPreference, onStart, scoresLeft }: RunHeroProps) {
  const [mode, setMode] = useState<RunMode>("route");
  const [stats, setStats] = useState<readonly PhonemeStat[] | null>(null);
  const [startError, setStartError] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPhonemeStats().then(
      (loaded) => active && setStats(loaded),
      () => active && setStats([])
    );
    return () => {
      active = false;
    };
  }, []);

  const focus = stats ? chooseFocusPhoneme(stats) : null;
  const examples = focus
    ? STARTER_PACK.filter((item) => item.phoneme === focus && item.stage === "focus").map((item) => item.targetWord)
    : [];
  const best = focus ? readBest({ mode, focus, rulesVersion: RUN_RULES_VERSION }) : null;
  const modeName = mode === "challenge" ? "Challenge" : "Route";

  // The start itself runs in this tap, so run audio is unlocked inside the gesture.
  const start = () => {
    setStartError(false);
    onStart(mode).catch(() => setStartError(true));
  };

  return (
    <section className="run-hero" aria-labelledby="run-hero-sound">
      <div className="run-hero-head">
        <div className="run-hero-sound">
          <span id="run-hero-sound" className="run-hero-kicker">
            This run's sound
          </span>
          <span className="run-hero-ipa">{focus ? `/${focus}/` : "…"}</span>
          {examples.length ? (
            <span className="run-hero-examples">
              as in{" "}
              {examples.slice(0, 2).map((word, index) => (
                <span key={word}>
                  {index ? ", " : ""}
                  <b>{word}</b>
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      <RunStonePlaceholders highlight="focus" />

      <div className="run-hero-best">
        <span className="run-hero-best-label">
          Best{focus ? ` · /${focus}/` : ""} · {modeName}
        </span>
        {best ? (
          <span className="run-hero-best-value">
            <span className="run-hero-best-points">{best.points}</span>
            <span className="run-hero-best-rating" data-rating={best.rating}>
              {best.rating}
            </span>
          </span>
        ) : (
          <span className="run-hero-best-none">{focus ? "No best yet" : "—"}</span>
        )}
      </div>

      <div className="run-hero-modes" role="radiogroup" aria-label="Run type">
        {MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={mode === option.mode}
            className="run-hero-mode"
            onClick={() => setMode(option.mode)}
          >
            <span className="run-hero-mode-name">
              {option.name}
              {option.mode === "challenge" ? (
                <span className="run-hero-mode-hearts" aria-hidden="true">
                  {" "}
                  ♥♥
                </span>
              ) : null}
            </span>
            <span className="run-hero-mode-line">{option.line}</span>
          </button>
        ))}
      </div>

      <div className="run-hero-toggles">
        <button
          type="button"
          className="run-toggle"
          aria-pressed={preferences.autoStop}
          onClick={() => onSetPreference("autoStop", !preferences.autoStop)}
        >
          <span className={`run-toggle-dot${preferences.autoStop ? " is-on" : ""}`} aria-hidden="true" />
          Auto-stop {preferences.autoStop ? "on" : "off"}
        </button>
        <button
          type="button"
          className="run-toggle"
          aria-pressed={preferences.sfx}
          onClick={() => onSetPreference("sfx", !preferences.sfx)}
        >
          <span className={`run-toggle-dot${preferences.sfx ? " is-on" : ""}`} aria-hidden="true" />
          Sound {preferences.sfx ? "on" : "off"}
        </button>
      </div>

      <button type="button" className="run-primary-v2" disabled={!canStart || starting} onClick={start}>
        {starting ? "Starting…" : `Start ${modeName}`}
      </button>
      {startError ? (
        <p className="run-hero-error" role="alert">
          Couldn't start the run. Try again.
        </p>
      ) : null}
      {scoresLeft !== null ? <p className="run-hero-usage">{scoresLeft} scores left today</p> : null}
    </section>
  );
}
