import type { SessionGridDirection, TerminalViewMode } from "./session-grid-contract-core";

export type zmuxHotkeyActionId =
  | "createSession"
  | "openSettings"
  | "moveSidebar"
  | "openCommandsPanel"
  | "renameActiveSession"
  | "focusPreviousGroup"
  | "focusNextGroup"
  | "focusPreviousSession"
  | "focusNextSession"
  | "focusUp"
  | "focusRight"
  | "focusDown"
  | "focusLeft"
  | "splitMore"
  | "splitMoreDown"
  | `focusGroup${1 | 2 | 3 | 4 | 5}`
  | `focusSessionSlot${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export type zmuxHotkeySettings = Partial<Record<zmuxHotkeyActionId, string>>;

export type zmuxHotkeyAction =
  | { id: zmuxHotkeyActionId; kind: "createSession" }
  | { id: zmuxHotkeyActionId; kind: "focusAdjacentGroup"; direction: -1 | 1 }
  | { id: zmuxHotkeyActionId; kind: "focusDirection"; direction: SessionGridDirection }
  | { id: zmuxHotkeyActionId; kind: "focusGroup"; groupIndex: number }
  | { id: zmuxHotkeyActionId; kind: "focusSessionSlot"; slotNumber: number }
  | { id: zmuxHotkeyActionId; kind: "moveSidebar" }
  | { id: zmuxHotkeyActionId; kind: "openCommandsPanel" }
  | { id: zmuxHotkeyActionId; kind: "openSettings" }
  | { id: zmuxHotkeyActionId; kind: "renameActiveSession" }
  | { id: zmuxHotkeyActionId; kind: "setViewMode"; viewMode: TerminalViewMode }
  | { direction: "horizontal" | "vertical"; id: zmuxHotkeyActionId; kind: "splitFocusedPane" };

export type zmuxHotkeyDefinition = {
  action: zmuxHotkeyAction;
  defaultKey: string;
  description: string;
  id: zmuxHotkeyActionId;
  title: string;
};

/**
 * CDXC:Hotkeys 2026-04-28-05:20
 * The native app must start with the same primary shortcuts as the reference
 * agent-tiler repo, while storing them as app settings so users can redefine
 * the bindings without changing code or relying on hard-coded VS Code keys.
 */
export const ZMUX_HOTKEY_DEFINITIONS: readonly zmuxHotkeyDefinition[] = [
  {
    action: { id: "createSession", kind: "createSession" },
    /**
     * CDXC:Hotkeys 2026-05-11-09:26
     * Default hotkeys should prefer plain Cmd chords so the app feels like a
     * Mac-first terminal workspace instead of requiring Cmd+Option layers for
     * everyday navigation.
     */
    defaultKey: "cmd+n",
    description: "Create a terminal session.",
    id: "createSession",
    title: "Create Session",
  },
  {
    action: { id: "openCommandsPanel", kind: "openCommandsPanel" },
    defaultKey: "f12",
    description: "Open the project command terminal panel.",
    id: "openCommandsPanel",
    title: "Open Commands Panel",
  },
  {
    action: { id: "openSettings", kind: "openSettings" },
    defaultKey: "cmd+,",
    description: "Open app settings.",
    id: "openSettings",
    title: "Open Settings",
  },
  {
    action: { id: "moveSidebar", kind: "moveSidebar" },
    defaultKey: "cmd+b",
    description: "Move the sidebar to the other side.",
    id: "moveSidebar",
    title: "Move Sidebar",
  },
  {
    action: { id: "renameActiveSession", kind: "renameActiveSession" },
    defaultKey: "cmd+r",
    description: "Rename the focused session.",
    id: "renameActiveSession",
    title: "Rename Active Session",
  },
  {
    action: { direction: -1, id: "focusPreviousGroup", kind: "focusAdjacentGroup" },
    defaultKey: "cmd+shift+[",
    description: "Focus the previous group.",
    id: "focusPreviousGroup",
    title: "Previous Group",
  },
  {
    action: { direction: 1, id: "focusNextGroup", kind: "focusAdjacentGroup" },
    defaultKey: "cmd+shift+]",
    description: "Focus the next group.",
    id: "focusNextGroup",
    title: "Next Group",
  },
  {
    action: { id: "focusPreviousSession", kind: "focusSessionSlot", slotNumber: -1 },
    defaultKey: "cmd+[",
    description: "Focus the previous visible sidebar session.",
    id: "focusPreviousSession",
    title: "Previous Session",
  },
  {
    action: { id: "focusNextSession", kind: "focusSessionSlot", slotNumber: 0 },
    defaultKey: "cmd+]",
    description: "Focus the next visible sidebar session.",
    id: "focusNextSession",
    title: "Next Session",
  },
  ...(["up", "right", "down", "left"] as const).map((direction) => ({
    action: {
      direction,
      id: `focus${capitalize(direction)}` as zmuxHotkeyActionId,
      kind: "focusDirection" as const,
    },
    defaultKey: `cmd+${direction}`,
    description: `Move focus ${direction}.`,
    id: `focus${capitalize(direction)}` as zmuxHotkeyActionId,
    title: `Focus ${capitalize(direction)}`,
  })),
  ...[1, 2, 3, 4, 5].map((groupIndex) => ({
    action: {
      groupIndex,
      id: `focusGroup${groupIndex}` as zmuxHotkeyActionId,
      kind: "focusGroup" as const,
    },
    defaultKey: `cmd+ctrl+${groupIndex}`,
    description: `Focus group ${groupIndex}.`,
    id: `focusGroup${groupIndex}` as zmuxHotkeyActionId,
    title: `Focus Group ${groupIndex}`,
  })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((slotNumber) => ({
    action: {
      id: `focusSessionSlot${slotNumber}` as zmuxHotkeyActionId,
      kind: "focusSessionSlot" as const,
      slotNumber,
    },
    defaultKey: `cmd+${slotNumber}`,
    description: `Focus session slot ${slotNumber}.`,
    id: `focusSessionSlot${slotNumber}` as zmuxHotkeyActionId,
    title: `Focus Session ${slotNumber}`,
  })),
  {
    action: { direction: "horizontal", id: "splitMore", kind: "splitFocusedPane" },
    /**
     * CDXC:NativeSplits 2026-05-10-18:30
     * Cmd+D creates a real terminal session beside the focused pane instead of
     * only increasing the visible split count. This matches terminal split
     * muscle memory and lets users immediately send work into the new pane.
     */
    defaultKey: "cmd+d",
    description: "Create a terminal beside the focused pane.",
    id: "splitMore",
    title: "Split Sideways",
  },
  {
    action: { direction: "vertical", id: "splitMoreDown", kind: "splitFocusedPane" },
    defaultKey: "cmd+shift+d",
    description: "Create a terminal below the focused pane.",
    id: "splitMoreDown",
    title: "Split Downwards",
  },
];

export const DEFAULT_zmux_HOTKEYS: zmuxHotkeySettings = Object.fromEntries(
  ZMUX_HOTKEY_DEFINITIONS.map((definition) => [definition.id, definition.defaultKey]),
);

export function normalizezmuxHotkeySettings(candidate: unknown): zmuxHotkeySettings {
  const source = isRecord(candidate) ? candidate : {};
  const normalized: zmuxHotkeySettings = {};
  for (const definition of ZMUX_HOTKEY_DEFINITIONS) {
    const value = source[definition.id];
    if (typeof value === "string") {
      /**
       * CDXC:Hotkeys 2026-05-11-09:06
       * Users can remove any hotkey from Settings. A missing setting still
       * means "use the default", but an explicitly blank string means the
       * command is intentionally unassigned.
       */
      normalized[definition.id] = value.trim() ? normalizeHotkeyText(value) : "";
      continue;
    }
    normalized[definition.id] = definition.defaultKey;
  }
  return normalized;
}

export function getzmuxHotkeyActionById(id: string): zmuxHotkeyAction | undefined {
  return ZMUX_HOTKEY_DEFINITIONS.find((definition) => definition.id === id)?.action;
}

export function normalizeHotkeyText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/⌘|command/g, "cmd")
    .replace(/⌥|option/g, "alt")
    .replace(/⌃|control/g, "ctrl")
    .replace(/⇧|shift/g, "shift")
    .replace(/\bmod\b/g, "cmd")
    .replace(/\s+/g, " ");
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
