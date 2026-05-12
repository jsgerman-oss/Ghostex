# PRD: Replace Or Justify Browser Address Field Key Monitor

Date: 2026-05-11

## Problem

`WebPaneHostView` installs `addressFieldKeyMonitor` to consume Return/keypad Enter while the native browser address field is being edited. The monitor is scoped, but it still observes local key events outside the normal responder/control path.

## Goals

- Prefer native AppKit text-field/control ownership for address submission.
- Keep typed URLs/searches committing reliably on Return and keypad Enter.
- Remove the local key monitor if native delegate/subclass paths cover all cases.

## Non-Goals

- Changing browser navigation semantics.
- Changing toolbar layout.
- Replacing the native address field with web UI.

## Current Implementation References

- `native/macos/zmuxHost/Sources/zmuxHost/TerminalWorkspaceView.swift`
- `WebPaneHostView`
- `installAddressFieldKeyMonitor()`
- `shouldCommitAddress(forKeyDown:)`
- `control(_:textView:doCommandBy:)`
- `controlTextDidEndEditing(_:)`
- `commitAddress()`

## Proposed Behavior

Return handling should live as close as possible to the native address field:

- First choice: delegate method `control(_:textView:doCommandBy:)`.
- Second choice: custom `NSTextField` subclass that handles Return/keypad Enter.
- Last resort: keep the local monitor, but document the exact AppKit path it covers and gate it as tightly as possible.

## Implementation Plan

1. Instrument current Return paths during local testing:
   - `NSTextField.action`
   - `control(_:textView:doCommandBy:)`
   - `controlTextDidEndEditing`
   - local monitor
2. Identify which path is actually needed for the failing case.
3. If delegate methods are sufficient, remove `addressFieldKeyMonitor`.
4. If delegate methods miss keypad Enter or field-editor behavior, create a small `BrowserAddressTextField` subclass.
5. Move Return/keypad Enter handling into that subclass or its cell/editor delegate.
6. Keep `commitAddress()` and first-responder restoration unchanged.
7. If the monitor remains:
   - only install while the field is in a window
   - only consume events when the field editor is first responder
   - add a comment explaining why native delegate paths were insufficient

## Acceptance Criteria

- Pressing Return in address field navigates.
- Pressing keypad Enter in address field navigates.
- Escape exits editing and returns focus to browser content.
- Return in unrelated text fields or web content is not consumed.
- If the monitor is removed, no address-field behavior regresses.
- If the monitor remains, its scope is documented and minimal.

## Risks

- AppKit field-editor behavior can differ between Return and keypad Enter.
- `NSTextField.action` may not fire in all focus-transition paths.
- Browser content focus restoration must remain correct.

## Suggested Verification

- Type a full URL and press Return.
- Type a search query and press Return.
- Use keypad Enter.
- Press Escape while editing.
- Click browser content, then click address field and submit again.
