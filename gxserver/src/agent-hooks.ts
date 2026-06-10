import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  GxserverAgentHookStatusRow,
  GxserverInstallAgentHooksParams,
  GxserverInstallAgentHooksResult,
  GxserverReadAgentHookStatusParams,
  GxserverReadAgentHookStatusResult,
} from "../protocol/index.js";
import type { GxserverPaths } from "./paths.js";

const execFileAsync = promisify(execFile);
const NOTIFY_HOOK_MARKER = "ghostex-gxserver-agent-notify-hook-marker";
const NOTIFY_HOOK_VERSION = 4;
const MACOS_NOTIFY_HOOK_EXECUTION_XATTRS = ["com.apple.quarantine", "com.apple.provenance"] as const;
const OPENCODE_AGENT_ID = "opencode";
const OPENCODE_PLUGIN_MARKER = "ghostex-opencode-session-plugin-marker";
const OPENCODE_PLUGIN_SPEC = "./plugins/ghostex-session.js";
const AMP_PLUGIN_MARKER = "ghostex-amp-session-extension-marker";
const PI_EXTENSION_MARKER = "ghostex-pi-session-extension-marker";
const SHELL_PATH_SENTINEL = "__GHOSTEX_GXSERVER_SHELL_PATH__";
const GXSERVER_AGENT_HOOK_COLOR_DISABLING_ENVIRONMENT_KEYS = [
  "ANSI_COLORS_DISABLED",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
] as const;

type GxserverAgentHookFormat = "antigravity" | "flatJson" | "nestedJson" | "opencode" | "pluginFile" | "markedYaml";

interface GxserverAgentHookDefinition {
  agentId: string;
  cliCommand: string;
  commandAgent?: string;
  events?: readonly string[];
  format: GxserverAgentHookFormat;
  marker?: string;
  paths: (hookPaths: GxserverAgentHookPaths) => Promise<string[]> | string[];
}

type GxserverAgentHookInspection = {
  currentHookInstalled: boolean;
  ghostexHookPresent: boolean;
};

export interface GxserverAgentHookPaths {
  hookStateDirectory: string;
  homeDir: string;
  notifyHookPath: string;
  opencodeConfigPath: string;
  opencodePluginPath: string;
  piExtensionPath: string;
}

const HOOK_DEFINITIONS: readonly GxserverAgentHookDefinition[] = [
  {
    agentId: "codex",
    cliCommand: "codex",
    events: ["SessionStart", "UserPromptSubmit", "Stop", "Notification", "SessionEnd"],
    format: "nestedJson",
    paths: async (hookPaths) => [
      path.join(hookPaths.homeDir, ".codex", "hooks.json"),
      ...(await listCodexProfileHookPaths(hookPaths.homeDir)),
    ],
  },
  {
    agentId: "claude",
    cliCommand: "claude",
    events: ["SessionStart", "UserPromptSubmit"],
    format: "nestedJson",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".claude", "settings.json")],
  },
  {
    agentId: "cursor",
    cliCommand: "cursor-agent",
    commandAgent: "cursor",
    events: ["beforeSubmitPrompt", "beforeShellExecution", "afterAgentResponse", "stop"],
    format: "flatJson",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".cursor", "hooks.json")],
  },
  {
    agentId: "gemini",
    cliCommand: "gemini",
    commandAgent: "gemini",
    events: ["SessionStart", "BeforeAgent", "AfterAgent", "SessionEnd"],
    format: "nestedJson",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".gemini", "settings.json")],
  },
  {
    agentId: "copilot",
    cliCommand: "copilot",
    commandAgent: "copilot",
    events: ["SessionStart", "Stop", "Notification", "SessionEnd"],
    format: "nestedJson",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".copilot", "config.json")],
  },
  {
    agentId: "droid",
    cliCommand: "droid",
    commandAgent: "droid",
    events: ["SessionStart", "Stop", "Notification", "SessionEnd"],
    format: "nestedJson",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".factory", "settings.json")],
  },
  {
    agentId: "grok",
    cliCommand: "grok",
    commandAgent: "grok",
    events: ["SessionStart", "UserPromptSubmit", "Stop", "Notification", "SessionEnd"],
    format: "nestedJson",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".grok", "hooks", "ghostex-session.json")],
  },
  {
    agentId: "antigravity",
    cliCommand: "agy",
    commandAgent: "antigravity",
    events: ["SessionStart", "PreInvocation", "Stop", "turn-completion", "Notification", "SessionEnd"],
    format: "antigravity",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".gemini", "config", "hooks.json")],
  },
  {
    agentId: "amp",
    cliCommand: "amp",
    commandAgent: "amp",
    format: "pluginFile",
    marker: AMP_PLUGIN_MARKER,
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".config", "amp", "plugins", "ghostex-session.ts")],
  },
  {
    agentId: "pi",
    cliCommand: "pi",
    commandAgent: "pi",
    format: "pluginFile",
    marker: PI_EXTENSION_MARKER,
    paths: (hookPaths) => [hookPaths.piExtensionPath],
  },
  {
    agentId: "rovodev",
    cliCommand: "acli",
    commandAgent: "rovodev",
    format: "markedYaml",
    marker: "ghostex hooks rovodev begin",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".rovodev", "config.yml")],
  },
  {
    agentId: "hermes-agent",
    cliCommand: "hermes",
    commandAgent: "hermes-agent",
    format: "markedYaml",
    marker: "ghostex hooks hermes-agent begin",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".hermes", "config.yaml")],
  },
  {
    agentId: "codebuddy",
    cliCommand: "codebuddy",
    commandAgent: "codebuddy",
    events: ["SessionStart", "Stop", "Notification", "SessionEnd"],
    format: "nestedJson",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".codebuddy", "settings.json")],
  },
  {
    agentId: "qoder",
    cliCommand: "qodercli",
    commandAgent: "qoder",
    events: ["SessionStart", "Stop", "SessionEnd"],
    format: "nestedJson",
    paths: (hookPaths) => [path.join(hookPaths.homeDir, ".qoder", "settings.json")],
  },
  {
    agentId: OPENCODE_AGENT_ID,
    cliCommand: "opencode",
    commandAgent: OPENCODE_AGENT_ID,
    format: "opencode",
    marker: OPENCODE_PLUGIN_MARKER,
    paths: (hookPaths) => [hookPaths.opencodePluginPath, hookPaths.opencodeConfigPath],
  },
];

const HOOK_DEFINITIONS_BY_ID = new Map(HOOK_DEFINITIONS.map((definition) => [definition.agentId, definition]));

export function createGxserverAgentHookPaths(paths: Pick<GxserverPaths, "homeDir">): GxserverAgentHookPaths {
  const homeDir = paths.homeDir;
  return {
    hookStateDirectory: path.join(homeDir, ".ghostexterm"),
    homeDir,
    notifyHookPath: path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh"),
    opencodeConfigPath: path.join(homeDir, ".config", "opencode", "opencode.json"),
    opencodePluginPath: path.join(homeDir, ".config", "opencode", "plugins", "ghostex-session.js"),
    piExtensionPath: path.join(homeDir, ".pi", "agent", "extensions", "ghostex-session", "index.ts"),
  };
}

export async function readGxserverAgentHookStatus(
  paths: Pick<GxserverPaths, "homeDir">,
  params: GxserverReadAgentHookStatusParams = {},
): Promise<GxserverReadAgentHookStatusResult> {
  const hookPaths = createGxserverAgentHookPaths(paths);
  const result = await readRequestedHookRows(hookPaths, params.agentIds, {
    autoUpgradeInstalled: params.autoUpgradeInstalled !== false,
  });
  /*
  CDXC:AgentHooks 2026-06-07-13:05:
  First-time hook installation still requires the user to click Install Hooks,
  but existing Ghostex-owned hooks are an update surface, not a new permission.
  When gxserver can prove an older Ghostex hook is already installed, status
  reads auto-upgrade that artifact so app updates do not leave users with broken
  Codex hook exits or stale native/gxserver hook scripts.
  */
  return {
    agents: result.rows,
    ...(result.autoUpgradedPaths.length > 0 ? { autoUpgradedPaths: result.autoUpgradedPaths } : {}),
    generatedAt: new Date().toISOString(),
    hookStateDirectory: hookPaths.hookStateDirectory,
    notifyHookPath: hookPaths.notifyHookPath,
    type: "agentHookStatus",
  };
}

export async function installGxserverAgentHooks(
  paths: Pick<GxserverPaths, "homeDir">,
  params: GxserverInstallAgentHooksParams = {},
): Promise<GxserverInstallAgentHooksResult> {
  const hookPaths = createGxserverAgentHookPaths(paths);
  const agentIds = normalizeAgentIds(params.agentIds);
  const installedPaths: string[] = [];
  /*
  CDXC:AgentHooks 2026-06-07-08:31:
  Hook installation is an explicit user action from first-launch setup or Settings, but the installed artifacts and provider-specific merge rules are gxserver-owned so every client gets the same agent identity, first prompt, and activity lifecycle events instead of depending on macOS sidebar code.
  */
  await installNotifyHook(hookPaths);
  installedPaths.push(hookPaths.notifyHookPath);
  for (const agentId of agentIds) {
    const definition = HOOK_DEFINITIONS_BY_ID.get(agentId);
    if (!definition || !(await resolveCommandPath(definition.cliCommand, hookPaths.homeDir))) {
      continue;
    }
    installedPaths.push(...await installAgentHook(definition, hookPaths));
  }
  const status = await readGxserverAgentHookStatus(paths, { agentIds });
  return {
    ...status,
    installedPaths,
  };
}

export async function normalizeGxserverProcessPath(
  currentPath = process.env.PATH,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  /*
  CDXC:AgentCommandPath 2026-06-03-20:28:
  gxserver launches shared agent/tool integration checks after the native split.
  Merge the user's login-shell PATH with GUI/default entries so OpenCode,
  NVM/npm, mise/asdf, Homebrew, and ~/.opencode/bin installs are discovered
  without duplicating a divergent macOS-sidebar PATH policy.

  CDXC:AgentHooksColorEnv 2026-06-07-00:38:
  Agent hook probes and notifier helpers must not inherit NO_COLOR from gxserver or agent-provided overlays. Strip color-disabling keys before login-shell probes and generated hook subprocesses.
  */
  const sanitizedEnvironment = withoutGxserverAgentHookColorDisablingEnvironment(environment);
  const homeDir = sanitizedEnvironment.HOME || os.homedir();
  const shellEntries = await discoverLoginShellPathEntries(sanitizedEnvironment);
  const existingEntries = splitPath(currentPath);
  const defaultEntries = [
    path.join(homeDir, ".opencode", "bin"),
    path.join(homeDir, ".local", "share", "mise", "shims"),
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".asdf", "shims"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return uniquePathEntries([...shellEntries, ...existingEntries, ...defaultEntries]).join(":");
}

export async function discoverLoginShellPathEntries(environment: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const sanitizedEnvironment = withoutGxserverAgentHookColorDisablingEnvironment(environment);
  const configuredShell = String(sanitizedEnvironment.SHELL ?? "").trim();
  const candidates = configuredShell && configuredShell !== "/bin/zsh"
    ? [configuredShell, "/bin/zsh"]
    : [configuredShell || "/bin/zsh"];
  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) {
      continue;
    }
    const entries = await runLoginShellPathProbe(candidate, sanitizedEnvironment);
    if (entries.length > 0) {
      return entries;
    }
  }
  return [];
}

export function buildOpenCodePluginSource(notifyHookPath: string): string {
  return `// ${OPENCODE_PLUGIN_MARKER} v2
import { spawn } from "node:child_process";

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function withoutColorDisablingEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides };
  for (const key of ["ANSI_COLORS_DISABLED", "NO_COLOR", "NODE_DISABLE_COLORS"]) delete environment[key];
  return environment;
}

function props(event) {
  return (event && typeof event === "object" && event.properties) || {};
}

function sessionIdFor(event) {
  const p = props(event);
  return firstString(p.info && p.info.id, p.sessionID, p.sessionId, p.session_id, p.session && p.session.id, event && event.sessionID, event && event.sessionId, event && event.id);
}

function cwdFor(ctx, event) {
  const p = props(event);
  return firstString(p.info && p.info.directory, p.cwd, p.directory, ctx && ctx.directory, process.cwd());
}

function send(eventName, ctx, event) {
  if (process.env.GHOSTEX_OPENCODE_HOOKS_DISABLED === "1") return;
  const sessionId = sessionIdFor(event);
  if (!sessionId) return;
  const payload = {
    agent: "opencode",
    cwd: cwdFor(ctx, event),
    event: eventName,
    hook_event_name: eventName,
    session_id: sessionId,
  };
  try {
    const child = spawn(${JSON.stringify(notifyHookPath)}, [], { stdio: ["pipe", "ignore", "ignore"], env: withoutColorDisablingEnvironment({ GHOSTEX_AGENT: "opencode" }), detached: true });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
    child.unref();
  } catch (_) {}
}

export default async function ghostexSessionPlugin(ctx) {
  const bus = ctx && (ctx.bus || ctx.events || ctx.event);
  const on = bus && typeof bus.on === "function" ? bus.on.bind(bus) : ctx && typeof ctx.on === "function" ? ctx.on.bind(ctx) : null;
  if (on) {
    for (const eventName of ["session.start", "session.updated", "message.updated", "permission.updated"]) {
      on(eventName, (event) => send(eventName, ctx, event));
    }
    return {};
  }

  return {
    event: async ({ event }) => {
      send(event && event.type ? event.type : "event", ctx, event);
    },
  };
}
`;
}

async function readRequestedHookRows(
  hookPaths: GxserverAgentHookPaths,
  requestedAgentIds: readonly string[] | undefined,
  options: { autoUpgradeInstalled: boolean },
): Promise<{ autoUpgradedPaths: string[]; rows: GxserverAgentHookStatusRow[] }> {
  const agentIds = normalizeAgentIds(requestedAgentIds);
  const rows: GxserverAgentHookStatusRow[] = [];
  const autoUpgradedPaths = new Set<string>();
  for (const agentId of agentIds) {
    const definition = HOOK_DEFINITIONS_BY_ID.get(agentId);
    if (definition) {
      let row = await readHookStatus(definition, hookPaths);
      if (options.autoUpgradeInstalled && shouldAutoUpgradeInstalledHook(row)) {
        for (const upgradedPath of await autoUpgradeInstalledAgentHook(definition, hookPaths)) {
          autoUpgradedPaths.add(upgradedPath);
        }
        row = await readHookStatus(definition, hookPaths);
      }
      rows.push(row);
    }
  }
  return { autoUpgradedPaths: [...autoUpgradedPaths], rows };
}

function normalizeAgentIds(agentIds: readonly string[] | undefined): string[] {
  const known = new Set(HOOK_DEFINITIONS.map((definition) => definition.agentId));
  const normalized = (agentIds ?? HOOK_DEFINITIONS.map((definition) => definition.agentId))
    .map((agentId) => String(agentId).trim().toLowerCase())
    .filter(Boolean);
  const filtered = [...new Set(normalized)].filter((agentId) => known.has(agentId));
  return filtered.length > 0 ? filtered : HOOK_DEFINITIONS.map((definition) => definition.agentId);
}

async function readHookStatus(
  definition: GxserverAgentHookDefinition,
  hookPaths: GxserverAgentHookPaths,
): Promise<GxserverAgentHookStatusRow> {
  const cliInstalled = Boolean(await resolveCommandPath(definition.cliCommand, hookPaths.homeDir));
  const paths = await hookConfigPaths(definition, hookPaths);
  const hookInspection = await inspectAgentHookInstallation(definition, hookPaths, paths);
  const notifyHookCurrent = await isNotifyHookCurrent(hookPaths.notifyHookPath);
  const isInstalled = hookInspection.currentHookInstalled && notifyHookCurrent;
  const updateRequired = !isInstalled && hookInspection.ghostexHookPresent;
  if (!cliInstalled) {
    return {
      agentId: definition.agentId,
      cliCommand: definition.cliCommand,
      cliInstalled,
      detail: `${definition.cliCommand} was not found on PATH.`,
      hookInstalled: isInstalled,
      paths,
      status: "cliMissing",
    };
  }
  /*
  CDXC:AgentHooks 2026-06-07-11:05:
  Existing Ghostex hooks from the pre-gxserver installer should not be reported
  as absent. Mark them updateRequired so users see an upgrade/repair action,
  while the same install endpoint normalizes the provider config and shared
  notify script to the current gxserver ingest contract.
  */
  return {
    agentId: definition.agentId,
    cliCommand: definition.cliCommand,
    cliInstalled,
    detail: isInstalled
      ? `Installed in ${displayPath(paths[0] ?? hookPaths.notifyHookPath, hookPaths.homeDir)}`
      : updateRequired
        ? notifyHookCurrent
          ? `Run Update Hooks to repair ${displayPath(paths[0] ?? hookPaths.notifyHookPath, hookPaths.homeDir)}`
          : `Run Update Hooks to update ${displayPath(hookPaths.notifyHookPath, hookPaths.homeDir)}`
        : `Run Install Hooks to write ${displayPath(paths[0] ?? hookPaths.notifyHookPath, hookPaths.homeDir)}`,
    hookInstalled: isInstalled,
    paths,
    status: isInstalled ? "installed" : updateRequired ? "updateRequired" : "missing",
  };
}

function shouldAutoUpgradeInstalledHook(row: GxserverAgentHookStatusRow): boolean {
  return row.cliInstalled && row.status === "updateRequired";
}

async function autoUpgradeInstalledAgentHook(
  definition: GxserverAgentHookDefinition,
  hookPaths: GxserverAgentHookPaths,
): Promise<string[]> {
  try {
    const upgradedPaths = [hookPaths.notifyHookPath];
    await installNotifyHook(hookPaths);
    upgradedPaths.push(...await installAgentHook(definition, hookPaths));
    return upgradedPaths;
  } catch {
    return [];
  }
}

async function hookConfigPaths(definition: GxserverAgentHookDefinition, hookPaths: GxserverAgentHookPaths): Promise<string[]> {
  return typeof definition.paths === "function" ? await definition.paths(hookPaths) : definition.paths;
}

async function isNotifyHookCurrent(notifyHookPath: string): Promise<boolean> {
  const text = await readFileText(notifyHookPath);
  return text.includes(`${NOTIFY_HOOK_MARKER} v${NOTIFY_HOOK_VERSION}`);
}

async function inspectAgentHookInstallation(
  definition: GxserverAgentHookDefinition,
  hookPaths: GxserverAgentHookPaths,
  configPaths: readonly string[],
): Promise<GxserverAgentHookInspection> {
  if (definition.format === "opencode") {
    const pluginText = await readFileText(hookPaths.opencodePluginPath);
    const configText = await readFileText(hookPaths.opencodeConfigPath);
    const currentHookInstalled =
      pluginText.includes(currentPluginMarker(OPENCODE_PLUGIN_MARKER)) &&
      pluginText.includes(hookPaths.notifyHookPath);
    return {
      currentHookInstalled,
      ghostexHookPresent: currentHookInstalled ||
        pluginText.includes(OPENCODE_PLUGIN_MARKER) ||
        configText.includes(OPENCODE_PLUGIN_SPEC),
    };
  }
  if (definition.format === "pluginFile") {
    const marker = definition.marker;
    const text = await readFileText(configPaths[0] ?? "");
    const currentHookInstalled = Boolean(
      marker && text.includes(currentPluginMarker(marker)) && text.includes(hookPaths.notifyHookPath),
    );
    return {
      currentHookInstalled,
      ghostexHookPresent: currentHookInstalled ||
        Boolean(marker && text.includes(marker)) ||
        textContainsGhostexOwnedHookCommand(text),
    };
  }
  if (definition.format === "markedYaml") {
    const marker = definition.marker;
    const text = await readFileText(configPaths[0] ?? "");
    const currentHookInstalled = Boolean(marker && text.includes(marker) && text.includes(commandForAgent(definition, hookPaths.notifyHookPath)));
    return {
      currentHookInstalled,
      ghostexHookPresent: currentHookInstalled ||
        Boolean(marker && text.includes(marker)) ||
        textContainsGhostexOwnedHookCommand(text),
    };
  }
  if (definition.format === "antigravity") {
    const text = await readFileText(configPaths[0] ?? "");
    const currentHookInstalled = text.includes(commandForAgent(definition, hookPaths.notifyHookPath));
    return {
      currentHookInstalled,
      ghostexHookPresent: currentHookInstalled ||
        text.includes('"ghostex"') ||
        textContainsGhostexOwnedHookCommand(text),
    };
  }
  const command = commandForAgent(definition, hookPaths.notifyHookPath);
  const existingPaths = [];
  for (const configPath of configPaths) {
    if ((await readFileText(configPath)).trim()) {
      existingPaths.push(configPath);
    }
  }
  const pathsToCheck = definition.agentId === "codex" && existingPaths.length > 0 ? existingPaths : configPaths.slice(0, 1);
  if (pathsToCheck.length === 0) {
    return { currentHookInstalled: false, ghostexHookPresent: false };
  }
  const inspections = await Promise.all(pathsToCheck.map(async (configPath) => inspectJsonHookConfig(configPath, command)));
  return {
    currentHookInstalled:
      definition.agentId === "codex"
        ? inspections.every((inspection) => inspection.currentHookInstalled)
        : inspections.some((inspection) => inspection.currentHookInstalled),
    ghostexHookPresent: inspections.some((inspection) => inspection.ghostexHookPresent),
  };
}

async function installNotifyHook(hookPaths: GxserverAgentHookPaths): Promise<void> {
  await mkdir(path.dirname(hookPaths.notifyHookPath), { recursive: true });
  await writeExecutableNotifyHook(hookPaths.notifyHookPath, buildNotifyHookScript());
  await mkdir(hookPaths.hookStateDirectory, { recursive: true });
}

async function writeExecutableNotifyHook(filePath: string, contents: string): Promise<void> {
  /*
  CDXC:AgentHooks 2026-06-07-13:05:
  Rewriting the canonical notify hook path in place can preserve a macOS execution state that kills direct shebang execution with status 137. Write a fresh executable next to it and atomically rename it over the old path so explicit hook repair replaces the inode Codex executes.
  */
  const tempPath = path.join(path.dirname(filePath), `.agent-shell-notify.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, contents, "utf8");
    await chmod(tempPath, 0o755);
    await removeMacosNotifyHookExecutionAttributes(tempPath);
    await rename(tempPath, filePath);
    await chmod(filePath, 0o755);
    await removeMacosNotifyHookExecutionAttributes(filePath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // The temp file may already have been renamed over the target.
    }
    throw error;
  }
}

async function removeMacosNotifyHookExecutionAttributes(filePath: string): Promise<void> {
  /*
  CDXC:AgentHooks 2026-06-07-13:05:
  macOS can preserve com.apple.provenance or quarantine metadata when gxserver rewrites the existing shared notify hook. Codex executes the hook path directly, so gxserver strips those execution-blocking attributes after every explicit hook install or repair instead of relying on users to remove them manually.
  */
  if (process.platform !== "darwin") {
    return;
  }
  await Promise.all(MACOS_NOTIFY_HOOK_EXECUTION_XATTRS.map(async (attribute) => {
    try {
      await execFileAsync("/usr/bin/xattr", ["-d", attribute, filePath]);
    } catch {
      // Attribute absence is the normal case on fresh installs.
    }
  }));
}

async function installAgentHook(
  definition: GxserverAgentHookDefinition,
  hookPaths: GxserverAgentHookPaths,
): Promise<string[]> {
  if (definition.format === "opencode") {
    await installOpenCodeHook(hookPaths);
    return [hookPaths.opencodePluginPath];
  }
  const configPaths = await hookConfigPaths(definition, hookPaths);
  const command = commandForAgent(definition, hookPaths.notifyHookPath);
  if (definition.format === "pluginFile") {
    const configPath = configPaths[0];
    if (!configPath) return [];
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      definition.agentId === "amp" ? buildAmpPluginSource(hookPaths.notifyHookPath) : buildPiExtensionSource(hookPaths.notifyHookPath),
      "utf8",
    );
    return [configPath];
  }
  if (definition.format === "markedYaml") {
    const configPath = configPaths[0];
    if (!configPath) return [];
    await installMarkedYamlHook(configPath, definition.agentId, command);
    return [configPath];
  }
  const installedPaths: string[] = [];
  for (const configPath of configPaths) {
    await mergeJsonHook(configPath, definition, command);
    installedPaths.push(configPath);
  }
  return installedPaths;
}

function commandForAgent(definition: GxserverAgentHookDefinition, notifyHookPath: string): string {
  return definition.commandAgent ? `GHOSTEX_AGENT=${shellQuote(definition.commandAgent)} ${shellQuote(notifyHookPath)}` : notifyHookPath;
}

async function mergeJsonHook(configPath: string, definition: GxserverAgentHookDefinition, command: string): Promise<void> {
  const data = readJsonObject(await readFileText(configPath));
  if (definition.format === "antigravity") {
    data.ghostex = Object.fromEntries(
      (definition.events ?? []).map((eventName) => [eventName, [{ type: "command", command, timeout: 5 }]]),
    );
  } else if (definition.format === "flatJson") {
    const hooks = ensureObjectProperty(data, "hooks");
    data.version = data.version || 1;
    for (const eventName of definition.events ?? []) {
      const entries = Array.isArray(hooks[eventName]) ? hooks[eventName] as unknown[] : [];
      hooks[eventName] = mergeFlatHookEntries(entries, command);
    }
  } else {
    const hooks = ensureObjectProperty(data, "hooks");
    for (const eventName of definition.events ?? []) {
      const groups = Array.isArray(hooks[eventName]) ? hooks[eventName] as unknown[] : [];
      const nextGroups = mergeNestedHookGroups(groups, command);
      if (!nextGroups.some((group) => groupContainsHookCommand(group, command))) {
        const nextGroup: Record<string, unknown> = {
          hooks: [{ type: "command", command, ...(definition.commandAgent ? { timeout: 5000 } : {}) }],
        };
        if (definition.agentId === "claude") {
          nextGroup.matcher = "*";
        }
        nextGroups.push(nextGroup);
      }
      hooks[eventName] = nextGroups;
    }
  }
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function mergeFlatHookEntries(entries: readonly unknown[], command: string): unknown[] {
  const nextEntries: unknown[] = [];
  let hasCurrentCommand = false;
  for (const entry of entries) {
    if (isHookCommand(entry, command)) {
      if (!hasCurrentCommand) {
        nextEntries.push(entry);
        hasCurrentCommand = true;
      }
      continue;
    }
    if (!isGhostexOwnedHookCommand(entry, command)) {
      nextEntries.push(entry);
    }
  }
  if (!hasCurrentCommand) {
    nextEntries.push({ command });
  }
  return nextEntries;
}

function mergeNestedHookGroups(groups: readonly unknown[], command: string): unknown[] {
  const nextGroups: unknown[] = [];
  let hasCurrentCommand = false;
  for (const group of groups) {
    if (!isObject(group) || !Array.isArray(group.hooks)) {
      nextGroups.push(group);
      continue;
    }
    const nextHooks: unknown[] = [];
    for (const hook of group.hooks) {
      if (isHookCommand(hook, command)) {
        if (!hasCurrentCommand) {
          nextHooks.push(hook);
          hasCurrentCommand = true;
        }
        continue;
      }
      if (!isGhostexOwnedHookCommand(hook, command)) {
        nextHooks.push(hook);
      }
    }
    if (nextHooks.length > 0) {
      nextGroups.push({ ...group, hooks: nextHooks });
    }
  }
  return nextGroups;
}

async function installMarkedYamlHook(configPath: string, agentId: string, command: string): Promise<void> {
  const beginMarker = `# ghostex hooks ${agentId} begin`;
  const endMarker = `# ghostex hooks ${agentId} end`;
  const currentLines = (await readFileText(configPath)).split(/\r?\n/u);
  const lines = withoutMarkedBlock(currentLines, beginMarker, endMarker);
  if (lines.length > 0 && lines[lines.length - 1]?.trim()) {
    lines.push("");
  }
  if (agentId === "hermes-agent") {
    const shellCommand = `sh -c ${shellQuote(command)}`;
    lines.push(
      beginMarker,
      "hooks:",
      ...["on_session_start", "pre_llm_call", "post_llm_call", "on_session_end", "on_session_finalize", "on_session_reset"]
        .flatMap((eventName) => [`  ${eventName}:`, `    - command: ${yamlDoubleQuote(shellCommand)}`, "      timeout: 5"]),
      endMarker,
    );
  } else {
    lines.push(
      beginMarker,
      "eventHooks:",
      "  events:",
      ...["on_complete", "on_error", "on_tool_permission"].flatMap((eventName) => [
        `    - name: ${eventName}`,
        "      commands:",
        `        - command: ${yamlDoubleQuote(command)}`,
      ]),
      endMarker,
    );
  }
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${lines.join("\n").replace(/\n*$/u, "")}\n`, "utf8");
}

function withoutMarkedBlock(lines: readonly string[], beginMarker: string, endMarker: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== beginMarker) {
      result.push(lines[index] ?? "");
      continue;
    }
    while (index < lines.length && lines[index]?.trim() !== endMarker) {
      index += 1;
    }
  }
  while (result.length > 0 && !result[result.length - 1]?.trim()) {
    result.pop();
  }
  return result;
}

function buildNotifyHookScript(): string {
  /*
  CDXC:AgentHooks 2026-06-07-13:05:
  Codex can invoke SessionStart and UserPromptSubmit close together and may keep hook stdin open during some phases. The shared gxserver notify hook must never block on shell cat or expose internal state-store write races as hook stderr; it uses a bounded shell read for one-line JSON payloads and per-process temp files for concurrent status/store updates.

  CDXC:AgentHooks 2026-06-07-13:05:
  The notify hook artifact version must change when runtime behavior changes, not only when provider config shape changes. Users with pre-fix v2 hooks need gxserver status to report updateRequired so the explicit Install/Update Hooks action repairs broken Codex hook exits instead of silently treating the old script as current.

  CDXC:AgentHooks 2026-06-10-18:17:
  Installed runtime hooks must use Ghostex's bundled code-server Node from gxserver's `process.execPath`, not `/usr/bin/python3` or any user-installed interpreter. Embedding the app-owned Node path keeps hook status sidecars available on machines without Python.
  */
  const nodeCommand = `${shellQuote(process.execPath)} --no-warnings`;
  return `#!/bin/bash
# ${NOTIFY_HOOK_MARKER} v${NOTIFY_HOOK_VERSION}
if [ -n "\${1:-}" ]; then
  INPUT_ARG="$1"
else
  INPUT_ARG=""
  IFS= read -r -t 1 INPUT_ARG || true
fi

SESSION_STATE_FILE="\${VSMUX_SESSION_STATE_FILE:-\${GHOSTEX_SESSION_STATE_FILE:-$ghostex_SESSION_STATE_FILE}}"
HOOK_STATE_DIR="\${GHOSTEX_AGENT_HOOK_STATE_DIR:-$HOME/.ghostexterm}"
if [ "\${GHOSTEX_INTERNAL_PROMPT_GENERATION:-}" = "1" ] || [ "\${GHOSTEX_INTERNAL_TITLE_GENERATION:-}" = "1" ]; then
  printf '{"continue":true}'
  exit 0
fi
if [ -z "$SESSION_STATE_FILE" ] && { [ -z "\${GHOSTEX_GLOBAL_SESSION_REF:-}" ] || [ -z "\${GHOSTEX_GXSERVER_BASE_URL:-}" ] || [ -z "\${GHOSTEX_GXSERVER_AUTH_TOKEN_FILE:-}" ]; }; then
  printf '{"continue":true}'
  exit 0
fi

${nodeCommand} - "$SESSION_STATE_FILE" "$INPUT_ARG" "$HOOK_STATE_DIR" 2>/dev/null <<'JS'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const statePath = String(process.argv[2] || "");
const inputArg = String(process.argv[3] || "");
const hookStateDir = expandHome(String(process.argv[4] || path.join(os.homedir(), ".ghostexterm")));
const hasStatePath = Boolean(statePath.trim());
const state = {};

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().split(/\\s+/u).join(" ");
    }
  }
  return "";
}

function firstPath(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function expandHome(value) {
  if (value === "~") {
    return os.homedir();
  }
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function readHookInput(argument) {
  return Promise.resolve(String(argument || ""));
}

function readState() {
  if (!hasStatePath) {
    return;
  }
  let text;
  try {
    text = fs.readFileSync(statePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\\r?\\n/u)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    state[key] = key === "firstUserMessageBase64" || key === "agentSessionPath" ? value.trim() : firstString(value);
  }
}

function decodeBase64Text(value) {
  try {
    return Buffer.from(String(value || ""), "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function normalizePromptText(value) {
  return String(value || "").trim().split(/\\s+/u).filter(Boolean).join(" ");
}

function normalizedAgentKey(value) {
  const normalized = normalizePromptText(String(value || "").toLowerCase());
  const aliases = {
    "claude": "claude",
    "claude code": "claude",
    "codex": "codex",
    "openai codex": "codex",
    "codex cli": "codex",
    "pi": "pi",
    "π": "pi",
    "opencode": "opencode",
    "open code": "opencode",
    "grok": "grok",
    "grok build": "grok",
    "amp": "amp",
    "amp cli": "amp",
    "cursor": "cursor",
    "cursor agent": "cursor",
    "cursor cli": "cursor",
    "cursor-agent": "cursor",
    "gemini": "gemini",
    "gemini cli": "gemini",
    "agy": "antigravity",
    "antigravity": "antigravity",
    "antigravity cli": "antigravity",
    "copilot": "copilot",
    "github copilot": "copilot",
    "codebuddy": "codebuddy",
    "code buddy": "codebuddy",
    "droid": "droid",
    "factory": "droid",
    "factory droid": "droid",
    "qoder": "qoder",
    "qodercli": "qoder",
    "rovo": "rovodev",
    "rovo dev": "rovodev",
    "rovodev": "rovodev",
    "hermes": "hermes-agent",
    "hermes agent": "hermes-agent",
    "hermes-agent": "hermes-agent",
  };
  return aliases[normalized] || normalized.replace(/[^a-z0-9_-]+/gu, "-").replace(/^-|-$/gu, "") || "codex";
}

function nestedGet(source, ...keys) {
  let current = source;
  for (const key of keys) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function parseGlobalSessionRef(value) {
  const parts = String(value || "").trim().split(":");
  return parts.length === 3 && parts[1] && parts[2] ? [parts[1], parts[2]] : ["", ""];
}

function nowIso() {
  return new Date().toISOString();
}

function tempPathFor(filePath) {
  return path.join(path.dirname(filePath), "." + path.basename(filePath) + "." + process.pid + "." + Date.now() + "." + Math.random().toString(16).slice(2) + ".tmp");
}

function writeState() {
  if (!hasStatePath) {
    return;
  }
  const keys = [
    "status",
    "statusUpdatedAt",
    "attentionEventId",
    "attentionAcknowledgedAt",
    "attentionAcknowledgedEventId",
    "agent",
    "agentSessionId",
    "agentSessionPath",
    "firstUserMessageBase64",
    "frozenAt",
    "autoTitleFromFirstPrompt",
    "historyBase64",
    "lastActivityAt",
    "pendingFirstPromptAutoRenamePrompt",
    "title",
  ];
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tempPath = tempPathFor(statePath);
    fs.writeFileSync(tempPath, keys.map((key) => key + "=" + (state[key] || "")).join("\\n") + "\\n", "utf8");
    fs.renameSync(tempPath, statePath);
  } catch {}
}

function writeHookStore(agentKey, sessionId, transcriptPath, payload) {
  let workspaceId = firstString(process.env.GHOSTEX_WORKSPACE_ID, process.env.VSMUX_WORKSPACE_ID, process.env.ghostex_WORKSPACE_ID);
  let surfaceId = firstString(process.env.GHOSTEX_SESSION_ID, process.env.VSMUX_SESSION_ID, process.env.ghostex_SESSION_ID);
  if (!workspaceId || !surfaceId) {
    const [directProjectId, directSessionId] = parseGlobalSessionRef(process.env.GHOSTEX_GLOBAL_SESSION_REF || "");
    workspaceId = workspaceId || directProjectId;
    surfaceId = surfaceId || directSessionId;
  }
  if (!sessionId || !workspaceId || !surfaceId) {
    return;
  }
  const storePath = path.join(hookStateDir, agentKey + "-hook-sessions.json");
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {}
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    data = {};
  }
  const sessions = data.sessions && typeof data.sessions === "object" && !Array.isArray(data.sessions) ? data.sessions : {};
  sessions[sessionId] = {
    sessionId,
    workspaceId,
    surfaceId,
    cwd: firstPath(payload.cwd, process.env.GHOSTEX_WORKSPACE_ROOT, process.env.VSMUX_WORKSPACE_ROOT, process.cwd()),
    transcriptPath: transcriptPath || null,
    pid: process.ppid,
    isRestorable: true,
    updatedAt: Date.now() / 1000,
  };
  data.version = 1;
  data.sessions = sessions;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const tempPath = tempPathFor(storePath);
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\\n", "utf8");
    fs.renameSync(tempPath, storePath);
  } catch {}
}

function readGxserverAuthToken() {
  const tokenFile = firstPath(process.env.GHOSTEX_GXSERVER_AUTH_TOKEN_FILE);
  if (!tokenFile) {
    return "";
  }
  try {
    return fs.readFileSync(expandHome(tokenFile), "utf8").trim();
  } catch {
    return "";
  }
}

async function postGxserverHookEvent(agentKey, sessionId, transcriptPath, firstUserMessage, eventName) {
  const baseUrl = firstString(process.env.GHOSTEX_GXSERVER_BASE_URL).replace(/\\/+$/u, "");
  const [projectId, surfaceId] = parseGlobalSessionRef(process.env.GHOSTEX_GLOBAL_SESSION_REF || "");
  const token = readGxserverAuthToken();
  if (!baseUrl || !projectId || !surfaceId || !token || typeof fetch !== "function") {
    return;
  }
  const protocolVersion = Number.parseInt(firstString(process.env.GHOSTEX_GXSERVER_PROTOCOL_VERSION, "1"), 10) || 1;
  const params = {
    agentName: agentKey,
    eventName,
    projectId,
    rawEventName: eventName,
    sessionId: surfaceId,
  };
  for (const [key, value] of Object.entries({
    agentSessionId: sessionId,
    agentSessionPath: transcriptPath,
    firstUserMessage,
    status: state.status || "",
    statusUpdatedAt: state.statusUpdatedAt || "",
    title: state.title || "",
  })) {
    if (value) {
      params[key] = value;
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(baseUrl + "/api/ingestAgentHookEvent", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "x-gxserver-protocol-version": String(protocolVersion),
      },
      body: JSON.stringify({ protocolVersion, params }),
      signal: controller.signal,
    });
    await response.arrayBuffer();
  } catch {
  } finally {
    clearTimeout(timer);
  }
}

function updateStatus(status) {
  const timestamp = nowIso();
  state.status = status;
  state.statusUpdatedAt = timestamp;
  state.lastActivityAt = timestamp;
  if (status === "attention") {
    state.attentionEventId = timestamp + ":attention";
    state.attentionAcknowledgedAt = "";
    state.attentionAcknowledgedEventId = "";
  } else if (status === "working") {
    state.attentionAcknowledgedAt = timestamp;
    state.attentionAcknowledgedEventId = state.attentionEventId || "";
  }
}

async function main() {
  const rawInput = await readHookInput(inputArg);
  let payload = {};
  try {
    payload = JSON.parse(rawInput);
  } catch {}
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    payload = {};
  }
  readState();

  const explicitAgentName = firstString(payload.agent, process.env.GHOSTEX_AGENT, process.env.ghostex_AGENT);
  const agentName = firstString(explicitAgentName, process.env.VSMUX_AGENT, state.agent, "codex");
  const agentKey = normalizedAgentKey(agentName);
  const eventName = firstString(payload.hook_event_name, payload.event);
  const sessionId = firstString(
    payload.session_id,
    payload.sessionId,
    payload.conversation_id,
    payload.conversationId,
    payload.thread_id,
    payload.threadId,
    nestedGet(payload, "session", "id"),
    nestedGet(payload, "thread", "id"),
    nestedGet(payload, "properties", "sessionID"),
    nestedGet(payload, "properties", "sessionId"),
    nestedGet(payload, "properties", "session_id"),
    nestedGet(payload, "properties", "info", "id"),
  );
  const transcriptPath = firstPath(payload.transcript_path, payload.transcriptPath, payload.log_path, payload.logPath);
  const prompt = firstString(payload.prompt, payload.text, payload.message, payload.input, nestedGet(payload, "prompt", "text"));

  state.status = state.status || "idle";
  state.statusUpdatedAt = state.statusUpdatedAt || state.lastActivityAt || "";
  state.agent = explicitAgentName ? agentKey : (state.agent || agentKey);
  if (sessionId) {
    state.agentSessionId = sessionId;
  }
  if (transcriptPath) {
    state.agentSessionPath = transcriptPath;
  }
  if (sessionId) {
    writeHookStore(agentKey, sessionId, transcriptPath, payload);
  }

  const workingEvents = new Set(["UserPromptSubmit", "BeforeAgent", "PreInvocation", "beforeSubmitPrompt", "beforeShellExecution", "pre_llm_call", "pre_tool_call", "agent_start"]);
  const attentionEvents = new Set(["Stop", "AfterAgent", "afterAgentResponse", "turn-completion", "Notification", "stop", "on_tool_permission", "PermissionRequest", "agent_end", "session.updated", "message.updated", "permission.updated"]);
  const idleEvents = new Set(["SessionEnd", "session_shutdown", "release", "on_session_end", "on_session_finalize", "on_session_reset"]);
  if (workingEvents.has(eventName)) {
    updateStatus("working");
  } else if (attentionEvents.has(eventName)) {
    updateStatus("attention");
  } else if (idleEvents.has(eventName)) {
    updateStatus("idle");
  }

  const promptEvents = new Set(["UserPromptSubmit", "BeforeAgent", "PreInvocation", "beforeSubmitPrompt", "beforeShellExecution", "pre_llm_call", "pre_tool_call", "on_tool_permission", "agent_start"]);
  if (promptEvents.has(eventName) && prompt) {
    state.firstUserMessageBase64 = state.firstUserMessageBase64 || Buffer.from(prompt, "utf8").toString("base64");
    state.lastActivityAt = state.lastActivityAt || nowIso();
    if (!["claude", "cursor"].includes(agentKey) && !["1", "true", "TRUE", "True"].includes(state.autoTitleFromFirstPrompt || "") && !String(state.pendingFirstPromptAutoRenamePrompt || "").trim()) {
      const firstPrompt = normalizePromptText(decodeBase64Text(state.firstUserMessageBase64 || ""));
      const currentPrompt = normalizePromptText(prompt);
      state.pendingFirstPromptAutoRenamePrompt = firstPrompt && firstPrompt !== currentPrompt ? normalizePromptText(firstPrompt + "\\n" + currentPrompt) : currentPrompt;
    }
  }

  const firstUserMessage = firstString(state.pendingFirstPromptAutoRenamePrompt, decodeBase64Text(state.firstUserMessageBase64 || ""), prompt);
  await postGxserverHookEvent(agentKey, sessionId, transcriptPath, firstUserMessage, eventName);
  writeState();
}

main().catch(() => {});
JS

printf '{"continue":true}'
exit 0
`;
}

function buildAmpPluginSource(notifyHookPath: string): string {
  return `// ${AMP_PLUGIN_MARKER} v2
import { spawn } from "node:child_process";

function sendHook(eventName: string, event: any = {}, ctx: any = {}) {
  const payload = {
    agent: "amp",
    cwd: ctx.cwd || process.cwd(),
    event: eventName,
    hook_event_name: eventName,
    prompt: event.prompt || event.text || event.message,
    session_id: event.session_id || event.sessionId || event.thread_id || event.threadId,
  };
  const child = spawn(${JSON.stringify(notifyHookPath)}, [], { stdio: ["pipe", "ignore", "ignore"], env: { ...process.env, GHOSTEX_AGENT: "amp" }, detached: true });
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(payload));
  child.unref();
}

export default function ghostexAmpSessionPlugin(amp: any) {
  amp.on("agent.start", async (event: any, ctx: any) => sendHook("UserPromptSubmit", event, ctx));
  amp.on("agent.stop", async (event: any, ctx: any) => sendHook("Stop", event, ctx));
  amp.on("session.end", async (event: any, ctx: any) => sendHook("SessionEnd", event, ctx));
}
`;
}

function buildPiExtensionSource(notifyHookPath: string): string {
  return `// ${PI_EXTENSION_MARKER} v2
import { spawn } from "node:child_process";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";

const BRAILLE_FRAMES = ["⠸", "⠴", "⠼", "⠧", "⠦", "⠏", "⠋", "⠇", "⠙", "⠹"] as const;

function sendHook(eventName: string, ctx: ExtensionContext, input?: string): void {
  const payload = {
    agent: "pi",
    cwd: ctx.cwd || process.cwd(),
    event: eventName,
    hook_event_name: eventName,
    prompt: input,
    session_id: ctx.sessionManager.getSessionId() || undefined,
    transcript_path: ctx.sessionManager.getSessionFile() || undefined,
  };
  const child = spawn(${JSON.stringify(notifyHookPath)}, [], { stdio: ["pipe", "ignore", "ignore"], env: { ...process.env, GHOSTEX_AGENT: "pi" }, detached: true });
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(payload));
  child.unref();
}

function baseTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const cwd = path.basename(ctx.cwd || process.cwd());
  const session = pi.getSessionName();
  return session ? "π - " + session + " - " + cwd : "π - " + cwd;
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let frameIndex = 0;
  function stopAnimation(ctx: ExtensionContext): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    frameIndex = 0;
    ctx.ui.setTitle(baseTitle(pi, ctx));
  }
  function startAnimation(ctx: ExtensionContext): void {
    stopAnimation(ctx);
    timer = setInterval(() => {
      ctx.ui.setTitle(BRAILLE_FRAMES[frameIndex % BRAILLE_FRAMES.length] + " " + baseTitle(pi, ctx));
      frameIndex += 1;
    }, 120);
  }
  pi.on("session_start", async (_event, ctx) => {
    sendHook("SessionStart", ctx);
    ctx.ui.setTitle(baseTitle(pi, ctx));
  });
  pi.on("input", async (event: InputEvent, ctx) => {
    sendHook("UserPromptSubmit", ctx, event.text.trim());
    return { action: "continue" };
  });
  pi.on("agent_start", async (_event, ctx) => {
    sendHook("agent_start", ctx);
    startAnimation(ctx);
  });
  pi.on("agent_end", async (_event, ctx) => {
    sendHook("agent_end", ctx);
    stopAnimation(ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    sendHook("session_shutdown", ctx);
    stopAnimation(ctx);
  });
}
`;
}

async function installOpenCodeHook(hookPaths: GxserverAgentHookPaths): Promise<void> {
  const cliPath = await resolveCommandPath("opencode", hookPaths.homeDir);
  if (!cliPath) {
    return;
  }
  await mkdir(path.dirname(hookPaths.opencodePluginPath), { recursive: true });
  await writeFile(hookPaths.opencodePluginPath, buildOpenCodePluginSource(hookPaths.notifyHookPath), "utf8");
  await removeLegacyOpenCodeConfigPluginEntry(hookPaths.opencodeConfigPath);
}

async function removeLegacyOpenCodeConfigPluginEntry(configPath: string): Promise<void> {
  const text = await readFileText(configPath);
  if (!text.trim()) {
    return;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return;
  }
  if (!isObject(data)) {
    return;
  }
  const plugins = data.plugin;
  if (!Array.isArray(plugins) || !plugins.includes(OPENCODE_PLUGIN_SPEC)) {
    return;
  }
  const nextPlugins = plugins.filter((plugin) => plugin !== OPENCODE_PLUGIN_SPEC);
  if (nextPlugins.length > 0) {
    data.plugin = nextPlugins;
  } else {
    delete data.plugin;
  }
  await writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function listCodexProfileHookPaths(homeDir: string): Promise<string[]> {
  const profilesPath = path.join(homeDir, ".codex-profiles");
  const entries = await readdir(profilesPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(profilesPath, entry.name, "hooks.json"))
    .sort();
}

async function inspectJsonHookConfig(configPath: string, command: string): Promise<GxserverAgentHookInspection> {
  const data = readJsonObject(await readFileText(configPath));
  return {
    currentHookInstalled: jsonContainsHookCommand(data, command),
    ghostexHookPresent: jsonContainsGhostexOwnedHookCommand(data, command),
  };
}

function jsonContainsHookCommand(value: unknown, command: string): boolean {
  if (isHookCommand(value, command)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => jsonContainsHookCommand(item, command));
  }
  if (isObject(value)) {
    return Object.values(value).some((item) => jsonContainsHookCommand(item, command));
  }
  return false;
}

function jsonContainsGhostexOwnedHookCommand(value: unknown, command: string): boolean {
  if (isGhostexOwnedHookCommand(value, command)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => jsonContainsGhostexOwnedHookCommand(item, command));
  }
  if (isObject(value)) {
    return Object.values(value).some((item) => jsonContainsGhostexOwnedHookCommand(item, command));
  }
  return false;
}

function groupContainsHookCommand(group: unknown, command: string): boolean {
  if (!isObject(group) || !Array.isArray(group.hooks)) {
    return false;
  }
  return group.hooks.some((hook) => isHookCommand(hook, command));
}

function isHookCommand(value: unknown, command: string): boolean {
  return isObject(value) && value.command === command;
}

function isGhostexOwnedHookCommand(value: unknown, command: string): boolean {
  if (!isObject(value) || typeof value.command !== "string") {
    return false;
  }
  return value.command === command || textContainsGhostexOwnedHookCommand(value.command);
}

function textContainsGhostexOwnedHookCommand(text: string): boolean {
  /*
  CDXC:AgentHooks 2026-06-07-11:05:
  Hook repair must remove old Ghostex-owned hook commands without touching user
  hooks. Match only durable Ghostex hook artifacts from native and gxserver
  installers, then rewrite the current command through the same provider merge.
  */
  const normalized = text.toLowerCase();
  return (
    normalized.includes("agent-shell-notify") ||
    normalized.includes(".ghostex/hooks") ||
    normalized.includes(".ghostexterm") ||
    normalized.includes("ghostex_notify_hook") ||
    normalized.includes("ghostex-agent-notify") ||
    normalized.includes("ghostex-session-plugin-marker") ||
    normalized.includes("ghostex-session-extension-marker")
  );
}

function currentPluginMarker(marker: string): string {
  return `${marker} v2`;
}

function readJsonObject(text: string): Record<string, unknown> {
  if (!text.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ensureObjectProperty(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (isObject(value)) {
    return value;
  }
  const next: Record<string, unknown> = {};
  record[key] = next;
  return next;
}

async function resolveCommandPath(command: string, homeDir: string): Promise<string> {
  const commandEnvironment = withoutGxserverAgentHookColorDisablingEnvironment({
    ...process.env,
    HOME: homeDir,
  });
  const pathValue = await normalizeGxserverProcessPath(process.env.PATH, commandEnvironment);
  /*
  CDXC:AgentHooks 2026-06-07-11:05:
  Command resolution already merges login-shell PATH entries in
  normalizeGxserverProcessPath. Run the final command-v probe as a non-login
  shell so /etc zprofile or user startup files cannot overwrite the normalized
  PATH and make installed hook-capable CLIs look missing.
  */
  const { stdout } = await execFileAsync("/bin/zsh", ["-c", `command -v -- ${shellQuote(command)}`], {
    env: {
      ...commandEnvironment,
      PATH: pathValue,
    },
    timeout: 2_000,
  }).catch(() => ({ stdout: "" }));
  return String(stdout).trim().split(/\r?\n/u)[0] ?? "";
}

async function runLoginShellPathProbe(shellPath: string, environment: NodeJS.ProcessEnv): Promise<string[]> {
  const { stdout } = await execFileAsync(
    shellPath,
    ["-ilc", `printf '\\n${SHELL_PATH_SENTINEL}%s\\n' "$PATH"`],
    {
      env: withoutGxserverAgentHookColorDisablingEnvironment(environment),
      timeout: 2_000,
    },
  ).catch(() => ({ stdout: "" }));
  const sentinelLine = String(stdout)
    .split(/\r?\n/u)
    .reverse()
    .find((line) => line.startsWith(SHELL_PATH_SENTINEL));
  return sentinelLine ? splitPath(sentinelLine.slice(SHELL_PATH_SENTINEL.length)) : [];
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readFileText(filePath: string): Promise<string> {
  if (!filePath) {
    return "";
  }
  return readFile(filePath, "utf8").catch(() => "");
}

function splitPath(value: string | undefined): string[] {
  return String(value ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function withoutGxserverAgentHookColorDisablingEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  for (const key of GXSERVER_AGENT_HOOK_COLOR_DISABLING_ENVIRONMENT_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

function uniquePathEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function displayPath(filePath: string, homeDir: string): string {
  return filePath.startsWith(`${homeDir}${path.sep}`)
    ? `~/${path.relative(homeDir, filePath)}`
    : filePath;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function yamlDoubleQuote(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n")}"`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
