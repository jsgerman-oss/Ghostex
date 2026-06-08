import {
  getDefaultSidebarAgentByIcon,
  getDefaultSidebarAgentById,
  type DefaultSidebarAgentId,
  type SidebarAgentIcon,
} from "./sidebar-agents";

/**
 * CDXC:SidebarAgents 2026-06-02-22:23:
 * The sidebar keeps only the Accept All mode type and support detection needed
 * for Settings UI. gxserver owns runtime flag insertion, stripping, and command
 * shaping so macOS, CLI, TUI, mobile, and remote clients cannot diverge.
 */
export type AgentAcceptAllMode = "inherit" | "enabled" | "disabled";

export type AgentAcceptAllFlagSpec = {
  aliases: readonly string[];
  canonicalFlag: string;
};

/**
 * CDXC:SidebarAgents 2026-05-19-10:05:
 * Flags were verified from each vendor CLI `--help` on 2026-05-19. Antigravity
 * CLI (`agy`) uses `--dangerously-skip-permissions` for Accept All. Factory Droid
 * interactive mode has no skip flag; only `droid exec` exposes
 * `--skip-permissions-unsafe`, so the default `droid` launcher stays unsupported.
 */
export const AGENT_ACCEPT_ALL_FLAG_SPECS: Readonly<
  Record<DefaultSidebarAgentId, AgentAcceptAllFlagSpec | null>
> = {
  antigravity: {
    aliases: ["--dangerously-skip-permissions"],
    canonicalFlag: "--dangerously-skip-permissions",
  },
  amp: {
    aliases: ["--dangerously-allow-all"],
    canonicalFlag: "--dangerously-allow-all",
  },
  claude: {
    aliases: ["--dangerously-skip-permissions"],
    canonicalFlag: "--dangerously-skip-permissions",
  },
  codex: {
    aliases: ["--yolo"],
    canonicalFlag: "--yolo",
  },
  codebuddy: null,
  copilot: {
    aliases: ["--allow-all", "--yolo"],
    canonicalFlag: "--yolo",
  },
  cursor: {
    aliases: ["--force", "--yolo"],
    canonicalFlag: "--yolo",
  },
  /**
   * CDXC:SidebarAgents 2026-05-19-10:05:
   * Factory Droid only documents permission bypass on `droid exec`, not the
   * interactive `droid` command used by the built-in launcher.
   */
  droid: null,
  gemini: {
    aliases: ["-y", "--yolo"],
    canonicalFlag: "--yolo",
  },
  grok: {
    aliases: ["--always-approve"],
    canonicalFlag: "--always-approve",
  },
  "hermes-agent": null,
  opencode: {
    aliases: ["--dangerously-skip-permissions", "--yolo"],
    canonicalFlag: "--dangerously-skip-permissions",
  },
  pi: null,
  qoder: null,
  rovodev: null,
  t3: null,
};

export function normalizeAgentAcceptAllMode(candidate: unknown): AgentAcceptAllMode | undefined {
  return candidate === "inherit" || candidate === "enabled" || candidate === "disabled"
    ? candidate
    : undefined;
}

export function resolveAgentAcceptAllFlagSpec(
  agentId: string,
  icon?: SidebarAgentIcon,
): AgentAcceptAllFlagSpec | undefined {
  const defaultAgent = getDefaultSidebarAgentById(agentId);
  const specFromId = defaultAgent
    ? AGENT_ACCEPT_ALL_FLAG_SPECS[defaultAgent.agentId]
    : undefined;
  if (specFromId) {
    return specFromId;
  }

  if (!icon || icon === "browser") {
    return undefined;
  }

  const iconAgentId = getDefaultSidebarAgentByIcon(icon)?.agentId;
  if (!iconAgentId) {
    return undefined;
  }

  const spec = AGENT_ACCEPT_ALL_FLAG_SPECS[iconAgentId as DefaultSidebarAgentId];
  return spec ?? undefined;
}

export function supportsAgentAcceptAll(agentId: string, icon?: SidebarAgentIcon): boolean {
  return resolveAgentAcceptAllFlagSpec(agentId, icon) !== undefined;
}
