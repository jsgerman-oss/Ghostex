import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { SidebarGitAction, SidebarGitChangedFile } from "../shared/sidebar-git";
import { ChangedFilesTree } from "./changed-files-tree";
import { summarizeChangedFiles } from "./changed-files-tree-utils";

export type GitCommitModalDraft = {
  action?: SidebarGitAction;
  branch?: string | null;
  changedFiles?: SidebarGitChangedFile[];
  confirmLabel: string;
  deleteWorktreeAfterDefault?: boolean;
  description: string;
  isWorktree?: boolean;
  isDefaultRef?: boolean;
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
    options: { commitOnNewRef?: boolean; deleteWorktreeAfter: boolean; filePaths?: string[] },
  ) => void;
  onMultipleCommits: (requestId: string) => void;
  onOpenFileDiff: (filePath: string) => void;
};

export function GitCommitModal({
  draft,
  isOpen,
  onCancel,
  onConfirm,
  onMultipleCommits,
  onOpenFileDiff,
}: GitCommitModalProps) {
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

  const trimmedMessage = message.trim();
  const canConfirm = !showCommitMessage || !noneSelected;
  const selectedFilePaths =
    changedFiles.length > 0 && selectedFiles.length !== changedFiles.length
      ? selectedFiles.map((file) => file.path)
      : undefined;

  /*
   * CDXC:Worktrees 2026-05-18-23:07:
   * The git review modal must support three worktree-specific choices: file selection, skipping the commit-message field when only push/PR is needed, and deleting the temporary worktree after a successful action.
   *
   * CDXC:TitlebarGit 2026-05-24-17:41:
   * Titlebar-launched commits should match t3code's review experience: the message box may be left blank, and confirmation then generates the commit subject/body from the staged selected files.
   *
   * CDXC:TitlebarGit 2026-05-25-07:40:
   * The commit review dialog should use the same shadcn Settings modal surface, typography scale, button style, checkbox treatment, and neutral dark background. User-facing copy must call the destination a branch instead of lower-level Git reference terminology.
   *
   * CDXC:TitlebarGit 2026-05-25-09:41:
   * Multiple Commits hands the current repository to an agent prompt that splits commits by file/topic. Keep it in the same footer row as the normal commit actions so the Settings-style modal never shows stacked button rows.
   *
   * CDXC:TitlebarGit 2026-05-25-10:16:
   * Changed-file rows in the commit review modal should open a large app-modal diff viewer instead of jumping straight to the IDE, so users can inspect the exact patch before choosing a commit action.
   */
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel(draft.requestId);
        }
      }}
      open={isOpen}
    >
      <DialogContent
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className="ghostex-settings-shadcn settings-modal-dialog command-config-modal-shadcn git-commit-modal-shadcn dark flex flex-col gap-0 overflow-hidden p-0 font-sans"
        data-sidebar-theme="plain-dark"
      >
        <DialogHeader className="git-commit-modal-header">
          <DialogTitle className="text-xl" id={titleId}>
            Commit changes
          </DialogTitle>
          <DialogDescription className="git-commit-modal-description" id={descriptionId}>
            {draft.description ||
              "Review and confirm your commit. Leave the message blank to auto-generate one."}
          </DialogDescription>
        </DialogHeader>
        <div className="git-commit-modal-body scroll-mask-y">
          <div className="git-commit-files-panel">
            {draft.branch !== undefined ? (
              <div className="git-commit-branch-row">
                <span className="command-config-label">Branch</span>
                <span className="git-commit-branch-name">{draft.branch ?? "(detached HEAD)"}</span>
                {draft.isDefaultRef ? (
                  <span className="git-commit-default-branch-note">Note: Publishing to Main</span>
                ) : null}
              </div>
            ) : null}
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
                    onOpenFile={onOpenFileDiff}
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
              <Textarea
                autoFocus
                className="git-commit-modal-textarea"
                onChange={(event) => setMessage(event.currentTarget.value)}
                placeholder="Leave empty to auto-generate"
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
        <DialogFooter className="git-commit-modal-actions">
          <Button
            className="git-commit-modal-button"
            onClick={() => onCancel(draft.requestId)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          {showCommitMessage ? (
            <Button
              className="git-commit-modal-button"
              disabled={!canConfirm}
              onClick={() =>
                onConfirm(draft.requestId, trimmedMessage, {
                  commitOnNewRef: true,
                  deleteWorktreeAfter,
                  filePaths: selectedFilePaths,
                })
              }
              type="button"
              variant="outline"
            >
              Commit on new branch
            </Button>
          ) : null}
          {showCommitMessage ? (
            <Button
              className="git-commit-modal-button"
              disabled={!canConfirm}
              onClick={() => onMultipleCommits(draft.requestId)}
              type="button"
              variant="outline"
            >
              Multiple Commits
            </Button>
          ) : null}
          <Button
            className="git-commit-modal-button"
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
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildDraftMessage(draft: GitCommitModalDraft): string {
  const subject = draft.suggestedSubject.trim();
  const body = draft.suggestedBody?.trim();
  return body ? `${subject}\n\n${body}` : subject;
}
