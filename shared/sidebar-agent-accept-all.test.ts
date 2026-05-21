import { describe, expect, test } from "vitest";
import {
  applySidebarAgentAcceptAllFlag,
  commandIncludesAcceptAllFlag,
  resolveAgentAcceptAllEnabled,
  resolveSidebarAgentLaunchCommand,
  stripAgentAcceptAllFlags,
} from "./sidebar-agent-accept-all";

describe("resolveAgentAcceptAllEnabled", () => {
  test("should inherit the global Accept All toggle by default", () => {
    expect(resolveAgentAcceptAllEnabled(true, undefined)).toBe(true);
    expect(resolveAgentAcceptAllEnabled(true, "inherit")).toBe(true);
    expect(resolveAgentAcceptAllEnabled(false, undefined)).toBe(false);
  });

  test("should allow per-agent overrides to break inheritance", () => {
    expect(resolveAgentAcceptAllEnabled(true, "disabled")).toBe(false);
    expect(resolveAgentAcceptAllEnabled(false, "enabled")).toBe(true);
  });
});

describe("applySidebarAgentAcceptAllFlag", () => {
  test("should append Codex --yolo once when Accept All is enabled", () => {
    expect(applySidebarAgentAcceptAllFlag("codex", "codex", true)).toBe("codex --yolo");
  });

  test("should never duplicate Codex --yolo when it is already present", () => {
    expect(applySidebarAgentAcceptAllFlag("codex --yolo", "codex", true)).toBe("codex --yolo");
    expect(applySidebarAgentAcceptAllFlag("codex --yolo --yolo", "codex", true)).toBe("codex --yolo");
  });

  test("should only strip Accept All flags for explicit per-agent disable overrides", () => {
    expect(applySidebarAgentAcceptAllFlag("codex --yolo", "codex", false)).toBe("codex --yolo");
    expect(
      applySidebarAgentAcceptAllFlag("codex --yolo", "codex", false, undefined, {
        stripWhenDisabled: true,
      }),
    ).toBe("codex");
  });

  test("should use Antigravity CLI dangerously-skip-permissions flag", () => {
    expect(applySidebarAgentAcceptAllFlag("agy", "antigravity", true)).toBe(
      "agy --dangerously-skip-permissions",
    );
  });

  test("should use Claude's permission bypass flag", () => {
    expect(applySidebarAgentAcceptAllFlag("claude", "claude", true)).toBe(
      "claude --dangerously-skip-permissions",
    );
  });

  test("should treat Gemini -y as an existing Accept All flag", () => {
    expect(applySidebarAgentAcceptAllFlag("gemini -y", "gemini", true)).toBe("gemini -y");
    expect(applySidebarAgentAcceptAllFlag("gemini", "gemini", true)).toBe("gemini --yolo");
  });

  test("should leave Pi without an Accept All flag", () => {
    expect(applySidebarAgentAcceptAllFlag("pi", "pi", true)).toBe("pi");
  });

  test("should inherit custom agent icons from their default engine", () => {
    expect(
      applySidebarAgentAcceptAllFlag("codex --profile fast", "custom-codex", true, "codex"),
    ).toBe("codex --profile fast --yolo");
  });
});

describe("stripAgentAcceptAllFlags", () => {
  test("should detect existing flags after stripping", () => {
    const spec = { aliases: ["--yolo"], canonicalFlag: "--yolo" } as const;
    const stripped = stripAgentAcceptAllFlags("codex --yolo", spec);
    expect(commandIncludesAcceptAllFlag(stripped, spec)).toBe(false);
  });
});

describe("resolveSidebarAgentLaunchCommand", () => {
  test("should resolve launch commands from global and per-agent settings", () => {
    expect(
      resolveSidebarAgentLaunchCommand({
        acceptAllMode: "inherit",
        agentId: "codex",
        command: "codex",
        globalAcceptAllEnabled: true,
      }),
    ).toBe("codex --yolo");

    expect(
      resolveSidebarAgentLaunchCommand({
        acceptAllMode: "disabled",
        agentId: "codex",
        command: "codex --yolo",
        globalAcceptAllEnabled: true,
      }),
    ).toBe("codex");
  });
});
