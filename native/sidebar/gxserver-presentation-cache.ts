import type {
  GxserverPresentationDelta,
  GxserverPresentationGroup,
  GxserverPresentationProject,
  GxserverPresentationSnapshot,
  GxserverProjectDomainState,
  GxserverSessionId,
} from "../../shared/gxserver-protocol";

/*
CDXC:GxserverPresentationGroups 2026-06-02-11:18:
gxserver owns presentation groups and the session relationships inside those groups. The native sidebar may decide visual layout and local pane/tab state, but its gxserver presentation cache must apply group deltas and derive group membership from gxserver session rows so stale native ordering cannot become a second source of truth.
*/
export function reduceGxserverPresentationDelta(
  presentation: GxserverPresentationSnapshot,
  delta: GxserverPresentationDelta,
  revision: number,
): GxserverPresentationSnapshot {
  const nextRevision = revision as GxserverPresentationSnapshot["revision"];
  switch (delta.type) {
    case "sessionAdded":
    case "sessionUpdated":
    case "sessionMoved":
    case "sessionTitleChanged":
    case "sessionActivityChanged":
    case "sessionLifecycleChanged":
    case "sessionSurfaceChanged":
    case "sessionPresentationChanged": {
      const sessions = orderPresentationSessions(
        upsertPresentationSession(presentation.sessions, delta.session),
      );
      return {
        ...presentation,
        groups: reconcilePresentationGroupSessionIds(presentation.groups, sessions),
        revision: nextRevision,
        sessions,
      };
    }
    case "sessionRemoved": {
      const sessions = presentation.sessions.filter(
        (session) => session.projectId !== delta.projectId || session.sessionId !== delta.sessionId,
      );
      return {
        ...presentation,
        groups: reconcilePresentationGroupSessionIds(presentation.groups, sessions),
        revision: nextRevision,
        sessions,
      };
    }
    case "projectAdded":
    case "projectUpdated":
      return {
        ...presentation,
        groups: upsertPresentationProjectGroup(presentation.groups, delta.project),
        projects: upsertPresentationProject(presentation.projects, delta.project),
        revision: nextRevision,
      };
    case "projectRemoved":
      return {
        ...presentation,
        groups: presentation.groups.filter((group) => group.projectId !== delta.projectId),
        projects: presentation.projects.filter((project) => project.projectId !== delta.projectId),
        sessions: presentation.sessions.filter((session) => session.projectId !== delta.projectId),
        revision: nextRevision,
      };
    case "groupAdded":
    case "groupUpdated":
    case "groupOrderChanged":
      return {
        ...presentation,
        groups: upsertPresentationGroup(presentation.groups, delta.group),
        revision: nextRevision,
      };
    case "groupRemoved": {
      const groups = presentation.groups.filter((group) => group.groupId !== delta.groupId);
      return {
        ...presentation,
        groups,
        revision: nextRevision,
        sessions: presentation.sessions.filter(
          (session) => session.projectId !== delta.projectId || session.groupId !== delta.groupId,
        ),
      };
    }
    default:
      return { ...presentation, revision: nextRevision };
  }
}

export function reduceGxserverProjectCacheForPresentationDelta(
  projects: readonly GxserverProjectDomainState[],
  delta: GxserverPresentationDelta,
): GxserverProjectDomainState[] {
  if ((delta.type === "projectAdded" || delta.type === "projectUpdated") && delta.domainProject) {
    return upsertGxserverProjectDomainState(projects, delta.domainProject);
  }
  if (delta.type === "projectRemoved") {
    return projects.filter((project) => project.projectId !== delta.projectId);
  }
  return [...projects];
}

export function createPresentationProjectFromGxserverProject(
  project: GxserverProjectDomainState,
): GxserverPresentationProject {
  const pinRank = project.isPinned ? "0" : project.isFavorite ? "1" : "2";
  return {
    createdAt: project.createdAt,
    groupIds: [`${project.projectId}:active`],
    isFavorite: project.isFavorite,
    isPinned: project.isPinned,
    path: project.path,
    projectId: project.projectId,
    sortKey: `${pinRank}:${project.name.toLocaleLowerCase()}:${project.projectId}`,
    title: project.name,
    updatedAt: project.updatedAt,
    ...(project.worktree ? { worktree: project.worktree } : {}),
  };
}

export function upsertGxserverProjectDomainState(
  projects: readonly GxserverProjectDomainState[],
  nextProject: GxserverProjectDomainState,
): GxserverProjectDomainState[] {
  const index = projects.findIndex((project) => project.projectId === nextProject.projectId);
  if (index === -1) {
    return [...projects, nextProject];
  }
  const nextProjects = [...projects];
  nextProjects[index] = nextProject;
  return nextProjects;
}

export function upsertPresentationProject(
  projects: readonly GxserverPresentationProject[],
  nextProject: GxserverPresentationProject,
): GxserverPresentationProject[] {
  const index = projects.findIndex((project) => project.projectId === nextProject.projectId);
  if (index === -1) {
    return orderPresentationProjects([...projects, nextProject]);
  }
  const nextProjects = [...projects];
  nextProjects[index] = nextProject;
  return orderPresentationProjects(nextProjects);
}

export function upsertPresentationProjectGroup(
  groups: readonly GxserverPresentationGroup[],
  project: GxserverPresentationProject,
): GxserverPresentationGroup[] {
  const groupId = project.groupIds[0] ?? `${project.projectId}:active`;
  const index = groups.findIndex((group) => group.projectId === project.projectId || group.groupId === groupId);
  if (index === -1) {
    return orderPresentationGroups([
      ...groups,
      {
        groupId,
        projectId: project.projectId,
        sessionIds: [],
        sortKey: `${project.sortKey}:active`,
        title: "Active",
      },
    ]);
  }
  const nextGroups = [...groups];
  nextGroups[index] = {
    ...nextGroups[index],
    groupId,
    projectId: project.projectId,
    sortKey: `${project.sortKey}:active`,
  };
  return orderPresentationGroups(nextGroups);
}

function upsertPresentationSession(
  sessions: readonly GxserverPresentationSnapshot["sessions"][number][],
  nextSession: GxserverPresentationSnapshot["sessions"][number],
): GxserverPresentationSnapshot["sessions"][number][] {
  const index = sessions.findIndex(
    (session) => session.projectId === nextSession.projectId && session.sessionId === nextSession.sessionId,
  );
  if (index === -1) {
    return [...sessions, nextSession];
  }
  const nextSessions = [...sessions];
  nextSessions[index] = nextSession;
  return nextSessions;
}

function upsertPresentationGroup(
  groups: readonly GxserverPresentationGroup[],
  nextGroup: GxserverPresentationGroup,
): GxserverPresentationGroup[] {
  const index = groups.findIndex((group) => group.groupId === nextGroup.groupId);
  if (index === -1) {
    return orderPresentationGroups([...groups, nextGroup]);
  }
  const nextGroups = [...groups];
  nextGroups[index] = nextGroup;
  return orderPresentationGroups(nextGroups);
}

function reconcilePresentationGroupSessionIds(
  groups: readonly GxserverPresentationGroup[],
  sessions: readonly GxserverPresentationSnapshot["sessions"][number][],
): GxserverPresentationGroup[] {
  const sessionIdsByGroupKey = new Map<string, GxserverSessionId[]>();
  for (const session of orderPresentationSessions(sessions)) {
    const key = presentationGroupKey(session.projectId, session.groupId);
    const sessionIds = sessionIdsByGroupKey.get(key) ?? [];
    sessionIds.push(session.sessionId);
    sessionIdsByGroupKey.set(key, sessionIds);
  }
  return orderPresentationGroups(
    groups.map((group) => ({
      ...group,
      sessionIds: sessionIdsByGroupKey.get(presentationGroupKey(group.projectId, group.groupId)) ?? [],
    })),
  );
}

function presentationGroupKey(projectId: string, groupId: string): string {
  return `${projectId}\u0000${groupId}`;
}

function orderPresentationProjects(
  projects: readonly GxserverPresentationProject[],
): GxserverPresentationProject[] {
  return [...projects].sort((left, right) =>
    left.sortKey.localeCompare(right.sortKey) || left.projectId.localeCompare(right.projectId),
  );
}

function orderPresentationGroups(
  groups: readonly GxserverPresentationGroup[],
): GxserverPresentationGroup[] {
  return [...groups].sort((left, right) =>
    left.sortKey.localeCompare(right.sortKey) || left.groupId.localeCompare(right.groupId),
  );
}

function orderPresentationSessions(
  sessions: readonly GxserverPresentationSnapshot["sessions"][number][],
): GxserverPresentationSnapshot["sessions"][number][] {
  return [...sessions].sort((left, right) =>
    left.projectId.localeCompare(right.projectId) ||
    left.groupId.localeCompare(right.groupId) ||
    left.sortKey.localeCompare(right.sortKey) ||
    left.sessionId.localeCompare(right.sessionId),
  );
}
