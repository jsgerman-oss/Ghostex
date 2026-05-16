import { createRoot } from "react-dom/client";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconFolderOpen,
  IconMessageCirclePlus,
  IconPlus,
  IconPalette,
  IconTrash,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { installAppModalGlobalErrorLogging } from "../../sidebar/app-modal-error-log";
import { AppTooltip, TooltipProvider } from "../../sidebar/app-tooltip";
import { openAppModal, postAppModalHostMessage } from "../../sidebar/app-modal-host-bridge";
import { SidebarApp } from "../../sidebar/sidebar-app";
import { AGENT_LOGO_COLORS, AGENT_LOGOS } from "../../sidebar/agent-logos";
import { TOOLTIP_DELAY_MS } from "../../sidebar/tooltip-delay";
import {
  explainFirstPromptAutoRenameDecision,
  getCurrentTitleForFirstPromptAutoRename,
  resolveFirstPromptAutoRenameStrategy,
  type FirstPromptAutoRenameStrategy,
} from "../../shared/first-prompt-session-title";
import {
  DEFAULT_FIND_PREVIOUS_SESSION_PROMPT_TEMPLATE,
  renderFindPreviousSessionPrompt,
} from "../../shared/find-previous-session-prompt";
import {
  acknowledgeTitleDerivedSessionActivity,
  getTitleDerivedSessionActivityFromTransition,
  haveSameTitleDerivedSessionActivity,
  type TitleDerivedSessionActivity,
} from "../../shared/session-title-activity";
import {
  clampVisibleSessionCount,
  createAgentSessionDefaultTitle,
  createDefaultCommandsPanelState,
  createDefaultGroupedSessionWorkspaceSnapshot,
  createSessionRecord,
  createTimestampedSessionId,
  createSidebarHudState,
  DEFAULT_COMMANDS_PANEL_HEIGHT_RATIO,
  DEFAULT_TERMINAL_SESSION_TITLE,
  createSidebarSessionItems,
  getCodexSessionIdFromTitle,
  MAX_COMMANDS_PANEL_HEIGHT_RATIO,
  MIN_COMMANDS_PANEL_HEIGHT_RATIO,
  getSessionCardPrimaryTitle,
  getSlotPosition,
  isGhostPlaceholderSessionTitle,
  normalizeSessionRenameTitle,
  normalizeTerminalTitle,
  getVisiblePrimaryTitle,
  getVisibleTerminalTitle,
  resolveSidebarTheme,
  type ExtensionToSidebarMessage,
  type AgentsHubCatalogMessage,
  type GroupedSessionWorkspaceSnapshot,
  type SessionRecord,
  type SessionGridSnapshot,
  type SidebarActiveSessionsSortMode,
  type SidebarCollapsibleSection,
  type SidebarDaemonSessionItem,
  type SidebarDaemonSessionsStateMessage,
  type SidebarT3SessionItem,
  type SidebarHydrateMessage,
  type SidebarPreviousSessionItem,
  type SidebarRecentProject,
  type SidebarSectionCollapseState,
  type SidebarSessionGroup,
  type SidebarSessionItem,
  type SidebarTheme,
  type SidebarToExtensionMessage,
  type SidebarGhostexFolderStatsMessage,
  type TerminalSessionPersistenceProvider,
  type TerminalSessionRecord,
  type T3SessionRecord,
  type VisibleSessionCount,
  type SidebarCommandSessionIndicator,
  type SessionGridDirection,
  type SessionGroupRecord,
  type SessionPaneLayoutNode,
  type BrowserSessionRecord,
  type CommandsPanelMode,
  type CommandsPanelState,
} from "../../shared/session-grid-contract";
import { createDisplaySessionLayout } from "../../shared/active-sessions-sort";
import { focusDirectionInSnapshot } from "../../shared/session-grid-state-create-focus";
import { normalizeSessionRecord } from "../../shared/session-grid-state-helpers";
import {
  createDefaultSidebarGitState,
  type SidebarGitAction,
  type SidebarGitState,
} from "../../shared/sidebar-git";
import {
  createDefaultSidebarProjectDiffStats,
  mergeSidebarProjectDiffStats,
  parseGitNumstatDiffStats,
  parseGitZeroDelimitedPaths,
  parseWcLineCountStdout,
  type SidebarProjectDiffStats,
} from "../../shared/project-diff-stats";
import {
  createGroupFromSessionInSimpleWorkspace,
  createGroupInSimpleWorkspace,
  createSessionInSimpleWorkspace,
  focusGroupByIndexInSimpleWorkspace,
  focusGroupInSimpleWorkspace,
  focusSessionInSimpleWorkspace,
  mergeAllTabsInPaneLayoutInSimpleWorkspace,
  moveSessionInPaneLayoutInSimpleWorkspace,
  moveSessionToGroupInSimpleWorkspace,
  normalizeSimpleGroupedSessionWorkspaceSnapshot,
  removeGroupInSimpleWorkspace,
  removeSessionInSimpleWorkspace,
  reorderSessionInPaneTabGroupInSimpleWorkspace,
  renameGroupInSimpleWorkspace,
  rotatePaneLayoutClockwiseInSimpleWorkspace,
  selectPaneTabInSimpleWorkspace,
  setGroupSleepingInSimpleWorkspace,
  setBrowserSessionFaviconDataUrlInSimpleWorkspace,
  setBrowserSessionUrlInSimpleWorkspace,
  setSessionFavoriteInSimpleWorkspace,
  setSessionPoppedOutInSimpleWorkspace,
  setSessionSleepingInSimpleWorkspace,
  setSessionTitleInSimpleWorkspace,
  setT3SessionMetadataInSimpleWorkspace,
  setTerminalSessionAgentSessionMetadataInSimpleWorkspace,
  setTerminalSessionAgentNameInSimpleWorkspace,
  setTerminalSessionPersistenceNameInSimpleWorkspace,
  setTerminalSessionPersistenceProviderInSimpleWorkspace,
  setViewModeInSimpleWorkspace,
  setVisibleCountInSimpleWorkspace,
  swapVisibleSessionsInSimpleWorkspace,
  syncGroupOrderInSimpleWorkspace,
  syncSessionOrderInSimpleWorkspace,
  toggleFullscreenSessionInSimpleWorkspace,
  type VisibleSessionPlacement,
  type SessionPaneDropPlacement,
  type SessionPaneTabReorderPosition,
} from "../../shared/simple-grouped-session-workspace-state";
import {
  normalizeSidebarPinnedPrompts,
  type SidebarPinnedPrompt,
} from "../../shared/sidebar-pinned-prompts";
import {
  createSidebarAgentButtons,
  DEFAULT_SIDEBAR_AGENTS,
  getDefaultSidebarAgentByIcon,
  getDefaultSidebarAgentById,
  getSidebarAgentIconById,
  isDefaultSidebarAgentId,
  normalizeStoredSidebarAgentOrder,
  normalizeStoredSidebarAgents,
  shouldPreferTerminalTitleForAgentIcon,
  type SidebarAgentButton,
  type StoredSidebarAgent,
} from "../../shared/sidebar-agents";
import {
  createSidebarCommandButtons,
  DEFAULT_BROWSER_LAUNCH_URL,
  isDefaultSidebarCommandId,
  normalizeStoredSidebarCommandOrder,
  normalizeStoredSidebarCommands,
  type SidebarCommandButton,
  type SidebarCommandRunMode,
  type StoredSidebarCommand,
} from "../../shared/sidebar-commands";
import {
  DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
  normalizeSidebarCommandIconColor,
} from "../../shared/sidebar-command-icons";
import { SidebarCommandIconGlyph } from "../../sidebar/sidebar-command-icon";
import { SIDEBAR_REFRESH_DEBUG_EVENT_PREFIX } from "../../sidebar/sidebar-refresh-debug-log";
import {
  createCombinedProjectGroupId,
  createCombinedProjectSessionId,
  parseCombinedProjectGroupId,
  parseCombinedProjectSessionId,
} from "./combined-sidebar-mode";
import {
  compareRecentProjectsByClosedAt,
  countRecentProjectSessions,
} from "./recent-projects";
import {
  DEFAULT_WORKSPACE_THEME_COLOR,
  getWorkspaceThemeForeground,
  normalizeWorkspaceDockIcon,
  normalizeWorkspaceDockIconDataUrl,
  normalizeWorkspaceThemeColor,
  readWorkspaceThemeColorHistory,
  resolveWorkspaceProjectIconDataUrl,
  updateWorkspaceThemeColorHistory,
  writeWorkspaceThemeColorHistory,
  type WorkspaceDockIcon,
} from "../../shared/workspace-dock-icons";
import {
  DEFAULT_ghostex_SETTINGS,
  getDefaultEditorCommandForSettings,
  getZedOverlayTargetAppLabel,
  normalizeghostexSettings,
  type SidebarSide,
  type ZedOverlayTargetApp,
  type ghostexSettings,
} from "../../shared/ghostex-settings";
import { createAgentsHubExternalEditorCommand } from "../../shared/agents-hub-editor-command";
import {
  ALWAYS_AVAILABLE_WORKSPACE_OPEN_TARGET_IDS,
  BUILT_IN_WORKSPACE_OPEN_TARGETS,
  normalizeWorkspaceOpenTargetAvailability,
  type BuiltInWorkspaceOpenTargetId,
  type CustomWorkspaceOpenTarget,
} from "../../shared/workspace-open-targets";
import {
  getCompletionSoundFileName,
  type CompletionSoundSetting,
} from "../../shared/completion-sound";
import {
  getghostexHotkeyActionById,
  getghostexHotkeyActionIdForKey,
  type ghostexFocusedPaneAction,
  type ghostexHotkeyActionId,
} from "../../shared/ghostex-hotkeys";
import { getGhosttyTerminalConfigValues } from "../../shared/ghostty-terminal-settings";
import {
  GHOSTTY_SETTINGS_DOCS_URL,
  GHOSTEX_GHOSTTY_MANAGED_CONFIG_KEYS,
  GHOSTEX_RECOMMENDED_GHOSTTY_CONFIG_LINES,
} from "../../shared/ghostty-config-actions";
import "../../sidebar/styles.css";

type NativeSessionStatusIndicatorStatus = "attention" | "working" | "available";
type NativePetOverlayActivityState = "attention" | "working";
type NativePetOverlayActivity = {
  id: string;
  projectId: string;
  state: NativePetOverlayActivityState;
  title: string;
};
type NativeTerminalTitleBarAction =
  | "close"
  | "closeCommandsPanel"
  | "delayedSend"
  | "expandCommandsPanel"
  | "fork"
  | "mergeAllTabs"
  | "newTerminal"
  | "openBrowser"
  | "pinCommandsPanel"
  | "popOut"
  | "reload"
  | "rename"
  | "restorePopOut"
  | "rotatePanesClockwise"
  | "sleep"
  | "splitHorizontal"
  | "splitVertical"
  | "unpinCommandsPanel";
type ProjectEditorLoadStatus = "idle" | "opening" | "running" | "error";
type ProjectEditorSurfaceMode = "code" | "git" | "tasks";
type TitlebarMode = "agents" | ProjectEditorSurfaceMode;

type NativeHostCommand =
  | {
      activateOnCreate?: boolean;
      cwd: string;
      env?: Record<string, string>;
      initialInput?: string;
      sessionId: string;
      sessionPersistenceName?: string;
      sessionPersistenceProvider?: "tmux" | "zmx" | "zellij";
      title?: string;
      type: "createTerminal";
    }
  | {
      cwd?: string;
      projectId?: string;
      sessionId: string;
      threadId?: string;
      title: string;
      type: "createWebPane";
      url: string;
    }
  | { preservePersistenceSession?: boolean; sessionId: string; type: "closeTerminal" }
  | { sessionId: string; type: "closeWebPane" }
  | { sessionId: string; type: "focusTerminal" }
  | { sessionId: string; type: "focusWebPane" }
  | { sessionId: string; type: "reloadWebPane" }
  | { cwd: string; type: "startT3CodeRuntime" }
  | {
      /**
       * CDXC:T3Code 2026-05-10-22:48
       * The sidebar is authoritative for whether a T3 card is shown and awake.
       * Native uses this set to keep the managed t3code server alive while a
       * T3 session is running, independent of which workspace pane is focused.
       *
       * CDXC:T3Code 2026-05-14-09:34:
       * Awake T3 cards in the sidebar also need a workspace root on this state
       * message so native can restart the background t3code provider when the
       * server has exited but the user still has T3 sessions shown.
       */
      runtimeCwd?: string;
      runningSessionIds: string[];
      type: "setT3CodeRuntimeSessionState";
    }
  | { type: "stopT3CodeRuntime" }
  | {
      cwd: string;
      linkVscodeUserConfig?: boolean;
      type: "startCodeServerRuntime";
      vscodeUserConfigDir?: string;
    }
  | { type: "stopCodeServerRuntime" }
  | {
      companionPaneHidden?: boolean;
      mode?: ProjectEditorSurfaceMode;
      projectId: string;
      projectTitle?: string;
      showsBrowserToolbar?: boolean;
      showsProjectTabs?: boolean;
      title: string;
      type: "createProjectEditorPane";
      url: string;
    }
  | { projectId: string; type: "focusProjectEditorPane" }
  | { projectId: string; type: "closeProjectEditorPane" }
  | { type: "activateApp" }
  | { sessionId: string; text: string; type: "writeTerminalText" }
  | { sessionId: string; type: "sendTerminalEnter" }
  | {
	      activeSessionIds: string[];
      commandsPanelActiveSessionIds?: string[];
      commandsPanelFocusedSessionId?: string;
      commandsPanelHeightRatio?: number;
      commandsPanelIsVisible?: boolean;
      commandsPanelLayout?: NativeTerminalLayout;
      commandsPanelMode?: "floating" | "pinned";
      activeProjectDiffStats?: SidebarProjectDiffStats;
      activeProjectMode?: TitlebarMode;
      activeProjectEditorCompanionPaneHidden?: boolean;
      activeProjectEditorIsOpen?: boolean;
      activeProjectEditorIsSleeping?: boolean;
	      activeProjectEditorStatus?: ProjectEditorLoadStatus;
	      activeProjectId?: string;
      activeProjectIconDataUrl?: string;
      activeProjectName?: string;
      activeProjectPath?: string;
      appTitle?: string;
      attentionSessionIds?: string[];
      backgroundColor?: string;
      debuggingMode?: boolean;
      activeProjectEditorId?: string;
      focusRequestId?: number;
      focusedSessionId?: string;
      sleepingSessionIds?: string[];
      /**
       * CDXC:NativeGpu 2026-05-08-16:45
       * Metadata-only native syncs update pane chrome without forcing AppKit
       * to reframe terminal/browser surfaces.
       */
      layoutChanged?: boolean;
      layout?: NativeTerminalLayout;
      paneGap?: number;
      poppedOutSessionIds?: string[];
      sessionFaviconDataUrls?: Record<string, string>;
      sessionAgentIconDataUrls?: Record<string, string>;
      sessionAgentIconColors?: Record<string, string>;
      sessionActivities?: Record<string, "attention" | "sleeping" | "working">;
	      sessionTitleBarActions?: Record<string, NativeTerminalTitleBarAction[]>;
	      sessionTitles?: Record<string, string>;
	      petOverlayEnabled?: boolean;
	      showProjectEditorDiffFileCount?: boolean;
	      sidebarActions?: {
	        commands: SidebarCommandButton[];
	      };
      titlebarResourceGroups?: TitlebarResourceGroup[];
	      type: "setActiveTerminalSet";
	      workspaceOpenTargets?: {
	        availability: ghostexSettings["workspaceOpenTargetAvailability"];
	        customTargets: CustomWorkspaceOpenTarget[];
	        hiddenTargetIds: string[];
	      };
	    }
  | {
      /**
       * CDXC:SessionStatusIndicators 2026-05-05-19:47
       * The AppKit floating circles receive only aggregate counts. Sidebar
       * state remains authoritative for which session should be opened when a
       * circle is clicked, avoiding duplicate native-side session selection.
       */
      attentionCount: number;
      availableCount: number;
      /**
       * CDXC:SessionStatusIndicators 2026-05-09-17:30
       * Floating and menu bar indicator visibility are independent settings:
       * floating badges are hidden by default, menu bar badges are shown by
       * default, and both surfaces still share one count and click target model.
       */
      hideFloatingIndicators: boolean;
      hideMenuBarIndicators: boolean;
      workingCount: number;
      /**
       * CDXC:SessionStatusIndicators 2026-05-07-18:20
       * The native AppKit indicator receives the persisted named size with the
       * counts message so each sidebar publish resizes the floating chrome from
       * the same authoritative settings snapshot.
       */
      size: ghostexSettings["sessionStatusIndicatorSize"];
      type: "setSessionStatusIndicators";
    }
  | {
      activities: NativePetOverlayActivity[];
      enabled: boolean;
      selectedPetId: ghostexSettings["selectedPetId"];
      type: "setPetOverlayState";
    }
  | { layout?: NativeTerminalLayout; type: "setTerminalLayout" }
  | { sessionId: string; type: "setTerminalVisibility"; visible: boolean }
  | { type: "pickWorkspaceFolder" }
  | { projectId: string; type: "pickWorkspaceIcon" }
  | { type: "showMessage"; level: "info" | "warning" | "error"; message: string }
  | { details?: string; event: string; type: "appendAgentDetectionDebugLog" }
  | { details?: string; event: string; force?: boolean; type: "appendTerminalFocusDebugLog" }
  | { details?: string; event: string; type: "appendRestoreDebugLog" }
  | { details?: string; event: string; force?: boolean; type: "appendSessionTitleDebugLog" }
  | { details?: string; event: string; type: "appendSidebarRefreshDebugLog" }
  | { details?: string; event: string; type: "appendWorkspaceDockIndicatorDebugLog" }
  | {
      key: "previousSessions" | "projects" | "settings";
      payloadJson: string;
      type: "persistSharedSidebarStorage";
    }
  | { fileName: string; type: "playSound"; volume?: number }
  | {
      body?: string;
      iconDataUrl?: string;
      sessionId: string;
      title: string;
      type: "showSessionAttentionNotification";
    }
  | {
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
      executable: string;
      requestId: string;
      type: "runProcess";
    }
  | {
      adjustCellHeightPercent: number;
      adjustCellWidth: number;
      fontFamily: string;
      fontSize: number;
      fontVariationWeight: number | null;
      clipboardPasteProtection: boolean;
      clipboardTrimTrailingSpaces: boolean;
      confirmCloseSurface: string;
      copyOnSelect: string;
      cursorStyleBlink: boolean;
      ghosttyTheme: string;
      mouseHideWhileTyping: boolean;
      mouseScrollMultiplierDiscrete: number;
      mouseScrollMultiplierPrecision: number;
      reloadImmediately?: boolean;
      scrollbackLimitBytes: number;
      scrollbar: string;
      type: "syncGhosttyTerminalSettings";
    }
  | {
      lines: string[];
      managedKeys: string[];
      reloadImmediately?: boolean;
      type: "applyGhosttyConfigSettings";
    }
  | { type: "openGhosttyConfigFile" }
  | { type: "openAccessibilityPreferences" }
  | { type: "requestMacOSNotificationPermission" }
  | { type: "openMacOSNotificationSettings" }
  | { type: "openExternalUrl"; url: string }
  | { type: "openWorkspaceInFinder"; workspacePath: string }
  | {
      targetApp: ZedOverlayTargetApp;
      type: "openWorkspaceInIde";
      workspacePath: string;
    }
  | { type: "openBrowserWindow"; url: string }
  | { type: "showBrowserWindow" }
  | { sessionId: string; type: "openBrowserDevTools" }
  | { sessionId: string; type: "injectBrowserReactGrab" }
  | { sessionId: string; type: "showBrowserProfilePicker" }
  | { sessionId: string; type: "showBrowserImportSettings" }
  | { side: SidebarSide; type: "setSidebarSide" }
  | {
      /**
       * CDXC:ReactTitlebar 2026-05-09-17:11
       * React titlebar hosts report DOM hit regions to native so AppKit can
       * keep blank chrome draggable and let future dropdown surfaces receive
       * real pointer events inside the workspace overlay.
       */
      regions: Array<{ height: number; width: number; x: number; y: number }>;
      type: "setReactTitlebarHitRegions";
    }
  | {
      enabled: boolean;
      hideTitlebarButton: boolean;
      reason?: "settings-enable" | "settings-save" | "startup" | "workspace-focus";
      targetApp: ZedOverlayTargetApp;
      type: "configureZedOverlay";
      workspacePath: string;
    }
  | {
      targetApp: ZedOverlayTargetApp;
      type: "openZedWorkspace";
      workspacePath: string;
    };

type NativeSetActiveTerminalSetCommand = Extract<
  NativeHostCommand,
  { type: "setActiveTerminalSet" }
>;

export type WorkspaceBarProject = {
  icon?: WorkspaceDockIcon;
  iconDataUrl?: string;
  isActive: boolean;
  isChat?: boolean;
  path: string;
  projectId: string;
  /**
   * CDXC:WorkspaceDock 2026-04-27-06:19
   * The native workspace rail must split session-card state into three badges:
   * idle running sessions are gray, working sessions are orange, and completed
   * sessions are green. Use "working" instead of "active" because "active"
   * already means selected/current workspace, group, session, or modal.
   */
  sessionCounts: {
    done: number;
    running: number;
    working: number;
  };
  theme?: SidebarTheme;
  themeColor?: string;
  title: string;
};

export type WorkspaceBarStateMessage = {
  activeProjectId: string;
  projects: WorkspaceBarProject[];
  type: "workspaceBarState";
};

type NativeTerminalLayout =
  | { kind: "leaf"; sessionId: string }
  | { activeSessionId?: string; kind: "tabs"; sessionIds: string[] }
  | {
      children: NativeTerminalLayout[];
      direction: "horizontal" | "vertical";
      kind: "split";
      ratio?: number;
    };

type NativeSplitLayoutHint = {
  direction: "horizontal" | "vertical";
  nextSessionId: string;
  projectId: string;
  targetSessionId: string;
};

type NativeResolvedSplitLayoutHint = Omit<NativeSplitLayoutHint, "projectId">;
type NativePaneTabCloseScope = "close" | "closeLeft" | "closeOthers" | "closeRight";
type NativePaneTabSleepScope = "sleep" | "sleepLeft" | "sleepOthers" | "sleepRight";

type NativeHostEvent =
  | {
      foregroundPid?: number;
      sessionId: string;
      sessionPersistenceName?: string;
      ttyName?: string;
      type: "terminalReady";
    }
  | {
      sessionId: string;
      sessionPersistenceName?: string;
      title: string;
      type: "terminalTitleChanged";
    }
  | { faviconDataUrl?: string; sessionId: string; type: "browserFaviconChanged" }
  | { sessionId: string; type: "browserUrlChanged"; url: string }
  | {
      action: NativeTerminalTitleBarAction;
      sessionId: string;
      type: "terminalTitleBarAction";
    }
  | {
      placement?: SessionPaneDropPlacement;
      sourceSessionId: string;
      targetSessionId: string;
      type: "paneReorderRequested";
    }
  | { sessionId: string; type: "paneTabSelected" }
  | { scope: NativePaneTabCloseScope; sessionId: string; type: "paneTabCloseRequested" }
  | { scope: NativePaneTabSleepScope; sessionId: string; type: "paneTabSleepRequested" }
  | {
      position: SessionPaneTabReorderPosition;
      sourceSessionId: string;
      targetSessionId: string;
      type: "paneTabReorderRequested";
    }
  | { cwd: string; sessionId: string; type: "terminalCwdChanged" }
  | { exitCode?: number; sessionId: string; type: "terminalExited" }
  | { sessionId: string; type: "terminalFocused" }
  | { sessionId: string; type: "terminalBell" }
  | { heightRatio: number; type: "commandsPanelHeightRatioChanged" }
  | { message: string; sessionId: string; type: "terminalError" }
  | {
      message?: string;
      projectId: string;
      status: Exclude<ProjectEditorLoadStatus, "idle">;
      type: "projectEditorLoadState";
    }
  | {
      projectId: string;
      type: "projectEditorTabSelected";
      url?: string;
    }
  | {
      projectId: string;
      type: "projectEditorBackRequested";
    }
  | {
      hidden: boolean;
      projectId: string;
      type: "projectEditorCompanionPaneHiddenChanged";
    }
  | { status: NativeSessionStatusIndicatorStatus; type: "sessionStatusIndicatorClicked" }
  | { projectId: string; sessionId: string; type: "petOverlayActivityClicked" }
  | { sessionId: string; type: "sessionAttentionNotificationClicked" }
  | {
      projectId: string;
      serverOrigin: string;
      sessionId: string;
      threadId: string;
      type: "t3ThreadReady";
      workspaceRoot: string;
    }
  | { sessionId: string; threadId: string; title?: string; type: "t3ThreadChanged" }
  | { exitCode: number; requestId: string; stderr: string; stdout: string; type: "processResult" }
  | { actionId: ghostexHotkeyActionId; type: "nativeHotkey" }
  | { protocolVersion: 1; type: "hostReady" };

type NativeProcessResult = Extract<NativeHostEvent, { type: "processResult" }>;

type NativeBootstrap = {
  accessibilityPermissionGranted?: boolean;
  cwd?: string;
  homeDir?: string;
  sharedSidebarStorage?: {
    previousSessions?: string;
    projects?: string;
    settings?: string;
  };
  ghostexHomeDir?: string;
  workspaceName?: string;
  zedOverlayEnabled?: boolean;
  zedOverlayHideTitlebarButton?: boolean;
  zedOverlayTargetApp?: ZedOverlayTargetApp;
};

declare global {
  interface Window {
    __ghostex_NATIVE_HOST__?: NativeBootstrap;
    webkit?: {
      messageHandlers?: {
        ghostexAppModalHost?: {
          postMessage: (message: unknown) => void;
        };
        ghostexNativeHost?: {
          postMessage: (message: unknown) => void;
        };
        ghostexWorkspaceBar?: {
          postMessage: (message: unknown) => void;
        };
        ghostexNativeHostDiagnostics?: {
          postMessage: (message: unknown) => void;
        };
      };
    };
    __ghostex_NATIVE_WORKSPACE_BAR__?: {
      addProject: (path: string, name?: string) => void;
      focusProject: (projectId: string) => void;
      getState: () => WorkspaceBarStateMessage;
      removeProject: (projectId: string) => void;
      reorderProjects: (projectIds: string[]) => void;
      setProjectIcon: (projectId: string, iconDataUrl: string | undefined) => void;
      setProjectTheme: (projectId: string, theme: SidebarTheme) => void;
      setProjectThemeColor: (projectId: string, themeColor: string) => void;
    };
	    __ghostex_NATIVE_SETTINGS__?: {
	      attachZedOverlay: (targetApp: ZedOverlayTargetApp) => void;
	      detachZedOverlay: (targetApp: ZedOverlayTargetApp) => void;
	    };
    __ghostex_NATIVE_SIDEBAR__?: {
      openActiveProjectEditorFromTitlebar: () => void;
      openAgentsModeFromTitlebar: () => void;
      openGitHubProjectFromTitlebar: () => void;
      showProjectEditorCompanionFromTitlebar: () => void;
      sleepInactiveSessionsFromTitlebar: (sessionIds: string[]) => void;
      openTasksPlaceholderFromTitlebar: () => void;
      refreshWorkspaceOpenTargetAvailabilityFromTitlebar: () => void;
      rotateActivePaneLayoutClockwiseFromTitlebar: () => void;
      togglePetOverlayFromTitlebar: () => void;
      toggleCommandsPanelFromTitlebar: () => void;
      runSidebarCommandFromTitlebar: (commandId: string) => void;
    };
    __ghostex_NATIVE_CLI__?: {
      handleCommand: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
    };
    __ghostex_NATIVE_MODAL_BRIDGE__?: {
      handleSidebarMessage: (message: SidebarToExtensionMessage) => void;
    };
    __ghostex_NATIVE_HOTKEYS__?: {
      handleNativeHotkey: (actionId: ghostexHotkeyActionId) => void;
    };
  }
}

class SurfaceMessageBus<T> {
  private readonly target = new EventTarget();

  public addEventListener(type: "message", listener: EventListenerOrEventListenerObject): void {
    this.target.addEventListener(type, listener);
  }

  public removeEventListener(type: "message", listener: EventListenerOrEventListenerObject): void {
    this.target.removeEventListener(type, listener);
  }

  public post(message: T): void {
    this.target.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}

/**
 * CDXC:PublicRelease 2026-04-27-05:36
 * Public source must not expose a maintainer's local checkout path. When the
 * native host does not provide a cwd, seed the demo workspace from HOME.
 */
const initialWorkspacePath = window.__ghostex_NATIVE_HOST__?.cwd || nativeFallbackHomeDirectory();
const initialWorkspaceName = window.__ghostex_NATIVE_HOST__?.workspaceName || "Ghostex";
const SETTINGS_STORAGE_KEY = "ghostex-native-settings";
const AGENTS_STORAGE_KEY = "ghostex-native-agents";
const AGENT_ORDER_STORAGE_KEY = "ghostex-native-agent-order";
const COMMANDS_STORAGE_KEY = "ghostex-native-commands";
const COMMAND_ORDER_STORAGE_KEY = "ghostex-native-command-order";
const DELETED_DEFAULT_COMMANDS_STORAGE_KEY = "ghostex-native-deleted-default-commands";
const PROJECTS_STORAGE_KEY = "ghostex-native-projects";
const SCRATCH_PAD_STORAGE_KEY = "ghostex-native-scratch-pad";
const PINNED_PROMPTS_STORAGE_KEY = "ghostex-native-pinned-prompts";
const COLLAPSED_SECTIONS_STORAGE_KEY = "ghostex-native-collapsed-sections";
const ACTIVE_SESSIONS_SORT_MODE_STORAGE_KEY = "ghostex-native-active-sessions-sort-mode";
const PREVIOUS_SESSIONS_STORAGE_KEY = "ghostex-native-previous-sessions";
const LEGACY_SIDEBAR_SIDE_STORAGE_KEY = "ghostex-native-sidebar-side";
const GIT_PRIMARY_ACTION_STORAGE_KEY = "ghostex-native-git-primary-action";
const GIT_CONFIRM_COMMIT_STORAGE_KEY = "ghostex-native-git-confirm-commit";
const GIT_GENERATE_COMMIT_BODY_STORAGE_KEY = "ghostex-native-git-generate-commit-body";
const TIPS_AND_TRICKS_SEEN_STORAGE_KEY = "ghostex-native-tips-and-tricks-seen";
const WORKSPACE_DOCK_STATE_EVENT = "ghostex-workspace-dock-state";
const CHROME_CANARY_PROCESS_NAME = "Google Chrome Canary";
const CHROME_CANARY_RUNNING_POLL_MS = 2_000;
const CHROME_CANARY_BROWSER_GROUP_ID = "browser-chrome-canary";
const CHROME_CANARY_BROWSER_SESSION_ID = "browser-chrome-canary-window";
const COMBINED_CHATS_GROUP_ID = "combined-chats";
const PLUGINS_BROWSER_CHAT_URL = "https://skills.sh/";
const NATIVE_T3_REMOTE_ACCESS_ORIGIN = "http://127.0.0.1:3774";
const NATIVE_T3_REMOTE_ACCESS_AUTH_ATTEMPTS = 30;
const NATIVE_T3_REMOTE_ACCESS_AUTH_RETRY_MS = 500;
/**
 * CDXC:T3Code 2026-05-04-04:41
 * T3 can emit a thread-change event before the sidebar summary title has caught
 * up. Keep new ghostex T3 cards responsive by creating them immediately, then
 * retry the snapshot-backed title sync a few times so the card title converges
 * to the title visible inside T3.
 */
const NATIVE_T3_TITLE_SYNC_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;
const FIRST_PROMPT_AUTO_RENAME_POLL_MS = 2_000;
const SYNC_OPEN_PROJECT_WITH_ZED_DEBOUNCE_MS = 2_000;
/**
 * CDXC:SessionTitleSync 2026-04-26-09:52
 * Codex needs the staged `/rename <title>` text to settle in the prompt before
 * ghostex submits Enter. A one-second delay matches the requested native behavior;
 * the later native Enter command handles submission separately from text input.
 */
const AUTO_SUBMIT_STAGED_RENAME_DELAY_MS = 1_000;
const DELAYED_SEND_MAX_DELAY_MS = 2_147_483_647;
const NATIVE_INITIAL_ACTIVITY_SUPPRESSION_MS = 7_000;
const NATIVE_MIN_WORKING_DURATION_BEFORE_ATTENTION_MS = 5_000;
/**
 * CDXC:SessionAttention 2026-05-16-23:35:
 * Green attention borders and status dots must remain visible for at least 1.5 seconds after appearing. A click during that floor records the acknowledgement immediately but delays clearing the shared attention state until the minimum visible duration has elapsed.
 */
const NATIVE_MIN_ATTENTION_VISIBLE_MS = 1_500;
const ghostex_AGENT_NOTIFY_HOOK_PATH = `${nativeGhostexHomeDirectory()}/hooks/agent-shell-notify.sh`;
const NATIVE_PI_EXTENSION_PATH = `${nativeHomeDirectory()}/.pi/agent/extensions/ghostex.ts`;
const FIND_PREVIOUS_SESSION_AGENT_ID = "codex";
const FIND_PREVIOUS_SESSION_AGENT_STAGING_DELAY_MS = 1_500;
/**
 * CDXC:WorkspaceDock 2026-04-27-08:48
 * Workspace context-menu themes use the same concrete theme palette names as
 * Settings, excluding Auto because per-workspace selection must persist a
 * deterministic color and apply that theme when the workspace becomes active.
 */
const WORKSPACE_DOCK_THEME_OPTIONS: ReadonlyArray<{ label: string; value: SidebarTheme }> = [
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
/**
 * CDXC:SessionTitleSync 2026-04-26-09:23
 * Native first-prompt title generation must match ghostex's Codex `/rename`
 * path, including the 39-character generated title cap and 250-character
 * prompt sample used before asking Codex for a short session name.
 *
 * CDXC:SessionTooltips 2026-05-15-17:02:
 * Generated titles must not end with ellipses. Cards can truncate visually, but persisted titles and hover tooltips need complete words.
 */
const GENERATED_SESSION_TITLE_MAX_LENGTH = 39;
const GENERATED_SESSION_TITLE_SOURCE_MAX_LENGTH = 250;
let storedAgents: StoredSidebarAgent[] = [];
let storedAgentOrder: string[] = [];
let agents: SidebarAgentButton[] = [];
let storedCommands: StoredSidebarCommand[] = [];
let storedCommandOrder: string[] = [];
let deletedDefaultCommandIds: string[] = [];
let commands: SidebarCommandButton[] = [];
/**
 * CDXC:NativeSidebar 2026-05-06-18:20
 * Settings must initialize before any persisted sidebar chrome state reads from
 * them. Sidebar side moved into settings, so reading the side before this value
 * exists crashes startup and leaves the native shell with a blank sidebar.
 */
let settings = readStoredSettings();
let scratchPadContent = readScratchPadContent();
let pinnedPrompts = readPinnedPrompts();
let collapsedSections = readCollapsedSections();
let activeSessionsSortMode = readActiveSessionsSortMode();
let previousSessions = readPreviousSessions();
let sidebarSide = readSidebarSide();
let gitPrimaryAction = readGitPrimaryAction();
let gitConfirmCommit = readBooleanStorage(GIT_CONFIRM_COMMIT_STORAGE_KEY, false);
let gitGenerateCommitBody = readBooleanStorage(GIT_GENERATE_COMMIT_BODY_STORAGE_KEY, true);
let gitState = createDefaultSidebarGitState(
  gitPrimaryAction,
  gitConfirmCommit,
  gitGenerateCommitBody,
);
/**
 * CDXC:EditorPanes 2026-05-06-14:21
 * Code-server editor panes are project surfaces, not split sessions. Keep
 * their active/sleeping state beside project header diff stats so switching
 * projects preserves each live editor webview without adding it to session
 * ordering.
 * The existing managed-runtime sleep window is five minutes; inactive editor
 * webviews use the same delay before closing their native Chromium surface.
 */
const CODE_SERVER_EDITOR_ORIGIN = "http://127.0.0.1:3775";
const PROJECT_EDITOR_OPEN_TIMEOUT_MS = 10 * 1000;
const PROJECT_EDITOR_SLEEP_TIMEOUT_MS = 5 * 60 * 1000;
const PROJECT_DIFF_UNTRACKED_WC_CHUNK_SIZE = 100;
const projectDiffStatsByProjectId = new Map<string, SidebarProjectDiffStats>();
const pendingProjectDiffRefreshProjectIds = new Set<string>();
let lastNativeLayoutSyncKey: string | undefined;
let lastNativeSetActiveTerminalSetCommandKey: string | undefined;
let lastNativeFocusTraceLayoutFocusedSessionId: string | undefined;
let lastNativeFocusedSidebarSessionId: string | undefined;
let didLogStartupPaneLayoutFirstSync = false;
const lastFocusedWorkspaceTerminalByProjectId = new Map<string, string>();
let lastNativeT3RuntimeSessionStateKey: string | undefined;
let nativeSplitLayoutHint: NativeSplitLayoutHint | undefined;
let lastPersistedProjectsPayloadJson: string | undefined;
const projectEditorSleepTimeoutByProjectId = new Map<string, number>();
const projectEditorOpenTimeoutByProjectId = new Map<string, number>();
const awakeProjectEditorModesByProjectId = new Map<string, Set<ProjectEditorSurfaceMode>>();
const projectEditorSurfaceByProjectId = new Map<
  string,
  {
    errorMessage?: string;
    isOpen: boolean;
    isSleeping: boolean;
    mode: ProjectEditorSurfaceMode;
    nativeEditorId: string;
    status: ProjectEditorLoadStatus;
    title?: string;
    url?: string;
  }
>();
let isChromeCanaryRunning = false;
const pendingProcessResults = new Map<
  string,
  {
    reject: (reason?: unknown) => void;
    resolve: (result: NativeProcessResult) => void;
    timeout: number;
  }
>();
const pendingGitCommitRequests = new Map<
  string,
  { action: SidebarGitAction; body?: string; subject: string }
>();

type NativeProject = {
  commandsPanel: CommandsPanelState;
  icon?: WorkspaceDockIcon;
  iconDataUrl?: string;
  isChat?: boolean;
  isRecentProject?: boolean;
  name: string;
  path: string;
  projectEditorCompanionPaneHidden?: boolean;
  projectEditor?: NativeProjectEditorRestoreState;
  projectId: string;
  recentClosedAt?: string;
  theme?: SidebarTheme;
  themeColor?: string;
  workspace: GroupedSessionWorkspaceSnapshot;
};

type TitlebarResourceGroup = {
  groupId: string;
  isActive: boolean;
  projectId?: string;
  projectName: string;
  projectPath: string;
  sessions: TitlebarResourceSession[];
  title: string;
};

type TitlebarResourceSession = {
  activity: "attention" | "idle" | "working";
  agentIcon?: string;
  isRunning: boolean;
  isSleeping?: boolean;
  lastInteractionAt?: string;
  projectId?: string;
  sessionId: string;
  sessionKind?: "browser" | "terminal" | "t3";
  sessionPersistenceName?: string;
  sessionPersistenceProvider?: TerminalSessionPersistenceProvider;
  terminalTitle?: string;
  title: string;
};

type NativeProjectEditorRestoreState = {
  isOpen: boolean;
};

type NativeCliSessionSelector = {
  index?: number;
  sessionId?: string;
  sessionNumber?: number;
};

type NativeCliSessionListItem = {
  agent?: string;
  alias: number;
  attachCommand?: string;
  groupId: string;
  groupTitle: string;
  isFocused: boolean;
  isVisible: boolean;
  lastInteractionAt: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  provider?: TerminalSessionPersistenceProvider;
  providerSessionName?: string;
  resumeCommand?: string;
  sessionId: string;
  status: "attention" | "done" | "error" | "idle" | "sleep" | "working";
  title: string;
};

type AgentManagerXMuxSource = "ghostex";

type AgentManagerXWorkspaceSession = {
  agent: string;
  alias: string;
  displayName: string;
  isFocused: boolean;
  isRunning: boolean;
  isVisible: boolean;
  kind: "t3" | "terminal";
  lastActiveAt: string;
  projectName?: string;
  projectPath?: string;
  sessionId: string;
  status: "attention" | "idle" | "working";
  terminalTitle?: string;
  threadId?: string;
};

type AgentManagerXWorkspaceSnapshotMessage = {
  sessions: AgentManagerXWorkspaceSession[];
  source: AgentManagerXMuxSource;
  type: "workspaceSnapshot";
  updatedAt: string;
  workspaceFaviconDataUrl?: string;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
};

type AgentManagerXSessionCommandMessage = {
  sessionId: string;
  type: "closeSession" | "focusSession";
  workspaceId: string;
};

const AGENT_MANAGER_X_BRIDGE_URL = "ws://127.0.0.1:47652/ghostex";
const AGENT_MANAGER_X_RECONNECT_INITIAL_DELAY_MS = 1000;
const AGENT_MANAGER_X_RECONNECT_MAX_DELAY_MS = 5000;

class AgentManagerXNativeBridgeClient {
  private latestSnapshotJsonByWorkspaceId = new Map<string, string>();
  private reconnectDelayMs = AGENT_MANAGER_X_RECONNECT_INITIAL_DELAY_MS;
  private reconnectTimer: number | undefined;
  private socket: WebSocket | undefined;

  publish(snapshots: readonly AgentManagerXWorkspaceSnapshotMessage[]): void {
    const nextWorkspaceIds = new Set<string>();
    for (const snapshot of snapshots) {
      nextWorkspaceIds.add(snapshot.workspaceId);
      this.latestSnapshotJsonByWorkspaceId.set(snapshot.workspaceId, JSON.stringify(snapshot));
    }
    for (const workspaceId of Array.from(this.latestSnapshotJsonByWorkspaceId.keys())) {
      if (!nextWorkspaceIds.has(workspaceId)) {
        this.latestSnapshotJsonByWorkspaceId.delete(workspaceId);
      }
    }
    this.ensureConnected();
    this.flush();
  }

  private ensureConnected(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      return;
    }
    if (this.reconnectTimer !== undefined) {
      return;
    }

    try {
      const socket = new WebSocket(AGENT_MANAGER_X_BRIDGE_URL);
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.reconnectDelayMs = AGENT_MANAGER_X_RECONNECT_INITIAL_DELAY_MS;
        this.flush();
      });
      socket.addEventListener("message", (event) => {
        handleAgentManagerXSessionCommand(event.data);
      });
      socket.addEventListener("close", () => {
        if (this.socket === socket) {
          this.socket = undefined;
        }
        this.scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        socket.close();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private flush(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    for (const snapshotJson of this.latestSnapshotJsonByWorkspaceId.values()) {
      this.socket.send(snapshotJson);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) {
      return;
    }
    const delayMs = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      AGENT_MANAGER_X_RECONNECT_MAX_DELAY_MS,
      this.reconnectDelayMs * 2,
    );
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureConnected();
    }, delayMs);
  }
}

const restoredProjectState = readStoredProjects();
let projects: NativeProject[] = restoredProjectState.projects;
let activeProjectId = restoredProjectState.activeProjectId;
let revision = 0;
let nextNativeLayoutFocusRequestId = 0;
let pendingNativeLayoutFocusRequest:
  | { reason: string; requestId: number; sessionId: string }
  | undefined;
let sidebarCardFocusTraceSequence = 0;
let latestSidebarCardFocusTrace:
  | { details?: unknown; nativeReceivedAt: number; requestId: number; sessionId?: string }
  | undefined;
let pendingZedProjectSyncTimeout: number | undefined;
const sidebarBus = new SurfaceMessageBus<ExtensionToSidebarMessage>();
const terminalStateById = new Map<
  string,
  {
    activity: "attention" | "idle" | "working";
    agentName?: string;
    agentSessionId?: string;
    agentSessionPath?: string;
    firstPromptAutoRenameInProgress?: boolean;
    firstPromptAutoRenameLastLogKey?: string;
    firstPromptAutoRenameProcessedPrompt?: string;
    firstUserMessage?: string;
    lastActivityAt?: string;
    lifecycleState: "done" | "error" | "running" | "sleeping";
    protectStoredTitleFromAutomation?: boolean;
    sessionPersistenceName?: string;
    sessionPersistenceProvider?: TerminalSessionPersistenceProvider;
    sessionStateFilePath?: string;
    terminalTitle?: string;
  }
>();
const titleDerivedActivityBySessionId = new Map<string, TitleDerivedSessionActivity>();
const nativeActivitySuppressedUntilBySessionId = new Map<string, number>();
const nativeWorkingStartedAtBySessionId = new Map<string, number>();
const nativeAttentionEnteredAtBySessionId = new Map<string, number>();
const nativeAttentionAcknowledgementTimeoutBySessionId = new Map<string, number>();
/**
 * CDXC:SessionAttentionNotifications 2026-05-10-16:46
 * Notification rate limits live next to the sidebar activity source of truth:
 * one banner per session every 20 seconds, plus a global cap of eight banners
 * per minute, prevents repeated bell/title churn from spamming macOS.
 */
const NATIVE_ATTENTION_NOTIFICATION_SESSION_COOLDOWN_MS = 20_000;
const NATIVE_ATTENTION_NOTIFICATION_GLOBAL_WINDOW_MS = 60_000;
const NATIVE_ATTENTION_NOTIFICATION_GLOBAL_LIMIT = 8;
const SIDEBAR_CARD_FOCUS_TRACE_WINDOW_MS = 5_000;
const nativeAttentionNotificationLastSentAtBySessionId = new Map<string, number>();
let nativeAttentionNotificationWindowStartedAt = 0;
let nativeAttentionNotificationWindowCount = 0;
const delayedSendTimeoutBySessionId = new Map<string, number>();
type NativeSidebarCommandSession = {
  closeOnExit: boolean;
  commandId: string;
  commandTitle: string;
  playCompletionSound: boolean;
  runId?: string;
  sessionId: string;
};
/**
 * CDXC:Actions 2026-04-28-02:54
 * Native action buttons keep the same command-to-terminal association as the
 * reference sidebar so background runs can show indicators, spinners, and
 * close-on-exit completion state without appearing as normal session cards.
 */
const sidebarCommandSessionByCommandId = new Map<string, NativeSidebarCommandSession>();
const sidebarCommandCommandIdBySessionId = new Map<string, string>();
/**
 * CDXC:NativeTerminals 2026-04-26-06:45
 * Sidebar workspace snapshots normalize terminal ids back to canonical display
 * ids such as session-00. Native Ghostty surfaces use project-scoped ids, so
 * every native command/layout must translate at the bridge boundary.
 */
const nativeSessionIdBySidebarSessionId = new Map<string, string>();
const sidebarSessionIdByNativeSessionId = new Map<string, string>();
const nativeT3ThreadChangeInFlightBySessionId = new Set<string>();
/**
 * CDXC:AgentManagerXBridge 2026-04-27-20:34
 * Agent Manager X reads live mux sessions from a localhost WebSocket. The
 * packaged ghostex app owns native sidebar state, so it must publish snapshots
 * directly instead of relying on the VS Code extension bridge path.
 */
const agentManagerXBridgeClient = new AgentManagerXNativeBridgeClient();

/**
 * CDXC:NativeTerminals 2026-04-28-12:06
 * Persistent helper mode was removed, but native terminal ids still need to be
 * project-scoped so sidebar commands, layouts, and focus events never collide
 * across workspaces during one embedded-host app session.
 */
function createDurableNativeSessionId(projectId: string, sidebarSessionId: string): string {
  return `${projectId}:${sidebarSessionId}`;
}

function rememberNativeSessionMapping(projectId: string, sidebarSessionId: string): string {
  const nativeSessionId = createDurableNativeSessionId(projectId, sidebarSessionId);
  nativeSessionIdBySidebarSessionId.set(sidebarSessionId, nativeSessionId);
  sidebarSessionIdByNativeSessionId.set(nativeSessionId, sidebarSessionId);
  return nativeSessionId;
}

/**
 * CDXC:NativeSidebar 2026-04-26-00:47
 * The native app reuses the web sidebar UI, but it owns state locally instead
 * of depending on the old extension backend. Every sidebar command must either
 * perform native behavior or give explicit native feedback so controls never
 * fail silently.
 */
const vscode = {
  postMessage(message: SidebarToExtensionMessage) {
    handleSidebarMessage(message);
  },
};

window.__ghostex_NATIVE_MODAL_BRIDGE__ = {
  handleSidebarMessage(message) {
    handleSidebarMessage(message);
  },
};

window.__ghostex_NATIVE_HOTKEYS__ = {
  handleNativeHotkey(actionId) {
    logNativeHotkeyDebug("nativeHotkeys.bridgeActionReceived", { actionId });
    runNativeHotkeyAction(actionId, "native");
  },
};

let pendingHotkeyPrefix: string | undefined;

document.addEventListener(
  "keydown",
  (event) => {
    const hotkeyText = keyboardEventToNativeHotkeyText(event);
    const isCandidate = isNativeHotkeyCandidate(event, hotkeyText);
    if (isNativeCommandArrowHotkey(event, hotkeyText)) {
      /*
       * CDXC:Hotkeys 2026-05-15-12:50:
       * Command+Left and Command+Right are currently suspected of corrupting native pane-tab grouping.
       * Persist a DOM-side breadcrumb before any behavior change so the reproduction can show whether WebKit or AppKit owned the shortcut.
       */
      logNativeHotkeyDebug("nativeHotkeys.commandArrowDomKeyDown", {
        defaultPrevented: event.defaultPrevented,
        hotkeyText,
        target: describeNativeHotkeyTarget(event.target),
      });
    }
    if (event.defaultPrevented || isNativeHotkeyEditableTarget(event.target)) {
      if (isCandidate) {
        logNativeHotkeyDebug("nativeHotkeys.domKeyIgnored", {
          defaultPrevented: event.defaultPrevented,
          hotkeyText,
          target: describeNativeHotkeyTarget(event.target),
        });
      }
      return;
    }
    const actionId = getMatchingNativeHotkeyActionId(hotkeyText, Date.now(), "dom");
    if (!actionId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    runNativeHotkeyAction(actionId, "dom");
  },
  true,
);

/**
 * CDXC:Hotkeys 2026-04-28-05:36
 * Hotkey failures need boundary diagnostics because shortcuts can be swallowed
 * by AppKit, Ghostty, editable DOM targets, or the action resolver. Log only
 * modifier/prefix candidates so normal typing does not flood native logs.
 */
function logNativeHotkeyDebug(event: string, details: Record<string, unknown>): void {
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  console.debug("[ghostex-native-hotkeys]", event, details);
  appendTerminalFocusDebugLog(event, details);
}

function recordSidebarCardFocusTrace(details: unknown): void {
  const requestId = ++sidebarCardFocusTraceSequence;
  latestSidebarCardFocusTrace = {
    details,
    nativeReceivedAt: Date.now(),
    requestId,
    sessionId: readUnknownRecordString(details, "sessionId"),
  };
  /**
   * CDXC:SidebarSessionFocus 2026-05-15-20:01:
   * Session-card focus repros need a persistent bridge boundary even when the
   * Debugging Mode toggle was not enabled before the bad click. Force only this
   * low-volume card-click breadcrumb so later native paneLayout logs can be
   * correlated to the exact sidebar card, group, pointer position, and local
   * focus decision that initiated the focus request.
   */
  appendTerminalFocusDebugLog(
    "nativeFocusTrace.sidebarCardFocusRequested",
    {
      details,
      requestId,
      sessionId: latestSidebarCardFocusTrace.sessionId,
    },
    { force: true },
  );
}

function getRecentSidebarCardFocusTrace(
  sessionId: string | undefined,
):
  | { details?: unknown; nativeReceivedAt: number; requestId: number; sessionId?: string }
  | undefined {
  if (!latestSidebarCardFocusTrace) {
    return undefined;
  }
  if (Date.now() - latestSidebarCardFocusTrace.nativeReceivedAt > SIDEBAR_CARD_FOCUS_TRACE_WINDOW_MS) {
    return undefined;
  }
  if (
    sessionId &&
    latestSidebarCardFocusTrace.sessionId &&
    latestSidebarCardFocusTrace.sessionId !== sessionId
  ) {
    return undefined;
  }
  return latestSidebarCardFocusTrace;
}

function summarizeSidebarCardFocusTrace(
  trace:
    | { details?: unknown; nativeReceivedAt: number; requestId: number; sessionId?: string }
    | undefined,
): Record<string, unknown> | undefined {
  if (!trace) {
    return undefined;
  }
  return {
    ageMs: Date.now() - trace.nativeReceivedAt,
    details: trace.details,
    requestId: trace.requestId,
    sessionId: trace.sessionId,
  };
}

function readUnknownRecordString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record[key] === "string" ? record[key] : undefined;
}

function postNative(command: NativeHostCommand): void {
  if (isTerminalFocusDebugCommand(command)) {
    const snapshot = getTerminalFocusDebugSnapshot();
    const sidebarCardFocusTrace = getRecentSidebarCardFocusTrace(
      getNativeFocusCommandSidebarSessionId(command),
    );
    /**
     * CDXC:NativeTerminalStartupFocus 2026-05-11-12:31
     * Startup focus drift can depend on command ordering across create,
     * layout, and explicit focus messages. Persist the actual native command
     * boundary under the focus-trace allowlist while Debugging Mode is enabled
     * so a repro minute shows which pane the sidebar asked native to focus.
     */
    appendTerminalFocusDebugLog("nativeFocusTrace.sidebarPostNativeFocusCommand", {
      command: summarizeNativeFocusCommand(command),
      focusedSessionId: snapshot?.focusedSessionId,
      sidebarCardFocusTrace: summarizeSidebarCardFocusTrace(sidebarCardFocusTrace),
      visibleSessionIds: snapshot?.visibleSessionIds,
    }, { force: sidebarCardFocusTrace !== undefined });
    appendTerminalFocusDebugLog("nativeSidebar.postNative", {
      command: summarizeNativeFocusCommand(command),
      focusedSessionId: snapshot?.focusedSessionId,
      sidebarCardFocusTrace: summarizeSidebarCardFocusTrace(sidebarCardFocusTrace),
      visibleSessionIds: snapshot?.visibleSessionIds,
    }, { force: sidebarCardFocusTrace !== undefined });
  }
  window.webkit?.messageHandlers?.ghostexNativeHost?.postMessage(command);
}

function postAppModalHost(message: unknown): void {
  postAppModalHostMessage(message, "AppModals:sidebarState");
}

function showNativeMessage(level: "info" | "warning" | "error", message: string): void {
  postNative({ level, message, type: "showMessage" });
}

function postGhostexFolderStats(message: SidebarGhostexFolderStatsMessage): void {
  sidebarBus.post(message);
  postAppModalHost({ message, type: "sidebarState" });
}

function appendSessionTitleDebugLog(event: string, details?: unknown): void {
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  if (!shouldPersistNativeSidebarDiagnostic(event)) {
    return;
  }
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    type: "appendSessionTitleDebugLog",
  });
}

function appendSessionTitleGenerationErrorLog(event: string, details?: unknown): void {
  /**
   * CDXC:SessionTitleSync 2026-05-08-09:09
   * Codex title-generation failures are user-facing workflow failures even when
   * debug UI is disabled. Persist them to the session-title log without showing
   * native alerts so rename and first-prompt title timeouts remain diagnosable.
   */
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    force: true,
    type: "appendSessionTitleDebugLog",
  });
}

function appendSessionTitleRenameTraceDebugLog(event: string, details?: unknown): void {
  /**
   * CDXC:SidebarRenameDiagnostics 2026-05-16-07:23:
   * Manual rename breadcrumbs are regular diagnostics, even when they help
   * explain a failed repro. Persist them only while Settings Debugging Mode is
   * enabled so normal rename use does not write non-error logs.
   */
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    type: "appendSessionTitleDebugLog",
  });
}

function appendAgentDetectionDebugLog(event: string, details?: unknown): void {
  /**
   * CDXC:AgentDetection 2026-05-08-16:41
   * Native diagnostics should preserve actionable failures, not routine
   * activity/title/projection churn. Keep normal debug logs behind the settings
   * switch and drop non-error events before they cross the WebKit bridge so
   * long-running sidebar sessions cannot create multi-GB app logs.
   */
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  if (!shouldPersistNativeSidebarDiagnostic(event)) {
    return;
  }
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    type: "appendAgentDetectionDebugLog",
  });
}

function appendTerminalFocusDebugLog(
  event: string,
  details?: unknown,
  options: { force?: boolean } = {},
): void {
  /**
   * CDXC:NativeTerminalFocus 2026-05-08-16:41
   * Focus diagnostics are useful only around failures or unusual boundaries.
   * Routine key, focus, and layout events are too frequent for persistent logs,
   * so only important diagnostic events are posted to native.
   *
   * CDXC:PaneLayoutDiagnostics 2026-05-11-12:19
   * User-reproduced tab creation bugs need low-volume paneLayout traces while
   * Debugging Mode is enabled. Forced entries may bypass the noisy-event filter
   * for a focused repro, but they still respect the app-wide debug-mode gate.
   */
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  if (!options.force && !shouldPersistNativeSidebarDiagnostic(event)) {
    return;
  }
  window.webkit?.messageHandlers?.ghostexNativeHost?.postMessage({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    ...(options.force ? { force: true } : {}),
    type: "appendTerminalFocusDebugLog",
  });
}

function appendActionCrashTraceDebugLog(event: string, details?: unknown): void {
  /**
   * CDXC:TitlebarActions 2026-05-15-17:23:
   * User-reproduced crashes from titlebar terminal action buttons need
   * breadcrumbs even when Debugging Mode is off, because the app can exit before
   * the normal filtered diagnostics flush. Keep this helper action-scoped and
   * low-volume so post-repro logs show command lookup, command-pane reuse or
   * creation, and write/submit boundaries without enabling noisy focus traces.
   */
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    type: "appendTerminalFocusDebugLog",
  });
}

function appendTitlebarCodeLagDebugLog(event: string, details?: unknown): void {
  /**
   * CDXC:ModeSwitcher 2026-05-16-07:23:
   * Reproducing titlebar Code-tab lag is regular diagnostics, not error
   * logging. Keep this breadcrumb chain behind Settings Debugging Mode and
   * include monotonic performance timestamps only when the user is reproducing
   * with diagnostics enabled.
   */
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  postNative({
    details: safeSerializeForNativeLog({
      details,
      performanceNowMs: performance.now(),
      wallTimeMs: Date.now(),
    }),
    event,
    type: "appendSessionTitleDebugLog",
  });
}

function appendTerminalLaunchDebugLog(event: string, details?: unknown): void {
  /**
   * CDXC:CrashDiagnostics 2026-05-04-09:10
   * Rapid agent-button clicks can crash during terminal creation. Persist the
   * sidebar launch order before native Ghostty receives each create/focus/layout
   * command so the failing boundary is visible after the process exits.
   */
  appendTerminalFocusDebugLog(event, details);
}

const AGENT_COLOR_ENVIRONMENT_KEYS = [
  "ANSI_COLORS_DISABLED",
  "CI",
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "COLORTERM",
  "FORCE_COLOR",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
] as const;

function readAgentColorEnvironmentSnapshot(
  environment: Record<string, string | undefined>,
): Record<string, string | null> {
  /**
   * CDXC:AgentCliColorDiagnostics 2026-05-04-15:39
   * Native Ghostty receives a session env overlay from the sidebar before the
   * agent wrapper starts. Log color-affecting keys here so restored and newly
   * opened agent terminals can be compared against the wrapper's inherited env.
   */
  return Object.fromEntries(
    AGENT_COLOR_ENVIRONMENT_KEYS.map((key) => [key, environment[key] ?? null]),
  ) as Record<string, string | null>;
}

function appendRestoreDebugLog(event: string, details?: unknown): void {
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  if (!shouldPersistNativeSidebarDiagnostic(event)) {
    return;
  }
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    type: "appendRestoreDebugLog",
  });
}

function appendSidebarRefreshDebugLog(event: string, details?: unknown): void {
  /**
   * CDXC:SidebarRefreshDiagnostics 2026-05-11-12:32
   * User repros for unexpected sidebar refreshes need a dedicated native log
   * file keyed to the Settings debugging switch. Persist only explicit React
   * lifecycle, hydrate, publish, and requested create/close boundaries so the
   * log shows whether the sidebar remounted or merely received a new snapshot.
   */
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    type: "appendSidebarRefreshDebugLog",
  });
}

function appendWorkspaceDockIndicatorDebugLog(event: string, details?: unknown): void {
  if (!isNativeSidebarDebugLoggingEnabled()) {
    return;
  }
  if (!shouldPersistNativeSidebarDiagnostic(event)) {
    return;
  }
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event,
    type: "appendWorkspaceDockIndicatorDebugLog",
  });
}

function shouldPersistNativeSidebarDiagnostic(event: string): boolean {
  const normalizedEvent = event.toLowerCase();
  return (
    normalizedEvent.startsWith("nativefocustrace.") ||
    normalizedEvent.startsWith("nativehotkeys.commandarrow") ||
    normalizedEvent.startsWith("nativepanelayouttrace.") ||
    normalizedEvent.includes("fail") ||
    normalizedEvent.includes("error") ||
    normalizedEvent.includes("invalid") ||
    normalizedEvent.includes("missing") ||
    normalizedEvent.includes("timeout") ||
    normalizedEvent.includes("exhausted") ||
    normalizedEvent.includes("crash") ||
    normalizedEvent.includes("unhealthy") ||
    normalizedEvent.includes("portbusy")
  );
}

function isNativeSidebarDebugLoggingEnabled(): boolean {
  /**
   * CDXC:Diagnostics 2026-05-16-07:23:
   * Regular non-error logging from the native sidebar, titlebar, and bridge
   * should be silent unless Settings Debugging Mode is enabled. Error and crash
   * logging paths stay separate so failures remain diagnosable in normal mode.
   */
  return settings.debuggingMode;
}

function isTerminalFocusDebugCommand(command: NativeHostCommand): boolean {
  return (
    command.type === "createTerminal" ||
    command.type === "createWebPane" ||
    command.type === "focusTerminal" ||
    command.type === "focusWebPane" ||
    command.type === "sendTerminalEnter" ||
    command.type === "setActiveTerminalSet" ||
    command.type === "setTerminalLayout" ||
    command.type === "setTerminalVisibility" ||
    command.type === "writeTerminalText"
  );
}

function summarizeNativeFocusCommand(command: NativeHostCommand): Record<string, unknown> {
  return {
    activeSessionIds: "activeSessionIds" in command ? command.activeSessionIds : undefined,
    backgroundColor: "backgroundColor" in command ? command.backgroundColor : undefined,
    focusRequestId: "focusRequestId" in command ? command.focusRequestId : undefined,
    focusedSessionId: "focusedSessionId" in command ? command.focusedSessionId : undefined,
    hasInitialInput: "initialInput" in command ? Boolean(command.initialInput) : undefined,
    layoutLeafSessionIds:
      "layout" in command ? summarizeNativeLayoutLeafSessionIds(command.layout) : undefined,
    paneGap: "paneGap" in command ? command.paneGap : undefined,
    sessionId: "sessionId" in command ? command.sessionId : undefined,
    textLength: "text" in command ? command.text.length : undefined,
    textPreview: "text" in command ? summarizeTerminalText(command.text) : undefined,
    title: "title" in command ? command.title : undefined,
    type: command.type,
    visible: "visible" in command ? command.visible : undefined,
  };
}

function getNativeFocusCommandSidebarSessionId(command: NativeHostCommand): string | undefined {
  if ("sessionId" in command && typeof command.sessionId === "string") {
    return sidebarSessionIdForNativeSession(command.sessionId);
  }
  if (command.type === "setActiveTerminalSet" && typeof command.focusedSessionId === "string") {
    return sidebarSessionIdForNativeSession(command.focusedSessionId);
  }
  return undefined;
}

function queueNativeLayoutFocusRequest(sessionId: string, reason: string): void {
  const sidebarCardFocusTrace = getRecentSidebarCardFocusTrace(sessionId);
  pendingNativeLayoutFocusRequest = {
    reason,
    requestId: ++nextNativeLayoutFocusRequestId,
    sessionId,
  };
  /**
   * CDXC:NativeTerminalFocus 2026-05-09-15:30
   * User-reproduced active-border misses need the explicit sidebar focus
   * request id before layout sync consumes it. Persist only request creation
   * breadcrumbs so click-driven focus can be matched to the native AppKit log.
   */
  appendTerminalFocusDebugLog("nativeFocusTrace.sidebarFocusRequestQueued", {
    activeProjectId,
    reason,
    requestId: pendingNativeLayoutFocusRequest.requestId,
    sidebarCardFocusTrace: summarizeSidebarCardFocusTrace(sidebarCardFocusTrace),
    sessionId,
  }, { force: sidebarCardFocusTrace !== undefined });
}

function summarizeNativeLayoutLeafSessionIds(layout: NativeTerminalLayout | undefined): string[] {
  if (!layout) {
    return [];
  }
  if (layout.kind === "leaf") {
    return [layout.sessionId];
  }
  if (layout.kind === "tabs") {
    return layout.sessionIds;
  }
  return layout.children.flatMap(summarizeNativeLayoutLeafSessionIds);
}

function appendPaneLayoutTraceDebugLog(
  event: string,
  details?: unknown,
  options: { force?: boolean } = {},
): void {
  appendTerminalFocusDebugLog(`nativePaneLayoutTrace.${event}`, details, options);
}

function appendStartupPaneLayoutDebugLog(event: string, details?: unknown): void {
  /**
   * CDXC:StartupPaneDiagnostics 2026-05-16-09:14:
   * A restart can incorrectly surface every parked tab as its own split pane before the user can enable Debugging Mode. Persist two low-volume startup breadcrumbs unconditionally: the restored project snapshot and the first native layout synthesis.
   */
  postNative({
    details: details === undefined ? undefined : safeSerializeForNativeLog(details),
    event: `nativePaneLayoutStartup.${event}`,
    force: true,
    type: "appendTerminalFocusDebugLog",
  });
}

function summarizeSessionPaneLayout(
  layout: SessionPaneLayoutNode | undefined,
  depth = 0,
): unknown {
  if (!layout) {
    return undefined;
  }
  if (depth > 4) {
    return { kind: "truncated" };
  }
  switch (layout.kind) {
    case "leaf":
      return { kind: "leaf", sessionId: layout.sessionId };
    case "tabs":
      return {
        activeSessionId: layout.activeSessionId,
        kind: "tabs",
        sessionIds: layout.sessionIds,
      };
    case "split":
      return {
        children: layout.children.map((child) => summarizeSessionPaneLayout(child, depth + 1)),
        direction: layout.direction,
        kind: "split",
        ratio: layout.ratio,
      };
  }
}

type PaneLayoutShapeNode =
  | { kind: "leaf"; sessionId: string }
  | { activeSessionId?: string; kind: "tabs"; sessionIds: readonly string[] }
  | {
      children: readonly PaneLayoutShapeNode[];
      direction: "horizontal" | "vertical";
      kind: "split";
      ratio?: number;
    };

type PaneLayoutShapeSummary = {
  leafCount: number;
  maxDepth: number;
  splitCount: number;
  tabGroupCount: number;
  tabbedSessionCount: number;
};

function summarizePaneLayoutShape(
  layout: PaneLayoutShapeNode | undefined,
  depth = 1,
): PaneLayoutShapeSummary {
  if (!layout) {
    return {
      leafCount: 0,
      maxDepth: 0,
      splitCount: 0,
      tabGroupCount: 0,
      tabbedSessionCount: 0,
    };
  }
  if (layout.kind === "leaf") {
    return {
      leafCount: 1,
      maxDepth: depth,
      splitCount: 0,
      tabGroupCount: 0,
      tabbedSessionCount: 0,
    };
  }
  if (layout.kind === "tabs") {
    return {
      leafCount: 0,
      maxDepth: depth,
      splitCount: 0,
      tabGroupCount: 1,
      tabbedSessionCount: layout.sessionIds.length,
    };
  }
  return layout.children
    .map((child) => summarizePaneLayoutShape(child, depth + 1))
    .reduce<PaneLayoutShapeSummary>(
      (summary, childSummary) => ({
        leafCount: summary.leafCount + childSummary.leafCount,
        maxDepth: Math.max(summary.maxDepth, childSummary.maxDepth),
        splitCount: summary.splitCount + childSummary.splitCount,
        tabGroupCount: summary.tabGroupCount + childSummary.tabGroupCount,
        tabbedSessionCount: summary.tabbedSessionCount + childSummary.tabbedSessionCount,
      }),
      {
        leafCount: 0,
        maxDepth: depth,
        splitCount: 1,
        tabGroupCount: 0,
        tabbedSessionCount: 0,
      },
    );
}

function summarizeSidebarSessionFocusTarget(
  project: NativeProject,
  sessionId: string,
): Record<string, unknown> {
  const targetGroupIndex = project.workspace.groups.findIndex((group) =>
    group.snapshot.sessions.some((session) => session.sessionId === sessionId),
  );
  const targetGroup =
    targetGroupIndex >= 0 ? project.workspace.groups[targetGroupIndex] : undefined;
  const targetSnapshot = targetGroup?.snapshot;
  const paneLayoutSessionIds = collectSessionPaneLayoutSessionIds(targetSnapshot?.paneLayout);
  const paneTabGroupSessionIds = findPaneTabGroupSessionIds(targetSnapshot?.paneLayout, sessionId);
  return {
    activeGroupId: project.workspace.activeGroupId,
    focusedSessionId: targetSnapshot?.focusedSessionId,
    isInPaneLayout: paneLayoutSessionIds.includes(sessionId),
    paneLayout: summarizeSessionPaneLayout(targetSnapshot?.paneLayout),
    paneLayoutSessionIds,
    paneTabGroupSessionIds,
    projectId: project.projectId,
    sessionIds: targetSnapshot?.sessions.map((session) => session.sessionId),
    targetGroupId: targetGroup?.groupId,
    targetGroupIndex,
    visibleSessionIds: targetSnapshot?.visibleSessionIds,
  };
}

function collectSessionPaneLayoutSessionIds(node: SessionPaneLayoutNode | undefined): string[] {
  if (!node) {
    return [];
  }
  switch (node.kind) {
    case "leaf":
      return [node.sessionId];
    case "tabs":
      return node.sessionIds;
    case "split":
      return node.children.flatMap((child) => collectSessionPaneLayoutSessionIds(child));
  }
}

function summarizeNativePaneLayout(layout: NativeTerminalLayout | undefined, depth = 0): unknown {
  if (!layout) {
    return undefined;
  }
  if (depth > 4) {
    return { kind: "truncated" };
  }
  switch (layout.kind) {
    case "leaf":
      return { kind: "leaf", sessionId: layout.sessionId };
    case "tabs":
      return {
        activeSessionId: layout.activeSessionId,
        kind: "tabs",
        sessionIds: layout.sessionIds,
      };
    case "split":
      return {
        children: layout.children.map((child) => summarizeNativePaneLayout(child, depth + 1)),
        direction: layout.direction,
        kind: "split",
        ratio: layout.ratio,
      };
  }
}

function summarizeVisiblePlacement(placement: VisibleSessionPlacement | undefined): unknown {
  if (!placement) {
    return undefined;
  }
  switch (placement.kind) {
    case "appendFullWidth":
      return { kind: placement.kind };
    case "appendToTabGroup":
    case "replace":
      return { kind: placement.kind, targetSessionId: placement.targetSessionId };
    case "insertAfter":
      return {
        kind: placement.kind,
        splitDirection: placement.splitDirection,
        targetSessionId: placement.targetSessionId,
      };
    case "replaceNonFocused":
      return { kind: placement.kind, preserveSessionId: placement.preserveSessionId };
  }
}

function summarizeWorkspaceGroupForPaneLayoutTrace(
  workspace: GroupedSessionWorkspaceSnapshot,
  groupId?: string,
): unknown {
  const group =
    (groupId ? workspace.groups.find((candidate) => candidate.groupId === groupId) : undefined) ??
    workspace.groups.find((candidate) => candidate.groupId === workspace.activeGroupId) ??
    workspace.groups[0];
  if (!group) {
    return {
      activeGroupId: workspace.activeGroupId,
      groupCount: workspace.groups.length,
      requestedGroupId: groupId,
    };
  }
  return {
    activeGroupId: workspace.activeGroupId,
    focusedSessionId: group.snapshot.focusedSessionId,
    groupCount: workspace.groups.length,
    groupId: group.groupId,
    paneLayout: summarizeSessionPaneLayout(group.snapshot.paneLayout),
    requestedGroupId: groupId,
    sessions: group.snapshot.sessions.map((session) => ({
      isPoppedOut: session.isPoppedOut === true || undefined,
      isSleeping: session.isSleeping === true || undefined,
      kind: session.kind,
      sessionId: session.sessionId,
    })),
    visibleCount: group.snapshot.visibleCount,
    visibleSessionIds: group.snapshot.visibleSessionIds,
  };
}

function summarizeStartupProjectPaneLayout(project: NativeProject): unknown {
  return {
    activeGroupId: project.workspace.activeGroupId,
    groupCount: project.workspace.groups.length,
    isRecentProject: project.isRecentProject === true || undefined,
    projectId: project.projectId,
    projectName: project.name,
    groups: project.workspace.groups.map((group) => {
      const paneLayoutSessionIds = collectSessionPaneLayoutSessionIds(group.snapshot.paneLayout);
      const surfacedPaneSessionIds = group.snapshot.paneLayout
        ? collectStartupSurfacedPaneSessionIds(group.snapshot.paneLayout)
        : [];
      return {
        focusedSessionId: group.snapshot.focusedSessionId,
        groupId: group.groupId,
        paneLayout: summarizeSessionPaneLayout(group.snapshot.paneLayout),
        paneLayoutSessionIds,
        paneLayoutShape: summarizePaneLayoutShape(group.snapshot.paneLayout),
        sessions: group.snapshot.sessions.map((session) => ({
          isSleeping: session.isSleeping === true || undefined,
          kind: session.kind,
          sessionId: session.sessionId,
          surface: session.kind === "terminal" ? session.surface : undefined,
        })),
        surfacedPaneSessionIds,
        visibleCount: group.snapshot.visibleCount,
        visibleSessionIds: group.snapshot.visibleSessionIds,
      };
    }),
  };
}

function summarizeTerminalText(text: string): string {
  return text.replace(/\r/g, "\\r").replace(/\n/g, "\\n").slice(0, 160);
}

function getTerminalFocusDebugSnapshot():
  | { focusedSessionId?: string; visibleSessionIds: string[] }
  | undefined {
  try {
    const snapshot = activeSnapshot();
    return {
      focusedSessionId: snapshot.focusedSessionId,
      visibleSessionIds: snapshot.visibleSessionIds,
    };
  } catch {
    return undefined;
  }
}

function safeSerializeForNativeLog(details: unknown): string {
  try {
    return JSON.stringify(details);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      unserializable: true,
    });
  }
}

function openNativeExternalUrl(url: string): void {
  postNative({ type: "openExternalUrl", url });
}

function openNativeWorkspaceInFinder(workspacePath: string): void {
  postNative({ type: "openWorkspaceInFinder", workspacePath });
}

function openNativeWorkspaceInSelectedIde(
  workspacePath: string,
  targetApp: ZedOverlayTargetApp = settings.zedOverlayTargetApp,
): void {
  /**
   * CDXC:WorkspaceActions 2026-05-04-08:22
   * Project right-click IDE opens are explicit user commands. They use the
   * Settings-selected IDE target directly and do not require IDE attachment or
   * sync-open settings to be enabled first.
   *
   * CDXC:SidebarActions 2026-05-05-03:11
   * Sidebar Open In can choose a concrete IDE per click. Accepting an explicit
   * target here keeps context-menu opens settings-driven while letting the
   * Actions dropdown open Finder, VS Code, or Zed without mutating Settings.
   */
  postNative({
    targetApp,
    type: "openWorkspaceInIde",
    workspacePath,
  });
}

function openChromeCanaryBrowserWindow(url: string): void {
  /**
   * CDXC:BrowserOverlay 2026-04-26-05:14
   * Browser-type actions should not use the user's default browser. They launch
   * Chrome Canary through the native host so Swift can place that browser
   * window above the currently attached ghostex window.
   */
  postNative({ type: "openBrowserWindow", url });
}

function openNativeBrowserWindow(url: string): BrowserSessionRecord | undefined {
  if (settings.browserOpenMode === "browser-pane") {
    return createNativeBrowserSession(url);
  }
  openChromeCanaryBrowserWindow(url);
  return undefined;
}

function normalizeBrowserPaneUrl(url: string): string {
  const trimmedUrl = url.trim() || DEFAULT_BROWSER_LAUNCH_URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmedUrl)) {
    return trimmedUrl;
  }
  return `https://${trimmedUrl}`;
}

function browserPaneTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || "Browser";
  } catch {
    return "Browser";
  }
}

function createNativeBrowserSession(
  url: string,
  groupId?: string,
  options?: {
    forceWorkspaceSurface?: boolean;
    title?: string;
    visiblePlacement?: VisibleSessionPlacement;
  },
): BrowserSessionRecord | undefined {
  const project = activeProject();
  if (
    options?.forceWorkspaceSurface === true ||
    !shouldKeepProjectEditorOpenForNewSession(project.projectId)
  ) {
    activateWorkspaceSurfaceForProject(project.projectId);
  }
  const normalizedUrl = normalizeBrowserPaneUrl(url);
  const title = options?.title ?? browserPaneTitleFromUrl(normalizedUrl);
  const targetWorkspace = groupId
    ? focusGroupInSimpleWorkspace(project.workspace, groupId).snapshot
    : project.workspace;
  appendSidebarRefreshDebugLog("nativeSidebar.createBrowser.before", {
    groupId,
    project: summarizeSidebarRefreshProject(project),
    url: normalizedUrl,
    visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
  });
  appendPaneLayoutTraceDebugLog("createBrowser.request", {
    activeProjectId,
    groupId,
    projectId: project.projectId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(targetWorkspace, groupId),
    url: normalizedUrl,
    visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
  });
  /**
   * CDXC:BrowserPanes 2026-05-02-06:35
   * Browser-pane mode turns every browser action into a first-class workspace
   * browser session. The card lives beside terminal and T3 cards in the active
   * group instead of appearing in the old dedicated Chrome Canary Browsers
   * section, matching the requested pane-based workflow.
   *
   * CDXC:ModeSwitcher 2026-05-15-14:42:
   * Mode-switcher Git and tasks-backed Project surfaces use project-editor CEF
   * panes instead of normal browser sessions. Keep this browser-session helper
   * available for explicit browser actions only so those actions can still
   * request workspace placement without changing the mode-switcher surface
   * contract.
   */
  const result = createSessionInSimpleWorkspace(
    targetWorkspace,
    {
      browser: { url: normalizedUrl },
      kind: "browser",
      title,
    },
    options?.visiblePlacement ? { visiblePlacement: options.visiblePlacement } : undefined,
  );
  const session = result.session?.kind === "browser" ? result.session : undefined;
  if (!session) {
    appendPaneLayoutTraceDebugLog("createBrowser.noSession", {
      activeProjectId,
      groupId,
      projectId: project.projectId,
      url: normalizedUrl,
      visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
    });
    return undefined;
  }

  const nativeSessionId = rememberNativeSessionMapping(project.projectId, session.sessionId);
  updateActiveProjectWorkspace(() => result.snapshot);
  appendPaneLayoutTraceDebugLog("createBrowser.created", {
    activeProjectId,
    nativeSessionId,
    projectId: project.projectId,
    sessionId: session.sessionId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(
      result.snapshot,
      result.snapshot.activeGroupId,
    ),
    url: normalizedUrl,
    visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
  });
  postNative({
    cwd: project.path,
    sessionId: nativeSessionId,
    title: session.title || title || "Browser",
    type: "createWebPane",
    url: normalizedUrl,
  });
  postNative({ sessionId: nativeSessionId, type: "focusWebPane" });
  publish();
  appendSidebarRefreshDebugLog("nativeSidebar.createBrowser.afterPublish", {
    nativeSessionId,
    project: summarizeSidebarRefreshProject(),
    sessionId: session.sessionId,
    url: normalizedUrl,
  });
  return session;
}

function findBrowserSessionInProjectByUrl(
  project: NativeProject,
  url: string,
): { groupId: string; session: BrowserSessionRecord } | undefined {
  const normalizedUrl = normalizeBrowserPaneUrl(url);
  for (const group of project.workspace.groups) {
    const session = group.snapshot.sessions.find(
      (candidate): candidate is BrowserSessionRecord =>
        candidate.kind === "browser" && candidate.browser.url === normalizedUrl,
    );
    if (session) {
      return { groupId: group.groupId, session };
    }
  }
  return undefined;
}

function focusExistingBrowserModeSession(project: NativeProject, sessionId: string): void {
  if (activeProjectId !== project.projectId) {
    focusProject(project.projectId);
  }
  activateWorkspaceSurfaceForProject(project.projectId);
  focusTerminal(sessionId);
}

function openTitlebarBrowserMode(url: string, title: string): void {
  const project = activeProject();
  const normalizedUrl = normalizeBrowserPaneUrl(url);
  const existing = findBrowserSessionInProjectByUrl(project, normalizedUrl);
  if (existing) {
    focusExistingBrowserModeSession(project, existing.session.sessionId);
    return;
  }
  createNativeBrowserSession(normalizedUrl, activeWorkspaceGroup().groupId, {
    forceWorkspaceSurface: true,
    title,
    visiblePlacement: createFocusedTabGroupPlacement(activeWorkspaceGroup().groupId),
  });
}

function revealSessionAsAdditionalNativePane(
  sessionId: string,
): void {
  const group = activeWorkspaceGroup();
  const nextVisibleCount = clampVisibleSessionCount(
    Math.min(group.snapshot.sessions.length, group.snapshot.visibleCount + 1),
  );
  /**
   * CDXC:BrowserPanes 2026-05-02-17:48
   * Browser top-row split controls must create visible native panes, not
   * background sidebar cards. Ghostex's workspace state is the source of truth for
   * the AppKit layout, so focus the new session and expand visibleCount before
   * the next native layout sync.
   */
  updateActiveProjectWorkspace((workspace) =>
    setVisibleCountInSimpleWorkspace(
      focusSessionInSimpleWorkspace(workspace, sessionId).snapshot,
      nextVisibleCount,
    ),
  );
  syncNativeLayout();
  publish();
}

function applyRecommendedGhosttySettings(): void {
  /**
   * CDXC:GhosttySettings 2026-04-30-01:48
   * Recommended Ghostty settings are written as a managed config block through
   * the native host so the app updates the same file embedded Ghostty reads.
   */
  postNative({
    lines: [...GHOSTEX_RECOMMENDED_GHOSTTY_CONFIG_LINES],
    managedKeys: [...GHOSTEX_GHOSTTY_MANAGED_CONFIG_KEYS],
    reloadImmediately: true,
    type: "applyGhosttyConfigSettings",
  });
}

function resetGhosttySettingsToDefault(): void {
  postNative({
    lines: [],
    managedKeys: [...GHOSTEX_GHOSTTY_MANAGED_CONFIG_KEYS],
    reloadImmediately: true,
    type: "applyGhosttyConfigSettings",
  });
}

function openGhosttyConfigFile(): void {
  postNative({ type: "openGhosttyConfigFile" });
}

async function installZapetFromBrew(): Promise<void> {
  /**
   * CDXC:ZapetPromptEditing 2026-05-10-11:11
   * The Settings install button installs Zapet from the user's Homebrew tap.
   * macOS GUI launches may not inherit a shell PATH, so resolve Homebrew from
   * the shell command before running the single brew install operation.
   */
  const result = await runNativeProcess(
    "/bin/zsh",
    [
      "-lc",
      [
        "if command -v brew >/dev/null 2>&1; then BREW=$(command -v brew);",
        "elif [ -x /opt/homebrew/bin/brew ]; then BREW=/opt/homebrew/bin/brew;",
        "elif [ -x /usr/local/bin/brew ]; then BREW=/usr/local/bin/brew;",
        "else echo 'Homebrew was not found on PATH, /opt/homebrew/bin, or /usr/local/bin.' >&2; exit 127; fi;",
        '"$BREW" install maddada/tap/zapet',
      ].join(" "),
    ],
    { timeoutMs: 5 * 60_000 },
  );
  if (result.exitCode === 0) {
    showNativeMessage("info", "Zapet installed from Homebrew.");
    return;
  }
  showNativeMessage(
    "error",
    `Zapet install failed: ${(result.stderr || result.stdout || "brew install failed").trim()}`,
  );
}

function showNativeBrowserWindow(): void {
  /**
   * CDXC:BrowserOverlay 2026-04-26-07:37
   * When Chrome Canary is already running, the sidebar Browsers section exposes
   * one " Chrome Canary" control for every ghostex session. The control asks
   * Swift to raise and resize the existing Canary window above the ghostex
   * workarea, without opening a replacement URL or using a browser fallback.
   */
  postNative({ type: "showBrowserWindow" });
}

function runNativeProcess(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<NativeProcessResult> {
  /**
   * CDXC:NativeCommandBridge 2026-04-26-03:16
   * Native sidebar features can request background process execution from Swift.
   * This keeps Git and URL-launch workflows native while preserving the shared
   * sidebar UI contract.
   *
   * CDXC:ZapetPromptEditing 2026-05-10-11:11
   * Homebrew installs can exceed the short default command timeout. Allow the
   * Zapet install button to request a longer wait without changing existing
   * Git and diagnostics command timing.
   */
  const requestId = `process-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  postNative({
    args,
    cwd: options.cwd,
    env: options.env,
    executable,
    requestId,
    type: "runProcess",
  });
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingProcessResults.delete(requestId);
      reject(new Error(`${executable} ${args.join(" ")} timed out`));
    }, options.timeoutMs ?? 30_000);
    pendingProcessResults.set(requestId, { reject, resolve, timeout });
  });
}

async function refreshWorkspaceOpenTargetAvailabilityAtStartup(): Promise<void> {
  try {
    const nextAvailability = await detectWorkspaceOpenTargetAvailability();
    applyWorkspaceOpenTargetAvailability(nextAvailability, false);
  } catch (error) {
    console.warn("Failed to detect Open In targets", error);
  }
}

async function refreshWorkspaceOpenTargetAvailabilityFromTitlebar(): Promise<void> {
  try {
    const nextAvailability = await detectWorkspaceOpenTargetAvailability();
    /**
     * CDXC:TitlebarOpenIn 2026-05-11-03:13
     * The titlebar reload button manually rechecks installed Open In targets.
     * Persist the fresh scan even when the target set is unchanged so the
     * native layout sync acknowledges the user's explicit refresh command.
     */
    applyWorkspaceOpenTargetAvailability(nextAvailability, true);
  } catch (error) {
    console.warn("Failed to refresh Open In targets", error);
  }
}

function applyWorkspaceOpenTargetAvailability(
  nextAvailability: ghostexSettings["workspaceOpenTargetAvailability"],
  forceSave: boolean,
): void {
  if (
    !forceSave &&
    workspaceOpenTargetAvailabilityEquals(settings.workspaceOpenTargetAvailability, nextAvailability)
  ) {
    return;
  }
  saveSettings({
    ...settings,
    workspaceOpenTargetAvailability: nextAvailability,
  });
}

async function detectWorkspaceOpenTargetAvailability(): Promise<
  ghostexSettings["workspaceOpenTargetAvailability"]
> {
  /**
   * CDXC:TitlebarOpenIn 2026-05-11-02:03
   * Installed Open In targets are detected once when the native sidebar starts.
   * Detection checks both shell commands and macOS .app bundles, then persists
   * availability separately from user-hidden ids so manual disables survive
   * every startup scan.
   */
  const script = createWorkspaceOpenTargetDetectionScript();
  const result = await runNativeProcess("/bin/zsh", ["-lc", script], { timeoutMs: 45_000 });
  const availableTargetIds = new Set<BuiltInWorkspaceOpenTargetId>(
    ALWAYS_AVAILABLE_WORKSPACE_OPEN_TARGET_IDS,
  );
  const resolvedCommands: Record<string, string> = {};
  const resolvedAppNames: Record<string, string> = {};
  const builtInTargetIds = new Set<string>(BUILT_IN_WORKSPACE_OPEN_TARGETS.map((target) => target.id));

  if (result.exitCode === 0) {
    for (const line of result.stdout.split("\n")) {
      const [kind, targetId, value] = line.split("\t");
      if (!targetId || !value || !builtInTargetIds.has(targetId)) {
        continue;
      }
      availableTargetIds.add(targetId as BuiltInWorkspaceOpenTargetId);
      if (kind === "command" && resolvedCommands[targetId] === undefined) {
        resolvedCommands[targetId] = value;
      }
      if (kind === "app" && resolvedAppNames[targetId] === undefined) {
        resolvedAppNames[targetId] = value;
      }
    }
  }

  return normalizeWorkspaceOpenTargetAvailability({
    availableTargetIds: [...availableTargetIds],
    checkedAtMs: Date.now(),
    resolvedAppNames,
    resolvedCommands,
  });
}

function createWorkspaceOpenTargetDetectionScript(): string {
  const commandChecks = BUILT_IN_WORKSPACE_OPEN_TARGETS.flatMap((target) =>
    (target.commands ?? []).map(
      (command) =>
        `if command -v ${shellQuote(command)} >/dev/null 2>&1; then printf 'command\\t%s\\t%s\\n' ${shellQuote(target.id)} ${shellQuote(command)}; fi`,
    ),
  );
  const appChecks = BUILT_IN_WORKSPACE_OPEN_TARGETS.flatMap((target) =>
    (target.macOSAppNames ?? []).map(
      (appName) =>
        `if ghostex_app_exists ${shellQuote(appName)}; then printf 'app\\t%s\\t%s\\n' ${shellQuote(target.id)} ${shellQuote(appName)}; fi`,
    ),
  );
  return [
    "set +e",
    "ghostex_app_exists() {",
    "  local app_name=\"$1\"",
    "  local app_bundle=\"${app_name}.app\"",
    "  local base",
    "  for base in /Applications \"$HOME/Applications\" /System/Applications; do",
    "    if [ -d \"$base/$app_bundle\" ]; then return 0; fi",
    "  done",
    "  local found",
    "  found=$(/usr/bin/mdfind \"kMDItemFSName == '$app_bundle'cd && kMDItemContentType == 'com.apple.application-bundle'\" 2>/dev/null | /usr/bin/head -n 1)",
    "  [ -n \"$found\" ]",
    "}",
    ...commandChecks,
    ...appChecks,
  ].join("\n");
}

function workspaceOpenTargetAvailabilityEquals(
  left: ghostexSettings["workspaceOpenTargetAvailability"],
  right: ghostexSettings["workspaceOpenTargetAvailability"],
): boolean {
  return (
    arraySetEquals(left.availableTargetIds, right.availableTargetIds) &&
    recordEquals(left.resolvedCommands, right.resolvedCommands) &&
    recordEquals(left.resolvedAppNames, right.resolvedAppNames)
  );
}

function arraySetEquals(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function recordEquals(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) {
    return false;
  }
  return leftEntries.every(([key, value]) => right[key] === value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runGit(
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<NativeProcessResult> {
  return runGitInProject(activeProject(), args, options);
}

async function runGitInProject(
  project: NativeProject,
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<NativeProcessResult> {
  const result = await runNativeProcess("/usr/bin/env", ["git", ...args], {
    cwd: project.path,
  });
  if (!options.allowFailure && result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return result;
}

async function runGh(
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<NativeProcessResult> {
  const result = await runNativeProcess("/usr/bin/env", ["gh", ...args], {
    cwd: activeProject().path,
  });
  if (!options.allowFailure && result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `gh ${args.join(" ")} failed`);
  }
  return result;
}

async function requestGhostexFolderStats(): Promise<void> {
  const folderPath = nativeGhostexHomeDirectory();
  /**
   * CDXC:SettingsStorage 2026-05-09-15:25
   * The settings storage card is lazy. When it becomes visible, run one native
   * background `du` scan over the trusted ghostex home and publish only immediate
   * child folder totals so the modal can identify large folders without
   * blocking initial Settings rendering.
   */
  try {
    const result = await runNativeProcess("/bin/sh", [
      "-lc",
      [
        'root="$1"',
        '[ -d "$root" ] || exit 2',
        '/usr/bin/find "$root" -mindepth 1 -maxdepth 1 -type d -exec /usr/bin/du -sk {} +',
      ].join("\n"),
      "sh",
      folderPath,
    ]);
    if (result.exitCode !== 0) {
      postGhostexFolderStats({
        errorMessage:
          result.stderr.trim() || result.stdout.trim() || "Could not read the Ghostex folder.",
        folderPath,
        folders: [],
        generatedAt: new Date().toISOString(),
        totalBytes: 0,
        type: "ghostexFolderStats",
      });
      return;
    }

    const folders = result.stdout
      .split(/\r?\n/u)
      .map((line) => parseDuFolderStatLine(line))
      .filter((folder): folder is NonNullable<typeof folder> => folder !== undefined)
      .sort(
        (left, right) => right.sizeBytes - left.sizeBytes || left.name.localeCompare(right.name),
      );
    postGhostexFolderStats({
      folderPath,
      folders,
      generatedAt: new Date().toISOString(),
      totalBytes: folders.reduce((total, folder) => total + folder.sizeBytes, 0),
      type: "ghostexFolderStats",
    });
  } catch (error) {
    postGhostexFolderStats({
      errorMessage: error instanceof Error ? error.message : "Could not read the Ghostex folder.",
      folderPath,
      folders: [],
      generatedAt: new Date().toISOString(),
      totalBytes: 0,
      type: "ghostexFolderStats",
    });
  }
}

function parseDuFolderStatLine(
  line: string,
): SidebarGhostexFolderStatsMessage["folders"][number] | undefined {
  const match = /^(\d+)\s+(.+)$/u.exec(line.trim());
  if (!match) {
    return undefined;
  }
  const sizeKb = Number(match[1]);
  const path = match[2]?.trim();
  if (!Number.isFinite(sizeKb) || !path) {
    return undefined;
  }
  return {
    name: path.split("/").filter(Boolean).at(-1) ?? path,
    path,
    sizeBytes: sizeKb * 1024,
  };
}

async function refreshChromeCanaryRunningState(): Promise<void> {
  /**
   * CDXC:BrowserOverlay 2026-04-26-07:37
   * The native sidebar should bring back the existing Browsers section only
   * while Chrome Canary is actually running. Poll the macOS process table from
   * the native process bridge so every project/session gets the same one-button
   * Canary control without inventing persistent browser sessions.
   */
  const result = await runNativeProcess("/usr/bin/pgrep", ["-qx", CHROME_CANARY_PROCESS_NAME]);
  const nextIsRunning = result.exitCode === 0;
  if (isChromeCanaryRunning === nextIsRunning) {
    return;
  }

  isChromeCanaryRunning = nextIsRunning;
  publish();
}

function startChromeCanaryRunningMonitor(): void {
  void refreshChromeCanaryRunningState().catch((error) => {
    console.warn("Failed to refresh Chrome Canary running state.", error);
  });
  window.setInterval(() => {
    void refreshChromeCanaryRunningState().catch((error) => {
      console.warn("Failed to refresh Chrome Canary running state.", error);
    });
  }, CHROME_CANARY_RUNNING_POLL_MS);
}

function startFirstPromptAutoRenameMonitor(): void {
  void ensureNativeAgentFirstPromptHooks().catch((error) => {
    appendSessionTitleDebugLog("nativeSidebar.firstPromptAutoRename.hookInstallFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  void pollNativeFirstPromptAutoRenameSessions().catch((error) => {
    appendSessionTitleDebugLog("nativeSidebar.firstPromptAutoRename.pollFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  window.setInterval(() => {
    void pollNativeFirstPromptAutoRenameSessions().catch((error) => {
      appendSessionTitleDebugLog("nativeSidebar.firstPromptAutoRename.pollFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, FIRST_PROMPT_AUTO_RENAME_POLL_MS);
}

function readStoredSettings(): ghostexSettings {
  try {
    const sharedSettingsJson = window.__ghostex_NATIVE_HOST__?.sharedSidebarStorage?.settings;
    const storedSettingsSource = JSON.parse(
      sharedSettingsJson || localStorage.getItem(SETTINGS_STORAGE_KEY) || "null",
    );
    const storedSettings = normalizeghostexSettings(
      normalizeStoredSettingsSidebarSide(storedSettingsSource),
    );
    if (!sharedSettingsJson) {
      persistSharedSettingsSnapshot(storedSettings);
    }
    const bootstrap = window.__ghostex_NATIVE_HOST__;
    return normalizeghostexSettings({
      ...storedSettings,
      ...(bootstrap?.zedOverlayEnabled === undefined
        ? {}
        : { zedOverlayEnabled: bootstrap.zedOverlayEnabled }),
      ...(bootstrap?.zedOverlayTargetApp === undefined
        ? {}
        : { zedOverlayTargetApp: bootstrap.zedOverlayTargetApp }),
      ...(bootstrap?.zedOverlayHideTitlebarButton === undefined
        ? {}
        : { zedOverlayHideTitlebarButton: bootstrap.zedOverlayHideTitlebarButton }),
    });
  } catch {
    return DEFAULT_ghostex_SETTINGS;
  }
}

function normalizeStoredSettingsSidebarSide(candidate: unknown): unknown {
  const legacySidebarSide = readLegacyStoredSidebarSide();
  if (!legacySidebarSide) {
    return candidate;
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { sidebarSide: legacySidebarSide };
  }
  if ("sidebarSide" in candidate) {
    return candidate;
  }

  /**
   * CDXC:SidebarPlacement 2026-05-06-17:32
   * Sidebar placement now lives in ghostex settings. Migrate the old hotkey-only
   * localStorage side value into the settings snapshot so right-side users do
   * not get moved back to the left after upgrading.
   */
  return {
    ...candidate,
    sidebarSide: legacySidebarSide,
  };
}

function readLegacyStoredSidebarSide(): SidebarSide | undefined {
  return localStorage.getItem(LEGACY_SIDEBAR_SIDE_STORAGE_KEY) === "right"
    ? "right"
    : undefined;
}

function saveSettings(nextSettings: ghostexSettings): void {
  const previousSettings = settings;
  settings = normalizeghostexSettings(nextSettings);
  if (!settings.zedOverlayEnabled || !settings.syncOpenProjectWithZed) {
    clearPendingZedProjectSync();
  }
  persistSharedSettingsSnapshot(settings);
  syncNativeSidebarSide(settings.sidebarSide, previousSettings.sidebarSide);
  syncGhosttyTerminalSettings(settings, previousSettings);
  postZedOverlaySettings(
    !previousSettings.zedOverlayEnabled && settings.zedOverlayEnabled
      ? "settings-enable"
      : "settings-save",
  );
  syncCodeServerRuntimeSettings(settings, previousSettings);
  publish();
  previewNativeSoundSettingChange(previousSettings, settings);
}

function syncNativeSidebarSide(
  nextSidebarSide: SidebarSide,
  previousSidebarSide?: SidebarSide,
): void {
  if (sidebarSide === nextSidebarSide && previousSidebarSide === nextSidebarSide) {
    return;
  }
  /**
   * CDXC:SidebarPlacement 2026-05-06-17:32
   * Settings changes must move the AppKit sidebar immediately. Keep the native
   * side mirror synchronized from the persisted settings value so the settings
   * dropdown and move-sidebar hotkey cannot diverge.
   */
  sidebarSide = nextSidebarSide;
  postNative({ side: sidebarSide, type: "setSidebarSide" });
}

function syncCodeServerRuntimeSettings(
  nextSettings: ghostexSettings,
  previousSettings: ghostexSettings,
): void {
  const codeServerSettingsChanged =
    previousSettings.codeServerLinkVscodeUserConfig !== nextSettings.codeServerLinkVscodeUserConfig ||
    previousSettings.codeServerUseVscodeInsidersUserConfig !==
      nextSettings.codeServerUseVscodeInsidersUserConfig;
  if (!codeServerSettingsChanged) {
    return;
  }
  const awakeProjectIds = Array.from(projectEditorSurfaceByProjectId.entries())
    .filter(([, surfaceState]) => surfaceState.isOpen === true && surfaceState.isSleeping !== true)
    .map(([projectId]) => projectId);
  if (!awakeProjectIds.length) {
    return;
  }
  /**
   * CDXC:EditorPanes 2026-05-06-15:00
   * code-server settings-link flags are process launch options. Restart the
   * shared runtime for currently awake editor panes when these settings change
   * so the embedded editor starts with the selected VS Code config source.
   */
  postNative({ type: "stopCodeServerRuntime" });
  for (const projectId of awakeProjectIds) {
    const project = findProject(projectId);
    if (project) {
      wakeProjectEditorSurface(project);
    }
  }
}

function nextSessionPersistenceProvider(
  provider: ghostexSettings["sessionPersistenceProvider"],
): ghostexSettings["sessionPersistenceProvider"] {
  /**
   * CDXC:SessionPersistence 2026-05-06-03:43
   * The overflow menu is the quick persistence-mode control. Cycle zellij in
   * the same path as tmux and zmx so all providers share one UX instead of
   * requiring users to open Settings for the new provider.
   */
  switch (provider) {
    case "off":
      return "tmux";
    case "tmux":
      return "zmx";
    case "zmx":
      return "zellij";
    case "zellij":
      return "off";
  }
}

function activeSessionPersistenceProviderFromSettings(): TerminalSessionPersistenceProvider | undefined {
  return settings.sessionPersistenceProvider === "tmux" ||
    settings.sessionPersistenceProvider === "zmx" ||
    settings.sessionPersistenceProvider === "zellij"
    ? settings.sessionPersistenceProvider
    : undefined;
}

function resolveTerminalSessionPersistenceProvider(): TerminalSessionPersistenceProvider | undefined {
  /**
   * CDXC:SessionPersistence 2026-05-10-03:35
   * Settings is now the source of truth for provider-backed terminal creation.
   * Reload, wake, app restore, and previous-session restore must use the
   * currently selected tmux/zmx/zellij/off value instead of reusing the provider
   * that happened to be active when the session record was first created.
   */
  return activeSessionPersistenceProviderFromSettings();
}

function sessionPersistenceNameForProvider(
  provider: TerminalSessionPersistenceProvider | undefined,
  session: Pick<TerminalSessionRecord, "sessionPersistenceName" | "tmuxSessionName">,
): string | undefined {
  return provider ? session.sessionPersistenceName ?? session.tmuxSessionName : undefined;
}

function resolveTerminalAttachProvider(
  session: TerminalSessionRecord,
): TerminalSessionPersistenceProvider | undefined {
  /**
   * CDXC:SessionPersistence 2026-05-10-03:35
   * Copying an attach command is an inspection action for the live persisted
   * backend, so it uses the stored provider/name pair. Recreate paths use
   * resolveTerminalSessionPersistenceProvider instead so Settings can override
   * old records on reload, wake, and previous-session restore.
   */
  return session.sessionPersistenceProvider ?? (session.tmuxSessionName ? "tmux" : undefined);
}

function syncGhosttyTerminalSettings(
  nextSettings: ghostexSettings,
  previousSettings?: ghostexSettings,
): void {
  /**
   * CDXC:TerminalSettings 2026-04-26-19:02
   * Native ghostex settings are stored in sidebar localStorage, so terminal
   * typography must also be posted to AppDelegate to update the shared Ghostty
   * config file used by external Ghostty windows.
   *
   * CDXC:TerminalScrollSettings 2026-04-29-08:56
   * Scroll multipliers must be testable as soon as the slider settles. Reload
   * Ghostty immediately for scroll-only changes instead of waiting for the
   * delayed font-metric reload path used during typography drags.
   *
   * CDXC:TerminalBehaviorSettings 2026-04-29-09:32
   * Theme and interaction controls should also reload immediately because they
   * do not require the delayed font metric rebuild path.
   */
  postNative({
    ...getGhosttyTerminalConfigValues(nextSettings),
    reloadImmediately:
      previousSettings !== undefined &&
      (previousSettings.terminalMouseScrollMultiplierDiscrete !==
        nextSettings.terminalMouseScrollMultiplierDiscrete ||
        previousSettings.terminalMouseScrollMultiplierPrecision !==
          nextSettings.terminalMouseScrollMultiplierPrecision ||
        previousSettings.terminalGhosttyTheme !== nextSettings.terminalGhosttyTheme ||
        previousSettings.terminalCursorStyleBlink !== nextSettings.terminalCursorStyleBlink ||
        previousSettings.terminalCopyOnSelect !== nextSettings.terminalCopyOnSelect ||
        previousSettings.terminalConfirmCloseSurface !== nextSettings.terminalConfirmCloseSurface ||
        previousSettings.terminalClipboardTrimTrailingSpaces !==
          nextSettings.terminalClipboardTrimTrailingSpaces ||
        previousSettings.terminalClipboardPasteProtection !==
          nextSettings.terminalClipboardPasteProtection ||
        previousSettings.terminalMouseHideWhileTyping !==
          nextSettings.terminalMouseHideWhileTyping ||
        previousSettings.terminalScrollbar !== nextSettings.terminalScrollbar),
    type: "syncGhosttyTerminalSettings",
  });
}

function saveSettingsFromNative(nextSettings: ghostexSettings): void {
  /**
   * CDXC:ZedOverlay 2026-04-26-10:54
   * Native Detach has already persisted and applied the disabled Zed attach
   * state. Mirror that state into sidebar localStorage and React state without
   * posting a duplicate configure command back to the native host.
  */
  settings = normalizeghostexSettings(nextSettings);
  if (!settings.zedOverlayEnabled || !settings.syncOpenProjectWithZed) {
    clearPendingZedProjectSync();
  }
  persistSharedSettingsSnapshot(settings);
  publish();
}

function openTipsAndTricksOnFirstLaunch(): void {
  if (localStorage.getItem(TIPS_AND_TRICKS_SEEN_STORAGE_KEY) === "true") {
    return;
  }

  /**
   * CDXC:TipsAndTricks 2026-05-15-16:11:
   * First app launch should show the same Tips & Tricks shadcn modal that the
   * sidebar overflow menu opens. Persist the seen flag only after the native
   * modal bridge accepts the open request so an unavailable modal host remains
   * visible as a startup integration failure.
   */
  openAppModal({ modal: "tipsAndTricks", type: "open" });
  localStorage.setItem(TIPS_AND_TRICKS_SEEN_STORAGE_KEY, "true");
}

function persistSharedSettingsSnapshot(nextSettings: ghostexSettings): void {
  const payloadJson = JSON.stringify(nextSettings);
  localStorage.setItem(SETTINGS_STORAGE_KEY, payloadJson);
  postNative({ key: "settings", payloadJson, type: "persistSharedSidebarStorage" });
}

function playNativeSound(sound: CompletionSoundSetting, volume = 0.5): void {
  postNative({
    fileName: getCompletionSoundFileName(sound),
    type: "playSound",
    volume,
  });
}

function playNativeSessionCompletionSound(sessionId: string, source: string): void {
  /**
   * CDXC:NativeSound 2026-04-29-16:30
   * Session completion sounds follow the completion bell setting and play when
   * a terminal first enters attention/done state. Native playback uses the
   * configured completion sound instead of the sidebar webview audio path.
   */
  if (!settings.completionBellEnabled) {
    return;
  }

  appendAgentDetectionDebugLog("nativeSidebar.completionSound.session", {
    sessionId,
    sound: settings.completionSound,
    source,
  });
  playNativeSound(settings.completionSound);
}

function handleNativeSessionEnteredAttention(sessionId: string, source: string): void {
  clearNativeSessionAttentionAcknowledgementTimer(sessionId);
  nativeAttentionEnteredAtBySessionId.set(sessionId, Date.now());
  /**
   * CDXC:SessionAttentionNotifications 2026-05-10-16:46
   * Attention transitions fan out to both optional sounds and optional macOS
   * banners. Keep this on the transition edge rather than every publish so
   * long-running title/bell updates do not repeatedly notify the user.
   */
  playNativeSessionCompletionSound(sessionId, source);
  showNativeSessionAttentionNotification(sessionId, source);
}

function clearNativeSessionAttentionAcknowledgementTimer(sessionId: string): void {
  const timeout = nativeAttentionAcknowledgementTimeoutBySessionId.get(sessionId);
  if (timeout === undefined) {
    return;
  }
  window.clearTimeout(timeout);
  nativeAttentionAcknowledgementTimeoutBySessionId.delete(sessionId);
}

function clearNativeSessionAttentionTracking(sessionId: string): void {
  clearNativeSessionAttentionAcknowledgementTimer(sessionId);
  nativeAttentionEnteredAtBySessionId.delete(sessionId);
}

function markNativeSessionSemanticActivityAt(
  sessionId: string,
  activity: "attention" | "working",
  source: string,
): boolean {
  const terminalState = terminalStateById.get(sessionId);
  if (!terminalState) {
    return false;
  }
  const timestamp = new Date().toISOString();
  const previousTimestamp = terminalState.lastActivityAt;
  if (!isNativeTimestampNewer(timestamp, previousTimestamp)) {
    return false;
  }
  /**
   * CDXC:SessionLastActive 2026-05-15-14:10
   * Last Active should move on semantic agent activity edges, not on every
   * spinner-title frame. Stamp working start and work-finished attention
   * transitions once, then persist the same timestamp so the session-state
   * poller cannot restore an older prompt-only timestamp.
   */
  terminalState.lastActivityAt = timestamp;
  if (terminalState.sessionStateFilePath) {
    void persistNativeSessionSemanticActivityAt(
      terminalState.sessionStateFilePath,
      timestamp,
      activity,
      sessionId,
      source,
    );
  }
  return true;
}

async function persistNativeSessionSemanticActivityAt(
  sessionStateFilePath: string,
  timestamp: string,
  activity: "attention" | "working",
  sessionId: string,
  source: string,
): Promise<void> {
  const command = [
    `/usr/bin/python3 - ${quoteNativeShellArg(sessionStateFilePath)} ${quoteNativeShellArg(timestamp)} ${quoteNativeShellArg(activity)} <<'GHOSTEX_STAMP_ACTIVITY'`,
    getStampNativeSessionSemanticActivityScript(),
    "GHOSTEX_STAMP_ACTIVITY",
  ].join("\n");
  try {
    const result = await runNativeProcess("/bin/zsh", ["-lc", command]);
    if (result.exitCode !== 0) {
      appendAgentDetectionDebugLog("nativeSidebar.semanticActivityPersistFailed", {
        activity,
        error: result.stderr.trim() || result.stdout.trim() || "persist semantic activity failed",
        sessionId,
        sessionStateFilePath,
        source,
        timestamp,
      });
    }
  } catch (error) {
    appendAgentDetectionDebugLog("nativeSidebar.semanticActivityPersistFailed", {
      activity,
      error: error instanceof Error ? error.message : String(error),
      sessionId,
      sessionStateFilePath,
      source,
      timestamp,
    });
  }
}

function showNativeSessionAttentionNotification(
  sessionId: string,
  source: string,
  contentOverride?: { body: string; iconDataUrl?: string; title: string },
): void {
  if (!settings.showMacOSAttentionNotifications) {
    return;
  }
  if (!consumeNativeAttentionNotificationBudget(sessionId)) {
    appendAgentDetectionDebugLog("nativeSidebar.attentionNotification.rateLimited", {
      sessionId,
      source,
    });
    return;
  }

  const reference = resolveSidebarSessionReference(sessionId);
  const session = reference
    ? findSessionRecordInProject(reference.project, reference.sessionId)
    : undefined;
  const content =
    contentOverride
      ? {
          ...contentOverride,
          iconDataUrl:
            contentOverride.iconDataUrl ??
            resolveWorkspaceProjectIconDataUrl(reference?.project ?? activeProject()),
        }
      : createNativeSessionAttentionNotificationContent(
          reference?.project,
          session,
          terminalStateById.get(sessionId),
        );
  postNative({
    body: content.body,
    iconDataUrl: content.iconDataUrl,
    sessionId: reference
      ? nativeSessionIdForProjectSidebarSession(reference.project.projectId, reference.sessionId)
      : sessionId,
    title: content.title,
    type: "showSessionAttentionNotification",
  });
}

function createNativeSessionAttentionNotificationContent(
  project: NativeProject | undefined,
  session: SessionRecord | undefined,
  terminalState: ReturnType<typeof terminalStateById.get>,
): { body: string; iconDataUrl?: string; title: string } {
  /**
   * CDXC:SessionAttentionNotifications 2026-05-15-10:33:
   * macOS attention banners must stay minimal: use the session name as the
   * title, use only the project name as the body, and omit thread/project/agent
   * labels so the banner shows no extra metadata.
   */
  const agentName =
    session?.kind === "terminal"
      ? terminalState?.agentName ?? session.agentName
      : session?.kind === "t3"
        ? "t3"
        : undefined;
  const threadName =
    getSessionCardPrimaryTitle({
      agentName,
      title: session?.title || DEFAULT_TERMINAL_SESSION_TITLE,
    }) ?? DEFAULT_TERMINAL_SESSION_TITLE;
  return {
    body: project?.name.trim() || "Ghostex",
    iconDataUrl: resolveWorkspaceProjectIconDataUrl(project),
    title: threadName,
  };
}

function testNativeAgentTaskCompletion(): void {
  /**
   * CDXC:SessionAttentionNotifications 2026-05-11-01:14
   * The Settings test action must use the same settings-gated completion flow
   * as real attention transitions: completionBellEnabled chooses audio,
   * showMacOSAttentionNotifications chooses the macOS banner, and the selected
   * completionSound is played by the normal native sound bridge.
   */
  const focusedSessionId = activeSnapshot().focusedSessionId;
  const testSessionId = focusedSessionId ?? "__ghostex-settings-attention-test__";
  playNativeSessionCompletionSound(testSessionId, "settings-test");
  showNativeSessionAttentionNotification(testSessionId, "settings-test", {
    body: "This is a test of the current Ghostex completion alert settings.",
    title: "Test agent task completion",
  });
}

function consumeNativeAttentionNotificationBudget(sessionId: string): boolean {
  const now = Date.now();
  const previousSessionSentAt = nativeAttentionNotificationLastSentAtBySessionId.get(sessionId);
  if (
    previousSessionSentAt !== undefined &&
    now - previousSessionSentAt < NATIVE_ATTENTION_NOTIFICATION_SESSION_COOLDOWN_MS
  ) {
    return false;
  }

  if (
    nativeAttentionNotificationWindowStartedAt <= 0 ||
    now - nativeAttentionNotificationWindowStartedAt >= NATIVE_ATTENTION_NOTIFICATION_GLOBAL_WINDOW_MS
  ) {
    nativeAttentionNotificationWindowStartedAt = now;
    nativeAttentionNotificationWindowCount = 0;
  }
  if (nativeAttentionNotificationWindowCount >= NATIVE_ATTENTION_NOTIFICATION_GLOBAL_LIMIT) {
    return false;
  }

  nativeAttentionNotificationWindowCount += 1;
  nativeAttentionNotificationLastSentAtBySessionId.set(sessionId, now);
  return true;
}

function previewNativeSoundSettingChange(
  previousSettings: ghostexSettings,
  nextSettings: ghostexSettings,
): void {
  /**
   * CDXC:Settings 2026-04-29-16:30
   * Sound picker changes should immediately preview the selected sound so
   * users can choose completion and action alerts by ear without waiting for a
   * terminal session or action to finish.
   */
  if (previousSettings.completionSound !== nextSettings.completionSound) {
    playNativeSound(nextSettings.completionSound);
    return;
  }

  if (previousSettings.actionCompletionSound !== nextSettings.actionCompletionSound) {
    playNativeSound(nextSettings.actionCompletionSound);
  }
}

function readStoredAgents(): StoredSidebarAgent[] {
  try {
    return normalizeStoredSidebarAgents(
      JSON.parse(localStorage.getItem(AGENTS_STORAGE_KEY) || "null"),
    );
  } catch {
    return [];
  }
}

function readStoredAgentOrder(): string[] {
  try {
    return normalizeStoredSidebarAgentOrder(
      JSON.parse(localStorage.getItem(AGENT_ORDER_STORAGE_KEY) || "null"),
    );
  } catch {
    return [];
  }
}

function writeStoredAgents(nextAgents: readonly StoredSidebarAgent[]): void {
  storedAgents = normalizeStoredSidebarAgents(nextAgents);
  localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(storedAgents));
  refreshAgents();
}

function writeStoredAgentOrder(nextOrder: readonly string[]): void {
  storedAgentOrder = normalizeStoredSidebarAgentOrder(nextOrder);
  localStorage.setItem(AGENT_ORDER_STORAGE_KEY, JSON.stringify(storedAgentOrder));
  refreshAgents();
}

function refreshAgents(): void {
  agents = createSidebarAgentButtons(storedAgents, storedAgentOrder);
}

function readStoredCommands(): StoredSidebarCommand[] {
  try {
    return normalizeStoredSidebarCommands(
      JSON.parse(localStorage.getItem(COMMANDS_STORAGE_KEY) || "null"),
    );
  } catch {
    return [];
  }
}

function readStoredCommandOrder(): string[] {
  try {
    return normalizeStoredSidebarCommandOrder(
      JSON.parse(localStorage.getItem(COMMAND_ORDER_STORAGE_KEY) || "null"),
    );
  } catch {
    return [];
  }
}

function readDeletedDefaultCommandIds(): string[] {
  try {
    return normalizeStoredSidebarCommandOrder(
      JSON.parse(localStorage.getItem(DELETED_DEFAULT_COMMANDS_STORAGE_KEY) || "null"),
    );
  } catch {
    return [];
  }
}

function writeStoredCommands(nextCommands: readonly StoredSidebarCommand[]): void {
  storedCommands = normalizeStoredSidebarCommands(nextCommands);
  localStorage.setItem(COMMANDS_STORAGE_KEY, JSON.stringify(storedCommands));
  refreshCommands();
}

function writeStoredCommandOrder(nextOrder: readonly string[]): void {
  storedCommandOrder = normalizeStoredSidebarCommandOrder(nextOrder);
  localStorage.setItem(COMMAND_ORDER_STORAGE_KEY, JSON.stringify(storedCommandOrder));
  refreshCommands();
}

function writeDeletedDefaultCommandIds(nextCommandIds: readonly string[]): void {
  deletedDefaultCommandIds = normalizeStoredSidebarCommandOrder(nextCommandIds);
  localStorage.setItem(
    DELETED_DEFAULT_COMMANDS_STORAGE_KEY,
    JSON.stringify(deletedDefaultCommandIds),
  );
  refreshCommands();
}

function refreshCommands(): void {
  commands = createNativeSidebarCommandButtons();
}

function readStoredProjects(): { activeProjectId: string; projects: NativeProject[] } {
  const fallbackProject = createInitialProject();
  try {
    const sharedProjectsJson = window.__ghostex_NATIVE_HOST__?.sharedSidebarStorage?.projects;
    const candidate = JSON.parse(
      sharedProjectsJson || localStorage.getItem(PROJECTS_STORAGE_KEY) || "null",
    );
    const candidateProjects: NativeProject[] = Array.isArray(candidate?.projects)
      ? candidate.projects.flatMap((project: unknown) => normalizeStoredNativeProject(project))
      : [];
    const projects = candidateProjects.length > 0 ? candidateProjects : [fallbackProject];
    const restoredActiveProjectId =
      typeof candidate?.activeProjectId === "string" &&
      projects.some((project) => project.projectId === candidate.activeProjectId)
        ? candidate.activeProjectId
        : projects[0]!.projectId;
    /**
     * CDXC:RecentProjects 2026-05-14-08:08:
     * Startup must preserve each stored project's explicit Recent Projects status. Projects with zero sessions should stay in the main Combined project list unless the user closed that project into Recent Projects.
     */
    const activeProjectId = resolveStartupActiveProjectId(
      projects,
      restoredActiveProjectId,
      true,
    );
    const startupProjects = normalizeStartupTerminalSleepState(
      projects,
      activeProjectId,
    );
    restoreProjectEditorSurfaceStates(startupProjects, activeProjectId);
    if (candidateProjects.length > 0) {
      persistSharedProjectsSnapshot(activeProjectId, startupProjects);
    }
    const source =
      candidateProjects.length > 0
        ? sharedProjectsJson
          ? "sharedStorage"
          : "localStorage"
        : "fallback";
    appendStartupPaneLayoutDebugLog("projectsRead", {
      activeProjectId,
      projectCount: startupProjects.length,
      projects: startupProjects.map(summarizeStartupProjectPaneLayout),
      restoredActiveProjectId,
      source,
      storedActiveProjectId: candidate?.activeProjectId,
    });
    appendRestoreDebugLog("nativeSidebar.projects.read", {
      activeProjectId,
      projectCount: startupProjects.length,
      projects: startupProjects.map(summarizeNativeProject),
      source,
    });
    return { activeProjectId, projects: startupProjects };
  } catch (error) {
    appendRestoreDebugLog("nativeSidebar.projects.readFailed", {
      error: error instanceof Error ? error.message : String(error),
      fallbackProject: summarizeNativeProject(fallbackProject),
    });
    return { activeProjectId: fallbackProject.projectId, projects: [fallbackProject] };
  }
}

function resolveStartupActiveProjectId(
  startupProjects: readonly NativeProject[],
  restoredActiveProjectId: string,
  shouldSkipRecentProjects: boolean,
): string {
  const restoredActiveProject = startupProjects.find(
    (project) => project.projectId === restoredActiveProjectId,
  );
  if (
    restoredActiveProject &&
    (!shouldSkipRecentProjects || restoredActiveProject.isRecentProject !== true)
  ) {
    return restoredActiveProjectId;
  }

  const fallbackProject = shouldSkipRecentProjects
    ? startupProjects.find((project) => project.isRecentProject !== true)
    : startupProjects[0];
  return fallbackProject?.projectId ?? restoredActiveProjectId;
}

function normalizeStartupTerminalSleepState(
  storedProjects: readonly NativeProject[],
  storedActiveProjectId: string,
): NativeProject[] {
  /**
   * CDXC:SessionSleep 2026-04-27-09:12
   * Native startup restores layout state, not every terminal process. Background
   * workspaces, inactive groups, and off-screen terminal cards start sleeping;
   * only the last active workspace group's visible terminal cards are eligible
   * to wake immediately.
   *
   * CDXC:SessionPersistence 2026-05-15-18:42
   * Provider-backed tabs make an attached terminal expensive. Treat "visible"
   * on startup as the surfaced pane owner from paneLayout, not every background
   * tab/card stored in visibleSessionIds. This preserves automatic attach for
   * terminals the user can see while parked tabs stay asleep until selected.
   */
  return storedProjects.map((project) => ({
    ...project,
    workspace: {
      ...project.workspace,
      groups: project.workspace.groups.map((group) => {
        const isActiveVisibleGroup =
          project.projectId === storedActiveProjectId &&
          group.groupId === project.workspace.activeGroupId;
        const startupAwakeSessionIds = isActiveVisibleGroup
          ? getStartupAwakeTerminalSessionIds(group.snapshot)
          : new Set<string>();
        return {
          ...group,
          snapshot: {
            ...group.snapshot,
            sessions: group.snapshot.sessions.map((session) =>
              session.kind === "terminal"
                ? {
                    ...session,
                    isSleeping: !startupAwakeSessionIds.has(session.sessionId),
                  }
                : session,
            ),
          },
        };
      }),
    },
  }));
}

function getStartupAwakeTerminalSessionIds(
  snapshot: NativeProject["workspace"]["groups"][number]["snapshot"],
): Set<string> {
  const surfacedPaneSessionIds = snapshot.paneLayout
    ? collectStartupSurfacedPaneSessionIds(snapshot.paneLayout)
    : [];
  const candidateSessionIds =
    surfacedPaneSessionIds.length > 0 ? surfacedPaneSessionIds : snapshot.visibleSessionIds;
  const terminalSessionIds = new Set(
    snapshot.sessions
      .filter((session) => session.kind === "terminal")
      .map((session) => session.sessionId),
  );
  return new Set(candidateSessionIds.filter((sessionId) => terminalSessionIds.has(sessionId)));
}

function collectStartupSurfacedPaneSessionIds(layout: SessionPaneLayoutNode): string[] {
  switch (layout.kind) {
    case "leaf":
      return [layout.sessionId];
    case "tabs": {
      const activeSessionId =
        layout.activeSessionId && layout.sessionIds.includes(layout.activeSessionId)
          ? layout.activeSessionId
          : layout.sessionIds[0];
      return activeSessionId ? [activeSessionId] : [];
    }
    case "split":
      return layout.children.flatMap(collectStartupSurfacedPaneSessionIds);
  }
}

function writeStoredProjects(reason: string): void {
  persistSharedProjectsSnapshot(activeProjectId, projects);
  /**
   * CDXC:WorkspaceRestore 2026-05-08-16:41
   * ghostex-dev and default ghostex must share workspace/session state. Persist the
   * canonical project snapshot to the native shared state file, but do not log
   * successful writes. Workspace snapshots contain the full project/session tree
   * and can be rewritten often during normal session activity; only persistence
   * failures should create durable diagnostics.
   */
  void reason;
}

function persistSharedProjectsSnapshot(
  nextActiveProjectId: string,
  nextProjects: readonly NativeProject[],
): void {
  const payloadJson = JSON.stringify({
    activeProjectId: nextActiveProjectId,
    projects: nextProjects,
  });
  /**
   * CDXC:NativeGpu 2026-05-08-16:45
   * Re-persisting an identical project tree wakes the native bridge and
   * rewrites native-sidebar-projects.json without changing user state.
   * Suppress byte-identical snapshots here so idle status/layout publishes
   * cannot keep WindowServer and filesystem work active.
   */
  const sharedProjectsJson = window.__ghostex_NATIVE_HOST__?.sharedSidebarStorage?.projects;
  const localProjectsJson = localStorage.getItem(PROJECTS_STORAGE_KEY);
  if (payloadJson === sharedProjectsJson) {
    if (payloadJson !== localProjectsJson) {
      localStorage.setItem(PROJECTS_STORAGE_KEY, payloadJson);
    }
    lastPersistedProjectsPayloadJson = payloadJson;
    return;
  }
  if (payloadJson === lastPersistedProjectsPayloadJson && payloadJson === localProjectsJson) {
    lastPersistedProjectsPayloadJson = payloadJson;
    return;
  }
  localStorage.setItem(PROJECTS_STORAGE_KEY, payloadJson);
  lastPersistedProjectsPayloadJson = payloadJson;
  postNative({ key: "projects", payloadJson, type: "persistSharedSidebarStorage" });
}

function normalizeStoredNativeProject(candidate: unknown): NativeProject[] {
  if (!candidate || typeof candidate !== "object") {
    return [];
  }
  const project = candidate as Partial<NativeProject>;
  const path = project.path?.trim();
  if (!path) {
    return [];
  }
  const projectId = project.projectId?.trim() || createProjectId(path);
  return [
    {
      icon: normalizeWorkspaceDockIcon(project.icon) ?? normalizeLegacyWorkspaceDockIcon(project),
      iconDataUrl: normalizeWorkspaceDockIconDataUrl(project.iconDataUrl),
      commandsPanel: normalizeStoredCommandsPanelState(project.commandsPanel),
      isChat: project.isChat === true,
      isRecentProject: project.isRecentProject === true,
      name: project.name?.trim() || projectNameFromPath(path),
      path,
      projectEditorCompanionPaneHidden: project.projectEditorCompanionPaneHidden === true,
      projectEditor: normalizeStoredProjectEditorRestoreState(project.projectEditor),
      projectId,
      recentClosedAt:
        typeof project.recentClosedAt === "string" &&
        !Number.isNaN(Date.parse(project.recentClosedAt))
          ? project.recentClosedAt
          : undefined,
      theme: normalizeWorkspaceDockTheme(project.theme),
      themeColor: normalizeWorkspaceThemeColor(project.themeColor),
      workspace: normalizeSimpleGroupedSessionWorkspaceSnapshot(project.workspace),
    },
  ];
}

function normalizeStoredProjectEditorRestoreState(
  candidate: unknown,
): NativeProjectEditorRestoreState | undefined {
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const source = candidate as Partial<NativeProjectEditorRestoreState>;
  return source.isOpen === true ? { isOpen: true } : undefined;
}

function restoreProjectEditorSurfaceStates(
  startupProjects: readonly NativeProject[],
  startupActiveProjectId: string,
): void {
  projectEditorSurfaceByProjectId.clear();
  awakeProjectEditorModesByProjectId.clear();
  for (const project of startupProjects) {
    if (
      project.projectEditor?.isOpen !== true ||
      project.isChat === true ||
      project.isRecentProject === true
    ) {
      continue;
    }
    const isActiveProject = project.projectId === startupActiveProjectId;
    /**
     * CDXC:EditorPanes 2026-05-14-13:22:
     * If embedded Code was open when ghostex quit, restart must bring that Code row
     * back in the sidebar. Hydrate project-editor surface state from the durable
     * project snapshot; the active project recreates its Code pane immediately,
     * while background projects stay sleeping until the user focuses them.
     */
    projectEditorSurfaceByProjectId.set(project.projectId, {
      errorMessage: undefined,
      isOpen: true,
      isSleeping: !isActiveProject,
      mode: "code",
      nativeEditorId: createNativeProjectEditorId(project.projectId, "code"),
      status: isActiveProject ? "opening" : "idle",
    });
    if (isActiveProject) {
      rememberAwakeProjectEditorMode(project.projectId, "code");
    }
  }
}

function normalizeStoredCommandsPanelState(candidate: unknown): CommandsPanelState {
  const defaults = createDefaultCommandsPanelState();
  if (!candidate || typeof candidate !== "object") {
    return defaults;
  }
  const source = candidate as Partial<CommandsPanelState>;
  const sessions = Array.isArray(source.sessions)
    ? source.sessions
        .map((session, index) =>
          normalizeSessionRecord({
            ...session,
            kind: "terminal",
            surface: "commands",
            slotIndex: index,
          } as TerminalSessionRecord),
        )
        .filter((session): session is TerminalSessionRecord => session.kind === "terminal")
        .map((session, index) => {
          const position = getSlotPosition(index);
          return {
            ...session,
            column: position.column,
            row: position.row,
            slotIndex: index,
            surface: "commands" as const,
          };
        })
    : [];
  const sessionIds = new Set(sessions.map((session) => session.sessionId));
  const activeSessionId =
    source.activeSessionId && sessionIds.has(source.activeSessionId)
      ? source.activeSessionId
      : sessions[0]?.sessionId;
  const paneLayout = normalizeCommandPaneLayout(source.paneLayout, sessionIds, activeSessionId);
  return {
    activeSessionId,
    heightRatio: normalizeCommandsPanelHeightRatio(source.heightRatio),
    isVisible: source.isVisible === true,
    mode: normalizeCommandsPanelMode(source.mode),
    ...(paneLayout ? { paneLayout } : {}),
    sessions,
  };
}

function normalizeCommandsPanelMode(mode: unknown): CommandsPanelMode {
  return mode === "floating" ? "floating" : "pinned";
}

function normalizeCommandsPanelHeightRatio(heightRatio: unknown): number {
  const numericHeightRatio =
    typeof heightRatio === "number" ? heightRatio : DEFAULT_COMMANDS_PANEL_HEIGHT_RATIO;
  return Math.max(
    MIN_COMMANDS_PANEL_HEIGHT_RATIO,
    Math.min(
      MAX_COMMANDS_PANEL_HEIGHT_RATIO,
      Number.isFinite(numericHeightRatio)
        ? numericHeightRatio
        : DEFAULT_COMMANDS_PANEL_HEIGHT_RATIO,
    ),
  );
}

function createInitialProject(): NativeProject {
  return {
    commandsPanel: createDefaultCommandsPanelState(),
    isChat: false,
    name: initialWorkspaceName,
    path: initialWorkspacePath,
    projectId: createProjectId(initialWorkspacePath),
    theme: resolveSidebarTheme(DEFAULT_ghostex_SETTINGS.sidebarTheme, "dark"),
    workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
  };
}

function normalizeLegacyWorkspaceDockIcon(
  project: Partial<NativeProject>,
): WorkspaceDockIcon | undefined {
  const legacyIconDataUrl = normalizeWorkspaceDockIconDataUrl(project.iconDataUrl);
  return legacyIconDataUrl ? { dataUrl: legacyIconDataUrl, kind: "image" } : undefined;
}

function normalizeWorkspaceDockTheme(value: unknown): SidebarTheme | undefined {
  return WORKSPACE_DOCK_THEME_OPTIONS.some((theme) => theme.value === value)
    ? (value as SidebarTheme)
    : undefined;
}

function summarizeNativeProject(project: NativeProject) {
  return {
    activeGroupId: project.workspace.activeGroupId,
    groupCount: project.workspace.groups.length,
    groups: project.workspace.groups.map((group) => ({
      focusedSessionId: group.snapshot.focusedSessionId,
      groupId: group.groupId,
      sessionCount: group.snapshot.sessions.length,
      sessions: group.snapshot.sessions.map((session) => ({
        agentName: session.kind === "terminal" ? session.agentName : undefined,
        isSleeping: session.isSleeping === true,
        kind: session.kind,
        sessionId: session.sessionId,
        title: session.title,
      })),
      title: group.title,
      visibleSessionIds: group.snapshot.visibleSessionIds,
    })),
    commandsPanel: {
      activeSessionId: project.commandsPanel.activeSessionId,
      isVisible: project.commandsPanel.isVisible,
      mode: project.commandsPanel.mode,
      sessionCount: project.commandsPanel.sessions.length,
    },
    isChat: project.isChat === true,
    isRecentProject: project.isRecentProject === true,
    name: project.name,
    path: project.path,
    projectId: project.projectId,
    recentClosedAt: project.recentClosedAt,
    theme: project.theme,
    themeColor: project.themeColor,
  };
}

function readScratchPadContent(): string {
  return localStorage.getItem(SCRATCH_PAD_STORAGE_KEY) || "";
}

function saveScratchPadContent(content: string): void {
  /**
   * CDXC:ScratchPadFocus 2026-04-28-05:21
   * Scratch Pad saves must be visible in the same terminal-focus repro trace
   * as textarea focus changes. Record only lengths so debugging can confirm
   * whether typing reached storage without persisting note text in logs.
   */
  appendTerminalFocusDebugLog("scratchPadFocus.nativeSave", {
    nextLength: content.length,
    previousLength: scratchPadContent.length,
  });
  scratchPadContent = content;
  localStorage.setItem(SCRATCH_PAD_STORAGE_KEY, scratchPadContent);
  publish();
}

function readPinnedPrompts(): SidebarPinnedPrompt[] {
  try {
    return normalizeSidebarPinnedPrompts(
      JSON.parse(localStorage.getItem(PINNED_PROMPTS_STORAGE_KEY) || "null"),
    );
  } catch {
    return [];
  }
}

function savePinnedPrompt(
  message: Extract<SidebarToExtensionMessage, { type: "savePinnedPrompt" }>,
): void {
  const now = new Date().toISOString();
  const promptId = message.promptId ?? `native-prompt-${Date.now().toString(36)}`;
  const existingPrompt = pinnedPrompts.find((prompt) => prompt.promptId === promptId);
  const nextPrompt: SidebarPinnedPrompt = {
    content: message.content,
    createdAt: existingPrompt?.createdAt ?? now,
    promptId,
    title: message.title.trim(),
    updatedAt: now,
  };
  pinnedPrompts = normalizeSidebarPinnedPrompts(
    existingPrompt
      ? pinnedPrompts.map((prompt) => (prompt.promptId === promptId ? nextPrompt : prompt))
      : [nextPrompt, ...pinnedPrompts],
  );
  localStorage.setItem(PINNED_PROMPTS_STORAGE_KEY, JSON.stringify(pinnedPrompts));
  publish();
}

function readCollapsedSections(): SidebarSectionCollapseState {
  try {
    const candidate = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY) || "null");
    if (!candidate || typeof candidate !== "object") {
      return { actions: false, agents: false };
    }
    return {
      actions: (candidate as Partial<SidebarSectionCollapseState>).actions === true,
      agents: (candidate as Partial<SidebarSectionCollapseState>).agents === true,
    };
  } catch {
    return { actions: false, agents: false };
  }
}

function setSidebarSectionCollapsed(section: SidebarCollapsibleSection, collapsed: boolean): void {
  collapsedSections = {
    ...collapsedSections,
    [section]: collapsed,
  };
  localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(collapsedSections));
  publish();
}

function readActiveSessionsSortMode(): SidebarActiveSessionsSortMode {
  /**
   * CDXC:NativeSidebar 2026-04-28-05:14
   * Last-active ordering must match the reference repo: missing or legacy sort
   * preferences default to last-activity ordering, and only an explicit manual
   * preference preserves manual card order.
   */
  return localStorage.getItem(ACTIVE_SESSIONS_SORT_MODE_STORAGE_KEY) === "manual"
    ? "manual"
    : "lastActivity";
}

function toggleActiveSessionsSortMode(): void {
  activeSessionsSortMode = activeSessionsSortMode === "manual" ? "lastActivity" : "manual";
  localStorage.setItem(ACTIVE_SESSIONS_SORT_MODE_STORAGE_KEY, activeSessionsSortMode);
  publish();
}

function readSidebarSide(): SidebarSide {
  return settings.sidebarSide;
}

function moveSidebarToOtherSide(): void {
  /**
   * CDXC:SidebarPlacement 2026-05-06-17:32
   * The move-sidebar hotkey is now another way to change the same Settings
   * value, so the visible Settings control, shared snapshot, and AppKit chrome
   * stay aligned after either interaction.
   */
  saveSettings({
    ...settings,
    sidebarSide: settings.sidebarSide === "left" ? "right" : "left",
  });
}

function readGitPrimaryAction(): SidebarGitAction {
  const value = localStorage.getItem(GIT_PRIMARY_ACTION_STORAGE_KEY);
  return value === "push" || value === "pr" ? value : "commit";
}

function readBooleanStorage(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function setGitPrimaryAction(action: SidebarGitAction): void {
  gitPrimaryAction = action;
  localStorage.setItem(GIT_PRIMARY_ACTION_STORAGE_KEY, action);
  void refreshGitState();
}

function setGitCommitConfirmationEnabled(enabled: boolean): void {
  gitConfirmCommit = enabled;
  localStorage.setItem(GIT_CONFIRM_COMMIT_STORAGE_KEY, String(enabled));
  void refreshGitState();
}

function setGitGenerateCommitBodyEnabled(enabled: boolean): void {
  gitGenerateCommitBody = enabled;
  localStorage.setItem(GIT_GENERATE_COMMIT_BODY_STORAGE_KEY, String(enabled));
  void refreshGitState();
}

async function refreshGitState(): Promise<void> {
  /**
   * CDXC:NativeSidebarGit 2026-04-26-00:47
   * Git controls run through the native process bridge so commit/push/PR
   * commands execute in the selected project without showing macOS Terminal.
   */
  const baseState = createDefaultSidebarGitState(
    gitPrimaryAction,
    gitConfirmCommit,
    gitGenerateCommitBody,
  );
  gitState = { ...gitState, ...baseState, isBusy: true };
  publish();

  try {
    const repoCheck = await runGit(["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
    if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
      gitState = { ...baseState, isRepo: false };
      publish();
      return;
    }

    const [branch, status, diff, upstream, remotes, ghPath, pr] = await Promise.all([
      runGit(["branch", "--show-current"], { allowFailure: true }),
      runGit(["status", "--porcelain"], { allowFailure: true }),
      runGit(["diff", "--numstat", "HEAD"], { allowFailure: true }),
      runGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { allowFailure: true }),
      runGit(["remote"], { allowFailure: true }),
      runNativeProcess("/usr/bin/env", ["which", "gh"]),
      runGh(["pr", "view", "--json", "number,state,title,url"], { allowFailure: true }),
    ]);

    const totals = parseGitNumstat(diff.stdout);
    const upstreamParts = upstream.exitCode === 0 ? upstream.stdout.trim().split(/\s+/) : [];
    const prValue = parseGitHubPullRequest(pr.stdout, pr.exitCode === 0);
    gitState = {
      ...baseState,
      additions: totals.additions,
      aheadCount: Number(upstreamParts[0] || 0) || 0,
      behindCount: Number(upstreamParts[1] || 0) || 0,
      branch: branch.stdout.trim() || null,
      deletions: totals.deletions,
      hasGitHubCli: ghPath.exitCode === 0,
      hasOriginRemote: remotes.stdout.split(/\s+/).includes("origin"),
      hasUpstream: upstream.exitCode === 0,
      hasWorkingTreeChanges: status.stdout.trim().length > 0,
      isBusy: false,
      isRepo: true,
      pr: prValue,
    };
  } catch (error) {
    gitState = { ...baseState, isBusy: false, isRepo: false };
    showNativeMessage(
      "error",
      error instanceof Error ? error.message : "Failed to refresh git state.",
    );
  }
  publish();
}

function parseGitNumstat(stdout: string): { additions: number; deletions: number } {
  const stats = parseGitNumstatDiffStats(stdout);
  return { additions: stats.additions, deletions: stats.deletions };
}

function getProjectDiffStats(projectId: string): SidebarProjectDiffStats {
  return projectDiffStatsByProjectId.get(projectId) ?? createDefaultSidebarProjectDiffStats();
}

async function refreshVisibleProjectDiffStats(): Promise<void> {
  await Promise.all(
    projects
      .filter((project) => project.isChat !== true && project.isRecentProject !== true)
      .map((project) => refreshProjectDiffStats(project.projectId)),
  );
}

async function refreshProjectDiffStats(projectId: string): Promise<void> {
  const project = findProject(projectId);
  if (!project || project.isChat === true) {
    return;
  }
  if (pendingProjectDiffRefreshProjectIds.has(projectId)) {
    return;
  }

  pendingProjectDiffRefreshProjectIds.add(projectId);
  projectDiffStatsByProjectId.set(projectId, {
    ...getProjectDiffStats(projectId),
    isLoading: true,
  });
  publish();

  try {
    const repoCheck = await runGitInProject(project, ["rev-parse", "--is-inside-work-tree"], {
      allowFailure: true,
    });
    if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
      projectDiffStatsByProjectId.set(projectId, createDefaultSidebarProjectDiffStats(false));
      return;
    }

    const [trackedDiff, untrackedFiles] = await Promise.all([
      runGitInProject(project, ["diff", "--numstat", "HEAD"], { allowFailure: true }),
      runGitInProject(project, ["ls-files", "--others", "--exclude-standard", "-z"], {
        allowFailure: true,
      }),
    ]);
    const trackedStats = parseGitNumstatDiffStats(trackedDiff.stdout);
    const untrackedPaths = parseGitZeroDelimitedPaths(untrackedFiles.stdout);
    const untrackedStats: SidebarProjectDiffStats = {
      additions: await countUntrackedProjectLines(project, untrackedPaths),
      deletions: 0,
      files: untrackedPaths.length,
      isLoading: false,
      isRepo: true,
    };

    projectDiffStatsByProjectId.set(
      projectId,
      mergeSidebarProjectDiffStats(trackedStats, untrackedStats),
    );
  } catch (error) {
    appendRestoreDebugLog("nativeSidebar.projectDiff.refreshFailed", {
      error: error instanceof Error ? error.message : String(error),
      projectId,
      projectPath: project.path,
    });
    projectDiffStatsByProjectId.set(projectId, {
      ...getProjectDiffStats(projectId),
      isLoading: false,
    });
  } finally {
    pendingProjectDiffRefreshProjectIds.delete(projectId);
    publish();
  }
}

async function countUntrackedProjectLines(
  project: NativeProject,
  paths: readonly string[],
): Promise<number> {
  let lines = 0;
  for (let index = 0; index < paths.length; index += PROJECT_DIFF_UNTRACKED_WC_CHUNK_SIZE) {
    const chunk = paths.slice(index, index + PROJECT_DIFF_UNTRACKED_WC_CHUNK_SIZE);
    if (chunk.length === 0) {
      continue;
    }
    const result = await runNativeProcess(
      "/usr/bin/wc",
      ["-l", ...chunk.map((path) => (path.startsWith("-") ? `./${path}` : path))],
      { cwd: project.path },
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "wc -l failed");
    }
    lines += parseWcLineCountStdout(result.stdout);
  }
  return lines;
}

function parseGitHubPullRequest(stdout: string, success: boolean): SidebarGitState["pr"] {
  if (!success || !stdout.trim()) {
    return null;
  }
  try {
    const candidate = JSON.parse(stdout) as Partial<NonNullable<SidebarGitState["pr"]>>;
    const state = String(candidate.state || "").toLowerCase();
    if (!candidate.url || !candidate.title || !["open", "closed", "merged"].includes(state)) {
      return null;
    }
    return {
      number: typeof candidate.number === "number" ? candidate.number : undefined,
      state: state as NonNullable<SidebarGitState["pr"]>["state"],
      title: candidate.title,
      url: candidate.url,
    };
  } catch {
    return null;
  }
}

function createGitCommitDraft(action: SidebarGitAction): { body?: string; subject: string } {
  const project = activeProject();
  const subject = `Update ${project.name}`;
  return {
    body: gitGenerateCommitBody
      ? `Native ghostex commit from ${project.path}.\n\nAdditions: ${gitState.additions}\nDeletions: ${gitState.deletions}`
      : undefined,
    subject,
  };
}

async function runSidebarGitAction(action: SidebarGitAction): Promise<void> {
  await refreshGitState();
  if (!gitState.isRepo) {
    showNativeMessage("warning", "Open a Git repository to use Git actions.");
    return;
  }

  try {
    gitState = { ...gitState, isBusy: true };
    publish();
    if (action === "commit") {
      if ((await commitWorkingTree(action)) === "pending") {
        return;
      }
    } else if (action === "push") {
      if ((await commitWorkingTreeIfNeeded(action)) === "pending") {
        return;
      }
      await pushCurrentBranch();
    } else {
      if ((await commitWorkingTreeIfNeeded(action)) === "pending") {
        return;
      }
      await pushCurrentBranch();
      await openOrCreatePullRequest();
    }
    await refreshGitState();
  } catch (error) {
    gitState = { ...gitState, isBusy: false };
    publish();
    showNativeMessage("error", error instanceof Error ? error.message : `Git ${action} failed.`);
  }
}

async function commitWorkingTreeIfNeeded(
  action: SidebarGitAction,
): Promise<"committed" | "pending" | "skipped"> {
  if (!gitState.hasWorkingTreeChanges) {
    return "skipped";
  }
  return commitWorkingTree(action);
}

async function commitWorkingTree(
  action: SidebarGitAction,
): Promise<"committed" | "pending" | "skipped"> {
  if (!gitState.hasWorkingTreeChanges) {
    showNativeMessage("info", "There are no working tree changes to commit.");
    return "skipped";
  }
  const draft = createGitCommitDraft(action);
  if (gitConfirmCommit) {
    const requestId = `git-commit-${Date.now().toString(36)}`;
    pendingGitCommitRequests.set(requestId, { action, ...draft });
    sidebarBus.post({
      action,
      confirmLabel:
        action === "commit" ? "Commit" : action === "push" ? "Commit & Push" : "Commit, Push & PR",
      description: `Commit changes in ${activeProject().name}.`,
      requestId,
      suggestedBody: draft.body,
      suggestedSubject: draft.subject,
      type: "promptGitCommit",
    });
    gitState = { ...gitState, isBusy: false };
    publish();
    return "pending";
  }
  await commitWithMessage(draft.subject, draft.body);
  return "committed";
}

async function commitWithMessage(subject: string, body?: string): Promise<void> {
  await runGit(["add", "-A"]);
  const args = ["commit", "-m", subject.trim() || "Update project"];
  if (body?.trim()) {
    args.push("-m", body.trim());
  }
  await runGit(args);
}

async function continueGitActionAfterCommitConfirmation(
  requestId: string,
  message: string,
): Promise<void> {
  const pending = pendingGitCommitRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingGitCommitRequests.delete(requestId);
  try {
    gitState = { ...gitState, isBusy: true };
    publish();
    await commitWithMessage(message.trim() || pending.subject, pending.body);
    if (pending.action === "push") {
      await pushCurrentBranch();
    }
    if (pending.action === "pr") {
      await pushCurrentBranch();
      await openOrCreatePullRequest();
    }
    await refreshGitState();
  } catch (error) {
    gitState = { ...gitState, isBusy: false };
    publish();
    showNativeMessage("error", error instanceof Error ? error.message : "Git commit failed.");
  }
}

async function pushCurrentBranch(): Promise<void> {
  const branch = gitState.branch;
  if (!branch) {
    throw new Error("Create and checkout a branch before pushing.");
  }
  if (gitState.hasUpstream) {
    await runGit(["push"]);
    return;
  }
  if (!gitState.hasOriginRemote) {
    throw new Error('Add an "origin" remote before pushing.');
  }
  await runGit(["push", "-u", "origin", branch]);
}

async function openOrCreatePullRequest(): Promise<void> {
  if (gitState.pr?.state === "open") {
    openNativeExternalUrl(gitState.pr.url);
    return;
  }
  if (!gitState.hasGitHubCli) {
    throw new Error("Install GitHub CLI to create or view pull requests.");
  }
  const result = await runGh(["pr", "create", "--fill"]);
  const url = result.stdout
    .split(/\s+/)
    .find((part) => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(part));
  if (url) {
    openNativeExternalUrl(url);
  }
}

function readPreviousSessions(): SidebarPreviousSessionItem[] {
  try {
    const sharedPreviousSessionsJson =
      window.__ghostex_NATIVE_HOST__?.sharedSidebarStorage?.previousSessions;
    const candidate = JSON.parse(
      sharedPreviousSessionsJson || localStorage.getItem(PREVIOUS_SESSIONS_STORAGE_KEY) || "null",
    );
    if (!Array.isArray(candidate)) {
      return [];
    }
    const sessions = candidate
      .filter(isSidebarPreviousSessionItem)
      .map(normalizeStoredPreviousSessionItem)
      .filter(shouldKeepStoredPreviousSessionItem)
      .slice(0, 80);
    if (!sharedPreviousSessionsJson && sessions.length > 0) {
      postNative({
        key: "previousSessions",
        payloadJson: JSON.stringify(sessions),
        type: "persistSharedSidebarStorage",
      });
    }
    return sessions;
  } catch {
    return [];
  }
}

function writePreviousSessions(nextSessions: readonly SidebarPreviousSessionItem[]): void {
  previousSessions = nextSessions.slice(0, 80);
  const payloadJson = JSON.stringify(previousSessions);
  localStorage.setItem(PREVIOUS_SESSIONS_STORAGE_KEY, payloadJson);
  postNative({ key: "previousSessions", payloadJson, type: "persistSharedSidebarStorage" });
}

function normalizeStoredPreviousSessionItem(
  item: SidebarPreviousSessionItem,
): SidebarPreviousSessionItem {
  const archivedRecord = normalizePreviousSessionRecord(item.sessionRecord);
  const isFavorite = item.isFavorite === true || archivedRecord?.isFavorite === true;
  if (item.isFavorite === isFavorite) {
    return item;
  }

  /**
   * CDXC:SessionFavorites 2026-05-15-12:43
   * Previous Sessions may have been persisted before the sidebar projection
   * copied favorite state onto the top-level history item. Backfill from the
   * archived session record so the history row icon keeps the favorite color
   * and the favorites-only filter includes older favorited sessions.
   */
  return {
    ...item,
    isFavorite: isFavorite ? true : undefined,
  };
}

function rememberPreviousSession(sessionId: string, project = activeProject()): void {
  const previousItem = createPreviousSessionItem(sessionId, project);
  if (!previousItem) {
    return;
  }
  writePreviousSessions([
    previousItem,
    ...previousSessions.filter((session) => session.historyId !== previousItem.historyId),
  ]);
}

function createPreviousSessionItem(
  sessionId: string,
  project: NativeProject,
): SidebarPreviousSessionItem | undefined {
  for (const group of project.workspace.groups) {
    const sessionRecord = group.snapshot.sessions.find((session) => session.sessionId === sessionId);
    if (!sessionRecord) {
      continue;
    }
    const terminalState = terminalStateById.get(sessionId);
    const archivedSessionRecord = createArchivedPreviousSessionRecord(
      sessionRecord,
      terminalState,
    );
    if (!shouldRememberPreviousSessionRecord(archivedSessionRecord)) {
      appendRestoreDebugLog("nativeSidebar.previousSession.skipped", {
        agentName:
          archivedSessionRecord.kind === "terminal" ? archivedSessionRecord.agentName : undefined,
        reason: "default-or-untrusted-title",
        sessionId,
        title: archivedSessionRecord.title,
        titleSource: archivedSessionRecord.titleSource,
      });
      return undefined;
    }
    const sidebarSession = createProjectedSidebarSessionsForGroup({
      ...group,
      snapshot: {
        ...group.snapshot,
        sessions: group.snapshot.sessions.map((session) =>
          session.sessionId === archivedSessionRecord.sessionId ? archivedSessionRecord : session,
        ),
      },
    }).find((session) => session.sessionId === sessionId);
    if (!sidebarSession) {
      continue;
    }
    return {
      ...sidebarSession,
      activity: "idle",
      closedAt: new Date().toISOString(),
      firstUserMessage: archivedSessionRecord.firstUserMessage ?? sidebarSession.firstUserMessage,
      groupId: group.groupId,
      historyId: `native-history-${Date.now().toString(36)}-${sessionId}`,
      isGeneratedName: false,
      isRestorable: archivedSessionRecord.kind === "terminal",
      isRunning: false,
      lifecycleState: terminalState?.lifecycleState === "error" ? "error" : "done",
      projectId: project.projectId,
      projectName: project.name,
      projectPath: project.path,
      sessionRecord: archivedSessionRecord,
      terminalTitle: terminalState?.terminalTitle ?? sidebarSession.terminalTitle,
    };
  }
  return undefined;
}

function createArchivedPreviousSessionRecord(
  session: SessionRecord,
  terminalState: ReturnType<typeof terminalStateById.get>,
): SessionRecord {
  if (session.kind !== "terminal") {
    return {
      ...session,
      isSleeping: false,
    };
  }

  const archiveTitle = getNativePreviousSessionArchiveTitle(session, terminalState);
  return {
    ...session,
    agentName: terminalState?.agentName ?? session.agentName,
    agentSessionId: terminalState?.agentSessionId ?? session.agentSessionId,
    agentSessionPath: terminalState?.agentSessionPath ?? session.agentSessionPath,
    firstUserMessage: session.firstUserMessage ?? terminalState?.firstUserMessage,
    isSleeping: false,
    title: archiveTitle.title ?? session.title,
    titleSource: archiveTitle.title
      ? (archiveTitle.titleSource ?? session.titleSource)
      : session.titleSource,
  };
}

function getNativePreviousSessionArchiveTitle(
  session: TerminalSessionRecord,
  terminalState: ReturnType<typeof terminalStateById.get>,
): {
  title?: string;
  titleSource?: TerminalSessionRecord["titleSource"];
} {
  const storedTitle = getNativeStoredTrustedResumeTitle(session);
  if (storedTitle.title) {
    return { title: storedTitle.title, titleSource: session.titleSource };
  }

  const visibleTerminalTitle = getVisibleTerminalTitle(terminalState?.terminalTitle)?.trim();
  const agentName = terminalState?.agentName ?? session.agentName;
  if (visibleTerminalTitle && isValidNativeAgentTerminalTitle(visibleTerminalTitle, agentName)) {
    return { title: visibleTerminalTitle, titleSource: "terminal-auto" };
  }

  return {};
}

function shouldRememberPreviousSessionRecord(session: SessionRecord): boolean {
  if (session.kind !== "terminal") {
    return true;
  }

  /**
   * CDXC:PreviousSessions 2026-05-05-05:30
   * Previous Sessions must only contain terminals with a real user/agent
   * session name. Default creation titles such as `Terminal Session` and
   * `Codex Session` are placeholders, so closing those terminals should remove
   * the pane without adding a low-signal history card.
   */
  return getNativeStoredTrustedResumeTitle(session).title !== undefined;
}

function shouldKeepStoredPreviousSessionItem(session: SidebarPreviousSessionItem): boolean {
  const archivedRecord = normalizePreviousSessionRecord(session.sessionRecord);
  if (archivedRecord) {
    return shouldRememberPreviousSessionRecord(archivedRecord);
  }

  if (!session.isRestorable) {
    return true;
  }

  const displayTitle = session.primaryTitle?.trim() || session.terminalTitle?.trim();
  return Boolean(displayTitle && getVisibleTerminalTitle(displayTitle));
}

function normalizePreviousSessionRecord(candidate: unknown): SessionRecord | undefined {
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const record = candidate as Partial<SessionRecord>;
  if (
    record.kind === "terminal" &&
    typeof record.sessionId === "string" &&
    typeof record.displayId === "string" &&
    typeof record.alias === "string" &&
    typeof record.title === "string"
  ) {
    return record as TerminalSessionRecord;
  }
  if (
    record.kind === "browser" &&
    typeof record.sessionId === "string" &&
    typeof record.displayId === "string" &&
    typeof record.alias === "string" &&
    typeof record.title === "string" &&
    typeof (record as Partial<BrowserSessionRecord>).browser?.url === "string"
  ) {
    return record as BrowserSessionRecord;
  }
  if (
    record.kind === "t3" &&
    typeof record.sessionId === "string" &&
    typeof record.displayId === "string" &&
    typeof record.alias === "string" &&
    typeof record.title === "string" &&
    typeof (record as Partial<T3SessionRecord>).t3?.threadId === "string"
  ) {
    return record as T3SessionRecord;
  }
  return undefined;
}

function deletePreviousSession(historyId: string): void {
  writePreviousSessions(previousSessions.filter((session) => session.historyId !== historyId));
  publish();
}

function restorePreviousSession(historyId: string): void {
  const previousSession = previousSessions.find((session) => session.historyId === historyId);
  if (!previousSession?.isRestorable) {
    return;
  }
  const archivedRecord = normalizePreviousSessionRecord(previousSession.sessionRecord);
  if (archivedRecord?.kind === "terminal") {
    if (restorePreviousTerminalSession(previousSession, archivedRecord)) {
      deletePreviousSession(historyId);
    }
    return;
  }

  createTerminal(previousSession.primaryTitle || previousSession.alias || "Restored Session");
  deletePreviousSession(historyId);
}

function restorePreviousTerminalSession(
  previousSession: SidebarPreviousSessionItem,
  archivedRecord: TerminalSessionRecord,
): boolean {
  /**
   * CDXC:PreviousSessions 2026-05-05-05:30
   * Restoring a previous agent session is a session recreation operation, not a
   * title-only terminal launch. Use the archived terminal record to preserve the
   * agent id, first user message, favorite state, title provenance, and resume
   * command inputs while assigning a fresh live terminal id.
   */
  const project = activatePreviousSessionProject(previousSession);
  const groupId = resolvePreviousSessionRestoreGroupId(project, previousSession.groupId);
  const initialInput = buildNativeRestoredTerminalInitialInput(archivedRecord);
  const sessionPersistenceProvider = resolveTerminalSessionPersistenceProvider();
  /**
   * CDXC:PreviousSessions 2026-05-15-14:56
   * Restoring a previous session from sidebar search should reopen the session
   * as the active tab in the currently focused pane. Preserve the user's split
   * geometry by using focused tab-group placement instead of legacy creation,
   * which appends restored sessions as new split panes.
   */
  const visiblePlacement = createFocusedTabGroupPlacement(groupId);
  const restoredSession = createTerminal(
    archivedRecord.title || previousSession.primaryTitle || DEFAULT_TERMINAL_SESSION_TITLE,
    initialInput,
    groupId,
    archivedRecord.agentName,
    {
      sessionPersistenceName: sessionPersistenceNameForProvider(
        sessionPersistenceProvider,
        archivedRecord,
      ),
      sessionPersistenceProvider,
      visiblePlacement,
    },
  );
  if (!restoredSession) {
    return false;
  }

  const restoredRecord = mergeArchivedTerminalDetails(restoredSession, archivedRecord);
  updateProjectWorkspace(project.projectId, (workspace) =>
    replaceSessionRecordInWorkspace(workspace, restoredSession.sessionId, restoredRecord),
  );

  const terminalState = terminalStateById.get(restoredSession.sessionId);
  if (terminalState) {
    terminalState.agentName = restoredRecord.agentName;
    terminalState.agentSessionId = restoredRecord.agentSessionId;
    terminalState.agentSessionPath = restoredRecord.agentSessionPath;
    terminalState.firstUserMessage = restoredRecord.firstUserMessage;
    /**
     * CDXC:SessionTitleSync 2026-05-07-16:41
     * Restored previous sessions can carry trusted terminal-auto titles from a
     * real Codex/Claude thread. Treat that persisted name as authoritative so a
     * later prompt hook cannot auto-generate over it after restore.
     */
    terminalState.protectStoredTitleFromAutomation =
      getNativeStoredTrustedResumeTitle(restoredRecord).title !== undefined;
    terminalState.terminalTitle = restoredRecord.title;
  }
  publish();
  return true;
}

function activatePreviousSessionProject(previousSession: SidebarPreviousSessionItem): NativeProject {
  const projectId = previousSession.projectId?.trim();
  const existingProject = projectId ? findProject(projectId) : undefined;
  if (existingProject) {
    const didSwitchProject = activeProjectId !== existingProject.projectId;
    const didRestoreRecentProject = existingProject.isRecentProject === true;
    projects = projects.map((project) =>
      project.projectId === existingProject.projectId
        ? { ...project, isRecentProject: false, recentClosedAt: undefined }
        : project,
    );
    activeProjectId = existingProject.projectId;
    writeStoredProjects("restorePreviousSessionProject");
    postZedOverlaySettings("workspace-focus");
    if (didSwitchProject || didRestoreRecentProject) {
      scheduleSyncOpenProjectWithZed("restorePreviousSessionProject");
    }
    void refreshGitState();
    return activeProject();
  }

  const projectPath = previousSession.projectPath?.trim();
  if (!projectPath) {
    return activeProject();
  }

  const restoredProjectId = projectId || createProjectId(projectPath);
  projects = [
    ...projects,
    {
      commandsPanel: createDefaultCommandsPanelState(),
      isChat: false,
      name: previousSession.projectName?.trim() || projectNameFromPath(projectPath),
      path: projectPath,
      projectId: restoredProjectId,
      theme: resolveSidebarTheme(settings.sidebarTheme, "dark"),
      workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
    },
  ];
  activeProjectId = restoredProjectId;
  writeStoredProjects("restorePreviousSessionProject");
  postZedOverlaySettings("workspace-focus");
  scheduleSyncOpenProjectWithZed("restorePreviousSessionProject");
  void refreshGitState();
  return activeProject();
}

function resolvePreviousSessionRestoreGroupId(
  project: NativeProject,
  groupId: string | undefined,
): string | undefined {
  return groupId && project.workspace.groups.some((group) => group.groupId === groupId)
    ? groupId
    : undefined;
}

function mergeArchivedTerminalDetails(
  restoredSession: TerminalSessionRecord,
  archivedRecord: TerminalSessionRecord,
): TerminalSessionRecord {
  return {
    ...restoredSession,
    agentName: archivedRecord.agentName ?? restoredSession.agentName,
    agentSessionId: archivedRecord.agentSessionId ?? restoredSession.agentSessionId,
    agentSessionPath: archivedRecord.agentSessionPath ?? restoredSession.agentSessionPath,
    firstUserMessage: archivedRecord.firstUserMessage,
    isFavorite: archivedRecord.isFavorite,
    isSleeping: false,
    sessionPersistenceName: restoredSession.sessionPersistenceName,
    sessionPersistenceProvider: restoredSession.sessionPersistenceProvider,
    terminalEngine: archivedRecord.terminalEngine ?? restoredSession.terminalEngine,
    title: archivedRecord.title || restoredSession.title,
    titleSource: archivedRecord.titleSource ?? restoredSession.titleSource,
  };
}

function replaceSessionRecordInWorkspace(
  workspace: GroupedSessionWorkspaceSnapshot,
  sessionId: string,
  restoredRecord: SessionRecord,
): GroupedSessionWorkspaceSnapshot {
  return normalizeSimpleGroupedSessionWorkspaceSnapshot({
    ...workspace,
    groups: workspace.groups.map((group) => ({
      ...group,
      snapshot: {
        ...group.snapshot,
        sessions: group.snapshot.sessions.map((session) =>
          session.sessionId === sessionId ? restoredRecord : session,
        ),
      },
    })),
  });
}

function clearGeneratedPreviousSessions(): void {
  writePreviousSessions(previousSessions.filter((session) => !session.isGeneratedName));
  publish();
}

function isSidebarPreviousSessionItem(candidate: unknown): candidate is SidebarPreviousSessionItem {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const item = candidate as Partial<SidebarPreviousSessionItem>;
  return (
    typeof item.historyId === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.closedAt === "string" &&
    typeof item.alias === "string" &&
    typeof item.isGeneratedName === "boolean" &&
    typeof item.isRestorable === "boolean"
  );
}

function createNativeSidebarCommandButtons(): SidebarCommandButton[] {
  return createSidebarCommandButtons(
    storedCommands,
    storedCommandOrder,
    deletedDefaultCommandIds,
  ).map((command) => {
    if (command.command || command.actionType !== "terminal") {
      return command;
    }

    switch (command.commandId) {
      case "dev":
        /**
         * CDXC:DevAppFlavor 2026-05-14-10:11
         * The default Dev command is exposed in the native titlebar Actions
         * split button. It must run the dev app variant directly; `bun s` maps
         * to the prod start script, which quits the running Ghostex app before
         * rebuilding and makes a titlebar terminal action look like a crash.
         */
        return { ...command, command: "bun run start:dev" };
      case "build":
        return { ...command, command: "bun run build" };
      case "test":
        return { ...command, command: "bun run test" };
      case "setup":
        return { ...command, command: "bun install" };
      default:
        return command;
    }
  });
}

storedAgents = readStoredAgents();
storedAgentOrder = readStoredAgentOrder();
refreshAgents();
storedCommands = readStoredCommands();
storedCommandOrder = readStoredCommandOrder();
deletedDefaultCommandIds = readDeletedDefaultCommandIds();
refreshCommands();

function postZedOverlaySettings(
  reason: "settings-enable" | "settings-save" | "startup" | "workspace-focus" = "settings-save",
): void {
  /**
   * CDXC:IDEAttachment 2026-04-26-22:38
   * Attach commands always use the IDE selected in settings. VS Code targets
   * are posted through the existing native overlay channel so the native host
   * can resolve their process names and `code`/`code-insiders` commands.
   *
   * CDXC:IDEAttachment 2026-05-01-13:32
   * Workspace selection is only a settings sync, not a user request to attach.
   * Include the reason so native detach can reject stale workspace-focus
   * `enabled: true` messages while still allowing explicit Settings attach.
   *
   * CDXC:AccessibilityPermissions 2026-05-08-13:08
   * The first Settings transition from detached to attached is the only webview
   * settings save that should ask macOS for Accessibility. Subsequent saves
   * keep syncing attachment configuration without reopening the permission
   * prompt.
   */
  postNative({
    enabled: settings.zedOverlayEnabled,
    hideTitlebarButton: settings.zedOverlayHideTitlebarButton,
    reason,
    targetApp: settings.zedOverlayTargetApp,
    type: "configureZedOverlay",
    workspacePath: activeProject().path,
  });
}

function clearPendingZedProjectSync(): void {
  if (!pendingZedProjectSyncTimeout) {
    return;
  }
  window.clearTimeout(pendingZedProjectSyncTimeout);
  pendingZedProjectSyncTimeout = undefined;
}

function scheduleSyncOpenProjectWithZed(reason: string): void {
  clearPendingZedProjectSync();
  if (!settings.zedOverlayEnabled || !settings.syncOpenProjectWithZed) {
    return;
  }

  const scheduledProject = activeProject();
  /**
   * CDXC:IDEAttachment 2026-05-06-12:49
   * Switching ghostex workspaces syncs the selected project into the attached IDE
   * after a 2s trailing debounce. Rapid workspace activations coalesce into one
   * editor-open request for the final active project, and the user can disable
   * this separately from attachment.
   */
  pendingZedProjectSyncTimeout = window.setTimeout(() => {
    pendingZedProjectSyncTimeout = undefined;
    if (
      !settings.zedOverlayEnabled ||
      !settings.syncOpenProjectWithZed ||
      activeProjectId !== scheduledProject.projectId
    ) {
      return;
    }
    postNative({
      targetApp: settings.zedOverlayTargetApp,
      type: "openZedWorkspace",
      workspacePath: scheduledProject.path,
    });
  }, SYNC_OPEN_PROJECT_WITH_ZED_DEBOUNCE_MS);
  appendRestoreDebugLog("nativeSidebar.zedProjectSync.scheduled", {
    projectId: scheduledProject.projectId,
    reason,
  });
}

function createProjectId(path: string): string {
  return `project-${hashString(path)}`;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function projectNameFromPath(path: string): string {
  const normalizedPath = path.replace(/\/+$/, "");
  return normalizedPath.split("/").filter(Boolean).pop() || normalizedPath || "Project";
}

function nativeChatTitleFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `Chat ${year}-${month}-${day} ${hour}:${minute}`;
}

function nativeChatsRootDirectory(): string {
  return `${nativeHomeDirectory()}/ghostex/chats`;
}

function createNativeChatDirectoryPath(title: string, date = new Date()): string {
  const normalizedTitle = sanitizeNativePathPart(title || "chat").toLowerCase();
  return `${nativeChatsRootDirectory()}/${formatNativeChatTimestamp(date)}-${normalizedTitle}`;
}

function formatNativeChatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  const millisecond = String(date.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day}-${hour}${minute}${second}${millisecond}`;
}

function orderNativeProjectsForSidebar(projectsToOrder: readonly NativeProject[]): NativeProject[] {
  /**
   * CDXC:Chats 2026-05-04-09:30
   * Chat workspaces are intentionally projectless, so they must remain above
   * code projects in the rail and Combined project list while preserving the
   * user's relative order inside each category.
   */
  return [
    ...projectsToOrder.filter((project) => project.isChat === true),
    ...projectsToOrder.filter((project) => project.isChat !== true),
  ];
}

function activeProject(): NativeProject {
  return projects.find((project) => project.projectId === activeProjectId) ?? projects[0]!;
}

function nativeAppTitleForProject(project: NativeProject): string {
  /**
   * CDXC:NativeWindowChrome 2026-05-10-14:19
   * The native app title bar should name the active code project. Chat
   * workspaces are projectless conversation containers, so they keep the
   * product title "Ghostex" instead of exposing the generated chat folder name.
   * CDXC:Branding 2026-05-12-07:35
   * Public window and notification copy uses Ghostex while native sidebar
   * storage, bridge events, and internal implementation names remain ghostex.
   */
  if (project.isChat === true) {
    return "Ghostex";
  }
  return project.name.trim() || projectNameFromPath(project.path) || "Ghostex";
}

function findProject(projectId: string): NativeProject | undefined {
  return projects.find((project) => project.projectId === projectId);
}

function updateProjectWorkspace(
  projectId: string,
  updater: (workspace: GroupedSessionWorkspaceSnapshot) => GroupedSessionWorkspaceSnapshot,
): void {
  projects = projects.map((project) =>
    project.projectId === projectId ? { ...project, workspace: updater(project.workspace) } : project,
  );
  writeStoredProjects("updateProjectWorkspace");
}

function updateProjectCommandsPanel(
  projectId: string,
  updater: (commandsPanel: CommandsPanelState) => CommandsPanelState,
): void {
  projects = projects.map((project) =>
    project.projectId === projectId
      ? {
          ...project,
          commandsPanel: normalizeStoredCommandsPanelState(updater(project.commandsPanel)),
        }
      : project,
  );
  writeStoredProjects("updateProjectCommandsPanel");
}

function updateActiveProjectCommandsPanel(
  updater: (commandsPanel: CommandsPanelState) => CommandsPanelState,
): void {
  updateProjectCommandsPanel(activeProject().projectId, updater);
}

function updateActiveProjectWorkspace(
  updater: (workspace: GroupedSessionWorkspaceSnapshot) => GroupedSessionWorkspaceSnapshot,
): void {
  const currentProjectId = activeProject().projectId;
  updateProjectWorkspace(currentProjectId, updater);
}

function findSessionRecord(sessionId: string): SessionRecord | undefined {
  const reference = resolveSidebarSessionReference(sessionId);
  const commandSession = reference.project.commandsPanel.sessions.find(
    (candidate) => candidate.sessionId === reference.sessionId,
  );
  if (commandSession) {
    return commandSession;
  }
  for (const group of reference.project.workspace.groups) {
    const session = group.snapshot.sessions.find(
      (candidate) => candidate.sessionId === reference.sessionId,
    );
    if (session) {
      return session;
    }
  }
  return undefined;
}

function findSessionRecordInProject(
  project: NativeProject,
  sessionId: string,
): SessionRecord | undefined {
  const commandSession = project.commandsPanel.sessions.find(
    (session) => session.sessionId === sessionId,
  );
  if (commandSession) {
    return commandSession;
  }
  for (const group of project.workspace.groups) {
    const session = group.snapshot.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session) {
      return session;
    }
  }
  return undefined;
}

function resolveSidebarSessionReference(sessionId: string): {
  project: NativeProject;
  sessionId: string;
} {
  const combinedReference = parseCombinedProjectSessionId(sessionId);
  const project = combinedReference ? findProject(combinedReference.projectId) : undefined;
  return {
    project: project ?? activeProject(),
    sessionId: combinedReference?.sessionId ?? sessionId,
  };
}

function resolveSidebarGroupReference(groupId: string): {
  isChatCollection?: boolean;
  groupId?: string;
  project: NativeProject;
} {
  if (groupId === COMBINED_CHATS_GROUP_ID) {
    return {
      isChatCollection: true,
      project:
        projects.find((project) => project.isChat === true && project.projectId === activeProjectId) ??
        projects.find((project) => project.isChat === true) ??
        activeProject(),
    };
  }

  const combinedProjectId = parseCombinedProjectGroupId(groupId);
  const project = combinedProjectId ? findProject(combinedProjectId) : undefined;
  return {
    groupId: combinedProjectId ? undefined : groupId,
    project: project ?? activeProject(),
  };
}

function setTerminalSessionAgentName(sessionId: string, agentName: string | undefined): void {
  if (activeCommandPanelContainsSession(sessionId)) {
    const nextAgentName = agentName?.replace(/\s+/g, " ").trim() || undefined;
    updateActiveProjectCommandsPanel((panel) => ({
      ...panel,
      sessions: panel.sessions.map((session) =>
        session.sessionId === sessionId ? { ...session, agentName: nextAgentName } : session,
      ),
    }));
    return;
  }
  updateActiveProjectWorkspace(
    (workspace) =>
      setTerminalSessionAgentNameInSimpleWorkspace(workspace, sessionId, agentName).snapshot,
  );
}

function setTerminalSessionAgentSessionMetadata(
  sessionId: string,
  metadata: { agentSessionId?: string; agentSessionPath?: string },
): void {
  if (activeCommandPanelContainsSession(sessionId)) {
    updateActiveProjectCommandsPanel((panel) => ({
      ...panel,
      sessions: panel.sessions.map((session) =>
        session.sessionId === sessionId
          ? {
              ...session,
              agentSessionId: metadata.agentSessionId?.trim() || undefined,
              agentSessionPath: metadata.agentSessionPath?.trim() || undefined,
            }
          : session,
      ),
    }));
    return;
  }
  updateActiveProjectWorkspace(
    (workspace) =>
      setTerminalSessionAgentSessionMetadataInSimpleWorkspace(workspace, sessionId, metadata)
        .snapshot,
  );
}

function setTerminalSessionPersistenceName(
  sessionId: string,
  sessionPersistenceName: string | undefined,
): void {
  if (activeCommandPanelContainsSession(sessionId)) {
    updateActiveProjectCommandsPanel((panel) => ({
      ...panel,
      sessions: panel.sessions.map((session) =>
        session.sessionId === sessionId
          ? { ...session, sessionPersistenceName: sessionPersistenceName?.trim() || undefined }
          : session,
      ),
    }));
    return;
  }
  updateActiveProjectWorkspace(
    (workspace) =>
      setTerminalSessionPersistenceNameInSimpleWorkspace(
        workspace,
        sessionId,
        sessionPersistenceName,
      )
        .snapshot,
  );
}

function setTerminalSessionPersistenceProvider(
  sessionId: string,
  sessionPersistenceProvider: TerminalSessionPersistenceProvider | undefined,
): void {
  if (activeCommandPanelContainsSession(sessionId)) {
    updateActiveProjectCommandsPanel((panel) => ({
      ...panel,
      sessions: panel.sessions.map((session) =>
        session.sessionId === sessionId ? { ...session, sessionPersistenceProvider } : session,
      ),
    }));
    return;
  }
  updateActiveProjectWorkspace(
    (workspace) =>
      setTerminalSessionPersistenceProviderInSimpleWorkspace(
        workspace,
        sessionId,
        sessionPersistenceProvider,
      )
        .snapshot,
  );
}

function nativeSessionIdForSidebarSession(sessionId: string): string {
  const reference = resolveSidebarSessionReference(sessionId);
  return nativeSessionIdForProjectSidebarSession(reference.project.projectId, reference.sessionId);
}

function nativeSessionIdForProjectSidebarSession(projectId: string, sessionId: string): string {
  return createDurableNativeSessionId(projectId, sessionId);
}

function sidebarSessionIdForNativeSession(sessionId: string): string {
  const mappedSessionId = sidebarSessionIdByNativeSessionId.get(sessionId);
  if (mappedSessionId) {
    return mappedSessionId;
  }
  const durableReference = parseDurableNativeSessionId(sessionId);
  return durableReference?.sessionId ?? sessionId;
}

function parseDurableNativeSessionId(
  nativeSessionId: string,
): { project: NativeProject; sessionId: string } | undefined {
  /**
   * CDXC:SessionSleep 2026-05-11-07:06
   * Sleeping a terminal disposes its native surface and removes the live
   * native<->sidebar mapping, but sleeping tabs still carry the durable native
   * id in the pane layout. Decode that id at host-event boundaries so Close on a
   * sleeping tab can still remove the stored sidebar session.
   */
  const project = [...projects]
    .sort((left, right) => right.projectId.length - left.projectId.length)
    .find((candidate) => nativeSessionId.startsWith(`${candidate.projectId}:`));
  if (!project) {
    return undefined;
  }
  const sessionId = nativeSessionId.slice(project.projectId.length + 1);
  if (!sessionId) {
    return undefined;
  }
  return { project, sessionId };
}

function forgetNativeSessionMapping(sidebarSessionId: string): string {
  const reference = resolveSidebarSessionReference(sidebarSessionId);
  return forgetNativeSessionMappingForProject(reference.project.projectId, reference.sessionId);
}

function forgetNativeSessionMappingForProject(projectId: string, sidebarSessionId: string): string {
  const nativeSessionId = nativeSessionIdForProjectSidebarSession(projectId, sidebarSessionId);
  if (nativeSessionIdBySidebarSessionId.get(sidebarSessionId) === nativeSessionId) {
    nativeSessionIdBySidebarSessionId.delete(sidebarSessionId);
  }
  sidebarSessionIdByNativeSessionId.delete(nativeSessionId);
  return nativeSessionId;
}

function activeWorkspaceGroup(): SessionGroupRecord {
  const workspace = activeProject().workspace;
  return (
    workspace.groups.find((group) => group.groupId === workspace.activeGroupId) ??
    workspace.groups[0]!
  );
}

function activeSnapshot(): SessionGridSnapshot {
  return activeWorkspaceGroup().snapshot;
}

function commandPanelContainsSession(project: NativeProject, sessionId: string): boolean {
  return project.commandsPanel.sessions.some((session) => session.sessionId === sessionId);
}

function activeCommandPanelContainsSession(sessionId: string): boolean {
  return commandPanelContainsSession(activeProject(), sessionId);
}

function rememberFocusedWorkspaceTerminal(project: NativeProject, sessionId: string, reason: string): void {
  const session = findSessionRecordInProject(project, sessionId);
  if (session?.kind !== "terminal" || session.surface === "commands") {
    return;
  }
  /**
   * CDXC:CommandsPanel 2026-05-15-03:21:
   * Focusing the Commands panel by F12 or by clicking a command terminal must
   * preserve the workspace terminal the user was typing in. The minimized
   * Commands panel should hand keyboard focus back to that terminal, so users
   * can collapse it by any command-pane control and keep typing immediately.
   */
  lastFocusedWorkspaceTerminalByProjectId.set(project.projectId, sessionId);
  appendTerminalFocusDebugLog("nativeFocusTrace.commandsPanelWorkspaceTerminalRemembered", {
    projectId: project.projectId,
    reason,
    sessionId,
  });
}

function rememberActiveProjectWorkspaceTerminalBeforeCommandsPanel(reason: string): void {
  const project = activeProject();
  const workspace = project.workspace;
  const group =
    workspace.groups.find((candidate) => candidate.groupId === workspace.activeGroupId) ??
    workspace.groups[0];
  const sessionId = group?.snapshot.focusedSessionId;
  if (sessionId) {
    rememberFocusedWorkspaceTerminal(project, sessionId, reason);
  }
}

function rememberedWorkspaceTerminalForCommandsPanel(project: NativeProject): string | undefined {
  const sessionId = lastFocusedWorkspaceTerminalByProjectId.get(project.projectId);
  if (!sessionId) {
    return undefined;
  }
  const session = findSessionRecordInProject(project, sessionId);
  return session?.kind === "terminal" && session.surface !== "commands" ? sessionId : undefined;
}

/**
 * CDXC:CommandsPanel 2026-05-14-09:41
 * Command-pane terminals should identify as `Command Terminal` unless a
 * configured command supplies a more specific session title.
 */
function createCommandTerminal(
  title = "Command Terminal",
  initialInput = "",
  options: {
    commandTitle?: string;
    focusAfterCreate?: boolean;
    targetTabGroupSessionId?: string;
  } = {},
): TerminalSessionRecord | undefined {
  const project = activeProject();
  if (
    options.targetTabGroupSessionId &&
    (!project.commandsPanel.sessions.some(
      (session) => session.sessionId === options.targetTabGroupSessionId,
    ) ||
      !commandPaneLayoutContainsSession(
        project.commandsPanel.paneLayout,
        options.targetTabGroupSessionId,
      ))
  ) {
    return undefined;
  }
  if (!shouldKeepProjectEditorOpenForNewSession(project.projectId)) {
    activateWorkspaceSurfaceForProject(project.projectId);
  }
  const sessionId = createTimestampedSessionId([
    ...project.commandsPanel.sessions.map((session) => session.sessionId),
    ...project.workspace.groups.flatMap((group) =>
      group.snapshot.sessions.map((session) => session.sessionId),
    ),
  ]);
  const session = normalizeSessionRecord(
    createSessionRecord(project.commandsPanel.sessions.length + 1, project.commandsPanel.sessions.length, {
      displayId: sessionId,
      kind: "terminal",
      sessionId,
      surface: "commands",
      terminalEngine: "ghostty-native",
      title,
      commandTitle: options.commandTitle,
    }),
  ) as TerminalSessionRecord;
  const nativeSessionId = rememberNativeSessionMapping(project.projectId, session.sessionId);
  const sessionStateFilePath = createNativeSessionStateFilePath(project.projectId, session.sessionId);
  const sessionPersistenceProvider = activeSessionPersistenceProviderFromSettings();
  const sessionPersistenceName = sessionPersistenceProvider ? undefined : undefined;
  const commandSession = {
    ...session,
    sessionPersistenceName,
    sessionPersistenceProvider,
    surface: "commands" as const,
  };
  updateActiveProjectCommandsPanel((panel) =>
    addSessionToCommandsPanel(panel, commandSession, options.targetTabGroupSessionId),
  );
  terminalStateById.set(commandSession.sessionId, {
    activity: initialInput.trim() ? "working" : "idle",
    lifecycleState: "running",
    sessionPersistenceName,
    sessionPersistenceProvider,
    sessionStateFilePath,
    terminalTitle: title,
  });
  postNative({
    activateOnCreate: false,
    cwd: project.path,
    env: createNativeAgentSessionEnvironment({
      project,
      sessionId: commandSession.sessionId,
      sessionStateFilePath,
    }),
    initialInput,
    sessionId: nativeSessionId,
    sessionPersistenceName,
    sessionPersistenceProvider,
    title,
    type: "createTerminal",
  });
  publish();
  if (options.focusAfterCreate !== false) {
    postNative({ sessionId: nativeSessionId, type: "focusTerminal" });
  }
  return commandSession;
}

function addSessionToCommandsPanel(
  panel: CommandsPanelState,
  session: TerminalSessionRecord,
  targetTabGroupSessionId?: string,
): CommandsPanelState {
  const sessions = [...panel.sessions, session].map((candidate, index) => {
    const position = getSlotPosition(index);
    return {
      ...candidate,
      column: position.column,
      row: position.row,
      slotIndex: index,
      surface: "commands" as const,
    };
  });
  /**
   * CDXC:CommandsPanel 2026-05-15-14:03:
   * The command-pane tab-bar New Terminal button is scoped to the pane whose
   * tab group owns the clicked button. Add the new command terminal to that
   * existing tab group instead of appending a leaf to the split root, which
   * would turn a two-pane Commands panel into a three-pane split layout.
   */
  const paneLayout =
    targetTabGroupSessionId && panel.paneLayout
      ? addCommandSessionToPaneTabGroup(
          panel.paneLayout,
          targetTabGroupSessionId,
          session.sessionId,
        )
      : appendCommandSessionToPaneLayout(panel.paneLayout, session.sessionId);
  return normalizeStoredCommandsPanelState({
    ...panel,
    activeSessionId: session.sessionId,
    isVisible: true,
    mode: panel.mode ?? "pinned",
    paneLayout,
    sessions,
  });
}

function appendCommandSessionToPaneLayout(
  layout: SessionPaneLayoutNode | undefined,
  sessionId: string,
): SessionPaneLayoutNode {
  if (!layout) {
    return { kind: "leaf", sessionId };
  }
  if (layout.kind === "leaf") {
    return {
      activeSessionId: sessionId,
      kind: "tabs",
      sessionIds: layout.sessionId === sessionId ? [sessionId] : [layout.sessionId, sessionId],
    };
  }
  if (layout.kind === "tabs") {
    return {
      ...layout,
      activeSessionId: sessionId,
      sessionIds: [...layout.sessionIds.filter((id) => id !== sessionId), sessionId],
    };
  }
  return {
    ...layout,
    children: [...layout.children, { kind: "leaf", sessionId }],
  };
}

function normalizeCommandPaneLayout(
  layout: SessionPaneLayoutNode | undefined,
  allowedSessionIds: ReadonlySet<string>,
  activeSessionId?: string,
): SessionPaneLayoutNode | undefined {
  if (!layout) {
    const firstSessionId = allowedSessionIds.values().next().value as string | undefined;
    return firstSessionId ? { kind: "leaf", sessionId: firstSessionId } : undefined;
  }
  if (layout.kind === "leaf") {
    return allowedSessionIds.has(layout.sessionId) ? layout : undefined;
  }
  if (layout.kind === "tabs") {
    const sessionIds = layout.sessionIds.filter((sessionId, index, ids) =>
      allowedSessionIds.has(sessionId) && ids.indexOf(sessionId) === index,
    );
    if (sessionIds.length === 0) {
      return undefined;
    }
    if (sessionIds.length === 1) {
      return { kind: "leaf", sessionId: sessionIds[0]! };
    }
    return {
      activeSessionId:
        layout.activeSessionId && sessionIds.includes(layout.activeSessionId)
          ? layout.activeSessionId
          : activeSessionId && sessionIds.includes(activeSessionId)
            ? activeSessionId
            : sessionIds[0],
      kind: "tabs",
      sessionIds,
    };
  }
  const children = layout.children
    .map((child) => normalizeCommandPaneLayout(child, allowedSessionIds, activeSessionId))
    .filter((child): child is SessionPaneLayoutNode => child !== undefined);
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { ...layout, children };
}

function removeCommandSessionFromPaneLayout(
  layout: SessionPaneLayoutNode | undefined,
  sessionId: string,
): SessionPaneLayoutNode | undefined {
  if (!layout) {
    return undefined;
  }
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
    .map((child) => removeCommandSessionFromPaneLayout(child, sessionId))
    .filter((child): child is SessionPaneLayoutNode => child !== undefined);
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { ...layout, children };
}

function setActiveCommandSessionInPaneLayout(
  layout: SessionPaneLayoutNode | undefined,
  sessionId: string,
): SessionPaneLayoutNode | undefined {
  if (!layout) {
    return undefined;
  }
  if (layout.kind === "tabs") {
    return layout.sessionIds.includes(sessionId) ? { ...layout, activeSessionId: sessionId } : layout;
  }
  if (layout.kind === "split") {
    return {
      ...layout,
      children: layout.children.map((child) => setActiveCommandSessionInPaneLayout(child, sessionId) ?? child),
    };
  }
  return layout;
}

function commandPaneLayoutContainsSession(
  node: SessionPaneLayoutNode | undefined,
  sessionId: string,
): boolean {
  if (!node) {
    return false;
  }
  if (node.kind === "leaf") {
    return node.sessionId === sessionId;
  }
  if (node.kind === "tabs") {
    return node.sessionIds.includes(sessionId);
  }
  return node.children.some((child) => commandPaneLayoutContainsSession(child, sessionId));
}

function addCommandSessionToPaneTabGroup(
  layout: SessionPaneLayoutNode,
  targetSessionId: string,
  sourceSessionId: string,
): SessionPaneLayoutNode | undefined {
  if (layout.kind === "leaf") {
    return layout.sessionId === targetSessionId
      ? {
          activeSessionId: sourceSessionId,
          kind: "tabs",
          sessionIds: [targetSessionId, sourceSessionId],
        }
      : undefined;
  }
  if (layout.kind === "tabs") {
    if (!layout.sessionIds.includes(targetSessionId)) {
      return undefined;
    }
    return {
      ...layout,
      activeSessionId: sourceSessionId,
      sessionIds: [...layout.sessionIds.filter((sessionId) => sessionId !== sourceSessionId), sourceSessionId],
    };
  }
  let didAdd = false;
  const children = layout.children.map((child) => {
    if (didAdd) {
      return child;
    }
    const nextChild = addCommandSessionToPaneTabGroup(child, targetSessionId, sourceSessionId);
    if (!nextChild) {
      return child;
    }
    didAdd = true;
    return nextChild;
  });
  return didAdd ? { ...layout, children } : undefined;
}

function insertCommandSessionBesidePane(
  layout: SessionPaneLayoutNode,
  targetSessionId: string,
  sourceSessionId: string,
  placeAfterTarget: boolean,
): SessionPaneLayoutNode | undefined {
  const sourceLeaf: SessionPaneLayoutNode = { kind: "leaf", sessionId: sourceSessionId };
  if (layout.kind === "leaf" || layout.kind === "tabs") {
    if (!commandPaneLayoutContainsSession(layout, targetSessionId)) {
      return undefined;
    }
    return {
      children: placeAfterTarget ? [layout, sourceLeaf] : [sourceLeaf, layout],
      direction: "horizontal",
      kind: "split",
    };
  }
  const children: SessionPaneLayoutNode[] = [];
  let didInsert = false;
  for (const child of layout.children) {
    if (!didInsert && commandPaneLayoutContainsSession(child, targetSessionId)) {
      if (layout.direction === "horizontal") {
        children.push(...(placeAfterTarget ? [child, sourceLeaf] : [sourceLeaf, child]));
        didInsert = true;
      } else {
        const nextChild = insertCommandSessionBesidePane(
          child,
          targetSessionId,
          sourceSessionId,
          placeAfterTarget,
        );
        children.push(nextChild ?? child);
        didInsert = Boolean(nextChild);
      }
    } else {
      children.push(child);
    }
  }
  return didInsert ? { ...layout, children } : undefined;
}

function getCommandSamePaneSplitAnchorSessionId(
  layout: SessionPaneLayoutNode,
  sourceSessionId: string,
  placeAfterTarget: boolean,
): string | undefined {
  if (layout.kind === "leaf") {
    return undefined;
  }
  if (layout.kind === "tabs") {
    if (!layout.sessionIds.includes(sourceSessionId) || layout.sessionIds.length <= 1) {
      return undefined;
    }
    const siblingSessionIds = layout.sessionIds.filter((sessionId) => sessionId !== sourceSessionId);
    /**
     * CDXC:CommandsPanel 2026-05-15-08:59
     * Dragging a command-terminal tab to the left or right edge of its own
     * command pane should split that tab out like workspace pane tabs. Resolve
     * the drop to a remaining sibling before removing the dragged source so the
     * command pane still has an anchor to split beside.
     */
    return placeAfterTarget ? siblingSessionIds[siblingSessionIds.length - 1] : siblingSessionIds[0];
  }
  for (const child of layout.children) {
    const anchorSessionId = getCommandSamePaneSplitAnchorSessionId(
      child,
      sourceSessionId,
      placeAfterTarget,
    );
    if (anchorSessionId) {
      return anchorSessionId;
    }
  }
  return undefined;
}

function reorderCommandSessionInPaneTabGroup(
  layout: SessionPaneLayoutNode | undefined,
  sourceSessionId: string,
  targetSessionId: string,
  position: SessionPaneTabReorderPosition,
): SessionPaneLayoutNode | undefined {
  if (!layout || layout.kind === "leaf") {
    return undefined;
  }
  if (layout.kind === "tabs") {
    if (!layout.sessionIds.includes(sourceSessionId) || !layout.sessionIds.includes(targetSessionId)) {
      return undefined;
    }
    const sessionIds = layout.sessionIds.filter((sessionId) => sessionId !== sourceSessionId);
    const targetIndex = sessionIds.indexOf(targetSessionId);
    sessionIds.splice(position === "before" ? targetIndex : targetIndex + 1, 0, sourceSessionId);
    return { ...layout, sessionIds };
  }
  let didReorder = false;
  const children = layout.children.map((child) => {
    if (didReorder) {
      return child;
    }
    const nextChild = reorderCommandSessionInPaneTabGroup(
      child,
      sourceSessionId,
      targetSessionId,
      position,
    );
    if (!nextChild) {
      return child;
    }
    didReorder = true;
    return nextChild;
  });
  return didReorder ? { ...layout, children } : undefined;
}

function replaceActiveSnapshot(snapshot: SessionGridSnapshot): void {
  const workspace = activeProject().workspace;
  updateActiveProjectWorkspace(() => ({
    ...workspace,
    groups: workspace.groups.map((group) =>
      group.groupId === workspace.activeGroupId ? { ...group, snapshot } : group,
    ),
  }));
}

function buildChromeCanaryBrowserGroup(): SidebarSessionGroup {
  /**
   * CDXC:BrowserOverlay 2026-04-27-05:32
   * The running Chrome Canary control should read as one browser button with
   * only its text label visible. Leave agentIcon empty so the shared session
   * card does not add both leading and trailing browser glyphs around it.
   */
  const session: SidebarSessionItem = {
    activity: "idle",
    activityLabel: undefined,
    agentIcon: undefined,
    alias: "Chrome Canary",
    column: 0,
    detail: "Place the running Canary window over Ghostex",
    isFocused: false,
    isFavorite: false,
    isReloading: false,
    isRunning: true,
    isVisible: true,
    kind: "browser",
    lastInteractionAt: undefined,
    lifecycleState: "running",
    primaryTitle: "Chrome Canary",
    row: 0,
    sessionId: CHROME_CANARY_BROWSER_SESSION_ID,
    sessionKind: "browser",
    sessionNumber: undefined,
    shortcutLabel: "",
    terminalTitle: undefined,
  };

  return {
    groupId: CHROME_CANARY_BROWSER_GROUP_ID,
    isActive: false,
    isFocusModeActive: false,
    kind: "browser",
    layoutVisibleCount: 1,
    sessions: [session],
    title: "Browsers",
    viewMode: "grid",
    visibleCount: 1,
  };
}

function createProjectedSidebarGroupsForProject(project: NativeProject): SidebarSessionGroup[] {
  const workspace = project.workspace;
  return workspace.groups.map((group) => ({
    groupId: group.groupId,
    isActive: group.groupId === workspace.activeGroupId,
    isFocusModeActive: group.snapshot.visibleCount === 1,
    kind: "workspace",
    layoutVisibleCount: group.snapshot.visibleCount,
    sessions: createProjectedSidebarSessionsForGroup(group),
    title: group.title,
    viewMode: group.snapshot.viewMode,
    visibleCount: group.snapshot.visibleCount,
  }));
}

function createCombinedSidebarGroups(): SidebarSessionGroup[] {
  /**
   * CDXC:Chats 2026-05-04-14:49
   * The sidebar must always show one Chats header, even before any chat exists.
   * Users create chats through that group's plus button; standalone New Chat
   * buttons are intentionally omitted so there is one obvious creation path.
   *
   * CDXC:Chats 2026-05-04-09:41
   * Combined mode groups all projectless chat folders under one Chats header.
   * Normal chats own exactly one project-scoped terminal session so the native
   * terminal title/agent-icon detection path stays unchanged. Plugins uses the
   * same chat collection but opens a browser pane there because the user asked
   * for skills.sh in Chats instead of in the active project.
   *
   * CDXC:SidebarLayout 2026-05-13-08:11
   * Non-chat projects render as one draggable group per project. The project
   * internals can still have multiple terminal groups, but the sidebar no
   * longer exposes a per-project separated presentation.
   */
  const orderedProjects = orderNativeProjectsForSidebar(projects);
  const chatProjects = orderedProjects.filter((project) => project.isChat === true);
  const projectGroups = orderedProjects
    .filter((project) => project.isChat !== true && project.isRecentProject !== true)
    .map((project) => createCombinedProjectSidebarGroup(project));

  const activeChatProject = chatProjects.find((project) => project.projectId === activeProjectId);
  const chatSessions = chatProjects.flatMap((project) => {
    const session = createProjectedSidebarGroupsForProject(project).flatMap(
      (group) => group.sessions,
    )[0];
    return session
      ? [
          {
            ...session,
            isFocused: project.projectId === activeProjectId && session.isFocused,
            isVisible: project.projectId === activeProjectId && session.isVisible,
            sessionId: createCombinedProjectSessionId(project.projectId, session.sessionId),
          },
        ]
      : [];
  });
  const activeChatGroup = activeChatProject
    ? createProjectedSidebarGroupsForProject(activeChatProject).find(
        (group) => group.groupId === activeChatProject.workspace.activeGroupId,
      )
    : undefined;

  return [
    {
      groupId: COMBINED_CHATS_GROUP_ID,
      isActive: Boolean(activeChatProject),
      isChatCollection: true,
      isFocusModeActive: activeChatGroup?.isFocusModeActive ?? false,
      kind: "workspace",
      layoutVisibleCount: 1,
      sessions: chatSessions,
      title: "Chats",
      viewMode: activeChatGroup?.viewMode ?? "grid",
      visibleCount: 1,
    },
    ...projectGroups,
  ];
}

function createTitlebarResourceGroups(): TitlebarResourceGroup[] {
  /**
   * CDXC:TitlebarResources 2026-05-16-16:08:
   * The resource dropdown lives in the isolated React titlebar, but its session
   * grouping must mirror the combined sidebar. Send a compact projection with
   * original session ids and provider names so titlebar process polling can
   * match zmx/codex children while still rendering Quick and project groups.
   */
  const orderedProjects = orderNativeProjectsForSidebar(projects).filter(
    (project) => project.isRecentProject !== true,
  );
  const chatProjects = orderedProjects.filter((project) => project.isChat === true);
  const quickSessions = chatProjects.flatMap((project) =>
    createProjectedSidebarGroupsForProject(project).flatMap((group) =>
      group.sessions.map((session) => createTitlebarResourceSession(project.projectId, session)),
    ),
  );
  const groups: TitlebarResourceGroup[] = [];
  if (quickSessions.length > 0) {
    groups.push({
      groupId: COMBINED_CHATS_GROUP_ID,
      isActive: chatProjects.some((project) => project.projectId === activeProjectId),
      projectName: "Quick",
      projectPath: "",
      sessions: quickSessions,
      title: "Quick",
    });
  }

  for (const project of orderedProjects) {
    if (project.isChat === true) {
      continue;
    }
    groups.push({
      groupId: createCombinedProjectGroupId(project.projectId),
      isActive: project.projectId === activeProjectId,
      projectId: project.projectId,
      projectName: project.name,
      projectPath: project.path,
      sessions: createProjectedSidebarGroupsForProject(project).flatMap((group) =>
        group.sessions.map((session) => createTitlebarResourceSession(project.projectId, session)),
      ),
      title: project.name,
    });
  }

  return groups;
}

function createTitlebarResourceSession(
  projectId: string,
  session: SidebarSessionItem,
): TitlebarResourceSession {
  return {
    activity: session.activity,
    agentIcon: session.agentIcon,
    isRunning: session.isRunning,
    isSleeping: session.isSleeping,
    lastInteractionAt: session.lastInteractionAt,
    projectId,
    sessionId: session.sessionId,
    sessionKind: session.sessionKind,
    sessionPersistenceName: session.sessionPersistenceName,
    sessionPersistenceProvider: session.sessionPersistenceProvider,
    terminalTitle: session.terminalTitle,
    title: session.primaryTitle?.trim() || session.terminalTitle?.trim() || session.alias,
  };
}

function createSidebarRecentProjects(): SidebarRecentProject[] {
  /**
   * CDXC:RecentProjects 2026-05-04-14:25
   * Recent Projects are full native projects parked out of the main Combined
   * group list. Show them newest-closed first and include the preserved session
   * count so restoring a closed project with sessions does not imply a blank
   * terminal will be created.
   */
  return projects
    .filter((project) => project.isChat !== true && project.isRecentProject === true)
    .sort(compareRecentProjectsByClosedAt)
    .map((project) => ({
      icon: project.icon ?? normalizeLegacyWorkspaceDockIcon(project),
      iconDataUrl: project.iconDataUrl,
      path: project.path,
      projectId: project.projectId,
      recentClosedAt: project.recentClosedAt,
      sessionCount: countRecentProjectSessions(project),
      theme: project.theme ?? resolveSidebarTheme(settings.sidebarTheme, "dark"),
      themeColor: project.themeColor,
      title: project.name,
    }));
}

function createCombinedProjectSidebarGroup(project: NativeProject): SidebarSessionGroup {
  const projectedGroups = createProjectedSidebarGroupsForProject(project);
  const activeGroup =
    projectedGroups.find((group) => group.groupId === project.workspace.activeGroupId) ??
    projectedGroups[0];
  const isActiveProject = project.projectId === activeProjectId;
  const sessions = projectedGroups.flatMap((group) =>
    group.sessions.map((session) => ({
      ...session,
      isFocused: isActiveProject && session.isFocused,
      isVisible: isActiveProject && session.isVisible,
      sessionId: createCombinedProjectSessionId(project.projectId, session.sessionId),
    })),
  );

  return {
    groupId: createCombinedProjectGroupId(project.projectId),
    isActive: isActiveProject,
    isFocusModeActive: isActiveProject && activeGroup ? activeGroup.isFocusModeActive : false,
    kind: "workspace",
    layoutVisibleCount: activeGroup?.layoutVisibleCount ?? 1,
    projectContext: {
      canRemoveProject: true,
      editor: createSidebarProjectEditorState(project),
      theme: project.theme ?? resolveSidebarTheme(settings.sidebarTheme, "dark"),
      themeColor: project.themeColor,
    },
    sessions,
    title: project.name,
    viewMode: activeGroup?.viewMode ?? "grid",
    visibleCount: activeGroup?.visibleCount ?? 1,
  };
}

function createSidebarProjectEditorState(
  project: NativeProject,
): NonNullable<SidebarSessionGroup["projectContext"]>["editor"] {
  const surfaceState = projectEditorSurfaceByProjectId.get(project.projectId);
  return {
    diffStats: getProjectDiffStats(project.projectId),
    errorMessage: surfaceState?.errorMessage,
    isOpen: surfaceState?.isOpen === true,
    isSleeping: surfaceState?.isSleeping === true,
    projectId: project.projectId,
    status: surfaceState?.status ?? "idle",
  };
}

function setProjectEditorPersistedOpen(
  projectId: string,
  isOpen: boolean,
  reason: string,
): void {
  let didChange = false;
  projects = projects.map((project) => {
    if (project.projectId !== projectId) {
      return project;
    }
    if (isOpen) {
      if (project.projectEditor?.isOpen === true) {
        return project;
      }
      didChange = true;
      return { ...project, projectEditor: { isOpen: true } };
    }
    if (!project.projectEditor) {
      return project;
    }
    didChange = true;
    const { projectEditor: _removedProjectEditor, ...projectWithoutEditor } = project;
    return projectWithoutEditor;
  });

  if (didChange) {
    writeStoredProjects(reason);
  }
}

function setProjectEditorCompanionPaneHidden(
  projectId: string,
  hidden: boolean,
  reason: string,
): void {
  let didChange = false;
  projects = projects.map((project) => {
    if (project.projectId !== projectId) {
      return project;
    }
    if ((project.projectEditorCompanionPaneHidden === true) === hidden) {
      return project;
    }
    didChange = true;
    /**
     * CDXC:ProjectEditorCompanion 2026-05-16-14:42:
     * Closing the agent side pane is a project preference shared by Code, Git,
     * and Project mode surfaces. Persist it on the project record, not on the
     * mode-specific projectEditor state, so switching modes and restarting the
     * app keep the companion pane hidden until the titlebar restore button is used.
     */
    return { ...project, projectEditorCompanionPaneHidden: hidden };
  });
  if (didChange) {
    writeStoredProjects(reason);
  }
}

function createProjectedSidebarSessionsForGroup(group: SessionGroupRecord): SidebarSessionItem[] {
  return createSidebarSessionItems(group.snapshot, "mac").map((session) => {
    const sessionRecord = group.snapshot.sessions.find(
      (candidate) => candidate.sessionId === session.sessionId,
    );
    if (sessionRecord?.kind === "t3") {
      const isSleeping = sessionRecord.isSleeping === true;
      return {
        ...session,
        agentIcon: "t3",
        isRunning: !isSleeping,
        lastInteractionAt: sessionRecord.createdAt,
        lifecycleState: isSleeping ? "sleeping" : "running",
        primaryTitle: session.primaryTitle ?? "T3 Code",
      };
    }

    const persistedAgentName =
      sessionRecord?.kind === "terminal" ? sessionRecord.agentName : undefined;
    const terminalState = terminalStateById.get(session.sessionId);
    if (session.sessionKind !== "terminal") {
      return session;
    }
    const visibleTerminalTitle = getVisibleTerminalTitle(terminalState?.terminalTitle);
    const displayPrimaryTitle =
      sessionRecord && sessionRecord.kind === "terminal"
        ? getSessionCardPrimaryTitle(sessionRecord)
        : session.primaryTitle;
    const visiblePrimaryTitle = getVisiblePrimaryTitle(displayPrimaryTitle ?? "");
    /**
     * CDXC:AgentDetection 2026-04-27-02:36
     * Session cards must show the detected agent from the canonical session
     * record even when the native terminal state is not currently mounted.
     * Live terminal state can still refine the value as title detection runs.
     */
    const projectedAgentName = terminalState?.agentName ?? persistedAgentName;
    const agentIcon = resolveNativeSidebarAgentIcon(projectedAgentName);
    const shouldUseStoredTitleOverEllipsizedTerminalTitle = isEllipsizedTerminalTitleForStoredTitle(
      visibleTerminalTitle,
      visiblePrimaryTitle,
    );
    const shouldPreferTerminalTitle =
      Boolean(visibleTerminalTitle) &&
      shouldPreferTerminalTitleForAgentIcon(agentIcon) &&
      !shouldUseStoredTitleOverEllipsizedTerminalTitle;
    const hasTrustedStoredResumeTitle =
      sessionRecord?.kind === "terminal" &&
      getNativeStoredTrustedResumeTitle(sessionRecord).title !== undefined;
    const primaryTitle = shouldPreferTerminalTitle
      ? visibleTerminalTitle
      : visiblePrimaryTitle
        ? displayPrimaryTitle
        : (visibleTerminalTitle ?? displayPrimaryTitle);
    const secondaryTerminalTitle = shouldPreferTerminalTitle
      ? undefined
      : displayPrimaryTitle && !shouldUseStoredTitleOverEllipsizedTerminalTitle
        ? visibleTerminalTitle
        : undefined;
    return {
      ...session,
      activity: terminalState?.activity ?? session.activity,
      agentIcon,
      firstUserMessage: sessionRecord?.firstUserMessage ?? terminalState?.firstUserMessage,
      lifecycleState: terminalState?.lifecycleState ?? session.lifecycleState,
      isGeneratingFirstPromptTitle: terminalState?.firstPromptAutoRenameInProgress === true,
      isRunning: terminalState?.lifecycleState === "running",
      isPrimaryTitleTerminalTitle:
        (Boolean(visibleTerminalTitle) && (!visiblePrimaryTitle || shouldPreferTerminalTitle)) ||
        (!visibleTerminalTitle && hasTrustedStoredResumeTitle),
      primaryTitle,
      sessionPersistenceName:
        terminalState?.sessionPersistenceName ?? session.sessionPersistenceName,
      sessionPersistenceProvider:
        terminalState?.sessionPersistenceProvider ?? session.sessionPersistenceProvider,
      /**
       * CDXC:NativeSidebar 2026-04-28-05:14
       * Session-card hover timestamps follow agent-tiler's projection rule:
       * terminal sessions always expose a last-interaction value, using the
       * live activity timestamp when known and the session creation time as
       * the canonical baseline.
       */
      lastInteractionAt: terminalState?.lastActivityAt ?? sessionRecord?.createdAt,
      terminalTitle: secondaryTerminalTitle,
    };
  });
}

function isEllipsizedTerminalTitleForStoredTitle(
  terminalTitle: string | undefined,
  storedTitle: string | undefined,
): boolean {
  /**
   * CDXC:SessionTooltips 2026-05-15-17:02:
   * Session-card tooltips need the full canonical session title even after an Agent CLI reports a shortened title ending in ellipsis. When the live terminal title is only an ellipsized prefix of the stored title, keep projecting the stored title so the card can visually truncate via CSS while hover text remains complete.
   */
  const normalizedTerminalTitle = terminalTitle?.trim().replace(/\s+/g, " ");
  const normalizedStoredTitle = storedTitle?.trim().replace(/\s+/g, " ");
  if (!normalizedTerminalTitle || !normalizedStoredTitle) {
    return false;
  }

  const prefix = normalizedTerminalTitle.replace(/(?:\.\.\.|…)$/u, "").trim();
  return (
    prefix !== normalizedTerminalTitle &&
    prefix.length > 0 &&
    normalizedStoredTitle.length > normalizedTerminalTitle.length &&
    normalizedStoredTitle.toLowerCase().startsWith(prefix.toLowerCase())
  );
}

function resolveNativeSidebarAgentIcon(agentName: string | undefined): SidebarAgentButton["icon"] {
  const directIcon = getSidebarAgentIconById(agentName);
  if (directIcon) {
    return directIcon;
  }

  const normalizedAgentName = agentName?.trim().toLowerCase();
  if (!normalizedAgentName) {
    return undefined;
  }

  /**
   * CDXC:SidebarSessions 2026-04-28-05:18
   * The card trailing-mode toggle can only reveal the agent icon on hover when
   * native session projection resolves one. Native state may hold display names
   * like "Codex" instead of canonical ids like "codex", so resolve both forms.
   */
  return DEFAULT_SIDEBAR_AGENTS.find(
    (agent) =>
      agent.agentId === normalizedAgentName ||
      agent.name.trim().toLowerCase() === normalizedAgentName,
  )?.icon;
}

function getNativeSidebarCommandSessionIndicators(
  commands: readonly SidebarCommandButton[],
): SidebarCommandSessionIndicator[] {
  const focusedSessionId = activeSnapshot().focusedSessionId;
  return commands.flatMap((command) => {
    if (command.actionType !== "terminal") {
      return [];
    }
    const storedSession = sidebarCommandSessionByCommandId.get(command.commandId);
    const commandTitleKey = getNativeSidebarCommandTitleKey(
      getNativeSidebarCommandSessionTitle(command),
    );
    const mappedSessionTitleKey = getNativeSidebarCommandTitleKey(storedSession?.commandTitle);
    const indicatorSessionId =
      storedSession && mappedSessionTitleKey === commandTitleKey
        ? storedSession.sessionId
        : findNativeSidebarCommandPaneByTitle(commandTitleKey)?.sessionId;
    if (!indicatorSessionId) {
      return [];
    }

    const session = findSessionRecord(indicatorSessionId);
    const terminalState = terminalStateById.get(indicatorSessionId);
    if (!session || !terminalState) {
      return [];
    }

    const status =
      terminalState.lifecycleState === "running"
        ? "running"
        : terminalState.lifecycleState === "error"
          ? "error"
          : "idle";

    return [
      {
        commandId: command.commandId,
        isActive: indicatorSessionId === focusedSessionId,
        sessionId: indicatorSessionId,
        status,
        title: terminalState.terminalTitle ?? session.title.trim() ?? undefined,
      },
    ];
  });
}

function buildSidebarMessage(): SidebarHydrateMessage {
  const project = activeProject();
  const snapshot = activeSnapshot();
  /**
   * CDXC:NativeSidebar 2026-04-27-17:03
   * Native sidebar editor checks must stay aligned with the shipped UX. Keep
   * the hydrate payload exact and resolve persisted theme settings before
   * passing them to shared sidebar HUD creation.
   */
  return {
    groups: createCombinedSidebarGroups(),
    hud: {
      ...createSidebarHudState(
        snapshot,
        project.theme ?? resolveSidebarTheme(settings.sidebarTheme, "dark"),
        settings.agentManagerZoomPercent,
        settings.showCloseButtonOnSessionCards,
        settings.showHotkeysOnSessionCards,
        settings.debuggingMode,
        settings.completionBellEnabled,
        settings.completionSound,
        agents,
        commands,
        [],
        gitState,
        {
          /**
           * CDXC:SidebarLayout 2026-05-13-08:11
           * Combined is now the only supported sidebar layout. The old Actions
           * and browser groups stay hidden, while Agents and Git remain owned
           * by the reference sidebar chrome.
           */
          actions: false,
          agents: true,
          browsers: false,
          git: true,
        },
        collapsedSections,
        activeSessionsSortMode,
        settings.createSessionOnSidebarDoubleClick,
        settings.renameSessionOnDoubleClick,
        getNativeSidebarCommandSessionIndicators(commands),
      ),
      /**
       * CDXC:SidebarLayout 2026-05-13-08:11
       * The reference sidebar keeps the top current-project header so users
       * can see which project receives new agent/action launches after
       * selecting a project group with no sessions.
       */
      projectHeader: {
        directory: project.path,
        name: project.name,
        projectId: project.projectId,
      },
      customThemeColor: normalizeWorkspaceThemeColor(project.themeColor),
      recentProjects: createSidebarRecentProjects(),
      settings,
    },
    pinnedPrompts,
    previousSessions,
    revision: ++revision,
    scratchPadContent,
    type: "hydrate",
  };
}

function summarizeSidebarRefreshProject(project = activeProject()): Record<string, unknown> {
  const sessionIds = project.workspace.groups.flatMap((group) =>
    group.snapshot.sessions.map((session) => session.sessionId),
  );
  return {
    activeGroupId: project.workspace.activeGroupId,
    activeProjectId,
    focusedSessionIdsByGroup: Object.fromEntries(
      project.workspace.groups.map((group) => [group.groupId, group.snapshot.focusedSessionId]),
    ),
    groupCount: project.workspace.groups.length,
    projectId: project.projectId,
    sessionCount: sessionIds.length,
    sessionIds,
  };
}

function createAgentManagerXWorkspaceSnapshots(): AgentManagerXWorkspaceSnapshotMessage[] {
  const updatedAt = new Date().toISOString();
  return projects
    .filter((project) => project.isRecentProject !== true)
    .map((project) => {
    const sessions = createProjectedSidebarGroupsForProject(project).flatMap((group) =>
      group.sessions.flatMap((session): AgentManagerXWorkspaceSession[] => {
        if (session.sessionKind === "browser") {
          return [];
        }
        const primaryTitle = session.primaryTitle?.trim();
        const terminalTitle = session.terminalTitle?.trim();
        const alias = session.alias.trim();
        return [
          {
            agent: session.agentIcon ?? "unknown",
            alias: session.alias,
            displayName: primaryTitle || terminalTitle || alias || "Session",
            isFocused: project.projectId === activeProjectId && session.isFocused,
            isRunning: session.isRunning,
            isVisible: project.projectId === activeProjectId && session.isVisible,
            kind: session.sessionKind === "t3" ? "t3" : "terminal",
            lastActiveAt: session.lastInteractionAt ?? updatedAt,
            projectName: project.name,
            projectPath: project.path,
            sessionId: session.sessionId,
            status: session.activity,
            terminalTitle: session.terminalTitle,
          },
        ];
      }),
    );

    return {
      sessions,
      source: "ghostex",
      type: "workspaceSnapshot",
      updatedAt,
      workspaceFaviconDataUrl: project.iconDataUrl,
      workspaceId: project.projectId,
      workspaceName: project.name,
      workspacePath: project.path,
    };
    });
}

function handleAgentManagerXSessionCommand(rawData: unknown): void {
  const rawText = typeof rawData === "string" ? rawData : undefined;
  if (!rawText) {
    return;
  }

  let message: AgentManagerXSessionCommandMessage;
  try {
    message = JSON.parse(rawText) as AgentManagerXSessionCommandMessage;
  } catch {
    return;
  }

  if (message.type !== "focusSession" && message.type !== "closeSession") {
    return;
  }
  const project = projects.find((candidate) => candidate.projectId === message.workspaceId);
  if (!project) {
    return;
  }
  const hasSession = project.workspace.groups.some((group) =>
    group.snapshot.sessions.some((session) => session.sessionId === message.sessionId),
  );
  if (!hasSession) {
    return;
  }

  if (activeProjectId !== project.projectId) {
    focusProject(project.projectId);
  }
  if (message.type === "focusSession") {
    /**
     * CDXC:AgentManagerXBridge 2026-04-27-20:34
     * Clicking a ghostex session in Agent Manager must raise the native ghostex
     * workarea before focusing the terminal, because Agent Manager no longer
     * opens an editor window for ghostex-owned sessions.
     */
    postNative({ type: "activateApp" });
    focusSidebarSession(message.sessionId);
  } else {
    closeTerminal(message.sessionId);
  }
}

function publish(): void {
  const didCreateNativeSession = ensureVisibleNativeSessions("publish");
  const sidebarMessage = buildSidebarMessage();
  sidebarBus.post(sidebarMessage);
  agentManagerXBridgeClient.publish(createAgentManagerXWorkspaceSnapshots());
  /**
   * CDXC:AppModals 2026-04-26-15:10
   * App-level modals need the same sidebar store data as the sidebar webview.
   * Mirror each authoritative sidebar snapshot into the full-window modal host
   * instead of letting modals read stale duplicated state.
  */
  postAppModalHost({ message: sidebarMessage, type: "sidebarState" });
  postWorkspaceBarState();
  syncNativeT3RuntimeSessionState(sidebarMessage);
  syncNativeLayout({ force: didCreateNativeSession });
  syncNativeSessionStatusIndicators();
  syncNativePetOverlayState();
}

function syncNativeT3RuntimeSessionState(sidebarMessage: SidebarHydrateMessage): void {
  /**
   * CDXC:T3Code 2026-05-10-22:48
   * A T3 session is "running" for provider keepalive purposes when its card is
   * present in the current session sidebar projection and the card is not
   * sleeping. This deliberately decouples provider lifetime from AppKit pane
   * visibility so split focus changes do not stop an awake T3 session.
   *
   * CDXC:T3Code 2026-05-14-09:34:
   * The same visible-session projection must carry a concrete cwd for native
   * liveness repair. If t3code was terminated while sidebar T3 cards remain
   * awake, native should relaunch the provider in the background instead of
   * leaving those cards in a manual kill-and-recreate retry state.
   */
  const runningSessions = sidebarMessage.groups
    .flatMap((group) => group.sessions)
    .filter(
      (session) =>
        session.agentIcon === "t3" &&
        session.isSleeping !== true &&
        session.isRunning !== false &&
        session.lifecycleState !== "sleeping",
    );
  const runningSessionIds = runningSessions.map((session) => session.sessionId).sort();
  const runtimeCwd = runningSessions
    .map((session) => resolveNativeT3RuntimeCwdForSidebarSession(session.sessionId))
    .find((cwd): cwd is string => Boolean(cwd));
  const nextKey = JSON.stringify({ runningSessionIds, runtimeCwd });
  if (nextKey === lastNativeT3RuntimeSessionStateKey) {
    return;
  }
  lastNativeT3RuntimeSessionStateKey = nextKey;
  postNative({
    runtimeCwd,
    runningSessionIds,
    type: "setT3CodeRuntimeSessionState",
  });
}

function resolveNativeT3RuntimeCwdForSidebarSession(sessionId: string): string | undefined {
  const reference = resolveSidebarSessionReference(sessionId);
  const session = findSessionRecordInProject(reference.project, reference.sessionId);
  if (session?.kind !== "t3") {
    return undefined;
  }
  return session.t3.workspaceRoot || reference.project.path;
}

function ensureVisibleNativeSessions(reason: string): boolean {
  let didCreateNativeSession = false;
  /**
   * CDXC:SessionRestore 2026-04-29-09:16
   * Native ghostex recreates terminal processes for awake sessions in the active
   * workspace group. Sleeping terminals remain parked until focus/wake asks for
   * their resume; this hot publish path must not emit per-session diagnostics.
   *
   * CDXC:T3Code 2026-04-30-19:23
   * Visible restored T3 sessions also need their native WKWebView recreated at
   * startup. A persisted T3 card without a native web-pane surface leaves the
   * workspace focused on a session id AppKit cannot render, producing the blank
   * gray pane even though the sidebar card is selected.
   *
   * CDXC:PaneTabs 2026-05-11-01:31
   * All non-sleeping sessions in the active group are native pane-tab inventory.
   * Do not gate surface creation on visibleSessionIds, because tabs can surface
   * live sessions that no longer consume a separate split pane.
   */
  for (const project of projects) {
    if (project.projectId === activeProjectId && project.commandsPanel.sessions.length > 0) {
      for (const session of project.commandsPanel.sessions) {
        if (terminalStateById.has(session.sessionId)) {
          continue;
        }
        restoreNativeTerminalSession(project, session, reason);
        didCreateNativeSession = true;
      }
    }
    for (const group of project.workspace.groups) {
      for (const session of group.snapshot.sessions) {
        const isAwakeInActiveWorkspaceGroup =
          project.projectId === activeProjectId &&
          group.groupId === project.workspace.activeGroupId &&
          session.isSleeping !== true;
        if (!isAwakeInActiveWorkspaceGroup) {
          continue;
        }
        if (session.kind === "t3") {
          if (!nativeSessionIdBySidebarSessionId.has(session.sessionId)) {
            restoreNativeT3Session(project, session, reason);
            didCreateNativeSession = true;
          }
          continue;
        }
        if (session.kind === "browser") {
          if (!nativeSessionIdBySidebarSessionId.has(session.sessionId)) {
            restoreNativeBrowserSession(project, session, reason);
            didCreateNativeSession = true;
          }
          continue;
        }
        if (session.kind !== "terminal" || session.isSleeping === true) {
          continue;
        }
        if (terminalStateById.has(session.sessionId)) {
          continue;
        }
        restoreNativeTerminalSession(project, session, reason);
        didCreateNativeSession = true;
      }
    }
  }
  return didCreateNativeSession;
}

function restoreNativeTerminalSession(
  project: NativeProject,
  session: TerminalSessionRecord,
  reason: string,
): void {
  const nativeSessionId = rememberNativeSessionMapping(project.projectId, session.sessionId);
  const sessionStateFilePath = createNativeSessionStateFilePath(
    project.projectId,
    session.sessionId,
  );
  const initialInput = buildNativeRestoredTerminalInitialInput(session);
  if (initialInput.trim()) {
    suppressNativeSessionActivityIndicators(session.sessionId, "restore-resume-command");
  }
  const sessionPersistenceProvider = resolveTerminalSessionPersistenceProvider();
  const sessionPersistenceName = sessionPersistenceNameForProvider(
    sessionPersistenceProvider,
    session,
  );
  if (
    session.sessionPersistenceProvider !== sessionPersistenceProvider ||
    session.sessionPersistenceName !== sessionPersistenceName
  ) {
    if (session.surface === "commands") {
      updateProjectCommandsPanel(project.projectId, (panel) => ({
        ...panel,
        sessions: panel.sessions.map((candidate) =>
          candidate.sessionId === session.sessionId
            ? { ...candidate, sessionPersistenceName, sessionPersistenceProvider }
            : candidate,
        ),
      }));
    } else {
      updateProjectWorkspace(
        project.projectId,
        (workspace) => {
          const providerUpdate = setTerminalSessionPersistenceProviderInSimpleWorkspace(
            workspace,
            session.sessionId,
            sessionPersistenceProvider,
          ).snapshot;
          return setTerminalSessionPersistenceNameInSimpleWorkspace(
            providerUpdate,
            session.sessionId,
            sessionPersistenceName,
          ).snapshot;
        },
      );
    }
  }
  terminalStateById.set(session.sessionId, {
    activity: "idle",
    agentName: session.agentName,
    agentSessionId: session.agentSessionId,
    agentSessionPath: session.agentSessionPath,
    lifecycleState: "running",
    /**
     * CDXC:SessionTitleSync 2026-05-07-16:41
     * App-start/session-persistence restore reattaches existing named agent
     * conversations. Their stored trusted titles must not be treated like fresh
     * terminal-auto titles that first-prompt generation may claim.
     */
    protectStoredTitleFromAutomation:
      getNativeStoredTrustedResumeTitle(session).title !== undefined,
    sessionPersistenceName,
    sessionPersistenceProvider,
    sessionStateFilePath,
    terminalTitle: session.title,
  });
  appendAgentDetectionDebugLog("nativeSidebar.restoreTerminalState.created", {
    agentName: session.agentName,
    initialActivity: "idle",
    initialInputPreview: initialInput.trim().slice(0, 120),
    nativeSessionId,
    reason,
    sessionId: session.sessionId,
    sessionStateFilePath,
    sessionPersistenceName,
    sessionPersistenceProvider,
    terminalTitle: session.title,
  });
  const nativeEnvironment = createNativeAgentSessionEnvironment({
    agentName: session.agentName,
    project,
    sessionId: session.sessionId,
    sessionStateFilePath,
  });
  appendTerminalLaunchDebugLog("nativeSidebar.restoreTerminalState.colorEnv", {
    agentName: session.agentName,
    colorEnv: readAgentColorEnvironmentSnapshot(nativeEnvironment),
    nativeSessionId,
    reason,
    sessionId: session.sessionId,
  });
  postNative({
    /**
     * CDXC:CrashRootCause 2026-05-04-11:53
     * Sleeping-session restore uses the same native creation path as new agent
     * launches, so it must also mount inactive and wait for the sidebar's
     * authoritative setActiveTerminalSet command. Otherwise rapidly clicking
     * sleeping cards can transiently activate the previous and restored Ghostty
     * surfaces and crash before layout sync reaches native.
    */
    activateOnCreate: false,
    cwd: project.path,
    env: nativeEnvironment,
    initialInput,
    sessionId: nativeSessionId,
    sessionPersistenceName,
    sessionPersistenceProvider,
    title: session.title,
    type: "createTerminal",
  });
  appendRestoreDebugLog("nativeSidebar.restoreNativeTerminalSession", {
    nativeSessionId,
    projectId: project.projectId,
    reason,
    restoredWithResumeInput: Boolean(initialInput.trim()),
    sessionId: session.sessionId,
    title: session.title,
  });
}

function createWorkspaceBarState(): WorkspaceBarStateMessage {
  /**
   * CDXC:WorkspaceDock 2026-04-29-09:16
   * Workspace dock badges are recomputed on every sidebar publish. Keep that
   * state path silent by default so routine spinner/status updates do not write
   * dock snapshots continuously.
   */
  /**
   * CDXC:SidebarLayout 2026-05-13-08:11
   * Combined is the only supported sidebar layout, so recent projects live in
   * the reference drawer instead of the removed workspace rail/status surface.
   */
  const visibleProjects = projects.filter((project) => project.isRecentProject !== true);

  return {
    activeProjectId,
    projects: orderNativeProjectsForSidebar(visibleProjects).map((project) => ({
      icon: project.icon ?? normalizeLegacyWorkspaceDockIcon(project),
      iconDataUrl: project.iconDataUrl,
      isActive: project.projectId === activeProjectId,
      isChat: project.isChat,
      path: project.path,
      projectId: project.projectId,
      sessionCounts: countWorkspaceBarSessions(project),
      theme: project.theme ?? resolveSidebarTheme(settings.sidebarTheme, "dark"),
      themeColor: project.themeColor,
      title: project.name,
    })),
    type: "workspaceBarState",
  };
}

function countWorkspaceBarSessions(project: NativeProject): WorkspaceBarProject["sessionCounts"] {
  /**
   * CDXC:WorkspaceDock 2026-04-27-06:19
   * Count dock badges from the same projection as session cards: the orange
   * rail badge follows the session-card orange working dot, while running idle
   * sessions remain gray at the bottom-right of the workspace button.
   */
  const counts: WorkspaceBarProject["sessionCounts"] = {
    done: 0,
    running: 0,
    working: 0,
  };
  for (const group of project.workspace.groups) {
    for (const session of group.snapshot.sessions) {
      if (session.isSleeping === true) {
        continue;
      }
      if (session.kind === "browser") {
        counts.running += 1;
        continue;
      }
      if (session.kind === "t3") {
        counts.done += 1;
        continue;
      }
      const terminalState = terminalStateById.get(session.sessionId);
      const lifecycleState = terminalState?.lifecycleState ?? "done";
      if (lifecycleState === "running" && terminalState?.activity === "working") {
        counts.working += 1;
      } else if (lifecycleState === "running") {
        counts.running += 1;
      } else if (lifecycleState === "done" && terminalState?.activity === "attention") {
        counts.done += 1;
      }
    }
  }
  return counts;
}

type NativeSessionStatusIndicatorCandidate = {
  lastInteractionAt?: string;
  order: number;
  projectId: string;
  sessionId: string;
  status: NativeSessionStatusIndicatorStatus;
  title: string;
};

function createNativeSessionStatusIndicatorCandidates(): NativeSessionStatusIndicatorCandidate[] {
  /**
   * CDXC:SessionStatusIndicators 2026-05-05-19:47
   * Floating AppKit circles summarize every open ghostex project session, not only
   * the active group's visible panes. Working means activity=`working`, while
   * available covers idle live sessions and other non-attention sessions.
   * CDXC:SessionStatusIndicators 2026-05-09-15:48
   * Menu bar status badges reuse this same candidate list and click routing.
   * Green selects attention sessions; orange selects activity=`working`
   * sessions, not lifecycleState=`running` live-idle sessions.
   * CDXC:SessionStatusIndicators 2026-05-09-15:53
   * The status-indicator native contract now uses `working` for the orange
   * work state everywhere. Reserve `running` for live runtime state, including
   * the workspace rail's gray live-idle count.
   */
  const candidates: NativeSessionStatusIndicatorCandidate[] = [];
  let order = 0;
  const openProjects = orderNativeProjectsForSidebar(
    projects.filter((project) => project.isRecentProject !== true),
  );

  for (const project of openProjects) {
    for (const group of project.workspace.groups) {
      for (const session of createProjectedSidebarSessionsForGroup(group)) {
        const status = getNativeSessionStatusIndicatorStatus(session);
        candidates.push({
          lastInteractionAt: session.lastInteractionAt,
          order,
          projectId: project.projectId,
          sessionId: session.sessionId,
          status,
          title: getNativePetOverlaySessionTitle(session),
        });
        order += 1;
      }
    }
  }

  return candidates;
}

function getNativeSessionStatusIndicatorStatus(
  session: SidebarSessionItem,
): NativeSessionStatusIndicatorStatus {
  if (session.activity === "attention") {
    return "attention";
  }
  if (session.activity === "working") {
    return "working";
  }
  return "available";
}

function syncNativeSessionStatusIndicators(): void {
  const counts = {
    attention: 0,
    available: 0,
    working: 0,
  };
  for (const candidate of createNativeSessionStatusIndicatorCandidates()) {
    counts[candidate.status] += 1;
  }
  postNative({
    attentionCount: counts.attention,
    availableCount: counts.available,
    hideFloatingIndicators: settings.hideFloatingSessionStatusIndicators,
    hideMenuBarIndicators: settings.hideMenuBarSessionStatusIndicators,
    workingCount: counts.working,
    size: settings.sessionStatusIndicatorSize,
    type: "setSessionStatusIndicators",
  });
}

function syncNativePetOverlayState(): void {
  const activities = createNativeSessionStatusIndicatorCandidates()
    .filter(
      (candidate): candidate is NativeSessionStatusIndicatorCandidate & {
        status: NativePetOverlayActivityState;
      } => candidate.status === "attention" || candidate.status === "working",
    )
    .sort(compareNativeSessionStatusIndicatorCandidates)
    .slice(0, 3)
    .map((candidate) => ({
      id: candidate.sessionId,
      projectId: candidate.projectId,
      state: candidate.status,
      title: candidate.title,
    }));
  /**
   * CDXC:PetOverlay 2026-05-14-10:23:
   * The pet bubble is a concrete session shortcut, not another aggregate
   * status badge. Send both project and session ids so a click can raise ghostex
   * and activate exactly the session named above the pet, even when it belongs
   * to a background project.
   */
  postNative({
    activities,
    enabled: settings.petOverlayEnabled,
    selectedPetId: settings.selectedPetId,
    type: "setPetOverlayState",
  });
}

function getNativePetOverlaySessionTitle(session: SidebarSessionItem): string {
  const title =
    session.primaryTitle?.trim() ||
    session.terminalTitle?.trim() ||
    session.alias.trim() ||
    session.sessionNumber?.trim();
  return title || "Untitled session";
}

function handleNativeSessionStatusIndicatorClicked(
  status: NativeSessionStatusIndicatorStatus,
): void {
  const target = selectNativeSessionStatusIndicatorTarget(status);
  if (!target) {
    return;
  }

  postNative({ type: "activateApp" });
  if (activeProjectId !== target.projectId) {
    focusProject(target.projectId);
  }
  focusSidebarSession(target.sessionId);
}

function handleNativePetOverlayActivityClicked(projectId: string, sessionId: string): void {
  /**
   * CDXC:PetOverlay 2026-05-14-10:23:
   * Clicking a pet message should behave like clicking the matching session
   * card after ghostex has been brought forward. Route through the normal session
   * focus path so pane restoration, attention acknowledgement, and project
   * switching stay in one implementation.
   */
  const project = findProject(projectId);
  if (!project || !findSessionRecordInProject(project, sessionId)) {
    return;
  }
  postNative({ type: "activateApp" });
  if (activeProjectId !== project.projectId) {
    focusProject(project.projectId);
  }
  focusSidebarSession(sessionId);
}

function handleNativeSessionAttentionNotificationClicked(sessionId: string): void {
  /**
   * CDXC:SessionAttentionNotifications 2026-05-10-16:46
   * Clicking a macOS attention banner must route through the same sidebar
   * focus path as session cards so project switching, pane restoration, and
   * native first-responder activation all happen before the user types.
   */
  if (!findSessionRecord(sessionId)) {
    return;
  }
  postNative({ type: "activateApp" });
  focusSidebarSession(sessionId);
}

function selectNativeSessionStatusIndicatorTarget(
  status: NativeSessionStatusIndicatorStatus,
): NativeSessionStatusIndicatorCandidate | undefined {
  const candidates = createNativeSessionStatusIndicatorCandidates()
    .filter((candidate) => candidate.status === status)
    .sort(compareNativeSessionStatusIndicatorCandidates);
  if (candidates.length === 0) {
    return undefined;
  }

  const focusedSessionId = activeSnapshot().focusedSessionId;
  const focusedIndex = candidates.findIndex(
    (candidate) =>
      candidate.projectId === activeProjectId && candidate.sessionId === focusedSessionId,
  );
  if (focusedIndex >= 0 && candidates.length > 1) {
    return candidates[(focusedIndex + 1) % candidates.length];
  }
  return candidates[0];
}

function compareNativeSessionStatusIndicatorCandidates(
  left: NativeSessionStatusIndicatorCandidate,
  right: NativeSessionStatusIndicatorCandidate,
): number {
  const timeDelta =
    getNativeIndicatorTimestamp(right.lastInteractionAt) -
    getNativeIndicatorTimestamp(left.lastInteractionAt);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return left.order - right.order;
}

function getNativeIndicatorTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function postWorkspaceBarState(): void {
  /**
   * CDXC:WorkspaceDock 2026-04-27-08:45
   * The workspace dock is rendered inside the same React sidebar tree as the
   * session sidebar. Publish state through a browser event instead of the old
   * second WKWebView bridge so context menus, drag feedback, and workspace
   * buttons share one React surface.
   */
  window.dispatchEvent(
    new CustomEvent<WorkspaceBarStateMessage>(WORKSPACE_DOCK_STATE_EVENT, {
      detail: createWorkspaceBarState(),
    }),
  );
}

function createNativeSessionStateFilePath(projectId: string, sessionId: string): string {
  const safeProjectId = sanitizeNativePathPart(projectId);
  const safeSessionId = sanitizeNativePathPart(sessionId);
  return `${nativeGhostexHomeDirectory()}/session-state/${safeProjectId}/${safeSessionId}.env`;
}

function createNativeAgentSessionEnvironment(args: {
  agentName?: string;
  project: NativeProject;
  sessionId: string;
  sessionStateFilePath: string;
}): Record<string, string> {
  /**
   * CDXC:SessionTitleSync 2026-04-26-09:23
   * VSmux first-message auto-renaming depends on Codex/Claude hooks writing a
   * session state file keyed by VSMUX_SESSION_STATE_FILE. Native Ghostty
   * sessions must launch agents with the same env contract so the sidebar can
   * generate `/rename <title>` from the first submitted Codex prompt.
   *
   * CDXC:SessionTitleSync 2026-04-26-20:27
   * First-prompt hooks may be installed by either the old VSmux pipeline or the
   * native ghostex pipeline. Provide both VSMUX_* and GHOSTEX_* environment keys so
   * the hook can write one canonical session-state file.
   *
   * CDXC:PiAgent 2026-05-08-09:42
   * Pi's globally installed extension reads the same session-state env keys in
   * blank terminals and agent-launched terminals, which lets manual `pi`
   * starts report Pi session metadata back into the sidebar.
   */
  const environment: Record<string, string> = {
    VSMUX_AGENT: args.agentName ?? "",
    VSMUX_SESSION_ID: args.sessionId,
    VSMUX_SESSION_STATE_FILE: args.sessionStateFilePath,
    VSMUX_WORKSPACE_ID: args.project.projectId,
    VSMUX_WORKSPACE_ROOT: args.project.path,
    GHOSTEX_AGENT: args.agentName ?? "",
    GHOSTEX_SESSION_ID: args.sessionId,
    GHOSTEX_SESSION_STATE_FILE: args.sessionStateFilePath,
    GHOSTEX_WORKSPACE_ID: args.project.projectId,
    GHOSTEX_WORKSPACE_ROOT: args.project.path,
    ghostex_AGENT: args.agentName ?? "",
    ghostex_SESSION_ID: args.sessionId,
    ghostex_SESSION_STATE_FILE: args.sessionStateFilePath,
    ghostex_WORKSPACE_ID: args.project.projectId,
    ghostex_WORKSPACE_ROOT: args.project.path,
  };
  if (settings.promptEditorBackend === "monaco" || settings.promptEditorBackend === "zpet") {
    /**
     * CDXC:PromptEditorBackend 2026-05-11-14:38
     * Ctrl+G prompt editing is selected in Settings as a backend. Inject both
     * the immediate EDITOR value and the backend marker native uses to reapply
     * the same command after zsh startup files have run.
     */
    const promptEditorCommand =
      settings.promptEditorBackend === "zpet"
        ? "ghostex floating-editor -- zpet"
        : "ghostex floating-monaco-editor";
    environment.EDITOR = promptEditorCommand;
    environment.VISUAL = promptEditorCommand;
    environment.GHOSTEX_PROMPT_EDITOR_BACKEND = settings.promptEditorBackend;
    environment.GHOSTEX_PROMPT_EDITING_ENABLED = "1";
    environment.GHOSTEX_RICH_PROMPT_EDITING_WITH_ZAPET =
      settings.promptEditorBackend === "zpet" ? "1" : "0";
  }
  return environment;
}

function nativeHomeDirectory(): string {
  return (
    window.__ghostex_NATIVE_HOST__?.homeDir?.trim() ||
    inferHomeDirectoryFromPath(initialWorkspacePath) ||
    nativeFallbackHomeDirectory()
  );
}

function codeServerVscodeUserConfigDirectory(): string {
  /**
   * CDXC:EditorPanes 2026-05-06-15:00
   * code-server receives the local VS Code user settings directory at launch.
   * Stable VS Code is the default; the Insiders checkbox switches only this
   * path while keeping --link-vscode-user-config enabled.
   */
  const appName = settings.codeServerUseVscodeInsidersUserConfig ? "Code - Insiders" : "Code";
  return `${nativeHomeDirectory()}/Library/Application Support/${appName}/User`;
}

function nativeGhostexHomeDirectory(): string {
  /**
   * CDXC:DevAppFlavor 2026-04-28-02:01
   * The native host supplies the app-specific ghostex home used for hooks and
   * per-session state.
   * CDXC:DevAppFlavor 2026-05-11-12:10
   * `bun start:dev` must not read or write the installed app's ~/.ghostex data,
   * so ghostex-dev receives ~/.ghostex-dev here while production keeps ~/.ghostex.
   */
  return (
    window.__ghostex_NATIVE_HOST__?.ghostexHomeDir?.trim() ||
    `${nativeHomeDirectory()}/.ghostex`
  );
}

function nativeFallbackHomeDirectory(): string {
  return "/Users/Shared";
}

function inferHomeDirectoryFromPath(path: string): string | undefined {
  const match = /^\/Users\/[^/]+/.exec(path);
  return match?.[0];
}

function sanitizeNativePathPart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/giu, "-").replace(/^-+|-+$/g, "") || "session";
}

async function ensureNativeAgentFirstPromptHooks(): Promise<void> {
  /**
   * CDXC:SessionTitleSync 2026-04-26-09:23
   * The native app is outside VS Code, so it cannot rely on extension activation
   * to install agent UserPromptSubmit hooks. Install a small ghostex-owned hook
   * beside existing Codex and Claude hooks; it writes the first prompt into the
   * session state file that the native sidebar polls before sending Codex
   * `/rename <title>` or Claude's bare `/rename`.
   *
   * CDXC:SessionTitleSync 2026-05-05-04:27
   * Codex terminals launched from ghostex can run with CODEX_HOME pointed at a
   * profile directory such as ~/.codex-profiles/personal. Install the native
   * first-prompt hook into every existing Codex profile as well as ~/.codex so
   * prompt capture follows the Codex home that the terminal actually uses.
   *
   * CDXC:PiAgent 2026-05-08-09:42
   * Pi can be launched manually in a blank terminal, so ghostex installs its Pi
   * extension into Pi's global auto-discovery directory instead of relying only
   * on ghostex-created launch commands to pass an extension flag.
   */
  const command = buildEnsureNativeAgentHooksCommand();
  const result = await runNativeProcess("/bin/zsh", ["-lc", command]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Agent hook install failed.");
  }
  const installedCodexHooksPaths = result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("codexHooksPath="))
    .map((line) => line.slice("codexHooksPath=".length))
    .filter(Boolean);
  appendSessionTitleDebugLog("nativeSidebar.firstPromptAutoRename.hooksInstalled", {
    claudeSettingsPath: `${nativeHomeDirectory()}/.claude/settings.json`,
    codexHooksPaths: installedCodexHooksPaths.length
      ? installedCodexHooksPaths
      : [`${nativeHomeDirectory()}/.codex/hooks.json`],
    notifyHookPath: ghostex_AGENT_NOTIFY_HOOK_PATH,
    piExtensionPath: NATIVE_PI_EXTENSION_PATH,
  });
}

function buildEnsureNativeAgentHooksCommand(): string {
  const notifyHookPath = ghostex_AGENT_NOTIFY_HOOK_PATH;
  const piExtensionPath = NATIVE_PI_EXTENSION_PATH;
  const homeDirectory = nativeHomeDirectory();
  const claudeSettingsPath = `${nativeHomeDirectory()}/.claude/settings.json`;
  return [
    "set -e",
    `mkdir -p ${quoteNativeShellArg(dirnameNativePath(notifyHookPath))} ${quoteNativeShellArg(dirnameNativePath(claudeSettingsPath))} ${quoteNativeShellArg(dirnameNativePath(piExtensionPath))}`,
    `cat > ${quoteNativeShellArg(notifyHookPath)} <<'ghostex_NOTIFY_HOOK'`,
    getNativeCodexNotifyHookScript(),
    "ghostex_NOTIFY_HOOK",
    `chmod 755 ${quoteNativeShellArg(notifyHookPath)}`,
    `cat > ${quoteNativeShellArg(piExtensionPath)} <<'ghostex_PI_EXTENSION'`,
    getNativePiExtensionScript(),
    "ghostex_PI_EXTENSION",
    `/usr/bin/python3 - ${quoteNativeShellArg(notifyHookPath)} ${quoteNativeShellArg(homeDirectory)} <<'ghostex_CODEX_HOOK_MERGE_ALL'`,
    getNativeCodexHookMergeAllScript(),
    "ghostex_CODEX_HOOK_MERGE_ALL",
    `/usr/bin/python3 - ${quoteNativeShellArg(claudeSettingsPath)} ${quoteNativeShellArg(notifyHookPath)} claude <<'ghostex_CLAUDE_HOOK_MERGE'`,
    getNativeAgentHookMergeScript(),
    "ghostex_CLAUDE_HOOK_MERGE",
  ].join("\n");
}

function getNativeCodexNotifyHookScript(): string {
  return `#!/bin/bash
if [ -n "$1" ]; then
  INPUT="$1"
else
  INPUT="$(cat)"
fi

SESSION_STATE_FILE="\${VSMUX_SESSION_STATE_FILE:-\${GHOSTEX_SESSION_STATE_FILE:-$ghostex_SESSION_STATE_FILE}}"
if [ -z "$SESSION_STATE_FILE" ]; then
  printf '{"continue":true}'
  exit 0
fi

/usr/bin/python3 - "$SESSION_STATE_FILE" "$INPUT" <<'PY'
import datetime
import base64
import json
import os
import pathlib
import sys

state_path = sys.argv[1]
raw_input = sys.argv[2]
try:
    payload = json.loads(raw_input)
except Exception:
    payload = {}

event_name = payload.get("hook_event_name")
if event_name != "UserPromptSubmit":
    sys.exit(0)

prompt = str(payload.get("prompt") or "").strip()
if not prompt:
    sys.exit(0)

state = {}
try:
    with open(state_path, "r", encoding="utf-8") as handle:
        for line in handle:
            key, separator, value = line.partition("=")
            if separator:
                state[key] = value.strip() if key in {"firstUserMessageBase64", "agentSessionPath"} else " ".join(value.strip().split())
except FileNotFoundError:
    pass

if state.get("autoTitleFromFirstPrompt") in {"1", "true", "TRUE", "True"}:
    sys.exit(0)

payload_agent = payload.get("agent")
state["status"] = state.get("status") or "idle"
state["agent"] = state.get("agent") or (payload_agent if isinstance(payload_agent, str) else "") or os.environ.get("VSMUX_AGENT") or os.environ.get("GHOSTEX_AGENT") or os.environ.get("ghostex_AGENT") or "codex"
state["firstUserMessageBase64"] = state.get("firstUserMessageBase64") or base64.b64encode(prompt.encode("utf-8")).decode("ascii")
if state.get("pendingFirstPromptAutoRenamePrompt", "").strip():
    path = pathlib.Path(state_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text("".join(f"{key}={state.get(key, '')}\\n" for key in [
        "status",
        "agent",
        "agentSessionId",
        "agentSessionPath",
        "firstUserMessageBase64",
        "frozenAt",
        "autoTitleFromFirstPrompt",
        "historyBase64",
        "lastActivityAt",
        "pendingFirstPromptAutoRenamePrompt",
        "title",
    ]), encoding="utf-8")
    temp_path.replace(path)
    sys.exit(0)

state["lastActivityAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
state["pendingFirstPromptAutoRenamePrompt"] = " ".join(prompt.split())

keys = [
    "status",
    "agent",
    "agentSessionId",
    "agentSessionPath",
    "firstUserMessageBase64",
    "frozenAt",
    "autoTitleFromFirstPrompt",
    "historyBase64",
    "lastActivityAt",
    "pendingFirstPromptAutoRenamePrompt",
    "title",
]
path = pathlib.Path(state_path)
path.parent.mkdir(parents=True, exist_ok=True)
temp_path = path.with_suffix(path.suffix + ".tmp")
with open(temp_path, "w", encoding="utf-8") as handle:
    for key in keys:
        handle.write(f"{key}={state.get(key, '')}\\n")
temp_path.replace(path)
PY

printf '{"continue":true}'
exit 0
`;
}

function getNativeAgentHookMergeScript(): string {
  return `import json
import pathlib
import sys

hooks_path = pathlib.Path(sys.argv[1])
notify_hook_path = sys.argv[2]
agent_name = sys.argv[3]
command = notify_hook_path
try:
    with open(hooks_path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except FileNotFoundError:
    data = {}

if not isinstance(data, dict):
    data = {}
hooks = data.get("hooks")
if not isinstance(hooks, dict):
    hooks = {}
    data["hooks"] = hooks

groups = hooks.get("UserPromptSubmit")
if not isinstance(groups, list):
    groups = []

def is_ghostex_command(hook):
    return isinstance(hook, dict) and hook.get("command") == command

matcher = "*" if agent_name == "claude" else None

for group in groups:
    if not isinstance(group, dict):
        continue
    group_hooks = group.get("hooks")
    if isinstance(group_hooks, list) and any(is_ghostex_command(hook) for hook in group_hooks):
        hooks["UserPromptSubmit"] = groups
        hooks_path.parent.mkdir(parents=True, exist_ok=True)
        with open(hooks_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\\n")
        sys.exit(0)

next_group = {
    "hooks": [
        {
            "type": "command",
            "command": command,
        }
    ]
}
if matcher is not None:
    next_group["matcher"] = matcher
groups.append(next_group)
hooks["UserPromptSubmit"] = groups
hooks_path.parent.mkdir(parents=True, exist_ok=True)
with open(hooks_path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2)
    handle.write("\\n")
`;
}

function getNativePiExtensionScript(): string {
  return `import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";

const BRAILLE_FRAMES = ["⠸", "⠴", "⠼", "⠧", "⠦", "⠏", "⠋", "⠇", "⠙", "⠹"] as const;
const STATE_KEYS = [
  "status",
  "agent",
  "agentSessionId",
  "agentSessionPath",
  "firstUserMessageBase64",
  "frozenAt",
  "autoTitleFromFirstPrompt",
  "historyBase64",
  "lastActivityAt",
  "pendingFirstPromptAutoRenamePrompt",
  "title",
] as const;

function getStateFile(): string | undefined {
  return (
    process.env.VSMUX_SESSION_STATE_FILE ||
    process.env.GHOSTEX_SESSION_STATE_FILE ||
    process.env.ghostex_SESSION_STATE_FILE
  );
}

function readState(filePath: string): Record<string, string> {
  const state: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\\r?\\n/g)) {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1);
      state[key] = key === "firstUserMessageBase64" || key === "agentSessionPath"
        ? value.trim()
        : value.trim().replace(/\\s+/g, " ");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return state;
}

function writeState(filePath: string, state: Record<string, string>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + ".tmp";
  fs.writeFileSync(
    tempPath,
    STATE_KEYS.map((key) => key + "=" + (state[key] || "")).join("\\n") + "\\n",
    "utf8",
  );
  fs.renameSync(tempPath, filePath);
}

function baseTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const cwd = path.basename(ctx.cwd || process.cwd());
  const session = pi.getSessionName();
  return session ? "π - " + session + " - " + cwd : "π - " + cwd;
}

function syncSessionState(pi: ExtensionAPI, ctx: ExtensionContext, updates: Record<string, string> = {}): void {
  const filePath = getStateFile();
  if (!filePath) {
    return;
  }
  const state = readState(filePath);
  state.status = updates.status || state.status || "idle";
  state.agent = "pi";
  state.agentSessionId = ctx.sessionManager.getSessionId() || state.agentSessionId || "";
  state.agentSessionPath = ctx.sessionManager.getSessionFile() || state.agentSessionPath || "";
  state.title = pi.getSessionName() || state.title || "";
  for (const [key, value] of Object.entries(updates)) {
    state[key] = value;
  }
  writeState(filePath, state);
}

function captureInput(pi: ExtensionAPI, event: InputEvent, ctx: ExtensionContext): void {
  const prompt = event.text.trim();
  if (!prompt) {
    return;
  }
  const filePath = getStateFile();
  if (!filePath) {
    return;
  }
  const state = readState(filePath);
  state.status = state.status || "idle";
  state.agent = "pi";
  state.agentSessionId = ctx.sessionManager.getSessionId() || state.agentSessionId || "";
  state.agentSessionPath = ctx.sessionManager.getSessionFile() || state.agentSessionPath || "";
  state.title = pi.getSessionName() || state.title || "";
  state.firstUserMessageBase64 =
    state.firstUserMessageBase64 || Buffer.from(prompt, "utf8").toString("base64");
  state.lastActivityAt = new Date().toISOString();
  if (!state.pendingFirstPromptAutoRenamePrompt && !/^(1|true)$/iu.test(state.autoTitleFromFirstPrompt || "")) {
    state.pendingFirstPromptAutoRenamePrompt = prompt.replace(/\\s+/g, " ");
  }
  writeState(filePath, state);
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let frameIndex = 0;

  function stopAnimation(ctx: ExtensionContext): void {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    frameIndex = 0;
    ctx.ui.setTitle(baseTitle(pi, ctx));
  }

  function startAnimation(ctx: ExtensionContext): void {
    stopAnimation(ctx);
    timer = setInterval(() => {
      const frame = BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length];
      ctx.ui.setTitle(frame + " " + baseTitle(pi, ctx));
      frameIndex += 1;
    }, 120);
  }

  pi.on("session_start", async (_event, ctx) => {
    syncSessionState(pi, ctx);
    ctx.ui.setTitle(baseTitle(pi, ctx));
  });

  pi.on("input", async (event, ctx) => {
    captureInput(pi, event, ctx);
    return { action: "continue" };
  });

  pi.on("agent_start", async (_event, ctx) => {
    syncSessionState(pi, ctx, { status: "working", lastActivityAt: new Date().toISOString() });
    startAnimation(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    syncSessionState(pi, ctx, { status: "idle", lastActivityAt: new Date().toISOString() });
    stopAnimation(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    syncSessionState(pi, ctx, { status: "idle" });
    stopAnimation(ctx);
  });
}
`;
}

function getNativeCodexHookMergeAllScript(): string {
  return `import json
import pathlib
import sys

notify_hook_path = pathlib.Path(sys.argv[1])
home_path = pathlib.Path(sys.argv[2])
command = str(notify_hook_path)

def load_hooks_data(hooks_path):
    try:
        with open(hooks_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        data = {}

    if not isinstance(data, dict):
        data = {}
    hooks = data.get("hooks")
    if not isinstance(hooks, dict):
        hooks = {}
        data["hooks"] = hooks
    return data, hooks

def is_ghostex_command(hook):
    return isinstance(hook, dict) and hook.get("command") == command

def merge_hook(hooks_path):
    data, hooks = load_hooks_data(hooks_path)
    groups = hooks.get("UserPromptSubmit")
    if not isinstance(groups, list):
        groups = []

    for group in groups:
        if not isinstance(group, dict):
            continue
        group_hooks = group.get("hooks")
        if isinstance(group_hooks, list) and any(is_ghostex_command(hook) for hook in group_hooks):
            hooks["UserPromptSubmit"] = groups
            hooks_path.parent.mkdir(parents=True, exist_ok=True)
            with open(hooks_path, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2)
                handle.write("\\n")
            return

    groups.append({
        "hooks": [
            {
                "type": "command",
                "command": command,
            }
        ]
    })
    hooks["UserPromptSubmit"] = groups
    hooks_path.parent.mkdir(parents=True, exist_ok=True)
    with open(hooks_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\\n")

hook_paths = [home_path / ".codex" / "hooks.json"]
profiles_path = home_path / ".codex-profiles"
if profiles_path.is_dir():
    for profile_path in sorted(profiles_path.iterdir()):
        if profile_path.is_dir():
            hook_paths.append(profile_path / "hooks.json")

seen = set()
for hooks_path in hook_paths:
    resolved = str(hooks_path)
    if resolved in seen:
        continue
    seen.add(resolved)
    merge_hook(hooks_path)
    print(f"codexHooksPath={resolved}")
`;
}

function dirnameNativePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : ".";
}

function quoteNativeShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function suppressNativeSessionActivityIndicators(
  sessionId: string,
  reason: "agent-launch" | "restore-resume-command",
): void {
  const suppressedUntil = Date.now() + NATIVE_INITIAL_ACTIVITY_SUPPRESSION_MS;
  nativeActivitySuppressedUntilBySessionId.set(sessionId, suppressedUntil);
  nativeWorkingStartedAtBySessionId.delete(sessionId);
  const terminalState = terminalStateById.get(sessionId);
  if (terminalState?.activity === "attention" || terminalState?.activity === "working") {
    terminalState.activity = "idle";
    clearNativeSessionAttentionTracking(sessionId);
  }
  /**
   * CDXC:SessionRestore 2026-04-27-08:20
   * Native Ghostty title events can briefly report agent working/done markers
   * while a new or resumed agent is still booting. Mirror agent-tiler's startup
   * activity suppression so launch/resume noise does not flash Working or Done
   * before the agent has had a real chance to work.
   */
  appendAgentDetectionDebugLog("nativeSidebar.activitySuppression.started", {
    reason,
    sessionId,
    suppressedUntil: new Date(suppressedUntil).toISOString(),
  });
}

function getNativeActivitySuppressedUntil(sessionId: string): number | undefined {
  const suppressedUntil = nativeActivitySuppressedUntilBySessionId.get(sessionId);
  if (
    suppressedUntil !== undefined &&
    Number.isFinite(suppressedUntil) &&
    suppressedUntil <= Date.now()
  ) {
    nativeActivitySuppressedUntilBySessionId.delete(sessionId);
    appendAgentDetectionDebugLog("nativeSidebar.activitySuppression.expired", {
      sessionId,
      suppressedUntil: new Date(suppressedUntil).toISOString(),
    });
    return undefined;
  }

  return suppressedUntil;
}

function getNativeEffectiveTitleActivity(
  sessionId: string,
  nextDerivedActivity: TitleDerivedSessionActivity,
): TitleDerivedSessionActivity {
  const now = Date.now();
  const suppressedUntil = getNativeActivitySuppressedUntil(sessionId);
  if (suppressedUntil !== undefined && Number.isFinite(suppressedUntil) && now < suppressedUntil) {
    nativeWorkingStartedAtBySessionId.delete(sessionId);
    return { ...nextDerivedActivity, activity: "idle" };
  }

  if (nextDerivedActivity.activity === "working") {
    if (!nativeWorkingStartedAtBySessionId.has(sessionId)) {
      nativeWorkingStartedAtBySessionId.set(sessionId, now);
    }
    return nextDerivedActivity;
  }

  if (nextDerivedActivity.activity === "attention") {
    const workingStartedAt = nativeWorkingStartedAtBySessionId.get(sessionId);
    const workingDurationMs =
      workingStartedAt === undefined ? undefined : Math.max(0, now - workingStartedAt);
    if (
      workingStartedAt === undefined ||
      (workingDurationMs ?? 0) < NATIVE_MIN_WORKING_DURATION_BEFORE_ATTENTION_MS
    ) {
      nativeWorkingStartedAtBySessionId.delete(sessionId);
      appendAgentDetectionDebugLog("nativeSidebar.activitySuppression.attentionSuppressed", {
        sessionId,
        workingDurationMs,
      });
      return { ...nextDerivedActivity, activity: "idle" };
    }
    return nextDerivedActivity;
  }

  nativeWorkingStartedAtBySessionId.delete(sessionId);
  return nextDerivedActivity;
}

function buildNativeRestoredTerminalInitialInput(session: TerminalSessionRecord): string {
  const command = buildNativeResumeAgentCommand(session);
  return command ? `${command}\r` : "";
}

function canRestoreNativeTerminalSession(session: TerminalSessionRecord): boolean {
  const agentId = resolveNativeResumeAgentId(session.agentName);
  if (agentId === "pi") {
    return Boolean(resolveNativeAgentCommand(agentId) && getNativePiSessionReference(session));
  }
  if (agentId === "codex") {
    return Boolean(
      resolveNativeAgentCommand(agentId) &&
        (getNativeStoredTrustedResumeTitle(session).title !== undefined ||
          getNativeCodexSessionReference(session) !== undefined),
    );
  }
  return (
    (agentId === "claude" || agentId === "opencode") &&
    Boolean(resolveNativeAgentCommand(agentId)) &&
    getNativeStoredTrustedResumeTitle(session).title !== undefined
  );
}

function getNativePaneTitleBarActions(session: SessionRecord): NativeTerminalTitleBarAction[] {
  /**
   * CDXC:PaneTitleBarUX 2026-05-11-11:05
   * Terminal title bars expose hover-only reload/fork/rename, Delayed Send,
   * split, browser, and terminal creation controls. Close and Sleep moved into
   * each hovered tab on 2026-05-11-02:02 so the tab controls target the
   * represented session even when the selected pane owns a different titlebar
   * view.
   *
   * Browser and T3 Code panes expose pane creation, split controls, and the
   * project-scoped Merge All Tabs command in title-bar chrome. Their
   * page/runtime tooling stays in the dedicated browser/T3 surfaces.
   *
   * CDXC:PaneTabs 2026-05-15-13:35
   * Merge All Tabs belongs directly below Split Sideways and Split Downwards
   * in normal workspace pane menus. It merges the clicked workspace group's
   * split/tab tree into one pane while command terminals remain in the separate
   * Commands panel action set.
   */
  const popOutAction = session.isPoppedOut === true ? "restorePopOut" : "popOut";
  if (session.kind === "browser" || session.kind === "t3") {
    return [
      "newTerminal",
      "openBrowser",
      "splitHorizontal",
      "splitVertical",
      "rotatePanesClockwise",
      "mergeAllTabs",
    ];
  }
  return [
    "newTerminal",
    "openBrowser",
    "splitHorizontal",
    "splitVertical",
    "rotatePanesClockwise",
    "mergeAllTabs",
    "rename",
    "delayedSend",
    "fork",
    "reload",
    popOutAction,
  ];
}

type NativeResumeAgentId = "claude" | "codex" | "copilot" | "gemini" | "opencode" | "pi";

function buildNativeResumeAgentCommand(session: TerminalSessionRecord): string | undefined {
  const agentId = resolveNativeResumeAgentId(session.agentName);
  if (agentId !== "claude" && agentId !== "codex" && agentId !== "opencode" && agentId !== "pi") {
    return undefined;
  }
  const agentCommand = resolveNativeAgentCommand(agentId);
  const resumeTitle = agentId === "pi" ? undefined : getNativeTrustedResumeTitle(session);
  const codexSessionReference =
    agentId === "codex" ? (resumeTitle ?? getNativeCodexSessionReference(session)) : undefined;
  const piSessionReference = agentId === "pi" ? getNativePiSessionReference(session) : undefined;
  if (
    !agentId ||
    !agentCommand ||
    (agentId === "pi" ? !piSessionReference : agentId === "codex" ? !codexSessionReference : !resumeTitle)
  ) {
    return undefined;
  }

  /**
   * CDXC:SessionRestore 2026-04-27-07:38
   * Automatic reopen uses the agent-specific resume syntax that users expect:
   * Claude receives `claude --resume <title>`, Codex receives
   * `codex resume <title>`, and OpenCode resolves the stored title to its
   * session ID before launching so restored terminals attach to saved sessions.
   *
   * CDXC:PiAgent 2026-05-08-09:42
   * Pi restore must use the Pi jsonl session path/id captured by the global Pi
   * extension. Titles are display labels only and are not unique enough for Pi
   * resume or fork parity with Codex.
   */
  switch (agentId) {
    case "codex":
      if (!codexSessionReference) {
        return undefined;
      }
      return `${agentCommand} resume ${quoteNativeShellArg(codexSessionReference)}`;
    case "claude":
      if (!resumeTitle) {
        return undefined;
      }
      return `${agentCommand} --resume ${quoteNativeShellArg(resumeTitle)}`;
    case "opencode":
      if (!resumeTitle) {
        return undefined;
      }
      return buildNativeOpenCodeResumeCommand(agentCommand, resumeTitle);
    case "pi":
      if (!piSessionReference) {
        return undefined;
      }
      return `${agentCommand} --session ${quoteNativeShellArg(piSessionReference)}`;
    default:
      return undefined;
  }
}

function buildNativeCopyResumeCommand(
  session: TerminalSessionRecord,
): string | undefined {
  const agentId = resolveNativeResumeAgentId(session.agentName);
  const agentCommand = resolveNativeAgentCommand(agentId);
  if (!agentId || !agentCommand) {
    return undefined;
  }
  const resumeTitle = getNativeTrustedResumeTitle(session);

  switch (agentId) {
    case "codex": {
      const codexSessionReference = resumeTitle ?? getNativeCodexSessionReference(session);
      return codexSessionReference
        ? `${agentCommand} resume ${quoteNativeShellArg(codexSessionReference)}`
        : `${agentCommand} resume`;
    }
    case "claude":
      return resumeTitle
        ? `${agentCommand} --resume ${quoteNativeShellArg(resumeTitle)}`
        : `${agentCommand} --resume`;
    case "opencode":
      return buildNativeOpenCodeCopyResumeCommand(agentCommand, session);
    case "pi": {
      const piSessionReference = getNativePiSessionReference(session);
      return piSessionReference
        ? `${agentCommand} --session ${quoteNativeShellArg(piSessionReference)}`
        : `${agentCommand} --resume`;
    }
    case "gemini":
      return `${agentCommand} --list-sessions && echo 'Enter ${agentCommand} -r id' to resume a session`;
    case "copilot":
      return `${agentCommand} --continue && echo 'Or use ${agentCommand} --resume to pick a session, or ${agentCommand} --resume SESSION-ID if you know it'`;
    default:
      return undefined;
  }
}

function buildNativeCodexForkCommand(session: TerminalSessionRecord): string | undefined {
  const agentCommand = resolveNativeAgentCommand("codex");
  const resumeTitle = getNativeTrustedResumeTitle(session);
  if (!agentCommand || !resumeTitle) {
    return undefined;
  }

  /**
   * CDXC:CodexAgent 2026-05-08-16:22
   * Codex title-bar Fork must launch `codex fork <session-id>` instead of a
   * blank terminal. The CLI fork subcommand accepts UUIDs, while ghostex's stored
   * Codex identity is the trusted thread title used for resume, so resolve the
   * latest matching thread name from Codex session indexes at launch time.
   */
  const lookupCommand = [
    "CODEX_FORK_SESSION_ID=\"$(",
    `/usr/bin/python3 -c ${quoteNativeShellArg(getNativeCodexSessionIdLookupScript())} ${quoteNativeShellArg(resumeTitle)}`,
    ")\"",
    "&&",
    "test -n \"$CODEX_FORK_SESSION_ID\"",
    "&&",
    `${agentCommand} fork "$CODEX_FORK_SESSION_ID"`,
    "||",
    `printf '%s\\n' ${quoteNativeShellArg(`Unable to find Codex session id for "${resumeTitle}".`)}`,
  ].join(" ");
  return lookupCommand;
}

function buildNativeClaudeForkCommand(session: TerminalSessionRecord): string | undefined {
  const agentCommand = resolveNativeAgentCommand("claude");
  const resumeTitle = getNativeTrustedResumeTitle(session);
  if (!agentCommand || !resumeTitle) {
    return undefined;
  }

  /**
   * CDXC:ClaudeAgent 2026-05-08-16:25
   * Claude Code exposes forking as `--fork-session` on a resumed conversation.
   * Use that real CLI path for native Fork actions instead of opening an empty
   * pane, matching Claude's documented resume/fork semantics.
   */
  return `${agentCommand} --resume ${quoteNativeShellArg(resumeTitle)} --fork-session`;
}

function getNativeCodexSessionReference(session: TerminalSessionRecord): string | undefined {
  return getCodexSessionIdFromTitle(session.agentSessionId) ?? undefined;
}

function getNativePiSessionReference(session: TerminalSessionRecord): string | undefined {
  return session.agentSessionPath?.trim() || session.agentSessionId?.trim() || undefined;
}

function buildNativePiForkCommand(session: TerminalSessionRecord): string | undefined {
  const agentCommand = resolveNativeAgentCommand("pi");
  const piSessionReference = getNativePiSessionReference(session);
  return agentCommand && piSessionReference
    ? `${agentCommand} --fork ${quoteNativeShellArg(piSessionReference)}`
    : undefined;
}

function buildNativeOpenCodeResumeCommand(agentCommand: string, resumeTitle: string): string {
  return `${agentCommand} -s "$(${agentCommand} session list --format json | /usr/bin/python3 -c ${quoteNativeShellArg(getNativeOpenCodeSessionLookupScript())} ${quoteNativeShellArg(resumeTitle)})"`;
}

function getNativeCodexSessionIdLookupScript(): string {
  return `import json
import os
import pathlib
import sys

title = sys.argv[1].strip()
if not title:
    sys.exit(1)

home = pathlib.Path.home()
candidate_homes = []
for value in [os.environ.get("CODEX_HOME")]:
    if value:
        candidate_homes.append(pathlib.Path(value).expanduser())
for value in [
    home / ".codex-profiles" / "personal",
    home / ".codex-profiles" / "work",
    home / ".codex",
]:
    candidate_homes.append(value)

seen = set()
matches = []
for codex_home in candidate_homes:
    codex_home = codex_home.resolve() if codex_home.exists() else codex_home
    if str(codex_home) in seen:
        continue
    seen.add(str(codex_home))
    index_path = codex_home / "session_index.jsonl"
    try:
        lines = index_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        continue
    for line in lines:
        try:
            item = json.loads(line)
        except Exception:
            continue
        if str(item.get("thread_name") or "").strip() != title:
            continue
        session_id = str(item.get("id") or "").strip()
        if not session_id:
            continue
        matches.append((str(item.get("updated_at") or ""), session_id))

if not matches:
    sys.exit(1)

matches.sort()
sys.stdout.write(matches[-1][1])
`;
}

function buildNativeOpenCodeCopyResumeCommand(
  agentCommand: string,
  session: TerminalSessionRecord,
): string {
  const resumeTitle = getNativeTrustedResumeTitle(session);
  return resumeTitle
    ? buildNativeOpenCodeResumeCommand(agentCommand, resumeTitle)
    : `${agentCommand} session list && echo 'Enter ${agentCommand} -s id' to resume a session`;
}

function getNativeTrustedResumeTitle(session: TerminalSessionRecord): string | undefined {
  const result = getNativeStoredTrustedResumeTitle(session);
  /**
   * CDXC:SessionRestore 2026-04-28-06:06
   * Restore trust is based on persisted title provenance plus title filtering,
   * not the sidebar `∗` marker. Generated, terminal-auto, and native user
   * titles are resumable because native user renames are submitted to the agent
   * with `/rename <title>`. Legacy records without a title source can also
   * resume when the title itself passes filtering. Explicit placeholders,
   * paths, bare agent names, and command noise remain rejected.
   */
  appendRestoreDebugLog("nativeSidebar.resumeTitleTrust", {
    reason: result.reason,
    sessionId: session.sessionId,
    title: session.title,
    titleSource: session.titleSource,
    trusted: result.title !== undefined,
  });
  return result.title;
}

function getNativeStoredTrustedResumeTitle(
  session: TerminalSessionRecord,
): { reason: string; title?: string } {
  if (!isNativeTrustedResumeTitleSource(session.titleSource)) {
    return { reason: `untrusted-title-source:${session.titleSource ?? "missing"}` };
  }
  const resumeTitle = getVisibleTerminalTitle(session.title)?.trim();
  if (!resumeTitle) {
    return { reason: "title-empty-or-filtered" };
  }
  if (isRejectedNativeResumeTitle(resumeTitle)) {
    return { reason: "title-rejected-as-command-or-noise" };
  }
  return { reason: "trusted-stored-title", title: resumeTitle };
}

function isNativeTrustedResumeTitleSource(
  titleSource: TerminalSessionRecord["titleSource"],
): boolean {
  return titleSource !== "placeholder";
}

function isRejectedNativeResumeTitle(title: string): boolean {
  const normalizedTitle = title.trim();
  const normalizedLowerTitle = normalizedTitle.toLowerCase();
  /**
   * CDXC:SessionRestore 2026-04-27-17:45
   * Resume must never target transient terminal command titles. Ghostty can
   * briefly publish the launched agent command (`x`, `codex`, etc.) or mojibake
   * status bytes as the title; those values are display noise, not persisted
   * agent session names.
   *
   * CDXC:SessionTitleSync 2026-05-07-17:27
   * zmx reconnect can also publish the Ghostty ghost placeholder before the
   * persisted pane title is available. Reject it here even though shared
   * visibility filtering also handles it, so native resume/title-sync callers
   * cannot persist the placeholder if they bypass that visibility step.
   */
  return (
    normalizedTitle === "ð^ß^Ñ»" ||
    isGhostPlaceholderSessionTitle(normalizedTitle) ||
    /[\u0000-\u001f\u007f]/u.test(normalizedTitle) ||
    (normalizedTitle.startsWith("ð") && normalizedTitle.endsWith("»")) ||
    getNativeAgentCommandExecutableNames().has(normalizedLowerTitle) ||
    getNativeAgentCommandExecutableNames().has(getNativeCommandExecutableName(normalizedLowerTitle) ?? "")
  );
}

function getNativeAgentCommandExecutableNames(): Set<string> {
  return new Set(
    [...DEFAULT_SIDEBAR_AGENTS.map((agent) => agent.command), ...storedAgents.map((agent) => agent.command)]
      .map(getNativeCommandExecutableName)
      .filter((commandName): commandName is string => Boolean(commandName)),
  );
}

function getNativeCommandExecutableName(command: string | undefined): string | undefined {
  const firstPart = command?.trim().split(/\s+/u)[0]?.trim();
  return firstPart ? firstPart.replace(/^['"]|['"]$/gu, "").toLowerCase() : undefined;
}

function getNativeOpenCodeSessionLookupScript(): string {
  return `import json, os, sys
title = sys.argv[1].strip()
sessions = json.load(sys.stdin)
cwd = os.getcwd()
match = next((session for session in sessions if session.get("title") == title and session.get("directory") == cwd), None)
if match is None:
    match = next((session for session in sessions if session.get("title") == title), None)
if not match or not match.get("id"):
    sys.exit(1)
sys.stdout.write(str(match["id"]))
`;
}

function resolveNativeResumeAgentId(
  agentName: string | undefined,
): NativeResumeAgentId | undefined {
  const normalizedAgentName = agentName?.trim().toLowerCase();
  if (!normalizedAgentName) {
    return undefined;
  }

  if (isNativeResumeAgentId(normalizedAgentName)) {
    return normalizedAgentName;
  }
  if (normalizedAgentName === "π") {
    return "pi";
  }

  const defaultAgent = getDefaultSidebarAgentById(normalizedAgentName);
  if (isNativeResumeAgentId(defaultAgent?.agentId)) {
    return defaultAgent.agentId;
  }

  const matchingAgent = agents.find(
    (agent) =>
      agent.agentId.trim().toLowerCase() === normalizedAgentName ||
      agent.name.trim().toLowerCase() === normalizedAgentName,
  );
  return isNativeResumeAgentId(matchingAgent?.agentId) ? matchingAgent.agentId : undefined;
}

function isNativeResumeAgentId(agentId: string | undefined): agentId is NativeResumeAgentId {
  return (
    agentId === "claude" ||
    agentId === "codex" ||
    agentId === "copilot" ||
    agentId === "gemini" ||
    agentId === "opencode" ||
    agentId === "pi"
  );
}

function resolveNativeAgentCommand(agentId: NativeResumeAgentId | undefined): string | undefined {
  if (!agentId) {
    return undefined;
  }

  return (
    agents.find((agent) => agent.agentId === agentId)?.command?.trim() ??
    getDefaultSidebarAgentById(agentId)?.command
  );
}

function createTerminal(
  title = DEFAULT_TERMINAL_SESSION_TITLE,
  initialInput = "",
  groupId?: string,
  agentName?: string,
  options?: {
    initialPresentation?: "background" | "focused";
    focusAfterCreate?: boolean;
    sessionPersistenceName?: string;
    sessionPersistenceProvider?: TerminalSessionPersistenceProvider;
    splitDirection?: "horizontal" | "vertical";
    visiblePlacement?: VisibleSessionPlacement;
  },
): TerminalSessionRecord | undefined {
  const project = activeProject();
  if (!shouldKeepProjectEditorOpenForNewSession(project.projectId)) {
    activateWorkspaceSurfaceForProject(project.projectId);
  }
  if (project.isChat === true) {
    const existingChatSession = findFirstTerminalSessionInProject(project);
    if (existingChatSession) {
      /**
       * CDXC:Chats 2026-05-04-09:41
       * Each chat folder is a single-terminal conversation container. Requests
       * to create another terminal while a chat is active should select the
       * existing chat terminal instead of adding a second session to that chat.
       */
      updateActiveProjectWorkspace(
        (workspace) =>
          focusSessionInSimpleWorkspace(workspace, existingChatSession.sessionId).snapshot,
      );
      publish();
      if (options?.focusAfterCreate !== false) {
        postNative({
          sessionId: nativeSessionIdForProjectSidebarSession(
            project.projectId,
            existingChatSession.sessionId,
          ),
          type: "focusTerminal",
        });
      }
      return existingChatSession;
    }
  }
  const targetWorkspace = groupId
    ? focusGroupInSimpleWorkspace(project.workspace, groupId).snapshot
    : project.workspace;
  const beforeSnapshot = targetWorkspace.groups.find(
    (group) => group.groupId === targetWorkspace.activeGroupId,
  )?.snapshot;
  appendSidebarRefreshDebugLog("nativeSidebar.createTerminal.before", {
    agentName,
    groupId,
    project: summarizeSidebarRefreshProject(project),
    title,
    visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
  });
  appendTerminalLaunchDebugLog("nativeSidebar.createTerminal.request", {
    activeProjectId,
    agentName,
    focusedSessionIdBefore: beforeSnapshot?.focusedSessionId,
    groupId,
    initialInputPreview: initialInput.trim().slice(0, 80),
    initialPresentation: options?.initialPresentation ?? "focused",
    projectId: project.projectId,
    sessionCountBefore: beforeSnapshot?.sessions.length,
    title,
    visibleSessionIdsBefore: beforeSnapshot?.visibleSessionIds,
  });
  appendPaneLayoutTraceDebugLog("createTerminal.request", {
    activeProjectId,
    groupId,
    projectId: project.projectId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(targetWorkspace),
    title,
    visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
  });
  /**
   * CDXC:SessionPersistence 2026-05-10-03:35
   * New, reloaded, restored, and previous-session terminals use the current
   * Settings provider as the source of truth. Recreate callers pass that
   * resolved provider through options so archived records cannot keep an old
   * tmux/zmx/zellij backend alive after the user switches provider or turns
   * persistence off.
   */
  const sessionPersistenceProvider =
    options?.sessionPersistenceProvider ?? activeSessionPersistenceProviderFromSettings();
  const sessionPersistenceName = sessionPersistenceProvider
    ? options?.sessionPersistenceName
    : undefined;
  const result = createSessionInSimpleWorkspace(
    targetWorkspace,
    {
      agentName,
      initialPresentation: options?.initialPresentation,
      sessionPersistenceName,
      sessionPersistenceProvider,
      terminalEngine: "ghostty-native",
      title,
    },
    options?.visiblePlacement
      ? {
          visiblePlacement:
            options.visiblePlacement.kind === "insertAfter" && options.splitDirection
              ? { ...options.visiblePlacement, splitDirection: options.splitDirection }
              : options.visiblePlacement,
        }
      : undefined,
  );
  const generatedSession = result.session?.kind === "terminal" ? result.session : undefined;
  if (!generatedSession) {
    appendTerminalLaunchDebugLog("nativeSidebar.createTerminal.noSession", {
      agentName,
      groupId,
      projectId: project.projectId,
      title,
    });
    return undefined;
  }
  const nativeSessionId = rememberNativeSessionMapping(project.projectId, generatedSession.sessionId);
  if (
    options?.splitDirection &&
    options.visiblePlacement?.kind === "insertAfter" &&
    options.visiblePlacement.targetSessionId
  ) {
    /**
     * CDXC:NativeSplits 2026-05-10-18:30
     * Split direction is a layout hint for the newly created target/new pair.
     * The sidebar still owns visibleSessionIds, while native layout uses this
     * hint to split the targeted pane sideways or downward immediately.
     */
    nativeSplitLayoutHint = {
      direction: options.splitDirection,
      nextSessionId: generatedSession.sessionId,
      projectId: project.projectId,
      targetSessionId: options.visiblePlacement.targetSessionId,
    };
  }
  const sessionStateFilePath = createNativeSessionStateFilePath(
    project.projectId,
    generatedSession.sessionId,
  );
  updateActiveProjectWorkspace(() => result.snapshot);
  const session = generatedSession;
  if (!session) {
    return undefined;
  }
  if (initialInput.trim() && agentName) {
    suppressNativeSessionActivityIndicators(session.sessionId, "agent-launch");
  }

  terminalStateById.set(session.sessionId, {
    activity: initialInput.trim() && !agentName ? "working" : "idle",
    agentName,
    agentSessionId: session.agentSessionId,
    agentSessionPath: session.agentSessionPath,
    lifecycleState: "running",
    sessionPersistenceName,
    sessionPersistenceProvider,
    sessionStateFilePath,
    terminalTitle: title,
  });
  appendTerminalLaunchDebugLog("nativeSidebar.createTerminal.created", {
    activateOnCreate: false,
    agentName,
    focusedSessionIdAfter: result.snapshot.groups.find(
      (group) => group.groupId === result.snapshot.activeGroupId,
    )?.snapshot.focusedSessionId,
    focusAfterCreate: options?.focusAfterCreate !== false,
    initialInputPreview: initialInput.trim().slice(0, 80),
    nativeSessionId,
    projectId: project.projectId,
    sessionId: session.sessionId,
    visibleSessionIdsAfter: result.snapshot.groups.find(
      (group) => group.groupId === result.snapshot.activeGroupId,
    )?.snapshot.visibleSessionIds,
  });
  appendPaneLayoutTraceDebugLog("createTerminal.created", {
    activeProjectId,
    agentName,
    nativeSessionId,
    projectId: project.projectId,
    sessionId: session.sessionId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(
      result.snapshot,
      result.snapshot.activeGroupId,
    ),
    title,
    visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
  });
  appendAgentDetectionDebugLog("nativeSidebar.terminalState.created", {
    agentName,
    initialActivity: initialInput.trim() && !agentName ? "working" : "idle",
    initialInputPreview: initialInput.trim().slice(0, 120),
    nativeSessionId,
    sessionId: session.sessionId,
    sessionStateFilePath,
    terminalTitle: title,
  });
  const nativeEnvironment = createNativeAgentSessionEnvironment({
    agentName,
    project,
    sessionId: session.sessionId,
    sessionStateFilePath,
  });
  appendTerminalLaunchDebugLog("nativeSidebar.createTerminal.colorEnv", {
    agentName,
    colorEnv: readAgentColorEnvironmentSnapshot(nativeEnvironment),
    nativeSessionId,
    projectId: project.projectId,
    sessionPersistenceName,
    sessionPersistenceProvider,
    sessionId: session.sessionId,
  });
  postNative({
    /**
     * CDXC:CrashRootCause 2026-05-04-09:19
     * Rapid agent launches must not let native createTerminal briefly activate
     * and focus a new Ghostty surface before the sidebar publishes the current
     * visible terminal set. The sidebar workspace snapshot is the source of
     * truth for visibility, and focus is sent only after that layout command.
    */
    activateOnCreate: false,
    cwd: project.path,
    env: nativeEnvironment,
    initialInput,
    sessionId: nativeSessionId,
    sessionPersistenceName,
    sessionPersistenceProvider,
    title,
    type: "createTerminal",
  });
  publish();
  appendSidebarRefreshDebugLog("nativeSidebar.createTerminal.afterPublish", {
    agentName,
    nativeSessionId,
    project: summarizeSidebarRefreshProject(),
    sessionId: session.sessionId,
    title,
  });
  if (options?.focusAfterCreate !== false) {
    postNative({ sessionId: nativeSessionId, type: "focusTerminal" });
  }
  return session;
}

function createFocusedTabGroupPlacement(groupId?: string): VisibleSessionPlacement | undefined {
  const project = activeProject();
  const targetWorkspace = groupId
    ? focusGroupInSimpleWorkspace(project.workspace, groupId).snapshot
    : project.workspace;
  const targetGroup =
    targetWorkspace.groups.find((group) => group.groupId === targetWorkspace.activeGroupId) ??
    targetWorkspace.groups[0];
  const targetSessionId = targetGroup?.snapshot.focusedSessionId;
  if (!targetGroup || !targetSessionId) {
    appendPaneLayoutTraceDebugLog("focusedTabPlacement.unresolved", {
      activeProjectId,
      groupId,
      projectId: project.projectId,
      reason: !targetGroup ? "group-missing" : "focused-session-missing",
      targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(targetWorkspace, groupId),
    });
    return undefined;
  }

  const targetSession = targetGroup.snapshot.sessions.find(
    (session) => session.sessionId === targetSessionId,
  );
  if (!targetSession || targetSession.isSleeping === true) {
    appendPaneLayoutTraceDebugLog("focusedTabPlacement.unresolved", {
      activeProjectId,
      groupId,
      projectId: project.projectId,
      reason: !targetSession ? "focused-session-record-missing" : "focused-session-sleeping",
      targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(targetWorkspace, targetGroup.groupId),
      targetSessionId,
    });
    return undefined;
  }

  /**
   * CDXC:PaneTabs 2026-05-11-11:51
   * Empty-sidebar double-click, top New Session, and project-header pane
   * buttons must add the new pane as the active tab in the currently focused
   * tab group. Require the focused session to already be surfaced so creation
   * preserves the user's split tree, tab groups, and pane ratios instead of
   * rebuilding layout from a hidden or sleeping anchor.
   */
  if (!targetGroup.snapshot.visibleSessionIds.includes(targetSessionId)) {
    appendPaneLayoutTraceDebugLog("focusedTabPlacement.unresolved", {
      activeProjectId,
      groupId,
      projectId: project.projectId,
      reason: "focused-session-not-visible",
      targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(targetWorkspace, targetGroup.groupId),
      targetSessionId,
    });
    return undefined;
  }

  appendPaneLayoutTraceDebugLog("focusedTabPlacement.resolved", {
    activeProjectId,
    groupId,
    projectId: project.projectId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(targetWorkspace, targetGroup.groupId),
    targetSessionId,
  });
  return { kind: "appendToTabGroup", targetSessionId };
}

function createNativeSessionInCurrentContext(): void {
  /**
   * CDXC:SessionCreation 2026-05-11-11:51
   * The top "New Session" action and matching hotkey create in the currently
   * live project. When the selected context is the Combined Chats group, starting
   * a session means creating a new projectless chat folder instead of adding a
   * second terminal to an existing one-session chat container. In normal projects,
   * add the terminal as a selected tab in the focused pane's existing tab group
   * so double-click creation never opens a new split group or resizes panes.
   */
  if (activeProject().isChat === true) {
    void createNativeChat();
    return;
  }

  createTerminal(DEFAULT_TERMINAL_SESSION_TITLE, "", undefined, undefined, {
    visiblePlacement: createFocusedTabGroupPlacement(),
  });
}

function openCommandsPanelForActiveProject(): void {
  rememberActiveProjectWorkspaceTerminalBeforeCommandsPanel("openCommandsPanel");
  updateActiveProjectCommandsPanel((panel) => ({
    ...panel,
    isVisible: true,
    mode: panel.mode ?? "pinned",
  }));
  const activeCommandSessionId = activeProject().commandsPanel.activeSessionId;
  if (!activeCommandSessionId) {
    createCommandTerminal("Command Terminal", "", { focusAfterCreate: true });
    return;
  }
  queueNativeLayoutFocusRequest(activeCommandSessionId, "openCommandsPanel");
  publish();
  postNative({
    sessionId: nativeSessionIdForProjectSidebarSession(activeProjectId, activeCommandSessionId),
    type: "focusTerminal",
  });
}

function toggleFocusedCommandsPanelForActiveProject(): void {
  const project = activeProject();
  const focusedSessionId = lastNativeFocusedSidebarSessionId;
  /**
   * CDXC:CommandsPanel 2026-05-14-14:37:
   * F12 is the command-panel shortcut. When keyboard focus is already inside
   * the visible command panel, pressing F12 should collapse that panel instead
   * of re-focusing the same command terminal.
   */
  if (
    project.commandsPanel.isVisible &&
    focusedSessionId &&
    commandPanelContainsSession(project, focusedSessionId)
  ) {
    hideCommandsPanelForActiveProject();
    return;
  }
  openCommandsPanelForActiveProject();
}

function hideCommandsPanelForActiveProject(): void {
  const restoreSessionId = rememberedWorkspaceTerminalForCommandsPanel(activeProject());
  updateActiveProjectCommandsPanel((panel) => ({
    ...panel,
    isVisible: false,
  }));
  if (restoreSessionId) {
    focusTerminal(restoreSessionId);
    return;
  }
  publish();
}

function toggleCommandsPanelForActiveProject(): void {
  if (activeProject().commandsPanel.isVisible) {
    hideCommandsPanelForActiveProject();
    return;
  }
  openCommandsPanelForActiveProject();
}

function setCommandsPanelModeForActiveProject(mode: CommandsPanelMode): void {
  updateActiveProjectCommandsPanel((panel) => ({
    ...panel,
    isVisible: true,
    mode,
  }));
  publish();
}

function createFullWidthTerminalPaneInCurrentProject(): void {
  /**
   * CDXC:CommandsPanel 2026-05-13-17:02
   * Legacy sidebar messages still route to the Commands panel shortcut: click
   * once to reveal/focus the project command surface,
   * click again to hide it without killing command terminals.
   */
  toggleCommandsPanelForActiveProject();
}

function splitFocusedNativePane(direction: "horizontal" | "vertical"): void {
  const targetSessionId = activeSnapshot().focusedSessionId;
  /**
   * CDXC:NativeSplits 2026-05-10-18:30
   * Split hotkeys create a new terminal and insert it next to the pane that was
   * focused before the shortcut. Direction is kept explicit for the command
   * surface even while the native layout still renders the exact visible set
   * with the current automatic split tree.
   */
  appendTerminalLaunchDebugLog("nativeSidebar.splitFocusedPane.request", {
    direction,
    targetSessionId,
    visibleSessionIdsBefore: activeSnapshot().visibleSessionIds,
  });
  createTerminal(DEFAULT_TERMINAL_SESSION_TITLE, "", undefined, undefined, {
    splitDirection: direction,
    visiblePlacement: {
      kind: "insertAfter",
      targetSessionId,
    },
  });
}

function createNativeT3Session(
  groupId?: string,
  options?: {
    visiblePlacement?: VisibleSessionPlacement;
  },
): T3SessionRecord | undefined {
  const project = activeProject();
  if (!shouldKeepProjectEditorOpenForNewSession(project.projectId)) {
    activateWorkspaceSurfaceForProject(project.projectId);
  }
  const targetWorkspace = groupId
    ? focusGroupInSimpleWorkspace(project.workspace, groupId).snapshot
    : project.workspace;
  const pendingThreadId = `pending-${Date.now().toString(36)}`;
  appendPaneLayoutTraceDebugLog("createT3.request", {
    activeProjectId,
    groupId,
    pendingThreadId,
    projectId: project.projectId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(targetWorkspace, groupId),
    visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
  });
  /**
   * CDXC:T3Code 2026-04-30-02:24
   * Native T3 Code buttons must create T3 pane records, matching the reference
   * app's special T3 path. Do not launch `npx --yes t3` in a terminal because
   * the CLI opens its own browser instead of becoming an embedded ghostex pane.
   */
  const result = createSessionInSimpleWorkspace(
    targetWorkspace,
    {
      kind: "t3",
      t3: {
        boundThreadId: pendingThreadId,
        projectId: `native-${project.projectId}`,
        serverOrigin: "http://127.0.0.1:0",
        threadId: pendingThreadId,
        workspaceRoot: project.path,
      },
      title: "T3 Code",
    },
    options?.visiblePlacement ? { visiblePlacement: options.visiblePlacement } : undefined,
  );
  const session = result.session?.kind === "t3" ? result.session : undefined;
  if (!session) {
    appendPaneLayoutTraceDebugLog("createT3.noSession", {
      activeProjectId,
      groupId,
      pendingThreadId,
      projectId: project.projectId,
      visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
    });
    return undefined;
  }

  const nativeSessionId = rememberNativeSessionMapping(project.projectId, session.sessionId);
  updateActiveProjectWorkspace(() => result.snapshot);
  appendPaneLayoutTraceDebugLog("createT3.created", {
    activeProjectId,
    nativeSessionId,
    projectId: project.projectId,
    sessionId: session.sessionId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(
      result.snapshot,
      result.snapshot.activeGroupId,
    ),
    threadId: session.t3.threadId,
    visiblePlacement: summarizeVisiblePlacement(options?.visiblePlacement),
  });
  postNative({ cwd: project.path, type: "startT3CodeRuntime" });
  postNative({
    cwd: project.path,
    projectId: session.t3.projectId,
    sessionId: nativeSessionId,
    threadId: session.t3.threadId,
    title: "T3 Code",
    type: "createWebPane",
    url: "http://127.0.0.1:3774",
  });
  postNative({ sessionId: nativeSessionId, type: "focusWebPane" });
  publish();
  return session;
}

function restoreNativeT3Session(
  project: NativeProject,
  session: T3SessionRecord,
  reason: string,
  options: { focusAfterRestore?: boolean } = {},
): void {
  /**
   * CDXC:T3Code 2026-04-30-09:33
   * Persisted native T3 cards outlive their WKWebView surfaces across app
   * restarts. Focusing a restored T3 card must recreate the embedded web pane
   * and managed runtime instead of only sending focus to a missing native id.
   */
  const nativeSessionId = rememberNativeSessionMapping(project.projectId, session.sessionId);
  const workspaceRoot = session.t3?.workspaceRoot ?? project.path;
  const serverOrigin =
    session.t3?.serverOrigin?.startsWith("http") && !session.t3.serverOrigin.endsWith(":0")
      ? session.t3.serverOrigin
      : "http://127.0.0.1:3774";
  postNative({ cwd: workspaceRoot, type: "startT3CodeRuntime" });
  postNative({
    cwd: workspaceRoot,
    projectId: session.t3.projectId,
    sessionId: nativeSessionId,
    threadId: session.t3.threadId,
    title: session.title || "T3 Code",
    type: "createWebPane",
    url: serverOrigin,
  });
  if (options.focusAfterRestore !== false) {
    postNative({ sessionId: nativeSessionId, type: "focusWebPane" });
  }
  appendAgentDetectionDebugLog("nativeSidebar.t3Session.restored", {
    nativeSessionId,
    reason,
    sessionId: session.sessionId,
    workspaceRoot,
  });
}

function findNativeT3SessionBoundToThread(
  project: NativeProject,
  threadId: string,
  options: { excludeSessionId?: string } = {},
): T3SessionRecord | undefined {
  activateWorkspaceSurfaceForProject(project.projectId);
  /**
   * CDXC:T3Code 2026-05-04-03:06
   * Native T3 sidebar cards are durable bindings to one T3 thread. When the
   * embedded T3 UI navigates to a different thread, ghostex must first look for an
   * existing card bound to that thread instead of replacing the current card's
   * stored thread metadata.
   */
  const normalizedThreadId = normalizeNativeT3ThreadId(threadId);
  if (!normalizedThreadId) {
    return undefined;
  }

  for (const group of project.workspace.groups) {
    for (const session of group.snapshot.sessions) {
      if (session.kind !== "t3" || session.sessionId === options.excludeSessionId) {
        continue;
      }
      const sessionThreadId = normalizeNativeT3ThreadId(
        session.t3.boundThreadId || session.t3.threadId,
      );
      if (sessionThreadId === normalizedThreadId) {
        return session;
      }
    }
  }

  return undefined;
}

function createNativeT3SessionForBoundThread(
  project: NativeProject,
  sourceSession: T3SessionRecord,
  threadId: string,
  title?: string,
): T3SessionRecord | undefined {
  /**
   * CDXC:T3Code 2026-05-04-03:06
   * Opening a different T3 thread from inside an embedded pane should create a
   * sibling T3 pane/card linked to the new thread. This preserves the original
   * sidebar card as a stable shortcut to its bound thread while keeping multiple
   * T3 threads visible in ghostex at the same time.
   */
  const groupId = project.workspace.groups.find((group) =>
    group.snapshot.sessions.some((session) => session.sessionId === sourceSession.sessionId),
  )?.groupId;
  const targetWorkspace = groupId
    ? focusGroupInSimpleWorkspace(project.workspace, groupId).snapshot
    : project.workspace;
  const resolvedTitle = normalizeNativeT3ThreadTitle(title) ?? "T3 Code";
  const result = createSessionInSimpleWorkspace(targetWorkspace, {
    kind: "t3",
    t3: {
      ...sourceSession.t3,
      boundThreadId: threadId,
      threadId,
    },
    title: resolvedTitle,
  });
  const session = result.session?.kind === "t3" ? result.session : undefined;
  if (!session) {
    return undefined;
  }

  const nativeSessionId = rememberNativeSessionMapping(project.projectId, session.sessionId);
  updateProjectWorkspace(project.projectId, () => result.snapshot);
  postNative({ cwd: session.t3.workspaceRoot || project.path, type: "startT3CodeRuntime" });
  postNative({
    cwd: session.t3.workspaceRoot || project.path,
    projectId: session.t3.projectId,
    sessionId: nativeSessionId,
    threadId: session.t3.threadId,
    title: resolvedTitle,
    type: "createWebPane",
    url: session.t3.serverOrigin || NATIVE_T3_REMOTE_ACCESS_ORIGIN,
  });
  postNative({ sessionId: nativeSessionId, type: "focusWebPane" });
  return session;
}

function normalizeNativeT3ThreadId(threadId: string | undefined): string | undefined {
  const normalized = threadId?.trim();
  if (!normalized || normalized.startsWith("pending-")) {
    return undefined;
  }
  return normalized.toLowerCase();
}

function normalizeNativeT3ThreadTitle(title: string | undefined): string | undefined {
  const normalized = title?.replace(/\s+/g, " ").trim();
  const lower = normalized?.toLowerCase();
  if (
    !normalized ||
    lower === "t3 code" ||
    lower === "t3 code (alpha)" ||
    lower === "no active thread" ||
    lower === "pick a thread to continue"
  ) {
    return undefined;
  }
  return normalized;
}

function persistNativeT3SessionTitle(
  projectId: string,
  sessionId: string,
  title: string | undefined,
): boolean {
  const normalizedTitle = normalizeNativeT3ThreadTitle(title);
  if (!normalizedTitle) {
    return false;
  }

  updateProjectWorkspace(
    projectId,
    (workspace) =>
      setSessionTitleInSimpleWorkspace(workspace, sessionId, normalizedTitle, {
        titleSource: "generated",
      }).snapshot,
  );
  return true;
}

async function resolveNativeT3ThreadTitle(
  threadId: string,
  fallbackTitle?: string,
): Promise<string | undefined> {
  const normalizedFallback = normalizeNativeT3ThreadTitle(fallbackTitle);
  if (normalizedFallback) {
    return normalizedFallback;
  }

  try {
    return await fetchNativeT3ThreadTitle(threadId);
  } catch (error) {
    appendAgentDetectionDebugLog("nativeSidebar.t3ThreadTitle.fetch.failed", {
      error: error instanceof Error ? error.message : String(error),
      threadId,
    });
    return undefined;
  }
}

function findNativeT3ProjectSession(projectId: string, sessionId: string): T3SessionRecord | undefined {
  const project = findProject(projectId);
  const session = project ? findSessionRecordInProject(project, sessionId) : undefined;
  return session?.kind === "t3" ? session : undefined;
}

async function syncNativeT3ProjectSessionTitleFromRuntime(
  projectId: string,
  sessionId: string,
  threadId: string,
  fallbackTitle?: string,
): Promise<boolean> {
  const title = await resolveNativeT3ThreadTitle(threadId, fallbackTitle);
  if (!persistNativeT3SessionTitle(projectId, sessionId, title)) {
    return false;
  }
  publish();
  return true;
}

function scheduleNativeT3SessionTitleSync(
  projectId: string,
  sessionId: string,
  threadId: string,
  fallbackTitle?: string,
): void {
  /**
   * CDXC:T3Code 2026-05-04-04:41
   * Binding a newly opened T3 thread and naming its ghostex sidebar card are
   * separate concerns. If T3 has not projected the thread title yet, retry the
   * snapshot lookup for the bound session without changing its thread binding.
   */
  const fallback = normalizeNativeT3ThreadTitle(fallbackTitle);
  void (async () => {
    for (const delayMs of NATIVE_T3_TITLE_SYNC_RETRY_DELAYS_MS) {
      await delay(delayMs);
      const session = findNativeT3ProjectSession(projectId, sessionId);
      if (!session) {
        return;
      }
      const boundThreadId = normalizeNativeT3ThreadId(session.t3.boundThreadId || session.t3.threadId);
      if (boundThreadId !== normalizeNativeT3ThreadId(threadId)) {
        return;
      }
      const synced = await syncNativeT3ProjectSessionTitleFromRuntime(
        projectId,
        sessionId,
        threadId,
        fallback,
      );
      if (synced) {
        return;
      }
    }
  })().catch((error) => {
    appendAgentDetectionDebugLog("nativeSidebar.t3ThreadTitle.retry.failed", {
      error: error instanceof Error ? error.message : String(error),
      projectId,
      sessionId,
      threadId,
    });
  });
}

async function fetchNativeT3ThreadTitle(threadId: string): Promise<string | undefined> {
  const normalizedThreadId = normalizeNativeT3ThreadId(threadId);
  if (!normalizedThreadId) {
    return undefined;
  }

  const ownerBearerToken = await waitForNativeT3OwnerBearerToken();
  const result = await runNativeProcess(
    "/bin/sh",
    [
      "-lc",
      [
        "/usr/bin/curl",
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "5",
        "-H",
        '"authorization: Bearer $T3_OWNER_BEARER"',
        '"$T3_ORIGIN/api/orchestration/snapshot"',
      ].join(" "),
    ],
    {
      env: {
        T3_ORIGIN: NATIVE_T3_REMOTE_ACCESS_ORIGIN,
        T3_OWNER_BEARER: ownerBearerToken,
      },
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "T3 snapshot request failed.");
  }

  const snapshot = JSON.parse(result.stdout) as {
    threads?: Array<{ deletedAt?: unknown; id?: unknown; title?: unknown }>;
  };
  const thread = snapshot.threads?.find((candidate) => {
    if (typeof candidate.id !== "string" || candidate.deletedAt != null) {
      return false;
    }
    return normalizeNativeT3ThreadId(candidate.id) === normalizedThreadId;
  });
  return typeof thread?.title === "string" ? normalizeNativeT3ThreadTitle(thread.title) : undefined;
}

function handleNativeT3ThreadReady(
  sidebarSessionId: string,
  hostEvent: Extract<NativeHostEvent, { type: "t3ThreadReady" }>,
): void {
  const reference = resolveSidebarSessionReference(sidebarSessionId);
  updateProjectWorkspace(
    reference.project.projectId,
    (workspace) =>
      setT3SessionMetadataInSimpleWorkspace(workspace, reference.sessionId, {
        boundThreadId: hostEvent.threadId,
        projectId: hostEvent.projectId,
        serverOrigin: hostEvent.serverOrigin,
        threadId: hostEvent.threadId,
        workspaceRoot: hostEvent.workspaceRoot,
      }).snapshot,
  );
  publish();
  void syncNativeT3SessionTitleFromRuntime(sidebarSessionId, hostEvent.threadId);
}

async function syncNativeT3SessionTitleFromRuntime(
  sidebarSessionId: string,
  threadId: string,
  fallbackTitle?: string,
): Promise<void> {
  const reference = resolveSidebarSessionReference(sidebarSessionId);
  const synced = await syncNativeT3ProjectSessionTitleFromRuntime(
    reference.project.projectId,
    reference.sessionId,
    threadId,
    fallbackTitle,
  );
  if (!synced) {
    scheduleNativeT3SessionTitleSync(
      reference.project.projectId,
      reference.sessionId,
      threadId,
      fallbackTitle,
    );
  }
}

async function relinkNativeT3SessionThread(
  sidebarSessionId: string,
  threadId: string,
): Promise<void> {
  const normalizedThreadId = normalizeNativeT3ThreadId(threadId);
  if (!normalizedThreadId) {
    return;
  }

  const reference = resolveSidebarSessionReference(sidebarSessionId);
  const session = findSessionRecordInProject(reference.project, reference.sessionId);
  if (session?.kind !== "t3") {
    return;
  }

  const title = await resolveNativeT3ThreadTitle(threadId);
  updateProjectWorkspace(
    reference.project.projectId,
    (workspace) =>
      setT3SessionMetadataInSimpleWorkspace(workspace, reference.sessionId, {
        ...session.t3,
        boundThreadId: threadId.trim(),
        threadId: threadId.trim(),
      }).snapshot,
  );
  persistNativeT3SessionTitle(reference.project.projectId, reference.sessionId, title);
  const refreshedProject = findProject(reference.project.projectId) ?? reference.project;
  const refreshedSession = findSessionRecordInProject(refreshedProject, reference.sessionId);
  if (refreshedSession?.kind === "t3") {
    restoreNativeT3Session(refreshedProject, refreshedSession, "manual-thread-link");
  }
  publish();
}

async function handleNativeT3ThreadChanged(
  sidebarSessionId: string,
  threadId: string,
  title?: string,
): Promise<void> {
  /**
   * CDXC:T3Code 2026-05-04-03:06
   * T3's in-app navigation changes the web route inside one WKWebView. ghostex keeps
   * card identity stable by focusing/creating the card for the navigated thread,
   * then re-routing the source WKWebView back to its bound thread without taking
   * focus back from the user's selected target thread.
   */
  const normalizedThreadId = normalizeNativeT3ThreadId(threadId);
  if (!normalizedThreadId || nativeT3ThreadChangeInFlightBySessionId.has(sidebarSessionId)) {
    return;
  }

  const reference = resolveSidebarSessionReference(sidebarSessionId);
  const session = findSessionRecordInProject(reference.project, reference.sessionId);
  if (session?.kind !== "t3") {
    return;
  }

  const currentBoundThreadId = session.t3.boundThreadId || session.t3.threadId;
  if (normalizeNativeT3ThreadId(currentBoundThreadId) === normalizedThreadId) {
    await syncNativeT3SessionTitleFromRuntime(sidebarSessionId, threadId, title);
    return;
  }

  nativeT3ThreadChangeInFlightBySessionId.add(sidebarSessionId);
  try {
    const resolvedTitle = await resolveNativeT3ThreadTitle(threadId, title);
    let targetSession = findNativeT3SessionBoundToThread(reference.project, threadId, {
      excludeSessionId: reference.sessionId,
    });

    appendAgentDetectionDebugLog("nativeSidebar.t3ThreadChanged.bindingPreservationStart", {
      currentSessionId: reference.sessionId,
      currentThreadId: currentBoundThreadId,
      nextThreadId: threadId,
      reusedSessionId: targetSession?.sessionId,
      title: resolvedTitle,
    });

    if (targetSession) {
      if (
        !persistNativeT3SessionTitle(reference.project.projectId, targetSession.sessionId, resolvedTitle)
      ) {
        scheduleNativeT3SessionTitleSync(
          reference.project.projectId,
          targetSession.sessionId,
          threadId,
          title,
        );
      }
    } else {
      targetSession = createNativeT3SessionForBoundThread(
        reference.project,
        session,
        threadId.trim(),
        resolvedTitle,
      );
      if (targetSession && !normalizeNativeT3ThreadTitle(resolvedTitle)) {
        scheduleNativeT3SessionTitleSync(
          reference.project.projectId,
          targetSession.sessionId,
          threadId,
          title,
        );
      }
    }

    const refreshedSource = findSessionRecordInProject(reference.project, reference.sessionId);
    if (refreshedSource?.kind === "t3") {
      restoreNativeT3Session(reference.project, refreshedSource, "thread-switch-restored-binding", {
        focusAfterRestore: false,
      });
    }

    if (targetSession) {
      if (activeProjectId !== reference.project.projectId) {
        focusProject(reference.project.projectId);
      }
      focusTerminal(targetSession.sessionId);
    } else {
      publish();
    }
  } finally {
    nativeT3ThreadChangeInFlightBySessionId.delete(sidebarSessionId);
  }
}

function restoreNativeBrowserSession(
  project: NativeProject,
  session: BrowserSessionRecord,
  reason: string,
): void {
  /**
   * CDXC:BrowserPanes 2026-05-02-06:35
   * Persisted browser-pane cards restore through the same native web-pane host
   * as newly opened browser actions. This keeps app restarts from turning
   * browser session cards into inert sidebar entries.
   */
  const nativeSessionId = rememberNativeSessionMapping(project.projectId, session.sessionId);
  postNative({
    cwd: project.path,
    sessionId: nativeSessionId,
    title: session.title || browserPaneTitleFromUrl(session.browser.url),
    type: "createWebPane",
    url: session.browser.url,
  });
  postNative({ sessionId: nativeSessionId, type: "focusWebPane" });
  appendAgentDetectionDebugLog("nativeSidebar.browserSession.restored", {
    nativeSessionId,
    reason,
    sessionId: session.sessionId,
    url: session.browser.url,
  });
}

function syncSessionTitleFromNativeTerminalTitle(
  sessionId: string,
  rawTitle: string,
  previousTerminalTitle: string | undefined,
): boolean {
  const terminalState = terminalStateById.get(sessionId);
  const session = findSessionRecord(sessionId);
  const visibleTitle = getVisibleTerminalTitle(rawTitle);
  const didCaptureCodexSessionId =
    terminalState && session?.kind === "terminal"
      ? syncNativeCodexSessionIdFromTerminalTitle(sessionId, rawTitle, terminalState, session)
      : false;
  if (!terminalState || !session || !visibleTitle) {
    appendSessionTitleDebugLog("nativeSidebar.sessionRenameSkipped", {
      agentName: terminalState?.agentName,
      hasSessionRecord: Boolean(session),
      hasTerminalState: Boolean(terminalState),
      rawTitle,
      reason: !terminalState
        ? "terminal-state-missing"
        : !session
          ? "session-record-not-found"
          : "terminal-title-not-visible",
      sessionId,
      visibleTitle,
    });
    return didCaptureCodexSessionId;
  }
  if (isEllipsizedNativeTerminalWindowTitle(visibleTitle)) {
    /**
     * CDXC:NativeTerminals 2026-04-30-03:41
     * Agent/window titles that already include trailing ellipses are display
     * artifacts, not canonical session names. Do not sync them into the
     * workspace record, because native pane title bars now read that record.
     */
    appendSessionTitleDebugLog("nativeSidebar.sessionRenameSkipped", {
      agentName: terminalState.agentName,
      currentSessionTitle: session.title,
      previousTerminalTitle,
      rawTitle,
      reason: "terminal-title-already-ellipsized",
      sessionId,
      visibleTitle,
    });
    return didCaptureCodexSessionId;
  }
  if (
    session.kind === "terminal" &&
    terminalState.protectStoredTitleFromAutomation === true &&
    getNativeStoredTrustedResumeTitle(session).title !== undefined
  ) {
    /**
     * CDXC:SessionTitleSync 2026-05-07-16:41
     * Restored trusted titles are already persisted session names. Native
     * terminal-title events can still reflect Codex's automatic thread retitles
     * after a new prompt, so they must not replace the stored card title.
     */
    appendSessionTitleDebugLog("nativeSidebar.sessionRenameSkipped", {
      agentName: terminalState.agentName,
      currentSessionTitle: session.title,
      previousTerminalTitle,
      rawTitle,
      reason: "protected-stored-title",
      sessionId,
      visibleTitle,
    });
    return didCaptureCodexSessionId;
  }
  const decision = getNativeTerminalTitleSessionSyncDecision({
    agentName: terminalState.agentName,
    previousTerminalTitle,
    session,
    sessionPersistenceProvider: terminalState.sessionPersistenceProvider,
    visibleTitle,
  });
  if (!decision.shouldSync) {
    appendSessionTitleDebugLog("nativeSidebar.sessionRenameSkipped", {
      agentName: terminalState.agentName,
      currentSessionTitle: session.title,
      previousTerminalTitle,
      rawTitle,
      reason: decision.reason,
      sessionId,
      visibleTitle,
    });
    return didCaptureCodexSessionId;
  }

  if (session.kind === "terminal" && session.surface === "commands") {
    updateActiveProjectCommandsPanel((panel) => ({
      ...panel,
      sessions: panel.sessions.map((candidate) =>
        candidate.sessionId === sessionId
          ? { ...candidate, title: visibleTitle, titleSource: "terminal-auto" }
          : candidate,
      ),
    }));
  } else {
    updateActiveProjectWorkspace(
      (workspace) =>
        setSessionTitleInSimpleWorkspace(workspace, sessionId, visibleTitle, {
          titleSource: "terminal-auto",
        }).snapshot,
    );
  }
  appendSessionTitleDebugLog("nativeSidebar.sessionRenameApplied", {
    agentName: terminalState.agentName,
    previousSessionTitle: session.title,
    previousTerminalTitle,
    reason: decision.reason,
    sessionId,
    visibleTitle,
  });
  return true;
}

function syncNativeCodexSessionIdFromTerminalTitle(
  sessionId: string,
  rawTitle: string,
  terminalState: NonNullable<ReturnType<typeof terminalStateById.get>>,
  session: TerminalSessionRecord,
): boolean {
  const codexSessionId = getCodexSessionIdFromTitle(rawTitle);
  if (!codexSessionId || resolveNativeResumeAgentId(terminalState.agentName ?? session.agentName) !== "codex") {
    return false;
  }

  if (terminalState.agentSessionId === codexSessionId && session.agentSessionId === codexSessionId) {
    return false;
  }

  /**
   * CDXC:CodexAgent 2026-05-11-07:35
   * Codex CLI can surface the conversation UUID as a terminal title. Persist it
   * as the agent session identity for restore, while shared title filtering
   * keeps it from replacing the human sidebar title.
   */
  terminalState.agentSessionId = codexSessionId;
  setTerminalSessionAgentSessionMetadata(sessionId, {
    agentSessionId: codexSessionId,
    agentSessionPath: terminalState.agentSessionPath ?? session.agentSessionPath,
  });
  appendSessionTitleDebugLog("nativeSidebar.codexSessionIdCaptured", {
    rawTitle,
    sessionId,
    codexSessionId,
  });
  return true;
}

function isEllipsizedNativeTerminalWindowTitle(title: string): boolean {
  return /\u2026$|\.{3}$/.test(title.trim());
}

function getNativeTerminalTitleSessionSyncDecision(args: {
  agentName?: string;
  previousTerminalTitle?: string;
  session: SessionRecord;
  sessionPersistenceProvider?: ghostexSettings["sessionPersistenceProvider"];
  visibleTitle: string;
}): { reason: string; shouldSync: boolean } {
  if (args.session.kind !== "terminal") {
    return { reason: "non-terminal-session", shouldSync: false };
  }

  const currentTitle = args.session.title.trim();
  if (currentTitle === args.visibleTitle) {
    return { reason: "already-synced", shouldSync: false };
  }

  const previousVisibleTitle = getVisibleTerminalTitle(args.previousTerminalTitle);
  /**
   * CDXC:SessionTitleSync 2026-04-27-17:45
   * Terminal-title events are auto-captured unless they came through explicit
   * ghostex UI rename or first-prompt generation paths. Valid agent terminal titles
   * may still replace user/generated titles so in-agent `/rename` remains useful,
   * while command names, paths, placeholders, and mojibake stay blocked.
   */
  if (isValidNativeAgentTerminalTitle(args.visibleTitle, args.agentName)) {
    return {
      reason: `valid-agent-terminal-title-from-${args.session.titleSource ?? "unknown"}`,
      shouldSync: true,
    };
  }

  if (
    args.sessionPersistenceProvider !== undefined &&
    args.sessionPersistenceProvider !== "off" &&
    !isRejectedNativeResumeTitle(args.visibleTitle)
  ) {
    /**
     * CDXC:SessionPersistence 2026-05-05-07:28
     * Persistence providers ask sidebar cards to follow the terminal title
     * reported through the attached pane. Trust visible, non-command titles even
     * for plain terminal sessions so the card maps to the provider pane identity.
     */
    return {
      reason: `${args.sessionPersistenceProvider}-terminal-title-from-${args.session.titleSource ?? "unknown"}`,
      shouldSync: true,
    };
  }

  return {
    reason:
      previousVisibleTitle !== undefined && currentTitle === previousVisibleTitle
        ? "previous-terminal-title-not-trusted"
        : "terminal-title-not-trusted",
    shouldSync: false,
  };
}

function isValidNativeAgentTerminalTitle(title: string, agentName: string | undefined): boolean {
  return (
    resolveNativeResumeAgentId(agentName) !== undefined &&
    title.trim().length > 1 &&
    /[\p{L}\p{N}]/u.test(title) &&
    getVisibleTerminalTitle(title) !== undefined &&
    !isRejectedNativeResumeTitle(title)
  );
}

type NativePersistedSessionState = {
  agentName?: string;
  agentSessionId?: string;
  agentSessionPath?: string;
  commandExitCode?: number;
  commandRunId?: string;
  firstUserMessage?: string;
  hasAutoTitleFromFirstPrompt?: boolean;
  lastActivityAt?: string;
  pendingFirstPromptAutoRenamePrompt?: string;
  status?: "idle" | "working";
  title?: string;
};

async function pollNativeFirstPromptAutoRenameSessions(): Promise<void> {
  for (const [sessionId, terminalState] of terminalStateById.entries()) {
    if (
      terminalState.lifecycleState !== "running" ||
      terminalState.firstPromptAutoRenameInProgress
    ) {
      continue;
    }
    await processNativeFirstPromptAutoRename(sessionId, terminalState);
  }
}

async function processNativeFirstPromptAutoRename(
  sessionId: string,
  terminalState: NonNullable<ReturnType<typeof terminalStateById.get>>,
): Promise<void> {
  const session = findSessionRecord(sessionId);
  if (session?.kind !== "terminal" || !terminalState.sessionStateFilePath) {
    logNativeFirstPromptAutoRenameSkipOnce(
      sessionId,
      terminalState,
      "missing-terminal-session-state",
      {
        hasSessionRecord: Boolean(session),
        sessionStateFilePath: terminalState.sessionStateFilePath,
      },
    );
    return;
  }

  const persistedState = await readNativePersistedSessionState(terminalState.sessionStateFilePath);
  const didUpdateCommandPaneActivity = syncNativePersistedCommandPaneActivity(
    sessionId,
    terminalState,
    session,
    persistedState,
  );
  const didUpdateAgentSessionState = syncNativePersistedAgentSessionState(
    sessionId,
    terminalState,
    persistedState,
  );
  const didUpdateFirstUserMessage =
    persistedState.firstUserMessage !== undefined &&
    terminalState.firstUserMessage !== persistedState.firstUserMessage;
  if (didUpdateFirstUserMessage) {
    terminalState.firstUserMessage = persistedState.firstUserMessage;
    publish();
  }
  const didUpdateLastActivity =
    persistedState.lastActivityAt !== undefined &&
    terminalState.lastActivityAt !== persistedState.lastActivityAt &&
    isNativeTimestampNewer(persistedState.lastActivityAt, terminalState.lastActivityAt);
  if (didUpdateLastActivity && persistedState.lastActivityAt) {
    /**
     * CDXC:NativeSidebar 2026-04-28-05:14
     * Native terminal hooks write the same lastActivityAt state used by the
     * reference extension. Promote it into live sidebar state so hover
     * timestamps and last-active ordering advance after user prompts.
     *
     * CDXC:SessionLastActive 2026-05-15-14:10
     * Semantic activity transitions can stamp Last Active before the hook file
     * is flushed. Only accept newer persisted values so an older prompt-only
     * hook timestamp cannot move the card backwards after work starts or
     * finishes.
     */
    terminalState.lastActivityAt = persistedState.lastActivityAt;
    publish();
  }
  if (didUpdateCommandPaneActivity || didUpdateAgentSessionState) {
    publish();
  }
  const pendingPrompt = persistedState.pendingFirstPromptAutoRenamePrompt?.trim();
  const agentName = persistedState.agentName || terminalState.agentName;
  const currentTitle = getCurrentTitleForFirstPromptAutoRename({
    agentName,
    pendingPrompt,
    persistedTitle: persistedState.title,
    protectStoredTitleFromAutomation: terminalState.protectStoredTitleFromAutomation,
    sessionTitle: session.title,
    terminalTitle: terminalState.terminalTitle,
  });
  const decision = explainFirstPromptAutoRenameDecision({
    agentName,
    /**
     * CDXC:SessionTitleSync 2026-04-28-03:49
     * Native first-prompt auto-title may only name still-untitled sessions.
     * Hooks can fire after resume or mid-conversation, so meaningful persisted,
     * terminal-auto, generated, and user titles must block generation instead
     * of being overwritten by a later prompt sample.
     */
    currentTitle,
    hasAutoTitleFromFirstPrompt: persistedState.hasAutoTitleFromFirstPrompt,
    pendingFirstPromptAutoRenamePrompt:
      terminalState.firstPromptAutoRenameProcessedPrompt === pendingPrompt
        ? pendingPrompt
        : undefined,
    prompt: pendingPrompt,
  });
  if (!decision.shouldAutoName || !pendingPrompt) {
    const shouldClearStalePendingPrompt =
      Boolean(pendingPrompt) &&
      (decision.reason === "nonGenericCurrentTitle" || decision.reason === "alreadyAutoNamed");
    if (shouldClearStalePendingPrompt && pendingPrompt && terminalState.sessionStateFilePath) {
      await clearNativeFirstPromptAutoRenamePendingPrompt(
        terminalState.sessionStateFilePath,
        pendingPrompt,
      );
      terminalState.firstPromptAutoRenameProcessedPrompt = pendingPrompt;
    }
    logNativeFirstPromptAutoRenameSkipOnce(sessionId, terminalState, decision.reason, {
      agentName,
      currentTitle,
      hasAutoTitleFromFirstPrompt: persistedState.hasAutoTitleFromFirstPrompt,
      hasPendingPrompt: Boolean(pendingPrompt),
      pendingPromptCleared: shouldClearStalePendingPrompt,
      sessionStateFilePath: terminalState.sessionStateFilePath,
      strategy: decision.strategy,
    });
    return;
  }

  const strategy = resolveFirstPromptAutoRenameStrategy(agentName);
  if (!strategy) {
    logNativeFirstPromptAutoRenameSkipOnce(sessionId, terminalState, "unsupportedAgent", {
      agentName,
      sessionStateFilePath: terminalState.sessionStateFilePath,
    });
    return;
  }

  terminalState.firstPromptAutoRenameInProgress = true;
  terminalState.firstPromptAutoRenameLastLogKey = undefined;
  publish();
  appendSessionTitleDebugLog("nativeSidebar.firstPromptAutoRename.started", {
    agentName,
    promptPreview: getNativePromptPreview(pendingPrompt),
    sessionId,
    strategy,
  });
  try {
    const title =
      strategy === "sendBareRenameCommand"
        ? undefined
        : await generateNativeSessionTitleFromPrompt(activeProject().path, pendingPrompt);
    await sendNativeFirstPromptRenameCommand(sessionId, strategy, title);
    terminalState.firstPromptAutoRenameProcessedPrompt = pendingPrompt;
    if (title) {
      updateActiveProjectWorkspace(
        (workspace) =>
          setSessionTitleInSimpleWorkspace(workspace, sessionId, title, {
            titleSource: "generated",
          }).snapshot,
      );
    }
    appendSessionTitleDebugLog("nativeSidebar.firstPromptAutoRename.applied", {
      agentName,
      promptPreview: getNativePromptPreview(pendingPrompt),
      sessionId,
      strategy,
      title,
    });
    publish();
  } catch (error) {
    await clearNativeFirstPromptAutoRenamePendingPrompt(
      terminalState.sessionStateFilePath,
      pendingPrompt,
    );
    terminalState.firstPromptAutoRenameProcessedPrompt = pendingPrompt;
    appendSessionTitleGenerationErrorLog("nativeSidebar.firstPromptAutoRename.failed", {
      agentName,
      error: error instanceof Error ? error.message : String(error),
      pendingPromptCleared: true,
      sessionId,
      strategy,
    });
  } finally {
    terminalState.firstPromptAutoRenameInProgress = false;
    publish();
  }
}

async function readNativePersistedSessionState(
  sessionStateFilePath: string,
): Promise<NativePersistedSessionState> {
  const result = await runNativeProcess("/bin/cat", [sessionStateFilePath]);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return {};
  }
  return parseNativePersistedSessionState(result.stdout);
}

function syncNativePersistedCommandPaneActivity(
  sessionId: string,
  terminalState: NonNullable<ReturnType<typeof terminalStateById.get>>,
  session: TerminalSessionRecord,
  persistedState: NativePersistedSessionState,
): boolean {
  if (session.surface !== "commands" || persistedState.status === undefined) {
    return false;
  }

  const commandId = sidebarCommandCommandIdBySessionId.get(sessionId);
  const storedSession = commandId ? sidebarCommandSessionByCommandId.get(commandId) : undefined;
  if (
    storedSession?.runId &&
    persistedState.commandRunId !== undefined &&
    persistedState.commandRunId !== storedSession.runId
  ) {
    return false;
  }
  if (storedSession?.runId && persistedState.commandRunId === undefined) {
    return false;
  }

  let didChange = false;
  const nextActivity = persistedState.status === "working" ? "working" : "idle";
  if (terminalState.activity !== nextActivity) {
    terminalState.activity = nextActivity;
    didChange = true;
  }

  if (persistedState.status !== "idle" || !persistedState.commandRunId) {
    return didChange;
  }

  if (!commandId || !storedSession || storedSession.runId !== persistedState.commandRunId) {
    return didChange;
  }
  if (storedSession.closeOnExit) {
    return didChange;
  }

  const didFail = (persistedState.commandExitCode ?? 0) !== 0;
  postNativeSidebarCommandRunState(commandId, storedSession.runId, didFail ? "error" : "success");
  if (didFail || storedSession.playCompletionSound) {
    playNativeSidebarActionCompletionSound(sessionId);
  }
  sidebarCommandSessionByCommandId.set(commandId, {
    ...storedSession,
    runId: undefined,
  });
  return true;
}

function syncNativePersistedAgentSessionState(
  sessionId: string,
  terminalState: NonNullable<ReturnType<typeof terminalStateById.get>>,
  persistedState: NativePersistedSessionState,
): boolean {
  const nextAgentName = persistedState.agentName?.trim() || undefined;
  const nextAgentSessionId = persistedState.agentSessionId?.trim() || undefined;
  const nextAgentSessionPath = persistedState.agentSessionPath?.trim() || undefined;
  let didChange = false;

  if (nextAgentName && terminalState.agentName !== nextAgentName) {
    terminalState.agentName = nextAgentName;
    setTerminalSessionAgentName(sessionId, nextAgentName);
    didChange = true;
  }

  if (
    (nextAgentSessionId !== undefined || nextAgentSessionPath !== undefined) &&
    (terminalState.agentSessionId !== nextAgentSessionId ||
      terminalState.agentSessionPath !== nextAgentSessionPath)
  ) {
    terminalState.agentSessionId = nextAgentSessionId;
    terminalState.agentSessionPath = nextAgentSessionPath;
    setTerminalSessionAgentSessionMetadata(sessionId, {
      agentSessionId: nextAgentSessionId,
      agentSessionPath: nextAgentSessionPath,
    });
    didChange = true;
  }

  return didChange;
}

async function clearNativeFirstPromptAutoRenamePendingPrompt(
  sessionStateFilePath: string,
  failedPrompt: string,
): Promise<void> {
  /**
   * CDXC:SessionTitleSync 2026-04-26-20:27
   * A failed first-prompt title generation must not leave the same pending
   * prompt in the state file. Otherwise the poller restarts every few seconds
   * and the sidebar repeatedly flashes the "generating title" state.
   */
  const command = [
    `/usr/bin/python3 - ${quoteNativeShellArg(sessionStateFilePath)} ${quoteNativeShellArg(failedPrompt)} <<'GHOSTEX_CLEAR_PENDING_PROMPT'`,
    getClearNativeFirstPromptPendingPromptScript(),
    "GHOSTEX_CLEAR_PENDING_PROMPT",
  ].join("\n");
  const result = await runNativeProcess("/bin/zsh", ["-lc", command]);
  if (result.exitCode !== 0) {
    appendSessionTitleDebugLog("nativeSidebar.firstPromptAutoRename.clearPendingFailed", {
      error: result.stderr.trim() || result.stdout.trim() || "clear pending prompt failed",
      sessionStateFilePath,
    });
  }
}

function getClearNativeFirstPromptPendingPromptScript(): string {
  return `import pathlib
import sys

state_path = pathlib.Path(sys.argv[1])
failed_prompt = " ".join(sys.argv[2].split())
try:
    lines = state_path.read_text(encoding="utf-8").splitlines()
except FileNotFoundError:
    sys.exit(0)

state = {}
for line in lines:
    key, separator, value = line.partition("=")
    if separator:
        state[key] = value

if " ".join(state.get("pendingFirstPromptAutoRenamePrompt", "").split()) != failed_prompt:
    sys.exit(0)

state["pendingFirstPromptAutoRenamePrompt"] = ""
keys = [
    "status",
    "agent",
    "agentSessionId",
    "agentSessionPath",
    "firstUserMessageBase64",
    "frozenAt",
    "autoTitleFromFirstPrompt",
    "historyBase64",
    "lastActivityAt",
    "pendingFirstPromptAutoRenamePrompt",
    "title",
]
state_path.parent.mkdir(parents=True, exist_ok=True)
temp_path = state_path.with_suffix(state_path.suffix + ".tmp")
temp_path.write_text("".join(f"{key}={state.get(key, '')}\\n" for key in keys), encoding="utf-8")
temp_path.replace(state_path)
`;
}

function getStampNativeSessionSemanticActivityScript(): string {
  return `import pathlib
import sys
from datetime import datetime

state_path = pathlib.Path(sys.argv[1])
timestamp = sys.argv[2]
activity = sys.argv[3]

keys = [
    "status",
    "agent",
    "agentSessionId",
    "agentSessionPath",
    "firstUserMessageBase64",
    "frozenAt",
    "autoTitleFromFirstPrompt",
    "historyBase64",
    "lastActivityAt",
    "pendingFirstPromptAutoRenamePrompt",
    "title",
]

state = {}
try:
    lines = state_path.read_text(encoding="utf-8").splitlines()
except FileNotFoundError:
    lines = []

for line in lines:
    key, separator, value = line.partition("=")
    if separator:
        state[key] = value

def parse_timestamp(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

existing_timestamp = parse_timestamp(state.get("lastActivityAt", ""))
next_timestamp = parse_timestamp(timestamp)
if next_timestamp is None:
    sys.exit(0)
if existing_timestamp is not None and existing_timestamp > next_timestamp:
    sys.exit(0)

state["status"] = activity
state["lastActivityAt"] = timestamp
state_path.parent.mkdir(parents=True, exist_ok=True)
temp_path = state_path.with_suffix(state_path.suffix + ".tmp")
temp_path.write_text("".join(f"{key}={state.get(key, '')}\\n" for key in keys), encoding="utf-8")
temp_path.replace(state_path)
`;
}

function parseNativePersistedSessionState(rawState: string): NativePersistedSessionState {
  const state: NativePersistedSessionState = {};
  for (const line of rawState.split(/\r?\n/g)) {
    const [key, ...valueParts] = line.split("=");
    const rawValue = valueParts.join("=").trim();
    const value =
      key === "firstUserMessageBase64" || key === "agentSessionPath"
        ? rawValue
        : rawValue.replace(/\s+/g, " ");
    if (!value) {
      continue;
    }
    if (key === "agent") {
      state.agentName = value;
    } else if (key === "agentSessionId") {
      state.agentSessionId = value;
    } else if (key === "agentSessionPath") {
      state.agentSessionPath = value;
    } else if (key === "commandExitCode") {
      const exitCode = Number.parseInt(value, 10);
      if (Number.isFinite(exitCode)) {
        state.commandExitCode = exitCode;
      }
    } else if (key === "commandRunId") {
      state.commandRunId = value;
    } else if (key === "firstUserMessageBase64") {
      state.firstUserMessage = normalizeNativePersistedTextBase64(value);
    } else if (key === "autoTitleFromFirstPrompt") {
      state.hasAutoTitleFromFirstPrompt = value === "1" || /^true$/iu.test(value);
    } else if (key === "lastActivityAt") {
      state.lastActivityAt = normalizeNativeIsoTimestamp(value);
    } else if (key === "pendingFirstPromptAutoRenamePrompt") {
      state.pendingFirstPromptAutoRenamePrompt = value;
    } else if (key === "status" && (value === "idle" || value === "working")) {
      state.status = value;
    } else if (key === "title") {
      state.title = getVisibleTerminalTitle(value);
    }
  }
  /**
   * CDXC:FirstMessage 2026-04-28-05:48
   * Existing agent sessions may only have the first prompt in the legacy
   * pending auto-title field. Treat that saved prompt as the first message
   * until a newer hook writes the dedicated base64 field.
   */
  state.firstUserMessage = state.firstUserMessage ?? state.pendingFirstPromptAutoRenamePrompt;
  return state;
}

function normalizeNativePersistedTextBase64(value: string): string | undefined {
  try {
    const decodedBytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const decodedValue = new TextDecoder().decode(decodedBytes).trim();
    return decodedValue || undefined;
  } catch {
    return undefined;
  }
}

function normalizeNativeIsoTimestamp(value: string): string | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return new Date(timestamp).toISOString();
}

function getNativeTimestampValue(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isNativeTimestampNewer(candidate: string, current: string | undefined): boolean {
  const candidateTimestamp = getNativeTimestampValue(candidate);
  if (candidateTimestamp <= 0) {
    return false;
  }
  return candidateTimestamp > getNativeTimestampValue(current);
}

async function generateNativeSessionTitleFromPrompt(cwd: string, prompt: string): Promise<string> {
  const sourceText = prompt.slice(0, GENERATED_SESSION_TITLE_SOURCE_MAX_LENGTH);
  const generationPrompt = buildNativeSessionTitlePrompt(sourceText);
  const delimiter = `ghostex_SESSION_TITLE_${Date.now().toString(36)}`;
  const command = [
    /**
     * CDXC:SessionTitleSync 2026-04-26-20:27
     * Internal first-prompt title generation summarizes user text only. It must
     * not require the terminal cwd to be a trusted Git repository, because new
     * empty sessions can start at `/` or another non-repo path.
     */
    "codex exec --skip-git-repo-check -m gpt-5.4-mini -c 'model_reasoning_effort=\"low\"' - <<'",
    delimiter,
    "'\n",
    generationPrompt,
    "\n",
    delimiter,
  ].join("");
  const result = await runNativeProcess("/bin/zsh", ["-lc", command], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || "Codex title generation failed.",
    );
  }
  return parseNativeGeneratedSessionTitleText(result.stdout);
}

function buildNativeSessionTitlePrompt(sourceText: string): string {
  return [
    "Write a concise session title that summarizes the user's text.",
    "Return plain text only.",
    "Rules:",
    "- keep it specific and scannable",
    "- prefer 2 to 4 words when possible",
    `- must be fewer than ${GENERATED_SESSION_TITLE_MAX_LENGTH + 1} characters`,
    "- do not abbreviate with ellipses",
    "- do not use quotes, markdown, or commentary",
    "- do not end with punctuation",
    "- focus on the task, bug, feature, or topic",
    "",
    "User text:",
    sourceText,
    "",
    "Output handling:",
    "- Produce only the final session title.",
    "- Do not wrap the result in backticks.",
    "- Print only the final result to stdout.",
  ].join("\n");
}

function parseNativeGeneratedSessionTitleText(value: string): string {
  const normalized = normalizeNativeGeneratedText(value);
  const titleLine = normalized.split(/\r?\n/g).find((line) => line.trim().length > 0);
  if (!titleLine) {
    throw new Error("Codex title generation returned an empty session title.");
  }
  const sanitized = titleLine
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.…]+$/gu, "");
  if (!sanitized) {
    throw new Error("Codex title generation returned an empty session title.");
  }
  return clampNativeGeneratedSessionTitleLength(sanitized);
}

function normalizeNativeGeneratedText(value: string): string {
  const trimmed = value.trim();
  const fencedMatch = /^```(?:[a-z0-9_-]+)?\n([\s\S]*?)\n```$/iu.exec(trimmed);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function clampNativeGeneratedSessionTitleLength(value: string): string {
  if (value.length <= GENERATED_SESSION_TITLE_MAX_LENGTH) {
    return value;
  }
  const words = value.split(" ").filter(Boolean);
  let candidate = "";
  for (const word of words) {
    const nextCandidate = candidate ? `${candidate} ${word}` : word;
    if (nextCandidate.length > GENERATED_SESSION_TITLE_MAX_LENGTH) {
      break;
    }
    candidate = nextCandidate;
  }
  return candidate || value.slice(0, GENERATED_SESSION_TITLE_MAX_LENGTH).trim();
}

async function sendNativeFirstPromptRenameCommand(
  sessionId: string,
  strategy: FirstPromptAutoRenameStrategy,
  title: string | undefined,
): Promise<void> {
  const nativeSessionId = nativeSessionIdForSidebarSession(sessionId);
  const commandText =
    strategy === "sendBareRenameCommand"
      ? "/rename"
      : strategy === "generateTitleAndName"
        ? `/name ${title ?? ""}`.trim()
        : `/rename ${title ?? ""}`.trim();
  postNative({ sessionId: nativeSessionId, text: commandText, type: "writeTerminalText" });
  await new Promise((resolve) => window.setTimeout(resolve, AUTO_SUBMIT_STAGED_RENAME_DELAY_MS));
  /**
   * CDXC:SessionTitleSync 2026-04-26-10:04
   * Auto rename must submit the staged `/rename <title>` through Ghostty's
   * Return-key path, matching ghostex. Writing "\r" as terminal text creates a
   * visible newline in Codex instead of accepting the command.
   */
  postNative({ sessionId: nativeSessionId, type: "sendTerminalEnter" });
  appendSessionTitleDebugLog("terminalRenameCommand.sent", {
    commandText,
    nativeSessionId,
    reason: "first-prompt-auto-rename",
    sessionId,
    strategy,
  });
}

function logNativeFirstPromptAutoRenameSkipOnce(
  sessionId: string,
  terminalState: NonNullable<ReturnType<typeof terminalStateById.get>>,
  reason: string,
  details?: Record<string, unknown>,
): void {
  const key = `${reason}:${details?.hasPendingPrompt ?? ""}:${details?.currentTitle ?? ""}`;
  if (terminalState.firstPromptAutoRenameLastLogKey === key) {
    return;
  }
  terminalState.firstPromptAutoRenameLastLogKey = key;
  appendSessionTitleDebugLog("nativeSidebar.firstPromptAutoRename.skipped", {
    ...details,
    reason,
    sessionId,
  });
}

function getNativePromptPreview(prompt: string | undefined): string | undefined {
  const normalizedPrompt = prompt?.replace(/\s+/g, " ").trim();
  if (!normalizedPrompt) {
    return undefined;
  }
  return normalizedPrompt.length > 160
    ? `${normalizedPrompt.slice(0, 157).trimEnd()}...`
    : normalizedPrompt;
}

function closeTerminal(
  sessionId: string,
  options: { preservePersistenceSession?: boolean } = {},
): void {
  const reference = resolveSidebarSessionReference(sessionId);
  const sessionRecord = findSessionRecordInProject(reference.project, reference.sessionId);
  if (sessionRecord?.kind === "terminal" && sessionRecord.surface === "commands") {
    const nativeSessionId = forgetNativeSessionMappingForProject(
      reference.project.projectId,
      reference.sessionId,
    );
    clearNativeSidebarCommandSessionBySessionId(reference.sessionId);
    updateProjectCommandsPanel(reference.project.projectId, (panel) => {
      const sessions = panel.sessions.filter((session) => session.sessionId !== reference.sessionId);
      const paneLayout = removeCommandSessionFromPaneLayout(panel.paneLayout, reference.sessionId);
      return {
        ...panel,
        activeSessionId:
          panel.activeSessionId === reference.sessionId
            ? sessions[0]?.sessionId
            : panel.activeSessionId,
        paneLayout,
        sessions,
      };
    });
    terminalStateById.delete(reference.sessionId);
    titleDerivedActivityBySessionId.delete(reference.sessionId);
    nativeActivitySuppressedUntilBySessionId.delete(reference.sessionId);
    nativeWorkingStartedAtBySessionId.delete(reference.sessionId);
    clearNativeSessionAttentionTracking(reference.sessionId);
    nativeAttentionNotificationLastSentAtBySessionId.delete(reference.sessionId);
    clearDelayedSendTimer(reference.sessionId);
    postNative({
      preservePersistenceSession: options.preservePersistenceSession,
      sessionId: nativeSessionId,
      type: "closeTerminal",
    });
    publish();
    return;
  }
  appendSidebarRefreshDebugLog("nativeSidebar.closeSession.before", {
    project: summarizeSidebarRefreshProject(reference.project),
    requestedSessionId: sessionId,
    resolvedSessionId: reference.sessionId,
    sessionKind: sessionRecord?.kind,
  });
  const nativeSessionId = forgetNativeSessionMappingForProject(
    reference.project.projectId,
    reference.sessionId,
  );
  clearNativeSidebarCommandSessionBySessionId(reference.sessionId);
  rememberPreviousSession(reference.sessionId, reference.project);
  updateProjectWorkspace(
    reference.project.projectId,
    (workspace) => removeSessionInSimpleWorkspace(workspace, reference.sessionId).snapshot,
  );
  terminalStateById.delete(reference.sessionId);
  titleDerivedActivityBySessionId.delete(reference.sessionId);
  nativeActivitySuppressedUntilBySessionId.delete(reference.sessionId);
  nativeWorkingStartedAtBySessionId.delete(reference.sessionId);
  clearNativeSessionAttentionTracking(reference.sessionId);
  nativeAttentionNotificationLastSentAtBySessionId.delete(reference.sessionId);
  clearDelayedSendTimer(reference.sessionId);
  postNative({
    preservePersistenceSession: options.preservePersistenceSession,
    sessionId: nativeSessionId,
    type:
      sessionRecord?.kind === "t3" || sessionRecord?.kind === "browser"
        ? "closeWebPane"
        : "closeTerminal",
  });
  publish();
  appendSidebarRefreshDebugLog("nativeSidebar.closeSession.afterPublish", {
    nativeSessionId,
    project: summarizeSidebarRefreshProject(),
    requestedSessionId: sessionId,
    resolvedSessionId: reference.sessionId,
    sessionKind: sessionRecord?.kind,
  });
}

function focusTerminal(sessionId: string): void {
  const reference = resolveSidebarSessionReference(sessionId);
  const sidebarCardFocusTrace = getRecentSidebarCardFocusTrace(reference.sessionId);
  const forceSidebarCardFocusTrace = sidebarCardFocusTrace !== undefined;
  const focusTargetBefore = summarizeSidebarSessionFocusTarget(
    reference.project,
    reference.sessionId,
  );
  appendTerminalFocusDebugLog("nativeFocusTrace.sidebarFocusTerminalStart", {
    activeProjectId,
    activeSnapshotFocusedSessionId: activeSnapshot().focusedSessionId,
    commandPanelContainsSession: commandPanelContainsSession(reference.project, reference.sessionId),
    focusTargetBefore,
    projectEditorIsOpen:
      projectEditorSurfaceByProjectId.get(reference.project.projectId)?.isOpen === true,
    requestedSessionId: sessionId,
    resolvedProjectId: reference.project.projectId,
    resolvedSessionId: reference.sessionId,
    sidebarCardFocusTrace: summarizeSidebarCardFocusTrace(sidebarCardFocusTrace),
  }, { force: forceSidebarCardFocusTrace });
  if (activeProjectId !== reference.project.projectId) {
    focusProject(reference.project.projectId);
  }
  if (commandPanelContainsSession(reference.project, reference.sessionId)) {
    updateProjectCommandsPanel(reference.project.projectId, (panel) => ({
      ...panel,
      activeSessionId: reference.sessionId,
      isVisible: true,
      paneLayout: setActiveCommandSessionInPaneLayout(panel.paneLayout, reference.sessionId),
    }));
    queueNativeLayoutFocusRequest(reference.sessionId, "focusCommandTerminal");
    if (!terminalStateById.has(reference.sessionId)) {
      const session = findTerminalSessionInProject(reference.project, reference.sessionId);
      if (session) {
        restoreNativeTerminalSession(reference.project, session, "focus-command-session");
      }
    }
    publish();
    postNative({
      sessionId: nativeSessionIdForProjectSidebarSession(
        reference.project.projectId,
        reference.sessionId,
      ),
      type: "focusTerminal",
    });
    return;
  }
  const shouldKeepProjectEditorOpen =
    projectEditorSurfaceByProjectId.get(reference.project.projectId)?.isOpen === true;
  /**
   * CDXC:ProjectEditorCompanion 2026-05-14-09:19:
   * Session-card clicks inside an active embedded VS Code project should select
   * the left native companion pane, not close the editor surface. Keep the
   * project-editor state open and always send the native focus command, even if
   * the clicked session is already the focused sidebar session, so a locally
   * closed companion pane can be restored.
   * CDXC:ProjectEditorCompanion 2026-05-14-09:40:
   * While VS Code is open, the direct native focus command is the companion
   * retargeting path. Do not enqueue the layout focus request too, because that
   * adds a second native focus/layout pass and can visibly refresh the editor
   * embed even though only the left companion session changed.
   */
  if (!shouldKeepProjectEditorOpen) {
    activateWorkspaceSurfaceForProject(reference.project.projectId);
  }
  updateActiveProjectWorkspace(
    (workspace) => focusSessionInSimpleWorkspace(workspace, reference.sessionId).snapshot,
  );
  const focusTargetAfter = summarizeSidebarSessionFocusTarget(activeProject(), reference.sessionId);
  if (!shouldKeepProjectEditorOpen) {
    queueNativeLayoutFocusRequest(reference.sessionId, "focusTerminal");
  }
  const sessionRecord = findSessionRecord(reference.sessionId);
  /**
   * CDXC:SidebarSessionFocus 2026-05-15-20:01:
   * A session card must activate the existing paneLayout owner for that
   * session. Log the target group, paneLayout membership, tab sibling list,
   * focus request, and before/after visible ids so an unexpected new split can
   * be traced to either stale sidebar state, missing paneLayout membership, or
   * native layout synthesis.
   */
  appendTerminalFocusDebugLog("nativeFocusTrace.sidebarFocusTerminalPostState", {
    activeProjectId,
    focusTargetAfter,
    focusedSessionId: activeSnapshot().focusedSessionId,
    isProjectEditorCompanionPath: shouldKeepProjectEditorOpen,
    nativeSessionId: nativeSessionIdForProjectSidebarSession(
      reference.project.projectId,
      reference.sessionId,
    ),
    requestedSessionId: sessionId,
    resolvedSessionId: reference.sessionId,
    sidebarCardFocusTrace: summarizeSidebarCardFocusTrace(sidebarCardFocusTrace),
    sessionKind: sessionRecord?.kind,
    visibleSessionIds: activeSnapshot().visibleSessionIds,
  }, { force: forceSidebarCardFocusTrace });
  if (sessionRecord?.kind === "t3" || sessionRecord?.kind === "browser") {
    if (!nativeSessionIdBySidebarSessionId.has(reference.sessionId)) {
      if (sessionRecord.kind === "t3") {
        restoreNativeT3Session(activeProject(), sessionRecord, "focus-restored-session");
      } else {
        restoreNativeBrowserSession(activeProject(), sessionRecord, "focus-restored-session");
      }
    }
    postNative({
      sessionId: nativeSessionIdForProjectSidebarSession(
        reference.project.projectId,
        reference.sessionId,
      ),
      type: "focusWebPane",
    });
    publish();
    return;
  }
  const session = findTerminalSession(reference.sessionId);
  /**
   * CDXC:SessionSleep 2026-04-27-09:09
   * Sleeping a native Ghostty session destroys its terminal surface. Activating
   * that card must first recreate the terminal and run the agent resume command
   * before sending native focus, matching agent-tiler's detached-session wake.
   * CDXC:CrashRootCause 2026-05-04-11:53
   * Restored sleeping terminals mount inactive, so the focused sidebar snapshot
   * must be published to native before the explicit focus command. This keeps
   * restore ordering aligned with new terminal launches and prevents a
   * previous+restored active-surface window during rapid card clicks.
   */
  let restoredSleepingTerminal = false;
  if (session && !terminalStateById.has(reference.sessionId)) {
    restoreNativeTerminalSession(activeProject(), session, "focus-sleeping-session");
    restoredSleepingTerminal = true;
  }
  acknowledgeNativeTerminalAttention(reference.sessionId, "sidebar-focus");
  if (restoredSleepingTerminal) {
    publish();
    postNative({
      sessionId: nativeSessionIdForProjectSidebarSession(
        reference.project.projectId,
        reference.sessionId,
      ),
      type: "focusTerminal",
    });
    return;
  }
  postNative({
    sessionId: nativeSessionIdForProjectSidebarSession(
      reference.project.projectId,
      reference.sessionId,
    ),
    type: activeSnapshot().sessions.some(
      (candidate) =>
        candidate.sessionId === reference.sessionId &&
        (candidate.kind === "t3" || candidate.kind === "browser"),
    )
      ? "focusWebPane"
      : "focusTerminal",
  });
  publish();
}

function focusSidebarSession(sessionId: string): void {
  /**
   * CDXC:BrowserOverlay 2026-04-27-10:23
   * The sidebar Chrome Canary card is a browser-window control, not a terminal
   * session. Any sidebar focus path, including debug CLI replay, must route it
   * to Swift's Canary show command so clicking it reveals the existing Canary
   * window the same way the browser new-tab button reveals a Canary window.
   */
  if (sessionId === CHROME_CANARY_BROWSER_SESSION_ID) {
    showNativeBrowserWindow();
    return;
  }
  focusTerminal(sessionId);
}

function runNativeHotkeyAction(actionId: ghostexHotkeyActionId, source: "dom" | "native"): void {
  const action = getghostexHotkeyActionById(actionId);
  if (!action) {
    logNativeHotkeyDebug("nativeHotkeys.actionMissing", { actionId });
    return;
  }
  logNativeHotkeyDebug("nativeHotkeys.actionStart", {
    actionId,
    kind: action.kind,
  });

  /**
   * CDXC:Hotkeys 2026-04-28-05:20
   * App-level hotkeys execute against the same native sidebar state mutations
   * as clicks and CLI commands. Do the real command directly here so terminal
   * focus shortcuts do not depend on a hidden fallback UI path.
   */
  switch (action.kind) {
    case "createSession":
      createNativeSessionInCurrentContext();
      return;
    case "focusAdjacentGroup":
      focusAdjacentNativeHotkeyGroup(action.direction);
      return;
    case "focusDirection":
      focusNativeHotkeyDirection(action.direction);
      return;
    case "focusGroup":
      focusNativeHotkeyGroupByIndex(action.groupIndex);
      return;
    case "focusSessionSlot":
      if (action.slotNumber === -1) {
        focusAdjacentNativeHotkeySession(-1);
        return;
      }
      if (action.slotNumber === 0) {
        focusAdjacentNativeHotkeySession(1);
        return;
      }
      focusNativeHotkeySessionSlot(action.slotNumber);
      return;
    case "focusedPaneAction":
      /**
       * CDXC:CommandPalette 2026-05-17-01:32:
       * Command-palette pane actions and their hotkeys should execute through
       * the same focused-session titlebar handler as the native pane menu, so
       * browser, split, merge, fork, reload, delay, and pop-out behavior stays
       * scoped to the user's current pane.
       */
      runFocusedPaneHotkeyAction(action.focusedPaneAction);
      return;
    case "moveSidebar":
      moveSidebarToOtherSide();
      return;
    case "openCommandPalette":
      /**
       * CDXC:CommandPalette 2026-05-15-20:38:
       * Native Cmd+K should reveal the full-window app-modal command palette
       * from terminal focus without opening the Commands panel or depending on
       * a sidebar-local DOM render path.
       */
      openAppModal({ modal: "commandPalette", type: "open" });
      return;
    case "openCommandsPanel":
      if (source === "native") {
        toggleFocusedCommandsPanelForActiveProject();
        return;
      }
      openCommandsPanelForActiveProject();
      return;
    case "openSettings":
      openAppModal({ modal: "settings", type: "open" });
      return;
    case "renameActiveSession":
      promptRenameFocusedNativeHotkeySession();
      return;
    case "runActionSlot":
      /**
       * CDXC:ActionsHotkeys 2026-05-17-01:18:
       * Action hotkeys are positional launchers for the current Actions list.
       * Resolve the command at dispatch time so reordering actions changes
       * Ctrl+Shift+N behavior without rewriting saved hotkey settings.
       */
      runNativeSidebarCommandSlot(action.slotNumber);
      return;
    case "setViewMode":
      updateActiveProjectWorkspace((workspace) =>
        setViewModeInSimpleWorkspace(workspace, action.viewMode),
      );
      publish();
      return;
    case "splitFocusedPane":
      splitFocusedNativePane(action.direction);
      return;
  }
}

function runFocusedPaneHotkeyAction(action: ghostexFocusedPaneAction): void {
  const focusedSessionId = activeSnapshot().focusedSessionId;
  if (!focusedSessionId) {
    logNativeHotkeyDebug("nativeHotkeys.focusedPaneActionNoFocusedSession", { action });
    return;
  }
  if (action === "popOutPane") {
    const session = findSessionRecord(focusedSessionId);
    handleNativeTerminalTitleBarAction(
      focusedSessionId,
      session?.isPoppedOut === true ? "restorePopOut" : "popOut",
    );
    return;
  }
  handleNativeTerminalTitleBarAction(focusedSessionId, focusedPaneHotkeyActionToTitlebarAction(action));
}

function focusedPaneHotkeyActionToTitlebarAction(
  action: Exclude<ghostexFocusedPaneAction, "popOutPane">,
): NativeTerminalTitleBarAction {
  switch (action) {
    case "openBrowserPane":
      return "openBrowser";
    case "rotatePanesClockwise":
      return "rotatePanesClockwise";
    case "mergeAllTabs":
      return "mergeAllTabs";
    case "delayedSend":
      return "delayedSend";
    case "forkSession":
      return "fork";
    case "reloadSession":
      return "reload";
  }
}

function runNativeSidebarCommandSlot(slotNumber: number): void {
  const command = commands[slotNumber - 1];
  if (!command) {
    logNativeHotkeyDebug("nativeHotkeys.actionSlotMissing", {
      slotNumber: String(slotNumber),
      totalCommands: String(commands.length),
    });
    return;
  }
  runNativeSidebarCommand(command);
}

function getMatchingNativeHotkeyActionId(
  hotkeyText: string | undefined,
  now: number,
  source: "dom" | "native",
): ghostexHotkeyActionId | undefined {
  if (!hotkeyText) {
    pendingHotkeyPrefix = undefined;
    return undefined;
  }
  const normalizedHotkeys = settings.hotkeys;
  const sequence = pendingHotkeyPrefix ? `${pendingHotkeyPrefix} ${hotkeyText}` : hotkeyText;
  const matchedActionId = getghostexHotkeyActionIdForKey(normalizedHotkeys, sequence);
  if (matchedActionId) {
    logNativeHotkeyDebug("nativeHotkeys.match", {
      actionId: matchedActionId,
      hotkeyText,
      sequence,
      source,
    });
    pendingHotkeyPrefix = undefined;
    return matchedActionId;
  }

  const hasPrefix = Object.values(normalizedHotkeys).some((value) =>
    value?.startsWith(`${hotkeyText} `),
  );
  if (hasPrefix) {
    logNativeHotkeyDebug("nativeHotkeys.prefixStarted", {
      hotkeyText,
      source,
    });
  } else if (hotkeyText.includes("+")) {
    logNativeHotkeyDebug("nativeHotkeys.noMatch", {
      configuredCount: Object.keys(normalizedHotkeys).length,
      hotkeyText,
      pendingHotkeyPrefix,
      sequence,
      source,
    });
  }
  pendingHotkeyPrefix = hasPrefix ? hotkeyText : undefined;
  window.setTimeout(() => {
    if (pendingHotkeyPrefix === hotkeyText && Date.now() - now >= 1_000) {
      logNativeHotkeyDebug("nativeHotkeys.prefixExpired", {
        hotkeyText,
        source,
      });
      pendingHotkeyPrefix = undefined;
    }
  }, 1_000);
  return undefined;
}

function keyboardEventToNativeHotkeyText(event: KeyboardEvent): string | undefined {
  const key = normalizeNativeHotkeyKey(event.key);
  if (!key) {
    return undefined;
  }
  const parts = [
    event.metaKey ? "cmd" : "",
    event.ctrlKey ? "ctrl" : "",
    event.altKey ? "alt" : "",
    event.shiftKey ? "shift" : "",
    key,
  ].filter(Boolean);
  return parts.length > 1 ? parts.join("+") : key;
}

function normalizeNativeHotkeyKey(key: string): string | undefined {
  if (key.length === 1) {
    return key.toLowerCase();
  }
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowRight":
      return "right";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "Escape":
    case "Meta":
    case "Control":
    case "Alt":
    case "Shift":
      return undefined;
    default:
      return key.toLowerCase();
  }
}

function isNativeHotkeyEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest("[data-hotkey-recorder='true']")) {
    /**
     * CDXC:Hotkeys 2026-05-10-12:06
     * Rebinding must let the recorder own Command/Option chords that are already
     * assigned globally. Do not dispatch app actions from inside recorder chrome.
     */
    return true;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isNativeHotkeyCandidate(event: KeyboardEvent, hotkeyText: string | undefined): boolean {
  return Boolean(hotkeyText && (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey));
}

function isNativeCommandArrowHotkey(
  event: KeyboardEvent,
  hotkeyText: string | undefined,
): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    (hotkeyText === "cmd+left" || hotkeyText === "cmd+right")
  );
}

function describeNativeHotkeyTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return target === null ? "null" : typeof target;
  }
  const tagName = target.tagName.toLowerCase();
  const role = target.getAttribute("role");
  const dataSlot = target.getAttribute("data-slot");
  return [tagName, role ? `role=${role}` : "", dataSlot ? `slot=${dataSlot}` : ""]
    .filter(Boolean)
    .join(" ");
}

function focusNativeHotkeyDirection(direction: SessionGridDirection): void {
  const snapshotBefore = activeSnapshot();
  const groupBefore = activeWorkspaceGroup();
  const shouldTraceCommandArrow = direction === "left" || direction === "right";
  if (shouldTraceCommandArrow) {
    logNativeHotkeyDebug("nativeHotkeys.commandArrowFocusDirectionStart", {
      activeGroupId: groupBefore.groupId,
      direction,
      focusedSessionId: snapshotBefore.focusedSessionId,
      paneLayout: summarizeSessionPaneLayout(snapshotBefore.paneLayout),
      sessionIds: snapshotBefore.sessions.map((session) => session.sessionId),
      visibleSessionIds: snapshotBefore.visibleSessionIds,
    });
  }
  const result = focusDirectionInSnapshot(snapshotBefore, direction);
  if (!result.changed) {
    logNativeHotkeyDebug(
      shouldTraceCommandArrow
        ? "nativeHotkeys.commandArrowFocusDirectionUnchanged"
        : "nativeHotkeys.focusDirectionUnchanged",
      {
        direction,
        focusedSessionId: snapshotBefore.focusedSessionId,
        paneLayout: summarizeSessionPaneLayout(snapshotBefore.paneLayout),
        visibleSessionIds: snapshotBefore.visibleSessionIds,
      },
    );
    return;
  }
  if (shouldTraceCommandArrow) {
    logNativeHotkeyDebug("nativeHotkeys.commandArrowFocusDirectionResolved", {
      activeGroupId: groupBefore.groupId,
      direction,
      focusedSessionIdAfter: result.snapshot.focusedSessionId,
      focusedSessionIdBefore: snapshotBefore.focusedSessionId,
      paneLayoutAfter: summarizeSessionPaneLayout(result.snapshot.paneLayout),
      paneLayoutBefore: summarizeSessionPaneLayout(snapshotBefore.paneLayout),
      sessionIdsAfter: result.snapshot.sessions.map((session) => session.sessionId),
      sessionIdsBefore: snapshotBefore.sessions.map((session) => session.sessionId),
      visibleSessionIdsAfter: result.snapshot.visibleSessionIds,
      visibleSessionIdsBefore: snapshotBefore.visibleSessionIds,
    });
  }
  /**
   * CDXC:PaneFocus 2026-05-15-13:31:
   * Directional focus hotkeys must use the pane-layout-aware workspace focus path.
   * Replacing the active group with a legacy normalized SessionGridSnapshot can drop paneLayout and make native sync explode grouped tabs into separate panes.
   */
  const nextFocusedSessionId = result.snapshot.focusedSessionId;
  updateActiveProjectWorkspace(
    (workspace) =>
      nextFocusedSessionId
        ? focusSessionInSimpleWorkspace(workspace, nextFocusedSessionId).snapshot
        : workspace,
  );
  publish();
  const focusedSessionId = activeSnapshot().focusedSessionId;
  if (focusedSessionId) {
    if (shouldTraceCommandArrow) {
      logNativeHotkeyDebug("nativeHotkeys.commandArrowFocusSidebarSession", {
        direction,
        focusedSessionId,
      });
    }
    focusSidebarSession(focusedSessionId);
  }
}

function focusNativeHotkeyGroupByIndex(groupIndex: number): void {
  const targetGroup = activeProject().workspace.groups[groupIndex - 1];
  if (!targetGroup) {
    logNativeHotkeyDebug("nativeHotkeys.groupIndexMissing", {
      groupCount: activeProject().workspace.groups.length,
      groupIndex,
    });
    return;
  }
  focusNativeHotkeyGroup(targetGroup.groupId, "index");
}

function focusAdjacentNativeHotkeyGroup(direction: -1 | 1): void {
  const groups = activeProject().workspace.groups;
  if (groups.length === 0) {
    logNativeHotkeyDebug("nativeHotkeys.adjacentGroupMissing", { direction });
    return;
  }
  const activeGroupIndex = Math.max(
    0,
    groups.findIndex((group) => group.groupId === activeProject().workspace.activeGroupId),
  );
  const nextIndex = (activeGroupIndex + direction + groups.length) % groups.length;
  focusNativeHotkeyGroup(groups[nextIndex]!.groupId, direction > 0 ? "next" : "previous");
}

function focusNativeHotkeyGroup(groupId: string, source: "index" | "next" | "previous"): void {
  updateActiveProjectWorkspace(
    (workspace) => focusGroupInSimpleWorkspace(workspace, groupId).snapshot,
  );
  publish();
  const focusedSessionId = activeSnapshot().focusedSessionId;
  if (focusedSessionId) {
    focusSidebarSession(focusedSessionId);
  }
  logNativeHotkeyDebug("nativeHotkeys.groupFocused", { groupId, source });
}

function focusNativeHotkeySessionSlot(slotNumber: number): void {
  const sessions = getVisualNativeHotkeySessionsForActiveGroup();
  const session = sessions[slotNumber - 1];
  if (session) {
    focusSidebarSession(session.sessionId);
    return;
  }
  logNativeHotkeyDebug("nativeHotkeys.sessionSlotMissing", {
    activeSessionsSortMode,
    sessionCount: sessions.length,
    slotNumber,
  });
}

function focusAdjacentNativeHotkeySession(direction: -1 | 1): void {
  const sessions = getVisibleNativeHotkeySidebarSessionsForNavigation();
  if (sessions.length === 0) {
    logNativeHotkeyDebug("nativeHotkeys.adjacentSessionMissing", { direction });
    return;
  }
  const focusedIndex = sessions.findIndex((session) => isNativeHotkeyFocusedSession(session));
  /**
   * CDXC:Hotkeys 2026-05-11-09:26
   * Cmd+[ and Cmd+] navigate the visible sidebar session list, not only the
   * active workspace group. In Combined mode this crosses into the next
   * expanded project group and skips collapsed project sections because users
   * expect hidden sessions to stay out of keyboard traversal.
   */
  const nextIndex =
    focusedIndex === -1
      ? direction > 0
        ? 0
        : sessions.length - 1
      : (focusedIndex + direction + sessions.length) % sessions.length;
  focusSidebarSession(sessions[nextIndex]!.sessionId);
}

function getVisibleNativeHotkeySidebarSessionsForNavigation(): SidebarSessionItem[] {
  const groups = createCombinedSidebarGroups().filter((group) =>
    isNativeHotkeySidebarGroupExpanded(group.groupId),
  );
  const sessionIdsByGroup = Object.fromEntries(
    groups.map((group) => [group.groupId, group.sessions.map((session) => session.sessionId)]),
  );
  const sessionsById = Object.fromEntries(
    groups.flatMap((group) => group.sessions.map((session) => [session.sessionId, session])),
  );
  const displayLayout = createDisplaySessionLayout({
    sessionIdsByGroup,
    sessionsById,
    sortMode: activeSessionsSortMode,
    workspaceGroupIds: groups.map((group) => group.groupId),
  });

  /**
   * CDXC:Hotkeys 2026-05-15-10:15:
   * Next Tab and Previous Tab must follow the same visible sidebar order the
   * user sees, including the active sessions sort mode and collapsed Combined
   * sections. Build the traversal list from the display layout instead of the
   * underlying workspace session arrays so keyboard navigation does not jump
   * by an invisible storage order.
   */
  return displayLayout.groupIds.flatMap((groupId) =>
    (displayLayout.sessionIdsByGroup[groupId] ?? [])
      .map((sessionId) => sessionsById[sessionId])
      .filter((session): session is SidebarSessionItem => session !== undefined),
  );
}

function isNativeHotkeyFocusedSession(session: SidebarSessionItem): boolean {
  const reference = resolveSidebarSessionReference(session.sessionId);
  return (
    reference.project.projectId === activeProjectId &&
    reference.sessionId === activeSnapshot().focusedSessionId
  );
}

function isNativeHotkeySidebarGroupExpanded(groupId: string): boolean {
  const element = document.querySelector(
    `[data-sidebar-group-id="${escapeNativeHotkeySelectorValue(groupId)}"]`,
  );
  if (!element) {
    return true;
  }
  return (
    element.getAttribute("data-collapsed") !== "true" &&
    !element.closest(".reference-sidebar-collapsible-body[data-collapsed='true']")
  );
}

function escapeNativeHotkeySelectorValue(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getVisualNativeHotkeySessionsForActiveGroup(): SidebarSessionItem[] {
  const group = activeWorkspaceGroup();
  const projectedSessions = createProjectedSidebarSessionsForGroup(group);
  const sessionsById = Object.fromEntries(
    projectedSessions.map((session) => [session.sessionId, session]),
  );
  const manualSessionIds = projectedSessions.map((session) => session.sessionId);
  const displayLayout = createDisplaySessionLayout({
    sessionIdsByGroup: { [group.groupId]: manualSessionIds },
    sessionsById,
    sortMode: activeSessionsSortMode,
    workspaceGroupIds: [group.groupId],
  });
  const visualSessionIds = displayLayout.sessionIdsByGroup[group.groupId] ?? manualSessionIds;
  /**
   * CDXC:Hotkeys 2026-04-28-16:08
   * Numeric session hotkeys must target the same visual order the user sees in
   * the sidebar. Reuse the rendered active-session sorting projection so
   * Cmd+Opt+number follows last-activity order when that mode is selected.
   */
  return visualSessionIds
    .map((sessionId) => sessionsById[sessionId])
    .filter((session): session is SidebarSessionItem => session !== undefined);
}

function promptRenameFocusedNativeHotkeySession(): void {
  const focusedSessionId = activeSnapshot().focusedSessionId;
  if (!focusedSessionId) {
    logNativeHotkeyDebug("nativeHotkeys.renameNoFocusedSession", {});
    return;
  }
  const session = findTerminalSession(focusedSessionId);
  if (!session) {
    logNativeHotkeyDebug("nativeHotkeys.renameFocusedSessionNotTerminal", { focusedSessionId });
    return;
  }
  /**
   * CDXC:AppModals 2026-04-28-16:18
   * Native hotkey rename must use the shared React modal host instead of
   * browser prompt UI, matching the no VS Code/native prompt requirement.
   */
  openAppModal({
    initialTitle: session.title || DEFAULT_TERMINAL_SESSION_TITLE,
    modal: "renameSession",
    sessionId: focusedSessionId,
    type: "open",
  });
}

function acknowledgeNativeTerminalAttention(
  sessionId: string,
  reason: "native-focus" | "sidebar-focus",
): boolean {
  const terminalState = terminalStateById.get(sessionId);
  if (terminalState?.activity !== "attention") {
    return false;
  }

  const attentionEnteredAt = nativeAttentionEnteredAtBySessionId.get(sessionId);
  const remainingVisibleMs =
    attentionEnteredAt === undefined
      ? 0
      : NATIVE_MIN_ATTENTION_VISIBLE_MS - Math.max(0, Date.now() - attentionEnteredAt);
  if (attentionEnteredAt !== undefined && remainingVisibleMs > 0) {
    if (!nativeAttentionAcknowledgementTimeoutBySessionId.has(sessionId)) {
      const timeout = window.setTimeout(() => {
        nativeAttentionAcknowledgementTimeoutBySessionId.delete(sessionId);
        const latestAttentionEnteredAt = nativeAttentionEnteredAtBySessionId.get(sessionId);
        if (
          latestAttentionEnteredAt !== attentionEnteredAt ||
          !completeNativeTerminalAttentionAcknowledgement(sessionId, reason, attentionEnteredAt)
        ) {
          return;
        }
        publish();
      }, remainingVisibleMs);
      nativeAttentionAcknowledgementTimeoutBySessionId.set(sessionId, timeout);
    }
    appendAgentDetectionDebugLog("nativeSidebar.sessionAttentionAcknowledgementDeferred", {
      attentionEnteredAt: new Date(attentionEnteredAt).toISOString(),
      reason,
      remainingVisibleMs,
      sessionId,
    });
    return true;
  }

  return completeNativeTerminalAttentionAcknowledgement(sessionId, reason, attentionEnteredAt);
}

function completeNativeTerminalAttentionAcknowledgement(
  sessionId: string,
  reason: "native-focus" | "sidebar-focus",
  attentionEnteredAt?: number,
): boolean {
  const terminalState = terminalStateById.get(sessionId);
  if (terminalState?.activity !== "attention") {
    return false;
  }
  const latestAttentionEnteredAt = nativeAttentionEnteredAtBySessionId.get(sessionId);
  if (
    attentionEnteredAt !== undefined &&
    latestAttentionEnteredAt !== undefined &&
    latestAttentionEnteredAt !== attentionEnteredAt
  ) {
    return false;
  }

  /**
   * CDXC:NativeSessionStatus 2026-04-27-07:39
   * Done/green is an attention state, not just an exited lifecycle. Clicking a
   * green session card acknowledges that completion and clears both the card
   * dot and workspace-bar done count until the next working-to-done transition.
   *
   * CDXC:SessionAttention 2026-05-16-23:35:
   * Pane/tab clicks should always acknowledge the current green attention state. If the click arrives before the 1.5-second visibility floor, acknowledgement is completed by the deferred timer above so the border and dot disappear only after the user has had enough time to perceive them.
   */
  const previousDerivedActivity = titleDerivedActivityBySessionId.get(sessionId);
  const acknowledgedDerivedActivity =
    acknowledgeTitleDerivedSessionActivity(previousDerivedActivity);
  if (acknowledgedDerivedActivity) {
    titleDerivedActivityBySessionId.set(sessionId, acknowledgedDerivedActivity);
  }
  terminalState.activity = "idle";
  nativeAttentionEnteredAtBySessionId.delete(sessionId);
  clearNativeSessionAttentionAcknowledgementTimer(sessionId);
  appendAgentDetectionDebugLog("nativeSidebar.sessionAttentionAcknowledged", {
    attentionEnteredAt:
      attentionEnteredAt === undefined ? undefined : new Date(attentionEnteredAt).toISOString(),
    acknowledgedDerivedActivity,
    previousDerivedActivity,
    reason,
    sessionId,
  });
  return true;
}

function findSessionGroupId(sessionId: string): string | undefined {
  const reference = resolveSidebarSessionReference(sessionId);
  return reference.project.workspace.groups.find((group) =>
    group.snapshot.sessions.some((session) => session.sessionId === reference.sessionId),
  )?.groupId;
}

function findTerminalSession(sessionId: string): TerminalSessionRecord | undefined {
  const reference = resolveSidebarSessionReference(sessionId);
  return findTerminalSessionInProject(reference.project, reference.sessionId);
}

function findTerminalSessionInProject(
  project: NativeProject,
  sessionId: string,
): TerminalSessionRecord | undefined {
  const commandSession = project.commandsPanel.sessions.find(
    (candidate) => candidate.sessionId === sessionId,
  );
  if (commandSession) {
    return commandSession;
  }
  for (const group of project.workspace.groups) {
    const session = group.snapshot.sessions.find(
      (candidate) => candidate.sessionId === sessionId,
    );
    if (session?.kind === "terminal") {
      return session;
    }
  }
  return undefined;
}

function findFirstTerminalSessionInProject(
  project: NativeProject,
): TerminalSessionRecord | undefined {
  for (const group of project.workspace.groups) {
    const session = group.snapshot.sessions.find(
      (candidate): candidate is TerminalSessionRecord => candidate.kind === "terminal",
    );
    if (session) {
      return session;
    }
  }
  return undefined;
}

async function renameNativeSidebarTerminalSession(
  sessionId: string,
  title: string,
  source: string,
  options?: { shouldGenerateTitle?: boolean },
): Promise<void> {
  const reference = resolveSidebarSessionReference(sessionId);
  const session = findTerminalSessionInProject(reference.project, reference.sessionId);
  if (!session) {
    appendSessionTitleRenameTraceDebugLog("nativeSidebar.renameSession.resolveFailed", {
      activeProjectId,
      projectId: reference.project.projectId,
      projectPath: reference.project.path,
      requestedSessionId: sessionId,
      resolvedSessionId: reference.sessionId,
      source,
      titleLength: title.length,
      titlePreview: summarizeTerminalText(title),
      workspaceSessionIds: reference.project.workspace.groups.flatMap((group) =>
        group.snapshot.sessions.map((candidate) => candidate.sessionId),
      ),
    });
    return;
  }

  const shouldGenerateTitle = options?.shouldGenerateTitle === true;
  const requestedTitleInput = shouldGenerateTitle
    ? title.trim()
    : normalizeSessionRenameTitle(title);
  if (!requestedTitleInput) {
    appendSessionTitleRenameTraceDebugLog("nativeSidebar.renameSession.emptyTitleSkipped", {
      projectId: reference.project.projectId,
      requestedSessionId: sessionId,
      resolvedSessionId: reference.sessionId,
      shouldGenerateTitle,
      source,
      titleLength: title.length,
      titlePreview: summarizeTerminalText(title),
    });
    return;
  }

  const terminalState = terminalStateById.get(reference.sessionId);
  appendSessionTitleRenameTraceDebugLog("nativeSidebar.renameSession.started", {
    agentNameFromSession: session.agentName,
    agentNameFromTerminalState: terminalState?.agentName,
    existingMappedNativeSessionId: nativeSessionIdBySidebarSessionId.get(reference.sessionId),
    focusedSessionId: activeSnapshot().focusedSessionId,
    isSleeping: session.isSleeping === true,
    projectId: reference.project.projectId,
    projectPath: reference.project.path,
    requestedSessionId: sessionId,
    requestedTitleLength: requestedTitleInput.length,
    requestedTitlePreview: summarizeTerminalText(requestedTitleInput),
    resolvedSessionId: reference.sessionId,
    sessionPersistenceName: session.sessionPersistenceName,
    sessionPersistenceProvider: session.sessionPersistenceProvider,
    shouldGenerateTitle,
    source,
    storedTitle: session.title,
    terminalTitle: terminalState?.terminalTitle,
    visibleSessionIds: activeSnapshot().visibleSessionIds,
  });

  /**
   * CDXC:SessionNaming 2026-05-09-17:25
   * Long pasted text in the rename modal must remain editable until the user
   * submits. The modal owns the 70-character threshold UI and marks Generate
   * Name submits explicitly, while the controller only generates for that
   * explicit request or the saved first-message Generate Title action.
   */
  let requestedTitle = requestedTitleInput;
  if (shouldGenerateTitle) {
    if (terminalState) {
      terminalState.firstPromptAutoRenameInProgress = true;
      publish();
    }
    appendSessionTitleDebugLog("nativeSidebar.renameSession.generateTitle.started", {
      pastedTextLength: requestedTitleInput.length,
      sessionId: reference.sessionId,
      source,
    });
    try {
      requestedTitle = await generateNativeSessionTitleFromPrompt(
        reference.project.path,
        requestedTitleInput,
      );
      appendSessionTitleDebugLog("nativeSidebar.renameSession.generateTitle.completed", {
        pastedTextLength: requestedTitleInput.length,
        sessionId: reference.sessionId,
        source,
        title: requestedTitle,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendSessionTitleGenerationErrorLog("nativeSidebar.renameSession.generateTitle.failed", {
        error: message,
        pastedTextLength: requestedTitleInput.length,
        sessionId: reference.sessionId,
        source,
      });
      return;
    } finally {
      if (terminalState) {
        terminalState.firstPromptAutoRenameInProgress = false;
        publish();
      }
    }
  }

  updateProjectWorkspace(
    reference.project.projectId,
    (workspace) =>
      setSessionTitleInSimpleWorkspace(workspace, reference.sessionId, requestedTitle, {
        titleSource: shouldGenerateTitle ? "generated" : "user",
      }).snapshot,
  );
  const nativeSessionId = nativeSessionIdForProjectSidebarSession(
    reference.project.projectId,
    reference.sessionId,
  );
  const normalizedRenameTitle = normalizeTerminalTitle(requestedTitle) ?? requestedTitle;
  const agentName = terminalState?.agentName ?? session.agentName;
  appendSessionTitleRenameTraceDebugLog("nativeSidebar.renameSession.titleStored", {
    agentName,
    nativeSessionId,
    normalizedRenameTitleLength: normalizedRenameTitle.length,
    normalizedRenameTitlePreview: summarizeTerminalText(normalizedRenameTitle),
    projectId: reference.project.projectId,
    requestedSessionId: sessionId,
    requestedTitleLength: requestedTitle.length,
    requestedTitlePreview: summarizeTerminalText(requestedTitle),
    resolvedSessionId: reference.sessionId,
    source,
    titleSource: shouldGenerateTitle ? "generated" : "user",
  });
  if (!agentName?.trim()) {
    /**
     * CDXC:SidebarRename 2026-05-11-12:37
     * Plain terminal sessions can be renamed in ghostex without an Agent CLI.
     * Do not stage `/rename <title>` into those shells; only agent-backed
     * terminals should receive an in-terminal rename command.
     */
    appendSessionTitleRenameTraceDebugLog("terminalRenameCommand.skipped", {
      nativeSessionId,
      reason: "no-agent-associated",
      requestedSessionId: sessionId,
      requestedTitleLength: requestedTitle.length,
      requestedTitlePreview: summarizeTerminalText(requestedTitle),
      resolvedSessionId: reference.sessionId,
      sessionAgentName: session.agentName,
      source,
      terminalStateAgentName: terminalState?.agentName,
    });
    appendSessionTitleDebugLog("terminalRenameCommand.skipped", {
      nativeSessionId,
      reason: "no-agent-associated",
      requestedTitle,
      sessionId: reference.sessionId,
      source,
    });
    publish();
    return;
  }
  const isPiSession = resolveNativeResumeAgentId(agentName) === "pi";
  const commandText = isPiSession
    ? `/name ${normalizedRenameTitle}`
    : `/rename ${normalizedRenameTitle}`;
  appendSessionTitleRenameTraceDebugLog("terminalRenameCommand.writeSubmitting", {
    agentName,
    commandPreview: summarizeTerminalText(commandText),
    commandTextLength: commandText.length,
    isPiSession,
    nativeSessionId,
    projectId: reference.project.projectId,
    requestedSessionId: sessionId,
    resolvedSessionId: reference.sessionId,
    source,
  });
  /**
   * CDXC:SidebarRename 2026-04-28-15:49
   * Manual sidebar renames for agent-backed terminals in the native app must
   * match the reference controller flow: persist the card title, stage
   * `/rename <title>` in the targeted terminal, then submit through the native
   * Enter path so the Agent CLI thread name changes instead of only the
   * sidebar label changing.
   *
   * CDXC:PiAgent 2026-05-08-09:42
   * Pi uses `/name <title>` for session naming. Native manual renames must
   * stage that command for Pi panes while keeping Codex/Claude on `/rename`.
   */
  postNative({ sessionId: nativeSessionId, text: commandText, type: "writeTerminalText" });
  appendSessionTitleRenameTraceDebugLog("terminalRenameCommand.writeSubmitted", {
    agentName,
    commandPreview: summarizeTerminalText(commandText),
    commandTextLength: commandText.length,
    nativeSessionId,
    requestedSessionId: sessionId,
    resolvedSessionId: reference.sessionId,
    source,
  });
  window.setTimeout(() => {
    appendSessionTitleRenameTraceDebugLog("terminalRenameCommand.enterSubmitting", {
      nativeSessionId,
      requestedSessionId: sessionId,
      resolvedSessionId: reference.sessionId,
      source,
    });
    postNative({ sessionId: nativeSessionId, type: "sendTerminalEnter" });
    appendSessionTitleRenameTraceDebugLog("terminalRenameCommand.enterSubmitted", {
      nativeSessionId,
      requestedSessionId: sessionId,
      resolvedSessionId: reference.sessionId,
      source,
    });
    appendSessionTitleDebugLog("terminalRenameCommand.sent", {
      commandText,
      nativeSessionId,
      requestedTitle,
      sessionId: reference.sessionId,
      source,
    });
  }, AUTO_SUBMIT_STAGED_RENAME_DELAY_MS);
  publish();
}

function stopNativeSleepingSessionRuntime(sessionId: string, project = activeProject()): void {
  const nativeSessionId = forgetNativeSessionMappingForProject(project.projectId, sessionId);
  clearNativeSidebarCommandSessionBySessionId(sessionId);
  terminalStateById.delete(sessionId);
  titleDerivedActivityBySessionId.delete(sessionId);
  nativeActivitySuppressedUntilBySessionId.delete(sessionId);
  nativeWorkingStartedAtBySessionId.delete(sessionId);
  clearNativeSessionAttentionTracking(sessionId);
  /**
   * CDXC:SessionSleep 2026-05-17-01:33:
   * Sleeping must release the actual agent CLI, not only detach the Ghostty view.
   * Close the tmux/zmx/zellij provider session too; wake recreates the provider
   * session and runs the stored agent resume command when the sidebar has a
   * restorable identity.
   */
  postNative({ sessionId: nativeSessionId, type: "closeTerminal" });
}

function setNativeSessionSleeping(sessionId: string, sleeping: boolean): void {
  const reference = resolveSidebarSessionReference(sessionId);
  const session = findTerminalSessionInProject(reference.project, reference.sessionId);
  if (!session) {
    return;
  }
  updateProjectWorkspace(
    reference.project.projectId,
    (workspace) =>
      setSessionSleepingInSimpleWorkspace(workspace, reference.sessionId, sleeping).snapshot,
  );
  if (sleeping) {
    stopNativeSleepingSessionRuntime(reference.sessionId, reference.project);
  } else if (!terminalStateById.has(reference.sessionId)) {
    const nextSession = findTerminalSessionInProject(reference.project, reference.sessionId);
    if (nextSession) {
      restoreNativeTerminalSession(reference.project, nextSession, "wake-session");
    }
  }
  publish();
}

function sleepInactiveSessionsFromTitlebar(sessionIds: string[]): void {
  const thresholdTime = Date.now() - 7 * 60 * 1_000;
  /**
   * CDXC:TitlebarResources 2026-05-16-19:53:
   * The titlebar sleep shortcut may be clicked from stale dropdown data, so the
   * sidebar revalidates each target against current project/session state.
   * Sleep only idle, awake agent terminals older than seven minutes and never
   * sleep sessions that are currently working or requesting attention.
   */
  for (const sessionId of Array.from(new Set(sessionIds))) {
    const reference = resolveSidebarSessionReference(sessionId);
    const session = findTerminalSessionInProject(reference.project, reference.sessionId);
    if (!session || session.kind !== "terminal" || session.isSleeping === true) {
      continue;
    }
    const projectedSession = createProjectedSidebarGroupsForProject(reference.project)
      .flatMap((group) => group.sessions)
      .find((candidate) => candidate.sessionId === reference.sessionId);
    const terminalState = terminalStateById.get(reference.sessionId);
    const activity = projectedSession?.activity ?? terminalState?.activity ?? "idle";
    if (activity === "working" || activity === "attention") {
      continue;
    }
    const agentName = terminalState?.agentName ?? session.agentName;
    if (!agentName?.trim()) {
      continue;
    }
    const lastInteractionTime = Date.parse(
      projectedSession?.lastInteractionAt ?? terminalState?.lastActivityAt ?? session.createdAt,
    );
    if (!Number.isFinite(lastInteractionTime) || lastInteractionTime >= thresholdTime) {
      continue;
    }
    setNativeSessionSleeping(sessionId, true);
  }
}

function setNativeSessionPoppedOut(sessionId: string, poppedOut: boolean): void {
  const reference = resolveSidebarSessionReference(sessionId);
  const session = findSessionRecordInProject(reference.project, reference.sessionId);
  if (!session || session.isSleeping === true) {
    return;
  }
  updateProjectWorkspace(
    reference.project.projectId,
    (workspace) =>
      setSessionPoppedOutInSimpleWorkspace(workspace, reference.sessionId, poppedOut).snapshot,
  );
  /**
   * CDXC:PanePopOut 2026-05-11-09:35
   * The sidebar owns the persisted pop-out flag while Swift owns native window
   * reparenting. Publish immediately so closing the pop-out window or pressing
   * the in-pane reattach button sends one authoritative layout sync.
   */
  publish();
}

function setNativeGroupSleeping(groupId: string, sleeping: boolean): void {
  const group = activeProject().workspace.groups.find((candidate) => candidate.groupId === groupId);
  if (!group) {
    return;
  }
  const sessionsToSleep = sleeping
    ? group.snapshot.sessions.filter(
        (session): session is TerminalSessionRecord =>
          session.kind === "terminal" && session.isSleeping !== true,
      )
    : [];
  updateActiveProjectWorkspace(
    (workspace) =>
      setGroupSleepingInSimpleWorkspace(
        workspace,
        groupId,
        sleeping,
        sleeping ? sessionsToSleep.map((session) => session.sessionId) : undefined,
      ).snapshot,
  );
  if (sleeping) {
    for (const session of sessionsToSleep) {
      stopNativeSleepingSessionRuntime(session.sessionId);
    }
  } else {
    const nextGroup = activeProject().workspace.groups.find(
      (candidate) => candidate.groupId === groupId,
    );
    for (const session of nextGroup?.snapshot.sessions ?? []) {
      if (session.kind === "terminal" && !terminalStateById.has(session.sessionId)) {
        restoreNativeTerminalSession(activeProject(), session, "wake-group");
      }
    }
  }
  publish();
}

function restartNativeSession(sessionId: string): void {
  const reference = resolveSidebarSessionReference(sessionId);
  const session = findTerminalSessionInProject(reference.project, reference.sessionId);
  const groupId = findSessionGroupId(sessionId);
  if (!session) {
    return;
  }
  const initialInput = buildNativeRestoredTerminalInitialInput(session);
  if (!initialInput.trim()) {
    showNativeMessage(
      "info",
      "Full reload is only available for Codex, Claude, OpenCode, and Pi sessions with a restorable identity.",
    );
    return;
  }
  /**
   * CDXC:SessionRestore 2026-04-27-08:04
   * Right-click Full reload follows agent-tiler semantics in native ghostex:
   * recreate the terminal as the same agent type, then immediately send the
   * agent-specific resume command instead of opening a fresh shell.
   */
  if (activeProjectId !== reference.project.projectId) {
    focusProject(reference.project.projectId);
  }
  const sessionPersistenceProvider = resolveTerminalSessionPersistenceProvider();
  if (reference.project.isChat === true) {
    closeTerminal(reference.sessionId, { preservePersistenceSession: true });
    createTerminal(
      session.title || DEFAULT_TERMINAL_SESSION_TITLE,
      initialInput,
      groupId,
      session.agentName,
      {
        sessionPersistenceName: sessionPersistenceNameForProvider(
          sessionPersistenceProvider,
          session,
        ),
        sessionPersistenceProvider,
      },
    );
    return;
  }
  const nativeSessionId = forgetNativeSessionMappingForProject(
    reference.project.projectId,
    reference.sessionId,
  );
  /**
   * CDXC:SessionRestore 2026-05-15-03:23:
   * Reload Session must replace the clicked terminal in its existing pane/tab
   * slot. Create the replacement while the original session is still present
   * so paneLayout can swap the target leaf/tab member instead of appending the
   * reloaded terminal as a new split pane after close removes the placement
   * anchor.
   */
  const replacementSession = createTerminal(
    session.title || DEFAULT_TERMINAL_SESSION_TITLE,
    initialInput,
    groupId,
    session.agentName,
    {
      sessionPersistenceName: sessionPersistenceNameForProvider(
        sessionPersistenceProvider,
        session,
      ),
      sessionPersistenceProvider,
      visiblePlacement: { kind: "replace", targetSessionId: reference.sessionId },
    },
  );
  if (!replacementSession) {
    rememberNativeSessionMapping(reference.project.projectId, reference.sessionId);
    return;
  }
  clearNativeSidebarCommandSessionBySessionId(reference.sessionId);
  terminalStateById.delete(reference.sessionId);
  titleDerivedActivityBySessionId.delete(reference.sessionId);
  nativeActivitySuppressedUntilBySessionId.delete(reference.sessionId);
  nativeWorkingStartedAtBySessionId.delete(reference.sessionId);
  clearNativeSessionAttentionTracking(reference.sessionId);
  nativeAttentionNotificationLastSentAtBySessionId.delete(reference.sessionId);
  clearDelayedSendTimer(reference.sessionId);
  updateProjectWorkspace(
    reference.project.projectId,
    (workspace) => removeSessionInSimpleWorkspace(workspace, reference.sessionId).snapshot,
  );
  postNative({ preservePersistenceSession: true, sessionId: nativeSessionId, type: "closeTerminal" });
  publish();
}

function forkNativeSession(sessionId: string): void {
  const reference = resolveSidebarSessionReference(sessionId);
  const session = findTerminalSessionInProject(reference.project, reference.sessionId);
  const groupId = findSessionGroupId(sessionId);
  if (!session) {
    return;
  }
  if (!canRestoreNativeTerminalSession(session)) {
    showNativeMessage(
      "info",
      "Fork is only available for Codex, Claude, OpenCode, and Pi sessions with a restorable identity.",
    );
    return;
  }
  if (activeProjectId !== reference.project.projectId) {
    focusProject(reference.project.projectId);
  }
  const agentId = resolveNativeResumeAgentId(session.agentName);
  const forkCommand =
    agentId === "pi"
      ? buildNativePiForkCommand(session)
      : agentId === "codex"
        ? buildNativeCodexForkCommand(session)
        : agentId === "claude"
          ? buildNativeClaudeForkCommand(session)
          : undefined;
  const sessionPersistenceProvider = forkCommand
    ? resolveTerminalSessionPersistenceProvider()
    : undefined;
  const targetGroup = reference.project.workspace.groups.find((group) => group.groupId === groupId);
  const visiblePlacement: VisibleSessionPlacement | undefined =
    targetGroup?.snapshot.visibleSessionIds.includes(reference.sessionId) === true
      ? { kind: "appendToTabGroup", targetSessionId: reference.sessionId }
      : createFocusedTabGroupPlacement(groupId);
  /**
   * CDXC:PaneTabs 2026-05-11-18:13
   * Forking from a title-bar or sidebar session is a tab creation action, not a
   * layout rebuild. Attach the fork to the clicked session's existing tab group
   * so fork cannot flatten grouped tabs into one-tab split panes.
   */
  appendPaneLayoutTraceDebugLog("forkSession.placementResolved", {
    activeProjectId,
    groupId,
    projectId: reference.project.projectId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(reference.project.workspace, groupId),
    targetSessionId: reference.sessionId,
    visiblePlacement: summarizeVisiblePlacement(visiblePlacement),
  });
  createTerminal(
    `${session.title || DEFAULT_TERMINAL_SESSION_TITLE} Fork`,
    forkCommand ? `${forkCommand}\r` : "",
    groupId,
    forkCommand ? session.agentName : undefined,
    {
      sessionPersistenceName: sessionPersistenceNameForProvider(
        sessionPersistenceProvider,
        session,
      ),
      sessionPersistenceProvider,
      visiblePlacement,
    },
  );
}

function promptDelayedSend(sessionId: string): void {
  const session = findSessionRecord(sessionId);
  if (!session || session.kind !== "terminal") {
    return;
  }
  openAppModal({
    modal: "delayedSend",
    sessionId,
    title: session.title || DEFAULT_TERMINAL_SESSION_TITLE,
    type: "open",
  });
}

function scheduleDelayedSend(sessionId: string, delayMs: number): void {
  const session = findSessionRecord(sessionId);
  if (!session || session.kind !== "terminal") {
    showNativeMessage("info", "Delayed Send is only available for terminal sessions.");
    return;
  }
  if (!Number.isFinite(delayMs) || delayMs <= 0 || delayMs > DELAYED_SEND_MAX_DELAY_MS) {
    showNativeMessage("warning", "Choose a Delayed Send timer between 1 second and 24 days.");
    return;
  }

  const existingTimeout = delayedSendTimeoutBySessionId.get(sessionId);
  if (existingTimeout !== undefined) {
    window.clearTimeout(existingTimeout);
  }

  /**
   * CDXC:DelayedSend 2026-05-11-11:56
   * Delayed Send must press Enter in the existing terminal after the requested
   * wait, so use the native sendTerminalEnter command instead of writing a
   * carriage return as terminal text.
   */
  const timeout = window.setTimeout(() => {
    delayedSendTimeoutBySessionId.delete(sessionId);
    const currentSession = findSessionRecord(sessionId);
    if (!currentSession || currentSession.kind !== "terminal" || currentSession.isSleeping === true) {
      return;
    }
    postNative({
      sessionId: nativeSessionIdForSidebarSession(sessionId),
      type: "sendTerminalEnter",
    });
  }, delayMs);

  delayedSendTimeoutBySessionId.set(sessionId, timeout);
  showNativeMessage("info", `Delayed Send will press Enter in ${formatDelayedSendDelay(delayMs)}.`);
}

function clearDelayedSendTimer(sessionId: string): void {
  const timeout = delayedSendTimeoutBySessionId.get(sessionId);
  if (timeout === undefined) {
    return;
  }
  window.clearTimeout(timeout);
  delayedSendTimeoutBySessionId.delete(sessionId);
}

function formatDelayedSendDelay(delayMs: number): string {
  const totalSeconds = Math.max(1, Math.round(delayMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    hours > 0 ? `${hours}h` : undefined,
    minutes > 0 ? `${minutes}m` : undefined,
    seconds > 0 ? `${seconds}s` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ") || "1s";
}

function findSidebarSessionForCli(
  selector: NativeCliSessionSelector,
): SidebarSessionItem | undefined {
  const sidebarMessage = buildSidebarMessage();
  const sessions = sidebarMessage.groups.flatMap((group) => group.sessions);
  if (selector.sessionId) {
    return sessions.find((session) => session.sessionId === selector.sessionId);
  }
  if (typeof selector.sessionNumber === "number") {
    return sessions.find((session) => session.sessionNumber === selector.sessionNumber);
  }
  if (typeof selector.index === "number") {
    return sessions[selector.index];
  }
  const focusedSessionId = activeSnapshot().focusedSessionId;
  return focusedSessionId
    ? sessions.find((session) => session.sessionId === focusedSessionId)
    : sessions[0];
}

function listNativeCliSessions(): NativeCliSessionListItem[] {
  const items: NativeCliSessionListItem[] = [];
  const orderedProjects = orderNativeProjectsForSidebar(projects).filter(
    (project) => project.isRecentProject !== true,
  );
  for (const project of orderedProjects) {
    for (const group of project.workspace.groups) {
      const projectedSessionsById = new Map(
        createProjectedSidebarSessionsForGroup(group).map((session) => [session.sessionId, session]),
      );
      for (const session of group.snapshot.sessions) {
        if (session.kind !== "terminal") {
          continue;
        }
        const projectedSession = projectedSessionsById.get(session.sessionId);
        const terminalState = terminalStateById.get(session.sessionId);
        const provider =
          terminalState?.sessionPersistenceProvider ??
          session.sessionPersistenceProvider ??
          (session.tmuxSessionName ? "tmux" : undefined);
        const providerSessionName =
          terminalState?.sessionPersistenceName ??
          session.sessionPersistenceName ??
          session.tmuxSessionName;
        const status = getNativeCliSessionStatus(session, projectedSession, terminalState);
        /**
         * CDXC:CliSessions 2026-05-07-21:22
         * The human CLI session area needs one stable live-session inventory
         * from the sidebar runtime. It includes global aliases, project context,
         * activity, provider attach commands, and agent resume commands so the
         * Node CLI can render tables and exec the correct local command without
         * scraping debug state.
         */
        items.push({
          agent: terminalState?.agentName ?? session.agentName,
          alias: items.length + 1,
          attachCommand:
            provider && providerSessionName && status !== "sleep"
              ? buildNativeCliAttachCommand(provider, providerSessionName)
              : undefined,
          groupId: group.groupId,
          groupTitle: group.title,
          isFocused: group.snapshot.focusedSessionId === session.sessionId,
          isVisible: Boolean(projectedSession?.isVisible),
          lastInteractionAt:
            projectedSession?.lastInteractionAt ?? terminalState?.lastActivityAt ?? session.createdAt,
          projectId: project.projectId,
          projectName: project.name,
          projectPath: project.path,
          provider,
          providerSessionName,
          resumeCommand: buildNativeCopyResumeCommand(session),
          sessionId: createCombinedProjectSessionId(project.projectId, session.sessionId),
          status,
          title:
            projectedSession?.primaryTitle ??
            getSessionCardPrimaryTitle(session) ??
            session.title ??
            DEFAULT_TERMINAL_SESSION_TITLE,
        });
      }
    }
  }
  return items;
}

function getNativeCliSessionStatus(
  session: TerminalSessionRecord,
  projectedSession: SidebarSessionItem | undefined,
  terminalState:
    | {
        activity: "attention" | "idle" | "working";
        lifecycleState: "done" | "error" | "running" | "sleeping";
      }
    | undefined,
): NativeCliSessionListItem["status"] {
  if (session.isSleeping === true || terminalState?.lifecycleState === "sleeping") {
    return "sleep";
  }
  if (terminalState?.lifecycleState === "error") {
    return "error";
  }
  if (terminalState?.lifecycleState === "done") {
    return "done";
  }
  return projectedSession?.activity ?? terminalState?.activity ?? "idle";
}

function buildNativeCliAttachCommand(
  provider: TerminalSessionPersistenceProvider,
  sessionName: string,
): string {
  const quotedName = quoteNativeShellArg(sessionName);
  switch (provider) {
    case "tmux":
      return `tmux attach-session -t ${quotedName}`;
    case "zmx":
      return `zmx attach ${quotedName}`;
    case "zellij":
      return `zellij attach ${quotedName}`;
  }
}

function requireCliSession(payload: Record<string, unknown>): SidebarSessionItem {
  const session = findSidebarSessionForCli({
    index: typeof payload.index === "number" ? payload.index : undefined,
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    sessionNumber: typeof payload.sessionNumber === "number" ? payload.sessionNumber : undefined,
  });
  if (!session) {
    throw new Error("No matching session was found.");
  }
  return session;
}

function terminalTextForCliKey(key: unknown): string | undefined {
  switch (String(key)) {
    case "ctrl-c":
    case "Control+C":
      return "\u0003";
    case "escape":
    case "Escape":
      return "\u001b";
    case "tab":
    case "Tab":
      return "\t";
    case "arrow-up":
    case "ArrowUp":
      return "\u001b[A";
    case "arrow-down":
    case "ArrowDown":
      return "\u001b[B";
    case "arrow-right":
    case "ArrowRight":
      return "\u001b[C";
    case "arrow-left":
    case "ArrowLeft":
      return "\u001b[D";
    default:
      return undefined;
  }
}

function summarizeCliState() {
  const sidebarMessage = buildSidebarMessage();
  return {
    activeProjectId,
    projects: projects.map((project) => ({
      activeGroupId: project.workspace.activeGroupId,
      groupCount: project.workspace.groups.length,
      isActive: project.projectId === activeProjectId,
      name: project.name,
      path: project.path,
      projectId: project.projectId,
    })),
    revision,
    sidebar: {
      groups: sidebarMessage.groups,
      hud: sidebarMessage.hud,
      previousSessions,
    },
    terminalStates: Object.fromEntries(
      [...terminalStateById.entries()].map(([sessionId, state]) => [
        sessionId,
        {
          ...state,
          nativeSessionId: nativeSessionIdForSidebarSession(sessionId),
        },
      ]),
    ),
  };
}

function assertCliSidebarCard(payload: Record<string, unknown>) {
  const session = requireCliSession(payload);
  const sessionReference = resolveSidebarSessionReference(session.sessionId);
  const terminalState = terminalStateById.get(sessionReference.sessionId);
  const failures: string[] = [];
  const expectedAgentIcon = typeof payload.agentIcon === "string" ? payload.agentIcon : undefined;
  const expectedAgentName = typeof payload.agentName === "string" ? payload.agentName : undefined;
  const expectedVisible = typeof payload.visible === "boolean" ? payload.visible : undefined;
  if (expectedAgentIcon !== undefined && session.agentIcon !== expectedAgentIcon) {
    failures.push(
      `agentIcon expected ${expectedAgentIcon}, received ${session.agentIcon ?? "<empty>"}`,
    );
  }
  if (expectedAgentName !== undefined && terminalState?.agentName !== expectedAgentName) {
    failures.push(
      `agentName expected ${expectedAgentName}, received ${terminalState?.agentName ?? "<empty>"}`,
    );
  }
  if (expectedVisible !== undefined && session.isVisible !== expectedVisible) {
    failures.push(`visible expected ${expectedVisible}, received ${session.isVisible}`);
  }
  return {
    failures,
    ok: failures.length === 0,
    session,
    terminalState,
  };
}

async function waitForCliSidebarCard(payload: Record<string, unknown>) {
  const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 5_000;
  const intervalMs = typeof payload.intervalMs === "number" ? payload.intervalMs : 200;
  const startedAt = Date.now();
  let result = assertCliSidebarCard(payload);
  while (!result.ok && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    result = assertCliSidebarCard(payload);
  }
  return {
    ...result,
    elapsedMs: Date.now() - startedAt,
  };
}

function runCliAgent(agentId: string, groupId?: string): SessionRecord | undefined {
  const agent = agents.find((candidate) => candidate.agentId === agentId);
  if (!agent?.command) {
    throw new Error(`Unknown or unconfigured agent: ${agentId}`);
  }
  if (agent.agentId === "t3") {
    return createNativeT3Session(groupId);
  }
  return createTerminal(
    createAgentSessionDefaultTitle(agent.name),
    `${agent.command}\r`,
    groupId,
    agent.agentId,
  );
}

/**
 * CDXC:PreviousSessions 2026-04-28-05:12
 * Native ghostex must mirror the reference Prompt to Find Session workflow:
 * receive the modal's remembered-topic query, launch a terminal Codex session,
 * rename that helper session, then stage the local-session search prompt.
 */
function promptFindPreviousSession(queryInput?: string): void {
  const query = queryInput?.trim();
  appendAgentDetectionDebugLog("nativeSidebar.promptFindPreviousSession.received", {
    hasQuery: Boolean(query),
    queryLength: query?.length ?? 0,
  });
  if (!query) {
    showNativeMessage("info", "Type what you remember in the Previous Sessions search field.");
    return;
  }

  const agent = resolveFindPreviousSessionAgent();
  if (!agent) {
    appendAgentDetectionDebugLog("nativeSidebar.promptFindPreviousSession.missingAgent", {
      requestedAgentId: FIND_PREVIOUS_SESSION_AGENT_ID,
    });
    showNativeMessage(
      "info",
      "Ghostex could not find Codex for Find a session. Restore the Codex agent button.",
    );
    return;
  }

  const session = createTerminal(
    createAgentSessionDefaultTitle(agent.name),
    `${agent.command}\r`,
    undefined,
    agent.agentId,
  );
  if (!session) {
    appendAgentDetectionDebugLog("nativeSidebar.promptFindPreviousSession.createSessionFailed", {
      agentId: agent.agentId,
      queryLength: query.length,
    });
    return;
  }

  const prompt = renderFindPreviousSessionPrompt(
    DEFAULT_FIND_PREVIOUS_SESSION_PROMPT_TEMPLATE,
    query,
  );
  window.setTimeout(() => {
    const nativeSessionId = nativeSessionIdForSidebarSession(session.sessionId);
    /**
     * CDXC:PreviousSessions 2026-05-07-16:02
     * The Find Session button crosses React, the modal-host WebKit bridge, and
     * native sidebar command dispatch before terminal input is written. Keep
     * debug breadcrumbs at session creation and prompt staging so Computer Use
     * repros can identify the exact boundary that stopped the action.
     */
    appendAgentDetectionDebugLog("nativeSidebar.promptFindPreviousSession.stagingPrompt", {
      agentId: agent.agentId,
      nativeSessionId,
      queryLength: query.length,
      sessionId: session.sessionId,
    });
    postNative({
      sessionId: nativeSessionId,
      text: `/rename Search: ${query}`,
      type: "writeTerminalText",
    });
    postNative({ sessionId: nativeSessionId, type: "sendTerminalEnter" });
    postNative({ sessionId: nativeSessionId, text: prompt, type: "writeTerminalText" });
  }, FIND_PREVIOUS_SESSION_AGENT_STAGING_DELAY_MS);
}

function resolveFindPreviousSessionAgent(): SidebarAgentButton | undefined {
  return (
    agents.find((candidate) => candidate.agentId === FIND_PREVIOUS_SESSION_AGENT_ID) ??
    createSidebarAgentButtons(storedAgents, storedAgentOrder).find(
      (candidate) => candidate.agentId === FIND_PREVIOUS_SESSION_AGENT_ID,
    ) ??
    createSidebarAgentButtons([], []).find(
      (candidate) => candidate.agentId === FIND_PREVIOUS_SESSION_AGENT_ID,
    )
  );
}

function runCliCommandButton(commandId: string): TerminalSessionRecord | undefined {
  const command = commands.find((candidate) => candidate.commandId === commandId);
  if (!command) {
    throw new Error(`Unknown command button: ${commandId}`);
  }
  if (command.actionType === "browser" && command.url) {
    openNativeBrowserWindow(command.url);
    return undefined;
  }
  if (!command.command) {
    throw new Error(`Command button is not configured: ${commandId}`);
  }
  return runNativeSidebarCommand(command);
}

function getNativeSidebarCommandSessionTitle(command: SidebarCommandButton): string {
  const normalizedActionName = command.name.trim();
  return normalizedActionName.length > 0
    ? normalizedActionName
    : (command.command ?? "").trim().slice(0, 20);
}

function normalizeNativeSidebarCommandTitle(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : undefined;
}

function getNativeSidebarCommandTitleKey(value: string | undefined): string {
  return normalizeNativeSidebarCommandTitle(value)?.toLocaleLowerCase() ?? "";
}

function getNativeSidebarActionTitle(
  command: Pick<SidebarCommandButton, "command" | "name" | "url">,
): string {
  const normalizedActionName = normalizeNativeSidebarCommandTitle(command.name);
  if (normalizedActionName) {
    return normalizedActionName;
  }
  const target = normalizeNativeSidebarCommandTitle(command.command ?? command.url);
  return target?.slice(0, 20) ?? "";
}

function getNativeSidebarCommandExecutionText(
  command: string,
  closeOnExit: boolean,
  runId: string,
): string {
  /**
   * CDXC:CommandPanes 2026-05-16-07:29:
   * Command-pane tabs need activity based on the submitted action lifecycle,
   * not agent title parsing. Wrap sidebar action text in a shell function and
   * stamp the session-state file after the function returns so persistent
   * command panes can clear the yellow native tab dot without closing.
   */
  return [
    "__ghostex_command_pane_action() {",
    command,
    "}",
    getNativeSidebarCommandStatusStampText("working", runId, "0"),
    "__ghostex_command_pane_action",
    "__ghostex_exit=$?",
    "unset -f __ghostex_command_pane_action",
    getNativeSidebarCommandStatusStampText("idle", runId, "$__ghostex_exit"),
    closeOnExit ? 'exit "$__ghostex_exit"' : "",
  ].filter(Boolean).join("\n");
}

function getNativeSidebarCommandStatusStampText(
  status: "idle" | "working",
  runId: string,
  exitCode: string,
): string {
  return [
    "__ghostex_session_state_file=\"${GHOSTEX_SESSION_STATE_FILE:-${VSMUX_SESSION_STATE_FILE:-$ghostex_SESSION_STATE_FILE}}\"",
    'if [ -n "$__ghostex_session_state_file" ]; then',
    `  /usr/bin/python3 - "$__ghostex_session_state_file" ${quoteNativeShellArg(status)} ${quoteNativeShellArg(runId)} ${exitCode} <<'GHOSTEX_COMMAND_PANE_STATUS'`,
    "import datetime",
    "import pathlib",
    "import sys",
    "",
    "state_path = pathlib.Path(sys.argv[1])",
    "status = sys.argv[2]",
    "run_id = sys.argv[3]",
    "exit_code = sys.argv[4]",
    "state = {}",
    "order = []",
    "try:",
    "    for line in state_path.read_text(encoding='utf-8').splitlines():",
    "        key, separator, value = line.partition('=')",
    "        if separator:",
    "            state[key] = value",
    "            if key not in order:",
    "                order.append(key)",
    "except FileNotFoundError:",
    "    pass",
    "",
    "state['status'] = status",
    "state['commandRunId'] = run_id",
    "state['commandExitCode'] = exit_code",
    "state['lastActivityAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')",
    "for key in ['status', 'commandRunId', 'commandExitCode', 'lastActivityAt']:",
    "    if key not in order:",
    "        order.append(key)",
    "state_path.parent.mkdir(parents=True, exist_ok=True)",
    "temp_path = state_path.with_suffix(state_path.suffix + '.tmp')",
    "temp_path.write_text(''.join(f'{key}={state.get(key, \"\")}\\n' for key in order), encoding='utf-8')",
    "temp_path.replace(state_path)",
    "GHOSTEX_COMMAND_PANE_STATUS",
    "fi",
  ].join("\n");
}

function createNativeSidebarCommandRunId(commandId: string): string {
  return `${commandId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function postNativeSidebarCommandRunState(
  commandId: string,
  runId: string,
  state: "error" | "running" | "success",
): void {
  sidebarBus.post({
    commandId,
    runId,
    state,
    type: "sidebarCommandRunStateChanged",
  });
}

function clearNativeSidebarCommandRunState(commandId: string): void {
  sidebarBus.post({
    commandId,
    type: "sidebarCommandRunStateCleared",
  });
}

function playNativeSidebarActionCompletionSound(sessionId?: string): void {
  /**
   * CDXC:NativeActions 2026-04-29-16:30
   * Terminal action completion sounds are per-command feedback and use the
   * action completion sound, independent of the global session completion
   * bell toggle.
   */
  appendAgentDetectionDebugLog("nativeSidebar.completionSound.action", {
    sessionId,
    sound: settings.actionCompletionSound,
  });
  playNativeSound(settings.actionCompletionSound);
}

function setNativeSidebarCommandSession(
  command: SidebarCommandButton,
  sessionId: string,
  closeOnExit: boolean,
  runId?: string,
): void {
  const existingSession = sidebarCommandSessionByCommandId.get(command.commandId);
  const commandTitle = getNativeSidebarCommandSessionTitle(command);
  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.sessionMappingStart", {
    closeOnExit,
    commandId: command.commandId,
    commandTitle,
    existingSessionId: existingSession?.sessionId,
    nextSessionId: sessionId,
    previousCommandIdForSession: sidebarCommandCommandIdBySessionId.get(sessionId),
    runId,
  });
  if (existingSession?.sessionId && existingSession.sessionId !== sessionId) {
    sidebarCommandCommandIdBySessionId.delete(existingSession.sessionId);
  }
  const previousCommandIdForSession = sidebarCommandCommandIdBySessionId.get(sessionId);
  if (previousCommandIdForSession && previousCommandIdForSession !== command.commandId) {
    const previousSession = sidebarCommandSessionByCommandId.get(previousCommandIdForSession);
    if (previousSession?.sessionId === sessionId) {
      sidebarCommandSessionByCommandId.delete(previousCommandIdForSession);
    }
  }

  sidebarCommandSessionByCommandId.set(command.commandId, {
    closeOnExit,
    commandId: command.commandId,
    commandTitle,
    playCompletionSound: command.playCompletionSound,
    runId,
    sessionId,
  });
  sidebarCommandCommandIdBySessionId.set(sessionId, command.commandId);
  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.sessionMappingDone", {
    closeOnExit,
    commandId: command.commandId,
    commandTitle,
    runId,
    sessionId,
  });
}

function clearNativeSidebarCommandSessionBySessionId(sessionId: string): void {
  const commandId = sidebarCommandCommandIdBySessionId.get(sessionId);
  if (!commandId) {
    return;
  }

  sidebarCommandCommandIdBySessionId.delete(sessionId);
  const storedSession = sidebarCommandSessionByCommandId.get(commandId);
  if (storedSession?.sessionId === sessionId) {
    sidebarCommandSessionByCommandId.delete(commandId);
  }
}

function closeNativeSidebarCommandSession(sessionId: string): void {
  clearNativeSidebarCommandSessionBySessionId(sessionId);
  closeTerminal(sessionId);
}

function markNativeSidebarCommandPaneRunStarted(sessionId: string): void {
  const terminalState = terminalStateById.get(sessionId);
  if (!terminalState) {
    return;
  }
  terminalState.activity = "working";
}

function setNativeSidebarCommandPaneTitle(sessionId: string, title: string): void {
  /**
   * CDXC:CommandPanes 2026-05-16-08:25:
   * Command-pane tabs should display the action title, not a stale shell or
   * previously mapped command title. Refresh the stored command-panel session
   * title before every run so reused tabs and native tab chrome stay aligned
   * with the current action label.
   *
   * CDXC:CommandPanes 2026-05-16-15:08:
   * The action title is also the persisted command-pane owner. Rewriting
   * commandTitle with the visible tab title keeps title-based reuse stable
   * after restart and after an action is edited.
   */
  updateActiveProjectCommandsPanel((panel) => ({
    ...panel,
    sessions: panel.sessions.map((session) =>
      session.sessionId === sessionId
        ? {
            ...session,
            commandTitle: title,
            title,
            titleSource: "user",
          }
        : session,
    ),
  }));
  const terminalState = terminalStateById.get(sessionId);
  if (terminalState) {
    terminalState.terminalTitle = title;
  }
}

function writeNativeSidebarCommandToSession(
  sessionId: string,
  command: string,
  closeOnExit: boolean,
  runId: string,
): void {
  const nativeSessionId = nativeSessionIdForSidebarSession(sessionId);
  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.writeStart", {
    closeOnExit,
    commandPreview: summarizeTerminalText(command),
    nativeSessionId,
    sessionId,
  });
  postNative({
    sessionId: nativeSessionId,
    text: getNativeSidebarCommandExecutionText(command, closeOnExit, runId),
    type: "writeTerminalText",
  });
  postNative({ sessionId: nativeSessionId, type: "sendTerminalEnter" });
  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.writeSubmitted", {
    closeOnExit,
    nativeSessionId,
    sessionId,
  });
}

function findReusableNativeSidebarCommandPane(
  command: SidebarCommandButton,
): TerminalSessionRecord | undefined {
  const existingSession = sidebarCommandSessionByCommandId.get(command.commandId);
  const commandTitle = getNativeSidebarCommandSessionTitle(command);
  const commandTitleKey = getNativeSidebarCommandTitleKey(commandTitle);
  const existingCommandSession =
    existingSession &&
    getNativeSidebarCommandTitleKey(existingSession.commandTitle) === commandTitleKey &&
    isReusableNativeSidebarCommandPane(existingSession.sessionId)
      ? findTerminalSession(existingSession.sessionId)
      : undefined;
  if (existingCommandSession) {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.reuseExistingCommandSession", {
      commandId: command.commandId,
      commandTitle,
      sessionId: existingCommandSession.sessionId,
      terminalActivity: terminalStateById.get(existingCommandSession.sessionId)?.activity,
      terminalLifecycle: terminalStateById.get(existingCommandSession.sessionId)?.lifecycleState,
    });
    return existingCommandSession;
  }

  const titleOwnedSession = findNativeSidebarCommandPaneByTitle(commandTitleKey);
  const reusableTitleOwnedSession =
    titleOwnedSession && isReusableNativeSidebarCommandPane(titleOwnedSession.sessionId)
      ? titleOwnedSession
      : undefined;
  /**
   * CDXC:CommandPanes 2026-05-16-15:08:
   * Sidebar terminal actions own one command-pane tab per action title. The
   * title key lets Ghostex reuse a pane after restart even when the in-memory
   * command-id map has not been rebuilt. Duplicate action titles are rejected
   * per project so this title ownership stays unambiguous.
   */
  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.reuseLookup", {
    commandId: command.commandId,
    commandTitle,
    commandPanelSessionCount: activeProject().commandsPanel.sessions.length,
    existingSessionId: existingSession?.sessionId,
    reusableSessionId: reusableTitleOwnedSession?.sessionId,
    titleOwnedSessionId: titleOwnedSession?.sessionId,
  });
  return reusableTitleOwnedSession;
}

function findNativeSidebarCommandPaneByTitle(
  commandTitleKey: string,
): TerminalSessionRecord | undefined {
  if (!commandTitleKey) {
    return undefined;
  }
  return activeProject().commandsPanel.sessions.find(
    (session) =>
      getNativeSidebarCommandTitleKey(session.commandTitle ?? session.title) === commandTitleKey,
  );
}

function isReusableNativeSidebarCommandPane(sessionId: string): boolean {
  if (!activeCommandPanelContainsSession(sessionId)) {
    return false;
  }
  const terminalState = terminalStateById.get(sessionId);
  return terminalState?.lifecycleState === "running" && terminalState.activity === "idle";
}

function handleNativeSidebarCommandSessionExit(
  sessionId: string,
  exitCode: number | undefined,
): void {
  const commandId = sidebarCommandCommandIdBySessionId.get(sessionId);
  if (!commandId) {
    return;
  }

  const storedSession = sidebarCommandSessionByCommandId.get(commandId);
  if (!storedSession || storedSession.sessionId !== sessionId) {
    return;
  }

  const didFail = (exitCode ?? 0) !== 0;
  const runId = storedSession.runId ?? createNativeSidebarCommandRunId(commandId);
  postNativeSidebarCommandRunState(commandId, runId, didFail ? "error" : "success");

  if (didFail || storedSession.playCompletionSound) {
    playNativeSidebarActionCompletionSound(sessionId);
  }

  if (storedSession.closeOnExit && !didFail) {
    closeNativeSidebarCommandSession(sessionId);
    return;
  }

  if (!storedSession.closeOnExit) {
    sidebarCommandSessionByCommandId.set(commandId, {
      ...storedSession,
      runId: undefined,
    });
  }
  publish();
}

/**
 * CDXC:Actions 2026-04-28-02:54
 * Native sidebar terminal actions must match the reference sidebar flow:
 * default runs open managed background terminals with button spinner/status
 * feedback, while Debug Action creates a normal visible session for inspection.
 */
function runNativeSidebarCommand(
  command: SidebarCommandButton,
  runMode: SidebarCommandRunMode = "default",
): TerminalSessionRecord | undefined {
  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.runStart", {
    actionType: command.actionType,
    closeTerminalOnExit: command.closeTerminalOnExit,
    commandId: command.commandId,
    commandPanelSessionCount: activeProject().commandsPanel.sessions.length,
    hasCommand: Boolean(command.command?.trim()),
    hasUrl: Boolean(command.url?.trim()),
    projectId: activeProject().projectId,
    projectPath: activeProject().path,
    runMode,
  });
  if (command.actionType === "browser" && command.url) {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.browserAction", {
      commandId: command.commandId,
      url: command.url,
    });
    openNativeBrowserWindow(command.url);
    return undefined;
  }
  const commandText = command.command?.trim();
  if (!commandText) {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.emptyCommand", {
      actionType: command.actionType,
      commandId: command.commandId,
    });
    return undefined;
  }

  const sessionTitle = getNativeSidebarCommandSessionTitle(command);
  if (runMode === "debug") {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.debugRun", {
      commandId: command.commandId,
      sessionTitle,
    });
    return createTerminal(`Debug: ${sessionTitle}`, `${commandText}\r`);
  }

  const existingSession = sidebarCommandSessionByCommandId.get(command.commandId);
  if (
    command.closeTerminalOnExit &&
    existingSession &&
    !isReusableNativeSidebarCommandPane(existingSession.sessionId)
  ) {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.closeExistingCloseOnExitSession", {
      commandId: command.commandId,
      existingSessionId: existingSession.sessionId,
      terminalActivity: terminalStateById.get(existingSession.sessionId)?.activity,
      terminalLifecycle: terminalStateById.get(existingSession.sessionId)?.lifecycleState,
    });
    closeNativeSidebarCommandSession(existingSession.sessionId);
  }

  const reusableSession = findReusableNativeSidebarCommandPane(command);
  if (existingSession && !reusableSession && !command.closeTerminalOnExit) {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.closeStaleCommandSession", {
      commandId: command.commandId,
      existingSessionId: existingSession.sessionId,
      terminalActivity: terminalStateById.get(existingSession.sessionId)?.activity,
      terminalLifecycle: terminalStateById.get(existingSession.sessionId)?.lifecycleState,
    });
    closeNativeSidebarCommandSession(existingSession.sessionId);
  }

  const closeOnExit = command.closeTerminalOnExit;
  const runId = createNativeSidebarCommandRunId(command.commandId);
  const executionText = getNativeSidebarCommandExecutionText(commandText, closeOnExit, runId);
  /**
   * CDXC:TitlebarActions 2026-05-15-16:58:
   * Titlebar terminal actions must execute inside the Commands panel. Reuse a
   * running command-pane terminal only when it is idle; otherwise create a
   * command-pane tab and pass the command as initial input so first-run actions
   * do not depend on a second immediate write before the native surface is
   * ready.
   */
  const session =
    reusableSession ??
    createCommandTerminal(sessionTitle, `${executionText}\r`, {
      commandTitle: sessionTitle,
      focusAfterCreate: false,
    });
  if (!session) {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.createCommandPaneFailed", {
      commandId: command.commandId,
      commandPanelSessionCount: activeProject().commandsPanel.sessions.length,
      sessionTitle,
    });
    return undefined;
  }

  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.sessionSelected", {
    closeOnExit,
    commandId: command.commandId,
    createdSession: reusableSession === undefined,
    reusableSessionId: reusableSession?.sessionId,
    runId,
    sessionId: session.sessionId,
    sessionTitle,
  });
  setNativeSidebarCommandPaneTitle(session.sessionId, sessionTitle);
  setNativeSidebarCommandSession(command, session.sessionId, closeOnExit, runId);
  markNativeSidebarCommandPaneRunStarted(session.sessionId);
  postNativeSidebarCommandRunState(command.commandId, runId, "running");
  if (reusableSession) {
    writeNativeSidebarCommandToSession(session.sessionId, commandText, closeOnExit, runId);
  }
  publish();
  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.runDone", {
    closeOnExit,
    commandId: command.commandId,
    sessionId: session.sessionId,
  });
  return session;
}

async function handleNativeCliCommand(action: string, payload: Record<string, unknown>) {
  /**
   * CDXC:DebugCli 2026-04-27-07:18
   * CLI actions are intentionally routed through the native sidebar runtime so
   * automated repros can create sessions, press sidebar buttons, send terminal
   * input, and inspect projected card state without bypassing app behavior.
   */
  try {
    switch (action) {
      case "state":
      case "dumpState":
        return { ok: true, state: summarizeCliState() };
      case "listSessions":
        return { ok: true, revision, sessions: listNativeCliSessions() };
      case "createSession": {
        const groupId = typeof payload.groupId === "string" ? payload.groupId : undefined;
        if (groupId === COMBINED_CHATS_GROUP_ID || (!groupId && activeProject().isChat === true)) {
          await createNativeChat(typeof payload.title === "string" ? payload.title : undefined);
          return { ok: true, state: summarizeCliState() };
        }
        const session = createTerminal(
          typeof payload.title === "string" ? payload.title : DEFAULT_TERMINAL_SESSION_TITLE,
          typeof payload.input === "string" ? payload.input : "",
          groupId,
        );
        return { ok: true, session, state: summarizeCliState() };
      }
      case "createChat":
        await createNativeChat(typeof payload.title === "string" ? payload.title : undefined);
        return { ok: true, state: summarizeCliState() };
      case "createAgentSession":
      case "runAgent": {
        const agentId = typeof payload.agentId === "string" ? payload.agentId : "";
        const session = runCliAgent(
          agentId,
          typeof payload.groupId === "string" ? payload.groupId : undefined,
        );
        return { ok: true, session, state: summarizeCliState() };
      }
      case "runCommand": {
        const session = runCliCommandButton(String(payload.commandId ?? ""));
        return { ok: true, session, state: summarizeCliState() };
      }
      case "clickButton": {
        const kind = String(payload.kind ?? "");
        const id = String(payload.id ?? "");
        if (kind === "agent") {
          return { ok: true, session: runCliAgent(id), state: summarizeCliState() };
        }
        if (kind === "command") {
          return { ok: true, session: runCliCommandButton(id), state: summarizeCliState() };
        }
        if (kind === "section") {
          const section = id as SidebarCollapsibleSection;
          setSidebarSectionCollapsed(section, !collapsedSections[section]);
          return { ok: true, state: summarizeCliState() };
        }
        if (kind === "projectEditor") {
          /**
           * CDXC:DebugCli 2026-05-08-13:13
           * Crash repros need to open the same project-owned VS Code surface
           * as the sidebar button before Computer Use drags the native sidebar
           * divider. Route the CLI button action through the real group command
           * instead of constructing native editor commands by hand.
           */
          openProjectEditorForGroup(id);
          return { ok: true, state: summarizeCliState() };
        }
        throw new Error(`Unsupported button kind: ${kind}`);
      }
      case "focusSession": {
        const session = requireCliSession(payload);
        focusSidebarSession(session.sessionId);
        return { ok: true, session, state: summarizeCliState() };
      }
      case "focusGroup": {
        const groupReference = resolveSidebarGroupReference(String(payload.groupId));
        const groupId = groupReference.groupId;
        if (!groupId) {
          focusProject(groupReference.project.projectId);
          return { ok: true, state: summarizeCliState() };
        }
        updateProjectWorkspace(
          groupReference.project.projectId,
          (workspace) => focusGroupInSimpleWorkspace(workspace, groupId).snapshot,
        );
        publish();
        return { ok: true, state: summarizeCliState() };
      }
      case "switchProject": {
        const project = projects.find(
          (candidate) =>
            candidate.projectId === payload.projectId ||
            candidate.path === payload.path ||
            candidate.name === payload.name,
        );
        if (!project) {
          throw new Error("No matching project was found.");
        }
        focusProject(project.projectId);
        return { ok: true, state: summarizeCliState() };
      }
      case "addProject":
        addProject(
          String(payload.path),
          typeof payload.name === "string" ? payload.name : undefined,
        );
        return { ok: true, state: summarizeCliState() };
      case "closeSession": {
        const session = requireCliSession(payload);
        closeTerminal(session.sessionId);
        return { ok: true, state: summarizeCliState() };
      }
      case "restartSession": {
        const session = requireCliSession(payload);
        restartNativeSession(session.sessionId);
        return { ok: true, state: summarizeCliState() };
      }
      case "forkSession": {
        const session = requireCliSession(payload);
        forkNativeSession(session.sessionId);
        return { ok: true, state: summarizeCliState() };
      }
      case "fullReloadSession": {
        const session = requireCliSession(payload);
        restartNativeSession(session.sessionId);
        return { ok: true, state: summarizeCliState() };
      }
      case "renameSession": {
        const session = requireCliSession(payload);
        await renameNativeSidebarTerminalSession(
          session.sessionId,
          String(payload.title ?? ""),
          "native-cli-rename-session",
        );
        return { ok: true, state: summarizeCliState() };
      }
      case "sleepSession": {
        const session = requireCliSession(payload);
        setNativeSessionSleeping(session.sessionId, payload.sleeping !== false);
        return { ok: true, state: summarizeCliState() };
      }
      case "favoriteSession": {
        const session = requireCliSession(payload);
        const reference = resolveSidebarSessionReference(session.sessionId);
        updateProjectWorkspace(
          reference.project.projectId,
          (workspace) =>
            setSessionFavoriteInSimpleWorkspace(
              workspace,
              reference.sessionId,
              payload.favorite !== false,
            ).snapshot,
        );
        publish();
        return { ok: true, state: summarizeCliState() };
      }
      case "sendText": {
        const session = requireCliSession(payload);
        postNative({
          sessionId: nativeSessionIdForSidebarSession(session.sessionId),
          text: String(payload.text ?? ""),
          type: "writeTerminalText",
        });
        return { ok: true, session };
      }
      case "sendEnter": {
        const session = requireCliSession(payload);
        postNative({
          sessionId: nativeSessionIdForSidebarSession(session.sessionId),
          type: "sendTerminalEnter",
        });
        return { ok: true, session };
      }
      case "sendKey": {
        const session = requireCliSession(payload);
        const text = terminalTextForCliKey(payload.key);
        if (!text) {
          throw new Error(`Unsupported key: ${String(payload.key)}`);
        }
        postNative({
          sessionId: nativeSessionIdForSidebarSession(session.sessionId),
          text,
          type: "writeTerminalText",
        });
        return { ok: true, session };
      }
      case "renameCommand": {
        const session = requireCliSession(payload);
        postNative({
          sessionId: nativeSessionIdForSidebarSession(session.sessionId),
          text: `/rename ${String(payload.title ?? "")}`,
          type: "writeTerminalText",
        });
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        postNative({
          sessionId: nativeSessionIdForSidebarSession(session.sessionId),
          type: "sendTerminalEnter",
        });
        return { ok: true, session };
      }
      case "toggleSection":
        setSidebarSectionCollapsed(
          String(payload.section) as SidebarCollapsibleSection,
          typeof payload.collapsed === "boolean"
            ? payload.collapsed
            : !collapsedSections[String(payload.section) as SidebarCollapsibleSection],
        );
        return { ok: true, state: summarizeCliState() };
      case "setVisibleCount":
        updateActiveProjectWorkspace((workspace) =>
          setVisibleCountInSimpleWorkspace(
            workspace,
            clampVisibleSessionCount(Number(payload.count)),
          ),
        );
        publish();
        return { ok: true, state: summarizeCliState() };
      case "setViewMode":
        updateActiveProjectWorkspace((workspace) =>
          setViewModeInSimpleWorkspace(
            workspace,
            String(payload.mode) as "grid" | "horizontal" | "vertical",
          ),
        );
        publish();
        return { ok: true, state: summarizeCliState() };
      case "openBrowser":
        openNativeBrowserWindow(
          typeof payload.url === "string" ? payload.url : DEFAULT_BROWSER_LAUNCH_URL,
        );
        return { ok: true };
      case "openBrowserPane":
        /**
         * CDXC:ChromiumBrowserPanes 2026-05-04-17:04
         * CEF pane testing needs a non-UI path that exercises the same
         * in-workspace browser creation as the sidebar button when macOS
         * accessibility automation is unavailable in local agent sessions.
         */
        return {
          ok: true,
          session: createNativeBrowserSession(
            typeof payload.url === "string" ? payload.url : DEFAULT_BROWSER_LAUNCH_URL,
          ),
        };
      case "showBrowser":
        showNativeBrowserWindow();
        return { ok: true };
      case "moveSidebar":
        moveSidebarToOtherSide();
        return { ok: true, state: summarizeCliState() };
      case "assertSidebarCard":
        return assertCliSidebarCard(payload);
      case "waitFor":
        return waitForCliSidebarCard(payload);
      default:
        throw new Error(`Unsupported CLI action: ${action}`);
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

function copyResumeCommand(sessionId: string): void {
  const reference = resolveSidebarSessionReference(sessionId);
  const session = findTerminalSessionInProject(reference.project, reference.sessionId);
  if (!session) {
    return;
  }
  const resumeCommand = buildNativeCopyResumeCommand(session);
  if (!resumeCommand) {
    showNativeMessage("info", "No resume command is available for this session.");
    return;
  }
  const text = `cd ${quoteNativeShellArg(reference.project.path)} && ${resumeCommand}`;
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function copyAttachCommand(sessionId: string): void {
  const reference = resolveSidebarSessionReference(sessionId);
  const session = findTerminalSessionInProject(reference.project, reference.sessionId);
  if (!session) {
    return;
  }
  if (session.isSleeping === true) {
    /**
     * CDXC:SessionSleep 2026-05-17-01:33:
     * Sleeping stops the provider runtime, so a copied external command should
     * resume the agent conversation instead of reattaching to a killed zmx/tmux
     * provider session and creating an empty shell.
     */
    const resumeCommand = buildNativeCopyResumeCommand(session);
    if (!resumeCommand) {
      showNativeMessage("info", "No resume command is available for this sleeping session.");
      return;
    }
    void navigator.clipboard?.writeText(resumeCommand).catch(() => undefined);
    return;
  }
  const terminalState = terminalStateById.get(reference.sessionId);
  const provider =
    terminalState?.sessionPersistenceProvider ??
    (terminalState ? undefined : resolveTerminalAttachProvider(session));
  const sessionPersistenceName =
    terminalState?.sessionPersistenceName ??
    (terminalState
      ? undefined
      : session.sessionPersistenceName ?? session.tmuxSessionName);
  if (!provider || !sessionPersistenceName) {
    showNativeMessage("info", "No persistence attach command is available for this session.");
    return;
  }
  /**
   * CDXC:SessionPersistence 2026-05-07-20:32
   * Provider-backed session cards expose a copyable attach command that uses
   * the stored provider/name pair, not the current Settings provider. This lets
   * users attach from an external terminal to the exact tmux/zmx/zellij session
   * backing the sidebar card.
   */
  const quotedName = quoteNativeShellArg(sessionPersistenceName);
  const attachCommand =
    provider === "tmux"
      ? `tmux attach-session -t ${quotedName}`
      : provider === "zmx"
        ? `zmx attach ${quotedName}`
        : `zellij attach ${quotedName}`;
  void navigator.clipboard?.writeText(attachCommand).catch(() => undefined);
}

function resolveNativeBrowserAccessT3Session(preferredSessionId?: string): T3SessionRecord | undefined {
  const preferredReference = preferredSessionId
    ? resolveSidebarSessionReference(preferredSessionId)
    : undefined;
  const project = preferredReference?.project ?? activeProject();
  const candidateSessionIds = new Set<string>();
  if (preferredReference) {
    candidateSessionIds.add(preferredReference.sessionId);
  }

  for (const group of project.workspace.groups) {
    if (group.snapshot.focusedSessionId) {
      candidateSessionIds.add(group.snapshot.focusedSessionId);
    }
  }

  for (const sessionId of candidateSessionIds) {
    const sessionRecord = findSessionRecordInProject(project, sessionId);
    if (sessionRecord?.kind === "t3") {
      return sessionRecord;
    }
  }

  for (const group of project.workspace.groups) {
    const sessionRecord = group.snapshot.sessions.find(
      (candidate): candidate is T3SessionRecord => candidate.kind === "t3",
    );
    if (sessionRecord) {
      return sessionRecord;
    }
  }

  return undefined;
}

function resolveOrCreateNativeBrowserAccessT3Session(
  preferredSessionId?: string,
): T3SessionRecord | undefined {
  const existingSession = resolveNativeBrowserAccessT3Session(preferredSessionId);
  if (existingSession) {
    return existingSession;
  }

  const preferredReference = preferredSessionId
    ? resolveSidebarSessionReference(preferredSessionId)
    : undefined;
  if (preferredReference && activeProjectId !== preferredReference.project.projectId) {
    focusProject(preferredReference.project.projectId);
  }
  return createNativeT3Session();
}

async function requestNativeT3SessionBrowserAccess(preferredSessionId?: string): Promise<void> {
  /**
   * CDXC:T3RemoteAccess 2026-05-02-01:18
   * Native ghostex cannot delegate Remote Access to the extension controller. It
   * must reuse the managed desktop T3 runtime, issue a one-time pairing link,
   * and send the QR payload through the shared sidebar modal contract.
   */
  const sessionRecord = resolveOrCreateNativeBrowserAccessT3Session(preferredSessionId);
  if (!sessionRecord) {
    showNativeMessage("error", "Could not start T3 Code for remote access.");
    return;
  }

  postNative({ cwd: sessionRecord.t3.workspaceRoot, type: "startT3CodeRuntime" });

  try {
    const ownerBearerToken = await waitForNativeT3OwnerBearerToken();
    const credential = await issueNativeT3PairingCredential(ownerBearerToken);
    const localPairingUrl = buildT3PairingUrl(NATIVE_T3_REMOTE_ACCESS_ORIGIN, credential);
    const accessLink = await resolveNativeT3BrowserAccessLink(localPairingUrl);
    sidebarBus.post({
      endpointUrl: accessLink.endpointUrl,
      localUrl: accessLink.localUrl,
      mode: accessLink.mode,
      note: accessLink.note,
      sessionId: sessionRecord.sessionId,
      sessionTitle: sessionRecord.title,
      tailscaleEnabled: accessLink.tailscaleEnabled,
      type: "showT3BrowserAccess",
    });
  } catch (error) {
    appendAgentDetectionDebugLog("nativeSidebar.t3BrowserAccess.failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId: sessionRecord.sessionId,
    });
    showNativeMessage(
      "error",
      error instanceof Error ? error.message : "Could not create the T3 remote access link.",
    );
  }
}

async function waitForNativeT3OwnerBearerToken(): Promise<string> {
  for (let attempt = 0; attempt < NATIVE_T3_REMOTE_ACCESS_AUTH_ATTEMPTS; attempt += 1) {
    const token = await readNativeT3OwnerBearerToken();
    if (token) {
      return token;
    }
    await delay(NATIVE_T3_REMOTE_ACCESS_AUTH_RETRY_MS);
  }

  throw new Error("T3 Code is still starting. Try Remote Access again in a moment.");
}

async function readNativeT3OwnerBearerToken(): Promise<string | undefined> {
  const ghostexHomeDir = window.__ghostex_NATIVE_HOST__?.ghostexHomeDir;
  if (!ghostexHomeDir) {
    return undefined;
  }

  const authStatePath = `${ghostexHomeDir.replace(/\/+$/, "")}/t3-runtime/auth-state.json`;
  const result = await runNativeProcess("/bin/cat", [authStatePath]);
  if (result.exitCode !== 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result.stdout) as { ownerBearerToken?: unknown; provider?: unknown };
    return parsed.provider === "t3code" && typeof parsed.ownerBearerToken === "string"
      ? parsed.ownerBearerToken.trim() || undefined
      : undefined;
  } catch {
    return undefined;
  }
}

async function issueNativeT3PairingCredential(ownerBearerToken: string): Promise<string> {
  const requestBody = JSON.stringify({ label: "Ghostex Remote Access" });
  const result = await runNativeProcess(
    "/bin/sh",
    [
      "-lc",
      [
        "/usr/bin/curl",
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "5",
        "-X",
        "POST",
        `${NATIVE_T3_REMOTE_ACCESS_ORIGIN}/api/auth/pairing-token`,
        "-H",
        '"authorization: Bearer $T3_OWNER_BEARER"',
        "-H",
        '"content-type: application/json"',
        "--data",
        '"$T3_PAIRING_BODY"',
      ].join(" "),
    ],
    {
      env: {
        T3_OWNER_BEARER: ownerBearerToken,
        T3_PAIRING_BODY: requestBody,
      },
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Could not create the T3 pairing link: ${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout) as { credential?: unknown };
  if (typeof parsed.credential !== "string" || !parsed.credential.trim()) {
    throw new Error("T3 pairing link response did not include a credential.");
  }
  return parsed.credential.trim();
}

async function resolveNativeT3BrowserAccessLink(localUrl: string): Promise<{
  endpointUrl: string;
  localUrl: string;
  mode: "external" | "local-network" | "local-only" | "tailscale";
  note: string;
  tailscaleEnabled: boolean;
}> {
  const parsedLocalUrl = new URL(localUrl);
  const [tailscaleHost, localNetworkHost] = await Promise.all([
    detectNativeTailscaleIpv4(),
    detectNativeLocalNetworkIpv4(),
  ]);
  const localNetworkUrl = localNetworkHost
    ? replaceT3AccessUrlHost(parsedLocalUrl, localNetworkHost)
    : undefined;

  if (tailscaleHost) {
    return {
      endpointUrl: replaceT3AccessUrlHost(parsedLocalUrl, tailscaleHost),
      localUrl: localNetworkUrl ?? localUrl,
      mode: "tailscale",
      note: localNetworkUrl
        ? "QR code and Copy link use your machine's Tailscale address. Open link uses your machine's local network address."
        : "QR code and Copy link use your machine's Tailscale address. No local network address was detected, so Open link falls back to this machine only.",
      tailscaleEnabled: true,
    };
  }

  if (localNetworkHost) {
    const resolvedLocalNetworkUrl = replaceT3AccessUrlHost(parsedLocalUrl, localNetworkHost);
    return {
      endpointUrl: resolvedLocalNetworkUrl,
      localUrl: resolvedLocalNetworkUrl,
      mode: "local-network",
      note: "Tailscale is not connected, so QR code, Copy link, and Open link all use your machine's local network address.",
      tailscaleEnabled: false,
    };
  }

  return {
    endpointUrl: localUrl,
    localUrl,
    mode: "local-only",
    note: "No Tailscale or local network address was detected, so QR code, Copy link, and Open link only work on this machine for now.",
    tailscaleEnabled: false,
  };
}

async function detectNativeTailscaleIpv4(): Promise<string | undefined> {
  const result = await runNativeProcess("/usr/bin/env", ["tailscale", "ip", "-4"]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(isIpv4Host);
}

async function detectNativeLocalNetworkIpv4(): Promise<string | undefined> {
  const result = await runNativeProcess("/bin/sh", [
    "-lc",
    [
      'iface="$(/sbin/route get default 2>/dev/null | /usr/bin/awk \'/interface:/{print $2; exit}\')"',
      'if [ -n "$iface" ]; then /usr/sbin/ipconfig getifaddr "$iface" 2>/dev/null && exit 0; fi',
      "for fallback in en0 en1; do /usr/sbin/ipconfig getifaddr \"$fallback\" 2>/dev/null && exit 0; done",
      "exit 1",
    ].join("; "),
  ]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(isIpv4Host);
}

function buildT3PairingUrl(origin: string, credential: string): string {
  const url = new URL("/pair", origin);
  url.hash = `token=${encodeURIComponent(credential)}`;
  return url.toString();
}

function replaceT3AccessUrlHost(url: URL, host: string): string {
  const nextUrl = new URL(url.toString());
  nextUrl.hostname = host;
  return nextUrl.toString();
}

function isIpv4Host(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d{1,3}$/u.test(part)) {
      return false;
    }
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function refreshDaemonSessionsState(): void {
  const now = new Date().toISOString();
  const sessions: SidebarDaemonSessionItem[] = [];
  const t3Sessions: SidebarT3SessionItem[] = [];
  for (const project of projects) {
    for (const group of project.workspace.groups) {
      for (const session of group.snapshot.sessions) {
        if (session.kind === "t3") {
          const isSleeping = session.isSleeping === true;
          t3Sessions.push({
            activity: "idle",
            detail: session.t3?.serverOrigin ?? "Native T3 Code pane",
            isCurrentWorkspace: project.projectId === activeProjectId,
            isFocused: group.snapshot.focusedSessionId === session.sessionId,
            isRunning: !isSleeping,
            isSleeping,
            lastInteractionAt: now,
            sessionId: session.sessionId,
            threadId: session.t3?.threadId,
            title: session.title,
            workspaceId: project.projectId,
            workspaceRoot: session.t3?.workspaceRoot ?? project.path,
          });
          continue;
        }
        if (session.kind !== "terminal") {
          continue;
        }
        const state = terminalStateById.get(session.sessionId);
        sessions.push({
          agentStatus: state?.activity ?? "idle",
          cols: 80,
          cwd: project.path,
          isCurrentWorkspace: project.projectId === activeProjectId,
          restoreState: "live",
          rows: 24,
          sessionId: session.sessionId,
          shell: session.title || "Native Ghostty",
          startedAt: now,
          status:
            state?.lifecycleState === "error"
              ? "error"
              : state?.lifecycleState === "done"
                ? "exited"
                : "running",
          title: state?.terminalTitle ?? session.title,
          workspaceId: project.projectId,
        });
      }
    }
  }
  const message: SidebarDaemonSessionsStateMessage = {
    daemon: {
      pid: 0,
      port: 0,
      protocolVersion: 1,
      startedAt: now,
    },
    sessions,
    t3Server:
      t3Sessions.length > 0
        ? {
            pid: 0,
            port: 3774,
            startedAt: now,
          }
        : undefined,
    t3Sessions,
    type: "daemonSessionsState",
  };
  sidebarBus.post(message);
  postAppModalHost({ message, type: "sidebarState" });
}

function closeAllNativeSessions(): void {
  const sessionIds = projects.flatMap((project) =>
    project.workspace.groups.flatMap((group) =>
      group.snapshot.sessions
        .filter((session) => session.kind === "terminal")
        .map((session) => session.sessionId),
    ),
  );
  for (const sessionId of sessionIds) {
    const nativeSessionId = forgetNativeSessionMapping(sessionId);
    postNative({ sessionId: nativeSessionId, type: "closeTerminal" });
    terminalStateById.delete(sessionId);
    titleDerivedActivityBySessionId.delete(sessionId);
    clearNativeSessionAttentionTracking(sessionId);
  }
  sidebarCommandSessionByCommandId.clear();
  sidebarCommandCommandIdBySessionId.clear();
  projects = projects.map((project) => ({
    ...project,
    commandsPanel: createDefaultCommandsPanelState(),
    workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
  }));
  previousSessions = [];
  writeStoredProjects("closeAllNativeSessions");
  publish();
}

function addProject(path: string, name = projectNameFromPath(path)): void {
  const normalizedPath = path.replace(/\/+$/, "") || path;
  const projectId = createProjectId(normalizedPath);
  const existingProject = projects.find((project) => project.projectId === projectId);
  if (existingProject?.isRecentProject === true) {
    restoreRecentProject(projectId);
    return;
  }
  if (!existingProject) {
    /**
     * CDXC:ProjectList 2026-05-16-21:46
     * Sidebar-created projects should be immediately visible at the top of the
     * projects list. Insert the new code project before existing code projects
     * while preserving the established chat-first ordering.
     */
    projects = orderNativeProjectsForSidebar([
      {
        commandsPanel: createDefaultCommandsPanelState(),
        name: name.trim() || projectNameFromPath(normalizedPath),
        path: normalizedPath,
        projectId,
        theme: resolveSidebarTheme(settings.sidebarTheme, "dark"),
        workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
      },
      ...projects,
    ]);
    writeStoredProjects("addProject");
  }
  focusProject(projectId);
  if (activeSnapshot().sessions.length === 0) {
    createTerminal(DEFAULT_TERMINAL_SESSION_TITLE);
    return;
  }
  publish();
}

async function createNativeChat(title = "chat"): Promise<void> {
  /**
   * CDXC:Chats 2026-05-04-09:30
   * A chat is not tied to an existing code project. Starting one must create a
   * real folder under ~/ghostex/chats/<date>-title and then launch a normal empty
   * terminal in that directory so the user can choose any agent from the shell.
   */
  const createdAt = new Date();
  const chatTitle = title.trim() || "chat";
  const chatPath = createNativeChatDirectoryPath(chatTitle, createdAt);
  const result = await runNativeProcess("/bin/mkdir", ["-p", chatPath]);
  if (result.exitCode !== 0) {
    showNativeMessage(
      "error",
      result.stderr.trim() || result.stdout.trim() || `Unable to create chat folder: ${chatPath}`,
    );
    return;
  }

  const projectId = createProjectId(chatPath);
  if (!projects.some((project) => project.projectId === projectId)) {
    projects = orderNativeProjectsForSidebar([
      ...projects,
      {
        commandsPanel: createDefaultCommandsPanelState(),
        isChat: true,
        name: nativeChatTitleFromDate(createdAt),
        path: chatPath,
        projectId,
        theme: resolveSidebarTheme(settings.sidebarTheme, "dark"),
        workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
      },
    ]);
    writeStoredProjects("createChat");
  }
  focusProject(projectId);
  if (activeSnapshot().sessions.length === 0) {
    createTerminal(DEFAULT_TERMINAL_SESSION_TITLE);
    return;
  }
  publish();
}

async function createNativePluginsBrowserChat(): Promise<void> {
  /**
   * CDXC:Plugins 2026-05-08-10:44
   * The top-sidebar Plugins button is a Chats-level directory browser, not a
   * project action. Create a projectless chat folder and place the Chromium
   * browser pane there so the active code project is not mutated by the click.
   */
  const createdAt = new Date();
  const chatPath = createNativeChatDirectoryPath("plugins", createdAt);
  const result = await runNativeProcess("/bin/mkdir", ["-p", chatPath]);
  if (result.exitCode !== 0) {
    showNativeMessage(
      "error",
      result.stderr.trim() || result.stdout.trim() || `Unable to create plugins chat: ${chatPath}`,
    );
    return;
  }

  const projectId = createProjectId(chatPath);
  if (!projects.some((project) => project.projectId === projectId)) {
    projects = orderNativeProjectsForSidebar([
      ...projects,
      {
        commandsPanel: createDefaultCommandsPanelState(),
        isChat: true,
        name: "Plugins",
        path: chatPath,
        projectId,
        theme: resolveSidebarTheme(settings.sidebarTheme, "dark"),
        workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
      },
    ]);
    writeStoredProjects("createPluginsBrowserChat");
  }
  focusProject(projectId);
  createNativeBrowserSession(PLUGINS_BROWSER_CHAT_URL);
}

async function openAgentsHubFileInDefaultEditor(filePath: string): Promise<void> {
  /**
   * CDXC:AgentsHub 2026-05-12-09:24
   * Agents Hub renders inside the modal host, but external edit still belongs
   * to native so it can honor the user's configured editor command.
   */
  const normalizedFilePath = filePath.trim();
  if (!normalizedFilePath) {
    showNativeMessage("warning", "Choose an Agents Hub file first.");
    return;
  }

  const editorCommand = getDefaultEditorCommandForSettings(settings).trim();
  if (!editorCommand) {
    showNativeMessage("warning", "Set a default editor command in Settings first.");
    return;
  }

  const result = await runNativeProcess("/bin/zsh", [
    "-lc",
    createAgentsHubExternalEditorCommand({
      defaultEditorCommand: settings.defaultEditorCommand,
      editorCommand,
      filePath: normalizedFilePath,
    }),
  ]);
  if (result.exitCode !== 0) {
    showNativeMessage(
      "error",
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Unable to open ${normalizedFilePath} with ${editorCommand}.`,
    );
  }
}

async function saveAgentsHubFile(filePath: string, content: string): Promise<void> {
  /**
   * CDXC:AgentsHub 2026-05-14-08:27:
   * The Agents Hub modal now edits real file buffers in-place and exposes a Save button only after the editor becomes dirty.
   * Write the exact current editor text to the requested path through the native process bridge so saving corrects the file contents directly instead of opening a secondary editor or maintaining a separate draft store.
   */
  const normalizedFilePath = filePath.trim();
  if (!normalizedFilePath) {
    showNativeMessage("warning", "Choose an Agents Hub file first.");
    return;
  }

  const result = await runNativeProcess(
    "/usr/bin/python3",
    [
      "-c",
      [
        "import base64, os, sys, tempfile",
        "file_path = sys.argv[1]",
        "content = base64.b64decode(os.environ['GHOSTEX_AGENTS_HUB_FILE_B64'])",
        "directory = os.path.dirname(file_path)",
        "if directory:",
        "    os.makedirs(directory, exist_ok=True)",
        "fd, temp_path = tempfile.mkstemp(prefix=os.path.basename(file_path) + '.', suffix='.tmp', dir=directory or '.')",
        "try:",
        "    with os.fdopen(fd, 'wb') as handle:",
        "        handle.write(content)",
        "    os.replace(temp_path, file_path)",
        "except Exception:",
        "    try:",
        "        os.unlink(temp_path)",
        "    except OSError:",
        "        pass",
        "    raise",
      ].join("\n"),
      normalizedFilePath,
    ],
    {
      env: {
        GHOSTEX_AGENTS_HUB_FILE_B64: encodeUtf8Base64(content),
      },
    },
  );

  if (result.exitCode !== 0) {
    showNativeMessage(
      "error",
      result.stderr.trim() || result.stdout.trim() || `Unable to save ${normalizedFilePath}.`,
    );
    return;
  }

  showNativeMessage("info", `Saved ${normalizedFilePath}.`);
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function requestAgentsHubCatalog(): Promise<void> {
  /**
   * CDXC:AgentsHub 2026-05-14-08:29:
   * Agents Hub's file tree is machine-local state. Build it in native by scanning the user's real Claude, Codex, shared agent, OpenCode, and Pi profile folders, including profile plugin caches and shared skill/hook directories, while pruning session/history/todo/runtime noise.
   */
  const result = await runNativeProcess("/bin/zsh", [
    "-lc",
    `/usr/bin/python3 - <<'GHOSTEX_AGENTS_HUB_CATALOG'\n${getAgentsHubCatalogPythonScript()}\nGHOSTEX_AGENTS_HUB_CATALOG`,
  ]);
  if (result.exitCode !== 0) {
    showNativeMessage(
      "error",
      result.stderr.trim() || result.stdout.trim() || "Unable to load Agents Hub files.",
    );
    return;
  }

  try {
    const message = JSON.parse(result.stdout) as AgentsHubCatalogMessage;
    postAppModalHost({ message, type: "sidebarState" });
  } catch (error) {
    showNativeMessage(
      "error",
      error instanceof Error ? error.message : "Unable to parse Agents Hub file catalog.",
    );
  }
}

function getAgentsHubCatalogPythonScript(): string {
  return String.raw`
from __future__ import annotations

import json
import os
from pathlib import Path
from datetime import datetime, timezone

home = Path.home()
max_file_bytes = 128 * 1024
groups_by_tab = {"mds": [], "skills": [], "hooks": [], "configs": []}
seen_files = set()

def p(*parts):
    return home.joinpath(*parts)

def profile(icon, label, profile_path, file_path, target_path=None):
    item = {"agentIcon": icon, "filePath": str(file_path), "label": label, "profilePath": str(profile_path)}
    if target_path is not None:
        item["targetPath"] = str(target_path)
    return item

main_target = p(".agents", "main.md")
profiles = []
main_claude = profile("claude", "Claude Code main", p(".claude"), p(".claude", "CLAUDE.md"), main_target)
profiles.append(main_claude)
for path in sorted(p(".claude-profiles").glob("*")):
    if path.is_dir() and not path.name.startswith(".") and (path / "CLAUDE.md").is_file():
        profiles.append(profile("claude", f"Claude Code {path.name}", path, path / "CLAUDE.md", main_target))
main_codex = profile("codex", "Codex main", p(".codex"), p(".codex", "AGENTS.md"), main_target)
profiles.append(main_codex)
for path in sorted(p(".codex-profiles").glob("*")):
    if path.is_dir() and not path.name.startswith(".") and ((path / "AGENTS.md").is_file() or (path / "config.toml").is_file()):
        profiles.append(profile("codex", f"Codex {path.name}", path, path / "AGENTS.md", main_target))
open_code = profile("opencode", "OpenCode main", p(".config", "opencode"), p(".config", "opencode", "opencode.json"))
pi_agent = profile("pi", "Pi agent", p(".pi", "agent"), p(".pi", "agent", "settings.json"))
linked_profiles = profiles[:]

def is_relative_to(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False

def profiles_for(path):
    if is_relative_to(path, p(".agents")) or is_relative_to(path, home / "agents"):
        if is_relative_to(path, home / "agents" / "hooks"):
            return [*linked_profiles, pi_agent]
        return linked_profiles
    for item in profiles:
        if is_relative_to(path, Path(item["profilePath"])):
            return [item]
    if is_relative_to(path, Path(open_code["profilePath"])):
        return [open_code]
    if is_relative_to(path, Path(pi_agent["profilePath"])):
        return [pi_agent]
    return []

def language_for(path):
    if path.name.endswith((".yaml", ".yml")):
        return "yaml"
    if path.suffix in (".json", ".jsonl"):
        return "json"
    if path.suffix == ".toml":
        return "toml"
    if path.suffix == ".sh":
        return "shell"
    if path.suffix == ".py":
        return "python"
    if path.suffix in (".ts", ".tsx"):
        return "typescript"
    if path.suffix in (".js", ".mjs", ".cjs"):
        return "javascript"
    if path.suffix == ".md":
        return "markdown"
    return "plaintext"

def file_id(path):
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(path))
    return "-".join(part for part in slug.split("-") if part)[:180]

def read_file(path):
    try:
        if not path.is_file() or path.stat().st_size > max_file_bytes:
            return None
        return path.read_text("utf-8")
    except Exception:
        return None

def file_item(path, root=None):
    resolved = path.resolve()
    key = str(resolved)
    if key in seen_files:
        return None
    content = read_file(resolved)
    if content is None:
        return None
    seen_files.add(key)
    name = str(resolved.relative_to(root)) if root and is_relative_to(resolved, root) else resolved.name
    return {"content": content, "id": file_id(resolved), "language": language_for(resolved), "name": name, "path": str(resolved)}

def add_group(tab, group_id, name, path, description, files, group_profiles=None):
    resolved_files = [item for candidate in files if (item := file_item(candidate, path))]
    if not resolved_files:
        return
    groups_by_tab[tab].append({
        "description": description,
        "files": resolved_files,
        "id": group_id,
        "name": name,
        "path": str(path),
        "profiles": group_profiles if group_profiles is not None else profiles_for(path),
    })

def existing(paths):
    return [path for path in paths if path.is_file()]

def walk_files(root, max_depth, predicate):
    if not root.exists():
        return []
    ignored_dirs = {".git", "node_modules", "dist", "build", "out", "coverage", ".cache", "cache", "__pycache__", "sessions", "projects", "todos", "telemetry", "usage-data", "ambient-suggestions", "memories_2026-04-24", "logs", "tmp", ".tmp"}
    files = []
    for current, dirs, names in os.walk(root):
        current_path = Path(current)
        depth = len(current_path.relative_to(root).parts)
        dirs[:] = [name for name in dirs if name not in ignored_dirs and depth < max_depth]
        for name in names:
            candidate = current_path / name
            if predicate(candidate):
                files.append(candidate)
    return sorted(files)

text_suffixes = {".md", ".json", ".jsonl", ".toml", ".yaml", ".yml", ".sh", ".ts", ".js", ".mjs", ".py", ".txt"}

add_group("mds", "md-shared-agents", "Shared agent markdown", p(".agents"), "Shared instructions and best-practice markdown linked by agent profiles.", walk_files(p(".agents"), 1, lambda path: path.suffix == ".md"), linked_profiles)
add_group("mds", "md-claude-profiles", "Claude profile instructions", p(".claude-profiles"), "CLAUDE.md files owned by Claude profiles.", existing([Path(item["filePath"]) for item in profiles if item["agentIcon"] == "claude"]), [item for item in profiles if item["agentIcon"] == "claude"])
add_group("mds", "md-codex-profiles", "Codex profile instructions", p(".codex-profiles"), "AGENTS.md files owned by Codex profiles.", existing([Path(item["filePath"]) for item in profiles if item["agentIcon"] == "codex"]), [item for item in profiles if item["agentIcon"] == "codex"])

shared_skills_root = home / "agents" / "skills"
for skill_dir in sorted([path for path in shared_skills_root.iterdir() if path.is_dir()] if shared_skills_root.exists() else []):
    if skill_dir.name.startswith(".") and skill_dir.name != ".system":
        continue
    if skill_dir.name == ".system":
        for system_skill in sorted([path for path in skill_dir.iterdir() if path.is_dir()]):
            add_group("skills", f"skill-shared-{file_id(system_skill)}", system_skill.name, system_skill, "System skill installed in the shared agent skill folder.", walk_files(system_skill, 3, lambda path: path.name == "SKILL.md" or path.suffix in {".json", ".yaml", ".yml", ".sh", ".py", ".js", ".ts"}), linked_profiles)
        continue
    add_group("skills", f"skill-shared-{file_id(skill_dir)}", skill_dir.name, skill_dir, "Shared skill installed under ~/agents/skills.", walk_files(skill_dir, 3, lambda path: path.name == "SKILL.md" or path.suffix in {".json", ".yaml", ".yml", ".sh", ".py", ".js", ".ts"}), linked_profiles)

for plugins_root in [p(".codex-profiles"), p(".claude-profiles")]:
    for profile_dir in sorted([path for path in plugins_root.glob("*") if path.is_dir() and not path.name.startswith(".")]):
        cache_root = profile_dir / "plugins" / "cache"
        if not cache_root.exists():
            continue
        plugin_files = walk_files(cache_root, 7, lambda path: path.name == "SKILL.md" or str(path).endswith("/.codex-plugin/plugin.json") or str(path).endswith("/.claude-plugin/plugin.json"))
        roots = {}
        for path in plugin_files:
            parts = path.parts
            if "skills" in parts and path.name == "SKILL.md":
                skill_index = parts.index("skills")
                root = Path(*parts[: skill_index + 2])
            else:
                marker = ".codex-plugin" if ".codex-plugin" in parts else ".claude-plugin"
                marker_index = parts.index(marker)
                root = Path(*parts[:marker_index])
            roots.setdefault(root, []).append(path)
        for root, files in sorted(roots.items()):
            rel_name = str(root.relative_to(cache_root))
            add_group("skills", f"skill-profile-{file_id(root)}", rel_name, root, "Skill or plugin manifest installed inside an agent profile plugin cache.", files, profiles_for(root))

hooks_root = home / "agents" / "hooks"
add_group("hooks", "hooks-shared", "Shared hooks", hooks_root, "Shared hook scripts and documentation used by agent profiles.", walk_files(hooks_root, 3, lambda path: path.suffix in text_suffixes), [*linked_profiles, pi_agent])
add_group("hooks", "hooks-codex-profiles", "Codex profile hooks", p(".codex-profiles"), "hooks.json files owned by Codex profiles.", walk_files(p(".codex-profiles"), 2, lambda path: path.name == "hooks.json"), [item for item in profiles if item["agentIcon"] == "codex"])
add_group("hooks", "hooks-pi-agent", "Pi extensions", p(".pi", "agent"), "Pi agent extension hooks and settings-adjacent TypeScript files.", walk_files(p(".pi", "agent", "extensions"), 2, lambda path: path.suffix in {".ts", ".js", ".json"}), [pi_agent])

add_group("configs", "config-shared-agents", "Shared agent config", p(".agents"), "Shared agent lock and setup files.", walk_files(p(".agents"), 1, lambda path: path.name.endswith(".json")), linked_profiles)
add_group("configs", "config-claude-main", "Claude main configs", p(".claude"), "Global Claude Code settings and MCP configuration.", existing([p(".claude.json"), p(".claude", "settings.json"), p(".claude", "settings.local.json")]), [main_claude])
for item in [profile_item for profile_item in profiles if profile_item["agentIcon"] == "claude" and "-profiles" in profile_item["profilePath"]]:
    root = Path(item["profilePath"])
    files = existing([root / ".claude.json", root / "settings.json", root / "settings.local.json", root / "policy-limits.json", root / "stats-cache.json", root / "plugins" / "installed_plugins.json", root / "plugins" / "known_marketplaces.json", root / "plugins" / "blocklist.json"])
    add_group("configs", f"config-claude-{file_id(root)}", f"Claude {root.name} configs", root, "Claude profile-owned config and plugin registry files.", files, [item])
add_group("configs", "config-codex-main", "Codex main configs", p(".codex"), "Global Codex TOML and hook configuration.", existing([p(".codex", "config.toml"), p(".codex", "hooks.json")]), [main_codex])
for item in [profile_item for profile_item in profiles if profile_item["agentIcon"] == "codex" and "-profiles" in profile_item["profilePath"]]:
    root = Path(item["profilePath"])
    files = existing([root / "config.toml", root / "hooks.json", root / ".codex-global-state.json", root / "browser" / "config.toml", root / "plugins" / "installed_plugins.json", root / "plugins" / "known_marketplaces.json", root / "plugins" / "blocklist.json"])
    add_group("configs", f"config-codex-{file_id(root)}", f"Codex {root.name} configs", root, "Codex profile-owned config, hook, browser, and plugin registry files.", files, [item])
add_group("configs", "config-opencode", "OpenCode configs", Path(open_code["profilePath"]), "OpenCode JSON, package, and plugin files.", walk_files(Path(open_code["profilePath"]), 2, lambda path: path.name in {"opencode.json", "tui.json", "package.json"} or (path.parent.name == "plugin" and path.suffix == ".js")), [open_code])
add_group("configs", "config-pi", "Pi configs", Path(pi_agent["profilePath"]), "Pi agent settings and local extension files.", walk_files(Path(pi_agent["profilePath"]), 2, lambda path: path.suffix in {".json", ".ts", ".js"} and path.name != "auth.json"), [pi_agent])

for tab in groups_by_tab:
    groups_by_tab[tab].sort(key=lambda group: group["name"].lower())

print(json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(), "groupsByTab": groups_by_tab, "type": "agentsHubCatalog"}))
`;
}

async function createNativeBrowserChat(): Promise<void> {
  /**
   * CDXC:Chats 2026-05-08-11:07
   * The Chats header browser button must behave like New Chat, but seed the
   * new projectless chat with a Chromium browser pane. This keeps browser panes
   * out of the active code project when the click starts from the Chats
   * collection header.
   */
  const createdAt = new Date();
  const chatPath = createNativeChatDirectoryPath("browser", createdAt);
  const result = await runNativeProcess("/bin/mkdir", ["-p", chatPath]);
  if (result.exitCode !== 0) {
    showNativeMessage(
      "error",
      result.stderr.trim() || result.stdout.trim() || `Unable to create browser chat: ${chatPath}`,
    );
    return;
  }

  const projectId = createProjectId(chatPath);
  if (!projects.some((project) => project.projectId === projectId)) {
    projects = orderNativeProjectsForSidebar([
      ...projects,
      {
        commandsPanel: createDefaultCommandsPanelState(),
        isChat: true,
        name: "Browser",
        path: chatPath,
        projectId,
        theme: resolveSidebarTheme(settings.sidebarTheme, "dark"),
        workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
      },
    ]);
    writeStoredProjects("createBrowserChat");
  }
  focusProject(projectId);
  createNativeBrowserSession(DEFAULT_BROWSER_LAUNCH_URL);
}

function removeProject(projectId: string): void {
  if (projects.length <= 1) {
    showNativeMessage("warning", "Keep at least one workspace in Ghostex.");
    return;
  }
  const projectIndex = projects.findIndex((project) => project.projectId === projectId);
  if (projectIndex < 0) {
    return;
  }
  const project = projects[projectIndex]!;
  disposeProjectEditorSurface(project.projectId);
  /**
   * CDXC:WorkspaceDock 2026-04-27-08:45
   * Right-click removal belongs to the React workspace dock context menu. When
   * a workspace is removed, close its native terminal surfaces and delete the
   * sidebar/native id mappings before persisting the remaining workspaces so
   * removed sessions cannot keep drawing behind the new active project.
   */
  for (const group of project.workspace.groups) {
    for (const session of group.snapshot.sessions) {
      if (session.kind !== "terminal") {
        continue;
      }
      const nativeSessionId = nativeSessionIdBySidebarSessionId.get(session.sessionId);
      if (nativeSessionId) {
        postNative({ sessionId: nativeSessionId, type: "closeTerminal" });
        sidebarSessionIdByNativeSessionId.delete(nativeSessionId);
      }
      nativeSessionIdBySidebarSessionId.delete(session.sessionId);
      terminalStateById.delete(session.sessionId);
      titleDerivedActivityBySessionId.delete(session.sessionId);
      nativeActivitySuppressedUntilBySessionId.delete(session.sessionId);
      nativeWorkingStartedAtBySessionId.delete(session.sessionId);
      clearNativeSessionAttentionTracking(session.sessionId);
    }
  }
  const nextProjects = projects.filter((project) => project.projectId !== projectId);
  projects = nextProjects;
  if (activeProjectId === projectId) {
    activeProjectId =
      nextProjects[Math.min(projectIndex, nextProjects.length - 1)]?.projectId ??
      nextProjects[0]!.projectId;
    postZedOverlaySettings("workspace-focus");
    scheduleSyncOpenProjectWithZed("removeProject");
    void refreshGitState();
  }
  writeStoredProjects("removeProject");
  publish();
}

function closeProjectToRecent(projectId: string): void {
  const projectIndex = projects.findIndex((project) => project.projectId === projectId);
  if (projectIndex < 0) {
    return;
  }
  const project = projects[projectIndex]!;
  if (project.isChat === true) {
    return;
  }
  disposeProjectEditorSurface(project.projectId);

  /**
   * CDXC:RecentProjects 2026-05-04-14:25
   * Closing a Combined project parks it in Recent Projects instead of deleting
   * sessions. All native surfaces are torn down and records are marked
   * sleeping so restoring can bring back the saved split/group state.
   */
  for (const group of project.workspace.groups) {
    for (const session of group.snapshot.sessions) {
      disposeNativeRecentProjectSessionSurface(project, session);
    }
  }

  const nextProjects = projects.map((candidate) =>
    candidate.projectId === projectId
      ? {
          ...candidate,
          isRecentProject: true,
          recentClosedAt: new Date().toISOString(),
          workspace: setProjectSessionsSleeping(candidate.workspace, true),
        }
      : candidate,
  );
  projects = nextProjects;

  const didCloseActiveProject = activeProjectId === projectId;
  if (didCloseActiveProject) {
    const nextVisibleProject = findNearestVisibleProjectAfterClose(projectIndex, projectId);
    if (nextVisibleProject) {
      activeProjectId = nextVisibleProject.projectId;
      postZedOverlaySettings("workspace-focus");
      scheduleSyncOpenProjectWithZed("closeProjectToRecent");
      void refreshGitState();
    }
  }

  writeStoredProjects("closeProjectToRecent");
  publish();
}

function restoreRecentProject(projectId: string): void {
  const project = findProject(projectId);
  if (!project || project.isRecentProject !== true) {
    return;
  }

  const sessionCount = countRecentProjectSessions(project);
  const didSwitchProject = activeProjectId !== projectId;
  projects = projects.map((candidate) =>
    candidate.projectId === projectId
      ? {
          ...candidate,
          isRecentProject: false,
          recentClosedAt: undefined,
          workspace:
            sessionCount > 0
              ? wakeVisibleProjectSessions(candidate.workspace)
              : candidate.workspace,
        }
      : candidate,
  );
  activeProjectId = projectId;
  writeStoredProjects("restoreRecentProject");
  postZedOverlaySettings("workspace-focus");
  if (didSwitchProject) {
    scheduleSyncOpenProjectWithZed("restoreRecentProject");
  }
  void refreshGitState();

  if (sessionCount === 0) {
    createTerminal(DEFAULT_TERMINAL_SESSION_TITLE);
    return;
  }

  publish();
}

function disposeNativeRecentProjectSessionSurface(
  project: NativeProject,
  session: SessionRecord,
): void {
  const nativeSessionId = forgetNativeSessionMappingForProject(
    project.projectId,
    session.sessionId,
  );
  clearNativeSidebarCommandSessionBySessionId(session.sessionId);
  terminalStateById.delete(session.sessionId);
  titleDerivedActivityBySessionId.delete(session.sessionId);
  nativeActivitySuppressedUntilBySessionId.delete(session.sessionId);
  nativeWorkingStartedAtBySessionId.delete(session.sessionId);
  clearNativeSessionAttentionTracking(session.sessionId);
  postNative({
    sessionId: nativeSessionId,
    type: session.kind === "t3" || session.kind === "browser" ? "closeWebPane" : "closeTerminal",
  });
}

function setProjectSessionsSleeping(
  workspace: GroupedSessionWorkspaceSnapshot,
  sleeping: boolean,
): GroupedSessionWorkspaceSnapshot {
  return normalizeSimpleGroupedSessionWorkspaceSnapshot({
    ...workspace,
    groups: workspace.groups.map((group) => ({
      ...group,
      snapshot: {
        ...group.snapshot,
        sessions: group.snapshot.sessions.map((session) => ({
          ...session,
          isSleeping: sleeping,
        })),
      },
    })),
  });
}

function wakeVisibleProjectSessions(
  workspace: GroupedSessionWorkspaceSnapshot,
): GroupedSessionWorkspaceSnapshot {
  const activeGroup =
    workspace.groups.find((group) => group.groupId === workspace.activeGroupId) ??
    workspace.groups[0];
  if (!activeGroup) {
    return workspace;
  }

  const visibleSessionIds = activeGroup.snapshot.visibleSessionIds.filter((sessionId) =>
    activeGroup.snapshot.sessions.some((session) => session.sessionId === sessionId),
  );
  const sessionIdsToWake =
    visibleSessionIds.length > 0
      ? visibleSessionIds
      : activeGroup.snapshot.focusedSessionId
        ? [activeGroup.snapshot.focusedSessionId]
        : activeGroup.snapshot.sessions[0]
          ? [activeGroup.snapshot.sessions[0].sessionId]
          : [];
  const wakeIds = new Set(sessionIdsToWake);

  return normalizeSimpleGroupedSessionWorkspaceSnapshot({
    ...workspace,
    groups: workspace.groups.map((group) => ({
      ...group,
      snapshot: {
        ...group.snapshot,
        sessions: group.snapshot.sessions.map((session) =>
          wakeIds.has(session.sessionId) ? { ...session, isSleeping: false } : session,
        ),
        visibleSessionIds:
          group.groupId === activeGroup.groupId && visibleSessionIds.length === 0
            ? sessionIdsToWake
            : group.snapshot.visibleSessionIds,
      },
    })),
  });
}

function findNearestVisibleProjectAfterClose(
  closedProjectIndex: number,
  closedProjectId: string,
): NativeProject | undefined {
  const visibleProjects = projects.filter(
    (project) => project.projectId !== closedProjectId && project.isRecentProject !== true,
  );
  if (visibleProjects.length === 0) {
    return undefined;
  }

  return (
    projects
      .slice(closedProjectIndex + 1)
      .find((project) => project.projectId !== closedProjectId && project.isRecentProject !== true) ??
    projects
      .slice(0, closedProjectIndex)
      .reverse()
      .find((project) => project.projectId !== closedProjectId && project.isRecentProject !== true) ??
    visibleProjects[0]
  );
}

function setProjectIcon(projectId: string, iconDataUrl: string | undefined): void {
  /**
   * CDXC:WorkspaceDock 2026-04-27-08:48
   * Native-picked workspace images still enter through the legacy data URL API.
   * Convert them into the typed workspace icon model so the dock can share one
   * renderer for image and Tabler icon variants.
   */
  const icon = iconDataUrl
    ? ({ dataUrl: iconDataUrl, kind: "image" } satisfies WorkspaceDockIcon)
    : undefined;
  projects = projects.map((project) =>
    project.projectId === projectId ? { ...project, icon, iconDataUrl } : project,
  );
  writeStoredProjects("setProjectIcon");
  publish();
}

function setProjectTheme(projectId: string, theme: SidebarTheme): void {
  projects = projects.map((project) =>
    project.projectId === projectId ? removeProjectCustomThemeColor(project, theme) : project,
  );
  writeStoredProjects("setProjectTheme");
  publish();
}

/**
 * CDXC:WorkspaceTheme 2026-05-05-05:01
 * Choosing a preset theme is not a Custom theme update. Remove the persisted
 * custom color field instead of leaving an undefined marker so every renderer
 * falls back to preset icon, sidebar, and project-header colors immediately.
 */
function removeProjectCustomThemeColor(project: NativeProject, theme: SidebarTheme): NativeProject {
  const { themeColor: _removedThemeColor, ...projectWithoutCustomTheme } = project;
  return { ...projectWithoutCustomTheme, theme };
}

function setProjectThemeColor(projectId: string, themeColor: string): void {
  const normalizedColor = normalizeWorkspaceThemeColor(themeColor);
  if (!normalizedColor) {
    return;
  }

  /**
   * CDXC:WorkspaceTheme 2026-05-05-02:58
   * The Theme context menu owns custom workspace colors. Applying Custom keeps
   * the current preset as fallback metadata but writes a validated color that
   * immediately overrides the dock button and Combined-mode project header.
   */
  projects = projects.map((project) =>
    project.projectId === projectId ? { ...project, themeColor: normalizedColor } : project,
  );
  writeStoredProjects("setProjectThemeColor");
  publish();
}

function focusProject(projectId: string): void {
  if (!projects.some((project) => project.projectId === projectId)) {
    return;
  }
  const previousActiveProjectId = activeProjectId;
  const didSwitchProject = activeProjectId !== projectId;
  activeProjectId = projectId;
  if (didSwitchProject) {
    scheduleProjectEditorSleep(previousActiveProjectId);
    cancelProjectEditorSleepTimer(projectId);
  }
  writeStoredProjects("focusProject");
  postZedOverlaySettings("workspace-focus");
  if (didSwitchProject) {
    scheduleSyncOpenProjectWithZed("focusProject");
  }
  void refreshGitState();
  void refreshProjectDiffStats(projectId);
  const focusedSessionId = activeSnapshot().focusedSessionId;
  if (focusedSessionId) {
    queueNativeLayoutFocusRequest(focusedSessionId, "focusProject");
  }
  const editorSurfaceState = projectEditorSurfaceByProjectId.get(projectId);
  if (editorSurfaceState?.isOpen === true) {
    if (editorSurfaceState.isSleeping === true) {
      const project = findProject(projectId);
      if (project) {
        wakeProjectEditorSurface(project, editorSurfaceState.mode);
      }
    }
    publish();
    postNative({
      projectId: createNativeProjectEditorId(projectId, editorSurfaceState.mode),
      type: "focusProjectEditorPane",
    });
    return;
  }
  publish();
}

function createCodeServerProjectEditorUrl(projectPath: string): string {
  const url = new URL(CODE_SERVER_EDITOR_ORIGIN);
  url.searchParams.set("folder", projectPath);
  return url.toString();
}

function createNativeProjectEditorId(projectId: string, mode: ProjectEditorSurfaceMode): string {
  return `project-editor:${encodeURIComponent(projectId)}:${mode}`;
}

function parseNativeProjectEditorId(
  nativeEditorId: string,
): { mode: ProjectEditorSurfaceMode; projectId: string } | undefined {
  const match = /^project-editor:(?<projectId>.+):(?<mode>code|git|tasks)$/u.exec(nativeEditorId);
  if (!match?.groups) {
    return undefined;
  }
  try {
    return {
      mode: match.groups.mode as ProjectEditorSurfaceMode,
      projectId: decodeURIComponent(match.groups.projectId),
    };
  } catch {
    return undefined;
  }
}

function projectIdFromProjectEditorId(nativeEditorId: string): string {
  return parseNativeProjectEditorId(nativeEditorId)?.projectId ?? nativeEditorId;
}

function rememberAwakeProjectEditorMode(projectId: string, mode: ProjectEditorSurfaceMode): void {
  const modes =
    awakeProjectEditorModesByProjectId.get(projectId) ?? new Set<ProjectEditorSurfaceMode>();
  modes.add(mode);
  awakeProjectEditorModesByProjectId.set(projectId, modes);
}

function forgetAwakeProjectEditorModes(projectId: string): void {
  awakeProjectEditorModesByProjectId.delete(projectId);
}

function hasAwakeProjectEditorMode(projectId: string, mode: ProjectEditorSurfaceMode): boolean {
  return awakeProjectEditorModesByProjectId.get(projectId)?.has(mode) === true;
}

function projectEditorErrorMessageForMode(mode: ProjectEditorSurfaceMode): string {
  if (mode === "git") {
    return "GitHub did not finish loading within 10 seconds.";
  }
  if (mode === "tasks") {
    return "Project did not finish loading within 10 seconds.";
  }
  return "VS Code did not finish loading within 10 seconds.";
}

function projectEditorLoadFailureMessageForMode(mode: ProjectEditorSurfaceMode): string {
  if (mode === "git") {
    return "GitHub failed to load.";
  }
  if (mode === "tasks") {
    return "Project failed to load.";
  }
  return "VS Code failed to load.";
}

function projectEditorSurfaceTitleForMode(
  project: NativeProject,
  mode: ProjectEditorSurfaceMode,
): string {
  if (mode === "git") {
    return "GitHub";
  }
  if (mode === "tasks") {
    return "Project";
  }
  return projectEditorTitle(project);
}

function cancelProjectEditorOpenTimer(projectId: string): void {
  const timeout = projectEditorOpenTimeoutByProjectId.get(projectId);
  if (timeout !== undefined) {
    window.clearTimeout(timeout);
    projectEditorOpenTimeoutByProjectId.delete(projectId);
  }
}

function scheduleProjectEditorOpenTimeout(projectId: string): void {
  cancelProjectEditorOpenTimer(projectId);
  const timeout = window.setTimeout(() => {
    const surfaceState = projectEditorSurfaceByProjectId.get(projectId);
    if (!surfaceState || surfaceState.status !== "opening") {
      return;
    }
    /**
     * CDXC:EditorPanes 2026-05-09-17:24
     * Starting VS Code can fail after the sidebar row is shown. Keep the row
     * visible and convert it to an error state after ten seconds so the user
     * can click/retry or read the startup failure instead of losing the row.
     */
    projectEditorSurfaceByProjectId.set(projectId, {
      ...surfaceState,
      errorMessage: projectEditorErrorMessageForMode(surfaceState.mode),
      status: "error",
    });
    projectEditorOpenTimeoutByProjectId.delete(projectId);
    publish();
  }, PROJECT_EDITOR_OPEN_TIMEOUT_MS);
  projectEditorOpenTimeoutByProjectId.set(projectId, timeout);
}

function setProjectEditorLoadState(
  nativeEditorId: string,
  status: Exclude<ProjectEditorLoadStatus, "idle">,
  message?: string,
): void {
  const projectId = projectIdFromProjectEditorId(nativeEditorId);
  const surfaceState = projectEditorSurfaceByProjectId.get(projectId);
  if (!surfaceState || surfaceState.nativeEditorId !== nativeEditorId) {
    return;
  }

  if (status === "opening") {
    projectEditorSurfaceByProjectId.set(projectId, {
      ...surfaceState,
      errorMessage: undefined,
      status,
    });
    scheduleProjectEditorOpenTimeout(projectId);
    publish();
    return;
  }

  cancelProjectEditorOpenTimer(projectId);
  projectEditorSurfaceByProjectId.set(projectId, {
    ...surfaceState,
    errorMessage:
      status === "error"
        ? (message ?? projectEditorLoadFailureMessageForMode(surfaceState.mode))
        : undefined,
    status,
  });
  publish();
}

function cancelProjectEditorSleepTimer(projectId: string): void {
  const timeout = projectEditorSleepTimeoutByProjectId.get(projectId);
  if (timeout !== undefined) {
    window.clearTimeout(timeout);
    projectEditorSleepTimeoutByProjectId.delete(projectId);
  }
}

function scheduleProjectEditorSleep(projectId: string): void {
  const surfaceState = projectEditorSurfaceByProjectId.get(projectId);
  if (!surfaceState || surfaceState.isSleeping === true) {
    return;
  }
  cancelProjectEditorSleepTimer(projectId);
  const timeout = window.setTimeout(() => {
    sleepProjectEditorSurface(projectId);
  }, PROJECT_EDITOR_SLEEP_TIMEOUT_MS);
  projectEditorSleepTimeoutByProjectId.set(projectId, timeout);
}

function sleepProjectEditorSurface(projectId: string): void {
  const surfaceState = projectEditorSurfaceByProjectId.get(projectId);
  if (!surfaceState || (activeProjectId === projectId && surfaceState.isOpen)) {
    return;
  }
  /**
   * CDXC:EditorPanes 2026-05-06-14:21
   * Project editors stay live across project switches, then sleep after the
   * existing five-minute managed-runtime window. Sleeping closes only the
   * native Chromium surface; the sidebar keeps the project editor preference so
   * focusing the project can wake code-server back into the same folder.
   */
  projectEditorSurfaceByProjectId.set(projectId, {
    ...surfaceState,
    isSleeping: true,
  });
  forgetAwakeProjectEditorModes(projectId);
  cancelProjectEditorOpenTimer(projectId);
  projectEditorSleepTimeoutByProjectId.delete(projectId);
  postNative({
    projectId: createNativeProjectEditorId(projectId, "code"),
    type: "closeProjectEditorPane",
  });
  postNative({
    projectId: createNativeProjectEditorId(projectId, "git"),
    type: "closeProjectEditorPane",
  });
  postNative({
    projectId: createNativeProjectEditorId(projectId, "tasks"),
    type: "closeProjectEditorPane",
  });
  stopCodeServerRuntimeIfEveryEditorSleeping();
  publish();
}

function stopCodeServerRuntimeIfEveryEditorSleeping(): void {
  const hasAwakeEditorSurface = Array.from(projectEditorSurfaceByProjectId.keys()).some(
    (projectId) =>
      projectEditorSurfaceByProjectId.get(projectId)?.isSleeping !== true &&
      hasAwakeProjectEditorMode(projectId, "code"),
  );
  if (!hasAwakeEditorSurface) {
    postNative({ type: "stopCodeServerRuntime" });
  }
}

function projectEditorTitle(project: NativeProject): string {
  const storedName = typeof project.name === "string" ? project.name.trim() : "";
  /**
   * CDXC:EditorPanes 2026-05-08-13:31
   * The native project-editor command is decoded as a strict Swift struct.
   * Always send a concrete title string so legacy or partially restored
   * project snapshots cannot omit `title` and silently drop the create-pane
   * command before the later focus command runs.
   */
  return storedName || projectNameFromPath(project.path);
}

function wakeProjectEditorSurface(project: NativeProject, mode?: ProjectEditorSurfaceMode): void {
  const startedAtMs = performance.now();
  const surfaceState = projectEditorSurfaceByProjectId.get(project.projectId);
  const nextMode = mode ?? surfaceState?.mode ?? "code";
  const nativeEditorId = createNativeProjectEditorId(project.projectId, nextMode);
  const url =
    nextMode === "git"
      ? surfaceState?.url
      : nextMode === "tasks"
        ? surfaceState?.url
        : createCodeServerProjectEditorUrl(project.path);
  if ((nextMode === "git" || nextMode === "tasks") && !url) {
    return;
  }
  if (nextMode === "code") {
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarWakeStart", {
      elapsedMs: performance.now() - startedAtMs,
      hasAwakeCodeMode: hasAwakeProjectEditorMode(project.projectId, "code"),
      incomingMode: mode,
      nativeEditorId,
      projectId: project.projectId,
      projectPath: project.path,
      surfaceIsOpen: surfaceState?.isOpen === true,
      surfaceIsSleeping: surfaceState?.isSleeping === true,
      surfaceMode: surfaceState?.mode,
      surfaceStatus: surfaceState?.status,
    });
  }
  cancelProjectEditorSleepTimer(project.projectId);
  projectEditorSurfaceByProjectId.set(project.projectId, {
    errorMessage: undefined,
    isOpen: surfaceState?.isOpen === true,
    isSleeping: false,
    mode: nextMode,
    nativeEditorId,
    status: hasAwakeProjectEditorMode(project.projectId, nextMode) ? "running" : "opening",
    title: projectEditorSurfaceTitleForMode(project, nextMode),
    url,
  });
  if (hasAwakeProjectEditorMode(project.projectId, nextMode)) {
    cancelProjectEditorOpenTimer(project.projectId);
  } else {
    scheduleProjectEditorOpenTimeout(project.projectId);
  }
  rememberAwakeProjectEditorMode(project.projectId, nextMode);
  if (nextMode === "code") {
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarWakeBeforeStartRuntime", {
      elapsedMs: performance.now() - startedAtMs,
      linkVscodeUserConfig: settings.codeServerLinkVscodeUserConfig,
      nativeEditorId,
      projectId: project.projectId,
    });
    postNative({
      cwd: project.path,
      linkVscodeUserConfig: settings.codeServerLinkVscodeUserConfig,
      type: "startCodeServerRuntime",
      vscodeUserConfigDir: codeServerVscodeUserConfigDirectory(),
    });
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarWakeAfterStartRuntimePost", {
      elapsedMs: performance.now() - startedAtMs,
      nativeEditorId,
      projectId: project.projectId,
    });
  }
  if (nextMode === "code") {
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarWakeBeforeCreatePane", {
      elapsedMs: performance.now() - startedAtMs,
      nativeEditorId,
      projectId: project.projectId,
      urlLength: url?.length ?? 0,
    });
  }
  postNative({
    companionPaneHidden: project.projectEditorCompanionPaneHidden === true,
    mode: nextMode,
    projectId: nativeEditorId,
    projectTitle: projectEditorTitle(project),
    showsBrowserToolbar: nextMode === "git",
    showsProjectTabs: nextMode === "git",
    title: projectEditorSurfaceTitleForMode(project, nextMode),
    type: "createProjectEditorPane",
    url: url!,
  });
  if (nextMode === "code") {
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarWakeAfterCreatePanePost", {
      elapsedMs: performance.now() - startedAtMs,
      nativeEditorId,
      projectId: project.projectId,
    });
  }
}

function restoreActiveProjectEditorAtStartup(): boolean {
  const project = activeProject();
  const surfaceState = projectEditorSurfaceByProjectId.get(project.projectId);
  if (
    project.isChat === true ||
    project.isRecentProject === true ||
    surfaceState?.isOpen !== true ||
    surfaceState.isSleeping === true
  ) {
    return false;
  }

  wakeProjectEditorSurface(project);
  postNative({ projectId: surfaceState.nativeEditorId, type: "focusProjectEditorPane" });
  void refreshProjectDiffStats(project.projectId);
  return true;
}

function openProjectEditorForGroup(groupId: string): void {
  const startedAtMs = performance.now();
  appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupStart", {
    activeProjectId,
    groupId,
  });
  const reference = resolveSidebarGroupReference(groupId);
  const project = reference.project;
  if (project.isChat === true || project.isRecentProject === true) {
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupSkippedProject", {
      elapsedMs: performance.now() - startedAtMs,
      isChat: project.isChat === true,
      isRecentProject: project.isRecentProject === true,
      projectId: project.projectId,
    });
    return;
  }
  if (activeProjectId !== project.projectId) {
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupBeforeFocusProject", {
      elapsedMs: performance.now() - startedAtMs,
      nextProjectId: project.projectId,
      previousProjectId: activeProjectId,
    });
    focusProject(project.projectId);
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupAfterFocusProject", {
      elapsedMs: performance.now() - startedAtMs,
      projectId: project.projectId,
    });
  }
  const surfaceState = projectEditorSurfaceByProjectId.get(project.projectId);
  appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupResolved", {
    elapsedMs: performance.now() - startedAtMs,
    projectId: project.projectId,
    projectPath: project.path,
    surfaceIsOpen: surfaceState?.isOpen === true,
    surfaceIsSleeping: surfaceState?.isSleeping === true,
    surfaceMode: surfaceState?.mode,
    surfaceStatus: surfaceState?.status,
  });
  if (
    surfaceState?.mode === "code" &&
    surfaceState?.isSleeping !== true &&
    (surfaceState?.status === "opening" || surfaceState?.status === "running")
  ) {
    /**
     * CDXC:EditorPanes 2026-05-10-11:24
     * Clicking the revealed VS Code row for an already opening/running editor
     * must focus the existing project-owned pane. Re-sending start/create would
     * reset sidebar status to opening, while native only focuses the existing
     * same-URL pane and does not emit a fresh running event, causing a false
     * ten-second Code Error timeout.
     */
    cancelProjectEditorSleepTimer(project.projectId);
    if (surfaceState.status === "running") {
      cancelProjectEditorOpenTimer(project.projectId);
    }
    projectEditorSurfaceByProjectId.set(project.projectId, {
      ...surfaceState,
      errorMessage: undefined,
      isOpen: true,
      isSleeping: false,
    });
    setProjectEditorPersistedOpen(project.projectId, true, "focusProjectEditor");
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupBeforeExistingFocusPost", {
      elapsedMs: performance.now() - startedAtMs,
      nativeEditorId: surfaceState.nativeEditorId,
      projectId: project.projectId,
    });
    postNative({ projectId: surfaceState.nativeEditorId, type: "focusProjectEditorPane" });
    void refreshProjectDiffStats(project.projectId);
    publish();
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupExistingDone", {
      elapsedMs: performance.now() - startedAtMs,
      nativeEditorId: surfaceState.nativeEditorId,
      projectId: project.projectId,
    });
    return;
  }
  /**
   * CDXC:EditorPanes 2026-05-06-14:21
   * Opening a project editor should replace the workspace surface without
   * becoming a split session. Start the shared code-server runtime once, then
   * bind a project-owned CEF view to the folder URL and keep that view alive
   * across later project switches.
   */
  projectEditorSurfaceByProjectId.set(project.projectId, {
    errorMessage: undefined,
    isOpen: true,
    isSleeping: false,
    mode: "code",
    nativeEditorId: createNativeProjectEditorId(project.projectId, "code"),
    status: "opening",
    title: projectEditorTitle(project),
    url: createCodeServerProjectEditorUrl(project.path),
  });
  setProjectEditorPersistedOpen(project.projectId, true, "openProjectEditor");
  scheduleProjectEditorOpenTimeout(project.projectId);
  appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupBeforeWake", {
    elapsedMs: performance.now() - startedAtMs,
    nativeEditorId: createNativeProjectEditorId(project.projectId, "code"),
    projectId: project.projectId,
  });
  wakeProjectEditorSurface(project);
  appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupAfterWake", {
    elapsedMs: performance.now() - startedAtMs,
    nativeEditorId: createNativeProjectEditorId(project.projectId, "code"),
    projectId: project.projectId,
  });
  postNative({
    projectId: createNativeProjectEditorId(project.projectId, "code"),
    type: "focusProjectEditorPane",
  });
  appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupAfterFocusPost", {
    elapsedMs: performance.now() - startedAtMs,
    nativeEditorId: createNativeProjectEditorId(project.projectId, "code"),
    projectId: project.projectId,
  });
  void refreshProjectDiffStats(project.projectId);
  publish();
  appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarOpenForGroupDone", {
    elapsedMs: performance.now() - startedAtMs,
    nativeEditorId: createNativeProjectEditorId(project.projectId, "code"),
    projectId: project.projectId,
  });
}

function openActiveProjectEditorFromTitlebar(): void {
  const startedAtMs = performance.now();
  const project = activeProject();
  appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarTitlebarHandlerStart", {
    activeProjectId,
    projectId: project.projectId,
    projectPath: project.path,
  });
  if (project.isChat === true || project.isRecentProject === true) {
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarTitlebarHandlerSkippedProject", {
      elapsedMs: performance.now() - startedAtMs,
      isChat: project.isChat === true,
      isRecentProject: project.isRecentProject === true,
      projectId: project.projectId,
    });
    return;
  }
  /**
   * CDXC:TitlebarOpenIn 2026-05-11-00:22
   * The titlebar "Embedded Editor" and "Code" buttons must behave exactly like
   * the sidebar project-header VS Code row. Route both through the same
   * project-editor opener instead of duplicating code-server startup/focus
   * decisions in the titlebar webview or Swift.
  */
  openProjectEditorForGroup(createCombinedProjectGroupId(project.projectId));
  appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarTitlebarHandlerDone", {
    elapsedMs: performance.now() - startedAtMs,
    projectId: project.projectId,
  });
}

function openAgentsModeFromTitlebar(): void {
  const project = activeProject();
  if (project.isChat === true || project.isRecentProject === true) {
    return;
  }
  /**
   * CDXC:ModeSwitcher 2026-05-15-12:38:
   * The Agents button is the inverse of Code mode: return the project workarea
   * to its session panes while keeping the combined sessions sidebar visible.
   */
  activateWorkspaceSurfaceForProject(project.projectId);
  const focusedSessionId = activeSnapshot().focusedSessionId;
  if (focusedSessionId) {
    queueNativeLayoutFocusRequest(focusedSessionId, "titlebarAgentsMode");
  }
  publish();
}

function showProjectEditorCompanionFromTitlebar(): void {
  const project = activeProject();
  if (project.isChat === true || project.isRecentProject === true) {
    return;
  }
  setProjectEditorCompanionPaneHidden(
    project.projectId,
    false,
    "showProjectEditorCompanionFromTitlebar",
  );
  publish();
}

function openProjectGitEditorSurface(project: NativeProject, githubUrl: string): void {
  if (activeProjectId !== project.projectId) {
    focusProject(project.projectId);
  }
  const nativeEditorId = createNativeProjectEditorId(project.projectId, "git");
  const surfaceState = projectEditorSurfaceByProjectId.get(project.projectId);
  if (
    surfaceState?.mode === "git" &&
    surfaceState.url === githubUrl &&
    surfaceState.isSleeping !== true &&
    (surfaceState.status === "opening" || surfaceState.status === "running")
  ) {
    cancelProjectEditorSleepTimer(project.projectId);
    if (surfaceState.status === "running") {
      cancelProjectEditorOpenTimer(project.projectId);
    }
    projectEditorSurfaceByProjectId.set(project.projectId, {
      ...surfaceState,
      errorMessage: undefined,
      isOpen: true,
      isSleeping: false,
    });
    postNative({ projectId: surfaceState.nativeEditorId, type: "focusProjectEditorPane" });
    publish();
    return;
  }

  /**
   * CDXC:ModeSwitcher 2026-05-15-13:18:
   * Git mode must use the same project-editor shell as Code mode: the selected
   * session stays in the left companion pane while the right Chromium surface
   * shows the active project's GitHub remote. Do not create a browser session
   * card, because that puts GitHub into the normal tabbed session workspace
   * instead of the Code-style side-pane layout the mode switcher promises.
   *
   * CDXC:ModeSwitcher 2026-05-15-14:42:
   * Code, Git, and tasks-backed Project modes must keep separate native
   * project-editor CEF panes. Native receives mode-scoped editor IDs so
   * switching modes changes the visible pane without reloading the other pages.
   */
  cancelProjectEditorSleepTimer(project.projectId);
  const isAwakeGitPane = hasAwakeProjectEditorMode(project.projectId, "git");
  if (isAwakeGitPane) {
    cancelProjectEditorOpenTimer(project.projectId);
  } else {
    scheduleProjectEditorOpenTimeout(project.projectId);
  }
  projectEditorSurfaceByProjectId.set(project.projectId, {
    errorMessage: undefined,
    isOpen: true,
    isSleeping: false,
    mode: "git",
    nativeEditorId,
    status: isAwakeGitPane ? "running" : "opening",
    title: "GitHub",
    url: githubUrl,
  });
  rememberAwakeProjectEditorMode(project.projectId, "git");
  postNative({
    companionPaneHidden: project.projectEditorCompanionPaneHidden === true,
    mode: "git",
    projectId: nativeEditorId,
    projectTitle: projectEditorTitle(project),
    showsBrowserToolbar: true,
    showsProjectTabs: true,
    title: "GitHub",
    type: "createProjectEditorPane",
    url: githubUrl,
  });
  postNative({ projectId: nativeEditorId, type: "focusProjectEditorPane" });
  stopCodeServerRuntimeIfEveryEditorSleeping();
  void refreshProjectDiffStats(project.projectId);
  publish();
}

function openProjectTasksEditorSurface(project: NativeProject, tasksUrl: string): void {
  if (activeProjectId !== project.projectId) {
    focusProject(project.projectId);
  }
  const nativeEditorId = createNativeProjectEditorId(project.projectId, "tasks");
  const surfaceState = projectEditorSurfaceByProjectId.get(project.projectId);
  if (
    surfaceState?.mode === "tasks" &&
    surfaceState.url === tasksUrl &&
    surfaceState.isSleeping !== true &&
    (surfaceState.status === "opening" || surfaceState.status === "running")
  ) {
    cancelProjectEditorSleepTimer(project.projectId);
    if (surfaceState.status === "running") {
      cancelProjectEditorOpenTimer(project.projectId);
    }
    projectEditorSurfaceByProjectId.set(project.projectId, {
      ...surfaceState,
      errorMessage: undefined,
      isOpen: true,
      isSleeping: false,
    });
    postNative({ projectId: surfaceState.nativeEditorId, type: "focusProjectEditorPane" });
    publish();
    return;
  }

  /**
   * CDXC:ModeSwitcher 2026-05-15-14:42:
   * The tasks-backed Project mode follows Git mode's project-editor behavior:
   * keep the sessions companion pane on the left, load the coming-soon
   * placeholder React page in a dedicated Project CEF pane on the right, and
   * preserve that pane across Code/Git/Project
   * mode switches instead of creating a normal browser session or reloading.
   *
   * CDXC:ProjectMode 2026-05-15-15:35:
   * User-facing names for this surface are Project, even though the internal
   * mode key remains "tasks" to preserve existing native editor IDs.
   */
  cancelProjectEditorSleepTimer(project.projectId);
  const isAwakeTasksPane = hasAwakeProjectEditorMode(project.projectId, "tasks");
  if (isAwakeTasksPane) {
    cancelProjectEditorOpenTimer(project.projectId);
  } else {
    scheduleProjectEditorOpenTimeout(project.projectId);
  }
  projectEditorSurfaceByProjectId.set(project.projectId, {
    errorMessage: undefined,
    isOpen: true,
    isSleeping: false,
    mode: "tasks",
    nativeEditorId,
    status: isAwakeTasksPane ? "running" : "opening",
    title: "Project",
    url: tasksUrl,
  });
  rememberAwakeProjectEditorMode(project.projectId, "tasks");
  postNative({
    companionPaneHidden: project.projectEditorCompanionPaneHidden === true,
    mode: "tasks",
    projectId: nativeEditorId,
    projectTitle: projectEditorTitle(project),
    title: "Project",
    type: "createProjectEditorPane",
    url: tasksUrl,
  });
  postNative({ projectId: nativeEditorId, type: "focusProjectEditorPane" });
  stopCodeServerRuntimeIfEveryEditorSleeping();
  void refreshProjectDiffStats(project.projectId);
  publish();
}

async function openGitHubProjectFromTitlebar(): Promise<void> {
  const project = activeProject();
  if (project.isChat === true || project.isRecentProject === true) {
    return;
  }
  try {
    const repoCheck = await runGit(["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
    if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
      showNativeMessage("warning", "Open a Git repository to use Git mode.");
      return;
    }
    const remote = await runGit(["remote", "get-url", "origin"], { allowFailure: true });
    if (remote.exitCode !== 0) {
      showNativeMessage("warning", 'Add an "origin" remote before opening Git mode.');
      return;
    }
    const githubUrl = normalizeGitHubRemoteUrl(remote.stdout);
    if (!githubUrl) {
      showNativeMessage("warning", "The origin remote is not a GitHub URL.");
      return;
    }
    /**
     * CDXC:ModeSwitcher 2026-05-15-12:38:
     * Git mode should behave like Code mode at the app-shell level: keep the
     * project sessions sidebar visible, but put the project's GitHub remote in
     * the main workarea instead of launching the user's external browser.
     */
    openProjectGitEditorSurface(project, githubUrl);
  } catch (error) {
    showNativeMessage(
      "error",
      error instanceof Error ? error.message : "Could not open Git mode.",
    );
  }
}

function openTasksPlaceholderFromTitlebar(): void {
  const project = activeProject();
  if (project.isChat === true || project.isRecentProject === true) {
    return;
  }
  /**
   * CDXC:ModeSwitcher 2026-05-15-14:42:
   * Project mode is intentionally a bundled placeholder React page until the
   * full project product requirements are defined. Open it through the
   * tasks-backed project-editor CEF pane so the sessions companion and page
   * state survive mode switches.
   */
  const url = new URL("tasks-placeholder.html", window.location.href);
  url.searchParams.set("projectName", project.name);
  url.searchParams.set("projectPath", project.path);
  openProjectTasksEditorSurface(project, url.toString());
}

function normalizeGitHubRemoteUrl(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim().split(/\s+/)[0]?.replace(/\.git$/u, "") ?? "";
  if (!trimmed) {
    return undefined;
  }

  const sshMatch = /^git@github\.com:(?<path>[^#?]+)$/u.exec(trimmed);
  const sshPath = sshMatch?.groups?.path;
  if (sshPath) {
    return `https://github.com/${sshPath.replace(/^\/+/u, "").replace(/\.git$/u, "")}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "github.com") {
      return undefined;
    }
    const repoPath = parsed.pathname.replace(/^\/+/u, "").replace(/\.git$/u, "");
    if (!repoPath) {
      return undefined;
    }
    return `https://github.com/${repoPath}`;
  } catch {
    return undefined;
  }
}

function runSidebarCommandFromTitlebar(commandId: string): void {
  appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.titlebarCommandReceived", {
    commandId,
    commandIds: commands.map((candidate) => candidate.commandId),
    projectId: activeProject().projectId,
    projectPath: activeProject().path,
  });
  const command = commands.find((candidate) => candidate.commandId === commandId);
  if (!command) {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.titlebarCommandMissing", {
      commandId,
    });
    return;
  }
  /**
   * CDXC:TitlebarActions 2026-05-11-02:46
   * The titlebar Actions split button is a relocation of the sidebar-header
   * Actions control. Route clicks through the existing sidebar command runner
   * so browser actions, background terminal actions, and run-state feedback
   * keep the same behavior.
   */
  try {
    runNativeSidebarCommand(command);
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.titlebarCommandDone", {
      commandId,
    });
  } catch (error) {
    appendActionCrashTraceDebugLog("nativeSidebar.actionCrashTrace.titlebarCommandError", {
      commandId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

function rotateActivePaneLayoutClockwiseFromTitlebar(): void {
  const group = activeWorkspaceGroup();
  appendPaneLayoutTraceDebugLog("titlebarRotate.request", {
    groupId: group.groupId,
    hasPaneLayout: group.snapshot.paneLayout !== undefined,
    paneLayout: group.snapshot.paneLayout,
    visibleSessionIds: group.snapshot.visibleSessionIds,
  });
  if (isNativeSidebarDebugLoggingEnabled()) {
    console.info("[ghostex-native-sidebar] titlebar rotate panes clockwise", {
      groupId: group.groupId,
      hasPaneLayout: group.snapshot.paneLayout !== undefined,
      visibleSessionIds: group.snapshot.visibleSessionIds,
    });
  }
  const result = rotatePaneLayoutClockwiseInSimpleWorkspace(activeProject().workspace, group.groupId);
  if (!result.changed) {
    appendPaneLayoutTraceDebugLog("titlebarRotate.unchanged", {
      groupId: group.groupId,
      hasPaneLayout: group.snapshot.paneLayout !== undefined,
      visibleSessionIds: group.snapshot.visibleSessionIds,
    });
    if (isNativeSidebarDebugLoggingEnabled()) {
      console.info("[ghostex-native-sidebar] titlebar rotate panes unchanged", {
        groupId: group.groupId,
        hasPaneLayout: group.snapshot.paneLayout !== undefined,
        visibleSessionIds: group.snapshot.visibleSessionIds,
      });
    }
    return;
  }
  updateActiveProjectWorkspace(() => result.snapshot);
  appendPaneLayoutTraceDebugLog("titlebarRotate.applied", {
    groupId: group.groupId,
    paneLayout: activeWorkspaceGroup().snapshot.paneLayout,
  });
  publish();
}

function closeProjectEditorForGroup(groupId: string): void {
  const reference = resolveSidebarGroupReference(groupId);
  const project = reference.project;
  if (project.isChat === true || project.isRecentProject === true) {
    return;
  }
  const surfaceState = projectEditorSurfaceByProjectId.get(project.projectId);
  if (!surfaceState) {
    return;
  }
  /**
   * CDXC:EditorPanes 2026-05-06-18:55
   * Middle-click closes the editor page itself. Keep project diff stats intact
   * for the project header, but remove the project-owned CEF surface state and
   * stop the shared code-server runtime when no awake editor surfaces remain.
   */
  cancelProjectEditorSleepTimer(project.projectId);
  cancelProjectEditorOpenTimer(project.projectId);
  forgetAwakeProjectEditorModes(project.projectId);
  projectEditorSurfaceByProjectId.delete(project.projectId);
  setProjectEditorPersistedOpen(project.projectId, false, "closeProjectEditor");
  postNative({
    projectId: createNativeProjectEditorId(project.projectId, "code"),
    type: "closeProjectEditorPane",
  });
  postNative({
    projectId: createNativeProjectEditorId(project.projectId, "git"),
    type: "closeProjectEditorPane",
  });
  postNative({
    projectId: createNativeProjectEditorId(project.projectId, "tasks"),
    type: "closeProjectEditorPane",
  });
  stopCodeServerRuntimeIfEveryEditorSleeping();
  publish();
}

function activateWorkspaceSurfaceForProject(projectId: string): void {
  const surfaceState = projectEditorSurfaceByProjectId.get(projectId);
  if (!surfaceState?.isOpen) {
    return;
  }
  projectEditorSurfaceByProjectId.set(projectId, {
    ...surfaceState,
    isOpen: false,
  });
  setProjectEditorPersistedOpen(projectId, false, "activateWorkspaceSurface");
  scheduleProjectEditorSleep(projectId);
}

function shouldKeepProjectEditorOpenForNewSession(projectId: string): boolean {
  /**
   * CDXC:ProjectEditorCompanion 2026-05-15-01:39:
   * Creating a new terminal/browser/T3/command session from the sidebar while
   * embedded VS Code is open should behave like selecting an existing session:
   * keep the editor surface open and let the native focus command retarget the
   * left companion pane. Do not call activateWorkspaceSurfaceForProject here,
   * because that method intentionally returns the workarea to the agents view.
   */
  return projectEditorSurfaceByProjectId.get(projectId)?.isOpen === true;
}

function handleProjectEditorBackRequested(nativeEditorId: string): void {
  const projectId = projectIdFromProjectEditorId(nativeEditorId);
  const project = findProject(projectId);
  if (!project) {
    return;
  }
  /**
   * CDXC:ProjectEditorCompanion 2026-05-14-09:19:
   * The native companion Back control is a workarea-mode change, not a request
   * to destroy the project editor. Mark the editor no longer open and let the
   * existing sleep timer retire Chromium later, matching the normal agents-view
   * transition instead of adding a separate fallback close path.
   */
  if (activeProjectId !== projectId) {
    activeProjectId = projectId;
    writeStoredProjects("projectEditorBackRequested");
  }
  activateWorkspaceSurfaceForProject(projectId);
  const focusedSessionId = activeSnapshot().focusedSessionId;
  if (focusedSessionId) {
    queueNativeLayoutFocusRequest(focusedSessionId, "projectEditorBackRequested");
  }
  publish();
}

function handleProjectEditorCompanionPaneHiddenChanged(
  nativeEditorId: string,
  hidden: boolean,
): void {
  const projectId = projectIdFromProjectEditorId(nativeEditorId);
  const project = findProject(projectId);
  if (!project || project.isChat === true || project.isRecentProject === true) {
    return;
  }
  setProjectEditorCompanionPaneHidden(
    projectId,
    hidden,
    "projectEditorCompanionPaneHiddenChanged",
  );
  publish();
}

function handleProjectEditorTabSelected(nativeEditorId: string, url?: string): void {
  const parsed = parseNativeProjectEditorId(nativeEditorId);
  if (!parsed) {
    return;
  }
  const project = findProject(parsed.projectId);
  const surfaceState = projectEditorSurfaceByProjectId.get(parsed.projectId);
  if (!project) {
    return;
  }
  /**
   * CDXC:GitProjectTabs 2026-05-16-09:50:
   * Native Git-project chrome is allowed to correct stale sidebar mode state.
   * Toolbar actions such as Back first focus the AppKit Git pane, then React's
   * next layout command must keep that Git CEF pane active instead of reusing a
   * previous Code-mode surface for the same project. Accept the native
   * project-editor id even when the stored surface currently points at another
   * project-editor mode, and persist the active Git tab URL supplied by native.
   */
  if (activeProjectId !== parsed.projectId) {
    activeProjectId = parsed.projectId;
    writeStoredProjects("projectEditorTabSelected");
  }
  const isSameNativeEditor = surfaceState?.nativeEditorId === nativeEditorId;
  projectEditorSurfaceByProjectId.set(parsed.projectId, {
    errorMessage: undefined,
    isOpen: true,
    isSleeping: false,
    mode: parsed.mode,
    nativeEditorId,
    status: isSameNativeEditor && surfaceState ? surfaceState.status : "running",
    title: projectEditorSurfaceTitleForMode(project, parsed.mode),
    url: url ?? (isSameNativeEditor && surfaceState ? surfaceState.url : undefined),
  });
  cancelProjectEditorSleepTimer(parsed.projectId);
  rememberAwakeProjectEditorMode(parsed.projectId, parsed.mode);
  void refreshProjectDiffStats(project.projectId);
  publish();
}

function disposeProjectEditorSurface(projectId: string): void {
  cancelProjectEditorSleepTimer(projectId);
  cancelProjectEditorOpenTimer(projectId);
  forgetAwakeProjectEditorModes(projectId);
  projectEditorSurfaceByProjectId.delete(projectId);
  projectDiffStatsByProjectId.delete(projectId);
  pendingProjectDiffRefreshProjectIds.delete(projectId);
  setProjectEditorPersistedOpen(projectId, false, "disposeProjectEditor");
  postNative({
    projectId: createNativeProjectEditorId(projectId, "code"),
    type: "closeProjectEditorPane",
  });
  postNative({
    projectId: createNativeProjectEditorId(projectId, "git"),
    type: "closeProjectEditorPane",
  });
  postNative({
    projectId: createNativeProjectEditorId(projectId, "tasks"),
    type: "closeProjectEditorPane",
  });
  if (projectEditorSurfaceByProjectId.size === 0) {
    postNative({ type: "stopCodeServerRuntime" });
  }
}

function toggleCommandsPanelFromTitlebar(): void {
  /**
   * CDXC:CommandsPanel 2026-05-13-22:54
   * The Commands panel launcher lives in the native titlebar. Keep the actual
   * panel state transition in the sidebar model so the bottom pane, command
   * terminals, persistence, and native layout sync all use one owner.
   */
  toggleCommandsPanelForActiveProject();
}

function togglePetOverlayFromTitlebar(): void {
  /**
   * CDXC:PetOverlay 2026-05-15-00:36:
   * The titlebar robot button is a direct pet-awake toggle. Persist it through
   * the same settings owner as the modal so the overlay, titlebar state, and
   * shared settings snapshot stay synchronized.
   */
  saveSettings({
    ...settings,
    petOverlayEnabled: !settings.petOverlayEnabled,
  });
}

function reorderProjects(projectIds: string[]): void {
  const requestedIds = projectIds.filter((projectId) =>
    projects.some((project) => project.projectId === projectId),
  );
  if (requestedIds.length === 0) {
    return;
  }

  /**
   * CDXC:WorkspaceDock 2026-04-27-08:22
   * Workspace rail drag/drop reorders workareas persistently. Preserve any
   * projects missing from the drag payload at the end so stale rail messages
   * cannot drop workspaces from localStorage.
   */
  const requestedIdSet = new Set(requestedIds);
  const orderedProjects = requestedIds
    .map((projectId) => projects.find((project) => project.projectId === projectId))
    .filter((project): project is NativeProject => Boolean(project));
  const remainingProjects = projects.filter((project) => !requestedIdSet.has(project.projectId));
  const nextProjects = orderNativeProjectsForSidebar([...orderedProjects, ...remainingProjects]);
  if (
    nextProjects.length === projects.length &&
    nextProjects.every((project, index) => project.projectId === projects[index]?.projectId)
  ) {
    return;
  }

  projects = nextProjects;
  writeStoredProjects("reorderProjects");
  publish();
}

function saveSidebarAgent(
  message: Extract<SidebarToExtensionMessage, { type: "saveSidebarAgent" }>,
): void {
  const name = message.name.trim();
  const command = message.command.trim();
  if (!name || !command) {
    return;
  }

  const currentAgentIds = agents.map((candidate) => candidate.agentId);
  const requestedAgentId = message.agentId?.trim();
  const selectedDefaultAgent = getDefaultSidebarAgentByIcon(message.icon);
  const shouldRestoreHiddenDefault =
    !requestedAgentId &&
    Boolean(
      selectedDefaultAgent && !isSidebarAgentVisible(storedAgents, selectedDefaultAgent.agentId),
    );
  const agentId =
    requestedAgentId ||
    (shouldRestoreHiddenDefault ? selectedDefaultAgent?.agentId : undefined) ||
    createCustomAgentId(name);
  const existingIndex = storedAgents.findIndex((agent) => agent.agentId === agentId);
  const previousAgent = existingIndex >= 0 ? storedAgents[existingIndex] : undefined;
  const defaultAgent = getDefaultSidebarAgentById(agentId);
  const nextAgent: StoredSidebarAgent = {
    agentId,
    command,
    hidden: false,
    icon: message.icon ?? previousAgent?.icon ?? defaultAgent?.icon,
    isDefault: isDefaultSidebarAgentId(agentId),
    name,
  };
  const nextAgents =
    existingIndex >= 0
      ? storedAgents.map((agent, index) => (index === existingIndex ? nextAgent : agent))
      : [...storedAgents, nextAgent];
  const nextOrder =
    existingIndex >= 0 || storedAgentOrder.includes(agentId) || isDefaultSidebarAgentId(agentId)
      ? storedAgentOrder
      : [...currentAgentIds, agentId];

  writeStoredAgents(nextAgents);
  if (!areStringArraysEqual(nextOrder, storedAgentOrder)) {
    writeStoredAgentOrder(nextOrder);
  }
  publish();
}

function deleteSidebarAgent(agentId: string): void {
  if (!isDefaultSidebarAgentId(agentId)) {
    writeStoredAgents(storedAgents.filter((agent) => agent.agentId !== agentId));
    writeStoredAgentOrder(
      storedAgentOrder.filter((candidateAgentId) => candidateAgentId !== agentId),
    );
    publish();
    return;
  }

  const defaultAgent = getDefaultSidebarAgentById(agentId);
  if (!defaultAgent) {
    return;
  }

  const existingIndex = storedAgents.findIndex((agent) => agent.agentId === agentId);
  const nextAgent: StoredSidebarAgent = {
    agentId: defaultAgent.agentId,
    command: storedAgents[existingIndex]?.command ?? defaultAgent.command,
    hidden: true,
    icon: storedAgents[existingIndex]?.icon ?? defaultAgent.icon,
    isDefault: true,
    name: storedAgents[existingIndex]?.name ?? defaultAgent.name,
  };
  const nextAgents =
    existingIndex >= 0
      ? storedAgents.map((agent, index) => (index === existingIndex ? nextAgent : agent))
      : [...storedAgents, nextAgent];

  writeStoredAgents(nextAgents);
  writeStoredAgentOrder(
    storedAgentOrder.filter((candidateAgentId) => candidateAgentId !== agentId),
  );
  publish();
}

function syncSidebarAgentOrder(requestId: string, agentIds: readonly string[]): void {
  const currentAgentIds = agents.map((agent) => agent.agentId);
  const normalizedAgentIds = normalizeStoredSidebarAgentOrder(agentIds).filter((agentId) =>
    currentAgentIds.includes(agentId),
  );
  const nextOrder = [
    ...normalizedAgentIds,
    ...currentAgentIds.filter((agentId) => !normalizedAgentIds.includes(agentId)),
  ];
  writeStoredAgentOrder(nextOrder);
  sidebarBus.post({
    itemIds: agents.map((agent) => agent.agentId),
    kind: "agent",
    requestId,
    status: "success",
    type: "sidebarOrderSyncResult",
  });
  publish();
}

function saveSidebarCommand(
  message: Extract<SidebarToExtensionMessage, { type: "saveSidebarCommand" }>,
): void {
  const name = message.name.trim();
  const command = message.command?.trim();
  const url = message.url?.trim();
  const iconColor = message.icon
    ? (normalizeSidebarCommandIconColor(message.iconColor) ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR)
    : undefined;

  if (!name && !message.icon) {
    return;
  }
  if (message.actionType === "browser" && !url) {
    return;
  }
  if (message.actionType === "terminal" && !command) {
    return;
  }

  const currentCommandIds = commands.map((candidate) => candidate.commandId);
  const commandId = message.commandId?.trim() || createCustomCommandId();
  const nextCommand: StoredSidebarCommand = {
    actionType: message.actionType,
    closeTerminalOnExit: message.actionType === "terminal" ? message.closeTerminalOnExit : false,
    commandId,
    isDefault: isDefaultSidebarCommandId(commandId),
    ...(message.isGlobal === true ? { isGlobal: true } : {}),
    name,
    playCompletionSound: message.actionType === "terminal" ? message.playCompletionSound : false,
    ...(message.icon ? { icon: message.icon, iconColor } : {}),
    ...(message.actionType === "browser" ? { url } : { command }),
  };
  const nextCommandTitle = getNativeSidebarActionTitle(nextCommand);
  const nextCommandTitleKey = getNativeSidebarCommandTitleKey(nextCommandTitle);
  /**
   * CDXC:CommandPanes 2026-05-16-15:08:
   * Command-pane identity is the configured action title inside the active
   * project. Reject duplicate action titles at save time so repeat-click pane
   * reuse cannot ambiguously target another command's tab.
   */
  const duplicateCommand = commands.find(
    (candidate) =>
      candidate.commandId !== commandId &&
      getNativeSidebarCommandTitleKey(getNativeSidebarActionTitle(candidate)) ===
        nextCommandTitleKey,
  );
  if (duplicateCommand) {
    showNativeMessage(
      "warning",
      `An action titled "${nextCommandTitle}" already exists in this project.`,
    );
    return;
  }
  const existingIndex = storedCommands.findIndex((candidate) => candidate.commandId === commandId);
  const nextCommands =
    existingIndex >= 0
      ? storedCommands.map((candidate, index) =>
          index === existingIndex ? nextCommand : candidate,
        )
      : [...storedCommands, nextCommand];
  const nextOrder =
    existingIndex >= 0 ||
    storedCommandOrder.includes(commandId) ||
    isDefaultSidebarCommandId(commandId)
      ? storedCommandOrder
      : currentCommandIds.includes(commandId)
        ? currentCommandIds
        : [...currentCommandIds, commandId];

  writeStoredCommands(nextCommands);
  if (!areStringArraysEqual(nextOrder, storedCommandOrder)) {
    writeStoredCommandOrder(nextOrder);
  }
  if (isDefaultSidebarCommandId(commandId) && deletedDefaultCommandIds.includes(commandId)) {
    writeDeletedDefaultCommandIds(
      deletedDefaultCommandIds.filter((candidateCommandId) => candidateCommandId !== commandId),
    );
  }
  publish();
}

function deleteSidebarCommand(commandId: string): void {
  const existingSession = sidebarCommandSessionByCommandId.get(commandId);
  if (existingSession) {
    closeNativeSidebarCommandSession(existingSession.sessionId);
  }
  writeStoredCommands(storedCommands.filter((command) => command.commandId !== commandId));
  writeStoredCommandOrder(
    storedCommandOrder.filter((candidateCommandId) => candidateCommandId !== commandId),
  );
  if (isDefaultSidebarCommandId(commandId) && !deletedDefaultCommandIds.includes(commandId)) {
    writeDeletedDefaultCommandIds([...deletedDefaultCommandIds, commandId]);
  }
  publish();
}

function syncSidebarCommandOrder(requestId: string, commandIds: readonly string[]): void {
  const currentCommandIds = commands.map((command) => command.commandId);
  const normalizedCommandIds = normalizeStoredSidebarCommandOrder(commandIds).filter((commandId) =>
    currentCommandIds.includes(commandId),
  );
  const nextOrder = [
    ...normalizedCommandIds,
    ...currentCommandIds.filter((commandId) => !normalizedCommandIds.includes(commandId)),
  ];
  writeStoredCommandOrder(nextOrder);
  sidebarBus.post({
    itemIds: commands.map((command) => command.commandId),
    kind: "command",
    requestId,
    status: "success",
    type: "sidebarOrderSyncResult",
  });
  publish();
}

function isSidebarAgentVisible(agents: readonly StoredSidebarAgent[], agentId: string): boolean {
  return agents.find((agent) => agent.agentId === agentId)?.hidden !== true;
}

function createCustomAgentId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return `custom-${slug || "agent"}-${Date.now().toString(36)}`;
}

function createCustomCommandId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function handleSidebarMessage(message: SidebarToExtensionMessage): void {
  /**
   * CDXC:NativeSidebarCommands 2026-04-26-00:47
   * Keep the native sidebar contract exhaustive. User-facing actions such as
   * agents, command buttons, groups, previous sessions, and workspace controls
   * are handled here so the native app matches the old sidebar experience.
   */
  switch (message.type) {
    case "createSession":
      createNativeSessionInCurrentContext();
      return;
    case "runGhostexHotkeyAction":
      runNativeHotkeyAction(message.actionId, "dom");
      return;
    case "togglePetOverlay":
      /**
       * CDXC:CommandPalette 2026-05-16-08:18:
       * The palette's Wake Pet/Sleep Pet row should use the same settings-owned
       * toggle as the native titlebar button so the pet overlay, titlebar, and
       * modal-host mirrored state all stay synchronized.
       */
      togglePetOverlayFromTitlebar();
      return;
    case "createFullWidthTerminalPane":
      createFullWidthTerminalPaneInCurrentProject();
      return;
    case "createChat":
      void createNativeChat(message.title);
      return;
    case "openPluginsBrowserChat":
      void createNativePluginsBrowserChat();
      return;
    case "openAgentsHubPathInFinder":
      openNativeWorkspaceInFinder(message.path);
      return;
    case "openAgentsHubFileInDefaultEditor":
      void openAgentsHubFileInDefaultEditor(message.filePath);
      return;
    case "requestAgentsHubCatalog":
      void requestAgentsHubCatalog();
      return;
    case "saveAgentsHubFile":
      void saveAgentsHubFile(message.filePath, message.content);
      return;
    case "openBrowserChat":
      void createNativeBrowserChat();
      return;
    case "createSessionInGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      if (groupReference.isChatCollection) {
        void createNativeChat();
        return;
      }
      if (!groupReference.groupId) {
        if (activeProjectId !== groupReference.project.projectId) {
          focusProject(groupReference.project.projectId);
        }
        createTerminal(DEFAULT_TERMINAL_SESSION_TITLE, "", undefined, undefined, {
          visiblePlacement: createFocusedTabGroupPlacement(),
        });
        return;
      }
      createTerminal(DEFAULT_TERMINAL_SESSION_TITLE, "", groupReference.groupId, undefined, {
        visiblePlacement: createFocusedTabGroupPlacement(groupReference.groupId),
      });
      return;
    }
    case "openBrowser":
      openNativeBrowserWindow(DEFAULT_BROWSER_LAUNCH_URL);
      return;
    case "openBrowserPane":
      /**
       * CDXC:ChromiumBrowserPanes 2026-05-04-17:00
       * The dedicated sidebar test button must create the Chromium pane
       * directly, not route through browserOpenMode where legacy Canary remains
       * a valid user setting for browser command actions.
       */
      createNativeBrowserSession(message.url ?? DEFAULT_BROWSER_LAUNCH_URL);
      return;
    case "openBrowserPaneInGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      if (groupReference.isChatCollection) {
        return;
      }
      if (activeProjectId !== groupReference.project.projectId) {
        focusProject(groupReference.project.projectId);
      }
      /**
       * CDXC:ProjectGroups 2026-05-11-11:51
       * The project header browser button is scoped to the clicked project.
       * Focus the resolved project first, then create the browser pane in the
       * resolved workspace group when one exists. Header-level pane creation
       * must append to the active tab group instead of introducing a new split,
       * preserving user-controlled pane sizing and grouping.
       */
      createNativeBrowserSession(DEFAULT_BROWSER_LAUNCH_URL, groupReference.groupId, {
        visiblePlacement: createFocusedTabGroupPlacement(groupReference.groupId),
      });
      return;
    }
    case "openWorkspaceWelcome":
      openAppModal({ modal: "tipsAndTricks", type: "open" });
      return;
    case "pickWorkspaceFolder":
      postNative({ type: "pickWorkspaceFolder" });
      return;
    case "openSettings":
      publish();
      return;
    case "requestGhostexFolderStats":
      void requestGhostexFolderStats();
      return;
    case "openGhostexFolder":
      openNativeWorkspaceInFinder(nativeGhostexHomeDirectory());
      return;
    case "refreshDaemonSessions":
      refreshDaemonSessionsState();
      return;
    case "killTerminalDaemon":
      closeAllNativeSessions();
      refreshDaemonSessionsState();
      return;
    case "killT3RuntimeServer":
      /**
       * CDXC:T3Code 2026-04-30-09:23
       * The native Running modal must control the same embedded T3 resources
       * that T3 panes create. Killing the T3 server asks Swift to stop the
       * managed localhost runtime instead of only refreshing modal state.
       */
      postNative({ type: "stopT3CodeRuntime" });
      refreshDaemonSessionsState();
      return;
    case "killT3RuntimeSession":
      closeTerminal(message.sessionId);
      refreshDaemonSessionsState();
      return;
    case "killDaemonSession":
      closeTerminal(message.sessionId);
      refreshDaemonSessionsState();
      return;
    case "moveSidebarToOtherSide":
      moveSidebarToOtherSide();
      return;
    case "cycleSessionPersistenceProvider":
      saveSettings({
        ...settings,
        sessionPersistenceProvider: nextSessionPersistenceProvider(
          settings.sessionPersistenceProvider,
        ),
      });
      return;
    case "adjustTerminalFontSize":
      saveSettings({
        ...settings,
        terminalFontSize: settings.terminalFontSize + message.delta,
      });
      return;
    case "createGroup": {
      updateActiveProjectWorkspace((workspace) => createGroupInSimpleWorkspace(workspace).snapshot);
      publish();
      return;
    }
    case "createGroupFromSession": {
      updateActiveProjectWorkspace(
        (workspace) =>
          createGroupFromSessionInSimpleWorkspace(workspace, message.sessionId).snapshot,
      );
      publish();
      return;
    }
    case "focusGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      if (!groupReference.groupId) {
        focusProject(groupReference.project.projectId);
        return;
      }
      updateActiveProjectWorkspace(
        (workspace) => focusGroupInSimpleWorkspace(workspace, message.groupId).snapshot,
      );
      publish();
      return;
    }
    case "focusSession":
      focusSidebarSession(message.sessionId);
      return;
    case "promptRenameSession": {
      const session = findTerminalSession(message.sessionId);
      if (session) {
        openAppModal({
          initialTitle: session.title || DEFAULT_TERMINAL_SESSION_TITLE,
          modal: "renameSession",
          sessionId: message.sessionId,
          type: "open",
        });
      }
      return;
    }
    case "renameSession":
      void renameNativeSidebarTerminalSession(
        message.sessionId,
        message.title,
        "native-sidebar-rename-session",
        { shouldGenerateTitle: message.shouldGenerateTitle },
      );
      return;
    case "renameGroup":
      updateActiveProjectWorkspace(
        (workspace) =>
          renameGroupInSimpleWorkspace(workspace, message.groupId, message.title).snapshot,
      );
      publish();
      return;
    case "copyWorkspaceProjectPathForGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      /*
       * CDXC:SidebarLayout 2026-05-13-08:11
       * Project groups need to copy the owning project's path from the group
       * context menu, so resolve the group id server-side instead of trusting
       * client-provided path text.
       */
      void navigator.clipboard?.writeText(groupReference.project.path).catch(() => undefined);
      return;
    }
    case "restoreRecentProject":
      restoreRecentProject(message.projectId);
      return;
    case "openWorkspaceProjectInFinderForGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      openNativeWorkspaceInFinder(groupReference.project.path);
      return;
    }
    case "openWorkspaceProjectInIdeForGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      openNativeWorkspaceInSelectedIde(groupReference.project.path);
      return;
    }
    case "openWorkspaceProjectEditorForGroup":
      openProjectEditorForGroup(message.groupId);
      return;
    case "closeWorkspaceProjectEditorForGroup":
      closeProjectEditorForGroup(message.groupId);
      return;
    case "refreshWorkspaceProjectDiffForGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      void refreshProjectDiffStats(groupReference.project.projectId);
      return;
    }
    case "openActiveWorkspaceProjectInFinder":
      openNativeWorkspaceInFinder(activeProject().path);
      return;
    case "openActiveWorkspaceProjectInIde":
      openNativeWorkspaceInSelectedIde(activeProject().path, message.targetApp);
      return;
    case "setWorkspaceProjectThemeForGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      const themeColor = normalizeWorkspaceThemeColor(message.themeColor);
      if (themeColor) {
        setProjectThemeColor(groupReference.project.projectId, themeColor);
        return;
      }
      if (message.theme) {
        setProjectTheme(groupReference.project.projectId, message.theme);
      }
      return;
    }
    case "closeWorkspaceProjectForGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      closeProjectToRecent(groupReference.project.projectId);
      return;
    }
    case "removeWorkspaceProjectForGroup": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      removeProject(groupReference.project.projectId);
      return;
    }
    case "closeSession":
      closeTerminal(message.sessionId);
      return;
    case "restartSession":
      restartNativeSession(message.sessionId);
      return;
    case "forkSession":
      forkNativeSession(message.sessionId);
      return;
    case "scheduleDelayedSend":
      scheduleDelayedSend(message.sessionId, message.delayMs);
      return;
    case "fullReloadSession":
      restartNativeSession(message.sessionId);
      return;
    case "attachToIde":
      saveSettings({
        ...settings,
        zedOverlayEnabled: true,
      });
      return;
    case "fullReloadGroup": {
      const group = activeProject().workspace.groups.find(
        (candidate) => candidate.groupId === message.groupId,
      );
      for (const session of group?.snapshot.sessions ?? []) {
        if (
          session.kind === "terminal" &&
          buildNativeRestoredTerminalInitialInput(session).trim()
        ) {
          restartNativeSession(session.sessionId);
        }
      }
      return;
    }
    case "copyResumeCommand":
      copyResumeCommand(message.sessionId);
      return;
    case "copyAttachCommand":
      copyAttachCommand(message.sessionId);
      return;
    case "requestT3SessionBrowserAccess":
      void requestNativeT3SessionBrowserAccess(message.sessionId);
      return;
    case "closeGroup": {
      const project = activeProject();
      const group = project.workspace.groups.find(
        (candidate) => candidate.groupId === message.groupId,
      );
      for (const session of group?.snapshot.sessions ?? []) {
        terminalStateById.delete(session.sessionId);
        titleDerivedActivityBySessionId.delete(session.sessionId);
        nativeActivitySuppressedUntilBySessionId.delete(session.sessionId);
        nativeWorkingStartedAtBySessionId.delete(session.sessionId);
        clearNativeSessionAttentionTracking(session.sessionId);
        const nativeSessionId = forgetNativeSessionMapping(session.sessionId);
        postNative({ sessionId: nativeSessionId, type: "closeTerminal" });
      }
      updateActiveProjectWorkspace(
        (workspace) => removeGroupInSimpleWorkspace(workspace, message.groupId).snapshot,
      );
      publish();
      return;
    }
    case "setSessionSleeping":
      setNativeSessionSleeping(message.sessionId, message.sleeping);
      return;
    case "setSessionFavorite":
      {
        const reference = resolveSidebarSessionReference(message.sessionId);
        updateProjectWorkspace(
          reference.project.projectId,
          (workspace) =>
            setSessionFavoriteInSimpleWorkspace(workspace, reference.sessionId, message.favorite)
              .snapshot,
        );
      }
      publish();
      return;
    case "setGroupSleeping": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      if (!groupReference.groupId) {
        return;
      }
      setNativeGroupSleeping(groupReference.groupId, message.sleeping);
      return;
    }
    case "moveSessionToGroup": {
      const sessionReference = resolveSidebarSessionReference(message.sessionId);
      const groupReference = resolveSidebarGroupReference(message.groupId);
      if (
        !groupReference.groupId ||
        groupReference.project.projectId !== sessionReference.project.projectId
      ) {
        return;
      }
      const targetGroupId = groupReference.groupId;
      updateProjectWorkspace(
        sessionReference.project.projectId,
        (workspace) =>
          moveSessionToGroupInSimpleWorkspace(
            workspace,
            sessionReference.sessionId,
            targetGroupId,
            message.targetIndex,
          ).snapshot,
      );
      publish();
      return;
    }
    case "toggleFullscreenSession":
      updateActiveProjectWorkspace((workspace) =>
        toggleFullscreenSessionInSimpleWorkspace(workspace),
      );
      publish();
      return;
    case "syncGroupOrder": {
      const combinedProjectIds = message.groupIds
        .filter((groupId) => groupId !== COMBINED_CHATS_GROUP_ID)
        .map((groupId) => parseCombinedProjectGroupId(groupId));
      if (
        combinedProjectIds.length > 0 &&
        combinedProjectIds.every((projectId): projectId is string => projectId !== undefined)
      ) {
        /**
         * CDXC:Chats 2026-05-04-09:41
         * The synthetic Chats group is pinned above projects and excluded from
         * drag persistence. Reorder only concrete project groups from Combined
         * mode so chats stay under one stable top header.
         *
         * CDXC:SidebarLayout 2026-05-13-08:11
         * Group dragging reorders projects. Session drag is disabled in the
         * React view, so this path cannot move sessions across projects.
         */
        reorderProjects(combinedProjectIds);
        return;
      }
      if (message.groupIds.includes(COMBINED_CHATS_GROUP_ID)) {
        return;
      }
      updateActiveProjectWorkspace(
        (workspace) => syncGroupOrderInSimpleWorkspace(workspace, message.groupIds).snapshot,
      );
      publish();
      return;
    }
    case "toggleActiveSessionsSortMode":
      toggleActiveSessionsSortMode();
      return;
    case "saveScratchPad":
      saveScratchPadContent(message.content);
      return;
    case "savePinnedPrompt":
      savePinnedPrompt(message);
      return;
    case "restorePreviousSession":
      restorePreviousSession(message.historyId);
      return;
    case "deletePreviousSession":
      deletePreviousSession(message.historyId);
      return;
    case "clearGeneratedPreviousSessions":
      clearGeneratedPreviousSessions();
      return;
    case "promptFindPreviousSession":
      if (message.query?.trim()) {
        promptFindPreviousSession(message.query);
      } else {
        openAppModal({ modal: "findPreviousSession", type: "open" });
      }
      return;
    case "setT3SessionThreadId":
      void relinkNativeT3SessionThread(message.sessionId, message.threadId);
      return;
    case "runSidebarGitAction":
      void runSidebarGitAction(message.action);
      return;
    case "setSidebarGitPrimaryAction":
      setGitPrimaryAction(message.action);
      return;
    case "refreshGitState":
      void refreshGitState();
      return;
    case "setSidebarGitCommitConfirmationEnabled":
      setGitCommitConfirmationEnabled(message.enabled);
      return;
    case "setSidebarGitGenerateCommitBodyEnabled":
      setGitGenerateCommitBodyEnabled(message.enabled);
      return;
    case "confirmSidebarGitCommit":
      void continueGitActionAfterCommitConfirmation(message.requestId, message.message);
      return;
    case "cancelSidebarGitCommit":
      pendingGitCommitRequests.delete(message.requestId);
      publish();
      return;
    case "setSidebarSectionCollapsed":
      setSidebarSectionCollapsed(message.section, message.collapsed);
      return;
    case "openT3SessionBrowserAccessLink":
      openNativeExternalUrl(message.url);
      return;
    case "runBrowserPaneAction": {
      const reference = resolveSidebarSessionReference(message.sessionId);
      const sessionRecord = findSessionRecordInProject(reference.project, reference.sessionId);
      if (sessionRecord?.kind !== "browser") {
        return;
      }
      const nativeSessionId = nativeSessionIdForProjectSidebarSession(
        reference.project.projectId,
        reference.sessionId,
      );
      switch (message.action) {
        case "devtools":
          postNative({ sessionId: nativeSessionId, type: "openBrowserDevTools" });
          return;
        case "react-grab":
          postNative({ sessionId: nativeSessionId, type: "injectBrowserReactGrab" });
          return;
        case "profile-picker":
          postNative({ sessionId: nativeSessionId, type: "showBrowserProfilePicker" });
          return;
        case "import-settings":
          postNative({ sessionId: nativeSessionId, type: "showBrowserImportSettings" });
          return;
      }
    }
    case "sidebarDebugLog":
      if (message.event === "repro.sidebarSessionFocusRequested") {
        recordSidebarCardFocusTrace(message.details);
        return;
      }
      if (!isNativeSidebarDebugLoggingEnabled()) {
        return;
      }
      if (message.event.startsWith(SIDEBAR_REFRESH_DEBUG_EVENT_PREFIX)) {
        appendSidebarRefreshDebugLog(message.event, message.details);
        return;
      }
      if (message.event.startsWith("sidebar.agentIcon.")) {
        appendAgentDetectionDebugLog(message.event, message.details);
      }
      if (message.event.startsWith("scratchPadFocus.")) {
        appendTerminalFocusDebugLog(message.event, message.details);
      }
      console.debug("[ghostex-native-sidebar]", message.event, message.details);
      return;
    case "runSidebarAgent": {
      const agent = agents.find((candidate) => candidate.agentId === message.agentId);
      const groupReference =
        typeof message.groupId === "string"
          ? resolveSidebarGroupReference(message.groupId)
          : undefined;
      if (groupReference?.isChatCollection) {
        return;
      }
      if (groupReference && activeProjectId !== groupReference.project.projectId) {
        focusProject(groupReference.project.projectId);
      }
      const groupId = groupReference?.groupId;
      const visiblePlacement = createFocusedTabGroupPlacement(groupId);
      if (agent?.agentId === "t3") {
        createNativeT3Session(groupId, { visiblePlacement });
      } else if (agent?.command) {
        /**
         * CDXC:PaneTabs 2026-05-11-11:51
         * Project-header agent buttons create terminal-backed agent sessions.
         * They must use the same focused tab group placement as the plain
         * terminal button so launching an agent never changes split geometry.
         */
        createTerminal(
          createAgentSessionDefaultTitle(agent.name),
          `${agent.command}\r`,
          groupId,
          agent.agentId,
          { visiblePlacement },
        );
      }
      return;
    }
    case "saveSidebarAgent":
      saveSidebarAgent(message);
      return;
    case "deleteSidebarAgent":
      deleteSidebarAgent(message.agentId);
      return;
    case "syncSidebarAgentOrder":
      syncSidebarAgentOrder(message.requestId, message.agentIds);
      return;
    case "runSidebarCommand": {
      const command = commands.find((candidate) => candidate.commandId === message.commandId);
      if (command) {
        runNativeSidebarCommand(command, message.runMode);
      }
      return;
    }
    case "endSidebarCommandRun":
      if (message.commandId) {
        const existingSession = sidebarCommandSessionByCommandId.get(message.commandId);
        if (existingSession) {
          closeNativeSidebarCommandSession(existingSession.sessionId);
        }
        clearNativeSidebarCommandRunState(message.commandId);
      }
      publish();
      return;
    case "saveSidebarCommand":
      saveSidebarCommand(message);
      return;
    case "deleteSidebarCommand":
      deleteSidebarCommand(message.commandId);
      return;
    case "syncSidebarCommandOrder":
      syncSidebarCommandOrder(message.requestId, message.commandIds);
      return;
    case "toggleCompletionBell":
      saveSettings({
        ...settings,
        completionBellEnabled: !settings.completionBellEnabled,
      });
      return;
    case "updateSettings":
      saveSettings(message.settings);
      return;
    case "applyRecommendedGhosttySettings":
      applyRecommendedGhosttySettings();
      return;
    case "resetGhosttySettingsToDefault":
      resetGhosttySettingsToDefault();
      return;
    case "openGhosttySettingsDocs":
      openNativeExternalUrl(GHOSTTY_SETTINGS_DOCS_URL);
      return;
    case "openGhosttyConfigFile":
      openGhosttyConfigFile();
      return;
    case "installZapet":
      void installZapetFromBrew();
      return;
    case "openAccessibilityPreferences":
      postNative({ type: "openAccessibilityPreferences" });
      return;
    case "requestMacOSNotificationPermission":
      postNative({ type: "requestMacOSNotificationPermission" });
      return;
    case "openMacOSNotificationSettings":
      postNative({ type: "openMacOSNotificationSettings" });
      return;
    case "playCompletionSoundPreview":
      playNativeSound(message.sound);
      return;
    case "testAgentTaskCompletion":
      testNativeAgentTaskCompletion();
      return;
    case "setVisibleCount":
      if (typeof message.groupId === "string") {
        const groupReference = resolveSidebarGroupReference(message.groupId);
        if (groupReference.isChatCollection) {
          return;
        }
        if (activeProjectId !== groupReference.project.projectId) {
          focusProject(groupReference.project.projectId);
        }
        updateActiveProjectWorkspace((workspace) =>
          setVisibleCountInSimpleWorkspace(
            groupReference.groupId
              ? focusGroupInSimpleWorkspace(workspace, groupReference.groupId).snapshot
              : workspace,
            message.visibleCount,
          ),
        );
        publish();
        return;
      }
      updateActiveProjectWorkspace((workspace) =>
        setVisibleCountInSimpleWorkspace(workspace, message.visibleCount),
      );
      publish();
      return;
    case "setViewMode":
      updateActiveProjectWorkspace((workspace) =>
        setViewModeInSimpleWorkspace(workspace, message.viewMode),
      );
      publish();
      return;
    case "syncSessionOrder": {
      const groupReference = resolveSidebarGroupReference(message.groupId);
      if (!groupReference.groupId) {
        return;
      }
      const groupId = groupReference.groupId;
      updateProjectWorkspace(
        groupReference.project.projectId,
        (workspace) =>
          syncSessionOrderInSimpleWorkspace(workspace, groupId, message.sessionIds).snapshot,
      );
      publish();
      return;
    }
    default:
      return;
  }
}

/**
 * CDXC:EditorPanes 2026-05-06-16:02
 * Sidebar-only publishes, including project diff refreshes triggered by
 * hovering the editor launcher, must not reapply the native AppKit pane layout.
 * Active project editors are CEF surfaces; redundant setActiveTerminalSet
 * commands reorder and reframe the hosted editor view, which causes visible
 * flicker even though no layout state changed. Send native layout sync only
 * when the actual layout payload changes, while still allowing explicit focus
 * requests and newly recreated native surfaces through.
 */
function postNativeLayoutSync(
  command: NativeSetActiveTerminalSetCommand,
  options: { force?: boolean } = {},
): { didPost: boolean; layoutChanged: boolean } {
  const commandSyncKey = createNativeCommandSyncKey(command);
  const layoutSyncKey = createNativeLayoutSyncKey(command);
  const layoutChanged = options.force === true || layoutSyncKey !== lastNativeLayoutSyncKey;
  if (
    options.force !== true &&
    command.focusRequestId === undefined &&
    commandSyncKey === lastNativeSetActiveTerminalSetCommandKey
  ) {
    return { didPost: false, layoutChanged };
  }
  lastNativeSetActiveTerminalSetCommandKey = commandSyncKey;
  lastNativeLayoutSyncKey = layoutSyncKey;
  postNative({ ...command, layoutChanged });
  return { didPost: true, layoutChanged };
}

function createNativeCommandSyncKey(command: NativeSetActiveTerminalSetCommand): string {
  const { focusRequestId: _focusRequestId, ...layoutCommand } = command;
  return JSON.stringify(normalizeNativeLayoutSyncValue(layoutCommand));
}

function getNativeCommandPaneTabActivity(
  sessionId: string,
  terminalActivity: "attention" | "idle" | "working" | undefined,
): "attention" | "working" | undefined {
  /**
   * CDXC:CommandPanes 2026-05-15-20:01:
   * Command-pane tabs should use the same native tab activity dot as workspace pane tabs. A mapped command run with an active run id is working even when the reusable terminal has not changed its title-derived activity yet; idle command panes should send no activity so the tab has no dot.
   */
  if (terminalActivity === "attention" || terminalActivity === "working") {
    return terminalActivity;
  }

  for (const commandSession of sidebarCommandSessionByCommandId.values()) {
    if (commandSession.sessionId === sessionId && commandSession.runId) {
      return "working";
    }
  }

  return undefined;
}

function createNativeLayoutSyncKey(command: NativeSetActiveTerminalSetCommand): string {
  /**
   * CDXC:NativeGpu 2026-05-08-16:45
   * The expensive native AppKit layout only depends on visible surface
   * identity, split geometry, pane gap, and active editor surface. Pane titles,
   * activity colors, focus display, and icons are chrome metadata and must not
   * make the host reframe IOSurface-backed terminal/browser views.
   */
  return JSON.stringify(
    normalizeNativeLayoutSyncValue({
      activeProjectEditorId: command.activeProjectEditorId,
      activeSessionIds: command.activeSessionIds,
      commandsPanelActiveSessionIds: command.commandsPanelActiveSessionIds,
      commandsPanelHeightRatio: command.commandsPanelHeightRatio,
      commandsPanelIsVisible: command.commandsPanelIsVisible,
      commandsPanelLayout: command.commandsPanelLayout,
      commandsPanelMode: command.commandsPanelMode,
      layout: command.layout,
      paneGap: command.paneGap,
    }),
  );
}

function normalizeNativeLayoutSyncValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeNativeLayoutSyncValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, normalizeNativeLayoutSyncValue(entryValue)]),
  );
}

function syncNativeLayout(options: { force?: boolean } = {}): void {
  const currentProject = activeProject();
  const currentProjectEditor = createSidebarProjectEditorState(currentProject);
  const currentProjectEditorSurfaceState = projectEditorSurfaceByProjectId.get(currentProject.projectId);
  const sidebarSessionsById = new Map(
    createProjectedSidebarSessionsForGroup(activeWorkspaceGroup()).map((session) => [
      session.sessionId,
      session,
    ]),
  );
  const snapshot = activeSnapshot();
  const commandsPanel = currentProject.commandsPanel;
  const visibleSessionRecordsById = new Map(
    snapshot.sessions.map((session) => [session.sessionId, session]),
  );
  /**
   * CDXC:BrowserPanes 2026-05-02-11:59
   * Browser-pane mode must feed browser sessions into the same native AppKit
   * layout tree as terminals and T3 panes. Creating the WKWebView is not
   * enough; omitting the browser id from setActiveTerminalSet makes Swift move
   * the loaded web pane offscreen during the next layout sync.
   *
   * CDXC:NativePaneReorder 2026-05-03-06:38
   * Native layout order must follow visibleSessionIds directly. Filtering the
   * full stored session list can resurrect hidden sessions when pane
   * drag-and-drop changes only the visible split placement.
   */
  const visibleSessions = getNativePaneSessionsForSnapshot(snapshot, visibleSessionRecordsById);
  const awakeVisibleSessions = visibleSessions.filter((session) => session.isSleeping !== true);
  const visibleSessionIds = awakeVisibleSessions
    .map((session) => nativeSessionIdForSidebarSession(session.sessionId));
  const commandPanelSessions = commandsPanel.sessions;
  const commandPanelVisibleSessions = commandPanelSessions;
  const commandPanelActiveSessions = commandPanelVisibleSessions.filter(
    (session) => session.isSleeping !== true,
  );
  const commandPanelActiveSessionIds = commandPanelActiveSessions.map((session) =>
    nativeSessionIdForSidebarSession(session.sessionId),
  );
  const workspaceSleepingSessionIds = visibleSessions
    .filter((session) => session.isSleeping === true)
    .map((session) => nativeSessionIdForSidebarSession(session.sessionId));
  const commandPanelSleepingSessionIds = commandPanelVisibleSessions
    .filter((session) => session.isSleeping === true)
    .map((session) => nativeSessionIdForSidebarSession(session.sessionId));
  /**
   * CDXC:PaneTabs 2026-05-15-20:10:
   * Workspace and Commands panel tabs share one native sleeping-session marker
   * map. Include sleeping command sessions here so a parked command tab remains
   * visible in the top tab bar after restart without waking its terminal.
   */
  const sleepingSessionIds = dedupeNativeSessionIds([
    ...workspaceSleepingSessionIds,
    ...commandPanelSleepingSessionIds,
  ]);
  const attentionSessionIds = visibleSessions
    .filter((session) => {
      if (session.kind !== "terminal") {
        return false;
      }
      const terminalState = terminalStateById.get(session.sessionId);
      return terminalState?.activity === "attention";
    })
    .map((session) => nativeSessionIdForSidebarSession(session.sessionId));
  const sessionActivities: Record<string, "attention" | "sleeping" | "working"> = {};
  const sessionAgentIconColors: Record<string, string> = {};
  const sessionAgentIconDataUrls: Record<string, string> = {};
  const sessionFaviconDataUrls: Record<string, string> = {};
  const sessionTitleBarActions: Record<string, NativeTerminalTitleBarAction[]> = {};
  const sessionTitles: Record<string, string> = {};
  const poppedOutSessionIds: string[] = [];
  for (const session of [...visibleSessions, ...commandPanelVisibleSessions]) {
    const nativeSessionId = nativeSessionIdForSidebarSession(session.sessionId);
    sessionTitles[nativeSessionId] = session.title;
    /**
     * CDXC:NativePaneReorder 2026-05-03-03:57
     * Native pane reorder feedback must show the same identity cue as the
     * session card. Send the projected sidebar icon data URL and CSS mask
     * color through layout sync so Swift uses live agent detection and renders
     * the same tinted logo instead of re-implementing agent artwork.
     *
     * CDXC:PaneTabs 2026-05-11-08:32
     * Native pane tabs use the same identity source as session cards: browser
     * favicon first, otherwise the projected agent/browser SVG mask. Send both
     * maps because AppKit tab buttons are native controls outside React.
     */
    const agentIcon = sidebarSessionsById.get(session.sessionId)?.agentIcon;
    if (agentIcon) {
      sessionAgentIconDataUrls[nativeSessionId] = AGENT_LOGOS[agentIcon];
      sessionAgentIconColors[nativeSessionId] = AGENT_LOGO_COLORS[agentIcon];
    }
    if (session.kind === "browser" && session.browser.faviconDataUrl) {
      sessionFaviconDataUrls[nativeSessionId] = session.browser.faviconDataUrl;
    }
    if (session.isPoppedOut === true && session.isSleeping !== true) {
      poppedOutSessionIds.push(nativeSessionId);
    }
    if (session.isSleeping === true) {
      sessionActivities[nativeSessionId] = "sleeping";
    }
    /**
     * CDXC:PaneTabs 2026-05-15-15:43:
     * Native tab context menus need the clicked tab's primary session actions
     * even when the tab is parked asleep. Send action metadata before the
     * sleeping-session early exit so Swift can render the same top context-menu
     * block for every tab while activity reporting still skips sleeping
     * terminals below.
     */
    sessionTitleBarActions[nativeSessionId] =
      session.kind === "terminal" && session.surface === "commands"
        ? commandsPanel.isVisible
          ? [
              commandsPanel.mode === "pinned" ? "unpinCommandsPanel" : "pinCommandsPanel",
              "closeCommandsPanel",
            ]
          : ["expandCommandsPanel"]
        : getNativePaneTitleBarActions(session);
    if (session.isSleeping === true) {
      continue;
    }
    if (session.kind !== "terminal") {
      continue;
    }
    const terminalState = terminalStateById.get(session.sessionId);
    const activity =
      session.surface === "commands"
        ? getNativeCommandPaneTabActivity(session.sessionId, terminalState?.activity)
        : terminalState?.activity;
    if (activity === "attention" || activity === "working") {
      sessionActivities[nativeSessionId] = activity;
    }
  }
  const persistedWorkspaceNativeLayout = snapshot.paneLayout
    ? buildNativeLayoutFromPaneLayout(
        snapshot.paneLayout,
        new Set(visibleSessions.map((session) => session.sessionId)),
      )
    : undefined;
  const layout = buildLayout(
    snapshot.paneLayout,
    visibleSessions.map((session) => session.sessionId),
    visibleSessions.map((session) => nativeSessionIdForSidebarSession(session.sessionId)),
    new Set(awakeVisibleSessions.map((session) => session.sessionId)),
    new Set(visibleSessionIds),
    clampVisibleSessionCount(visibleSessions.length),
    getActiveNativeSplitLayoutHint(snapshot),
  );
  if (!didLogStartupPaneLayoutFirstSync) {
    didLogStartupPaneLayoutFirstSync = true;
    const nativeLayoutShape = summarizePaneLayoutShape(layout);
    appendStartupPaneLayoutDebugLog("firstLayoutSync", {
      activeProjectId,
      activeSidebarSessionIds: awakeVisibleSessions.map((session) => session.sessionId),
      buildReason: snapshot.paneLayout
        ? persistedWorkspaceNativeLayout
          ? "persistedPaneLayout"
          : "persistedPaneLayoutFilteredOut"
        : "missingPersistedPaneLayout",
      focusedSessionId: snapshot.focusedSessionId,
      looksLikeEverySessionSplitPane:
        nativeLayoutShape.splitCount > 0 &&
        nativeLayoutShape.tabGroupCount === 0 &&
        nativeLayoutShape.leafCount >= 2 &&
        nativeLayoutShape.leafCount === visibleSessions.length,
      nativeLayout: summarizeNativePaneLayout(layout),
      nativeLayoutShape,
      paneLayout: summarizeSessionPaneLayout(snapshot.paneLayout),
      paneLayoutSessionIds: collectSessionPaneLayoutSessionIds(snapshot.paneLayout),
      paneLayoutShape: summarizePaneLayoutShape(snapshot.paneLayout),
      parkedSidebarSessionIds: visibleSessions
        .filter((session) => session.isSleeping === true)
        .map((session) => session.sessionId),
      persistedNativeLayout: summarizeNativePaneLayout(persistedWorkspaceNativeLayout),
      persistedNativeLayoutShape: summarizePaneLayoutShape(persistedWorkspaceNativeLayout),
      projectId: currentProject.projectId,
      sessionIds: snapshot.sessions.map((session) => session.sessionId),
      visibleCount: snapshot.visibleCount,
      visibleSessionIds: snapshot.visibleSessionIds,
    });
  }
  const commandPanelLayout = buildLayout(
    commandsPanel.paneLayout,
    commandPanelVisibleSessions.map((session) => session.sessionId),
    commandPanelVisibleSessions.map((session) => nativeSessionIdForSidebarSession(session.sessionId)),
    new Set(commandPanelActiveSessions.map((session) => session.sessionId)),
    new Set(commandPanelActiveSessionIds),
    clampVisibleSessionCount(Math.max(1, commandPanelVisibleSessions.length)),
  );
  const focusedNativeSessionId = snapshot.focusedSessionId
    ? nativeSessionIdForSidebarSession(snapshot.focusedSessionId)
    : undefined;
  const commandsPanelFocusedNativeSessionId = commandsPanel.activeSessionId
    ? nativeSessionIdForSidebarSession(commandsPanel.activeSessionId)
    : undefined;
  const shouldConsumeFocusRequest =
    pendingNativeLayoutFocusRequest !== undefined &&
    ((pendingNativeLayoutFocusRequest.sessionId === snapshot.focusedSessionId &&
      visibleSessions.some((session) => session.sessionId === pendingNativeLayoutFocusRequest?.sessionId)) ||
      (pendingNativeLayoutFocusRequest.sessionId === commandsPanel.activeSessionId &&
        commandPanelVisibleSessions.some(
          (session) => session.sessionId === pendingNativeLayoutFocusRequest?.sessionId,
        )));
  const focusRequestId = shouldConsumeFocusRequest
    ? pendingNativeLayoutFocusRequest?.requestId
    : undefined;
  const sidebarCardFocusTrace = getRecentSidebarCardFocusTrace(snapshot.focusedSessionId);
  /**
   * CDXC:NativeTerminals 2026-04-28-03:37
   * Native title bars must mirror the same per-session state used by sidebar
   * cards: green for done/attention and orange for working. Send the activity
   * projection with the layout command so AppKit renders the indicator from
   * the same source of truth as the React card indicator.
   *
   * CDXC:NativeTerminals 2026-04-30-03:41
   * Native pane title bars must render the full sidebar session title, not the
   * Ghostty window title. Agent terminal titles can already contain an
   * ellipsis, so the layout sync owns the display title used by AppKit chrome.
   *
   * CDXC:NativeTerminalFocus 2026-05-04-16:02
   * A visible side terminal becoming done/green must not move keyboard focus
   * away from the terminal the user is typing in. Treat focusedSessionId in
   * passive status/layout sync as selection display only; Swift receives
   * focusRequestId only for explicit user focus commands such as sidebar
   * session focus, hotkeys, or project switching.
   */
  const command: NativeSetActiveTerminalSetCommand = {
    activeSessionIds: visibleSessionIds,
    commandsPanelActiveSessionIds: commandPanelActiveSessionIds,
    commandsPanelFocusedSessionId: commandsPanelFocusedNativeSessionId,
    commandsPanelHeightRatio: commandsPanel.heightRatio,
    commandsPanelIsVisible: commandsPanel.isVisible,
    commandsPanelLayout: commandPanelLayout,
    commandsPanelMode: commandsPanel.mode,
    /**
     * CDXC:ReactTitlebar 2026-05-11-00:22
     * The native React titlebar mirrors the active project header: project
     * title/path and embedded-editor state are sent in the same layout command
     * that already tracks active project changes. Diff stats remain available
     * to state sync, but the visible titlebar Code button renders no stats.
     *
     * CDXC:ModeSwitcher 2026-05-15-18:20:
     * The titlebar mode highlight is state sync, not click-local UI. Send the
     * active restored workarea mode with every layout command so app launch,
     * titlebar clicks, and sidebar-driven project editor changes all keep the
     * segmented control in sync with the visible surface.
     */
    activeProjectDiffStats: currentProjectEditor.diffStats,
    activeProjectEditorCompanionPaneHidden: currentProject.projectEditorCompanionPaneHidden === true,
    activeProjectMode:
      currentProjectEditorSurfaceState?.isOpen === true &&
      currentProjectEditorSurfaceState.isSleeping !== true
        ? currentProjectEditorSurfaceState.mode
        : "agents",
    activeProjectEditorIsOpen: currentProjectEditor.isOpen,
    activeProjectEditorIsSleeping: currentProjectEditor.isSleeping,
    activeProjectEditorStatus: currentProjectEditor.status,
    appTitle: nativeAppTitleForProject(currentProject),
    debuggingMode: settings.debuggingMode,
    activeProjectId: currentProject.projectId,
    activeProjectIconDataUrl: resolveWorkspaceProjectIconDataUrl(currentProject),
    activeProjectEditorId:
      currentProjectEditorSurfaceState?.isOpen === true &&
      currentProjectEditorSurfaceState.isSleeping !== true
        ? currentProjectEditorSurfaceState.nativeEditorId
        : undefined,
    activeProjectName: currentProject.name,
    activeProjectPath: currentProject.path,
    attentionSessionIds,
    backgroundColor: settings.workspaceBackgroundColor,
    ...(focusRequestId !== undefined ? { focusRequestId } : {}),
    focusedSessionId: focusedNativeSessionId,
    layout,
    /**
     * CDXC:WorkspaceLayout 2026-04-28-06:01
     * The Pane Gap settings control must affect native Ghostty pane layout,
     * not only the React workspace panel. Send the normalized persisted value
     * with every native layout sync so slider drags repaint AppKit spacing.
     */
    paneGap: settings.workspacePaneGap,
    poppedOutSessionIds,
    sessionAgentIconDataUrls,
    sessionAgentIconColors,
    sessionFaviconDataUrls,
    sessionActivities,
    sleepingSessionIds,
    sidebarActions: {
      commands,
    },
    sessionTitleBarActions,
    sessionTitles,
    petOverlayEnabled: settings.petOverlayEnabled,
    showProjectEditorDiffFileCount: settings.showProjectEditorDiffFileCount,
    titlebarResourceGroups: createTitlebarResourceGroups(),
    type: "setActiveTerminalSet",
    workspaceOpenTargets: {
      availability: settings.workspaceOpenTargetAvailability,
      customTargets: settings.customWorkspaceOpenTargets,
      hiddenTargetIds: settings.workspaceOpenTargetHiddenIds,
    },
  };
  const layoutSyncResult = postNativeLayoutSync(command, options);
  const didPostNativeLayoutSync = layoutSyncResult.didPost;
  if (command.activeProjectMode === "code" && layoutSyncResult.didPost) {
    appendTitlebarCodeLagDebugLog("titlebarCodeLag.sidebarLayoutSyncPosted", {
      activeProjectEditorId: command.activeProjectEditorId,
      activeProjectEditorIsOpen: command.activeProjectEditorIsOpen,
      activeProjectEditorIsSleeping: command.activeProjectEditorIsSleeping,
      activeProjectEditorStatus: command.activeProjectEditorStatus,
      activeProjectId: command.activeProjectId,
      didPostNativeLayoutSync,
      focusRequestId,
      layoutChanged: layoutSyncResult.layoutChanged,
    });
  }
  if (layoutSyncResult.didPost && (layoutSyncResult.layoutChanged || focusRequestId !== undefined)) {
    appendPaneLayoutTraceDebugLog("layoutSync.posted", {
      activeNativeSessionIds: visibleSessionIds,
      activeProjectId,
      focusedNativeSessionId,
      focusedSidebarSessionId: snapshot.focusedSessionId,
      focusRequestId,
      layoutChanged: layoutSyncResult.layoutChanged,
      nativeLayout: summarizeNativePaneLayout(layout),
      pendingFocusRequest: pendingNativeLayoutFocusRequest,
      projectId: currentProject.projectId,
      sidebarCardFocusTrace: summarizeSidebarCardFocusTrace(sidebarCardFocusTrace),
      sidebarGroup: summarizeWorkspaceGroupForPaneLayoutTrace(
        currentProject.workspace,
        currentProject.workspace.activeGroupId,
      ),
      sleepingSessionIds,
    }, { force: sidebarCardFocusTrace !== undefined });
  }
  /**
   * CDXC:NativeTerminalFocus 2026-05-09-15:30
   * Focus trace logging should show whether sidebar state actually crossed the
   * native bridge, but only when the focused pane changes or an explicit focus
   * request exists. This keeps reproduction logs useful without recording every
   * passive status/layout publish.
   */
  const shouldTraceLayoutFocus =
    focusRequestId !== undefined ||
    focusedNativeSessionId !== lastNativeFocusTraceLayoutFocusedSessionId;
  if (shouldTraceLayoutFocus) {
    appendTerminalFocusDebugLog("nativeFocusTrace.sidebarLayoutFocusSync", {
      activeProjectId,
      didPostNativeLayoutSync,
      focusedNativeSessionId,
      focusedSidebarSessionId: snapshot.focusedSessionId,
      focusRequestId,
      pendingFocusRequest: pendingNativeLayoutFocusRequest,
      sidebarCardFocusTrace: summarizeSidebarCardFocusTrace(sidebarCardFocusTrace),
      shouldConsumeFocusRequest,
      visibleNativeSessionIds: visibleSessionIds,
      visibleSidebarSessionIds: visibleSessions.map((session) => session.sessionId),
    }, { force: sidebarCardFocusTrace !== undefined });
    lastNativeFocusTraceLayoutFocusedSessionId = focusedNativeSessionId;
  }
  if (shouldConsumeFocusRequest) {
    pendingNativeLayoutFocusRequest = undefined;
  }
}

function buildLayout(
  paneLayout: SessionPaneLayoutNode | undefined,
  sidebarSessionIds: string[],
  sessionIds: string[],
  activeSidebarSessionIds: ReadonlySet<string>,
  activeSessionIds: ReadonlySet<string>,
  visibleCount: VisibleSessionCount,
  splitHint?: NativeResolvedSplitLayoutHint,
): NativeTerminalLayout | undefined {
  const visible = sessionIds.filter((sessionId) => activeSessionIds.has(sessionId)).slice(0, visibleCount);
  const persistedLayout = paneLayout
    ? buildNativeLayoutFromPaneLayout(paneLayout, new Set(sidebarSessionIds))
    : undefined;
  if (persistedLayout) {
    /**
     * CDXC:NativeSplits 2026-05-10-18:30
     * Native split geometry comes from the persisted paneLayout tree when it
     * exists. This prevents visible-count auto layout from reshaping four
     * side-by-side panes into a square grid after Cmd+D creates another pane.
     *
     * CDXC:PaneTabs 2026-05-11-01:31
     * Older in-memory paneLayout snapshots can predate the all-awake tab rule.
     * Append any awake session missing from the persisted tree on the right so
     * the native layout immediately shows every non-sleeping session card.
     *
     * CDXC:PaneTabs 2026-05-15-20:10:
     * Restart restore must keep sleeping tab buttons in the native top tab bar
     * without attaching every terminal process. Add missing parked tab members
     * to the first active pane/tab group, while missing awake sessions still
     * become real split panes that own native surfaces.
     */
    const missingSessionEntries = sessionIds.flatMap((sessionId, index) => {
      const sidebarSessionId = sidebarSessionIds[index];
      return sidebarSessionId !== undefined && !nativeLayoutContainsSession(persistedLayout, sessionId)
        ? [{ sessionId, sidebarSessionId }]
        : [];
    });
    const missingActiveSessionIds = missingSessionEntries
      .filter((entry) => activeSidebarSessionIds.has(entry.sidebarSessionId))
      .map((entry) => entry.sessionId);
    const missingParkedSessionIds = missingSessionEntries
      .filter((entry) => !activeSidebarSessionIds.has(entry.sidebarSessionId))
      .map((entry) => entry.sessionId);
    const layoutWithParkedTabs = addParkedSessionsToNativeTabGroup(
      persistedLayout,
      missingParkedSessionIds,
      activeSessionIds,
    );
    if (missingActiveSessionIds.length === 0) {
      return layoutWithParkedTabs;
    }
    /**
     * CDXC:SidebarSessionFocus 2026-05-15-20:01:
     * If a session-card click ever opens an existing session as a new split,
     * this is the synthesis branch that can do it: active sessions missing
     * from the persisted paneLayout are appended as real split panes. Force a
     * targeted breadcrumb with the missing sidebar/native ids and persisted
     * layout so the next repro identifies why the target was absent instead of
     * masking it with fallback layout behavior.
     */
    appendPaneLayoutTraceDebugLog(
      "layoutBuilder.appendMissingActiveSessions",
      {
        activeNativeSessionIds: [...activeSessionIds],
        activeSidebarSessionIds: [...activeSidebarSessionIds],
        missingActiveSessions: missingSessionEntries.filter((entry) =>
          activeSidebarSessionIds.has(entry.sidebarSessionId),
        ),
        missingParkedSessionIds,
        persistedLayout: summarizeNativePaneLayout(persistedLayout),
        sidebarSessionIds,
        splitHint,
      },
      { force: true },
    );
    const missingLayoutItems = createNativeLayoutItems(missingActiveSessionIds, splitHint);
    return {
      children: [
        layoutWithParkedTabs,
        ...(missingLayoutItems.length === 1
          ? missingLayoutItems
          : [{ children: missingLayoutItems, direction: "vertical" as const, kind: "split" as const }]),
      ],
      direction: "horizontal",
      kind: "split",
    };
  }
  if (visible.length === 0) {
    return undefined;
  }
  const layoutItems = createNativeLayoutItems(visible, splitHint);
  const parkedSessionIds = sessionIds.filter((sessionId) => !activeSessionIds.has(sessionId));
  if (layoutItems.length === 1) {
    return addParkedSessionsToNativeTabGroup(layoutItems[0]!, parkedSessionIds, activeSessionIds);
  }

  const columns = layoutItems.length === 2 ? 2 : layoutItems.length <= 4 ? 2 : 3;
  const rows: NativeTerminalLayout[] = [];
  for (let index = 0; index < layoutItems.length; index += columns) {
    const row = layoutItems.slice(index, index + columns);
    rows.push(
      row.length === 1 ? row[0]! : { children: row, direction: "horizontal", kind: "split" },
    );
  }
  const generatedLayout =
    rows.length === 1 ? rows[0]! : { children: rows, direction: "vertical" as const, kind: "split" as const };
  return addParkedSessionsToNativeTabGroup(generatedLayout, parkedSessionIds, activeSessionIds);
}

function addParkedSessionsToNativeTabGroup(
  layout: NativeTerminalLayout,
  parkedSessionIds: readonly string[],
  activeSessionIds: ReadonlySet<string>,
): NativeTerminalLayout {
  const missingParkedSessionIds = parkedSessionIds.filter(
    (sessionId, index, sessionIds) =>
      sessionIds.indexOf(sessionId) === index && !nativeLayoutContainsSession(layout, sessionId),
  );
  if (missingParkedSessionIds.length === 0) {
    return layout;
  }
  const result = addParkedSessionsToExistingNativeTabGroup(layout, missingParkedSessionIds, activeSessionIds);
  if (result.didAdd) {
    return result.layout;
  }
  return convertFirstActiveNativeLeafToTabGroup(layout, missingParkedSessionIds, activeSessionIds);
}

function addParkedSessionsToExistingNativeTabGroup(
  layout: NativeTerminalLayout,
  parkedSessionIds: readonly string[],
  activeSessionIds: ReadonlySet<string>,
): { didAdd: boolean; layout: NativeTerminalLayout } {
  switch (layout.kind) {
    case "leaf":
      return { didAdd: false, layout };
    case "tabs": {
      const hasActiveTab = layout.sessionIds.some((sessionId) => activeSessionIds.has(sessionId));
      if (!hasActiveTab) {
        return { didAdd: false, layout };
      }
      return {
        didAdd: true,
        layout: {
          ...layout,
          sessionIds: dedupeNativeSessionIds([...layout.sessionIds, ...parkedSessionIds]),
        },
      };
    }
    case "split": {
      let didAdd = false;
      const children = layout.children.map((child) => {
        if (didAdd) {
          return child;
        }
        const result = addParkedSessionsToExistingNativeTabGroup(child, parkedSessionIds, activeSessionIds);
        didAdd = result.didAdd;
        return result.layout;
      });
      return { didAdd, layout: didAdd ? { ...layout, children } : layout };
    }
  }
}

function convertFirstActiveNativeLeafToTabGroup(
  layout: NativeTerminalLayout,
  parkedSessionIds: readonly string[],
  activeSessionIds: ReadonlySet<string>,
): NativeTerminalLayout {
  switch (layout.kind) {
    case "leaf":
      return activeSessionIds.has(layout.sessionId)
        ? {
            activeSessionId: layout.sessionId,
            kind: "tabs",
            sessionIds: dedupeNativeSessionIds([layout.sessionId, ...parkedSessionIds]),
          }
        : layout;
    case "tabs":
      return layout;
    case "split": {
      let didConvert = false;
      const children = layout.children.map((child) => {
        if (didConvert) {
          return child;
        }
        const nextChild = convertFirstActiveNativeLeafToTabGroup(
          child,
          parkedSessionIds,
          activeSessionIds,
        );
        didConvert = nextChild !== child;
        return nextChild;
      });
      return didConvert ? { ...layout, children } : layout;
    }
  }
}

function dedupeNativeSessionIds(sessionIds: readonly string[]): string[] {
  return sessionIds.filter((sessionId, index) => sessionIds.indexOf(sessionId) === index);
}

function getNativePaneSessionsForSnapshot(
  snapshot: SessionGridSnapshot,
  sessionRecordsById: ReadonlyMap<string, SessionRecord>,
): SessionRecord[] {
  /**
   * CDXC:PaneTabs 2026-05-11-01:31
   * Native pane tabs represent every workspace session, not only the
   * legacy visibleCount slice. Keep visibleSessionIds as the preferred ordering,
   * then append any additional session cards so sleeping sessions can stay
   * visible as dim parked tabs without creating native terminal/web surfaces.
   */
  const orderedSessionIds = [
    ...snapshot.visibleSessionIds,
    ...snapshot.sessions.map((session) => session.sessionId),
  ];
  const seenSessionIds = new Set<string>();
  const sessions: SessionRecord[] = [];
  for (const sessionId of orderedSessionIds) {
    if (seenSessionIds.has(sessionId)) {
      continue;
    }
    seenSessionIds.add(sessionId);
    const session = sessionRecordsById.get(sessionId);
    if (!session) {
      continue;
    }
    sessions.push(session);
  }
  return sessions;
}

function nativeLayoutContainsSession(layout: NativeTerminalLayout, sessionId: string): boolean {
  switch (layout.kind) {
    case "leaf":
      return layout.sessionId === sessionId;
    case "tabs":
      return layout.sessionIds.includes(sessionId);
    case "split":
      return layout.children.some((child) => nativeLayoutContainsSession(child, sessionId));
  }
}

function buildNativeLayoutFromPaneLayout(
  paneLayout: SessionPaneLayoutNode,
  visibleSidebarSessionIds: ReadonlySet<string>,
): NativeTerminalLayout | undefined {
  switch (paneLayout.kind) {
    case "leaf":
      return visibleSidebarSessionIds.has(paneLayout.sessionId)
        ? { kind: "leaf", sessionId: nativeSessionIdForSidebarSession(paneLayout.sessionId) }
        : undefined;
    case "tabs": {
      const sessionIds = paneLayout.sessionIds.filter((sessionId) =>
        visibleSidebarSessionIds.has(sessionId),
      );
      const activeSessionId =
        paneLayout.activeSessionId && sessionIds.includes(paneLayout.activeSessionId)
          ? paneLayout.activeSessionId
          : sessionIds[0];
      return activeSessionId
        ? {
            activeSessionId: nativeSessionIdForSidebarSession(activeSessionId),
            kind: "tabs",
            sessionIds: sessionIds.map(nativeSessionIdForSidebarSession),
          }
        : undefined;
    }
    case "split": {
      const children = paneLayout.children
        .map((child) => buildNativeLayoutFromPaneLayout(child, visibleSidebarSessionIds))
        .filter((child): child is NativeTerminalLayout => child !== undefined);
      if (children.length === 0) {
        return undefined;
      }
      if (children.length === 1) {
        return children[0];
      }
      return {
        children,
        direction: paneLayout.direction,
        kind: "split",
        ...(paneLayout.ratio === undefined ? {} : { ratio: paneLayout.ratio }),
      };
    }
  }
}

function getActiveNativeSplitLayoutHint(
  snapshot: SessionGridSnapshot,
): NativeResolvedSplitLayoutHint | undefined {
  if (!nativeSplitLayoutHint || nativeSplitLayoutHint.projectId !== activeProjectId) {
    return undefined;
  }
  const targetSessionId = nativeSessionIdForSidebarSession(nativeSplitLayoutHint.targetSessionId);
  const nextSessionId = nativeSessionIdForSidebarSession(nativeSplitLayoutHint.nextSessionId);
  const visibleSessionIdSet = new Set(snapshot.visibleSessionIds);
  if (
    !visibleSessionIdSet.has(nativeSplitLayoutHint.targetSessionId) ||
    !visibleSessionIdSet.has(nativeSplitLayoutHint.nextSessionId)
  ) {
    nativeSplitLayoutHint = undefined;
    return undefined;
  }
  return {
    direction: nativeSplitLayoutHint.direction,
    nextSessionId,
    targetSessionId,
  };
}

function createNativeLayoutItems(
  visibleSessionIds: readonly string[],
  splitHint: NativeResolvedSplitLayoutHint | undefined,
): NativeTerminalLayout[] {
  /**
   * CDXC:NativeSplits 2026-05-10-18:30
   * A split command divides the targeted pane area into a target/new pair.
   * The rest of the visible pane set keeps the existing automatic grid, so
   * exact counts work without introducing a persisted split-tree migration.
   */
  const items: NativeTerminalLayout[] = [];
  for (let index = 0; index < visibleSessionIds.length; index += 1) {
    const sessionId = visibleSessionIds[index]!;
    const nextSessionId = visibleSessionIds[index + 1];
    if (
      splitHint &&
      sessionId === splitHint.targetSessionId &&
      nextSessionId === splitHint.nextSessionId
    ) {
      items.push({
        children: [
          { kind: "leaf", sessionId },
          { kind: "leaf", sessionId: nextSessionId },
        ],
        direction: splitHint.direction,
        kind: "split",
      });
      index += 1;
      continue;
    }
    items.push({ kind: "leaf", sessionId });
  }
  return items;
}

window.addEventListener("ghostex-native-host-event", (event) => {
  const hostEvent = (event as CustomEvent<NativeHostEvent>).detail;
  if (!hostEvent || hostEvent.type === "hostReady") {
    return;
  }
  if (hostEvent.type === "processResult") {
    const pending = pendingProcessResults.get(hostEvent.requestId);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timeout);
    pendingProcessResults.delete(hostEvent.requestId);
    pending.resolve(hostEvent);
    return;
  }
  if (hostEvent.type === "nativeHotkey") {
    /**
     * CDXC:Hotkeys 2026-04-28-06:15
     * Native AppKit hotkeys now arrive as typed host events. Handle them
     * before terminal-session event normalization, because shortcut actions do
     * not carry a sessionId and should execute even while Ghostty owns focus.
     */
    logNativeHotkeyDebug("nativeHotkeys.hostEventReceived", {
      actionId: hostEvent.actionId,
    });
    runNativeHotkeyAction(hostEvent.actionId, "native");
    return;
  }
  if (hostEvent.type === "sessionStatusIndicatorClicked") {
    handleNativeSessionStatusIndicatorClicked(hostEvent.status);
    return;
  }
  if (hostEvent.type === "petOverlayActivityClicked") {
    handleNativePetOverlayActivityClicked(hostEvent.projectId, hostEvent.sessionId);
    return;
  }
  if (hostEvent.type === "sessionAttentionNotificationClicked") {
    handleNativeSessionAttentionNotificationClicked(
      sidebarSessionIdForNativeSession(hostEvent.sessionId),
    );
    return;
  }
  if (hostEvent.type === "projectEditorLoadState") {
    setProjectEditorLoadState(hostEvent.projectId, hostEvent.status, hostEvent.message);
    return;
  }
  if (hostEvent.type === "projectEditorBackRequested") {
    handleProjectEditorBackRequested(hostEvent.projectId);
    return;
  }
  if (hostEvent.type === "projectEditorCompanionPaneHiddenChanged") {
    handleProjectEditorCompanionPaneHiddenChanged(hostEvent.projectId, hostEvent.hidden);
    return;
  }
  if (hostEvent.type === "projectEditorTabSelected") {
    handleProjectEditorTabSelected(hostEvent.projectId, hostEvent.url);
    return;
  }
  if (hostEvent.type === "commandsPanelHeightRatioChanged") {
    updateActiveProjectCommandsPanel((panel) => ({
      ...panel,
      heightRatio: hostEvent.heightRatio,
    }));
    publish();
    return;
  }
  if (hostEvent.type === "paneTabSelected") {
    handleNativePaneTabSelected(sidebarSessionIdForNativeSession(hostEvent.sessionId));
    return;
  }
  if (hostEvent.type === "paneTabCloseRequested") {
    handleNativePaneTabCloseRequested(
      sidebarSessionIdForNativeSession(hostEvent.sessionId),
      hostEvent.scope,
    );
    return;
  }
  if (hostEvent.type === "paneTabSleepRequested") {
    handleNativePaneTabSleepRequested(
      sidebarSessionIdForNativeSession(hostEvent.sessionId),
      hostEvent.scope,
    );
    return;
  }
  if (hostEvent.type === "paneTabReorderRequested") {
    handleNativePaneTabReorderRequested(
      sidebarSessionIdForNativeSession(hostEvent.sourceSessionId),
      sidebarSessionIdForNativeSession(hostEvent.targetSessionId),
      hostEvent.position,
    );
    return;
  }
  if (hostEvent.type === "paneReorderRequested") {
    handleNativePaneReorderRequested(
      sidebarSessionIdForNativeSession(hostEvent.sourceSessionId),
      sidebarSessionIdForNativeSession(hostEvent.targetSessionId),
      hostEvent.placement,
    );
    return;
  }
  const sidebarSessionId = sidebarSessionIdForNativeSession(hostEvent.sessionId);
  if (hostEvent.type === "t3ThreadReady") {
    /**
     * CDXC:T3Code 2026-05-01-13:31
     * Native T3 panes must persist the resolved project/thread metadata that
     * Swift ensured from the T3 orchestration API. This mirrors the reference
     * controller's `ensureThreadSession` path so restoring a T3 card reopens
     * its bound thread and only creates a replacement thread when that bound
     * thread no longer exists.
     */
    handleNativeT3ThreadReady(sidebarSessionId, hostEvent);
    return;
  }
  if (hostEvent.type === "t3ThreadChanged") {
    void handleNativeT3ThreadChanged(sidebarSessionId, hostEvent.threadId, hostEvent.title);
    return;
  }
  if (hostEvent.type === "terminalTitleChanged") {
    const session = findSessionRecord(sidebarSessionId);
    if (session?.kind === "browser") {
      /**
       * CDXC:BrowserPanes 2026-05-03-01:58
       * WKWebView reports page titles over the existing native title event.
       * Browser sessions do not have terminal activity state, so accept these
       * updates before terminal-specific title detection and persist them for
       * the next native layout sync.
       */
      updateActiveProjectWorkspace(
        (workspace) =>
          setSessionTitleInSimpleWorkspace(workspace, sidebarSessionId, hostEvent.title, {
            titleSource: "browser-auto",
          }).snapshot,
      );
      publish();
      return;
    }
  }
  if (hostEvent.type === "browserUrlChanged") {
    const session = findSessionRecord(sidebarSessionId);
    if (session?.kind === "browser") {
      /**
       * CDXC:BrowserPanes 2026-05-03-03:41
       * Native browser panes own navigation, so the sidebar must accept the
       * committed WKWebView URL over the host event bus and persist it on the
       * browser card before app restart.
       */
      updateActiveProjectWorkspace(
        (workspace) =>
          setBrowserSessionUrlInSimpleWorkspace(workspace, sidebarSessionId, hostEvent.url)
            .snapshot,
      );
      publish();
      return;
    }
  }
  if (hostEvent.type === "browserFaviconChanged") {
    const session = findSessionRecord(sidebarSessionId);
    if (session?.kind === "browser") {
      /**
       * CDXC:BrowserPanes 2026-05-03-11:28
       * Browser pane cards should show the page favicon when WebKit has one,
       * falling back to the default browser glyph otherwise. Native WebKit
       * already resolves the page favicon for the pane title bar, so persist
       * that same data URL here instead of duplicating browser fetch logic in
       * the sidebar.
       */
      updateActiveProjectWorkspace(
        (workspace) =>
          setBrowserSessionFaviconDataUrlInSimpleWorkspace(
            workspace,
            sidebarSessionId,
            hostEvent.faviconDataUrl,
          ).snapshot,
      );
      publish();
      return;
    }
  }
  if (hostEvent.type === "terminalTitleBarAction") {
    /**
     * CDXC:BrowserPanes 2026-05-03-11:15
     * Browser panes use the shared native title-bar action event, but they do
     * not have terminal runtime state. Handle title-bar actions before the
     * terminal-only state guard so the browser close button removes the pane
     * through the same workspace/session path as T3 Code and terminals.
     */
    handleNativeTerminalTitleBarAction(sidebarSessionId, hostEvent.action);
    return;
  }
  if (hostEvent.type === "terminalFocused") {
    /**
     * CDXC:NativeTerminalFocus 2026-04-26-21:32
     * Clicking or typing in a split Ghostty surface changes AppKit focus before
     * sidebar state knows about it. Treat native terminalFocused as the
     * authoritative user-focus signal so later layout sync sends the focused
     * session the user is actually typing in instead of stale sidebar focus.
     *
     * CDXC:NativeWebPaneFocus 2026-05-03-06:59
     * T3 Code and browser panes use the same native focus event even though
     * they do not have terminal runtime state. Handle focus before the
     * terminal-only state guard so clicking a WKWebView updates the active
     * sidebar card instead of only drawing the AppKit border.
    */
    const previousFocusedSessionId = activeSnapshot().focusedSessionId;
    lastNativeFocusedSidebarSessionId = sidebarSessionId;
    /**
     * CDXC:NativeTerminalFocus 2026-05-09-15:30
     * When a pane click fails to move the active border, the sidebar log must
     * show whether Swift emitted terminalFocused and whether the store applied
     * or treated it as a duplicate. These events are focus-only, not render
     * loop logs, so they stay small during reproduction.
     */
    appendTerminalFocusDebugLog("nativeFocusTrace.sidebarTerminalFocusedReceived", {
      activeProjectId,
      incomingSessionId: sidebarSessionId,
      nativeSessionId: hostEvent.sessionId,
      previousFocusedSessionId,
      visibleSessionIds: activeSnapshot().visibleSessionIds,
    });
    appendPaneLayoutTraceDebugLog("terminalFocused.received", {
      activeProjectId,
      incomingSessionId: sidebarSessionId,
      nativeSessionId: hostEvent.sessionId,
      previousFocusedSessionId,
      targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(activeProject().workspace),
    });
    if (activeCommandPanelContainsSession(sidebarSessionId)) {
      rememberActiveProjectWorkspaceTerminalBeforeCommandsPanel("nativeCommandPanelFocus");
      updateActiveProjectCommandsPanel((panel) => ({
        ...panel,
        activeSessionId: sidebarSessionId,
        isVisible: true,
        paneLayout: setActiveCommandSessionInPaneLayout(panel.paneLayout, sidebarSessionId),
      }));
      acknowledgeNativeTerminalAttention(sidebarSessionId, "native-focus");
      publish();
      return;
    }
    rememberFocusedWorkspaceTerminal(activeProject(), sidebarSessionId, "nativeWorkspaceFocus");
    if (previousFocusedSessionId === sidebarSessionId) {
      const acknowledgedAttention = acknowledgeNativeTerminalAttention(
        sidebarSessionId,
        "native-focus",
      );
      appendTerminalFocusDebugLog("nativeFocusTrace.sidebarTerminalFocusedDuplicate", {
        acknowledgedAttention,
        activeProjectId,
        incomingSessionId: sidebarSessionId,
        nativeSessionId: hostEvent.sessionId,
        previousFocusedSessionId,
      });
      appendTerminalFocusDebugLog("nativeSidebar.terminalFocused.duplicateSkipped", {
        acknowledgedAttention,
        nativeSessionId: hostEvent.sessionId,
        sessionId: sidebarSessionId,
      });
      if (acknowledgedAttention) {
        publish();
      }
      return;
    }
    let focusChanged = false;
    updateActiveProjectWorkspace((workspace) => {
      const result = focusSessionInSimpleWorkspace(workspace, sidebarSessionId);
      focusChanged = result.changed;
      return result.snapshot;
    });
    appendTerminalFocusDebugLog("nativeSidebar.terminalFocused.applied", {
      focusChanged,
      nativeSessionId: hostEvent.sessionId,
      previousFocusedSessionId,
      sessionId: sidebarSessionId,
    });
    const acknowledgedAttention = acknowledgeNativeTerminalAttention(
      sidebarSessionId,
      "native-focus",
    );
    appendTerminalFocusDebugLog("nativeFocusTrace.sidebarTerminalFocusedApplied", {
      acknowledgedAttention,
      activeProjectId,
      focusChanged,
      focusedSessionIdAfter: activeSnapshot().focusedSessionId,
      incomingSessionId: sidebarSessionId,
      nativeSessionId: hostEvent.sessionId,
      previousFocusedSessionId,
      visibleSessionIdsAfter: activeSnapshot().visibleSessionIds,
    });
    appendPaneLayoutTraceDebugLog("terminalFocused.applied", {
      activeProjectId,
      acknowledgedAttention,
      focusChanged,
      incomingSessionId: sidebarSessionId,
      nativeSessionId: hostEvent.sessionId,
      targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(activeProject().workspace),
    });
    if (!focusChanged) {
      if (acknowledgedAttention) {
        publish();
      }
      return;
    }
  } else {
    const terminalState = terminalStateById.get(sidebarSessionId);
    if (!terminalState) {
      appendSessionTitleDebugLog("nativeSidebar.nativeEventIgnored", {
        nativeSessionId: hostEvent.sessionId,
        reason: "terminal-state-missing",
        sidebarSessionId,
        type: hostEvent.type,
      });
      return;
    }
    if (hostEvent.type === "terminalTitleChanged") {
      const previousActivity = terminalState.activity;
      const previousTerminalTitle = terminalState.terminalTitle;
      const knownAgentNameBeforeDetection = terminalState.agentName;
      const previousVisibleTerminalTitle = getVisibleTerminalTitle(previousTerminalTitle);
      const previousDerivedActivity = titleDerivedActivityBySessionId.get(sidebarSessionId);
      const nextDerivedActivity = getTitleDerivedSessionActivityFromTransition(
        previousTerminalTitle,
        hostEvent.title,
        previousDerivedActivity,
        knownAgentNameBeforeDetection,
      );
      const effectiveDerivedActivity = nextDerivedActivity
        ? getNativeEffectiveTitleActivity(sidebarSessionId, nextDerivedActivity)
        : undefined;
      const didUpdateSessionPersistenceName =
        hostEvent.sessionPersistenceName !== undefined &&
        terminalState.sessionPersistenceName !== hostEvent.sessionPersistenceName;
      terminalState.terminalTitle = hostEvent.title;
      if (hostEvent.sessionPersistenceName !== undefined) {
        /**
         * CDXC:SessionPersistence 2026-05-05-07:28
         * Native persistence names are the durable provider-session identity.
         * Persist them separately from the visible card title so the active
         * Settings provider can attach to the named backend session when
         * recreation is provider-backed.
         *
         * CDXC:SessionPersistence 2026-05-10-03:35
         * Persist the provider from the mounted terminal state for live badges
         * and copy-attach commands. Reload, wake, app restore, and
         * previous-session restore still resolve the next provider from current
         * Settings, so this stored provider is descriptive rather than
         * authoritative for recreation.
         */
        terminalState.sessionPersistenceName = hostEvent.sessionPersistenceName;
        setTerminalSessionPersistenceName(sidebarSessionId, hostEvent.sessionPersistenceName);
        setTerminalSessionPersistenceProvider(
          sidebarSessionId,
          terminalState.sessionPersistenceProvider,
        );
      }
      /**
       * CDXC:AgentDetection 2026-04-26-10:50
       * Native Ghostty sessions may start as plain shells and only later reveal
       * the active agent through terminal titles. Mirror demo-project's title
       * detector so Codex, Claude, Pi, Gemini, and Copilot titles update the sidebar
       * icon/status without requiring launch through an agent button.
       */
      if (effectiveDerivedActivity) {
        titleDerivedActivityBySessionId.set(sidebarSessionId, effectiveDerivedActivity);
        terminalState.agentName = effectiveDerivedActivity.agentName;
        terminalState.activity = effectiveDerivedActivity.activity;
        setTerminalSessionAgentName(sidebarSessionId, effectiveDerivedActivity.agentName);
        if (previousActivity !== "working" && terminalState.activity === "working") {
          markNativeSessionSemanticActivityAt(sidebarSessionId, "working", "terminal-title");
        }
        if (previousActivity === "working" && terminalState.activity === "attention") {
          markNativeSessionSemanticActivityAt(sidebarSessionId, "attention", "terminal-title");
        }
        if (previousActivity !== "attention" && terminalState.activity === "attention") {
          handleNativeSessionEnteredAttention(sidebarSessionId, "terminal-title");
        }
      } else {
        titleDerivedActivityBySessionId.delete(sidebarSessionId);
      }
      const didSyncSessionTitle = syncSessionTitleFromNativeTerminalTitle(
        sidebarSessionId,
        hostEvent.title,
        previousTerminalTitle,
      );
      /**
       * CDXC:AgentDetection 2026-04-29-09:16
       * Codex/Claude spinner glyphs can change terminal titles many times per
       * second. Preserve the title-derived activity state above, but skip sidebar
       * publishes when only the spinner glyph changed and the visible title/status
       * stayed equivalent.
       */
      if (
        previousVisibleTerminalTitle === getVisibleTerminalTitle(hostEvent.title) &&
        previousActivity === terminalState.activity &&
        knownAgentNameBeforeDetection === terminalState.agentName &&
        haveSameTitleDerivedSessionActivity(previousDerivedActivity, effectiveDerivedActivity) &&
        !didUpdateSessionPersistenceName &&
        !didSyncSessionTitle
      ) {
        return;
      }
    } else if (hostEvent.type === "terminalExited") {
      terminalState.lifecycleState = "done";
      terminalState.activity = "idle";
      nativeWorkingStartedAtBySessionId.delete(sidebarSessionId);
      handleNativeSidebarCommandSessionExit(sidebarSessionId, hostEvent.exitCode);
    } else if (hostEvent.type === "terminalError") {
      const previousActivity = terminalState.activity;
      terminalState.lifecycleState = "error";
      terminalState.activity = "attention";
      terminalState.terminalTitle = hostEvent.message;
      nativeWorkingStartedAtBySessionId.delete(sidebarSessionId);
      if (previousActivity !== "attention") {
        if (previousActivity === "working") {
          markNativeSessionSemanticActivityAt(sidebarSessionId, "attention", "terminal-error");
        }
        handleNativeSessionEnteredAttention(sidebarSessionId, "terminal-error");
      }
    } else if (hostEvent.type === "terminalBell") {
      const suppressedUntil = getNativeActivitySuppressedUntil(sidebarSessionId);
      if (
        suppressedUntil !== undefined &&
        Number.isFinite(suppressedUntil) &&
        Date.now() < suppressedUntil
      ) {
        appendAgentDetectionDebugLog("nativeSidebar.activitySuppression.bellSuppressed", {
          sessionId: sidebarSessionId,
          suppressedUntil: new Date(suppressedUntil).toISOString(),
        });
        return;
      }
      const previousActivity = terminalState.activity;
      terminalState.activity = "attention";
      if (previousActivity !== "attention") {
        if (previousActivity === "working") {
          markNativeSessionSemanticActivityAt(sidebarSessionId, "attention", "terminal-bell");
        }
        handleNativeSessionEnteredAttention(sidebarSessionId, "terminal-bell");
      }
    } else if (hostEvent.type === "terminalReady") {
      terminalState.lifecycleState = "running";
      if (hostEvent.sessionPersistenceName !== undefined) {
        terminalState.sessionPersistenceName = hostEvent.sessionPersistenceName;
        setTerminalSessionPersistenceName(sidebarSessionId, hostEvent.sessionPersistenceName);
        setTerminalSessionPersistenceProvider(
          sidebarSessionId,
          terminalState.sessionPersistenceProvider,
        );
      }
    }
  }
  publish();
});

function handleNativePaneReorderRequested(
  sourceSessionId: string,
  targetSessionId: string,
  placement?: SessionPaneDropPlacement,
): void {
  if (activeCommandPanelContainsSession(sourceSessionId) || activeCommandPanelContainsSession(targetSessionId)) {
    handleCommandPanelPaneReorderRequested(sourceSessionId, targetSessionId, placement);
    return;
  }
  if (sourceSessionId === targetSessionId) {
    return;
  }
  const group = activeWorkspaceGroup();
  const currentPaneSessionIds = getNativePaneSessionsForSnapshot(
    group.snapshot,
    new Map(group.snapshot.sessions.map((session) => [session.sessionId, session])),
  ).map((session) => session.sessionId);
  const sourceIndex = currentPaneSessionIds.indexOf(sourceSessionId);
  const targetIndex = currentPaneSessionIds.indexOf(targetSessionId);
  if (sourceIndex < 0 || targetIndex < 0) {
    appendTerminalFocusDebugLog("nativePaneReorder.ignored", {
      groupId: group.groupId,
      paneSessionIds: currentPaneSessionIds,
      reason: "session-not-visible",
      sourceSessionId,
      targetSessionId,
    });
    return;
  }

  if (placement) {
    const sourceSessionBeforeDrop = findSessionRecord(sourceSessionId);
    const shouldWakeDroppedSource = sourceSessionBeforeDrop?.isSleeping === true;
    const result = moveSessionInPaneLayoutInSimpleWorkspace(
      activeProject().workspace,
      group.groupId,
      sourceSessionId,
      targetSessionId,
      placement,
      { wakeSourceSession: true },
    );
    if (!result.changed) {
      appendTerminalFocusDebugLog("nativePaneLayoutDrop.ignored", {
        groupId: group.groupId,
        placement,
        reason: "unchanged",
        sourceSessionId,
        targetSessionId,
      });
      return;
    }
    /**
     * CDXC:PaneTabs 2026-05-16-09:43:
     * A sleeping tab dragged into a split/drop target is a committed restore
     * intent. Apply the paneLayout move and wake in one shared-state mutation,
     * then recreate the native surface before publishing so the dropped tab shows
     * as the active pane instead of remaining a parked tab with no renderer.
     */
    updateActiveProjectWorkspace(() => result.snapshot);
    if (shouldWakeDroppedSource) {
      restoreNativeSessionSurfaceForWake(
        activeProject(),
        findSessionRecord(sourceSessionId) ?? sourceSessionBeforeDrop,
        "pane-drop-wake",
      );
      queueNativeLayoutFocusRequest(sourceSessionId, "paneDropWake");
    }
    appendTerminalFocusDebugLog("nativePaneLayoutDrop.applied", {
      groupId: group.groupId,
      placement,
      sourceSessionId,
      targetSessionId,
      wasSleepingSource: shouldWakeDroppedSource,
    });
    publish();
    return;
  }

  const nextVisibleSessionIds = currentPaneSessionIds.map((sessionId) => {
    if (sessionId === sourceSessionId) {
      return targetSessionId;
    }
    if (sessionId === targetSessionId) {
      return sourceSessionId;
    }
    return sessionId;
  });
  /**
   * CDXC:NativePaneReorder 2026-05-02-17:33
   * AppKit title bars own pointer events for native Ghostty, T3, and browser
   * panes. When Swift reports a header drop, mutate the active sidebar
   * workspace order so the next native layout sync moves the panes and
   * persists the same order used by sidebar/session state.
   *
   * CDXC:NativePaneReorder 2026-05-03-06:38
   * A pane drop swaps only the two currently surfaced panes. Hidden sessions
   * must stay hidden; using the full session list here can make a background
   * T3/browser/terminal pane appear when the visible split is reordered.
   */
  updateActiveProjectWorkspace(
    (workspace) =>
      swapVisibleSessionsInSimpleWorkspace(
        workspace,
        group.groupId,
        sourceSessionId,
        targetSessionId,
      ).snapshot,
  );
  appendTerminalFocusDebugLog("nativePaneReorder.applied", {
    groupId: group.groupId,
    nextVisibleSessionIds,
    sourceSessionId,
    targetSessionId,
  });
  publish();
}

function handleNativePaneTabSelected(sessionId: string): void {
  const acknowledgedAttention = acknowledgeNativeTerminalAttention(sessionId, "native-focus");
  if (activeCommandPanelContainsSession(sessionId)) {
    /**
     * CDXC:SessionAttention 2026-05-16-23:35:
     * Clicking an already-selected command or workspace tab must still acknowledge green attention. Tab selection can be a layout no-op, so acknowledge before the unchanged guard and let the delayed attention timer preserve the 1.5-second visual floor when needed.
     */
    updateActiveProjectCommandsPanel((panel) => ({
      ...panel,
      activeSessionId: sessionId,
      isVisible: true,
      paneLayout: setActiveCommandSessionInPaneLayout(panel.paneLayout, sessionId),
    }));
    queueNativeLayoutFocusRequest(sessionId, "commandPaneTabSelected");
    publish();
    return;
  }
  const group = activeWorkspaceGroup();
  const selectedSessionBefore = findSessionRecord(sessionId);
  const wasSleeping = selectedSessionBefore?.isSleeping === true;
  appendPaneLayoutTraceDebugLog("paneTabSelected.received", {
    activeProjectId,
    groupId: group.groupId,
    sessionId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(activeProject().workspace, group.groupId),
    wasSleeping,
  });
  const workspaceWithWake = wasSleeping
    ? setSessionSleepingInSimpleWorkspace(activeProject().workspace, sessionId, false).snapshot
    : activeProject().workspace;
  const result = selectPaneTabInSimpleWorkspace(workspaceWithWake, group.groupId, sessionId);
  if (!result.changed && !wasSleeping) {
    appendPaneLayoutTraceDebugLog("paneTabSelected.unchanged", {
      acknowledgedAttention,
      activeProjectId,
      groupId: group.groupId,
      sessionId,
      targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(workspaceWithWake, group.groupId),
    });
    if (acknowledgedAttention) {
      publish();
    }
    return;
  }
  /**
   * CDXC:PaneTabs 2026-05-11-10:58
   * Native tab clicks select the active tab in paneLayout and focus the same
   * session. If the clicked tab is sleeping, wake its persisted session record
   * first, recreate the native terminal/web surface, then publish the selected
   * tab layout so sleeping tabs are not inert controls.
   */
  updateActiveProjectWorkspace(() => (result.changed ? result.snapshot : workspaceWithWake));
  appendPaneLayoutTraceDebugLog("paneTabSelected.applied", {
    acknowledgedAttention,
    activeProjectId,
    groupId: group.groupId,
    sessionId,
    targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(
      result.changed ? result.snapshot : workspaceWithWake,
      group.groupId,
    ),
    wasSleeping,
  });
  if (wasSleeping) {
    const restoredSession = findSessionRecord(sessionId) ?? selectedSessionBefore;
    restoreNativeSessionSurfaceForWake(activeProject(), restoredSession, "pane-tab-wake");
  }
  queueNativeLayoutFocusRequest(sessionId, wasSleeping ? "paneTabWake" : "paneTabSelected");
  publish();
}

function restoreNativeSessionSurfaceForWake(
  project: NativeProject,
  session: SessionRecord | undefined,
  reason: string,
): void {
  if (session?.kind === "t3") {
    restoreNativeT3Session(project, session, reason);
    return;
  }
  if (session?.kind === "browser") {
    restoreNativeBrowserSession(project, session, reason);
    return;
  }
  if (session?.kind === "terminal" && !terminalStateById.has(session.sessionId)) {
    restoreNativeTerminalSession(project, session, reason);
  }
}

function handleNativePaneTabCloseRequested(
  sessionId: string,
  scope: NativePaneTabCloseScope,
): void {
  if (activeCommandPanelContainsSession(sessionId)) {
    const sessionIds = getCommandPaneTabSessionIds(sessionId, scope);
    for (const commandSessionId of sessionIds) {
      closeTerminal(commandSessionId);
    }
    return;
  }
  const sessionIds = getPaneTabCloseSessionIds(sessionId, scope);
  if (sessionIds.length === 0) {
    appendTerminalFocusDebugLog("nativePaneTabClose.missingTargets", {
      scope,
      sessionExists: findSessionRecord(sessionId) !== undefined,
      sessionId,
    });
    return;
  }
  /**
   * CDXC:PaneTabs 2026-05-11-00:45
   * Native tab close commands must stay scoped to the containing paneLayout
   * tab group. Resolve the clicked tab's sibling list before closing anything
   * so Close Left, Close Right, and Close Other Tabs cannot cross into another
   * split pane or another session group.
   */
  for (const tabSessionId of sessionIds) {
    closeTerminal(tabSessionId);
  }
}

function handleNativePaneTabSleepRequested(
  sessionId: string,
  scope: NativePaneTabSleepScope,
): void {
  const sessionIds = getPaneTabSleepSessionIds(sessionId, scope);
  if (sessionIds.length === 0) {
    appendTerminalFocusDebugLog("nativePaneTabSleep.missingTargets", {
      scope,
      sessionExists: findSessionRecord(sessionId) !== undefined,
      sessionId,
    });
    return;
  }
  /**
   * CDXC:PaneTabs 2026-05-11-02:16
   * Native tab sleep commands use the same tab-group scoping rules as tab
   * closes, but route through setNativeSessionSleeping so terminal sessions
   * preserve their sidebar card and can wake from the normal session path.
   */
  for (const tabSessionId of sessionIds) {
    setNativeSessionSleeping(tabSessionId, true);
  }
}

function handleNativePaneTabReorderRequested(
  sourceSessionId: string,
  targetSessionId: string,
  position: SessionPaneTabReorderPosition,
): void {
  if (activeCommandPanelContainsSession(sourceSessionId) || activeCommandPanelContainsSession(targetSessionId)) {
    handleCommandPanelPaneTabReorderRequested(sourceSessionId, targetSessionId, position);
    return;
  }
  const group = activeWorkspaceGroup();
  const result = reorderSessionInPaneTabGroupInSimpleWorkspace(
    activeProject().workspace,
    group.groupId,
    sourceSessionId,
    targetSessionId,
    position,
  );
  if (!result.changed) {
    appendTerminalFocusDebugLog("nativePaneTabReorder.ignored", {
      groupId: group.groupId,
      position,
      reason: "unchanged",
      sourceSessionId,
      targetSessionId,
    });
    return;
  }
  /**
   * CDXC:PaneTabs 2026-05-11-01:43
   * Native tab-bar reorder gestures persist the order inside the existing tab
   * group. This differs from pane drop center/edge gestures, which group or
   * split panes and may change visibleSessionIds.
   */
  updateActiveProjectWorkspace(() => result.snapshot);
  appendTerminalFocusDebugLog("nativePaneTabReorder.applied", {
    groupId: group.groupId,
    position,
    sourceSessionId,
    targetSessionId,
  });
  publish();
}

function handleCommandPanelPaneReorderRequested(
  sourceSessionId: string,
  targetSessionId: string,
  placement?: SessionPaneDropPlacement,
): void {
  if (
    !placement ||
    (placement !== "center" && placement !== "left" && placement !== "right") ||
    !activeCommandPanelContainsSession(sourceSessionId) ||
    !activeCommandPanelContainsSession(targetSessionId)
  ) {
    return;
  }
  let changed = false;
  updateActiveProjectCommandsPanel((panel) => {
    const layout =
      panel.paneLayout ??
      normalizeCommandPaneLayout(
        undefined,
        new Set(panel.sessions.map((session) => session.sessionId)),
        panel.activeSessionId,
      );
    if (!layout || (sourceSessionId === targetSessionId && placement === "center")) {
      return panel;
    }
    const isSameSessionSideDrop = sourceSessionId === targetSessionId && placement !== "center";
    const resolvedTargetSessionId = isSameSessionSideDrop
      ? getCommandSamePaneSplitAnchorSessionId(layout, sourceSessionId, placement === "right")
      : targetSessionId;
    if (!resolvedTargetSessionId) {
      return panel;
    }
    const layoutWithoutSource = removeCommandSessionFromPaneLayout(layout, sourceSessionId);
    if (!layoutWithoutSource) {
      return panel;
    }
    const nextLayout =
      placement === "center"
        ? addCommandSessionToPaneTabGroup(layoutWithoutSource, resolvedTargetSessionId, sourceSessionId)
        : insertCommandSessionBesidePane(
            layoutWithoutSource,
            resolvedTargetSessionId,
            sourceSessionId,
            placement === "right",
          );
    if (!nextLayout) {
      return panel;
    }
    changed = true;
    return {
      ...panel,
      activeSessionId: sourceSessionId,
      isVisible: true,
      paneLayout: nextLayout,
    };
  });
  if (changed) {
    publish();
  }
}

function handleCommandPanelPaneTabReorderRequested(
  sourceSessionId: string,
  targetSessionId: string,
  position: SessionPaneTabReorderPosition,
): void {
  if (
    sourceSessionId === targetSessionId ||
    !activeCommandPanelContainsSession(sourceSessionId) ||
    !activeCommandPanelContainsSession(targetSessionId)
  ) {
    return;
  }
  let changed = false;
  updateActiveProjectCommandsPanel((panel) => {
    const nextLayout = reorderCommandSessionInPaneTabGroup(
      panel.paneLayout,
      sourceSessionId,
      targetSessionId,
      position,
    );
    if (!nextLayout) {
      return panel;
    }
    changed = true;
    return { ...panel, paneLayout: nextLayout };
  });
  if (changed) {
    publish();
  }
}

function getPaneTabCloseSessionIds(
  sessionId: string,
  scope: NativePaneTabCloseScope,
): string[] {
  const group = activeWorkspaceGroup();
  const tabSessionIds = findPaneTabGroupSessionIds(group.snapshot.paneLayout, sessionId);
  if (!tabSessionIds) {
    return scope === "close" && findSessionRecord(sessionId) ? [sessionId] : [];
  }
  if (tabSessionIds.length === 1 && scope === "close") {
    return tabSessionIds;
  }
  if (tabSessionIds.length === 1) {
    return [];
  }
  const tabIndex = tabSessionIds.indexOf(sessionId);
  if (tabIndex < 0) {
    return [];
  }
  switch (scope) {
    case "close":
      return [sessionId];
    case "closeLeft":
      return tabSessionIds.slice(0, tabIndex);
    case "closeOthers":
      return tabSessionIds.filter((tabSessionId) => tabSessionId !== sessionId);
    case "closeRight":
      return tabSessionIds.slice(tabIndex + 1);
  }
  return [];
}

function getCommandPaneTabSessionIds(
  sessionId: string,
  scope: NativePaneTabCloseScope,
): string[] {
  const tabSessionIds = findPaneTabGroupSessionIds(activeProject().commandsPanel.paneLayout, sessionId);
  if (!tabSessionIds) {
    return scope === "close" && activeCommandPanelContainsSession(sessionId) ? [sessionId] : [];
  }
  const tabIndex = tabSessionIds.indexOf(sessionId);
  if (tabIndex < 0) {
    return [];
  }
  switch (scope) {
    case "close":
      return [sessionId];
    case "closeLeft":
      return tabSessionIds.slice(0, tabIndex);
    case "closeOthers":
      return tabSessionIds.filter((tabSessionId) => tabSessionId !== sessionId);
    case "closeRight":
      return tabSessionIds.slice(tabIndex + 1);
  }
}

function getPaneTabSleepSessionIds(
  sessionId: string,
  scope: NativePaneTabSleepScope,
): string[] {
  const group = activeWorkspaceGroup();
  const tabSessionIds = findPaneTabGroupSessionIds(group.snapshot.paneLayout, sessionId);
  if (!tabSessionIds) {
    return scope === "sleep" && findSessionRecord(sessionId) ? [sessionId] : [];
  }
  if (tabSessionIds.length === 1 && scope === "sleep") {
    return tabSessionIds;
  }
  if (tabSessionIds.length === 1) {
    return [];
  }
  const tabIndex = tabSessionIds.indexOf(sessionId);
  if (tabIndex < 0) {
    return [];
  }
  switch (scope) {
    case "sleep":
      return [sessionId];
    case "sleepLeft":
      return tabSessionIds.slice(0, tabIndex);
    case "sleepOthers":
      return tabSessionIds.filter((tabSessionId) => tabSessionId !== sessionId);
    case "sleepRight":
      return tabSessionIds.slice(tabIndex + 1);
  }
  return [];
}

function findPaneTabGroupSessionIds(
  node: SessionPaneLayoutNode | undefined,
  sessionId: string,
): string[] | undefined {
  if (!node) {
    return undefined;
  }
  if (node.kind === "leaf") {
    return node.sessionId === sessionId ? [sessionId] : undefined;
  }
  if (node.kind === "tabs") {
    return node.sessionIds.includes(sessionId) ? node.sessionIds : undefined;
  }
  if (node.kind === "split") {
    for (const child of node.children) {
      const tabSessionIds = findPaneTabGroupSessionIds(child, sessionId);
      if (tabSessionIds) {
        return tabSessionIds;
      }
    }
  }
  return undefined;
}

function handleNativeTerminalTitleBarAction(
  sessionId: string,
  action: Extract<NativeHostEvent, { type: "terminalTitleBarAction" }>["action"],
): void {
  const session = findSessionRecord(sessionId);
  if (!session) {
    return;
  }
  if (session.kind === "terminal" && session.surface === "commands") {
    switch (action) {
      case "newTerminal":
        /**
         * CDXC:CommandsPanel 2026-05-14-09:41
         * Command-pane tab chrome creates command-surface terminals. Use the
         * command title so double-clicks and native tab-bar add buttons do not
         * create workspace-style `Terminal Session` tabs in the Commands panel.
         *
         * CDXC:CommandsPanel 2026-05-15-14:03:
         * The native tab-bar add button belongs to the clicked command pane.
         * Thread that tab's session id into creation so split command panels
         * add the new terminal as another tab in the clicked pane, not as a
         * brand-new split beside every existing command pane.
         */
        createCommandTerminal("Command Terminal", "", {
          focusAfterCreate: true,
          targetTabGroupSessionId: sessionId,
        });
        return;
      case "pinCommandsPanel":
        setCommandsPanelModeForActiveProject("pinned");
        return;
      case "unpinCommandsPanel":
        setCommandsPanelModeForActiveProject("floating");
        return;
      case "closeCommandsPanel":
        hideCommandsPanelForActiveProject();
        return;
      case "expandCommandsPanel":
        openCommandsPanelForActiveProject();
        return;
      default:
        /**
         * CDXC:CommandsPanel 2026-05-15-13:35
         * Workspace pane actions, including Merge all tabs, must not run for
         * Command Terminal tabs. Command terminals live in their own project
         * panel layout and are intentionally unrelated to workspace pane merges.
         */
        return;
    }
  }
  /**
   * CDXC:NativeTerminals 2026-04-28-13:20
   * Native per-session title bars must expose the same right-side actions as
   * the reference workspace pane header. Route AppKit button clicks back into
   * the sidebar's existing session handlers so title-bar controls and sidebar
   * card controls mutate one source of workspace truth.
   */
  switch (action) {
    case "popOut":
      setNativeSessionPoppedOut(sessionId, true);
      return;
    case "restorePopOut":
      setNativeSessionPoppedOut(sessionId, false);
      return;
    case "newTerminal":
      createTerminal(DEFAULT_TERMINAL_SESSION_TITLE, "", findSessionGroupId(sessionId), undefined, {
        visiblePlacement: {
          kind: "appendToTabGroup",
          targetSessionId: sessionId,
        },
      });
      return;
    case "openBrowser":
      createNativeBrowserSession(DEFAULT_BROWSER_LAUNCH_URL, findSessionGroupId(sessionId), {
        visiblePlacement: {
          kind: "appendToTabGroup",
          targetSessionId: sessionId,
        },
      });
      return;
    case "splitHorizontal":
    case "splitVertical":
      createTerminal(DEFAULT_TERMINAL_SESSION_TITLE, "", findSessionGroupId(sessionId), undefined, {
        splitDirection: action === "splitHorizontal" ? "horizontal" : "vertical",
        visiblePlacement: {
          kind: "insertAfter",
          targetSessionId: sessionId,
        },
      });
      return;
    case "mergeAllTabs": {
      const groupId = findSessionGroupId(sessionId);
      if (!groupId) {
        return;
      }
      const result = mergeAllTabsInPaneLayoutInSimpleWorkspace(
        activeProject().workspace,
        groupId,
        sessionId,
      );
      if (!result.changed) {
        return;
      }
      updateActiveProjectWorkspace(() => result.snapshot);
      appendPaneLayoutTraceDebugLog("mergeAllTabs.applied", {
        groupId,
        sessionId,
        targetGroup: summarizeWorkspaceGroupForPaneLayoutTrace(result.snapshot, groupId),
      });
      queueNativeLayoutFocusRequest(sessionId, "mergeAllTabs");
      publish();
      return;
    }
    case "rotatePanesClockwise": {
      const groupId = findSessionGroupId(sessionId);
      if (!groupId) {
        return;
      }
      /**
       * CDXC:PaneTitleBarUX 2026-05-15-13:51:
       * The collapsed pane overflow menu places Rotate Panes directly below
       * Split Downwards. Use the clicked session's workspace group so the menu
       * action rotates that pane tree instead of whichever group is focused.
       */
      const result = rotatePaneLayoutClockwiseInSimpleWorkspace(activeProject().workspace, groupId);
      if (!result.changed) {
        return;
      }
      updateActiveProjectWorkspace(() => result.snapshot);
      queueNativeLayoutFocusRequest(sessionId, "rotatePanesClockwise");
      publish();
      return;
    }
    case "rename":
      openAppModal({
        initialTitle: session.title || DEFAULT_TERMINAL_SESSION_TITLE,
        modal: "renameSession",
        sessionId,
        type: "open",
      });
      return;
    case "delayedSend":
      promptDelayedSend(sessionId);
      return;
    case "fork":
      if (session.kind === "terminal") {
        forkNativeSession(sessionId);
      } else if (session.kind === "browser") {
        createNativeBrowserSession(session.browser.url, findSessionGroupId(sessionId), {
          visiblePlacement: { kind: "appendToTabGroup", targetSessionId: sessionId },
        });
      } else if (session.kind === "t3") {
        createNativeT3Session(findSessionGroupId(sessionId), {
          visiblePlacement: { kind: "appendToTabGroup", targetSessionId: sessionId },
        });
      }
      return;
    case "reload":
      if (session.kind === "terminal") {
        restartNativeSession(sessionId);
      } else {
        postNative({
          sessionId: nativeSessionIdForSidebarSession(sessionId),
          type: "reloadWebPane",
        });
      }
      return;
    case "sleep":
      if (session.kind === "terminal") {
        setNativeSessionSleeping(sessionId, true);
      }
      return;
    case "pinCommandsPanel":
    case "unpinCommandsPanel":
    case "closeCommandsPanel":
    case "expandCommandsPanel":
      return;
    case "close":
      closeTerminal(sessionId);
      return;
  }
}

window.__ghostex_NATIVE_WORKSPACE_BAR__ = {
  addProject,
  focusProject,
  getState: createWorkspaceBarState,
  removeProject,
  reorderProjects,
  setProjectIcon,
  setProjectTheme,
  setProjectThemeColor,
};

window.__ghostex_NATIVE_SETTINGS__ = {
  attachZedOverlay(targetApp) {
    saveSettingsFromNative({
      ...settings,
      zedOverlayEnabled: true,
      zedOverlayTargetApp: targetApp,
    });
  },
  detachZedOverlay(targetApp) {
    saveSettingsFromNative({
      ...settings,
      zedOverlayEnabled: false,
      zedOverlayTargetApp: targetApp,
    });
  },
};

window.__ghostex_NATIVE_SIDEBAR__ = {
  openActiveProjectEditorFromTitlebar,
  openAgentsModeFromTitlebar,
  openGitHubProjectFromTitlebar: () => {
    void openGitHubProjectFromTitlebar();
  },
  showProjectEditorCompanionFromTitlebar,
  sleepInactiveSessionsFromTitlebar,
  openTasksPlaceholderFromTitlebar,
  refreshWorkspaceOpenTargetAvailabilityFromTitlebar,
  rotateActivePaneLayoutClockwiseFromTitlebar,
  togglePetOverlayFromTitlebar,
  toggleCommandsPanelFromTitlebar,
  runSidebarCommandFromTitlebar,
};

window.__ghostex_NATIVE_CLI__ = {
  handleCommand(action, payload) {
    return handleNativeCliCommand(action, payload);
  },
};

type WorkspaceDockMenuState = {
  left: number;
  projectId: string;
  view: "customTheme" | "root" | "themes";
  top: number;
};

type WorkspaceDockDragState = {
  didDrag: boolean;
  ghostText: string;
  pointerId: number;
  projectId: string;
  startX: number;
  startY: number;
  targetProjectId?: string;
  placeAfterTarget: boolean;
};

function NativeSidebarRoot() {
  useEffect(() => {
    const suppressWebviewContextMenu = (event: MouseEvent) => {
      /**
       * CDXC:SidebarContextMenu 2026-05-15-17:49:
       * Right-clicking empty sidebar space must not expose WKWebView's native
       * Reload menu. Prevent the webview default in capture phase while leaving
       * propagation intact so React-owned session and project context menus can
       * still handle the same event.
       */
      event.preventDefault();
    };

    document.body.classList.add("native-sidebar-body");
    document.addEventListener("contextmenu", suppressWebviewContextMenu, true);
    return () => {
      document.body.classList.remove("native-sidebar-body");
      document.removeEventListener("contextmenu", suppressWebviewContextMenu, true);
    };
  }, []);

  return (
    <div className="native-sidebar-shell" data-sidebar-mode="combined">
      {/* CDXC:SidebarLayout 2026-05-13-08:11
          Combined is the only supported sidebar layout, so projects render as
          sidebar groups and the old workspace rail is not mounted. */}
      <main className="native-sidebar-main">
        <SidebarApp messageSource={sidebarBus} vscode={vscode} />
      </main>
    </div>
  );
}

type WorkspaceDockActions = {
  focusProject: (projectId: string) => void;
  openProjectInFinder: (projectId: string) => void;
  openProjectInIde: (projectId: string) => void;
  pickWorkspaceFolder: () => void;
  pickWorkspaceIcon: (projectId: string) => void;
  removeProject: (projectId: string) => void;
  reorderProjects: (projectIds: string[]) => void;
  setProjectTheme: (projectId: string, theme: SidebarTheme) => void;
  setProjectThemeColor: (projectId: string, themeColor: string) => void;
};

/**
 * CDXC:WorkspaceDock 2026-04-27-09:23
 * Keep the React workspace dock action-driven so Storybook can exercise icon,
 * remove, and theme menu UX without entering native publish/modal code paths.
 */
export function WorkspaceDock({
  actions,
  state,
}: {
  actions?: Partial<WorkspaceDockActions>;
  state: WorkspaceBarStateMessage;
}) {
  const [dragVisual, setDragVisual] = useState<{
    ghostText: string;
    isDragging: boolean;
    line?: { top: number; left: number; width: number };
    pointerX: number;
    pointerY: number;
    sourceProjectId?: string;
  }>({ ghostText: "", isDragging: false, pointerX: 0, pointerY: 0 });
  const [menu, setMenu] = useState<WorkspaceDockMenuState>();
  const [customThemeColor, setCustomThemeColor] = useState(DEFAULT_WORKSPACE_THEME_COLOR);
  const [recentThemeColors, setRecentThemeColors] = useState(readWorkspaceThemeColorHistory);
  const dockRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<WorkspaceDockDragState | undefined>(undefined);
  const selectedIdeLabel = getZedOverlayTargetAppLabel(settings.zedOverlayTargetApp);
  const workspaceActions: WorkspaceDockActions = {
    focusProject,
    openProjectInFinder: (projectId) => {
      const project = state.projects.find((candidate) => candidate.projectId === projectId);
      if (project) {
        openNativeWorkspaceInFinder(project.path);
      }
    },
    openProjectInIde: (projectId) => {
      const project = state.projects.find((candidate) => candidate.projectId === projectId);
      if (project) {
        openNativeWorkspaceInSelectedIde(project.path);
      }
    },
    pickWorkspaceFolder: () => postNative({ type: "pickWorkspaceFolder" }),
    pickWorkspaceIcon: (projectId) => postNative({ projectId, type: "pickWorkspaceIcon" }),
    removeProject,
    reorderProjects,
    setProjectTheme,
    setProjectThemeColor,
    ...actions,
  };

  const activeProjectIds = useMemo(
    () => new Set(state.projects.map((project) => project.projectId)),
    [state.projects],
  );

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        setMenu(undefined);
        return;
      }
      if (!dockRef.current?.contains(event.target)) {
        setMenu(undefined);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(undefined);
      }
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("contextmenu", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("contextmenu", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (menu && !activeProjectIds.has(menu.projectId)) {
      setMenu(undefined);
    }
  }, [activeProjectIds, menu]);

  const dragProjectIds = state.projects.map((project) => project.projectId);

  const getDropTarget = (clientY: number, sourceProjectId: string) => {
    const buttons = Array.from(
      dockRef.current?.querySelectorAll<HTMLButtonElement>(".workspace-dock-button") ?? [],
    ).filter((button) => button.dataset.projectId !== sourceProjectId);
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) {
        return { bounds, placeAfterTarget: false, projectId: button.dataset.projectId };
      }
    }
    const lastButton = buttons.at(-1);
    if (!lastButton) {
      return undefined;
    }
    const bounds = lastButton.getBoundingClientRect();
    return { bounds, placeAfterTarget: true, projectId: lastButton.dataset.projectId };
  };

  const nextProjectOrder = (
    sourceProjectId: string,
    targetProjectId: string | undefined,
    placeAfterTarget: boolean,
  ) => {
    if (!targetProjectId || sourceProjectId === targetProjectId) {
      return undefined;
    }
    const ids = [...dragProjectIds];
    const fromIndex = ids.indexOf(sourceProjectId);
    if (fromIndex < 0 || !ids.includes(targetProjectId)) {
      return undefined;
    }
    const [movedProjectId] = ids.splice(fromIndex, 1);
    const targetIndex = ids.indexOf(targetProjectId);
    ids.splice(targetIndex + (placeAfterTarget ? 1 : 0), 0, movedProjectId);
    return ids;
  };

  const wouldReorder = (
    sourceProjectId: string,
    targetProjectId: string | undefined,
    placeAfterTarget: boolean,
  ) => {
    const nextIds = nextProjectOrder(sourceProjectId, targetProjectId, placeAfterTarget);
    return Boolean(
      nextIds?.some((projectId, index) => projectId !== state.projects[index]?.projectId),
    );
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    project: WorkspaceBarProject,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragRef.current = {
      didDrag: false,
      ghostText: workspaceDockInitials(project.title, state.projects.indexOf(project)),
      pointerId: event.pointerId,
      projectId: project.projectId,
      startX: event.clientX,
      startY: event.clientY,
      placeAfterTarget: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.didDrag && Math.hypot(deltaX, deltaY) < 5) {
      return;
    }
    drag.didDrag = true;
    const target = getDropTarget(event.clientY, drag.projectId);
    const canDrop = wouldReorder(
      drag.projectId,
      target?.projectId,
      target?.placeAfterTarget ?? false,
    );
    drag.targetProjectId = canDrop ? target?.projectId : undefined;
    drag.placeAfterTarget = canDrop ? (target?.placeAfterTarget ?? false) : false;
    setDragVisual({
      ghostText: drag.ghostText,
      isDragging: true,
      line:
        canDrop && target
          ? {
              left: target.bounds.left + 1,
              top: target.placeAfterTarget ? target.bounds.bottom + 4 : target.bounds.top - 4,
              width: Math.max(34, target.bounds.width - 2),
            }
          : undefined,
      pointerX: event.clientX,
      pointerY: event.clientY,
      sourceProjectId: drag.projectId,
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>, projectId: string) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = undefined;
    setDragVisual({ ghostText: "", isDragging: false, pointerX: 0, pointerY: 0 });
    if (!drag.didDrag) {
      workspaceActions.focusProject(projectId);
      return;
    }
    const nextIds = nextProjectOrder(drag.projectId, drag.targetProjectId, drag.placeAfterTarget);
    if (nextIds) {
      workspaceActions.reorderProjects(nextIds);
    }
  };

  const openMenu = (event: ReactMouseEvent<HTMLButtonElement>, projectId: string) => {
    event.preventDefault();
    const offset = 8;
    const menuWidth = 196;
    const rootMenuHeight = 196;
    /**
     * CDXC:WorkspaceDock 2026-04-27-09:40
     * Opening the workspace context menu directly under the right-click point
     * lets the release/click that opened the menu accidentally activate the
     * first item. Offset the menu from the pointer and require explicit clicks
     * for destructive/native actions such as picking an icon.
     */
    setMenu({
      left: Math.min(event.clientX + offset, window.innerWidth - menuWidth),
      projectId,
      top: Math.min(event.clientY + offset, window.innerHeight - rootMenuHeight),
      view: "root",
    });
  };

  /**
   * CDXC:WorkspaceDock 2026-04-27-09:17
   * Workspace theme selection is a submenu, matching the worktree action menu
   * UX. Open it only from an explicit click so hovering Theme previews nothing
   * and cannot make the menu feel like it is navigating by itself.
   */
  const openThemeMenu = () => {
    setMenu((currentMenu) => (currentMenu ? { ...currentMenu, view: "themes" } : currentMenu));
  };

  const openRootMenu = () => {
    setMenu((currentMenu) => (currentMenu ? { ...currentMenu, view: "root" } : currentMenu));
  };

  const openCustomThemeMenu = () => {
    if (!menu) {
      return;
    }
    const project = state.projects.find((candidate) => candidate.projectId === menu.projectId);
    setCustomThemeColor(
      project?.themeColor ?? recentThemeColors[0] ?? DEFAULT_WORKSPACE_THEME_COLOR,
    );
    setMenu({ ...menu, view: "customTheme" });
  };

  const chooseTheme = (projectId: string, theme: SidebarTheme) => {
    workspaceActions.setProjectTheme(projectId, theme);
    setMenu(undefined);
  };

  const chooseCustomThemeColor = (projectId: string, themeColor: string) => {
    const normalizedColor = normalizeWorkspaceThemeColor(themeColor);
    if (!normalizedColor) {
      return;
    }

    workspaceActions.setProjectThemeColor(projectId, normalizedColor);
    const nextRecentThemeColors = updateWorkspaceThemeColorHistory(
      recentThemeColors,
      normalizedColor,
    );
    setRecentThemeColors(nextRecentThemeColors);
    writeWorkspaceThemeColorHistory(nextRecentThemeColors);
    setMenu(undefined);
  };

  const menuProject = menu
    ? state.projects.find((project) => project.projectId === menu.projectId)
    : undefined;

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <aside className="workspace-dock" ref={dockRef}>
        <div className="workspace-dock-scroll">
          {state.projects.map((project, index) => (
            <AppTooltip content={workspaceDockTitle(project)} key={project.projectId}>
              <button
                aria-label={`Open ${project.title}`}
                className="workspace-dock-button"
                data-active={String(project.isActive)}
                data-dragging={String(dragVisual.sourceProjectId === project.projectId)}
                data-project-id={project.projectId}
                data-workspace-theme={project.theme ?? "dark-blue"}
                onContextMenu={(event) => openMenu(event, project.projectId)}
                onPointerCancel={() => {
                  dragRef.current = undefined;
                  setDragVisual({ ghostText: "", isDragging: false, pointerX: 0, pointerY: 0 });
                }}
                onPointerDown={(event) => handlePointerDown(event, project)}
                onPointerMove={handlePointerMove}
                onPointerUp={(event) => handlePointerUp(event, project.projectId)}
                style={getWorkspaceDockThemeStyle(project.themeColor)}
                type="button"
              >
                <WorkspaceDockProjectIcon project={project} projectIndex={index} />
                <WorkspaceDockIndicators project={project} />
              </button>
            </AppTooltip>
          ))}
        </div>
        <AppTooltip content="Add Workspace">
          <button
            aria-label="Add workspace"
            className="workspace-dock-add-button"
            onClick={workspaceActions.pickWorkspaceFolder}
            type="button"
          >
            <IconPlus aria-hidden="true" size={18} stroke={2.4} />
          </button>
        </AppTooltip>
      {dragVisual.isDragging ? (
        <div
          aria-hidden="true"
          className="workspace-dock-drag-ghost"
          style={{ left: dragVisual.pointerX, top: dragVisual.pointerY }}
        >
          {dragVisual.ghostText}
        </div>
      ) : null}
      {dragVisual.line ? (
        <div
          aria-hidden="true"
          className="workspace-dock-drop-line"
          style={{
            left: dragVisual.line.left,
            top: dragVisual.line.top,
            width: dragVisual.line.width,
          }}
        />
      ) : null}
      {menu && menuProject ? (
        <div
          className="session-context-menu workspace-dock-context-menu"
          role="menu"
          style={{ left: menu.left, top: menu.top }}
          /**
           * CDXC:WorkspaceDock 2026-04-27-09:46
           * Workspace context-menu clicks are internal navigation/actions. Stop
           * them at the menu boundary so the document outside-click listener
           * does not close the menu before the Theme submenu can replace it.
           */
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.view === "root" ? (
            <>
              <button
                className="session-context-menu-item"
                onClick={openThemeMenu}
                role="menuitem"
                type="button"
              >
                <IconPalette aria-hidden="true" className="session-context-menu-icon" size={14} />
                Theme
                <IconChevronRight
                  aria-hidden="true"
                  className="session-context-menu-trailing-icon"
                  size={14}
                />
              </button>
              <button
                className="session-context-menu-item"
                onClick={() => {
                  workspaceActions.openProjectInFinder(menu.projectId);
                  setMenu(undefined);
                }}
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
              {/*
               * CDXC:WorkspaceActions 2026-05-04-08:22
               * Right-clicking a project in the workspace dock must expose the
               * same direct open actions as combined project cards. The IDE
               * action names and targets the Settings-selected IDE.
               */}
              <button
                className="session-context-menu-item"
                onClick={() => {
                  workspaceActions.openProjectInIde(menu.projectId);
                  setMenu(undefined);
                }}
                role="menuitem"
                type="button"
              >
                <IconCode aria-hidden="true" className="session-context-menu-icon" size={14} />
                Open in {selectedIdeLabel}
              </button>
              <div className="session-context-menu-divider" role="separator" />
              <button
                className="session-context-menu-item session-context-menu-item-danger"
                disabled={state.projects.length <= 1}
                onClick={() => {
                  workspaceActions.removeProject(menu.projectId);
                  setMenu(undefined);
                }}
                role="menuitem"
                type="button"
              >
                <IconTrash aria-hidden="true" className="session-context-menu-icon" size={14} />
                Remove
              </button>
            </>
          ) : menu.view === "themes" ? (
            <>
              <button
                className="session-context-menu-item"
                onClick={openRootMenu}
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
                data-selected={String(Boolean(menuProject.themeColor))}
                onClick={openCustomThemeMenu}
                role="menuitemradio"
                type="button"
              >
                <span
                  className="workspace-dock-theme-swatch"
                  style={getWorkspaceDockThemeSwatchStyle(
                    menuProject.themeColor ?? recentThemeColors[0] ?? DEFAULT_WORKSPACE_THEME_COLOR,
                  )}
                />
                Custom
                <IconChevronRight
                  aria-hidden="true"
                  className="session-context-menu-trailing-icon"
                  size={14}
                />
              </button>
              {WORKSPACE_DOCK_THEME_OPTIONS.map((theme) => (
                <button
                  className="session-context-menu-item workspace-dock-theme-menu-item"
                  data-selected={String(
                    !menuProject.themeColor && (menuProject.theme ?? "dark-blue") === theme.value,
                  )}
                  key={theme.value}
                  onClick={() => chooseTheme(menu.projectId, theme.value)}
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
          ) : (
            <>
              <button
                className="session-context-menu-item"
                onClick={openThemeMenu}
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
                 * Custom color selection belongs in the Theme context menu.
                 * The picker writes a project theme color immediately and also
                 * records recent validated colors for the palette below.
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
                  onClick={() => chooseCustomThemeColor(menu.projectId, customThemeColor)}
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
                      onClick={() => chooseCustomThemeColor(menu.projectId, themeColor)}
                      style={getWorkspaceDockThemeSwatchStyle(themeColor)}
                      type="button"
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      </aside>
    </TooltipProvider>
  );
}

function WorkspaceDockProjectIcon({
  project,
  projectIndex,
}: {
  project: WorkspaceBarProject;
  projectIndex: number;
}) {
  const icon =
    project.icon ??
    (project.iconDataUrl ? { dataUrl: project.iconDataUrl, kind: "image" as const } : undefined);
  if (icon?.kind === "image") {
    return <img alt="" className="workspace-dock-icon-image" src={icon.dataUrl} />;
  }
  if (icon?.kind === "tabler") {
    return (
      <SidebarCommandIconGlyph
        className="workspace-dock-tabler-icon"
        color={icon.color ?? "currentColor"}
        icon={icon.icon}
        size={22}
        stroke={1.9}
      />
    );
  }
  if (project.isChat) {
    return <IconMessageCirclePlus aria-hidden="true" size={21} stroke={2} />;
  }
  return (
    <span className="workspace-dock-initials">
      {workspaceDockInitials(project.title, projectIndex)}
    </span>
  );
}

function WorkspaceDockIndicators({ project }: { project: WorkspaceBarProject }) {
  const { done, running, working } = project.sessionCounts;
  return (
    <>
      {done > 0 || working > 0 ? (
        <span className="workspace-dock-indicators">
          {done > 0 ? (
            <span className="workspace-dock-indicator" data-status="done">
              {formatWorkspaceDockCount(done)}
            </span>
          ) : null}
          {working > 0 ? (
            <span className="workspace-dock-indicator" data-status="working">
              {formatWorkspaceDockCount(working)}
            </span>
          ) : null}
        </span>
      ) : null}
      {running > 0 ? (
        <span className="workspace-dock-indicator" data-status="running">
          {formatWorkspaceDockCount(running)}
        </span>
      ) : null}
    </>
  );
}

function workspaceDockInitials(title: string, index: number): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return String(index + 1);
  }
  const words = trimmed.split(/\s+/u).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function workspaceDockTitle(project: WorkspaceBarProject): string {
  const summary = [
    project.sessionCounts.running > 0 ? `${project.sessionCounts.running} running` : "",
    project.sessionCounts.working > 0 ? `${project.sessionCounts.working} working` : "",
    project.sessionCounts.done > 0 ? `${project.sessionCounts.done} done` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return summary ? `${project.path || project.title} - ${summary}` : project.path || project.title;
}

/**
 * CDXC:WorkspaceTheme 2026-05-05-02:58
 * Custom workspace theme colors should tint the same dock button variables as
 * preset themes. Compute the contrast foreground once in React so CSS can keep
 * using the existing workspace-dock variable contract.
 */
function getWorkspaceDockThemeStyle(themeColor: string | undefined): CSSProperties | undefined {
  const normalizedColor = normalizeWorkspaceThemeColor(themeColor);
  if (!normalizedColor) {
    return undefined;
  }

  return {
    "--workspace-dock-button-background": normalizedColor,
    "--workspace-dock-button-border": `color-mix(in srgb, ${normalizedColor} 68%, white 32%)`,
    "--workspace-dock-button-foreground": getWorkspaceThemeForeground(normalizedColor),
  } as CSSProperties;
}

function getWorkspaceDockThemeSwatchStyle(themeColor: string | undefined): CSSProperties | undefined {
  const normalizedColor = normalizeWorkspaceThemeColor(themeColor);
  if (!normalizedColor) {
    return undefined;
  }

  return {
    "--workspace-dock-button-background": normalizedColor,
  } as CSSProperties;
}

function formatWorkspaceDockCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

const rootElement = document.getElementById("root");
const isStorybookPreview = "__STORYBOOK_PREVIEW__" in window;
if (!rootElement && !isStorybookPreview) {
  throw new Error("Native sidebar root element was not found.");
}

if (rootElement && !isStorybookPreview) {
  installAppModalGlobalErrorLogging("AppModals:nativeSidebar");
  createRoot(rootElement).render(<NativeSidebarRoot />);
  queueMicrotask(() => {
    postNative({ side: sidebarSide, type: "setSidebarSide" });
    postZedOverlaySettings("startup");
    startChromeCanaryRunningMonitor();
    startFirstPromptAutoRenameMonitor();
    void refreshGitState();
    void refreshVisibleProjectDiffStats();
    if (restoreActiveProjectEditorAtStartup()) {
      publish();
    } else if (activeSnapshot().sessions.length === 0) {
      createTerminal(DEFAULT_TERMINAL_SESSION_TITLE);
    } else {
      publish();
    }
    openTipsAndTricksOnFirstLaunch();
  });

  void refreshWorkspaceOpenTargetAvailabilityAtStartup();
}
