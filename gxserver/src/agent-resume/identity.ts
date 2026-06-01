export interface GxserverAgentResumeIdentityInput {
  agentSessionId?: string;
  agentSessionPath?: string;
  storedCommandCandidates?: readonly string[];
}

export type GxserverRestorableAgentId =
  | "amp"
  | "antigravity"
  | "claude"
  | "codebuddy"
  | "codex"
  | "copilot"
  | "cursor"
  | "droid"
  | "gemini"
  | "grok"
  | "hermes-agent"
  | "opencode"
  | "pi"
  | "qoder"
  | "rovodev";

/*
CDXC:AgentResume 2026-06-01-12:59:
Agent restore must be identity-first. If gxserver has a structured agent id, transcript path, or stored resume command containing the provider conversation id, every client should restore with that exact id instead of falling back to mutable sidebar titles.
*/
export function getExactAgentSessionReference(
  agentId: GxserverRestorableAgentId,
  input: GxserverAgentResumeIdentityInput,
): string | undefined {
  if (agentId === "codex") {
    return getCodexSessionReference(input);
  }
  if (agentId === "cursor") {
    return getCursorSessionReference(input);
  }
  if (agentId === "pi") {
    return getPiSessionReference(input);
  }
  return normalizeText(input.agentSessionId);
}

export function getCodexSessionReference(input: GxserverAgentResumeIdentityInput): string | undefined {
  const sessionId = normalizeText(input.agentSessionId);
  return sessionId ? getCodexSessionIdFromTitle(sessionId) ?? sessionId : undefined;
}

export function getClaudeSessionReference(input: GxserverAgentResumeIdentityInput): string | undefined {
  return normalizeText(input.agentSessionId);
}

export function getOpenCodeSessionReference(input: GxserverAgentResumeIdentityInput): string | undefined {
  return normalizeText(input.agentSessionId);
}

export function getPiSessionReference(input: GxserverAgentResumeIdentityInput): string | undefined {
  return normalizeText(input.agentSessionPath) ?? normalizeText(input.agentSessionId);
}

export function getCursorSessionReference(input: GxserverAgentResumeIdentityInput): string | undefined {
  return (
    getCursorChatSessionId(normalizeText(input.agentSessionId)) ??
    getCursorChatSessionId(normalizeText(input.agentSessionPath)) ??
    getCursorChatSessionIdFromStoredCommands(input.storedCommandCandidates)
  );
}

export function appendCursorResumeFlag(command: string, chatId: string): string {
  const normalizedChatId = getCursorChatSessionId(chatId);
  return normalizedChatId ? `${command.trim()} --resume ${quoteShellDoubleArg(normalizedChatId)}`.trim() : command.trim();
}

export function getCursorChatSessionId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  const direct = normalized.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
  if (direct) {
    return normalized.toLowerCase();
  }
  return normalized
    .match(/(?:^|[/\\])agent-transcripts(?:[/\\])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/\\])/iu)?.[1]
    ?.toLowerCase();
}

function getCursorChatSessionIdFromStoredCommands(candidates: readonly string[] | undefined): string | undefined {
  for (const candidate of candidates ?? []) {
    const parsed = getCursorChatSessionIdFromStoredCommand(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function getCursorChatSessionIdFromStoredCommand(command: string): string | undefined {
  const resumeArgPattern = /(?:^|\s)--resume(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/giu;
  let match: RegExpExecArray | null;
  while ((match = resumeArgPattern.exec(command)) !== null) {
    const value = match[1] ?? match[2] ?? match[3];
    const chatId = getCursorChatSessionId(value);
    if (chatId) {
      return chatId;
    }
  }
  return undefined;
}

function getCodexSessionIdFromTitle(value: string): string | undefined {
  return value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu)?.[0]?.toLowerCase();
}

function quoteShellDoubleArg(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
