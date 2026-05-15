import { describe, expect, test } from "vitest";
import {
  DEFAULT_ghostex_HOTKEYS,
  getghostexHotkeyActionIdForKey,
  normalizeHotkeyText,
  normalizeghostexHotkeySettings,
} from "./ghostex-hotkeys";

describe("normalizeghostexHotkeySettings", () => {
  test("uses cmd-first navigation defaults", () => {
    /**
     * CDXC:Hotkeys 2026-05-11-09:26
     * Everyday navigation defaults should use plain Cmd where possible, with
     * Ctrl reserved for direct group slots after Cmd+number is assigned to
     * session slots.
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
        focusPreviousGroup: "cmd+shift+[",
        focusPreviousSession: "cmd+[",
      }),
    ).toMatchObject({
      focusNextGroup: "cmd+]",
      focusNextSession: "cmd+tab",
      focusPreviousGroup: "cmd+[",
      focusPreviousSession: "cmd+shift+tab",
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
