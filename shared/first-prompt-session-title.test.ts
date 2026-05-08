import { describe, expect, test } from "vitest";
import {
  explainFirstPromptAutoRenameDecision,
  getCurrentTitleForFirstPromptAutoRename,
  resolveFirstPromptAutoRenameStrategy,
} from "./first-prompt-session-title";

describe("first-prompt auto naming current title selection", () => {
  test("should claim generic titles but preserve meaningful terminal-synced titles", () => {
    /**
     * CDXC:SessionTitleSync 2026-05-08-16:23
     * Codex can publish a good terminal title before the first-prompt hook is
     * polled. That title must count as the current title so the pending prompt
     * does not generate and send a redundant `/rename <generated title>`.
     */
    expect(
      getCurrentTitleForFirstPromptAutoRename({
        agentName: "codex",
        pendingPrompt: "adjust agent icon opacity",
        persistedTitle: undefined,
        sessionTitle: "Codex Session",
        terminalTitle: "Codex Session",
      }),
    ).toBeUndefined();

    expect(
      getCurrentTitleForFirstPromptAutoRename({
        agentName: "codex",
        pendingPrompt: "adjust agent icon opacity",
        persistedTitle: undefined,
        sessionTitle: "Session Icon Opacity States",
        terminalTitle: "Session Icon Opacity States",
      }),
    ).toBe("Session Icon Opacity States");

    expect(
      explainFirstPromptAutoRenameDecision({
        agentName: "codex",
        currentTitle: "Session Icon Opacity States",
        prompt: "adjust agent icon opacity",
      }),
    ).toMatchObject({
      reason: "nonGenericCurrentTitle",
      shouldAutoName: false,
      strategy: "generateTitleAndRename",
    });
  });
});

describe("Pi first-prompt auto naming", () => {
  test("should generate a title and send Pi's name command strategy", () => {
    expect(resolveFirstPromptAutoRenameStrategy("pi")).toBe("generateTitleAndName");
    expect(
      explainFirstPromptAutoRenameDecision({
        agentName: "pi",
        currentTitle: "π - zmux",
        prompt: "Implement first-class Pi restore support",
      }),
    ).toMatchObject({
      reason: "eligible",
      shouldAutoName: true,
      strategy: "generateTitleAndName",
    });
  });
});
