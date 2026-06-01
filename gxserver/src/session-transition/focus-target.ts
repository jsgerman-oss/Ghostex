import type {
  GxserverSessionDomainState,
  GxserverSessionTransitionFocusReason,
  GxserverSessionTransitionFocusTarget,
  GxserverSessionTransitionParams,
  GxserverSessionTransitionOriginSession,
} from "../../protocol/index.js";

type SessionTransitionCandidate = GxserverSessionTransitionOriginSession & {
  domainSession?: GxserverSessionDomainState;
};

export type ResolveSessionTransitionFocusTargetOptions = {
  isLiveProjectSession: (session: GxserverSessionDomainState) => boolean | Promise<boolean>;
  params: GxserverSessionTransitionParams;
  sessions: readonly GxserverSessionDomainState[];
};

/*
CDXC:SessionTransition 2026-06-01-10:51:
Sidebar close/sleep should move to the next visually adjacent session whose zmx backend is actually live. Pane-tab close/sleep should behave like a tab click in the same tab strip, but sleep must not focus a sleeping tab because the user just requested resource parking.

CDXC:SessionTransition 2026-06-01-10:51:
Pane-tab order can contain client-local native terminal tabs that are not gxserver domain sessions. Preserve those rendered ids for pane-tab close so gxserver returns the same target the client would select when the user clicked the next tab.
*/
export async function resolveSessionTransitionFocusTarget({
  isLiveProjectSession,
  params,
  sessions,
}: ResolveSessionTransitionFocusTargetOptions): Promise<GxserverSessionTransitionFocusTarget | undefined> {
  const sessionById = new Map<string, GxserverSessionDomainState>(sessions.map((session) => [session.sessionId, session]));
  const orderedSessions = normalizeOrderedSessions(params.origin.orderedSessions, sessionById, params.origin.kind);
  if (orderedSessions.length === 0) {
    return undefined;
  }

  const focusReason: GxserverSessionTransitionFocusReason =
    params.origin.kind === "projectSessionList" ? "nextLiveProjectSession" : "nextPaneTab";
  const candidates =
    params.origin.kind === "projectSessionList"
      ? getForwardWrappedCandidates(orderedSessions, params.sessionId)
      : getPaneTabCandidates(orderedSessions, params.sessionId);

  for (const candidate of candidates) {
    if (candidate.sessionId === params.sessionId) {
      continue;
    }
    if (params.origin.kind === "projectSessionList") {
      const domainSession = candidate.domainSession;
      if (
        !domainSession ||
        domainSession.projectId !== params.projectId ||
        !isPotentiallyLiveProjectSession(domainSession) ||
        !(await isLiveProjectSession(domainSession))
      ) {
        continue;
      }
      return {
        projectId: domainSession.projectId,
        reason: focusReason,
        sessionId: domainSession.sessionId,
      };
    }
    if (params.action === "sleep" && getCandidateLifecycleState(candidate) === "sleeping") {
      continue;
    }

    return {
      projectId: candidate.domainSession?.projectId ?? params.projectId,
      reason: focusReason,
      sessionId: candidate.sessionId,
    };
  }

  return undefined;
}

function normalizeOrderedSessions(
  orderedSessions: readonly GxserverSessionTransitionOriginSession[],
  sessionById: ReadonlyMap<string, GxserverSessionDomainState>,
  originKind: GxserverSessionTransitionParams["origin"]["kind"],
): SessionTransitionCandidate[] {
  const result: SessionTransitionCandidate[] = [];
  for (const entry of orderedSessions) {
    if (result.some((candidate) => candidate.sessionId === entry.sessionId)) {
      continue;
    }
    const domainSession = sessionById.get(entry.sessionId);
    if (originKind === "projectSessionList" && !domainSession) {
      continue;
    }
    result.push({
      ...entry,
      domainSession,
    });
  }
  return result;
}

function getForwardWrappedCandidates(
  orderedSessions: readonly SessionTransitionCandidate[],
  removedSessionId: string,
): SessionTransitionCandidate[] {
  const targetIndex = orderedSessions.findIndex((candidate) => candidate.sessionId === removedSessionId);
  if (targetIndex < 0) {
    return orderedSessions.filter((candidate) => candidate.sessionId !== removedSessionId);
  }
  return [
    ...orderedSessions.slice(targetIndex + 1),
    ...orderedSessions.slice(0, targetIndex),
  ].filter((candidate) => candidate.sessionId !== removedSessionId);
}

function getPaneTabCandidates(
  orderedSessions: readonly SessionTransitionCandidate[],
  removedSessionId: string,
): SessionTransitionCandidate[] {
  const remainingSessions = orderedSessions.filter((candidate) => candidate.sessionId !== removedSessionId);
  if (remainingSessions.length === 0) {
    return [];
  }
  const removedIndex = orderedSessions.findIndex((candidate) => candidate.sessionId === removedSessionId);
  if (removedIndex < 0) {
    return remainingSessions;
  }
  const rightSessions = orderedSessions.slice(removedIndex + 1).filter((candidate) => candidate.sessionId !== removedSessionId);
  const leftSessions = orderedSessions.slice(0, removedIndex).filter((candidate) => candidate.sessionId !== removedSessionId).reverse();
  return [...rightSessions, ...leftSessions];
}

function isPotentiallyLiveProjectSession(session: GxserverSessionDomainState): boolean {
  return session.lifecycleState !== "sleeping" && session.lifecycleState !== "stopped" && session.lifecycleState !== "missing";
}

function getCandidateLifecycleState(
  candidate: SessionTransitionCandidate,
): GxserverSessionDomainState["lifecycleState"] | undefined {
  return candidate.lifecycleState ?? candidate.domainSession?.lifecycleState;
}
