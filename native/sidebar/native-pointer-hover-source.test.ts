import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");
const sessionCardsSource = readFileSync(
  new URL("../../sidebar/styles/session-cards.css", import.meta.url),
  "utf8",
);
const workspaceThemeSource = readFileSync(
  new URL("../../sidebar/styles/workspace-theme.css", import.meta.url),
  "utf8",
);
const sidebarBridgeSource = readFileSync(
  new URL("../../sidebar/sidebar-context-menu-portal.tsx", import.meta.url),
  "utf8",
);

describe("native pointer hover boundary source", () => {
  test("keeps AppKit pointer ownership, JS bridges, and root hover gates wired together", () => {
    /*
     * CDXC:SidebarHover 2026-06-10-23:44:
     * Sticky WebKit :hover must be neutralized at the native pointer boundary.
     * The fix is only complete when AppKit tracking, JS bridge state, and
     * root-level pointer-events gating remains wired for the sidebar while the
     * titlebar keeps its DOM clickable and uses visual hover resets only.
     *
     * CDXC:SidebarHover 2026-06-11-09:23:
     * Root pointer-events gating does not clear an already-stuck WebKit :hover.
     * Keep explicit native-outside CSS overrides for sidebar session visuals and
     * titlebar hover/tooltip surfaces tied to the same native pointer flag.
     *
     * CDXC:SidebarHover 2026-06-11-09:34:
     * Sidebar rows must not keep a second highlighted session when native says
     * the pointer left. Assert that the native-outside reset covers the row
     * ::after hover surface and remains late enough to beat reference-sidebar
     * hover styling.
     *
     * CDXC:SidebarHover 2026-06-11-10:23:
     * The native resize rail is outside the React sidebar, and stale DOM
     * pointermove must not override a native outside state. Assert that the
     * divider forces pointer-out and DOM suppression is gated by the latest
     * native pointer state.
     */
    expect(appDelegateSource).toContain("var onNativePointerInsideChanged: ((Bool) -> Void)?");
    expect(appDelegateSource).toContain(".mouseEnteredAndExited, .mouseMoved");
    expect(appDelegateSource).toContain("setSidebarNativePointerInside");
    expect(appDelegateSource).toContain("window.__ghostex_NATIVE_SIDEBAR__?.setNativePointerInside");
    expect(appDelegateSource).toContain("window.__ghostex_TITLEBAR__?.setNativePointerInside");
    expect(appDelegateSource).toContain("isPointInFixedTitlebarStrip(convert(event.locationInWindow, from: nil))");
    expect(appDelegateSource).toContain("final class TitlebarChromeWebView: WKWebView");
    expect(appDelegateSource).toContain("override var mouseDownCanMoveWindow: Bool");
    expect(appDelegateSource).toContain("var onTitlebarMouseEvent: ((NSEvent) -> Bool)?");
    expect(appDelegateSource).toContain("func routeTitlebarMouseEventFromWindow(_ event: NSEvent) -> Bool");
    expect(appDelegateSource).toContain("func routeWindowMouseEvent(_ event: NSEvent) -> Bool");
    expect(appDelegateSource).toContain("dispatchWindowMouseEventToWebView(event, point: point)");
    expect(appDelegateSource).toContain("shouldConsumeTitlebarWindowMouseEvent");
    expect(appDelegateSource).toContain("AppKit's titled-window chrome can swallow real clicks");
    expect(appDelegateSource).toContain("return webView");
    expect(appDelegateSource).toContain("return self");
    expect(appDelegateSource).toContain("divider.onPointerEntered = { [weak self] in");
    expect(appDelegateSource).toContain("self?.sidebarView.forceNativePointerInside(false)");
    expect(appDelegateSource).toContain("func forceNativePointerInside(_ isInside: Bool)");
    expect(appDelegateSource).toContain("shouldLetTitlebarHandleOutsideMouseEvent");
    expect(appDelegateSource).toContain("pre-close titlebar");
    expect(appDelegateSource).toContain("containsInteractiveHitRegion(titlebarPoint)");

    expect(nativeSidebarSource).toContain("function setNativeSidebarPointerInside(isInside: boolean): void");
    expect(nativeSidebarSource).toContain("let latestNativeSidebarPointerInside = true");
    expect(nativeSidebarSource).toContain("latestNativeSidebarPointerInside && !sidebarDomHoverSuppressed");
    expect(nativeSidebarSource).toContain("setNativePointerInside: setNativeSidebarPointerInside");
    expect(nativeSidebarSource).toContain("suppressSidebarHoverFromDom();");
    expect(nativeSidebarSource).toContain('document.addEventListener("pointermove", enableSidebarTooltips');
    expect(nativeSidebarSource).toContain("function enableSidebarHoverFromDom(): void");

    expect(titlebarHostSource).toContain("function setTitlebarNativePointerInside(isInside: boolean): void");
    expect(titlebarHostSource).toContain("setNativePointerInside: setTitlebarNativePointerInside");
    expect(titlebarHostSource).toContain("nativeDropdownOpen === kind");
    expect(titlebarHostSource).toContain("requesting the already-open panel closes it");
    expect(titlebarHostSource).not.toContain('body[data-native-pointer-inside="false"] #root');
    expect(titlebarHostSource).toContain(".titlebar-session-button:hover:not(:focus-visible):not([data-state=\"open\"])");
    expect(titlebarHostSource).toContain(".titlebar-update-button::after");
    expect(titlebarHostSource).toContain("[data-radix-popper-content-wrapper]");
    expect(titlebarHostSource).toContain(".titlebar-resource-tooltip");
    /*
     * CDXC:TitlebarResources 2026-06-12-03:26:
     * Resources header Sleep actions must not depend on raw CSS :hover in the
     * native child dropdown. Stale WebKit hover can show the tooltip while
     * leaving the buttons unable to receive clicks.
     *
     * CDXC:TitlebarResources 2026-06-12-11:20:
     * Child dropdown documents do not receive the main titlebar strip's AppKit
     * pointer tracking callbacks. Mark them pointer-inside on mount so visible
     * Resources header actions stay hit-testable inside the panel WebView.
     */
    expect(titlebarHostSource).toContain("data-actions-active={String(resourceHeaderActionsActive)}");
    expect(titlebarHostSource).toContain("Sleep header tooltips are temporarily commented out");
    expect(titlebarHostSource).not.toContain("const [sleepInactiveTooltipOpen");
    expect(titlebarHostSource).toContain("setTitlebarNativePointerInside(true);");
    expect(titlebarHostSource).not.toContain(".titlebar-resources-header:hover .titlebar-resources-action-button");

    expect(sessionCardsSource).toContain('body.native-sidebar-body[data-native-pointer-inside="false"]');
    expect(sessionCardsSource).toContain(".session:not(:focus-visible):not([data-focused=\"true\"]):not(");
    expect(sessionCardsSource).toContain("):hover::after");
    expect(sessionCardsSource).toContain("avoid showing both the focused row and the last hovered row as active");
    expect(sessionCardsSource).toContain(".session:has(.session-card-close-button):hover:not(:focus-visible):not(:focus-within)");

    expect(workspaceThemeSource).toContain('body.native-sidebar-body[data-native-pointer-inside="false"] #root');
    expect(workspaceThemeSource).toContain("pointer-events: none;");

    expect(sidebarBridgeSource).toContain("setNativePointerInside: (isInside: boolean) => void");
  });
});
