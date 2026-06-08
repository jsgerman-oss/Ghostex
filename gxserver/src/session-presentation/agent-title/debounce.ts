export interface GxserverAgentTitleDebounceDecision {
  delayMs: number;
  edge: "leading" | "trailing";
  suppressedCount: number;
}

export interface GxserverAgentTitleDebouncer {
  schedule(input: {
    key: string;
    nowMs?: number;
    run: (decision: GxserverAgentTitleDebounceDecision) => void;
  }): GxserverAgentTitleDebounceDecision | undefined;
}

interface DebounceState {
  pendingTrailing: boolean;
  suppressedCount: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  windowUntilMs: number;
}

export function createAgentTitleDebouncer(options: {
  delayMs: number;
  nowMs?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
}): GxserverAgentTitleDebouncer {
  const states = new Map<string, DebounceState>();
  const delayMs = options.delayMs;
  const nowMs = options.nowMs ?? (() => Date.now());
  const setTimer = options.setTimeout ?? ((callback, timeoutMs) => setTimeout(callback, timeoutMs));

  return {
    schedule(input) {
      const now = input.nowMs ?? nowMs();
      const existing = states.get(input.key);
      if (existing && now < existing.windowUntilMs) {
        existing.pendingTrailing = true;
        existing.suppressedCount += 1;
        if (!existing.timer) {
          existing.timer = setTimer(() => {
            runTrailing(states, input.key, nowMs(), delayMs, input.run);
          }, Math.max(0, existing.windowUntilMs - now));
          unrefTimer(existing.timer);
        }
        return undefined;
      }

      const state: DebounceState = {
        pendingTrailing: true,
        suppressedCount: 0,
        timer: undefined,
        windowUntilMs: now + delayMs,
      };
      state.timer = setTimer(() => {
        runTrailing(states, input.key, nowMs(), delayMs, input.run);
      }, delayMs);
      unrefTimer(state.timer);
      states.set(input.key, state);
      const decision: GxserverAgentTitleDebounceDecision = {
        delayMs,
        edge: "leading",
        suppressedCount: 0,
      };
      input.run(decision);
      return decision;
    },
  };
}

function runTrailing(
  states: Map<string, DebounceState>,
  key: string,
  nowMs: number,
  delayMs: number,
  run: (decision: GxserverAgentTitleDebounceDecision) => void,
): void {
  const state = states.get(key);
  if (!state?.pendingTrailing) {
    return;
  }
  state.pendingTrailing = false;
  state.timer = undefined;
  state.windowUntilMs = nowMs + delayMs;
  const decision: GxserverAgentTitleDebounceDecision = {
    delayMs,
    edge: "trailing",
    suppressedCount: state.suppressedCount,
  };
  state.suppressedCount = 0;
  run(decision);
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

/*
CDXC:GxserverAgentTitles 2026-06-01-09:03:
Structured agent-title checks use a three-second leading plus trailing debounce. The first triggering condition checks immediately for fast sidebar repair, while bursts collapse into one trailing check so title reliability does not turn into repeated Codex metadata-file reads.
*/
