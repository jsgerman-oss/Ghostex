import { useEffect } from "react";
import { useHotkeyRecorder } from "@tanstack/react-hotkeys";
import { IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { normalizeHotkeyText } from "../shared/ghostex-hotkeys";

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

  useEffect(() => {
    if (!recorder.isRecording) {
      return;
    }
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      /**
       * CDXC:Hotkeys 2026-05-11-09:06
       * Escape cancels active shortcut recording inside Settings. It must not
       * bubble to the dialog-level escape handler, because users expect it to
       * leave the Settings modal open while abandoning only the recording.
       */
      event.preventDefault();
      event.stopImmediatePropagation();
      recorder.cancelRecording();
    };
    document.addEventListener("keydown", cancelOnEscape, { capture: true });
    return () => document.removeEventListener("keydown", cancelOnEscape, { capture: true });
  }, [recorder]);

  return (
    <div
      data-hotkey-recorder="true"
      data-recording={recorder.isRecording ? "true" : undefined}
      className="group/hotkey-recorder relative w-full"
    >
      <Button
        aria-invalid={ariaInvalid}
        className={cn("h-10 w-full justify-start px-3 pr-9 font-mono text-sm", className)}
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
      {normalizedHotkey ? (
        <Button
          aria-label="Remove hotkey"
          className="pointer-events-none absolute top-1/2 right-1.5 z-10 size-7 -translate-y-1/2 rounded-md border border-border bg-background/95 p-0 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/hotkey-recorder:pointer-events-auto group-hover/hotkey-recorder:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            recorder.cancelRecording();
            onChange("");
          }}
          size="icon-xs"
          title="Remove hotkey"
          type="button"
          variant="outline"
        >
          {/* CDXC:Hotkeys 2026-05-11-09:06
              The remove affordance is a real button inside the hotkey field,
              revealed only when that field is hovered or focused so hotkey rows
              stay quiet until the user targets a specific binding. */}
          <IconX aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
    </div>
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
