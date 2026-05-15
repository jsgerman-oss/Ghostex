# Changelog

## 2.5.1 - 2026-05-15

<!-- CDXC:Distribution 2026-05-15-08:42: Release notes for 2.5.1 must cover
all user-facing commits after v2.5 so GitHub, Sparkle, and Homebrew metadata
describe the same dual-architecture Ghostex build, titlebar pet control,
action icon defaults, Previous Sessions polish, workspace focus behavior, and
architecture-aware local launch behavior. -->

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

<!-- CDXC:Distribution 2026-05-14-19:06: Release notes for 2.5.0 must use the
Ghostex public name and cover the rename, reference sidebar workflows, command
panel work, native pane/runtime stability, pet overlay routing, terminal
scrollbar restoration, and arm64 public release metadata. -->

<!-- CDXC:Branding 2026-05-12-07:35: Public release notes must describe the
Ghostex rename without rewriting historical zmux entries. Homebrew should use
the `ghostex` cask token as the public install command, while the public CLI
command changes to `ghostex` with `gtx` as the short alias. -->

- Added dual-architecture release pipeline support for separate Apple Silicon and Intel DMGs, separate Sparkle feeds, and an architecture-aware Homebrew cask.
- Renamed the public app surface from Zmux to Ghostex while keeping internal repository, code, storage, bundle id, and historical asset names under `zmux`.
- Changed the public CLI command to `ghostex`, with `gtx` as the short alias, and intentionally stopped documenting `zmux` as a CLI compatibility command.
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

<!-- CDXC:Distribution 2026-05-10-16:56: Release notes for 2.3.2 must include
macOS session attention banners and project editor diff-row alignment shipped
after v2.3 so GitHub, Sparkle, and Homebrew metadata stay aligned without
editing README. -->

<!-- CDXC:Distribution 2026-05-12-13:09: Version-specific root changelog files
are being retired. Their release summaries and artifact hashes must be kept in
this canonical changelog so deleting the per-version markdown files does not
drop shipped release metadata. -->

This patch release adds session attention notifications and tightens project editor row alignment.

- Added optional macOS attention banners for sessions that need attention, including Settings control, native notification permission handling, click-to-focus routing, and sidebar rate limiting.
- Kept attention notifications separate from completion sounds so users can enable clickable system routing without audible alerts.
- Improved project editor diff-row alignment in the reference sidebar and expanded Storybook fixture coverage for open editor rows with diff stats.

SHA256: `61d2d71547b492eb732483d09193df3cb3de2b475f86f7916f75344d89daf220`

## 2.3.0 - 2026-05-10

<!-- CDXC:Distribution 2026-05-10-14:08: Release notes for 2.3.0 must include
the hotkey recorder, Zapet prompt editing, bundled CLI proxy, native terminal
runtime fixes, persistence recreation behavior, active-project titlebar sync,
project agent/terminal launcher separation, Combined New Session routing,
project editor row preferences, sidebar collapse persistence, sidebar polish,
and README updates shipped after v2.2 so GitHub, Sparkle, and Homebrew metadata
stay aligned. -->

This minor release improves the 2.x workspace with stronger hotkey editing, richer prompt editing, native runtime fixes, and more predictable sidebar behavior.

- Added a shortcut recorder for hotkey settings so Command chords are captured directly instead of typed into text fields.
- Updated split-count shortcuts to single-chord defaults and added direct Split More / Split Less actions for faster workspace layout control.
- Added opt-in Rich Prompt Editing with Zapet, including Settings UI, native install routing, environment injection, and zsh startup shims that keep Zapet in charge after shell profiles load.
- Added installed-app CLI proxying so terminal commands such as `zmux --help` and `zmux sessions` run the bundled Node CLI before the macOS app starts.
- Improved native command execution by normalizing GUI-launched process `PATH` values so background commands can find common developer tools.
- Improved terminal search keyboard behavior, centering, and neutral styling for embedded Ghostty panes.
- Added active-project names to the macOS title bar while keeping chat workspaces labeled as Zmux.
- Added focused native pane-reorder diagnostics and rejected stale title-bar hits so bottom-edge terminal selection does not become pane dragging.
- Changed provider-backed terminal recreation so reload, wake, restore, and previous-session restore follow the current Settings provider while attach-command inspection still uses stored provider metadata.
- Separated project agent launching from plain terminal creation so project headers have distinct agent and terminal controls.
- Changed the Combined sidebar top row to New Session so it creates in the active project/chat context while chat creation stays in the Chats section.
- Added persistent sidebar collapse state and a Settings toggle for showing project editor changed-file counts.
- Polished sidebar spacing and session-title truncation so reference layout controls and session cards scan more cleanly.
- Updated README development setup and feature wording for the current Ghostty fork and 2.3 workflow.

SHA256: `aabfea87f042ab59e1eb8aabd371226108df5a980edccbee80f58b26d7a80d70`

## 2.2.0 - 2026-05-09

<!-- CDXC:Distribution 2026-05-09-22:23: Release notes for 2.2.0 must describe
the unified settings surface, menu bar status indicators, editor-row
diagnostics, dev startup split, and README updates shipped after v2.1 so
GitHub, Sparkle, and Homebrew metadata stay aligned. -->

This minor release tightens the new 2.x interface with the latest workspace, settings, and release workflow polish.

- Added a unified tabbed Settings dialog that brings Settings, Agents, Actions, and Hotkeys into one configuration surface.
- Added lazy `~/.zmux` folder usage stats and an Open zmux Folder action from Settings.
- Added menu bar session status indicators while making floating desktop indicators independently optional.
- Renamed orange agent status from running to working so agent activity is distinct from live runtime state.
- Improved project editor rows so opening and error states stay visible, show diagnostics, and can be retried instead of disappearing.
- Improved session card and Previous Sessions row chrome with hover close controls, clearer last-active placement, and refined editor diff labels.
- Added a separate `start:dev` app startup path for `zmux-dev` so normal `bun s` keeps release-like behavior.
- Updated README presentation and feature wording for the current Zmux positioning.

SHA256: `73340ec06d57c3b16a585ee9c5566513c91fd5e0a6cba9477ae5982a122521c9`

## 2.1.0 - 2026-05-08

<!-- CDXC:Distribution 2026-05-08-18:04: Release notes for 2.1.0 must keep
the 2.x messaging focused on the full UI refresh plus stability/performance
work, while also calling out the macOS app icon shipped after v2.0. -->

- Continued the 2.x UI refresh messaging: zmux now presents the redesigned simplified Codex-style workspace, refreshed project groups, action controls, tooltips, session cards, settings surfaces, and updated screenshots.
- Continued the 2.x stability and performance focus across native sidebar sync, AppKit relayout avoidance, shared storage writes, diagnostic filtering, and workspace visibility.
- Added the macOS application icon from agent-manager-x so Finder, Dock, app switcher, and signed release builds use the intended branded icon instead of a generic app icon.
- Compiled the icon through Xcode's `AppIcon` asset catalog so signed and notarized release bundles carry the same icon metadata as local builds.

SHA256: `6bbd2a95f1f585df20a2811c8f2cae492ad53492bc13814b4b085c5a906e9ced`

Install with Homebrew: `brew install --cask maddada/tap/zmux`

## 2.0.0 - 2026-05-08

<!-- CDXC:Distribution 2026-05-08-17:16: Release notes for 2.0.0 must emphasize
the full UI refresh plus stability and performance work shipped since v1.4.11
so README, GitHub, Sparkle, and Homebrew metadata describe the same release. -->

- Changed the whole zmux UI around the simplified Codex-style workspace: refreshed top chrome, project groups, action controls, tooltips, session cards, Previous Sessions rows, settings surfaces, icons, and README screenshots.
- Improved workspace stability and performance by suppressing byte-identical native storage writes, skipping metadata-only AppKit relayouts, reducing high-frequency native diagnostics, and filtering noisy T3/focus logs.
- Added native workspace visibility helpers and tests so sidebar/native sync can avoid unnecessary workspace work while preserving visible pane behavior.
- Improved restore and fork actions for native terminal title bars, including Codex and Claude fork command paths.
- Fixed first-prompt auto-rename so meaningful terminal-synced titles are preserved instead of being overwritten by redundant generated rename commands.
- Updated Storybook sidebar scenarios, interaction readiness, and fixtures so visual checks match current local settings and the redesigned sidebar behavior.

SHA256: `da519a720e65a955ce182f0655ba36a6cb02c188aab441142dc2bf9747f70456`

Install with Homebrew: `brew install --cask maddada/tap/zmux`

## 1.4.11 - 2026-05-08

<!-- CDXC:Distribution 2026-05-08-13:47: Release notes for 1.4.11 must include
all commits after v1.4.10 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

- Added reference-style sidebar action flows, modal flows, story fixtures, and Combined layout refinements.
- Added Pi as a supported agent option with icon assets, tests, and agent configuration UI wiring.
- Improved sidebar group, session-card, search, modal, and scroll styling to better match the reference layout.
- Improved native editor pane handling, pane resize routing, T3 diagnostics, and accessibility-permission driven controls.
- Improved floating session status indicators with refined drawing, attention/working visual treatment, and additional settings support.
- Improved session title, activity, rename, and first-prompt metadata handling so loading and restored-title states are more reliable.

## 1.4.10 - 2026-05-08

<!-- CDXC:Distribution 2026-05-08-00:46: Release notes for 1.4.10 must include
all commits after v1.4.9 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

- Added human-facing `zmux` CLI session commands for listing, attaching, resuming, killing, sleeping, waking, and focusing running terminal sessions.
- Added provider-backed attach metadata so tmux, zmx, and zellij sessions keep their stored provider, show sidebar badges, and expose copyable attach commands.
- Added a Settings control for floating session status indicator size, plus updated indicator drawing, tooltip wrapping, and settings-control polish.
- Fixed main window chrome restore so zmux reopens at the prior size, position, and display while avoiding offscreen IDE-attachment coordinates.
- Fixed Find Previous Session routing so the footer button opens the prompt even with an empty modal search field and logs the modal/native bridge path.
- Improved session title sync by rejecting Ghostty ghost placeholder titles and protecting trusted restored titles from automatic rename overwrite.

## 1.4.9 - 2026-05-07

<!-- CDXC:Distribution 2026-05-07-08:01: Release notes for 1.4.9 must include
all commits after v1.4.8 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

- Improved embedded code-server editor panes so VS Code panel/sidebar drag and drop keeps live hover and drop targeting while using CEF.
- Fixed embedded browser/editor pane teardown so closing a pane from the sidebar does not close the top-level app window.
- Improved project editor persistence so VS Code workbench layout survives app restarts without putting code-server into a fresh Chromium profile.
- Improved zmx session persistence so empty sessions attach directly, startup commands run only for new sessions, and inherited zmx session variables do not hijack app-managed names.
- Improved zellij session persistence so generated session names stay within provider limits and new sessions launch under the same name used for restart attach.
- Enlarged README screenshots for clearer GitHub documentation.

## 1.4.8 - 2026-05-06

<!-- CDXC:Distribution 2026-05-06-19:47: Release notes for 1.4.8 must include
all commits after v1.4.7 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

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

<!-- CDXC:Distribution 2026-05-06-03:12: Release notes for 1.4.7 must include
all commits after v1.4.6 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

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

<!-- CDXC:Distribution 2026-05-05-05:01: Release notes for 1.4.6 must include
all commits after v1.4.5 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

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

<!-- CDXC:Distribution 2026-05-05-02:22: Release notes for 1.4.5 must include
all commits after v1.4.4 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

- Added native title-bar split controls for primary Actions and Open In commands while keeping empty title-bar space draggable.
- Added React-rendered title-bar dropdown menus for configured zmux actions and Open In targets, reusing the existing sidebar command and selected-IDE state.
- Improved terminal focus sync so passive layout/status updates no longer steal focus from the terminal or modal the user is actively typing in.
- Improved embedded Ghostty terminal color handling by removing inherited color-disabling environment keys at the native surface boundary.
- Added optional CEF prototype scaffolding for future Chromium browser panes while keeping the default WKWebView build path buildable without the Chromium SDK.

## 1.4.4 - 2026-05-04

<!-- CDXC:Distribution 2026-05-04-16:01: Release notes for 1.4.4 must include
all commits after v1.4.3 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

- Added Combined sidebar mode so native zmux can show one project group per project across all projects, while preserving Separated mode for the previous per-project layout.
- Added a Recent Projects drawer with fuzzy project/path search and startup cleanup for empty combined-mode projects.
- Added project context actions for opening project config, setting project theme, copying the project path, opening the folder in Finder, opening it in the selected IDE, and closing projects into Recent Projects.
- Improved native T3 Code runtime handling so fresh supervised runtimes are retained during startup/auth races, with explicit stop still available for recovery.
- Improved T3 thread changes by creating and syncing sidebar cards when the native host receives thread-change events.
- Fixed sidebar resize drags to use stable window coordinates so the sidebar does not jump while dragging.
- Added color-environment diagnostics for agent launches so monochrome CLI sessions can be traced to inherited terminal environment values.
- Added long-paste rename handling that summarizes pasted session text before syncing the rename into the agent CLI.

## 1.4.3 - 2026-05-03

<!-- CDXC:Distribution 2026-05-03-08:14: Release notes for 1.4.3 must include
all commits after v1.4.2 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

- Added an opt-in Browser Panes mode that opens browser actions as first-class workspace panes instead of Chrome Canary windows.
- Added native browser pane controls for address navigation, reload, DevTools, React Grab, profile selection, and browser-data import messaging.
- Persisted browser pane URLs, favicons, and browser-auto titles so sidebar cards and app restarts reflect the current page.
- Added native pane header drag-to-reorder support across terminal, T3, and browser panes without surfacing hidden sessions.

## 1.4.2 - 2026-05-02

<!-- CDXC:Distribution 2026-05-02-11:33: Release notes for 1.4.2 must call
out the Sparkle build-number fix because installed apps compare
CFBundleVersion when deciding whether a feed item is newer. -->

- Fixed Sparkle update detection by publishing releases with a monotonic `CFBundleVersion` build number.
- Kept the native AppKit pane resizing changes from 1.4.1 available in the update feed.

## 1.4.1 - 2026-05-02

<!-- CDXC:Distribution 2026-05-02-11:16: Release notes for 1.4.1 must include
all commits after v1.4.0 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

- Moved split pane resizing into the native AppKit terminal workspace so Ghostty and WKWebView panes resize from the same layout owner.
- Removed the React workspace resize overlay and tests that no longer apply to native pane sizing.
- Removed whole-cell terminal body stepping so pane chrome and terminal renderer widths stay aligned during native resize.

## 1.4.0 - 2026-05-02

<!-- CDXC:Distribution 2026-05-02-08:37: Release notes for 1.4.0 must include
all commits after v1.3.0 so README, GitHub, Sparkle, and Homebrew release
metadata describe the same shipped behavior. -->

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

<!-- CDXC:Distribution 2026-04-30-03:37: Release notes for 1.3.0 must include
all commits after v1.2.0 so README, GitHub, and Homebrew release metadata
describe the same shipped behavior. -->

- Added Ghostty config actions and a recommended Ghostty config that includes zmux-managed color, cursor, font, scroll, and split-opacity settings.
- Added a cyan Ghostty palette default to improve terminal color readability with the recommended zmux-managed config.
- Added a local agent release skill for repeatable split commits, release notes, GitHub releases, and Homebrew cask publishing.
- Added Generate Name diagnostics across the sidebar, bridge, and controller paths so silent session-name failures are easier to trace.
- Fixed terminal title bars so long titles are measured from raw text and use available pane width before truncating.
- Improved attached IDE refocus timing so zmux resurfaces faster when the IDE is already active or when activation retries succeed quickly.
- Hid bare agent status words such as `Working`, `Done`, `Idle`, `Thinking`, and `Error` from visible terminal titles.

## 1.2.0 - 2026-04-29

<!-- CDXC:Distribution 2026-04-29-09:31: Release notes for 1.2.0 must include
all user-facing commits after v1.1.0 so README, GitHub, and Homebrew release
metadata describe the same shipped behavior. -->

- Added terminal scroll multiplier settings for precision devices and discrete mouse wheels.
- Synced Ghostty mouse-scroll-multiplier values into the shared Ghostty config and reloads scroll-only changes immediately.
- Added native AVFoundation sound playback for completion/action sounds and settings previews, with sound assets bundled in the app.
- Gated non-error native/sidebar diagnostics behind Debugging Mode and reduced high-frequency focus/title logging.
- Improved terminal close cleanup by terminating processes still attached to the closed terminal tty.
- Improved embedded terminal search behavior so Escape closes search before reaching terminal programs.
- Changed embedded terminal cursor rects to use the default pointer cursor instead of always showing the I-beam.

## 1.1.0 - 2026-04-29

<!-- CDXC:Distribution 2026-04-29-08:42: Release notes for 1.1.0 must include
all user-facing commits after v1.0.4 so README, GitHub, and Homebrew release
metadata describe the same shipped behavior. -->

- Added full-window native modals for Find Previous Session and T3 Thread ID entry.
- Improved previous-session search launching by routing modal input through the sidebar/native command bridge.
- Improved T3 session thread binding controls in the native sidebar workflow.
- Fixed agent wrapper process launch so interactive CLIs stay attached to the foreground terminal TTY and receive resize signals.
- Added agent wrapper debug logging for TTY/process details used to diagnose resize and child-process issues.
- Fixed native embedded terminal layout to step pane sizes to whole Ghostty character cells, including configured terminal padding.
- Expanded native terminal resize diagnostics with core Ghostty grid, padding, backing-pixel, and pane geometry metrics.

## 1.0.4 - 2026-04-28

<!-- CDXC:Distribution 2026-04-28-06:27: Release notes for 1.0.4 must be
derived from the commits after v1.0.3 so README, GitHub, and Homebrew users see
the same user-facing feature set. -->

- Added configurable app hotkeys, including native AppKit handling while terminal panes have focus.
- Added saved first-message metadata for agent sessions and a copyable "View 1st Message" modal in active and previous session flows.
- Added terminal workspace background color settings and native pane-gap/background rendering.
- Added automatic Zed workspace syncing after zmux workspace switches, controlled by a setting.
- Added native main-window size persistence between launches.
- Added native terminal search bar rendering and focus preservation improvements for modal workflows.
- Improved sidebar sessions to default to last-activity ordering and keep agent-icon mode blank for iconless sessions until hover.
- Expanded command/workspace icon choices and kept the icon picker search fixed while the icon list scrolls.
- Removed T3 Code from default sidebar agents while preserving existing T3 session recognition.
- Improved Previous Sessions by using the search field for "Find Session" prompts and keeping the native full-window modal compact.
- Added Scratch Pad focus diagnostics to help trace terminal-first-responder focus steals without logging note text.

## 1.0.3 - 2026-04-28

<!-- CDXC:Distribution 2026-04-28-16:00: Release notes must summarize the
user-facing changes added after v1.0.2 so GitHub, README, and Homebrew release
metadata describe the same shipped behavior. -->

- Added native terminal title bars with rename, fork, reload, sleep, and close actions.
- Added visible native Ghostty scrollbars and disabled middle-click paste in embedded terminals.
- Added workspace configuration for dock name, theme, Tabler icon, and uploaded image.
- Added `zmux-dev` build/run flavor with separate diagnostics storage and shared workspace/session state.
- Added shared sidebar storage files for projects, previous sessions, and settings outside WKWebView localStorage.
- Added managed native sidebar action sessions with command run indicators and close-on-exit behavior.
- Improved first-prompt auto-title logic so meaningful existing titles are not overwritten.
- Improved session rename modal Enter-key submission.
- Improved IDE attachment settings so Zed and Zed Preview are distinguishable.
- Removed the browser section tab-count badge.
- Removed persistent helper terminal mode in favor of the embedded Ghostty SurfaceView backend.
