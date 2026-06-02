import {
  MAX_COMMANDS_PANEL_HEIGHT_RATIO,
  MIN_COMMANDS_PANEL_HEIGHT_RATIO,
  resolveDefaultCommandsPanelHeightRatio,
  getSlotPosition,
  type CommandsPanelMode,
  type CommandsPanelState,
  type SessionPaneLayoutNode,
  type TerminalSessionRecord,
} from "../../shared/session-grid-contract";
import { normalizeSessionRecord } from "../../shared/session-grid-state-helpers";
import { isGxserverBackedLocalPersistedSession } from "./native-project-local-persistence";

export function normalizeLiveCommandsPanelState(
  candidate: CommandsPanelState,
  options: { defaultHeightPx?: number; workspaceHeightPx?: number } = {},
): CommandsPanelState {
  /*
  CDXC:ProjectSidebarOwnership 2026-06-02-17:06:
  Live command-panel updates are macOS current-window placement state, not WK storage hydration. Preserve local-first tab title, lifecycle, provider, and run-feedback fields while keeping only canonical gxserver command session ids and normalized command-pane placement; the writer boundary still strips gxserver-owned metadata before persistence.
  */
  const sessions = candidate.sessions
    .map((session, index) =>
      normalizeSessionRecord({
        ...session,
        kind: "terminal",
        surface: "commands",
        slotIndex: index,
      } as TerminalSessionRecord),
    )
    .filter((session): session is TerminalSessionRecord => session.kind === "terminal")
    .filter((session) => isGxserverBackedLocalPersistedSession(session.sessionId))
    .map((session, index) => {
      const position = getSlotPosition(index);
      return {
        ...session,
        column: position.column,
        row: position.row,
        slotIndex: index,
        surface: "commands" as const,
      };
    });
  const sessionIds = new Set(sessions.map((session) => session.sessionId));
  const activeSessionId =
    candidate.activeSessionId && sessionIds.has(candidate.activeSessionId)
      ? candidate.activeSessionId
      : sessions[0]?.sessionId;
  const paneLayout = normalizeCommandPanelPaneLayout(
    candidate.paneLayout,
    sessionIds,
    activeSessionId,
  );
  return {
    activeSessionId,
    heightRatio: normalizeCommandsPanelHeightRatio(candidate.heightRatio, options),
    isVisible: sessions.length > 0 && candidate.isVisible === true,
    mode: normalizeCommandsPanelMode(candidate.mode),
    ...(paneLayout ? { paneLayout } : {}),
    sessions,
  };
}

function normalizeCommandsPanelMode(mode: unknown): CommandsPanelMode {
  return mode === "floating" ? "floating" : "pinned";
}

function normalizeCommandsPanelHeightRatio(
  heightRatio: unknown,
  options: { defaultHeightPx?: number; workspaceHeightPx?: number },
): number {
  const defaultHeightRatio = resolveDefaultCommandsPanelHeightRatio(
    options.workspaceHeightPx,
    options.defaultHeightPx,
  );
  const numericHeightRatio =
    typeof heightRatio === "number" ? heightRatio : defaultHeightRatio;
  return Math.max(
    MIN_COMMANDS_PANEL_HEIGHT_RATIO,
    Math.min(
      MAX_COMMANDS_PANEL_HEIGHT_RATIO,
      Number.isFinite(numericHeightRatio) ? numericHeightRatio : defaultHeightRatio,
    ),
  );
}

function normalizeCommandPanelPaneLayout(
  layout: SessionPaneLayoutNode | undefined,
  allowedSessionIds: ReadonlySet<string>,
  activeSessionId?: string,
): SessionPaneLayoutNode | undefined {
  if (!layout) {
    const firstSessionId = allowedSessionIds.values().next().value as string | undefined;
    return firstSessionId ? { kind: "leaf", sessionId: firstSessionId } : undefined;
  }
  if (layout.kind === "leaf") {
    return allowedSessionIds.has(layout.sessionId) ? layout : undefined;
  }
  if (layout.kind === "tabs") {
    const sessionIds = layout.sessionIds.filter((sessionId, index, ids) =>
      allowedSessionIds.has(sessionId) && ids.indexOf(sessionId) === index,
    );
    if (sessionIds.length === 0) {
      return undefined;
    }
    if (sessionIds.length === 1) {
      return { kind: "leaf", sessionId: sessionIds[0]! };
    }
    return {
      activeSessionId:
        layout.activeSessionId && sessionIds.includes(layout.activeSessionId)
          ? layout.activeSessionId
          : activeSessionId && sessionIds.includes(activeSessionId)
            ? activeSessionId
            : sessionIds[0],
      kind: "tabs",
      sessionIds,
    };
  }
  const children = layout.children
    .map((child) => normalizeCommandPanelPaneLayout(child, allowedSessionIds, activeSessionId))
    .filter((child): child is SessionPaneLayoutNode => child !== undefined);
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { ...layout, children };
}
