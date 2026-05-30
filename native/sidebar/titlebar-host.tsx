import {
  IconArrowsDiagonal2,
  IconArrowsDiagonalMinimize,
  IconBox,
  IconBrandGithub,
  IconCheck,
  IconChevronDown,
  IconChecklist,
  IconCode,
  IconCoffee,
  IconCpu,
  IconDeviceDesktop,
  IconDownload,
  IconFolderOpen,
  IconFocus2,
  IconGitCommit,
  IconGitPullRequest,
  IconLayoutSidebarLeftExpand,
  IconLoader2,
  IconMoon,
  IconPlayerPlay,
  IconRocket,
  IconSettings,
  IconStackPush,
  IconTerminal2,
  IconUpload,
  IconUser,
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
import {
  DEFAULT_BROWSER_ACTION_URL,
  getSidebarCommandPreviewLabel,
  isSidebarCommandConfigured,
  type SidebarCommandButton,
} from "../../shared/sidebar-commands";
import {
  DEFAULT_SIDEBAR_COMMAND_ICON,
  DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
} from "../../shared/sidebar-command-icons";
import type { CommandConfigDraft } from "../../sidebar/command-config-modal";
import { AGENT_LOGO_COLORS, AGENT_LOGOS } from "../../sidebar/agent-logos";
import type { SidebarAgentIcon } from "../../shared/sidebar-agents";
import {
  KEEP_AWAKE_DURATION_OPTIONS,
  normalizeghostexSettings,
  type KeepAwakeDurationMinutes,
} from "../../shared/ghostex-settings";
import {
  BUILT_IN_WORKSPACE_OPEN_TARGETS,
  type CustomWorkspaceOpenTarget,
  type WorkspaceIdeTargetApp,
  type WorkspaceOpenTargetAvailability,
  type WorkspaceOpenTargetDefinition,
} from "../../shared/workspace-open-targets";
import { EditorBrandIcon, getEditorBrandIconId } from "../../sidebar/brand-icons";
import { SidebarCommandIconGlyph } from "../../sidebar/sidebar-command-icon";
import { createCombinedProjectSessionId, parseCombinedProjectGroupId } from "./combined-sidebar-mode";
import "../../sidebar/styles.css";
import {
  buildSidebarGitMenuItems,
  createDefaultSidebarGitState,
  resolveSidebarGitPrimaryActionState,
  type SidebarGitAction,
  type SidebarGitState,
} from "../../shared/sidebar-git";

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

type TitlebarKeepAwakeSettings = {
  activateOnExternalDisplay: boolean;
  activateOnLaunch: boolean;
  allowDisplaySleep: boolean;
  batteryThresholdPercent: number;
  deactivateBelowBatteryThreshold: boolean;
  deactivateOnLowPowerMode: boolean;
  deactivateOnUserSwitch: boolean;
  defaultDurationMinutes: KeepAwakeDurationMinutes;
  hideTitlebarControl: boolean;
  preventLidSleep: boolean;
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

type TitlebarBrowserTabResource = {
  browserId: number;
  id: string;
  isActive?: boolean;
  kind: "browser" | "code" | "git" | "tasks" | string;
  projectId?: string;
  sessionId?: string;
  title: string;
  url?: string;
};

type TitlebarProjectState = {
  activeMode: TitlebarMode;
  browserTabs: TitlebarBrowserTabResource[];
  debuggingMode: boolean;
  diffStats: SidebarProjectDiffStats;
  editorIsOpen: boolean;
  editorIsSleeping: boolean;
  editorStatus: ProjectEditorLoadStatus;
  git: SidebarGitState;
  keepAwake: TitlebarKeepAwakeSettings;
  projectEditorCompanionPaneHidden: boolean;
  projectIconDataUrl?: string | null;
  projectId?: string;
  projectName: string;
  projectPath: string;
  petOverlayEnabled: boolean;
  resourceGroups: TitlebarResourceGroup[];
  sidebarActions: TitlebarSidebarActionsSettings;
  showProjectEditorDiffFileCount: boolean;
  sessionPersistenceProvider?: "tmux" | "zmx" | "zellij";
  workspaceOpenTargets: TitlebarOpenTargetsSettings;
  isFocusModeActive?: boolean;
  updateAvailable: boolean;
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
  browserTab?: TitlebarBrowserTabResource;
  session?: TitlebarResourceSession;
  type: "browser" | "code" | "orphan" | "session";
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
  | {
      enabled: boolean;
      installIfNeeded?: boolean;
      requestId: string;
      type: "setKeepAwakeLidSleepPrevention";
    }
  | { type: "openActiveProjectEditorFromTitlebar" }
  | { type: "showProjectEditorCompanionFromTitlebar" }
  | { type: "exitFocusModeFromTitlebar" }
  | { type: "openAgentsModeFromTitlebar" }
  | { type: "openGitHubProjectFromTitlebar" }
  | { type: "openTasksPlaceholderFromTitlebar" }
  | { type: "refreshWorkspaceOpenTargetAvailabilityFromTitlebar" }
  | { type: "toggleCommandsPanelFromTitlebar" }
  | { type: "showUpdateDialogFromTitlebar" }
  | { sessionId: string; type: "focusResourceSessionFromTitlebar" }
  | { sessionIds: string[]; type: "sleepInactiveSessionsFromTitlebar" }
  | { projectIds: string[]; sessionIds: string[]; type: "quitResourcesFromTitlebar" }
  | { commandId: string; type: "runSidebarCommandFromTitlebar" }
  | { action: SidebarGitAction; type: "runSidebarGitActionFromTitlebar" }
  | {
      targetApp: WorkspaceIdeTargetApp;
      type: "openWorkspaceInIde";
      workspacePath: string;
    }
  | { type: "openWorkspaceInFinder"; workspacePath: string }
  | {
      overlayOpen: boolean;
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
    };
  }
}

const LAST_OPEN_TARGET_STORAGE_KEY = "ghostex.titlebar.lastOpenTargetId";
const LAST_ACTION_COMMAND_STORAGE_PREFIX = "ghostex.titlebar.lastActionCommandByProject:";
const KEEP_AWAKE_RUNTIME_STORAGE_KEY = "ghostex.titlebar.keepAwakeRuntime";
const KEEP_AWAKE_LID_SLEEP_STORAGE_KEY = "ghostex.titlebar.lidSleepPrevention";
const RESOURCES_MENU_FIRST_OPEN_STORAGE_KEY = "ghostex.titlebar.resourcesMenuSeen";
const KEEP_AWAKE_POWER_CHECK_INTERVAL_MS = 30_000;
const KEEP_AWAKE_ADMIN_PROCESS_TIMEOUT_MS = 120_000;
/**
 * CDXC:NativeWindowChrome 2026-05-25-07:16:
 * The macOS app titlebar should now be 35px tall, not the earlier 45px. Keep the React titlebar height in sync with Swift's native reservation so web controls and AppKit traffic-light centering share one chrome height.
 */
const TITLEBAR_HEIGHT = 35;
const TITLEBAR_CONTROL_HEIGHT = 20;
const TITLEBAR_CONTROL_TOP = (TITLEBAR_HEIGHT - TITLEBAR_CONTROL_HEIGHT) / 2;
const TITLEBAR_PROJECT_TOP = TITLEBAR_CONTROL_TOP + 1;
const TITLEBAR_CENTER_CONTROLS_TOP = TITLEBAR_CONTROL_TOP;
const TITLEBAR_RIGHT_CONTROLS_TOP = TITLEBAR_CONTROL_TOP + 1;
const RESOURCE_POLL_INTERVAL_MS = 5_000;
/**
 * CDXC:ReactTitlebar 2026-05-11-09:17
 * Titlebar split-button menus are triggered from their chevrons but should
 * visually land under the whole grouped control. Use shadcn/Radix tooltips for
 * hover labels instead of native title attributes so the titlebar matches the
 * sidebar interaction model.
 */
const TITLEBAR_SPLIT_MENU_CENTER_OFFSET = -14;

type KeepAwakeRuntimeState = {
  durationMinutes: KeepAwakeDurationMinutes;
  fireAtMs?: number;
  pid: number;
  startedAtMs: number;
};

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
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
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
    }, options.timeoutMs ?? 30_000);
    pendingProcessResults.set(requestId, { reject, resolve, timeout });
  });
}

function runNativeKeepAwakeLidSleepPrevention(
  enabled: boolean,
  options: { installIfNeeded?: boolean; timeoutMs?: number } = {},
): Promise<NativeProcessResult> {
  const requestId = `titlebar-lid-sleep-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
  postNative({
    enabled,
    installIfNeeded: options.installIfNeeded,
    requestId,
    type: "setKeepAwakeLidSleepPrevention",
  });
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingProcessResults.delete(requestId);
      reject(new Error(`setKeepAwakeLidSleepPrevention ${enabled} timed out`));
    }, options.timeoutMs ?? KEEP_AWAKE_ADMIN_PROCESS_TIMEOUT_MS);
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

async function readResourceProcesses(): Promise<ResourceProcess[]> {
  const result = await runNativeProcess("/bin/ps", [
    "-axo",
    "pid=,ppid=,pcpu=,rss=,command=",
  ]);
  return result.exitCode === 0 ? parseResourceProcessTable(result.stdout) : [];
}

/**
 * CDXC:TitlebarResources 2026-05-23-10:46:
 * Resource-manager Quit is a process-manager action, so it must terminate the
 * exact processes shown in the dropdown while the sidebar separately preserves
 * terminal cards as sleeping sessions. Recheck the command before SIGKILL so a
 * delayed hard kill cannot target an unrelated process that reused the PID.
 */
async function terminateResourceProcesses(processes: ResourceProcess[]): Promise<void> {
  const targets = new Map(
    processes
      .filter((process) => Number.isFinite(process.pid) && process.pid > 1)
      .map((process) => [process.pid, process.command]),
  );
  if (targets.size === 0) {
    return;
  }

  await runNativeProcess("/bin/kill", ["-TERM", ...Array.from(targets.keys()).map(String)]);
  window.setTimeout(() => {
    void (async () => {
      const liveProcesses = await readResourceProcesses();
      const liveTargetPids = liveProcesses
        .filter((process) => targets.get(process.pid) === process.command)
        .map((process) => process.pid);
      if (liveTargetPids.length > 0) {
        await runNativeProcess("/bin/kill", ["-KILL", ...liveTargetPids.map(String)]);
      }
    })().catch((error) => {
      console.warn("Failed to finish terminating Ghostex resources", error);
    });
  }, 1_500);
}

function createResourceGroupViews(
  browserTabs: TitlebarBrowserTabResource[],
  resourceGroups: TitlebarResourceGroup[],
  processes: ResourceProcess[],
): { browserBundles: ResourceProcessBundle[]; groupViews: ResourceGroupView[]; orphanBundles: ResourceProcessBundle[] } {
  const claimedPids = new Set<number>();
  const childrenByParent = createProcessChildrenMap(processes);
  const groupedBrowserTabIds = new Set<string>();
  const groupViews = resourceGroups.map((group) => {
    const groupBrowserTabs = browserTabs
      .filter((tab) => isBrowserTabInResourceGroup(tab, group))
      .map((tab) => ({
        ...tab,
        projectId: tab.projectId ?? resourceGroupProjectIdForBrowserTab(tab, group),
      }));
    groupBrowserTabs.forEach((tab) => groupedBrowserTabIds.add(tab.id));
    const bundles = group.sessions
      .map((session) => createSessionResourceBundle(session, processes, childrenByParent, claimedPids))
      .filter((bundle): bundle is ResourceProcessBundle => bundle !== undefined);
    const codeBundle = createProjectCodeServerBundle(group, processes, childrenByParent, claimedPids);
    const browserBundles = createBrowserBundles(groupBrowserTabs, processes, claimedPids, {
      includeRuntimeBundles: false,
    });
    return {
      bundles: [...bundles, ...(codeBundle ? [codeBundle] : []), ...browserBundles],
      group,
    };
  });
  claimAppRuntimeProcesses(processes, childrenByParent, claimedPids);
  const browserBundles = createBrowserBundles(
    browserTabs.filter((tab) => !groupedBrowserTabIds.has(tab.id)),
    processes,
    claimedPids,
  );
  const orphanBundles = createOrphanBundles(processes, childrenByParent, claimedPids);
  return { browserBundles, groupViews, orphanBundles };
}

function createFirstOpenCollapsedResourceKeys(
  resourceViews: ReturnType<typeof createResourceGroupViews>,
): string[] {
  const sectionKeys = createVisibleResourceSectionKeys(resourceViews);
  const nonDefaultCollapsedBundleKeys = [
    ...resourceViews.groupViews
      .filter((view) => view.bundles.length > 0)
      .flatMap((view) => view.bundles),
    ...resourceViews.browserBundles,
    ...resourceViews.orphanBundles,
  ]
    .filter(
      (bundle) =>
        bundle.childProcesses.length > 0 && bundle.type !== "session" && bundle.type !== "browser",
    )
    .map((bundle) => bundle.key);
  return [...sectionKeys, ...nonDefaultCollapsedBundleKeys];
}

function createVisibleResourceSectionKeys(
  resourceViews: ReturnType<typeof createResourceGroupViews>,
): string[] {
  const visibleGroupViews = resourceViews.groupViews.filter((view) => view.bundles.length > 0);
  return [
    ...visibleGroupViews.map((view) => `group:${view.group.groupId}`),
    ...(resourceViews.browserBundles.length > 0 ? ["browser-tabs"] : []),
    ...(resourceViews.orphanBundles.length > 0 ? ["orphaned"] : []),
  ];
}

function isBrowserTabInResourceGroup(
  tab: TitlebarBrowserTabResource,
  group: TitlebarResourceGroup,
): boolean {
  const tabSessionId = browserTabSessionId(tab);
  if (tabSessionId && group.sessions.some((session) => session.sessionId === tabSessionId)) {
    return true;
  }
  const projectId = browserTabProjectId(tab);
  return Boolean(projectId && group.projectId && projectId === group.projectId);
}

function resourceGroupProjectIdForBrowserTab(
  tab: TitlebarBrowserTabResource,
  group: TitlebarResourceGroup,
): string | undefined {
  const tabSessionId = browserTabSessionId(tab);
  return group.projectId ?? group.sessions.find((session) => session.sessionId === tabSessionId)?.projectId;
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

function claimAppRuntimeProcesses(
  processes: ResourceProcess[],
  childrenByParent: Map<number, ResourceProcess[]>,
  claimedPids: Set<number>,
): void {
  const appProcesses = processes.filter(
    (process) =>
      !claimedPids.has(process.pid) &&
      /ghostexHost|Ghostex\.app|ghostex/i.test(process.command),
  );
  const appPids = new Set(appProcesses.map((process) => process.pid));
  /**
   * CDXC:TitlebarResources 2026-05-16-19:53:
   * Ghostex-owned app processes need to be claimed as one process tree, not as
   * individual helper matches, so they never leak into detached resource rows.
   *
   * CDXC:TitlebarResources 2026-05-25-16:53:
   * The Resources dropdown should hide Ghostex's own app-runtime rows. Keep
   * matching these processes only to reserve their PIDs before browser and
   * orphan resource sections are built.
   *
   * CDXC:TitlebarResources 2026-05-29-12:02:
   * Ghostex-launched zmx/tmux/zellij and agent roots are user work resources,
   * not app runtime. Do not reserve those roots here; leave them for session or
   * orphan resource tree walking so child processes such as node, npm, Codex,
   * and DevTools helpers stay counted under the Ghostex-owned session root.
   */
  appProcesses
    .filter((process) => !appPids.has(process.ppid) && !isAgentRuntimeProcess(process))
    .slice(0, 3)
    .forEach((process) => {
      const tree = collectProcessTree([process], childrenByParent).filter(
        (treeProcess) =>
          !claimedPids.has(treeProcess.pid) &&
          !isGhostexBrowserProcess(treeProcess) &&
          (treeProcess.pid === process.pid || !isAgentRuntimeProcess(treeProcess)),
      );
      tree.forEach((treeProcess) => claimedPids.add(treeProcess.pid));
    });
}

function createBrowserBundles(
  browserTabs: TitlebarBrowserTabResource[],
  processes: ResourceProcess[],
  claimedPids: Set<number>,
  options: { includeRuntimeBundles?: boolean } = {},
): ResourceProcessBundle[] {
  /**
   * CDXC:TitlebarResources 2026-05-17-03:09:
   * Browser tab resources must only count Ghostex-owned embedded browser helper
   * processes. System-wide Chromium/Electron helpers from Chrome, VS Code,
   * Codex, Discord, or other apps can share the same `--type=renderer`
   * arguments, so ownership must be proven before a process is allowed into the
   * Browser Tabs section.
   */
  const browserProcesses = processes.filter(
    (process) => !claimedPids.has(process.pid) && isGhostexBrowserProcess(process),
  );
  const bundles: ResourceProcessBundle[] = [];
  for (const tab of browserTabs) {
    const tabProcesses = browserProcesses.filter(
      (process) => browserProcessClientId(process) === String(tab.browserId),
    );
    if (tabProcesses.length === 0) {
      continue;
    }
    tabProcesses.forEach((process) => claimedPids.add(process.pid));
    bundles.push({
      browserTab: tab,
      childProcesses: tabProcesses,
      cpu: sumProcessCpu(tabProcesses),
      key: `browser:${tab.id}`,
      label: tab.title,
      memoryMb: sumProcessMemory(tabProcesses),
      pids: tabProcesses.map((process) => process.pid),
      process: tabProcesses[0],
      type: "browser",
    });
  }
  if (options.includeRuntimeBundles === false) {
    return bundles.slice(0, 16);
  }
  const remainingProcesses = browserProcesses.filter((process) => !claimedPids.has(process.pid));
  const unmatchedRendererProcesses = remainingProcesses.filter((process) => browserProcessClientId(process));
  if (unmatchedRendererProcesses.length > 0) {
    unmatchedRendererProcesses.forEach((process) => claimedPids.add(process.pid));
    bundles.push({
      childProcesses: unmatchedRendererProcesses.slice(0, 12),
      cpu: sumProcessCpu(unmatchedRendererProcesses),
      key: "browser:unmatched-renderers",
      label: "Unmatched browser renderers",
      memoryMb: sumProcessMemory(unmatchedRendererProcesses),
      pids: unmatchedRendererProcesses.map((process) => process.pid),
      process: unmatchedRendererProcesses[0],
      type: "browser",
    });
  }
  const runtimeProcesses = remainingProcesses.filter((process) => !claimedPids.has(process.pid));
  if (runtimeProcesses.length > 0) {
    runtimeProcesses.forEach((process) => claimedPids.add(process.pid));
    bundles.push({
      childProcesses: runtimeProcesses.slice(0, 12),
      cpu: sumProcessCpu(runtimeProcesses),
      key: "browser:runtime",
      label: "Browser runtime",
      memoryMb: sumProcessMemory(runtimeProcesses),
      pids: runtimeProcesses.map((process) => process.pid),
      process: runtimeProcesses[0],
      type: "browser",
    });
  }
  return bundles.slice(0, 16);
}

function createOrphanBundles(
  processes: ResourceProcess[],
  childrenByParent: Map<number, ResourceProcess[]>,
  claimedPids: Set<number>,
): ResourceProcessBundle[] {
  const ownedSeedProcesses = processes.filter(
    (process) =>
      !claimedPids.has(process.pid) &&
      isGhostexOwnedResourceProcess(process) &&
      isAgentRuntimeProcess(process),
  );
  const ownedSeedPids = new Set(ownedSeedProcesses.map((process) => process.pid));
  return ownedSeedProcesses
    .filter((process) => !ownedSeedPids.has(process.ppid))
    .slice(0, 16)
    .map((process) => {
      const tree = collectProcessTree([process], childrenByParent).filter(
        (treeProcess) => !claimedPids.has(treeProcess.pid),
      );
      tree.forEach((treeProcess) => claimedPids.add(treeProcess.pid));
      return {
        childProcesses: tree.filter((treeProcess) => treeProcess.pid !== process.pid),
        cpu: sumProcessCpu(tree),
        key: `orphan:${process.pid}`,
        label: getProcessDisplayName(process),
        memoryMb: sumProcessMemory(tree),
        pids: tree.map((treeProcess) => treeProcess.pid),
        process,
        type: "orphan" as const,
      };
    });
}

function isGhostexOwnedResourceProcess(process: ResourceProcess): boolean {
  const command = process.command;
  /**
   * CDXC:TitlebarResources 2026-05-28-21:04:
   * Orphaned / Detached resources are still part of the app's CPU/RAM total, so
   * command-name matches are not enough. Only include ungrouped agent-looking
   * root processes when their command proves Ghostex ownership, then walk only
   * their descendants. External Codex, DevTools, Chrome extension, and
   * computer-use helpers from other terminals must stay out of the Resources
   * dropdown and app resource calculation.
   */
  return (
    /\/(?:Applications\/)?Ghostex(?:-dev)?\.app\b/i.test(command) ||
    /\bghostexHost\b/i.test(command) ||
    /\/\.ghostex(?:-dev)?\//i.test(command) ||
    /\bGHOSTEX_[A-Z0-9_]+=/.test(command) ||
    /\/Resources\/Web\/bin\/zmx\b/.test(command)
  );
}

function isGhostexBrowserProcess(process: ResourceProcess): boolean {
  const command = process.command;
  const isBrowserHelper = /Chromium Embedded Framework|--type=(renderer|gpu-process|utility)\b/.test(command);
  if (!isBrowserHelper) {
    return false;
  }
  return (
    /\/Contents\/Frameworks\/[^/\s]*ghostex[^/\s]* Helper/i.test(command) ||
    /--main-bundle-path=\S*\/ghostex(?:-dev)?\.app\b/i.test(command) ||
    /--user-data-dir=\S*\/\.ghostex\/cef\b/.test(command)
  );
}

function isAgentRuntimeProcess(process: ResourceProcess): boolean {
  return /\b(zmx|codex|code-server|computer-use|chrome-devtools-mcp|devtools)\b/i.test(process.command);
}

function browserProcessClientId(process: ResourceProcess): string | undefined {
  return /--(?:renderer-)?client-id=(\d+)/.exec(process.command)?.[1];
}

function browserTabSessionId(tab: TitlebarBrowserTabResource): string | undefined {
  if (tab.sessionId?.trim()) {
    return tab.sessionId.trim();
  }
  const match = /^browser:(?<sessionId>.+)$/u.exec(tab.id);
  return match?.groups?.sessionId;
}

function browserTabProjectId(tab: TitlebarBrowserTabResource): string | undefined {
  if (tab.projectId?.trim()) {
    return tab.projectId.trim();
  }
  const match = /^project-editor:(?<projectId>.+):[^:]+$/u.exec(tab.id);
  if (!match?.groups?.projectId) {
    return undefined;
  }
  try {
    return decodeURIComponent(match.groups.projectId);
  } catch {
    return undefined;
  }
}

function getBrowserProcessDisplayName(process: ResourceProcess): string {
  const clientId = browserProcessClientId(process);
  if (clientId) {
    return `Browser renderer client ${clientId}`;
  }
  if (process.command.includes("--type=gpu-process")) {
    return "Browser GPU";
  }
  if (process.command.includes("--type=utility")) {
    return getBrowserUtilityProcessDisplayName(process);
  }
  return "Browser renderer";
}

function getBrowserUtilityProcessDisplayName(process: ResourceProcess): string {
  const subtype = /--utility-sub-type=([^\s]+)/.exec(process.command)?.[1];
  if (subtype?.includes("NetworkService")) {
    return "Browser network service";
  }
  if (subtype?.includes("StorageService")) {
    return "Browser storage service";
  }
  if (subtype?.includes("AudioService")) {
    return "Browser audio service";
  }
  if (subtype?.includes("VideoCaptureService")) {
    return "Browser video capture service";
  }
  return "Browser utility";
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

function createInactiveTerminalSleepSessionIds(resourceGroups: TitlebarResourceGroup[]): string[] {
  /**
   * CDXC:TitlebarResources 2026-05-16-19:53:
   * The dropdown sleep shortcut is intentionally conservative: only awake,
   * idle agent terminal sessions older than seven minutes are eligible. Working
   * and attention sessions must stay awake because those states indicate active
   * output or a user-visible response waiting for review.
   *
   * CDXC:TitlebarResources 2026-05-26-17:16:
   * Sleep Inactive should sleep every awake idle terminal represented in the
   * Resources dropdown, not only old agent-detected rows. Keep working,
   * attention, and already sleeping sessions awake, but do not require agent
   * metadata or a seven-minute age gate.
   */
  return resourceGroups.flatMap((group) =>
    group.sessions
      .filter((session) => {
        return !(
          session.sessionKind !== "terminal" ||
          session.isSleeping === true ||
          session.activity === "working" ||
          session.activity === "attention"
        );
      })
      .map((session) =>
        session.projectId
          ? createCombinedProjectSessionId(session.projectId, session.sessionId)
          : session.sessionId,
      ),
  );
}

function uniqueResourceBundles(bundles: ResourceProcessBundle[]): ResourceProcessBundle[] {
  const seen = new Set<string>();
  return bundles.filter((bundle) => {
    if (seen.has(bundle.key)) {
      return false;
    }
    seen.add(bundle.key);
    return true;
  });
}

function resourceBundleSidebarSessionIds(bundle: ResourceProcessBundle): string[] {
  const session = bundle.session;
  if (session) {
    return [
      session.projectId
        ? createCombinedProjectSessionId(session.projectId, session.sessionId)
        : session.sessionId,
    ];
  }
  const browserSessionId = bundle.browserTab ? browserTabSessionId(bundle.browserTab) : undefined;
  if (!browserSessionId) {
    return [];
  }
  return [
    bundle.browserTab?.projectId
      ? createCombinedProjectSessionId(bundle.browserTab.projectId, browserSessionId)
      : browserSessionId,
  ];
}

function resourceBundleProjectEditorIds(bundle: ResourceProcessBundle): string[] {
  if (bundle.type === "code") {
    const match = /^code:(?<groupId>.+)$/u.exec(bundle.key);
    const projectId = match?.groups?.groupId ? parseCombinedProjectGroupId(match.groups.groupId) : undefined;
    return projectId ? [projectId] : [];
  }
  const projectId = bundle.browserTab ? browserTabProjectId(bundle.browserTab) : undefined;
  return projectId ? [projectId] : [];
}

function sortResourceBundlesForDisplay(
  bundles: ResourceProcessBundle[],
  quittingKeys: Set<string>,
): ResourceProcessBundle[] {
  return [...bundles].sort((left, right) => {
    const leftQuitting = quittingKeys.has(left.key);
    const rightQuitting = quittingKeys.has(right.key);
    return leftQuitting === rightQuitting ? 0 : leftQuitting ? 1 : -1;
  });
}

function formatWholePercent(value: number): string {
  return `${Math.trunc(Math.max(0, value))}%`;
}

function formatWholeMemory(value: number): string {
  return value >= 1024
    ? `${Math.trunc(value / 1024)} GB`
    : `${Math.trunc(Math.max(0, value))} MB`;
}

export function GhostexTitlebarHost() {
  return <App />;
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
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const [keepAwakeMenuOpen, setKeepAwakeMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [openInMenuOpen, setOpenInMenuOpen] = useState(false);
  const [resourcesMenuOpen, setResourcesMenuOpen] = useState(false);
  const titlebarOverlayOpen =
    actionsMenuOpen ||
    gitMenuOpen ||
    keepAwakeMenuOpen ||
    modeMenuOpen ||
    openInMenuOpen ||
    resourcesMenuOpen;
  const [keepAwakeRuntime, setKeepAwakeRuntime] = useState<KeepAwakeRuntimeState | undefined>(
    () => readStoredKeepAwakeRuntime(),
  );
  const [resourceProcesses, setResourceProcesses] = useState<ResourceProcess[]>([]);
  const [collapseResourcesOnFirstOpen, setCollapseResourcesOnFirstOpen] = useState(
    () => localStorage.getItem(RESOURCES_MENU_FIRST_OPEN_STORAGE_KEY) !== "seen",
  );
  const [collapsedResourceKeys, setCollapsedResourceKeys] = useState<Set<string>>(() => {
    /**
     * CDXC:TitlebarResources 2026-05-21-16:51:
     * Orphaned / Detached resources are diagnostic spillover, so keep that
     * section collapsed by default while preserving the normal user toggle.
     */
    return new Set(["orphaned"]);
  });
  const [quittingResourceKeys, setQuittingResourceKeys] = useState<Set<string>>(() => new Set());
  const [optimisticMode, setOptimisticMode] = useState<TitlebarMode>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastCompanionHitRegionSignatureRef = useRef("");
  const resourcesFirstOpenActiveRef = useRef(false);
  const resourcesFirstOpenSeededRef = useRef(false);
  const activeMode = optimisticMode ?? projectState.activeMode;
  const resourceViews = useMemo(
    () => createResourceGroupViews(projectState.browserTabs, projectState.resourceGroups, resourceProcesses),
    [projectState.browserTabs, projectState.resourceGroups, resourceProcesses],
  );
  const inactiveTerminalSleepSessionIds = useMemo(
    () => createInactiveTerminalSleepSessionIds(projectState.resourceGroups),
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

  useEffect(() => {
    const compactModeMedia = window.matchMedia("(max-width: 1049px)");
    const closeModeMenuOutsideCompactWidth = () => {
      /**
       * CDXC:ModeSwitcher 2026-05-28-10:38:
       * The compact mode picker exists only below 1050px. Close its portaled
       * menu when the window grows back to the full segmented-control layout so
       * an orphaned dropdown cannot remain open after the trigger is hidden.
       */
      if (!compactModeMedia.matches) {
        setModeMenuOpen(false);
      }
    };
    closeModeMenuOutsideCompactWidth();
    compactModeMedia.addEventListener("change", closeModeMenuOutsideCompactWidth);
    return () => {
      compactModeMedia.removeEventListener("change", closeModeMenuOutsideCompactWidth);
    };
  }, []);

  useEffect(() => {
    const narrowTitlebarMedia = window.matchMedia("(max-width: 619.98px)");
    const closeMenusHiddenAtNarrowWidth = () => {
      /**
       * CDXC:ReactTitlebar 2026-05-29-16:05:
       * App widths below 620px hide the top-right Resources and Keep Awake
       * controls, so their portaled menus must close at the same breakpoint
       * instead of remaining open after their triggers leave the titlebar.
       */
      if (narrowTitlebarMedia.matches) {
        setKeepAwakeMenuOpen(false);
        setResourcesMenuOpen(false);
      }
    };
    closeMenusHiddenAtNarrowWidth();
    narrowTitlebarMedia.addEventListener("change", closeMenusHiddenAtNarrowWidth);
    return () => {
      narrowTitlebarMedia.removeEventListener("change", closeMenusHiddenAtNarrowWidth);
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
  const visibleActions = useMemo(
    () => projectState.sidebarActions.commands,
    [projectState.sidebarActions.commands],
  );
  const activeAction =
    visibleActions.find((command) => command.commandId === selectedActionCommandId) ??
    visibleActions[0];
  const gitPrimaryAction = useMemo(
    () => resolveSidebarGitPrimaryActionState(projectState.git),
    [projectState.git],
  );
  const gitPrimaryLabel = titlebarPrimaryGitActionLabel(gitPrimaryAction.label);
  const gitPrimaryCompactLabel = compactTitlebarPrimaryGitActionLabel(gitPrimaryAction.label);
  const shouldCompactGitPrimaryLabel = gitPrimaryCompactLabel !== gitPrimaryLabel;
  const gitMenuItems = useMemo(
    () => buildSidebarGitMenuItems(projectState.git),
    [projectState.git],
  );
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
    const companionRestoreButton = document.querySelector<HTMLElement>(
      ".titlebar-companion-restore-button",
    );
    if (companionRestoreButton && projectState.projectEditorCompanionPaneHidden) {
      /*
       * CDXC:ProjectEditorCompanion 2026-05-27-08:42:
       * Repros showed the restore button sometimes appeared to ignore clicks,
       * but native logs only showed blank titlebar hits. Log the measured React
       * hit rect when it changes so missed AppKit clicks can be compared to the
       * actual DOM button geometry without logging every pointer event.
       */
      const rect = companionRestoreButton.getBoundingClientRect();
      const signature = [
        activeMode,
        projectState.editorIsOpen ? "open" : "closed",
        projectState.editorIsSleeping ? "sleeping" : "awake",
        projectState.projectId,
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height),
        titlebarOverlayOpen ? "overlay" : "plain",
      ].join("|");
      if (signature !== lastCompanionHitRegionSignatureRef.current) {
        lastCompanionHitRegionSignatureRef.current = signature;
        appendTitlebarCodeLagDebugLog(
          projectState.debuggingMode,
          "titlebarCompanionRestore.hitRegionMeasured",
          {
            activeMode,
            editorIsOpen: projectState.editorIsOpen,
            editorIsSleeping: projectState.editorIsSleeping,
            projectEditorCompanionPaneHidden: projectState.projectEditorCompanionPaneHidden,
            projectId: projectState.projectId,
            rect: {
              height: rect.height,
              width: rect.width,
              x: rect.x,
              y: rect.y,
            },
            titlebarOverlayOpen,
          },
        );
      }
    }
    postNative({
      overlayOpen: titlebarOverlayOpen,
      regions,
      type: "setReactTitlebarHitRegions",
    });
  }, [
    activeMode,
    projectState.editorIsOpen,
    projectState.editorIsSleeping,
    projectState.projectEditorCompanionPaneHidden,
    projectState.projectId,
    titlebarOverlayOpen,
  ]);

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
    /**
     * CDXC:SessionFocusMode 2026-05-26-22:47:
     * The Exit focus button is conditional titlebar chrome. Republish native
     * hit regions whenever focus mode enters or exits so AppKit routes clicks
     * to the new button instead of treating its frame as draggable titlebar.
     */
    return publishSettledHitRegions();
  }, [
    activeTarget?.id,
    activeAction?.commandId,
    actionsMenuOpen,
    gitMenuOpen,
    keepAwakeMenuOpen,
    keepAwakeRuntime?.pid,
    modeMenuOpen,
    openInMenuOpen,
    resourcesMenuOpen,
    resourceProcesses.length,
    projectState.projectEditorCompanionPaneHidden,
    projectState.projectIconDataUrl,
    projectState.isFocusModeActive,
    projectState.projectName,
    publishSettledHitRegions,
  ]);

  useEffect(() => {
    window.addEventListener("resize", publishHitRegions);
    return () => window.removeEventListener("resize", publishHitRegions);
  }, [publishHitRegions]);

  useEffect(() => {
    return () => {
      /**
       * CDXC:ReactTitlebar 2026-05-25-10:09:
       * Native workspace shielding must clear when the titlebar host unmounts
       * or reloads. Publish an explicit closed overlay state instead of making
       * Swift infer it from stale DOM hit-region geometry.
       */
      postNative({
        overlayOpen: false,
        regions: [],
        type: "setReactTitlebarHitRegions",
      });
    };
  }, []);

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
        setGitMenuOpen(false);
        setKeepAwakeMenuOpen(false);
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
          git: state.git ?? current.git,
          keepAwake: state.keepAwake ?? current.keepAwake,
          browserTabs: state.browserTabs ?? current.browserTabs,
          projectEditorCompanionPaneHidden:
            state.projectEditorCompanionPaneHidden ?? current.projectEditorCompanionPaneHidden,
          petOverlayEnabled: state.petOverlayEnabled ?? current.petOverlayEnabled,
          resourceGroups: state.resourceGroups ?? current.resourceGroups,
          sidebarActions: state.sidebarActions ?? current.sidebarActions,
          sessionPersistenceProvider:
            state.sessionPersistenceProvider ?? current.sessionPersistenceProvider,
          workspaceOpenTargets: state.workspaceOpenTargets ?? current.workspaceOpenTargets,
          isFocusModeActive: state.isFocusModeActive ?? current.isFocusModeActive,
          updateAvailable: state.updateAvailable ?? current.updateAvailable,
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
      setResourceProcesses(await readResourceProcesses());
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

  useEffect(() => {
    if (!resourcesMenuOpen || !collapseResourcesOnFirstOpen) {
      return;
    }
    /**
     * CDXC:TitlebarResources 2026-05-28-10:11:
     * The Resources menu should open with every resource section collapsed the
     * first time this user ever opens it. Persist only the seen marker so later
     * openings keep the normal interactive collapse behavior without carrying a
     * stale snapshot of dynamic process rows.
     */
    resourcesFirstOpenActiveRef.current = true;
    localStorage.setItem(RESOURCES_MENU_FIRST_OPEN_STORAGE_KEY, "seen");
    if (resourcesFirstOpenSeededRef.current) {
      return;
    }
    const firstOpenCollapsedKeys = createFirstOpenCollapsedResourceKeys(resourceViews);
    if (firstOpenCollapsedKeys.length === 0) {
      return;
    }
    resourcesFirstOpenSeededRef.current = true;
    setCollapsedResourceKeys((current) => {
      const next = new Set(current);
      let changed = false;
      for (const key of firstOpenCollapsedKeys) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [collapseResourcesOnFirstOpen, resourceViews, resourcesMenuOpen]);

  useEffect(() => {
    if (resourcesMenuOpen || !resourcesFirstOpenActiveRef.current) {
      return;
    }
    resourcesFirstOpenActiveRef.current = false;
    setCollapseResourcesOnFirstOpen(false);
  }, [resourcesMenuOpen]);

  const openTarget = (target: ResolvedOpenTarget | undefined) => {
    if (!target || !projectState.projectPath) {
      return;
    }
    setSelectedTargetId(target.id);
    localStorage.setItem(LAST_OPEN_TARGET_STORAGE_KEY, target.id);
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

  const openSidebarActionEditor = (command: SidebarCommandButton) => {
    window.webkit?.messageHandlers?.ghostexAppModalHost?.postMessage({
      commandDraft: createTitlebarCommandConfigDraft(command),
      modal: "commandConfig",
      type: "open",
    });
  };

  const runSidebarAction = (command: SidebarCommandButton | undefined) => {
    if (!command) {
      appendTitlebarActionCrashDebugLog("nativeSidebar.actionCrashTrace.titlebarMissingAction", {
        projectId: projectState.projectId,
        projectPath: projectState.projectPath,
      });
      return;
    }
    if (!isSidebarCommandConfigured(command)) {
      openSidebarActionEditor(command);
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

  const runGitAction = (action: SidebarGitAction) => {
    setGitMenuOpen(false);
    postNative({ action, type: "runSidebarGitActionFromTitlebar" });
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

  const setResourceSectionsCollapsed = (keys: string[], collapsed: boolean) => {
    if (keys.length === 0) {
      return;
    }
    setCollapsedResourceKeys((current) => {
      const next = new Set(current);
      let changed = false;
      for (const key of keys) {
        const hasKey = next.has(key);
        if (collapsed && !hasKey) {
          next.add(key);
          changed = true;
        } else if (!collapsed && hasKey) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  };

  const focusResourceSession = (sessionId: string) => {
    /**
     * CDXC:TitlebarResources 2026-05-28-10:39:
     * Resources rows need a direct Focus action so users can jump from process
     * diagnostics to the owning session without using the sidebar. Close the
     * dropdown after forwarding the durable combined session id to the sidebar
     * owner, which already handles cross-project and sleeping-session focus.
     */
    postNative({ sessionId, type: "focusResourceSessionFromTitlebar" });
    setResourcesMenuOpen(false);
  };

  const quitResourceBundles = (bundles: ResourceProcessBundle[]) => {
    const uniqueBundles = uniqueResourceBundles(bundles);
    if (uniqueBundles.length === 0) {
      return;
    }
    /**
     * CDXC:TitlebarResources 2026-05-21-16:38:
     * Any Quit action in the resource manager should immediately mark the row
     * as closing and move it below active resources. Sidebar-owned terminal
     * sessions sleep through sidebar state so their cards remain resumable;
     * non-terminal panes and detached process bundles still use their resource
     * cleanup paths.
     *
     * CDXC:TitlebarResources 2026-05-23-10:46:
     * The resource manager must not rely on sidebar sleep as the only kill
     * mechanism. It also terminates the PIDs currently shown in the dropdown so
     * row Quit, group Quit, and Sleep All actually release RAM while the
     * sidebar keeps durable terminal sessions.
     */
    setQuittingResourceKeys((current) => {
      const next = new Set(current);
      uniqueBundles.forEach((bundle) => next.add(bundle.key));
      return next;
    });
    const sessionIds = uniqueBundles.flatMap(resourceBundleSidebarSessionIds);
    const projectIds = uniqueBundles.flatMap(resourceBundleProjectEditorIds);
    if (sessionIds.length > 0 || projectIds.length > 0) {
      postNative({
        projectIds: Array.from(new Set(projectIds)),
        sessionIds: Array.from(new Set(sessionIds)),
        type: "quitResourcesFromTitlebar",
      });
    }
    const processByPid = new Map(resourceProcesses.map((process) => [process.pid, process]));
    const processes = Array.from(
      new Map(
        uniqueBundles
          .flatMap((bundle) => bundle.pids)
          .map((pid) => processByPid.get(pid))
          .filter((process): process is ResourceProcess => process !== undefined)
          .map((process) => [process.pid, process]),
      ).values(),
    );
    if (processes.length > 0) {
      void terminateResourceProcesses(processes).finally(() => {
        window.setTimeout(() => {
          void refreshResources();
        }, 1_800);
      });
      return;
    }
    window.setTimeout(() => {
      void refreshResources();
    }, 250);
  };

  const sleepInactiveTerminalSessions = () => {
    if (inactiveTerminalSleepSessionIds.length === 0) {
      return;
    }
    postNative({
      sessionIds: inactiveTerminalSleepSessionIds,
      type: "sleepInactiveSessionsFromTitlebar",
    });
  };

  const stopKeepAwake = useCallback(async () => {
    const runtime = keepAwakeRuntime;
    setKeepAwakeRuntime(undefined);
    localStorage.removeItem(KEEP_AWAKE_RUNTIME_STORAGE_KEY);
    if (!runtime) {
      return;
    }
    try {
      await runNativeProcess("/bin/kill", [String(runtime.pid)]);
    } catch (error) {
      console.warn("Failed to stop keep-awake process", error);
    }
  }, [keepAwakeRuntime]);

  const startKeepAwake = useCallback(
    async (durationMinutes: KeepAwakeDurationMinutes = projectState.keepAwake.defaultDurationMinutes) => {
      if (keepAwakeRuntime) {
        await stopKeepAwake();
      }
      /**
       * CDXC:TitlebarKeepAwake 2026-05-28-19:28:
       * The normal keep-awake button should prevent idle sleep and AC system sleep.
       * Lid-close sleep is controlled by the separate Settings toggle because macOS does not treat it as a regular caffeinate idle-sleep assertion.
       */
      const flags = projectState.keepAwake.allowDisplaySleep ? "-is" : "-dis";
      const timeout = durationMinutes > 0 ? ` -t ${durationMinutes * 60}` : "";
      const result = await runNativeProcess("/bin/sh", [
        "-lc",
        `(/usr/bin/nohup /usr/bin/caffeinate ${flags}${timeout} >/dev/null 2>&1 & echo $!)`,
      ]);
      const pid = Number(result.stdout.trim().split(/\s+/u)[0]);
      if (result.exitCode !== 0 || !Number.isFinite(pid) || pid <= 0) {
        console.warn("Failed to start keep-awake process", result.stderr || result.stdout);
        return;
      }
      const nextRuntime: KeepAwakeRuntimeState = {
        durationMinutes,
        fireAtMs: durationMinutes > 0 ? Date.now() + durationMinutes * 60_000 : undefined,
        pid,
        startedAtMs: Date.now(),
      };
      setKeepAwakeRuntime(nextRuntime);
      localStorage.setItem(KEEP_AWAKE_RUNTIME_STORAGE_KEY, JSON.stringify(nextRuntime));
    },
    [keepAwakeRuntime, projectState.keepAwake.allowDisplaySleep, projectState.keepAwake.defaultDurationMinutes, stopKeepAwake],
  );

  const toggleKeepAwake = () => {
    if (keepAwakeRuntime) {
      void stopKeepAwake();
      return;
    }
    void startKeepAwake();
  };

  const openPowerSettings = () => {
    window.webkit?.messageHandlers?.ghostexAppModalHost?.postMessage({
      initialSection: "power",
      modal: "settings",
      type: "open",
    });
  };

  useEffect(() => {
    if (!projectState.keepAwake.hideTitlebarControl && !keepAwakeMenuOpen) {
      return;
    }
    if (projectState.keepAwake.hideTitlebarControl && keepAwakeMenuOpen) {
      setKeepAwakeMenuOpen(false);
    }
  }, [keepAwakeMenuOpen, projectState.keepAwake.hideTitlebarControl]);

  useEffect(() => {
    if (!projectState.keepAwake.activateOnLaunch || keepAwakeRuntime) {
      return;
    }
    void startKeepAwake();
  }, [keepAwakeRuntime, projectState.keepAwake.activateOnLaunch, startKeepAwake]);

  useEffect(() => {
    const desired = Boolean(keepAwakeRuntime && projectState.keepAwake.preventLidSleep);
    const ghostexEnabledLidSleepPrevention =
      localStorage.getItem(KEEP_AWAKE_LID_SLEEP_STORAGE_KEY) === "enabled";
    if (!desired && !ghostexEnabledLidSleepPrevention) {
      return;
    }
    let cancelled = false;
    const needsPolicyChange = desired !== ghostexEnabledLidSleepPrevention;
    const applyPolicy = async () => {
      const applied = await applyKeepAwakeLidSleepPrevention(desired, {
        installIfNeeded: desired && needsPolicyChange,
      });
      if (!applied || cancelled) {
        return;
      }
      localStorage.setItem(KEEP_AWAKE_LID_SLEEP_STORAGE_KEY, desired ? "enabled" : "disabled");
    };
    if (needsPolicyChange) {
      void applyPolicy();
    }
    let interval: number | undefined;
    if (desired) {
      interval = window.setInterval(() => {
        void applyKeepAwakeLidSleepPrevention(true, { installIfNeeded: false }).then((applied) => {
          if (applied && !cancelled) {
            localStorage.setItem(KEEP_AWAKE_LID_SLEEP_STORAGE_KEY, "enabled");
          }
        });
      }, 10_000);
    }
    return () => {
      cancelled = true;
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, [keepAwakeRuntime, projectState.keepAwake.preventLidSleep]);

  useEffect(() => {
    if (!keepAwakeRuntime) {
      return;
    }
    const checkRuntime = async () => {
      if (keepAwakeRuntime.fireAtMs !== undefined && Date.now() >= keepAwakeRuntime.fireAtMs) {
        await stopKeepAwake();
        return;
      }
      const pidCheck = await runNativeProcess("/bin/kill", ["-0", String(keepAwakeRuntime.pid)]);
      if (pidCheck.exitCode !== 0) {
        setKeepAwakeRuntime(undefined);
        localStorage.removeItem(KEEP_AWAKE_RUNTIME_STORAGE_KEY);
      }
    };
    void checkRuntime();
    const interval = window.setInterval(() => {
      void checkRuntime();
    }, KEEP_AWAKE_POWER_CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [keepAwakeRuntime, stopKeepAwake]);

  useEffect(() => {
    if (
      !keepAwakeRuntime &&
      !projectState.keepAwake.activateOnExternalDisplay &&
      !projectState.keepAwake.deactivateBelowBatteryThreshold &&
      !projectState.keepAwake.deactivateOnLowPowerMode
    ) {
      return;
    }
    const checkPowerRules = async () => {
      const snapshot = await readKeepAwakePowerSnapshot();
      if (!snapshot) {
        return;
      }
      if (
        keepAwakeRuntime &&
        projectState.keepAwake.deactivateBelowBatteryThreshold &&
        snapshot.batteryPercent !== undefined &&
        snapshot.batteryPercent <= projectState.keepAwake.batteryThresholdPercent
      ) {
        await stopKeepAwake();
        return;
      }
      if (
        keepAwakeRuntime &&
        projectState.keepAwake.deactivateOnLowPowerMode &&
        snapshot.lowPowerMode === true
      ) {
        await stopKeepAwake();
        return;
      }
      if (
        !keepAwakeRuntime &&
        projectState.keepAwake.activateOnExternalDisplay &&
        snapshot.externalDisplayConnected
      ) {
        await startKeepAwake();
      }
    };
    void checkPowerRules();
    const interval = window.setInterval(() => {
      void checkPowerRules();
    }, KEEP_AWAKE_POWER_CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [
    keepAwakeRuntime,
    projectState.keepAwake.activateOnExternalDisplay,
    projectState.keepAwake.batteryThresholdPercent,
    projectState.keepAwake.deactivateBelowBatteryThreshold,
    projectState.keepAwake.deactivateOnLowPowerMode,
    startKeepAwake,
    stopKeepAwake,
  ]);

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

  const showProjectEditorCompanion = () => {
    appendTitlebarCodeLagDebugLog(projectState.debuggingMode, "titlebarCompanionRestore.dispatch", {
      activeMode,
      editorIsOpen: projectState.editorIsOpen,
      projectEditorCompanionPaneHidden: projectState.projectEditorCompanionPaneHidden,
      projectId: projectState.projectId,
      source: "click",
    });
    postNative({ type: "showProjectEditorCompanionFromTitlebar" });
  };
  const showUpdateDialog = () => {
    postNative({ type: "showUpdateDialogFromTitlebar" });
  };

  const shouldShowCompanionRestoreButton =
    activeMode !== "agents" &&
    projectState.editorIsOpen &&
    !projectState.editorIsSleeping &&
    projectState.projectEditorCompanionPaneHidden;
  const titlebarModes = [
    {
      label: "Agents",
      onSelect: openAgentsMode,
      value: "agents" as const,
    },
    {
      /**
       * CDXC:ReactTitlebar 2026-05-15-13:58:
       * The titlebar Code segment always renders as "Code". Git
       * diff stats moved to the sidebar project row, and editor
       * startup errors belong in the editor page instead of this
       * segmented-control button.
       */
      label: "Code",
      onSelect: openCodeMode,
      value: "code" as const,
    },
    {
      label: "Git",
      onSelect: openGitMode,
      value: "git" as const,
    },
    {
      /**
       * CDXC:ProjectMode 2026-05-15-15:35:
       * The existing tasks-backed mode is labeled Project because
       * its coming-soon surface is a broader project workspace for
       * automations, todos, docs, and more.
       */
      label: "Project",
      onSelect: openTasksMode,
      value: "tasks" as const,
    },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="dark" ref={rootRef} style={styles.shell}>
        <div style={styles.titlebar}>
          <div style={styles.projectSlot}>
            {projectState.updateAvailable ? (
              <Button
                aria-label="Download update"
                className="titlebar-session-button titlebar-update-button"
                data-titlebar-hit-region
                data-tooltip="Download update"
                onClick={showUpdateDialog}
                type="button"
                variant="ghost"
              >
                {/*
                 * CDXC:AutoUpdate 2026-05-28-14:19:
                 * Available app updates should be subtle titlebar chrome,
                 * not a launch-time modal. Keep this button dim beside the
                 * project identity; clicking it is the user's explicit
                 * handoff into Sparkle's standard update dialog.
                 */}
                <IconDownload aria-hidden="true" size={15} stroke={1.8} />
              </Button>
            ) : null}
            <div className="titlebar-project-title">
              {/*
               * CDXC:ReactTitlebar 2026-05-17-02:29:
               * The project name is passive titlebar identity text. Do not use
               * it as a copy-path button and do not attach a tooltip; project
               * path actions should live in explicit menus instead of hidden
               * titlebar hover behavior.
               */}
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
            <TitlebarModeDropdown
              activeMode={activeMode}
              modes={titlebarModes}
              onOpenChange={setModeMenuOpen}
              open={modeMenuOpen}
            />
          </div>
          <div style={styles.centerSlot}>
            {shouldShowCompanionRestoreButton ? (
              <div style={styles.companionRestoreSlot}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label="Show Companion Sidepane"
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
                  <TooltipContent>Show Companion Sidepane</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
            <TitlebarModeSwitcher
              activeMode={activeMode}
              modes={titlebarModes}
            />
          </div>
          <div style={styles.rightSlot}>
            {projectState.isFocusModeActive ? (
              <Button
                aria-label="Exit focus mode"
                className="titlebar-exit-focus-button"
                data-titlebar-hit-region
                onClick={() => postNative({ type: "exitFocusModeFromTitlebar" })}
                size="sm"
                type="button"
                variant="outline"
              >
                Exit focus
              </Button>
            ) : null}
            {/*
             * CDXC:ReactTitlebar 2026-05-17-02:29:
             * Top-right titlebar controls should not show hover tooltips.
             * Keep accessible labels on the buttons and visible labels inside
             * dropdown menus, while avoiding extra titlebar hover chrome.
             */}
            {!projectState.keepAwake.hideTitlebarControl ? (
              <DropdownMenu onOpenChange={setKeepAwakeMenuOpen} open={keepAwakeMenuOpen}>
                <ButtonGroup className="titlebar-open-group titlebar-keep-awake-group" data-titlebar-hit-region>
                  <Button
                    aria-label={keepAwakeRuntime ? "Allow Mac sleep" : "Keep Mac awake"}
                    className="titlebar-session-button titlebar-open-main-button"
                    data-active={String(Boolean(keepAwakeRuntime))}
                    onClick={toggleKeepAwake}
                    type="button"
                    variant={keepAwakeRuntime ? "outline" : "ghost"}
                  >
                    {/*
                     * CDXC:TitlebarKeepAwake 2026-05-27-07:32:
                     * Keep-awake titlebar chrome must be icon-only so it cannot
                     * clip in the narrow right-side slot. Coffee means Ghostex is
                     * keeping the Mac awake; moon means clicking will allow sleep.
                     */}
                    {keepAwakeRuntime ? (
                      <IconCoffee aria-hidden="true" size={14} stroke={1.8} />
                    ) : (
                      <IconMoon aria-hidden="true" size={14} stroke={1.8} />
                    )}
                  </Button>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="Keep awake menu"
                      className="titlebar-session-button titlebar-open-chevron-button"
                      type="button"
                      variant="ghost"
                    >
                      <IconChevronDown aria-hidden="true" size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                </ButtonGroup>
                <DropdownMenuContent
                  align="center"
                  alignOffset={TITLEBAR_SPLIT_MENU_CENTER_OFFSET}
                  className="titlebar-open-menu min-w-[220px] rounded-lg border-border/80 !bg-[#0e0e0e] p-1 text-[13px] text-foreground shadow-2xl"
                  data-titlebar-hit-region
                  sideOffset={6}
                  style={{ backgroundColor: "#0e0e0e" }}
                >
                  {KEEP_AWAKE_DURATION_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      className="titlebar-open-menu-item"
                      key={option.value}
                      onClick={() => {
                        void startKeepAwake(option.value);
                      }}
                    >
                      <IconCoffee aria-hidden="true" size={14} stroke={1.8} />
                      <span className="min-w-0 flex-1 truncate">Keep awake {option.label.toLowerCase()}</span>
                      {keepAwakeRuntime?.durationMinutes === option.value ? (
                        <IconCheck aria-hidden="true" className="ml-2 size-4 opacity-75" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  {keepAwakeRuntime ? (
                    <DropdownMenuItem className="titlebar-open-menu-item" onClick={() => void stopKeepAwake()}>
                      <IconMoon aria-hidden="true" size={14} stroke={1.8} />
                      <span>Allow sleep now</span>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator className="bg-border/70" />
                  <DropdownMenuItem
                    className="titlebar-open-menu-item"
                    onClick={openPowerSettings}
                  >
                    <IconSettings aria-hidden="true" size={16} />
                    <span>Power Settings</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <DropdownMenu onOpenChange={setResourcesMenuOpen} open={resourcesMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Ghostex resources"
                  className="titlebar-session-button titlebar-resource-button"
                  data-titlebar-hit-region
                  type="button"
                  variant="ghost"
                >
                  {/*
                   * CDXC:TitlebarResources 2026-05-17-02:03:
                   * The Resources button is the first right-side titlebar
                   * control after moving the pet wake/sleep toggle into the
                   * sidebar overflow menu.
                   *
                   * CDXC:TitlebarKeepAwake 2026-05-27-07:32:
                   * The keep-awake button now owns coffee/moon state icons, so
                   * Resources uses the old desktop glyph as the stable manager
                   * icon requested for this titlebar control swap.
                   */}
                  <IconDeviceDesktop aria-hidden="true" size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="titlebar-open-menu titlebar-resources-menu rounded-lg border-border/80 !bg-[#0e0e0e] p-0 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#0e0e0e" }}
              >
                <TitlebarResourcesMenu
                  browserBundles={resourceViews.browserBundles}
                  collapsedKeys={collapsedResourceKeys}
                  groupViews={resourceViews.groupViews}
                  inactiveTerminalSleepSessionCount={inactiveTerminalSleepSessionIds.length}
                  onFocusSession={focusResourceSession}
                  onQuit={quitResourceBundles}
                  onSetSectionsCollapsed={setResourceSectionsCollapsed}
                  onSleepInactiveSessions={sleepInactiveTerminalSessions}
                  onToggle={toggleResourceCollapse}
                  orphanBundles={resourceViews.orphanBundles}
                  quittingKeys={quittingResourceKeys}
                  sessionPersistenceProvider={projectState.sessionPersistenceProvider}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu onOpenChange={setGitMenuOpen} open={gitMenuOpen}>
              <ButtonGroup className="titlebar-open-group titlebar-git-group" data-titlebar-hit-region>
                <Button
                  aria-label={gitPrimaryAction.disabledReason ?? gitPrimaryLabel}
                  className="titlebar-session-button titlebar-open-main-button titlebar-git-main-button"
                  disabled={gitPrimaryAction.disabled}
                  onClick={() => runGitAction(gitPrimaryAction.action)}
                  type="button"
                  variant="ghost"
                >
                  {/*
                   * CDXC:TitlebarGit 2026-05-24-17:41:
                   * The titlebar Git split button mirrors t3code's commit/push control and sits immediately after Resources so commit, push, and PR actions are reachable from top chrome without opening the sidebar Git row.
                   */
                  projectState.git.isBusy ? (
                    <IconLoader2 aria-hidden="true" className="titlebar-git-spinner" size={14} />
                  ) : (
                    getTitlebarGitActionIcon(gitPrimaryAction.action)
                  )}
                  <span
                    className="titlebar-git-label titlebar-git-label-full"
                    data-compact-below-620={String(shouldCompactGitPrimaryLabel)}
                  >
                    {gitPrimaryLabel}
                  </span>
                  {gitPrimaryCompactLabel ? (
                    <span aria-hidden="true" className="titlebar-git-label titlebar-git-label-compact">
                      {gitPrimaryCompactLabel}
                    </span>
                  ) : null}
                </Button>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="Git actions menu"
                    className="titlebar-session-button titlebar-open-chevron-button"
                    type="button"
                    variant="ghost"
                  >
                    <IconChevronDown aria-hidden="true" size={14} />
                  </Button>
                </DropdownMenuTrigger>
              </ButtonGroup>
              <DropdownMenuContent
                align="center"
                alignOffset={TITLEBAR_SPLIT_MENU_CENTER_OFFSET}
                className="titlebar-open-menu titlebar-git-menu rounded-lg border-border/80 !bg-[#0e0e0e] p-1 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#0e0e0e", minWidth: 240, width: 240 }}
              >
                {gitMenuItems.map((item) => (
                  <DropdownMenuItem
                    className="titlebar-open-menu-item"
                    disabled={item.disabled}
                    key={item.action}
                    onClick={() => runGitAction(item.action)}
                  >
                    {getTitlebarGitActionIcon(item.action)}
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu onOpenChange={setActionsMenuOpen} open={actionsMenuOpen}>
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
              <DropdownMenuContent
                align="center"
                alignOffset={TITLEBAR_SPLIT_MENU_CENTER_OFFSET}
                className="titlebar-open-menu min-w-[220px] rounded-lg border-border/80 !bg-[#0e0e0e] p-1 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#0e0e0e" }}
              >
                {visibleActions.length > 0 ? (
                  visibleActions.map((command) => {
                    const actionCommandPreview = getSidebarCommandPreviewLabel(command);
                    return (
                      <DropdownMenuItem
                        className="titlebar-open-menu-item titlebar-action-menu-item"
                        key={command.commandId}
                        onClick={() => runSidebarAction(command)}
                      >
                        <span className="titlebar-action-menu-icon">{getSidebarActionIcon(command)}</span>
                        <span className="titlebar-action-menu-copy">
                          <span className="titlebar-action-menu-title">
                            {getSidebarActionLabel(command)}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="titlebar-action-command-preview"
                                data-unconfigured={String(!isSidebarCommandConfigured(command))}
                              >
                                {actionCommandPreview}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              className="titlebar-action-command-tooltip whitespace-normal text-left"
                              sideOffset={6}
                            >
                              {actionCommandPreview}
                            </TooltipContent>
                          </Tooltip>
                        </span>
                        {activeAction?.commandId === command.commandId ? (
                          <IconCheck aria-hidden="true" className="ml-2 size-4 shrink-0 opacity-75" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })
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
            <DropdownMenu onOpenChange={setOpenInMenuOpen} open={openInMenuOpen}>
              <ButtonGroup className="titlebar-open-group" data-titlebar-hit-region>
                <Button
                  aria-label={activeTarget?.label ?? "Open project"}
                  className="titlebar-session-button titlebar-open-main-button"
                  onClick={() => openTarget(activeTarget)}
                  type="button"
                  variant="ghost"
                >
                  {activeTarget ? (
                    getOpenTargetIcon(activeTarget)
                  ) : (
                    <IconFolderOpen aria-hidden="true" className="size-4 text-zinc-400" />
                  )}
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
              <DropdownMenuContent
                align="center"
                alignOffset={TITLEBAR_SPLIT_MENU_CENTER_OFFSET}
                className="titlebar-open-menu min-w-[220px] rounded-lg border-border/80 !bg-[#0e0e0e] p-1 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#0e0e0e" }}
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
    browserTabs: [],
    debuggingMode: settings.debuggingMode,
    diffStats: createDefaultSidebarProjectDiffStats(false),
    editorIsOpen: false,
    editorIsSleeping: false,
    editorStatus: "idle",
    git: createDefaultSidebarGitState(),
    keepAwake: createTitlebarKeepAwakeSettings(settings),
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
    sessionPersistenceProvider:
      settings.sessionPersistenceProvider === "off" ? undefined : settings.sessionPersistenceProvider,
    workspaceOpenTargets: {
      availability: settings.workspaceOpenTargetAvailability,
      customTargets: settings.customWorkspaceOpenTargets,
      hiddenTargetIds: settings.workspaceOpenTargetHiddenIds,
    },
    updateAvailable: false,
  };
}

function createTitlebarKeepAwakeSettings(
  settings: ReturnType<typeof normalizeghostexSettings>,
): TitlebarKeepAwakeSettings {
  return {
    activateOnExternalDisplay: settings.keepAwakeActivateOnExternalDisplay,
    activateOnLaunch: settings.keepAwakeActivateOnLaunch,
    allowDisplaySleep: settings.keepAwakeAllowDisplaySleep,
    batteryThresholdPercent: settings.keepAwakeBatteryThresholdPercent,
    deactivateBelowBatteryThreshold: settings.keepAwakeDeactivateBelowBatteryThreshold,
    deactivateOnLowPowerMode: settings.keepAwakeDeactivateOnLowPowerMode,
    deactivateOnUserSwitch: settings.keepAwakeDeactivateOnUserSwitch,
    defaultDurationMinutes: settings.keepAwakeDefaultDurationMinutes,
    hideTitlebarControl: settings.hideKeepAwakeTitlebarControl,
    preventLidSleep: settings.keepAwakePreventLidSleep,
  };
}

function readStoredKeepAwakeRuntime(): KeepAwakeRuntimeState | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEEP_AWAKE_RUNTIME_STORAGE_KEY) || "null");
    if (!isRecord(parsed)) {
      return undefined;
    }
    const pid = typeof parsed.pid === "number" ? parsed.pid : Number.NaN;
    const durationMinutes = typeof parsed.durationMinutes === "number"
      ? parsed.durationMinutes
      : Number.NaN;
    if (
      !Number.isFinite(pid) ||
      pid <= 0 ||
      !KEEP_AWAKE_DURATION_OPTIONS.some((option) => option.value === durationMinutes)
    ) {
      return undefined;
    }
    return {
      durationMinutes: durationMinutes as KeepAwakeDurationMinutes,
      fireAtMs: typeof parsed.fireAtMs === "number" ? parsed.fireAtMs : undefined,
      pid,
      startedAtMs: typeof parsed.startedAtMs === "number" ? parsed.startedAtMs : Date.now(),
    };
  } catch {
    return undefined;
  }
}

async function applyKeepAwakeLidSleepPrevention(
  enabled: boolean,
  options: { installIfNeeded?: boolean } = {},
): Promise<boolean> {
  /**
   * CDXC:TitlebarKeepAwake 2026-05-28-19:28:
   * User-requested closed-lid wakefulness requires a privileged helper because
   * `caffeinate` cannot cover MacBook lid-close sleep. The helper is installed
   * only when this setting and Keep Awake are both active. Lease refreshes never
   * request installation, so cancelling the administrator prompt does not create
   * repeated password prompts; the user can retry by starting Keep Awake again.
   */
  try {
    const result = await runNativeKeepAwakeLidSleepPrevention(enabled, {
      installIfNeeded: options.installIfNeeded,
    });
    if (result.exitCode !== 0) {
      console.warn("Failed to update lid-close sleep prevention", result.stderr || result.stdout);
      return false;
    }
  } catch (error) {
    console.warn("Failed to update lid-close sleep prevention", error);
    return false;
  }
  return true;
}

async function readKeepAwakePowerSnapshot(): Promise<
  | {
      batteryPercent?: number;
      externalDisplayConnected: boolean;
      lowPowerMode?: boolean;
    }
  | undefined
> {
  try {
    const result = await runNativeProcess("/bin/sh", [
      "-lc",
      [
        "battery=$(/usr/bin/pmset -g batt 2>/dev/null | /usr/bin/awk -F';' '/InternalBattery/ {gsub(/[^0-9]/, \"\", $1); print $1; exit}')",
        "low=$(/usr/bin/pmset -g 2>/dev/null | /usr/bin/awk '/lowpowermode/ {print $2; exit}')",
        "displays=$(/usr/sbin/system_profiler SPDisplaysDataType 2>/dev/null | /usr/bin/awk '/Resolution:/ {count++} END {print count+0}')",
        "/bin/echo \"battery=${battery:-};low=${low:-};displays=${displays:-0}\"",
      ].join("; "),
    ]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const fields = new Map(
      result.stdout
        .trim()
        .split(";")
        .map((field) => {
          const [key, value = ""] = field.split("=");
          return [key, value] as const;
        }),
    );
    const batteryPercent = Number(fields.get("battery"));
    const displays = Number(fields.get("displays"));
    return {
      batteryPercent: Number.isFinite(batteryPercent) ? batteryPercent : undefined,
      externalDisplayConnected: Number.isFinite(displays) && displays > 1,
      lowPowerMode: fields.get("low") === "1",
    };
  } catch (error) {
    console.warn("Failed to read keep-awake power state", error);
    return undefined;
  }
}

function TitlebarResourcesMenu({
  browserBundles,
  collapsedKeys,
  groupViews,
  inactiveTerminalSleepSessionCount,
  onFocusSession,
  onQuit,
  onSetSectionsCollapsed,
  onSleepInactiveSessions,
  onToggle,
  orphanBundles,
  quittingKeys,
  sessionPersistenceProvider,
}: {
  browserBundles: ResourceProcessBundle[];
  collapsedKeys: Set<string>;
  groupViews: ResourceGroupView[];
  inactiveTerminalSleepSessionCount: number;
  onFocusSession: (sessionId: string) => void;
  onQuit: (bundles: ResourceProcessBundle[]) => void;
  onSetSectionsCollapsed: (keys: string[], collapsed: boolean) => void;
  onSleepInactiveSessions: () => void;
  onToggle: (key: string) => void;
  orphanBundles: ResourceProcessBundle[];
  quittingKeys: Set<string>;
  sessionPersistenceProvider?: "tmux" | "zmx" | "zellij";
}) {
  const visibleGroupViews = groupViews.filter((view) => view.bundles.length > 0);
  const allBundles = [
    ...visibleGroupViews.flatMap((view) => view.bundles),
    ...browserBundles,
    ...orphanBundles,
  ];
  /**
   * CDXC:TitlebarResources 2026-05-23-10:52:
   * Header actions should be two matching resource controls: one for sleeping
   * only inactive terminal sessions, and one for sleeping all terminal session
   * resources without targeting the app runtime.
   *
   * CDXC:TitlebarResources 2026-05-23-10:54:
   * Every Resources action needs an explanatory shadcn tooltip because Sleep is
   * not a soft hide: it releases the session's live CPU/RAM while preserving
   * the sidebar card for quick wake/resume.
   *
   * CDXC:TitlebarResources 2026-05-25-16:53:
   * The Resources dropdown should manage user-owned work resources, not expose
   * Ghostex's own app-runtime process rows. Keep app process matching available
   * for internal PID ownership, but exclude App Runtime bundles from visible
   * sections, visible totals, and bulk resource actions.
   *
   * CDXC:TitlebarResources 2026-05-25-16:59:
   * The old yellow zmx warning duplicated the action wording and made the menu
   * noisier than the controls themselves. Remove that note and expose the bulk
   * terminal action as Sleep All only when session persistence is active through
   * tmux, zmx, or zellij.
   */
  const persistentSessionMode =
    sessionPersistenceProvider === "tmux" ||
    sessionPersistenceProvider === "zmx" ||
    sessionPersistenceProvider === "zellij";
  const sleepAllSessionBundles = visibleGroupViews
    .flatMap((view) => view.bundles)
    .filter((bundle) => bundle.type === "session" && bundle.session?.sessionKind === "terminal");
  const resourceSectionKeys = createVisibleResourceSectionKeys({
    browserBundles,
    groupViews,
    orphanBundles,
  });
  const allResourceSectionsCollapsed =
    resourceSectionKeys.length > 0 && resourceSectionKeys.every((key) => collapsedKeys.has(key));
  const nextAllSectionsCollapsed = !allResourceSectionsCollapsed;
  const ResourceBulkCollapseIcon = allResourceSectionsCollapsed
    ? IconArrowsDiagonal2
    : IconArrowsDiagonalMinimize;
  /**
   * CDXC:TitlebarResources 2026-05-24-20:58:
   * Resource action tooltips must stay compact enough for the titlebar area.
   * Keep explanatory copy short and apply the width cap inline because the
   * shared TooltipContent sets its viewport cap with inline styles.
   *
   * CDXC:TitlebarResources 2026-05-25-09:37:
   * Resource summary tooltips need the same compact width cap as action
   * tooltips so Live CPU and Live memory do not stretch across the toolbar.
   *
   * CDXC:TitlebarResources 2026-05-28-12:16:
   * The Resources header needs a compact collapse-all / expand-all control
   * beside the title.
   *
   * CDXC:TitlebarResources 2026-05-28-12:28:
   * Match the sidebar reference Projects bulk-action icons: Collapse All uses
   * the diagonal minimize glyph, and the expand-again state uses the diagonal
   * expand glyph. Do not use the project-row caret here.
   *
   * CDXC:TitlebarResources 2026-05-28-12:59:
   * The Resources bulk toggle should appear only when the Resources header is
   * hovered or focused, matching Sleep Inactive and Sleep All. Reuse the same
   * action-button surface and rotate the diagonal icons 90deg clockwise so
   * Resources and the sidebar share the same bulk-control orientation.
   */
  const resourceTooltipStyle = { maxWidth: 220 };
  return (
    <div className="titlebar-resources-panel">
      <div className="titlebar-resources-header">
        <div className="titlebar-resources-title">
          <IconDeviceDesktop aria-hidden="true" size={18} />
          <span>Resources</span>
          <button
            aria-label={allResourceSectionsCollapsed ? "Expand all resources" : "Collapse all resources"}
            className="titlebar-resources-collapse-all-button titlebar-resources-action-button"
            data-collapsed={String(allResourceSectionsCollapsed)}
            data-variant="sleep"
            disabled={resourceSectionKeys.length === 0}
            onClick={() => onSetSectionsCollapsed(resourceSectionKeys, nextAllSectionsCollapsed)}
            type="button"
          >
            <ResourceBulkCollapseIcon aria-hidden="true" size={14} stroke={1.9} />
          </button>
        </div>
        <div className="titlebar-resources-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Sleep inactive sessions"
                className="titlebar-resources-action-button"
                data-enabled={String(inactiveTerminalSleepSessionCount > 0)}
                data-variant="sleep"
                disabled={inactiveTerminalSleepSessionCount === 0}
                onClick={onSleepInactiveSessions}
                type="button"
              >
                <IconMoon aria-hidden="true" size={14} stroke={1.8} />
                <span>Sleep Inactive</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="titlebar-resource-tooltip" style={resourceTooltipStyle}>
              <span className="titlebar-resource-tooltip-title">Sleep inactive sessions</span>
              <span>Sleeps idle terminals and keeps them restorable in the sidebar.</span>
            </TooltipContent>
          </Tooltip>
          {persistentSessionMode ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Sleep all terminal sessions"
                  className="titlebar-resources-action-button"
                  data-variant="sleep"
                  disabled={sleepAllSessionBundles.length === 0}
                  onClick={() => onQuit(sleepAllSessionBundles)}
                  type="button"
                >
                  <IconMoon aria-hidden="true" size={14} stroke={1.9} />
                  <span>Sleep All</span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="titlebar-resource-tooltip" style={resourceTooltipStyle}>
                <span className="titlebar-resource-tooltip-title">Sleep all sessions</span>
                <span>Sleeps all terminal sessions and keeps them restorable in the sidebar.</span>
              </TooltipContent>
            </Tooltip>
          ) : null}
          <div className="titlebar-resources-summary">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <IconCpu aria-hidden="true" size={13} stroke={1.8} />
                  {formatWholePercent(sumBundleCpu(allBundles))}
                </span>
              </TooltipTrigger>
              <TooltipContent className="titlebar-resource-tooltip" style={resourceTooltipStyle}>
                <span className="titlebar-resource-tooltip-title">Live CPU</span>
                <span>CPU used by resources in this dropdown.</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <IconDeviceDesktop aria-hidden="true" size={13} stroke={1.8} />
                  {formatWholeMemory(sumBundleMemory(allBundles))}
                </span>
              </TooltipTrigger>
              <TooltipContent className="titlebar-resource-tooltip" style={resourceTooltipStyle}>
                <span className="titlebar-resource-tooltip-title">Live memory</span>
                <span>RAM used by resources in this dropdown.</span>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="titlebar-resources-scroll">
        <div className="titlebar-resources-info-note">
          This app uses native Ghostty terminals as they're lighter on CPU & RAM than electron/web terminals.<br />
          Long conversations with agents will still take up 100-200mbs each.<br />
          You can easily sleep all inactive terminals here & configure auto sleep in settings!
        </div>
        {visibleGroupViews.length > 0 ? (
          visibleGroupViews.map((view) => (
            <TitlebarResourceSection
              collapsedKeys={collapsedKeys}
              key={view.group.groupId}
              onQuit={onQuit}
              onFocusSession={onFocusSession}
              onToggle={onToggle}
              quittingKeys={quittingKeys}
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
          onQuit={onQuit}
          onFocusSession={onFocusSession}
          onToggle={onToggle}
          quittingKeys={quittingKeys}
          sectionKey="browser-tabs"
          title="Browser Tabs"
          bundles={browserBundles}
        />
        <TitlebarResourceSection
          collapsedKeys={collapsedKeys}
          onQuit={onQuit}
          onFocusSession={onFocusSession}
          onToggle={onToggle}
          quittingKeys={quittingKeys}
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
  onQuit,
  onFocusSession,
  onToggle,
  quittingKeys,
  sectionKey,
  title,
}: {
  bundles: ResourceProcessBundle[];
  collapsedKeys: Set<string>;
  onQuit: (bundles: ResourceProcessBundle[]) => void;
  onFocusSession: (sessionId: string) => void;
  onToggle: (key: string) => void;
  quittingKeys: Set<string>;
  sectionKey: string;
  title: string;
}) {
  if (bundles.length === 0) {
    return null;
  }
  const isCollapsed = collapsedKeys.has(sectionKey);
  const sectionCpu = sumBundleCpu(bundles);
  const sectionMemory = sumBundleMemory(bundles);
  const sortedBundles = sortResourceBundlesForDisplay(bundles, quittingKeys);
  const hasTerminalSession = bundles.some(
    (bundle) => bundle.type === "session" && bundle.session?.sessionKind === "terminal",
  );
  const sectionActionBundles = hasTerminalSession
    ? bundles.filter((bundle) => bundle.type === "session" && bundle.session?.sessionKind === "terminal")
    : bundles;
  const sectionActionLabel = hasTerminalSession ? "Sleep Project" : "Quit";
  const sectionActionTooltipTitle = hasTerminalSession ? "Sleep project" : "Quit this group";
  const sectionActionTooltipBody = hasTerminalSession
    ? "Sleeps this project's terminal sessions and keeps them restorable in the sidebar."
    : "Stops live processes and closes related surfaces.";
  /**
   * CDXC:TitlebarResources 2026-05-25-14:21:
   * Resource action tooltips share the compact width cap used by header and
   * summary tooltips, including Quit group, so long process-management copy
   * wraps near the hovered control instead of spanning the window.
   *
   * CDXC:TitlebarResources 2026-05-26-13:11:
   * Project resource groups that include terminal sessions should expose the
   * group action as Sleep Project, not Quit. Limit that action to terminal
   * session bundles so browser/code resources are not closed by a sleep-labeled
   * control.
   *
   * CDXC:TitlebarResources 2026-05-28-10:11:
   * Resource section expand/collapse controls should not show hover tooltips;
   * the inline totals already explain the group and the tooltip obscures the
   * Resources modal while users are expanding sections.
   */
  const resourceTooltipStyle = { maxWidth: 220 };
  return (
    <section className="titlebar-resource-section">
      <div className="titlebar-resource-section-heading">
        <button
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${title}`}
          className="titlebar-resource-section-toggle"
          onClick={() => onToggle(sectionKey)}
          type="button"
        >
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="titlebar-resource-section-quit-button"
              data-action={hasTerminalSession ? "sleep" : "quit"}
              onClick={() => onQuit(sectionActionBundles)}
              type="button"
            >
              {sectionActionLabel}
            </button>
          </TooltipTrigger>
          <TooltipContent className="titlebar-resource-tooltip" style={resourceTooltipStyle}>
            <span className="titlebar-resource-tooltip-title">{sectionActionTooltipTitle}</span>
            <span>{sectionActionTooltipBody}</span>
          </TooltipContent>
        </Tooltip>
      </div>
      {isCollapsed ? null : (
        <div className="titlebar-resource-section-body">
          {sortedBundles.map((bundle) => (
            <TitlebarResourceBundle
              bundle={bundle}
              collapsedKeys={collapsedKeys}
              isQuitting={quittingKeys.has(bundle.key)}
              key={bundle.key}
              onFocusSession={onFocusSession}
              onQuit={onQuit}
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
  isQuitting,
  onQuit,
  onFocusSession,
  onToggle,
}: {
  bundle: ResourceProcessBundle;
  collapsedKeys: Set<string>;
  isQuitting: boolean;
  onQuit: (bundles: ResourceProcessBundle[]) => void;
  onFocusSession: (sessionId: string) => void;
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
  const isSessionCollapsedByDefault = (bundle.type === "session" || bundle.type === "browser") && hasChildren;
  const bundleToggleKey = isSessionCollapsedByDefault ? `expanded:${bundle.key}` : bundle.key;
  const isCollapsed = isSessionCollapsedByDefault
    ? !collapsedKeys.has(bundleToggleKey)
    : collapsedKeys.has(bundleToggleKey);
  /**
   * CDXC:TitlebarResources 2026-05-23-10:52:
   * Terminal-session Quit from Resources terminates the live process tree but
   * intentionally keeps the session card in the sidebar as sleeping. Use the
   * sleep affordance for those rows; keep the quit affordance for browser,
   * code, and detached process rows that are actually removed or closed.
   */
  const preservesSidebarSession =
    bundle.type === "session" && bundle.session?.sessionKind === "terminal";
  const focusSessionId = bundle.type === "session" ? resourceBundleSidebarSessionIds(bundle)[0] : undefined;
  const actionLabel = preservesSidebarSession ? `Sleep ${bundle.label}` : `Close ${bundle.label}`;
  const actionTooltipTitle = preservesSidebarSession ? "Sleep session" : "Quit resource";
  const actionTooltipBody = preservesSidebarSession
    ? "Releases CPU/RAM and keeps the session restorable in the sidebar."
    : bundle.type === "browser"
      ? "Closes this browser resource and terminates the browser helper processes shown here."
      : bundle.type === "code"
        ? "Closes this code/project web view and terminates the backing helper process shown here."
        : "Terminates the process shown here.";
  /**
   * CDXC:TitlebarResources 2026-05-24-20:58:
   * Per-row action tooltips use the same compact cap as the header actions so
   * long session labels do not make the hover surface span across the window.
   *
   * CDXC:TitlebarResources 2026-05-28-10:39:
   * Session resource rows expose Focus beside Sleep/Close only while hovered or
   * keyboard-focused. Focus uses the same sidebar session id as Sleep so
   * cross-project Resources rows activate the exact owning session.
   */
  const resourceTooltipStyle = { maxWidth: 220 };
  return (
    <div className="titlebar-resource-bundle" data-quitting={String(isQuitting)}>
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
            <span className="titlebar-resource-meta">
              {isQuitting
                ? preservesSidebarSession
                  ? "Sleeping..."
                  : "Quitting..."
                : getResourceBundleMeta(bundle)}
            </span>
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
        {focusSessionId ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={`Focus ${bundle.label}`}
                className="titlebar-resource-focus-button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onFocusSession(focusSessionId);
                }}
                type="button"
              >
                <IconFocus2 aria-hidden="true" size={13} stroke={1.9} />
              </button>
            </TooltipTrigger>
            <TooltipContent className="titlebar-resource-tooltip" style={resourceTooltipStyle}>
              <span className="titlebar-resource-tooltip-title">Focus session</span>
              <span>Opens this session in the workspace.</span>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={actionLabel}
              className="titlebar-resource-kill-button"
              data-action={preservesSidebarSession ? "sleep" : "quit"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onQuit([bundle]);
              }}
              type="button"
            >
              {preservesSidebarSession ? (
                <IconMoon aria-hidden="true" size={13} stroke={1.9} />
              ) : (
                <IconX aria-hidden="true" size={13} stroke={2} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent className="titlebar-resource-tooltip" style={resourceTooltipStyle}>
            <span className="titlebar-resource-tooltip-title">{actionTooltipTitle}</span>
            <span>{actionTooltipBody}</span>
          </TooltipContent>
        </Tooltip>
      </div>
      {hasChildren && !isCollapsed ? (
        <div className="titlebar-resource-children">
          {bundle.childProcesses.slice(0, 8).map((process) => (
            <div className="titlebar-resource-child-row" key={process.pid}>
              <span className="titlebar-resource-child-name">
                {getResourceChildProcessName(bundle, process)} pid {process.pid}
              </span>
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

function getResourceChildProcessName(
  bundle: ResourceProcessBundle,
  process: ResourceProcess,
): string {
  return bundle.type === "browser" ? getBrowserProcessDisplayName(process) : getProcessDisplayName(process);
}

function getResourceBundleAvatar(bundle: ResourceProcessBundle): ReactNode {
  const agentIcon = bundle.session?.agentIcon;
  if (isSidebarAgentIcon(agentIcon)) {
    /**
     * CDXC:TitlebarResources 2026-05-26-13:24:
     * Resource rows should use the same shared agent-logo mask assets as Agents
     * Hub profile chips instead of two-letter text abbreviations. This keeps
     * Codex, Claude, T3, browser, and other agent identities visually aligned
     * across the sidebar and resource manager.
     */
    return (
      <span
        aria-hidden="true"
        className="titlebar-resource-avatar-logo"
        data-agent-icon={agentIcon}
        style={{
          backgroundColor: AGENT_LOGO_COLORS[agentIcon],
          maskImage: `url("${AGENT_LOGOS[agentIcon]}")`,
          WebkitMaskImage: `url("${AGENT_LOGOS[agentIcon]}")`,
        }}
      />
    );
  }
  if (bundle.type === "code") {
    return <IconCode aria-hidden="true" size={15} stroke={1.9} />;
  }
  if (bundle.type === "browser") {
    return <IconWorld aria-hidden="true" size={15} stroke={1.9} />;
  }
  if (bundle.session?.sessionKind === "terminal") {
    return <IconTerminal2 aria-hidden="true" size={15} stroke={1.9} />;
  }
  return <IconBox aria-hidden="true" size={15} stroke={1.9} />;
}

function isSidebarAgentIcon(candidate: unknown): candidate is SidebarAgentIcon {
  return typeof candidate === "string" && Object.prototype.hasOwnProperty.call(AGENT_LOGOS, candidate);
}

function getResourceBundleMeta(bundle: ResourceProcessBundle): string {
  if (bundle.session) {
    const provider = bundle.session.sessionPersistenceProvider
      ? `${bundle.session.sessionPersistenceProvider} terminal`
      : bundle.session.sessionKind ?? "session";
    const pid = bundle.process?.pid ? ` pid ${bundle.process.pid}` : "";
    return `${provider}${pid}`;
  }
  if (bundle.browserTab) {
    return bundle.browserTab.url?.trim() || "Browser tab";
  }
  if (bundle.type === "browser") {
    if (bundle.key === "browser:runtime") {
      return "Shared GPU, network, and storage helpers";
    }
    if (bundle.key === "browser:unmatched-renderers") {
      return "No visible Browser tab matched these helpers";
    }
    return "Browser helper processes";
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

function getTitlebarModeIcon(mode: TitlebarMode): ReactNode {
  switch (mode) {
    case "code":
      return <IconCode aria-hidden="true" size={14} stroke={1.8} />;
    case "git":
      return <IconBrandGithub aria-hidden="true" size={14} stroke={1.8} />;
    case "tasks":
      return <IconChecklist aria-hidden="true" size={14} stroke={1.8} />;
    case "agents":
    default:
      /**
       * CDXC:ModeSwitcher 2026-05-28-12:15:
       * The Agents page should use a single-person glyph in both the full
       * titlebar switcher and compact picker, not the group icon previously
       * used for multi-agent page identity.
       */
      return <IconUser aria-hidden="true" size={14} stroke={1.8} />;
  }
}

type TitlebarModeOption = {
  label: string;
  meta?: ReactNode;
  onSelect: () => void;
  value: TitlebarMode;
};

function TitlebarModeDropdown({
  activeMode,
  modes,
  onOpenChange,
  open,
}: {
  activeMode: TitlebarMode;
  modes: TitlebarModeOption[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const activeModeOption = modes.find((mode) => mode.value === activeMode) ?? modes[0];
  if (!activeModeOption) {
    return null;
  }
  const selectMode = (mode: TitlebarModeOption) => {
    onOpenChange(false);
    mode.onSelect();
  };
  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Mode menu"
          className="titlebar-session-button titlebar-mode-picker-trigger"
          data-titlebar-hit-region
          type="button"
          variant="ghost"
        >
          {/*
           * CDXC:ModeSwitcher 2026-05-28-10:38:
           * When app width is below 1050px, Agents/Code/Git/Project moves from
           * the centered segmented control into a keep-awake-style mode picker
           * beside the project title. Keep the current mode icon visible on the
           * main segment so narrow titlebar chrome still exposes the active action.
           *
           * CDXC:ModeSwitcher 2026-05-28-11:52:
           * The compact mode picker should be one button, not a split button:
           * clicking either the current-mode icon or the chevron opens the same
           * dropdown so there is no separate immediate mode action in tight chrome.
           */
          getTitlebarModeIcon(activeModeOption.value)}
          <IconChevronDown aria-hidden="true" size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        alignOffset={TITLEBAR_SPLIT_MENU_CENTER_OFFSET}
        className="titlebar-open-menu titlebar-mode-picker-menu min-w-[180px] rounded-lg border-border/80 !bg-[#0e0e0e] p-1 text-[13px] text-foreground shadow-2xl"
        data-titlebar-hit-region
        sideOffset={6}
        style={{ backgroundColor: "#0e0e0e", zIndex: 2_200 }}
      >
        {modes.map((mode) => (
          <DropdownMenuItem
            className="titlebar-open-menu-item"
            key={mode.value}
            onClick={() => selectMode(mode)}
          >
            {getTitlebarModeIcon(mode.value)}
            <span className="min-w-0 flex-1 truncate">{mode.label}</span>
            {mode.value === activeMode ? (
              <IconCheck aria-hidden="true" className="ml-2 size-4 opacity-75" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TitlebarModeSwitcher({
  activeMode,
  modes,
}: {
  activeMode: TitlebarMode;
  modes: TitlebarModeOption[];
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
        single button with the active segment rendered as the selected button's
        shared-layout motion background. Avoid a clipped segmented track
        because it changes the motion shape and makes the spring look unlike
        the referenced component.

        CDXC:ModeSwitcher 2026-05-15-14:54:
        The active pill must visibly travel from the previously active mode to
        the newly selected mode. Keep tab overflow visible so Framer Motion's
        shared-layout element is not clipped to the destination button, which
        would make Agents-to-Tasks look like a direct jump.

        CDXC:ModeSwitcher 2026-05-26-13:52:
        Titlebar mode tabs should match the sidebar session button roundness
        instead of using fully rounded pills, so the top navigation and session
        controls share one chrome language.
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
              {getTitlebarModeIcon(mode.value)}
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
    ...BUILT_IN_WORKSPACE_OPEN_TARGETS.filter((target) => !hiddenTargetIds.has(target.id)).map(
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
      if (target.id === "finder") {
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
  if (target.id === "finder") {
    return <IconFolderOpen aria-hidden="true" className="size-4 text-zinc-400" />;
  }
  const editorIcon = getEditorBrandIconId(target.id);
  if (editorIcon) {
    return <EditorBrandIcon className="size-4" icon={editorIcon} />;
  }
  return <IconBox aria-hidden="true" className="size-4 text-zinc-400" />;
}

function titlebarPrimaryGitActionLabel(label: string): string {
  return label.replace(/\bPush\b/g, "push").replace(/\bPR\b/g, "PR");
}

function compactTitlebarPrimaryGitActionLabel(label: string): string {
  /**
   * CDXC:TitlebarGit 2026-05-29-16:05:
   * Below 620px, the top-right Git primary button needs to remove the visible
   * Commit wording while preserving any following push or PR destination text.
   * Keep the full aria label on the button so the compact visual label does not
   * reduce screen-reader context.
   */
  return titlebarPrimaryGitActionLabel(label)
    .replace(/^Commit(?:\s*&\s*|,\s*)?/i, "")
    .trim();
}

function getTitlebarGitActionIcon(action: SidebarGitAction): ReactNode {
  if (action === "push") {
    return <IconUpload aria-hidden="true" className="titlebar-git-icon" size={15} stroke={1.8} />;
  }
  if (action === "multiRelease") {
    return (
      <IconStackPush aria-hidden="true" className="titlebar-git-icon" size={15} stroke={1.8} />
    );
  }
  if (action === "release") {
    return <IconRocket aria-hidden="true" className="titlebar-git-icon" size={15} stroke={1.8} />;
  }
  if (action === "pr") {
    return (
      <IconGitPullRequest
        aria-hidden="true"
        className="titlebar-git-icon"
        size={15}
        stroke={1.8}
      />
    );
  }
  return <IconGitCommit aria-hidden="true" className="titlebar-git-icon" size={15} stroke={1.8} />;
}

function readLastOpenTargetId(): string {
  return localStorage.getItem(LAST_OPEN_TARGET_STORAGE_KEY) || "finder";
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

function getSidebarActionLabel(command: SidebarCommandButton): string {
  return command.name.trim() || command.commandId;
}

function createTitlebarCommandConfigDraft(command: SidebarCommandButton): CommandConfigDraft {
  return {
    actionType: command.actionType,
    closeTerminalOnExit: command.closeTerminalOnExit,
    command: command.command ?? (command.actionType === "terminal" ? "" : undefined),
    commandId: command.commandId,
    icon: command.icon ?? DEFAULT_SIDEBAR_COMMAND_ICON,
    iconColor: command.iconColor ?? DEFAULT_SIDEBAR_COMMAND_ICON_COLOR,
    name: command.name,
    playCompletionSound: command.playCompletionSound,
    url: command.url ?? (command.actionType === "browser" ? DEFAULT_BROWSER_ACTION_URL : undefined),
  };
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
    gap: 0,
    left: 78,
    maxWidth: "min(620px, calc(100vw - 350px))",
    minWidth: 0,
    position: "absolute",
    top: TITLEBAR_PROJECT_TOP,
  },
  rightSlot: {
    alignItems: "center",
    display: "flex",
    gap: 9,
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
   * than framed buttons. Remove the manual installed-target refresh button and
   * preserve the 20px centered control height so the 35px titlebar
   * keeps top/bottom breathing room.
   *
   * CDXC:ReactTitlebar 2026-05-17-00:57:
   * The right titlebar controls should use spacing instead of separator rules.
   * Keep a consistent 9px gap between control groups and show a subtle hover
   * background on each button so pointer focus is visible without making the
   * chrome look heavy.
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
    background: rgba(255,255,255,0.08);
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
  .titlebar-update-button {
    /**
     * CDXC:AutoUpdate 2026-05-28-14:19:
     * The update affordance sits immediately to the left of the project
     * identity with a fixed 7px gap, so available updates read as subtle
     * chrome and never shift center or right-side titlebar controls.
     *
     * CDXC:AutoUpdate 2026-05-29-20:56:
     * The titlebar update button needs 6px of left breathing room at the
     * window edge. Its hover label must render as a local titlebar-strip
     * pseudo-tooltip instead of a portaled Radix tooltip because the promoted
     * sidebar layer can cover any tooltip that drops below the titlebar webview.
     */
    color: rgba(255,255,255,0.46);
    margin-left: 6px;
    margin-right: 7px;
    padding: 0;
    position: relative;
    width: 20px;
  }
  .titlebar-update-button::after {
    background: var(--ghostex-tooltip-background, rgba(24, 24, 24, 0.98));
    border: 1px solid var(--ghostex-tooltip-border, rgba(255, 255, 255, 0.12));
    border-radius: 16px;
    box-shadow: var(--ghostex-tooltip-shadow, 0 12px 30px rgba(0, 0, 0, 0.35));
    color: var(--ghostex-tooltip-foreground, rgba(255, 255, 255, 0.78));
    content: attr(data-tooltip);
    font: var(--ghostex-tooltip-font, 500 12px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif);
    left: calc(100% + 7px);
    opacity: 0;
    padding: 5px 10px;
    pointer-events: none;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    transition:
      opacity 120ms ease,
      visibility 0s linear 120ms;
    visibility: hidden;
    white-space: nowrap;
    z-index: var(--ghostex-tooltip-z-index, 1400);
  }
  .titlebar-update-button:is(:hover, :focus-visible)::after {
    opacity: 1;
    transition-delay: 0s;
    visibility: visible;
  }
  .titlebar-update-button:hover,
  .titlebar-update-button:focus-visible {
    color: rgba(255,255,255,0.84);
  }
  .titlebar-project-title {
    align-items: center;
    color: rgba(255,255,255,0.9);
    cursor: default;
    display: inline-flex;
    font: 650 13.5px/${TITLEBAR_CONTROL_HEIGHT}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    height: ${TITLEBAR_CONTROL_HEIGHT}px;
    letter-spacing: 0;
    max-width: 210px;
    min-width: 0;
    padding: 0 3px;
  }
  .titlebar-mode-picker-trigger {
    align-items: center;
    display: none !important;
    gap: 1px;
    flex: 0 0 auto;
    padding: 0 4px 0 6px;
    width: 42px;
  }
  .titlebar-mode-picker-menu {
    max-width: 220px;
    /*
     * CDXC:ModeSwitcher 2026-05-28-11:52:
     * The compact picker opens over the native left sidebar edge. Keep its
     * portaled Radix content above sidebar chrome instead of letting the menu
     * appear behind the project list.
     */
    z-index: 2200 !important;
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
  .titlebar-open-main-button {
    width: 28px;
    padding: 0;
  }
  .titlebar-git-main-button {
    gap: 5px;
    padding: 0 8px;
    width: auto;
  }
  .titlebar-git-label {
    max-width: 110px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .titlebar-git-label-compact {
    display: none;
  }
  .titlebar-git-icon {
    flex: 0 0 auto;
  }
  .titlebar-git-spinner {
    animation: titlebar-git-spin 1s linear infinite;
    flex: 0 0 auto;
  }
  @keyframes titlebar-git-spin {
    to {
      transform: rotate(360deg);
    }
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
    /**
     * CDXC:ModeSwitcher 2026-05-26-13:52:
     * Match the top mode-tab radius to sidebar session buttons. The session
     * card uses calc(10px * var(--sidebar-density-scale)); keep the titlebar
     * tab highlight on the same radius so it is less pill-shaped.
     */
    --titlebar-mode-tab-radius: calc(10px * var(--sidebar-density-scale));
    align-items: center;
    display: flex;
    flex: 0 1 auto;
    height: 22px;
    max-width: 100%;
    overflow: visible;
    padding: 0;
    perspective: 1000px;
  }
  @media (max-width: 1049px) {
    .titlebar-mode-switcher {
      /*
       * CDXC:ModeSwitcher 2026-05-28-10:38:
       * App widths below 1050px do not have enough horizontal room for the
       * centered Agents/Code/Git/Project switcher plus right-side titlebar
       * actions. Replace it with the split picker beside the project name.
       */
      display: none;
    }
    .titlebar-mode-picker-trigger {
      display: inline-flex !important;
    }
  }
  .titlebar-mode-tab {
    appearance: none;
    -webkit-appearance: none;
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--titlebar-mode-tab-radius);
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
    border-radius: var(--titlebar-mode-tab-radius);
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
  .titlebar-exit-focus-button {
    /**
     * CDXC:SessionFocusMode 2026-05-26-22:22:
     * The titlebar focus exit control should visually belong with Agents/Code/Git/Project.
     * Match the mode-tab height, font size, weight, and radius so focus mode does not introduce a separate button scale in the native titlebar.
     */
    appearance: none;
    -webkit-appearance: none;
    background: rgba(255,255,255,0.2) !important;
    border: 0 !important;
    border-radius: var(--titlebar-mode-tab-radius, calc(10px * var(--sidebar-density-scale, 1))) !important;
    box-shadow: none !important;
    color: rgba(255,255,255,0.98) !important;
    cursor: default;
    display: inline-flex;
    font: 650 12px/18px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif !important;
    height: 22px !important;
    letter-spacing: 0;
    margin-top: -1px;
    min-width: 0;
    padding: 0 10px !important;
    white-space: nowrap;
  }
  .titlebar-exit-focus-button:hover,
  .titlebar-exit-focus-button:focus-visible {
    background: rgba(255,255,255,0.24) !important;
    color: rgba(255,255,255,1) !important;
    outline: none;
  }
  .titlebar-resource-button {
    padding: 0;
    width: 28px;
  }
  @media (max-width: 619.98px) {
    /**
     * CDXC:ReactTitlebar 2026-05-29-16:05:
     * App widths below 620px need the top-right titlebar chrome to prioritize
     * the primary Git action. Hide Exit Focus, Keep Awake, and Resources, and
     * remove visible Commit wording from the Git primary label while keeping
     * non-commit destination text such as push or PR when there is room.
     */
    .titlebar-exit-focus-button,
    .titlebar-keep-awake-group,
    .titlebar-resource-button {
      display: none !important;
    }
    .titlebar-git-label-full[data-compact-below-620="true"] {
      display: none;
    }
    .titlebar-git-label-compact {
      display: inline;
    }
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
  .titlebar-open-menu {
    /**
     * CDXC:TitlebarMenus 2026-05-28-13:52:
     * Titlebar dropdown surfaces should match the unified #0e0e0e app-modal
     * background instead of using the older #181818 menu shell.
     */
    background: #0e0e0e !important;
    background-color: #0e0e0e !important;
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 18px 42px rgba(0,0,0,0.44);
  }
  /**
   * CDXC:TitlebarGit 2026-05-24-20:40:
   * The Git split menu opens from the chevron segment, but the menu must be wide enough to show Commit, Push, and Create PR labels. Pin the menu width instead of letting Radix size it from the narrow chevron trigger.
   *
   * CDXC:TitlebarGit 2026-05-25-10:16:
   * Release-oriented Git actions add longer dropdown labels such as Multicommit & Release, so the pinned menu width must fit them without clipping.
   */
  .titlebar-git-menu {
    max-width: 260px;
    min-width: 240px !important;
    overflow-x: visible;
    width: 240px !important;
  }
  .titlebar-open-menu-item {
    cursor: default !important;
    min-height: 30px;
    gap: 10px;
    border-radius: 7px;
    font: 500 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  }
  /**
   * CDXC:TitlebarActions 2026-05-19-16:05:
   * Action rows stack the configured title above a single-line dimmed command
   * preview. Hovering the preview opens a wrapped tooltip capped at 190px wide.
   */
  .titlebar-action-menu-item {
    align-items: flex-start !important;
    min-height: 44px;
    padding-block: 7px;
  }
  .titlebar-action-menu-icon {
    display: inline-flex;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .titlebar-action-menu-copy {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .titlebar-action-menu-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .titlebar-action-command-preview {
    color: rgba(255, 255, 255, 0.48);
    display: block;
    font-size: 11px;
    font-weight: 400;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .titlebar-action-command-preview[data-unconfigured="true"] {
    font-style: italic;
  }
  .titlebar-action-command-tooltip {
    max-width: 190px !important;
    overflow-wrap: anywhere;
  }
  .titlebar-resources-menu {
    /**
     * CDXC:TitlebarResources 2026-05-28-13:22:
     * The Resources manager background must match #0e0e0e while adjacent
     * titlebar dropdowns keep the existing titlebar menu color.
     */
    background: #0e0e0e !important;
    background-color: #0e0e0e !important;
    width: min(656px, calc(100vw - 24px));
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
  .titlebar-resources-collapse-all-button {
    gap: 0;
    padding: 0;
    width: 24px;
  }
  .titlebar-resources-action-button.titlebar-resources-collapse-all-button {
    gap: 0;
    min-width: 24px;
    padding: 0;
  }
  .titlebar-resources-collapse-all-button svg {
    transform: rotate(90deg);
  }
  .titlebar-resource-tooltip {
    background: var(--ghostex-tooltip-background, rgba(24,24,24,0.98));
    border: 1px solid var(--ghostex-tooltip-border, rgba(255,255,255,0.12));
    box-shadow: var(--ghostex-tooltip-shadow, 0 12px 30px rgba(0,0,0,0.35));
    color: var(--ghostex-tooltip-foreground, rgba(255,255,255,0.78));
    display: grid;
    font: var(--ghostex-tooltip-font, 500 12px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif);
    gap: 3px;
    max-width: 292px;
    padding: 8px 9px;
  }
  .titlebar-resource-tooltip-title {
    color: var(--ghostex-tooltip-strong-foreground, rgba(255,255,255,0.94));
    font-weight: 760;
  }
  .titlebar-resources-actions {
    gap: 10px;
    margin-left: auto;
  }
  .titlebar-resources-action-button {
    align-items: center;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: rgba(255,255,255,0.78);
    display: inline-flex;
    gap: 6px;
    font: 750 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    height: 24px;
    justify-content: center;
    opacity: 0;
    padding: 0 8px;
    pointer-events: none;
    transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
    white-space: nowrap;
  }
  .titlebar-resources-action-button[data-variant="quit"] {
    background: rgba(220,38,38,0.18);
    border-color: rgba(248,113,113,0.28);
    color: rgba(255,255,255,0.86);
  }
  .titlebar-resources-action-button:disabled {
    color: rgba(255,255,255,0.3);
    cursor: default;
  }
  .titlebar-resources-header:hover .titlebar-resources-action-button,
  .titlebar-resources-header:focus-within .titlebar-resources-action-button {
    /*
     * CDXC:TitlebarResources 2026-05-23-10:52:
     * The Resources header has exactly two matching actions: sleep inactive
     * sessions and, in persistence modes, sleep all terminal sessions. Keep
     * them hidden until hover/focus so the compact top bar still leads with
     * live metrics.
     */
    opacity: 1;
    pointer-events: auto;
  }
  .titlebar-resources-header:hover .titlebar-resources-action-button:disabled,
  .titlebar-resources-header:focus-within .titlebar-resources-action-button:disabled {
    opacity: 0.55;
  }
  .titlebar-resources-action-button[data-variant="sleep"]:not(:disabled):hover {
    background: rgba(255,255,255,0.14);
    color: rgba(255,255,255,0.92);
  }
  .titlebar-resources-action-button[data-variant="quit"]:not(:disabled):hover {
    background: rgba(220,38,38,0.28);
    color: rgba(255,255,255,0.96);
  }
  .titlebar-resource-section-quit-button {
    align-items: center;
    appearance: none;
    background: rgba(220,38,38,0.18);
    border: 1px solid rgba(248,113,113,0.28);
    border-radius: 6px;
    color: rgba(255,255,255,0.86);
    display: inline-flex;
    font: 750 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    height: 24px;
    justify-content: center;
    opacity: 0;
    padding: 0 8px;
    pointer-events: none;
    transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
    white-space: nowrap;
  }
  .titlebar-resource-section-quit-button[data-action="sleep"] {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.13);
  }
  .titlebar-resource-section-heading:hover .titlebar-resource-section-quit-button,
  .titlebar-resource-section-heading:focus-within .titlebar-resource-section-quit-button {
    /*
     * CDXC:TitlebarResources 2026-05-21-16:58:
     * Resource-manager Quit controls should stay available without crowding the
     * header or section chrome. Reveal destructive buttons only while the row is
     * hovered or keyboard-focused.
     *
     * CDXC:TitlebarResources 2026-05-26-13:11:
     * Sleep Project is a non-destructive project-group action, but it should
     * use the same hover reveal slot as section Quit so resource metrics remain
     * stable until the user targets the group action area.
     */
    opacity: 1;
    pointer-events: auto;
  }
  .titlebar-resource-section-quit-button[data-action="sleep"]:hover {
    background: rgba(255,255,255,0.14);
    color: rgba(255,255,255,0.92);
  }
  .titlebar-resource-section-quit-button[data-action="quit"]:hover {
    background: rgba(220,38,38,0.28);
    color: rgba(255,255,255,0.96);
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
  .titlebar-resources-info-note {
    /*
     * CDXC:TitlebarResources 2026-05-21-16:58:
     * Keep explanatory copy out of the crowded titlebar. Put the general
     * resource-usage note in the scroll body above the resource sections.
     */
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 7px;
    color: rgba(255,255,255,0.62);
    font: 600 12px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    margin-bottom: 8px;
    padding: 8px 10px;
  }
  .titlebar-resource-section + .titlebar-resource-section {
    margin-top: 8px;
    padding-top: 0;
  }
  .titlebar-resource-section-heading {
    align-items: center;
    color: rgba(255,255,255,0.62);
    display: flex;
    font: 750 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    gap: 6px;
    letter-spacing: 0.08em;
    padding: 4px 2px 7px;
    position: relative;
    text-transform: uppercase;
    width: 100%;
  }
  .titlebar-resource-section-toggle {
    align-items: center;
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    display: inline-flex;
    flex: 1;
    font: inherit;
    gap: 6px;
    letter-spacing: inherit;
    min-width: 0;
    padding: 0;
    text-transform: inherit;
  }
  .titlebar-resource-section-quit-button {
    height: 22px;
    position: absolute;
    right: 2px;
    top: 2px;
  }
  .titlebar-resource-section-heading:hover .titlebar-resource-section-summary,
  .titlebar-resource-section-heading:focus-within .titlebar-resource-section-summary {
    /*
     * CDXC:TitlebarResources 2026-05-22-23:21:
     * Section-level Quit actions should replace the CPU/RAM/count metrics on
     * hover, matching resource session rows where destructive controls occupy
     * the metrics area instead of adding another right-edge control.
     */
    opacity: 0;
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
    transition: opacity 120ms ease;
  }
  .titlebar-resource-section-summary span {
    gap: 4px;
    letter-spacing: 0;
  }
  .titlebar-resource-section-body {
    /*
     * CDXC:TitlebarResources 2026-05-28-10:17:
     * Expanded project sections need a small gutter below the project header so
     * the hover-revealed Sleep Project button does not visually touch the first
     * resource row.
     */
    display: grid;
    gap: 7px;
    margin-top: 5px;
  }
  .titlebar-resource-bundle {
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    overflow: hidden;
    background: rgba(255,255,255,0.025);
  }
  .titlebar-resource-bundle[data-quitting="true"] {
    opacity: 0.3;
  }
  .titlebar-resource-row {
    /*
     * CDXC:TitlebarResources 2026-05-16-20:07:
     * Long session titles and the hover-only close button must not shift the
     * row controls. Keep identity controls in fixed grid tracks, let only the
     * text track shrink, and hide metrics while the destructive button is shown.
     */
    align-items: center;
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) 74px 88px;
    min-height: 44px;
    overflow: hidden;
    padding: 7px 8px;
    position: relative;
  }
  .titlebar-resource-row[data-expandable="true"] {
    cursor: pointer;
  }
  .titlebar-resource-main {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: 20px 28px minmax(0, 1fr);
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
    display: block;
    width: 20px;
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
  .titlebar-resource-avatar svg {
    color: rgba(255,255,255,0.82);
  }
  .titlebar-resource-avatar-logo {
    /*
     * CDXC:TitlebarResources 2026-05-26-13:24:
     * Resource avatars use the Agents Hub mask-logo rendering path, so rows get
     * recognizable agent icons without changing the fixed avatar column size.
     */
    display: block;
    height: 15px;
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: contain;
    width: 15px;
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-size: contain;
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
  .titlebar-resource-focus-button,
  .titlebar-resource-kill-button {
    align-items: center;
    background: rgba(255,255,255,0.14);
    border: 1px solid transparent;
    border-radius: 5px;
    box-shadow: 0 8px 18px rgba(0,0,0,0.35);
    color: rgba(255,255,255,0.9);
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
  .titlebar-resource-focus-button {
    /*
     * CDXC:TitlebarResources 2026-05-28-10:39:
     * Keep row Focus directly left of the existing Sleep/Close hover action so
     * the right-side metrics can disappear into a stable two-button action
     * cluster without shifting the session label or process totals.
     */
    border-color: rgba(255,255,255,0.16);
    right: 36px;
  }
  .titlebar-resource-focus-button:hover {
    background: rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.96);
  }
  .titlebar-resource-kill-button {
    background: rgb(220 38 38);
    color: white;
  }
  .titlebar-resource-kill-button[data-action="sleep"] {
    background: rgba(255,255,255,0.14);
    border-color: rgba(255,255,255,0.16);
    color: rgba(255,255,255,0.9);
  }
  .titlebar-resource-row:hover > .titlebar-resource-metric,
  .titlebar-resource-row:focus-within > .titlebar-resource-metric {
    opacity: 0;
  }
  .titlebar-resource-row:hover .titlebar-resource-focus-button,
  .titlebar-resource-row:focus-within .titlebar-resource-focus-button,
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

const titlebarRootElement = document.getElementById("root");
if (titlebarRootElement?.dataset.ghostexTitlebar !== "false") {
  createRoot(titlebarRootElement!).render(<App />);
}
