import type {
  GxserverAgentActivityState,
  GxserverPresentationAttentionState,
  GxserverPresentationGroup,
  GxserverPresentationProject,
  GxserverPresentationRevision,
  GxserverPresentationSession,
  GxserverPresentationSessionActions,
  GxserverPresentationSessionActivity,
  GxserverPresentationSnapshot,
  GxserverProjectDomainState,
  GxserverSessionDomainState,
} from "../../protocol/index.js";
import { getEffectiveAgentActivityState } from "../session-status/index.js";
import { projectSessionTitle } from "../session-title/projection.js";

export interface GxserverPresentationProjectorInput {
  generatedAt?: string;
  projects: readonly GxserverProjectDomainState[];
  revision: GxserverPresentationRevision;
  sessions: readonly GxserverSessionDomainState[];
}

const ACTIVE_LIFECYCLE_STATES = new Set(["running", "sleeping"]);
const RECENT_STOPPED_LIMIT_PER_PROJECT = 20;

/*
CDXC:GxserverPresentation 2026-06-01-15:08:
The hard cutover feed is active-focused presentation state, not raw session history. Project sessions into shared rows with surface, title provenance, activity, and sidebar visibility while keeping stopped history out unless pinned or favorited so clients do not hydrate the entire database at startup.
*/
export function projectGxserverPresentationSnapshot(
  input: GxserverPresentationProjectorInput,
): GxserverPresentationSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sessionsByProject = new Map<string, GxserverSessionDomainState[]>();
  for (const session of input.sessions) {
    const sessions = sessionsByProject.get(session.projectId) ?? [];
    sessions.push(session);
    sessionsByProject.set(session.projectId, sessions);
  }

  const projects: GxserverPresentationProject[] = [];
  const groups: GxserverPresentationGroup[] = [];
  const sessions: GxserverPresentationSession[] = [];

  for (const project of [...input.projects].sort(compareProjects)) {
    const projectSessions = sessionsByProject.get(project.projectId) ?? [];
    const visibleProjectSessions = selectPresentationSessions(projectSessions);

    const groupId = defaultGroupId(project.projectId);
    const presentationSessions = visibleProjectSessions.map((session) =>
      projectPresentationSession(project, groupId, session, generatedAt)
    );
    presentationSessions.sort(comparePresentationSessions);

    /*
    CDXC:GxserverPresentationProjects 2026-06-01-21:14:
    Newly added code projects must appear in the sidebar before their first terminal session exists. Keep every active project in the presentation project list while still filtering old stopped sessions out of the session rows.
    */
    projects.push(projectPresentationProject(project));
    groups.push({
      groupId,
      projectId: project.projectId,
      sessionIds: presentationSessions.map((session) => session.sessionId),
      sortKey: `${projectSortKey(project)}:active`,
      title: "Active",
    });
    sessions.push(...presentationSessions);
  }

  return {
    generatedAt,
    groups,
    projects,
    revision: input.revision,
    sessions,
  };
}

export function projectPresentationProject(project: GxserverProjectDomainState): GxserverPresentationProject {
  /*
  CDXC:GxserverPresentationProjects 2026-06-02-08:16:
  Worktree project rows are shared gxserver presentation state. Include worktree parent metadata in the presentation project so clients can render a newly added checkout under its main project from the projectAdded delta without waiting for a separate domain-project refresh.
  */
  return {
    createdAt: project.createdAt,
    groupIds: [defaultGroupId(project.projectId)],
    isFavorite: project.isFavorite,
    isPinned: project.isPinned,
    path: project.path,
    projectId: project.projectId,
    sortKey: projectSortKey(project),
    title: project.name,
    updatedAt: project.updatedAt,
    ...(project.worktree ? { worktree: project.worktree } : {}),
  };
}

export function projectPresentationSession(
  project: GxserverProjectDomainState,
  groupId: string,
  session: GxserverSessionDomainState,
  generatedAt?: string,
): GxserverPresentationSession {
  const titleProjection = projectSessionTitle(session);
  const activityState = normalizePresentationActivityState(session.runtimeSettings.agentActivity, generatedAt);
  const agentName = readText(session.runtimeSettings.agentName) ?? session.agentId;
  const subtitle = session.cwd ?? project.path;
  return {
    actions: presentationSessionActions(session, activityState.activity),
    activity: activityState.activity,
    ...(agentName ? { agentName } : {}),
    ...(session.agentId ? { agentId: session.agentId, agentIcon: session.agentId } : {}),
    ...(activityState.attention ? { attention: activityState.attention } : {}),
    createdAt: session.createdAt,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    groupId,
    isFavorite: session.sessionTag === "favorite" || session.isFavorite,
    /*
    CDXC:GxserverSessionTitle 2026-06-04-07:11:
    First-prompt title generation is gxserver-owned, but clients still own their local loading chrome. Publish a privacy-safe boolean in presentation rows so native terminal overlays, sidebar card text, and future clients can render and clear "Generating title" without reading raw prompts or duplicating server runtime-status rules.
    */
    isGeneratingFirstPromptTitle: readText(session.runtimeSettings.gxserverFirstPromptAutoTitleStatus) === "running",
    isPinned: session.isPinned,
    isPrimaryTitleTerminalTitle: titleProjection.isPrimaryTitleTerminalTitle,
    isTemporaryTitle: titleProjection.isTemporaryTitle,
    kind: session.kind,
    ...(session.lastActiveAt ? { lastActiveAt: session.lastActiveAt } : {}),
    lifecycleState: session.lifecycleState,
    ...(titleProjection.primaryTitle !== undefined ? { primaryTitle: titleProjection.primaryTitle } : {}),
    projectId: session.projectId,
    sessionId: session.sessionId,
    ...(session.sessionTag ? { sessionTag: session.sessionTag } : {}),
    ...(session.sidebarOrder !== undefined ? { sidebarOrder: session.sidebarOrder } : {}),
    sortKey: sessionSortKey(session),
    ...(subtitle ? { subtitle } : {}),
    surface: session.surface,
    ...(titleProjection.terminalTitle !== undefined ? { terminalTitle: titleProjection.terminalTitle } : {}),
    title: titleProjection.title,
    titleSource: titleProjection.titleSource,
    ...(titleProjection.trustedResumeTitle !== undefined ? { trustedResumeTitle: titleProjection.trustedResumeTitle } : {}),
    tooltip: buildSessionTooltip(project, session, titleProjection.title),
    updatedAt: session.updatedAt,
    visibleInSidebarByDefault: isVisibleInWorkspaceSidebar(session),
    zmxName: session.zmxName,
  };
}

function presentationSessionActions(
  session: GxserverSessionDomainState,
  activity: GxserverPresentationSessionActivity,
): GxserverPresentationSessionActions {
  /*
  CDXC:GxserverPresentation 2026-06-04-03:33:
  Clients should not each infer whether a session can be attached, sent to,
  woken, slept, killed, or acknowledged. Publish coarse action availability
  with the presentation row so Android, iOS, TUI, CLI, and agent orchestration
  render and automate against the same gxserver-owned rules.
  */
  const isRunning = session.lifecycleState === "running";
  const isSleeping = session.lifecycleState === "sleeping";
  const isStopped = session.lifecycleState === "stopped";
  const providerExists = session.providerState.lifecycleState === "exists";
  const isLive = isRunning || providerExists;
  const canAttach = isRunning || isSleeping || providerExists;
  const canInteract = isLive && !isSleeping && !isStopped;
  return {
    acknowledgeAttention: activity === "attention",
    attach: canAttach,
    focus: canInteract,
    kill: !isStopped,
    readText: canInteract,
    sendMessage: canInteract,
    sendText: canInteract,
    sleep: canInteract,
    wake: isSleeping,
  };
}

export function isActivePresentationSession(session: GxserverSessionDomainState): boolean {
  return ACTIVE_LIFECYCLE_STATES.has(session.lifecycleState);
}

export function isVisibleInWorkspaceSidebar(session: GxserverSessionDomainState): boolean {
  return session.surface === "workspace" && isActivePresentationSession(session);
}

export function shouldIncludePresentationSession(session: GxserverSessionDomainState): boolean {
  return isActivePresentationSession(session) || session.isPinned || session.isFavorite || Boolean(session.sessionTag);
}

export function defaultGroupId(projectId: string): string {
  return `${projectId}:active`;
}

function selectPresentationSessions(sessions: readonly GxserverSessionDomainState[]): GxserverSessionDomainState[] {
  const active = sessions.filter(isActivePresentationSession);
  const pinnedStopped = sessions
    .filter((session) => !isActivePresentationSession(session) && shouldIncludePresentationSession(session))
    .sort(compareDomainSessions)
    .slice(0, RECENT_STOPPED_LIMIT_PER_PROJECT);
  return [...active, ...pinnedStopped];
}

function normalizePresentationActivityState(value: unknown, generatedAt: string | undefined): {
  activity: GxserverPresentationSessionActivity;
  attention?: GxserverPresentationAttentionState;
} {
  const generatedAtMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const state = getEffectiveAgentActivityState(
    value,
    { activity: "idle" },
    Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now(),
  );
  const activity = state.activity === "attention" || state.activity === "working" ? state.activity : "idle";
  if (activity !== "attention") {
    return { activity };
  }
  return {
    activity,
    attention: {
      acknowledged: state.isAcknowledged === true,
      ...(typeof state.lastChangedAt === "string" ? { enteredAt: state.lastChangedAt } : {}),
    },
  };
}

function buildSessionTooltip(
  project: GxserverProjectDomainState,
  session: GxserverSessionDomainState,
  title: string,
): string {
  return [title, project.name, session.cwd, session.agentId, session.commandId].filter(Boolean).join(" - ");
}

function projectSortKey(project: GxserverProjectDomainState): string {
  const pinRank = project.isPinned ? "0" : project.isFavorite ? "1" : "2";
  return `${pinRank}:${project.name.toLocaleLowerCase()}:${project.projectId}`;
}

function sessionSortKey(session: GxserverSessionDomainState): string {
  const activeRank = isActivePresentationSession(session) ? "0" : "1";
  const pinRank = session.isPinned
    ? "0"
    : session.sessionTag === "favorite" || session.isFavorite
      ? "1"
      : "2";
  /*
  CDXC:PinnedSessions 2026-06-02-20:11:
  Pinned sessions under a project need a durable user-defined order. Sort rows by
  the explicit gxserver sidebar order before recency so drag-to-reorder cannot
  be undone by the next presentation snapshot or lifecycle/title delta.

  CDXC:ManualSessionSorting 2026-06-05-12:30:
  Manual Sorting uses the same gxserver sidebar order for non-pinned sessions.
  New sessions receive order 0, while saved manual snapshots start at 1000, so
  new rows land at the top and previously ordered rows keep their saved order.
  Put sidebar order before active/pinned rank so manual mode can move pinned,
  stopped, and non-pinned rows freely; last-active mode applies its own display
  partitions in the shared sidebar sorter.
  */
  const sidebarOrder = formatSidebarOrder(session.sidebarOrder);
  return `${sidebarOrder}:${activeRank}:${pinRank}:${session.lastActiveAt ?? session.updatedAt}:${session.sessionId}`;
}

function formatSidebarOrder(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? String(Math.floor(value)).padStart(12, "0")
    : "z";
}

function compareProjects(left: GxserverProjectDomainState, right: GxserverProjectDomainState): number {
  return projectSortKey(left).localeCompare(projectSortKey(right));
}

function compareDomainSessions(left: GxserverSessionDomainState, right: GxserverSessionDomainState): number {
  return sessionSortKey(left).localeCompare(sessionSortKey(right));
}

function comparePresentationSessions(
  left: GxserverPresentationSession,
  right: GxserverPresentationSession,
): number {
  return left.sortKey.localeCompare(right.sortKey);
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
