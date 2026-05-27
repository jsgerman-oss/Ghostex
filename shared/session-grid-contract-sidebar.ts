import type { CompletionSoundSetting } from "./completion-sound";
import type { AgentAcceptAllMode } from "./sidebar-agent-accept-all";
import type { SidebarAgentButton, SidebarAgentIcon } from "./sidebar-agents";
import type { SidebarCommandIcon } from "./sidebar-command-icons";
import type { WorkspaceDockIcon } from "./workspace-dock-icons";
import type {
  SidebarActionType,
  SidebarCommandButton,
  SidebarCommandRunMode,
} from "./sidebar-commands";
import type { SidebarGitAction, SidebarGitChangedFile, SidebarGitState } from "./sidebar-git";
import type { SidebarProjectDiffStats } from "./project-diff-stats";
import type { ghostexSettings } from "./ghostex-settings";
import type { WorkspaceIdeTargetApp } from "./workspace-open-targets";
import type { ghostexHotkeyActionId } from "./ghostex-hotkeys";
import type { SidebarPinnedPrompt } from "./sidebar-pinned-prompts";
import type {
  SessionLifecycleState,
  SessionGridSnapshot,
  SessionRecord,
  SidebarTheme,
  TerminalSessionPersistenceProvider,
  TerminalViewMode,
  VisibleSessionCount,
} from "./session-grid-contract-core";

export type SidebarActiveSessionsSortMode = "manual" | "lastActivity";

export type AgentsHubTab = "mds" | "skills" | "hooks" | "configs";

export type AgentsHubProfile = {
  agentIcon: SidebarAgentIcon;
  filePath: string;
  label: string;
  profilePath: string;
  targetPath?: string;
};

export type AgentsHubFile = {
  content: string;
  id: string;
  language: string;
  name: string;
  path: string;
};

export type AgentsHubGroup = {
  description: string;
  files: AgentsHubFile[];
  id: string;
  name: string;
  path: string;
  profiles: AgentsHubProfile[];
};

export type AgentsHubCatalogMessage = {
  generatedAt: string;
  groupsByTab: Record<AgentsHubTab, AgentsHubGroup[]>;
  type: "agentsHubCatalog";
};

export type SidebarAgentHookStatus = "installed" | "missing" | "cliMissing" | "notRequired";

export type SidebarAgentHookStatusItem = {
  agentId: string;
  cliCommand: string;
  cliInstalled: boolean;
  detail: string;
  hookInstalled: boolean;
  paths: string[];
  status: SidebarAgentHookStatus;
};

/**
 * CDXC:AgentHookSettings 2026-05-23-10:05:
 * Settings -> Agents shows machine-local hook setup status for the same reliable-resume agents Ghostex installs at startup. Native owns filesystem inspection and returns only normalized status rows so the modal host can render the result without direct filesystem access.
 */
export type SidebarAgentHookStatusMessage = {
  agents: SidebarAgentHookStatusItem[];
  errorMessage?: string;
  generatedAt: string;
  hookStateDirectory: string;
  notifyHookPath: string;
  type: "agentHookStatus";
};

export type SidebarGhostexCliStatusMessage = {
  /**
   * CDXC:BrowserAgentControl 2026-05-26-22:17:
   * First-launch CLI setup treats the browser DevTools MCP skill as part of the
   * installed CLI experience because agents need both the executable and the
   * skill instructions before they can inspect embedded CEF logs and pages.
   *
   * CDXC:IntegrationsSetup 2026-05-27-04:17:
   * Settings -> Integrations and the first-launch flow need one native-owned
   * status payload for CLI, Browser Control, and Desktop Control. Native owns
   * PATH and app-bundle checks so React can warn without guessing from UI state.
   */
  browserSkillInstalled: boolean;
  browserSkillPath?: string;
  cuaAppInstalled: boolean;
  cuaDriverInstalled: boolean;
  cuaDriverPath?: string;
  detail: string;
  generatedAt: string;
  ghostexPath?: string;
  gxBlockedByExistingCommand: boolean;
  gxPath?: string;
  gxUsable: boolean;
  installed: boolean;
  type: "ghostexCliStatus";
};

export type SidebarSessionItem = {
  kind?: "browser" | "workspace";
  sessionKind?: "browser" | "terminal" | "t3";
  activity: "idle" | "working" | "attention";
  activityLabel?: string;
  agentIcon?: SidebarAgentIcon;
  /**
   * CDXC:SessionRestore 2026-05-22-23:59:
   * Agent CLI hook installs capture the stable provider session id separately from Ghostex's visible session id. Sidebar cards carry that value so hover tooltips can show the exact resume target while title-based restore remains a backup.
   */
  agentSessionId?: string;
  faviconDataUrl?: string;
  firstUserMessage?: string;
  isGeneratingFirstPromptTitle?: boolean;
  isReloading?: boolean;
  lifecycleState?: SessionLifecycleState;
  isFavorite?: boolean;
  lastInteractionAt?: string;
  sessionId: string;
  sessionNumber?: string;
  sessionPersistenceName?: string;
  sessionPersistenceProvider?: TerminalSessionPersistenceProvider;
  primaryTitle?: string;
  isPrimaryTitleTerminalTitle?: boolean;
  terminalTitle?: string;
  alias: string;
  shortcutLabel: string;
  row: number;
  column: number;
  isFocused: boolean;
  isSleeping?: boolean;
  isVisible: boolean;
  isRunning: boolean;
  detail?: string;
  /**
   * CDXC:DelayedSend 2026-05-17-03:14
   * Delayed Send timers must be visible before they fire. Carry both the
   * absolute deadline and the display countdown so sidebar cards, titlebar
   * resources, and tooltips can show the same remaining time.
   */
  delayedSendDeadlineAt?: string;
  delayedSendRemainingLabel?: string;
  delayedSendRemainingMs?: number;
  /**
   * CDXC:PanePopOut 2026-05-19-10:15:
   * Sidebar session context menus need the live pop-out presentation flag so
   * browser and agent cards can offer Pop Out Pane versus Restore Pane without
   * re-querying native chrome state.
   */
  isPoppedOut?: boolean;
};

export function getSidebarSessionLifecycleState(
  session: Pick<SidebarSessionItem, "lifecycleState" | "isRunning" | "isSleeping">,
): SessionLifecycleState {
  if (session.lifecycleState) {
    return session.lifecycleState;
  }

  if (session.isSleeping) {
    return "sleeping";
  }

  return session.isRunning ? "running" : "done";
}

export type SidebarPreviousSessionItem = SidebarSessionItem & {
  closedAt: string;
  groupId?: string;
  historyId: string;
  isGeneratedName: boolean;
  isRestorable: boolean;
  /**
   * CDXC:PreviousSessions 2026-05-05-05:30
   * Restoring from Previous Sessions must recreate the archived agent session,
   * not only its card title. Store the normalized session record and source
   * project/group metadata so native restore can preserve agent identity,
   * first-message metadata, title provenance, and resumable session details.
   */
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  sessionRecord?: SessionRecord;
};

export type SidebarSessionGroup = {
  kind?: "browser" | "workspace";
  groupId: string;
  isActive: boolean;
  /**
   * CDXC:Chats 2026-05-04-09:41
   * Native Combined mode renders all chat folders under one synthetic Chats
   * header. Mark it explicitly so the React sidebar can keep it non-draggable
   * and route its add button to creating a new chat folder.
   */
  isChatCollection?: boolean;
  isFocusModeActive: boolean;
  layoutVisibleCount: VisibleSessionCount;
  projectContext?: {
    canRemoveProject: boolean;
    /**
     * CDXC:EditorPanes 2026-05-06-14:21
     * Combined project cards expose one project-owned code editor surface.
     * The editor is not a split session, so sidebar state carries it through
     * project context instead of mixing it into session card records.
     */
    editor: {
      diffStats: SidebarProjectDiffStats;
      /**
       * CDXC:EditorPanes 2026-05-09-17:24
       * Project editor rows represent attempted/running editor surfaces, not
       * only focused panes. Carry load status so the sidebar can keep the row
       * visible through startup failures and show timeout diagnostics.
       */
      errorMessage?: string;
      isOpen: boolean;
      isSleeping: boolean;
      projectId: string;
      status: "idle" | "opening" | "running" | "error";
    };
    theme?: SidebarTheme;
    themeColor?: string;
    worktree?: SidebarProjectWorktreeMetadata;
  };
  sessions: SidebarSessionItem[];
  title: string;
  viewMode: TerminalViewMode;
  visibleCount: VisibleSessionCount;
};

export type SidebarProjectWorktreeMetadata = {
  branch: string;
  createdAt?: string;
  name: string;
  parentProjectId: string;
  parentProjectName: string;
  parentProjectPath: string;
};

export type SidebarProjectWorktree = {
  branch?: string;
  directory: string;
  name: string;
};

export type SidebarProjectSettingsItem = {
  beadsDisplayKey?: string;
  name: string;
  path: string;
  projectId: string;
  worktreeCommand?: string;
};

export type SidebarRecentProject = {
  icon?: WorkspaceDockIcon;
  iconDataUrl?: string;
  path: string;
  projectId: string;
  recentClosedAt?: string;
  sessionCount: number;
  theme?: SidebarTheme;
  themeColor?: string;
  title: string;
};

export type SidebarCommandSessionIndicator = {
  commandId: string;
  isActive?: boolean;
  sessionId: string;
  status: "idle" | "running" | "error";
  title?: string;
};

export type SidebarHudState = {
  activeSessionsSortMode: SidebarActiveSessionsSortMode;
  agentManagerZoomPercent: number;
  agents: SidebarAgentButton[];
  buildStamp?: string;
  commands: SidebarCommandButton[];
  commandSessionIndicators: SidebarCommandSessionIndicator[];
  completionBellEnabled: boolean;
  completionSound: CompletionSoundSetting;
  completionSoundLabel: string;
  /**
   * CDXC:WorkspaceTheme 2026-05-05-02:58
   * The active workspace can override the preset sidebar theme with a custom
   * validated color. Keep the preset `theme` as the fallback, and send this
   * color separately so CSS can derive app-level theme variables.
   */
  customThemeColor?: string;
  debuggingMode: boolean;
  focusedSessionTitle?: string;
  git: SidebarGitState;
  isFocusModeActive: boolean;
  pendingAgentIds: string[];
  /**
   * CDXC:Worktrees 2026-05-18-23:07:
   * The Worktrees settings surface needs the same project id/name/path projection as native workspace storage, plus an optional per-project command override for creating worktrees.
   */
  projectSettingsProjects?: SidebarProjectSettingsItem[];
  /**
   * CDXC:RecentProjects 2026-05-04-14:25
   * Combined sidebar hides projects without active/sleeping sessions in a
   * bottom Recent Projects drawer. The drawer receives a compact, sorted
   * projection so React can restore projects without owning native session
   * storage.
   */
  recentProjects: SidebarRecentProject[];
  projectWorktrees?: SidebarProjectWorktree[];
  settings?: ghostexSettings;
  createSessionOnSidebarDoubleClick: boolean;
  renameSessionOnDoubleClick: boolean;
  showCloseButtonOnSessionCards: boolean;
  showHotkeysOnSessionCards: boolean;
  theme:
    | "plain-dark"
    | "plain-light"
    | "dark-green"
    | "dark-blue"
    | "dark-red"
    | "dark-pink"
    | "dark-orange"
    | "light-blue"
    | "light-green"
    | "light-pink"
    | "light-orange";
  highlightedVisibleCount: VisibleSessionCount;
  visibleCount: VisibleSessionCount;
  visibleSlotLabels: string[];
  viewMode: TerminalViewMode;
};

export type SidebarHydrateMessage = {
  groups: SidebarSessionGroup[];
  pinnedPrompts: SidebarPinnedPrompt[];
  previousSessions: SidebarPreviousSessionItem[];
  revision: number;
  scratchPadContent: string;
  type: "hydrate";
  hud: SidebarHudState;
};

export type SidebarSessionStateMessage = {
  groups: SidebarSessionGroup[];
  pinnedPrompts: SidebarPinnedPrompt[];
  previousSessions: SidebarPreviousSessionItem[];
  revision: number;
  scratchPadContent: string;
  type: "sessionState";
  hud: SidebarHudState;
};

export type SidebarSessionPresentationChangedMessage = {
  session: SidebarSessionItem;
  type: "sessionPresentationChanged";
};

export type SidebarPlayCompletionSoundMessage = {
  sound: CompletionSoundSetting;
  sessionId?: string;
  type: "playCompletionSound";
};

export type SidebarOrderSyncKind = "agent" | "command";

export type SidebarOrderSyncResultMessage = {
  itemIds: string[];
  kind: SidebarOrderSyncKind;
  requestId: string;
  status: "error" | "success";
  type: "sidebarOrderSyncResult";
};

export type SidebarCommandRunState = "error" | "running" | "success";

export type SidebarCommandRunStateChangedMessage = {
  commandId: string;
  runId: string;
  state: SidebarCommandRunState;
  type: "sidebarCommandRunStateChanged";
};

export type SidebarCommandRunStateClearedMessage = {
  commandId: string;
  type: "sidebarCommandRunStateCleared";
};

export type SidebarDaemonInfo = {
  pid: number;
  port: number;
  protocolVersion: number;
  startedAt: string;
};

export type SidebarDaemonSessionItem = {
  agentName?: string;
  agentStatus: "idle" | "working" | "attention";
  cols: number;
  cwd: string;
  endedAt?: string;
  errorMessage?: string;
  exitCode?: number;
  isCurrentWorkspace: boolean;
  restoreState: "live" | "replayed";
  rows: number;
  sessionId: string;
  shell: string;
  startedAt: string;
  status: "starting" | "running" | "exited" | "error" | "disconnected";
  title?: string;
  workspaceId: string;
};

export type SidebarDaemonSessionsStateMessage = {
  daemon?: SidebarDaemonInfo;
  errorMessage?: string;
  sessions: SidebarDaemonSessionItem[];
  t3Server?: SidebarT3ServerInfo;
  t3Sessions: SidebarT3SessionItem[];
  type: "daemonSessionsState";
};

export type SidebarT3ServerInfo = {
  pid: number;
  port: number;
  startedAt?: string;
};

export type SidebarT3SessionItem = {
  activity: "idle" | "working" | "attention";
  detail?: string;
  isCurrentWorkspace: boolean;
  isFocused: boolean;
  isRunning: boolean;
  isSleeping: boolean;
  lastInteractionAt?: string;
  sessionId: string;
  threadId?: string;
  title?: string;
  workspaceId: string;
  workspaceRoot?: string;
};

export type SidebarPromptGitCommitMessage = {
  action: SidebarGitAction;
  branch?: string | null;
  changedFiles?: SidebarGitChangedFile[];
  confirmLabel: string;
  deleteWorktreeAfterDefault?: boolean;
  description: string;
  isWorktree?: boolean;
  isDefaultRef?: boolean;
  mergeAgentId?: string;
  requestId: string;
  showCommitMessage?: boolean;
  suggestedBody?: string;
  suggestedSubject: string;
  type: "promptGitCommit";
  worktreeName?: string;
};

export type SidebarT3BrowserAccessMode = "external" | "local-network" | "local-only" | "tailscale";

export type SidebarShowT3BrowserAccessMessage = {
  endpointUrl: string;
  localUrl: string;
  mode: SidebarT3BrowserAccessMode;
  note: string;
  sessionId: string;
  sessionTitle: string;
  tailscaleEnabled: boolean;
  type: "showT3BrowserAccess";
};

export type SidebarGhostexFolderStat = {
  name: string;
  path: string;
  sizeBytes: number;
};

/**
 * CDXC:SettingsStorage 2026-05-09-15:25
 * Settings exposes ~/.ghostex disk usage only after the user scrolls to the
 * bottom of the modal. The native sidebar sends per-folder byte counts back as
 * a sidebar message so the full-window modal can render stats without owning
 * filesystem access or accepting client-provided paths.
 */
export type SidebarGhostexFolderStatsMessage = {
  errorMessage?: string;
  folderPath: string;
  folders: SidebarGhostexFolderStat[];
  generatedAt: string;
  totalBytes: number;
  type: "ghostexFolderStats";
};

/**
 * CDXC:AppModals 2026-04-28-16:18
 * User-input flows must not use VS Code input boxes, quick picks, or modal
 * editors. Extension-initiated prompts are represented as sidebar messages so
 * the existing React modal host owns rendering and styling.
 */
export type SidebarShowSessionRenameModalMessage = {
  initialTitle: string;
  sessionId: string;
  type: "showSessionRenameModal";
};

export type SidebarShowFindPreviousSessionModalMessage = {
  initialQuery?: string;
  type: "showFindPreviousSessionModal";
};

export type SidebarShowT3ThreadIdModalMessage = {
  currentThreadId: string;
  sessionId: string;
  type: "showT3ThreadIdModal";
};

export type ExtensionToSidebarMessage =
  | SidebarHydrateMessage
  | SidebarSessionStateMessage
  | AgentsHubCatalogMessage
  | SidebarSessionPresentationChangedMessage
  | SidebarPlayCompletionSoundMessage
  | SidebarOrderSyncResultMessage
  | SidebarCommandRunStateChangedMessage
  | SidebarCommandRunStateClearedMessage
  | SidebarDaemonSessionsStateMessage
  | SidebarPromptGitCommitMessage
  | SidebarShowT3BrowserAccessMessage
  | SidebarGhostexFolderStatsMessage
  | SidebarAgentHookStatusMessage
  | SidebarGhostexCliStatusMessage
  | SidebarShowSessionRenameModalMessage
  | SidebarShowFindPreviousSessionModalMessage
  | SidebarShowT3ThreadIdModalMessage;

export type SidebarToExtensionMessage =
  | {
      type: "openSettings";
    }
  | {
      /**
       * CDXC:SidebarDiscord 2026-05-27-05:04:
       * Sidebar surfaces can link to the public Ghostex Discord for support,
       * questions, and contributors. Native owns URL opening so the sidebar
       * does not depend on webview popup behavior.
       */
      type: "openExternalUrl";
      url: string;
    }
  | {
      /**
       * CDXC:SettingsStorage 2026-05-09-15:25
       * The settings modal can request ~/.ghostex folder stats lazily, but native
       * resolves the folder path itself and never trusts a path from React.
       */
      type: "requestGhostexFolderStats" | "openGhostexFolder";
    }
  | {
      /**
       * CDXC:AgentHookSettings 2026-05-23-10:05:
       * Settings -> Agents can refresh hook status and trigger the existing hook installer, but native remains the owner of config paths, executable checks, and hook-file mutation.
       *
       * CDXC:FirstLaunchSetup 2026-05-26-17:12:
       * First launch CLI setup must distinguish a missing CLI from an app that
       * was already installed through Homebrew. Native owns PATH inspection so
       * the production modal and Storybook mock can share the same UI contract.
       */
      type: "requestAgentHookStatus" | "installAgentHooks" | "requestGhostexCliStatus";
    }
  | {
      /**
       * CDXC:IntegrationsSetup 2026-05-27-04:17:
       * First launch and Settings -> Integrations expose one-click install
       * actions for optional integrations. Native runs the actual commands and
       * refreshes the shared integration status afterward.
       */
      type: "installGhostexCli" | "installBrowserControl" | "installCuaDriver";
    }
  | {
      settings: ghostexSettings;
      type: "updateSettings";
    }
  | {
      /**
       * CDXC:GhosttySettings 2026-04-30-01:48
       * The settings modal exposes Ghostty-specific actions that are not plain
       * ghostex preference changes: reset managed config keys, apply the
       * recommended config block, open docs, and open the platform config file.
       *
       * CDXC:AccessibilityPermissions 2026-05-08-13:08
       * The same modal action channel also carries a direct open-settings
       * command for macOS Accessibility status. It does not enable attachment
       * or trigger the permission prompt by itself.
       */
      type:
        | "applyRecommendedGhosttySettings"
        | "openAccessibilityPreferences"
        | "openScreenRecordingPreferences"
        | "requestMacOSNotificationPermission"
        | "openMacOSNotificationSettings"
        | "openGhosttyConfigFile"
        | "openGhosttySettingsDocs"
        | "installGte"
        | "resetGhosttySettingsToDefault";
    }
  | {
      /**
       * CDXC:SessionAttentionNotifications 2026-05-11-01:14
       * Settings' test button should exercise the same native attention
       * completion flow as a real agent task without mutating any session.
       */
      type: "testAgentTaskCompletion";
    }
  | {
      /**
       * CDXC:Settings 2026-05-11-02:06
       * Settings sound dropdown preview buttons play only the selected sound,
       * using the same native audio path as real completion alerts while
       * avoiding notification side effects.
       */
      sound: CompletionSoundSetting;
      type: "playCompletionSoundPreview";
    }
  | {
      type: "toggleCompletionBell";
    }
  | {
      type: "cycleSessionPersistenceProvider";
    }
  | {
      delta: -1 | 1;
      type: "adjustTerminalFontSize";
    }
  | {
      type: "refreshDaemonSessions";
    }
  | {
      type: "killTerminalDaemon";
    }
  | {
      type: "killT3RuntimeServer";
    }
  | {
      type: "killDaemonSession";
      sessionId: string;
      workspaceId: string;
    }
  | {
      type: "killT3RuntimeSession";
      sessionId: string;
    }
  | {
      type: "moveSidebarToOtherSide";
    }
  | {
      /**
       * CDXC:SidebarContextMenu 2026-05-20-13:05:
       * Session and project context menus notify native when open so clicks on
       * terminal, titlebar, and other non-sidebar surfaces dismiss the menu
       * while the original AppKit click still reaches its target.
       */
      type: "sidebarContextMenuOpened";
    }
  | {
      type: "sidebarContextMenuClosed";
    }
  | {
      /**
       * CDXC:CommandPalette 2026-05-16-08:18:
       * The full-window command palette needs a pet wake/sleep action that
       * reuses the sidebar settings owner instead of mutating pet visibility
       * inside the detached modal host.
       */
      type: "togglePetOverlay";
    }
  | {
      type: "createSession";
    }
  | {
      /**
       * CDXC:CommandPalette 2026-05-15-20:38:
       * Palette selections for built-in Ghostex commands should execute through
       * the same native hotkey action dispatcher as physical shortcuts so the
       * available command list cannot drift from actual app behavior.
       */
      actionId: ghostexHotkeyActionId;
      type: "runGhostexHotkeyAction";
    }
  | {
      /**
       * CDXC:PaneTabs 2026-05-11-11:51
       * The combined sidebar Settings row has a legacy-named secondary terminal
       * action. It targets the currently active project and creates the new
       * terminal as the selected tab in the focused session's tab group so pane
       * sizes and tab groupings remain unchanged.
       */
      type: "createFullWidthTerminalPane";
    }
  | {
      /**
       * CDXC:Chats 2026-05-04-09:30
       * Chats are projectless AI work areas. The native sidebar owns chat
       * folder creation and then opens a normal empty terminal there so agent
       * title/icon detection stays identical to project sessions.
       */
      title?: string;
      type: "createChat";
    }
  | {
      /**
       * CDXC:Plugins 2026-05-08-10:44
       * The top-sidebar Plugins entry opens the skills directory as a Chromium
       * browser pane under Chats, not inside the active project. Keep this
       * separate from generic browser actions because its destination is fixed.
       */
      type: "openPluginsBrowserChat";
    }
  | {
      /**
       * CDXC:AgentsHub 2026-05-12-09:21
       * Agents Hub runs in the full-window modal host, but profile/file actions
       * still need native filesystem affordances from the sidebar bridge.
       */
      path: string;
      type: "openAgentsHubPathInFinder";
    }
  | {
      filePath: string;
      type: "openAgentsHubFileInDefaultEditor";
    }
  | {
      /**
       * CDXC:AgentsHub 2026-05-14-08:29:
       * Agents Hub must show the real files installed on the user's machine, including files owned by Claude/Codex profiles and plugin caches.
       * The modal host requests a fresh native filesystem catalog whenever the Hub opens instead of relying on a bundled placeholder list.
       */
      type: "requestAgentsHubCatalog";
    }
  | {
      /**
       * CDXC:AgentsHub 2026-05-14-08:27:
       * The Hub modal edits real agent instruction/config files and enables Save only after text changes.
       * Persist the current editor buffer through the native sidebar command contract so the modal host keeps using the same filesystem bridge as the external-editor action.
       */
      content: string;
      filePath: string;
      type: "saveAgentsHubFile";
    }
  | {
      /**
       * CDXC:Chats 2026-05-08-11:53
       * The reference-style Chats section header has a hover-only browser
       * action beside New Chat. It creates a new projectless chat and opens a
       * browser pane there, without requiring a concrete chat group id.
       */
      type: "openBrowserChat";
    }
  | {
      type: "openBrowser";
    }
  | {
      /**
       * CDXC:ChromiumBrowserPanes 2026-05-27-07:24
       * Browser actions always create in-workspace browser panes now that the
       * legacy Chrome Canary attachment route has been removed.
       */
      url?: string;
      type: "openBrowserPane";
    }
  | {
      /**
       * CDXC:ProjectGroups 2026-05-06-18:42
       * Project headers expose New Browser beside the create-session control.
       * Carry the group id so native can focus that project/group before
       * creating the browser pane.
       */
      groupId: string;
      type: "openBrowserPaneInGroup";
    }
  | {
      type: "openWorkspaceWelcome";
    }
  | {
      /**
       * CDXC:NativeWorkspacePicker 2026-05-08-18:45
       * The reference Projects header add button should open the trusted native
       * folder picker, matching the workspace dock plus button.
       */
      type: "pickWorkspaceFolder";
    }
  | {
      type: "createSessionInGroup";
      groupId: string;
    }
  | {
      type: "focusGroup";
      groupId: string;
    }
  | {
      type: "toggleFullscreenSession";
    }
  | {
      type: "focusSession";
      sessionId: string;
    }
  | {
      /**
       * CDXC:SessionFocusMode 2026-05-23-09:28:
       * Session-card and pane-tab Focus is a reversible zoom for the clicked
       * session's pane tab group. The native/sidebar controller owns this
       * command because it must also switch from Code/Git/Project surfaces back
       * to Agents while remembering the prior surface for unfocus.
       */
      type: "focusSessionMode";
      sessionId: string;
    }
  | {
      type: "promptRenameSession";
      sessionId: string;
    }
  | {
      type: "restartSession";
      sessionId: string;
    }
  | {
      type: "renameSession";
      sessionId: string;
      title: string;
      /**
       * CDXC:SessionNaming 2026-05-09-17:25
       * Generate Title reuses renameSession with the saved 1st user message,
       * but must force controller-side title generation even when that message
       * is shorter than the rename modal's 70-character Generate Name threshold.
       */
      shouldGenerateTitle?: boolean;
    }
  | {
      sessionId: string;
      threadId: string;
      type: "setT3SessionThreadId";
    }
  | {
      type: "renameGroup";
      groupId: string;
      title: string;
    }
  | {
      type: "copyWorkspaceProjectPathForGroup";
      groupId: string;
    }
  | {
      type: "restoreRecentProject";
      projectId: string;
    }
  | {
      /**
       * CDXC:WorkspaceActions 2026-05-04-08:22
       * Combined-mode project cards expose native open actions from the
       * right-click menu. The native sidebar resolves the group id to its
       * trusted stored workspace path instead of accepting a client path.
       */
      type: "openWorkspaceProjectInFinderForGroup" | "openWorkspaceProjectInIdeForGroup";
      groupId: string;
    }
  | {
      /**
       * CDXC:EditorPanes 2026-05-06-14:21
       * Project editor buttons are trusted group-scoped commands. Native
       * resolves the group id to its stored project path before launching the
       * embedded code-server editor or refreshing its diff stats.
       *
       * CDXC:EditorPanes 2026-05-06-18:55
       * The editor card also accepts middle-click close, but the editor is not a
       * session; route close through the same trusted project/group resolver.
       */
      type:
        | "closeWorkspaceProjectEditorForGroup"
        | "openWorkspaceProjectEditorForGroup"
        | "refreshWorkspaceProjectDiffForGroup";
      groupId: string;
    }
  | {
      /**
       * CDXC:SidebarActions 2026-05-05-02:47
       * Sidebar Open In dropdowns know the active project but not a group id.
       * Route these commands through the native sidebar so stored workspace
       * paths remain trusted on the app side instead of being accepted from DOM.
       */
      type: "openActiveWorkspaceProjectInFinder";
    }
  | {
      /**
       * CDXC:SidebarActions 2026-05-05-03:11
       * The sidebar Open In dropdown lists explicit IDE targets. The selected
       * target must travel with the active-project open command instead of
       * being inferred from Settings, so choosing VS Code or Zed immediately
       * opens the project in that exact app.
       */
      targetApp: Extract<WorkspaceIdeTargetApp, "vscode" | "zed">;
      type: "openActiveWorkspaceProjectInIde";
    }
  | {
      /**
       * CDXC:WorkspaceTheme 2026-05-05-05:01
       * Preset theme selection must actively clear a previous Custom color.
       * `themeColor: null` is the sidebar-to-native signal that the custom
       * override is being removed, so icon and project-header tinting cannot
       * keep using stale custom CSS variables after a preset is selected.
       */
      type: "setWorkspaceProjectThemeForGroup";
      groupId: string;
      theme?: SidebarTheme;
      themeColor?: string | null;
    }
  | {
      /**
       * CDXC:RecentProjects 2026-05-04-14:25
       * Combined project context menus close projects into the Recent Projects
       * drawer instead of deleting their stored sessions. Native keeps the
       * legacy remove message for the workspace dock path.
       */
      type: "closeWorkspaceProjectForGroup" | "removeWorkspaceProjectForGroup";
      groupId: string;
    }
  | {
      type: "closeGroup";
      groupId: string;
    }
  | {
      type: "closeSession";
      sessionId: string;
    }
  | {
      type: "setSessionSleeping";
      sessionId: string;
      sleeping: boolean;
    }
  | {
      favorite: boolean;
      type: "setSessionFavorite";
      sessionId: string;
    }
  | {
      type: "setGroupSleeping";
      groupId: string;
      sleeping: boolean;
    }
  | {
      /**
       * CDXC:ProjectSleep 2026-05-27-01:50:
       * Combined project rows do not map to one native workspace group. Their
       * context-menu sleep action must be project-scoped and must only sleep
       * inactive sessions so running, working, and attention sessions stay
       * awake.
       */
      type: "sleepInactiveProjectSessions";
      groupId: string;
    }
  | {
      /**
       * CDXC:ProjectSleep 2026-05-27-02:18:
       * Combined project-row Wake must wake sleeping terminal sessions across
       * every workspace group because the row does not carry a concrete native
       * workspace group id.
       */
      type: "wakeProjectSleepingSessions";
      groupId: string;
    }
  | {
      type: "copyResumeCommand";
      sessionId: string;
    }
  | {
      type: "copyAttachCommand";
      sessionId: string;
    }
  | {
      /**
       * CDXC:DelayedSend 2026-05-11-11:56
       * Delayed Send schedules an Enter keypress for an already-staged terminal
       * command. The sidebar/modal sends only the trusted session id and delay;
       * native resolves the terminal and uses the existing Enter-key path.
       */
      delayMs: number;
      sessionId: string;
      type: "scheduleDelayedSend";
    }
  | {
      /**
       * CDXC:DelayedSend 2026-05-17-03:14
       * Users must be able to cancel a scheduled delayed send from the same
       * modal/sidebar affordance that shows the remaining countdown.
       */
      sessionId: string;
      type: "cancelDelayedSend";
    }
  | {
      type: "forkSession";
      sessionId: string;
    }
  | {
      type: "fullReloadSession";
      sessionId: string;
    }
  | {
      /**
       * CDXC:PanePopOut 2026-05-19-10:15:
       * Browser and agent session cards expose Pop Out Pane in the sidebar
       * context menu. The controller toggles pop-out presentation from the
       * current session record, matching the focused-pane hotkey behavior.
       */
      sessionId: string;
      type: "popOutPane";
    }
  | {
      type: "fullReloadGroup";
      groupId: string;
    }
  | {
      /**
       * CDXC:ProjectReload 2026-05-27-02:18:
       * Combined project rows need a project-scoped full reload because their
       * sidebar group id is synthetic. Reload only idle attached zmx terminals
       * so project-level reload never interrupts working or attention sessions
       * and never tries to restore sleeping/detached history records.
       */
      type: "fullReloadProjectZmxSessions";
      groupId: string;
    }
  | {
      type: "requestT3SessionBrowserAccess";
      sessionId: string;
    }
  | {
      type: "openT3SessionBrowserAccessLink";
      url: string;
    }
  | {
      /**
       * CDXC:BrowserPanes 2026-05-02-06:35
       * Browser session cards expose pane-specific controls copied from the
       * native browser workflow: DevTools, the Settings-selected feedback tool,
       * profile selection, and browser-data import. The native host owns the
       * macOS UI and WebKit/CEF work.
       */
      action: "devtools" | "feedback-tool" | "profile-picker" | "import-settings";
      sessionId: string;
      type: "runBrowserPaneAction";
    }
  | {
      historyId: string;
      type: "restorePreviousSession";
    }
  | {
      historyId: string;
      type: "deletePreviousSession";
    }
  | {
      /**
       * CDXC:PreviousSessions 2026-04-28-05:36
       * Native full-window modals cannot rely on WKWebView JavaScript prompt
       * dialogs. Carry the user's typed search text with the command so the
       * native launcher can create the agent session immediately.
       */
      query?: string;
      type: "promptFindPreviousSession";
    }
  | {
      type: "clearGeneratedPreviousSessions";
    }
  | {
      content: string;
      type: "saveScratchPad";
    }
  | {
      content: string;
      promptId?: string;
      title: string;
      type: "savePinnedPrompt";
    }
  | {
      type: "moveSessionToGroup";
      groupId: string;
      sessionId: string;
      targetIndex?: number;
    }
  | {
      type: "sidebarDebugLog";
      event: string;
      details?: unknown;
    }
  | {
      type: "createGroupFromSession";
      sessionId: string;
    }
  | {
      type: "createGroup";
    }
  | {
      type: "setVisibleCount";
      visibleCount: VisibleSessionCount;
      groupId?: string;
    }
  | {
      type: "setViewMode";
      viewMode: TerminalViewMode;
    }
  | {
      type: "toggleActiveSessionsSortMode";
    }
  | {
      type: "syncSessionOrder";
      groupId: string;
      sessionIds: string[];
    }
  | {
      type: "syncGroupOrder";
      groupIds: string[];
    }
  | {
      type: "runSidebarCommand";
      commandId: string;
      runMode?: SidebarCommandRunMode;
      worktreePath?: string;
    }
  | {
      type: "endSidebarCommandRun";
      commandId: string;
    }
  | {
      action: SidebarGitAction;
      groupId?: string;
      type: "runSidebarGitAction";
    }
  | {
      action: SidebarGitAction;
      type: "setSidebarGitPrimaryAction";
    }
  | {
      type: "refreshGitState";
    }
  | {
      enabled: boolean;
      type: "setSidebarGitCommitConfirmationEnabled";
    }
  | {
      enabled: boolean;
      type: "setSidebarGitGenerateCommitBodyEnabled";
    }
  | {
      commitOnNewRef?: boolean;
      deleteWorktreeAfter?: boolean;
      filePaths?: string[];
      message: string;
      requestId: string;
      type: "confirmSidebarGitCommit";
    }
  | {
      conflictAgentId: string;
      deleteWorktreeAfter?: boolean;
      filePaths?: string[];
      message: string;
      requestId: string;
      type: "confirmSidebarGitDirectMerge";
    }
  | {
      requestId: string;
      type: "runSidebarGitMultipleCommits";
    }
  | {
      filePath: string;
      type: "openSidebarGitChangedFile";
    }
  | {
      filePath: string;
      type: "openSidebarGitChangedFileDiff";
    }
  | {
      requestId: string;
      type: "cancelSidebarGitCommit";
    }
  | {
      type: "saveSidebarCommand";
      actionType: SidebarActionType;
      closeTerminalOnExit: boolean;
      commandId?: string;
      icon?: SidebarCommandIcon;
      iconColor?: string;
      name: string;
      playCompletionSound: boolean;
      command?: string;
      url?: string;
    }
  | {
      type: "deleteSidebarCommand";
      commandId: string;
    }
  | {
      requestId: string;
      type: "syncSidebarCommandOrder";
      commandIds: string[];
    }
  | {
      type: "runSidebarAgent";
      agentId: string;
      groupId?: string;
    }
  | {
      type: "createProjectWorktree";
      agentId: string;
      prompt: string;
      projectId?: string;
    }
  | {
      type: "setProjectWorktreeCommand";
      command: string;
      projectId: string;
    }
  | {
      type: "setProjectBeadsDisplayKey";
      displayKey: string;
      projectId: string;
    }
  | {
      acceptAllMode?: AgentAcceptAllMode;
      type: "saveSidebarAgent";
      agentId?: string;
      command: string;
      icon?: SidebarAgentIcon;
      name: string;
    }
  | {
      type: "deleteSidebarAgent";
      agentId: string;
    }
  | {
      requestId: string;
      type: "syncSidebarAgentOrder";
      agentIds: string[];
    };

export type SidebarHudSnapshot = Pick<
  SessionGridSnapshot,
  | "focusedSessionId"
  | "fullscreenRestoreVisibleCount"
  | "sessions"
  | "visibleCount"
  | "visibleSessionIds"
  | "viewMode"
>;
