import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
const OPENCODE_AGENT_ID = "opencode";
const OPENCODE_PLUGIN_MARKER = "ghostex-opencode-session-plugin-marker";
const OPENCODE_PLUGIN_SPEC = "./plugins/ghostex-session.js";
const SHELL_PATH_SENTINEL = "__GHOSTEX_GXSERVER_SHELL_PATH__";
const GXSERVER_AGENT_HOOK_COLOR_DISABLING_ENVIRONMENT_KEYS = [
  "ANSI_COLORS_DISABLED",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
] as const;

export interface GxserverAgentHookPaths {
  hookStateDirectory: string;
  homeDir: string;
  notifyHookPath: string;
  opencodeConfigPath: string;
  opencodePluginPath: string;
}

export function createGxserverAgentHookPaths(paths: Pick<GxserverPaths, "homeDir">): GxserverAgentHookPaths {
  const homeDir = paths.homeDir;
  return {
    hookStateDirectory: path.join(homeDir, ".ghostexterm"),
    homeDir,
    notifyHookPath: path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh"),
    opencodeConfigPath: path.join(homeDir, ".config", "opencode", "opencode.json"),
    opencodePluginPath: path.join(homeDir, ".config", "opencode", "plugins", "ghostex-session.js"),
  };
}

export async function readGxserverAgentHookStatus(
  paths: Pick<GxserverPaths, "homeDir">,
  params: GxserverReadAgentHookStatusParams = {},
): Promise<GxserverReadAgentHookStatusResult> {
  const hookPaths = createGxserverAgentHookPaths(paths);
  return {
    agents: await readRequestedHookRows(hookPaths, params.agentIds),
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
  if (agentIds.includes(OPENCODE_AGENT_ID)) {
    /*
    CDXC:AgentHooks 2026-06-03-20:28:
    Nightly moved agent integration ownership toward gxserver. Keep OpenCode's
    plugin marker detection, plugin write/update, and old opencode.json cleanup
    in gxserver so the macOS sidebar only requests status/install results.
    */
    await installOpenCodeHook(hookPaths);
    installedPaths.push(hookPaths.opencodePluginPath);
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
  return `// ${OPENCODE_PLUGIN_MARKER} v1
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
): Promise<GxserverAgentHookStatusRow[]> {
  const agentIds = normalizeAgentIds(requestedAgentIds);
  const rows: GxserverAgentHookStatusRow[] = [];
  if (agentIds.includes(OPENCODE_AGENT_ID)) {
    rows.push(await readOpenCodeHookStatus(hookPaths));
  }
  return rows;
}

function normalizeAgentIds(agentIds: readonly string[] | undefined): string[] {
  const normalized = (agentIds ?? [OPENCODE_AGENT_ID])
    .map((agentId) => String(agentId).trim().toLowerCase())
    .filter(Boolean);
  return normalized.length > 0
    ? [...new Set(normalized)].filter((agentId) => agentId === OPENCODE_AGENT_ID)
    : [OPENCODE_AGENT_ID];
}

async function readOpenCodeHookStatus(hookPaths: GxserverAgentHookPaths): Promise<GxserverAgentHookStatusRow> {
  const cliInstalled = Boolean(await resolveCommandPath("opencode", hookPaths.homeDir));
  const hookInstalled = (await readFileText(hookPaths.opencodePluginPath)).includes(OPENCODE_PLUGIN_MARKER);
  const paths = [hookPaths.opencodePluginPath, hookPaths.opencodeConfigPath];
  if (!cliInstalled) {
    return {
      agentId: OPENCODE_AGENT_ID,
      cliCommand: "opencode",
      cliInstalled,
      detail: "opencode was not found on PATH.",
      hookInstalled,
      paths,
      status: "cliMissing",
    };
  }
  return {
    agentId: OPENCODE_AGENT_ID,
    cliCommand: "opencode",
    cliInstalled,
    detail: hookInstalled
      ? `Installed in ${displayPath(hookPaths.opencodePluginPath, hookPaths.homeDir)}`
      : `Run Install Hooks to write ${displayPath(hookPaths.opencodePluginPath, hookPaths.homeDir)}`,
    hookInstalled,
    paths,
    status: hookInstalled ? "installed" : "missing",
  };
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

async function resolveCommandPath(command: string, homeDir: string): Promise<string> {
  const commandEnvironment = withoutGxserverAgentHookColorDisablingEnvironment({
    ...process.env,
    HOME: homeDir,
  });
  const pathValue = await normalizeGxserverProcessPath(process.env.PATH, commandEnvironment);
  const { stdout } = await execFileAsync("/bin/zsh", ["-lc", `command -v -- ${shellQuote(command)}`], {
    env: {
      ...commandEnvironment,
      PATH: pathValue,
    },
    timeout: 2_000,
  }).catch(() => ({ stdout: "" }));
  return String(stdout).trim().split(/\r?\n/)[0] ?? "";
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
    .split(/\r?\n/)
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
  const relative = path.relative(homeDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? `~/${relative}`
    : filePath;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
