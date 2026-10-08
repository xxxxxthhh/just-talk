import { useId } from "react";

import type { RunItem, RunItemScore, RunPrompt, RunTier } from "../types";
import { formatRunScore } from "./RunRing";

export type RunStonesProps = {
  items: readonly RunItem[];
  scores: readonly RunItemScore[];
  currentIndex: number | null;
  reducedMotion: boolean;
};

// A starter run has three stage groups; a My words run has one group of its own, never fake stages.
const STAGES: readonly { stage: RunPrompt["stage"]; label: string }[] = [
  { stage: "warmup", label: "Warm-up" },
  { stage: "focus", label: "Focus" },
  { stage: "context", label: "In context" },
  { stage: "words", label: "My words" }
];

function groupClass(stage: RunPrompt["stage"], count: number): string | undefined {
  // My words wraps six to a row; four stones per stage (Route 12) sit two by two.
  if (stage === "words") return "is-words";
  return count > 2 ? "is-grid" : undefined;
}

const TIER_LABELS: Record<RunTier, string> = {
  perfect: "Perfect",
  great: "Great",
  good: "Good",
  relisten: "Re-listen"
};

// Pointy-top hexagons in a 28px box: the stone, and an outer ring for the current and rescued marks.
const STONE = "14,4 22.66,9 22.66,19 14,24 5.34,19 5.34,9";
const HALO = "14,1 25.26,7.5 25.26,20.5 14,27 2.74,20.5 2.74,7.5";
// A confirmed heart loss: the outer ring breaks where a crack runs in from the top-right corner.
const CRACK_OUTER = "M22.6 2.6 L20.4 5.2 L21.4 6.6 L19.6 8.4";
const CRACK_INNER = "M19.6 8.4 L17.2 10.2 L18.2 12 L15.4 13.8 L16.2 15.6 L13.6 17.4";

function stoneStatus(item: RunItem): "skipped" | "unjudged" | "pending" | null {
  if (item.resolution === "skipped") return "skipped";
  if (item.resolution === "unjudged") return "unjudged";
  if (item.resolution === "pending") return "pending";
  return null;
}

const STATUS_LABELS = { skipped: "skipped", unjudged: "not judged", pending: "result pending" } as const;

// A cannot-confirm item may still have a judged first reading; then it is the outcome that is open.
function statusLabel(item: RunItem, status: NonNullable<ReturnType<typeof stoneStatus>>, judged: boolean): string {
  return item.verdict === "cannot-confirm" && judged ? "not confirmed" : STATUS_LABELS[status];
}

function stoneLabel(position: number, item: RunItem, score: RunItemScore | undefined, current: boolean): string {
  const status = stoneStatus(item);
  const parts: string[] = [];
  // The first valid reading is the scored fact; a rescue is reported beside it, never instead of it.
  // Same rule as the ring: a decimal only where rounding would cross a tier line (84.9 stays Good).
  if (score?.tier && score.firstAccuracy !== null) {
    parts.push(`first reading ${TIER_LABELS[score.tier]} ${formatRunScore(score.firstAccuracy)}`);
  }
  if (item.verdict === "saved") parts.push("rescued");
  if (item.verdict === "heart-lost") parts.push("one heart used");
  if (status) parts.push(statusLabel(item, status, parts.length > 0));
  if (parts.length === 0) parts.push(current ? "now" : "not reached");
  return `${position}. ${item.prompt.text}: ${parts.join(", ")}`;
}

export function RunStones({ items, scores, currentIndex, reducedMotion }: RunStonesProps) {
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const stripesId = `run-stone-stripes${idBase}`;
  const goldId = `run-stone-gold${idBase}`;

  return (
    <div className={`run-stones${reducedMotion ? " is-reduced" : ""}`}>
      <svg className="run-stones-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={stripesId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line className="run-stone-stripe" x1="0" y1="0" x2="0" y2="4" />
          </pattern>
          <linearGradient id={goldId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="1" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
      </svg>
      <ol className="run-stones-groups" aria-label="Run progress">
        {STAGES.filter(({ stage }) => items.some((item) => item.prompt.stage === stage)).map(({ stage, label }) => (
          <li key={stage} className="run-stones-group">
            <ol aria-label={label} className={groupClass(stage, items.filter((item) => item.prompt.stage === stage).length)}>
              {items.map((item, index) => {
                if (item.prompt.stage !== stage) return null;
                const score = scores.find((candidate) => candidate.itemId === item.prompt.itemId);
                const status = stoneStatus(item);
                const current = index === currentIndex;
                const tier = score?.tier ?? null;
                const className = [
                  "run-stone",
                  status ? `is-${status}` : "",
                  current ? "is-current" : "",
                  item.verdict === "saved" ? "is-rescued" : "",
                  item.verdict === "heart-lost" ? "is-heart-lost" : ""
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li
                    key={item.prompt.itemId}
                    className={className}
                    data-tier={tier ?? undefined}
                    aria-current={current ? "step" : undefined}
                    aria-label={stoneLabel(index + 1, item, score, current)}
                  >
                    <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
                      <polygon className="run-stone-halo" points={HALO} />
                      <polygon
                        className="run-stone-shape"
                        points={STONE}
                        style={tier === "perfect" ? { fill: `url(#${goldId})` } : undefined}
                      />
                      {status === "unjudged" && !tier ? (
                        <polygon className="run-stone-stripes" points={STONE} fill={`url(#${stripesId})`} />
                      ) : null}
                      {item.verdict === "heart-lost" ? (
                        <g className="run-stone-crack">
                          <polygon className="run-stone-crack-ring" points={HALO} />
                          <path className="run-stone-crack-outer" d={CRACK_OUTER} />
                          <path className="run-stone-crack-inner" d={CRACK_INNER} />
                        </g>
                      ) : null}
                    </svg>
                  </li>
                );
              })}
            </ol>
            <span className="run-stones-label" aria-hidden="true">
              {label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
