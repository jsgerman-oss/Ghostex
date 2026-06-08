import type { GxserverSessionStatusAgentName, GxserverTitleStatusSignal } from "./types.js";

const CLAUDE_CODE_IDLE_MARKERS = ["✳", "*"] as const;
const CLAUDE_CODE_WORKING_MARKERS = ["⠐", "⠂", "·", "✶", "✻", "✽", "✸", "✹", "✺", "✷", "✴"] as const;
const CLAUDE_CODE_TITLE = "Claude Code";
const CLAUDE_TITLE_KEYWORD = "claude";
const CODEX_TITLE_KEYWORD = "codex";
const CODEX_WORKING_MARKERS = ["⠸", "⠴", "⠼", "⠧", "⠦", "⠏", "⠋", "⠇", "⠙", "⠹"] as const;
const CODEX_ACTION_REQUIRED_TITLE_PATTERN = /^\[\s*[!.·⠂]\s*\]\s*Action Required\b/u;
const GEMINI_WORKING_MARKER = "✦";
const GEMINI_IDLE_MARKER = "◇";
const COPILOT_WORKING_MARKER = "🤖";
const COPILOT_IDLE_MARKER = "🔔";
const OPENCODE_TITLE_PREFIX_PATTERN = /^[\s\u2800-\u28ff·•⋅◦✳*✦◇🤖🔔]*OC\s*\|/iu;
const PI_TITLE_PREFIX_PATTERN = /^[\s\u2800-\u28ff·•⋅◦✳*✦◇🤖🔔]*π\s*-/u;
const CURSOR_CLI_WORKING_TITLE_SUFFIX_PATTERN = /⏳ Working [.·]+$/u;
const CURSOR_CLI_READY_TITLE_SUFFIX_PATTERN = /✅ Ready$/u;
const CURSOR_CLI_AGENT_READY_TITLE_PATTERN = /^Cursor Agent\s*-\s*✅ Ready$/iu;
const CURSOR_CLI_AGENT_TITLE_PATTERN = /^Cursor Agent$/iu;
const CURSOR_TITLE_KEYWORD = "cursor";
const ANTIGRAVITY_TITLE_KEYWORD = "agy";
const ANTIGRAVITY_ATTENTION_TITLE_PATTERN = /^🔔\s*agy$/iu;
const ANTIGRAVITY_IDLE_TITLE_PATTERN = /^agy$/iu;
export const GXSERVER_TITLE_ACTIVITY_WINDOW_MS = 1_000;
export const GXSERVER_TITLE_ACTIVITY_HEARTBEAT_MS = 2_000;
export const GXSERVER_SLOW_SPINNER_ACTIVITY_WINDOW_MS = 5_000;

export function classifyTerminalTitleStatus(
  title: string | undefined,
  knownAgentName?: string,
): GxserverTitleStatusSignal | undefined {
  if (!title) {
    return undefined;
  }
  const normalizedAgentName = normalizeStatusAgentName(knownAgentName);
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (OPENCODE_TITLE_PREFIX_PATTERN.test(normalizedTitle)) {
    return undefined;
  }

  const cursorTitleState = getCursorTitleState(title, normalizedAgentName === "cursor");
  if (cursorTitleState) {
    return { agentName: "cursor", state: cursorTitleState };
  }

  const antigravityTitleState = getAntigravityTitleState(title, normalizedAgentName === "antigravity");
  if (antigravityTitleState) {
    return { agentName: "antigravity", state: antigravityTitleState };
  }

  const claudeCodeTitleState = getClaudeCodeTitleState(title, normalizedAgentName === "claude");
  if (claudeCodeTitleState) {
    return { agentName: "claude", state: claudeCodeTitleState };
  }

  const piTitleState = getPiTitleState(title, normalizedAgentName === "pi");
  if (piTitleState) {
    return { agentName: "pi", state: piTitleState };
  }

  const codexTitleState = getCodexTitleState(title, normalizedAgentName === "codex");
  if (codexTitleState) {
    return { agentName: "codex", state: codexTitleState };
  }

  const geminiTitleState = getGeminiTitleState(title, normalizedAgentName === "gemini");
  if (geminiTitleState) {
    return { agentName: "gemini", state: geminiTitleState };
  }

  const copilotTitleState = getCopilotTitleState(title, normalizedAgentName === "copilot");
  if (copilotTitleState) {
    return { agentName: "copilot", state: copilotTitleState };
  }

  return undefined;
}

export function normalizeStatusAgentName(knownAgentName: string | undefined): GxserverSessionStatusAgentName | undefined {
  const normalizedAgentName = knownAgentName?.trim().toLowerCase();
  if (normalizedAgentName === "claude code") {
    return "claude";
  }
  if (normalizedAgentName === "codex cli") {
    return "codex";
  }
  if (normalizedAgentName === "github copilot") {
    return "copilot";
  }
  if (normalizedAgentName === "agy" || normalizedAgentName === "antigravity cli" || normalizedAgentName === "antigravity") {
    return "antigravity";
  }
  if (normalizedAgentName === "cursor cli" || normalizedAgentName === "cursor-agent" || normalizedAgentName === "cursor agent") {
    return "cursor";
  }
  if (normalizedAgentName === "open code") {
    return "opencode";
  }
  if (normalizedAgentName === "π") {
    return "pi";
  }
  return normalizedAgentName === "claude" ||
    normalizedAgentName === "codex" ||
    normalizedAgentName === "cursor" ||
    normalizedAgentName === "gemini" ||
    normalizedAgentName === "copilot" ||
    normalizedAgentName === "opencode" ||
    normalizedAgentName === "pi"
    ? normalizedAgentName
    : undefined;
}

export function requiresObservedTitleTransitions(
  agentName: GxserverSessionStatusAgentName | undefined,
): boolean {
  return agentName === "claude" || agentName === "codex" || agentName === "cursor" || agentName === "pi";
}

export function getTitleActivityWindowMs(agentName: GxserverSessionStatusAgentName | undefined): number {
  return requiresObservedTitleTransitions(agentName)
    ? GXSERVER_SLOW_SPINNER_ACTIVITY_WINDOW_MS
    : GXSERVER_TITLE_ACTIVITY_WINDOW_MS;
}

export function createTitleActivitySignature(
  title: string | undefined,
  signal: GxserverTitleStatusSignal | undefined,
): string | undefined {
  const normalizedTitle = title?.trim().replace(/\s+/g, " ");
  if (!normalizedTitle) {
    return undefined;
  }
  if (signal?.state !== "working" && signal?.state !== "attention") {
    return normalizedTitle;
  }

  let signature = normalizedTitle;
  if (signal.agentName === "codex" || signal.agentName === "pi") {
    for (const marker of CODEX_WORKING_MARKERS) {
      signature = signature.split(marker).join(" ");
    }
    signature = signature.replace(CODEX_ACTION_REQUIRED_TITLE_PATTERN, "Action Required");
  } else if (signal.agentName === "claude") {
    for (const marker of [...CLAUDE_CODE_WORKING_MARKERS, ...CLAUDE_CODE_IDLE_MARKERS]) {
      signature = signature.split(marker).join(" ");
    }
  } else if (signal.agentName === "cursor") {
    signature = signature.replace(CURSOR_CLI_WORKING_TITLE_SUFFIX_PATTERN, "Working");
  }

  /*
  CDXC:SessionStatus 2026-06-06-23:07:
  Title-status sources can arrive from both zmx and native Ghostty. Treat same
  semantic spinner titles as one activity stream so a client that sends raw
  frames faster than zmx's heartbeat cannot rewrite gxserver state or publish
  sidebar deltas for every animation tick.

  CDXC:SessionStatus 2026-06-06-23:26:
  zmx emits same-semantic spinner heartbeats every 2s, while scheduler and IPC
  timing can move those observations around the old 3s stale boundary. Keep the
  slow-spinner freshness window at 5s so active sessions do not flicker into
  attention between sparse heartbeats, while frozen title-derived working still
  expires without user acknowledgement.

  CDXC:SessionStatus 2026-06-06-23:32:
  Use 5s, not 7s, because stale-spinner inference also drives attention
  notifications when a provider stops changing title frames without emitting a
  clear attention title. This keeps a 3s margin over zmx's 2s heartbeat while
  avoiding an unnecessary extra notification delay.
  */
  return signature
    .replace(/\b\d+\s*s\b/giu, "<elapsed>")
    .replace(/[\s\u2800-\u28ff·•⋅◦✳*✦◇🤖🔔]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getCursorTitleState(title: string, allowAgentHintMatch = false): "idle" | "working" | undefined {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (
    CURSOR_CLI_AGENT_READY_TITLE_PATTERN.test(normalizedTitle) ||
    CURSOR_CLI_READY_TITLE_SUFFIX_PATTERN.test(normalizedTitle)
  ) {
    return "idle";
  }
  if (CURSOR_CLI_WORKING_TITLE_SUFFIX_PATTERN.test(normalizedTitle)) {
    return "working";
  }
  if (CURSOR_CLI_AGENT_TITLE_PATTERN.test(normalizedTitle)) {
    return "idle";
  }
  const lowerTitle = normalizedTitle.toLowerCase();
  const hasCursorKeyword =
    lowerTitle.includes("cursor cli") ||
    lowerTitle.includes("cursor-agent") ||
    lowerTitle.includes("cursor agent") ||
    lowerTitle === CURSOR_TITLE_KEYWORD;
  return allowAgentHintMatch && hasCursorKeyword ? "idle" : undefined;
}

function getCodexTitleState(title: string, allowAgentHintMatch = false): "attention" | "idle" | "working" | undefined {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  const hasCodexKeyword = normalizedTitle.toLowerCase().includes(CODEX_TITLE_KEYWORD);
  const hasCodexWorkingMarker = getCodexWorkingMarker(normalizedTitle) !== undefined;
  if (allowAgentHintMatch && CODEX_ACTION_REQUIRED_TITLE_PATTERN.test(normalizedTitle)) {
    return "attention";
  }
  if (!allowAgentHintMatch && !hasCodexKeyword && !hasCodexWorkingMarker) {
    return undefined;
  }
  return hasCodexWorkingMarker ? "working" : "idle";
}

function getClaudeCodeTitleState(title: string, allowAgentHintMatch = false): "idle" | "working" | undefined {
  if (getCursorTitleState(title) !== undefined || getCodexTitleState(title, true) === "attention") {
    return undefined;
  }
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  const lowerTitle = normalizedTitle.toLowerCase();
  const hasClaudeKeyword = lowerTitle.includes(CLAUDE_CODE_TITLE.toLowerCase()) || lowerTitle.includes(CLAUDE_TITLE_KEYWORD);
  const hasClaudeInferenceMarker =
    containsAnyMarker(normalizedTitle, CLAUDE_CODE_IDLE_MARKERS) ||
    containsAnyMarker(normalizedTitle, CLAUDE_CODE_WORKING_MARKERS);
  if (!allowAgentHintMatch && !hasClaudeKeyword && !hasClaudeInferenceMarker) {
    return undefined;
  }
  if (containsAnyMarker(normalizedTitle, CLAUDE_CODE_IDLE_MARKERS)) {
    return "idle";
  }
  if (containsAnyMarker(normalizedTitle, CLAUDE_CODE_WORKING_MARKERS)) {
    return "working";
  }
  return hasClaudeKeyword ? "idle" : undefined;
}

function getPiTitleState(title: string, allowAgentHintMatch = false): "idle" | "working" | undefined {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  const hasPiTitlePrefix = PI_TITLE_PREFIX_PATTERN.test(normalizedTitle);
  if (!allowAgentHintMatch && !hasPiTitlePrefix) {
    return undefined;
  }
  if (getCodexWorkingMarker(normalizedTitle)) {
    return "working";
  }
  return hasPiTitlePrefix || allowAgentHintMatch ? "idle" : undefined;
}

function getGeminiTitleState(title: string, allowAgentHintMatch = false): "idle" | "working" | undefined {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  const lowerTitle = normalizedTitle.toLowerCase();
  if (
    !allowAgentHintMatch &&
    !lowerTitle.includes("gemini") &&
    !normalizedTitle.includes(GEMINI_WORKING_MARKER) &&
    !normalizedTitle.includes(GEMINI_IDLE_MARKER)
  ) {
    return undefined;
  }
  if (normalizedTitle.includes(GEMINI_WORKING_MARKER)) {
    return "working";
  }
  return normalizedTitle.includes(GEMINI_IDLE_MARKER) ? "idle" : undefined;
}

function getAntigravityTitleState(title: string, allowAgentHintMatch = false): "attention" | "idle" | undefined {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (ANTIGRAVITY_ATTENTION_TITLE_PATTERN.test(normalizedTitle)) {
    return "attention";
  }
  if (ANTIGRAVITY_IDLE_TITLE_PATTERN.test(normalizedTitle)) {
    return "idle";
  }
  const lowerTitle = normalizedTitle.toLowerCase();
  return allowAgentHintMatch &&
    (lowerTitle === ANTIGRAVITY_TITLE_KEYWORD || lowerTitle.includes("antigravity cli") || lowerTitle === "antigravity")
    ? "idle"
    : undefined;
}

function getCopilotTitleState(title: string, allowAgentHintMatch = false): "idle" | "working" | undefined {
  if (getAntigravityTitleState(title) !== undefined) {
    return undefined;
  }
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  const lowerTitle = normalizedTitle.toLowerCase();
  if (
    !allowAgentHintMatch &&
    !lowerTitle.includes("copilot") &&
    !lowerTitle.includes("github copilot") &&
    !normalizedTitle.includes(COPILOT_WORKING_MARKER) &&
    !normalizedTitle.includes(COPILOT_IDLE_MARKER)
  ) {
    return undefined;
  }
  if (normalizedTitle.includes(COPILOT_WORKING_MARKER)) {
    return "working";
  }
  return normalizedTitle.includes(COPILOT_IDLE_MARKER) ? "idle" : undefined;
}

function getCodexWorkingMarker(title: string): string | undefined {
  return CODEX_WORKING_MARKERS.find((marker) => title.includes(marker));
}

function containsAnyMarker(title: string, markers: readonly string[]): boolean {
  return markers.some((marker) => title.includes(marker));
}
