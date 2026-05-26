# Changelog

<!-- CDXC:Distribution 2026-05-23-12:45: Release notes for 3.10.0 must include all user-facing commits after v3.9.1 so README, GitHub, and Homebrew release metadata describe the same shipped behavior. -->

## 3.13.0 - 2026-05-25

- Added the Ghostex terminal TUI as the default `ghostex` / `gtx` experience, while keeping direct session attach available through the attach shortcuts.
- Added a first-launch setup experience with Ghostex workspace artwork, agent hook readiness, and install/refresh actions for supported agents.
- Added Git release workflow actions for reviewing changes, creating split commits, and handing off multicommit release work from the app.
- Improved Git review flows with a richer commit modal, changed-file diff inspection, and clearer project/worktree ordering.
- Improved Project board refresh behavior so ticket moves, edits, copied work prompts, and nearby Beads changes show up without manual refresh while large boards stay capped for smoother scrolling.
- Improved the Ghostex terminal TUI with the Herdr-backed terminal runtime, hotkey overlay polish, full zmx replay, and synced working/attention/idle status from persisted sessions.
- Improved titlebar and workspace chrome behavior with cleaner resource controls, tighter traffic-light alignment, and safer modal/menu click handling above native panes.
- Improved cross-platform Ghostex parity for project workflows, workspace persistence, browser/code/git panes, settings, modals, and release packaging.
- Improved mobile and persistent-session stability with clearer Android remote-session activity, more responsive iOS direct attach, and better cleanup for zmx, zellij, and other persisted terminal sessions.
- Restored Monaco as the default local Ctrl+G prompt editor while preserving terminal-native prompt editing for SSH sessions.

## 3.12.0 - 2026-05-23

- Improved restored persistent sessions so focusing an already-running tmux, zmx, or zellij-backed terminal no longer sends restore text or resume commands into the live prompt.
- Improved app modal click handling so Settings and Agents Hub stay fully interactive above native pane tabs and workspace chrome in narrow layouts.
- Improved Ghostex iOS direct attach with paced terminal rendering, smoother scrollback gestures, and better responsiveness during animated terminal output.

## 3.11.0 - 2026-05-23

- Added a beads-backed Project board in Project mode with kanban lanes, full-text search, status filters, comments, labels, image previews, and Linear-style ticket keys.
- Added reversible session focus mode with pane-tab controls, session-card focus behavior, and a titlebar Exit Focus action.
- Added Ghostex CLI session selectors plus read/send message commands for scripting live sessions from the terminal.
- Improved Code, Git, and Project side-pane behavior so clicking a session while the companion pane is hidden returns to Agents view and focuses the selected session.
- Improved Settings on narrow windows so top tabs and section navigation wrap cleanly instead of clipping.
- Improved zmx and iOS remote attach stability with visible-only replay, better resume fallback behavior, and smoother direct SSH terminal rendering.

## 3.10.0 - 2026-05-23

- Added a beads-backed Project board in Project mode with draggable kanban columns for creating, moving, and commenting on project issues.
- Added reversible session focus mode from pane tabs and session cards so one pane tab group can be isolated while Code, Git, or Project surfaces restore on unfocus.
- Added agent hook status and install controls in Settings -> Agents so reliable-resume agents show machine-local hook setup and can be installed from the app.
- Improved titlebar Quit actions so Resources can terminate the live PIDs shown in the menu instead of relying only on sidebar sleep.
- Improved zmx attach and resume through visible-only replay for live sessions, saved fallback resume commands, and clearer failed-resume panes.
- Improved Settings modals hosted in the sidebar with a dimmed backdrop that dismisses on click, matching full-window modal behavior.
- Improved Ghostex iOS direct SSH attach responsiveness with batched terminal output and clearer attach progress.

## 3.9.1 - 2026-05-23

- Made `gte` the default Ctrl+G prompt editor so new installs open the terminal-native editor without extra setup.
- Improved terminal shortcut routing so Cmd+G opens agent prompt editing, and common Mac editing shortcuts reach terminal apps such as `gte` instead of being swallowed by the app menu.
- Improved sidebar and toast layering so sidebar navigation stays clickable while app toasts are visible and toast-only overlays no longer steal workspace clicks.
- Improved the Delayed Send terminal countdown badge with more padding for better readability.
- Improved iOS direct SSH attach responsiveness by batching remote terminal output, reducing render spam, and showing clearer attach progress.

## 3.9.0 - 2026-05-23

- Added hidden restorable launchers for Rovo Dev, Hermes Agent, CodeBuddy, and Qoder with matching icons and cleaner session-title restore support.
- Added Agentation as the default browser-pane feedback tool, with a Settings option to switch the browser action back to React Grab.
- Improved agent session restore by capturing native agent session ids through installed hooks and showing the captured id in session-card tooltips.
- Improved terminal defaults with the GitHub Dark profile, JetBrains Mono, a lighter font weight, more scrollback, protected clipboard behavior, and one-to-one mouse scrolling.
- Improved rich prompt editing with the renamed `gte` terminal editor option, system-inherited editing, and custom editor commands.
- Improved terminal mouse behavior so Command-clicks and modifier changes are reported reliably to terminal apps.
- Improved app modal and workspace chrome behavior so Escape closes full-window modals reliably and native pane controls keep receiving clicks.
- Improved project drag previews so insertion lines stay stable while dragging across expanded project groups.
- Added native Ghostty terminal groundwork for the iOS app and local iPhone build/install scripts.
- Added mobile app availability notes for TestFlight and Android APK downloads.

## 3.8.0 - 2026-05-21

- Added Quit controls to the titlebar Resources menu so individual resource groups or all managed sessions can be closed from one place.
- Improved the Resources menu for zmx users with clearer persistence guidance, less crowded header actions, and collapsed diagnostic resources by default.
- Improved the pet overlay so attention/completed session cards appear ahead of active working cards while preserving sidebar order within each status.
- Improved embedded Code, Git, and browser panes so command-pane resizing stays visually stable during live drag gestures.
- Improved compact sidebar layouts so collapsed Quick and Projects sections no longer create extra hidden scroll space.

## 3.7.0 - 2026-05-21

- Improved embedded Code, Git, and browser panes so showing or hiding the command pane no longer shifts page content upward over repeated resizes.
- Improved Delayed Send with a clearer floating countdown badge in terminal panes, non-blocking scheduling feedback, and a timer dialog that selects the minutes field when opened.
- Improved restart recovery so sessions that quit while working or needing attention wake again on the next launch.
- Simplified the sidebar by removing hidden legacy Agents, Actions, Browsers, and project-header surfaces from the React sidebar.
- Improved project group reordering with a compact cursor-following drag preview for large expanded projects.

## 3.6.0 - 2026-05-21

- Added Cursor CLI, Antigravity CLI, and Amp CLI as built-in agents with matching icons, launch commands, title cleanup, and working/done detection.
- Added global and per-agent Accept All controls for supported agent CLIs, including a first-launch setup surface for choosing the default behavior.
- Added project worktree workflows for creating a new worktree from a prompt, launching an agent into it, reviewing changed files, and optionally cleaning up the worktree after git actions.
- Improved sidebar Actions so each project can keep its own action list while worktrees inherit their parent project's actions.
- Improved the Ghostex CLI so running `ghostex` or `gtx` with no subcommand lists sessions in the same project order as the app, and zmx-backed resume can recreate a missing named session when possible.
- Improved the pet overlay with actionable status badges, a Go to Ghostex menu action, a Sleep Pet action, and an additional pet sprite.
- Made the floating prompt editor open faster after startup by warming the editor host before the first real prompt edit.
- Improved Delayed Send reliability by preserving pending deadlines with restored terminal sessions.
- Added a Storybook regression story for large real project lists so sidebar scrolling and project reachability are easier to verify.

## 3.5.0 - 2026-05-18

- Added a much more complete Ghostex Android remote workflow with built-in connection handling, session attach, remote actions, session creation, file upload, and shareable phone-side diagnostics without requiring phone-side OpenSSH or sshpass setup.
- Improved Ghostex Android navigation with a cleaner drawer, quick refresh, explicit Machines, Settings, and Exit controls, collapsible project groups, project reordering, and project-level session creation.
- Added Ghostex Android terminal settings inside the drawer for common terminal behavior and display options.
- Improved zmx-backed terminal stability on macOS so panes refresh more reliably after resize, mode switches, pop-out changes, and sleeping-session wake.
- Improved sleeping-session wake behavior so restored sessions return to the focused tab group instead of unexpectedly reappearing as separate split panes.

## 3.4.1 - 2026-05-17

- Added visible Delayed Send countdowns in the sidebar, native pane tabs, and terminal panes so scheduled sends are easy to spot before they fire.
- Improved Delayed Send controls so reopening an active timer shows the remaining time and lets you cancel or reschedule it.

## 3.4.0 - 2026-05-17

- Added a native right-click menu in terminal panes with Copy and Paste actions.
- Improved Last Active timestamps so sleeping and restored terminal sessions keep accurate sidebar times and sorting after restart.
- Improved the titlebar Resources menu so Browser Tabs only count Ghostex embedded browser helpers and use clearer browser process labels.

## 3.3.0 - 2026-05-17

- Added image paste support to the rich prompt editor, including durable local image references, thumbnail previews, full-size preview popups, and one-click image removal.
- Improved Open In menus and Settings with recognizable editor brand icons for Cursor, VS Code, Zed, Antigravity, VSCodium, and JetBrains-family editors.
- Added Show less / Show more controls for long project session lists so large projects stay easier to scan.
- Added configurable hotkeys for pane actions and the first five custom Actions, including browser pane, rotate panes, merge tabs, delayed send, fork, reload, and pop out.
- Improved sleeping persisted sessions so sleeping releases the underlying provider runtime and external `ghostex` / `gtx` attach resumes sleeping sessions correctly.
- Improved the titlebar Resources menu so browser memory rows show the actual tab title and URL instead of raw browser process labels.
- Moved the Wake/Sleep Pet control into the sidebar overflow menu so pet controls live next to session tools while the titlebar stays focused on workspace actions.
- Improved rich prompt editor focus so clicking blank editor chrome reliably keeps typing inside the prompt editor.

## 3.2.0 - 2026-05-16

- Added a titlebar Resources menu that shows live CPU and memory usage grouped by project, session, Ghostex runtime, and browser tabs.
- Added a one-click titlebar action to sleep inactive agent sessions from the Resources menu.
- Added persistent hide/show behavior for the agent side pane in Code, Git, and Project modes, with a titlebar restore button when the pane is hidden.
- Improved custom terminal actions so command panes are reused by action title and duplicate action titles are blocked before saving.
- Improved project headers with more reliable right-click menus and easier-to-scan agent launcher icons.

## 3.1.0 - 2026-05-16

- Added a full-window Command Palette on `Cmd+K` for Ghostex actions, project actions, Settings, pane controls, and pet controls.
- Added sidebar display presets for Codex, Minimal, and Detailed layouts so users can quickly choose how quiet or information-rich the sidebar should be.
- Improved Agents Hub editing so saved files update immediately in the open modal and external editor buttons open the right folder with the selected file focused.
- Moved browser pane sessions into their project groups and removed the separate Browsers sidebar section so project work stays grouped together.
- Improved project Git/browser panes with project tabs, browser toolbar support, and more reliable active project selection.
- Improved Previous Sessions search with the newer modal styling and multiline query input.
- Improved the `ghostex` / `gtx` CLI help and session listing so commands are easier to scan and sessions follow the sidebar's Last Active order.

## 3.0.0 - 2026-05-15

- Added a Tips & Tricks guide inside Ghostex with practical pages for workspace basics, agents and sessions, actions and browsers, Codex setup, and remote access from a phone or another machine.
- Added bundled `ghostex` and `gtx` command-line launchers to the app so Homebrew installs both commands automatically for session listing, attach, wake, focus, and sleep workflows.
- Changed new session labels to shorter `g-MMDD-HHMMSS` identities so sidebar numbers and tmux, zmx, or zellij session names are easier to read and reuse.
- Improved sleeping-session restore behavior so waking a session puts it back into the active tab group instead of disrupting the current split layout.
- Polished project workspace controls with clearer titlebar modes, better project panel behavior, and a cleaner path from empty project headers into a first terminal.
- Improved native pane and browser stability around focus, tab scrolling, titlebar actions, and embedded browser resizing.
- Improved rename handling so pasted titles are cleaned into readable session names before they are saved.

## 2.7.0 - 2026-05-15

- Completed the Ghostex public naming cleanup across release, app, Homebrew, and generated CEF helper surfaces.
- Added Factory Droid and Grok Build as built-in agent options with bundled icons, sidebar labels, and session metadata support.
- Updated the default agent picker order to T3 Code, Codex, Claude, Pi Agent, OpenCode, Gemini, Copilot, Factory Droid, and Grok Build.
- Renamed the default Pi launch option to Pi Agent while keeping `pi` as the command.
- Changed directional pane focus defaults to `Cmd+Alt+Arrow` so normal `Cmd+Arrow` text-editing behavior is not stolen by workspace navigation.
- Added a searchable action icon picker in Settings so custom sidebar actions can choose icons faster and keep accessible labels visible.
- Moved project git diff stats into project headers and removed the separate code-editor sidebar row so project groups scan more compactly.
- Added titlebar modes for Agents, Code, Git, and Project so project/editor surfaces can be reached from the native titlebar without crowding the sidebar.
- Renamed the tasks-backed titlebar surface to Project while keeping its placeholder bundled locally and preserving existing internal mode IDs.
- Removed the Back to Agents View button from code/git companion panes so the companion titlebar only exposes pane dismissal.
- Kept the titlebar mode switcher's active pill animation visible while moving between distant modes.
- Moved Rotate Panes into the pane overflow menu, added Merge All Tabs, and improved command-panel tab creation in clicked tab groups.
- Kept workspace pane tabs readable with a wider minimum tab width while preserving horizontal scrolling in narrow multi-tab panes.
- Improved prompt editor hit routing, collapsed command-panel sizing, previous-session restore targeting, favorite backfill, and semantic Last Active tracking.
- Preserved full generated session titles in stored titles and hover tooltips even when live terminal titles report an ellipsized prefix.
- Hid tmux, zmx, and zellij persistence-provider letters from session-card agent icons while keeping provider metadata available for attach commands and tooltips.
- Fixed reference-sidebar primary labels so descenders remain visible in New Session, Agents Hub, Plugins, Search, Settings, and Recent Projects rows.
- Added Tasks placeholder bundling and Git/browser mode helpers for the new native workspace modes.
- Ignored legacy pre-rename generated web assets so old `zmuxHost` build output does not appear as source work.

## 2.6.0 - 2026-05-15

- Improved Agents Hub profile tooltips with structured profile labels, instruction file paths, target paths, and Finder actions that stay readable for dense local agent configurations.
- Added a setting to hide Last Active timestamps on active session cards while letting titles use the full card width without overlapping status dots or close buttons.
- Hid browser page history from the Previous Sessions modal so the restore flow stays focused on agent sessions.
- Polished Previous Sessions and session-card metadata alignment, including fixed timestamp columns, project-label positioning, and clearer brand-colored agent icons.
- Simplified the sidebar overflow menu by removing completion sound, persistence, and remote-access controls from that compact menu while keeping scratch tools, running state, hotkeys, and help.
- Updated Next Tab and Previous Tab navigation to follow the visible sorted sidebar order, including collapsed Combined sections.
- Improved project-editor and command-pane hit routing so active editor surfaces, companion panes, command tabs, and resize handles receive the intended native clicks.
- Added native activation diagnostics and CEF layout logging to investigate focus steals and browser-pane geometry drift from app lifecycle and native frame snapshots.
- Added pane-tab geometry diagnostics, adjusted workspace tab-bar sizing, and made non-command tab add buttons use square chrome.
- Added provider/session context labels and first-run persistence notices for tmux, zmx, and zellij-backed terminal sessions.
- Kept macOS attention notifications minimal by using the session name as the title and project name as the body.

## 2.5.1 - 2026-05-15

- Published a native Intel x86_64 build beside the Apple Silicon build, with a separate Intel Sparkle feed and an architecture-aware `ghostex` Homebrew cask.
- Clarified the README install flow so the same `brew install --cask maddada/tap/ghostex` command automatically selects Apple Silicon or Intel.
- Changed sidebar actions to always use an explicit icon, defaulting new and legacy actions to the Play glyph with editable color.
- Added a titlebar pet control that toggles the floating pet overlay through persisted settings and keeps the overlay state synchronized.
- Resized the floating pet overlay to fit the sprite when no activity bubbles are visible while preserving the wider activity panel when messages appear.
- Improved Commands panel focus restoration so collapsing command terminals returns keyboard focus to the previous workspace terminal.
- Improved Reload Session placement so reloaded terminals replace the clicked pane/tab instead of appending as a new split.
- Kept embedded VS Code open when creating new terminal, browser, T3, or command sessions from the sidebar.
- Polished Previous Sessions rows with centered restore content, an X delete control, and active-session icon hover behavior that does not dim the focused row.
- Consolidated sidebar resize ownership, aligned pane tab heights, and hid active pane borders in single-pane workspaces.
- Updated local native launch behavior so `bun run start` uses architecture-specific DerivedData paths for arm64 and x86_64 builds.

## 2.5.0 - 2026-05-14

- Added dual-architecture release pipeline support for separate Apple Silicon and Intel DMGs, separate Sparkle feeds, and an architecture-aware Homebrew cask.
- Renamed the public app surface from Ghostex to Ghostex while keeping internal repository, code, storage, bundle id, and historical asset names under `ghostex`.
- Changed the public CLI command to `ghostex`, with `gtx` as the short alias, and intentionally stopped documenting `ghostex` as a CLI compatibility command.
- Updated README install and CLI examples so `brew install --cask maddada/tap/ghostex` is the public install command.
- Updated the reference sidebar workflows with a combined-only layout, improved command panel behavior, searchable settings sections, refined hotkey navigation, and cleaner Previous Sessions rows.
- Improved Agents Hub so it loads the real local catalog, supports in-place saving, and avoids bundling private placeholder profile data.
- Added floating Monaco prompt editing with resize/move behavior, save/cancel status handling, and safer terminal-close persistence.
- Improved native pane chrome, focus/resize hit ownership, project editor routing, commands panel tab controls, and embedded browser pane handling.
- Restored direct native terminal scrollbar behavior so embedded Ghostty surfaces keep scrollback geometry, scrollbar rendering, and precise trackpad momentum.
- Improved T3/code-server runtime stability, including runtime liveness repair and correct macOS elapsed-time parsing for startup grace decisions.
- Added a floating pet overlay with clickable activity bubbles that bring Ghostex forward and focus the exact session shown above the pet.
- Added release handover docs and updated the release workflow so future agents keep GitHub Releases, Sparkle, and Homebrew aligned for both architectures.

## 2.3.2 - 2026-05-10

This patch release adds session attention notifications and tightens project editor row alignment.

- Added optional macOS attention banners for sessions that need attention, including Settings control, native notification permission handling, click-to-focus routing, and sidebar rate limiting.
- Kept attention notifications separate from completion sounds so users can enable clickable system routing without audible alerts.
- Improved project editor diff-row alignment in the reference sidebar and expanded Storybook fixture coverage for open editor rows with diff stats.

SHA256: `61d2d71547b492eb732483d09193df3cb3de2b475f86f7916f75344d89daf220`

## 2.3.0 - 2026-05-10

This minor release improves the 2.x workspace with stronger hotkey editing, richer prompt editing, native runtime fixes, and more predictable sidebar behavior.

- Added a shortcut recorder for hotkey settings so Command chords are captured directly instead of typed into text fields.
- Updated split-count shortcuts to single-chord defaults and added direct Split More / Split Less actions for faster workspace layout control.
- Added opt-in Rich Prompt Editing with gte, including Settings UI, native install routing, environment injection, and zsh startup shims that keep gte in charge after shell profiles load.
- Added installed-app CLI proxying so terminal commands such as `ghostex --help` and `ghostex sessions` run the bundled Node CLI before the macOS app starts.
- Improved native command execution by normalizing GUI-launched process `PATH` values so background commands can find common developer tools.
- Improved terminal search keyboard behavior, centering, and neutral styling for embedded Ghostty panes.
- Added active-project names to the macOS title bar while keeping chat workspaces labeled as Ghostex.
- Added focused native pane-reorder diagnostics and rejected stale title-bar hits so bottom-edge terminal selection does not become pane dragging.
- Changed provider-backed terminal recreation so reload, wake, restore, and previous-session restore follow the current Settings provider while attach-command inspection still uses stored provider metadata.
- Separated project agent launching from plain terminal creation so project headers have distinct agent and terminal controls.
- Changed the Combined sidebar top row to New Session so it creates in the active project/chat context while chat creation stays in the Chats section.
- Added persistent sidebar collapse state and a Settings toggle for showing project editor changed-file counts.
- Polished sidebar spacing and session-title truncation so reference layout controls and session cards scan more cleanly.
- Updated README development setup and feature wording for the current Ghostty fork and 2.3 workflow.

SHA256: `aabfea87f042ab59e1eb8aabd371226108df5a980edccbee80f58b26d7a80d70`

## 2.2.0 - 2026-05-09

This minor release tightens the new 2.x interface with the latest workspace, settings, and release workflow polish.

- Added a unified tabbed Settings dialog that brings Settings, Agents, Actions, and Hotkeys into one configuration surface.
- Added lazy `~/.ghostex` folder usage stats and an Open ghostex Folder action from Settings.
- Added menu bar session status indicators while making floating desktop indicators independently optional.
- Renamed orange agent status from running to working so agent activity is distinct from live runtime state.
- Improved project editor rows so opening and error states stay visible, show diagnostics, and can be retried instead of disappearing.
- Improved session card and Previous Sessions row chrome with hover close controls, clearer last-active placement, and refined editor diff labels.
- Added a separate `start:dev` app startup path for `ghostex-dev` so normal `bun s` keeps release-like behavior.
- Updated README presentation and feature wording for the current Ghostex positioning.

SHA256: `73340ec06d57c3b16a585ee9c5566513c91fd5e0a6cba9477ae5982a122521c9`

## 2.1.0 - 2026-05-08

- Continued the 2.x UI refresh messaging: ghostex now presents the redesigned simplified Codex-style workspace, refreshed project groups, action controls, tooltips, session cards, settings surfaces, and updated screenshots.
- Continued the 2.x stability and performance focus across native sidebar sync, AppKit relayout avoidance, shared storage writes, diagnostic filtering, and workspace visibility.
- Added the macOS application icon from agent-manager-x so Finder, Dock, app switcher, and signed release builds use the intended branded icon instead of a generic app icon.
- Compiled the icon through Xcode's `AppIcon` asset catalog so signed and notarized release bundles carry the same icon metadata as local builds.

SHA256: `6bbd2a95f1f585df20a2811c8f2cae492ad53492bc13814b4b085c5a906e9ced`

Install with Homebrew: `brew install --cask maddada/tap/ghostex`

## 2.0.0 - 2026-05-08

- Changed the whole ghostex UI around the simplified Codex-style workspace: refreshed top chrome, project groups, action controls, tooltips, session cards, Previous Sessions rows, settings surfaces, icons, and README screenshots.
- Improved workspace stability and performance by suppressing byte-identical native storage writes, skipping metadata-only AppKit relayouts, reducing high-frequency native diagnostics, and filtering noisy T3/focus logs.
- Added native workspace visibility helpers and tests so sidebar/native sync can avoid unnecessary workspace work while preserving visible pane behavior.
- Improved restore and fork actions for native terminal title bars, including Codex and Claude fork command paths.
- Fixed first-prompt auto-rename so meaningful terminal-synced titles are preserved instead of being overwritten by redundant generated rename commands.
- Updated Storybook sidebar scenarios, interaction readiness, and fixtures so visual checks match current local settings and the redesigned sidebar behavior.

SHA256: `da519a720e65a955ce182f0655ba36a6cb02c188aab441142dc2bf9747f70456`

Install with Homebrew: `brew install --cask maddada/tap/ghostex`

## 1.4.11 - 2026-05-08

- Added reference-style sidebar action flows, modal flows, story fixtures, and Combined layout refinements.
- Added Pi as a supported agent option with icon assets, tests, and agent configuration UI wiring.
- Improved sidebar group, session-card, search, modal, and scroll styling to better match the reference layout.
- Improved native editor pane handling, pane resize routing, T3 diagnostics, and accessibility-permission driven controls.
- Improved floating session status indicators with refined drawing, attention/working visual treatment, and additional settings support.
- Improved session title, activity, rename, and first-prompt metadata handling so loading and restored-title states are more reliable.

## 1.4.10 - 2026-05-08

- Added human-facing `ghostex` CLI session commands for listing, attaching, resuming, killing, sleeping, waking, and focusing running terminal sessions.
- Added provider-backed attach metadata so tmux, zmx, and zellij sessions keep their stored provider, show sidebar badges, and expose copyable attach commands.
- Added a Settings control for floating session status indicator size, plus updated indicator drawing, tooltip wrapping, and settings-control polish.
- Fixed main window chrome restore so ghostex reopens at the prior size, position, and display while avoiding offscreen IDE-attachment coordinates.
- Fixed Find Previous Session routing so the footer button opens the prompt even with an empty modal search field and logs the modal/native bridge path.
- Improved session title sync by rejecting Ghostty ghost placeholder titles and protecting trusted restored titles from automatic rename overwrite.

## 1.4.9 - 2026-05-07

- Improved embedded code-server editor panes so VS Code panel/sidebar drag and drop keeps live hover and drop targeting while using CEF.
- Fixed embedded browser/editor pane teardown so closing a pane from the sidebar does not close the top-level app window.
- Improved project editor persistence so VS Code workbench layout survives app restarts without putting code-server into a fresh Chromium profile.
- Improved zmx session persistence so empty sessions attach directly, startup commands run only for new sessions, and inherited zmx session variables do not hijack app-managed names.
- Improved zellij session persistence so generated session names stay within provider limits and new sessions launch under the same name used for restart attach.
- Enlarged README screenshots for clearer GitHub documentation.

## 1.4.8 - 2026-05-06

- Added embedded code-server editor panes so project groups can open a native CEF-backed code editor surface.
- Added project header controls for opening project-scoped browser panes and project editor panes from the clicked group.
- Added zellij as an opt-in terminal session persistence provider alongside tmux and zmx.
- Added a sidebar side setting so users can choose left or right placement from Settings, including startup restore and legacy side migration.
- Added modified-setting indicators with per-setting reset-to-default tooltips in Settings.
- Replaced native `title` attributes across sidebar controls with shadcn/Radix app tooltips and shared local brand icons.
- Improved project editor panes so middle-click closes the editor surface while preserving project diff stats and runtime sleep behavior.
- Improved code-server editor drag/drop by disabling native pane resize/header reorder interception while editor panes are visible and logging passive CEF drag diagnostics.
- Fixed right-side sidebar layout so the resize divider sits between the workspace and sidebar instead of on the outside edge.
- Fixed Combined-mode project groups so empty project groups remain expandable for editor cards while browser and non-project groups still auto-collapse.
- Removed versioned Sparkle release-note markdown files from the repository.

## 1.4.7 - 2026-05-06

- Added persistent terminal session providers so terminal metadata, restore inputs, and provider state can survive app restarts.
- Added Chromium CEF native browser support with vendored CEF build wiring, persistent browser storage, and cookie flushing on app termination.
- Added shared Ghostty settings so terminal configuration can be reused across the native host and sidebar settings surfaces.
- Added native floating session status indicators for working, attention, and available session counts, including click-to-focus routing back into the workspace.
- Added a Configure Actions modal with readable action rows plus create, edit, and delete flows for sidebar project actions.
- Added Previous Sessions restore for archived terminal session records so restored sessions keep agent identity, first-message metadata, title provenance, favorites, and resume inputs.
- Filtered placeholder Previous Sessions entries so default titles such as `Terminal Session` and `Codex Session` are not saved as low-signal history cards.
- Improved Previous Sessions project restore by switching back to the original project, reviving Recent Projects entries, or recreating the project when needed.
- Fixed sparse Combined sidebar scrolling so empty/collapsed project lists stay pinned instead of rubber-banding or preserving stale scroll offsets.
- Fixed Combined-mode Chats grouping so the synthetic Chats group marker survives sidebar-store normalization.
- Improved native pane drag and reorder handling so hit testing stays scoped to pane headers while terminal/body interactions keep their expected routing.
- Improved terminal close cleanup by skipping redundant Ghostty close requests once a process has already exited.
- Adjusted native sidebar and Storybook layout so project panels can use the right edge rail without being clipped.

## 1.4.6 - 2026-05-05

- Replaced native title-bar action controls with compact sidebar Actions dropdowns for project commands and Open In targets.
- Added explicit Open In choices for Finder, Visual Studio Code, and Zed, including brand icons and persisted primary target selection.
- Added removable Actions dropdown rows so configured project actions can be deleted from the same menu that runs them.
- Added custom workspace theme colors that tint the workspace dock, Combined-mode project headers, and active workspace sidebar theme surfaces.
- Moved custom workspace color selection into the workspace Theme context menu with a recent-color palette, removing the separate workspace config modal.
- Improved empty Combined-mode Chats and project groups so they auto-collapse while empty, expand when sessions appear, and show static folder/chat icons instead of inactive chevrons.
- Improved Recent Projects styling to match normal sidebar group rows and show preserved session counts inline.
- Expanded Codex first-prompt hook installation to existing Codex profile homes so first-prompt auto-title capture works when `CODEX_HOME` points at a profile directory.
- Finished native-only cleanup by removing the retired VS Code extension/workspace webview sources from Storybook and TypeScript configuration.

## 1.4.5 - 2026-05-05

- Added native title-bar split controls for primary Actions and Open In commands while keeping empty title-bar space draggable.
- Added React-rendered title-bar dropdown menus for configured ghostex actions and Open In targets, reusing the existing sidebar command and selected-IDE state.
- Improved terminal focus sync so passive layout/status updates no longer steal focus from the terminal or modal the user is actively typing in.
- Improved embedded Ghostty terminal color handling by removing inherited color-disabling environment keys at the native surface boundary.
- Added optional CEF prototype scaffolding for future Chromium browser panes while keeping the default WKWebView build path buildable without the Chromium SDK.

## 1.4.4 - 2026-05-04

- Added Combined sidebar mode so native ghostex can show one project group per project across all projects, while preserving Separated mode for the previous per-project layout.
- Added a Recent Projects drawer with fuzzy project/path search and startup cleanup for empty combined-mode projects.
- Added project context actions for opening project config, setting project theme, copying the project path, opening the folder in Finder, opening it in the selected IDE, and closing projects into Recent Projects.
- Improved native T3 Code runtime handling so fresh supervised runtimes are retained during startup/auth races, with explicit stop still available for recovery.
- Improved T3 thread changes by creating and syncing sidebar cards when the native host receives thread-change events.
- Fixed sidebar resize drags to use stable window coordinates so the sidebar does not jump while dragging.
- Added color-environment diagnostics for agent launches so monochrome CLI sessions can be traced to inherited terminal environment values.
- Added long-paste rename handling that summarizes pasted session text before syncing the rename into the agent CLI.

## 1.4.3 - 2026-05-03

- Added an opt-in Browser Panes mode that opens browser actions as first-class workspace panes instead of Chrome Canary windows.
- Added native browser pane controls for address navigation, reload, DevTools, React Grab, profile selection, and browser-data import messaging.
- Persisted browser pane URLs, favicons, and browser-auto titles so sidebar cards and app restarts reflect the current page.
- Added native pane header drag-to-reorder support across terminal, T3, and browser panes without surfacing hidden sessions.

## 1.4.2 - 2026-05-02

- Fixed Sparkle update detection by publishing releases with a monotonic `CFBundleVersion` build number.
- Kept the native AppKit pane resizing changes from 1.4.1 available in the update feed.

## 1.4.1 - 2026-05-02

- Moved split pane resizing into the native AppKit terminal workspace so Ghostty and WKWebView panes resize from the same layout owner.
- Removed the React workspace resize overlay and tests that no longer apply to native pane sizing.
- Removed whole-cell terminal body stepping so pane chrome and terminal renderer widths stay aligned during native resize.

## 1.4.0 - 2026-05-02

- Added Sparkle appcast update support with signed appcast metadata for native macOS updates.
- Added native T3 Code panes with managed runtime bootstrap, authentication, thread routing, and runtime diagnostics.
- Added T3 remote/browser access links for native panes, including local-network and Tailscale-friendly pairing URLs.
- Added draggable workspace pane resizing with double-click equalize behavior for pane rows and columns.
- Added a standard native macOS app menu with About, Check for Updates, Settings, Services, Hide, and Quit.
- Added a setting to hide the native IDE title-bar attach button without disabling IDE attachment.
- Improved IDE attachment behavior so the floating Show IDE button raises or launches the configured IDE for the current workspace.
- Improved T3 runtime startup by rebuilding the local t3code-embed checkout only when source fingerprints or build output require it.
- Improved workspace dock clarity by dimming inactive project icons.
- Kept the local release workflow skill available on this machine while removing it from the public repository tree.

## 1.3.0 - 2026-04-30

- Added Ghostty config actions and a recommended Ghostty config that includes ghostex-managed color, cursor, font, scroll, and split-opacity settings.
- Added a cyan Ghostty palette default to improve terminal color readability with the recommended ghostex-managed config.
- Added a local agent release skill for repeatable split commits, release notes, GitHub releases, and Homebrew cask publishing.
- Added Generate Name diagnostics across the sidebar, bridge, and controller paths so silent session-name failures are easier to trace.
- Fixed terminal title bars so long titles are measured from raw text and use available pane width before truncating.
- Improved attached IDE refocus timing so ghostex resurfaces faster when the IDE is already active or when activation retries succeed quickly.
- Hid bare agent status words such as `Working`, `Done`, `Idle`, `Thinking`, and `Error` from visible terminal titles.

## 1.2.0 - 2026-04-29

- Added terminal scroll multiplier settings for precision devices and discrete mouse wheels.
- Synced Ghostty mouse-scroll-multiplier values into the shared Ghostty config and reloads scroll-only changes immediately.
- Added native AVFoundation sound playback for completion/action sounds and settings previews, with sound assets bundled in the app.
- Gated non-error native/sidebar diagnostics behind Debugging Mode and reduced high-frequency focus/title logging.
- Improved terminal close cleanup by terminating processes still attached to the closed terminal tty.
- Improved embedded terminal search behavior so Escape closes search before reaching terminal programs.
- Changed embedded terminal cursor rects to use the default pointer cursor instead of always showing the I-beam.

## 1.1.0 - 2026-04-29

- Added full-window native modals for Find Previous Session and T3 Thread ID entry.
- Improved previous-session search launching by routing modal input through the sidebar/native command bridge.
- Improved T3 session thread binding controls in the native sidebar workflow.
- Fixed agent wrapper process launch so interactive CLIs stay attached to the foreground terminal TTY and receive resize signals.
- Added agent wrapper debug logging for TTY/process details used to diagnose resize and child-process issues.
- Fixed native embedded terminal layout to step pane sizes to whole Ghostty character cells, including configured terminal padding.
- Expanded native terminal resize diagnostics with core Ghostty grid, padding, backing-pixel, and pane geometry metrics.

## 1.0.4 - 2026-04-28

- Added configurable app hotkeys, including native AppKit handling while terminal panes have focus.
- Added saved first-message metadata for agent sessions and a copyable "View 1st Message" modal in active and previous session flows.
- Added terminal workspace background color settings and native pane-gap/background rendering.
- Added automatic Zed workspace syncing after ghostex workspace switches, controlled by a setting.
- Added native main-window size persistence between launches.
- Added native terminal search bar rendering and focus preservation improvements for modal workflows.
- Improved sidebar sessions to default to last-activity ordering and keep agent-icon mode blank for iconless sessions until hover.
- Expanded command/workspace icon choices and kept the icon picker search fixed while the icon list scrolls.
- Removed T3 Code from default sidebar agents while preserving existing T3 session recognition.
- Improved Previous Sessions by using the search field for "Find Session" prompts and keeping the native full-window modal compact.
- Added Scratch Pad focus diagnostics to help trace terminal-first-responder focus steals without logging note text.

## 1.0.3 - 2026-04-28

- Added native terminal title bars with rename, fork, reload, sleep, and close actions.
- Added visible native Ghostty scrollbars and disabled middle-click paste in embedded terminals.
- Added workspace configuration for dock name, theme, Tabler icon, and uploaded image.
- Added `ghostex-dev` build/run flavor with separate diagnostics storage and shared workspace/session state.
- Added shared sidebar storage files for projects, previous sessions, and settings outside WKWebView localStorage.
- Added managed native sidebar action sessions with command run indicators and close-on-exit behavior.
- Improved first-prompt auto-title logic so meaningful existing titles are not overwritten.
- Improved session rename modal Enter-key submission.
- Improved IDE attachment settings so Zed and Zed Preview are distinguishable.
- Removed the browser section tab-count badge.
- Removed persistent helper terminal mode in favor of the embedded Ghostty SurfaceView backend.
