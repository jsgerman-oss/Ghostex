import { IconX } from "@tabler/icons-react";
import { useRef } from "react";
import type { SidebarPreviousSessionItem } from "../shared/session-grid-contract";
import {
  getSessionCardTitleTooltip,
  OverflowTooltipText,
  SessionCardContent,
  SessionFloatingAgentIcon,
  shouldShowTerminalSessionIcon,
} from "./session-card-content";
import { getSessionHistoryCardTitle } from "./session-history-card-title";

export type SessionHistoryCardProps = {
  isSearchSelected?: boolean;
  onDelete: () => void;
  onRestore: () => void;
  session: SidebarPreviousSessionItem;
  showDebugSessionNumbers: boolean;
  showHotkeys: boolean;
};

export function SessionHistoryCard({
  onDelete,
  onRestore,
  session,
  showDebugSessionNumbers,
  showHotkeys,
}: SessionHistoryCardProps) {
  const aliasHeadingRef = useRef<HTMLDivElement>(null);
  const displayTitle = getSessionHistoryCardTitle(session);
  const displaySession =
    session.primaryTitle?.trim() || !session.terminalTitle?.trim()
      ? session
      : {
          ...session,
          primaryTitle: session.terminalTitle,
          terminalTitle: undefined,
        };
  const sessionTitleTooltip = getSessionCardTitleTooltip({
    alwaysShowTitleTooltip: true,
    session: displaySession,
    showDebugSessionNumbers,
    showSessionDetails: true,
  });
  const projectLabel = getSessionHistoryProjectLabel(session);
  /**
   * CDXC:PreviousSessions 2026-05-13-16:11:
   * Previous Sessions rows place project metadata on the right, directly
   * before Last Active, so the title column stays dedicated to the session
   * title while project context remains visible during scanning.
   */

  return (
    <OverflowTooltipText
      text={sessionTitleTooltip.headingText}
      textRef={aliasHeadingRef}
      tooltip={sessionTitleTooltip.tooltip}
      tooltipWhen={sessionTitleTooltip.tooltipWhen}
    >
      <div
        className="session-frame session-history-frame"
        data-focused="false"
        data-has-project-label={String(Boolean(projectLabel))}
        data-running="false"
        data-restorable={String(session.isRestorable)}
        data-visible="false"
      >
        {/**
         * CDXC:PreviousSessions 2026-05-09-17:44
         * History rows are archived restore entries. Render the leading icon
         * as identity only, and never let stale live-session visible/focused
         * state make previous-session cards look like active UI rows.
         *
         * CDXC:PreviousSessions 2026-05-11-09:04
         * Sidebar search and the modal must show every previous-session button
         * with the same row chrome; active/live highlights are misleading here
         * because these rows restore history instead of representing open UI.
         */}
        <SessionFloatingAgentIcon
          agentIcon={session.agentIcon}
          faviconDataUrl={session.faviconDataUrl}
          isFavorite={session.isFavorite}
          sessionPersistenceName={session.sessionPersistenceName}
          sessionPersistenceProvider={session.sessionPersistenceProvider}
          showTerminalIcon={shouldShowTerminalSessionIcon(session)}
        />
        <article
          aria-disabled={!session.isRestorable}
          aria-pressed="false"
          aria-label={session.isRestorable ? `Restore ${displayTitle}` : displayTitle}
          className="session session-history-card"
          data-has-agent-icon={String(
            Boolean(session.agentIcon) || shouldShowTerminalSessionIcon(session),
          )}
          data-dragging="false"
          data-focused="false"
          data-running="false"
          data-search-selected="false"
          data-sidebar-history-id={session.historyId}
          data-restorable={String(session.isRestorable)}
          data-visible="false"
          onAuxClick={(event) => {
            if (event.button !== 1) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            onDelete();
          }}
          onClick={() => {
            if (!session.isRestorable) {
              return;
            }

            onRestore();
          }}
          onKeyDown={(event) => {
            if (!session.isRestorable || (event.key !== "Enter" && event.key !== " ")) {
              return;
            }

            event.preventDefault();
            onRestore();
          }}
          onMouseDown={(event) => {
            if (event.button !== 1) {
              return;
            }

            event.preventDefault();
          }}
          role={session.isRestorable ? "button" : undefined}
          tabIndex={session.isRestorable ? 0 : -1}
        >
          <button
            aria-label={`Delete ${displayTitle} from previous sessions`}
            className="previous-session-delete-button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }}
            type="button"
          >
            <IconX aria-hidden="true" size={14} stroke={1.9} />
          </button>
          <SessionCardContent
            aliasHeadingRef={aliasHeadingRef}
            hideHeaderAgentIcon={true}
            session={displaySession}
            showDebugSessionNumbers={showDebugSessionNumbers}
            showCloseButton={false}
            showHotkeys={showHotkeys}
            showLastInteractionTime={true}
            trailingPrefix={
              projectLabel ? (
                <div className="session-history-project-label" aria-hidden="true">
                  {projectLabel}
                </div>
              ) : null
            }
          />
        </article>
      </div>
    </OverflowTooltipText>
  );
}

function getSessionHistoryProjectLabel(session: SidebarPreviousSessionItem): string | undefined {
  const projectName = session.projectName?.trim();
  if (projectName) {
    return projectName;
  }

  const projectPath = session.projectPath?.trim();
  if (!projectPath) {
    return undefined;
  }

  const pathParts = projectPath.split(/[\\/]/u).filter(Boolean);
  return pathParts[pathParts.length - 1] ?? projectPath;
}
