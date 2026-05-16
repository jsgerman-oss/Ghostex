import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsDiagonal2,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconEdit,
  IconKeyboard,
  IconLayoutDashboard,
  IconLayoutSidebar,
  IconMoon,
  IconPlayerPlay,
  IconPlus,
  IconSettings,
  IconTerminal2,
} from "@tabler/icons-react";
import { useMemo } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  DEFAULT_BROWSER_ACTION_URL,
  type SidebarCommandButton,
} from "../shared/sidebar-commands";
import {
  DEFAULT_SIDEBAR_COMMAND_ICON,
  DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
} from "../shared/sidebar-command-icons";
import {
  GHOSTEX_HOTKEY_DEFINITIONS,
  normalizeHotkeyText,
  normalizeghostexHotkeySettings,
  type ghostexHotkeyDefinition,
  type ghostexHotkeySettings,
} from "../shared/ghostex-hotkeys";
import { openAppModal } from "./app-modal-host-bridge";
import type { CommandConfigDraft } from "./command-config-modal";
import { SidebarCommandIconGlyph } from "./sidebar-command-icon";
import { formatSidebarHotkeyLabel } from "./hotkey-label";
import type { WebviewApi } from "./webview-api";

type CommandPaletteProps = {
  commands: readonly SidebarCommandButton[];
  hotkeys?: ghostexHotkeySettings;
  isOpen: boolean;
  onBrowserCommandRun?: () => void;
  onOpenChange: (isOpen: boolean) => void;
  petOverlayEnabled?: boolean;
  vscode: WebviewApi;
};

type BuiltInPaletteCommand =
  | {
      definition: ghostexHotkeyDefinition;
      hotkey: string;
      kind: "hotkey";
      searchText: string;
      title: string;
    }
  | {
      hotkey: "";
      kind: "pet";
      searchText: string;
      title: string;
    };

export function CommandPalette({
  commands,
  hotkeys,
  isOpen,
  onBrowserCommandRun,
  onOpenChange,
  petOverlayEnabled = false,
  vscode,
}: CommandPaletteProps) {
  const normalizedHotkeys = useMemo(() => normalizeghostexHotkeySettings(hotkeys), [hotkeys]);
  const builtInCommands = useMemo(
    () => {
      const hotkeyCommands: BuiltInPaletteCommand[] = GHOSTEX_HOTKEY_DEFINITIONS.filter(
        (definition) => definition.id !== "openCommandPalette",
      ).map((definition) => {
        const hotkey = normalizeHotkeyText(
          normalizedHotkeys[definition.id] ?? definition.defaultKey,
        );
        return {
          definition,
          hotkey,
          kind: "hotkey",
          searchText: `${definition.title} ${definition.description} ${hotkey}`,
          title: definition.title,
        };
      });
      const petTitle = petOverlayEnabled ? "Sleep Pet" : "Wake Pet";
      const petCommand: BuiltInPaletteCommand = {
        hotkey: "",
        kind: "pet",
        searchText: `${petTitle} pet overlay ${petOverlayEnabled ? "hide sleep" : "show wake"}`,
        title: petTitle,
      };
      return [...hotkeyCommands, petCommand];
    },
    [normalizedHotkeys, petOverlayEnabled],
  );
  const configuredCommands = useMemo(
    () => commands.filter((command) => isRunnableOrConfigurableCommand(command)),
    [commands],
  );

  const runBuiltInCommand = (command: BuiltInPaletteCommand) => {
    if (command.kind === "pet") {
      onOpenChange(false);
      vscode.postMessage({
        type: "togglePetOverlay",
      });
      return;
    }
    onOpenChange(false);
    vscode.postMessage({
      actionId: command.definition.id,
      type: "runGhostexHotkeyAction",
    });
  };

  const runProjectCommand = (command: SidebarCommandButton) => {
    if (!isConfigured(command)) {
      onOpenChange(false);
      openAppModal({
        commandDraft: createCommandPaletteDraft(command),
        modal: "commandConfig",
        type: "open",
      });
      return;
    }

    if (command.actionType === "browser") {
      onBrowserCommandRun?.();
    }
    onOpenChange(false);
    vscode.postMessage({
      commandId: command.commandId,
      type: "runSidebarCommand",
    });
  };

  return (
    <CommandDialog
      className="ghostex-settings-shadcn ghostex-command-palette-dialog top-1/2 -translate-y-1/2"
      description="Search Ghostex commands and project actions."
      open={isOpen}
      showCloseButton={false}
      title="Command Palette"
      onOpenChange={onOpenChange}
    >
      {/* CDXC:CommandPalette 2026-05-15-20:38:
          Cmd+K opens a shadcn Base-style command palette that lists the
          current Ghostex hotkey actions plus the project Actions available
          from the active sidebar context. Hotkeys are right-aligned with
          CommandShortcut so discoverability stays inside the command surface.

          CDXC:CommandPalette 2026-05-16-08:18:
          The palette should not list itself as a command, Ghostex built-ins
          should be single-line rows without descriptions, and the pet row must
          reflect the current wake/sleep state before routing through the shared
          settings-owned pet toggle. */}
      <Command>
        <CommandInput placeholder="Search Ghostex commands..." />
        <CommandList className="ghostex-command-palette-list">
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandGroup heading="Ghostex">
            {builtInCommands.map((command) => (
              <CommandItem
                key={command.kind === "hotkey" ? command.definition.id : "togglePetOverlay"}
                value={command.searchText}
                onSelect={() => runBuiltInCommand(command)}
              >
                <BuiltInCommandIcon command={command} />
                <span className="ghostex-command-palette-copy">
                  <span className="ghostex-command-palette-title">{command.title}</span>
                </span>
                <CommandShortcut>
                  {command.hotkey ? formatSidebarHotkeyLabel(command.hotkey) : "No hotkey"}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          {configuredCommands.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Project Actions">
                {configuredCommands.map((command) => (
                  <CommandItem
                    key={command.commandId}
                    value={`${getCommandTitle(command)} ${getCommandDescription(command)}`}
                    onSelect={() => runProjectCommand(command)}
                  >
                    <SidebarCommandIconGlyph
                      color={command.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR}
                      icon={command.icon ?? DEFAULT_SIDEBAR_COMMAND_ICON}
                      stroke={1.8}
                    />
                    <span className="ghostex-command-palette-copy">
                      <span className="ghostex-command-palette-title">
                        {getCommandTitle(command)}
                      </span>
                      <span className="ghostex-command-palette-description">
                        {getCommandDescription(command)}
                      </span>
                    </span>
                    <CommandShortcut>No hotkey</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function BuiltInCommandIcon({ command }: { command: BuiltInPaletteCommand }) {
  if (command.kind === "pet") {
    return command.title === "Sleep Pet" ? (
      <IconMoon aria-hidden="true" />
    ) : (
      <IconPlayerPlay aria-hidden="true" />
    );
  }

  const action = command.definition.action;
  if (action.kind === "createSession") {
    return <IconPlus aria-hidden="true" />;
  }
  if (action.kind === "openCommandsPanel") {
    return <IconTerminal2 aria-hidden="true" />;
  }
  if (action.kind === "openSettings") {
    return <IconSettings aria-hidden="true" />;
  }
  if (action.kind === "moveSidebar") {
    return <IconLayoutSidebar aria-hidden="true" />;
  }
  if (action.kind === "renameActiveSession") {
    return <IconEdit aria-hidden="true" />;
  }
  if (action.kind === "focusAdjacentGroup") {
    return action.direction < 0 ? (
      <IconChevronLeft aria-hidden="true" />
    ) : (
      <IconChevronRight aria-hidden="true" />
    );
  }
  if (action.kind === "focusDirection") {
    return getFocusDirectionIcon(action.direction);
  }
  if (action.kind === "splitFocusedPane") {
    return <IconArrowsDiagonal2 aria-hidden="true" />;
  }
  if (action.kind === "setViewMode") {
    return <IconLayoutDashboard aria-hidden="true" />;
  }
  return <IconKeyboard aria-hidden="true" />;
}

function getFocusDirectionIcon(direction: "down" | "left" | "right" | "up") {
  if (direction === "up") {
    return <IconChevronUp aria-hidden="true" />;
  }
  if (direction === "right") {
    return <IconArrowRight aria-hidden="true" />;
  }
  if (direction === "down") {
    return <IconChevronDown aria-hidden="true" />;
  }
  return <IconArrowLeft aria-hidden="true" />;
}

function createCommandPaletteDraft(command: SidebarCommandButton): CommandConfigDraft {
  return {
    actionType: command.actionType,
    closeTerminalOnExit: command.closeTerminalOnExit,
    command: command.command ?? (command.actionType === "terminal" ? "" : undefined),
    commandId: command.commandId,
    icon: command.icon ?? DEFAULT_SIDEBAR_COMMAND_ICON,
    iconColor: command.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
    isGlobal: command.isGlobal === true,
    name: command.name,
    playCompletionSound: command.playCompletionSound,
    url: command.url ?? (command.actionType === "browser" ? DEFAULT_BROWSER_ACTION_URL : undefined),
  };
}

function isRunnableOrConfigurableCommand(command: SidebarCommandButton): boolean {
  return command.name.trim().length > 0 || command.icon !== undefined;
}

function isConfigured(command: SidebarCommandButton): boolean {
  return command.actionType === "browser" ? Boolean(command.url) : Boolean(command.command);
}

function getCommandTitle(command: SidebarCommandButton): string {
  const name = command.name.trim();
  if (name) {
    return name;
  }
  return command.actionType === "browser" ? "Untitled Webpage" : "Untitled Action";
}

function getCommandDescription(command: SidebarCommandButton): string {
  const target = getCommandTarget(command);
  const typeLabel = command.actionType === "browser" ? "Browser" : "Terminal";
  if (!target) {
    return `${typeLabel} - Not configured`;
  }
  return `${typeLabel} - ${target}`;
}

function getCommandTarget(command: SidebarCommandButton): string | undefined {
  const target = command.actionType === "browser" ? command.url?.trim() : command.command?.trim();
  if (!target) {
    return undefined;
  }
  return target.split("\n")[0] || undefined;
}
