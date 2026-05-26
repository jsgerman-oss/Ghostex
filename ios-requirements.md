<!--
CDXC:iOSMigration 2026-05-26-14:22:
The iOS migration target is a clean VVTerm-based Ghostex iOS app. Preserve the old a-Shell-based app as iOS-old, make the new VVTerm fork the iOS submodule, and port sidebar behavior without bringing over the failed a-Shell Ghostty terminal integration.
-->

# Ghostex iOS Migration Requirements

## Goal

Move Ghostex iOS development onto a fresh fork of `vivy-company/vvterm`, while keeping the current a-Shell-based iOS app available side by side for reference. Rebuild the Ghostex sidebar work on top of VVTerm's existing Ghostty, SSH, session, and SwiftUI architecture.

## Repository Layout

- Rename the current GitHub repository `maddada/ghostex-ios` to `maddada/ghostex-ios-old`.
- Fork `https://github.com/vivy-company/vvterm` as `maddada/ghostex-ios`.
- Rename the current local `iOS` submodule path to `iOS-old`.
- Update `.gitmodules` so `iOS-old` points to `https://github.com/maddada/ghostex-ios-old.git`.
- Add the new VVTerm-based fork as the `iOS` submodule pointing to `https://github.com/maddada/ghostex-ios.git`.
- Keep both submodules available in this repo so sidebar behavior can be compared and ported from `iOS-old` into `iOS`.

## Porting Scope

- Port the Ghostex sidebar product behavior from `iOS-old`:
  - saved machine management needed to reach the desktop Ghostex host;
  - session inventory refresh using the Ghostex command contract;
  - project grouping;
  - session rows/cards with status, project metadata, title, agent name, and agent icon;
  - known Ghostex agent icon mapping and tint behavior;
  - session actions such as attach/open, wake, sleep, kill, rename, copy details, and show details where supported by the command contract;
  - project actions such as create session, refresh, wake/sleep/kill project sessions, move project, copy project path, and show details where supported;
  - sidebar diagnostics/log view with copy support.
- Reimplement this in the VVTerm code style and architecture, not by transplanting the old `SceneDelegate.swift` UIKit monolith.
- Prefer a feature-first placement in the new repo, for example a Ghostex-specific feature area or the closest existing VVTerm server/session feature boundary.
- Add CDXC comments in changed code for user-facing requirements and important technical decisions.

## Explicitly Out Of Scope

- Do not port the old a-Shell terminal integration.
- Do not port `GhostexNativeTerminal`, `GhostexGhosttyKitBridge`, `GhostexIOSGhosttySurfaceView`, `GhostexIOSTerminalSession`, or related native-terminal files from `iOS-old`.
- Do not port `GhostexLibssh2Runner` or the direct libssh2 attach path from `iOS-old`.
- Do not port `ios_system`, local fork, stdout backpressure, direct attach render slicing, Ghostty tick suppression, or terminal stall recovery logic from the old a-Shell implementation.
- Do not add fallback terminal paths. The new implementation should use VVTerm's existing terminal, SSH, and session managers as the correct base behavior.

## VVTerm Integration Direction

- Treat VVTerm as the source of truth for Ghostty rendering, SSH transport, credentials, server records, navigation, tabs, sessions, tmux handling, and terminal lifecycle.
- Wire Ghostex sidebar actions through VVTerm's existing managers where possible:
  - `ServerManager` for server/machine records or equivalent saved host state;
  - `ConnectionSessionManager` and `TerminalTabManager` for active terminal/session state;
  - `SSHClient` and existing SSH helpers for remote command execution;
  - existing SwiftUI navigation and sheet patterns for sidebar presentation on iOS.
- If a Ghostex-specific persisted model is needed, keep it small and separate from VVTerm's server model unless there is a clear reason to extend the existing model.
- The initial implementation can be iOS-first. Avoid destabilizing macOS unless shared code is clearly appropriate.

## Acceptance Criteria

- The main repo has `iOS-old` and `iOS` submodules with the intended remote URLs.
- `iOS-old` still points at the preserved old Ghostex iOS app.
- `iOS` builds from the VVTerm-based fork after the migration setup.
- The new iOS app exposes a Ghostex sidebar entry point.
- The sidebar can show saved machine state, refresh remote Ghostex sessions, group sessions by project, and render recognizable session cards with agent identity.
- Sidebar actions execute through the VVTerm-based app architecture and do not depend on any old a-Shell terminal attach code.
- The old failed terminal integration files and concepts are absent from the new `iOS` implementation.
- Relevant tests or build checks are run and documented after implementation.

## Validation Plan

- Verify `.gitmodules` and `git submodule status` show `iOS-old` and `iOS` correctly.
- Build the new iOS target with Xcode tooling or the repo's documented build script where feasible.
- Run relevant VVTerm tests for model parsing, SSH command construction, sidebar view models, and action routing.
- Manually compare the old sidebar in `iOS-old` against the new sidebar in `iOS` for the required product behavior.
