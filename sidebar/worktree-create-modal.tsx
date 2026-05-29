import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { IconPhotoPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trimPromptEditorTrailingSpaces } from "../shared/prompt-editor-text";
import type { SidebarAgentButton } from "../shared/sidebar-agents";
import { postAppModalHostMessage } from "./app-modal-host-bridge";

export type WorktreeCreateModalProps = {
  agents: SidebarAgentButton[];
  defaultAgentId?: string;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: (draft: { agentId: string; prompt: string }) => void;
  projectName?: string;
};

export function WorktreeCreateModal({
  agents,
  defaultAgentId,
  isOpen,
  onCancel,
  onConfirm,
  projectName,
}: WorktreeCreateModalProps) {
  const promptId = useId();
  const agentId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const commandAgents = useMemo(
    () => agents.filter((agent) => agent.command?.trim()),
    [agents],
  );
  const [prompt, setPrompt] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(commandAgents[0]?.agentId ?? "");
  const [imageCount, setImageCount] = useState(0);

  /**
   * CDXC:Worktrees 2026-05-18-23:07:
   * New worktrees need an agent plus a first prompt. Image paste and native file picking insert Markdown links into that prompt so visual context travels with the first agent instruction.
   *
   * CDXC:PromptAgents 2026-05-28-07:15:
   * The first selectable worktree agent should start from Settings' default
   * prompt agent when that agent is visible and configured, while preserving
   * any valid in-modal selection during the current modal session.
   *
   * CDXC:Worktrees 2026-05-28-07:47:
   * The first prompt is prompt-editor text. Plain-text paste and submit should
   * remove spaces at line ends before the prompt is sent to the selected agent,
   * while image paste keeps inserting durable Markdown links.
   *
   * CDXC:AppModals 2026-05-29-19:44:
   * Session attention/activity can refresh app-modal props while a user is
   * typing. The New Worktree draft is initialized only when the modal opens;
   * later agent-list updates may repair an invalid selection but must not clear
   * the prompt, images, or a still-valid selected agent.
   */
  const hasInitializedOpenDraftRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      hasInitializedOpenDraftRef.current = false;
      return;
    }
    if (hasInitializedOpenDraftRef.current) {
      return;
    }
    hasInitializedOpenDraftRef.current = true;

    setPrompt("");
    setImageCount(0);
    setSelectedAgentId(resolveInitialWorktreeAgentId(commandAgents, defaultAgentId));
  }, [commandAgents, defaultAgentId, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedAgentId((currentAgentId) =>
      commandAgents.some((agent) => agent.agentId === currentAgentId)
        ? currentAgentId
        : resolveInitialWorktreeAgentId(commandAgents, defaultAgentId),
    );
  }, [commandAgents, defaultAgentId, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen]);

  const normalizedPrompt = trimPromptEditorTrailingSpaces(prompt);
  const trimmedPrompt = normalizedPrompt.trim();
  const canCreate = Boolean(trimmedPrompt && selectedAgentId);

  const insertImageLinks = (files: readonly File[]) => {
    if (files.length === 0) {
      return;
    }

    const links = files.map((file, index) => {
      const path =
        (file as File & { path?: string }).path?.trim() ||
        file.webkitRelativePath?.trim() ||
        file.name;
      return `[Image #${imageCount + index + 1}](${path})`;
    });
    setImageCount((count) => count + files.length);
    insertPromptText(
      `${prompt.endsWith("\n") || prompt.length === 0 ? "" : "\n"}${links.join("\n")}\n`,
    );
  };

  const insertImagePaths = (paths: readonly string[]) => {
    if (paths.length === 0) {
      return;
    }
    const links = paths.map((path, index) => `[Image #${imageCount + index + 1}](${path})`);
    setImageCount((count) => count + paths.length);
    insertPromptText(
      `${prompt.endsWith("\n") || prompt.length === 0 ? "" : "\n"}${links.join("\n")}\n`,
    );
  };

  const insertPromptText = (text: string) => {
    const textarea = inputRef.current;
    if (!textarea) {
      setPrompt((current) => `${current}${text}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextPrompt = `${prompt.slice(0, start)}${text}${prompt.slice(end)}`;
    setPrompt(nextPrompt);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const nextSelection = start + text.length;
      textarea.setSelectionRange(nextSelection, nextSelection);
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) {
      return;
    }
    onConfirm({ agentId: selectedAgentId, prompt: trimmedPrompt });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (canCreate) {
      onConfirm({ agentId: selectedAgentId, prompt: trimmedPrompt });
    }
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files).filter((file): file is File =>
      file.type.startsWith("image/"),
    );
    if (imageFiles.length > 0) {
      event.preventDefault();
      insertImageLinks(imageFiles);
      return;
    }

    const pastedText = event.clipboardData.getData("text/plain");
    const trimmedText = trimPromptEditorTrailingSpaces(pastedText);
    if (!pastedText || trimmedText === pastedText) {
      return;
    }
    event.preventDefault();
    insertPromptText(trimmedText);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePickedImages = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail;
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }
      if (message.type !== "worktreeImageFilesPicked") {
        return;
      }
      const candidate = message as { paths?: unknown };
      const paths = Array.isArray(candidate.paths)
        ? candidate.paths.filter(
            (path): path is string => typeof path === "string" && path.trim().length > 0,
          )
        : [];
      insertImagePaths(paths);
    };

    window.addEventListener("ghostex-app-modal-host-message", handlePickedImages);
    return () => {
      window.removeEventListener("ghostex-app-modal-host-message", handlePickedImages);
    };
  });

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        className="command-config-modal-shadcn worktree-create-modal-shadcn font-sans"
        showCloseButton={false}
      >
        <form className="session-rename-form worktree-create-form" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="text-xl">New Worktree</DialogTitle>
            <DialogDescription>
              Start a worktree from {projectName?.trim() || "this project"}.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="session-rename-field-group">
            <Field>
              <FieldLabel htmlFor={agentId}>Agent</FieldLabel>
              <Select onValueChange={setSelectedAgentId} value={selectedAgentId}>
                <SelectTrigger
                  aria-label="Agent"
                  className="worktree-create-agent-select"
                  id={agentId}
                >
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {commandAgents.map((agent) => (
                      <SelectItem key={agent.agentId} value={agent.agentId}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={promptId}>First prompt</FieldLabel>
              <Textarea
                aria-label="First prompt"
                autoFocus
                id={promptId}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Describe the worktree task"
                ref={inputRef}
                value={prompt}
              />
              <FieldDescription>
                Paste images or pick files to insert image links into the prompt.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              onClick={() =>
                postAppModalHostMessage(
                  { type: "pickWorktreeImages" },
                  "AppModals:pickWorktreeImages",
                )
              }
              type="button"
              variant="secondary"
            >
              <IconPhotoPlus aria-hidden="true" data-icon="inline-start" />
              Add Images
            </Button>
            <Button disabled={!canCreate} type="submit">
              New Worktree
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function resolveInitialWorktreeAgentId(
  commandAgents: SidebarAgentButton[],
  defaultAgentId?: string,
): string {
  return (
    commandAgents.find((agent) => agent.agentId === defaultAgentId)?.agentId ??
    commandAgents[0]?.agentId ??
    ""
  );
}
