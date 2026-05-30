import { readFile, stat, open } from "node:fs/promises";
import type {
  GxserverLogEntry,
  GxserverLogLevel,
  GxserverLogOrder,
  GxserverQueryLogsParams,
  GxserverQueryLogsResult,
} from "../protocol/index.js";
import type { GxserverPaths } from "./paths.js";

export const GXSERVER_DEFAULT_LOG_QUERY_LIMIT = 200;
export const GXSERVER_MAX_LOG_QUERY_LIMIT = 5_000;
export const GXSERVER_LOG_QUERY_FULL_SCAN_MAX_BYTES = 8 * 1024 * 1024;
export const GXSERVER_LOG_QUERY_WINDOW_BASE_BYTES = 2 * 1024 * 1024;
export const GXSERVER_LOG_QUERY_MAX_WINDOW_BYTES = 16 * 1024 * 1024;
export const GXSERVER_LOG_QUERY_ESTIMATED_BYTES_PER_ENTRY = 1024;

export class GxserverLogQueryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GxserverLogQueryInputError";
  }
}

/*
CDXC:GxserverLogs 2026-05-30-16:58:
`/api/queryLogs` is a read-only API over `~/.ghostex/gxserver/logs/gxserver.jsonl`. Keep the parser tolerant of malformed historical lines, but validate query filters up front so future gx logs clients get deterministic filter, limit, and ordering behavior instead of local filesystem scraping.

CDXC:GxserverLogs 2026-05-30-20:09:
Large gxserver JSONL files must not be loaded, filtered, and sorted as one unbounded string for common recent/tail log queries. Exact scans are limited to small files; larger files read a bounded head or tail window sized from the requested limit, and the result metadata reports when total and malformed counts only describe the scanned window.
*/
export async function queryGxserverLogs(
  paths: GxserverPaths,
  rawParams: unknown = {},
): Promise<GxserverQueryLogsResult> {
  const params = parseGxserverQueryLogsParams(rawParams);
  const limit = params.limit ?? GXSERVER_DEFAULT_LOG_QUERY_LIMIT;
  const order = params.order ?? "asc";
  const fileSizeBytes = await readLogFileSize(paths.logFile);
  if (fileSizeBytes === undefined) {
    return {
      entries: [],
      logFileSizeBytes: 0,
      malformedLineCount: 0,
      malformedLineCountIsExact: true,
      scannedBytes: 0,
      scannedLineCount: 0,
      totalMatched: 0,
      totalMatchedIsExact: true,
      truncated: false,
    };
  }

  const read =
    fileSizeBytes <= GXSERVER_LOG_QUERY_FULL_SCAN_MAX_BYTES
      ? await readCompleteGxserverLogEntries(paths.logFile, params, fileSizeBytes)
      : await readBoundedGxserverLogEntries(paths.logFile, params, fileSizeBytes, limit, order);
  const ordered = orderEntries(read.entries, order);
  const entries = ordered.slice(0, limit);
  return {
    entries,
    logFileSizeBytes: fileSizeBytes,
    malformedLineCount: read.malformedLineCount,
    malformedLineCountIsExact: read.complete,
    scannedBytes: read.scannedBytes,
    scannedLineCount: read.scannedLineCount,
    totalMatched: read.entries.length,
    totalMatchedIsExact: read.complete,
    truncated: !read.complete,
    ...(!read.complete ? { truncatedReason: "fileWindowExceeded" as const } : {}),
  };
}

export function parseGxserverQueryLogsParams(rawParams: unknown): GxserverQueryLogsParams {
  if (!isRecord(rawParams)) {
    throw new GxserverLogQueryInputError("queryLogs params must be an object.");
  }

  const level = parseLevelFilter(rawParams.level);
  const event = parseOptionalString(rawParams.event, "event");
  const eventPrefix = parseOptionalString(rawParams.eventPrefix, "eventPrefix");
  const serverId = parseOptionalString(rawParams.serverId, "serverId");
  const projectId = parseOptionalString(rawParams.projectId, "projectId");
  const sessionId = parseOptionalString(rawParams.sessionId, "sessionId");
  const client = parseOptionalString(rawParams.client, "client");
  const since = parseOptionalTimestamp(rawParams.since, "since");
  const until = parseOptionalTimestamp(rawParams.until, "until");
  const limit = parseOptionalLimit(rawParams.limit);
  const order = parseOrder(rawParams.order);
  const reverse = parseOptionalBoolean(rawParams.reverse, "reverse");
  const resolvedOrder = resolveOrder(order, reverse);

  return {
    ...(client ? { client } : {}),
    ...(event ? { event } : {}),
    ...(eventPrefix ? { eventPrefix } : {}),
    ...(level ? { level } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(resolvedOrder ? { order: resolvedOrder } : {}),
    ...(projectId ? { projectId: projectId as GxserverQueryLogsParams["projectId"] } : {}),
    ...(reverse !== undefined ? { reverse } : {}),
    ...(serverId ? { serverId: serverId as GxserverQueryLogsParams["serverId"] } : {}),
    ...(sessionId ? { sessionId: sessionId as GxserverQueryLogsParams["sessionId"] } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  };
}

export async function readGxserverLogEntries(logFile: string): Promise<{
  entries: GxserverLogEntry[];
  malformedLineCount: number;
}> {
  let text: string;
  try {
    text = await readFile(logFile, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { entries: [], malformedLineCount: 0 };
    }
    throw error;
  }

  const entries: GxserverLogEntry[] = [];
  let malformedLineCount = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parsed = parseLogLine(line);
    if (parsed) {
      entries.push(parsed);
    } else {
      malformedLineCount += 1;
    }
  }
  return { entries, malformedLineCount };
}

async function readLogFileSize(logFile: string): Promise<number | undefined> {
  try {
    return (await stat(logFile)).size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readCompleteGxserverLogEntries(
  logFile: string,
  params: GxserverQueryLogsParams,
  fileSizeBytes: number,
): Promise<GxserverLogQueryRead> {
  const text = await readFile(logFile, "utf8");
  const scanned = scanLogLines(text.split(/\r?\n/), params);
  return {
    ...scanned,
    complete: true,
    scannedBytes: fileSizeBytes,
  };
}

async function readBoundedGxserverLogEntries(
  logFile: string,
  params: GxserverQueryLogsParams,
  fileSizeBytes: number,
  limit: number,
  order: GxserverLogOrder,
): Promise<GxserverLogQueryRead> {
  const windowBytes = Math.min(fileSizeBytes, logQueryWindowBytes(limit));
  const text =
    order === "desc" || params.since
      ? await readLogTextWindow(logFile, fileSizeBytes - windowBytes, windowBytes, fileSizeBytes, "tail")
      : await readLogTextWindow(logFile, 0, windowBytes, fileSizeBytes, "head");
  const scanned = scanLogLines(text.split(/\r?\n/), params);
  return {
    ...scanned,
    complete: windowBytes >= fileSizeBytes,
    scannedBytes: windowBytes,
  };
}

function logQueryWindowBytes(limit: number): number {
  return Math.min(
    GXSERVER_LOG_QUERY_MAX_WINDOW_BYTES,
    Math.max(GXSERVER_LOG_QUERY_WINDOW_BASE_BYTES, limit * GXSERVER_LOG_QUERY_ESTIMATED_BYTES_PER_ENTRY),
  );
}

async function readLogTextWindow(
  logFile: string,
  startOffset: number,
  byteLength: number,
  fileSizeBytes: number,
  mode: "head" | "tail",
): Promise<string> {
  const file = await open(logFile, "r");
  try {
    const buffer = Buffer.allocUnsafe(byteLength);
    const read = await file.read(buffer, 0, byteLength, startOffset);
    let text = buffer.subarray(0, read.bytesRead).toString("utf8");
    if (mode === "tail" && startOffset > 0) {
      const firstLineBreak = text.indexOf("\n");
      text = firstLineBreak === -1 ? "" : text.slice(firstLineBreak + 1);
    }
    if (mode === "head" && startOffset + read.bytesRead >= fileSizeBytes) {
      return text;
    }
    if (mode === "head") {
      const lastLineBreak = text.lastIndexOf("\n");
      text = lastLineBreak === -1 ? "" : text.slice(0, lastLineBreak + 1);
    }
    return text;
  } finally {
    await file.close();
  }
}

function scanLogLines(lines: readonly string[], params: GxserverQueryLogsParams): GxserverLogLineScan {
  const entries: GxserverLogEntry[] = [];
  let malformedLineCount = 0;
  let scannedLineCount = 0;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    scannedLineCount += 1;
    const parsed = parseLogLine(line);
    if (parsed) {
      if (matchesQuery(parsed, params)) {
        entries.push(parsed);
      }
    } else {
      malformedLineCount += 1;
    }
  }
  return { entries, malformedLineCount, scannedLineCount };
}

interface GxserverLogLineScan {
  entries: GxserverLogEntry[];
  malformedLineCount: number;
  scannedLineCount: number;
}

interface GxserverLogQueryRead extends GxserverLogLineScan {
  complete: boolean;
  scannedBytes: number;
}

function parseLogLine(line: string): GxserverLogEntry | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isGxserverLogEntry(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function matchesQuery(entry: GxserverLogEntry, params: GxserverQueryLogsParams): boolean {
  if (params.level) {
    const levels = Array.isArray(params.level) ? params.level : [params.level];
    if (!levels.includes(entry.level)) {
      return false;
    }
  }
  if (params.event && entry.event !== params.event) {
    return false;
  }
  if (params.eventPrefix && !entry.event.startsWith(params.eventPrefix)) {
    return false;
  }
  if (params.serverId && entry.serverId !== params.serverId) {
    return false;
  }
  if (params.projectId && entry.projectId !== params.projectId) {
    return false;
  }
  if (params.sessionId && entry.sessionId !== params.sessionId) {
    return false;
  }
  if (params.client && entry.client !== params.client) {
    return false;
  }
  if (params.since || params.until) {
    const timestampMs = Date.parse(entry.ts);
    if (Number.isNaN(timestampMs)) {
      return false;
    }
    if (params.since && timestampMs < Date.parse(params.since)) {
      return false;
    }
    if (params.until && timestampMs > Date.parse(params.until)) {
      return false;
    }
  }
  return true;
}

function orderEntries(entries: readonly GxserverLogEntry[], order: GxserverLogOrder): GxserverLogEntry[] {
  const direction = order === "desc" ? -1 : 1;
  return [...entries].sort((left, right) => {
    const leftMs = Date.parse(left.ts);
    const rightMs = Date.parse(right.ts);
    if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
      return direction * left.ts.localeCompare(right.ts);
    }
    return direction * (leftMs - rightMs);
  });
}

function parseLevelFilter(value: unknown): GxserverLogLevel | readonly GxserverLogLevel[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return parseLevel(value);
  }
  if (Array.isArray(value) && value.length > 0) {
    return value.map((item) => parseLevel(item));
  }
  throw new GxserverLogQueryInputError("level must be a log level or a non-empty log level array.");
}

function parseLevel(value: unknown): GxserverLogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  throw new GxserverLogQueryInputError("level must be one of debug, info, warn, or error.");
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new GxserverLogQueryInputError(`${field} must be a non-empty string.`);
  }
  return value;
}

function parseOptionalTimestamp(value: unknown, field: string): string | undefined {
  const timestamp = parseOptionalString(value, field);
  if (!timestamp) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new GxserverLogQueryInputError(`${field} must be a parseable timestamp.`);
  }
  return timestamp;
}

function parseOptionalLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > GXSERVER_MAX_LOG_QUERY_LIMIT
  ) {
    throw new GxserverLogQueryInputError(`limit must be an integer from 1 to ${GXSERVER_MAX_LOG_QUERY_LIMIT}.`);
  }
  return value;
}

function parseOrder(value: unknown): GxserverLogOrder | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "asc" || value === "desc") {
    return value;
  }
  throw new GxserverLogQueryInputError("order must be asc or desc.");
}

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new GxserverLogQueryInputError(`${field} must be a boolean.`);
  }
  return value;
}

function resolveOrder(order: GxserverLogOrder | undefined, reverse: boolean | undefined): GxserverLogOrder | undefined {
  if (order && reverse !== undefined) {
    const reverseOrder = reverse ? "desc" : "asc";
    if (order !== reverseOrder) {
      throw new GxserverLogQueryInputError("order and reverse specify conflicting log order.");
    }
  }
  if (order) {
    return order;
  }
  if (reverse !== undefined) {
    return reverse ? "desc" : "asc";
  }
  return undefined;
}

function isGxserverLogEntry(value: unknown): value is GxserverLogEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.ts === "string" &&
    typeof value.event === "string" &&
    (value.level === "debug" || value.level === "info" || value.level === "warn" || value.level === "error")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
