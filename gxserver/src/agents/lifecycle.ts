import type {
  GxserverAgentLaunchPlan,
  GxserverCreateSessionParams,
  GxserverProjectDomainState,
  GxserverAgentResumePlan,
  GxserverAgentSettings,
  GxserverSessionDomainState,
} from "../../protocol/index.js";
import {
  appendCursorResumeFlag,
  getClaudeSessionReference,
  getCodexSessionReference,
  getCursorSessionReference,
  getExactAgentSessionReference,
  getOpenCodeSessionReference,
  getPiSessionReference,
} from "../agent-resume/identity.js";
import { getTrustedAgentResumeTitle } from "../agent-resume/title.js";
import { normalizeAgentActivityState } from "../session-status/index.js";

export {
  applyAgentActivityTransition,
  getAgentActivityStaleProjectionDelayMs,
  getEffectiveAgentActivityState,
  updateSessionActivitySettings,
} from "../session-status/index.js";

export type GxserverAgentAcceptAllMode = "inherit" | "enabled" | "disabled";

export interface GxserverAgentLaunchInput {
  acceptAllMode?: GxserverAgentAcceptAllMode;
  agentId: string;
  agentSessionId?: string;
  command?: string;
  delayedSendDeadlineAt?: string;
  firstUserMessage?: string;
  globalAcceptAllEnabled?: boolean;
  icon?: string;
}

export interface GxserverAgentResumeInput {
  agentCommand?: string;
  agentLookupCommand?: string;
  agentId?: string;
  agentSessionId?: string;
  agentSessionPath?: string;
  projectPath?: string;
  storedCommandCandidates?: readonly string[];
  title?: string;
  titleSource?: string;
}

type DefaultAgentId =
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
  | "rovodev"
  | "t3";

type RestorableAgentId = Exclude<DefaultAgentId, "t3">;

interface AgentAcceptAllFlagSpec {
  aliases: readonly string[];
  canonicalFlag: string;
}

const DEFAULT_AGENT_COMMANDS: Readonly<Record<DefaultAgentId, string>> = {
  amp: "amp",
  antigravity: "agy",
  claude: "claude",
  codebuddy: "codebuddy",
  codex: "codex",
  copilot: "copilot",
  cursor: "cursor-agent",
  droid: "droid",
  gemini: "gemini",
  grok: "grok",
  "hermes-agent": "hermes",
  opencode: "opencode",
  pi: "pi",
  qoder: "qodercli",
  rovodev: "acli rovodev run",
  t3: "npx --yes t3",
};

const DEFAULT_AGENT_ICON_TO_ID: Readonly<Record<string, DefaultAgentId>> = {
  "amp-cli": "amp",
  "antigravity-cli": "antigravity",
  claude: "claude",
  codebuddy: "codebuddy",
  codex: "codex",
  copilot: "copilot",
  "cursor-cli": "cursor",
  "factory-droid": "droid",
  gemini: "gemini",
  "grok-build": "grok",
  "hermes-agent": "hermes-agent",
  opencode: "opencode",
  pi: "pi",
  qoder: "qoder",
  "rovo-dev": "rovodev",
  t3: "t3",
};

const ACCEPT_ALL_FLAG_SPECS: Readonly<Record<DefaultAgentId, AgentAcceptAllFlagSpec | null>> = {
  amp: { aliases: ["--dangerously-allow-all"], canonicalFlag: "--dangerously-allow-all" },
  antigravity: {
    aliases: ["--dangerously-skip-permissions"],
    canonicalFlag: "--dangerously-skip-permissions",
  },
  claude: {
    aliases: ["--dangerously-skip-permissions"],
    canonicalFlag: "--dangerously-skip-permissions",
  },
  codex: { aliases: ["--yolo"], canonicalFlag: "--yolo" },
  codebuddy: null,
  copilot: { aliases: ["--allow-all", "--yolo"], canonicalFlag: "--yolo" },
  cursor: { aliases: ["--force", "--yolo"], canonicalFlag: "--yolo" },
  droid: null,
  gemini: { aliases: ["-y", "--yolo"], canonicalFlag: "--yolo" },
  grok: { aliases: ["--always-approve"], canonicalFlag: "--always-approve" },
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

/*
CDXC:GxserverAgentLifecycle 2026-05-30-15:04:
gxserver owns agent launch/resume decisions for the hard cutover while preserving the current sidebar TypeScript rules. Launch commands get runtime Accept All flags, restore commands keep the raw configured command, startup text is queued after terminalReady, and exact-id resume may use the existing title fallback wrapper instead of replaying into live zmx sessions.

CDXC:GxserverAgentLifecycle 2026-06-01-12:07:
Resume, wake, and fork-style restored commands must apply the same global/per-agent Accept All policy as launch while leaving the stored base command unchanged. gxserver owns this runtime command shaping so macOS, CLI, TUI, and mobile clients do not each decide whether to append permission-bypass flags.

CDXC:GxserverAgentLifecycle 2026-06-01-12:23:
Clients must not rebuild agent launch or resume shell commands locally. gxserver returns launch/resume command plans with separate base, runtime, lookup, display, copy, fallback, and startup-script fields so OpenCode title lookup can use the base command while the final launched command still receives Accept All flags.

CDXC:GxserverAgentLifecycle 2026-06-01-12:59:
Resume plans must resolve exact agent conversation identity before title lookup and must use shared gxserver title trust for any lookup fallback. Placeholder or status-prefixed titles are display-only and must not become Cursor/OpenCode/Codex lookup input.
*/
export function buildAgentLaunchPlan(input: GxserverAgentLaunchInput): GxserverAgentLaunchPlan {
  const baseCommand = normalizeText(input.command) ?? resolveDefaultAgentCommand(input.agentId) ?? "";
  const launchCommand = resolveAgentLaunchCommand({
    acceptAllMode: input.acceptAllMode,
    agentId: input.agentId,
    command: baseCommand,
    globalAcceptAllEnabled: input.globalAcceptAllEnabled === true,
    icon: input.icon,
  });
  const command =
    input.agentId === "cursor" && input.agentSessionId
      ? appendCursorResumeFlag(launchCommand, input.agentSessionId)
      : launchCommand;
  return {
    agentCommand: baseCommand,
    command,
    delayedSend:
      normalizeText(input.delayedSendDeadlineAt) !== undefined
        ? {
            deadlineAt: normalizeText(input.delayedSendDeadlineAt)!,
            disposition: "scheduled",
          }
        : undefined,
    firstUserMessage: normalizeText(input.firstUserMessage),
    startupText: command ? `${command}\r` : "",
    startupTextDisposition: command ? "queueAfterTerminalReady" : "none",
  };
}

export function buildProjectAgentLaunchPlan(
  project: GxserverProjectDomainState,
  input: Pick<GxserverAgentLaunchInput, "agentId" | "agentSessionId">,
  agentSettings?: GxserverAgentSettings,
): GxserverAgentLaunchPlan {
  const agentConfig = resolveProjectAgentConfig(project, input.agentId, {});
  return buildAgentLaunchPlan({
    acceptAllMode: normalizeAcceptAllMode(agentConfig.acceptAllMode),
    agentId: input.agentId,
    agentSessionId: input.agentSessionId,
    command: normalizeText(agentConfig.command),
    globalAcceptAllEnabled: resolveGlobalAcceptAllEnabled(project, agentSettings),
    icon: normalizeText(agentConfig.icon),
  });
}

export function createAgentSessionParams(
  project: GxserverProjectDomainState,
  params: GxserverCreateSessionParams,
  agentSettings?: GxserverAgentSettings,
): GxserverCreateSessionParams {
  const agentId = normalizeText(params.agentId) ?? "codex";
  const launchSettings = normalizeObject(params.launchSettings);
  const runtimeSettings = normalizeObject(params.runtimeSettings);
  const agentConfig = resolveProjectAgentConfig(project, agentId, launchSettings);
  const launchPlan = buildAgentLaunchPlan({
    acceptAllMode: normalizeAcceptAllMode(agentConfig.acceptAllMode ?? launchSettings.acceptAllMode),
    agentId,
    agentSessionId: normalizeText(runtimeSettings.agentSessionId),
    command: normalizeText(agentConfig.command) ?? normalizeText(launchSettings.agentCommand),
    delayedSendDeadlineAt: normalizeText(launchSettings.delayedSendDeadlineAt),
    firstUserMessage: normalizeText(runtimeSettings.firstUserMessage),
    globalAcceptAllEnabled: resolveGlobalAcceptAllEnabled(project, agentSettings),
    icon: normalizeText(agentConfig.icon ?? launchSettings.icon),
  });
  return {
    ...params,
    agentId,
    kind: "agent",
    launchSettings: {
      ...launchSettings,
      agentLaunchPlan: launchPlan,
      runtimeRelevant: {
        delayedSendDeadlineAt: launchPlan.delayedSend?.deadlineAt,
        queueProviderStartupText: launchPlan.startupTextDisposition === "queueAfterTerminalReady",
      },
    },
    lifecycleState: params.lifecycleState ?? "running",
    runtimeSettings: {
      ...runtimeSettings,
      agentActivity: normalizeAgentActivityState(runtimeSettings.agentActivity, {
        activity: launchPlan.startupText ? "working" : "idle",
      }),
      agentCommand: launchPlan.agentCommand,
      ...(launchPlan.firstUserMessage ? { firstUserMessage: launchPlan.firstUserMessage } : {}),
    },
  };
}

export function getAgentStartupTextForSession(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): string | undefined {
  const resumeStartupText = buildAgentResumeStartupText(project, session, agentSettings);
  if (resumeStartupText?.trim()) {
    return resumeStartupText;
  }
  const launchPlan = readAgentLaunchPlan(session.launchSettings);
  return launchPlan?.startupText?.trim() ? launchPlan.startupText : undefined;
}

export function getAgentLaunchStartupTextForSession(
  session: GxserverSessionDomainState,
): string | undefined {
  const launchPlan = readAgentLaunchPlan(session.launchSettings);
  return launchPlan?.startupText?.trim() ? launchPlan.startupText : undefined;
}

export function buildAgentResumeStartupText(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): string | undefined {
  return buildAgentResumePlan(project, session, agentSettings).startupText;
}

export function buildAgentResumePlan(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): GxserverAgentResumePlan {
  const input = toAgentResumeInput(project, session, agentSettings);
  const primaryCommand = buildAgentResumeCommand(project, session, {}, agentSettings);
  const displayCommand = primaryCommand ? (buildAgentResumeCommand(project, session, { display: true }, agentSettings) ?? primaryCommand) : undefined;
  const fallbackCommand = buildAgentResumeFallbackCommand(project, session, agentSettings);
  const startupText = primaryCommand
    ? `${wrapRestoredTerminalResumeCommand(primaryCommand, displayCommand ?? primaryCommand, fallbackCommand)}\r`
    : undefined;
  return {
    agentId: normalizeText(input.agentId),
    baseCommand: normalizeText(input.agentLookupCommand),
    copyCommand: primaryCommand,
    displayCommand,
    fallbackCommand,
    lookupCommand: normalizeText(input.agentLookupCommand),
    primaryCommand,
    runtimeCommand: normalizeText(input.agentCommand),
    startupText,
    startupTextDisposition: startupText ? "queueAfterTerminalReady" : "none",
  };
}

export function buildAgentResumeCommand(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  options: { display?: boolean } = {},
  agentSettings?: GxserverAgentSettings,
): string | undefined {
  const input = toAgentResumeInput(project, session, agentSettings);
  const agentId = normalizeRestorableAgentId(input.agentId);
  const agentCommand = input.agentCommand;
  const agentLookupCommand = input.agentLookupCommand ?? agentCommand;
  if (!agentId || !agentCommand) {
    return undefined;
  }
  const resumeTitle = agentId === "pi" ? undefined : getTrustedAgentResumeTitle(input);
  const exactReference = getExactAgentSessionReference(agentId, input);
  const codexReference = agentId === "codex" ? (getCodexSessionReference(input) ?? resumeTitle) : undefined;
  const claudeReference = agentId === "claude" ? (getClaudeSessionReference(input) ?? resumeTitle) : undefined;
  const cursorReference = agentId === "cursor" ? getCursorSessionReference(input) : undefined;
  const openCodeReference = agentId === "opencode" ? getOpenCodeSessionReference(input) : undefined;
  const piReference = agentId === "pi" ? getPiSessionReference(input) : undefined;

  switch (agentId) {
    case "amp":
      return exactReference ? `${agentCommand} threads continue ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "antigravity":
      return exactReference ? `${agentCommand} --conversation ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "codebuddy":
    case "copilot":
    case "droid":
    case "gemini":
    case "hermes-agent":
    case "qoder":
      return exactReference ? `${agentCommand} --resume ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "grok":
      return exactReference ? `${agentCommand} -r ${quoteShellDoubleArg(exactReference)}` : undefined;
    case "codex":
      return codexReference ? `${agentCommand} resume ${quoteShellDoubleArg(codexReference)}` : undefined;
    case "claude":
      return claudeReference ? `${agentCommand} --resume ${quoteShellDoubleArg(claudeReference)}` : undefined;
    case "cursor":
      if (cursorReference) {
        return `${agentCommand} --resume ${quoteShellDoubleArg(cursorReference)}`;
      }
      if (!resumeTitle || !input.projectPath) {
        return undefined;
      }
      return options.display
        ? `${agentCommand} --resume ${quoteShellDoubleArg(resumeTitle)}  # lookup chat id in Cursor chat store`
        : buildCursorResumeLookupCommand(agentCommand, input.projectPath, resumeTitle);
    case "opencode":
      if (openCodeReference) {
        return `${agentCommand} --session ${quoteShellDoubleArg(openCodeReference)}`;
      }
      if (!resumeTitle) {
        return undefined;
      }
      return options.display
        ? `${agentCommand} -s ${quoteShellDoubleArg(resumeTitle)}  # lookup session id in OpenCode session list`
        : buildOpenCodeResumeCommand(agentCommand, resumeTitle, agentLookupCommand);
    case "pi":
      return piReference ? `${agentCommand} --session ${quoteShellDoubleArg(piReference)}` : undefined;
    case "rovodev":
      return exactReference ? buildRovoDevResumeCommand(agentCommand, exactReference) : undefined;
  }
}

export function buildAgentResumeFallbackCommand(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): string | undefined {
  const input = toAgentResumeInput(project, session, agentSettings);
  const agentId = normalizeRestorableAgentId(input.agentId);
  const agentCommand = input.agentCommand;
  const agentLookupCommand = input.agentLookupCommand ?? agentCommand;
  const resumeTitle = getTrustedAgentResumeTitle(input);
  if (!agentId || !agentCommand || !resumeTitle) {
    return undefined;
  }
  switch (agentId) {
    case "codex": {
      const exactReference = getCodexSessionReference(input);
      return exactReference && exactReference !== resumeTitle
        ? `${agentCommand} resume ${quoteShellDoubleArg(resumeTitle)}`
        : undefined;
    }
    case "claude": {
      const exactReference = getClaudeSessionReference(input);
      return exactReference && exactReference !== resumeTitle
        ? `${agentCommand} --resume ${quoteShellDoubleArg(resumeTitle)}`
        : undefined;
    }
    case "opencode": {
      const exactReference = getOpenCodeSessionReference(input);
      return exactReference && exactReference !== resumeTitle
        ? buildOpenCodeResumeCommand(agentCommand, resumeTitle, agentLookupCommand)
        : undefined;
    }
    case "cursor": {
      const exactReference = getCursorSessionReference(input);
      return exactReference && input.projectPath
        ? buildCursorResumeLookupCommand(agentCommand, input.projectPath, resumeTitle)
        : undefined;
    }
    default:
      return undefined;
  }
}

function resolveAgentLaunchCommand(input: {
  acceptAllMode?: GxserverAgentAcceptAllMode;
  agentId: string;
  command: string;
  globalAcceptAllEnabled: boolean;
  icon?: string;
}): string {
  const enabled =
    input.acceptAllMode === "enabled" ? true : input.acceptAllMode === "disabled" ? false : input.globalAcceptAllEnabled;
  return applyAcceptAllFlag(input.command, input.agentId, enabled, input.icon, {
    stripWhenDisabled: input.acceptAllMode === "disabled",
  });
}

function applyAcceptAllFlag(
  command: string,
  agentId: string,
  enabled: boolean,
  icon?: string,
  options: { stripWhenDisabled?: boolean } = {},
): string {
  const trimmed = command.trim();
  const spec = resolveAcceptAllFlagSpec(agentId, icon);
  if (!trimmed || !spec) {
    return trimmed;
  }
  if (!enabled) {
    return options.stripWhenDisabled === true ? stripAcceptAllFlags(trimmed, spec) : trimmed;
  }
  const deduped = dedupeAcceptAllFlags(trimmed, spec);
  return commandIncludesAcceptAllFlag(deduped, spec) ? deduped : `${deduped} ${spec.canonicalFlag}`.trim();
}

function resolveAcceptAllFlagSpec(agentId: string, icon?: string): AgentAcceptAllFlagSpec | undefined {
  const normalizedAgentId = normalizeDefaultAgentId(agentId);
  const specFromId = normalizedAgentId ? ACCEPT_ALL_FLAG_SPECS[normalizedAgentId] : undefined;
  if (specFromId) {
    return specFromId;
  }
  const iconAgentId = icon ? DEFAULT_AGENT_ICON_TO_ID[icon] : undefined;
  const specFromIcon = iconAgentId ? ACCEPT_ALL_FLAG_SPECS[iconAgentId] : undefined;
  return specFromIcon ?? undefined;
}

function stripAcceptAllFlags(command: string, spec: AgentAcceptAllFlagSpec): string {
  const aliases = new Set(spec.aliases);
  const nextTokens: string[] = [];
  const tokens = tokenizeCommand(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      continue;
    }
    if (token === GROK_PERMISSION_MODE_FLAG) {
      const valueToken = tokens[index + 1];
      if (valueToken === GROK_BYPASS_PERMISSIONS_VALUE || valueToken?.startsWith(`${GROK_BYPASS_PERMISSIONS_VALUE}=`)) {
        index += 1;
        continue;
      }
    }
    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`) && token.slice(GROK_PERMISSION_MODE_FLAG.length + 1) === GROK_BYPASS_PERMISSIONS_VALUE) {
      continue;
    }
    nextTokens.push(token);
  }
  return nextTokens.join(" ");
}

function dedupeAcceptAllFlags(command: string, spec: AgentAcceptAllFlagSpec): string {
  const aliases = new Set(spec.aliases);
  const nextTokens: string[] = [];
  let hasSeen = false;
  const tokens = tokenizeCommand(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      if (!hasSeen) {
        nextTokens.push(token);
        hasSeen = true;
      }
      continue;
    }
    if (token === GROK_PERMISSION_MODE_FLAG) {
      const valueToken = tokens[index + 1];
      if (valueToken === GROK_BYPASS_PERMISSIONS_VALUE) {
        if (!hasSeen) {
          nextTokens.push(token, valueToken);
          hasSeen = true;
        }
        index += 1;
        continue;
      }
    }
    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`) && token.slice(GROK_PERMISSION_MODE_FLAG.length + 1) === GROK_BYPASS_PERMISSIONS_VALUE) {
      if (!hasSeen) {
        nextTokens.push(token);
        hasSeen = true;
      }
      continue;
    }
    nextTokens.push(token);
  }
  return nextTokens.join(" ");
}

function commandIncludesAcceptAllFlag(command: string, spec: AgentAcceptAllFlagSpec): boolean {
  const aliases = new Set(spec.aliases);
  const tokens = tokenizeCommand(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isAcceptAllFlagToken(token, aliases)) {
      return true;
    }
    if (token === GROK_PERMISSION_MODE_FLAG && tokens[index + 1] === GROK_BYPASS_PERMISSIONS_VALUE) {
      return true;
    }
    if (token.startsWith(`${GROK_PERMISSION_MODE_FLAG}=`) && token.slice(GROK_PERMISSION_MODE_FLAG.length + 1) === GROK_BYPASS_PERMISSIONS_VALUE) {
      return true;
    }
  }
  return false;
}

function isAcceptAllFlagToken(token: string, aliases: ReadonlySet<string>): boolean {
  if (aliases.has(token)) {
    return true;
  }
  const equalsIndex = token.indexOf("=");
  return equalsIndex > 0 && aliases.has(token.slice(0, equalsIndex));
}

function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function wrapRestoredTerminalResumeCommand(
  command: string,
  displayCommand: string,
  fallbackCommand?: string,
): string {
  const lines = [
    `printf '%s\\n' ${quoteShellArg("Restoring session...")}`,
    `printf '> %s\\n\\n' ${quoteShellArg(displayCommand)}`,
    "__ghostex_restore_resume_status=0",
    "__ghostex_restore_resume_primary() {",
    command,
    "}",
    "__ghostex_restore_resume_primary || __ghostex_restore_resume_status=$?",
    "unset -f __ghostex_restore_resume_primary",
  ];
  if (fallbackCommand && fallbackCommand !== command) {
    lines.push(
      'if [ "$__ghostex_restore_resume_status" -ne 0 ]; then',
      `  printf '%s\\n' ${quoteShellArg("Exact resume failed; trying saved fallback resume command.")}`,
      "  __ghostex_restore_resume_status=0",
      "  __ghostex_restore_resume_fallback() {",
      fallbackCommand,
      "  }",
      "  __ghostex_restore_resume_fallback || __ghostex_restore_resume_status=$?",
      "  unset -f __ghostex_restore_resume_fallback",
      "fi",
    );
  }
  lines.push("unset __ghostex_restore_resume_status");
  return lines.join("\n");
}

function toAgentResumeInput(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): GxserverAgentResumeInput {
  const agentConfig = resolveProjectAgentConfig(project, session.agentId ?? "", session.launchSettings);
  const baseAgentCommand =
    normalizeText(session.runtimeSettings.agentCommand) ??
    normalizeText(agentConfig.command) ??
    resolveDefaultAgentCommand(session.agentId);
  const agentId = session.agentId;
  const runtimeAgentCommand = agentId && baseAgentCommand
    ? resolveAgentLaunchCommand({
        acceptAllMode: normalizeAcceptAllMode(agentConfig.acceptAllMode ?? session.launchSettings.acceptAllMode),
        agentId,
        command: baseAgentCommand,
        globalAcceptAllEnabled: resolveGlobalAcceptAllEnabled(project, agentSettings),
        icon: normalizeText(agentConfig.icon ?? session.launchSettings.icon),
      })
    : baseAgentCommand;
  return {
    agentCommand: runtimeAgentCommand,
    agentId,
    agentLookupCommand: baseAgentCommand,
    agentSessionId: normalizeText(session.runtimeSettings.agentSessionId),
    agentSessionPath: normalizeText(session.runtimeSettings.agentSessionPath),
    projectPath: session.cwd ?? project.path,
    storedCommandCandidates: collectStoredAgentResumeCommandCandidates(session),
    title: session.title,
    titleSource: normalizeText(session.runtimeSettings.titleSource) ?? normalizeText(session.runtimeSettings.restoreTitleSource) ?? "user",
  };
}

function resolveGlobalAcceptAllEnabled(
  project: GxserverProjectDomainState,
  agentSettings?: GxserverAgentSettings,
): boolean {
  /*
  CDXC:GxserverAgentSettings 2026-06-02-22:23:
  Global Accept All resolves from gxserver daemon agent settings. Project launchSettings are a legacy migration fallback only for rows imported before the daemon-level settings record existed; new clients must read/write `/api/readAgentSettings` and `/api/updateAgentSettings` instead of shaping commands locally.
  */
  return agentSettings
    ? agentSettings.agentAcceptAllEnabled
    : readBoolean(project.launchSettings.agentAcceptAllEnabled ?? project.launchSettings.acceptAll);
}

function collectStoredAgentResumeCommandCandidates(session: GxserverSessionDomainState): readonly string[] {
  const runtimeSettings = session.runtimeSettings;
  const launchSettings = session.launchSettings;
  const launchPlan = normalizeObject(launchSettings.agentLaunchPlan);
  const resumePlan = normalizeObject(launchSettings.agentResumePlan);
  const candidates = [
    runtimeSettings.agentResumeCommand,
    runtimeSettings.resumeCommand,
    runtimeSettings.resumeFallbackCommand,
    runtimeSettings.copyCommand,
    runtimeSettings.startupText,
    launchSettings.agentResumeCommand,
    launchSettings.resumeCommand,
    launchSettings.resumeFallbackCommand,
    launchSettings.copyCommand,
    launchSettings.startupText,
    launchPlan.command,
    launchPlan.startupText,
    resumePlan.primaryCommand,
    resumePlan.copyCommand,
    resumePlan.displayCommand,
    resumePlan.startupText,
  ];
  return [...new Set(candidates.map(normalizeText).filter((value): value is string => value !== undefined))];
}

function resolveProjectAgentConfig(
  project: GxserverProjectDomainState,
  agentId: string,
  launchSettings: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedAgentId = agentId.trim().toLowerCase();
  const customAgent = project.customAgents.find((candidate) => {
    const candidateId = normalizeText(candidate.agentId)?.toLowerCase();
    return candidateId === normalizedAgentId;
  });
  return customAgent ?? (normalizeText(launchSettings.agentCommand) ? launchSettings : {});
}

function buildRovoDevResumeCommand(agentCommand: string, sessionReference: string): string {
  const quoted = quoteShellDoubleArg(sessionReference);
  return /\brovodev\b/u.test(agentCommand)
    ? `${agentCommand} --restore ${quoted}`
    : `${agentCommand} rovodev run --restore ${quoted}`;
}

function buildCursorResumeLookupCommand(agentCommand: string, projectPath: string, resumeTitle: string): string {
  return [
    'CURSOR_CHAT_ID="$(',
    `/usr/bin/python3 -c ${quoteShellArg(getCursorChatSessionLookupScript())} ${quoteShellArg(projectPath)} ${quoteShellArg(resumeTitle)}`,
    ')"',
    "&&",
    'test -n "$CURSOR_CHAT_ID"',
    "&&",
    `${agentCommand} --resume "$CURSOR_CHAT_ID"`,
    "||",
    `printf '%s\\n' ${quoteShellArg(`Unable to find Cursor chat id for "${resumeTitle}".`)}`,
  ].join(" ");
}

function buildOpenCodeResumeCommand(agentCommand: string, resumeTitle: string, lookupAgentCommand = agentCommand): string {
  return `${agentCommand} -s "$(${lookupAgentCommand} session list --format json | /usr/bin/python3 -c ${quoteShellArg(getOpenCodeSessionLookupScript())} ${quoteShellArg(resumeTitle)})"`;
}

function getCursorChatSessionLookupScript(): string {
  return `import hashlib
import json
import pathlib
import sqlite3
import sys

project_path = sys.argv[1].strip()
title = sys.argv[2].strip()
if not project_path or not title:
    sys.exit(1)

project_hash = hashlib.md5(project_path.encode()).hexdigest()
chats_dir = pathlib.Path.home() / ".cursor" / "chats" / project_hash
if not chats_dir.is_dir():
    sys.exit(1)

def parse_meta_value(raw):
    raw = raw.strip()
    if raw.startswith("{"):
        return json.loads(raw)
    return json.loads(bytes.fromhex(raw).decode("utf-8"))

matches = []
for chat_dir in chats_dir.iterdir():
    if not chat_dir.is_dir():
        continue
    db_path = chat_dir / "store.db"
    if not db_path.is_file():
        continue
    try:
        connection = sqlite3.connect(db_path)
        rows = connection.execute("select value from meta").fetchall()
        connection.close()
    except Exception:
        continue
    for row in rows:
        try:
            meta = parse_meta_value(str(row[0] or ""))
        except Exception:
            continue
        name = str(meta.get("name") or "").strip()
        if name != title:
            continue
        chat_id = str(meta.get("agentId") or chat_dir.name).strip()
        if not chat_id:
            continue
        created_at = int(meta.get("createdAt") or 0)
        matches.append((created_at, chat_id))

if not matches:
    sys.exit(1)

matches.sort()
sys.stdout.write(matches[-1][1])
`;
}

function getOpenCodeSessionLookupScript(): string {
  return `import json, os, sys
title = sys.argv[1].strip()
for line in sys.stdin:
    try:
        item = json.loads(line)
    except Exception:
        continue
    name = str(item.get("title") or item.get("name") or "").strip()
    session_id = str(item.get("id") or "").strip()
    if name == title and session_id:
        sys.stdout.write(session_id)
        sys.exit(0)
sys.exit(1)
`;
}

function readAgentLaunchPlan(value: Record<string, unknown>): GxserverAgentLaunchPlan | undefined {
  const plan = normalizeObject(value.agentLaunchPlan);
  const startupText = normalizeText(plan.startupText);
  const command = normalizeText(plan.command);
  return startupText || command
    ? {
        agentCommand: normalizeText(plan.agentCommand),
        command: command ?? "",
        firstUserMessage: normalizeText(plan.firstUserMessage),
        startupText: startupText ?? "",
        startupTextDisposition: plan.startupTextDisposition === "queueAfterTerminalReady" ? "queueAfterTerminalReady" : "none",
      }
    : undefined;
}

function normalizeDefaultAgentId(value: string | undefined): DefaultAgentId | undefined {
  return value && Object.prototype.hasOwnProperty.call(DEFAULT_AGENT_COMMANDS, value)
    ? (value as DefaultAgentId)
    : undefined;
}

function normalizeRestorableAgentId(value: string | undefined): RestorableAgentId | undefined {
  const agentId = normalizeDefaultAgentId(value);
  return agentId && agentId !== "t3" ? agentId : undefined;
}

function resolveDefaultAgentCommand(agentId: string | undefined): string | undefined {
  const normalized = normalizeDefaultAgentId(agentId);
  return normalized ? DEFAULT_AGENT_COMMANDS[normalized] : undefined;
}

function normalizeAcceptAllMode(value: unknown): GxserverAgentAcceptAllMode | undefined {
  return value === "inherit" || value === "enabled" || value === "disabled" ? value : undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function getCommandExecutableName(command: string | undefined): string | undefined {
  const first = command?.trim().split(/\s+/u)[0]?.trim();
  return first ? first.replace(/^['"]|['"]$/gu, "").toLowerCase() : undefined;
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteShellDoubleArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
}
