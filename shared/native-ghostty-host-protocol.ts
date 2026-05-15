export const NATIVE_GHOSTTY_HOST_PROTOCOL_VERSION = 1;

import type { SidebarProjectDiffStats } from "./project-diff-stats";
import type { SidebarCommandButton } from "./sidebar-commands";
import type {
  CustomWorkspaceOpenTarget,
  WorkspaceOpenTargetAvailability,
} from "./workspace-open-targets";

export type NativeTerminalLayout =
  | {
      kind: "leaf";
      sessionId: string;
    }
  | {
      activeSessionId?: string;
      kind: "tabs";
      sessionIds: string[];
    }
  | {
      children: NativeTerminalLayout[];
      direction: "horizontal" | "vertical";
      kind: "split";
      ratio?: number;
    };

export type NativeTerminalTitleBarAction =
  | "close"
  | "closeCommandsPanel"
  | "delayedSend"
  | "expandCommandsPanel"
  | "fork"
  | "newTerminal"
  | "openBrowser"
  | "pinCommandsPanel"
  | "popOut"
  | "reload"
  | "rename"
  | "restorePopOut"
  | "sleep"
  | "splitHorizontal"
  | "splitVertical"
  | "unpinCommandsPanel";

export type NativeGhosttyHostCommand =
  | {
      activateOnCreate?: boolean;
      cwd: string;
      env?: Record<string, string>;
      initialInput?: string;
      sessionId: string;
      sessionPersistenceName?: string;
      sessionPersistenceProvider?: "tmux" | "zmx" | "zellij";
      title?: string;
      tmuxMode?: boolean;
      tmuxSessionName?: string;
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
    | {
      command?: string;
      cwd?: string;
      editorKind?: "terminal" | "monaco";
      env?: Record<string, string>;
      filePath?: string;
      language?: string;
      originatingSessionId?: string;
      requestId?: string;
      statusFile?: string;
      title?: string;
      type: "openFloatingEditor";
    }
  | {
      sessionId: string;
      type: "closeTerminal";
    }
  | {
      sessionId: string;
      type: "closeWebPane";
    }
  | {
      sessionId: string;
      type: "focusTerminal";
    }
  | {
      sessionId: string;
      type: "focusWebPane";
    }
  | {
      cwd: string;
      type: "startT3CodeRuntime";
    }
  | {
      /**
       * CDXC:T3Code 2026-05-10-22:48
       * The sidebar owns T3 card visibility and sleep state. Send the native
       * host the shown, non-sleeping T3 sessions so the managed provider
       * keepalive follows "running in sidebar" instead of workspace pane focus.
       *
       * CDXC:T3Code 2026-05-14-09:34:
       * Include the cwd for an awake T3 card so native can relaunch the
       * background t3code provider when the localhost server disappeared while
       * the sidebar still shows T3 sessions.
       */
      runtimeCwd?: string;
      runningSessionIds: string[];
      type: "setT3CodeRuntimeSessionState";
    }
  | {
      type: "stopT3CodeRuntime";
    }
  | {
      /**
       * CDXC:EditorPanes 2026-05-06-14:21
       * Project editor buttons launch a shared embedded code-server runtime,
       * then native AppKit creates one persistent Chromium editor surface per
       * project. These commands stay separate from terminal/web-pane sessions
       * because editor panes must not participate in split layout.
       *
       * CDXC:EditorPanes 2026-05-06-15:00
       * The runtime command carries the VS Code user-config link setting so the
       * native launcher can pass code-server's CLI flags before the editor
       * process starts instead of mutating the embedded VS Code UI later.
       */
      cwd: string;
      linkVscodeUserConfig?: boolean;
      type: "startCodeServerRuntime";
      vscodeUserConfigDir?: string;
    }
  | {
      type: "stopCodeServerRuntime";
    }
  | {
      projectId: string;
      title: string;
      type: "createProjectEditorPane";
      url: string;
    }
  | {
      projectId: string;
      type: "focusProjectEditorPane";
    }
  | {
      projectId: string;
      type: "closeProjectEditorPane";
    }
  | {
      sessionId: string;
      text: string;
      type: "writeTerminalText";
    }
  | {
      layout: NativeTerminalLayout;
      type: "setTerminalLayout";
    }
  | {
      activeProjectEditorId?: string;
      activeProjectDiffStats?: SidebarProjectDiffStats;
      activeProjectEditorIsOpen?: boolean;
      activeProjectEditorIsSleeping?: boolean;
      activeProjectEditorStatus?: "idle" | "opening" | "running" | "error";
      activeProjectId?: string;
      activeProjectIconDataUrl?: string;
      activeProjectName?: string;
      activeProjectPath?: string;
      activeSessionIds: string[];
      commandsPanelActiveSessionIds?: string[];
      commandsPanelFocusedSessionId?: string;
      commandsPanelHeightRatio?: number;
      commandsPanelIsVisible?: boolean;
      commandsPanelLayout?: NativeTerminalLayout;
      commandsPanelMode?: "floating" | "pinned";
      /**
       * CDXC:NativeWindowChrome 2026-05-10-14:19
       * Native host commands carry the outer app title separately from pane
       * titles so project switches can update macOS chrome without changing
       * individual terminal/browser title bars.
       */
      appTitle?: string;
      attentionSessionIds?: string[];
      backgroundColor?: string;
      focusRequestId?: number;
      focusedSessionId?: string;
      sleepingSessionIds?: string[];
      /**
       * CDXC:NativeGpu 2026-05-08-16:45
       * Sidebar status/title/icon updates must still reach native pane chrome,
       * but they must not be treated as geometry changes. This flag lets the
       * native host skip AppKit surface relayout when only metadata changed.
       */
      layoutChanged?: boolean;
      layout?: NativeTerminalLayout;
      paneGap?: number;
      /**
       * CDXC:PanePopOut 2026-05-11-09:35
       * Layout sync keeps popped-out sessions in the split/tab tree while
       * telling AppKit to render a placeholder in-app and move the live native
       * surface into a ghostex-owned window.
       */
      poppedOutSessionIds?: string[];
      sessionActivities?: Record<string, "attention" | "sleeping" | "working">;
      sessionAgentIconColors?: Record<string, string>;
      sessionAgentIconDataUrls?: Record<string, string>;
      sessionFaviconDataUrls?: Record<string, string>;
      sessionTitleBarActions?: Record<string, NativeTerminalTitleBarAction[]>;
      sessionTitles?: Record<string, string>;
      showProjectEditorDiffFileCount?: boolean;
      sidebarActions?: {
        commands: SidebarCommandButton[];
      };
      type: "setActiveTerminalSet";
      workspaceOpenTargets?: {
        availability: WorkspaceOpenTargetAvailability;
        customTargets: CustomWorkspaceOpenTarget[];
        hiddenTargetIds: string[];
      };
    }
  | {
      sessionId: string;
      type: "setTerminalVisibility";
      visible: boolean;
    }
  | {
      /**
       * CDXC:SessionAttentionNotifications 2026-05-11-01:14
       * Settings must be able to show the native notification permission prompt
       * and open macOS Notification Settings without faking an attention event.
       */
      type: "requestMacOSNotificationPermission" | "openMacOSNotificationSettings";
    }
  | {
      /**
       * CDXC:SessionAttentionNotifications 2026-05-10-16:46
       * The sidebar owns attention transitions and rate limits; the native host
       * only presents the macOS banner and reports a click for exact-session
       * focus routing.
       */
      body?: string;
      iconDataUrl?: string;
      sessionId: string;
      title: string;
      type: "showSessionAttentionNotification";
    };

export type NativeGhosttyHostEvent =
  | {
      foregroundPid?: number;
      sessionId: string;
      sessionPersistenceName?: string;
      tmuxSessionName?: string;
      ttyName?: string;
      type: "terminalReady";
    }
  | {
      sessionId: string;
      sessionPersistenceName?: string;
      title: string;
      tmuxSessionName?: string;
      type: "terminalTitleChanged";
    }
  | {
      faviconDataUrl?: string;
      sessionId: string;
      type: "browserFaviconChanged";
    }
  | {
      sessionId: string;
      type: "browserUrlChanged";
      url: string;
    }
  | {
      cwd: string;
      sessionId: string;
      type: "terminalCwdChanged";
    }
  | {
      exitCode?: number;
      sessionId: string;
      type: "terminalExited";
    }
  | {
      sessionId: string;
      type: "terminalFocused";
    }
  | {
      sessionId: string;
      type: "terminalBell";
    }
  | {
      heightRatio: number;
      type: "commandsPanelHeightRatioChanged";
    }
  | {
      sessionId: string;
      type: "sessionAttentionNotificationClicked";
    }
  | {
      message: string;
      sessionId: string;
      type: "terminalError";
    }
  | {
      placement?: "bottom" | "center" | "left" | "right" | "top";
      sourceSessionId: string;
      targetSessionId: string;
      type: "paneReorderRequested";
    }
  | {
      sessionId: string;
      type: "paneTabSelected";
    }
  | {
      /**
       * CDXC:PaneTabs 2026-05-11-01:43
       * Native tab-bar drags report before/after target placement so the
       * sidebar can reorder the containing paneLayout tab group without
       * interpreting the gesture as a pane split/drop.
       */
      position: "after" | "before";
      sourceSessionId: string;
      targetSessionId: string;
      type: "paneTabReorderRequested";
    }
  | {
      /**
       * CDXC:PaneTabs 2026-05-11-00:45
       * Native tab context menus report a clicked tab plus a scoped close
       * command. The sidebar resolves the tab group from paneLayout so bulk
       * close actions never apply to every visible tab or another group.
       */
      scope: "close" | "closeLeft" | "closeOthers" | "closeRight";
      sessionId: string;
      type: "paneTabCloseRequested";
    }
  | {
      /**
       * CDXC:PaneTabs 2026-05-11-02:16
       * Native tab sleep context-menu actions use tab-group scoped targets and
       * keep sessions restorable through the normal wake path.
       */
      scope: "sleep" | "sleepLeft" | "sleepOthers" | "sleepRight";
      sessionId: string;
      type: "paneTabSleepRequested";
    }
  | {
      /**
       * CDXC:ProjectEditorCompanion 2026-05-14-09:19:
       * The native embedded-editor companion Back button returns to the normal
       * agents workarea and reports that mode change to the sidebar so later
       * layout syncs do not reopen the project editor.
       */
      projectId: string;
      type: "projectEditorBackRequested";
    }
  | {
      /**
       * CDXC:EditorPanes 2026-05-09-17:24
       * Native reports project editor load state separately from terminal
       * sessions so the sidebar can keep the VS Code row visible through
       * startup, success, and error states.
       */
      message?: string;
      projectId: string;
      status: "opening" | "running" | "error";
      type: "projectEditorLoadState";
    }
  | {
      projectId: string;
      serverOrigin: string;
      sessionId: string;
      threadId: string;
      type: "t3ThreadReady";
      workspaceRoot: string;
    }
  | {
      protocolVersion: typeof NATIVE_GHOSTTY_HOST_PROTOCOL_VERSION;
      type: "hostReady";
    };
