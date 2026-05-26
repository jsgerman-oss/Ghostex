# OS Integration PRD

<!-- CDXC:OSIntegration 2026-05-25-11:33: Ghostex should become a first-class macOS editor and terminal integration without taking over user defaults on install. The app registers as an available handler, but default editor, terminal-link, and script-runner changes require explicit user action in OS Integration settings. -->

## Goal

Make Ghostex usable as the user's macOS editor and terminal target while preserving the existing sidebar model:

- Folders opened with Ghostex become Projects.
- Project-backed files open in the Project's embedded Code editor.
- Loose files that should not create broad Projects open under Quick.
- Terminal and script launches create projectless Quick terminals.
- macOS default changes are opt-in from Settings.

This work should make Ghostex feel comparable to VS Code for `Open With`, Finder, CLI path opens, and default-editor workflows, while keeping Ghostex-specific terminal behavior explicit and safe.

## Current Context

Quick is already the user-facing area for projectless sessions, while the implementation still models these as chat projects. The current Quick header exposes Quick Browser Tab and Quick Terminal actions.

Projects already support the desired folder behavior: adding a project prepends it to the Projects list, focuses it, and creates a terminal when empty.

Embedded Code is currently project-owned, not a normal sidebar session card. Quick editor support therefore needs a first-class Quick editor model rather than pretending loose files are normal terminal sessions.

The current default editor setting is external-command oriented and defaults to VS Code. The macOS app bundle currently does not declare document types or URL schemes, and the app's command-line argument handling treats non-`-psn_*` args as CLI commands rather than file/folder open requests.

## Product Requirements

### OS Integration Settings

Add a dedicated Settings tab named `OS Integration`.

The first version must include:

- A "Set as Default Editor" action for curated source/text file types.
- A "Set as Default Terminal Links" action for Ghostex terminal URL handling.
- A "Set as Default Script Runner" action for script file types.
- A "Set All" action that runs the editor, terminal-link, and script-runner default actions.
- Diagnostics showing whether Ghostex is registered as an available handler and what defaults are currently set.
- Help text or examples for the supported CLI commands.

Ghostex should register as an available handler on install/build so it can appear in Finder's "Open With" and macOS handler lists. Registration alone must not change the user's defaults. The Settings actions are the explicit opt-in point for changing defaults.

Show a one-time onboarding prompt after the first successful app launch. The prompt must be dismissible forever and should point users to the OS Integration settings. It must not change defaults by itself.

When testing via `bun run start` against main Ghostex, default-setting controls are allowed to mutate real macOS defaults.

### macOS Handler Registration

The app bundle should register:

- Broad editable-file support so Ghostex appears as an "Open With" option for files a user might reasonably edit.
- Curated source/text types for the explicit "Set as Default Editor" action.
- Script file support for `.command`, `.tool`, and `.sh`.
- The `ghostex://` URL scheme.

Do not register `gx://` in the first version.

Do not claim common external terminal schemes such as `ssh://` or `telnet://` in the first version.

Relevant macOS mechanisms:

- `CFBundleDocumentTypes` for document/file handlers.
- `CFBundleURLTypes` for URL scheme registration.
- `NSApplicationDelegate` open-file/open-url handlers for Launch Services intake.
- `NSWorkspace` default-application APIs for explicit default changes.

### CLI Commands

Support these commands:

```sh
ghostex open <path...>
ghostex o <path...>
ghostex edit [--wait] <file...>
ghostex e [--wait] <file...>
ghostex terminal [--cwd <path>] [--title <title>] [-- <command...>]
ghostex t [--cwd <path>] [--title <title>] [-- <command...>]
```

Also support VS Code-like bare path opens:

```sh
ghostex ./file.txt
ghostex ./folder
```

Bare `ghostex` with no arguments must keep the existing behavior of listing live sessions.

If the first argument is not a known command, treat it as a bare path only when it exists on disk. Otherwise keep the existing unknown-command error so CLI typos are visible.

File opens must support VS Code-style line and column syntax:

```sh
ghostex edit file.ts:12
ghostex edit file.ts:12:3
ghostex edit --goto file.ts:12:3
ghostex file.ts:12:3
```

`ghostex edit --wait <file>` must block until the specific opened editor item/tab is closed. It must not wait for the whole Ghostex window or app to close.

### Path Classification

Every opened path is classified independently, including multi-file Finder or CLI opens.

Folder rules:

- Any folder opened directly with Ghostex becomes a Project.
- If the folder is inside a git worktree, open the git root as the Project.
- If the folder is not inside git, open the folder itself as the Project.
- Do not warn or block broad direct folder opens such as `~`; opening a folder is explicit user intent.

File rules:

- If the file is inside a git worktree, open the git root as a Project and open the file in that Project's embedded Code editor.
- If the file is not in git, use the file's parent folder as the Project candidate.
- If the parent folder is safe, open that folder as a Project and open the file in that Project's embedded Code editor.
- If the parent folder is too broad, open the file as a Quick editor item in the shared Quick Code editor.

Project-backed files must not appear as separate sidebar rows. They open as tabs in the Project's embedded Code editor. Multiple files resolving to the same Project should use one Project editor instance with multiple file tabs.

Loose Quick files should appear as one sidebar row per file. Those rows all target one shared Quick Code editor webview.

### Broad Parent Folder Guard

The broad-folder guard applies only when deriving a Project candidate from a file open. It does not apply to direct folder opens and does not apply when a git worktree root is found.

Use this denylist for non-git file parent candidates:

- `/`
- `/Users`
- User home directory, for example `/Users/madda`
- `~/Desktop`
- `~/Downloads`
- `~/Documents`

Also use a 10,000 recursive-file threshold with early stopping. The count should exclude gitignored files when inside a git repository. For non-git folders, use recursive early-stop counting. The threshold is for deciding whether a non-git parent folder is too broad to auto-add as a Project.

If a file's parent folder is denied or exceeds the threshold, route that file to Quick.

### Quick Editor Model

Replace the product model of Quick as "chat" with an explicit Quick model:

```ts
isQuick: true
quickKind: "terminal" | "browser" | "editor"
```

Keep reading legacy `isChat: true` records for migration compatibility. Normalize legacy terminal-like chat records to `isQuick: true` and `quickKind: "terminal"` where safe. New writes should use `isQuick` and `quickKind`.

Loose Quick editor rows:

- Show one row per opened loose file.
- Use the filename as the primary title.
- Show the original path as secondary text, hover text, or details.
- Mark the row as missing if the original file is moved or deleted while open.
- Keep missing rows visible until the user closes them.

Shared Quick Code editor:

- Use one embedded Code webview for all loose Quick files.
- Clicking a Quick file row focuses the shared editor and activates that file's tab.
- Closing a Quick file row closes that file tab.
- If no Quick files remain, close or sleep the shared Quick Code editor.
- `ghostex edit --wait` for a Quick file resolves when that specific Quick row/tab closes.

Quick Code workspace root:

- Root the shared Quick Code editor at `~/.ghostex/quick-files`.
- Mirror each original file's absolute path under that root with symlinks.
- Example: `/Users/madda/Downloads/a.txt` maps to `~/.ghostex/quick-files/Users/madda/Downloads/a.txt`.
- Reuse an existing symlink if it points to the same real target.
- Replace a stale or different symlink at the mirrored path.
- Remove the symlink when the corresponding loose Quick file row closes.

Do not copy files into `~/.ghostex/quick-files`; edits must affect the original file.

### Terminal Behavior

`ghostex terminal` creates a projectless Quick terminal.

Supported options:

- `--cwd <path>` sets the terminal working directory.
- `--title <title>` sets the Quick terminal/sidebar title.
- `-- <command...>` runs a command in the terminal.

The `ghostex://terminal?...` URL should map to the same behavior where possible.

This feature is Ghostex's supported terminal integration surface. It is not intended to replace every macOS app that hardcodes Terminal.app, iTerm, or Ghostty.

### Script File Behavior

When a `.command`, `.tool`, or `.sh` file is opened with Ghostex, never run it immediately.

Show a dialog with these choices:

- Run
- Edit
- Cancel

Run:

- Creates a Quick terminal.
- Uses the script's containing folder as `cwd`.
- If the script has the executable bit, run it as `./script-name`.
- If the script is not executable, run it through the user's shell.

Edit:

- Uses the normal file-open classification rules.
- This means git/project files open in the Project editor and broad loose files open in Quick Code.

Cancel:

- Does nothing.

Do not add "Always Run" in the first version.

### Curated Default Editor Types

The "Set as Default Editor" action should set Ghostex as default for a broad curated list of common source/text extensions. The exact first implementation list can be adjusted during implementation, but it should include categories like:

- Plain text and markdown: `.txt`, `.md`, `.markdown`
- Config/data: `.json`, `.jsonc`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env`, `.xml`, `.csv`
- Web: `.html`, `.css`, `.scss`, `.js`, `.jsx`, `.ts`, `.tsx`
- Shell/scripts: `.sh`, `.bash`, `.zsh`, `.fish`
- Common languages: `.py`, `.rb`, `.go`, `.rs`, `.swift`, `.java`, `.kt`, `.c`, `.h`, `.cpp`, `.hpp`, `.cs`, `.php`, `.lua`, `.sql`

Ghostex should still register broad editable-file support so users can manually choose Ghostex in Finder's "Open With" / Get Info for additional file types, similar to VS Code.

## Non-Goals

- Do not automatically take over editor, terminal, or script defaults on install.
- Do not claim `ssh://`, `telnet://`, or other common terminal URL schemes in the first version.
- Do not create one Code webview per loose Quick file.
- Do not show project-backed opened files as separate sidebar rows.
- Do not run script files without a user confirmation dialog.
- Do not make direct broad folder opens route to Quick; direct folder opens always become Projects.

## Implementation Touchpoints

Expected areas of change:

- `native/macos/ghostexHost/AppInfo.plist` and native project config for document and URL declarations.
- `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift` for Launch Services open-file/open-url intake, script dialog, and default-setting calls.
- `native/macos/ghostexHost/Sources/ghostexHost/main.swift` so existing-path bare args can route to open behavior instead of unknown CLI commands.
- `native/macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift` for new host/sidebar messages.
- `scripts/ghostex-cli.mjs` and tests for `open`, `o`, `edit`, `e`, `terminal`, `t`, bare existing paths, VS Code-style line/column parsing, and `--wait`.
- `native/sidebar/native-sidebar.tsx` for path classification, Quick model migration, Project editor opens, Quick editor rows, Quick terminal creation, wait-token lifecycle, and symlink cleanup.
- `shared/session-grid-contract-sidebar.ts` and sidebar UI files for explicit Quick item kinds.
- `shared/ghostex-settings.ts`, settings UI, and tests for the OS Integration tab and onboarding state.

## Acceptance Criteria

- `ghostex` with no arguments still lists sessions.
- `ghostex open /path/to/folder`, `ghostex o /path/to/folder`, and `ghostex /path/to/folder` add/focus the folder as a Project.
- Opening a folder inside a git worktree opens the git root as a Project.
- Opening a file inside a git worktree opens the git root as a Project and focuses the file in embedded Code.
- Opening multiple files handles each file independently and groups files that resolve to the same Project into one Project editor instance.
- Opening a loose file whose parent is broad opens a Quick editor row and the shared Quick Code editor.
- Quick editor symlinks are created under `~/.ghostex/quick-files`, reused when valid, replaced when stale, and removed when the Quick row closes.
- `ghostex edit --wait file` exits only after that file's editor item/tab closes.
- `ghostex terminal --cwd /tmp --title Scratch -- echo hi` creates a Quick terminal rooted at `/tmp` and runs the command.
- Opening a script file shows Run, Edit, Cancel and does not execute until Run is selected.
- OS Integration settings can set editor, terminal-link, script-runner, or all defaults explicitly.
- Ghostex appears as an available Open With option for broad editable files without changing defaults on install.

## Verification Plan

Use main Ghostex via:

```sh
bun run start
```

Verify CLI behavior with the bundled/local CLI paths used by the running main app.

Verify macOS behavior from:

- Finder "Open With".
- Finder Get Info default app controls.
- `open -a Ghostex <file-or-folder>` where applicable.
- `ghostex://open?...` and `ghostex://terminal?...` URLs.
- Settings > OS Integration default-setting buttons.

Because default-setting controls are allowed to mutate real macOS defaults during `bun run start` testing, manual verification should record which defaults were changed and confirm reset behavior where possible.
