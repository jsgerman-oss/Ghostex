import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);

describe("native pane tab titlebar hit testing", () => {
  test("routes workspace pane titlebars from the root before embedded siblings", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-06:33:
     * Split-pane tab bars can be visible while an embedded sibling wins root
     * hit testing first. The app root must ask the mounted workspace titlebar
     * resolver before ordinary AppKit traversal so each visible native tab,
     * Close button, and tab-bar action owns its click.
     */
    const rootHitTestIndex = appDelegateSource.indexOf(
      "override func hitTest(_ point: NSPoint) -> NSView?",
      appDelegateSource.indexOf("final class ghostexRootView"),
    );
    const resizePrepassIndex = appDelegateSource.indexOf(
      "if let resizeHandleHitView = workspaceResizeHandleHitView(at: point)",
      rootHitTestIndex,
    );
    const titlebarPrepassIndex = appDelegateSource.indexOf(
      "if let paneTitleBarHitView = workspacePaneTitleBarHitView(at: point)",
      rootHitTestIndex,
    );
    const superHitIndex = appDelegateSource.indexOf("return super.hitTest(point)", rootHitTestIndex);
    const titlebarHelperIndex = appDelegateSource.indexOf(
      "private func workspacePaneTitleBarHitView(at point: NSPoint)",
      rootHitTestIndex,
    );
    const titlebarHelperSource = appDelegateSource.slice(
      titlebarHelperIndex,
      appDelegateSource.indexOf("private func rootLayoutFrames", titlebarHelperIndex),
    );

    expect(rootHitTestIndex).toBeGreaterThan(-1);
    expect(resizePrepassIndex).toBeGreaterThan(rootHitTestIndex);
    expect(titlebarPrepassIndex).toBeGreaterThan(resizePrepassIndex);
    expect(titlebarPrepassIndex).toBeLessThan(superHitIndex);
    expect(titlebarHelperSource).toContain("workspaceView.paneTitleBarHitView(at: workspacePoint)");
    expect(titlebarHelperSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.root.hitTest.titleBarPrepass"');
  });

  test("routes pane titlebar controls from the window before React titlebar dispatch", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-07:11:
     * The GitHub project tab Add button can be in a top workspace band where
     * AppKit sends the mouse stream through NSWindow chrome handling before root
     * hit testing. Window-boundary routing must ask the workspace's mounted pane
     * titlebars first, then fall through to React titlebar controls only on miss.
     */
    const routeIndex = appDelegateSource.indexOf("func routeTitlebarMouseEventFromWindow(_ event: NSEvent) -> Bool");
    const routeSource = appDelegateSource.slice(
      routeIndex,
      appDelegateSource.indexOf("func showTitlebarDropdownPanel", routeIndex),
    );
    const workspaceRouteIndex = routeSource.indexOf("routeWorkspacePaneTitleBarMouseEventFromWindow(event)");
    const reactRouteIndex = routeSource.indexOf("titlebarChromeView.routeWindowMouseEvent(event)");
    const workspaceHelperIndex = appDelegateSource.indexOf(
      "private func routeWorkspacePaneTitleBarMouseEventFromWindow(_ event: NSEvent) -> Bool",
      routeIndex,
    );
    const workspaceHelperSource = appDelegateSource.slice(
      workspaceHelperIndex,
      appDelegateSource.indexOf("private static func isWorkspacePaneTitleBarWindowMouseEvent", workspaceHelperIndex),
    );
    const eventGuardIndex = appDelegateSource.indexOf(
      "private static func isWorkspacePaneTitleBarWindowMouseEvent",
      workspaceHelperIndex,
    );
    const eventGuardSource = appDelegateSource.slice(
      eventGuardIndex,
      appDelegateSource.indexOf("private static func workspacePaneTitleBarWindowMouseEventTypeName", eventGuardIndex),
    );

    expect(routeIndex).toBeGreaterThan(-1);
    expect(workspaceRouteIndex).toBeGreaterThan(-1);
    expect(reactRouteIndex).toBeGreaterThan(workspaceRouteIndex);
    expect(workspaceHelperSource).toContain(
      'workspaceView.routePaneTitleBarMouseEvent(event, at: workspacePoint, source: source)',
    );
    expect(workspaceHelperSource).toContain('let source = "windowPaneTitleBarPrepass"');
    expect(workspaceHelperSource).toContain(
      'NativePaneTabDragReproLog.append(event: "nativePaneTabs.root.windowMouseEvent.titleBarPrepass"',
    );
    expect(eventGuardSource).toContain("case .leftMouseDown, .leftMouseDragged, .leftMouseUp:");
  });

  test("routes workspace pane titlebars before embedded child hit testing", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-04:28:
     * The 04:18 repro showed top-band mouseDown/mouseUp reaching the pane
     * container instead of tab buttons. Workspace hit testing must check actual
     * visible pane titlebars in z-order before Ghostty, CEF, or WKWebView.
     */
    const workspaceHitTestIndex = terminalWorkspaceSource.indexOf(
      "override func hitTest(_ point: NSPoint) -> NSView?",
      terminalWorkspaceSource.indexOf("private func paneResizeHandleFrame"),
    );
    const titleBarRouteIndex = terminalWorkspaceSource.indexOf(
      "if let titleBarHitView = paneTitleBarHitView(at: point)",
      workspaceHitTestIndex,
    );
    const superHitIndex = terminalWorkspaceSource.indexOf("return super.hitTest(point)", workspaceHitTestIndex);
    const titleBarHelperIndex = terminalWorkspaceSource.indexOf("func paneTitleBarHitView(at point: NSPoint)");
    const helperSource = terminalWorkspaceSource.slice(
      titleBarHelperIndex,
      terminalWorkspaceSource.indexOf("func setNativeChromeInteractivitySuppressed", titleBarHelperIndex),
    );

    expect(workspaceHitTestIndex).toBeGreaterThan(-1);
    expect(titleBarRouteIndex).toBeGreaterThan(workspaceHitTestIndex);
    expect(titleBarRouteIndex).toBeLessThan(superHitIndex);
    expect(helperSource).toContain("private func paneTitleBarEventTarget(at point: NSPoint)");
    expect(helperSource).toContain("guard let target = paneTitleBarEventTarget(at: point)");
    expect(helperSource).toContain("for view in subviews.reversed()");
    expect(helperSource).toContain("let containerPoint = convert(point, to: containerView)");
    expect(helperSource).toContain("titleBarView.frame.contains(containerPoint)");
    expect(helperSource).toContain("return target.titleBarView.hitTest(target.titleBarPoint) ?? target.titleBarView");
  });

  test("keeps window-routed titlebar mouse streams on the same pane titlebar", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-07:11:
     * A window-boundary pane-titlebar mouseDown must keep later drag/up events on
     * that same titlebar, even if tab addition, close hover, or pointer movement
     * changes normal AppKit hit testing before mouseUp.
     */
    const workspaceRouteIndex = terminalWorkspaceSource.indexOf(
      "func routePaneTitleBarMouseEvent(_ event: NSEvent, at point: NSPoint, source: String) -> Bool",
    );
    const workspaceRouteSource = terminalWorkspaceSource.slice(
      workspaceRouteIndex,
      terminalWorkspaceSource.indexOf("private func paneTitleBarEventTarget", workspaceRouteIndex),
    );
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const titleBarSource = terminalWorkspaceSource.slice(
      titleBarIndex,
      terminalWorkspaceSource.indexOf("override func mouseDragged(with event: NSEvent)", titleBarIndex),
    );

    expect(terminalWorkspaceSource).toContain("private weak var windowRoutedPaneTitleBar: TerminalSessionTitleBarView?");
    expect(workspaceRouteIndex).toBeGreaterThan(-1);
    expect(workspaceRouteSource).toContain("case .leftMouseDown:");
    expect(workspaceRouteSource).toContain("windowRoutedPaneTitleBar = target.titleBarView");
    expect(workspaceRouteSource).toContain("case .leftMouseDragged:");
    expect(workspaceRouteSource).toContain("guard let titleBarView = windowRoutedPaneTitleBar");
    expect(workspaceRouteSource).toContain("case .leftMouseUp:");
    expect(workspaceRouteSource).toContain("windowRoutedPaneTitleBar = nil");
    expect(workspaceRouteSource).toContain("routeWindowTitleBarMouseEvent(");
    expect(titleBarSource).toContain("fileprivate func routeWindowTitleBarMouseEvent(");
    expect(titleBarSource).toContain("handleReroutedTitleBarMouseDown(");
    expect(titleBarSource).toContain("handleReroutedTitleBarMouseDragged(");
    expect(titleBarSource).toContain("handleReroutedTitleBarMouseUp(");
    expect(titleBarSource).toContain("pendingReroutedTitleBarTarget = nil");
  });

  test("routes normal pane titlebar bands before embedded content hit testing", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-04:08:
     * Normal workspace panes must use the same simple ownership rule as popped
     * out panes: points inside the titlebar band go to the titlebar first, before
     * Ghostty, CEF, or WKWebView content can win mouseDown/mouseUp.
     */
    const containerIndex = terminalWorkspaceSource.indexOf("private final class TerminalPaneLeafContainerView");
    const hitTestIndex = terminalWorkspaceSource.indexOf("override func hitTest(_ point: NSPoint) -> NSView?", containerIndex);
    const superHitIndex = terminalWorkspaceSource.indexOf("return super.hitTest(point)", hitTestIndex);

    expect(containerIndex).toBeGreaterThan(-1);
    expect(hitTestIndex).toBeGreaterThan(containerIndex);
    expect(superHitIndex).toBeGreaterThan(hitTestIndex);
    expect(terminalWorkspaceSource).toContain("weak var titleBarHitTestView: NSView?");
    expect(terminalWorkspaceSource).toContain("session.containerView.titleBarHitTestView = session.titleBarView");
    expect(terminalWorkspaceSource).toContain("titleBarHitTestView ?? subviews.first { $0 is TerminalSessionTitleBarView }");
    expect(terminalWorkspaceSource).toContain("titleBarView.frame.contains(point)");
    expect(terminalWorkspaceSource).toContain("return titleBarView.hitTest(convert(point, to: titleBarView))");
    expect(terminalWorkspaceSource.indexOf("titleBarView.frame.contains(point)", hitTestIndex)).toBeLessThan(superHitIndex);
  });

  test("returns concrete tab controls and blocks tab-strip child fallback", () => {
    /**
     * CDXC:NativeWorkspaceHitTesting 2026-06-12-02:36:
     * Hover can still update through tracking areas when click hit testing
     * falls through to pane content. Keep pane-tab buttons on explicit
     * titlebar hit ownership so mouseDown, drag, and mouseUp reach the native
     * tab gesture handlers.
     *
     * CDXC:NativePaneTabClicks 2026-06-12-05:41:
     * Scrolled tab strips must not fall back to AppKit child hit testing after
     * explicit tab resolution. The child hierarchy can pick a tab one or two
     * slots to the right, so tab-strip misses return the titlebar itself.
     */
    const tabHitIndex = terminalWorkspaceSource.indexOf("if let tabHit = tabButtonHit(at: point)");
    const tabViewportFallbackIndex = terminalWorkspaceSource.indexOf("if tabViewportFrame.contains(point)", tabHitIndex);
    const superHitIndex = terminalWorkspaceSource.indexOf("if let hitView = super.hitTest(point)");

    expect(tabHitIndex).toBeGreaterThan(-1);
    expect(tabViewportFallbackIndex).toBeGreaterThan(tabHitIndex);
    expect(superHitIndex).toBeGreaterThan(-1);
    expect(tabHitIndex).toBeLessThan(superHitIndex);
    expect(tabViewportFallbackIndex).toBeLessThan(superHitIndex);
    expect(terminalWorkspaceSource).toContain(
      'NativePaneTabDragReproLog.append(event: "nativePaneTabs.titleBar.hitTest.tabButton"',
    );
    expect(terminalWorkspaceSource).toContain("return tabHit.button");
    expect(terminalWorkspaceSource.slice(tabViewportFallbackIndex, superHitIndex)).toContain("return self");
  });

  test("uses explicit scroll-offset tab geometry instead of AppKit child lookup", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-05:22:
     * Each native tab button must own its own click. Titlebar hit testing should
     * resolve the concrete button from its converted visible frame instead of
     * asking the shifted clipped-strip view to rediscover a subview.
     *
     * CDXC:NativePaneTabClicks 2026-06-12-05:41:
     * The 05:33 repro proved AppKit conversion can still hand mouseDown to a
     * tab whose local point is outside its bounds. Resolve tab ownership from
     * the layout scroll offset and each tab button frame directly.
     */
    const helperIndex = terminalWorkspaceSource.indexOf("private func tabButtonHit(at point: NSPoint)");
    const helperEndIndex = terminalWorkspaceSource.indexOf("func containsTab(_ sessionId: String) -> Bool", helperIndex);
    const helperSource = terminalWorkspaceSource.slice(helperIndex, helperEndIndex);

    expect(helperIndex).toBeGreaterThan(-1);
    expect(helperSource).toContain("return visibleTabButtonHit(at: point)");
    expect(helperSource).toContain("private func tabButtonHitRecords(at point: NSPoint)");
    expect(helperSource).toContain("private func visibleTabButtonFrame(for button: TerminalTitleBarTabButton) -> CGRect");
    expect(helperSource).toContain("private func tabContentPoint(forTitleBarPoint point: NSPoint) -> NSPoint");
    expect(helperSource).toContain("point.x - tabViewportFrame.minX + tabScrollOffsetX");
    expect(helperSource).toContain("contentPoint.x - button.frame.minX");
    expect(helperSource).toContain("tabViewportFrame.minX + button.frame.minX - tabScrollOffsetX");
    expect(helperSource).toContain("frameInTitleBar.intersection(tabViewportFrame)");
    expect(helperSource).toContain("visibleFrame.contains(point)");
    expect(helperSource).toContain("button.bounds.contains(localPoint)");
    expect(helperSource).not.toContain("tabClipView.hitTest");
    expect(helperSource).not.toContain("let localPoint = convert(point, to: button)");
  });

  test("prefers each tab button's local hover owner before clipped-strip fallback", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-04:45:
     * When a scrolled native tab strip paints/hover-tracks the intended tab but
     * titlebar click picking selects the tab to its right, click ownership must
     * first follow the tab button's own AppKit tracking-area hover state.
     */
    const buttonIndex = terminalWorkspaceSource.indexOf("private final class TerminalTitleBarTabButton");
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const helperIndex = terminalWorkspaceSource.indexOf("private func tabButtonHit(at point: NSPoint)");
    const helperEndIndex = terminalWorkspaceSource.indexOf("func containsTab(_ sessionId: String) -> Bool", helperIndex);
    const buttonSource = terminalWorkspaceSource.slice(buttonIndex, titleBarIndex);
    const helperSource = terminalWorkspaceSource.slice(helperIndex, helperEndIndex);

    expect(buttonIndex).toBeGreaterThan(-1);
    expect(helperIndex).toBeGreaterThan(-1);
    expect(buttonSource).toContain("fileprivate var isPointerLocallyInside = false");
    expect(buttonSource).toContain("isPointerLocallyInside = isInside");
    expect(buttonSource).toContain("isPointerLocallyInside = false");
    expect(helperSource).toContain("if let hoverHit = locallyHoveredTabButtonHit(at: point)");
    expect(helperSource).toContain("return hoverHit");
    expect(helperSource).toContain("private func locallyHoveredTabButtonHit(at point: NSPoint)");
    expect(helperSource.indexOf("if let hoverHit = locallyHoveredTabButtonHit(at: point)")).toBeLessThan(
      helperSource.indexOf("return visibleTabButtonHit(at: point)"),
    );
    expect(helperSource).toContain("$0.button.isPointerLocallyInside");
    expect(helperSource).toContain("guard hoveredHits.count == 1, let hoverHit = hoveredHits.first");
  });

  test("uses local hover ownership for tab close and fixed tab-bar action buttons", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-04:57:
     * Inline tab Close plus the sticky active-tab chevron, New Terminal, New
     * Browser, and overflow buttons should click the same control that AppKit
     * already reports as locally hovered.
     *
     * CDXC:NativePaneTabClicks 2026-06-12-05:31:
     * Fixed action-button hover must only win while the click point is still
     * inside that button. Stale New Terminal hover must not steal clicks from
     * New Browser, overflow, or the sticky active-tab button to its right.
     */
    const actionButtonIndex = terminalWorkspaceSource.indexOf("private final class TerminalTitleBarActionButton");
    const tabButtonIndex = terminalWorkspaceSource.indexOf("private final class TerminalTitleBarTabButton");
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const hitTestIndex = terminalWorkspaceSource.indexOf("override func hitTest(_ point: NSPoint) -> NSView?", titleBarIndex);
    const collapsedActionIndex = terminalWorkspaceSource.indexOf("if let collapsedActionMenuButton", hitTestIndex);
    const hoverActionIndex = terminalWorkspaceSource.indexOf("if let hoveredTitleBarButton", hitTestIndex);
    const actionButtonSource = terminalWorkspaceSource.slice(actionButtonIndex, tabButtonIndex);
    const tabButtonSource = terminalWorkspaceSource.slice(tabButtonIndex, titleBarIndex);
    const titleBarSource = terminalWorkspaceSource.slice(titleBarIndex, terminalWorkspaceSource.indexOf("private func isEmptyTitleBarDoubleClickPoint", titleBarIndex));

    expect(actionButtonIndex).toBeGreaterThan(-1);
    expect(tabButtonIndex).toBeGreaterThan(-1);
    expect(hitTestIndex).toBeGreaterThan(-1);
    expect(actionButtonSource).toContain("fileprivate var isPointerLocallyInside: Bool");
    expect(tabButtonSource).toContain("fileprivate var locallyHoveredInlineAction: InlineAction?");
    expect(tabButtonSource).toContain("locallyHoveredInlineAction ?? inlineActionAtPoint");
    expect(tabButtonSource).toContain("private var hasValidMouseDown = false");
    expect(tabButtonSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.mouseDown.outsideBounds"');
    expect(tabButtonSource).toContain("guard bounds.contains(point) else");
    expect(tabButtonSource).toContain("guard hasValidMouseDown || bounds.contains(point) else");
    expect(tabButtonSource).toContain("if let titleBar = owningTitleBarView()");
    expect(tabButtonSource).toContain("titleBar.rerouteMisdirectedOwnedTitleBarMouseDown(");
    expect(tabButtonSource).toContain("titleBar.rerouteMisdirectedOwnedTitleBarMouseDragged(");
    expect(tabButtonSource).toContain("titleBar.rerouteMisdirectedOwnedTitleBarMouseUp(");
    expect(tabButtonSource).toContain("TerminalSessionTitleBarView.rerouteMisdirectedTitleBarMouseDown(");
    expect(tabButtonSource).toContain("TerminalSessionTitleBarView.rerouteMisdirectedTitleBarMouseUp(");
    expect(actionButtonSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.actionButton.mouseDown.outsideBounds"');
    expect(actionButtonSource).toContain("if let titleBar = owningTitleBarView()");
    expect(actionButtonSource).toContain("titleBar.rerouteMisdirectedOwnedTitleBarMouseDown(");
    expect(actionButtonSource).toContain("titleBar.rerouteMisdirectedOwnedTitleBarMouseUp(");
    expect(actionButtonSource).toContain("TerminalSessionTitleBarView.rerouteMisdirectedTitleBarMouseDown(");
    expect(hoverActionIndex).toBeGreaterThan(hitTestIndex);
    expect(hoverActionIndex).toBeLessThan(collapsedActionIndex);
    expect(titleBarSource).toContain("private func locallyHoveredTitleBarActionButton(at point: NSPoint)");
    expect(titleBarSource).toContain("stickyActiveTabButton");
    expect(titleBarSource).toContain("tabAddButton");
    expect(titleBarSource).toContain("tabBrowserButton");
    expect(titleBarSource).toContain("actionMenuButton");
    expect(titleBarSource).toContain("$0.isPointerLocallyInside");
    expect(titleBarSource).toContain("convertedTitleBarActionButtonFrame($0).contains(point)");
    expect(titleBarSource).toContain("$0.bounds.contains(convert(point, to: $0))");
    expect(titleBarSource).toContain("guard hoveredButtons.count == 1, let button = hoveredButtons.first");
    expect(titleBarSource).toContain("private func convertedTitleBarActionButtonFrame(_ button: TerminalTitleBarActionButton) -> CGRect");
    expect(titleBarSource).toContain("convert(button.bounds, from: button)");
    expect(titleBarSource).toContain("logFixedTitleBarActionButtonHit(");
    expect(titleBarSource).toContain('buttonKind": fixedTitleBarActionButtonKind(button)');
    expect(tabButtonSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.inlineMouseDown"');
    expect(tabButtonSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.inlineMouseUp"');
    expect(terminalWorkspaceSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.actionButton.perform"');
  });

  test("reroutes misdelivered tab and fixed-button events through titlebar geometry", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-05:52:
     * The stale receiver guard must not turn bad AppKit child hit testing into
     * a dead click. Misdirected tab/close/action events need to be resolved
     * once from the visible titlebar under the event's real window point.
     */
    const titleBarIndex = terminalWorkspaceSource.indexOf("private final class TerminalSessionTitleBarView");
    const titleBarSource = terminalWorkspaceSource.slice(
      titleBarIndex,
      terminalWorkspaceSource.indexOf("final class ProjectEditorInitialLoadingOverlayView", titleBarIndex),
    );

    expect(titleBarSource).toContain("fileprivate static func rerouteMisdirectedTitleBarMouseDown(");
    expect(titleBarSource).toContain("fileprivate static func rerouteMisdirectedTitleBarMouseDragged(");
    expect(titleBarSource).toContain("fileprivate static func rerouteMisdirectedTitleBarMouseUp(");
    expect(titleBarSource).toContain("fileprivate func rerouteMisdirectedOwnedTitleBarMouseDown(");
    expect(titleBarSource).toContain("fileprivate func rerouteMisdirectedOwnedTitleBarMouseDragged(");
    expect(titleBarSource).toContain("fileprivate func rerouteMisdirectedOwnedTitleBarMouseUp(");
    expect(titleBarSource).toContain("handleReroutedTitleBarMouseDown(");
    expect(titleBarSource).toContain("handleReroutedTitleBarMouseDragged(");
    expect(titleBarSource).toContain("handleReroutedTitleBarMouseUp(");
    expect(titleBarSource).toContain('source: "titleBarDirect"');
    expect(titleBarSource).toContain("override func mouseDragged(with event: NSEvent)");
    expect(titleBarSource).toContain("override func mouseUp(with event: NSEvent)");
    expect(titleBarSource).toContain("private static func titleBarRerouteCandidate(for event: NSEvent)");
    expect(titleBarSource).toContain("collectTitleBarsForReroute(in: root, into: &titleBars)");
    expect(titleBarSource).toContain("for subview in view.subviews.reversed()");
    expect(titleBarSource).toContain("let point = titleBar.convert(event.locationInWindow, from: nil)");
    expect(titleBarSource).toContain("let target = titleBar.reroutedTitleBarTarget(at: point)");
    expect(titleBarSource).toContain("private var pendingReroutedTitleBarTarget: ReroutedTitleBarTarget?");
    expect(titleBarSource).toContain("private func reroutedTitleBarTarget(at point: NSPoint) -> ReroutedTitleBarTarget?");
    expect(titleBarSource).toContain("return .inlineClose(sessionId: tabHit.button.sessionId)");
    expect(titleBarSource).toContain("return .tab(sessionId: tabHit.button.sessionId)");
    expect(titleBarSource).toContain("return .fixedAction(.newTerminal)");
    expect(titleBarSource).toContain("return .fixedAction(.newBrowser)");
    expect(titleBarSource).toContain("return .fixedAction(.stickyActiveTab)");
    expect(titleBarSource).toContain("return .fixedAction(.overflowMenu)");
    expect(titleBarSource).toContain("onTabMouseDown?(event, sessionId)");
    expect(titleBarSource).toContain("onTabMouseUp?(event, sessionId)");
    expect(titleBarSource).toContain("onTabCloseRequested?(sessionId, .close)");
    expect(titleBarSource).toContain("performReroutedFixedAction(kind, source: \"reroutedMouseDown\")");
    expect(titleBarSource).toContain("performReroutedFixedAction(kind, source: \"reroutedMouseUp\")");
    expect(titleBarSource).toContain('event: "nativePaneTabs.titleBar.reroute.mouseDown"');
    expect(titleBarSource).toContain('event: "nativePaneTabs.titleBar.reroute.mouseUp"');
    expect(titleBarSource).toContain('NativePaneTabDragReproLog.append(event: "nativePaneTabs.titleBar.reroute.miss"');
  });

  test("keeps commands-panel resize rail outside the command tab strip", () => {
    /**
     * CDXC:NativePaneTabClicks 2026-06-12-04:08:
     * The command-panel resize rail is allowed to sit on the panel boundary, but
     * not across the native command tab bar where it can steal clicks from tabs.
     */
    const resizeHandleIndex = terminalWorkspaceSource.indexOf("private func syncCommandsPanelResizeHandle");
    const frameIndex = terminalWorkspaceSource.indexOf("commandsPanelResizeHandleView.frame = CGRect(", resizeHandleIndex);
    const functionEndIndex = terminalWorkspaceSource.indexOf("private func syncPaneResizeHandleViews", resizeHandleIndex);
    const functionSource = terminalWorkspaceSource.slice(resizeHandleIndex, functionEndIndex);

    expect(resizeHandleIndex).toBeGreaterThan(-1);
    expect(frameIndex).toBeGreaterThan(resizeHandleIndex);
    expect(functionSource).toContain("let railY = min(");
    expect(functionSource).toContain("max(commandPanelBounds.maxY, bounds.minY)");
    expect(functionSource).toContain("y: railY");
    expect(functionSource).not.toContain("commandPanelBounds.maxY - railHeight / 2");
  });
});
