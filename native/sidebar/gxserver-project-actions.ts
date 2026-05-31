import type { GxserverProjectDomainState } from "../../shared/gxserver-protocol";
import {
  normalizeStoredSidebarAgentOrder,
  normalizeStoredSidebarAgents,
  type StoredSidebarAgent,
} from "../../shared/sidebar-agents";
import {
  normalizeProjectSidebarCommandsState,
  type ProjectSidebarCommandsState,
  type ProjectSidebarCommandsStore,
} from "../../shared/project-sidebar-commands";

type MergeGxserverProjectActionsResult = {
  changed: boolean;
  restoredOwnerIds: string[];
  store: ProjectSidebarCommandsStore;
};

type MergeGxserverAgentsResult = {
  agents: StoredSidebarAgent[];
  changed: boolean;
  order: string[];
};

type GxserverGitPreferences = {
  confirmCommit?: boolean;
  generateCommitBody?: boolean;
  primaryAction?: "commit" | "push" | "pr";
};

/*
CDXC:ProjectActions 2026-05-30-23:59:
Project Actions are shared gxserver project state after the daemon cutover, while the existing sidebar renderer still needs its local command cache to draw action buttons synchronously. Hydrate empty P-id cache entries from gxserver instead of treating the cache as authoritative, so first-launch ID migration cannot make imported actions disappear from the UI.
*/
export function mergeGxserverProjectActionsIntoCommandsStore(
  store: ProjectSidebarCommandsStore,
  gxserverProjects: readonly GxserverProjectDomainState[],
  ownerIdByProjectId: Readonly<Record<string, string>> = {},
): MergeGxserverProjectActionsResult {
  let changed = false;
  const restoredOwnerIds: string[] = [];
  const nextStore: ProjectSidebarCommandsStore = { ...store };
  for (const project of gxserverProjects) {
    const ownerProjectId = ownerIdByProjectId[project.projectId] || project.projectId;
    const gxserverState = normalizeProjectSidebarCommandsState({
      commands: project.customCommands,
      deletedDefaultCommandIds: project.deletedDefaultCommandIds,
      order: project.customCommandOrder,
    });
    if (!gxserverState || !hasProjectSidebarCommandsStateContent(gxserverState)) {
      continue;
    }
    const existingState = nextStore[ownerProjectId];
    if (existingState && hasProjectSidebarCommandsStateContent(existingState)) {
      continue;
    }
    nextStore[ownerProjectId] = gxserverState;
    restoredOwnerIds.push(ownerProjectId);
    changed = true;
  }
  return { changed, restoredOwnerIds, store: nextStore };
}

export function hasProjectSidebarCommandsStateContent(
  state: ProjectSidebarCommandsState | undefined,
): boolean {
  return Boolean(
    state &&
      (state.commands.length > 0 ||
        state.order.length > 0 ||
      state.deletedDefaultCommandIds.length > 0),
  );
}

/*
CDXC:SidebarAgents 2026-05-31-00:24:
Custom Agents follow the same cutover rule as Actions: gxserver imports them into shared project domain state, while the current macOS sidebar still renders from a synchronous local cache. Rehydrate only empty local agent stores so a stale WKWebView key cannot hide imported agents, without overwriting edits already made in the current sidebar.
*/
export function mergeGxserverAgentsIntoSidebarStore(
  storedAgents: readonly StoredSidebarAgent[],
  storedOrder: readonly string[],
  gxserverProjects: readonly GxserverProjectDomainState[],
): MergeGxserverAgentsResult {
  const sourceProject = gxserverProjects.find(
    (project) => project.customAgents.length > 0 || project.customAgentOrder.length > 0,
  );
  if (!sourceProject) {
    return {
      agents: [...storedAgents],
      changed: false,
      order: [...storedOrder],
    };
  }
  const nextAgents =
    storedAgents.length > 0
      ? [...storedAgents]
      : normalizeStoredSidebarAgents(sourceProject.customAgents);
  const nextOrder =
    storedOrder.length > 0
      ? [...storedOrder]
      : normalizeStoredSidebarAgentOrder(sourceProject.customAgentOrder);
  const changed = nextAgents.length !== storedAgents.length || nextOrder.length !== storedOrder.length;
  return { agents: nextAgents, changed, order: nextOrder };
}

export function readGxserverGitPreferences(
  gxserverProjects: readonly GxserverProjectDomainState[],
): GxserverGitPreferences {
  const source = gxserverProjects.find((project) => {
    const config = project.gitConfig;
    return (
      isGitPrimaryAction(config.primaryAction) ||
      typeof config.confirmCommit === "boolean" ||
      typeof config.generateCommitBody === "boolean"
    );
  });
  if (!source) {
    return {};
  }
  return {
    ...(typeof source.gitConfig.confirmCommit === "boolean"
      ? { confirmCommit: source.gitConfig.confirmCommit }
      : {}),
    ...(typeof source.gitConfig.generateCommitBody === "boolean"
      ? { generateCommitBody: source.gitConfig.generateCommitBody }
      : {}),
    ...(isGitPrimaryAction(source.gitConfig.primaryAction)
      ? { primaryAction: source.gitConfig.primaryAction }
      : {}),
  };
}

function isGitPrimaryAction(value: unknown): value is "commit" | "push" | "pr" {
  return value === "commit" || value === "push" || value === "pr";
}
