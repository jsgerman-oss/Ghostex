import {
  IconCaretRightFilled,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconCopy,
  IconFolder,
  IconFolderOpen,
  IconGitBranch,
  IconGitMerge,
  IconGitPullRequest,
  IconMessageCircle,
  IconMoon,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTerminal2,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { CollisionPriority } from "@dnd-kit/abstract";
import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { createPortal } from "react-dom";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AppTooltip } from "./app-tooltip";
import { AGENT_LOGO_COLORS, AGENT_LOGOS } from "./agent-logos";
import {
  getSidebarSessionLifecycleState,
  type SidebarTheme,
} from "../shared/session-grid-contract";
import type { SidebarProjectDiffStats } from "../shared/project-diff-stats";
import type { SidebarAgentButton } from "../shared/sidebar-agents";
import { DEFAULT_ghostex_SETTINGS } from "../shared/ghostex-settings";
import { ConfirmationModal } from "./confirmation-modal";
import {
  createGroupDropData,
  createSessionDropTargetData,
  createSessionDropTargetId,
  type SidebarGroupDropTarget,
} from "./sidebar-dnd";
import { getGroupSessionSummary, type GroupSessionSummary } from "./group-session-summary";
import { shouldShowSessionGroupConnector } from "./session-group-connector";
import { getGroupStatusAnchorName, getSessionStatusAnchorName } from "./session-status-anchor";
import { useSidebarStore } from "./sidebar-store";
import { SortableSessionCard } from "./sortable-session-card";
import { SidebarContextMenuPortal } from "./sidebar-context-menu-portal";
import { useCollapsibleHeight } from "./use-collapsible-height";
import type { WebviewApi } from "./webview-api";
import { openAppModal } from "./app-modal-host-bridge";
import {
  PROJECT_SESSION_LIST_COLLAPSED_COUNT,
  getVisibleProjectSessionIds,
  normalizeStoredProjectSessionListCollapsedState,
  type ProjectSessionListCollapsedState,
} from "./project-session-list-toggle";
import {
  DEFAULT_WORKSPACE_THEME_COLOR,
  normalizeWorkspaceThemeColor,
  readWorkspaceThemeColorHistory,
  updateWorkspaceThemeColorHistory,
  writeWorkspaceThemeColorHistory,
} from "../shared/workspace-dock-icons";

const CONTEXT_MENU_MARGIN_PX = 12;
const CONTEXT_MENU_WIDTH_PX = 196;
const CONTEXT_MENU_ITEM_HEIGHT_PX = 34;
const CONTEXT_MENU_VERTICAL_PADDING_PX = 12;
const GROUP_CONTROL_MENU_MARGIN_PX = 12;
const GROUP_AGENT_MENU_WIDTH_PX = 220;
const PROJECT_AGENT_LAUNCHER_STORAGE_KEY = "ghostex-sidebar-project-terminal-launcher";
const PROJECT_SESSION_LIST_COLLAPSED_STORAGE_KEY =
  "ghostex-sidebar-project-session-list-collapsed";
const GROUP_DRAG_HOLD_DELAY_MS = 130;
const GROUP_DRAG_HOLD_TOLERANCE_PX = 12;
const TOUCH_GROUP_DRAG_HOLD_DELAY_MS = 180;
const TOUCH_GROUP_DRAG_HOLD_TOLERANCE_PX = 12;
const PROJECT_EDITOR_DISPLAY_MAX_FILES = 99;
const NESTED_CONTEXT_MENU_INTERACTIVE_SELECTOR =
  "button, input, textarea, select, a[href], [role='button'], [role='menuitem'], [contenteditable='true'], .group-header-actions";

function isNestedInteractiveContextMenuTarget(event: ReactMouseEvent<HTMLElement>): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  const interactiveTarget = target.closest(NESTED_CONTEXT_MENU_INTERACTIVE_SELECTOR);
  return (
    interactiveTarget instanceof HTMLElement &&
    interactiveTarget !== event.currentTarget &&
    event.currentTarget.contains(interactiveTarget)
  );
}
const PROJECT_EDITOR_DISPLAY_MAX_LINES = 999;
const PROJECT_CONTEXT_THEME_OPTIONS: ReadonlyArray<{ label: string; value: SidebarTheme }> = [
  { label: "Dark Gray", value: "plain-dark" },
  { label: "Dark Green", value: "dark-green" },
  { label: "Dark Blue", value: "dark-blue" },
  { label: "Dark Red", value: "dark-red" },
  { label: "Dark Pink", value: "dark-pink" },
  { label: "Dark Orange", value: "dark-orange" },
  { label: "Light Blue", value: "light-blue" },
  { label: "Light Green", value: "light-green" },
  { label: "Light Pink", value: "light-pink" },
  { label: "Light Orange", value: "light-orange" },
];

function getAnchoredSessionStatusStyle(sessionId: string): CSSProperties {
  return {
    left: "anchor(right)",
    positionAnchor: getSessionStatusAnchorName(sessionId),
    top: "anchor(center)",
  } as CSSProperties;
}

function getCollapsedGroupStatusStyle(groupId: string): CSSProperties {
  return {
    left: "anchor(right)",
    positionAnchor: getGroupStatusAnchorName(groupId),
    top: "anchor(center)",
  } as CSSProperties;
}

/**
 * CDXC:WorkspaceTheme 2026-05-05-02:58
 * Combined-mode project headers consume the persisted workspace theme color
 * through one CSS variable so folder icons, titles, and hover surfaces can
 * share the same tint without changing chat or browser group styling.
 */
function getProjectThemeStyle(themeColor: string | undefined): CSSProperties | undefined {
  if (!themeColor) {
    return undefined;
  }

  return {
    "--workspace-project-theme-color": themeColor,
  } as CSSProperties;
}

function getProjectThemeSwatchStyle(themeColor: string | undefined): CSSProperties | undefined {
  if (!themeColor) {
    return undefined;
  }

  return {
    "--workspace-dock-button-background": themeColor,
  } as CSSProperties;
}

const groupSensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      if (event.pointerType === "touch") {
        return [
          new PointerActivationConstraints.Delay({
            tolerance: TOUCH_GROUP_DRAG_HOLD_TOLERANCE_PX,
            value: TOUCH_GROUP_DRAG_HOLD_DELAY_MS,
          }),
        ];
      }

      return [
        new PointerActivationConstraints.Delay({
          tolerance: GROUP_DRAG_HOLD_TOLERANCE_PX,
          value: GROUP_DRAG_HOLD_DELAY_MS,
        }),
      ];
    },
  }),
  KeyboardSensor,
];

type ContextMenuPosition = {
  x: number;
  y: number;
};

type GroupContextMenuPosition = ContextMenuPosition & {
  view: "group" | "project-custom-theme" | "project-themes";
};

type GroupControlMenu = "project-agent";

export function shouldTreatProjectAsEmptySessionGroup({
  hasProjectContext,
  sessionCount,
}: {
  hasProjectContext: boolean;
  sessionCount: number;
}): boolean {
  /**
   * CDXC:ProjectHeaders 2026-05-18-14:53:
   * Empty project groups should not show a "No sessions" placeholder. When a
   * user expands a collapsed empty project, create a session there so the
   * expanded project immediately has active content.
   */
  return hasProjectContext && sessionCount === 0;
}

export function shouldShowOpenProjectFolderIcon({
  isCollapsed,
  sessionCount,
}: {
  isCollapsed: boolean;
  sessionCount: number;
}): boolean {
  /**
   * CDXC:ProjectHeaders 2026-05-17-01:43:
   * A project row with zero sessions should look like a closed folder even
   * when its group body is technically expanded. Reserve the open folder icon
   * for expanded projects that actually have session rows under them.
   */
  return !isCollapsed && sessionCount > 0;
}

export function formatProjectEditorDiffStatsLabel(
  stats: SidebarProjectDiffStats,
  showFileCount = false,
): string {
  /**
   * CDXC:ProjectDiffStats 2026-05-15-13:58:
   * Project git additions/deletions belong beside the project name, not inside
   * the former sidebar Code launcher. Keep the compact stat formatter shared
   * so the header label and tests preserve the existing capped numeric
   * behavior.
   */
  return [
    showFileCount ? formatProjectEditorFilesCount(stats.files) : undefined,
    `+${formatProjectEditorLineCount(stats.additions)}`,
    `-${formatProjectEditorLineCount(stats.deletions)}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

export function shouldShowProjectEditorDiffStats(stats: SidebarProjectDiffStats): boolean {
  /**
   * CDXC:ProjectDiffStats 2026-05-15-19:36:
   * Project headers should stay quiet when git reports no added or removed
   * lines. Hide the adjacent status text for +0 -0, but keep showing it as
   * soon as either additions or deletions is nonzero.
   */
  return stats.additions > 0 || stats.deletions > 0;
}

function formatProjectEditorFilesCount(files: number): string {
  return String(Math.min(PROJECT_EDITOR_DISPLAY_MAX_FILES, Math.max(0, files)));
}

function formatProjectEditorLineCount(lines: number): string {
  return String(Math.min(PROJECT_EDITOR_DISPLAY_MAX_LINES, Math.max(0, lines)));
}

function ProjectHeaderDiffStats({
  showFileCount,
  stats,
}: {
  showFileCount: boolean;
  stats: SidebarProjectDiffStats;
}) {
  return (
    <div
      aria-label={`Git changes: ${formatProjectEditorDiffStatsLabel(stats, showFileCount)}`}
      className="group-project-diff-stats"
    >
      {showFileCount ? (
        <span className="group-project-diff-files">
          {formatProjectEditorFilesCount(stats.files)}
        </span>
      ) : null}
      <span className="group-project-diff-stat group-project-diff-stat-additions">
        +{formatProjectEditorLineCount(stats.additions)}
      </span>
      <span className="group-project-diff-stat group-project-diff-stat-deletions">
        -{formatProjectEditorLineCount(stats.deletions)}
      </span>
    </div>
  );
}

export type SessionGroupSectionProps = {
  autoEdit: boolean;
  canClose: boolean;
  completionFlashNonceBySessionId?: Record<string, number>;
  draggingDisabled?: boolean;
  groupDropIndicator?: SidebarGroupDropTarget;
  groupId: string;
  index: number;
  isGroupDragPreviewSource?: boolean;
  isCollapsed: boolean;
  onAutoEditHandled: () => void;
  onCollapsedChange: (groupId: string, collapsed: boolean) => void;
  onCreateSessionRequested?: (groupId: string) => void;
  onFocusRequested?: (groupId: string, sessionId: string) => void;
  orderedSessionIds?: readonly string[];
  selectedSearchSessionId?: string;
  enableProjectSessionListToggle?: boolean;
  sessionDropIndicatorGroupId?: string;
  sessionDraggingDisabled?: boolean;
  showHeaderActions?: boolean;
  showSessionDropPositionIndicators?: boolean;
  vscode: WebviewApi;
};

function clampContextMenuPosition(
  clientX: number,
  clientY: number,
  itemCount: number,
): GroupContextMenuPosition {
  const menuHeight = CONTEXT_MENU_VERTICAL_PADDING_PX + itemCount * CONTEXT_MENU_ITEM_HEIGHT_PX;
  return {
    view: "group",
    x: Math.max(
      CONTEXT_MENU_MARGIN_PX,
      Math.min(clientX, window.innerWidth - CONTEXT_MENU_WIDTH_PX - CONTEXT_MENU_MARGIN_PX),
    ),
    y: Math.max(
      CONTEXT_MENU_MARGIN_PX,
      Math.min(clientY, window.innerHeight - menuHeight - CONTEXT_MENU_MARGIN_PX),
    ),
  };
}

function getControlMenuPosition(button: HTMLButtonElement | null): ContextMenuPosition | undefined {
  if (!button) {
    return undefined;
  }

  const bounds = button.getBoundingClientRect();
  return {
    x: Math.max(
      GROUP_CONTROL_MENU_MARGIN_PX,
      Math.min(bounds.left + bounds.width / 2, window.innerWidth - GROUP_CONTROL_MENU_MARGIN_PX),
    ),
    y: Math.max(
      GROUP_CONTROL_MENU_MARGIN_PX,
      Math.min(bounds.bottom + 6, window.innerHeight - GROUP_CONTROL_MENU_MARGIN_PX),
    ),
  };
}

export function SessionGroupSection({
  autoEdit,
  canClose,
  completionFlashNonceBySessionId,
  draggingDisabled = false,
  groupDropIndicator,
  groupId,
  index,
  isGroupDragPreviewSource = false,
  isCollapsed,
  onAutoEditHandled,
  onCollapsedChange,
  onCreateSessionRequested,
  onFocusRequested,
  orderedSessionIds: orderedSessionIdsProp,
  selectedSearchSessionId,
  enableProjectSessionListToggle = true,
  sessionDropIndicatorGroupId,
  sessionDraggingDisabled = false,
  showHeaderActions = true,
  showSessionDropPositionIndicators = true,
  vscode,
}: SessionGroupSectionProps) {
  const group = useSidebarStore((state) => state.groupsById[groupId]);
  const storedSessionIds = useSidebarStore((state) => state.sessionIdsByGroup[groupId] ?? []);
  const sessionsById = useSidebarStore((state) => state.sessionsById);
  const orderedSessionIds = orderedSessionIdsProp ?? storedSessionIds;
  const [contextMenuPosition, setContextMenuPosition] = useState<GroupContextMenuPosition>();
  const [customThemeColor, setCustomThemeColor] = useState(DEFAULT_WORKSPACE_THEME_COLOR);
  const [recentThemeColors, setRecentThemeColors] = useState(readWorkspaceThemeColorHistory);
  const [draftTitle, setDraftTitle] = useState(group?.title ?? "");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [openControlMenu, setOpenControlMenu] = useState<GroupControlMenu>();
  const [primaryProjectAgentLauncherId, setPrimaryProjectAgentLauncherId] = useState(
    readPrimaryProjectAgentLauncherId,
  );
  const [projectSessionListCollapsedState, setProjectSessionListCollapsedState] = useState(
    readProjectSessionListCollapsedState,
  );
  const { collapsibleStyle, contentRef } = useCollapsibleHeight<HTMLDivElement>();
  const menuRef = useRef<HTMLDivElement>(null);
  const controlMenuRef = useRef<HTMLDivElement>(null);
  const projectAgentButtonRef = useRef<HTMLButtonElement>(null);
  const debugInstanceIdRef = useRef(createSessionGroupDebugInstanceId());
  /**
   * CDXC:Projects 2026-05-04-14:49
   * Project group headers use folder metaphors: closed folder when collapsed
   * and open folder when expanded. The synthetic Chats group keeps the chat
   * glyph so users can distinguish projectless conversations from projects.
   *
   * CDXC:Chats 2026-05-04-09:41
   * The Combined-mode Chats header is a synthetic collection, not one mutable
   * project group. It can create new chat folders, but it must not accept
   * session drops, group dragging, or project/group context-menu mutations.
   */
  const isChatCollection = group?.isChatCollection === true;
  const projectContext = group?.projectContext;
  const projectSessionListStorageId = projectContext?.editor.projectId ?? group?.groupId;
  /**
   * CDXC:SidebarLayout 2026-05-13-08:11
   * Project groups stay draggable while session drag targets are disabled in
   * the reference sidebar. That prevents session moves across project
   * boundaries without taking away project-group reordering.
   */
  const areSessionDropTargetsDisabled = draggingDisabled || sessionDraggingDisabled;
  const debuggingMode = useSidebarStore((state) => state.hud.debuggingMode);
  const agents = useSidebarStore((state) => state.hud.agents);
  const hideProjectHeaderDiffStats = useSidebarStore(
    (state) =>
      state.hud.settings?.hideProjectHeaderDiffStats ??
      DEFAULT_ghostex_SETTINGS.hideProjectHeaderDiffStats,
  );
  const showProjectEditorDiffFileCount = useSidebarStore(
    (state) =>
      state.hud.settings?.showProjectEditorDiffFileCount ??
      DEFAULT_ghostex_SETTINGS.showProjectEditorDiffFileCount,
  );
  const postGroupDebugLog = useEffectEvent((event: string, details: Record<string, unknown>) => {
    if (!debuggingMode) {
      return;
    }

    vscode.postMessage({
      details: {
        debugInstanceId: debugInstanceIdRef.current,
        groupId,
        ...details,
      },
      event,
      type: "sidebarDebugLog",
    });
  });
  const sortable = useSortable({
    accept: ["group", "session"],
    collisionPriority: CollisionPriority.Low,
    data: createGroupDropData(groupId),
    disabled: isChatCollection || draggingDisabled,
    /**
     * CDXC:ProjectDragPreview 2026-05-21-11:45:
     * Project reordering uses an app-rendered cursor ghost instead of dnd-kit's
     * source-sized feedback. Expanded projects can contain many session rows,
     * so the default feedback makes the preview appear far from the cursor and
     * includes content that should stay out of the drag ghost.
     */
    feedback: projectContext ? "none" : "default",
    id: groupId,
    index,
    plugins: [SortableKeyboardPlugin],
    sensors: groupSensors,
    type: "group",
  });
  const emptyGroupDropTarget = useDroppable({
    accept: "session",
    data: createSessionDropTargetData({
      groupId,
      kind: "group",
      position: "start",
    }),
    disabled: isChatCollection || areSessionDropTargetsDisabled,
    id: createSessionDropTargetId({
      groupId,
      kind: "group",
      position: "start",
    }),
  });

  if (!group) {
    return null;
  }

  const groupSessions = orderedSessionIds
    .map((sessionId) => sessionsById[sessionId])
    .filter((session): session is NonNullable<typeof session> => session !== undefined);
  const isProjectSessionListCollapsed =
    Boolean(projectContext) &&
    projectSessionListStorageId !== undefined &&
    projectSessionListCollapsedState[projectSessionListStorageId] === true;
  const visibleSessionIds = getVisibleProjectSessionIds({
    isCollapsed: isProjectSessionListCollapsed,
    isProjectGroup: Boolean(projectContext),
    isToggleEnabled: enableProjectSessionListToggle,
    sessionIds: orderedSessionIds,
  });
  const visibleGroupSessions = visibleSessionIds
    .map((sessionId) => sessionsById[sessionId])
    .filter((session): session is NonNullable<typeof session> => session !== undefined);
  const shouldShowProjectSessionListToggle =
    Boolean(projectContext) &&
    enableProjectSessionListToggle &&
    orderedSessionIds.length > PROJECT_SESSION_LIST_COLLAPSED_COUNT;
  const sessionSummary = getGroupSessionSummary(groupSessions);
  const actualSessionCount = storedSessionIds.length;
  const allSessionsSleeping =
    groupSessions.length > 0 && groupSessions.every((session) => session.isSleeping);
  const canFullReloadGroup = groupSessions.length > 0;
  const collapsedIndicatorActivity = sessionSummary.indicatorActivity;
  const hasCollapsedSummary = collapsedIndicatorActivity !== undefined;
  /**
   * CDXC:ProjectStatusIndicators 2026-05-08-09:33
   * Collapsed project headers must expose the hidden session status counts
   * inline with the project title: attention/done sessions stay green and
   * working sessions stay amber. Header actions replace this slot on hover.
   * CDXC:ProjectStatusIndicators 2026-05-08-10:48
   * Project-header status counts render in the visual order users scan for
   * active work: working count first, then attention count.
   */
  const shouldShowCollapsedProjectCounts =
    Boolean(projectContext) &&
    isCollapsed &&
    (sessionSummary.attentionCount > 0 || sessionSummary.workingCount > 0);
  const collapsedSummaryLabel = getCollapsedSummaryLabel(collapsedIndicatorActivity);
  const sessionsRegionId = `${group.groupId}-sessions`;
  const groupHeaderAnchorStyle = {
    anchorName: getGroupStatusAnchorName(group.groupId),
  } as CSSProperties;
  const projectThemeStyle = getProjectThemeStyle(projectContext?.themeColor);
  const groupHeaderStyle = projectThemeStyle
    ? ({ ...groupHeaderAnchorStyle, ...projectThemeStyle } as CSSProperties)
    : groupHeaderAnchorStyle;

  const isGroupDropTarget =
    sortable.isDropTarget ||
    emptyGroupDropTarget.isDropTarget ||
    sessionDropIndicatorGroupId === groupId;
  /**
   * CDXC:ProjectReorder 2026-05-18-20:39:
   * Dragging a project in the reference sidebar must show a dim insertion line
   * where the project will land on pointer release. Keep the indicator on the
   * target project row instead of coloring the whole row so scanning remains
   * quiet during reorder.
   */
  const groupDropPosition =
    groupDropIndicator?.groupId === groupId ? groupDropIndicator.position : undefined;
  const isSessionDropTargetVisible = groupDropPosition === undefined && isGroupDropTarget;
  const showSessionGroupConnector = shouldShowSessionGroupConnector({
    sessions: groupSessions,
  });
  /*
   * CDXC:QuickSessions 2026-05-16-12:55:
   * The projectless chat collection remains modeled as Chats internally, but the empty reference-sidebar copy should read as Quick Sessions for users.
   */
  const emptyStateLabel = isChatCollection ? "No Quick Sessions" : "No sessions";
  const isEmptyProjectGroup =
    shouldTreatProjectAsEmptySessionGroup({
      hasProjectContext: Boolean(projectContext),
      sessionCount: actualSessionCount,
    });
  const shouldRenderOpenProjectFolderIcon = shouldShowOpenProjectFolderIcon({
    isCollapsed,
    sessionCount: actualSessionCount,
  });
  /**
   * CDXC:ProjectGroups 2026-05-15-14:33:
   * Project groups remain expandable even with no sessions because the body can
   * later receive project sessions. The sidebar no longer exposes an embedded
   * Code editor row or a project-header Code reveal button.
   * Non-project empty groups keep the old static header behavior.
   */
  const canToggleCollapsed = actualSessionCount > 0 || Boolean(projectContext);
  const groupTitleActionLabel =
    canToggleCollapsed ? `${isCollapsed ? "Expand" : "Collapse"} ${group.title}` : group.title;
  /**
   * CDXC:ProjectHeaders 2026-05-18-14:53:
   * Project row collapse/expand and project header action buttons keep accessible
   * labels but do not show hover tooltips. Project header clicks toggle the
   * project session list rather than activating the project; only the right-side
   * action buttons keep their own click behavior, and the folder icon is visual-only.
   */
  const shouldSuppressProjectCollapseTooltip =
    Boolean(projectContext) && canToggleCollapsed;
  const createSessionTooltip = isChatCollection ? "Create a Chat" : "Create a Terminal";
  const primaryProjectAgent =
    agents.find((agent) => agent.agentId === primaryProjectAgentLauncherId) ?? agents[0];
  const primaryProjectAgentLabel = primaryProjectAgent?.name ?? "Agent";
  useEffect(() => {
    postGroupDebugLog("group.sectionMounted", {
      orderedSessionIds,
    });

    return () => {
      postGroupDebugLog("group.sectionUnmounted", {});
    };
  }, [postGroupDebugLog, orderedSessionIds]);

  useEffect(() => {
    postGroupDebugLog("group.dropStateChanged", {
      isGroupDropTarget,
      orderedSessionIds,
      sessionEmptyDropTarget: emptyGroupDropTarget.isDropTarget,
      sortableIsDropTarget: sortable.isDropTarget,
    });
  }, [
    emptyGroupDropTarget.isDropTarget,
    isGroupDropTarget,
    orderedSessionIds,
    postGroupDebugLog,
    sortable.isDropTarget,
  ]);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setDraftTitle(group.title);
  }, [group.title, isEditing]);

  useEffect(() => {
    if (!autoEdit) {
      return;
    }

    startTransition(() => {
      setDraftTitle(group.title);
      setIsEditing(true);
      onAutoEditHandled();
    });
  }, [autoEdit, group.title, onAutoEditHandled]);

  useEffect(() => {
    setContextMenuPosition(undefined);
    setOpenControlMenu(undefined);
  }, [group.groupId, group.title]);

  useEffect(() => {
    if (group.isActive) {
      return;
    }

    setOpenControlMenu(undefined);
  }, [group.isActive]);

  useEffect(() => {
    if (!openControlMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (
        controlMenuRef.current?.contains(target) ||
        projectAgentButtonRef.current?.contains(target)
      ) {
        return;
      }

      setOpenControlMenu(undefined);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenControlMenu(undefined);
      }
    };
    const handleBlur = () => {
      setOpenControlMenu(undefined);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        setOpenControlMenu(undefined);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
    };
  }, [openControlMenu]);

  const submitRename = () => {
    const nextTitle = draftTitle.trim();
    setIsEditing(false);
    setDraftTitle(nextTitle || group.title);

    if (!nextTitle || nextTitle === group.title) {
      return;
    }

    vscode.postMessage({
      groupId: group.groupId,
      title: nextTitle,
      type: "renameGroup",
    });
  };

  const requestFocusGroup = () => {
    vscode.postMessage({
      groupId: group.groupId,
      type: "focusGroup",
    });
  };

  const requestCreateSession = () => {
    onCreateSessionRequested?.(group.groupId);

    vscode.postMessage({
      groupId: group.groupId,
      type: "createSessionInGroup",
    });
  };

  const persistPrimaryProjectAgentLauncher = (agentId: string) => {
    setPrimaryProjectAgentLauncherId(agentId);
    writePrimaryProjectAgentLauncherId(agentId);
  };

  const toggleProjectSessionListCollapsed = () => {
    if (!projectSessionListStorageId) {
      return;
    }

    setProjectSessionListCollapsedState(() => {
      const latestState = readProjectSessionListCollapsedState();
      const nextState = { ...latestState };
      if (latestState[projectSessionListStorageId]) {
        delete nextState[projectSessionListStorageId];
      } else {
        nextState[projectSessionListStorageId] = true;
      }
      writeProjectSessionListCollapsedState(nextState);
      return nextState;
    });
  };

  const requestCreateProjectTerminal = () => {
    setOpenControlMenu(undefined);
    requestCreateSession();
  };

  const openWorktreeModal = () => {
    if (!projectContext) {
      return;
    }
    openAppModal({
      modal: "worktree",
      projectId: projectContext.editor.projectId,
      projectName: group.title,
      type: "open",
    });
  };

  const requestRunProjectAgent = (agent: SidebarAgentButton | undefined) => {
    setOpenControlMenu(undefined);
    if (!projectContext || !agent) {
      return;
    }
    persistPrimaryProjectAgentLauncher(agent.agentId);
    vscode.postMessage({
      agentId: agent.agentId,
      groupId: group.groupId,
      type: "runSidebarAgent",
    });
  };

  const openConfigureAgentsModal = () => {
    setOpenControlMenu(undefined);
    openAppModal({ modal: "configureAgents", type: "open" });
  };

  const requestCreateBrowserPane = () => {
    if (!projectContext) {
      return;
    }

    vscode.postMessage({
      groupId: group.groupId,
      type: "openBrowserPaneInGroup",
    });
  };

  const requestCloseGroup = () => {
    if (!canClose) {
      return;
    }

    setContextMenuPosition(undefined);
    if (orderedSessionIds.length <= 1) {
      vscode.postMessage({
        groupId: group.groupId,
        type: "closeGroup",
      });
      return;
    }

    setIsConfirmOpen(true);
  };

  const requestSetGroupSleeping = (sleeping: boolean) => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      groupId: group.groupId,
      sleeping,
      type: "setGroupSleeping",
    });
  };

  const requestFullReloadGroup = () => {
    if (!canFullReloadGroup) {
      return;
    }

    setContextMenuPosition(undefined);
    vscode.postMessage({
      groupId: group.groupId,
      type: "fullReloadGroup",
    });
  };

  const openProjectThemeMenu = () => {
    setContextMenuPosition((currentPosition) =>
      currentPosition ? { ...currentPosition, view: "project-themes" } : currentPosition,
    );
  };

  const openProjectCustomThemeMenu = () => {
    setCustomThemeColor(
      projectContext?.themeColor ?? recentThemeColors[0] ?? DEFAULT_WORKSPACE_THEME_COLOR,
    );
    setContextMenuPosition((currentPosition) =>
      currentPosition ? { ...currentPosition, view: "project-custom-theme" } : currentPosition,
    );
  };

  const openProjectRootMenu = () => {
    setContextMenuPosition((currentPosition) =>
      currentPosition ? { ...currentPosition, view: "group" } : currentPosition,
    );
  };

  const copyProjectPath = () => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      groupId: group.groupId,
      type: "copyWorkspaceProjectPathForGroup",
    });
  };

  const openProjectInFinder = () => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      groupId: group.groupId,
      type: "openWorkspaceProjectInFinderForGroup",
    });
  };

  const refreshProjectDiffStats = () => {
    if (!projectContext) {
      return;
    }
    vscode.postMessage({
      groupId: group.groupId,
      type: "refreshWorkspaceProjectDiffForGroup",
    });
  };

  const chooseProjectTheme = (theme: SidebarTheme) => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      groupId: group.groupId,
      theme,
      themeColor: null,
      type: "setWorkspaceProjectThemeForGroup",
    });
  };

  const chooseProjectThemeColor = (themeColor: string) => {
    const normalizedColor = normalizeWorkspaceThemeColor(themeColor);
    if (!normalizedColor) {
      return;
    }

    setContextMenuPosition(undefined);
    const nextRecentThemeColors = updateWorkspaceThemeColorHistory(
      recentThemeColors,
      normalizedColor,
    );
    setRecentThemeColors(nextRecentThemeColors);
    writeWorkspaceThemeColorHistory(nextRecentThemeColors);
    vscode.postMessage({
      groupId: group.groupId,
      themeColor: normalizedColor,
      type: "setWorkspaceProjectThemeForGroup",
    });
  };

  const closeProject = () => {
    if (!projectContext?.canRemoveProject) {
      return;
    }

    setContextMenuPosition(undefined);
    vscode.postMessage({
      groupId: group.groupId,
      type: "closeWorkspaceProjectForGroup",
    });
  };

  const handleTitleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitRename();
      return;
    }

    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    setDraftTitle(group.title);
    setIsEditing(false);
  };

  const toggleCollapsed = () => {
    if (!canToggleCollapsed) {
      return;
    }

    onCollapsedChange(group.groupId, !isCollapsed);
  };

  const toggleCollapsedOrSelectEmptyProject = () => {
    if (!projectContext) {
      toggleCollapsed();
      return;
    }

    if (!canToggleCollapsed) {
      return;
    }

    const isExpandingEmptyProject = isCollapsed && isEmptyProjectGroup;
    onCollapsedChange(group.groupId, !isCollapsed);
    if (isExpandingEmptyProject) {
      requestCreateProjectTerminal();
    }
  };

  const handleGroupHeaderClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isEditing) {
      return;
    }

    if (event.target instanceof Element && event.target.closest(".group-header-actions")) {
      return;
    }

    if (projectContext) {
      event.preventDefault();
      event.stopPropagation();
      toggleCollapsedOrSelectEmptyProject();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    toggleCollapsedOrSelectEmptyProject();
  };

  return (
    <>
      <section
        className="group"
        data-active={String(group.isActive)}
        data-collapsed={String(isCollapsed)}
        data-dragging={String(Boolean(sortable.isDragging || isGroupDragPreviewSource))}
        data-group-drop-position={groupDropPosition}
        data-drop-target={String(isGroupDropTarget)}
        data-empty-space-blocking="true"
        data-empty-project={String(isEmptyProjectGroup)}
        data-project-group={String(Boolean(projectContext))}
        data-chat-collection={String(isChatCollection)}
        data-session-connector={String(showSessionGroupConnector)}
        data-sidebar-group-id={group.groupId}
        data-workspace-custom-theme={String(Boolean(projectContext?.themeColor))}
        onClick={() => {
          if (isCollapsed) {
            return;
          }

          requestFocusGroup();
        }}
        onContextMenu={(event: ReactMouseEvent<HTMLElement>) => {
          if (!projectContext && isNestedInteractiveContextMenuTarget(event)) {
            /**
             * CDXC:SidebarContextMenu 2026-05-15-17:53:
             * Header buttons without their own context menu should not open the
             * surrounding project/group context menu on right-click. Suppress
             * nested interactive targets while preserving right-click menus on
             * the row surface itself.
             *
             * CDXC:SidebarContextMenu 2026-05-16-13:39:
             * Project headers own a custom project context menu across their
             * whole header, including icon/title and action-button children.
             * Do not apply the nested-control suppression to project groups.
             */
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          if (isChatCollection || (!showHeaderActions && !projectContext)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          setContextMenuPosition(
            clampContextMenuPosition(
              event.clientX,
              event.clientY,
              projectContext ? 5 : 3 + Number(canFullReloadGroup),
            ),
          );
        }}
        ref={sortable.ref}
      >
        <div
          className="group-head"
          data-collapsible="true"
          onClick={handleGroupHeaderClick}
          onMouseEnter={refreshProjectDiffStats}
          style={groupHeaderStyle}
        >
          <div className="group-title-wrap">
            {isEditing ? (
              <input
                autoFocus
                className="group-title-input"
                onBlur={submitRename}
                onChange={(event) => setDraftTitle(event.currentTarget.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={handleTitleKeyDown}
                value={draftTitle}
              />
            ) : (
              <div className="group-title-row">
                {projectContext ? (
                  <span
                    aria-hidden="true"
                    className="group-collapse-button section-titlebar-toggle"
                    data-collapsed={String(isCollapsed)}
                    data-empty-project={String(isEmptyProjectGroup)}
                    data-has-idle-icon={String(canToggleCollapsed)}
                    data-static-icon={String(!canToggleCollapsed)}
                  >
                    <span
                      aria-hidden="true"
                      className="group-collapse-icon group-collapse-idle-icon section-titlebar-toggle-icon section-titlebar-toggle-idle-icon"
                    >
                      {isChatCollection ? (
                        <IconMessageCircle size={16} stroke={1.8} />
                      ) : projectContext.worktree ? (
                        <IconGitBranch size={16} stroke={1.8} />
                      ) : shouldRenderOpenProjectFolderIcon ? (
                        <IconFolderOpen size={16} stroke={1.8} />
                      ) : (
                        <IconFolder size={16} stroke={1.8} />
                      )}
                    </span>
                    {canToggleCollapsed ? (
                      <IconCaretRightFilled
                        aria-hidden="true"
                        className="group-collapse-icon group-collapse-chevron-icon section-titlebar-toggle-icon section-titlebar-toggle-chevron-icon"
                        size={16}
                      />
                    ) : null}
                  </span>
                ) : (
                  <button
                    aria-controls={canToggleCollapsed && !isCollapsed ? sessionsRegionId : undefined}
                    aria-disabled={!canToggleCollapsed && !isEmptyProjectGroup}
                    aria-expanded={canToggleCollapsed ? !isCollapsed : undefined}
                    aria-label={groupTitleActionLabel}
                    className="group-collapse-button section-titlebar-toggle"
                    data-collapsed={String(isCollapsed)}
                    data-empty-project={String(isEmptyProjectGroup)}
                    data-has-idle-icon={String(canToggleCollapsed)}
                    data-static-icon={String(!canToggleCollapsed)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleCollapsedOrSelectEmptyProject();
                    }}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="group-collapse-icon group-collapse-idle-icon section-titlebar-toggle-icon section-titlebar-toggle-idle-icon"
                    >
                      {isChatCollection ? (
                        <IconMessageCircle size={16} stroke={1.8} />
                      ) : shouldRenderOpenProjectFolderIcon ? (
                        <IconFolderOpen size={16} stroke={1.8} />
                      ) : (
                        <IconFolder size={16} stroke={1.8} />
                      )}
                    </span>
                    {canToggleCollapsed ? (
                      <IconCaretRightFilled
                        aria-hidden="true"
                        className="group-collapse-icon group-collapse-chevron-icon section-titlebar-toggle-icon section-titlebar-toggle-chevron-icon"
                        size={16}
                      />
                    ) : null}
                  </button>
                )}
                <div
                  className="group-title-handle"
                  data-draggable={String(!isChatCollection)}
                  ref={isChatCollection ? undefined : sortable.handleRef}
                >
                  {shouldSuppressProjectCollapseTooltip ? (
                    <button
                      aria-controls={canToggleCollapsed && !isCollapsed ? sessionsRegionId : undefined}
                      aria-disabled={!canToggleCollapsed && !isEmptyProjectGroup}
                      aria-expanded={canToggleCollapsed ? !isCollapsed : undefined}
                      aria-label={groupTitleActionLabel}
                      className="group-title-button"
                      data-empty-project={String(isEmptyProjectGroup)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleCollapsedOrSelectEmptyProject();
                      }}
                      type="button"
                    >
                      <span className="group-title section-titlebar-label">{group.title}</span>
                    </button>
                  ) : (
                    <AppTooltip content={groupTitleActionLabel}>
                      <button
                        aria-controls={canToggleCollapsed && !isCollapsed ? sessionsRegionId : undefined}
                        aria-disabled={!canToggleCollapsed && !isEmptyProjectGroup}
                        aria-expanded={canToggleCollapsed ? !isCollapsed : undefined}
                        aria-label={groupTitleActionLabel}
                        className="group-title-button"
                        data-empty-project={String(isEmptyProjectGroup)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleCollapsedOrSelectEmptyProject();
                        }}
                        type="button"
                      >
                        <span className="group-title section-titlebar-label">{group.title}</span>
                      </button>
                    </AppTooltip>
                  )}
                </div>
                <div className="group-title-spacer" />
                {shouldShowCollapsedProjectCounts ? (
                  <div
                    aria-label={getCollapsedProjectCountsLabel(sessionSummary)}
                    className="group-collapsed-status-counts"
                  >
                    {sessionSummary.workingCount > 0 ? (
                      <span className="group-collapsed-status-count" data-activity="working">
                        {sessionSummary.workingCount}
                      </span>
                    ) : null}
                    {sessionSummary.attentionCount > 0 ? (
                      <span className="group-collapsed-status-count" data-activity="attention">
                        {sessionSummary.attentionCount}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {/* CDXC:ProjectDiffStats 2026-05-16-08:46: Users can hide the project-header +added/-removed line summary entirely while keeping diff collection and action refresh behavior unchanged. */}
                {projectContext &&
                !hideProjectHeaderDiffStats &&
                !shouldShowCollapsedProjectCounts &&
                shouldShowProjectEditorDiffStats(projectContext.editor.diffStats) ? (
                  <ProjectHeaderDiffStats
                    showFileCount={showProjectEditorDiffFileCount}
                    stats={projectContext.editor.diffStats}
                  />
                ) : null}
                {showHeaderActions ? (
                  <div
                    className="group-header-actions"
                    data-open={String(openControlMenu !== undefined)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    {projectContext ? (
                      /**
                       * CDXC:ProjectGroups 2026-05-10-14:18
                       * Project headers expose a compact control family on
                       * every project row: browser pane creation, a separate
                       * terminal button, and an agent-only split launcher.
                       * Terminal creation is not an
                       * agent dropdown option so terminal and agent launches
                       * stay visually and behaviorally distinct.
                       *
                       * CDXC:ProjectGroups 2026-05-15-14:33:
                       * The sidebar no longer shows the Code editor row or a
                       * project-header Show Code Editor button. Embedded Code
                       * remains reachable through the native titlebar.
                       *
                       * CDXC:ProjectGroups 2026-05-18-14:53:
                       * Project header icon actions should rely on accessible
                       * labels only, without hover tooltips, so project rows
                       * stay visually quiet while scanning and hovering.
                       *
                       * CDXC:Worktrees 2026-05-18-23:07:
                       * Main project rows expose Create Worktree. Worktree rows
                       * replace that with disabled PR and merge affordances until
                       * those follow-up actions are wired to real commands.
                      */
                      <>
                        {projectContext.worktree ? (
                          <>
                            <button
                              aria-disabled="true"
                              aria-label={`Create PR for ${group.title}`}
                              className="group-add-button group-worktree-pr-button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              type="button"
                            >
                              <IconGitPullRequest
                                aria-hidden="true"
                                className="group-add-icon"
                                size={14}
                                stroke={2}
                              />
                            </button>
                            <button
                              aria-disabled="true"
                              aria-label={`Merge ${group.title} to main`}
                              className="group-add-button group-worktree-merge-button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              type="button"
                            >
                              <IconGitMerge
                                aria-hidden="true"
                                className="group-add-icon"
                                size={14}
                                stroke={2}
                              />
                            </button>
                          </>
                        ) : (
                          <button
                            aria-label={`Create a worktree from ${group.title}`}
                            className="group-add-button group-worktree-button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openWorktreeModal();
                            }}
                            type="button"
                          >
                            <IconGitBranch
                              aria-hidden="true"
                              className="group-add-icon"
                              size={14}
                              stroke={2}
                            />
                          </button>
                        )}
                        <button
                          aria-label={`Create a browser pane in ${group.title}`}
                          className="group-add-button group-browser-button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            requestCreateBrowserPane();
                          }}
                          type="button"
                        >
                          <IconWorld
                            aria-hidden="true"
                            className="group-add-icon"
                            size={14}
                            stroke={2}
                          />
                        </button>
                        <button
                          aria-label={`Create a terminal in ${group.title}`}
                          className="group-add-button group-project-terminal-button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            requestCreateProjectTerminal();
                          }}
                          type="button"
                        >
                          <IconTerminal2
                            aria-hidden="true"
                            className="group-add-icon"
                            size={14}
                            stroke={2}
                          />
                        </button>
                        <div className="group-control-anchor">
                          <div
                            className="group-agent-split-button"
                            data-open={String(openControlMenu === "project-agent")}
                          >
                            <button
                              aria-label={`Create ${primaryProjectAgentLabel} in ${group.title}`}
                              className="group-agent-main-button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (!primaryProjectAgent) {
                                  openConfigureAgentsModal();
                                  return;
                                }
                                requestRunProjectAgent(primaryProjectAgent);
                              }}
                              type="button"
                            >
                              <ProjectAgentLauncherIcon agent={primaryProjectAgent} />
                            </button>
                            <button
                              aria-expanded={openControlMenu === "project-agent"}
                              aria-haspopup="menu"
                              aria-label={`Select agent for ${group.title}`}
                              className="group-agent-toggle-button"
                              data-open={String(openControlMenu === "project-agent")}
                              onClick={() => {
                                setOpenControlMenu((previous) =>
                                  previous === "project-agent" ? undefined : "project-agent",
                                );
                              }}
                              ref={projectAgentButtonRef}
                              type="button"
                            >
                              <IconChevronDown aria-hidden="true" size={13} stroke={2} />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <AppTooltip content={createSessionTooltip}>
                          <button
                            aria-label={
                              isChatCollection
                                  ? `Create a chat in ${group.title}`
                                  : `Create a session in ${group.title}`
                            }
                            className="group-add-button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              requestCreateSession();
                            }}
                            type="button"
                          >
                            <IconPlus
                              aria-hidden="true"
                              className="group-add-icon"
                              size={14}
                              stroke={2}
                            />
                          </button>
                        </AppTooltip>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
        {isCollapsed && !projectContext && hasCollapsedSummary ? (
          <div
            aria-label={collapsedSummaryLabel}
            className="group-collapsed-summary"
            data-activity={collapsedIndicatorActivity}
            style={getCollapsedGroupStatusStyle(group.groupId)}
          >
            <div aria-hidden className="session-status-dot" />
          </div>
        ) : null}
        <div
          aria-hidden={isCollapsed}
          className="group-sessions-shell sidebar-collapse-shell"
          data-collapsed={String(isCollapsed)}
          style={collapsibleStyle}
        >
          <div
            className="group-sessions sidebar-collapse-content"
            data-drop-target={String(isSessionDropTargetVisible)}
            id={sessionsRegionId}
            ref={contentRef}
          >
            {showSessionGroupConnector ? (
              <>
                <div aria-hidden className="group-session-connector-rail" />
                <button
                  aria-label={`Collapse ${group.title}`}
                  className="group-session-connector-button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleCollapsed();
                  }}
                  type="button"
                />
              </>
            ) : null}
            {orderedSessionIds.length > 0 ? (
              <>
                {visibleSessionIds.map((sessionId, sessionIndex) => (
                  <SortableSessionCard
                    completionFlashNonce={completionFlashNonceBySessionId?.[sessionId] ?? 0}
                    dragDisabled={areSessionDropTargetsDisabled}
                    groupId={group.groupId}
                    index={sessionIndex}
                    isSearchSelected={selectedSearchSessionId === sessionId}
                    key={sessionId}
                    onFocusRequested={onFocusRequested}
                    sessionId={sessionId}
                    showGroupConnector={showSessionGroupConnector}
                    showDropPositionIndicator={showSessionDropPositionIndicators}
                    vscode={vscode}
                  />
                ))}
                {shouldShowProjectSessionListToggle ? (
                  <button
                    aria-label={
                      isProjectSessionListCollapsed
                        ? `Show all sessions in ${group.title}`
                        : `Show fewer sessions in ${group.title}`
                    }
                    className="project-session-list-toggle"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleProjectSessionListCollapsed();
                    }}
                    type="button"
                  >
                    {isProjectSessionListCollapsed ? "Show more" : "Show less"}
                  </button>
                ) : null}
              </>
            ) : isEmptyProjectGroup ? null : (
              <div
                className="group-empty-drop-target"
                data-drop-position={emptyGroupDropTarget.isDropTarget ? "start" : undefined}
                data-drop-target={String(isSessionDropTargetVisible)}
                ref={emptyGroupDropTarget.ref}
              >
                <div className="group-empty-state">{emptyStateLabel}</div>
              </div>
            )}
          </div>
          {showSessionGroupConnector
            ? visibleGroupSessions.map((session) => (
                <div
                  aria-hidden
                  className="session-status-dot session-status-dot-anchored"
                  data-activity={session.activity}
                  data-lifecycle-state={getSidebarSessionLifecycleState(session)}
                  key={`status-${session.sessionId}`}
                  style={getAnchoredSessionStatusStyle(session.sessionId)}
                />
              ))
            : null}
        </div>
      </section>
      {contextMenuPosition ? (
        <SidebarContextMenuPortal
          menuRef={menuRef}
          menuStyle={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
            width: `${CONTEXT_MENU_WIDTH_PX}px`,
          }}
          onDismiss={() => {
            setContextMenuPosition(undefined);
          }}
          vscode={vscode}
        >
              {projectContext ? (
                contextMenuPosition.view === "project-themes" ? (
                  <>
                    <button
                      className="session-context-menu-item"
                      onClick={openProjectRootMenu}
                      role="menuitem"
                      type="button"
                    >
                      <IconChevronLeft
                        aria-hidden="true"
                        className="session-context-menu-icon"
                        size={14}
                      />
                      Back
                    </button>
                    <div className="session-context-menu-divider" role="separator" />
                    <button
                      className="session-context-menu-item workspace-dock-theme-menu-item"
                      data-selected={String(Boolean(projectContext.themeColor))}
                      onClick={openProjectCustomThemeMenu}
                      role="menuitemradio"
                      type="button"
                    >
                      <span
                        className="workspace-dock-theme-swatch"
                        style={getProjectThemeSwatchStyle(
                          projectContext.themeColor ??
                            recentThemeColors[0] ??
                            DEFAULT_WORKSPACE_THEME_COLOR,
                        )}
                      />
                      Custom
                      <IconChevronRight
                        aria-hidden="true"
                        className="session-context-menu-trailing-icon"
                        size={14}
                      />
                    </button>
                    {PROJECT_CONTEXT_THEME_OPTIONS.map((theme) => (
                      <button
                        className="session-context-menu-item workspace-dock-theme-menu-item"
                        data-selected={String(
                          !projectContext.themeColor && projectContext.theme === theme.value,
                        )}
                        key={theme.value}
                        onClick={() => chooseProjectTheme(theme.value)}
                        role="menuitemradio"
                        type="button"
                      >
                        <span
                          className="workspace-dock-theme-swatch"
                          data-workspace-theme={theme.value}
                        />
                        {theme.label}
                      </button>
                    ))}
                  </>
                ) : contextMenuPosition.view === "project-custom-theme" ? (
                  <>
                    <button
                      className="session-context-menu-item"
                      onClick={openProjectThemeMenu}
                      role="menuitem"
                      type="button"
                    >
                      <IconChevronLeft
                        aria-hidden="true"
                        className="session-context-menu-icon"
                        size={14}
                      />
                      Back
                    </button>
                    <div className="session-context-menu-divider" role="separator" />
                    <div className="workspace-theme-custom-picker">
                      {/*
                       * CDXC:WorkspaceTheme 2026-05-05-02:58
                       * Combined-mode project headers use the same Theme menu
                       * custom color picker as the workspace dock. Applying a
                       * color posts a validated project theme color and records
                       * it in the local recent-color palette.
                       */}
                      <input
                        aria-label="Custom workspace theme color"
                        className="workspace-theme-color-input"
                        onChange={(event) => {
                          const normalizedColor = normalizeWorkspaceThemeColor(
                            event.currentTarget.value,
                          );
                          if (normalizedColor) {
                            setCustomThemeColor(normalizedColor);
                          }
                        }}
                        type="color"
                        value={customThemeColor}
                      />
                      <input
                        aria-label="Custom workspace theme color hex"
                        className="workspace-theme-color-text"
                        onChange={(event) => {
                          const normalizedColor = normalizeWorkspaceThemeColor(
                            event.currentTarget.value,
                          );
                          if (normalizedColor) {
                            setCustomThemeColor(normalizedColor);
                          }
                        }}
                        value={customThemeColor}
                      />
                      <button
                        aria-label="Apply custom workspace theme color"
                        className="workspace-theme-color-apply"
                        onClick={() => chooseProjectThemeColor(customThemeColor)}
                        type="button"
                      >
                        <IconCheck aria-hidden="true" size={14} stroke={2.2} />
                      </button>
                    </div>
                    {recentThemeColors.length > 0 ? (
                      <div className="workspace-theme-color-palette">
                        {recentThemeColors.map((themeColor) => (
                          <button
                            aria-label={`Use ${themeColor}`}
                            className="workspace-theme-color-palette-button"
                            key={themeColor}
                            onClick={() => chooseProjectThemeColor(themeColor)}
                            style={getProjectThemeSwatchStyle(themeColor)}
                            type="button"
                          />
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    {/*
                     * CDXC:ProjectGroups 2026-05-11-01:05
                     * Project group context menus expose filesystem actions
                     * first, then group lifecycle actions, and end with Close
                     * Project. Close Project parks the project in Recent
                     * Projects without deleting saved sessions.
                     * CDXC:WorkspaceTheme 2026-05-09-17:18
                     * The Theme submenu is unused in the UI for now because
                     * theming has been disabled in this app for now. Keep the
                     * theme implementation available for a later re-enable, but
                     * hide its project right-click menu entry point.
                     */}
                    <button
                      className="session-context-menu-item"
                      onClick={copyProjectPath}
                      role="menuitem"
                      type="button"
                    >
                      <IconCopy
                        aria-hidden="true"
                        className="session-context-menu-icon"
                        size={14}
                      />
                      Copy Path
                    </button>
                    <button
                      className="session-context-menu-item"
                      onClick={openProjectInFinder}
                      role="menuitem"
                      type="button"
                    >
                      <IconFolderOpen
                        aria-hidden="true"
                        className="session-context-menu-icon"
                        size={14}
                      />
                      Open in Finder
                    </button>
                    <div className="session-context-menu-divider" role="separator" />
                    <button
                      className="session-context-menu-item"
                      onClick={() => requestSetGroupSleeping(!allSessionsSleeping)}
                      role="menuitem"
                      type="button"
                    >
                      {allSessionsSleeping ? (
                        <IconPlayerPlay
                          aria-hidden="true"
                          className="session-context-menu-icon"
                          size={14}
                        />
                      ) : (
                        <IconMoon
                          aria-hidden="true"
                          className="session-context-menu-icon"
                          size={14}
                        />
                      )}
                      {allSessionsSleeping ? "Wake" : "Sleep"}
                    </button>
                    {canFullReloadGroup ? (
                      <button
                        className="session-context-menu-item"
                        onClick={requestFullReloadGroup}
                        role="menuitem"
                        type="button"
                      >
                        <IconRefresh
                          aria-hidden="true"
                          className="session-context-menu-icon"
                          size={14}
                        />
                        Full reload
                      </button>
                    ) : null}
                    <div className="session-context-menu-divider" role="separator" />
                    <button
                      className="session-context-menu-item session-context-menu-item-danger"
                      disabled={!projectContext.canRemoveProject}
                      onClick={closeProject}
                      role="menuitem"
                      type="button"
                    >
                      <IconX aria-hidden="true" className="session-context-menu-icon" size={14} />
                      Close Project
                    </button>
                  </>
                )
              ) : (
                <>
                  <button
                    className="session-context-menu-item"
                    onClick={() => {
                      setContextMenuPosition(undefined);
                      setIsEditing(true);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <IconPencil
                      aria-hidden="true"
                      className="session-context-menu-icon"
                      size={14}
                    />
                    Rename
                  </button>
                  {canFullReloadGroup ? (
                    <button
                      className="session-context-menu-item"
                      onClick={requestFullReloadGroup}
                      role="menuitem"
                      type="button"
                    >
                      <IconRefresh
                        aria-hidden="true"
                        className="session-context-menu-icon"
                        size={14}
                      />
                      Full reload
                    </button>
                  ) : null}
                  <button
                    className="session-context-menu-item"
                    onClick={() => requestSetGroupSleeping(!allSessionsSleeping)}
                    role="menuitem"
                    type="button"
                  >
                    {allSessionsSleeping ? (
                      <IconPlayerPlay
                        aria-hidden="true"
                        className="session-context-menu-icon"
                        size={14}
                      />
                    ) : (
                      <IconMoon
                        aria-hidden="true"
                        className="session-context-menu-icon"
                        size={14}
                      />
                    )}
                    {allSessionsSleeping ? "Wake" : "Sleep"}
                  </button>
                  <div className="session-context-menu-divider" role="separator" />
                  <button
                    className="session-context-menu-item session-context-menu-item-danger"
                    disabled={!canClose}
                    onClick={requestCloseGroup}
                    role="menuitem"
                    type="button"
                  >
                    <IconX aria-hidden="true" className="session-context-menu-icon" size={14} />
                    Close
                  </button>
                </>
              )}
        </SidebarContextMenuPortal>
      ) : null}
      {projectContext && openControlMenu === "project-agent"
        ? createPortal(
            <div
              className="group-control-menu session-context-menu group-agent-menu"
              onClick={(event) => event.stopPropagation()}
              ref={controlMenuRef}
              role="menu"
              style={getPortalMenuStyle(projectAgentButtonRef.current, GROUP_AGENT_MENU_WIDTH_PX)}
            >
              {agents.map((agent) => (
                <button
                  aria-pressed={primaryProjectAgent?.agentId === agent.agentId}
                  className="session-context-menu-item group-control-menu-item group-agent-menu-item"
                  data-selected={String(primaryProjectAgent?.agentId === agent.agentId)}
                  key={agent.agentId}
                  onClick={() => requestRunProjectAgent(agent)}
                  role="menuitem"
                  type="button"
                >
                  <ProjectAgentLauncherIcon agent={agent} colorMode="brand" />
                  <span className="group-agent-menu-label">{agent.name}</span>
                  {primaryProjectAgent?.agentId === agent.agentId ? (
                    <IconCheck aria-hidden="true" className="session-context-menu-icon" size={14} />
                  ) : null}
                </button>
              ))}
              {agents.length > 0 ? (
                <div className="session-context-menu-divider" role="separator" />
              ) : null}
              <button
                className="session-context-menu-item group-control-menu-item group-agent-menu-item"
                onClick={openConfigureAgentsModal}
                role="menuitem"
                type="button"
              >
                <IconSettings aria-hidden="true" className="session-context-menu-icon" size={14} />
                <span className="group-agent-menu-label">Configure</span>
              </button>
            </div>,
            document.body,
          )
        : null}
      {/**
       * CDXC:SessionClose 2026-05-11-00:45
       * Group close confirmation copy must use Close so bulk session removal
       * matches the session context menu and does not expose
       * process-lifecycle wording to users.
       */}
      <ConfirmationModal
        confirmLabel="Close Group"
        description={`This will close all ${orderedSessionIds.length} session${orderedSessionIds.length === 1 ? "" : "s"} in ${group.title}.`}
        isOpen={isConfirmOpen}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => {
          setIsConfirmOpen(false);
          vscode.postMessage({
            groupId: group.groupId,
            type: "closeGroup",
          });
        }}
        title="Close group?"
      />
    </>
  );
}

function ProjectAgentLauncherIcon({
  agent,
  colorMode = "monochrome",
}: {
  agent?: SidebarAgentButton;
  colorMode?: "brand" | "monochrome";
}) {
  if (!agent) {
    return (
      <IconCode
        aria-hidden="true"
        className="group-agent-launcher-icon group-agent-launcher-tabler-icon"
        size={14}
        stroke={1.9}
      />
    );
  }

  if (agent.icon) {
    /**
     * CDXC:ProjectAgents 2026-05-16-18:21:
     * The sidebar project agent dropdown should show colored provider icons for
     * scanability, while the compact split launcher keeps its quieter
     * monochrome treatment everywhere outside that dropdown.
     */
    const iconColor = colorMode === "brand" ? AGENT_LOGO_COLORS[agent.icon] : "currentColor";

    return (
      <span
        aria-hidden="true"
        className="group-agent-launcher-icon group-agent-launcher-agent-icon"
        data-agent-icon={agent.icon}
        style={{
          backgroundColor: iconColor,
          maskImage: `url("${AGENT_LOGOS[agent.icon]}")`,
          WebkitMaskImage: `url("${AGENT_LOGOS[agent.icon]}")`,
        }}
      />
    );
  }

  return (
    <IconCode
      aria-hidden="true"
      className="group-agent-launcher-icon group-agent-launcher-tabler-icon"
      size={14}
      stroke={1.9}
    />
  );
}

function readPrimaryProjectAgentLauncherId(): string | undefined {
  /**
   * CDXC:ProjectAgents 2026-05-10-14:18
   * Project headers persist only the chosen agent for the split agent button.
   * The storage key remains the historic terminal-launcher key so existing
   * agent choices survive the UI split that moved Terminal to its own button.
   */
  return localStorage.getItem(PROJECT_AGENT_LAUNCHER_STORAGE_KEY)?.trim() || undefined;
}

function writePrimaryProjectAgentLauncherId(agentId: string): void {
  localStorage.setItem(PROJECT_AGENT_LAUNCHER_STORAGE_KEY, agentId);
}

function readProjectSessionListCollapsedState(): ProjectSessionListCollapsedState {
  try {
    return normalizeStoredProjectSessionListCollapsedState(
      JSON.parse(localStorage.getItem(PROJECT_SESSION_LIST_COLLAPSED_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return {};
  }
}

function writeProjectSessionListCollapsedState(state: ProjectSessionListCollapsedState): void {
  /**
   * CDXC:ProjectSessionLists 2026-05-16-21:50:
   * Show less / Show more is per-project navigation state, not session data.
   * Persist only the collapsed project ids so new projects and projects the
   * user has never collapsed continue to start with all sessions shown.
   */
  localStorage.setItem(PROJECT_SESSION_LIST_COLLAPSED_STORAGE_KEY, JSON.stringify(state));
}

function getPortalMenuStyle(button: HTMLButtonElement | null, menuWidth: number) {
  const position = getControlMenuPosition(button);
  const bounds = button?.getBoundingClientRect();
  if (!position) {
    return undefined;
  }

  const left = Math.max(
    GROUP_CONTROL_MENU_MARGIN_PX,
    Math.min(
      (bounds?.right ?? position.x) - menuWidth,
      window.innerWidth - menuWidth - GROUP_CONTROL_MENU_MARGIN_PX,
    ),
  );

  return {
    left: `${left}px`,
    position: "fixed" as const,
    top: `${position.y}px`,
    width: `${menuWidth}px`,
  };
}

let sessionGroupDebugInstanceCounter = 0;

function createSessionGroupDebugInstanceId(): number {
  sessionGroupDebugInstanceCounter += 1;
  return sessionGroupDebugInstanceCounter;
}

function getCollapsedSummaryLabel(
  indicatorActivity: "attention" | "working" | undefined,
): string | undefined {
  if (indicatorActivity === "attention") {
    return "Group has completed sessions";
  }

  if (indicatorActivity === "working") {
    return "Group has working sessions";
  }

  return undefined;
}

function getCollapsedProjectCountsLabel(
  summary: Pick<GroupSessionSummary, "attentionCount" | "workingCount">,
): string {
  return [
    summary.workingCount > 0 ? `${summary.workingCount} working` : "",
    summary.attentionCount > 0 ? `${summary.attentionCount} attention` : "",
  ]
    .filter(Boolean)
    .join(", ");
}
