import { useId, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type GitFileDiffModalDraft = {
  additions?: number;
  deletions?: number;
  filePath: string;
  patch: string;
};

export type GitFileDiffModalProps = {
  draft: GitFileDiffModalDraft;
  isOpen: boolean;
  onClose: () => void;
};

type DiffLineKind = "addition" | "context" | "deletion" | "hunk" | "metadata" | "raw";

type DiffLine = {
  content: string;
  kind: DiffLineKind;
  number: number;
};

export function GitFileDiffModal({ draft, isOpen, onClose }: GitFileDiffModalProps) {
  const descriptionId = useId();
  const titleId = useId();
  const lines = useMemo(() => parseDiffLines(draft.patch), [draft.patch]);
  const hasStats = draft.additions !== undefined || draft.deletions !== undefined;

  /*
   * CDXC:TitlebarGit 2026-05-25-10:16:
   * The commit review file tree opens this large app-modal diff viewer so users can inspect a single file patch without leaving the Git confirmation flow. It mirrors the t3code diff-panel experience with a sticky file header, monospaced patch rows, and addition/deletion coloring while staying inside Ghostex's existing modal host.
   */
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className="ghostex-settings-shadcn settings-modal-dialog git-file-diff-modal-shadcn dark flex flex-col gap-0 overflow-hidden p-0 font-sans"
        data-sidebar-theme="plain-dark"
      >
        <DialogHeader className="git-file-diff-modal-header">
          <DialogTitle className="git-file-diff-modal-title" id={titleId}>
            File diff
          </DialogTitle>
          <DialogDescription className="git-file-diff-modal-description" id={descriptionId}>
            <span className="git-file-diff-modal-path">{draft.filePath}</span>
            {hasStats ? (
              <span className="git-file-diff-modal-stats">
                <span className="changed-files-tree-additions">+{draft.additions ?? 0}</span>
                <span className="changed-files-tree-stat-divider">/</span>
                <span className="changed-files-tree-deletions">-{draft.deletions ?? 0}</span>
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="git-file-diff-modal-body scroll-mask-y">
          <div className="git-file-diff-surface" role="document">
            {lines.map((line) => (
              <div className="git-file-diff-line" data-kind={line.kind} key={line.number}>
                <span aria-hidden="true" className="git-file-diff-line-number">
                  {line.number}
                </span>
                <pre className="git-file-diff-line-content">{line.content || " "}</pre>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function parseDiffLines(patch: string): DiffLine[] {
  const rawLines = patch.trimEnd().split("\n");
  const lines = rawLines.length > 0 ? rawLines : ["No diff is available for this file."];
  return lines.map((content, index) => ({
    content,
    kind: classifyDiffLine(content),
    number: index + 1,
  }));
}

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode") ||
    line.startsWith("similarity index") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  ) {
    return "metadata";
  }
  if (line.startsWith("+")) {
    return "addition";
  }
  if (line.startsWith("-")) {
    return "deletion";
  }
  if (line.startsWith("No diff is available")) {
    return "raw";
  }
  return "context";
}
