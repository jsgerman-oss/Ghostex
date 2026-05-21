import {
  IconFolderFilled,
  IconGitBranch,
  IconGitMerge,
  IconGitPullRequest,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { SidebarProjectHeader as SidebarProjectHeaderData } from "../shared/session-grid-contract";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./app-tooltip";
import { openAppModal } from "./app-modal-host-bridge";

export type SidebarProjectHeaderProps = {
  projectHeader?: SidebarProjectHeaderData;
};

const PROJECT_HEADER_TOOLTIP_DELAY_MS = 200;
const PROJECT_HEADER_COPIED_TOOLTIP_DURATION_MS = 1200;

export function SidebarProjectHeader({ projectHeader }: SidebarProjectHeaderProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const isHoveringRef = useRef(false);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== undefined) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = undefined;
      }
    };
  }, []);

  if (!projectHeader) {
    return null;
  }

  const displayDirectory = formatSidebarProjectDirectory(projectHeader.directory);
  const copyPath = () => {
    const copyPromise = navigator.clipboard?.writeText(projectHeader.directory);
    void copyPromise?.catch(() => {});
    setIsCopied(true);
    setIsTooltipOpen(true);

    if (copiedTimerRef.current !== undefined) {
      window.clearTimeout(copiedTimerRef.current);
    }

    copiedTimerRef.current = window.setTimeout(() => {
      setIsCopied(false);
      copiedTimerRef.current = undefined;

      if (!isHoveringRef.current && !isFocusedRef.current) {
        setIsTooltipOpen(false);
      }
    }, PROJECT_HEADER_COPIED_TOOLTIP_DURATION_MS);
  };

  return (
    <div className="sidebar-project-header-region" data-empty-space-blocking="true">
      <div className="sidebar-project-header-surface">
        <div className="sidebar-project-header-main">
          <div
            aria-hidden="true"
            className="sidebar-project-header-icon-shell"
            data-icon-variant={projectHeader.faviconDataUrl ? "favicon" : "placeholder"}
          >
            {projectHeader.faviconDataUrl ? (
              <img
                alt=""
                className="sidebar-project-header-icon-image"
                src={projectHeader.faviconDataUrl}
              />
            ) : projectHeader.worktree ? (
              <IconGitBranch className="sidebar-project-header-icon-fallback" size={18} />
            ) : (
              <IconFolderFilled className="sidebar-project-header-icon-fallback" size={18} />
            )}
          </div>
          <TooltipProvider delayDuration={PROJECT_HEADER_TOOLTIP_DELAY_MS}>
            <Tooltip
              onOpenChange={(open) => {
                if (!open && isCopied) {
                  return;
                }

                setIsTooltipOpen(open);
              }}
              open={isTooltipOpen}
            >
              <TooltipTrigger asChild>
                <button
                  aria-label={`Copy project path: ${projectHeader.directory}`}
                  className="sidebar-project-header-copy copy-cursor"
                  onBlur={() => {
                    isFocusedRef.current = false;
                    if (!isCopied && !isHoveringRef.current) {
                      setIsTooltipOpen(false);
                    }
                  }}
                  onClick={copyPath}
                  onFocus={() => {
                    isFocusedRef.current = true;
                  }}
                  onMouseEnter={() => {
                    isHoveringRef.current = true;
                  }}
                  onMouseLeave={() => {
                    isHoveringRef.current = false;
                    if (!isCopied && !isFocusedRef.current) {
                      setIsTooltipOpen(false);
                    }
                  }}
                  type="button"
                >
                  <span className="sidebar-project-header-name">{projectHeader.name}</span>
                  <span className="sidebar-project-header-directory">{displayDirectory}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent sideOffset={8}>
                {isCopied ? "Copied path!" : "Click here to copy the path"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {/*
         * CDXC:Worktrees 2026-05-18-23:07:
         * The current project header mirrors project rows: main projects can open the worktree creation modal, while worktree projects show branch identity plus disabled PR/merge affordances until those actions are implemented.
         */}
        <div className="sidebar-project-header-actions">
          {projectHeader.worktree ? (
            <>
              <TooltipProvider delayDuration={PROJECT_HEADER_TOOLTIP_DELAY_MS}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={`Create PR for ${projectHeader.name}`}
                      aria-disabled="true"
                      className="sidebar-project-header-action"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      type="button"
                    >
                      <IconGitPullRequest aria-hidden="true" size={14} stroke={2} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8}>Create PR</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={PROJECT_HEADER_TOOLTIP_DELAY_MS}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={`Merge ${projectHeader.name} to main`}
                      aria-disabled="true"
                      className="sidebar-project-header-action"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      type="button"
                    >
                      <IconGitMerge aria-hidden="true" size={14} stroke={2} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8}>Merge to main</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          ) : (
            <TooltipProvider delayDuration={PROJECT_HEADER_TOOLTIP_DELAY_MS}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label={`Create worktree from ${projectHeader.name}`}
                    className="sidebar-project-header-action"
                    onClick={() =>
                      openAppModal({
                        modal: "worktree",
                        projectId: projectHeader.projectId,
                        projectName: projectHeader.name,
                        type: "open",
                      })
                    }
                    type="button"
                  >
                    <IconGitBranch aria-hidden="true" size={14} stroke={2} />
                  </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={8}>Create Worktree</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSidebarProjectDirectory(directory: string): string {
  return directory.replace(/^\/Users\/[^/]+(?=\/|$)/, "~").replace(/^\/home\/[^/]+(?=\/|$)/, "~");
}
