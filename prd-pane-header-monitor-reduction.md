# PRD: Reduce Pane Header Event Monitor Responsibilities

Date: 2026-05-11

## Problem

`paneHeaderEventMonitor` is a window-local mouse monitor installed by `TerminalWorkspaceView`. It currently observes `leftMouseDown`, `leftMouseDragged`, `leftMouseUp`, and `mouseMoved`.

The current code comment already says titlebar action clicks must use native `NSButton`/`NSView` dispatch, and the monitor must not synthesize Pop In, action-menu, close, or other button clicks. The remaining risk is that the monitor still combines several unrelated concerns.

## Goals

- Keep normal AppKit controls responsible for their own clicks.
- Keep tab/titlebar drag continuation reliable after the pointer leaves the source view.
- Remove or relocate monitor responsibilities that can be expressed through native view ownership.
- Make it impossible for this monitor to become a catch-all click router again.

## Non-Goals

- Removing tab drag/reorder behavior.
- Removing hover reveal behavior before a native replacement exists.
- Changing CEF drag/drop behavior.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/TerminalWorkspaceView.swift`
- `installPaneHeaderEventMonitor()`
- `handlePaneHeaderMonitorEvent(_:)`
- `setHoveredPaneSessionId(_:)`
- `acknowledgeClickedAttentionPane(at:)`
- `handlePaneTitleBarMouseDragged(...)`
- `handlePaneTitleBarMouseUp(...)`

## Current Monitor Responsibilities

- Update hovered pane from mouse events.
- Log pane/tab pointer probes.
- Log focus mouse-down probes.
- Acknowledge clicked attention panes.
- Keep resize cursor stable during active resize drag.
- Continue existing pane header/tab drag feedback.
- End an existing pane header/tab drag on mouse-up.

## Proposed Behavior

The monitor should only continue and finish a drag that was already started by a native titlebar/tab view. All click ownership should stay with the clicked view.

## Implementation Plan

1. Add a narrow helper that answers whether the monitor should do anything:
   - `paneHeaderDrag != nil`
   - or `paneResizeDrag != nil` if cursor stabilization must remain here temporarily.
2. Remove any titlebar action, hamburger menu, tab inline action, Pop In, Pop Out, or Close resolution from the monitor if present.
3. Move hover reveal away from the monitor:
   - Prefer tracking areas on pane containers or titlebar/content container views.
   - If content views consume events, add tracking areas to pane leaf containers instead of using a window monitor.
4. Move attention acknowledgement away from the monitor:
   - Prefer pane container `mouseDown` ownership or titlebar/content focus callbacks.
   - If terminal/browser content must still acknowledge attention, attach the acknowledgement to focus paths instead of raw monitor clicks.
5. Keep drag continuation:
   - Titlebar/tab view starts the drag.
   - Monitor only continues/releases when `paneHeaderDrag` already exists.
   - Monitor never starts a drag.
6. Add code comments near the monitor explaining the strict boundary.
7. Add debug logging if the monitor receives a mouse-down while no drag is active and does anything more than passive logging.

## Acceptance Criteria

- Clicking titlebar action buttons never requires `paneHeaderEventMonitor`.
- Pop In/Pop Out works through native button action paths.
- Hamburger menu opens through native titlebar/menu-button ownership.
- The monitor does not start drags.
- Existing drag continuation still works when the pointer leaves the titlebar while dragging.
- Hover reveal and attention acknowledgement either use native view paths or are explicitly documented as temporary remaining monitor responsibilities.

## Risks

- Pane hover may be harder to track because terminal/browser content can consume mouse events.
- Attention acknowledgement may need a clean focus-based replacement.
- Drag continuation can regress if mouse-up outside the titlebar is not captured.

## Suggested Verification

- Click every titlebar action in normal and narrow pane layouts.
- Drag a tab/titlebar out of its source view and release over another pane.
- Click a done/attention pane and confirm the attention state clears.
- Hover pane content and confirm secondary titlebar actions reveal as expected.
