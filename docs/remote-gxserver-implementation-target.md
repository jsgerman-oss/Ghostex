# Remote gxserver implementation target

<!--
CDXC:RemoteGxserver 2026-06-02-23:53:
Remote gxserver work is starting from an explicit implementation target so settings, sidebar, SSH setup, remote project picking, and server APIs move toward one agreed product shape instead of ad hoc partial remotes.

CDXC:RemoteGxserver 2026-06-02-23:38:
The native host now owns the first remote gxserver boundary: SSH connection attempts, remote gxserver start attempts, token reads, Keychain token writes, SSH tunnel process state, and authenticated gxserver request forwarding. React still needs the install-approval modal, packaged gxserver upload/install path, startup auto-connect, and merged remote presentation before the product flow is complete.

CDXC:RemoteGxserver 2026-06-02-23:46:
The approved-install flow is now wired: missing gxserver opens a React approval modal, approval retries connect with an install flag, native archives and uploads the bundled gxserver package over SSH, installs it under the remote user's ~/.ghostex folder, starts gxserver, reads the token, and opens the tunnel. Startup auto-connect and connected-header Add Project/Clone controls now exist, while remote clone routing and merged presentation remain unfinished.

CDXC:RemoteGxserver 2026-06-02-23:53:
Connected remotes now fetch machine-scoped presentation snapshots through the native tunnel and render those projects/sessions under the owning machine section with prefixed ids. Remote Clone Repository now opens the shared clone modal and routes preview/start/poll/cancel through that machine's gxserver; the remaining clone UX gap is replacing the typed destination field with the copied T3 remote directory picker.

CDXC:RemoteGxserver 2026-06-02-23:57:
Remote Clone Repository now uses the copied T3-style remote directory picker for choosing the clone destination folder. The picker browses via the selected machine's gxserver tunnel and writes the selected path back into the shared clone modal before preview/start run through the same remote gxserver.

CDXC:RemoteGxserver 2026-06-03-00:01:
Connected remotes now subscribe to `/api/events` through the native SSH tunnel after the initial presentation snapshot. Swift keeps the auth token native-only and forwards sanitized snapshot/delta events so the machine section streams project/session changes without polling.

CDXC:RemoteGxserver 2026-06-03-00:01:
Remote sidebar rows now route supported project/session actions through the owning machine's gxserver. Create Session, session sleep/wake/close, pin/favorite/rename, group sleep/wake, and project removal are machine-scoped; local-only surface actions are blocked instead of falling through to the active local project.

CDXC:RemoteGxserver 2026-06-03-00:01:
Previous Sessions search now includes connected Remote machines by querying each machine's gxserver through the native tunnel. Remote history rows carry a machine-prefixed history id so delete and restore mutate the owning gxserver instead of the local Mac.

CDXC:RemoteGxserver 2026-06-03-00:26:
Remote session sleep, wake, close, and reload now use gxserver lifecycle endpoints on the owning machine. Reload is represented as a remote provider kill followed by wake, with presentation reconciliation coming back through the remote gxserver stream.

CDXC:RemoteGxserver 2026-06-03-00:26:
Remote project Git diff refresh now calls the owning machine's `/api/runGitAction` for bounded status/diff operations and stores the result under the scoped remote project id. This gives remote project headers real Git stats without opening local Git panels or touching local repositories.

CDXC:RemoteGxserver 2026-06-08-19:53:
Remote session card clicks now open a local Ghostty terminal that runs the same attach contract as Android/iOS: `ssh -tt` to the saved machine, remote login shell, and `ghostex attach --session-id --project-id`. The local Ghostty carrier is hidden from Quick/local sidebar presentation so the visible session remains under its owning remote machine. Explicit Copy Attach Command actions copy the same stable-id SSH command for external terminals.

CDXC:RemoteGxserver 2026-06-03-00:24:
Remote session cards can now copy SSH-wrapped resume commands by asking the owning gxserver for `/api/readAgentResumePlan`, then executing the returned copy command in the remote project directory over the saved SSH connection. Resume syntax stays server-owned and bearer tokens remain native-only.

CDXC:RemoteGxserver 2026-06-03-00:24:
Remote Git direct actions now read temporary machine-scoped Git state from the owning gxserver and support clean-tree Push plus View PR for an already-open pull request. This was the first remote Git action slice; later entries add commit review, create-PR, release, sync-main, and agent workflows.

CDXC:RemoteGxserver 2026-06-03-00:29:
Remote presentation rows now preserve gxserver worktree metadata and the New Worktree modal can list/open existing remote worktrees through the owning machine's typed worktree and add-project endpoints. Later entries add fresh remote worktree creation with an agent prompt.

CDXC:RemoteGxserver 2026-06-03-00:33:
Remote Project Board can now open the local WK Project surface for a remote project and route Beads CRUD/list/mutation requests through the owning machine's gxserver tunnel. Later entries add remote board conversation links, Start Work, generated titles, and remote agent sessions.

CDXC:RemoteGxserver 2026-06-03-00:45:
Remote Project Board now reads live conversation links from the remote project's gxserver-owned `projectBoardConfig`, lists currently visible remote sessions for linked beads, persists unlink/archive through the remote `/api/updateProject`, and maps Go to Session to copying the SSH attach command for the linked remote zmx session. Later entries add generated titles and new remote agent work.

CDXC:RemoteGxserver 2026-06-03-00:51:
Remote worktree deletion now reuses the local delete confirmation modal but performs status inspection, `git worktree remove`, project-row removal, and worktree prune through the owning machine's gxserver. Dirty remote worktrees still cannot use the modal's Commit button until remote Git commit/review is scoped.

CDXC:RemoteGxserver 2026-06-03-00:55:
Remote Project Board generated titles now use the same local prompt-agent title generation bridge as local boards, but skip local filesystem validation for the remote project path. Beads mutations still execute on the remote gxserver; title generation is text-only and does not touch the remote repository.

CDXC:RemoteGxserver 2026-06-03-01:04:
Remote Git commit/push/PR review now reuses the Git review modal with machine-scoped pending requests. File diffs, staging, blank-message generation, commit, push, and `gh pr create --fill` route through the owning machine's gxserver. Later entries add Multiple Commits, direct merge, release, sync-main, and delete-after-commit support.

CDXC:RemoteGxserver 2026-06-03-01:18:
Remote session click/focus/focus-mode actions now use the supported remote equivalent: copying an SSH-wrapped `zmx attach` command for the owning machine. gxserver still cannot focus visible macOS panes remotely because it has no renderer event channel.

CDXC:RemoteGxserver 2026-06-03-01:21:
Dirty remote worktree deletion can now use the shared modal's Commit button. The commit review is machine-scoped, and the modal's delete-after option removes the remote worktree through the owning gxserver after the selected Git action succeeds.

CDXC:RemoteGxserver 2026-06-03-01:31:
Remote Sleep Inactive now mirrors the local project rule through gxserver: idle running terminal/agent sessions in the owning machine's presentation are slept, while working and attention sessions remain awake.

CDXC:RemoteGxserver 2026-06-03-01:34:
Remote project rename now updates the machine-scoped presentation optimistically and persists the canonical project name through that machine's `/api/updateProject` endpoint.

CDXC:RemoteGxserver 2026-06-03-01:38:
Remote attach-copy now asks the owning gxserver for `/api/attachSessionMetadata` and wraps that server-owned attach script in SSH, so copied commands use the remote cwd, bundled zmx path, provider checks, and gxserver identity instead of a bare `zmx attach`.

CDXC:RemoteGxserver 2026-06-03-02:18:
Remote Project Board current-project Start Work now creates the agent session on the owning gxserver, starts a missing zmx provider through `/api/startSessionProvider`, sends the bead prompt through the remote message endpoint, and persists the bead conversation link in the remote project's gxserver-owned board config. Later entries add new-worktree Start Work through fresh remote worktree creation.

CDXC:RemoteGxserver 2026-06-03-02:50:
Fresh remote worktree creation is now routed through the owning machine's gxserver typed operations: remote Git repo/ref checks, target path availability, `git worktree add`, remote project registration, remote agent session creation, zmx provider start, and prompt delivery. Remote Project Board new-worktree Start Work now uses that path and stores project-qualified conversation links for sibling worktree sessions.

CDXC:RemoteGxserver 2026-06-03-03:04:
Remote Git agent workflows now launch visible agent sessions on the owning gxserver for Multiple Commits, Multicommit & Release, Release, and Sync with Main. The existing workflow prompts are delivered through the remote zmx message endpoint, so the agent runs inside the remote repository instead of a local Mac checkout.

CDXC:RemoteGxserver 2026-06-03-03:18:
Remote direct merge now uses gxserver typed Git actions on the remote worktree and parent project: commit selected worktree changes if needed, verify and checkout parent `main`, merge the worktree branch, and launch a remote merge-conflict agent in the parent project if the merge fails. Delete-after-merge removes the remote worktree through the existing remote worktree delete path.

CDXC:RemoteGxserver 2026-06-03-03:34:
Remote group focus now uses the same remote-safe attach equivalent as remote session focus. Clicking a remote project/group copies an SSH-wrapped gxserver attach command for the best available session in that remote project, preferring running, attention/working, pinned/favorite, and recently active sessions.

CDXC:RemoteGxserver 2026-06-03-03:42:
Remote Finder/Open-in-IDE actions now use an SSH-only open-folder equivalent: copy a saved-machine SSH command that opens a remote shell already cd'd into the gxserver project path. Local Finder and IDEs still cannot directly dereference remote filesystem paths without a tool-specific remote integration.

CDXC:RemoteGxserver 2026-06-03-04:08:
Remote post-create worktree setup now runs through gxserver's narrow `/api/runProjectSetupCommand` endpoint. The client identifies the remote checkout project and the registered source project whose `gitConfig.worktreeCommand` owns the command, while gxserver reads the stored command, runs it in the target project cwd with typed-operation limits, and redacts command text from metadata.

CDXC:RemoteGxserver 2026-06-03-04:18:
Remote group/session zoom actions now use the remote-safe attach equivalent. Session Focus and group focus/visible-count controls copy the owning machine's SSH-wrapped gxserver attach command instead of mutating local pane topology for a remote project.
-->

This document is the implementation target for adding remote machines to Ghostex.
It is based on the user decisions captured on 2026-06-02 and the current codebase.

## Product shape

- Settings gets a new top-level tab named **Remote**.
- A remote machine requires a user-entered display name.
- Remote connection support is SSH-only for v1.
- The Remote settings tab can show a Tailscale help modal, but Tailscale is only setup guidance for making SSH hosts reachable. Ghostex does not implement direct/Tailscale listener setup in v1.
- Saved remote machines are shown in the sidebar as peer sections to the local **Projects** section.
- Local projects remain under **Projects**.
- Each remote machine gets its own sidebar section titled with the user-defined machine name.
- Remote machine sections can be reordered by dragging in the sidebar.
- Ghostex auto-connects all saved remotes on app startup.
- If SSH works but remote gxserver is stopped, Ghostex attempts to start gxserver over SSH.
- If gxserver is missing on the remote, Ghostex shows a React confirmation modal explaining why gxserver is needed and what will be installed. Only after approval does Ghostex upload/copy the packaged gxserver tarball and install/start it over SSH.
- Remote gxserver token acquisition uses SSH: after SSH succeeds, Ghostex reads `~/.ghostex/gxserver/auth/token` from the remote user account and stores the token in the local macOS Keychain.

## Sidebar behavior

- Connected remote machine section header shows the same two project actions as the local Projects header:
  - Add Project.
  - Clone Repository.
- Disconnected remote machine sections remain visible, faded, collapsed, and not expandable.
- A disconnected remote machine section shows only a reload/reconnect button on hover instead of Add Project or Clone Repository.
- Disconnected sections do not render remote projects or sessions because that inventory lives in the unavailable remote gxserver.
- Internal routing for merged local/remote presentation must use server-scoped identity. Treat session/project identity as `serverId:projectId:sessionId` internally so IDs from different servers cannot collide.

## Remote Add Project picker

- Remote Add Project must copy the T3 Code picker UX and implementation as closely as practical.
- The relevant T3 Code source is under `/Users/madda/dev/_active/t3code-embed`.
- The remote-capable picker is the command-palette browse flow, not only the native folder dialog:
  - `apps/web/src/components/CommandPalette.tsx`
  - `apps/web/src/components/CommandPalette.logic.ts`
  - `apps/web/src/lib/projectPaths.ts`
  - `packages/contracts/src/filesystem.ts`
  - server browse implementation in `apps/server/src/workspace/Layers/WorkspaceEntries.ts`
- Ghostex should copy the necessary picker code into this repo in a dedicated folder and wire it to gxserver browse/add-project endpoints.
- The picker browses the filesystem on the selected remote machine by calling that machine's gxserver, not by using a local macOS folder picker.

## Remote Clone Repository

- Connected remote machine headers expose Clone Repository alongside Add Project.
- Remote clone should reuse the existing Ghostex Clone Repository modal shape where possible, but route preview/start/poll/cancel through the selected remote gxserver.
- The clone destination picker should use the copied T3 Code browse picker for remote destination selection.

## Remote project actions

- Remote projects should support gxserver-typed actions where gxserver already has remote-allowed endpoints: Git, worktree, Beads, clone, project/session lifecycle, previous-session search, and session creation/attach.
- Local-only OS actions such as Finder and local IDE opening should be hidden or replaced for remote projects until a real remote equivalent exists.

## gxserver work

- Add a narrow filesystem browse endpoint for project picking. It must return directory entries suitable for the copied T3 Code picker.
- The browse endpoint is allowed for remote SSH-tunneled clients, but it must stay typed and bounded.
- Do not expose generic process execution or broad unbounded filesystem APIs.
- Preserve the existing local-only block for `/api/browseFilesystem`; add a separate project-picker browse endpoint with explicit limits instead of repurposing the blocked endpoint.
- Tests must prove the browse endpoint rejects invalid paths, limits output, and does not return files or private command output.

## macOS/sidebar work

- Add persistent remote machine metadata separate from gxserver secrets.
- Store remote tokens through the OS credential store. Do not write bearer tokens to JSON/localStorage.
- Add a remote connection manager that owns:
  - SSH status checks.
  - Remote gxserver start.
  - Approved remote gxserver install.
  - SSH tunnel process state.
  - Remote token read and Keychain storage.
  - Per-machine gxserver client instance.
  - Per-machine presentation snapshot and WebSocket subscription.
- Keep local gxserver as the default local profile.
- Render local and remote presentation through a server-scoped route wrapper.

## First implementation milestone

1. Add this target document.
2. Add gxserver protocol/API support for bounded project-directory browsing.
3. Copy/adapt the T3 Code browse picker into a Ghostex folder.
4. Add Remote settings tab shell and remote machine data model.
5. Render remote machine sidebar sections from placeholder state, including connected/disconnected header behavior and drag reorder.
6. Wire SSH connect/start/token read/tunnel later in the same goal.

## Current implementation status

Implemented in the first pass:

- The target document exists.
- gxserver has a new `/api/browseProjectDirectories` endpoint for bounded directory-only project picker browsing.
- Remote machine settings are normalized as `settings.remoteMachines`; each saved machine requires a name and SSH host.
- Settings has a top-level **Remote** tab with add/edit/remove machine controls and a Tailscale setup help modal.
- Saved Remote machines render as separate sidebar sections after local **Projects**.
- Disconnected Remote sections are faded, collapsed/non-expandable, render no projects/sessions, and expose only Reload.
- The Reload action routes through the native sidebar command contract as `reconnectRemoteMachine`.
- The T3 Code browse picker semantics have been copied/adapted under `sidebar/remote-project-picker/`, including path navigation, hidden-directory filtering, browse row construction, and a command-palette-style remote Add Project modal.
- The app-modal host can open a machine-scoped Remote Project Picker and route browse/add requests through explicit native sidebar messages.
- Remote section drag reorder persists to `settings.remoteMachines` through the existing settings update bridge.
- The native macOS host has a first-pass remote gxserver client for SSH-only connection attempts.
- The native client attempts to start `gxserver` over SSH when the command exists, reads the remote auth token from `~/.ghostex/gxserver/auth/token`, stores it in the macOS Keychain, opens a local SSH tunnel to the remote gxserver port, and checks remote `/api/health/server`.
- The native sidebar contract can now send authenticated machine-scoped gxserver HTTP requests through the native tunnel without exposing bearer tokens to React.
- Remote Project Picker browse/add requests now route through the selected machine's native gxserver request bridge when a remote connection is active.
- Missing remote gxserver now opens a React approval modal before install.
- Approved install now uploads the app-bundled gxserver package over SSH, installs it under `~/.ghostex/gxserver/package`, starts it from that absolute path, and then continues token/tunnel setup.
- Ghostex attempts to connect every saved Remote machine once when the native sidebar mounts.
- Connected Remote section headers render Add Project and Clone Repository controls; disconnected/failed sections remain faded and show Reload only.
- Connected Remote machines fetch `/api/readPresentationSnapshot` through the native tunnel and render remote project/session rows under the owning machine section with machine-prefixed ids.
- Remote project rows hide local-only header actions while proper remote action equivalents are still being wired.
- Remote Clone Repository opens the shared Clone Repository modal and routes preview/start/poll/cancel through the selected machine's gxserver.
- Remote Clone Repository destination selection uses the copied T3-style remote directory picker instead of the local macOS folder picker.
- Connected Remote machines subscribe to gxserver presentation events through the native SSH tunnel and apply streamed snapshots/deltas to the owning machine section.
- Remote Create Session, session sleep/wake/close, session pin/favorite/rename, group sleep/wake, and project remove/close route through the selected machine's gxserver instead of local macOS state.
- Remote rows block local-only actions such as Finder, local IDE, browser panes, pop-out, direct reload, local Git panels, and local worktree deletion; session and group focus open a local SSH attach terminal.
- Previous Sessions search includes connected Remote machines, and remote previous-session delete/restore routes through the owning machine's gxserver.
- Remote session lifecycle uses the owning machine's `/api/sleepSession`, `/api/wakeSession`, and `/api/killSession`; remote Full Reload restarts the provider by kill-then-wake through gxserver.
- Remote project header Git diff refresh uses the owning machine's typed `/api/runGitAction` calls and renders stats under the scoped remote project id.
- Remote session card clicks open local SSH attach terminals using the Android/iOS stable-id attach contract, and the local Ghostty carrier stays hidden from Quick so the visible card remains under the owning remote machine. Explicit Copy Attach Command copies the same SSH-wrapped `ghostex attach --session-id --project-id` command using saved SSH settings.
- Remote session cards copy SSH-wrapped resume commands from the owning machine's gxserver resume plan.
- Remote Git direct actions support clean-tree Push and View PR by routing Git/GitHub typed operations through the owning machine's gxserver.
- Remote Git commit/push/PR review opens the shared Git review modal for remote projects, scopes confirmation by pending request id, opens remote file diffs through gxserver, stages selected files remotely, generates blank commit messages from remote staged diffs with the local prompt agent, commits through remote `/api/runGitAction`, pushes through remote Git, and creates PRs with remote `/api/runGitHubAction`.
- Remote Git agent workflows launch remote agent sessions for Multiple Commits, Multicommit & Release, Release, and Sync with Main by creating the agent session on the owning gxserver, starting the remote zmx provider, and sending the workflow prompt remotely.
- Remote direct merge from the Git review modal can merge a remote worktree branch into the remote parent `main`, launch a remote conflict-resolution agent when needed, and optionally delete the remote worktree after a clean merge.
- Remote worktree rows preserve gxserver worktree metadata, and the Worktree modal can list/open existing remote worktrees through the owning machine's gxserver.
- Remote Worktree modal create mode can create a fresh remote Git worktree through the owning machine's gxserver, register the new checkout as a remote project, start the selected agent in that remote project, and deliver the first prompt.
- Remote Worktree modal create mode runs the source project's stored post-create setup command through the owning machine's gxserver before starting the remote agent, using `/api/runProjectSetupCommand` instead of a generic process endpoint.
- Remote worktree deletion opens the shared confirmation modal, inspects status through the owning machine's gxserver, removes the Git worktree via remote `/api/runWorktreeAction`, removes the remote project row, prunes, and refreshes the machine presentation.
- Remote Project Board Beads CRUD/list/mutation requests route through the owning machine's gxserver when opened from a remote project row.
- Remote Project Board conversation state reads gxserver-owned remote project links, shows live linked remote sessions, archives/unlinks through remote `/api/updateProject`, and maps Go to Session to copying the remote SSH attach command for the linked session.
- Remote Project Board generated titles run through the existing selected/default prompt-agent bridge without requiring the remote project path to exist locally.
- Remote Project Board current-project Start Work creates a remote agent session, starts its zmx provider on the remote machine, sends the bead prompt remotely, and persists the linked conversation in the remote project's board config.
- Remote Project Board new-worktree Start Work creates a sibling remote worktree, starts the selected agent in that remote worktree project, and persists a project-qualified conversation link on the board project.
- Remote session focus and focus-mode actions copy the owning machine's SSH-wrapped gxserver attach metadata command instead of silently doing nothing.
- Remote group focus copies the owning machine's SSH-wrapped attach command for the best available session in that remote project.
- Remote group/session zoom equivalents copy the owning machine's SSH-wrapped attach command where a real remote-safe focus target exists.
- Remote Finder/Open-in-IDE actions copy a saved-machine SSH command that opens a remote shell in the project directory.
- Dirty remote worktree delete can open remote commit review, and delete-after-commit removes the scoped remote worktree through gxserver.
- Remote Sleep Inactive sleeps idle running remote terminal/agent sessions through the owning machine's gxserver while preserving working/attention sessions.
- Remote project rename updates the owning machine's gxserver project metadata and refreshes that machine's presentation snapshot.

Still to implement:

- None for the listed v1 implementation target. Future work can add richer remote pane focus/IDE integrations when gxserver has a renderer event channel or tool-specific remote open support.
