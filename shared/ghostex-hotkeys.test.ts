import { describe, expect, test } from "vitest";
import {
  DEFAULT_ghostex_HOTKEYS,
  getghostexHotkeyActionIdForKey,
  normalizeHotkeyText,
  normalizeghostexHotkeySettings,
} from "./ghostex-hotkeys";

describe("normalizeghostexHotkeySettings", () => {
  test("uses default navigation hotkeys without stealing command-arrow editing", () => {
    /**
     * CDXC:Hotkeys 2026-05-15-13:31:
     * Directional pane focus must avoid plain Cmd+Arrow so terminal prompts
     * and modal prompt editors keep native text navigation.
     */
    expect(DEFAULT_ghostex_HOTKEYS.createSession).toBe("cmd+n");
    /**
     * CDXC:Hotkeys 2026-05-14-08:09:
     * The Commands panel must remain bound to bare F12 so terminal-focused AppKit dispatch and sidebar-focused DOM dispatch agree on the same user shortcut.
     */
    expect(DEFAULT_ghostex_HOTKEYS.openCommandsPanel).toBe("f12");
    expect(DEFAULT_ghostex_HOTKEYS.openSettings).toBe("cmd+,");
    expect(DEFAULT_ghostex_HOTKEYS.focusPreviousSession).toBe("cmd+shift+tab");
    expect(DEFAULT_ghostex_HOTKEYS.focusNextSession).toBe("cmd+tab");
    expect(DEFAULT_ghostex_HOTKEYS.focusPreviousGroup).toBe("cmd+[");
    expect(DEFAULT_ghostex_HOTKEYS.focusNextGroup).toBe("cmd+]");
    expect(DEFAULT_ghostex_HOTKEYS.focusLeft).toBe("cmd+alt+left");
    expect(DEFAULT_ghostex_HOTKEYS.focusRight).toBe("cmd+alt+right");
    expect(DEFAULT_ghostex_HOTKEYS.focusUp).toBe("cmd+alt+up");
    expect(DEFAULT_ghostex_HOTKEYS.focusDown).toBe("cmd+alt+down");
    expect(DEFAULT_ghostex_HOTKEYS.focusGroup1).toBe("cmd+ctrl+1");
    expect(DEFAULT_ghostex_HOTKEYS.focusGroup5).toBe("cmd+ctrl+5");
    expect(DEFAULT_ghostex_HOTKEYS.focusSessionSlot1).toBe("cmd+1");
  });

  test("keeps browser bracket tab navigation as alternate defaults", () => {
    expect(getghostexHotkeyActionIdForKey(DEFAULT_ghostex_HOTKEYS, "cmd+shift+[")).toBe(
      "focusPreviousSession",
    );
    expect(getghostexHotkeyActionIdForKey(DEFAULT_ghostex_HOTKEYS, "cmd+shift+]")).toBe(
      "focusNextSession",
    );
  });

  test("does not match alternate defaults after clearing the primary hotkey", () => {
    const hotkeys = normalizeghostexHotkeySettings({
      focusNextSession: "",
      focusPreviousSession: "",
    });

    expect(getghostexHotkeyActionIdForKey(hotkeys, "cmd+shift+[")).toBeUndefined();
    expect(getghostexHotkeyActionIdForKey(hotkeys, "cmd+shift+]")).toBeUndefined();
  });

  test("migrates persisted old navigation defaults", () => {
    expect(
      normalizeghostexHotkeySettings({
        focusNextGroup: "cmd+shift+]",
        focusNextSession: "cmd+]",
        focusLeft: "cmd+left",
        focusPreviousGroup: "cmd+shift+[",
        focusPreviousSession: "cmd+[",
        focusRight: "cmd+right",
      }),
    ).toMatchObject({
      focusLeft: "cmd+alt+left",
      focusNextGroup: "cmd+]",
      focusNextSession: "cmd+tab",
      focusPreviousGroup: "cmd+[",
      focusPreviousSession: "cmd+shift+tab",
      focusRight: "cmd+alt+right",
    });
  });

  test("uses direct split creation defaults", () => {
    /**
     * CDXC:NativeSplits 2026-05-10-18:30
     * Cmd+D and Cmd+Shift+D create real terminal splits in the native
     * workspace.
     */
    expect(DEFAULT_ghostex_HOTKEYS.splitMore).toBe("cmd+d");
    expect(DEFAULT_ghostex_HOTKEYS.splitMoreDown).toBe("cmd+shift+d");
  });

  test("drops retired visible-count hotkeys during normalization", () => {
    expect(
      normalizeghostexHotkeySettings({
        showOne: "cmd+alt+s 1",
        showTwo: "cmd+alt+s 2",
        showThree: "cmd+alt+s 3",
      }),
    ).not.toHaveProperty("showOne");
  });

  test("keeps explicitly cleared hotkeys unassigned", () => {
    /**
     * CDXC:Hotkeys 2026-05-11-09:06
     * Clearing a binding from Settings must persist as an unassigned command,
     * while omitted settings continue to receive defaults.
     */
    expect(
      normalizeghostexHotkeySettings({
        splitMoreDown: "",
      }),
    ).toMatchObject({
      splitMore: "cmd+d",
      splitMoreDown: "",
    });
  });
});

describe("normalizeHotkeyText", () => {
  test("accepts TanStack recorder Mod output", () => {
    expect(normalizeHotkeyText("Mod+Alt+1")).toBe("cmd+alt+1");
  });
});
