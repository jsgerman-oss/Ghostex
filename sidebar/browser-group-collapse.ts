type CollapsedGroupsById = Record<string, true>;
type SessionIdsByGroup = Record<string, readonly string[]>;
type AutoCollapseGroup = {
  projectContext?: unknown;
};

export function getAutoCollapseGroupIds({
  browserGroupIds,
  groupsById,
  workspaceGroupIds,
}: {
  browserGroupIds: readonly string[];
  groupsById: Readonly<Record<string, AutoCollapseGroup | undefined>>;
  workspaceGroupIds: readonly string[];
}): string[] {
  /**
   * CDXC:ProjectGroups 2026-05-06-18:42
   * Empty project groups must stay expandable because their body now contains
   * the project editor button. Continue auto-collapsing browser and non-project
   * combined groups, but never force project groups closed just because their
   * session list is empty.
   */
  return [
    ...browserGroupIds,
    ...workspaceGroupIds.filter((groupId) => !groupsById[groupId]?.projectContext),
  ];
}

export function getBrowserSessionCountsByGroup({
  browserGroupIds,
  sessionIdsByGroup,
}: {
  browserGroupIds: readonly string[];
  sessionIdsByGroup: SessionIdsByGroup;
}): Record<string, number> {
  return getSessionCountsByGroup({
    groupIds: browserGroupIds,
    sessionIdsByGroup,
  });
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
  browserGroupIds,
  collapseBlockedGroupIds = [],
  expandOnSessionCountIncreaseGroupIds,
  groupIds,
  previousSessionCountsByGroup,
  previousCollapsedGroupsById,
  sessionIdsByGroup,
  skipExpandOnSessionCountIncrease = false,
}: {
  autoCollapseGroupIds?: readonly string[];
  browserGroupIds: readonly string[];
  collapseBlockedGroupIds?: readonly string[];
  expandOnSessionCountIncreaseGroupIds?: readonly string[];
  groupIds: readonly string[];
  previousSessionCountsByGroup: Readonly<Record<string, number>>;
  previousCollapsedGroupsById: CollapsedGroupsById;
  sessionIdsByGroup: SessionIdsByGroup;
  /**
   * CDXC:SidebarGroups 2026-05-20-12:00
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
   * CDXC:SidebarGroups 2026-05-05-04:48
   * Empty Combined-mode project and Chats sections behave like browser groups:
   * they stay collapsed while empty, expand when a session/chat appears, and
   * collapse again when their last session disappears. Preserve manual
   * collapse for non-empty groups unless their session count increases.
   */
  for (const groupId of new Set(autoCollapseGroupIds ?? browserGroupIds)) {
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
   * CDXC:SidebarGroups 2026-05-08-11:09
   * Any action that creates a session inside a collapsed Chats/project group
   * must reveal the result. Keep this separate from empty-group auto-collapse
   * so project groups can avoid forced empty collapse but still expand when
   * their session count increases.
   */
  if (!skipExpandOnSessionCountIncrease) {
    for (const groupId of new Set(
      expandOnSessionCountIncreaseGroupIds ?? autoCollapseGroupIds ?? browserGroupIds,
    )) {
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

export function expandCollapsedGroupsById({
  groupIds,
  previousCollapsedGroupsById,
}: {
  groupIds: readonly string[];
  previousCollapsedGroupsById: CollapsedGroupsById;
}): CollapsedGroupsById {
  if (groupIds.length === 0) {
    return previousCollapsedGroupsById;
  }

  let changed = false;
  const next = { ...previousCollapsedGroupsById };

  for (const groupId of groupIds) {
    if (!next[groupId]) {
      continue;
    }

    delete next[groupId];
    changed = true;
  }

  return changed ? next : previousCollapsedGroupsById;
}
