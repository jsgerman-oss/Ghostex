import { describe, expect, test } from "vitest";
import {
  isGxserverCanonicalProjectsStoragePayload,
  projectStoragePayloadHasLegacyGxserverIds,
} from "./gxserver-sidebar-storage";

describe("native sidebar gxserver project storage", () => {
  test("recognizes migrated canonical project snapshots", () => {
    /*
    CDXC:GxserverVerification 2026-05-30-19:30:
    Migration verification needs a focused client-side guard: once the shared projects file carries the gxserver migration marker or canonical P/G identities, React must treat it as authoritative over any older WK localStorage/sidebar memory.
    */
    expect(
      isGxserverCanonicalProjectsStoragePayload(
        JSON.stringify({
          activeProjectId: "P1abc",
          gxserverMigratedAt: "2026-05-30T15:30:00.000Z",
          projects: [{ projectId: "P1abc", workspace: { groups: [] } }],
        }),
      ),
    ).toBe(true);
    expect(
      isGxserverCanonicalProjectsStoragePayload(
        JSON.stringify({
          activeProjectId: "P2def",
          projects: [{ projectId: "P2def", workspace: { groups: [] } }],
        }),
      ),
    ).toBe(true);
  });

  test("detects legacy project and session identities before persistence", () => {
    const stalePayload = {
      activeProjectId: "project-legacy",
      projects: [
        {
          projectId: "project-legacy",
          workspace: {
            groups: [
              {
                snapshot: {
                  focusedSessionId: "g-old",
                  paneLayout: { kind: "leaf", sessionId: "g-old" },
                  sessions: [{ kind: "terminal", sessionId: "g-old" }],
                  visibleSessionIds: ["g-old"],
                },
              },
            ],
          },
        },
      ],
    };

    expect(projectStoragePayloadHasLegacyGxserverIds(stalePayload)).toBe(true);
    expect(projectStoragePayloadHasLegacyGxserverIds(JSON.stringify(stalePayload))).toBe(true);
    expect(
      projectStoragePayloadHasLegacyGxserverIds({
        activeProjectId: "P1abc",
        projects: [
          {
            projectId: "P1abc",
            workspace: {
              groups: [
                {
                  snapshot: {
                    focusedSessionId: "G1abc",
                    sessions: [{ kind: "terminal", sessionId: "G1abc" }],
                    visibleSessionIds: ["G1abc"],
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toBe(false);
  });

  test("allows migrated client-local browser and T3 pane identities", () => {
    /*
    CDXC:GxserverVerification 2026-05-30-22:45:
    Browser and T3 panes keep client-local sidebar IDs through gxserver migration. The persistence guard should allow those `g-*` pane IDs while continuing to reject daemon-owned terminal rows that still have legacy identity.
    */
    const migratedClientLocalPayload = {
      activeProjectId: "P1abc",
      gxserverMigratedAt: "2026-05-30T18:45:00.000Z",
      projects: [
        {
          projectId: "P1abc",
          workspace: {
            groups: [
              {
                snapshot: {
                  focusedSessionId: "g-0530-180140",
                  paneLayout: {
                    kind: "tabs",
                    selectedSessionId: "g-0530-180140",
                    sessionIds: ["G1abc", "g-0530-180140", "g-0530-180141"],
                  },
                  sessions: [
                    { kind: "terminal", sessionId: "G1abc" },
                    { browser: { url: "https://example.com" }, kind: "browser", sessionId: "g-0530-180140" },
                    { kind: "t3", sessionId: "g-0530-180141", t3: { boundThreadId: "thread-1" } },
                  ],
                  visibleSessionIds: ["G1abc", "g-0530-180140", "g-0530-180141"],
                },
              },
            ],
          },
        },
      ],
    };

    expect(projectStoragePayloadHasLegacyGxserverIds(migratedClientLocalPayload)).toBe(false);
    expect(
      projectStoragePayloadHasLegacyGxserverIds({
        ...migratedClientLocalPayload,
        projects: [
          {
            projectId: "P1abc",
            workspace: {
              groups: [
                {
                  snapshot: {
                    sessions: [
                      { kind: "browser", sessionId: "g-0530-180140" },
                      { kind: "terminal", sessionId: "g-0530-180140" },
                    ],
                    visibleSessionIds: ["g-0530-180140"],
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toBe(true);
  });
});
