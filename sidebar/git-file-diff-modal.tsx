import { IconDotsVertical } from "@tabler/icons-react";
import { useId, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SidebarGitFileDiffDraft } from "../shared/sidebar-git";

export type GitFileDiffModalDraft = SidebarGitFileDiffDraft;

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

type GitDiffViewMode = "split" | "unified";

export function GitFileDiffModal({ draft, isOpen, onClose }: GitFileDiffModalProps) {
  const descriptionId = useId();
  const titleId = useId();
  const hasStats = draft.additions !== undefined || draft.deletions !== undefined;

  /*
   * CDXC:TitlebarGit 2026-05-25-10:16:
   * The standalone file diff modal mirrors the t3code diff-panel experience with a sticky file header, monospaced patch rows, and addition/deletion coloring while staying inside Ghostex's existing modal host.
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
          <GitFileDiffPanel draft={draft} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GitFileDiffPanel({
  draft,
  isLoading = false,
  placeholder = "Select a file to preview its diff.",
}: {
  draft?: GitFileDiffModalDraft;
  isLoading?: boolean;
  placeholder?: string;
}) {
  const [viewMode, setViewMode] = useState<GitDiffViewMode>("unified");
  const [hideWhitespace, setHideWhitespace] = useState(false);
  const lines = useMemo(() => parseDiffLines(draft?.patch ?? ""), [draft?.patch]);
  const visibleLines = useMemo(
    () => (hideWhitespace ? lines.filter((line) => !isWhitespaceOnlyChangeLine(line)) : lines),
    [hideWhitespace, lines],
  );

  /*
   * CDXC:TitlebarGit 2026-06-05-20:59:
   * Commit review now embeds file diffs in the right side of the widened review modal instead of opening a second modal. Keep diff display controls behind a single overflow menu so Unified, Split, and Hide whitespace do not compete with the selected file path for header space.
   */
  if (isLoading) {
    return <div className="git-file-diff-placeholder">Loading diff...</div>;
  }
  if (!draft) {
    return <div className="git-file-diff-placeholder">{placeholder}</div>;
  }

  return (
    <div className="git-file-diff-panel">
      <div className="git-file-diff-panel-toolbar">
        <span className="git-file-diff-panel-mode">{viewMode === "split" ? "Split" : "Unified"}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Diff display options"
            className="git-file-diff-options-trigger"
            type="button"
          >
            <IconDotsVertical aria-hidden="true" size={18} stroke={2.2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="git-file-diff-options-menu"
            sideOffset={8}
          >
            <DropdownMenuLabel>Diff view</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={(value) => {
                if (value === "split" || value === "unified") {
                  setViewMode(value);
                }
              }}
              value={viewMode}
            >
              <DropdownMenuRadioItem value="unified">Unified</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="split">Split</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={hideWhitespace}
              onCheckedChange={(checked) => setHideWhitespace(checked === true)}
            >
              Hide whitespace
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="git-file-diff-surface" data-view-mode={viewMode} role="document">
        {viewMode === "split"
          ? visibleLines.map((line) => <SplitDiffLine key={line.number} line={line} />)
          : visibleLines.map((line) => <UnifiedDiffLine key={line.number} line={line} />)}
      </div>
    </div>
  );
}

function UnifiedDiffLine({ line }: { line: DiffLine }) {
  return (
    <div className="git-file-diff-line" data-kind={line.kind}>
      <span aria-hidden="true" className="git-file-diff-line-number">
        {line.number}
      </span>
      <pre className="git-file-diff-line-content">{line.content || " "}</pre>
    </div>
  );
}

function SplitDiffLine({ line }: { line: DiffLine }) {
  if (line.kind === "metadata" || line.kind === "hunk" || line.kind === "raw") {
    return <UnifiedDiffLine line={line} />;
  }
  const leftContent = line.kind === "deletion" || line.kind === "context" ? line.content : "";
  const rightContent =
    line.kind === "addition"
      ? line.content
      : line.kind === "context"
        ? line.content
        : "";
  return (
    <div className="git-file-diff-split-line" data-kind={line.kind}>
      <span aria-hidden="true" className="git-file-diff-line-number">
        {line.number}
      </span>
      <pre className="git-file-diff-line-content git-file-diff-split-cell">
        {leftContent || " "}
      </pre>
      <span aria-hidden="true" className="git-file-diff-line-number">
        {line.number}
      </span>
      <pre className="git-file-diff-line-content git-file-diff-split-cell">
        {rightContent || " "}
      </pre>
    </div>
  );
}

function parseDiffLines(patch: string): DiffLine[] {
  const rawLines = patch.trimEnd().split("\n");
  const lines = rawLines.some((line) => line.length > 0)
    ? rawLines
    : ["No diff is available for this file."];
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

function isWhitespaceOnlyChangeLine(line: DiffLine): boolean {
  if (line.kind !== "addition" && line.kind !== "deletion") {
    return false;
  }
  return line.content.slice(1).trim().length === 0;
}
