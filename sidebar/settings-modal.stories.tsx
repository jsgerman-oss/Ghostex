import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsModal } from "./settings-modal";
import { DEFAULT_ghostex_SETTINGS, type ghostexSettings } from "../shared/ghostex-settings";
import { DEFAULT_SIDEBAR_AGENTS } from "../shared/sidebar-agents";
import type {
  SidebarAgentHookStatusMessage,
  SidebarGhostexCliStatusMessage,
} from "../shared/session-grid-contract";

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
  cuaPermissionsGranted,
  initialSettings = modalSettings,
  initialTab = "settings",
}: {
  cuaPermissionsGranted?: boolean;
  initialSettings?: ghostexSettings;
  initialTab?: "settings" | "ghostty" | "integrations" | "projects" | "agents" | "actions" | "openTargets" | "hotkeys";
}) {
  const [settings, setSettings] = useState<ghostexSettings>(initialSettings);
  const [agentHookStatus, setAgentHookStatus] = useState<SidebarAgentHookStatusMessage>({
    agents: DEFAULT_SIDEBAR_AGENTS.filter((agent) => agent.agentId !== "t3").map((agent, index) => ({
      agentId: agent.agentId,
      cliCommand: agent.command.split(" ")[0] ?? agent.command,
      cliInstalled: index < 10,
      detail: index < 4 ? "Hook config is installed." : "Hook config is not installed.",
      hookInstalled: index < 4,
      paths: [`~/.ghostex/mock-hooks/${agent.agentId}.json`],
      status: index < 4 ? "installed" : index < 10 ? "missing" : "cliMissing",
    })),
    generatedAt: "2026-05-27T04:17:00.000Z",
    hookStateDirectory: "~/.ghostexterm",
    notifyHookPath: "~/.ghostexterm/notify-agent-status.js",
    type: "agentHookStatus",
  });
  const [ghostexCliStatus, setGhostexCliStatus] = useState<SidebarGhostexCliStatusMessage>({
    browserSkillInstalled: false,
    computerUseSkillInstalled: false,
    cuaAppInstalled: false,
    cuaDriverAccessibilityPermissionGranted: cuaPermissionsGranted,
    cuaDriverInstalled: cuaPermissionsGranted !== undefined,
    cuaDriverScreenRecordingPermissionGranted: cuaPermissionsGranted,
    detail: "ghostex is available on PATH. Ghostex Browser Use and Ghostex Computer Use are not installed yet.",
    generatedAt: "2026-05-27T04:17:00.000Z",
    ghostexPath: "/opt/homebrew/bin/ghostex",
    gxBlockedByExistingCommand: false,
    gxUsable: false,
    installed: true,
    type: "ghostexCliStatus",
  });

  return (
    <div
      style={{
        background: "#050505",
        height: "100vh",
        width: "100vw",
      }}
    >
      <SettingsModal
        agentHookStatus={agentHookStatus}
        ghostexCliStatus={ghostexCliStatus}
        initialTab={initialTab}
        isOpen
        onChange={setSettings}
        onClose={() => undefined}
        onInstallAgentHooks={() =>
          setAgentHookStatus({
            ...agentHookStatus,
            agents: agentHookStatus.agents.map((agent) =>
              agent.cliInstalled
                ? { ...agent, detail: "Hook config is installed.", hookInstalled: true, status: "installed" }
                : agent,
            ),
          })
        }
        onInstallBrowserControl={() =>
          setGhostexCliStatus({
            ...ghostexCliStatus,
            browserSkillInstalled: true,
            browserSkillPath: "/Users/madda/agents/skills/ghostex-browser-use/SKILL.md",
          })
        }
        onInstallCuaDriver={() =>
          setGhostexCliStatus({
            ...ghostexCliStatus,
            computerUseSkillInstalled: true,
            computerUseSkillPath: "/Users/madda/agents/skills/ghostex-computer-use/SKILL.md",
            cuaAppInstalled: true,
            cuaDriverAccessibilityPermissionGranted: true,
            cuaDriverInstalled: true,
            cuaDriverPath: "/Users/madda/.local/bin/cua-driver",
            cuaDriverScreenRecordingPermissionGranted: true,
          })
        }
        onInstallGhostexCli={() => setGhostexCliStatus({ ...ghostexCliStatus, installed: true })}
        onOpenAccessibilityPreferences={() => undefined}
        onOpenFirstLaunchSetup={() => undefined}
        onOpenScreenRecordingPreferences={() => undefined}
        onRequestAgentHookStatus={() => undefined}
        onRequestGhostexCliStatus={() => undefined}
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
  render: () => <SettingsModalStory cuaPermissionsGranted={false} />,
};

export const Integrations: Story = {
  render: () => <SettingsModalStory cuaPermissionsGranted={false} initialTab="integrations" />,
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

export const NarrowModal: Story = {
  parameters: {
    viewport: {
      defaultViewport: "narrowSettings",
      viewports: {
        narrowSettings: {
          name: "Narrow settings modal",
          styles: {
            height: "900px",
            width: "520px",
          },
        },
      },
    },
  },
  render: () => <SettingsModalStory />,
};
