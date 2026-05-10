import { describe, expect, test } from "vitest";
import {
  DEFAULT_zmux_HOTKEYS,
  normalizeHotkeyText,
  normalizezmuxHotkeySettings,
} from "./zmux-hotkeys";

describe("normalizezmuxHotkeySettings", () => {
  test("uses single-chord defaults for split count hotkeys", () => {
    /**
     * CDXC:Hotkeys 2026-05-10-12:06
     * View/split count defaults must be real single key equivalents so AppKit
     * can dispatch them while Ghostty has focus. The previous prefix sequence
     * looked strange in Settings and did not reliably reach the second key.
     */
    expect(DEFAULT_zmux_HOTKEYS.showOne).toBe("cmd+ctrl+1");
    expect(DEFAULT_zmux_HOTKEYS.showTwo).toBe("cmd+ctrl+2");
    expect(DEFAULT_zmux_HOTKEYS.showThree).toBe("cmd+ctrl+3");
  });

  test("uses direct split more and split less defaults", () => {
    /**
     * CDXC:Hotkeys 2026-05-10-12:31
     * Cmd+D and Cmd+Shift+D both mean Split More, matching terminal sideways
     * and downward split defaults. Split Less uses a separate non-close chord.
     */
    expect(DEFAULT_zmux_HOTKEYS.splitMore).toBe("cmd+d");
    expect(DEFAULT_zmux_HOTKEYS.splitMoreDown).toBe("cmd+shift+d");
    expect(DEFAULT_zmux_HOTKEYS.splitLess).toBe("cmd+ctrl+shift+d");
  });

  test("preserves user-defined split count hotkeys without migration", () => {
    expect(
      normalizezmuxHotkeySettings({
        showOne: "cmd+alt+s 1",
        showTwo: "cmd+alt+s 2",
        showThree: "cmd+alt+s 3",
      }),
    ).toMatchObject({
      showOne: "cmd+alt+s 1",
      showTwo: "cmd+alt+s 2",
      showThree: "cmd+alt+s 3",
    });
  });
});

describe("normalizeHotkeyText", () => {
  test("accepts TanStack recorder Mod output", () => {
    expect(normalizeHotkeyText("Mod+Alt+1")).toBe("cmd+alt+1");
  });
});
