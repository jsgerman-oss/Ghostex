import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildOpenCodePluginSource,
  installGxserverAgentHooks,
  normalizeGxserverProcessPath,
  readGxserverAgentHookStatus,
} from "../src/agent-hooks.js";

test("OpenCode hook install is gxserver-owned and cleans legacy config registration", async () => {
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
    const binDir = path.join(homeDir, "bin");
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
    process.env.PATH = `${binDir}:/usr/bin:/bin`;
    process.env.ZDOTDIR = homeDir;

    const installResult = await installGxserverAgentHooks({ homeDir }, { agentIds: ["opencode"] });

    assert.equal(installResult.agents[0]?.agentId, "opencode");
    assert.equal(installResult.agents[0]?.status, "installed");
    assert.equal(installResult.installedPaths.length, 2);
    const notifyHook = await readFile(path.join(homeDir, ".ghostex", "hooks", "agent-shell-notify.sh"), "utf8");
    assert.match(notifyHook, /ghostex-gxserver-agent-notify-hook-marker v2/);
    assert.match(notifyHook, /\/api\/ingestAgentHookEvent/);
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
