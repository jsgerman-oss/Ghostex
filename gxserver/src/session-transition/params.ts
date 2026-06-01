import { GxserverDomainStateError } from "../domain-state.js";
import { isGxserverProjectId, isGxserverSessionId } from "../ids.js";
import type {
  GxserverDomainLifecycleState,
  GxserverSessionTransitionParams,
  GxserverSessionTransitionOrigin,
  GxserverSessionTransitionOriginSession,
} from "../../protocol/index.js";

/*
CDXC:SessionTransition 2026-06-01-10:51:
Close and sleep focus selection is a gxserver contract shared by macOS, iOS, Android, and TUI clients. Clients send the visual order they rendered, while gxserver validates the transition request and owns lifecycle-aware target selection instead of each client inventing close-focus rules.
*/
export function normalizeSessionTransitionParams(
  params: Record<string, unknown>,
): GxserverSessionTransitionParams {
  if (!isGxserverProjectId(params.projectId)) {
    throw new GxserverDomainStateError("badRequest", `Invalid gxserver project ID: ${String(params.projectId)}.`);
  }
  if (!isGxserverSessionId(params.sessionId)) {
    throw new GxserverDomainStateError("badRequest", `Invalid gxserver session ID: ${String(params.sessionId)}.`);
  }
  if (params.action !== "close" && params.action !== "sleep") {
    throw new GxserverDomainStateError("badRequest", `Invalid session transition action: ${String(params.action)}.`);
  }

  return {
    action: params.action,
    origin: normalizeTransitionOrigin(params.origin),
    projectId: params.projectId,
    reason: typeof params.reason === "string" ? params.reason : undefined,
    sessionId: params.sessionId,
  };
}

function normalizeTransitionOrigin(value: unknown): GxserverSessionTransitionOrigin {
  if (!isRecord(value)) {
    throw new GxserverDomainStateError("badRequest", "Session transition origin must be an object.");
  }
  if (value.kind !== "projectSessionList" && value.kind !== "paneTabGroup") {
    throw new GxserverDomainStateError("badRequest", `Invalid session transition origin: ${String(value.kind)}.`);
  }
  if (!Array.isArray(value.orderedSessions)) {
    throw new GxserverDomainStateError("badRequest", "Session transition origin orderedSessions must be an array.");
  }
  const orderedSessions: GxserverSessionTransitionOriginSession[] = [];
  for (const rawSession of value.orderedSessions) {
    if (!isRecord(rawSession) || typeof rawSession.sessionId !== "string" || rawSession.sessionId.trim() === "") {
      throw new GxserverDomainStateError("badRequest", "Session transition origin orderedSessions entries must include sessionId.");
    }
    const sessionId = rawSession.sessionId.trim();
    if (value.kind === "projectSessionList" && !isGxserverSessionId(sessionId)) {
      throw new GxserverDomainStateError("badRequest", `Invalid gxserver session ID in orderedSessions: ${String(sessionId)}.`);
    }
    if (orderedSessions.some((entry) => entry.sessionId === sessionId)) {
      continue;
    }
    const lifecycleState = normalizeLifecycleState(rawSession.lifecycleState);
    orderedSessions.push(lifecycleState ? { lifecycleState, sessionId } : { sessionId });
  }
  if (orderedSessions.length === 0) {
    throw new GxserverDomainStateError("badRequest", "Session transition origin orderedSessions must not be empty.");
  }
  if (value.kind === "projectSessionList") {
    return {
      kind: value.kind,
      orderedSessions: orderedSessions as Extract<
        GxserverSessionTransitionOrigin,
        { kind: "projectSessionList" }
      >["orderedSessions"],
    };
  }
  return {
    kind: value.kind,
    orderedSessions,
  };
}

function normalizeLifecycleState(value: unknown): GxserverDomainLifecycleState | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "running" || value === "sleeping" || value === "stopped" || value === "missing" || value === "unknown") {
    return value;
  }
  throw new GxserverDomainStateError("badRequest", `Invalid session transition lifecycleState: ${String(value)}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
