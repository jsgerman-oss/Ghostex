import {
  IconArrowRight,
  IconAlertTriangle,
  IconArrowLeft,
  IconBellRinging,
  IconBrandAndroid,
  IconBrandApple,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCircleX,
  IconDeviceMobile,
  IconDownload,
  IconInfoCircle,
  IconRefresh,
  IconSparkles,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { FirstLaunchSetupMainSettingKey } from "../shared/first-launch-setup-settings";
import type { SidebarTheme } from "../shared/session-grid-contract";
import type {
  SidebarAgentHookStatus,
  SidebarAgentHookStatusItem,
  SidebarAgentHookStatusMessage,
  SidebarGhostexCliStatusMessage,
} from "../shared/session-grid-contract";
import type { ghostexSettings } from "../shared/ghostex-settings";
import { DEFAULT_SIDEBAR_AGENTS } from "../shared/sidebar-agents";
import type { WebviewApi } from "./webview-api";
import ghostexIntroImage from "./assets/first-launch/ghostex-intro.png";
import ghostexMobileAndroidImage from "./assets/first-launch/ghostex-mobile-android.png";

export type FirstLaunchSetupPage = "hooks" | "cli";

export type FirstLaunchSetupModalProps = {
  agentHookStatus?: SidebarAgentHookStatusMessage;
  agentHookStatusLoading?: boolean;
  ghostexCliStatus?: SidebarGhostexCliStatusMessage;
  ghostexCliStatusLoading?: boolean;
  initialPage?: FirstLaunchSetupPage;
  isOpen: boolean;
  onClose: () => void;
  onChange: (settings: ghostexSettings) => void;
  onInstallAgentHooks?: () => void;
  onRequestAgentHookStatus?: () => void;
  settings?: ghostexSettings;
  theme?: SidebarTheme;
  vscode?: WebviewApi;
};

type FirstLaunchBenefit = {
  icon: ComponentType<{ className?: string; size?: number; stroke?: number }>;
  text: string;
  title: string;
};

const FIRST_LAUNCH_INTRO_BENEFITS: readonly FirstLaunchBenefit[] = [
  {
    icon: IconSparkles,
    text: "Keep parallel agent sessions, terminals, browsers, and project work in one native macOS workspace.",
    title: "Agent workspace",
  },
  {
    icon: IconBellRinging,
    text: "Surface In Progress and Needs Attention states without hunting through every terminal.",
    title: "Status awareness",
  },
  {
    icon: IconCircleCheck,
    text: "Name sessions automatically from the first message so the sidebar stays readable.",
    title: "Cleaner sessions",
  },
];

const FIRST_LAUNCH_HOOK_SUPPORTED_AGENTS = DEFAULT_SIDEBAR_AGENTS.filter(
  (agent) => agent.agentId !== "t3",
);

const FIRST_LAUNCH_CLI_COMMAND =
  "brew install --cask maddada/tap/ghostex --force && ghostex install-browser-skill";
const FIRST_LAUNCH_ANDROID_APK_URL =
  "https://github.com/maddada/Ghostex/releases/download/ghostex-android-v1.2.0/ghostex-1.2.0.apk";
const FIRST_LAUNCH_IOS_DISCORD_URL = "https://discord.gg/xYSBPapM";

type FirstLaunchHookStatusGroupId = "installed" | "missing" | "cliMissing" | "unknown";

type FirstLaunchHookStatusGroup = {
  agents: typeof FIRST_LAUNCH_HOOK_SUPPORTED_AGENTS;
  id: FirstLaunchHookStatusGroupId;
  title: string;
};

/**
 * CDXC:FirstLaunchSetup 2026-05-26-06:23:
 * First launch setup is the production onboarding flow, and Storybook must
 * mount this same component with mocked native calls instead of maintaining a
 * separate prototype. The first page introduces Ghostex, uses generated
 * product artwork, and asks for agent hooks because those hooks power desktop
 * notifications for In Progress / Needs Attention states and automatic
 * first-message session titles.
 *
 * CDXC:FirstLaunchSetup 2026-05-26-07:14:
 * The intro page should read as an app setup screen, not a marketing landing
 * page. Use a two-column body with intro copy and benefits on the left and the
 * README-derived workspace screenshot on the right, then a bordered hook setup
 * panel below so install actions and agent readiness stay prominent without a
 * full-width tinted band or scattered chips.
 *
 * CDXC:FirstLaunchSetup 2026-05-26-07:22:
 * Hook setup actions belong inside the bordered agent-status panel so the
 * install action is visually tied to the exact agent cards it updates. Do not
 * show a separate readiness summary line; grouped agent headers already expose
 * the counts, and refresh should be an icon-only control.
 *
 * CDXC:FirstLaunchSetup 2026-05-26-07:27:
 * Remove the repeated Recommended Setup copy from the intro page and consolidate
 * Refresh, Install Hooks, Skip, and Continue in one footer action row. The agent
 * card panel should only show installation state while the footer owns decisions.
 *
 * CDXC:FirstLaunchSetup 2026-05-26-07:43:
 * The first page should open directly on the product promise without a redundant
 * "First launch" eyebrow below the modal title. The headline should frame setup
 * as integrating Ghostex with the user's agents.
 *
 * CDXC:FirstLaunchSetup 2026-05-26-07:46:
 * The intro description should make hook installation the immediate setup task
 * and introduce the feature list as the reason those hooks are required.
 *
 * CDXC:FirstLaunchSetup 2026-05-26-07:48:
 * The product preview image should align with the feature list, not the headline,
 * so the intro copy reads as one full-width setup prompt above the visual row.
 *
 * CDXC:FirstLaunchSetup 2026-05-26-15:53:
 * The second first-launch page explains Ghostex CLI setup for mobile clients.
 * README.md states that Android uses a GitHub Releases APK and iPhone uses
 * TestFlight through Discord; the page should surface those acquisition paths
 * and show the Android app screenshot on the right while the CLI/mobile copy
 * stays on the left.
 *
 * CDXC:FirstLaunchSetup 2026-05-26-17:12:
 * The CLI page must not ask Homebrew users to reinstall when the `ghostex`
 * command already exists. Render the already-installed state from native CLI
 * status, and describe `gx` as usable only when Ghostex owns that alias.
 *
 * CDXC:BrowserAgentControl 2026-05-26-22:17:
 * The second first-launch page should install the Ghostex browser MCP skill
 * together with the CLI, because agents need a local skill that explains how
 * to configure `ghostex browser-devtools-mcp` for CEF control, console logs,
 * snapshots, screenshots, and form interactions.
 */
export function FirstLaunchSetupModal({
  agentHookStatus,
  agentHookStatusLoading = false,
  ghostexCliStatus,
  ghostexCliStatusLoading = false,
  initialPage = "hooks",
  isOpen,
  onClose,
  onInstallAgentHooks,
  onRequestAgentHookStatus,
  settings: _settings,
  theme = "dark-blue",
  vscode: _vscode,
}: FirstLaunchSetupModalProps) {
  const [activePage, setActivePage] = useState<FirstLaunchSetupPage>(initialPage);

  useEffect(() => {
    if (!isOpen || agentHookStatus || agentHookStatusLoading) {
      return;
    }
    onRequestAgentHookStatus?.();
  }, [
    agentHookStatus,
    agentHookStatusLoading,
    isOpen,
    onRequestAgentHookStatus,
  ]);

  useEffect(() => {
    if (isOpen) {
      setActivePage(initialPage);
    }
  }, [initialPage, isOpen]);

  const hookTone = getFirstLaunchHookTone(agentHookStatus, agentHookStatusLoading);
  const hookStatusByAgentId = new Map(
    agentHookStatus?.agents.map((status) => [status.agentId, status]) ?? [],
  );
  const activePageIndex = activePage === "hooks" ? 0 : 1;

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        className={cn(
          "ghostex-settings-shadcn settings-modal-dialog first-launch-setup-modal-dialog flex flex-col gap-0 overflow-hidden p-0 font-sans",
          getSidebarThemeVariant(theme) === "dark" && "dark",
        )}
        data-sidebar-theme={theme}
      >
        <DialogHeader className="first-launch-setup-header">
          <DialogTitle className="text-xl">Welcome to Ghostex</DialogTitle>
          <div className="first-launch-setup-progress" aria-hidden="true">
            <span className="first-launch-setup-progress-dot" data-active={activePageIndex === 0} />
            <span className="first-launch-setup-progress-dot" data-active={activePageIndex === 1} />
            <span className="first-launch-setup-progress-dot" data-active="false" />
          </div>
        </DialogHeader>

        <div className="first-launch-setup-body">
          {activePage === "hooks" ? (
            <FirstLaunchHooksPage
              agentHookStatusLoading={agentHookStatusLoading}
              hookStatusByAgentId={hookStatusByAgentId}
              hookTone={hookTone}
            />
          ) : (
            <FirstLaunchCliPage
              ghostexCliStatus={ghostexCliStatus}
              ghostexCliStatusLoading={ghostexCliStatusLoading}
            />
          )}
        </div>

        <div className="first-launch-setup-footer">
          <div className="first-launch-setup-footer-actions" role="group" aria-label="Setup actions">
            {activePage === "hooks" ? (
              <>
                <Button
                  disabled={!onRequestAgentHookStatus || agentHookStatusLoading}
                  aria-label="Refresh agent hook status"
                  className="first-launch-setup-hooks-refresh-button"
                  onClick={onRequestAgentHookStatus}
                  title="Refresh agent hook status"
                  type="button"
                  variant="outline"
                >
                  <IconRefresh aria-hidden="true" />
                </Button>
                <Button
                  disabled={!onInstallAgentHooks || agentHookStatusLoading}
                  onClick={onInstallAgentHooks}
                  type="button"
                  variant="outline"
                >
                  <IconDownload aria-hidden="true" data-icon="inline-start" />
                  Install Hooks
                </Button>
              </>
            ) : (
              <Button onClick={() => setActivePage("hooks")} type="button" variant="outline">
                <IconArrowLeft aria-hidden="true" data-icon="inline-start" />
                Back
              </Button>
            )}
            <Button onClick={onClose} type="button" variant="ghost">
              Skip for now
            </Button>
            {activePage === "hooks" ? (
              <Button onClick={() => setActivePage("cli")} type="button">
                Continue
                <IconArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            ) : (
              <Button onClick={onClose} type="button">
                Continue
                <IconArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FirstLaunchHooksPage({
  agentHookStatusLoading,
  hookStatusByAgentId,
  hookTone,
}: {
  agentHookStatusLoading: boolean;
  hookStatusByAgentId: ReadonlyMap<string, SidebarAgentHookStatusItem>;
  hookTone: SidebarAgentHookStatus | "checking" | "unknown";
}) {
  return (
    <>
      <div className="first-launch-setup-main">
        <section
          aria-labelledby="first-launch-intro-title"
          className="first-launch-setup-intro"
        >
          <h2 className="first-launch-setup-title" id="first-launch-intro-title">
            Let's get Ghostex integrated with your agents!
          </h2>
          <p className="first-launch-setup-description">
            Install the required hooks so that these features work:
          </p>
        </section>

        <div className="first-launch-setup-primary">
          <ul className="first-launch-setup-benefits" aria-label="Ghostex highlights">
            {FIRST_LAUNCH_INTRO_BENEFITS.map((benefit) => {
              const BenefitIcon = benefit.icon;
              return (
                <li className="first-launch-setup-benefit" key={benefit.title}>
                  <span className="first-launch-setup-benefit-icon">
                    <BenefitIcon aria-hidden="true" size={16} />
                  </span>
                  <span className="first-launch-setup-benefit-copy">
                    <span className="first-launch-setup-benefit-title">{benefit.title}</span>
                    <span className="first-launch-setup-benefit-text">{benefit.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="first-launch-setup-visual">
          <div className="first-launch-setup-art-shell">
            <img
              alt="Ghostex workspace preview with agent session cards, terminal panes, and status indicators"
              className="first-launch-setup-art"
              src={ghostexIntroImage}
            />
          </div>
        </aside>
      </div>

      <section
        aria-label="Agent hook installation status"
        className="first-launch-setup-hooks"
        data-tone={hookTone}
      >
        <div className="first-launch-setup-hooks-panel">
          {/*
           * CDXC:FirstLaunchSetup 2026-05-26-06:46
           * First launch hook setup must show the real supported agent names,
           * not only a readiness count, because users need to understand which
           * CLI configs Ghostex will inspect or install before accepting setup.
           * The supported set matches native hook installation: all default
           * agents except T3 Code, whose sessions are managed by Ghostex.
           *
           * CDXC:FirstLaunchSetup 2026-05-26-07:14:
           * Group agents under Installed / Not installed / CLI missing headers so
           * status words live in section titles instead of repeating inside each chip.
           *
           * CDXC:FirstLaunchSetup 2026-05-26-07:22:
           * The grouped agent headers are the only visible readiness count on this
           * page, keeping the hook panel from repeating a separate "4/15 ready"
           * summary above the cards.
           */}
          <div className="first-launch-setup-hook-groups" aria-label="Agent hook status">
            {getFirstLaunchHookStatusGroups(hookStatusByAgentId).map((group) => (
              <section className="first-launch-setup-hook-group" key={group.id}>
                <div className="first-launch-setup-hook-group-title">
                  {group.title}
                  <span className="first-launch-setup-hook-group-count">
                    {group.agents.length}
                  </span>
                </div>
                <ul className="first-launch-setup-hook-grid">
                  {group.agents.map((agent) => (
                    <li key={agent.agentId}>
                      <FirstLaunchHookAgentStatus
                        agentName={agent.name}
                        groupId={group.id}
                        isLoading={agentHookStatusLoading && hookStatusByAgentId.size === 0}
                        status={hookStatusByAgentId.get(agent.agentId)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function FirstLaunchCliPage({
  ghostexCliStatus,
  ghostexCliStatusLoading,
}: {
  ghostexCliStatus?: SidebarGhostexCliStatusMessage;
  ghostexCliStatusLoading: boolean;
}) {
  const isInstalled = ghostexCliStatus?.installed === true;
  const isBrowserSkillInstalled = ghostexCliStatus?.browserSkillInstalled === true;
  const isChecking = ghostexCliStatusLoading && !ghostexCliStatus;
  const commandLabel = isChecking
    ? "checking CLI status"
    : isInstalled
      ? isBrowserSkillInstalled
        ? "installed command and skill"
        : "browser skill install command"
      : "macOS install command";
  const commandText = isChecking
    ? "Checking for ghostex..."
    : isInstalled
      ? isBrowserSkillInstalled
        ? ghostexCliStatus.gxUsable
          ? "ghostex / gx + browser MCP skill"
          : "ghostex + browser MCP skill"
        : "ghostex install-browser-skill"
      : FIRST_LAUNCH_CLI_COMMAND;

  return (
    <div className="first-launch-setup-cli-page">
      <section
        aria-labelledby="first-launch-cli-title"
        className="first-launch-setup-cli-copy"
      >
        <h2 className="first-launch-setup-title" id="first-launch-cli-title">
          {isInstalled && isBrowserSkillInstalled
            ? "Ghostex CLI and browser skill are installed."
            : isInstalled
              ? "Install the browser MCP skill."
              : "Install the Ghostex CLI for mobile and browser access."}
        </h2>
        <p className="first-launch-setup-description">
          {isInstalled && isBrowserSkillInstalled
            ? "Your Mac already has the Ghostex CLI and the agent browser skill. Mobile apps can attach to sessions, and agents can connect to embedded CEF panes through the DevTools MCP server."
            : isInstalled
              ? "Your Mac already has the Ghostex CLI. Install the browser MCP skill so agents know how to connect to embedded CEF panes, inspect console logs, and interact with pages."
              : "The Android and iOS apps connect back to your Mac through the Ghostex CLI, and the same setup installs the browser MCP skill agents use for embedded CEF panes."}
        </p>

        <div className="first-launch-setup-command-card" data-installed={isInstalled}>
          <div className="first-launch-setup-command-label">
            {isInstalled ? (
              <IconCircleCheckFilled aria-hidden="true" size={16} />
            ) : (
              <IconTerminal2 aria-hidden="true" size={16} />
            )}
            {commandLabel}
          </div>
          <code>{commandText}</code>
          {ghostexCliStatus?.detail ? (
            <p className="first-launch-setup-cli-status-detail">{ghostexCliStatus.detail}</p>
          ) : null}
        </div>

        <ul className="first-launch-setup-mobile-benefits" aria-label="CLI and browser agent features">
          <li>
            <IconDeviceMobile aria-hidden="true" size={18} />
            <span>
              <strong>Remote sessions.</strong> Open the same agent sessions from Android or iOS
              when you are away from the Mac.
            </span>
          </li>
          <li>
            <IconTerminal2 aria-hidden="true" size={18} />
            <span>
              <strong>CLI bridge.</strong> The mobile apps call <code>ghostex</code> and{" "}
              <code>gx</code> over SSH when the alias is available, so taps on mobile attach to the
              right session.
            </span>
          </li>
          <li>
            <IconInfoCircle aria-hidden="true" size={18} />
            <span>
              <strong>Browser MCP skill.</strong> Agents can add{" "}
              <code>ghostex browser-devtools-mcp</code> to inspect CEF console logs, snapshots,
              screenshots, clicks, fills, and key presses.
            </span>
          </li>
        </ul>

        <div className="first-launch-setup-app-links" aria-label="Mobile app downloads">
          <a href={FIRST_LAUNCH_ANDROID_APK_URL} rel="noreferrer" target="_blank">
            <IconBrandAndroid aria-hidden="true" size={16} />
            Android APK
          </a>
          <a href={FIRST_LAUNCH_IOS_DISCORD_URL} rel="noreferrer" target="_blank">
            <IconBrandApple aria-hidden="true" size={16} />
            iPhone TestFlight
          </a>
        </div>
      </section>

      <aside className="first-launch-setup-mobile-visual">
        <div className="first-launch-setup-phone-frame">
          <img
            alt="Ghostex Android app showing projects and agent sessions"
            className="first-launch-setup-mobile-art"
            src={ghostexMobileAndroidImage}
          />
        </div>
      </aside>
    </div>
  );
}

function FirstLaunchHookAgentStatus({
  agentName,
  groupId,
  isLoading,
  status,
}: {
  agentName: string;
  groupId: FirstLaunchHookStatusGroupId;
  isLoading: boolean;
  status?: SidebarAgentHookStatusItem;
}) {
  return (
    <div
      className={cn(
        "first-launch-setup-hook-agent",
        getFirstLaunchAgentHookStatusClassName(groupId, status, isLoading),
      )}
    >
      {getFirstLaunchAgentHookStatusIcon(groupId, status, isLoading)}
      <span className="first-launch-setup-hook-agent-name">{agentName}</span>
    </div>
  );
}

function getFirstLaunchHookStatusGroups(
  hookStatusByAgentId: ReadonlyMap<string, SidebarAgentHookStatusItem>,
): FirstLaunchHookStatusGroup[] {
  const groups: FirstLaunchHookStatusGroup[] = [
    { agents: [], id: "installed", title: "Installed" },
    { agents: [], id: "missing", title: "Not installed" },
    { agents: [], id: "cliMissing", title: "CLI missing" },
    { agents: [], id: "unknown", title: "Not checked" },
  ];
  const groupById = new Map(groups.map((group) => [group.id, group]));

  for (const agent of FIRST_LAUNCH_HOOK_SUPPORTED_AGENTS) {
    const status = hookStatusByAgentId.get(agent.agentId);
    const groupId =
      status?.status === "installed" || status?.status === "notRequired"
        ? "installed"
        : status?.status === "missing"
          ? "missing"
          : status?.status === "cliMissing"
            ? "cliMissing"
            : "unknown";
    groupById.get(groupId)?.agents.push(agent);
  }

  return groups.filter((group) => group.agents.length > 0);
}

function getFirstLaunchHookTone(
  agentHookStatus: SidebarAgentHookStatusMessage | undefined,
  isLoading: boolean,
): SidebarAgentHookStatus | "checking" | "unknown" {
  if (agentHookStatus?.errorMessage) {
    return "missing";
  }
  if (isLoading) {
    return "checking";
  }
  if (!agentHookStatus) {
    return "unknown";
  }
  return agentHookStatus.agents.every(
    (agent) => agent.status === "installed" || agent.status === "notRequired",
  )
    ? "installed"
    : "missing";
}

function getSidebarThemeVariant(theme: SidebarTheme): "dark" | "light" {
  return theme.startsWith("light-") || theme === "plain-light" ? "light" : "dark";
}

function getFirstLaunchAgentHookStatusIcon(
  groupId: FirstLaunchHookStatusGroupId,
  status: SidebarAgentHookStatusItem | undefined,
  isLoading: boolean,
) {
  if (isLoading) {
    return <IconRefresh aria-hidden="true" className="first-launch-setup-hook-agent-icon" />;
  }
  if (!status) {
    return <IconInfoCircle aria-hidden="true" className="first-launch-setup-hook-agent-icon" />;
  }
  switch (groupId) {
    case "installed":
      return (
        <IconCircleCheckFilled
          aria-hidden="true"
          className="first-launch-setup-hook-agent-icon"
        />
      );
    case "cliMissing":
      return <IconAlertTriangle aria-hidden="true" className="first-launch-setup-hook-agent-icon" />;
    case "missing":
      return <IconCircleX aria-hidden="true" className="first-launch-setup-hook-agent-icon" />;
    case "unknown":
      return <IconInfoCircle aria-hidden="true" className="first-launch-setup-hook-agent-icon" />;
  }
}

function getFirstLaunchAgentHookStatusClassName(
  groupId: FirstLaunchHookStatusGroupId,
  status: SidebarAgentHookStatusItem | undefined,
  isLoading: boolean,
): string {
  if (isLoading || !status) {
    return "first-launch-setup-hook-agent-unknown";
  }
  switch (groupId) {
    case "installed":
      return "first-launch-setup-hook-agent-installed";
    case "cliMissing":
      return "first-launch-setup-hook-agent-cli-missing";
    case "missing":
      return "first-launch-setup-hook-agent-missing";
    case "unknown":
      return "first-launch-setup-hook-agent-unknown";
  }
}

export type { FirstLaunchSetupMainSettingKey };
