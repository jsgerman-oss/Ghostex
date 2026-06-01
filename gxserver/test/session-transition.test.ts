import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSessionTransitionParams, resolveSessionTransitionFocusTarget } from "../src/session-transition/index.js";
import type {
  GxserverProjectId,
  GxserverSessionDomainState,
  GxserverSessionId,
} from "../protocol/index.js";

test("project-list transition skips sleeping and non-live sessions in visual order", async () => {
  const sessions = [
    sessionFixture("G0001", { providerLifecycleState: "exists" }),
    sessionFixture("G0002", { providerLifecycleState: "exists" }),
    sessionFixture("G0003", { providerLifecycleState: "missing" }),
    sessionFixture("G0004", { lifecycleState: "sleeping", providerLifecycleState: "exists" }),
  ];

  const target = await resolveSessionTransitionFocusTarget({
    isLiveProjectSession: (session) => session.providerState.lifecycleState === "exists",
    params: normalizeSessionTransitionParams({
      action: "close",
      origin: {
        kind: "projectSessionList",
        orderedSessions: ["G0002", "G0003", "G0004", "G0001"].map((sessionId) => ({ sessionId })),
      },
      projectId: "P0001",
      sessionId: "G0002",
    }),
    sessions,
  });

  assert.deepEqual(target, {
    projectId: "P0001",
    reason: "nextLiveProjectSession",
    sessionId: "G0001",
  });
});

test("pane-tab close selects the next tab to the right without live-provider filtering", async () => {
  const target = await resolveSessionTransitionFocusTarget({
    isLiveProjectSession: () => false,
    params: normalizeSessionTransitionParams({
      action: "close",
      origin: {
        kind: "paneTabGroup",
        orderedSessions: ["G0001", "G0002", "G0003"].map((sessionId) => ({ sessionId })),
      },
      projectId: "P0001",
      sessionId: "G0002",
    }),
    sessions: [
      sessionFixture("G0001", { providerLifecycleState: "exists" }),
      sessionFixture("G0002", { providerLifecycleState: "exists" }),
      sessionFixture("G0003", { providerLifecycleState: "missing" }),
    ],
  });

  assert.deepEqual(target, {
    projectId: "P0001",
    reason: "nextPaneTab",
    sessionId: "G0003",
  });
});

test("pane-tab close can select a native tab that is not a gxserver domain session", async () => {
  const target = await resolveSessionTransitionFocusTarget({
    isLiveProjectSession: () => false,
    params: normalizeSessionTransitionParams({
      action: "close",
      origin: {
        kind: "paneTabGroup",
        orderedSessions: [{ sessionId: "G0001" }, { sessionId: "G0002" }, { sessionId: "native-tab" }],
      },
      projectId: "P0001",
      sessionId: "G0002",
    }),
    sessions: [
      sessionFixture("G0001", { providerLifecycleState: "exists" }),
      sessionFixture("G0002", { providerLifecycleState: "exists" }),
    ],
  });

  assert.deepEqual(target, {
    projectId: "P0001",
    reason: "nextPaneTab",
    sessionId: "native-tab",
  });
});

test("pane-tab sleep skips sleeping tab candidates", async () => {
  const target = await resolveSessionTransitionFocusTarget({
    isLiveProjectSession: () => false,
    params: normalizeSessionTransitionParams({
      action: "sleep",
      origin: {
        kind: "paneTabGroup",
        orderedSessions: [
          { sessionId: "G0001" },
          { sessionId: "G0002" },
          { lifecycleState: "sleeping", sessionId: "native-sleeping-tab" },
          { sessionId: "G0004" },
        ],
      },
      projectId: "P0001",
      sessionId: "G0002",
    }),
    sessions: [
      sessionFixture("G0001", { providerLifecycleState: "exists" }),
      sessionFixture("G0002", { providerLifecycleState: "exists" }),
      sessionFixture("G0003", { lifecycleState: "sleeping", providerLifecycleState: "exists" }),
      sessionFixture("G0004", { providerLifecycleState: "missing" }),
    ],
  });

  assert.deepEqual(target, {
    projectId: "P0001",
    reason: "nextPaneTab",
    sessionId: "G0004",
  });
});

function sessionFixture(
  sessionId: GxserverSessionId,
  options: {
    lifecycleState?: GxserverSessionDomainState["lifecycleState"];
    providerLifecycleState?: GxserverSessionDomainState["providerState"]["lifecycleState"];
  } = {},
): GxserverSessionDomainState {
  const projectId = "P0001" as GxserverProjectId;
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-06-01T06:51:00.000Z",
    globalRef: `S7k:${projectId}:${sessionId}`,
    hiddenMetadata: {},
    isFavorite: false,
    isPinned: false,
    kind: "terminal",
    launchSettings: {},
    lifecycleState: options.lifecycleState ?? "running",
    notificationRules: {},
    projectId,
    providerState: {
      lifecycleState: options.providerLifecycleState ?? "unknown",
      zmxName: `${projectId}-${sessionId}`,
    },
    runtimeSettings: {},
    sessionId,
    surface: "workspace",
    title: sessionId,
    updatedAt: "2026-06-01T06:51:00.000Z",
    zmxName: `${projectId}-${sessionId}`,
  };
}
