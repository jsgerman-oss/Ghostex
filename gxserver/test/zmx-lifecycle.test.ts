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
  GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES,
  probeZmxSession,
  runZshScript,
  selectStartupRestoreSessionIds,
} from "../src/zmx-lifecycle.js";
import type { GxserverSessionDomainState } from "../protocol/index.js";
import type { GxserverZmxCommandResult } from "../src/zmx-lifecycle.js";

test("zmx attach command preserves the renderer shell contract", () => {
  const command = buildZmxAttachCommand({
    cwd: "/repo/ghostex",
    globalSessionRef: "S1a:P3a91:G8v20",
    gxserverAuthTokenFile: "/Users/test/.ghostex/gxserver/auth/token",
    gxserverBaseUrl: "http://127.0.0.1:58744",
    gxserverProtocolVersion: 5,
    sessionName: "S1a-P3a91-G8v20",
    title: "Agent task",
    zmxExecutablePath: "/Applications/Ghostex.app/Contents/Resources/Web/bin/zmx",
  });

  assert.match(command, /^\/bin\/zsh -lc '/);
  assert.match(command, /zmx_bin=.*\/Applications\/Ghostex\.app\/Contents\/Resources\/Web\/bin\/zmx/);
  assert.match(command, /unset ZMX_SESSION ZMX_SESSION_PREFIX/);
  assert.match(command, /export GHOSTEX_GLOBAL_SESSION_REF="\$zmx_global_session_ref"/);
  assert.match(command, /export GHOSTEX_GXSERVER_AUTH_TOKEN_FILE="\$zmx_gxserver_auth_token_file"/);
  assert.match(command, /export GHOSTEX_GXSERVER_BASE_URL="\$zmx_gxserver_base_url"/);
  assert.match(command, /export GHOSTEX_GXSERVER_PROTOCOL_VERSION="\$zmx_gxserver_protocol_version"/);
  assert.match(command, /S1a:P3a91:G8v20/);
  assert.match(command, /http:\/\/127\.0\.0\.1:58744/);
  assert.match(command, /\/Users\/test\/\.ghostex\/gxserver\/auth\/token/);
  assert.match(command, /zmx_prompt_editor_attach_args=/);
  assert.match(command, /GHOSTEX_PROMPT_EDITOR_BACKEND/);
  assert.match(command, /--prompt-editor=monaco/);
  assert.match(command, /"\$zmx_bin" list --short/);
  assert.match(command, /\/bin\/zsh -lc "\$zmx_title_notice_command"/);
  assert.match(command, /\/bin\/zsh -lc "\$zmx_persistence_notice_command"/);
  assert.match(command, /cd "\$zmx_cwd" \|\| exit/);
  assert.match(command, /exec "\$zmx_bin" attach \$zmx_prompt_editor_attach_args "\$zmx_session"/);
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
    sessionName: "S1a-P3a91-G8v20",
    zmxExecutablePath: "/fake/zmx",
  });
  const missing = await probeZmxSession({
    runZsh: async () => ({ exitCode: 1, stderr: "", stdout: "" }),
    sessionName: "S1a-P3a91-G8v20",
    zmxExecutablePath: "/fake/zmx",
  });
  const unknown = await probeZmxSession({
    runZsh: async () => ({ exitCode: 127, stderr: "zmx broken", stdout: "" }),
    sessionName: "S1a-P3a91-G8v20",
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
      sessionName: "S1a-P3a91-G8v20",
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
  printf '%s\\n' 'S1a-P3a91-G1111'
  exit 0
fi
exit 64
`,
    );
    await chmod(zmxPath, 0o755);

    const probe = await probeZmxSession({
      runZsh: runZshCommand,
      sessionName: "S1a-P3a91-G8v20",
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
    sessionName: "S1a-P3a91-G8v20",
    zmxExecutablePath: "/fake/zmx",
  });

  assert.equal(probe.lifecycleState, "unknown");
  assert.match(probe.error ?? "", /ENOENT/);
  assert.match(probe.error ?? "", /spawn \/bin\/zsh ENOENT/);
});

test("sleep and close kill commands use bundled zmx directly", () => {
  const command = buildZmxKillCommand({
    sessionName: "S1a-P3a91-G8v20",
    zmxExecutablePath: "/bundle/zmx",
  });

  assert.match(command, /zmx_bin='\/bundle\/zmx'/);
  assert.match(command, /unset ZMX_SESSION ZMX_SESSION_PREFIX/);
  assert.match(command, /exec "\$zmx_bin" kill "\$zmx_session" --force/);
  assert.doesNotMatch(command, /command -v zmx/);
});

test("zmx session interaction commands use bundled zmx for history and raw input", () => {
  const history = buildZmxHistoryCommand({
    sessionName: "S1a-P3a91-G8v20",
    zmxExecutablePath: "/bundle/zmx",
  });
  const send = buildZmxSendCommand({
    sessionName: "S1a-P3a91-G8v20",
    zmxExecutablePath: "/bundle/zmx",
  });

  assert.match(history, /exec "\$zmx_bin" history "\$zmx_session"/);
  assert.match(send, /exec "\$zmx_bin" send "\$zmx_session"/);
  assert.doesNotMatch(send, /zmx_text=/);
  assert.doesNotMatch(`${history}\n${send}`, /command -v zmx/);
});

test("zmx command runner caps output and pipes stdin without argv payloads", async () => {
  /*
  CDXC:GxserverVerification 2026-05-30-23:32:
  The subprocess runner regression covers the security boundary directly: output caps stop unbounded zmx history accumulation, and stdin support lets gxserver send payloads without placing user text in the shell argv script.
  */
  const stdin = await runZshScript("exec /bin/cat", {
    stdin: "hello from stdin",
    stdoutLimitBytes: GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES,
  });
  assert.equal(stdin.exitCode, 0);
  assert.equal(stdin.stdout, "hello from stdin");

  const capped = await runZshScript("while true; do printf 0123456789; done", {
    stdoutLimitBytes: 25,
    timeoutMs: 5_000,
  });
  assert.equal(capped.exitCode, 125);
  assert.equal(capped.stdout, "0123456789012345678901234");
  assert.equal(capped.stdoutTruncated, true);
  assert.equal(capped.stdoutLimitBytes, 25);
  assert.match(capped.stderr, /stdout exceeded 25 bytes/);
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
    sessionName: "S1a-P3a91-G8v20",
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
