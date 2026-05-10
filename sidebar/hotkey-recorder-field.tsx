import { useHotkeyRecorder } from "@tanstack/react-hotkeys";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { normalizeHotkeyText } from "../shared/zmux-hotkeys";

export type HotkeyRecorderFieldProps = {
  ariaInvalid?: boolean;
  className?: string;
  hotkey: string;
  id?: string;
  onChange: (hotkey: string) => void;
};

export function HotkeyRecorderField({
  ariaInvalid = false,
  className,
  hotkey,
  id,
  onChange,
}: HotkeyRecorderFieldProps) {
  const recorder = useHotkeyRecorder({
    ignoreInputs: false,
    onClear: () => onChange(""),
    onRecord: (recordedHotkey) => {
      onChange(normalizeHotkeyText(recordedHotkey));
    },
  });
  const normalizedHotkey = normalizeHotkeyText(hotkey);
  const label = recorder.isRecording
    ? "Press Shortcut"
    : formatSettingsHotkeyForDisplay(normalizedHotkey);

  return (
    <Button
      aria-invalid={ariaInvalid}
      className={cn("h-10 w-full justify-start px-3 font-mono text-sm", className)}
      data-hotkey-recorder="true"
      id={id}
      onClick={() => {
        if (recorder.isRecording) {
          recorder.cancelRecording();
          return;
        }
        recorder.startRecording();
      }}
      type="button"
      variant="outline"
    >
      {label || "Unassigned"}
    </Button>
  );
}

function formatSettingsHotkeyForDisplay(hotkey: string): string {
  /**
   * CDXC:Hotkeys 2026-05-10-12:06
   * The settings UI records shortcuts with TanStack Hotkeys, while the native
   * bridge persists lowercase `cmd+...` strings. Convert only for display so the
   * stored settings remain compatible with AppKit and the sidebar dispatcher.
   */
  return hotkey
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map(formatHotkeyPart)
        .join("+"),
    )
    .join(" ");
}

function formatHotkeyPart(part: string): string {
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
