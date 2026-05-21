import { IconX } from "@tabler/icons-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useState } from "react";
import type { SidebarGitAction, SidebarGitChangedFile } from "../shared/sidebar-git";
import { ChangedFilesTree } from "./changed-files-tree";
import { summarizeChangedFiles } from "./changed-files-tree-utils";

export type GitCommitModalDraft = {
  action?: SidebarGitAction;
  changedFiles?: SidebarGitChangedFile[];
  confirmLabel: string;
  deleteWorktreeAfterDefault?: boolean;
  description: string;
  isWorktree?: boolean;
  requestId: string;
  showCommitMessage?: boolean;
  suggestedBody?: string;
  suggestedSubject: string;
  worktreeName?: string;
};

export type GitCommitModalProps = {
  draft: GitCommitModalDraft;
  isOpen: boolean;
  onCancel: (requestId: string) => void;
  onConfirm: (
    requestId: string,
    message: string,
    options: { deleteWorktreeAfter: boolean; filePaths?: string[] },
  ) => void;
};

export function GitCommitModal({ draft, isOpen, onCancel, onConfirm }: GitCommitModalProps) {
  const [message, setMessage] = useState(buildDraftMessage(draft));
  const [deleteWorktreeAfter, setDeleteWorktreeAfter] = useState(
    draft.deleteWorktreeAfterDefault === true,
  );
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(() => new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const descriptionId = useId();
  const titleId = useId();
  const changedFiles = draft.changedFiles ?? [];
  const showCommitMessage = draft.showCommitMessage ?? true;
  const selectedFiles = useMemo(
    () => changedFiles.filter((file) => !excludedFiles.has(file.path)),
    [changedFiles, excludedFiles],
  );
  const selectedStats = useMemo(() => summarizeChangedFiles(selectedFiles), [selectedFiles]);
  const allSelected = changedFiles.length > 0 && selectedFiles.length === changedFiles.length;
  const noneSelected = changedFiles.length > 0 && selectedFiles.length === 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMessage(buildDraftMessage(draft));
    setDeleteWorktreeAfter(draft.deleteWorktreeAfterDefault === true);
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
  }, [draft, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel(draft.requestId);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [draft.requestId, isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  const trimmedMessage = message.trim();
  const canConfirm = !showCommitMessage || (trimmedMessage.length > 0 && !noneSelected);
  const selectedFilePaths =
    changedFiles.length > 0 && selectedFiles.length !== changedFiles.length
      ? selectedFiles.map((file) => file.path)
      : undefined;

  /*
   * CDXC:Worktrees 2026-05-18-23:07:
   * The git review modal must support three worktree-specific choices: file selection, skipping the commit-message field when only push/PR is needed, and deleting the temporary worktree after a successful action.
   */
  return createPortal(
    <div className="confirm-modal-root scroll-mask-y" role="presentation">
      <button
        className="confirm-modal-backdrop"
        onClick={() => onCancel(draft.requestId)}
        type="button"
      />
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirm-modal command-config-modal git-commit-modal scroll-mask-y"
        role="dialog"
      >
        <button
          aria-label="Close suggested commit modal"
          className="confirm-modal-close-button"
          onClick={() => onCancel(draft.requestId)}
          type="button"
        >
          <IconX aria-hidden="true" className="toolbar-tabler-icon" stroke={1.8} />
        </button>
        <div className="confirm-modal-header confirm-modal-header-with-close">
          <div className="confirm-modal-title" id={titleId}>
            Review Suggested Commit
          </div>
          <div className="confirm-modal-description" id={descriptionId}>
            {draft.description}
          </div>
        </div>
        <div className="command-config-fields">
          <div className="git-commit-files-panel">
            <div className="git-commit-files-header">
              <div>
                <span className="command-config-label">Files</span>
                {isEditingFiles && changedFiles.length > 0 ? (
                  <span className="git-commit-files-selected">
                    {selectedFiles.length} of {changedFiles.length} selected
                  </span>
                ) : null}
              </div>
              {changedFiles.length > 0 ? (
                <button
                  className="git-commit-files-edit-button"
                  onClick={() => setIsEditingFiles((current) => !current)}
                  type="button"
                >
                  {isEditingFiles ? "Done" : "Edit"}
                </button>
              ) : null}
            </div>
            {changedFiles.length > 0 ? (
              <>
                {isEditingFiles ? (
                  <label className="git-commit-files-select-all">
                    <input
                      checked={allSelected}
                      className="changed-files-tree-checkbox"
                      onChange={() => {
                        setExcludedFiles(
                          allSelected ? new Set(changedFiles.map((file) => file.path)) : new Set(),
                        );
                      }}
                      type="checkbox"
                    />
                    Include all files
                  </label>
                ) : null}
                <div className="git-commit-files-list scroll-mask-y">
                  <ChangedFilesTree
                    excludedPaths={excludedFiles}
                    files={changedFiles}
                    isEditing={isEditingFiles}
                    onToggleFile={(filePath) => {
                      setExcludedFiles((current) => {
                        const next = new Set(current);
                        if (next.has(filePath)) {
                          next.delete(filePath);
                        } else {
                          next.add(filePath);
                        }
                        return next;
                      });
                    }}
                  />
                </div>
                <div className="git-commit-files-summary">
                  <span className="changed-files-tree-additions">+{selectedStats.additions}</span>
                  <span className="changed-files-tree-stat-divider">/</span>
                  <span className="changed-files-tree-deletions">-{selectedStats.deletions}</span>
                </div>
              </>
            ) : (
              <div className="git-commit-files-empty">No changed files.</div>
            )}
          </div>
          {showCommitMessage ? (
            <label className="command-config-field">
              <span className="command-config-label">Commit Message</span>
              <textarea
                autoFocus
                className="group-title-input command-config-input command-config-textarea git-commit-modal-textarea"
                onChange={(event) => setMessage(event.currentTarget.value)}
                placeholder="Describe the change"
                rows={draft.suggestedBody ? 10 : 4}
                value={message}
                wrap="soft"
              />
            </label>
          ) : null}
          {draft.isWorktree ? (
            <label className="command-config-toggle git-commit-delete-worktree-toggle">
              <input
                checked={deleteWorktreeAfter}
                className="command-config-checkbox"
                onChange={(event) => setDeleteWorktreeAfter(event.currentTarget.checked)}
                type="checkbox"
              />
              <span className="command-config-toggle-copy">
                Delete worktree project after this action finishes
                {draft.worktreeName ? ` (${draft.worktreeName})` : ""}.
              </span>
            </label>
          ) : null}
        </div>
        <div className="confirm-modal-actions">
          <button
            className="secondary confirm-modal-button"
            onClick={() => onCancel(draft.requestId)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="primary confirm-modal-button"
            disabled={!canConfirm}
            onClick={() =>
              onConfirm(draft.requestId, trimmedMessage, {
                deleteWorktreeAfter,
                filePaths: selectedFilePaths,
              })
            }
            type="button"
          >
            {draft.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function buildDraftMessage(draft: GitCommitModalDraft): string {
  const subject = draft.suggestedSubject.trim();
  const body = draft.suggestedBody?.trim();
  return body ? `${subject}\n\n${body}` : subject;
}
