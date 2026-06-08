import { describe, expect, test } from "vitest";
import { resolveNativeSessionTransitionFocusTarget } from "./native-session-transition-focus";

describe("resolveNativeSessionTransitionFocusTarget", () => {
  const baseParams = {
    isLiveProjectCandidate: (sessionId: string) => sessionId !== "sleeping",
    isSleepingCandidate: (candidate: { lifecycleState?: string; sessionId: string }) =>
      candidate.lifecycleState === "sleeping",
    projectId: "P3lv0",
  };

  test("does not choose a replacement when a background project session sleeps", () => {
    expect(
      resolveNativeSessionTransitionFocusTarget({
        ...baseParams,
        action: "sleep",
        isRemovedSessionFocused: false,
        origin: {
          kind: "projectSessionList",
          orderedSessions: [
            { sessionId: "G3l4x" },
            { sessionId: "G3grb" },
            { sessionId: "G9lbz" },
          ],
        },
        removedSessionId: "G3l4x",
      }),
    ).toBeUndefined();
  });

  test("chooses the next live project session when the focused session sleeps", () => {
    expect(
      resolveNativeSessionTransitionFocusTarget({
        ...baseParams,
        action: "sleep",
        isRemovedSessionFocused: true,
        origin: {
          kind: "projectSessionList",
          orderedSessions: [
            { sessionId: "G3l4x" },
            { sessionId: "G3grb" },
            { sessionId: "G9lbz" },
          ],
        },
        removedSessionId: "G3l4x",
      }),
    ).toEqual({
      projectId: "P3lv0",
      reason: "nextLiveProjectSession",
      sessionId: "G3grb",
    });
  });

  test("skips sleeping tab candidates when the focused tab sleeps", () => {
    expect(
      resolveNativeSessionTransitionFocusTarget({
        ...baseParams,
        action: "sleep",
        isRemovedSessionFocused: true,
        origin: {
          kind: "paneTabGroup",
          orderedSessions: [
            { sessionId: "G3l4x" },
            { lifecycleState: "sleeping", sessionId: "sleeping" },
            { sessionId: "G9lbz" },
          ],
        },
        removedSessionId: "G3l4x",
      }),
    ).toEqual({
      projectId: "P3lv0",
      reason: "nextPaneTab",
      sessionId: "G9lbz",
    });
  });
});
