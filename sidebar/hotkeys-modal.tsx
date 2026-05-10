import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DEFAULT_zmux_HOTKEYS,
  ZMUX_HOTKEY_DEFINITIONS,
  normalizeHotkeyText,
  normalizezmuxHotkeySettings,
  type zmuxHotkeyActionId,
  type zmuxHotkeySettings,
} from "../shared/zmux-hotkeys";
import { HotkeyRecorderField } from "./hotkey-recorder-field";

export type HotkeysModalProps = {
  hotkeys?: zmuxHotkeySettings;
  isOpen: boolean;
  onChange: (hotkeys: zmuxHotkeySettings) => void;
  onClose: () => void;
};

export function HotkeysModal({ hotkeys, isOpen, onChange, onClose }: HotkeysModalProps) {
  const [draft, setDraft] = useState<zmuxHotkeySettings>(() =>
    normalizezmuxHotkeySettings(hotkeys),
  );
  const duplicateIds = useMemo(() => getDuplicateHotkeyIds(draft), [draft]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraft(normalizezmuxHotkeySettings(hotkeys));
  }, [hotkeys, isOpen]);

  const updateHotkey = (id: zmuxHotkeyActionId, value: string) => {
    const nextHotkeys = normalizezmuxHotkeySettings({
      ...draft,
      [id]: normalizeHotkeyText(value),
    });
    setDraft(nextHotkeys);
    onChange(nextHotkeys);
  };

  const resetHotkeys = () => {
    const nextHotkeys = normalizezmuxHotkeySettings(DEFAULT_zmux_HOTKEYS);
    setDraft(nextHotkeys);
    onChange(nextHotkeys);
  };

  return (
    <Dialog onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)} open={isOpen}>
      <DialogContent className="zmux-settings-shadcn hotkeys-modal max-h-[min(760px,calc(100vh-2rem))] gap-0 overflow-hidden p-0 font-sans sm:max-w-2xl">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-xl">Hotkeys</DialogTitle>
        </DialogHeader>
        {/* CDXC:Hotkeys 2026-05-10-12:06
            Hotkeys are rebound through a recorder control so macOS Command
            chords are captured as shortcuts instead of being typed into a text
            field or stolen by the global hotkey listener.
            CDXC:Hotkeys 2026-04-28-05:31
            The hotkey list must use a constrained native overflow container
            so long shortcut sets scroll inside the modal instead of expanding
            beyond the app window and hiding footer controls. */}
        <div className="hotkeys-modal-scroll scroll-mask-y">
          <div className="hotkeys-modal-body px-5 pb-5">
            {ZMUX_HOTKEY_DEFINITIONS.map((definition) => {
              const value = draft[definition.id] ?? definition.defaultKey;
              const isDuplicate = duplicateIds.has(definition.id);
              return (
                <label className="hotkeys-modal-row" key={definition.id}>
                  <span className="hotkeys-modal-copy">
                    <span className="hotkeys-modal-title">{definition.title}</span>
                    <span className="hotkeys-modal-description">{definition.description}</span>
                  </span>
                  <HotkeyRecorderField
                    aria-invalid={isDuplicate}
                    className="hotkeys-modal-input"
                    hotkey={value}
                    onChange={(nextHotkey) => updateHotkey(definition.id, nextHotkey)}
                  />
                </label>
              );
            })}
          </div>
        </div>
        <div className="confirm-modal-actions px-5 pb-5">
          <Button onClick={resetHotkeys} type="button" variant="outline">
            Reset
          </Button>
          <Button onClick={onClose} type="button">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
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
