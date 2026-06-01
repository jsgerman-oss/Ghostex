import http from "node:http";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import {
  createProtocolMismatchError,
  createRpcError,
  getGxserverEndpoint,
  isExpectedProtocolVersion,
  isRemoteEndpointAllowed,
  readProtocolVersion,
} from "./api.js";
import {
  GXSERVER_CONTROL_PLANE_CAPABILITIES,
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_LOCAL_API_PORT,
  GXSERVER_PRODUCT,
  GXSERVER_PROTOCOL_VERSION,
} from "./constants.js";
import {
  ensureGxserverAuthToken,
  isAuthorizedGxserverRequest,
  isExpectedGxserverAuthToken,
  readGxserverAuthToken,
} from "./auth.js";
import { GxserverDomainRepository, GxserverDomainStateError } from "./domain-state.js";
import { GxserverEventHub } from "./events.js";
import { detectRegisteredGitWorktreeMetadata } from "./git-worktrees.js";
import { isGxserverProjectId, isGxserverSessionId } from "./ids.js";
import { fetchServerHealth } from "./http-client.js";
import { ensureGxserverIdentity } from "./identity.js";
import { migrateLegacyMacosStateIntoGxserver } from "./legacy-macos-state-migration.js";
import { createGxserverLogger, logLevelFromStatus, type GxserverLogger } from "./logger.js";
import { GxserverLogQueryInputError, queryGxserverLogs } from "./logs.js";
import { assertSupportedNodeVersion } from "./node-version.js";
import {
  buildAgentResumePlan,
  buildProjectAgentLaunchPlan,
  createAgentSessionParams,
  getAgentStartupTextForSession,
  getAgentActivityStaleProjectionDelayMs,
  updateSessionActivitySettings,
} from "./agent-lifecycle.js";
import { applyTerminalTitleEvent } from "./session-title/index.js";
import { projectSessionTitle } from "./session-title/projection.js";
import { applySessionTransition, normalizeSessionTransitionParams } from "./session-transition/index.js";
import {
  applySessionRenameRequest,
  applySessionStateEvent,
  createAgentTitleDebouncer,
  defaultGroupId,
  GxserverPresentationDeltaCoalescer,
  incrementPresentationRevision,
  projectPresentationProject,
  projectPresentationSession,
  readGxserverPresentationSnapshot,
  searchGxserverPresentation,
  shouldIncludePresentationSession,
  reconcileAgentMetadataTitle,
  shouldCheckAgentMetadataTitle,
  type GxserverAgentTitleDebounceDecision,
} from "./session-presentation/index.js";
import { type GxserverPaths, getGxserverPaths } from "./paths.js";
import { GxserverProjectPathError, normalizeExistingDirectoryPath, resolveProjectOperationDirectory } from "./project-paths.js";
import { GxserverRepositoryCloneError, GxserverRepositoryCloneJobManager } from "./repository-clone/index.js";
import { removeRuntimeMetadata, writeRuntimeMetadata } from "./runtime.js";
import {
  createGxserverMigrationStatus,
  initializeGxserverStorage,
  openGxserverDatabase,
  readGxserverConfig,
  type GxserverConfig,
} from "./storage.js";
import { getGxserverToolStatuses, requireBundledZmx, type GxserverResolvedTool } from "./toolchain.js";
import {
  GxserverTypedOperationError,
  runBeadsAction,
  runGitAction,
  runWorktreeAction,
} from "./typed-operations.js";
import {
  buildZmxAttachCommand,
  buildZmxHistoryCommand,
  buildZmxSendCommand,
  decideStartupTextDisposition,
  defaultCwdExists,
  failedKillProviderStatePatch,
  killZmxSession,
  missingProviderStatePatch,
  normalizeLifecycleReason,
  probeZmxSession,
  providerStatePatch,
  providerZmxSessionName,
  GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES,
  GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES,
  runZshScript,
  type GxserverCwdExists,
  type GxserverZmxCommandResult,
  type GxserverZmxCommandOptions,
  type GxserverZmxCommandRunner,
} from "./zmx-lifecycle.js";
import { GxserverZmxTitleObserver } from "./zmx-title-observer.js";
import type {
  GxserverAttachSessionMetadataParams,
  GxserverAttachSessionMetadataResult,
  GxserverAuthToken,
  GxserverCreateProjectParams,
  GxserverCreateSessionParams,
  GxserverEndpointPath,
  GxserverListenerConfig,
  GxserverListenerKind,
  GxserverMinimalHealthResponse,
  GxserverMigrationStatus,
  GxserverProjectDomainState,
  GxserverProjectId,
  GxserverProviderKillResult,
  GxserverProviderProbeResult,
  GxserverPresentationSearchParams,
  GxserverPresentationDelta,
  GxserverRunBeadsActionParams,
  GxserverRepositoryCloneJobRpcResult,
  GxserverRepositoryClonePreviewRpcResult,
  GxserverRunGitActionParams,
  GxserverRunWorktreeActionParams,
  GxserverRpcSuccessResponse,
  GxserverRuntimeMetadata,
  GxserverServerId,
  GxserverSessionDomainState,
  GxserverSessionId,
  GxserverSessionLifecycleParams,
  GxserverSessionTransitionParams,
  GxserverSessionTransitionResult,
  GxserverSessionRenameRequestParams,
  GxserverSessionRenameRequestResult,
  GxserverSessionStateEventParams,
  GxserverSessionStateEventResult,
  GxserverTerminalTitleEventParams,
  GxserverTerminalTitleEventResult,
  GxserverUpdateProjectParams,
  GxserverUpdateAgentActivityParams,
  GxserverUpdateSessionParams,
} from "../protocol/index.js";
import { createSourceGxserverBuildIdentity } from "./build-identity.js";

export interface GxserverForegroundOptions {
  buildIdentity?: string;
  homeDir?: string;
  version: string;
}

export interface GxserverForegroundResult {
  reused: boolean;
}

export interface GxserverApiRuntime {
  authToken: GxserverAuthToken;
  buildIdentity: string;
  config: GxserverConfig;
  eventHub: GxserverEventHub;
  logger: GxserverLogger;
  metadata: GxserverRuntimeMetadata;
  migration: GxserverMigrationStatus;
  paths: GxserverPaths;
  shutdown: () => void;
  version: string;
  repositoryCloneJobs?: GxserverRepositoryCloneJobManager;
  presentationDeltaCoalescer?: GxserverPresentationDeltaCoalescer;
  presentationLastDeltaJsonBySessionKey?: Map<string, string>;
  presentationStaleActivityTimers?: Map<string, ReturnType<typeof setTimeout>>;
  zmxTitleObserver?: GxserverZmxTitleObserver;
  zmxLifecycle?: {
    cwdExists?: GxserverCwdExists;
    requireZmx?: () => Promise<GxserverResolvedTool>;
    runZsh?: GxserverZmxCommandRunner;
  };
}
type GxserverCreateSessionDomainParams = GxserverCreateSessionParams & { projectId: GxserverProjectId };

/*
CDXC:GxserverApi 2026-05-30-20:04:
Authenticated HTTP RPC clients must not be able to grow gxserver memory by streaming unbounded JSON bodies. Keep POST body parsing capped at 1 MiB, reject larger Content-Length values before reading, and stop retaining chunks as soon as chunked transfer input crosses the same limit.
*/
export const GXSERVER_JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const GXSERVER_AGENT_TITLE_METADATA_DEBOUNCE_MS = 3_000;
const agentTitleMetadataDebouncer = createAgentTitleDebouncer({
  delayMs: GXSERVER_AGENT_TITLE_METADATA_DEBOUNCE_MS,
});

export async function runGxserverForeground(options: GxserverForegroundOptions): Promise<GxserverForegroundResult> {
  assertSupportedNodeVersion();
  const buildIdentity = options.buildIdentity ?? createSourceGxserverBuildIdentity(options.version);

  const paths = getGxserverPaths(options.homeDir);
  const existingAuth = await readGxserverAuthToken(paths);
  const existing = await fetchServerHealth({ token: existingAuth?.token });
  if (existing) {
    return { reused: true };
  }

  const storage = await initializeGxserverStorage(paths);
  const config = await readGxserverConfig(paths);
  const identity = await ensureGxserverIdentity(paths);
  const auth = await ensureGxserverAuthToken(paths);
  const logger = createGxserverLogger(paths);
  const legacyStateImport = await migrateLegacyMacosStateIntoGxserver({
    logger,
    paths,
    serverId: identity.serverId,
  });
  const startedAt = new Date().toISOString();
  const metadata: GxserverRuntimeMetadata = {
    buildIdentity,
    pid: process.pid,
    port: GXSERVER_LOCAL_API_PORT,
    protocolVersion: GXSERVER_PROTOCOL_VERSION,
    serverId: identity.serverId,
    startedAt,
    version: options.version,
  };
  const eventHub = new GxserverEventHub(metadata.serverId);
  const servers: http.Server[] = [];
  let shuttingDown = false;
  let resolveShutdown: () => void = () => {};
  let runtime: GxserverApiRuntime;
  const zmxTitleObserver = new GxserverZmxTitleObserver({
    authToken: auth.token,
    logger,
    metadata,
    requireZmx: () => (runtime.zmxLifecycle?.requireZmx ?? requireBundledZmx)(),
  });

  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    zmxTitleObserver.close();
    eventHub.broadcast({
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      serverId: metadata.serverId,
      type: "serverStopping",
    });
    void eventHub
      .close()
      .then(() => Promise.allSettled(servers.map(closeServer)))
      .then(() => removeRuntimeMetadata(paths))
      .finally(resolveShutdown);
  };

  runtime = {
    authToken: auth.token,
    buildIdentity,
    config,
    eventHub,
    logger,
    metadata,
    migration: createGxserverMigrationStatus(storage, undefined, {
      legacyMacosState: legacyStateImport.status,
    }),
    paths,
    shutdown,
    version: options.version,
    zmxTitleObserver,
  };

  eventHub.setPresentationSnapshotProvider(async ({ clientId, lastRevision }) => {
    const db = openGxserverDatabase(paths);
    try {
      const snapshot = readGxserverPresentationSnapshot(db, metadata.serverId);
      await logger.log({
        client: clientId,
        details: {
          groupCount: snapshot.groups.length,
          lastRevision,
          projectCount: snapshot.projects.length,
          revision: snapshot.revision,
          sessionCount: snapshot.sessions.length,
        },
        event: "session-presentation.snapshot",
        level: "debug",
        serverId: metadata.serverId,
      });
      return snapshot;
    } finally {
      db.close();
    }
  });

  /*
  CDXC:GxserverLifecycle 2026-05-30-20:09:
  Foreground startup is all-or-nothing across configured listeners. If the remote listener fails after the local API is already bound, gxserver must close the local listener before throwing so status never observes a half-started daemon without runtime metadata.
  */
  try {
    const localServer = createGxserverHttpServer(runtime, "local");
    await listen(localServer, config.listeners.local);
    servers.push(localServer);

    if (config.listeners.remote.enabled) {
      const remoteServer = createGxserverHttpServer(runtime, "remote");
      await listen(remoteServer, config.listeners.remote);
      servers.push(remoteServer);
    }
  } catch (error) {
    await eventHub.close();
    await Promise.allSettled(servers.map(closeServer));
    await removeRuntimeMetadata(paths);
    throw error;
  }

  await writeRuntimeMetadata(paths, metadata);
  await logger.log({
    event: "serverStarted",
    level: "info",
    serverId: metadata.serverId,
  });
  await syncZmxTitleObserversFromStorage(runtime, "server-start");
  eventHub.broadcast({
    protocolVersion: GXSERVER_PROTOCOL_VERSION,
    serverId: metadata.serverId,
    type: "serverStarted",
  });

  await new Promise<void>((resolve) => {
    resolveShutdown = resolve;
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

  return { reused: false };
}

export function createGxserverHttpServer(runtime: GxserverApiRuntime, listenerKind: GxserverListenerKind): http.Server {
  const server = http.createServer((request, response) => {
    void handleRequest({
      listenerKind,
      request,
      response,
      runtime,
    });
  });

  server.on("upgrade", (request, socket, head) => {
    void handleUpgrade({
      head,
      listenerKind,
      request,
      runtime,
      socket,
    });
  });

  return server;
}

interface HandleRequestOptions {
  listenerKind: GxserverListenerKind;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  runtime: GxserverApiRuntime;
}

async function handleRequest(options: HandleRequestOptions): Promise<void> {
  const { request, response, runtime } = options;
  const requestId = getRequestId(request);
  const startedAtMs = Date.now();
  const clientAddress = request.socket.remoteAddress;
  let error: string | undefined;
  let endpointPath: GxserverEndpointPath | undefined;
  try {
    endpointPath = await routeRequest(options, requestId);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    if (!response.headersSent) {
      sendJson(response, 500, createRpcError("internalError", error, requestId));
    } else {
      response.destroy(caught instanceof Error ? caught : new Error(error));
    }
  } finally {
    await runtime.logger.log({
      client: clientAddress,
      durationMs: Date.now() - startedAtMs,
      error,
      event: "apiRequest",
      level: logLevelFromStatus(response.statusCode),
      requestId,
      serverId: runtime.metadata.serverId,
      details: {
        method: request.method,
        path: endpointPath ?? request.url,
        statusCode: response.statusCode,
      },
    });
    if (endpointPath) {
      runtime.eventHub.broadcast({
        path: endpointPath,
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
        requestId,
        serverId: runtime.metadata.serverId,
        type: "apiRequestHandled",
      });
    }
  }
}

async function routeRequest(options: HandleRequestOptions, requestId: string): Promise<GxserverEndpointPath | undefined> {
  const { listenerKind, request, response, runtime } = options;
  const url = new URL(request.url ?? "/", `http://${GXSERVER_LOCAL_API_HOST}:${GXSERVER_LOCAL_API_PORT}`);
  const endpoint = getGxserverEndpoint(url.pathname);
  applyCorsHeaders(request, response, runtime.config);

  /*
  CDXC:GxserverApi 2026-05-30-18:04:
  The macOS React sidebar calls gxserver from a WebKit page with `Authorization`, `content-type`, and the protocol header, so WebKit sends an unauthenticated CORS preflight before zmx attach/list RPCs. Answer `OPTIONS` before auth, method, and protocol gates so the browser can reach the real authenticated endpoint instead of surfacing a generic `Load failed` while gxserver is healthy.
  */
  if (request.method === "OPTIONS") {
    if (!endpoint || endpoint.transport !== "http") {
      sendJson(response, 404, createRpcError("notFound", `${url.pathname} is not a gxserver HTTP endpoint.`, requestId));
      return endpoint?.path;
    }
    if (!isRemoteEndpointAllowed(listenerKind, endpoint.permission)) {
      sendJson(
        response,
        403,
        createRpcError(
          "forbidden",
          `${endpoint.path} is not available on the remote gxserver listener.`,
          requestId,
        ),
      );
      return endpoint.path;
    }
    response.writeHead(204);
    response.end();
    return endpoint.path;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, createMinimalHealth(runtime.version));
    return "/api/health";
  }

  if (!endpoint || endpoint.transport !== "http") {
    sendJson(
      response,
      404,
      createRpcError("notFound", `No gxserver endpoint for ${request.method ?? "UNKNOWN"} ${url.pathname}.`, requestId),
    );
    return undefined;
  }

  if (endpoint.path !== "/api/health/server" && request.method !== "POST") {
    sendJson(response, 405, createRpcError("methodNotAllowed", `${endpoint.path} requires POST.`, requestId));
    return endpoint.path;
  }

  if (endpoint.path === "/api/health/server" && request.method !== "GET") {
    sendJson(response, 405, createRpcError("methodNotAllowed", `${endpoint.path} requires GET.`, requestId));
    return endpoint.path;
  }

  if (endpoint.requiresAuth && !isAuthorizedGxserverRequest(request, runtime.authToken)) {
    sendJson(
      response,
      401,
      createRpcError("unauthorized", "gxserver auth token is required for this endpoint.", requestId),
    );
    return endpoint.path;
  }

  let body: unknown;
  if (request.method === "POST") {
    try {
      body = await readJsonBody(request);
    } catch (caught) {
      if (caught instanceof GxserverRequestBodyTooLargeError) {
        sendJson(
          response,
          413,
          createRpcError(
            "badRequest",
            `Request body exceeds the gxserver JSON RPC limit of ${GXSERVER_JSON_BODY_LIMIT_BYTES} bytes.`,
            requestId,
          ),
        );
      } else {
        sendJson(response, 400, createRpcError("badRequest", "Request body must be valid JSON.", requestId));
      }
      return endpoint.path;
    }
  }

  if (endpoint.requiresProtocolVersion) {
    const protocolVersion = readProtocolVersion(request, url, body);
    if (!isExpectedProtocolVersion(protocolVersion)) {
      sendJson(response, 426, createProtocolMismatchError(protocolVersion, requestId));
      return endpoint.path;
    }
  }

  if (!isRemoteEndpointAllowed(listenerKind, endpoint.permission)) {
    sendJson(
      response,
      403,
      createRpcError(
        "forbidden",
        `${endpoint.path} is not available on the remote gxserver listener.`,
        requestId,
      ),
    );
    return endpoint.path;
  }

  if (endpoint.path === "/api/health/server") {
    sendJson(response, 200, await createAuthenticatedHealth(runtime));
    return endpoint.path;
  }

  /*
  CDXC:GxserverApi 2026-05-30-17:08:
  `/api/queryLogs` now implements the gxserver-16 read-only local log API while preserving gxserver-5 auth, method, protocol, and listener gates. The endpoint stays local-only until remote log redaction/scope rules are defined, so remote clients must use a local/tunneled authenticated daemon connection rather than scraping `~/.ghostex/gxserver/logs/gxserver.jsonl`.
  */
  if (endpoint.path === "/api/queryLogs") {
    try {
      const params = readRpcParams(body);
      const result = await queryGxserverLogs(runtime.paths, params);
      sendJson(response, 200, {
        ok: true,
        product: GXSERVER_PRODUCT,
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
        requestId,
        result,
      });
    } catch (caught) {
      if (caught instanceof GxserverLogQueryInputError) {
        sendJson(response, 400, createRpcError("badRequest", caught.message, requestId));
      } else {
        throw caught;
      }
    }
    return endpoint.path;
  }

  if (isTypedOperationEndpoint(endpoint.path)) {
    const abortController = new AbortController();
    const abortTypedOperation = (): void => {
      if (!response.writableEnded) {
        abortController.abort();
      }
    };
    request.once("aborted", abortTypedOperation);
    response.once("close", abortTypedOperation);
    try {
      const result = await handleTypedOperationEndpoint(runtime, endpoint.path, body, requestId, abortController.signal);
      if (!response.destroyed) {
        sendJson(response, 200, result);
      }
    } catch (caught) {
      if (caught instanceof GxserverDomainStateError) {
        sendJson(response, statusForDomainStateError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else if (caught instanceof GxserverTypedOperationError || caught instanceof GxserverProjectPathError) {
        sendJson(response, statusForOperationError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else {
        throw caught;
      }
    } finally {
      request.removeListener("aborted", abortTypedOperation);
      response.removeListener("close", abortTypedOperation);
    }
    return endpoint.path;
  }

  if (isZmxLifecycleEndpoint(endpoint.path)) {
    try {
      const result = await handleZmxLifecycleEndpoint(runtime, endpoint.path, body, requestId);
      sendJson(response, 200, result);
    } catch (caught) {
      if (caught instanceof GxserverDomainStateError) {
        sendJson(response, statusForDomainStateError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else if (caught instanceof GxserverProjectPathError) {
        sendJson(response, statusForOperationError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else {
        throw caught;
      }
    }
    return endpoint.path;
  }

  /*
  CDXC:GxserverSessionInteraction 2026-05-30-20:53:
  gx/ghostex session interaction commands must terminate at gxserver after the hard cutover. zmx-backed read/send/send-enter/session-targeted send-message use the bundled zmx binary directly; renderer focus and agent-targeted message creation stay explicitly unsupported until gxserver has a client event channel that can focus or create visible macOS panes without reviving the retired app bridge.
  */
  if (isZmxSessionInteractionEndpoint(endpoint.path)) {
    try {
      const result = await handleZmxSessionInteractionEndpoint(runtime, endpoint.path, body, requestId);
      sendJson(response, 200, result);
    } catch (caught) {
      if (caught instanceof GxserverDomainStateError) {
        sendJson(response, statusForDomainStateError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else if (caught instanceof GxserverTypedOperationError) {
        sendJson(response, statusForOperationError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else {
        throw caught;
      }
    }
    return endpoint.path;
  }

  if (isRepositoryCloneEndpoint(endpoint.path)) {
    try {
      const result = await handleRepositoryCloneEndpoint(runtime, endpoint.path, body, requestId);
      sendJson(response, 200, result);
    } catch (caught) {
      if (caught instanceof GxserverRepositoryCloneError) {
        sendJson(response, statusForRepositoryCloneError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else if (caught instanceof GxserverDomainStateError) {
        sendJson(response, statusForDomainStateError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else if (caught instanceof GxserverProjectPathError) {
        sendJson(response, statusForOperationError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else {
        throw caught;
      }
    }
    return endpoint.path;
  }

  /*
  CDXC:GxserverApi 2026-05-30-17:30:
  Domain-state endpoints run after gxserver-5 auth, protocol-version, listener-permission, logging, and event semantics. zmx lifecycle and typed Git/worktree/Beads operations have their own handlers so project/session persistence cannot accidentally accept process-execution payloads or lifecycle commands.
  */
  if (isDomainStateEndpoint(endpoint.path)) {
    try {
      sendJson(response, 200, handleDomainStateEndpoint(runtime, endpoint.path, body, requestId));
    } catch (caught) {
      if (caught instanceof GxserverDomainStateError) {
        sendJson(response, statusForDomainStateError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else if (caught instanceof GxserverProjectPathError) {
        sendJson(response, statusForOperationError(caught.code), createRpcError(caught.code, caught.message, requestId));
      } else {
        throw caught;
      }
    }
    return endpoint.path;
  }

  if (endpoint.path === "/api/control/stop") {
    sendJson(response, 200, {
      ok: true,
      product: GXSERVER_PRODUCT,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      requestId,
      result: {},
    });
    setTimeout(() => {
      runtime.shutdown();
    }, 25).unref();
    return endpoint.path;
  }

  sendJson(
    response,
    501,
    createRpcError("notImplemented", `${endpoint.path} is defined but not implemented in this milestone.`, requestId),
  );
  return endpoint.path;
}

function handleDomainStateEndpoint(
  runtime: GxserverApiRuntime,
  endpointPath: GxserverEndpointPath,
  body: unknown,
  requestId: string,
): GxserverRpcSuccessResponse {
  const db = openGxserverDatabase(runtime.paths);
  try {
    const repository = new GxserverDomainRepository(db, runtime.metadata.serverId);
    const result = dispatchDomainStateEndpoint(runtime, db, repository, endpointPath, readDomainRpcParams(body));
    return {
      ok: true,
      product: GXSERVER_PRODUCT,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      requestId,
      result,
    };
  } finally {
    db.close();
  }
}

function dispatchDomainStateEndpoint(
  runtime: GxserverApiRuntime,
  db: ReturnType<typeof openGxserverDatabase>,
  repository: GxserverDomainRepository,
  endpointPath: GxserverEndpointPath,
  params: Record<string, unknown>,
): Record<string, unknown> {
  switch (endpointPath) {
    case "/api/createProject": {
      const project = repository.createProject(params as unknown as GxserverCreateProjectParams);
      schedulePresentationProjectDelta(runtime, db, repository, {
        projectId: project.projectId,
        reason: "create-project",
        type: "projectAdded",
      });
      return { project };
    }
    case "/api/updateProject": {
      const project = repository.updateProject(params as unknown as GxserverUpdateProjectParams);
      schedulePresentationProjectDelta(runtime, db, repository, {
        projectId: project.projectId,
        reason: "update-project",
        type: "projectUpdated",
      });
      return { project };
    }
    case "/api/listProjects":
      return { projects: repository.listProjects() };
    case "/api/readProjectStatus": {
      const projectId = readProjectId(params);
      const project = repository.getProject(projectId);
      if (!project) {
        throw new GxserverDomainStateError("notFound", `Project ${projectId} does not exist.`);
      }
      scheduleAgentTitleMetadataChecksForSessions(runtime, repository, repository.listSessions(projectId), "read-project-status");
      return { project, sessions: repository.listSessions(projectId) };
    }
    case "/api/addProjectPath": {
      const project = addProjectPath(repository, params);
      schedulePresentationProjectDelta(runtime, db, repository, {
        projectId: project.projectId,
        reason: "add-project-path",
        type: "projectAdded",
      });
      return { project };
    }
    case "/api/createSession":
    case "/api/createAgentSession": {
      const createParams =
        endpointPath === "/api/createAgentSession"
          ? normalizeCreateAgentSessionParams(repository, params)
          : normalizeCreateSessionParams(repository, params);
      const createdSession = repository.createSession(createParams);
      const presentation = applySessionStateEvent(repository, {
        agentName: createParams.agentId,
        agentSessionId: readRuntimeText(createParams.runtimeSettings, "agentSessionId"),
        agentSessionPath: readRuntimeText(createParams.runtimeSettings, "agentSessionPath"),
        projectId: createdSession.projectId,
        sessionId: createdSession.sessionId,
        startupText: readRuntimeText(createParams.runtimeSettings, "startupText") ?? readRuntimeText(createParams.launchSettings, "startupText"),
        title: createParams.title,
        titleSource: readRuntimeText(createParams.runtimeSettings, "titleSource") as GxserverSessionStateEventParams["titleSource"],
      });
      const reconciled = scheduleAgentTitleMetadataCheck(runtime, repository, {
        force: true,
        projectId: presentation.session.projectId,
        reason: "create-session",
        sessionId: presentation.session.sessionId,
      });
      const session = reconciled?.session ?? repository.getSession(presentation.session.projectId, presentation.session.sessionId) ?? presentation.session;
      observeZmxTitleForSession(runtime, session, "create-session");
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: session.projectId,
        reason: "create-session",
        sessionId: session.sessionId,
      });
      return {
        session,
      };
    }
    case "/api/readAgentLaunchPlan": {
      const projectId = readProjectId(params);
      const project = repository.getProject(projectId);
      if (!project) {
        throw new GxserverDomainStateError("notFound", `Project ${projectId} does not exist.`);
      }
      const agentId = readRequiredText(params.agentId, "agentId");
      return {
        plan: buildProjectAgentLaunchPlan(project, {
          agentId,
          agentSessionId: readOptionalText(params.agentSessionId),
        }),
      };
    }
    case "/api/readAgentResumePlan": {
      const lifecycle = readSessionLifecycleParams(params);
      const project = repository.getProject(lifecycle.projectId);
      const session = repository.getSession(lifecycle.projectId, lifecycle.sessionId);
      if (!project) {
        throw new GxserverDomainStateError("notFound", `Project ${lifecycle.projectId} does not exist.`);
      }
      if (!session) {
        throw new GxserverDomainStateError(
          "notFound",
          `Session ${lifecycle.projectId}/${lifecycle.sessionId} does not exist.`,
        );
      }
      return {
        plan: buildAgentResumePlan(project, session),
        session,
      };
    }
    case "/api/requestSessionRename": {
      const renameParams = params as unknown as GxserverSessionRenameRequestParams;
      const lifecycle = readSessionLifecycleParams(params);
      const result = applySessionRenameRequest(repository, {
        ...renameParams,
        projectId: lifecycle.projectId,
        sessionId: lifecycle.sessionId,
      });
      const reconciled = result.pendingAgentMetadata
        ? scheduleAgentTitleMetadataCheck(runtime, repository, {
            force: true,
            projectId: lifecycle.projectId,
            reason: "rename-request",
            sessionId: lifecycle.sessionId,
          })
        : undefined;
      const session = reconciled?.session ?? repository.getSession(lifecycle.projectId, lifecycle.sessionId) ?? result.session;
      observeZmxTitleForSession(runtime, session, "rename-request");
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: lifecycle.projectId,
        reason: "rename-request",
        sessionId: lifecycle.sessionId,
      });
      return {
        ...result,
        changed: result.changed || reconciled?.changed === true,
        projection: projectSessionTitle(session),
        reason: reconciled?.changed === true ? reconciled.reason : result.reason,
        session,
      } satisfies Record<string, unknown> & GxserverSessionRenameRequestResult;
    }
    case "/api/ingestSessionStateEvent": {
      const stateEvent = params as unknown as GxserverSessionStateEventParams;
      const lifecycle = readSessionLifecycleParams(params);
      const result = applySessionStateEvent(repository, {
        ...stateEvent,
        projectId: lifecycle.projectId,
        sessionId: lifecycle.sessionId,
      });
      const reconciled = scheduleAgentTitleMetadataCheck(runtime, repository, {
        force: true,
        projectId: lifecycle.projectId,
        reason: "session-state-event",
        sessionId: lifecycle.sessionId,
      });
      const session = reconciled?.session ?? repository.getSession(lifecycle.projectId, lifecycle.sessionId) ?? result.session;
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: lifecycle.projectId,
        reason: "session-state-event",
        sessionId: lifecycle.sessionId,
      });
      return {
        ...result,
        changed: result.changed || reconciled?.changed === true,
        projection: projectSessionTitle(session),
        reason: reconciled?.changed === true ? reconciled.reason : result.reason,
        session,
      } satisfies Record<string, unknown> & GxserverSessionStateEventResult;
    }
    case "/api/ingestTerminalTitleEvent": {
      const titleEvent = params as unknown as GxserverTerminalTitleEventParams;
      const lifecycle = readSessionLifecycleParams(params);
      const current = repository.getSession(lifecycle.projectId, lifecycle.sessionId);
      if (!current) {
        throw new GxserverDomainStateError(
          "notFound",
          `Session ${lifecycle.projectId}/${lifecycle.sessionId} does not exist.`,
        );
      }
      const decision = applyTerminalTitleEvent(repository, {
        ...titleEvent,
        projectId: lifecycle.projectId,
        sessionId: lifecycle.sessionId,
      });
      const titledSession = decision.session ?? repository.getSession(lifecycle.projectId, lifecycle.sessionId) ?? current;
      const presentation =
        decision.agentSessionId
          ? applySessionStateEvent(repository, {
              agentName: titleEvent.agentName,
              agentSessionId: decision.agentSessionId,
              projectId: lifecycle.projectId,
              sessionId: lifecycle.sessionId,
            })
          : undefined;
      const presentedSession = presentation?.session ?? titledSession;
      const statusUpdate = updateSessionActivitySettings(presentedSession, {
        agentName: titleEvent.agentName,
        event: "title",
        projectId: lifecycle.projectId,
        sessionId: lifecycle.sessionId,
        title: titleEvent.rawTitle,
      });
      const session = repository.updateSession({
        lastActiveAt: statusUpdate.lastActiveAt,
        projectId: presentedSession.projectId,
        runtimeSettings: statusUpdate.runtimeSettings,
        sessionId: presentedSession.sessionId,
      });
      scheduleStaleActivityPresentationRefresh(runtime, session, "terminal-title-stale-activity");
      const reconciled = scheduleAgentTitleMetadataCheck(runtime, repository, {
        force: true,
        projectId: lifecycle.projectId,
        reason: "terminal-title-event",
        sessionId: lifecycle.sessionId,
      });
      const responseSession = reconciled?.session ?? repository.getSession(lifecycle.projectId, lifecycle.sessionId) ?? session;
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: lifecycle.projectId,
        reason: "terminal-title-event",
        sessionId: lifecycle.sessionId,
      });
      const response = {
        agentSessionId: decision.agentSessionId,
        activity: statusUpdate.activity,
        changed: decision.changed || presentation?.changed === true || reconciled?.changed === true,
        enteredAttention: statusUpdate.enteredAttention,
        previousActivity: statusUpdate.previousActivity,
        projection: projectSessionTitle(responseSession),
        reason: reconciled?.changed === true ? reconciled.reason : decision.reason,
        session: responseSession,
        visibleTitle: decision.visibleTitle,
      } satisfies GxserverTerminalTitleEventResult;
      /*
      CDXC:GxserverSessionTitles 2026-06-01-20:59:
      Title ownership lives in gxserver for every client. Log terminal-title ingest decisions at the shared API boundary so noisy settled-title streams, rejected titles, metadata reconciliation, and final presentation title source can be diagnosed without duplicating title logic in macOS, TUI, CLI, or mobile clients.
      */
      const rawTitleForLog = titleEvent.rawTitle ?? "";
      void runtime.logger.log({
        details: {
          activity: statusUpdate.activity,
          agentName: titleEvent.agentName,
          agentSessionIdCaptured: decision.agentSessionId !== undefined,
          changed: response.changed,
          decisionChanged: decision.changed,
          decisionReason: decision.reason,
          metadataChanged: reconciled?.changed === true,
          metadataReason: reconciled?.reason,
          metadataTitleFound: reconciled?.metadataTitleFound,
          presentationChanged: presentation?.changed === true,
          provider: titleEvent.sessionPersistenceProvider,
          rawTitleLength: rawTitleForLog.length,
          rawTitlePreview: rawTitleForLog.slice(0, 80),
          responseReason: response.reason,
          responseTitleSource: responseSession.runtimeSettings.titleSource,
          sessionTitleBeforeLength: current.title.length,
          sessionTitleBeforePreview: current.title.slice(0, 80),
          sessionTitleDecisionLength: titledSession.title.length,
          sessionTitleDecisionPreview: titledSession.title.slice(0, 80),
          visibleTitleLength: decision.visibleTitle?.length,
          visibleTitlePreview: decision.visibleTitle?.slice(0, 80),
        },
        event: "sessionTitle.terminalTitleEvent",
        level: response.changed ? "info" : "debug",
        projectId: lifecycle.projectId,
        serverId: runtime.metadata.serverId,
        sessionId: lifecycle.sessionId,
      });
      return response;
    }
    case "/api/updateAgentActivity": {
      const activity = params as unknown as GxserverUpdateAgentActivityParams;
      const lifecycle = readSessionLifecycleParams(params);
      const current = repository.getSession(lifecycle.projectId, lifecycle.sessionId);
      if (!current) {
        throw new GxserverDomainStateError(
          "notFound",
          `Session ${lifecycle.projectId}/${lifecycle.sessionId} does not exist.`,
        );
      }
      const update = updateSessionActivitySettings(current, activity);
      const session = repository.updateSession({
        lastActiveAt: update.lastActiveAt,
        projectId: current.projectId,
        runtimeSettings: update.runtimeSettings,
        sessionId: current.sessionId,
      });
      scheduleStaleActivityPresentationRefresh(runtime, session, "agent-activity-stale-activity");
      scheduleAgentTitleMetadataCheck(runtime, repository, {
        force: true,
        projectId: lifecycle.projectId,
        reason: "agent-activity",
        sessionId: lifecycle.sessionId,
      });
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: lifecycle.projectId,
        reason: "agent-activity",
        sessionId: lifecycle.sessionId,
      });
      return {
        activity: update.activity,
        enteredAttention: update.enteredAttention,
        previousActivity: update.previousActivity,
        session,
      };
    }
    case "/api/readPresentationSnapshot":
      return {
        snapshot: readGxserverPresentationSnapshot(db, runtime.metadata.serverId),
      };
    case "/api/searchSessions":
      return searchGxserverPresentation(
        db,
        runtime.metadata.serverId,
        params as unknown as GxserverPresentationSearchParams,
      ) as unknown as Record<string, unknown>;
    case "/api/listPreviousSessions":
      return searchGxserverPresentation(db, runtime.metadata.serverId, {
        ...(params as unknown as GxserverPresentationSearchParams),
        includeActive: false,
        includePrevious: true,
      }) as unknown as Record<string, unknown>;
    case "/api/updateSession":
    case "/api/attachSessionMetadata": {
      const session = repository.updateSession(params as unknown as GxserverUpdateSessionParams);
      scheduleZmxTitleObserverSync(runtime, repository, endpointPath === "/api/updateSession" ? "update-session" : "attach-session-metadata");
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: session.projectId,
        reason: endpointPath === "/api/updateSession" ? "update-session" : "attach-session-metadata",
        sessionId: session.sessionId,
      });
      return { session };
    }
    case "/api/listSessions":
      scheduleAgentTitleMetadataChecksForSessions(runtime, repository, repository.listSessions(readOptionalProjectId(params)), "list-sessions");
      return { sessions: repository.listSessions(readOptionalProjectId(params)) };
    case "/api/readClientLayout":
      return {
        layout:
          repository.readClientLayout({
            clientId: String(params.clientId ?? ""),
            projectId: readOptionalProjectId(params),
          }) ?? null,
      };
    case "/api/updateClientLayout":
      return {
        layout: repository.updateClientLayout({
          clientId: String(params.clientId ?? ""),
          layout: isRecord(params.layout) ? params.layout : {},
          projectId: readOptionalProjectId(params),
        }),
      };
    default:
      throw new GxserverDomainStateError("notFound", `${endpointPath} is not a gxserver domain-state endpoint.`);
  }
}

async function handleRepositoryCloneEndpoint(
  runtime: GxserverApiRuntime,
  endpointPath: GxserverEndpointPath,
  body: unknown,
  requestId: string,
): Promise<GxserverRpcSuccessResponse<Record<string, unknown>>> {
  /*
  CDXC:RepositoryClone 2026-06-01-11:18:
  Clone Repository is a gxserver API, not a macOS implementation detail. Keep preview, start, polling, cancellation, and project registration behind these RPCs so all clients share the same existing-folder warning and clone job lifecycle.
  */
  const params = readRepositoryCloneRpcParams(body);
  const manager = getRepositoryCloneJobManager(runtime);
  let result: GxserverRepositoryClonePreviewRpcResult | GxserverRepositoryCloneJobRpcResult;
  switch (endpointPath) {
    case "/api/previewRepositoryClone":
      result = { preview: await manager.preview(params) };
      break;
    case "/api/startRepositoryClone":
      result = {
        job: await manager.start(
          {
            logger: runtime.logger,
            paths: runtime.paths,
            serverId: runtime.metadata.serverId,
          },
          params,
        ),
      };
      break;
    case "/api/readRepositoryCloneJob":
      result = { job: manager.read(params.jobId) };
      break;
    case "/api/cancelRepositoryCloneJob":
      result = { job: manager.cancel(params.jobId) };
      break;
    default:
      throw new GxserverRepositoryCloneError("notFound", `${endpointPath} is not a gxserver repository clone endpoint.`);
  }
  return {
    ok: true,
    product: GXSERVER_PRODUCT,
    protocolVersion: GXSERVER_PROTOCOL_VERSION,
    requestId,
    result: result as unknown as Record<string, unknown>,
  };
}

function getRepositoryCloneJobManager(runtime: GxserverApiRuntime): GxserverRepositoryCloneJobManager {
  runtime.repositoryCloneJobs ??= new GxserverRepositoryCloneJobManager();
  return runtime.repositoryCloneJobs;
}

function scheduleAgentTitleMetadataChecksForSessions(
  runtime: GxserverApiRuntime,
  leadingRepository: GxserverDomainRepository | undefined,
  sessions: readonly GxserverSessionDomainState[],
  reason: string,
): void {
  for (const session of sessions) {
    if (!shouldCheckAgentMetadataTitle(session)) {
      continue;
    }
    scheduleAgentTitleMetadataCheck(runtime, leadingRepository, {
      projectId: session.projectId,
      reason,
      sessionId: session.sessionId,
    });
  }
}

async function syncZmxTitleObserversFromStorage(runtime: GxserverApiRuntime, reason: string): Promise<void> {
  const db = openGxserverDatabase(runtime.paths);
  try {
    const repository = new GxserverDomainRepository(db, runtime.metadata.serverId);
    await syncZmxTitleObserversFromRepository(runtime, repository, reason);
  } catch (error) {
    await runtime.logger.log({
      details: { message: error instanceof Error ? error.message : String(error), reason },
      event: "zmxTitleObserver.syncFailed",
      level: "warn",
      serverId: runtime.metadata.serverId,
    });
  } finally {
    db.close();
  }
}

async function syncZmxTitleObserversFromRepository(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  reason: string,
): Promise<void> {
  if (!runtime.zmxTitleObserver) {
    return;
  }
  await runtime.zmxTitleObserver.syncSessions(repository.listSessions(), reason);
}

function scheduleZmxTitleObserverSync(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  reason: string,
): void {
  void syncZmxTitleObserversFromRepository(runtime, repository, reason).catch((error) =>
    runtime.logger.log({
      details: { message: error instanceof Error ? error.message : String(error), reason },
      event: "zmxTitleObserver.syncFailed",
      level: "warn",
      serverId: runtime.metadata.serverId,
    }),
  );
}

function observeZmxTitleForSession(runtime: GxserverApiRuntime, session: GxserverSessionDomainState, reason: string): void {
  if (!runtime.zmxTitleObserver) {
    return;
  }
  void runtime.zmxTitleObserver.observeSession(session, reason).catch((error) =>
    runtime.logger.log({
      details: { message: error instanceof Error ? error.message : String(error), reason },
      event: "zmxTitleObserver.observeFailed",
      level: "warn",
      projectId: session.projectId,
      serverId: runtime.metadata.serverId,
      sessionId: session.sessionId,
    }),
  );
}

function schedulePresentationProjectDelta(
  runtime: GxserverApiRuntime,
  db: ReturnType<typeof openGxserverDatabase>,
  repository: GxserverDomainRepository,
  input: {
    projectId: GxserverProjectId;
    reason: string;
    type: "projectAdded" | "projectUpdated";
  },
): void {
  if (runtime.eventHub.server.clients.size === 0) {
    return;
  }
  const delta = buildPresentationProjectDelta(repository, input.projectId, input.type);
  if (!delta) {
    return;
  }
  /*
  CDXC:GxserverPresentationProjects 2026-06-01-21:14:
  Add Project is user-visible sidebar state, not only database state. Publish a project presentation delta immediately when a path is registered or updated so connected clients can render empty project rows before any session delta exists.
  */
  const revision = incrementPresentationRevision(db);
  runtime.eventHub.broadcast({
    delta,
    protocolVersion: GXSERVER_PROTOCOL_VERSION,
    revision,
    serverId: runtime.metadata.serverId,
    type: "presentationDelta",
  });
  void runtime.logger.log({
    details: {
      deltaType: delta.type,
      reason: input.reason,
      revision,
    },
    event: "session-presentation.projectDelta",
    level: "debug",
    projectId: input.projectId,
    serverId: runtime.metadata.serverId,
  });
}

function schedulePresentationSessionDelta(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  input: {
    projectId: GxserverProjectId;
    reason: string;
    sessionId: GxserverSessionId;
  },
): void {
  if (runtime.eventHub.server.clients.size === 0) {
    return;
  }
  const delta = buildPresentationSessionDelta(repository, input.projectId, input.sessionId);
  if (!delta) {
    return;
  }
  getPresentationDeltaCoalescer(runtime).schedule(
    { projectId: input.projectId, sessionId: input.sessionId },
    input.reason,
    delta,
    (decision) => {
      const db = openGxserverDatabase(runtime.paths);
      try {
        const flushRepository = new GxserverDomainRepository(db, runtime.metadata.serverId);
        const latestDelta = buildPresentationSessionDelta(flushRepository, input.projectId, input.sessionId);
        if (!latestDelta) {
          return;
        }
        const deltaJson = stringifyPresentationDelta(latestDelta);
        const previousDeltaJson = getPresentationLastDeltaJsonBySessionKey(runtime).get(decision.key);
        if (previousDeltaJson === deltaJson) {
          void runtime.logger.log({
            details: {
              coalescedCount: decision.coalescedCount,
              reason: decision.reason,
              skipped: "unchanged-projection",
            },
            event: "session-presentation.deltaSkipped",
            level: "debug",
            projectId: input.projectId,
            serverId: runtime.metadata.serverId,
            sessionId: input.sessionId,
          });
          return;
        }
        getPresentationLastDeltaJsonBySessionKey(runtime).set(decision.key, deltaJson);
        const revision = incrementPresentationRevision(db);
        runtime.eventHub.broadcast({
          delta: latestDelta,
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
          revision,
          serverId: runtime.metadata.serverId,
          type: "presentationDelta",
        });
        void runtime.logger.log({
          details: {
            coalescedCount: decision.coalescedCount,
            deltaType: latestDelta.type,
            reason: decision.reason,
            revision,
          },
          event: "session-presentation.delta",
          level: "debug",
          projectId: input.projectId,
          serverId: runtime.metadata.serverId,
          sessionId: input.sessionId,
        });
      } finally {
        db.close();
      }
    },
  );
}

function buildPresentationProjectDelta(
  repository: GxserverDomainRepository,
  projectId: GxserverProjectId,
  type: "projectAdded" | "projectUpdated",
): GxserverPresentationDelta | undefined {
  const project = repository.getProject(projectId);
  if (!project) {
    return {
      projectId,
      type: "projectRemoved",
    };
  }
  return {
    project: projectPresentationProject(project),
    type,
  };
}

function scheduleStaleActivityPresentationRefresh(
  runtime: GxserverApiRuntime,
  session: GxserverSessionDomainState,
  reason: string,
): void {
  const key = `${session.projectId}/${session.sessionId}`;
  const timers = getPresentationStaleActivityTimers(runtime);
  const existingTimer = timers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
    timers.delete(key);
  }
  const delayMs = getAgentActivityStaleProjectionDelayMs(session.runtimeSettings.agentActivity);
  if (delayMs === undefined) {
    return;
  }
  /*
  CDXC:SessionStatus 2026-06-01-20:26:
  zmx emits title observations only when the terminal title changes. Schedule one presentation refresh at the old macOS spinner window boundary so connected clients clear a frozen Codex/Claude/Cursor/Pi working glyph even when no further title event arrives.
  */
  const timer = setTimeout(() => {
    timers.delete(key);
    const db = openGxserverDatabase(runtime.paths);
    try {
      schedulePresentationSessionDelta(runtime, new GxserverDomainRepository(db, runtime.metadata.serverId), {
        projectId: session.projectId,
        reason,
        sessionId: session.sessionId,
      });
    } finally {
      db.close();
    }
  }, delayMs + 25);
  timer.unref();
  timers.set(key, timer);
}

function getPresentationStaleActivityTimers(
  runtime: GxserverApiRuntime,
): Map<string, ReturnType<typeof setTimeout>> {
  runtime.presentationStaleActivityTimers ??= new Map();
  return runtime.presentationStaleActivityTimers;
}

function buildPresentationSessionDelta(
  repository: GxserverDomainRepository,
  projectId: GxserverProjectId,
  sessionId: GxserverSessionId,
): GxserverPresentationDelta | undefined {
  const project = repository.getProject(projectId);
  const session = repository.getSession(projectId, sessionId);
  if (!project || !session) {
    return {
      projectId,
      sessionId,
      type: "sessionRemoved",
    };
  }
  if (!shouldIncludePresentationSession(session)) {
    return {
      projectId,
      sessionId,
      type: "sessionRemoved",
    };
  }
  return {
    session: projectPresentationSession(project, defaultGroupId(projectId), session),
    type: "sessionPresentationChanged",
  };
}

function stringifyPresentationDelta(delta: GxserverPresentationDelta): string {
  return JSON.stringify(delta);
}

function getPresentationLastDeltaJsonBySessionKey(runtime: GxserverApiRuntime): Map<string, string> {
  runtime.presentationLastDeltaJsonBySessionKey ??= new Map();
  return runtime.presentationLastDeltaJsonBySessionKey;
}

function getPresentationDeltaCoalescer(runtime: GxserverApiRuntime): GxserverPresentationDeltaCoalescer {
  runtime.presentationDeltaCoalescer ??= new GxserverPresentationDeltaCoalescer();
  return runtime.presentationDeltaCoalescer;
}

function scheduleAgentTitleMetadataCheck(
  runtime: GxserverApiRuntime,
  leadingRepository: GxserverDomainRepository | undefined,
  input: {
    force?: boolean;
    projectId: GxserverProjectId;
    reason: string;
    sessionId: GxserverSessionLifecycleParams["sessionId"];
  },
):
  | {
      changed: boolean;
      metadataTitleFound: boolean;
      reason: string;
      session?: GxserverSessionDomainState;
    }
  | undefined {
  let latestResult:
    | {
        changed: boolean;
        metadataTitleFound: boolean;
        reason: string;
        session?: GxserverSessionDomainState;
      }
    | undefined;
  agentTitleMetadataDebouncer.schedule({
    key: `${runtime.paths.rootDir}:${runtime.metadata.serverId}:${input.projectId}:${input.sessionId}`,
    run: (decision) => {
      latestResult = runAgentTitleMetadataCheck(runtime, leadingRepository, input, decision);
    },
  });
  return latestResult;
}

function runAgentTitleMetadataCheck(
  runtime: GxserverApiRuntime,
  leadingRepository: GxserverDomainRepository | undefined,
  input: {
    force?: boolean;
    projectId: GxserverProjectId;
    reason: string;
    sessionId: GxserverSessionLifecycleParams["sessionId"];
  },
  decision: GxserverAgentTitleDebounceDecision,
):
  | {
      changed: boolean;
      metadataTitleFound: boolean;
      reason: string;
      session?: GxserverSessionDomainState;
    }
  | undefined {
  const useLeadingRepository = decision.edge === "leading" && leadingRepository !== undefined;
  let db: ReturnType<typeof openGxserverDatabase> | undefined;
  try {
    db = useLeadingRepository ? undefined : openGxserverDatabase(runtime.paths);
    const repository = useLeadingRepository ? leadingRepository! : new GxserverDomainRepository(db!, runtime.metadata.serverId);
    const session = repository.getSession(input.projectId, input.sessionId);
    if (!session || (input.force !== true && !shouldCheckAgentMetadataTitle(session))) {
      void runtime.logger.log({
        details: {
          edge: decision.edge,
          reason: input.reason,
          skippedReason: session ? "not-needed" : "session-missing",
          suppressedCount: decision.suppressedCount,
        },
        event: "agentTitleMetadata.checkSkipped",
        level: "debug",
        projectId: input.projectId,
        serverId: runtime.metadata.serverId,
        sessionId: input.sessionId,
      });
      return session
        ? { changed: false, metadataTitleFound: false, reason: "metadata-check-not-needed", session }
        : undefined;
    }
    /*
    CDXC:GxserverAgentTitles 2026-06-01-09:03:
    Rename and title-observation triggers enter one gxserver metadata-check path with structured logging under `agentTitleMetadata.*`. The log label lets clients verify whether rename checks are noisy while the debouncer keeps Codex session-index reads to a leading check plus one trailing check per burst.
    */
    const result = reconcileAgentMetadataTitle(repository, {
      homeDir: runtime.paths.homeDir,
      pendingMismatchStatus: decision.edge === "leading" ? "pending" : "metadata-mismatch",
      projectId: input.projectId,
      sessionId: input.sessionId,
    });
    void runtime.logger.log({
      details: {
        changed: result.changed,
        edge: decision.edge,
        metadataTitleFound: result.metadataTitleFound,
        reason: input.reason,
        reconcileReason: result.reason,
        suppressedCount: decision.suppressedCount,
      },
      event: "agentTitleMetadata.check",
      level: "debug",
      projectId: input.projectId,
      serverId: runtime.metadata.serverId,
      sessionId: input.sessionId,
    });
    return result;
  } catch (error) {
    void runtime.logger.log({
      details: {
        edge: decision.edge,
        reason: input.reason,
        suppressedCount: decision.suppressedCount,
      },
      error: error instanceof Error ? error : String(error),
      event: "agentTitleMetadata.checkFailed",
      level: "warn",
      projectId: input.projectId,
      serverId: runtime.metadata.serverId,
      sessionId: input.sessionId,
    });
    return undefined;
  } finally {
    db?.close();
  }
}

async function handleTypedOperationEndpoint(
  runtime: GxserverApiRuntime,
  endpointPath: GxserverEndpointPath,
  body: unknown,
  requestId: string,
  abortSignal?: AbortSignal,
): Promise<GxserverRpcSuccessResponse> {
  const params = readOperationRpcParams(body);
  const db = openGxserverDatabase(runtime.paths);
  try {
    const repository = new GxserverDomainRepository(db, runtime.metadata.serverId);
    const projects = repository.listProjects();
    const { cwd, project } = resolveProjectOperationDirectory(projects, params);
    const context = { abortSignal, cwd, envPath: process.env.PATH, projects };
    const result =
      endpointPath === "/api/runGitAction"
        ? await runGitAction(params as unknown as GxserverRunGitActionParams, context)
        : endpointPath === "/api/runWorktreeAction"
          ? await runWorktreeAction(params as unknown as GxserverRunWorktreeActionParams, context)
          : await runBeadsAction(params as unknown as GxserverRunBeadsActionParams, context);
    await runtime.logger.log({
      details: {
        action: result.action,
        argumentCount: result.command?.args.length,
        commandBuilt: result.command !== undefined,
        executable: result.command?.executable,
        exitCode: result.exitCode,
        operationError: result.error,
      },
      event: "typedOperation",
      level: result.exitCode === 0 ? "info" : "warn",
      projectId: project.projectId,
      requestId,
      serverId: runtime.metadata.serverId,
    });
    return {
      ok: true,
      product: GXSERVER_PRODUCT,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      requestId,
      result: result as unknown as Record<string, unknown>,
    };
  } finally {
    db.close();
  }
}

async function handleZmxLifecycleEndpoint(
  runtime: GxserverApiRuntime,
  endpointPath: GxserverEndpointPath,
  body: unknown,
  requestId: string,
): Promise<GxserverRpcSuccessResponse> {
  const params = readDomainRpcParams(body);
  const db = openGxserverDatabase(runtime.paths);
  try {
    const repository = new GxserverDomainRepository(db, runtime.metadata.serverId);
    const result = await dispatchZmxLifecycleEndpoint(runtime, repository, endpointPath, params, requestId);
    return {
      ok: true,
      product: GXSERVER_PRODUCT,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      requestId,
      result,
    };
  } finally {
    db.close();
  }
}

async function dispatchZmxLifecycleEndpoint(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  endpointPath: GxserverEndpointPath,
  params: Record<string, unknown>,
  requestId: string,
): Promise<Record<string, unknown>> {
  switch (endpointPath) {
    case "/api/probeSessionProvider": {
      const { session, probe } = await probeAndCacheSessionProvider(runtime, repository, readSessionLifecycleParams(params));
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: session.projectId,
        reason: "probe-session-provider",
        sessionId: session.sessionId,
      });
      return { provider: "zmx", providerState: probe, session };
    }
    case "/api/attachSessionMetadata":
    case "/api/wakeSession": {
      const attach = await createAttachSessionMetadata(
        runtime,
        repository,
        params as unknown as GxserverAttachSessionMetadataParams,
        requestId,
      );
      const session =
        endpointPath === "/api/wakeSession" && !attach.restoreBlocked
          ? repository.updateSession({
              lifecycleState: "running",
              projectId: attach.session.projectId,
              providerState: attach.session.providerState,
              sessionId: attach.session.sessionId,
            })
          : attach.session;
      const normalizedAttach: GxserverAttachSessionMetadataResult =
        session === attach.session ? attach : { ...attach, session };
      observeZmxTitleForSession(runtime, normalizedAttach.session, endpointPath === "/api/wakeSession" ? "wake-session" : "attach-session-metadata");
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: normalizedAttach.session.projectId,
        reason: endpointPath === "/api/wakeSession" ? "wake-session" : "attach-session-metadata",
        sessionId: normalizedAttach.session.sessionId,
      });
      return endpointPath === "/api/wakeSession"
        ? { attach: normalizedAttach, session }
        : { attach: normalizedAttach };
    }
    case "/api/transitionSession": {
      const result = await dispatchSessionTransitionEndpoint(runtime, repository, normalizeSessionTransitionParams(params), requestId);
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: result.session.projectId,
        reason: "transition-session",
        sessionId: result.session.sessionId,
      });
      return result as unknown as Record<string, unknown>;
    }
    case "/api/sleepSession": {
      const lifecycle = readSessionLifecycleParams(params);
      const { kill, session } = await killAndCacheSessionProvider(
        runtime,
        repository,
        lifecycle,
        normalizeLifecycleReason(lifecycle.reason, "sleepSession"),
        "sleeping",
      );
      scheduleZmxTitleObserverSync(runtime, repository, "sleep-session");
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: session.projectId,
        reason: "sleep-session",
        sessionId: session.sessionId,
      });
      return { kill, session };
    }
    case "/api/killSession": {
      const lifecycle = readSessionLifecycleParams(params);
      const { kill, session } = await killAndCacheSessionProvider(
        runtime,
        repository,
        lifecycle,
        normalizeLifecycleReason(lifecycle.reason, "killSession"),
        "stopped",
      );
      scheduleZmxTitleObserverSync(runtime, repository, "kill-session");
      schedulePresentationSessionDelta(runtime, repository, {
        projectId: session.projectId,
        reason: "kill-session",
        sessionId: session.sessionId,
      });
      return { kill, session };
    }
    default:
      throw new GxserverDomainStateError("notFound", `${endpointPath} is not a gxserver zmx lifecycle endpoint.`);
  }
}

async function dispatchSessionTransitionEndpoint(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  params: GxserverSessionTransitionParams,
  requestId: string,
): Promise<GxserverSessionTransitionResult> {
  return applySessionTransition({
    params,
    repository,
    transitionSession: async (transitionParams) => {
      const { kill, session } = await killAndCacheSessionProvider(
        runtime,
        repository,
        transitionParams,
        normalizeLifecycleReason(
          transitionParams.reason,
          transitionParams.action === "sleep" ? "transitionSessionSleep" : "transitionSessionClose",
        ),
        transitionParams.action === "sleep" ? "sleeping" : "stopped",
      );
      return { kill, session };
    },
    isLiveProjectSession: async (session) => {
      const { probe } = await probeAndCacheSessionProvider(
        runtime,
        repository,
        {
          projectId: session.projectId,
          reason: `transitionSessionFocus:${requestId}`,
          sessionId: session.sessionId,
        },
      );
      return probe.lifecycleState === "exists";
    },
  });
}

async function handleZmxSessionInteractionEndpoint(
  runtime: GxserverApiRuntime,
  endpointPath: GxserverEndpointPath,
  body: unknown,
  requestId: string,
): Promise<GxserverRpcSuccessResponse> {
  const params = readDomainRpcParams(body);
  const db = openGxserverDatabase(runtime.paths);
  try {
    const repository = new GxserverDomainRepository(db, runtime.metadata.serverId);
    const result = await dispatchZmxSessionInteractionEndpoint(runtime, repository, endpointPath, params, requestId);
    return {
      ok: true,
      product: GXSERVER_PRODUCT,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      requestId,
      result,
    };
  } finally {
    db.close();
  }
}

async function dispatchZmxSessionInteractionEndpoint(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  endpointPath: GxserverEndpointPath,
  params: Record<string, unknown>,
  requestId: string,
): Promise<Record<string, unknown>> {
  /*
  CDXC:GxserverSessionIO 2026-05-30-23:32:
  readSessionText must never return unbounded `zmx history` output, and sendSessionText/sendSessionMessage must never embed user text in the shell script passed to `/bin/zsh -lc`. Cap history responses with truncation metadata and pass send payload bytes through zmx stdin after an explicit request-size check.
  */
  if (endpointPath === "/api/focusSession") {
    throw new GxserverTypedOperationError(
      "dependencyUnavailable",
      "gxserver focusSession is not available until a renderer event channel can focus visible macOS panes through gxserver. Use gx attach for terminal access.",
    );
  }
  if (endpointPath === "/api/sendSessionMessage" && params.sessionId === undefined) {
    throw new GxserverTypedOperationError(
      "dependencyUnavailable",
      "gxserver sendSessionMessage currently requires projectId and sessionId. Agent-targeted visible session creation needs a renderer event channel and is not available through gxserver yet.",
    );
  }

  const zmx = await (runtime.zmxLifecycle?.requireZmx ?? requireBundledZmx)();
  const lifecycle = readSessionLifecycleParams(params);
  const session = requireSession(repository, lifecycle);
  const zmxSessionName = providerZmxSessionName(session);
  switch (endpointPath) {
    case "/api/readSessionText": {
      const result = await runZmxInteractionCommand(
        runtime,
        buildZmxHistoryCommand({
          sessionName: zmxSessionName,
          zmxExecutablePath: zmx.executablePath,
        }),
        {
          allowStdoutTruncation: true,
          stdoutLimitBytes: GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES,
        },
      );
      return {
        capturedBytes: Buffer.byteLength(result.stdout, "utf8"),
        limitBytes: GXSERVER_ZMX_HISTORY_STDOUT_LIMIT_BYTES,
        provider: "zmx",
        session,
        source: "history",
        text: result.stdout,
        truncated: result.stdoutTruncated === true,
        ...(result.stdoutTruncated ? { truncatedReason: "historyOutputLimitExceeded" } : {}),
        zmxName: zmxSessionName,
      };
    }
    case "/api/sendSessionText": {
      const text = readInteractionText(params.text, "sendSessionText");
      const result = await runZmxInteractionCommand(
        runtime,
        buildZmxSendCommand({
          sessionName: zmxSessionName,
          zmxExecutablePath: zmx.executablePath,
        }),
        { stdin: text },
      );
      return {
        exitCode: result.exitCode,
        provider: "zmx",
        session,
        textBytes: Buffer.byteLength(text, "utf8"),
        textLength: text.length,
        zmxName: zmxSessionName,
      };
    }
    case "/api/sendSessionEnter": {
      const result = await runZmxInteractionCommand(runtime, buildZmxSendCommand({
        sessionName: zmxSessionName,
        zmxExecutablePath: zmx.executablePath,
      }), { stdin: "\r" });
      return {
        exitCode: result.exitCode,
        provider: "zmx",
        session,
        textBytes: 1,
        textLength: 1,
        zmxName: zmxSessionName,
      };
    }
    case "/api/sendSessionMessage": {
      const text = readInteractionText(params.text, "sendSessionMessage");
      const submit = params.submit !== false;
      const payload = submit ? `${text}\r` : text;
      const result = await runZmxInteractionCommand(
        runtime,
        buildZmxSendCommand({
          sessionName: zmxSessionName,
          zmxExecutablePath: zmx.executablePath,
        }),
        { stdin: payload },
      );
      return {
        exitCode: result.exitCode,
        provider: "zmx",
        session,
        submit,
        textBytes: Buffer.byteLength(text, "utf8"),
        textLength: text.length,
        zmxName: zmxSessionName,
      };
    }
    default:
      throw new GxserverDomainStateError("notFound", `${endpointPath} is not a gxserver zmx session interaction endpoint.`);
  }
}

async function runZmxInteractionCommand(
  runtime: GxserverApiRuntime,
  script: string,
  options: GxserverZmxCommandOptions & { allowStdoutTruncation?: boolean } = {},
): Promise<GxserverZmxCommandResult> {
  const result = await (runtime.zmxLifecycle?.runZsh ?? runZshScript)(script, options);
  if (result.exitCode !== 0 && !(options.allowStdoutTruncation === true && result.stdoutTruncated === true)) {
    throw new GxserverTypedOperationError(
      "dependencyUnavailable",
      result.stderr || result.stdout || `zmx session interaction command exited ${result.exitCode}`,
    );
  }
  return result;
}

function readInteractionText(value: unknown, commandName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GxserverDomainStateError("badRequest", `${commandName} requires non-empty text.`);
  }
  const textBytes = Buffer.byteLength(value, "utf8");
  if (textBytes > GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES) {
    throw new GxserverDomainStateError(
      "badRequest",
      `${commandName} text exceeds the ${GXSERVER_ZMX_SEND_TEXT_LIMIT_BYTES}-byte zmx send limit.`,
    );
  }
  return value;
}

async function createAttachSessionMetadata(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  params: GxserverAttachSessionMetadataParams,
  requestId: string,
): Promise<GxserverAttachSessionMetadataResult> {
  const lifecycle = readSessionLifecycleParams(params as unknown as Record<string, unknown>);
  const project = repository.getProject(lifecycle.projectId);
  const session = repository.getSession(lifecycle.projectId, lifecycle.sessionId);
  if (!project) {
    throw new GxserverDomainStateError("notFound", `Project ${lifecycle.projectId} does not exist.`);
  }
  if (!session) {
    throw new GxserverDomainStateError(
      "notFound",
      `Session ${lifecycle.projectId}/${lifecycle.sessionId} does not exist.`,
    );
  }

  const cwd = session.cwd ?? project.path;
  const { probe, session: probedSession, zmx, zmxSessionName } = await probeAndCacheSessionProvider(
    runtime,
    repository,
    lifecycle,
  );
  /*
  CDXC:GxserverTerminalWake 2026-06-01-12:07:
  Sleeping-session wake should let gxserver rebuild the real agent resume command from shared session metadata. A macOS renderer can legitimately pass an empty string when its legacy local resume builder has no text; treat blank startupText as absent instead of suppressing the server-owned resume plan.
  */
  const startupText = normalizeOptionalStartupText(params.startupText) ?? getAgentStartupTextForSession(project, probedSession);
  const startupTextDisposition = decideStartupTextDisposition({
    providerState: probe.lifecycleState,
    startupText,
  });

  if (probe.lifecycleState === "missing" && !(cwd && (await (runtime.zmxLifecycle?.cwdExists ?? defaultCwdExists)(cwd)))) {
    await runtime.logger.log({
      event: "zmx.restoreBlocked",
      level: "warn",
      projectId: lifecycle.projectId,
      requestId,
      serverId: runtime.metadata.serverId,
      sessionId: lifecycle.sessionId,
      details: {
        cwdConfigured: cwd !== undefined,
        reason: "missingCwd",
        zmxName: zmxSessionName,
      },
    });
    return {
      provider: "zmx",
      providerState: probe,
      restoreBlocked: {
        ...(cwd ? { cwd } : {}),
        reason: "missingCwd",
      },
      session: probedSession,
      ...(startupTextDisposition === "queueAfterTerminalReady" && startupText ? { startupText } : {}),
      startupTextDisposition,
      zmxName: zmxSessionName,
    };
  }

  return {
    attachCommand: buildZmxAttachCommand({
      cwd: cwd ?? "",
      globalSessionRef: probedSession.globalRef,
      gxserverBaseUrl: `http://${GXSERVER_LOCAL_API_HOST}:${GXSERVER_LOCAL_API_PORT}`,
      sessionName: zmxSessionName,
      title: probedSession.title,
      zmxExecutablePath: zmx.executablePath,
    }),
    cwd,
    persistenceSessionCreated: probe.lifecycleState === "missing",
    provider: "zmx",
    providerState: probe,
    session: probedSession,
    ...(startupTextDisposition === "queueAfterTerminalReady" && startupText ? { startupText } : {}),
    startupTextDisposition,
    zmxName: zmxSessionName,
  };
}

function normalizeOptionalStartupText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function probeAndCacheSessionProvider(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  lifecycle: GxserverSessionLifecycleParams,
): Promise<{
  probe: GxserverProviderProbeResult;
  session: GxserverSessionDomainState;
  zmx: GxserverResolvedTool;
  zmxSessionName: GxserverProviderProbeResult["zmxName"];
}> {
  const session = requireSession(repository, lifecycle);
  const zmx = await (runtime.zmxLifecycle?.requireZmx ?? requireBundledZmx)();
  const zmxSessionName = providerZmxSessionName(session);
  const probe = await probeZmxSession({
    runZsh: runtime.zmxLifecycle?.runZsh,
    sessionName: zmxSessionName,
    zmxExecutablePath: zmx.executablePath,
  });
  const updated = repository.updateSession({
    projectId: session.projectId,
    providerState: providerStatePatch(session, probe),
    sessionId: session.sessionId,
  });
  return { probe, session: updated, zmx, zmxSessionName };
}

async function killAndCacheSessionProvider(
  runtime: GxserverApiRuntime,
  repository: GxserverDomainRepository,
  lifecycle: GxserverSessionLifecycleParams,
  reason: string,
  lifecycleState: "sleeping" | "stopped",
): Promise<{ kill: GxserverProviderKillResult; session: GxserverSessionDomainState }> {
  const session = requireSession(repository, lifecycle);
  const zmx = await (runtime.zmxLifecycle?.requireZmx ?? requireBundledZmx)();
  const zmxSessionName = providerZmxSessionName(session);
  const kill = await killZmxSession({
    runZsh: runtime.zmxLifecycle?.runZsh,
    sessionName: zmxSessionName,
    zmxExecutablePath: zmx.executablePath,
  });
  const timestamp = new Date().toISOString();
  /*
  CDXC:GxserverZmxLifecycle 2026-05-30-19:41:
  Sleep and kill requests may fail after zmx has kept the provider session alive. A failed kill must leave the stored session and provider lifecycle as `unknown` with the kill error instead of persisting terminal UI state (`sleeping`/`stopped`) or provider `missing`, so clients retain the route to the possible live zmx session.
  */
  const updated = repository.updateSession({
    lifecycleState: kill.killed ? lifecycleState : "unknown",
    projectId: session.projectId,
    providerState: kill.killed
      ? missingProviderStatePatch(session, timestamp)
      : failedKillProviderStatePatch(session, kill, timestamp),
    sessionId: session.sessionId,
  });
  await runtime.logger.log({
    event: kill.killed ? "zmx.kill.completed" : "zmx.kill.failed",
    level: kill.killed ? "info" : "warn",
    projectId: session.projectId,
    serverId: runtime.metadata.serverId,
    sessionId: session.sessionId,
    details: {
      exitCode: kill.exitCode,
      reason,
      zmxName: zmxSessionName,
    },
    ...(kill.error ? { error: kill.error } : {}),
  });
  return { kill, session: updated };
}

function requireSession(
  repository: GxserverDomainRepository,
  lifecycle: GxserverSessionLifecycleParams,
): GxserverSessionDomainState {
  const session = repository.getSession(lifecycle.projectId, lifecycle.sessionId);
  if (!session) {
    throw new GxserverDomainStateError(
      "notFound",
      `Session ${lifecycle.projectId}/${lifecycle.sessionId} does not exist.`,
    );
  }
  return session;
}

function isDomainStateEndpoint(path: GxserverEndpointPath): boolean {
  return (
    path === "/api/createProject" ||
    path === "/api/updateProject" ||
    path === "/api/listProjects" ||
    path === "/api/readProjectStatus" ||
    path === "/api/addProjectPath" ||
    path === "/api/createSession" ||
    path === "/api/createAgentSession" ||
    path === "/api/readAgentLaunchPlan" ||
    path === "/api/readAgentResumePlan" ||
    path === "/api/requestSessionRename" ||
    path === "/api/ingestSessionStateEvent" ||
    path === "/api/ingestTerminalTitleEvent" ||
    path === "/api/updateAgentActivity" ||
    path === "/api/readPresentationSnapshot" ||
    path === "/api/searchSessions" ||
    path === "/api/listPreviousSessions" ||
    path === "/api/updateSession" ||
    path === "/api/listSessions" ||
    path === "/api/readClientLayout" ||
    path === "/api/updateClientLayout"
  );
}

function isTypedOperationEndpoint(path: GxserverEndpointPath): boolean {
  return path === "/api/runGitAction" || path === "/api/runWorktreeAction" || path === "/api/runBeadsAction";
}

function isRepositoryCloneEndpoint(path: GxserverEndpointPath): boolean {
  return (
    path === "/api/previewRepositoryClone" ||
    path === "/api/startRepositoryClone" ||
    path === "/api/readRepositoryCloneJob" ||
    path === "/api/cancelRepositoryCloneJob"
  );
}

function isZmxLifecycleEndpoint(path: GxserverEndpointPath): boolean {
  return (
    path === "/api/attachSessionMetadata" ||
    path === "/api/probeSessionProvider" ||
    path === "/api/transitionSession" ||
    path === "/api/sleepSession" ||
    path === "/api/wakeSession" ||
    path === "/api/killSession"
  );
}

function isZmxSessionInteractionEndpoint(path: GxserverEndpointPath): boolean {
  return (
    path === "/api/readSessionText" ||
    path === "/api/sendSessionText" ||
    path === "/api/sendSessionMessage" ||
    path === "/api/sendSessionEnter" ||
    path === "/api/focusSession"
  );
}

function normalizeAddProjectPathParams(params: Record<string, unknown>): GxserverCreateProjectParams {
  const normalizedPath = normalizeExistingDirectoryPath(params.path ?? params.projectPath, "path");
  return {
    ...(params as unknown as GxserverCreateProjectParams),
    name:
      typeof params.name === "string" && params.name.trim()
        ? params.name.trim()
        : normalizedPath.split(/[\\/]/).filter(Boolean).at(-1) ?? normalizedPath,
    path: normalizedPath,
  };
}

function addProjectPath(
  repository: GxserverDomainRepository,
  params: Record<string, unknown>,
): GxserverProjectDomainState {
  const createParams = normalizeAddProjectPathParams(params);
  const projects = repository.listProjects();
  const worktree = detectRegisteredGitWorktreeMetadata(
    projects,
    createParams.path ?? "",
    createParams.name,
  );
  const existingProject = findProjectByPath(projects, createParams.path);
  if (existingProject) {
    if (worktree && !areProjectWorktreeMetadataEqual(existingProject.worktree, worktree)) {
      return repository.updateProject({
        projectId: existingProject.projectId,
        worktree,
      });
    }
    return existingProject;
  }
  return repository.createProject({
    ...createParams,
    ...(worktree ? { worktree } : {}),
  });
}

function areProjectWorktreeMetadataEqual(left: unknown, right: Record<string, unknown>): boolean {
  if (!left || typeof left !== "object" || Array.isArray(left)) {
    return false;
  }
  const current = left as Record<string, unknown>;
  return (
    current.branch === right.branch &&
    current.name === right.name &&
    current.parentProjectId === right.parentProjectId &&
    current.parentProjectName === right.parentProjectName &&
    current.parentProjectPath === right.parentProjectPath
  );
}

function normalizeCreateSessionParams(
  repository: GxserverDomainRepository,
  params: Record<string, unknown>,
): GxserverCreateSessionDomainParams {
  const project = resolveCreateSessionProject(repository, params);
  return {
    ...(params as unknown as GxserverCreateSessionParams),
    projectId: project.projectId,
  };
}

function readRuntimeText(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRequiredText(value: unknown, field: string): string {
  const text = readOptionalText(value);
  if (!text) {
    throw new GxserverDomainStateError("badRequest", `${field} is required.`);
  }
  return text;
}

function normalizeCreateAgentSessionParams(
  repository: GxserverDomainRepository,
  params: Record<string, unknown>,
): GxserverCreateSessionDomainParams {
  const project = resolveCreateSessionProject(repository, params);
  return createAgentSessionParams(project, {
    ...(params as unknown as GxserverCreateSessionParams),
    kind: "agent",
    projectId: project.projectId,
  }) as GxserverCreateSessionDomainParams;
}

function resolveCreateSessionProject(
  repository: GxserverDomainRepository,
  params: Record<string, unknown>,
): GxserverProjectDomainState {
  const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
  if (isGxserverProjectId(projectId)) {
    const project = repository.getProject(projectId);
    if (project) {
      return project;
    }
  }

  /*
  CDXC:GxserverProjectIdentity 2026-05-31-17:47:
  Session creation is a shared API used by macOS, CLI/TUI, mobile, and future desktop clients. Resolve `projectPath` or `cwd` to the canonical gxserver project before creating sessions so clients do not need to mint daemon-facing IDs, and so stale legacy `project-*` sidebar IDs cannot create orphaned or missing-project requests.
  */
  const projectPath = params.projectPath ?? params.cwd;
  if (typeof projectPath === "string" && projectPath.trim()) {
    const normalizedPath = normalizeExistingDirectoryPath(projectPath, params.projectPath ? "projectPath" : "cwd");
    const existingProject = findProjectByPath(repository.listProjects(), normalizedPath);
    if (existingProject) {
      return existingProject;
    }
    return repository.createProject({
      name:
        typeof params.projectName === "string" && params.projectName.trim()
          ? params.projectName.trim()
          : normalizedPath.split(/[\\/]/).filter(Boolean).at(-1) ?? normalizedPath,
      path: normalizedPath,
    });
  }

  if (projectId && !isGxserverProjectId(projectId)) {
    throw new GxserverDomainStateError("badRequest", `Invalid gxserver project ID: ${projectId}.`);
  }
  if (projectId) {
    throw new GxserverDomainStateError("notFound", `Project ${projectId} does not exist.`);
  }
  throw new GxserverDomainStateError("badRequest", "createSession requires projectId, projectPath, or cwd.");
}

function findProjectByPath(
  projects: readonly GxserverProjectDomainState[],
  normalizedPath: string | undefined,
): GxserverProjectDomainState | undefined {
  if (!normalizedPath) {
    return undefined;
  }
  return projects.find((project) => project.path === normalizedPath);
}

function readOperationRpcParams(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new GxserverTypedOperationError("badRequest", "RPC request body must be an object.");
  }
  if (body.params === undefined) {
    return {};
  }
  if (!isRecord(body.params)) {
    throw new GxserverTypedOperationError("badRequest", "RPC params must be an object.");
  }
  return body.params;
}

function readRepositoryCloneRpcParams(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new GxserverRepositoryCloneError("badRequest", "RPC request body must be an object.");
  }
  if (body.params === undefined) {
    return {};
  }
  if (!isRecord(body.params)) {
    throw new GxserverRepositoryCloneError("badRequest", "RPC params must be an object.");
  }
  return body.params;
}

function statusForOperationError(code: GxserverTypedOperationError["code"] | GxserverProjectPathError["code"]): number {
  switch (code) {
    case "dependencyUnavailable":
      return 503;
    case "forbidden":
      return 403;
    case "notFound":
      return 404;
    default:
      return 400;
  }
}

function statusForRepositoryCloneError(code: GxserverRepositoryCloneError["code"]): number {
  switch (code) {
    case "dependencyUnavailable":
      return 503;
    case "forbidden":
      return 403;
    case "notFound":
      return 404;
    default:
      return 400;
  }
}

function statusForDomainStateError(code: GxserverDomainStateError["code"]): number {
  switch (code) {
    case "corruptState":
      return 409;
    case "notFound":
      return 404;
    default:
      return 400;
  }
}

function readDomainRpcParams(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new GxserverDomainStateError("badRequest", "RPC request body must be an object.");
  }
  if (body.params === undefined) {
    return {};
  }
  if (!isRecord(body.params)) {
    throw new GxserverDomainStateError("badRequest", "RPC params must be an object.");
  }
  return body.params;
}

function readProjectId(params: Record<string, unknown>): GxserverProjectId {
  if (!isGxserverProjectId(params.projectId)) {
    throw new GxserverDomainStateError("badRequest", `Invalid gxserver project ID: ${String(params.projectId)}.`);
  }
  return params.projectId;
}

function readOptionalProjectId(params: Record<string, unknown>): GxserverProjectId | undefined {
  if (params.projectId === undefined || params.projectId === null || params.projectId === "") {
    return undefined;
  }
  return readProjectId(params);
}

function readSessionLifecycleParams(params: Record<string, unknown>): GxserverSessionLifecycleParams {
  const projectId = readProjectId(params);
  if (!isGxserverSessionId(params.sessionId)) {
    throw new GxserverDomainStateError("badRequest", `Invalid gxserver session ID: ${String(params.sessionId)}.`);
  }
  return {
    projectId,
    reason: typeof params.reason === "string" ? params.reason : undefined,
    sessionId: params.sessionId,
  };
}

interface HandleUpgradeOptions {
  head: Buffer;
  listenerKind: GxserverListenerKind;
  request: http.IncomingMessage;
  runtime: GxserverApiRuntime;
  socket: Duplex;
}

async function handleUpgrade(options: HandleUpgradeOptions): Promise<void> {
  const { head, listenerKind, request, runtime, socket } = options;
  const requestId = getRequestId(request);
  const url = new URL(request.url ?? "/", `http://${GXSERVER_LOCAL_API_HOST}:${GXSERVER_LOCAL_API_PORT}`);
  const endpoint = getGxserverEndpoint(url.pathname);

  const reject = (statusCode: number, body: unknown): void => {
    const payload = `${JSON.stringify(body)}\n`;
    socket.write(
      `HTTP/1.1 ${statusCode} ${http.STATUS_CODES[statusCode] ?? "Rejected"}\r\n` +
        "content-type: application/json; charset=utf-8\r\n" +
        `content-length: ${Buffer.byteLength(payload)}\r\n` +
        "connection: close\r\n\r\n" +
        payload,
    );
    socket.destroy();
  };

  if (!endpoint || endpoint.transport !== "webSocket") {
    reject(404, createRpcError("notFound", `No gxserver WebSocket endpoint for ${url.pathname}.`, requestId));
    return;
  }
  /*
  CDXC:GxserverPresentationEvents 2026-06-01-15:08:
  Browser WebSocket constructors cannot set Authorization headers. Allow the same bearer token as an `authToken` query value on the authenticated event-stream upgrade so native WebKit clients can subscribe to presentation deltas without adding a polling fallback.
  */
  const isAuthorizedUpgrade =
    isAuthorizedGxserverRequest(request, runtime.authToken) ||
    isExpectedGxserverAuthToken(url.searchParams.get("authToken") ?? "", runtime.authToken);
  if (!isAuthorizedUpgrade) {
    reject(401, createRpcError("unauthorized", "gxserver auth token is required for this endpoint.", requestId));
    return;
  }
  const protocolVersion = readProtocolVersion(request, url);
  if (!isExpectedProtocolVersion(protocolVersion)) {
    reject(426, createProtocolMismatchError(protocolVersion, requestId));
    return;
  }
  if (!isRemoteEndpointAllowed(listenerKind, endpoint.permission)) {
    reject(403, createRpcError("forbidden", `${endpoint.path} is not available on the remote gxserver listener.`, requestId));
    return;
  }

  runtime.eventHub.server.handleUpgrade(request, socket, head, (webSocket) => {
    runtime.eventHub.server.emit("connection", webSocket, request);
  });
}

function createMinimalHealth(version: string): GxserverMinimalHealthResponse {
  return {
    ok: true,
    product: GXSERVER_PRODUCT,
    protocolVersion: GXSERVER_PROTOCOL_VERSION,
    version,
  };
}

async function createAuthenticatedHealth(runtime: GxserverApiRuntime): Promise<Record<string, unknown>> {
  return {
    ...createMinimalHealth(runtime.version),
    buildIdentity: runtime.buildIdentity,
    capabilities: GXSERVER_CONTROL_PLANE_CAPABILITIES,
    listeners: runtime.config.listeners,
    migration: runtime.migration,
    pid: runtime.metadata.pid,
    port: runtime.metadata.port,
    serverId: runtime.metadata.serverId,
    startedAt: runtime.metadata.startedAt,
    tools: await getGxserverToolStatuses(),
  };
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  const contentLength = readContentLength(request);
  if (contentLength !== undefined && contentLength > GXSERVER_JSON_BODY_LIMIT_BYTES) {
    throw new GxserverRequestBodyTooLargeError(contentLength);
  }
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > GXSERVER_JSON_BODY_LIMIT_BYTES) {
      throw new GxserverRequestBodyTooLargeError(receivedBytes);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

function readContentLength(request: http.IncomingMessage): number | undefined {
  const header = request.headers["content-length"];
  if (typeof header !== "string" || !/^\d+$/.test(header)) {
    return undefined;
  }
  return Number(header);
}

class GxserverRequestBodyTooLargeError extends Error {
  constructor(readonly receivedBytes: number) {
    super(`Request body exceeds ${GXSERVER_JSON_BODY_LIMIT_BYTES} bytes: ${receivedBytes}`);
  }
}

function sendJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function applyCorsHeaders(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  config: GxserverConfig,
): void {
  const origin = readSingleHeader(request.headers.origin);
  if (!origin) {
    return;
  }
  appendVaryHeader(response, "Origin");
  appendVaryHeader(response, "Access-Control-Request-Private-Network");
  if (!isAllowedCorsOrigin(origin, config)) {
    return;
  }
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader(
    "access-control-allow-headers",
    "authorization, content-type, x-gxserver-protocol-version, x-request-id",
  );
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (readSingleHeader(request.headers["access-control-request-private-network"]) === "true") {
    response.setHeader("access-control-allow-private-network", "true");
  }
  response.setHeader("access-control-max-age", "600");
}

function isAllowedCorsOrigin(origin: string, config: GxserverConfig): boolean {
  return config.cors.allowedOrigins.includes(origin);
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

function appendVaryHeader(response: http.ServerResponse, value: string): void {
  const existing = response.getHeader("vary");
  const values = new Set(
    (Array.isArray(existing) ? existing.join(",") : String(existing ?? ""))
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  values.add(value);
  response.setHeader("vary", [...values].join(", "));
}

function readRpcParams(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new GxserverLogQueryInputError("RPC request body must be an object.");
  }
  if (body.params === undefined) {
    return {};
  }
  if (!isRecord(body.params)) {
    throw new GxserverLogQueryInputError("RPC params must be an object.");
  }
  return body.params;
}

function getRequestId(request: http.IncomingMessage): string {
  const header = request.headers["x-request-id"];
  if (typeof header === "string" && header.trim()) {
    return header;
  }
  return randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listen(server: http.Server, config: GxserverListenerConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error: Error): void => {
      cleanup();
      if (isAddressInUseError(error)) {
        reject(
          new Error(
            `Port ${config.port} is already in use and did not respond as a compatible gxserver. Stop the conflicting process or update Ghostex/gxserver so their protocol versions match.`,
          ),
        );
        return;
      }
      reject(error);
    };
    const onListening = (): void => {
      cleanup();
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });
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

function isAddressInUseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}
