import { describe, expect, test } from "vitest";
import {
  FIRST_LAUNCH_PREFERENCES_MAIN_SETTING_KEYS,
  FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS,
  isFirstLaunchSetupMainSettingVisible,
} from "./first-launch-setup-settings";

describe("first launch setup visible settings", () => {
  test("exposes keep awake when lid closed on the first-launch defaults step", () => {
    /**
     * CDXC:FirstLaunchPreferences 2026-05-31-07:10:
     * ZMU-71 requires the lid-close keep-awake preference on the first-time
     * defaults page so new installs can opt in before using Keep Awake.
     */
    expect(
      isFirstLaunchSetupMainSettingVisible(
        "keepAwakePreventLidSleep",
        FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS,
      ),
    ).toBe(true);
    expect(FIRST_LAUNCH_PREFERENCES_MAIN_SETTING_KEYS).toContain("keepAwakePreventLidSleep");
  });

  test("exposes title generation agent settings on the first-launch defaults step", () => {
    /**
     * CDXC:FirstLaunchPreferences 2026-06-04-21:02:
     * The first-time modal must expose the same first-prompt title-generation
     * agent selector as Settings so new installs can choose Codex, Cursor,
     * Claude, Grok Build, or Custom before automatic session naming runs.
     */
    expect(
      isFirstLaunchSetupMainSettingVisible(
        "sessionTitleGenerationAgent",
        FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS,
      ),
    ).toBe(true);
    expect(FIRST_LAUNCH_PREFERENCES_MAIN_SETTING_KEYS).toContain(
      "sessionTitleGenerationAgent",
    );
    expect(FIRST_LAUNCH_PREFERENCES_MAIN_SETTING_KEYS).toContain(
      "customSessionTitleGenerationCommand",
    );
  });
});
