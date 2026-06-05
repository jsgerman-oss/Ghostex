import { describe, expect, test } from "vitest";
import { shouldSubmitStagedGeneratedFirstPromptTitle } from "./first-prompt-title-submit";

describe("first-prompt generated title submit decision", () => {
  test("submits only when a running title job finishes with a generated title", () => {
    const generatedPresentation = {
      isGeneratingFirstPromptTitle: false,
      titleSource: "generated",
    } as const;

    expect(shouldSubmitStagedGeneratedFirstPromptTitle(true, generatedPresentation)).toBe(true);
  });

  test("does not submit restored generated titles without an active running transition", () => {
    const generatedPresentation = {
      isGeneratingFirstPromptTitle: false,
      titleSource: "generated",
    } as const;

    expect(shouldSubmitStagedGeneratedFirstPromptTitle(false, generatedPresentation)).toBe(false);
  });

  test("does not submit while generation is still running", () => {
    expect(
      shouldSubmitStagedGeneratedFirstPromptTitle(true, {
        isGeneratingFirstPromptTitle: true,
        titleSource: "generated",
      }),
    ).toBe(false);
  });

  test("does not submit skipped or non-generated title transitions", () => {
    expect(
      shouldSubmitStagedGeneratedFirstPromptTitle(true, {
        isGeneratingFirstPromptTitle: false,
        titleSource: "terminal-auto",
      }),
    ).toBe(false);
  });
});
