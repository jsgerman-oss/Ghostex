import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildOpenCodePluginSource,
  installGxserverAgentHooks,
  normalizeGxserverProcessPath,
  readGxserverAgentHookStatus,
} from "../src/agent-hooks.js";

function recursiveCommands(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => recursiveCommands(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...(typeof record.command === "string" ? [record.command] : []),
      ...Object.values(record).flatMap((item) => recursiveCommands(item)),
    ];
  }
  return [];
}

type HookRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
};

async function runHookScript(
  filePath: string,
  options: {
    env?: NodeJS.ProcessEnv;
    input?: string;
    keepStdinOpen?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<HookRunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(filePath, [], {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("hook timed out"));
    }, options.timeoutMs ?? 2_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      child.stdin.destroy();
      resolve({ code, signal, stderr, stdout });
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else if (!options.keepStdinOpen) {
      child.stdin.end();
    }
  });
}

async function writeExecutable(filePath: string): Promise<void> {
  await writeFile(filePath, "#!/bin/sh\nexit 0\n");
  await chmod(filePath, 0o755);
}

async function runOpenCodeHookInstallTest(): Promise<void> {
  /*
  CDXC:AgentHooks 2026-06-03-20:28:
  The main-branch OpenCode refresh must land in gxserver, not the macOS sidebar.
  This test pins marker-only status, plugin generation for both OpenCode APIs,
  and cleanup of the old explicit opencode.json plugin registration.
  */
  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  const previousZdotdir = process.env.ZDOTDIR;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-opencode-hooks-"));
  try {
    const binDir = path.join(homeDir, ".local", "bin");
    const configPath = path.join(homeDir, ".config", "opencode", "opencode.json");
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(binDir, "opencode"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(binDir, "opencode"), 0o755);
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({ other: true, plugin: ["./plugins/ghostex-session.js", "./plugins/other.js"] }, null, 2)}\n`,
    );
    process.env.HOME = homeDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.ZDOTDIR = homeDir;

    const installResult = await installGxserverAgentHooks({ homeDir }, { agentIds: ["opencode"] });

    assert.equal(installResult.agents[0]?.agentId, "opencode");
    assert.equal(installResult.agents[0]?.status, "installed");
    assert.equal(installResult.installedPaths.length, 2);
    const notifyHook = await readFile(path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh"), "utf8");
    assert.match(notifyHook, /ghostex-gxserver-agent-notify-hook-marker v4/);
    assert.match(notifyHook, /\/api\/ingestAgentHookEvent/);
    assert.doesNotMatch(notifyHook, /INPUT="\$\(cat\)"/);
    assert.match(notifyHook, /read -r -t 1 INPUT_ARG/);
    assert.match(notifyHook, /tempPathFor/);
    const plugin = await readFile(path.join(homeDir, ".config", "opencode", "plugins", "ghostex-session.js"), "utf8");
    assert.match(plugin, /ghostex-opencode-session-plugin-marker/);
    assert.match(plugin, /return \{\s*event: async/s);
    const config = JSON.parse(await readFile(configPath, "utf8")) as { plugin?: string[] };
    assert.deepEqual(config.plugin, ["./plugins/other.js"]);

    const status = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["opencode"] });
    assert.equal(status.agents[0]?.hookInstalled, true);
  } finally {
    process.env.PATH = previousPath;
    process.env.HOME = previousHome;
    if (previousZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = previousZdotdir;
    }
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function runOldNotifyHookUpdateTest(): Promise<void> {
  /*
  CDXC:AgentHooks 2026-06-07-11:05:
  A provider config that already points at Ghostex's notify hook is not missing
  when the shared script is from the old native installer. Report updateRequired
  and make installAgentHooks rewrite the gxserver notify script without adding
  duplicate provider commands.

  CDXC:AgentHooks 2026-06-07-13:05:
  Normal status reads auto-upgrade only when a Ghostex-owned hook is already
  present. Keep an opt-out assertion for the raw updateRequired state, then
  verify the default read repairs the old artifact without user action.
  */
  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  const previousZdotdir = process.env.ZDOTDIR;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-hook-update-"));
  try {
    const binDir = path.join(homeDir, ".local", "bin");
    const notifyHookPath = path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh");
    const codexHooksPath = path.join(homeDir, ".codex", "hooks.json");
    await mkdir(binDir, { recursive: true });
    await writeExecutable(path.join(binDir, "codex"));
    await mkdir(path.dirname(notifyHookPath), { recursive: true });
    await writeFile(notifyHookPath, "#!/bin/sh\n# old Ghostex native notify hook\nexit 0\n", "utf8");
    await mkdir(path.dirname(codexHooksPath), { recursive: true });
    await writeFile(
      codexHooksPath,
      `${JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: notifyHookPath }, { type: "command", command: "echo keep-user-hook" }] }],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: notifyHookPath }] }],
        },
      }, null, 2)}\n`,
      "utf8",
    );
    process.env.HOME = homeDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.ZDOTDIR = homeDir;

    const status = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["codex"], autoUpgradeInstalled: false });

    assert.equal(status.agents[0]?.status, "updateRequired");
    assert.equal(status.agents[0]?.hookInstalled, false);
    assert.match(status.agents[0]?.detail ?? "", /Update Hooks/);

    const autoUpgradeStatus = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["codex"] });
    assert.equal(autoUpgradeStatus.agents[0]?.status, "installed");
    assert.ok(autoUpgradeStatus.autoUpgradedPaths?.includes(notifyHookPath));
    assert.ok(autoUpgradeStatus.autoUpgradedPaths?.includes(codexHooksPath));
    const notifyHook = await readFile(notifyHookPath, "utf8");
    assert.match(notifyHook, /ghostex-gxserver-agent-notify-hook-marker v4/);
    assert.match(notifyHook, /\/api\/ingestAgentHookEvent/);
    const repairedConfig = JSON.parse(await readFile(codexHooksPath, "utf8")) as unknown;
    const commands = recursiveCommands(repairedConfig);
    assert.equal(commands.filter((command) => command === notifyHookPath).length, 5);
    assert.ok(commands.includes("echo keep-user-hook"));
  } finally {
    process.env.PATH = previousPath;
    process.env.HOME = previousHome;
    if (previousZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = previousZdotdir;
    }
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function runOutdatedGxserverNotifyHookUpdateTest(): Promise<void> {
  /*
  CDXC:AgentHooks 2026-06-07-13:05:
  A gxserver-owned notify hook can still be behaviorally stale even when provider
  configs point at the right shared path. Bump and validate the hook artifact
  marker so older v2 scripts that blocked or raced report updateRequired until
  the user explicitly runs Install/Update Hooks.

  CDXC:AgentHooks 2026-06-07-13:05:
  App updates should not leave users on broken Ghostex-owned v2 hooks. The
  default status path now auto-upgrades that proven existing install to the current marker while
  the opt-out status check still exposes the raw migration state for diagnostics.
  */
  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  const previousZdotdir = process.env.ZDOTDIR;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-hook-outdated-"));
  try {
    const binDir = path.join(homeDir, ".local", "bin");
    const notifyHookPath = path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh");
    const codexHooksPath = path.join(homeDir, ".codex", "hooks.json");
    await mkdir(binDir, { recursive: true });
    await writeExecutable(path.join(binDir, "codex"));
    await mkdir(path.dirname(notifyHookPath), { recursive: true });
    await writeFile(notifyHookPath, "#!/bin/bash\n# ghostex-gxserver-agent-notify-hook-marker v2\nINPUT=\"$(cat)\"\nprintf '{\"continue\":true}'\n", "utf8");
    await chmod(notifyHookPath, 0o755);
    await mkdir(path.dirname(codexHooksPath), { recursive: true });
    await writeFile(
      codexHooksPath,
      `${JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: notifyHookPath }] }],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: notifyHookPath }] }],
        },
      }, null, 2)}\n`,
      "utf8",
    );
    process.env.HOME = homeDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.ZDOTDIR = homeDir;

    const status = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["codex"], autoUpgradeInstalled: false });

    assert.equal(status.agents[0]?.status, "updateRequired");
    assert.equal(status.agents[0]?.hookInstalled, false);
    assert.match(status.agents[0]?.detail ?? "", /Update Hooks/);

    const repairedStatus = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["codex"] });
    assert.equal(repairedStatus.agents[0]?.status, "installed");
    assert.ok(repairedStatus.autoUpgradedPaths?.includes(notifyHookPath));
    assert.ok(repairedStatus.autoUpgradedPaths?.includes(codexHooksPath));
    const notifyHook = await readFile(notifyHookPath, "utf8");
    assert.match(notifyHook, /ghostex-gxserver-agent-notify-hook-marker v4/);
    assert.doesNotMatch(notifyHook, /INPUT="\$\(cat\)"/);
  } finally {
    process.env.PATH = previousPath;
    process.env.HOME = previousHome;
    if (previousZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = previousZdotdir;
    }
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function runLegacyHookCommandRepairTest(): Promise<void> {
  /*
  CDXC:AgentHooks 2026-06-07-11:05:
  Repairing updateRequired hooks must remove Ghostex-owned stale commands from
  provider config while preserving unrelated user hooks. This keeps repair
  idempotent and avoids duplicate old/native and current/gxserver hook events.

  CDXC:AgentHooks 2026-06-07-13:05:
  Status auto-upgrade applies to legacy Ghostex-owned commands too. This is not
  a new hook install because the user already had Ghostex hooks configured; the
  repair swaps stale Ghostex commands for the current gxserver hook command.
  */
  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  const previousZdotdir = process.env.ZDOTDIR;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-hook-legacy-"));
  try {
    const binDir = path.join(homeDir, ".local", "bin");
    const cursorHooksPath = path.join(homeDir, ".cursor", "hooks.json");
    const legacyCommand = path.join(homeDir, ".ghostexterm", "agent-shell-notify.sh");
    await mkdir(binDir, { recursive: true });
    await writeExecutable(path.join(binDir, "cursor-agent"));
    await mkdir(path.dirname(cursorHooksPath), { recursive: true });
    await writeFile(
      cursorHooksPath,
      `${JSON.stringify({
        hooks: {
          beforeSubmitPrompt: [
            { command: legacyCommand },
            { command: "echo keep-user-hook" },
          ],
        },
        version: 1,
      }, null, 2)}\n`,
      "utf8",
    );
    process.env.HOME = homeDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.ZDOTDIR = homeDir;

    const status = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["cursor"], autoUpgradeInstalled: false });

    assert.equal(status.agents[0]?.status, "updateRequired");
    const autoUpgradeStatus = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["cursor"] });
    assert.equal(autoUpgradeStatus.agents[0]?.status, "installed");
    assert.ok(autoUpgradeStatus.autoUpgradedPaths?.includes(path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh")));
    assert.ok(autoUpgradeStatus.autoUpgradedPaths?.includes(cursorHooksPath));
    const repairedConfig = JSON.parse(await readFile(cursorHooksPath, "utf8")) as unknown;
    const commands = recursiveCommands(repairedConfig);
    assert.ok(!commands.includes(legacyCommand));
    assert.ok(commands.includes("echo keep-user-hook"));
    assert.equal(commands.filter((command) => command.includes("agent-shell-notify.sh")).length, 4);

    const repairedStatus = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["cursor"] });
    assert.equal(repairedStatus.agents[0]?.status, "installed");
  } finally {
    process.env.PATH = previousPath;
    process.env.HOME = previousHome;
    if (previousZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = previousZdotdir;
    }
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function runMissingHookStatusDoesNotAutoInstallTest(): Promise<void> {
  /*
  CDXC:AgentHooks 2026-06-07-13:05:
  Auto-upgrade is only for proven Ghostex-owned existing installs. A supported CLI
  with no Ghostex hook markers remains missing on normal status reads so the
  first-time install permission still belongs to the Settings/first-launch click.
  */
  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  const previousZdotdir = process.env.ZDOTDIR;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-hook-missing-"));
  try {
    const binDir = path.join(homeDir, ".local", "bin");
    const notifyHookPath = path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh");
    const codexHooksPath = path.join(homeDir, ".codex", "hooks.json");
    await mkdir(binDir, { recursive: true });
    await writeExecutable(path.join(binDir, "codex"));
    process.env.HOME = homeDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.ZDOTDIR = homeDir;

    const status = await readGxserverAgentHookStatus({ homeDir }, { agentIds: ["codex"] });

    assert.equal(status.agents[0]?.status, "missing");
    assert.equal(status.agents[0]?.hookInstalled, false);
    assert.equal(status.autoUpgradedPaths, undefined);
    await assert.rejects(access(notifyHookPath));
    await assert.rejects(access(codexHooksPath));
  } finally {
    process.env.PATH = previousPath;
    process.env.HOME = previousHome;
    if (previousZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = previousZdotdir;
    }
    await rm(homeDir, { force: true, recursive: true });
  }
}

test("gxserver hook install and migration states are reliable", async () => {
  await runOpenCodeHookInstallTest();
  await runOldNotifyHookUpdateTest();
  await runOutdatedGxserverNotifyHookUpdateTest();
  await runLegacyHookCommandRepairTest();
  await runMissingHookStatusDoesNotAutoInstallTest();
});

test("gxserver notify hook exits cleanly with open stdin and concurrent events", async () => {
  /*
  CDXC:AgentHooks 2026-06-07-13:05:
  Codex hook failures surfaced as missing status codes when stdin stayed open or SessionStart/UserPromptSubmit raced on shared temp files. The shared notify hook must still return the Codex continue contract with no stderr because agent hooks are status sidecars and must never break the agent session.
  */
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-hook-runtime-"));
  try {
    await installGxserverAgentHooks({ homeDir }, { agentIds: ["codex"] });
    const notifyHookPath = path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh");
    const statePath = path.join(homeDir, "state", "session.env");
    const hookStateDirectory = path.join(homeDir, ".ghostexterm");
    const env: NodeJS.ProcessEnv = {
      GHOSTEX_AGENT: "codex",
      GHOSTEX_AGENT_HOOK_STATE_DIR: hookStateDirectory,
      GHOSTEX_GLOBAL_SESSION_REF: "",
      GHOSTEX_GXSERVER_AUTH_TOKEN_FILE: "",
      GHOSTEX_GXSERVER_BASE_URL: "",
      GHOSTEX_GXSERVER_PROTOCOL_VERSION: "",
      GHOSTEX_INTERNAL_PROMPT_GENERATION: "",
      GHOSTEX_INTERNAL_TITLE_GENERATION: "",
      GHOSTEX_SESSION_ID: "surface-runtime",
      GHOSTEX_SESSION_STATE_FILE: statePath,
      GHOSTEX_WORKSPACE_ID: "project-runtime",
      HOME: homeDir,
      VSMUX_SESSION_STATE_FILE: "",
    };

    const openStdinResult = await runHookScript(notifyHookPath, { env, keepStdinOpen: true, timeoutMs: 1_500 });
    assert.equal(openStdinResult.code, 0);
    assert.equal(openStdinResult.signal, null);
    assert.equal(openStdinResult.stderr, "");
    assert.equal(openStdinResult.stdout, '{"continue":true}');

    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) => runHookScript(notifyHookPath, {
        env,
        input: JSON.stringify({
          agent: "codex",
          hook_event_name: index % 2 === 0 ? "SessionStart" : "UserPromptSubmit",
          prompt: `prompt ${index}`,
          session_id: `codex-runtime-${index}`,
        }),
      })),
    );
    for (const result of results) {
      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, '{"continue":true}');
    }
    const state = await readFile(statePath, "utf8");
    assert.match(state, /status=working/);
    const store = JSON.parse(await readFile(path.join(hookStateDirectory, "codex-hook-sessions.json"), "utf8")) as {
      sessions?: Record<string, unknown>;
    };
    assert.ok(Object.keys(store.sessions ?? {}).length > 0);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("gxserver PATH normalization includes shell-tool defaults without duplicates", async () => {
  const pathValue = await normalizeGxserverProcessPath("/usr/bin:/bin:/usr/bin", {
    HOME: "/Users/tester",
    PATH: "/usr/bin:/bin:/usr/bin",
    SHELL: "/bin/false",
  });
  const entries = pathValue.split(":");

  assert.equal(entries.filter((entry) => entry === "/usr/bin").length, 1);
  assert.ok(entries.includes("/Users/tester/.opencode/bin"));
  assert.ok(entries.includes("/Users/tester/.local/share/mise/shims"));
});

test("OpenCode plugin source supports bus and event-return APIs", () => {
  const source = buildOpenCodePluginSource("/tmp/ghostex-notify.sh");

  assert.match(source, /ctx\.bus \|\| ctx\.events \|\| ctx\.event/);
  assert.match(source, /return \{\s*event: async/s);
  assert.match(source, /"\/tmp\/ghostex-notify\.sh"/);
});
