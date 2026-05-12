# PRD: Tighten CEF Drag Monitor Scope

Date: 2026-05-11

## Problem

`cefNativeDragSourceReleaseEventMonitor` is a local monitor used to bridge CEF/Chromium drag source release and drag hover/drop behavior. It is more justified than titlebar click monitors, but it should remain strictly scoped to CEF browser panes.

## Goals

- Keep CEF drag/drop reliable.
- Ensure the monitor ignores non-CEF mouse streams as early as possible.
- Avoid turning CEF drag bridging into general workspace event plumbing.
- Keep polling active only during actual CEF drag candidates.

## Non-Goals

- Removing CEF drag bridging if it is required for VS Code/browser drag/drop.
- Rewriting CEF integration.
- Changing browser-pane UI.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/TerminalWorkspaceView.swift`
- `installCEFNativeDragSourceReleaseMonitorIfNeeded()`
- `handleCEFNativeDragSourceReleaseMonitorEvent(_:)`
- `startCEFNativeDragHoverTimerIfNeeded()`
- `pumpCEFNativeDragHoverTimer()`

## Proposed Behavior

The monitor should be installed only while the workspace has visible CEF/browser surfaces, and should arm drag state only when mouse-down occurs inside a CEF browser view.

## Implementation Plan

1. Add a helper like `hasVisibleCEFInteractionSurface`.
2. Use that helper in `syncCEFNativeDragSourceReleaseMonitor`.
3. In the monitor callback, return immediately unless:
   - event belongs to the workspace window
   - workspace is visible
   - event target/window point maps to a CEF browser view or an already-active CEF drag state
4. Ensure mouse-down outside CEF clears `cefNativeDragSourceRelease`.
5. Ensure timer starts only after a CEF mouse-down candidate.
6. Ensure timer stops on:
   - mouse-up
   - CEF pane hidden/removed
   - workspace removed from window
   - drag candidate abandoned
7. Add debug logs for install/uninstall and timer start/stop reasons.

## Acceptance Criteria

- CEF drag/drop still works in browser/project editor panes.
- Terminal pane clicks/drags do not arm CEF drag state.
- Timer is not running when no CEF drag candidate exists.
- Monitor is not installed if no visible CEF interaction surface exists.

## Risks

- Some CEF drag sequences may start before AppKit reports a clear target view.
- Project editor visibility can briefly lag layout/focus state.
- Over-tightening scope can regress VS Code drag/drop.

## Suggested Verification

- Drag files/text inside a browser pane.
- Drag within VS Code/project editor sidebar.
- Drag terminal text and ensure CEF monitor does not arm.
- Switch active panes/projects while a browser pane exists but is hidden.
