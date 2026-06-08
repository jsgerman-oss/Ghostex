import type {
  GxserverProjectDomainState,
  GxserverSessionDomainState,
  GxserverSessionStateEventParams,
  GxserverSessionStateEventResult,
  GxserverUpdateSessionParams,
} from "../../protocol/index.js";
import { projectSessionTitle } from "../session-title/projection.js";
import { getTrustedResumeTitle } from "../session-title/trust.js";
import { resolveSessionIdentity } from "./identity.js";
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

export function applySessionStateEvent(
  repository: GxserverSessionPresentationRepository,
  params: GxserverSessionStateEventParams,
): GxserverSessionStateEventResult {
  const session = repository.getSession(params.projectId, params.sessionId);
  if (!session) {
    throw new Error(`Session ${params.projectId}/${params.sessionId} does not exist.`);
  }
  const project = repository.getProject(params.projectId);
  if (!project) {
    throw new Error(`Project ${params.projectId} does not exist.`);
  }

  const identity = resolveSessionIdentity({
    agentId: session.agentId,
    agentName: params.agentName,
    agentSessionId: params.agentSessionId,
    agentSessionPath: params.agentSessionPath,
    runtimeSettings: session.runtimeSettings,
    startupText: params.startupText,
  });
  let runtimeSettings: Record<string, unknown> = {
    ...session.runtimeSettings,
    ...(identity.agentId ? { agentName: identity.agentId } : {}),
    ...(identity.agentSessionId ? { agentSessionId: identity.agentSessionId } : {}),
    ...(identity.agentSessionPath ? { agentSessionPath: identity.agentSessionPath } : {}),
    ...("firstPromptTitleGenerationAgent" in params && params.firstPromptTitleGenerationAgent
      ? { firstPromptTitleGenerationAgent: params.firstPromptTitleGenerationAgent }
      : {}),
    ...("firstPromptTitleGenerationCommand" in params
      ? { firstPromptTitleGenerationCommand: params.firstPromptTitleGenerationCommand }
      : {}),
    ...(params.firstUserMessage ? { firstUserMessage: params.firstUserMessage } : {}),
  };
  const nextAgentId = identity.agentId ?? session.agentId;
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
      sessions: repository.listSessions(params.projectId),
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
