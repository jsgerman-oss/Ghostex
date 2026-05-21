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
import {
  type AgentAcceptAllMode,
  supportsAgentAcceptAll,
} from "../shared/sidebar-agent-accept-all";
import {
  DEFAULT_SIDEBAR_AGENTS,
  getDefaultSidebarAgentByIcon,
  type SidebarAgentIcon,
} from "../shared/sidebar-agents";

export type AgentConfigDraft = {
  acceptAllMode?: AgentAcceptAllMode;
  agentId?: string;
  command: string;
  icon?: SidebarAgentIcon;
  name: string;
};

export type AgentConfigModalProps = {
  draft: AgentConfigDraft;
  isOpen: boolean;
  onCancel: () => void;
  onSave: (draft: AgentConfigDraft) => void;
};

/**
 * CDXC:AppModals 2026-05-08-09:00
 * Reference-mode agent configuration uses the shared shadcn dialog stack so
 * native and web modal hosts render consistent focus management, sizing, and
 * close behavior.
 */
export function AgentConfigModal({ draft, isOpen, onCancel, onSave }: AgentConfigModalProps) {
  const [acceptAllMode, setAcceptAllMode] = useState<AgentAcceptAllMode>(draft.acceptAllMode ?? "inherit");
  const [command, setCommand] = useState(draft.command);
  const [icon, setIcon] = useState<SidebarAgentIcon | "custom">(draft.icon ?? "custom");
  const [name, setName] = useState(draft.name);
  const acceptAllModeId = useId();
  const agentTypeId = useId();
  const commandId = useId();
  const nameId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setAcceptAllMode(draft.acceptAllMode ?? "inherit");
    setCommand(draft.command);
    setIcon(draft.icon ?? "custom");
    setName(draft.name);
  }, [draft, isOpen]);

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

  const isSaveDisabled = name.trim().length === 0 || command.trim().length === 0;
  const resolvedAgentId = draft.agentId ?? getDefaultSidebarAgentByIcon(icon === "custom" ? undefined : icon)?.agentId ?? "";
  const acceptAllSupported = supportsAgentAcceptAll(resolvedAgentId, icon === "custom" ? undefined : icon);

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
          <DialogTitle className="text-xl">Configure agent</DialogTitle>
          <DialogDescription className="text-sm">
            Launches a new Ghostex session and runs this agent command in it.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-6">
          <Field className="gap-2.5">
            <FieldContent>
              <FieldTitle>
                <FieldLabel className="text-sm" htmlFor={agentTypeId}>
                  Agent type
                </FieldLabel>
              </FieldTitle>
            </FieldContent>
            <Select
              onValueChange={(value) => {
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

                setName((previousName) => {
                  if (
                    previousName.trim().length === 0 ||
                    previousName === previousDefaultAgent?.name
                  ) {
                    return nextDefaultAgent.name;
                  }

                  return previousName;
                });
                setCommand((previousCommand) => {
                  if (
                    previousCommand.trim().length === 0 ||
                    previousCommand === previousDefaultAgent?.command
                  ) {
                    return nextDefaultAgent.command;
                  }

                  return previousCommand;
                });
              }}
              value={icon}
            >
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
              <FieldTitle>
                <FieldLabel className="text-sm" htmlFor={nameId}>
                  Name
                </FieldLabel>
              </FieldTitle>
            </FieldContent>
            <Input
              autoFocus
              className="h-10 px-3 text-sm md:text-sm"
              id={nameId}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Codex"
              value={name}
            />
          </Field>
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
              placeholder="codex"
              rows={3}
              value={command}
            />
          </Field>
          <Field className="gap-2.5">
            <FieldContent>
              <FieldTitle>
                <FieldLabel className="text-sm" htmlFor={acceptAllModeId}>
                  Accept All
                </FieldLabel>
              </FieldTitle>
              <FieldDescription className="text-xs text-muted-foreground">
                {acceptAllSupported
                  ? "Inherit uses the global Agents setting. Accept All appends this CLI's permission-bypass flag at launch without changing the stored command."
                  : "This agent CLI does not expose a supported Accept All flag in Ghostex."}
              </FieldDescription>
            </FieldContent>
            <Select
              disabled={!acceptAllSupported}
              onValueChange={(value) => setAcceptAllMode(value as AgentAcceptAllMode)}
              value={acceptAllMode}
            >
              <SelectTrigger className="h-10 w-full px-3 text-sm" id={acceptAllModeId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="inherit">Inherit global setting</SelectItem>
                  <SelectItem value="enabled">Accept All</SelectItem>
                  <SelectItem value="disabled">Ask for permission</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSaveDisabled}
            onClick={() =>
              onSave({
                acceptAllMode,
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
