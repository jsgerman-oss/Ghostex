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

/*
CDXC:GxserverZmxLifecycle 2026-05-30-19:37:
Provider probe execution errors, non-existence-command exits, and command timeouts must produce provider lifecycle `unknown` with an error. Only a completed zmx list that lacks the exact session name is allowed to report `missing`.
*/
const ZMX_LIFECYCLE_COMMAND_TIMEOUT_MS = 5_000;

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

export function buildZmxHistoryCommand(input: {
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
exec "$zmx_bin" history "$zmx_session"
`.trim();
}

export function buildZmxSendCommand(input: {
  sessionName: GxserverZmxSessionName;
  text: string;
  zmxExecutablePath: string;
}): string {
  return `
zmx_session=${shellQuote(input.sessionName)}
zmx_text=${shellQuote(input.text)}
zmx_bin=${shellQuote(input.zmxExecutablePath)}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.' >&2
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
exec "$zmx_bin" send "$zmx_session" "$zmx_text"
`.trim();
}

export function buildZmxExistsCommand(input: {
  sessionName: GxserverZmxSessionName;
  zmxExecutablePath: string;
}): string {
  /*
  CDXC:GxserverZmxLifecycle 2026-05-30-19:37:
  A failed `zmx list --short` means provider state is unknown, not missing. Capture the list exit before matching session names so transient zmx failures cannot make live sessions look absent and trigger restore/recreate behavior.
  */
  return `
zmx_session=${shellQuote(input.sessionName)}
zmx_bin=${shellQuote(input.zmxExecutablePath)}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.' >&2
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
zmx_sessions=$("$zmx_bin" list --short)
zmx_list_status=$?
if [ "$zmx_list_status" -ne 0 ]; then
  printf '%s\\n' "zmx list --short failed with exit $zmx_list_status" >&2
  exit 2
fi
printf '%s\\n' "$zmx_sessions" | grep -F -x -- "$zmx_session" >/dev/null 2>&1
`.trim();
}

export async function probeZmxSession(input: {
  now?: () => string;
  runZsh?: GxserverZmxCommandRunner;
  sessionName: GxserverZmxSessionName;
  zmxExecutablePath: string;
}): Promise<GxserverProviderProbeResult> {
  const probedAt = (input.now ?? (() => new Date().toISOString()))();
  let result: GxserverZmxCommandResult;
  try {
    result = await (input.runZsh ?? runZshScript)(
      buildZmxExistsCommand({
        sessionName: input.sessionName,
        zmxExecutablePath: input.zmxExecutablePath,
      }),
    );
  } catch (error) {
    return {
      error: zmxProbeThrownErrorMessage(error),
      lifecycleState: "unknown",
      probedAt,
      zmxName: input.sessionName,
    };
  }
  const lifecycleState: GxserverProviderLifecycleState =
    result.exitCode === 0 ? "exists" : result.exitCode === 1 ? "missing" : "unknown";
  const error = lifecycleState === "unknown" ? zmxProbeExitErrorMessage(result) : undefined;
  return {
    ...(error ? { error } : {}),
    lifecycleState,
    probedAt,
    zmxName: input.sessionName,
  };
}

export async function killZmxSession(input: {
  runZsh?: GxserverZmxCommandRunner;
  sessionName: GxserverZmxSessionName;
  zmxExecutablePath: string;
}): Promise<GxserverProviderKillResult> {
  let result: GxserverZmxCommandResult;
  try {
    result = await (input.runZsh ?? runZshScript)(
      buildZmxKillCommand({
        sessionName: input.sessionName,
        zmxExecutablePath: input.zmxExecutablePath,
      }),
    );
  } catch (error) {
    const message = zmxKillThrownErrorMessage(error);
    return {
      error: message,
      exitCode: 1,
      killed: false,
      stderr: message,
      stdout: "",
      zmxName: input.sessionName,
    };
  }
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
    killError: undefined,
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
    killError: undefined,
    lifecycleState: "missing",
    probeError: undefined,
    probedAt: timestamp,
    zmxName: providerZmxSessionName(session),
  };
}

export function failedKillProviderStatePatch(
  session: Pick<GxserverSessionDomainState, "providerState" | "zmxName">,
  kill: GxserverProviderKillResult,
  timestamp: string,
): GxserverSessionDomainState["providerState"] {
  const error = (kill.error ?? kill.stderr) || `zmx kill command exited ${kill.exitCode}`;
  return {
    ...session.providerState,
    killError: error,
    lifecycleState: "unknown",
    probeError: error,
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

function zmxProbeExitErrorMessage(result: GxserverZmxCommandResult): string {
  const stderr = result.stderr.trim();
  if (stderr) {
    return stderr;
  }
  const stdout = result.stdout.trim();
  if (stdout) {
    return stdout;
  }
  return `zmx probe command exited ${result.exitCode}`;
}

function zmxProbeThrownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = typeof (error as NodeJS.ErrnoException).code === "string" ? ` ${(error as NodeJS.ErrnoException).code}` : "";
    return `${error.name || "Error"}${code}: ${error.message}`;
  }
  return `zmx probe command failed: ${String(error)}`;
}

function zmxKillThrownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = typeof (error as NodeJS.ErrnoException).code === "string" ? ` ${(error as NodeJS.ErrnoException).code}` : "";
    return `${error.name || "Error"}${code}: ${error.message}`;
  }
  return `zmx kill command failed: ${String(error)}`;
}

export function runZshScript(script: string): Promise<GxserverZmxCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let forceKillTimeout: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 1_000);
    }, ZMX_LIFECYCLE_COMMAND_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stderr: timedOut
          ? [stderrText, `zmx lifecycle command timed out after ${ZMX_LIFECYCLE_COMMAND_TIMEOUT_MS}ms`]
              .filter(Boolean)
              .join("\n")
          : stderrText,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
      });
    });
  });
}
