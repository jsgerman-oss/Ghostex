# Click And Drag Reliability Overview

Date: 2026-05-11

This document collects the main click/drag reliability risks found in the native macOS host. The goal is to reduce broad transparent overlays, window-level event monitors, and custom hit routing where normal AppKit ownership can handle the interaction directly.

## Current Shape

The main work area is not just pane content. It is layered under several root and workspace-level surfaces:

- `ReactTitlebarChromeView` wraps a full-window transparent `WKWebView` and is added above workspace, sidebar, divider, and modal host in `native/macos/zmuxHost/Sources/zmuxHost/AppDelegate.swift`.
- `modalHostView` is a full-window transparent `WKWebView` that is normally hidden and used for sidebar modal portals.
- `PaneResizeHandleView` is a transparent native divider between sidebar and workspace.
- `TerminalWorkspaceView` owns pane layout, pane titlebars, split rails, popped-out placeholders, floating editor overlays, pane drag feedback, CEF drag bridging, and several monitor paths.
- `paneHeaderEventMonitor` observes main-window mouse events for hover, focus probes, attention acknowledgement, and continuing titlebar/tab drags.
- `cefNativeDragSourceReleaseEventMonitor` observes native mouse events to bridge CEF drag source release and drag hover/drop behavior.
- `addressFieldKeyMonitor` observes Return/keypad Enter while a browser address field is being edited.

The code already contains signs that the system is moving in the right direction: split dividers are now real AppKit sibling views in reserved gaps, borders/loading/debug overlays are explicitly click-through, and popped-out pane titlebar actions are intended to use native AppKit actions.

## Highest Priority Issues

### 1. Full-Window Transparent Titlebar WebView

`titlebarChromeView` is the broadest top-level hit-test surface. It wraps a `WKWebView`, spans the full window, is added last, and depends on React-provided hit regions plus titlebar-height math to decide whether a point should go to WebKit, become a draggable titlebar pixel, or pass through.

Why this is risky:

- It is above native workspace panes even though most of the workspace does not visually overlap titlebar chrome.
- Stale or oversized React hit regions can invisibly steal clicks or drags.
- Wrong `titlebarHeight` can make blank titlebar drag behavior leak into workspace/sidebar content.
- Coordinate conversion bugs are easy because the wrapper receives AppKit coordinates while hit regions are mapped to web coordinates.
- It complicates debugging because every main-window hit-test passes through a transparent WebKit wrapper first.

Recommended direction:

- Constrain `ReactTitlebarChromeView` to the actual titlebar strip by default.
- Use a temporary explicit popover/dropdown surface only when titlebar React content must escape the strip.
- Keep blank titlebar dragging native AppKit-owned.

Detailed PRD: `prd-titlebar-chrome-scope.md`

### 2. Pane Header Event Monitor

`paneHeaderEventMonitor` is still a window-local mouse monitor. The current comment says it must not synthesize Pop In, action-menu, close, or other button clicks, which is the right direction.

Why this is risky:

- Local monitors observe events outside the normal view ownership chain.
- They can become tempting catch-alls for clicks that should belong to `NSButton` or view-local `mouseDown`/`mouseUp`.
- They make bugs harder to reason about because the event can be seen by both the target view and a separate monitor.
- They can couple unrelated behaviors: hover reveal, focus debug probes, attention acknowledgement, titlebar drag continuation, and tab reorder feedback.

Recommended direction:

- Keep only the narrowest behavior that truly needs window-level observation: continuing an already-started tab/titlebar drag after the pointer leaves the source view.
- Move hover reveal, focus acknowledgement, and attention acknowledgement into AppKit-owned view/container paths where possible.
- Prevent the monitor from resolving action buttons, hamburger menus, Pop In, Pop Out, Close, or tab inline controls.

Detailed PRD: `prd-pane-header-monitor-reduction.md`

### 3. Titlebar Action Hit Routing

Titlebar action buttons use native `NSButton`s, but some paths still rely on titlebar-level point resolution and fallback mouse handling. This is especially risky around widened transparent hit areas and narrow panes.

Why this is risky:

- A button can visually appear clickable while AppKit does not consider the actual `NSButton` frame to own that point.
- Titlebar fallback logic can diverge from accessibility activation and normal button actions.
- Pop In/Pop Out is the kind of action where down/up consistency matters; synthetic routing can miss release, steal drag, or conflict with other transparent views.

Recommended direction:

- Make the actual `NSButton` frame be the full intended hit target.
- Center the icon inside that larger frame rather than creating separate invisible geometry.
- Let `NSButton.target/action` handle clicks, and use titlebar `mouseDown`/`mouseUp` only for titlebar-owned concepts such as tab selection/drag and blank-titlebar double-click.

Detailed PRD: `prd-native-titlebar-button-hit-targets.md`

### 4. Drag Feedback Views Should Be Guaranteed Click-Through

Pane drag feedback views are visual layers added during drag/reorder operations:

- `TerminalPaneHeaderDragTargetView`
- `TerminalPaneTabReorderTargetView`
- `TerminalPaneHeaderDragGhostView`

They are added with high z positions during drag feedback. Unlike border/loading/debug overlays, they do not all explicitly opt out of hit testing.

Why this is risky:

- If one remains attached longer than expected, it can intercept clicks.
- If AppKit dispatches an event during a drag cleanup transition, feedback views may win hit testing.
- These views are visual affordances only; they do not need to own mouse input.

Recommended direction:

- Add `override func hitTest(_ point: NSPoint) -> NSView? { nil }` to every drag feedback view.
- Add cleanup assertions/logging around drag end so stale feedback views are easier to detect.

Detailed PRD: `prd-drag-feedback-click-through.md`

## Medium Priority Issues

### 5. CEF Drag Monitor Scope

`cefNativeDragSourceReleaseEventMonitor` is more justified than titlebar click monitors because CEF/Chromium drag/drop can escape normal AppKit event delivery. Still, it should remain tightly scoped.

Why this matters:

- It is global to the local event stream while installed.
- It has a timer that polls mouse location during active drag bridging.
- It can become a broad workaround for browser drag behavior if not carefully bounded.

Recommended direction:

- Install or arm it only when CEF/browser pane interaction is possible.
- Ignore all events that do not originate in a CEF browser pane as early as possible.
- Keep it dedicated to CEF drag source release and hover/drop bridge behavior only.

Detailed PRD: `prd-cef-drag-monitor-scope.md`

### 6. Address Field Key Monitor

`addressFieldKeyMonitor` exists to commit Return/keypad Enter while the native browser address field is being edited.

Why this matters:

- It is small and scoped, but still a local monitor.
- Native AppKit field-editor behavior is better expressed through control delegate methods or a small `NSTextField` subclass when possible.
- It adds one more place where key events can be consumed outside normal responder dispatch.

Recommended direction:

- First verify whether `control(_:textView:doCommandBy:)`, `controlTextDidEndEditing`, and `NSTextField.action` can cover all Return paths.
- If not, replace the monitor with a focused field subclass or custom field editor hook that owns only this field.
- Keep the monitor only if the native alternatives fail reproducibly.

Detailed PRD: `prd-address-field-key-monitor.md`

### 7. Sidebar And Titlebar Layout Boundaries

The sidebar being above the workspace is less concerning if frames do not overlap. The titlebar webview is the larger issue because it intentionally spans the whole window.

Why this matters:

- z-order is harmless only when layout guarantees non-overlap.
- The sidebar divider and workspace edge resize paths need clear ownership of the same gap.
- Future changes can accidentally create overlap and reintroduce click ambiguity.

Recommended direction:

- Document and assert root view frame boundaries: titlebar strip, sidebar column, divider, workspace area, modal overlay.
- Keep sidebar and workspace as non-overlapping siblings.
- Make overlap intentional only for modal/popover surfaces.

Detailed PRD: `prd-root-layout-boundaries.md`

## Lower Priority / Mostly Fine

### 8. Visual-Only Overlays

These are currently low risk because they explicitly return `nil` from `hitTest` or are intentionally scoped:

- `TerminalPaneBorderView`
- `ProjectEditorInitialLoadingOverlayView`
- `TerminalTitleBarDebugOverlayView`

Recommended direction:

- Keep them click-through.
- Add a small convention for future visual overlays: every visual-only overlay must override `hitTest` to return `nil` and include a short comment explaining that it is non-interactive.

Detailed PRD: `prd-visual-overlay-conventions.md`

### 9. Split Resize Rails

`TerminalWorkspacePaneResizeHandleView` is a transparent hit target, but it is currently designed as a real sibling view occupying the reserved split gap rather than an overlay spread over content.

Why it is acceptable:

- It owns cursor and drag where resizing actually belongs.
- It maps to real layout gaps.
- It avoids using a window-local resize monitor.

Recommended direction:

- Keep this model.
- Add debug validation that resize rails stay inside reserved pane gaps and never overlap pane content.
- Avoid adding invisible resize rails over terminal/browser content.

Detailed PRD: `prd-split-resize-rail-validation.md`

### 10. Floating Editor Overlay

`FloatingEditorOverlayView` is a real floating tool and should own its rectangle. It is not inherently problematic because it is visible and intentionally interactive.

Recommended direction:

- Keep it as an explicit overlay.
- Ensure it is never present invisibly with nonzero alpha or stale frame.
- Consider adding a debug assertion/log when it is hidden but still mounted.

Detailed PRD: `prd-floating-editor-overlay-safety.md`

## Suggested Execution Order

1. `prd-drag-feedback-click-through.md`
2. `prd-native-titlebar-button-hit-targets.md`
3. `prd-pane-header-monitor-reduction.md`
4. `prd-titlebar-chrome-scope.md`
5. `prd-root-layout-boundaries.md`
6. `prd-cef-drag-monitor-scope.md`
7. `prd-address-field-key-monitor.md`
8. `prd-visual-overlay-conventions.md`
9. `prd-split-resize-rail-validation.md`
10. `prd-floating-editor-overlay-safety.md`

The fastest low-risk cleanup is making drag feedback click-through. The largest architecture win is shrinking the full-window titlebar `WKWebView`, but that should be done carefully because it may affect React titlebar dropdown behavior.
