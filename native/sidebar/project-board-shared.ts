import Fuse from "fuse.js";

/*
  CDXC:ProjectBoard 2026-05-23-14:10:
  Shared Beads board helpers keep display-id formatting, t-shirt estimate mapping, and filter logic consistent between the Project WKWebView surface and future Storybook coverage.
*/

export type BoardStatusKey = "todo" | "in_progress" | "test" | "review" | "done";

export type BeadsComment = {
  author?: string;
  created_at?: string;
  text?: string;
};

export type BeadsDependency = {
  created_at?: string;
  created_by?: string;
  depends_on_id: string;
  issue_id: string;
  type?: string;
};

export type BeadsIssue = {
  assignee?: string;
  blocked_by?: string[];
  blocks?: string[];
  comment_count?: number;
  comments?: BeadsComment[];
  created_at?: string;
  dependencies?: BeadsDependency[];
  dependency_count?: number;
  dependent_count?: number;
  description?: string;
  estimate?: number | null;
  id: string;
  issue_type?: string;
  labels?: string[];
  priority?: number;
  status: string;
  title: string;
  updated_at?: string;
};

export type BoardTicket = BeadsIssue & {
  boardStatus: BoardStatusKey;
  displayId: string;
};

export type BeadsBridgeAction =
  | "addComment"
  | "addLabel"
  | "configGet"
  | "configGetIssuePrefix"
  | "configSet"
  | "configSetIssuePrefix"
  | "create"
  | "delete"
  | "depAdd"
  | "depRemove"
  | "generateTitle"
  | "list"
  | "listIssues"
  | "listAllLabels"
  | "removeLabel"
  | "search"
  | "setLabels"
  | "show"
  | "updateDescription"
  | "updateEstimate"
  | "updatePriority"
  | "updateStatus"
  | "updateTitle";

export type BeadsBridgeRequest = {
  action: BeadsBridgeAction;
  comment?: string;
  cwd: string;
  dependsOnId?: string;
  depType?: string;
  description?: string;
  estimate?: number;
  issueId?: string;
  label?: string;
  labels?: string[];
  priority?: string;
  prompt?: string;
  query?: string;
  requestId: string;
  status?: string;
  title?: string;
  value?: string;
};

export type BeadsBridgeResponse = {
  error?: string;
  exitCode: number;
  requestId: string;
  stderr: string;
  stdout: string;
};

export const BOARD_COLUMNS: Array<{
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

export const PRIORITY_OPTIONS = [
  { label: "P0", value: "0" },
  { label: "P1", value: "1" },
  { label: "P2", value: "2" },
  { label: "P3", value: "3" },
  { label: "P4", value: "4" },
] as const;

export const TSHIRT_OPTIONS = [
  { label: "XS", minutes: 15 },
  { label: "S", minutes: 30 },
  { label: "M", minutes: 60 },
  { label: "L", minutes: 120 },
  { label: "XL", minutes: 240 },
] as const;

export type TshirtSize = (typeof TSHIRT_OPTIONS)[number]["label"];

const REQUIRED_CUSTOM_STATUS_CONFIG = "test,review";

export function beadsStatusToBoardStatus(status: string): BoardStatusKey {
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

export function boardStatusLabel(status: BoardStatusKey): string {
  return BOARD_COLUMNS.find((column) => column.key === status)?.label ?? "Todo";
}

export function boardStatusBeadsValue(status: BoardStatusKey): string {
  return BOARD_COLUMNS.find((column) => column.key === status)?.beadsStatus ?? "open";
}

export function normalizeIssuePrefix(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, "")
    .slice(0, 8);
  if (!normalized) {
    return "zmux";
  }
  return /^[a-z]/u.test(normalized) ? normalized : `p-${normalized}`;
}

export function normalizeDisplayIssueKey(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .slice(0, 3);
  return normalized || "PRJ";
}

export function buildDisplayIdMap(issues: BeadsIssue[]): Map<string, string> {
  const sorted = [...issues].sort((left, right) => {
    const leftTime = Date.parse(left.created_at ?? "");
    const rightTime = Date.parse(right.created_at ?? "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
  return new Map(sorted.map((issue, index) => [issue.id, String(index + 1)]));
}

export function formatTicketDisplayId(
  issue: Pick<BeadsIssue, "id">,
  displayKey: string,
  serialByIssueId: Map<string, string>,
): string {
  const serial = serialByIssueId.get(issue.id);
  return serial ? `${displayKey}-${serial}` : issue.id;
}

export function toBoardTickets(
  issues: BeadsIssue[],
  displayKey: string,
): BoardTicket[] {
  const serialByIssueId = buildDisplayIdMap(issues);
  return issues
    .filter((issue) => issue && typeof issue.id === "string")
    .map((issue) => ({
      ...issue,
      boardStatus: beadsStatusToBoardStatus(issue.status),
      displayId: formatTicketDisplayId(issue, displayKey, serialByIssueId),
    }));
}

export function estimateToTshirt(estimate: number | null | undefined): TshirtSize | undefined {
  if (estimate === null || estimate === undefined) {
    return undefined;
  }
  return TSHIRT_OPTIONS.find((option) => option.minutes === estimate)?.label;
}

export function tshirtToEstimate(label: TshirtSize | undefined): number | undefined {
  if (!label) {
    return undefined;
  }
  return TSHIRT_OPTIONS.find((option) => option.label === label)?.minutes;
}

export function priorityLabel(priority: number | undefined): string {
  const value = priority ?? 2;
  return PRIORITY_OPTIONS.find((option) => Number(option.value) === value)?.label ?? `P${value}`;
}

export function parseBeadsJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  return JSON.parse(trimmed);
}

export function normalizeBeadsPayload<T>(payload: unknown, fallback: T): T {
  if (isRecord(payload) && "data" in payload) {
    return payload.data as T;
  }
  return (payload ?? fallback) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function beadsErrorMessage(message: string): string {
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

export async function ensureWorkflowStatuses(
  runBeads: (request: Omit<BeadsBridgeRequest, "cwd" | "requestId">) => Promise<unknown>,
): Promise<void> {
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

export function filterBoardTickets(
  tickets: BoardTicket[],
  query: string,
  statusFilter: BoardStatusKey | "all",
): BoardTicket[] {
  const normalizedQuery = query.trim();
  let filtered =
    statusFilter === "all"
      ? tickets
      : tickets.filter((ticket) => ticket.boardStatus === statusFilter);
  if (!normalizedQuery) {
    return filtered;
  }
  const fuse = new Fuse(filtered, {
    keys: ["title", "description", "id", "displayId", "labels"],
    threshold: 0.38,
  });
  return fuse.search(normalizedQuery).map((result) => result.item);
}

export function appendImageMarkdownToDescription(
  description: string,
  imagePath: string,
  selectionStart?: number,
  selectionEnd?: number,
): string {
  const snippet = `[Image #${getNextDescriptionImageIndex(description)}](${imagePath})`;
  /**
   * CDXC:ProjectBoardImagePaste 2026-05-28-08:48:
   * Project Board image references are editable prompt text, not hidden metadata.
   * Paste images as visible [Image #N](path) references at the caret so users can
   * write prose around them and refer to each image explicitly in the prompt.
   */
  return insertDescriptionSnippet(description, snippet, selectionStart, selectionEnd);
}

export type DescriptionImageReference = {
  endOffset: number;
  id: string;
  markdown: string;
  src: string;
  startOffset: number;
};

const descriptionImageFileExtensionPattern = /\.(avif|gif|heic|heif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/iu;

function descriptionImageMarkdownPattern(): RegExp {
  return /!?\[[^\]\n]*\]\(([^)\n]+)\)/gu;
}

export function extractDescriptionImageReferences(description: string): DescriptionImageReference[] {
  const references: DescriptionImageReference[] = [];
  for (const match of description.matchAll(descriptionImageMarkdownPattern())) {
    const markdown = match[0];
    const src = (match[1] ?? "").trim();
    if (!isDescriptionImageSource(src)) {
      continue;
    }
    const startOffset = match.index ?? 0;
    references.push({
      endOffset: startOffset + markdown.length,
      id: `${startOffset}:${markdown.length}:${src.slice(0, 64)}`,
      markdown,
      src,
      startOffset,
    });
  }

  let lineStartOffset = 0;
  for (const line of description.split(/(\n)/u)) {
    if (line === "\n") {
      lineStartOffset += line.length;
      continue;
    }
    const src = line.trim();
    if (
      isDescriptionImageSource(src) &&
      !references.some(
        (reference) => lineStartOffset <= reference.startOffset && reference.endOffset <= lineStartOffset + line.length,
      )
    ) {
      const leadingWhitespaceLength = line.length - line.trimStart().length;
      const startOffset = lineStartOffset + leadingWhitespaceLength;
      references.push({
        endOffset: startOffset + src.length,
        id: `${startOffset}:${src.length}:${src.slice(0, 64)}`,
        markdown: src,
        src,
        startOffset,
      });
    }
    lineStartOffset += line.length;
  }

  return references.sort((left, right) => left.startOffset - right.startOffset);
}

export function extractDescriptionImagePreviews(description: string): string[] {
  /**
   * CDXC:ProjectBoardImagePaste 2026-05-28-08:50:
   * The preview strip must update from the image paths users type or paste in
   * the prompt text, including visible [Image #N](path) references and plain
   * standalone image-path lines.
   */
  return previewableDescriptionImageReferences(description).map((reference) => reference.src);
}

export function extractPreviewableDescriptionImageReferences(description: string): DescriptionImageReference[] {
  return previewableDescriptionImageReferences(description);
}

export function removeDescriptionImageReference(description: string, imageId: string): string {
  const reference = extractDescriptionImageReferences(description).find((candidate) => candidate.id === imageId);
  if (!reference) {
    return description;
  }
  return `${description.slice(0, reference.startOffset)}${description.slice(reference.endOffset)}`
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function isDescriptionImageSource(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.toLowerCase().startsWith("data:image/")) {
    return true;
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith("file://") ||
    trimmed.startsWith("~/.ghostex/i/")
  ) {
    return descriptionImageFileExtensionPattern.test(trimmed);
  }
  return false;
}

function getNextDescriptionImageIndex(description: string): number {
  let highestIndex = 0;
  for (const match of description.matchAll(/\[Image #(\d+)\]\(/gu)) {
    const index = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(index)) {
      highestIndex = Math.max(highestIndex, index);
    }
  }
  return highestIndex + 1;
}

function insertDescriptionSnippet(
  description: string,
  snippet: string,
  selectionStart?: number,
  selectionEnd?: number,
): string {
  const start =
    typeof selectionStart === "number" && Number.isFinite(selectionStart)
      ? Math.max(0, Math.min(description.length, selectionStart))
      : description.length;
  const end =
    typeof selectionEnd === "number" && Number.isFinite(selectionEnd)
      ? Math.max(start, Math.min(description.length, selectionEnd))
      : start;
  const prefix = description.slice(0, start);
  const suffix = description.slice(end);
  const before = prefix.length === 0 || prefix.endsWith("\n") ? prefix : `${prefix}\n\n`;
  const after = suffix.length === 0 || suffix.startsWith("\n") ? suffix : `\n\n${suffix}`;
  return `${before}${snippet}${after}`;
}

function persistableDescriptionImageReferences(description: string): DescriptionImageReference[] {
  const references = extractDescriptionImageReferences(description);
  const hasPathReference = references.some((reference) => !isLegacyDataImageSource(reference.src));
  return hasPathReference
    ? references.filter((reference) => !isLegacyDataImageSource(reference.src))
    : references;
}

function previewableDescriptionImageReferences(description: string): DescriptionImageReference[] {
  return persistableDescriptionImageReferences(description);
}

function isLegacyDataImageSource(source: string): boolean {
  return source.trim().toLowerCase().startsWith("data:image/");
}

export function buildAgentWorkPrompt(ticket: BoardTicket): string {
  return [
    `Work on bead ${ticket.id} (${ticket.displayId}): ${ticket.title}`,
    "",
    ticket.description?.trim() || "No prompt provided.",
    "",
    "Status workflow for this project board:",
    "- When you start: `bd update " + ticket.id + " --status in_progress`",
    "- When implementation is ready for test: `bd update " + ticket.id + " --status test`",
    "- When ready for review: `bd update " + ticket.id + " --status review`",
    "- When done: `bd close " + ticket.id + "`",
  ].join("\n");
}

export function getBlockedByIds(issue: BeadsIssue): string[] {
  return (issue.dependencies ?? []).map((dependency) => dependency.depends_on_id).filter(Boolean);
}

export function getBlockingIds(issueId: string, issues: BeadsIssue[]): string[] {
  return issues
    .filter((candidate) =>
      (candidate.dependencies ?? []).some((dependency) => dependency.depends_on_id === issueId),
    )
    .map((candidate) => candidate.id);
}

export function formatShortDate(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
