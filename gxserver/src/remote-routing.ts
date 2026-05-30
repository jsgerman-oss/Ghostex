import type {
  GxserverGlobalSessionRef,
  GxserverProjectId,
  GxserverRouteRef,
  GxserverServerId,
  GxserverSessionId,
} from "../protocol/index.js";

export class GxserverRemoteRoutingError extends Error {
  readonly code: "badRequest" | "notFound";

  constructor(code: "badRequest" | "notFound", message: string) {
    super(message);
    this.code = code;
    this.name = "GxserverRemoteRoutingError";
  }
}

/*
CDXC:GxserverMultiServerRouting 2026-05-30-15:25:
Remote support starts with multiple simultaneous gxserver targets. Session-scoped actions must carry `serverId`, `projectId`, and `sessionId`; global refs are only a compact representation of that route and never imply that the local daemon should proxy another server.
*/
export function parseGxserverGlobalSessionRef(value: unknown): GxserverRouteRef | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^(S[0-9][a-z0-9]*):(P[0-9][a-z0-9]*):(G[0-9][a-z0-9]*)$/u.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return {
    projectId: match[2] as GxserverProjectId,
    serverId: match[1] as GxserverServerId,
    sessionId: match[3] as GxserverSessionId,
  };
}

export function requireGxserverRouteRef(input: {
  globalRef?: unknown;
  projectId?: unknown;
  serverId?: unknown;
  sessionId?: unknown;
}): Required<GxserverRouteRef> {
  const parsed = parseGxserverGlobalSessionRef(input.globalRef);
  const serverId = normalizeServerId(input.serverId ?? parsed?.serverId);
  const projectId = normalizeProjectId(input.projectId ?? parsed?.projectId);
  const sessionId = normalizeSessionId(input.sessionId ?? parsed?.sessionId);
  return { projectId, serverId, sessionId };
}

export function findRouteRefCandidate(value: unknown): GxserverRouteRef | undefined {
  const parsed = parseGxserverGlobalSessionRef(value);
  if (parsed) {
    return parsed;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["globalRef", "sessionId", "target", "selector"]) {
      const nested = parseGxserverGlobalSessionRef(record[key]);
      if (nested) {
        return nested;
      }
    }
    if (record.serverId || record.projectId || record.sessionId) {
      return {
        ...(typeof record.projectId === "string" ? { projectId: record.projectId as GxserverProjectId } : {}),
        ...(typeof record.serverId === "string" ? { serverId: record.serverId as GxserverServerId } : {}),
        ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId as GxserverSessionId } : {}),
      } as GxserverRouteRef;
    }
  }
  return undefined;
}

function normalizeServerId(value: unknown): GxserverServerId {
  const text = String(value ?? "").trim();
  if (!/^S[0-9][a-z0-9]*$/u.test(text)) {
    throw new GxserverRemoteRoutingError("badRequest", "serverId is required for multi-server gxserver routing.");
  }
  return text as GxserverServerId;
}

function normalizeProjectId(value: unknown): GxserverProjectId {
  const text = String(value ?? "").trim();
  if (!/^P[0-9][a-z0-9]*$/u.test(text)) {
    throw new GxserverRemoteRoutingError("badRequest", "projectId is required for session-scoped gxserver routing.");
  }
  return text as GxserverProjectId;
}

function normalizeSessionId(value: unknown): GxserverSessionId {
  const text = String(value ?? "").trim();
  if (!/^G[0-9][a-z0-9]*$/u.test(text)) {
    throw new GxserverRemoteRoutingError("badRequest", "sessionId is required for session-scoped gxserver routing.");
  }
  return text as GxserverSessionId;
}
