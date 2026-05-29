<!--
CDXC:iOSMigration 2026-05-26-14:22:
The iOS migration target is a clean VVTerm-based Ghostex iOS app. Use the VVTerm fork as the root `iOS` submodule and port sidebar behavior without bringing over the failed a-Shell Ghostty terminal integration.

CDXC:iOSMigration 2026-05-29-05:18:
The repository should now keep only the VVTerm-based iOS app. Remove the old a-Shell-based `iOS-old` submodule and update local scripts and requirements so future iOS work cannot target the legacy app.
-->

# Ghostex iOS Migration Requirements

## Goal

Move Ghostex iOS development onto the `maddada/ghostex-ios` fork of `vivy-company/vvterm`. Rebuild and maintain the Ghostex sidebar work on top of VVTerm's existing Ghostty, SSH, session, and SwiftUI architecture, with no active a-Shell-based app in this repository.

## Repository Layout

- Keep the VVTerm-based fork as the root `iOS` submodule pointing to `https://github.com/maddada/ghostex-ios.git`.
- Do not keep or re-add an `iOS-old` submodule in this repository.
- Do not add build scripts, docs, or release paths that target `a-Shell.xcodeproj`, `a-Shell-mini`, or `ghostex-ios-old`.

## Porting Scope

- Maintain the Ghostex sidebar product behavior in the VVTerm-based app:
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
- Do not port `GhostexNativeTerminal`, `GhostexGhosttyKitBridge`, `GhostexIOSGhosttySurfaceView`, `GhostexIOSTerminalSession`, or related native-terminal files from the removed a-Shell app.
- Do not port `GhostexLibssh2Runner` or the direct libssh2 attach path from the removed a-Shell app.
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

- The main repo has only one iOS app submodule: `iOS`.
- `.gitmodules` has no `iOS-old` or `ghostex-ios-old` submodule entry.
- `git submodule status` shows `iOS` but not `iOS-old`.
- `iOS` builds from the VVTerm-based fork after the migration setup.
- The new iOS app exposes a Ghostex sidebar entry point.
- The sidebar can show saved machine state, refresh remote Ghostex sessions, group sessions by project, and render recognizable session cards with agent identity.
- Sidebar actions execute through the VVTerm-based app architecture and do not depend on any old a-Shell terminal attach code.
- The old failed terminal integration files and concepts are absent from the new `iOS` implementation.
- Relevant tests or build checks are run and documented after implementation.

## Validation Plan

- Verify `.gitmodules` and `git submodule status` show `iOS` and do not show `iOS-old`.
- Build the new iOS target with Xcode tooling or the repo's documented build script where feasible.
- Run relevant VVTerm tests for model parsing, SSH command construction, sidebar view models, and action routing.
- Manually validate sidebar behavior in the VVTerm-based `iOS` app.
