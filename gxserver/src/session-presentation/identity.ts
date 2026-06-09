export interface GxserverResolvedSessionIdentity {
  agentId?: string;
  agentSessionId?: string;
  agentSessionPath?: string;
}

const CODEX_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function resolveSessionIdentity(input: {
  agentId?: unknown;
  agentName?: unknown;
  agentSessionId?: unknown;
  agentSessionPath?: unknown;
  runtimeSettings?: Record<string, unknown>;
  startupText?: unknown;
}): GxserverResolvedSessionIdentity {
  const resumeIdentity = parseAgentResumeIdentity(input.startupText);
  const agentSessionPath =
    normalizeText(input.agentSessionPath) ?? normalizeText(input.runtimeSettings?.agentSessionPath);
  const agentSessionId =
    normalizeText(input.agentSessionId) ??
    normalizeText(input.runtimeSettings?.agentSessionId) ??
    resumeIdentity.agentSessionId;
  const agentId =
    normalizeAgentId(input.agentId) ??
    normalizeAgentId(input.agentName) ??
    normalizeAgentId(input.runtimeSettings?.agentName) ??
    normalizeAgentId(input.runtimeSettings?.agentId) ??
    inferAgentIdFromIdentityPath(agentSessionPath) ??
    resumeIdentity.agentId;
  return {
    ...(agentId ? { agentId } : {}),
    ...(agentSessionId ? { agentSessionId } : {}),
    ...(agentSessionPath ? { agentSessionPath } : {}),
  };
}

export function normalizeAgentId(value: unknown): string | undefined {
  const normalized = normalizeText(value)?.toLowerCase().replace(/\s+/gu, " ");
  if (!normalized) {
    return undefined;
  }
  if (["codex", "openai codex", "codex cli"].includes(normalized)) {
    return "codex";
  }
  if (["claude", "claude code"].includes(normalized)) {
    return "claude";
  }
  if (["cursor", "cursor agent", "cursor cli", "cursor-agent"].includes(normalized)) {
    return "cursor";
  }
  if (["opencode", "open code"].includes(normalized)) {
    return "opencode";
  }
  if (["pi", "π"].includes(normalized)) {
    return "pi";
  }
  if (["agy", "antigravity", "antigravity cli"].includes(normalized)) {
    return "antigravity";
  }
  if (["amp", "amp cli"].includes(normalized)) {
    return "amp";
  }
  if (["copilot", "github copilot"].includes(normalized)) {
    return "copilot";
  }
  if (["droid", "factory", "factory droid"].includes(normalized)) {
    return "droid";
  }
  if (["grok", "grok build"].includes(normalized)) {
    return "grok";
  }
  if (["hermes", "hermes agent", "hermes-agent"].includes(normalized)) {
    return "hermes-agent";
  }
  if (["codebuddy", "code buddy"].includes(normalized)) {
    return "codebuddy";
  }
  if (["qoder", "qodercli"].includes(normalized)) {
    return "qoder";
  }
  if (["rovo", "rovo dev", "rovodev"].includes(normalized)) {
    return "rovodev";
  }
  return normalized.replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "") || undefined;
}

export function normalizeCodexSessionId(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized && CODEX_SESSION_ID_PATTERN.test(normalized) ? normalized.toLowerCase() : undefined;
}

export function parseAgentResumeIdentity(value: unknown): GxserverResolvedSessionIdentity {
  const text = typeof value === "string" ? value : "";
  if (!text.trim()) {
    return {};
  }
  /*
  CDXC:GxserverSessionIdentity 2026-05-31-21:10:
  Raw terminal startup text such as `cd ... && codex resume "<uuid>"` is an identity observation, not a title. Extract the agent and exact resume target in gxserver so clients do not need per-platform command parsers to classify restored Codex/Claude/Cursor/OpenCode/Pi sessions.
  */
  const patterns: Array<{ agentId: string; pattern: RegExp }> = [
    { agentId: "codex", pattern: /\bcodex\s+resume\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "claude", pattern: /\bclaude\s+--resume\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "cursor", pattern: /\bcursor-agent\s+--resume\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "opencode", pattern: /\bopencode\s+(?:--session|-s)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "pi", pattern: /\bpi\s+--session\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
  ];
  for (const { agentId, pattern } of patterns) {
    const match = pattern.exec(text);
    const reference = normalizeText(match?.[1] ?? match?.[2] ?? match?.[3]);
    if (reference) {
      return { agentId, agentSessionId: agentId === "codex" ? (normalizeCodexSessionId(reference) ?? reference) : reference };
    }
  }
  return {};
}

export function identitiesMatch(
  left: GxserverResolvedSessionIdentity,
  right: GxserverResolvedSessionIdentity,
): boolean {
  const leftAgent = normalizeAgentId(left.agentId);
  const rightAgent = normalizeAgentId(right.agentId);
  if (leftAgent && rightAgent && leftAgent !== rightAgent) {
    return false;
  }
  const leftSessionId = normalizeText(left.agentSessionId);
  const rightSessionId = normalizeText(right.agentSessionId);
  if (leftSessionId && rightSessionId && leftSessionId === rightSessionId) {
    return true;
  }
  const leftPath = normalizeText(left.agentSessionPath);
  const rightPath = normalizeText(right.agentSessionPath);
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

export function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function inferAgentIdFromIdentityPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const lowerPath = path.toLowerCase();
  /*
  CDXC:GxserverSessionIdentity 2026-06-09-09:58:
  Cursor transcript paths are canonical agent identity evidence for late hook/session-state updates. Recognize the current `~/.cursor/.../agent-transcripts/*.jsonl` shape in gxserver so stale Codex rows are corrected before clients project sidebar icons, search rows, aliases, or resume metadata.
  */
  if (
    (lowerPath.includes("/.cursor/") || lowerPath.includes("/cursor/")) &&
    (lowerPath.endsWith(".json") || lowerPath.endsWith(".jsonl"))
  ) {
    return "cursor";
  }
  if (lowerPath.includes("/.codex/") || lowerPath.includes("/.codex-profiles/")) {
    return "codex";
  }
  return undefined;
}
