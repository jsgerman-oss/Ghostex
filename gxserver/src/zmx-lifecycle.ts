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
  stderrLimitBytes?: number;
  stderrTruncated?: boolean;
  stdout: string;
  stdoutLimitBytes?: number;
  stdoutTruncated?: boolean;
}

export interface GxserverZmxCommandOptions {
  stderrLimitBytes?: number;
  stdin?: string;
  stdoutLimitBytes?: number;
  timeoutMs?: number;
}

export type GxserverZmxCommandRunner = (script: string, options?: GxserverZmxCommandOptions) => Promise<GxserverZmxCommandResult>;
export type GxserverCwdExists = (cwd: string) => Promise<boolean>;

/*
CDXC:GxserverZmxLifecycle 2026-05-30-19:37:
Provider probe execution errors, non-existence-command exits, and command timeouts must produce provider lifecycle `unknown` with an error. Only a completed zmx list that lacks the exact session name is allowed to report `missing`.

CDXC:GxserverSessionIO 2026-05-30-23:32:
gxserver session reads and sends run through zmx subprocesses with explicit byte limits. History output is capped before stdout can grow without bound, and send payloads go through stdin so valid JSON requests do not become oversized `/bin/zsh -lc` argv strings.
*/
const ZMX_LIFECYCLE_COMMAND_TIMEOUT_MS = 5_000;
export const GXSERVER_ZMX_COMMAND_STDOUT_LIMIT_BYTES = 512 * 1024;
export const GXSERVER_ZMX_COMMAND_STDERR_LIMIT_BYTES = 64 * 1024;
export const GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES = 256 * 1024;
export const GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES = 512 * 1024;

export interface GxserverZmxAttachCommandInput {
  cwd: string;
  globalSessionRef?: string;
  gxserverAuthTokenFile?: string;
  gxserverBaseUrl?: string;
  gxserverProtocolVersion?: number;
  sessionName: GxserverZmxSessionName;
  title?: string;
  zmxExecutablePath: string;
}

export interface GxserverZmxRunCommandInput {
  cwd: string;
  globalSessionRef?: string;
  gxserverAuthTokenFile?: string;
  gxserverBaseUrl?: string;
  gxserverProtocolVersion?: number;
  sessionName: GxserverZmxSessionName;
  startupText: string;
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

CDXC:PromptEditor 2026-05-31-11:58:
New zmx provider sessions need canonical gxserver identity in their launch environment so prompt-editor wrappers can address S:P:G sessions without assuming a single connected server. Attach scripts export only stable server/session identity here; client-specific Monaco vs gte routing remains a wrapper/runtime decision.

CDXC:PromptEditor 2026-06-06-16:40:
Desktop render surfaces must advertise Monaco support to zmx at attach time only when their runtime terminal environment selected the Monaco backend. Missing attach capability defaults to gte, so mobile, TUI, and SSH clients cannot inherit stale macOS app prompt-editor markers from an existing shell.

CDXC:GxserverSessionTitle 2026-06-04-04:05:
Agent hooks running inside server-created zmx sessions must report identity and first prompts back to gxserver even when no macOS state file exists. Export the gxserver base URL, protocol version, global session ref, and auth token file path so hooks can call the authenticated session-state API without embedding the bearer token in attach/run command text.

CDXC:GxserverSessionIO 2026-06-06-16:58:
Server-owned zmx run startup commands can execute without the macOS sidebar queue. Preserve or add a single leading shell-history ignore space before passing startup text to the interactive zsh command so automated resume/fork/launch commands do not enter Atuin history.
*/

export function buildZmxAttachCommand(input: GxserverZmxAttachCommandInput): string {
  const persistenceNoticeCommand = persistenceNoticeShellCommand(input.sessionName);
  const titleNoticeCommand = sessionTitleShellCommand(input.title);
  const script = `
zmx_session=${shellQuote(input.sessionName)}
zmx_cwd=${shellQuote(input.cwd)}
zmx_global_session_ref=${shellQuote(input.globalSessionRef ?? "")}
zmx_gxserver_auth_token_file=${shellQuote(input.gxserverAuthTokenFile ?? "")}
zmx_gxserver_base_url=${shellQuote(input.gxserverBaseUrl ?? "")}
zmx_gxserver_protocol_version=${shellQuote(String(input.gxserverProtocolVersion ?? ""))}
zmx_persistence_notice_command=${shellQuote(persistenceNoticeCommand)}
zmx_title_notice_command=${shellQuote(titleNoticeCommand)}
zmx_bin=${shellQuote(input.zmxExecutablePath)}
zmx_prompt_editor_attach_args=
if [ "$GHOSTEX_PROMPT_EDITOR_BACKEND" = "monaco" ] && [ "$GHOSTEX_PROMPT_EDITOR_CLIENT" = "macos-app" ]; then
  zmx_prompt_editor_attach_args='--prompt-editor=monaco'
fi
if [ ! -x "$zmx_bin" ]; then
  printf '%s\\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.'
  exit 127
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
if [ -n "$zmx_global_session_ref" ]; then
  export GHOSTEX_GLOBAL_SESSION_REF="$zmx_global_session_ref"
fi
if [ -n "$zmx_gxserver_auth_token_file" ]; then
  export GHOSTEX_GXSERVER_AUTH_TOKEN_FILE="$zmx_gxserver_auth_token_file"
fi
if [ -n "$zmx_gxserver_base_url" ]; then
  export GHOSTEX_GXSERVER_BASE_URL="$zmx_gxserver_base_url"
fi
if [ -n "$zmx_gxserver_protocol_version" ]; then
  export GHOSTEX_GXSERVER_PROTOCOL_VERSION="$zmx_gxserver_protocol_version"
fi
if "$zmx_bin" list --short 2>/dev/null | grep -F -x -- "$zmx_session" >/dev/null 2>&1; then
  if [ -n "$zmx_title_notice_command" ]; then
    /bin/zsh -lc "$zmx_title_notice_command"
  fi
  exec "$zmx_bin" attach $zmx_prompt_editor_attach_args "$zmx_session"
fi
if [ -n "$zmx_persistence_notice_command" ]; then
  /bin/zsh -lc "$zmx_persistence_notice_command"
fi
cd "$zmx_cwd" || exit
exec "$zmx_bin" attach $zmx_prompt_editor_attach_args "$zmx_session"
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
exec "$zmx_bin" send "$zmx_session"
`.trim();
}

export function buildZmxRunCommand(input: GxserverZmxRunCommandInput): string {
  /*
  CDXC:GxserverRemoteAgents 2026-06-03-02:18:
  Remote gxserver can create agent sessions without a local macOS renderer, so it also needs a bounded way to start the backing zmx provider. This command launches only the named session with server-owned startup text, cwd, bundled zmx, and gxserver identity; it does not expose generic process execution.
  */
  const startupCommand = withAtuinIgnoredShellHistoryPrefix(input.startupText.replace(/[\r\n]+$/u, ""));
  return `
zmx_session=${shellQuote(input.sessionName)}
zmx_cwd=${shellQuote(input.cwd)}
zmx_global_session_ref=${shellQuote(input.globalSessionRef ?? "")}
zmx_gxserver_auth_token_file=${shellQuote(input.gxserverAuthTokenFile ?? "")}
zmx_gxserver_base_url=${shellQuote(input.gxserverBaseUrl ?? "")}
zmx_gxserver_protocol_version=${shellQuote(String(input.gxserverProtocolVersion ?? ""))}
zmx_startup_command=${shellQuote(startupCommand)}
zmx_bin=${shellQuote(input.zmxExecutablePath)}
if [ ! -x "$zmx_bin" ]; then
  printf '%s\\n' 'session persistence is set to zmx, but Ghostex bundled zmx was not found.' >&2
  exit 127
fi
if [ -z "$zmx_startup_command" ]; then
  printf '%s\\n' 'gxserver startSessionProvider requires startup text.' >&2
  exit 64
fi
unset ZMX_SESSION ZMX_SESSION_PREFIX
if [ -n "$zmx_global_session_ref" ]; then
  export GHOSTEX_GLOBAL_SESSION_REF="$zmx_global_session_ref"
fi
if [ -n "$zmx_gxserver_auth_token_file" ]; then
  export GHOSTEX_GXSERVER_AUTH_TOKEN_FILE="$zmx_gxserver_auth_token_file"
fi
if [ -n "$zmx_gxserver_base_url" ]; then
  export GHOSTEX_GXSERVER_BASE_URL="$zmx_gxserver_base_url"
fi
if [ -n "$zmx_gxserver_protocol_version" ]; then
  export GHOSTEX_GXSERVER_PROTOCOL_VERSION="$zmx_gxserver_protocol_version"
fi
cd "$zmx_cwd" || exit
exec "$zmx_bin" run "$zmx_session" -d /bin/zsh -lc "$zmx_startup_command"
`.trim();
}

function withAtuinIgnoredShellHistoryPrefix(text: string): string {
  const trimmedRight = text.trimEnd();
  if (!trimmedRight.trim()) {
    return "";
  }
  return trimmedRight.startsWith(" ") ? trimmedRight : ` ${trimmedRight.trimStart()}`;
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
  CDXC:GxserverZmxLifecycle 2026-06-04-01:40:
  Reconnects should use one canonical server/project/session provider name. If the `S-P-G` zmx session is absent, `zmx attach` may create it and the wake path can run resume startup text there; do not route migrated sessions back to legacy `g-*` names.
  */
  return session.zmxName as GxserverZmxSessionName;
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

export function runZshScript(script: string, options: GxserverZmxCommandOptions = {}): Promise<GxserverZmxCommandResult> {
  const stdoutLimitBytes = options.stdoutLimitBytes ?? GXSERVER_ZMX_COMMAND_STDOUT_LIMIT_BYTES;
  const stderrLimitBytes = options.stderrLimitBytes ?? GXSERVER_ZMX_COMMAND_STDERR_LIMIT_BYTES;
  const timeoutMs = options.timeoutMs ?? ZMX_LIFECYCLE_COMMAND_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let forceKillTimeout: NodeJS.Timeout | undefined;

    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      if (!forceKillTimeout) {
        forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 1_000);
        forceKillTimeout.unref();
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref();

    child.stdin.on("error", () => undefined);
    child.stdin.end(options.stdin ?? "");
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) {
        return;
      }
      const remaining = stdoutLimitBytes - stdoutBytes;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) {
          stdout.push(chunk.subarray(0, remaining));
        }
        stdoutBytes = stdoutLimitBytes;
        stdoutTruncated = true;
        terminate();
        return;
      }
      stdout.push(chunk);
      stdoutBytes += chunk.byteLength;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrTruncated) {
        return;
      }
      const remaining = stderrLimitBytes - stderrBytes;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) {
          stderr.push(chunk.subarray(0, remaining));
        }
        stderrBytes = stderrLimitBytes;
        stderrTruncated = true;
        terminate();
        return;
      }
      stderr.push(chunk);
      stderrBytes += chunk.byteLength;
    });
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
      const limitMessages = [
        stdoutTruncated ? `zmx command stdout exceeded ${stdoutLimitBytes} bytes` : "",
        stderrTruncated ? `zmx command stderr exceeded ${stderrLimitBytes} bytes` : "",
      ].filter(Boolean);
      resolve({
        exitCode: timedOut ? 124 : stdoutTruncated || stderrTruncated ? 125 : (code ?? 1),
        stderr: timedOut
          ? [stderrText, `zmx lifecycle command timed out after ${timeoutMs}ms`, ...limitMessages]
              .filter(Boolean)
              .join("\n")
          : [stderrText, ...limitMessages].filter(Boolean).join("\n"),
        ...(stderrTruncated ? { stderrLimitBytes, stderrTruncated } : {}),
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        ...(stdoutTruncated ? { stdoutLimitBytes, stdoutTruncated } : {}),
      });
    });
  });
}
