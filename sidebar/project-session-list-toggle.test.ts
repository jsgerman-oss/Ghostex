import { describe, expect, test } from "vitest";
import {
  PROJECT_SESSION_LIST_COLLAPSED_COUNT,
  getVisibleProjectSessionIds,
  normalizeStoredProjectSessionListCollapsedState,
} from "./project-session-list-toggle";

describe("normalizeStoredProjectSessionListCollapsedState", () => {
  test("keeps only explicitly collapsed project ids", () => {
    expect(
      normalizeStoredProjectSessionListCollapsedState({
        "project-1": true,
        "project-2": false,
        "project-3": "true",
        "": true,
      }),
    ).toEqual({
      "project-1": true,
    });
  });
});

describe("getVisibleProjectSessionIds", () => {
  const sessionIds = Array.from(
    { length: PROJECT_SESSION_LIST_COLLAPSED_COUNT + 2 },
    (_, index) => `session-${index + 1}`,
  );

  test("shows all project sessions by default", () => {
    expect(
      getVisibleProjectSessionIds({
        isCollapsed: false,
        isProjectGroup: true,
        isToggleEnabled: true,
        sessionIds,
      }),
    ).toEqual(sessionIds);
  });

  test("shows the first six project sessions after Show less is selected by default", () => {
    expect(
      getVisibleProjectSessionIds({
        isCollapsed: true,
        isProjectGroup: true,
        isToggleEnabled: true,
        sessionIds,
      }),
    ).toEqual(sessionIds.slice(0, PROJECT_SESSION_LIST_COLLAPSED_COUNT));
  });

  test("uses the configured Show less session count", () => {
    const configuredSessionIds = Array.from({ length: 12 }, (_, index) => `session-${index + 1}`);
    expect(
      getVisibleProjectSessionIds({
        collapsedCount: 10,
        isCollapsed: true,
        isProjectGroup: true,
        isToggleEnabled: true,
        sessionIds: configuredSessionIds,
      }),
    ).toEqual(configuredSessionIds.slice(0, 10));
  });

  test("does not trim non-project or temporarily disabled lists", () => {
    expect(
      getVisibleProjectSessionIds({
        isCollapsed: true,
        isProjectGroup: false,
        isToggleEnabled: true,
        sessionIds,
      }),
    ).toEqual(sessionIds);

    expect(
      getVisibleProjectSessionIds({
        isCollapsed: true,
        isProjectGroup: true,
        isToggleEnabled: false,
        sessionIds,
      }),
    ).toEqual(sessionIds);
  });
});
