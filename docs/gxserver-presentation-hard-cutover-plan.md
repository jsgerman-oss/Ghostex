# gxserver Presentation Hard Cutover Plan

## Purpose

This document is the implementation handoff for moving shared session/sidebar presentation ownership into `gxserver`.

The immediate problem is not only one thing. We agreed to solve all three together:

- High Ghostex WebContent / renderer memory usage.
- Slow macOS sidebar behavior.
- Very noisy debug logs that can grow to hundreds of MB or GB and amplify both RAM and lag.

The durable fix is a hard cutover where `gxserver` becomes the shared source of truth for session presentation, sidebar grouping/order, session title/status, session surfaces, and live deltas. Clients should become dumb receivers of this shared presentation state, while keeping only platform-local UI preferences and native layout details.

This is intentionally a full migration plan, not a narrow macOS workaround.

## Current Findings

These are the important observations from the live app investigation:

- `gxserver` itself was not the main RAM consumer. The running gxserver process was roughly `100 MB` RSS.
- Large memory was in renderer processes:
  - Ghostex CEF renderer around `660 MB`, likely embedded editor/code-server.
  - Several WebKit WebContent processes around `500-680 MB`, one of which is the sidebar.
- The sidebar refresh debug log showed high churn:
  - Many `sidebar.refresh.messageReceived`
  - Many `sidebar.refresh.messageApplied`
  - Many `sidebar.refresh.renderStateChanged`
  - Many `sidebar.refresh.appMounted` / `sidebar.refresh.appUnmounted`
- The `appMounted` / `appUnmounted` names are misleading in at least one path. They are emitted from a React effect in `sidebar/sidebar-app.tsx`; the effect dependencies include callback values, so it can clean up and rerun during normal renders. This should not be interpreted as proof that the whole React root is being destroyed, but it is still noisy and expensive.
- Current logs were very large:
  - `~/.ghostex/logs/native-terminal-focus-debug.log`: about `1.3 GB`
  - `~/.ghostex/logs/sidebar-refresh-debug.log`: about `283 MB`
  - `~/.ghostex/logs`: about `2.0 GB` total
- Current persisted state was also large/noisy:
  - gxserver DB had about `235` session rows.
  - Active project `P3lv0` had about `214` gxserver sessions.
  - Native shared sidebar state had about `120` projects and `74` sessions.
  - Active native project had about `60` sessions.
- There were visible command-pane/stale/misclassified sessions that should not be in the macOS sidebar, even though other clients may still expose them with a `surface: "commands"` marker.

## Agreed Decisions

These decisions came from the planning discussion and should be treated as requirements.

### Scope

- Solve RAM, sidebar lag, and log noise together.
- Do a full migration now, not only stop-the-bleeding.
- Produce a hard cutover, not a dual-path compatibility mode.
- If gxserver is unavailable, clients should show an unavailable state only. They must not reconstruct the old local session sidebar.

### Ownership

`gxserver` owns shared state and shared presentation:

- Projects.
- Sessions.
- Groups.
- Shared group/session order.
- Titles.
- Title source/provenance.
- Session lifecycle.
- Activity/status/attention.
- Agent identity.
- Session surface, including command-pane sessions.
- Pinned/favorite flags.
- Shared visible presentation metadata.

Clients own only UI-local state:

- Collapse/expand state.
- Scroll position.
- Search text.
- Selected modal tab.
- Hover/menu/open-popover state.
- Platform-specific pane split geometry.
- Other purely local view preferences.

### Presentation Model

`gxserver` should send a shared presentation model, not raw DB rows only and not a full UI tree.

The model should include:

- Stable project id.
- Stable session id.
- Session kind.
- Surface, especially `workspace` vs `commands`.
- Lifecycle state.
- Visible title.
- Title source/provenance.
- Optional subtitle/detail.
- Agent id/name/icon key if known.
- Activity/status.
- Attention state.
- Pinned/favorite.
- Sort keys.
- Visibility flags, such as whether the session is visible in the workspace sidebar by default.
- Enough metadata for clients to render consistent rows and tooltips.

The model should not include:

- Client-specific collapse state.
- Scroll position.
- Hover state.
- Per-platform modal state.
- Native macOS split geometry.

### Sidebar Feed Shape

Use an active-focused main presentation feed:

- Include running/sleeping workspace sessions.
- Include command-pane sessions with `surface: "commands"` and `visibleInSidebarByDefault: false`.
- Include pinned/favorite recent stopped sessions if needed.
- Do not include all history/previous sessions in the live sidebar feed.
- Historical and previous sessions must be served through separate APIs.

For macOS:

- Command-pane sessions must still be in gxserver presentation data with a surface flag.
- macOS should route command-pane sessions to the command panel, not the main sidebar.
- TUI/CLI/mobile clients may choose to show command-pane sessions, but they should be marked as command-pane sessions.

### Search

Sidebar search should still work after the active-focused feed change.

New behavior:

- Local active-session results should appear immediately from the currently hydrated presentation snapshot.
- Previous/history results should be queried from gxserver while typing.
- Use debounced live search for previous/history results.
- Debounce target: roughly `150-250ms` for typed search.
- Search should be metadata-only for this pass.

Search metadata should include:

- Title.
- Terminal title / projected title if applicable.
- Agent.
- Project.
- CWD.
- Command.
- Session ids.
- Timestamps.

Search should not include transcript/content search in this pass.

Implementation should start with direct SQLite queries in gxserver. Do not build a dedicated FTS table yet unless metadata search proves too slow later.

The Previous Sessions modal should use the same gxserver search/list APIs:

- On open: request recent previous sessions.
- While typing: query gxserver with debounce.
- Do not hydrate all previous sessions into React on startup.

### Transport

Use gxserver WebSocket event streaming.

Expected shape:

- Client gets an initial presentation snapshot with a revision.
- Client receives pushed deltas after that.
- Client reconnects with last known revision if possible.
- If gxserver cannot guarantee no gap, client replaces local state with a fresh snapshot.

Do not use polling as the primary model.

Do not keep sending full snapshots for routine changes.

### Deltas

Use initial snapshot plus small deltas.

Examples:

- `projectAdded`
- `projectUpdated`
- `projectRemoved`
- `groupAdded`
- `groupUpdated`
- `groupRemoved`
- `groupOrderChanged`
- `sessionAdded`
- `sessionUpdated`
- `sessionRemoved`
- `sessionMoved`
- `sessionTitleChanged`
- `sessionActivityChanged`
- `sessionLifecycleChanged`
- `sessionSurfaceChanged`
- `sessionPresentationChanged`

The exact event taxonomy can be refined during implementation, but the key requirement is that routine title/status changes must not ship the whole sidebar graph.

### Coalescing and Persistence

Prevent noisy title/status updates from spamming clients.

Required behavior:

- Coalesce presentation broadcasts per session before sending to clients.
- Skip broadcast if the projected presentation did not change.
- Use a modest upper bound for broadcast frequency, e.g. max every `250ms` per session.
- Persist only meaningful projected changes.
- Do not persist every raw spinner/title update.
- Raw title/status churn can be observed in memory to derive status, but DB writes should happen only when the visible projected title/status/activity changes.

This is important for terminal titles that include spinners or other rapidly changing indicators.

### Reconnects

Use snapshot plus revision.

Required behavior:

- Every presentation snapshot has a revision.
- Every delta has a revision.
- Client applies deltas only in order.
- If a client reconnects and the gap cannot be proven safe, the client requests/replaces with a fresh snapshot.
- Do not implement a durable replay event log in this pass.

### macOS Native Pane Integration

For this migration:

- gxserver presentation deltas update the macOS sidebar list.
- gxserver presentation deltas also update native pane chrome titles/status labels.
- gxserver deltas must not create or remove native macOS panes on their own.
- macOS pane creation/removal remains driven by explicit user actions and terminal host events.
- macOS native split/tab geometry remains platform-local and is not owned by gxserver in this pass.

### Local macOS Persistence

After hard cutover:

- Stop writing shared session/project trees from macOS.
- gxserver DB owns projects, sessions, groups, order, titles, statuses, and shared presentation state.
- macOS local persistence should keep only UI preferences and platform-local state.
- Do not keep writing backup snapshots automatically.
- Optional export/debug tooling can be added later, but it must not become an automatic second source of truth.

### Fallback

If gxserver is unavailable:

- Show a gxserver unavailable state.
- Disable actions that require gxserver.
- Do not reconstruct the old local sidebar from macOS state.
- Do not silently fall back to legacy local project/session snapshots.

### Logging

Add a structured low-volume gxserver presentation logging category.

Requirements:

- Use a new label/category such as `session-presentation` or `presentation`.
- Log counts, revision, event type, coalescing stats, and client id.
- Do not include full session arrays by default.
- Do not include full payloads by default.
- Add a special verbose flag only if needed, and keep it off by default.

Existing macOS/sidebar logs:

- Keep them, but cap and rotate them.
- Enforce size limits in the writer.
- Drop/compact noisy repeated events.
- Do not allow debug logs to grow to GBs.
- Implement as shared logging policy plus macOS enforcement now, so other clients can adopt the same limits later.

## Non-Goals

Do not do these in this pass:

- Do not move macOS native split geometry into gxserver.
- Do not implement transcript/content search.
- Do not build SQLite FTS immediately.
- Do not implement a durable delta replay log.
- Do not let gxserver deltas create/remove native panes automatically.
- Do not keep a macOS local fallback that reconstructs sessions/sidebar state.
- Do not keep full sidebar history hydrated in React.
- Do not persist every raw terminal title/spinner update.

## Proposed Architecture

### gxserver Modules

Keep the implementation modular. Avoid one huge file.

Suggested folders/files:

```text
gxserver/src/session-presentation/
  index.ts
  types.ts
  projector.ts
  repository.ts
  service.ts
  events.ts
  coalescer.ts
  search.ts
  logging.ts
  visibility.ts
  ordering.ts
```

If `gxserver/src/session-presentation/` already exists, extend it rather than creating a duplicate concept.

Suggested responsibilities:

- `types.ts`: presentation snapshot, project/group/session row, deltas, query params.
- `projector.ts`: convert domain state into presentation rows/groups.
- `visibility.ts`: active-focused feed rules, surface rules, client capability filtering.
- `ordering.ts`: shared group/session ordering.
- `repository.ts`: DB reads/writes needed by presentation service.
- `service.ts`: public orchestration API for snapshots and mutations.
- `events.ts`: WebSocket event envelope and revision handling.
- `coalescer.ts`: per-session delta coalescing and unchanged-projection skipping.
- `search.ts`: metadata-only previous/history search.
- `logging.ts`: low-volume structured presentation logs.

### Protocol Types

Add shared protocol types for:

- `GxserverPresentationSnapshot`
- `GxserverPresentationRevision`
- `GxserverPresentationProject`
- `GxserverPresentationGroup`
- `GxserverPresentationSession`
- `GxserverPresentationDelta`
- `GxserverPresentationSearchParams`
- `GxserverPresentationSearchResult`

These should live in the shared/gxserver protocol layer currently used by all clients.

The presentation session should include fields similar to:

```ts
type GxserverPresentationSession = {
  projectId: string;
  groupId: string;
  sessionId: string;
  kind: "terminal" | "agent" | "browser" | "t3" | string;
  surface: "workspace" | "commands";
  lifecycleState: "running" | "sleeping" | "stopped" | "missing" | "unknown";
  visibleInSidebarByDefault: boolean;
  title: string;
  titleSource: string;
  subtitle?: string;
  tooltip?: string;
  agentId?: string;
  agentName?: string;
  agentIcon?: string;
  activity: "idle" | "working" | "attention";
  attention?: {
    acknowledged: boolean;
    enteredAt?: string;
  };
  isPinned: boolean;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
  sortKey: string;
};
```

This is illustrative, not final. The implementation agent should align names with existing protocol conventions.

### WebSocket Events

Use an authenticated gxserver WebSocket endpoint.

Suggested flow:

1. Client connects with auth and protocol version.
2. Client sends subscription request:

```json
{
  "type": "subscribePresentation",
  "clientId": "macos-main-sidebar",
  "lastRevision": 123
}
```

3. Server responds with either:

```json
{
  "type": "presentationSnapshot",
  "revision": 130,
  "snapshot": {}
}
```

or, if safe:

```json
{
  "type": "presentationDeltas",
  "fromRevision": 124,
  "toRevision": 130,
  "deltas": []
}
```

For this pass, it is acceptable to always send a snapshot on reconnect if replay is not implemented.

4. Server pushes deltas:

```json
{
  "type": "presentationDelta",
  "revision": 131,
  "delta": {
    "type": "sessionPresentationChanged",
    "projectId": "P3lv0",
    "sessionId": "G28cn",
    "session": {}
  }
}
```

### HTTP APIs

Keep simple HTTP APIs for:

- Initial snapshot fallback/explicit fetch.
- Metadata search.
- Recent previous sessions.

Suggested endpoints:

- `GET/POST /api/readPresentationSnapshot`
- `POST /api/searchSessions`
- `POST /api/listPreviousSessions`

The final method/path should match existing gxserver API conventions.

### Search API

Search params should include:

```ts
type GxserverSessionSearchParams = {
  query: string;
  projectId?: string;
  includeActive?: boolean;
  includePrevious?: boolean;
  limit?: number;
  cursor?: string;
};
```

Search result should be compact:

```ts
type GxserverSessionSearchResult = {
  projectId: string;
  projectTitle: string;
  sessionId: string;
  title: string;
  subtitle?: string;
  agentId?: string;
  surface: "workspace" | "commands";
  lifecycleState: string;
  lastActiveAt?: string;
  match?: {
    field: "title" | "project" | "cwd" | "command" | "agent" | "id";
    snippet?: string;
  };
};
```

Metadata-only search fields:

- title
- projected/terminal title
- agent
- project title/path
- cwd
- command
- session id
- timestamps for sorting

## Phases

### Phase 0: Manual Cleanup Before Migration

Do this before testing the new presentation feed so old bad rows do not pollute validation.

Rules:

- Remove/fix current obvious bad rows manually.
- Do not add automatic migration/repair code for this one-off cleanup.
- Safe cleanup target:
  - stopped/missing command-pane duplicates
  - placeholder `Terminal Session` rows with no useful metadata
  - old misclassified command-pane rows
- Keep titled agent sessions/history.
- Keep useful historical sessions.
- Be conservative where there is real user value.

Suggested process:

1. Back up the DB:

```sh
cp ~/.ghostex/gxserver/state.db ~/.ghostex/gxserver/state.db.before-presentation-cleanup
```

2. Inspect command/stale rows:

```sh
sqlite3 ~/.ghostex/gxserver/state.db '
select
  projectId,
  sessionId,
  kind,
  title,
  lifecycleState,
  agentId,
  commandId,
  json_extract(launchSettingsJson, "$.surface") as surface,
  updatedAt
from sessions
order by updatedAt desc;
'
```

3. Identify clearly stale generated noise only.
4. Apply targeted deletes/updates manually.
5. Keep a short note of what was removed/fixed.

Do not run broad deletes without reviewing rows first.

### Phase 1: Define Presentation Protocol

Tasks:

- Add protocol types for snapshots, groups, rows, deltas, search params, and search results.
- Add client identity/capability fields if needed.
- Add revision fields.
- Add surface semantics:
  - `workspace`
  - `commands`
- Add visibility flag:
  - `visibleInSidebarByDefault`
- Add title/status/attention fields.

Acceptance criteria:

- TypeScript builds.
- Tests can construct sample snapshots and deltas.
- Command-pane sessions can be represented without being confused with workspace sidebar sessions.

### Phase 2: Build gxserver Presentation Projector

Tasks:

- Implement projection from gxserver domain sessions/projects into presentation groups.
- Implement active-focused feed rules.
- Implement command-pane surface handling.
- Implement shared sorting/order.
- Implement title/status projection.
- Ensure source of truth for titles prefers structured agent metadata and settled zmx/terminal title events.
- Do not use footer parsing for this plan.

Important title rules:

- Structured agent metadata is the first source of truth when available.
- Settled zmx terminal title events are valid source for terminal title projection.
- UI rename commands for an agent-associated session should not blindly persist as the real title unless the authoritative terminal/agent metadata confirms the change.
- The visible title should reflect the real projected title, not an optimistic client-only rename.

Acceptance criteria:

- Same domain state projects to deterministic presentation groups.
- Command-pane sessions are marked as commands and hidden from macOS main sidebar by default.
- Stopped/missing historical rows do not flood the active feed.
- Unit tests cover workspace sessions, command sessions, sleeping/running sessions, pinned/favorite stopped sessions, and agent title projection.

### Phase 3: Add Revisions and Snapshot API

Tasks:

- Add a monotonically increasing presentation revision.
- Add snapshot API.
- Include revision in every snapshot.
- Ensure snapshot can be regenerated after restart from DB state.
- Avoid including previous/history session bulk in snapshot.

Acceptance criteria:

- `readPresentationSnapshot` returns active-focused presentation only.
- Snapshot size is bounded relative to active sessions, not total history.
- Snapshot excludes all previous sessions except allowed pinned/favorite recent stopped sessions.

### Phase 4: Add Delta Event Stream

Tasks:

- Add WebSocket subscription for presentation.
- Push deltas for session/project/group changes.
- Add reconnect behavior.
- If revision gap cannot be guaranteed, send a fresh snapshot.
- Do not implement durable event replay in this pass.

Acceptance criteria:

- macOS can connect and receive initial snapshot.
- macOS receives deltas after title/status/lifecycle changes.
- Reconnect replaces local state with a fresh snapshot if needed.
- No routine full snapshot is sent for title/status changes.

### Phase 5: Coalescing Layer

Tasks:

- Add per-session coalescing before broadcast.
- Skip events if projected presentation is unchanged.
- Use a max broadcast cadence around `250ms` per session.
- Make coalescing apply to title/status/activity/lifecycle presentation changes.
- Record low-volume stats for coalescing.

Persistence rules:

- Persist projected changes only.
- Do not persist every raw title/spinner update.
- Raw latest title/status may be held in memory as needed.

Acceptance criteria:

- Spinner-like terminal title churn does not cause event spam.
- SQLite write count does not grow with every raw spinner update.
- Logs show coalesced counts, not full payloads.

### Phase 6: Search and Previous Sessions APIs

Tasks:

- Implement metadata-only gxserver search over DB state.
- Implement recent previous sessions API.
- Add limit/cursor.
- Add project filter.
- Include enough compact result fields for sidebar global search and Previous Sessions modal.

Client behavior:

- Sidebar local active results are instant.
- Previous/history results query gxserver with debounce.
- Previous Sessions modal fetches on open and on debounced search.
- Do not hydrate all previous sessions into React at startup.

Acceptance criteria:

- Searching active sessions works immediately.
- Searching previous sessions returns results from gxserver.
- Memory does not grow with total previous-session count.
- Search payloads are compact.

### Phase 7: macOS Hard Cutover

Tasks:

- Replace macOS sidebar's locally built shared session/project tree with gxserver presentation snapshot/deltas.
- Stop writing shared session/project trees from macOS.
- Keep only local UI prefs in macOS storage.
- Remove or disable old local reconstruction paths.
- Remove old fallback path that rebuilds sidebar from local state when gxserver is unavailable.
- Add gxserver unavailable UI state.

macOS should still own:

- Native pane split geometry.
- Local collapse state.
- Scroll position.
- Menus/modals/hover state.
- Explicit pane creation/removal actions.

macOS should not own:

- Shared sidebar grouping/order.
- Shared session titles.
- Shared session activity/status.
- Command-pane classification.
- Previous sessions preload.

Acceptance criteria:

- With gxserver running, sidebar renders from gxserver presentation.
- With gxserver unavailable, sidebar shows unavailable state and does not reconstruct old local sessions.
- Local shared project/session JSON is no longer written automatically.
- Commands surface sessions do not appear in macOS main sidebar.
- Command-pane sessions remain available to route into the command panel.

### Phase 8: Native Pane Chrome Updates

Tasks:

- Apply gxserver presentation deltas to native pane title/status chrome.
- Update titles/status labels for panes that already exist.
- Do not create/remove native panes from presentation deltas.
- Keep explicit actions as the only path for pane creation/removal.

Acceptance criteria:

- Renames/title changes from gxserver projection update native pane chrome.
- Activity/attention/status changes update native pane chrome.
- No backend delta unexpectedly opens or closes a pane.

### Phase 9: Log Policy and Rotation

Tasks:

- Define shared logging category/limit policy.
- Add/extend macOS log writer to enforce caps and rotation.
- Apply caps to:
  - `sidebar-refresh-debug.log`
  - `native-terminal-focus-debug.log`
  - other high-volume native logs
- Drop or compact repeated noisy events.
- Remove large arrays/full payloads from routine logs.
- Add gxserver `session-presentation` low-volume logs.

Suggested defaults:

- Per-file cap: choose a practical cap such as `10-25 MB`.
- Rotated files: keep a small number, such as `3-5`.
- Never log full presentation snapshots by default.
- Never log full session id arrays on routine render/message events.

Acceptance criteria:

- Logs cannot grow to hundreds of MB/GB in normal debug mode.
- Presentation logs show counts and revisions.
- Debugging a noisy feed is still possible from coalescing/event counts.

### Phase 10: Remove Old Paths and Tests

Tasks:

- Remove old macOS local shared session tree writing.
- Remove old full hydrate-on-every-change behavior where possible.
- Remove local previous-session preloading into sidebar store.
- Update tests.
- Add regression tests for command-pane visibility and search.

Test coverage:

- gxserver presentation projector tests.
- gxserver delta/coalescing tests.
- gxserver search tests.
- macOS sidebar client state reducer tests if available.
- command-pane session routing tests.
- unavailable gxserver UI behavior tests.
- log rotation tests.

Acceptance criteria:

- No dual source of truth remains for shared sidebar/session semantics.
- Old local fallback cannot silently activate.
- All tests pass.

## Client Responsibilities After Cutover

### macOS

- Connect to gxserver presentation WebSocket.
- Request/receive snapshot.
- Apply deltas.
- Render main sidebar from presentation groups.
- Route `surface: "commands"` sessions to command panel behavior, not main sidebar.
- Update existing native pane title/status chrome from presentation deltas.
- Query gxserver for previous/history search.
- Show unavailable state when gxserver is down.
- Keep only UI-local preferences.

### TUI/CLI

- May show command-pane sessions in lists.
- Must mark command-pane sessions as `surface: "commands"`.
- Should use the same presentation/search APIs.
- Should not invent separate title/status rules.

### Android/iOS/Windows/Linux

- Should consume the same presentation snapshot/delta model.
- Should treat command-pane sessions according to client UX but must preserve `surface` semantics.
- Should query gxserver for previous/history search instead of hydrating all history.

## Risks and Mitigations

### Risk: Hard cutover breaks macOS startup

Mitigation:

- Add explicit gxserver unavailable state.
- Keep implementation behind a short-lived dev flag only if absolutely necessary during development, but final behavior must not fall back to old local reconstruction.

### Risk: Presentation model under-specifies a client need

Mitigation:

- Add fields to presentation model rather than letting a client rederive shared semantics.
- Keep UI-local fields local.

### Risk: Delta ordering bugs

Mitigation:

- Use monotonically increasing revisions.
- Replace with snapshot on gap/unknown state.
- Keep reducers idempotent where possible.

### Risk: Log cap hides useful debug details

Mitigation:

- Log counts/revisions/event types by default.
- Add temporary verbose flags for focused debugging.
- Keep verbose flags off by default and still subject to caps.

### Risk: Search is too slow without FTS

Mitigation:

- Start with indexed SQLite metadata queries.
- Add FTS later only if needed.
- Keep live typeahead debounced.

### Risk: Command-pane sessions vanish for non-macOS clients

Mitigation:

- Do not filter them out globally.
- Include them with `surface: "commands"` and `visibleInSidebarByDefault: false`.
- Let each client decide placement while preserving semantics.

## Implementation Checklist

- [ ] Back up gxserver DB.
- [ ] Manually clean obvious stale generated noise.
- [ ] Add protocol types.
- [ ] Implement presentation projector.
- [ ] Add snapshot API with revision.
- [ ] Add WebSocket subscription.
- [ ] Add delta generation.
- [ ] Add coalescing and unchanged-projection skip.
- [ ] Add metadata-only search API.
- [ ] Add previous sessions API.
- [ ] Cut macOS sidebar over to gxserver presentation.
- [ ] Stop macOS shared project/session tree writes.
- [ ] Add gxserver unavailable UI state.
- [ ] Apply presentation deltas to existing native pane chrome titles/status.
- [ ] Add shared log policy and macOS rotation/caps.
- [ ] Remove old local reconstruction/fallback paths.
- [ ] Add/adjust tests.
- [ ] Verify memory/log behavior.

## Verification Plan

### Manual Verification

1. Start Ghostex with gxserver.
2. Confirm sidebar renders from gxserver presentation.
3. Confirm current workspace sessions appear correctly.
4. Confirm command-pane sessions do not appear in macOS main sidebar.
5. Confirm command-pane sessions are still represented with `surface: "commands"`.
6. Rename an agent session.
7. Confirm title changes only when authoritative projected title changes.
8. Trigger terminal title/status churn.
9. Confirm event/log volume stays bounded.
10. Search sidebar for active session title.
11. Search sidebar for previous session title.
12. Open Previous Sessions modal.
13. Confirm previous sessions are loaded via gxserver query, not startup hydrate.
14. Stop gxserver.
15. Confirm macOS shows unavailable state and does not reconstruct old local state.
16. Restart gxserver.
17. Confirm reconnect uses snapshot/revision and recovers cleanly.

### Memory Verification

Capture before/after:

```sh
ps -axo pid,ppid,rss,vsz,%mem,etime,command | rg -i 'Ghostex|ghostex|WebContent|gxserver|zmx'
du -sh ~/.ghostex/logs ~/.ghostex/gxserver/logs
```

Expected:

- gxserver remains modest.
- Sidebar WebContent does not grow with total previous-session history.
- Logs remain under configured caps.
- Routine title/status activity does not cause large memory jumps.

### Event Volume Verification

Add low-volume presentation logs with:

- client count
- snapshot count
- delta count
- coalesced event count
- skipped unchanged projection count
- revision
- event type counts

Expected:

- Spinner/title churn coalesces.
- Repeated unchanged projections are skipped.
- No full payload logging by default.

## Final Desired End State

After this migration:

- gxserver is the shared source of truth for session/sidebar presentation across macOS, TUI/CLI, Android, iOS, Windows, and Linux.
- macOS no longer builds or persists shared session/sidebar state locally.
- Clients render presentation state and keep only UI-local preferences.
- Main sidebar feed is small and active-focused.
- Previous sessions are queried on demand.
- Command-pane sessions are represented consistently with `surface: "commands"`.
- Title/status updates are coalesced and projected before persistence/broadcast.
- Logs are capped/rotated and low-volume by default.
- If gxserver is unavailable, clients show an unavailable state instead of silently reviving old local state.
