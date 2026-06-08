import type {
  GxserverSessionDomainState,
  GxserverSessionRenameRequestParams,
  GxserverSessionRenameRequestResult,
  GxserverUpdateSessionParams,
} from "../../../protocol/index.js";
import { projectSessionTitle } from "../../session-title/projection.js";
import { normalizeText, resolveSessionIdentity } from "../identity.js";
import { isAgentAssociatedSession } from "./reconcile.js";

export interface GxserverSessionRenameRequestRepository {
  getSession(
    projectId: GxserverSessionRenameRequestParams["projectId"],
    sessionId: GxserverSessionRenameRequestParams["sessionId"],
  ): GxserverSessionDomainState | undefined;
  updateSession(input: GxserverUpdateSessionParams): GxserverSessionDomainState;
}

export function applySessionRenameRequest(
  repository: GxserverSessionRenameRequestRepository,
  params: GxserverSessionRenameRequestParams,
): GxserverSessionRenameRequestResult {
  const session = repository.getSession(params.projectId, params.sessionId);
  if (!session) {
    throw new Error(`Session ${params.projectId}/${params.sessionId} does not exist.`);
  }
  const requestedTitle = normalizeText(params.title);
  if (!requestedTitle) {
    return {
      changed: false,
      pendingAgentMetadata: false,
      projection: projectSessionTitle(session),
      reason: "empty-title",
      session,
      shouldSendAgentRenameCommand: false,
    };
  }

  const requestIdentity = resolveSessionIdentity({
    agentId: session.agentId,
    agentName: params.agentName,
    agentSessionId: params.agentSessionId,
    agentSessionPath: params.agentSessionPath,
    runtimeSettings: session.runtimeSettings,
  });
  const sessionWithRequestIdentity: GxserverSessionDomainState = {
    ...session,
    ...(requestIdentity.agentId && !session.agentId ? { agentId: requestIdentity.agentId } : {}),
    runtimeSettings: {
      ...session.runtimeSettings,
      ...(requestIdentity.agentId ? { agentName: requestIdentity.agentId } : {}),
      ...(requestIdentity.agentSessionId ? { agentSessionId: requestIdentity.agentSessionId } : {}),
      ...(requestIdentity.agentSessionPath ? { agentSessionPath: requestIdentity.agentSessionPath } : {}),
    },
  };

  if (isAgentAssociatedSession(sessionWithRequestIdentity)) {
    const updated = repository.updateSession({
      ...(sessionWithRequestIdentity.agentId ? { agentId: sessionWithRequestIdentity.agentId } : {}),
      kind: session.kind === "terminal" ? "agent" : session.kind,
      projectId: params.projectId,
      runtimeSettings: {
        ...sessionWithRequestIdentity.runtimeSettings,
        pendingAgentTitleRequestRequestedAt: new Date().toISOString(),
        pendingAgentTitleRequestStatus: "pending",
        pendingAgentTitleRequestTitle: requestedTitle,
        pendingAgentTitleRequestTitleSource: params.titleSource ?? "user",
      },
      sessionId: params.sessionId,
    });
    return {
      changed: updated.updatedAt !== session.updatedAt,
      pendingAgentMetadata: true,
      projection: projectSessionTitle(updated),
      reason: "agent-rename-request-pending-metadata",
      session: updated,
      shouldSendAgentRenameCommand: true,
    };
  }

  /*
  CDXC:GxserverAgentTitles 2026-06-01-09:03:
  UI rename requests are canonical only for non-agent terminal sessions. Agent sessions store the requested name as pending intent and wait for structured agent metadata before changing the durable title, preventing cross-client sidebar drift when `/rename` is not accepted by the CLI.
  */
  const updated = repository.updateSession({
    projectId: params.projectId,
    runtimeSettings: {
      ...session.runtimeSettings,
      titleSource: params.titleSource ?? "user",
    },
    sessionId: params.sessionId,
    title: requestedTitle,
  });
  return {
    changed: true,
    pendingAgentMetadata: false,
    projection: projectSessionTitle(updated),
    reason: "non-agent-title-applied",
    session: updated,
    shouldSendAgentRenameCommand: false,
  };
}
