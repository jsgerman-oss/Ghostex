import {
  DEFAULT_AGENT_MANAGER_ZOOM_PERCENT,
  DEFAULT_MAIN_GROUP_ID,
  DEFAULT_MAIN_GROUP_TITLE,
  GRID_COLUMN_COUNT,
  MAX_AGENT_MANAGER_ZOOM_PERCENT,
  MAX_SESSION_DISPLAY_ID_COUNT,
  MIN_AGENT_MANAGER_ZOOM_PERCENT,
  type BaseSessionRecord,
  type CreateSessionRecordOptions,
  type GroupedSessionWorkspaceSnapshot,
  type SessionGridSnapshot,
  type SessionRecord,
  type SessionTitleSource,
  type SidebarTheme,
  type SidebarThemeSetting,
  type SidebarThemeVariant,
  type TerminalEngine,
  type TerminalSurface,
  type TerminalSessionPersistenceProvider,
  type TerminalSessionRecord,
  type T3SessionRecord,
  type BrowserSessionRecord,
  type TerminalViewMode,
  type VisibleSessionCount,
} from "./session-grid-contract-core";
import { normalizeT3SessionMetadata } from "./t3-session-metadata";

/**
 * CDXC:Claude-session-status 2026-04-25-08:29
 * Visible session titles should remove agent status glyphs, including Claude
 * Code's animated star markers, while the activity parser uses them for
 * working/done indicators.
 * CDXC:Terminology 2026-05-09-15:53
 * Use working for agent work status. Reserve running for live runtime state.
 */
const LEADING_TERMINAL_TITLE_STATUS_MARKER_PATTERN = /^[\s\u2800-\u28ff·•⋅◦✳*✶✻✽✸✹✺✷✴✦◇🤖🔔]+/u;
const LEADING_TERMINAL_TITLE_PREFIX_PATTERN = /^(?:OC\s*\|\s*)+/iu;
export const DEFAULT_TERMINAL_SESSION_TITLE = "Terminal Session";
/**
 * CDXC:CommandsPanel 2026-05-14-08:12:
 * The bottom command pane must open at 27% of the workspace height by default so the main terminal area keeps more vertical room while command sessions remain visible.
 */
export const DEFAULT_COMMANDS_PANEL_HEIGHT_RATIO = 0.27;
const DEFAULT_TERMINAL_ENGINE: TerminalEngine = "ghostty-native";
const IGNORED_GENERIC_TERMINAL_TITLES = new Set([
  "claude",
  "claude code",
  "codex",
  "codex cli",
  "droid",
  "factory droid",
  "grok",
  "grok build",
  "openai codex",
  "pi",
  "π",
  "ghostex",
]);
const IGNORED_PLACEHOLDER_SESSION_TITLES = new Set([
  DEFAULT_TERMINAL_SESSION_TITLE.toLowerCase(),
  "claude session",
  "claude code session",
  "codex session",
  "codex cli session",
  "copilot session",
  "droid session",
  "factory droid session",
  "gemini session",
  "grok session",
  "grok build session",
  "opencode session",
  "open code session",
  "openai codex session",
  "pi session",
  "t3 code session",
]);
const DEFAULT_SESSION_AGENT_TITLE_NAMES = new Map<string, string>([
  ["claude", "Claude"],
  ["claude-code", "Claude"],
  ["codex", "Codex"],
  ["codex-cli", "Codex"],
  ["copilot", "Copilot"],
  ["droid", "Factory Droid"],
  ["factory-droid", "Factory Droid"],
  ["gemini", "Gemini"],
  ["grok", "Grok Build"],
  ["grok-build", "Grok Build"],
  ["opencode", "OpenCode"],
  ["open-code", "OpenCode"],
  ["pi", "Pi"],
  ["π", "Pi"],
  ["t3", "T3 Code"],
]);
const ELLIPSIZED_PATH_TITLE_PATTERN = /^(?:…|\.\.\.)[\\/]/u;
const WINDOWS_DEFAULT_POWERSHELL_TITLE_PATTERN =
  /^[a-z]:\\windows\\system32\\windowspowershell\\v1\.0\\powershell\.exe(?:\s+\.)?$/iu;
const AGENT_STATUS_WORD_TITLE_PATTERN =
  /^(?:[\s.:[\](){}!|/\\_-]*)(?:done|error|idle|thinking|working)(?:[\s.:[\](){}!|/\\_-]*)$/iu;
const GHOST_PLACEHOLDER_SESSION_TITLE_PATTERN = /^👻(?:\s+Terminal Session)?$/u;
const CODEX_SESSION_ID_TITLE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function clampVisibleSessionCount(value: number): VisibleSessionCount {
  /**
   * CDXC:NativeSplits 2026-05-11-17:14
   * Workspace visibility no longer has a fixed pane cap. Clamp only to a
   * positive integer so tab groups and native pane layouts can keep every
   * session the user opens.
   */
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.round(value));
}

export function clampTerminalViewMode(value: string | undefined): TerminalViewMode {
  switch (value) {
    case "horizontal":
    case "vertical":
    case "grid":
      return value;
    default:
      return "grid";
  }
}

export function clampAgentManagerZoomPercent(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AGENT_MANAGER_ZOOM_PERCENT;
  }

  return Math.min(
    MAX_AGENT_MANAGER_ZOOM_PERCENT,
    Math.max(MIN_AGENT_MANAGER_ZOOM_PERCENT, Math.round(value)),
  );
}

export function clampSidebarThemeSetting(value: string | undefined): SidebarThemeSetting {
  switch (value) {
    case "auto":
      /**
       * CDXC:SidebarTheme 2026-05-08-11:14
       * Auto is no longer an active sidebar theme. Normalize legacy saved Auto
       * settings to Dark Gray instead of preserving a hidden system-dependent
       * mode after the picker has been removed from Settings.
       */
      return "plain";
    case "plain":
    case "dark-modern":
    case "dark-green":
      return value === "dark-modern" ? "dark-green" : value;
    case "dark-plus":
    case "dark-blue":
      return value === "dark-plus" ? "dark-blue" : value;
    case "dark-red":
    case "dark-pink":
    case "dark-orange":
    case "light-plus":
    case "light-blue":
    case "light-green":
    case "light-pink":
    case "light-orange":
      return value === "light-plus" ? "light-blue" : value;
    case "monokai":
      return "dark-green";
    case "solarized-dark":
      return "dark-blue";
    default:
      return "plain";
  }
}

export function resolveSidebarTheme(
  themeSetting: SidebarThemeSetting,
  variant: SidebarThemeVariant,
): SidebarTheme {
  if (themeSetting === "auto") {
    return variant === "light" ? "light-blue" : "dark-blue";
  }

  if (themeSetting === "plain") {
    /**
     * CDXC:SidebarTheme 2026-04-26-21:32: The stored "plain" setting is the
     * user-facing Dark Gray theme. It must always resolve to the dark gray
     * palette instead of following the current light/dark variant, otherwise
     * the sidebar can show a blue/light-looking chrome while the picker says
     * Dark Gray.
     */
    return "plain-dark";
  }

  return themeSetting;
}

export function createDefaultSessionGridSnapshot(): SessionGridSnapshot {
  return {
    focusedSessionId: undefined,
    fullscreenRestoreVisibleCount: undefined,
    sessions: [],
    visibleCount: 1,
    visibleSessionIds: [],
    viewMode: "grid",
  };
}

export function createDefaultCommandsPanelState() {
  return {
    activeSessionId: undefined,
    heightRatio: DEFAULT_COMMANDS_PANEL_HEIGHT_RATIO,
    isVisible: false,
    mode: "pinned" as const,
    paneLayout: undefined,
    sessions: [],
  };
}

export function isSessionGridFocusModeActive(
  snapshot: Pick<SessionGridSnapshot, "fullscreenRestoreVisibleCount" | "visibleCount">,
): boolean {
  return snapshot.visibleCount === 1 && snapshot.fullscreenRestoreVisibleCount !== undefined;
}

export function getSessionGridLayoutVisibleCount(
  snapshot: Pick<SessionGridSnapshot, "fullscreenRestoreVisibleCount" | "visibleCount">,
): VisibleSessionCount {
  return snapshot.fullscreenRestoreVisibleCount ?? snapshot.visibleCount;
}

export function createDefaultGroupedSessionWorkspaceSnapshot(): GroupedSessionWorkspaceSnapshot {
  return {
    activeGroupId: DEFAULT_MAIN_GROUP_ID,
    groups: [
      {
        groupId: DEFAULT_MAIN_GROUP_ID,
        snapshot: createDefaultSessionGridSnapshot(),
        title: DEFAULT_MAIN_GROUP_TITLE,
      },
    ],
    nextGroupNumber: 2,
    nextSessionDisplayId: 0,
    nextSessionNumber: 1,
  };
}

/**
 * CDXC:Session-identity 2026-04-26-20:54
 * New workspace sessions use one opaque, timestamped ID for sessionId,
 * displayId, and the generated alias so daemon state, socket routing, and
 * sidebar labels do not reuse numeric identities from closed sessions. The
 * ID embeds local YYMMDD-HHmmss creation time plus a 3-character base36 suffix.
 */
export function createTimestampedSessionId(
  usedSessionIds: Iterable<string>,
  now = new Date(),
  random = Math.random,
): string {
  const usedSessionIdSet = new Set(usedSessionIds);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = Math.floor(random() * 36 ** 3)
      .toString(36)
      .padStart(3, "0")
      .slice(-3);
    const sessionId = `s-${formatSessionIdTimestamp(now)}-${suffix}`;
    if (!usedSessionIdSet.has(sessionId)) {
      return sessionId;
    }
  }

  for (let index = 0; index < 36 ** 3; index += 1) {
    const suffix = index.toString(36).padStart(3, "0");
    const sessionId = `s-${formatSessionIdTimestamp(now)}-${suffix}`;
    if (!usedSessionIdSet.has(sessionId)) {
      return sessionId;
    }
  }

  throw new Error("Unable to allocate a unique ghostex session ID for this timestamp.");
}

export function formatSessionDisplayId(displayId: number | string): string {
  if (typeof displayId === "string") {
    const trimmedDisplayId = displayId.trim();
    if (/^s-[a-z0-9-]+$/i.test(trimmedDisplayId)) {
      return trimmedDisplayId;
    }

    if (/^\d{2}$/.test(trimmedDisplayId)) {
      return trimmedDisplayId;
    }

    const parsedDisplayId = Number.parseInt(trimmedDisplayId, 10);
    if (Number.isInteger(parsedDisplayId)) {
      return formatSessionDisplayId(parsedDisplayId);
    }
  }

  if (!Number.isFinite(Number(displayId))) {
    return "00";
  }

  const normalizedDisplayId =
    ((Math.floor(Number(displayId)) % MAX_SESSION_DISPLAY_ID_COUNT) +
      MAX_SESSION_DISPLAY_ID_COUNT) %
    MAX_SESSION_DISPLAY_ID_COUNT;
  return String(normalizedDisplayId).padStart(2, "0");
}

export function getSlotPosition(slotIndex: number): Pick<SessionRecord, "column" | "row"> {
  const normalizedSlotIndex = Math.max(0, Math.floor(slotIndex));
  return {
    column: normalizedSlotIndex % GRID_COLUMN_COUNT,
    row: Math.floor(normalizedSlotIndex / GRID_COLUMN_COUNT),
  };
}

export function getSlotLabel(row: number, column: number): string {
  return `R${row + 1}C${column + 1}`;
}

export function getSessionShortcutLabel(slotIndex: number, platform: "default" | "mac"): string {
  const shortcutNumber = Math.max(1, Math.floor(slotIndex) + 1);
  return platform === "mac" ? `⌘⌥${shortcutNumber}` : `⌃⌥${shortcutNumber}`;
}

export function createSessionAlias(
  sessionNumber: number,
  slotIndex: number,
  displayId?: string | number,
): string {
  void slotIndex;
  return formatSessionDisplayId(displayId ?? sessionNumber - 1);
}

/**
 * CDXC:Session-title-defaults 2026-04-27-03:58
 * Newly created sessions should not expose their routing/session id as the
 * primary title. Creation source owns the default title until the live terminal
 * emits a meaningful title or the user explicitly renames the session.
 */
export function createAgentSessionDefaultTitle(agentName: string | undefined): string {
  const normalizedAgentName = agentName?.replace(/\s+/g, " ").trim();
  const defaultAgentTitleName = normalizedAgentName
    ? (DEFAULT_SESSION_AGENT_TITLE_NAMES.get(normalizedAgentName.toLowerCase()) ??
      normalizedAgentName)
    : undefined;
  return defaultAgentTitleName
    ? `${defaultAgentTitleName} Session`
    : DEFAULT_TERMINAL_SESSION_TITLE;
}

export function isNumericSessionAlias(alias: string | undefined): boolean {
  return /^\d+$/.test(alias?.trim() ?? "");
}

export function isGeneratedSessionAlias(
  session: Pick<BaseSessionRecord, "alias" | "displayId" | "sessionId" | "slotIndex">,
): boolean {
  return (
    session.alias.trim() ===
    createSessionAlias(getSessionNumber(session), session.slotIndex, session.displayId)
  );
}

export function createSessionRecord(
  sessionNumber: number,
  slotIndex: number,
  options?: CreateSessionRecordOptions,
): SessionRecord {
  const position = getSlotPosition(slotIndex);
  const terminalAgentName =
    options?.kind === "terminal" || options?.kind === undefined ? options?.agentName : undefined;
  const sessionId = options?.sessionId?.trim() || `session-${sessionNumber}`;
  const displayId = formatSessionDisplayId(
    options?.displayId ?? (isTimestampedSessionId(sessionId) ? sessionId : sessionNumber - 1),
  );
  const alias = createSessionAlias(sessionNumber, slotIndex, displayId);
  const createdAt = new Date().toISOString();
  const title = options?.title?.trim() || DEFAULT_TERMINAL_SESSION_TITLE;
  const titleSource = normalizeSessionTitleSource(options?.titleSource, title);

  if (options?.kind === "browser") {
    return {
      alias,
      browser: options.browser,
      column: position.column,
      createdAt,
      displayId,
      kind: "browser",
      row: position.row,
      sessionId,
      slotIndex,
      title,
      titleSource,
    };
  }

  if (options?.kind === "t3") {
    return {
      alias,
      column: position.column,
      createdAt,
      displayId,
      kind: "t3",
      row: position.row,
      sessionId,
      slotIndex,
      t3: normalizeT3SessionMetadata(options.t3),
      title,
      titleSource,
    };
  }

  return {
    alias,
    agentName: normalizeTerminalSessionAgentName(terminalAgentName),
    agentSessionId: normalizeTerminalAgentSessionIdentity(options?.agentSessionId),
    agentSessionPath: normalizeTerminalAgentSessionIdentity(options?.agentSessionPath),
    column: position.column,
    createdAt,
    displayId,
    kind: "terminal",
    row: position.row,
    sessionId,
    slotIndex,
    terminalEngine: normalizeTerminalEngine(options?.terminalEngine),
    sessionPersistenceName: normalizeTerminalSessionPersistenceName(
      options?.sessionPersistenceName ?? options?.tmuxSessionName,
    ),
    sessionPersistenceProvider: normalizeTerminalSessionPersistenceProvider(
      options?.sessionPersistenceProvider,
    ),
    surface: normalizeTerminalSurface(options?.surface),
    title,
    titleSource,
  };
}

function normalizeSessionTitleSource(
  source: SessionTitleSource | undefined,
  title: string,
): SessionTitleSource {
  if (
    source === "browser-auto" ||
    source === "generated" ||
    source === "placeholder" ||
    source === "terminal-auto" ||
    source === "user"
  ) {
    return source;
  }
  return getVisiblePrimaryTitle(title) ? "user" : "placeholder";
}

export function normalizeTerminalSessionAgentName(value: string | undefined): string | undefined {
  const normalizedValue = value?.replace(/\s+/g, " ").trim();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizeTerminalAgentSessionIdentity(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

function normalizeTerminalSessionPersistenceName(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

export function normalizeTerminalSessionPersistenceProvider(
  provider: TerminalSessionPersistenceProvider | undefined,
): TerminalSessionPersistenceProvider | undefined {
  /**
   * CDXC:SessionPersistence 2026-05-07-20:32
   * Provider-backed terminal records persist the provider with the provider
   * session name. Restore, wake, reload, and sidebar badges must not reinterpret
   * a stored tmux/zmx/zellij name through the current global Settings provider.
   */
  return provider === "tmux" || provider === "zmx" || provider === "zellij"
    ? provider
    : undefined;
}

export function normalizeTerminalEngine(value: string | undefined): TerminalEngine {
  return DEFAULT_TERMINAL_ENGINE;
}

export function normalizeTerminalSurface(value: TerminalSurface | undefined): TerminalSurface {
  return value === "commands" ? "commands" : "workspace";
}

export function isPersistentTerminalEngine(value: TerminalEngine): boolean {
  return value === "ghostty-native";
}

export function isXtermTerminalEngine(value: TerminalEngine): boolean {
  return false;
}

export function getTerminalSessionSurfaceTitle(
  session: Pick<BaseSessionRecord, "alias" | "displayId" | "sessionId" | "slotIndex" | "title">,
): string {
  return formatSessionSurfaceTitle(session);
}

export function getT3SessionSurfaceTitle(
  session: Pick<BaseSessionRecord, "alias" | "displayId" | "sessionId" | "slotIndex" | "title">,
): string {
  return formatSessionSurfaceTitle(session);
}

export function getSessionNumberFromSessionId(sessionId: string): number | undefined {
  const match = /^session-(\d+)$/.exec(sessionId);
  if (!match) {
    return undefined;
  }

  const parsedNumber = Number.parseInt(match[1], 10);
  return Number.isInteger(parsedNumber) && parsedNumber > 0 ? parsedNumber : undefined;
}

export function getVisibleSessionNumber(
  session: Pick<BaseSessionRecord, "displayId" | "sessionId" | "slotIndex">,
): string {
  return formatSessionDisplayId(session.displayId ?? getSessionNumber(session) - 1);
}

export function getVisiblePrimaryTitle(title: string): string | undefined {
  const normalizedTitle = title.trim();
  if (!normalizedTitle || isIgnoredPlaceholderSessionTitle(normalizedTitle)) {
    return undefined;
  }

  return normalizedTitle;
}

export function getSessionCardPrimaryTitle(
  session: Pick<BaseSessionRecord, "title"> & { agentName?: string },
): string | undefined {
  const normalizedTitle = session.title.trim().replace(/\s+/g, " ");
  /**
   * CDXC:Session-title-defaults 2026-04-27-08:31
   * Session cards still need a human placeholder while resume/persistence code
   * treats placeholders and Ghostty cwd titles as not persisted. Show the
   * neutral or agent-aware placeholder with the card's unsynced marker instead
   * of falling through to opaque ids such as `s-260427-090032-rma`.
   */
  if (
    !normalizedTitle ||
    /^Session \d+$/iu.test(normalizedTitle) ||
    getCodexSessionIdFromTitle(normalizedTitle) !== undefined ||
    isGhostPlaceholderSessionTitle(normalizedTitle) ||
    isPathLikeTerminalTitle(normalizedTitle)
  ) {
    return createAgentSessionDefaultTitle(session.agentName);
  }

  return normalizedTitle;
}

/**
 * CDXC:SessionTitleSync 2026-05-07-17:27
 * zmx reconnect can emit the Ghostty placeholder title as `👻` before the pane
 * reports a persisted session title. Treat the ghost forms as placeholders in
 * the shared title contract so they cannot outrank known stored names, render
 * as real card titles, or be persisted by terminal-title sync.
 */
export function isGhostPlaceholderSessionTitle(title: string): boolean {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  return GHOST_PLACEHOLDER_SESSION_TITLE_PATTERN.test(normalizedTitle);
}

export function normalizeTerminalTitle(title: string | undefined): string | undefined {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) {
    return undefined;
  }

  const sanitizedTitle = normalizedTitle
    .replace(LEADING_TERMINAL_TITLE_STATUS_MARKER_PATTERN, "")
    .replace(LEADING_TERMINAL_TITLE_PREFIX_PATTERN, "")
    .trim();
  return normalizePiTerminalTitle(sanitizedTitle) ?? (sanitizedTitle || undefined);
}

function normalizePiTerminalTitle(title: string): string | undefined {
  const match = /^π\s*-\s*(.+)$/u.exec(title.trim());
  if (!match) {
    return undefined;
  }

  const parts = match[1]
    .split(/\s+-\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  /**
   * CDXC:PiAgent 2026-05-08-09:42
   * Pi emits `π - <cwd>` before a session is named and
   * `π - <session name> - <cwd>` afterward. Keep unnamed Pi titles generic
   * while surfacing the named session portion as the sidebar title, matching
   * Codex's generated-title behavior without persisting the cwd as a name.
   */
  if (parts.length < 2) {
    return "π";
  }

  return parts.slice(0, -1).join(" - ") || "π";
}

/**
 * CDXC:CodexAgent 2026-05-11-07:35
 * Recent Codex CLI builds can publish the underlying conversation UUID as the
 * terminal title before a human title exists. Store that UUID as agent session
 * identity, but keep it out of visible titles so unnamed Codex cards continue
 * to render as `* Codex Session`.
 */
export function getCodexSessionIdFromTitle(title: string | undefined): string | undefined {
  const normalizedTitle = normalizeTerminalTitle(title);
  if (!normalizedTitle || !CODEX_SESSION_ID_TITLE_PATTERN.test(normalizedTitle)) {
    return undefined;
  }
  return normalizedTitle.toLowerCase();
}

export function getVisibleTerminalTitle(title: string | undefined): string | undefined {
  const normalizedTitle = normalizeTerminalTitle(title);
  if (!normalizedTitle) {
    return undefined;
  }

  if (isPathLikeTerminalTitle(normalizedTitle)) {
    return undefined;
  }

  if (isIgnoredPlaceholderSessionTitle(normalizedTitle)) {
    return undefined;
  }

  if (IGNORED_GENERIC_TERMINAL_TITLES.has(normalizedTitle.trim().toLowerCase())) {
    return undefined;
  }

  if (AGENT_STATUS_WORD_TITLE_PATTERN.test(normalizedTitle)) {
    return undefined;
  }

  if (WINDOWS_DEFAULT_POWERSHELL_TITLE_PATTERN.test(normalizedTitle)) {
    return undefined;
  }

  return normalizedTitle;
}

function isIgnoredPlaceholderSessionTitle(title: string): boolean {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  /**
   * CDXC:Session-title-defaults 2026-04-27-08:20
   * Neutral titles such as `Terminal Session` and agent-aware creation titles
   * such as `Codex Session` are placeholders from session creation. Path-like
   * Ghostty titles such as `…/dev/_active/agent-tiler` are also shell context,
   * not user-persisted names, so none of them should drive resume titles.
   */
  return (
    /^Session \d+$/iu.test(normalizedTitle) ||
    getCodexSessionIdFromTitle(normalizedTitle) !== undefined ||
    isGhostPlaceholderSessionTitle(normalizedTitle) ||
    AGENT_STATUS_WORD_TITLE_PATTERN.test(normalizedTitle) ||
    IGNORED_PLACEHOLDER_SESSION_TITLES.has(normalizedTitle.toLowerCase()) ||
    isPathLikeTerminalTitle(normalizedTitle)
  );
}

function isPathLikeTerminalTitle(title: string): boolean {
  return /^(~|\/)/u.test(title) || ELLIPSIZED_PATH_TITLE_PATTERN.test(title);
}

export function getPreferredSessionTitle(
  sessionTitle: string | undefined,
  terminalTitle: string | undefined,
): string | undefined {
  const visibleTerminalTitle = getVisibleTerminalTitle(terminalTitle);
  if (visibleTerminalTitle) {
    return visibleTerminalTitle;
  }

  return sessionTitle ? getVisiblePrimaryTitle(sessionTitle) : undefined;
}

export function getOrderedSessions(snapshot: SessionGridSnapshot): SessionRecord[] {
  return [...snapshot.sessions].sort((left, right) => left.slotIndex - right.slotIndex);
}

export function isTerminalSession(session: SessionRecord): session is TerminalSessionRecord {
  return session.kind === "terminal";
}

export function isBrowserSession(session: SessionRecord): session is BrowserSessionRecord {
  return session.kind === "browser";
}

export function isT3Session(session: SessionRecord): session is T3SessionRecord {
  return session.kind === "t3";
}

function getSessionNumber(session: Pick<BaseSessionRecord, "sessionId" | "slotIndex">): number {
  return getSessionNumberFromSessionId(session.sessionId) ?? session.slotIndex + 1;
}

function formatSessionSurfaceTitle(
  session: Pick<BaseSessionRecord, "alias" | "displayId" | "sessionId" | "slotIndex" | "title">,
): string {
  const displayId = formatSessionDisplayId(session.displayId ?? getSessionNumber(session) - 1);
  const visiblePrimaryTitle = getVisiblePrimaryTitle(session.title);
  if (visiblePrimaryTitle) {
    return `${displayId}. ${visiblePrimaryTitle}`;
  }

  return isGeneratedSessionAlias(session) ? displayId : `${displayId} ${session.alias}`;
}

function formatSessionIdTimestamp(value: Date): string {
  const year = String(value.getFullYear() % 100).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function isTimestampedSessionId(sessionId: string): boolean {
  return /^s-\d{6}-\d{6}-[a-z0-9]{3}$/i.test(sessionId);
}
