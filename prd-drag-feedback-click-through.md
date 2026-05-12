# PRD: Make Pane Drag Feedback Views Click-Through

Date: 2026-05-11

## Problem

Pane drag feedback views are visual affordances added above workspace content during tab/pane drag operations. Some do not explicitly opt out of hit testing.

Visual feedback views should never own clicks.

## Goals

- Guarantee drag feedback views cannot intercept clicks or drags.
- Reduce risk from stale feedback views.
- Preserve all visual feedback during drag operations.

## Non-Goals

- Changing drag/reorder semantics.
- Changing visual design of the feedback.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/TerminalWorkspaceView.swift`
- `TerminalPaneHeaderDragTargetView`
- `TerminalPaneTabReorderTargetView`
- `TerminalPaneHeaderDragGhostView`
- `updatePaneTabReorderTarget(_:)`
- `updatePaneHeaderDropTarget(...)`
- `endPaneHeaderDragFeedback(...)`

## Proposed Behavior

Every pane drag feedback view should override:

```swift
override func hitTest(_ point: NSPoint) -> NSView? {
  nil
}
```

These views should remain visible and layered above content, but AppKit should skip them for mouse ownership.

## Implementation Plan

1. Add `hitTest` returning `nil` to:
   - `TerminalPaneHeaderDragTargetView`
   - `TerminalPaneTabReorderTargetView`
   - `TerminalPaneHeaderDragGhostView`
2. Add a concise `CDXC:PaneDragFeedback` comment explaining that these are visual-only.
3. Audit `endPaneHeaderDragFeedback(...)` to confirm all feedback views are removed on drag end, cancellation, and project/editor surface transitions.
4. Add a debug log or assertion when starting a new drag while any feedback view is already mounted.
5. Test drag lifecycle:
   - start drag
   - drag over center drop target
   - drag over edge drop target
   - drag over tab reorder target
   - cancel/release
   - immediately click underlying pane/titlebar

## Acceptance Criteria

- Feedback views never appear as hit-test results.
- Underlying pane/titlebar receives clicks immediately after drag end.
- Stale feedback views, if present, cannot block input.
- Visual feedback still renders during active drags.

## Risks

- Very low. These views should not need mouse input.

## Suggested Verification

- Temporarily log `hitTest` owner during local testing.
- Use rapid drag-release-click sequences.
- Test release outside the app window and return focus.
