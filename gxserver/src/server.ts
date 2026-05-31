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
import { ensureGxserverAuthToken, isAuthorizedGxserverRequest, readGxserverAuthToken } from "./auth.js";
import { GxserverDomainRepository, GxserverDomainStateError } from "./domain-state.js";
import { GxserverEventHub } from "./events.js";
import { isGxserverProjectId, isGxserverSessionId } from "./ids.js";
import { fetchServerHealth } from "./http-client.js";
import { ensureGxserverIdentity } from "./identity.js";
import { migrateLegacyMacosStateIntoGxserver } from "./legacy-macos-state-migration.js";
import { createGxserverLogger, logLevelFromStatus, type GxserverLogger } from "./logger.js";
import { GxserverLogQueryInputError, queryGxserverLogs } from "./logs.js";
import { assertSupportedNodeVersion } from "./node-version.js";
import {
  createAgentSessionParams,
  getAgentStartupTextForSession,
  updateSessionActivitySettings,
} from "./agent-lifecycle.js";
import { type GxserverPaths, getGxserverPaths } from "./paths.js";
import { GxserverProjectPathError, normalizeExistingDirectoryPath, resolveProjectOperationDirectory } from "./project-paths.js";
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
  GxserverProjectId,
  GxserverProviderKillResult,
  GxserverProviderProbeResult,
  GxserverRunBeadsActionParams,
  GxserverRunGitActionParams,
  GxserverRunWorktreeActionParams,
  GxserverRpcSuccessResponse,
  GxserverRuntimeMetadata,
  GxserverServerId,
  GxserverSessionDomainState,
  GxserverSessionLifecycleParams,
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
  zmxLifecycle?: {
    cwdExists?: GxserverCwdExists;
    requireZmx?: () => Promise<GxserverResolvedTool>;
    runZsh?: GxserverZmxCommandRunner;
  };
}

/*
CDXC:GxserverApi 2026-05-30-20:04:
Authenticated HTTP RPC clients must not be able to grow gxserver memory by streaming unbounded JSON bodies. Keep POST body parsing capped at 1 MiB, reject larger Content-Length values before reading, and stop retaining chunks as soon as chunked transfer input crosses the same limit.
*/
export const GXSERVER_JSON_BODY_LIMIT_BYTES = 1024 * 1024;

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

  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
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

  const runtime: GxserverApiRuntime = {
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
  };

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
    const result = dispatchDomainStateEndpoint(repository, endpointPath, readDomainRpcParams(body));
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
  repository: GxserverDomainRepository,
  endpointPath: GxserverEndpointPath,
  params: Record<string, unknown>,
): Record<string, unknown> {
  switch (endpointPath) {
    case "/api/createProject":
      return { project: repository.createProject(params as unknown as GxserverCreateProjectParams) };
    case "/api/updateProject":
      return { project: repository.updateProject(params as unknown as GxserverUpdateProjectParams) };
    case "/api/listProjects":
      return { projects: repository.listProjects() };
    case "/api/readProjectStatus": {
      const projectId = readProjectId(params);
      const project = repository.getProject(projectId);
      if (!project) {
        throw new GxserverDomainStateError("notFound", `Project ${projectId} does not exist.`);
      }
      return { project, sessions: repository.listSessions(projectId) };
    }
    case "/api/addProjectPath":
      return { project: repository.createProject(normalizeAddProjectPathParams(params)) };
    case "/api/createSession":
    case "/api/createAgentSession": {
      const createParams =
        endpointPath === "/api/createAgentSession"
          ? normalizeCreateAgentSessionParams(repository, params)
          : (params as unknown as GxserverCreateSessionParams);
      return {
        session: repository.createSession(createParams),
      };
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
      return {
        session: repository.updateSession({
          lastActiveAt: update.lastActiveAt,
          projectId: current.projectId,
          runtimeSettings: update.runtimeSettings,
          sessionId: current.sessionId,
        }),
      };
    }
    case "/api/updateSession":
    case "/api/attachSessionMetadata":
      return { session: repository.updateSession(params as unknown as GxserverUpdateSessionParams) };
    case "/api/listSessions":
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
      return endpointPath === "/api/wakeSession"
        ? { attach: normalizedAttach, session }
        : { attach: normalizedAttach };
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
      return { kill, session };
    }
    default:
      throw new GxserverDomainStateError("notFound", `${endpointPath} is not a gxserver zmx lifecycle endpoint.`);
  }
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
  const startupText = params.startupText ?? getAgentStartupTextForSession(project, probedSession);
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
    path === "/api/updateAgentActivity" ||
    path === "/api/updateSession" ||
    path === "/api/listSessions" ||
    path === "/api/readClientLayout" ||
    path === "/api/updateClientLayout"
  );
}

function isTypedOperationEndpoint(path: GxserverEndpointPath): boolean {
  return path === "/api/runGitAction" || path === "/api/runWorktreeAction" || path === "/api/runBeadsAction";
}

function isZmxLifecycleEndpoint(path: GxserverEndpointPath): boolean {
  return (
    path === "/api/attachSessionMetadata" ||
    path === "/api/probeSessionProvider" ||
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

function normalizeCreateAgentSessionParams(
  repository: GxserverDomainRepository,
  params: Record<string, unknown>,
): GxserverCreateSessionParams {
  const projectId = readProjectId(params);
  const project = repository.getProject(projectId);
  if (!project) {
    throw new GxserverDomainStateError("notFound", `Project ${projectId} does not exist.`);
  }
  return createAgentSessionParams(project, {
    ...(params as unknown as GxserverCreateSessionParams),
    kind: "agent",
    projectId,
  });
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
  if (!isAuthorizedGxserverRequest(request, runtime.authToken)) {
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
