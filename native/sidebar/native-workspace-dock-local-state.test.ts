import { describe, expect, test } from "vitest";
import { countRemovableWorkspaceDockProjects } from "./native-workspace-dock-local-state";

describe("native workspace dock local state", () => {
  test("uses native project count before gxserver presentation is available", () => {
    expect(countRemovableWorkspaceDockProjects({ localProjectCount: 1 })).toBe(1);
  });

  test("counts visible gxserver presentation projects plus local Quick dock rows", () => {
    /*
    CDXC:WorkspaceDock 2026-06-02-17:06:
    The workspace dock can render gxserver presentation projects before a native project row exists. The remove guard must use the visible dock project ids so a presentation-only P project can still be removed while local Quick panes remain protected as macOS-owned dock rows.
    */
    expect(
      countRemovableWorkspaceDockProjects({
        hiddenPresentationProjectIds: new Set(["P2bbb"]),
        localProjectCount: 1,
        localQuickProjectIds: ["quick-browser"],
        presentationProjectIds: ["P1aaa", "P2bbb", "P1aaa"],
      }),
    ).toBe(2);
  });
});
