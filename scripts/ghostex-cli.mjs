#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_PORT = 58743;
const DEV_PORT = 58744;
/**
 * CDXC:DevAppFlavor 2026-05-11-12:10
 * CLI-side logs, selector caches, and bridge metadata must follow the app
 * variant. `bun start:dev` and the ghostex-dev bundle use ~/.ghostex-dev so CLI
 * commands issued through that dev app do not touch the installed app's data.
 *
 * CDXC:CliBranding 2026-05-12-07:35
 * Public CLI commands are `ghostex` and the shorter `gtx` alias. Internal
 * GHOSTEX_* environment names and ~/.ghostex storage remain unchanged because they
 * are implementation state, not user-facing command names.
 */
const GHOSTEX_HOME =
  process.env.GHOSTEX_HOME?.trim() ||
  path.join(homedir(), process.env.GHOSTEX_APP_VARIANT === "dev" ? ".ghostex-dev" : ".ghostex");
const LOG_DIR = path.join(GHOSTEX_HOME, "logs");
const CLI_DIR = path.join(GHOSTEX_HOME, "cli");
const BRIDGE_TOKEN_PATH = path.join(CLI_DIR, "bridge-token");
const SESSION_ALIAS_CACHE_PATH = path.join(CLI_DIR, "session-aliases.json");
const SHARED_SETTINGS_PATH = path.join(GHOSTEX_HOME, "state", "native-sidebar-settings.json");

const COMMANDS = new Map([
  ["sessions", sessionsCommand],
  ["s", sessionsCommand],
  ["list-sessions", sessionsCommand],
  ["ls", sessionsCommand],
  ["attach", attachSessionCommand],
  ["a", attachSessionCommand],
  ["resume", attachSessionCommand],
  ["r", attachSessionCommand],
  ["kill", sessionActionCommand("closeSession", "killed")],
  ["k", sessionActionCommand("closeSession", "killed")],
  ["sleep", sessionActionCommand("sleepSession", "slept", { sleeping: true })],
  ["wake", sessionActionCommand("sleepSession", "woke", { sleeping: false })],
  ["focus", focusSmartSessionCommand],
  ["floating-editor", floatingEditorCommand],
  ["fe", floatingEditorCommand],
  ["floating-monaco-editor", floatingMonacoEditorCommand],
  ["fme", floatingMonacoEditorCommand],
  ["state", bridgeAction("state")],
  ["dump-state", bridgeAction("dumpState")],
  ["create-session", bridgeAction("createSession", parseCreateSession)],
  ["create-agent", bridgeAction("createAgentSession", parseAgent)],
  ["run-agent", bridgeAction("runAgent", parseAgent)],
  ["run-command", bridgeAction("runCommand", parseCommandButton)],
  ["click-button", bridgeAction("clickButton", parseClickButton)],
  ["focus-session", bridgeAction("focusSession", parseSessionSelector)],
  ["focus-group", bridgeAction("focusGroup", parseGroup)],
  ["switch-project", bridgeAction("switchProject", parseProject)],
  ["add-project", bridgeAction("addProject", parseProjectPath)],
  ["close-session", bridgeAction("closeSession", parseSessionSelector)],
  ["restart-session", bridgeAction("restartSession", parseSessionSelector)],
  ["fork-session", bridgeAction("forkSession", parseSessionSelector)],
  ["reload-session", bridgeAction("fullReloadSession", parseSessionSelector)],
  ["rename-session", bridgeAction("renameSession", parseRename)],
  ["sleep-session", bridgeAction("sleepSession", parseSessionBoolean("sleeping"))],
  ["favorite-session", bridgeAction("favoriteSession", parseSessionBoolean("favorite"))],
  ["send-text", bridgeAction("sendText", parseSendText)],
  ["send-enter", bridgeAction("sendEnter", parseSessionSelector)],
  ["send-key", bridgeAction("sendKey", parseSendKey)],
  ["rename-command", bridgeAction("renameCommand", parseRename)],
  ["toggle-section", bridgeAction("toggleSection", parseToggleSection)],
  ["set-visible-count", bridgeAction("setVisibleCount", parseVisibleCount)],
  ["set-view-mode", bridgeAction("setViewMode", parseViewMode)],
  ["open-browser", bridgeAction("openBrowser", parseUrl)],
  ["open-browser-pane", bridgeAction("openBrowserPane")],
  ["show-browser", bridgeAction("showBrowser")],
  ["move-sidebar", bridgeAction("moveSidebar")],
  ["assert-card", bridgeAction("assertSidebarCard", parseAssertCard, { assertOk: true })],
  ["wait-for", bridgeAction("waitFor", parseWaitFor, { assertOk: true })],
  ["screenshot", screenshotCommand],
  ["logs", logsCommand],
  ["bundle", bundleCommand],
  ["help", helpCommand],
]);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [commandName = "help", ...args] = process.argv.slice(2);
  if (commandName === "-h" || commandName === "--help") {
    helpCommand();
    return;
  }
  const command = COMMANDS.get(commandName);
  if (!command) {
    throw new Error(`Unknown command: ${commandName}\n\n${usage()}`);
  }
  if (args.includes("-h") || args.includes("--help")) {
    helpCommand();
    return;
  }
  await command(args);
}

function bridgeAction(action, parser = () => ({}), options = {}) {
  return async (args) => {
    const { flags, rest } = parseArgs(args);
    const result = await sendSidebarCliCommand(action, parser(rest, flags), flags);
    if (options.assertOk && result.ok === false) {
      printJson(result);
      process.exitCode = 1;
      return;
    }
    printJson(result);
  };
}

async function sendSidebarCliCommand(action, payload, flags = {}) {
  const port = Number(
    flags.port ??
      process.env.GHOSTEX_CLI_PORT ??
      (process.env.GHOSTEX_APP_VARIANT === "dev" ? DEV_PORT : DEFAULT_PORT),
  );
  const requestId = `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const authToken = await readBridgeAuthToken(flags);
  const socket = await connectBridge(port);
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          reject(new Error(`Timed out waiting for Ghostex sidebar CLI result (${action}).`));
        },
        Number(flags.timeout ?? 15_000),
      );
      addSocketMessageListener(socket, (data) => {
        const event = parseJson(String(data));
        if (event?.type !== "sidebarCliResult" || event.requestId !== requestId) {
          return;
        }
        clearTimeout(timeout);
        const payload = parseJson(event.payloadJson) ?? { rawPayloadJson: event.payloadJson };
        resolve({ ...payload, bridgeOk: event.ok });
      });
      socket.send(
        JSON.stringify({
          action,
          authToken,
          payloadJson: JSON.stringify(payload),
          requestId,
          type: "sidebarCliCommand",
        }),
      );
    });
  } finally {
    closeSocket(socket);
  }
}

async function connectBridge(port) {
  /**
   * CDXC:CliBridgeTransport 2026-05-15-20:03:
   * Native listens on a loopback-only newline JSON TCP bridge because the
   * Network.framework WebSocket listener failed before binding on macOS, which
   * made Ctrl+G rich prompt editing fall back to inline vi. Keep the CLI API
   * shaped like the previous socket wrapper so command handlers stay focused on
   * HostCommand payloads instead of transport details.
   */
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.setEncoding("utf8");
      socket.send = (message) => {
        socket.write(`${message}\n`);
      };
      resolve(socket);
    });
    socket.once("error", () => {
      reject(new Error(`Could not connect to ghostex bridge on port ${port}. Is ghostex running?`));
    });
  });
}

function addSocketListener(socket, eventName, handler, options = {}) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(eventName, handler, options);
    return;
  }
  if (options.once && typeof socket.once === "function") {
    socket.once(eventName, handler);
    return;
  }
  socket.on(eventName, handler);
}

function addSocketMessageListener(socket, handler) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener("message", (event) => handler(event.data));
    return;
  }
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += String(chunk);
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        handler(line);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });
}

async function floatingEditorCommand(args) {
  const { flags, rest } = parseArgs(args);
  const commandArgs = rest.filter((arg) => arg !== "");
  if (commandArgs.length === 0) {
    throw new Error("Usage: ghostex floating-editor -- <editor> [args...]");
  }

  const port = bridgePortFromFlags(flags);
  const timeoutMs = Number(flags.timeoutMs ?? 5_000);
  const cwd = path.resolve(String(flags.cwd ?? process.cwd()));
  const requestId = `floating-editor-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const workDir = await mkdtemp(path.join(tmpdir(), "ghostex-floating-editor-"));
  const statusFile = path.join(workDir, "status");
  const wrapperPath = path.join(workDir, "run.zsh");
  const debuggingMode = await readDebuggingMode();
  const logPath = debuggingMode ? floatingEditorLogPath() : "/dev/null";
  const resolvedCommandArgs = [...commandArgs];
  resolvedCommandArgs[0] = await resolveExecutable(commandArgs[0]);
  await writeFile(wrapperPath, floatingEditorWrapperScript(resolvedCommandArgs, cwd, statusFile, logPath));

  await appendFloatingEditorLog({
    command: resolvedCommandArgs.join(" "),
    cwd,
    event: "cli.request",
    originatingSessionId: process.env.GHOSTEX_NATIVE_SESSION_ID ?? "",
    port,
    requestId,
    statusFile,
  });

  let socket;
  try {
    const authToken = await readBridgeAuthToken(flags);
    socket = await connectBridge(port);
    socket.send(
      JSON.stringify({
        authToken,
        command: `/bin/zsh ${shellQuote(wrapperPath)}`,
        cwd,
        env: floatingEditorEnvironment(),
        originatingSessionId: process.env.GHOSTEX_NATIVE_SESSION_ID || undefined,
        requestId,
        statusFile,
        title: "Zapet",
        type: "openFloatingEditor",
      }),
    );
    await waitForStatus(statusFile, (status) => status.includes("started"), timeoutMs);
    const status = await waitForStatus(
      statusFile,
      (nextStatus) =>
        nextStatus.match(/^exit:(\d+)/m) ||
        nextStatus.match(/^signal:/m) ||
        nextStatus.match(/^cancelled$/m),
      Number(flags.exitTimeoutMs ?? 0),
    );
    const exitMatch = status.match(/^exit:(\d+)/m);
    if (exitMatch) {
      process.exitCode = Number(exitMatch[1]);
    } else {
      process.exitCode = 1;
    }
  } catch (error) {
    await appendFloatingEditorLog({
      error: error instanceof Error ? error.message : String(error),
      event: "cli.fallback_inline",
      requestId,
    });
    await runEditorInline(commandArgs, cwd);
  } finally {
    closeSocket(socket);
    if (flags.keepTemp !== true && flags.keepTemp !== "true") {
      await rm(workDir, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

async function floatingMonacoEditorCommand(args) {
  const { flags, rest } = parseArgs(args);
  const filePath = rest.find((arg) => arg && arg.trim() !== "");
  if (!filePath) {
    throw new Error("Usage: ghostex floating-monaco-editor <file>");
  }

  const port = bridgePortFromFlags(flags);
  const timeoutMs = Number(flags.timeoutMs ?? 5_000);
  const cwd = path.resolve(String(flags.cwd ?? process.cwd()));
  const requestId = `floating-monaco-editor-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const workDir = await mkdtemp(path.join(tmpdir(), "ghostex-floating-monaco-editor-"));
  const statusFile = path.join(workDir, "status");
  const resolvedFilePath = path.resolve(cwd, filePath);

  await appendFloatingEditorLog({
    cwd,
    event: "cli.monaco_request",
    filePath: resolvedFilePath,
    originatingSessionId: process.env.GHOSTEX_NATIVE_SESSION_ID ?? "",
    port,
    requestId,
    statusFile,
  });

  let socket;
  try {
    const authToken = await readBridgeAuthToken(flags);
    socket = await connectBridge(port);
    socket.send(
      JSON.stringify({
        authToken,
        cwd,
        editorKind: "monaco",
        filePath: resolvedFilePath,
        language: "markdown",
        originatingSessionId: process.env.GHOSTEX_NATIVE_SESSION_ID || undefined,
        requestId,
        statusFile,
        title: "Prompt Editor",
        type: "openFloatingEditor",
      }),
    );
    const status = await waitForStatus(
      statusFile,
      (nextStatus) => nextStatus.match(/^saved$/m) || nextStatus.match(/^cancelled$/m),
      Number(flags.exitTimeoutMs ?? 0),
    );
    process.exitCode = status.match(/^saved$/m) ? 0 : 1;
  } catch (error) {
    await appendFloatingEditorLog({
      error: error instanceof Error ? error.message : String(error),
      event: "cli.monaco_fallback_inline",
      filePath: resolvedFilePath,
      requestId,
    });
    await runEditorInline(["vi", resolvedFilePath], cwd);
  } finally {
    closeSocket(socket);
    if (flags.keepTemp !== true && flags.keepTemp !== "true") {
      await rm(workDir, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

function closeSocket(socket) {
  if (!socket) {
    return;
  }
  if (typeof socket.destroy === "function") {
    socket.destroy();
    return;
  }
  if (typeof socket.terminate === "function") {
    socket.terminate();
    return;
  }
  socket.close();
}

function bridgePortFromFlags(flags) {
  return Number(
    flags.port ??
      process.env.GHOSTEX_CLI_PORT ??
      (process.env.GHOSTEX_APP_VARIANT === "dev" ? DEV_PORT : DEFAULT_PORT),
  );
}

async function readBridgeAuthToken(flags = {}) {
  /**
   * CDXC:CliBridgeSecurity 2026-05-15-18:25
   * The native host rejects unauthenticated loopback WebSocket commands because
   * arbitrary browser pages can also connect to 127.0.0.1. CLI commands read the
   * per-launch token that the app writes under ~/.ghostex[-dev]/cli.
   */
  const explicitToken = String(flags.token ?? flags.bridgeToken ?? process.env.GHOSTEX_BRIDGE_TOKEN ?? "")
    .trim();
  if (explicitToken) {
    return explicitToken;
  }
  const token = (await readFile(BRIDGE_TOKEN_PATH, "utf8").catch(() => "")).trim();
  if (!token) {
    throw new Error(
      `Could not read Ghostex bridge token at ${BRIDGE_TOKEN_PATH}. Is Ghostex running?`,
    );
  }
  return token;
}

function floatingEditorEnvironment() {
  const environment = {
    HOME: process.env.HOME ?? homedir(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TERM: process.env.TERM ?? "xterm-256color",
    USER: process.env.USER ?? "",
    GHOSTEX_FLOATING_EDITOR: "1",
  };
  if (process.env.GHOSTEX_APP_VARIANT) {
    environment.GHOSTEX_APP_VARIANT = process.env.GHOSTEX_APP_VARIANT;
  }
  return environment;
}

function floatingEditorWrapperScript(commandArgs, cwd, statusFile, logPath) {
  const command = commandArgs.map(shellQuote).join(" ");
  return `#!/bin/zsh
set +e
mkdir -p ${shellQuote(path.dirname(statusFile))} ${shellQuote(path.dirname(logPath))} 2>/dev/null
printf 'started\\n' > ${shellQuote(statusFile)}
{
  printf '[%s] child.start cwd=%s command=%s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" ${shellQuote(cwd)} ${shellQuote(command)}
} >> ${shellQuote(logPath)} 2>/dev/null
cd ${shellQuote(cwd)} || {
  _ghostex_status=$?
  printf 'exit:%s\\n' "$_ghostex_status" >> ${shellQuote(statusFile)}
  exit "$_ghostex_status"
}
${command}
_ghostex_status=$?
{
  printf '[%s] child.exit status=%s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$_ghostex_status"
} >> ${shellQuote(logPath)} 2>/dev/null
printf 'exit:%s\\n' "$_ghostex_status" >> ${shellQuote(statusFile)}
exit "$_ghostex_status"
`;
}

async function resolveExecutable(command) {
  if (command.includes("/")) {
    return command;
  }
  const { stdout } = await execFileAsync("/bin/zsh", ["-lc", `command -v -- ${shellQuote(command)}`]);
  return stdout.trim().split(/\r?\n/)[0] || command;
}

async function waitForStatus(statusFile, predicate, timeoutMs) {
  const startedAt = Date.now();
  while (true) {
    const status = await readFile(statusFile, "utf8").catch(() => "");
    if (predicate(status)) {
      return status;
    }
    if (timeoutMs > 0 && Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for floating editor status at ${statusFile}.`);
    }
    await sleep(100);
  }
}

async function runEditorInline(commandArgs, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(commandArgs[0], commandArgs.slice(1), {
      cwd,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}

function floatingEditorLogPath() {
  return path.join(homedir(), "Library", "Logs", "ghostex", "floating-editor.log");
}

async function appendFloatingEditorLog(details) {
  /**
   * CDXC:Diagnostics 2026-05-16-07:23:
   * Floating-editor CLI breadcrumbs are regular app diagnostics written to a
   * persistent log file. Honor the shared Settings Debugging Mode switch before
   * creating or appending ~/Library/Logs/ghostex/floating-editor.log.
   */
  if (!(await readDebuggingMode())) {
    return;
  }
  const logPath = floatingEditorLogPath();
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(
    logPath,
    `${JSON.stringify({
      ...details,
      source: "ghostex-cli",
      timestamp: new Date().toISOString(),
    })}\n`,
  );
}

async function readDebuggingMode() {
  const settingsJson = await readFile(SHARED_SETTINGS_PATH, "utf8").catch(() => "");
  if (!settingsJson) {
    return false;
  }
  try {
    return JSON.parse(settingsJson)?.debuggingMode === true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function screenshotCommand(args) {
  const { flags, rest } = parseArgs(args);
  const output = path.resolve(rest[0] ?? path.join(CLI_DIR, `screenshot-${timestampSlug()}.png`));
  await captureScreenshot(output, flags);
  printJson({ ok: true, output });
}

async function logsCommand(args) {
  const { flags } = parseArgs(args);
  const file = String(flags.file ?? "agent-detection-debug.log");
  const lines = Number(flags.lines ?? 200);
  const logPath = path.join(LOG_DIR, file);
  const text = await readFile(logPath, "utf8").catch((error) => {
    throw new Error(`Could not read ${logPath}: ${error.message}`);
  });
  const filtered = filterLogLines(text, flags).slice(-lines);
  if (flags.json) {
    printJson({ file: logPath, lines: filtered, ok: true });
    return;
  }
  console.log(filtered.join("\n"));
}

async function bundleCommand(args) {
  const { flags, rest } = parseArgs(args);
  const outputDir = path.resolve(rest[0] ?? path.join(CLI_DIR, `bundle-${timestampSlug()}`));
  await mkdir(outputDir, { recursive: true });
  const state = await sendSidebarCliCommand("state", {}, flags);
  const screenshot = path.join(outputDir, "screenshot.png");
  await captureScreenshot(screenshot, flags);
  const logs = await collectLogs(Number(flags.lines ?? 500));
  await writeFile(path.join(outputDir, "state.json"), JSON.stringify(state, null, 2));
  await writeFile(path.join(outputDir, "logs.json"), JSON.stringify(logs, null, 2));
  printJson({ logs: path.join(outputDir, "logs.json"), ok: true, outputDir, screenshot });
}

async function captureScreenshot(output, flags = {}) {
  await mkdir(path.dirname(output), { recursive: true });
  if (flags.activate !== "false") {
    await execFileAsync("osascript", ["-e", 'tell application "Ghostex" to activate']).catch(
      () => undefined,
    );
  }
  await execFileAsync("screencapture", ["-x", output]);
}

async function collectLogs(lines) {
  const entries = await readdir(LOG_DIR).catch(() => []);
  const result = {};
  for (const file of entries.filter((entry) => entry.endsWith(".log"))) {
    const text = await readFile(path.join(LOG_DIR, file), "utf8").catch(() => "");
    result[file] = text.split(/\r?\n/).filter(Boolean).slice(-lines);
  }
  return result;
}

async function sessionsCommand(args) {
  const { flags } = parseArgs(args);
  const result = await fetchSessionList(flags, { writeCache: true });
  if (flags.json) {
    printJson(result);
    return;
  }
  printSessionList(result.sessions ?? [], {
    grouped: flags.ungrouped !== true && flags.u !== true,
  });
}

async function attachSessionCommand(args) {
  const { flags, rest } = parseArgs(args);
  const selector = rest.join(" ").trim();
  const result = await fetchSessionList(flags);
  const session = await resolveOneListedSession(selector, result.sessions ?? []);
  const command = session.attachCommand || session.resumeCommand;
  if (!command) {
    throw new Error(
      `Session ${session.alias} has no provider attach command or supported agent resume command.`,
    );
  }
  await runInteractiveShellCommand(command, session.projectPath);
}

function sessionActionCommand(action, pastTense, extraPayload = {}) {
  return async (args) => {
    const { flags, rest } = parseArgs(args);
    const selector = rest.join(" ").trim();
    const result = await fetchSessionList(flags);
    const sessions =
      selector.toLowerCase() === "all"
        ? (result.sessions ?? [])
        : [await resolveOneListedSession(selector, result.sessions ?? [])];
    if (sessions.length === 0) {
      throw new Error("No running terminal sessions matched.");
    }
    const affected = [];
    for (const session of sessions) {
      const actionResult = await sendSidebarCliCommand(
        action,
        {
          ...extraPayload,
          sessionId: session.sessionId,
        },
        flags,
      );
      if (actionResult.ok === false) {
        throw new Error(actionResult.error ?? `Could not ${action} ${session.title}.`);
      }
      affected.push({ ok: actionResult.ok !== false, session });
    }
    if (flags.json) {
      printJson({ ok: affected.every((item) => item.ok), sessions: affected });
      return;
    }
    for (const item of affected) {
      console.log(`${pastTense} ${item.session.alias}: ${item.session.title}`);
    }
  };
}

async function focusSmartSessionCommand(args) {
  const { flags, rest } = parseArgs(args);
  const selector = rest.join(" ").trim();
  const result = await fetchSessionList(flags);
  const session = await resolveOneListedSession(selector, result.sessions ?? []);
  const actionResult = await sendSidebarCliCommand(
    "focusSession",
    { sessionId: session.sessionId },
    flags,
  );
  if (flags.json) {
    printJson(actionResult);
    return;
  }
  console.log(`focused ${session.alias}: ${session.title}`);
}

async function fetchSessionList(flags = {}, options = {}) {
  const result = await sendSidebarCliCommand("listSessions", {}, flags);
  if (result.ok === false) {
    throw new Error(result.error ?? "Could not list Ghostex sessions.");
  }
  const sessions = Array.isArray(result.sessions) ? result.sessions : [];
  if (options.writeCache === true) {
    await writeSessionAliasCache({
      createdAt: new Date().toISOString(),
      revision: result.revision,
      sessions,
    });
  }
  return { ...result, sessions };
}

async function writeSessionAliasCache(cache) {
  /**
   * CDXC:CliSessions 2026-05-07-21:22
   * The human sessions CLI uses global aliases from the last printed live list
   * so follow-up commands such as `ghostex a 2` and `ghostex k 4` target the rows the
   * user just saw, independent of grouped or ungrouped table formatting.
   */
  await mkdir(CLI_DIR, { recursive: true });
  await writeFile(SESSION_ALIAS_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function readSessionAliasCache() {
  const text = await readFile(SESSION_ALIAS_CACHE_PATH, "utf8").catch(() => undefined);
  return text ? parseJson(text) : undefined;
}

async function resolveOneListedSession(selector, sessions) {
  const matches = await resolveListedSessions(selector, sessions);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    throw new Error(`No matching session found for "${selector}". Run "ghostex sessions" or "gtx sessions" to list sessions.`);
  }
  throw new Error(`Multiple sessions matched "${selector}":\n${formatSessionMatches(matches)}`);
}

async function resolveListedSessions(selector, sessions) {
  const normalizedSelector = selector.trim();
  if (!normalizedSelector) {
    throw new Error("Provide a session alias, id, title, or project:title selector.");
  }
  if (/^\d+$/.test(normalizedSelector)) {
    const alias = Number(normalizedSelector);
    const cache = await readSessionAliasCache();
    const cachedSessionId = cache?.sessions?.find?.((session) => session.alias === alias)?.sessionId;
    if (cachedSessionId) {
      const liveSession = sessions.find((session) => session.sessionId === cachedSessionId);
      if (liveSession) {
        return [liveSession];
      }
    }
    const liveAliasMatch = sessions.find((session) => session.alias === alias);
    return liveAliasMatch ? [liveAliasMatch] : [];
  }
  const exactId = sessions.find((session) => session.sessionId === normalizedSelector);
  if (exactId) {
    return [exactId];
  }
  const projectSeparatorIndex = normalizedSelector.indexOf(":");
  if (projectSeparatorIndex > 0) {
    const projectSelector = normalizedSelector.slice(0, projectSeparatorIndex).trim().toLowerCase();
    const titleSelector = normalizedSelector.slice(projectSeparatorIndex + 1).trim().toLowerCase();
    return rankSessionTitleMatches(
      sessions.filter(
        (session) =>
          session.projectName?.toLowerCase() === projectSelector ||
          session.projectPath?.toLowerCase().includes(projectSelector),
      ),
      titleSelector,
    );
  }
  return rankSessionTitleMatches(sessions, normalizedSelector.toLowerCase());
}

function rankSessionTitleMatches(sessions, selector) {
  const exact = sessions.filter((session) => session.title?.toLowerCase() === selector);
  if (exact.length > 0) {
    return exact;
  }
  return sessions.filter((session) => session.title?.toLowerCase().includes(selector));
}

function formatSessionMatches(sessions) {
  return sessions
    .map((session) => `${session.alias}. ${session.projectName} - ${session.title}`)
    .join("\n");
}

function printSessionList(sessions, { grouped }) {
  if (sessions.length === 0) {
    console.log("No running terminal sessions.");
    return;
  }
  if (!grouped) {
    const displaySessions = sortSessionsBySidebarActivity(sessions);
    printTable(
      ["#", "Project", "Active", "Title", "Status", "Provider", "Agent"],
      displaySessions.map((session) => [
        String(session.alias),
        session.projectName || "-",
        formatActiveTime(session.lastInteractionAt),
        session.title || "-",
        session.status || "-",
        session.provider || "-",
        session.agent || "-",
      ]),
    );
    return;
  }
  const groupedSessions = groupSessionsByProject(sessions);
  groupedSessions.forEach((group, index) => {
    if (index > 0) {
      console.log("");
    }
    console.log(group.projectName);
    printTable(
      ["#", "Active", "Title", "Status", "Provider", "Agent"],
      group.sessions.map((session) => [
        String(session.alias),
        formatActiveTime(session.lastInteractionAt),
        session.title || "-",
        session.status || "-",
        session.provider || "-",
        session.agent || "-",
      ]),
    );
  });
}

function sortSessionsBySidebarActivity(sessions) {
  /**
   * CDXC:CliSessions 2026-05-15-20:52
   * The `ghostex sessions` and `gtx sessions` views should mirror the Combined sidebar: keep project groups in sidebar order, but order each project's rows by the same activity priority and Last Active timestamp users see in the app.
   */
  return [...sessions].sort((left, right) => {
    const activityPriorityDelta = getSessionActivitySortPriority(right) - getSessionActivitySortPriority(left);
    if (activityPriorityDelta !== 0) {
      return activityPriorityDelta;
    }

    const activityTimeDelta = getSessionLastInteractionTime(right) - getSessionLastInteractionTime(left);
    if (activityTimeDelta !== 0) {
      return activityTimeDelta;
    }

    return sessions.indexOf(left) - sessions.indexOf(right);
  });
}

function getSessionActivitySortPriority(session) {
  switch (session?.activity ?? session?.status) {
    case "attention":
      return 2;
    case "working":
      return 1;
    default:
      return 0;
  }
}

function getSessionLastInteractionTime(session) {
  const timestamp = Date.parse(session?.lastInteractionAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function groupSessionsByProject(sessions) {
  const groups = [];
  const groupsByProjectId = new Map();
  for (const session of sessions) {
    let group = groupsByProjectId.get(session.projectId);
    if (!group) {
      group = {
        projectName: session.projectName || session.projectPath || "Project",
        sessions: [],
      };
      groupsByProjectId.set(session.projectId, group);
      groups.push(group);
    }
    group.sessions.push(session);
  }
  return groups.map((group) => ({
    ...group,
    sessions: sortSessionsBySidebarActivity(group.sessions),
  }));
}

function printTable(headers, rows) {
  const widths = headers.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...rows.map((row) => visibleLength(String(row[columnIndex] ?? ""))),
    ),
  );
  console.log(formatTableRow(headers, widths));
  for (const row of rows) {
    console.log(formatTableRow(row, widths));
  }
}

function formatTableRow(row, widths) {
  return row
    .map((value, index) => {
      const text = String(value ?? "");
      const padding = " ".repeat(Math.max(0, widths[index] - visibleLength(text)));
      return index === row.length - 1 ? text : `${text}${padding}`;
    })
    .join("  ");
}

function visibleLength(value) {
  return value.length;
}

function formatActiveTime(value) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) {
    return "-";
  }
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

async function runInteractiveShellCommand(command, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn("/bin/zsh", ["-lc", command], {
      cwd,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}

function parseCreateSession(rest, flags) {
  return {
    groupId: flags.groupId,
    input: flags.input ?? rest.slice(1).join(" "),
    title: flags.title ?? rest[0],
  };
}

function parseAgent(rest, flags) {
  return {
    agentId: flags.agentId ?? rest[0],
    groupId: flags.groupId,
  };
}

function parseCommandButton(rest, flags) {
  return { commandId: flags.commandId ?? rest[0] };
}

function parseClickButton(rest, flags) {
  return {
    id: flags.id ?? rest[1],
    kind: flags.kind ?? rest[0],
  };
}

function parseGroup(rest, flags) {
  return { groupId: flags.groupId ?? rest[0] };
}

function parseProject(rest, flags) {
  return {
    name: flags.name,
    path: flags.path ?? rest[0],
    projectId: flags.projectId,
  };
}

function parseProjectPath(rest, flags) {
  return {
    name: flags.name,
    path: flags.path ?? rest[0],
  };
}

function parseSessionSelector(rest, flags) {
  return {
    index: flags.index === undefined ? undefined : Number(flags.index),
    sessionId: flags.sessionId ?? rest[0],
    sessionNumber: flags.sessionNumber === undefined ? undefined : Number(flags.sessionNumber),
  };
}

function parseRename(rest, flags) {
  return {
    ...parseSessionSelector(rest, flags),
    title: flags.title ?? rest.slice(1).join(" "),
  };
}

function parseSessionBoolean(name) {
  return (rest, flags) => ({
    ...parseSessionSelector(rest, flags),
    [name]: parseBoolean(flags[name] ?? flags.value ?? rest[1] ?? "true"),
  });
}

function parseSendText(rest, flags) {
  return {
    ...parseSessionSelector(rest, flags),
    text: flags.text ?? rest.slice(1).join(" "),
  };
}

function parseSendKey(rest, flags) {
  return {
    ...parseSessionSelector(rest, flags),
    key: flags.key ?? rest[1],
  };
}

function parseToggleSection(rest, flags) {
  return {
    collapsed: flags.collapsed === undefined ? undefined : parseBoolean(flags.collapsed),
    section: flags.section ?? rest[0],
  };
}

function parseVisibleCount(rest, flags) {
  return { count: Number(flags.count ?? rest[0]) };
}

function parseViewMode(rest, flags) {
  return { mode: flags.mode ?? rest[0] };
}

function parseUrl(rest, flags) {
  return { url: flags.url ?? rest[0] };
}

function parseAssertCard(rest, flags) {
  return {
    ...parseSessionSelector(rest, flags),
    agentIcon: flags.agentIcon,
    agentName: flags.agentName,
    visible: flags.visible === undefined ? undefined : parseBoolean(flags.visible),
  };
}

function parseWaitFor(rest, flags) {
  return {
    ...parseAssertCard(rest, flags),
    intervalMs: flags.intervalMs === undefined ? undefined : Number(flags.intervalMs),
    timeoutMs: flags.timeoutMs === undefined ? undefined : Number(flags.timeoutMs),
  };
}

function parseArgs(args) {
  const flags = {};
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      rest.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 1) {
      for (const shortFlag of arg.slice(1)) {
        flags[shortFlag] = true;
      }
      continue;
    }
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equalsIndex = body.indexOf("=");
    if (equalsIndex >= 0) {
      flags[toCamelCase(body.slice(0, equalsIndex))] = body.slice(equalsIndex + 1);
      continue;
    }
    const key = toCamelCase(body);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { flags, rest };
}

function filterLogLines(text, flags) {
  let lines = text.split(/\r?\n/).filter(Boolean);
  if (flags.since) {
    lines = lines.filter((line) => line.includes(String(flags.since)) || line > `[${flags.since}`);
  }
  if (flags.grep) {
    lines = lines.filter((line) => line.includes(String(flags.grep)));
  }
  return lines;
}

function parseBoolean(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function helpCommand() {
  console.log(usage());
}

function formatHelpCommand(signature, description) {
  const commandColumnWidth = 58;
  const gap = " ".repeat(Math.max(2, commandColumnWidth - signature.length));
  return `  ${signature}${gap}${description}`;
}

function usage() {
  /**
   * CDXC:CliHelp 2026-05-15-20:33
   * The public Ghostex help menu should follow the organized Zellij/ZMX shape: a short product description, compact usage lines, aligned command groups with aliases beside the command name, and separate explanatory sections for selectors and workflows that would make the command table noisy.
   */
  const sessionCommands = [
    formatHelpCommand("sessions | s | ls [--ungrouped|-u] [--json]", "List running terminal sessions"),
    formatHelpCommand("attach | a <selector>", "Attach to a provider or agent resume command"),
    formatHelpCommand("resume | r <selector>", "Alias for attach"),
    formatHelpCommand("kill | k <selector|all>", "Close one session or every listed session"),
    formatHelpCommand("sleep <selector|all>", "Sleep one session or every listed session"),
    formatHelpCommand("wake <selector|all>", "Wake one session or every listed session"),
    formatHelpCommand("focus <selector> [--json]", "Focus a session in Ghostex"),
  ].join("\n");

  const workspaceCommands = [
    formatHelpCommand("state | dump-state", "Print sidebar state as JSON"),
    formatHelpCommand("create-session [title] [--input text] [--group-id id]", "Create a terminal session"),
    formatHelpCommand("create-agent <agentId> [--group-id id]", "Create a configured agent session"),
    formatHelpCommand("run-agent <agentId>", "Run a configured agent button"),
    formatHelpCommand("run-command <commandId>", "Run a configured command button"),
    formatHelpCommand("click-button <agent|command|section> <id>", "Trigger a sidebar button"),
    formatHelpCommand("switch-project (--project-id|--path|--name) <value>", "Switch active project"),
    formatHelpCommand("add-project <path> [--name name]", "Add a project to Ghostex"),
    formatHelpCommand("focus-session <id|--index n|--session-number n>", "Focus a session by raw selector"),
    formatHelpCommand("focus-group <groupId>", "Focus a project group"),
  ].join("\n");

  const inputCommands = [
    formatHelpCommand("send-text <sessionId> <text>", "Type text into a session"),
    formatHelpCommand("send-enter <sessionId>", "Send Enter to a session"),
    formatHelpCommand("send-key <sessionId> <key>", "Send ctrl-c, escape, tab, or arrow keys"),
    formatHelpCommand("rename-session <sessionId> <title>", "Rename a session"),
    formatHelpCommand("rename-command <sessionId> <title>", "Send the agent rename command"),
  ].join("\n");

  const uiCommands = [
    formatHelpCommand("floating-editor | fe -- <editor> [args...]", "Open a draggable terminal overlay"),
    formatHelpCommand("floating-monaco-editor | fme <file>", "Open a draggable Monaco editor overlay"),
    formatHelpCommand("(close|restart|fork|reload)-session <id>", "Manage a session lifecycle"),
    formatHelpCommand("sleep-session|favorite-session <id> [true|false]", "Set raw session flags"),
    formatHelpCommand("toggle-section <actions|agents> [--collapsed true|false]", "Collapse or expand a sidebar section"),
    formatHelpCommand("set-visible-count <1|2|3|4|6|9>", "Set visible session count"),
    formatHelpCommand("set-view-mode <grid|horizontal|vertical>", "Set session layout mode"),
    formatHelpCommand("open-browser [url]", "Open the browser surface"),
    formatHelpCommand("open-browser-pane", "Open a browser pane"),
    formatHelpCommand("show-browser", "Show the browser surface"),
    formatHelpCommand("move-sidebar", "Move the sidebar"),
  ].join("\n");

  const evidenceCommands = [
    formatHelpCommand("screenshot [output.png]", "Capture the Ghostex window"),
    formatHelpCommand("logs [--file name] [--lines n] [--grep text] [--json]", "Print recent logs"),
    formatHelpCommand("bundle [output-dir] [--lines n]", "Save state, logs, and a screenshot"),
    formatHelpCommand("assert-card <id> [--agent-icon codex] [--visible true]", "Assert card projection"),
    formatHelpCommand("wait-for <id> [--agent-icon codex] [--timeout-ms n]", "Wait for card projection"),
  ].join("\n");

  return `Ghostex CLI - manage running Ghostex terminal sessions

Usage:
  ghostex <command> [args...] [--flags]
  gtx <command> [args...] [--flags]
  bun scripts/ghostex-cli.mjs <command> [args...] [--flags]

Commands:
${sessionCommands}

Workspace:
${workspaceCommands}

Input:
${inputCommands}

UI:
${uiCommands}

Evidence:
${evidenceCommands}

Selectors:
  <selector> can be an alias, session id, title, or project:title.
  Numeric aliases come from the last "ghostex sessions" or "gtx sessions" list.
  Titles match exact first, then case-insensitive substring.

Sessions:
  The sessions command groups by project and sorts each project by sidebar Last Active order by default.
  --ungrouped/-u prints one flat table and adds the Project column.
  Columns are: # Active Title Status Provider Agent.

Attach:
  attach/resume uses the stored tmux, zmx, or zellij provider session when present.
  Without provider metadata, it runs the supported agent resume command in the session project.

Global flags:
  --port <number>       Native bridge port
  --token <token>       Bridge token
  --timeout <ms>        Bridge request timeout
  -h, --help            Show this help
`;
}
