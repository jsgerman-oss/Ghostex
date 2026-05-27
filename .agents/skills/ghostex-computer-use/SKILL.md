---
name: ghostex-computer-use
description: >-
  Use this skill when the user asks for Ghostex Computer Use, Desktop Control,
  or native macOS app automation. It wraps the Cua Driver workflow so agents can
  drive desktop apps without the user needing to remember `$cua-driver`.
---

# Ghostex Computer Use

Use this skill when a task needs native macOS app automation through Ghostex
Desktop Control. This skill is intentionally a wrapper around `$cua-driver`: if
the `$cua-driver` skill is available, load it and follow its workflow exactly.

Use `$ghostex-browser-use` instead for Ghostex embedded browser panes.

## Requirements

- Desktop Control must be installed from Ghostex first-launch setup or Settings
  > Integrations.
- Cua Driver must be available as `cua-driver`.
- macOS Accessibility and Screen Recording permissions must be granted for Cua
  Driver.

Check the machine state before acting:

```bash
which cua-driver
cua-driver status
cua-driver check_permissions
```

If the daemon is not running, start it with:

```bash
open -n -g -a CuaDriver --args serve
```

## Operating Rules

- Prefer CLI calls: `cua-driver <tool> '<JSON>'`.
- Use the Cua Driver MCP server only when the task or environment explicitly
  needs MCP mode.
- Do not foreground the user's apps unless the user explicitly asks for that.
- Do not use `open -a`, AppleScript activation, HID event injection, `cliclick`,
  or menu-bar automation for background control.
- Do not rely on coordinates when the accessibility tree gives stable
  `element_index` values.

## Canonical Loop

1. Launch or find the app with Cua Driver, for example:

   ```bash
   cua-driver launch_app '{"bundle_id":"com.apple.TextEdit"}'
   ```

2. Get the window state:

   ```bash
   cua-driver get_window_state '{"pid":1234,"window_id":5678}'
   ```

3. Choose the target by `element_index` from the snapshot.
4. Perform one action such as click, type, scroll, drag, key press, or set value.
5. Re-run `get_window_state` and verify the expected UI state before continuing.

## Notes

- Keep the user's current foreground app alone. Cua Driver can launch and drive
  apps in the background when you identify the right app, pid, window id, and
  element indexes.
- Prefer one small verified action at a time. Re-snapshot after every stateful
  action because element indexes can change as the UI updates.
- For full command details, defer to `$cua-driver`; this wrapper exists so users
  can ask for `$ghostex-computer-use`.
