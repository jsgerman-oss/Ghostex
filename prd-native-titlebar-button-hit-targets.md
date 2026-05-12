# PRD: Make Native Titlebar Buttons Own Their Hit Targets

Date: 2026-05-11

## Problem

Titlebar actions are represented by `NSButton`s, but some behavior still depends on titlebar-level point lookup and fallback mouse handling. This makes clicks fragile when visual button geometry, widened hit geometry, and AppKit's actual button frame diverge.

The clean AppKit model is that the actual `NSButton` frame should be the entire intended hit target.

## Goals

- Make action buttons, Pop In/Pop Out, Close, Split, New Terminal, Browser, Reload, Fork, Rename, and delayed-send actions use native `NSButton.target/action`.
- Keep visual icons centered while increasing the actual button frame if needed.
- Remove reliance on monitor-based or titlebar fallback click synthesis for button actions.
- Preserve accessibility activation.

## Non-Goals

- Replacing titlebar tabs with buttons in this PRD.
- Changing the action set itself.
- Changing command semantics after button activation.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/TerminalWorkspaceView.swift`
- `TerminalSessionTitleBarView`
- `TerminalTitleBarActionButton`
- `TerminalSessionTitleBarView.actionButtonAction(at:)`
- `TerminalSessionTitleBarView.performTitleBarAction(_:)`
- `TerminalSessionTitleBarView.hitTest(_:)`

## Proposed Behavior

Every visible action button should have:

- A real AppKit frame matching the full click target.
- A centered image/icon inside that frame.
- `target = self`
- `action = #selector(performTitleBarAction(_:))`
- No separate invisible hit rectangle.

If the hit target needs to be larger than the visual icon, enlarge the button frame and use button image alignment/content insets/custom drawing to keep the icon visually compact.

## Implementation Plan

1. Audit `actionButtonAction(at:)`.
2. Identify every place where it is used only to simulate a native button click.
3. Keep point lookup only where the titlebar itself owns the pointer stream for non-button concepts.
4. Increase `TerminalTitleBarActionButton` frame size in layout where needed:
   - Use stable width/height.
   - Keep icon centered.
   - Avoid negative/invisible frame expansion outside the button.
5. Update `TerminalSessionTitleBarView.hitTest(_:)`:
   - Let `super.hitTest(point)` return the actual button for real button frames.
   - Avoid returning `self` for points intended to activate an `NSButton`.
6. Remove monitor/titlebar fallback activation for action buttons.
7. Keep native `performTitleBarAction(_:)` as the only action button activation path.
8. Test popped-out titlebar Pop In specifically because it is a known sensitive action.

## Acceptance Criteria

- Clicking the visual Pop In button in a popped-out pane reattaches the pane via native `NSButton` action.
- Clicking the same action via accessibility still works.
- Clicking every titlebar action uses `performTitleBarAction(_:)`.
- No window-local monitor action selection log is emitted for button clicks.
- Button hit targets are stable in narrow and wide panes.
- Button frames do not overlap tab frames except by intentional layout rules.

## Risks

- Enlarged button frames can reduce space for tabs in narrow panes.
- The collapsed hamburger menu and close button may need explicit priority rules.
- Some current titlebar fallback behavior may be hiding a real frame/layout bug.

## Suggested Verification

- Use raw mouse clicks, not accessibility activation only.
- Test normal panes, web panes, narrow panes, tabbed panes, and popped-out panes.
- Test first click into an inactive window using `acceptsFirstMouse`.
