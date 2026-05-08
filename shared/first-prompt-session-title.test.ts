import { describe, expect, test } from "vitest";
import {
  explainFirstPromptAutoRenameDecision,
  resolveFirstPromptAutoRenameStrategy,
} from "./first-prompt-session-title";

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
