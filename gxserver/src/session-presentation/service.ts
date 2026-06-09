import type {
  GxserverProjectDomainState,
  GxserverProjectId,
  GxserverSessionDomainState,
  GxserverSessionId,
  GxserverSessionStateEventParams,
  GxserverSessionStateEventResult,
  GxserverUpdateSessionParams,
} from "../../protocol/index.js";
import { projectSessionTitle } from "../session-title/projection.js";
import { getTrustedResumeTitle } from "../session-title/trust.js";
import {
  normalizeAgentId,
  normalizeCodexSessionId,
  normalizeText,
  resolveSessionIdentity,
  type GxserverResolvedSessionIdentity,
} from "./identity.js";
import { selectTrustedTitleForIdentity } from "./title-candidates.js";

export interface GxserverSessionPresentationRepository {
  getProject(projectId: GxserverSessionStateEventParams["projectId"]): GxserverProjectDomainState | undefined;
  getSession(
    projectId: GxserverSessionStateEventParams["projectId"],
    sessionId: GxserverSessionStateEventParams["sessionId"],
  ): GxserverSessionDomainState | undefined;
  listSessions(projectId?: GxserverSessionStateEventParams["projectId"]): GxserverSessionDomainState[];
  updateSession(input: GxserverUpdateSessionParams): GxserverSessionDomainState;
}

export type GxserverSessionIdentityUpdateSource = "lifecycle" | "passive" | "terminal-title";

export interface GxserverSessionIdentityConflict {
  agentId: string;
  currentAgentSessionId?: string;
  incomingAgentSessionId: string;
  ownerProjectId?: GxserverProjectId;
  ownerSessionId?: GxserverSessionId;
  reason: "active-agent-session-id-owned" | "passive-agent-session-id-replacement";
  source: GxserverSessionIdentityUpdateSource;
}

export type GxserverApplySessionStateEventParams = GxserverSessionStateEventParams & {
  identityUpdateSource?: GxserverSessionIdentityUpdateSource;
  onIdentityConflict?: (conflict: GxserverSessionIdentityConflict) => void;
};

export function applySessionStateEvent(
  repository: GxserverSessionPresentationRepository,
  params: GxserverApplySessionStateEventParams,
): GxserverSessionStateEventResult {
  const session = repository.getSession(params.projectId, params.sessionId);
  if (!session) {
    throw new Error(`Session ${params.projectId}/${params.sessionId} does not exist.`);
  }
  const project = repository.getProject(params.projectId);
  if (!project) {
    throw new Error(`Project ${params.projectId} does not exist.`);
  }

  const projectSessions = repository.listSessions(params.projectId);
  const observedIdentity = resolveSessionIdentity({
    agentName: params.agentName,
    agentSessionId: params.agentSessionId,
    agentSessionPath: params.agentSessionPath,
    startupText: params.startupText,
  });
  const currentIdentity = resolveStoredSessionIdentity(session);
  const resolvedIdentity = mergeObservedSessionIdentity(observedIdentity, currentIdentity);
  const identity = resolveAllowedSessionIdentity({
    currentIdentity,
    currentSession: session,
    observedIdentity,
    onIdentityConflict: params.onIdentityConflict,
    resolvedIdentity,
    sessions: projectSessions,
    source: params.identityUpdateSource ?? "passive",
  });
  const nextAgentId = identity.agentId ?? session.agentId;
  let runtimeSettings = applySessionIdentityRuntimeSettings({
    currentIdentity,
    identity,
    runtimeSettings: session.runtimeSettings,
  });
  runtimeSettings = {
    ...runtimeSettings,
    ...("firstPromptTitleGenerationAgent" in params && params.firstPromptTitleGenerationAgent
      ? { firstPromptTitleGenerationAgent: params.firstPromptTitleGenerationAgent }
      : {}),
    ...("firstPromptTitleGenerationCommand" in params
      ? { firstPromptTitleGenerationCommand: params.firstPromptTitleGenerationCommand }
      : {}),
    ...(params.firstUserMessage ? { firstUserMessage: params.firstUserMessage } : {}),
  };
  const shouldPromoteAgentKind = Boolean(nextAgentId || identity.agentSessionId || identity.agentSessionPath);
  let title = session.title;
  let reason = "identity-updated";
  const currentWithIdentity: GxserverSessionDomainState = {
    ...session,
    ...(nextAgentId ? { agentId: nextAgentId } : {}),
    kind: shouldPromoteAgentKind ? "agent" : session.kind,
    runtimeSettings,
  };

  if (getTrustedResumeTitle(currentWithIdentity).title === undefined) {
    const candidate = selectTrustedTitleForIdentity({
      currentSession: currentWithIdentity,
      eventTitle: params.title,
      eventTitleSource: params.titleSource,
      identity,
      project,
      sessions: projectSessions,
    });
    if (candidate) {
      title = candidate.title;
      runtimeSettings = {
        ...runtimeSettings,
        titleSource: candidate.titleSource,
      };
      reason = candidate.reason;
    }
  } else {
    reason = "current-title-already-trusted";
  }

  const needsUpdate =
    title !== session.title ||
    nextAgentId !== session.agentId ||
    (shouldPromoteAgentKind && session.kind !== "agent") ||
    runtimeSettings.agentName !== session.runtimeSettings.agentName ||
    runtimeSettings.agentId !== session.runtimeSettings.agentId ||
    runtimeSettings.agentSessionId !== session.runtimeSettings.agentSessionId ||
    runtimeSettings.agentSessionPath !== session.runtimeSettings.agentSessionPath ||
    runtimeSettings.firstPromptTitleGenerationAgent !==
      session.runtimeSettings.firstPromptTitleGenerationAgent ||
    runtimeSettings.firstPromptTitleGenerationCommand !==
      session.runtimeSettings.firstPromptTitleGenerationCommand ||
    runtimeSettings.firstUserMessage !== session.runtimeSettings.firstUserMessage ||
    runtimeSettings.titleSource !== session.runtimeSettings.titleSource;

  if (!needsUpdate) {
    return {
      changed: false,
      projection: projectSessionTitle(currentWithIdentity),
      reason: "unchanged",
      session: currentWithIdentity,
    };
  }

  /*
  CDXC:GxserverSessionPresentation 2026-05-31-21:10:
  macOS main previously coupled hook-captured agent identity, trusted title provenance, previous-session history, and restore protection in the sidebar. gxserver now performs that reduction so every client sees the same Codex/Claude/Cursor/OpenCode/Pi identity and title instead of rendering placeholder `Terminal Session` rows after resume.
  */
  const updated = repository.updateSession({
    ...(nextAgentId ? { agentId: nextAgentId } : {}),
    kind: shouldPromoteAgentKind ? "agent" : session.kind,
    projectId: params.projectId,
    runtimeSettings,
    sessionId: params.sessionId,
    title,
  });
  return {
    changed: true,
    projection: projectSessionTitle(updated),
    reason,
    session: updated,
  };
}

function resolveAllowedSessionIdentity(input: {
  currentIdentity: GxserverResolvedSessionIdentity;
  currentSession: GxserverSessionDomainState;
  observedIdentity: GxserverResolvedSessionIdentity;
  onIdentityConflict?: (conflict: GxserverSessionIdentityConflict) => void;
  resolvedIdentity: GxserverResolvedSessionIdentity;
  sessions: readonly GxserverSessionDomainState[];
  source: GxserverSessionIdentityUpdateSource;
}): GxserverResolvedSessionIdentity {
  const observedAgentId = normalizeAgentId(input.observedIdentity.agentId);
  const currentAgentId = normalizeAgentId(input.currentIdentity.agentId);
  const resolvedAgentId = normalizeAgentId(input.resolvedIdentity.agentId);
  const incomingAgentSessionId = normalizeCodexSessionId(input.observedIdentity.agentSessionId);
  const currentAgentSessionId = normalizeCodexSessionId(input.currentIdentity.agentSessionId);
  const isPassiveCodexObservation =
    input.source === "passive" &&
    incomingAgentSessionId !== undefined &&
    (observedAgentId === "codex" || (!observedAgentId && currentAgentId === "codex" && resolvedAgentId === "codex"));
  if (!isPassiveCodexObservation) {
    return input.resolvedIdentity;
  }
  if (currentAgentSessionId && currentAgentSessionId !== incomingAgentSessionId) {
    input.onIdentityConflict?.({
      agentId: "codex",
      currentAgentSessionId,
      incomingAgentSessionId,
      reason: "passive-agent-session-id-replacement",
      source: input.source,
    });
    /*
    CDXC:GxserverSessionIdentity 2026-06-09-08:55:
    Passive hook/session-state observations may be delayed or cross-wired between live Codex terminals. Keep Codex identity switchable through terminal-title and lifecycle evidence, but do not let a passive event replace an existing thread id because title reconciliation treats that id as canonical for every client.

    CDXC:GxserverSessionIdentity 2026-06-09-09:58:
    A Cursor hook may use a UUID-shaped session id, so only apply Codex passive-id protection when the observed event is Codex or when the current Codex row receives an otherwise anonymous UUID. Explicit Cursor agent names and Cursor transcript paths must correct stale Codex rows at the gxserver domain layer so every client receives the same icon/search/resume identity.
    */
    return keepCurrentSessionIdentity(input.resolvedIdentity, input.currentIdentity);
  }
  if (!currentAgentSessionId) {
    const owner = findActiveCodexIdentityOwner(input.sessions, input.currentSession, incomingAgentSessionId);
    if (owner) {
      input.onIdentityConflict?.({
        agentId: "codex",
        incomingAgentSessionId,
        ownerProjectId: owner.projectId,
        ownerSessionId: owner.sessionId,
        reason: "active-agent-session-id-owned",
        source: input.source,
      });
      return keepCurrentSessionIdentity(input.resolvedIdentity, input.currentIdentity);
    }
  }
  return input.resolvedIdentity;
}

function keepCurrentSessionIdentity(
  resolvedIdentity: GxserverResolvedSessionIdentity,
  currentIdentity: GxserverResolvedSessionIdentity,
): GxserverResolvedSessionIdentity {
  const currentAgentSessionId = normalizeText(currentIdentity.agentSessionId);
  const currentAgentSessionPath = normalizeText(currentIdentity.agentSessionPath);
  return {
    ...(resolvedIdentity.agentId ? { agentId: resolvedIdentity.agentId } : {}),
    ...(currentAgentSessionId ? { agentSessionId: currentAgentSessionId } : {}),
    ...(currentAgentSessionPath ? { agentSessionPath: currentAgentSessionPath } : {}),
  };
}

function mergeObservedSessionIdentity(
  observedIdentity: GxserverResolvedSessionIdentity,
  currentIdentity: GxserverResolvedSessionIdentity,
): GxserverResolvedSessionIdentity {
  const observedAgentId = normalizeAgentId(observedIdentity.agentId);
  const currentAgentId = normalizeAgentId(currentIdentity.agentId);
  const agentChanged = Boolean(observedAgentId && currentAgentId && observedAgentId !== currentAgentId);
  const agentId = observedAgentId ?? currentAgentId;
  const agentSessionId =
    normalizeText(observedIdentity.agentSessionId) ??
    (!agentChanged ? normalizeText(currentIdentity.agentSessionId) : undefined);
  const agentSessionPath =
    normalizeText(observedIdentity.agentSessionPath) ??
    (!agentChanged ? normalizeText(currentIdentity.agentSessionPath) : undefined);
  return {
    ...(agentId ? { agentId } : {}),
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(agentSessionPath ? { agentSessionPath } : {}),
  };
}

function resolveStoredSessionIdentity(session: GxserverSessionDomainState): GxserverResolvedSessionIdentity {
  const storedIdentity = resolveSessionIdentity({
    agentId: session.agentId,
    agentName: session.runtimeSettings.agentName,
    agentSessionId: session.runtimeSettings.agentSessionId,
    agentSessionPath: session.runtimeSettings.agentSessionPath,
  });
  const transcriptPathIdentity = resolveSessionIdentity({
    agentSessionId: session.runtimeSettings.agentSessionId,
    agentSessionPath: session.runtimeSettings.agentSessionPath,
  });
  return mergeObservedSessionIdentity(transcriptPathIdentity, storedIdentity);
}

function applySessionIdentityRuntimeSettings(input: {
  currentIdentity: GxserverResolvedSessionIdentity;
  identity: GxserverResolvedSessionIdentity;
  runtimeSettings: Record<string, unknown>;
}): Record<string, unknown> {
  const runtimeSettings = { ...input.runtimeSettings };
  const currentAgentId = normalizeAgentId(input.currentIdentity.agentId);
  const nextAgentId = normalizeAgentId(input.identity.agentId);
  const agentChanged = Boolean(currentAgentId && nextAgentId && currentAgentId !== nextAgentId);
  if (input.identity.agentId) {
    runtimeSettings.agentName = input.identity.agentId;
  }
  if (input.identity.agentSessionId) {
    runtimeSettings.agentSessionId = input.identity.agentSessionId;
  } else if (agentChanged) {
    delete runtimeSettings.agentSessionId;
  }
  if (input.identity.agentSessionPath) {
    runtimeSettings.agentSessionPath = input.identity.agentSessionPath;
  } else if (agentChanged) {
    delete runtimeSettings.agentSessionPath;
  }
  if (agentChanged) {
    delete runtimeSettings.agentId;
  }
  return runtimeSettings;
}

function findActiveCodexIdentityOwner(
  sessions: readonly GxserverSessionDomainState[],
  currentSession: GxserverSessionDomainState,
  incomingAgentSessionId: string,
): GxserverSessionDomainState | undefined {
  return sessions.find((session) => {
    if (session.sessionId === currentSession.sessionId && session.projectId === currentSession.projectId) {
      return false;
    }
    if (!isActiveIdentityOwner(session)) {
      return false;
    }
    const identity = resolveSessionIdentity({
      agentId: session.agentId,
      runtimeSettings: session.runtimeSettings,
    });
    return normalizeAgentId(identity.agentId) === "codex" && normalizeCodexSessionId(identity.agentSessionId) === incomingAgentSessionId;
  });
}

function isActiveIdentityOwner(session: GxserverSessionDomainState): boolean {
  return (
    session.lifecycleState === "running" ||
    session.lifecycleState === "sleeping" ||
    (session.lifecycleState !== "stopped" && session.providerState.lifecycleState === "exists")
  );
}
