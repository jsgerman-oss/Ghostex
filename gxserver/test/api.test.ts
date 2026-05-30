import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import {
  GXSERVER_LOCAL_API_PORT,
  GXSERVER_PROTOCOL_VERSION,
  type GxserverAuthToken,
  type GxserverRuntimeMetadata,
} from "../protocol/index.js";
import { GXSERVER_PROTOCOL_HEADER } from "../src/api.js";
import { ensureGxserverAuthToken } from "../src/auth.js";
import { GxserverEventHub } from "../src/events.js";
import { LEGACY_MACOS_STATE_IMPORT_ID } from "../src/legacy-macos-state-migration.js";
import { createGxserverLogger } from "../src/logger.js";
import { getGxserverPaths } from "../src/paths.js";
import type { GxserverPaths } from "../src/paths.js";
import { createGxserverHttpServer, type GxserverApiRuntime } from "../src/server.js";
import { createGxserverMigrationStatus, initializeGxserverStorage, readGxserverConfig } from "../src/storage.js";
import type { GxserverZmxCommandRunner } from "../src/zmx-lifecycle.js";

test("minimal health is unauthenticated and non-health APIs require auth", async () => {
  await withApiServer("local", async ({ baseUrl }) => {
    const health = await requestJson(baseUrl, "/api/health", { method: "GET" });
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, {
      ok: true,
      product: "gxserver",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      version: "0.1.0-test",
    });

    const protectedResponse = await requestJson(baseUrl, "/api/listSessions", { method: "POST" });
    assert.equal(protectedResponse.status, 401);
    assert.equal(protectedResponse.body.error, "unauthorized");
  });
});

test("foreground gxserver process uses temporary HOME, writes daemon state, and stops only the control plane", async (t) => {
  /*
  CDXC:GxserverVerification 2026-05-30-18:37:
  Cutover verification needs at least one real gxserver foreground-process fixture with an isolated HOME, not only in-process HTTP handlers. The smoke proves auth token creation, SQLite/log initialization, authenticated health, and control-plane stop without touching the user's normal daemon state.
  */
  if (!(await isFixedLocalPortAvailable())) {
    t.skip(`127.0.0.1:${GXSERVER_LOCAL_API_PORT} is already in use; skipping the real foreground gxserver process fixture.`);
    return;
  }

  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-foreground-home-"));
  const paths = getGxserverPaths(homeDir);
  const cliPath = path.resolve("dist/src/cli.js");
  const child = spawn(process.execPath, [cliPath, "--foreground"], {
    cwd: path.resolve("."),
    env: { ...process.env, HOME: homeDir },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    const token = (await waitForFileText(paths.authTokenFile, 5_000)).trim() as GxserverAuthToken;
    const health = await waitForHealth(token, 5_000);
    assert.equal(health.serverId.startsWith("S"), true);
    assert.equal(health.migration.currentVersion, 2);
    assert.equal(health.listeners.local.port, GXSERVER_LOCAL_API_PORT);

    const stop = await requestJson(`http://127.0.0.1:${GXSERVER_LOCAL_API_PORT}`, "/api/control/stop", {
      body: { protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(stop.status, 200);
    await waitForProcessExit(child, 5_000);

    const logs = await readFile(paths.logFile, "utf8");
    assert.match(logs, /"event":"serverStarted"/);
    assert.match(await readFile(paths.runtimeMetadataFile, "utf8").catch(() => ""), /^$/);
    assert.equal(stdout.trim(), "");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await waitForProcessExit(child, 2_000).catch(() => child.kill("SIGKILL"));
    }
    assert.equal(stderr.trim(), "", stderr);
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("RPC endpoints require POST and the exact gxserver protocol version", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const preflight = await requestJson(baseUrl, "/api/attachSessionMetadata", {
      method: "OPTIONS",
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.body, undefined);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /authorization/);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /x-gxserver-protocol-version/);

    const getResponse = await requestJson(baseUrl, "/api/listSessions", {
      method: "GET",
      token,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
    });
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.body.error, "methodNotAllowed");

    const missingProtocol = await requestJson(baseUrl, "/api/listSessions", {
      method: "POST",
      token,
    });
    assert.equal(missingProtocol.status, 426);
    assert.equal(missingProtocol.body.error, "protocolMismatch");
    assert.match(missingProtocol.body.message, /Update Ghostex and gxserver/);

    const wrongProtocol = await requestJson(baseUrl, "/api/listSessions", {
      method: "POST",
      protocolVersion: 999,
      token,
    });
    assert.equal(wrongProtocol.status, 426);
    assert.equal(wrongProtocol.body.error, "protocolMismatch");

    const bodyProtocol = await requestJson(baseUrl, "/api/listSessions", {
      body: { protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.equal(bodyProtocol.status, 200);
    assert.deepEqual(bodyProtocol.body.result.sessions, []);
  });
});

test("local listener has full API while remote listener blocks dangerous local-only operations", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const localRunProcess = await requestJson(baseUrl, "/api/runProcess", {
      body: {},
      method: "POST",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(localRunProcess.status, 501);
    assert.equal(localRunProcess.body.error, "notImplemented");
  });

  await withApiServer("remote", async ({ baseUrl, token }) => {
    const remoteRunProcess = await requestJson(baseUrl, "/api/runProcess", {
      body: {},
      method: "POST",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(remoteRunProcess.status, 403);
    assert.equal(remoteRunProcess.body.error, "forbidden");

    const remoteQueryLogs = await requestJson(baseUrl, "/api/queryLogs", {
      body: { params: {}, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(remoteQueryLogs.status, 403);
    assert.equal(remoteQueryLogs.body.error, "forbidden");

    const remoteListSessions = await requestJson(baseUrl, "/api/listSessions", {
      body: {},
      method: "POST",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(remoteListSessions.status, 200);
    assert.deepEqual(remoteListSessions.body.result.sessions, []);
  });
});

test("project and session domain-state APIs create, update, list, and keep client layout separate", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const createdProject = await requestJson(baseUrl, "/api/createProject", {
      body: {
        params: {
          customAgentOrder: ["codex-pro"],
          customAgents: [{ agentId: "codex-pro", command: "codex --profile pro", name: "Codex Pro" }],
          customCommandOrder: ["setup"],
          customCommands: [{ command: "npm install", commandId: "setup", name: "Setup" }],
          isFavorite: true,
          isPinned: true,
          launchSettings: { acceptAll: true },
          name: "Ghostex",
          path: "/repo/ghostex",
          previousSessionHistory: [{ historyId: "hist-1", primaryTitle: "Old run" }],
          runtimeSettings: { defaultPromptAgentId: "codex" },
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(createdProject.status, 200);
    const project = createdProject.body.result.project;
    assert.match(project.projectId, /^P[0-9][a-z0-9]{3}$/);
    assert.equal(project.isPinned, true);
    assert.equal(project.customAgents[0].agentId, "codex-pro");

    const originalSession = await requestJson(baseUrl, "/api/createAgentSession", {
      body: {
        params: {
          agentId: "codex",
          projectId: project.projectId,
          providerState: { lifecycleState: "exists" },
          title: "Original title",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(originalSession.status, 200);
    const original = originalSession.body.result.session;
    assert.match(original.sessionId, /^G[0-9][a-z0-9]{3}$/);
    assert.equal(original.zmxName, `${project.projectId}-${original.sessionId}`);

    const restoredSession = await requestJson(baseUrl, "/api/createSession", {
      body: {
        params: {
          isPinned: true,
          projectId: project.projectId,
          restoredFromHistoryId: "hist-1",
          restoredFromSessionId: original.sessionId,
          title: "Restored title stays user-owned",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(restoredSession.status, 200);
    const restored = restoredSession.body.result.session;
    assert.notEqual(restored.sessionId, original.sessionId);
    assert.equal(restored.title, "Restored title stays user-owned");
    assert.equal(restored.hiddenMetadata.restoredFromSessionId, original.sessionId);
    assert.equal(JSON.stringify(restored).includes("restored from"), false);

    const updatedSession = await requestJson(baseUrl, "/api/updateSession", {
      body: {
        params: {
          isFavorite: true,
          lifecycleState: "sleeping",
          projectId: project.projectId,
          runtimeSettings: { delayedSendMs: 250 },
          sessionId: restored.sessionId,
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(updatedSession.status, 200);
    assert.equal(updatedSession.body.result.session.title, "Restored title stays user-owned");
    assert.equal(updatedSession.body.result.session.isFavorite, true);
    assert.equal(updatedSession.body.result.session.runtimeSettings.delayedSendMs, 250);

    const layout = await requestJson(baseUrl, "/api/updateClientLayout", {
      body: {
        params: {
          clientId: "macos-sidebar",
          layout: { split: "right", tabs: [restored.sessionId], visibleSessionCount: 1 },
          projectId: project.projectId,
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(layout.status, 200);
    assert.equal(layout.body.result.layout.layout.split, "right");

    const projectStatus = await requestJson(baseUrl, "/api/readProjectStatus", {
      body: {
        params: { projectId: project.projectId },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(projectStatus.status, 200);
    assert.equal(projectStatus.body.result.project.runtimeSettings.defaultPromptAgentId, "codex");
    assert.equal("layout" in projectStatus.body.result.project, false);
    assert.equal(projectStatus.body.result.sessions.length, 2);
  });
});

test("zmx lifecycle APIs attach existing sessions without replay and create missing sessions with cwd", async () => {
  const calls: string[] = [];
  let probeExitCode = 0;
  await withApiServer(
    "local",
    async ({ baseUrl, paths, token }) => {
      const cwd = paths.rootDir;
      const project = (
        await requestJson(baseUrl, "/api/createProject", {
          body: { params: { name: "Ghostex", path: cwd }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.project;
      const session = (
        await requestJson(baseUrl, "/api/createAgentSession", {
          body: {
            params: {
              agentId: "codex",
              launchSettings: { acceptAllMode: "enabled" },
              projectId: project.projectId,
              runtimeSettings: {
                agentSessionId: "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56",
                titleSource: "user",
              },
              title: "Existing agent",
            },
            protocolVersion: GXSERVER_PROTOCOL_VERSION,
          },
          method: "POST",
          token,
        })
      ).body.result.session;
      assert.equal(session.launchSettings.agentLaunchPlan.command, "codex --yolo");

      probeExitCode = 0;
      const existing = await requestJson(baseUrl, "/api/attachSessionMetadata", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(existing.status, 200);
      assert.equal(existing.body.result.attach.providerState.lifecycleState, "exists");
      assert.equal(existing.body.result.attach.persistenceSessionCreated, false);
      assert.equal(existing.body.result.attach.startupTextDisposition, "discardExistingProvider");
      assert.equal(existing.body.result.attach.startupText, undefined);
      assert.match(existing.body.result.attach.attachCommand, /^\/bin\/zsh -lc '/);

      probeExitCode = 1;
      const missing = await requestJson(baseUrl, "/api/wakeSession", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(missing.status, 200);
      assert.equal(missing.body.result.attach.providerState.lifecycleState, "missing");
      assert.equal(missing.body.result.attach.persistenceSessionCreated, true);
      assert.equal(missing.body.result.attach.startupTextDisposition, "queueAfterTerminalReady");
      assert.match(missing.body.result.attach.startupText, /codex resume "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56"/);
      assert.equal(missing.body.result.session.lifecycleState, "running");
      assert.ok(calls.some((script) => script.includes("list --short")));
    },
    {
      zmxLifecycle: fakeZmxLifecycle(calls, () => probeExitCode),
    },
  );
});

test("gxserver restart preserves session state and does not replay startup text into existing zmx", async () => {
  /*
  CDXC:GxserverVerification 2026-05-30-18:37:
  Restarting gxserver must preserve durable project/session/zmx metadata while leaving provider sessions alive. Reattached existing zmx sessions discard queued resume text so app restart cannot replay agent commands into an already-running backend.
  */
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-api-restart-"));
  const calls: string[] = [];
  try {
    let first = await startApiServerFixture(homeDir, "local", {
      zmxLifecycle: fakeZmxLifecycle(calls, () => 1),
    });
    let projectId = "";
    let sessionId = "";
    try {
      const createdProject = await requestJson(first.baseUrl, "/api/createProject", {
          body: { params: { name: "Ghostex", path: first.paths.rootDir }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token: first.token,
      });
      assert.equal(createdProject.status, 200);
      const project = createdProject.body.result.project;
      projectId = project.projectId;
      const createdSession = await requestJson(first.baseUrl, "/api/createAgentSession", {
          body: {
            params: {
              agentId: "codex",
              projectId,
              runtimeSettings: { agentSessionId: "existing-thread" },
              title: "Restarted agent",
            },
            protocolVersion: GXSERVER_PROTOCOL_VERSION,
          },
          method: "POST",
          token: first.token,
      });
      assert.equal(createdSession.status, 200);
      const session = createdSession.body.result.session;
      sessionId = session.sessionId;
      assert.equal(session.zmxName, `${projectId}-${sessionId}`);
    } finally {
      await first.close();
    }

    const second = await startApiServerFixture(homeDir, "local", {
      zmxLifecycle: fakeZmxLifecycle(calls, () => 0),
    });
    try {
      const attach = await requestJson(second.baseUrl, "/api/attachSessionMetadata", {
        body: {
          params: { projectId, sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token: second.token,
      });
      assert.equal(attach.status, 200);
      assert.equal(attach.body.result.attach.providerState.lifecycleState, "exists");
      assert.equal(attach.body.result.attach.persistenceSessionCreated, false);
      assert.equal(attach.body.result.attach.startupTextDisposition, "discardExistingProvider");
      assert.equal(attach.body.result.attach.startupText, undefined);
      assert.equal(attach.body.result.attach.session.zmxName, `${projectId}-${sessionId}`);
      assert.ok(calls.some((script) => script.includes("list --short")));
      assert.equal(calls.some((script) => script.includes('kill "$zmx_session" --force')), false);
    } finally {
      await second.close();
    }
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("missing bundled zmx hard-fails attach metadata instead of generating a fallback command", async () => {
  await withApiServer(
    "local",
    async ({ baseUrl, paths, token }) => {
      const project = (
        await requestJson(baseUrl, "/api/createProject", {
          body: { params: { name: "Ghostex", path: paths.rootDir }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.project;
      const session = (
        await requestJson(baseUrl, "/api/createSession", {
          body: { params: { projectId: project.projectId, title: "No zmx" }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.session;

      const response = await requestJson(baseUrl, "/api/attachSessionMetadata", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });

      assert.equal(response.status, 500);
      assert.equal(response.body.error, "internalError");
      assert.match(response.body.message, /bundled zmx missing/);
      assert.equal(JSON.stringify(response.body).includes("attachCommand"), false);
    },
    {
      zmxLifecycle: {
        requireZmx: async () => {
          throw new Error("bundled zmx missing");
        },
        runZsh: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      },
    },
  );
});

test("agent activity API updates semantic activity and last active state", async () => {
  await withApiServer(
    "local",
    async ({ baseUrl, paths, token }) => {
      const project = (
        await requestJson(baseUrl, "/api/createProject", {
          body: { params: { name: "Ghostex", path: paths.rootDir }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.project;
      const session = (
        await requestJson(baseUrl, "/api/createAgentSession", {
          body: {
            params: { agentId: "codex", projectId: project.projectId, title: "Activity agent" },
            protocolVersion: GXSERVER_PROTOCOL_VERSION,
          },
          method: "POST",
          token,
        })
      ).body.result.session;

      const launch = await requestJson(baseUrl, "/api/updateAgentActivity", {
        body: {
          params: {
            event: "launch",
            nowMs: Date.parse("2026-05-30T12:00:00.000Z"),
            projectId: project.projectId,
            sessionId: session.sessionId,
          },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(launch.status, 200);
      assert.equal(launch.body.result.session.runtimeSettings.agentActivity.activity, "idle");
      assert.equal(
        launch.body.result.session.runtimeSettings.agentActivity.suppressedUntil,
        "2026-05-30T12:00:12.000Z",
      );

      const working = await requestJson(baseUrl, "/api/updateAgentActivity", {
        body: {
          params: {
            activity: "working",
            nowMs: Date.parse("2026-05-30T12:00:13.000Z"),
            projectId: project.projectId,
            sessionId: session.sessionId,
          },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(working.status, 200);
      assert.equal(working.body.result.session.runtimeSettings.agentActivity.activity, "working");
      assert.equal(working.body.result.session.lastActiveAt, "2026-05-30T12:00:13.000Z");
    },
    {
      zmxLifecycle: fakeZmxLifecycle([], () => 0),
    },
  );
});

test("missing cwd blocks restore when the provider session is missing", async () => {
  await withApiServer(
    "local",
    async ({ baseUrl, paths, token }) => {
      const project = (
        await requestJson(baseUrl, "/api/createProject", {
          body: {
            params: { name: "Ghostex", path: path.join(paths.rootDir, "deleted-project") },
            protocolVersion: GXSERVER_PROTOCOL_VERSION,
          },
          method: "POST",
          token,
        })
      ).body.result.project;
      const session = (
        await requestJson(baseUrl, "/api/createSession", {
          body: { params: { projectId: project.projectId, title: "Dead cwd" }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.session;

      const response = await requestJson(baseUrl, "/api/attachSessionMetadata", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId, startupText: "codex resume abc\n" },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.result.attach.providerState.lifecycleState, "missing");
      assert.equal(response.body.result.attach.restoreBlocked.reason, "missingCwd");
      assert.equal(response.body.result.attach.attachCommand, undefined);
    },
    {
      zmxLifecycle: fakeZmxLifecycle([], () => 1),
    },
  );
});

test("explicit sleep and close kill the zmx provider session", async () => {
  const calls: string[] = [];
  await withApiServer(
    "local",
    async ({ baseUrl, paths, token }) => {
      const project = (
        await requestJson(baseUrl, "/api/createProject", {
          body: { params: { name: "Ghostex", path: paths.rootDir }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.project;
      const session = (
        await requestJson(baseUrl, "/api/createSession", {
          body: { params: { projectId: project.projectId, title: "Kill me" }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.session;

      const sleep = await requestJson(baseUrl, "/api/sleepSession", {
        body: { params: { projectId: project.projectId, sessionId: session.sessionId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
        method: "POST",
        token,
      });
      assert.equal(sleep.status, 200);
      assert.equal(sleep.body.result.kill.killed, true);
      assert.equal(sleep.body.result.session.lifecycleState, "sleeping");

      const close = await requestJson(baseUrl, "/api/killSession", {
        body: { params: { projectId: project.projectId, sessionId: session.sessionId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
        method: "POST",
        token,
      });
      assert.equal(close.status, 200);
      assert.equal(close.body.result.kill.killed, true);
      assert.equal(close.body.result.session.lifecycleState, "stopped");
      assert.equal(calls.filter((script) => script.includes('kill "$zmx_session" --force')).length, 2);
    },
    {
      zmxLifecycle: fakeZmxLifecycle(calls, () => 0),
    },
  );
});

test("migrated zmx sessions keep using the legacy provider session name", async () => {
  const calls: string[] = [];
  await withApiServer(
    "local",
    async ({ baseUrl, paths, token }) => {
      const project = (
        await requestJson(baseUrl, "/api/createProject", {
          body: { params: { name: "Ghostex", path: paths.rootDir }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.project;
      const session = (
        await requestJson(baseUrl, "/api/createSession", {
          body: {
            params: {
              projectId: project.projectId,
              providerState: { legacyProvider: "zmx", legacyProviderSessionName: "legacy-zmx-live" },
              title: "Migrated live zmx",
            },
            protocolVersion: GXSERVER_PROTOCOL_VERSION,
          },
          method: "POST",
          token,
        })
      ).body.result.session;

      const attach = await requestJson(baseUrl, "/api/attachSessionMetadata", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(attach.status, 200);
      assert.equal(attach.body.result.attach.zmxName, "legacy-zmx-live");
      assert.match(attach.body.result.attach.attachCommand, /legacy-zmx-live/);

      const sleep = await requestJson(baseUrl, "/api/sleepSession", {
        body: { params: { projectId: project.projectId, sessionId: session.sessionId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
        method: "POST",
        token,
      });
      assert.equal(sleep.status, 200);
      assert.equal(calls.some((script) => script.includes("zmx_session='legacy-zmx-live'")), true);
    },
    {
      zmxLifecycle: fakeZmxLifecycle(calls, () => 0),
    },
  );
});

test("provider probe API caches exists, missing, and unknown separately from native pane state", async () => {
  let probeExitCode = 0;
  await withApiServer(
    "local",
    async ({ baseUrl, paths, token }) => {
      const project = (
        await requestJson(baseUrl, "/api/createProject", {
          body: { params: { name: "Ghostex", path: paths.rootDir }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.project;
      const session = (
        await requestJson(baseUrl, "/api/createSession", {
          body: { params: { projectId: project.projectId, title: "Probe me" }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.session;

      for (const [exitCode, expected] of [
        [0, "exists"],
        [1, "missing"],
        [127, "unknown"],
      ] as const) {
        probeExitCode = exitCode;
        const response = await requestJson(baseUrl, "/api/probeSessionProvider", {
          body: {
            params: { projectId: project.projectId, sessionId: session.sessionId },
            protocolVersion: GXSERVER_PROTOCOL_VERSION,
          },
          method: "POST",
          token,
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.result.providerState.lifecycleState, expected);
        assert.equal(response.body.result.session.providerState.lifecycleState, expected);
      }
    },
    {
      zmxLifecycle: fakeZmxLifecycle([], () => probeExitCode),
    },
  );
});

test("control-plane stop preserves zmx sessions", async () => {
  const calls: string[] = [];
  await withApiServer(
    "local",
    async ({ baseUrl, token }) => {
      const response = await requestJson(baseUrl, "/api/control/stop", {
        body: { protocolVersion: GXSERVER_PROTOCOL_VERSION },
        method: "POST",
        token,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(calls, []);
    },
    {
      zmxLifecycle: fakeZmxLifecycle(calls, () => {
        throw new Error("control-plane stop must not probe or kill zmx");
      }),
    },
  );
});

test("remote project add validates server-side paths and typed operations stay scoped", async () => {
  await withApiServer("remote", async ({ baseUrl, paths, token }) => {
    const repoPath = path.join(paths.rootDir, "registered-repo");
    const otherPath = path.join(paths.rootDir, "unregistered-repo");
    await mkdir(repoPath, { recursive: true });
    await mkdir(otherPath, { recursive: true });

    const missingProject = await requestJson(baseUrl, "/api/addProjectPath", {
      body: {
        params: { path: path.join(paths.rootDir, "missing-repo") },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(missingProject.status, 404);

    const addedProject = await requestJson(baseUrl, "/api/addProjectPath", {
      body: {
        params: { path: repoPath },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(addedProject.status, 200);
    assert.equal(addedProject.body.result.project.path, repoPath);
    assert.equal(addedProject.body.result.project.name, "registered-repo");

    const status = await requestJson(baseUrl, "/api/runGitAction", {
      body: {
        params: { action: "status", projectId: addedProject.body.result.project.projectId },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(status.status, 200);
    assert.equal(status.body.result.action, "status");
    assert.deepEqual(status.body.result.command.args, ["status", "--short", "--branch"]);

    const unregistered = await requestJson(baseUrl, "/api/runGitAction", {
      body: {
        params: { action: "status", projectPath: otherPath },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(unregistered.status, 403);
    assert.equal(unregistered.body.error, "forbidden");

    const genericRunProcess = await requestJson(baseUrl, "/api/runProcess", {
      body: { params: { args: ["status"], executable: "git" }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.equal(genericRunProcess.status, 403);
    assert.equal(genericRunProcess.body.error, "forbidden");
  });
});

test("/api/queryLogs enforces auth, protocol, method, and returns filtered logs", async () => {
  await withApiServer("local", async ({ baseUrl, paths, token }) => {
    await createGxserverLogger(paths).log({
      client: "cli",
      event: "agent.detected",
      level: "info",
      projectId: "P3a91",
      serverId: "S7k",
      sessionId: "G8v20",
      ts: "2026-05-30T10:00:00.000Z",
    });
    await createGxserverLogger(paths).log({
      client: "api",
      event: "zmx.kill.failed",
      level: "error",
      projectId: "P3a91",
      serverId: "S7k",
      sessionId: "G8v20",
      ts: "2026-05-30T10:01:00.000Z",
    });

    const wrongMethod = await requestJson(baseUrl, "/api/queryLogs", {
      method: "GET",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.body.error, "methodNotAllowed");

    const unauthorized = await requestJson(baseUrl, "/api/queryLogs", {
      body: { params: {}, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.error, "unauthorized");

    const missingProtocol = await requestJson(baseUrl, "/api/queryLogs", {
      body: { params: {} },
      method: "POST",
      token,
    });
    assert.equal(missingProtocol.status, 426);
    assert.equal(missingProtocol.body.error, "protocolMismatch");

    const filtered = await requestJson(baseUrl, "/api/queryLogs", {
      body: {
        params: {
          eventPrefix: "agent.",
          limit: 1,
          order: "desc",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.result.entries.length, 1);
    assert.equal(filtered.body.result.entries[0].event, "agent.detected");
    assert.equal(filtered.body.result.malformedLineCount, 0);

    const badParams = await requestJson(baseUrl, "/api/queryLogs", {
      body: {
        params: { limit: 0 },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(badParams.status, 400);
    assert.equal(badParams.body.error, "badRequest");
  });
});

test("authenticated health includes listener, tool, and migration status", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const health = await requestJson(baseUrl, "/api/health/server", {
      method: "GET",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(health.status, 200);
    assert.equal(health.body.serverId, "S7k");
    assert.equal(health.body.listeners.local.port, GXSERVER_LOCAL_API_PORT);
    assert.equal(health.body.listeners.remote.enabled, false);
    assert.equal(health.body.migration.currentVersion, 2);
    assert.equal(health.body.migration.stateImports.legacyMacosState.id, LEGACY_MACOS_STATE_IMPORT_ID);
    assert.equal(health.body.migration.stateImports.legacyMacosState.status, "notRun");
    assert.equal(Array.isArray(health.body.tools), true);
  });
});

test("WebSocket events require auth and protocol version, then stream JSON server events", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const unauthorized = await websocketRejected(baseUrl, "/api/events");
    assert.equal(unauthorized.statusCode, 401);

    const wrongProtocol = await websocketRejected(baseUrl, "/api/events", {
      protocolVersion: 999,
      token,
    });
    assert.equal(wrongProtocol.statusCode, 426);

    const socket = new WebSocket(toWebSocketUrl(baseUrl, "/api/events"), {
      headers: authHeaders(token, GXSERVER_PROTOCOL_VERSION),
    });
    const readyMessage = onceMessage(socket);
    await waitFor(once(socket, "open"), "WebSocket open");
    const ready = JSON.parse(String(await readyMessage)) as Record<string, unknown>;
    assert.equal(ready.type, "eventStreamReady");
    assert.equal(ready.protocolVersion, GXSERVER_PROTOCOL_VERSION);

    const handledMessage = onceMessage(socket);
    const response = await requestJson(baseUrl, "/api/listSessions", {
      body: {},
      method: "POST",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(response.status, 200);
    const handled = JSON.parse(String(await handledMessage)) as Record<string, unknown>;
    assert.equal(handled.type, "apiRequestHandled");
    assert.equal(handled.path, "/api/listSessions");
    socket.close();
  });
});

interface ServerFixture {
  baseUrl: string;
  paths: GxserverPaths;
  token: GxserverAuthToken;
}

interface RunningServerFixture extends ServerFixture {
  close: () => Promise<void>;
}

async function withApiServer(
  listenerKind: "local" | "remote",
  run: (fixture: ServerFixture) => Promise<void>,
  options: {
    zmxLifecycle?: GxserverApiRuntime["zmxLifecycle"];
  } = {},
): Promise<void> {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-api-"));
  let fixture: RunningServerFixture | undefined;
  try {
    fixture = await startApiServerFixture(homeDir, listenerKind, options);
    await run(fixture);
  } finally {
    await fixture?.close();
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function startApiServerFixture(
  homeDir: string,
  listenerKind: "local" | "remote",
  options: {
    zmxLifecycle?: GxserverApiRuntime["zmxLifecycle"];
  } = {},
): Promise<RunningServerFixture> {
  const paths = getGxserverPaths(homeDir);
  const storage = await initializeGxserverStorage(paths);
  const config = await readGxserverConfig(paths);
  const auth = await ensureGxserverAuthToken(paths);
  const metadata: GxserverRuntimeMetadata = {
    pid: process.pid,
    port: GXSERVER_LOCAL_API_PORT,
    protocolVersion: GXSERVER_PROTOCOL_VERSION,
    serverId: "S7k",
    startedAt: "2026-05-30T10:26:00.000Z",
    version: "0.1.0-test",
  };
  const eventHub = new GxserverEventHub(metadata.serverId);
  const runtime: GxserverApiRuntime = {
    authToken: auth.token,
    config,
    eventHub,
    logger: createGxserverLogger(paths),
    metadata,
    migration: createGxserverMigrationStatus(storage, undefined, {
      legacyMacosState: {
        id: LEGACY_MACOS_STATE_IMPORT_ID,
        status: "notRun",
      },
    }),
    paths,
    shutdown: () => undefined,
    version: "0.1.0-test",
    ...(options.zmxLifecycle ? { zmxLifecycle: options.zmxLifecycle } : {}),
  };
  const server = createGxserverHttpServer(runtime, listenerKind);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || address === null || !("port" in address)) {
    throw new Error("Expected gxserver test HTTP server to listen on a TCP port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await eventHub.close();
      await closeServer(server);
    },
    paths,
    token: auth.token,
  };
}

function fakeZmxLifecycle(
  calls: string[],
  probeExitCode: () => number,
): NonNullable<GxserverApiRuntime["zmxLifecycle"]> {
  const runZsh: GxserverZmxCommandRunner = async (script) => {
    calls.push(script);
    if (script.includes('kill "$zmx_session" --force')) {
      return { exitCode: 0, stderr: "", stdout: "" };
    }
    const exitCode = probeExitCode();
    return {
      exitCode,
      stderr: exitCode === 127 ? "zmx probe failed" : "",
      stdout: "",
    };
  };
  return {
    requireZmx: async () => ({
      executablePath: "/fake/bundled/zmx",
      source: "devSubmodule",
      tool: "zmx",
    }),
    runZsh,
  };
}

async function requestJson(
  baseUrl: string,
  pathname: string,
  options: {
    body?: unknown;
    method: "GET" | "OPTIONS" | "POST";
    protocolVersion?: number;
    token?: GxserverAuthToken;
  },
): Promise<{ body: Record<string, any>; headers: Headers; status: number }> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.protocolVersion !== undefined) {
    headers[GXSERVER_PROTOCOL_HEADER] = String(options.protocolVersion);
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method,
  });
  const text = await response.text();
  return {
    body: (text.trim() ? JSON.parse(text) : undefined) as Record<string, any>,
    headers: response.headers,
    status: response.status,
  };
}

async function websocketRejected(
  baseUrl: string,
  pathname: string,
  options: { protocolVersion?: number; token?: GxserverAuthToken } = {},
): Promise<{ statusCode: number }> {
  const socket = new WebSocket(toWebSocketUrl(baseUrl, pathname), {
    headers: authHeaders(options.token, options.protocolVersion),
  });
  const [, response] = (await waitFor(
    once(socket, "unexpected-response"),
    "WebSocket rejection",
  )) as [unknown, http.IncomingMessage];
  return { statusCode: response.statusCode ?? 0 };
}

function authHeaders(token?: GxserverAuthToken, protocolVersion?: number): Record<string, string> {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(protocolVersion !== undefined ? { [GXSERVER_PROTOCOL_HEADER]: String(protocolVersion) } : {}),
  };
}

function toWebSocketUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/^http:/, "ws:")}${pathname}`;
}

async function isFixedLocalPortAvailable(): Promise<boolean> {
  const probe = http.createServer();
  return new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(GXSERVER_LOCAL_API_PORT, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

async function waitForFileText(filePath: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      lastError = error;
      await delay(50);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${filePath}.`);
}

async function waitForHealth(
  token: GxserverAuthToken,
  timeoutMs: number,
): Promise<Record<string, any>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await requestJson(`http://127.0.0.1:${GXSERVER_LOCAL_API_PORT}`, "/api/health/server", {
        method: "GET",
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
        token,
      });
      if (health.status === 200) {
        return health.body;
      }
    } catch {
      // Poll until the foreground process binds the fixed local listener.
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for foreground gxserver health.");
}

async function waitForProcessExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      once(child, "exit"),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for gxserver foreground process exit.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function onceMessage(socket: WebSocket): Promise<WebSocket.RawData> {
  const [message] = (await waitFor(once(socket, "message"), "WebSocket message")) as [WebSocket.RawData];
  return message;
}

async function waitFor<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 1000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
