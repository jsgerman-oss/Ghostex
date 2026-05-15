import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsModal } from "./settings-modal";
import { DEFAULT_ghostex_SETTINGS, type ghostexSettings } from "../shared/ghostex-settings";

const modalSettings: ghostexSettings = {
  ...DEFAULT_ghostex_SETTINGS,
  agentManagerZoomPercent: 95,
  completionBellEnabled: true,
  showCloseButtonOnSessionCards: true,
  showHotkeysOnSessionCards: true,
  terminalFontSize: 16,
  terminalFontWeight: 400,
  terminalLineHeight: 1.35,
  workspacePaneGap: 16,
};

function SettingsModalStory({
  accessibilityPermissionGranted,
  initialSettings = modalSettings,
}: {
  accessibilityPermissionGranted?: boolean;
  initialSettings?: ghostexSettings;
}) {
  const [settings, setSettings] = useState<ghostexSettings>(initialSettings);

  return (
    <div
      style={{
        background: "#050505",
        height: "100vh",
        width: "100vw",
      }}
    >
      <SettingsModal
        accessibilityPermissionGranted={accessibilityPermissionGranted}
        isOpen
        onChange={setSettings}
        onClose={() => undefined}
        settings={settings}
        theme={settings.sidebarTheme === "light-orange" ? "light-orange" : "dark-blue"}
      />
    </div>
  );
}

const meta = {
  title: "Sidebar/Settings Modal",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <SettingsModalStory />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DarkGray: Story = {
  render: () => (
    <SettingsModalStory
      initialSettings={{
        ...modalSettings,
        sidebarTheme: "plain",
      }}
    />
  ),
};

export const AccessibilityOff: Story = {
  render: () => <SettingsModalStory accessibilityPermissionGranted={false} />,
};

export const LightOrange: Story = {
  render: () => (
    <SettingsModalStory
      initialSettings={{
        ...modalSettings,
        sidebarTheme: "light-orange",
      }}
    />
  ),
};
