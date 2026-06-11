# Prompt Editor Cross-Client Routing Plan

Date: 2026-06-11

## Overview

Ctrl+G prompt editing must be selected from the client currently interacting with a zmx session, not from the client that originally created the session.

This means a session created from TUI, Android, iOS, or SSH must still use Monaco later when a Monaco-enabled macOS/Electron app is the active client. The same session must use gte when Ctrl+G is pressed from TUI, mobile, or SSH.

## Current Problem

The existing safety fixes correctly made missing prompt-editor capability default to gte and made `ghostex prompt-editor` query the bundled zmx binary for the current zmx client capability.

The remaining problem is that sidebar-launched agent sessions are started by gxserver before the native terminal attach is fully involved. That provider-start path does not carry the same prompt-editor wrapper/backend contract as a plain terminal where the user starts the agent manually.

In practice:

- A plain macOS terminal attaches with Monaco-capable prompt-editor env, then the manually started agent inherits that env.
- A sidebar-launched agent can be started by gxserver through `zmx run --initial-command`, so the agent process may not inherit the neutral Ghostex prompt-editor wrapper and bundled zmx route correctly.
- If `ghostex prompt-editor` depends on static process env like `GHOSTEX_PROMPT_EDITOR_BACKEND=monaco`, the routing can reflect who created the session instead of who is using it now.

## Requirements

- macOS/Electron with Monaco enabled should advertise Monaco only for the current attach client.
- TUI, Android, iOS, and plain SSH should advertise no Monaco capability for now.
- Missing capability must continue to mean gte.
- The selected editor must depend on the current zmx leader/client at Ctrl+G time.
- Session creation source must not permanently decide Monaco vs gte.
- The bundled zmx binary must remain the one used for prompt-editor capability checks.
- The fix must not make gxserver globally default to Monaco.
- The fix must not store a durable "Monaco session" bit in shared session state.

## Intended Design

Make prompt-editor routing a current-client capability, not a session property.

The macOS/Electron attach flow should pass a transient prompt-editor client intent to gxserver when requesting attach metadata. When settings select Monaco, the intent should say this attach client wants Monaco. When settings select gte, custom, or when the client is TUI/mobile/SSH, gxserver should receive no Monaco intent.

gxserver should use that transient intent to build the zmx attach command:

- Monaco intent present: `zmx attach --prompt-editor=monaco <session>`.
- Monaco intent absent: `zmx attach <session>`.

zmx already stores prompt-editor capability per attached client and reports the leader client's capability. That behavior should remain the source of truth.

## Provider Startup Behavior

Provider startup should install a neutral prompt-editor wrapper into the zmx session process environment, not a permanent Monaco decision.

For gxserver-created providers, export the pieces required for any later Ctrl+G invocation to make a live routing decision:

- `EDITOR` and `VISUAL` should point at the Ghostex prompt-editor wrapper.
- `GHOSTEX_ZMX_BIN` should point at the bundled zmx binary.
- gxserver identity such as `GHOSTEX_GLOBAL_SESSION_REF`, local API URL, auth token file, and protocol version should remain exported.

The provider-start path should not rely on `GHOSTEX_PROMPT_EDITOR_BACKEND=monaco` as the long-term decision. If the CLI still needs a marker, it should be an "enabled/router" marker, not a client-specific Monaco preference.

## CLI Routing Behavior

`ghostex prompt-editor` should treat zmx current-client capability as authoritative for zmx sessions.

Expected routing:

- If zmx reports `monaco`, use the floating Monaco editor.
- If zmx reports `gte`, use gte.
- If there is no zmx session or no explicit bundled zmx route, keep the existing non-zmx behavior and default safely to gte unless a valid local backend explicitly applies.

This is the part that lets a TUI-created session later use Monaco from macOS, because the macOS attach client advertises Monaco at attach time and zmx reports that current client when Ctrl+G is pressed from macOS.

## Why This Keeps The Previous Fixes

The previous fixes were meant to prevent host-side Monaco popups from appearing when the current client cannot control them. This plan keeps that rule because Monaco is only selected after the current zmx leader client explicitly advertised Monaco.

It also keeps the bundled-zmx fix because the prompt-editor wrapper and CLI continue using `GHOSTEX_ZMX_BIN`, not whatever `zmx` appears first on `PATH`.

Missing or stale env remains safe:

- No attach intent means no Monaco capability.
- No zmx capability answer means gte.
- TUI/mobile/SSH cannot accidentally inherit a macOS-created Monaco preference.

## Example Flows

### TUI Creates, macOS Attaches Later

1. TUI creates the session without Monaco capability.
2. The session provider has the neutral `ghostex prompt-editor` wrapper.
3. macOS attaches with `--prompt-editor=monaco`.
4. Ctrl+G from macOS makes macOS the zmx leader.
5. `ghostex prompt-editor` asks zmx for capability and gets `monaco`.
6. Monaco opens.

### macOS Creates, TUI Attaches Later

1. macOS creates or attaches with `--prompt-editor=monaco`.
2. TUI attaches without Monaco capability.
3. Ctrl+G from TUI makes TUI the zmx leader.
4. `ghostex prompt-editor` asks zmx for capability and gets `gte`.
5. gte opens.

### Sidebar Agent Launch From macOS

1. macOS asks gxserver to start the missing provider and attach.
2. gxserver starts the provider with the neutral prompt-editor wrapper and bundled zmx route.
3. gxserver returns an attach command with `--prompt-editor=monaco` because the current macOS client requested it.
4. Ctrl+G from the macOS pane resolves to Monaco through zmx current-client capability.

## Implementation Touch Points

- `gxserver/protocol/index.ts`: add a transient prompt-editor client intent to attach/provider-start request types.
- `native/sidebar/gxserver-client.ts`: send the transient intent from macOS/Electron only when the current settings request Monaco.
- `native/sidebar/native-sidebar.tsx`: include that intent when fetching attach metadata and starting providers.
- `gxserver/src/server.ts`: pass the transient intent into zmx attach command construction and provider startup construction.
- `gxserver/src/zmx-lifecycle.ts`: build attach commands from explicit intent instead of reading terminal env at attach-script runtime; export neutral prompt-editor wrapper pieces for provider startup.
- `scripts/ghostex-cli.mjs`: make zmx current-client capability authoritative for zmx sessions.
- `zmx/src/main.zig`: keep current per-client capability and leader-client query behavior; only change if tests show Ctrl+G input does not make the pressing client the leader before capability is queried.

## Validation Plan

- Unit test CLI routing:
  - zmx capability `monaco` selects Monaco even without static `GHOSTEX_PROMPT_EDITOR_BACKEND=monaco`.
  - zmx capability `gte` selects gte even if stale process env says Monaco.
  - missing zmx route defaults to gte.

- Unit test gxserver attach command construction:
  - explicit Monaco intent adds `--prompt-editor=monaco`.
  - missing intent does not add Monaco.

- Unit test provider startup command:
  - exports wrapper/bundled zmx routing pieces.
  - does not bake current client Monaco preference as durable session state.

- Manual test:
  - sidebar-launched Codex from macOS uses Monaco.
  - plain terminal-created agent from macOS uses Monaco.
  - TUI/mobile/SSH attach uses gte.
  - session created from TUI then attached from macOS uses Monaco from macOS.
  - session created from macOS then attached from TUI uses gte from TUI.

## Open Questions

- Electron should likely use the same transient intent shape as macOS, with a distinct client enum only if diagnostics need to distinguish them.
- Custom editor behavior should remain scoped to local process env unless we intentionally design a cross-client custom editor contract.
- We should verify whether Ctrl+G always makes the pressing zmx attach client the leader before `prompt-editor-capability` is queried. If not, zmx needs a more direct "capability for requesting client" query for editor routing.

