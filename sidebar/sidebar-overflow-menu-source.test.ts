import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sidebarAppSource = readFileSync(new URL("./sidebar-app.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = sidebarAppSource.indexOf(start);
  const endIndex = sidebarAppSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sidebarAppSource.slice(startIndex, endIndex);
}

describe("sidebar overflow menu source", () => {
  test("keeps the setup wizard entry stable when hooks are missing", () => {
    /*
     * CDXC:SidebarSetupWizard 2026-06-07-12:35:
     * The overflow menu's first-launch setup action is named Setup Wizard and
     * must not become a hook-install notice when agent hooks are missing.
     */
    const overflowMenuSource = sourceBetween(
      "function renderFloatingOverflowMenu({",
      "function resolveSessionDropTargetFromPoint",
    );

    expect(overflowMenuSource).toContain("Setup Wizard");
    expect(overflowMenuSource).not.toContain("hasMissingAgentHooks");
    expect(overflowMenuSource).not.toContain("sidebar-hook-warning-menu-item");
    expect(overflowMenuSource).not.toContain("Agent hooks");
  });
});
