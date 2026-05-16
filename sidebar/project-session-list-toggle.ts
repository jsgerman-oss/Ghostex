export const PROJECT_SESSION_LIST_COLLAPSED_COUNT = 6;

export type ProjectSessionListCollapsedState = Record<string, true>;

export function normalizeStoredProjectSessionListCollapsedState(
  candidate: unknown,
): ProjectSessionListCollapsedState {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }

  const collapsedState: ProjectSessionListCollapsedState = {};
  for (const [projectId, isCollapsed] of Object.entries(candidate)) {
    if (projectId.trim().length > 0 && isCollapsed === true) {
      collapsedState[projectId] = true;
    }
  }
  return collapsedState;
}

export function getVisibleProjectSessionIds({
  isCollapsed,
  isProjectGroup,
  isToggleEnabled,
  sessionIds,
}: {
  isCollapsed: boolean;
  isProjectGroup: boolean;
  isToggleEnabled: boolean;
  sessionIds: readonly string[];
}): readonly string[] {
  /**
   * CDXC:ProjectSessionLists 2026-05-16-21:50:
   * Project groups with more than six sessions need a per-project Show less /
   * Show more toggle. Default to all sessions, and only trim rendering after
   * the user explicitly collapses that project list.
   */
  if (
    !isProjectGroup ||
    !isToggleEnabled ||
    !isCollapsed ||
    sessionIds.length <= PROJECT_SESSION_LIST_COLLAPSED_COUNT
  ) {
    return sessionIds;
  }

  return sessionIds.slice(0, PROJECT_SESSION_LIST_COLLAPSED_COUNT);
}
