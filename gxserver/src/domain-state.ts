import type Database from "better-sqlite3";
import {
  createGlobalSessionRef,
  createUniqueProjectId,
  createUniqueSessionId,
  createZmxSessionName,
  isGxserverProjectId,
  isGxserverSessionId,
  type GxserverCandidateFactory,
} from "./ids.js";
import { normalizeSessionTitleRuntimeSettings } from "./session-title/index.js";
import {
  normalizeSessionLaunchSettingsWithSurface,
  resolveSessionSurface,
} from "./session-presentation/index.js";
import type {
  GxserverCreateProjectParams,
  GxserverCreateSessionParams,
  GxserverDomainLifecycleState,
  GxserverProjectDomainState,
  GxserverProjectId,
  GxserverProviderLifecycleState,
  GxserverRemoveSessionParams,
  GxserverServerId,
  GxserverSessionDomainState,
  GxserverSessionId,
  GxserverSessionKind,
  GxserverSessionTag,
  GxserverUpdateProjectParams,
  GxserverUpdateSessionOrderParams,
  GxserverUpdateSessionParams,
  GxserverZmxSessionName,
} from "../protocol/index.js";

export interface GxserverDomainRepositoryOptions {
  createProjectId?: GxserverCandidateFactory<GxserverProjectId>;
  createSessionId?: GxserverCandidateFactory<GxserverSessionId>;
  now?: () => string;
}

type JsonObject = Record<string, unknown>;
type JsonArray = readonly JsonObject[];
type DomainJsonField =
  | "attentionRules"
  | "completionRules"
  | "customAgents"
  | "customCommands"
  | "gitConfig"
  | "identityIcon"
  | "launchSettings"
  | "notificationRules"
  | "previousSessionHistory"
  | "projectBoardConfig"
  | "providerState"
  | "runtimeSettings"
  | "worktree";
type GxserverCreateSessionDomainParams = GxserverCreateSessionParams & { projectId: GxserverProjectId };

export const GXSERVER_DOMAIN_STATE_JSON_LIMIT_CHARS = 1_000_000;
export const GXSERVER_DOMAIN_STATE_JSON_MAX_DEPTH = 10;

/*
CDXC:GxserverDomainState 2026-05-30-17:30:
The domain repository stores only state that must follow users across Ghostex clients: project/session identity, provider lifecycle metadata, launch/runtime-affecting settings, custom agents/commands, completion/attention rules, pinned/favorite flags, and hidden previous-session restore links. Visual layout, pane chrome, selected tab, and focus state stay out of gxserver tables and APIs because those are macOS current-window responsibilities after the ownership split.

CDXC:GxserverDomainState 2026-06-02-15:10:
The previous client-layout table/API idea was removed during the gxserver/native split. Do not reintroduce gxserver rows for pane/tab layout; keep that state in native current-window storage while gxserver owns only the shared project/session/worktree graph.

CDXC:GxserverDomainState 2026-05-30-20:20:
Project/session JSON blobs are shared durable state and appear in list/read responses, so create/update APIs must reject oversized or deeply nested runtimeSettings, previousSessionHistory, launchSettings, providerState, and related JSON columns before SQLite persistence. Use the same 1,000,000-character and depth-10 envelope as first-run migration, but reject live API writes instead of silently truncating user-owned state.

CDXC:GxserverDomainState 2026-05-30-20:25:
Corrupt persisted SQLite JSON columns must be surfaced as explicit corrupt-state errors on read and update. Do not normalize malformed or wrongly shaped project/session JSON to empty objects or arrays, because that hides persistence corruption and lets later updates overwrite recoverable user state with empty defaults.
*/
export class GxserverDomainRepository {
  readonly #createProjectId: GxserverCandidateFactory<GxserverProjectId>;
  readonly #createSessionId: GxserverCandidateFactory<GxserverSessionId>;
  readonly #db: Database.Database;
  readonly #now: () => string;
  readonly #serverId: GxserverServerId;

  constructor(db: Database.Database, serverId: GxserverServerId, options: GxserverDomainRepositoryOptions = {}) {
    this.#createProjectId = options.createProjectId ?? (() => createUniqueProjectId(this.#existingProjectIds()));
    this.#createSessionId = options.createSessionId ?? (() => createUniqueSessionId(new Set()));
    this.#db = db;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#serverId = serverId;
  }

  createProject(params: GxserverCreateProjectParams): GxserverProjectDomainState {
    return this.#db.transaction((input: GxserverCreateProjectParams) => {
      const projectId = createUniqueProjectId(this.#existingProjectIds(), this.#createProjectId);
      const createdAt = this.#now();
      const project = normalizeProjectInput(projectId, createdAt, input);
      this.#db
        .prepare(
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
        )
        .run(toProjectRow(project));
      this.#recordIdAllocation("project", "", projectId, createdAt);
      return project;
    })(params);
  }

  updateProject(params: GxserverUpdateProjectParams): GxserverProjectDomainState {
    return this.#db.transaction((input: GxserverUpdateProjectParams) => {
      const current = this.getProject(input.projectId);
      if (!current) {
        throw new GxserverDomainStateError("notFound", `Project ${input.projectId} does not exist.`);
      }
      const updatedAt = this.#now();
      const next = mergeProjectUpdate(current, updatedAt, input);
      this.#db
        .prepare(
          `UPDATE projects SET
            name = @name,
            path = @path,
            identityIconJson = @identityIconJson,
            isPinned = @isPinned,
            isFavorite = @isFavorite,
            defaultCommand = @defaultCommand,
            worktreeJson = @worktreeJson,
            customAgentsJson = @customAgentsJson,
            customAgentOrderJson = @customAgentOrderJson,
            customCommandsJson = @customCommandsJson,
            customCommandOrderJson = @customCommandOrderJson,
            deletedDefaultCommandIdsJson = @deletedDefaultCommandIdsJson,
            launchSettingsJson = @launchSettingsJson,
            runtimeSettingsJson = @runtimeSettingsJson,
            completionRulesJson = @completionRulesJson,
            attentionRulesJson = @attentionRulesJson,
            notificationRulesJson = @notificationRulesJson,
            gitConfigJson = @gitConfigJson,
            projectBoardConfigJson = @projectBoardConfigJson,
            previousSessionHistoryJson = @previousSessionHistoryJson,
            updatedAt = @updatedAt
          WHERE projectId = @projectId`,
        )
        .run(toProjectRow(next));
      return next;
    })(params);
  }

  listProjects(): GxserverProjectDomainState[] {
    return this.#db
      .prepare<[], ProjectRow>("SELECT * FROM projects ORDER BY updatedAt DESC, projectId ASC")
      .all()
      .map(fromProjectRow);
  }

  getProject(projectId: GxserverProjectId): GxserverProjectDomainState | undefined {
    const row = this.#db.prepare<[string], ProjectRow>("SELECT * FROM projects WHERE projectId = ?").get(projectId);
    return row ? fromProjectRow(row) : undefined;
  }

  removeProject(projectId: GxserverProjectId): GxserverProjectDomainState {
    return this.#db.transaction((id: GxserverProjectId) => {
      const current = this.getProject(id);
      if (!current) {
        throw new GxserverDomainStateError("notFound", `Project ${id} does not exist.`);
      }
      /*
      CDXC:ProjectSidebarOwnership 2026-06-02-08:24:
      Project removal is a shared gxserver mutation. Delete the canonical project row here and let SQLite cascade sessions so clients do not keep removing shared project inventory from macOS-only state.
      */
      this.#db.prepare("DELETE FROM projects WHERE projectId = ?").run(id);
      return current;
    })(projectId);
  }

  createSession(params: GxserverCreateSessionDomainParams): GxserverSessionDomainState {
    return this.#db.transaction((input: GxserverCreateSessionDomainParams) => {
      if (!this.getProject(input.projectId)) {
        throw new GxserverDomainStateError("notFound", `Project ${input.projectId} does not exist.`);
      }
      const sessionId = createUniqueSessionId(this.#existingSessionIds(input.projectId), () => {
        const candidate = this.#createSessionId();
        if (!isGxserverSessionId(candidate)) {
          throw new Error(`Generated invalid gxserver session ID: ${candidate}`);
        }
        return candidate;
      });
      const createdAt = this.#now();
      const session = normalizeSessionInput(this.#serverId, sessionId, createdAt, input);
      this.#db
        .prepare(
          `INSERT INTO sessions (
            projectId, sessionId, kind, title, lifecycleState, providerStateJson, zmxName, cwd,
            agentId, commandId, isPinned, isFavorite, sessionTag, restoredFromSessionId, restoredFromHistoryId,
            launchSettingsJson, runtimeSettingsJson, completionRulesJson, attentionRulesJson,
            notificationRulesJson, worktreeJson, createdAt, updatedAt, lastActiveAt, sidebarOrder
          ) VALUES (
            @projectId, @sessionId, @kind, @title, @lifecycleState, @providerStateJson, @zmxName, @cwd,
            @agentId, @commandId, @isPinned, @isFavorite, @sessionTag, @restoredFromSessionId, @restoredFromHistoryId,
            @launchSettingsJson, @runtimeSettingsJson, @completionRulesJson, @attentionRulesJson,
            @notificationRulesJson, @worktreeJson, @createdAt, @updatedAt, @lastActiveAt, @sidebarOrder
          )`,
        )
        .run(toSessionRow(session));
      this.#recordIdAllocation("session", input.projectId, sessionId, createdAt);
      return session;
    })(params);
  }

  updateSession(params: GxserverUpdateSessionParams): GxserverSessionDomainState {
    return this.#db.transaction((input: GxserverUpdateSessionParams) => {
      const current = this.getSession(input.projectId, input.sessionId);
      if (!current) {
        throw new GxserverDomainStateError("notFound", `Session ${input.projectId}/${input.sessionId} does not exist.`);
      }
      const updatedAt = this.#now();
      const next = mergeSessionUpdate(this.#serverId, current, updatedAt, input);
      this.#db
        .prepare(
          `UPDATE sessions SET
            kind = @kind,
            title = @title,
            lifecycleState = @lifecycleState,
            providerStateJson = @providerStateJson,
            zmxName = @zmxName,
            cwd = @cwd,
            agentId = @agentId,
            commandId = @commandId,
            isPinned = @isPinned,
            isFavorite = @isFavorite,
            sessionTag = @sessionTag,
            restoredFromSessionId = @restoredFromSessionId,
            restoredFromHistoryId = @restoredFromHistoryId,
            launchSettingsJson = @launchSettingsJson,
            runtimeSettingsJson = @runtimeSettingsJson,
            completionRulesJson = @completionRulesJson,
            attentionRulesJson = @attentionRulesJson,
            notificationRulesJson = @notificationRulesJson,
            worktreeJson = @worktreeJson,
            updatedAt = @updatedAt,
            lastActiveAt = @lastActiveAt,
            sidebarOrder = @sidebarOrder
          WHERE projectId = @projectId AND sessionId = @sessionId`,
        )
        .run(toSessionRow(next));
      return next;
    })(params);
  }

  updateSessionOrder(params: GxserverUpdateSessionOrderParams): GxserverSessionDomainState[] {
    return this.#db.transaction((input: GxserverUpdateSessionOrderParams) => {
      if (!this.getProject(input.projectId)) {
        throw new GxserverDomainStateError("notFound", `Project ${input.projectId} does not exist.`);
      }
      const sessionIds = normalizeSessionOrderIds(input.sessionIds);
      const updatedAt = this.#now();
      const updated: GxserverSessionDomainState[] = [];
      for (const [index, sessionId] of sessionIds.entries()) {
        const current = this.getSession(input.projectId, sessionId);
        if (!current) {
          throw new GxserverDomainStateError(
            "notFound",
            `Session ${input.projectId}/${sessionId} does not exist.`,
          );
        }
        const next = mergeSessionUpdate(this.#serverId, current, updatedAt, {
          projectId: input.projectId,
          sessionId,
          sidebarOrder: (index + 1) * 1000,
        });
        this.#db
          .prepare(
            `UPDATE sessions SET
              kind = @kind,
              title = @title,
              lifecycleState = @lifecycleState,
              providerStateJson = @providerStateJson,
              zmxName = @zmxName,
              cwd = @cwd,
              agentId = @agentId,
              commandId = @commandId,
              isPinned = @isPinned,
              isFavorite = @isFavorite,
              sessionTag = @sessionTag,
              restoredFromSessionId = @restoredFromSessionId,
              restoredFromHistoryId = @restoredFromHistoryId,
              launchSettingsJson = @launchSettingsJson,
              runtimeSettingsJson = @runtimeSettingsJson,
              completionRulesJson = @completionRulesJson,
              attentionRulesJson = @attentionRulesJson,
              notificationRulesJson = @notificationRulesJson,
              worktreeJson = @worktreeJson,
              updatedAt = @updatedAt,
              lastActiveAt = @lastActiveAt,
              sidebarOrder = @sidebarOrder
            WHERE projectId = @projectId AND sessionId = @sessionId`,
          )
          .run(toSessionRow(next));
        updated.push(next);
      }
      return updated;
    })(params);
  }

  listSessions(projectId?: GxserverProjectId): GxserverSessionDomainState[] {
    const rows = projectId
      ? this.#db
          .prepare<[string], SessionRow>("SELECT * FROM sessions WHERE projectId = ? ORDER BY updatedAt DESC, sessionId ASC")
          .all(projectId)
      : this.#db.prepare<[], SessionRow>("SELECT * FROM sessions ORDER BY updatedAt DESC, projectId ASC, sessionId ASC").all();
    return rows.map((row) => fromSessionRow(this.#serverId, row));
  }

  getSession(projectId: GxserverProjectId, sessionId: GxserverSessionId): GxserverSessionDomainState | undefined {
    const row = this.#db
      .prepare<[string, string], SessionRow>("SELECT * FROM sessions WHERE projectId = ? AND sessionId = ?")
      .get(projectId, sessionId);
    return row ? fromSessionRow(this.#serverId, row) : undefined;
  }

  removeSession(params: GxserverRemoveSessionParams): GxserverSessionDomainState {
    return this.#db.transaction((input: GxserverRemoveSessionParams) => {
      const current = this.getSession(input.projectId, input.sessionId);
      if (!current) {
        throw new GxserverDomainStateError(
          "notFound",
          `Session ${input.projectId}/${input.sessionId} does not exist.`,
        );
      }
      /*
      CDXC:PreviousSessions 2026-06-02-11:24:
      Previous-session rows are gxserver-owned stopped session records after the cutover. Delete them from the domain repository so modal delete/restore cleanup cannot keep a native-only hidden history list that reappears on the next gxserver query.
      */
      this.#db
        .prepare("DELETE FROM sessions WHERE projectId = ? AND sessionId = ?")
        .run(input.projectId, input.sessionId);
      return current;
    })(params);
  }

  #existingProjectIds(): ReadonlySet<string> {
    return new Set(
      this.#db
        .prepare<[], { id: string }>(
          "SELECT projectId AS id FROM projects UNION SELECT id FROM id_allocations WHERE kind = 'project'",
        )
        .all()
        .map((row) => row.id),
    );
  }

  #existingSessionIds(projectId: GxserverProjectId): ReadonlySet<string> {
    return new Set(
      this.#db
        .prepare<[string, string], { id: string }>(
          "SELECT sessionId AS id FROM sessions WHERE projectId = ? UNION SELECT id FROM id_allocations WHERE kind = 'session' AND parentId = ?",
        )
        .all(projectId, projectId)
        .map((row) => row.id),
    );
  }

  #recordIdAllocation(kind: "project" | "session", parentId: string, id: string, createdAt: string): void {
    this.#db
      .prepare("INSERT OR IGNORE INTO id_allocations (id, kind, parentId, createdAt) VALUES (?, ?, ?, ?)")
      .run(id, kind, parentId, createdAt);
  }
}

export class GxserverDomainStateError extends Error {
  readonly code: "badRequest" | "corruptState" | "notFound";

  constructor(code: "badRequest" | "corruptState" | "notFound", message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeProjectInput(
  projectId: GxserverProjectId,
  timestamp: string,
  input: GxserverCreateProjectParams,
): GxserverProjectDomainState {
  return {
    attentionRules: normalizeObject(input.attentionRules),
    completionRules: normalizeObject(input.completionRules),
    createdAt: timestamp,
    customAgentOrder: normalizeStringArray(input.customAgentOrder),
    customAgents: normalizeObjectArray(input.customAgents),
    customCommandOrder: normalizeStringArray(input.customCommandOrder),
    customCommands: normalizeObjectArray(input.customCommands),
    defaultCommand: normalizeOptionalText(input.defaultCommand),
    deletedDefaultCommandIds: normalizeStringArray(input.deletedDefaultCommandIds),
    gitConfig: normalizeObject(input.gitConfig),
    identityIcon: normalizeOptionalObject(input.identityIcon),
    isFavorite: input.isFavorite === true,
    isPinned: input.isPinned === true,
    launchSettings: normalizeObject(input.launchSettings),
    name: normalizeRequiredText(input.name, "name"),
    notificationRules: normalizeObject(input.notificationRules),
    path: normalizeOptionalText(input.path),
    previousSessionHistory: normalizeObjectArray(input.previousSessionHistory),
    projectBoardConfig: normalizeObject(input.projectBoardConfig),
    projectId,
    runtimeSettings: normalizeObject(input.runtimeSettings),
    updatedAt: timestamp,
    worktree: normalizeOptionalObject(input.worktree),
  };
}

function mergeProjectUpdate(
  current: GxserverProjectDomainState,
  updatedAt: string,
  input: GxserverUpdateProjectParams,
): GxserverProjectDomainState {
  return {
    ...current,
    attentionRules: hasOwn(input, "attentionRules") ? normalizeObject(input.attentionRules) : current.attentionRules,
    completionRules: hasOwn(input, "completionRules") ? normalizeObject(input.completionRules) : current.completionRules,
    customAgentOrder: hasOwn(input, "customAgentOrder") ? normalizeStringArray(input.customAgentOrder) : current.customAgentOrder,
    customAgents: hasOwn(input, "customAgents") ? normalizeObjectArray(input.customAgents) : current.customAgents,
    customCommandOrder: hasOwn(input, "customCommandOrder") ? normalizeStringArray(input.customCommandOrder) : current.customCommandOrder,
    customCommands: hasOwn(input, "customCommands") ? normalizeObjectArray(input.customCommands) : current.customCommands,
    defaultCommand: hasOwn(input, "defaultCommand") ? normalizeOptionalText(input.defaultCommand) : current.defaultCommand,
    deletedDefaultCommandIds: hasOwn(input, "deletedDefaultCommandIds")
      ? normalizeStringArray(input.deletedDefaultCommandIds)
      : current.deletedDefaultCommandIds,
    gitConfig: hasOwn(input, "gitConfig") ? normalizeObject(input.gitConfig) : current.gitConfig,
    identityIcon: hasOwn(input, "identityIcon") ? normalizeOptionalObject(input.identityIcon) : current.identityIcon,
    isFavorite: hasOwn(input, "isFavorite") ? input.isFavorite === true : current.isFavorite,
    isPinned: hasOwn(input, "isPinned") ? input.isPinned === true : current.isPinned,
    launchSettings: hasOwn(input, "launchSettings") ? normalizeObject(input.launchSettings) : current.launchSettings,
    name: hasOwn(input, "name") ? normalizeRequiredText(input.name, "name") : current.name,
    notificationRules: hasOwn(input, "notificationRules") ? normalizeObject(input.notificationRules) : current.notificationRules,
    path: hasOwn(input, "path") ? normalizeOptionalText(input.path) : current.path,
    previousSessionHistory: hasOwn(input, "previousSessionHistory")
      ? normalizeObjectArray(input.previousSessionHistory)
      : current.previousSessionHistory,
    projectBoardConfig: hasOwn(input, "projectBoardConfig") ? normalizeObject(input.projectBoardConfig) : current.projectBoardConfig,
    runtimeSettings: hasOwn(input, "runtimeSettings") ? normalizeObject(input.runtimeSettings) : current.runtimeSettings,
    updatedAt,
    worktree: hasOwn(input, "worktree") ? normalizeOptionalObject(input.worktree) : current.worktree,
  };
}

function normalizeSessionInput(
  serverId: GxserverServerId,
  sessionId: GxserverSessionId,
  timestamp: string,
  input: GxserverCreateSessionDomainParams,
): GxserverSessionDomainState {
  const zmxName = createZmxSessionName(serverId, input.projectId, sessionId);
  const inputProviderState = normalizeObject(input.providerState);
  const runtimeSettings = normalizeSessionTitleRuntimeSettings(input.runtimeSettings, input.title);
  const launchSettings = normalizeSessionLaunchSettingsWithSurface(normalizeObject(input.launchSettings), input.surface);
  const sessionTag = normalizeOptionalSessionTag(input.sessionTag);
  const providerState = {
    lifecycleState: normalizeProviderLifecycleState(input.providerState?.lifecycleState),
    ...inputProviderState,
    zmxName,
  };
  return {
    agentId: normalizeOptionalText(input.agentId),
    attentionRules: normalizeObject(input.attentionRules),
    commandId: normalizeOptionalText(input.commandId),
    completionRules: normalizeObject(input.completionRules),
    createdAt: timestamp,
    cwd: normalizeOptionalText(input.cwd),
    globalRef: createGlobalSessionRef(serverId, input.projectId, sessionId),
    hiddenMetadata: {
      restoredFromHistoryId: normalizeOptionalText(input.restoredFromHistoryId),
      restoredFromSessionId: normalizeSessionRestoreId(input.restoredFromSessionId),
    },
    isFavorite: sessionTag ? sessionTag === "favorite" : input.isFavorite === true,
    isPinned: input.isPinned === true,
    kind: normalizeSessionKind(input.kind),
    lastActiveAt: normalizeOptionalText(input.lastActiveAt),
    launchSettings,
    lifecycleState: normalizeDomainLifecycleState(input.lifecycleState),
    notificationRules: normalizeObject(input.notificationRules),
    projectId: input.projectId,
    providerState,
    runtimeSettings,
    sessionId,
    ...(sessionTag ? { sessionTag } : {}),
    sidebarOrder: normalizeOptionalSidebarOrder(input.sidebarOrder) ?? 0,
    surface: resolveSessionSurface({ launchSettings, runtimeSettings, surface: input.surface }),
    title: normalizeOptionalText(input.title) ?? sessionId,
    updatedAt: timestamp,
    worktree: normalizeOptionalObject(input.worktree),
    zmxName,
  };
}

function mergeSessionUpdate(
  serverId: GxserverServerId,
  current: GxserverSessionDomainState,
  updatedAt: string,
  input: GxserverUpdateSessionParams,
): GxserverSessionDomainState {
  const zmxName = createZmxSessionName(serverId, current.projectId, current.sessionId);
  const inputProviderState = normalizeObject(input.providerState);
  const runtimeSettings = hasOwn(input, "runtimeSettings")
    ? normalizeSessionTitleRuntimeSettings(input.runtimeSettings, input.title ?? current.title)
    : current.runtimeSettings;
  const launchSettings = hasOwn(input, "launchSettings") || hasOwn(input, "surface")
    ? normalizeSessionLaunchSettingsWithSurface(
        hasOwn(input, "launchSettings") ? normalizeObject(input.launchSettings) : current.launchSettings,
        hasOwn(input, "surface") ? input.surface : undefined,
      )
    : current.launchSettings;
  const sessionTag = hasOwn(input, "sessionTag")
    ? normalizeOptionalSessionTag(input.sessionTag)
    : hasOwn(input, "isFavorite")
      ? input.isFavorite === true
        ? "favorite"
        : undefined
      : current.sessionTag;
  return {
    ...current,
    agentId: hasOwn(input, "agentId") ? normalizeOptionalText(input.agentId) : current.agentId,
    attentionRules: hasOwn(input, "attentionRules") ? normalizeObject(input.attentionRules) : current.attentionRules,
    commandId: hasOwn(input, "commandId") ? normalizeOptionalText(input.commandId) : current.commandId,
    completionRules: hasOwn(input, "completionRules") ? normalizeObject(input.completionRules) : current.completionRules,
    cwd: hasOwn(input, "cwd") ? normalizeOptionalText(input.cwd) : current.cwd,
    globalRef: createGlobalSessionRef(serverId, current.projectId, current.sessionId),
    hiddenMetadata: {
      restoredFromHistoryId: hasOwn(input, "restoredFromHistoryId")
        ? normalizeOptionalText(input.restoredFromHistoryId)
        : current.hiddenMetadata.restoredFromHistoryId,
      restoredFromSessionId: hasOwn(input, "restoredFromSessionId")
        ? normalizeSessionRestoreId(input.restoredFromSessionId)
        : current.hiddenMetadata.restoredFromSessionId,
    },
    isFavorite: sessionTag ? sessionTag === "favorite" : false,
    isPinned: hasOwn(input, "isPinned") ? input.isPinned === true : current.isPinned,
    kind: hasOwn(input, "kind") ? normalizeSessionKind(input.kind) : current.kind,
    lastActiveAt: hasOwn(input, "lastActiveAt") ? normalizeOptionalText(input.lastActiveAt) : current.lastActiveAt,
    launchSettings,
    lifecycleState: hasOwn(input, "lifecycleState")
      ? normalizeDomainLifecycleState(input.lifecycleState)
      : current.lifecycleState,
    notificationRules: hasOwn(input, "notificationRules") ? normalizeObject(input.notificationRules) : current.notificationRules,
    providerState: hasOwn(input, "providerState")
      ? {
          ...inputProviderState,
          lifecycleState: normalizeProviderLifecycleState(input.providerState?.lifecycleState),
          zmxName,
        }
      : { ...current.providerState, zmxName },
    runtimeSettings,
    ...(sessionTag ? { sessionTag } : { sessionTag: undefined }),
    sidebarOrder: hasOwn(input, "sidebarOrder")
      ? normalizeOptionalSidebarOrder(input.sidebarOrder)
      : current.sidebarOrder,
    surface: resolveSessionSurface({
      launchSettings,
      runtimeSettings,
      surface: hasOwn(input, "surface") ? input.surface : undefined,
    }),
    title: hasOwn(input, "title") ? normalizeOptionalText(input.title) ?? current.sessionId : current.title,
    updatedAt,
    worktree: hasOwn(input, "worktree") ? normalizeOptionalObject(input.worktree) : current.worktree,
    zmxName,
  };
}

interface ProjectRow {
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
  projectId: string;
  runtimeSettingsJson: string;
  updatedAt: string;
  worktreeJson: string;
}

interface SessionRow {
  agentId: string | null;
  attentionRulesJson: string;
  commandId: string | null;
  completionRulesJson: string;
  createdAt: string;
  cwd: string | null;
  isFavorite: 0 | 1;
  isPinned: 0 | 1;
  kind: string;
  lastActiveAt: string | null;
  launchSettingsJson: string;
  lifecycleState: string;
  notificationRulesJson: string;
  projectId: string;
  providerStateJson: string;
  restoredFromHistoryId: string | null;
  restoredFromSessionId: string | null;
  runtimeSettingsJson: string;
  sessionId: string;
  sessionTag: string | null;
  sidebarOrder: number | null;
  title: string;
  updatedAt: string;
  worktreeJson: string;
  zmxName: string;
}

function toProjectRow(project: GxserverProjectDomainState): ProjectRow {
  return {
    attentionRulesJson: stringifyDomainJsonField("attentionRules", project.attentionRules),
    completionRulesJson: stringifyDomainJsonField("completionRules", project.completionRules),
    createdAt: project.createdAt,
    customAgentOrderJson: stringifyJson(project.customAgentOrder),
    customAgentsJson: stringifyDomainJsonField("customAgents", project.customAgents),
    customCommandOrderJson: stringifyJson(project.customCommandOrder),
    customCommandsJson: stringifyDomainJsonField("customCommands", project.customCommands),
    defaultCommand: project.defaultCommand ?? null,
    deletedDefaultCommandIdsJson: stringifyJson(project.deletedDefaultCommandIds),
    gitConfigJson: stringifyDomainJsonField("gitConfig", project.gitConfig),
    identityIconJson: stringifyDomainJsonField("identityIcon", project.identityIcon ?? {}),
    isFavorite: project.isFavorite ? 1 : 0,
    isPinned: project.isPinned ? 1 : 0,
    launchSettingsJson: stringifyDomainJsonField("launchSettings", project.launchSettings),
    name: project.name,
    notificationRulesJson: stringifyDomainJsonField("notificationRules", project.notificationRules),
    path: project.path ?? null,
    previousSessionHistoryJson: stringifyDomainJsonField("previousSessionHistory", project.previousSessionHistory),
    projectBoardConfigJson: stringifyDomainJsonField("projectBoardConfig", project.projectBoardConfig),
    projectId: project.projectId,
    runtimeSettingsJson: stringifyDomainJsonField("runtimeSettings", project.runtimeSettings),
    updatedAt: project.updatedAt,
    worktreeJson: stringifyDomainJsonField("worktree", project.worktree ?? {}),
  };
}

function fromProjectRow(row: ProjectRow): GxserverProjectDomainState {
  const rowId = row.projectId;
  const identityIcon = parseObject(row.identityIconJson, "identityIconJson", "project", rowId);
  const worktree = parseObject(row.worktreeJson, "worktreeJson", "project", rowId);
  return {
    attentionRules: parseObject(row.attentionRulesJson, "attentionRulesJson", "project", rowId),
    completionRules: parseObject(row.completionRulesJson, "completionRulesJson", "project", rowId),
    createdAt: row.createdAt,
    customAgentOrder: parseStringArray(row.customAgentOrderJson, "customAgentOrderJson", "project", rowId),
    customAgents: parseObjectArray(row.customAgentsJson, "customAgentsJson", "project", rowId),
    customCommandOrder: parseStringArray(row.customCommandOrderJson, "customCommandOrderJson", "project", rowId),
    customCommands: parseObjectArray(row.customCommandsJson, "customCommandsJson", "project", rowId),
    defaultCommand: row.defaultCommand ?? undefined,
    deletedDefaultCommandIds: parseStringArray(
      row.deletedDefaultCommandIdsJson,
      "deletedDefaultCommandIdsJson",
      "project",
      rowId,
    ),
    gitConfig: parseObject(row.gitConfigJson, "gitConfigJson", "project", rowId),
    ...(Object.keys(identityIcon).length > 0 ? { identityIcon } : {}),
    isFavorite: row.isFavorite === 1,
    isPinned: row.isPinned === 1,
    launchSettings: parseObject(row.launchSettingsJson, "launchSettingsJson", "project", rowId),
    name: row.name,
    notificationRules: parseObject(row.notificationRulesJson, "notificationRulesJson", "project", rowId),
    path: row.path ?? undefined,
    previousSessionHistory: parseObjectArray(
      row.previousSessionHistoryJson,
      "previousSessionHistoryJson",
      "project",
      rowId,
    ),
    projectBoardConfig: parseObject(row.projectBoardConfigJson, "projectBoardConfigJson", "project", rowId),
    projectId: row.projectId as GxserverProjectId,
    runtimeSettings: parseObject(row.runtimeSettingsJson, "runtimeSettingsJson", "project", rowId),
    updatedAt: row.updatedAt,
    ...(Object.keys(worktree).length > 0 ? { worktree } : {}),
  };
}

function toSessionRow(session: GxserverSessionDomainState): SessionRow {
  return {
    agentId: session.agentId ?? null,
    attentionRulesJson: stringifyDomainJsonField("attentionRules", session.attentionRules),
    commandId: session.commandId ?? null,
    completionRulesJson: stringifyDomainJsonField("completionRules", session.completionRules),
    createdAt: session.createdAt,
    cwd: session.cwd ?? null,
    isFavorite: session.isFavorite ? 1 : 0,
    isPinned: session.isPinned ? 1 : 0,
    kind: session.kind,
    lastActiveAt: session.lastActiveAt ?? null,
    launchSettingsJson: stringifyDomainJsonField("launchSettings", session.launchSettings),
    lifecycleState: session.lifecycleState,
    notificationRulesJson: stringifyDomainJsonField("notificationRules", session.notificationRules),
    projectId: session.projectId,
    providerStateJson: stringifyDomainJsonField("providerState", session.providerState),
    restoredFromHistoryId: session.hiddenMetadata.restoredFromHistoryId ?? null,
    restoredFromSessionId: session.hiddenMetadata.restoredFromSessionId ?? null,
    runtimeSettingsJson: stringifyDomainJsonField("runtimeSettings", session.runtimeSettings),
    sessionId: session.sessionId,
    sessionTag: session.sessionTag ?? null,
    sidebarOrder: session.sidebarOrder ?? null,
    title: session.title,
    updatedAt: session.updatedAt,
    worktreeJson: stringifyDomainJsonField("worktree", session.worktree ?? {}),
    zmxName: session.zmxName,
  };
}

function fromSessionRow(serverId: GxserverServerId, row: SessionRow): GxserverSessionDomainState {
  const projectId = row.projectId as GxserverProjectId;
  const sessionId = row.sessionId as GxserverSessionId;
  const rowId = `${row.projectId}/${row.sessionId}`;
  const zmxName = createZmxSessionName(serverId, projectId, sessionId);
  const providerState: JsonObject = parseObject(row.providerStateJson, "providerStateJson", "session", rowId);
  const worktree = parseObject(row.worktreeJson, "worktreeJson", "session", rowId);
  const launchSettings = parseObject(row.launchSettingsJson, "launchSettingsJson", "session", rowId);
  const runtimeSettings = parseObject(row.runtimeSettingsJson, "runtimeSettingsJson", "session", rowId);
  return {
    agentId: row.agentId ?? undefined,
    attentionRules: parseObject(row.attentionRulesJson, "attentionRulesJson", "session", rowId),
    commandId: row.commandId ?? undefined,
    completionRules: parseObject(row.completionRulesJson, "completionRulesJson", "session", rowId),
    createdAt: row.createdAt,
    cwd: row.cwd ?? undefined,
    globalRef: createGlobalSessionRef(serverId, projectId, sessionId),
    hiddenMetadata: {
      restoredFromHistoryId: row.restoredFromHistoryId ?? undefined,
      restoredFromSessionId: row.restoredFromSessionId ? (row.restoredFromSessionId as GxserverSessionId) : undefined,
    },
    isFavorite: normalizeOptionalSessionTag(row.sessionTag) === "favorite" || row.isFavorite === 1,
    isPinned: row.isPinned === 1,
    kind: normalizeSessionKind(row.kind),
    lastActiveAt: row.lastActiveAt ?? undefined,
    launchSettings,
    lifecycleState: normalizeDomainLifecycleState(row.lifecycleState),
    notificationRules: parseObject(row.notificationRulesJson, "notificationRulesJson", "session", rowId),
    projectId,
    providerState: {
      ...providerState,
      lifecycleState: normalizeProviderLifecycleState(providerState.lifecycleState),
      zmxName,
    },
    runtimeSettings,
    sessionId,
    ...(normalizeOptionalSessionTag(row.sessionTag) ?? (row.isFavorite === 1 ? "favorite" : undefined)
      ? { sessionTag: normalizeOptionalSessionTag(row.sessionTag) ?? "favorite" }
      : {}),
    ...(typeof row.sidebarOrder === "number" && Number.isFinite(row.sidebarOrder)
      ? { sidebarOrder: row.sidebarOrder }
      : {}),
    surface: resolveSessionSurface({ launchSettings, runtimeSettings }),
    title: row.title,
    updatedAt: row.updatedAt,
    ...(Object.keys(worktree).length > 0 ? { worktree } : {}),
    zmxName,
  };
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GxserverDomainStateError("badRequest", `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

function normalizeOptionalObject(value: unknown): JsonObject | undefined {
  const normalized = normalizeObject(value);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeObjectArray(value: unknown): JsonArray {
  return Array.isArray(value) ? value.filter(isRecord).map((item) => ({ ...item })) : [];
}

function normalizeStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function normalizeSessionOrderIds(value: unknown): readonly GxserverSessionId[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new GxserverDomainStateError("badRequest", "sessionIds must contain at least one session ID.");
  }
  const seen = new Set<string>();
  const sessionIds: GxserverSessionId[] = [];
  for (const item of value) {
    if (!isGxserverSessionId(item)) {
      throw new GxserverDomainStateError("badRequest", `Invalid sessionId: ${String(item)}.`);
    }
    if (seen.has(item)) {
      throw new GxserverDomainStateError("badRequest", `Duplicate sessionId: ${String(item)}.`);
    }
    seen.add(item);
    sessionIds.push(item);
  }
  return sessionIds;
}

function normalizeOptionalSidebarOrder(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function normalizeOptionalSessionTag(value: unknown): GxserverSessionTag | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (
    value === "favorite" ||
    value === "high-priority" ||
    value === "research" ||
    value === "todo" ||
    value === "in-progress" ||
    value === "testing" ||
    value === "blocked" ||
    value === "low-priority" ||
    value === "on-hold" ||
    value === "done" ||
    value === "bug" ||
    value === "feature" ||
    value === "design"
  ) {
    return value;
  }

  throw new GxserverDomainStateError("badRequest", "sessionTag must be a supported session tag.");
}

function normalizeSessionKind(value: unknown): GxserverSessionKind {
  return value === "agent" ? "agent" : "terminal";
}

function normalizeDomainLifecycleState(value: unknown): GxserverDomainLifecycleState {
  return value === "running" || value === "sleeping" || value === "stopped" || value === "missing" || value === "unknown"
    ? value
    : "unknown";
}

function normalizeProviderLifecycleState(value: unknown): GxserverProviderLifecycleState {
  return value === "exists" || value === "missing" || value === "unknown" ? value : "unknown";
}

function normalizeSessionRestoreId(value: unknown): GxserverSessionId | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (!isGxserverSessionId(value)) {
    throw new GxserverDomainStateError("badRequest", `Invalid restoredFromSessionId: ${String(value)}.`);
  }
  return value;
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function stringifyDomainJsonField(field: DomainJsonField, value: unknown): string {
  const normalized = value ?? {};
  assertDomainJsonDepth(field, normalized, 0, new WeakSet<object>());
  let text: string;
  try {
    text = JSON.stringify(normalized);
  } catch {
    throw new GxserverDomainStateError("badRequest", `${field} must be JSON-serializable.`);
  }
  if (text.length > GXSERVER_DOMAIN_STATE_JSON_LIMIT_CHARS) {
    throw new GxserverDomainStateError(
      "badRequest",
      `${field} exceeds the gxserver domain-state JSON size limit of ${GXSERVER_DOMAIN_STATE_JSON_LIMIT_CHARS} characters.`,
    );
  }
  return text;
}

function assertDomainJsonDepth(field: DomainJsonField, value: unknown, depth: number, seen: WeakSet<object>): void {
  if (depth > GXSERVER_DOMAIN_STATE_JSON_MAX_DEPTH) {
    throw new GxserverDomainStateError(
      "badRequest",
      `${field} exceeds the gxserver domain-state JSON depth limit of ${GXSERVER_DOMAIN_STATE_JSON_MAX_DEPTH}.`,
    );
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throw new GxserverDomainStateError("badRequest", `${field} must be JSON-serializable.`);
  }
  seen.add(objectValue);
  try {
    const children = Array.isArray(value) ? value : Object.values(value as JsonObject);
    for (const child of children) {
      assertDomainJsonDepth(field, child, depth + 1, seen);
    }
  } finally {
    seen.delete(objectValue);
  }
}

function parseObject(value: string, column: string, rowKind: "project" | "session", rowId: string): JsonObject {
  const parsed = parseJsonColumn(value, column, rowKind, rowId);
  if (!isRecord(parsed)) {
    throw corruptJsonColumn(column, rowKind, rowId, "expected a JSON object");
  }
  return { ...parsed };
}

function parseObjectArray(value: string, column: string, rowKind: "project" | "session", rowId: string): JsonArray {
  const parsed = parseJsonColumn(value, column, rowKind, rowId);
  if (!Array.isArray(parsed)) {
    throw corruptJsonColumn(column, rowKind, rowId, "expected a JSON array of objects");
  }
  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw corruptJsonColumn(column, rowKind, rowId, `expected object at array index ${index}`);
    }
    return { ...item };
  });
}

function parseStringArray(value: string, column: string, rowKind: "project", rowId: string): readonly string[] {
  const parsed = parseJsonColumn(value, column, rowKind, rowId);
  if (!Array.isArray(parsed)) {
    throw corruptJsonColumn(column, rowKind, rowId, "expected a JSON array of strings");
  }
  return parsed.map((item, index) => {
    if (typeof item !== "string") {
      throw corruptJsonColumn(column, rowKind, rowId, `expected string at array index ${index}`);
    }
    const trimmed = item.trim();
    if (!trimmed) {
      throw corruptJsonColumn(column, rowKind, rowId, `expected non-empty string at array index ${index}`);
    }
    return trimmed;
  });
}

function parseJsonColumn(
  value: string,
  column: string,
  rowKind: "project" | "session",
  rowId: string,
): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw corruptJsonColumn(column, rowKind, rowId, `invalid JSON (${message})`);
  }
}

function corruptJsonColumn(
  column: string,
  rowKind: "project" | "session",
  rowId: string,
  detail: string,
): GxserverDomainStateError {
  return new GxserverDomainStateError(
    "corruptState",
    `Corrupt gxserver domain-state JSON in ${rowKind} ${rowId} column ${column}: ${detail}. Refusing to read or update the row so persisted state is not overwritten.`,
  );
}
