import { IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type WorktreeDeleteModalDraft = {
  branch: string | null;
  groupId: string;
  hasChanges: boolean;
  projectId: string;
  statusSummary: string;
  worktreeName: string;
};

export type WorktreeDeleteModalProps = {
  draft: WorktreeDeleteModalDraft;
  isOpen: boolean;
  onCancel: () => void;
  onCommit: (groupId: string) => void;
  onDelete: (projectId: string) => void;
};

export function WorktreeDeleteModal({
  draft,
  isOpen,
  onCancel,
  onCommit,
  onDelete,
}: WorktreeDeleteModalProps) {
  /*
   * CDXC:WorktreeDelete 2026-05-28-07:46:
   * Delete Worktree must be a full-window confirmation modal. Dirty worktrees show the native git status summary and offer Commit, which switches to the existing commit review modal; clean worktrees show a green checkmark instead of an empty status block.
   */
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
        className="ghostex-settings-shadcn settings-modal-dialog command-config-modal-shadcn worktree-delete-modal-shadcn dark flex flex-col gap-0 overflow-hidden p-0 font-sans"
        data-sidebar-theme="plain-dark"
      >
        <DialogHeader className="worktree-delete-modal-header">
          <DialogTitle className="text-xl">Delete worktree</DialogTitle>
          <DialogDescription className="sr-only">
            Confirm whether to delete the selected worktree checkout.
          </DialogDescription>
        </DialogHeader>
        <div className="worktree-delete-modal-body">
          <p className="worktree-delete-modal-question">
            Delete worktree &quot;{draft.worktreeName}&quot;?
          </p>
          {draft.hasChanges ? (
            <div className="worktree-delete-status-block">
              <p className="worktree-delete-status-heading">
                This worktree has uncommitted changes:
              </p>
              <pre className="worktree-delete-status-summary">{draft.statusSummary}</pre>
            </div>
          ) : (
            <div className="worktree-delete-clean-row">
              <span className="worktree-delete-clean-icon" aria-hidden="true">
                <IconCheck size={15} stroke={2.4} />
              </span>
              <span>The worktree has no local changes</span>
            </div>
          )}
          <p className="worktree-delete-modal-note">
            This action will remove the worktree directory.
          </p>
        </div>
        <DialogFooter className="worktree-delete-modal-actions">
          <Button
            className="worktree-delete-modal-button"
            onClick={onCancel}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          {draft.hasChanges ? (
            <Button
              className="worktree-delete-modal-button"
              onClick={() => onCommit(draft.groupId)}
              type="button"
              variant="outline"
            >
              Commit
            </Button>
          ) : null}
          <Button
            className="worktree-delete-modal-button"
            onClick={() => onDelete(draft.projectId)}
            type="button"
            variant="destructive"
          >
            Delete Worktree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
