import { IconPlus, IconX } from "@tabler/icons-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import {
  DEFAULT_BROWSER_ACTION_URL,
  type SidebarActionType,
  type SidebarCommandButton,
} from "../shared/sidebar-commands";
import {
  DEFAULT_SIDEBAR_COMMAND_ICON,
  DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
} from "../shared/sidebar-command-icons";
import { SidebarCommandIconGlyph } from "./sidebar-command-icon";
import { CommandConfigModal, type CommandConfigDraft } from "./command-config-modal";
import { useSidebarStore } from "./sidebar-store";
import type { WebviewApi } from "./webview-api";

type CommandEditorState = {
  draft: CommandConfigDraft;
  lockedActionType?: SidebarActionType;
};

export type ConfigureActionsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  vscode: WebviewApi;
};

export function ConfigureActionsModal({ isOpen, onClose, vscode }: ConfigureActionsModalProps) {
  const theme = useSidebarStore((state) => state.hud.theme);
  const commands = useSidebarStore((state) => state.hud.commands);
  const [editorState, setEditorState] = useState<CommandEditorState>();

  useEffect(() => {
    if (!isOpen) {
      setEditorState(undefined);
    }
  }, [isOpen]);

  const openCreateCommandEditor = (actionType: SidebarActionType) => {
    setEditorState({
      draft: createCommandDraft(actionType),
      lockedActionType: actionType,
    });
  };

  const openCommandEditor = (command: SidebarCommandButton) => {
    setEditorState({
      draft: createCommandDraftFromButton(command),
    });
  };

  const saveCommand = (draft: CommandConfigDraft) => {
    vscode.postMessage({
      actionType: draft.actionType,
      closeTerminalOnExit: draft.closeTerminalOnExit,
      command: draft.command,
      commandId: draft.commandId,
      icon: draft.icon,
      iconColor: draft.iconColor,
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

    vscode.postMessage({
      commandId: draft.commandId,
      type: "deleteSidebarCommand",
    });
    setEditorState(undefined);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editorState === undefined) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [editorState, isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const isEditorOpen = editorState !== undefined;

  /**
   * CDXC:SidebarActions 2026-05-08-10:17
   * Configure Actions is a compact management dialog, not another sidebar.
   * Render readable action rows for management, but hide that management modal
   * while the action editor is open so users never see stacked Configure
   * Actions and Configure action dialogs for one edit flow.
   */
  return createPortal(
    <>
      {!isEditorOpen ? (
        <div className="confirm-modal-root scroll-mask-y" role="presentation">
          <button className="confirm-modal-backdrop" onClick={onClose} type="button" />
          <div
            aria-label="Configure Actions"
            aria-modal="true"
            className="confirm-modal configure-actions-modal"
            data-sidebar-theme={theme}
            role="dialog"
          >
            <button
              aria-label="Close Configure Actions"
              className="confirm-modal-close-button"
              onClick={onClose}
              type="button"
            >
              <IconX aria-hidden="true" className="toolbar-tabler-icon" stroke={1.8} />
            </button>
            <div className="confirm-modal-header confirm-modal-header-with-close">
              <div className="confirm-modal-title">Configure Actions</div>
            </div>
            <div className="configure-actions-toolbar">
              <button
                className="secondary configure-actions-add-button"
                onClick={() => openCreateCommandEditor("terminal")}
                type="button"
              >
                <IconPlus aria-hidden="true" size={16} stroke={1.8} />
                Add Terminal Action
              </button>
              <button
                className="secondary configure-actions-add-button"
                onClick={() => openCreateCommandEditor("browser")}
                type="button"
              >
                <IconPlus aria-hidden="true" size={16} stroke={1.8} />
                Add Browser Action
              </button>
            </div>
            <div className="configure-actions-list scroll-mask-y">
              {commands.length > 0 ? (
                commands.map((command) => (
                  <button
                    className="configure-actions-list-item"
                    key={command.commandId}
                    onClick={() => openCommandEditor(command)}
                    type="button"
                  >
                    <span aria-hidden="true" className="configure-actions-list-icon">
                      <ConfigureActionIcon command={command} />
                    </span>
                    <span className="configure-actions-list-copy">
                      <span className="configure-actions-list-title">
                        {getActionTitle(command)}
                      </span>
                      <span className="configure-actions-list-meta">{getActionMeta(command)}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="configure-actions-empty-state">No actions configured.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <CommandConfigModal
        draft={editorState?.draft ?? createCommandDraft("terminal")}
        existingCommands={commands}
        isOpen={isEditorOpen}
        lockedActionType={editorState?.lockedActionType}
        onCancel={() => setEditorState(undefined)}
        onDelete={deleteCommand}
        onSave={saveCommand}
      />
    </>,
    document.body,
  );
}

function ConfigureActionIcon({ command }: { command: SidebarCommandButton }) {
  return (
    <SidebarCommandIconGlyph
      color={command.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR}
      icon={command.icon ?? DEFAULT_SIDEBAR_COMMAND_ICON}
      size={16}
      stroke={1.8}
    />
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
    return `${typeLabel} · Not configured`;
  }

  return `${typeLabel} · ${target}`;
}

function getActionTarget(command: SidebarCommandButton): string | undefined {
  const target = command.actionType === "browser" ? command.url?.trim() : command.command?.trim();
  if (!target) {
    return undefined;
  }

  return target.split("\n")[0] || undefined;
}

function createCommandDraft(actionType: SidebarActionType): CommandConfigDraft {
  return {
    actionType,
    closeTerminalOnExit: false,
    command: actionType === "terminal" ? "" : undefined,
    commandId: undefined,
    icon: DEFAULT_SIDEBAR_COMMAND_ICON,
    iconColor: DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
    name: "",
    playCompletionSound: actionType === "terminal",
    url: actionType === "browser" ? DEFAULT_BROWSER_ACTION_URL : undefined,
  };
}

function createCommandDraftFromButton(command: SidebarCommandButton): CommandConfigDraft {
  return {
    actionType: command.actionType,
    closeTerminalOnExit: command.closeTerminalOnExit,
    command: command.command,
    commandId: command.commandId,
    icon: command.icon ?? DEFAULT_SIDEBAR_COMMAND_ICON,
    iconColor: command.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
    name: command.name,
    playCompletionSound: command.playCompletionSound,
    url: command.url,
  };
}
