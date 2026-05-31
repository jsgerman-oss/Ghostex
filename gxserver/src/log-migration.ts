import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type {
  GxserverLogEntry,
  GxserverProjectId,
  GxserverServerId,
  GxserverSessionId,
} from "../protocol/index.js";
import type { GxserverLogInput, GxserverLogger } from "./logger.js";

export interface GxserverLegacyLogMigrationOptions {
  legacyLogsDir: string;
  logger: GxserverLogger;
  migratedAt?: string;
  serverId?: GxserverServerId;
}

export interface GxserverLegacyLogMigrationResult {
  filesRead: number;
  malformedLineCount: number;
  migratedLineCount: number;
}

interface LegacyLogSource {
  category: LegacyLogCategory;
  fileName: string;
}

export type LegacyLogCategory =
  | "agentActivity"
  | "agentDetection"
  | "api"
  | "beads"
  | "cli"
  | "debug"
  | "git"
  | "import"
  | "migration"
  | "mobile"
  | "restore"
  | "sessionTitle"
  | "sleep"
  | "wake"
  | "worktree"
  | "zmx";

const LEGACY_LOG_SOURCES: readonly LegacyLogSource[] = [
  { category: "sessionTitle", fileName: "session-title-sync-debug.log" },
  { category: "agentDetection", fileName: "agent-detection-debug.log" },
  { category: "restore", fileName: "workspace-restore-debug.log" },
  { category: "beads", fileName: "project-board-debug.log" },
  { category: "zmx", fileName: "native-terminal-focus-debug.log" },
  { category: "api", fileName: "native-host-lifecycle.log" },
] as const;

const MAX_LEGACY_LOG_MIGRATION_BYTES_PER_FILE = 16 * 1024 * 1024;
const MAX_LEGACY_LOG_LINE_CHARS = 200_000;

/*
CDXC:GxserverLogMigration 2026-05-30-17:02:
The first-launch migration bead will call this reusable importer instead of scraping logs ad hoc. Only backend/control-plane diagnostics move into gxserver JSONL; UI-only diagnostics such as modal, pane-layout, browser, and dock rendering repro files remain client-local unless a later product requirement makes them daemon-owned.
*/
export async function migrateLegacyGxserverLogs(
  options: GxserverLegacyLogMigrationOptions,
): Promise<GxserverLegacyLogMigrationResult> {
  const migratedAt = options.migratedAt ?? new Date().toISOString();
  const result: GxserverLegacyLogMigrationResult = {
    filesRead: 0,
    malformedLineCount: 0,
    migratedLineCount: 0,
  };

  await options.logger.log({
    event: "migration.importStarted",
    level: "info",
    serverId: options.serverId,
    source: "legacyLogMigration",
    ts: migratedAt,
  });

  for (const source of LEGACY_LOG_SOURCES) {
    const filePath = path.join(options.legacyLogsDir, source.fileName);
    const lineSource = await openLegacyLogLineSource(filePath);
    if (!lineSource) {
      continue;
    }
    result.filesRead += 1;
    if (lineSource.skippedByteCount > 0) {
      await options.logger.log({
        details: {
          fileName: source.fileName,
          skippedByteCount: lineSource.skippedByteCount,
        },
        event: "migration.importFileTail",
        level: "warn",
        serverId: options.serverId,
        source: "legacyLogMigration",
        ts: migratedAt,
      });
    }
    /*
    CDXC:GxserverLogMigration 2026-05-30-16:35:
    First launch must not fail or hang when legacy macOS debug files grew to hundreds of MB or GB before gxserver owned structured JSONL logs. Stream legacy files and migrate the newest bounded tail for oversized files; old source logs remain untouched, and gxserver records the skipped byte count so the partial import is explicit instead of pretending the full file was read.
    */
    for await (const rawLine of lineSource.lines) {
      const line = truncateLegacyLogLine(rawLine);
      if (!line.trim()) {
        continue;
      }
      const migrated = migrateLegacyLogLine({
        fileName: source.fileName,
        line,
        serverId: options.serverId,
        sourceCategory: source.category,
      });
      if (!migrated) {
        result.malformedLineCount += 1;
        continue;
      }
      await options.logger.log(migrated);
      result.migratedLineCount += 1;
    }
  }

  await options.logger.log({
    details: { ...result },
    event: "migration.importCompleted",
    level: "info",
    serverId: options.serverId,
    source: "legacyLogMigration",
    ts: migratedAt,
  });

  return result;
}

export function migrateLegacyLogLine(options: {
  fileName: string;
  line: string;
  serverId?: GxserverServerId;
  sourceCategory: LegacyLogCategory;
}): GxserverLogInput | undefined {
  const parsed = parseLegacyLine(options.line);
  if (!parsed) {
    return undefined;
  }
  const legacyEvent = extractLegacyEvent(parsed.message, parsed.payload) ?? "entry";
  const category = categorizeLegacyEvent(options.sourceCategory, legacyEvent);
  const details = extractLegacyDetails(parsed.message, parsed.payload, legacyEvent);
  return {
    client: "legacy",
    details,
    event: `legacy.${category}.${slugEventName(legacyEvent)}`,
    legacyFile: options.fileName,
    level: inferLegacyLogLevel(legacyEvent, parsed.message),
    projectId: extractProjectId(details),
    serverId: options.serverId,
    sessionId: extractSessionId(details),
    source: "legacyLogMigration",
    ts: parsed.ts,
  };
}

function parseLegacyLine(line: string): { message: string; payload?: Record<string, unknown>; ts: string } | undefined {
  const match = /^\[([^\]]+)]\s*(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  const [, rawTimestamp, message] = match;
  const timestampMs = Date.parse(rawTimestamp);
  if (Number.isNaN(timestampMs)) {
    return undefined;
  }
  const payload = parseTrailingJsonObject(message);
  return {
    message,
    ...(payload ? { payload } : {}),
    ts: new Date(timestampMs).toISOString(),
  };
}

function parseTrailingJsonObject(message: string): Record<string, unknown> | undefined {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function openLegacyLogLineSource(filePath: string): Promise<{ lines: AsyncIterable<string>; skippedByteCount: number } | undefined> {
  try {
    const fileStat = await stat(filePath);
    const skippedByteCount = Math.max(0, fileStat.size - MAX_LEGACY_LOG_MIGRATION_BYTES_PER_FILE);
    const stream = createReadStream(filePath, {
      encoding: "utf8",
      start: skippedByteCount,
    });
    const lines = createInterface({
      crlfDelay: Infinity,
      input: stream,
    });
    return {
      lines: skippedByteCount > 0 ? skipFirstPossiblyPartialLine(lines) : lines,
      skippedByteCount,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function* skipFirstPossiblyPartialLine(lines: AsyncIterable<string>): AsyncIterable<string> {
  let isFirst = true;
  for await (const line of lines) {
    if (isFirst) {
      isFirst = false;
      continue;
    }
    yield line;
  }
}

function truncateLegacyLogLine(line: string): string {
  if (line.length <= MAX_LEGACY_LOG_LINE_CHARS) {
    return line;
  }
  return `${line.slice(0, MAX_LEGACY_LOG_LINE_CHARS)}...[gxserverLegacyLogLineTruncated ${line.length - MAX_LEGACY_LOG_LINE_CHARS} chars]`;
}

function extractLegacyEvent(message: string, payload?: Record<string, unknown>): string | undefined {
  if (typeof payload?.event === "string" && payload.event.trim()) {
    return payload.event;
  }
  const firstToken = message.trim().split(/\s+/, 1)[0];
  return firstToken?.trim() || undefined;
}

function extractLegacyDetails(
  message: string,
  payload: Record<string, unknown> | undefined,
  legacyEvent: string,
): Record<string, unknown> {
  const textWithoutEvent = message.startsWith(legacyEvent) ? message.slice(legacyEvent.length).trim() : message;
  return {
    legacyDetails: payload ?? textWithoutEvent,
    legacyEvent,
  };
}

function categorizeLegacyEvent(defaultCategory: LegacyLogCategory, legacyEvent: string): LegacyLogCategory {
  const event = legacyEvent.toLowerCase();
  if (event.includes("migration")) {
    return "migration";
  }
  if (event.includes("import")) {
    return "import";
  }
  if (event.includes("mobile")) {
    return "mobile";
  }
  if (event.includes("cli")) {
    return "cli";
  }
  if (event.includes("api") || event.includes("bridge")) {
    return "api";
  }
  if (event.includes("worktree")) {
    return "worktree";
  }
  if (event.includes("git")) {
    return "git";
  }
  if (event.includes("bead") || event.includes("projectboard") || event.includes("project-board")) {
    return "beads";
  }
  if (event.includes("zmx") || event.includes("tmux") || event.includes("attach") || event.includes("kill")) {
    return "zmx";
  }
  if (event.includes("sleep")) {
    return "sleep";
  }
  if (event.includes("wake")) {
    return "wake";
  }
  if (event.includes("restore")) {
    return "restore";
  }
  if (event.includes("activity")) {
    return "agentActivity";
  }
  if (event.includes("agent")) {
    return "agentDetection";
  }
  if (event.includes("title") || event.includes("rename")) {
    return "sessionTitle";
  }
  return defaultCategory;
}

function inferLegacyLogLevel(legacyEvent: string, message: string): GxserverLogEntry["level"] {
  const text = `${legacyEvent} ${message}`.toLowerCase();
  if (text.includes("fail") || text.includes("error") || text.includes("crash")) {
    return "error";
  }
  if (text.includes("warn") || text.includes("missing") || text.includes("timeout") || text.includes("invalid")) {
    return "warn";
  }
  return "debug";
}

function slugEventName(legacyEvent: string): string {
  const slug = legacyEvent
    .trim()
    .replace(/[^A-Za-z0-9.]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.|\.$/g, "");
  return slug || "entry";
}

function extractProjectId(details: Record<string, unknown>): GxserverProjectId | undefined {
  const value = extractString(details, "projectId");
  return value && /^P\d[a-z0-9]{3}$/.test(value) ? (value as GxserverProjectId) : undefined;
}

function extractSessionId(details: Record<string, unknown>): GxserverSessionId | undefined {
  const value = extractString(details, "sessionId");
  return value && /^G\d[a-z0-9]{3}$/.test(value) ? (value as GxserverSessionId) : undefined;
}

function extractString(details: Record<string, unknown>, field: string): string | undefined {
  const legacyDetails = details.legacyDetails;
  if (isRecord(legacyDetails) && typeof legacyDetails[field] === "string") {
    return legacyDetails[field];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
