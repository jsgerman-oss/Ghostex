import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FirstLaunchSetupModal } from "./first-launch-setup-modal";
import { DEFAULT_ghostex_SETTINGS, type ghostexSettings } from "../shared/ghostex-settings";
import type { SidebarAgentHookStatusMessage } from "../shared/session-grid-contract";
import { DEFAULT_SIDEBAR_AGENTS } from "../shared/sidebar-agents";

const initialHookStatus: SidebarAgentHookStatusMessage = {
  agents: DEFAULT_SIDEBAR_AGENTS.filter((agent) => agent.agentId !== "t3").map((agent, index) => {
    const status = index < 4 ? "installed" : index < 10 ? "missing" : "cliMissing";
    return {
      agentId: agent.agentId,
      cliCommand: agent.command.split(" ")[0] ?? agent.command,
      cliInstalled: status !== "cliMissing",
      detail:
        status === "installed"
          ? "Hook config is installed."
          : status === "cliMissing"
            ? "CLI was not found on PATH."
            : "Hook config is not installed yet.",
      hookInstalled: status === "installed",
      paths: [`~/.ghostex/mock-hooks/${agent.agentId}.json`],
      status,
    };
  }),
  generatedAt: "2026-05-26T06:23:00.000Z",
  hookStateDirectory: "~/.ghostexterm",
  notifyHookPath: "~/.ghostexterm/notify-agent-status.js",
  type: "agentHookStatus",
};

function installedHookStatus(): SidebarAgentHookStatusMessage {
  return {
    ...initialHookStatus,
    agents: initialHookStatus.agents.map((agent) =>
      agent.cliInstalled
        ? {
            ...agent,
            detail: "Hook config is installed.",
            hookInstalled: true,
            status: "installed",
          }
        : agent,
    ),
  };
}

function FirstLaunchSetupModalStory() {
  const [settings, setSettings] = useState<ghostexSettings>(DEFAULT_ghostex_SETTINGS);
  const [agentHookStatus, setAgentHookStatus] =
    useState<SidebarAgentHookStatusMessage>(initialHookStatus);
  const [agentHookStatusLoading, setAgentHookStatusLoading] = useState(false);

  const installHooks = () => {
    setAgentHookStatusLoading(true);
    window.setTimeout(() => {
      setAgentHookStatus(installedHookStatus());
      setAgentHookStatusLoading(false);
    }, 500);
  };

  return (
    <div className="first-launch-setup-story-frame">
      <FirstLaunchSetupModal
        agentHookStatus={agentHookStatus}
        agentHookStatusLoading={agentHookStatusLoading}
        isOpen
        onChange={setSettings}
        onClose={() => undefined}
        onInstallAgentHooks={installHooks}
        onRequestAgentHookStatus={() => {
          setAgentHookStatusLoading(true);
          window.setTimeout(() => setAgentHookStatusLoading(false), 350);
        }}
        settings={settings}
        theme="dark-blue"
      />
    </div>
  );
}

const meta = {
  title: "Sidebar/First Launch Setup Modal",
  parameters: {
    layout: "fullscreen",
  },
  render: () => <FirstLaunchSetupModalStory />,
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Intro: Story = {};
