import {
  type CreateSessionRecordOptions,
  type SessionGridDirection,
  type SessionGridSnapshot,
  type SessionPaneLayoutNode,
  type SessionRecord,
  createSessionRecord,
  getOrderedSessions,
} from "./session-grid-contract";
import {
  dedupeSessionIds,
  findDirectionalNeighbor,
  reindexSessionsInOrder,
  replaceFocusedVisibleSession,
  revealSessionId,
} from "./session-grid-state-helpers";
import { normalizeSessionGridSnapshot } from "./session-grid-state-normalize";

export function createSessionInSnapshot(
  snapshot: SessionGridSnapshot,
  sessionNumber: number,
  options?: CreateSessionRecordOptions,
): {
  session?: SessionRecord;
  snapshot: SessionGridSnapshot;
} {
  const normalizedSnapshot = normalizeSessionGridSnapshot(snapshot);
  const orderedSessions = getOrderedSessions(normalizedSnapshot);

  const session = createSessionRecord(sessionNumber, orderedSessions.length, options);
  const sessions = reindexSessionsInOrder([...orderedSessions, session]);
  const shouldCreateInBackground = options?.initialPresentation === "background";
  const visibleSessionIds = shouldCreateInBackground
    ? normalizedSnapshot.visibleSessionIds
    : normalizedSnapshot.visibleSessionIds.length < normalizedSnapshot.visibleCount
      ? [...normalizedSnapshot.visibleSessionIds, session.sessionId]
      : replaceFocusedVisibleSession(normalizedSnapshot, session.sessionId);

  return {
    session,
    snapshot: normalizeSessionGridSnapshot({
      ...normalizedSnapshot,
      focusedSessionId: shouldCreateInBackground
        ? normalizedSnapshot.focusedSessionId
        : session.sessionId,
      sessions,
      visibleSessionIds,
    }),
  };
}

export function focusDirectionInSnapshot(
  snapshot: SessionGridSnapshot,
  direction: SessionGridDirection,
): { changed: boolean; snapshot: SessionGridSnapshot } {
  const normalizedSnapshot = normalizeSessionGridSnapshot(snapshot);
  const currentSession = normalizedSnapshot.focusedSessionId
    ? normalizedSnapshot.sessions.find(
        (session) => session.sessionId === normalizedSnapshot.focusedSessionId,
      )
    : undefined;
  if (!currentSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const nextSession = findDirectionalNeighbor(
    normalizedSnapshot.sessions,
    currentSession,
    direction,
  );
  if (!nextSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  return focusSessionInSnapshot(normalizedSnapshot, nextSession.sessionId);
}

export function focusVisibleDirectionInSnapshot(
  snapshot: SessionGridSnapshot,
  direction: SessionGridDirection,
): { changed: boolean; snapshot: SessionGridSnapshot } {
  const normalizedSnapshot = normalizeSessionGridSnapshot(snapshot);
  const focusVisibleSessionIds = getExactVisibleSessionIdsForFocus(snapshot, normalizedSnapshot);
  const visibleSessionIds = new Set(focusVisibleSessionIds);
  const paneFocusTarget = getDirectionalVisiblePaneFocusTarget(
    normalizedSnapshot.paneLayout,
    normalizedSnapshot.focusedSessionId,
    visibleSessionIds,
    direction,
  );
  if (paneFocusTarget.currentInPaneLayout) {
    if (!paneFocusTarget.sessionId) {
      return { changed: false, snapshot: normalizedSnapshot };
    }

    /**
     * CDXC:PaneFocus 2026-05-29-06:35:
     * Visible native pane tab groups are the directional focus regions users see on screen.
     * Resolve macOS focus-arrow moves from paneLayout geometry before using legacy grid row/column data, because tab groups can contain sessions whose stored slot coordinates no longer match their visible left/right pane position.
     */
    return focusVisibleSessionIdInSnapshot(
      normalizedSnapshot,
      paneFocusTarget.sessionId,
      focusVisibleSessionIds,
    );
  }

  const visibleSessions = normalizedSnapshot.sessions.filter((session) =>
    visibleSessionIds.has(session.sessionId),
  );
  const currentSession = normalizedSnapshot.focusedSessionId
    ? visibleSessions.find((session) => session.sessionId === normalizedSnapshot.focusedSessionId)
    : undefined;
  if (!currentSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  const nextSession = findDirectionalNeighbor(visibleSessions, currentSession, direction);
  if (!nextSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  /**
   * CDXC:PaneFocus 2026-05-28-14:29:
   * macOS directional focus hotkeys are spatial focus moves within the already visible native pane set.
   * They must not reuse generic session reveal behavior, because that swaps hidden/offscreen sessions into visibleSessionIds and changes the visible session tabs.
   */
  return focusVisibleSessionIdInSnapshot(
    normalizedSnapshot,
    nextSession.sessionId,
    focusVisibleSessionIds,
  );
}

export function focusSessionInSnapshot(
  snapshot: SessionGridSnapshot,
  sessionId: string,
): { changed: boolean; snapshot: SessionGridSnapshot } {
  const normalizedSnapshot = normalizeSessionGridSnapshot(snapshot);
  const hasSession = normalizedSnapshot.sessions.some((session) => session.sessionId === sessionId);
  if (!hasSession) {
    return { changed: false, snapshot: normalizedSnapshot };
  }

  return {
    changed: normalizedSnapshot.focusedSessionId !== sessionId,
    snapshot: normalizeSessionGridSnapshot({
      ...normalizedSnapshot,
      focusedSessionId: sessionId,
      visibleSessionIds: revealSessionId(normalizedSnapshot, sessionId),
    }),
  };
}

function setActiveSessionInPaneLayout(
  layout: SessionGridSnapshot["paneLayout"],
  sessionId: string,
): SessionGridSnapshot["paneLayout"] {
  if (!layout) {
    return undefined;
  }
  if (layout.kind === "tabs") {
    return layout.sessionIds.includes(sessionId)
      ? { ...layout, activeSessionId: sessionId }
      : layout;
  }
  if (layout.kind === "split") {
    return {
      ...layout,
      children: layout.children.map(
        (child) => setActiveSessionInPaneLayout(child, sessionId) ?? child,
      ),
    };
  }
  return layout;
}

function focusVisibleSessionIdInSnapshot(
  normalizedSnapshot: SessionGridSnapshot,
  sessionId: string,
  visibleSessionIds: string[],
): { changed: boolean; snapshot: SessionGridSnapshot } {
  return {
    changed: normalizedSnapshot.focusedSessionId !== sessionId,
    snapshot: {
      ...normalizedSnapshot,
      focusedSessionId: sessionId,
      paneLayout: setActiveSessionInPaneLayout(normalizedSnapshot.paneLayout, sessionId),
      visibleSessionIds,
    },
  };
}

function getExactVisibleSessionIdsForFocus(
  snapshot: SessionGridSnapshot,
  normalizedSnapshot: SessionGridSnapshot,
): string[] {
  const sessionIds = new Set(normalizedSnapshot.sessions.map((session) => session.sessionId));
  const exactVisibleSessionIds = dedupeSessionIds(
    snapshot.visibleSessionIds.filter((sessionId) => sessionIds.has(sessionId)),
  );
  if (exactVisibleSessionIds.length > 0) {
    /**
     * CDXC:PaneFocus 2026-05-29-07:09:
     * Native focus-arrow navigation must use the exact mounted pane ids, not normalized visibleCount padding.
     * The native workspace can keep a large historical visibleCount while only a few pane surfaces are mounted; padded sleeping/parked ids must not become directional focus targets or rewrite visibleSessionIds.
     */
    return exactVisibleSessionIds;
  }
  return normalizedSnapshot.visibleSessionIds;
}

type VisiblePaneFocusRect = {
  bottom: number;
  centerX: number;
  centerY: number;
  left: number;
  right: number;
  sessionId: string;
  sessionIds: string[];
  top: number;
};

function getDirectionalVisiblePaneFocusTarget(
  layout: SessionGridSnapshot["paneLayout"],
  focusedSessionId: string | undefined,
  visibleSessionIds: Set<string>,
  direction: SessionGridDirection,
): { currentInPaneLayout: boolean; sessionId?: string } {
  if (!layout || !focusedSessionId) {
    return { currentInPaneLayout: false };
  }

  const panes = collectVisiblePaneFocusRects(layout, visibleSessionIds, {
    bottom: 1,
    left: 0,
    right: 1,
    top: 0,
  });
  const currentPane = panes.find((pane) => pane.sessionIds.includes(focusedSessionId));
  if (!currentPane) {
    return { currentInPaneLayout: false };
  }

  const nextPane = findDirectionalPaneFocusRect(panes, currentPane, direction);
  return { currentInPaneLayout: true, sessionId: nextPane?.sessionId };
}

function collectVisiblePaneFocusRects(
  layout: SessionPaneLayoutNode,
  visibleSessionIds: Set<string>,
  rect: Pick<VisiblePaneFocusRect, "bottom" | "left" | "right" | "top">,
): VisiblePaneFocusRect[] {
  if (layout.kind === "leaf") {
    if (!visibleSessionIds.has(layout.sessionId)) {
      return [];
    }
    return [createVisiblePaneFocusRect(layout.sessionId, [layout.sessionId], rect)];
  }

  if (layout.kind === "tabs") {
    const visibleTabSessionIds = layout.sessionIds.filter((sessionId) =>
      visibleSessionIds.has(sessionId),
    );
    if (visibleTabSessionIds.length === 0) {
      return [];
    }
    const activeSessionId =
      layout.activeSessionId && visibleSessionIds.has(layout.activeSessionId)
        ? layout.activeSessionId
        : visibleTabSessionIds[0];
    return [createVisiblePaneFocusRect(activeSessionId, visibleTabSessionIds, rect)];
  }

  /**
   * CDXC:PaneFocus 2026-05-29-06:35:
   * Directional focus geometry must match the native visible pane layout.
   * Hidden paneLayout nodes keep their tree position for session restoration, but they do not occupy focus-navigation space once they are absent from visibleSessionIds.
   */
  const visibleChildren = layout.children.filter((child) =>
    paneLayoutNodeHasVisibleSession(child, visibleSessionIds),
  );
  const childRects = getSplitChildRects(
    visibleChildren.length,
    layout.direction,
    visibleChildren.length === layout.children.length ? layout.ratio : undefined,
    rect,
  );
  return visibleChildren.flatMap((child, index) =>
    collectVisiblePaneFocusRects(child, visibleSessionIds, childRects[index] ?? rect),
  );
}

function paneLayoutNodeHasVisibleSession(
  layout: SessionPaneLayoutNode,
  visibleSessionIds: Set<string>,
): boolean {
  if (layout.kind === "leaf") {
    return visibleSessionIds.has(layout.sessionId);
  }
  if (layout.kind === "tabs") {
    return layout.sessionIds.some((sessionId) => visibleSessionIds.has(sessionId));
  }
  return layout.children.some((child) => paneLayoutNodeHasVisibleSession(child, visibleSessionIds));
}

function createVisiblePaneFocusRect(
  sessionId: string,
  sessionIds: string[],
  rect: Pick<VisiblePaneFocusRect, "bottom" | "left" | "right" | "top">,
): VisiblePaneFocusRect {
  return {
    ...rect,
    centerX: (rect.left + rect.right) / 2,
    centerY: (rect.top + rect.bottom) / 2,
    sessionId,
    sessionIds,
  };
}

function getSplitChildRects(
  childCount: number,
  direction: Extract<SessionPaneLayoutNode, { kind: "split" }>["direction"],
  ratio: number | undefined,
  rect: Pick<VisiblePaneFocusRect, "bottom" | "left" | "right" | "top">,
): Pick<VisiblePaneFocusRect, "bottom" | "left" | "right" | "top">[] {
  if (childCount === 0) {
    return [];
  }

  const ratios = getSplitChildRatios(childCount, ratio);
  let cursor = direction === "horizontal" ? rect.left : rect.top;
  return ratios.map((ratio) => {
    if (direction === "horizontal") {
      const width = (rect.right - rect.left) * ratio;
      const childRect = { ...rect, left: cursor, right: cursor + width };
      cursor += width;
      return childRect;
    }

    const height = (rect.bottom - rect.top) * ratio;
    const childRect = { ...rect, bottom: cursor + height, top: cursor };
    cursor += height;
    return childRect;
  });
}

function getSplitChildRatios(childCount: number, ratio: number | undefined): number[] {
  if (childCount === 2 && typeof ratio === "number" && ratio > 0 && ratio < 1) {
    return [ratio, 1 - ratio];
  }
  return Array.from({ length: childCount }, () => 1 / childCount);
}

function findDirectionalPaneFocusRect(
  panes: VisiblePaneFocusRect[],
  currentPane: VisiblePaneFocusRect,
  direction: SessionGridDirection,
): VisiblePaneFocusRect | undefined {
  const epsilon = 0.000001;
  const candidates = panes
    .filter((pane) => pane !== currentPane)
    .map((pane) => {
      const primaryGap = getPanePrimaryGap(currentPane, pane, direction);
      if (primaryGap < -epsilon) {
        return undefined;
      }

      const crossDistance =
        direction === "left" || direction === "right"
          ? Math.abs(pane.centerY - currentPane.centerY)
          : Math.abs(pane.centerX - currentPane.centerX);
      const rangesOverlap =
        direction === "left" || direction === "right"
          ? rangesIntersect(currentPane.top, currentPane.bottom, pane.top, pane.bottom)
          : rangesIntersect(currentPane.left, currentPane.right, pane.left, pane.right);
      /**
       * CDXC:PaneFocus 2026-05-29-06:35:
       * Directional focus follows pane adjacency, not center-point drift.
       * A tall right-hand pane can have a lower center than a top-left pane, but Down must choose the pane whose top edge is below the current pane and whose horizontal range overlaps the current column.
       *
       * CDXC:PaneFocus 2026-05-29-06:35:
       * In 4-way splits, Right from top-left must choose the top-right pane before the bottom-right pane.
       * Treat positive cross-axis overlap as a hard preference and do not count edge-touching as overlap, because touching only at the split boundary is not the same row or column.
       */
      return {
        pane,
        score: (rangesOverlap ? 0 : 1000) + Math.max(primaryGap, 0) * 100 + crossDistance,
      };
    })
    .filter((candidate): candidate is { pane: VisiblePaneFocusRect; score: number } =>
      Boolean(candidate),
    )
    .sort((a, b) => a.score - b.score);

  return candidates[0]?.pane;
}

function getPanePrimaryGap(
  currentPane: VisiblePaneFocusRect,
  pane: VisiblePaneFocusRect,
  direction: SessionGridDirection,
): number {
  if (direction === "left") {
    return currentPane.left - pane.right;
  }
  if (direction === "right") {
    return pane.left - currentPane.right;
  }
  if (direction === "up") {
    return currentPane.top - pane.bottom;
  }
  return pane.top - currentPane.bottom;
}

function rangesIntersect(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.max(startA, startB) < Math.min(endA, endB);
}
