export type NativeSessionTransitionOriginSession = {
  lifecycleState?: "running" | "sleeping" | "stopped" | "missing" | "unknown";
  sessionId: string;
};

export type NativeGxserverSessionTransitionOrigin =
  | {
      kind: "projectSessionList";
      orderedSessions: NativeSessionTransitionOriginSession[];
    }
  | {
      kind: "paneTabGroup";
      orderedSessions: NativeSessionTransitionOriginSession[];
    };

export type NativeSessionTransitionFocusTarget = {
  projectId: string;
  reason: "nextLiveProjectSession" | "nextPaneTab";
  sessionId: string;
};

export function resolveNativeSessionTransitionFocusTarget({
  action,
  isLiveProjectCandidate,
  isRemovedSessionFocused,
  isSleepingCandidate,
  origin,
  projectId,
  removedSessionId,
}: {
  action: "close" | "sleep";
  isLiveProjectCandidate: (sessionId: string) => boolean;
  isRemovedSessionFocused: boolean;
  isSleepingCandidate: (candidate: NativeSessionTransitionOriginSession) => boolean;
  origin: NativeGxserverSessionTransitionOrigin;
  projectId: string;
  removedSessionId: string;
}): NativeSessionTransitionFocusTarget | undefined {
  /*
   * CDXC:SessionSleep 2026-06-06-22:52:
   * Background auto-sleep or background tab close must not retarget keyboard focus.
   * Only choose the next live project/tab session when the session being removed is the currently focused pane owner; otherwise the focused pane should keep receiving input.
   */
  if (!isRemovedSessionFocused) {
    return undefined;
  }
  const orderedSessions = normalizeNativeSessionTransitionOrderedSessions(origin.orderedSessions);
  const candidates =
    origin.kind === "projectSessionList"
      ? getForwardWrappedNativeTransitionCandidates(orderedSessions, removedSessionId)
      : getPaneTabNativeTransitionCandidates(orderedSessions, removedSessionId);
  for (const candidate of candidates) {
    if (candidate.sessionId === removedSessionId) {
      continue;
    }
    if (origin.kind === "projectSessionList") {
      if (!isLiveProjectCandidate(candidate.sessionId)) {
        continue;
      }
      return {
        projectId,
        reason: "nextLiveProjectSession",
        sessionId: candidate.sessionId,
      };
    }
    if (action === "sleep" && isSleepingCandidate(candidate)) {
      continue;
    }
    return {
      projectId,
      reason: "nextPaneTab",
      sessionId: candidate.sessionId,
    };
  }
  return undefined;
}

function normalizeNativeSessionTransitionOrderedSessions(
  orderedSessions: NativeSessionTransitionOriginSession[],
): NativeSessionTransitionOriginSession[] {
  const result: NativeSessionTransitionOriginSession[] = [];
  for (const entry of orderedSessions) {
    const sessionId = entry.sessionId.trim();
    if (!sessionId || result.some((candidate) => candidate.sessionId === sessionId)) {
      continue;
    }
    result.push(entry.lifecycleState ? { lifecycleState: entry.lifecycleState, sessionId } : { sessionId });
  }
  return result;
}

function getForwardWrappedNativeTransitionCandidates(
  orderedSessions: NativeSessionTransitionOriginSession[],
  removedSessionId: string,
): NativeSessionTransitionOriginSession[] {
  const targetIndex = orderedSessions.findIndex((candidate) => candidate.sessionId === removedSessionId);
  if (targetIndex < 0) {
    return orderedSessions.filter((candidate) => candidate.sessionId !== removedSessionId);
  }
  return [
    ...orderedSessions.slice(targetIndex + 1),
    ...orderedSessions.slice(0, targetIndex),
  ].filter((candidate) => candidate.sessionId !== removedSessionId);
}

function getPaneTabNativeTransitionCandidates(
  orderedSessions: NativeSessionTransitionOriginSession[],
  removedSessionId: string,
): NativeSessionTransitionOriginSession[] {
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
