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
const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");
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

  test("runs Toggle Sidebar from native command palette at the AppKit bridge", () => {
    /*
     * CDXC:SidebarCollapse 2026-06-12-10:57:
     * Command Palette lives in a native app-modal child window, so its Toggle
     * Sidebar action must be handled before the sidebarCommand envelope is
     * forwarded to the sidebar webview.
     */
    expect(appDelegateSource).toContain("private func handleNativeSidebarModalCommand(_ message: Any) -> Bool");
    expect(appDelegateSource).toContain('command["type"] as? String == "runGhostexHotkeyAction"');
    expect(appDelegateSource).toContain('command["actionId"] as? String == "toggleSidebarCollapsed"');
    expect(appDelegateSource).toContain('closeNativeAppModalWindow(reason: "commandPaletteToggleSidebar"');
    expect(appDelegateSource).toContain(
      "if handleNativeSidebarModalCommand(sidebarMessage) {\n        return\n      }",
    );
  });

  test("collapsed layout removes native sidebar chrome frames", () => {
    expect(appDelegateSource).toContain("private var isSidebarCollapsed = false");
    expect(appDelegateSource).toContain("func toggleSidebarCollapsed()");
    expect(appDelegateSource).toContain("setTitlebarSidebarCollapsed(isSidebarCollapsed)");
    expect(appDelegateSource).toContain("sidebarView.isHidden = isSidebarCollapsed");
    expect(appDelegateSource).toContain("divider.isHidden = isSidebarCollapsed");
    expect(appDelegateSource).toContain("divider: .zero");
    expect(appDelegateSource).toContain("sidebar: .zero");
    expect(appDelegateSource).toContain("sidebarWorkareaBorder: .zero");
  });

  test("titlebar exposes a traffic-light-sized sidebar collapse button", () => {
    /*
     * CDXC:SidebarCollapse 2026-06-12-10:57:
     * The React titlebar needs a 14px gray chevron button before the project
     * name and must mirror native collapse state pushed from AppKit.
     */
    expect(titlebarHostSource).toContain("sidebarCollapsed: boolean;");
    expect(titlebarHostSource).toContain('| { type: "toggleSidebarCollapsed" }');
    expect(titlebarHostSource).toContain('className="titlebar-sidebar-collapse-button"');
    expect(titlebarHostSource).toContain('onClick={() => postNative({ type: "toggleSidebarCollapsed" })}');
    expect(titlebarHostSource).toContain("projectState.sidebarCollapsed ? (");
    expect(titlebarHostSource).toContain("<IconChevronRight");
    expect(titlebarHostSource).toContain("<IconChevronLeft");
    expect(titlebarHostSource).toContain("size={10}");
    expect(titlebarHostSource).toContain("flex: 0 0 14px;");
    expect(titlebarHostSource).toContain("height: 14px;");
    expect(titlebarHostSource).toContain("margin: 0 9px 0 0;");
    expect(titlebarHostSource).toContain("transform: translateY(2px);");
    expect(titlebarHostSource).toContain("height: 10px;");
    expect(titlebarHostSource).toContain("width: 10px;");
    expect(titlebarHostSource).toContain("margin-left: 0;");
    expect(appDelegateSource).toContain('"sidebarCollapsed": isSidebarCollapsed');
    expect(appDelegateSource).toContain("private func setTitlebarSidebarCollapsed(_ collapsed: Bool)");
    expect(appDelegateSource).toContain(String.raw`let json = "{\"sidebarCollapsed\":\(collapsedLiteral)}"`);
  });
});
