# Ghostex CLI

<!-- CDXC:CliBranding 2026-05-12-07:35: Public CLI docs use `ghostex`
and `gx`; legacy `ghostex` terminal commands are intentionally not documented
as compatibility aliases. Internal storage paths can stay under ~/.ghostex. -->

`scripts/ghostex-cli.mjs` is a local debugging CLI for driving a running Ghostex app from the terminal.

It connects to the native host WebSocket bridge on `127.0.0.1:58743`, forwards commands into the sidebar runtime, and returns JSON. The goal is to create repeatable repros without manually clicking the app.

```sh
bun run cli -- state
# or
node scripts/ghostex-cli.mjs state
```

## Requirements

- Start Ghostex first. The CLI talks to the running app; it does not launch it.
- Rebuild/restart Ghostex after changing the native host or sidebar command handler.
- Use `--port <number>` if the native bridge port changes.

## Session Actions

```sh
bun run cli -- create-session "Shell"
bun run cli -- create-session "Setup" --input "pwd"
bun run cli -- create-agent codex
bun run cli -- create-agent claude --group-id group-2
bun run cli -- run-agent codex
bun run cli -- run-command dev
```

`create-agent` and `run-agent` use the same configured sidebar agent button data as the UI.

## Focus And Navigation

```sh
bun run cli -- state
bun run cli -- focus-session s-260427-063318-da1
bun run cli -- focus-session --index 0
bun run cli -- focus-session --session-number 2
bun run cli -- focus-group group-2
bun run cli -- switch-project --path /Users/madda/dev/_active/ghostex
bun run cli -- add-project /Users/madda/dev/_active/agent-tiler --name agent-tiler
ghostex sessions
gx sessions
```

## Sidebar Buttons

```sh
bun run cli -- click-button agent codex
bun run cli -- click-button command test
bun run cli -- set-visible-count 2
bun run cli -- set-view-mode grid
bun run cli -- move-sidebar
```

Button commands call the same sidebar runtime paths as the UI button handlers.

## Terminal Input

```sh
bun run cli -- send-text s-260427-063318-da1 "hello"
bun run cli -- send-text "Investigate logs" "hello"
bun run cli -- send-enter s-260427-063318-da1
bun run cli -- send-key s-260427-063318-da1 ctrl-c
bun run cli -- send-key s-260427-063318-da1 escape
bun run cli -- send-message "Investigate logs" "please summarize the latest output"
bun run cli -- send-message codex "please review this branch"
bun run cli -- rename-command s-260427-063318-da1 "Investigate logs"
```

`rename-command` writes `/rename <title>`, waits one second, then sends Enter through the native Enter path.

<!-- CDXC:CliAgentMessaging 2026-05-23-13:18: Cross-session agent orchestration needs visible sidebar sessions only. `send-message <agentId> <text>` creates a normal visible agent session when no target session selector is supplied, sends the message, and returns the new Ghostex id so the creator can read or follow up later. -->

`send-text`, `send-enter`, `send-key`, `send-message`, and `rename-command` accept a session id, numeric alias, quoted title, or `project:title` selector.
When `send-message` receives an agent id instead of a matching session selector, it creates a new visible agent session in the sidebar and returns its `ghostexId`.

## Terminal Readback

```sh
bun run cli -- read-text s-260427-063318-da1 --lines 80
bun run cli -- read-text "Investigate logs" --visible
bun run cli -- read-messages "Project:Investigate logs" --json
```

`read-text` reads the selected Ghostty terminal surface. By default it reads the terminal screen buffer; `--visible` limits the result to the currently shown viewport.

## Session Management

```sh
bun run cli -- rename-session s-260427-063318-da1 "Local title"
bun run cli -- sleep-session s-260427-063318-da1 true
bun run cli -- favorite-session s-260427-063318-da1 true
bun run cli -- fork-session s-260427-063318-da1
bun run cli -- restart-session s-260427-063318-da1
bun run cli -- reload-session s-260427-063318-da1
bun run cli -- close-session s-260427-063318-da1
```

## Assertions

```sh
bun run cli -- assert-card s-260427-063318-da1 --agent-icon codex --agent-name codex --visible true
bun run cli -- wait-for s-260427-063318-da1 --agent-icon codex --timeout-ms 8000
```

These commands exit nonzero when the assertion fails.

## Evidence Capture

```sh
bun run cli -- screenshot ~/.ghostex/cli/current.png
bun run cli -- logs --file agent-detection-debug.log --lines 200
bun run cli -- logs --file agent-detection-debug.log --grep sidebarCardProjection --json
bun run cli -- bundle ~/.ghostex/cli/repro-agent-icon --lines 500
```

`bundle` writes:

- `state.json`
- `logs.json`
- `screenshot.png`

## Example Repro

```sh
bun run cli -- create-agent codex
bun run cli -- wait-for --index 0 --agent-icon codex --agent-name codex --timeout-ms 8000
bun run cli -- screenshot ~/.ghostex/cli/codex-agent-card.png
bun run cli -- logs --file agent-detection-debug.log --lines 120
```

This creates a Codex session, waits until the sidebar card projection has Codex identity, captures the UI, and prints recent agent-detection logs.
