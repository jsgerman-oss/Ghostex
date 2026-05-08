import { describe, expect, test } from "vitest";
import {
  expandCollapsedGroupsById,
  getAutoCollapseGroupIds,
  getBrowserSessionCountsByGroup,
  reconcileCollapsedGroupsById,
} from "./browser-group-collapse";

describe("getBrowserSessionCountsByGroup", () => {
  test("should count browser sessions per browser group", () => {
    expect(
      getBrowserSessionCountsByGroup({
        browserGroupIds: ["browser-tabs", "preview-tabs"],
        sessionIdsByGroup: {
          "browser-tabs": ["browser-1", "browser-2"],
          "preview-tabs": [],
          "workspace-1": ["session-1"],
        },
      }),
    ).toEqual({
      "browser-tabs": 2,
      "preview-tabs": 0,
    });
  });
});

describe("getAutoCollapseGroupIds", () => {
  test("keeps empty project groups out of combined auto-collapse", () => {
    /**
     * CDXC:ProjectGroups 2026-05-06-18:42
     * Empty project groups must remain expandable because their body contains
     * the editor button. Browser and non-project combined groups can still use
     * automatic empty-collapse behavior.
     */
    expect(
      getAutoCollapseGroupIds({
        browserGroupIds: ["browser-tabs"],
        groupsById: {
          "combined-chats": {},
          "project-zmux": { projectContext: {} },
        },
        isCombinedSidebarMode: true,
        workspaceGroupIds: ["combined-chats", "project-zmux"],
      }),
    ).toEqual(["browser-tabs", "combined-chats"]);
  });

  test("only auto-collapses browser groups outside combined mode", () => {
    expect(
      getAutoCollapseGroupIds({
        browserGroupIds: ["browser-tabs"],
        groupsById: {
          "group-1": {},
        },
        isCombinedSidebarMode: false,
        workspaceGroupIds: ["group-1"],
      }),
    ).toEqual(["browser-tabs"]);
  });
});

describe("reconcileCollapsedGroupsById", () => {
  test("should drop collapse state for removed groups", () => {
    expect(
      reconcileCollapsedGroupsById({
        browserGroupIds: [],
        groupIds: ["group-1"],
        previousSessionCountsByGroup: {},
        previousCollapsedGroupsById: {
          "group-1": true,
          "group-2": true,
        },
        sessionIdsByGroup: {
          "group-1": ["session-1"],
        },
      }),
    ).toEqual({
      "group-1": true,
    });
  });

  test("should collapse a newly-seen empty browser group by default", () => {
    expect(
      reconcileCollapsedGroupsById({
        browserGroupIds: ["browser-tabs"],
        groupIds: ["browser-tabs", "group-1"],
        previousSessionCountsByGroup: {},
        previousCollapsedGroupsById: {},
        sessionIdsByGroup: {
          "browser-tabs": [],
          "group-1": ["session-1"],
        },
      }),
    ).toEqual({
      "browser-tabs": true,
    });
  });

  test("should expand a collapsed browser group when a browser is added", () => {
    expect(
      reconcileCollapsedGroupsById({
        browserGroupIds: ["browser-tabs"],
        groupIds: ["browser-tabs", "group-1"],
        previousSessionCountsByGroup: {
          "browser-tabs": 0,
        },
        previousCollapsedGroupsById: {
          "browser-tabs": true,
        },
        sessionIdsByGroup: {
          "browser-tabs": ["browser-1"],
          "group-1": ["session-1"],
        },
      }),
    ).toEqual({});
  });

  test("should collapse a browser group again when its last browser closes", () => {
    expect(
      reconcileCollapsedGroupsById({
        browserGroupIds: ["browser-tabs"],
        groupIds: ["browser-tabs", "group-1"],
        previousSessionCountsByGroup: {
          "browser-tabs": 2,
        },
        previousCollapsedGroupsById: {},
        sessionIdsByGroup: {
          "browser-tabs": [],
          "group-1": ["session-1"],
        },
      }),
    ).toEqual({
      "browser-tabs": true,
    });
  });

  test("should auto-collapse empty combined project and chats groups", () => {
    expect(
      reconcileCollapsedGroupsById({
        autoCollapseGroupIds: ["combined-chats", "project-zmux"],
        browserGroupIds: [],
        groupIds: ["combined-chats", "project-zmux"],
        previousSessionCountsByGroup: {},
        previousCollapsedGroupsById: {},
        sessionIdsByGroup: {
          "combined-chats": [],
          "project-zmux": [],
        },
      }),
    ).toEqual({
      "combined-chats": true,
      "project-zmux": true,
    });
  });

  test("should expand a collapsed combined group when a session is created", () => {
    expect(
      reconcileCollapsedGroupsById({
        autoCollapseGroupIds: ["combined-chats", "project-zmux"],
        browserGroupIds: [],
        groupIds: ["combined-chats", "project-zmux"],
        previousSessionCountsByGroup: {
          "combined-chats": 0,
          "project-zmux": 0,
        },
        previousCollapsedGroupsById: {
          "combined-chats": true,
          "project-zmux": true,
        },
        sessionIdsByGroup: {
          "combined-chats": ["chat-session-1"],
          "project-zmux": ["session-1"],
        },
      }),
    ).toEqual({});
  });

  test("should expand a collapsed project group when a session is created without auto-collapsing empty projects", () => {
    /**
     * CDXC:SidebarGroups 2026-05-08-11:09
     * Project groups do not use empty auto-collapse because empty projects
     * expose project controls, but a newly added terminal/browser/agent session
     * inside a collapsed project must still expand that project.
     */
    expect(
      reconcileCollapsedGroupsById({
        autoCollapseGroupIds: ["combined-chats"],
        browserGroupIds: [],
        expandOnSessionCountIncreaseGroupIds: ["combined-chats", "project-zmux"],
        groupIds: ["combined-chats", "project-zmux"],
        previousSessionCountsByGroup: {
          "combined-chats": 1,
          "project-zmux": 1,
        },
        previousCollapsedGroupsById: {
          "combined-chats": true,
          "project-zmux": true,
        },
        sessionIdsByGroup: {
          "combined-chats": ["chat-session-1"],
          "project-zmux": ["session-1", "session-2"],
        },
      }),
    ).toEqual({
      "combined-chats": true,
    });
  });

  test("should defer browser auto-collapse while a browser open is still settling", () => {
    expect(
      reconcileCollapsedGroupsById({
        browserGroupIds: ["browser-tabs"],
        collapseBlockedGroupIds: ["browser-tabs"],
        groupIds: ["browser-tabs", "group-1"],
        previousSessionCountsByGroup: {
          "browser-tabs": 1,
        },
        previousCollapsedGroupsById: {},
        sessionIdsByGroup: {
          "browser-tabs": [],
          "group-1": ["session-1"],
        },
      }),
    ).toEqual({});
  });

  test("should keep other collapsed groups untouched when browser counts stay flat", () => {
    const collapsedGroupsById = {
      "browser-tabs": true,
      "group-1": true,
    } satisfies Record<string, true>;

    expect(
      reconcileCollapsedGroupsById({
        browserGroupIds: ["browser-tabs"],
        groupIds: ["browser-tabs", "group-1"],
        previousSessionCountsByGroup: {
          "browser-tabs": 1,
        },
        previousCollapsedGroupsById: collapsedGroupsById,
        sessionIdsByGroup: {
          "browser-tabs": ["browser-1"],
          "group-1": ["session-1"],
        },
      }),
    ).toBe(collapsedGroupsById);
  });
});

describe("expandCollapsedGroupsById", () => {
  test("should expand only the requested groups", () => {
    expect(
      expandCollapsedGroupsById({
        groupIds: ["browser-tabs"],
        previousCollapsedGroupsById: {
          "browser-tabs": true,
          "group-1": true,
        },
      }),
    ).toEqual({
      "group-1": true,
    });
  });

  test("should preserve the same object when nothing changes", () => {
    const collapsedGroupsById = {
      "group-1": true,
    } satisfies Record<string, true>;

    expect(
      expandCollapsedGroupsById({
        groupIds: ["browser-tabs"],
        previousCollapsedGroupsById: collapsedGroupsById,
      }),
    ).toBe(collapsedGroupsById);
  });
});
