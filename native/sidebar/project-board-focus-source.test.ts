import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Project Board native focus ownership source", () => {
  test("keeps Kanban focus ownership ahead of passive sidebar terminal restore", () => {
    /*
     * CDXC:ProjectBoardFocus 2026-06-12-08:44:
     * Passive sidebar hydration must restore recent Project/Kanban first responder ownership before falling back to terminal recovery, otherwise board typing can be routed into the companion terminal.
     */
    const passiveRestoreSource = sourceBetween(
      appDelegateSource,
      "private func restoreTerminalFocusAfterPassiveSidebarFirstResponder",
      "private func isSidebarResponder",
    );
    const projectEditorRestoreIndex = passiveRestoreSource.indexOf(
      "workspaceView.restoreProjectEditorFocusAfterPassiveSidebarFirstResponder(now: now)",
    );
    const terminalRestoreIndex = passiveRestoreSource.indexOf(
      "workspaceView.passiveSidebarReturnFocusTerminalSessionId()",
    );

    expect(projectEditorRestoreIndex).toBeGreaterThan(-1);
    expect(terminalRestoreIndex).toBeGreaterThan(projectEditorRestoreIndex);
    expect(terminalWorkspaceSource).toContain(
      "func restoreProjectEditorFocusAfterPassiveSidebarFirstResponder(now: Date = Date()) -> Bool",
    );
    expect(terminalWorkspaceSource).toContain("recentProjectEditorFocusOwnerState(now: now)");
    expect(terminalWorkspaceSource).toContain(
      'event: "nativeFocusTrace.passiveSidebarProjectEditorFirstResponderRestored"',
    );
  });

  test("cancels deferred companion focus when Kanban receives newer input", () => {
    /*
     * CDXC:ProjectBoardFocus 2026-06-12-08:44:
     * Sidebar focus commands are deferred, so they need a project-editor focus revision guard in both the queued dispatch and delayed reinforcement paths.
     */
    const sidebarFocusSource = sourceBetween(
      appDelegateSource,
      "private func focusWorkspaceSessionAfterSidebarActivation",
      "private func responderSnapshot() -> [String: Any]",
    );
    const queueRevisionIndex = sidebarFocusSource.indexOf(
      "let projectEditorFocusOwnerRevisionBeforeQueue =",
    );
    const dispatchGuardIndex = sidebarFocusSource.indexOf(
      "hasProjectEditorFocusOwnerChanged(\n        since: projectEditorFocusOwnerRevisionBeforeQueue)",
    );
    const reinforcementGuardIndex = sidebarFocusSource.lastIndexOf(
      "hasProjectEditorFocusOwnerChanged(\n        since: projectEditorFocusOwnerRevisionBeforeQueue)",
    );

    expect(queueRevisionIndex).toBeGreaterThan(-1);
    expect(dispatchGuardIndex).toBeGreaterThan(queueRevisionIndex);
    expect(reinforcementGuardIndex).toBeGreaterThan(dispatchGuardIndex);
    expect(sidebarFocusSource).toContain('"skipReason": "projectEditorFocusOwnerChangedAfterQueue"');
    expect(terminalWorkspaceSource).toContain(
      "scheduleDelayedProjectEditorCompanionClick(\n        sessionId: sessionId,\n        focusOwnerRevision: projectEditorFocusOwnerRevision)",
    );
    expect(terminalWorkspaceSource).toContain(
      "performDelayedProjectEditorCompanionClick(\n    sessionId: String,\n    focusOwnerRevision: UInt64",
    );
    expect(terminalWorkspaceSource).toContain('"skipReason": "projectEditorFocusOwnerChanged"');
  });

  test("tracks sanitized Project editor focus-owner state in native workspace", () => {
    /*
     * CDXC:ProjectBoardFocus 2026-06-12-08:44:
     * Native focus ownership should store only ids, event categories, timestamps, and revisions; it must not persist editor text or command content.
     */
    expect(terminalWorkspaceSource).toContain("private struct ProjectEditorFocusOwnerState");
    expect(terminalWorkspaceSource).toContain("let event: String");
    expect(terminalWorkspaceSource).toContain("let projectEditorId: String");
    expect(terminalWorkspaceSource).toContain("let recordedAt: Date");
    expect(terminalWorkspaceSource).toContain("let revision: UInt64");
    expect(terminalWorkspaceSource).toContain(
      'if request.action == "projectEditorFocusOwnerChanged"',
    );
    expect(terminalWorkspaceSource).toContain(
      "markProjectEditorFocusOwner(\n      projectEditorId: projectEditorId,\n      event: request.event ?? \"unknown\"",
    );
    expect(terminalWorkspaceSource).not.toContain("focusOwnerText");
    expect(terminalWorkspaceSource).not.toContain("focusOwnerCommand");
  });
});
