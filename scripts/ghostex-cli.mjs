#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const QUICK_TERMINALS_PROJECT_NAME = "Quick Terminals";
const RESET_ANSI = "\x1b[0m";
const PICKER_TITLE = "Attach to Ghostex Session";
const PICKER_TITLE_STYLE = "\x1b[1m\x1b[38;2;255;255;255m";
const PROJECT_HEADER_STYLE = "\x1b[1m\x1b[38;2;130;183;255m";
const SELECTED_SESSION_STYLE = "\x1b[1m\x1b[38;2;255;255;255m";
const AGENT_PICKER_INDICATORS = new Map([
  ["amp", { color: "#ffffff", label: "AMP" }],
  ["amp-cli", { color: "#ffffff", label: "AMP" }],
  ["antigravity", { color: "#749bff", label: "AGY" }],
  ["antigravity-cli", { color: "#749bff", label: "AGY" }],
  ["claude", { color: "#d97757", label: "CLD" }],
  ["claude-code", { color: "#d97757", label: "CLD" }],
  ["codex", { color: "#a991ff", label: "CDX" }],
  ["codex-cli", { color: "#a991ff", label: "CDX" }],
  ["copilot", { color: "#ffffff", label: "PLT" }],
  ["cursor", { color: "#749bff", label: "CRS" }],
  ["cursor-cli", { color: "#749bff", label: "CRS" }],
  ["droid", { color: "#ff7a1a", label: "DRD" }],
  ["factory-droid", { color: "#ff7a1a", label: "DRD" }],
  ["gemini", { color: "#8b9aff", label: "GEM" }],
  ["grok", { color: "#ffffff", label: "GRK" }],
  ["grok-build", { color: "#ffffff", label: "GRK" }],
  ["opencode", { color: "#6d96c0", label: "OPN" }],
  ["open-code", { color: "#6d96c0", label: "OPN" }],
  ["pi", { color: "#c8ff62", label: "PIA" }],
  ["t3", { color: "#ff6af3", label: "T3C" }],
  ["t3-code", { color: "#ff6af3", label: "T3C" }],
  ["work-codex", { color: "#a991ff", label: "CDX" }],
]);
const DEFAULT_PICKER_AGENT_INDICATOR = { color: "#9ca3af", label: "UNK" };

const COMMANDS = new Map([
  ["sessions", sessionsCommand],
  ["s", sessionsCommand],
  ["list-sessions", sessionsCommand],
  ["ls", sessionsCommand],
  ["android-check", androidCheckCommand],
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
  ["create-session", bridgeAction("createSession", parseCreateSession, { failOnNotOk: true })],
  ["create-agent", bridgeAction("createAgentSession", parseAgent)],
  ["run-agent", bridgeAction("runAgent", parseAgent)],
  ["run-command", bridgeAction("runCommand", parseCommandButton)],
  ["click-button", bridgeAction("clickButton", parseClickButton)],
  ["focus-session", bridgeAction("focusSession", parseSessionSelector)],
  ["acknowledge-session-attention", bridgeAction("acknowledgeSessionAttention", parseSessionSelector)],
  ["ack-session-attention", bridgeAction("acknowledgeSessionAttention", parseSessionSelector)],
  ["focus-group", bridgeAction("focusGroup", parseGroup)],
  ["switch-project", bridgeAction("switchProject", parseProject)],
  ["move-project", bridgeAction("moveProject", parseProjectMove, { failOnNotOk: true })],
  ["add-project", bridgeAction("addProject", parseProjectPath)],
  ["close-session", bridgeAction("closeSession", parseSessionSelector)],
  ["restart-session", bridgeAction("restartSession", parseSessionSelector)],
  ["fork-session", bridgeAction("forkSession", parseSessionSelector)],
  ["reload-session", bridgeAction("fullReloadSession", parseSessionSelector)],
  ["rename-session", bridgeAction("renameSession", parseRename, { failOnNotOk: true })],
  ["sleep-session", bridgeAction("sleepSession", parseSessionBoolean("sleeping"))],
  ["favorite-session", bridgeAction("favoriteSession", parseSessionBoolean("favorite"))],
  ["send-text", resolvedSessionBridgeAction("sendText", parseSendText)],
  ["send-enter", resolvedSessionBridgeAction("sendEnter", parseSessionSelector)],
  ["send-key", resolvedSessionBridgeAction("sendKey", parseSendKey)],
  ["send-message", sendMessageCommand],
  ["message", sendMessageCommand],
  ["msg", sendMessageCommand],
  ["read-text", readSessionTextCommand],
  ["read-messages", readSessionTextCommand],
  ["read-thread", readSessionTextCommand],
  ["rename-command", resolvedSessionBridgeAction("renameCommand", parseRename)],
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
  ["h", helpCommand],
]);

if (isDirectCliEntryPoint()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectCliEntryPoint() {
  const entryPath = process.argv[1];
  /**
   * CDXC:CliEntrypoint 2026-05-18-01:17:
   * Android reaches the Mac CLI through the installed `ghostex` wrapper, which
   * can execute a Homebrew symlink to this repo's `ghostex-cli.mjs`. Resolve
   * both paths before deciding whether to run `main()`, otherwise the CLI exits
   * zero with no JSON and Android reports "Ghostex CLI did not return JSON."
   */
  if (!entryPath) return false;
  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(entryPath).href;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  /**
   * CDXC:GhostexTui 2026-05-24-19:18:
   * Running bare `ghostex` or `gtx` should open the full terminal TUI. Keep
   * `gtx a <session>` and the attach aliases outside this path so direct
   * single-session attaches remain fast and script-compatible.
   */
  if (argv.length === 0) {
    await ghostexTuiCommand([]);
    return;
  }
  const [commandName, ...args] = argv;
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
    /**
     * CDXC:AndroidRemoteSessions 2026-05-17-14:24:
     * Android remote actions use SSH exit status to decide whether to show
     * recovery UI. Android-facing bridge commands such as rename-session must
     * convert `{ ok: false }` bridge replies into a nonzero CLI exit.
     */
    if ((options.assertOk || options.failOnNotOk) && isFailedCliResult(result)) {
      printJson(result);
      process.exitCode = 1;
      return;
    }
    printJson(result);
  };
}

function resolvedSessionBridgeAction(action, parser = () => ({}), options = {}) {
  return async (args) => {
    const { flags, rest } = parseArgs(args);
    const payload = parser(rest, flags);
    const selector = sessionSelectorFromArgs(rest, flags);
    const resolvedPayload = selector
      ? { ...payload, sessionId: (await resolveCliSessionSelector(selector, flags)).sessionId }
      : payload;
    const result = await sendSidebarCliCommand(action, resolvedPayload, flags);
    if ((options.assertOk || options.failOnNotOk) && isFailedCliResult(result)) {
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
        title: "gte",
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

async function androidCheckCommand(args) {
  const { flags } = parseArgs(args);
  const result = await runAndroidReadinessCheck(flags);
  /**
   * CDXC:AndroidConnectionManagement 2026-05-17-18:20:
   * Ghostex Android needs one Mac-side readiness contract instead of inferring
   * release support from generic session listing. This command proves zmx is on
   * PATH, Ghostex settings are actually set to zmx, and the running app bridge
   * can return the sidebar session inventory used by Android.
   */
  if (flags.json) {
    printJson(result);
  } else if (result.ok) {
    console.log(`Ghostex Android ready: ${result.sessions} sessions, persistence ${result.sessionPersistenceProvider}.`);
  } else {
    console.error(result.error);
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function runAndroidReadinessCheck(flags = {}) {
  const zmxPath = await resolveCommandPath("zmx");
  if (!zmxPath) {
    return {
      error: "zmx not found. Install zmx and set Ghostex session persistence to zmx before connecting from Android.",
      ok: false,
    };
  }

  const settingsResult = await readAndroidReadinessSettings();
  if (!settingsResult.ok) {
    return settingsResult;
  }

  const result = await sendSidebarCliCommand("listSessions", {}, flags).catch((error) => ({
    bridgeOk: false,
    error: error instanceof Error ? error.message : String(error),
    ok: false,
  }));
  if (isFailedCliResult(result)) {
    return {
      bridgeOk: result.bridgeOk,
      error: result.error ?? "Could not load Ghostex sessions from the running app.",
      ok: false,
      sessionPersistenceProvider: settingsResult.sessionPersistenceProvider,
      zmxPath,
    };
  }

  return {
    ok: true,
    sessionPersistenceProvider: settingsResult.sessionPersistenceProvider,
    sessions: Array.isArray(result.sessions) ? result.sessions.length : 0,
    zmxPath,
  };
}

async function readAndroidReadinessSettings(settingsPath = SHARED_SETTINGS_PATH) {
  const text = await readFile(settingsPath, "utf8").catch(() => "");
  if (!text.trim()) {
    return {
      error: `Ghostex settings were not found at ${settingsPath}. Start Ghostex, set Session persistence to zmx, and try again.`,
      ok: false,
    };
  }
  const settings = parseJson(text);
  if (!settings || typeof settings !== "object") {
    return {
      error: `Ghostex settings at ${settingsPath} are not valid JSON. Open Ghostex settings, save Session persistence as zmx, and try again.`,
      ok: false,
    };
  }
  /**
   * CDXC:AndroidConnectionManagement 2026-05-17-20:39:
   * Android supports zmx only for this release, but readiness should not depend
   * on presentation casing or accidental surrounding whitespace in the shared
   * settings JSON. Normalize the provider token before enforcing the contract.
   */
  const provider = settings.sessionPersistenceProvider;
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  if (normalizedProvider !== "zmx") {
    return {
      error: `Ghostex session persistence is set to ${provider || "off"}. Open Ghostex Settings and set Session persistence to zmx before connecting from Android.`,
      ok: false,
      sessionPersistenceProvider: provider || "off",
    };
  }
  return { ok: true, sessionPersistenceProvider: normalizedProvider };
}

async function resolveCommandPath(command) {
  const { stdout } = await execFileAsync("/bin/zsh", ["-lc", `command -v -- ${shellQuote(command)}`]).catch(() => ({
    stdout: "",
  }));
  return stdout.trim().split(/\r?\n/)[0] || "";
}

async function attachSessionCommand(args) {
  const { flags, rest } = parseArgs(args);
  /**
   * CDXC:AndroidRemoteSessions 2026-05-17-13:59:
   * Ghostex Android attaches by stable session id and should use the same
   * documented `--session-id` form as focus, wake, sleep, kill, and rename.
   * Keep positional selectors for human usage.
   *
   * CDXC:CliSessionPicker 2026-05-25-16:05:
   * `ghostex attach`, `gtx attach`, and `gtx a` without a selector should open
   * the lightweight attach picker, not the full TUI. Bare `gtx` owns the full
   * TUI experience while empty attach keeps the fast single-session picker.
   */
  const selector = flags.sessionId ?? rest.join(" ").trim();
  if (!selector) {
    await interactiveSessionPickerCommand(args);
    return;
  }
  const result = await fetchSessionList(flags);
  const session = await resolveOneListedSession(selector, result.sessions ?? []);
  await attachResolvedSession(session);
}

async function attachResolvedSession(session) {
  /**
   * CDXC:CliSessions 2026-05-17-01:33:
   * Sleeping a provider-backed agent session stops the tmux/zmx/zellij runtime to
   * release the agent CLI memory. External attach should therefore prefer the
   * agent resume command for sleeping rows; provider attach remains first for
   * awake rows where the named session is still live.
   */
  const command = buildSessionAttachCommand(session);
  if (!command) {
    throw new Error(
      `Session ${session.alias} has no provider attach command or supported agent resume command.`,
    );
  }
  await runInteractiveShellCommand(command, session.projectPath);
}

async function interactiveSessionPickerCommand(args) {
  const { flags } = parseArgs(args);
  const result = await fetchSessionList(flags, { writeCache: true });
  const sessions = result.sessions ?? [];
  if (sessions.length === 0) {
    console.log("No running terminal sessions.");
    return;
  }
  if (!isInteractiveTerminal()) {
    printSessionPickerRows(sessions);
    return;
  }
  const session = await runInteractiveSessionPicker(sessions);
  if (!session) {
    return;
  }
  await attachResolvedSession(session);
}

async function ghostexTuiCommand(args) {
  const { flags } = parseArgs(args);
  /**
   * CDXC:GhostexTui 2026-05-24-19:18:
   * Bare `ghostex` / `gtx` launches the full Ghostex terminal TUI. Direct
   * attach commands such as `gtx a <session>` stay on the Node attach path so
   * scripts and muscle-memory single-session attaches keep their old behavior.
   * The TUI calls back into this CLI for session inventory and attach so the
   * macOS sidebar remains the source of truth.
   */
  if (!isInteractiveTerminal()) {
    await interactiveSessionPickerCommand(args);
    return;
  }
  const tui = resolveGhostexTuiLaunch(flags);
  /**
   * CDXC:GhostexTui 2026-05-25-15:11:
   * The bare `gtx` launcher must pass TUI environment through `spawn({ env })`.
   * Putting these keys at the top-level options object makes the app build try
   * the full upstream Herdr/Ghostty path and drops the callback command the TUI
   * uses to list and attach Ghostex sessions.
   */
  await runInteractiveProcess(tui.command, tui.args, {
    env: {
      ...process.env,
      ...tui.env,
      GHOSTEX_TUI_CLI_COMMAND: `${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(import.meta.url))}`,
    },
  });
}

function resolveGhostexTuiLaunch(flags = {}) {
  const explicitBin = String(flags.tuiBin ?? process.env.GHOSTEX_TUI_BIN ?? "").trim();
  if (explicitBin) {
    return { args: [], command: explicitBin, env: {} };
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  /**
   * CDXC:GhostexTui 2026-05-25-15:11:
   * Installed Homebrew/app CLIs run from the application resource directory,
   * while local development runs from the source checkout. Probe both the CLI
   * bundle root and the current checkout root so bare `gtx` can find the TUI
   * binary or Cargo manifest instead of emitting cargo errors for a missing
   * bundled `tui/` directory.
   */
  const roots = uniquePaths([
    repoRoot,
    process.env.GHOSTEX_SOURCE_ROOT,
    findGhostexSourceRoot(process.cwd()),
  ]);
  for (const root of roots) {
    const launch = resolveGhostexTuiLaunchFromRoot(root);
    if (launch) {
      return launch;
    }
  }
  throw new Error(
    "Ghostex TUI binary was not found. Build the TUI with `ZIG=/opt/homebrew/opt/zig@0.15/bin/zig cargo build --bin ghostex-tui --manifest-path tui/Cargo.toml`, pass `--tui-bin <path>`, or set GHOSTEX_TUI_BIN.",
  );
}

function resolveGhostexTuiLaunchFromRoot(root) {
  if (!root) {
    return undefined;
  }
  const debugBin = path.join(root, "tui", "target", "debug", "ghostex-tui");
  const releaseBin = path.join(root, "tui", "target", "release", "ghostex-tui");
  if (fileExistsSync(releaseBin)) {
    return { args: [], command: releaseBin, env: {} };
  }
  if (fileExistsSync(debugBin)) {
    return { args: [], command: debugBin, env: {} };
  }
  const manifestPath = path.join(root, "tui", "Cargo.toml");
  if (!fileExistsSync(manifestPath)) {
    return undefined;
  }
  return {
    args: ["run", "--quiet", "--bin", "ghostex-tui", "--manifest-path", manifestPath],
    command: "cargo",
    env: ghostexTuiCargoEnv(),
  };
}

function ghostexTuiCargoEnv() {
  /**
   * CDXC:GhostexTui 2026-05-26-11:06:
   * Bare `gtx` now needs Herdr's Ghostty-backed runtime, so Cargo fallback
   * builds must not use the earlier `GHOSTEX_TUI_LIGHT=1` vt100-only path.
   * On macOS 26.4+, unpatched Zig 0.15.2 cannot link libc from Xcode 26 SDKs;
   * prefer Homebrew's patched `zig@0.15` keg when it exists so first-run
   * fallback builds can produce the real Ghostty terminal backend.
   */
  const env = {};
  const patchedHomebrewZig = "/opt/homebrew/opt/zig@0.15/bin/zig";
  if (fileExistsSync(patchedHomebrewZig)) {
    env.ZIG = patchedHomebrewZig;
  }
  return env;
}

function findGhostexSourceRoot(startPath) {
  let current = path.resolve(startPath || process.cwd());
  while (true) {
    if (fileExistsSync(path.join(current, "scripts", "ghostex-cli.mjs")) && fileExistsSync(path.join(current, "tui", "Cargo.toml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function uniquePaths(paths) {
  const seen = new Set();
  const unique = [];
  for (const candidate of paths) {
    if (!candidate) {
      continue;
    }
    const normalized = path.resolve(String(candidate));
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(normalized);
    }
  }
  return unique;
}

function fileExistsSync(filePath) {
  try {
    realpathSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildSessionAttachCommand(session) {
  if (shouldCreateMissingZmxSessionWithResume(session)) {
    return buildZmxAttachOrResumeCommand(session);
  }
  if (isZmxSession(session) && session.status !== "sleep" && session.attachCommand) {
    /**
     * CDXC:CliSessions 2026-05-26-11:29:
     * Live zmx attaches should use the stored provider attach command for every
     * client, including GTX TUI and mobile, so reattach restores the full zmx
     * terminal state and scrollback instead of only the current viewport.
     */
    return session.attachCommand;
  }
  return session.status === "sleep"
    ? session.resumeCommand || session.attachCommand
    : session.attachCommand || session.resumeCommand;
}

function isZmxSession(session) {
  return String(session.provider ?? "").trim().toLowerCase() === "zmx";
}

function shouldCreateMissingZmxSessionWithResume(session) {
  return (
    isZmxSession(session) &&
    Boolean(String(session.providerSessionName ?? "").trim()) &&
    Boolean(String(session.resumeCommand ?? "").trim())
  );
}

function buildZmxAttachOrResumeCommand(session) {
  const sessionName = String(session.providerSessionName).trim();
  const resumeCommand = String(session.resumeCommand).trim();
  const resumeFallbackCommand = String(session.resumeFallbackCommand ?? "").trim();
  const cwd = String(session.projectPath || ".").trim() || ".";
  const script = `
zmx_session=${shellQuote(sessionName)}
zmx_resume_command=${shellQuote(resumeCommand)}
zmx_resume_fallback_command=${shellQuote(resumeFallbackCommand)}
zmx_cwd=${shellQuote(cwd)}
export zmx_resume_command zmx_resume_fallback_command
unset ZMX_SESSION ZMX_SESSION_PREFIX
if ! command -v zmx >/dev/null 2>&1; then
  printf '%s\\n' 'zmx was not found on PATH.'
  exit 127
fi
if zmx list --short 2>/dev/null | grep -F -x -- "$zmx_session" >/dev/null 2>&1; then
  exec zmx attach "$zmx_session"
fi
cd "$zmx_cwd" || exit
zmx_resume_launcher='
set +e
/bin/zsh -lc "$zmx_resume_command"
zmx_resume_status=$?
if [ "$zmx_resume_status" -ne 0 ] && [ -n "$zmx_resume_fallback_command" ] && [ "$zmx_resume_fallback_command" != "$zmx_resume_command" ]; then
  printf '"'"'%s\\n'"'"' "Exact resume failed; trying saved fallback resume command."
  /bin/zsh -lc "$zmx_resume_fallback_command"
  zmx_resume_status=$?
fi
if [ "$zmx_resume_status" -ne 0 ]; then
  printf '"'"'\\n%s\\n'"'"' "Resume command exited with status $zmx_resume_status. Leaving this pane open for inspection."
  exec "\${SHELL:-/bin/zsh}" -l
fi
exit 0
'
exec zmx attach "$zmx_session" /bin/zsh -lc "$zmx_resume_launcher"
`;
  /**
   * CDXC:AndroidRemoteSessions 2026-05-21-07:21:
   * Mobile sidebar taps run through `ghostex attach --session-id`. If the card's
   * zmx session is gone but the agent has a resume command, recreate the named
   * zmx session and run the agent resume command there instead of opening an
   * attach terminal that immediately exits or becomes an empty shell.
   */
  return `/bin/zsh -lc ${shellQuote(script)}`;
}

function sessionActionCommand(action, pastTense, extraPayload = {}) {
  return async (args) => {
    const { flags, rest } = parseArgs(args);
    /**
     * CDXC:AndroidRemoteSessions 2026-05-17-13:57:
     * Ghostex Android uses `--session-id <id> --json` for remote wake, sleep,
     * and kill actions so every context-menu command has the same stable
     * selector shape as rename. Keep positional selectors for human usage.
     */
    const selector = flags.sessionId ?? rest.join(" ").trim();
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
      /**
       * CDXC:AndroidRemoteSessions 2026-05-17-20:58:
       * Android relies on `ghostex sleep|wake|kill --session-id --json` exit
       * status for recovery UI. Treat bridge-level failures the same as
       * command-level `{ ok: false }`, and preserve JSON output when Android
       * requested it so the phone can extract concise error/message fields.
       */
      if (isFailedCliResult(actionResult)) {
        if (flags.json) {
          printJson(actionResult);
          process.exitCode = 1;
          return;
        }
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
  /**
   * CDXC:AndroidRemoteSessions 2026-05-17-13:57:
   * Android focus is a remote sidebar context action and should use the same
   * structured session-id flag form as lifecycle actions.
   */
  const selector = flags.sessionId ?? rest.join(" ").trim();
  const result = await fetchSessionList(flags);
  const session = await resolveOneListedSession(selector, result.sessions ?? []);
  const actionResult = await sendSidebarCliCommand(
    "focusSession",
    { sessionId: session.sessionId },
    flags,
  );
  /**
   * CDXC:AndroidRemoteSessions 2026-05-17-14:24:
   * Android treats the SSH process exit status as the remote action contract.
   * If focus returns `{ ok: false }`, exit nonzero instead of printing a JSON
   * failure with status 0, otherwise Android would report a failed focus as
   * successful.
   */
  if (isFailedCliResult(actionResult)) {
    if (flags.json) {
      printJson(actionResult);
      process.exitCode = 1;
      return;
    }
    throw new Error(actionResult.error ?? `Could not focus ${session.title}.`);
  }
  if (flags.json) {
    printJson(actionResult);
    return;
  }
  console.log(`focused ${session.alias}: ${session.title}`);
}

async function readSessionTextCommand(args) {
  const { flags, rest } = parseArgs(args);
  const selector = sessionSelectorFromArgs(rest, flags);
  const payload = {
    source: flags.visible === true || flags.source === "visible" ? "visible" : "screen",
    timeoutMs: flags.timeoutMs === undefined ? undefined : Number(flags.timeoutMs),
  };
  if (selector) {
    payload.sessionId = (await resolveCliSessionSelector(selector, flags)).sessionId;
  }
  const result = await sendSidebarCliCommand("readSessionText", payload, flags);
  if (isFailedCliResult(result)) {
    if (flags.json) {
      printJson(result);
      process.exitCode = 1;
      return;
    }
    throw new Error(result.error ?? "Could not read terminal text.");
  }
  const text = String(result.text ?? "");
  const lines = flags.lines === undefined ? undefined : Number(flags.lines);
  if (flags.json) {
    printJson({ ...result, text: limitTextLines(text, lines) });
    return;
  }
  process.stdout.write(limitTextLines(text, lines));
  if (!text.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

async function sendMessageCommand(args) {
  const { flags, rest } = parseArgs(args);
  const explicitSelector = sessionSelectorFromArgs([], flags);
  let selector = explicitSelector;
  let agentId = typeof flags.agent === "string" ? flags.agent : undefined;
  let textStartIndex = 0;

  if (!selector && !agentId && rest[0]) {
    const firstArg = rest[0];
    const result = await fetchSessionList(flags);
    const matches = await resolveListedSessions(firstArg, result.sessions ?? []);
    if (matches.length > 1) {
      throw new Error(`Multiple sessions matched "${firstArg}":\n${formatSessionMatches(matches)}`);
    }
    if (matches.length === 1) {
      selector = firstArg;
      textStartIndex = 1;
    } else {
      agentId = firstArg;
      textStartIndex = 1;
    }
  }

  const text = String(flags.text ?? rest.slice(textStartIndex).join(" "));
  const payload = {
    groupId: flags.groupId,
    sendDelayMs: flags.sendDelayMs === undefined ? undefined : Number(flags.sendDelayMs),
    submit: flags.submit === undefined ? true : parseBoolean(flags.submit),
    text,
  };
  if (selector) {
    payload.sessionId = (await resolveCliSessionSelector(selector, flags)).sessionId;
  } else {
    payload.agentId = agentId;
  }
  const result = await sendSidebarCliCommand("sendMessage", payload, flags);
  if (isFailedCliResult(result)) {
    printJson(result);
    process.exitCode = 1;
    return;
  }
  printJson(result);
}

async function fetchSessionList(flags = {}, options = {}) {
  const result = await sendSidebarCliCommand("listSessions", {}, flags);
  /**
   * CDXC:AndroidRemoteSessions 2026-05-17-21:03:
   * `ghostex sessions --json` is Android reconnect's inventory contract. A
   * bridge transport failure must fail the CLI instead of returning an empty
   * success-shaped session list, otherwise Android would show a misleading
   * "No zmx sessions" state when Ghostex is unreachable.
   */
  if (isFailedCliResult(result)) {
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

function sessionSelectorFromArgs(rest, flags) {
  return String(
    flags.sessionId ??
      flags.selector ??
      flags.session ??
      flags.sessionTitle ??
      flags.target ??
      rest[0] ??
      "",
  ).trim();
}

async function resolveCliSessionSelector(selector, flags) {
  /**
   * CDXC:CliSessionSelectors 2026-05-23-13:18:
   * Cross-session CLI actions need the same id/title/project:title selector
   * behavior as attach/focus so agents can address another visible sidebar
   * thread without knowing its raw runtime id.
   */
  const result = await fetchSessionList(flags);
  return resolveOneListedSession(selector, result.sessions ?? []);
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

function limitTextLines(text, lines) {
  if (!Number.isFinite(lines) || lines <= 0) {
    return text;
  }
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

function printSessionList(sessions, { grouped }) {
  if (sessions.length === 0) {
    console.log("No running terminal sessions.");
    return;
  }
  /**
   * CDXC:CliSessions 2026-05-20-12:20:
   * The human session list should stay compact on narrow terminals: group by
   * project with the project path as the section header, print each session as
   * a short two-line block without field labels, and preserve the sidebar order
   * returned by the native inventory instead of re-sorting in the CLI.
   */
  const projectGroups = groupSessionsPreservingSidebarOrder(sessions);
  if (!grouped) {
    for (const project of projectGroups) {
      for (const session of project.sessions) {
        console.log(
          formatCompactSessionLine(session, {
            projectLabel: project.projectName,
          }),
        );
      }
    }
    return;
  }
  projectGroups.forEach((project, projectIndex) => {
    if (projectIndex > 0) {
      console.log("");
    }
    console.log(project.projectName);
    if (project.projectPath) {
      console.log(project.projectPath);
    }
    for (const session of project.sessions) {
      console.log(formatCompactSessionLine(session));
    }
  });
}

function printSessionPickerRows(sessions) {
  for (const row of buildSessionPickerRows(sessions)) {
    console.log(row.text);
  }
}

function isInteractiveTerminal(input = process.stdin, output = process.stdout) {
  return Boolean(input.isTTY && output.isTTY);
}

function buildSessionPickerModel(sessions) {
  /**
   * CDXC:CliSessionPicker 2026-05-24-18:10:
   * The bare CLI picker is a visual mirror of the macOS sidebar order: project
   * rows are separators named only by project, while selectable session rows
   * render only the saved title string with no alias, status, path, or wrapping
   * metadata. Left/right navigation moves by project boundaries; enter and
   * space select the session for the normal attach flow.
   *
   * CDXC:CliSessionPicker 2026-05-24-18:25:
   * The first no-project terminal group is labeled "Quick Terminals" so
   * scratch terminals are recognizable, section headers get a blank line plus
   * bold colored styling, and each session title keeps an agent-specific color
   * marker in front of the saved title.
   *
   * CDXC:CliSessionPicker 2026-05-24-18:31:
   * Selected sessions recolor the full row, not only the leading agent marker,
   * so the active target remains obvious in terminals where isolated marker
   * color is hard to scan.
   *
   * CDXC:CliSessionPicker 2026-05-24-18:45:
   * The picker opens with an explicit attach prompt and separator before the
   * session sections. Agent marks are colored three-character indicators in
   * square brackets, not glyphs, so every session row has a stable text width.
   *
   * CDXC:CliSessionPicker 2026-05-24-18:47:
   * The picker header is a bright-white bold title with a real terminal rule
   * below it, no blank spacer rows. Navigation wraps at list ends, and Page Up
   * / Page Down jump five sessions at a time for faster long-list movement.
   */
  const groups = groupSessionsPreservingSidebarOrder(sessions).filter(
    (project) => project.sessions.length > 0,
  );
  const items = [
    {
      kind: "title",
      plainText: PICKER_TITLE,
      renderText: `${PICKER_TITLE_STYLE}${PICKER_TITLE}${RESET_ANSI}`,
    },
    {
      kind: "separator",
      plainText: "─",
      renderText: "─",
    },
  ];
  const sessionItems = [];
  let sessionIndex = 0;
  groups.forEach((project, projectIndex) => {
    const startSessionIndex = sessionIndex;
    items.push({
      kind: "project",
      projectIndex,
      plainText: project.projectName,
      renderText: `${PROJECT_HEADER_STYLE}${project.projectName}${RESET_ANSI}`,
    });
    for (const session of project.sessions) {
      const agentIndicator = resolveSessionPickerAgentIndicator(session);
      const title = String(session.title ?? "");
      const item = {
        agentIndicator,
        kind: "session",
        plainText: `[${agentIndicator.label}] ${title}`,
        projectIndex,
        renderText: `${ansiColor(agentIndicator.color)}[${agentIndicator.label}]${RESET_ANSI} ${title}`,
        session,
        sessionIndex,
      };
      items.push(item);
      sessionItems.push(item);
      sessionIndex += 1;
    }
    project.startSessionIndex = startSessionIndex;
    project.endSessionIndex = sessionIndex - 1;
  });
  return { groups, items, sessionItems };
}

function buildSessionPickerRows(sessions, selectedSessionIndex = 0) {
  const model = buildSessionPickerModel(sessions);
  return model.items.map((item) => ({
    ...(item.kind === "session" ? { agentIndicator: item.agentIndicator } : {}),
    kind: item.kind,
    selected: item.kind === "session" && item.sessionIndex === selectedSessionIndex,
    text: item.plainText,
  }));
}

function moveSessionPickerSelection(model, selectedSessionIndex, direction) {
  const sessionCount = model.sessionItems.length;
  if (sessionCount === 0) {
    return 0;
  }
  if (direction === "up") {
    return wrapSessionPickerIndex(selectedSessionIndex - 1, sessionCount);
  }
  if (direction === "down") {
    return wrapSessionPickerIndex(selectedSessionIndex + 1, sessionCount);
  }
  if (direction === "pageup") {
    return wrapSessionPickerIndex(selectedSessionIndex - 5, sessionCount);
  }
  if (direction === "pagedown") {
    return wrapSessionPickerIndex(selectedSessionIndex + 5, sessionCount);
  }
  if (direction === "left" || direction === "right") {
    const current = model.sessionItems[selectedSessionIndex];
    const delta = direction === "left" ? -1 : 1;
    const targetProjectIndex = wrapSessionPickerIndex(current.projectIndex + delta, model.groups.length);
    const targetProject = model.groups[targetProjectIndex];
    return targetProject ? targetProject.startSessionIndex : selectedSessionIndex;
  }
  return selectedSessionIndex;
}

function wrapSessionPickerIndex(index, count) {
  return ((index % count) + count) % count;
}

async function runInteractiveSessionPicker(sessions, input = process.stdin, output = process.stdout) {
  const model = buildSessionPickerModel(sessions);
  if (model.sessionItems.length === 0) {
    return undefined;
  }
  let selectedSessionIndex = 0;
  let viewportStart = 0;
  const wasRaw = input.isRaw === true;
  emitKeypressEvents(input);

  return await new Promise((resolve) => {
    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY && !wasRaw) {
        input.setRawMode(false);
      }
      output.write("\x1b[?7h\x1b[?25h\x1b[?1049l");
    };
    const selectCurrentSession = () => {
      const selected = model.sessionItems[selectedSessionIndex]?.session;
      cleanup();
      resolve(selected);
    };
    const cancel = (exitCode) => {
      if (exitCode !== undefined) {
        process.exitCode = exitCode;
      }
      cleanup();
      resolve(undefined);
    };
    const render = () => {
      viewportStart = renderSessionPicker(model, selectedSessionIndex, viewportStart, output);
    };
    const onKeypress = (_chunk, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cancel(130);
        return;
      }
      if (key.name === "escape" || key.name === "q") {
        cancel();
        return;
      }
      if (key.name === "return" || key.name === "enter" || key.name === "space") {
        selectCurrentSession();
        return;
      }
      const nextSelection = moveSessionPickerSelection(model, selectedSessionIndex, key.name);
      if (nextSelection !== selectedSessionIndex) {
        selectedSessionIndex = nextSelection;
        render();
      }
    };

    output.write("\x1b[?1049h\x1b[?25l\x1b[?7l");
    if (input.isTTY && !wasRaw) {
      input.setRawMode(true);
    }
    input.resume();
    input.on("keypress", onKeypress);
    render();
  });
}

function renderSessionPicker(model, selectedSessionIndex, viewportStart, output) {
  const terminalRows = Math.max(1, Number(output.rows ?? 24));
  const selectedLineIndex = model.items.findIndex(
    (item) => item.kind === "session" && item.sessionIndex === selectedSessionIndex,
  );
  const maxViewportStart = Math.max(0, model.items.length - terminalRows);
  let nextViewportStart = Math.min(viewportStart, maxViewportStart);
  if (selectedLineIndex < nextViewportStart) {
    nextViewportStart = selectedLineIndex;
  } else if (selectedLineIndex >= nextViewportStart + terminalRows) {
    nextViewportStart = selectedLineIndex - terminalRows + 1;
  }

  output.write("\x1b[H");
  for (let row = 0; row < terminalRows; row += 1) {
    const item = model.items[nextViewportStart + row];
    let line = "";
    if (item) {
      const text =
        item.kind === "separator"
          ? `${PROJECT_HEADER_STYLE}${"─".repeat(output.columns ?? 80)}${RESET_ANSI}`
          : item.renderText;
      line =
        item.kind === "session" && item.sessionIndex === selectedSessionIndex
          ? `${SELECTED_SESSION_STYLE}${stripAnsi(text)}${RESET_ANSI}`
          : text;
    }
    output.write(`\x1b[2K${line}${row === terminalRows - 1 ? "" : "\r\n"}`);
  }
  return nextViewportStart;
}

function resolveSessionPickerProjectName(session, isFirstGroup) {
  if (isFirstGroup && !String(session.projectPath ?? "").trim()) {
    return QUICK_TERMINALS_PROJECT_NAME;
  }
  return session.projectName || session.projectPath || QUICK_TERMINALS_PROJECT_NAME;
}

function resolveSessionPickerAgentIndicator(session) {
  const candidates = [
    session.agent,
    session.agentIcon,
    session.agentId,
    session.agentName,
    session.provider,
  ];
  for (const candidate of candidates) {
    const key = normalizeAgentIndicatorKey(candidate);
    if (key && AGENT_PICKER_INDICATORS.has(key)) {
      return AGENT_PICKER_INDICATORS.get(key);
    }
  }
  return DEFAULT_PICKER_AGENT_INDICATOR;
}

function normalizeAgentIndicatorKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-cli$/u, "-cli");
}

function ansiColor(hexColor) {
  const match = String(hexColor).match(/^#?([0-9a-f]{6})$/iu);
  if (!match) {
    return "";
  }
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `\x1b[38;2;${red};${green};${blue}m`;
}

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function formatCompactSessionLine(session, { projectLabel } = {}) {
  const marker = session.isFocused ? "›" : " ";
  const headline = projectLabel
    ? `${marker} #${session.alias}  ${projectLabel} · ${session.title || "-"}`
    : `${marker} #${session.alias}  ${session.title || "-"}`;
  const details = [
    session.agent,
    formatCompactProvider(session),
    session.status,
    formatActiveTime(session.lastInteractionAt),
  ]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0 && value !== "-");
  if (details.length === 0) {
    return headline;
  }
  return `${headline}\n    ${details.join(" · ")}`;
}

function formatCompactProvider(session) {
  const provider = session.provider?.trim();
  const providerSessionName = session.providerSessionName?.trim();
  if (!provider) {
    return undefined;
  }
  if (providerSessionName) {
    return `${provider}/${providerSessionName}`;
  }
  return provider;
}

function groupSessionsPreservingSidebarOrder(sessions) {
  const groups = [];
  const groupsByProjectId = new Map();
  for (const session of sessions) {
    let group = groupsByProjectId.get(session.projectId);
    if (!group) {
      const isFirstGroup = groups.length === 0;
      group = {
        projectName: resolveSessionPickerProjectName(session, isFirstGroup),
        projectPath: session.projectPath || "",
        sessions: [],
      };
      groupsByProjectId.set(session.projectId, group);
      groups.push(group);
    }
    group.sessions.push(session);
  }
  return groups;
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
  await runInteractiveProcess("/bin/zsh", ["-lc", command], { cwd });
}

async function runInteractiveProcess(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
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
  /**
   * CDXC:AndroidRemoteSessions 2026-05-18-02:31:
   * Ghostex Android creates new terminals through `ghostex create-session`
   * over SSH. Preserve project/group flags so the running Mac app owns the
   * creation path and applies the active zmx persistence setting.
   */
  return {
    groupId: flags.groupId,
    input: flags.input ?? rest.slice(1).join(" "),
    projectId: flags.projectId,
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

function parseProjectMove(rest, flags) {
  /**
   * CDXC:AndroidSidebar 2026-05-18-16:13:
   * Ghostex Android reorders project groups through the Mac CLI, not local phone
   * state. The desktop sidebar remains the source of truth and later inventory
   * calls return the persisted order to mobile.
   */
  return {
    direction: flags.direction ?? flags.dir ?? rest[1],
    projectId: flags.projectId ?? rest[0],
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
  /**
   * CDXC:AndroidRemoteSessions 2026-05-17-13:23:
   * Ghostex Android invokes remote rename through `ghostex rename-session --session-id <id> --title <title> --json` so SSH quoting can keep the stable session id and user-entered title as separate CLI arguments. Keep positional parsing for human CLI usage, but treat the flag form as part of the Android/macOS bridge contract.
   */
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
  const hasFlagSelector =
    flags.sessionId || flags.selector || flags.session || flags.sessionTitle || flags.target;
  return {
    ...parseSessionSelector(rest, flags),
    text: flags.text ?? rest.slice(hasFlagSelector ? 0 : 1).join(" "),
  };
}

function parseSendKey(rest, flags) {
  const hasFlagSelector =
    flags.sessionId || flags.selector || flags.session || flags.sessionTitle || flags.target;
  return {
    ...parseSessionSelector(rest, flags),
    key: flags.key ?? rest[hasFlagSelector ? 0 : 1],
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

function isFailedCliResult(result) {
  return result?.ok === false || result?.bridgeOk === false;
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
   * The public Ghostex help menu should follow the organized zellij/zmx shape: a short product description, compact usage lines, aligned command groups with aliases beside the command name, and separate explanatory sections for selectors and workflows that would make the command table noisy.
   */
  const sessionCommands = [
    formatHelpCommand("sessions | s | ls [--ungrouped|-u] [--json]", "List running terminal sessions"),
    formatHelpCommand("android-check [--json]", "Verify this Mac is ready for Ghostex Android"),
    formatHelpCommand("attach | a [selector]", "Attach to a provider session, or open the picker without a selector"),
    formatHelpCommand("resume | r [selector]", "Alias for attach"),
    formatHelpCommand("attach | a --session-id <id>", "Flag form used by Android session attach"),
    formatHelpCommand("kill | k <selector|all> [--json]", "Close one session or every listed session"),
    formatHelpCommand("sleep <selector|all> [--json]", "Sleep one session or every listed session"),
    formatHelpCommand("wake <selector|all> [--json]", "Wake one session or every listed session"),
    formatHelpCommand("focus <selector> [--json]", "Focus a session in Ghostex"),
    formatHelpCommand("(focus|sleep|wake|kill) --session-id <id> [--json]", "Flag form used by Android sidebar actions"),
  ].join("\n");

  const workspaceCommands = [
    formatHelpCommand("state | dump-state", "Print sidebar state as JSON"),
    formatHelpCommand("create-session [title] [--input text] [--project-id id] [--group-id id]", "Create a terminal session"),
    formatHelpCommand("create-agent <agentId> [--group-id id]", "Create a configured agent session"),
    formatHelpCommand("run-agent <agentId>", "Run a configured agent button"),
    formatHelpCommand("run-command <commandId>", "Run a configured command button"),
    formatHelpCommand("click-button <agent|command> <id>", "Trigger a sidebar button"),
    formatHelpCommand("switch-project (--project-id|--path|--name) <value>", "Switch active project"),
    formatHelpCommand("move-project --project-id id --direction up|down", "Move a project in the desktop sidebar order"),
    formatHelpCommand("add-project <path> [--name name]", "Add a project to Ghostex"),
    formatHelpCommand("focus-session <id|--index n|--session-number n>", "Focus a session by raw selector"),
    formatHelpCommand("acknowledge-session-attention <selector>", "Mark a session's shared attention event as seen"),
    formatHelpCommand("focus-group <groupId>", "Focus a project group"),
  ].join("\n");

  const inputCommands = [
    formatHelpCommand("send-text <selector> <text>", "Type text into a session by id or quoted title"),
    formatHelpCommand("send-enter <selector>", "Send Enter to a session by id or quoted title"),
    formatHelpCommand("send-key <selector> <key>", "Send ctrl-c, escape, tab, or arrow keys"),
    formatHelpCommand("send-message <selector> <text>", "Type text and Enter into an existing session"),
    formatHelpCommand("send-message <agentId> <text>", "Create a visible agent session, send text, and return its Ghostex id"),
    formatHelpCommand("read-text <selector> [--lines n] [--visible] [--json]", "Read terminal text by id or quoted title"),
    formatHelpCommand("rename-session <sessionId> <title> [--json]", "Rename a session"),
    formatHelpCommand("rename-session --session-id <id> --title <title> [--json]", "Flag form used by Android SSH actions"),
    formatHelpCommand("rename-command <selector> <title>", "Send the agent rename command"),
  ].join("\n");

  const uiCommands = [
    formatHelpCommand("floating-editor | fe -- <editor> [args...]", "Open a draggable terminal overlay"),
    formatHelpCommand("floating-monaco-editor | fme <file>", "Open a draggable Monaco editor overlay"),
    formatHelpCommand("(close|restart|fork|reload)-session <id>", "Manage a session lifecycle"),
    formatHelpCommand("sleep-session|favorite-session <id> [true|false]", "Set raw session flags"),
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
  ghostex
  gtx
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
  Running ghostex or gtx with no subcommand opens the Ghostex terminal TUI.
  The TUI shows the attached session, with a top switch button for project/session switching.
  The switcher lists Ghostex projects and sessions in macOS sidebar order and attaches through the existing zmx path.
  Direct attach stays available through attach/a/resume/r without opening the TUI.
  Projects and sessions follow the macOS sidebar order, including the active Last Active sort mode.
  Each project prints its path once as the section header, then compact session rows without field labels.
  --ungrouped/-u prints one flat list and prefixes each row with the project name.

Attach:
  attach/resume uses the stored tmux, zmx, or zellij provider session when present.
  Without provider metadata, it runs the supported agent resume command in the session project.

Global flags:
  --port <number>       Native bridge port
  --token <token>       Bridge token
  --timeout <ms>        Bridge request timeout
  help | h              Show this help
  -h, --help            Show this help
`;
}

export {
  buildSessionPickerModel,
  buildSessionPickerRows,
  buildSessionAttachCommand,
  formatCompactSessionLine,
  groupSessionsPreservingSidebarOrder,
  isFailedCliResult,
  moveSessionPickerSelection,
  parseArgs,
  parseCreateSession,
  parseRename,
  readAndroidReadinessSettings,
  usage,
};
