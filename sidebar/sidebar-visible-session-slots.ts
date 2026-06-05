import {
  getVisibleProjectSessionIds,
  type ProjectSessionListCollapsedState,
} from "./project-session-list-toggle";

export type SidebarVisibleSlotGroup = {
  isChatCollection?: boolean;
  projectContext?: { editor?: { projectId?: string } };
  remoteMachineContext?: { machineId?: string };
};

export type SidebarVisibleSessionSlotOptions = {
  collapsedGroupsById: Record<string, true>;
  displayedWorkspaceGroupIds: readonly string[];
  displayedWorkspaceSessionIdsByGroup: Record<string, readonly string[]>;
  enableProjectSessionListToggle: boolean;
  groupsById: Record<string, SidebarVisibleSlotGroup | undefined>;
  isReferenceChatsCollapsed: boolean;
  isReferenceProjectsCollapsed: boolean;
  projectSessionListCollapsedState: ProjectSessionListCollapsedState;
  remoteMachineIds: readonly string[];
};

export function createVisibleSidebarSessionSlotIds({
  collapsedGroupsById,
  displayedWorkspaceGroupIds,
  displayedWorkspaceSessionIdsByGroup,
  enableProjectSessionListToggle,
  groupsById,
  isReferenceChatsCollapsed,
  isReferenceProjectsCollapsed,
  projectSessionListCollapsedState,
  remoteMachineIds,
}: SidebarVisibleSessionSlotOptions): string[] {
  const visibleSessionIds: string[] = [];

  const appendGroup = (groupId: string, forceExpanded = false) => {
    const group = groupsById[groupId];
    if (!group || (!forceExpanded && collapsedGroupsById[groupId] === true)) {
      return;
    }

    const sessionIds = displayedWorkspaceSessionIdsByGroup[groupId] ?? [];
    const projectSessionListStorageId = group.projectContext?.editor?.projectId ?? groupId;
    visibleSessionIds.push(
      ...getVisibleProjectSessionIds({
        isCollapsed: projectSessionListCollapsedState[projectSessionListStorageId] === true,
        isProjectGroup: Boolean(group.projectContext),
        isToggleEnabled: enableProjectSessionListToggle,
        sessionIds,
      }),
    );
  };

  if (!isReferenceChatsCollapsed) {
    for (const groupId of displayedWorkspaceGroupIds) {
      if (groupsById[groupId]?.isChatCollection === true) {
        appendGroup(groupId, true);
      }
    }
  }

  if (!isReferenceProjectsCollapsed) {
    for (const groupId of displayedWorkspaceGroupIds) {
      const group = groupsById[groupId];
      if (
        group &&
        group.isChatCollection !== true &&
        !group.remoteMachineContext
      ) {
        appendGroup(groupId);
      }
    }
  }

  for (const machineId of remoteMachineIds) {
    for (const groupId of displayedWorkspaceGroupIds) {
      if (groupsById[groupId]?.remoteMachineContext?.machineId === machineId) {
        appendGroup(groupId);
      }
    }
  }

  return visibleSessionIds;
}

export function resolveVisibleSidebarSessionSlotId({
  focusedSessionId,
  slotNumber,
  visibleSessionIds,
}: {
  focusedSessionId?: string;
  slotNumber: number;
  visibleSessionIds: readonly string[];
}): string | undefined {
  if (visibleSessionIds.length === 0) {
    return undefined;
  }

  if (slotNumber > 0) {
    return visibleSessionIds[slotNumber - 1];
  }

  const focusedIndex = focusedSessionId ? visibleSessionIds.indexOf(focusedSessionId) : -1;
  if (slotNumber === 0) {
    const currentIndex = focusedIndex >= 0 ? focusedIndex : -1;
    return visibleSessionIds[(currentIndex + 1) % visibleSessionIds.length];
  }

  const currentIndex = focusedIndex >= 0 ? focusedIndex : 0;
  return visibleSessionIds[
    (currentIndex - 1 + visibleSessionIds.length) % visibleSessionIds.length
  ];
}

export type RenderedSidebarSessionSlotElement = {
  closest(selectors: string): Element | null;
  getAttribute(name: string): string | null;
  getClientRects?: () => { length: number };
};

export function createRenderedSidebarSessionSlotIds(
  elements: readonly RenderedSidebarSessionSlotElement[],
): string[] {
  const visibleSessionIds: string[] = [];

  for (const element of elements) {
    const sessionId = element.getAttribute("data-sidebar-session-id");
    if (!sessionId) {
      continue;
    }

    if (element.closest('[aria-hidden="true"], [data-collapsed="true"]')) {
      continue;
    }

    if (element.getClientRects && element.getClientRects().length === 0) {
      continue;
    }

    visibleSessionIds.push(sessionId);
  }

  return visibleSessionIds;
}

export function readRenderedSidebarSessionSlotIds(root: ParentNode = document): string[] {
  /**
   * CDXC:Hotkeys 2026-06-05-21:17:
   * A user repro showed state-derived Cmd+number slots could include a hidden row, making Cmd+5 select the sixth visible session and Cmd+6 jump much lower in the sidebar. Read the rendered session-card rows at key time so slot numbers match the pixels shown in the sidebar and collapsed projects do not reserve indices.
   */
  return createRenderedSidebarSessionSlotIds(
    Array.from(
      root.querySelectorAll<HTMLElement>("[data-sidebar-session-id]"),
    ),
  );
}
