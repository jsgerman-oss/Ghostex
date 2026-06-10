import { describe, expect, test } from "vitest";
import type { GxserverPresentationSession } from "../../shared/gxserver-protocol";
import {
  didGxserverProviderTransitionCommit,
  hasGxserverPresentationZmxRuntime,
  shouldSkipNativeSleepRequest,
  shouldUseGxserverProviderTransition,
} from "./gxserver-provider-transition";

function presentation(
  overrides: Partial<Pick<GxserverPresentationSession, "surface" | "zmxName">> = {},
): Pick<GxserverPresentationSession, "surface" | "zmxName"> {
  return {
    surface: "workspace",
    zmxName: "P1.S2",
    ...overrides,
  };
}

describe("gxserver provider transition ownership", () => {
  test("uses provider transition for presentation-backed zmx sessions without local provider metadata", () => {
    expect(
      shouldUseGxserverProviderTransition({
        localProvider: undefined,
        presentation: presentation(),
      }),
    ).toBe(true);
  });

  test("does not treat providerless local sessions as zmx without presentation identity", () => {
    expect(
      shouldUseGxserverProviderTransition({
        localProvider: undefined,
        presentation: undefined,
      }),
    ).toBe(false);
  });

  test("requires workspace presentation and a non-empty zmx name", () => {
    expect(hasGxserverPresentationZmxRuntime(presentation({ surface: "commands" }))).toBe(false);
    expect(hasGxserverPresentationZmxRuntime(presentation({ zmxName: " " }))).toBe(false);
  });

  test("does not skip stale sleeping rows when a zmx provider transition is available", () => {
    expect(
      shouldSkipNativeSleepRequest({
        isLocalSessionSleeping: false,
        presentationLifecycleState: "sleeping",
        usesGxserverProviderTransition: true,
      }),
    ).toBe(false);
    expect(
      shouldSkipNativeSleepRequest({
        isLocalSessionSleeping: true,
        presentationLifecycleState: "sleeping",
        usesGxserverProviderTransition: false,
      }),
    ).toBe(true);
  });

  test("requires provider kill completion before native commits sleep state", () => {
    expect(
      didGxserverProviderTransitionCommit({
        action: "sleep",
        session: {
          lifecycleState: "sleeping",
          providerState: { lifecycleState: "missing" },
        },
        transition: { kill: { killed: true } },
      }),
    ).toBe(true);

    expect(
      didGxserverProviderTransitionCommit({
        action: "sleep",
        session: {
          lifecycleState: "unknown",
          providerState: { lifecycleState: "unknown" },
        },
        transition: { kill: { killed: false } },
      }),
    ).toBe(false);
  });
});
