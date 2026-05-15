import {
  IconBox,
  IconBrandGithub,
  IconBrandVscode,
  IconCheck,
  IconChevronDown,
  IconChecklist,
  IconCode,
  IconCube,
  IconFolderOpen,
  IconPlayerPlay,
  IconRobot,
  IconSettings,
  IconTerminal2,
  IconUsersGroup,
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
import { motion } from "motion/react";
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
import { normalizeghostexSettings, type ZedOverlayTargetApp } from "../../shared/ghostex-settings";
import {
  BUILT_IN_WORKSPACE_OPEN_TARGETS,
  type CustomWorkspaceOpenTarget,
  type WorkspaceOpenTargetAvailability,
  type WorkspaceOpenTargetDefinition,
} from "../../shared/workspace-open-targets";
import { SidebarCommandIconGlyph } from "../../sidebar/sidebar-command-icon";
import "../../sidebar/styles.css";

type ProjectEditorLoadStatus = "idle" | "opening" | "running" | "error";
type TitlebarMode = "agents" | "code" | "git" | "tasks";

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
  petOverlayEnabled: boolean;
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
  | { type: "openAgentsModeFromTitlebar" }
  | { type: "openGitHubProjectFromTitlebar" }
  | { type: "openTasksPlaceholderFromTitlebar" }
  | { type: "refreshWorkspaceOpenTargetAvailabilityFromTitlebar" }
  | { type: "togglePetOverlayFromTitlebar" }
  | { type: "toggleCommandsPanelFromTitlebar" }
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
    __ghostex_TITLEBAR__?: {
      setActiveProjectState: (state: Partial<TitlebarProjectState>) => void;
      setZedOverlay?: (state: {
        enabled: boolean;
        hideTitlebarButton: boolean;
        targetApp: ZedOverlayTargetApp;
      }) => void;
    };
  }
}

const LAST_OPEN_TARGET_STORAGE_KEY = "ghostex.titlebar.lastOpenTargetId";
const LAST_ACTION_COMMAND_STORAGE_PREFIX = "ghostex.titlebar.lastActionCommandByProject:";
const TITLEBAR_HEIGHT = 30;
const TITLEBAR_CONTROL_HEIGHT = 20;
const TITLEBAR_CONTROL_TOP = (TITLEBAR_HEIGHT - TITLEBAR_CONTROL_HEIGHT) / 2;
const TITLEBAR_PROJECT_TOP = TITLEBAR_CONTROL_TOP + 1;
const TITLEBAR_CENTER_CONTROLS_TOP = TITLEBAR_CONTROL_TOP;
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
  window.webkit?.messageHandlers?.ghostexNativeHost?.postMessage(command);
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
  const bootstrap = window.__ghostex_NATIVE_HOST__ ?? {};
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
  const [activeMode, setActiveMode] = useState<TitlebarMode>("agents");
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
  const publishHitRegions = useCallback(() => {
    /**
     * CDXC:ReactTitlebar 2026-05-11-00:22
     * Dropdown content is portaled outside the root node by Radix. Measure all
     * titlebar hit-region elements in the document so AppKit lets both the
     * grouped button and its open menu receive pointer events.
     *
     * CDXC:ReactTitlebar 2026-05-12-18:58
     * Portaled menus can finish placement after the React open-state commit.
     * Publish the measured rectangles after layout settles as well as during
     * the commit so visible Configure menu items cannot fall through the
     * native titlebar pass-through area before their own onClick handlers run.
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

  const publishSettledHitRegions = useCallback(() => {
    publishHitRegions();
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      publishHitRegions();
      secondFrame = window.requestAnimationFrame(publishHitRegions);
    });
    const settledTimeout = window.setTimeout(publishHitRegions, 120);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== 0) {
        window.cancelAnimationFrame(secondFrame);
      }
      window.clearTimeout(settledTimeout);
    };
  }, [publishHitRegions]);

  useLayoutEffect(() => {
    return publishSettledHitRegions();
  }, [
    activeTarget?.id,
    activeAction?.commandId,
    actionsMenuOpen,
    openInMenuOpen,
    projectState.projectIconDataUrl,
    projectState.projectName,
    publishSettledHitRegions,
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
    window.__ghostex_TITLEBAR__ = {
      setActiveProjectState: (state) => {
        setProjectState((current) => ({
          ...current,
          ...state,
          diffStats: state.diffStats ?? current.diffStats,
          petOverlayEnabled: state.petOverlayEnabled ?? current.petOverlayEnabled,
          sidebarActions: state.sidebarActions ?? current.sidebarActions,
          workspaceOpenTargets: state.workspaceOpenTargets ?? current.workspaceOpenTargets,
        }));
      },
    };
    return () => {
      delete window.__ghostex_TITLEBAR__;
    };
  }, []);

  useEffect(() => {
    setSelectedActionCommandId(readLastActionCommandId(projectState));
    setActiveMode("agents");
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
    window.addEventListener("ghostex-native-host-event", handleHostEvent);
    return () => window.removeEventListener("ghostex-native-host-event", handleHostEvent);
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

  const openAgentsMode = () => {
    setActiveMode("agents");
    postNative({ type: "openAgentsModeFromTitlebar" });
  };

  const openCodeMode = () => {
    setActiveMode("code");
    postNative({ type: "openActiveProjectEditorFromTitlebar" });
  };

  const openGitMode = () => {
    setActiveMode("git");
    postNative({ type: "openGitHubProjectFromTitlebar" });
  };

  const openTasksMode = () => {
    setActiveMode("tasks");
    postNative({ type: "openTasksPlaceholderFromTitlebar" });
  };

  const toggleCommandsPanel = () => {
    postNative({ type: "toggleCommandsPanelFromTitlebar" });
  };

  const togglePetOverlay = () => {
    postNative({ type: "togglePetOverlayFromTitlebar" });
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
          <div style={styles.centerSlot}>
            <TitlebarModeSwitcher
              activeMode={activeMode}
              modes={[
                {
                  icon: <IconUsersGroup aria-hidden="true" size={14} stroke={1.8} />,
                  label: "Agents",
                  onSelect: openAgentsMode,
                  value: "agents",
                },
                {
                  /**
                   * CDXC:ReactTitlebar 2026-05-15-13:58:
                   * The titlebar Code segment always renders as "Code". Git
                   * diff stats moved to the sidebar project row, and editor
                   * startup errors belong in the editor page instead of this
                   * segmented-control button.
                   */
                  icon: <IconCode aria-hidden="true" size={14} stroke={1.8} />,
                  label: "Code",
                  onSelect: openCodeMode,
                  value: "code",
                },
                {
                  icon: <IconBrandGithub aria-hidden="true" size={14} stroke={1.8} />,
                  label: "Git",
                  onSelect: openGitMode,
                  value: "git",
                },
                {
                  icon: <IconChecklist aria-hidden="true" size={14} stroke={1.8} />,
                  label: "Tasks",
                  onSelect: openTasksMode,
                  value: "tasks",
                },
              ]}
            />
          </div>
          <div style={styles.rightSlot}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={projectState.petOverlayEnabled ? "Hide pet" : "Show pet"}
                  className="titlebar-session-button titlebar-pet-button"
                  data-awake={String(projectState.petOverlayEnabled)}
                  data-titlebar-hit-region
                  onClick={togglePetOverlay}
                  type="button"
                  variant="ghost"
                >
                  {/*
                   * CDXC:PetOverlay 2026-05-15-14:20:
                   * The top bar should expose the pet wake/sleep control
                   * without the Rotate Panes button; pane rotation now lives in
                   * the per-pane overflow menu below Split Downwards.
                   */}
                  <IconRobot aria-hidden="true" size={16} stroke={1.8} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{projectState.petOverlayEnabled ? "Hide pet" : "Show pet"}</TooltipContent>
            </Tooltip>
            <div aria-hidden="true" className="titlebar-section-separator" />
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
                    window.webkit?.messageHandlers?.ghostexAppModalHost?.postMessage({
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
                    window.webkit?.messageHandlers?.ghostexAppModalHost?.postMessage({
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
                  aria-label="Toggle Commands panel"
                  className="titlebar-session-button titlebar-command-panel-button"
                  data-titlebar-hit-region
                  onClick={toggleCommandsPanel}
                  type="button"
                  variant="ghost"
                >
                  <IconTerminal2 aria-hidden="true" size={16} stroke={1.8} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle Commands panel</TooltipContent>
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
  const settings = normalizeghostexSettings(parseSharedSettings(sharedSettingsJson));
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
    petOverlayEnabled: settings.petOverlayEnabled,
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

function TitlebarModeSwitcher({
  activeMode,
  modes,
}: {
  activeMode: TitlebarMode;
  modes: Array<{
    icon: ReactNode;
    label: string;
    meta?: ReactNode;
    onSelect: () => void;
    value: TitlebarMode;
  }>;
}) {
  return (
    <div
      aria-label="Mode switcher"
      className="titlebar-mode-switcher"
      data-titlebar-hit-region
      role="tablist"
    >
      {/*
        CDXC:ModeSwitcher 2026-05-15-12:54:
        The app titlebar mode switcher must sit in the center as one four-part
        animated segmented control with visible icon+text labels. Use the
        shadcn-space Tabs-01 motion layout highlight pattern, but keep content
        switching owned by the native sidebar bridge instead of rendering tab
        panels inside the titlebar.

        CDXC:ModeSwitcher 2026-05-15-14:47:
        The animation must closely match shadcn-space Tabs-01: each tab is a
        rounded-full button with the active pill rendered as the selected
        button's shared-layout motion background. Avoid a clipped segmented
        track because it changes the motion shape and makes the spring look
        unlike the referenced component.
      */}
      {modes.map((mode) => {
        const isActive = mode.value === activeMode;
        return (
          <button
            aria-selected={isActive}
            className="titlebar-mode-tab"
            data-active={String(isActive)}
            key={mode.value}
            onClick={mode.onSelect}
            role="tab"
            style={{ transformStyle: "preserve-3d" }}
            type="button"
          >
            {isActive ? (
              <motion.div
                className="titlebar-mode-tab-active"
                layoutId="clickedbutton"
                transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
              />
            ) : null}
            <span className="titlebar-mode-tab-content">
              {mode.icon}
              <span className="titlebar-mode-label">{mode.label}</span>
              {mode.meta ? <span className="titlebar-mode-meta">{mode.meta}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
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
  centerSlot: {
    alignItems: "center",
    display: "flex",
    left: "50%",
    maxWidth: "min(440px, calc(100vw - 520px))",
    minWidth: 0,
    position: "absolute",
    top: TITLEBAR_CENTER_CONTROLS_TOP,
    transform: "translateX(-50%)",
  },
  projectSlot: {
    alignItems: "center",
    display: "flex",
    gap: 6,
    left: 78,
    maxWidth: "min(620px, calc(100vw - 350px))",
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
   *
   * CDXC:ReactTitlebar 2026-05-14-09:52
   * The top-right Commands panel terminal icon needs its own left divider so it
   * reads as a separate titlebar destination from the embedded editor button.
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
  .titlebar-command-panel-button {
    width: 28px;
    padding: 0;
  }
  .titlebar-mode-switcher {
    align-items: center;
    display: flex;
    flex: 0 1 auto;
    height: 22px;
    max-width: 100%;
    overflow: visible;
    padding: 0;
    perspective: 1000px;
  }
  .titlebar-mode-tab {
    appearance: none;
    -webkit-appearance: none;
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 999px;
    color: rgba(255,255,255,0.68);
    cursor: default;
    display: inline-flex;
    font: 650 12px/18px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    height: 22px;
    justify-content: center;
    letter-spacing: 0;
    min-width: 70px;
    overflow: hidden;
    padding: 0 10px;
    position: relative;
    white-space: nowrap;
  }
  .titlebar-mode-tab:hover,
  .titlebar-mode-tab:focus-visible {
    color: rgba(255,255,255,0.92);
    outline: none;
  }
  .titlebar-mode-tab[data-active="true"] {
    color: rgba(255,255,255,0.98);
  }
  .titlebar-mode-tab-active {
    background: rgba(255,255,255,0.2);
    border-radius: 999px;
    inset: 0;
    position: absolute;
  }
  .titlebar-mode-tab-content {
    align-items: center;
    display: inline-flex;
    gap: 5px;
    min-width: 0;
    position: relative;
    z-index: 1;
  }
  .titlebar-mode-tab-content svg {
    flex: 0 0 auto;
    height: 14px;
    width: 14px;
  }
  .titlebar-mode-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .titlebar-mode-meta {
    align-items: center;
    display: inline-flex;
    gap: 4px;
    margin-left: 1px;
  }
  .titlebar-pet-button {
    padding: 0;
    width: 28px;
  }
  .titlebar-pet-button[data-awake="false"] {
    color: color-mix(in srgb, rgb(244 244 245) 42%, transparent);
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
  .titlebar-section-separator {
    align-self: center;
    background: rgba(255,255,255,0.26);
    flex: 0 0 auto;
    height: 16px;
    width: 1px;
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
