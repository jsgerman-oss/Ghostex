import { describe, expect, test } from "vitest";
import {
  appendImageMarkdownToDescription,
  extractDescriptionImagePreviews,
  extractDescriptionImageReferences,
  removeDescriptionImageReference,
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
