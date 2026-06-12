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
  if (["omp"].includes(normalized)) {
    return "omp";
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
  if (["kiro", "kiro cli", "kiro-cli"].includes(normalized)) {
    return "kiro";
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

  CDXC:GxserverSessionIdentity 2026-06-12-04:41:
  Codex resume commands can include runtime flags before the verb, such as `codex --yolo resume <id>`. Parse that shape in the shared identity reducer so live zmx process evidence and startup text repair stale agent metadata the same way for every client.
  */
  const patterns: Array<{ agentId: string; pattern: RegExp }> = [
    { agentId: "codex", pattern: /\bcodex(?:\s+--[a-z0-9][a-z0-9-]*(?:=(?:"[^"]+"|'[^']+'|[^\s;&|]+))?)*\s+(?:resume|fork)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "codex", pattern: /\bcodex\s+resume\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "claude", pattern: /\bclaude\s+--resume\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "cursor", pattern: /\bcursor-agent\s+--resume\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "opencode", pattern: /\bopencode\s+(?:--session|-s)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "pi", pattern: /\bpi\s+--session\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    /*
    CDXC:AgentResume 2026-06-11-22:49:
    Kiro and OMP restore commands can arrive as startup text before hook metadata. Parse their exact resume flags in gxserver so session identity stays server-owned across clients.
    */
    { agentId: "kiro", pattern: /\bkiro-cli\s+chat\b[^\n;&|]*--resume-id\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
    { agentId: "omp", pattern: /\bomp\s+--session\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/iu },
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
  /*
  CDXC:ClaudeSessionIdentity 2026-06-11-21:43:
  Claude Code transcript paths are durable session identity. Promote rows with `.claude` transcript metadata to Claude in gxserver so macOS, mobile, CLI, and future clients render the agent icon/title and resume metadata from the same server-owned classification instead of leaving the row as a plain terminal.
  */
  if (
    (lowerPath.includes("/.claude/") || lowerPath.includes("/.claude-profiles/")) &&
    lowerPath.endsWith(".jsonl")
  ) {
    return "claude";
  }
  if (lowerPath.includes("/.codex/") || lowerPath.includes("/.codex-profiles/")) {
    return "codex";
  }
  /*
  CDXC:AgentSessionIdentity 2026-06-11-22:19:
  Hook metadata for lower-priority agents can arrive before a clean agentName. Keep provider path inference in gxserver so all clients classify those rows from the same server-owned identity evidence instead of duplicating macOS-only detection code.
  */
  if (lowerPath.includes("/.grok/")) {
    return "grok";
  }
  if (lowerPath.includes("/.opencode/") || lowerPath.includes("/.config/opencode/")) {
    return "opencode";
  }
  if (lowerPath.includes("/.pi/agent/")) {
    return "pi";
  }
  if (lowerPath.includes("/.omp/agent/")) {
    return "omp";
  }
  if (lowerPath.includes("/.gemini/config/")) {
    return "antigravity";
  }
  if (lowerPath.includes("/.copilot/")) {
    return "copilot";
  }
  if (lowerPath.includes("/.factory/")) {
    return "droid";
  }
  if (lowerPath.includes("/.kiro/agents/")) {
    return "kiro";
  }
  if (lowerPath.includes("/.hermes/")) {
    return "hermes-agent";
  }
  if (lowerPath.includes("/.codebuddy/")) {
    return "codebuddy";
  }
  if (lowerPath.includes("/.qoder/")) {
    return "qoder";
  }
  if (lowerPath.includes("/.rovodev/")) {
    return "rovodev";
  }
  return undefined;
}
