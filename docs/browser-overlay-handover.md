# Browser Overlay Handover

## Goal

Browser-type actions in ghostex should open in Google Chrome Canary and place the
Canary window over the current ghostex workarea. The workspace switcher rail and
sidebar must remain visible so the user can still see and switch project/session
context while the browser is open.

This is intentionally native macOS window orchestration. It is not a webview
browser implementation.

## Current User-Facing Behavior

- Clicking a sidebar action whose `actionType` is `browser` opens its URL in
  Google Chrome Canary.
- The Chrome Canary window is resized and moved to cover only the native
  terminal/workarea pane of the ghostex window.
- The ghostex sidebar and workspace bar stay visible.
- Chrome Canary becomes the foreground app when opened so it can appear above
  ghostex.
- Clicking the attached Zed window tucks both ghostex and the tracked Chrome Canary
  window far offscreen.
- Clicking the native ghostex button restores ghostex, focuses ghostex, and restores the
  Chrome Canary window if it had been tucked away.
- Clicking away to unrelated apps no longer moves ghostex offscreen; it only hides
  the native Zed overlay button and drops ghostex to normal window ordering.

## Important Files

```text
native/sidebar/native-sidebar.tsx
native/macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift
native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift
native/macos/ghostexHost/Sources/ghostexHost/BrowserOverlayController.swift
native/macos/ghostexHost/Sources/ghostexHost/ZedOverlayController.swift
```

## Command Flow

The React sidebar sends a dedicated native command for browser actions:

```ts
{ type: "openBrowserWindow", url: string }
```

In `native-sidebar.tsx`, browser actions route through
`openNativeBrowserWindow(url)`. Generic links still use `openExternalUrl`, so
normal external URL behavior stays separate from the Chrome Canary overlay.

`HostProtocol.swift` decodes `openBrowserWindow` into `OpenBrowserWindow`.

`ghostexRootView` forwards that command to `AppDelegate`, because the browser
overlay needs access to native window controllers rather than staying inside the
sidebar webview router.

## BrowserOverlayController

`BrowserOverlayController.swift` owns the Chrome Canary behavior.

Key responsibilities:

- Find Google Chrome Canary by bundle id `com.google.Chrome.canary`.
- Open URLs using `NSWorkspace.shared.open(_:withApplicationAt:configuration:)`.
- Use Accessibility APIs to find Canary's focused/front window.
- Resize/move the Canary window to the supplied ghostex workarea frame.
- Track the active Canary window so it can be moved offscreen and restored.

The controller takes:

```swift
window: NSWindow
workareaFrameProvider: () -> NSRect?
setCompanionBrowserActive: (Bool) -> Void
```

The workarea frame provider is important. It points at
`ghostexRootView.workspaceScreenFrame()`, which converts `workspaceView.bounds`
into screen coordinates. This keeps Canary over the terminal/workarea only,
instead of covering the workspace rail and sidebar.

## Zed Overlay Coordination

`ZedOverlayController` treats Chrome Canary as a companion app while browser
overlay mode is active. This prevents the normal activation logic from treating
Chrome as an unrelated app and hiding ghostex immediately.

When Chrome opens, ghostex is temporarily set to normal window level so Canary can
actually appear above it. A normal Chrome app window cannot reliably sit above a
floating-level ghostex window otherwise.

The callbacks from `ZedOverlayController` into `BrowserOverlayController` are:

```swift
didHideAttachment -> moveBrowserOffscreen()
didShowAttachment -> restoreBrowserIfNeeded()
```

This keeps ghostex and Canary moving together when the user tucks or restores the
attached UI from the native Zed overlay button.

## Offscreen Strategy

Hidden windows are moved far to the bottom-left of the union of all visible
screens. The current padding is `1024` points.

Do not use minimize for this feature. The requirement is to preserve window
state and size while making the windows visually unavailable until the ghostex
button restores them.

## Accessibility Requirements

This feature depends on macOS Accessibility permission for ghostex.

Accessibility is used to:

- read Zed window position and size
- move/resize Chrome Canary windows
- raise Chrome Canary windows

If the button or browser positioning stops working, first verify that the built
`/Applications/ghostex.app` has Accessibility permission and is signed with the
stable Developer ID certificate already configured in the native Xcode project.

## Build And Check

Use:

```sh
bun run typecheck
bun run build
```

For a dev run that mirrors the current app install flow:

```sh
bun run start
```

Do not run install commands from this repo unless explicitly asked.
