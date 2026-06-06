import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_LOCAL_API_PORT,
  GXSERVER_PROTOCOL_VERSION,
  type GxserverAuthToken,
  type GxserverRuntimeMetadata,
  type GxserverSessionDomainState,
} from "../protocol/index.js";
import type { GxserverLogger } from "./logger.js";
import type { GxserverResolvedTool } from "./toolchain.js";
import { providerZmxSessionName } from "./zmx-lifecycle.js";

interface GxserverZmxTitleObserverOptions {
  authToken: GxserverAuthToken;
  logger: GxserverLogger;
  metadata: GxserverRuntimeMetadata;
  requireZmx: () => Promise<GxserverResolvedTool>;
}

interface ZmxTitleObserverProcess {
  child: ChildProcessByStdio<null, Readable, Readable>;
  projectId: GxserverSessionDomainState["projectId"];
  sessionId: GxserverSessionDomainState["sessionId"];
  stderr: string;
  stdout: string;
  zmxName: string;
}

/*
CDXC:ZmxTitleObservations 2026-06-01-10:17:
zmx is the shared PTY owner for managed terminal sessions, so gxserver should consume coalesced zmx title observations instead of relying on per-client native title snapshots. The observer process feeds zmx's settled title stream back through the existing authenticated title-ingest API, keeping persistence/status rules centralized in gxserver.

CDXC:ZmxTitleObservations 2026-06-06-23:21:
Persistent zmx observer diagnostics must not include title previews, raw zmx output, response text, or stderr content. Use lengths, status codes, IDs, and booleans so Debugging Mode can diagnose watcher behavior without writing user-owned terminal titles or command output to support-bundle logs.
*/
export class GxserverZmxTitleObserver {
  #closed = false;
  readonly #options: GxserverZmxTitleObserverOptions;
  readonly #processes = new Map<string, ZmxTitleObserverProcess>();

  constructor(options: GxserverZmxTitleObserverOptions) {
    this.#options = options;
  }

  async syncSessions(sessions: readonly GxserverSessionDomainState[], reason: string): Promise<void> {
    const desiredKeys = new Set<string>();
    for (const session of sessions) {
      if (!isZmxTitleObservableSession(session)) {
        continue;
      }
      desiredKeys.add(sessionKey(session));
      await this.observeSession(session, reason);
    }
    for (const [key, process] of this.#processes) {
      if (!desiredKeys.has(key)) {
        this.#stopProcess(key, process, "session-no-longer-observable");
      }
    }
  }

  async observeSession(session: GxserverSessionDomainState, reason: string): Promise<void> {
    if (this.#closed || !isZmxTitleObservableSession(session)) {
      return;
    }
    const key = sessionKey(session);
    const existing = this.#processes.get(key);
    if (existing && !existing.child.killed && existing.child.exitCode === null) {
      return;
    }

    const zmxName = providerZmxSessionName(session);
    const zmx = await this.#options.requireZmx();
    const child = spawn(zmx.executablePath, ["watch-title", zmxName], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const process: ZmxTitleObserverProcess = {
      child,
      projectId: session.projectId,
      sessionId: session.sessionId,
      stderr: "",
      stdout: "",
      zmxName,
    };
    this.#processes.set(key, process);

    await this.#options.logger.log({
      details: { reason, zmxName },
      event: "zmxTitleObserver.started",
      level: "debug",
      projectId: session.projectId,
      serverId: this.#options.metadata.serverId,
      sessionId: session.sessionId,
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.#handleStdout(key, process, String(chunk));
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      process.stderr = trimBufferedText(`${process.stderr}${String(chunk)}`);
    });
    child.on("error", (error) => {
      void this.#options.logger.log({
        details: { message: error.message, zmxName },
        event: "zmxTitleObserver.error",
        level: "warn",
        projectId: session.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: session.sessionId,
      });
    });
    child.on("exit", (code, signal) => {
      if (this.#processes.get(key)?.child === child) {
        this.#processes.delete(key);
      }
      void this.#options.logger.log({
        details: {
          code,
          signal,
          stderrLength: process.stderr.length,
          zmxName,
        },
        event: this.#closed ? "zmxTitleObserver.stopped" : "zmxTitleObserver.exited",
        level: this.#closed || code === 0 ? "debug" : "warn",
        projectId: session.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: session.sessionId,
      });
    });
  }

  close(): void {
    this.#closed = true;
    for (const [key, process] of this.#processes) {
      this.#stopProcess(key, process, "server-shutdown");
    }
  }

  #stopProcess(key: string, process: ZmxTitleObserverProcess, reason: string): void {
    this.#processes.delete(key);
    if (!process.child.killed && process.child.exitCode === null) {
      process.child.kill("SIGTERM");
    }
    void this.#options.logger.log({
      details: { reason, zmxName: process.zmxName },
      event: "zmxTitleObserver.stopRequested",
      level: "debug",
      projectId: process.projectId,
      serverId: this.#options.metadata.serverId,
      sessionId: process.sessionId,
    });
  }

  #handleStdout(key: string, process: ZmxTitleObserverProcess, chunk: string): void {
    process.stdout = trimBufferedText(`${process.stdout}${chunk}`);
    let newlineIndex = process.stdout.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = process.stdout.slice(0, newlineIndex).trim();
      process.stdout = process.stdout.slice(newlineIndex + 1);
      if (line) {
        void this.#ingestLine(key, process, line);
      }
      newlineIndex = process.stdout.indexOf("\n");
    }
  }

  async #ingestLine(key: string, process: ZmxTitleObserverProcess, line: string): Promise<void> {
    const title = parseZmxTitleLine(line);
    if (!title) {
      await this.#options.logger.log({
        details: { lineLength: line.length, zmxName: process.zmxName },
        event: "zmxTitleObserver.invalidLine",
        level: "debug",
        projectId: process.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: process.sessionId,
      });
      return;
    }
    try {
      const response = await fetch(`http://${GXSERVER_LOCAL_API_HOST}:${GXSERVER_LOCAL_API_PORT}/api/ingestTerminalTitleEvent`, {
        body: JSON.stringify({
          params: {
            projectId: process.projectId,
            rawTitle: title,
            sessionId: process.sessionId,
            sessionPersistenceProvider: "zmx",
          },
          protocolVersion: GXSERVER_PROTOCOL_VERSION,
        }),
        headers: {
          authorization: `Bearer ${this.#options.authToken}`,
          "content-type": "application/json",
          "x-gxserver-protocol-version": String(GXSERVER_PROTOCOL_VERSION),
        },
        method: "POST",
      });
      if (!response.ok) {
        const responseText = await response.text();
        await this.#options.logger.log({
          details: {
            responseStatus: response.status,
            responseTextLength: responseText.length,
            zmxName: process.zmxName,
          },
          event: "zmxTitleObserver.ingestFailed",
          level: "warn",
          projectId: process.projectId,
          serverId: this.#options.metadata.serverId,
          sessionId: process.sessionId,
        });
        return;
      }
      await this.#options.logger.log({
        details: {
          key,
          titleLength: title.length,
          zmxName: process.zmxName,
        },
        event: "zmxTitleObserver.ingested",
        level: "debug",
        projectId: process.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: process.sessionId,
      });
    } catch (error) {
      await this.#options.logger.log({
        details: { message: error instanceof Error ? error.message : String(error), zmxName: process.zmxName },
        event: "zmxTitleObserver.ingestError",
        level: "warn",
        projectId: process.projectId,
        serverId: this.#options.metadata.serverId,
        sessionId: process.sessionId,
      });
    }
  }
}

function parseZmxTitleLine(line: string): string | undefined {
  try {
    const parsed = JSON.parse(line) as { title?: unknown };
    return typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : undefined;
  } catch {
    return undefined;
  }
}

function isZmxTitleObservableSession(session: GxserverSessionDomainState): boolean {
  return (
    (session.kind === "terminal" || session.kind === "agent") &&
    session.lifecycleState === "running" &&
    Boolean(providerZmxSessionName(session))
  );
}

function sessionKey(session: Pick<GxserverSessionDomainState, "projectId" | "sessionId">): string {
  return `${session.projectId}/${session.sessionId}`;
}

function trimBufferedText(value: string): string {
  return value.length > 16_384 ? value.slice(-16_384) : value;
}
