import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunChoice } from "../types";
import { RunHero } from "./RunHero";

vi.mock("../api", () => ({ fetchPhonemeStats: vi.fn(async () => []) }));

type HeroProps = ComponentProps<typeof RunHero>;

function baseProps(overrides: Partial<HeroProps> = {}): HeroProps {
  return {
    canStart: true,
    starting: false,
    preferences: { autoStop: true, sfx: true },
    onSetPreference: vi.fn(),
    choice: { selection: "route", routeLength: 6 },
    onChoiceChange: vi.fn(),
    onStart: vi.fn(async () => {}),
    maxScores: null,
    scoresLeft: null,
    ...overrides
  };
}

// The screen owns the remembered choice; this stands in for it.
function Controlled({ initial, onChange, ...props }: Partial<HeroProps> & { initial?: RunChoice; onChange?: (choice: RunChoice) => void }) {
  const [choice, setChoice] = useState<RunChoice>(initial ?? { selection: "route", routeLength: 6 });
  return (
    <RunHero
      {...baseProps(props)}
      choice={choice}
      onChoiceChange={(next) => {
        onChange?.(next);
        setChoice(next);
      }}
    />
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.doUnmock("../publicMode");
  vi.resetModules();
});

describe("RunHero", () => {
  it("entry_exposes_three_modes_and_route_lengths", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const modes = await screen.findByRole("radiogroup", { name: "Run type" });

    expect(within(modes).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Route",
      "Challenge, target 60",
      "Challenge, target 85"
    ]);
    expect(within(modes).getByRole("radio", { name: "Route" })).toHaveAttribute("aria-checked", "true");
    const lengths = screen.getByRole("radiogroup", { name: "Route length" });
    expect(within(lengths).getByRole("radio", { name: "6 items" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("6 items · no hearts")).toBeInTheDocument();
    expect(screen.getByText("Best · /θ/ · Route 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Route" })).toBeEnabled();

    await user.click(within(lengths).getByRole("radio", { name: "12 items" }));
    expect(onChange).toHaveBeenLastCalledWith({ selection: "route", routeLength: 12 });
    expect(screen.getByText("12 items · no hearts")).toBeInTheDocument();
    expect(screen.getByText("Best · /θ/ · Route 12")).toBeInTheDocument();

    // A target hides the length chips but keeps the remembered Route length.
    await user.click(screen.getByRole("radio", { name: "Challenge, target 85" }));
    expect(onChange).toHaveBeenLastCalledWith({ selection: "target85", routeLength: 12 });
    expect(screen.queryByRole("radiogroup", { name: "Route length" })).not.toBeInTheDocument();
    expect(screen.getByText("6 items · target 85 · 2 hearts")).toBeInTheDocument();
    expect(screen.getByText("Best · /θ/ · Target 85")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Challenge" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Challenge, target 60" }));
    expect(screen.getByText("6 items · target 60 · 2 hearts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Challenge" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Route" }));
    expect(onChange).toHaveBeenLastCalledWith({ selection: "route", routeLength: 12 });
    expect(screen.getByRole("radio", { name: "12 items" })).toHaveAttribute("aria-checked", "true");
  });

  it("entry_radios_follow_standard_keyboard_behaviour", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const route = await screen.findByRole("radio", { name: "Route" });

    // One tab stop per group, on the checked radio.
    expect(route).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Challenge, target 60" })).toHaveAttribute("tabindex", "-1");
    await user.tab();
    expect(route).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ selection: "target60", routeLength: 6 });
    expect(screen.getByRole("radio", { name: "Challenge, target 60" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Challenge, target 85" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowRight}");
    expect(route).toHaveAttribute("aria-checked", "true");
    expect(route).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Challenge, target 85" })).toHaveFocus();

    await user.click(screen.getByRole("radio", { name: "Route" }));
    await user.tab();
    expect(screen.getByRole("radio", { name: "6 items" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "12 items" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith({ selection: "route", routeLength: 12 });
  });

  it("entry_starting_and_ordinary_busy_guards_hold", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(async (choice: RunChoice) => void choice);
    const { rerender } = render(
      <RunHero {...baseProps({ starting: true, choice: { selection: "route", routeLength: 12 }, onStart })} />
    );

    // An accepted start locks every choice until it is ready or abandoned.
    expect(await screen.findByRole("button", { name: "Starting…" })).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();

    // An ordinary take or drill blocks only Start; the choice stays editable.
    rerender(<RunHero {...baseProps({ canStart: false, choice: { selection: "route", routeLength: 12 }, onStart })} />);
    expect(screen.getByRole("button", { name: "Start Route" })).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeEnabled();

    rerender(<RunHero {...baseProps({ choice: { selection: "route", routeLength: 12 }, onStart })} />);
    await user.click(screen.getByRole("button", { name: "Start Route" }));
    expect(onStart).toHaveBeenCalledWith({ selection: "route", routeLength: 12 });

    // A failed initial start leaves the choices available with a retryable error.
    onStart.mockRejectedValueOnce(new Error("no deck"));
    await user.click(screen.getByRole("button", { name: "Start Route" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't start the run. Try again.");
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeEnabled();
  });

  it("entry_states_the_given_cost_once", async () => {
    const { rerender } = render(
      <RunHero {...baseProps({ choice: { selection: "route", routeLength: 12 }, maxScores: 16 })} />
    );
    expect(await screen.findByText("12 items · no hearts · up to 16 scores")).toBeInTheDocument();

    // Until the screen can derive the cost, the line describes the shape only.
    rerender(<RunHero {...baseProps({ choice: { selection: "target85", routeLength: 12 }, scoresLeft: 14 })} />);
    expect(screen.getByText("6 items · target 85 · 2 hearts")).toBeInTheDocument();
    expect(screen.getByText("14 scores left today")).toBeInTheDocument();

    // Public mode: the cost appears only in the usage line.
    vi.resetModules();
    vi.doMock("../publicMode", () => ({ PUBLIC_MODE: true }));
    const { RunHero: PublicHero } = await import("./RunHero");
    rerender(<PublicHero {...baseProps({ choice: { selection: "target85", routeLength: 6 }, maxScores: 10, scoresLeft: 14 })} />);
    expect(await screen.findByText("6 items · target 85 · 2 hearts")).toBeInTheDocument();
    expect(screen.getByText("Up to 10 scores · 14 left today")).toBeInTheDocument();
    expect(screen.queryByText(/· up to 10 scores/)).not.toBeInTheDocument();
  });

  it("entry_best_uses_selected_legacy_or_new_bucket", async () => {
    const record = (points: number, rating: string) => ({ runId: `r${points}`, points, rating, updatedAt: 1, expiresAt: null });
    window.localStorage.setItem(
      "jt.runBest.v1",
      JSON.stringify({
        "route|θ|1": record(861, "A"),
        "route|θ|1|12": record(927, "A"),
        "challenge|θ|1": record(540, "C"),
        "challenge|θ|1|85": record(876, "A")
      })
    );
    const user = userEvent.setup();
    render(<Controlled />);
    const best = () => screen.getByText(/^Best · /).parentElement;

    // Route 6 and Target 60 read the v2 key bytes; Route 12 and Target 85 their own buckets.
    expect(await screen.findByText("Best · /θ/ · Route 6")).toBeInTheDocument();
    expect(best()).toHaveTextContent("861A");
    await user.click(screen.getByRole("radio", { name: "12 items" }));
    expect(best()).toHaveTextContent("Route 12927A");
    await user.click(screen.getByRole("radio", { name: "Challenge, target 60" }));
    expect(best()).toHaveTextContent("Target 60540C");
    await user.click(screen.getByRole("radio", { name: "Challenge, target 85" }));
    expect(best()).toHaveTextContent("Target 85876A");
  });
});

