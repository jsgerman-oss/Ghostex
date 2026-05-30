import { describe, expect, test } from "vitest";
import {
  appendImageMarkdownToDescription,
  BOARD_COLUMNS,
  beadsStatusToBoardStatus,
  boardStatusBeadsValue,
  buildAgentWorkPrompt,
  extractDescriptionImagePreviews,
  extractDescriptionImageReferences,
  filterBoardTickets,
  priorityLabel,
  prioritySelectValue,
  removeDescriptionImageReference,
  type BoardTicket,
} from "./project-board-shared";

const pngDataUrl = "data:image/png;base64,abc123";
const cleanShotImagePath = "/Users/madda/Library/Application Support/CleanShot/media/media_x/2026-05-23_Ghostex_13-53-53@2x.png";
const savedImagePath = "~/.ghostex/i/260528082700.png";

describe("project board description image helpers", () => {
  test("keeps image references visible in the prompt text", () => {
    const description = `Before\n\n[Image #1](${cleanShotImagePath})\n\nAfter`;

    expect(extractDescriptionImagePreviews(description)).toEqual([cleanShotImagePath]);
  });

  test("inserts pasted image references at the caret", () => {
    const description = "Before after";
    const insertAt = "Before".length;

    expect(appendImageMarkdownToDescription(description, cleanShotImagePath, insertAt, insertAt)).toBe(
      `Before\n\n[Image #1](${cleanShotImagePath})\n\n after`,
    );
  });

  test("numbers pasted image references from existing visible image labels", () => {
    const existingImageMarkdown = `[Image #1](${cleanShotImagePath})`;

    expect(appendImageMarkdownToDescription(`Prompt\n\n${existingImageMarkdown}`, savedImagePath)).toBe(
      `Prompt\n\n${existingImageMarkdown}\n\n[Image #2](${savedImagePath})`,
    );
  });

  test("previews standalone pasted image paths entered in the text", () => {
    const description = `Prompt\n\n${cleanShotImagePath}\n\nNotes`;

    expect(extractDescriptionImagePreviews(description)).toEqual([cleanShotImagePath]);
  });

  test("prefers pasted paths over legacy data URI image Markdown for previews", () => {
    const description = `Prompt\n\n[Image #1](${cleanShotImagePath})\n\n![pasted-image](${pngDataUrl})`;

    expect(extractDescriptionImagePreviews(description)).toEqual([cleanShotImagePath]);
  });

  test("removes a selected thumbnail image from the persisted description", () => {
    const description = `Prompt\n\n[Image #1](${cleanShotImagePath})\n\n[Image #2](${savedImagePath})`;
    const [, secondImage] = extractDescriptionImageReferences(description);

    expect(secondImage).toBeDefined();
    expect(removeDescriptionImageReference(description, secondImage!.id)).toBe(
      `Prompt\n\n[Image #1](${cleanShotImagePath})`,
    );
  });

  test("keeps the preview source list compatible with existing callers", () => {
    const description = `Prompt\n\n![pasted-image](${pngDataUrl})`;

    expect(extractDescriptionImagePreviews(description)).toEqual([pngDataUrl]);
  });
});

describe("project board priority labels", () => {
  test("uses urgency words while preserving numeric bd values", () => {
    expect([0, 1, 2, 3].map((priority) => priorityLabel(priority))).toEqual([
      "Urgent",
      "High",
      "Medium",
      "Low",
    ]);
  });

  test("normalizes legacy P4 values into the visible Low tier", () => {
    expect(priorityLabel(4)).toBe("Low");
    expect(prioritySelectValue(4)).toBe("3");
  });
});

describe("project board filters", () => {
  const tickets: BoardTicket[] = [
    {
      boardStatus: "todo",
      displayId: "ZMX-1",
      estimate: 15,
      id: "urgent-xs",
      priority: 0,
      status: "open",
      title: "Urgent XS task",
    },
    {
      boardStatus: "in_progress",
      displayId: "ZMX-2",
      estimate: null,
      id: "medium-none",
      priority: 2,
      status: "in_progress",
      title: "Medium unestimated task",
    },
    {
      boardStatus: "review",
      displayId: "ZMX-3",
      estimate: 120,
      id: "legacy-low",
      priority: 4,
      status: "review",
      title: "Legacy low task",
    },
  ];

  test("filters by normalized priority and estimate without changing lane status", () => {
    expect(filterBoardTickets(tickets, "", "3", "all").map((ticket) => ticket.id)).toEqual([
      "legacy-low",
    ]);
    expect(filterBoardTickets(tickets, "", "all", "none").map((ticket) => ticket.id)).toEqual([
      "medium-none",
    ]);
    expect(filterBoardTickets(tickets, "", "0", "XS").map((ticket) => ticket.id)).toEqual([
      "urgent-xs",
    ]);
  });
});

describe("buildAgentWorkPrompt", () => {
  const ticket: BoardTicket = {
    boardStatus: "todo",
    displayId: "ZMU-41",
    id: "zmux-zkr",
    priority: 2,
    status: "open",
    title: "Generating title...",
    description: "Document bead progress in comments after each agent turn.",
  };

  test("includes bead comment guidance and status workflow commands", () => {
    const prompt = buildAgentWorkPrompt(ticket);

    expect(prompt).toContain("Work on bead zmux-zkr (ZMU-41): Generating title...");
    expect(prompt).toContain("Document bead progress in comments after each agent turn.");
    expect(prompt).toContain('bd comment zmux-zkr "<summary>"');
    expect(prompt).toContain("user-facing requirements");
    expect(prompt).toContain("Do not list specific files or line numbers.");
    expect(prompt).toContain("bd update zmux-zkr --status backlog");
    expect(prompt).toContain("bd update zmux-zkr --status in_progress");
    expect(prompt).toContain("bd update zmux-zkr --status test");
    expect(prompt).toContain("bd update zmux-zkr --status review");
    expect(prompt).toContain("bd close zmux-zkr");
  });
});

describe("project board statuses", () => {
  test("places Backlog before Todo and persists it as a Beads custom status", () => {
    expect(BOARD_COLUMNS.map((column) => column.key)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "test",
      "review",
      "done",
    ]);
    expect(beadsStatusToBoardStatus("backlog")).toBe("backlog");
    expect(boardStatusBeadsValue("backlog")).toBe("backlog");
  });
});
