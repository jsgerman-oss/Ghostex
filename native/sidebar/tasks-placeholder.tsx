import {
  IconAlertTriangle,
  IconMessageCircle,
  IconPlus,
  IconRefresh,
  IconSearch,
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
  extractDescriptionImagePreviews,
  filterBoardTickets,
  formatShortDate,
  getBlockedByIds,
  getBlockingIds,
  normalizeBeadsPayload,
  normalizeDisplayIssueKey,
  parseBeadsJson,
  priorityLabel,
  tshirtToEstimate,
  toBoardTickets,
  estimateToTshirt,
  type BeadsBridgeRequest,
  type BeadsBridgeResponse,
  type BeadsIssue,
  type BoardStatusKey,
  type BoardTicket,
  type TshirtSize,
} from "./project-board-shared";
import "../../sidebar/styles/shadcn.generated.css";

type LoadState = "idle" | "loading" | "ready" | "error";

type DetailDraft = {
  blockedByIds: string[];
  blockingIds: string[];
  comment: string;
  description: string;
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

type ProjectBeadsWebKitWindow = Window & {
  webkit?: {
    messageHandlers?: {
      ghostexProjectBeads?: {
        postMessage: (message: BeadsBridgeRequest) => void;
      };
    };
  };
};

const BRIDGE_REQUEST_PREFIX = "__GHOSTEX_PROJECT_BEADS_REQUEST__";
const BRIDGE_RESPONSE_EVENT = "ghostex-project-beads-response";
const INSTALL_BEADS_COMMAND = "brew install beads";
const PROJECT_BOARD_AUTO_REFRESH_INTERVAL_MS = 8_000;
const PROJECT_BOARD_LABEL_REFRESH_INTERVAL_MS = 60_000;
const PROJECT_BOARD_MAX_DEPENDENCY_OPTIONS = 600;
const PROJECT_BOARD_MAX_VISIBLE_TICKETS_PER_COLUMN = 120;

type BoardRefreshMode = "background" | "initial" | "manual" | "mutation";

type BoardRefreshOptions = {
  includeLabels?: boolean;
  mode?: BoardRefreshMode;
};

function ProjectBoardApp() {
  const projectName = new URLSearchParams(window.location.search).get("projectName") || "Project";
  const projectPath = new URLSearchParams(window.location.search).get("projectPath") || "";
  const displayKey = normalizeDisplayIssueKey(
    new URLSearchParams(window.location.search).get("beadsDisplayKey") ?? projectName,
  );
  const [tickets, setTickets] = useState<BoardTicket[]>([]);
  const [allIssues, setAllIssues] = useState<BeadsIssue[]>([]);
  const [knownLabels, setKnownLabels] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BoardStatusKey | "all">("all");
  const [detail, setDetail] = useState<DetailDraft>({
    blockedByIds: [],
    blockingIds: [],
    comment: "",
    description: "",
    isSaving: false,
    labels: [],
    priority: "2",
    status: "todo",
    title: "",
  });
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [newTicket, setNewTicket] = useState<TicketFormDraft>({
    blockedByIds: [],
    blockingIds: [],
    description: "",
    labels: [],
    priority: "2",
    title: "",
  });
  const [isCreating, setIsCreating] = useState(false);
  /*
   * CDXC:ProjectBoard 2026-05-26-05:38:
   * The Project page must observe Beads changes made by the user's app actions or nearby bd CLI commands without forcing manual Refresh.
   * Poll only while the page is visible, coalesce overlapping refreshes, refresh labels less often than issues, and cap mounted lane/dependency rows so thousand-bead projects do not repeatedly rebuild an unbounded DOM.
   */
  const isRefreshingRef = useRef(false);
  const issuesSignatureRef = useRef("");
  const labelsSignatureRef = useRef("");
  const lastLabelsRefreshAtRef = useRef(0);
  const newPromptRef = useRef<HTMLTextAreaElement>(null);

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
  }, [loadTickets]);

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
  }, [loadTickets]);

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
    setDetail({
      blockedByIds: getBlockedByIds(ticket),
      blockingIds: getBlockingIds(ticket.id, allIssues),
      comment: "",
      description: ticket.description ?? "",
      isSaving: false,
      labels: ticket.labels ?? [],
      priority: String(ticket.priority ?? 2),
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
        isSaving: false,
        labels: nextTicket.labels ?? [],
        priority: String(nextTicket.priority ?? 2),
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
      setDetail({
        blockedByIds: [],
        blockingIds: [],
        comment: "",
        description: "",
        isSaving: false,
        labels: [],
        priority: "2",
        status: "todo",
        title: "",
      });
      await loadTickets({ includeLabels: true, mode: "mutation" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save the ticket.");
      setDetail((current) => ({ ...current, isSaving: false }));
    }
  };

  const createTicket = async () => {
    const prompt = newTicket.description.trim();
    if (!prompt) {
      return;
    }
    setIsCreating(true);
    try {
      let title = newTicket.title.trim();
      if (!title) {
        const generated = normalizeBeadsPayload<{ title?: string }>(
          await runBeads({ action: "generateTitle", prompt }),
          {},
        );
        title = generated.title?.trim() || prompt.slice(0, 39);
      }
      const estimate = tshirtToEstimate(newTicket.tshirt);
      const createdPayload = await runBeads({
        action: "create",
        description: prompt,
        dependsOnId: newTicket.blockedByIds[0],
        estimate,
        labels: newTicket.labels,
        priority: newTicket.priority,
        title,
      });
      const created = normalizeBeadsPayload<BeadsIssue | BeadsIssue[]>(createdPayload, []);
      const createdIssue = Array.isArray(created) ? created[0] : created;
      if (createdIssue?.id) {
        await syncDependencies(createdIssue.id, newTicket.blockedByIds, newTicket.blockingIds);
        if (newTicket.labels.length > 0) {
          await runBeads({
            action: "setLabels",
            issueId: createdIssue.id,
            labels: newTicket.labels,
          });
        }
      }
      setNewTicket({
        blockedByIds: [],
        blockingIds: [],
        description: "",
        labels: [],
        priority: "2",
        title: "",
      });
      setNewTicketOpen(false);
      await loadTickets({ includeLabels: true, mode: "mutation" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create the ticket.");
    } finally {
      setIsCreating(false);
    }
  };

  const startTicketWork = async () => {
    if (!detail.ticket) {
      return;
    }
    try {
      await runBeads({
        action: "updateStatus",
        issueId: detail.ticket.id,
        status: "in_progress",
      });
      const prompt = buildAgentWorkPrompt(detail.ticket);
      await navigator.clipboard?.writeText(prompt);
      setErrorMessage("");
      await loadTickets({ includeLabels: false, mode: "mutation" });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not start ticket work.");
    }
  };

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
            onClick={() => void loadTickets({ includeLabels: true, mode: "manual" })}
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

      {errorMessage ? <ProjectBoardNotice message={errorMessage} /> : null}

      <DragDropProvider onDragEnd={handleDragEnd}>
        <section className="project-board-lanes" aria-label="Project issue board">
          {BOARD_COLUMNS.map((column) => (
            <BoardLane
              column={column}
              key={column.key}
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
            setDetail({
              blockedByIds: [],
              blockingIds: [],
              comment: "",
              description: "",
              isSaving: false,
              labels: [],
              priority: "2",
              status: "todo",
              title: "",
            });
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
                  setDetail((current) => ({ ...current, description: event.target.value }))
                }
                onPaste={(event) => {
                  void pasteImageFromClipboard(event).then((image) => {
                    if (!image) {
                      return;
                    }
                    event.preventDefault();
                    setDetail((current) => ({
                      ...current,
                      description: appendImageMarkdownToDescription(current.description, image),
                    }));
                  });
                }}
                placeholder="Write the full prompt for this ticket."
                value={detail.description}
              />
            </label>
            <ImagePreviewStrip description={detail.description} />
            <DependencySummary
              blockedByIds={detail.blockedByIds}
              blockingIds={detail.blockingIds}
              tickets={tickets}
            />
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
            <Button onClick={() => void startTicketWork()} type="button" variant="outline">
              Start work
            </Button>
            <Button disabled={detail.isSaving} onClick={() => void saveTicketDetail()}>
              {detail.isSaving ? "Saving" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newTicketOpen} onOpenChange={setNewTicketOpen}>
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
                  setNewTicket((current) => ({ ...current, description: event.target.value }))
                }
                onPaste={(event) => {
                  void pasteImageFromClipboard(event).then((image) => {
                    if (!image) {
                      return;
                    }
                    event.preventDefault();
                    setNewTicket((current) => ({
                      ...current,
                      description: appendImageMarkdownToDescription(current.description, image),
                    }));
                  });
                }}
                placeholder="Write the full prompt for this ticket."
                ref={newPromptRef}
                value={newTicket.description}
              />
            </label>
            <ImagePreviewStrip description={newTicket.description} />
          </div>
          <DialogFooter>
            <Button
              disabled={isCreating || !newTicket.description.trim()}
              onClick={() => void createTicket()}
            >
              {isCreating ? "Creating" : "Create"}
            </Button>
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

function ImagePreviewStrip({ description }: { description: string }) {
  const images = extractDescriptionImagePreviews(description);
  if (images.length === 0) {
    return null;
  }
  return (
    <div className="project-ticket-image-strip" aria-label="Image previews">
      {images.map((src, index) => (
        <img alt="" className="project-ticket-image-thumb" key={`${src.slice(0, 32)}-${index}`} src={src} />
      ))}
    </div>
  );
}

function BoardLane({
  column,
  onOpenTicket,
  tickets,
}: {
  column: (typeof BOARD_COLUMNS)[number];
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
            <TicketCard key={ticket.id} onOpenTicket={onOpenTicket} ticket={ticket} />
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
  onOpenTicket,
  ticket,
}: {
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
      </CardContent>
    </Card>
  );
}

function ProjectBoardNotice({ message }: { message: string }) {
  const isMissingProject = /not initialized|no storage|not a beads|bd init|database|\.beads/i.test(message);
  const isMissingBeads =
    !isMissingProject &&
    /executable|command not found|not found: bd|bd: not found|env: bd: no such file|cannot find/i.test(message);
  return (
    <Card className="project-board-notice" size="sm">
      <CardContent>
        <IconAlertTriangle />
        <div>
          <strong>
            {isMissingBeads
              ? "Install Beads"
              : isMissingProject
                ? "Initialize Beads"
                : "Project board unavailable"}
          </strong>
          <p>{isMissingBeads ? INSTALL_BEADS_COMMAND : isMissingProject ? "bd init" : message}</p>
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

function pasteImageFromClipboard(event: {
  clipboardData: DataTransfer;
}): Promise<string | undefined> {
  const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith("image/"));
  if (!item) {
    return Promise.resolve(undefined);
  }
  const file = item.getAsFile();
  if (!file) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : undefined);
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
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

  .project-board-notice {
    background: #201b14;
    border-radius: 8px;
    color: #f7dfb4;
    flex: 0 0 auto;
  }

  .project-board-notice [data-slot="card-content"] {
    align-items: center;
    display: flex;
    gap: 10px;
    padding: 10px 12px;
  }

  .project-ticket-dialog {
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
    justify-content: space-between;
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
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    height: 72px;
    object-fit: cover;
    width: 72px;
  }

  .project-ticket-dependencies {
    color: rgba(244, 244, 245, 0.62);
    font-size: 12px;
  }

  .project-ticket-dependencies p {
    margin: 0 0 4px;
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
    .project-ticket-meta-grid { grid-template-columns: 1fr; }
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<ProjectBoardApp />);
