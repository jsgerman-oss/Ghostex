import { describe, expect, test } from "vitest";
import {
  compareRecentProjectsByClosedAt,
  countRecentProjectSessions,
} from "./recent-projects";
import {
  createDefaultGroupedSessionWorkspaceSnapshot,
} from "../../shared/session-grid-contract";
import { createSessionInSimpleWorkspace } from "../../shared/simple-grouped-session-workspace-state";

describe("recent projects", () => {
  test("counts empty projects without treating them as preserved sessions", () => {
    const project = {
      workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
    };

    expect(countRecentProjectSessions(project)).toBe(0);
  });

  test("counts sleeping sessions so startup keeps the project visible", () => {
    const created = createSessionInSimpleWorkspace(createDefaultGroupedSessionWorkspaceSnapshot(), {
      title: "Sleeping session",
    });
    const workspace = {
      ...created.snapshot,
      groups: created.snapshot.groups.map((group) => ({
        ...group,
        snapshot: {
          ...group.snapshot,
          sessions: group.snapshot.sessions.map((session) => ({
            ...session,
            isSleeping: true,
          })),
        },
      })),
    };

    expect(countRecentProjectSessions({ workspace })).toBe(1);
  });

  test("sorts recent projects by last closed time descending", () => {
    const projects = [
      {
        recentClosedAt: "2026-05-04T10:00:00.000Z",
        workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
      },
      {
        recentClosedAt: "2026-05-04T12:00:00.000Z",
        workspace: createDefaultGroupedSessionWorkspaceSnapshot(),
      },
    ];

    expect([...projects].sort(compareRecentProjectsByClosedAt)).toEqual([
      projects[1],
      projects[0],
    ]);
  });
});
