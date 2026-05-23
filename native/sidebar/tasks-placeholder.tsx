import {
  IconAlertTriangle,
  IconMessageCircle,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import "../../sidebar/styles/shadcn.generated.css";

type BoardStatusKey = "todo" | "in_progress" | "test" | "review" | "done";
type LoadState = "idle" | "loading" | "ready" | "error";

type BeadsIssue = {
  assignee?: string;
  comment_count?: number;
  comments?: BeadsComment[];
  created_at?: string;
  description?: string;
  id: string;
  issue_type?: string;
  labels?: string[];
  priority?: number;
  status: string;
  title: string;
  updated_at?: string;
};

type BeadsComment = {
  author?: string;
  created_at?: string;
  text?: string;
};

type BoardTicket = BeadsIssue & {
  boardStatus: BoardStatusKey;
};

type BeadsBridgeAction =
  | "addComment"
  | "configGet"
  | "configSet"
  | "create"
  | "list"
  | "show"
  | "updateDescription"
  | "updateStatus";

type BeadsBridgeRequest = {
  action: BeadsBridgeAction;
  comment?: string;
  cwd: string;
  description?: string;
  issueId?: string;
  requestId: string;
  status?: string;
  title?: string;
  value?: string;
};

type BeadsBridgeResponse = {
  error?: string;
  exitCode: number;
  requestId: string;
  stderr: string;
  stdout: string;
};

type DragEndPayload = Parameters<
  NonNullable<ComponentProps<typeof DragDropProvider>["onDragEnd"]>
>[0];

type DetailDraft = {
  comment: string;
  description: string;
  isSaving: boolean;
  ticket?: BoardTicket;
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
/*
  CDXC:ProjectBoard 2026-05-23-03:23:
  The board needs Beads custom statuses for Test and Review, but upstream bd 0.29 validates updates against bare status names even when config accepts category annotations.
  Store test/review as bare custom statuses so moving cards through the board works with the installed upstream CLI instead of writing config the updater rejects.
*/
const REQUIRED_CUSTOM_STATUS_CONFIG = "test,review";

const columns: Array<{
  key: BoardStatusKey;
  label: string;
  beadsStatus: string;
  tone: string;
}> = [
  { key: "todo", label: "Todo", beadsStatus: "open", tone: "neutral" },
  { key: "in_progress", label: "In Progress", beadsStatus: "in_progress", tone: "blue" },
  { key: "test", label: "Test", beadsStatus: "test", tone: "amber" },
  { key: "review", label: "Review", beadsStatus: "review", tone: "violet" },
  { key: "done", label: "Done", beadsStatus: "closed", tone: "green" },
];

function ProjectBoardApp() {
  const projectName = new URLSearchParams(window.location.search).get("projectName") || "Project";
  const projectPath = new URLSearchParams(window.location.search).get("projectPath") || "";
  const [tickets, setTickets] = useState<BoardTicket[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [detail, setDetail] = useState<DetailDraft>({
    comment: "",
    description: "",
    isSaving: false,
  });
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketDescription, setNewTicketDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const runBeads = useCallback(
    async (request: Omit<BeadsBridgeRequest, "cwd" | "requestId">) => {
      if (!projectPath) {
        throw new Error("No active project path is available.");
      }
      const response = await sendBeadsRequest({
        ...request,
        cwd: projectPath,
      });
      if (response.exitCode !== 0) {
        throw new Error(beadsErrorMessage(response.stderr || response.stdout));
      }
      return parseBeadsJson(response.stdout);
    },
    [projectPath],
  );

  const loadTickets = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage("");
    try {
      await ensureWorkflowStatuses(runBeads);
      const payload = await runBeads({ action: "list" });
      const issues = normalizeBeadsPayload<BeadsIssue[]>(payload, []);
      setTickets(
        issues
          .filter((issue) => issue && typeof issue.id === "string")
          .map((issue) => ({
            ...issue,
            boardStatus: beadsStatusToBoardStatus(issue.status),
          })),
      );
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Could not load Beads issues.");
    }
  }, [runBeads]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const ticketsByColumn = useMemo(() => {
    return columns.reduce<Record<BoardStatusKey, BoardTicket[]>>(
      (result, column) => {
        result[column.key] = tickets.filter((ticket) => ticket.boardStatus === column.key);
        return result;
      },
      { done: [], in_progress: [], review: [], test: [], todo: [] },
    );
  }, [tickets]);

  const openTicket = async (ticket: BoardTicket) => {
    setDetail({
      comment: "",
      description: ticket.description ?? "",
      isSaving: false,
      ticket,
    });
    try {
      const payload = await runBeads({ action: "show", issueId: ticket.id });
      const issue = normalizeBeadsPayload<BeadsIssue>(payload, ticket);
      const nextTicket = {
        ...ticket,
        ...issue,
        boardStatus: beadsStatusToBoardStatus(issue.status ?? ticket.status),
      };
      setDetail({
        comment: "",
        description: nextTicket.description ?? "",
        isSaving: false,
        ticket: nextTicket,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not load the ticket.");
    }
  };

  const moveTicket = async (ticketId: string, statusKey: BoardStatusKey) => {
    const column = columns.find((candidate) => candidate.key === statusKey);
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
      void loadTickets();
    } catch (error) {
      setTickets((current) =>
        current.map((candidate) => (candidate.id === ticketId ? ticket : candidate)),
      );
      setErrorMessage(error instanceof Error ? error.message : "Could not move the ticket.");
    }
  };

  const handleDragEnd = (event: DragEndPayload) => {
    if (event.canceled) {
      return;
    }
    const ticketId = String(event.operation.source?.id ?? "");
    const statusKey = event.operation.target?.id as BoardStatusKey | undefined;
    if (ticketId && statusKey) {
      void moveTicket(ticketId, statusKey);
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
        action: "updateDescription",
        description: detail.description,
        issueId: detail.ticket.id,
      });
      if (trimmedComment) {
        await runBeads({
          action: "addComment",
          comment: trimmedComment,
          issueId: detail.ticket.id,
        });
      }
      await openTicket(detail.ticket);
      void loadTickets();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not save the ticket.");
      setDetail((current) => ({ ...current, isSaving: false }));
    }
  };

  const createTicket = async () => {
    const title = newTicketTitle.trim();
    if (!title) {
      return;
    }
    setIsCreating(true);
    try {
      await runBeads({
        action: "create",
        description: newTicketDescription,
        title,
      });
      setNewTicketTitle("");
      setNewTicketDescription("");
      setNewTicketOpen(false);
      await loadTickets();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create the ticket.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="project-board-shell">
      {/*
        CDXC:ProjectBoard 2026-05-23-03:00:
        The Project titlebar tab now needs to be a real Linear-style board, not a placeholder.
        Render five first-class swimlanes, allow drag/drop status updates through dnd-kit, and keep ticket prompt text plus comments in a detail dialog.

        CDXC:ProjectBoard 2026-05-23-03:00:
        The backend must use the upstream Beads CLI directly so task history remains in the repository's shared Beads/Dolt data.
        The React surface asks native to execute whitelisted bd commands in the active project directory and shows install/init guidance when bd is unavailable or the project has not been initialized.
      */}
      <section className="project-board-toolbar">
        <div>
          <p className="project-board-eyebrow">{projectName}</p>
          <h1>Project</h1>
        </div>
        <div className="project-board-toolbar-actions">
          <Button
            aria-label="Refresh board"
            disabled={loadState === "loading"}
            onClick={() => void loadTickets()}
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

      {errorMessage ? <ProjectBoardNotice message={errorMessage} /> : null}

      <DragDropProvider onDragEnd={handleDragEnd}>
        <section className="project-board-lanes" aria-label="Project issue board">
          {columns.map((column) => (
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
            setDetail({ comment: "", description: "", isSaving: false });
          }
        }}
      >
        <DialogContent className="project-ticket-dialog">
          <DialogHeader>
            <DialogTitle>{detail.ticket?.title ?? "Ticket"}</DialogTitle>
            <DialogDescription>
              {detail.ticket?.id} · {detail.ticket ? boardStatusLabel(detail.ticket.boardStatus) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="project-ticket-dialog-body">
            <label className="project-ticket-field">
              <span>Prompt</span>
              <Textarea
                onChange={(event) =>
                  setDetail((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Write the full prompt for this ticket."
                value={detail.description}
              />
            </label>
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
          <DialogFooter>
            <Button disabled={detail.isSaving} onClick={saveTicketDetail}>
              {detail.isSaving ? "Saving" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newTicketOpen} onOpenChange={setNewTicketOpen}>
        <DialogContent className="project-ticket-dialog">
          <DialogHeader>
            <DialogTitle>New Ticket</DialogTitle>
            <DialogDescription>Create a Beads issue in Todo.</DialogDescription>
          </DialogHeader>
          <div className="project-ticket-dialog-body">
            <label className="project-ticket-field">
              <span>Title</span>
              <Textarea
                className="project-ticket-title-input"
                onChange={(event) => setNewTicketTitle(event.target.value)}
                placeholder="Ticket title"
                value={newTicketTitle}
              />
            </label>
            <label className="project-ticket-field">
              <span>Prompt</span>
              <Textarea
                onChange={(event) => setNewTicketDescription(event.target.value)}
                placeholder="Write the full prompt for this ticket."
                value={newTicketDescription}
              />
            </label>
          </div>
          <DialogFooter>
            <Button disabled={isCreating || !newTicketTitle.trim()} onClick={createTicket}>
              {isCreating ? "Creating" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function BoardLane({
  column,
  onOpenTicket,
  tickets,
}: {
  column: (typeof columns)[number];
  onOpenTicket: (ticket: BoardTicket) => void;
  tickets: BoardTicket[];
}) {
  const { isDropTarget, ref } = useDroppable({
    accept: "ticket",
    data: { statusKey: column.key },
    id: column.key,
  });

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
      <ScrollArea className="project-board-lane-scroll">
        <div className="project-board-card-stack">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} onOpenTicket={onOpenTicket} ticket={ticket} />
          ))}
        </div>
      </ScrollArea>
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
        <CardDescription>{ticket.id}</CardDescription>
      </CardHeader>
      <CardContent className="project-board-card-content">
        <p>{ticket.description || "No prompt yet."}</p>
        <Separator />
        <div className="project-board-card-meta">
          <span className="project-board-priority">P{ticket.priority ?? 2}</span>
          <span>{ticket.issue_type || "task"}</span>
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
  /*
    CDXC:ProjectBoard 2026-05-23-08:52:
    Installed Beads can still return messages that mention "bd" when the project needs initialization.
    Only classify executable launch failures as missing Beads so the board does not tell users to reinstall an already-installed CLI.
  */
  const isMissingProject = /not initialized|no storage|not a beads|bd init|database|\.beads/i.test(message);
  const isMissingBeads =
    !isMissingProject &&
    /executable|command not found|not found: bd|bd: not found|env: bd: no such file|cannot find/i.test(message);
  return (
    <Card className="project-board-notice" size="sm">
      <CardContent>
        <IconAlertTriangle />
        <div>
          <strong>{isMissingBeads ? "Install Beads" : isMissingProject ? "Initialize Beads" : "Project board unavailable"}</strong>
          <p>{isMissingBeads ? INSTALL_BEADS_COMMAND : isMissingProject ? "bd init" : message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

async function ensureWorkflowStatuses(
  runBeads: (request: Omit<BeadsBridgeRequest, "cwd" | "requestId">) => Promise<unknown>,
) {
  const payload = await runBeads({ action: "configGet" });
  const currentValue = normalizeBeadsPayload<{ value?: string }>(payload, {}).value ?? "";
  const requiredEntries = REQUIRED_CUSTOM_STATUS_CONFIG.split(",");
  const requiredNames = new Set(requiredEntries.map((entry) => entry.split(":")[0]));
  const currentEntries = currentValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const currentNames = new Set(currentEntries.map((entry) => entry.split(":")[0]));
  const nextEntries = currentEntries.map((entry) => {
    const name = entry.split(":")[0];
    return requiredNames.has(name) ? name : entry;
  });
  for (const entry of requiredEntries) {
    const name = entry.split(":")[0];
    if (!currentNames.has(name)) {
      nextEntries.push(entry);
    }
  }
  const nextValue = nextEntries.join(",");
  if (nextValue !== currentValue) {
    await runBeads({ action: "configSet", value: nextValue });
  }
}

function sendBeadsRequest(
  request: Omit<BeadsBridgeRequest, "requestId">,
): Promise<BeadsBridgeResponse> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener(BRIDGE_RESPONSE_EVENT, onResponse);
      reject(new Error("Beads command timed out."));
    }, 30_000);
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
    console.info(`${BRIDGE_REQUEST_PREFIX}${JSON.stringify(message)}`);
  });
}

function parseBeadsJson(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  return JSON.parse(trimmed);
}

function normalizeBeadsPayload<T>(payload: unknown, fallback: T): T {
  if (isRecord(payload) && "data" in payload) {
    return payload.data as T;
  }
  return (payload ?? fallback) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function beadsStatusToBoardStatus(status: string): BoardStatusKey {
  switch (status) {
    case "closed":
      return "done";
    case "in_progress":
      return "in_progress";
    case "review":
      return "review";
    case "test":
      return "test";
    default:
      return "todo";
  }
}

function boardStatusLabel(status: BoardStatusKey) {
  return columns.find((column) => column.key === status)?.label ?? "Todo";
}

function beadsErrorMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    return "The Beads command failed.";
  }
  try {
    const payload = JSON.parse(trimmed);
    if (payload?.error) {
      return String(payload.error);
    }
  } catch {
    // Human stderr is the normal Beads failure path.
  }
  return trimmed;
}

function formatShortDate(value?: string) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

  * {
    box-sizing: border-box;
  }

  body {
    background: #101112;
    margin: 0;
    min-height: 100vh;
  }

  .project-board-shell {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0) 160px),
      #101112;
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-height: 100vh;
    overflow: hidden;
    padding: 22px 24px 24px;
  }

  .project-board-toolbar {
    align-items: center;
    display: flex;
    gap: 20px;
    justify-content: space-between;
    min-height: 44px;
  }

  .project-board-toolbar h1 {
    color: rgba(250, 250, 250, 0.96);
    font-size: 21px;
    font-weight: 650;
    letter-spacing: 0;
    line-height: 1.2;
    margin: 2px 0 0;
  }

  .project-board-eyebrow {
    color: rgba(244, 244, 245, 0.48);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0;
    line-height: 1;
    margin: 0;
  }

  .project-board-toolbar-actions {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  .project-board-lanes {
    align-items: stretch;
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(5, minmax(218px, 1fr));
    min-height: 0;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .project-board-lane {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 118px);
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
    letter-spacing: 0;
    line-height: 1;
    margin: 0;
  }

  .project-board-lane-dot {
    background: rgba(244, 244, 245, 0.42);
    border-radius: 999px;
    display: inline-block;
    height: 7px;
    width: 7px;
  }

  .project-board-lane[data-tone="blue"] .project-board-lane-dot {
    background: #5ea4ff;
  }

  .project-board-lane[data-tone="amber"] .project-board-lane-dot {
    background: #e7b85b;
  }

  .project-board-lane[data-tone="violet"] .project-board-lane-dot {
    background: #b18cff;
  }

  .project-board-lane[data-tone="green"] .project-board-lane-dot {
    background: #6fcf97;
  }

  .project-board-lane-scroll {
    flex: 1 1 auto;
    min-height: 0;
  }

  .project-board-card-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 8px 10px;
  }

  .project-board-card {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0)),
      #1a1b1d;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.28);
    cursor: default;
    gap: 0;
    padding: 0;
  }

  .project-board-card:hover {
    background-color: #202124;
  }

  .project-board-card[data-dragging="true"] {
    opacity: 0.55;
  }

  .project-board-card-header {
    gap: 5px;
    padding: 11px 12px 0;
  }

  .project-board-card-header [data-slot="card-title"] {
    color: rgba(250, 250, 250, 0.91);
    font-size: 13px;
    font-weight: 560;
    letter-spacing: 0;
    line-height: 1.35;
  }

  .project-board-card-header [data-slot="card-description"] {
    color: rgba(244, 244, 245, 0.39);
    font-size: 11px;
    letter-spacing: 0;
    line-height: 1;
  }

  .project-board-card-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
  }

  .project-board-card-meta {
    align-items: center;
    color: rgba(244, 244, 245, 0.46);
    display: flex;
    font-size: 11px;
    gap: 8px;
    justify-content: space-between;
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
    padding: 0;
  }

  .project-board-notice [data-slot="card-content"] {
    align-items: center;
    display: flex;
    gap: 10px;
    padding: 10px 12px;
  }

  .project-board-notice svg {
    flex: 0 0 auto;
    height: 18px;
    width: 18px;
  }

  .project-board-notice strong {
    color: #ffe6b6;
    display: block;
    font-size: 12px;
    line-height: 1.2;
  }

  .project-board-notice p {
    color: rgba(255, 230, 182, 0.76);
    font-family: "SF Mono", ui-monospace, monospace;
    font-size: 12px;
    margin: 2px 0 0;
  }

  .project-ticket-dialog {
    border-radius: 12px;
    max-width: min(780px, calc(100vw - 44px));
    width: 780px;
  }

  .project-ticket-dialog-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
  }

  .project-ticket-field {
    color: rgba(244, 244, 245, 0.58);
    display: flex;
    flex-direction: column;
    font-size: 12px;
    font-weight: 600;
    gap: 7px;
    letter-spacing: 0;
  }

  .project-ticket-field textarea {
    color: rgba(250, 250, 250, 0.92);
    min-height: 190px;
  }

  .project-ticket-title-input {
    min-height: 58px !important;
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
    letter-spacing: 0;
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

  .project-ticket-comment div {
    align-items: baseline;
    display: flex;
    gap: 8px;
  }

  .project-ticket-comment strong {
    color: rgba(250, 250, 250, 0.88);
    font-size: 12px;
  }

  .project-ticket-comment span,
  .project-ticket-empty {
    color: rgba(244, 244, 245, 0.42);
    font-size: 12px;
  }

  .project-ticket-comment p {
    color: rgba(244, 244, 245, 0.72);
    font-size: 13px;
    line-height: 1.45;
    margin: 6px 0 0;
    white-space: pre-wrap;
  }

  @media (max-width: 900px) {
    .project-board-shell {
      padding: 18px 16px;
    }

    .project-board-lanes {
      grid-template-columns: repeat(5, minmax(210px, 1fr));
    }
  }
`;
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<ProjectBoardApp />);
