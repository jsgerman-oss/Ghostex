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
import { getGxserverStatus } from "../src/lifecycle.js";
import { createGxserverLogger } from "../src/logger.js";
import { getGxserverPaths } from "../src/paths.js";
import type { GxserverPaths } from "../src/paths.js";
import {
  createGxserverHttpServer,
  GXSERVER_JSON_BODY_LIMIT_BYTES,
  type GxserverApiRuntime,
} from "../src/server.js";
import {
  GXSERVER_DOMAIN_STATE_JSON_LIMIT_CHARS,
  GXSERVER_DOMAIN_STATE_JSON_MAX_DEPTH,
} from "../src/domain-state.js";
import {
  createGxserverMigrationStatus,
  initializeGxserverStorage,
  openGxserverDatabase,
  readGxserverConfig,
  type GxserverConfig,
  writeGxserverConfig,
} from "../src/storage.js";
import {
  GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES,
  GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES,
  type GxserverZmxCommandRunner,
} from "../src/zmx-lifecycle.js";

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

test("foreground gxserver closes local listener when remote listener bind fails", async (t) => {
  /*
  CDXC:GxserverVerification 2026-05-30-20:09:
  Remote listener startup can fail after the local listener is bound. The foreground-process regression must prove gxserver exits without runtime metadata and releases the local listener so CLI status cannot report a half-started daemon.

  CDXC:GxserverVerification 2026-05-30-23:34:
  This regression uses the fixed local listener because config.json is not allowed to move the local API away from 127.0.0.1:58744. Skip when the user's daemon already owns the fixed port instead of creating a test-only alternate local port.
  */
  if (!(await isFixedLocalPortAvailable())) {
    t.skip(`127.0.0.1:${GXSERVER_LOCAL_API_PORT} is already in use; skipping the real remote-bind cleanup fixture.`);
    return;
  }

  const remoteBlocker = http.createServer();
  remoteBlocker.listen(0, "127.0.0.1");
  await once(remoteBlocker, "listening");
  const remoteAddress = remoteBlocker.address();
  if (typeof remoteAddress !== "object" || remoteAddress === null || !("port" in remoteAddress)) {
    throw new Error("Expected remote port blocker to listen on a TCP port.");
  }

  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-remote-bind-failure-home-"));
  const paths = getGxserverPaths(homeDir);
  const config = await readGxserverConfig(paths);
  await writeGxserverConfig(paths, {
    ...config,
    listeners: {
      local: {
        ...config.listeners.local,
      },
      remote: {
        ...config.listeners.remote,
        enabled: true,
        host: "127.0.0.1",
        port: remoteAddress.port,
      },
    },
  });

  const cliPath = path.resolve("dist/src/cli.js");
  const child = spawn(process.execPath, [cliPath, "--foreground"], {
    cwd: path.resolve("."),
    env: { ...process.env, HOME: homeDir },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForProcessExit(child, 5_000);
    assert.notEqual(child.exitCode, 0);
    assert.match(stderr, new RegExp(`Port ${remoteAddress.port} is already in use`));
    assert.equal(await isTcpPortAvailable(GXSERVER_LOCAL_API_PORT), true);
    assert.match(await readFile(paths.runtimeMetadataFile, "utf8").catch(() => ""), /^$/);
    assert.equal((await getGxserverStatus({ homeDir, version: "0.1.0-test" })).state, "stopped");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await waitForProcessExit(child, 2_000).catch(() => child.kill("SIGKILL"));
    }
    await closeServer(remoteBlocker);
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("RPC endpoints require POST and the exact gxserver protocol version", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const preflight = await requestJson(baseUrl, "/api/attachSessionMetadata", {
      method: "OPTIONS",
      origin: "null",
      requestPrivateNetwork: true,
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.body, undefined);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "null");
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

test("CORS and private-network headers are limited to trusted browser origins", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const trustedDev = await requestJson(baseUrl, "/api/listSessions", {
      body: { params: {}, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      origin: "http://localhost:5173",
      token,
    });
    assert.equal(trustedDev.status, 200);
    assert.equal(trustedDev.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(trustedDev.headers.get("access-control-allow-private-network"), null);

    const cli = await requestJson(baseUrl, "/api/listSessions", {
      body: { params: {}, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.equal(cli.status, 200);
    assert.equal(cli.headers.get("access-control-allow-origin"), null);
    assert.equal(cli.headers.get("access-control-allow-private-network"), null);

    const disallowedActual = await requestJson(baseUrl, "/api/listSessions", {
      body: { params: {}, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      origin: "https://evil.example",
      token,
    });
    assert.equal(disallowedActual.status, 200);
    assert.equal(disallowedActual.headers.get("access-control-allow-origin"), null);
    assert.equal(disallowedActual.headers.get("access-control-allow-private-network"), null);

    const disallowedPreflight = await requestJson(baseUrl, "/api/attachSessionMetadata", {
      method: "OPTIONS",
      origin: "https://evil.example",
      requestPrivateNetwork: true,
    });
    assert.equal(disallowedPreflight.status, 204);
    assert.equal(disallowedPreflight.headers.get("access-control-allow-origin"), null);
    assert.equal(disallowedPreflight.headers.get("access-control-allow-private-network"), null);
    assert.equal(disallowedPreflight.headers.get("access-control-allow-headers"), null);
  });
});

test("configured CORS origins can opt in trusted gxserver browser clients", async () => {
  await withApiServer(
    "local",
    async ({ baseUrl }) => {
      const preflight = await requestJson(baseUrl, "/api/listSessions", {
        method: "OPTIONS",
        origin: "https://trusted.example",
        requestPrivateNetwork: true,
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), "https://trusted.example");
      assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    },
    {
      configureConfig: (config) => ({
        ...config,
        cors: {
          allowedOrigins: [...config.cors.allowedOrigins, "https://trusted.example"],
        },
      }),
    },
  );
});

test("RPC JSON body parser accepts normal bodies and rejects oversized bodies", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const normal = await requestJson(baseUrl, "/api/listSessions", {
      body: { params: {}, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.equal(normal.status, 200);
    assert.deepEqual(normal.body.result.sessions, []);

    const oversizedBody = JSON.stringify({
      params: { padding: "x".repeat(GXSERVER_JSON_BODY_LIMIT_BYTES) },
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
    });
    assert.equal(Buffer.byteLength(oversizedBody) > GXSERVER_JSON_BODY_LIMIT_BYTES, true);

    const oversized = await requestRawJson(baseUrl, "/api/listSessions", {
      bodyText: oversizedBody,
      method: "POST",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      token,
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error, "badRequest");
    assert.match(oversized.body.message, /JSON RPC limit/);
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

test("terminal title event API stores gxserver-decided canonical titles", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const createdProject = await requestJson(baseUrl, "/api/createProject", {
      body: {
        params: { name: "Ghostex", path: "/repo/ghostex" },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    const project = createdProject.body.result.project;
    const createdSession = await requestJson(baseUrl, "/api/createSession", {
      body: {
        params: {
          projectId: project.projectId,
          runtimeSettings: { titleSource: "placeholder" },
          title: "Search by Text",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    const session = createdSession.body.result.session;

    const ignored = await requestJson(baseUrl, "/api/ingestTerminalTitleEvent", {
      body: {
        params: {
          projectId: project.projectId,
          rawTitle: "Search by Text",
          sessionId: session.sessionId,
          sessionPersistenceProvider: "zmx",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(ignored.status, 200);
    assert.equal(ignored.body.result.activity.activity, "idle");
    assert.equal(ignored.body.result.enteredAttention, false);
    assert.equal(ignored.body.result.changed, false);
    assert.equal(ignored.body.result.projection.isTemporaryTitle, true);
    assert.equal(ignored.body.result.session.title, "Search by Text");

    const updated = await requestJson(baseUrl, "/api/ingestTerminalTitleEvent", {
      body: {
        params: {
          projectId: project.projectId,
          rawTitle: "Find previous Codex work",
          sessionId: session.sessionId,
          sessionPersistenceProvider: "zmx",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.result.activity.activity, "idle");
    assert.equal(updated.body.result.changed, true);
    assert.equal(updated.body.result.session.title, "Find previous Codex work");
    assert.equal(updated.body.result.session.runtimeSettings.titleSource, "terminal-auto");
    assert.equal(updated.body.result.projection.primaryTitle, "Find previous Codex work");
  });
});

test("session state event API resolves resumed Codex sessions from shared history", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const codexSessionId = "019e7af5-c610-7f62-a129-db7bb510b48d";
    const createdProject = await requestJson(baseUrl, "/api/createProject", {
      body: {
        params: {
          name: "Ghostex",
          path: "/repo/ghostex",
          previousSessionHistory: [
            {
              agentSessionId: codexSessionId,
              closedAt: "2026-05-31T12:04:13.807Z",
              primaryTitle: "Shorter native tabs bar",
              sessionRecord: {
                agentName: "codex",
                agentSessionId: codexSessionId,
                title: "Shorter native tabs bar",
                titleSource: "terminal-auto",
              },
            },
          ],
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    const project = createdProject.body.result.project;
    const createdSession = await requestJson(baseUrl, "/api/createSession", {
      body: {
        params: {
          projectId: project.projectId,
          runtimeSettings: { titleSource: "placeholder" },
          title: "Terminal Session",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    const session = createdSession.body.result.session;

    const ingested = await requestJson(baseUrl, "/api/ingestSessionStateEvent", {
      body: {
        params: {
          projectId: project.projectId,
          sessionId: session.sessionId,
          startupText: `cd '/repo/ghostex' && codex resume "${codexSessionId}"`,
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });

    assert.equal(ingested.status, 200);
    assert.equal(ingested.body.result.changed, true);
    assert.equal(ingested.body.result.reason, "previous-session-record-title");
    assert.equal(ingested.body.result.session.agentId, "codex");
    assert.equal(ingested.body.result.session.kind, "agent");
    assert.equal(ingested.body.result.session.runtimeSettings.agentSessionId, codexSessionId);
    assert.equal(ingested.body.result.session.runtimeSettings.titleSource, "terminal-auto");
    assert.equal(ingested.body.result.session.title, "Shorter native tabs bar");
    assert.equal(ingested.body.result.projection.primaryTitle, "Shorter native tabs bar");
  });
});

test("domain-state APIs reject oversized and too-deep project/session JSON before SQLite persistence", async () => {
  await withApiServer("local", async ({ baseUrl, token }) => {
    const oversizedProjectBody = {
      params: {
        name: "Oversized project",
        runtimeSettings: { promptCache: "x".repeat(GXSERVER_DOMAIN_STATE_JSON_LIMIT_CHARS) },
      },
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
    };
    assert.equal(Buffer.byteLength(JSON.stringify(oversizedProjectBody)) < GXSERVER_JSON_BODY_LIMIT_BYTES, true);

    const oversizedProject = await requestJson(baseUrl, "/api/createProject", {
      body: oversizedProjectBody,
      method: "POST",
      token,
    });
    assert.equal(oversizedProject.status, 400);
    assert.equal(oversizedProject.body.error, "badRequest");
    assert.match(oversizedProject.body.message, /runtimeSettings exceeds .*JSON size limit/);

    const projectsAfterRejectedCreate = await requestJson(baseUrl, "/api/listProjects", {
      body: { params: {}, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.deepEqual(projectsAfterRejectedCreate.body.result.projects, []);

    const createdProject = await requestJson(baseUrl, "/api/createProject", {
      body: { params: { name: "Ghostex" }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.equal(createdProject.status, 200);
    const project = createdProject.body.result.project;

    const tooDeepHistory = await requestJson(baseUrl, "/api/updateProject", {
      body: {
        params: {
          previousSessionHistory: [{ historyId: "hist-deep", payload: nestedJson(GXSERVER_DOMAIN_STATE_JSON_MAX_DEPTH + 1) }],
          projectId: project.projectId,
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(tooDeepHistory.status, 400);
    assert.equal(tooDeepHistory.body.error, "badRequest");
    assert.match(tooDeepHistory.body.message, /previousSessionHistory exceeds .*JSON depth limit/);

    const projectStatus = await requestJson(baseUrl, "/api/readProjectStatus", {
      body: { params: { projectId: project.projectId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.deepEqual(projectStatus.body.result.project.previousSessionHistory, []);

    const oversizedSessionBody = {
      params: {
        launchSettings: { firstUserMessage: "x".repeat(GXSERVER_DOMAIN_STATE_JSON_LIMIT_CHARS) },
        projectId: project.projectId,
        title: "Oversized session",
      },
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
    };
    assert.equal(Buffer.byteLength(JSON.stringify(oversizedSessionBody)) < GXSERVER_JSON_BODY_LIMIT_BYTES, true);

    const oversizedSession = await requestJson(baseUrl, "/api/createSession", {
      body: oversizedSessionBody,
      method: "POST",
      token,
    });
    assert.equal(oversizedSession.status, 400);
    assert.equal(oversizedSession.body.error, "badRequest");
    assert.match(oversizedSession.body.message, /launchSettings exceeds .*JSON size limit/);

    const createdSession = await requestJson(baseUrl, "/api/createSession", {
      body: {
        params: { projectId: project.projectId, runtimeSettings: { delayedSendMs: 250 }, title: "Bounded session" },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(createdSession.status, 200);
    const session = createdSession.body.result.session;

    const tooDeepSession = await requestJson(baseUrl, "/api/updateSession", {
      body: {
        params: {
          projectId: project.projectId,
          runtimeSettings: nestedJson(GXSERVER_DOMAIN_STATE_JSON_MAX_DEPTH + 1),
          sessionId: session.sessionId,
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(tooDeepSession.status, 400);
    assert.equal(tooDeepSession.body.error, "badRequest");
    assert.match(tooDeepSession.body.message, /runtimeSettings exceeds .*JSON depth limit/);

    const sessions = await requestJson(baseUrl, "/api/listSessions", {
      body: { params: { projectId: project.projectId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.equal(sessions.body.result.sessions.length, 1);
    assert.deepEqual(sessions.body.result.sessions[0].runtimeSettings, { delayedSendMs: 250 });
  });
});

test("domain-state APIs surface corrupt SQLite JSON columns instead of emptying state", async () => {
  await withApiServer("local", async ({ baseUrl, paths, token }) => {
    const createdProject = await requestJson(baseUrl, "/api/createProject", {
      body: {
        params: { name: "Ghostex", runtimeSettings: { defaultPromptAgentId: "codex" } },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(createdProject.status, 200);
    const project = createdProject.body.result.project;

    const createdSession = await requestJson(baseUrl, "/api/createSession", {
      body: {
        params: { projectId: project.projectId, providerState: { marker: "durable" }, title: "Durable session" },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(createdSession.status, 200);
    const session = createdSession.body.result.session;

    const db = openGxserverDatabase(paths);
    try {
      db.prepare("UPDATE projects SET runtimeSettingsJson = ? WHERE projectId = ?").run("{not-json", project.projectId);
    } finally {
      db.close();
    }

    const projectRead = await requestJson(baseUrl, "/api/readProjectStatus", {
      body: { params: { projectId: project.projectId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.equal(projectRead.status, 409);
    assert.equal(projectRead.body.error, "corruptState");
    assert.match(projectRead.body.message, /project .* column runtimeSettingsJson/);

    const projectUpdate = await requestJson(baseUrl, "/api/updateProject", {
      body: {
        params: { name: "Should not persist", projectId: project.projectId },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(projectUpdate.status, 409);
    assert.equal(projectUpdate.body.error, "corruptState");

    const repairedProjectDb = openGxserverDatabase(paths);
    try {
      const storedProject = repairedProjectDb
        .prepare<[string], { name: string; runtimeSettingsJson: string }>(
          "SELECT name, runtimeSettingsJson FROM projects WHERE projectId = ?",
        )
        .get(project.projectId);
      assert.equal(storedProject?.name, "Ghostex");
      assert.equal(storedProject?.runtimeSettingsJson, "{not-json");
      repairedProjectDb
        .prepare("UPDATE projects SET runtimeSettingsJson = ? WHERE projectId = ?")
        .run(JSON.stringify({ defaultPromptAgentId: "codex" }), project.projectId);
      repairedProjectDb
        .prepare("UPDATE sessions SET providerStateJson = ? WHERE projectId = ? AND sessionId = ?")
        .run(JSON.stringify("wrong-shape"), project.projectId, session.sessionId);
    } finally {
      repairedProjectDb.close();
    }

    const sessionRead = await requestJson(baseUrl, "/api/readProjectStatus", {
      body: { params: { projectId: project.projectId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
      method: "POST",
      token,
    });
    assert.equal(sessionRead.status, 409);
    assert.equal(sessionRead.body.error, "corruptState");
    assert.match(sessionRead.body.message, /session .* column providerStateJson/);

    const sessionUpdate = await requestJson(baseUrl, "/api/updateSession", {
      body: {
        params: { projectId: project.projectId, sessionId: session.sessionId, title: "Should not persist" },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(sessionUpdate.status, 409);
    assert.equal(sessionUpdate.body.error, "corruptState");

    const finalDb = openGxserverDatabase(paths);
    try {
      const storedSession = finalDb
        .prepare<[string, string], { providerStateJson: string; title: string }>(
          "SELECT providerStateJson, title FROM sessions WHERE projectId = ? AND sessionId = ?",
        )
        .get(project.projectId, session.sessionId);
      assert.equal(storedSession?.title, "Durable session");
      assert.equal(storedSession?.providerStateJson, JSON.stringify("wrong-shape"));
    } finally {
      finalDb.close();
    }
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

      const launchPlan = await requestJson(baseUrl, "/api/readAgentLaunchPlan", {
        body: {
          params: { agentId: "codex", projectId: project.projectId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(launchPlan.status, 200);
      assert.equal(launchPlan.body.result.plan.command, "codex");

      const resumePlan = await requestJson(baseUrl, "/api/readAgentResumePlan", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(resumePlan.status, 200);
      assert.equal(
        resumePlan.body.result.plan.primaryCommand,
        'codex --yolo resume "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56"',
      );
      assert.equal(resumePlan.body.result.plan.copyCommand, resumePlan.body.result.plan.primaryCommand);

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
          params: { projectId: project.projectId, sessionId: session.sessionId, startupText: "" },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(missing.status, 200);
      assert.equal(missing.body.result.attach.providerState.lifecycleState, "missing");
      assert.equal(missing.body.result.attach.persistenceSessionCreated, true);
      assert.equal(missing.body.result.attach.startupTextDisposition, "queueAfterTerminalReady");
      assert.match(missing.body.result.attach.startupText, /codex --yolo resume "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56"/);
      assert.equal(missing.body.result.session.lifecycleState, "running");
      assert.ok(calls.some((script) => script.includes("list --short")));
    },
    {
      zmxLifecycle: fakeZmxLifecycle(calls, () => probeExitCode),
    },
  );
});

test("zmx session interaction APIs read and send through bundled zmx, with explicit unsupported focus", async () => {
  const calls: string[] = [];
  const sendInputs: string[] = [];
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
          body: { params: { projectId: project.projectId, title: "Talk to me" }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.session;

      const read = await requestJson(baseUrl, "/api/readSessionText", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(read.status, 200);
      assert.equal(read.body.result.text, "first line\nsecond line");
      assert.equal(read.body.result.truncated, false);
      assert.equal(read.body.result.limitBytes, GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES);
      assert.equal(read.body.result.zmxName, `${project.projectId}-${session.sessionId}`);

      const send = await requestJson(baseUrl, "/api/sendSessionText", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId, text: "hello 'agent'" },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(send.status, 200);
      assert.equal(send.body.result.textLength, "hello 'agent'".length);
      assert.equal(send.body.result.textBytes, Buffer.byteLength("hello 'agent'", "utf8"));

      const enter = await requestJson(baseUrl, "/api/sendSessionEnter", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(enter.status, 200);
      assert.equal(enter.body.result.textLength, 1);
      assert.equal(enter.body.result.textBytes, 1);

      const message = await requestJson(baseUrl, "/api/sendSessionMessage", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId, text: "ship it", submit: true },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(message.status, 200);
      assert.equal(message.body.result.submit, true);

      const focus = await requestJson(baseUrl, "/api/focusSession", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(focus.status, 503);
      assert.equal(focus.body.error, "dependencyUnavailable");
      assert.match(focus.body.message, /renderer event channel/);

      const agentMessage = await requestJson(baseUrl, "/api/sendSessionMessage", {
        body: {
          params: { agentId: "codex", text: "new visible session" },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(agentMessage.status, 503);
      assert.equal(agentMessage.body.error, "dependencyUnavailable");
      assert.match(agentMessage.body.message, /requires projectId and sessionId/);
      assert.ok(calls.some((script) => script.includes('exec "$zmx_bin" history "$zmx_session"')));
      assert.ok(calls.some((script) => script.includes('exec "$zmx_bin" send "$zmx_session"')));
      assert.equal(calls.some((script) => script.includes("hello 'agent'") || script.includes("ship it")), false);
      assert.deepEqual(sendInputs, ["hello 'agent'", "\r", "ship it\r"]);
    },
    {
      zmxLifecycle: {
        requireZmx: async () => ({
          executablePath: "/fake/bundled/zmx",
          source: "devSubmodule",
          tool: "zmx",
        }),
        runZsh: async (script, options) => {
          calls.push(script);
          if (script.includes('exec "$zmx_bin" history "$zmx_session"')) {
            assert.equal(options?.stdoutLimitBytes, GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES);
            return { exitCode: 0, stderr: "", stdout: "first line\nsecond line" };
          }
          if (script.includes('exec "$zmx_bin" send "$zmx_session"')) {
            sendInputs.push(options?.stdin ?? "");
            return { exitCode: 0, stderr: "", stdout: "" };
          }
          return { exitCode: 64, stderr: "unexpected zmx command", stdout: "" };
        },
      },
    },
  );
});

test("zmx session interaction APIs cap history and reject oversized send payloads", async () => {
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
          body: { params: { projectId: project.projectId, title: "Bounded I/O" }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
          method: "POST",
          token,
        })
      ).body.result.session;

      const read = await requestJson(baseUrl, "/api/readSessionText", {
        body: {
          params: { projectId: project.projectId, sessionId: session.sessionId },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(read.status, 200);
      assert.equal(read.body.result.text.length, GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES);
      assert.equal(read.body.result.truncated, true);
      assert.equal(read.body.result.truncatedReason, "historyOutputLimitExceeded");
      assert.equal(read.body.result.limitBytes, GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES);

      const oversized = await requestJson(baseUrl, "/api/sendSessionText", {
        body: {
          params: {
            projectId: project.projectId,
            sessionId: session.sessionId,
            text: "x".repeat(GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES + 1),
          },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });
      assert.equal(oversized.status, 400);
      assert.equal(oversized.body.error, "badRequest");
      assert.match(oversized.body.message, /zmx send limit/);
      assert.equal(calls.filter((script) => script.includes('exec "$zmx_bin" send "$zmx_session"')).length, 0);
    },
    {
      zmxLifecycle: {
        requireZmx: async () => ({
          executablePath: "/fake/bundled/zmx",
          source: "devSubmodule",
          tool: "zmx",
        }),
        runZsh: async (script, options) => {
          calls.push(script);
          assert.equal(options?.stdoutLimitBytes, GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES);
          return {
            exitCode: 125,
            stderr: `zmx command stdout exceeded ${GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES} bytes`,
            stdout: "h".repeat(GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES),
            stdoutLimitBytes: GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES,
            stdoutTruncated: true,
          };
        },
      },
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
      assert.equal(working.body.result.activity.activity, "working");
      assert.equal(working.body.result.enteredAttention, false);
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

test("transitionSession mutates lifecycle and returns gxserver-selected focus target", async () => {
  const calls: string[] = [];
  const probeExitCodes = [1, 0];
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
      const sessions: Array<{ sessionId: string }> = [];
      for (const title of ["Closing", "Missing Backend", "Live Backend"]) {
        sessions.push(
          (
            await requestJson(baseUrl, "/api/createSession", {
              body: {
                params: {
                  lifecycleState: "running",
                  projectId: project.projectId,
                  providerState: { lifecycleState: "exists" },
                  title,
                },
                protocolVersion: GXSERVER_PROTOCOL_VERSION,
              },
              method: "POST",
              token,
            })
          ).body.result.session,
        );
      }

      const transition = await requestJson(baseUrl, "/api/transitionSession", {
        body: {
          params: {
            action: "close",
            origin: {
              kind: "projectSessionList",
              orderedSessions: sessions.map((session) => ({ sessionId: session.sessionId })),
            },
            projectId: project.projectId,
            sessionId: sessions[0].sessionId,
          },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });

      assert.equal(transition.status, 200);
      assert.equal(transition.body.result.action, "close");
      assert.equal(transition.body.result.session.lifecycleState, "stopped");
      assert.equal(transition.body.result.transition.kill.killed, true);
      assert.deepEqual(transition.body.result.focusTarget, {
        projectId: project.projectId,
        reason: "nextLiveProjectSession",
        sessionId: sessions[2].sessionId,
      });
      assert.equal(calls.filter((script) => script.includes('kill "$zmx_session" --force')).length, 1);
      assert.equal(calls.filter((script) => script.includes("list --short")).length, 2);
    },
    {
      zmxLifecycle: fakeZmxLifecycle(calls, () => probeExitCodes.shift() ?? 1),
    },
  );
});

test("transitionSession sleep keeps the sidebar row but skips sleeping tab targets", async () => {
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
      const sessions: Array<{ sessionId: string }> = [];
      for (const title of ["Left", "Sleep Me", "Already Sleeping", "Right"]) {
        sessions.push(
          (
            await requestJson(baseUrl, "/api/createSession", {
              body: {
                params: {
                  lifecycleState: title === "Already Sleeping" ? "sleeping" : "running",
                  projectId: project.projectId,
                  providerState: { lifecycleState: "exists" },
                  title,
                },
                protocolVersion: GXSERVER_PROTOCOL_VERSION,
              },
              method: "POST",
              token,
            })
          ).body.result.session,
        );
      }

      const transition = await requestJson(baseUrl, "/api/transitionSession", {
        body: {
          params: {
            action: "sleep",
            origin: {
              kind: "paneTabGroup",
              orderedSessions: sessions.map((session) => ({ sessionId: session.sessionId })),
            },
            projectId: project.projectId,
            sessionId: sessions[1].sessionId,
          },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        },
        method: "POST",
        token,
      });

      assert.equal(transition.status, 200);
      assert.equal(transition.body.result.action, "sleep");
      assert.equal(transition.body.result.session.lifecycleState, "sleeping");
      assert.deepEqual(transition.body.result.focusTarget, {
        projectId: project.projectId,
        reason: "nextPaneTab",
        sessionId: sessions[3].sessionId,
      });

      const list = await requestJson(baseUrl, "/api/listSessions", {
        body: { params: { projectId: project.projectId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
        method: "POST",
        token,
      });
      const slept = list.body.result.sessions.find((session: Record<string, unknown>) => session.sessionId === sessions[1].sessionId);
      assert.equal(slept.lifecycleState, "sleeping");
    },
    {
      zmxLifecycle: fakeZmxLifecycle([], () => 0),
    },
  );
});

test("sleep failure keeps stored zmx provider route unknown instead of missing", async () => {
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
              providerState: { lifecycleState: "exists" },
              title: "Sleep failure stays attachable",
            },
            protocolVersion: GXSERVER_PROTOCOL_VERSION,
          },
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
      assert.equal(sleep.body.result.kill.killed, false);
      assert.equal(sleep.body.result.kill.exitCode, 42);
      assert.match(sleep.body.result.kill.error, /zmx kill failed/);
      assert.equal(sleep.body.result.session.lifecycleState, "unknown");
      assert.equal(sleep.body.result.session.providerState.lifecycleState, "unknown");
      assert.equal(sleep.body.result.session.providerState.zmxName, session.zmxName);
      assert.match(sleep.body.result.session.providerState.killError, /zmx kill failed/);

      const list = await requestJson(baseUrl, "/api/listSessions", {
        body: { params: { projectId: project.projectId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
        method: "POST",
        token,
      });
      const stored = list.body.result.sessions.find((candidate: Record<string, unknown>) => candidate.sessionId === session.sessionId);
      assert.equal(stored.lifecycleState, "unknown");
      assert.equal(stored.providerState.lifecycleState, "unknown");
      assert.equal(stored.providerState.zmxName, session.zmxName);

      const logs = await readFile(paths.logFile, "utf8");
      assert.match(logs, /"event":"zmx.kill.failed"/);
      assert.match(logs, /"reason":"sleepSession"/);
      assert.match(logs, /zmx kill failed/);
    },
    {
      zmxLifecycle: fakeZmxLifecycle([], () => 0, { killExitCode: () => 42 }),
    },
  );
});

test("kill failure keeps stored zmx provider route unknown instead of stopped and missing", async () => {
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
              providerState: { lifecycleState: "exists" },
              title: "Kill failure stays attachable",
            },
            protocolVersion: GXSERVER_PROTOCOL_VERSION,
          },
          method: "POST",
          token,
        })
      ).body.result.session;

      const close = await requestJson(baseUrl, "/api/killSession", {
        body: { params: { projectId: project.projectId, sessionId: session.sessionId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
        method: "POST",
        token,
      });

      assert.equal(close.status, 200);
      assert.equal(close.body.result.kill.killed, false);
      assert.equal(close.body.result.kill.exitCode, 43);
      assert.match(close.body.result.kill.error, /zmx kill failed/);
      assert.equal(close.body.result.session.lifecycleState, "unknown");
      assert.equal(close.body.result.session.providerState.lifecycleState, "unknown");
      assert.equal(close.body.result.session.providerState.zmxName, session.zmxName);
      assert.match(close.body.result.session.providerState.probeError, /zmx kill failed/);

      const list = await requestJson(baseUrl, "/api/listSessions", {
        body: { params: { projectId: project.projectId }, protocolVersion: GXSERVER_PROTOCOL_VERSION },
        method: "POST",
        token,
      });
      const stored = list.body.result.sessions.find((candidate: Record<string, unknown>) => candidate.sessionId === session.sessionId);
      assert.equal(stored.lifecycleState, "unknown");
      assert.equal(stored.providerState.lifecycleState, "unknown");
      assert.equal(stored.providerState.zmxName, session.zmxName);

      const logs = await readFile(paths.logFile, "utf8");
      assert.match(logs, /"event":"zmx.kill.failed"/);
      assert.match(logs, /"reason":"killSession"/);
      assert.match(logs, /zmx kill failed/);
    },
    {
      zmxLifecycle: fakeZmxLifecycle([], () => 0, { killExitCode: () => 43 }),
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

test("project path registration is idempotent and session creation resolves stale client ids by cwd", async () => {
  await withApiServer("local", async ({ baseUrl, paths, token }) => {
    /*
    CDXC:GxserverVerification 2026-05-31-17:47:
    macOS, CLI/TUI, and mobile clients must not have to invent daemon project ids. Adding the same filesystem project twice returns the existing P-id, and createSession resolves cwd/projectPath before honoring stale client-local ids such as `project-*`.
    */
    const repoPath = path.join(paths.rootDir, "registered-repo");
    await mkdir(repoPath, { recursive: true });

    const firstAdd = await requestJson(baseUrl, "/api/addProjectPath", {
      body: {
        params: { name: "Registered Repo", path: repoPath },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(firstAdd.status, 200);
    const projectId = firstAdd.body.result.project.projectId;
    assert.match(projectId, /^P[0-9][a-z0-9]{3}$/u);

    const secondAdd = await requestJson(baseUrl, "/api/addProjectPath", {
      body: {
        params: { path: repoPath },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(secondAdd.status, 200);
    assert.equal(secondAdd.body.result.project.projectId, projectId);

    const created = await requestJson(baseUrl, "/api/createSession", {
      body: {
        params: {
          cwd: repoPath,
          projectId: "project-vanvq8",
          title: "Terminal",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.result.session.projectId, projectId);
    assert.equal(created.body.result.session.cwd, repoPath);
  });
});

test("repository clone preview reports existing default destination and start rejects it", async () => {
  await withApiServer("local", async ({ baseUrl, paths, token }) => {
    const parentPath = path.join(paths.rootDir, "clone-parent");
    await mkdir(path.join(parentPath, "opencode"), { recursive: true });

    const preview = await requestJson(baseUrl, "/api/previewRepositoryClone", {
      body: {
        params: {
          folderPath: parentPath,
          repositoryInput: "gh repo clone anomalyco/opencode",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.result.preview.defaultFolderName, "opencode");
    assert.equal(preview.body.result.preview.destinationFolderName, "opencode");
    assert.equal(preview.body.result.preview.destinationExists, true);
    assert.equal(preview.body.result.preview.destinationExistsKind, "directory");

    const rejectedStart = await requestJson(baseUrl, "/api/startRepositoryClone", {
      body: {
        params: {
          folderPath: parentPath,
          repositoryInput: "gh repo clone anomalyco/opencode",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(rejectedStart.status, 400);
    assert.equal(rejectedStart.body.error, "badRequest");
    assert.match(rejectedStart.body.message, /already exists/);

    const renamedPreview = await requestJson(baseUrl, "/api/previewRepositoryClone", {
      body: {
        params: {
          folderPath: parentPath,
          newFolderName: "opencode-copy",
          repositoryInput: "gh repo clone anomalyco/opencode",
        },
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
      },
      method: "POST",
      token,
    });
    assert.equal(renamedPreview.status, 200);
    assert.equal(renamedPreview.body.result.preview.destinationFolderName, "opencode-copy");
    assert.equal(renamedPreview.body.result.preview.destinationExists, false);
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
    assert.equal(health.body.buildIdentity, "gxserver:0.1.0-test:source");
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
    configureConfig?: (config: GxserverConfig) => GxserverConfig;
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
    configureConfig?: (config: GxserverConfig) => GxserverConfig;
    zmxLifecycle?: GxserverApiRuntime["zmxLifecycle"];
  } = {},
): Promise<RunningServerFixture> {
  const paths = getGxserverPaths(homeDir);
  const storage = await initializeGxserverStorage(paths);
  let config = await readGxserverConfig(paths);
  if (options.configureConfig) {
    config = options.configureConfig(config);
    await writeGxserverConfig(paths, config);
    config = await readGxserverConfig(paths);
  }
  const auth = await ensureGxserverAuthToken(paths);
  const metadata: GxserverRuntimeMetadata = {
    buildIdentity: "gxserver:0.1.0-test:source",
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
    buildIdentity: metadata.buildIdentity,
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
  options: {
    killExitCode?: () => number;
  } = {},
): NonNullable<GxserverApiRuntime["zmxLifecycle"]> {
  const runZsh: GxserverZmxCommandRunner = async (script) => {
    calls.push(script);
    if (script.includes('kill "$zmx_session" --force')) {
      const exitCode = options.killExitCode?.() ?? 0;
      return { exitCode, stderr: exitCode === 0 ? "" : `zmx kill failed with exit ${exitCode}`, stdout: "" };
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

function nestedJson(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}

async function requestJson(
  baseUrl: string,
  pathname: string,
  options: {
    body?: unknown;
    method: "GET" | "OPTIONS" | "POST";
    origin?: string;
    protocolVersion?: number;
    requestPrivateNetwork?: boolean;
    token?: GxserverAuthToken;
  },
): Promise<{ body: Record<string, any>; headers: Headers; status: number }> {
  const headers: Record<string, string> = {};
  if (options.origin) {
    headers.origin = options.origin;
  }
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.protocolVersion !== undefined) {
    headers[GXSERVER_PROTOCOL_HEADER] = String(options.protocolVersion);
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.requestPrivateNetwork) {
    headers["access-control-request-private-network"] = "true";
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

async function requestRawJson(
  baseUrl: string,
  pathname: string,
  options: {
    bodyText: string;
    method: "POST";
    protocolVersion?: number;
    token?: GxserverAuthToken;
  },
): Promise<{ body: Record<string, any>; headers: http.IncomingHttpHeaders; status: number }> {
  const url = new URL(pathname, baseUrl);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "transfer-encoding": "chunked",
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.protocolVersion !== undefined) {
    headers[GXSERVER_PROTOCOL_HEADER] = String(options.protocolVersion);
  }

  return await new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        headers,
        method: options.method,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({
            body: (text.trim() ? JSON.parse(text) : undefined) as Record<string, any>,
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on("error", reject);
    const splitAt = Math.floor(options.bodyText.length / 2);
    request.write(options.bodyText.slice(0, splitAt));
    request.end(options.bodyText.slice(splitAt));
  });
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
  return await isTcpPortAvailable(GXSERVER_LOCAL_API_PORT);
}

async function isTcpPortAvailable(port: number): Promise<boolean> {
  const probe = http.createServer();
  return await new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
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
