import {
  IconCopy,
  IconCode,
  IconClock,
  IconDeviceMobile,
  IconDownload,
  IconExternalLink,
  IconGitFork,
  IconHandFinger,
  IconLayoutSidebarRightExpand,
  IconMessageCircle,
  IconMoon,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconSparkles,
  IconStar,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react";
import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { SortableKeyboardPlugin } from "@dnd-kit/dom/sortable";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  getSidebarSessionLifecycleState,
  type SidebarSessionItem,
} from "../shared/session-grid-contract";
import { DEFAULT_ghostex_SETTINGS } from "../shared/ghostex-settings";
import {
  getSessionCardTitleTooltip,
  OverflowTooltipText,
  SessionCardContent,
  SessionFloatingAgentIcon,
  shouldShowTerminalSessionIcon,
} from "./session-card-content";
import { getSessionStatusAnchorName } from "./session-status-anchor";
import {
  createSessionDragData,
  createSessionDropTargetData,
  createSessionDropTargetId,
} from "./sidebar-dnd";
import { openAppModal } from "./app-modal-host-bridge";
import { SidebarContextMenuPortal } from "./sidebar-context-menu-portal";
import { useSidebarStore } from "./sidebar-store";
import type { WebviewApi } from "./webview-api";

const CONTEXT_MENU_MARGIN_PX = 12;
const CONTEXT_MENU_WIDTH_PX = 178;
const CONTEXT_MENU_ITEM_HEIGHT_PX = 34;
const CONTEXT_MENU_DIVIDER_HEIGHT_PX = 13;
const CONTEXT_MENU_VERTICAL_PADDING_PX = 12;
const SESSION_CARD_DRAG_HOLD_DELAY_MS = 130;
const SESSION_CARD_DRAG_HOLD_TOLERANCE_PX = 12;
const TOUCH_SESSION_CARD_DRAG_HOLD_DELAY_MS = 130;
const TOUCH_SESSION_CARD_DRAG_HOLD_TOLERANCE_PX = 12;
const COMPLETION_FLASH_DURATION_MS = 3_000;

const sessionCardSensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      if (event.pointerType === "touch") {
        return [
          new PointerActivationConstraints.Delay({
            tolerance: TOUCH_SESSION_CARD_DRAG_HOLD_TOLERANCE_PX,
            value: TOUCH_SESSION_CARD_DRAG_HOLD_DELAY_MS,
          }),
        ];
      }

      return [
        new PointerActivationConstraints.Delay({
          tolerance: SESSION_CARD_DRAG_HOLD_TOLERANCE_PX,
          value: SESSION_CARD_DRAG_HOLD_DELAY_MS,
        }),
      ];
    },
  }),
  KeyboardSensor,
];

type ContextMenuPosition = {
  x: number;
  y: number;
};

type SessionContextMenuAction = {
  danger?: boolean;
  icon: ReactNode;
  key: string;
  label: string;
  onClick: () => void;
};

export type SortableSessionCardProps = {
  completionFlashNonce?: number;
  dragDisabled?: boolean;
  groupId: string;
  index: number;
  isSearchSelected?: boolean;
  onFocusRequested?: (groupId: string, sessionId: string) => void;
  sessionId: string;
  showGroupConnector?: boolean;
  showDropPositionIndicator?: boolean;
  vscode: WebviewApi;
};

function clampContextMenuPosition(
  clientX: number,
  clientY: number,
  itemCount: number,
  dividerCount: number,
): ContextMenuPosition {
  const menuHeight =
    CONTEXT_MENU_VERTICAL_PADDING_PX +
    itemCount * CONTEXT_MENU_ITEM_HEIGHT_PX +
    dividerCount * CONTEXT_MENU_DIVIDER_HEIGHT_PX;
  return {
    x: Math.max(
      CONTEXT_MENU_MARGIN_PX,
      Math.min(clientX, window.innerWidth - CONTEXT_MENU_WIDTH_PX - CONTEXT_MENU_MARGIN_PX),
    ),
    y: Math.max(
      CONTEXT_MENU_MARGIN_PX,
      Math.min(clientY, window.innerHeight - menuHeight - CONTEXT_MENU_MARGIN_PX),
    ),
  };
}

export function SortableSessionCard({
  completionFlashNonce = 0,
  dragDisabled = false,
  groupId,
  index,
  isSearchSelected = false,
  onFocusRequested,
  sessionId,
  showGroupConnector = false,
  showDropPositionIndicator = true,
  vscode,
}: SortableSessionCardProps) {
  const session = useSidebarStore((state) => state.sessionsById[sessionId]);
  const {
    hideSessionAgentIconUntilHover,
    renameSessionOnDoubleClick,
    showCloseButton,
    showDebugSessionNumbers,
    showHotkeys,
    showLastActiveTime,
  } = useSidebarStore(
    useShallow((state) => ({
      /*
       * CDXC:SidebarSessions 2026-05-16-08:46:
       * The hover-only agent icon setting is visual chrome only; keep icons in
       * the DOM so the same row can reveal them on hover/focus without
       * changing session identity or drag hit targets.
       */
      hideSessionAgentIconUntilHover:
        state.hud.settings?.hideSessionAgentIconUntilHover ??
        DEFAULT_ghostex_SETTINGS.hideSessionAgentIconUntilHover,
      renameSessionOnDoubleClick: state.hud.renameSessionOnDoubleClick,
      showCloseButton: state.hud.showCloseButtonOnSessionCards,
      showDebugSessionNumbers: state.hud.debuggingMode,
      showHotkeys: state.hud.showHotkeysOnSessionCards,
      showLastActiveTime:
        !(state.hud.settings?.hideLastActiveTimeOnSessionCards ??
          DEFAULT_ghostex_SETTINGS.hideLastActiveTimeOnSessionCards),
    })),
  );
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition>();
  const [completionFlashRunId, setCompletionFlashRunId] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const aliasHeadingRef = useRef<HTMLDivElement>(null);
  const debugInstanceIdRef = useRef(createSidebarDebugInstanceId());
  const lastAgentIconRenderDebugKeyRef = useRef<string | undefined>(undefined);
  const isBrowserSession = session?.sessionKind === "browser" || session?.kind === "browser";
  const isT3Session = session?.sessionKind === "t3";
  const canFavoriteSession = !isBrowserSession;
  const canForkSession = session ? !isBrowserSession && supportsFork(session) : false;
  const canDelayedSend = session ? !isBrowserSession && !isT3Session : false;
  const canCopyResumeCommand = session
    ? !isBrowserSession && supportsResumeCommandCopy(session)
    : false;
  const canCopyAttachCommand =
    !isBrowserSession &&
    Boolean(session?.sessionPersistenceProvider && session.sessionPersistenceName);
  const canFullReloadSession = session ? !isBrowserSession && supportsFullReload(session) : false;
  const canPopOutPane = session ? supportsPopOutPane(session, isBrowserSession, isT3Session) : false;
  const canGenerateSessionTitle = session
    ? !isBrowserSession &&
      supportsGeneratedName(session) &&
      Boolean(session.firstUserMessage?.trim())
    : false;
  const canSleepSession = session ? !isBrowserSession : false;
  const postSessionDragDebugLog = useEffectEvent(
    (event: string, details: Record<string, unknown>) => {
      if (!showDebugSessionNumbers) {
        return;
      }

      vscode.postMessage({
        details: {
          debugInstanceId: debugInstanceIdRef.current,
          groupId,
          index,
          sessionId,
          ...details,
        },
        event,
        type: "sidebarDebugLog",
      });
    },
  );
  const sortable = useSortable({
    accept: "session",
    data: createSessionDragData(groupId, session.sessionId),
    disabled: dragDisabled || isBrowserSession || contextMenuPosition !== undefined,
    feedback: "clone",
    group: groupId,
    id: sessionId,
    index,
    plugins: [SortableKeyboardPlugin],
    sensors: sessionCardSensors,
    type: "session",
  });
  const isSessionReorderDisabled =
    !session || dragDisabled || isBrowserSession || contextMenuPosition !== undefined;
  const beforeDropTarget = useDroppable({
    accept: "session",
    data: createSessionDropTargetData({
      groupId,
      kind: "session",
      position: "before",
      sessionId,
    }),
    disabled: isSessionReorderDisabled,
    id: createSessionDropTargetId({
      groupId,
      kind: "session",
      position: "before",
      sessionId,
    }),
  });
  const afterDropTarget = useDroppable({
    accept: "session",
    data: createSessionDropTargetData({
      groupId,
      kind: "session",
      position: "after",
      sessionId,
    }),
    disabled: isSessionReorderDisabled,
    id: createSessionDropTargetId({
      groupId,
      kind: "session",
      position: "after",
      sessionId,
    }),
  });
  const dropPosition = sortable.isDragging
    ? undefined
    : beforeDropTarget.isDropTarget
      ? "before"
      : afterDropTarget.isDropTarget
        ? "after"
        : undefined;
  const visibleDropPosition = showDropPositionIndicator ? dropPosition : undefined;
  const isVisibleDropTarget = showDropPositionIndicator && Boolean(sortable.isDropTarget);

  if (!session) {
    return null;
  }

  const sessionTitleTooltip = getSessionCardTitleTooltip({
    session,
    showDebugSessionNumbers,
  });
  const lifecycleState = getSidebarSessionLifecycleState(session);
  const showTerminalSessionIcon = shouldShowTerminalSessionIcon(session);
  const hasSessionCardIcon =
    Boolean(session.delayedSendRemainingLabel) ||
    Boolean(session.agentIcon) ||
    showTerminalSessionIcon ||
    session.isReloading === true;
  const sessionAnchorStyle = {
    anchorName: getSessionStatusAnchorName(sessionId),
  } as CSSProperties;

  useEffect(() => {
    setContextMenuPosition(undefined);
  }, [session.alias, session.sessionId]);

  useEffect(() => {
    if (completionFlashNonce <= 0) {
      return;
    }

    setCompletionFlashRunId(completionFlashNonce);
  }, [completionFlashNonce]);

  useEffect(() => {
    if (completionFlashRunId <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCompletionFlashRunId((previous) => (previous === completionFlashRunId ? 0 : previous));
    }, COMPLETION_FLASH_DURATION_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [completionFlashRunId]);

  useEffect(() => {
    postSessionDragDebugLog("session.cardMounted", {
      dropPosition,
      isBrowserSession,
    });

    return () => {
      postSessionDragDebugLog("session.cardUnmounted", {
        dropPosition,
        isBrowserSession,
      });
    };
  }, [isBrowserSession, postSessionDragDebugLog]);

  useEffect(() => {
    postSessionDragDebugLog("session.dropPositionChanged", {
      dropPosition,
      isDragging: sortable.isDragging,
      isDropTarget: sortable.isDropTarget,
    });
  }, [dropPosition, postSessionDragDebugLog, sortable.isDragging, sortable.isDropTarget]);

  useEffect(() => {
    if (!hasSessionCardIcon) {
      return;
    }

    const hasLastInteractionLabel = showLastActiveTime && Boolean(session.lastInteractionAt);
    const showHeaderLoadingSpinner =
      session.isReloading === true || session.isGeneratingFirstPromptTitle === true;
    const hasHeaderAgentIcon =
      Boolean(session.agentIcon) || showTerminalSessionIcon || showHeaderLoadingSpinner;
    const defaultTrailingDisplay = hasHeaderAgentIcon
      ? "icon"
      : hasLastInteractionLabel
        ? "time"
        : "icon";
    const shouldKeepLoadingIconVisible = showHeaderLoadingSpinner && hasHeaderAgentIcon;
    const hoverTrailingDisplay = shouldKeepLoadingIconVisible
      ? "icon"
      : defaultTrailingDisplay === "icon"
        ? hasLastInteractionLabel
          ? "time"
          : "icon"
        : hasHeaderAgentIcon
          ? "icon"
          : "time";
    const debugKey = JSON.stringify({
      agentIcon: session.agentIcon,
      defaultTrailingDisplay,
      hasHeaderAgentIcon,
      hasLastInteractionLabel,
      hoverTrailingDisplay,
      isGeneratingFirstPromptTitle: session.isGeneratingFirstPromptTitle === true,
      isReloading: session.isReloading === true,
      primaryTitle: session.primaryTitle,
      sessionId: session.sessionId,
      showTerminalSessionIcon,
      terminalTitle: session.terminalTitle,
    });
    if (lastAgentIconRenderDebugKeyRef.current === debugKey) {
      return;
    }
    lastAgentIconRenderDebugKeyRef.current = debugKey;

    /*
     * CDXC:AgentDetection 2026-04-27-07:43
     * Agent identity is confirmed at the native/webview/store boundary. Log
     * the card render decision and actual DOM state so missing sidebar icons
     * can be traced without guessing at CSS or projection state.
     */
    postSidebarAgentIconRenderDebugLog(vscode, "sidebar.agentIcon.cardRenderState", {
      agentIcon: session.agentIcon,
      defaultTrailingDisplay,
      groupId,
      hasHeaderAgentIcon,
      hasLastInteractionLabel,
      hoverTrailingDisplay,
      isGeneratingFirstPromptTitle: session.isGeneratingFirstPromptTitle === true,
      isReloading: session.isReloading === true,
      primaryTitle: session.primaryTitle,
      sessionActivity: session.activity,
      sessionId: session.sessionId,
      sessionKind: session.sessionKind,
      terminalTitle: session.terminalTitle,
    });

    const animationFrame = window.requestAnimationFrame(() => {
      const card = findSessionCardElement(session.sessionId);
      const frame = card?.closest<HTMLElement>(".session-frame");
      const trailing = card?.querySelector<HTMLElement>(".session-head-trailing");
      const headerIcon = card?.querySelector<HTMLElement>(
        ".session-header-agent-icon, .session-header-agent-tabler-icon, .session-header-reloading-icon",
      );
      const floatingIcon = frame?.querySelector<HTMLElement>(
        ".session-floating-agent-icon, .session-floating-agent-tabler-icon, .session-floating-reloading-icon",
      );

      postSidebarAgentIconRenderDebugLog(vscode, "sidebar.agentIcon.cardDomState", {
        agentIcon: session.agentIcon,
        card: summarizeAgentIconElement(card),
        defaultTrailingDisplay,
        floatingIcon: summarizeAgentIconElement(floatingIcon),
        frame: summarizeAgentIconElement(frame),
        groupId,
        hasCardElement: Boolean(card),
        hasFloatingIconElement: Boolean(floatingIcon),
        hasHeaderIconElement: Boolean(headerIcon),
        headerIcon: summarizeAgentIconElement(headerIcon),
        hoverTrailingDisplay,
        sessionId: session.sessionId,
        trailing: summarizeAgentIconElement(trailing),
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    groupId,
    hasSessionCardIcon,
    session.activity,
    session.agentIcon,
    session.isGeneratingFirstPromptTitle,
    session.isReloading,
    session.lastInteractionAt,
    session.primaryTitle,
    session.sessionId,
    session.sessionKind,
    session.terminalTitle,
    showLastActiveTime,
    showTerminalSessionIcon,
    vscode,
  ]);

  const openContextMenu = (clientX: number, clientY: number) => {
    setContextMenuPosition(
      clampContextMenuPosition(clientX, clientY, contextMenuItemCount, contextMenuDividerCount),
    );
  };

  const requestRename = () => {
    if (isBrowserSession) {
      return;
    }

    setContextMenuPosition(undefined);
    /**
     * CDXC:AppModals 2026-04-27-14:25
     * Rename must always use the full-window modal host. Missing host is an
     * error, not a reason to show the old squeezed sidebar dialog.
     */
    openAppModal({
      initialTitle: getSessionRenameInitialTitle(session),
      modal: "renameSession",
      sessionId: session.sessionId,
      type: "open",
    });
  };

  const requestClose = (
    source: "context-menu" | "middle-click" | "meta-click" | "programmatic",
  ) => {
    if (isT3Session && showDebugSessionNumbers) {
      vscode.postMessage({
        details: {
          activity: session.activity,
          groupId,
          isFocused: session.isFocused,
          isRunning: session.isRunning,
          isVisible: session.isVisible,
          requestedAt: Date.now(),
          sessionId: session.sessionId,
          source,
          title: session.primaryTitle,
        },
        event: "repro.t3CloseSession.requested",
        type: "sidebarDebugLog",
      });
    }

    setContextMenuPosition(undefined);
    vscode.postMessage({
      sessionId: session.sessionId,
      type: "closeSession",
    });
  };

  const requestCopyResumeCommand = () => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      sessionId: session.sessionId,
      type: "copyResumeCommand",
    });
  };

  const requestCopyAttachCommand = () => {
    setContextMenuPosition(undefined);
    /**
     * CDXC:SessionPersistence 2026-05-07-20:32
     * Provider-backed tmux/zmx/zellij session cards expose the native attach
     * command alongside resume copying, using the stored provider/name pair
     * rather than the current global Settings provider.
     */
    vscode.postMessage({
      sessionId: session.sessionId,
      type: "copyAttachCommand",
    });
  };

  const requestForkSession = () => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      sessionId: session.sessionId,
      type: "forkSession",
    });
  };

  const requestDelayedSend = () => {
    if (!canDelayedSend) {
      return;
    }

    setContextMenuPosition(undefined);
    /**
     * CDXC:DelayedSend 2026-05-11-11:56
     * Terminal session context menus mirror the native title-bar clock action:
     * open the full-window timer modal and let native press Enter later for
     * the command text already staged in that terminal.
     */
    openAppModal({
      delayedSendDeadlineAt: session.delayedSendDeadlineAt,
      delayedSendRemainingLabel: session.delayedSendRemainingLabel,
      modal: "delayedSend",
      sessionId: session.sessionId,
      title: getSessionRenameInitialTitle(session),
      type: "open",
    });
  };

  const requestT3BrowserAccess = () => {
    if (!isT3Session) {
      return;
    }

    setContextMenuPosition(undefined);
    /**
     * CDXC:T3RemoteAccess 2026-05-02-00:57
     * T3 session cards expose Remote Access directly; the controller resolves
     * the share URL and the app modal host owns the centered QR dialog.
     */
    vscode.postMessage({
      sessionId: session.sessionId,
      type: "requestT3SessionBrowserAccess",
    });
  };

  const requestBrowserPaneAction = (
    action: "devtools" | "react-grab" | "profile-picker" | "import-settings",
  ) => {
    if (!isBrowserSession) {
      return;
    }

    setContextMenuPosition(undefined);
    /**
     * CDXC:BrowserPanes 2026-05-02-06:35
     * Browser-pane cards surface the browser-specific controls in their
     * context menu so the sidebar can reach native WebKit features while the
     * browser itself renders as a regular workspace pane.
     */
    vscode.postMessage({
      action,
      sessionId: session.sessionId,
      type: "runBrowserPaneAction",
    });
  };

  const requestGenerateSessionTitle = () => {
    const firstMessage = session.firstUserMessage?.trim();
    if (!firstMessage) {
      return;
    }

    setContextMenuPosition(undefined);
    /**
     * CDXC:SessionNaming 2026-05-08-10:54
     * Generate Title must summarize the captured 1st user message through the
     * normal renameSession flow. That controller path already owns Codex title
     * generation, Agent CLI sync, and the "Generating title..." card loading
     * state, so the sidebar must send the first message as the rename input
     * instead of posting a separate generateSessionName command.
     */
    vscode.postMessage({
      details: {
        agentIcon: session.agentIcon,
        firstUserMessageLength: firstMessage.length,
        isGeneratingFirstPromptTitle: session.isGeneratingFirstPromptTitle === true,
        primaryTitle: session.primaryTitle,
        sessionId: session.sessionId,
        terminalTitle: session.terminalTitle,
      },
      event: "session.generateTitle.clicked",
      type: "sidebarDebugLog",
    });
    vscode.postMessage({
      sessionId: session.sessionId,
      shouldGenerateTitle: true,
      title: firstMessage,
      type: "renameSession",
    });
  };

  const requestFullReloadSession = () => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      sessionId: session.sessionId,
      type: "fullReloadSession",
    });
  };

  const requestPopOutPane = () => {
    if (!canPopOutPane) {
      return;
    }

    setContextMenuPosition(undefined);
    /**
     * CDXC:PanePopOut 2026-05-19-10:15:
     * Browser and agent session cards expose Pop Out Pane in the sidebar context
     * menu. The native controller toggles presentation from the current session
     * record, matching the focused-pane hotkey and tab-bar overflow behavior.
     */
    vscode.postMessage({
      sessionId: session.sessionId,
      type: "popOutPane",
    });
  };

  const requestViewFirstUserMessage = () => {
    const message = session.firstUserMessage?.trim();
    if (!message) {
      return;
    }

    setContextMenuPosition(undefined);
    openAppModal({
      message,
      modal: "firstUserMessage",
      title: getSessionRenameInitialTitle(session),
      type: "open",
    });
  };

  const requestSetSleeping = (sleeping: boolean) => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      sessionId: session.sessionId,
      sleeping,
      type: "setSessionSleeping",
    });
  };

  const requestSetFavorite = (favorite: boolean) => {
    setContextMenuPosition(undefined);
    vscode.postMessage({
      favorite,
      sessionId: session.sessionId,
      type: "setSessionFavorite",
    });
  };

  const primaryActions: SessionContextMenuAction[] = [];
  if (!isBrowserSession) {
    primaryActions.push({
      icon: (
        <IconPencil
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ),
      key: "rename",
      label: "Rename",
      onClick: requestRename,
    });
  }
  if (canFavoriteSession) {
    primaryActions.push({
      icon: (
        <IconStar aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ),
      key: "favorite",
      label: session.isFavorite ? "Unfavorite" : "Favorite",
      onClick: () => requestSetFavorite(!session.isFavorite),
    });
  }
  if (canSleepSession) {
    primaryActions.push({
      icon: session.isSleeping ? (
        <IconPlayerPlay
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ) : (
        <IconMoon aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ),
      key: "sleep",
      label: session.isSleeping ? "Wake" : "Sleep",
      onClick: () => requestSetSleeping(!session.isSleeping),
    });
  }

  const sessionActions: SessionContextMenuAction[] = [];
  if (isBrowserSession) {
    sessionActions.push(
      {
        icon: (
          <IconCode
            aria-hidden="true"
            className="session-context-menu-icon"
            size={16}
            stroke={1.8}
          />
        ),
        key: "browser-devtools",
        label: "DevTools",
        onClick: () => requestBrowserPaneAction("devtools"),
      },
      {
        icon: (
          <IconHandFinger
            aria-hidden="true"
            className="session-context-menu-icon"
            size={16}
            stroke={1.8}
          />
        ),
        key: "browser-react-grab",
        label: "React Grab",
        onClick: () => requestBrowserPaneAction("react-grab"),
      },
      {
        icon: (
          <IconUserCircle
            aria-hidden="true"
            className="session-context-menu-icon"
            size={16}
            stroke={1.8}
          />
        ),
        key: "browser-profile",
        label: "Profile",
        onClick: () => requestBrowserPaneAction("profile-picker"),
      },
      {
        icon: (
          <IconDownload
            aria-hidden="true"
            className="session-context-menu-icon"
            size={16}
            stroke={1.8}
          />
        ),
        key: "browser-import",
        label: "Import Settings",
        onClick: () => requestBrowserPaneAction("import-settings"),
      },
    );
  }
  if (session.firstUserMessage?.trim()) {
    sessionActions.push({
      icon: (
        <IconMessageCircle
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ),
      key: "view-first-message",
      label: "View 1st message",
      onClick: requestViewFirstUserMessage,
    });
  }
  if (isT3Session) {
    sessionActions.push({
      icon: (
        <IconDeviceMobile
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ),
      key: "browser-access",
      label: "Remote Access",
      onClick: requestT3BrowserAccess,
    });
  }
  if (canCopyResumeCommand) {
    sessionActions.push({
      icon: (
        <IconCopy aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ),
      key: "copy-resume",
      label: "Copy resume",
      onClick: requestCopyResumeCommand,
    });
  }
  if (canCopyAttachCommand) {
    sessionActions.push({
      icon: (
        <IconCopy aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ),
      key: "copy-attach",
      label: "Copy attach command",
      onClick: requestCopyAttachCommand,
    });
  }
  if (canDelayedSend) {
    sessionActions.push({
      icon: (
        <IconClock
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ),
      key: "delayed-send",
      label: "Delayed Send",
      onClick: requestDelayedSend,
    });
  }
  if (canForkSession) {
    sessionActions.push({
      icon: (
        <IconGitFork
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ),
      key: "fork",
      label: "Fork",
      onClick: requestForkSession,
    });
  }
  if (canGenerateSessionTitle) {
    /**
     * CDXC:SessionNaming 2026-05-08-10:54
     * Claude and Codex thread cards need a direct "Generate Title" action that
     * retitles the session from the saved 1st user message. The action is only
     * useful once that message exists, because the controller intentionally
     * generates from real user text rather than from title fallbacks.
     */
    sessionActions.push({
      icon: (
        <IconSparkles
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ),
      key: "generate-title",
      label: "Generate Title",
      onClick: requestGenerateSessionTitle,
    });
  }
  if (canFullReloadSession) {
    sessionActions.push({
      icon: (
        <IconRefresh
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ),
      key: "full-reload",
      label: "Full reload",
      onClick: requestFullReloadSession,
    });
  }
  if (canPopOutPane) {
    sessionActions.push({
      icon: session.isPoppedOut ? (
        <IconLayoutSidebarRightExpand
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ) : (
        <IconExternalLink
          aria-hidden="true"
          className="session-context-menu-icon"
          size={16}
          stroke={1.8}
        />
      ),
      key: "pop-out-pane",
      label: session.isPoppedOut ? "Restore Pane" : "Pop Out Pane",
      onClick: requestPopOutPane,
    });
  }

  const destructiveActions: SessionContextMenuAction[] = [
    {
      danger: true,
      icon: (
        <IconX aria-hidden="true" className="session-context-menu-icon" size={16} stroke={1.8} />
      ),
      /**
       * CDXC:SessionClose 2026-05-11-00:45
       * User-facing session removal language is Close. Keep the
       * destructive action behavior unchanged while making terminal, T3, and
       * browser context menus use the same visible verb.
       */
      key: "close",
      label: "Close",
      onClick: () => requestClose("context-menu"),
    },
  ];
  const contextMenuSections = [primaryActions, sessionActions, destructiveActions].filter(
    (section) => section.length > 0,
  );
  const contextMenuItemCount = contextMenuSections.reduce(
    (count, section) => count + section.length,
    0,
  );
  const contextMenuDividerCount = Math.max(0, contextMenuSections.length - 1);

  const requestFocusSession = (
    event?: ReactKeyboardEvent<HTMLElement> | ReactMouseEvent<HTMLElement>,
  ) => {
    const shouldAcknowledgeAttention = session.activity === "attention";
    /**
     * CDXC:SidebarSessionFocus 2026-05-15-20:01:
     * Intermittent sidebar-card clicks can select an existing session through a
     * newly synthesized native split. Persist the DOM click metadata, card
     * focus state, group id, and local-focus decision so a later repro can be
     * matched against native paneLayout resolution instead of guessing which
     * card action fired.
     */
    vscode.postMessage({
      details: {
        activity: session.activity,
        button: event && "button" in event ? event.button : undefined,
        clientX: event && "clientX" in event ? event.clientX : undefined,
        clientY: event && "clientY" in event ? event.clientY : undefined,
        clickDetail: event && "detail" in event ? event.detail : undefined,
        index,
        groupId,
        isFocused: session.isFocused,
        isSleeping: session.isSleeping,
        isVisible: session.isVisible,
        localFocusWillRun: !session.isFocused,
        metaKey: event?.metaKey ?? false,
        requestedAt: Date.now(),
        sessionId: session.sessionId,
        sessionKind: session.sessionKind,
        shiftKey: event?.shiftKey ?? false,
      },
      event: "repro.sidebarSessionFocusRequested",
      type: "sidebarDebugLog",
    });
    if (!session.isFocused) {
      onFocusRequested?.(groupId, session.sessionId);
    }
    vscode.postMessage({ sessionId: session.sessionId, type: "focusSession" });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect();
      openContextMenu(bounds.left + 24, bounds.top + 18);
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    requestFocusSession();
  };

  return (
    <>
      <OverflowTooltipText
        text={sessionTitleTooltip.headingText}
        textRef={aliasHeadingRef}
        tooltip={sessionTitleTooltip.tooltip}
        tooltipWhen={sessionTitleTooltip.tooltipWhen}
      >
        <div
          className="session-frame"
          data-activity={session.activity}
          data-dragging={String(Boolean(sortable.isDragging))}
          data-drop-position={visibleDropPosition}
          data-drop-target={String(isVisibleDropTarget)}
          data-focused={String(session.isFocused)}
          data-group-connector={String(showGroupConnector)}
          data-has-agent-icon={String(hasSessionCardIcon)}
          data-agent-icon-hover-only={String(hideSessionAgentIconUntilHover)}
          data-lifecycle-state={lifecycleState}
          data-running={String(lifecycleState === "running")}
          data-sleeping={String(Boolean(session.isSleeping))}
          data-visible={String(session.isVisible)}
          ref={sortable.ref}
        >
          <div
            aria-hidden
            className="session-drop-target-surface session-drop-target-surface-before"
            ref={beforeDropTarget.ref}
          />
          <div
            aria-hidden
            className="session-drop-target-surface session-drop-target-surface-after"
            ref={afterDropTarget.ref}
          />
          <article
            aria-expanded={contextMenuPosition ? true : undefined}
            aria-haspopup="menu"
            aria-pressed={session.isFocused}
            className="session"
            data-activity={session.activity}
            data-completion-flash={
              completionFlashRunId > 0
                ? completionFlashRunId % 2 === 0
                  ? "even"
                  : "odd"
                : undefined
            }
            data-has-agent-icon={String(hasSessionCardIcon)}
            data-dragging={String(Boolean(sortable.isDragging))}
            data-drop-position={visibleDropPosition}
            data-drop-target={String(isVisibleDropTarget)}
            data-focused={String(session.isFocused)}
            data-group-connector={String(showGroupConnector)}
            data-lifecycle-state={lifecycleState}
            data-agent-icon-hover-only={String(hideSessionAgentIconUntilHover)}
            data-running={String(lifecycleState === "running")}
            data-search-selected={String(isSearchSelected)}
            data-sleeping={String(Boolean(session.isSleeping))}
            data-sidebar-session-id={session.sessionId}
            data-visible={String(session.isVisible)}
            onPointerCancel={(event) => {
              postSessionDragDebugLog("session.pointerCancel", {
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                pointerId: event.pointerId,
                pointerType: event.pointerType,
              });
            }}
            onPointerDown={(event) => {
              postSessionDragDebugLog("session.pointerDown", {
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                isDragging: sortable.isDragging,
                pointerId: event.pointerId,
                pointerType: event.pointerType,
              });
            }}
            onPointerUp={(event) => {
              postSessionDragDebugLog("session.pointerUp", {
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                isDragging: sortable.isDragging,
                pointerId: event.pointerId,
                pointerType: event.pointerType,
              });
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) {
                return;
              }

              event.preventDefault();
              requestClose("middle-click");
            }}
            onClick={(event) => {
              event.stopPropagation();

              if (event.metaKey) {
                event.preventDefault();
                requestClose("meta-click");
                return;
              }

              requestFocusSession(event);
            }}
            onDoubleClick={(event) => {
              if (isBrowserSession || !renameSessionOnDoubleClick) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              requestRename();
            }}
            onContextMenu={(event: ReactMouseEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
              openContextMenu(event.clientX, event.clientY);
            }}
            onKeyDown={handleKeyDown}
            ref={sortable.sourceRef}
            role="button"
            style={sessionAnchorStyle}
            tabIndex={0}
          >
            <SessionFloatingAgentIcon
              agentIcon={session.agentIcon}
              delayedSendRemainingLabel={session.delayedSendRemainingLabel}
              faviconDataUrl={session.faviconDataUrl}
              isFavorite={session.isFavorite}
              isReloading={session.isReloading}
              onDelayedSendClick={requestDelayedSend}
              sessionPersistenceName={session.sessionPersistenceName}
              sessionPersistenceProvider={session.sessionPersistenceProvider}
              showTerminalIcon={showTerminalSessionIcon}
            />
            {/**
             * CDXC:SidebarSessions 2026-05-09-16:55
             * Project and chat session cards route the close-on-hover setting
             * through the same shared row across terminal, agent, T3 Code, and
             * browser panes.
             */}
            <SessionCardContent
              aliasHeadingRef={aliasHeadingRef}
              onDelayedSendClick={requestDelayedSend}
              onClose={() => requestClose("programmatic")}
              session={session}
              showDebugSessionNumbers={showDebugSessionNumbers}
              showCloseButton={showCloseButton}
              showHotkeys={showHotkeys}
              showLastActiveTime={showLastActiveTime}
            />
          </article>
          <div aria-hidden className="session-status-dot session-status-dot-inline" />
        </div>
      </OverflowTooltipText>
      {contextMenuPosition ? (
        <SidebarContextMenuPortal
          menuRef={menuRef}
          menuStyle={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
          }}
          onDismiss={() => {
            setContextMenuPosition(undefined);
          }}
          vscode={vscode}
        >
          {contextMenuSections.map((section, sectionIndex) => (
            <Fragment key={`section-${sectionIndex}`}>
              {sectionIndex > 0 ? (
                <div className="session-context-menu-divider" role="separator" />
              ) : null}
              <div className="session-context-menu-section">
                {section.map((action) => (
                  <button
                    key={action.key}
                    className={`session-context-menu-item${action.danger ? " session-context-menu-item-danger" : ""}`}
                    onClick={action.onClick}
                    role="menuitem"
                    type="button"
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ))}
              </div>
            </Fragment>
          ))}
        </SidebarContextMenuPortal>
      ) : null}
    </>
  );
}

function getSessionRenameInitialTitle(session: SidebarSessionItem): string {
  return session.primaryTitle?.trim() || session.terminalTitle?.trim() || session.alias;
}

function supportsResumeCommandCopy(session: SidebarSessionItem): boolean {
  /**
   * CDXC:SessionRestore 2026-04-27-08:04
   * Match agent-tiler context-menu visibility: Copy resume is only shown for
   * built-in agents with known resume or resume-selection CLI behavior.
   *
   * CDXC:CursorCLI 2026-05-20-08:20:
   * Cursor resume uses stored chat UUIDs or a local title lookup fallback, so
   * Cursor CLI cards expose the same copy-resume affordance as Codex and Pi.
   */
  return (
    session.agentIcon === "codex" ||
    session.agentIcon === "claude" ||
    session.agentIcon === "copilot" ||
    session.agentIcon === "gemini" ||
    session.agentIcon === "opencode" ||
    session.agentIcon === "pi" ||
    session.agentIcon === "cursor-cli"
  );
}

function supportsFork(session: SidebarSessionItem): boolean {
  /**
   * CDXC:PiAgent 2026-05-08-09:42
   * Pi exposes a real `--fork <session>` CLI path once ghostex has captured the
   * Pi session id/path, so Pi cards should show the same one-click Fork action
   * as Codex in the session context menu.
   */
  return (
    session.agentIcon === "codex" ||
    session.agentIcon === "claude" ||
    session.agentIcon === "pi"
  );
}

function supportsGeneratedName(session: SidebarSessionItem): boolean {
  /**
   * CDXC:PiAgent 2026-05-08-16:18
   * Pi cards should expose the same right-click Generate Title action as Codex
   * once the first user message has been captured. The native rename path
   * already switches Pi to `/name <title>`, so the menu gate should include Pi
   * instead of creating a Pi-only title-generation command.
   */
  return (
    session.agentIcon === "codex" ||
    session.agentIcon === "claude" ||
    session.agentIcon === "pi"
  );
}

function supportsPopOutPane(
  session: SidebarSessionItem,
  isBrowserSession: boolean,
  isT3Session: boolean,
): boolean {
  /**
   * CDXC:PanePopOut 2026-05-19-10:15:
   * Sidebar context menus expose pop-out for browser panes and agent terminal
   * sessions. Sleeping sessions dispose their native surface and cannot remain
   * in a detached window; T3 panes keep the native title-bar model unchanged.
   */
  if (session.isSleeping === true || isT3Session) {
    return false;
  }

  if (isBrowserSession) {
    return true;
  }

  return session.sessionKind === "terminal" && Boolean(session.agentIcon);
}

function supportsFullReload(session: SidebarSessionItem): boolean {
  /**
   * CDXC:SessionRestore 2026-04-27-08:04
   * Match agent-tiler context-menu visibility: Full reload is only shown for
   * agent sessions that can be recreated and resumed programmatically.
   *
   * CDXC:PiAgent 2026-05-08-16:18
   * Pi has a restorable CLI identity through its captured session id/path, so
   * right-click Full reload should be visible on Pi cards like it is for Codex.
   *
   * CDXC:CursorCLI 2026-05-20-08:20:
   * Cursor cards can full-reload through stored chat UUIDs or trusted titles
   * resolved from the local Cursor chat store for the active project.
   */
  return (
    session.agentIcon === "codex" ||
    session.agentIcon === "claude" ||
    session.agentIcon === "opencode" ||
    session.agentIcon === "pi" ||
    session.agentIcon === "cursor-cli"
  );
}

function postSidebarAgentIconRenderDebugLog(
  vscode: WebviewApi,
  event: string,
  details: Record<string, unknown>,
): void {
  vscode.postMessage({
    details,
    event,
    type: "sidebarDebugLog",
  });
}

function findSessionCardElement(sessionId: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-session-id]")).find(
    (element) => element.dataset.sidebarSessionId === sessionId,
  );
}

function summarizeAgentIconElement(element: HTMLElement | null | undefined) {
  if (!element) {
    return undefined;
  }

  const styles = window.getComputedStyle(element);
  const bounds = element.getBoundingClientRect();
  return {
    className:
      typeof element.className === "string"
        ? element.className
        : String(element.getAttribute("class") ?? ""),
    dataDefaultTrailingDisplay: element.dataset.defaultTrailingDisplay,
    dataHasAgentIcon: element.dataset.hasAgentIcon,
    dataHoverTrailingDisplay: element.dataset.hoverTrailingDisplay,
    display: styles.display,
    height: Math.round(bounds.height * 100) / 100,
    opacity: styles.opacity,
    visibility: styles.visibility,
    width: Math.round(bounds.width * 100) / 100,
  };
}

let sidebarDebugInstanceCounter = 0;

function createSidebarDebugInstanceId(): number {
  sidebarDebugInstanceCounter += 1;
  return sidebarDebugInstanceCounter;
}
