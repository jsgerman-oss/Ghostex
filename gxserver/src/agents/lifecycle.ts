import type {
  GxserverAgentForkPlan,
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

CDXC:GxserverForkSession 2026-06-04-07:42:
Fork is a gxserver-owned lifecycle action for macOS, Electron, CLI, Android, and iOS. Build provider fork commands from the authoritative domain session identity and daemon agent settings so sidebar clients do not reject valid Codex rows because their local presentation cache is missing agentName or agentSessionId.

CDXC:GxserverAgentLifecycle 2026-06-06-16:58:
gxserver-generated launch, resume, and fork startup text is typed into interactive shells by macOS clients and by server-owned zmx run flows. Prefix one leading space at the shell-input boundary so automated commands do not enter Atuin history; keep display/copy commands unprefixed and leave in-agent slash commands to client-specific prompt flows.
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
    startupText: command ? asAtuinIgnoredShellInput(command) : "",
    startupTextDisposition: command ? "queueAfterTerminalReady" : "none",
  };
}

export function buildAgentForkPlan(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  agentSettings?: GxserverAgentSettings,
): GxserverAgentForkPlan {
  const input = toAgentResumeInput(project, session, agentSettings);
  const agentId = normalizeRestorableAgentId(input.agentId);
  const agentCommand = input.agentCommand;
  if (!agentId || !agentCommand) {
    return { agentId, startupTextDisposition: "none" };
  }
  const resumeTitle = agentId === "pi" ? undefined : getTrustedAgentResumeTitle(input);
  const primaryCommand = buildAgentForkCommand(agentId, agentCommand, input, resumeTitle);
  const displayCommand = buildAgentForkCommand(agentId, agentCommand, input, resumeTitle, { display: true });
  const startupText = primaryCommand ? asAtuinIgnoredShellInput(primaryCommand) : undefined;
  return {
    agentId,
    baseCommand: normalizeText(input.agentLookupCommand),
    displayCommand: displayCommand ?? primaryCommand,
    primaryCommand,
    runtimeCommand: normalizeText(agentCommand),
    startupText,
    startupTextDisposition: startupText ? "queueAfterTerminalReady" : "none",
  };
}

export function createAgentForkSessionParams(
  project: GxserverProjectDomainState,
  sourceSession: GxserverSessionDomainState,
  plan: GxserverAgentForkPlan,
): GxserverCreateSessionParams {
  const agentId = normalizeText(plan.agentId) ?? normalizeText(sourceSession.agentId) ?? "codex";
  const startupText = normalizeStartupText(plan.startupText);
  return {
    agentId,
    cwd: sourceSession.cwd ?? project.path,
    kind: "agent",
    launchSettings: {
      agentLaunchPlan: {
        agentCommand: normalizeText(plan.baseCommand),
        command: normalizeText(plan.primaryCommand) ?? "",
        startupText: plan.startupText ?? "",
        startupTextDisposition: plan.startupTextDisposition,
      },
      forkedFromSessionId: sourceSession.sessionId,
      runtimeRelevant: {
        queueProviderStartupText: startupText !== undefined,
      },
    },
    lifecycleState: "running",
    providerState: {
      lifecycleState: "missing",
      provider: "zmx",
    },
    projectId: project.projectId,
    restoredFromSessionId: sourceSession.sessionId,
    runtimeSettings: {
      agentActivity: normalizeAgentActivityState(undefined, {
        activity: startupText ? "working" : "idle",
      }),
      agentCommand: normalizeText(plan.baseCommand),
      agentName: agentId,
      forkedFromSessionId: sourceSession.sessionId,
      startupText,
      titleSource: "placeholder",
    },
    surface: sourceSession.surface,
    title: `${sourceSession.title || "Terminal Session"} Fork`,
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
    ? asAtuinIgnoredShellInput(wrapRestoredTerminalResumeCommand(primaryCommand, displayCommand ?? primaryCommand, fallbackCommand))
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
  const codexExactReference = agentId === "codex" ? getCodexSessionReference(input) : undefined;
  const codexReference = agentId === "codex" ? (codexExactReference ?? resumeTitle) : undefined;
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
      if (!codexReference) {
        return undefined;
      }
      if (options.display) {
        return codexExactReference
          ? `${agentCommand} resume ${quoteShellDoubleArg(codexExactReference)}`
          : `${agentCommand} resume ${quoteShellDoubleArg(codexReference)}  # lookup Codex session id by title`;
      }
      return codexExactReference
        ? buildCodexValidatedResumeCommand(agentCommand, codexExactReference)
        : buildCodexResumeLookupCommand(agentCommand, codexReference);
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

function buildAgentForkCommand(
  agentId: RestorableAgentId,
  agentCommand: string,
  input: GxserverAgentResumeInput,
  resumeTitle: string | undefined,
  options: { display?: boolean } = {},
): string | undefined {
  switch (agentId) {
    case "codex": {
      const exactReference = getCodexSessionReference(input);
      if (exactReference) {
        return `${agentCommand} fork ${quoteShellDoubleArg(exactReference)}`;
      }
      if (!resumeTitle) {
        return undefined;
      }
      return options.display
        ? `${agentCommand} fork ${quoteShellDoubleArg(resumeTitle)}  # lookup Codex session id by title`
        : buildCodexForkLookupCommand(agentCommand, resumeTitle);
    }
    case "claude": {
      const reference = getClaudeSessionReference(input) ?? resumeTitle;
      return reference
        ? `${agentCommand} --resume ${quoteShellDoubleArg(reference)} --fork-session`
        : undefined;
    }
    case "pi": {
      const reference = getPiSessionReference(input);
      return reference ? `${agentCommand} --fork ${quoteShellDoubleArg(reference)}` : undefined;
    }
    default:
      return undefined;
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
        ? buildCodexResumeLookupCommand(agentCommand, resumeTitle)
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

function asAtuinIgnoredShellInput(command: string): string {
  const text = command.replace(/[\r\n]+$/u, "");
  return `${text.startsWith(" ") ? text : ` ${text}`}\r`;
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

function buildCodexValidatedResumeCommand(agentCommand: string, sessionReference: string): string {
  /*
  CDXC:GxserverAgentLifecycle 2026-06-07-01:57:
  Codex sleep/wake restore may keep its title fallback, but it must never resume Ghostex's internal `codex exec` title-generation transcript. Validate exact ids through the same transcript classifier used by title lookup so a polluted stored id fails primary restore and falls through to the filtered fallback.
  */
  return [
    'CODEX_RESUME_SESSION_ID="$(',
    `/usr/bin/python3 -c ${quoteShellArg(getCodexSessionIdLookupScript())} --exact ${quoteShellArg(sessionReference)}`,
    ')"',
    "&&",
    'test -n "$CODEX_RESUME_SESSION_ID"',
    "&&",
    `${agentCommand} resume "$CODEX_RESUME_SESSION_ID"`,
    "||",
    `{ printf '%s\\n' ${quoteShellArg(`Unable to restore Codex session "${sessionReference}".`)}; false; }`,
  ].join(" ");
}

function buildCodexResumeLookupCommand(agentCommand: string, resumeTitle: string): string {
  return [
    'CODEX_RESUME_SESSION_ID="$(',
    `/usr/bin/python3 -c ${quoteShellArg(getCodexSessionIdLookupScript())} --title ${quoteShellArg(resumeTitle)}`,
    ')"',
    "&&",
    'test -n "$CODEX_RESUME_SESSION_ID"',
    "&&",
    `${agentCommand} resume "$CODEX_RESUME_SESSION_ID"`,
    "||",
    `{ printf '%s\\n' ${quoteShellArg(`Unable to find restorable Codex session id for "${resumeTitle}".`)}; false; }`,
  ].join(" ");
}

function buildCodexForkLookupCommand(agentCommand: string, resumeTitle: string): string {
  return [
    'CODEX_FORK_SESSION_ID="$(',
    `/usr/bin/python3 -c ${quoteShellArg(getCodexSessionIdLookupScript())} --title ${quoteShellArg(resumeTitle)}`,
    ')"',
    "&&",
    'test -n "$CODEX_FORK_SESSION_ID"',
    "&&",
    `${agentCommand} fork "$CODEX_FORK_SESSION_ID"`,
    "||",
    `printf '%s\\n' ${quoteShellArg(`Unable to find Codex session id for "${resumeTitle}".`)}`,
  ].join(" ");
}

function getCodexSessionIdLookupScript(): string {
  return `import json
import os
import pathlib
import re
import sys

mode = sys.argv[1].strip() if len(sys.argv) > 1 else ""
query = sys.argv[2].strip() if len(sys.argv) > 2 else ""
if mode not in {"--exact", "--title"} or not query:
    sys.exit(1)

home = pathlib.Path.home()
candidate_homes = []
for value in [os.environ.get("CODEX_HOME")]:
    if value:
        candidate_homes.append(pathlib.Path(value).expanduser())
for value in [
    home / ".codex-profiles" / "personal",
    home / ".codex-profiles" / "work",
    home / ".codex",
]:
    candidate_homes.append(value)

seen = set()
codex_homes = []
for codex_home in candidate_homes:
    codex_home = codex_home.resolve() if codex_home.exists() else codex_home
    if str(codex_home) in seen:
        continue
    seen.add(str(codex_home))
    codex_homes.append(codex_home)

session_id_pattern = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
internal_title_prompt_markers = (
    "Write a concise session title that summarizes the user's text.",
    "Output handling:",
    "Print only the final result to stdout.",
)

def transcript_paths_for_session(codex_home, session_id, item=None):
    seen_paths = set()
    for key in ["path", "session_path", "sessionPath", "transcript_path", "transcriptPath"]:
        value = str((item or {}).get(key) or "").strip()
        if not value:
            continue
        path = pathlib.Path(value).expanduser()
        if not path.is_absolute():
            path = codex_home / path
        if str(path) not in seen_paths:
            seen_paths.add(str(path))
            yield path
    sessions_dir = codex_home / "sessions"
    if not sessions_dir.is_dir():
        return
    try:
        for path in sessions_dir.rglob(f"*{session_id}*.jsonl"):
            if str(path) in seen_paths:
                continue
            seen_paths.add(str(path))
            yield path
    except Exception:
        return

def transcript_is_internal_codex_exec(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            for index, line in enumerate(handle):
                if index > 80:
                    break
                if all(marker in line for marker in internal_title_prompt_markers):
                    return True
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                payload = entry.get("payload") if isinstance(entry, dict) else None
                if not isinstance(payload, dict):
                    continue
                if str(payload.get("originator") or "").strip() == "codex_exec":
                    return True
                if str(payload.get("source") or "").strip() == "exec":
                    return True
    except FileNotFoundError:
        return False
    except Exception:
        return False
    return False

def is_internal_codex_session(codex_home, session_id, item=None):
    if str((item or {}).get("originator") or "").strip() == "codex_exec":
        return True
    if str((item or {}).get("source") or "").strip() == "exec":
        return True
    return any(transcript_is_internal_codex_exec(path) for path in transcript_paths_for_session(codex_home, session_id, item))

def exact_reference_is_internal(session_id):
    for codex_home in codex_homes:
        if is_internal_codex_session(codex_home, session_id):
            return True
    return False

if mode == "--exact":
    exact_match = session_id_pattern.search(query)
    if not exact_match:
        sys.stdout.write(query)
        sys.exit(0)
    session_id = exact_match.group(0).lower()
    if exact_reference_is_internal(session_id):
        sys.exit(1)
    sys.stdout.write(session_id)
    sys.exit(0)

matches = []
for codex_home in codex_homes:
    index_path = codex_home / "session_index.jsonl"
    try:
        lines = index_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        continue
    for line in lines:
        try:
            item = json.loads(line)
        except Exception:
            continue
        if str(item.get("thread_name") or "").strip() != query:
            continue
        session_id = str(item.get("id") or "").strip()
        if not session_id:
            continue
        if is_internal_codex_session(codex_home, session_id, item):
            continue
        matches.append((str(item.get("updated_at") or ""), session_id))

if not matches:
    sys.exit(1)

matches.sort()
sys.stdout.write(matches[-1][1])
`;
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
  const startupText = normalizeStartupText(plan.startupText);
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

function normalizeStartupText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
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
