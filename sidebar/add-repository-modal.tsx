import { IconFolderOpen } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { parseRepositoryCloneInput } from "../shared/repository-clone";
import { postAppModalHostMessage } from "./app-modal-host-bridge";

const ADD_REPOSITORY_LAST_LOCATION_STORAGE_KEY = "ghostex.addRepository.lastLocation";

type AddRepositoryCloneRequest = {
  folderPath: string;
  repositoryInput: string;
  requestId: string;
};

export type AddRepositoryModalProps = {
  isOpen: boolean;
  onCancel: () => void;
  onClone: (request: AddRepositoryCloneRequest) => void;
  onCloneSuccess: () => void;
};

type RepositoryFolderPickedMessage = {
  path?: unknown;
  type: "repositoryFolderPicked";
};

type RepositoryCloneResultMessage = {
  error?: unknown;
  ok: boolean;
  projectPath?: unknown;
  requestId: string;
  type: "repositoryCloneResult";
};

/**
 * CDXC:AddRepository 2026-05-29-11:45:
 * Projects needs a full-window Clone Repository dialog next to Add Project. Keep
 * the visual shell aligned with Rename Session, accept flexible repository
 * paste formats, remember the last clone parent folder across the app, and keep
 * errors in the modal until a clone succeeds.
 */
export function AddRepositoryModal({
  isOpen,
  onCancel,
  onClone,
  onCloneSuccess,
}: AddRepositoryModalProps) {
  const repositoryId = useId();
  const folderId = useId();
  const repositoryRef = useRef<HTMLInputElement>(null);
  const activeRequestIdRef = useRef<string | undefined>(undefined);
  const [repositoryInput, setRepositoryInput] = useState("");
  const [folderPath, setFolderPath] = useState(readLastRepositoryLocation);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isCloning, setIsCloning] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setRepositoryInput("");
    setErrorMessage(undefined);
    setIsCloning(false);
    activeRequestIdRef.current = undefined;
    setFolderPath(readLastRepositoryLocation());

    const animationFrame = window.requestAnimationFrame(() => {
      repositoryRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleModalHostMessage = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail;
      if (!message || typeof message !== "object" || !("type" in message)) {
        return;
      }
      if (isRepositoryFolderPickedMessage(message)) {
        const nextPath = typeof message.path === "string" ? message.path.trim() : "";
        if (nextPath) {
          rememberLastRepositoryLocation(nextPath);
          setFolderPath(nextPath);
        }
        return;
      }
      if (!isRepositoryCloneResultMessage(message)) {
        return;
      }
      if (message.requestId !== activeRequestIdRef.current) {
        return;
      }
      activeRequestIdRef.current = undefined;
      setIsCloning(false);
      if (message.ok) {
        onCloneSuccess();
        return;
      }
      setErrorMessage(
        typeof message.error === "string" && message.error.trim()
          ? message.error.trim()
          : "Repository clone failed.",
      );
    };

    window.addEventListener("ghostex-app-modal-host-message", handleModalHostMessage);
    return () => {
      window.removeEventListener("ghostex-app-modal-host-message", handleModalHostMessage);
    };
  }, [onCloneSuccess]);

  if (!isOpen) {
    return null;
  }

  const parsedRepository = parseRepositoryCloneInput(repositoryInput);
  const hasInvalidRepositoryInput = repositoryInput.trim().length > 0 && !parsedRepository;
  const canClone = !isCloning && Boolean(parsedRepository) && folderPath.trim().length > 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(undefined);
    const normalizedFolderPath = folderPath.trim();
    if (!parsedRepository) {
      setErrorMessage("Enter a Git repository to clone.");
      return;
    }
    if (!normalizedFolderPath) {
      setErrorMessage("Choose a folder location.");
      return;
    }

    const requestId = `repository-clone-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}`;
    rememberLastRepositoryLocation(normalizedFolderPath);
    activeRequestIdRef.current = requestId;
    setIsCloning(true);
    onClone({ folderPath: normalizedFolderPath, repositoryInput, requestId });
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isCloning) {
          onCancel();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        className="command-config-modal-shadcn session-rename-modal-shadcn add-repository-modal-shadcn font-sans"
        showCloseButton={false}
      >
        <form className="session-rename-form add-repository-form" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="text-xl">Clone Repository</DialogTitle>
            <DialogDescription>Clone a Git repository and add it as a project.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="session-rename-field-group">
            <Field data-invalid={hasInvalidRepositoryInput || undefined}>
              <FieldLabel htmlFor={repositoryId}>Repository</FieldLabel>
              <Input
                aria-invalid={hasInvalidRepositoryInput || undefined}
                autoFocus
                className="h-10 px-3 text-sm md:text-sm"
                disabled={isCloning}
                id={repositoryId}
                onChange={(event) => {
                  setRepositoryInput(event.currentTarget.value);
                  setErrorMessage(undefined);
                }}
                placeholder="maddada/zehn"
                ref={repositoryRef}
                value={repositoryInput}
              />
              <FieldDescription>
                {parsedRepository?.cloneUrl ?? "Paste a GitHub shorthand, HTTPS URL, or SSH URL."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={folderId}>Folder location</FieldLabel>
              <div className="add-repository-folder-row">
                <Input
                  className="h-10 px-3 text-sm md:text-sm"
                  disabled={isCloning}
                  id={folderId}
                  onChange={(event) => {
                    setFolderPath(event.currentTarget.value);
                    setErrorMessage(undefined);
                  }}
                  value={folderPath}
                />
                <Button
                  disabled={isCloning}
                  onClick={() =>
                    postAppModalHostMessage(
                      { initialPath: folderPath.trim(), type: "pickRepositoryFolder" },
                      "AppModals:pickRepositoryFolder",
                    )
                  }
                  type="button"
                  variant="secondary"
                >
                  <IconFolderOpen aria-hidden="true" data-icon="inline-start" />
                  Choose
                </Button>
              </div>
            </Field>
            {errorMessage ? (
              <div className="add-repository-error" role="alert">
                {errorMessage}
              </div>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button disabled={isCloning} onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={!canClone} type="submit">
              {isCloning ? "Cloning..." : "Clone & Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function readLastRepositoryLocation(): string {
  const storedLocation = localStorage.getItem(ADD_REPOSITORY_LAST_LOCATION_STORAGE_KEY)?.trim();
  if (storedLocation) {
    return storedLocation;
  }
  const nativeBootstrap = (
    window as { __ghostex_NATIVE_HOST__?: { cwd?: string; homeDir?: string } }
  ).__ghostex_NATIVE_HOST__;
  return nativeBootstrap?.cwd?.trim() || nativeBootstrap?.homeDir?.trim() || "";
}

function rememberLastRepositoryLocation(path: string): void {
  localStorage.setItem(ADD_REPOSITORY_LAST_LOCATION_STORAGE_KEY, path);
}

function isRepositoryFolderPickedMessage(message: object): message is RepositoryFolderPickedMessage {
  return "type" in message && message.type === "repositoryFolderPicked";
}

function isRepositoryCloneResultMessage(message: object): message is RepositoryCloneResultMessage {
  return (
    "type" in message &&
    message.type === "repositoryCloneResult" &&
    "requestId" in message &&
    typeof message.requestId === "string" &&
    "ok" in message &&
    typeof message.ok === "boolean"
  );
}
