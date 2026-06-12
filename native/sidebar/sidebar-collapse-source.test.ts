import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sharedHotkeysSource = readFileSync(
  new URL("../../shared/ghostex-hotkeys.ts", import.meta.url),
  "utf8",
);

describe("native sidebar collapse source", () => {
  test("routes Cmd+B to complete sidebar collapse instead of side switching", () => {
    /*
     * CDXC:SidebarCollapse 2026-06-12-02:23:
     * Cmd+B must bind to toggleSidebarCollapsed across shared hotkeys, native
     * AppKit defaults, and the bridge command while moveSidebar stays unbound
     * by default.
     */
    expect(sharedHotkeysSource).toContain('| "toggleSidebarCollapsed"');
    expect(sharedHotkeysSource).toContain('defaultKey: "cmd+b",\n    description: "Collapse or expand the sidebar."');
    expect(sharedHotkeysSource).toContain('action: { id: "moveSidebar", kind: "moveSidebar" },');
    expect(sharedHotkeysSource).toContain('defaultKey: "",\n    description: "Move the sidebar to the other side."');
    expect(appDelegateSource).toContain('"moveSidebar": ""');
    expect(appDelegateSource).toContain('"toggleSidebarCollapsed": "cmd+b"');
    expect(appDelegateSource).toContain('if actionId == "toggleSidebarCollapsed"');
    expect(hostProtocolSource).toContain("case toggleSidebarCollapsed");
    expect(nativeSidebarSource).toContain('postNative({ type: "toggleSidebarCollapsed" });');
  });

  test("collapsed layout removes native sidebar chrome frames", () => {
    expect(appDelegateSource).toContain("private var isSidebarCollapsed = false");
    expect(appDelegateSource).toContain("func toggleSidebarCollapsed()");
    expect(appDelegateSource).toContain("sidebarView.isHidden = isSidebarCollapsed");
    expect(appDelegateSource).toContain("divider.isHidden = isSidebarCollapsed");
    expect(appDelegateSource).toContain("divider: .zero");
    expect(appDelegateSource).toContain("sidebar: .zero");
    expect(appDelegateSource).toContain("sidebarWorkareaBorder: .zero");
  });
});
