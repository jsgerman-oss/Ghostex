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
