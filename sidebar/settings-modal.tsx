import { DragDropProvider, type DragDropEventHandlers } from "@dnd-kit/react";
import { isSortableOperation, useSortable } from "@dnd-kit/react/sortable";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Fuse from "fuse.js";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IconAsterisk,
  IconCodeDots,
  IconFolderOpen,
  IconGripVertical,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconTerminal2,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { COMPLETION_SOUND_OPTIONS, type CompletionSoundSetting } from "../shared/completion-sound";
import { ZMUX_RECOMMENDED_GHOSTTY_CONFIG_LINES } from "../shared/ghostty-config-actions";
import {
  resolveSidebarTheme,
  type SidebarZmuxFolderStatsMessage,
  type SidebarTheme,
  type SidebarThemeVariant,
} from "../shared/session-grid-contract";
import {
  BROWSER_OPEN_MODE_OPTIONS,
  DEFAULT_zmux_SETTINGS,
  GHOSTTY_CONFIRM_CLOSE_SURFACE_OPTIONS,
  GHOSTTY_COPY_ON_SELECT_OPTIONS,
  GHOSTTY_SCROLLBAR_OPTIONS,
  GHOSTTY_THEME_SETTING_OPTIONS,
  PROMPT_EDITOR_BACKEND_OPTIONS,
  type PromptEditorBackend,
  SESSION_PERSISTENCE_PROVIDER_OPTIONS,
  SESSION_STATUS_INDICATOR_SIZE_OPTIONS,
  SIDEBAR_MODE_OPTIONS,
  SIDEBAR_SIDE_OPTIONS,
  SIDEBAR_THEME_SETTING_OPTIONS,
  ZED_OVERLAY_TARGET_APP_OPTIONS,
  normalizezmuxSettings,
  type BrowserOpenMode,
  type GhosttyConfirmCloseSurface,
  type GhosttyCopyOnSelect,
  type GhosttyScrollbar,
  type SessionPersistenceProvider,
  type SessionStatusIndicatorSize,
  type SidebarMode,
  type SidebarSide,
  type TerminalCursorStyle,
  type ZedOverlayTargetApp,
  type zmuxSettings,
} from "../shared/zmux-settings";
import {
  BUILT_IN_WORKSPACE_OPEN_TARGETS,
  CUSTOM_WORKSPACE_OPEN_TARGET_ID_PREFIX,
  createWorkspaceOpenTargetSlug,
  normalizeCustomWorkspaceOpenTargets,
  normalizeWorkspaceOpenTargetHiddenIds,
  type CustomWorkspaceOpenTarget,
} from "../shared/workspace-open-targets";
import {
  DEFAULT_SIDEBAR_AGENTS,
  getDefaultSidebarAgentByIcon,
  type SidebarAgentButton,
  type SidebarAgentIcon,
} from "../shared/sidebar-agents";
import {
  DEFAULT_BROWSER_ACTION_URL,
  type SidebarActionType,
  type SidebarCommandButton,
} from "../shared/sidebar-commands";
import {
  DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
  normalizeSidebarCommandIconColor,
  type SidebarCommandIcon,
} from "../shared/sidebar-command-icons";
import {
  DEFAULT_zmux_HOTKEYS,
  ZMUX_HOTKEY_DEFINITIONS,
  normalizeHotkeyText,
  normalizezmuxHotkeySettings,
  type zmuxHotkeyActionId,
  type zmuxHotkeySettings,
} from "../shared/zmux-hotkeys";
import { PET_OPTIONS, type PetId } from "../shared/pets";
import { AGENT_LOGO_COLORS, AGENT_LOGOS } from "./agent-logos";
import { HotkeyRecorderField } from "./hotkey-recorder-field";
import { PetAvatar } from "./pet-avatar";
import { SidebarCommandIconGlyph, SIDEBAR_COMMAND_ICON_OPTIONS } from "./sidebar-command-icon";
import { useSidebarStore } from "./sidebar-store";
import type { AgentConfigDraft } from "./agent-config-modal";
import type { CommandConfigDraft } from "./command-config-modal";
import type { WebviewApi } from "./webview-api";

const NUMERIC_SETTINGS_DEBOUNCE_MS = 180;
const GHOSTTY_THEME_UNMANAGED_VALUE = "__zmux_ghostty_theme_unmanaged__";
const MODIFIED_SETTING_TOOLTIP = "Modified Setting.\n \nClick to Reset to Default";

type SettingSearchDefinition = {
  key: string;
  options?: ReadonlyArray<{ label: string; value: string }>;
  subtitle?: string;
  title: string;
};

type SettingsSectionSearchResult = {
  isSearching: boolean;
  sectionMatches: boolean;
  visibleSettingKeys: Set<string>;
};

type SettingModificationProps = {
  isModified?: boolean;
  onResetToDefault?: () => void;
};

export type SettingsModalTab = "settings" | "agents" | "actions" | "openTargets" | "hotkeys";

let rememberedSettingsModalTab: SettingsModalTab | undefined;

function getInitialSettingsModalTab(initialTab: SettingsModalTab): SettingsModalTab {
  /**
   * CDXC:Settings 2026-05-11-09:06
   * Settings remembers the last selected tab for the current app session. A
   * non-default entry point such as Hotkeys still opens its requested tab, then
   * that tab becomes the remembered choice until the app restarts.
   */
  if (initialTab !== "settings") {
    return initialTab;
  }
  return rememberedSettingsModalTab ?? initialTab;
}

function hasActiveHotkeyRecorder(): boolean {
  return Boolean(document.querySelector("[data-hotkey-recorder='true'][data-recording='true']"));
}

export type GhosttySettingsAction =
  | "applyRecommendedGhosttySettings"
  | "openGhosttyConfigFile"
  | "openGhosttySettingsDocs"
  | "resetGhosttySettingsToDefault";

export type SettingsModalProps = {
  accessibilityPermissionGranted?: boolean;
  initialTab?: SettingsModalTab;
  isOpen: boolean;
  onChange: (settings: zmuxSettings) => void;
  onClose: () => void;
  onOpenAccessibilityPreferences?: () => void;
  onOpenMacOSNotificationSettings?: () => void;
  onOpenZmuxFolder?: () => void;
  onGhosttySettingsAction?: (action: GhosttySettingsAction) => void;
  onInstallZapet?: () => void;
  onPlayCompletionSound?: (sound: CompletionSoundSetting) => void;
  onRequestMacOSNotificationPermission?: () => void;
  onRequestZmuxFolderStats?: () => void;
  onTestAgentTaskCompletion?: () => void;
  settings?: zmuxSettings;
  theme?: SidebarTheme;
  vscode?: WebviewApi;
  zmuxFolderStats?: SidebarZmuxFolderStatsMessage;
  zmuxFolderStatsLoading?: boolean;
};

export function SettingsModal({
  accessibilityPermissionGranted,
  initialTab = "settings",
  isOpen,
  onChange,
  onClose,
  onOpenAccessibilityPreferences,
  onOpenMacOSNotificationSettings,
  onOpenZmuxFolder,
  onGhosttySettingsAction,
  onInstallZapet,
  onPlayCompletionSound,
  onRequestMacOSNotificationPermission,
  onRequestZmuxFolderStats,
  onTestAgentTaskCompletion,
  settings,
  theme = "dark-blue",
  vscode,
  zmuxFolderStats,
  zmuxFolderStatsLoading = false,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<zmuxSettings>(normalizezmuxSettings(settings));
  const [settingsSearchQuery, setSettingsSearchQuery] = useState("");
  const [activeTab, setActiveTabState] = useState<SettingsModalTab>(() =>
    getInitialSettingsModalTab(initialTab),
  );
  const pendingSettingsRef = useRef<zmuxSettings | undefined>(undefined);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const storageSectionRef = useRef<HTMLDivElement>(null);
  const hasRequestedStorageStatsRef = useRef(false);
  const modalTheme = resolveSidebarTheme(draft.sidebarTheme, getSidebarThemeVariant(theme));
  const isModalDarkTheme = getSidebarThemeVariant(modalTheme) === "dark";
  const setActiveTab = (nextTab: SettingsModalTab) => {
    rememberedSettingsModalTab = nextTab;
    setActiveTabState(nextTab);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const nextTab = getInitialSettingsModalTab(initialTab);
    rememberedSettingsModalTab = nextTab;
    setActiveTabState(nextTab);
  }, [initialTab, isOpen]);

  /**
   * CDXC:SettingsSearch 2026-05-04-02:30
   * Settings search must be fuzzy and cover section titles, setting subtitles,
   * and selectable option text so users can find controls by the value they
   * want to choose, not only by the visible setting label.
   */
  const settingsSearch = {
    browser: getSettingsSectionSearch(settingsSearchQuery, "Browser", [
      {
        key: "browserOpenMode",
        options: BROWSER_OPEN_MODE_OPTIONS,
        subtitle: "Choose where browser actions open URLs.",
        title: "Open URLs With",
      },
    ]),
    editor: getSettingsSectionSearch(settingsSearchQuery, "Editor", [
      {
        key: "codeServerLinkVscodeUserConfig",
        subtitle: "Use the VS Code settings from the local VS Code install.",
        title: "Use VS Code settings",
      },
      {
        key: "codeServerUseVscodeInsidersUserConfig",
        subtitle: "Use the VS Code Insiders user settings directory.",
        title: "Use VS Code Insiders settings",
      },
      {
        key: "showProjectEditorDiffFileCount",
        subtitle: "Show changed-file counts in project editor rows.",
        title: "Show editor file count",
      },
    ]),
    ideAttachment: getSettingsSectionSearch(settingsSearchQuery, "IDE Attachment", [
      {
        key: "accessibilityPermission",
        subtitle: "Check macOS Accessibility status and open the privacy settings page.",
        title: "Accessibility Permission",
      },
      {
        key: "zedOverlayEnabled",
        subtitle: "Attach zmux as an overlay to the selected IDE.",
        title: "Attach zmux to IDE",
      },
      {
        key: "zedOverlayHideTitlebarButton",
        subtitle: "Hide the native Attach/Detach IDE button from the zmux title bar.",
        title: "Hide title-bar attach button",
      },
      {
        key: "zedOverlayTargetApp",
        options: ZED_OVERLAY_TARGET_APP_OPTIONS,
        subtitle: "Select which IDE should receive the overlay.",
        title: "Target IDE",
      },
      {
        key: "syncOpenProjectWithZed",
        subtitle: "Open the active zmux project in the attached IDE after switching workspaces.",
        title: "Sync active project with IDE",
      },
    ]),
    sessionCards: getSettingsSectionSearch(settingsSearchQuery, "Session Cards", [
      {
        key: "showCloseButtonOnSessionCards",
        subtitle: "Reveal the close control when hovering a card.",
        title: "Show close button on hover",
      },
      {
        key: "showHotkeysOnSessionCards",
        subtitle: "Display card shortcuts where available.",
        title: "Show hotkeys on cards",
      },
      {
        key: "showLastInteractionTimeOnSessionCards",
        subtitle: "Choose Last Active as the default trailing card detail instead of Agent Icon.",
        title: "Use Last Active instead of Agent Icon",
      },
    ]),
    pets: getSettingsSectionSearch(settingsSearchQuery, "Pets", [
      {
        key: "petOverlayEnabled",
        subtitle: "Show the draggable animated pet in the native sidebar.",
        title: "Wake Pet",
      },
      {
        key: "selectedPetId",
        options: PET_OPTIONS.map((option) => ({ label: option.displayName, value: option.id })),
        subtitle: "Choose the pet sprite.",
        title: "Pet",
      },
    ]),
    sidebar: getSettingsSectionSearch(settingsSearchQuery, "Sidebar", [
      {
        key: "sidebarSide",
        options: SIDEBAR_SIDE_OPTIONS,
        subtitle: "Choose which side of the screen holds the sidebar.",
        title: "Side",
      },
      {
        key: "sidebarMode",
        options: SIDEBAR_MODE_OPTIONS,
        subtitle: "Choose how project sessions are grouped.",
        title: "Mode",
      },
      {
        key: "sidebarTheme",
        options: SIDEBAR_THEME_SETTING_OPTIONS,
        subtitle: "Choose the sidebar color scheme.",
        title: "Theme",
      },
      {
        key: "hideFloatingSessionStatusIndicators",
        subtitle: "Hide the desktop floating session status badges.",
        title: "Hide Floating Session Indicators",
      },
      {
        key: "hideMenuBarSessionStatusIndicators",
        subtitle: "Hide the menu bar session status badges.",
        title: "Hide Menu Bar Session Indicators",
      },
      {
        key: "sessionStatusIndicatorSize",
        options: SESSION_STATUS_INDICATOR_SIZE_OPTIONS,
        subtitle: "Scale the floating session status indicator.",
        title: "Floating Session Indicator Size",
      },
      {
        key: "agentManagerZoomPercent",
        subtitle: "Scale the agent manager UI.",
        title: "Agent Manager Zoom",
      },
      {
        key: "showSidebarActions",
        subtitle: "Show the command and action launcher.",
        title: "Show Actions section",
      },
      {
        key: "showSidebarAgents",
        subtitle: "Show active agent sessions.",
        title: "Show Agents section",
      },
      {
        key: "showSidebarGitButton",
        subtitle: "Show git tools in the sidebar toolbar.",
        title: "Show Git button",
      },
      {
        key: "createSessionOnSidebarDoubleClick",
        subtitle: "Create a session from empty sidebar space.",
        title: "Double-click empty sidebar space to create a session",
      },
      {
        key: "renameSessionOnDoubleClick",
        subtitle: "Rename sessions directly from their cards.",
        title: "Double-click session cards to rename",
      },
    ]),
    sounds: getSettingsSectionSearch(settingsSearchQuery, "Sounds", [
      {
        key: "completionBellEnabled",
        subtitle: "Play a completion sound when work finishes.",
        title: "Enable completion bell",
      },
      {
        key: "completionSound",
        options: COMPLETION_SOUND_OPTIONS,
        subtitle: "Sound for terminal completions.",
        title: "Completion Sound",
      },
      {
        key: "showMacOSAttentionNotifications",
        subtitle: "Show a macOS banner when a session needs attention.",
        title: "macOS Attention Notifications",
      },
      {
        key: "attentionNotificationActions",
        subtitle: "Test the current completion alert settings or open macOS Notification Settings.",
        title: "Agent Completion Alert Test",
      },
      {
        key: "actionCompletionSound",
        options: COMPLETION_SOUND_OPTIONS,
        subtitle: "Sound for action completions.",
        title: "Action Completion Sound",
      },
    ]),
    storage: getSettingsSectionSearch(settingsSearchQuery, "Storage", [
      {
        key: "zmuxFolderStats",
        options: [
          { label: "Open zmux folder", value: "openZmuxFolder" },
          { label: "Folder sizes", value: "folderSizes" },
          { label: "Disk usage", value: "diskUsage" },
        ],
        subtitle: "Show ~/.zmux folder sizes and open the folder in Finder.",
        title: "zmux folder",
      },
    ]),
    terminal: getSettingsSectionSearch(settingsSearchQuery, "Terminal", [
      {
        key: "ghosttySettingsActions",
        options: [
          { label: "Apply recommended", value: "applyRecommendedGhosttySettings" },
          { label: "Open Ghostty config", value: "openGhosttyConfigFile" },
          { label: "Open Ghostty docs", value: "openGhosttySettingsDocs" },
          { label: "Reset Ghostty defaults", value: "resetGhosttySettingsToDefault" },
        ],
        subtitle:
          "Recommended Ghostty settings, Ghostty config file, Ghostty docs, and Ghostty defaults.",
        title: "Ghostty settings actions",
      },
      {
        key: "terminalGhosttyTheme",
        options: GHOSTTY_THEME_SETTING_OPTIONS,
        subtitle: "Choose a bundled Ghostty theme or leave the config unmanaged.",
        title: "Theme",
      },
      {
        key: "terminalFontFamily",
        subtitle: "Type a Ghostty font-family name.",
        title: "Font Family",
      },
      {
        key: "terminalFontSize",
        subtitle: "Set terminal text size.",
        title: "Font Size",
      },
      {
        key: "terminalFontWeight",
        subtitle: "Set terminal text weight.",
        title: "Font Weight",
      },
      {
        key: "terminalLineHeight",
        subtitle: "Adjust terminal row height.",
        title: "Line Height",
      },
      {
        key: "terminalLetterSpacing",
        subtitle: "Adjust spacing between glyphs.",
        title: "Letter Spacing",
      },
      {
        key: "terminalCursorStyle",
        options: [
          { label: "Line", value: "bar" },
          { label: "Block", value: "block" },
          { label: "Underline", value: "underline" },
        ],
        subtitle: "Choose the cursor shape.",
        title: "Cursor Style",
      },
      {
        key: "terminalCursorStyleBlink",
        subtitle: "Blink the terminal cursor.",
        title: "Cursor blink",
      },
      {
        key: "sessionPersistenceProvider",
        options: SESSION_PERSISTENCE_PROVIDER_OPTIONS,
        subtitle:
          "Enable only when you need ssh from other devices to continue zmux-created sessions.",
        title: "Session Persistence (Beta)",
      },
      {
        key: "promptEditorBackend",
        options: [...PROMPT_EDITOR_BACKEND_OPTIONS, { label: "Install Zapet", value: "installZapet" }],
        subtitle:
          "Choose which floating editor Ctrl+G uses when a terminal prompt asks for $EDITOR.",
        title: "Ctrl+G prompt editor",
      },
    ]),
    terminalBehavior: getSettingsSectionSearch(settingsSearchQuery, "Terminal Behavior", [
      {
        key: "terminalScrollbackLimitMb",
        subtitle: "Set scrollback memory per terminal surface.",
        title: "Scrollback limit",
      },
      {
        key: "terminalCopyOnSelect",
        options: GHOSTTY_COPY_ON_SELECT_OPTIONS,
        subtitle: "Copy selected terminal text automatically.",
        title: "Copy on select",
      },
      {
        key: "terminalConfirmCloseSurface",
        options: GHOSTTY_CONFIRM_CLOSE_SURFACE_OPTIONS,
        subtitle: "Confirm before closing terminal surfaces.",
        title: "Confirm close",
      },
      {
        key: "terminalClipboardTrimTrailingSpaces",
        subtitle: "Trim trailing whitespace when copying terminal text.",
        title: "Trim trailing spaces on copy",
      },
      {
        key: "terminalClipboardPasteProtection",
        subtitle: "Ask before pasting text Ghostty considers unsafe.",
        title: "Paste protection",
      },
      {
        key: "terminalMouseHideWhileTyping",
        subtitle: "Hide the pointer while typing in the terminal.",
        title: "Hide mouse while typing",
      },
      {
        key: "terminalScrollbar",
        options: GHOSTTY_SCROLLBAR_OPTIONS,
        subtitle: "Control whether Ghostty shows its native scrollback scrollbar.",
        title: "Scrollbar",
      },
    ]),
    terminalScrolling: getSettingsSectionSearch(settingsSearchQuery, "Terminal Scrolling", [
      {
        key: "terminalMouseScrollMultiplierPrecision",
        subtitle: "Trackpads and high-resolution scroll wheels. Ghostty default is 1.",
        title: "Precision scroll multiplier",
      },
      {
        key: "terminalMouseScrollMultiplierDiscrete",
        subtitle: "Traditional notched mouse wheels. Ghostty default is 3.",
        title: "Discrete scroll multiplier",
      },
      {
        key: "terminalScrollToBottomWhenTyping",
        subtitle: "Keep the prompt visible while typing.",
        title: "Scroll to bottom when typing",
      },
    ]),
    workspace: getSettingsSectionSearch(settingsSearchQuery, "Workspace", [
      {
        key: "workspacePaneGap",
        subtitle: "Control spacing between panes.",
        title: "Pane Gap",
      },
      {
        key: "workspaceActivePaneBorderColor",
        subtitle: "CSS color for the focused pane border.",
        title: "Active Pane Border",
      },
      {
        key: "workspaceBackgroundColor",
        subtitle: "Color shown behind terminal panes.",
        title: "Terminal Background",
      },
      {
        key: "debuggingMode",
        subtitle: "Expose debugging-only sidebar controls.",
        title: "Show debugging UI",
      },
    ]),
  };
  const hasVisibleSettings = Object.values(settingsSearch).some(hasVisibleSettingsSearchResult);

  useEffect(() => {
    if (!isOpen) {
      hasRequestedStorageStatsRef.current = false;
      return;
    }
    setDraft(normalizezmuxSettings(settings));
    setActiveTab(initialTab);
  }, [initialTab, isOpen, settings]);

  useEffect(() => {
    if (
      !isOpen ||
      activeTab !== "settings" ||
      zmuxFolderStats ||
      zmuxFolderStatsLoading ||
      !onRequestZmuxFolderStats ||
      hasRequestedStorageStatsRef.current
    ) {
      return;
    }
    const sectionElement = storageSectionRef.current;
    if (!sectionElement) {
      return;
    }

    const requestStats = () => {
      hasRequestedStorageStatsRef.current = true;
      onRequestZmuxFolderStats();
    };

    /**
     * CDXC:SettingsStorage 2026-05-09-15:25
     * Folder-size scans can touch many files, so Settings waits until the
     * bottom storage card is near the viewport before asking native for stats.
     */
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          requestStats();
          observer.disconnect();
        }
      },
      { rootMargin: "96px 0px" },
    );
    observer.observe(sectionElement);
    return () => observer.disconnect();
  }, [
    activeTab,
    isOpen,
    onRequestZmuxFolderStats,
    settingsSearchQuery,
    zmuxFolderStats,
    zmuxFolderStatsLoading,
  ]);

  useEffect(() => {
    return () => {
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }
    };
  }, []);

  const clearPendingSettings = () => {
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = undefined;
    }
  };

  const flushPendingSettings = () => {
    clearPendingSettings();
    const pendingSettings = pendingSettingsRef.current;
    pendingSettingsRef.current = undefined;
    if (pendingSettings) {
      onChange(pendingSettings);
    }
  };

  const applySettings = (nextSettings: zmuxSettings) => {
    const normalizedSettings = normalizezmuxSettings(nextSettings);
    clearPendingSettings();
    pendingSettingsRef.current = undefined;
    setDraft(normalizedSettings);
    onChange(normalizedSettings);
  };

  /**
   * CDXC:Settings 2026-04-26-11:13: Numeric settings use sliders with adjacent
   * number boxes. Dragging or typing updates the visible value immediately, but
   * persists through a short trailing debounce to avoid flooding settings writes.
   * Number boxes keep local edit text so partial values can be typed cleanly.
   */
  const applySettingsDebounced = (nextSettings: zmuxSettings) => {
    const normalizedSettings = normalizezmuxSettings(nextSettings);
    pendingSettingsRef.current = normalizedSettings;
    setDraft(normalizedSettings);
    clearPendingSettings();
    pendingTimeoutRef.current = setTimeout(() => {
      const pendingSettings = pendingSettingsRef.current;
      pendingSettingsRef.current = undefined;
      pendingTimeoutRef.current = undefined;
      if (pendingSettings) {
        onChange(pendingSettings);
      }
    }, NUMERIC_SETTINGS_DEBOUNCE_MS);
  };

  /**
   * CDXC:Settings 2026-04-26-10:12: Settings changes must apply immediately.
   * The settings dialog keeps local state only for responsive controls, then
   * posts every normalized change instead of waiting for Save/Cancel actions.
   */
  const updateDraft = <Key extends keyof zmuxSettings>(key: Key, value: zmuxSettings[Key]) => {
    applySettings({ ...(pendingSettingsRef.current ?? draft), [key]: value });
  };
  const updateDraftDebounced = <Key extends keyof zmuxSettings>(
    key: Key,
    value: zmuxSettings[Key],
  ) => {
    applySettingsDebounced({ ...(pendingSettingsRef.current ?? draft), [key]: value });
  };

  const resetSettings = () => applySettings(DEFAULT_zmux_SETTINGS);
  const resetSetting = <Key extends keyof zmuxSettings>(key: Key) => {
    applySettings({
      ...(pendingSettingsRef.current ?? draft),
      [key]: DEFAULT_zmux_SETTINGS[key],
    });
  };
  const getSettingModificationProps = <Key extends keyof zmuxSettings>(
    key: Key,
  ): Required<SettingModificationProps> => ({
    isModified: !Object.is(
      (pendingSettingsRef.current ?? draft)[key],
      DEFAULT_zmux_SETTINGS[key],
    ),
    onResetToDefault: () => resetSetting(key),
  });

  const applyRecommendedGhosttySettings = () => {
    /**
     * CDXC:GhosttySettings 2026-04-30-01:48
     * The recommended Ghostty button must update both the visible zmux controls
     * and the real Ghostty config keys that are not modeled in zmux settings.
     */
    applySettings({
      ...draft,
      terminalCursorStyle: "bar",
      terminalFontFamily: "JetBrains Mono",
      terminalFontSize: 13,
      terminalFontWeight: 400,
      terminalLetterSpacing: 0,
      terminalLineHeight: 1.2,
      terminalMouseScrollMultiplierDiscrete: 1,
      terminalMouseScrollMultiplierPrecision: 1,
    });
    onGhosttySettingsAction?.("applyRecommendedGhosttySettings");
  };

  const resetGhosttySettingsToDefault = () => {
    /**
     * CDXC:GhosttySettings 2026-04-30-01:48
     * Resetting Ghostty defaults should also move the visible terminal
     * controls back to zmux defaults, then remove managed keys from the real
     * Ghostty config so Ghostty's own defaults take effect.
     */
    applySettings({
      ...draft,
      terminalCursorStyle: DEFAULT_zmux_SETTINGS.terminalCursorStyle,
      terminalFontFamily: DEFAULT_zmux_SETTINGS.terminalFontFamily,
      terminalFontSize: DEFAULT_zmux_SETTINGS.terminalFontSize,
      terminalFontWeight: DEFAULT_zmux_SETTINGS.terminalFontWeight,
      terminalLetterSpacing: DEFAULT_zmux_SETTINGS.terminalLetterSpacing,
      terminalLineHeight: DEFAULT_zmux_SETTINGS.terminalLineHeight,
      terminalMouseScrollMultiplierDiscrete:
        DEFAULT_zmux_SETTINGS.terminalMouseScrollMultiplierDiscrete,
      terminalMouseScrollMultiplierPrecision:
        DEFAULT_zmux_SETTINGS.terminalMouseScrollMultiplierPrecision,
      terminalScrollToBottomWhenTyping: DEFAULT_zmux_SETTINGS.terminalScrollToBottomWhenTyping,
    });
    onGhosttySettingsAction?.("resetGhosttySettingsToDefault");
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          flushPendingSettings();
          onClose();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        className={cn(
          "zmux-settings-shadcn flex h-[min(700px,calc(100vh-2rem))] max-h-[min(700px,calc(100vh-2rem))] flex-col gap-0 overflow-hidden p-0 font-sans sm:max-w-xl",
          isModalDarkTheme && "dark",
        )}
        data-sidebar-theme={modalTheme}
        onEscapeKeyDown={(event) => {
          if (hasActiveHotkeyRecorder()) {
            event.preventDefault();
          }
        }}
      >
        <TooltipProvider delayDuration={300}>
          <Tabs
            className="flex min-h-0 flex-1 flex-col"
            onValueChange={(value) => setActiveTab(value as SettingsModalTab)}
            value={activeTab}
          >
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="text-xl">Settings</DialogTitle>
            {/*
             * CDXC:UnifiedSettings 2026-05-09-15:30
             * Settings is the single configuration surface. Agents, Actions,
             * and Hotkeys are tabs in this shadcn dialog instead of separate
             * configure modals, while the original Settings content remains the
             * first tab and keeps its search behavior.
             */}
            <TabsList className="mt-3 w-full">
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="agents">Agents</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
              <TabsTrigger value="openTargets">Open In</TabsTrigger>
              <TabsTrigger value="hotkeys">Hotkeys</TabsTrigger>
            </TabsList>
            {activeTab === "settings" ? (
              <Input
                aria-label="Search settings"
                className="mt-3 h-10 px-3 text-sm"
                onChange={(event) => setSettingsSearchQuery(event.currentTarget.value)}
                placeholder="Search settings"
                value={settingsSearchQuery}
              />
            ) : null}
          </DialogHeader>

          <TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="settings">
          {/* CDXC:Settings 2026-04-26-10:43: The settings dialog lives inside a
              narrow sidebar webview, so the Radix scroll area needs an explicit
              height instead of letting Dialog crop an auto-height viewport. */}
          {/* CDXC:UnifiedSettings 2026-05-09-17:08: The Settings dialog is now a
              tabbed surface with variable header height. The active tab owns
              the remaining vertical space so the dialog never clips the bottom
              of a fixed-height scroll area. */}
          <ScrollArea className="h-full min-h-0">
          <div className="flex flex-col gap-6 px-5 pb-5">
            {accessibilityPermissionGranted === false ? (
              /**
               * CDXC:AccessibilityPermissions 2026-05-08-13:08
               * Settings should expose missing macOS Accessibility status
               * without implying zmux needs the permission at startup. IDE
               * attachment is the feature that asks for it when enabled.
               */
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-foreground">
                Accessibility is off. IDE attachment won't work until it is allowed in macOS.
              </div>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.sidebar) ? (
              <SettingsSection title="Sidebar">
              {/* CDXC:SidebarPlacement 2026-05-06-17:32: Sidebar side is the
                  first Sidebar setting so users can move the sidebar to the
                  right side from Settings without discovering the hotkey. */}
              {shouldShowSetting(settingsSearch.sidebar, "sidebarSide") ? (
              <SelectField
                description="Choose which side of the screen holds the sidebar."
                label="Side"
                {...getSettingModificationProps("sidebarSide")}
                onChange={(value) => updateDraft("sidebarSide", value as SidebarSide)}
                options={SIDEBAR_SIDE_OPTIONS}
                value={draft.sidebarSide}
              />
              ) : null}
              {/* CDXC:SidebarMode 2026-05-03-10:42: Combined mode is a
                  sidebar-wide presentation choice, not a section visibility
                  toggle. Keep it above the per-section controls so users can
                  switch back to the previous separated multi-group behavior. */}
              {shouldShowSetting(settingsSearch.sidebar, "sidebarMode") ? (
              <SelectField
                description="Choose how project sessions are grouped."
                label="Mode"
                {...getSettingModificationProps("sidebarMode")}
                onChange={(value) => updateDraft("sidebarMode", value as SidebarMode)}
                options={SIDEBAR_MODE_OPTIONS}
                value={draft.sidebarMode}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sidebar, "sidebarTheme") ? (
              <StaticNoteField
                description="Dark Gray is active. Themes are coming back soon."
                label="Theme"
              />
              ) : null}
              {/* CDXC:SessionStatusIndicators 2026-05-09-17:30: Settings must
                  expose independent hide toggles because floating badges are
                  hidden by default while menu bar badges are shown by default. */}
              {shouldShowSetting(settingsSearch.sidebar, "hideFloatingSessionStatusIndicators") ? (
              <ToggleField
                checked={draft.hideFloatingSessionStatusIndicators}
                description="Hide the desktop floating session status badges."
                label="Hide Floating Session Indicators"
                {...getSettingModificationProps("hideFloatingSessionStatusIndicators")}
                onChange={(checked) => updateDraft("hideFloatingSessionStatusIndicators", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sidebar, "hideMenuBarSessionStatusIndicators") ? (
              <ToggleField
                checked={draft.hideMenuBarSessionStatusIndicators}
                description="Hide the menu bar session status badges."
                label="Hide Menu Bar Session Indicators"
                {...getSettingModificationProps("hideMenuBarSessionStatusIndicators")}
                onChange={(checked) => updateDraft("hideMenuBarSessionStatusIndicators", checked)}
              />
              ) : null}
              {/* CDXC:SessionStatusIndicators 2026-05-07-18:20: The floating
                  AppKit indicator size is a Sidebar setting because it controls
                  sidebar-owned session navigation chrome outside the webview. */}
              {shouldShowSetting(settingsSearch.sidebar, "sessionStatusIndicatorSize") ? (
              <SelectField
                description="Scale the floating session status indicator."
                label="Floating Session Indicator Size"
                {...getSettingModificationProps("sessionStatusIndicatorSize")}
                onChange={(value) =>
                  updateDraft("sessionStatusIndicatorSize", value as SessionStatusIndicatorSize)
                }
                options={SESSION_STATUS_INDICATOR_SIZE_OPTIONS}
                value={draft.sessionStatusIndicatorSize}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sidebar, "agentManagerZoomPercent") ? (
              <SliderNumberField
                description="Scale the agent manager UI."
                label="Agent Manager Zoom"
                {...getSettingModificationProps("agentManagerZoomPercent")}
                max={200}
                min={50}
                onCommit={(value) => updateDraft("agentManagerZoomPercent", value)}
                onChange={(value) => updateDraftDebounced("agentManagerZoomPercent", value)}
                step={1}
                value={draft.agentManagerZoomPercent}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sidebar, "showSidebarActions") ? (
              <ToggleField
                checked={draft.showSidebarActions}
                description="Show the command and action launcher."
                label="Show Actions section"
                {...getSettingModificationProps("showSidebarActions")}
                onChange={(checked) => updateDraft("showSidebarActions", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sidebar, "showSidebarAgents") ? (
              <ToggleField
                checked={draft.showSidebarAgents}
                description="Show active agent sessions."
                label="Show Agents section"
                {...getSettingModificationProps("showSidebarAgents")}
                onChange={(checked) => updateDraft("showSidebarAgents", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sidebar, "showSidebarGitButton") ? (
              <ToggleField
                checked={draft.showSidebarGitButton}
                description="Show git tools in the sidebar toolbar."
                label="Show Git button"
                {...getSettingModificationProps("showSidebarGitButton")}
                onChange={(checked) => updateDraft("showSidebarGitButton", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sidebar, "createSessionOnSidebarDoubleClick") ? (
              <ToggleField
                checked={draft.createSessionOnSidebarDoubleClick}
                description="Create a session from empty sidebar space."
                label="Double-click empty sidebar space to create a session"
                {...getSettingModificationProps("createSessionOnSidebarDoubleClick")}
                onChange={(checked) => updateDraft("createSessionOnSidebarDoubleClick", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sidebar, "renameSessionOnDoubleClick") ? (
              <ToggleField
                checked={draft.renameSessionOnDoubleClick}
                description="Rename sessions directly from their cards."
                label="Double-click session cards to rename"
                {...getSettingModificationProps("renameSessionOnDoubleClick")}
                onChange={(checked) => updateDraft("renameSessionOnDoubleClick", checked)}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.pets) ? (
            <SettingsSection title="Pets">
              {shouldShowSetting(settingsSearch.pets, "petOverlayEnabled") ? (
              <ToggleField
                checked={draft.petOverlayEnabled}
                description="Show the draggable animated pet in the native sidebar."
                label="Wake Pet"
                {...getSettingModificationProps("petOverlayEnabled")}
                onChange={(checked) => updateDraft("petOverlayEnabled", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.pets, "selectedPetId") ? (
              <PetPickerField
                {...getSettingModificationProps("selectedPetId")}
                onChange={(value) => updateDraft("selectedPetId", value)}
                value={draft.selectedPetId}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.sessionCards) ? (
            <SettingsSection title="Session Cards">
              {shouldShowSetting(settingsSearch.sessionCards, "showCloseButtonOnSessionCards") ? (
              <ToggleField
                checked={draft.showCloseButtonOnSessionCards}
                description="Reveal the close control when hovering a card."
                label="Show close button on hover"
                {...getSettingModificationProps("showCloseButtonOnSessionCards")}
                onChange={(checked) => updateDraft("showCloseButtonOnSessionCards", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sessionCards, "showHotkeysOnSessionCards") ? (
              <ToggleField
                checked={draft.showHotkeysOnSessionCards}
                description="Display card shortcuts where available."
                label="Show hotkeys on cards"
                {...getSettingModificationProps("showHotkeysOnSessionCards")}
                onChange={(checked) => updateDraft("showHotkeysOnSessionCards", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sessionCards, "showLastInteractionTimeOnSessionCards") ? (
              /* CDXC:Sidebar-overflow-menu 2026-05-04-03:54
                  Agent Icon/Last Active is a session-card display preference,
                  so it belongs in Settings instead of the quick overflow menu. */
              <ToggleField
                checked={draft.showLastInteractionTimeOnSessionCards}
                description="Use Last Active as the default trailing card detail instead of Agent Icon."
                label="Use Last Active instead of Agent Icon"
                {...getSettingModificationProps("showLastInteractionTimeOnSessionCards")}
                onChange={(checked) =>
                  updateDraft("showLastInteractionTimeOnSessionCards", checked)
                }
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.terminal) ? (
            <SettingsSection title="Terminal">
              {/* CDXC:TerminalSettings 2026-04-26-18:36: Terminal settings in
                  zmux edit the shared Ghostty config file, so users must see
                  that external Ghostty windows receive the same values and can
                  reload them with Ghostty's normal config shortcut. */}
              {shouldShowSetting(settingsSearch.terminal, "ghosttySettingsActions") ? (
                <>
                  <div className="rounded-lg border border-destructive/45 bg-destructive/10 px-4 py-3 text-sm leading-6 text-foreground">
                    Whatever you set here also applies to your external Ghostty terminal because this
                    Ghostty terminal uses the same settings file. zmux reloads its embedded Ghostty
                    terminal about 3 seconds after you stop changing these controls; external Ghostty
                    windows may still need Cmd+Shift+, to reload.
                  </div>
                  <GhosttySettingsActions
                    onApplyRecommended={applyRecommendedGhosttySettings}
                    onOpenConfigFile={() => onGhosttySettingsAction?.("openGhosttyConfigFile")}
                    onOpenDocs={() => onGhosttySettingsAction?.("openGhosttySettingsDocs")}
                    onResetDefaults={resetGhosttySettingsToDefault}
                  />
                </>
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "terminalGhosttyTheme") ? (
                <SelectField
                  contentClassName="max-h-80"
                  description="Choose a bundled Ghostty theme, or leave your existing Ghostty config in charge."
                  label="Theme"
                  {...getSettingModificationProps("terminalGhosttyTheme")}
                  onChange={(value) =>
                    updateDraft(
                      "terminalGhosttyTheme",
                      value === GHOSTTY_THEME_UNMANAGED_VALUE ? "" : value,
                    )
                  }
                  options={GHOSTTY_THEME_SETTING_OPTIONS}
                  showScrollButtons={false}
                  value={draft.terminalGhosttyTheme || GHOSTTY_THEME_UNMANAGED_VALUE}
                />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "terminalFontFamily") ? (
                <TextField
                  description="Type a Ghostty font-family name. Leave blank to use existing Ghostty config or Ghostty's platform default."
                  label="Font Family"
                  {...getSettingModificationProps("terminalFontFamily")}
                  onChange={(value) => updateDraft("terminalFontFamily", value)}
                  placeholder="Ghostty default"
                  value={draft.terminalFontFamily}
                />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "terminalFontSize") ? (
              <SliderNumberField
                description="Set terminal text size."
                label="Font Size"
                {...getSettingModificationProps("terminalFontSize")}
                max={32}
                min={8}
                onCommit={(value) => updateDraft("terminalFontSize", value)}
                onChange={(value) => updateDraftDebounced("terminalFontSize", value)}
                step={0.5}
                value={draft.terminalFontSize}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "terminalFontWeight") ? (
              <SliderNumberField
                description="Set terminal text weight."
                label="Font Weight"
                {...getSettingModificationProps("terminalFontWeight")}
                max={900}
                min={100}
                onCommit={(value) => updateDraft("terminalFontWeight", value)}
                onChange={(value) => updateDraftDebounced("terminalFontWeight", value)}
                step={50}
                value={draft.terminalFontWeight}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "terminalLineHeight") ? (
              <SliderNumberField
                description="Adjust terminal row height."
                label="Line Height"
                {...getSettingModificationProps("terminalLineHeight")}
                max={2}
                min={0.8}
                onCommit={(value) => updateDraft("terminalLineHeight", value)}
                onChange={(value) => updateDraftDebounced("terminalLineHeight", value)}
                step={0.1}
                value={draft.terminalLineHeight}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "terminalLetterSpacing") ? (
              <SliderNumberField
                description="Adjust spacing between glyphs."
                label="Letter Spacing"
                {...getSettingModificationProps("terminalLetterSpacing")}
                max={8}
                min={-2}
                onCommit={(value) => updateDraft("terminalLetterSpacing", value)}
                onChange={(value) => updateDraftDebounced("terminalLetterSpacing", value)}
                step={0.1}
                value={draft.terminalLetterSpacing}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "terminalCursorStyle") ? (
              <SelectField
                description="Choose the cursor shape."
                label="Cursor Style"
                {...getSettingModificationProps("terminalCursorStyle")}
                onChange={(value) =>
                  updateDraft("terminalCursorStyle", value as TerminalCursorStyle)
                }
                options={[
                  { label: "Line", value: "bar" },
                  { label: "Block", value: "block" },
                  { label: "Underline", value: "underline" },
                ]}
                value={draft.terminalCursorStyle}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "terminalCursorStyleBlink") ? (
              <ToggleField
                checked={draft.terminalCursorStyleBlink}
                description="Blink the terminal cursor."
                label="Cursor blink"
                {...getSettingModificationProps("terminalCursorStyleBlink")}
                onChange={(checked) => updateDraft("terminalCursorStyleBlink", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "sessionPersistenceProvider") ? (
              /* CDXC:SessionPersistence 2026-05-05-07:28
                  Session persistence is a provider choice for new terminal and
                  agent launches. Existing panes keep their current process;
                  new panes can use tmux, zmx, or zellij so restart restores by
                  attach first and recreate+resume only when the named session
                  is gone.

                 CDXC:SessionPersistence 2026-05-06-03:43
                  zellij shares the same Settings selector and semantics as
                  tmux/zmx instead of adding a separate mode-specific control.

                 CDXC:SessionPersistence 2026-05-08-14:04
                  Label the setting as beta and explain that users should
                  enable it only when they care about ssh from other devices
                  continuing sessions created through zmux. Recommend zmx with
                  zmx-session-manager because it leaves Agent CLI tools
                  unaffected while minor issues remain. */
              <SelectField
                description="Enable this feature only if you care about using ssh from other devices to continue working on sessions created using zmux. My favorite option is using zmx with zmx-session-manager because it doesn't affect the Agent CLI tools at all. Mostly working great, few minor issues left to fix."
                label="Session Persistence (Beta)"
                {...getSettingModificationProps("sessionPersistenceProvider")}
                onChange={(value) =>
                  updateDraft("sessionPersistenceProvider", value as SessionPersistenceProvider)
                }
                options={SESSION_PERSISTENCE_PROVIDER_OPTIONS}
                value={draft.sessionPersistenceProvider}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminal, "promptEditorBackend") ? (
              /**
               * CDXC:PromptEditorBackend 2026-05-11-14:38
               * Ctrl+G prompt editing can render either through the native
               * WebKit Monaco overlay or the existing zpet TUI floating
               * terminal. Keep the install action with the zpet option.
               */
              <ZapetPromptEditingField
                backend={draft.promptEditorBackend}
                isModified={getSettingModificationProps("promptEditorBackend").isModified}
                onInstall={() => onInstallZapet?.()}
                onChange={(backend) => updateDraft("promptEditorBackend", backend)}
                onResetToDefault={
                  getSettingModificationProps("promptEditorBackend").onResetToDefault
                }
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.terminalBehavior) ? (
            <SettingsSection title="Terminal Behavior">
              {/* CDXC:TerminalBehaviorSettings 2026-04-29-09:32: Expose the
                  Ghostty settings users commonly tune: scrollback memory,
                  copy-on-select, close confirmation, clipboard safety,
                  pointer hiding, and native scrollbar visibility. These
                  controls write documented Ghostty config keys instead of
                  intercepting terminal behavior inside zmux. */}
              {shouldShowSetting(settingsSearch.terminalBehavior, "terminalScrollbackLimitMb") ? (
              <SliderNumberField
                description="Scrollback memory per terminal surface. Ghostty default is 10 MB and changes affect new terminals."
                label="Scrollback limit"
                {...getSettingModificationProps("terminalScrollbackLimitMb")}
                max={200}
                min={1}
                onCommit={(value) => updateDraft("terminalScrollbackLimitMb", value)}
                onChange={(value) => updateDraftDebounced("terminalScrollbackLimitMb", value)}
                step={1}
                value={draft.terminalScrollbackLimitMb}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminalBehavior, "terminalCopyOnSelect") ? (
              <SelectField
                description="Copy selected terminal text automatically."
                label="Copy on select"
                {...getSettingModificationProps("terminalCopyOnSelect")}
                onChange={(value) =>
                  updateDraft("terminalCopyOnSelect", value as GhosttyCopyOnSelect)
                }
                options={GHOSTTY_COPY_ON_SELECT_OPTIONS}
                value={draft.terminalCopyOnSelect}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminalBehavior, "terminalConfirmCloseSurface") ? (
              <SelectField
                description="Confirm before closing terminal surfaces."
                label="Confirm close"
                {...getSettingModificationProps("terminalConfirmCloseSurface")}
                onChange={(value) =>
                  updateDraft("terminalConfirmCloseSurface", value as GhosttyConfirmCloseSurface)
                }
                options={GHOSTTY_CONFIRM_CLOSE_SURFACE_OPTIONS}
                value={draft.terminalConfirmCloseSurface}
              />
              ) : null}
              {shouldShowSetting(
                settingsSearch.terminalBehavior,
                "terminalClipboardTrimTrailingSpaces",
              ) ? (
              <ToggleField
                checked={draft.terminalClipboardTrimTrailingSpaces}
                description="Trim trailing whitespace when copying terminal text."
                label="Trim trailing spaces on copy"
                {...getSettingModificationProps("terminalClipboardTrimTrailingSpaces")}
                onChange={(checked) => updateDraft("terminalClipboardTrimTrailingSpaces", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminalBehavior, "terminalClipboardPasteProtection") ? (
              <ToggleField
                checked={draft.terminalClipboardPasteProtection}
                description="Ask before pasting text Ghostty considers unsafe."
                label="Paste protection"
                {...getSettingModificationProps("terminalClipboardPasteProtection")}
                onChange={(checked) => updateDraft("terminalClipboardPasteProtection", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminalBehavior, "terminalMouseHideWhileTyping") ? (
              <ToggleField
                checked={draft.terminalMouseHideWhileTyping}
                description="Hide the pointer while typing in the terminal."
                label="Hide mouse while typing"
                {...getSettingModificationProps("terminalMouseHideWhileTyping")}
                onChange={(checked) => updateDraft("terminalMouseHideWhileTyping", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminalBehavior, "terminalScrollbar") ? (
              <SelectField
                description="Control whether Ghostty shows its native scrollback scrollbar."
                label="Scrollbar"
                {...getSettingModificationProps("terminalScrollbar")}
                onChange={(value) => updateDraft("terminalScrollbar", value as GhosttyScrollbar)}
                options={GHOSTTY_SCROLLBAR_OPTIONS}
                value={draft.terminalScrollbar}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.terminalScrolling) ? (
            <SettingsSection title="Terminal Scrolling">
              {/* CDXC:TerminalScrollSettings 2026-04-29-08:56: Ghostty
                  scroll speed is controlled by mouse-scroll-multiplier.
                  Precision and discrete devices need separate controls because
                  Ghostty defaults trackpads to 1 and notched wheels to 3.
                  The modal exposes 0.25-step sliders from 0.25 to 8 because
                  Ghostty's documented 0.01..10000 bounds are extreme. */}
              {shouldShowSetting(settingsSearch.terminalScrolling, "terminalMouseScrollMultiplierPrecision") ? (
              <SliderNumberField
                description="Trackpads and high-resolution scroll wheels. Ghostty default is 1."
                label="Precision scroll multiplier"
                {...getSettingModificationProps("terminalMouseScrollMultiplierPrecision")}
                max={8}
                min={0.25}
                onCommit={(value) => updateDraft("terminalMouseScrollMultiplierPrecision", value)}
                onChange={(value) =>
                  updateDraftDebounced("terminalMouseScrollMultiplierPrecision", value)
                }
                step={0.25}
                value={draft.terminalMouseScrollMultiplierPrecision}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminalScrolling, "terminalMouseScrollMultiplierDiscrete") ? (
              <SliderNumberField
                description="Traditional notched mouse wheels. Ghostty default is 3."
                label="Discrete scroll multiplier"
                {...getSettingModificationProps("terminalMouseScrollMultiplierDiscrete")}
                max={8}
                min={0.25}
                onCommit={(value) => updateDraft("terminalMouseScrollMultiplierDiscrete", value)}
                onChange={(value) =>
                  updateDraftDebounced("terminalMouseScrollMultiplierDiscrete", value)
                }
                step={0.25}
                value={draft.terminalMouseScrollMultiplierDiscrete}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.terminalScrolling, "terminalScrollToBottomWhenTyping") ? (
              <ToggleField
                checked={draft.terminalScrollToBottomWhenTyping}
                description="Keep the prompt visible while typing."
                label="Scroll to bottom when typing"
                {...getSettingModificationProps("terminalScrollToBottomWhenTyping")}
                onChange={(checked) => updateDraft("terminalScrollToBottomWhenTyping", checked)}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.workspace) ? (
            <SettingsSection title="Workspace">
              {shouldShowSetting(settingsSearch.workspace, "workspacePaneGap") ? (
              <SliderNumberField
                description="Control spacing between panes."
                label="Pane Gap"
                {...getSettingModificationProps("workspacePaneGap")}
                max={48}
                min={0}
                onCommit={(value) => updateDraft("workspacePaneGap", value)}
                onChange={(value) => updateDraftDebounced("workspacePaneGap", value)}
                step={1}
                value={draft.workspacePaneGap}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.workspace, "workspaceActivePaneBorderColor") ? (
              <TextField
                description="CSS color for the focused pane border."
                label="Active Pane Border"
                {...getSettingModificationProps("workspaceActivePaneBorderColor")}
                onChange={(value) => updateDraft("workspaceActivePaneBorderColor", value)}
                value={draft.workspaceActivePaneBorderColor}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.workspace, "workspaceBackgroundColor") ? (
              <ColorField
                description="Color shown behind terminal panes."
                label="Terminal Background"
                {...getSettingModificationProps("workspaceBackgroundColor")}
                onChange={(value) => updateDraft("workspaceBackgroundColor", value)}
                value={draft.workspaceBackgroundColor}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.workspace, "debuggingMode") ? (
              <ToggleField
                checked={draft.debuggingMode}
                description="Expose debugging-only sidebar controls."
                label="Show debugging UI"
                {...getSettingModificationProps("debuggingMode")}
                onChange={(checked) => updateDraft("debuggingMode", checked)}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.browser) ? (
            <SettingsSection title="Browser">
              {/* CDXC:BrowserPanes 2026-05-02-06:35: Users can keep the
                  existing Chrome Canary native-window integration or route
                  browser actions into workspace browser panes that behave like
                  normal session cards inside sidebar groups. */}
              {shouldShowSetting(settingsSearch.browser, "browserOpenMode") ? (
              <SelectField
                description="Choose where browser actions open URLs."
                label="Open URLs With"
                {...getSettingModificationProps("browserOpenMode")}
                onChange={(value) => updateDraft("browserOpenMode", value as BrowserOpenMode)}
                options={BROWSER_OPEN_MODE_OPTIONS}
                value={draft.browserOpenMode}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.editor) ? (
            <SettingsSection title="Editor">
              {/* CDXC:EditorPanes 2026-05-06-15:00: Embedded code-server
                  panes pass --link-vscode-user-config by default so editor
                  sessions inherit local VS Code user settings. The Insiders
                  checkbox only changes the linked config directory. */}
              {shouldShowSetting(settingsSearch.editor, "codeServerLinkVscodeUserConfig") ? (
              <ToggleField
                checked={draft.codeServerLinkVscodeUserConfig}
                description="Use the VS Code settings from the local VS Code install."
                label="Use VS Code settings"
                onChange={(checked) => updateDraft("codeServerLinkVscodeUserConfig", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.editor, "codeServerUseVscodeInsidersUserConfig") ? (
              <ToggleField
                checked={draft.codeServerUseVscodeInsidersUserConfig}
                description="Use the VS Code Insiders user settings directory."
                disabled={!draft.codeServerLinkVscodeUserConfig}
                label="Use VS Code Insiders settings"
                onChange={(checked) =>
                  updateDraft("codeServerUseVscodeInsidersUserConfig", checked)
                }
              />
              ) : null}
              {shouldShowSetting(settingsSearch.editor, "showProjectEditorDiffFileCount") ? (
              <ToggleField
                checked={draft.showProjectEditorDiffFileCount}
                description="Show changed-file counts in project editor rows."
                label="Show editor file count"
                {...getSettingModificationProps("showProjectEditorDiffFileCount")}
                onChange={(checked) => updateDraft("showProjectEditorDiffFileCount", checked)}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.ideAttachment) ? (
            <SettingsSection title="IDE Attachment">
              {/* CDXC:AccessibilityPermissions 2026-05-08-13:08: Settings must
                  show the current macOS Accessibility status and provide a
                  one-click path to the matching System Settings pane without
                  presenting the permission dialog unless attachment is enabled. */}
              {shouldShowSetting(settingsSearch.ideAttachment, "accessibilityPermission") ? (
              <ActionButtonField
                description={getAccessibilityPermissionDescription(accessibilityPermissionGranted)}
                label="Accessibility Permission"
                onClick={() => onOpenAccessibilityPreferences?.()}
              >
                {getAccessibilityPermissionButtonLabel(accessibilityPermissionGranted)}
              </ActionButtonField>
              ) : null}
              {/* CDXC:IDEAttachment 2026-04-26-22:38: Settings select the IDE
                  that the workspace header link button attaches to. The
                  persisted keys remain zedOverlay* so existing installs keep
                  their saved attach state and target. */}
              {shouldShowSetting(settingsSearch.ideAttachment, "zedOverlayEnabled") ? (
              <ToggleField
                checked={draft.zedOverlayEnabled}
                description="Attach zmux as an overlay to the selected IDE."
                label="Attach zmux to IDE"
                {...getSettingModificationProps("zedOverlayEnabled")}
                onChange={(checked) => updateDraft("zedOverlayEnabled", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.ideAttachment, "zedOverlayHideTitlebarButton") ? (
              <ToggleField
                checked={draft.zedOverlayHideTitlebarButton}
                description="Hide the native Attach/Detach IDE button from the zmux title bar."
                label="Hide title-bar attach button"
                {...getSettingModificationProps("zedOverlayHideTitlebarButton")}
                onChange={(checked) => updateDraft("zedOverlayHideTitlebarButton", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.ideAttachment, "zedOverlayTargetApp") ? (
              <SelectField
                description="Select which IDE should receive the overlay."
                label="Target IDE"
                {...getSettingModificationProps("zedOverlayTargetApp")}
                onChange={(value) =>
                  updateDraft("zedOverlayTargetApp", value as ZedOverlayTargetApp)
                }
                options={ZED_OVERLAY_TARGET_APP_OPTIONS}
                value={draft.zedOverlayTargetApp}
              />
              ) : null}
              {/* CDXC:IDEAttachment 2026-05-06-12:49: Project sync is a
                  separate default-on setting from attachment. When enabled,
                  zmux opens the active project in the attached IDE after
                  workspace switches instead of waiting for a title-bar button
                  click. */}
              {shouldShowSetting(settingsSearch.ideAttachment, "syncOpenProjectWithZed") ? (
              <ToggleField
                checked={draft.syncOpenProjectWithZed}
                description="Open the active zmux project in the attached IDE after switching workspaces."
                label="Sync active project with IDE"
                {...getSettingModificationProps("syncOpenProjectWithZed")}
                onChange={(checked) => updateDraft("syncOpenProjectWithZed", checked)}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.sounds) ? (
            <SettingsSection title="Sounds">
              {shouldShowSetting(settingsSearch.sounds, "completionBellEnabled") ? (
              <ToggleField
                checked={draft.completionBellEnabled}
                description="Play a completion sound when work finishes."
                label="Enable completion bell"
                {...getSettingModificationProps("completionBellEnabled")}
                onChange={(checked) => updateDraft("completionBellEnabled", checked)}
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sounds, "completionSound") ? (
              <SoundField
                description="Sound for terminal completions."
                label="Completion Sound"
                {...getSettingModificationProps("completionSound")}
                onChange={(value) => updateDraft("completionSound", value)}
                onPlay={onPlayCompletionSound}
                value={draft.completionSound}
              />
              ) : null}
              {/* CDXC:SessionAttentionNotifications 2026-05-10-16:46:
                  Attention banners are separate from completion sounds because
                  users may want clickable macOS routing without audible alerts. */}
              {shouldShowSetting(settingsSearch.sounds, "showMacOSAttentionNotifications") ? (
              <ToggleField
                checked={draft.showMacOSAttentionNotifications}
                description="Show a macOS banner when a session needs attention."
                label="macOS Attention Notifications"
                {...getSettingModificationProps("showMacOSAttentionNotifications")}
                onChange={(checked) => {
                  updateDraft("showMacOSAttentionNotifications", checked);
                  if (checked) {
                    onRequestMacOSNotificationPermission?.();
                  }
                }}
              />
              ) : null}
              {/* CDXC:SessionAttentionNotifications 2026-05-11-01:14:
                  The Settings test button must run the real completion alert
                  path while the adjacent macOS button handles denied or muted
                  system notification permission outside zmux settings. */}
              {shouldShowSetting(settingsSearch.sounds, "attentionNotificationActions") ? (
              <ActionButtonPairField
                actions={[
                  {
                    label: "Test agent task completion",
                    onClick: () => onTestAgentTaskCompletion?.(),
                  },
                  {
                    label: "macOS Notification Settings",
                    onClick: () => onOpenMacOSNotificationSettings?.(),
                  },
                ]}
                description="Run the current completion sound and notification flow, or open macOS notification permissions."
                label="Completion Alerts"
              />
              ) : null}
              {shouldShowSetting(settingsSearch.sounds, "actionCompletionSound") ? (
              <SoundField
                description="Sound for action completions."
                label="Action Completion Sound"
                {...getSettingModificationProps("actionCompletionSound")}
                onChange={(value) => updateDraft("actionCompletionSound", value)}
                onPlay={onPlayCompletionSound}
                value={draft.actionCompletionSound}
              />
              ) : null}
            </SettingsSection>
            ) : null}

            {shouldShowSettingsSection(settingsSearch.storage) ? (
              <div ref={storageSectionRef}>
                <ZmuxFolderStatsSection
                  isLoading={zmuxFolderStatsLoading}
                  onOpenZmuxFolder={onOpenZmuxFolder}
                  stats={zmuxFolderStats}
                />
              </div>
            ) : null}

            {!hasVisibleSettings ? (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                No settings match your search.
              </div>
            ) : null}

            <Separator className="bg-border" />
            <div className="flex justify-between gap-3">
              <Button
                className="h-10 px-5 text-sm"
                onClick={resetSettings}
                type="button"
                variant="outline"
              >
                Reset to defaults
              </Button>
            </div>
          </div>
          </ScrollArea>
          </TabsContent>
          <TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="agents">
            <AgentsSettingsTab vscode={vscode} />
          </TabsContent>
          <TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="actions">
            <ActionsSettingsTab vscode={vscode} />
          </TabsContent>
          <TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="openTargets">
            <OpenTargetsSettingsTab
              onChange={(nextSettings) => applySettings(nextSettings)}
              settings={draft}
            />
          </TabsContent>
          <TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="hotkeys">
            <HotkeysSettingsTab
              hotkeys={draft.hotkeys}
              onChange={(hotkeys) => updateDraft("hotkeys", hotkeys)}
            />
          </TabsContent>
          </Tabs>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

type SettingsAgentEditorState = {
  draft: AgentConfigDraft;
};

type SettingsCommandEditorState = {
  draft: CommandConfigDraft;
  lockedActionType?: SidebarActionType;
};

type SettingsOpenTargetEditorState = {
  draft: {
    argsText: string;
    command: string;
    label: string;
  };
  id?: string;
};

type SettingsAgentDragData = {
  agentId: string;
  kind: "settings-agent";
};

type SettingsCommandDragData = {
  commandId: string;
  kind: "settings-command";
};

function OpenTargetsSettingsTab({
  onChange,
  settings,
}: {
  onChange: (settings: zmuxSettings) => void;
  settings: zmuxSettings;
}) {
  const [editorState, setEditorState] = useState<SettingsOpenTargetEditorState>();
  const hiddenIds = new Set(settings.workspaceOpenTargetHiddenIds);
  /**
   * CDXC:TitlebarOpenIn 2026-05-11-02:03
   * Settings shows installed built-ins as toggleable and unavailable built-ins
   * as disabled rows. Turning an installed target off writes only hidden ids,
   * so the startup scan can refresh availability without undoing that choice.
   */
  const availableBuiltInIds = new Set(settings.workspaceOpenTargetAvailability.availableTargetIds);

  const updateHiddenTarget = (targetId: string, isVisible: boolean) => {
    const nextHiddenIds = new Set(settings.workspaceOpenTargetHiddenIds);
    if (isVisible) {
      nextHiddenIds.delete(targetId);
    } else {
      nextHiddenIds.add(targetId);
    }
    onChange({
      ...settings,
      workspaceOpenTargetHiddenIds: normalizeWorkspaceOpenTargetHiddenIds([...nextHiddenIds]),
    });
  };

  const saveCustomTarget = () => {
    if (!editorState) {
      return;
    }
    const label = editorState.draft.label.trim();
    const command = editorState.draft.command.trim();
    if (!label || !command) {
      return;
    }
    const nextTarget: CustomWorkspaceOpenTarget = {
      args: editorState.draft.argsText
        .split("\n")
        .map((arg) => arg.trim())
        .filter(Boolean),
      command,
      id:
        editorState.id ??
        `${CUSTOM_WORKSPACE_OPEN_TARGET_ID_PREFIX}${createWorkspaceOpenTargetSlug(label)}-${Date.now().toString(36)}`,
      label,
    };
    const existingTargets = settings.customWorkspaceOpenTargets.filter(
      (target) => target.id !== editorState.id,
    );
    onChange({
      ...settings,
      customWorkspaceOpenTargets: normalizeCustomWorkspaceOpenTargets([
        ...existingTargets,
        nextTarget,
      ]),
    });
    setEditorState(undefined);
  };

  const removeCustomTarget = (targetId: string) => {
    onChange({
      ...settings,
      customWorkspaceOpenTargets: settings.customWorkspaceOpenTargets.filter(
        (target) => target.id !== targetId,
      ),
    });
  };

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex flex-col gap-6 px-5 pb-5">
        <SettingsSection title="Open In">
          {/* CDXC:TitlebarOpenIn 2026-05-11-00:22
              Users need a Settings tab opened from the titlebar dropdown to
              show or hide IDE targets and add custom project-open commands. */}
          <div className="flex flex-col gap-2">
            {BUILT_IN_WORKSPACE_OPEN_TARGETS.map((target) => {
              const isEmbeddedEditor = target.id === "embedded-editor";
              const isAvailable = isEmbeddedEditor || availableBuiltInIds.has(target.id);
              return (
                <div
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 px-3 py-2"
                  key={target.id}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{target.label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {isAvailable
                        ? target.commands?.join(", ") ?? (isEmbeddedEditor ? "zmux" : "macOS")
                        : "Not installed"}
                    </div>
                  </div>
                  <Switch
                    checked={isEmbeddedEditor || (isAvailable && !hiddenIds.has(target.id))}
                    disabled={isEmbeddedEditor || !isAvailable}
                    onCheckedChange={(checked) => updateHiddenTarget(target.id, checked)}
                  />
                </div>
              );
            })}
          </div>
        </SettingsSection>

        <SettingsSection title="Custom Open Targets">
          <div className="flex flex-col gap-2">
            {settings.customWorkspaceOpenTargets.map((target) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 px-3 py-2"
                key={target.id}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{target.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[target.command, ...target.args].join(" ")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    onClick={() =>
                      setEditorState({
                        draft: {
                          argsText: target.args.join("\n"),
                          command: target.command,
                          label: target.label,
                        },
                        id: target.id,
                      })
                    }
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <IconPencil aria-hidden="true" size={14} />
                    <span className="sr-only">Edit</span>
                  </Button>
                  <Button
                    onClick={() => removeCustomTarget(target.id)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <IconTrash aria-hidden="true" size={14} />
                    <span className="sr-only">Remove</span>
                  </Button>
                </div>
              </div>
            ))}
            {editorState ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/40 p-3">
                <Input
                  aria-label="Open target name"
                  onChange={(event) =>
                    setEditorState({
                      ...editorState,
                      draft: { ...editorState.draft, label: event.currentTarget.value },
                    })
                  }
                  placeholder="Name"
                  value={editorState.draft.label}
                />
                <Input
                  aria-label="Open target command"
                  onChange={(event) =>
                    setEditorState({
                      ...editorState,
                      draft: { ...editorState.draft, command: event.currentTarget.value },
                    })
                  }
                  placeholder="Command"
                  value={editorState.draft.command}
                />
                <Textarea
                  aria-label="Open target arguments"
                  onChange={(event) =>
                    setEditorState({
                      ...editorState,
                      draft: { ...editorState.draft, argsText: event.currentTarget.value },
                    })
                  }
                  placeholder="Optional arguments, one per line"
                  value={editorState.draft.argsText}
                />
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setEditorState(undefined)} type="button" variant="ghost">
                    Cancel
                  </Button>
                  <Button onClick={saveCustomTarget} type="button">
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                className="w-fit"
                onClick={() =>
                  setEditorState({ draft: { argsText: "", command: "", label: "" } })
                }
                type="button"
                variant="outline"
              >
                <IconPlus aria-hidden="true" size={16} />
                Add target
              </Button>
            )}
          </div>
        </SettingsSection>
      </div>
    </ScrollArea>
  );
}

function AgentsSettingsTab({ vscode }: { vscode?: WebviewApi }) {
  const agents = useSidebarStore((state) => state.hud.agents);
  const [editorState, setEditorState] = useState<SettingsAgentEditorState>();
  const [draftAgentIds, setDraftAgentIds] = useState<string[]>();

  useEffect(() => {
    setDraftAgentIds((previousDraft) => reconcileDraftIds(previousDraft, agents, "agentId"));
  }, [agents]);

  const orderedAgents = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.agentId, agent]));
    const orderedAgentIds = draftAgentIds
      ? mergeIds(
          draftAgentIds,
          agents.map((agent) => agent.agentId),
        )
      : agents.map((agent) => agent.agentId);

    return orderedAgentIds
      .map((agentId) => agentById.get(agentId))
      .filter((agent): agent is SidebarAgentButton => agent !== undefined);
  }, [agents, draftAgentIds]);

  const saveAgent = (draft: AgentConfigDraft) => {
    if (!vscode) {
      return;
    }
    vscode.postMessage({
      agentId: draft.agentId,
      command: draft.command,
      icon: draft.icon,
      name: draft.name,
      type: "saveSidebarAgent",
    });
    setEditorState(undefined);
  };

  const deleteAgent = (agent: SidebarAgentButton) => {
    vscode?.postMessage({
      agentId: agent.agentId,
      type: "deleteSidebarAgent",
    });
  };

  const handleDragEnd = ((event) => {
    if (event.canceled || !isSortableOperation(event.operation)) {
      return;
    }

    const { source, target } = event.operation;
    const sourceData = source ? getSettingsAgentDragData(source) : undefined;
    if (!source || !sourceData) {
      return;
    }

    const targetIndex =
      "index" in source && typeof source.index === "number" ? source.index : target?.index;
    if (targetIndex == null || source.initialIndex === targetIndex) {
      return;
    }

    const nextAgentIds = moveId(
      orderedAgents.map((agent) => agent.agentId),
      source.initialIndex,
      targetIndex,
    );
    setDraftAgentIds(nextAgentIds);
    vscode?.postMessage({
      agentIds: nextAgentIds,
      requestId: createSettingsReorderRequestId("agents"),
      type: "syncSidebarAgentOrder",
    });
  }) satisfies DragDropEventHandlers["onDragEnd"];

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex flex-col gap-6 px-5 pb-5">
        <SettingsSection
          actions={
            !editorState ? (
              <Button
                disabled={!vscode}
                onClick={() => setEditorState({ draft: { command: "", name: "" } })}
                type="button"
                variant="outline"
              >
                <IconPlus aria-hidden="true" data-icon="inline-start" />
                Add Agent
              </Button>
            ) : null
          }
          title={editorState ? "Agent" : "Agents"}
        >
          {editorState ? (
            <AgentSettingsEditor
              draft={editorState.draft}
              onCancel={() => setEditorState(undefined)}
              onSave={saveAgent}
            />
          ) : (
            <>
              {orderedAgents.length > 0 ? (
                <DragDropProvider onDragEnd={handleDragEnd}>
                  <div className="flex flex-col gap-2">
                    {orderedAgents.map((agent, index) => (
                      <SettingsAgentRow
                        agent={agent}
                        index={index}
                        key={agent.agentId}
                        onDelete={() => deleteAgent(agent)}
                        onEdit={() =>
                          setEditorState({
                            draft: {
                              agentId: agent.agentId,
                              command: agent.command ?? "",
                              icon: agent.icon,
                              name: agent.name,
                            },
                          })
                        }
                      />
                    ))}
                  </div>
                </DragDropProvider>
              ) : (
                <Empty className="border border-border bg-muted/20">
                  <EmptyHeader>
                    <EmptyTitle>No agents configured</EmptyTitle>
                    <EmptyDescription>Add an agent launcher to start new sessions.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </>
          )}
        </SettingsSection>
      </div>
    </ScrollArea>
  );
}

function SettingsAgentRow({
  agent,
  index,
  onDelete,
  onEdit,
}: {
  agent: SidebarAgentButton;
  index: number;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const sortable = useSortable({
    accept: "settings-agent",
    data: createSettingsAgentDragData(agent.agentId),
    group: "settings-agents",
    id: agent.agentId,
    index,
    type: "settings-agent",
  });

  const setRowRef = (element: HTMLDivElement | null) => {
    sortable.ref(element);
    sortable.sourceRef(element);
  };

  return (
    <div
      className="settings-management-row flex items-center gap-2 border border-border bg-muted/20 p-2"
      data-dragging={String(Boolean(sortable.isDragging))}
      ref={setRowRef}
    >
      <Button
        aria-label={`Reorder ${agent.name}`}
        ref={sortable.handleRef}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <IconGripVertical aria-hidden="true" />
      </Button>
      <Button
        className="settings-management-edit-button h-auto min-w-0 flex-1 justify-start gap-3 px-2 py-2 text-left"
        onClick={onEdit}
        type="button"
        variant="ghost"
      >
        <span
          aria-hidden="true"
          className="settings-management-icon flex size-9 shrink-0 items-center justify-center bg-muted"
        >
          <SettingsAgentIcon agent={agent} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{agent.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {agent.command?.trim() || "Not configured"}
          </span>
        </span>
      </Button>
      <Button aria-label={`Edit ${agent.name}`} onClick={onEdit} size="icon-sm" type="button" variant="ghost">
        <IconPencil aria-hidden="true" />
      </Button>
      <Button
        aria-label={`Delete ${agent.name}`}
        onClick={onDelete}
        size="icon-sm"
        type="button"
        variant="destructive"
      >
        <IconTrash aria-hidden="true" />
      </Button>
    </div>
  );
}

function AgentSettingsEditor({
  draft,
  onCancel,
  onSave,
}: {
  draft: AgentConfigDraft;
  onCancel: () => void;
  onSave: (draft: AgentConfigDraft) => void;
}) {
  const [command, setCommand] = useState(draft.command);
  const [icon, setIcon] = useState<SidebarAgentIcon | "custom">(draft.icon ?? "custom");
  const [name, setName] = useState(draft.name);
  const agentTypeId = useId();
  const commandId = useId();
  const nameId = useId();
  const isSaveDisabled = name.trim().length === 0 || command.trim().length === 0;

  const updateAgentType = (value: string) => {
    const nextType = value as SidebarAgentIcon | "custom";
    const previousDefaultAgent = getDefaultSidebarAgentByIcon(
      icon === "custom" ? undefined : icon,
    );
    const nextDefaultAgent = getDefaultSidebarAgentByIcon(
      nextType === "custom" ? undefined : nextType,
    );

    setIcon(nextType);
    if (!nextDefaultAgent) {
      return;
    }

    setName((previousName) =>
      previousName.trim().length === 0 || previousName === previousDefaultAgent?.name
        ? nextDefaultAgent.name
        : previousName,
    );
    setCommand((previousCommand) =>
      previousCommand.trim().length === 0 || previousCommand === previousDefaultAgent?.command
        ? nextDefaultAgent.command
        : previousCommand,
    );
  };

  return (
    <>
      <Field className="gap-2.5">
        <FieldContent>
          <FieldLabel className="text-sm" htmlFor={agentTypeId}>
            Agent type
          </FieldLabel>
        </FieldContent>
        <Select onValueChange={updateAgentType} value={icon}>
          <SelectTrigger className="h-10 w-full px-3 text-sm" id={agentTypeId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="custom">Custom</SelectItem>
              {DEFAULT_SIDEBAR_AGENTS.map((agent) => (
                <SelectItem key={agent.agentId} value={agent.icon}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field className="gap-2.5">
        <FieldContent>
          <FieldLabel className="text-sm" htmlFor={nameId}>
            Name
          </FieldLabel>
        </FieldContent>
        <Input
          autoFocus
          className="h-10 px-3 text-sm"
          id={nameId}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Codex"
          value={name}
        />
      </Field>
      <Field className="gap-2.5">
        <FieldContent>
          <FieldLabel className="text-sm" htmlFor={commandId}>
            Command
          </FieldLabel>
        </FieldContent>
        <Textarea
          id={commandId}
          onChange={(event) => setCommand(event.currentTarget.value)}
          placeholder="codex"
          rows={3}
          value={command}
        />
      </Field>
      <div className="flex justify-end gap-3">
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={isSaveDisabled}
          onClick={() =>
            onSave({
              agentId: draft.agentId,
              command: command.trim(),
              icon: icon === "custom" ? undefined : icon,
              name: name.trim(),
            })
          }
          type="button"
        >
          Save
        </Button>
      </div>
    </>
  );
}

function ActionsSettingsTab({ vscode }: { vscode?: WebviewApi }) {
  const commands = useSidebarStore((state) => state.hud.commands);
  const [editorState, setEditorState] = useState<SettingsCommandEditorState>();
  const [draftCommandIds, setDraftCommandIds] = useState<string[]>();

  useEffect(() => {
    setDraftCommandIds((previousDraft) => reconcileDraftIds(previousDraft, commands, "commandId"));
  }, [commands]);

  const orderedCommands = useMemo(() => {
    const commandById = new Map(commands.map((command) => [command.commandId, command]));
    const orderedCommandIds = draftCommandIds
      ? mergeIds(
          draftCommandIds,
          commands.map((command) => command.commandId),
        )
      : commands.map((command) => command.commandId);

    return orderedCommandIds
      .map((commandId) => commandById.get(commandId))
      .filter((command): command is SidebarCommandButton => command !== undefined);
  }, [commands, draftCommandIds]);

  const openCreateCommandEditor = (actionType: SidebarActionType) => {
    setEditorState({
      draft: createSettingsCommandDraft(actionType),
      lockedActionType: actionType,
    });
  };

  const saveCommand = (draft: CommandConfigDraft) => {
    if (!vscode) {
      return;
    }
    vscode.postMessage({
      actionType: draft.actionType,
      closeTerminalOnExit: draft.closeTerminalOnExit,
      command: draft.command,
      commandId: draft.commandId,
      icon: draft.icon,
      iconColor: draft.iconColor,
      isGlobal: draft.isGlobal,
      name: draft.name,
      playCompletionSound: draft.playCompletionSound,
      type: "saveSidebarCommand",
      url: draft.url,
    });
    setEditorState(undefined);
  };

  const deleteCommand = (draft: CommandConfigDraft) => {
    if (!draft.commandId) {
      setEditorState(undefined);
      return;
    }
    vscode?.postMessage({
      commandId: draft.commandId,
      type: "deleteSidebarCommand",
    });
    setEditorState(undefined);
  };

  const handleDragEnd = ((event) => {
    if (event.canceled || !isSortableOperation(event.operation)) {
      return;
    }

    const { source, target } = event.operation;
    const sourceData = source ? getSettingsCommandDragData(source) : undefined;
    if (!source || !sourceData) {
      return;
    }

    const targetIndex =
      "index" in source && typeof source.index === "number" ? source.index : target?.index;
    if (targetIndex == null || source.initialIndex === targetIndex) {
      return;
    }

    const nextCommandIds = moveId(
      orderedCommands.map((command) => command.commandId),
      source.initialIndex,
      targetIndex,
    );
    setDraftCommandIds(nextCommandIds);
    vscode?.postMessage({
      commandIds: nextCommandIds,
      requestId: createSettingsReorderRequestId("actions"),
      type: "syncSidebarCommandOrder",
    });
  }) satisfies DragDropEventHandlers["onDragEnd"];

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex flex-col gap-6 px-5 pb-5">
        <SettingsSection
          actions={
            !editorState ? (
              <>
                <Button
                  disabled={!vscode}
                  onClick={() => openCreateCommandEditor("terminal")}
                  type="button"
                  variant="outline"
                >
                  <IconPlus aria-hidden="true" data-icon="inline-start" />
                  Terminal Action
                </Button>
                <Button
                  disabled={!vscode}
                  onClick={() => openCreateCommandEditor("browser")}
                  type="button"
                  variant="outline"
                >
                  <IconPlus aria-hidden="true" data-icon="inline-start" />
                  Browser Action
                </Button>
              </>
            ) : null
          }
          title={editorState ? "Action" : "Actions"}
        >
          {editorState ? (
            <ActionSettingsEditor
              draft={editorState.draft}
              lockedActionType={editorState.lockedActionType}
              onCancel={() => setEditorState(undefined)}
              onDelete={deleteCommand}
              onSave={saveCommand}
            />
          ) : (
            <>
              {orderedCommands.length > 0 ? (
                <DragDropProvider onDragEnd={handleDragEnd}>
                  <div className="flex flex-col gap-2">
                    {orderedCommands.map((command, index) => (
                      <SettingsCommandRow
                        command={command}
                        index={index}
                        key={command.commandId}
                        onEdit={() =>
                          setEditorState({
                            draft: createSettingsCommandDraftFromButton(command),
                          })
                        }
                      />
                    ))}
                  </div>
                </DragDropProvider>
              ) : (
                <Empty className="border border-border bg-muted/20">
                  <EmptyHeader>
                    <EmptyTitle>No actions configured</EmptyTitle>
                    <EmptyDescription>Add a terminal or browser action.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </>
          )}
        </SettingsSection>
      </div>
    </ScrollArea>
  );
}

function SettingsCommandRow({
  command,
  index,
  onEdit,
}: {
  command: SidebarCommandButton;
  index: number;
  onEdit: () => void;
}) {
  const sortable = useSortable({
    accept: "settings-command",
    data: createSettingsCommandDragData(command.commandId),
    group: "settings-commands",
    id: command.commandId,
    index,
    type: "settings-command",
  });

  const setRowRef = (element: HTMLDivElement | null) => {
    sortable.ref(element);
    sortable.sourceRef(element);
  };

  return (
    <div
      className="settings-management-row flex items-center gap-2 border border-border bg-muted/20 p-2"
      data-dragging={String(Boolean(sortable.isDragging))}
      ref={setRowRef}
    >
      <Button
        aria-label={`Reorder ${getActionTitle(command)}`}
        ref={sortable.handleRef}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <IconGripVertical aria-hidden="true" />
      </Button>
      <Button
        className="settings-management-edit-button h-auto min-w-0 flex-1 justify-start gap-3 px-2 py-2 text-left"
        onClick={onEdit}
        type="button"
        variant="ghost"
      >
        <span
          aria-hidden="true"
          className="settings-management-icon flex size-9 shrink-0 items-center justify-center bg-muted"
        >
          <SettingsActionIcon command={command} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {getActionTitle(command)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {getActionMeta(command)}
          </span>
        </span>
      </Button>
      <Button aria-label={`Edit ${getActionTitle(command)}`} onClick={onEdit} size="icon-sm" type="button" variant="ghost">
        <IconPencil aria-hidden="true" />
      </Button>
    </div>
  );
}

function ActionSettingsEditor({
  draft,
  lockedActionType,
  onCancel,
  onDelete,
  onSave,
}: {
  draft: CommandConfigDraft;
  lockedActionType?: SidebarActionType;
  onCancel: () => void;
  onDelete: (draft: CommandConfigDraft) => void;
  onSave: (draft: CommandConfigDraft) => void;
}) {
  const [actionType, setActionType] = useState<SidebarActionType>(draft.actionType);
  const [closeTerminalOnExit, setCloseTerminalOnExit] = useState(draft.closeTerminalOnExit);
  const [command, setCommand] = useState(draft.command ?? "");
  const [icon, setIcon] = useState<SidebarCommandIcon | undefined>(draft.icon);
  const [iconColor, setIconColor] = useState(draft.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR);
  const [iconColorText, setIconColorText] = useState(
    draft.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
  );
  const [isGlobal, setIsGlobal] = useState(draft.isGlobal === true);
  const [name, setName] = useState(draft.name);
  const [playCompletionSound, setPlayCompletionSound] = useState(draft.playCompletionSound);
  const [url, setUrl] = useState(
    draft.url ??
      ((lockedActionType ?? draft.actionType) === "browser" ? DEFAULT_BROWSER_ACTION_URL : ""),
  );
  const actionTypeId = useId();
  const closeTerminalOnExitId = useId();
  const commandId = useId();
  const globalId = useId();
  const iconColorId = useId();
  const iconColorTextId = useId();
  const iconId = useId();
  const nameId = useId();
  const soundId = useId();
  const urlId = useId();
  const isActionTypeLocked = lockedActionType !== undefined;
  const targetValue = actionType === "browser" ? url.trim() : command.trim();
  const trimmedName = name.trim();
  const isSaveDisabled =
    targetValue.length === 0 || (trimmedName.length === 0 && icon === undefined);

  const commitIconColorText = () => {
    const normalizedColor = normalizeSidebarCommandIconColor(iconColorText);
    if (!normalizedColor) {
      setIconColorText(iconColor);
      return;
    }
    setIconColor(normalizedColor);
    setIconColorText(normalizedColor);
  };

  const getDraft = (): CommandConfigDraft => ({
    actionType,
    closeTerminalOnExit: actionType === "terminal" ? closeTerminalOnExit : false,
    command: actionType === "terminal" ? command.trim() : undefined,
    commandId: draft.commandId,
    icon,
    iconColor: icon ? iconColor : undefined,
    isGlobal,
    name: trimmedName,
    playCompletionSound: actionType === "terminal" ? playCompletionSound : false,
    url: actionType === "browser" ? url.trim() : undefined,
  });

  return (
    <>
      {isActionTypeLocked ? null : (
        <Field className="gap-2.5">
          <FieldContent>
            <FieldLabel className="text-sm" htmlFor={actionTypeId}>
              Type
            </FieldLabel>
          </FieldContent>
          <Select
            onValueChange={(value) => {
              const nextActionType = value === "browser" ? "browser" : "terminal";
              setActionType(nextActionType);
              if (nextActionType === "browser" && url.trim().length === 0) {
                setUrl(DEFAULT_BROWSER_ACTION_URL);
              }
            }}
            value={actionType}
          >
            <SelectTrigger className="h-10 w-full px-3 text-sm" id={actionTypeId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="terminal">Terminal</SelectItem>
                <SelectItem value="browser">Browser</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field className="gap-2.5">
        <FieldContent>
          <FieldLabel className="text-sm" htmlFor={nameId}>
            Text
          </FieldLabel>
        </FieldContent>
        <Input
          autoFocus
          className="h-10 px-3 text-sm"
          id={nameId}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder={actionType === "browser" ? "Docs" : "Dev"}
          value={name}
        />
      </Field>
      <Field className="gap-2.5">
        <FieldContent>
          <FieldLabel className="text-sm" htmlFor={iconId}>
            Icon
          </FieldLabel>
        </FieldContent>
        <Select
          onValueChange={(value) => {
            setIcon(value === "__none__" ? undefined : (value as SidebarCommandIcon));
            if (value !== "__none__" && !normalizeSidebarCommandIconColor(iconColorText)) {
              setIconColor(DEFAULT_SIDEBAR_COMMAND_ICON_COLOR);
              setIconColorText(DEFAULT_SIDEBAR_COMMAND_ICON_COLOR);
            }
          }}
          value={icon ?? "__none__"}
        >
          <SelectTrigger className="h-10 w-full px-3 text-sm" id={iconId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72" showScrollButtons={false}>
            <SelectGroup>
              <SelectItem value="__none__">No icon</SelectItem>
              {SIDEBAR_COMMAND_ICON_OPTIONS.map((option) => (
                <SelectItem key={option.icon} value={option.icon}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field className="gap-2.5" data-disabled={icon === undefined}>
        <FieldContent>
          <FieldLabel className="text-sm" htmlFor={iconColorTextId}>
            Icon Color
          </FieldLabel>
        </FieldContent>
        <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3">
          <Input
            aria-label="Icon color picker"
            className="h-10 cursor-pointer rounded-xl p-1"
            disabled={icon === undefined}
            id={iconColorId}
            onChange={(event) => {
              setIconColor(event.currentTarget.value);
              setIconColorText(event.currentTarget.value);
            }}
            type="color"
            value={iconColor}
          />
          <Input
            disabled={icon === undefined}
            id={iconColorTextId}
            className="h-10 px-3 text-sm"
            onBlur={commitIconColorText}
            onChange={(event) => setIconColorText(event.currentTarget.value)}
            placeholder={DEFAULT_SIDEBAR_COMMAND_ICON_COLOR}
            value={iconColorText}
          />
        </div>
      </Field>
      {actionType === "browser" ? (
        <Field className="gap-2.5">
          <FieldContent>
            <FieldLabel className="text-sm" htmlFor={urlId}>
              URL
            </FieldLabel>
          </FieldContent>
          <Textarea
            id={urlId}
            onChange={(event) => setUrl(event.currentTarget.value)}
            placeholder={DEFAULT_BROWSER_ACTION_URL}
            rows={3}
            value={url}
          />
        </Field>
      ) : (
        <>
          <Field className="gap-2.5">
            <FieldContent>
              <FieldLabel className="text-sm" htmlFor={commandId}>
                Command
              </FieldLabel>
            </FieldContent>
            <Textarea
              id={commandId}
              onChange={(event) => setCommand(event.currentTarget.value)}
              placeholder="vp dev"
              rows={3}
              value={command}
            />
          </Field>
          <Field className="items-center justify-between" orientation="horizontal">
            <FieldContent>
              <FieldLabel className="text-sm" htmlFor={closeTerminalOnExitId}>
                Close terminal after the command finishes
              </FieldLabel>
            </FieldContent>
            <Switch
              checked={closeTerminalOnExit}
              id={closeTerminalOnExitId}
              onCheckedChange={setCloseTerminalOnExit}
            />
          </Field>
          <Field className="items-center justify-between" orientation="horizontal">
            <FieldContent>
              <FieldLabel className="text-sm" htmlFor={soundId}>
                Play completion sound
              </FieldLabel>
            </FieldContent>
            <Switch
              checked={playCompletionSound}
              id={soundId}
              onCheckedChange={setPlayCompletionSound}
            />
          </Field>
        </>
      )}
      <Field className="items-center justify-between" orientation="horizontal">
        <FieldContent>
          <FieldLabel className="text-sm" htmlFor={globalId}>
            Show this action in every zmux project
          </FieldLabel>
        </FieldContent>
        <Switch checked={isGlobal} id={globalId} onCheckedChange={setIsGlobal} />
      </Field>
      <div className="flex justify-end gap-3">
        {draft.commandId ? (
          <Button className="mr-auto" onClick={() => onDelete(getDraft())} type="button" variant="destructive">
            <IconTrash aria-hidden="true" data-icon="inline-start" />
            Delete
          </Button>
        ) : null}
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={isSaveDisabled} onClick={() => onSave(getDraft())} type="button">
          Save
        </Button>
      </div>
    </>
  );
}

function HotkeysSettingsTab({
  hotkeys,
  onChange,
}: {
  hotkeys?: zmuxHotkeySettings;
  onChange: (hotkeys: zmuxHotkeySettings) => void;
}) {
  const normalizedHotkeys = normalizezmuxHotkeySettings(hotkeys);
  const duplicateIds = useMemo(
    () => getDuplicateHotkeyIds(normalizedHotkeys),
    [normalizedHotkeys],
  );

  const updateHotkey = (id: zmuxHotkeyActionId, value: string) => {
    onChange(
      normalizezmuxHotkeySettings({
        ...normalizedHotkeys,
        [id]: normalizeHotkeyText(value),
      }),
    );
  };

  const resetHotkeys = () => {
    onChange(normalizezmuxHotkeySettings(DEFAULT_zmux_HOTKEYS));
  };

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="flex flex-col gap-6 px-5 pb-5">
        <SettingsSection title="Hotkeys">
          {ZMUX_HOTKEY_DEFINITIONS.map((definition) => {
            const value = normalizedHotkeys[definition.id] ?? definition.defaultKey;
            const isDuplicate = duplicateIds.has(definition.id);
            return (
              <Field className="gap-2.5" data-invalid={isDuplicate} key={definition.id}>
                <FieldContent>
                  <FieldLabel className="text-sm" htmlFor={`hotkey-${definition.id}`}>
                    {definition.title}
                  </FieldLabel>
                  <FieldDescription className="text-sm">{definition.description}</FieldDescription>
                </FieldContent>
                <HotkeyRecorderField
                  ariaInvalid={isDuplicate}
                  id={`hotkey-${definition.id}`}
                  hotkey={value}
                  onChange={(nextHotkey) => updateHotkey(definition.id, nextHotkey)}
                />
              </Field>
            );
          })}
          <div className="flex justify-end">
            <Button onClick={resetHotkeys} type="button" variant="outline">
              Reset Hotkeys
            </Button>
          </div>
        </SettingsSection>
      </div>
    </ScrollArea>
  );
}

function SettingsAgentIcon({ agent }: { agent: SidebarAgentButton }) {
  if (agent.icon) {
    return (
      <span
        aria-hidden="true"
        className="configure-agents-list-agent-icon"
        style={{
          backgroundColor: AGENT_LOGO_COLORS[agent.icon],
          maskImage: `url("${AGENT_LOGOS[agent.icon]}")`,
          WebkitMaskImage: `url("${AGENT_LOGOS[agent.icon]}")`,
        }}
      />
    );
  }

  return <IconCodeDots aria-hidden="true" />;
}

function SettingsActionIcon({ command }: { command: SidebarCommandButton }) {
  if (command.icon) {
    return (
      <SidebarCommandIconGlyph
        color={command.iconColor}
        icon={command.icon}
        stroke={1.8}
      />
    );
  }

  return command.actionType === "browser" ? (
    <IconWorld aria-hidden="true" />
  ) : (
    <IconTerminal2 aria-hidden="true" />
  );
}

function getActionTitle(command: SidebarCommandButton): string {
  const name = command.name.trim();
  if (name.length > 0) {
    return name;
  }

  const target = getActionTarget(command);
  return target ?? "Untitled Action";
}

function getActionMeta(command: SidebarCommandButton): string {
  const target = getActionTarget(command);
  const typeLabel = command.actionType === "browser" ? "Browser" : "Terminal";
  if (!target) {
    return `${typeLabel} - Not configured`;
  }

  return `${typeLabel} - ${target}`;
}

function getActionTarget(command: SidebarCommandButton): string | undefined {
  const target = command.actionType === "browser" ? command.url?.trim() : command.command?.trim();
  if (!target) {
    return undefined;
  }

  return target.split("\n")[0] || undefined;
}

function createSettingsCommandDraft(actionType: SidebarActionType): CommandConfigDraft {
  return {
    actionType,
    closeTerminalOnExit: false,
    command: actionType === "terminal" ? "" : undefined,
    commandId: undefined,
    icon: undefined,
    iconColor: undefined,
    isGlobal: false,
    name: "",
    playCompletionSound: actionType === "terminal",
    url: actionType === "browser" ? DEFAULT_BROWSER_ACTION_URL : undefined,
  };
}

function createSettingsCommandDraftFromButton(command: SidebarCommandButton): CommandConfigDraft {
  return {
    actionType: command.actionType,
    closeTerminalOnExit: command.closeTerminalOnExit,
    command: command.command,
    commandId: command.commandId,
    icon: command.icon,
    iconColor: command.iconColor,
    isGlobal: command.isGlobal === true,
    name: command.name,
    playCompletionSound: command.playCompletionSound,
    url: command.url,
  };
}

function getDuplicateHotkeyIds(hotkeys: zmuxHotkeySettings): Set<zmuxHotkeyActionId> {
  const idsByHotkey = new Map<string, zmuxHotkeyActionId[]>();
  for (const definition of ZMUX_HOTKEY_DEFINITIONS) {
    const hotkey = normalizeHotkeyText(hotkeys[definition.id] ?? definition.defaultKey);
    if (!hotkey) {
      continue;
    }
    idsByHotkey.set(hotkey, [...(idsByHotkey.get(hotkey) ?? []), definition.id]);
  }

  return new Set(
    Array.from(idsByHotkey.values())
      .filter((ids) => ids.length > 1)
      .flat(),
  );
}

function createSettingsAgentDragData(agentId: string): SettingsAgentDragData {
  return {
    agentId,
    kind: "settings-agent",
  };
}

function getSettingsAgentDragData(candidate: unknown): SettingsAgentDragData | undefined {
  if (!hasData(candidate)) {
    return undefined;
  }

  const data = candidate.data;
  if (!isObjectRecord(data) || data.kind !== "settings-agent" || typeof data.agentId !== "string") {
    return undefined;
  }

  return {
    agentId: data.agentId,
    kind: "settings-agent",
  };
}

function createSettingsCommandDragData(commandId: string): SettingsCommandDragData {
  return {
    commandId,
    kind: "settings-command",
  };
}

function getSettingsCommandDragData(candidate: unknown): SettingsCommandDragData | undefined {
  if (!hasData(candidate)) {
    return undefined;
  }

  const data = candidate.data;
  if (
    !isObjectRecord(data) ||
    data.kind !== "settings-command" ||
    typeof data.commandId !== "string"
  ) {
    return undefined;
  }

  return {
    commandId: data.commandId,
    kind: "settings-command",
  };
}

function moveId(ids: readonly string[], initialIndex: number, index: number): string[] {
  const nextIds = [...ids];
  const [id] = nextIds.splice(initialIndex, 1);
  if (id === undefined) {
    return nextIds;
  }

  nextIds.splice(index, 0, id);
  return nextIds;
}

function mergeIds(draftIds: readonly string[], syncedIds: readonly string[]): string[] {
  const syncedIdSet = new Set(syncedIds);
  const mergedIds = draftIds.filter((id) => syncedIdSet.has(id));

  for (const id of syncedIds) {
    if (!mergedIds.includes(id)) {
      mergedIds.push(id);
    }
  }

  return mergedIds;
}

function reconcileDraftIds<Item extends Record<Key, string>, Key extends keyof Item>(
  draftIds: readonly string[] | undefined,
  items: readonly Item[],
  key: Key,
): string[] | undefined {
  if (!draftIds) {
    return undefined;
  }

  const syncedIds = items.map((item) => item[key]);
  const nextDraftIds = mergeIds(draftIds, syncedIds);
  return haveSameOrder(nextDraftIds, syncedIds) ? undefined : nextDraftIds;
}

function haveSameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function createSettingsReorderRequestId(kind: "actions" | "agents"): string {
  return `settings-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function hasData(candidate: unknown): candidate is { data?: unknown } {
  return isObjectRecord(candidate) && "data" in candidate;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ZmuxFolderStatsSection({
  isLoading,
  onOpenZmuxFolder,
  stats,
}: {
  isLoading: boolean;
  onOpenZmuxFolder?: () => void;
  stats?: SidebarZmuxFolderStatsMessage;
}) {
  const folders = stats?.folders ?? [];
  return (
    <SettingsSection title="Storage">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">zmux folder</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {stats?.folderPath ?? "~/.zmux"}
          </div>
        </div>
        <Button
          className="h-9 shrink-0 gap-2 px-3 text-sm"
          disabled={!onOpenZmuxFolder}
          onClick={onOpenZmuxFolder}
          type="button"
          variant="outline"
        >
          <IconFolderOpen aria-hidden="true" className="size-4" />
          Open Folder
        </Button>
      </div>

      {isLoading && !stats ? (
        <div className="rounded-md border border-border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
          Loading folder sizes...
        </div>
      ) : null}

      {stats?.errorMessage ? (
        <div className="rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {stats.errorMessage}
        </div>
      ) : null}

      {stats && !stats.errorMessage ? (
        <div className="rounded-md border border-border bg-muted/20">
          {folders.length > 0 ? (
            folders.map((folder) => (
              <div
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0"
                key={folder.path}
              >
                <span className="min-w-0 truncate text-foreground">{folder.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatBytes(folder.sizeBytes)}
                </span>
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">No folders found.</div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatBytes(stats.totalBytes)}</span>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex] ?? "B"}`;
}

function GhosttySettingsActions({
  onApplyRecommended,
  onOpenConfigFile,
  onOpenDocs,
  onResetDefaults,
}: {
  onApplyRecommended: () => void;
  onOpenConfigFile: () => void;
  onOpenDocs: () => void;
  onResetDefaults: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Button className="h-10 px-4 text-sm" onClick={onResetDefaults} type="button" variant="outline">
        Reset Ghostty defaults
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="h-10 px-4 text-sm"
            onClick={onApplyRecommended}
            type="button"
            variant="outline"
          >
            Apply recommended
          </Button>
        </TooltipTrigger>
        <TooltipContent className="whitespace-pre-line text-left" sideOffset={6}>
          {ZMUX_RECOMMENDED_GHOSTTY_CONFIG_LINES.join("\n")}
        </TooltipContent>
      </Tooltip>
      <Button className="h-10 px-4 text-sm" onClick={onOpenDocs} type="button" variant="outline">
        Open Ghostty docs
      </Button>
      <Button
        className="h-10 px-4 text-sm"
        onClick={onOpenConfigFile}
        type="button"
        variant="outline"
      >
        Open Ghostty config
      </Button>
    </div>
  );
}

function ZapetPromptEditingField({
  backend,
  isModified,
  onChange,
  onInstall,
  onResetToDefault,
}: {
  backend: PromptEditorBackend;
  isModified?: boolean;
  onChange: (backend: PromptEditorBackend) => void;
  onInstall: () => void;
  onResetToDefault?: () => void;
}) {
  const id = useId();
  return (
    <SettingRow
      description="Choose which floating editor new terminals use when Ctrl+G asks the shell to edit prompt text."
      htmlFor={id}
      isModified={isModified}
      label="Ctrl+G prompt editor"
      onResetToDefault={onResetToDefault}
    >
      <div className="flex flex-col items-start gap-3">
        <Select onValueChange={(value) => onChange(value as PromptEditorBackend)} value={backend}>
          <SelectTrigger className="h-10 w-full px-3 text-sm" id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PROMPT_EDITOR_BACKEND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          className="h-9 w-fit px-3 text-sm"
          onClick={onInstall}
          type="button"
          variant="outline"
        >
          Install Zapet
        </Button>
      </div>
    </SettingRow>
  );
}

/**
 * CDXC:Settings 2026-04-26-21:27: The settings modal previews the same theme
 * as the sidebar. The modal updates immediately when the Theme select changes,
 * without waiting for the native host to echo a new HUD snapshot.
 */
function getSidebarThemeVariant(theme: SidebarTheme): SidebarThemeVariant {
  return theme.startsWith("light-") || theme === "plain-light" ? "light" : "dark";
}

function getSettingsSectionSearch(
  query: string,
  sectionTitle: string,
  settings: ReadonlyArray<SettingSearchDefinition>,
): SettingsSectionSearchResult {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      isSearching: false,
      sectionMatches: true,
      visibleSettingKeys: new Set(settings.map((setting) => setting.key)),
    };
  }

  const searchItems = [
    {
      id: "__section",
      options: [],
      subtitle: "",
      title: sectionTitle,
    },
    ...settings.map((setting) => ({
      id: setting.key,
      options: setting.options?.flatMap((option) => [option.label, option.value]) ?? [],
      subtitle: setting.subtitle ?? "",
      title: setting.title,
    })),
  ];
  const fuse = new Fuse(searchItems, {
    ignoreLocation: true,
    includeScore: true,
    keys: [
      { name: "title", weight: 0.55 },
      { name: "subtitle", weight: 0.25 },
      { name: "options", weight: 0.2 },
    ],
    threshold: 0.38,
  });
  const results = fuse.search(trimmedQuery);
  const sectionMatches = results.some((result) => result.item.id === "__section");
  return {
    isSearching: true,
    sectionMatches,
    visibleSettingKeys: new Set(
      results
        .map((result) => result.item.id)
        .filter((settingKey) => settingKey !== "__section"),
    ),
  };
}

function hasVisibleSettingsSearchResult(result: SettingsSectionSearchResult): boolean {
  return result.sectionMatches || result.visibleSettingKeys.size > 0;
}

function shouldShowSettingsSection(result: SettingsSectionSearchResult): boolean {
  return hasVisibleSettingsSearchResult(result);
}

function shouldShowSetting(result: SettingsSectionSearchResult, settingKey: string): boolean {
  return !result.isSearching || result.sectionMatches || result.visibleSettingKeys.has(settingKey);
}

function SettingsSection({
  actions,
  children,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <Card
      className={cn("relative mt-5 overflow-visible pt-8", actions && "settings-section-with-actions")}
      size="sm"
    >
      {/* CDXC:Settings 2026-04-26-12:31: The target settings examples stack the
          text above controls. Keeping rows vertical avoids squeezing labels in
          the narrow zmux sidebar modal. */}
      {/* CDXC:Settings 2026-04-26-21:00: Settings sections need extra space
          above each header, while adjacent settings should separate by rhythm
          instead of divider lines. */}
      {/* CDXC:Settings 2026-04-26-21:03: Each settings category is a distinct
          shadcn card. The heading is larger and sits over the top border so
          the card reads as a labeled group without reintroducing row dividers. */}
      {/* CDXC:Settings 2026-04-26-21:22: Section card labels must stay on one
          line and clear the card contents, including multi-word headings like
          Session Cards. */}
      {/* CDXC:Settings 2026-04-27-01:01: The title pill cannot use shadcn
          CardHeader because its container-query size containment makes
          max-content resolve to the padding width instead of the text width. */}
      <div className="settings-section-title-pill">
        <CardTitle className="settings-section-title-pill-text">{title}</CardTitle>
      </div>
      {/* CDXC:UnifiedSettings 2026-05-09-17:01: Agents and Actions management
          controls belong in the section header row. Action creation labels omit
          "Add", while the agent creation CTA keeps "Add Agent" per product
          requirements. */}
      {actions ? <div className="settings-section-header-actions">{actions}</div> : null}
      <CardContent className="pt-2">
        <FieldGroup className="gap-6">{children}</FieldGroup>
      </CardContent>
    </Card>
  );
}

function SliderNumberField({
  description,
  isModified,
  label,
  max,
  min,
  onChange,
  onCommit,
  onResetToDefault,
  step,
  value,
}: {
  description?: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  step: number;
  value: number;
} & SettingModificationProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputText, setInputText] = useState(() => formatSliderNumber(value, step));
  const valueText = formatSliderNumber(value, step);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setInputText(valueText);
    }
  }, [valueText]);

  const updateValue = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) {
      return value;
    }
    const clampedValue = clampNumber(snapNumberToStep(nextValue, min, step), min, max);
    onChange(clampedValue);
    return clampedValue;
  };

  const commitValue = (nextValue: number) => {
    const clampedValue = Number.isFinite(nextValue)
      ? clampNumber(snapNumberToStep(nextValue, min, step), min, max)
      : value;
    setInputText(formatSliderNumber(clampedValue, step));
    onCommit(clampedValue);
  };

  const updateInputText = (nextText: string) => {
    setInputText(nextText);
    const nextValue = Number(nextText);
    if (
      nextText.trim() === "" ||
      !Number.isFinite(nextValue) ||
      nextValue < min ||
      nextValue > max
    ) {
      return;
    }
    onChange(clampNumber(snapNumberToStep(nextValue, min, step), min, max));
  };

  return (
    <SettingRow
      description={description}
      htmlFor={id}
      isModified={isModified}
      label={label}
      onResetToDefault={onResetToDefault}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-3">
        <Slider
          aria-label={label}
          max={max}
          min={min}
          onValueCommit={([nextValue]) => commitValue(nextValue ?? value)}
          onValueChange={([nextValue]) => updateValue(nextValue ?? value)}
          step={step}
          value={[value]}
        />
        <Input
          id={id}
          className="h-10 px-3 text-sm tabular-nums"
          onBlur={(event) => commitValue(Number(event.currentTarget.value))}
          onChange={(event) => updateInputText(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          max={max}
          min={min}
          ref={inputRef}
          step={step}
          type="number"
          value={inputText}
        />
      </div>
    </SettingRow>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapNumberToStep(value: number, min: number, step: number): number {
  /**
   * CDXC:Settings 2026-04-29-08:56
   * Slider-backed numeric settings must persist the same step increments the
   * UI presents. This keeps Ghostty scroll multipliers on 0.25 increments even
   * when users type values into the adjacent number field.
   */
  const decimals = Math.max(0, step.toString().split(".")[1]?.length ?? 0);
  const scaledValue = Math.round((value - min) / step) * step + min;
  return Number(scaledValue.toFixed(decimals));
}

function formatSliderNumber(value: number, step: number): string {
  if (Number.isInteger(step)) {
    return String(Math.round(value));
  }
  const decimals = Math.max(0, step.toString().split(".")[1]?.length ?? 0);
  return value.toFixed(decimals);
}

function getAccessibilityPermissionDescription(granted: boolean | undefined): string {
  if (granted === true) {
    return "Allowed in macOS. IDE attachment can read and follow the selected IDE window.";
  }
  if (granted === false) {
    return "Not allowed in macOS. Open Accessibility settings to add zmux.";
  }
  return "Status is unavailable in this environment. Open macOS Accessibility settings if attachment cannot follow the IDE.";
}

function getAccessibilityPermissionButtonLabel(granted: boolean | undefined): string {
  if (granted === true) {
    return "Accessibility Allowed";
  }
  if (granted === false) {
    return "Accessibility Off - Open Settings";
  }
  return "Open Accessibility Settings";
}

function ActionButtonField({
  children,
  description,
  label,
  onClick,
}: {
  children: ReactNode;
  description?: string;
  label: string;
  onClick: () => void;
}) {
  const id = useId();
  return (
    <SettingRow description={description} htmlFor={id} label={label}>
      <Button className="h-10 w-full justify-start px-3 text-sm" id={id} onClick={onClick} type="button">
        {children}
      </Button>
    </SettingRow>
  );
}

function ActionButtonPairField({
  actions,
  description,
  label,
}: {
  actions: ReadonlyArray<{ label: string; onClick: () => void }>;
  description?: string;
  label: string;
}) {
  const id = useId();
  return (
    <SettingRow description={description} htmlFor={id} label={label}>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {actions.map((action, index) => (
          <Button
            className="h-10 w-full justify-center px-3 text-center text-sm"
            id={index === 0 ? id : undefined}
            key={action.label}
            onClick={action.onClick}
            type="button"
            variant="outline"
          >
            {action.label}
          </Button>
        ))}
      </div>
    </SettingRow>
  );
}

function SelectField({
  contentClassName,
  description,
  isModified,
  label,
  onChange,
  onResetToDefault,
  options,
  showScrollButtons,
  value,
}: {
  contentClassName?: string;
  description?: string;
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  showScrollButtons?: boolean;
  value: string;
} & SettingModificationProps) {
  const id = useId();
  return (
    <SettingRow
      description={description}
      htmlFor={id}
      isModified={isModified}
      label={label}
      onResetToDefault={onResetToDefault}
    >
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger className="h-10 w-full px-3 text-sm" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={contentClassName} showScrollButtons={showScrollButtons}>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

function PetPickerField({
  isModified,
  onChange,
  onResetToDefault,
  value,
}: {
  onChange: (value: PetId) => void;
  value: PetId;
} & SettingModificationProps) {
  const id = useId();
  const selectedPet = PET_OPTIONS.find((option) => option.id === value) ?? PET_OPTIONS[0]!;
  return (
    <SettingRow
      description="Choose the pet sprite."
      htmlFor={id}
      isModified={isModified}
      label="Pet"
      onResetToDefault={onResetToDefault}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
          <PetAvatar className="scale-[0.42]" petId={selectedPet.id} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Select onValueChange={(nextValue) => onChange(nextValue as PetId)} value={value}>
            <SelectTrigger className="h-10 w-full px-3 text-sm" id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PET_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.displayName}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="truncate text-xs text-muted-foreground">{selectedPet.description}</div>
        </div>
      </div>
    </SettingRow>
  );
}

function StaticNoteField({ description, label }: { description: string; label: string }) {
  const id = useId();
  /**
   * CDXC:SidebarTheme 2026-05-08-11:14
   * The Sidebar Theme setting should no longer expose Auto or the previous
   * theme presets. Show a non-editable note while theme selection is paused so
   * Settings communicates the temporary product state without offering hidden
   * values.
   */
  return (
    <SettingRow description={description} htmlFor={id} label={label}>
      <div
        className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        id={id}
      >
        Themes are coming back soon.
      </div>
    </SettingRow>
  );
}

function SoundField({
  description,
  isModified,
  label,
  onChange,
  onPlay,
  onResetToDefault,
  value,
}: {
  description?: string;
  label: string;
  onChange: (value: CompletionSoundSetting) => void;
  onPlay?: (value: CompletionSoundSetting) => void;
  value: CompletionSoundSetting;
} & SettingModificationProps) {
  /**
   * CDXC:Settings 2026-04-29-17:01
   * Sound pickers have enough options that Radix hover-scroll buttons can
   * fight wheel scrolling inside the modal. Disable those auto-scroll zones so
   * mouse and trackpad wheel direction remains stable.
   *
   * CDXC:Settings 2026-05-11-02:06
   * Every sound picker needs an adjacent icon-only preview button so users can
   * audition the selected sound without changing settings or triggering the
   * broader agent-completion notification test flow.
   */
  const id = useId();
  return (
    <SettingRow
      description={description}
      htmlFor={id}
      isModified={isModified}
      label={label}
      onResetToDefault={onResetToDefault}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-2">
        <Select
          onValueChange={(nextValue) => onChange(nextValue as CompletionSoundSetting)}
          value={value}
        >
          <SelectTrigger className="h-10 w-full px-3 text-sm" id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72" showScrollButtons={false}>
            <SelectGroup>
              {COMPLETION_SOUND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={`Play ${label}`}
              className="h-10 w-10 rounded-md"
              disabled={!onPlay}
              onClick={() => onPlay?.(value)}
              size="icon"
              type="button"
              variant="outline"
            >
              <IconPlayerPlay aria-hidden="true" className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>Play selected sound</TooltipContent>
        </Tooltip>
      </div>
    </SettingRow>
  );
}

function TextField({
  description,
  isModified,
  label,
  onChange,
  onResetToDefault,
  placeholder,
  value,
}: {
  description?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
} & SettingModificationProps) {
  const id = useId();
  return (
    <SettingRow
      description={description}
      htmlFor={id}
      isModified={isModified}
      label={label}
      onResetToDefault={onResetToDefault}
    >
      <Input
        id={id}
        className="h-10 px-3 text-sm"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </SettingRow>
  );
}

function ColorField({
  description,
  isModified,
  label,
  onChange,
  onResetToDefault,
  value,
}: {
  description?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
} & SettingModificationProps) {
  const id = useId();
  const colorValue = normalizeColorInputValue(value);
  return (
    <SettingRow
      description={description}
      htmlFor={id}
      isModified={isModified}
      label={label}
      onResetToDefault={onResetToDefault}
    >
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3">
        <Input
          aria-label={`${label} picker`}
          className="h-10 cursor-pointer rounded-xl p-1"
          onChange={(event) => onChange(event.currentTarget.value)}
          type="color"
          value={colorValue}
        />
        <Input
          id={id}
          className="h-10 px-3 text-sm"
          onChange={(event) => onChange(event.currentTarget.value)}
          value={value}
        />
      </div>
    </SettingRow>
  );
}

function normalizeColorInputValue(value: string): string {
  return /^#[0-9a-f]{6}$/iu.test(value.trim()) ? value.trim() : "#121212";
}

function ToggleField({
  checked,
  description,
  disabled,
  isModified,
  label,
  onChange,
  onResetToDefault,
}: {
  checked: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
} & SettingModificationProps) {
  const id = useId();
  return (
    <SettingRow
      description={description}
      htmlFor={id}
      isModified={isModified}
      label={label}
      onResetToDefault={onResetToDefault}
    >
      <Switch checked={checked} disabled={disabled} id={id} onCheckedChange={onChange} />
    </SettingRow>
  );
}

/**
 * CDXC:Settings 2026-05-06-12:57
 * CDXC:SettingsModifiedState 2026-05-07-18:03
 * Every changed settings control needs a small, low-emphasis asterisk to the
 * left of its label. Position it absolutely so modified-state indication does
 * not reflow setting titles, while the tooltip action still resets only that
 * setting to DEFAULT_zmux_SETTINGS.
 */
function SettingRow({
  children,
  description,
  htmlFor,
  isModified,
  label,
  onResetToDefault,
}: {
  children: ReactNode;
  description?: string;
  htmlFor: string;
  isModified?: boolean;
  label: string;
  onResetToDefault?: () => void;
}) {
  return (
    <Field className="gap-2.5" orientation="vertical">
      <FieldContent>
        <FieldTitle className="relative text-sm">
          {isModified && onResetToDefault ? (
            <ModifiedSettingResetButton label={label} onResetToDefault={onResetToDefault} />
          ) : null}
          <FieldLabel className="text-sm" htmlFor={htmlFor}>
            {label}
          </FieldLabel>
        </FieldTitle>
        {description ? (
          <FieldDescription className="text-sm">{description}</FieldDescription>
        ) : null}
      </FieldContent>
      <div className="min-w-0">{children}</div>
    </Field>
  );
}

function ModifiedSettingResetButton({
  label,
  onResetToDefault,
}: {
  label: string;
  onResetToDefault: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={`Reset ${label} to default`}
          className="settings-modified-reset-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onResetToDefault();
          }}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <IconAsterisk aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="whitespace-pre-line text-center" sideOffset={6}>
        {MODIFIED_SETTING_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  );
}
