import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = nativeSidebarSource.indexOf(start);
  const endIndex = nativeSidebarSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return nativeSidebarSource.slice(startIndex, endIndex);
}

describe("native pane tab gxserver lifecycle", () => {
  test("attaches gxserver-running tabs even when local workspace state still says sleeping", () => {
    /*
     * CDXC:PaneTabs 2026-06-13-16:21:
     * Native tab clicks must use gxserver presentation lifecycle for canonical P/G sessions.
     * A stale local sleeping bit cannot turn a running zmx session tab into an inert placeholder
     * or leave AppKit showing a different mounted sibling.
     */
    const lifecycleHelper = sourceBetween(
      "function getGxserverPresentationLifecycleForLocalNativePaneSession",
      "function handleNativePaneTabSelected",
    );
    expect(lifecycleHelper).toContain('session?.kind !== "terminal"');
    expect(lifecycleHelper).toContain("isCanonicalGxserverProjectSession(projectId, session.sessionId)");
    expect(lifecycleHelper).toContain(
      "findGxserverPresentationSession(projectId, session.sessionId)?.lifecycleState",
    );

    const tabSelection = sourceBetween(
      "function handleNativePaneTabSelected",
      "function handleNativeSleepingPaneWakeRequested",
    );
    expect(tabSelection).toContain("getGxserverPresentationLifecycleForLocalNativePaneSession");
    expect(tabSelection).toContain(
      'selectedSessionBefore?.isSleeping === true && gxserverPresentationLifecycle === "running"',
    );
    expect(tabSelection).toContain('gxserverPresentationLifecycle === "running"');
    expect(tabSelection).toContain('gxserverPresentationLifecycle === "sleeping"');
    expect(tabSelection).toContain(
      "const shouldKeepSleepingPlaceholder = settings.clickToWakeSleepingSessions && wasSleeping",
    );
    expect(tabSelection).toContain(
      "shouldReconcileGxserverRunningPaneTab || (wasSleeping && !shouldKeepSleepingPlaceholder)",
    );
    expect(tabSelection).toContain(
      'gxserverPresentationLifecycle === "running" ? "pane-tab-attach" : "pane-tab-wake"',
    );
    expect(tabSelection).toContain("forceTerminalRestore: wasSleeping || shouldReconcileGxserverRunningPaneTab");
    expect(tabSelection).toContain('? "paneTabAttach"');
  });
});
