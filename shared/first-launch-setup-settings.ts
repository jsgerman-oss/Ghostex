import type { ghostexSettings } from "./ghostex-settings";

export const FIRST_LAUNCH_SETUP_SEEN_STORAGE_KEY = "ghostex-native-first-launch-setup-seen";

/**
 * CDXC:FirstLaunchSetup 2026-05-19-11:20:
 * First launch setup reuses the Settings main tab with a filtered subset of
 * controls. Add setting keys to this list as product requirements specify which
 * options appear in the post-tips onboarding modal.
 */
export type FirstLaunchSetupMainSettingKey =
  | keyof ghostexSettings
  | "accessibilityPermission"
  | "attentionNotificationActions"
  | "ghostexFolderStats"
  | "ghosttySettingsActions"
  | "sidebarSettingsPreset";

export const FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS = new Set<FirstLaunchSetupMainSettingKey>([
  "agentAcceptAllEnabled",
]);

export function isFirstLaunchSetupMainSettingVisible(
  settingKey: FirstLaunchSetupMainSettingKey,
  visibleSettings: ReadonlySet<FirstLaunchSetupMainSettingKey> = FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS,
): boolean {
  return visibleSettings.has(settingKey);
}
