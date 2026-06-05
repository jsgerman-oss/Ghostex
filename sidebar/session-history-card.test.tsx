import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SidebarPreviousSessionItem } from "../shared/session-grid-contract";
import { SessionHistoryCard } from "./session-history-card";

function createPreviousSession(
  overrides: Partial<SidebarPreviousSessionItem> = {},
): SidebarPreviousSessionItem {
  return {
    activity: "idle",
    agentIcon: "codex",
    alias: "Previous Codex session",
    closedAt: "2026-06-05T10:00:00.000Z",
    detail: "OpenAI Codex",
    historyId: "history-1",
    isFavorite: false,
    isFocused: false,
    isGeneratedName: false,
    isRestorable: true,
    isRunning: false,
    isVisible: false,
    primaryTitle: "Previous Codex session",
    sessionId: "session-1",
    terminalTitle: undefined,
    ...overrides,
  };
}

describe("SessionHistoryCard", () => {
  test("renders the floating identity icon inside the restore button", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionHistoryCard, {
        onDelete: () => {},
        onRestore: () => {},
        session: createPreviousSession(),
        showDebugSessionNumbers: false,
      }),
    );

    const articleIndex = markup.indexOf('class="session session-history-card"');
    const iconIndex = markup.indexOf('class="session-floating-agent-icon"');
    const titleIndex = markup.indexOf('class="session-head"');
    const articleCloseIndex = markup.indexOf("</article>");

    expect(articleIndex).toBeGreaterThanOrEqual(0);
    expect(iconIndex).toBeGreaterThan(articleIndex);
    expect(iconIndex).toBeLessThan(titleIndex);
    expect(iconIndex).toBeLessThan(articleCloseIndex);
  });

  test("marks selected search result rows like project session cards", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionHistoryCard, {
        isSearchSelected: true,
        onDelete: () => {},
        onRestore: () => {},
        session: createPreviousSession(),
        showDebugSessionNumbers: false,
      }),
    );

    expect(markup).toContain('data-search-selected="true"');
  });
});
