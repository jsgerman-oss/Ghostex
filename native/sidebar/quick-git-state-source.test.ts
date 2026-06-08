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

describe("native sidebar Quick Git state", () => {
  test("does not probe Git endpoints for Quick session containers", () => {
    /*
     * CDXC:QuickSessions 2026-06-08-08:27:
     * Opening a Quick terminal should create and focus the terminal without a Git-scope error toast. Quick containers are not code projects, so source coverage keeps the local Quick guard before gxserver Git/diff endpoint calls.
     */
    const gitRefreshSource = sourceBetween(
      "async function refreshGitState()",
      "function parseGitNumstat",
    );
    const quickGuardIndex = gitRefreshSource.indexOf("isQuickProject(project)");
    const gitProbeIndex = gitRefreshSource.indexOf(
      'runGxserverGitActionForNativeProject(project, { action: "isInsideWorkTree" })',
    );

    expect(quickGuardIndex).toBeGreaterThanOrEqual(0);
    expect(gitProbeIndex).toBeGreaterThan(quickGuardIndex);
    expect(gitRefreshSource).toContain("gitState = { ...baseState, isBusy: false, isRepo: false };");

    const visibleDiffSource = sourceBetween(
      "async function refreshVisibleProjectDiffStats()",
      "async function refreshProjectDiffStats",
    );
    expect(visibleDiffSource).toContain("!isQuickProject(project)");

    const projectDiffSource = sourceBetween(
      "async function refreshProjectDiffStats",
      "async function refreshRemoteProjectDiffStats",
    );
    expect(projectDiffSource).toContain("if (!project || isQuickProject(project))");
  });
});
