import {
  clampVisibleSessionCount,
  DEFAULT_MAIN_GROUP_ID,
  DEFAULT_MAIN_GROUP_TITLE,
  MAX_GROUP_COUNT,
  MAX_SESSION_COUNT,
  createDefaultGroupedSessionWorkspaceSnapshot,
  createDefaultSessionGridSnapshot,
  createSessionRecord,
  createTimestampedSessionId,
  formatSessionDisplayId,
  getOrderedSessions,
  getSessionNumberFromSessionId,
  getSlotPosition,
  type GroupedSessionWorkspaceSnapshot,
  type SessionGroupRecord,
  type SessionPaneLayoutNode,
  type SessionPaneSplitDirection,
  type SessionRecord,
  type SessionTitleSource,
  type TerminalEngine,
  type TerminalSessionPersistenceProvider,
  type T3SessionMetadata,
  type TerminalViewMode,
  type VisibleSessionCount,
  type CreateSessionRecordOptions,
} from "./session-grid-contract";
import { normalizeWorkspaceSessionDisplayIds } from "./grouped-session-workspace-state-helpers";
import { normalizeSessionRecord, reindexSessionsInOrder } from "./session-grid-state-helpers";
import { reorderGroupSessions } from "./session-order-reorder";
import { normalizeT3SessionMetadata } from "./t3-session-metadata";

type WorkspaceMutationResult = {
  changed: boolean;
  snapshot: GroupedSessionWorkspaceSnapshot;
};

type CreateSessionResult = {
  session?: SessionRecord;
  snapshot: GroupedSessionWorkspaceSnapshot;
};

export type VisibleSessionPlacement =
  | {
      kind: "appendFullWidth";
    }
  | {
      kind: "appendToTabGroup";
      targetSessionId: string;
    }
  | {
      kind: "insertAfter";
      splitDirection?: SessionPaneSplitDirection;
      targetSessionId?: string;
    }
  | {
      kind: "replace";
      targetSessionId: string;
    }
  | {
      kind: "replaceNonFocused";
      preserveSessionId?: string;
    };

export type SessionPaneDropPlacement = "bottom" | "center" | "left" | "right" | "top";
export type SessionPaneTabReorderPosition = "after" | "before";

type CreateSessionInSimpleWorkspaceOptions = {
  usedSessionIds?: readonly string[];
  visiblePlacement?: VisibleSessionPlacement;
};

type CreateGroupResult = WorkspaceMutationResult & {
  groupId?: string;
};

export function normalizeSimpleGroupedSessionWorkspaceSnapshot(
  snapshot: GroupedSessionWorkspaceSnapshot | undefined,
): GroupedSessionWorkspaceSnapshot {
  const baseSnapshot = snapshot ?? createDefaultGroupedSessionWorkspaceSnapshot();
  const preparedGroups = baseSnapshot.groups.map((group, index) =>
    prepareGroupForDisplayIdNormalization(group, index),
  );
  const groups =
    preparedGroups.length > 0
      ? preparedGroups
      : [createEmptyGroup(DEFAULT_MAIN_GROUP_ID, DEFAULT_MAIN_GROUP_TITLE)];
  const displayIdNormalization = normalizeWorkspaceSessionDisplayIds(groups);
  const normalizedGroups = displayIdNormalization.groups.map((group, index) =>
    normalizeGroup(group, index),
  );
  const activeGroupId = normalizedGroups.some(
    (group) => group.groupId === baseSnapshot.activeGroupId,
  )
    ? baseSnapshot.activeGroupId
    : normalizedGroups[0]!.groupId;

  return {
    activeGroupId,
    groups: normalizedGroups,
    nextGroupNumber: Math.max(
      2,
      baseSnapshot.nextGroupNumber,
      getNextGroupNumber(normalizedGroups),
    ),
    nextSessionDisplayId: Math.max(0, displayIdNormalization.nextSessionDisplayId),
    nextSessionNumber: Math.max(
      1,
      baseSnapshot.nextSessionNumber,
      getNextSessionNumber(normalizedGroups),
    ),
  };
}

export function getActiveGroup(
  snapshot: GroupedSessionWorkspaceSnapshot,
): SessionGroupRecord | undefined {
  return snapshot.groups.find((group) => group.groupId === snapshot.activeGroupId);
}

export function getGroupById(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
): SessionGroupRecord | undefined {
  return snapshot.groups.find((group) => group.groupId === groupId);
}

export function getGroupForSession(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
): SessionGroupRecord | undefined {
  return snapshot.groups.find((group) =>
    group.snapshot.sessions.some((session) => session.sessionId === sessionId),
  );
}

export function createSessionInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  options?: CreateSessionRecordOptions,
  createOptions?: CreateSessionInSimpleWorkspaceOptions,
): CreateSessionResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  const activeGroup = getActiveGroup(normalizedSnapshot);
  if (!activeGroup) {
    return { snapshot: normalizedSnapshot };
  }

  const sessionId = createTimestampedSessionId([
    ...getWorkspaceSessionIds(normalizedSnapshot),
    ...(createOptions?.usedSessionIds ?? []),
  ]);
  const nextSession = createSessionRecord(
    normalizedSnapshot.nextSessionNumber,
    activeGroup.snapshot.sessions.length,
    {
      ...options,
      displayId: sessionId,
      sessionId,
    } as CreateSessionRecordOptions & { displayId: string },
  );
  const nextSessionRecord = normalizeSessionRecord(nextSession);
  const shouldCreateInBackground = options?.initialPresentation === "background";
  const nextSnapshot = updateGroup(normalizedSnapshot, activeGroup.groupId, (group) => {
    const nextSessions = [...group.snapshot.sessions, nextSessionRecord];
    const visiblePlacement = createOptions?.visiblePlacement;
    const currentVisibleSessionIds = group.snapshot.visibleSessionIds;
    const placementResult =
      shouldCreateInBackground || !visiblePlacement
        ? undefined
        : getVisibleSessionPlacementResult(
            getAwakeSessions(nextSessions),
            group.snapshot.visibleCount,
            group.snapshot.visibleSessionIds,
            nextSessionRecord.sessionId,
            visiblePlacement,
          );
    const nextVisibleSessionIds = shouldCreateInBackground
      ? currentVisibleSessionIds
      : (placementResult?.visibleSessionIds ??
        getNormalizedVisibleIds(
          nextSessions,
          group.snapshot.visibleCount,
          nextSessionRecord.sessionId,
          [...currentVisibleSessionIds, nextSessionRecord.sessionId],
        ));
    const nextGroup = {
      ...group,
      snapshot: normalizeGroupSnapshot({
        ...group.snapshot,
        focusedSessionId: shouldCreateInBackground
          ? group.snapshot.focusedSessionId
          : nextSessionRecord.sessionId,
        paneLayout: shouldCreateInBackground
          ? group.snapshot.paneLayout
          : getNextPaneLayoutForCreatedSession(
              group.snapshot.paneLayout,
              currentVisibleSessionIds,
              nextVisibleSessionIds,
              nextSessionRecord.sessionId,
              visiblePlacement,
              placementResult?.replacedSessionId,
            ),
        sessions: nextSessions,
        visibleCount: placementResult?.visibleCount ?? group.snapshot.visibleCount,
        visibleSessionIds: nextVisibleSessionIds,
      }),
    };
    return nextGroup;
  });

  return {
    session: nextSessionRecord,
    snapshot: {
      ...nextSnapshot,
      nextSessionDisplayId: normalizedSnapshot.nextSessionDisplayId,
      nextSessionNumber: normalizedSnapshot.nextSessionNumber + 1,
    },
  };
}

export function focusGroupInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
): WorkspaceMutationResult {
  if (
    !snapshot.groups.some((group) => group.groupId === groupId) ||
    snapshot.activeGroupId === groupId
  ) {
    return { changed: false, snapshot };
  }

  return {
    changed: true,
    snapshot: normalizeSimpleGroupedSessionWorkspaceSnapshot({
      ...snapshot,
      activeGroupId: groupId,
    }),
  };
}

export function focusGroupByIndexInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupIndex: number,
): WorkspaceMutationResult {
  const targetGroup = snapshot.groups[groupIndex - 1];
  if (!targetGroup) {
    return { changed: false, snapshot };
  }

  return focusGroupInSimpleWorkspace(snapshot, targetGroup.groupId);
}

export function focusSessionInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
): WorkspaceMutationResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  const owningGroup = getGroupForSession(normalizedSnapshot, sessionId);
  if (!owningGroup) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const currentSession = owningGroup.snapshot.sessions.find(
    (session) => session.sessionId === sessionId,
  );
  const isRestoringSleepingSession = currentSession?.isSleeping === true;
  const nextSessions = owningGroup.snapshot.sessions.map((session) =>
    session.sessionId === sessionId ? { ...session, isSleeping: false } : session,
  );
  const nextVisibleSessionIds = isRestoringSleepingSession
    ? getNextVisibleIdsForRestoredSleepingSession(
        getAwakeSessions(nextSessions),
        owningGroup.snapshot.visibleCount,
        sessionId,
        owningGroup.snapshot.visibleSessionIds,
        owningGroup.snapshot.focusedSessionId,
      )
    : getNextVisibleIdsForFocusedSession(
        getAwakeSessions(nextSessions),
        owningGroup.snapshot.visibleCount,
        sessionId,
        owningGroup.snapshot.visibleSessionIds,
        owningGroup.snapshot.focusedSessionId,
      );
  const nextVisibleCount = isRestoringSleepingSession
    ? clampSupportedVisibleCount(Math.max(1, nextVisibleSessionIds.length))
    : owningGroup.snapshot.visibleCount;
  const nextPaneLayout = isRestoringSleepingSession
    ? getNextPaneLayoutForRestoredSleepingSession(
        owningGroup.snapshot.paneLayout,
        owningGroup.snapshot.visibleSessionIds,
        nextVisibleSessionIds,
        sessionId,
        owningGroup.snapshot.focusedSessionId,
      )
    : getNextPaneLayoutForFocusedSession(
        owningGroup.snapshot.paneLayout,
        owningGroup.snapshot.visibleSessionIds,
        nextVisibleSessionIds,
        sessionId,
        owningGroup.snapshot.focusedSessionId,
      );

  const nextSnapshot = updateGroup(
    {
      ...normalizedSnapshot,
      activeGroupId: owningGroup.groupId,
    },
    owningGroup.groupId,
    (group) => ({
      ...group,
      snapshot: normalizeGroupSnapshot({
        ...group.snapshot,
        focusedSessionId: sessionId,
        ...(nextPaneLayout ? { paneLayout: nextPaneLayout } : {}),
        sessions: nextSessions,
        visibleCount: nextVisibleCount,
        visibleSessionIds: nextVisibleSessionIds,
      }),
    }),
  );

  return {
    changed: !areSnapshotsEqual(normalizedSnapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function renameGroupInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
  title: string,
): WorkspaceMutationResult {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return { changed: false, snapshot };
  }

  const nextSnapshot = updateGroup(snapshot, groupId, (group) => ({
    ...group,
    title: nextTitle,
  }));
  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function removeGroupInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
): WorkspaceMutationResult {
  if (!snapshot.groups.some((group) => group.groupId === groupId)) {
    return { changed: false, snapshot };
  }

  const remainingGroups = snapshot.groups.filter((group) => group.groupId !== groupId);
  const normalizedGroups =
    remainingGroups.length > 0
      ? remainingGroups
      : [createEmptyGroup(DEFAULT_MAIN_GROUP_ID, DEFAULT_MAIN_GROUP_TITLE)];
  const activeGroupId = normalizedGroups.some((group) => group.groupId === snapshot.activeGroupId)
    ? snapshot.activeGroupId
    : normalizedGroups[0]!.groupId;

  return {
    changed: true,
    snapshot: normalizeSimpleGroupedSessionWorkspaceSnapshot({
      ...snapshot,
      activeGroupId,
      groups: normalizedGroups,
    }),
  };
}

export function removeSessionInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
): WorkspaceMutationResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  const owningGroup = getGroupForSession(normalizedSnapshot, sessionId);
  if (!owningGroup) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const snapshotWithoutSession = updateGroup(normalizedSnapshot, owningGroup.groupId, (group) => ({
    ...group,
    snapshot: normalizeGroupSnapshot({
      ...group.snapshot,
      sessions: group.snapshot.sessions.filter((session) => session.sessionId !== sessionId),
      visibleSessionIds: group.snapshot.visibleSessionIds.filter((id) => id !== sessionId),
      focusedSessionId:
        group.snapshot.focusedSessionId === sessionId ? undefined : group.snapshot.focusedSessionId,
    }),
  }));
  const shouldSwitchGroups =
    normalizedSnapshot.activeGroupId === owningGroup.groupId &&
    getActiveSessionCount(getGroupById(snapshotWithoutSession, owningGroup.groupId)) === 0;
  const fallbackActiveGroupId = shouldSwitchGroups
    ? getFallbackActiveGroupId(snapshotWithoutSession, owningGroup.groupId)
    : snapshotWithoutSession.activeGroupId;
  const nextSnapshot =
    fallbackActiveGroupId === snapshotWithoutSession.activeGroupId
      ? snapshotWithoutSession
      : normalizeSimpleGroupedSessionWorkspaceSnapshot({
          ...snapshotWithoutSession,
          activeGroupId: fallbackActiveGroupId,
        });

  return {
    changed: !areSnapshotsEqual(normalizedSnapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function setSessionSleepingInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  sleeping: boolean,
): WorkspaceMutationResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  const owningGroup = getGroupForSession(normalizedSnapshot, sessionId);
  if (!owningGroup) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const currentSession = owningGroup.snapshot.sessions.find(
    (session) => session.sessionId === sessionId,
  );
  if (!currentSession || currentSession.isSleeping === sleeping) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const snapshotWithSleepState = updateGroup(normalizedSnapshot, owningGroup.groupId, (group) => ({
    ...group,
    snapshot: normalizeGroupSnapshot({
      ...group.snapshot,
      sessions: group.snapshot.sessions.map((session) =>
        session.sessionId === sessionId
          ? {
              ...session,
              isPoppedOut: sleeping ? undefined : session.isPoppedOut,
              isSleeping: sleeping,
            }
          : session,
      ),
    }),
  }));
  const shouldSwitchGroups =
    sleeping &&
    normalizedSnapshot.activeGroupId === owningGroup.groupId &&
    getActiveSessionCount(getGroupById(snapshotWithSleepState, owningGroup.groupId)) === 0;
  const fallbackActiveGroupId = shouldSwitchGroups
    ? getFallbackActiveGroupId(snapshotWithSleepState, owningGroup.groupId)
    : snapshotWithSleepState.activeGroupId;
  const nextSnapshot =
    fallbackActiveGroupId === snapshotWithSleepState.activeGroupId
      ? snapshotWithSleepState
      : normalizeSimpleGroupedSessionWorkspaceSnapshot({
          ...snapshotWithSleepState,
          activeGroupId: fallbackActiveGroupId,
        });

  return {
    changed: !areSnapshotsEqual(normalizedSnapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function setSessionPoppedOutInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  poppedOut: boolean,
): WorkspaceMutationResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  const owningGroup = getGroupForSession(normalizedSnapshot, sessionId);
  if (!owningGroup) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const currentSession = owningGroup.snapshot.sessions.find(
    (session) => session.sessionId === sessionId,
  );
  if (
    !currentSession ||
    currentSession.isSleeping === true ||
    (currentSession.isPoppedOut === true) === poppedOut
  ) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  /**
   * CDXC:PanePopOut 2026-05-11-09:35
   * Pop-out is a live presentation toggle. It must update the session record
   * without changing tab groups, visible order, focus, or sleep lifecycle so
   * the original pane slot can render a reattach placeholder.
   */
  return updateSession(normalizedSnapshot, sessionId, (session) => ({
    ...session,
    isPoppedOut: poppedOut ? true : undefined,
  }));
}

export function setSessionFavoriteInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  favorite: boolean,
): WorkspaceMutationResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  const owningGroup = getGroupForSession(normalizedSnapshot, sessionId);
  if (!owningGroup) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const currentSession = owningGroup.snapshot.sessions.find(
    (session) => session.sessionId === sessionId,
  );
  if (!currentSession || currentSession.isFavorite === favorite) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  return updateSession(normalizedSnapshot, sessionId, (session) => ({
    ...session,
    isFavorite: favorite,
  }));
}

export function setGroupSleepingInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
  sleeping: boolean,
  sessionIds?: readonly string[],
): WorkspaceMutationResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  const group = getGroupById(normalizedSnapshot, groupId);
  if (!group) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const targetSessionIdSet =
    sessionIds === undefined ? undefined : new Set(sessionIds.map((sessionId) => sessionId.trim()));
  const targetSessions =
    targetSessionIdSet === undefined
      ? group.snapshot.sessions
      : group.snapshot.sessions.filter((session) => targetSessionIdSet.has(session.sessionId));
  const hasChange = targetSessions.some((session) => session.isSleeping !== sleeping);
  if (!hasChange) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const snapshotWithSleepState = updateGroup(normalizedSnapshot, groupId, (targetGroup) => ({
    ...targetGroup,
    snapshot: normalizeGroupSnapshot({
      ...targetGroup.snapshot,
      sessions: targetGroup.snapshot.sessions.map((session) =>
        targetSessionIdSet === undefined || targetSessionIdSet.has(session.sessionId)
          ? {
              ...session,
              isPoppedOut: sleeping ? undefined : session.isPoppedOut,
              isSleeping: sleeping,
            }
          : session,
      ),
    }),
  }));
  const shouldSwitchGroups =
    sleeping &&
    normalizedSnapshot.activeGroupId === groupId &&
    getActiveSessionCount(getGroupById(snapshotWithSleepState, groupId)) === 0;
  const fallbackActiveGroupId = shouldSwitchGroups
    ? getFallbackActiveGroupId(snapshotWithSleepState, groupId)
    : snapshotWithSleepState.activeGroupId;
  const nextSnapshot =
    fallbackActiveGroupId === snapshotWithSleepState.activeGroupId
      ? snapshotWithSleepState
      : normalizeSimpleGroupedSessionWorkspaceSnapshot({
          ...snapshotWithSleepState,
          activeGroupId: fallbackActiveGroupId,
        });

  return {
    changed: !areSnapshotsEqual(normalizedSnapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function renameSessionAliasInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  alias: string,
): WorkspaceMutationResult {
  const nextAlias = alias.trim();
  if (!nextAlias) {
    return { changed: false, snapshot };
  }

  return updateSession(snapshot, sessionId, (session) => ({
    ...session,
    alias: nextAlias,
  }));
}

export function setSessionTitleInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  title: string,
  options: { titleSource?: SessionTitleSource } = {},
): WorkspaceMutationResult {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return { changed: false, snapshot };
  }

  return updateSession(snapshot, sessionId, (session) => ({
    ...session,
    title: nextTitle,
    titleSource: options.titleSource ?? "user",
  }));
}

export function setBrowserSessionUrlInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  url: string,
): WorkspaceMutationResult {
  const nextUrl = url.trim();
  if (!nextUrl) {
    return { changed: false, snapshot };
  }

  /**
   * CDXC:BrowserPanes 2026-05-03-03:41
   * Browser pane cards persist their current WKWebView location in the simple
   * workspace snapshot. Restoring from this field keeps app reopen on the page
   * the user last reached instead of the original create-pane URL.
   */
  return updateSession(snapshot, sessionId, (session) => {
    if (session.kind !== "browser" || session.browser.url === nextUrl) {
      return session;
    }

    return {
      ...session,
      browser: {
        ...session.browser,
        url: nextUrl,
      },
    };
  });
}

export function setBrowserSessionFaviconDataUrlInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  faviconDataUrl: string | undefined,
): WorkspaceMutationResult {
  /**
   * CDXC:BrowserPanes 2026-05-03-11:28
   * Browser pane sidebar cards should use the loaded tab favicon when WebKit
   * discovers one. Persist the favicon data URL on the browser session so the
   * card keeps the tab identity across sidebar hydration and app reopen.
   */
  return updateSession(snapshot, sessionId, (session) => {
    if (session.kind !== "browser") {
      return session;
    }
    const nextFaviconDataUrl = faviconDataUrl?.trim() || undefined;
    if (session.browser.faviconDataUrl === nextFaviconDataUrl) {
      return session;
    }

    return {
      ...session,
      browser: {
        ...session.browser,
        faviconDataUrl: nextFaviconDataUrl,
      },
    };
  });
}

export function setTerminalSessionAgentNameInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  agentName: string | undefined,
): WorkspaceMutationResult {
  const nextAgentName = agentName?.replace(/\s+/g, " ").trim() || undefined;
  /**
   * CDXC:AgentDetection 2026-04-26-21:31
   * zmux native keeps project/session state in one persistence model:
   * localStorage-backed workspace snapshots. Agent identity belongs on the
   * terminal session record, not in a parallel per-session file, so restores
   * and sidebar cards read the same canonical session model.
   */
  return updateSession(snapshot, sessionId, (session) => {
    if (session.kind !== "terminal" || session.agentName === nextAgentName) {
      return session;
    }

    return {
      ...session,
      agentName: nextAgentName,
    };
  });
}

export function setTerminalSessionAgentSessionMetadataInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  metadata: { agentSessionId?: string; agentSessionPath?: string },
): WorkspaceMutationResult {
  const nextAgentSessionId = metadata.agentSessionId?.trim() || undefined;
  const nextAgentSessionPath = metadata.agentSessionPath?.trim() || undefined;
  /**
   * CDXC:PiAgent 2026-05-08-09:42
   * Pi resumes and forks by its own jsonl session path/id, not by the visible
   * sidebar title. Persist those values on the terminal record whenever the Pi
   * extension reports them so sleeping, wake, app restart, and previous-session
   * restore all target the original Pi conversation.
   *
   * CDXC:CodexAgent 2026-05-11-07:35
   * Codex terminal-title UUIDs use the same metadata slot. The UUID is durable
   * restore identity and must not be promoted into the visible session title.
   */
  return updateSession(snapshot, sessionId, (session) => {
    if (
      session.kind !== "terminal" ||
      (session.agentSessionId === nextAgentSessionId &&
        session.agentSessionPath === nextAgentSessionPath)
    ) {
      return session;
    }

    return {
      ...session,
      agentSessionId: nextAgentSessionId,
      agentSessionPath: nextAgentSessionPath,
    };
  });
}

export function setTerminalSessionPersistenceNameInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  sessionPersistenceName: string | undefined,
): WorkspaceMutationResult {
  const nextSessionPersistenceName = sessionPersistenceName?.trim() || undefined;
  /**
   * CDXC:SessionPersistence 2026-05-05-07:28
   * Provider reconnect identity must be stored separately from the sidebar
   * title. Titles can change as agent CLIs rename work, while restart restore
   * needs the last known persistence session name to attach before recreating.
   */
  return updateSession(snapshot, sessionId, (session) => {
    if (
      session.kind !== "terminal" ||
      session.sessionPersistenceName === nextSessionPersistenceName
    ) {
      return session;
    }

    return {
      ...session,
      sessionPersistenceName: nextSessionPersistenceName,
    };
  });
}

export function setTerminalSessionPersistenceProviderInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  sessionPersistenceProvider: TerminalSessionPersistenceProvider | undefined,
): WorkspaceMutationResult {
  /**
   * CDXC:SessionPersistence 2026-05-07-20:32
   * Provider-backed sessions reconnect by a provider/name pair. Store the
   * provider on the terminal record so changing Settings later cannot wake a
   * tmux session through zmx or a zmx session through zellij.
   */
  return updateSession(snapshot, sessionId, (session) => {
    if (
      session.kind !== "terminal" ||
      session.sessionPersistenceProvider === sessionPersistenceProvider
    ) {
      return session;
    }

    return {
      ...session,
      sessionPersistenceProvider,
    };
  });
}

export function setTerminalSessionEngineInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  terminalEngine: TerminalEngine,
): WorkspaceMutationResult {
  return updateSession(snapshot, sessionId, (session) => {
    if (session.kind !== "terminal" || session.terminalEngine === terminalEngine) {
      return session;
    }

    return {
      ...session,
      terminalEngine,
    };
  });
}

export function setT3SessionMetadataInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  t3: T3SessionMetadata,
): WorkspaceMutationResult {
  return updateSession(snapshot, sessionId, (session) => {
    if (session.kind !== "t3") {
      return session;
    }

    return {
      ...session,
      t3: normalizeT3SessionMetadata(t3),
    };
  });
}

export function setVisibleCountInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  visibleCount: VisibleSessionCount,
): GroupedSessionWorkspaceSnapshot {
  const activeGroup = getActiveGroup(snapshot);
  if (!activeGroup) {
    return snapshot;
  }

  return updateGroup(snapshot, activeGroup.groupId, (group) => ({
    ...group,
    snapshot: normalizeGroupSnapshot({
      ...group.snapshot,
      fullscreenRestoreVisibleCount: undefined,
      visibleCount: clampSupportedVisibleCount(visibleCount),
    }),
  }));
}

export function toggleFullscreenSessionInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
): GroupedSessionWorkspaceSnapshot {
  const activeGroup = getActiveGroup(snapshot);
  if (!activeGroup) {
    return snapshot;
  }

  const currentVisibleCount = clampSupportedVisibleCount(activeGroup.snapshot.visibleCount);
  const restoreVisibleCount =
    activeGroup.snapshot.fullscreenRestoreVisibleCount === undefined
      ? undefined
      : clampSupportedVisibleCount(activeGroup.snapshot.fullscreenRestoreVisibleCount);
  if (currentVisibleCount === 1 && restoreVisibleCount !== undefined) {
    return updateGroup(snapshot, activeGroup.groupId, (group) => ({
      ...group,
      snapshot: normalizeGroupSnapshot({
        ...group.snapshot,
        fullscreenRestoreVisibleCount: undefined,
        visibleCount: restoreVisibleCount,
      }),
    }));
  }

  return updateGroup(snapshot, activeGroup.groupId, (group) => ({
    ...group,
    snapshot: normalizeGroupSnapshot({
      ...group.snapshot,
      fullscreenRestoreVisibleCount:
        group.snapshot.visibleCount > 1
          ? clampSupportedVisibleCount(group.snapshot.visibleCount)
          : undefined,
      visibleCount: 1,
    }),
  }));
}

export function setViewModeInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  viewMode: TerminalViewMode,
): GroupedSessionWorkspaceSnapshot {
  const activeGroup = getActiveGroup(snapshot);
  if (!activeGroup) {
    return snapshot;
  }

  return updateGroup(snapshot, activeGroup.groupId, (group) => ({
    ...group,
    snapshot: {
      ...group.snapshot,
      viewMode,
    },
  }));
}

export function syncSessionOrderInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
  sessionIds: readonly string[],
): WorkspaceMutationResult {
  const group = getGroupById(snapshot, groupId);
  if (!group) {
    return { changed: false, snapshot };
  }

  const result = reorderGroupSessions(group.snapshot, sessionIds);
  if (!result.changed) {
    return { changed: false, snapshot };
  }

  const nextSnapshot = updateGroup(snapshot, groupId, (targetGroup) => ({
    ...targetGroup,
    snapshot: normalizeGroupSnapshot(result.snapshot),
  }));

  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function swapVisibleSessionsInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
  sourceSessionId: string,
  targetSessionId: string,
): WorkspaceMutationResult {
  if (sourceSessionId === targetSessionId) {
    return { changed: false, snapshot };
  }

  const group = getGroupById(snapshot, groupId);
  if (!group) {
    return { changed: false, snapshot };
  }

  const sourceVisibleIndex = group.snapshot.visibleSessionIds.indexOf(sourceSessionId);
  const targetVisibleIndex = group.snapshot.visibleSessionIds.indexOf(targetSessionId);
  if (sourceVisibleIndex < 0 || targetVisibleIndex < 0) {
    return { changed: false, snapshot };
  }

  const sourceSessionIndex = group.snapshot.sessions.findIndex(
    (session) => session.sessionId === sourceSessionId,
  );
  const targetSessionIndex = group.snapshot.sessions.findIndex(
    (session) => session.sessionId === targetSessionId,
  );
  if (sourceSessionIndex < 0 || targetSessionIndex < 0) {
    return { changed: false, snapshot };
  }

  const nextVisibleSessionIds = [...group.snapshot.visibleSessionIds];
  nextVisibleSessionIds[sourceVisibleIndex] = targetSessionId;
  nextVisibleSessionIds[targetVisibleIndex] = sourceSessionId;
  const nextFocusedSessionId = nextVisibleSessionIds.includes(group.snapshot.focusedSessionId ?? "")
    ? group.snapshot.focusedSessionId
    : nextVisibleSessionIds[0];

  const nextSessions = [...group.snapshot.sessions];
  nextSessions[sourceSessionIndex] = group.snapshot.sessions[targetSessionIndex]!;
  nextSessions[targetSessionIndex] = group.snapshot.sessions[sourceSessionIndex]!;

  /**
   * CDXC:NativePaneReorder 2026-05-03-06:38
   * Native pane drag-and-drop reorders the panes the user can currently see;
   * it must never change which hidden/background sessions are surfaced. Keep
   * visibleSessionIds as the source of truth for the displayed pane set, while
   * swapping the same two records in the stored session order so sidebar order
   * and native placement remain aligned without pulling hidden sessions into
   * the visible split.
   *
   * If focus points at a hidden/background session, pin focus to the reordered
   * visible set before normalization. Otherwise the normal focus-preservation
   * rule would add that hidden id back to visibleSessionIds and replace a pane.
   */
  const nextSnapshot = updateGroup(snapshot, groupId, (targetGroup) => ({
    ...targetGroup,
    snapshot: normalizeGroupSnapshot({
      ...targetGroup.snapshot,
      focusedSessionId: nextFocusedSessionId,
      sessions: reindexSessionsInOrder(nextSessions),
      visibleSessionIds: nextVisibleSessionIds,
    }),
  }));

  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function selectPaneTabInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
  sessionId: string,
): WorkspaceMutationResult {
  const group = getGroupById(snapshot, groupId);
  if (!group || !group.snapshot.visibleSessionIds.includes(sessionId)) {
    return { changed: false, snapshot };
  }
  const nextLayout = setActiveSessionInPaneLayout(group.snapshot.paneLayout, sessionId);
  const nextSnapshot = updateGroup(snapshot, groupId, (targetGroup) => ({
    ...targetGroup,
    snapshot: normalizeGroupSnapshot({
      ...targetGroup.snapshot,
      focusedSessionId: sessionId,
      ...(nextLayout ? { paneLayout: nextLayout } : {}),
    }),
  }));
  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function moveSessionInPaneLayoutInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
  sourceSessionId: string,
  targetSessionId: string,
  placement: SessionPaneDropPlacement,
): WorkspaceMutationResult {
  if (sourceSessionId === targetSessionId) {
    return { changed: false, snapshot };
  }
  const group = getGroupById(snapshot, groupId);
  if (!group) {
    return { changed: false, snapshot };
  }
  const paneSessionIds = getPaneSessionIds(group.snapshot);
  const paneSessionIdSet = new Set(paneSessionIds);
  if (!paneSessionIdSet.has(sourceSessionId) || !paneSessionIdSet.has(targetSessionId)) {
    return { changed: false, snapshot };
  }
  const currentLayout =
    normalizePaneLayout(
      group.snapshot.paneLayout,
      paneSessionIds,
      paneSessionIds,
      group.snapshot.focusedSessionId,
    ) ?? createPaneLayoutFromVisibleIds(paneSessionIds);
  if (!currentLayout) {
    return { changed: false, snapshot };
  }
  const layoutWithoutSource = removeSessionFromPaneLayout(currentLayout, sourceSessionId);
  if (!layoutWithoutSource) {
    return { changed: false, snapshot };
  }

  const nextLayout =
    placement === "center"
      ? addSessionToPaneTabGroup(layoutWithoutSource, targetSessionId, sourceSessionId)
      : insertExistingSessionBesidePane(
          layoutWithoutSource,
          targetSessionId,
          sourceSessionId,
          placement === "left" || placement === "right" ? "horizontal" : "vertical",
          placement === "right" || placement === "bottom",
        );
  if (!nextLayout) {
    return { changed: false, snapshot };
  }
  const nextVisibleSessionIds =
    placement === "center"
      ? paneSessionIds
      : moveVisibleSessionNearTarget(
          paneSessionIds,
          sourceSessionId,
          targetSessionId,
          placement === "right" || placement === "bottom",
        );

  /**
   * CDXC:PaneTabs 2026-05-10-18:30
   * Native tab dragging mutates the persisted paneLayout directly: middle
   * drops create/update a tab group, while side drops move the dragged session
   * into a new split beside the target pane. visibleSessionIds keeps the set of
   * running sessions surfaced in the workspace; paneLayout owns grouping.
   */
  const nextSnapshot = updateGroup(snapshot, groupId, (targetGroup) => ({
    ...targetGroup,
    snapshot: normalizeGroupSnapshot({
      ...targetGroup.snapshot,
      focusedSessionId: sourceSessionId,
      paneLayout: nextLayout,
      visibleCount: clampSupportedVisibleCount(Math.max(1, nextVisibleSessionIds.length)),
      visibleSessionIds: nextVisibleSessionIds,
    }),
  }));
  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function reorderSessionInPaneTabGroupInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
  sourceSessionId: string,
  targetSessionId: string,
  position: SessionPaneTabReorderPosition,
): WorkspaceMutationResult {
  if (sourceSessionId === targetSessionId) {
    return { changed: false, snapshot };
  }
  const group = getGroupById(snapshot, groupId);
  if (!group) {
    return { changed: false, snapshot };
  }
  const currentLayout = normalizePaneLayout(
    group.snapshot.paneLayout,
    group.snapshot.sessions.map((session) => session.sessionId),
    group.snapshot.sessions.map((session) => session.sessionId),
    group.snapshot.focusedSessionId,
  );
  if (!currentLayout) {
    return { changed: false, snapshot };
  }
  const result = reorderSessionInPaneTabGroupNode(
    currentLayout,
    sourceSessionId,
    targetSessionId,
    position,
  );
  if (!result.didReorder) {
    return { changed: false, snapshot };
  }
  /**
   * CDXC:PaneTabs 2026-05-11-01:43
   * Native tab-bar drags reorder only the tab list inside the containing
   * paneLayout tab group. They must not split panes, swap visibleSessionIds, or
   * move the session into a different group.
   */
  const nextSnapshot = updateGroup(snapshot, groupId, (targetGroup) => ({
    ...targetGroup,
    snapshot: normalizeGroupSnapshot({
      ...targetGroup.snapshot,
      paneLayout: result.node,
    }),
  }));
  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function syncGroupOrderInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupIds: readonly string[],
): WorkspaceMutationResult {
  const groupById = new Map(snapshot.groups.map((group) => [group.groupId, group]));
  const orderedGroups = groupIds
    .map((groupId) => groupById.get(groupId))
    .filter((group): group is SessionGroupRecord => group !== undefined);
  for (const group of snapshot.groups) {
    if (!orderedGroups.some((candidate) => candidate.groupId === group.groupId)) {
      orderedGroups.push(group);
    }
  }

  const nextSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot({
    ...snapshot,
    groups: orderedGroups,
  });
  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function moveSessionToGroupInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  groupId: string,
  targetIndex?: number,
): WorkspaceMutationResult {
  const sourceGroup = getGroupForSession(snapshot, sessionId);
  const targetGroup = getGroupById(snapshot, groupId);
  if (!sourceGroup || !targetGroup) {
    return { changed: false, snapshot };
  }

  const sessionToMove = sourceGroup.snapshot.sessions.find(
    (session) => session.sessionId === sessionId,
  );
  if (!sessionToMove) {
    return { changed: false, snapshot };
  }

  if (sourceGroup.groupId === groupId) {
    const nextSessions = sourceGroup.snapshot.sessions.filter(
      (session) => session.sessionId !== sessionId,
    );
    const insertIndex =
      typeof targetIndex === "number"
        ? Math.max(0, Math.min(targetIndex, nextSessions.length))
        : nextSessions.length;
    nextSessions.splice(insertIndex, 0, sessionToMove);
    const reorderedSessions = nextSessions.map((session, index) => ({
      ...session,
      slotIndex: index,
    }));

    const nextSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot({
      ...updateGroup(snapshot, groupId, (group) => ({
        ...group,
        snapshot: normalizeGroupSnapshot({
          ...group.snapshot,
          focusedSessionId: sessionId,
          sessions: reorderedSessions,
          visibleSessionIds: getNextVisibleIdsForFocusedSession(
            reorderedSessions,
            group.snapshot.visibleCount,
            sessionId,
            group.snapshot.visibleSessionIds,
            group.snapshot.focusedSessionId,
          ),
        }),
      })),
      activeGroupId: groupId,
    });

    return {
      changed: !areSnapshotsEqual(snapshot, nextSnapshot),
      snapshot: nextSnapshot,
    };
  }

  const strippedSnapshot = updateGroup(
    updateGroup(snapshot, sourceGroup.groupId, (group) => ({
      ...group,
      snapshot: normalizeGroupSnapshot({
        ...group.snapshot,
        sessions: group.snapshot.sessions.filter((session) => session.sessionId !== sessionId),
        visibleSessionIds: group.snapshot.visibleSessionIds.filter((id) => id !== sessionId),
        focusedSessionId:
          group.snapshot.focusedSessionId === sessionId
            ? undefined
            : group.snapshot.focusedSessionId,
      }),
    })),
    groupId,
    (group) => {
      const nextSessions = [...group.snapshot.sessions];
      const insertIndex =
        typeof targetIndex === "number"
          ? Math.max(0, Math.min(targetIndex, nextSessions.length))
          : nextSessions.length;
      nextSessions.splice(insertIndex, 0, sessionToMove);
      const reorderedSessions = nextSessions.map((session, index) => ({
        ...session,
        slotIndex: index,
      }));
      return {
        ...group,
        snapshot: normalizeGroupSnapshot({
          ...group.snapshot,
          focusedSessionId: sessionId,
          sessions: reorderedSessions,
          visibleSessionIds: getNextVisibleIdsForFocusedSession(
            reorderedSessions,
            group.snapshot.visibleCount,
            sessionId,
            group.snapshot.visibleSessionIds,
            group.snapshot.focusedSessionId,
          ),
        }),
      };
    },
  );

  const nextSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot({
    ...strippedSnapshot,
    activeGroupId: groupId,
  });
  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

export function createGroupFromSessionInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
): CreateGroupResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  const resolvedSession = resolveSessionReference(normalizedSnapshot, sessionId);
  const sourceGroup = resolvedSession?.group;
  if (!sourceGroup || normalizedSnapshot.groups.length >= MAX_GROUP_COUNT) {
    return { changed: false, snapshot: normalizedSnapshot };
  }
  const resolvedSessionId = resolvedSession.session.sessionId;

  const session = sourceGroup.snapshot.sessions.find(
    (candidate) => candidate.sessionId === resolvedSessionId,
  );
  if (!session) {
    return { changed: false, snapshot: normalizedSnapshot };
  }
  const canonicalSessionId = session.sessionId === sessionId ? session.sessionId : sessionId;
  const sessionForNewGroup =
    session.sessionId === canonicalSessionId ? session : { ...session, sessionId: canonicalSessionId };

  const nextGroupNumber = Math.max(
    normalizedSnapshot.nextGroupNumber,
    getNextGroupNumber(normalizedSnapshot.groups),
  );
  const nextGroupId = `group-${nextGroupNumber}`;
  const nextGroup: SessionGroupRecord = {
    groupId: nextGroupId,
    snapshot: normalizeGroupSnapshot({
      ...createDefaultSessionGridSnapshot(),
      focusedSessionId: canonicalSessionId,
      sessions: [sessionForNewGroup],
      visibleCount: 1,
      visibleSessionIds: [canonicalSessionId],
    }),
    title: `Group ${nextGroupNumber}`,
  };
  const snapshotWithoutSession = updateGroup(normalizedSnapshot, sourceGroup.groupId, (group) => ({
    ...group,
    snapshot: normalizeGroupSnapshot({
      ...group.snapshot,
      sessions: group.snapshot.sessions.filter(
        (candidate) => candidate.sessionId !== resolvedSessionId,
      ),
      visibleSessionIds: group.snapshot.visibleSessionIds.filter((id) => id !== resolvedSessionId),
      focusedSessionId:
        group.snapshot.focusedSessionId === resolvedSessionId
          ? undefined
          : group.snapshot.focusedSessionId,
    }),
  }));
  const nextSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot({
    ...snapshotWithoutSession,
    activeGroupId: nextGroupId,
    groups: [...snapshotWithoutSession.groups, nextGroup],
    nextGroupNumber: nextGroupNumber + 1,
  });

  return {
    changed: !areSnapshotsEqual(normalizedSnapshot, nextSnapshot),
    groupId: nextGroupId,
    snapshot: nextSnapshot,
  };
}

export function createGroupInSimpleWorkspace(
  snapshot: GroupedSessionWorkspaceSnapshot,
): CreateGroupResult {
  const normalizedSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot(snapshot);
  if (normalizedSnapshot.groups.length >= MAX_GROUP_COUNT) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const nextGroupNumber = Math.max(
    normalizedSnapshot.nextGroupNumber,
    getNextGroupNumber(normalizedSnapshot.groups),
  );
  const nextGroupId = `group-${nextGroupNumber}`;
  const nextSnapshot = normalizeSimpleGroupedSessionWorkspaceSnapshot({
    ...normalizedSnapshot,
    activeGroupId: nextGroupId,
    groups: [
      ...normalizedSnapshot.groups,
      createEmptyGroup(nextGroupId, `Group ${nextGroupNumber}`),
    ],
    nextGroupNumber: nextGroupNumber + 1,
  });

  return {
    changed: !areSnapshotsEqual(normalizedSnapshot, nextSnapshot),
    groupId: nextGroupId,
    snapshot: nextSnapshot,
  };
}

function normalizeGroup(group: SessionGroupRecord, index: number): SessionGroupRecord {
  return {
    groupId: group.groupId?.trim() || `group-${index + 1}`,
    snapshot: normalizeGroupSnapshot(group.snapshot),
    title: group.title?.trim() || (index === 0 ? DEFAULT_MAIN_GROUP_TITLE : `Group ${index + 1}`),
  };
}

function prepareGroupForDisplayIdNormalization(
  group: SessionGroupRecord,
  index: number,
): SessionGroupRecord {
  return {
    groupId: group.groupId?.trim() || `group-${index + 1}`,
    snapshot: {
      ...createDefaultSessionGridSnapshot(),
      ...group.snapshot,
      /**
       * CDXC:BrowserPanes 2026-05-02-12:04
       * Browser panes are embedded WKWebView workspace sessions, not transient
       * external browser overlays. Keep browser records during workspace
       * normalization so sidebar cards, visible ids, and native split layout
       * all use the same persistent session list as terminal and T3 panes.
       */
      sessions: group.snapshot.sessions,
    },
    title: group.title?.trim() || (index === 0 ? DEFAULT_MAIN_GROUP_TITLE : `Group ${index + 1}`),
  };
}

function normalizeGroupSnapshot(
  snapshot: SessionGroupRecord["snapshot"],
): SessionGroupRecord["snapshot"] {
  const sessionIdByLegacyId = new Map<string, string>();
  const sessions = getOrderedSessions({
    ...createDefaultSessionGridSnapshot(),
    ...snapshot,
    sessions: snapshot.sessions,
  }).map((session, index) => {
    const position = getSlotPosition(index);
    const nextSession = normalizeSessionRecord(session);
    sessionIdByLegacyId.set(session.sessionId, nextSession.sessionId);
    return {
      ...nextSession,
      column: position.column,
      row: position.row,
      slotIndex: index,
    };
  });
  const awakeSessions = getAwakeSessions(sessions);
  const focusedSessionId = awakeSessions.some(
    (session) => session.sessionId === sessionIdByLegacyId.get(snapshot.focusedSessionId ?? ""),
  )
    ? sessionIdByLegacyId.get(snapshot.focusedSessionId ?? "")
    : awakeSessions[0]?.sessionId;
  const visibleCount =
    awakeSessions.length === 0 ? 1 : clampSupportedVisibleCount(snapshot.visibleCount);
  const normalizedVisibleSessionIds = snapshot.visibleSessionIds.map(
    (sessionId) => sessionIdByLegacyId.get(sessionId) ?? sessionId,
  );
  const visibleSessionIds = getNormalizedVisibleIds(
    awakeSessions,
    visibleCount,
    focusedSessionId,
    normalizedVisibleSessionIds,
  );
  const paneLayoutSessionIds = sessions.map((session) => session.sessionId);
  const snapshotPaneLayoutSessionIds = getPaneLayoutSessionIds(snapshot.paneLayout).map(
    (sessionId) => sessionIdByLegacyId.get(sessionId) ?? sessionId,
  );
  const normalizedPaneLayoutSessionIds = [
    ...normalizedVisibleSessionIds,
    ...snapshotPaneLayoutSessionIds,
  ].filter(
    (sessionId, index, sessionIds) =>
      paneLayoutSessionIds.includes(sessionId) && sessionIds.indexOf(sessionId) === index,
  );
  /**
   * CDXC:PaneTabs 2026-05-11-01:31
   * Sleeping a session must park its native surface without deleting its
   * persisted pane/tab position. Normalize paneLayout against the visible set
   * plus the sessions already encoded in the stored pane tree, while
   * visibleSessionIds still tracks the currently awake subset. Interactive
   * wake can intentionally rewrite paneLayout without the normalizer adding
   * every background session back as a pane.
   */
  const paneLayout = normalizePaneLayout(
    snapshot.paneLayout,
    paneLayoutSessionIds,
    normalizedPaneLayoutSessionIds,
    focusedSessionId,
  );

  return {
    focusedSessionId,
    fullscreenRestoreVisibleCount:
      visibleCount === 1 && snapshot.fullscreenRestoreVisibleCount !== undefined
        ? clampSupportedVisibleCount(snapshot.fullscreenRestoreVisibleCount)
        : undefined,
    ...(paneLayout ? { paneLayout } : {}),
    sessions,
    viewMode: snapshot.viewMode ?? "grid",
    visibleCount,
    visibleSessionIds,
  };
}

function getVisibleSessionPlacementResult(
  sessions: readonly SessionRecord[],
  currentVisibleCount: VisibleSessionCount,
  currentVisibleSessionIds: readonly string[],
  nextSessionId: string,
  placement: VisibleSessionPlacement,
): { replacedSessionId?: string; visibleCount: VisibleSessionCount; visibleSessionIds: string[] } {
  /**
   * CDXC:NativeSplits 2026-05-10-18:30
   * Native split buttons and Cmd+D/Cmd+Shift+D create a real new workspace
   * session and surface it in a deterministic pane slot. Placement is computed
   * before focus changes so title-bar button clicks cannot accidentally replace
   * the previously focused pane instead of the pane the user clicked.
   */
  const stableVisibleSessionIds = getPlacementStableVisibleIds(
    sessions,
    currentVisibleSessionIds,
  );
  switch (placement.kind) {
    case "appendFullWidth":
      return insertVisibleSessionAfterTarget(stableVisibleSessionIds, nextSessionId, undefined);
    case "appendToTabGroup":
      return insertVisibleSessionAfterTarget(
        stableVisibleSessionIds,
        nextSessionId,
        placement.targetSessionId,
      );
    case "insertAfter":
      return insertVisibleSessionAfterTarget(
        stableVisibleSessionIds,
        nextSessionId,
        placement.targetSessionId,
      );
    case "replace":
      return replaceVisibleSessionTarget(
        currentVisibleCount,
        stableVisibleSessionIds,
        nextSessionId,
        placement.targetSessionId,
      );
    case "replaceNonFocused":
      return replaceNonFocusedVisibleSession(
        currentVisibleCount,
        sessions,
        stableVisibleSessionIds,
        nextSessionId,
        placement.preserveSessionId,
      );
  }
}

function getNextPaneLayoutForCreatedSession(
  currentLayout: SessionPaneLayoutNode | undefined,
  currentVisibleSessionIds: readonly string[],
  nextVisibleSessionIds: readonly string[],
  nextSessionId: string,
  placement: VisibleSessionPlacement | undefined,
  replacedSessionId: string | undefined,
): SessionPaneLayoutNode | undefined {
  /**
   * CDXC:NativeSplits 2026-05-10-18:30
   * Session creation owns pane-layout mutation. Split commands insert the new
   * leaf into the targeted split tree, while replacement commands swap the leaf
   * that was intentionally replaced. This keeps native geometry persistent
   * across app restart instead of rebuilding from visible-session counts.
   */
  const seededLayout =
    normalizePaneLayout(currentLayout, currentVisibleSessionIds, currentVisibleSessionIds) ??
    createPaneLayoutFromVisibleIds(currentVisibleSessionIds);
  if (!placement || !seededLayout) {
    return normalizePaneLayout(
      createPaneLayoutFromVisibleIds(nextVisibleSessionIds),
      nextVisibleSessionIds,
      nextVisibleSessionIds,
      nextSessionId,
    );
  }

  if (placement.kind === "insertAfter") {
    const targetSessionId = placement.targetSessionId ?? currentVisibleSessionIds.at(-1);
    const splitDirection = placement.splitDirection ?? "horizontal";
    const insertedLayout = targetSessionId
      ? insertSessionIntoPaneLayout(seededLayout, targetSessionId, nextSessionId, splitDirection)
      : undefined;
    return normalizePaneLayout(
      insertedLayout ?? appendSessionToPaneLayout(seededLayout, nextSessionId, splitDirection),
      nextVisibleSessionIds,
      nextVisibleSessionIds,
      nextSessionId,
    );
  }

  if (placement.kind === "appendFullWidth") {
    /**
     * CDXC:WorkspacePanes 2026-05-11-03:20
     * The Settings-row secondary terminal button creates a normal terminal in
     * the active project, but it must span the full workarea width. Wrap the
     * existing pane tree in an 85/15 vertical split and append the new leaf as
     * a 15%-height bottom row instead of splitting the currently focused pane.
     */
    return normalizePaneLayout(
      appendFullWidthSessionToPaneLayout(seededLayout, nextSessionId),
      nextVisibleSessionIds,
      nextVisibleSessionIds,
      nextSessionId,
    );
  }

  if (placement.kind === "appendToTabGroup") {
    /**
     * CDXC:PaneTabs 2026-05-11-16:16
     * Title-bar New Terminal and Open Browser create a new tab in the clicked
     * pane. Do not replace the target session: keeping the old and new sessions
     * in one paneLayout tabs node prevents native layout sync from appending the
     * still-awake old session as a separate split pane.
     */
    const tabbedLayout = addSessionToPaneTabGroup(
      seededLayout,
      placement.targetSessionId,
      nextSessionId,
    );
    return normalizePaneLayout(
      tabbedLayout ?? createPaneLayoutFromVisibleIds(nextVisibleSessionIds),
      nextVisibleSessionIds,
      nextVisibleSessionIds,
      nextSessionId,
    );
  }

  if (placement.kind === "replace" || placement.kind === "replaceNonFocused") {
    const targetSessionId =
      placement.kind === "replace" ? placement.targetSessionId : replacedSessionId;
    const replacedLayout = targetSessionId
      ? replaceSessionInPaneLayout(seededLayout, targetSessionId, nextSessionId)
      : undefined;
    return normalizePaneLayout(
      replacedLayout ?? createPaneLayoutFromVisibleIds(nextVisibleSessionIds),
      nextVisibleSessionIds,
      nextVisibleSessionIds,
      nextSessionId,
    );
  }
}

function createPaneLayoutFromVisibleIds(
  visibleSessionIds: readonly string[],
): SessionPaneLayoutNode | undefined {
  const leafs = dedupeVisibleSessionIds(visibleSessionIds).map((sessionId) => ({
    kind: "leaf" as const,
    sessionId,
  }));
  if (leafs.length === 0) {
    return undefined;
  }
  if (leafs.length === 1) {
    return leafs[0];
  }
  return { children: leafs, direction: "horizontal", kind: "split" };
}

function insertSessionIntoPaneLayout(
  layout: SessionPaneLayoutNode,
  targetSessionId: string,
  nextSessionId: string,
  direction: SessionPaneSplitDirection,
): SessionPaneLayoutNode | undefined {
  const result = insertSessionIntoPaneLayoutNode(layout, targetSessionId, nextSessionId, direction);
  return result.didInsert ? result.node : undefined;
}

function insertSessionIntoPaneLayoutNode(
  node: SessionPaneLayoutNode,
  targetSessionId: string,
  nextSessionId: string,
  direction: SessionPaneSplitDirection,
): { didInsert: boolean; node: SessionPaneLayoutNode } {
  if (node.kind === "leaf") {
    if (node.sessionId !== targetSessionId) {
      return { didInsert: false, node };
    }
    return {
      didInsert: true,
      node: {
        children: [node, { kind: "leaf", sessionId: nextSessionId }],
        direction,
        kind: "split",
      },
    };
  }

  if (node.kind === "tabs") {
    if (!node.sessionIds.includes(targetSessionId)) {
      return { didInsert: false, node };
    }
    return {
      didInsert: true,
      node: {
        children: [node, { kind: "leaf", sessionId: nextSessionId }],
        direction,
        kind: "split",
      },
    };
  }

  const children: SessionPaneLayoutNode[] = [];
  let didInsert = false;
  for (const child of node.children) {
    if (!didInsert && paneLayoutContainsSession(child, targetSessionId)) {
      if (node.direction === direction) {
        children.push(child, { kind: "leaf", sessionId: nextSessionId });
        didInsert = true;
      } else {
        const result = insertSessionIntoPaneLayoutNode(
          child,
          targetSessionId,
          nextSessionId,
          direction,
        );
        children.push(result.node);
        didInsert = result.didInsert;
      }
    } else {
      children.push(child);
    }
  }
  return {
    didInsert,
    node: flattenPaneLayoutSplit({ ...node, children }),
  };
}

function appendSessionToPaneLayout(
  layout: SessionPaneLayoutNode,
  nextSessionId: string,
  direction: SessionPaneSplitDirection,
): SessionPaneLayoutNode {
  if (layout.kind === "split" && layout.direction === direction) {
    return flattenPaneLayoutSplit({
      ...layout,
      children: [...layout.children, { kind: "leaf", sessionId: nextSessionId }],
    });
  }
  return {
    children: [layout, { kind: "leaf", sessionId: nextSessionId }],
    direction,
    kind: "split",
  };
}

function appendFullWidthSessionToPaneLayout(
  layout: SessionPaneLayoutNode,
  nextSessionId: string,
): SessionPaneLayoutNode {
  return {
    children: [layout, { kind: "leaf", sessionId: nextSessionId }],
    direction: "vertical",
    kind: "split",
    ratio: 0.85,
  };
}

function replaceSessionInPaneLayout(
  layout: SessionPaneLayoutNode,
  targetSessionId: string,
  nextSessionId: string,
): SessionPaneLayoutNode | undefined {
  const result = replaceSessionInPaneLayoutNode(layout, targetSessionId, nextSessionId);
  return result.didReplace ? result.node : undefined;
}

function replaceSessionInPaneLayoutNode(
  node: SessionPaneLayoutNode,
  targetSessionId: string,
  nextSessionId: string,
): { didReplace: boolean; node: SessionPaneLayoutNode } {
  if (node.kind === "leaf") {
    return node.sessionId === targetSessionId
      ? { didReplace: true, node: { kind: "leaf", sessionId: nextSessionId } }
      : { didReplace: false, node };
  }
  if (node.kind === "tabs") {
    if (!node.sessionIds.includes(targetSessionId)) {
      return { didReplace: false, node };
    }
    const sessionIds = node.sessionIds.map((sessionId) =>
      sessionId === targetSessionId ? nextSessionId : sessionId,
    );
    return {
      didReplace: true,
      node: {
        ...node,
        activeSessionId:
          node.activeSessionId === targetSessionId ? nextSessionId : node.activeSessionId,
        sessionIds,
      },
    };
  }
  let didReplace = false;
  const children = node.children.map((child) => {
    if (didReplace) {
      return child;
    }
    const result = replaceSessionInPaneLayoutNode(child, targetSessionId, nextSessionId);
    didReplace = result.didReplace;
    return result.node;
  });
  return {
    didReplace,
    node: flattenPaneLayoutSplit({ ...node, children }),
  };
}

function setActiveSessionInPaneLayout(
  layout: SessionPaneLayoutNode | undefined,
  sessionId: string,
): SessionPaneLayoutNode | undefined {
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
      children: layout.children.map((child) => setActiveSessionInPaneLayout(child, sessionId) ?? child),
    };
  }
  return layout;
}

function removeSessionFromPaneLayout(
  layout: SessionPaneLayoutNode,
  sessionId: string,
): SessionPaneLayoutNode | undefined {
  if (layout.kind === "leaf") {
    return layout.sessionId === sessionId ? undefined : layout;
  }
  if (layout.kind === "tabs") {
    const sessionIds = layout.sessionIds.filter((id) => id !== sessionId);
    if (sessionIds.length === 0) {
      return undefined;
    }
    if (sessionIds.length === 1) {
      return { kind: "leaf", sessionId: sessionIds[0]! };
    }
    return {
      ...layout,
      activeSessionId:
        layout.activeSessionId && sessionIds.includes(layout.activeSessionId)
          ? layout.activeSessionId
          : sessionIds[0],
      sessionIds,
    };
  }
  const children = layout.children
    .map((child) => removeSessionFromPaneLayout(child, sessionId))
    .filter((child): child is SessionPaneLayoutNode => child !== undefined);
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  return flattenPaneLayoutSplit({ ...layout, children });
}

function addSessionToPaneTabGroup(
  layout: SessionPaneLayoutNode,
  targetSessionId: string,
  sourceSessionId: string,
): SessionPaneLayoutNode | undefined {
  const result = addSessionToPaneTabGroupNode(layout, targetSessionId, sourceSessionId);
  return result.didAdd ? result.node : undefined;
}

function addSessionToPaneTabGroupNode(
  node: SessionPaneLayoutNode,
  targetSessionId: string,
  sourceSessionId: string,
): { didAdd: boolean; node: SessionPaneLayoutNode } {
  if (node.kind === "leaf") {
    return node.sessionId === targetSessionId
      ? {
          didAdd: true,
          node: {
            activeSessionId: sourceSessionId,
            kind: "tabs",
            sessionIds: [targetSessionId, sourceSessionId],
          },
        }
      : { didAdd: false, node };
  }
  if (node.kind === "tabs") {
    if (!node.sessionIds.includes(targetSessionId)) {
      return { didAdd: false, node };
    }
    return {
      didAdd: true,
      node: {
        ...node,
        activeSessionId: sourceSessionId,
        sessionIds: dedupeVisibleSessionIds([...node.sessionIds, sourceSessionId]),
      },
    };
  }
  let didAdd = false;
  const children = node.children.map((child) => {
    if (didAdd) {
      return child;
    }
    const result = addSessionToPaneTabGroupNode(child, targetSessionId, sourceSessionId);
    didAdd = result.didAdd;
    return result.node;
  });
  return {
    didAdd,
    node: flattenPaneLayoutSplit({ ...node, children }),
  };
}

function insertExistingSessionBesidePane(
  layout: SessionPaneLayoutNode,
  targetSessionId: string,
  sourceSessionId: string,
  direction: SessionPaneSplitDirection,
  placeAfterTarget: boolean,
): SessionPaneLayoutNode | undefined {
  const result = insertExistingSessionBesidePaneNode(
    layout,
    targetSessionId,
    sourceSessionId,
    direction,
    placeAfterTarget,
  );
  return result.didInsert ? result.node : undefined;
}

function insertExistingSessionBesidePaneNode(
  node: SessionPaneLayoutNode,
  targetSessionId: string,
  sourceSessionId: string,
  direction: SessionPaneSplitDirection,
  placeAfterTarget: boolean,
): { didInsert: boolean; node: SessionPaneLayoutNode } {
  const sourceLeaf: SessionPaneLayoutNode = { kind: "leaf", sessionId: sourceSessionId };
  if (node.kind === "leaf" || node.kind === "tabs") {
    const containsTarget = paneLayoutContainsSession(node, targetSessionId);
    if (!containsTarget) {
      return { didInsert: false, node };
    }
    return {
      didInsert: true,
      node: {
        children: placeAfterTarget ? [node, sourceLeaf] : [sourceLeaf, node],
        direction,
        kind: "split",
      },
    };
  }
  const children: SessionPaneLayoutNode[] = [];
  let didInsert = false;
  for (const child of node.children) {
    if (!didInsert && paneLayoutContainsSession(child, targetSessionId)) {
      if (node.direction === direction) {
        if (placeAfterTarget) {
          children.push(child, sourceLeaf);
        } else {
          children.push(sourceLeaf, child);
        }
        didInsert = true;
      } else {
        const result = insertExistingSessionBesidePaneNode(
          child,
          targetSessionId,
          sourceSessionId,
          direction,
          placeAfterTarget,
        );
        children.push(result.node);
        didInsert = result.didInsert;
      }
    } else {
      children.push(child);
    }
  }
  return {
    didInsert,
    node: flattenPaneLayoutSplit({ ...node, children }),
  };
}

function reorderSessionInPaneTabGroupNode(
  node: SessionPaneLayoutNode,
  sourceSessionId: string,
  targetSessionId: string,
  position: SessionPaneTabReorderPosition,
): { didReorder: boolean; node: SessionPaneLayoutNode } {
  if (node.kind === "leaf") {
    return { didReorder: false, node };
  }
  if (node.kind === "tabs") {
    if (!node.sessionIds.includes(sourceSessionId) || !node.sessionIds.includes(targetSessionId)) {
      return { didReorder: false, node };
    }
    const sessionIdsWithoutSource = node.sessionIds.filter(
      (sessionId) => sessionId !== sourceSessionId,
    );
    const targetIndex = sessionIdsWithoutSource.indexOf(targetSessionId);
    if (targetIndex < 0) {
      return { didReorder: false, node };
    }
    const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    const nextSessionIds = [...sessionIdsWithoutSource];
    nextSessionIds.splice(insertIndex, 0, sourceSessionId);
    if (nextSessionIds.join("\u0000") === node.sessionIds.join("\u0000")) {
      return { didReorder: false, node };
    }
    return {
      didReorder: true,
      node: {
        ...node,
        sessionIds: nextSessionIds,
      },
    };
  }
  let didReorder = false;
  const children = node.children.map((child) => {
    if (didReorder) {
      return child;
    }
    const result = reorderSessionInPaneTabGroupNode(
      child,
      sourceSessionId,
      targetSessionId,
      position,
    );
    didReorder = result.didReorder;
    return result.node;
  });
  return {
    didReorder,
    node: didReorder ? flattenPaneLayoutSplit({ ...node, children }) : node,
  };
}

function moveVisibleSessionNearTarget(
  visibleSessionIds: readonly string[],
  sourceSessionId: string,
  targetSessionId: string,
  placeAfterTarget: boolean,
): string[] {
  const nextVisibleSessionIds = visibleSessionIds.filter((sessionId) => sessionId !== sourceSessionId);
  const targetIndex = nextVisibleSessionIds.indexOf(targetSessionId);
  if (targetIndex < 0) {
    return [...visibleSessionIds];
  }
  nextVisibleSessionIds.splice(targetIndex + (placeAfterTarget ? 1 : 0), 0, sourceSessionId);
  return nextVisibleSessionIds;
}

function getPaneSessionIds(snapshot: SessionGroupRecord["snapshot"]): string[] {
  /**
   * CDXC:PaneTabs 2026-05-11-14:07
   * Native pane tabs render every session, not just the legacy visibleSessionIds
   * slice. Pane drop mutations must use the same inventory or a tab appended by
   * the all-session rule can be dragged in Swift but ignored by the sidebar as
   * "not visible".
   */
  const sessionIdSet = new Set(snapshot.sessions.map((session) => session.sessionId));
  const paneSessionIds: string[] = [];
  for (const sessionId of [
    ...snapshot.visibleSessionIds,
    ...snapshot.sessions.map((session) => session.sessionId),
  ]) {
    if (!sessionIdSet.has(sessionId) || paneSessionIds.includes(sessionId)) {
      continue;
    }
    paneSessionIds.push(sessionId);
  }
  return paneSessionIds;
}

function normalizePaneLayout(
  layout: SessionPaneLayoutNode | undefined,
  allowedSessionIds: readonly string[],
  visibleSessionIds: readonly string[],
  focusedSessionId?: string,
): SessionPaneLayoutNode | undefined {
  const allowedSessionIdSet = new Set(allowedSessionIds);
  const visibleSessionIdSet = new Set(visibleSessionIds);
  const normalized = layout
    ? normalizePaneLayoutNode(layout, allowedSessionIdSet, visibleSessionIdSet, focusedSessionId)
    : undefined;
  const missingVisibleSessionIds = visibleSessionIds.filter(
    (sessionId) => !paneLayoutContainsSession(normalized, sessionId),
  );
  if (missingVisibleSessionIds.length === 0) {
    return normalized;
  }
  const missingLayout = createPaneLayoutFromVisibleIds(missingVisibleSessionIds);
  if (!normalized) {
    return missingLayout;
  }
  if (!missingLayout) {
    return normalized;
  }
  return flattenPaneLayoutSplit({
    children: [normalized, missingLayout],
    direction: "horizontal",
    kind: "split",
  });
}

function normalizePaneLayoutNode(
  node: SessionPaneLayoutNode,
  allowedSessionIdSet: ReadonlySet<string>,
  visibleSessionIdSet: ReadonlySet<string>,
  focusedSessionId: string | undefined,
): SessionPaneLayoutNode | undefined {
  if (node.kind === "leaf") {
    return allowedSessionIdSet.has(node.sessionId) && visibleSessionIdSet.has(node.sessionId)
      ? node
      : undefined;
  }
  if (node.kind === "tabs") {
    const sessionIds = dedupeVisibleSessionIds(node.sessionIds).filter(
      (sessionId) => allowedSessionIdSet.has(sessionId) && visibleSessionIdSet.has(sessionId),
    );
    if (sessionIds.length === 0) {
      return undefined;
    }
    const activeSessionId =
      (node.activeSessionId && sessionIds.includes(node.activeSessionId)
        ? node.activeSessionId
        : undefined) ??
      (focusedSessionId && sessionIds.includes(focusedSessionId) ? focusedSessionId : undefined) ??
      sessionIds[0];
    return sessionIds.length === 1
      ? { kind: "leaf", sessionId: sessionIds[0]! }
      : { activeSessionId, kind: "tabs", sessionIds };
  }
  const children = node.children
    .map((child) =>
      normalizePaneLayoutNode(child, allowedSessionIdSet, visibleSessionIdSet, focusedSessionId),
    )
    .filter((child): child is SessionPaneLayoutNode => child !== undefined);
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  return flattenPaneLayoutSplit({ ...node, children });
}

function flattenPaneLayoutSplit(
  node: Extract<SessionPaneLayoutNode, { kind: "split" }>,
): SessionPaneLayoutNode {
  /**
   * CDXC:WorkspacePanes 2026-05-11-03:20
   * Ratio-bearing splits encode intentional pane sizing. Do not flatten their
   * same-direction children, because an 85/15 bottom terminal row must remain a
   * two-child split even when the existing workarea is already vertically split.
   */
  if (node.ratio !== undefined) {
    return node.children.length === 1 ? node.children[0]! : node;
  }
  const children = node.children.flatMap((child) =>
    child.kind === "split" && child.direction === node.direction ? child.children : [child],
  );
  return children.length === 1 ? children[0]! : { ...node, children };
}

function paneLayoutContainsSession(
  node: SessionPaneLayoutNode | undefined,
  sessionId: string,
): boolean {
  if (!node) {
    return false;
  }
  switch (node.kind) {
    case "leaf":
      return node.sessionId === sessionId;
    case "tabs":
      return node.sessionIds.includes(sessionId);
    case "split":
      return node.children.some((child) => paneLayoutContainsSession(child, sessionId));
  }
}

function getPaneLayoutSessionIds(node: SessionPaneLayoutNode | undefined): string[] {
  if (!node) {
    return [];
  }
  switch (node.kind) {
    case "leaf":
      return [node.sessionId];
    case "tabs":
      return node.sessionIds;
    case "split":
      return node.children.flatMap((child) => getPaneLayoutSessionIds(child));
  }
}

function getPlacementStableVisibleIds(
  sessions: readonly SessionRecord[],
  currentVisibleSessionIds: readonly string[],
): string[] {
  const sessionIdSet = new Set(sessions.map((session) => session.sessionId));
  const visibleSessionIds: string[] = [];
  for (const sessionId of currentVisibleSessionIds) {
    if (!sessionIdSet.has(sessionId) || visibleSessionIds.includes(sessionId)) {
      continue;
    }
    visibleSessionIds.push(sessionId);
  }
  return visibleSessionIds;
}

function insertVisibleSessionAfterTarget(
  currentVisibleSessionIds: readonly string[],
  nextSessionId: string,
  targetSessionId: string | undefined,
): { replacedSessionId?: string; visibleCount: VisibleSessionCount; visibleSessionIds: string[] } {
  const nextVisibleSessionIds = currentVisibleSessionIds.filter(
    (sessionId) => sessionId !== nextSessionId,
  );
  const targetIndex = targetSessionId
    ? nextVisibleSessionIds.indexOf(targetSessionId)
    : nextVisibleSessionIds.length - 1;
  nextVisibleSessionIds.splice(Math.max(0, targetIndex + 1), 0, nextSessionId);
  trimVisibleSessionIds(nextVisibleSessionIds, [nextSessionId, targetSessionId]);
  const visibleCount = clampSupportedVisibleCount(
    Math.min(MAX_SESSION_COUNT, Math.max(1, nextVisibleSessionIds.length)),
  );
  return {
    visibleCount,
    visibleSessionIds: nextVisibleSessionIds.slice(0, visibleCount),
  };
}

function replaceVisibleSessionTarget(
  currentVisibleCount: VisibleSessionCount,
  currentVisibleSessionIds: readonly string[],
  nextSessionId: string,
  targetSessionId: string,
): { replacedSessionId?: string; visibleCount: VisibleSessionCount; visibleSessionIds: string[] } {
  const nextVisibleSessionIds = [...currentVisibleSessionIds];
  const targetIndex = nextVisibleSessionIds.indexOf(targetSessionId);
  let replacedSessionId: string | undefined;
  if (targetIndex >= 0) {
    replacedSessionId = nextVisibleSessionIds[targetIndex];
    nextVisibleSessionIds[targetIndex] = nextSessionId;
  } else if (nextVisibleSessionIds.length > 0) {
    replacedSessionId = nextVisibleSessionIds[nextVisibleSessionIds.length - 1];
    nextVisibleSessionIds[nextVisibleSessionIds.length - 1] = nextSessionId;
  } else {
    nextVisibleSessionIds.push(nextSessionId);
  }
  return {
    replacedSessionId,
    visibleCount: currentVisibleCount,
    visibleSessionIds: dedupeVisibleSessionIds(nextVisibleSessionIds),
  };
}

function replaceNonFocusedVisibleSession(
  currentVisibleCount: VisibleSessionCount,
  sessions: readonly SessionRecord[],
  currentVisibleSessionIds: readonly string[],
  nextSessionId: string,
  preserveSessionId: string | undefined,
): { replacedSessionId?: string; visibleCount: VisibleSessionCount; visibleSessionIds: string[] } {
  const nextVisibleSessionIds = currentVisibleSessionIds.filter(
    (sessionId) => sessionId !== nextSessionId,
  );
  const visibleCapacity = Math.min(currentVisibleCount, MAX_SESSION_COUNT, sessions.length);
  if (nextVisibleSessionIds.length < visibleCapacity) {
    nextVisibleSessionIds.push(nextSessionId);
    return {
      visibleCount: currentVisibleCount,
      visibleSessionIds: nextVisibleSessionIds,
    };
  }

  const replacementIndex = pickReplacementVisibleSessionIndex(
    nextVisibleSessionIds,
    preserveSessionId,
  );
  const replacedSessionId =
    replacementIndex >= 0 ? nextVisibleSessionIds[replacementIndex] : undefined;
  if (replacementIndex >= 0) {
    nextVisibleSessionIds[replacementIndex] = nextSessionId;
  } else {
    nextVisibleSessionIds.push(nextSessionId);
  }
  return {
    replacedSessionId,
    visibleCount: currentVisibleCount,
    visibleSessionIds: dedupeVisibleSessionIds(nextVisibleSessionIds).slice(0, currentVisibleCount),
  };
}

function pickReplacementVisibleSessionIndex(
  visibleSessionIds: readonly string[],
  preserveSessionId: string | undefined,
): number {
  const nonPreservedIndex = visibleSessionIds.findIndex(
    (sessionId) => sessionId !== preserveSessionId,
  );
  if (nonPreservedIndex >= 0) {
    return nonPreservedIndex;
  }
  return visibleSessionIds.length > 0 ? visibleSessionIds.length - 1 : -1;
}

function trimVisibleSessionIds(
  visibleSessionIds: string[],
  protectedSessionIds: readonly (string | undefined)[],
): void {
  const protectedSessionIdSet = new Set(protectedSessionIds.filter(Boolean));
  while (visibleSessionIds.length > MAX_SESSION_COUNT) {
    const removableIndex = findLastIndex(visibleSessionIds, (sessionId) => {
      return !protectedSessionIdSet.has(sessionId);
    });
    visibleSessionIds.splice(removableIndex >= 0 ? removableIndex : visibleSessionIds.length - 1, 1);
  }
}

function dedupeVisibleSessionIds(visibleSessionIds: readonly string[]): string[] {
  const nextVisibleSessionIds: string[] = [];
  for (const sessionId of visibleSessionIds) {
    if (!nextVisibleSessionIds.includes(sessionId)) {
      nextVisibleSessionIds.push(sessionId);
    }
  }
  return nextVisibleSessionIds;
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) {
      return index;
    }
  }
  return -1;
}

function getNormalizedVisibleIds(
  sessions: readonly SessionRecord[],
  visibleCount: VisibleSessionCount,
  focusedSessionId: string | undefined,
  currentVisibleSessionIds: readonly string[],
): string[] {
  if (!focusedSessionId || sessions.length === 0) {
    return [];
  }

  if (visibleCount === 1) {
    return [focusedSessionId];
  }

  const sessionIdSet = new Set(sessions.map((session) => session.sessionId));
  const visibleSessionIds: string[] = [];
  for (const sessionId of currentVisibleSessionIds) {
    if (!sessionIdSet.has(sessionId) || visibleSessionIds.includes(sessionId)) {
      continue;
    }

    visibleSessionIds.push(sessionId);
  }

  if (!visibleSessionIds.includes(focusedSessionId)) {
    visibleSessionIds.push(focusedSessionId);
  }

  for (const session of sessions) {
    if (visibleSessionIds.length >= visibleCount) {
      break;
    }
    if (!visibleSessionIds.includes(session.sessionId)) {
      visibleSessionIds.push(session.sessionId);
    }
  }

  if (visibleSessionIds.length <= visibleCount) {
    return visibleSessionIds;
  }

  const passiveVisibleIds = visibleSessionIds.filter((sessionId) => sessionId !== focusedSessionId);
  return passiveVisibleIds.slice(0, Math.max(0, visibleCount - 1)).concat(focusedSessionId);
}

function getNextVisibleIdsForFocusedSession(
  sessions: readonly SessionRecord[],
  visibleCount: VisibleSessionCount,
  nextFocusedSessionId: string,
  currentVisibleSessionIds: readonly string[],
  currentFocusedSessionId: string | undefined,
): string[] {
  if (visibleCount === 1) {
    return [nextFocusedSessionId];
  }

  const stableVisibleSessionIds = getStableVisibleIds(
    sessions,
    visibleCount,
    currentVisibleSessionIds,
  );

  if (stableVisibleSessionIds.includes(nextFocusedSessionId)) {
    return stableVisibleSessionIds;
  }

  if (stableVisibleSessionIds.length < Math.min(visibleCount, sessions.length)) {
    return getStableVisibleIds(sessions, visibleCount, [
      ...stableVisibleSessionIds,
      nextFocusedSessionId,
    ]);
  }

  if (currentFocusedSessionId) {
    const focusedVisibleIndex = stableVisibleSessionIds.indexOf(currentFocusedSessionId);
    if (focusedVisibleIndex >= 0) {
      const nextVisibleSessionIds = [...stableVisibleSessionIds];
      nextVisibleSessionIds[focusedVisibleIndex] = nextFocusedSessionId;
      return getStableVisibleIds(sessions, visibleCount, nextVisibleSessionIds);
    }
  }

  if (stableVisibleSessionIds.length === 0) {
    return [nextFocusedSessionId];
  }

  return getStableVisibleIds(
    sessions,
    visibleCount,
    stableVisibleSessionIds.map((sessionId, index, visibleSessionIds) =>
      index === visibleSessionIds.length - 1 ? nextFocusedSessionId : sessionId,
    ),
  );
}

function getNextVisibleIdsForRestoredSleepingSession(
  sessions: readonly SessionRecord[],
  visibleCount: VisibleSessionCount,
  nextFocusedSessionId: string,
  currentVisibleSessionIds: readonly string[],
  currentFocusedSessionId: string | undefined,
): string[] {
  /**
   * CDXC:SessionSleep 2026-05-11-02:20
   * Startup normalization preserves sleeping sessions in paneLayout so an app
   * restart can recover the last surfaced split/tab shape. A normal sidebar
   * click is different: waking a sleeping card should put it in the pane the
   * user is looking at, not resurrect an old hidden placement.
   */
  return replaceVisibleSessionTarget(
    visibleCount,
    getStableVisibleIds(sessions, visibleCount, currentVisibleSessionIds),
    nextFocusedSessionId,
    currentFocusedSessionId ?? currentVisibleSessionIds[0] ?? nextFocusedSessionId,
  ).visibleSessionIds;
}

function getNextPaneLayoutForFocusedSession(
  currentLayout: SessionPaneLayoutNode | undefined,
  currentVisibleSessionIds: readonly string[],
  nextVisibleSessionIds: readonly string[],
  nextFocusedSessionId: string,
  currentFocusedSessionId: string | undefined,
): SessionPaneLayoutNode | undefined {
  if (currentVisibleSessionIds.includes(nextFocusedSessionId)) {
    return setActiveSessionInPaneLayout(currentLayout, nextFocusedSessionId);
  }
  /**
   * CDXC:PaneFocus 2026-05-11-16:45
   * Sidebar card clicks on hidden sessions should reuse the currently focused
   * pane slot. visibleSessionIds already replaces the focused session id; the
   * paneLayout must mirror that replacement so native sync does not append the
   * clicked session as a new split pane.
   */
  return replaceFocusedSessionInPaneLayout(
    currentLayout,
    currentVisibleSessionIds,
    nextVisibleSessionIds,
    nextFocusedSessionId,
    currentFocusedSessionId,
  );
}

function getNextPaneLayoutForRestoredSleepingSession(
  currentLayout: SessionPaneLayoutNode | undefined,
  currentVisibleSessionIds: readonly string[],
  nextVisibleSessionIds: readonly string[],
  nextFocusedSessionId: string,
  currentFocusedSessionId: string | undefined,
): SessionPaneLayoutNode | undefined {
  return replaceFocusedSessionInPaneLayout(
    currentLayout,
    currentVisibleSessionIds,
    nextVisibleSessionIds,
    nextFocusedSessionId,
    currentFocusedSessionId,
  );
}

function replaceFocusedSessionInPaneLayout(
  currentLayout: SessionPaneLayoutNode | undefined,
  currentVisibleSessionIds: readonly string[],
  nextVisibleSessionIds: readonly string[],
  nextFocusedSessionId: string,
  currentFocusedSessionId: string | undefined,
): SessionPaneLayoutNode | undefined {
  const targetSessionId =
    currentFocusedSessionId && currentVisibleSessionIds.includes(currentFocusedSessionId)
      ? currentFocusedSessionId
      : currentVisibleSessionIds[0];
  const seededLayout =
    normalizePaneLayout(
      currentLayout,
      currentVisibleSessionIds,
      currentVisibleSessionIds,
      currentFocusedSessionId,
    ) ?? createPaneLayoutFromVisibleIds(currentVisibleSessionIds);
  const layoutWithoutRestoredSession = seededLayout
    ? removeSessionFromPaneLayout(seededLayout, nextFocusedSessionId)
    : undefined;
  const replacedLayout =
    targetSessionId && layoutWithoutRestoredSession
      ? replaceSessionInPaneLayout(
          layoutWithoutRestoredSession,
          targetSessionId,
          nextFocusedSessionId,
        )
      : undefined;

  return normalizePaneLayout(
    replacedLayout ?? createPaneLayoutFromVisibleIds(nextVisibleSessionIds),
    nextVisibleSessionIds,
    nextVisibleSessionIds,
    nextFocusedSessionId,
  );
}

function getStableVisibleIds(
  sessions: readonly SessionRecord[],
  visibleCount: VisibleSessionCount,
  desiredVisibleSessionIds: readonly string[],
): string[] {
  const sessionIdSet = new Set(sessions.map((session) => session.sessionId));
  const visibleSessionIds: string[] = [];

  for (const sessionId of desiredVisibleSessionIds) {
    if (!sessionIdSet.has(sessionId) || visibleSessionIds.includes(sessionId)) {
      continue;
    }

    visibleSessionIds.push(sessionId);
    if (visibleSessionIds.length >= visibleCount) {
      return visibleSessionIds;
    }
  }

  for (const session of sessions) {
    if (visibleSessionIds.includes(session.sessionId)) {
      continue;
    }

    visibleSessionIds.push(session.sessionId);
    if (visibleSessionIds.length >= visibleCount) {
      break;
    }
  }

  return visibleSessionIds;
}

function getFallbackActiveGroupId(
  snapshot: GroupedSessionWorkspaceSnapshot,
  emptiedGroupId: string,
): string {
  const emptiedGroupIndex = snapshot.groups.findIndex((group) => group.groupId === emptiedGroupId);
  if (emptiedGroupIndex < 0) {
    return snapshot.activeGroupId;
  }

  const previousNonEmptyGroup = snapshot.groups
    .slice(0, emptiedGroupIndex)
    .reverse()
    .find((group) => getActiveSessionCount(group) > 0);
  if (previousNonEmptyGroup) {
    return previousNonEmptyGroup.groupId;
  }

  const nextNonEmptyGroup = snapshot.groups
    .slice(emptiedGroupIndex + 1)
    .find((group) => getActiveSessionCount(group) > 0);
  return nextNonEmptyGroup?.groupId ?? emptiedGroupId;
}

function getAwakeSessions(sessions: readonly SessionRecord[]): SessionRecord[] {
  return sessions.filter((session) => !session.isSleeping);
}

function getActiveSessionCount(group: SessionGroupRecord | undefined): number {
  if (!group) {
    return 0;
  }

  return getAwakeSessions(group.snapshot.sessions).length;
}

function resolveSessionReference(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
): { group: SessionGroupRecord; session: SessionRecord } | undefined {
  for (const group of snapshot.groups) {
    const exactSession = group.snapshot.sessions.find((session) => session.sessionId === sessionId);
    if (exactSession) {
      return { group, session: exactSession };
    }
  }

  /**
   * CDXC:SessionIdentity 2026-05-10-18:30
   * Drag payloads can contain a canonical display-derived session reference
   * after normalization even when a legacy record still carries its old opaque
   * sessionId. Resolve that reference through the normalized displayId so
   * group-drag actions operate on the canonical session instead of failing to
   * find the record.
   */
  const displayId = displayIdFromSessionReference(sessionId);
  if (!displayId) {
    return undefined;
  }
  for (const group of snapshot.groups) {
    const displaySession = group.snapshot.sessions.find((session) => session.displayId === displayId);
    if (displaySession) {
      return { group, session: displaySession };
    }
  }
}

function displayIdFromSessionReference(sessionId: string): string | undefined {
  const match = /^session-(\d+)$/.exec(sessionId);
  if (!match) {
    return undefined;
  }
  const displayNumber = Number.parseInt(match[1]!, 10) - 1;
  if (!Number.isFinite(displayNumber) || displayNumber < 0) {
    return undefined;
  }
  return formatSessionDisplayId(displayNumber);
}

function updateGroup(
  snapshot: GroupedSessionWorkspaceSnapshot,
  groupId: string,
  update: (group: SessionGroupRecord) => SessionGroupRecord,
): GroupedSessionWorkspaceSnapshot {
  return normalizeSimpleGroupedSessionWorkspaceSnapshot({
    ...snapshot,
    groups: snapshot.groups.map((group) => (group.groupId === groupId ? update(group) : group)),
  });
}

function updateSession(
  snapshot: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  update: (session: SessionRecord) => SessionRecord,
): WorkspaceMutationResult {
  const group = getGroupForSession(snapshot, sessionId);
  if (!group) {
    return { changed: false, snapshot };
  }

  const nextSnapshot = updateGroup(snapshot, group.groupId, (targetGroup) => ({
    ...targetGroup,
    snapshot: normalizeGroupSnapshot({
      ...targetGroup.snapshot,
      sessions: targetGroup.snapshot.sessions.map((session) =>
        session.sessionId === sessionId ? update(session) : session,
      ),
    }),
  }));

  return {
    changed: !areSnapshotsEqual(snapshot, nextSnapshot),
    snapshot: nextSnapshot,
  };
}

function createEmptyGroup(groupId: string, title: string): SessionGroupRecord {
  return {
    groupId,
    snapshot: createDefaultSessionGridSnapshot(),
    title,
  };
}

function clampSupportedVisibleCount(value: number | undefined): VisibleSessionCount {
  return clampVisibleSessionCount(value ?? 1);
}

function getNextGroupNumber(groups: readonly SessionGroupRecord[]): number {
  let nextGroupNumber = 2;
  for (const group of groups) {
    const match = /^group-(\d+)$/.exec(group.groupId);
    if (!match) {
      continue;
    }

    const parsedNumber = Number.parseInt(match[1]!, 10);
    if (Number.isInteger(parsedNumber)) {
      nextGroupNumber = Math.max(nextGroupNumber, parsedNumber + 1);
    }
  }
  return nextGroupNumber;
}

function getNextSessionNumber(groups: readonly SessionGroupRecord[]): number {
  let nextSessionNumber = 1;
  for (const session of groups.flatMap((group) => group.snapshot.sessions)) {
    nextSessionNumber = Math.max(
      nextSessionNumber,
      (getSessionNumberFromSessionId(session.sessionId) ?? 0) + 1,
    );
  }
  return nextSessionNumber;
}

function getWorkspaceSessionIds(snapshot: GroupedSessionWorkspaceSnapshot): string[] {
  return snapshot.groups.flatMap((group) =>
    group.snapshot.sessions.map((session) => session.sessionId),
  );
}

function areSnapshotsEqual(
  left: GroupedSessionWorkspaceSnapshot,
  right: GroupedSessionWorkspaceSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
