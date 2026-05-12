import type { Meta } from "@storybook/react-vite";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { SidebarStoryHarness } from "./sidebar-story-harness";
import {
  createSidebarStoryMessage,
  type SidebarStoryArgs,
  type SidebarStoryCurrentSettings,
} from "./sidebar-story-fixtures";

export const DEFAULT_SIDEBAR_STORY_ARGS: SidebarStoryArgs = {
  createSessionOnSidebarDoubleClick: false,
  debuggingMode: false,
  fixture: "default",
  highlightedVisibleCount: 1,
  isFocusModeActive: false,
  renameSessionOnDoubleClick: false,
  showCloseButtonOnSessionCards: true,
  showHotkeysOnSessionCards: false,
  theme: "dark-blue",
  viewMode: "grid",
  visibleCount: 1,
};

export const SIDEBAR_STORY_ARG_TYPES: NonNullable<Meta<SidebarStoryArgs>["argTypes"]> = {
  createSessionOnSidebarDoubleClick: {
    control: "boolean",
  },
  debuggingMode: {
    control: "boolean",
  },
  fixture: {
    control: "select",
    options: [
      "agent-icon-render",
      "browser-groups",
      "combined-header-alignment",
      "combined-recent-projects",
      "combined-sparse-reference",
      "command-indicator-active",
      "default",
      "sort-toggle-demo",
      "selector-states",
      "overflow-stress",
      "scroll-end-retention",
      "empty-groups",
      "three-groups-stress",
    ],
  },
  highlightedVisibleCount: {
    control: "inline-radio",
    options: [1, 2, 3, 4, 6, 9],
  },
  isFocusModeActive: {
    control: "boolean",
  },
  renameSessionOnDoubleClick: {
    control: "boolean",
  },
  showCloseButtonOnSessionCards: {
    control: "boolean",
  },
  showHotkeysOnSessionCards: {
    control: "boolean",
  },
  theme: {
    control: "select",
    options: [
      "plain-dark",
      "plain-light",
      "dark-green",
      "dark-blue",
      "dark-red",
      "dark-pink",
      "dark-orange",
      "light-blue",
      "light-green",
      "light-pink",
      "light-orange",
    ],
  },
  viewMode: {
    control: "inline-radio",
    options: ["horizontal", "vertical", "grid"],
  },
  visibleCount: {
    control: "inline-radio",
    options: [1, 2, 3, 4, 6, 9],
  },
};

export const SIDEBAR_STORY_DECORATORS = [
  (Story: () => JSX.Element) => (
    <SidebarStoryFrame>
      <Story />
    </SidebarStoryFrame>
  ),
];

export function renderSidebarStory(args: SidebarStoryArgs) {
  return <SidebarStoryHarnessWithCurrentSettings args={args} />;
}

export function renderCombinedSidebarStory(args: SidebarStoryArgs) {
  return (
    <div className="native-sidebar-shell" data-sidebar-mode="combined">
      <main className="native-sidebar-main">
        <SidebarStoryHarnessWithCurrentSettings args={args} />
      </main>
    </div>
  );
}

function SidebarStoryHarnessWithCurrentSettings({ args }: { args: SidebarStoryArgs }) {
  const currentSettings = useCurrentSidebarSettings();
  return <SidebarStoryHarness message={createSidebarStoryMessage(args, currentSettings)} />;
}

function SidebarStoryFrame({ children }: { children: JSX.Element }) {
  const currentSettings = useCurrentSidebarSettings();
  const sidebarWidth =
    typeof currentSettings?.sidebarWidth === "number" && Number.isFinite(currentSettings.sidebarWidth)
      ? Math.max(220, Math.min(420, currentSettings.sidebarWidth))
      : 260;

  return (
    <div
      style={{
        boxSizing: "border-box",
        height: "100vh",
        overflow: "hidden",
        width: `${sidebarWidth}px`,
      }}
    >
      {children}
    </div>
  );
}

function useCurrentSidebarSettings(): SidebarStoryCurrentSettings | undefined {
  const [settings, setSettings] = useState<SidebarStoryCurrentSettings | undefined>();

  useEffect(() => {
    let isMounted = true;
    void fetch("/__zmux-current-sidebar-settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: unknown) => {
        if (isMounted && payload && typeof payload === "object" && !Array.isArray(payload)) {
          /**
           * CDXC:StorybookSettings 2026-05-08-16:45
           * Storybook must render sidebar scenarios with the same persisted
           * native settings snapshot as the running zmux app. This keeps local
           * visual checks honest for width, combined-mode visibility, theme,
           * and session-card chrome preferences.
           */
          setSettings(payload as SidebarStoryCurrentSettings);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSettings(undefined);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return settings;
}
