import type { ghostexSettings } from "./ghostex-settings";

export const FIRST_LAUNCH_SETUP_SEEN_STORAGE_KEY = "ghostex-native-first-launch-setup-seen";

/**
 * CDXC:FirstLaunchSetup 2026-05-19-11:20:
 * First launch setup reuses the Settings main tab with a filtered subset of
 * controls. Add setting keys to this list as product requirements specify which
 * options appear in the post-tips onboarding modal.
 *
 * CDXC:FirstLaunchPreferences 2026-05-31-07:10:
 * ZMU-71: the first-time defaults step must include keepAwakePreventLidSleep
 * ("Keep awake when lid is closed") alongside the other high-impact toggles on
 * FirstLaunchPreferencesPage. Keep this list aligned with that page.
 *
 * CDXC:FirstLaunchPreferences 2026-06-04-21:02:
 * The first-time defaults modal must also expose the first-prompt title
 * generation agent selector so new installs can choose Codex, Cursor, Claude,
 * Grok Build, or Custom before automatic session naming runs.
 */
export type FirstLaunchSetupMainSettingKey =
  | keyof ghostexSettings
  | "accessibilityPermission"
  | "attentionNotificationActions"
  | "ghostexFolderStats"
  | "ghosttySettingsActions"
  | "sidebarSettingsPreset";

export const FIRST_LAUNCH_PREFERENCES_MAIN_SETTING_KEYS = [
  "sidebarSettingsPreset",
  "defaultPromptAgentId",
  "sessionTitleGenerationAgent",
  "customSessionTitleGenerationCommand",
  "keepAwakePreventLidSleep",
  "agentAcceptAllEnabled",
  "showMacOSAttentionNotifications",
  "completionBellEnabled",
] as const satisfies readonly FirstLaunchSetupMainSettingKey[];

export const FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS = new Set<FirstLaunchSetupMainSettingKey>(
  FIRST_LAUNCH_PREFERENCES_MAIN_SETTING_KEYS,
);

export function isFirstLaunchSetupMainSettingVisible(
  settingKey: FirstLaunchSetupMainSettingKey,
  visibleSettings: ReadonlySet<FirstLaunchSetupMainSettingKey> = FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS,
): boolean {
  return visibleSettings.has(settingKey);
}
