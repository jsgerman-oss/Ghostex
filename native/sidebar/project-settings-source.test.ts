import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("project settings project list source", () => {
  test("hides generated chat and remote attach projects from settings", () => {
    /*
     * CDXC:ProjectSettings 2026-06-10-14:04:
     * Settings Projects must show only user-owned main projects. Generated chat-session folders and remote attach carriers can arrive from gxserver without local quick-project markers, so the Settings projection needs direct path/type filtering.
     */
    const settingsVisibility = sourceBetween(
      nativeSidebarSource,
      "function shouldHideProjectFromSettingsProjectList",
      "function quickKindForProject",
    );
    expect(settingsVisibility).toContain("isNativeChatProjectPath(projectPath)");
    expect(settingsVisibility).toContain("isRemoteAttachCarrierProject(project)");
    expect(settingsVisibility).toContain("isRemoteAttachCarrierProject(localProject)");

    const settingsProjects = sourceBetween(
      nativeSidebarSource,
      "function createSidebarProjectSettingsProjects",
      "function findLocalProjectForGxserverProject",
    );
    expect(settingsProjects).toContain("shouldHideProjectFromSettingsProjectList(project, localProject)");
    expect(settingsProjects).toContain("shouldHideProjectFromSettingsProjectList(project)");
  });
});
