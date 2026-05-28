import {
  type CreateSessionRecordOptions,
  type SessionGridDirection,
  type SessionGridSnapshot,
  type SessionRecord,
  createSessionRecord,
  getOrderedSessions,
} from "./session-grid-contract";
import {
  findDirectionalNeighbor,
  reindexSessionsInOrder,
  replaceFocusedVisibleSession,
  revealSessionId,
} from "./session-grid-state-helpers";
import { normalizeSessionGridSnapshot } from "./session-grid-state-normalize";

export function createSessionInSnapshot(
  snapshot: SessionGridSnapshot,
  sessionNumber: number,
  options?: CreateSessionRecordOptions,
): {
  session?: SessionRecord;
  snapshot: SessionGridSnapshot;
} {
  const normalizedSnapshot = normalizeSessionGridSnapshot(snapshot);
  const orderedSessions = getOrderedSessions(normalizedSnapshot);

  const session = createSessionRecord(sessionNumber, orderedSessions.length, options);
  const sessions = reindexSessionsInOrder([...orderedSessions, session]);
  const shouldCreateInBackground = options?.initialPresentation === "background";
  const visibleSessionIds = shouldCreateInBackground
    ? normalizedSnapshot.visibleSessionIds
    : normalizedSnapshot.visibleSessionIds.length < normalizedSnapshot.visibleCount
      ? [...normalizedSnapshot.visibleSessionIds, session.sessionId]
      : replaceFocusedVisibleSession(normalizedSnapshot, session.sessionId);

  return {
    session,
    snapshot: normalizeSessionGridSnapshot({
      ...normalizedSnapshot,
      focusedSessionId: shouldCreateInBackground
        ? normalizedSnapshot.focusedSessionId
        : session.sessionId,
      sessions,
      visibleSessionIds,
    }),
  };
}

export function focusDirectionInSnapshot(
  snapshot: SessionGridSnapshot,
  direction: SessionGridDirection,
): { changed: boolean; snapshot: SessionGridSnapshot } {
  const normalizedSnapshot = normalizeSessionGridSnapshot(snapshot);
  const currentSession = normalizedSnapshot.focusedSessionId
    ? normalizedSnapshot.sessions.find(
        (session) => session.sessionId === normalizedSnapshot.focusedSessionId,
      )
    : undefined;
  if (!currentSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const nextSession = findDirectionalNeighbor(
    normalizedSnapshot.sessions,
    currentSession,
    direction,
  );
  if (!nextSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  return focusSessionInSnapshot(normalizedSnapshot, nextSession.sessionId);
}

export function focusVisibleDirectionInSnapshot(
  snapshot: SessionGridSnapshot,
  direction: SessionGridDirection,
): { changed: boolean; snapshot: SessionGridSnapshot } {
  const normalizedSnapshot = normalizeSessionGridSnapshot(snapshot);
  const visibleSessionIds = new Set(normalizedSnapshot.visibleSessionIds);
  const visibleSessions = normalizedSnapshot.sessions.filter((session) =>
    visibleSessionIds.has(session.sessionId),
  );
  const currentSession = normalizedSnapshot.focusedSessionId
    ? visibleSessions.find((session) => session.sessionId === normalizedSnapshot.focusedSessionId)
    : undefined;
  if (!currentSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const nextSession = findDirectionalNeighbor(visibleSessions, currentSession, direction);
  if (!nextSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  /**
   * CDXC:PaneFocus 2026-05-28-14:29:
   * macOS directional focus hotkeys are spatial focus moves within the already visible native pane set.
   * They must not reuse generic session reveal behavior, because that swaps hidden/offscreen sessions into visibleSessionIds and changes the visible session tabs.
   */
  return {
    changed: normalizedSnapshot.focusedSessionId !== nextSession.sessionId,
    snapshot: normalizeSessionGridSnapshot({
      ...normalizedSnapshot,
      focusedSessionId: nextSession.sessionId,
      paneLayout: setActiveSessionInPaneLayout(
        normalizedSnapshot.paneLayout,
        nextSession.sessionId,
      ),
      visibleSessionIds: normalizedSnapshot.visibleSessionIds,
    }),
  };
}

export function focusSessionInSnapshot(
  snapshot: SessionGridSnapshot,
  sessionId: string,
): { changed: boolean; snapshot: SessionGridSnapshot } {
  const normalizedSnapshot = normalizeSessionGridSnapshot(snapshot);
  const hasSession = normalizedSnapshot.sessions.some((session) => session.sessionId === sessionId);
  if (!hasSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  return {
    changed: normalizedSnapshot.focusedSessionId !== sessionId,
    snapshot: normalizeSessionGridSnapshot({
      ...normalizedSnapshot,
      focusedSessionId: sessionId,
      visibleSessionIds: revealSessionId(normalizedSnapshot, sessionId),
    }),
  };
}

function setActiveSessionInPaneLayout(
  layout: SessionGridSnapshot["paneLayout"],
  sessionId: string,
): SessionGridSnapshot["paneLayout"] {
  if (!layout) {
    return undefined;
  }
  if (layout.kind === "tabs") {
    return layout.sessionIds.includes(sessionId)
      ? { ...layout, activeSessionId: sessionId }
      : layout;
  }
  if (layout.kind === "split") {
    return {
      ...layout,
      children: layout.children.map(
        (child) => setActiveSessionInPaneLayout(child, sessionId) ?? child,
      ),
    };
  }
  return layout;
}
