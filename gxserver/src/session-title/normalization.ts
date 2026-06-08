export const DEFAULT_TERMINAL_SESSION_TITLE = "Terminal Session";

/*
CDXC:AgentResume 2026-06-01-12:59:
The sidebar status marker uses the mathematical asterisk `∗`, not only ASCII `*`. Strip it before title trust checks so display markers cannot make placeholder titles look like real restore lookup titles.
*/
const LEADING_TERMINAL_TITLE_STATUS_MARKER_PATTERN = /^[\s\u2800-\u28ff·•⋅◦✳*∗✶✻✽✸✹✺✷✴✦◇🤖🔔]+/u;
const ANTIGRAVITY_ATTENTION_TITLE_PATTERN = /^🔔\s*agy$/iu;
const ANTIGRAVITY_IDLE_TITLE_PATTERN = /^agy$/iu;
const LEADING_TERMINAL_TITLE_PREFIX_PATTERN = /^(?:OC\s*\|\s*)+/iu;
const CURSOR_CLI_WORKING_TITLE_SUFFIX_PATTERN = /⏳ Working [.·]+$/u;
const CURSOR_CLI_READY_TITLE_SUFFIX_PATTERN = /✅ Ready$/u;
const CURSOR_CLI_AGENT_READY_TITLE_PATTERN = /^Cursor Agent\s*-\s*✅ Ready$/iu;
const CURSOR_CLI_AGENT_TITLE_PATTERN = /^Cursor Agent$/iu;
const CURSOR_CLI_WORKING_TITLE_STRIP_PATTERN = /\s*-\s*⏳ Working [.·]+$/u;
const CURSOR_CLI_READY_TITLE_STRIP_PATTERN = /\s*-\s*✅ Ready$/u;
const ELLIPSIZED_PATH_TITLE_PATTERN = /^(?:…|\.\.\.)[\\/]/u;
const WINDOWS_DEFAULT_POWERSHELL_TITLE_PATTERN =
  /^[a-z]:\\windows\\system32\\windowspowershell\\v1\.0\\powershell\.exe(?:\s+\.)?$/iu;
const AGENT_STATUS_WORD_TITLE_PATTERN =
  /^(?:[\s.:[\](){}!|/\\_-]*)(?:done|error|idle|thinking|working)(?:[\s.:[\](){}!|/\\_-]*)$/iu;
const GHOST_PLACEHOLDER_SESSION_TITLE_PATTERN = /^👻(?:\s+Terminal Session)?$/u;
const CODEX_SESSION_ID_TITLE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const IGNORED_GENERIC_TERMINAL_TITLES = new Set([
  "amp",
  "amp cli",
  "agy",
  "antigravity",
  "antigravity cli",
  "claude",
  "claude code",
  "codex",
  "codex cli",
  "cursor",
  "cursor agent",
  "cursor cli",
  "cursor-agent",
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
  "amp cli session",
  "amp session",
  "antigravity cli session",
  "antigravity session",
  "claude session",
  "claude code session",
  "codebuddy session",
  "code buddy session",
  "codex session",
  "codex cli session",
  "copilot session",
  "cursor agent session",
  "cursor cli session",
  "cursor session",
  "droid session",
  "factory droid session",
  "gemini session",
  "grok session",
  "grok build session",
  "hermes session",
  "hermes agent session",
  "opencode session",
  "open code session",
  "openai codex session",
  "pi session",
  "qoder session",
  "qodercli session",
  "rovo session",
  "rovo dev session",
  "rovodev session",
  "t3 code session",
]);

export function normalizeTerminalTitle(title: string | undefined): string | undefined {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) {
    return undefined;
  }
  const sanitizedTitle = normalizedTitle
    .replace(LEADING_TERMINAL_TITLE_STATUS_MARKER_PATTERN, "")
    .replace(LEADING_TERMINAL_TITLE_PREFIX_PATTERN, "")
    .trim();
  const cursorTitle = normalizeCursorTerminalTitle(sanitizedTitle);
  if (cursorTitle !== null) {
    return cursorTitle;
  }
  const antigravityTitle = normalizeAntigravityTerminalTitle(sanitizedTitle);
  if (antigravityTitle !== null) {
    return antigravityTitle;
  }
  return normalizePiTerminalTitle(sanitizedTitle) ?? (sanitizedTitle || undefined);
}

export function getVisibleTerminalTitle(title: string | undefined): string | undefined {
  const normalizedTitle = normalizeTerminalTitle(title);
  if (!normalizedTitle) {
    return undefined;
  }
  if (
    isPathLikeTerminalTitle(normalizedTitle) ||
    isIgnoredPlaceholderSessionTitle(normalizedTitle) ||
    IGNORED_GENERIC_TERMINAL_TITLES.has(normalizedTitle.trim().toLowerCase()) ||
    AGENT_STATUS_WORD_TITLE_PATTERN.test(normalizedTitle) ||
    WINDOWS_DEFAULT_POWERSHELL_TITLE_PATTERN.test(normalizedTitle)
  ) {
    return undefined;
  }
  return normalizedTitle;
}

export function getVisiblePrimaryTitle(title: string | undefined): string | undefined {
  const normalizedTitle = title?.trim();
  return normalizedTitle && !isIgnoredPlaceholderSessionTitle(normalizedTitle)
    ? normalizedTitle
    : undefined;
}

export function getCodexSessionIdFromTitle(title: string | undefined): string | undefined {
  const normalizedTitle = normalizeTerminalTitle(title);
  return normalizedTitle && CODEX_SESSION_ID_TITLE_PATTERN.test(normalizedTitle)
    ? normalizedTitle.toLowerCase()
    : undefined;
}

export function isGhostPlaceholderSessionTitle(title: string): boolean {
  return GHOST_PLACEHOLDER_SESSION_TITLE_PATTERN.test(title.trim().replace(/\s+/g, " "));
}

export function isTemporarySessionTitle(title: unknown): boolean {
  return typeof title === "string" && title.trim().replace(/\s+/g, " ").toLowerCase() === "search by text";
}

export function isEllipsizedTerminalWindowTitle(title: string): boolean {
  return /\u2026$|\.{3}$/.test(title.trim());
}

export function isPathLikeTerminalTitle(title: string): boolean {
  return /^(~|\/)/u.test(title) || ELLIPSIZED_PATH_TITLE_PATTERN.test(title);
}

export function isIgnoredGenericAgentTerminalTitle(title: string): boolean {
  return IGNORED_GENERIC_TERMINAL_TITLES.has(title.trim().replace(/\s+/g, " ").toLowerCase());
}

function isIgnoredPlaceholderSessionTitle(title: string): boolean {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  return (
    /^Session \d+$/iu.test(normalizedTitle) ||
    getCodexSessionIdFromTitle(normalizedTitle) !== undefined ||
    isGhostPlaceholderSessionTitle(normalizedTitle) ||
    AGENT_STATUS_WORD_TITLE_PATTERN.test(normalizedTitle) ||
    IGNORED_PLACEHOLDER_SESSION_TITLES.has(normalizedTitle.toLowerCase()) ||
    isPathLikeTerminalTitle(normalizedTitle)
  );
}

function normalizeAntigravityTerminalTitle(title: string): string | undefined | null {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (ANTIGRAVITY_ATTENTION_TITLE_PATTERN.test(normalizedTitle) || ANTIGRAVITY_IDLE_TITLE_PATTERN.test(normalizedTitle)) {
    return "agy";
  }
  return null;
}

function normalizeCursorTerminalTitle(title: string): string | undefined | null {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (isCursorCliPlaceholderTerminalTitle(normalizedTitle)) {
    return undefined;
  }
  if (CURSOR_CLI_READY_TITLE_SUFFIX_PATTERN.test(normalizedTitle)) {
    const strippedTitle = normalizedTitle.replace(CURSOR_CLI_READY_TITLE_STRIP_PATTERN, "").trim();
    return isCursorCliPlaceholderTerminalTitle(strippedTitle) ? undefined : strippedTitle || undefined;
  }
  if (CURSOR_CLI_WORKING_TITLE_SUFFIX_PATTERN.test(normalizedTitle)) {
    const strippedTitle = normalizedTitle.replace(CURSOR_CLI_WORKING_TITLE_STRIP_PATTERN, "").trim();
    return isCursorCliPlaceholderTerminalTitle(strippedTitle) ? undefined : strippedTitle || undefined;
  }
  return null;
}

function isCursorCliPlaceholderTerminalTitle(title: string): boolean {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  return (
    CURSOR_CLI_AGENT_READY_TITLE_PATTERN.test(normalizedTitle) ||
    CURSOR_CLI_AGENT_TITLE_PATTERN.test(normalizedTitle) ||
    ["cursor", "cursor agent", "cursor cli", "cursor-agent"].includes(normalizedTitle.toLowerCase())
  );
}

function normalizePiTerminalTitle(title: string): string | undefined {
  const match = /^π\s*-\s*(.+)$/u.exec(title.trim());
  if (!match) {
    return undefined;
  }
  const parts = match[1].split(/\s+-\s+/u).map((part) => part.trim()).filter(Boolean);
  return parts.length < 2 ? "π" : parts.slice(0, -1).join(" - ") || "π";
}
