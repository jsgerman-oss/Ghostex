import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { normalizeSessionRenameTitle } from "../shared/session-grid-contract";

const SESSION_RENAME_GENERATE_NAME_THRESHOLD = 70;

export type SessionRenameModalProps = {
  initialTitle: string;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: (title: string, options?: { shouldGenerateTitle?: boolean }) => void;
};

/**
 * CDXC:Sidebar 2026-04-26-18:19
 * Session-card renaming must happen inside the sidebar instead of delegating to
 * VS Code's input box, while still submitting through the existing
 * renameSession message so controller-side title generation and Agent CLI sync
 * behavior remain exactly the same.
 */
export function SessionRenameModal({
  initialTitle,
  isOpen,
  onCancel,
  onConfirm,
}: SessionRenameModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setTitle(initialTitle);
  }, [initialTitle, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const trimmedTitle = title.trim();
  const directRenameTitle = normalizeSessionRenameTitle(title);
  /**
   * CDXC:SidebarRename 2026-05-09-17:25
   * Long pasted rename text must stay in the input so the user can edit or
   * cancel it. Once the entered text is longer than 70 characters, Enter
   * becomes a Generate Name submit and explicitly asks the controller to
   * summarize from that text instead of applying it verbatim.
   */
  const canGenerateTitle = trimmedTitle.length > SESSION_RENAME_GENERATE_NAME_THRESHOLD;
  const confirmTitle = (nextTitle: string, shouldGenerateTitle: boolean) => {
    const normalizedTitle = shouldGenerateTitle
      ? nextTitle.trim()
      : normalizeSessionRenameTitle(nextTitle);
    if (!normalizedTitle) {
      return;
    }

    onConfirm(normalizedTitle, shouldGenerateTitle ? { shouldGenerateTitle: true } : undefined);
  };

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    confirmTitle(title, canGenerateTitle);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }
    if (event.shiftKey) {
      return;
    }

    /**
     * CDXC:SidebarRename 2026-05-09-17:25
     * The native full-window modal host must preserve the reference rename
     * behavior where pressing Enter immediately submits the existing
     * renameSession command path. Bind Enter at the input so WKWebView
     * form-submission differences cannot leave the modal inert, but route
     * entered text longer than 70 characters to Generate Name.
     */
    event.preventDefault();
    event.stopPropagation();
    confirmTitle(event.currentTarget.value, canGenerateTitle);
  };

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
        className="command-config-modal-shadcn session-rename-modal-shadcn font-sans"
        showCloseButton={false}
      >
        <form className="session-rename-form" onSubmit={submitRename}>
          <DialogHeader>
            <DialogTitle className="text-xl">Rename Session</DialogTitle>
            <DialogDescription>
              Rename directly or generate a name from longer text.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="session-rename-field-group">
            <Field>
              <FieldLabel htmlFor={inputId}>Session name</FieldLabel>
              <Textarea
                aria-label="Session Name"
                autoFocus
                className="session-rename-textarea"
                id={inputId}
                onChange={(event) => setTitle(event.currentTarget.value)}
                onKeyDown={handleInputKeyDown}
                ref={inputRef}
                value={title}
              />
              <FieldDescription>
                {trimmedTitle.length} / {SESSION_RENAME_GENERATE_NAME_THRESHOLD} characters
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!directRenameTitle}
              onClick={() => confirmTitle(title, false)}
              type="button"
              variant="secondary"
            >
              Rename
            </Button>
            <Button
              disabled={!canGenerateTitle}
              onClick={() => confirmTitle(title, true)}
              type="button"
            >
              Generate Name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
