# PRD: Keep Floating Editor Overlay Explicit And Safe

Date: 2026-05-11

## Problem

`FloatingEditorOverlayView` is a legitimate interactive overlay. It intentionally sits above workspace content and owns its rectangle. The risk is not that it exists, but that it could remain mounted while invisible, stale, or outside expected state.

## Goals

- Keep floating editor behavior intact.
- Ensure the overlay is present only when expected.
- Ensure hidden/stale floating editor overlays do not block workspace input.

## Non-Goals

- Removing the floating editor.
- Changing editor save/close semantics.
- Changing floating editor visual design.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/TerminalWorkspaceView.swift`
- `FloatingEditorOverlayView`
- `openFloatingEditor(...)`
- `layoutFloatingEditorOverlay()`
- `orderFloatingEditorOverlayToFront()`
- `closeFloatingEditorOverlay(...)`

## Proposed Behavior

The floating editor should remain an explicit, visible, interactive overlay when open. It should not exist as an invisible click blocker.

## Implementation Plan

1. Audit all open and close paths.
2. Ensure close always removes the overlay from the superview and clears `floatingEditorOverlayView`.
3. Add debug logging when:
   - overlay is mounted
   - overlay is ordered to front
   - overlay is closed
   - overlay is hidden or alpha is zero while still mounted
4. In `floatingEditorHitView(at:)`, keep the current guard that requires:
   - overlay exists
   - not hidden
   - alpha > 0
   - frame contains point
5. Consider adding a debug assertion if `floatingEditorOverlayView` is mounted but hidden.

## Acceptance Criteria

- Floating editor works normally.
- Clicking outside the visible floating editor reaches workspace content.
- Closing the floating editor always removes it.
- Hidden or transparent floating editor states are logged or prevented.

## Risks

- Very low if limited to logging and state validation.
- Be careful not to close an active editor during save.

## Suggested Verification

- Open floating editor.
- Drag it.
- Resize it.
- Save/close it.
- Click workspace immediately after close.
