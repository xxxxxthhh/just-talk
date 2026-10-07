import type {
  Attempt,
  AttemptKey,
  AttemptPurpose,
  RunAction,
  RunItem,
  RunPhase,
  RunState,
  ScoreResponse,
  ScoreResult,
  Verdict
} from "../types";

export const PASS_ACCURACY = 60;
export const MAX_EXTRA_ATTEMPTS = 2;

export type Judgment = { kind: "valid"; accuracy: number } | { kind: "no-match" | "unjudged" };

export function judge(result: ScoreResult): Judgment {
  if (result.recognition_status === "no_match") return { kind: "no-match" };
  const accuracy = result.scores?.accuracy;
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) return { kind: "unjudged" };
  if (!Array.isArray(result.words) || result.words.length === 0) return { kind: "unjudged" };
  if (result.words.some((word) => word.error_type === "Omission" || word.error_type === "Insertion")) {
    return { kind: "unjudged" };
  }
  return { kind: "valid", accuracy };
}

function currentItem(state: RunState): RunItem | null {
  return state.items[state.index] ?? null;
}

function inRescue(item: RunItem): boolean {
  return item.resolution === "open" && item.firstLowAttemptId !== null;
}

// The slot and purpose the next capture on the current item must use, or null when none is left.
export function nextCapture(state: RunState): { purpose: AttemptPurpose; slot: "main" | "extra" } | null {
  const item = currentItem(state);
  if (!item) return null;
  if (!state.mainItemIdsUsed.includes(item.prompt.itemId)) return { purpose: "initial", slot: "main" };
  if (state.extraUsed >= MAX_EXTRA_ATTEMPTS) return null;
  return { purpose: inRescue(item) ? "rescue" : "rerecord", slot: "extra" };
}

function syncPending(state: RunState): boolean {
  return state.items.some((item) => item.attempts.some((attempt) => attempt.sync === "pending"));
}

function idle(state: RunState): boolean {
  return state.endReason === null && !state.paused && state.activeAttemptId === null;
}

export function canRecord(state: RunState): boolean {
  const item = currentItem(state);
  if (!item || !idle(state) || syncPending(state) || !nextCapture(state)) return false;
  if (state.phase === "ready") return item.resolution === "open";
  if (state.phase === "rescue") return item.referenceLoad === "ready";
  if (state.phase === "feedback") {
    return item.resolution === "unjudged" && (item.verdict === "no-match" || item.verdict === "unjudged");
  }
  return false;
}

export function canAdvance(state: RunState): boolean {
  const item = currentItem(state);
  return Boolean(item) && idle(state) && !syncPending(state) && state.phase === "feedback";
}

export function canSubmit(state: RunState, key: AttemptKey): boolean {
  if (state.endReason !== null || state.paused || key.runId !== state.runId) return false;
  if (state.activeAttemptId !== key.attemptId) return false;
  const item = currentItem(state);
  if (!item || item.prompt.itemId !== key.itemId) return false;
  const attempt = item.attempts.find((candidate) => candidate.key.attemptId === key.attemptId);
  if (!attempt || attempt.status !== "capturing" || !attempt.recording) return false;
  return attempt.slot === "main"
    ? !state.mainItemIdsUsed.includes(key.itemId)
    : state.extraUsed < MAX_EXTRA_ATTEMPTS;
}

function settledPhase(item: RunItem): RunPhase {
  if (inRescue(item)) return "rescue";
  return item.resolution === "open" ? "ready" : "feedback";
}

function replaceItem(state: RunState, index: number, item: RunItem): RunState {
  return { ...state, items: state.items.map((existing, i) => (i === index ? item : existing)) };
}

function updateAttempt(item: RunItem, attemptId: string, patch: Partial<Attempt>): RunItem {
  return {
    ...item,
    attempts: item.attempts.map((attempt) => (attempt.key.attemptId === attemptId ? { ...attempt, ...patch } : attempt))
  };
}

function withoutAttempt(item: RunItem, attemptId: string): RunItem {
  return { ...item, attempts: item.attempts.filter((attempt) => attempt.key.attemptId !== attemptId) };
}

// Locates the run's single in-flight attempt in the given status; anything else is stale.
function activeAttempt(state: RunState, key: AttemptKey, status: Attempt["status"]): Attempt | null {
  if (key.runId !== state.runId || key.attemptId !== state.activeAttemptId) return null;
  const item = currentItem(state);
  if (!item || item.prompt.itemId !== key.itemId) return null;
  return item.attempts.find((attempt) => attempt.key.attemptId === key.attemptId && attempt.status === status) ?? null;
}

function markIncomplete(state: RunState): RunState {
  return state.mode === "challenge" ? { ...state, challengeIncomplete: true } : state;
}

function endRun(state: RunState, endReason: NonNullable<RunState["endReason"]>): RunState {
  let next: RunState = { ...state, endReason, activeAttemptId: null };
  if (next.mode === "route") return { ...next, phase: "review" };
  if (next.items.some((item) => item.resolution !== "resolved")) next = markIncomplete(next);
  const challengeOutcome = next.hearts === 0 ? "failed" : next.challengeIncomplete ? "incomplete" : "cleared";
  return { ...next, phase: "summary", challengeOutcome };
}

function leaveItem(state: RunState): RunState {
  const item = currentItem(state);
  const next = item && item.resolution !== "resolved" ? markIncomplete(state) : state;
  if (next.index >= next.items.length - 1) return endRun(next, "completed");
  return { ...next, index: next.index + 1, phase: "ready" };
}

function cannotConfirm(state: RunState): RunState {
  const item = currentItem(state);
  if (!item) return state;
  const unconfirmed: RunItem = { ...item, resolution: "unjudged", verdict: "cannot-confirm" };
  return markIncomplete({ ...replaceItem(state, state.index, unconfirmed), phase: "feedback" });
}

function scoreReceived(state: RunState, attempt: Attempt, response: ScoreResponse): RunState {
  const item = currentItem(state) as RunItem;
  const sync = item.prompt.kind === "sentence" && response.session ? "pending" : "not-needed";
  let scored = updateAttempt(item, attempt.key.attemptId, {
    status: "scored",
    result: response.result,
    sessionId: response.session?.id ?? null,
    sync
  });
  let next: RunState = { ...state, activeAttemptId: null };
  const judgment = judge(response.result);
  const rescuing = inRescue(item);

  if (judgment.kind !== "valid") {
    if (rescuing) {
      next = { ...replaceItem(next, next.index, scored), phase: "rescue" };
      return nextCapture(next) ? next : cannotConfirm(next);
    }
    scored = { ...scored, resolution: "unjudged", verdict: judgment.kind };
    next = { ...replaceItem(next, next.index, scored), phase: "feedback" };
    return next.mode === "route" || nextCapture(next) ? next : cannotConfirm(next);
  }

  if (next.mode === "route") {
    scored = { ...scored, resolution: "resolved", verdict: "practiced" };
    return { ...replaceItem(next, next.index, scored), phase: "feedback" };
  }

  const low = judgment.accuracy < PASS_ACCURACY;
  if (!rescuing && low) {
    scored = { ...scored, verdict: "relisten", firstLowAttemptId: attempt.key.attemptId };
    next = { ...replaceItem(next, next.index, scored), phase: "rescue" };
    return nextCapture(next) ? next : cannotConfirm(next);
  }

  const verdict: Verdict = !rescuing ? "passed" : low ? "heart-lost" : "saved";
  scored = { ...scored, resolution: "resolved", verdict };
  next = { ...replaceItem(next, next.index, scored), phase: "feedback" };
  if (verdict !== "heart-lost") return next;
  const hearts = Math.max(0, (next.hearts ?? 0) - 1) as 0 | 1 | 2;
  next = { ...next, hearts };
  return hearts === 0 ? endRun(next, "hearts-exhausted") : next;
}

export function runReducer(state: RunState | null, action: RunAction): RunState | null {
  if (action.type === "START") {
    return {
      runId: action.runId,
      mode: action.mode,
      phase: "ready",
      paused: false,
      items: action.prompts.map((prompt) => ({
        prompt,
        attempts: [],
        resolution: "open",
        verdict: null,
        firstLowAttemptId: null,
        referenceLoad: "idle",
        lastRejection: null
      })),
      index: 0,
      activeAttemptId: null,
      hearts: action.mode === "challenge" ? 2 : null,
      budgetUsed: 0,
      mainItemIdsUsed: [],
      extraUsed: 0,
      challengeIncomplete: false,
      endReason: null,
      challengeOutcome: null
    };
  }
  if (!state) return state;
  const runId = "key" in action ? action.key.runId : action.runId;
  if (runId !== state.runId) return state;
  const item = currentItem(state);

  switch (action.type) {
    case "BEGIN_CAPTURE": {
      if (!item || item.prompt.itemId !== action.key.itemId || !canRecord(state)) return state;
      if (state.items.some((candidate) => candidate.attempts.some((a) => a.key.attemptId === action.key.attemptId))) {
        return state;
      }
      const expected = nextCapture(state);
      if (!expected || expected.slot !== action.slot || expected.purpose !== action.purpose) return state;
      const attempt: Attempt = {
        key: action.key,
        purpose: action.purpose,
        slot: action.slot,
        status: "capturing",
        recording: null,
        sessionId: null,
        result: null,
        sync: "not-needed",
        candidates: []
      };
      const next = replaceItem(state, state.index, { ...item, attempts: [...item.attempts, attempt] });
      return { ...next, activeAttemptId: action.key.attemptId, phase: "recording" };
    }
    case "BLOB_READY": {
      const attempt = activeAttempt(state, action.key, "capturing");
      if (!attempt || !item) return state;
      return replaceItem(state, state.index, updateAttempt(item, attempt.key.attemptId, { recording: action.blob }));
    }
    case "CANCEL_CAPTURE": {
      const attempt = activeAttempt(state, action.key, "capturing");
      if (!attempt || !item) return state;
      const remaining = withoutAttempt(item, attempt.key.attemptId);
      return { ...replaceItem(state, state.index, remaining), activeAttemptId: null, phase: settledPhase(remaining) };
    }
    case "SCORE_SENT": {
      if (!canSubmit(state, action.key) || !item) return state;
      const attempt = activeAttempt(state, action.key, "capturing") as Attempt;
      const next = replaceItem(state, state.index, updateAttempt(item, attempt.key.attemptId, { status: "submitted" }));
      return {
        ...next,
        phase: "scoring",
        budgetUsed: state.budgetUsed + 1,
        mainItemIdsUsed: attempt.slot === "main" ? [...state.mainItemIdsUsed, item.prompt.itemId] : state.mainItemIdsUsed,
        extraUsed: attempt.slot === "extra" ? ((state.extraUsed + 1) as 1 | 2) : state.extraUsed
      };
    }
    case "SCORE_RECEIVED": {
      const attempt = activeAttempt(state, action.key, "submitted");
      if (!attempt) return state;
      return scoreReceived(state, attempt, action.response);
    }
    case "SCORE_FAILED": {
      const attempt = activeAttempt(state, action.key, "submitted");
      if (!attempt || !item) return state;
      const { kind, message } = action.failure;
      if (kind === "unknown") {
        const pending: RunItem = {
          ...updateAttempt(item, attempt.key.attemptId, { status: "pending" }),
          resolution: "pending",
          verdict: "pending"
        };
        return markIncomplete({ ...replaceItem(state, state.index, pending), activeAttemptId: null, phase: "feedback" });
      }
      // Rejected and quota responses never reached Azure, so the slot is returned.
      const refunded: RunState = {
        ...state,
        activeAttemptId: null,
        budgetUsed: state.budgetUsed - 1,
        mainItemIdsUsed:
          attempt.slot === "main" ? state.mainItemIdsUsed.filter((id) => id !== item.prompt.itemId) : state.mainItemIdsUsed,
        extraUsed: attempt.slot === "extra" ? ((state.extraUsed - 1) as 0 | 1) : state.extraUsed
      };
      const remaining = withoutAttempt(item, attempt.key.attemptId);
      if (kind === "quota") {
        return endRun(replaceItem(refunded, state.index, { ...remaining, verdict: remaining.verdict ?? "quota-ended" }), "quota");
      }
      const rejected: RunItem = {
        ...remaining,
        verdict: remaining.verdict ?? "rejected",
        lastRejection: { attemptId: attempt.key.attemptId, message }
      };
      return { ...replaceItem(refunded, state.index, rejected), phase: settledPhase(rejected) };
    }
    case "SYNC_SETTLED": {
      const index = state.items.findIndex((candidate) => candidate.prompt.itemId === action.key.itemId);
      const target = state.items[index];
      const attempt = target?.attempts.find((a) => a.key.attemptId === action.key.attemptId);
      if (!target || !attempt || attempt.sync !== "pending") return state;
      return replaceItem(
        state,
        index,
        updateAttempt(target, attempt.key.attemptId, {
          sync: action.failed ? "manual" : "done",
          candidates: action.candidates
        })
      );
    }
    case "REFERENCE_CLICKED": {
      const index = state.items.findIndex((candidate) => candidate.prompt.itemId === action.itemId);
      const target = state.items[index];
      if (!target || (target.referenceLoad !== "idle" && target.referenceLoad !== "failed")) return state;
      return replaceItem(state, index, { ...target, referenceLoad: "pending" });
    }
    case "REFERENCE_LOADED": {
      const index = state.items.findIndex((candidate) => candidate.prompt.itemId === action.itemId);
      const target = state.items[index];
      if (!target || target.referenceLoad !== "pending") return state;
      const next = replaceItem(state, index, { ...target, referenceLoad: action.ok ? "ready" : "failed" });
      const blocksRescue = !action.ok && index === state.index && state.phase === "rescue" && state.endReason === null;
      return blocksRescue ? cannotConfirm(next) : next;
    }
    case "CANNOT_CONFIRM": {
      if (!item || item.prompt.itemId !== action.itemId || !idle(state) || state.phase !== "rescue") return state;
      return cannotConfirm(state);
    }
    case "SKIP": {
      if (!item || item.prompt.itemId !== action.itemId || !idle(state) || item.resolution !== "open") return state;
      if (state.phase !== "ready" && state.phase !== "rescue") return state;
      const skipped: RunItem = { ...item, resolution: "skipped", verdict: "skipped" };
      return leaveItem(replaceItem(state, state.index, skipped));
    }
    case "ADVANCE": {
      if (!item || item.prompt.itemId !== action.itemId || !canAdvance(state)) return state;
      return leaveItem(state);
    }
    case "PAUSE": {
      if (state.paused) return state;
      const capturing = item?.attempts.find(
        (attempt) => attempt.key.attemptId === state.activeAttemptId && attempt.status === "capturing"
      );
      if (!item || !capturing) return { ...state, paused: true };
      const remaining = withoutAttempt(item, capturing.key.attemptId);
      return {
        ...replaceItem(state, state.index, remaining),
        paused: true,
        activeAttemptId: null,
        phase: state.endReason === null ? settledPhase(remaining) : state.phase
      };
    }
    case "RESUME":
      return state.paused ? { ...state, paused: false } : state;
    case "QUIT": {
      if (state.endReason !== null || !item) return state;
      const active = item.attempts.find((attempt) => attempt.key.attemptId === state.activeAttemptId);
      let next = state;
      if (active?.status === "capturing") {
        next = replaceItem(next, next.index, withoutAttempt(item, active.key.attemptId));
      } else if (active?.status === "submitted") {
        // The request may still be billed; its late result is no longer accepted.
        const pending = updateAttempt(item, active.key.attemptId, { status: "pending" });
        next = replaceItem(next, next.index, { ...pending, resolution: "pending", verdict: "pending" });
      }
      return endRun(next, "quit");
    }
    case "OPEN_REVIEW":
      return state.phase === "summary" ? { ...state, phase: "review" } : state;
    case "EXIT":
      return null;
  }
}
