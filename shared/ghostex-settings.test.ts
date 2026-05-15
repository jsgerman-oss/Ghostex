import { describe, expect, test } from "vitest";
import {
  BROWSER_OPEN_MODE_OPTIONS,
  DEFAULT_ghostex_SETTINGS,
  DEFAULT_EDITOR_COMMAND_OPTIONS,
  getDefaultEditorCommandForSettings,
  GHOSTTY_THEME_SETTING_OPTIONS,
  normalizeghostexSettings,
  PROMPT_EDITOR_BACKEND_OPTIONS,
  SESSION_PERSISTENCE_PROVIDER_OPTIONS,
  SESSION_STATUS_INDICATOR_SIZE_OPTIONS,
  SIDEBAR_SIDE_OPTIONS,
  SIDEBAR_THEME_SETTING_OPTIONS,
  ZED_OVERLAY_TARGET_APP_OPTIONS,
} from "./ghostex-settings";
import { DEFAULT_PET_ID } from "./pets";

describe("normalizeghostexSettings", () => {
  test("defaults the Zed overlay settings", () => {
    expect(normalizeghostexSettings({})).toMatchObject({
      syncOpenProjectWithZed: DEFAULT_ghostex_SETTINGS.syncOpenProjectWithZed,
      zedOverlayEnabled: DEFAULT_ghostex_SETTINGS.zedOverlayEnabled,
      zedOverlayHideTitlebarButton: DEFAULT_ghostex_SETTINGS.zedOverlayHideTitlebarButton,
      zedOverlayTargetApp: DEFAULT_ghostex_SETTINGS.zedOverlayTargetApp,
    });
  });

  test("keeps the IDE title-bar button visible by default", () => {
    /**
     * CDXC:IDEAttachment 2026-05-01-13:52
     * Hiding the native Attach/Detach IDE title-bar button is opt-in. The
     * default must remain visible so existing users keep the current control.
     */
    expect(DEFAULT_ghostex_SETTINGS.zedOverlayHideTitlebarButton).toBe(false);
    expect(normalizeghostexSettings({ zedOverlayHideTitlebarButton: true })).toMatchObject({
      zedOverlayHideTitlebarButton: true,
    });
  });

  test("keeps active project IDE sync enabled by default", () => {
    /**
     * CDXC:IDEAttachment 2026-05-06-12:49
     * The sync setting must default on so project activation in either sidebar
     * mode can debounce one attached-IDE workspace sync from the sidebar.
     */
    expect(DEFAULT_ghostex_SETTINGS.syncOpenProjectWithZed).toBe(true);
    expect(normalizeghostexSettings({ syncOpenProjectWithZed: false })).toMatchObject({
      syncOpenProjectWithZed: false,
    });
  });

  test("defaults browser actions to Chrome Canary and keeps browser panes opt-in", () => {
    /**
     * CDXC:BrowserPanes 2026-05-02-06:35
     * Chrome Canary remains the default browser action target. Browser panes are
     * selected explicitly so the existing browser-window workflow is not
     * replaced by a persisted-settings migration.
     */
    expect(DEFAULT_ghostex_SETTINGS.browserOpenMode).toBe("chrome-canary");
    expect(normalizeghostexSettings({})).toMatchObject({
      browserOpenMode: "chrome-canary",
    });
    expect(normalizeghostexSettings({ browserOpenMode: "browser-pane" })).toMatchObject({
      browserOpenMode: "browser-pane",
    });
    expect(normalizeghostexSettings({ browserOpenMode: "Safari" })).toMatchObject({
      browserOpenMode: "chrome-canary",
    });
    expect(BROWSER_OPEN_MODE_OPTIONS).toContainEqual({
      label: "Browser Panes",
      value: "browser-pane",
    });
  });

  test("hides project-header git file counts by default", () => {
    /**
     * CDXC:ProjectDiffStats 2026-05-15-14:33:
     * Project-header git stats default to showing added/removed line counts
     * only; the changed-file number is an explicit Settings preference.
     */
    expect(DEFAULT_ghostex_SETTINGS.showProjectEditorDiffFileCount).toBe(false);
    expect(normalizeghostexSettings({})).toMatchObject({
      showProjectEditorDiffFileCount: false,
    });
    expect(normalizeghostexSettings({ showProjectEditorDiffFileCount: true })).toMatchObject({
      showProjectEditorDiffFileCount: true,
    });
  });

  test("keeps session-card last active timestamps visible unless explicitly hidden", () => {
    /**
     * CDXC:SidebarSessions 2026-05-15-08:57
     * Last Active timestamps on session cards stay visible by default. Users
     * can hide that timestamp without affecting the project header's
     * independent git additions/deletions stats.
     */
    expect(DEFAULT_ghostex_SETTINGS.hideLastActiveTimeOnSessionCards).toBe(false);
    expect(normalizeghostexSettings({})).toMatchObject({
      hideLastActiveTimeOnSessionCards: false,
    });
    expect(normalizeghostexSettings({ hideLastActiveTimeOnSessionCards: true })).toMatchObject({
      hideLastActiveTimeOnSessionCards: true,
    });
  });

  test("supports built-in and custom default editor commands", () => {
    /**
     * CDXC:AgentsHub 2026-05-12-09:22
     * Agents Hub edit actions should have one normalized editor command
     * setting, with common editor CLIs available without custom text.
     */
    expect(DEFAULT_ghostex_SETTINGS.defaultEditorCommand).toBe("code");
    expect(normalizeghostexSettings({})).toMatchObject({
      customDefaultEditorCommand: "",
      defaultEditorCommand: "code",
    });
    expect(normalizeghostexSettings({ defaultEditorCommand: "code-insiders" })).toMatchObject({
      defaultEditorCommand: "code-insiders",
    });
    expect(normalizeghostexSettings({ defaultEditorCommand: "zed" })).toMatchObject({
      defaultEditorCommand: "zed",
    });
    expect(normalizeghostexSettings({ defaultEditorCommand: "invalid" })).toMatchObject({
      defaultEditorCommand: "code",
    });
    const customSettings = normalizeghostexSettings({
      customDefaultEditorCommand: "  my-editor --reuse-window  ",
      defaultEditorCommand: "other",
    });
    expect(customSettings).toMatchObject({
      customDefaultEditorCommand: "my-editor --reuse-window",
      defaultEditorCommand: "other",
    });
    expect(getDefaultEditorCommandForSettings(customSettings)).toBe("my-editor --reuse-window");
    expect(
      getDefaultEditorCommandForSettings(
        normalizeghostexSettings({ customDefaultEditorCommand: "", defaultEditorCommand: "other" }),
      ),
    ).toBe("code");
    expect(DEFAULT_EDITOR_COMMAND_OPTIONS).toContainEqual({
      label: "VS Code Insiders (code-insiders)",
      value: "code-insiders",
    });
    expect(DEFAULT_EDITOR_COMMAND_OPTIONS).toContainEqual({
      label: "Other",
      value: "other",
    });
  });

  test("keeps sidebar side as a selectable left or right setting", () => {
    /**
     * CDXC:SidebarPlacement 2026-05-06-17:32
     * Sidebar placement is persisted with the rest of Settings so users can
     * choose right-side chrome from the top Sidebar setting, while invalid
     * values still normalize to the left-side default AppKit layout.
     */
    expect(DEFAULT_ghostex_SETTINGS.sidebarSide).toBe("left");
    expect(normalizeghostexSettings({})).toMatchObject({
      sidebarSide: "left",
    });
    expect(normalizeghostexSettings({ sidebarSide: "right" })).toMatchObject({
      sidebarSide: "right",
    });
    expect(normalizeghostexSettings({ sidebarSide: "bottom" })).toMatchObject({
      sidebarSide: "left",
    });
    expect(SIDEBAR_SIDE_OPTIONS).toEqual([
      { label: "Left", value: "left" },
      { label: "Right", value: "right" },
    ]);
  });

  test("defaults sidebar theme to Dark Gray and removes Auto from visible theme options", () => {
    /**
     * CDXC:SidebarTheme 2026-05-08-11:14
     * Auto is retired from user-facing sidebar themes while the full picker is
     * hidden. Defaults and legacy Auto values normalize to Dark Gray so the
     * sidebar starts in the requested palette without a transient auto theme.
     */
    expect(DEFAULT_ghostex_SETTINGS.sidebarTheme).toBe("plain");
    expect(normalizeghostexSettings({})).toMatchObject({
      sidebarTheme: "plain",
    });
    expect(normalizeghostexSettings({ sidebarTheme: "auto" })).toMatchObject({
      sidebarTheme: "plain",
    });
    expect(SIDEBAR_THEME_SETTING_OPTIONS).toEqual([{ label: "Dark Gray", value: "plain" }]);
  });

  test("defaults session status indicators to Medium and keeps four selectable sizes", () => {
    /**
     * CDXC:SessionStatusIndicators 2026-05-07-18:20
     * Medium is the default because it is 50% of the current approved X-Large
     * indicator size. Settings must expose all named scale points so users can
     * return to the larger visual or choose smaller indicators later.
     * CDXC:SessionStatusIndicators 2026-05-09-17:30
     * Floating status badges are hidden by default now that the menu bar
     * indicator is the default always-visible chrome. Keep menu bar visibility
     * independent so users can hide either surface without affecting counts.
     */
    expect(DEFAULT_ghostex_SETTINGS.hideFloatingSessionStatusIndicators).toBe(true);
    expect(DEFAULT_ghostex_SETTINGS.hideMenuBarSessionStatusIndicators).toBe(false);
    expect(DEFAULT_ghostex_SETTINGS.sessionStatusIndicatorSize).toBe("medium");
    expect(normalizeghostexSettings({})).toMatchObject({
      hideFloatingSessionStatusIndicators: true,
      hideMenuBarSessionStatusIndicators: false,
      sessionStatusIndicatorSize: "medium",
    });
    expect(
      normalizeghostexSettings({
        hideFloatingSessionStatusIndicators: false,
        hideMenuBarSessionStatusIndicators: true,
      }),
    ).toMatchObject({
      hideFloatingSessionStatusIndicators: false,
      hideMenuBarSessionStatusIndicators: true,
    });
    expect(normalizeghostexSettings({ sessionStatusIndicatorSize: "x-large" })).toMatchObject({
      sessionStatusIndicatorSize: "x-large",
    });
    expect(normalizeghostexSettings({ sessionStatusIndicatorSize: "giant" })).toMatchObject({
      sessionStatusIndicatorSize: "medium",
    });
    expect(SESSION_STATUS_INDICATOR_SIZE_OPTIONS).toEqual([
      { label: "X-Large", value: "x-large" },
      { label: "Large", value: "large" },
      { label: "Medium", value: "medium" },
      { label: "Small", value: "small" },
    ]);
  });

  test("keeps the pet overlay opt-in and normalizes selected pets", () => {
    expect(DEFAULT_ghostex_SETTINGS.petOverlayEnabled).toBe(false);
    expect(DEFAULT_ghostex_SETTINGS.selectedPetId).toBe(DEFAULT_PET_ID);
    expect(normalizeghostexSettings({})).toMatchObject({
      petOverlayEnabled: false,
      selectedPetId: "codex",
    });
    expect(
      normalizeghostexSettings({ petOverlayEnabled: true, selectedPetId: "dewey" }),
    ).toMatchObject({
      petOverlayEnabled: true,
      selectedPetId: "dewey",
    });
    expect(normalizeghostexSettings({ selectedPetId: "not-a-pet" })).toMatchObject({
      selectedPetId: "codex",
    });
  });

  test("enables macOS attention notifications by default", () => {
    /**
     * CDXC:SessionAttentionNotifications 2026-05-10-16:46
     * Attention banners are a first-install behavior so finished background
     * sessions can surface themselves. Persisted false remains authoritative
     * because users need a Settings switch to disable system notifications.
     */
    expect(DEFAULT_ghostex_SETTINGS.showMacOSAttentionNotifications).toBe(true);
    expect(normalizeghostexSettings({})).toMatchObject({
      showMacOSAttentionNotifications: true,
    });
    expect(normalizeghostexSettings({ showMacOSAttentionNotifications: false })).toMatchObject({
      showMacOSAttentionNotifications: false,
    });
  });

  test("keeps the workspace background color setting", () => {
    expect(DEFAULT_ghostex_SETTINGS.workspaceBackgroundColor).toBe("#0e0e0e");
    expect(normalizeghostexSettings({ workspaceBackgroundColor: "#202020" })).toMatchObject({
      workspaceBackgroundColor: "#202020",
    });
    expect(normalizeghostexSettings({ workspaceBackgroundColor: "   " })).toMatchObject({
      workspaceBackgroundColor: DEFAULT_ghostex_SETTINGS.workspaceBackgroundColor,
    });
  });

  test("keeps Ghostty mouse scroll multipliers in the settings slider range", () => {
    /**
     * CDXC:TerminalScrollSettings 2026-04-29-08:56
     * The settings modal exposes Ghostty's precision and discrete scroll
     * multipliers as 0.25-step sliders, so normalization preserves valid
     * tuning values and clamps saved values to the same practical range before
     * writing the shared Ghostty config.
     */
    expect(DEFAULT_ghostex_SETTINGS.terminalMouseScrollMultiplierPrecision).toBe(1);
    expect(DEFAULT_ghostex_SETTINGS.terminalMouseScrollMultiplierDiscrete).toBe(3);
    expect(
      normalizeghostexSettings({
        terminalMouseScrollMultiplierDiscrete: 4,
        terminalMouseScrollMultiplierPrecision: 0.75,
      }),
    ).toMatchObject({
      terminalMouseScrollMultiplierDiscrete: 4,
      terminalMouseScrollMultiplierPrecision: 0.75,
    });
    expect(
      normalizeghostexSettings({
        terminalMouseScrollMultiplierDiscrete: 10001,
        terminalMouseScrollMultiplierPrecision: 0,
      }),
    ).toMatchObject({
      terminalMouseScrollMultiplierDiscrete: 8,
      terminalMouseScrollMultiplierPrecision: 0.25,
    });
  });

  test("keeps session persistence provider opt-in", () => {
    /**
     * CDXC:SessionPersistence 2026-05-05-07:28
     * Session persistence must not change existing launch behavior until the
     * user selects a provider in Settings. Legacy tmuxMode=true settings should
     * migrate to the tmux provider, and zmx/zellij must persist as provider
     * choices with the same restart-safe attach/recreate contract.
     */
    expect(DEFAULT_ghostex_SETTINGS.sessionPersistenceProvider).toBe("off");
    expect(DEFAULT_ghostex_SETTINGS.tmuxMode).toBe(false);
    expect(normalizeghostexSettings({})).toMatchObject({
      sessionPersistenceProvider: "off",
      tmuxMode: false,
    });
    expect(normalizeghostexSettings({ tmuxMode: true })).toMatchObject({
      sessionPersistenceProvider: "tmux",
      tmuxMode: true,
    });
    expect(normalizeghostexSettings({ sessionPersistenceProvider: "zmx" })).toMatchObject({
      sessionPersistenceProvider: "zmx",
      tmuxMode: false,
    });
    expect(normalizeghostexSettings({ sessionPersistenceProvider: "zellij" })).toMatchObject({
      sessionPersistenceProvider: "zellij",
      tmuxMode: false,
    });
    expect(SESSION_PERSISTENCE_PROVIDER_OPTIONS).toContainEqual({
      label: "zellij",
      value: "zellij",
    });
    expect(normalizeghostexSettings({ sessionPersistenceProvider: "wat" })).toMatchObject({
      sessionPersistenceProvider: "off",
      tmuxMode: false,
    });
  });

  test("keeps common Ghostty terminal behavior settings", () => {
    /**
     * CDXC:TerminalBehaviorSettings 2026-04-29-09:32
     * The settings modal owns common Ghostty behavior controls and writes the
     * documented enum/range values into the shared Ghostty config.
     */
    expect(normalizeghostexSettings({})).toMatchObject({
      terminalClipboardPasteProtection: true,
      terminalClipboardTrimTrailingSpaces: true,
      terminalConfirmCloseSurface: "true",
      terminalCopyOnSelect: "true",
      terminalCursorStyleBlink: true,
      terminalMouseHideWhileTyping: false,
      terminalScrollbackLimitMb: 10,
      terminalScrollbar: "system",
    });
    expect(
      normalizeghostexSettings({
        terminalClipboardPasteProtection: false,
        terminalClipboardTrimTrailingSpaces: false,
        terminalConfirmCloseSurface: "always",
        terminalCopyOnSelect: "clipboard",
        terminalCursorStyleBlink: false,
        terminalMouseHideWhileTyping: true,
        terminalScrollbackLimitMb: 25,
        terminalScrollbar: "never",
      }),
    ).toMatchObject({
      terminalClipboardPasteProtection: false,
      terminalClipboardTrimTrailingSpaces: false,
      terminalConfirmCloseSurface: "always",
      terminalCopyOnSelect: "clipboard",
      terminalCursorStyleBlink: false,
      terminalMouseHideWhileTyping: true,
      terminalScrollbackLimitMb: 25,
      terminalScrollbar: "never",
    });
    expect(
      normalizeghostexSettings({
        terminalConfirmCloseSurface: "ask-me",
        terminalCopyOnSelect: "system",
        terminalScrollbackLimitMb: 1000,
        terminalScrollbar: "always",
      }),
    ).toMatchObject({
      terminalConfirmCloseSurface: "true",
      terminalCopyOnSelect: "true",
      terminalScrollbackLimitMb: 200,
      terminalScrollbar: "system",
    });
  });

  test("defaults Ctrl+G prompt editing to Monaco and preserves legacy zpet opt-ins", () => {
    /**
     * CDXC:PromptEditorBackend 2026-05-11-14:38
     * Monaco is the default floating editor backend. Legacy zpet opt-in keys
     * still normalize to zpet so existing explicit zpet users are not moved.
     */
    expect(DEFAULT_ghostex_SETTINGS.promptEditorBackend).toBe("monaco");
    expect(normalizeghostexSettings({})).toMatchObject({
      promptEditorBackend: "monaco",
      richPromptEditingWithZapet: false,
      useZpetForCtrlGPromptEditing: false,
    });
    expect(normalizeghostexSettings({ richPromptEditingWithZapet: false })).toMatchObject({
      promptEditorBackend: "monaco",
    });
    expect(normalizeghostexSettings({ richPromptEditingWithZapet: true })).toMatchObject({
      promptEditorBackend: "zpet",
      richPromptEditingWithZapet: true,
      useZpetForCtrlGPromptEditing: true,
    });
    expect(normalizeghostexSettings({ useZpetForCtrlGPromptEditing: true })).toMatchObject({
      promptEditorBackend: "zpet",
    });
    expect(normalizeghostexSettings({ promptEditorBackend: "zpet" })).toMatchObject({
      promptEditorBackend: "zpet",
    });
    expect(normalizeghostexSettings({ promptEditorBackend: "invalid" })).toMatchObject({
      promptEditorBackend: "monaco",
    });
    expect(PROMPT_EDITOR_BACKEND_OPTIONS).toEqual([
      { label: "Monaco floating editor", value: "monaco" },
      { label: "zpet TUI floating editor", value: "zpet" },
    ]);
  });

  test("keeps Ghostty typography settings in documented practical ranges", () => {
    /**
     * CDXC:TerminalTypographySettings 2026-04-29-09:32
     * Typography settings default to Ghostty's macOS defaults where possible:
     * font family is unmanaged, font size is 13pt, no thickening is requested,
     * and cell metric adjustments start at zero.
     */
    expect(normalizeghostexSettings({})).toMatchObject({
      terminalFontFamily: "",
      terminalFontSize: 13,
      terminalFontWeight: 400,
      terminalLetterSpacing: 0,
      terminalLineHeight: 1,
    });
    expect(
      normalizeghostexSettings({
        terminalFontFamily: "Hack",
        terminalFontSize: 13.5,
        terminalFontWeight: 650,
        terminalLetterSpacing: 0.6,
        terminalLineHeight: 1.3,
      }),
    ).toMatchObject({
      terminalFontFamily: "Hack",
      terminalFontSize: 13.5,
      terminalFontWeight: 650,
      terminalLetterSpacing: 0.6,
      terminalLineHeight: 1.3,
    });
    expect(
      normalizeghostexSettings({
        terminalFontFamily: "Cross Platform Mono",
        terminalFontSize: 512,
        terminalFontWeight: 10,
        terminalLetterSpacing: 99,
        terminalLineHeight: -1,
      }),
    ).toMatchObject({
      terminalFontFamily: "Consolas",
      terminalFontSize: 32,
      terminalFontWeight: 100,
      terminalLetterSpacing: 8,
      terminalLineHeight: 0.8,
    });
  });

  test("keeps bundled Ghostty theme settings", () => {
    /**
     * CDXC:TerminalThemeSettings 2026-04-29-09:32
     * Ghostty theme names are exact strings from the bundled theme list. The
     * empty value means ghostex should leave the user's Ghostty theme unmanaged.
     */
    expect(GHOSTTY_THEME_SETTING_OPTIONS).toContainEqual({
      label: "Use existing Ghostty config",
      value: "__ghostex_ghostty_theme_unmanaged__",
    });
    expect(GHOSTTY_THEME_SETTING_OPTIONS).toContainEqual({
      label: "GitHub Dark Default",
      value: "GitHub Dark Default",
    });
    expect(
      normalizeghostexSettings({
        terminalGhosttyTheme: "GitHub Dark Default",
      }),
    ).toMatchObject({
      terminalGhosttyTheme: "GitHub Dark Default",
    });
    expect(normalizeghostexSettings({ terminalGhosttyTheme: "Not A Bundled Theme" })).toMatchObject({
      terminalGhosttyTheme: "",
    });
  });

  test("keeps valid Zed overlay settings", () => {
    expect(
      normalizeghostexSettings({
        zedOverlayEnabled: true,
        zedOverlayTargetApp: "zed",
      }),
    ).toMatchObject({
      zedOverlayEnabled: true,
      zedOverlayTargetApp: "zed",
    });
  });

  test("rejects invalid Zed overlay target apps", () => {
    expect(
      normalizeghostexSettings({
        zedOverlayTargetApp: "Cursor",
      }),
    ).toMatchObject({
      zedOverlayTargetApp: DEFAULT_ghostex_SETTINGS.zedOverlayTargetApp,
    });
  });

  test("keeps VS Code IDE attachment targets", () => {
    expect(
      normalizeghostexSettings({
        zedOverlayTargetApp: "vscode",
      }).zedOverlayTargetApp,
    ).toBe("vscode");
    expect(
      normalizeghostexSettings({
        zedOverlayTargetApp: "vscode-insiders",
      }).zedOverlayTargetApp,
    ).toBe("vscode-insiders");
  });

  test("keeps IDE attachment dropdown labels distinguishable", () => {
    /**
     * CDXC:IDEAttachment 2026-04-28-00:05
     * The settings dropdown must show Zed Preview explicitly, even though
     * native title-bar buttons use the shorter "Attach Zed" text.
     */
    expect(ZED_OVERLAY_TARGET_APP_OPTIONS).toContainEqual({ label: "Zed", value: "zed" });
    expect(ZED_OVERLAY_TARGET_APP_OPTIONS).toContainEqual({
      label: "Zed Preview",
      value: "zed-preview",
    });
  });
});
