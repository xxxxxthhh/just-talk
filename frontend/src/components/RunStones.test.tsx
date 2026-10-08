import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { tierForAccuracy } from "../game/scoring";
import { RunStones } from "./RunStones";
import { runV2Fixtures } from "./runV2Fixtures";
import { runV3Fixtures, type RunV3Fixture } from "./runV3Fixtures";

function renderStones(fixture: RunV3Fixture, reducedMotion = false) {
  return render(
    <RunStones
      items={fixture.run.items}
      scores={fixture.score.items}
      currentIndex={fixture.run.endReason === null ? fixture.run.index : null}
      reducedMotion={reducedMotion}
    />
  );
}

function stones(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Run progress" }))
    .getAllByRole("listitem")
    .filter((element) => element.classList.contains("run-stone"));
}

describe("RunStones", () => {
  it("stones_encode_tier_and_nonjudgment_status", () => {
    const { unmount } = renderStones(runV2Fixtures.summaryRated);
    expect(stones().map((stone) => stone.dataset.tier)).toEqual(["perfect", "good", "perfect", "great", "great", "great"]);
    expect(stones()[0]).toHaveAccessibleName("1. for: first reading Perfect 100");
    unmount();

    const gaps = renderStones(runV2Fixtures.routeGaps);
    const groups = gaps.container.querySelectorAll(".run-stones-group");
    expect(Array.from(groups).map((group) => group.querySelectorAll(".run-stone").length)).toEqual([2, 2, 2]);
    expect(Array.from(groups).map((group) => group.querySelector(".run-stones-label")?.textContent)).toEqual([
      "Warm-up",
      "Focus",
      "In context"
    ]);
    const [first, skipped, unjudged, pending, current, unreached] = stones();
    expect(first).toHaveAttribute("data-tier", "perfect");
    expect(skipped).toHaveClass("is-skipped");
    expect(skipped).toHaveAccessibleName("2. songs: skipped");
    expect(unjudged).toHaveClass("is-unjudged");
    expect(unjudged.querySelector(".run-stone-stripes")).not.toBeNull();
    expect(unjudged).toHaveAccessibleName("3. these: not judged");
    expect(pending).toHaveClass("is-pending");
    expect(pending).toHaveAccessibleName("4. those: result pending");
    expect(current).toHaveClass("is-current");
    expect(current).toHaveAttribute("aria-current", "step");
    expect(unreached).toHaveAccessibleName("6. Their brother sat over there.: not reached");
    for (const stone of [skipped, unjudged, pending, current, unreached]) expect(stone).not.toHaveAttribute("data-tier");
    gaps.unmount();
  });

  it("stage groups are named for assistive technology", () => {
    renderStones(runV2Fixtures.routeGaps);
    for (const [name, texts] of [
      ["Warm-up", ["for", "songs"]],
      ["Focus", ["these", "those"]],
      ["In context", ["These little birds wait by the window.", "Their brother sat over there."]],
    ] as const) {
      const stonesInGroup = within(screen.getByRole("list", { name })).getAllByRole("listitem");
      expect(stonesInGroup).toHaveLength(2);
      texts.forEach((text, index) => expect(stonesInGroup[index].getAttribute("aria-label")).toContain(`${text}:`));
    }
  });

  it("rescued stone keeps the first reading tier and marks the rescue separately", () => {
    const { unmount } = renderStones(runV2Fixtures.rescueSaved);
    const saved = stones()[3];
    expect(saved).toHaveAttribute("data-tier", "relisten");
    expect(saved).toHaveClass("is-rescued");
    expect(saved).toHaveAccessibleName("4. those: first reading Re-listen 46, rescued");
    unmount();

    renderStones(runV2Fixtures.heartLost);
    const lost = stones()[3];
    expect(lost).toHaveAttribute("data-tier", "relisten");
    expect(lost).not.toHaveClass("is-rescued");
  });

  it("stone labels keep the decimal wherever rounding would cross a tier line", () => {
    const run = runV2Fixtures.summaryRated.run;
    const values = [59.6, 60, 84.9, 85, 94.9, 95];
    const scores = run.items.map((item, index) => ({
      itemId: item.prompt.itemId,
      firstAccuracy: values[index],
      tier: tierForAccuracy(values[index]),
      chain: 0,
      basePoints: 0,
      chainPoints: 0,
    }));
    const { unmount } = render(<RunStones items={run.items} scores={scores} currentIndex={null} reducedMotion />);
    expect(stones().map((stone) => stone.getAttribute("aria-label")?.split(": ")[1])).toEqual([
      "first reading Re-listen 59.6",
      "first reading Good 60",
      "first reading Good 84.9",
      "first reading Great 85",
      "first reading Great 94.9",
      "first reading Perfect 95",
    ]);
    unmount();

    // A rescued stone keeps its first reading below 60, decimal included, beside the rescue.
    const saved = runV2Fixtures.rescueSaved;
    const rescuedScores = saved.score.items.map((item, index) =>
      index === 3 ? { ...item, firstAccuracy: 59.6, tier: tierForAccuracy(59.6) } : item
    );
    render(<RunStones items={saved.run.items} scores={rescuedScores} currentIndex={null} reducedMotion />);
    expect(stones()[3]).toHaveAccessibleName("4. those: first reading Re-listen 59.6, rescued");
  });

  it("reduced motion stops the current stone breathing", () => {
    const { container } = renderStones(runV2Fixtures.recording, true);
    expect(container.querySelector(".run-stones")).toHaveClass("is-reduced");
  });

  it("stones_render_labelled_2_2_2_and_4_4_4", () => {
    const groupSizes = (container: HTMLElement) =>
      Array.from(container.querySelectorAll(".run-stones-group > ol")).map((group) => group.querySelectorAll(".run-stone").length);

    const six = renderStones(runV3Fixtures.route6Ready);
    expect(groupSizes(six.container)).toEqual([2, 2, 2]);
    expect(six.container.querySelector(".is-grid")).toBeNull();
    six.unmount();

    const twelve = renderStones(runV3Fixtures.route12Ready);
    expect(groupSizes(twelve.container)).toEqual([4, 4, 4]);
    expect(twelve.container.querySelectorAll(".run-stones-group > ol.is-grid")).toHaveLength(3);
    expect(Array.from(twelve.container.querySelectorAll(".run-stones-label")).map((label) => label.textContent)).toEqual([
      "Warm-up",
      "Focus",
      "In context"
    ]);
    // Source order inside each named group; the first five carry their first-reading tiers.
    for (const [name, texts] of [
      ["Warm-up", ["thin", "thick", "thumb", "thing"]],
      ["Focus", ["think", "thank", "three", "teeth"]],
      [
        "In context",
        [
          "I think we can walk home now.",
          "The narrow path leads to our house.",
          "We bought three tickets for the show.",
          "Both cups of tea are still hot."
        ]
      ]
    ] as const) {
      const group = within(screen.getByRole("list", { name })).getAllByRole("listitem");
      texts.forEach((text, index) => expect(group[index].getAttribute("aria-label")).toContain(`${text}:`));
    }
    expect(stones().map((stone) => stone.dataset.tier ?? null)).toEqual([
      "great", "perfect", "good", "perfect", "great", null, null, null, null, null, null, null
    ]);
    expect(stones()[5]).toHaveAttribute("aria-current", "step");
    expect(stones()[5]).toHaveAccessibleName("6. thank: now");
    expect(stones()[11]).toHaveAccessibleName("12. Both cups of tea are still hot.: not reached");
  });

  it("heart_lost_mark_preserves_first_good_fill", () => {
    const { unmount } = renderStones(runV3Fixtures.target85HeartLost);
    const lost = stones()[2];
    expect(lost).toHaveAttribute("data-tier", "good");
    expect(lost).toHaveClass("is-heart-lost");
    expect(lost).not.toHaveClass("is-rescued");
    expect(lost.querySelector(".run-stone-crack")).not.toBeNull();
    expect(lost).toHaveAccessibleName("3. think: first reading Good 80, one heart used");
    expect(document.querySelectorAll(".run-stone-crack")).toHaveLength(1);
    unmount();

    // The same mark at Target 60, over a Re-listen fill.
    renderStones(runV3Fixtures.target60HeartLost);
    expect(stones()[0]).toHaveAttribute("data-tier", "relisten");
    expect(stones()[0]).toHaveAccessibleName("1. thin: first reading Re-listen 46, one heart used");
  });

  it("only_saved_has_rescue_outline", () => {
    const marks = (stone: HTMLElement) => ({
      rescued: stone.classList.contains("is-rescued"),
      crack: stone.querySelector(".run-stone-crack") !== null
    });

    const saved = renderStones(runV3Fixtures.target85Saved);
    expect(marks(stones()[2])).toEqual({ rescued: true, crack: false });
    expect(stones()[2]).toHaveAttribute("data-tier", "good");
    expect(stones()[2]).toHaveAccessibleName("3. think: first reading Good 80, rescued");
    saved.unmount();

    // A first reading below target is not an outcome yet: no mark.
    const below = renderStones(runV3Fixtures.target85Rescue);
    expect(marks(stones()[2])).toEqual({ rescued: false, crack: false });
    expect(stones()[2]).toHaveAccessibleName("3. think: first reading Good 80");
    below.unmount();

    // An exhausted pool confirms nothing: no heart mark, and the label says so.
    const exhausted = renderStones(runV3Fixtures.target85UnjudgedEmpty);
    expect(marks(stones()[0])).toEqual({ rescued: false, crack: false });
    expect(stones()[0]).toHaveAttribute("data-tier", "good");
    expect(stones()[0]).toHaveAccessibleName("1. thin: first reading Good 80, not confirmed");
    // No valid reading at all: the unjudged stripes, still without a heart mark.
    expect(marks(stones()[1])).toEqual({ rescued: false, crack: false });
    expect(stones()[1].querySelector(".run-stone-stripes")).not.toBeNull();
    expect(stones()[1]).toHaveAccessibleName("2. thick: not judged");
    exhausted.unmount();
  });

  it("stone_labels_keep_raw_boundary_and_outcome", () => {
    renderStones(runV3Fixtures.target85Boundary);
    expect(stones()[0]).toHaveAttribute("data-tier", "good");
    expect(stones()[0]).toHaveAccessibleName("1. thin: first reading Good 84.9, rescued");
  });

  it("stones_have_static_reduced_motion", () => {
    const { container } = renderStones(runV3Fixtures.target85HeartLost, true);
    expect(container.querySelector(".run-stones")).toHaveClass("is-reduced");
    // Facts are in the first frame: fill, mark and label need no timer or effect.
    expect(stones()[2]).toHaveClass("is-heart-lost");
    expect(stones()[2]).toHaveAttribute("data-tier", "good");
  });
});
