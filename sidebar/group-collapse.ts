type CollapsedGroupsById = Record<string, true>;
type SessionIdsByGroup = Record<string, readonly string[]>;
type AutoCollapseGroup = {
  projectContext?: unknown;
};

export function getAutoCollapseGroupIds({
  groupsById,
  workspaceGroupIds,
}: {
  groupsById: Readonly<Record<string, AutoCollapseGroup | undefined>>;
  workspaceGroupIds: readonly string[];
}): string[] {
  /**
   * CDXC:ProjectGroups 2026-05-21-11:07:
   * The current reference sidebar no longer renders a global Browsers section.
   * Only non-project workspace sections should use automatic empty-collapse;
   * project groups stay expandable so they can receive sessions without hidden
   * browser-group rules affecting the visible Projects list.
   */
  return workspaceGroupIds.filter((groupId) => !groupsById[groupId]?.projectContext);
}

export function getSessionCountsByGroup({
  groupIds,
  sessionIdsByGroup,
}: {
  groupIds: readonly string[];
  sessionIdsByGroup: SessionIdsByGroup;
}): Record<string, number> {
  return Object.fromEntries(
    groupIds.map((groupId) => [groupId, (sessionIdsByGroup[groupId] ?? []).length]),
  );
}

export function reconcileCollapsedGroupsById({
  autoCollapseGroupIds,
  collapseBlockedGroupIds = [],
  expandOnSessionCountIncreaseGroupIds,
  groupIds,
  previousSessionCountsByGroup,
  previousCollapsedGroupsById,
  sessionIdsByGroup,
  skipExpandOnSessionCountIncrease = false,
}: {
  autoCollapseGroupIds?: readonly string[];
  collapseBlockedGroupIds?: readonly string[];
  expandOnSessionCountIncreaseGroupIds?: readonly string[];
  groupIds: readonly string[];
  previousSessionCountsByGroup: Readonly<Record<string, number>>;
  previousCollapsedGroupsById: CollapsedGroupsById;
  sessionIdsByGroup: SessionIdsByGroup;
  /**
   * CDXC:SidebarGroups 2026-05-20-12:00:
   * After restart, hydrated session counts must not be treated as newly created
   * sessions. Skip expand-on-count-increase while seeding the first post-hydrate
   * baseline so persisted project collapse state survives app relaunch.
   */
  skipExpandOnSessionCountIncrease?: boolean;
}): CollapsedGroupsById {
  const blockedGroupIds = new Set(collapseBlockedGroupIds);
  const validGroupIds = new Set(groupIds);
  let changed = false;
  const next: CollapsedGroupsById = {};

  for (const [groupId, collapsed] of Object.entries(previousCollapsedGroupsById)) {
    if (!validGroupIds.has(groupId)) {
      changed = true;
      continue;
    }

    next[groupId] = collapsed;
  }

  /**
   * CDXC:SidebarGroups 2026-05-21-11:07:
   * Empty non-project sidebar sections collapse while empty and expand when a
   * session appears. Browser sessions now live inside project groups, so this
   * logic must stay generic and never reference a global browser group.
   */
  for (const groupId of new Set(autoCollapseGroupIds ?? [])) {
    const nextCount = (sessionIdsByGroup[groupId] ?? []).length;

    if (nextCount === 0) {
      if (blockedGroupIds.has(groupId)) {
        continue;
      }

      if (!next[groupId]) {
        next[groupId] = true;
        changed = true;
      }
      continue;
    }
  }

  /**
   * CDXC:SidebarGroups 2026-05-08-11:09:
   * Any action that creates a session inside a collapsed Chats/project group
   * must reveal the result. Keep this separate from empty-group auto-collapse
   * so project groups can avoid forced empty collapse but still expand when
   * their session count increases.
   */
  if (!skipExpandOnSessionCountIncrease) {
    for (const groupId of new Set(expandOnSessionCountIncreaseGroupIds ?? autoCollapseGroupIds)) {
      const previousCount = previousSessionCountsByGroup[groupId];
      const nextCount = (sessionIdsByGroup[groupId] ?? []).length;
      if (previousCount !== undefined && nextCount > previousCount && next[groupId]) {
        delete next[groupId];
        changed = true;
      }
    }
  }

  return changed ? next : previousCollapsedGroupsById;
}

export function shouldPersistSidebarUiCollapseState({
  groupCount,
  hasAppliedHydrate,
  hasEstablishedStartupGroupCollapseBaseline,
}: {
  groupCount: number;
  hasAppliedHydrate: boolean;
  hasEstablishedStartupGroupCollapseBaseline: boolean;
}): boolean {
  /*
  CDXC:SidebarReference 2026-06-02-22:39:
  Sidebar disclosure persistence must wait until native has delivered a real hydrate and the startup group-count baseline is established. The first React mount can render with no sidebar groups and default-expanded sections; writing during that window erases the user's collapsed Quick, Projects, and project-row state before restart restore can apply it.
  */
  return hasAppliedHydrate && hasEstablishedStartupGroupCollapseBaseline && groupCount > 0;
}
