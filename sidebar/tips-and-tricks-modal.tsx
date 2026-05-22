import {
  IconArrowLeft,
  IconArrowRight,
  IconApps,
  IconBolt,
  IconBrowser,
  IconBrandOpenai,
  IconCode,
  IconDeviceFloppy,
  IconFolders,
  IconGitPullRequest,
  IconHistory,
  IconKeyboard,
  IconLayoutDashboard,
  IconMoon,
  IconPencil,
  IconSettings,
  IconSparkles,
  IconStack,
  IconTerminal2,
  IconTools,
  IconWorld,
} from "@tabler/icons-react";
import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  resolveSidebarTheme,
  type SidebarTheme,
  type SidebarThemeVariant,
} from "../shared/session-grid-contract";
import type { ghostexSettings } from "../shared/ghostex-settings";

export type TipsAndTricksModalProps = {
  isOpen: boolean;
  onClose: () => void;
  settings?: ghostexSettings;
  theme: SidebarTheme;
};

type TipsPageAction = {
  description: string;
  eyebrow: string;
  snippet?: string[];
};

type TipsIcon = ComponentType<{ className?: string; size?: number; stroke?: number }>;

type TipsPageItem = {
  icon: TipsIcon;
  text: string;
};

type TipsPage = {
  action?: TipsPageAction;
  icon: TipsIcon;
  items: TipsPageItem[];
  kicker: string;
  title: string;
};

const TIPS_AND_TRICKS_PAGES: TipsPage[] = [
  {
    icon: IconLayoutDashboard,
    items: [
      {
        icon: IconTerminal2,
        text: "Manage multiple CLI coding agent sessions from one native workspace.",
      },
      {
        icon: IconStack,
        text: "Keep agents, browser pages, terminal work, prompts, and Git flow visible together.",
      },
      {
        icon: IconFolders,
        text: "Jump between sessions, project groups, and worktrees without losing the current context.",
      },
      {
        icon: IconSparkles,
        text: "Use Ghostex as the always-on workspace for parallel agent work, not just a terminal list.",
      },
      {
        icon: IconHistory,
        text: "Reopen this guide any time from Tips & Tricks in the sidebar overflow menu.",
      },
    ],
    kicker: "Page 1",
    title: "Workspace Basics",
  },
  {
    icon: IconApps,
    items: [
      {
        icon: IconCode,
        text: "Use T3 Code when you want GUI-based coding sessions; it also supports splitting.",
      },
      {
        icon: IconSettings,
        text: "Add custom CLI agents from Settings, then launch them from the sidebar.",
      },
      {
        icon: IconMoon,
        text: "Sleep sessions to keep them in the sidebar without keeping every terminal fully active.",
      },
      {
        icon: IconPencil,
        text: "Paste long text into rename and Ghostex will turn it into a cleaner session name.",
      },
    ],
    kicker: "Page 2",
    title: "Agents & Sessions",
  },
  {
    icon: IconBolt,
    items: [
      {
        icon: IconBolt,
        text: "Actions are quick buttons for things like Dev, Build, Test, and Setup.",
      },
      {
        icon: IconTerminal2,
        text: "Terminal actions open a fresh terminal and run your command there.",
      },
      {
        icon: IconBrowser,
        text: "Browser actions open a URL and show it inside the Browsers group.",
      },
      {
        icon: IconTools,
        text: "Right-click agents and actions to configure, debug, edit, or remove them.",
      },
      {
        icon: IconGitPullRequest,
        text: "Send GitHub issues and PRs for problems, improvements, agent integrations, and indicator support.",
      },
    ],
    kicker: "Page 3",
    title: "Actions & Browsers",
  },
  {
    action: {
      description:
        "Recommended in your <user>/.codex/config.toml so Codex titles stay readable in multi-session workspaces.",
      eyebrow: "Codex",
      snippet: [
        "[tui]",
        'terminal_title = ["spinner", "thread"]',
        'status_line = ["thread-title", "model-with-reasoning", "current-dir", "context-usage", "used-tokens", "weekly-limit"]',
      ],
    },
    icon: IconBrandOpenai,
    items: [
      {
        icon: IconBrandOpenai,
        text: "Keep Codex and Ghostex aligned so session titles stay recognizable.",
      },
      {
        icon: IconKeyboard,
        text: "Press Ctrl+G in Claude Code, Codex CLI, and similar tools to edit prompts in a focused modal.",
      },
      {
        icon: IconDeviceFloppy,
        text: "Press Ctrl+G again from that prompt modal to save, close it, and return to the terminal.",
      },
      {
        icon: IconTerminal2,
        text: "After changing shell config, open a new terminal so CLI tools pick up the updated EDITOR value.",
      },
    ],
    kicker: "Page 4",
    title: "Codex & Editor Setup",
  },
  {
    action: {
      description:
        "Restart Ghostex after installing or updating an agent CLI so Ghostex can install the matching lifecycle hooks.",
      eyebrow: "Reliable resume",
      snippet: [
        "~/.codex/hooks.json",
        "~/.claude/settings.json",
        "~/.pi/agent/extensions/ghostex.ts",
        "~/.ghostexterm/<agent>-hook-sessions.json",
      ],
    },
    icon: IconDeviceFloppy,
    items: [
      {
        icon: IconDeviceFloppy,
        text: "Agent hooks capture the native session id that Claude, Codex, Grok, OpenCode, Pi, Amp, Cursor CLI, Gemini, Antigravity, Rovo Dev, Hermes Agent, Copilot, CodeBuddy, Factory, and Qoder need for exact resume.",
      },
      {
        icon: IconSettings,
        text: "Ghostex installs hooks into the agent config files it can find after the agent CLI exists on your PATH.",
      },
      {
        icon: IconTerminal2,
        text: "Start agent sessions from Ghostex terminals so the hooks can attach the captured id to the correct session card.",
      },
      {
        icon: IconHistory,
        text: "If an id was not captured, Ghostex still falls back to the existing title-based resume flow.",
      },
    ],
    /*
     * CDXC:SessionRestore 2026-05-22-23:33:
     * Tips & Tricks must explain that reliable agent resume depends on
     * installed agent CLI hooks capturing each native session id. The product
     * still keeps title-based resume as the backup when hook capture is absent.
     */
    kicker: "Page 5",
    title: "Session Resume Hooks",
  },
  {
    action: {
      description:
        "After you SSH into the Mac that is running Ghostex, list sessions and attach by the alias shown in the table.",
      eyebrow: "Remote session commands",
      snippet: [
        "# From Termux, connect to your Mac over Tailscale",
        "ssh madda@my-mac",
        "",
        "# List Ghostex sessions and note the left-column alias",
        "gtx sessions",
        "",
        "# Attach to session 1",
        "gtx a 1",
        "",
        "# Wake, focus, or sleep sessions from the phone",
        "gtx wake 1",
        "gtx focus 1",
        "gtx sleep 1",
        "",
        "# Use a title when the alias is not handy",
        'gtx a "project:session title"',
      ],
    },
    icon: IconWorld,
    items: [
      {
        icon: IconWorld,
        text: "Install Tailscale on the Mac and phone, sign into the same tailnet, then enable SSH into the Mac.",
      },
      {
        icon: IconSettings,
        text: "In Ghostex Settings, enable Session Persistence and choose zmx for the smoothest remote attach flow.",
      },
      {
        icon: IconTerminal2,
        text: "On Android, install Termux from F-Droid, install openssh, then SSH to the Mac's Tailscale name or IP.",
      },
      {
        icon: IconMoon,
        text: "Keep the Mac awake while remote so your phone can reach it through Tailscale.",
      },
      {
        icon: IconStack,
        text: "Keep Ghostex open on the Mac so gtx can list live sessions; zmx, tmux, or zellij keeps the terminal session itself durable.",
      },
    ],
    /**
     * CDXC:RemoteAccess 2026-05-15-23:03:
     * Tips & Tricks needs a Remote Access page that teaches phone-based session
     * continuation through Tailscale, SSH, Termux, and the public `gtx` CLI
     * alias. The page must position persistence as the prerequisite for
     * attaching to any running Ghostex terminal session remotely.
     */
    kicker: "Remote Access",
    title: "Connecting to Any Terminal Session Remotely",
  },
];

export function TipsAndTricksModal({
  isOpen,
  onClose,
  settings,
  theme,
}: TipsAndTricksModalProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const isLastPage = pageIndex === TIPS_AND_TRICKS_PAGES.length - 1;
  const canGoBack = pageIndex > 0;
  const page = TIPS_AND_TRICKS_PAGES[pageIndex];
  const PageIcon = page.icon;
  const snippetText = page.action?.snippet?.join("\n");
  const modalTheme = resolveSidebarTheme(
    settings?.sidebarTheme ?? "plain",
    getSidebarThemeVariant(theme),
  );
  const isModalDarkTheme = getSidebarThemeVariant(modalTheme) === "dark";

  useEffect(() => {
    if (isOpen) {
      setPageIndex(0);
    }
  }, [isOpen]);

  const goBack = () => setPageIndex((currentPageIndex) => Math.max(0, currentPageIndex - 1));
  const goNext = () =>
    setPageIndex((currentPageIndex) =>
      Math.min(TIPS_AND_TRICKS_PAGES.length - 1, currentPageIndex + 1),
    );

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
          "ghostex-settings-shadcn settings-modal-dialog tips-and-tricks-modal-dialog flex flex-col gap-0 overflow-hidden p-0 font-sans",
          isModalDarkTheme && "dark",
        )}
        data-sidebar-theme={modalTheme}
      >
        <DialogHeader className="tips-and-tricks-header">
          <DialogTitle className="text-xl">Tips &amp; Tricks</DialogTitle>
          {/*
           * CDXC:TipsAndTricks 2026-05-15-16:11:
           * The sidebar overflow menu and first app launch both need the copied
           * VSmux guide model, but it must render through the same shadcn Dialog
           * surface as Settings so size, radius, and backdrop stay consistent.
           *
           * CDXC:TipsAndTricks 2026-05-15-18:48:
           * The guide should be organized into fewer, broader pages and use a
           * distinct icon per tip row so each page scans by topic instead of
           * repeating the same generic marker throughout the modal.
           *
           * CDXC:TipsAndTricks 2026-05-15-19:19:
           * The guide should not mention the external companion app. Remove the
           * standalone final page and fold the remaining reopen/contribution
           * tips into the core pages so navigation stays short.
           */}
          <div className="tips-and-tricks-progress" aria-hidden="true">
            {TIPS_AND_TRICKS_PAGES.map((tipsPage, index) => (
              <span
                className="tips-and-tricks-progress-dot"
                data-active={String(index === pageIndex)}
                key={tipsPage.title}
              />
            ))}
          </div>
        </DialogHeader>

        <div className="tips-and-tricks-hero">
          <div className="tips-and-tricks-hero-icon-shell">
            <PageIcon aria-hidden="true" className="tips-and-tricks-hero-icon" size={28} />
          </div>
          <div className="tips-and-tricks-hero-copy">
            <div className="tips-and-tricks-kicker">{page.kicker}</div>
            <div className="tips-and-tricks-title">{page.title}</div>
          </div>
        </div>

        <ScrollArea className="tips-and-tricks-body">
          <div className="tips-and-tricks-body-inner">
            {page.action ? (
              <Card className="tips-and-tricks-callout" size="sm">
                <CardHeader>
                  <CardTitle>{page.action.eyebrow}</CardTitle>
                  <CardDescription>{page.action.description}</CardDescription>
                </CardHeader>
                {snippetText ? (
                  <CardContent>
                    <pre className="tips-and-tricks-snippet">
                      <code>{snippetText}</code>
                    </pre>
                  </CardContent>
                ) : null}
              </Card>
            ) : null}
            <div className="tips-and-tricks-list">
              {page.items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <Card className="tips-and-tricks-list-card" key={item.text} size="sm">
                    <CardContent className="tips-and-tricks-list-card-content">
                      <span className="tips-and-tricks-list-icon">
                        <ItemIcon aria-hidden="true" size={14} />
                      </span>
                      <span>{item.text}</span>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </ScrollArea>

        <div className="tips-and-tricks-footer">
          {canGoBack ? (
            <Button onClick={goBack} type="button" variant="outline">
              <IconArrowLeft aria-hidden="true" data-icon="inline-start" />
              Back
            </Button>
          ) : null}
          <Button onClick={isLastPage ? onClose : goNext} type="button">
            {isLastPage ? "Let's start!" : "Next"}
            {!isLastPage ? <IconArrowRight aria-hidden="true" data-icon="inline-end" /> : null}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getSidebarThemeVariant(theme: SidebarTheme): SidebarThemeVariant {
  return theme.startsWith("light-") || theme === "plain-light" ? "light" : "dark";
}
