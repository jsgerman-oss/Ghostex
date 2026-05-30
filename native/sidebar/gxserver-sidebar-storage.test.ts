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
});
