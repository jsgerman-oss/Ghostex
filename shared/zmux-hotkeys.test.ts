import { describe, expect, test } from "vitest";
import {
  DEFAULT_zmux_HOTKEYS,
  normalizeHotkeyText,
  normalizezmuxHotkeySettings,
} from "./zmux-hotkeys";

describe("normalizezmuxHotkeySettings", () => {
  test("uses cmd-first navigation defaults", () => {
    /**
     * CDXC:Hotkeys 2026-05-11-09:26
     * Everyday navigation defaults should use plain Cmd where possible, with
     * Ctrl reserved for direct group slots after Cmd+number is assigned to
     * session slots.
     */
    expect(DEFAULT_zmux_HOTKEYS.createSession).toBe("cmd+n");
    expect(DEFAULT_zmux_HOTKEYS.openSettings).toBe("cmd+,");
    expect(DEFAULT_zmux_HOTKEYS.focusPreviousSession).toBe("cmd+[");
    expect(DEFAULT_zmux_HOTKEYS.focusNextSession).toBe("cmd+]");
    expect(DEFAULT_zmux_HOTKEYS.focusPreviousGroup).toBe("cmd+shift+[");
    expect(DEFAULT_zmux_HOTKEYS.focusNextGroup).toBe("cmd+shift+]");
    expect(DEFAULT_zmux_HOTKEYS.focusGroup1).toBe("cmd+ctrl+1");
    expect(DEFAULT_zmux_HOTKEYS.focusSessionSlot1).toBe("cmd+1");
  });

  test("uses direct split creation defaults", () => {
    /**
     * CDXC:NativeSplits 2026-05-10-18:30
     * Cmd+D and Cmd+Shift+D create real terminal splits in the native
     * workspace.
     */
    expect(DEFAULT_zmux_HOTKEYS.splitMore).toBe("cmd+d");
    expect(DEFAULT_zmux_HOTKEYS.splitMoreDown).toBe("cmd+shift+d");
  });

  test("drops retired visible-count hotkeys during normalization", () => {
    expect(
      normalizezmuxHotkeySettings({
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
      normalizezmuxHotkeySettings({
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
