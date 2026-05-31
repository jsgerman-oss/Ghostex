import type {
  GxserverAgentActivityEvent,
  GxserverAgentActivityInput,
  GxserverAgentActivityState,
} from "../../protocol/index.js";
import { classifyTerminalTitleStatus, normalizeStatusAgentName } from "./title-classifier.js";

export const GXSERVER_INITIAL_ACTIVITY_SUPPRESSION_MS = 12_000;
export const GXSERVER_MIN_WORKING_DURATION_BEFORE_ATTENTION_MS = 5_000;

export function applyAgentActivityTransition(input: GxserverAgentActivityInput): GxserverAgentActivityState {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = input.nowIso ?? new Date(nowMs).toISOString();
  const previous = normalizeAgentActivityState(input.previous, { activity: "idle" });
  const previousActivity = previous.activity;
  if (input.event === "launch" || input.event === "resume" || input.event === "agentDetected") {
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
  if (
    input.event === "title" &&
    titleSignal &&
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
      suppressedUntil: new Date(nowMs + GXSERVER_INITIAL_ACTIVITY_SUPPRESSION_MS).toISOString(),
    };
  }

  const suppressedUntilMs = previous.suppressedUntil ? Date.parse(previous.suppressedUntil) : Number.NaN;
  if (Number.isFinite(suppressedUntilMs) && nowMs < suppressedUntilMs) {
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
    activityFromTitleSignal(titleSignal?.state, previous, titleSignal?.agentName);
  const agentName = titleSignal?.agentName ?? normalizeStatusAgentName(input.agentId) ?? previous.agentName;

  if (requested === "working") {
    return {
      activity: "working",
      agentName,
      hasSeenWorking: true,
      isAcknowledged: false,
      lastChangedAt: previousActivity === "working" ? previous.lastChangedAt ?? nowIso : nowIso,
      lastTitleChangeAt: previousActivity === "working" ? previous.lastTitleChangeAt ?? nowIso : nowIso,
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
    if (previous.isAcknowledged && titleSignal?.state === "attention") {
      return {
        ...previous,
        activity: "idle",
        agentName,
      };
    }
    const workingStartedMs = previous.workingStartedAt ? Date.parse(previous.workingStartedAt) : Number.NaN;
    const canEnterAttention =
      input.event === "bell" ||
      input.event === "terminalError" ||
      (Number.isFinite(workingStartedMs) && nowMs - workingStartedMs >= GXSERVER_MIN_WORKING_DURATION_BEFORE_ATTENTION_MS);
    if (!canEnterAttention) {
      return {
        ...previous,
        activity: "idle",
        agentName,
        lastChangedAt: nowIso,
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
      workingStartedAt: previous.workingStartedAt,
    };
  }

  return {
    ...previous,
    activity: "idle",
    agentName,
    lastChangedAt: previousActivity === "idle" ? previous.lastChangedAt ?? nowIso : nowIso,
    workingStartedAt: undefined,
  };
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
    lastTitleChangeAt: normalizeText(record.lastTitleChangeAt),
    suppressedUntil: normalizeText(record.suppressedUntil),
    workingStartedAt: normalizeText(record.workingStartedAt),
  };
}

export function normalizeActivity(value: unknown): GxserverAgentActivityState["activity"] | undefined {
  return value === "idle" || value === "working" || value === "attention" ? value : undefined;
}

export function normalizeActivityEvent(value: unknown): GxserverAgentActivityEvent | undefined {
  return value === "launch" ||
    value === "resume" ||
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
): GxserverAgentActivityState["activity"] | undefined {
  if (signal === "working" || signal === "attention") {
    return signal;
  }
  if (signal === "idle") {
    const sameAgent = previous.agentName === undefined || agentName === undefined || previous.agentName === agentName;
    return sameAgent && previous.hasSeenWorking && !previous.isAcknowledged ? "attention" : "idle";
  }
  return undefined;
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
