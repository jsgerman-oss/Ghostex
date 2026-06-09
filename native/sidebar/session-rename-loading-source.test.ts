import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = nativeSidebarSource.indexOf(start);
  const endIndex = nativeSidebarSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return nativeSidebarSource.slice(startIndex, endIndex);
}

describe("native sidebar generated rename loading", () => {
  test("keeps manual Generate Name overlay active through rename submission", () => {
    /*
    CDXC:SessionRename 2026-06-06-06:51:
    Cmd+R Rename Session with pasted long text should keep "Generating title" visible until the generated rename has completed, matching the first-message auto-title affordance instead of clearing immediately after summarization.
    */
    const terminalStateType = sourceBetween("const terminalStateById = new Map<", "const settledTerminalTitleSyncTimeoutBySessionId");
    expect(terminalStateType).toContain("manualGeneratedRenameInProgress?: boolean");

    const overlayHelper = sourceBetween(
      "function isNativeSessionTitleGenerationOverlayActive",
      "let latestNativeAgentHookStatus",
    );
    expect(overlayHelper).toContain("terminalState?.firstPromptAutoRenameInProgress === true");
    expect(overlayHelper).toContain("terminalState?.manualGeneratedRenameInProgress === true");

    const renameFunction = sourceBetween(
      "async function renameNativeSidebarTerminalSession",
      "function stopNativeSleepingSessionRuntime",
    );
    expect(renameFunction).toContain("setNativeManualGeneratedRenameInProgress(reference.sessionId, true)");
    expect(renameFunction).not.toContain("terminalState.firstPromptAutoRenameInProgress = true");
    expect(renameFunction).not.toContain("finally");

    const commandSubmission = sourceBetween(
      'appendSessionTitleDebugLog("terminalRenameCommand.sent"',
      "}, AUTO_SUBMIT_STAGED_RENAME_DELAY_MS);",
    );
    expect(commandSubmission).toContain("setNativeManualGeneratedRenameInProgress(reference.sessionId, false)");
  });

  test("keeps first-prompt generated title overlay active until native Enter is sent", () => {
    /*
    CDXC:GxserverSessionTitle 2026-06-09-20:21:
    First-prompt generated titles should submit the staged `/rename <title>` through the native Enter bridge before the "Generating title" overlay goes away, so users cannot type into the prompt editor between staging and submit.
    */
    const presentationFunction = sourceBetween(
      "function applyGxserverPresentationSessionToNativePaneChrome",
      "function materializeGxserverPresentationSession",
    );
    expect(presentationFunction).toContain("shouldSubmitGeneratedFirstPromptTitleEnter");
    expect(presentationFunction).toContain("terminalState.firstPromptAutoRenameInProgress = true;");
    expect(presentationFunction).toContain("currentPresentation?.isGeneratingFirstPromptTitle !== true");

    const submitBlock = sourceBetween(
      "if (shouldSubmitGeneratedFirstPromptTitleEnter) {",
      "if (\n    localSession?.kind === \"terminal\"",
    );
    const enterIndex = submitBlock.indexOf('type: "sendTerminalEnter"');
    const clearIndex = submitBlock.indexOf("currentTerminalState.firstPromptAutoRenameInProgress = false");
    expect(enterIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeGreaterThan(enterIndex);
  });
});
