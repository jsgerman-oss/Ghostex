# PRD: Define And Validate Root Layout Boundaries

Date: 2026-05-11

## Problem

Sidebar, workspace, divider, titlebar chrome, modal host, and temporary overlays rely on z-order and frame geometry. Some overlap is intentional, but accidental overlap makes click and drag ownership ambiguous.

The sidebar being above workspace is acceptable only if their frames do not overlap. The full-window titlebar webview is the larger concern because it intentionally overlaps everything.

## Goals

- Make root layout ownership explicit.
- Prevent accidental overlap between sidebar, divider, workspace, and titlebar strip.
- Permit overlap only for modal/popover/floating surfaces that intentionally own their area.
- Improve debugging when hit-test bugs occur.

## Non-Goals

- Redesigning the app layout.
- Removing modal overlays.
- Removing sidebar.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/AppDelegate.swift`
- `zmuxRootView`
- `workspaceView`
- `sidebarView`
- `divider`
- `modalHostView`
- `titlebarChromeView`
- `ReactTitlebarChromeView`

## Proposed Behavior

Root layout should have explicit non-overlapping base regions:

- titlebar strip
- sidebar column
- divider strip
- workspace area

Intentional overlay regions should be explicit:

- modal host while visible
- titlebar dropdown/popover while visible
- app-level temporary overlays if any

## Implementation Plan

1. Find root `layout()` for `zmuxRootView`.
2. Add helper methods to compute:
   - `titlebarFrame`
   - `sidebarFrame`
   - `dividerFrame`
   - `workspaceFrame`
   - `modalHostFrame`
3. Use those helpers consistently.
4. Add debug-only validation:
   - sidebar does not overlap workspace
   - divider only touches sidebar/workspace boundary
   - titlebar strip does not overlap workspace content unless intentionally reserved
   - modal host is hidden when inactive
5. Add optional repro logging when overlap validation fails.
6. Update comments to encode the intended ownership model.

## Acceptance Criteria

- Base root layout regions are computed in one place.
- Sidebar and workspace do not overlap in normal operation.
- Divider owns only the resize strip.
- Titlebar chrome does not cover workspace unless a separate intentional dropdown/modal overlay is visible.
- Debug logs identify unexpected overlap quickly.

## Risks

- Existing layout may rely on slight overlap for visual seams or hit targets.
- Sidebar side switching must be tested.
- Retina/backing scale changes may expose off-by-one gaps.

## Suggested Verification

- Resize the main window.
- Switch sidebar left/right if supported.
- Resize sidebar.
- Open modals.
- Use titlebar controls and workspace pane controls at boundaries.
