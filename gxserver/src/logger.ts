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

const REDACTED_TEXT = "[redacted]";
const REDACTED_PATH = "[redacted:path]";
const REDACTED_URL = "[redacted:url]";
const REDACTED_SECRET = "[redacted:secret]";

/*
CDXC:GxserverLogs 2026-05-30-14:16:
gxserver writes structured JSONL to `~/.ghostex/gxserver/logs/gxserver.jsonl` with camelCase fields. This is the foundation for later log query/migration APIs, so every line must be independently parseable JSON and include stable request/session/project identity fields when available.

CDXC:GxserverLogs 2026-05-30-23:52:
Users must be able to zip and share gxserver logs without leaking project/session names, filesystem paths, prompt text, command text, URLs with private query strings, or credentials. Sanitize every optional message/error/details field and legacy-derived string field at the JSONL boundary so future call sites cannot bypass the ID-first logging contract.
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
    event: sanitizeLogText(entry.event),
    ...(entry.serverId ? { serverId: entry.serverId } : {}),
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.projectId ? { projectId: entry.projectId } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.client ? { client: entry.client } : {}),
    ...(typeof entry.durationMs === "number" ? { durationMs: entry.durationMs } : {}),
    ...(entry.error ? { error: sanitizeLogText(normalizeError(entry.error)) } : {}),
    ...(entry.details ? { details: sanitizeLogDetails(entry.details) } : {}),
    ...(entry.legacyFile ? { legacyFile: sanitizeLogText(entry.legacyFile) } : {}),
    ...(entry.message ? { message: sanitizeLogText(entry.message) } : {}),
    ...(entry.source ? { source: sanitizeLogText(entry.source) } : {}),
  };
}

export function sanitizeLogDetails(details: Record<string, unknown>): Record<string, unknown> {
  return sanitizeLogRecord(details);
}

export function sanitizeLogText(value: string): string {
  return redactSensitiveText(value);
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

function sanitizeLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    sanitized[key] = sanitizeLogValue(key, value);
  }
  return sanitized;
}

function sanitizeLogValue(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase();
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeStringField(normalizedKey, value);
  }
  if (Array.isArray(value)) {
    if (isSensitiveCollectionKey(normalizedKey)) {
      return { count: value.length, redacted: true };
    }
    return value.map((item) => sanitizeLogValue(key, item));
  }
  if (isRecord(value)) {
    if (isSensitiveCollectionKey(normalizedKey)) {
      return { redacted: true };
    }
    return sanitizeLogRecord(value);
  }
  return String(value);
}

function sanitizeStringField(normalizedKey: string, value: string): unknown {
  if (isSecretKey(normalizedKey)) {
    return REDACTED_SECRET;
  }
  if (isIdentifierKey(normalizedKey) && isSafeIdentifier(value)) {
    return value;
  }
  if (isUrlKey(normalizedKey) || looksLikeUrl(value)) {
    return summarizeUrl(value);
  }
  if (isPathKey(normalizedKey) || looksLikePath(value)) {
    return REDACTED_PATH;
  }
  if (isSensitiveTextKey(normalizedKey)) {
    return REDACTED_TEXT;
  }
  return redactSensitiveText(value);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /"(title|name|projectName|sessionName|cwd|path|projectPath|workspaceRoot|worktreePath|url|input|comment|description|command|text|message|details|token|authToken|bearer|credential|password|secret)"\s*:\s*"[^"]*"/giu,
      (_match, key: string) => `"${key}":"${redactionForKey(key.toLowerCase())}"`,
    )
    .replace(/\b(?:bearer|token|authorization|password|secret|credential)=?[^\s"']+/giu, `${REDACTED_SECRET}`)
    .replace(/https?:\/\/[^\s"')]+/giu, REDACTED_URL)
    .replace(/(?:~|\/Users\/[^/\s"']+|\/(?:private\/)?tmp|\/var\/folders|\/Volumes)\/[^\s"']+/gu, REDACTED_PATH);
}

function redactionForKey(key: string): string {
  if (isSecretKey(key)) {
    return REDACTED_SECRET;
  }
  if (isUrlKey(key)) {
    return REDACTED_URL;
  }
  if (isPathKey(key)) {
    return REDACTED_PATH;
  }
  return REDACTED_TEXT;
}

function summarizeUrl(value: string): Record<string, unknown> {
  try {
    const url = new URL(value);
    return {
      host: url.host,
      protocol: url.protocol.replace(/:$/u, ""),
      redacted: true,
      type: "url",
    };
  } catch {
    return { redacted: true, type: "url" };
  }
}

function isIdentifierKey(key: string): boolean {
  return key === "id" || key.endsWith("id") || key.endsWith("ids") || key.endsWith("ref") || key.endsWith("refs");
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function isSecretKey(key: string): boolean {
  return /token|bearer|secret|credential|password|cookie|authorization|auth/.test(key);
}

function isUrlKey(key: string): boolean {
  return key === "url" || key.endsWith("url") || key.includes("uri") || key === "href" || key === "origin";
}

function isPathKey(key: string): boolean {
  return (
    key === "path" ||
    key === "cwd" ||
    key.endsWith("path") ||
    key.endsWith("dir") ||
    key.endsWith("directory") ||
    key.endsWith("root") ||
    key.endsWith("file") ||
    key.endsWith("filename") ||
    key.includes("workspace")
  );
}

function isSensitiveTextKey(key: string): boolean {
  return (
    key === "title" ||
    key.endsWith("title") ||
    key === "name" ||
    key.endsWith("name") ||
    key === "message" ||
    key === "details" ||
    key.endsWith("details") ||
    key === "input" ||
    key === "text" ||
    key.endsWith("text") ||
    key === "comment" ||
    key === "description" ||
    key === "label" ||
    key === "command" ||
    key.endsWith("command") ||
    key === "stdout" ||
    key === "stderr" ||
    key === "body" ||
    key.endsWith("body")
  );
}

function isSensitiveCollectionKey(key: string): boolean {
  return key === "args" || key.endsWith("args") || key === "arguments" || key.endsWith("arguments");
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

function looksLikePath(value: string): boolean {
  return /^(?:~\/|\/Users\/|\/Volumes\/|\/private\/|\/tmp\/|\/var\/folders\/)/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
