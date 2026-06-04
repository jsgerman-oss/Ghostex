Verdict: Not deploy-ready for the migration path yet. The core terminal/session import is much stronger after `ed727b402`, but there are still upgrade-risk gaps around non-terminal pane IDs, shared-vs-WK freshness scoring, and crash idempotency for log import.

## Critical

None.

## High

### Confirmed bug: migrated shared project snapshots can keep legacy `g-*` browser/T3 pane IDs and then block future project persistence

- Severity: High
- Concrete risk: Users upgrading with browser or T3 panes in their workspace can keep `g-*` session IDs inside the rewritten `native-sidebar-projects.json`. Because the file is also marked with `gxserverMigratedAt`, the React-side guard treats the stale file as canonical and blocks later shared-project writes that still contain those legacy IDs. The practical result is a workspace that loads but cannot persist subsequent project/layout changes until the legacy pane records are removed.
- File/line references:
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:1241): shared project rewrite remaps and writes the full project object.
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:1414): only `kind === "terminal"` sessions are collected for ID allocation; browser/T3 sessions are not mapped.
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:1360): unmapped session IDs are returned unchanged.
  - [shared/session-grid-contract-session.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/shared/session-grid-contract-session.ts:352): non-daemon panes use legacy `g-MMDD-HHMMSS` IDs.
  - [native/sidebar/native-sidebar.tsx](/Users/madda/dev/_active/zmux-ghostex-daemon/native/sidebar/native-sidebar.tsx:3302): browser panes are created through the shared workspace helper without a gxserver `G*` ID.
  - [native/sidebar/gxserver-sidebar-storage.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/native/sidebar/gxserver-sidebar-storage.ts:16): any payload with `gxserverMigratedAt` is considered canonical before checking for legacy IDs.
  - [native/sidebar/native-sidebar.tsx](/Users/madda/dev/_active/zmux-ghostex-daemon/native/sidebar/native-sidebar.tsx:5343): canonical shared payload plus legacy IDs in the outgoing payload blocks persistence.
- Reproduction or failure scenario: Start from a legacy shared project that has a browser pane session with `sessionId: "g-0530-180140"`. Run `migrateLegacyMacosStateIntoGxserver`. The import allocates `G*` IDs for terminal rows only, rewrites the project file with `gxserverMigratedAt`, and leaves the browser pane as `g-0530-180140`. On sidebar startup, `persistSharedProjectsSnapshot` sees a canonical shared file and an outgoing payload with legacy IDs, refreshes localStorage from the same stale shared file, and returns without writing the user's new state.
- Recommended fix: Decide whether client-local browser/T3 pane IDs should remain legacy-shaped after the gxserver cutover. If not, allocate/remap IDs for every session-bearing pane in project snapshots, even when only terminal/agent rows become daemon sessions. If browser/T3 IDs intentionally stay client-local, narrow `projectStoragePayloadHasLegacyGxserverIds` and the migration remapper to daemon-owned terminal IDs only, and add a regression fixture with a browser pane in the migrated project snapshot.

## Medium

### Confirmed bug: shared-vs-WK project freshness scoring ignores command-panel sessions

- Severity: Medium
- Concrete risk: First launch can import stale shared project JSON over richer WK localStorage when the only newer session data is in `commandsPanel.sessions`. That can drop command-pane sessions and active command-pane focus from the gxserver import despite fresher WK data existing.
- File/line references:
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:359): project payload selection chooses the higher `projectSnapshotScore`.
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:441): `projectSnapshotScore` only calls `projectSessionCount`.
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:451): `projectSessionCount` counts only `workspace.groups[].snapshot.sessions`.
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:1425): the importer does later import `commandsPanel.sessions`, so they are migration-relevant state.
- Reproduction or failure scenario: Shared JSON and WK localStorage have the same project count and workspace sessions. WK has a command-pane terminal in `commandsPanel.sessions`; shared JSON has no command-pane sessions but has a larger unrelated field, such as an icon data URL or extra client metadata. The shared payload receives the higher score by byte length and wins, so the command-pane terminal is never imported.
- Recommended fix: Include command-panel sessions and active command-panel references in the project freshness score, then add a test where WK is richer only through `commandsPanel.sessions` and must beat a larger stale shared payload.

### Speculative risk: settings freshness still prefers any shared settings file over richer WK localStorage

- Severity: Medium
- Concrete risk: If a user's `native-sidebar-settings.json` exists but is older or missing keys, migration imports that shared file and ignores a fresher WK `ghostex-native-settings` value. This could reset upgrade-sensitive behavior such as terminal engine, persistence provider, notification settings, and autosleep settings.
- File/line references:
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:293): shared settings are read from `native-sidebar-settings.json`.
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:305): settings choose `sharedSettings?.parsed` before localStorage with no freshness/richness scoring.
  - [native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift](/Users/madda/dev/_active/zmux-ghostex-daemon/native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift:171): native startup applies special richer/canonical selection only for projects and previous sessions.
- Reproduction or failure scenario: A pre-cutover build writes `native-sidebar-settings.json` with older settings, then WK localStorage receives a newer setting change before the gxserver upgrade. First gxserver launch imports the stale shared settings because the file exists.
- Recommended fix: Either prove shared settings are always the authoritative latest source before gxserver starts, or apply a deterministic settings source policy similar to projects/previous sessions. At minimum, add a regression test documenting the intended behavior when shared and WK settings disagree.

## Low

### Confirmed bug: legacy log import is not crash-idempotent before the import marker is recorded

- Severity: Low
- Concrete risk: A crash after legacy logs are appended to `gxserver.jsonl` but before the SQLite import marker is recorded causes the next launch to append the same legacy log lines again. This does not corrupt project/session state, but it makes diagnostics noisy and can skew log queries during an upgrade incident.
- File/line references:
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:181): import timestamp and source snapshot are prepared.
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:183): legacy logs are migrated before the state import marker is recorded.
  - [gxserver/src/log-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/log-migration.ts:83): each configured legacy file is streamed and appended.
  - [gxserver/src/log-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/log-migration.ts:122): migrated lines are logged without a dedupe key or per-file checkpoint.
  - [gxserver/src/legacy-macos-state-migration.ts](/Users/madda/dev/_active/zmux-ghostex-daemon/gxserver/src/legacy-macos-state-migration.ts:223): the marker is written only after DB import and shared-sidebar rewrite.
- Reproduction or failure scenario: Run the migration with legacy logs present, terminate the process after `migrateLegacyGxserverLogs` has appended lines and before `recordLegacyMacosStateImportStatus`, then start gxserver again. The same legacy lines are appended a second time.
- Recommended fix: Add an idempotency key/checkpoint for migrated legacy log lines, or record log migration progress in SQLite before/while appending. If duplicate logs are acceptable, document that explicitly and test it so deploy triage does not mistake it for a missed case.

## Tests Run Or Skipped

- Ran `npm run build` in `gxserver/`: passed.
- Ran `node --test dist/test/legacy-macos-state-migration.test.js dist/test/log-migration.test.js dist/test/storage.test.js dist/test/api.test.js` in `gxserver/`: 40 passed, 1 skipped. The skipped test was the real foreground gxserver process fixture because `127.0.0.1:58744` was already in use.
- Ran `node --test dist/test/domain-state.test.js dist/test/typed-operations.test.js dist/test/zmx-lifecycle.test.js` in `gxserver/`: 22 passed.
- Ran `bun test native/sidebar/gxserver-sidebar-storage.test.ts`: 2 passed.
- Skipped full macOS app launch/manual upgrade verification; this review is static plus focused unit/integration tests only.
