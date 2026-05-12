# PRD: Establish Visual Overlay Click-Through Conventions

Date: 2026-05-11

## Problem

Several overlays are visual-only and currently safe because they explicitly return `nil` from `hitTest`. Future overlays should follow the same convention so visual layers cannot accidentally steal clicks.

## Goals

- Document a clear rule for visual-only overlays.
- Ensure current visual-only overlays remain click-through.
- Make future code reviews simpler.

## Non-Goals

- Removing visual overlays.
- Changing visual design.
- Changing interactive overlays like floating editors.

## Current Implementation References

- `TerminalPaneBorderView`
- `ProjectEditorInitialLoadingOverlayView`
- `TerminalTitleBarDebugOverlayView`
- `native/macos/zmuxHost/Sources/zmuxHost/TerminalWorkspaceView.swift`

## Proposed Rule

Any visual-only overlay must:

- Override `hitTest(_:)` and return `nil`.
- Include a short comment explaining it is visual-only.
- Avoid registering tracking areas or cursor rects unless it is intentionally interactive.
- Avoid `acceptsFirstMouse` unless it intentionally owns clicks.

## Implementation Plan

1. Audit current visual-only overlays.
2. Confirm these return `nil` from `hitTest`:
   - `TerminalPaneBorderView`
   - `ProjectEditorInitialLoadingOverlayView`
   - `TerminalTitleBarDebugOverlayView`
3. Add concise comments if missing.
4. Add the same convention to drag feedback views as part of `prd-drag-feedback-click-through.md`.
5. Optionally add a lightweight helper base class only if repeated code becomes meaningful. Do not add abstraction just for one or two views.

## Acceptance Criteria

- Every visual-only overlay has explicit click-through behavior.
- Interactive overlays are clearly distinguishable from visual-only overlays.
- Code comments make ownership clear.

## Risks

- Very low. The main risk is accidentally marking an interactive overlay click-through.

## Suggested Verification

- Click through borders/loading/debug overlays to underlying controls.
- Use debug overlays if available and confirm they do not block tabs/buttons.
