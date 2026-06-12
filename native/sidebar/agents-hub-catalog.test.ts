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

describe("Native Agents Hub catalog source", () => {
  test("resolves the sidebar helper runtime from the bundled code-server Node", () => {
    /*
     * CDXC:AgentsHub 2026-06-12-03:05:
     * Agents Hub native helper scripts must use the same app-bundled
     * code-server Node as gxserver. The sidebar resource directory is already
     * the Web directory, so adding "../code-server" points at an unbundled
     * Resources/code-server path and leaves the hub stuck loading.
     */
    const nodePathSource = sourceBetween(
      "function nativeSidebarBundledCodeServerNodePath",
      "function nativeNodeUnavailableResult",
    );
    expect(nodePathSource).toContain("/code-server/lib/node");
    expect(nodePathSource).not.toContain("../code-server/lib/node");
    expect(nodePathSource.indexOf("const bundledNodePath")).toBeLessThan(
      nodePathSource.indexOf("const statusNodePath"),
    );
  });

  test("keeps catalog rows metadata-only and reads selected file content separately", () => {
    /*
     * CDXC:AgentsHub 2026-06-12-02:53:
     * Agents Hub must render large agent/profile trees without sending every
     * file buffer through the native process-result bridge. The catalog source
     * should therefore build file rows from metadata, while a selected-file
     * helper owns the smaller editor-buffer read.
     */
    const fileItemSource = sourceBetween(
      "function fileItem(candidatePath, root)",
      "function addGroup(tab, groupId, name, rootPath, description, files, groupProfiles)",
    );
    expect(fileItemSource).toContain("isReadableCatalogFile(resolved)");
    expect(fileItemSource).toContain("return { id: fileId(resolved)");
    expect(fileItemSource).not.toContain("content, id");

    const contentRequestSource = sourceBetween(
      "async function requestAgentsHubFileContent",
      "function getAgentsHubCatalogNodeScript()",
    );
    expect(contentRequestSource).toContain('type: "agentsHubFileContent"');
    expect(contentRequestSource).toContain('fs.readFileSync(filePath, "utf8")');
  });

  test("classifies discrete hook files under Hooks instead of Configs", () => {
    /**
     * CDXC:AgentsHub 2026-06-04-19:45:
     * The macOS app builds Agents Hub through an embedded bundled-Node catalog, not Electron main.
     * Hook-specific files should appear in the Hooks tab because Agents Hub search and browsing are tab-scoped.
     *
     * CDXC:AgentsHub 2026-06-10-18:17:
     * The catalog source must stay Node-based so Agents Hub does not depend on Python being installed on the user's machine.
     */
    const hookGroups = sourceBetween('addGroup("hooks", "hooks-codex-main"', 'addGroup("hooks", "hooks-pi-agent"');
    expect(hookGroups).toContain('p(".codex", "hooks.json")');
    expect(hookGroups).toContain('p(".cursor", "hooks.json")');
    expect(hookGroups).toContain('p(".gemini", "config", "hooks.json")');
    expect(hookGroups).toContain('p(".grok", "hooks", "ghostex-session.json")');

    const codexMainConfigGroup = sourceBetween(
      'addGroup("configs", "config-codex-main"',
      'for (const item of profiles.filter((profileItem) => profileItem.agentIcon === "codex"',
    );
    expect(codexMainConfigGroup).toContain('p(".codex", "config.toml")');
    expect(codexMainConfigGroup).not.toContain('p(".codex", "hooks.json")');

    const codexProfileConfigGroup = sourceBetween(
      'const files = existing([path.join(root, "config.toml")',
      'addGroup("configs", "config-opencode"',
    );
    expect(codexProfileConfigGroup).not.toContain('path.join(root, "hooks.json")');
  });
});
