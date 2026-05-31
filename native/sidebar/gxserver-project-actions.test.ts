import { describe, expect, test } from "vitest";
import type { GxserverProjectDomainState } from "../../shared/gxserver-protocol";
import {
  mergeGxserverAgentsIntoSidebarStore,
  mergeGxserverProjectActionsIntoCommandsStore,
  readGxserverGitPreferences,
} from "./gxserver-project-actions";

function project(
  projectId: string,
  overrides: Partial<GxserverProjectDomainState> = {},
): GxserverProjectDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-30T19:59:00.000Z",
    customAgentOrder: [],
    customAgents: [],
    customCommandOrder: ["dev", "ship"],
    customCommands: [
      {
        actionType: "terminal",
        closeTerminalOnExit: false,
        command: "bun run start",
        commandId: "dev",
        isDefault: true,
        name: "Dev",
        playCompletionSound: true,
      },
      {
        actionType: "terminal",
        closeTerminalOnExit: false,
        command: "npm run ship",
        commandId: "ship",
        isDefault: false,
        name: "Ship",
        playCompletionSound: true,
      },
    ],
    deletedDefaultCommandIds: ["test"],
    gitConfig: {},
    isFavorite: false,
    isPinned: false,
    launchSettings: {},
    name: projectId,
    notificationRules: {},
    previousSessionHistory: [],
    projectBoardConfig: {},
    projectId: projectId as GxserverProjectDomainState["projectId"],
    runtimeSettings: {},
    updatedAt: "2026-05-30T19:59:00.000Z",
    ...overrides,
  };
}

describe("gxserver project actions hydration", () => {
  test("restores action cache when migrated P-id project has an empty local store", () => {
    /*
    CDXC:ProjectActions 2026-05-30-23:59:
    Regression coverage for the first gxserver migration: legacy actions were imported into SQLite but the sidebar seeded empty local P-id command stores, making the Actions menu look blank until gxserver state rehydrates the cache.
    */
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        P3lv0: { commands: [], deletedDefaultCommandIds: [], order: [] },
      },
      [project("P3lv0")],
    );

    expect(result.changed).toBe(true);
    expect(result.restoredOwnerIds).toEqual(["P3lv0"]);
    expect(result.store.P3lv0?.commands.map((command) => command.commandId)).toEqual([
      "dev",
      "ship",
    ]);
    expect(result.store.P3lv0?.order).toEqual(["dev", "ship"]);
    expect(result.store.P3lv0?.deletedDefaultCommandIds).toEqual(["test"]);
  });

  test("does not overwrite non-empty local action edits", () => {
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        P3lv0: {
          commands: [
            {
              actionType: "terminal",
              closeTerminalOnExit: false,
              command: "pnpm dev",
              commandId: "dev",
              isDefault: true,
              name: "Local Dev",
              playCompletionSound: true,
            },
          ],
          deletedDefaultCommandIds: [],
          order: ["dev"],
        },
      },
      [project("P3lv0")],
    );

    expect(result.changed).toBe(false);
    expect(result.store.P3lv0?.commands[0]?.name).toBe("Local Dev");
  });

  test("hydrates worktree projects under their parent action owner", () => {
    const result = mergeGxserverProjectActionsIntoCommandsStore(
      {
        Pparent: { commands: [], deletedDefaultCommandIds: [], order: [] },
      },
      [project("Pchild")],
      { Pchild: "Pparent" },
    );

    expect(result.changed).toBe(true);
    expect(result.restoredOwnerIds).toEqual(["Pparent"]);
    expect(result.store.Pparent?.commands.length).toBe(2);
  });
});

describe("gxserver shared sidebar state hydration", () => {
  test("restores empty custom agent cache from gxserver projects", () => {
    const result = mergeGxserverAgentsIntoSidebarStore([], [], [
      project("P3lv0", {
        customAgentOrder: ["custom-shipper"],
        customAgents: [
          {
            agentId: "custom-shipper",
            command: "ship-agent",
            isDefault: false,
            name: "Shipper",
          },
        ],
      }),
    ]);

    expect(result.changed).toBe(true);
    expect(result.agents[0]?.agentId).toBe("custom-shipper");
    expect(result.order).toEqual(["custom-shipper"]);
  });

  test("does not overwrite non-empty custom agent cache", () => {
    const result = mergeGxserverAgentsIntoSidebarStore(
      [
        {
          agentId: "local-agent",
          command: "local",
          isDefault: false,
          name: "Local",
        },
      ],
      ["local-agent"],
      [
        project("P3lv0", {
          customAgentOrder: ["server-agent"],
          customAgents: [
            {
              agentId: "server-agent",
              command: "server",
              isDefault: false,
              name: "Server",
            },
          ],
        }),
      ],
    );

    expect(result.changed).toBe(false);
    expect(result.agents[0]?.agentId).toBe("local-agent");
    expect(result.order).toEqual(["local-agent"]);
  });

  test("reads git preferences imported into gxserver project config", () => {
    expect(
      readGxserverGitPreferences([
        project("P3lv0", {
          gitConfig: {
            confirmCommit: true,
            generateCommitBody: false,
            primaryAction: "push",
          },
        }),
      ]),
    ).toEqual({
      confirmCommit: true,
      generateCommitBody: false,
      primaryAction: "push",
    });
  });
});
