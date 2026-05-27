---
name: ghostex-browser-devtools-mcp
description: >-
  Use this skill when adding, configuring, or troubleshooting agent access to
  Ghostex embedded CEF browser panes through the Ghostex browser DevTools MCP
  server. It covers CLI installation, MCP config, page selection, console logs,
  DOM snapshots, clicks, fills, key presses, screenshots, and the CEF remote
  debugging port used by `ghostex browser mcp`.
---

# Ghostex Browser DevTools MCP

Use this skill when a user wants an agent to see or control the browser pane
inside Ghostex, especially when they ask for Chrome DevTools-style capabilities
such as console logs, page snapshots, clicks, fills, navigation, or screenshots.

## Requirements

- Ghostex must be running with at least one embedded CEF browser pane open.
- The Ghostex CLI must be installed: `brew install --cask maddada/tap/ghostex --force`.
- The browser skill should be installed by the CLI: `ghostex browser install-skill`.

## MCP Server

Configure the agent to launch the MCP server over stdio:

```toml
[mcp_servers.ghostex-browser]
command = "ghostex"
args = ["browser", "mcp"]
```

If the CEF remote debugging port is not one of Ghostex's default ports, pass it
explicitly:

```toml
[mcp_servers.ghostex-browser]
command = "ghostex"
args = ["browser", "mcp", "--port", "9333"]
```

The same value can be provided as `GHOSTEX_CEF_REMOTE_DEBUGGING_PORT`.

## Workflow

1. Start by listing pages with `ghostex_list_pages`.
2. Select the intended pane with `ghostex_select_page` when multiple pages are
   open.
3. Use `ghostex_console_logs` before and after interactions when debugging
   runtime errors.
4. Use `ghostex_snapshot` to get stable element refs, then operate with
   `ghostex_click`, `ghostex_fill`, and `ghostex_press_key`.
5. Use `ghostex_evaluate` for focused inspection and `ghostex_screenshot` when
   visual evidence matters.

## Notes

- The server connects directly to CEF's Chrome DevTools Protocol endpoint; do
  not add Playwright or a second browser automation runtime for Ghostex panes.
- Element refs from `ghostex_snapshot` are only valid for the current page
  state. Re-run `ghostex_snapshot` after navigation or major DOM changes.
- Console collection starts when the MCP server attaches to a page, so open the
  MCP server before reproducing errors when possible.
