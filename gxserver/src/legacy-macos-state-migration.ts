import Database from "better-sqlite3";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import {
  createGlobalSessionRef,
  createUniqueProjectId,
  createUniqueSessionId,
  createZmxSessionName,
  isGxserverProjectId,
  isGxserverSessionId,
  type GxserverCandidateFactory,
} from "./ids.js";
import { migrateLegacyGxserverLogs } from "./log-migration.js";
import type { GxserverLogger } from "./logger.js";
import { openGxserverDatabase } from "./storage.js";
import type { GxserverPaths } from "./paths.js";
import type {
  GxserverMigrationStatus,
  GxserverProjectId,
  GxserverServerId,
  GxserverSessionId,
  GxserverStateImportStatus,
} from "../protocol/index.js";

export const LEGACY_MACOS_STATE_IMPORT_ID = "legacy_macos_sidebar_state_v1";

const LEGACY_IMPORT_METADATA_KEY = `migration.${LEGACY_MACOS_STATE_IMPORT_ID}`;
const SHARED_PROJECTS_FILE = "native-sidebar-projects.json";
const SHARED_PREVIOUS_SESSIONS_FILE = "native-sidebar-previous-sessions.json";
const SHARED_SETTINGS_FILE = "native-sidebar-settings.json";
const LEGACY_SHARED_BACKUP_SUFFIX = ".legacy-before-gxserver";
const MAX_MIGRATED_JSON_CHARS = 1_000_000;
const MAX_MIGRATED_STRING_CHARS = 100_000;
const MAX_MIGRATED_ARRAY_ITEMS = 1_000;
const MAX_MIGRATED_OBJECT_KEYS = 1_000;
const MAX_MIGRATED_JSON_DEPTH = 10;
const PROJECT_SNAPSHOT_PROJECT_SCORE = 10_000_000;
const PROJECT_SNAPSHOT_SESSION_SCORE = 1_000_000;
const PROJECT_SNAPSHOT_BYTE_TIEBREAKER_LIMIT = 100_000;
const PROJECT_ID_FIELDS = new Set(["activeProjectId", "parentProjectId", "projectId"]);
const SESSION_ID_FIELDS = new Set([
  "activeSessionId",
  "focusedSessionId",
  "ghostexSessionId",
  "poppedOutSessionIds",
  "relatedSessionIds",
  "restoredFromSessionId",
  "sessionId",
  "sessionIds",
  "visibleSessionIds",
]);
const COMBINED_PROJECT_SESSION_ID_PREFIX = "combined-session:";
const COMBINED_ID_SEPARATOR = ":";

const LEGACY_STORAGE_KEYS = {
  agentOrder: "ghostex-native-agent-order",
  agents: "ghostex-native-agents",
  activeSessionsSortMode: "ghostex-native-active-sessions-sort-mode",
  gitConfirmCommit: "ghostex-native-git-confirm-commit",
  gitGenerateCommitBody: "ghostex-native-git-generate-commit-body",
  gitPrimaryAction: "ghostex-native-git-primary-action",
  previousSessions: "ghostex-native-previous-sessions",
  projectCommands: "ghostex-native-project-commands",
  projects: "ghostex-native-projects",
  settings: "ghostex-native-settings",
} as const;

type JsonObject = Record<string, unknown>;
type JsonArray = JsonObject[];

export interface GxserverLegacyMacosStateMigrationOptions {
  createProjectId?: GxserverCandidateFactory<GxserverProjectId>;
  createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
  legacyLogsDir?: string;
  legacyLocalStorageRoot?: string;
  legacyStorageValues?: Readonly<Record<string, string | undefined>>;
  logger: GxserverLogger;
  now?: () => string;
  paths: GxserverPaths;
  serverId: GxserverServerId;
  sharedStateDir?: string;
}

export interface GxserverLegacyMacosStateMigrationResult {
  status: GxserverStateImportStatus;
}

interface LegacyStateSnapshot {
  agentOrder: readonly string[];
  agents: JsonArray;
  activeProjectId?: string;
  gitConfig: JsonObject;
  previousSessions: JsonArray;
  projectCommandsByLegacyId: Record<string, LegacyProjectCommands>;
  projects: JsonArray;
  settings: JsonObject;
  sourceFilesRead: readonly string[];
}

interface LegacyStoragePayload {
  payloadJson: string;
  parsed: unknown;
}

interface LegacyLocalStorageCandidate {
  databasePath: string;
  modifiedAtMs: number;
  value: string;
}

interface LegacyProjectCommands {
  commands: JsonArray;
  deletedDefaultCommandIds: readonly string[];
  order: readonly string[];
}

interface LegacySnapshotImportResult {
  projectIdByLegacyProjectId: Record<string, GxserverProjectId>;
  projectsImported: number;
  sessionIdByLegacyProjectId: Record<string, Record<string, GxserverSessionId>>;
  sessionsImported: number;
}

interface LegacyIdRemapContext {
  preserveHiddenRestoreMetadata?: boolean;
  projectIdByLegacyProjectId: Record<string, GxserverProjectId>;
  sessionIdByLegacyProjectId?: Record<string, Record<string, GxserverSessionId>>;
  sessionIdByLegacySessionId: Record<string, GxserverSessionId>;
}

/*
CDXC:GxserverMigration 2026-05-30-15:02:
First launch after the gxserver hard cutover imports the macOS sidebar's shared workflow state into `state.db` exactly once. Legacy files and WKWebView localStorage remain untouched for rollback/manual inspection; gxserver records completion in SQLite metadata and derives new P/G IDs plus zmx names instead of reusing legacy sidebar IDs as daemon identity.

CDXC:GxserverMigration 2026-05-30-17:27:
The same first-launch import must also rewrite the active shared sidebar snapshot to the canonical gxserver P/G IDs while copying the pre-cutover JSON beside it. Otherwise the macOS React client reloads old `project-*`/`g-*` identities after gxserver has imported P/G rows, then every zmx attach fails before it can reach the migrated session record.

CDXC:GxserverMigration 2026-05-30-17:27:
If a pre-release build already marked the import completed before rewriting the shared sidebar snapshot, later launches may repair only that client snapshot from the SQLite legacy-id metadata. This must not re-import rows or regenerate IDs; it only replaces stale references in the shared macOS client state.

CDXC:GxserverMigration 2026-05-30-17:41:
A broken pre-release app could create more legacy `g-*` sidebar sessions after the DB import marker was written. The completed-import repair may import only those unmapped terminal sessions into the existing P project with new G IDs before rewriting the client snapshot; already-mapped rows are never duplicated or regenerated.
*/
export async function migrateLegacyMacosStateIntoGxserver(
  options: GxserverLegacyMacosStateMigrationOptions,
): Promise<GxserverLegacyMacosStateMigrationResult> {
  const db = openGxserverDatabase(options.paths);
  try {
    const existing = readLegacyMacosStateImportStatusFromDb(db);
    if (existing.status === "completed") {
      const repairedAt = options.now?.() ?? new Date().toISOString();
      const source = await readLegacyStateSnapshot(options);
      const importResult = readLegacySnapshotImportResultFromDatabase(db);
      repairUnmappedLegacySessionsFromSnapshot(db, source, importResult, {
        createSessionId: options.createSessionId,
        importedAt: repairedAt,
        serverId: options.serverId,
      });
      repairPreviousSessionHistoryIdReferencesFromDatabase(db, importResult, {
        createSessionId: options.createSessionId,
        repairedAt,
      });
      repairProjectBoardConfigIdReferencesFromDatabase(db, importResult, repairedAt);
      await rewriteSharedSidebarStateWithGxserverIds(options, source, importResult, repairedAt).catch(async (error) => {
        await options.logger.log({
          error: error instanceof Error ? error : String(error),
          event: "migration.legacyMacosState.completedSharedSidebarRepairFailed",
          level: "warn",
          serverId: options.serverId,
          source: "legacyMacosStateMigration",
          ts: repairedAt,
        });
      });
      return {
        status: {
          ...existing,
          skippedReason: "alreadyCompleted",
          status: "skipped",
        },
      };
    }

    const importedAt = options.now?.() ?? new Date().toISOString();
    const source = await readLegacyStateSnapshot(options);
    const logResult = await migrateLegacyGxserverLogs({
      legacyLogsDir: options.legacyLogsDir ?? path.join(options.paths.homeDir, ".ghostex", "logs"),
      logger: options.logger,
      migratedAt: importedAt,
      serverId: options.serverId,
    });

    const importResult = importLegacySnapshotIntoDatabase(db, source, {
      createProjectId: options.createProjectId,
      createSessionId: options.createSessionId,
      importedAt,
      serverId: options.serverId,
    });
    await rewriteSharedSidebarStateWithGxserverIds(options, source, importResult, importedAt).catch(async (error) => {
      await options.logger.log({
        error: error instanceof Error ? error : String(error),
        event: "migration.legacyMacosState.sharedSidebarRewriteFailed",
        level: "warn",
        serverId: options.serverId,
        source: "legacyMacosStateMigration",
        ts: importedAt,
      });
    });
    const hasLegacyState =
      source.projects.length > 0 ||
      source.previousSessions.length > 0 ||
      source.agents.length > 0 ||
      Object.keys(source.projectCommandsByLegacyId).length > 0 ||
      Object.keys(source.settings).length > 0 ||
      logResult.migratedLineCount > 0;
    const completedStatus: GxserverStateImportStatus = {
      completedAt: importedAt,
      id: LEGACY_MACOS_STATE_IMPORT_ID,
      logsImported: logResult,
      projectsImported: importResult.projectsImported,
      sessionsImported: importResult.sessionsImported,
      ...(hasLegacyState ? {} : { skippedReason: "noLegacyState" as const }),
      sourceFilesRead: source.sourceFilesRead,
      status: hasLegacyState ? "completed" : "skipped",
    };
    recordLegacyMacosStateImportStatus(db, { ...completedStatus, status: "completed" });
    await options.logger.log({
      details: { ...completedStatus },
      event: "migration.legacyMacosState.completed",
      level: "info",
      serverId: options.serverId,
      source: "legacyMacosStateMigration",
      ts: importedAt,
    });
    return { status: completedStatus };
  } catch (error) {
    await options.logger.log({
      error: error instanceof Error ? error : String(error),
      event: "migration.legacyMacosState.failed",
      level: "error",
      serverId: options.serverId,
      source: "legacyMacosStateMigration",
    });
    throw error;
  } finally {
    db.close();
  }
}

export function readLegacyMacosStateImportStatus(paths: GxserverPaths): GxserverStateImportStatus {
  const db = openGxserverDatabase(paths);
  try {
    return readLegacyMacosStateImportStatusFromDb(db);
  } finally {
    db.close();
  }
}

function readLegacyMacosStateImportStatusFromDb(db: Database.Database): GxserverStateImportStatus {
  const row = db.prepare<[string], { value: string }>("SELECT value FROM metadata WHERE key = ?").get(LEGACY_IMPORT_METADATA_KEY);
  if (!row) {
    return { id: LEGACY_MACOS_STATE_IMPORT_ID, status: "notRun" };
  }
  try {
    const parsed = JSON.parse(row.value) as Partial<GxserverStateImportStatus>;
    return {
      ...parsed,
      id: LEGACY_MACOS_STATE_IMPORT_ID,
      status: parsed.status === "completed" ? "completed" : "notRun",
    };
  } catch {
    return { id: LEGACY_MACOS_STATE_IMPORT_ID, status: "notRun" };
  }
}

function recordLegacyMacosStateImportStatus(db: Database.Database, status: GxserverStateImportStatus): void {
  db.prepare(
    `INSERT INTO metadata (key, value, updatedAt)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
  ).run(LEGACY_IMPORT_METADATA_KEY, JSON.stringify(status), status.completedAt ?? new Date().toISOString());
}

async function readLegacyStateSnapshot(options: GxserverLegacyMacosStateMigrationOptions): Promise<LegacyStateSnapshot> {
  const sharedStateDir = options.sharedStateDir ?? path.join(options.paths.homeDir, ".ghostex", "state");
  const localStorageValues = {
    ...(await readLegacyLocalStorageValues(options)),
    ...options.legacyStorageValues,
  };
  const sourceFilesRead: string[] = [];
  const sharedProjects = await readSharedJsonFilePayload(path.join(sharedStateDir, SHARED_PROJECTS_FILE), sourceFilesRead);
  const sharedPreviousSessions = await readSharedJsonFilePayload(
    path.join(sharedStateDir, SHARED_PREVIOUS_SESSIONS_FILE),
    sourceFilesRead,
  );
  const sharedSettings = await readSharedJsonFilePayload(path.join(sharedStateDir, SHARED_SETTINGS_FILE), sourceFilesRead);
  const projectPayload = selectLegacyStoragePayload(
    LEGACY_STORAGE_KEYS.projects,
    sharedProjects,
    parseLegacyStoragePayload(localStorageValues[LEGACY_STORAGE_KEYS.projects]),
  );
  const previousPayload = selectLegacyStoragePayload(
    LEGACY_STORAGE_KEYS.previousSessions,
    sharedPreviousSessions,
    parseLegacyStoragePayload(localStorageValues[LEGACY_STORAGE_KEYS.previousSessions]),
    { sharedProjectsMigrated: isGxserverMigratedProjectSnapshot(sharedProjects?.parsed) },
  );
  const settingsPayload = selectLegacyStoragePayload(
    LEGACY_STORAGE_KEYS.settings,
    sharedSettings,
    parseLegacyStoragePayload(localStorageValues[LEGACY_STORAGE_KEYS.settings]),
  );
  const settings = normalizeObject(settingsPayload);
  const activeSessionsSortMode = localStorageValues[LEGACY_STORAGE_KEYS.activeSessionsSortMode];
  if (activeSessionsSortMode === "manual" || activeSessionsSortMode === "lastActivity") {
    settings.activeSessionsSortMode = activeSessionsSortMode;
  }

  return {
    agentOrder: normalizeStringArray(parseJson(localStorageValues[LEGACY_STORAGE_KEYS.agentOrder])),
    agents: normalizeObjectArray(parseJson(localStorageValues[LEGACY_STORAGE_KEYS.agents])),
    activeProjectId: isRecord(projectPayload) ? text(projectPayload.activeProjectId) : undefined,
    gitConfig: normalizeLegacyGitConfig(localStorageValues),
    previousSessions: normalizeObjectArray(previousPayload),
    projectCommandsByLegacyId: normalizeLegacyProjectCommands(
      parseJson(localStorageValues[LEGACY_STORAGE_KEYS.projectCommands]),
    ),
    projects: normalizeObjectArray(isRecord(projectPayload) ? projectPayload.projects : undefined),
    settings,
    sourceFilesRead,
  };
}

/*
CDXC:GxserverMigration 2026-05-30-19:48:
gxserver can start before the macOS app has reconciled stale shared sidebar JSON with richer WKWebView localStorage. Match GhostexAppStorage's source scoring during legacy import so first daemon start does not mark migration complete from an older shared file while fresher projects or previous-session history still exist in WK storage.
*/
function selectLegacyStoragePayload(
  key: string,
  sharedPayload: LegacyStoragePayload | undefined,
  localStoragePayload: LegacyStoragePayload | undefined,
  context: { sharedProjectsMigrated?: boolean } = {},
): unknown {
  if (!sharedPayload) {
    if (key === LEGACY_STORAGE_KEYS.previousSessions && context.sharedProjectsMigrated === true) {
      return [];
    }
    return localStoragePayload?.parsed;
  }
  if (!localStoragePayload) {
    return sharedPayload.parsed;
  }
  if (key === LEGACY_STORAGE_KEYS.settings) {
    /*
    CDXC:GxserverMigration 2026-05-30-23:13:
    macOS bootstrap treats `native-sidebar-settings.json` as the authoritative settings source once it exists: Settings writes every save to the shared file and WK localStorage, and startup only uses `ghostex-native-settings` to seed a missing shared file. Keep gxserver migration on the same policy so a richer but stale WK blob cannot flip terminal provider, notifications, or Auto Sleep during the cutover.
    */
    return sharedPayload.parsed;
  }
  if (key === LEGACY_STORAGE_KEYS.projects && isGxserverMigratedProjectSnapshot(sharedPayload.parsed)) {
    return sharedPayload.parsed;
  }
  if (
    key === LEGACY_STORAGE_KEYS.previousSessions &&
    isGxserverMigratedPreviousSessionsSnapshot(sharedPayload.parsed, {
      allowEmpty: context.sharedProjectsMigrated === true,
    })
  ) {
    return sharedPayload.parsed;
  }
  if (
    key === LEGACY_STORAGE_KEYS.projects &&
    projectSnapshotScore(localStoragePayload) > projectSnapshotScore(sharedPayload)
  ) {
    return localStoragePayload.parsed;
  }
  if (
    key === LEGACY_STORAGE_KEYS.previousSessions &&
    previousSessionsSnapshotScore(localStoragePayload) > previousSessionsSnapshotScore(sharedPayload)
  ) {
    return localStoragePayload.parsed;
  }
  return sharedPayload.parsed;
}

async function readSharedJsonFilePayload(
  filePath: string,
  sourceFilesRead: string[],
): Promise<LegacyStoragePayload | undefined> {
  try {
    const payloadJson = await readFile(filePath, "utf8");
    sourceFilesRead.push(filePath);
    return { payloadJson, parsed: JSON.parse(payloadJson) };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function parseLegacyStoragePayload(payloadJson: string | undefined): LegacyStoragePayload | undefined {
  if (!payloadJson) {
    return undefined;
  }
  const parsed = parseJson(payloadJson);
  return parsed === undefined ? undefined : { payloadJson, parsed };
}

function isGxserverMigratedProjectSnapshot(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.gxserverMigratedAt === "string") {
    return true;
  }
  const projects = Array.isArray(value.projects) ? value.projects.filter(isRecord) : [];
  if (projects.length === 0) {
    return false;
  }
  const projectIds = projects
    .map((project) => project.projectId)
    .filter((projectId): projectId is string => typeof projectId === "string");
  return projectIds.length > 0 && projectIds.every(isGxserverProjectId);
}

function isGxserverMigratedPreviousSessionsSnapshot(
  value: unknown,
  options: { allowEmpty?: boolean } = {},
): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  /*
  CDXC:PreviousSessions 2026-05-30-22:14:
  After gxserver has rewritten the projects file with its migration marker, a shared previous-sessions `[]` is the canonical absence of restorable history. Treat that empty file as authoritative over stale WKWebView localStorage so old previous-session rows cannot reappear during completed-import repair.
  */
  if (value.length === 0) {
    return options.allowEmpty === true;
  }
  return value.every((item) => {
    if (!isRecord(item)) {
      return false;
    }
    const projectId = item.projectId;
    const sessionId = item.sessionId;
    return (
      (typeof projectId !== "string" || isGxserverProjectId(projectId)) &&
      (typeof sessionId !== "string" || isGxserverSessionId(sessionId))
    );
  });
}

function projectSnapshotScore(payload: LegacyStoragePayload): number {
  const object = normalizeObject(payload.parsed);
  const projects = Array.isArray(object.projects) ? object.projects : [];
  if (projects.length === 0) {
    return 0;
  }
  /*
  CDXC:GxserverMigration 2026-05-30-22:45:
  Project source selection must treat command-panel sessions as migration-relevant daemon state, because the importer creates gxserver sessions from `commandsPanel.sessions` and preserves `commandsPanel.activeSessionId`. Score structural project/session data above raw JSON size so stale shared files with large client-only blobs cannot beat richer WKWebView state.
  */
  const sessionWeight = projects.reduce((count, project) => count + projectMigrationSessionWeight(project), 0);
  return (
    projects.length * PROJECT_SNAPSHOT_PROJECT_SCORE +
    sessionWeight * PROJECT_SNAPSHOT_SESSION_SCORE +
    Math.min(payload.payloadJson.length, PROJECT_SNAPSHOT_BYTE_TIEBREAKER_LIMIT)
  );
}

function projectMigrationSessionWeight(project: unknown): number {
  const projectObject = normalizeObject(project);
  const commandsPanel = normalizeObject(projectObject.commandsPanel);
  const commandPanelSessions = Array.isArray(commandsPanel.sessions) ? commandsPanel.sessions : [];
  const activeCommandPanelSessionWeight = typeof commandsPanel.activeSessionId === "string" ? 1 : 0;
  return projectWorkspaceSessionCount(projectObject) + commandPanelSessions.length + activeCommandPanelSessionWeight;
}

function projectWorkspaceSessionCount(project: unknown): number {
  const workspace = normalizeObject(normalizeObject(project).workspace);
  const groups = Array.isArray(workspace.groups) ? workspace.groups : [];
  return groups.reduce((count, group) => {
    const snapshot = normalizeObject(normalizeObject(group).snapshot);
    const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
    return count + sessions.length;
  }, 0);
}

function previousSessionsSnapshotScore(payload: LegacyStoragePayload): number {
  return Array.isArray(payload.parsed) ? payload.parsed.length * 1_000 + payload.payloadJson.length : 0;
}

async function readLegacyLocalStorageValues(
  options: GxserverLegacyMacosStateMigrationOptions,
): Promise<Record<string, string | undefined>> {
  if (options.legacyStorageValues) {
    return {};
  }
  const root = options.legacyLocalStorageRoot ?? path.join(options.paths.homeDir, "Library", "WebKit", "com.madda.ghostex.host");
  const databaseFiles = await findLocalStorageDatabases(root);
  const candidates: Record<string, LegacyLocalStorageCandidate | undefined> = {};
  for (const file of databaseFiles) {
    const modifiedAtMs = await readFileModifiedAtMs(file);
    const db = new Database(file, { fileMustExist: true, readonly: true });
    try {
      const select = db.prepare<[string], { value: Buffer | string }>("SELECT value FROM ItemTable WHERE key = ? LIMIT 1");
      for (const key of Object.values(LEGACY_STORAGE_KEYS)) {
        const row = select.get(key);
        const decoded = row ? decodeLegacyLocalStorageValue(row.value) : undefined;
        if (decoded !== undefined) {
          const candidate = { databasePath: file, modifiedAtMs, value: decoded };
          candidates[key] = selectLegacyLocalStorageCandidate(key, candidates[key], candidate);
        }
      }
    } finally {
      db.close();
    }
  }
  return Object.fromEntries(
    Object.entries(candidates).map(([key, candidate]) => [key, candidate?.value]),
  );
}

async function findLocalStorageDatabases(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath);
      } else if (entry.isFile() && entry.name === "localstorage.sqlite3") {
        found.push(filePath);
      }
    }
  }
  await visit(root);
  return found.sort((left, right) => left.localeCompare(right));
}

/*
CDXC:GxserverMigration 2026-05-30-19:55:
WKWebView can leave multiple `localstorage.sqlite3` files with the same Ghostex keys. Migration must rank candidates by the same canonical/richer snapshot rules used for shared-vs-WK storage, then by database freshness and path, so stale first-directory enumeration cannot import old projects, settings, agents, or commands nondeterministically.
*/
function selectLegacyLocalStorageCandidate(
  key: string,
  current: LegacyLocalStorageCandidate | undefined,
  candidate: LegacyLocalStorageCandidate,
): LegacyLocalStorageCandidate {
  if (!current) {
    return candidate;
  }
  const currentScore = legacyLocalStorageValueScore(key, current.value);
  const candidateScore = legacyLocalStorageValueScore(key, candidate.value);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }
  if (candidate.modifiedAtMs !== current.modifiedAtMs) {
    return candidate.modifiedAtMs > current.modifiedAtMs ? candidate : current;
  }
  if (candidate.value.length !== current.value.length) {
    return candidate.value.length > current.value.length ? candidate : current;
  }
  return candidate.databasePath.localeCompare(current.databasePath) < 0 ? candidate : current;
}

function legacyLocalStorageValueScore(key: string, value: string): number {
  const payload = parseLegacyStoragePayload(value);
  if (payload && key === LEGACY_STORAGE_KEYS.projects) {
    return isGxserverMigratedProjectSnapshot(payload.parsed) ? 1_000_000_000 : projectSnapshotScore(payload);
  }
  if (payload && key === LEGACY_STORAGE_KEYS.previousSessions) {
    return isGxserverMigratedPreviousSessionsSnapshot(payload.parsed) ? 1_000_000_000 : previousSessionsSnapshotScore(payload);
  }
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) {
    return parsed.length * 1_000 + value.length;
  }
  if (isRecord(parsed)) {
    return Object.keys(parsed).length * 1_000 + value.length;
  }
  return value.trim() ? 1 : 0;
}

async function readFileModifiedAtMs(filePath: string): Promise<number> {
  return (await stat(filePath)).mtimeMs;
}

function decodeLegacyLocalStorageValue(value: Buffer | string): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  for (const encoding of ["utf8", "utf16le"] as const) {
    const decoded = value.toString(encoding);
    if (!decoded.includes("\u0000") && decoded.trim()) {
      return decoded;
    }
  }
  return undefined;
}

function importLegacySnapshotIntoDatabase(
  db: Database.Database,
  snapshot: LegacyStateSnapshot,
  options: {
    createProjectId?: GxserverCandidateFactory<GxserverProjectId>;
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    importedAt: string;
    serverId: GxserverServerId;
  },
): LegacySnapshotImportResult {
  return db.transaction(() => {
    let projectsImported = 0;
    let sessionsImported = 0;
    const existingProjectIds = readExistingIds(db, "project", "");
    const previousByProject = groupPreviousSessionsByProject(snapshot.previousSessions);
    const existingImportResult = readLegacySnapshotImportResultFromDatabase(db);
    /*
    CDXC:GxserverMigration 2026-05-30-19:28:
    First-run migration retries can happen after SQLite rows were inserted but before the completion marker was recorded. Seed the import map from durable legacyProjectId/legacySessionId metadata before allocating IDs so the retry reuses the original P/G identities and only fills genuinely missing rows.
    */
    const projectIdByLegacyProjectId: Record<string, GxserverProjectId> = {
      ...existingImportResult.projectIdByLegacyProjectId,
    };
    const sessionIdByLegacyProjectId: Record<string, Record<string, GxserverSessionId>> = Object.fromEntries(
      Object.entries(existingImportResult.sessionIdByLegacyProjectId).map(([legacyProjectId, sessionIds]) => [
        legacyProjectId,
        { ...sessionIds },
      ]),
    );
    const allocatedProjectIds = snapshot.projects.map((legacyProject) => {
      const legacyProjectId = text(legacyProject.projectId);
      const existingProjectId = legacyProjectId ? projectIdByLegacyProjectId[legacyProjectId] : undefined;
      const projectId = existingProjectId ?? createUniqueProjectId(existingProjectIds, options.createProjectId);
      existingProjectIds.add(projectId);
      if (legacyProjectId) {
        projectIdByLegacyProjectId[legacyProjectId] = projectId;
        sessionIdByLegacyProjectId[legacyProjectId] ??= {};
      }
      return projectId;
    });

    for (const [projectIndex, legacyProject] of snapshot.projects.entries()) {
      const projectId = allocatedProjectIds[projectIndex]!;
      const legacyProjectId = text(legacyProject.projectId);
      const existingProjectId = legacyProjectId
        ? existingImportResult.projectIdByLegacyProjectId[legacyProjectId]
        : undefined;
      const projectPath = text(legacyProject.path);
      const projectName = text(legacyProject.name) ?? nameFromPath(projectPath) ?? projectId;
      const commands = findLegacyProjectCommands(snapshot.projectCommandsByLegacyId, legacyProjectId, legacyProject);
      const canonicalWorktree = remapLegacyProjectIdsInObject(
        normalizeObject(legacyProject.worktree),
        projectIdByLegacyProjectId,
      );
      if (!existingProjectId) {
        insertProjectRow(db, {
          attentionRulesJson: stringifyJson(pickAttentionRules(snapshot.settings)),
          completionRulesJson: stringifyJson(pickCompletionRules(snapshot.settings)),
          createdAt: options.importedAt,
          customAgentOrderJson: stringifyJson(snapshot.agentOrder),
          customAgentsJson: stringifyJson(snapshot.agents),
          customCommandOrderJson: stringifyJson(commands.order),
          customCommandsJson: stringifyJson(commands.commands),
          defaultCommand: null,
          deletedDefaultCommandIdsJson: stringifyJson(commands.deletedDefaultCommandIds),
          gitConfigJson: stringifyJson({
            ...snapshot.gitConfig,
            beadsDisplayKey: text(legacyProject.beadsDisplayKey),
            legacyProjectId,
            worktreeCommand: text(legacyProject.worktreeCommand),
          }),
          identityIconJson: stringifyJson(pickIdentityIcon(legacyProject)),
          isFavorite: 0,
          isPinned: 0,
          launchSettingsJson: stringifyJson({
            activeProjectImported: false,
            isChat: legacyProject.isChat === true,
            isQuick: legacyProject.isQuick === true,
            projectEditor: normalizeObject(legacyProject.projectEditor),
            projectEditorCompanionPaneHidden: legacyProject.projectEditorCompanionPaneHidden === true,
            quickKind: text(legacyProject.quickKind),
            quickOriginalMissing: legacyProject.quickOriginalMissing === true,
            quickOriginalPath: text(legacyProject.quickOriginalPath),
            quickSymlinkPath: text(legacyProject.quickSymlinkPath),
            settings: pickLaunchSettings(snapshot.settings),
          }),
          name: projectName,
          notificationRulesJson: stringifyJson(pickNotificationRules(snapshot.settings)),
          path: projectPath ?? null,
          previousSessionHistoryJson: stringifyJson([]),
          projectBoardConfigJson: stringifyJson({
            beadConversationLinks: normalizeObjectArray(legacyProject.beadConversationLinks),
            beadsDisplayKey: text(legacyProject.beadsDisplayKey),
          }),
          projectId,
          runtimeSettingsJson: stringifyJson({
            activeSessionsSortMode: snapshot.settings.activeSessionsSortMode,
            legacyProjectId,
            settings: pickRuntimeSettings(snapshot.settings),
          }),
          updatedAt: options.importedAt,
          worktreeJson: stringifyJson(canonicalWorktree),
        });
        recordIdAllocation(db, "project", "", projectId, options.importedAt);
      }
      projectsImported += 1;
      sessionsImported += importLegacyProjectSessions(db, legacyProject, {
        createSessionId: options.createSessionId,
        importedAt: options.importedAt,
        projectId,
        projectPath,
        serverId: options.serverId,
        sessionIdByLegacySessionId: legacyProjectId ? sessionIdByLegacyProjectId[legacyProjectId] : undefined,
        settings: snapshot.settings,
      });
    }

    /*
    CDXC:ProjectBoard 2026-05-30-21:10:
    Legacy project-board conversation links are routing data, not decorative client state. Store them in gxserver with the same canonical P/G identities used by imported projects and sessions so "Go to Session" never points at obsolete `project-*`/`g-*` sidebar IDs after the hard cutover.
    */
    const completedImportResult = {
      projectIdByLegacyProjectId,
      projectsImported,
      sessionIdByLegacyProjectId,
      sessionsImported,
    };
    /*
    CDXC:PreviousSessions 2026-05-30-20:03:
    gxserver project history is shared daemon state, so every visible project/session reference imported from legacy previous sessions must use canonical P/G IDs before clients read `listProjects`. Keep legacy IDs only inside `hiddenRestoreMetadata`, where they are audit/restore context rather than routable daemon identity.
    */
    updatePreviousSessionHistoryRowsFromSnapshot(db, snapshot, previousByProject, allocatedProjectIds, completedImportResult, {
      createSessionId: options.createSessionId,
      importedAt: options.importedAt,
    });
    for (const [projectIndex, legacyProject] of snapshot.projects.entries()) {
      updateProjectBoardConfigRow(db, {
        projectBoardConfigJson: stringifyJson(createLegacyProjectBoardConfig(legacyProject, completedImportResult)),
        projectId: allocatedProjectIds[projectIndex]!,
        updatedAt: options.importedAt,
      });
    }

    return completedImportResult;
  })();
}

function readLegacySnapshotImportResultFromDatabase(db: Database.Database): LegacySnapshotImportResult {
  const projectIdByLegacyProjectId: Record<string, GxserverProjectId> = {};
  const sessionIdByLegacyProjectId: Record<string, Record<string, GxserverSessionId>> = {};
  const projectRows = db
    .prepare<[], { gitConfigJson: string; previousSessionHistoryJson: string; projectId: string; runtimeSettingsJson: string }>(
      "SELECT projectId, runtimeSettingsJson, gitConfigJson, previousSessionHistoryJson FROM projects",
    )
    .all();
  for (const row of projectRows) {
    if (isGxserverProjectId(row.projectId)) {
      /*
      CDXC:GxserverMigration 2026-05-30-18:39:
      Pre-release hard-cutover builds could write fresh legacy-shaped `g-*` sessions into an already canonical P project after the SQLite import marker existed. Treat existing P project IDs as self-mapped during completed-import repair so those orphan sessions can be imported with new G IDs instead of being replayed into the sidebar forever.
      */
      projectIdByLegacyProjectId[row.projectId] = row.projectId;
      sessionIdByLegacyProjectId[row.projectId] ??= {};
    }
    const legacyProjectId =
      text(normalizeObject(parseJson(row.runtimeSettingsJson)).legacyProjectId) ??
      text(normalizeObject(parseJson(row.gitConfigJson)).legacyProjectId);
    if (!legacyProjectId) {
      continue;
    }
    const projectId = row.projectId as GxserverProjectId;
    projectIdByLegacyProjectId[legacyProjectId] = projectId;
    sessionIdByLegacyProjectId[legacyProjectId] = {};
  }

  const sessionRows = db
    .prepare<[], { launchSettingsJson: string; projectId: string; providerStateJson: string; sessionId: string }>(
      "SELECT projectId, sessionId, providerStateJson, launchSettingsJson FROM sessions",
    )
    .all();
  const legacyProjectIdsByProjectId = new Map<GxserverProjectId, string[]>();
  for (const [legacyProjectId, projectId] of Object.entries(projectIdByLegacyProjectId)) {
    const ids = legacyProjectIdsByProjectId.get(projectId) ?? [];
    ids.push(legacyProjectId);
    legacyProjectIdsByProjectId.set(projectId, ids);
  }
  for (const row of sessionRows) {
    const legacyProjectIds = legacyProjectIdsByProjectId.get(row.projectId as GxserverProjectId);
    if (!legacyProjectIds) {
      continue;
    }
    const legacySessionId =
      text(normalizeObject(parseJson(row.providerStateJson)).legacySessionId) ??
      text(normalizeObject(parseJson(row.launchSettingsJson)).legacySessionId);
    for (const legacyProjectId of legacyProjectIds) {
      sessionIdByLegacyProjectId[legacyProjectId] ??= {};
      if (legacySessionId) {
        sessionIdByLegacyProjectId[legacyProjectId]![legacySessionId] = row.sessionId as GxserverSessionId;
      }
      if (isGxserverSessionId(row.sessionId)) {
        sessionIdByLegacyProjectId[legacyProjectId]![row.sessionId] = row.sessionId;
      }
    }
  }
  for (const row of projectRows) {
    const legacyProjectIds = legacyProjectIdsByProjectId.get(row.projectId as GxserverProjectId);
    if (!legacyProjectIds) {
      continue;
    }
    for (const previousSession of normalizeObjectArray(parseJson(row.previousSessionHistoryJson))) {
      const legacySessionId = text(normalizeObject(previousSession.hiddenRestoreMetadata).legacySessionId);
      const sessionId = text(previousSession.sessionId);
      if (!legacySessionId || !sessionId || !isGxserverSessionId(sessionId)) {
        continue;
      }
      for (const legacyProjectId of legacyProjectIds) {
        sessionIdByLegacyProjectId[legacyProjectId] ??= {};
        sessionIdByLegacyProjectId[legacyProjectId]![legacySessionId] = sessionId;
      }
    }
  }

  return {
    projectIdByLegacyProjectId,
    projectsImported: projectRows.length,
    sessionIdByLegacyProjectId,
    sessionsImported: sessionRows.length,
  };
}

function repairUnmappedLegacySessionsFromSnapshot(
  db: Database.Database,
  snapshot: LegacyStateSnapshot,
  importResult: LegacySnapshotImportResult,
  options: {
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    importedAt: string;
    serverId: GxserverServerId;
  },
): number {
  return db.transaction(() => {
    let repaired = 0;
    for (const legacyProject of snapshot.projects) {
      const legacyProjectId = text(legacyProject.projectId);
      if (!legacyProjectId) {
        continue;
      }
      const projectId = importResult.projectIdByLegacyProjectId[legacyProjectId];
      if (!projectId) {
        continue;
      }
      const existingSessionIds = readExistingIds(db, "session", projectId);
      const sessionIdByLegacySessionId = (importResult.sessionIdByLegacyProjectId[legacyProjectId] ??= {});
      const projectPath = text(legacyProject.path);
      for (const session of collectLegacyTerminalSessions(legacyProject)) {
        const legacySessionId = text(session.sessionId);
        if (!legacySessionId || isGxserverSessionId(legacySessionId) || sessionIdByLegacySessionId[legacySessionId]) {
          continue;
        }
        const sessionId = createUniqueSessionId(existingSessionIds, options.createSessionId);
        existingSessionIds.add(sessionId);
        sessionIdByLegacySessionId[legacySessionId] = sessionId;
        insertLegacySessionRow(db, legacyProject, session, {
          importedAt: options.importedAt,
          projectId,
          projectPath,
          serverId: options.serverId,
          sessionId,
          settings: snapshot.settings,
        });
        repaired += 1;
      }
    }
    return repaired;
  })();
}

function repairProjectBoardConfigIdReferencesFromDatabase(
  db: Database.Database,
  importResult: LegacySnapshotImportResult,
  repairedAt: string,
): void {
  const rows = db
    .prepare<[], { projectBoardConfigJson: string; projectId: string }>(
      "SELECT projectId, projectBoardConfigJson FROM projects",
    )
    .all();
  for (const row of rows) {
    const projectBoardConfig = normalizeObject(parseJson(row.projectBoardConfigJson));
    const remapped = remapProjectBoardConfigIds(projectBoardConfig, row.projectId as GxserverProjectId, importResult);
    if (JSON.stringify(remapped) === JSON.stringify(projectBoardConfig)) {
      continue;
    }
    updateProjectBoardConfigRow(db, {
      projectBoardConfigJson: stringifyJson(remapped),
      projectId: row.projectId as GxserverProjectId,
      updatedAt: repairedAt,
    });
  }
}

function repairPreviousSessionHistoryIdReferencesFromDatabase(
  db: Database.Database,
  importResult: LegacySnapshotImportResult,
  options: {
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    repairedAt: string;
  },
): void {
  const rows = db
    .prepare<[], { previousSessionHistoryJson: string; projectId: string }>(
      "SELECT projectId, previousSessionHistoryJson FROM projects",
    )
    .all();
  for (const row of rows) {
    const projectId = row.projectId as GxserverProjectId;
    const previousSessionHistory = normalizeObjectArray(parseJson(row.previousSessionHistoryJson));
    const canonicalHistory = canonicalizePreviousSessionHistory(previousSessionHistory, {
      createSessionId: options.createSessionId,
      db,
      defaultLegacyProjectId: legacyProjectIdsForProject(projectId, importResult)[0] ?? projectId,
      importedAt: options.repairedAt,
      importResult,
      projectId,
    });
    if (JSON.stringify(canonicalHistory) === JSON.stringify(previousSessionHistory)) {
      continue;
    }
    updatePreviousSessionHistoryRow(db, {
      previousSessionHistoryJson: stringifyJson(canonicalHistory),
      projectId,
      updatedAt: options.repairedAt,
    });
  }
}

function updatePreviousSessionHistoryRowsFromSnapshot(
  db: Database.Database,
  snapshot: LegacyStateSnapshot,
  previousByProject: Map<string, JsonArray>,
  allocatedProjectIds: readonly GxserverProjectId[],
  importResult: LegacySnapshotImportResult,
  options: {
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    importedAt: string;
  },
): void {
  for (const [projectIndex, legacyProject] of snapshot.projects.entries()) {
    const projectId = allocatedProjectIds[projectIndex]!;
    const legacyProjectId = text(legacyProject.projectId);
    const projectPath = text(legacyProject.path);
    const projectPreviousHistory = [
      ...(previousByProject.get(legacyProjectId ?? "") ?? []),
      ...(previousByProject.get(projectPath ?? "") ?? []),
    ];
    const canonicalHistory = canonicalizePreviousSessionHistory(projectPreviousHistory, {
      createSessionId: options.createSessionId,
      db,
      defaultLegacyProjectId: legacyProjectId ?? projectId,
      importedAt: options.importedAt,
      importResult,
      projectId,
    });
    updatePreviousSessionHistoryRow(db, {
      previousSessionHistoryJson: stringifyJson(canonicalHistory),
      projectId,
      updatedAt: options.importedAt,
    });
  }
}

function canonicalizePreviousSessionHistory(
  previousSessionHistory: JsonArray,
  context: {
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    db: Database.Database;
    defaultLegacyProjectId: string;
    importedAt: string;
    importResult: LegacySnapshotImportResult;
    projectId: GxserverProjectId;
  },
): JsonArray {
  const existingSessionIdsByProjectId = new Map<GxserverProjectId, Set<string>>();
  const allocationContext = { ...context, existingSessionIdsByProjectId };
  for (const historyItem of previousSessionHistory) {
    reservePreviousSessionHistoryIds(historyItem, allocationContext);
  }
  return previousSessionHistory.map((historyItem) =>
    remapLegacySidebarIds(historyItem, {
      preserveHiddenRestoreMetadata: true,
      projectIdByLegacyProjectId: context.importResult.projectIdByLegacyProjectId,
      sessionIdByLegacyProjectId: context.importResult.sessionIdByLegacyProjectId,
      sessionIdByLegacySessionId: mergeLegacySessionIdsForProject(context.projectId, context.importResult),
    }) as JsonObject,
  );
}

function reservePreviousSessionHistoryIds(
  value: unknown,
  context: {
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    db: Database.Database;
    defaultLegacyProjectId: string;
    existingSessionIdsByProjectId: Map<GxserverProjectId, Set<string>>;
    importedAt: string;
    importResult: LegacySnapshotImportResult;
    projectId: GxserverProjectId;
  },
  key?: string,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      reservePreviousSessionHistoryIds(item, context, key);
    }
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && key && SESSION_ID_FIELDS.has(key)) {
      reservePreviousSessionHistoryIdString(value, context);
    }
    return;
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === "hiddenRestoreMetadata") {
      continue;
    }
    reservePreviousSessionHistoryIds(entryValue, context, entryKey);
  }
}

function reservePreviousSessionHistoryIdString(
  value: string,
  context: {
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    db: Database.Database;
    defaultLegacyProjectId: string;
    existingSessionIdsByProjectId: Map<GxserverProjectId, Set<string>>;
    importedAt: string;
    importResult: LegacySnapshotImportResult;
    projectId: GxserverProjectId;
  },
): void {
  const combined = parseCombinedProjectSessionId(value);
  if (combined) {
    const projectId =
      remapLegacyProjectId(combined.projectId, context.importResult.projectIdByLegacyProjectId) ?? context.projectId;
    reserveLegacySessionIdForProject(combined.projectId, combined.sessionId, projectId, context);
    return;
  }
  reserveLegacySessionIdForProject(context.defaultLegacyProjectId, value, context.projectId, context);
}

function reserveLegacySessionIdForProject(
  legacyProjectId: string,
  legacySessionId: string,
  projectId: GxserverProjectId,
  context: {
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    db: Database.Database;
    existingSessionIdsByProjectId: Map<GxserverProjectId, Set<string>>;
    importedAt: string;
    importResult: LegacySnapshotImportResult;
  },
): void {
  if (!legacySessionId || isGxserverSessionId(legacySessionId)) {
    return;
  }
  const sessionIdByLegacySessionId = (context.importResult.sessionIdByLegacyProjectId[legacyProjectId] ??= {});
  if (sessionIdByLegacySessionId[legacySessionId]) {
    return;
  }
  const existingForProject = mergeLegacySessionIdsForProject(projectId, context.importResult)[legacySessionId];
  if (existingForProject) {
    sessionIdByLegacySessionId[legacySessionId] = existingForProject;
    return;
  }
  let existingSessionIds = context.existingSessionIdsByProjectId.get(projectId);
  if (!existingSessionIds) {
    existingSessionIds = readExistingIds(context.db, "session", projectId);
    context.existingSessionIdsByProjectId.set(projectId, existingSessionIds);
  }
  const sessionId = createUniqueSessionId(existingSessionIds, context.createSessionId);
  existingSessionIds.add(sessionId);
  sessionIdByLegacySessionId[legacySessionId] = sessionId;
  recordIdAllocation(context.db, "session", projectId, sessionId, context.importedAt);
}

function createLegacyProjectBoardConfig(
  legacyProject: JsonObject,
  importResult: LegacySnapshotImportResult,
): JsonObject {
  const legacyProjectId = text(legacyProject.projectId);
  return compactObject({
    beadConversationLinks: remapLegacySidebarIds(normalizeObjectArray(legacyProject.beadConversationLinks), {
      projectIdByLegacyProjectId: importResult.projectIdByLegacyProjectId,
      sessionIdByLegacyProjectId: importResult.sessionIdByLegacyProjectId,
      sessionIdByLegacySessionId: legacyProjectId ? importResult.sessionIdByLegacyProjectId[legacyProjectId] ?? {} : {},
    }),
    beadsDisplayKey: text(legacyProject.beadsDisplayKey),
  });
}

function remapProjectBoardConfigIds(
  projectBoardConfig: JsonObject,
  projectId: GxserverProjectId,
  importResult: LegacySnapshotImportResult,
): JsonObject {
  return remapLegacySidebarIds(projectBoardConfig, {
    projectIdByLegacyProjectId: importResult.projectIdByLegacyProjectId,
    sessionIdByLegacyProjectId: importResult.sessionIdByLegacyProjectId,
    sessionIdByLegacySessionId: mergeLegacySessionIdsForProject(projectId, importResult),
  }) as JsonObject;
}

function mergeLegacySessionIdsForProject(
  projectId: GxserverProjectId,
  importResult: LegacySnapshotImportResult,
): Record<string, GxserverSessionId> {
  const merged: Record<string, GxserverSessionId> = {};
  for (const [legacyProjectId, canonicalProjectId] of Object.entries(importResult.projectIdByLegacyProjectId)) {
    if (canonicalProjectId === projectId) {
      Object.assign(merged, importResult.sessionIdByLegacyProjectId[legacyProjectId]);
    }
  }
  return merged;
}

function legacyProjectIdsForProject(
  projectId: GxserverProjectId,
  importResult: LegacySnapshotImportResult,
): string[] {
  return Object.entries(importResult.projectIdByLegacyProjectId)
    .filter(([, canonicalProjectId]) => canonicalProjectId === projectId)
    .map(([legacyProjectId]) => legacyProjectId);
}

function importLegacyProjectSessions(
  db: Database.Database,
  legacyProject: JsonObject,
  options: {
    createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
    importedAt: string;
    projectId: GxserverProjectId;
    projectPath?: string;
    serverId: GxserverServerId;
    sessionIdByLegacySessionId?: Record<string, GxserverSessionId>;
    settings: JsonObject;
  },
): number {
  const existingSessionIds = readExistingIds(db, "session", options.projectId);
  const seenLegacySessionIds = new Set<string>();
  let imported = 0;

  for (const session of collectLegacyTerminalSessions(legacyProject)) {
    const legacySessionId = text(session.sessionId);
    if (legacySessionId && seenLegacySessionIds.has(legacySessionId)) {
      continue;
    }
    if (legacySessionId) {
      seenLegacySessionIds.add(legacySessionId);
    }
    const existingSessionId = legacySessionId ? options.sessionIdByLegacySessionId?.[legacySessionId] : undefined;
    if (existingSessionId) {
      imported += 1;
      continue;
    }
    if (legacySessionId && isGxserverSessionId(legacySessionId) && existingSessionIds.has(legacySessionId)) {
      if (options.sessionIdByLegacySessionId) {
        options.sessionIdByLegacySessionId[legacySessionId] = legacySessionId;
      }
      imported += 1;
      continue;
    }
    const sessionId = createUniqueSessionId(existingSessionIds, options.createSessionId);
    if (legacySessionId && options.sessionIdByLegacySessionId) {
      options.sessionIdByLegacySessionId[legacySessionId] = sessionId;
    }
    existingSessionIds.add(sessionId);
    insertLegacySessionRow(db, legacyProject, session, {
      importedAt: options.importedAt,
      projectId: options.projectId,
      projectPath: options.projectPath,
      serverId: options.serverId,
      sessionId,
      settings: options.settings,
    });
    imported += 1;
  }
  return imported;
}

function insertLegacySessionRow(
  db: Database.Database,
  legacyProject: JsonObject,
  session: JsonObject,
  options: {
    importedAt: string;
    projectId: GxserverProjectId;
    projectPath?: string;
    serverId: GxserverServerId;
    sessionId: GxserverSessionId;
    settings: JsonObject;
  },
): void {
  const legacySessionId = text(session.sessionId);
  const zmxName = createZmxSessionName(options.serverId, options.projectId, options.sessionId);
  const legacyProvider = normalizeLegacyProvider(session.sessionPersistenceProvider, session.tmuxSessionName);
  const legacyProviderName = text(session.sessionPersistenceName) ?? text(session.tmuxSessionName) ?? legacySessionId;
  insertSessionRow(db, {
    agentId: text(session.agentName) ?? null,
    attentionRulesJson: stringifyJson(pickAttentionRules(options.settings)),
    commandId: text(session.commandTitle) ?? null,
    completionRulesJson: stringifyJson(pickCompletionRules(options.settings)),
    createdAt: options.importedAt,
    cwd: options.projectPath ?? null,
    isFavorite: session.isFavorite === true ? 1 : 0,
    isPinned: session.isPinned === true ? 1 : 0,
    kind: text(session.agentName) || text(session.agentSessionId) ? "agent" : "terminal",
    lastActiveAt: text(session.lastActivityAt) ?? text(session.lastAccessedAt) ?? null,
    launchSettingsJson: stringifyJson({
      alias: text(session.alias),
      commandTitle: text(session.commandTitle),
      displayId: text(session.displayId),
      firstUserMessage: text(session.firstUserMessage),
      legacySessionId,
      slotIndex: typeof session.slotIndex === "number" ? session.slotIndex : undefined,
      surface: text(session.surface),
      titleSource: text(session.titleSource),
    }),
    lifecycleState: session.isSleeping === true ? "sleeping" : "running",
    notificationRulesJson: stringifyJson(pickNotificationRules(options.settings)),
    projectId: options.projectId,
    providerStateJson: stringifyJson({
      legacyProvider,
      legacyProviderSessionName: legacyProviderName,
      legacySessionId,
      lifecycleState: "unknown",
      zmxName,
    }),
    restoredFromHistoryId: null,
    restoredFromSessionId: null,
    runtimeSettingsJson: stringifyJson({
      agentSessionId: text(session.agentSessionId),
      agentSessionPath: text(session.agentSessionPath),
      delayedSendDeadlineAt: text(session.delayedSendDeadlineAt),
      globalRef: createGlobalSessionRef(options.serverId, options.projectId, options.sessionId),
      lastStartedAt: text(session.lastStartedAt),
      restoreActivity: text(session.restoreActivity),
      terminalEngine: text(session.terminalEngine),
    }),
    sessionId: options.sessionId,
    title: exactTitle(session.title, options.sessionId),
    updatedAt: options.importedAt,
    worktreeJson: stringifyJson(normalizeObject(legacyProject.worktree)),
    zmxName,
  });
  recordIdAllocation(db, "session", options.projectId, options.sessionId, options.importedAt);
}

async function rewriteSharedSidebarStateWithGxserverIds(
  options: GxserverLegacyMacosStateMigrationOptions,
  snapshot: LegacyStateSnapshot,
  importResult: LegacySnapshotImportResult,
  importedAt: string,
): Promise<void> {
  if (snapshot.projects.length === 0) {
    return;
  }
  const sharedStateDir = options.sharedStateDir ?? path.join(options.paths.homeDir, ".ghostex", "state");
  const projectsFile = path.join(sharedStateDir, SHARED_PROJECTS_FILE);
  const previousSessionsFile = path.join(sharedStateDir, SHARED_PREVIOUS_SESSIONS_FILE);
  await mkdir(sharedStateDir, { recursive: true });
  const canonicalProjects = snapshot.projects.map((project) =>
    remapLegacySidebarIdsForProject(project, importResult),
  );
  const payload = compactObject({
    activeProjectId: remapLegacyProjectId(snapshot.activeProjectId, importResult.projectIdByLegacyProjectId),
    gxserverMigratedAt: importedAt,
    projects: canonicalProjects,
  });
  await backupSharedStateFile(projectsFile);
  await writeFile(projectsFile, stringifyJson(payload), "utf8");

  const canonicalPreviousSessions = snapshot.previousSessions.map((session) =>
    remapLegacySidebarIdsForPreviousSession(session, importResult),
  );
  await backupSharedStateFile(previousSessionsFile);
  await writeFile(previousSessionsFile, stringifyJson(canonicalPreviousSessions), "utf8");
}

async function backupSharedStateFile(filePath: string): Promise<void> {
  try {
    await copyFile(filePath, `${filePath}${LEGACY_SHARED_BACKUP_SUFFIX}`, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "EEXIST")) {
      return;
    }
    throw error;
  }
}

function remapLegacySidebarIdsForProject(
  project: JsonObject,
  importResult: LegacySnapshotImportResult,
): JsonObject {
  const legacyProjectId = text(project.projectId);
  const sessionIds =
    legacyProjectId !== undefined ? importResult.sessionIdByLegacyProjectId[legacyProjectId] ?? {} : {};
  return remapLegacySidebarIds(project, {
    projectIdByLegacyProjectId: importResult.projectIdByLegacyProjectId,
    sessionIdByLegacyProjectId: importResult.sessionIdByLegacyProjectId,
    sessionIdByLegacySessionId: sessionIds,
  }) as JsonObject;
}

function remapLegacySidebarIdsForPreviousSession(
  session: JsonObject,
  importResult: LegacySnapshotImportResult,
): JsonObject {
  const legacyProjectId = text(session.projectId);
  const sessionIds =
    legacyProjectId !== undefined ? importResult.sessionIdByLegacyProjectId[legacyProjectId] ?? {} : {};
  return remapLegacySidebarIds(session, {
    projectIdByLegacyProjectId: importResult.projectIdByLegacyProjectId,
    sessionIdByLegacyProjectId: importResult.sessionIdByLegacyProjectId,
    sessionIdByLegacySessionId: sessionIds,
  }) as JsonObject;
}

function remapLegacySidebarIds(
  value: unknown,
  context: LegacyIdRemapContext,
  key?: string,
): unknown {
  if (context.preserveHiddenRestoreMetadata && key === "hiddenRestoreMetadata") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapLegacySidebarIds(item, context, key));
  }
  if (!isRecord(value)) {
    if (typeof value === "string") {
      return remapLegacySidebarIdString(key, value, context);
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      remapLegacySidebarIds(entryValue, context, entryKey),
    ]),
  );
}

function remapLegacySidebarIdString(
  key: string | undefined,
  value: string,
  context: LegacyIdRemapContext,
): string {
  if (key && PROJECT_ID_FIELDS.has(key)) {
    return remapLegacyProjectId(value, context.projectIdByLegacyProjectId) ?? value;
  }
  if (key && SESSION_ID_FIELDS.has(key)) {
    return remapLegacySessionId(value, context);
  }
  return value;
}

function remapLegacyProjectIdsInObject(
  value: JsonObject,
  projectIdByLegacyProjectId: Record<string, GxserverProjectId>,
): JsonObject {
  return remapLegacySidebarIds(value, {
    projectIdByLegacyProjectId,
    sessionIdByLegacySessionId: {},
  }) as JsonObject;
}

function remapLegacySessionId(value: string, context: LegacyIdRemapContext): string {
  const combined = parseCombinedProjectSessionId(value);
  if (combined) {
    const projectId = remapLegacyProjectId(combined.projectId, context.projectIdByLegacyProjectId) ?? combined.projectId;
    const sessionIds =
      context.sessionIdByLegacyProjectId?.[combined.projectId] ??
      context.sessionIdByLegacyProjectId?.[projectId] ??
      {};
    const sessionId = sessionIds[combined.sessionId] ?? combined.sessionId;
    return createCombinedProjectSessionId(projectId, sessionId);
  }
  return context.sessionIdByLegacySessionId[value] ?? value;
}

function remapLegacyProjectId(
  value: string | undefined,
  projectIdByLegacyProjectId: Record<string, GxserverProjectId>,
): GxserverProjectId | undefined {
  return value ? projectIdByLegacyProjectId[value] : undefined;
}

function createCombinedProjectSessionId(projectId: string, sessionId: string): string {
  return [
    COMBINED_PROJECT_SESSION_ID_PREFIX,
    encodeURIComponent(projectId),
    COMBINED_ID_SEPARATOR,
    encodeURIComponent(sessionId),
  ].join("");
}

function parseCombinedProjectSessionId(
  sessionId: string,
): { projectId: string; sessionId: string } | undefined {
  if (!sessionId.startsWith(COMBINED_PROJECT_SESSION_ID_PREFIX)) {
    return undefined;
  }
  const payload = sessionId.slice(COMBINED_PROJECT_SESSION_ID_PREFIX.length);
  const separatorIndex = payload.indexOf(COMBINED_ID_SEPARATOR);
  if (separatorIndex < 0) {
    return undefined;
  }
  const projectId = decodeCombinedIdPart(payload.slice(0, separatorIndex));
  const originalSessionId = decodeCombinedIdPart(payload.slice(separatorIndex + 1));
  return projectId && originalSessionId ? { projectId, sessionId: originalSessionId } : undefined;
}

function decodeCombinedIdPart(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function collectLegacyTerminalSessions(legacyProject: JsonObject): JsonArray {
  const sessions: JsonArray = [];
  const workspace = normalizeObject(legacyProject.workspace);
  for (const group of normalizeObjectArray(workspace.groups)) {
    const snapshot = normalizeObject(group.snapshot);
    for (const session of normalizeObjectArray(snapshot.sessions)) {
      if (session.kind === "terminal") {
        sessions.push(session);
      }
    }
  }
  const commandsPanel = normalizeObject(legacyProject.commandsPanel);
  for (const session of normalizeObjectArray(commandsPanel.sessions)) {
    if (session.kind === "terminal") {
      sessions.push(session);
    }
  }
  return sessions;
}

function insertProjectRow(db: Database.Database, row: ProjectInsertRow): void {
  db.prepare(
    `INSERT INTO projects (
      projectId, name, path, identityIconJson, isPinned, isFavorite, defaultCommand, worktreeJson,
      customAgentsJson, customAgentOrderJson, customCommandsJson, customCommandOrderJson,
      deletedDefaultCommandIdsJson, launchSettingsJson, runtimeSettingsJson, completionRulesJson,
      attentionRulesJson, notificationRulesJson, gitConfigJson, projectBoardConfigJson,
      previousSessionHistoryJson, createdAt, updatedAt
    ) VALUES (
      @projectId, @name, @path, @identityIconJson, @isPinned, @isFavorite, @defaultCommand, @worktreeJson,
      @customAgentsJson, @customAgentOrderJson, @customCommandsJson, @customCommandOrderJson,
      @deletedDefaultCommandIdsJson, @launchSettingsJson, @runtimeSettingsJson, @completionRulesJson,
      @attentionRulesJson, @notificationRulesJson, @gitConfigJson, @projectBoardConfigJson,
      @previousSessionHistoryJson, @createdAt, @updatedAt
    )`,
  ).run(row);
}

function updateProjectBoardConfigRow(
  db: Database.Database,
  row: { projectBoardConfigJson: string; projectId: GxserverProjectId; updatedAt: string },
): void {
  db.prepare(
    "UPDATE projects SET projectBoardConfigJson = @projectBoardConfigJson, updatedAt = @updatedAt WHERE projectId = @projectId",
  ).run(row);
}

function updatePreviousSessionHistoryRow(
  db: Database.Database,
  row: { previousSessionHistoryJson: string; projectId: GxserverProjectId; updatedAt: string },
): void {
  db.prepare(
    "UPDATE projects SET previousSessionHistoryJson = @previousSessionHistoryJson, updatedAt = @updatedAt WHERE projectId = @projectId",
  ).run(row);
}

function insertSessionRow(db: Database.Database, row: SessionInsertRow): void {
  db.prepare(
    `INSERT INTO sessions (
      projectId, sessionId, kind, title, lifecycleState, providerStateJson, zmxName, cwd,
      agentId, commandId, isPinned, isFavorite, restoredFromSessionId, restoredFromHistoryId,
      launchSettingsJson, runtimeSettingsJson, completionRulesJson, attentionRulesJson,
      notificationRulesJson, worktreeJson, createdAt, updatedAt, lastActiveAt
    ) VALUES (
      @projectId, @sessionId, @kind, @title, @lifecycleState, @providerStateJson, @zmxName, @cwd,
      @agentId, @commandId, @isPinned, @isFavorite, @restoredFromSessionId, @restoredFromHistoryId,
      @launchSettingsJson, @runtimeSettingsJson, @completionRulesJson, @attentionRulesJson,
      @notificationRulesJson, @worktreeJson, @createdAt, @updatedAt, @lastActiveAt
    )`,
  ).run(row);
}

function recordIdAllocation(
  db: Database.Database,
  kind: "project" | "session",
  parentId: string,
  id: string,
  createdAt: string,
): void {
  db.prepare("INSERT OR IGNORE INTO id_allocations (id, kind, parentId, createdAt) VALUES (?, ?, ?, ?)").run(
    id,
    kind,
    parentId,
    createdAt,
  );
}

function readExistingIds(db: Database.Database, kind: "project" | "session", parentId: string): Set<string> {
  if (kind === "project") {
    return new Set(
      db
        .prepare<[], { id: string }>("SELECT projectId AS id FROM projects UNION SELECT id FROM id_allocations WHERE kind = 'project'")
        .all()
        .map((row) => row.id),
    );
  }
  return new Set(
    db
      .prepare<[string, string], { id: string }>(
        "SELECT sessionId AS id FROM sessions WHERE projectId = ? UNION SELECT id FROM id_allocations WHERE kind = 'session' AND parentId = ?",
      )
      .all(parentId, parentId)
      .map((row) => row.id),
  );
}

function groupPreviousSessionsByProject(previousSessions: JsonArray): Map<string, JsonArray> {
  const grouped = new Map<string, JsonArray>();
  for (const item of previousSessions) {
    const normalized = {
      ...item,
      hiddenRestoreMetadata: {
        historyId: text(item.historyId),
        legacySessionId: text(item.sessionId),
        sessionRecord: normalizeObject(item.sessionRecord),
      },
    };
    for (const key of [text(item.projectId), text(item.projectPath)]) {
      if (!key) {
        continue;
      }
      const bucket = grouped.get(key) ?? [];
      bucket.push(normalized);
      grouped.set(key, bucket);
    }
  }
  return grouped;
}

function findLegacyProjectCommands(
  store: Record<string, LegacyProjectCommands>,
  legacyProjectId: string | undefined,
  legacyProject: JsonObject,
): LegacyProjectCommands {
  const ownerId = text(normalizeObject(legacyProject.worktree).parentProjectId) ?? legacyProjectId;
  return (ownerId ? store[ownerId] : undefined) ?? { commands: [], deletedDefaultCommandIds: [], order: [] };
}

function normalizeLegacyProjectCommands(candidate: unknown): Record<string, LegacyProjectCommands> {
  if (!isRecord(candidate)) {
    return {};
  }
  const normalized: Record<string, LegacyProjectCommands> = {};
  for (const [projectId, value] of Object.entries(candidate)) {
    const trimmedProjectId = projectId.trim();
    if (!trimmedProjectId || !isRecord(value)) {
      continue;
    }
    normalized[trimmedProjectId] = {
      commands: normalizeObjectArray(value.commands),
      deletedDefaultCommandIds: normalizeStringArray(value.deletedDefaultCommandIds),
      order: normalizeStringArray(value.order),
    };
  }
  return normalized;
}

function normalizeLegacyGitConfig(values: Record<string, string | undefined>): JsonObject {
  return {
    confirmCommit: values[LEGACY_STORAGE_KEYS.gitConfirmCommit] === "true",
    generateCommitBody: values[LEGACY_STORAGE_KEYS.gitGenerateCommitBody] !== "false",
    primaryAction: values[LEGACY_STORAGE_KEYS.gitPrimaryAction] || "commit",
  };
}

function pickIdentityIcon(project: JsonObject): JsonObject {
  return compactObject({
    icon: project.icon,
    iconDataUrl: text(project.iconDataUrl),
    theme: text(project.theme),
    themeColor: text(project.themeColor),
  });
}

function pickLaunchSettings(settings: JsonObject): JsonObject {
  return pickSettings(settings, [
    "agentAcceptAllEnabled",
    "codeServerLinkVscodeUserConfig",
    "codeServerUseVscodeInsidersUserConfig",
    "customDefaultEditorCommand",
    "customPromptEditorCommand",
    "defaultEditorCommand",
    "defaultPromptAgentId",
    "promptEditorBackend",
    "sessionPersistenceProvider",
    "terminalEngine",
    "workspaceOpenTargetAvailability",
    "workspaceOpenTargetHiddenIds",
  ]);
}

function pickRuntimeSettings(settings: JsonObject): JsonObject {
  return pickSettings(settings, [
    "autoSleepAgentIdleMinutes",
    "autoSleepAgentSessionsEnabled",
    "autoSleepBrowserIdleMinutes",
    "autoSleepBrowserSessionsEnabled",
    "autoSleepCodeEditorEnabled",
    "autoSleepFocusedAgentSessions",
    "autoSleepGitEditorEnabled",
    "autoSleepProjectEditorEnabled",
    "autoSleepRequireAgentResumeCommand",
    "keepAwakeActivateOnLaunch",
    "keepAwakeDefaultDurationMinutes",
    "keepAwakePreventLidSleep",
    "sessionPersistenceProvider",
  ]);
}

function pickCompletionRules(settings: JsonObject): JsonObject {
  return pickSettings(settings, ["actionCompletionSound", "completionBellEnabled", "completionSound"]);
}

function pickAttentionRules(settings: JsonObject): JsonObject {
  return pickSettings(settings, [
    "hideFloatingSessionStatusIndicators",
    "hideMenuBarSessionStatusIndicators",
    "showMacOSAttentionNotifications",
  ]);
}

function pickNotificationRules(settings: JsonObject): JsonObject {
  return pickSettings(settings, ["showMacOSAttentionNotifications"]);
}

function pickSettings(settings: JsonObject, keys: readonly string[]): JsonObject {
  const picked: JsonObject = {};
  for (const key of keys) {
    if (settings[key] !== undefined) {
      picked[key] = settings[key];
    }
  }
  return picked;
}

function normalizeLegacyProvider(provider: unknown, tmuxSessionName: unknown): string | undefined {
  if (provider === "tmux" || provider === "zmx" || provider === "zellij") {
    return provider;
  }
  return typeof tmuxSessionName === "string" && tmuxSessionName.trim() ? "tmux" : undefined;
}

function exactTitle(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function nameFromPath(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, "").split("/").filter(Boolean).at(-1);
}

function parseJson(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeObject(value: unknown): JsonObject {
  return isRecord(value) ? { ...value } : {};
}

function normalizeObjectArray(value: unknown): JsonArray {
  return Array.isArray(value) ? value.filter(isRecord).map((item) => ({ ...item })) : [];
}

function normalizeStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function compactObject(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function stringifyJson(value: unknown): string {
  /*
  CDXC:GxserverMigration 2026-05-30-16:20:
  First-launch migration must not block gxserver startup when old macOS/sidebar records contain very large prompts, data URLs, copied logs, or malformed browser-adjacent blobs. Preserve normal legacy state exactly, but bound JSON columns so corrupt/oversized client-local data is marked and skipped instead of crashing the daemon with V8 string-size errors.
  */
  const normalized = value ?? {};
  try {
    const text = JSON.stringify(normalized);
    if (text.length <= MAX_MIGRATED_JSON_CHARS) {
      return text;
    }
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
  }
  return JSON.stringify(sanitizeMigratedJson(normalized, 0));
}

function sanitizeMigratedJson(value: unknown, depth: number): unknown {
  if (depth > MAX_MIGRATED_JSON_DEPTH) {
    return { gxserverMigrationOmitted: "maxDepth" };
  }
  if (typeof value === "string") {
    if (value.length <= MAX_MIGRATED_STRING_CHARS) {
      return value;
    }
    return `${value.slice(0, MAX_MIGRATED_STRING_CHARS)}...[gxserverMigrationTruncated ${value.length - MAX_MIGRATED_STRING_CHARS} chars]`;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_MIGRATED_ARRAY_ITEMS).map((item) => sanitizeMigratedJson(item, depth + 1));
    if (value.length > MAX_MIGRATED_ARRAY_ITEMS) {
      items.push({ gxserverMigrationOmitted: value.length - MAX_MIGRATED_ARRAY_ITEMS, reason: "maxArrayItems" });
    }
    return items;
  }
  const entries = Object.entries(value as JsonObject);
  const next: JsonObject = {};
  for (const [key, entry] of entries.slice(0, MAX_MIGRATED_OBJECT_KEYS)) {
    next[key] = sanitizeMigratedJson(entry, depth + 1);
  }
  if (entries.length > MAX_MIGRATED_OBJECT_KEYS) {
    next.gxserverMigrationOmitted = entries.length - MAX_MIGRATED_OBJECT_KEYS;
  }
  return next;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

type ProjectInsertRow = {
  attentionRulesJson: string;
  completionRulesJson: string;
  createdAt: string;
  customAgentOrderJson: string;
  customAgentsJson: string;
  customCommandOrderJson: string;
  customCommandsJson: string;
  defaultCommand: string | null;
  deletedDefaultCommandIdsJson: string;
  gitConfigJson: string;
  identityIconJson: string;
  isFavorite: 0 | 1;
  isPinned: 0 | 1;
  launchSettingsJson: string;
  name: string;
  notificationRulesJson: string;
  path: string | null;
  previousSessionHistoryJson: string;
  projectBoardConfigJson: string;
  projectId: GxserverProjectId;
  runtimeSettingsJson: string;
  updatedAt: string;
  worktreeJson: string;
};

type SessionInsertRow = {
  agentId: string | null;
  attentionRulesJson: string;
  commandId: string | null;
  completionRulesJson: string;
  createdAt: string;
  cwd: string | null;
  isFavorite: 0 | 1;
  isPinned: 0 | 1;
  kind: "agent" | "terminal";
  lastActiveAt: string | null;
  launchSettingsJson: string;
  lifecycleState: "running" | "sleeping";
  notificationRulesJson: string;
  projectId: GxserverProjectId;
  providerStateJson: string;
  restoredFromHistoryId: string | null;
  restoredFromSessionId: string | null;
  runtimeSettingsJson: string;
  sessionId: GxserverSessionId;
  title: string;
  updatedAt: string;
  worktreeJson: string;
  zmxName: string;
};

export type GxserverLegacyMacosStateMigrationStatus = NonNullable<
  GxserverMigrationStatus["stateImports"]
>["legacyMacosState"];
