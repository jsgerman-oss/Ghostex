export const PROJECT_SESSION_LIST_COLLAPSED_COUNT = 6;
export const PROJECT_SESSION_LIST_COLLAPSED_STORAGE_KEY =
  "ghostex-sidebar-project-session-list-collapsed";
export const PROJECT_SESSION_LIST_COLLAPSED_CHANGED_EVENT =
  "ghostex-sidebar-project-session-list-collapsed-changed";

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
   *
   * CDXC:ProjectSessionLists 2026-05-26-22:27:
   * Show less must be literal: render only the first six sessions in project
   * order. Live zmx-backed rows still remain in sidebar inventory and Show more,
   * but they must not expand the collapsed card list past the user-requested cap.
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

export function readProjectSessionListCollapsedState(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): ProjectSessionListCollapsedState {
  if (!storage) {
    return {};
  }

  try {
    return normalizeStoredProjectSessionListCollapsedState(
      JSON.parse(storage.getItem(PROJECT_SESSION_LIST_COLLAPSED_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return {};
  }
}

export function writeProjectSessionListCollapsedState(
  state: ProjectSessionListCollapsedState,
): void {
  /**
   * CDXC:ProjectSessionLists 2026-05-16-21:50:
   * Show less / Show more is per-project navigation state, not session data.
   * Persist only the collapsed project ids so new projects and projects the
   * user has never collapsed continue to start with all sessions shown.
   *
   * CDXC:WorktreeProjectOrder 2026-06-02-15:27:
   * gxserver owns worktree creation, but the macOS sidebar owns the local Show less state for the source project after submit. Broadcast same-document updates because localStorage storage events do not fire in the writing webview.
   *
   * CDXC:ProjectSessionLists 2026-06-05-20:53:
   * Cmd+number session slots and project row rendering must share the same Show less / Show more state so shortcuts target the sessions currently visible in the sidebar, not hidden rows from a collapsed project list.
   */
  localStorage.setItem(PROJECT_SESSION_LIST_COLLAPSED_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(PROJECT_SESSION_LIST_COLLAPSED_CHANGED_EVENT));
}
