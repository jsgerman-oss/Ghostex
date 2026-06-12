import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const settingsModalSource = readFileSync(
  new URL("../../sidebar/settings-modal.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native sidebar App Shots source", () => {
  test("stages captured app context in any live agent session", () => {
    /*
     * CDXC:AppShots 2026-06-12-11:12:
     * App Shots are an agent-session workflow, not a Codex-specific workflow.
     * The native sidebar should reuse the focused or recent live agent session
     * and create the configured default prompt agent only when no agent target
     * is available.
     */
    const appShotsSource = sourceBetween(
      nativeSidebarSource,
      "function handleNativeAppShotCaptured",
      "function formatNativeAppShotPrompt",
    );

    expect(appShotsSource).toContain("stageNativeAppShotInAgentSession");
    expect(appShotsSource).toContain("const agent = resolveDefaultPromptAgent()");
    expect(appShotsSource).toContain("isNativeAppShotAgentSession(recentTarget)");
    expect(appShotsSource).toContain("isNativeAppShotAgentSession(focusedSession)");
    expect(appShotsSource).toContain("return Boolean(agentName)");
    expect(appShotsSource).not.toContain("resolveSidebarAgentButtonById(DEFAULT_PROMPT_AGENT_ID)");
    expect(appShotsSource).not.toContain("agentName === DEFAULT_PROMPT_AGENT_ID");
    expect(appShotsSource).not.toContain("Codex agent is available for App Shots");
    expect(appShotsSource).not.toContain("Codex session for the App Shot");
  });

  test("keeps App Shots failure diagnostics free of raw app names and paths", () => {
    const captureHandlerSource = sourceBetween(
      nativeSidebarSource,
      "function handleNativeAppShotCaptured",
      "/*\nCDXC:AppShots",
    );

    expect(captureHandlerSource).toContain("hasAppName");
    expect(captureHandlerSource).toContain("hasImagePath");
    expect(captureHandlerSource).toContain("errorName");
    expect(captureHandlerSource).not.toContain("appName: appShot.appName");
    expect(captureHandlerSource).not.toContain("imagePath: appShot.imagePath");
    expect(captureHandlerSource).not.toContain("message,");
  });

  test("describes App Shots as an agent-session feature in Settings", () => {
    const settingsSource = sourceBetween(
      settingsModalSource,
      "CDXC:AppShots 2026-06-12-11:12:",
      'title="Desktop Control Runtime"',
    );

    expect(settingsSource).toContain("focused or recent agent session");
    expect(settingsSource).not.toContain("recent Codex session");
  });
});
