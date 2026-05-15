# Ghostex 2.5.1

This patch release ships the new dual-architecture distribution path and a set of focused UI, workspace, and launch improvements.

- Published a native Apple Silicon build with the architecture-aware `ghostex` Homebrew cask.
- Kept the README install flow clear: `brew install --cask maddada/tap/ghostex` automatically selects the right Mac build.
- Changed sidebar actions to always use an explicit icon, defaulting new and legacy actions to the Play glyph with editable color.
- Added a titlebar pet control that toggles the floating pet overlay through persisted settings and keeps the overlay state synchronized.
- Resized the floating pet overlay to fit the sprite when no activity bubbles are visible while preserving the wider activity panel when messages appear.
- Improved Commands panel focus restoration so collapsing command terminals returns keyboard focus to the previous workspace terminal.
- Improved Reload Session placement so reloaded terminals replace the clicked pane/tab instead of appending as a new split.
- Kept embedded VS Code open when creating new terminal, browser, T3, or command sessions from the sidebar.
- Polished Previous Sessions rows with centered restore content, an X delete control, and active-session icon hover behavior that does not dim the focused row.
- Consolidated sidebar resize ownership, aligned pane tab heights, and hid active pane borders in single-pane workspaces.
- Updated local native launch behavior so `bun run start` uses architecture-specific DerivedData paths for arm64 and x86_64 builds.
