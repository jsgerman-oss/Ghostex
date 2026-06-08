import {
  IconArchive,
  IconAlertTriangle,
  IconBell,
  IconCalendarTime,
  IconCopy,
  IconExternalLink,
  IconFolderOpen,
  IconLink,
  IconMessageCircle,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUnlink,
  IconX,
} from "@tabler/icons-react";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BOARD_COLUMNS,
  PRIORITY_OPTIONS,
  TSHIRT_OPTIONS,
  appendImageMarkdownToDescription,
  beadsErrorMessage,
  beadsStatusToBoardStatus,
  boardStatusBeadsValue,
  boardStatusLabel,
  buildAgentWorkPrompt,
  ensureWorkflowStatuses,
  extractDescriptionImageReferences,
  extractPreviewableDescriptionImageReferences,
  filterBoardTickets,
  formatShortDate,
  getBlockedByIds,
  getBlockingIds,
  normalizeBeadsPayload,
  normalizeDisplayIssueKey,
  parseBeadsJson,
  priorityLabel,
  prioritySelectValue,
  removeDescriptionImageReference,
  isDescriptionImageSource,
  tshirtToEstimate,
  toBoardTickets,
  estimateToTshirt,
  type BeadsBridgeRequest,
  type BeadsBridgeResponse,
  type BeadsIssue,
  type BoardStatusKey,
  type BoardTicket,
  type DescriptionImageReference,
  type TshirtSize,
} from "./project-board-shared";
import {
  type ProjectBoardAgentOption,
  type ProjectBoardBridgeRequest,
  type ProjectBoardBridgeResponse,
  type ProjectBoardConversationLinkView,
  type ProjectBoardConversationState,
  type ProjectBoardStartLocation,
} from "../../shared/bead-conversation-links";
import {
  compareAutomationRunsNewestFirst,
  computeNextRunAt,
  normalizeAutomationSchedule,
  type AutomationDefinition,
  type AutomationExecutionMode,
  type AutomationRun,
  type AutomationSchedule,
  type ProjectAutomationAgentOption,
  type ProjectAutomationsBridgeState,
} from "../../shared/automations";
import "../../sidebar/styles/shadcn.generated.css";

type LoadState = "idle" | "loading" | "ready" | "error";

type DetailDraft = {
  blockedByIds: string[];
  blockingIds: string[];
  comment: string;
  description: string;
  isDeleting: boolean;
  isSaving: boolean;
  labels: string[];
  priority: string;
  status: BoardStatusKey;
  title: string;
  tshirt?: TshirtSize;
  ticket?: BoardTicket;
};

type TicketFormDraft = {
  blockedByIds: string[];
  blockingIds: string[];
  description: string;
  labels: string[];
  priority: string;
  title: string;
  tshirt?: TshirtSize;
};

type ConversationActionState =
  | { kind: "associate"; beadId: string }
  | { kind: "jump"; linkId: string }
  | { kind: "start"; beadId: string }
  | { kind: "unlink"; linkId: string }
  | undefined;

type ProjectBeadsWebKitWindow = Window & {
  webkit?: {
    messageHandlers?: {
      ghostexProjectBeads?: {
        postMessage: (message: BeadsBridgeRequest) => void;
      };
      ghostexProjectBoard?: {
        postMessage: (message: ProjectBoardBridgeRequest) => void;
      };
      ghostexProjectBoardImages?: {
        postMessage: (message: ProjectBoardImageBridgeRequest) => void;
      };
    };
  };
};

const BRIDGE_REQUEST_PREFIX = "__GHOSTEX_PROJECT_BEADS_REQUEST__";
const BRIDGE_RESPONSE_EVENT = "ghostex-project-beads-response";
const PROJECT_BOARD_RESPONSE_EVENT = "ghostex-project-board-response";
const PROJECT_BOARD_IMAGE_RESPONSE_EVENT = "ghostex-project-board-image-response";
const INSTALL_BEADS_COMMAND = "brew install beads";
const PROJECT_BOARD_AUTO_REFRESH_INTERVAL_MS = 8_000;
const PROJECT_BOARD_LABEL_REFRESH_INTERVAL_MS = 60_000;
const PROJECT_BOARD_MAX_DEPENDENCY_OPTIONS = 600;
const PROJECT_BOARD_MAX_VISIBLE_TICKETS_PER_COLUMN = 120;
const PROJECT_BOARD_GENERATING_TITLE = "Generating title...";
const PROJECT_AUTOMATION_TRIAGE_RECENT_COMPLETED_LIMIT = 5;

type BoardRefreshMode = "background" | "initial" | "manual" | "mutation";

type BoardRefreshOptions = {
  includeLabels?: boolean;
  mode?: BoardRefreshMode;
};

type ProjectSurfaceTab = "triage" | "automations" | "runs" | "board";

type AutomationDraft = {
  agentId: string;
  cronExpression: string;
  enabled: boolean;
  executionKind: AutomationExecutionMode["kind"];
  expiresAt: string;
  id?: string;
  name: string;
  prompt: string;
  projectId: string;
  schedulePreset: "15m" | "hourly" | "daily" | "weekly" | "cron";
  scheduleTime: string;
  setupCommand: string;
  threadSessionId: string;
  weeklyDay: string;
};

type ProjectBoardImageBridgeRequest = {
  action: "loadPreview" | "pasteImage";
  path?: string;
  requestId: string;
};

type ProjectBoardImageBridgeResponse = {
  dataUrl?: string;
  error?: string;
  imagePath?: string;
  path?: string;
  requestId: string;
};

function createEmptyDetailDraft(): DetailDraft {
  return {
    blockedByIds: [],
    blockingIds: [],
    comment: "",
    description: "",
    isDeleting: false,
    isSaving: false,
    labels: [],
    priority: "2",
    status: "todo",
    title: "",
  };
}

function createEmptyTicketFormDraft(): TicketFormDraft {
  return {
    blockedByIds: [],
    blockingIds: [],
    description: "",
    labels: [],
    priority: "2",
    title: "",
  };
}

function ProjectBoardApp() {
  const projectName = new URLSearchParams(window.location.search).get("projectName") || "Project";
  const projectPath = new URLSearchParams(window.location.search).get("projectPath") || "";
  const projectId = new URLSearchParams(window.location.search).get("projectId") || "";
  const displayKey = normalizeDisplayIssueKey(
    new URLSearchParams(window.location.search).get("beadsDisplayKey") ?? projectName,
  );
  const [tickets, setTickets] = useState<BoardTicket[]>([]);
  const [allIssues, setAllIssues] = useState<BeadsIssue[]>([]);
  const [knownLabels, setKnownLabels] = useState<string[]>([]);
  const [conversationState, setConversationState] = useState<ProjectBoardConversationState>({
    agents: [],
    debuggingMode: false,
    links: [],
    sessions: [],
  });
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BoardStatusKey | "all">("all");
  const [detail, setDetail] = useState<DetailDraft>(createEmptyDetailDraft);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [newTicket, setNewTicket] = useState<TicketFormDraft>(createEmptyTicketFormDraft);
  const [createAction, setCreateAction] = useState<"create" | "createStart">();
  const [newTicketStartLocation, setNewTicketStartLocation] =
    useState<ProjectBoardStartLocation>("currentProject");
  const isCreating = Boolean(createAction);
  const [deleteConfirmingTicketId, setDeleteConfirmingTicketId] = useState("");
  const [imagePreviewDataUrls, setImagePreviewDataUrls] = useState<Record<string, string>>({});
  const pendingImagePreviewPathsRef = useRef(new Set<string>());
  const failedImagePreviewPathsRef = useRef(new Set<string>());
  /*
   * CDXC:ProjectBoard 2026-05-26-05:38:
   * The Project page must observe Beads changes made by the user's app actions or nearby bd CLI commands without forcing manual Refresh.
   * Poll only while the page is visible, coalesce overlapping refreshes, refresh labels less often than issues, and cap mounted lane/dependency rows so thousand-bead projects do not repeatedly rebuild an unbounded DOM.
   *
   * CDXC:ProjectBoard 2026-05-26-10:08:
   * Creating a ticket with an empty title must not keep the modal blocked while the selected/default prompt agent generates a title.
   * Create the Beads issue first with an explicit "Generating title..." card title, close the modal, refresh the board, then replace that temporary title after generation finishes.
   *
   * CDXC:ProjectBoard 2026-05-26-10:08:
   * Users need to delete tickets from the Project board UI. Keep deletion in the edit dialog, require a second destructive click for confirmation, and refresh from Beads after bd deletes the issue.
   *
   * CDXC:ProjectBoard 2026-05-26-10:16:
   * A bead can be linked to the agent conversation that is working on it, and multiple beads may point at one conversation.
   * Refresh conversation links alongside Beads data so card jump buttons keep tracking captured session metadata while the Project page stays open.
   *
   * CDXC:ProjectBoard 2026-05-26-10:20:
   * Conversation actions can launch terminals, focus sessions, or mutate persisted links.
   * Track the active action so duplicate clicks do not create duplicate agent sessions or race link/archive state while the board is responding.
   *
   * CDXC:ProjectBoard 2026-05-28-12:32:
   * New tickets need an explicit Create & Start path with agent selection and a current-project versus new-worktree start location.
   * The ticket is still created on the board project first so the agent prompt carries the real bead id, and project-page diagnostics are emitted only when Settings Debugging Mode is enabled.
   *
   * CDXC:ProjectBoard 2026-05-28-16:21:
   * Ticket primary actions should reopen existing work before creating new work.
   * Treat live and previous-session-restorable conversation links as usable so "Start work" changes to "Go to Session" once a ticket already owns an openable agent conversation.
   * Keep the ticket dialog open after Go to Session; focusing/restoring the session should reveal the workarea without discarding the user's ticket-editing context.
   */
  const isRefreshingRef = useRef(false);
  const issuesSignatureRef = useRef("");
  const labelsSignatureRef = useRef("");
  const lastLabelsRefreshAtRef = useRef(0);
  const newPromptRef = useRef<HTMLTextAreaElement>(null);
  const automationProjectsRef = useRef<ProjectAutomationsBridgeState["projects"]>([]);
  const [conversationAction, setConversationAction] = useState<ConversationActionState>();
  const [activeSurfaceTab, setActiveSurfaceTab] = useState<ProjectSurfaceTab>("triage");
  const [automationState, setAutomationState] = useState<ProjectAutomationsBridgeState>({
    agents: [],
    automations: [],
    projectCanUseWorktrees: false,
    projectId,
    projectName,
    projectPath,
    projects: [],
    runs: [],
  });
  const [automationConversationState, setAutomationConversationState] =
    useState<ProjectBoardConversationState>({
      agents: [],
      debuggingMode: false,
      links: [],
      sessions: [],
    });
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraft>(() =>
    createAutomationDraft(),
  );
  const [automationActionId, setAutomationActionId] = useState("");
  const [automationTargetProjectId, setAutomationTargetProjectId] = useState(projectId);
  const [selectedAutomationId, setSelectedAutomationId] = useState("");
  const [selectedAutomationRunId, setSelectedAutomationRunId] = useState("");

  const runBeads = useCallback(
    async (request: Omit<BeadsBridgeRequest, "cwd" | "requestId">) => {
      if (!projectPath) {
        throw new Error("No active project path is available.");
      }
      const response = await sendBeadsRequest({ ...request, cwd: projectPath });
      if (response.exitCode !== 0) {
        throw new Error(beadsErrorMessage(response.stderr || response.stdout));
      }
      return parseBeadsJson(response.stdout);
    },
    [projectPath],
  );

  const loadConversationState = useCallback(async () => {
    try {
      const response = await sendProjectBoardRequest({
        action: "getState",
        projectId,
        projectPath,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not load linked conversations.");
      }
      const payload = response.payload ?? { agents: [], links: [], sessions: [] };
      setConversationState(payload);
      setAutomationConversationState((current) =>
        automationTargetProjectId === projectId ? payload : current,
      );
      setSelectedAgentId((current) => current || payload.defaultAgentId || payload.agents[0]?.agentId || "");
    } catch (error) {
      console.warn("Project board conversation state unavailable.", error);
    }
  }, [automationTargetProjectId, projectId, projectPath]);

  const applyAutomationState = useCallback((payload: ProjectAutomationsBridgeState) => {
    automationProjectsRef.current = payload.projects;
    setAutomationState(payload);
    setAutomationTargetProjectId(payload.projectId);
  }, []);

  const loadAutomationState = useCallback(async (targetProjectId?: string) => {
    const requestedProjectId = targetProjectId?.trim() || automationTargetProjectId || projectId;
    const targetProject = automationProjectsRef.current.find(
      (candidate) => candidate.projectId === requestedProjectId,
    );
    try {
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationGetState",
        projectId: requestedProjectId,
        projectPath: targetProject?.path ?? (requestedProjectId === projectId ? projectPath : undefined),
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not load automations.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
        setAutomationDraft((current) =>
          current.agentId
            ? current
            : {
                ...current,
                agentId: response.payload?.defaultAgentId || response.payload?.agents[0]?.agentId || "",
                projectId: current.projectId || response.payload?.projectId || projectId,
                executionKind: response.payload?.projectCanUseWorktrees === false ? "local" : current.executionKind,
              },
        );
      }
    } catch (error) {
      console.warn("Project automations state unavailable.", error);
    }
  }, [applyAutomationState, automationTargetProjectId, projectId, projectPath]);

  const loadAutomationConversationState = useCallback(async (targetProjectId?: string) => {
    const requestedProjectId = targetProjectId?.trim() || automationTargetProjectId || projectId;
    const targetProject = automationProjectsRef.current.find(
      (candidate) => candidate.projectId === requestedProjectId,
    );
    try {
      const response = await sendProjectBoardRequest({
        action: "getState",
        projectId: requestedProjectId,
        projectPath: targetProject?.path ?? (requestedProjectId === projectId ? projectPath : undefined),
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not load automation sessions.");
      }
      setAutomationConversationState(response.payload ?? { agents: [], links: [], sessions: [] });
    } catch (error) {
      console.warn("Project automation sessions unavailable.", error);
      setAutomationConversationState({ agents: [], debuggingMode: false, links: [], sessions: [] });
    }
  }, [automationTargetProjectId, projectId, projectPath]);

  const logProjectBoardDebug = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      if (!conversationState.debuggingMode) {
        return;
      }
      void sendProjectBoardRequest({
        action: "appendDebugLog",
        details: stringifyProjectBoardDebugDetails(details),
        event,
        projectId,
        projectPath,
      }).catch((error) => {
        console.warn("Project board debug log unavailable.", error);
      });
    },
    [conversationState.debuggingMode, projectId, projectPath],
  );

  const loadTickets = useCallback(async (options: BoardRefreshOptions = {}) => {
    const mode = options.mode ?? "manual";
    const includeLabels = options.includeLabels ?? mode !== "background";
    if (isRefreshingRef.current) {
      if (mode === "background") {
        return;
      }
      await waitForProjectBoardRefreshIdle(() => isRefreshingRef.current);
    }
    isRefreshingRef.current = true;
    if (mode !== "background") {
      setLoadState("loading");
      setErrorMessage("");
    }
    try {
      if (mode === "initial" || mode === "manual") {
        await ensureWorkflowStatuses(runBeads);
      }
      const payload = await runBeads({ action: "listIssues" });
      const issues = normalizeBeadsPayload<BeadsIssue[]>(payload, Array.isArray(payload) ? payload : []);
      const issuesSignature = `${displayKey}:${createIssuesSignature(issues)}`;
      if (issuesSignature !== issuesSignatureRef.current) {
        issuesSignatureRef.current = issuesSignature;
        setAllIssues(issues);
        setTickets(toBoardTickets(issues, displayKey));
      }
      if (includeLabels) {
        const labelsPayload = await runBeads({ action: "listAllLabels" });
        const labels = normalizeBeadsPayload<string[]>(labelsPayload, [])
          .filter((label) => typeof label === "string")
          .sort();
        const labelsSignature = labels.join("\u001f");
        if (labelsSignature !== labelsSignatureRef.current) {
          labelsSignatureRef.current = labelsSignature;
          setKnownLabels(labels);
        }
        lastLabelsRefreshAtRef.current = Date.now();
      }
      if (mode !== "background") {
        setLoadState("ready");
      } else {
        setErrorMessage("");
        setLoadState((current) => (current === "loading" ? current : "ready"));
      }
    } catch (error) {
      if (mode !== "background") {
        setLoadState("error");
        setErrorMessage(error instanceof Error ? error.message : "Could not load Beads issues.");
      } else {
        console.warn("Project board auto refresh failed.", error);
      }
    } finally {
      isRefreshingRef.current = false;
    }
  }, [displayKey, runBeads]);

  useEffect(() => {
    void loadConversationState();
    void loadAutomationState();
  }, [loadAutomationState, loadConversationState]);

  useEffect(() => {
    if (activeSurfaceTab !== "board") {
      return;
    }
    void loadTickets({ includeLabels: true, mode: "initial" });
  }, [activeSurfaceTab, loadTickets]);

  useEffect(() => {
    const imageSources = [
      ...extractPreviewableDescriptionImageReferences(detail.description),
      ...extractPreviewableDescriptionImageReferences(newTicket.description),
    ].map((image) => image.src);
    for (const imageSource of imageSources) {
      if (imageSource.startsWith("data:image/")) {
        setImagePreviewDataUrls((current) =>
          current[imageSource] ? current : { ...current, [imageSource]: imageSource },
        );
        continue;
      }
      if (
        imagePreviewDataUrls[imageSource] ||
        pendingImagePreviewPathsRef.current.has(imageSource) ||
        failedImagePreviewPathsRef.current.has(imageSource)
      ) {
        continue;
      }
      pendingImagePreviewPathsRef.current.add(imageSource);
      void sendProjectBoardImageRequest({ action: "loadPreview", path: imageSource })
        .then((response) => {
          if (response.dataUrl?.startsWith("data:image/")) {
            setImagePreviewDataUrls((current) => ({
              ...current,
              [imageSource]: response.dataUrl ?? "",
            }));
            return;
          }
          failedImagePreviewPathsRef.current.add(imageSource);
          console.warn(response.error || `Could not load image preview for ${imageSource}.`);
        })
        .catch((error) => {
          failedImagePreviewPathsRef.current.add(imageSource);
          console.warn(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          pendingImagePreviewPathsRef.current.delete(imageSource);
        });
    }
  }, [detail.description, imagePreviewDataUrls, newTicket.description]);

  useEffect(() => {
    const refreshIfVisible = (includeLabels = false) => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (activeSurfaceTab === "board") {
        void loadTickets({
          includeLabels:
            includeLabels ||
            Date.now() - lastLabelsRefreshAtRef.current >= PROJECT_BOARD_LABEL_REFRESH_INTERVAL_MS,
          mode: "background",
        });
      }
      void loadConversationState();
      void loadAutomationState();
    };
    const intervalId = window.setInterval(
      () => refreshIfVisible(false),
      PROJECT_BOARD_AUTO_REFRESH_INTERVAL_MS,
    );
    const handleVisible = () => refreshIfVisible(false);
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, [activeSurfaceTab, loadAutomationState, loadConversationState, loadTickets]);

  const filteredTickets = useMemo(
    () => filterBoardTickets(tickets, searchQuery, statusFilter),
    [searchQuery, statusFilter, tickets],
  );

  const ticketsByColumn = useMemo(() => {
    return BOARD_COLUMNS.reduce<Record<BoardStatusKey, BoardTicket[]>>(
      (result, column) => {
        result[column.key] = filteredTickets.filter((ticket) => ticket.boardStatus === column.key);
        return result;
      },
      { done: [], in_progress: [], review: [], test: [], todo: [] },
    );
  }, [filteredTickets]);

  const linksByBeadId = useMemo(() => {
    const result = new Map<string, ProjectBoardConversationLinkView[]>();
    const newestFirstLinks = [...conversationState.links].sort(compareConversationLinksNewestFirst);
    for (const link of newestFirstLinks) {
      const current = result.get(link.beadId) ?? [];
      current.push(link);
      result.set(link.beadId, current);
    }
    return result;
  }, [conversationState.links]);

  const ticketOptions = useMemo(
    () =>
      prioritizeDependencyTickets(tickets)
        .slice(0, PROJECT_BOARD_MAX_DEPENDENCY_OPTIONS)
        .map((ticket) => ({
          id: ticket.id,
          label: `${ticket.displayId} · ${ticket.title}`,
        })),
    [tickets],
  );

  const openTicket = async (ticket: BoardTicket) => {
    setDeleteConfirmingTicketId("");
    setDetail({
      blockedByIds: getBlockedByIds(ticket),
      blockingIds: getBlockingIds(ticket.id, allIssues),
      comment: "",
      description: ticket.description ?? "",
      isDeleting: false,
      isSaving: false,
      labels: ticket.labels ?? [],
      priority: prioritySelectValue(ticket.priority),
      status: ticket.boardStatus,
      title: ticket.title,
      tshirt: estimateToTshirt(ticket.estimate),
      ticket,
    });
    try {
      const payload = await runBeads({ action: "show", issueId: ticket.id });
      const issue = normalizeBeadsPayload<BeadsIssue>(payload, ticket);
      const mergedIssue = allIssues.find((candidate) => candidate.id === ticket.id) ?? issue;
      const nextTicket: BoardTicket = {
        ...ticket,
        ...issue,
        ...mergedIssue,
        boardStatus: beadsStatusToBoardStatus(issue.status ?? ticket.status),
        displayId: ticket.displayId,
      };
      setDetail({
        blockedByIds: getBlockedByIds(mergedIssue),
        blockingIds: getBlockingIds(ticket.id, allIssues),
        comment: "",
        description: nextTicket.description ?? "",
        isDeleting: false,
        isSaving: false,
        labels: nextTicket.labels ?? [],
        priority: prioritySelectValue(nextTicket.priority),
        status: nextTicket.boardStatus,
        title: nextTicket.title,
        tshirt: estimateToTshirt(nextTicket.estimate),
        ticket: nextTicket,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load the ticket.");
    }
  };

  const moveTicket = async (ticketId: string, statusKey: BoardStatusKey) => {
    const column = BOARD_COLUMNS.find((candidate) => candidate.key === statusKey);
    const ticket = tickets.find((candidate) => candidate.id === ticketId);
    if (!column || !ticket || ticket.boardStatus === statusKey) {
      return;
    }
    setTickets((current) =>
      current.map((candidate) =>
        candidate.id === ticketId
          ? { ...candidate, boardStatus: statusKey, status: column.beadsStatus }
          : candidate,
      ),
    );
    try {
      await runBeads({
        action: "updateStatus",
        issueId: ticketId,
        status: column.beadsStatus,
      });
      await loadTickets({ includeLabels: false, mode: "mutation" });
    } catch (error) {
      setTickets((current) =>
        current.map((candidate) => (candidate.id === ticketId ? ticket : candidate)),
      );
      setErrorMessage(error instanceof Error ? error.message : "Could not move the ticket.");
    }
  };

  const handleDragEnd: ComponentProps<typeof DragDropProvider>["onDragEnd"] = (event) => {
    if (event.canceled) {
      return;
    }
    const ticketId = String(event.operation.source?.id ?? "");
    const statusKey = event.operation.target?.id as BoardStatusKey | undefined;
    if (ticketId && statusKey) {
      void moveTicket(ticketId, statusKey);
    }
  };

  const syncDependencies = async (issueId: string, blockedByIds: string[], blockingIds: string[]) => {
    const issue = allIssues.find((candidate) => candidate.id === issueId);
    const currentBlockedBy = issue ? getBlockedByIds(issue) : [];
    const currentBlocking = issue ? getBlockingIds(issueId, allIssues) : [];
    for (const dependencyId of currentBlockedBy.filter((id) => !blockedByIds.includes(id))) {
      await runBeads({ action: "depRemove", dependsOnId: dependencyId, issueId });
    }
    for (const dependencyId of blockedByIds.filter((id) => !currentBlockedBy.includes(id))) {
      await runBeads({ action: "depAdd", dependsOnId: dependencyId, issueId, depType: "blocks" });
    }
    for (const dependentId of currentBlocking.filter((id) => !blockingIds.includes(id))) {
      await runBeads({ action: "depRemove", dependsOnId: issueId, issueId: dependentId });
    }
    for (const dependentId of blockingIds.filter((id) => !currentBlocking.includes(id))) {
      await runBeads({ action: "depAdd", dependsOnId: issueId, issueId: dependentId, depType: "blocks" });
    }
  };

  const saveTicketDetail = async () => {
    if (!detail.ticket) {
      return;
    }
    setDetail((current) => ({ ...current, isSaving: true }));
    try {
      const trimmedComment = detail.comment.trim();
      await runBeads({
        action: "updateTitle",
        issueId: detail.ticket.id,
        title: detail.title.trim(),
      });
      await runBeads({
        action: "updateDescription",
        description: detail.description,
        issueId: detail.ticket.id,
      });
      await runBeads({
        action: "updatePriority",
        issueId: detail.ticket.id,
        priority: detail.priority,
      });
      const estimate = tshirtToEstimate(detail.tshirt);
      if (estimate !== undefined) {
        await runBeads({
          action: "updateEstimate",
          estimate,
          issueId: detail.ticket.id,
        });
      }
      if (detail.labels.length > 0) {
        await runBeads({
          action: "setLabels",
          issueId: detail.ticket.id,
          labels: detail.labels,
        });
      }
      await syncDependencies(detail.ticket.id, detail.blockedByIds, detail.blockingIds);
      if (detail.status !== detail.ticket.boardStatus) {
        await runBeads({
          action: "updateStatus",
          issueId: detail.ticket.id,
          status: boardStatusBeadsValue(detail.status),
        });
      }
      if (trimmedComment) {
        await runBeads({
          action: "addComment",
          comment: trimmedComment,
          issueId: detail.ticket.id,
        });
      }
      setDeleteConfirmingTicketId("");
      setDetail(createEmptyDetailDraft());
      await loadTickets({ includeLabels: true, mode: "mutation" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save the ticket.");
      setDetail((current) => ({ ...current, isSaving: false }));
    }
  };

  const createTicket = async (options: { startAfterCreate?: boolean } = {}) => {
    if (isCreating) {
      return;
    }
    const startAfterCreate = options.startAfterCreate === true;
    const startLocation = newTicketStartLocation;
    const draft = {
      ...newTicket,
      blockedByIds: [...newTicket.blockedByIds],
      blockingIds: [...newTicket.blockingIds],
      labels: [...newTicket.labels],
    };
    const prompt = draft.description.trim();
    if (!prompt) {
      return;
    }
    setCreateAction(startAfterCreate ? "createStart" : "create");
    logProjectBoardDebug("projectBoard.createTicket.started", {
      blockedByCount: draft.blockedByIds.length,
      blockingCount: draft.blockingIds.length,
      hasRequestedTitle: Boolean(draft.title.trim()),
      labelCount: draft.labels.length,
      promptLength: prompt.length,
      startAfterCreate,
      startLocation,
    });
    try {
      const requestedTitle = draft.title.trim();
      const shouldGenerateTitle = !requestedTitle;
      const title = shouldGenerateTitle ? PROJECT_BOARD_GENERATING_TITLE : requestedTitle;
      let shouldStartCreatedTicket = startAfterCreate;
      const estimate = tshirtToEstimate(draft.tshirt);
      const promptAgentId = selectedAgentId || conversationState.defaultAgentId;
      const promptAgent = conversationState.agents.find((agent) => agent.agentId === promptAgentId);
      const createdPayload = await runBeads({
        action: "create",
        description: prompt,
        dependsOnId: draft.blockedByIds[0],
        estimate,
        labels: draft.labels,
        priority: draft.priority,
        title,
      });
      const created = normalizeBeadsPayload<BeadsIssue | BeadsIssue[]>(createdPayload, []);
      let createdIssue = Array.isArray(created) ? created[0] : created;
      logProjectBoardDebug("projectBoard.createTicket.beadCreated", {
        beadId: createdIssue?.id ?? "",
        shouldGenerateTitle,
        startAfterCreate,
      });
      if (createdIssue?.id) {
        await syncDependencies(createdIssue.id, draft.blockedByIds, draft.blockingIds);
        if (draft.labels.length > 0) {
          await runBeads({
            action: "setLabels",
            issueId: createdIssue.id,
            labels: draft.labels,
          });
        }
      }
      if (shouldGenerateTitle && createdIssue?.id) {
        try {
          logProjectBoardDebug("projectBoard.createTicket.titleGeneration.started", {
            beadId: createdIssue.id,
            startAfterCreate,
          });
          const generated = normalizeBeadsPayload<{ title?: string }>(
            await runBeads({
              action: "generateTitle",
              agentCommand: promptAgent?.command,
              agentId: promptAgentId,
              prompt,
            }),
            {},
          );
          const generatedTitle = generated.title?.trim();
          if (!generatedTitle) {
            throw new Error("Prompt-agent title generation returned an empty title.");
          }
          await runBeads({
            action: "updateTitle",
            issueId: createdIssue.id,
            title: generatedTitle,
          });
          createdIssue = { ...createdIssue, title: generatedTitle };
          logProjectBoardDebug("projectBoard.createTicket.titleGeneration.completed", {
            beadId: createdIssue.id,
            generatedTitleLength: generatedTitle.length,
            startAfterCreate,
          });
        } catch (error) {
          logProjectBoardDebug("projectBoard.createTicket.titleGeneration.failed", {
            beadId: createdIssue.id,
            error: error instanceof Error ? error.message : String(error),
            startAfterCreate,
          });
          setErrorMessage(error instanceof Error ? error.message : "Could not generate the ticket title.");
          if (startAfterCreate) {
            shouldStartCreatedTicket = false;
          }
        }
      }
      setNewTicket(createEmptyTicketFormDraft());
      setNewTicketStartLocation("currentProject");
      setNewTicketOpen(false);
      const refreshedPayload = await runBeads({ action: "listIssues" });
      const refreshedIssues = normalizeBeadsPayload<BeadsIssue[]>(
        refreshedPayload,
        Array.isArray(refreshedPayload) ? refreshedPayload : [],
      );
      const refreshedTickets = toBoardTickets(refreshedIssues, displayKey);
      setAllIssues(refreshedIssues);
      setTickets(refreshedTickets);
      await loadTickets({ includeLabels: true, mode: "mutation" });
      if (shouldStartCreatedTicket && createdIssue?.id) {
        const createdTicket = refreshedTickets.find((ticket) => ticket.id === createdIssue.id);
        if (!createdTicket) {
          throw new Error("Created ticket was not found after refresh.");
        }
        logProjectBoardDebug("projectBoard.createTicket.startAfterCreate.requested", {
          beadId: createdTicket.id,
          displayId: createdTicket.displayId,
          startLocation,
        });
        const didStart = await startTicketWork(createdTicket, { startLocation });
        if (!didStart) {
          return;
        }
      }
      logProjectBoardDebug("projectBoard.createTicket.completed", {
        beadId: createdIssue?.id ?? "",
        startAfterCreate,
        startLocation,
      });
    } catch (error) {
      logProjectBoardDebug("projectBoard.createTicket.failed", {
        error: error instanceof Error ? error.message : String(error),
        startAfterCreate,
        startLocation,
      });
      setErrorMessage(error instanceof Error ? error.message : "Could not create the ticket.");
    } finally {
      setCreateAction(undefined);
    }
  };

  const deleteTicket = async () => {
    if (!detail.ticket || detail.isDeleting) {
      return;
    }
    const ticket = detail.ticket;
    setDetail((current) => ({ ...current, isDeleting: true }));
    setTickets((current) => current.filter((candidate) => candidate.id !== ticket.id));
    try {
      await runBeads({ action: "delete", issueId: ticket.id });
      setDeleteConfirmingTicketId("");
      setDetail(createEmptyDetailDraft());
      await loadTickets({ includeLabels: true, mode: "mutation" });
    } catch (error) {
      setTickets((current) =>
        current.some((candidate) => candidate.id === ticket.id) ? current : [...current, ticket],
      );
      setErrorMessage(error instanceof Error ? error.message : "Could not delete the ticket.");
      setDetail((current) => ({ ...current, isDeleting: false }));
    }
  };

  const startTicketWork = async (
    ticket: BoardTicket | undefined = detail.ticket,
    options: { startLocation?: ProjectBoardStartLocation } = {},
  ) => {
    if (!ticket) {
      return false;
    }
    const startLocation = options.startLocation ?? "currentProject";
    setConversationAction({ beadId: ticket.id, kind: "start" });
    logProjectBoardDebug("projectBoard.createStart.startWork.requested", {
      agentId: selectedAgentId || conversationState.defaultAgentId || "",
      beadId: ticket.id,
      displayId: ticket.displayId,
      startLocation,
    });
    try {
      const prompt = buildAgentWorkPrompt(ticket);
      const response = await sendProjectBoardRequest({
        action: "startWork",
        agentId: selectedAgentId || conversationState.defaultAgentId,
        beadDisplayId: ticket.displayId,
        beadId: ticket.id,
        projectId,
        projectPath,
        prompt,
        startLocation,
        ticketTitle: ticket.title,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not start ticket work.");
      }
      if (response.payload) {
        setConversationState(response.payload);
      }
      await runBeads({
        action: "updateStatus",
        issueId: ticket.id,
        status: "in_progress",
      });
      setErrorMessage("");
      logProjectBoardDebug("projectBoard.createStart.startWork.completed", {
        beadId: ticket.id,
        startLocation,
      });
      await loadTickets({ includeLabels: false, mode: "mutation" });
      return true;
    } catch (error) {
      logProjectBoardDebug("projectBoard.createStart.startWork.failed", {
        beadId: ticket.id,
        error: error instanceof Error ? error.message : String(error),
        startLocation,
      });
      setErrorMessage(error instanceof Error ? error.message : "Could not start ticket work.");
      return false;
    } finally {
      setConversationAction((current) =>
        current?.kind === "start" && current.beadId === ticket.id ? undefined : current,
      );
    }
  };

  const associateFocusedSession = async () => {
    if (!detail.ticket) {
      return;
    }
    const ticket = detail.ticket;
    setConversationAction({ beadId: ticket.id, kind: "associate" });
    try {
      const response = await sendProjectBoardRequest({
        action: "associateFocusedSession",
        beadDisplayId: ticket.displayId,
        beadId: ticket.id,
        projectId,
        projectPath,
        ticketTitle: ticket.title,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not associate the focused session.");
      }
      if (response.payload) {
        setConversationState(response.payload);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not associate the focused session.");
    } finally {
      setConversationAction((current) =>
        current?.kind === "associate" && current.beadId === ticket.id ? undefined : current,
      );
    }
  };

  const jumpToConversation = async (link: ProjectBoardConversationLinkView) => {
    setConversationAction({ kind: "jump", linkId: link.id });
    try {
      const response = await sendProjectBoardRequest({
        action: "jumpToConversation",
        beadId: link.beadId,
        projectId,
        projectPath,
        sessionId: link.ghostexSessionId,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not jump to the linked conversation.");
      }
      if (response.payload) {
        setConversationState(response.payload);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not jump to the linked conversation.");
    } finally {
      setConversationAction((current) =>
        current?.kind === "jump" && current.linkId === link.id ? undefined : current,
      );
    }
  };

  const unlinkConversation = async (link: ProjectBoardConversationLinkView) => {
    setConversationAction({ kind: "unlink", linkId: link.id });
    try {
      const response = await sendProjectBoardRequest({
        action: "unlinkConversation",
        beadId: link.beadId,
        projectId,
        projectPath,
        sessionId: link.ghostexSessionId,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not unlink the conversation.");
      }
      if (response.payload) {
        setConversationState(response.payload);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not unlink the conversation.");
    } finally {
      setConversationAction((current) =>
        current?.kind === "unlink" && current.linkId === link.id ? undefined : current,
      );
    }
  };

  const openNewAutomationDialog = () => {
    void loadAutomationConversationState(automationState.projectId);
    setAutomationDraft(
      createAutomationDraft({
        agentId: automationState.defaultAgentId || automationState.agents[0]?.agentId || "",
        executionKind: automationState.projectCanUseWorktrees ? "worktree" : "local",
        projectId: automationState.projectId,
      }),
    );
    setAutomationDialogOpen(true);
  };

  const openEditAutomationDialog = (automation: AutomationDefinition) => {
    void loadAutomationConversationState(automation.projectIds[0] ?? automationState.projectId);
    setAutomationDraft(createAutomationDraftFromDefinition(automation));
    setAutomationDialogOpen(true);
  };

  const saveAutomation = async () => {
    const definition = createAutomationDefinitionFromDraft(automationDraft, {
      fallbackAgentId: automationState.defaultAgentId || automationState.agents[0]?.agentId || "",
      projectId: automationDraft.projectId || automationState.projectId || projectId,
    });
    if (!definition) {
      setErrorMessage("Name, agent, prompt, and schedule are required.");
      return;
    }
    if (definition.executionMode.kind === "worktree" && !automationDraftCanUseWorktrees) {
      setErrorMessage(automationDraftWorktreeUnavailableReason || "Worktree mode is unavailable for this project.");
      return;
    }
    setAutomationActionId(definition.id);
    try {
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationSave",
        payloadJson: JSON.stringify(definition),
        projectId: definition.projectIds[0] ?? projectId,
        projectPath: automationDraftProject?.path ?? projectPath,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not save automation.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
      }
      setAutomationDialogOpen(false);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save automation.");
    } finally {
      setAutomationActionId("");
    }
  };

  const deleteAutomation = async (automation: AutomationDefinition) => {
    setAutomationActionId(automation.id);
    try {
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationDelete",
        projectId: automationState.projectId || projectId,
        projectPath: automationState.projectPath || projectPath,
        sessionId: automation.id,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not delete automation.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not delete automation.");
    } finally {
      setAutomationActionId("");
    }
  };

  const setAutomationEnabled = async (automation: AutomationDefinition, enabled: boolean) => {
    setAutomationActionId(automation.id);
    try {
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationSetEnabled",
        payloadJson: JSON.stringify({ enabled }),
        projectId: automationState.projectId || projectId,
        projectPath: automationState.projectPath || projectPath,
        sessionId: automation.id,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not update automation.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update automation.");
    } finally {
      setAutomationActionId("");
    }
  };

  const runAutomationNow = async (automation: AutomationDefinition) => {
    setAutomationActionId(automation.id);
    try {
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationRunNow",
        projectId: automationState.projectId || projectId,
        projectPath: automationState.projectPath || projectPath,
        sessionId: automation.id,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not run automation.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
      }
      setActiveSurfaceTab("runs");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not run automation.");
    } finally {
      setAutomationActionId("");
    }
  };

  const archiveAutomationRun = async (run: AutomationRun) => {
    setAutomationActionId(run.id);
    try {
      const removeWorktree =
        Boolean(run.worktree) &&
        window.confirm(
          `Archive this run and remove its worktree?\n\nPath: ${run.worktree?.path ?? ""}\nBranch: ${run.worktree?.branch ?? ""}`,
        );
      if (removeWorktree) {
        const confirmation = window.prompt(
          `Type the exact worktree path to remove it:\n\n${run.worktree?.path ?? ""}`,
        );
        if (confirmation !== run.worktree?.path) {
          setErrorMessage("Worktree removal was not confirmed. The run was not archived.");
          return;
        }
      }
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationArchiveRun",
        payloadJson: JSON.stringify({ removeWorktree }),
        projectId: automationState.projectId || projectId,
        projectPath: automationState.projectPath || projectPath,
        sessionId: run.id,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not archive automation run.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not archive automation run.");
    } finally {
      setAutomationActionId("");
    }
  };

  const markAutomationRunRead = async (run: AutomationRun) => {
    setAutomationActionId(run.id);
    try {
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationMarkRunRead",
        projectId: automationState.projectId || projectId,
        projectPath: automationState.projectPath || projectPath,
        sessionId: run.id,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not mark automation run read.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not mark automation run read.");
    } finally {
      setAutomationActionId("");
    }
  };

  const openAutomationRunSession = async (run: AutomationRun) => {
    setAutomationActionId(run.id);
    try {
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationOpenRunSession",
        projectId: automationState.projectId || projectId,
        projectPath: automationState.projectPath || projectPath,
        sessionId: run.id,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not open automation session.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not open automation session.");
    } finally {
      setAutomationActionId("");
    }
  };

  const openAutomationRunWorktree = async (run: AutomationRun) => {
    setAutomationActionId(run.id);
    try {
      const response = await sendProjectBoardRequest<ProjectAutomationsBridgeState>({
        action: "automationOpenWorktree",
        projectId: automationState.projectId || projectId,
        projectPath: automationState.projectPath || projectPath,
        sessionId: run.id,
      });
      if (!response.ok) {
        throw new Error(response.error || "Could not open automation worktree.");
      }
      if (response.payload) {
        applyAutomationState(response.payload);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not open automation worktree.");
    } finally {
      setAutomationActionId("");
    }
  };

  const detailConversationLinks = detail.ticket ? (linksByBeadId.get(detail.ticket.id) ?? []) : [];
  const detailPrimaryConversationLink = getPrimaryUsableConversationLink(detailConversationLinks);
  const detailPrimaryActionLabel =
    conversationAction?.kind === "jump" && conversationAction.linkId === detailPrimaryConversationLink?.id
      ? "Opening"
      : detailPrimaryConversationLink
        ? "Go to Session"
        : conversationAction?.kind === "start" && conversationAction.beadId === detail.ticket?.id
          ? "Starting"
          : "Start work";
  const detailPrimaryActionDisabled =
    detail.isDeleting ||
    detail.isSaving ||
    Boolean(conversationAction) ||
    (!detailPrimaryConversationLink && conversationState.agents.length === 0);
  const visibleAutomationRuns = automationState.runs.filter((run) => !run.isArchived);
  const triageActionRunCount = visibleAutomationRuns.filter(isAutomationRunActionableInTriage).length;
  const triageAutomationRuns = selectAutomationRunsForTriage(visibleAutomationRuns);
  const selectedAutomation =
    automationState.automations.find((automation) => automation.id === selectedAutomationId) ??
    automationState.automations[0];
  const selectedTriageRun =
    triageAutomationRuns.find((run) => run.id === selectedAutomationRunId) ?? triageAutomationRuns[0];
  const selectedVisibleRun =
    visibleAutomationRuns.find((run) => run.id === selectedAutomationRunId) ?? visibleAutomationRuns[0];
  const automationDraftProject =
    automationState.projects.find((candidate) => candidate.projectId === automationDraft.projectId) ??
    automationState.projects.find((candidate) => candidate.projectId === automationState.projectId);
  const automationDraftCanUseWorktrees =
    automationDraftProject?.canUseWorktrees ?? automationState.projectCanUseWorktrees;
  const automationDraftWorktreeUnavailableReason =
    automationDraftProject?.worktreeUnavailableReason ?? automationState.worktreeUnavailableReason;

  useEffect(() => {
    if (!newTicketOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      newPromptRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [newTicketOpen]);

  return (
    <main className="project-board-shell">
      <section className="project-board-toolbar">
        <div>
          <p className="project-board-eyebrow">{projectName}</p>
          <h1>Project</h1>
        </div>
        <div className="project-board-toolbar-actions">
          <Button
            aria-label="Refresh project"
            disabled={loadState === "loading"}
            onClick={() => {
              void loadTickets({ includeLabels: true, mode: "manual" });
              void loadConversationState();
              void loadAutomationState();
            }}
            size="icon-sm"
            variant="ghost"
          >
            <IconRefresh />
          </Button>
          {activeSurfaceTab === "board" ? (
            <Button onClick={() => setNewTicketOpen(true)} size="sm" variant="secondary">
              <IconPlus data-icon="inline-start" />
              Ticket
            </Button>
          ) : (
            <Button onClick={openNewAutomationDialog} size="sm" variant="secondary">
              <IconPlus data-icon="inline-start" />
              Automation
            </Button>
          )}
        </div>
      </section>

      <section className="project-board-tabs" aria-label="Project views">
        {[
          ["triage", "Triage"],
          ["automations", "Automations"],
          ["runs", "Runs"],
          ["board", "Board"],
        ].map(([value, label]) => (
          <button
            className="project-board-tab"
            data-active={activeSurfaceTab === value}
            key={value}
            onClick={() => setActiveSurfaceTab(value as ProjectSurfaceTab)}
            type="button"
          >
            {label}
            {value === "triage" && triageActionRunCount > 0 ? (
              <span>{triageActionRunCount}</span>
            ) : null}
          </button>
        ))}
      </section>

      {activeSurfaceTab === "board" ? (
        <section className="project-board-filters" aria-label="Ticket filters">
          <div className="project-board-search">
            <IconSearch aria-hidden="true" />
            <Input
              aria-label="Search tickets"
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Search tickets"
              value={searchQuery}
            />
          </div>
          <Select
            onValueChange={(value) => setStatusFilter(value as BoardStatusKey | "all")}
            value={statusFilter}
          >
            <SelectTrigger aria-label="Filter by status" size="sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {BOARD_COLUMNS.map((column) => (
                <SelectItem key={column.key} value={column.key}>
                  {column.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>
      ) : null}

      {activeSurfaceTab === "triage" ? (
        <section className="project-automation-split">
          <AutomationRunList
            actionId={automationActionId}
            agents={automationState.agents}
            automations={automationState.automations}
            emptyTitle="No automation results need triage"
            onArchive={archiveAutomationRun}
            onMarkRead={markAutomationRunRead}
            onOpenSession={openAutomationRunSession}
            onOpenWorktree={openAutomationRunWorktree}
            onSelect={setSelectedAutomationRunId}
            projectName={automationState.projectName}
            runs={triageAutomationRuns}
            selectedRunId={selectedTriageRun?.id ?? ""}
          />
          <AutomationRunDetail
            actionId={automationActionId}
            agents={automationState.agents}
            automation={selectedTriageRun ? automationState.automations.find((candidate) => candidate.id === selectedTriageRun.automationId) : undefined}
            onArchive={archiveAutomationRun}
            onMarkRead={markAutomationRunRead}
            onOpenSession={openAutomationRunSession}
            onOpenWorktree={openAutomationRunWorktree}
            projectName={automationState.projectName}
            run={selectedTriageRun}
          />
        </section>
      ) : null}

      {activeSurfaceTab === "automations" ? (
        <section className="project-automation-split">
          <AutomationDefinitionList
            actionId={automationActionId}
            agents={automationState.agents}
            automations={automationState.automations}
            onDelete={deleteAutomation}
            onEdit={openEditAutomationDialog}
            onRunNow={runAutomationNow}
            onSelect={setSelectedAutomationId}
            onSetEnabled={setAutomationEnabled}
            runs={automationState.runs}
            selectedAutomationId={selectedAutomation?.id ?? ""}
          />
          <AutomationDefinitionDetail
            actionId={automationActionId}
            agents={automationState.agents}
            automation={selectedAutomation}
            onDelete={deleteAutomation}
            onEdit={openEditAutomationDialog}
            onRunNow={runAutomationNow}
            onSetEnabled={setAutomationEnabled}
            runs={automationState.runs}
          />
        </section>
      ) : null}

      {activeSurfaceTab === "runs" ? (
        <section className="project-automation-split">
          <AutomationRunList
            actionId={automationActionId}
            agents={automationState.agents}
            automations={automationState.automations}
            emptyTitle="No automation runs yet"
            onArchive={archiveAutomationRun}
            onMarkRead={markAutomationRunRead}
            onOpenSession={openAutomationRunSession}
            onOpenWorktree={openAutomationRunWorktree}
            onSelect={setSelectedAutomationRunId}
            projectName={automationState.projectName}
            runs={visibleAutomationRuns}
            selectedRunId={selectedVisibleRun?.id ?? ""}
          />
          <AutomationRunDetail
            actionId={automationActionId}
            agents={automationState.agents}
            automation={selectedVisibleRun ? automationState.automations.find((candidate) => candidate.id === selectedVisibleRun.automationId) : undefined}
            onArchive={archiveAutomationRun}
            onMarkRead={markAutomationRunRead}
            onOpenSession={openAutomationRunSession}
            onOpenWorktree={openAutomationRunWorktree}
            projectName={automationState.projectName}
            run={selectedVisibleRun}
          />
        </section>
      ) : null}

      {activeSurfaceTab === "board" ? (
        <>
          {errorMessage ? <ProjectBoardNotice message={errorMessage} /> : null}
          <DragDropProvider onDragEnd={handleDragEnd}>
            <section className="project-board-lanes" aria-label="Project issue board">
              {BOARD_COLUMNS.map((column) => (
                <BoardLane
                  column={column}
                  conversationAction={conversationAction}
                  key={column.key}
                  linksByBeadId={linksByBeadId}
                  onJumpToConversation={jumpToConversation}
                  onOpenTicket={openTicket}
                  tickets={ticketsByColumn[column.key]}
                />
              ))}
            </section>
          </DragDropProvider>
        </>
      ) : errorMessage ? (
        <ProjectBoardNotice message={errorMessage} />
      ) : null}

      <Dialog open={automationDialogOpen} onOpenChange={setAutomationDialogOpen}>
        <DialogContent className="project-automation-dialog">
          <DialogHeader>
            <DialogTitle>{automationDraft.id ? "Edit automation" : "Create automation"}</DialogTitle>
            <DialogDescription>{projectName}</DialogDescription>
          </DialogHeader>
          <div className="project-automation-form">
            <label>
              <span>Name</span>
              <Input
                onChange={(event) =>
                  setAutomationDraft((current) => ({ ...current, name: event.currentTarget.value }))
                }
                value={automationDraft.name}
              />
            </label>
            <label>
              <span>Agent</span>
              <Select
                onValueChange={(value) =>
                  setAutomationDraft((current) => ({ ...current, agentId: value }))
                }
                value={automationDraft.agentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose agent" />
                </SelectTrigger>
                <SelectContent>
                  {automationState.agents.map((agent) => (
                    <SelectItem key={agent.agentId} value={agent.agentId}>
                      {agent.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label>
              <span>Project</span>
              <Select
                onValueChange={(value) => {
                  const targetProject = automationState.projects.find((candidate) => candidate.projectId === value);
                  setAutomationTargetProjectId(value);
                  setAutomationDraft((current) => ({
                    ...current,
                    executionKind:
                      current.executionKind === "worktree" && targetProject?.canUseWorktrees === false
                        ? "local"
                        : current.executionKind,
                    projectId: value,
                    threadSessionId: current.projectId === value ? current.threadSessionId : "",
                  }));
                  void loadAutomationState(value);
                  void loadAutomationConversationState(value);
                }}
                value={automationDraft.projectId || automationState.projectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose project" />
                </SelectTrigger>
                <SelectContent>
                  {(automationState.projects.length > 0
                    ? automationState.projects
                    : [
                        {
                          canUseWorktrees: automationState.projectCanUseWorktrees,
                          label: automationState.projectName || projectName,
                          path: automationState.projectPath || projectPath,
                          projectId: automationState.projectId || projectId,
                          worktreeUnavailableReason: automationState.worktreeUnavailableReason,
                        },
                      ]
                  ).map((targetProject) => (
                    <SelectItem key={targetProject.projectId} value={targetProject.projectId}>
                      {targetProject.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label>
              <span>Schedule</span>
              <Select
                onValueChange={(value) =>
                  setAutomationDraft((current) => ({
                    ...current,
                    schedulePreset: value as AutomationDraft["schedulePreset"],
                  }))
                }
                value={automationDraft.schedulePreset}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15m">Every 15 minutes</SelectItem>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="cron">Custom cron</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {automationDraft.schedulePreset === "cron" ? (
              <label>
                <span>Cron</span>
                <Input
                  onChange={(event) =>
                    setAutomationDraft((current) => ({
                      ...current,
                      cronExpression: event.currentTarget.value,
                    }))
                  }
                  placeholder="*/15 * * * *"
                  value={automationDraft.cronExpression}
                />
              </label>
            ) : null}
            {automationDraft.schedulePreset === "daily" || automationDraft.schedulePreset === "weekly" ? (
              <label>
                <span>Time</span>
                <Input
                  onChange={(event) =>
                    setAutomationDraft((current) => ({
                      ...current,
                      scheduleTime: event.currentTarget.value,
                    }))
                  }
                  type="time"
                  value={automationDraft.scheduleTime}
                />
              </label>
            ) : null}
            {automationDraft.schedulePreset === "weekly" ? (
              <label>
                <span>Day</span>
                <Select
                  onValueChange={(value) =>
                    setAutomationDraft((current) => ({ ...current, weeklyDay: value }))
                  }
                  value={automationDraft.weeklyDay}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                      (day, index) => (
                        <SelectItem key={day} value={String(index)}>
                          {day}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </label>
            ) : null}
            <div className="project-automation-segmented" role="group" aria-label="Execution mode">
              {[
                ["worktree", "Worktree"],
                ["local", "Local"],
                ["thread", "Thread"],
              ].map(([value, label]) => {
                const disabled = value === "worktree" && !automationDraftCanUseWorktrees;
                return (
                  <button
                    data-active={automationDraft.executionKind === value}
                    disabled={disabled}
                    key={value}
                    onClick={() =>
                      setAutomationDraft((current) => ({
                        ...current,
                        executionKind: value as AutomationExecutionMode["kind"],
                      }))
                    }
                    title={disabled ? automationDraftWorktreeUnavailableReason : undefined}
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {!automationDraftCanUseWorktrees && automationDraftWorktreeUnavailableReason ? (
              <p className="project-automation-inline-note">{automationDraftWorktreeUnavailableReason}</p>
            ) : null}
            {automationDraft.executionKind === "worktree" ? (
              <label>
                <span>Setup command</span>
                <Input
                  onChange={(event) =>
                    setAutomationDraft((current) => ({
                      ...current,
                      setupCommand: event.currentTarget.value,
                    }))
                  }
                  placeholder="Use project worktree command"
                  value={automationDraft.setupCommand}
                />
              </label>
            ) : null}
            {automationDraft.executionKind === "thread" ? (
              <>
                <label>
                  <span>Session</span>
                  <Select
                    onValueChange={(value) =>
                      setAutomationDraft((current) => ({ ...current, threadSessionId: value }))
                    }
                    value={automationDraft.threadSessionId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose session" />
                    </SelectTrigger>
                    <SelectContent>
                      {automationConversationState.sessions.map((session) => (
                        <SelectItem key={session.sessionId} value={session.sessionId}>
                          {session.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  <span>Expires</span>
                  <Input
                    onChange={(event) =>
                      setAutomationDraft((current) => ({
                        ...current,
                        expiresAt: event.currentTarget.value,
                      }))
                    }
                    type="datetime-local"
                    value={automationDraft.expiresAt}
                  />
                </label>
              </>
            ) : null}
            <label className="project-automation-prompt-field">
              <span>Prompt</span>
              <Textarea
                onChange={(event) =>
                  setAutomationDraft((current) => ({ ...current, prompt: event.currentTarget.value }))
                }
                value={automationDraft.prompt}
              />
            </label>
            <label className="project-automation-enabled">
              <input
                checked={automationDraft.enabled}
                onChange={(event) =>
                  setAutomationDraft((current) => ({ ...current, enabled: event.currentTarget.checked }))
                }
                type="checkbox"
              />
              <span>Enabled</span>
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => setAutomationDialogOpen(false)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={Boolean(automationActionId)} onClick={saveAutomation} type="button">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(detail.ticket)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmingTicketId("");
            setDetail(createEmptyDetailDraft());
          }
        }}
      >
        <DialogContent className="project-ticket-dialog">
          <DialogHeader>
            <DialogTitle>Edit ticket</DialogTitle>
            <DialogDescription>
              {detail.ticket?.displayId} · {detail.ticket?.id}
            </DialogDescription>
          </DialogHeader>
          <div
            className="project-ticket-dialog-body"
            onKeyDown={(event) => handleCmdEnter(event, () => void saveTicketDetail())}
          >
            <TicketMetaFields
              blockedByIds={detail.blockedByIds}
              blockingIds={detail.blockingIds}
              knownLabels={knownLabels}
              labels={detail.labels}
              onBlockedByChange={(blockedByIds) =>
                setDetail((current) => ({ ...current, blockedByIds }))
              }
              onBlockingChange={(blockingIds) =>
                setDetail((current) => ({ ...current, blockingIds }))
              }
              onLabelsChange={(labels) => setDetail((current) => ({ ...current, labels }))}
              onPriorityChange={(priority) => setDetail((current) => ({ ...current, priority }))}
              onStatusChange={(status) => setDetail((current) => ({ ...current, status }))}
              onTshirtChange={(tshirt) => setDetail((current) => ({ ...current, tshirt }))}
              priority={detail.priority}
              status={detail.status}
              ticketOptions={ticketOptions.filter((option) => option.id !== detail.ticket?.id)}
              tshirt={detail.tshirt}
            />
            <label className="project-ticket-field">
              <span>Title</span>
              <Textarea
                className="project-ticket-title-input"
                onChange={(event) =>
                  setDetail((current) => ({ ...current, title: event.target.value }))
                }
                value={detail.title}
              />
            </label>
            <label className="project-ticket-field">
              <span>Prompt</span>
              <Textarea
                className="project-ticket-prompt-input"
                onChange={(event) =>
                  setDetail((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                onPaste={(event) => {
                  if (!hasProjectBoardImagePastePayload(event.clipboardData)) {
                    return;
                  }
                  event.preventDefault();
                  const selectionStart = event.currentTarget.selectionStart;
                  const selectionEnd = event.currentTarget.selectionEnd;
                  void sendProjectBoardImageRequest({ action: "pasteImage" }).then((response) => {
                    if (!response.imagePath) {
                      setErrorMessage(response.error || "Clipboard image could not be converted to a path.");
                      return;
                    }
                    setDetail((current) => ({
                      ...current,
                      description: appendImageMarkdownToDescription(
                        current.description,
                        response.imagePath ?? "",
                        selectionStart,
                        selectionEnd,
                      ),
                    }));
                  }).catch((error) => {
                    setErrorMessage(error instanceof Error ? error.message : "Clipboard image paste failed.");
                  });
                }}
                placeholder="Write the full prompt for this ticket."
                value={detail.description}
              />
            </label>
            <ImagePreviewStrip
              description={detail.description}
              imagePreviewDataUrls={imagePreviewDataUrls}
              onRemove={(image) =>
                setDetail((current) => ({
                  ...current,
                  description: removeDescriptionImageReference(current.description, image.id),
                }))
              }
            />
            <DependencySummary
              blockedByIds={detail.blockedByIds}
              blockingIds={detail.blockingIds}
              tickets={tickets}
            />
            {detail.ticket ? (
              <ConversationSection
                agents={conversationState.agents}
                action={conversationAction}
                focusedSessionId={conversationState.focusedTerminalSessionId}
                links={detailConversationLinks}
                onAssociateFocusedSession={() => void associateFocusedSession()}
                onJumpToConversation={(link) => void jumpToConversation(link)}
                onSelectedAgentChange={setSelectedAgentId}
                onUnlinkConversation={(link) => void unlinkConversation(link)}
                selectedAgentId={selectedAgentId}
              />
            ) : null}
            <section className="project-ticket-comments" aria-label="Comments">
              <div className="project-ticket-section-title">Comments</div>
              <ScrollArea className="project-ticket-comment-list">
                {detail.ticket?.comments?.length ? (
                  detail.ticket.comments.map((comment, index) => (
                    <article className="project-ticket-comment" key={`${comment.created_at}-${index}`}>
                      <div>
                        <strong>{comment.author || "Comment"}</strong>
                        <span>{formatShortDate(comment.created_at)}</span>
                      </div>
                      <p>{comment.text}</p>
                    </article>
                  ))
                ) : (
                  <p className="project-ticket-empty">No comments yet.</p>
                )}
              </ScrollArea>
            </section>
            <label className="project-ticket-field">
              <span>Add comment</span>
              <Textarea
                onChange={(event) =>
                  setDetail((current) => ({ ...current, comment: event.target.value }))
                }
                placeholder="Add a note for the team."
                value={detail.comment}
              />
            </label>
          </div>
          <DialogFooter className="project-ticket-dialog-footer">
            <Button
              disabled={detail.isDeleting || detail.isSaving}
              onClick={() => {
                if (deleteConfirmingTicketId === detail.ticket?.id) {
                  void deleteTicket();
                  return;
                }
                setDeleteConfirmingTicketId(detail.ticket?.id ?? "");
              }}
              type="button"
              variant="destructive"
            >
              <IconTrash data-icon="inline-start" />
              {deleteConfirmingTicketId === detail.ticket?.id
                ? detail.isDeleting
                  ? "Deleting"
                  : "Confirm delete"
                : "Delete"}
            </Button>
            <div className="project-ticket-dialog-primary-actions">
              <Button
                disabled={detailPrimaryActionDisabled}
                onClick={() =>
                  detailPrimaryConversationLink
                    ? void jumpToConversation(detailPrimaryConversationLink)
                    : void startTicketWork()
                }
                type="button"
                variant="outline"
              >
                {detailPrimaryConversationLink ? (
                  <IconExternalLink data-icon="inline-start" />
                ) : (
                  <IconLink data-icon="inline-start" />
                )}
                {detailPrimaryActionLabel}
              </Button>
              <Button disabled={detail.isDeleting || detail.isSaving} onClick={() => void saveTicketDetail()}>
                {detail.isSaving ? "Saving" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newTicketOpen}
        onOpenChange={(open) => {
          setNewTicketOpen(open);
          if (!open) {
            setNewTicketStartLocation("currentProject");
          }
        }}
      >
        <DialogContent className="project-ticket-dialog">
          <DialogHeader>
            <DialogTitle>New Ticket</DialogTitle>
            <DialogDescription>
              Leave the title empty to auto-generate it from the prompt. Creates in Todo.
            </DialogDescription>
          </DialogHeader>
          <div
            className="project-ticket-dialog-body"
            onKeyDown={(event) => handleCmdEnter(event, () => void createTicket())}
          >
            <TicketMetaFields
              blockedByIds={newTicket.blockedByIds}
              blockingIds={newTicket.blockingIds}
              knownLabels={knownLabels}
              labels={newTicket.labels}
              onBlockedByChange={(blockedByIds) =>
                setNewTicket((current) => ({ ...current, blockedByIds }))
              }
              onBlockingChange={(blockingIds) =>
                setNewTicket((current) => ({ ...current, blockingIds }))
              }
              onLabelsChange={(labels) => setNewTicket((current) => ({ ...current, labels }))}
              onPriorityChange={(priority) => setNewTicket((current) => ({ ...current, priority }))}
              onStatusChange={() => undefined}
              onTshirtChange={(tshirt) => setNewTicket((current) => ({ ...current, tshirt }))}
              priority={newTicket.priority}
              status="todo"
              showStatus={false}
              ticketOptions={ticketOptions}
              tshirt={newTicket.tshirt}
            />
            <label className="project-ticket-field">
              <span>Title</span>
              <Textarea
                className="project-ticket-title-input"
                onChange={(event) => setNewTicket((current) => ({ ...current, title: event.target.value }))}
                placeholder="Auto-generated from prompt when left empty"
                value={newTicket.title}
              />
            </label>
            <label className="project-ticket-field">
              <span>Prompt</span>
              <Textarea
                className="project-ticket-prompt-input"
                onChange={(event) =>
                  setNewTicket((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                onPaste={(event) => {
                  if (!hasProjectBoardImagePastePayload(event.clipboardData)) {
                    return;
                  }
                  event.preventDefault();
                  const selectionStart = event.currentTarget.selectionStart;
                  const selectionEnd = event.currentTarget.selectionEnd;
                  void sendProjectBoardImageRequest({ action: "pasteImage" }).then((response) => {
                    if (!response.imagePath) {
                      setErrorMessage(response.error || "Clipboard image could not be converted to a path.");
                      return;
                    }
                    setNewTicket((current) => ({
                      ...current,
                      description: appendImageMarkdownToDescription(
                        current.description,
                        response.imagePath ?? "",
                        selectionStart,
                        selectionEnd,
                      ),
                    }));
                  }).catch((error) => {
                    setErrorMessage(error instanceof Error ? error.message : "Clipboard image paste failed.");
                  });
                }}
                placeholder="Write the full prompt for this ticket."
                ref={newPromptRef}
                value={newTicket.description}
              />
            </label>
            <ImagePreviewStrip
              description={newTicket.description}
              imagePreviewDataUrls={imagePreviewDataUrls}
              onRemove={(image) =>
                setNewTicket((current) => ({
                  ...current,
                  description: removeDescriptionImageReference(current.description, image.id),
                }))
              }
            />
          </div>
          <DialogFooter className="project-ticket-create-footer">
            <section className="project-ticket-create-start" aria-label="Create and start options">
              <div className="project-ticket-section-title">Start work</div>
              <div className="project-ticket-create-start-controls">
                <Select
                  disabled={conversationState.agents.length === 0 || isCreating}
                  onValueChange={setSelectedAgentId}
                  value={selectedAgentId}
                >
                  <SelectTrigger aria-label="Agent for Create and Start" size="sm">
                    <SelectValue placeholder="Choose agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {conversationState.agents.map((agent) => (
                      <SelectItem key={agent.agentId} value={agent.agentId}>
                        {agent.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="project-ticket-start-location" role="radiogroup" aria-label="Start location">
                  <Button
                    aria-checked={newTicketStartLocation === "currentProject"}
                    disabled={isCreating}
                    onClick={() => setNewTicketStartLocation("currentProject")}
                    role="radio"
                    size="sm"
                    type="button"
                    variant={newTicketStartLocation === "currentProject" ? "secondary" : "outline"}
                  >
                    Current project
                  </Button>
                  <Button
                    aria-checked={newTicketStartLocation === "newWorktree"}
                    disabled={isCreating}
                    onClick={() => setNewTicketStartLocation("newWorktree")}
                    role="radio"
                    size="sm"
                    type="button"
                    variant={newTicketStartLocation === "newWorktree" ? "secondary" : "outline"}
                  >
                    New worktree
                  </Button>
                </div>
              </div>
            </section>
            <div className="project-ticket-create-actions">
              <Button
                disabled={isCreating || !newTicket.description.trim()}
                onClick={() => void createTicket()}
                type="button"
                variant="outline"
              >
                {createAction === "create" ? "Creating" : "Create"}
              </Button>
              <Button
                disabled={
                  isCreating ||
                  !newTicket.description.trim() ||
                  conversationState.agents.length === 0 ||
                  Boolean(conversationAction)
                }
                onClick={() => void createTicket({ startAfterCreate: true })}
                type="button"
              >
                <IconLink data-icon="inline-start" />
                {createAction === "createStart" ? "Creating & Starting" : "Create & Start"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function TicketMetaFields({
  blockedByIds,
  blockingIds,
  knownLabels,
  labels,
  onBlockedByChange,
  onBlockingChange,
  onLabelsChange,
  onPriorityChange,
  onStatusChange,
  onTshirtChange,
  priority,
  showStatus = true,
  status,
  ticketOptions,
  tshirt,
}: {
  blockedByIds: string[];
  blockingIds: string[];
  knownLabels: string[];
  labels: string[];
  onBlockedByChange: (ids: string[]) => void;
  onBlockingChange: (ids: string[]) => void;
  onLabelsChange: (labels: string[]) => void;
  onPriorityChange: (priority: string) => void;
  onStatusChange: (status: BoardStatusKey) => void;
  onTshirtChange: (size: TshirtSize | undefined) => void;
  priority: string;
  showStatus?: boolean;
  status: BoardStatusKey;
  ticketOptions: Array<{ id: string; label: string }>;
  tshirt?: TshirtSize;
}) {
  const [labelDraft, setLabelDraft] = useState("");
  const labelSuggestions = knownLabels.filter((label) => !labels.includes(label));

  return (
    <div className="project-ticket-meta-grid">
      {showStatus ? (
        <label className="project-ticket-field project-ticket-field-inline">
          <span>Status</span>
          <Select onValueChange={(value) => onStatusChange(value as BoardStatusKey)} value={status}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARD_COLUMNS.map((column) => (
                <SelectItem key={column.key} value={column.key}>
                  {column.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}
      <label className="project-ticket-field project-ticket-field-inline">
        <span>Priority</span>
        <Select onValueChange={onPriorityChange} value={priority}>
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="project-ticket-field project-ticket-field-inline">
        <span>T-shirt</span>
        <Select
          onValueChange={(value) => onTshirtChange(value === "none" ? undefined : (value as TshirtSize))}
          value={tshirt ?? "none"}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {TSHIRT_OPTIONS.map((option) => (
              <SelectItem key={option.label} value={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <DependencyPicker
        label="Blocked by"
        onChange={onBlockedByChange}
        selectedIds={blockedByIds}
        ticketOptions={ticketOptions}
      />
      <DependencyPicker
        label="Blocking"
        onChange={onBlockingChange}
        selectedIds={blockingIds}
        ticketOptions={ticketOptions}
      />
      <div className="project-ticket-field project-ticket-labels-field">
        <span>Labels</span>
        <div className="project-ticket-label-list">
          {labels.map((label) => (
            <button
              className="project-ticket-label-chip"
              key={label}
              onClick={() => onLabelsChange(labels.filter((candidate) => candidate !== label))}
              type="button"
            >
              {label}
              <IconX aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="project-ticket-label-editor">
          <Input
            aria-label="Add label"
            list="project-board-label-suggestions"
            onChange={(event) => setLabelDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const next = labelDraft.trim();
                if (next && !labels.includes(next)) {
                  onLabelsChange([...labels, next]);
                }
                setLabelDraft("");
              }
            }}
            placeholder="Add label"
            value={labelDraft}
          />
          <datalist id="project-board-label-suggestions">
            {labelSuggestions.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
          <Button
            onClick={() => {
              const next = labelDraft.trim();
              if (next && !labels.includes(next)) {
                onLabelsChange([...labels, next]);
              }
              setLabelDraft("");
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function DependencyPicker({
  label,
  onChange,
  selectedIds,
  ticketOptions,
}: {
  label: string;
  onChange: (ids: string[]) => void;
  selectedIds: string[];
  ticketOptions: Array<{ id: string; label: string }>;
}) {
  const [draft, setDraft] = useState("");
  const available = ticketOptions.filter((option) => !selectedIds.includes(option.id));
  return (
    <div className="project-ticket-field">
      <span>{label}</span>
      <div className="project-ticket-label-list">
        {selectedIds.map((id) => {
          const ticket = ticketOptions.find((option) => option.id === id);
          return (
            <button
              className="project-ticket-label-chip"
              key={id}
              onClick={() => onChange(selectedIds.filter((candidate) => candidate !== id))}
              type="button"
            >
              {ticket?.label ?? id}
              <IconX aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <Select
        onValueChange={(value) => {
          if (value && !selectedIds.includes(value)) {
            onChange([...selectedIds, value]);
          }
          setDraft("");
        }}
        value={draft}
      >
        <SelectTrigger size="sm">
          <SelectValue placeholder={`Add ${label.toLowerCase()} ticket`} />
        </SelectTrigger>
        <SelectContent>
          {available.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DependencySummary({
  blockedByIds,
  blockingIds,
  tickets,
}: {
  blockedByIds: string[];
  blockingIds: string[];
  tickets: BoardTicket[];
}) {
  if (blockedByIds.length === 0 && blockingIds.length === 0) {
    return null;
  }
  const labelFor = (id: string) => tickets.find((ticket) => ticket.id === id)?.displayId ?? id;
  return (
    <div className="project-ticket-dependencies">
      {blockedByIds.length > 0 ? (
        <p>
          <strong>Blocked by:</strong> {blockedByIds.map(labelFor).join(", ")}
        </p>
      ) : null}
      {blockingIds.length > 0 ? (
        <p>
          <strong>Blocking:</strong> {blockingIds.map(labelFor).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function ImagePreviewStrip({
  description,
  imagePreviewDataUrls,
  onRemove,
}: {
  description: string;
  imagePreviewDataUrls: Record<string, string>;
  onRemove?: (image: DescriptionImageReference) => void;
}) {
  const images = extractPreviewableDescriptionImageReferences(description);
  if (images.length === 0) {
    return null;
  }
  return (
    <div className="project-ticket-image-strip" aria-label="Image previews">
      {images.map((image) => (
        <div className="project-ticket-image-thumb" key={image.id}>
          {imagePreviewDataUrls[image.src] ? (
            <img alt="" src={imagePreviewDataUrls[image.src]} />
          ) : (
            <span aria-hidden="true" />
          )}
          {onRemove ? (
            <button
              aria-label="Remove pasted image"
              className="project-ticket-image-remove"
              onClick={() => onRemove(image)}
              type="button"
            >
              <IconX aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ConversationSection({
  action,
  agents,
  focusedSessionId,
  links,
  onAssociateFocusedSession,
  onJumpToConversation,
  onSelectedAgentChange,
  onUnlinkConversation,
  selectedAgentId,
}: {
  action: ConversationActionState;
  agents: ProjectBoardAgentOption[];
  focusedSessionId?: string;
  links: ProjectBoardConversationLinkView[];
  onAssociateFocusedSession: () => void;
  onJumpToConversation: (link: ProjectBoardConversationLinkView) => void;
  onSelectedAgentChange: (agentId: string) => void;
  onUnlinkConversation: (link: ProjectBoardConversationLinkView) => void;
  selectedAgentId: string;
}) {
  const isAssociating = action?.kind === "associate";
  const hasActiveConversationAction = Boolean(action);
  return (
    <section className="project-ticket-conversations" aria-label="Linked conversations">
      <div className="project-ticket-section-title">Conversation</div>
      <div className="project-ticket-conversation-controls">
        <Select disabled={agents.length === 0} onValueChange={onSelectedAgentChange} value={selectedAgentId}>
          <SelectTrigger aria-label="Agent for Start work" size="sm">
            <SelectValue placeholder="Choose agent" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.agentId} value={agent.agentId}>
                {agent.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={!focusedSessionId || hasActiveConversationAction}
          onClick={onAssociateFocusedSession}
          size="sm"
          type="button"
          variant="outline"
        >
          <IconLink data-icon="inline-start" />
          {isAssociating ? "Associating" : "Associate focused"}
        </Button>
      </div>
      {links.length > 0 ? (
        <TooltipProvider delayDuration={350}>
          <div className="project-ticket-conversation-list">
            {links.map((link) => {
              const label = conversationLinkLabel(link);
              return (
                <div className="project-ticket-conversation-row" key={link.id}>
                  <div className="project-ticket-conversation-main">
                    <ConversationLinkName
                      className="project-ticket-conversation-name"
                      label={label}
                    />
                    <span className="project-ticket-conversation-status">
                      {conversationLinkStatusText(link)}
                    </span>
                  </div>
                  <div className="project-ticket-conversation-actions">
                    <Button
                      aria-label="Jump to linked conversation"
                      disabled={!isUsableConversationLink(link) || hasActiveConversationAction}
                      onClick={() => onJumpToConversation(link)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <IconExternalLink />
                    </Button>
                    <Button
                      aria-label="Unlink conversation"
                      disabled={hasActiveConversationAction}
                      onClick={() => onUnlinkConversation(link)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <IconUnlink />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      ) : (
        <p className="project-ticket-empty">No linked conversation yet.</p>
      )}
    </section>
  );
}

function conversationLinkLabel(link: ProjectBoardConversationLinkView): string {
  return link.sessionTitle || link.agentName || link.agentId || link.agentSessionId || "Agent session";
}

function isUsableConversationLink(link: ProjectBoardConversationLinkView | undefined): boolean {
  return Boolean(link?.isLive || link?.isRestorable);
}

function getPrimaryUsableConversationLink(
  links: ProjectBoardConversationLinkView[],
): ProjectBoardConversationLinkView | undefined {
  return links.find(isUsableConversationLink);
}

function ConversationLinkName({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function conversationLinkStatusText(link: ProjectBoardConversationLinkView): string {
  const sessionStatus = link.isSleeping
    ? "Sleeping"
    : link.isLive
      ? "Live"
      : link.isRestorable
        ? "Restorable"
        : "Unavailable";
  const agentSessionPreview = link.agentSessionId ? ` · ${link.agentSessionId.slice(0, 8)}` : "";
  return `${sessionStatus}${agentSessionPreview}`;
}

function compareConversationLinksNewestFirst(
  left: ProjectBoardConversationLinkView,
  right: ProjectBoardConversationLinkView,
): number {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
}

function compareAutomationRunsForTriage(left: AutomationRun, right: AutomationRun): number {
  const unreadDelta = Number(right.isUnread) - Number(left.isUnread);
  if (unreadDelta !== 0) {
    return unreadDelta;
  }
  const statusDelta = automationTriageStatusWeight(right.status) - automationTriageStatusWeight(left.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return compareAutomationRunsNewestFirst(left, right);
}

function selectAutomationRunsForTriage(runs: AutomationRun[]): AutomationRun[] {
  const selectedRuns = new Map<string, AutomationRun>();
  for (const run of runs.filter(isAutomationRunActionableInTriage).sort(compareAutomationRunsForTriage)) {
    selectedRuns.set(run.id, run);
  }
  for (const run of runs
    .filter(isAutomationRunRecentlyCompletedForTriage)
    .sort(compareAutomationRunsNewestFirst)
    .slice(0, PROJECT_AUTOMATION_TRIAGE_RECENT_COMPLETED_LIMIT)) {
    selectedRuns.set(run.id, run);
  }
  return [...selectedRuns.values()].sort(compareAutomationRunsForTriage);
}

function isAutomationRunActionableInTriage(run: AutomationRun): boolean {
  return (
    run.isUnread ||
    run.status === "findings" ||
    run.status === "needs_attention" ||
    run.status === "failed"
  );
}

function isAutomationRunRecentlyCompletedForTriage(run: AutomationRun): boolean {
  return Boolean(run.completedAt) && run.status !== "running" && run.status !== "queued";
}

function automationTriageStatusWeight(status: AutomationRun["status"]): number {
  switch (status) {
    case "needs_attention":
    case "failed":
      return 3;
    case "findings":
      return 2;
    default:
      return 1;
  }
}

function BoardLane({
  column,
  conversationAction,
  linksByBeadId,
  onJumpToConversation,
  onOpenTicket,
  tickets,
}: {
  column: (typeof BOARD_COLUMNS)[number];
  conversationAction: ConversationActionState;
  linksByBeadId: Map<string, ProjectBoardConversationLinkView[]>;
  onJumpToConversation: (link: ProjectBoardConversationLinkView) => void;
  onOpenTicket: (ticket: BoardTicket) => void;
  tickets: BoardTicket[];
}) {
  const { isDropTarget, ref } = useDroppable({
    accept: "ticket",
    data: { statusKey: column.key },
    id: column.key,
  });
  const visibleTickets = tickets.slice(0, PROJECT_BOARD_MAX_VISIBLE_TICKETS_PER_COLUMN);
  const hiddenTicketCount = tickets.length - visibleTickets.length;

  return (
    <section
      className="project-board-lane"
      data-drop-target={String(isDropTarget)}
      data-tone={column.tone}
      ref={ref}
    >
      <header className="project-board-lane-header">
        <div>
          <span className="project-board-lane-dot" />
          <h2>{column.label}</h2>
        </div>
        <span>{tickets.length}</span>
      </header>
      <div className="project-board-lane-scroll">
        <div className="project-board-card-stack">
          {visibleTickets.map((ticket) => (
            <TicketCard
              conversationAction={conversationAction}
              key={ticket.id}
              links={linksByBeadId.get(ticket.id) ?? []}
              onJumpToConversation={onJumpToConversation}
              onOpenTicket={onOpenTicket}
              ticket={ticket}
            />
          ))}
          {hiddenTicketCount > 0 ? (
            <div className="project-board-lane-limit" role="status">
              Showing {visibleTickets.length} of {tickets.length}. Use search or status filters to narrow this lane.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TicketCard({
  conversationAction,
  links,
  onJumpToConversation,
  onOpenTicket,
  ticket,
}: {
  conversationAction: ConversationActionState;
  links: ProjectBoardConversationLinkView[];
  onJumpToConversation: (link: ProjectBoardConversationLinkView) => void;
  onOpenTicket: (ticket: BoardTicket) => void;
  ticket: BoardTicket;
}) {
  const { isDragging, ref } = useDraggable({
    data: { ticketId: ticket.id },
    id: ticket.id,
    type: "ticket",
  });
  const blockedByCount = ticket.dependency_count ?? getBlockedByIds(ticket).length;
  const blockingCount = ticket.dependent_count ?? 0;
  const primaryLink = getPrimaryUsableConversationLink(links) ?? links[0];
  const additionalLinkCount = primaryLink ? links.length - 1 : 0;
  const primaryLinkLabel = primaryLink ? conversationLinkLabel(primaryLink) : "";
  const jumpDisabled =
    !isUsableConversationLink(primaryLink) ||
    Boolean(conversationAction);

  return (
    <Card
      className="project-board-card"
      data-dragging={String(isDragging)}
      onClick={() => onOpenTicket(ticket)}
      ref={ref}
      role="button"
      size="sm"
      tabIndex={0}
    >
      <CardHeader className="project-board-card-header">
        <CardTitle>{ticket.title}</CardTitle>
        <CardDescription>{ticket.displayId}</CardDescription>
      </CardHeader>
      <CardContent className="project-board-card-content">
        <p>{ticket.description || "No prompt yet."}</p>
        {ticket.labels?.length ? (
          <div className="project-board-card-labels">
            {ticket.labels.map((label) => (
              <span className="project-board-card-label" key={label}>
                {label}
              </span>
            ))}
          </div>
        ) : null}
        <Separator />
        <div className="project-board-card-meta">
          <span className="project-board-priority">{priorityLabel(ticket.priority)}</span>
          {estimateToTshirt(ticket.estimate) ? (
            <span>{estimateToTshirt(ticket.estimate)}</span>
          ) : null}
          {blockedByCount > 0 ? <span>{blockedByCount} blocked</span> : null}
          {blockingCount > 0 ? <span>{blockingCount} blocking</span> : null}
          <span className="project-board-comments">
            <IconMessageCircle />
            {ticket.comment_count ?? ticket.comments?.length ?? 0}
          </span>
        </div>
        {primaryLink ? (
          <div className="project-board-card-conversation">
            <TooltipProvider delayDuration={350}>
              <span className="project-board-card-conversation-label">
                <IconLink />
                <ConversationLinkName
                  className="project-board-card-conversation-name"
                  label={primaryLinkLabel}
                />
                {additionalLinkCount > 0 ? (
                  <span className="project-board-card-conversation-extra">
                    +{additionalLinkCount}
                  </span>
                ) : null}
              </span>
            </TooltipProvider>
            <Button
              aria-label="Jump to linked conversation"
              disabled={jumpDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onJumpToConversation(primaryLink);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <IconExternalLink />
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AutomationDefinitionList({
  actionId,
  agents,
  automations,
  onDelete,
  onEdit,
  onRunNow,
  onSelect,
  onSetEnabled,
  runs,
  selectedAutomationId,
}: {
  actionId: string;
  agents: ProjectAutomationAgentOption[];
  automations: AutomationDefinition[];
  onDelete: (automation: AutomationDefinition) => void;
  onEdit: (automation: AutomationDefinition) => void;
  onRunNow: (automation: AutomationDefinition) => void;
  onSelect: (automationId: string) => void;
  onSetEnabled: (automation: AutomationDefinition, enabled: boolean) => void;
  runs: AutomationRun[];
  selectedAutomationId: string;
}) {
  if (automations.length === 0) {
    return (
      <Card className="project-automation-empty" size="sm">
        <CardContent>
          <IconCalendarTime aria-hidden="true" />
          <strong>No automations yet</strong>
        </CardContent>
      </Card>
    );
  }
  return (
    <section className="project-automation-list" aria-label="Automations">
      {automations.map((automation) => {
        const lastRun = runs.find((run) => run.automationId === automation.id);
        const unreadCount = runs.filter(
          (run) => run.automationId === automation.id && run.isUnread && !run.isArchived,
        ).length;
        const agentLabel = automationAgentLabel(agents, automation.agentId);
        const isBusy = actionId === automation.id;
        return (
          <Card
            className="project-automation-card"
            data-selected={automation.id === selectedAutomationId}
            key={automation.id}
            onClick={() => onSelect(automation.id)}
            role="button"
            size="sm"
            tabIndex={0}
          >
            <CardContent>
              <div className="project-automation-card-main">
                <div>
                  <div className="project-automation-card-title">
                    <span data-enabled={automation.enabled}>{automation.enabled ? "Enabled" : "Paused"}</span>
                    <strong>{automation.name}</strong>
                  </div>
                  <p>{describeAutomationSchedule(automation.schedule)}</p>
                  <p>{agentLabel} - {describeAutomationMode(automation.executionMode)}</p>
                </div>
                <div className="project-automation-card-meta">
                  <span>{automation.nextRunAt ? formatShortDate(automation.nextRunAt) : "No next run"}</span>
                  <span>{lastRun ? automationRunStatusLabel(lastRun.status) : "Never run"}</span>
                  {unreadCount > 0 ? <span>{unreadCount} unread</span> : null}
                </div>
              </div>
              <div className="project-automation-card-actions">
                <Button
                  aria-label={`Run ${automation.name}`}
                  disabled={isBusy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRunNow(automation);
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <IconPlayerPlay />
                </Button>
                <Button
                  disabled={isBusy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetEnabled(automation, !automation.enabled);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {automation.enabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(automation);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Edit
                </Button>
                <Button
                  aria-label={`Delete ${automation.name}`}
                  disabled={isBusy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(automation);
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <IconTrash />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function AutomationRunList({
  actionId,
  agents,
  automations,
  emptyTitle,
  onArchive,
  onMarkRead,
  onOpenSession,
  onOpenWorktree,
  onSelect,
  projectName,
  runs,
  selectedRunId,
}: {
  actionId: string;
  agents: ProjectAutomationAgentOption[];
  automations: AutomationDefinition[];
  emptyTitle: string;
  onArchive: (run: AutomationRun) => void;
  onMarkRead: (run: AutomationRun) => void;
  onOpenSession: (run: AutomationRun) => void;
  onOpenWorktree: (run: AutomationRun) => void;
  onSelect: (runId: string) => void;
  projectName: string;
  runs: AutomationRun[];
  selectedRunId: string;
}) {
  if (runs.length === 0) {
    return (
      <Card className="project-automation-empty" size="sm">
        <CardContent>
          <IconBell aria-hidden="true" />
          <strong>{emptyTitle}</strong>
        </CardContent>
      </Card>
    );
  }
  return (
    <section className="project-automation-run-list" aria-label="Automation runs">
      {runs.map((run) => {
        const automation = automations.find((candidate) => candidate.id === run.automationId);
        const agentLabel = automation ? automationAgentLabel(agents, automation.agentId) : "Unknown agent";
        const isActiveRun = isAutomationRunActive(run);
        return (
          <Card
            className="project-automation-run-card"
            data-selected={run.id === selectedRunId}
            data-unread={run.isUnread}
            key={run.id}
            onClick={() => onSelect(run.id)}
            role="button"
            size="sm"
            tabIndex={0}
          >
            <CardContent>
              <div className="project-automation-run-main">
                <div className="project-automation-run-heading">
                  <span data-status={run.status}>{automationRunStatusLabel(run.status)}</span>
                  <strong>{automation?.name ?? run.automationId}</strong>
                </div>
                <p>{run.findingsSummary || run.errorMessage || "Run is waiting for agent output."}</p>
                <div className="project-automation-run-meta">
                  <span>{projectName}</span>
                  <span>{agentLabel}</span>
                  <span>{formatShortDate(run.completedAt ?? run.createdAt)}</span>
                  {run.sessionId ? <span>Session {run.sessionId}</span> : null}
                  {run.worktree ? <span>{run.worktree.branch}</span> : null}
                </div>
              </div>
              <div className="project-automation-run-actions">
                {run.sessionId ? (
                  <Button
                    aria-label="Open automation session"
                    disabled={actionId === run.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSession(run);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <IconExternalLink />
                  </Button>
                ) : null}
                {run.worktree ? (
                  <Button
                    aria-label="Open automation worktree"
                    disabled={actionId === run.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenWorktree(run);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <IconFolderOpen />
                  </Button>
                ) : null}
                {run.isUnread ? (
                  <Button
                    aria-label="Mark run read"
                    disabled={actionId === run.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMarkRead(run);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Read
                  </Button>
                ) : null}
                <Button
                  aria-label="Archive run"
                  disabled={actionId === run.id || isActiveRun}
                  onClick={(event) => {
                    event.stopPropagation();
                    onArchive(run);
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <IconArchive />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function AutomationDefinitionDetail({
  actionId,
  agents,
  automation,
  onDelete,
  onEdit,
  onRunNow,
  onSetEnabled,
  runs,
}: {
  actionId: string;
  agents: ProjectAutomationAgentOption[];
  automation: AutomationDefinition | undefined;
  onDelete: (automation: AutomationDefinition) => void;
  onEdit: (automation: AutomationDefinition) => void;
  onRunNow: (automation: AutomationDefinition) => void;
  onSetEnabled: (automation: AutomationDefinition, enabled: boolean) => void;
  runs: AutomationRun[];
}) {
  if (!automation) {
    return (
      <section className="project-automation-detail" aria-label="Automation details">
        <div className="project-automation-detail-empty">
          <IconCalendarTime aria-hidden="true" />
          <strong>No automation selected</strong>
        </div>
      </section>
    );
  }
  const automationRuns = runs
    .filter((run) => run.automationId === automation.id)
    .slice(0, 5);
  const agentLabel = automationAgentLabel(agents, automation.agentId);
  const isBusy = actionId === automation.id;
  return (
    <section className="project-automation-detail" aria-label="Automation details">
      <div className="project-automation-detail-header">
        <div>
          <span data-enabled={automation.enabled}>{automation.enabled ? "Enabled" : "Paused"}</span>
          <h2>{automation.name}</h2>
        </div>
        <div className="project-automation-detail-actions">
          <Button
            aria-label={`Run ${automation.name}`}
            disabled={isBusy}
            onClick={() => onRunNow(automation)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <IconPlayerPlay />
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => onSetEnabled(automation, !automation.enabled)}
            size="sm"
            type="button"
            variant="outline"
          >
            {automation.enabled ? "Pause" : "Resume"}
          </Button>
          <Button onClick={() => onEdit(automation)} size="sm" type="button" variant="outline">
            Edit
          </Button>
          <Button
            aria-label={`Delete ${automation.name}`}
            disabled={isBusy}
            onClick={() => onDelete(automation)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <IconTrash />
          </Button>
        </div>
      </div>
      <dl className="project-automation-detail-grid">
        <div>
          <dt>Schedule</dt>
          <dd>{describeAutomationSchedule(automation.schedule)}</dd>
        </div>
        <div>
          <dt>Next run</dt>
          <dd>{automation.nextRunAt ? formatShortDate(automation.nextRunAt) : "Not scheduled"}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{agentLabel}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{describeAutomationMode(automation.executionMode)}</dd>
        </div>
        {automation.executionMode.kind === "worktree" && automation.executionMode.setupCommand ? (
          <div>
            <dt>Setup</dt>
            <dd>{automation.executionMode.setupCommand}</dd>
          </div>
        ) : null}
        {automation.executionMode.kind === "thread" ? (
          <div>
            <dt>Thread</dt>
            <dd>{automation.executionMode.sessionId}</dd>
          </div>
        ) : null}
        {automation.executionMode.kind === "thread" && automation.executionMode.expiresAt ? (
          <div>
            <dt>Expires</dt>
            <dd>{formatShortDate(automation.executionMode.expiresAt)}</dd>
          </div>
        ) : null}
      </dl>
      <Separator />
      <div className="project-automation-detail-section">
        <h3>Prompt</h3>
        <pre>{automation.prompt}</pre>
      </div>
      <div className="project-automation-detail-section">
        <h3>Recent runs</h3>
        {automationRuns.length > 0 ? (
          <div className="project-automation-detail-run-stack">
            {automationRuns.map((run) => (
              <div key={run.id}>
                <span data-status={run.status}>{automationRunStatusLabel(run.status)}</span>
                <p>{formatShortDate(run.completedAt ?? run.createdAt)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No runs yet.</p>
        )}
      </div>
    </section>
  );
}

function AutomationRunDetail({
  actionId,
  agents,
  automation,
  onArchive,
  onMarkRead,
  onOpenSession,
  onOpenWorktree,
  projectName,
  run,
}: {
  actionId: string;
  agents: ProjectAutomationAgentOption[];
  automation: AutomationDefinition | undefined;
  onArchive: (run: AutomationRun) => void;
  onMarkRead: (run: AutomationRun) => void;
  onOpenSession: (run: AutomationRun) => void;
  onOpenWorktree: (run: AutomationRun) => void;
  projectName: string;
  run: AutomationRun | undefined;
}) {
  if (!run) {
    return (
      <section className="project-automation-detail" aria-label="Automation run details">
        <div className="project-automation-detail-empty">
          <IconBell aria-hidden="true" />
          <strong>No run selected</strong>
        </div>
      </section>
    );
  }
  const agentLabel = automation ? automationAgentLabel(agents, automation.agentId) : "Unknown agent";
  const isBusy = actionId === run.id;
  const isActiveRun = isAutomationRunActive(run);
  return (
    <section className="project-automation-detail" aria-label="Automation run details">
      <div className="project-automation-detail-header">
        <div>
          <span data-status={run.status}>{automationRunStatusLabel(run.status)}</span>
          <h2>{automation?.name ?? run.automationId}</h2>
        </div>
        <div className="project-automation-detail-actions">
          {run.sessionId ? (
            <Button
              aria-label="Open automation session"
              disabled={isBusy}
              onClick={() => onOpenSession(run)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <IconExternalLink />
            </Button>
          ) : null}
          {run.worktree ? (
            <Button
              aria-label="Open automation worktree"
              disabled={isBusy}
              onClick={() => onOpenWorktree(run)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <IconFolderOpen />
            </Button>
          ) : null}
          {run.isUnread ? (
            <Button disabled={isBusy} onClick={() => onMarkRead(run)} size="sm" type="button" variant="outline">
              Read
            </Button>
          ) : null}
          <Button
            aria-label="Archive run"
            disabled={isBusy || isActiveRun}
            onClick={() => onArchive(run)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <IconArchive />
          </Button>
        </div>
      </div>
      <dl className="project-automation-detail-grid">
        <div>
          <dt>Project</dt>
          <dd>{projectName}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{agentLabel}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatShortDate(run.createdAt)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{run.completedAt ? formatShortDate(run.completedAt) : "Still running"}</dd>
        </div>
        {run.sessionId ? (
          <div>
            <dt>Session</dt>
            <dd>
              <span>{run.sessionId}</span>
              <Button
                aria-label="Copy automation session id"
                onClick={() => void navigator.clipboard.writeText(run.sessionId ?? "")}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <IconCopy />
              </Button>
            </dd>
          </div>
        ) : null}
        {run.worktree ? (
          <>
            <div>
              <dt>Branch</dt>
              <dd>
                <span>{run.worktree.branch}</span>
                <Button
                  aria-label="Copy automation worktree branch"
                  onClick={() => void navigator.clipboard.writeText(run.worktree?.branch ?? "")}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <IconCopy />
                </Button>
              </dd>
            </div>
            <div>
              <dt>Worktree</dt>
              <dd>
                <span>{run.worktree.path}</span>
                <Button
                  aria-label="Copy automation worktree path"
                  onClick={() => void navigator.clipboard.writeText(run.worktree?.path ?? "")}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <IconCopy />
                </Button>
              </dd>
            </div>
          </>
        ) : null}
      </dl>
      <Separator />
      <div className="project-automation-detail-section">
        <h3>Result</h3>
        <p>{run.findingsSummary || run.errorMessage || "Run is waiting for agent output."}</p>
      </div>
    </section>
  );
}

function ProjectBoardNotice({ message }: { message: string }) {
  const isMissingProject = /not initialized|no storage|not a beads|bd init|database|\.beads/i.test(message);
  const isMissingBeads =
    !isMissingProject &&
    /executable|command not found|not found: bd|bd: not found|env: bd: no such file|cannot find/i.test(message);
  const command = isMissingProject ? "bd init" : "";
  const title = isMissingBeads
    ? "Install Beads to use Project"
    : isMissingProject
      ? "Initialize Beads for this project"
      : "Project board unavailable";
  const bodyLines = isMissingBeads
    ? [
        "Ghostex uses the Beads CLI to read and update Project tickets.",
        `Run ${INSTALL_BEADS_COMMAND}, then reopen or refresh the Project board.`,
      ]
    : isMissingProject
      ? [
          "This project does not have a Beads workspace yet. Run this once from the project root, then refresh the board.",
        ]
      : [message];
  return (
    <Card
      className="project-board-notice"
      data-kind={isMissingBeads ? "install" : isMissingProject ? "init" : "error"}
      role="status"
      size="sm"
    >
      <CardContent>
        {/*
          CDXC:ProjectBoard 2026-05-28-15:27:
          Initialization is a normal first-run state for Beads-backed projects, not an app failure.
          Present bd init as an explanatory setup callout with a copyable command so users understand what needs to happen before the board can load tickets.

          CDXC:ProjectBoard 2026-05-29-15:49:
          Missing-Beads setup should use the same polished notice shell but stay intentionally terse: one header and two lines below.
          Explain why Beads is required and give the install command without adding a second control row.
        */}
        <div className="project-board-notice-icon" aria-hidden="true">
          <IconAlertTriangle />
        </div>
        <div className="project-board-notice-body">
          <strong>{title}</strong>
          {bodyLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {command ? (
            <div className="project-board-notice-command">
              <code>{command}</code>
              <Button
                aria-label={`Copy ${command}`}
                onClick={() => void navigator.clipboard.writeText(command)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <IconCopy />
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function handleCmdEnter(event: KeyboardEvent, action: () => void) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    action();
  }
}

function createAutomationDraft(input: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    agentId: input.agentId ?? "",
    cronExpression: input.cronExpression ?? "*/15 * * * *",
    enabled: input.enabled ?? true,
    expiresAt: input.expiresAt ?? "",
    executionKind: input.executionKind ?? "worktree",
    id: input.id,
    name: input.name ?? "",
    prompt: input.prompt ?? "",
    projectId: input.projectId ?? "",
    schedulePreset: input.schedulePreset ?? "15m",
    scheduleTime: input.scheduleTime ?? "09:00",
    setupCommand: input.setupCommand ?? "",
    threadSessionId: input.threadSessionId ?? "",
    weeklyDay: input.weeklyDay ?? "1",
  };
}

function createAutomationDraftFromDefinition(definition: AutomationDefinition): AutomationDraft {
  const schedule = definition.schedule;
  if (schedule.kind === "interval" && schedule.everyMs === 15 * 60 * 1000) {
    return createAutomationDraftFromDefinitionSchedule(definition, "15m");
  }
  if (schedule.kind === "interval") {
    return createAutomationDraftFromDefinitionSchedule(definition, "hourly");
  }
  if (schedule.kind === "weekly") {
    return createAutomationDraftFromDefinitionSchedule(definition, "weekly", {
      scheduleTime: schedule.time,
      weeklyDay: String(schedule.days[0] ?? 1),
    });
  }
  if (schedule.kind === "daily") {
    return createAutomationDraftFromDefinitionSchedule(definition, "daily", {
      scheduleTime: schedule.time,
    });
  }
  if (schedule.kind === "cron") {
    return createAutomationDraftFromDefinitionSchedule(definition, "cron", {
      cronExpression: schedule.expression,
    });
  }
  return createAutomationDraftFromDefinitionSchedule(definition, "15m");
}

function createAutomationDraftFromDefinitionSchedule(
  definition: AutomationDefinition,
  schedulePreset: AutomationDraft["schedulePreset"],
  input: Partial<AutomationDraft> = {},
): AutomationDraft {
  return createAutomationDraft({
    ...input,
    agentId: definition.agentId,
    enabled: definition.enabled,
    expiresAt:
      definition.executionMode.kind === "thread" && definition.executionMode.expiresAt
        ? toDatetimeLocalValue(definition.executionMode.expiresAt)
        : "",
    executionKind: definition.executionMode.kind,
    id: definition.id,
    name: definition.name,
    prompt: definition.prompt,
    projectId: definition.projectIds[0] ?? "",
    schedulePreset,
    setupCommand:
      definition.executionMode.kind === "worktree"
        ? definition.executionMode.setupCommand ?? ""
        : "",
    threadSessionId:
      definition.executionMode.kind === "thread" ? definition.executionMode.sessionId : "",
  });
}

function createAutomationDefinitionFromDraft(
  draft: AutomationDraft,
  input: { fallbackAgentId: string; projectId: string },
): AutomationDefinition | undefined {
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  const agentId = draft.agentId.trim() || input.fallbackAgentId.trim();
  const schedule = createAutomationScheduleFromDraft(draft);
  if (!name || !prompt || !agentId || !schedule) {
    return undefined;
  }
  const now = new Date().toISOString();
  const executionMode: AutomationExecutionMode =
    draft.executionKind === "local"
      ? { kind: "local" }
      : draft.executionKind === "thread"
        ? {
            expiresAt: datetimeLocalToIso(draft.expiresAt),
            kind: "thread",
            sessionId: draft.threadSessionId.trim(),
          }
        : {
            kind: "worktree",
            setupCommand: draft.setupCommand.trim() || undefined,
          };
  if (executionMode.kind === "thread" && !executionMode.sessionId) {
    return undefined;
  }
  return {
    agentId,
    createdAt: now,
    enabled: draft.enabled,
    executionMode,
    id: draft.id ?? `automation-${crypto.randomUUID()}`,
    name,
    nextRunAt: draft.enabled ? computeNextRunAt(schedule) : undefined,
    projectIds: [input.projectId],
    prompt,
    schedule,
    updatedAt: now,
  };
}

function createAutomationScheduleFromDraft(draft: AutomationDraft): AutomationSchedule | undefined {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const schedule =
    draft.schedulePreset === "15m"
      ? { everyMs: 15 * 60 * 1000, kind: "interval" }
      : draft.schedulePreset === "hourly"
        ? { everyMs: 60 * 60 * 1000, kind: "interval" }
        : draft.schedulePreset === "cron"
          ? {
              expression: draft.cronExpression,
              kind: "cron",
              timezone,
            }
        : draft.schedulePreset === "weekly"
          ? {
              days: [Number(draft.weeklyDay)],
              kind: "weekly",
              time: draft.scheduleTime,
              timezone,
            }
          : {
              kind: "daily",
              time: draft.scheduleTime,
              timezone,
            };
  return normalizeAutomationSchedule(schedule);
}

function describeAutomationSchedule(schedule: AutomationSchedule): string {
  switch (schedule.kind) {
    case "interval":
      return schedule.everyMs === 15 * 60 * 1000
        ? "Every 15 minutes"
        : schedule.everyMs === 60 * 60 * 1000
          ? "Hourly"
          : `Every ${Math.round(schedule.everyMs / 60_000)} minutes`;
    case "daily":
      return `Daily at ${schedule.time}`;
    case "weekly":
      return `Weekly ${weekdayLabel(schedule.days[0] ?? 0)} at ${schedule.time}`;
    case "cron":
      return schedule.expression;
  }
}

function describeAutomationMode(mode: AutomationExecutionMode): string {
  switch (mode.kind) {
    case "worktree":
      return "Worktree";
    case "thread":
      return "Thread";
    case "local":
      return "Local checkout";
  }
}

function automationRunStatusLabel(status: AutomationRun["status"]): string {
  switch (status) {
    case "no_findings":
      return "No findings";
    case "needs_attention":
      return "Needs attention";
    default:
      return status.replace(/_/gu, " ");
  }
}

function isAutomationRunActive(run: Pick<AutomationRun, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

function automationAgentLabel(agents: ProjectAutomationAgentOption[], agentId: string): string {
  return agents.find((agent) => agent.agentId === agentId)?.label ?? agentId;
}

function weekdayLabel(day: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] ?? "Weekly";
}

function datetimeLocalToIso(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsedMs = Date.parse(trimmed);
  return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : undefined;
}

function toDatetimeLocalValue(value: string): string {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return "";
  }
  const date = new Date(parsedMs);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function waitForProjectBoardRefreshIdle(isBusy: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (!isBusy()) {
        resolve();
        return;
      }
      window.setTimeout(tick, 25);
    };
    tick();
  });
}

function stringifyProjectBoardDebugDetails(details: Record<string, unknown> | undefined): string | undefined {
  if (details === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return JSON.stringify({ serializationFailed: true });
  }
}

function createIssuesSignature(issues: BeadsIssue[]): string {
  return issues
    .map((issue) =>
      [
        issue.id,
        issue.status,
        issue.updated_at ?? "",
        issue.title,
        String(issue.priority ?? ""),
        String(issue.estimate ?? ""),
        String(issue.comment_count ?? issue.comments?.length ?? ""),
        String(issue.dependency_count ?? ""),
        String(issue.dependent_count ?? ""),
        (issue.labels ?? []).join(","),
      ].join("\u001f"),
    )
    .join("\u001e");
}

function prioritizeDependencyTickets(tickets: BoardTicket[]): BoardTicket[] {
  const activeTickets = tickets.filter((ticket) => ticket.boardStatus !== "done");
  const doneTickets = tickets.filter((ticket) => ticket.boardStatus === "done");
  return [...activeTickets, ...doneTickets];
}

function hasProjectBoardImagePastePayload(clipboardData: DataTransfer): boolean {
  /**
   * CDXC:ProjectBoardImagePaste 2026-05-28-08:18:
   * Image paste detection must stay synchronous so the caller prevents the browser's default data-URI Markdown insertion before native resolves the clipboard to a durable image path.
   *
   * CDXC:ProjectBoardImagePaste 2026-05-28-08:27:
   * New Project Board image pastes should persist a path, not a base64 payload. If the clipboard has a file or path, native returns that path; if it only has bitmap data, native saves the bitmap under ~/.ghostex/i like the rich prompt editor and returns the saved path.
   */
  const files = [...clipboardData.files];
  if (files.some((file) => file.type.startsWith("image/") || isDescriptionImageSource(file.name))) {
    return true;
  }
  const items = [...clipboardData.items];
  if (items.some((entry) => entry.type.startsWith("image/") || entry.type === "public.file-url")) {
    return true;
  }
  const uriList = clipboardData.getData("text/uri-list").trim();
  if (uriList.startsWith("file:") && isDescriptionImageSource(uriList)) {
    return true;
  }
  const plainText = clipboardData.getData("text/plain").trim();
  return isDescriptionImageSource(plainText);
}

function sendBeadsRequest(
  request: Omit<BeadsBridgeRequest, "requestId">,
): Promise<BeadsBridgeResponse> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      reject(new Error("Beads command timed out."));
    }, 60_000);
    const onResponse = (event: Event) => {
      const response = (event as CustomEvent<BeadsBridgeResponse>).detail;
      if (response?.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      resolve(response);
    };
    window.addEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
    const message = { ...request, requestId };
    const projectBeadsBridge = (window as ProjectBeadsWebKitWindow).webkit?.messageHandlers
      ?.ghostexProjectBeads;
    if (projectBeadsBridge) {
      projectBeadsBridge.postMessage(message);
      return;
    }
    if (request.action === "listIssues" && request.cwd) {
      void fetch(
        `file://${request.cwd}/.beads/issues.jsonl`,
      ).then(() => reject(new Error("Beads bridge is unavailable outside Ghostex."))).catch(() => {
        reject(new Error("Beads bridge is unavailable outside Ghostex."));
      });
      return;
    }
    console.info(`${BRIDGE_REQUEST_PREFIX}${JSON.stringify(message)}`);
    reject(new Error("Beads bridge is unavailable outside Ghostex."));
  });
}

function sendProjectBoardRequest<TPayload = ProjectBoardConversationState>(
  request: Omit<ProjectBoardBridgeRequest, "requestId">,
): Promise<ProjectBoardBridgeResponse<TPayload>> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener(PROJECT_BOARD_RESPONSE_EVENT, onResponse);
      reject(new Error("Project board bridge timed out."));
    }, 60_000);
    const onResponse = (event: Event) => {
      const response = (event as CustomEvent<ProjectBoardBridgeResponse<TPayload>>).detail;
      if (response?.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener(PROJECT_BOARD_RESPONSE_EVENT, onResponse);
      resolve(response);
    };
    window.addEventListener(PROJECT_BOARD_RESPONSE_EVENT, onResponse);
    const message = { ...request, requestId };
    const projectBoardBridge = (window as ProjectBeadsWebKitWindow).webkit?.messageHandlers
      ?.ghostexProjectBoard;
    if (projectBoardBridge) {
      projectBoardBridge.postMessage(message);
      return;
    }
    window.clearTimeout(timeout);
    window.removeEventListener(PROJECT_BOARD_RESPONSE_EVENT, onResponse);
    reject(new Error("Project board bridge is unavailable outside Ghostex."));
  });
}

function sendProjectBoardImageRequest(
  request: Omit<ProjectBoardImageBridgeRequest, "requestId">,
): Promise<ProjectBoardImageBridgeResponse> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener(PROJECT_BOARD_IMAGE_RESPONSE_EVENT, onResponse);
      reject(new Error("Project board image bridge timed out."));
    }, 30_000);
    const onResponse = (event: Event) => {
      const response = (event as CustomEvent<ProjectBoardImageBridgeResponse>).detail;
      if (response?.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener(PROJECT_BOARD_IMAGE_RESPONSE_EVENT, onResponse);
      resolve(response);
    };
    window.addEventListener(PROJECT_BOARD_IMAGE_RESPONSE_EVENT, onResponse);
    const message = { ...request, requestId };
    const projectBoardImagesBridge = (window as ProjectBeadsWebKitWindow).webkit?.messageHandlers
      ?.ghostexProjectBoardImages;
    if (projectBoardImagesBridge) {
      projectBoardImagesBridge.postMessage(message);
      return;
    }
    window.clearTimeout(timeout);
    window.removeEventListener(PROJECT_BOARD_IMAGE_RESPONSE_EVENT, onResponse);
    reject(new Error("Project board image bridge is unavailable outside Ghostex."));
  });
}

const styleElement = document.createElement("style");
styleElement.textContent = `
  :root {
    color-scheme: dark;
    background: #101112;
    color: #f4f4f5;
    font-family: Inter Variable, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.205 0 0);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.205 0 0);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.274 0.006 286.033);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.556 0 0);
    --radius: 0.625rem;
  }

  * { box-sizing: border-box; }

  body {
    background: #101112;
    margin: 0;
    min-height: 100vh;
    overflow: hidden;
  }

  .project-board-shell {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0) 160px), #101112;
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
    padding: 22px 24px 24px;
  }

  .project-board-toolbar {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 20px;
    justify-content: space-between;
    min-height: 44px;
  }

  .project-board-toolbar h1 {
    color: rgba(250, 250, 250, 0.96);
    font-size: 21px;
    font-weight: 650;
    margin: 2px 0 0;
  }

  .project-board-eyebrow {
    color: rgba(244, 244, 245, 0.48);
    font-size: 12px;
    font-weight: 600;
    margin: 0;
  }

  .project-board-toolbar-actions {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  .project-board-tabs {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
  }

  .project-board-tab {
    align-items: center;
    background: rgba(255, 255, 255, 0.055);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    color: rgba(244, 244, 245, 0.72);
    display: inline-flex;
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    gap: 7px;
    height: 30px;
    padding: 0 10px;
  }

  .project-board-tab[data-active="true"] {
    background: rgba(244, 244, 245, 0.92);
    color: #151617;
  }

  .project-board-tab span {
    background: rgba(255, 255, 255, 0.18);
    border-radius: 999px;
    font-size: 11px;
    min-width: 18px;
    padding: 1px 5px;
    text-align: center;
  }

  .project-board-tab[data-active="true"] span {
    background: rgba(0, 0, 0, 0.14);
  }

  .project-automation-split {
    display: grid;
    flex: 1 1 auto;
    gap: 12px;
    grid-template-columns: minmax(280px, 0.9fr) minmax(320px, 1.1fr);
    min-height: 0;
  }

  .project-automation-list,
  .project-automation-run-list {
    display: grid;
    flex: 1 1 auto;
    gap: 10px;
    grid-auto-rows: min-content;
    min-height: 0;
    overflow: auto;
    padding-right: 4px;
  }

  .project-automation-card,
  .project-automation-run-card,
  .project-automation-empty {
    background: rgba(255, 255, 255, 0.055);
    border-color: rgba(255, 255, 255, 0.09);
    border-radius: 8px;
  }

  .project-automation-card[data-selected="true"],
  .project-automation-run-card[data-selected="true"] {
    border-color: rgba(244, 244, 245, 0.32);
    box-shadow: inset 0 0 0 1px rgba(244, 244, 245, 0.18);
  }

  .project-automation-card [data-slot="card-content"],
  .project-automation-run-card [data-slot="card-content"] {
    align-items: center;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 14px;
  }

  .project-automation-card-main,
  .project-automation-run-main {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .project-automation-card-title,
  .project-automation-run-heading {
    align-items: center;
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .project-automation-card-title strong,
  .project-automation-run-heading strong {
    color: rgba(250, 250, 250, 0.96);
    font-size: 14px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-automation-card-title span,
  .project-automation-run-heading span {
    border-radius: 999px;
    color: rgba(250, 250, 250, 0.86);
    flex: 0 0 auto;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 7px;
    text-transform: capitalize;
  }

  .project-automation-card-title span[data-enabled="true"],
  .project-automation-run-heading span[data-status="findings"] {
    background: rgba(111, 207, 151, 0.18);
    color: #8ee4ad;
  }

  .project-automation-card-title span[data-enabled="false"],
  .project-automation-run-heading span[data-status="failed"],
  .project-automation-run-heading span[data-status="needs_attention"] {
    background: rgba(235, 87, 87, 0.18);
    color: #ff9a9a;
  }

  .project-automation-card-main p,
  .project-automation-run-main p,
  .project-automation-card-meta,
  .project-automation-run-meta {
    color: rgba(244, 244, 245, 0.58);
    font-size: 12px;
    margin: 0;
  }

  .project-automation-card-meta,
  .project-automation-run-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .project-automation-card-actions {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
  }

  .project-automation-run-actions {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
  }

  .project-automation-detail {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    display: grid;
    gap: 14px;
    grid-auto-rows: min-content;
    min-height: 0;
    overflow: auto;
    padding: 16px;
  }

  .project-automation-detail-empty {
    align-items: center;
    color: rgba(244, 244, 245, 0.68);
    display: flex;
    gap: 10px;
    min-height: 120px;
  }

  .project-automation-detail-header {
    align-items: flex-start;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    min-width: 0;
  }

  .project-automation-detail-header h2 {
    color: rgba(250, 250, 250, 0.96);
    font-size: 18px;
    line-height: 1.2;
    margin: 6px 0 0;
  }

  .project-automation-detail-header span,
  .project-automation-detail-run-stack span {
    border-radius: 999px;
    color: rgba(250, 250, 250, 0.86);
    display: inline-flex;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 7px;
    text-transform: capitalize;
  }

  .project-automation-detail-header span[data-enabled="true"],
  .project-automation-detail-header span[data-status="findings"],
  .project-automation-detail-run-stack span[data-status="findings"] {
    background: rgba(111, 207, 151, 0.18);
    color: #8ee4ad;
  }

  .project-automation-detail-header span[data-enabled="false"],
  .project-automation-detail-header span[data-status="failed"],
  .project-automation-detail-header span[data-status="needs_attention"],
  .project-automation-detail-run-stack span[data-status="failed"],
  .project-automation-detail-run-stack span[data-status="needs_attention"] {
    background: rgba(235, 87, 87, 0.18);
    color: #ff9a9a;
  }

  .project-automation-detail-actions {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
  }

  .project-automation-detail-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
  }

  .project-automation-detail-grid div {
    min-width: 0;
  }

  .project-automation-detail-grid dt,
  .project-automation-detail-section h3 {
    color: rgba(244, 244, 245, 0.52);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0;
    margin: 0 0 4px;
    text-transform: uppercase;
  }

  .project-automation-detail-grid dd,
  .project-automation-detail-section p,
  .project-automation-detail-run-stack p {
    color: rgba(244, 244, 245, 0.78);
    font-size: 12px;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .project-automation-detail-grid dd {
    align-items: center;
    display: flex;
    gap: 6px;
    min-width: 0;
  }

  .project-automation-detail-grid dd span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .project-automation-detail-section {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .project-automation-detail-section pre {
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    color: rgba(244, 244, 245, 0.82);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    margin: 0;
    max-height: 220px;
    overflow: auto;
    padding: 10px;
    white-space: pre-wrap;
  }

  .project-automation-detail-run-stack {
    display: grid;
    gap: 8px;
  }

  .project-automation-detail-run-stack div {
    align-items: center;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 7px;
    display: flex;
    justify-content: space-between;
    padding: 8px 10px;
  }

  .project-automation-empty [data-slot="card-content"] {
    align-items: center;
    color: rgba(244, 244, 245, 0.68);
    display: flex;
    gap: 10px;
    min-height: 96px;
    padding: 18px;
  }

  .project-automation-empty svg {
    color: rgba(244, 244, 245, 0.42);
    height: 18px;
    width: 18px;
  }

  .project-automation-dialog {
    max-width: 640px;
  }

  .project-automation-form {
    display: grid;
    gap: 12px;
  }

  .project-automation-form label {
    color: rgba(244, 244, 245, 0.72);
    display: grid;
    font-size: 12px;
    font-weight: 650;
    gap: 6px;
  }

  .project-automation-prompt-field textarea {
    min-height: 150px;
  }

  .project-automation-segmented {
    background: rgba(255, 255, 255, 0.055);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 3px;
  }

  .project-automation-segmented button {
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: rgba(244, 244, 245, 0.72);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    height: 30px;
  }

  .project-automation-segmented button[data-active="true"] {
    background: rgba(244, 244, 245, 0.9);
    color: #151617;
  }

  .project-automation-segmented button:disabled {
    color: rgba(244, 244, 245, 0.32);
    cursor: not-allowed;
  }

  .project-automation-segmented button:disabled[data-active="true"] {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(244, 244, 245, 0.42);
  }

  .project-automation-inline-note {
    color: rgba(244, 244, 245, 0.54);
    font-size: 12px;
    line-height: 1.4;
    margin: -4px 0 0;
  }

  .project-automation-enabled {
    align-items: center;
    display: flex !important;
    flex-direction: row;
  }

  @media (max-width: 860px) {
    .project-automation-split {
      grid-template-columns: 1fr;
    }
  }

  .project-board-filters {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 10px;
    min-width: 0;
  }

  .project-board-search {
    align-items: center;
    display: flex;
    flex: 1 1 auto;
    gap: 8px;
    min-width: 0;
  }

  .project-board-search svg {
    color: rgba(244, 244, 245, 0.42);
    flex: 0 0 auto;
    height: 16px;
    width: 16px;
  }

  .project-board-lanes {
    align-items: stretch;
    display: grid;
    flex: 1 1 auto;
    gap: 12px;
    grid-template-columns: repeat(5, minmax(218px, 1fr));
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 2px;
  }

  .project-board-lane {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 218px;
    overflow: hidden;
  }

  .project-board-lane[data-drop-target="true"] {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .project-board-lane-header {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    justify-content: space-between;
    min-height: 44px;
    padding: 0 12px;
  }

  .project-board-lane-header div {
    align-items: center;
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .project-board-lane-header h2,
  .project-board-lane-header span {
    color: rgba(244, 244, 245, 0.68);
    font-size: 12px;
    font-weight: 650;
    margin: 0;
  }

  .project-board-lane-dot {
    background: rgba(244, 244, 245, 0.42);
    border-radius: 999px;
    display: inline-block;
    height: 7px;
    width: 7px;
  }

  .project-board-lane[data-tone="blue"] .project-board-lane-dot { background: #5ea4ff; }
  .project-board-lane[data-tone="amber"] .project-board-lane-dot { background: #e7b85b; }
  .project-board-lane[data-tone="violet"] .project-board-lane-dot { background: #b18cff; }
  .project-board-lane[data-tone="green"] .project-board-lane-dot { background: #6fcf97; }

  .project-board-lane-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding-right: 2px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
  }

  .project-board-lane-scroll::-webkit-scrollbar {
    width: 6px;
  }

  .project-board-lane-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .project-board-lane-scroll::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
  }

  .project-board-lane:hover .project-board-lane-scroll::-webkit-scrollbar-thumb,
  .project-board-lane-scroll:focus-within::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.22);
  }

  .project-board-card-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 0 10px 10px;
  }

  .project-board-lane-limit {
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: rgba(244, 244, 245, 0.48);
    font-size: 11px;
    line-height: 1.4;
    padding: 10px 12px;
  }

  .project-board-card {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0)), #1a1b1d;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.28);
    cursor: default;
    gap: 0;
    max-width: 100%;
    min-width: 0;
    padding: 0;
    width: 100%;
  }

  .project-board-card:hover { background-color: #202124; }
  .project-board-card[data-dragging="true"] { opacity: 0.55; }

  .project-board-card-header {
    gap: 5px;
    min-width: 0;
    padding: 11px 12px 0;
  }

  .project-board-card-header [data-slot="card-title"] {
    color: rgba(250, 250, 250, 0.91);
    font-size: 13px;
    font-weight: 560;
    line-height: 1.35;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .project-board-card-header [data-slot="card-description"] {
    color: rgba(244, 244, 245, 0.39);
    font-size: 11px;
  }

  .project-board-card-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 8px 12px 11px;
  }

  .project-board-card-content p {
    color: rgba(244, 244, 245, 0.55);
    display: -webkit-box;
    font-size: 12px;
    line-height: 1.42;
    margin: 0;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .project-board-card-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .project-board-card-label {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    color: rgba(244, 244, 245, 0.72);
    font-size: 10px;
    line-height: 1;
    padding: 4px 7px;
  }

  .project-board-card-meta {
    align-items: center;
    color: rgba(244, 244, 245, 0.46);
    display: flex;
    flex-wrap: wrap;
    font-size: 11px;
    gap: 8px;
    line-height: 1;
  }

  .project-board-priority {
    color: rgba(244, 244, 245, 0.72);
    font-weight: 680;
  }

  .project-board-comments {
    align-items: center;
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
  }

  .project-board-comments svg {
    height: 13px;
    width: 13px;
  }

  .project-board-card-conversation {
    align-items: center;
    background: rgba(80, 160, 255, 0.08);
    border: 1px solid rgba(120, 180, 255, 0.15);
    border-radius: 7px;
    color: rgba(218, 235, 255, 0.86);
    display: flex;
    gap: 8px;
    justify-content: space-between;
    min-height: 30px;
    min-width: 0;
    padding: 4px 5px 4px 8px;
  }

  .project-board-card-conversation span {
    align-items: center;
    display: inline-flex;
    font-size: 11px;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-board-card-conversation-label {
    /*
     * CDXC:ProjectBoard 2026-05-28-10:14:
     * Board-card associated session names must show a literal ellipsis when
     * the card is too narrow, while the trailing jump button remains visible.
     * Give the text cluster a zero flex basis and override the broader span
     * rule on the actual tooltip trigger so Chromium/WebKit calculate
     * text-overflow instead of clipping the label.
     */
    flex: 1 1 0;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
  }

  .project-board-card-conversation-label .project-board-card-conversation-name {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-board-card-conversation-extra {
    flex: 0 0 auto;
  }

  .project-board-card-conversation svg {
    flex: 0 0 auto;
    height: 13px;
    width: 13px;
  }

  .project-board-notice {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0)),
      #171717;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 8px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.22);
    color: rgba(244, 244, 245, 0.9);
    flex: 0 0 auto;
  }

  .project-board-notice[data-kind="init"] {
    border-color: rgba(231, 184, 91, 0.28);
  }

  .project-board-notice[data-kind="install"] {
    border-color: rgba(94, 164, 255, 0.26);
  }

  .project-board-notice[data-kind="install"] .project-board-notice-icon {
    background: rgba(94, 164, 255, 0.12);
    border-color: rgba(94, 164, 255, 0.2);
    color: #7ab7ff;
  }

  .project-board-notice [data-slot="card-content"] {
    align-items: flex-start;
    display: flex;
    gap: 12px;
    padding: 14px;
  }

  .project-board-notice-icon {
    align-items: center;
    background: rgba(231, 184, 91, 0.13);
    border: 1px solid rgba(231, 184, 91, 0.2);
    border-radius: 8px;
    color: #e7b85b;
    display: flex;
    flex: 0 0 auto;
    height: 34px;
    justify-content: center;
    width: 34px;
  }

  .project-board-notice-icon svg {
    height: 17px;
    width: 17px;
  }

  .project-board-notice-body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .project-board-notice strong {
    color: rgba(250, 250, 250, 0.94);
    font-size: 13px;
    font-weight: 680;
    letter-spacing: 0;
    line-height: 1.2;
  }

  .project-board-notice p {
    color: rgba(244, 244, 245, 0.64);
    font-size: 12px;
    line-height: 1.45;
    margin: 0;
    max-width: 660px;
  }

  .project-board-notice-command {
    align-items: center;
    align-self: flex-start;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 7px;
    display: inline-flex;
    gap: 7px;
    min-height: 30px;
    padding: 3px 4px 3px 9px;
  }

  .project-board-notice-command code {
    color: rgba(250, 250, 250, 0.9);
    font-family: "SF Mono", ui-monospace, monospace;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
  }

  .project-board-notice-command button {
    color: rgba(244, 244, 245, 0.58);
    height: 22px;
    width: 22px;
  }

  .project-board-notice-command button:hover {
    color: rgba(250, 250, 250, 0.92);
  }

  .project-ticket-dialog {
    /*
     * CDXC:ProjectBoard 2026-05-28-13:52:
     * Project ticket edit/create dialogs should use the same #0e0e0e modal
     * background as the rest of Ghostex app-modal surfaces.
     */
    background: #0e0e0e;
    background-color: #0e0e0e;
    border-radius: 12px;
    max-width: min(780px, calc(100vw - 44px));
    overflow: hidden;
    width: 780px;
  }

  .project-ticket-dialog-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: min(72vh, 760px);
    min-height: 0;
    overflow: auto;
  }

  .project-ticket-dialog-footer {
    /*
     * CDXC:ProjectBoardTicketEditor 2026-05-28-08:02:
     * The ticket editor footer should not distribute Delete, Start work, and Save as left, center, and right islands. Keep the destructive Delete action isolated while grouping the workflow and save actions together at the right edge.
     */
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
  }

  .project-ticket-dialog-primary-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
    margin-left: auto;
  }

  .project-ticket-create-footer {
    /*
     * CDXC:ProjectBoard 2026-05-28-12:32:
     * New-ticket creation now has two outcomes: queue the bead, or create it and
     * immediately launch work in the selected execution location. Keep agent and
     * location controls grouped with Create & Start so plain Create remains a
     * simple board operation while the start path is explicit.
     */
    align-items: end;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .project-ticket-create-start {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }

  .project-ticket-create-start-controls {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(150px, 220px) auto;
    min-width: 0;
  }

  .project-ticket-start-location,
  .project-ticket-create-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .project-ticket-create-actions {
    justify-content: flex-end;
  }

  .project-ticket-meta-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .project-ticket-field {
    color: rgba(244, 244, 245, 0.58);
    display: flex;
    flex-direction: column;
    font-size: 12px;
    font-weight: 600;
    gap: 7px;
    min-width: 0;
  }

  .project-ticket-field-inline {
    gap: 6px;
  }

  .project-ticket-field textarea,
  .project-ticket-field input {
    color: rgba(250, 250, 250, 0.92);
    max-width: 100%;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .project-ticket-prompt-input {
    min-height: 190px;
  }

  .project-ticket-title-input {
    min-height: 58px !important;
  }

  .project-ticket-label-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .project-ticket-label-chip {
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    border: 0;
    border-radius: 999px;
    color: rgba(244, 244, 245, 0.82);
    cursor: pointer;
    display: inline-flex;
    font-size: 11px;
    gap: 4px;
    padding: 4px 8px;
  }

  .project-ticket-label-chip svg {
    height: 12px;
    width: 12px;
  }

  .project-ticket-label-editor {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  .project-ticket-image-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .project-ticket-image-thumb {
    background: rgba(0, 0, 0, 0.24);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    display: block;
    height: 72px;
    overflow: hidden;
    position: relative;
    width: 72px;
  }

  .project-ticket-image-thumb img {
    height: 100%;
    object-fit: cover;
    width: 72px;
  }

  .project-ticket-image-thumb span {
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
    display: block;
    height: 100%;
    width: 100%;
  }

  .project-ticket-image-remove {
    align-items: center;
    background: rgba(10, 10, 12, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 999px;
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    display: inline-flex;
    height: 22px;
    justify-content: center;
    padding: 0;
    position: absolute;
    right: 4px;
    top: 4px;
    width: 22px;
  }

  .project-ticket-image-remove svg {
    height: 13px;
    width: 13px;
  }

  .project-ticket-image-remove:hover {
    background: rgba(32, 32, 36, 0.94);
  }

  .project-ticket-dependencies {
    color: rgba(244, 244, 245, 0.62);
    font-size: 12px;
  }

  .project-ticket-dependencies p {
    margin: 0 0 4px;
  }

  .project-ticket-conversations {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .project-ticket-conversation-controls {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(150px, 1fr) auto;
  }

  .project-ticket-conversation-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .project-ticket-conversation-row {
    align-items: center;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    display: grid;
    gap: 10px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-height: 42px;
    padding: 7px 8px 7px 10px;
  }

  .project-ticket-conversation-main {
    /*
     * CDXC:ProjectBoard 2026-05-28-09:17:
     * Ticket conversation rows must preserve the right-side jump/unlink controls
     * at narrow widths while the associated session name truncates with an
     * ellipsis and exposes the full name through the hover tooltip.
     *
     * CDXC:ProjectBoard 2026-05-28-10:14:
     * The associated-session tooltip should open below the session name so it
     * does not cover the title area while inspecting a ticket.
     */
    min-width: 0;
    overflow: hidden;
  }

  .project-ticket-conversation-name,
  .project-ticket-conversation-status {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-ticket-conversation-name {
    color: rgba(250, 250, 250, 0.9);
    font-size: 12px;
    font-weight: 620;
  }

  .project-ticket-conversation-status {
    color: rgba(244, 244, 245, 0.46);
    font-size: 11px;
    margin-top: 2px;
  }

  .project-ticket-conversation-actions {
    align-items: center;
    display: flex;
    gap: 4px;
  }

  .project-ticket-comments {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .project-ticket-section-title {
    color: rgba(244, 244, 245, 0.58);
    font-size: 12px;
    font-weight: 650;
  }

  .project-ticket-comment-list {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    max-height: 180px;
    min-height: 92px;
  }

  .project-ticket-comment,
  .project-ticket-empty {
    padding: 12px;
  }

  .project-ticket-comment p,
  .project-ticket-empty {
    color: rgba(244, 244, 245, 0.72);
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    word-break: break-word;
  }

  @media (max-width: 900px) {
    .project-board-shell { padding: 18px 16px; }
    .project-ticket-create-footer,
    .project-ticket-create-start-controls {
      grid-template-columns: 1fr;
    }
    .project-ticket-create-actions {
      justify-content: stretch;
    }
    .project-ticket-create-actions > button,
    .project-ticket-start-location > button {
      flex: 1 1 auto;
    }
    .project-ticket-conversation-controls { grid-template-columns: 1fr; }
    .project-ticket-meta-grid { grid-template-columns: 1fr; }
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<ProjectBoardApp />);
