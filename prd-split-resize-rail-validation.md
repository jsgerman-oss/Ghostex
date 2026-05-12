# PRD: Validate Split Resize Rails Stay In Reserved Gaps

Date: 2026-05-11

## Problem

`TerminalWorkspacePaneResizeHandleView` is intentionally transparent and interactive. It is safe when it occupies only real split gaps. It becomes risky if future layout changes place invisible resize rails over pane content.

## Goals

- Preserve the current native AppKit rail model.
- Prove rails stay inside reserved split gaps.
- Prevent invisible resize hit targets from covering terminal/browser content.

## Non-Goals

- Removing transparent resize rails.
- Replacing AppKit resize handling with a monitor.
- Changing pane resize UX.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/TerminalWorkspaceView.swift`
- `TerminalWorkspacePaneResizeHandleView`
- `syncPaneResizeHandleViews()`
- `recordPaneResizeHits(...)`
- `paneResizeHits`

## Proposed Behavior

Each resize rail should remain a normal AppKit sibling view whose frame equals a real reserved layout gap between pane leaves.

## Implementation Plan

1. Add debug validation after `paneResizeHits` are recorded:
   - rail rect is not empty
   - rail rect lies within workspace bounds
   - rail rect does not overlap known pane content rects except at intended boundary/gap
2. Add logging for invalid rail geometry:
   - rail frame
   - split path
   - direction
   - neighboring pane frames
3. Keep `TerminalWorkspacePaneResizeHandleView.hitTest(_:)` returning itself only inside bounds.
4. Avoid any fallback that broadens resize detection over pane content.
5. Test nested splits and narrow panes.

## Acceptance Criteria

- Resize rails remain interactive and reliable.
- Debug validation catches rails that overlap content.
- No window-local resize monitor is introduced.
- Pane content remains selectable/clickable near edges except inside actual divider gaps.

## Risks

- Gap geometry can be off by one pixel during resize.
- Nested split layouts may require careful validation logic.
- Validation should be debug/logging only, not a user-facing crash.

## Suggested Verification

- Resize horizontal and vertical splits.
- Resize nested splits.
- Click/select terminal text near pane edges.
- Use browser pane content near split boundaries.
