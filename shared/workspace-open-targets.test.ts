import { describe, expect, test } from "vitest";
import {
  BUILT_IN_WORKSPACE_OPEN_TARGETS,
  normalizeCustomWorkspaceOpenTargets,
  normalizeWorkspaceOpenTargetAvailability,
  normalizeWorkspaceOpenTargetHiddenIds,
} from "./workspace-open-targets";

describe("workspace open targets", () => {
  test("keeps embedded editor first in the built-in catalog", () => {
    /**
     * CDXC:TitlebarOpenIn 2026-05-11-00:22
     * The titlebar Open In dropdown must lead with ghostex's embedded editor
     * before external IDE targets so the primary code-server flow is always
     * the first visible option.
     */
    expect(BUILT_IN_WORKSPACE_OPEN_TARGETS[0]?.id).toBe("embedded-editor");
    expect(BUILT_IN_WORKSPACE_OPEN_TARGETS[0]?.label).toBe("Embedded Editor");
  });

  test("normalizes hidden built-in ids and drops unknown entries", () => {
    expect(normalizeWorkspaceOpenTargetHiddenIds(["cursor", "cursor", "unknown"])).toEqual([
      "cursor",
    ]);
  });

  test("normalizes custom command targets", () => {
    expect(
      normalizeCustomWorkspaceOpenTargets([
        { args: ["--reuse-window"], command: "fleet", id: "custom:fleet", label: "Fleet" },
        { command: "", label: "Broken" },
      ]),
    ).toEqual([
      {
        args: ["--reuse-window"],
        command: "fleet",
        id: "custom:fleet",
        label: "Fleet",
      },
    ]);
  });

  test("normalizes installed target availability separately from hidden ids", () => {
    expect(
      normalizeWorkspaceOpenTargetAvailability({
        availableTargetIds: ["cursor", "unknown"],
        checkedAtMs: 123,
        resolvedAppNames: { cursor: "Cursor", unknown: "Nope" },
        resolvedCommands: { cursor: "cursor", finder: "open", unknown: "nope" },
      }),
    ).toEqual({
      availableTargetIds: ["embedded-editor", "cursor", "finder"],
      checkedAtMs: 123,
      resolvedAppNames: { cursor: "Cursor" },
      resolvedCommands: { cursor: "cursor", finder: "open" },
    });
  });
});
