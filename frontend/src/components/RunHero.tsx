import { useEffect, useState, type KeyboardEvent } from "react";

import { fetchPhonemeStats } from "../api";
import "../game/game.css";
import { readBest } from "../game/personalBest";
import type { RunPreferences } from "../game/preferences";
import { configForChoice } from "../game/runConfig";
import { chooseFocusPhoneme } from "../game/runDeck";
import { RUN_RULES_VERSION } from "../game/scoring";
import { STARTER_PACK } from "../game/starterPack";
import { PUBLIC_MODE } from "../publicMode";
import type { PhonemeStat, RunChoice, RunLength, RunSelection } from "../types";

const SELECTIONS: readonly { selection: RunSelection; name: string; label: string; target: 60 | 85 | null }[] = [
  { selection: "route", name: "Route", label: "Route", target: null },
  { selection: "target60", name: "Target 60", label: "Challenge, target 60", target: 60 },
  { selection: "target85", name: "Target 85", label: "Challenge, target 85", target: 85 }
];
const LENGTHS: readonly RunLength[] = [6, 12];

// Arrow keys move the checked radio within its group, wrapping, as native radios do.
function radioKeys<T>(options: readonly T[], current: T, choose: (value: T) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = (options.indexOf(current) + step + options.length) % options.length;
    choose(options[index]);
    const radios = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
    radios[index]?.focus();
  };
}

type RunHeroProps = {
  // False while an ordinary take is recording or scoring, or a drill is generating.
  canStart: boolean;
  // The controller's accepted start, until its deck is ready or abandoned.
  starting: boolean;
  preferences: RunPreferences;
  onSetPreference: (name: keyof RunPreferences, value: boolean) => void;
  // The remembered entry choice; the screen owns reading and saving it.
  choice: RunChoice;
  onChoiceChange: (choice: RunChoice) => void;
  onStart: (choice: RunChoice) => Promise<void>;
  // Counted scores the chosen configuration may use; null until the screen can derive it.
  maxScores: number | null;
  // Public mode only; null hides the usage line.
  scoresLeft: number | null;
};

// The run's entry card. The sound it previews comes from the same stats and rule the run uses
// to freeze its focus, so the Best shown here is the bucket the run will be compared with.
export function RunHero({
  canStart,
  starting,
  preferences,
  onSetPreference,
  choice,
  onChoiceChange,
  onStart,
  maxScores,
  scoresLeft
}: RunHeroProps) {
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
  const selected = SELECTIONS.find((option) => option.selection === choice.selection) ?? SELECTIONS[0];
  const isRoute = selected.target === null;
  const best = focus ? readBest({ config: configForChoice(choice), focus, rulesVersion: RUN_RULES_VERSION }) : null;
  const configName = isRoute ? `Route ${choice.routeLength}` : selected.name;
  const shape = isRoute
    ? `${choice.routeLength} items · no hearts`
    : `6 items · target ${selected.target} · 2 hearts`;
  // Public mode states the cost once, in the usage line.
  const explanation = maxScores !== null && !PUBLIC_MODE ? `${shape} · up to ${maxScores} scores` : shape;
  const usage =
    scoresLeft === null ? null : maxScores === null ? `${scoresLeft} scores left today` : `Up to ${maxScores} scores · ${scoresLeft} left today`;

  // Choosing a target keeps the remembered Route length for the next Route.
  const choose = (selection: RunSelection) => onChoiceChange({ ...choice, selection });
  const chooseLength = (routeLength: RunLength) => onChoiceChange({ ...choice, routeLength });

  // The start itself runs in this tap, so run audio is unlocked inside the gesture.
  const start = () => {
    setStartError(false);
    onStart(choice).catch(() => setStartError(true));
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

      <div
        className="run-hero-modes"
        role="radiogroup"
        aria-label="Run type"
        onKeyDown={starting ? undefined : radioKeys(SELECTIONS.map((option) => option.selection), choice.selection, choose)}
      >
        {SELECTIONS.map((option) => {
          const checked = option.selection === choice.selection;
          return (
            <button
              key={option.selection}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.label}
              tabIndex={checked ? 0 : -1}
              className="run-hero-mode"
              disabled={starting}
              onClick={() => choose(option.selection)}
            >
              <span className="run-hero-mode-name">{option.name}</span>
              {option.target === null ? (
                <span className="run-hero-mode-line">No hearts</span>
              ) : (
                <span className="run-hero-mode-hearts" aria-hidden="true">
                  ♥♥
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="run-hero-config">
        {isRoute ? (
          <div
            className="run-hero-chips"
            role="radiogroup"
            aria-label="Route length"
            onKeyDown={starting ? undefined : radioKeys(LENGTHS, choice.routeLength, chooseLength)}
          >
            {LENGTHS.map((length) => {
              const checked = length === choice.routeLength;
              return (
                <button
                  key={length}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={`${length} items`}
                  tabIndex={checked ? 0 : -1}
                  className="run-hero-chip"
                  disabled={starting}
                  onClick={() => chooseLength(length)}
                >
                  {length}
                </button>
              );
            })}
          </div>
        ) : null}
        <p className="run-hero-explain">{explanation}</p>
      </div>

      <div className="run-hero-best">
        <span className="run-hero-best-label">
          Best{focus ? ` · /${focus}/` : ""} · {configName}
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
        {starting ? "Starting…" : isRoute ? "Start Route" : "Start Challenge"}
      </button>
      {startError ? (
        <p className="run-hero-error" role="alert">
          Couldn't start the run. Try again.
        </p>
      ) : null}
      {usage ? <p className="run-hero-usage">{usage}</p> : null}
    </section>
  );
}
