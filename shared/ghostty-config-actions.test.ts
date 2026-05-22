import { describe, expect, test } from "vitest";
import {
  mergeGhosttyConfigLines,
  GHOSTEX_RECOMMENDED_GHOSTTY_CONFIG_LINES,
} from "./ghostty-config-actions";

describe("mergeGhosttyConfigLines", () => {
  test("applies recommended Ghostty settings without removing unrelated config", () => {
    /**
     * CDXC:GhosttySettings 2026-04-30-01:48
     * Applying recommended settings must replace ghostex-managed Ghostty keys but
     * retain user-owned settings such as keybinds.
     * CDXC:Branding 2026-05-12-07:35
     * The inserted marker is user-visible in Ghostty config, so it should use
     * Ghostex even though the managed-key constants keep their ghostex prefix.
     */
    expect(
      mergeGhosttyConfigLines(
        [
          "keybind = cmd+t=new_tab",
          "keybind = super+e=previous_value",
          "palette = 1=#ff0000",
          "palette = 6=#old",
          "theme = Dracula",
          "font-size = 18",
          "window-padding-x = 4",
        ].join("\n"),
        GHOSTEX_RECOMMENDED_GHOSTTY_CONFIG_LINES,
      ),
    ).toContain(
      [
        "keybind = cmd+t=new_tab",
        "palette = 1=#ff0000",
        "window-padding-x = 4",
        "# Applied by Ghostex:",
        "theme = GitHub Dark",
      ].join("\n"),
    );
    expect(
      mergeGhosttyConfigLines(
        ["keybind = super+e=previous_value", "palette = 6=#old"].join("\n"),
        GHOSTEX_RECOMMENDED_GHOSTTY_CONFIG_LINES,
      ),
    ).not.toContain("previous_value");
  });

  test("resets ghostex-managed Ghostty settings to defaults", () => {
    expect(
      mergeGhosttyConfigLines(
        ["theme = Dracula", "font-size = 18", "window-padding-x = 4"].join("\n"),
        [],
      ),
    ).toBe("window-padding-x = 4\n");
  });
});
