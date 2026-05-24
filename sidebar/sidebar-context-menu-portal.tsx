import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { WebviewApi } from "./webview-api";

type SidebarContextMenuPortalProps = {
  children: ReactNode;
  menuClassName?: string;
  menuRef?: RefObject<HTMLDivElement | null>;
  menuStyle?: CSSProperties;
  onDismiss: () => void;
  vscode?: WebviewApi;
};

type GhostexNativeSidebarBridge = {
  dismissSidebarContextMenu: () => void;
  notifySidebarContextMenuClosed: () => void;
  notifySidebarContextMenuOpened: () => void;
  openActiveProjectEditorFromTitlebar: () => void;
  exitFocusModeFromTitlebar: () => void;
  openAgentsModeFromTitlebar: () => void;
  openGitHubProjectFromTitlebar: () => void;
  quitResourcesFromTitlebar: (sessionIds: string[], projectIds: string[]) => void;
  showProjectEditorCompanionFromTitlebar: () => void;
  sleepInactiveSessionsFromTitlebar: (sessionIds: string[]) => void;
  openTasksPlaceholderFromTitlebar: () => void;
  refreshWorkspaceOpenTargetAvailabilityFromTitlebar: () => void;
  rotateActivePaneLayoutClockwiseFromTitlebar: () => void;
  sleepPetOverlayFromPet: () => void;
  togglePetOverlayFromTitlebar: () => void;
  toggleCommandsPanelFromTitlebar: () => void;
  runSidebarCommandFromTitlebar: (commandId: string) => void;
  runSidebarGitActionFromTitlebar: (action: "commit" | "push" | "pr") => void;
};

const activeDismissHandlers = new Set<() => void>();

declare global {
  interface Window {
    __ghostex_NATIVE_SIDEBAR__?: GhostexNativeSidebarBridge;
  }
}

/**
 * CDXC:SidebarContextMenu 2026-05-20-13:05:
 * Native AppKit surfaces dismiss open sidebar context menus through this hook
 * while leaving the user's original click intact.
 */
export function dismissAllSidebarContextMenus(): void {
  for (const dismiss of [...activeDismissHandlers]) {
    dismiss();
  }
}

function notifySidebarContextMenuOpened(vscode?: WebviewApi): void {
  if (window.__ghostex_NATIVE_SIDEBAR__?.notifySidebarContextMenuOpened) {
    window.__ghostex_NATIVE_SIDEBAR__.notifySidebarContextMenuOpened();
    return;
  }
  vscode?.postMessage({ type: "sidebarContextMenuOpened" });
}

function notifySidebarContextMenuClosed(vscode?: WebviewApi): void {
  if (window.__ghostex_NATIVE_SIDEBAR__?.notifySidebarContextMenuClosed) {
    window.__ghostex_NATIVE_SIDEBAR__.notifySidebarContextMenuClosed();
    return;
  }
  vscode?.postMessage({ type: "sidebarContextMenuClosed" });
}

/**
 * CDXC:SidebarContextMenu 2026-05-20-12:30:
 * Session and project context menus use a transparent backdrop above sidebar
 * rows/cards and below the menu so in-sidebar clicks dismiss without activating
 * the target underneath. Native listens for clicks outside the sidebar webview
 * and calls dismissAllSidebarContextMenus() so workspace/titlebar clicks both
 * close the menu and reach their original target.
 *
 * CDXC:SidebarContextMenu 2026-05-21-04:35:
 * Native open/close notifications must run in useLayoutEffect so the AppKit
 * outside-click monitor is armed before the user can click a terminal pane.
 */
export function SidebarContextMenuPortal({
  children,
  menuClassName = "session-context-menu",
  menuRef,
  menuStyle,
  onDismiss,
  vscode,
}: SidebarContextMenuPortalProps) {
  useEffect(() => {
    activeDismissHandlers.add(onDismiss);
    return () => {
      activeDismissHandlers.delete(onDismiss);
    };
  }, [onDismiss]);

  useLayoutEffect(() => {
    notifySidebarContextMenuOpened(vscode);
    return () => {
      notifySidebarContextMenuClosed(vscode);
    };
  }, [vscode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss]);

  return createPortal(
    <>
      <button
        aria-label="Close context menu"
        className="sidebar-context-menu-backdrop"
        onClick={onDismiss}
        onContextMenu={(event) => {
          event.preventDefault();
          onDismiss();
        }}
        type="button"
      />
      <div
        className={menuClassName}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        ref={menuRef}
        role="menu"
        style={menuStyle}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
