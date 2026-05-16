import { IconTrash } from "@tabler/icons-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_BROWSER_ACTION_URL,
  type SidebarActionType,
  type SidebarCommandButton,
} from "../shared/sidebar-commands";
import {
  DEFAULT_SIDEBAR_COMMAND_ICON,
  DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
  type SidebarCommandIcon,
} from "../shared/sidebar-command-icons";
import { CommandIconPicker } from "./command-icon-picker";

export type CommandConfigDraft = {
  actionType: SidebarActionType;
  closeTerminalOnExit: boolean;
  command?: string;
  commandId?: string;
  icon?: SidebarCommandIcon;
  iconColor?: string;
  isGlobal?: boolean;
  name: string;
  playCompletionSound: boolean;
  url?: string;
};

export type CommandConfigModalProps = {
  draft: CommandConfigDraft;
  existingCommands?: readonly SidebarCommandButton[];
  isOpen: boolean;
  lockedActionType?: SidebarActionType;
  onCancel: () => void;
  /**
   * CDXC:SidebarActions 2026-05-06-04:36
   * Configure Actions opens this editor directly from a readable action row.
   * Existing actions must expose deletion inside the editor so users can remove
   * an action without relying on the old modal-embedded context menu.
   */
  onDelete?: (draft: CommandConfigDraft) => void;
  onSave: (draft: CommandConfigDraft) => void;
};

/**
 * CDXC:AppModals 2026-05-08-09:00
 * Reference-mode action configuration uses the shared shadcn dialog stack so
 * app-modal-host presentation, keyboard closing, and form density match the
 * agent configuration editor.
 */
export function CommandConfigModal({
  draft,
  existingCommands = [],
  isOpen,
  lockedActionType,
  onCancel,
  onDelete,
  onSave,
}: CommandConfigModalProps) {
  const [actionType, setActionType] = useState<SidebarActionType>(draft.actionType);
  const [closeTerminalOnExit, setCloseTerminalOnExit] = useState(draft.closeTerminalOnExit);
  const [command, setCommand] = useState(draft.command ?? "");
  const [icon, setIcon] = useState<SidebarCommandIcon>(
    draft.icon ?? DEFAULT_SIDEBAR_COMMAND_ICON,
  );
  const [iconColor, setIconColor] = useState(draft.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR);
  const [isGlobal, setIsGlobal] = useState(draft.isGlobal === true);
  const [name, setName] = useState(draft.name);
  const [playCompletionSound, setPlayCompletionSound] = useState(draft.playCompletionSound);
  const [url, setUrl] = useState(draft.url ?? "");
  const checkboxId = useId();
  const globalCheckboxId = useId();
  const soundCheckboxId = useId();
  const actionTypeId = useId();
  const commandId = useId();
  const nameId = useId();
  const urlId = useId();
  const isActionTypeLocked = lockedActionType !== undefined;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActionType(lockedActionType ?? draft.actionType);
    setCloseTerminalOnExit(draft.closeTerminalOnExit);
    setCommand(draft.command ?? "");
    setIcon(draft.icon ?? DEFAULT_SIDEBAR_COMMAND_ICON);
    setIconColor(draft.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR);
    setIsGlobal(draft.isGlobal === true);
    setName(draft.name);
    setPlayCompletionSound(draft.playCompletionSound);
    setUrl(
      draft.url ??
        ((lockedActionType ?? draft.actionType) === "browser" ? DEFAULT_BROWSER_ACTION_URL : ""),
    );
  }, [draft, isOpen, lockedActionType]);

  useEffect(() => {
    if (actionType !== "browser" || url.trim().length > 0) {
      return;
    }

    setUrl(DEFAULT_BROWSER_ACTION_URL);
  }, [actionType, url]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onCancel]);

  const targetValue = actionType === "browser" ? url.trim() : command.trim();
  const trimmedName = name.trim();
  const commandTitle = getCommandConfigDraftTitle({ actionType, command, name, url });
  /**
   * CDXC:CommandPanes 2026-05-16-15:08:
   * Command panes reuse tabs by action title, so the editor must block saving
   * a second action with the same project title before native state receives an
   * ambiguous command-pane owner.
   */
  const hasDuplicateTitle = existingCommands.some(
    (commandButton) =>
      commandButton.commandId !== draft.commandId &&
      getCommandConfigTitleKey(getCommandConfigButtonTitle(commandButton)) ===
        getCommandConfigTitleKey(commandTitle),
  );
  const isSaveDisabled = targetValue.length === 0 || hasDuplicateTitle;
  const description =
    actionType === "browser"
      ? "This action opens the URL in a VS Code browser tab. The tab is detected and shown in the Browsers group."
      : "This action opens a new VS Code panel terminal each time it runs.";

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={isOpen}
    >
      <DialogContent className="ghostex-settings-shadcn dark command-config-modal-shadcn">
        <DialogHeader>
          <DialogTitle className="text-xl">Configure action</DialogTitle>
          <DialogDescription className="text-sm">{description}</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-6">
          {isActionTypeLocked ? null : (
            <Field className="gap-2.5">
              <FieldContent>
                <FieldTitle>
                  <FieldLabel className="text-sm" htmlFor={actionTypeId}>
                    Type
                  </FieldLabel>
                </FieldTitle>
              </FieldContent>
              <Select
                onValueChange={(value) => setActionType(value === "browser" ? "browser" : "terminal")}
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
          <Field className="gap-2.5" data-invalid={hasDuplicateTitle || undefined}>
            <FieldContent>
              <FieldTitle>
                <FieldLabel className="text-sm" htmlFor={nameId}>
                  Text
                </FieldLabel>
              </FieldTitle>
            </FieldContent>
            <Input
              autoFocus
              className="h-10 px-3 text-sm md:text-sm"
              aria-invalid={hasDuplicateTitle || undefined}
              id={nameId}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={actionType === "browser" ? "Docs" : "Dev"}
              value={name}
            />
            {hasDuplicateTitle ? (
              <FieldDescription className="text-sm">
                Another action already uses this title.
              </FieldDescription>
            ) : null}
          </Field>
          <CommandIconPicker
            icon={icon}
            iconColor={iconColor}
            onIconChange={setIcon}
            onIconColorChange={setIconColor}
          />
          {actionType === "browser" ? (
            <Field className="gap-2.5">
              <FieldContent>
                <FieldTitle>
                  <FieldLabel className="text-sm" htmlFor={urlId}>
                    URL
                  </FieldLabel>
                </FieldTitle>
              </FieldContent>
              <textarea
                className="command-config-textarea-shadcn"
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
                  <FieldTitle>
                    <FieldLabel className="text-sm" htmlFor={commandId}>
                      Command
                    </FieldLabel>
                  </FieldTitle>
                </FieldContent>
                <textarea
                  className="command-config-textarea-shadcn"
                  id={commandId}
                  onChange={(event) => setCommand(event.currentTarget.value)}
                  placeholder="vp dev"
                  rows={3}
                  value={command}
                />
              </Field>
              <Field className="items-center justify-between" orientation="horizontal">
                <FieldContent>
                  <FieldLabel className="text-sm" htmlFor={checkboxId}>
                    Close terminal after the command finishes
                  </FieldLabel>
                </FieldContent>
                <Switch
                  checked={closeTerminalOnExit}
                  id={checkboxId}
                  onCheckedChange={setCloseTerminalOnExit}
                />
              </Field>
              <Field className="items-center justify-between" orientation="horizontal">
                <FieldContent>
                  <FieldLabel className="text-sm" htmlFor={soundCheckboxId}>
                    Play completion sound
                  </FieldLabel>
                </FieldContent>
                <Switch
                  checked={playCompletionSound}
                  id={soundCheckboxId}
                  onCheckedChange={setPlayCompletionSound}
                />
              </Field>
            </>
          )}
          <Field className="items-center justify-between" orientation="horizontal">
            <FieldContent>
              <FieldLabel className="text-sm" htmlFor={globalCheckboxId}>
                Show this action in every ghostex project
              </FieldLabel>
            </FieldContent>
            <Switch
              checked={isGlobal}
              id={globalCheckboxId}
              onCheckedChange={setIsGlobal}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          {onDelete && draft.commandId ? (
            <Button
              className="mr-auto"
              onClick={() =>
                onDelete({
                  actionType,
                  closeTerminalOnExit: actionType === "terminal" ? closeTerminalOnExit : false,
                  command: actionType === "terminal" ? command.trim() : undefined,
                  commandId: draft.commandId,
                  icon,
                  iconColor,
                  isGlobal,
                  name: trimmedName,
                  playCompletionSound: actionType === "terminal" ? playCompletionSound : false,
                  url: actionType === "browser" ? url.trim() : undefined,
                })
              }
              type="button"
              variant="destructive"
            >
              <IconTrash aria-hidden="true" data-icon="inline-start" />
              Delete
            </Button>
          ) : null}
          <Button onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSaveDisabled}
            onClick={() =>
              onSave({
                actionType,
                closeTerminalOnExit: actionType === "terminal" ? closeTerminalOnExit : false,
                command: actionType === "terminal" ? command.trim() : undefined,
                commandId: draft.commandId,
                icon,
                iconColor,
                isGlobal,
                name: trimmedName,
                playCompletionSound: actionType === "terminal" ? playCompletionSound : false,
                url: actionType === "browser" ? url.trim() : undefined,
              })
            }
            type="button"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getCommandConfigDraftTitle({
  actionType,
  command,
  name,
  url,
}: {
  actionType: SidebarActionType;
  command: string;
  name: string;
  url: string;
}): string {
  const normalizedName = normalizeCommandConfigTitle(name);
  if (normalizedName) {
    return normalizedName;
  }
  const target = normalizeCommandConfigTitle(actionType === "browser" ? url : command);
  return target?.slice(0, 20) ?? "";
}

function getCommandConfigButtonTitle(command: SidebarCommandButton): string {
  const normalizedName = normalizeCommandConfigTitle(command.name);
  if (normalizedName) {
    return normalizedName;
  }
  const target = normalizeCommandConfigTitle(command.command ?? command.url);
  return target?.slice(0, 20) ?? "";
}

function getCommandConfigTitleKey(value: string | undefined): string {
  return normalizeCommandConfigTitle(value)?.toLocaleLowerCase() ?? "";
}

function normalizeCommandConfigTitle(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : undefined;
}
