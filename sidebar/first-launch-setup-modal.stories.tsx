import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  FirstLaunchSetupModal,
  type FirstLaunchSetupPage,
} from "./first-launch-setup-modal";
import { DEFAULT_ghostex_SETTINGS, type ghostexSettings } from "../shared/ghostex-settings";
import type {
  SidebarAgentHookStatusMessage,
  SidebarGhostexCliStatusMessage,
} from "../shared/session-grid-contract";
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

const installedCliStatus: SidebarGhostexCliStatusMessage = {
  browserSkillInstalled: true,
  browserSkillPath: "/Users/madda/agents/skills/ghostex-browser-devtools-mcp/SKILL.md",
  detail: "ghostex is available on PATH. gx is not currently linked, so Ghostex will keep using the primary command until the alias can be installed safely. Browser MCP skill is installed for agents.",
  generatedAt: "2026-05-26T13:12:00.000Z",
  ghostexPath: "/opt/homebrew/bin/ghostex",
  gxBlockedByExistingCommand: false,
  gxUsable: false,
  installed: true,
  type: "ghostexCliStatus",
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

function FirstLaunchSetupModalStory({
  cliInstalled = true,
  initialPage = "hooks",
}: {
  cliInstalled?: boolean;
  initialPage?: FirstLaunchSetupPage;
}) {
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
        ghostexCliStatus={cliInstalled ? installedCliStatus : undefined}
        initialPage={initialPage}
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
  render: (args) => (
    <FirstLaunchSetupModalStory
      cliInstalled={args.cliInstalled}
      initialPage={args.initialPage}
    />
  ),
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Intro: Story = {
  args: {
    cliInstalled: true,
    initialPage: "hooks",
  },
};

export const Cli: Story = {
  args: {
    cliInstalled: true,
    initialPage: "cli",
  },
};

export const CliNeedsInstall: Story = {
  args: {
    cliInstalled: false,
    initialPage: "cli",
  },
};
