import {
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
} from "@tabler/icons-react";
import { memo, useCallback, useMemo, useState } from "react";
import type { SidebarGitChangedFile } from "../shared/sidebar-git";
import {
  buildChangedFilesTree,
  type ChangedFilesTreeNode,
  type ChangedFilesTreeStat,
} from "./changed-files-tree-utils";

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {};

export type ChangedFilesTreeProps = {
  allDirectoriesExpanded?: boolean;
  className?: string;
  excludedPaths?: ReadonlySet<string>;
  files: ReadonlyArray<SidebarGitChangedFile>;
  isEditing?: boolean;
  onOpenFile?: (filePath: string) => void;
  onToggleFile?: (filePath: string) => void;
  selectedPath?: string;
};

export const ChangedFilesTree = memo(function ChangedFilesTree({
  allDirectoriesExpanded = true,
  className,
  excludedPaths,
  files,
  isEditing = false,
  onOpenFile,
  onToggleFile,
  selectedPath,
}: ChangedFilesTreeProps) {
  const treeNodes = useMemo(() => buildChangedFilesTree(files), [files]);
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join("\u0000"),
    [treeNodes],
  );
  const expansionStateKey = `${allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`;
  const [directoryExpansionState, setDirectoryExpansionState] = useState<{
    key: string;
    overrides: Record<string, boolean>;
  }>(() => ({
    key: expansionStateKey,
    overrides: {},
  }));
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES;

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState((current) => {
        const nextOverrides = current.key === expansionStateKey ? current.overrides : {};
        return {
          key: expansionStateKey,
          overrides: {
            ...nextOverrides,
            [pathValue]: !(nextOverrides[pathValue] ?? allDirectoriesExpanded),
          },
        };
      });
    },
    [allDirectoriesExpanded, expansionStateKey],
  );

  const renderTreeNode = (node: ChangedFilesTreeNode, depth: number) => {
    const leftPadding = 8 + depth * 14;
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded;
      return (
        <div key={`dir:${node.path}`}>
          <button
            className="changed-files-tree-row changed-files-tree-directory"
            onClick={() => toggleDirectory(node.path)}
            style={{ paddingLeft: `${leftPadding}px` }}
            type="button"
          >
            <IconChevronRight
              aria-hidden="true"
              className="changed-files-tree-chevron"
              data-expanded={String(isExpanded)}
              size={14}
            />
            {isExpanded ? (
              <IconFolderOpen aria-hidden="true" className="changed-files-tree-icon" size={14} />
            ) : (
              <IconFolder aria-hidden="true" className="changed-files-tree-icon" size={14} />
            )}
            <span className="changed-files-tree-name">{node.name}</span>
            {hasNonZeroStat(node.stat) ? <DiffStat stat={node.stat} /> : null}
          </button>
          {isExpanded ? (
            <div className="changed-files-tree-children">
              {node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    }

    const isExcluded = excludedPaths?.has(node.path) === true;
    return (
      <div
        className="changed-files-tree-row changed-files-tree-file"
        data-excluded={String(isExcluded)}
        data-selected={String(node.path === selectedPath)}
        key={`file:${node.path}`}
        style={{ paddingLeft: `${leftPadding}px` }}
      >
        {isEditing ? (
          <input
            aria-label={`Include ${node.path}`}
            checked={!isExcluded}
            className="changed-files-tree-checkbox"
            onChange={() => onToggleFile?.(node.path)}
            type="checkbox"
          />
        ) : (
          <span aria-hidden="true" className="changed-files-tree-file-indent" />
        )}
        <IconFile aria-hidden="true" className="changed-files-tree-icon" size={14} />
        <button
          className="changed-files-tree-file-button"
          onClick={() => onOpenFile?.(node.path)}
          type="button"
        >
          <span className="changed-files-tree-name">{node.name}</span>
        </button>
        {isExcluded ? <span className="changed-files-tree-excluded">Excluded</span> : null}
        {!isExcluded ? <DiffStat stat={node.stat} /> : null}
      </div>
    );
  };

  return (
    <div className={className ? `changed-files-tree ${className}` : "changed-files-tree"}>
      {treeNodes.map((node) => renderTreeNode(node, 0))}
    </div>
  );
});

function DiffStat({ stat }: { stat: ChangedFilesTreeStat }) {
  return (
    <span
      aria-label={`Additions ${stat.additions}, deletions ${stat.deletions}`}
      className="changed-files-tree-stat"
    >
      <span className="changed-files-tree-additions">+{stat.additions}</span>
      <span className="changed-files-tree-stat-divider">/</span>
      <span className="changed-files-tree-deletions">-{stat.deletions}</span>
    </span>
  );
}

function hasNonZeroStat(stat: ChangedFilesTreeStat): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

function collectDirectoryPaths(nodes: ReadonlyArray<ChangedFilesTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") {
      continue;
    }
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}
