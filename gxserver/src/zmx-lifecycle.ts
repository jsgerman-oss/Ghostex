import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type {
  GxserverProviderKillResult,
  GxserverProviderLifecycleState,
  GxserverProviderProbeResult,
  GxserverSessionDomainState,
  GxserverSessionId,
  GxserverZmxSessionName,
} from "../protocol/index.js";

export interface GxserverZmxCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type GxserverZmxCommandRunner = (script: string) => Promise<GxserverZmxCommandResult>;
export type GxserverCwdExists = (cwd: string) => Promise<boolean>;

export interface GxserverZmxAttachCommandInput {
  cwd: string;
  sessionName: GxserverZmxSessionName;
  title?: string;
  zmxExecutablePath: string;
}

export interface GxserverZmxStartupTextDecisionInput {
  providerState: GxserverProviderLifecycleState;
  startupText?: string;
}

export interface GxserverStartupRestoreSelectionInput {
  activeProjectId?: string;
  projects: readonly {
    projectId: string;
    sessions: readonly Pick<GxserverSessionDomainState, "kind" | "lifecycleState" | "sessionId">[];
  }[];
  visibleSessionIdsByProjectId: ReadonlyMap<string, readonly string[]>;
}

/*
CDXC:GxserverZmxLifecycle 2026-05-30-14:48:
gxserver owns zmx lifecycle decisions without owning daemon lifetime. Starting or stopping the gxserver control plane must not signal provider sessions; zmx is resolved and executed only for explicit attach, wake, probe, sleep, or kill requests.

CDXC:GxserverZmxLifecycle 2026-05-30-14:48:
The renderer still receives one `/bin/zsh -lc` attach command string. That script resolves the bundled zmx path, clears inherited zmx client/session identity, checks existing sessions, prints title context for existing sessions, prints the persistence notice for new sessions, changes to the saved cwd, then execs direct `zmx attach` so startup/resume text remains outside the attach script.
*/

export function buildZmxAttachCommand(input: GxserverZmxAttachCommandInput): string {
  const persistenceNoticeCommand = persistenceNoticeShellCommand(input.sessionName);
  const titleNoticeCommand = sessionTitleShellCommand(input.title);
  const script = `
zmx_session=${shellQuote(input.sessionName)}
zmx_cwd=${shellQuote(input.cwd)}
zmx_persistence_notice_command=${shellQuote(persistenceNoticeCommand)}
zmx_title_notice_command=${shellQuote(titleNoticeCommand)}
zmx_bin=${shellQuote(input.zmxExecutablePath)}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.'
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
if "$zmx_bin" list --short 2>/dev/null | grep -F -x -- "$zmx_session" >/dev/null 2>&1; then
  if [ -n "$zmx_title_notice_command" ]; then
    /bin/zsh -lc "$zmx_title_notice_command"
  fi
  exec "$zmx_bin" attach "$zmx_session"
fi
if [ -n "$zmx_persistence_notice_command" ]; then
  /bin/zsh -lc "$zmx_persistence_notice_command"
fi
cd "$zmx_cwd" || exit
exec "$zmx_bin" attach "$zmx_session"
`.trim();
  return `/bin/zsh -lc ${shellQuote(script)}`;
}

export function buildZmxKillCommand(input: {
  sessionName: GxserverZmxSessionName;
  zmxExecutablePath: string;
}): string {
  const script = `
zmx_session=${shellQuote(input.sessionName)}
zmx_bin=${shellQuote(input.zmxExecutablePath)}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.'
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
exec "$zmx_bin" kill "$zmx_session" --force
`.trim();
  return script;
}

export function buildZmxExistsCommand(input: {
  sessionName: GxserverZmxSessionName;
  zmxExecutablePath: string;
}): string {
  return `
zmx_session=${shellQuote(input.sessionName)}
zmx_bin=${shellQuote(input.zmxExecutablePath)}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.' >&2
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
"$zmx_bin" list --short 2>/dev/null | grep -F -x -- "$zmx_session" >/dev/null 2>&1
`.trim();
}

export async function probeZmxSession(input: {
  now?: () => string;
  runZsh?: GxserverZmxCommandRunner;
  sessionName: GxserverZmxSessionName;
  zmxExecutablePath: string;
}): Promise<GxserverProviderProbeResult> {
  const result = await (input.runZsh ?? runZshScript)(
    buildZmxExistsCommand({
      sessionName: input.sessionName,
      zmxExecutablePath: input.zmxExecutablePath,
    }),
  );
  const lifecycleState: GxserverProviderLifecycleState =
    result.exitCode === 0 ? "exists" : result.exitCode === 1 ? "missing" : "unknown";
  const error = lifecycleState === "unknown" ? result.stderr || `exit-${result.exitCode}` : undefined;
  return {
    ...(error ? { error } : {}),
    lifecycleState,
    probedAt: (input.now ?? (() => new Date().toISOString()))(),
    zmxName: input.sessionName,
  };
}

export async function killZmxSession(input: {
  runZsh?: GxserverZmxCommandRunner;
  sessionName: GxserverZmxSessionName;
  zmxExecutablePath: string;
}): Promise<GxserverProviderKillResult> {
  const result = await (input.runZsh ?? runZshScript)(
    buildZmxKillCommand({
      sessionName: input.sessionName,
      zmxExecutablePath: input.zmxExecutablePath,
    }),
  );
  return {
    ...(result.exitCode === 0 ? {} : { error: result.stderr || `exit-${result.exitCode}` }),
    exitCode: result.exitCode,
    killed: result.exitCode === 0,
    stderr: result.stderr,
    stdout: result.stdout,
    zmxName: input.sessionName,
  };
}

export function decideStartupTextDisposition(
  input: GxserverZmxStartupTextDecisionInput,
): "discardExistingProvider" | "discardUnknownProvider" | "none" | "queueAfterTerminalReady" {
  if (!input.startupText?.trim()) {
    return "none";
  }
  if (input.providerState === "exists") {
    return "discardExistingProvider";
  }
  if (input.providerState === "unknown") {
    return "discardUnknownProvider";
  }
  return "queueAfterTerminalReady";
}

export async function defaultCwdExists(cwd: string): Promise<boolean> {
  const trimmed = cwd.trim();
  if (!trimmed) {
    return false;
  }
  try {
    return (await stat(trimmed)).isDirectory();
  } catch {
    return false;
  }
}

export function selectStartupRestoreSessionIds(input: GxserverStartupRestoreSelectionInput): string[] {
  const activeProjectId = input.activeProjectId?.trim();
  if (!activeProjectId) {
    return [];
  }
  const activeProject = input.projects.find((project) => project.projectId === activeProjectId);
  if (!activeProject) {
    return [];
  }
  const visibleSessionIds = new Set(input.visibleSessionIdsByProjectId.get(activeProjectId) ?? []);
  return activeProject.sessions
    .filter((session) => visibleSessionIds.has(session.sessionId))
    .filter((session) => session.lifecycleState !== "sleeping" && session.lifecycleState !== "stopped")
    .map((session) => session.sessionId);
}

export function providerStatePatch(
  session: Pick<GxserverSessionDomainState, "providerState" | "zmxName">,
  probe: GxserverProviderProbeResult,
): GxserverSessionDomainState["providerState"] {
  return {
    ...session.providerState,
    lifecycleState: probe.lifecycleState,
    probeError: probe.error,
    probedAt: probe.probedAt,
    zmxName: probe.zmxName,
  };
}

export function missingProviderStatePatch(
  session: Pick<GxserverSessionDomainState, "providerState" | "zmxName">,
  timestamp: string,
): GxserverSessionDomainState["providerState"] {
  return {
    ...session.providerState,
    lifecycleState: "missing",
    probeError: undefined,
    probedAt: timestamp,
    zmxName: providerZmxSessionName(session),
  };
}

export function normalizeLifecycleReason(reason: unknown, fallback: string): string {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return trimmed || fallback;
}

export function assertValidSessionName(value: string): asserts value is GxserverZmxSessionName {
  if (!/^[A-Za-z0-9_-]+-[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid zmx session name: ${value}`);
  }
}

export function providerZmxSessionName(
  session: Pick<GxserverSessionDomainState, "providerState" | "zmxName">,
): GxserverZmxSessionName {
  /*
  CDXC:GxserverMigration 2026-05-30-17:27:
  Imported macOS sessions must keep attaching to the already-running zmx runtime name recorded before gxserver existed. The durable gxserver G ID can change during import, but the provider session name is external runtime state and must remain the legacy `sessionPersistenceName` until the user closes/recreates that session.
  */
  const legacyProvider = typeof session.providerState.legacyProvider === "string" ? session.providerState.legacyProvider : "";
  const legacyName =
    typeof session.providerState.legacyProviderSessionName === "string"
      ? session.providerState.legacyProviderSessionName.trim()
      : "";
  return (legacyProvider === "zmx" && legacyName ? legacyName : session.zmxName) as GxserverZmxSessionName;
}

function persistenceNoticeShellCommand(sessionName: GxserverZmxSessionName): string {
  return `printf '%s\\n' ${shellQuote(`This session is using zmx persistence: ${sessionName}`)}`;
}

function sessionTitleShellCommand(title: string | undefined): string {
  const trimmedTitle = title?.trim() ?? "";
  if (!trimmedTitle) {
    return "";
  }
  return `printf '%s\\n' ${shellQuote(trimmedTitle)}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runZshScript(script: string): Promise<GxserverZmxCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
      });
    });
  });
}
