import type { SidebarSessionGroup, SidebarSessionItem } from "../shared/session-grid-contract";

type ConnectorEligibleSession = Pick<SidebarSessionItem, "sessionId">;

export function shouldShowSessionGroupConnector({
  groupKind,
  sessions,
}: {
  groupKind: SidebarSessionGroup["kind"];
  sessions: readonly ConnectorEligibleSession[];
}): boolean {
  void groupKind;
  /**
   * CDXC:ProjectGroups 2026-05-15-14:33:
   * The sidebar no longer renders a project editor row, so the left connector
   * appears only when there are real session rows to connect.
   */
  return sessions.length > 0;
}
