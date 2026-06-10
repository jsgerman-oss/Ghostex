import type {
  GxserverAgentActivityEvent,
  GxserverAgentActivityInput,
  GxserverAgentActivityState,
} from "../../protocol/index.js";
import {
  classifyTerminalTitleStatus,
  createTitleActivitySignature,
  GXSERVER_TITLE_ACTIVITY_HEARTBEAT_MS,
  getTitleActivityWindowMs,
  normalizeStatusAgentName,
  requiresObservedTitleTransitions,
} from "./title-classifier.js";
import type { GxserverSessionStatusAgentName, GxserverTitleStatusSignal } from "./types.js";

export const GXSERVER_INITIAL_ACTIVITY_SUPPRESSION_MS = 12_000;
export const GXSERVER_MIN_WORKING_DURATION_BEFORE_ATTENTION_MS = 5_000;

export function applyAgentActivityTransition(input: GxserverAgentActivityInput): GxserverAgentActivityState {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = input.nowIso ?? new Date(nowMs).toISOString();
  const previous = normalizeAgentActivityState(input.previous, { activity: "idle" });
  const previousActivity = previous.activity;
  const hasExplicitActivity = input.activity !== undefined;
  /*
  CDXC:SessionStatus 2026-06-10-11:27:
  Waking a sleeping zmx session can replay the settled terminal title before the resumed terminal has emitted fresh agent activity. Treat wake like launch/resume so stale title-derived done status cannot enter attention or play completion sounds during the initial activity suppression window.
  */
  if (input.event === "launch" || input.event === "resume" || input.event === "agentDetected" || input.event === "wake") {
    return {
      activity: "idle",
      agentName: normalizeStatusAgentName(input.agentId),
      hasSeenWorking: false,
      isAcknowledged: true,
      lastChangedAt: nowIso,
      suppressedUntil: new Date(nowMs + GXSERVER_INITIAL_ACTIVITY_SUPPRESSION_MS).toISOString(),
    };
  }

  if (input.event === "acknowledge") {
    return {
      ...previous,
      activity: "idle",
      isAcknowledged: true,
      lastChangedAt: nowIso,
    };
  }

  const titleSignal = classifyTerminalTitleStatus(input.title, input.agentId ?? previous.agentName);
  const titleTransition = resolveTitleTransition(input, previous, titleSignal, nowIso, nowMs);
  /*
  CDXC:SessionStatus 2026-06-07-09:22:
  Agent hooks are gxserver's authoritative working-state source. A plain terminal title change such as an editor command title must not downgrade explicit hook-driven working. A recognized same-title spinner stop is still trusted because Codex/Claude/Cursor/Pi expose completion by removing the title spinner rather than always sending a hook stop event.
  */
  if (
    input.event === "title" &&
    !hasExplicitActivity &&
    previous.activity === "working" &&
    previous.workingSource === "explicit" &&
    titleSignal?.state !== "attention" &&
    !isTrustedSpinnerStopTitle(input, previous, titleSignal)
  ) {
    const shouldTrackTitleWhilePreserving = titleSignal?.state === "working";
    return {
      ...previous,
      agentName: titleSignal?.agentName ?? normalizeStatusAgentName(input.agentId) ?? previous.agentName,
      lastChangedAt: previous.lastChangedAt ?? nowIso,
      ...(shouldTrackTitleWhilePreserving ? titleTransition : {}),
    };
  }
  if (
    input.event === "title" &&
    titleSignal &&
    previous.agentName !== undefined &&
    previous.agentName !== titleSignal.agentName &&
    previous.activity === "idle" &&
    !previous.hasSeenWorking
  ) {
    return {
      activity: "idle",
      agentName: titleSignal.agentName,
      hasSeenWorking: false,
      isAcknowledged: true,
      lastChangedAt: nowIso,
      ...titleTransition,
      suppressedUntil: new Date(nowMs + GXSERVER_INITIAL_ACTIVITY_SUPPRESSION_MS).toISOString(),
    };
  }

  const suppressedUntilMs = previous.suppressedUntil ? Date.parse(previous.suppressedUntil) : Number.NaN;
  if (!hasExplicitActivity && Number.isFinite(suppressedUntilMs) && nowMs < suppressedUntilMs) {
    return {
      ...previous,
      activity: "idle",
      hasSeenWorking: false,
      isAcknowledged: true,
      lastChangedAt: nowIso,
    };
  }

  const requested =
    input.activity ??
    activityFromEvent(input.event) ??
    activityFromTitleSignal(titleSignal?.state, previous, titleSignal?.agentName, input.event);
  const agentName = titleSignal?.agentName ?? normalizeStatusAgentName(input.agentId) ?? previous.agentName;

  if (requested === "working") {
    const workingSource = input.event === "title" && titleSignal?.state === "working" ? "title" : "explicit";
    if (
      workingSource === "title" &&
      isTitleDerivedWorkingStale(titleSignal?.agentName, titleTransition.lastTitleChangeAt, nowMs)
    ) {
      return stateForStaleTitleWorking(previous, agentName, titleTransition, nowIso);
    }
    /*
    CDXC:SessionStatus 2026-06-01-20:26:
    gxserver inherited the macOS title-status contract: Codex/Claude/Cursor/Pi spinner glyphs mean working only while the terminal title is still changing. Preserve the original title-change timestamp for unchanged spinner frames so a frozen glyph cannot keep every client orange forever.
    */
    return {
      activity: "working",
      agentName,
      hasSeenWorking: true,
      isAcknowledged: false,
      lastChangedAt: previousActivity === "working" ? previous.lastChangedAt ?? nowIso : nowIso,
      ...titleTransition,
      workingSource,
      workingStartedAt: previousActivity === "working" ? previous.workingStartedAt ?? nowIso : nowIso,
    };
  }

  if (requested === "attention") {
    /*
    CDXC:SessionStatus 2026-05-31-14:36:
    gxserver owns agent status transitions for every client. Codex action-required terminal titles blink between `[ ! ] Action Required` and dot frames such as `[ . ] Action Required`; all frames stay one acknowledged attention event so renderers do not replay sounds, banners, or green borders.
    */
    if (previousActivity === "attention") {
      return previous;
    }
    if (!hasExplicitActivity && previous.isAcknowledged && titleSignal?.state === "attention") {
      return {
        ...previous,
        activity: "idle",
        agentName,
        ...titleTransition,
      };
    }
    const workingStartedMs = previous.workingStartedAt ? Date.parse(previous.workingStartedAt) : Number.NaN;
    const canEnterAttention =
      hasExplicitActivity ||
      input.event === "bell" ||
      input.event === "terminalError" ||
      titleSignal?.agentName === "antigravity" ||
      (Number.isFinite(workingStartedMs) && nowMs - workingStartedMs >= GXSERVER_MIN_WORKING_DURATION_BEFORE_ATTENTION_MS);
    if (!canEnterAttention) {
      return {
        ...previous,
        activity: "idle",
        agentName,
        lastChangedAt: nowIso,
        workingSource: undefined,
        workingStartedAt: undefined,
      };
    }
    return {
      activity: "attention",
      agentName,
      attentionEventId: createAttentionEventId(nowMs),
      hasSeenWorking: true,
      isAcknowledged: false,
      lastChangedAt: nowIso,
      ...titleTransition,
      workingStartedAt: previous.workingStartedAt,
    };
  }

  return {
    ...previous,
    activity: "idle",
    agentName,
    lastChangedAt: previousActivity === "idle" ? previous.lastChangedAt ?? nowIso : nowIso,
    ...titleTransition,
    workingSource: undefined,
    workingStartedAt: undefined,
  };
}

function isTrustedSpinnerStopTitle(
  input: GxserverAgentActivityInput,
  previous: GxserverAgentActivityState,
  titleSignal: GxserverTitleStatusSignal | undefined,
): boolean {
  const title = input.event === "title" ? normalizeText(input.title) : undefined;
  const agentName = titleSignal?.agentName ?? previous.agentName;
  if (
    !title ||
    titleSignal?.state !== "idle" ||
    !requiresObservedTitleTransitions(agentName) ||
    !previous.lastTitle
  ) {
    return false;
  }
  const previousSignal = classifyTerminalTitleStatus(previous.lastTitle, agentName);
  if (previousSignal?.state !== "working") {
    return false;
  }
  const previousSignature = createTitleActivitySignature(previous.lastTitle, previousSignal);
  const currentSignature = createTitleActivitySignature(title, {
    agentName: previousSignal.agentName,
    state: "working",
  });
  return previousSignature !== undefined && previousSignature === currentSignature;
}

export function getEffectiveAgentActivityState(
  value: unknown,
  fallback: Pick<GxserverAgentActivityState, "activity"> = { activity: "idle" },
  nowMs = Date.now(),
): GxserverAgentActivityState {
  const state = normalizeAgentActivityState(value, fallback);
  if (!isStoredTitleDerivedWorkingStale(state, nowMs)) {
    return state;
  }
  return stateForStaleTitleWorking(state, state.agentName, {
    lastTitle: state.lastTitle,
    lastTitleChangeAt: state.lastTitleChangeAt,
  }, new Date(nowMs).toISOString());
}

export function getAgentActivityStaleProjectionDelayMs(
  value: unknown,
  nowMs = Date.now(),
): number | undefined {
  const state = normalizeAgentActivityState(value, { activity: "idle" });
  if (
    state.activity !== "working" ||
    state.workingSource === "explicit" ||
    !state.lastTitleChangeAt ||
    !requiresObservedTitleTransitions(state.agentName)
  ) {
    return undefined;
  }
  const lastTitleChangeMs = Date.parse(state.lastTitleChangeAt);
  if (!Number.isFinite(lastTitleChangeMs)) {
    return undefined;
  }
  return Math.max(0, lastTitleChangeMs + getTitleActivityWindowMs(state.agentName) - nowMs);
}

export function normalizeAgentActivityState(
  value: unknown,
  fallback: Pick<GxserverAgentActivityState, "activity">,
): GxserverAgentActivityState {
  const record = normalizeObject(value);
  return {
    activity: normalizeActivity(record.activity) ?? fallback.activity,
    agentName: normalizeStatusAgentName(normalizeText(record.agentName)),
    attentionEventId: normalizeText(record.attentionEventId),
    hasSeenWorking: readBoolean(record.hasSeenWorking),
    isAcknowledged: readBoolean(record.isAcknowledged),
    lastChangedAt: normalizeText(record.lastChangedAt),
    lastTitle: normalizeText(record.lastTitle),
    lastTitleChangeAt: normalizeText(record.lastTitleChangeAt),
    suppressedUntil: normalizeText(record.suppressedUntil),
    workingSource: normalizeWorkingSource(record.workingSource),
    workingStartedAt: normalizeText(record.workingStartedAt),
  };
}

export function normalizeActivity(value: unknown): GxserverAgentActivityState["activity"] | undefined {
  return value === "idle" || value === "working" || value === "attention" ? value : undefined;
}

export function normalizeActivityEvent(value: unknown): GxserverAgentActivityEvent | undefined {
  return value === "launch" ||
    value === "resume" ||
    value === "wake" ||
    value === "agentDetected" ||
    value === "title" ||
    value === "bell" ||
    value === "terminalError" ||
    value === "terminalExited" ||
    value === "acknowledge"
    ? value
    : undefined;
}

export function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function activityFromEvent(event: GxserverAgentActivityEvent | undefined): GxserverAgentActivityState["activity"] | undefined {
  if (event === "bell" || event === "terminalError") {
    return "attention";
  }
  if (event === "terminalExited") {
    return "idle";
  }
  return undefined;
}

function activityFromTitleSignal(
  signal: "attention" | "idle" | "working" | undefined,
  previous: GxserverAgentActivityState,
  agentName: string | undefined,
  event: GxserverAgentActivityEvent | undefined,
): GxserverAgentActivityState["activity"] | undefined {
  if (signal === "working" || signal === "attention") {
    return signal;
  }
  if (signal === "idle") {
    const sameAgent = previous.agentName === undefined || agentName === undefined || previous.agentName === agentName;
    return sameAgent && previous.hasSeenWorking && !previous.isAcknowledged ? "attention" : "idle";
  }
  if (event === "title" && previous.hasSeenWorking) {
    return previous.isAcknowledged ? "idle" : "attention";
  }
  return undefined;
}

function resolveTitleTransition(
  input: GxserverAgentActivityInput,
  previous: GxserverAgentActivityState,
  titleSignal: GxserverTitleStatusSignal | undefined,
  nowIso: string,
  nowMs: number,
): Pick<GxserverAgentActivityState, "lastTitle" | "lastTitleChangeAt"> {
  const title = input.event === "title" ? normalizeText(input.title) : undefined;
  if (!title) {
    return {
      lastTitle: previous.lastTitle,
      lastTitleChangeAt: previous.lastTitleChangeAt,
    };
  }
  const sameAgent = previous.agentName === undefined ||
    titleSignal?.agentName === undefined ||
    previous.agentName === titleSignal.agentName;
  const sameTitle = previous.lastTitle?.trim() === title.trim();
  const shouldKeepPreviousTitleChangeAt =
    sameAgent &&
    (sameTitle || isWithinSameSemanticTitleHeartbeat(previous, title, titleSignal, nowMs));
  return {
    lastTitle: title,
    lastTitleChangeAt: shouldKeepPreviousTitleChangeAt ? previous.lastTitleChangeAt ?? nowIso : nowIso,
  };
}

function isWithinSameSemanticTitleHeartbeat(
  previous: GxserverAgentActivityState,
  title: string,
  titleSignal: GxserverTitleStatusSignal | undefined,
  nowMs: number,
): boolean {
  if (
    titleSignal?.state !== "working" ||
    !requiresObservedTitleTransitions(titleSignal.agentName) ||
    !previous.lastTitle ||
    !previous.lastTitleChangeAt
  ) {
    return false;
  }
  const lastTitleChangeMs = Date.parse(previous.lastTitleChangeAt);
  if (!Number.isFinite(lastTitleChangeMs)) {
    return false;
  }
  if (nowMs - lastTitleChangeMs >= GXSERVER_TITLE_ACTIVITY_HEARTBEAT_MS) {
    return false;
  }
  return (
    createTitleActivitySignature(previous.lastTitle, titleSignal) ===
    createTitleActivitySignature(title, titleSignal)
  );
}

function isTitleDerivedWorkingStale(
  agentName: GxserverSessionStatusAgentName | undefined,
  lastTitleChangeAt: string | undefined,
  nowMs: number,
): boolean {
  if (!requiresObservedTitleTransitions(agentName)) {
    return false;
  }
  const lastTitleChangeMs = lastTitleChangeAt ? Date.parse(lastTitleChangeAt) : Number.NaN;
  return !Number.isFinite(lastTitleChangeMs) || nowMs - lastTitleChangeMs > getTitleActivityWindowMs(agentName);
}

function isStoredTitleDerivedWorkingStale(state: GxserverAgentActivityState, nowMs: number): boolean {
  return (
    state.activity === "working" &&
    state.workingSource !== "explicit" &&
    state.lastTitleChangeAt !== undefined &&
    isTitleDerivedWorkingStale(state.agentName, state.lastTitleChangeAt, nowMs)
  );
}

function stateForStaleTitleWorking(
  previous: GxserverAgentActivityState,
  agentName: GxserverSessionStatusAgentName | undefined,
  titleTransition: Pick<GxserverAgentActivityState, "lastTitle" | "lastTitleChangeAt">,
  nowIso: string,
): GxserverAgentActivityState {
  const nextActivity = previous.hasSeenWorking && !previous.isAcknowledged ? "attention" : "idle";
  return {
    ...previous,
    activity: nextActivity,
    agentName,
    lastChangedAt: previous.activity === nextActivity ? previous.lastChangedAt ?? nowIso : nowIso,
    ...titleTransition,
    workingSource: undefined,
    workingStartedAt: undefined,
  };
}

function createAttentionEventId(nowMs: number): string {
  return `attn_${nowMs.toString(36)}`;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeWorkingSource(value: unknown): GxserverAgentActivityState["workingSource"] | undefined {
  return value === "explicit" || value === "title" ? value : undefined;
}
