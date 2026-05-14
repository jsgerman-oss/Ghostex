import type { GroupedSessionWorkspaceSnapshot } from "../../shared/session-grid-contract";

export type RecentProjectState = {
  isChat?: boolean;
  isRecentProject?: boolean;
  recentClosedAt?: string;
  workspace: GroupedSessionWorkspaceSnapshot;
};

export function countRecentProjectSessions(
  project: Pick<RecentProjectState, "workspace">,
): number {
  return project.workspace.groups.reduce(
    (projectTotal, group) => projectTotal + group.snapshot.sessions.length,
    0,
  );
}

export function compareRecentProjectsByClosedAt(
  left: Pick<RecentProjectState, "recentClosedAt">,
  right: Pick<RecentProjectState, "recentClosedAt">,
): number {
  return recentProjectClosedAtTime(right) - recentProjectClosedAtTime(left);
}

function recentProjectClosedAtTime(project: Pick<RecentProjectState, "recentClosedAt">): number {
  const time = project.recentClosedAt ? new Date(project.recentClosedAt).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}
