import { describe, expect, test } from "vitest";
import type { CommandsPanelState, TerminalSessionRecord } from "../../shared/session-grid-contract";
import {
  createCommandsPanelOpenStatePatch,
  normalizeLiveCommandsPanelState,
} from "./native-command-panel-local-state";

describe("native command panel local state", () => {
  test("preserves live local command tab fields without restoring legacy command sessions", () => {
    /*
    CDXC:ProjectSidebarOwnership 2026-06-02-17:06:
    Runtime command-panel normalization must not reuse the WK-storage sanitizer. macOS owns live command-panel tab placement and immediate tab chrome, while gxserver owns canonical P/G command-session lifecycle and metadata; old non-G command rows must still be dropped before they can act like shared sessions.
    */
    const commandSession: TerminalSessionRecord = {
      alias: "Action",
      column: 7,
      commandTitle: "Build",
      createdAt: "2026-06-02T10:00:00.000Z",
      displayId: "00",
      isPinned: true,
      isSleeping: true,
      kind: "terminal",
      lastActivityAt: "2026-06-02T10:04:00.000Z",
      restoreActivity: "working",
      row: 3,
      sessionId: "G1abc",
      sessionPersistenceName: "P1abc-G1abc",
      sessionPersistenceProvider: "zmx",
      slotIndex: 5,
      surface: "commands",
      terminalEngine: "ghostty-native",
      title: "Build",
      titleSource: "user",
    };
    const legacySession: TerminalSessionRecord = {
      alias: "Legacy",
      column: 0,
      createdAt: "2026-06-02T10:00:00.000Z",
      displayId: "legacy",
      kind: "terminal",
      row: 0,
      sessionId: "g-local-command",
      slotIndex: 0,
      surface: "commands",
      terminalEngine: "ghostty-native",
      title: "Legacy",
      titleSource: "user",
    };
    const state: CommandsPanelState = {
      activeSessionId: "missing-active",
      heightRatio: 2,
      isVisible: true,
      mode: "floating",
      paneLayout: {
        activeSessionId: "g-local-command",
        kind: "tabs",
        sessionIds: ["g-local-command", "G1abc", "G1abc"],
      },
      sessions: [legacySession, commandSession],
    };

    const normalized = normalizeLiveCommandsPanelState(state);

    expect(normalized.activeSessionId).toBe("G1abc");
    expect(normalized.heightRatio).toBe(0.9);
    expect(normalized.isVisible).toBe(true);
    expect(normalized.mode).toBe("floating");
    expect(normalized.paneLayout).toEqual({ kind: "leaf", sessionId: "G1abc" });
    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.sessions[0]).toMatchObject({
      commandTitle: "Build",
      displayId: "00",
      isPinned: true,
      isSleeping: true,
      lastActivityAt: "2026-06-02T10:04:00.000Z",
      restoreActivity: "working",
      sessionId: "G1abc",
      sessionPersistenceName: "P1abc-G1abc",
      sessionPersistenceProvider: "zmx",
      slotIndex: 0,
      surface: "commands",
      title: "Build",
      titleSource: "user",
    });
  });

  test("opens hidden command panels at the configured default height", () => {
    /*
    CDXC:CommandsPanel 2026-06-04-18:50:
    Titlebar Action launches must use Command Pane Default Height when revealing a hidden Commands panel, matching F12 and resize-rail reset behavior.
    */
    const state: CommandsPanelState = {
      activeSessionId: "G1abc",
      heightRatio: 0.75,
      isVisible: false,
      mode: "floating",
      sessions: [],
    };

    const patch = createCommandsPanelOpenStatePatch(state, {
      defaultHeightPx: 180,
      workspaceHeightPx: 600,
    });

    expect(patch).toEqual({
      heightRatio: 0.3,
      isVisible: true,
      mode: "floating",
    });
  });

  test("preserves visible command panel height while selecting or adding command tabs", () => {
    /*
    CDXC:CommandsPanel 2026-06-04-18:50:
    Running another titlebar Action while the Commands panel is already visible should not undo the user's live command-pane resize.
    */
    const state: CommandsPanelState = {
      activeSessionId: "G1abc",
      heightRatio: 0.42,
      isVisible: true,
      mode: "pinned",
      sessions: [],
    };

    const patch = createCommandsPanelOpenStatePatch(state, {
      defaultHeightPx: 180,
      workspaceHeightPx: 600,
    });

    expect(patch).toEqual({
      heightRatio: 0.42,
      isVisible: true,
      mode: "pinned",
    });
  });
});
