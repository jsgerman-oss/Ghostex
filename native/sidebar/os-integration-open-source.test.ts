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

describe("native sidebar OS integration opens", () => {
  test("opens requested files and folders instead of only focusing Code", () => {
    /*
     * CDXC:OSIntegration 2026-06-07-14:39:
     * Finder Open With, default-editor launches, and Ghostex CLI path opens
     * must route the requested file/folder into embedded VS Code. Existing Code
     * panes can already be focused, so source coverage must keep the explicit
     * IPC file-open path in addition to Source-tab focus.
     */
    const projectFileOpen = sourceBetween(
      "async function openNativeProjectEditorForFile(",
      "async function openLooseQuickFile(",
    );
    expect(projectFileOpen).toContain("scheduleCodeServerFileOpen(");
    expect(projectFileOpen).toContain('"openNativeProjectEditorForFile"');
    expect(projectFileOpen).toContain("!target.waitToken");

    const quickFileOpen = sourceBetween(
      "async function openLooseQuickFile(",
      "async function refreshQuickFileMissingStates(",
    );
    expect(quickFileOpen).toContain("scheduleCodeServerFileOpen(");
    expect(quickFileOpen).toContain("path: symlinkPath");

    const cliOpenRouter = sourceBetween(
      "async function openNativePathTargetsFromCli(",
      "async function createNativePluginsBrowserChat(",
    );
    expect(cliOpenRouter).toContain("await openNativeProjectEditorForFile(projectPath);");
    expect(cliOpenRouter).not.toContain("await addProject(projectPath);");

    const ipcOpen = sourceBetween(
      "function codeServerIpcOpenScript(): string",
      "function codeServerIpcWaitScript(): string",
    );
    expect(ipcOpen).toContain('type: "open"');
    expect(ipcOpen).toContain("fileURIs: [openArg]");
    expect(ipcOpen).toContain("forceReuseWindow: true");
  });
});
