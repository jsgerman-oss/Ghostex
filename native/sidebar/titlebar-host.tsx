import {
  IconBox,
  IconBrandGithub,
  IconChartPie2Filled,
  IconCheck,
  IconChevronDown,
  IconChecklist,
  IconCode,
  IconCpu,
  IconDeviceDesktop,
  IconFolderOpen,
  IconLayoutSidebarLeftExpand,
  IconMoon,
  IconPlayerPlay,
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
import { normalizeghostexSettings, type ZedOverlayTargetApp } from "../../shared/ghostex-settings";
import {
  BUILT_IN_WORKSPACE_OPEN_TARGETS,
  type CustomWorkspaceOpenTarget,
  type WorkspaceOpenTargetAvailability,
  type WorkspaceOpenTargetDefinition,
} from "../../shared/workspace-open-targets";
import { EditorBrandIcon, getEditorBrandIconId } from "../../sidebar/brand-icons";
import { SidebarCommandIconGlyph } from "../../sidebar/sidebar-command-icon";
import { createCombinedProjectSessionId, parseCombinedProjectGroupId } from "./combined-sidebar-mode";
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
  type: "app" | "browser" | "code" | "orphan" | "session";
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
  | { type: "toggleCommandsPanelFromTitlebar" }
  | { sessionIds: string[]; type: "sleepInactiveSessionsFromTitlebar" }
  | { projectIds: string[]; sessionIds: string[]; type: "quitResourcesFromTitlebar" }
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
  browserTabs: TitlebarBrowserTabResource[],
  resourceGroups: TitlebarResourceGroup[],
  processes: ResourceProcess[],
): { appBundles: ResourceProcessBundle[]; browserBundles: ResourceProcessBundle[]; groupViews: ResourceGroupView[]; orphanBundles: ResourceProcessBundle[] } {
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
  const appBundles = createAppRuntimeBundles(processes, childrenByParent, claimedPids);
  const browserBundles = createBrowserBundles(
    browserTabs.filter((tab) => !groupedBrowserTabIds.has(tab.id)),
    processes,
    claimedPids,
  );
  const orphanBundles = createOrphanBundles(processes, claimedPids);
  return { appBundles, browserBundles, groupViews, orphanBundles };
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
          !isGhostexBrowserProcess(treeProcess) &&
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
  const [openInMenuOpen, setOpenInMenuOpen] = useState(false);
  const [resourcesMenuOpen, setResourcesMenuOpen] = useState(false);
  const [resourceProcesses, setResourceProcesses] = useState<ResourceProcess[]>([]);
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
  const activeMode = optimisticMode ?? projectState.activeMode;
  const resourceViews = useMemo(
    () => createResourceGroupViews(projectState.browserTabs, projectState.resourceGroups, resourceProcesses),
    [projectState.browserTabs, projectState.resourceGroups, resourceProcesses],
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
  const visibleActions = useMemo(
    () => projectState.sidebarActions.commands,
    [projectState.sidebarActions.commands],
  );
  const activeAction =
    visibleActions.find((command) => command.commandId === selectedActionCommandId) ??
    visibleActions[0];
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
          browserTabs: state.browserTabs ?? current.browserTabs,
          projectEditorCompanionPaneHidden:
            state.projectEditorCompanionPaneHidden ?? current.projectEditorCompanionPaneHidden,
          petOverlayEnabled: state.petOverlayEnabled ?? current.petOverlayEnabled,
          resourceGroups: state.resourceGroups ?? current.resourceGroups,
          sidebarActions: state.sidebarActions ?? current.sidebarActions,
          sessionPersistenceProvider:
            state.sessionPersistenceProvider ?? current.sessionPersistenceProvider,
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

  const quitResourceBundles = (bundles: ResourceProcessBundle[]) => {
    const uniqueBundles = uniqueResourceBundles(bundles);
    if (uniqueBundles.length === 0) {
      return;
    }
    /**
     * CDXC:TitlebarResources 2026-05-21-16:38:
     * Any Quit action in the resource manager should immediately mark the row
     * as closing and move it below active resources. Sidebar-owned sessions,
     * browser panes, and VS Code project editors close through sidebar state;
     * only detached process bundles use direct SIGTERM.
     */
    setQuittingResourceKeys((current) => {
      const next = new Set(current);
      uniqueBundles.forEach((bundle) => next.add(bundle.key));
      return next;
    });
    const sessionIds = uniqueBundles.flatMap(resourceBundleSidebarSessionIds);
    const projectIds = uniqueBundles.flatMap(resourceBundleProjectEditorIds);
    const managedPids = new Set(
      uniqueBundles
        .filter((bundle) => resourceBundleSidebarSessionIds(bundle).length > 0 || resourceBundleProjectEditorIds(bundle).length > 0)
        .flatMap((bundle) => bundle.pids),
    );
    const pids = Array.from(
      new Set(
        uniqueBundles
          .flatMap((bundle) => bundle.pids)
          .filter((pid) => Number.isFinite(pid) && !managedPids.has(pid)),
      ),
    );
    if (sessionIds.length > 0 || projectIds.length > 0) {
      postNative({
        projectIds: Array.from(new Set(projectIds)),
        sessionIds: Array.from(new Set(sessionIds)),
        type: "quitResourcesFromTitlebar",
      });
    }
    if (pids.length > 0) {
      void runNativeProcess("/bin/kill", ["-TERM", ...pids.map(String)]).finally(() => {
        window.setTimeout(() => {
          void refreshResources();
        }, 250);
      });
      return;
    }
    window.setTimeout(() => {
      void refreshResources();
    }, 250);
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
            {/*
             * CDXC:ReactTitlebar 2026-05-17-02:29:
             * Top-right titlebar controls should not show hover tooltips.
             * Keep accessible labels on the buttons and visible labels inside
             * dropdown menus, while avoiding extra titlebar hover chrome.
             */}
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
                   * sidebar overflow menu. Use IconChartPie2Filled so this
                   * control reads as aggregate resource usage instead of
                   * only CPU.
                   */}
                  <IconChartPie2Filled aria-hidden="true" size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="titlebar-open-menu titlebar-resources-menu rounded-lg border-border/80 !bg-[#181818] p-0 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#181818" }}
              >
                <TitlebarResourcesMenu
                  appBundles={resourceViews.appBundles}
                  browserBundles={resourceViews.browserBundles}
                  collapsedKeys={collapsedResourceKeys}
                  groupViews={resourceViews.groupViews}
                  inactiveAgentSleepSessionCount={inactiveAgentSleepSessionIds.length}
                  onQuit={quitResourceBundles}
                  onSleepInactiveSessions={sleepInactiveAgentSessions}
                  onToggle={toggleResourceCollapse}
                  orphanBundles={resourceViews.orphanBundles}
                  quittingKeys={quittingResourceKeys}
                  sessionPersistenceProvider={projectState.sessionPersistenceProvider}
                />
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
                className="titlebar-open-menu min-w-[220px] rounded-lg border-border/80 !bg-[#181818] p-1 text-[13px] text-foreground shadow-2xl"
                data-titlebar-hit-region
                sideOffset={6}
                style={{ backgroundColor: "#181818" }}
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
    browserTabs: [],
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
    sessionPersistenceProvider:
      settings.sessionPersistenceProvider === "off" ? undefined : settings.sessionPersistenceProvider,
    workspaceOpenTargets: {
      availability: settings.workspaceOpenTargetAvailability,
      customTargets: settings.customWorkspaceOpenTargets,
      hiddenTargetIds: settings.workspaceOpenTargetHiddenIds,
    },
  };
}

function TitlebarResourcesMenu({
  appBundles,
  browserBundles,
  collapsedKeys,
  groupViews,
  inactiveAgentSleepSessionCount,
  onQuit,
  onSleepInactiveSessions,
  onToggle,
  orphanBundles,
  quittingKeys,
  sessionPersistenceProvider,
}: {
  appBundles: ResourceProcessBundle[];
  browserBundles: ResourceProcessBundle[];
  collapsedKeys: Set<string>;
  groupViews: ResourceGroupView[];
  inactiveAgentSleepSessionCount: number;
  onQuit: (bundles: ResourceProcessBundle[]) => void;
  onSleepInactiveSessions: () => void;
  onToggle: (key: string) => void;
  orphanBundles: ResourceProcessBundle[];
  quittingKeys: Set<string>;
  sessionPersistenceProvider?: "tmux" | "zmx" | "zellij";
}) {
  const visibleGroupViews = groupViews.filter((view) => view.bundles.length > 0);
  const allBundles = [
    ...visibleGroupViews.flatMap((view) => view.bundles),
    ...appBundles,
    ...browserBundles,
    ...orphanBundles,
  ];
  const sessionBundles = [
    ...visibleGroupViews.flatMap((view) => view.bundles),
    ...browserBundles,
    ...orphanBundles,
  ];
  return (
    <div className="titlebar-resources-panel">
      <div className="titlebar-resources-header">
        <div className="titlebar-resources-title">
          <IconChartPie2Filled aria-hidden="true" size={18} />
          <span>Resources</span>
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
          <button
            className="titlebar-resources-quit-all-button"
            disabled={sessionBundles.length === 0}
            onClick={() => onQuit(sessionBundles)}
            type="button"
          >
            Quit All Sessions
          </button>
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
        <div className="titlebar-resources-info-note">
          Most resources are used by Agent Terminals.
        </div>
        {sessionPersistenceProvider === "zmx" ? (
          <div className="titlebar-resources-zmx-note">
            Quitting Ghostex does not quit zmx terminals. Use Quit All Sessions to clear RAM.
          </div>
        ) : null}
        {visibleGroupViews.length > 0 ? (
          visibleGroupViews.map((view) => (
            <TitlebarResourceSection
              collapsedKeys={collapsedKeys}
              key={view.group.groupId}
              onQuit={onQuit}
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
          onToggle={onToggle}
          quittingKeys={quittingKeys}
          sectionKey="app-runtime"
          title="App Runtime"
          bundles={appBundles}
        />
        <TitlebarResourceSection
          collapsedKeys={collapsedKeys}
          onQuit={onQuit}
          onToggle={onToggle}
          quittingKeys={quittingKeys}
          sectionKey="browser-tabs"
          title="Browser Tabs"
          bundles={browserBundles}
        />
        <TitlebarResourceSection
          collapsedKeys={collapsedKeys}
          onQuit={onQuit}
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
  onToggle,
  quittingKeys,
  sectionKey,
  title,
}: {
  bundles: ResourceProcessBundle[];
  collapsedKeys: Set<string>;
  onQuit: (bundles: ResourceProcessBundle[]) => void;
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
  return (
    <section className="titlebar-resource-section">
      <div className="titlebar-resource-section-heading">
        <button
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
        <button
          className="titlebar-resource-section-quit-button"
          onClick={() => onQuit(bundles)}
          type="button"
        >
          Quit
        </button>
      </div>
      {isCollapsed ? null : (
        <div className="titlebar-resource-section-body">
          {sortedBundles.map((bundle) => (
            <TitlebarResourceBundle
              bundle={bundle}
              collapsedKeys={collapsedKeys}
              isQuitting={quittingKeys.has(bundle.key)}
              key={bundle.key}
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
  onToggle,
}: {
  bundle: ResourceProcessBundle;
  collapsedKeys: Set<string>;
  isQuitting: boolean;
  onQuit: (bundles: ResourceProcessBundle[]) => void;
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
              {isQuitting ? "Quitting..." : getResourceBundleMeta(bundle)}
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
        <button
          aria-label={`Close ${bundle.label}`}
          className="titlebar-resource-kill-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onQuit([bundle]);
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

function getResourceBundleAvatar(bundle: ResourceProcessBundle): string {
  if (bundle.session?.sessionKind === "browser") {
    return "B";
  }
  if (bundle.type === "code") {
    return "V";
  }
  if (bundle.type === "browser") {
    return "B";
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
   * preserve the 20px centered control height so the compact 30px titlebar
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
  .titlebar-resource-button {
    padding: 0;
    width: 28px;
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
    opacity: 0;
    padding: 0;
    pointer-events: none;
    transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
    width: 24px;
  }
  .titlebar-resources-sleep-button:disabled {
    color: rgba(255,255,255,0.3);
    cursor: default;
  }
  .titlebar-resources-header:hover .titlebar-resources-sleep-button,
  .titlebar-resources-header:focus-within .titlebar-resources-sleep-button {
    /*
     * CDXC:TitlebarResources 2026-05-21-17:03:
     * Hide secondary resource-manager actions until the header is hovered or
     * focused so the compact top bar shows only title and live metrics by default.
     */
    opacity: 1;
    pointer-events: auto;
  }
  .titlebar-resources-header:hover .titlebar-resources-sleep-button:disabled,
  .titlebar-resources-header:focus-within .titlebar-resources-sleep-button:disabled {
    opacity: 0.55;
  }
  .titlebar-resources-sleep-button:not(:disabled):hover {
    background: rgba(255,255,255,0.14);
    color: rgba(255,255,255,0.92);
  }
  .titlebar-resources-quit-all-button,
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
  .titlebar-resources-header:hover .titlebar-resources-quit-all-button,
  .titlebar-resources-header:focus-within .titlebar-resources-quit-all-button,
  .titlebar-resource-section-heading:hover .titlebar-resource-section-quit-button,
  .titlebar-resource-section-heading:focus-within .titlebar-resource-section-quit-button {
    /*
     * CDXC:TitlebarResources 2026-05-21-16:58:
     * Resource-manager Quit controls should stay available without crowding the
     * header or section chrome. Reveal destructive buttons only while the row is
     * hovered or keyboard-focused.
     */
    opacity: 1;
    pointer-events: auto;
  }
  .titlebar-resources-quit-all-button:disabled {
    cursor: default;
  }
  .titlebar-resources-header:hover .titlebar-resources-quit-all-button:disabled,
  .titlebar-resources-header:focus-within .titlebar-resources-quit-all-button:disabled {
    opacity: 0.45;
  }
  .titlebar-resources-quit-all-button:not(:disabled):hover,
  .titlebar-resource-section-quit-button:hover {
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
     * resource-usage note in the scroll body above the zmx persistence warning.
     */
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 7px;
    color: rgba(255,255,255,0.62);
    font: 600 12px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    margin-bottom: 8px;
    padding: 8px 10px;
  }
  .titlebar-resources-zmx-note {
    /*
     * CDXC:TitlebarResources 2026-05-21-16:38:
     * When zmx persistence is enabled, the resource manager must state that
     * quitting Ghostex leaves durable terminals alive and direct users to Quit
     * All Sessions when their goal is freeing RAM.
     */
    background: rgba(250,204,21,0.1);
    border: 1px solid rgba(250,204,21,0.22);
    border-radius: 7px;
    color: rgba(255,255,255,0.82);
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
    margin-left: 8px;
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
  .titlebar-resource-row:hover > .titlebar-resource-metric,
  .titlebar-resource-row:focus-within > .titlebar-resource-metric {
    opacity: 0;
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
