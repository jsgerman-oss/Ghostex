export const GRID_COLUMN_COUNT = 3;
export const MAX_GROUP_COUNT = 20;
export const MAX_SESSION_DISPLAY_ID_COUNT = 100;
export const DEFAULT_AGENT_MANAGER_ZOOM_PERCENT = 100;
export const MIN_AGENT_MANAGER_ZOOM_PERCENT = 50;
export const MAX_AGENT_MANAGER_ZOOM_PERCENT = 200;
export const DEFAULT_MAIN_GROUP_ID = "group-1";
export const DEFAULT_MAIN_GROUP_TITLE = "Main";

export type VisibleSessionCount = number;

export type TerminalViewMode = "horizontal" | "vertical" | "grid";

export type SessionGridDirection = "up" | "right" | "down" | "left";

export type SessionPaneSplitDirection = "horizontal" | "vertical";

/**
 * CDXC:NativeSplits 2026-05-10-18:30
 * Workspace panes persist as an explicit split/tab tree instead of deriving
 * native geometry from visibleSessionIds counts. This lets Cmd+D and
 * Cmd+Shift+D add the new terminal beside the targeted pane without the
 * previous four-pane auto-grid reshuffle, and gives tab grouping a durable
 * restart-safe place in the session snapshot.
 */
export type SessionPaneLayoutNode =
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
      children: SessionPaneLayoutNode[];
      direction: SessionPaneSplitDirection;
      kind: "split";
      ratio?: number;
    };

export type SidebarSessionActivityState = "idle" | "working" | "attention";
export type SessionLifecycleState = "running" | "done" | "sleeping" | "error";
/**
 * CDXC:SessionTitleSync 2026-04-27-17:45
 * Session titles keep provenance so restart restore can trust real terminal
 * titles and browser page titles while rejecting placeholders, shell paths,
 * command names, and legacy auto-captured noise such as mojibake.
 *
 * CDXC:BrowserPanes 2026-05-03-01:58
 * Browser pane cards and native title bars use webpage titles supplied by the
 * embedded WKWebView. Track that source separately from terminal OSC/window
 * titles so browser reloads can refresh page identity without looking like a
 * user rename.
 */
export type SessionTitleSource =
  | "browser-auto"
  | "generated"
  | "placeholder"
  | "terminal-auto"
  | "user";

export type SidebarTheme =
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

export type SidebarThemeSetting =
  | "auto"
  | "plain"
  | "dark-green"
  | "dark-blue"
  | "dark-red"
  | "dark-pink"
  | "dark-orange"
  | "light-blue"
  | "light-green"
  | "light-pink"
  | "light-orange";

export type SidebarThemeVariant = "light" | "dark";

export type SessionKind = "browser" | "terminal" | "t3";
export type TerminalSurface = "workspace" | "commands";
export type CommandsPanelMode = "floating" | "pinned";
export type TerminalEngine = "ghostty-native";
export type TerminalSessionPersistenceProvider = "tmux" | "zmx" | "zellij";

export type T3SessionMetadata = {
  boundThreadId?: string;
  projectId: string;
  serverOrigin: string;
  threadId: string;
  workspaceRoot: string;
};

export type BrowserSessionMetadata = {
  faviconDataUrl?: string;
  url: string;
};

export type BaseSessionRecord = {
  kind: SessionKind;
  sessionId: string;
  displayId: string;
  firstUserMessage?: string;
  title: string;
  titleSource?: SessionTitleSource;
  alias: string;
  isFavorite?: boolean;
  /**
   * CDXC:PanePopOut 2026-05-11-09:35
   * Popped-out panes keep their terminal/browser/T3 runtime alive in a native
   * ghostex window while the original workspace slot stays visible as a reattach
   * placeholder. This is presentation state, not sleep state.
   */
  isPoppedOut?: boolean;
  isSleeping?: boolean;
  slotIndex: number;
  row: number;
  column: number;
  createdAt: string;
};

export type TerminalSessionRecord = BaseSessionRecord & {
  agentName?: string;
  /**
   * CDXC:DelayedSend 2026-05-21-12:21:
   * Provider-backed delayed sends must survive app restart with the terminal
   * session that owns the prompt. Persist the absolute deadline on the terminal
   * record so restore can wake the session and re-arm the pending Enter key.
   */
  delayedSendDeadlineAt?: string;
  /**
   * CDXC:SessionLastActive 2026-05-17-02:45:
   * Last Active is durable sidebar metadata for terminal sessions. Persist it
   * on the canonical session record so sleeping or unmounted sessions can keep
   * correct timestamps and Last Active ordering immediately after app restart.
   */
  lastActivityAt?: string;
  /**
   * CDXC:CommandPanes 2026-05-16-15:08:
   * Command-pane reuse is keyed by the configured action title rather than the
   * mutable command id. Persist the title owner on command terminal records so
   * Ghostex can rediscover the correct idle pane after restart or state hydrate.
   */
  commandTitle?: string;
  /**
   * CDXC:PiAgent 2026-05-08-09:42
   * Some agents need a durable conversation identity that is not the sidebar
   * title or terminal-provider session name. Pi restore/fork uses its session
   * jsonl path/id, so store that metadata on the terminal record.
   *
   * CDXC:CodexAgent 2026-05-11-07:35
   * Codex can publish its conversation UUID before a human title exists. Store
   * that UUID here for restore while the display-title layer keeps UUID-looking
   * titles rendered as unnamed `Codex Session` cards.
   */
  agentSessionId?: string;
  agentSessionPath?: string;
  kind: "terminal";
  sessionPersistenceName?: string;
  sessionPersistenceProvider?: TerminalSessionPersistenceProvider;
  surface?: TerminalSurface;
  terminalEngine: TerminalEngine;
  /** @deprecated use sessionPersistenceName for tmux, zmx, and zellij providers. */
  tmuxSessionName?: string;
};

export type T3SessionRecord = BaseSessionRecord & {
  kind: "t3";
  t3: T3SessionMetadata;
};

export type BrowserSessionRecord = BaseSessionRecord & {
  browser: BrowserSessionMetadata;
  kind: "browser";
};

export type SessionRecord = BrowserSessionRecord | TerminalSessionRecord | T3SessionRecord;

export type CreateSessionRecordOptions =
  | {
      browser: BrowserSessionMetadata;
      displayId?: string;
      initialPresentation?: "background" | "focused";
      kind: "browser";
      sessionId?: string;
      title?: string;
      titleSource?: SessionTitleSource;
    }
  | {
      agentName?: string;
      agentSessionId?: string;
      agentSessionPath?: string;
      commandTitle?: string;
      delayedSendDeadlineAt?: string;
      displayId?: string;
      initialPresentation?: "background" | "focused";
      kind?: "terminal";
      sessionId?: string;
      sessionPersistenceName?: string;
      sessionPersistenceProvider?: TerminalSessionPersistenceProvider;
      surface?: TerminalSurface;
      terminalEngine?: TerminalEngine;
      /** @deprecated use sessionPersistenceName for tmux, zmx, and zellij providers. */
      tmuxSessionName?: string;
      title?: string;
      titleSource?: SessionTitleSource;
    }
  | {
      displayId?: string;
      initialPresentation?: "background" | "focused";
      kind: "t3";
      sessionId?: string;
      t3: T3SessionMetadata;
      title?: string;
      titleSource?: SessionTitleSource;
    };

export type SessionGridSnapshot = {
  focusedSessionId?: string;
  fullscreenRestoreVisibleCount?: VisibleSessionCount;
  paneLayout?: SessionPaneLayoutNode;
  sessions: SessionRecord[];
  visibleCount: VisibleSessionCount;
  visibleSessionIds: string[];
  viewMode: TerminalViewMode;
};

export type CommandsPanelState = {
  activeSessionId?: string;
  heightRatio: number;
  isVisible: boolean;
  mode: CommandsPanelMode;
  paneLayout?: SessionPaneLayoutNode;
  sessions: TerminalSessionRecord[];
};

export type SessionGroupRecord = {
  groupId: string;
  snapshot: SessionGridSnapshot;
  title: string;
};

export type GroupedSessionWorkspaceSnapshot = {
  activeGroupId: string;
  groups: SessionGroupRecord[];
  nextGroupNumber: number;
  nextSessionDisplayId: number;
  nextSessionNumber: number;
};
