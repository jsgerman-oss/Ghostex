import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect, useState } from "react";
import { AgentConfigModal, type AgentConfigDraft } from "../../sidebar/agent-config-modal";
import { CommandConfigModal, type CommandConfigDraft } from "../../sidebar/command-config-modal";
import { DaemonSessionsModal } from "../../sidebar/daemon-sessions-modal";
import { DelayedSendModal } from "../../sidebar/delayed-send-modal";
import { FindPreviousSessionModal } from "../../sidebar/find-previous-session-modal";
import { FirstUserMessageModal } from "../../sidebar/first-user-message-modal";
import { PinnedPromptsModal } from "../../sidebar/pinned-prompts-modal";
import { PreviousSessionsModal } from "../../sidebar/previous-sessions-modal";
import { ScratchPadModal } from "../../sidebar/scratch-pad-modal";
import { SettingsModal, type SettingsModalTab } from "../../sidebar/settings-modal";
import { SessionRenameModal } from "../../sidebar/session-rename-modal";
import { T3BrowserAccessModal } from "../../sidebar/t3-browser-access-modal";
import { T3ThreadIdModal } from "../../sidebar/t3-thread-id-modal";
import type { SidebarActionType } from "../../shared/sidebar-commands";
import type {
  ExtensionToSidebarMessage,
  SidebarZmuxFolderStatsMessage,
} from "../../shared/session-grid-contract";
import {
  getWorkspaceThemeForeground,
  normalizeWorkspaceThemeColor,
} from "../../shared/workspace-dock-icons";
import {
  installAppModalGlobalErrorLogging,
  logAppModalError,
} from "../../sidebar/app-modal-error-log";
import { postAppModalHostMessage } from "../../sidebar/app-modal-host-bridge";
import { useSidebarStore } from "../../sidebar/sidebar-store";
import type { WebviewApi } from "../../sidebar/webview-api";
import "../../sidebar/styles.css";

type AppModalKind =
  | "agentConfig"
  | "commandConfig"
  | "configureActions"
  | "configureAgents"
  | "daemonSessions"
  | "delayedSend"
  | "findPreviousSession"
  | "hotkeys"
  | "openTargets"
  | "pinnedPrompts"
  | "previousSessions"
  | "firstUserMessage"
  | "renameSession"
  | "scratchPad"
  | "settings"
  | "t3BrowserAccess"
  | "t3ThreadId";

type T3BrowserAccessMessage = Extract<ExtensionToSidebarMessage, { type: "showT3BrowserAccess" }>;

type AppModalHostMessage =
  | {
      agentDraft?: AgentConfigDraft;
      access?: T3BrowserAccessMessage;
      commandDraft?: CommandConfigDraft;
      initialTitle?: string;
      initialQuery?: string;
      message?: string;
      lockedActionType?: SidebarActionType;
      modal: AppModalKind;
      sessionId?: string;
      threadId?: string;
      title?: string;
      type: "open";
    }
  | { type: "close" }
  | { details?: string; event: string; type: "debugLog" }
  | { modal: AppModalKind; type: "presented" }
  | { message: unknown; type: "sidebarState" };

type RenameSessionModalState = {
  initialTitle: string;
  sessionId: string;
};

type FirstUserMessageModalState = {
  message: string;
  title?: string;
};

type DelayedSendModalState = {
  sessionId: string;
  title?: string;
};

type FindPreviousSessionModalState = {
  initialQuery?: string;
};

type T3ThreadIdModalState = {
  currentThreadId: string;
  sessionId: string;
};

type ConfigModalState = {
  agentDraft?: AgentConfigDraft;
  commandDraft?: CommandConfigDraft;
  lockedActionType?: SidebarActionType;
};

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        zmuxAppModalHost?: {
          postMessage: (message: unknown) => void;
        };
        zmuxNativeHost?: {
          postMessage: (message: unknown) => void;
        };
        zmuxNativeHostDiagnostics?: {
          postMessage: (message: unknown) => void;
        };
        zmuxWorkspaceBar?: {
          postMessage: (message: unknown) => void;
        };
      };
    };
  }
}

const vscode: WebviewApi = {
  postMessage(message) {
    console.debug("[zmux-app-modal-host] sidebarCommand", message);
    /**
     * CDXC:PreviousSessions 2026-05-07-16:02
     * Previous-session search crosses the full-window modal host before the
     * native sidebar handles it. Log every modal command at this boundary so a
     * dead Find Session button can be traced to React, WebKit, or native code.
     */
    postAppModalHostMessage({ message, type: "sidebarCommand" }, "AppModals:sidebarCommand");
  },
};

function closeModal() {
  postAppModalHostMessage({ type: "close" }, "AppModals:close");
}

function isSettingsModalKind(modal: AppModalKind | undefined): boolean {
  return (
    modal === "settings" ||
    modal === "configureAgents" ||
    modal === "configureActions" ||
    modal === "openTargets" ||
    modal === "hotkeys"
  );
}

function getSettingsInitialTab(modal: AppModalKind | undefined): SettingsModalTab {
  /**
   * CDXC:UnifiedSettings 2026-05-09-15:30
   * Existing entry points still request their historic modal kind, but the
   * app-modal host now routes Settings, Agents, Actions, and Hotkeys into one
   * tabbed Settings dialog so users have a single configuration surface.
   */
  if (modal === "configureAgents") {
    return "agents";
  }
  if (modal === "configureActions") {
    return "actions";
  }
  if (modal === "hotkeys") {
    return "hotkeys";
  }
  if (modal === "openTargets") {
    return "openTargets";
  }
  return "settings";
}

function AppModalHost() {
  const {
    activeModal,
    config,
    delayedSend,
    findPreviousSession,
    firstUserMessage,
    renameSession,
    t3BrowserAccess,
    t3ThreadId,
    zmuxFolderStats,
  } = useModalStateFromNative();
  const [zmuxFolderStatsLoading, setZmuxFolderStatsLoading] = useState(false);
  const settings = useSidebarStore((state) => state.hud.settings);
  const customThemeColor = useSidebarStore((state) => state.hud.customThemeColor);
  const theme = useSidebarStore((state) => state.hud.theme);
  const isSettingsRenderable = isSettingsModalKind(activeModal) && settings !== undefined;
  const settingsInitialTab = getSettingsInitialTab(activeModal);
  const isActiveModalRenderable = isModalRenderable({
    activeModal,
    config,
    delayedSend,
    findPreviousSession,
    firstUserMessage,
    renameSession,
    settings,
    t3BrowserAccess,
    t3ThreadId,
  });

  /**
   * CDXC:AppModals 2026-05-08-09:00
   * Native should unhide the transparent modal webview only after the requested
   * modal has enough state to render. This prevents a blank overlay flash while
   * sidebar state is still syncing into the app-modal host.
   */
  useLayoutEffect(() => {
    if (!activeModal || !isActiveModalRenderable) {
      return;
    }
    postAppModalHostMessage(
      {
        modal: activeModal,
        type: "presented",
      },
      "AppModals:presented",
    );
  }, [activeModal, isActiveModalRenderable]);

  useEffect(() => {
    if (activeModal !== "settings") {
      setZmuxFolderStatsLoading(false);
    }
  }, [activeModal]);

  useEffect(() => {
    if (zmuxFolderStats) {
      setZmuxFolderStatsLoading(false);
    }
  }, [zmuxFolderStats]);

  useEffect(() => {
    document.body.dataset.sidebarTheme = theme;
    const normalizedThemeColor = normalizeWorkspaceThemeColor(customThemeColor);
    if (normalizedThemeColor) {
      document.body.dataset.sidebarCustomTheme = "true";
      document.body.style.setProperty("--workspace-sidebar-theme-color", normalizedThemeColor);
      document.body.style.setProperty(
        "--workspace-sidebar-theme-foreground",
        getWorkspaceThemeForeground(normalizedThemeColor),
      );
    } else {
      delete document.body.dataset.sidebarCustomTheme;
      document.body.style.removeProperty("--workspace-sidebar-theme-color");
      document.body.style.removeProperty("--workspace-sidebar-theme-foreground");
    }

    return () => {
      delete document.body.dataset.sidebarTheme;
      delete document.body.dataset.sidebarCustomTheme;
      document.body.style.removeProperty("--workspace-sidebar-theme-color");
      document.body.style.removeProperty("--workspace-sidebar-theme-foreground");
    };
  }, [customThemeColor, theme]);

  return (
    <>
      <PreviousSessionsModal
        isOpen={activeModal === "previousSessions"}
        onClose={closeModal}
        vscode={vscode}
      />
      <PinnedPromptsModal
        isOpen={activeModal === "pinnedPrompts"}
        onClose={closeModal}
        vscode={vscode}
      />
      <FirstUserMessageModal
        isOpen={activeModal === "firstUserMessage" && firstUserMessage !== undefined}
        message={firstUserMessage?.message ?? ""}
        onClose={closeModal}
        title={firstUserMessage?.title}
      />
      <DaemonSessionsModal
        isOpen={activeModal === "daemonSessions"}
        onClose={closeModal}
        vscode={vscode}
      />
      <FindPreviousSessionModal
        initialQuery={findPreviousSession?.initialQuery}
        isOpen={activeModal === "findPreviousSession"}
        onCancel={closeModal}
        onConfirm={(query) => {
          console.debug("[zmux-app-modal-host] findPreviousSession.confirm", {
            queryLength: query.trim().length,
          });
          vscode.postMessage({
            query,
            type: "promptFindPreviousSession",
          });
          closeModal();
        }}
      />
      <DelayedSendModal
        isOpen={activeModal === "delayedSend" && delayedSend !== undefined}
        onCancel={closeModal}
        onConfirm={(delayMs) => {
          if (!delayedSend) {
            return;
          }
          vscode.postMessage({
            delayMs,
            sessionId: delayedSend.sessionId,
            type: "scheduleDelayedSend",
          });
          closeModal();
        }}
        sessionTitle={delayedSend?.title}
      />
      <ScratchPadModal
        isOpen={activeModal === "scratchPad"}
        onClose={closeModal}
        onDebug={(event, details) => {
          /**
           * CDXC:ScratchPadFocus 2026-04-28-05:21
           * Scratch Pad focus repros run inside the full-window modal host, not
           * the narrow sidebar webview. Forward those modal-host events through
           * the normal sidebar command bridge so native logs can correlate
           * textarea blur/focus with terminal first-responder changes.
           */
          vscode.postMessage({
            details,
            event,
            type: "sidebarDebugLog",
          });
        }}
        onSave={(content) => {
          vscode.postMessage({
            content,
            type: "saveScratchPad",
          });
        }}
      />
      <SettingsModal
        accessibilityPermissionGranted={window.__zmux_NATIVE_HOST__?.accessibilityPermissionGranted}
        initialTab={settingsInitialTab}
        isOpen={isSettingsRenderable}
        onChange={(nextSettings) => {
          vscode.postMessage({
            settings: nextSettings,
            type: "updateSettings",
          });
        }}
        onGhosttySettingsAction={(action) => {
          vscode.postMessage({ type: action });
        }}
        onInstallZapet={() => {
          vscode.postMessage({ type: "installZapet" });
        }}
        onPlayCompletionSound={(sound) => {
          vscode.postMessage({ sound, type: "playCompletionSoundPreview" });
        }}
        onOpenAccessibilityPreferences={() => {
          /**
           * CDXC:AccessibilityPermissions 2026-05-08-13:08
           * The settings modal button should open macOS Accessibility settings
           * directly. It must not reuse the attach-enable prompt path because
           * viewing status is not consent to enable IDE attachment.
           */
          vscode.postMessage({ type: "openAccessibilityPreferences" });
        }}
        onOpenMacOSNotificationSettings={() => {
          vscode.postMessage({ type: "openMacOSNotificationSettings" });
        }}
        onOpenZmuxFolder={() => {
          vscode.postMessage({ type: "openZmuxFolder" });
        }}
        onRequestMacOSNotificationPermission={() => {
          vscode.postMessage({ type: "requestMacOSNotificationPermission" });
        }}
        onRequestZmuxFolderStats={() => {
          setZmuxFolderStatsLoading(true);
          vscode.postMessage({ type: "requestZmuxFolderStats" });
        }}
        onTestAgentTaskCompletion={() => {
          vscode.postMessage({ type: "testAgentTaskCompletion" });
        }}
        onClose={closeModal}
        settings={settings}
        vscode={vscode}
        zmuxFolderStats={zmuxFolderStats}
        zmuxFolderStatsLoading={zmuxFolderStatsLoading}
      />
      <T3ThreadIdModal
        currentThreadId={t3ThreadId?.currentThreadId ?? ""}
        isOpen={activeModal === "t3ThreadId" && t3ThreadId !== undefined}
        onCancel={closeModal}
        onConfirm={(threadId) => {
          if (!t3ThreadId) {
            return;
          }
          vscode.postMessage({
            sessionId: t3ThreadId.sessionId,
            threadId,
            type: "setT3SessionThreadId",
          });
          closeModal();
        }}
      />
      <T3BrowserAccessModal
        access={t3BrowserAccess}
        isOpen={activeModal === "t3BrowserAccess" && t3BrowserAccess !== undefined}
        onClose={closeModal}
        onOpenLink={(url) => {
          vscode.postMessage({
            type: "openT3SessionBrowserAccessLink",
            url,
          });
        }}
      />
      <SessionRenameModal
        initialTitle={renameSession?.initialTitle ?? ""}
        isOpen={activeModal === "renameSession" && renameSession !== undefined}
        onCancel={closeModal}
        onConfirm={(title, options) => {
          if (!renameSession) {
            return;
          }
          vscode.postMessage({
            sessionId: renameSession.sessionId,
            ...(options?.shouldGenerateTitle ? { shouldGenerateTitle: true } : {}),
            title,
            type: "renameSession",
          });
          closeModal();
        }}
      />
      <CommandConfigModal
        draft={config.commandDraft ?? createEmptyCommandDraft()}
        isOpen={activeModal === "commandConfig" && config.commandDraft !== undefined}
        lockedActionType={config.lockedActionType}
        onCancel={closeModal}
        onSave={(draft) => {
          vscode.postMessage({
            actionType: draft.actionType,
            closeTerminalOnExit: draft.closeTerminalOnExit,
            command: draft.command,
            commandId: draft.commandId,
            icon: draft.icon,
            iconColor: draft.iconColor,
            isGlobal: draft.isGlobal,
            name: draft.name,
            playCompletionSound: draft.playCompletionSound,
            type: "saveSidebarCommand",
            url: draft.url,
          });
          closeModal();
        }}
      />
      <AgentConfigModal
        draft={config.agentDraft ?? createEmptyAgentDraft()}
        isOpen={activeModal === "agentConfig" && config.agentDraft !== undefined}
        onCancel={closeModal}
        onSave={(draft) => {
          vscode.postMessage({
            agentId: draft.agentId,
            command: draft.command,
            icon: draft.icon,
            name: draft.name,
            type: "saveSidebarAgent",
          });
          closeModal();
        }}
      />
    </>
  );
}

/**
 * CDXC:AppModals 2026-04-26-15:10
 * Sidebar-owned modals must render from a full-window host so settings and
 * other management dialogs center over the whole application instead of being
 * constrained by the narrow sidebar WKWebView.
 */
function useModalStateFromNative() {
  const [activeModal, setActiveModal] = useState<AppModalKind | undefined>();
  const [config, setConfig] = useState<ConfigModalState>({});
  const [delayedSend, setDelayedSend] = useState<DelayedSendModalState>();
  const [findPreviousSession, setFindPreviousSession] = useState<FindPreviousSessionModalState>();
  const [firstUserMessage, setFirstUserMessage] = useState<FirstUserMessageModalState>();
  const [renameSession, setRenameSession] = useState<RenameSessionModalState>();
  const [t3BrowserAccess, setT3BrowserAccess] = useState<T3BrowserAccessMessage>();
  const [t3ThreadId, setT3ThreadId] = useState<T3ThreadIdModalState>();
  const [zmuxFolderStats, setZmuxFolderStats] = useState<SidebarZmuxFolderStatsMessage>();

  useEffect(() => {
    const handleMessage = (event: Event) => {
      try {
        const message = (event as CustomEvent<AppModalHostMessage>).detail;
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "open") {
          postAppModalHostMessage(
            {
              details: JSON.stringify({
                hasSettings: useSidebarStore.getState().hud.settings !== undefined,
                modal: message.modal,
                performanceNow: performance.now(),
              }),
              event: "modalHost.open.received",
              type: "debugLog",
            },
            "AppModals:debug",
          );
          if (message.modal === "renameSession") {
            if (!message.sessionId) {
              throw new Error("Rename modal request is missing sessionId.");
            }
            setRenameSession({
              initialTitle: message.initialTitle ?? "",
              sessionId: message.sessionId,
            });
            setConfig({});
            setDelayedSend(undefined);
            setFindPreviousSession(undefined);
            setFirstUserMessage(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          } else if (message.modal === "firstUserMessage") {
            if (typeof message.message !== "string" || !message.message.trim()) {
              throw new Error("First message modal request is missing message text.");
            }
            setFirstUserMessage({
              message: message.message,
              title: typeof message.title === "string" ? message.title : undefined,
            });
            setConfig({});
            setDelayedSend(undefined);
            setFindPreviousSession(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          } else if (message.modal === "delayedSend") {
            if (!message.sessionId) {
              throw new Error("Delayed Send modal request is missing sessionId.");
            }
            setDelayedSend({
              sessionId: message.sessionId,
              title: typeof message.title === "string" ? message.title : undefined,
            });
            setConfig({});
            setFindPreviousSession(undefined);
            setFirstUserMessage(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          } else if (message.modal === "findPreviousSession") {
            setFindPreviousSession({
              initialQuery:
                typeof message.initialQuery === "string" ? message.initialQuery : undefined,
            });
            setConfig({});
            setDelayedSend(undefined);
            setFirstUserMessage(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          } else if (message.modal === "t3BrowserAccess") {
            if (!message.access) {
              throw new Error("T3 browser access modal request is missing access details.");
            }
            /**
             * CDXC:T3RemoteAccess 2026-05-02-00:57
             * The Remote Access QR dialog must be owned by the full-window app
             * modal host so the QR code centers over zmux instead of rendering
             * inside the narrow sidebar webview.
             */
            setT3BrowserAccess(message.access);
            setConfig({});
            setDelayedSend(undefined);
            setFindPreviousSession(undefined);
            setFirstUserMessage(undefined);
            setRenameSession(undefined);
            setT3ThreadId(undefined);
          } else if (message.modal === "t3ThreadId") {
            if (!message.sessionId || typeof message.threadId !== "string") {
              throw new Error("T3 thread id modal request is missing sessionId or threadId.");
            }
            setT3ThreadId({
              currentThreadId: message.threadId,
              sessionId: message.sessionId,
            });
            setConfig({});
            setDelayedSend(undefined);
            setFindPreviousSession(undefined);
            setFirstUserMessage(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
          } else if (message.modal === "commandConfig") {
            if (!message.commandDraft) {
              throw new Error("Command config modal request is missing commandDraft.");
            }
            setConfig({
              commandDraft: message.commandDraft,
              lockedActionType: message.lockedActionType,
            });
            setDelayedSend(undefined);
            setFirstUserMessage(undefined);
            setFindPreviousSession(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          } else if (message.modal === "agentConfig") {
            if (!message.agentDraft) {
              throw new Error("Agent config modal request is missing agentDraft.");
            }
            setConfig({ agentDraft: message.agentDraft });
            setDelayedSend(undefined);
            setFirstUserMessage(undefined);
            setFindPreviousSession(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          } else {
            setConfig({});
            setDelayedSend(undefined);
            setFindPreviousSession(undefined);
            setFirstUserMessage(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          }
          if (message.modal === "settings") {
            setZmuxFolderStats(undefined);
          }
          setActiveModal(message.modal);
          return;
        }

        if (message.type === "close") {
          postAppModalHostMessage(
            {
              details: JSON.stringify({ performanceNow: performance.now() }),
              event: "modalHost.close.received",
              type: "debugLog",
            },
            "AppModals:debug",
          );
          setActiveModal(undefined);
          setConfig({});
          setDelayedSend(undefined);
          setFindPreviousSession(undefined);
          setFirstUserMessage(undefined);
          setRenameSession(undefined);
          setT3BrowserAccess(undefined);
          setT3ThreadId(undefined);
          setZmuxFolderStats(undefined);
          return;
        }

        if (message.type === "sidebarState") {
          if (isZmuxFolderStatsMessage(message.message)) {
            setZmuxFolderStats(message.message);
            return;
          }
          applySidebarStateMessage(message.message);
        }
      } catch (error) {
        logAppModalError("AppModals:hostMessage", error);
        throw error;
      }
    };

    window.addEventListener("zmux-app-modal-host-message", handleMessage);
    postAppModalHostMessage({ type: "ready" }, "AppModals:ready");
    return () => {
      window.removeEventListener("zmux-app-modal-host-message", handleMessage);
    };
  }, []);

  return {
    activeModal,
    config,
    delayedSend,
    findPreviousSession,
    firstUserMessage,
    renameSession,
    t3BrowserAccess,
    t3ThreadId,
    zmuxFolderStats,
  };
}

function isZmuxFolderStatsMessage(message: unknown): message is SidebarZmuxFolderStatsMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "zmuxFolderStats",
  );
}

function createEmptyCommandDraft(): CommandConfigDraft {
  return {
    actionType: "terminal",
    closeTerminalOnExit: false,
    name: "",
    playCompletionSound: false,
  };
}

function createEmptyAgentDraft(): AgentConfigDraft {
  return {
    command: "",
    name: "",
  };
}

function isModalRenderable({
  activeModal,
  config,
  delayedSend,
  findPreviousSession,
  firstUserMessage,
  renameSession,
  settings,
  t3BrowserAccess,
  t3ThreadId,
}: {
  activeModal: AppModalKind | undefined;
  config: ConfigModalState;
  delayedSend: DelayedSendModalState | undefined;
  findPreviousSession: FindPreviousSessionModalState | undefined;
  firstUserMessage: FirstUserMessageModalState | undefined;
  renameSession: RenameSessionModalState | undefined;
  settings: unknown;
  t3BrowserAccess: T3BrowserAccessMessage | undefined;
  t3ThreadId: T3ThreadIdModalState | undefined;
}): boolean {
  switch (activeModal) {
    case undefined:
      return false;
    case "agentConfig":
      return config.agentDraft !== undefined;
    case "commandConfig":
      return config.commandDraft !== undefined;
    case "delayedSend":
      return delayedSend !== undefined;
    case "findPreviousSession":
      return findPreviousSession !== undefined;
    case "firstUserMessage":
      return firstUserMessage !== undefined;
    case "renameSession":
      return renameSession !== undefined;
    case "settings":
    case "configureActions":
    case "configureAgents":
    case "hotkeys":
    case "openTargets":
      return settings !== undefined;
    case "t3BrowserAccess":
      return t3BrowserAccess !== undefined;
    case "t3ThreadId":
      return t3ThreadId !== undefined;
    case "daemonSessions":
    case "pinnedPrompts":
    case "previousSessions":
    case "scratchPad":
      return true;
  }
}

function applySidebarStateMessage(message: unknown) {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return;
  }

  if (message.type === "hydrate" || message.type === "sessionState") {
    useSidebarStore
      .getState()
      .applySidebarMessage(
        message as Parameters<
          ReturnType<typeof useSidebarStore.getState>["applySidebarMessage"]
        >[0],
      );
    return;
  }

  if (message.type === "daemonSessionsState") {
    useSidebarStore
      .getState()
      .setDaemonSessionsState(
        message as Parameters<
          ReturnType<typeof useSidebarStore.getState>["setDaemonSessionsState"]
        >[0],
      );
  }
}

document.body.classList.add("app-modal-host-body");
installAppModalGlobalErrorLogging("AppModals:modalHost");
createRoot(document.getElementById("root")!).render(<AppModalHost />);
