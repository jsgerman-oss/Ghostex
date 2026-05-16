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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export type FindPreviousSessionModalProps = {
  initialQuery?: string;
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: (query: string) => void;
};

/**
 * CDXC:PreviousSessions 2026-04-28-16:18
 * Command-triggered previous-session search must use the same React modal
 * presentation as sidebar dialogs. Do not delegate missing search text to
 * VS Code's input box.
 */
export function FindPreviousSessionModal({
  initialQuery,
  isOpen,
  onCancel,
  onConfirm,
}: FindPreviousSessionModalProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setQuery(initialQuery ?? "");
  }, [initialQuery, isOpen]);

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

  const normalizedQuery = query.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedQuery) {
      return;
    }
    onConfirm(normalizedQuery);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }
    if (event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.value.trim()) {
      return;
    }
    onConfirm(event.currentTarget.value.trim());
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
        <form className="session-rename-form" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="text-xl">Find Previous Session</DialogTitle>
            <DialogDescription>
              Describe what you remember from the session.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="session-rename-field-group">
            <Field>
              {/*
               * CDXC:PreviousSessions 2026-05-16-12:46:
               * Find Previous Session must share Rename Session's shadcn dialog,
               * textarea, field, and action styling so the prompt modal no
               * longer mixes legacy confirm-modal controls with the newer
               * rename modal chrome.
               */}
              <FieldLabel htmlFor={inputId}>Search</FieldLabel>
              <Textarea
                aria-label="Search"
                autoFocus
                className="session-rename-textarea"
                id={inputId}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="e.g. full reload should not update last active"
                ref={inputRef}
                value={query}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={!normalizedQuery} type="submit">
              Find Session
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
