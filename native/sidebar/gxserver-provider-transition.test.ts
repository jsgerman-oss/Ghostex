import { describe, expect, test } from "vitest";
import type { GxserverPresentationSession } from "../../shared/gxserver-protocol";
import {
  hasGxserverPresentationZmxRuntime,
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
});
