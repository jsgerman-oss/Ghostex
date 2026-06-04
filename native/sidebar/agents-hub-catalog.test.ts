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
     * The macOS app builds Agents Hub through an embedded Python catalog, not Electron main.
     * Hook-specific files should appear in the Hooks tab because Agents Hub search and browsing are tab-scoped.
     */
    const hookGroups = sourceBetween('add_group("hooks", "hooks-codex-main"', 'add_group("hooks", "hooks-pi-agent"');
    expect(hookGroups).toContain('p(".codex", "hooks.json")');
    expect(hookGroups).toContain('p(".cursor", "hooks.json")');
    expect(hookGroups).toContain('p(".gemini", "config", "hooks.json")');
    expect(hookGroups).toContain('p(".grok", "hooks", "ghostex-session.json")');

    const codexMainConfigGroup = sourceBetween('add_group("configs", "config-codex-main"', "for item in [profile_item");
    expect(codexMainConfigGroup).toContain('p(".codex", "config.toml")');
    expect(codexMainConfigGroup).not.toContain('p(".codex", "hooks.json")');

    const codexProfileConfigGroup = sourceBetween(
      'files = existing([root / "config.toml"',
      'add_group("configs", "config-opencode"',
    );
    expect(codexProfileConfigGroup).not.toContain('root / "hooks.json"');
  });
});
