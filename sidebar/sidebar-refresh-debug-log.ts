import type { SidebarSessionGroup } from "../shared/session-grid-contract";
import type { WebviewApi } from "./webview-api";

export const SIDEBAR_REFRESH_DEBUG_EVENT_PREFIX = "sidebar.refresh.";
let sidebarRefreshDebugInstanceSequence = 0;

type SidebarRefreshSnapshotMessage = {
  groups: readonly SidebarSessionGroup[];
  revision: number;
  type: string;
};

/**
 * CDXC:SidebarRefreshDiagnostics 2026-05-11-12:32
 * Sidebar refresh investigations need a dedicated persistent log that records
 * React instance lifetime, hydrate boundaries, and action-triggered session
 * count changes only when Settings debugging mode is enabled. Keep this probe
 * separate from order/startup logs so a user reproduction can be shared without
 * mixing unrelated sidebar diagnostics.
 */
export function createSidebarRefreshDebugInstanceId(): string {
  sidebarRefreshDebugInstanceSequence += 1;
  return `sidebar-app-${Date.now().toString(36)}-${sidebarRefreshDebugInstanceSequence}`;
}

export function postSidebarRefreshDebugLog(
  enabled: boolean | undefined,
  vscode: WebviewApi,
  event: string,
  details: Record<string, unknown>,
): void {
  if (!enabled) {
    return;
  }

  vscode.postMessage({
    details,
    event: `${SIDEBAR_REFRESH_DEBUG_EVENT_PREFIX}${event}`,
    type: "sidebarDebugLog",
  });
}

export function summarizeSidebarRefreshMessage(
  message: SidebarRefreshSnapshotMessage,
  previousRevision: number,
): Record<string, unknown> {
  return {
    groupCount: message.groups.length,
    messageType: message.type,
    previousRevision,
    revision: message.revision,
    sessionCount: countSidebarRefreshSessions(message.groups),
    sessionIds: collectSidebarRefreshSessionIds(message.groups),
  };
}

function countSidebarRefreshSessions(groups: readonly SidebarSessionGroup[]): number {
  return groups.reduce((total, group) => total + group.sessions.length, 0);
}

function collectSidebarRefreshSessionIds(groups: readonly SidebarSessionGroup[]): string[] {
  return groups.flatMap((group) => group.sessions.map((session) => session.sessionId));
}
