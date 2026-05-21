import { describe, expect, test, vi } from "vitest";
import {
  getTitleDerivedSessionActivityFromTransition,
  hasAntigravityCliAttentionTitleMarker,
  hasAntigravityCliIdleTitleMarker,
  hasClaudeCodeWorkingTitleMarker,
  hasCursorCliReadyTitleMarker,
  hasCursorCliWorkingTitleMarker,
} from "./session-title-activity";

describe("Cursor CLI title-derived activity", () => {
  test("should detect Cursor working and ready title suffixes before Claude dot markers", () => {
    const workingTitles = [
      "My Task - ⏳ Working ···",
      "My Task - ⏳ Working .··",
      "My Task - ⏳ Working ..·",
      "- ⏳ Working ..·",
    ];

    for (const title of workingTitles) {
      expect(hasCursorCliWorkingTitleMarker(title)).toBe(true);
      expect(hasClaudeCodeWorkingTitleMarker(title)).toBe(false);

      const derived = getTitleDerivedSessionActivityFromTransition(undefined, title);
      expect(derived?.agentName).toBe("cursor");
      expect(derived?.activity).toBe("working");
    }

    const readyTitle = "My Task - ✅ Ready";
    expect(hasCursorCliReadyTitleMarker(readyTitle)).toBe(true);
    expect(hasClaudeCodeWorkingTitleMarker(readyTitle)).toBe(false);

    const ready = getTitleDerivedSessionActivityFromTransition(
      "My Task - ⏳ Working ···",
      readyTitle,
    );
    expect(ready?.agentName).toBe("cursor");
    expect(ready?.activity).toBe("idle");
  });

  test("should detect the Cursor Agent startup ready title", () => {
    const startupTitle = "Cursor Agent - ✅ Ready";
    expect(hasCursorCliReadyTitleMarker(startupTitle)).toBe(true);
    expect(hasClaudeCodeWorkingTitleMarker(startupTitle)).toBe(false);

    const derived = getTitleDerivedSessionActivityFromTransition(undefined, startupTitle);
    expect(derived?.agentName).toBe("cursor");
    expect(derived?.activity).toBe("idle");
  });

  test("should reclassify a session to Cursor when the terminal title reports Cursor status", () => {
    const derived = getTitleDerivedSessionActivityFromTransition(
      undefined,
      "Investigate icons - ⏳ Working ..·",
      undefined,
      "claude",
    );
    expect(derived?.agentName).toBe("cursor");
    expect(derived?.activity).toBe("working");
  });
});

describe("Antigravity CLI title-derived activity", () => {
  test("should detect agy idle and bell attention titles before Copilot", () => {
    expect(hasAntigravityCliIdleTitleMarker("agy")).toBe(true);
    expect(hasAntigravityCliAttentionTitleMarker("🔔 agy")).toBe(true);

    const idle = getTitleDerivedSessionActivityFromTransition(undefined, "agy");
    expect(idle?.agentName).toBe("antigravity");
    expect(idle?.activity).toBe("idle");

    const attention = getTitleDerivedSessionActivityFromTransition("agy", "🔔 agy", idle);
    expect(attention?.agentName).toBe("antigravity");
    expect(attention?.activity).toBe("attention");
    expect(attention?.hasSeenWorking).toBe(true);

    const copilotMisread = getTitleDerivedSessionActivityFromTransition(undefined, "🔔 agy");
    expect(copilotMisread?.agentName).toBe("antigravity");
  });

  test("should reclassify a session to Antigravity when the terminal title reports agy status", () => {
    const derived = getTitleDerivedSessionActivityFromTransition(undefined, "🔔 agy", undefined, "codex");
    expect(derived?.agentName).toBe("antigravity");
    expect(derived?.activity).toBe("attention");
  });
});

describe("Pi title-derived activity", () => {
  test("should detect manual Pi launches and Pi spinner titles", () => {
    const idle = getTitleDerivedSessionActivityFromTransition(undefined, "π - ghostex");
    expect(idle?.agentName).toBe("pi");
    expect(idle?.activity).toBe("idle");

    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const working = getTitleDerivedSessionActivityFromTransition(
      "π - ghostex",
      "⠸ π - Restore Pi support - ghostex",
      idle,
    );

    expect(working?.agentName).toBe("pi");
    expect(working?.activity).toBe("working");
    vi.restoreAllMocks();
  });
});
