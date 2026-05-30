import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  buildZmxAttachCommand,
  buildZmxExistsCommand,
  buildZmxHistoryCommand,
  buildZmxKillCommand,
  buildZmxSendCommand,
  decideStartupTextDisposition,
  probeZmxSession,
  selectStartupRestoreSessionIds,
} from "../src/zmx-lifecycle.js";
import type { GxserverSessionDomainState } from "../protocol/index.js";
import type { GxserverZmxCommandResult } from "../src/zmx-lifecycle.js";

test("zmx attach command preserves the renderer shell contract", () => {
  const command = buildZmxAttachCommand({
    cwd: "/repo/ghostex",
    sessionName: "P3a91-G8v20",
    title: "Agent task",
    zmxExecutablePath: "/Applications/Ghostex.app/Contents/Resources/Web/bin/zmx",
  });

  assert.match(command, /^\/bin\/zsh -lc '/);
  assert.match(command, /zmx_bin=.*\/Applications\/Ghostex\.app\/Contents\/Resources\/Web\/bin\/zmx/);
  assert.match(command, /unset ZMX_SESSION ZMX_SESSION_PREFIX/);
  assert.match(command, /"\$zmx_bin" list --short/);
  assert.match(command, /\/bin\/zsh -lc "\$zmx_title_notice_command"/);
  assert.match(command, /\/bin\/zsh -lc "\$zmx_persistence_notice_command"/);
  assert.match(command, /cd "\$zmx_cwd" \|\| exit/);
  assert.match(command, /exec "\$zmx_bin" attach "\$zmx_session"/);
  assert.doesNotMatch(command, /command -v zmx/);
});

test("startup text is queued only for missing provider sessions", () => {
  assert.equal(
    decideStartupTextDisposition({ providerState: "exists", startupText: "codex resume abc\n" }),
    "discardExistingProvider",
  );
  assert.equal(
    decideStartupTextDisposition({ providerState: "unknown", startupText: "codex resume abc\n" }),
    "discardUnknownProvider",
  );
  assert.equal(
    decideStartupTextDisposition({ providerState: "missing", startupText: "codex resume abc\n" }),
    "queueAfterTerminalReady",
  );
  assert.equal(decideStartupTextDisposition({ providerState: "missing", startupText: "" }), "none");
});

test("zmx existence probes distinguish exists, missing, and unknown", async () => {
  const exists = await probeZmxSession({
    runZsh: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
    sessionName: "P3a91-G8v20",
    zmxExecutablePath: "/fake/zmx",
  });
  const missing = await probeZmxSession({
    runZsh: async () => ({ exitCode: 1, stderr: "", stdout: "" }),
    sessionName: "P3a91-G8v20",
    zmxExecutablePath: "/fake/zmx",
  });
  const unknown = await probeZmxSession({
    runZsh: async () => ({ exitCode: 127, stderr: "zmx broken", stdout: "" }),
    sessionName: "P3a91-G8v20",
    zmxExecutablePath: "/fake/zmx",
  });

  assert.equal(exists.lifecycleState, "exists");
  assert.equal(missing.lifecycleState, "missing");
  assert.equal(unknown.lifecycleState, "unknown");
  assert.equal(unknown.error, "zmx broken");
});

test("zmx list command failure probes as unknown instead of missing", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "gxserver-zmx-probe-"));
  const zmxPath = path.join(tempDir, "zmx");
  try {
    await writeFile(
      zmxPath,
      `#!/bin/sh
if [ "$1" = "list" ] && [ "$2" = "--short" ]; then
  exit 1
fi
exit 64
`,
    );
    await chmod(zmxPath, 0o755);

    const probe = await probeZmxSession({
      runZsh: runZshCommand,
      sessionName: "P3a91-G8v20",
      zmxExecutablePath: zmxPath,
    });

    assert.equal(probe.lifecycleState, "unknown");
    assert.match(probe.error ?? "", /zmx list --short failed with exit 1/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("successful zmx list without session probes as missing", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "gxserver-zmx-probe-"));
  const zmxPath = path.join(tempDir, "zmx");
  try {
    await writeFile(
      zmxPath,
      `#!/bin/sh
if [ "$1" = "list" ] && [ "$2" = "--short" ]; then
  printf '%s\\n' 'P3a91-G1111'
  exit 0
fi
exit 64
`,
    );
    await chmod(zmxPath, 0o755);

    const probe = await probeZmxSession({
      runZsh: runZshCommand,
      sessionName: "P3a91-G8v20",
      zmxExecutablePath: zmxPath,
    });

    assert.equal(probe.lifecycleState, "missing");
    assert.equal(probe.error, undefined);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("probe runner failures probe as unknown with error details", async () => {
  const error = new Error("spawn /bin/zsh ENOENT") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  const probe = await probeZmxSession({
    runZsh: async () => {
      throw error;
    },
    sessionName: "P3a91-G8v20",
    zmxExecutablePath: "/fake/zmx",
  });

  assert.equal(probe.lifecycleState, "unknown");
  assert.match(probe.error ?? "", /ENOENT/);
  assert.match(probe.error ?? "", /spawn \/bin\/zsh ENOENT/);
});

test("sleep and close kill commands use bundled zmx directly", () => {
  const command = buildZmxKillCommand({
    sessionName: "P3a91-G8v20",
    zmxExecutablePath: "/bundle/zmx",
  });

  assert.match(command, /zmx_bin='\/bundle\/zmx'/);
  assert.match(command, /unset ZMX_SESSION ZMX_SESSION_PREFIX/);
  assert.match(command, /exec "\$zmx_bin" kill "\$zmx_session" --force/);
  assert.doesNotMatch(command, /command -v zmx/);
});

test("zmx session interaction commands use bundled zmx for history and raw input", () => {
  const history = buildZmxHistoryCommand({
    sessionName: "P3a91-G8v20",
    zmxExecutablePath: "/bundle/zmx",
  });
  const send = buildZmxSendCommand({
    sessionName: "P3a91-G8v20",
    text: "hello 'quoted'\r",
    zmxExecutablePath: "/bundle/zmx",
  });

  assert.match(history, /exec "\$zmx_bin" history "\$zmx_session"/);
  assert.match(send, /zmx_text='hello '\\''quoted'\\''\r'/);
  assert.match(send, /exec "\$zmx_bin" send "\$zmx_session" "\$zmx_text"/);
  assert.doesNotMatch(`${history}\n${send}`, /command -v zmx/);
});

test("startup restore selects active visible sessions, not every stored session", () => {
  const session = (sessionId: string, lifecycleState: GxserverSessionDomainState["lifecycleState"]) =>
    ({ kind: "agent", lifecycleState, sessionId }) as Pick<
      GxserverSessionDomainState,
      "kind" | "lifecycleState" | "sessionId"
    >;

  assert.deepEqual(
    selectStartupRestoreSessionIds({
      activeProjectId: "P3a91",
      projects: [
        {
          projectId: "P3a91",
          sessions: [session("G8v20", "running"), session("G1z99", "running"), session("G2abc", "sleeping")],
        },
        {
          projectId: "P4b22",
          sessions: [session("G3def", "running")],
        },
      ],
      visibleSessionIdsByProjectId: new Map([
        ["P3a91", ["G8v20", "G2abc"]],
        ["P4b22", ["G3def"]],
      ]),
    }),
    ["G8v20"],
  );
});

test("zmx exists command does not use PATH zmx", () => {
  const command = buildZmxExistsCommand({
    sessionName: "P3a91-G8v20",
    zmxExecutablePath: "/bundle/zmx",
  });

  assert.match(command, /"\$zmx_bin" list --short/);
  assert.doesNotMatch(command, /command -v zmx/);
});

function runZshCommand(script: string): Promise<GxserverZmxCommandResult> {
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
