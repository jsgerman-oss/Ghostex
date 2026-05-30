import { appendFile, mkdir } from "node:fs/promises";
import type { GxserverLogEntry, GxserverLogLevel } from "../protocol/index.js";
import type { GxserverPaths } from "./paths.js";

export interface GxserverLogger {
  log(entry: GxserverLogInput): Promise<void>;
}

export type GxserverLogInput = Omit<GxserverLogEntry, "error" | "ts"> & {
  error?: string | Error;
  ts?: string;
};

/*
CDXC:GxserverLogs 2026-05-30-14:16:
gxserver writes structured JSONL to `~/.ghostex/gxserver/logs/gxserver.jsonl` with camelCase fields. This is the foundation for later log query/migration APIs, so every line must be independently parseable JSON and include stable request/session/project identity fields when available.
*/
export function createGxserverLogger(paths: GxserverPaths): GxserverLogger {
  return {
    async log(entry: GxserverLogInput): Promise<void> {
      await mkdir(paths.logsDir, { recursive: true });
      const line = JSON.stringify(normalizeLogEntry(entry));
      await appendFile(paths.logFile, `${line}\n`, "utf8");
    },
  };
}

export function normalizeLogEntry(entry: GxserverLogInput): GxserverLogEntry {
  return {
    ts: entry.ts ?? new Date().toISOString(),
    level: entry.level,
    event: entry.event,
    ...(entry.serverId ? { serverId: entry.serverId } : {}),
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.projectId ? { projectId: entry.projectId } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.client ? { client: entry.client } : {}),
    ...(typeof entry.durationMs === "number" ? { durationMs: entry.durationMs } : {}),
    ...(entry.error ? { error: normalizeError(entry.error) } : {}),
    ...(entry.details ? { details: entry.details } : {}),
    ...(entry.legacyFile ? { legacyFile: entry.legacyFile } : {}),
    ...(entry.message ? { message: entry.message } : {}),
    ...(entry.source ? { source: entry.source } : {}),
  };
}

export function logLevelFromStatus(statusCode: number): GxserverLogLevel {
  if (statusCode >= 500) {
    return "error";
  }
  if (statusCode >= 400) {
    return "warn";
  }
  return "info";
}

function normalizeError(error: string | Error): string {
  return error instanceof Error ? error.message : error;
}
