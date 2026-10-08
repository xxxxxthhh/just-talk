import type { KeyboardEvent } from "react";

// Arrow keys move the checked radio within its group, wrapping, as native radios do. `options`
// lists only the choices that can be checked, so an unavailable one is skipped; each radio carries
// data-radio-value so focus follows the choice.
export function radioKeys<T extends string | number>(options: readonly T[], current: T, choose: (value: T) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step || options.length === 0) return;
    event.preventDefault();
    const from = options.indexOf(current);
    const next = options[from < 0 ? 0 : (from + step + options.length) % options.length];
    choose(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-radio-value="${next}"]`)?.focus();
  };
}
