import test from "node:test";
import assert from "node:assert/strict";
import {
  buildZmxAttachCommand,
  buildZmxExistsCommand,
  buildZmxKillCommand,
  decideStartupTextDisposition,
  probeZmxSession,
  selectStartupRestoreSessionIds,
} from "../src/zmx-lifecycle.js";
import type { GxserverSessionDomainState } from "../protocol/index.js";

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
