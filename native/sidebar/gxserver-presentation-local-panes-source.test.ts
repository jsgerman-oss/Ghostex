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

describe("gxserver presentation local panes", () => {
  test("keeps native-only T3 and browser panes visible in gxserver-owned project groups", () => {
    /*
    CDXC:T3Code 2026-06-07-01:17:
    gxserver presentation owns terminal rows, but T3 Code and browser panes are native-only sessions. Normal project sidebar groups must merge those local pane cards so a pane that exists in native tabs also has a React sidebar row.
    */
    const projectGroupProjection = sourceBetween(
      nativeSidebarSource,
      "function createPresentationProjectSidebarGroup",
      "function createLocalOnlyPaneSidebarSessionsForPresentationProject",
    );
    expect(projectGroupProjection).toContain("const presentationSessionIds = new Set");
    expect(projectGroupProjection).toContain("const localPaneSessions = createLocalOnlyPaneSidebarSessionsForPresentationProject");
    expect(projectGroupProjection).toContain("const sidebarSessions = [...presentationSidebarSessions, ...localPaneSessions]");

    const localPaneProjection = sourceBetween(
      nativeSidebarSource,
      "function createLocalOnlyPaneSidebarSessionsForPresentationProject",
      "function createPresentationSidebarSession",
    );
    expect(localPaneProjection).toContain("createProjectedSidebarGroupsForProject(project)");
    expect(localPaneProjection).toContain('session.sessionKind === "t3" || session.sessionKind === "browser"');
    expect(localPaneProjection).toContain("!presentationSessionIds.has(session.sessionId)");
    expect(localPaneProjection).toContain("sessionId: createCombinedProjectSessionId(project.projectId, session.sessionId)");
  });
});
