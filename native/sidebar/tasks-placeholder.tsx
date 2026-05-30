import {
  IconAlertTriangle,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconMessageCircle,
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
  type BoardEstimateFilter,
  type BoardPriorityFilter,
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
const PROJECT_BOARD_PRIORITY_SELECT_ITEMS = PRIORITY_OPTIONS.map((option) => ({
  label: option.label,
  value: option.value,
}));
const PROJECT_BOARD_PRIORITY_FILTER_SELECT_ITEMS: Array<{ label: string; value: BoardPriorityFilter }> = [
  { label: "All priorities", value: "all" },
  ...PROJECT_BOARD_PRIORITY_SELECT_ITEMS,
];
const PROJECT_BOARD_TSHIRT_SELECT_ITEMS: Array<{ label: string; value: TshirtSize | "none" }> = [
  { label: "None", value: "none" },
  ...TSHIRT_OPTIONS.map((option) => ({ label: option.label, value: option.label })),
];
const PROJECT_BOARD_ESTIMATE_FILTER_SELECT_ITEMS: Array<{ label: string; value: BoardEstimateFilter }> = [
  { label: "All estimates", value: "all" },
  ...PROJECT_BOARD_TSHIRT_SELECT_ITEMS,
];

type BoardRefreshMode = "background" | "initial" | "manual" | "mutation";

type BoardRefreshOptions = {
  includeLabels?: boolean;
  mode?: BoardRefreshMode;
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
  const [priorityFilter, setPriorityFilter] = useState<BoardPriorityFilter>("all");
  const [estimateFilter, setEstimateFilter] = useState<BoardEstimateFilter>("all");
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
  const agentSelectItems = useMemo(
    () =>
      conversationState.agents.map((agent) => ({
        label: agent.label,
        value: agent.agentId,
      })),
    [conversationState.agents],
  );
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
   *
   * CDXC:ProjectBoard 2026-05-30-07:46:
   * Collapsed macOS Project-page selects must show friendly labels for agents and ticket priority while preserving the raw Beads-compatible values used by bridge requests.
   * Provide select item metadata at the root because the popup is not mounted before the collapsed value renders.
   *
   * CDXC:ProjectBoardFilters 2026-05-30-08:31:
   * The board toolbar should place the search icon inside the input at the left edge and replace the status dropdown with Priority and Estimate filters.
   * Toolbar selects use root item metadata so collapsed controls show friendly labels instead of raw filter values.
   */
  const isRefreshingRef = useRef(false);
  const issuesSignatureRef = useRef("");
  const labelsSignatureRef = useRef("");
  const lastLabelsRefreshAtRef = useRef(0);
  const newPromptRef = useRef<HTMLTextAreaElement>(null);
  const [conversationAction, setConversationAction] = useState<ConversationActionState>();

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
      setSelectedAgentId((current) => current || payload.defaultAgentId || payload.agents[0]?.agentId || "");
    } catch (error) {
      console.warn("Project board conversation state unavailable.", error);
    }
  }, [projectId, projectPath]);

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
    void loadTickets({ includeLabels: true, mode: "initial" });
    void loadConversationState();
  }, [loadConversationState, loadTickets]);

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
      void loadTickets({
        includeLabels:
          includeLabels ||
          Date.now() - lastLabelsRefreshAtRef.current >= PROJECT_BOARD_LABEL_REFRESH_INTERVAL_MS,
        mode: "background",
      });
      void loadConversationState();
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
  }, [loadConversationState, loadTickets]);

  const filteredTickets = useMemo(
    () => filterBoardTickets(tickets, searchQuery, priorityFilter, estimateFilter),
    [estimateFilter, priorityFilter, searchQuery, tickets],
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
            aria-label="Refresh board"
            disabled={loadState === "loading"}
            onClick={() => {
              void loadTickets({ includeLabels: true, mode: "manual" });
              void loadConversationState();
            }}
            size="icon-sm"
            variant="ghost"
          >
            <IconRefresh />
          </Button>
          <Button onClick={() => setNewTicketOpen(true)} size="sm" variant="secondary">
            <IconPlus data-icon="inline-start" />
            Ticket
          </Button>
        </div>
      </section>

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
          items={PROJECT_BOARD_PRIORITY_FILTER_SELECT_ITEMS}
          onValueChange={(value) => setPriorityFilter(value as BoardPriorityFilter)}
          value={priorityFilter}
        >
          <SelectTrigger aria-label="Filter by priority" className="project-board-filter-select" size="sm">
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_BOARD_PRIORITY_FILTER_SELECT_ITEMS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={PROJECT_BOARD_ESTIMATE_FILTER_SELECT_ITEMS}
          onValueChange={(value) => setEstimateFilter(value as BoardEstimateFilter)}
          value={estimateFilter}
        >
          <SelectTrigger aria-label="Filter by estimate" className="project-board-filter-select" size="sm">
            <SelectValue placeholder="All estimates" />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_BOARD_ESTIMATE_FILTER_SELECT_ITEMS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

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
                  items={agentSelectItems}
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
        <Select
          items={PROJECT_BOARD_PRIORITY_SELECT_ITEMS}
          onValueChange={onPriorityChange}
          value={priority}
        >
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
          items={PROJECT_BOARD_TSHIRT_SELECT_ITEMS}
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
      {/*
        CDXC:ProjectBoardTicketMetadata 2026-05-30-08:31:
        Ticket metadata should put Labels where Blocked by was, keep every metadata control's label-to-element spacing consistent, and show T-shirt select values as friendly labels.
      */}
      <div className="project-ticket-field project-ticket-field-inline project-ticket-labels-field">
        <span>Labels</span>
        {labels.length > 0 ? (
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
        ) : null}
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
      <DependencyPicker
        label="Blocking"
        onChange={onBlockingChange}
        selectedIds={blockingIds}
        ticketOptions={ticketOptions}
      />
      <DependencyPicker
        label="Blocked by"
        onChange={onBlockedByChange}
        selectedIds={blockedByIds}
        ticketOptions={ticketOptions}
      />
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
    <div className="project-ticket-field project-ticket-field-inline">
      <span>{label}</span>
      {selectedIds.length > 0 ? (
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
      ) : null}
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
  const agentSelectItems = useMemo(
    () =>
      agents.map((agent) => ({
        label: agent.label,
        value: agent.agentId,
      })),
    [agents],
  );
  return (
    <section className="project-ticket-conversations" aria-label="Linked conversations">
      <div className="project-ticket-section-title">Conversation</div>
      <div className="project-ticket-conversation-controls">
        <Select
          disabled={agents.length === 0}
          items={agentSelectItems}
          onValueChange={onSelectedAgentChange}
          value={selectedAgentId}
        >
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
      <TooltipTrigger render={<span className={className}>{label}</span>} />
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollThumb, setScrollThumb] = useState({ height: 0, top: 0, visible: false });
  const updateScrollThumb = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    if (maxScrollTop <= 1) {
      setScrollThumb((current) =>
        current.visible || current.height !== 0 || current.top !== 0
          ? { height: 0, top: 0, visible: false }
          : current,
      );
      return;
    }
    const height = Math.max(24, (element.clientHeight / element.scrollHeight) * element.clientHeight);
    const top = (element.scrollTop / maxScrollTop) * (element.clientHeight - height);
    setScrollThumb((current) => {
      const next = {
        height: Math.round(height),
        top: Math.round(top),
        visible: true,
      };
      return current.height === next.height && current.top === next.top && current.visible === next.visible
        ? current
        : next;
    });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    updateScrollThumb();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => updateScrollThumb());
    resizeObserver?.observe(element);
    if (element.firstElementChild) {
      resizeObserver?.observe(element.firstElementChild);
    }
    window.addEventListener("resize", updateScrollThumb);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollThumb);
    };
  }, [hiddenTicketCount, updateScrollThumb, visibleTickets.length]);

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
      <div className="project-board-lane-scroll" onScroll={updateScrollThumb} ref={scrollRef}>
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
      <div
        aria-hidden="true"
        className="project-board-lane-scrollbar"
        data-visible={String(scrollThumb.visible)}
      >
        <div
          className="project-board-lane-scrollbar-thumb"
          style={{
            height: `${scrollThumb.height}px`,
            transform: `translateY(${scrollThumb.top}px)`,
          }}
        />
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

function sendProjectBoardRequest(
  request: Omit<ProjectBoardBridgeRequest, "requestId">,
): Promise<ProjectBoardBridgeResponse> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener(PROJECT_BOARD_RESPONSE_EVENT, onResponse);
      reject(new Error("Project board bridge timed out."));
    }, 60_000);
    const onResponse = (event: Event) => {
      const response = (event as CustomEvent<ProjectBoardBridgeResponse>).detail;
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
    background: #0e0e0e;
    color: #f4f4f5;
    font-family: Inter Variable, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    --background: #0e0e0e;
    --foreground: oklch(0.985 0 0);
    --card: #171717;
    --card-foreground: oklch(0.985 0 0);
    --popover: #171717;
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: #242424;
    --secondary-foreground: oklch(0.985 0 0);
    --muted: #242424;
    --muted-foreground: oklch(0.708 0 0);
    --accent: #242424;
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.556 0 0);
    --radius: 0;
    --project-board-bg: #0e0e0e;
    --project-board-panel: #171717;
    --project-board-panel-hover: #1d1d1d;
    --project-board-card: #1a1a1a;
    --project-board-card-hover: #202020;
    --project-board-border: rgba(255, 255, 255, 0.1);
    --project-board-border-strong: rgba(255, 255, 255, 0.16);
    --project-board-scrollbar: rgba(255, 255, 255, 0.28);
  }

  * { box-sizing: border-box; }

  body {
    background: var(--project-board-bg);
    margin: 0;
    min-height: 100vh;
    overflow: hidden;
  }

  .project-board-shell {
    background: var(--project-board-bg);
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
    padding: 22px 24px 24px;
  }

  .project-board-shell *,
  .project-ticket-dialog,
  .project-ticket-dialog * {
    border-radius: 0 !important;
  }

  .project-board-lanes,
  .project-board-lane-scroll,
  .project-ticket-dialog-body,
  .project-ticket-comment-list [data-slot="scroll-area-viewport"] {
    scrollbar-color: transparent transparent;
    scrollbar-width: none;
  }

  .project-ticket-dialog-body:hover,
  .project-ticket-dialog-body:focus-within,
  .project-ticket-comment-list:hover [data-slot="scroll-area-viewport"],
  .project-ticket-comment-list:focus-within [data-slot="scroll-area-viewport"] {
    scrollbar-color: var(--project-board-scrollbar) transparent;
  }

  .project-board-lanes::-webkit-scrollbar,
  .project-board-lane-scroll::-webkit-scrollbar,
  .project-ticket-dialog-body::-webkit-scrollbar,
  .project-ticket-comment-list [data-slot="scroll-area-viewport"]::-webkit-scrollbar {
    height: 0;
    width: 0;
  }

  .project-ticket-dialog-body::-webkit-scrollbar,
  .project-ticket-comment-list [data-slot="scroll-area-viewport"]::-webkit-scrollbar {
    height: 2px;
    width: 2px;
  }

  .project-board-lanes::-webkit-scrollbar-track,
  .project-board-lane-scroll::-webkit-scrollbar-track,
  .project-ticket-dialog-body::-webkit-scrollbar-track,
  .project-ticket-comment-list [data-slot="scroll-area-viewport"]::-webkit-scrollbar-track {
    background: transparent;
  }

  .project-board-lanes::-webkit-scrollbar-thumb,
  .project-board-lane-scroll::-webkit-scrollbar-thumb,
  .project-ticket-dialog-body::-webkit-scrollbar-thumb,
  .project-ticket-comment-list [data-slot="scroll-area-viewport"]::-webkit-scrollbar-thumb {
    background: transparent;
  }

  .project-ticket-dialog-body:hover::-webkit-scrollbar-thumb,
  .project-ticket-dialog-body:focus-within::-webkit-scrollbar-thumb,
  .project-ticket-comment-list:hover [data-slot="scroll-area-viewport"]::-webkit-scrollbar-thumb,
  .project-ticket-comment-list:focus-within [data-slot="scroll-area-viewport"]::-webkit-scrollbar-thumb {
    background: var(--project-board-scrollbar);
  }

  .project-ticket-comment-list [data-slot="scroll-area-scrollbar"] {
    opacity: 0;
    transition: opacity 120ms ease;
    width: 5px;
  }

  .project-ticket-comment-list:hover [data-slot="scroll-area-scrollbar"],
  .project-ticket-comment-list:focus-within [data-slot="scroll-area-scrollbar"] {
    opacity: 1;
  }

  .project-ticket-comment-list [data-slot="scroll-area-thumb"] {
    background: var(--project-board-scrollbar);
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
    min-width: 0;
    position: relative;
  }

  .project-board-search svg {
    color: rgba(244, 244, 245, 0.42);
    height: 16px;
    left: 12px;
    pointer-events: none;
    position: absolute;
    width: 16px;
    z-index: 1;
  }

  .project-board-search input {
    padding-left: 36px;
  }

  .project-board-filter-select {
    min-width: 124px;
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
    padding-bottom: 0;
  }

  .project-board-lane {
    background: var(--project-board-panel);
    border: 1px solid var(--project-board-border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 218px;
    overflow: hidden;
    position: relative;
  }

  .project-board-lane[data-drop-target="true"] {
    background: var(--project-board-panel-hover);
    border-color: var(--project-board-border-strong);
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
    padding-right: 0;
  }

  .project-board-lane-scrollbar {
    bottom: 0;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    right: 0;
    top: 44px;
    transition: opacity 120ms ease;
    width: 2px;
    z-index: 4;
  }

  .project-board-lane:hover .project-board-lane-scrollbar[data-visible="true"],
  .project-board-lane:focus-within .project-board-lane-scrollbar[data-visible="true"] {
    opacity: 1;
  }

  .project-board-lane-scrollbar-thumb {
    background: var(--project-board-scrollbar);
    width: 2px;
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
    color: rgba(244, 244, 245, 0.48);
    font-size: 11px;
    line-height: 1.4;
    padding: 10px 12px;
  }

  .project-board-card {
    background: var(--project-board-card);
    border: 1px solid var(--project-board-border);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.28);
    cursor: default;
    gap: 0;
    max-width: 100%;
    min-width: 0;
    padding: 0;
    width: 100%;
  }

  .project-board-card:hover { background-color: var(--project-board-card-hover); }
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
    background: var(--project-board-panel);
    border: 1px solid var(--project-board-border);
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

  .project-ticket-label-editor input {
    height: 28px;
  }

  .project-ticket-image-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .project-ticket-image-thumb {
    background: rgba(0, 0, 0, 0.24);
    border: 1px solid rgba(255, 255, 255, 0.1);
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
