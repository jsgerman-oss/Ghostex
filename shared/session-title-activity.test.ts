import { describe, expect, test, vi } from "vitest";
import { getTitleDerivedSessionActivityFromTransition } from "./session-title-activity";

describe("Pi title-derived activity", () => {
  test("should detect manual Pi launches and Pi spinner titles", () => {
    const idle = getTitleDerivedSessionActivityFromTransition(undefined, "π - zmux");
    expect(idle?.agentName).toBe("pi");
    expect(idle?.activity).toBe("idle");

    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const working = getTitleDerivedSessionActivityFromTransition(
      "π - zmux",
      "⠸ π - Restore Pi support - zmux",
      idle,
    );

    expect(working?.agentName).toBe("pi");
    expect(working?.activity).toBe("working");
    vi.restoreAllMocks();
  });
});
