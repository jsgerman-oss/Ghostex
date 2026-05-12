# PRD: Constrain Titlebar Chrome Hit Scope

Date: 2026-05-11

## Problem

`ReactTitlebarChromeView` is a full-window transparent `NSView` wrapping a full-window transparent `WKWebView`. It is added above the workspace, sidebar, divider, and modal host. It uses React-provided hit regions and titlebar-height checks to decide whether to route a point to WebKit, treat it as blank draggable titlebar chrome, or pass through.

This architecture is broad for what is primarily titlebar UI. It can cause click and drag bugs if hit regions, coordinate conversion, or titlebar-height math are stale or wrong.

## Goals

- Limit titlebar chrome hit testing to the actual titlebar/control area by default.
- Preserve native AppKit blank-titlebar drag and double-click behavior.
- Preserve React-rendered titlebar controls.
- Preserve dropdown/popover behavior that genuinely needs to escape the titlebar strip.
- Make root view hit testing easier to reason about.

## Non-Goals

- Rewriting all React titlebar UI in AppKit.
- Removing `WKWebView` titlebar rendering entirely.
- Changing sidebar or workspace layout behavior beyond frame ownership.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/AppDelegate.swift`
- `zmuxRootView` adds `titlebarChromeView` last.
- `ReactTitlebarChromeView.hitTest(_:)` maps AppKit points to React hit regions and returns:
  - `webView.hitTest(point)` for registered React hit regions.
  - `self` for blank titlebar pixels.
  - `nil` elsewhere.

## Proposed Behavior

The titlebar chrome view should have the smallest frame that owns titlebar interactions:

- Its normal frame should be the titlebar strip, not the full window.
- Its `WKWebView` should be sized to that strip.
- Hit region coordinates should be local to the titlebar strip.
- Blank non-control titlebar pixels should still call `window?.performDrag(with:)`.
- If a React dropdown/popover must extend below the strip, create a separate temporary overlay only for the dropdown bounds and only while it is open.

## Implementation Plan

1. Locate root layout code that sets frames for `workspaceView`, `sidebarView`, `divider`, `modalHostView`, and `titlebarChromeView`.
2. Change `titlebarChromeView.frame` from full-window to titlebar-strip bounds.
3. Update `ReactTitlebarChromeView.hitTest(_:)` so it no longer needs to return `nil` for the full workspace below the titlebar. Its view frame should already exclude that area.
4. Update the React hit-region bridge to report coordinates relative to the titlebar webview's visible strip.
5. Audit titlebar dropdown behavior:
   - If dropdowns are currently rendered inside the full-window webview below the titlebar, introduce a temporary dropdown overlay or portal host.
   - Keep that overlay mounted only while a dropdown is open.
   - Make its frame match the dropdown bounds plus intentional padding.
6. Add diagnostic logging for hit-region updates:
   - number of regions
   - titlebar view frame
   - max region bounds
   - whether any region extends outside the titlebar strip
7. Test:
   - click all React titlebar buttons
   - drag blank titlebar area
   - double-click blank titlebar area
   - open any React titlebar dropdown
   - click workspace panes below titlebar
   - drag pane tabs under the titlebar

## Acceptance Criteria

- `titlebarChromeView` no longer covers the full workspace during normal operation.
- Workspace pane clicks do not pass through a full-window transparent titlebar webview.
- React titlebar controls remain clickable.
- Blank titlebar drag/maximize behavior still works.
- Dropdowns that need to escape the strip use an explicit bounded overlay.
- No invisible full-window `WKWebView` remains above workspace content except modal surfaces while visible.

## Risks

- Existing React titlebar code may assume full-window dimensions.
- Dropdown positioning may need coordinate conversion changes.
- Some titlebar hit regions may currently be reported in window coordinates.

## Suggested Verification

- Use the app manually and click/drag across titlebar, sidebar, divider, and workspace pane content.
- Add temporary debug logs for hit-test decisions during local testing.
- Inspect the accessibility tree to confirm workspace controls are not hidden under the titlebar webview.
