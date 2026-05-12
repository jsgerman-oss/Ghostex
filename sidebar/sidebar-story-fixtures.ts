import { DEFAULT_COMPLETION_SOUND, getCompletionSoundLabel } from "../shared/completion-sound";
import { createDefaultSidebarAgentButtons } from "../shared/sidebar-agents";
import { createDefaultSidebarCommandButtons } from "../shared/sidebar-commands";
import { createDefaultSidebarGitState } from "../shared/sidebar-git";
import { DEFAULT_zmux_SETTINGS, normalizezmuxSettings, type zmuxSettings } from "../shared/zmux-settings";
import type {
  SidebarHydrateMessage,
  SidebarHudState,
  SidebarTheme,
  TerminalViewMode,
  VisibleSessionCount,
} from "../shared/session-grid-contract";
import {
  clampVisibleSessionCount,
  createDefaultSidebarSectionCollapseState,
  createDefaultSidebarSectionVisibility,
} from "../shared/session-grid-contract";
import { GROUPS_BY_FIXTURE } from "./sidebar-story-fixture-data";
import {
  cloneGroups,
  createStoryPreviousSession,
  getFocusedSessionTitle,
  getVisibleSlotLabels,
} from "./sidebar-story-fixture-helpers";

export type SidebarStoryFixture =
  | "agent-icon-render"
  | "browser-groups"
  | "combined-header-alignment"
  | "combined-recent-projects"
  | "combined-sparse-reference"
  | "command-indicator-active"
  | "default"
  | "sort-toggle-demo"
  | "selector-states"
  | "overflow-stress"
  | "scroll-end-retention"
  | "empty-groups"
  | "three-groups-stress";

export type SidebarStoryArgs = {
  createSessionOnSidebarDoubleClick: boolean;
  debuggingMode: boolean;
  fixture: SidebarStoryFixture;
  highlightedVisibleCount: VisibleSessionCount;
  isFocusModeActive: boolean;
  renameSessionOnDoubleClick: boolean;
  showCloseButtonOnSessionCards: boolean;
  showHotkeysOnSessionCards: boolean;
  theme: SidebarTheme;
  viewMode: TerminalViewMode;
  visibleCount: VisibleSessionCount;
};

export type SidebarStoryCurrentSettings = zmuxSettings & {
  sidebarWidth?: number;
};

const PREVIOUS_SESSIONS_BY_FIXTURE: Partial<
  Record<SidebarStoryFixture, SidebarHydrateMessage["previousSessions"]>
> = {
  "sort-toggle-demo": [
    createStoryPreviousSession({
      alias: "recent retrospective",
      detail: "OpenAI Codex",
      historyId: "history-1",
      sessionId: "history-session-1",
      shortcutLabel: "⌘⌥7",
    }),
    createStoryPreviousSession({
      alias: "archived follow-up",
      detail: "Claude Code",
      historyId: "history-2",
      sessionId: "history-session-2",
      shortcutLabel: "⌘⌥8",
    }),
  ],
  /**
   * CDXC:SidebarSearch 2026-05-08-12:16
   * Combined-reference Storybook fixtures need real previous-session search
   * hits so spacing between project matches and Previous Sessions can be
   * reproduced without synthetic DOM injection. Keep at least 40 matching
   * previous rows so the long native-sidebar result list from the regression
   * screenshots is represented in Storybook.
   */
  "combined-sparse-reference": [
    createStoryPreviousSession({
      alias: "Rename Modal Generator",
      detail: "OpenAI Codex",
      historyId: "combined-history-1",
      sessionId: "combined-history-session-1",
      shortcutLabel: "⌘⌥7",
    }),
    createStoryPreviousSession({
      alias: "Sidebar interactions search",
      detail: "Browser",
      historyId: "combined-history-2",
      sessionId: "combined-history-session-2",
      shortcutLabel: "⌘⌥8",
    }),
    ...Array.from({ length: 40 }, (_, index) =>
      createStoryPreviousSession({
        alias: `nn previous session ${index + 1}`,
        detail: index % 3 === 0 ? "OpenAI Codex" : index % 3 === 1 ? "Browser" : "Terminal",
        historyId: `combined-history-extra-${index + 1}`,
        sessionId: `combined-history-extra-session-${index + 1}`,
        shortcutLabel: `⌘⌥${(index % 9) + 1}`,
      }),
    ),
  ],
};

const COMMAND_SESSION_INDICATORS_BY_FIXTURE: Partial<
  Record<SidebarStoryFixture, SidebarHudState["commandSessionIndicators"]>
> = {
  "command-indicator-active": [
    {
      commandId: "dev",
      isActive: true,
      sessionId: "session-1",
      status: "running",
      title: "Dev server",
    },
  ],
};

function isCombinedReferenceFixture(fixture: SidebarStoryFixture): boolean {
  return (
    fixture === "combined-header-alignment" ||
    fixture === "combined-recent-projects" ||
    fixture === "combined-sparse-reference"
  );
}

function createCombinedStorySettings(
  currentSettings: SidebarStoryCurrentSettings | undefined,
): zmuxSettings {
  /**
   * CDXC:StorybookSettings 2026-05-08-16:45
   * Combined sidebar scenarios must inherit the user's current zmux settings
   * snapshot when Storybook can read it. The app's visibility, theme, and
   * card-chrome settings are part of the visual contract being checked, so the
   * fixture should only force Combined mode to keep this scenario on the target
   * surface.
   */
  return normalizezmuxSettings({
    ...(currentSettings ?? DEFAULT_zmux_SETTINGS),
    sidebarMode: "combined",
  });
}

export function createSidebarStoryMessage(
  args: SidebarStoryArgs,
  currentSettings?: SidebarStoryCurrentSettings,
): SidebarHydrateMessage {
  const combinedStorySettings = isCombinedReferenceFixture(args.fixture)
    ? createCombinedStorySettings(currentSettings)
    : undefined;
  const groups = cloneGroups(GROUPS_BY_FIXTURE[args.fixture]).map((group) => {
    const visibleCount = group.isActive
      ? args.visibleCount
      : clampVisibleSessionCount(Math.max(1, group.sessions.length));

    return {
      ...group,
      isFocusModeActive: group.isActive ? args.isFocusModeActive : false,
      layoutVisibleCount: group.isActive ? args.highlightedVisibleCount : visibleCount,
      viewMode: group.isActive ? args.viewMode : "grid",
      visibleCount,
    };
  });
  const hud: SidebarHudState = {
    activeSessionsSortMode: "manual",
    agentManagerZoomPercent: 100,
    agents: createDefaultSidebarAgentButtons(),
    collapsedSections: createDefaultSidebarSectionCollapseState(),
    commands: createDefaultSidebarCommandButtons(),
    commandSessionIndicators: COMMAND_SESSION_INDICATORS_BY_FIXTURE[args.fixture] ?? [],
    completionBellEnabled: combinedStorySettings?.completionBellEnabled ?? false,
    completionSound: combinedStorySettings?.completionSound ?? DEFAULT_COMPLETION_SOUND,
    completionSoundLabel: getCompletionSoundLabel(
      combinedStorySettings?.completionSound ?? DEFAULT_COMPLETION_SOUND,
    ),
    debuggingMode: combinedStorySettings?.debuggingMode ?? args.debuggingMode,
    focusedSessionTitle: getFocusedSessionTitle(groups),
    git: createDefaultSidebarGitState(),
    highlightedVisibleCount: args.highlightedVisibleCount,
    isFocusModeActive: args.isFocusModeActive,
    pendingAgentIds: [],
    recentProjects:
      args.fixture === "combined-recent-projects" || args.fixture === "combined-sparse-reference"
        ? [
            {
              path: "/Users/story/dev/shortpoint",
              projectId: "recent-shortpoint",
              recentClosedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              sessionCount: 3,
              title: "shortpoint",
            },
            {
              path: "/Users/story/dev/open-design",
              projectId: "recent-open-design",
              recentClosedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
              sessionCount: 0,
              title: "open-design",
            },
          ]
        : [],
    sectionVisibility: createDefaultSidebarSectionVisibility(),
    settings: combinedStorySettings,
    createSessionOnSidebarDoubleClick:
      combinedStorySettings?.createSessionOnSidebarDoubleClick ??
      args.createSessionOnSidebarDoubleClick,
    renameSessionOnDoubleClick:
      combinedStorySettings?.renameSessionOnDoubleClick ?? args.renameSessionOnDoubleClick,
    showCloseButtonOnSessionCards:
      combinedStorySettings?.showCloseButtonOnSessionCards ?? args.showCloseButtonOnSessionCards,
    showHotkeysOnSessionCards:
      combinedStorySettings?.showHotkeysOnSessionCards ?? args.showHotkeysOnSessionCards,
    theme: args.theme,
    viewMode: args.viewMode,
    visibleCount: args.visibleCount,
    visibleSlotLabels: getVisibleSlotLabels(groups),
  };

  if (
    isCombinedReferenceFixture(args.fixture)
  ) {
    hud.projectHeader = {
      directory: "/Users/story/dev/zmux",
      name: "zmux",
    };
  }

  return {
    groups,
    hud,
    pinnedPrompts: [],
    previousSessions: (PREVIOUS_SESSIONS_BY_FIXTURE[args.fixture] ?? []).map((session) => ({
      ...session,
    })),
    revision: 1,
    scratchPadContent: "",
    type: "hydrate",
  };
}
