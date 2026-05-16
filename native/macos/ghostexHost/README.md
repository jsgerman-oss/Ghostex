# ghostex

Native macOS proof host for embedded Ghostty terminals.

This target is intentionally AppKit-first:

- `WKWebView` hosts a React sidebar/control UI built from the existing
  `SidebarApp` component.
- `TerminalWorkspaceView` owns native pane geometry.
- `Ghostty.SurfaceView` renders every terminal pane.
- A local WebSocket bridge receives ghostex host commands.

## Build Prerequisites

<!--
CDXC:NativeGhosttyBuild 2026-05-17-00:13:
The native host defaults to the repo-root `ghostty/` source dependency so the embedded terminal source is versioned with Ghostex and contributes its Zig code to the parent repo language breakdown.
Use `GHOSTTY_ROOT` only when intentionally testing a separate Ghostty checkout.
-->

Build Ghostty's macOS xcframework from the repo-root `ghostty/` source
dependency first:

```sh
(
  cd ghostty
  env DEVELOPER_DIR=/Library/Developer/CommandLineTools \
    SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \
    GHOSTTY_METAL_DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
    zig build -Demit-xcframework -Dxcframework-target=native -Demit-macos-app=false
)
```

That should produce:

```text
ghostty/macos/GhosttyKit.xcframework
```

If Zig finishes the native build but `xcodebuild -create-xcframework` fails,
rerun the printed `xcodebuild -create-xcframework ...` command manually. The
native host only needs the macOS arm64 slice for local development.

Build the host:

```sh
native/macos/ghostexHost/build-ghostex-host.sh
```

The build script also compiles `native/sidebar/native-sidebar.tsx` into
`native/macos/ghostexHost/Web`. That generated directory is ignored because it is
rebuilt every time.

The Xcode project is generated from `project.yml` with XcodeGen. It links
`GhosttyKit.xcframework` and compiles the small set of Ghostty macOS AppKit
sources needed to access `Ghostty.App` and `Ghostty.SurfaceView` directly while
the Ghostty fork is refactored into a reusable package.

## Runtime

The host listens for native terminal commands on:

```text
ws://127.0.0.1:58743
```

The host can also be driven by a Bun sidecar with:

```sh
ghostex_NATIVE_GHOSTTY_BRIDGE_URL=ws://127.0.0.1:58743 bun run start
```

The first milestone path is:

1. Launch `ghostex.app`.
2. The React sidebar web UI appears on the left.
3. A native Ghostty workspace appears beside it and creates the first terminal.
4. Sidebar create/focus/write/close actions post host commands into AppKit.
5. No web terminal renderer is mounted in the native workspace.
