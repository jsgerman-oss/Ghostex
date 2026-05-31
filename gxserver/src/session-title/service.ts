import type {
  GxserverSessionDomainState,
  GxserverUpdateSessionParams,
} from "../../protocol/index.js";
import { decideTerminalTitleEvent } from "./decision.js";
import { projectSessionTitle } from "./projection.js";
import type {
  GxserverSessionTitleDecision,
  GxserverSessionTitleProjection,
  GxserverTerminalTitleEventParams,
} from "./types.js";

export interface GxserverSessionTitleRepository {
  getSession(projectId: GxserverTerminalTitleEventParams["projectId"], sessionId: GxserverTerminalTitleEventParams["sessionId"]): GxserverSessionDomainState | undefined;
  updateSession(input: GxserverUpdateSessionParams): GxserverSessionDomainState;
}

export function applyTerminalTitleEvent(
  repository: GxserverSessionTitleRepository,
  params: GxserverTerminalTitleEventParams,
): GxserverSessionTitleDecision {
  const session = repository.getSession(params.projectId, params.sessionId);
  if (!session) {
    throw new Error(`Session ${params.projectId}/${params.sessionId} does not exist.`);
  }
  const decision = decideTerminalTitleEvent(session, params);
  if (!decision.shouldUpdateSession) {
    return decision;
  }
  const updatedSession = repository.updateSession({
    projectId: params.projectId,
    runtimeSettings: decision.runtimeSettings,
    sessionId: params.sessionId,
    ...(decision.title ? { title: decision.title } : {}),
  });
  return {
    ...decision,
    projection: projectSessionTitle(updatedSession, params.rawTitle),
    session: updatedSession,
  };
}

export function readSessionTitleProjection(
  session: GxserverSessionDomainState,
  rawTerminalTitle?: string,
): GxserverSessionTitleProjection {
  return projectSessionTitle(session, rawTerminalTitle);
}
