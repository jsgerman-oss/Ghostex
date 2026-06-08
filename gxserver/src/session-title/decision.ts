import type { GxserverSessionDomainState } from "../../protocol/index.js";
import {
  getCodexSessionIdFromTitle,
  getVisibleTerminalTitle,
  isEllipsizedTerminalWindowTitle,
} from "./normalization.js";
import { projectSessionTitle } from "./projection.js";
import {
  getSessionTitleSource,
  getTrustedResumeTitle,
  isRejectedResumeTitle,
  isValidAgentTerminalTitle,
} from "./trust.js";
import type {
  GxserverSessionTitleDecision,
  GxserverTerminalTitleEventParams,
} from "./types.js";

export function decideTerminalTitleEvent(
  session: GxserverSessionDomainState,
  params: GxserverTerminalTitleEventParams,
): GxserverSessionTitleDecision {
  const visibleTitle = getVisibleTerminalTitle(params.rawTitle);
  const agentName = params.agentName ?? normalizeText(session.runtimeSettings.agentName) ?? session.agentId;
  const capturedAgentSessionId = getCapturedAgentSessionId(session, params.rawTitle, agentName);
  const runtimeSettings = capturedAgentSessionId
    ? {
        ...session.runtimeSettings,
        agentSessionId: capturedAgentSessionId,
      }
    : session.runtimeSettings;

  if (session.kind !== "terminal" && session.kind !== "agent") {
    return skipped(session, params.rawTitle, "invalid-session-kind", visibleTitle, runtimeSettings, capturedAgentSessionId);
  }
  if (!visibleTitle) {
    return skipped(session, params.rawTitle, capturedAgentSessionId ? "captured-agent-session-id" : "terminal-title-not-visible", visibleTitle, runtimeSettings, capturedAgentSessionId);
  }
  if (isEllipsizedTerminalWindowTitle(visibleTitle)) {
    return skipped(session, params.rawTitle, "terminal-title-already-ellipsized", visibleTitle, runtimeSettings, capturedAgentSessionId);
  }
  if (
    params.protectStoredTitleFromAutomation === true &&
    getTrustedResumeTitle({ ...session, runtimeSettings }).title !== undefined
  ) {
    return {
      ...skipped(session, undefined, "protected-stored-title", visibleTitle, runtimeSettings, capturedAgentSessionId),
      visibleTitle,
    };
  }
  if (session.title.trim() === visibleTitle) {
    return skipped(session, params.rawTitle, capturedAgentSessionId ? "captured-agent-session-id" : "already-synced", visibleTitle, runtimeSettings, capturedAgentSessionId);
  }

  const titleSource = getSessionTitleSource({ ...session, runtimeSettings });
  const reason = getTerminalTitleSyncReason({
    agentName,
    previousTerminalTitle: params.previousTerminalTitle,
    session,
    sessionPersistenceProvider: params.sessionPersistenceProvider ?? "zmx",
    visibleTitle,
  });
  if (!reason) {
    return skipped(session, params.rawTitle, "terminal-title-not-trusted", visibleTitle, runtimeSettings, capturedAgentSessionId);
  }

  const nextRuntimeSettings = {
    ...runtimeSettings,
    titleSource: "terminal-auto",
  };
  const nextSession = {
    ...session,
    runtimeSettings: nextRuntimeSettings,
    title: visibleTitle,
  };
  /*
  CDXC:SessionTitleSync 2026-05-31-15:00:
  gxserver is the title reducer for terminal title events. Clients provide raw
  terminal observations; gxserver decides whether the title is canonical,
  updates provenance, and returns the projection a dumb client should render.
  */
  return {
    agentSessionId: capturedAgentSessionId,
    changed: true,
    projection: projectSessionTitle(nextSession, params.rawTitle),
    reason: `${reason}-from-${titleSource}` as GxserverSessionTitleDecision["reason"],
    runtimeSettings: nextRuntimeSettings,
    shouldUpdateSession: true,
    title: visibleTitle,
    titleSource: "terminal-auto",
    visibleTitle,
  };
}

function getTerminalTitleSyncReason(args: {
  agentName?: string;
  previousTerminalTitle?: string;
  session: GxserverSessionDomainState;
  sessionPersistenceProvider?: "off" | "tmux" | "zellij" | "zmx";
  visibleTitle: string;
}): "valid-agent-terminal-title" | "zmx-terminal-title" | undefined {
  if (isValidAgentTerminalTitle(args.visibleTitle, args.agentName)) {
    return "valid-agent-terminal-title";
  }
  if (
    args.sessionPersistenceProvider !== undefined &&
    args.sessionPersistenceProvider !== "off" &&
    !isRejectedResumeTitle(args.visibleTitle)
  ) {
    return "zmx-terminal-title";
  }
  const previousVisibleTitle = getVisibleTerminalTitle(args.previousTerminalTitle);
  if (previousVisibleTitle !== undefined && args.session.title.trim() === previousVisibleTitle) {
    return undefined;
  }
  return undefined;
}

function skipped(
  session: GxserverSessionDomainState,
  rawTitle: string | undefined,
  reason: GxserverSessionTitleDecision["reason"],
  visibleTitle: string | undefined,
  runtimeSettings: Record<string, unknown>,
  agentSessionId: string | undefined,
): GxserverSessionTitleDecision {
  const runtimeChanged = agentSessionId !== undefined && agentSessionId !== normalizeText(session.runtimeSettings.agentSessionId);
  return {
    agentSessionId,
    changed: runtimeChanged,
    projection: projectSessionTitle({ ...session, runtimeSettings }, rawTitle),
    reason,
    runtimeSettings,
    shouldUpdateSession: runtimeChanged,
    visibleTitle,
  };
}

function getCapturedAgentSessionId(
  session: GxserverSessionDomainState,
  rawTitle: string | undefined,
  agentName: string | undefined,
): string | undefined {
  const codexSessionId = getCodexSessionIdFromTitle(rawTitle);
  if (!codexSessionId || normalizeAgentId(agentName) !== "codex") {
    return undefined;
  }
  return normalizeText(session.runtimeSettings.agentSessionId) === codexSessionId
    ? undefined
    : codexSessionId;
}

function normalizeAgentId(agentName: string | undefined): string | undefined {
  const normalized = agentName?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return normalized === "codex cli" || normalized === "openai codex" ? "codex" : normalized;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
