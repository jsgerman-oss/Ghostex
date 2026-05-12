import {
  IconBox,
  IconBrandVscode,
  IconCheck,
  IconChevronDown,
  IconCube,
  IconFileDiff,
  IconFolderOpen,
  IconPlayerPlay,
  IconSettings,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SidebarProjectDiffStats } from "../../shared/project-diff-stats";
import { createDefaultSidebarProjectDiffStats } from "../../shared/project-diff-stats";
import type { SidebarCommandButton } from "../../shared/sidebar-commands";
import { normalizezmuxSettings, type ZedOverlayTargetApp } from "../../shared/zmux-settings";
import {
  BUILT_IN_WORKSPACE_OPEN_TARGETS,
  type CustomWorkspaceOpenTarget,
  type WorkspaceOpenTargetAvailability,
  type WorkspaceOpenTargetDefinition,
} from "../../shared/workspace-open-targets";
import { SidebarCommandIconGlyph } from "../../sidebar/sidebar-command-icon";
import "../../sidebar/styles.css";

type ProjectEditorLoadStatus = "idle" | "opening" | "running" | "error";

type NativeProcessResult = {
  exitCode: number;
  requestId: string;
  stderr: string;
  stdout: string;
  type: "processResult";
};

type NativeHostEvent = NativeProcessResult | { protocolVersion: 1; type: "hostReady" };

type TitlebarOpenTargetsSettings = {
  availability: WorkspaceOpenTargetAvailability;
  customTargets: CustomWorkspaceOpenTarget[];
  hiddenTargetIds: string[];
};

type TitlebarSidebarActionsSettings = {
  commands: SidebarCommandButton[];
};

type TitlebarProjectState = {
  diffStats: SidebarProjectDiffStats;
  editorIsOpen: boolean;
  editorIsSleeping: boolean;
  editorStatus: ProjectEditorLoadStatus;
  projectIconDataUrl?: string | null;
  projectId?: string;
  projectName: string;
  projectPath: string;
  sidebarActions: TitlebarSidebarActionsSettings;
  showProjectEditorDiffFileCount: boolean;
  workspaceOpenTargets: TitlebarOpenTargetsSettings;
};

type NativeTitlebarCommand =
  | {
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
      executable: string;
      requestId: string;
      type: "runProcess";
    }
  | { type: "openActiveProjectEditorFromTitlebar" }
  | { type: "refreshWorkspaceOpenTargetAvailabilityFromTitlebar" }
  | { commandId: string; type: "runSidebarCommandFromTitlebar" }
  | {
      targetApp: ZedOverlayTargetApp;
      type: "openWorkspaceInIde";
      workspacePath: string;
    }
  | { type: "openWorkspaceInFinder"; workspacePath: string }
  | {
      regions: Array<{ height: number; width: number; x: number; y: number }>;
      type: "setReactTitlebarHitRegions";
    };

type ResolvedOpenTarget =
  | {
      definition: WorkspaceOpenTargetDefinition;
      id: string;
      kind: "built-in";
      label: string;
      resolvedAppName?: string;
      resolvedCommand?: string;
    }
  | {
      command: string;
      custom: CustomWorkspaceOpenTarget;
      id: string;
      kind: "custom";
      label: string;
      resolvedCommand?: string;
    };

declare global {
  interface Window {
    __zmux_TITLEBAR__?: {
      setActiveProjectState: (state: Partial<TitlebarProjectState>) => void;
      setZedOverlay?: (state: {
        enabled: boolean;
        hideTitlebarButton: boolean;
        targetApp: ZedOverlayTargetApp;
      }) => void;
    };
  }
}

const LAST_OPEN_TARGET_STORAGE_KEY = "zmux.titlebar.lastOpenTargetId";
const LAST_ACTION_COMMAND_STORAGE_PREFIX = "zmux.titlebar.lastActionCommandByProject:";
const PROJECT_EDITOR_DISPLAY_MAX_FILES = 999;
const PROJECT_EDITOR_DISPLAY_MAX_LINES = 999;
const TITLEBAR_HEIGHT = 30;
const TITLEBAR_CONTROL_HEIGHT = 20;
const TITLEBAR_CONTROL_TOP = (TITLEBAR_HEIGHT - TITLEBAR_CONTROL_HEIGHT) / 2;
const TITLEBAR_PROJECT_TOP = TITLEBAR_CONTROL_TOP + 1;
const TITLEBAR_RIGHT_CONTROLS_TOP = TITLEBAR_CONTROL_TOP + 1;
/**
 * CDXC:ReactTitlebar 2026-05-11-09:17
 * Titlebar split-button menus are triggered from their chevrons but should
 * visually land under the whole grouped control. Use shadcn/Radix tooltips for
 * hover labels instead of native title attributes so the titlebar matches the
 * sidebar interaction model.
 */
const TITLEBAR_SPLIT_MENU_CENTER_OFFSET = -14;

const pendingProcessResults = new Map<
  string,
  {
    reject: (error: Error) => void;
    resolve: (result: NativeProcessResult) => void;
    timeout: number;
  }
>();

function postNative(command: NativeTitlebarCommand): void {
  window.webkit?.messageHandlers?.zmuxNativeHost?.postMessage(command);
}

function runNativeProcess(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<NativeProcessResult> {
  const requestId = `titlebar-process-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  postNative({
    args,
    cwd: options.cwd,
    env: options.env,
    executable,
    requestId,
    type: "runProcess",
  });
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingProcessResults.delete(requestId);
      reject(new Error(`${executable} ${args.join(" ")} timed out`));
    }, 30_000);
    pendingProcessResults.set(requestId, { reject, resolve, timeout });
  });
}

function App() {
  const bootstrap = window.__zmux_NATIVE_HOST__ ?? {};
  const [projectState, setProjectState] = useState<TitlebarProjectState>(() =>
    createInitialProjectState(bootstrap),
  );
  const [selectedTargetId, setSelectedTargetId] = useState(() => readLastOpenTargetId());
  const [selectedActionCommandId, setSelectedActionCommandId] = useState(() =>
    readLastActionCommandId(createInitialProjectState(bootstrap)),
  );
  const [didCopyProjectPath, setDidCopyProjectPath] = useState(false);
  const [projectTitleTooltipOpen, setProjectTitleTooltipOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [openInMenuOpen, setOpenInMenuOpen] = useState(false);
  const copyTooltipTimeoutRef = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const allTargets = useMemo(
    () => createConfiguredOpenTargets(projectState.workspaceOpenTargets),
    [projectState.workspaceOpenTargets],
  );
  const visibleTargets = useMemo(
    () => resolveVisibleOpenTargets(allTargets, projectState.workspaceOpenTargets.availability),
    [allTargets, projectState.workspaceOpenTargets.availability],
  );
  const activeTarget = visibleTargets.find((target) => target.id === selectedTargetId) ?? visibleTargets[0];
  const runnableActions = useMemo(
    () => projectState.sidebarActions.commands.filter(isRunnableSidebarCommand),
    [projectState.sidebarActions.commands],
  );
  const activeAction =
    runnableActions.find((command) => command.commandId === selectedActionCommandId) ??
    runnableActions[0];
  const codeButtonKey = createCodeButtonStateKey(projectState);

  const publishHitRegions = useCallback(() => {
    /**
     * CDXC:ReactTitlebar 2026-05-11-00:22
     * Dropdown content is portaled outside the root node by Radix. Measure all
     * titlebar hit-region elements in the document so AppKit lets both the
     * grouped button and its open menu receive pointer events.
     */
    const regions = Array.from(
      document.querySelectorAll<HTMLElement>("[data-titlebar-hit-region]"),
    ).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    });
    postNative({ regions, type: "setReactTitlebarHitRegions" });
  }, []);

  useLayoutEffect(() => {
    publishHitRegions();
  }, [
    activeTarget?.id,
    activeAction?.commandId,
    actionsMenuOpen,
    codeButtonKey,
    openInMenuOpen,
    projectState.projectIconDataUrl,
    projectState.projectName,
    publishHitRegions,
  ]);

  useEffect(() => {
    window.addEventListener("resize", publishHitRegions);
    return () => window.removeEventListener("resize", publishHitRegions);
  }, [publishHitRegions]);

  useEffect(
    () => () => {
      if (copyTooltipTimeoutRef.current !== undefined) {
        window.clearTimeout(copyTooltipTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    window.__zmux_TITLEBAR__ = {
      setActiveProjectState: (state) => {
        setProjectState((current) => ({
          ...current,
          ...state,
          diffStats: state.diffStats ?? current.diffStats,
          sidebarActions: state.sidebarActions ?? current.sidebarActions,
          workspaceOpenTargets: state.workspaceOpenTargets ?? current.workspaceOpenTargets,
        }));
      },
    };
    return () => {
      delete window.__zmux_TITLEBAR__;
    };
  }, []);

  useEffect(() => {
    setSelectedActionCommandId(readLastActionCommandId(projectState));
  }, [projectState.projectId, projectState.projectPath]);

  useEffect(() => {
    const handleHostEvent = (event: Event) => {
      const hostEvent = (event as CustomEvent<NativeHostEvent>).detail;
      if (hostEvent?.type !== "processResult") {
        return;
      }
      const pending = pendingProcessResults.get(hostEvent.requestId);
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeout);
      pendingProcessResults.delete(hostEvent.requestId);
      pending.resolve(hostEvent);
    };
    window.addEventListener("zmux-native-host-event", handleHostEvent);
    return () => window.removeEventListener("zmux-native-host-event", handleHostEvent);
  }, []);

  const copyProjectPath = () => {
    /**
     * CDXC:ReactTitlebar 2026-05-11-01:15
     * The active project title is plain titlebar text, not a bordered button.
     * Its shadcn tooltip names the copy-path action and flips to a short copied
     * confirmation after click so the compact titlebar does not need permanent
     * helper text.
     */
    void navigator.clipboard?.writeText(projectState.projectPath);
    setDidCopyProjectPath(true);
    setProjectTitleTooltipOpen(true);
    if (copyTooltipTimeoutRef.current !== undefined) {
      window.clearTimeout(copyTooltipTimeoutRef.current);
    }
    copyTooltipTimeoutRef.current = window.setTimeout(() => {
      setDidCopyProjectPath(false);
      setProjectTitleTooltipOpen(false);
      copyTooltipTimeoutRef.current = undefined;
    }, 2_000);
  };

  const openTarget = (target: ResolvedOpenTarget | undefined) => {
    if (!target || !projectState.projectPath) {
      return;
    }
    setSelectedTargetId(target.id);
    localStorage.setItem(LAST_OPEN_TARGET_STORAGE_KEY, target.id);
    if (target.id === "embedded-editor") {
      postNative({ type: "openActiveProjectEditorFromTitlebar" });
      return;
    }
    if (target.id === "finder") {
      postNative({ type: "openWorkspaceInFinder", workspacePath: projectState.projectPath });
      return;
    }
    if (target.kind === "built-in") {
      const targetApp = target.definition.targetApp;
      if (targetApp && target.resolvedCommand) {
        postNative({
          targetApp,
          type: "openWorkspaceInIde",
          workspacePath: projectState.projectPath,
        });
        return;
      }
      const command = target.resolvedCommand ?? target.definition.commands?.[0];
      if (target.resolvedCommand) {
        void runNativeProcess("/usr/bin/env", [
          target.resolvedCommand,
          ...(target.definition.baseArgs ?? []),
          projectState.projectPath,
        ]);
      } else if (target.resolvedAppName) {
        void runNativeProcess("/usr/bin/open", ["-a", target.resolvedAppName, projectState.projectPath]);
      } else if (command) {
        void runNativeProcess("/usr/bin/env", [
          command,
          ...(target.definition.baseArgs ?? []),
          projectState.projectPath,
        ]);
      }
      return;
    }
    void runNativeProcess("/usr/bin/env", [
      target.command,
      ...target.custom.args,
      projectState.projectPath,
    ]);
  };

  const runSidebarAction = (command: SidebarCommandButton | undefined) => {
    if (!command) {
      return;
    }
    setSelectedActionCommandId(command.commandId);
    persistLastActionCommandId(projectState, command.commandId);
    postNative({ commandId: command.commandId, type: "runSidebarCommandFromTitlebar" });
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="dark" ref={rootRef} style={styles.shell}>
        <div style={styles.titlebar}>
          <div style={styles.projectSlot}>
            <Tooltip
              onOpenChange={(open) => {
                if (!didCopyProjectPath) {
                  setProjectTitleTooltipOpen(open);
                }
              }}
              open={projectTitleTooltipOpen}
            >
              <TooltipTrigger asChild>
                <div
                  aria-label="Copy project path"
                  className="titlebar-project-title"
                  data-titlebar-hit-region
                  onClick={copyProjectPath}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      copyProjectPath();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  {projectState.projectIconDataUrl ? (
                    <img
                      alt=""
                      aria-hidden="true"
                      className="titlebar-project-icon"
                      draggable={false}
                      src={projectState.projectIconDataUrl}
                    />
                  ) : null}
                  <span className="truncate">{projectState.projectName}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>{didCopyProjectPath ? "Copied path!" : "Click to copy path"}</TooltipContent>
            </Tooltip>
          </div>
          <div style={styles.rightSlot}>
            <DropdownMenu onOpenChange={setActionsMenuOpen} open={actionsMenuOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ButtonGroup className="titlebar-open-group titlebar-actions-group" data-titlebar-hit-region>
                    <Button
                      aria-label={
                        activeAction
                          ? `Run ${getSidebarActionLabel(activeAction)}`
                          : "No actions configured"
                      }
                      className="titlebar-session-button titlebar-open-main-button"
                      disabled={!activeAction}
                      onClick={() => runSidebarAction(activeAction)}
                      type="button"
                      variant="ghost"
                    >
                      {getSidebarActionIcon(activeAction)}
                    </Button>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label="Actions menu"
                        className="titlebar-session-button titlebar-open-chevron-button"
                        type="button"
                        variant="ghost"
                      >
                        <IconChevronDown aria-hidden="true" size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                  </ButtonGroup>
                </TooltipTrigger>
                <TooltipContent>
                  {activeAction ? getSidebarActionLabel(activeAction) : "No actions configured"}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="center"
                alignOffset={TITLEBAR_SPLIT_MENU_CENTER_OFFSET}
                className="titlebar-open-menu min-w-[220px] rounded-lg border-border/80 !bg-[#181818] p-1 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#181818" }}
              >
                {runnableActions.length > 0 ? (
                  runnableActions.map((command) => (
                    <DropdownMenuItem
                      className="titlebar-open-menu-item"
                      key={command.commandId}
                      onClick={() => runSidebarAction(command)}
                    >
                      {getSidebarActionIcon(command)}
                      <span className="min-w-0 flex-1 truncate">{getSidebarActionLabel(command)}</span>
                      {activeAction?.commandId === command.commandId ? (
                        <IconCheck aria-hidden="true" className="ml-2 size-4 opacity-75" />
                      ) : null}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <div className="px-2 py-2 text-muted-foreground">No Actions configured</div>
                )}
                <DropdownMenuSeparator className="bg-border/70" />
                <DropdownMenuItem
                  className="titlebar-open-menu-item"
                  onClick={() =>
                    window.webkit?.messageHandlers?.zmuxAppModalHost?.postMessage({
                      modal: "configureActions",
                      type: "open",
                    })
                  }
                >
                  <IconSettings aria-hidden="true" size={16} />
                  <span>Configure</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div aria-hidden="true" className="titlebar-section-separator" />
            <DropdownMenu onOpenChange={setOpenInMenuOpen} open={openInMenuOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ButtonGroup className="titlebar-open-group" data-titlebar-hit-region>
                    <Button
                      aria-label={activeTarget?.label ?? "Embedded Editor"}
                      className="titlebar-session-button titlebar-open-main-button"
                      onClick={() => openTarget(activeTarget)}
                      type="button"
                      variant="ghost"
                    >
                      {activeTarget ? getOpenTargetIcon(activeTarget) : <EmbeddedEditorIcon />}
                    </Button>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label="Open project menu"
                        className="titlebar-session-button titlebar-open-chevron-button"
                        type="button"
                        variant="ghost"
                      >
                        <IconChevronDown aria-hidden="true" size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                  </ButtonGroup>
                </TooltipTrigger>
                <TooltipContent>{activeTarget?.label ?? "Embedded Editor"}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="center"
                alignOffset={TITLEBAR_SPLIT_MENU_CENTER_OFFSET}
                className="titlebar-open-menu min-w-[220px] rounded-lg border-border/80 !bg-[#181818] p-1 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#181818" }}
              >
                {visibleTargets.map((target) => (
                  <DropdownMenuItem
                    className="titlebar-open-menu-item"
                    key={target.id}
                    onClick={() => openTarget(target)}
                  >
                    {getOpenTargetIcon(target)}
                    <span className="min-w-0 flex-1 truncate">{target.label}</span>
                    {activeTarget?.id === target.id ? (
                      <IconCheck aria-hidden="true" className="ml-2 size-4 opacity-75" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-border/70" />
                <DropdownMenuItem
                  className="titlebar-open-menu-item"
                  onClick={() =>
                    window.webkit?.messageHandlers?.zmuxAppModalHost?.postMessage({
                      modal: "openTargets",
                      type: "open",
                    })
                  }
                >
                  <IconSettings aria-hidden="true" size={16} />
                  <span>Configure</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div aria-hidden="true" className="titlebar-section-separator" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Open embedded editor"
                  className="titlebar-session-button titlebar-code-button"
                  data-titlebar-hit-region
                  onClick={() => postNative({ type: "openActiveProjectEditorFromTitlebar" })}
                  type="button"
                  variant="ghost"
                >
                  <IconFileDiff aria-hidden="true" size={16} />
                  {renderCodeButtonLabel(projectState)}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open embedded editor</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function createInitialProjectState(bootstrap: Record<string, unknown>): TitlebarProjectState {
  const projectPath = typeof bootstrap.cwd === "string" ? bootstrap.cwd : "";
  const pathParts = projectPath.split("/").filter(Boolean);
  const sharedSettingsJson = isRecord(bootstrap.sharedSidebarStorage)
    ? bootstrap.sharedSidebarStorage.settings
    : undefined;
  const settings = normalizezmuxSettings(parseSharedSettings(sharedSettingsJson));
  return {
    diffStats: createDefaultSidebarProjectDiffStats(false),
    editorIsOpen: false,
    editorIsSleeping: false,
    editorStatus: "idle",
    projectName:
      (typeof bootstrap.workspaceName === "string" && bootstrap.workspaceName) ||
      pathParts[pathParts.length - 1] ||
      "Ghostex",
    projectPath,
    sidebarActions: {
      commands: [],
    },
    showProjectEditorDiffFileCount: settings.showProjectEditorDiffFileCount,
    workspaceOpenTargets: {
      availability: settings.workspaceOpenTargetAvailability,
      customTargets: settings.customWorkspaceOpenTargets,
      hiddenTargetIds: settings.workspaceOpenTargetHiddenIds,
    },
  };
}

function parseSharedSettings(candidate: unknown): unknown {
  if (typeof candidate !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(candidate || "null");
  } catch {
    return undefined;
  }
}

function createConfiguredOpenTargets(settings: TitlebarOpenTargetsSettings): ResolvedOpenTarget[] {
  const hiddenTargetIds = new Set(settings.hiddenTargetIds);
  return [
    ...BUILT_IN_WORKSPACE_OPEN_TARGETS.filter(
      (target) => target.id === "embedded-editor" || !hiddenTargetIds.has(target.id),
    ).map(
      (definition): ResolvedOpenTarget => ({
        definition,
        id: definition.id,
        kind: "built-in",
        label: definition.label,
      }),
    ),
    ...settings.customTargets.map(
      (custom): ResolvedOpenTarget => ({
        command: custom.command,
        custom,
        id: custom.id,
        kind: "custom",
        label: custom.label,
      }),
    ),
  ];
}

function resolveVisibleOpenTargets(
  targets: ResolvedOpenTarget[],
  availability: WorkspaceOpenTargetAvailability,
): ResolvedOpenTarget[] {
  const availableTargetIds = new Set(availability.availableTargetIds);
  return targets
    .map((target) => {
      if (target.id === "embedded-editor" || target.id === "finder") {
        return target;
      }
      if (target.kind === "custom") {
        return target;
      }
      if (!availableTargetIds.has(target.id as WorkspaceOpenTargetDefinition["id"])) {
        return undefined;
      }
      /**
       * CDXC:ReactTitlebar 2026-05-11-02:03
       * The titlebar menu shows only persisted installed built-ins plus custom
       * targets. Hidden ids are applied before this step, so startup detection
       * cannot re-add an editor the user turned off in Settings.
       */
      return {
        ...target,
        resolvedAppName: availability.resolvedAppNames[target.id],
        resolvedCommand: availability.resolvedCommands[target.id],
      };
    })
    .filter((target): target is ResolvedOpenTarget => target !== undefined);
}

function createCodeButtonStateKey(state: TitlebarProjectState): string {
  return [
    state.editorStatus,
    state.editorIsOpen,
    state.editorIsSleeping,
    state.diffStats.files,
    state.diffStats.additions,
    state.diffStats.deletions,
    state.diffStats.isLoading,
    state.showProjectEditorDiffFileCount,
  ].join(":");
}

function renderCodeButtonLabel(state: TitlebarProjectState): ReactNode {
  if (state.editorIsOpen && state.editorIsSleeping !== true && state.editorStatus === "running") {
    return <span>Go to Code</span>;
  }
  if (state.editorStatus === "opening" || state.editorStatus === "error") {
    return null;
  }
  return renderProjectEditorDiffLabel(state.diffStats, state.showProjectEditorDiffFileCount);
}

function renderProjectEditorDiffLabel(
  stats: SidebarProjectDiffStats,
  showFileCount = false,
): ReactNode {
  /**
   * CDXC:ReactTitlebar 2026-05-11-01:15
   * The compact titlebar diff button should not repeat the "Code" label or
   * show transient opening/error text. Idle project status shows only the file
   * count when enabled plus pastel green/red line deltas like the sidebar row.
   */
  return (
    <>
      {showFileCount ? (
        <span className="titlebar-code-files">
          {Math.min(PROJECT_EDITOR_DISPLAY_MAX_FILES, Math.max(0, stats.files))}
        </span>
      ) : null}
      <span className="titlebar-code-additions">
        +{Math.min(PROJECT_EDITOR_DISPLAY_MAX_LINES, Math.max(0, stats.additions))}
      </span>
      <span className="titlebar-code-deletions">
        -{Math.min(PROJECT_EDITOR_DISPLAY_MAX_LINES, Math.max(0, stats.deletions))}
      </span>
    </>
  );
}

function getOpenTargetIcon(target: ResolvedOpenTarget): ReactNode {
  if (target.id === "embedded-editor") {
    return <EmbeddedEditorIcon />;
  }
  if (target.id === "vscode" || target.id === "vscode-insiders" || target.id === "vscodium") {
    return <IconBrandVscode aria-hidden="true" className="size-4 text-[#3b82f6]" />;
  }
  if (target.id === "finder") {
    return <IconFolderOpen aria-hidden="true" className="size-4 text-zinc-400" />;
  }
  if (target.id === "cursor") {
    return <IconCube aria-hidden="true" className="size-4 text-zinc-100" />;
  }
  if (target.id === "zed") {
    return <ZedIcon />;
  }
  return <IconBox aria-hidden="true" className="size-4 text-zinc-400" />;
}

function EmbeddedEditorIcon() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24">
      <path
        d="M16.8 4.5 7.2 8.9 3.9 6.4 2.5 7.6v8.8l1.4 1.2 3.3-2.5 9.6 4.4 4.7-2.1V6.6l-4.7-2.1Zm0 3.2v8.6l-6.1-4.3 6.1-4.3ZM5 10l1.8 1.4L5 13v-3Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ZedIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-4 items-center justify-center rounded-[3px] border border-zinc-500 text-[10px] font-semibold leading-none text-zinc-300"
    >
      Z
    </span>
  );
}

function readLastOpenTargetId(): string {
  return localStorage.getItem(LAST_OPEN_TARGET_STORAGE_KEY) || "embedded-editor";
}

function readLastActionCommandId(state: Pick<TitlebarProjectState, "projectId" | "projectPath">): string | undefined {
  const storageKey = getLastActionCommandStorageKey(state);
  return storageKey ? localStorage.getItem(storageKey)?.trim() || undefined : undefined;
}

function persistLastActionCommandId(
  state: Pick<TitlebarProjectState, "projectId" | "projectPath">,
  commandId: string,
): void {
  const storageKey = getLastActionCommandStorageKey(state);
  if (!storageKey) {
    return;
  }
  localStorage.setItem(storageKey, commandId);
}

function getLastActionCommandStorageKey(
  state: Pick<TitlebarProjectState, "projectId" | "projectPath">,
): string | undefined {
  const projectKey = state.projectId?.trim() || state.projectPath.trim();
  if (!projectKey) {
    return undefined;
  }
  /**
   * CDXC:TitlebarActions 2026-05-11-02:46
   * Moving Actions from the sidebar header to the titlebar keeps the same
   * project-scoped primary-action behavior: the split button's left side runs
   * the last chosen action for the active project, not a global last action.
   */
  return `${LAST_ACTION_COMMAND_STORAGE_PREFIX}${projectKey}`;
}

function isRunnableSidebarCommand(command: SidebarCommandButton): boolean {
  return command.actionType === "browser"
    ? Boolean(command.url?.trim())
    : Boolean(command.command?.trim());
}

function getSidebarActionLabel(command: SidebarCommandButton): string {
  return command.name.trim() || command.commandId;
}

function getSidebarActionIcon(command: SidebarCommandButton | undefined): ReactNode {
  if (command?.icon) {
    return (
      <SidebarCommandIconGlyph
        className="quick-action-icon"
        color={command.iconColor}
        icon={command.icon}
        size={16}
        stroke={1.8}
      />
    );
  }
  if (command?.actionType === "browser") {
    return <IconWorld aria-hidden="true" className="quick-action-icon" size={16} stroke={1.8} />;
  }
  if (command?.actionType === "terminal") {
    return <IconTerminal2 aria-hidden="true" className="quick-action-icon" size={16} stroke={1.8} />;
  }
  return <IconPlayerPlay aria-hidden="true" className="quick-action-icon" size={16} stroke={1.8} />;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const styles = {
  projectSlot: {
    alignItems: "center",
    display: "flex",
    gap: 6,
    left: 78,
    maxWidth: "min(620px, calc(100vw - 310px))",
    minWidth: 0,
    position: "absolute",
    top: TITLEBAR_PROJECT_TOP,
  },
  rightSlot: {
    alignItems: "center",
    display: "flex",
    gap: 8,
    position: "absolute",
    right: 10,
    top: TITLEBAR_RIGHT_CONTROLS_TOP,
  },
  shell: {
    background: "transparent",
    inset: 0,
    overflow: "visible",
    position: "fixed",
  },
  titlebar: {
    alignItems: "center",
    background: "#0e0e0e",
    display: "flex",
    height: TITLEBAR_HEIGHT,
    justifyContent: "center",
    position: "relative",
    width: "100vw",
  },
} satisfies Record<string, CSSProperties>;

document.body.style.margin = "0";
document.body.style.background = "transparent";
document.body.style.overflow = "hidden";
const styleElement = document.createElement("style");
styleElement.textContent = `
  /**
   * CDXC:ReactTitlebar 2026-05-11-09:00
   * The right titlebar controls should read as flat chrome text/icons rather
   * than framed buttons. Keep three equally spaced groups separated by thin
   * rules, remove the manual installed-target refresh button, and preserve the
   * 20px centered control height so the compact 30px titlebar keeps top/bottom
   * breathing room.
   */
  .titlebar-session-button {
    height: ${TITLEBAR_CONTROL_HEIGHT}px;
    min-width: 0;
    border-radius: 5px;
    border: 0;
    background: transparent;
    color: rgba(255,255,255,0.84);
    font: 650 12.5px/${TITLEBAR_CONTROL_HEIGHT}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    letter-spacing: 0;
    box-shadow: none;
  }
  .titlebar-session-button:hover,
  .titlebar-session-button:focus-visible,
  .titlebar-session-button[data-state="open"] {
    background: transparent;
    color: rgba(255,255,255,0.96);
    outline: none;
  }
  .titlebar-session-button svg,
  .titlebar-session-button .quick-action-icon {
    height: 16px;
    width: 16px;
  }
  .titlebar-open-chevron-button svg {
    height: 14px;
    width: 14px;
  }
  .titlebar-project-button {
    max-width: 210px;
    padding: 0 10px;
  }
  .titlebar-project-title {
    align-items: center;
    color: rgba(255,255,255,0.9);
    cursor: pointer;
    display: inline-flex;
    font: 650 13.5px/${TITLEBAR_CONTROL_HEIGHT}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    height: ${TITLEBAR_CONTROL_HEIGHT}px;
    letter-spacing: 0;
    max-width: 210px;
    min-width: 0;
    padding: 0 3px;
  }
  .titlebar-project-icon {
    /**
     * CDXC:ProjectIcons 2026-05-11-01:50
     * React titlebar project identity should use the same shared project image
     * as macOS notifications, positioned before the project title without
     * changing titlebar height or competing with the right-side controls.
     */
    border-radius: 4px;
    flex: 0 0 auto;
    height: 14px;
    margin-right: 5px;
    object-fit: contain;
    width: 14px;
  }
  .titlebar-project-title:focus-visible {
    border-radius: 6px;
    outline: 2px solid rgba(255,255,255,0.24);
    outline-offset: 2px;
  }
  .titlebar-open-main-button {
    width: 28px;
    padding: 0;
  }
  .titlebar-open-chevron-button {
    width: 18px;
    padding: 0;
  }
  .titlebar-open-group {
    gap: 0 !important;
  }
  .titlebar-open-group > .titlebar-session-button {
    border-radius: 0;
  }
  .titlebar-open-group > .titlebar-session-button:first-child {
    border-bottom-left-radius: 5px;
    border-top-left-radius: 5px;
  }
  .titlebar-open-group > .titlebar-session-button:last-child {
    border-bottom-right-radius: 5px;
    border-top-right-radius: 5px;
  }
  .titlebar-code-button {
    gap: 6px;
    padding: 0 2px;
  }
  .titlebar-section-separator {
    align-self: center;
    background: rgba(255,255,255,0.26);
    flex: 0 0 auto;
    height: 16px;
    width: 1px;
  }
  .titlebar-code-additions {
    color: #9fdeb0;
    font-variant-numeric: tabular-nums;
  }
  .titlebar-code-deletions {
    color: #f0a0a0;
    font-variant-numeric: tabular-nums;
  }
  .titlebar-code-files {
    color: rgba(255,255,255,0.68);
    font-variant-numeric: tabular-nums;
  }
  .titlebar-open-menu {
    background: #181818 !important;
    background-color: #181818 !important;
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 18px 42px rgba(0,0,0,0.44);
  }
  .titlebar-open-menu-item {
    cursor: default !important;
    min-height: 30px;
    gap: 10px;
    border-radius: 7px;
    font: 500 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<App />);
