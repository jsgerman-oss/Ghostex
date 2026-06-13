import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native terminal create focus source", () => {
  test("defers zmx workspace create focus until terminalReady layout sync", () => {
    /*
    CDXC:TerminalCreationFocus 2026-06-13-14:00:
    zmx workspace terminal creation must not send a direct native focus before
    Swift has reported terminalReady. Source coverage keeps New Terminal and
    forked-session creates routed through focusAfterReady so setActiveTerminalSet
    owns the first focused layout after the surface exists.
    */
    const createTerminalSource = sourceBetween(
      nativeSidebarSource,
      "function createTerminal(",
      "function createFocusedTabGroupPlacement",
    );
    expect(createTerminalSource).toContain("shouldDeferZmxWorkspaceFocusUntilTerminalReady");
    expect(createTerminalSource).toContain("focusAfterReady: shouldDeferZmxWorkspaceFocusUntilTerminalReady");
    expect(createTerminalSource).toContain('reason: "gxserverAttachCreateTerminalReadyFocus"');
    expect(createTerminalSource).toContain('surface: "workspaceTerminal"');
    expect(createTerminalSource).toContain(
      "deferWorkspaceFocusUntilTerminalReady: shouldDeferZmxWorkspaceFocusUntilTerminalReady",
    );

    const forkSource = sourceBetween(
      nativeSidebarSource,
      "function materializeNativeForkedGxserverSession",
      "function promptDelayedSend",
    );
    expect(forkSource).toContain('reason: "gxserverForkCreateTerminalReadyFocus"');
    expect(forkSource).toContain("deferWorkspaceFocusUntilTerminalReady: true");
  });

  test("keeps immediate gxserver attach focus behind an explicit non-deferred branch", () => {
    const helperSource = sourceBetween(
      nativeSidebarSource,
      "async function postNativeCreateTerminalWithGxserverAttach",
      "function showAppToast",
    );
    expect(helperSource).toContain("deferWorkspaceFocusUntilTerminalReady?: boolean");
    expect(helperSource).toContain("options.deferWorkspaceFocusUntilTerminalReady === true");
    expect(helperSource).toContain("nativeFocusTrace.gxserverAttachFocusDeferredUntilTerminalReady");

    const deferredBranchIndex = helperSource.indexOf(
      "options.deferWorkspaceFocusUntilTerminalReady === true",
    );
    const directFocusIndex = helperSource.indexOf(
      'postNativeFocusTerminalForCurrentIntent(\n        command.sessionId,\n        options.focusIntent,\n        "gxserver-attach-focus-after-create"',
    );
    expect(deferredBranchIndex).toBeGreaterThanOrEqual(0);
    expect(directFocusIndex).toBeGreaterThan(deferredBranchIndex);
  });

  test("publishes native layout before sidebar hydrate when terminalReady consumes deferred focus", () => {
    const eventSource = sourceBetween(
      nativeSidebarSource,
      'window.addEventListener("ghostex-native-host-event"',
      "function handleNativePaneReorderRequested",
    );
    expect(eventSource).toContain("let publishNativeLayoutBeforeSidebarHydrate = false;");
    expect(eventSource).toContain("publish({ nativeLayoutBeforeSidebarHydrate: true });");

    const queueFocusIndex = eventSource.indexOf(
      "queueNativeLayoutFocusRequest(sidebarSessionId, focusAfterReady.reason);",
    );
    const publishNativeFirstIndex = eventSource.indexOf(
      "publishNativeLayoutBeforeSidebarHydrate = true;",
      queueFocusIndex,
    );
    const typingFocusIndex = eventSource.indexOf(
      "postNativeFocusTerminalForCurrentIntent(",
      publishNativeFirstIndex,
    );
    expect(queueFocusIndex).toBeGreaterThanOrEqual(0);
    expect(publishNativeFirstIndex).toBeGreaterThan(queueFocusIndex);
    expect(typingFocusIndex).toBeGreaterThan(publishNativeFirstIndex);
    expect(eventSource).toContain('`${focusAfterReady.reason}:typingFocus`');
  });

  test("keeps presentation pruning from deleting in-flight zmx creates", () => {
    /*
    CDXC:TerminalCreationFocus 2026-06-13-15:44:
    gxserver project deltas can arrive after local zmx create has inserted a
    canonical P/G row but before the presentation stream echoes the new session.
    Source coverage keeps pruneStaleGxserverLocalSessionsFromPresentation from
    closing that row while native createTerminal is still pending.
    */
    const pendingHelperSource = sourceBetween(
      nativeSidebarSource,
      "function isNativeTerminalSurfaceCreationPendingForProject",
      "function markNativeInPlaceReloadClosePending",
    );
    expect(pendingHelperSource).toContain("pendingNativeTerminalSurfaceCreationBySessionId.get(sessionId)");
    expect(pendingHelperSource).toContain("pending.projectId === projectId");

    const pruneSource = sourceBetween(
      nativeSidebarSource,
      "function pruneStaleGxserverLocalSessionsFromPresentation",
      "function clearStaleGxserverLocalSessionRuntime",
    );
    expect(pruneSource).toContain("skippedPendingCreateSessionKeys");
    expect(pruneSource).toContain(
      "isNativeTerminalSurfaceCreationPendingForProject(project.projectId, session.sessionId)",
    );
    expect(pruneSource).toContain("nativeSidebar.gxserver.staleLocalSessionPruneSkippedPendingCreate");

    const missingPresentationIndex = pruneSource.indexOf("presentationSessionKeys.has(");
    const pendingCreateIndex = pruneSource.indexOf(
      "isNativeTerminalSurfaceCreationPendingForProject(project.projectId, session.sessionId)",
    );
    const pruneIndex = pruneSource.indexOf("return true;", pendingCreateIndex);
    expect(missingPresentationIndex).toBeGreaterThanOrEqual(0);
    expect(pendingCreateIndex).toBeGreaterThan(missingPresentationIndex);
    expect(pruneIndex).toBeGreaterThan(pendingCreateIndex);
  });
});
