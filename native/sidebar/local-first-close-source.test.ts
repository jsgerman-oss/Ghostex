import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sortableSessionCardSource = readFileSync(
  new URL("../../sidebar/sortable-session-card.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("local-first sidebar close source", () => {
  test("flushes sidebar row removal before background native close work", () => {
    /*
     * CDXC:LocalFirstSidebar 2026-06-12-06:22:
     * Closing a sidebar tab/card must update local React state before native
     * terminal teardown starts. Source coverage keeps the macOS synchronous
     * message bridge from regressing back into blocking the click handler.
     */
    const requestCloseSource = sourceBetween(
      sortableSessionCardSource,
      "  const requestClose = (",
      "  const requestCopyResumeCommand = () => {",
    );
    const postCloseHelperSource = sourceBetween(
      sortableSessionCardSource,
      "function postSidebarSessionCloseInBackground(",
      "function postSidebarSessionsCloseInBackground(",
    );
    const sidebarMessageHandlerIndex = nativeSidebarSource.indexOf(
      "function handleSidebarMessage(message: SidebarToExtensionMessage): void {",
    );
    expect(sidebarMessageHandlerIndex).toBeGreaterThan(-1);
    const sidebarMessageHandlerSource = nativeSidebarSource.slice(sidebarMessageHandlerIndex);
    const nativeCloseCaseSource = sourceBetween(
      sidebarMessageHandlerSource,
      '    case "closeSession":',
      '    case "closeSessions": {',
    );

    expect(requestCloseSource).toContain("flushSync(() => {");
    expect(requestCloseSource.indexOf("flushSync(() => {")).toBeLessThan(
      requestCloseSource.indexOf("postSidebarSessionCloseInBackground(vscode, session.sessionId);"),
    );
    expect(postCloseHelperSource).toContain("globalThis.setTimeout(() => {");
    expect(postCloseHelperSource).toContain('type: "closeSession"');
    expect(nativeCloseCaseSource).toContain("closeNativeSessionsInBackground([message.sessionId]);");
    expect(nativeCloseCaseSource).not.toContain("closeTerminal(message.sessionId);");
  });
});
