import {
  getDefaultSidebarAgentByIcon,
  getDefaultSidebarAgentById,
  type DefaultSidebarAgentId,
  type SidebarAgentIcon,
} from "./sidebar-agents";

/**
 * CDXC:SidebarAgents 2026-05-19-10:05:
 * Accept All is a global Agents setting with per-agent inherit/override controls.
 * When enabled, Ghostex appends each CLI's permission-bypass flag at launch time
 * without mutating the stored base command, and strips duplicate flags first so
 * values like `--yolo --yolo` never reach the terminal.
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

const GROK_PERMISSION_MODE_FLAG = "--permission-mode";
const GROK_BYPASS_PERMISSIONS_VALUE = "bypassPermissions";

export function normalizeAgentAcceptAllMode(candidate: unknown): AgentAcceptAllMode | undefined {
  return candidate === "inherit" || candidate === "enabled" || candidate === "disabled"
    ? candidate
    : undefined;
}

export function resolveAgentAcceptAllEnabled(
  globalEnabled: boolean,
  override: AgentAcceptAllMode | undefined,
): boolean {
  if (override === "enabled") {
    return true;
  }
  if (override === "disabled") {
    return false;
  }
  return globalEnabled;
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

function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter((token) => token.length > 0);
}

function joinCommand(tokens: readonly string[]): string {
  return tokens.join(" ");
}

function isAcceptAllFlagToken(token: string, aliases: ReadonlySet<string>): boolean {
  if (aliases.has(token)) {
    return true;
  }

  const equalsIndex = token.indexOf("=");
  if (equalsIndex > 0) {
    const flag = token.slice(0, equalsIndex);
    return aliases.has(flag);
  }

  return false;
}

/**
 * CDXC:SidebarAgents 2026-05-19-10:05:
 * Strip every known Accept All alias for the agent before optionally appending
 * the canonical flag once at launch time.
 */
export function stripAgentAcceptAllFlags(command: string, spec: AgentAcceptAllFlagSpec): string {
  const aliases = new Set(spec.aliases);
  const tokens = tokenizeCommand(command);
  const nextTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      continue;
    }

    if (token === GROK_PERMISSION_MODE_FLAG) {
      const valueToken = tokens[index + 1];
      if (valueToken === GROK_BYPASS_PERMISSIONS_VALUE) {
        index += 1;
        continue;
      }
      if (valueToken?.startsWith(`${GROK_BYPASS_PERMISSIONS_VALUE}=`)) {
        index += 1;
        continue;
      }
    }

    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`)) {
      const value = token.slice(GROK_PERMISSION_MODE_FLAG.length + 1);
      if (value === GROK_BYPASS_PERMISSIONS_VALUE) {
        continue;
      }
    }

    nextTokens.push(token);
  }

  return joinCommand(nextTokens);
}

export function commandIncludesAcceptAllFlag(command: string, spec: AgentAcceptAllFlagSpec): boolean {
  const aliases = new Set(spec.aliases);
  const tokens = tokenizeCommand(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      return true;
    }
    if (token === GROK_PERMISSION_MODE_FLAG) {
      const valueToken = tokens[index + 1];
      if (valueToken === GROK_BYPASS_PERMISSIONS_VALUE) {
        return true;
      }
    }
    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`)) {
      const value = token.slice(GROK_PERMISSION_MODE_FLAG.length + 1);
      if (value === GROK_BYPASS_PERMISSIONS_VALUE) {
        return true;
      }
    }
  }
  return false;
}

function dedupeAgentAcceptAllFlags(command: string, spec: AgentAcceptAllFlagSpec): string {
  const aliases = new Set(spec.aliases);
  const tokens = tokenizeCommand(command);
  const nextTokens: string[] = [];
  let hasSeenAcceptAllFlag = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      if (hasSeenAcceptAllFlag) {
        continue;
      }
      hasSeenAcceptAllFlag = true;
      nextTokens.push(token);
      continue;
    }

    if (token === GROK_PERMISSION_MODE_FLAG) {
      const valueToken = tokens[index + 1];
      if (valueToken === GROK_BYPASS_PERMISSIONS_VALUE) {
        if (hasSeenAcceptAllFlag) {
          index += 1;
          continue;
        }
        hasSeenAcceptAllFlag = true;
        nextTokens.push(token, valueToken);
        index += 1;
        continue;
      }
    }

    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`)) {
      const value = token.slice(GROK_PERMISSION_MODE_FLAG.length + 1);
      if (value === GROK_BYPASS_PERMISSIONS_VALUE) {
        if (hasSeenAcceptAllFlag) {
          continue;
        }
        hasSeenAcceptAllFlag = true;
        nextTokens.push(token);
        continue;
      }
    }

    nextTokens.push(token);
  }

  return joinCommand(nextTokens);
}

export function applySidebarAgentAcceptAllFlag(
  command: string,
  agentId: string,
  enabled: boolean,
  icon?: SidebarAgentIcon,
  options?: {
    /**
     * CDXC:SidebarAgents 2026-05-19-10:05:
     * Only strip permission-bypass flags when an agent explicitly overrides to
     * Ask for permission. A global off toggle should leave the stored command
     * untouched so commands like `gemini -y` keep their configured behavior.
     */
    stripWhenDisabled?: boolean;
  },
): string {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return trimmedCommand;
  }

  const spec = resolveAgentAcceptAllFlagSpec(agentId, icon);
  if (!spec) {
    return trimmedCommand;
  }

  if (!enabled) {
    return options?.stripWhenDisabled === true
      ? stripAgentAcceptAllFlags(trimmedCommand, spec)
      : trimmedCommand;
  }

  const dedupedCommand = dedupeAgentAcceptAllFlags(trimmedCommand, spec);
  if (commandIncludesAcceptAllFlag(dedupedCommand, spec)) {
    return dedupedCommand;
  }

  return `${dedupedCommand} ${spec.canonicalFlag}`.trim();
}

export function resolveSidebarAgentLaunchCommand(input: {
  acceptAllMode?: AgentAcceptAllMode;
  agentId: string;
  command: string;
  globalAcceptAllEnabled: boolean;
  icon?: SidebarAgentIcon;
}): string {
  const enabled = resolveAgentAcceptAllEnabled(
    input.globalAcceptAllEnabled,
    input.acceptAllMode,
  );
  return applySidebarAgentAcceptAllFlag(
    input.command,
    input.agentId,
    enabled,
    input.icon,
    {
      stripWhenDisabled: input.acceptAllMode === "disabled",
    },
  );
}
