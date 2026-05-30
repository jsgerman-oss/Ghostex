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
import type {
  GxserverClientLayoutState,
  GxserverCreateProjectParams,
  GxserverCreateSessionParams,
  GxserverDomainLifecycleState,
  GxserverProjectDomainState,
  GxserverProjectId,
  GxserverProviderLifecycleState,
  GxserverServerId,
  GxserverSessionDomainState,
  GxserverSessionId,
  GxserverSessionKind,
  GxserverUpdateProjectParams,
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

/*
CDXC:GxserverDomainState 2026-05-30-17:30:
The domain repository stores only state that must follow users across Ghostex clients: project/session identity, provider lifecycle metadata, launch/runtime-affecting settings, custom agents/commands, completion/attention rules, pinned/favorite flags, and hidden previous-session restore links. Visual layout and pane chrome stay in separate client-layout rows so normal UI state cannot corrupt shared records.
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

  createSession(params: GxserverCreateSessionParams): GxserverSessionDomainState {
    return this.#db.transaction((input: GxserverCreateSessionParams) => {
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
            agentId, commandId, isPinned, isFavorite, restoredFromSessionId, restoredFromHistoryId,
            launchSettingsJson, runtimeSettingsJson, completionRulesJson, attentionRulesJson,
            notificationRulesJson, worktreeJson, createdAt, updatedAt, lastActiveAt
          ) VALUES (
            @projectId, @sessionId, @kind, @title, @lifecycleState, @providerStateJson, @zmxName, @cwd,
            @agentId, @commandId, @isPinned, @isFavorite, @restoredFromSessionId, @restoredFromHistoryId,
            @launchSettingsJson, @runtimeSettingsJson, @completionRulesJson, @attentionRulesJson,
            @notificationRulesJson, @worktreeJson, @createdAt, @updatedAt, @lastActiveAt
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
            restoredFromSessionId = @restoredFromSessionId,
            restoredFromHistoryId = @restoredFromHistoryId,
            launchSettingsJson = @launchSettingsJson,
            runtimeSettingsJson = @runtimeSettingsJson,
            completionRulesJson = @completionRulesJson,
            attentionRulesJson = @attentionRulesJson,
            notificationRulesJson = @notificationRulesJson,
            worktreeJson = @worktreeJson,
            updatedAt = @updatedAt,
            lastActiveAt = @lastActiveAt
          WHERE projectId = @projectId AND sessionId = @sessionId`,
        )
        .run(toSessionRow(next));
      return next;
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

  updateClientLayout(input: { clientId: string; layout: JsonObject; projectId?: GxserverProjectId }): GxserverClientLayoutState {
    const clientId = normalizeRequiredText(input.clientId, "clientId");
    const projectId = input.projectId;
    if (projectId !== undefined && !isGxserverProjectId(projectId)) {
      throw new GxserverDomainStateError("badRequest", `Invalid gxserver project ID: ${String(projectId)}.`);
    }
    const layout = normalizeObject(input.layout);
    const updatedAt = this.#now();
    this.#db
      .prepare(
        `INSERT INTO client_layouts (clientId, projectId, layoutJson, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(clientId, projectId) DO UPDATE SET layoutJson = excluded.layoutJson, updatedAt = excluded.updatedAt`,
      )
      .run(clientId, projectId ?? "", stringifyJson(layout), updatedAt);
    return { clientId, layout, ...(projectId ? { projectId } : {}), updatedAt };
  }

  readClientLayout(input: { clientId: string; projectId?: GxserverProjectId }): GxserverClientLayoutState | undefined {
    const clientId = normalizeRequiredText(input.clientId, "clientId");
    const projectId = input.projectId;
    if (projectId !== undefined && !isGxserverProjectId(projectId)) {
      throw new GxserverDomainStateError("badRequest", `Invalid gxserver project ID: ${String(projectId)}.`);
    }
    const row = this.#db
      .prepare<[string, string], ClientLayoutRow>("SELECT * FROM client_layouts WHERE clientId = ? AND projectId = ?")
      .get(clientId, projectId ?? "");
    return row
      ? {
          clientId: row.clientId,
          layout: parseObject(row.layoutJson),
          ...(row.projectId ? { projectId: row.projectId as GxserverProjectId } : {}),
          updatedAt: row.updatedAt,
        }
      : undefined;
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
  readonly code: "badRequest" | "notFound";

  constructor(code: "badRequest" | "notFound", message: string) {
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
  input: GxserverCreateSessionParams,
): GxserverSessionDomainState {
  const zmxName = createZmxSessionName(input.projectId, sessionId);
  const inputProviderState = normalizeObject(input.providerState);
  const providerState = {
    lifecycleState: normalizeProviderLifecycleState(input.providerState?.lifecycleState),
    ...inputProviderState,
    zmxName: normalizeProviderZmxName(inputProviderState.zmxName, zmxName),
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
    isFavorite: input.isFavorite === true,
    isPinned: input.isPinned === true,
    kind: normalizeSessionKind(input.kind),
    lastActiveAt: normalizeOptionalText(input.lastActiveAt),
    launchSettings: normalizeObject(input.launchSettings),
    lifecycleState: normalizeDomainLifecycleState(input.lifecycleState),
    notificationRules: normalizeObject(input.notificationRules),
    projectId: input.projectId,
    providerState,
    runtimeSettings: normalizeObject(input.runtimeSettings),
    sessionId,
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
  const zmxName = createZmxSessionName(current.projectId, current.sessionId);
  const inputProviderState = normalizeObject(input.providerState);
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
    isFavorite: hasOwn(input, "isFavorite") ? input.isFavorite === true : current.isFavorite,
    isPinned: hasOwn(input, "isPinned") ? input.isPinned === true : current.isPinned,
    kind: hasOwn(input, "kind") ? normalizeSessionKind(input.kind) : current.kind,
    lastActiveAt: hasOwn(input, "lastActiveAt") ? normalizeOptionalText(input.lastActiveAt) : current.lastActiveAt,
    launchSettings: hasOwn(input, "launchSettings") ? normalizeObject(input.launchSettings) : current.launchSettings,
    lifecycleState: hasOwn(input, "lifecycleState")
      ? normalizeDomainLifecycleState(input.lifecycleState)
      : current.lifecycleState,
    notificationRules: hasOwn(input, "notificationRules") ? normalizeObject(input.notificationRules) : current.notificationRules,
    providerState: hasOwn(input, "providerState")
      ? {
          ...inputProviderState,
          lifecycleState: normalizeProviderLifecycleState(input.providerState?.lifecycleState),
          zmxName: normalizeProviderZmxName(inputProviderState.zmxName, zmxName),
        }
      : { ...current.providerState, zmxName: normalizeProviderZmxName(current.providerState.zmxName, zmxName) },
    runtimeSettings: hasOwn(input, "runtimeSettings") ? normalizeObject(input.runtimeSettings) : current.runtimeSettings,
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
  title: string;
  updatedAt: string;
  worktreeJson: string;
  zmxName: string;
}

interface ClientLayoutRow {
  clientId: string;
  layoutJson: string;
  projectId: string;
  updatedAt: string;
}

function toProjectRow(project: GxserverProjectDomainState): ProjectRow {
  return {
    attentionRulesJson: stringifyJson(project.attentionRules),
    completionRulesJson: stringifyJson(project.completionRules),
    createdAt: project.createdAt,
    customAgentOrderJson: stringifyJson(project.customAgentOrder),
    customAgentsJson: stringifyJson(project.customAgents),
    customCommandOrderJson: stringifyJson(project.customCommandOrder),
    customCommandsJson: stringifyJson(project.customCommands),
    defaultCommand: project.defaultCommand ?? null,
    deletedDefaultCommandIdsJson: stringifyJson(project.deletedDefaultCommandIds),
    gitConfigJson: stringifyJson(project.gitConfig),
    identityIconJson: stringifyJson(project.identityIcon ?? {}),
    isFavorite: project.isFavorite ? 1 : 0,
    isPinned: project.isPinned ? 1 : 0,
    launchSettingsJson: stringifyJson(project.launchSettings),
    name: project.name,
    notificationRulesJson: stringifyJson(project.notificationRules),
    path: project.path ?? null,
    previousSessionHistoryJson: stringifyJson(project.previousSessionHistory),
    projectBoardConfigJson: stringifyJson(project.projectBoardConfig),
    projectId: project.projectId,
    runtimeSettingsJson: stringifyJson(project.runtimeSettings),
    updatedAt: project.updatedAt,
    worktreeJson: stringifyJson(project.worktree ?? {}),
  };
}

function fromProjectRow(row: ProjectRow): GxserverProjectDomainState {
  const identityIcon = parseObject(row.identityIconJson);
  const worktree = parseObject(row.worktreeJson);
  return {
    attentionRules: parseObject(row.attentionRulesJson),
    completionRules: parseObject(row.completionRulesJson),
    createdAt: row.createdAt,
    customAgentOrder: parseStringArray(row.customAgentOrderJson),
    customAgents: parseObjectArray(row.customAgentsJson),
    customCommandOrder: parseStringArray(row.customCommandOrderJson),
    customCommands: parseObjectArray(row.customCommandsJson),
    defaultCommand: row.defaultCommand ?? undefined,
    deletedDefaultCommandIds: parseStringArray(row.deletedDefaultCommandIdsJson),
    gitConfig: parseObject(row.gitConfigJson),
    ...(Object.keys(identityIcon).length > 0 ? { identityIcon } : {}),
    isFavorite: row.isFavorite === 1,
    isPinned: row.isPinned === 1,
    launchSettings: parseObject(row.launchSettingsJson),
    name: row.name,
    notificationRules: parseObject(row.notificationRulesJson),
    path: row.path ?? undefined,
    previousSessionHistory: parseObjectArray(row.previousSessionHistoryJson),
    projectBoardConfig: parseObject(row.projectBoardConfigJson),
    projectId: row.projectId as GxserverProjectId,
    runtimeSettings: parseObject(row.runtimeSettingsJson),
    updatedAt: row.updatedAt,
    ...(Object.keys(worktree).length > 0 ? { worktree } : {}),
  };
}

function toSessionRow(session: GxserverSessionDomainState): SessionRow {
  return {
    agentId: session.agentId ?? null,
    attentionRulesJson: stringifyJson(session.attentionRules),
    commandId: session.commandId ?? null,
    completionRulesJson: stringifyJson(session.completionRules),
    createdAt: session.createdAt,
    cwd: session.cwd ?? null,
    isFavorite: session.isFavorite ? 1 : 0,
    isPinned: session.isPinned ? 1 : 0,
    kind: session.kind,
    lastActiveAt: session.lastActiveAt ?? null,
    launchSettingsJson: stringifyJson(session.launchSettings),
    lifecycleState: session.lifecycleState,
    notificationRulesJson: stringifyJson(session.notificationRules),
    projectId: session.projectId,
    providerStateJson: stringifyJson(session.providerState),
    restoredFromHistoryId: session.hiddenMetadata.restoredFromHistoryId ?? null,
    restoredFromSessionId: session.hiddenMetadata.restoredFromSessionId ?? null,
    runtimeSettingsJson: stringifyJson(session.runtimeSettings),
    sessionId: session.sessionId,
    title: session.title,
    updatedAt: session.updatedAt,
    worktreeJson: stringifyJson(session.worktree ?? {}),
    zmxName: session.zmxName,
  };
}

function fromSessionRow(serverId: GxserverServerId, row: SessionRow): GxserverSessionDomainState {
  const projectId = row.projectId as GxserverProjectId;
  const sessionId = row.sessionId as GxserverSessionId;
  const zmxName = createZmxSessionName(projectId, sessionId);
  const providerState: JsonObject = parseObject(row.providerStateJson);
  const worktree = parseObject(row.worktreeJson);
  return {
    agentId: row.agentId ?? undefined,
    attentionRules: parseObject(row.attentionRulesJson),
    commandId: row.commandId ?? undefined,
    completionRules: parseObject(row.completionRulesJson),
    createdAt: row.createdAt,
    cwd: row.cwd ?? undefined,
    globalRef: createGlobalSessionRef(serverId, projectId, sessionId),
    hiddenMetadata: {
      restoredFromHistoryId: row.restoredFromHistoryId ?? undefined,
      restoredFromSessionId: row.restoredFromSessionId ? (row.restoredFromSessionId as GxserverSessionId) : undefined,
    },
    isFavorite: row.isFavorite === 1,
    isPinned: row.isPinned === 1,
    kind: normalizeSessionKind(row.kind),
    lastActiveAt: row.lastActiveAt ?? undefined,
    launchSettings: parseObject(row.launchSettingsJson),
    lifecycleState: normalizeDomainLifecycleState(row.lifecycleState),
    notificationRules: parseObject(row.notificationRulesJson),
    projectId,
    providerState: {
      ...providerState,
      lifecycleState: normalizeProviderLifecycleState(providerState.lifecycleState),
      zmxName: normalizeProviderZmxName(providerState.zmxName, zmxName),
    },
    runtimeSettings: parseObject(row.runtimeSettingsJson),
    sessionId,
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

function normalizeProviderZmxName(value: unknown, fallback: string): GxserverZmxSessionName {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return (trimmed || fallback) as GxserverZmxSessionName;
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

function parseObject(value: string): JsonObject {
  try {
    return normalizeObject(JSON.parse(value));
  } catch {
    return {};
  }
}

function parseObjectArray(value: string): JsonArray {
  try {
    return normalizeObjectArray(JSON.parse(value));
  } catch {
    return [];
  }
}

function parseStringArray(value: string): readonly string[] {
  try {
    return normalizeStringArray(JSON.parse(value));
  } catch {
    return [];
  }
}
