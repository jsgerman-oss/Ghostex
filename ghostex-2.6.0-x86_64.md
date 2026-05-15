# Ghostex 2.6.0

This minor release improves the agent-management UI, sidebar navigation, native pane behavior, persistence visibility, and diagnostics.

- Improved Agents Hub profile tooltips with structured profile labels, instruction file paths, target paths, and Finder actions that stay readable for dense local agent configurations.
- Added a setting to hide Last Active timestamps on active session cards while letting titles use the full card width without overlapping status dots or close buttons.
- Hid browser page history from the Previous Sessions modal so the restore flow stays focused on agent sessions.
- Polished Previous Sessions and session-card metadata alignment, including fixed timestamp columns, project-label positioning, and clearer brand-colored agent icons.
- Simplified the sidebar overflow menu by removing completion sound, persistence, and remote-access controls from that compact menu while keeping scratch tools, running state, hotkeys, and help.
- Updated Next Tab and Previous Tab navigation to follow the visible sorted sidebar order, including collapsed Combined sections.
- Improved project-editor and command-pane hit routing so active editor surfaces, companion panes, command tabs, and resize handles receive the intended native clicks.
- Added native activation diagnostics and CEF layout logging to investigate focus steals and browser-pane geometry drift from app lifecycle and native frame snapshots.
- Added pane-tab geometry diagnostics, adjusted workspace tab-bar sizing, and made non-command tab add buttons use square chrome.
- Added provider/session context labels and first-run persistence notices for tmux, zmx, and zellij-backed terminal sessions.
- Kept macOS attention notifications minimal by using the session name as the title and project name as the body.
