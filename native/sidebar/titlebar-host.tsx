import {
  IconBox,
  IconBrandGithub,
  IconBrandVscode,
  IconCheck,
  IconChevronDown,
  IconChecklist,
  IconCode,
  IconCpu,
  IconCube,
  IconDeviceDesktop,
  IconFolderOpen,
  IconLayoutSidebarLeftExpand,
  IconMoon,
  IconPlayerPlay,
  IconRobotFace,
  IconSettings,
  IconTerminal2,
  IconUsersGroup,
  IconWorld,
  IconX,
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
import { createCombinedProjectSessionId } from "./combined-sidebar-mode";
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

type TitlebarResourceGroup = {
  groupId: string;
  isActive: boolean;
  projectId?: string;
  projectName: string;
  projectPath: string;
  sessions: TitlebarResourceSession[];
  title: string;
};

type TitlebarResourceSession = {
  activity: "attention" | "idle" | "working";
  agentIcon?: string;
  isRunning: boolean;
  isSleeping?: boolean;
  lastInteractionAt?: string;
  projectId?: string;
  sessionId: string;
  sessionKind?: "browser" | "terminal" | "t3";
  sessionPersistenceName?: string;
  sessionPersistenceProvider?: string;
  terminalTitle?: string;
  title: string;
};

type TitlebarProjectState = {
  activeMode: TitlebarMode;
  debuggingMode: boolean;
  diffStats: SidebarProjectDiffStats;
  editorIsOpen: boolean;
  editorIsSleeping: boolean;
  editorStatus: ProjectEditorLoadStatus;
  projectEditorCompanionPaneHidden: boolean;
  projectIconDataUrl?: string | null;
  projectId?: string;
  projectName: string;
  projectPath: string;
  petOverlayEnabled: boolean;
  resourceGroups: TitlebarResourceGroup[];
  sidebarActions: TitlebarSidebarActionsSettings;
  showProjectEditorDiffFileCount: boolean;
  workspaceOpenTargets: TitlebarOpenTargetsSettings;
};

type ResourceProcess = {
  command: string;
  cpu: number;
  pid: number;
  ppid: number;
  rssMb: number;
};

type ResourceProcessBundle = {
  childProcesses: ResourceProcess[];
  cpu: number;
  key: string;
  label: string;
  memoryMb: number;
  pids: number[];
  process?: ResourceProcess;
  session?: TitlebarResourceSession;
  type: "app" | "cef" | "code" | "orphan" | "session";
};

type ResourceGroupView = {
  bundles: ResourceProcessBundle[];
  group: TitlebarResourceGroup;
};

type NativeTitlebarCommand =
  | { details?: string; event: string; force?: boolean; type: "appendSessionTitleDebugLog" }
  | { details?: string; event: string; type: "appendTerminalFocusDebugLog" }
  | {
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
      executable: string;
      requestId: string;
      type: "runProcess";
    }
  | { type: "openActiveProjectEditorFromTitlebar" }
  | { type: "showProjectEditorCompanionFromTitlebar" }
  | { type: "openAgentsModeFromTitlebar" }
  | { type: "openGitHubProjectFromTitlebar" }
  | { type: "openTasksPlaceholderFromTitlebar" }
  | { type: "refreshWorkspaceOpenTargetAvailabilityFromTitlebar" }
  | { type: "togglePetOverlayFromTitlebar" }
  | { type: "toggleCommandsPanelFromTitlebar" }
  | { sessionIds: string[]; type: "sleepInactiveSessionsFromTitlebar" }
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
      closeOpenDropdowns: () => void;
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
const RESOURCE_POLL_INTERVAL_MS = 5_000;
const INACTIVE_AGENT_SLEEP_THRESHOLD_MS = 7 * 60 * 1_000;
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

function appendTitlebarActionCrashDebugLog(event: string, details?: unknown): void {
  /**
   * CDXC:TitlebarActions 2026-05-15-17:23:
   * Terminal action button crashes need a breadcrumb from the isolated React
   * titlebar before the native-sidebar command runner receives the click.
   * Persist this trace outside the normal debug-toggle filter so a repro that
   * exits the app still leaves the selected action id and project context.
   */
  postNative({
    details: details === undefined ? undefined : JSON.stringify(details),
    event,
    type: "appendTerminalFocusDebugLog",
  });
}

function appendTitlebarCodeLagDebugLog(
  debuggingMode: boolean,
  event: string,
  details?: unknown,
): void {
  /**
   * CDXC:ModeSwitcher 2026-05-16-07:23:
   * Titlebar Code-click lag breadcrumbs are regular diagnostics. Send them only
   * while Settings Debugging Mode is enabled, matching the app-wide requirement
   * that non-error logging stays silent during normal use.
   */
  if (!debuggingMode) {
    return;
  }
  postNative({
    details: JSON.stringify({
      details,
      performanceNowMs: performance.now(),
      wallTimeMs: Date.now(),
    }),
    event,
    type: "appendSessionTitleDebugLog",
  });
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

function parseResourceProcessTable(stdout: string): ResourceProcess[] {
  return stdout
    .split("\n")
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+([0-9.]+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
      if (!match) {
        return undefined;
      }
      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      const cpu = Number(match[3]);
      const rssKb = Number(match[4]);
      if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(cpu) || !Number.isFinite(rssKb)) {
        return undefined;
      }
      return {
        command: match[5] ?? "",
        cpu,
        pid,
        ppid,
        rssMb: rssKb / 1024,
      };
    })
    .filter((process): process is ResourceProcess => process !== undefined);
}

function createResourceGroupViews(
  resourceGroups: TitlebarResourceGroup[],
  processes: ResourceProcess[],
): { appBundles: ResourceProcessBundle[]; cefBundles: ResourceProcessBundle[]; groupViews: ResourceGroupView[]; orphanBundles: ResourceProcessBundle[] } {
  const claimedPids = new Set<number>();
  const childrenByParent = createProcessChildrenMap(processes);
  const groupViews = resourceGroups.map((group) => {
    const bundles = group.sessions
      .map((session) => createSessionResourceBundle(session, processes, childrenByParent, claimedPids))
      .filter((bundle): bundle is ResourceProcessBundle => bundle !== undefined);
    const codeBundle = createProjectCodeServerBundle(group, processes, childrenByParent, claimedPids);
    return {
      bundles: codeBundle ? [...bundles, codeBundle] : bundles,
      group,
    };
  });
  const appBundles = createAppRuntimeBundles(processes, childrenByParent, claimedPids);
  const cefBundles = createCefBundles(processes, claimedPids);
  const orphanBundles = createOrphanBundles(processes, claimedPids);
  return { appBundles, cefBundles, groupViews, orphanBundles };
}

function createProcessChildrenMap(processes: ResourceProcess[]): Map<number, ResourceProcess[]> {
  const childrenByParent = new Map<number, ResourceProcess[]>();
  for (const process of processes) {
    const children = childrenByParent.get(process.ppid) ?? [];
    children.push(process);
    childrenByParent.set(process.ppid, children);
  }
  return childrenByParent;
}

function collectProcessTree(
  seedProcesses: ResourceProcess[],
  childrenByParent: Map<number, ResourceProcess[]>,
): ResourceProcess[] {
  const collected = new Map<number, ResourceProcess>();
  const queue = [...seedProcesses];
  while (queue.length > 0) {
    const process = queue.shift()!;
    if (collected.has(process.pid)) {
      continue;
    }
    collected.set(process.pid, process);
    queue.push(...(childrenByParent.get(process.pid) ?? []));
  }
  return Array.from(collected.values());
}

function createSessionResourceBundle(
  session: TitlebarResourceSession,
  processes: ResourceProcess[],
  childrenByParent: Map<number, ResourceProcess[]>,
  claimedPids: Set<number>,
): ResourceProcessBundle | undefined {
  const matchTokens = [
    session.sessionPersistenceName,
    session.sessionId,
    session.terminalTitle,
  ]
    .map((token) => token?.trim())
    .filter((token): token is string => Boolean(token && token.length >= 4));
  const seedProcesses = processes.filter((process) =>
    matchTokens.some((token) => process.command.includes(token)),
  );
  if (seedProcesses.length === 0 && session.sessionKind !== "browser") {
    return undefined;
  }
  const tree = collectProcessTree(seedProcesses, childrenByParent);
  tree.forEach((process) => claimedPids.add(process.pid));
  return {
    childProcesses: tree.filter((process) => !seedProcesses.some((seed) => seed.pid === process.pid)),
    cpu: sumProcessCpu(tree),
    key: `session:${session.projectId ?? "active"}:${session.sessionId}`,
    label: session.title,
    memoryMb: sumProcessMemory(tree),
    pids: tree.map((process) => process.pid),
    process: seedProcesses[0],
    session,
    type: "session",
  };
}

function createProjectCodeServerBundle(
  group: TitlebarResourceGroup,
  processes: ResourceProcess[],
  childrenByParent: Map<number, ResourceProcess[]>,
  claimedPids: Set<number>,
): ResourceProcessBundle | undefined {
  if (!group.projectPath) {
    return undefined;
  }
  const seedProcesses = processes.filter(
    (process) =>
      !claimedPids.has(process.pid) &&
      process.command.includes("code-server") &&
      process.command.includes(group.projectPath),
  );
  if (seedProcesses.length === 0) {
    return undefined;
  }
  const tree = collectProcessTree(seedProcesses, childrenByParent);
  tree.forEach((process) => claimedPids.add(process.pid));
  return {
    childProcesses: tree.filter((process) => !seedProcesses.some((seed) => seed.pid === process.pid)),
    cpu: sumProcessCpu(tree),
    key: `code:${group.groupId}`,
    label: "Code",
    memoryMb: sumProcessMemory(tree),
    pids: tree.map((process) => process.pid),
    process: seedProcesses[0],
    type: "code",
  };
}

function createAppRuntimeBundles(
  processes: ResourceProcess[],
  childrenByParent: Map<number, ResourceProcess[]>,
  claimedPids: Set<number>,
): ResourceProcessBundle[] {
  const appProcesses = processes.filter(
    (process) =>
      !claimedPids.has(process.pid) &&
      /ghostexHost|Ghostex\.app|ghostex/i.test(process.command),
  );
  const appPids = new Set(appProcesses.map((process) => process.pid));
  /**
   * CDXC:TitlebarResources 2026-05-16-19:53:
   * App Runtime rows should report the memory used by the Ghostex-owned process
   * tree, not only the tiny launcher/helper process that matched the app name.
   * Seed from root Ghostex processes and sum their descendants so the dropdown
   * does not misleadingly show 1 MB for an active app runtime.
   */
  return appProcesses
    .filter((process) => !appPids.has(process.ppid))
    .slice(0, 3)
    .map((process) => {
      const tree = collectProcessTree([process], childrenByParent).filter(
        (treeProcess) =>
          !claimedPids.has(treeProcess.pid) &&
          !isCefProcess(treeProcess) &&
          (treeProcess.pid === process.pid || !isAgentRuntimeProcess(treeProcess)),
      );
      tree.forEach((treeProcess) => claimedPids.add(treeProcess.pid));
      return {
        childProcesses: tree.filter((treeProcess) => treeProcess.pid !== process.pid),
        cpu: sumProcessCpu(tree),
        key: `app:${process.pid}`,
        label: "Ghostex",
        memoryMb: sumProcessMemory(tree),
        pids: tree.map((treeProcess) => treeProcess.pid),
        process,
        type: "app" as const,
      };
    });
}

function createCefBundles(
  processes: ResourceProcess[],
  claimedPids: Set<number>,
): ResourceProcessBundle[] {
  return processes
    .filter((process) => !claimedPids.has(process.pid) && isCefProcess(process))
    .slice(0, 12)
    .map((process) => {
      claimedPids.add(process.pid);
      return {
        childProcesses: [],
        cpu: process.cpu,
        key: `cef:${process.pid}`,
        label: getCefProcessLabel(process),
        memoryMb: process.rssMb,
        pids: [process.pid],
        process,
        type: "cef" as const,
      };
    });
}

function createOrphanBundles(processes: ResourceProcess[], claimedPids: Set<number>): ResourceProcessBundle[] {
  return processes
    .filter((process) => !claimedPids.has(process.pid) && isAgentRuntimeProcess(process))
    .slice(0, 16)
    .map((process) => ({
      childProcesses: [],
      cpu: process.cpu,
      key: `orphan:${process.pid}`,
      label: getProcessDisplayName(process),
      memoryMb: process.rssMb,
      pids: [process.pid],
      process,
      type: "orphan" as const,
    }));
}

function isCefProcess(process: ResourceProcess): boolean {
  return /Chromium Embedded Framework|--type=(renderer|gpu-process|utility)/.test(process.command);
}

function isAgentRuntimeProcess(process: ResourceProcess): boolean {
  return /\b(zmx|codex|code-server|computer-use|chrome-devtools-mcp|devtools)\b/i.test(process.command);
}

function getCefProcessLabel(process: ResourceProcess): string {
  const clientId = /--client-id=(\d+)/.exec(process.command)?.[1];
  if (clientId) {
    return `CEF Tab client-id ${clientId}`;
  }
  if (process.command.includes("--type=gpu-process")) {
    return "CEF GPU";
  }
  if (process.command.includes("--type=utility")) {
    return "CEF Utility";
  }
  return "CEF Renderer";
}

function getProcessDisplayName(process: ResourceProcess): string {
  const command = process.command.split(/\s+/)[0] ?? "Process";
  return command.split("/").pop() || command;
}

function sumProcessCpu(processes: ResourceProcess[]): number {
  return processes.reduce((sum, process) => sum + process.cpu, 0);
}

function sumProcessMemory(processes: ResourceProcess[]): number {
  return processes.reduce((sum, process) => sum + process.rssMb, 0);
}

function sumBundleCpu(bundles: ResourceProcessBundle[]): number {
  return bundles.reduce((sum, bundle) => sum + bundle.cpu, 0);
}

function sumBundleMemory(bundles: ResourceProcessBundle[]): number {
  return bundles.reduce((sum, bundle) => sum + bundle.memoryMb, 0);
}

function createInactiveAgentSleepSessionIds(resourceGroups: TitlebarResourceGroup[]): string[] {
  const thresholdTime = Date.now() - INACTIVE_AGENT_SLEEP_THRESHOLD_MS;
  /**
   * CDXC:TitlebarResources 2026-05-16-19:53:
   * The dropdown sleep shortcut is intentionally conservative: only awake,
   * idle agent terminal sessions older than seven minutes are eligible. Working
   * and attention sessions must stay awake because those states indicate active
   * output or a user-visible response waiting for review.
   */
  return resourceGroups.flatMap((group) =>
    group.sessions
      .filter((session) => {
        if (
          session.sessionKind !== "terminal" ||
          !session.agentIcon ||
          session.isSleeping === true ||
          session.activity === "working" ||
          session.activity === "attention"
        ) {
          return false;
        }
        const lastInteractionTime = session.lastInteractionAt
          ? Date.parse(session.lastInteractionAt)
          : Number.NaN;
        return Number.isFinite(lastInteractionTime) && lastInteractionTime < thresholdTime;
      })
      .map((session) =>
        session.projectId
          ? createCombinedProjectSessionId(session.projectId, session.sessionId)
          : session.sessionId,
      ),
  );
}

function formatWholePercent(value: number): string {
  return `${Math.trunc(Math.max(0, value))}%`;
}

function formatWholeMemory(value: number): string {
  return value >= 1024
    ? `${Math.trunc(value / 1024)} GB`
    : `${Math.trunc(Math.max(0, value))} MB`;
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
  const [resourcesMenuOpen, setResourcesMenuOpen] = useState(false);
  const [resourceProcesses, setResourceProcesses] = useState<ResourceProcess[]>([]);
  const [collapsedResourceKeys, setCollapsedResourceKeys] = useState<Set<string>>(() => new Set());
  const [optimisticMode, setOptimisticMode] = useState<TitlebarMode>();
  const copyTooltipTimeoutRef = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeMode = optimisticMode ?? projectState.activeMode;
  const resourceViews = useMemo(
    () => createResourceGroupViews(projectState.resourceGroups, resourceProcesses),
    [projectState.resourceGroups, resourceProcesses],
  );
  const inactiveAgentSleepSessionIds = useMemo(
    () => createInactiveAgentSleepSessionIds(projectState.resourceGroups),
    [projectState.resourceGroups],
  );

  useEffect(() => {
    const suppressTitlebarWebviewContextMenu = (event: MouseEvent) => {
      /**
       * CDXC:TitlebarContextMenu 2026-05-15-18:21:
       * Right-clicking titlebar buttons, menus, labels, or project text must
       * not expose WKWebView's native Reload menu. The titlebar has no editable
       * text fields, so suppress the webview default for the whole isolated
       * titlebar document while leaving React click/keyboard behavior intact.
       */
      event.preventDefault();
    };

    document.addEventListener("contextmenu", suppressTitlebarWebviewContextMenu, true);
    return () => {
      document.removeEventListener("contextmenu", suppressTitlebarWebviewContextMenu, true);
    };
  }, []);

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
    resourcesMenuOpen,
    resourceProcesses.length,
    projectState.projectEditorCompanionPaneHidden,
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
      closeOpenDropdowns: () => {
        /**
         * CDXC:ReactTitlebar 2026-05-16-20:01:
         * Native app content lives outside this titlebar WKWebView, so Radix
         * cannot observe normal outside clicks in the workspace/sidebar. Expose
         * one explicit close hook that AppKit can call before routing the click
         * to the real app surface behind an open dropdown.
         */
        setActionsMenuOpen(false);
        setOpenInMenuOpen(false);
        setResourcesMenuOpen(false);
      },
      setActiveProjectState: (state) => {
        setProjectState((current) => ({
          ...current,
          ...state,
          activeMode:
            state.activeMode === undefined
              ? current.activeMode
              : normalizeTitlebarMode(state.activeMode),
          debuggingMode: state.debuggingMode ?? current.debuggingMode,
          diffStats: state.diffStats ?? current.diffStats,
          projectEditorCompanionPaneHidden:
            state.projectEditorCompanionPaneHidden ?? current.projectEditorCompanionPaneHidden,
          petOverlayEnabled: state.petOverlayEnabled ?? current.petOverlayEnabled,
          resourceGroups: state.resourceGroups ?? current.resourceGroups,
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
  }, [projectState.projectId, projectState.projectPath]);

  useEffect(() => {
    setOptimisticMode(undefined);
  }, [projectState.activeMode, projectState.projectId, projectState.projectPath]);

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

  const refreshResources = useCallback(async () => {
    try {
      const result = await runNativeProcess("/bin/ps", [
        "-axo",
        "pid=,ppid=,pcpu=,rss=,command=",
      ]);
      if (result.exitCode === 0) {
        setResourceProcesses(parseResourceProcessTable(result.stdout));
      }
    } catch (error) {
      console.warn("Failed to refresh Ghostex resources", error);
    }
  }, []);

  useEffect(() => {
    if (!resourcesMenuOpen) {
      return;
    }
    /**
     * CDXC:TitlebarResources 2026-05-16-16:08:
     * The Resources dropdown should show live process CPU and memory without a
     * native push channel. Poll `ps` only while the wide dropdown is open so
     * the compact titlebar does not spend idle work on hidden diagnostics.
     */
    void refreshResources();
    const interval = window.setInterval(() => {
      void refreshResources();
    }, RESOURCE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refreshResources, resourcesMenuOpen]);

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
      appendTitlebarActionCrashDebugLog("nativeSidebar.actionCrashTrace.titlebarMissingAction", {
        projectId: projectState.projectId,
        projectPath: projectState.projectPath,
      });
      return;
    }
    appendTitlebarActionCrashDebugLog("nativeSidebar.actionCrashTrace.titlebarClick", {
      actionType: command.actionType,
      closeTerminalOnExit: command.closeTerminalOnExit,
      commandId: command.commandId,
      hasCommand: Boolean(command.command?.trim()),
      hasUrl: Boolean(command.url?.trim()),
      projectId: projectState.projectId,
      projectPath: projectState.projectPath,
    });
    setSelectedActionCommandId(command.commandId);
    persistLastActionCommandId(projectState, command.commandId);
    postNative({ commandId: command.commandId, type: "runSidebarCommandFromTitlebar" });
  };

  const toggleResourceCollapse = (key: string) => {
    setCollapsedResourceKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const killResourceBundle = (bundle: ResourceProcessBundle) => {
    const pids = Array.from(new Set(bundle.pids)).filter((pid) => Number.isFinite(pid));
    if (pids.length === 0) {
      return;
    }
    void runNativeProcess("/bin/kill", ["-TERM", ...pids.map(String)]).finally(() => {
      window.setTimeout(() => {
        void refreshResources();
      }, 250);
    });
  };

  const sleepInactiveAgentSessions = () => {
    if (inactiveAgentSleepSessionIds.length === 0) {
      return;
    }
    postNative({
      sessionIds: inactiveAgentSleepSessionIds,
      type: "sleepInactiveSessionsFromTitlebar",
    });
  };

  const openAgentsMode = () => {
    setOptimisticMode("agents");
    postNative({ type: "openAgentsModeFromTitlebar" });
  };

  const openCodeMode = () => {
    appendTitlebarCodeLagDebugLog(projectState.debuggingMode, "titlebarCodeLag.titlebarClickStart", {
      activeMode: projectState.activeMode,
      editorIsOpen: projectState.editorIsOpen,
      editorIsSleeping: projectState.editorIsSleeping,
      editorStatus: projectState.editorStatus,
      optimisticMode,
      projectId: projectState.projectId,
      projectPath: projectState.projectPath,
    });
    setOptimisticMode("code");
    postNative({ type: "openActiveProjectEditorFromTitlebar" });
    appendTitlebarCodeLagDebugLog(projectState.debuggingMode, "titlebarCodeLag.titlebarClickPostedNative", {
      projectId: projectState.projectId,
      projectPath: projectState.projectPath,
    });
  };

  const openGitMode = () => {
    setOptimisticMode("git");
    postNative({ type: "openGitHubProjectFromTitlebar" });
  };

  const openTasksMode = () => {
    setOptimisticMode("tasks");
    postNative({ type: "openTasksPlaceholderFromTitlebar" });
  };

  const togglePetOverlay = () => {
    postNative({ type: "togglePetOverlayFromTitlebar" });
  };

  const showProjectEditorCompanion = () => {
    postNative({ type: "showProjectEditorCompanionFromTitlebar" });
  };

  const shouldShowCompanionRestoreButton =
    activeMode !== "agents" &&
    projectState.editorIsOpen &&
    !projectState.editorIsSleeping &&
    projectState.projectEditorCompanionPaneHidden;

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
            {shouldShowCompanionRestoreButton ? (
              <div style={styles.companionRestoreSlot}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label="Show Agent Side Pane"
                      className="titlebar-session-button titlebar-companion-restore-button"
                      data-titlebar-hit-region
                      onClick={showProjectEditorCompanion}
                      type="button"
                      variant="ghost"
                    >
                      {/*
                       * CDXC:ProjectEditorCompanion 2026-05-16-14:42:
                       * The hidden companion-pane restore control is floating
                       * titlebar chrome. Keep it outside the mode switcher flow
                       * so showing the button never shifts Agents/Code/Git/Project tabs.
                       */}
                      <IconLayoutSidebarLeftExpand aria-hidden="true" size={16} stroke={1.8} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Show Agent Side Pane</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
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
                  /**
                   * CDXC:ProjectMode 2026-05-15-15:35:
                   * The existing tasks-backed mode is labeled Project because
                   * its coming-soon surface is a broader project workspace for
                   * automations, todos, docs, and more.
                   */
                  icon: <IconChecklist aria-hidden="true" size={14} stroke={1.8} />,
                  label: "Project",
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
                   * The top bar should expose the pet wake/sleep control as a
                   * robot head without the Rotate Panes button; pane rotation
                   * now lives in the per-pane overflow menu below Split
                   * Downwards.
                   */}
                  <IconRobotFace aria-hidden="true" size={16} stroke={1.8} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{projectState.petOverlayEnabled ? "Hide pet" : "Show pet"}</TooltipContent>
            </Tooltip>
            <div aria-hidden="true" className="titlebar-section-separator" />
            <DropdownMenu onOpenChange={setResourcesMenuOpen} open={resourcesMenuOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="Ghostex resources"
                      className="titlebar-session-button titlebar-resource-button"
                      data-titlebar-hit-region
                      type="button"
                      variant="ghost"
                    >
                      {/*
                       * CDXC:TitlebarResources 2026-05-16-16:08:
                       * The Resources button belongs between the pet toggle
                       * and the action/start groups. IconCpu identifies the
                       * live CPU/memory process inspector without adding text
                       * to the compact titlebar.
                       */}
                      <IconCpu aria-hidden="true" size={16} stroke={1.8} />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Resources</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                align="end"
                className="titlebar-open-menu titlebar-resources-menu rounded-lg border-border/80 !bg-[#181818] p-0 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#181818" }}
              >
                <TitlebarResourcesMenu
                  appBundles={resourceViews.appBundles}
                  cefBundles={resourceViews.cefBundles}
                  collapsedKeys={collapsedResourceKeys}
                  groupViews={resourceViews.groupViews}
                  inactiveAgentSleepSessionCount={inactiveAgentSleepSessionIds.length}
                  onKill={killResourceBundle}
                  onSleepInactiveSessions={sleepInactiveAgentSessions}
                  onToggle={toggleResourceCollapse}
                  orphanBundles={resourceViews.orphanBundles}
                />
              </DropdownMenuContent>
            </DropdownMenu>
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
    activeMode: resolveInitialTitlebarMode(bootstrap),
    debuggingMode: settings.debuggingMode,
    diffStats: createDefaultSidebarProjectDiffStats(false),
    editorIsOpen: false,
    editorIsSleeping: false,
    editorStatus: "idle",
    projectEditorCompanionPaneHidden: false,
    projectName:
      (typeof bootstrap.workspaceName === "string" && bootstrap.workspaceName) ||
      pathParts[pathParts.length - 1] ||
      "Ghostex",
    projectPath,
    petOverlayEnabled: settings.petOverlayEnabled,
    resourceGroups: [],
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

function TitlebarResourcesMenu({
  appBundles,
  cefBundles,
  collapsedKeys,
  groupViews,
  inactiveAgentSleepSessionCount,
  onKill,
  onSleepInactiveSessions,
  onToggle,
  orphanBundles,
}: {
  appBundles: ResourceProcessBundle[];
  cefBundles: ResourceProcessBundle[];
  collapsedKeys: Set<string>;
  groupViews: ResourceGroupView[];
  inactiveAgentSleepSessionCount: number;
  onKill: (bundle: ResourceProcessBundle) => void;
  onSleepInactiveSessions: () => void;
  onToggle: (key: string) => void;
  orphanBundles: ResourceProcessBundle[];
}) {
  const visibleGroupViews = groupViews.filter((view) => view.bundles.length > 0);
  const allBundles = [
    ...visibleGroupViews.flatMap((view) => view.bundles),
    ...appBundles,
    ...cefBundles,
    ...orphanBundles,
  ];
  return (
    <div className="titlebar-resources-panel">
      <div className="titlebar-resources-header">
        <div className="titlebar-resources-title">
          <IconCpu aria-hidden="true" size={18} stroke={1.8} />
          <span>Ghostex Resources</span>
          <span className="titlebar-resources-note">Most resources are used by your Agent CLIs</span>
        </div>
        <div className="titlebar-resources-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Sleep inactive sessions"
                className="titlebar-resources-sleep-button"
                data-enabled={String(inactiveAgentSleepSessionCount > 0)}
                disabled={inactiveAgentSleepSessionCount === 0}
                onClick={onSleepInactiveSessions}
                type="button"
              >
                <IconMoon aria-hidden="true" size={14} stroke={1.8} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Sleep inactive sessions</TooltipContent>
          </Tooltip>
          <div className="titlebar-resources-summary">
            <span>
              <IconCpu aria-hidden="true" size={13} stroke={1.8} />
              {formatWholePercent(sumBundleCpu(allBundles))}
            </span>
            <span>
              <IconDeviceDesktop aria-hidden="true" size={13} stroke={1.8} />
              {formatWholeMemory(sumBundleMemory(allBundles))}
            </span>
          </div>
        </div>
      </div>
      <div className="titlebar-resources-scroll">
        {visibleGroupViews.length > 0 ? (
          visibleGroupViews.map((view) => (
            <TitlebarResourceSection
              collapsedKeys={collapsedKeys}
              key={view.group.groupId}
              onKill={onKill}
              onToggle={onToggle}
              sectionKey={`group:${view.group.groupId}`}
              title={view.group.title}
              bundles={view.bundles}
            />
          ))
        ) : (
          <div className="titlebar-resources-empty">No grouped sessions matched running processes.</div>
        )}
        <TitlebarResourceSection
          collapsedKeys={collapsedKeys}
          onKill={onKill}
          onToggle={onToggle}
          sectionKey="app-runtime"
          title="App Runtime"
          bundles={appBundles}
        />
        <TitlebarResourceSection
          collapsedKeys={collapsedKeys}
          onKill={onKill}
          onToggle={onToggle}
          sectionKey="cef-tabs"
          title="CEF Tabs"
          bundles={cefBundles}
        />
        <TitlebarResourceSection
          collapsedKeys={collapsedKeys}
          onKill={onKill}
          onToggle={onToggle}
          sectionKey="orphaned"
          title="Orphaned / Detached"
          bundles={orphanBundles}
        />
      </div>
    </div>
  );
}

function TitlebarResourceSection({
  bundles,
  collapsedKeys,
  onKill,
  onToggle,
  sectionKey,
  title,
}: {
  bundles: ResourceProcessBundle[];
  collapsedKeys: Set<string>;
  onKill: (bundle: ResourceProcessBundle) => void;
  onToggle: (key: string) => void;
  sectionKey: string;
  title: string;
}) {
  if (bundles.length === 0) {
    return null;
  }
  const isCollapsed = collapsedKeys.has(sectionKey);
  const sectionCpu = sumBundleCpu(bundles);
  const sectionMemory = sumBundleMemory(bundles);
  return (
    <section className="titlebar-resource-section">
      <button className="titlebar-resource-section-heading" onClick={() => onToggle(sectionKey)} type="button">
        <IconChevronDown aria-hidden="true" data-collapsed={String(isCollapsed)} size={14} stroke={1.8} />
        <span>{title}</span>
        <span className="titlebar-resource-section-summary">
          <span>
            <IconCpu aria-hidden="true" size={12} stroke={1.8} />
            {formatWholePercent(sectionCpu)}
          </span>
          <span>
            <IconDeviceDesktop aria-hidden="true" size={12} stroke={1.8} />
            {formatWholeMemory(sectionMemory)}
          </span>
          <span className="titlebar-resource-section-count">{bundles.length}</span>
        </span>
      </button>
      {isCollapsed ? null : (
        <div className="titlebar-resource-section-body">
          {bundles.map((bundle) => (
            <TitlebarResourceBundle
              bundle={bundle}
              collapsedKeys={collapsedKeys}
              key={bundle.key}
              onKill={onKill}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TitlebarResourceBundle({
  bundle,
  collapsedKeys,
  onKill,
  onToggle,
}: {
  bundle: ResourceProcessBundle;
  collapsedKeys: Set<string>;
  onKill: (bundle: ResourceProcessBundle) => void;
  onToggle: (key: string) => void;
}) {
  const hasChildren = bundle.childProcesses.length > 0;
  /**
   * CDXC:TitlebarResources 2026-05-16-18:28:
   * Sessions often own several agent/runtime child processes, so their rows
   * should start collapsed to keep the Resources menu scannable. Store only
   * explicit user expansions for session bundles while section rows and other
   * bundle types keep the existing collapsed-key behavior.
   */
  const isSessionCollapsedByDefault = bundle.type === "session" && hasChildren;
  const bundleToggleKey = isSessionCollapsedByDefault ? `expanded:${bundle.key}` : bundle.key;
  const isCollapsed = isSessionCollapsedByDefault
    ? !collapsedKeys.has(bundleToggleKey)
    : collapsedKeys.has(bundleToggleKey);
  return (
    <div className="titlebar-resource-bundle">
      <div
        className="titlebar-resource-row"
        data-expandable={String(hasChildren)}
        onClick={() => {
          if (hasChildren) {
            onToggle(bundleToggleKey);
          }
        }}
      >
        <div className="titlebar-resource-main">
          {hasChildren ? (
            <button
              className="titlebar-resource-collapse-button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(bundleToggleKey);
              }}
              type="button"
            >
              <IconChevronDown aria-hidden="true" data-collapsed={String(isCollapsed)} size={14} stroke={1.8} />
            </button>
          ) : (
            <span className="titlebar-resource-collapse-spacer" />
          )}
          <span className="titlebar-resource-avatar">{getResourceBundleAvatar(bundle)}</span>
          <span className="titlebar-resource-text">
            <span className="titlebar-resource-name">{bundle.label}</span>
            <span className="titlebar-resource-meta">{getResourceBundleMeta(bundle)}</span>
          </span>
        </div>
        <span className="titlebar-resource-metric">
          <IconCpu aria-hidden="true" size={13} stroke={1.8} />
          {formatWholePercent(bundle.cpu)}
        </span>
        <span className="titlebar-resource-metric">
          <IconDeviceDesktop aria-hidden="true" size={13} stroke={1.8} />
          {formatWholeMemory(bundle.memoryMb)}
        </span>
        <button
          aria-label={`Close ${bundle.label}`}
          className="titlebar-resource-kill-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onKill(bundle);
          }}
          type="button"
        >
          <IconX aria-hidden="true" size={13} stroke={2} />
        </button>
      </div>
      {hasChildren && !isCollapsed ? (
        <div className="titlebar-resource-children">
          {bundle.childProcesses.slice(0, 8).map((process) => (
            <div className="titlebar-resource-child-row" key={process.pid}>
              <span className="titlebar-resource-child-name">{getProcessDisplayName(process)} pid {process.pid}</span>
              <span className="titlebar-resource-metric">
                <IconCpu aria-hidden="true" size={12} stroke={1.8} />
                {formatWholePercent(process.cpu)}
              </span>
              <span className="titlebar-resource-metric">
                <IconDeviceDesktop aria-hidden="true" size={12} stroke={1.8} />
                {formatWholeMemory(process.rssMb)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getResourceBundleAvatar(bundle: ResourceProcessBundle): string {
  if (bundle.session?.sessionKind === "browser") {
    return "B";
  }
  if (bundle.type === "code") {
    return "V";
  }
  if (bundle.type === "cef") {
    return "C";
  }
  if (bundle.type === "app") {
    return "GX";
  }
  return (bundle.session?.agentIcon ?? bundle.label).slice(0, 2).toUpperCase();
}

function getResourceBundleMeta(bundle: ResourceProcessBundle): string {
  if (bundle.session) {
    const provider = bundle.session.sessionPersistenceProvider
      ? `${bundle.session.sessionPersistenceProvider} terminal`
      : bundle.session.sessionKind ?? "session";
    const pid = bundle.process?.pid ? ` pid ${bundle.process.pid}` : "";
    return `${provider}${pid}`;
  }
  if (bundle.process?.pid) {
    return `pid ${bundle.process.pid}`;
  }
  return bundle.type;
}

function normalizeTitlebarMode(candidate: unknown): TitlebarMode {
  /**
   * CDXC:ModeSwitcher 2026-05-15-18:20:
   * The top titlebar mode must mirror the workarea mode restored by the sidebar
   * at launch and after each mode transition. Treat the sidebar/native payload
   * as authoritative so a restored Code, Git, or Project pane cannot leave the
   * segmented control highlighted on Agents.
   *
   * CDXC:ModeSwitcher 2026-05-15-18:30:
   * User clicks still need optimistic local mode selection so the shared-layout
   * pill animates immediately while slow Code/Git/Project surfaces load. Clear
   * that optimistic value when sidebar state arrives so startup restore and
   * failed transitions remain synchronized with the real visible workarea.
   */
  return candidate === "code" || candidate === "git" || candidate === "tasks"
    ? candidate
    : "agents";
}

function resolveInitialTitlebarMode(bootstrap: Record<string, unknown>): TitlebarMode {
  const explicitMode = normalizeTitlebarMode(bootstrap.activeMode);
  if (explicitMode !== "agents") {
    return explicitMode;
  }
  const sharedProjectsJson = isRecord(bootstrap.sharedSidebarStorage)
    ? bootstrap.sharedSidebarStorage.projects
    : undefined;
  if (typeof sharedProjectsJson !== "string") {
    return "agents";
  }
  try {
    const candidate = JSON.parse(sharedProjectsJson);
    const projects = Array.isArray(candidate?.projects) ? candidate.projects : [];
    const activeProjectId =
      typeof candidate?.activeProjectId === "string" ? candidate.activeProjectId : undefined;
    const activeProject =
      projects.find(
        (project: unknown) =>
          isRecord(project) &&
          typeof project.projectId === "string" &&
          project.projectId === activeProjectId,
      ) ?? projects[0];
    if (
      isRecord(activeProject) &&
      isRecord(activeProject.projectEditor) &&
      activeProject.projectEditor.isOpen === true
    ) {
      return "code";
    }
  } catch {
    return "agents";
  }
  return "agents";
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

        CDXC:ModeSwitcher 2026-05-15-14:54:
        The active pill must visibly travel from the previously active mode to
        the newly selected mode. Keep tab overflow visible so Framer Motion's
        shared-layout element is not clipped to the destination button, which
        would make Agents-to-Tasks look like a direct jump.
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
  companionRestoreSlot: {
    position: "absolute",
    right: "calc(100% + 25px)",
    top: 1,
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
   * CDXC:ReactTitlebar 2026-05-15-19:41
   * The top-right titlebar should not duplicate the Commands pane entry point.
   * Remove the corner terminal icon and its left separator so Commands access
   * lives in the sidebar footer instead of competing with project actions.
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
  .titlebar-companion-restore-button {
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
    overflow: visible;
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
  .titlebar-resource-button {
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
  .titlebar-resources-menu {
    width: min(820px, calc(100vw - 24px));
    max-height: min(760px, calc(100vh - 46px));
    overflow: hidden;
  }
  .titlebar-resources-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    max-height: min(760px, calc(100vh - 46px));
    overflow: hidden;
  }
  .titlebar-resources-header {
    align-items: center;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 12px;
  }
  .titlebar-resources-title,
  .titlebar-resources-actions,
  .titlebar-resources-summary,
  .titlebar-resource-section-summary,
  .titlebar-resource-section-summary span,
  .titlebar-resources-summary span {
    align-items: center;
    display: inline-flex;
  }
  .titlebar-resources-title {
    gap: 8px;
    font: 750 14px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    min-width: 0;
  }
  .titlebar-resources-note {
    color: rgba(255,255,255,0.46);
    font: 500 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    margin-left: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .titlebar-resources-actions {
    gap: 10px;
    margin-left: auto;
  }
  .titlebar-resources-sleep-button {
    align-items: center;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: rgba(255,255,255,0.78);
    display: inline-flex;
    height: 24px;
    justify-content: center;
    padding: 0;
    width: 24px;
  }
  .titlebar-resources-sleep-button:disabled {
    color: rgba(255,255,255,0.3);
    cursor: default;
    opacity: 0.55;
  }
  .titlebar-resources-sleep-button:not(:disabled):hover {
    background: rgba(255,255,255,0.14);
    color: rgba(255,255,255,0.92);
  }
  .titlebar-resources-summary {
    color: rgba(255,255,255,0.72);
    gap: 12px;
    font: 650 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  }
  .titlebar-resources-summary span {
    gap: 5px;
  }
  .titlebar-resources-scroll {
    display: grid;
    gap: 0;
    max-height: min(700px, calc(100vh - 104px));
    overflow: auto;
    padding: 8px 10px 10px;
  }
  .titlebar-resource-section + .titlebar-resource-section {
    border-top: 1px solid rgba(255,255,255,0.08);
    margin-top: 8px;
    padding-top: 8px;
  }
  .titlebar-resource-section-heading {
    align-items: center;
    appearance: none;
    background: transparent;
    border: 0;
    color: rgba(255,255,255,0.62);
    display: flex;
    font: 750 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    gap: 6px;
    letter-spacing: 0.08em;
    padding: 4px 2px 7px;
    text-transform: uppercase;
    width: 100%;
  }
  .titlebar-resource-section-heading svg[data-collapsed="true"],
  .titlebar-resource-collapse-button svg[data-collapsed="true"] {
    transform: rotate(-90deg);
  }
  .titlebar-resource-section-count {
    color: rgba(255,255,255,0.38);
  }
  .titlebar-resource-section-summary {
    color: rgba(255,255,255,0.52);
    gap: 10px;
    margin-left: auto;
    text-transform: none;
  }
  .titlebar-resource-section-summary span {
    gap: 4px;
    letter-spacing: 0;
  }
  .titlebar-resource-section-body {
    display: grid;
    gap: 7px;
  }
  .titlebar-resource-bundle {
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    overflow: hidden;
    background: rgba(255,255,255,0.025);
  }
  .titlebar-resource-row {
    align-items: center;
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(270px, 1fr) 82px 94px;
    min-height: 44px;
    padding: 7px 8px;
    position: relative;
  }
  .titlebar-resource-row[data-expandable="true"] {
    cursor: pointer;
  }
  .titlebar-resource-main {
    align-items: center;
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  .titlebar-resource-collapse-button {
    align-items: center;
    background: transparent;
    border: 0;
    color: rgba(255,255,255,0.55);
    display: inline-flex;
    height: 20px;
    justify-content: center;
    padding: 0;
    width: 20px;
  }
  .titlebar-resource-collapse-spacer {
    flex: 0 0 20px;
  }
  .titlebar-resource-avatar {
    align-items: center;
    background: rgba(255,255,255,0.1);
    border-radius: 999px;
    color: rgba(255,255,255,0.84);
    display: inline-flex;
    flex: 0 0 auto;
    font: 750 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    height: 28px;
    justify-content: center;
    width: 28px;
  }
  .titlebar-resource-text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .titlebar-resource-name {
    color: rgba(255,255,255,0.94);
    font: 700 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .titlebar-resource-meta,
  .titlebar-resource-child-name {
    color: rgba(255,255,255,0.58);
    font: 500 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .titlebar-resource-metric {
    align-items: center;
    color: rgba(255,255,255,0.86);
    display: inline-flex;
    font: 650 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    font-variant-numeric: tabular-nums;
    gap: 5px;
    justify-content: flex-end;
    white-space: nowrap;
  }
  .titlebar-resource-metric svg {
    color: rgba(255,255,255,0.58);
  }
  .titlebar-resource-kill-button {
    align-items: center;
    background: rgb(220 38 38);
    border: 0;
    border-radius: 5px;
    box-shadow: 0 8px 18px rgba(0,0,0,0.35);
    color: white;
    display: inline-flex;
    height: 22px;
    justify-content: center;
    opacity: 0;
    padding: 0;
    pointer-events: none;
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%) scale(0.96);
    transition: opacity 120ms ease, transform 120ms ease;
    width: 22px;
  }
  .titlebar-resource-row:hover .titlebar-resource-kill-button,
  .titlebar-resource-row:focus-within .titlebar-resource-kill-button {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) scale(1);
  }
  .titlebar-resource-children {
    display: grid;
    padding: 0 8px 8px 64px;
  }
  .titlebar-resource-child-row {
    align-items: center;
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(220px, 1fr) 82px 94px;
    min-height: 24px;
  }
  .titlebar-resources-empty {
    color: rgba(255,255,255,0.54);
    font: 500 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    padding: 10px 4px;
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<App />);
