import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string): string {
  const startIndex = terminalWorkspaceSource.indexOf(start);
  const endIndex = terminalWorkspaceSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return terminalWorkspaceSource.slice(startIndex, endIndex);
}

describe("native command panel focus source", () => {
  test("repaints command-pane border after programmatic first responder focus", () => {
    /*
     * CDXC:CommandsPanel 2026-06-13-21:06:
     * Pressing F12 twice can leave typing focus in the command pane while the
     * visible active border stays on the previous workspace terminal. Source
     * coverage keeps focusTerminal repainting pane chrome after AppKit accepts
     * the command terminal as first responder, because command borders are
     * gated by commandPanelFocusedResponderSessionId().
     */
    const focusTerminalSource = sourceBetween(
      "func focusTerminal(sessionId rawSessionId: String",
      "private func refreshZmxPersistenceTerminalIfFocusOrSurfaceChanged",
    );
    const firstResponderResultIndex = focusTerminalSource.indexOf(
      "let makeFirstResponderResult = targetWindow?.makeFirstResponder(view) ?? false",
    );
    const appliedFirstResponderIndex = focusTerminalSource.indexOf(
      "let didApplyFirstResponder = makeFirstResponderResult || targetWindow?.firstResponder === view",
      firstResponderResultIndex,
    );
    const repaintIndex = focusTerminalSource.indexOf(
      "updateAllTerminalBorders()",
      appliedFirstResponderIndex,
    );

    expect(focusTerminalSource).toContain(
      "let isCommandPanelSession = commandsPanelActiveSessionIds.contains(sessionId)",
    );
    expect(terminalWorkspaceSource).toContain("commandPanelFocusedResponderSessionId() == sessionId");
    expect(firstResponderResultIndex).toBeGreaterThanOrEqual(0);
    expect(appliedFirstResponderIndex).toBeGreaterThan(firstResponderResultIndex);
    expect(repaintIndex).toBeGreaterThan(appliedFirstResponderIndex);
  });
});
