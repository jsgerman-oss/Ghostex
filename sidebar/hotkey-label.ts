/**
 * CDXC:Hotkeys 2026-05-15-20:44:
 * Hotkey labels are shown in both the Cmd-hold overlay and the command
 * palette. Keep one formatter so Settings values, palette shortcuts, and the
 * discovery overlay use the same Mac glyphs for the same stored hotkey text.
 */
export function formatSidebarHotkeyLabel(hotkey: string): string {
  return hotkey
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map(formatSidebarHotkeyPart)
        .join("+"),
    )
    .join(" ");
}

function formatSidebarHotkeyPart(part: string): string {
  switch (part) {
    case "cmd":
      return "⌘";
    case "ctrl":
      return "⌃";
    case "alt":
      return "⌥";
    case "shift":
      return "⇧";
    case "up":
      return "↑";
    case "right":
      return "→";
    case "down":
      return "↓";
    case "left":
      return "←";
    default:
      return part.length === 1 ? part.toUpperCase() : part;
  }
}
