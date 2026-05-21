import {
  FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS,
  type FirstLaunchSetupMainSettingKey,
} from "../shared/first-launch-setup-settings";
import type { SidebarTheme } from "../shared/session-grid-contract";
import type { ghostexSettings } from "../shared/ghostex-settings";
import { SettingsModal } from "./settings-modal";
import type { WebviewApi } from "./webview-api";

export type FirstLaunchSetupModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onChange: (settings: ghostexSettings) => void;
  settings?: ghostexSettings;
  theme?: SidebarTheme;
  vscode?: WebviewApi;
};

/**
 * CDXC:FirstLaunchSetup 2026-05-19-11:20:
 * First launch setup reuses the Settings main tab in a filtered presentation
 * that appears after Tips & Tricks on the first app run. Add keys to
 * FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS as product requirements define the
 * onboarding surface.
 */
export function FirstLaunchSetupModal({
  isOpen,
  onClose,
  onChange,
  settings,
  theme,
  vscode,
}: FirstLaunchSetupModalProps) {
  return (
    <SettingsModal
      firstLaunchSetupVisibleSettings={FIRST_LAUNCH_SETUP_VISIBLE_MAIN_SETTINGS}
      isOpen={isOpen}
      onChange={onChange}
      onClose={onClose}
      presentation="firstLaunchSetup"
      settings={settings}
      theme={theme}
      vscode={vscode}
    />
  );
}

export type { FirstLaunchSetupMainSettingKey };
