# Ghostex gxserver Migration Review Notes

Scope: migration code and migration-adjacent startup/storage paths, especially `gxserver/src/legacy-macos-state-migration.ts`, `gxserver/test/legacy-macos-state-migration.test.ts`, `native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift`, and startup/sidebar storage flow.

## Findings

### Critical: First migrated app launch can keep running with stale legacy project/session IDs and later overwrite the canonical rewrite

`AppDelegate.applicationDidFinishLaunching` creates the window before starting gxserver (`makeWindow()` at `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift:499`, `startGxserverBootstrap()` at `:502`). Window construction injects `GhostexAppStorage.readSharedSidebarStorage()` into `window.__ghostex_NATIVE_HOST__` (`AppDelegate.swift:4364-4371`), and the React sidebar immediately initializes `projects` from that bootstrap/localStorage (`native/sidebar/native-sidebar.tsx:1440-1442`, `:4968-5024`) and may persist that snapshot back to shared storage (`:5001-5003`, `:5315-5359`).

The gxserver migration runs later inside `runGxserverForeground` (`gxserver/src/server.ts:127-136`) and rewrites `native-sidebar-projects.json` at `gxserver/src/legacy-macos-state-migration.ts:170-179`. However the already-mounted sidebar does not replace its in-memory `projects` after gxserver reports ready; `handleGxserverStatusEvent` only refreshes `gxserverStartupSnapshot` (`native/sidebar/native-sidebar.tsx:2119-2137`), and `refreshGxserverStartupSnapshot` only stores/logs the server snapshot (`:2099-2117`). That leaves the first app session using the pre-migration `project-*`/`g-*` IDs. Any later `writeStoredProjects` call can write those stale IDs back over the file gxserver just canonicalized (`native/sidebar/native-sidebar.tsx:5272-5274`, `:5357-5359`).

Impact: real upgrades can still hit `notFound`/attach failures on first launch, and the canonical shared-file rewrite may not survive normal sidebar activity. This also delays the Swift localStorage replacement path until a later app launch because `GhostexAppStorage.readSharedSidebarStorage()` only chooses/pushes canonical shared data when it is called after the canonical file exists (`GhostexAppStorage.swift:73-103`, `:195-207`, `:338-363`).

Evidence that would confirm: run a clean pre-cutover profile with legacy shared/localStorage, launch the app, wait for gxserver migration completion, then inspect the in-memory/sidebar persisted `activeProjectId` and a workspace session ID before any relaunch. If they remain `project-*`/`g-*` or a later sidebar write removes `gxserverMigratedAt`, this is confirmed.

### High: Initial import is not crash-idempotent before the completion marker is recorded

The first-run path imports projects/sessions into SQLite at `gxserver/src/legacy-macos-state-migration.ts:164-169`, rewrites shared sidebar files at `:170-179`, builds status at `:187-196`, and only then records the import marker at `:197`. If the process exits after DB rows are inserted but before `recordLegacyMacosStateImportStatus`, the next launch sees `notRun` (`:126-153`) and runs `importLegacySnapshotIntoDatabase` again. That function always allocates new P/G IDs for every legacy project/session (`:390-399`, `:401-476`) and does not check existing `legacyProjectId` metadata before inserting.

Impact: users who quit/crash during first migration can get duplicate imported projects and sessions with different canonical IDs. This is worse than a harmless retry because shared-state rewrites and future attach metadata can point to a different copy than the first partial import.

Evidence that would confirm: inject a crash/throw after `importLegacySnapshotIntoDatabase` returns and before line 197, then rerun migration against the same `state.db`; duplicate `projects` rows with the same `runtimeSettings.legacyProjectId` should appear.

### High: Project-board conversation links are imported into gxserver with legacy session IDs

The shared sidebar rewrite recursively remaps `ghostexSessionId`, `projectId`, and `sessionId` fields (`gxserver/src/legacy-macos-state-migration.ts:38-48`, `:741-807`), but the database import stores project board links directly from the legacy project without applying the same ID mapping: `projectBoardConfigJson` uses `beadConversationLinks: normalizeObjectArray(legacyProject.beadConversationLinks)` at `:450-453`.

The gxserver API returns `projectBoardConfig` from the DB (`gxserver/src/domain-state.ts:542-564`; `/api/listProjects` at `gxserver/src/server.ts:521-522`). The current link model requires `ghostexSessionId` (`shared/bead-conversation-links.ts:11-24`, `:117-120`). Any existing links that point at legacy `g-*`/old IDs will route to missing sessions once the live session rows use new `G*` IDs.

Impact: project board "Go to Session"/conversation association can silently break after upgrade even though the visible shared sidebar snapshot was rewritten correctly.

Evidence that would confirm: add a fixture with a real `ghostexSessionId: "g-..."` link, run migration, then inspect `projects.projectBoardConfigJson` for the new project. It should contain the new `G*` ID; currently the import path has no remap call.

### Medium: gxserver chooses shared JSON over WK localStorage without the Swift freshness scoring

`readLegacyStateSnapshot` always prefers shared files when present (`gxserver/src/legacy-macos-state-migration.ts:262-270`). Swift has explicit scoring to choose a richer WK localStorage snapshot over a stale shared file before migration (`native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift:157-193`, scoring at `:265-302`), but the Node migration does not apply that policy.

Impact: if `native-sidebar-projects.json` or `native-sidebar-previous-sessions.json` exists but is older/smaller than WK localStorage, a direct gxserver launch or a startup ordering path that bypasses Swift reconciliation can migrate stale data and mark the import complete. Projects/sessions present only in localStorage would be omitted.

Evidence that would confirm: create a profile where the shared projects file has one project/session and WK localStorage has two, then start gxserver directly or before `GhostexAppStorage.readSharedSidebarStorage()` runs. The migration should import the richer localStorage snapshot; current code imports the shared file.

### Medium: LocalStorage DB selection is nondeterministic and can read stale origin data

`findLocalStorageDatabases` recursively appends every `localstorage.sqlite3` under `~/Library/WebKit/com.madda.ghostex.host` (`gxserver/src/legacy-macos-state-migration.ts:305-357`). `readLegacyLocalStorageValues` takes the first database that has each key and never compares modified time, origin, or snapshot score (`:313-327`). Directory enumeration order is not a stable freshness signal.

Impact: on machines with multiple WK storage databases, migration can import agents/settings/project commands/git prefs from an older origin/profile. This is especially relevant for data that only comes from localStorage (`agentOrder`, `agents`, `projectCommands`, git prefs) even when project JSON comes from shared files.

Evidence that would confirm: inspect real user WebKit directories for multiple `localstorage.sqlite3` files containing Ghostex keys with divergent values, or add a test with two DBs returned in stale-first order.

### Medium: Previous-session history stored in gxserver keeps legacy nested IDs

The import groups previous sessions and stores the normalized items directly in `previousSessionHistoryJson` (`gxserver/src/legacy-macos-state-migration.ts:407-410`, `:449`, `:914-935`). Unlike the shared previous-sessions rewrite (`:721-727`, `:754-765`), the DB history is not run through `remapLegacySidebarIds`. That leaves top-level `projectId`, nested `sessionRecord.sessionId`, and any restore metadata in legacy shape unless intentionally hidden under `hiddenRestoreMetadata`.

Impact: if gxserver-backed clients use `previousSessionHistory` from `/api/listProjects`, restore/jump UI can point at legacy project/session IDs or require client-specific repair logic. If the design is to preserve legacy IDs only inside `hiddenRestoreMetadata`, the current DB payload is broader than that.

Evidence that would confirm: define the gxserver previous-session contract for restored history. If clients expect canonical project/session IDs outside `hiddenRestoreMetadata`, add a fixture assertion against `previousSessionHistoryJson`.

### Low: Empty previous-sessions shared files are not canonicalized during migration

`rewriteSharedSidebarStateWithGxserverIds` only writes `native-sidebar-previous-sessions.json` when `snapshot.previousSessions.length > 0` (`gxserver/src/legacy-macos-state-migration.ts:721-727`). If an existing stale file contains `[]`, it remains without any migration marker or canonical signal. Swift treats empty previous-session snapshots as not gxserver-migrated because `isGxserverMigratedPreviousSessionsSnapshot` requires a non-empty array (`native/macos/ghostexHost/Sources/Shared/GhostexAppStorage.swift:225-238`), so a stale WK localStorage value with any positive score can later replace it (`:177-190`).

Impact: lower than projects because empty history has no direct session data, but it can cause old previous-session history from WK localStorage to reappear after a migration that intended shared state to be canonical.

Evidence that would confirm: migrate with shared previous sessions `[]` and WK localStorage containing one old item, then relaunch and observe whether Swift selects the old localStorage value.

## Test Coverage Gaps

The migration tests cover first-run import, completed repair, a pre-release stale session repair, oversized JSON bounding, and empty-state idempotency (`gxserver/test/legacy-macos-state-migration.test.ts:16-276`). They do not cover the native startup ordering where React initializes before gxserver migration completes, crash/retry between DB import and marker write, DB `projectBoardConfigJson` ID remapping, shared-vs-localStorage freshness selection, or multiple WK localStorage databases.
