import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AgentConfigModal, type AgentConfigDraft } from "../../sidebar/agent-config-modal";
import { AgentsHubModal } from "../../sidebar/agents-hub-modal";
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
  | "agentsHub"
  | "commandConfig"
  | "configureActions"
  | "configureAgents"
  | "daemonSessions"
  | "delayedSend"
  | "findPreviousSession"
  | "hotkeys"
  | "openTargets"
  | "pinnedPrompts"
  | "floatingPromptEditor"
  | "previousSessions"
  | "firstUserMessage"
  | "renameSession"
  | "scratchPad"
  | "settings"
  | "t3BrowserAccess"
  | "t3ThreadId";

type T3BrowserAccessMessage = Extract<ExtensionToSidebarMessage, { type: "showT3BrowserAccess" }>;
type AgentsHubCatalogMessage = Extract<ExtensionToSidebarMessage, { type: "agentsHubCatalog" }>;

type AppModalHostMessage =
  | {
      agentDraft?: AgentConfigDraft;
      access?: T3BrowserAccessMessage;
      commandDraft?: CommandConfigDraft;
      initialTitle?: string;
      initialQuery?: string;
      message?: string;
      filePath?: string;
      initialFrame?: FloatingPromptEditorFrame;
      initialText?: string;
      lockedActionType?: SidebarActionType;
      language?: string;
      modal: AppModalKind;
      requestId?: string;
      sessionId?: string;
      statusFile?: string;
      threadId?: string;
      title?: string;
      type: "open";
    }
  | { type: "close" }
  | { details?: string; event: string; type: "debugLog" }
  | { requestId: string; type: "floatingPromptEditorCloseAndSave" }
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

type FloatingPromptEditorFrame = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type FloatingPromptEditorState = {
  filePath: string;
  initialFrame?: FloatingPromptEditorFrame;
  initialText: string;
  language: string;
  requestId: string;
  statusFile?: string;
  title: string;
};

type FloatingPromptEditorDragMode = "move" | "resize";

const floatingPromptEditorFrameMargin = 16;
const floatingPromptEditorDefaultHeight = 320;
const floatingPromptEditorDefaultWidth = 400;
const floatingPromptEditorMaximumWidth = 700;
/**
 * CDXC:PromptEditor 2026-05-14-09:55:
 * Users can shrink the floating prompt editor after expanding it. The minimum
 * width must still leave room for both titlebar actions anchored to the live
 * right edge, while the title and shortcut text truncate first.
 */
const floatingPromptEditorMinimumWidth = 220;

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

type MonacoEditorInstance = {
  dispose: () => void;
  focus?: () => void;
  getModel: () => unknown;
  getValue: () => string;
  layout: () => void;
  onDidChangeModelContent: (listener: () => void) => { dispose: () => void };
  setValue: (value: string) => void;
};

type MonacoAmdRequire = {
  (dependencies: string[], onLoad: () => void, onError?: (error: unknown) => void): void;
  config?: (config: Record<string, unknown>) => void;
};

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

let modalHostMonacoLoadPromise: Promise<void> | undefined;

function getModalHostMonacoRequire(): MonacoAmdRequire | undefined {
  return (window as unknown as { require?: MonacoAmdRequire }).require;
}

function loadModalHostMonaco(): Promise<void> {
  if (window.monaco) {
    return Promise.resolve();
  }
  if (modalHostMonacoLoadPromise) {
    return modalHostMonacoLoadPromise;
  }
  modalHostMonacoLoadPromise = new Promise((resolve, reject) => {
    window.MonacoEnvironment = {
      getWorkerUrl: () => "./monaco/vs/base/worker/workerMain.js",
    };
    const configureRequire = () => {
      const amdRequire = getModalHostMonacoRequire();
      if (!amdRequire) {
        reject(new Error("Monaco AMD loader did not initialize."));
        return;
      }
      amdRequire.config?.({ paths: { vs: "./monaco/vs" } });
      amdRequire(["vs/editor/editor.main"], resolve, reject);
    };
    const existingLoader = document.querySelector<HTMLScriptElement>(
      'script[data-zmux-monaco-loader="true"]',
    );
    if (existingLoader) {
      existingLoader.addEventListener("load", configureRequire, { once: true });
      existingLoader.addEventListener("error", () => reject(new Error("Monaco loader failed.")), {
        once: true,
      });
      if (getModalHostMonacoRequire()) {
        configureRequire();
      }
      return;
    }
    const script = document.createElement("script");
    script.dataset.zmuxMonacoLoader = "true";
    script.src = "./monaco/vs/loader.js";
    script.addEventListener("load", configureRequire, { once: true });
    script.addEventListener("error", () => reject(new Error("Monaco loader failed.")), {
      once: true,
    });
    document.head.appendChild(script);
  });
  return modalHostMonacoLoadPromise;
}

function clampFloatingPromptEditorFrame(frame: FloatingPromptEditorFrame): FloatingPromptEditorFrame {
  const margin = floatingPromptEditorFrameMargin;
  const availableWidth = Math.max(240, window.innerWidth - margin * 2);
  const maxWidth = Math.min(floatingPromptEditorMaximumWidth, availableWidth);
  const minWidth = Math.min(floatingPromptEditorMinimumWidth, maxWidth);
  const minHeight = Math.min(260, Math.max(180, window.innerHeight - margin * 2));
  const width = Math.min(Math.max(frame.width, minWidth), maxWidth);
  const height = Math.min(
    Math.max(frame.height, minHeight),
    Math.max(minHeight, window.innerHeight - margin * 2),
  );
  return {
    height,
    left: Math.min(Math.max(margin, frame.left), Math.max(margin, window.innerWidth - width - margin)),
    top: Math.min(Math.max(margin, frame.top), Math.max(margin, window.innerHeight - height - margin)),
    width,
  };
}

function defaultFloatingPromptEditorFrame(): FloatingPromptEditorFrame {
  const availableWidth = Math.max(240, window.innerWidth - floatingPromptEditorFrameMargin * 2);
  const defaultHeight = Math.min(
    floatingPromptEditorDefaultHeight,
    Math.max(180, window.innerHeight - floatingPromptEditorFrameMargin * 2),
  );
  const defaultWidth = Math.min(
    floatingPromptEditorDefaultWidth,
    Math.max(floatingPromptEditorMinimumWidth, availableWidth),
  );
  return clampFloatingPromptEditorFrame({
    height: defaultHeight,
    left: Math.max(floatingPromptEditorFrameMargin, (window.innerWidth - defaultWidth) / 2),
    top: Math.max(floatingPromptEditorFrameMargin, window.innerHeight - defaultHeight - floatingPromptEditorFrameMargin),
    width: defaultWidth,
  });
}

function FloatingPromptEditorModal({
  closeAndSaveRequestId,
  editor,
  isOpen,
}: {
  closeAndSaveRequestId?: string;
  editor?: FloatingPromptEditorState;
  isOpen: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const [frame, setFrame] = useState<FloatingPromptEditorFrame>(() => defaultFloatingPromptEditorFrame());
  const [dragMode, setDragMode] = useState<FloatingPromptEditorDragMode>();
  const [isCancelConfirming, setIsCancelConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const activePointerDragCleanupRef = useRef<(() => void) | undefined>(undefined);
  const cancelConfirmTimeoutRef = useRef<number | undefined>(undefined);
  const savedCloseAndSaveRequestIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen || !editor) {
      editorRef.current?.dispose();
      editorRef.current = null;
      window.clearTimeout(cancelConfirmTimeoutRef.current);
      cancelConfirmTimeoutRef.current = undefined;
      activePointerDragCleanupRef.current?.();
      activePointerDragCleanupRef.current = undefined;
      setDragMode(undefined);
      setIsCancelConfirming(false);
      setIsSaving(false);
      return;
    }
    setFrame(clampFloatingPromptEditorFrame(editor.initialFrame ?? defaultFloatingPromptEditorFrame()));
    setIsCancelConfirming(false);
  }, [editor?.requestId, isOpen]);

  useEffect(() => {
    if (!isOpen || !editor || !containerRef.current) {
      return;
    }
    let disposed = false;
    loadModalHostMonaco()
      .then(() => {
        if (disposed || !containerRef.current || !window.monaco) {
          return;
        }
        editorRef.current?.dispose();
        /**
         * CDXC:PromptEditor 2026-05-13-09:48
         * Ctrl+G prompt editing is plain text entry, not code authoring.
         * Disable Monaco's word/spelling-style suggestions, trigger
         * completions, snippets, and parameter hints; force Markdown with
         * wrapping because prompt text should read naturally in the default
         * writing pane.
         */
        const monacoEditor = window.monaco.editor.create(containerRef.current, {
          acceptSuggestionOnEnter: "off",
          automaticLayout: true,
          cursorBlinking: "smooth",
          fontFamily:
            "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
          fontLigatures: true,
          fontSize: 14,
          language: "markdown",
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          padding: { bottom: 48, top: 12 },
          parameterHints: { enabled: false },
          quickSuggestions: false,
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          snippetSuggestions: "none",
          suggestOnTriggerCharacters: false,
          tabCompletion: "off",
          theme: "vs-dark",
          value: editor.initialText,
          wordBasedSuggestions: "off",
          wordWrap: "on",
        }) as MonacoEditorInstance;
        editorRef.current = monacoEditor;
        monacoEditor.focus?.();
      })
      .catch((error) => {
        postAppModalHostMessage(
          {
            area: "PromptEditor:monaco",
            message: error instanceof Error ? error.message : String(error),
            type: "logError",
          },
          "PromptEditor:monaco",
        );
      });
    return () => {
      disposed = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [editor?.requestId, isOpen]);

  useEffect(() => {
    editorRef.current?.layout();
  }, [frame.height, frame.width]);

  useEffect(() => {
    return () => {
      activePointerDragCleanupRef.current?.();
      activePointerDragCleanupRef.current = undefined;
    };
  }, []);

  const save = () => {
    if (!editor || isSaving) {
      return;
    }
    setIsSaving(true);
    postAppModalHostMessage(
      {
        filePath: editor.filePath,
        requestId: editor.requestId,
        statusFile: editor.statusFile,
        text: editorRef.current?.getValue() ?? editor.initialText,
        type: "floatingPromptEditorSave",
      },
      "PromptEditor:save",
    );
  };

  const requestCancel = () => {
    if (!editor) {
      return;
    }
    if (!isCancelConfirming) {
      setIsCancelConfirming(true);
      window.clearTimeout(cancelConfirmTimeoutRef.current);
      cancelConfirmTimeoutRef.current = window.setTimeout(() => {
        setIsCancelConfirming(false);
        cancelConfirmTimeoutRef.current = undefined;
      }, 5000);
      return;
    }
    window.clearTimeout(cancelConfirmTimeoutRef.current);
    cancelConfirmTimeoutRef.current = undefined;
    postAppModalHostMessage(
      {
        requestId: editor.requestId,
        statusFile: editor.statusFile,
        type: "floatingPromptEditorCancel",
      },
      "PromptEditor:cancel",
    );
  };

  useEffect(() => {
    if (!isOpen || !editor) {
      return;
    }
    /**
     * CDXC:PromptEditor 2026-05-13-15:53
     * Inside the Ctrl+G floating prompt editor, Ctrl+G must save the live Monaco text instead of only opening the editor from the terminal. Escape mirrors the Cancel button: the first press turns Cancel into Confirm, and a second press within five seconds cancels the editor.
     * Save and Cancel tooltips must name those keyboard paths so hover help matches the behavior.
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.ctrlKey && !event.altKey && !event.metaKey && key === "g") {
        event.preventDefault();
        event.stopPropagation();
        save();
        return;
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && key === "escape") {
        event.preventDefault();
        event.stopPropagation();
        requestCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [editor?.requestId, isCancelConfirming, isOpen, isSaving]);

  useEffect(() => {
    if (
      !isOpen ||
      !editor ||
      !closeAndSaveRequestId ||
      closeAndSaveRequestId !== editor.requestId ||
      savedCloseAndSaveRequestIdRef.current === closeAndSaveRequestId
    ) {
      return;
    }
    savedCloseAndSaveRequestIdRef.current = closeAndSaveRequestId;
    save();
  }, [closeAndSaveRequestId, editor?.requestId, isOpen]);

  if (!isOpen || !editor) {
    return null;
  }

  const beginPanelPointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: FloatingPromptEditorDragMode,
    getNextFrame: (
      moveEvent: PointerEvent,
      startFrame: FloatingPromptEditorFrame,
      startX: number,
      startY: number,
    ) => FloatingPromptEditorFrame,
  ) => {
    if (event.button !== 0) {
      return;
    }

    /**
     * CDXC:PromptEditor 2026-05-13-23:22:
     * Floating prompt editor resize/move drags must not text-select Monaco
     * gutter, editor rows, or empty editor chrome. Capture the pointer and
     * suppress document selection until the drag finishes.
     */
    event.preventDefault();
    event.stopPropagation();
    activePointerDragCleanupRef.current?.();
    const dragTarget = event.currentTarget;
    dragTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startFrame = frame;
    const preventSelection = (selectionEvent: Event) => {
      selectionEvent.preventDefault();
    };
    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      window.getSelection()?.removeAllRanges();
      setFrame(clampFloatingPromptEditorFrame(getNextFrame(moveEvent, startFrame, startX, startY)));
    };
    const cleanupDrag = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", cleanupDrag);
      window.removeEventListener("pointercancel", cleanupDrag);
      document.removeEventListener("selectstart", preventSelection, true);
      document.removeEventListener("dragstart", preventSelection, true);
      if (dragTarget.hasPointerCapture(event.pointerId)) {
        dragTarget.releasePointerCapture(event.pointerId);
      }
      window.getSelection()?.removeAllRanges();
      activePointerDragCleanupRef.current = undefined;
      setDragMode(undefined);
    };
    activePointerDragCleanupRef.current = cleanupDrag;
    setDragMode(mode);
    window.getSelection()?.removeAllRanges();
    document.addEventListener("selectstart", preventSelection, true);
    document.addEventListener("dragstart", preventSelection, true);
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", cleanupDrag, { once: true });
    window.addEventListener("pointercancel", cleanupDrag, { once: true });
  };

  const startMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    beginPanelPointerDrag(event, "move", (moveEvent, startFrame, startX, startY) => ({
      ...startFrame,
      left: startFrame.left + moveEvent.clientX - startX,
      top: startFrame.top + moveEvent.clientY - startY,
    }));
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    beginPanelPointerDrag(event, "resize", (moveEvent, startFrame, startX, startY) => ({
      ...startFrame,
      height: startFrame.height + moveEvent.clientY - startY,
      width: startFrame.width + moveEvent.clientX - startX,
    }));
  };

  return (
    <div className="floating-prompt-editor-root" data-drag-mode={dragMode}>
      <section
        aria-label="Prompt Editor"
        className="floating-prompt-editor-panel"
        onPointerDown={() => editorRef.current?.focus?.()}
        style={{
          height: `${frame.height}px`,
          left: `${frame.left}px`,
          top: `${frame.top}px`,
          width: `${frame.width}px`,
        }}
      >
        <div className="floating-prompt-editor-titlebar" onPointerDown={startMove}>
          <div className="floating-prompt-editor-title">
            {/*
             * CDXC:PromptEditor 2026-05-14-09:55:
             * The prompt editor titlebar must show the save shortcut beside
             * the title while keeping actions permanently anchored to the
             * current right edge during resize.
             */}
            <span className="floating-prompt-editor-title-text">{editor.title}</span>
            <span className="floating-prompt-editor-title-shortcut">(Ctrl + G to save)</span>
          </div>
          <div className="floating-prompt-editor-actions">
            <button
              aria-label={isCancelConfirming ? "Confirm cancel prompt editor" : "Cancel prompt editor"}
              aria-keyshortcuts="Escape"
              className="floating-prompt-editor-cancel"
              onClick={requestCancel}
              onPointerDown={(event) => event.stopPropagation()}
              title="press escape to cancel"
              type="button"
            >
              {isCancelConfirming ? "Confirm" : "Cancel"}
            </button>
            <button
              aria-keyshortcuts="Control+G"
              aria-label="Save prompt editor"
              className="floating-prompt-editor-save"
              disabled={isSaving}
              onClick={save}
              onPointerDown={(event) => event.stopPropagation()}
              title="press ctrl+g to save"
              type="button"
            >
              {isSaving ? "Saving" : "Save"}
            </button>
          </div>
        </div>
        <div className="floating-prompt-editor-monaco" ref={containerRef} spellCheck={false} />
        <div
          aria-label="Resize prompt editor"
          className="floating-prompt-editor-resize"
          onPointerDown={startResize}
          role="separator"
        />
      </section>
    </div>
  );
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
    agentsHubCatalog,
    config,
    delayedSend,
    findPreviousSession,
    firstUserMessage,
    floatingPromptEditor,
    floatingPromptEditorCloseAndSaveRequestId,
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
    floatingPromptEditor,
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
      <FloatingPromptEditorModal
        closeAndSaveRequestId={floatingPromptEditorCloseAndSaveRequestId}
        editor={floatingPromptEditor}
        isOpen={activeModal === "floatingPromptEditor" && floatingPromptEditor !== undefined}
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
      <AgentsHubModal
        catalog={agentsHubCatalog}
        isOpen={activeModal === "agentsHub"}
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
  const [agentsHubCatalog, setAgentsHubCatalog] = useState<AgentsHubCatalogMessage>();
  const [config, setConfig] = useState<ConfigModalState>({});
  const [delayedSend, setDelayedSend] = useState<DelayedSendModalState>();
  const [findPreviousSession, setFindPreviousSession] = useState<FindPreviousSessionModalState>();
  const [firstUserMessage, setFirstUserMessage] = useState<FirstUserMessageModalState>();
  const [floatingPromptEditor, setFloatingPromptEditor] = useState<FloatingPromptEditorState>();
  const [floatingPromptEditorCloseAndSaveRequestId, setFloatingPromptEditorCloseAndSaveRequestId] =
    useState<string>();
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
            setFloatingPromptEditor(undefined);
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
            setFloatingPromptEditor(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          } else if (message.modal === "floatingPromptEditor") {
            if (
              typeof message.requestId !== "string" ||
              typeof message.filePath !== "string" ||
              typeof message.initialText !== "string"
            ) {
              throw new Error("Floating prompt editor request is missing required state.");
            }
            /**
             * CDXC:PromptEditor 2026-05-13-09:48
             * Ctrl+G Monaco prompt editing is rendered in the full-window
             * modal host so it shares the same transparent WKWebView layer as
             * app dialogs and can reliably receive click, drag, and resize
             * input above native terminal panes.
             *
             * CDXC:PromptEditor 2026-05-13-10:22
             * Prompt editor buffers are always Markdown, regardless of caller
             * hints, so wrapped prose and Markdown tokenization stay consistent
             * in the floating pane.
             */
            setFloatingPromptEditor({
              filePath: message.filePath,
              initialFrame: message.initialFrame,
              initialText: message.initialText,
              language: "markdown",
              requestId: message.requestId,
              statusFile: message.statusFile,
              title: message.title || "Prompt Editor",
            });
            setConfig({});
            setDelayedSend(undefined);
            setFindPreviousSession(undefined);
            setFirstUserMessage(undefined);
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
            setFloatingPromptEditor(undefined);
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
            setFloatingPromptEditor(undefined);
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
            setFloatingPromptEditor(undefined);
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
            setFloatingPromptEditor(undefined);
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
            setFloatingPromptEditor(undefined);
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
            setFloatingPromptEditor(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          } else {
            setConfig({});
            setDelayedSend(undefined);
            setFindPreviousSession(undefined);
            setFirstUserMessage(undefined);
            setFloatingPromptEditor(undefined);
            setRenameSession(undefined);
            setT3BrowserAccess(undefined);
            setT3ThreadId(undefined);
          }
          if (message.modal === "settings") {
            setZmuxFolderStats(undefined);
          }
          if (message.modal !== "agentsHub") {
            setAgentsHubCatalog(undefined);
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
          setFloatingPromptEditor(undefined);
          setRenameSession(undefined);
          setT3BrowserAccess(undefined);
          setT3ThreadId(undefined);
          setZmuxFolderStats(undefined);
          setAgentsHubCatalog(undefined);
          return;
        }

        if (message.type === "floatingPromptEditorCloseAndSave") {
          setFloatingPromptEditorCloseAndSaveRequestId(message.requestId);
          return;
        }

        if (message.type === "sidebarState") {
          if (isAgentsHubCatalogMessage(message.message)) {
            setAgentsHubCatalog(message.message);
            return;
          }
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
    agentsHubCatalog,
    config,
    delayedSend,
    findPreviousSession,
    firstUserMessage,
    floatingPromptEditor,
    floatingPromptEditorCloseAndSaveRequestId,
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

function isAgentsHubCatalogMessage(message: unknown): message is AgentsHubCatalogMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "agentsHubCatalog",
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
  floatingPromptEditor,
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
  floatingPromptEditor: FloatingPromptEditorState | undefined;
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
    case "agentsHub":
      return true;
    case "commandConfig":
      return config.commandDraft !== undefined;
    case "delayedSend":
      return delayedSend !== undefined;
    case "findPreviousSession":
      return findPreviousSession !== undefined;
    case "firstUserMessage":
      return firstUserMessage !== undefined;
    case "floatingPromptEditor":
      return floatingPromptEditor !== undefined;
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
