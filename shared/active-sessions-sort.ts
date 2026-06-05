import type {
  SidebarActiveSessionsSortMode,
  SidebarSessionItem,
} from "./session-grid-contract-sidebar";

export type SessionIdsByGroup = Record<string, string[]>;

export type CreateDisplaySessionLayoutOptions = {
  sessionIdsByGroup: SessionIdsByGroup;
  sessionsById: Record<string, SidebarSessionItem>;
  sortMode: SidebarActiveSessionsSortMode;
  workspaceGroupIds: readonly string[];
};

export function createDisplaySessionLayout({
  sessionIdsByGroup,
  sessionsById,
  sortMode,
  workspaceGroupIds,
}: CreateDisplaySessionLayoutOptions): {
  groupIds: string[];
  sessionIdsByGroup: SessionIdsByGroup;
} {
  const manualSessionIdsByGroup = Object.fromEntries(
    workspaceGroupIds.map((groupId) => [
      groupId,
      [...(sessionIdsByGroup[groupId] ?? [])],
    ]),
  );
  if (sortMode === "manual") {
    /*
    CDXC:ManualSessionSorting 2026-06-05-12:30:
    Manual Sorting must render the saved order exactly. Do not force pinned or
    browser partitions here; users can move pinned and non-pinned rows freely,
    and the first manual snapshot should not shift after the mode changes.
    */
    return {
      groupIds: [...workspaceGroupIds],
      sessionIdsByGroup: manualSessionIdsByGroup,
    };
  }

  const sortedSessionIdsByGroup = Object.fromEntries(
    workspaceGroupIds.map((groupId) => [
      groupId,
      orderProjectSessionsForDisplay(
        sessionIdsByGroup[groupId] ?? [],
        sessionsById,
        { sortUnpinnedByLastActivity: true },
      ),
    ]),
  );

  return {
    groupIds: [...workspaceGroupIds],
    sessionIdsByGroup: sortedSessionIdsByGroup,
  };
}

export function getDisplaySessionIdsInOrder(options: CreateDisplaySessionLayoutOptions): string[] {
  const displayLayout = createDisplaySessionLayout(options);
  return displayLayout.groupIds.flatMap(
    (groupId) => displayLayout.sessionIdsByGroup[groupId] ?? [],
  );
}

function orderProjectSessionsForDisplay(
  sessionIds: readonly string[],
  sessionsById: Record<string, SidebarSessionItem>,
  options: { sortUnpinnedByLastActivity?: boolean } = {},
): string[] {
  /**
   * CDXC:PinnedSessions 2026-05-28-12:04:
   * Pinned sessions must stay at the top of their owning project regardless of
   * the active session sort mode. Preserve the existing order inside pinned and
   * unpinned partitions so users can rearrange pinned rows while non-pinned
   * activity/browser ordering remains predictable.
   */
  const pinnedSessionIds: string[] = [];
  const otherSessionIds: string[] = [];

  for (const sessionId of sessionIds) {
    if (sessionsById[sessionId]?.isPinned === true) {
      pinnedSessionIds.push(sessionId);
    } else {
      otherSessionIds.push(sessionId);
    }
  }

  const orderedOtherSessionIds = options.sortUnpinnedByLastActivity
    ? sortSessionIdsByLastActivity(otherSessionIds, sessionsById)
    : otherSessionIds;
  return [...pinnedSessionIds, ...orderBrowserSessionsFirst(orderedOtherSessionIds, sessionsById)];
}

function sortSessionIdsByLastActivity(
  sessionIds: readonly string[],
  sessionsById: Record<string, SidebarSessionItem>,
): string[] {
  return [...sessionIds].sort((leftSessionId, rightSessionId) => {
    const activityPriorityDelta =
      getSessionActivitySortPriority(sessionsById[rightSessionId]) -
      getSessionActivitySortPriority(sessionsById[leftSessionId]);
    if (activityPriorityDelta !== 0) {
      return activityPriorityDelta;
    }

    const activityDelta =
      getSessionLastActivityTime(sessionsById[rightSessionId]) -
      getSessionLastActivityTime(sessionsById[leftSessionId]);
    if (activityDelta !== 0) {
      return activityDelta;
    }

    return sessionIds.indexOf(leftSessionId) - sessionIds.indexOf(rightSessionId);
  });
}

function orderBrowserSessionsFirst(
  sessionIds: readonly string[],
  sessionsById: Record<string, SidebarSessionItem>,
): string[] {
  /**
   * CDXC:ProjectBrowserTabs 2026-05-16-12:49:
   * Browser pane sessions that belong to a project should render at the top of
   * that project's sidebar session list, directly under the project header,
   * while preserving the existing order within browser and non-browser
   * sessions. Apply this in the shared display layout so search, drag, focus,
   * and flattening code all use the same visible order.
   */
  const browserSessionIds: string[] = [];
  const otherSessionIds: string[] = [];

  for (const sessionId of sessionIds) {
    if (isBrowserSession(sessionsById[sessionId])) {
      browserSessionIds.push(sessionId);
    } else {
      otherSessionIds.push(sessionId);
    }
  }

  return [...browserSessionIds, ...otherSessionIds];
}

function isBrowserSession(session: SidebarSessionItem | undefined): boolean {
  return session?.kind === "browser" || session?.sessionKind === "browser";
}

function getSessionActivitySortPriority(session: SidebarSessionItem | undefined): number {
  switch (session?.activity) {
    case "attention":
      return 2;
    case "working":
      return 1;
    default:
      return 0;
  }
}

function getSessionLastActivityTime(session: SidebarSessionItem | undefined): number {
  if (!session?.lastInteractionAt) {
    return 0;
  }

  const timestamp = Date.parse(session.lastInteractionAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
