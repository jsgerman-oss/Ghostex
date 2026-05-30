import { readFile } from "node:fs/promises";
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

export class GxserverLogQueryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GxserverLogQueryInputError";
  }
}

/*
CDXC:GxserverLogs 2026-05-30-16:58:
`/api/queryLogs` is a read-only API over `~/.ghostex/gxserver/logs/gxserver.jsonl`. Keep the parser tolerant of malformed historical lines, but validate query filters up front so future gx logs clients get deterministic filter, limit, and ordering behavior instead of local filesystem scraping.
*/
export async function queryGxserverLogs(
  paths: GxserverPaths,
  rawParams: unknown = {},
): Promise<GxserverQueryLogsResult> {
  const params = parseGxserverQueryLogsParams(rawParams);
  const read = await readGxserverLogEntries(paths.logFile);
  const filtered = read.entries.filter((entry) => matchesQuery(entry, params));
  const ordered = orderEntries(filtered, params.order ?? "asc");
  const entries = ordered.slice(0, params.limit ?? GXSERVER_DEFAULT_LOG_QUERY_LIMIT);
  return {
    entries,
    malformedLineCount: read.malformedLineCount,
    totalMatched: filtered.length,
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
