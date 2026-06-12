import { describe, expect, test } from "vitest";
import { shouldSubmitStagedFirstPromptTitleCommand } from "./first-prompt-title-submit";

describe("first-prompt title command submit decision", () => {
  test("submits only when a running title job finishes with a generated title", () => {
    const generatedPresentation = {
      isGeneratingFirstPromptTitle: false,
      titleSource: "generated",
    } as const;

    expect(shouldSubmitStagedFirstPromptTitleCommand(true, generatedPresentation)).toBe(true);
  });

  test("submits a staged bare provider rename command from gxserver", () => {
    /*
    CDXC:GxserverSessionTitle 2026-06-12-07:08:
    Claude self-generates its title after receiving a bare `/rename`, so native should submit gxserver-staged first-prompt commands from the explicit presentation flag without requiring `titleSource: generated`.
    */
    expect(
      shouldSubmitStagedFirstPromptTitleCommand(true, {
        isGeneratingFirstPromptTitle: false,
        shouldSubmitStagedFirstPromptTitleCommand: true,
        titleSource: "placeholder",
      }),
    ).toBe(true);
  });

  test("does not submit restored generated titles without an active running transition", () => {
    const generatedPresentation = {
      isGeneratingFirstPromptTitle: false,
      titleSource: "generated",
    } as const;

    expect(shouldSubmitStagedFirstPromptTitleCommand(false, generatedPresentation)).toBe(false);
  });

  test("does not submit while generation is still running", () => {
    expect(
      shouldSubmitStagedFirstPromptTitleCommand(true, {
        isGeneratingFirstPromptTitle: true,
        shouldSubmitStagedFirstPromptTitleCommand: true,
        titleSource: "generated",
      }),
    ).toBe(false);
  });

  test("does not submit skipped or non-generated title transitions", () => {
    expect(
      shouldSubmitStagedFirstPromptTitleCommand(true, {
        isGeneratingFirstPromptTitle: false,
        titleSource: "terminal-auto",
      }),
    ).toBe(false);
  });
});
