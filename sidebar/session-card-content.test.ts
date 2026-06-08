import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  buildSessionTitleTooltip,
  formatSessionHeadingText,
  getSessionCardTitleTooltip,
  getSessionTitleTooltipOptions,
  getSessionTooltipSecondaryText,
  SessionCardContent,
  SessionFloatingAgentIcon,
} from "./session-card-content";

describe("buildSessionTitleTooltip", () => {
  test("should collapse duplicate heading and secondary lines", () => {
    expect(
      buildSessionTitleTooltip({
        headingText: "Browser ignore",
        secondaryText: "Browser ignore",
      }),
    ).toBe("Browser ignore");
  });

  test("should keep unique metadata lines in order", () => {
    expect(
      buildSessionTitleTooltip({
        headingText: "Browser ignore",
        secondaryText: "https://example.com",
        sessionIdTooltip: "ID: 02",
      }),
    ).toBe("Browser ignore\n\nhttps://example.com\n\nID: 02");
  });

  test("should separate metadata block lines with blank lines", () => {
    expect(
      buildSessionTitleTooltip({
        headingText: "Browser ignore",
        secondaryText: "https://example.com\nzmx session: ghostex-session-1",
        sessionIdTooltip: "ID: 02",
      }),
    ).toBe(
      "Browser ignore\n\nhttps://example.com\n\nzmx session: ghostex-session-1\n\nID: 02",
    );
  });

  test("should trim values before deduping", () => {
    expect(
      buildSessionTitleTooltip({
        headingText: " Browser ignore ",
        secondaryText: "Browser ignore",
        sessionIdTooltip: " ID: 02 ",
      }),
    ).toBe("Browser ignore\n\nID: 02");
  });
});

describe("getSessionTitleTooltipOptions", () => {
  test("should force the same title tooltip content to appear when requested", () => {
    expect(
      getSessionTitleTooltipOptions({
        alwaysShowTitleTooltip: true,
        headingText: "A very long session title",
        titleTooltip: "A very long session title",
      }),
    ).toEqual({
      tooltip: "A very long session title",
      tooltipWhen: "always",
    });
  });

  test("should keep plain title-only tooltips overflow-triggered by default", () => {
    expect(
      getSessionTitleTooltipOptions({
        alwaysShowTitleTooltip: false,
        headingText: "A very long session title",
        titleTooltip: "A very long session title",
      }),
    ).toEqual({
      tooltip: undefined,
      tooltipWhen: "overflow",
    });
  });
});

describe("getSessionCardTitleTooltip", () => {
  test("should always show the tooltip for unsynced user titles", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: undefined,
          alias: "Session 1",
          detail: undefined,
          isPrimaryTitleTerminalTitle: false,
          primaryTitle: "A very long session title",
          sessionNumber: undefined,
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: false,
      }),
    ).toEqual({
      headingText: "∗ A very long session title",
      tooltip: "∗ A very long session title (Unsynced title)",
      tooltipWhen: "always",
    });
  });

  test("should include the unsynced label ahead of other tooltip metadata", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "Session 1",
          detail: "OpenAI Codex / repo sweep",
          isPrimaryTitleTerminalTitle: false,
          primaryTitle: "A very long session title",
          sessionNumber: "3",
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: true,
      }),
    ).toEqual({
      headingText: "∗ A very long session title",
      tooltip: "∗ A very long session title (Unsynced title)\n\nrepo sweep\n\nID: 3",
      tooltipWhen: "always",
    });
  });

  test("should prefer routed session ids over display numbers in the tooltip", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "Session 1",
          detail: "OpenAI Codex",
          isPrimaryTitleTerminalTitle: true,
          primaryTitle: "Lost actions after migration",
          sessionNumber: "05",
          sessionRoutingId: "S7k-P3a91-G8v20",
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: true,
      }),
    ).toEqual({
      headingText: "Lost actions after migration",
      tooltip: "Lost actions after migration\n\nID: S7k-P3a91-G8v20",
      tooltipWhen: "always",
    });
  });

  test("should expand ellipsized first-prompt titles in the tooltip heading", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "Session 1",
          detail: "OpenAI Codex",
          firstUserMessage:
            "when using zmx/tmux/zellij as the persistence provider, keep the sidebar title readable",
          isPrimaryTitleTerminalTitle: true,
          primaryTitle: "when using zmx/tmux/zellij as the persistence...",
          sessionNumber: "g-0515-092521",
          sessionPersistenceName: "g-0515-092521",
          sessionPersistenceProvider: "zmx",
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: true,
      }),
    ).toEqual({
      headingText: "when using zmx/tmux/zellij as the persistence...",
      tooltip:
        "when using zmx/tmux/zellij as the persistence provider, keep the sidebar title readable\n\nID: g-0515-092521",
      tooltipWhen: "always",
    });
  });

  test("should stop showing the unsynced marker once the terminal title matches", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "Session 1",
          detail: undefined,
          isPrimaryTitleTerminalTitle: false,
          primaryTitle: "A very long session title",
          sessionNumber: undefined,
          terminalTitle: "A very long session title",
        },
        showDebugSessionNumbers: false,
      }),
    ).toEqual({
      headingText: "A very long session title",
      tooltip: undefined,
      tooltipWhen: "overflow",
    });
  });

  test("should swap ghost placeholder card titles to the non-persistent terminal session title", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: undefined,
          alias: "Session 1",
          detail: undefined,
          isPrimaryTitleTerminalTitle: true,
          primaryTitle: "👻",
          sessionNumber: undefined,
          terminalTitle: "👻",
        },
        showDebugSessionNumbers: false,
      }),
    ).toEqual({
      headingText: "∗ Terminal Session",
      tooltip: "∗ Terminal Session (Unsynced title)",
      tooltipWhen: "always",
    });
  });

  test("should keep browser titles unmarked in the browser area", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "browser",
          alias: "Docs",
          detail: "https://example.com",
          kind: "browser",
          isPrimaryTitleTerminalTitle: false,
          primaryTitle: "Project docs",
          sessionKind: "browser",
          sessionNumber: undefined,
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: false,
      }),
    ).toEqual({
      headingText: "Project docs",
      tooltip: "Project docs\n\nhttps://example.com",
      tooltipWhen: "always",
    });
  });

  test("should include persistence provider session names in the tooltip", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "Session 1",
          detail: "OpenAI Codex",
          isPrimaryTitleTerminalTitle: true,
          primaryTitle: "Fix restore",
          sessionNumber: undefined,
          sessionPersistenceName: "ghostex-session-1",
          sessionPersistenceProvider: "zmx",
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: false,
      }),
    ).toEqual({
      headingText: "Fix restore",
      tooltip: "Fix restore\n\nzmx session: ghostex-session-1",
      tooltipWhen: "always",
    });
  });

  test("should include captured agent session ids in the tooltip", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "codex",
          agentSessionId: "codex-session-123",
          alias: "Session 1",
          detail: "OpenAI Codex",
          isPrimaryTitleTerminalTitle: true,
          primaryTitle: "Fix restore",
          sessionNumber: undefined,
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: false,
      }),
    ).toEqual({
      headingText: "Fix restore",
      tooltip: "Fix restore\n\ncodex-session-123",
      tooltipWhen: "always",
    });
  });

  test("should show delayed send countdown directly below the tooltip title", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "Session 1",
          delayedSendRemainingLabel: "04:32",
          detail: "OpenAI Codex",
          isPrimaryTitleTerminalTitle: true,
          primaryTitle: "Fix restore",
          sessionNumber: undefined,
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: false,
      }),
    ).toEqual({
      headingText: "Fix restore",
      tooltip: "Fix restore\n\nDelayed Send in 04:32",
      tooltipWhen: "always",
    });
  });

  test("should include previous session restore details when requested", () => {
    expect(
      getSessionCardTitleTooltip({
        session: {
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "Session 1",
          detail: "OpenAI Codex",
          isPrimaryTitleTerminalTitle: true,
          primaryTitle: "Fix restore",
          projectName: "ghostex",
          projectPath: "/Users/madda/dev/_active/ghostex",
          sessionNumber: undefined,
          sessionPersistenceName: "ghostex-session-1",
          sessionPersistenceProvider: "zmx",
          terminalTitle: undefined,
        },
        showDebugSessionNumbers: false,
        showSessionDetails: true,
      }),
    ).toEqual({
      headingText: "Fix restore",
      tooltip:
        "Fix restore\n\nAgent: Codex\n\nProject: ghostex (/Users/madda/dev/_active/ghostex)\n\nProvider: zmx\n\nzmx session: ghostex-session-1",
      tooltipWhen: "always",
    });
  });
});

describe("SessionFloatingAgentIcon", () => {
  test("should render a browser favicon when the browser session has one", () => {
    const faviconDataUrl = "data:image/png;base64,ZmF2aWNvbg==";
    const markup = renderToStaticMarkup(
      createElement(SessionFloatingAgentIcon, {
        agentIcon: "browser",
        faviconDataUrl,
      }),
    );

    expect(markup).toContain('data-icon-variant="favicon"');
    expect(markup).toContain(`src="${faviconDataUrl}"`);
  });

  test("should render the browser fallback icon when no favicon is available", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionFloatingAgentIcon, {
        agentIcon: "browser",
      }),
    );

    expect(markup).toContain('data-agent-icon="browser"');
    expect(markup).not.toContain("data-icon-variant");
  });

  test("should not render a persistence provider badge when a provider session is stored", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionFloatingAgentIcon, {
        agentIcon: "codex",
        sessionPersistenceName: "ghostex-session-1",
        sessionPersistenceProvider: "zmx",
      }),
    );

    expect(markup).not.toContain("session-persistence-provider-badge");
    expect(markup).not.toContain('data-provider="zmx"');
    expect(markup).not.toContain(">z</span>");
  });

  test("should not render a persistence provider badge when only the provider is known", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionFloatingAgentIcon, {
        agentIcon: "codex",
        sessionPersistenceProvider: "tmux",
      }),
    );

    expect(markup).not.toContain("session-persistence-provider-badge");
    expect(markup).not.toContain('data-provider="tmux"');
    expect(markup).not.toContain(">t</span>");
  });

  test("should show delayed send clock instead of a tag icon", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionFloatingAgentIcon, {
        agentIcon: "codex",
        delayedSendRemainingLabel: "04:32",
        sessionTag: "todo",
      }),
    );

    expect(markup).toContain("session-delayed-send-agent-icon");
    expect(markup).toContain('aria-label="Delayed Send in 04:32"');
    expect(markup).not.toContain("session-tag-agent-icon");
    expect(markup).not.toContain('data-session-tag="todo"');
  });

  test("should show delayed send clock when only a deadline is projected", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionFloatingAgentIcon, {
        agentIcon: "codex",
        delayedSendDeadlineAt: "2026-06-06T10:00:00.000Z",
        sessionTag: "favorite",
      }),
    );

    expect(markup).toContain("session-delayed-send-agent-icon");
    expect(markup).toContain('aria-label="Delayed Send scheduled"');
    expect(markup).not.toContain("session-tag-agent-icon");
    expect(markup).not.toContain('data-session-tag="favorite"');
  });
});

describe("formatSessionHeadingText", () => {
  test("should render gxserver display titles without recomputing title provenance", () => {
    expect(
      formatSessionHeadingText({
        alias: "Session 1",
        displayTitle: "MacOS session working status Fork",
        displayTitleTooltip: "MacOS session working status Fork",
        isPrimaryTitleTerminalTitle: false,
        primaryTitle: "Placeholder stale local title",
      }),
    ).toBe("MacOS session working status Fork");
    expect(
      formatSessionHeadingText({
        alias: "Session 1",
        displayTitle: "∗ Local draft",
        displayTitleTooltip: "∗ Local draft (Unsynced title)",
        includeUnsyncedTitleLabel: true,
        isPrimaryTitleTerminalTitle: true,
        primaryTitle: "Local draft",
      }),
    ).toBe("∗ Local draft (Unsynced title)");
  });

  test("should append the unsynced marker when the displayed title comes from the user title", () => {
    expect(
      formatSessionHeadingText({
        alias: "Session 1",
        isPrimaryTitleTerminalTitle: false,
        primaryTitle: "Claude Code",
      }),
    ).toBe("∗ Claude Code");
  });

  test("should append the unsynced marker when showing placeholder session titles", () => {
    expect(
      formatSessionHeadingText({
        alias: "g-0427-090032",
        isPrimaryTitleTerminalTitle: false,
        primaryTitle: "Terminal Session",
      }),
    ).toBe("∗ Terminal Session");
    expect(
      formatSessionHeadingText({
        alias: "g-0427-090032",
        isPrimaryTitleTerminalTitle: false,
        primaryTitle: "Codex Session",
      }),
    ).toBe("∗ Codex Session");
  });

  test("should swap ghost placeholder titles to the existing unsynced marker", () => {
    expect(
      formatSessionHeadingText({
        alias: "g-0427-090032",
        isPrimaryTitleTerminalTitle: true,
        primaryTitle: "👻 Terminal Session",
        terminalTitle: "👻 Terminal Session",
      }),
    ).toBe("∗ Terminal Session");
  });

  test("should keep terminal-derived titles unmarked", () => {
    expect(
      formatSessionHeadingText({
        alias: "Session 1",
        isPrimaryTitleTerminalTitle: true,
        primaryTitle: "Bug Fix",
      }),
    ).toBe("Bug Fix");
  });

  test("should keep t3 titles unmarked even when they do not match the synced terminal title", () => {
    expect(
      formatSessionHeadingText({
        agentIcon: "t3",
        alias: "Session 1",
        isPrimaryTitleTerminalTitle: false,
        primaryTitle: "Refactor auth flow",
        terminalTitle: "Thread 12345678",
      }),
    ).toBe("Refactor auth flow");
  });

  test("should append the unsynced label in tooltip mode", () => {
    expect(
      formatSessionHeadingText({
        alias: "Session 1",
        includeUnsyncedTitleLabel: true,
        isPrimaryTitleTerminalTitle: false,
        primaryTitle: "Bug Fix",
      }),
    ).toBe("∗ Bug Fix (Unsynced title)");
  });

  test("should not append the unsynced marker for browser sessions", () => {
    expect(
      formatSessionHeadingText({
        agentIcon: "browser",
        alias: "Docs",
        kind: "browser",
        isPrimaryTitleTerminalTitle: false,
        primaryTitle: "Project docs",
        sessionKind: "browser",
      }),
    ).toBe("Project docs");
  });
});

describe("getSessionTooltipSecondaryText", () => {
  test("should omit agent-only detail labels from tooltips", () => {
    expect(
      getSessionTooltipSecondaryText({
        activityLabel: undefined,
        agentIcon: "codex",
        detail: "OpenAI Codex",
        terminalTitle: undefined,
      }),
    ).toBeUndefined();
  });

  test("should strip agent prefixes from tooltip detail text", () => {
    expect(
      getSessionTooltipSecondaryText({
        activityLabel: undefined,
        agentIcon: "claude",
        detail: "Claude Code / visual diff / attention state",
        terminalTitle: undefined,
      }),
    ).toBe("visual diff / attention state");
  });

  test("should fall back to non-agent activity labels", () => {
    expect(
      getSessionTooltipSecondaryText({
        activityLabel: "Needs attention",
        agentIcon: "codex",
        detail: "OpenAI Codex",
        terminalTitle: undefined,
      }),
    ).toBe("Needs attention");
  });
});

describe("SessionCardContent", () => {
  test("should show the terminal icon for agentless terminal sessions and reveal time on hover", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCardContent, {
        session: {
          activity: "idle",
          activityLabel: undefined,
          alias: "00",
          column: 0,
          isFocused: false,
          isRunning: true,
          isVisible: true,
          lastInteractionAt: "2026-04-18T10:00:00.000Z",
          row: 0,
          sessionId: "session-1",
          sessionKind: "terminal",
          shortcutLabel: "1",
        },
        showCloseButton: false,
        showDebugSessionNumbers: false,
        showLastInteractionTime: false,
      }),
    );

    expect(markup).toContain('data-default-trailing-display="icon"');
    expect(markup).toContain('data-hover-trailing-display="time"');
    expect(markup).toContain('data-agent-icon="terminal"');
    expect(markup).toContain("session-last-interaction-time");
    expect(markup).toContain("session-header-agent-tabler-icon");
  });

  test("should hide the last active label when session-card timestamps are disabled", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCardContent, {
        session: {
          activity: "idle",
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "00",
          column: 0,
          isFocused: false,
          isRunning: true,
          isVisible: true,
          lastInteractionAt: "2026-04-18T10:00:00.000Z",
          row: 0,
          sessionId: "session-1",
          shortcutLabel: "1",
        },
        showCloseButton: false,
        showDebugSessionNumbers: false,
        showLastActiveTime: false,
      }),
    );

    expect(markup).toContain('data-title-full-width="true"');
    expect(markup).not.toContain("session-head-trailing");
    expect(markup).not.toContain("session-last-interaction-time");
    expect(markup).not.toContain("session-header-agent-icon");
  });

  test("should not duplicate delayed send clocks in the right-side header icon slot", () => {
    const floatingMarkup = renderToStaticMarkup(
      createElement(SessionFloatingAgentIcon, {
        agentIcon: "codex",
        delayedSendRemainingLabel: "04:32",
      }),
    );
    const contentMarkup = renderToStaticMarkup(
      createElement(SessionCardContent, {
        session: {
          activity: "idle",
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "00",
          column: 0,
          delayedSendRemainingLabel: "04:32",
          isFocused: false,
          isRunning: true,
          isVisible: true,
          lastInteractionAt: "2026-04-18T10:00:00.000Z",
          row: 0,
          sessionId: "session-1",
          shortcutLabel: "1",
        },
        showCloseButton: false,
        showDebugSessionNumbers: false,
      }),
    );

    expect(floatingMarkup).toContain('aria-label="Delayed Send in 04:32"');
    expect(contentMarkup).toContain("session-header-agent-icon");
    expect(contentMarkup).not.toContain("session-header-agent-tabler-icon session-delayed-send-agent-icon");
    expect(contentMarkup).not.toContain('aria-label="Delayed Send in 04:32"');
  });

  test("should allow previous-session rows to reserve the trailing slot for last active", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCardContent, {
        hideHeaderAgentIcon: true,
        session: {
          activity: "idle",
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "00",
          column: 0,
          isFocused: false,
          isRunning: false,
          isVisible: false,
          lastInteractionAt: "2026-04-18T10:00:00.000Z",
          row: 0,
          sessionId: "session-1",
          shortcutLabel: "1",
        },
        showCloseButton: false,
        showDebugSessionNumbers: false,
        showLastInteractionTime: true,
      }),
    );

    expect(markup).toContain('data-default-trailing-display="time"');
    expect(markup).toContain('data-hover-trailing-display="time"');
    expect(markup).toContain("session-last-interaction-time");
    expect(markup).not.toContain("session-header-agent-icon");
  });

  test("should render a spinner instead of the header agent icon while reloading", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCardContent, {
        session: {
          activity: "idle",
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "00",
          column: 0,
          isFocused: false,
          isReloading: true,
          isRunning: true,
          isVisible: true,
          row: 0,
          sessionId: "session-1",
          shortcutLabel: "1",
        },
        showCloseButton: false,
        showDebugSessionNumbers: false,
      }),
    );

    expect(markup).toContain("session-header-reloading-icon");
    expect(markup).not.toContain("session-header-agent-icon");
  });

  test("should keep the reloading spinner visible on hover instead of swapping to last active time", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCardContent, {
        session: {
          activity: "idle",
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "00",
          column: 0,
          isFocused: false,
          isReloading: true,
          isRunning: true,
          isVisible: true,
          lastInteractionAt: "2026-04-18T10:00:00.000Z",
          row: 0,
          sessionId: "session-1",
          shortcutLabel: "1",
        },
        showCloseButton: false,
        showDebugSessionNumbers: false,
      }),
    );

    expect(markup).toContain('data-default-trailing-display="icon"');
    expect(markup).toContain('data-hover-trailing-display="icon"');
    expect(markup).toContain("session-last-interaction-time");
    expect(markup).toContain("session-header-reloading-icon");
  });

  test("should render the same header spinner while Codex first-prompt rename loading is active", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCardContent, {
        session: {
          activity: "idle",
          activityLabel: undefined,
          agentIcon: "codex",
          alias: "00",
          column: 0,
          isFocused: false,
          isGeneratingFirstPromptTitle: true,
          isRunning: true,
          isVisible: true,
          row: 0,
          sessionId: "session-1",
          shortcutLabel: "1",
        },
        showCloseButton: false,
        showDebugSessionNumbers: false,
      }),
    );

    expect(markup).toContain("session-header-reloading-icon");
    expect(markup).not.toContain("session-header-agent-icon");
    expect(markup).toContain("session-title-generation-overlay-label");
    expect(markup).toContain("session-title-generation-overlay-dots");
    expect(markup).not.toContain("session-title-generation-overlay-icon");
  });

  test("should render a hover-only close button when card closing is enabled", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCardContent, {
        onClose: () => undefined,
        session: {
          activity: "idle",
          activityLabel: undefined,
          agentIcon: "t3",
          alias: "00",
          column: 0,
          isFocused: false,
          isRunning: true,
          isVisible: true,
          row: 0,
          sessionId: "session-1",
          sessionKind: "t3",
          shortcutLabel: "1",
        },
        showCloseButton: true,
        showDebugSessionNumbers: false,
      }),
    );

    expect(markup).toContain('aria-label="Close session"');
    expect(markup).toContain("session-card-close-button");
  });
});

describe("SessionFloatingAgentIcon", () => {
  test("should keep showing the floating agent icon instead of a reload spinner", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionFloatingAgentIcon, {
        agentIcon: "codex",
        isReloading: true,
      }),
    );

    expect(markup).toContain("session-floating-agent-icon");
    expect(markup).not.toContain("session-floating-reloading-icon");
  });
});
