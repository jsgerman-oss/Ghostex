## The best parts of Ghostty & Codex App = Ghostex!<br />

- T3code Support
- Agent CLIs Manager
- Embedded Chromium Browser
- Fast & Low RAM usage

#### Install on macOS using brew or dmg in releases page
###### (Looking for help with dev/testing for Windows & Linux ports)

The same Homebrew command installs the correct Apple Silicon or Intel Mac build automatically.

```bash
brew install --cask maddada/tap/ghostex
```
<br />

### Work with tens of agents in multiple projects with ease:

<img width="3324" height="2058" alt="image" src="https://github.com/user-attachments/assets/a65dbb58-b5c8-41c6-94a1-d9ecef370077" />

### All Agent CLIs supported (please send an issue or PR for integrating any missing agent cli)

<img width="1664" height="1035" alt="Untitled" src="https://github.com/user-attachments/assets/932497a7-8b68-480f-ae05-13df08571e47" />

<br />

### Includes Chromium based embedded browser with Devtools, profiles, and MCP access:

<img width="1000" alt="Ghostex sidebar with terminal and browser panes" src="media/readme/ghostex-browser-pane.png" />

<br />

### Includes embedded VSCode for editing files, checking PRs, and working with git<br />(loaded on demand)

<img width="3327" height="2065" alt="2026-05-08_CleanShot_18-38-12@2x" src="https://github.com/user-attachments/assets/f1cc7d00-7098-44fe-bc29-590ae03ea8e9" />

<br />

## Best features:

- Native macOS app for better performance
- Native Ghostty for best cpu/ram use and compatibility
- Native terminal panes preserve Ghostty-style scrollback, scrollbars, and trackpad momentum inside the app.
- The same Homebrew install command automatically selects Apple Silicon or Intel Mac builds.
- The app installs both `ghostex` and `gtx` CLI commands through Homebrew for listing, attaching, waking, focusing, and sleeping sessions.
- Inspired by Codex App's UX
- Embedded browser is chromium not webkit (unlike cmux). Includes devtools & profiles!
- Auto sleep unused terminals to save ram (auto-restore when clicked)
- Sleeping sessions restore into the active tab group so your current split layout stays intact.
- Auto session naming for Codex/Claude/Pi Agent/Gemini/Copilot/Factory Droid/Grok Build cli sessions (more soon)
- New sessions use compact `g-MMDD-HHMMSS` labels that stay readable in Ghostex, tmux, zmx, and zellij.
- Reopening the app always resumes your agent cli sessions
- Light embedded VS Code based editor & git manager & managing PRs with github PR extension.
- The best agent CLI rich prompt editor included! Press ctrl+g in Claude Code/Codex CLI to use it!
- Rich Prompt Editing with Zapet can be enabled from Settings and installed from Homebrew inside the app.
- Hotkeys use a recorder UI with direct split controls for creating real sideways and downward panes, and directional pane focus uses `Cmd+Alt+Arrow` so normal text navigation stays intact.
- The installed Ghostex app also proxies terminal CLI commands such as `ghostex sessions`; `gtx sessions` is the short alias.
- The macOS title bar follows the active project, and project headers now separate agent launch from plain terminal creation.
- The native titlebar includes Agents, Code, Git, and Project modes for switching workspace surfaces without crowding the sidebar, with a visible active-pill transition between modes.
- Project workspace controls include clearer titlebar modes, improved project panel behavior, and an easier empty-project first-terminal flow.
- Combined mode's top row creates a new session in the active context, with chat creation kept in the Chats section.
- The reference sidebar includes a combined-only project layout, searchable settings sections, improved command panel controls, and cleaner Previous Sessions rows.
- Tips & Tricks is available inside Ghostex with quick pages for workspace basics, agents, actions, Codex setup, and remote access.
- Sidebar action buttons always use explicit configurable icons, with a searchable icon picker and a sensible Play default for new actions.
- Default agent picker order keeps the daily launch engines together: T3 Code, Codex, Claude, Pi Agent, OpenCode, Gemini, Copilot, Factory Droid, and Grok Build.
- Project headers show git diff stats directly, keeping project groups compact while still exposing changed-file context.
- Pane overflow actions include Rotate Panes and Merge All Tabs for reorganizing split workspaces in place.
- Workspace pane tabs keep readable widths and scroll horizontally when groups become too narrow.
- Agents Hub loads real local agent files, supports in-place saving, and can open profile/config paths from the app.
- Agents Hub profile tooltips show structured profile labels, source paths, target paths, and Finder actions for easier local agent configuration review.
- Floating prompt editing uses a resizable Monaco pane with save/cancel handling from Ctrl+G.
- Generated session titles avoid ellipses so sidebar cards can truncate visually while hover tooltips keep the full title.
- Persistence-backed tmux, zmx, and zellij sessions keep agent icons clean while still exposing provider metadata for attach commands and tooltips.
- Reference-sidebar primary labels keep descenders visible in compact 34px rows.
- The floating pet overlay shows active session messages and can focus the exact session when clicked.
- The titlebar pet button toggles the floating pet overlay without opening Settings.
- Sidebar collapse state persists locally, project editor rows can hide or show changed-file counts from Settings, and active session cards can hide Last Active timestamps.
- Previous Sessions focuses on agent-session restore by hiding browser page history from the modal.
- Next Tab and Previous Tab follow the same sorted and collapsed session order visible in the sidebar.
- Provider-backed tmux, zmx, and zellij terminal panes show their persistence context in-pane and announce it when a new persisted session starts.
- Native diagnostics capture app activation, pane-tab geometry, and browser-pane layout details for focus and resize troubleshooting.
- Menu bar working & done indicators and notification sounds for almost all agent clis
- Embedded T3code
- Integrations for all the popular Agent CLI

---

## Other useful stuff:
- Built in zmx/tmux/zellij support
  - Can continue via ssh then use `ghostex` or `gtx` cli to attach. Beta but working well already with especially zmx.
- Automations and cross agent messages (coming very soon)
- Better worktrees support coming very soon - Want to nail the UX
- Prompt to find any past thread in your history with just a few keywords
  - Very useful if you want to continue with an agent that already has context about a complex feature
- Auto sync of the terminal title and status with UI
- Allows multiple panes and multiple groups per project, each with different split/tab layouts

---

## Even more useful features:

### Can be attached to your IDE: Shows a button on the attached IDE (Zed / VScode) to show Ghostex.

- Follows your IDE size/position.
- Project in IDE & Ghostex is mirrored.
- Hotkey to hide/show.
- Click on your IDE to hide Ghostex

### Can also integrate with Chrome Canary as the default agentic browser (positions it inside Ghostex and adds it to the sidebar)

#### MCP setting to make Chrome Canary always used by your agent:

1. Ask the agent to use "Chrome Devtools MCP"
2. Enable remote debugging on Chrome Canary
3. Set your mcp to use canary channel:

##### For Claude Code:

~/.claude.json

```
{
  ...
  "mcpServers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--channel=canary",
        "--autoConnect"
      ],
      "env": {}
    },
    ...
  },
  ...
```

##### For Codex:

~/.codex/config.toml

```
[mcp_servers.chrome-devtools]
command = "npx"
enabled = true
args = [ "chrome-devtools-mcp@latest", "--auto-connect", "--channel=canary" ]
```


## Dev Setup With Ghostty

<!--
CDXC:NativeGhosttyBuild 2026-05-15-16:07:
Developer setup must make the Ghostty source boundary explicit: Ghostex embeds and links a sibling Ghostty checkout but does not modify Ghostty source.
The default local build path expects the Ghostty repository to be cloned beside this project in a folder named `ghostty`.
-->

Ghostex embeds Ghostty by compiling and linking against a local Ghostty checkout.
It does not modify Ghostty's source. You only need to clone the Ghostty repo next
to this project's repo in a folder named `ghostty` so the native macOS build can
find `GhosttyKit.xcframework`, Ghostty Swift sources, and generated Ghostty
resources.

Clone both repositories into the same parent directory and keep the Ghostty
folder named `ghostty`:

```bash
mkdir -p ~/dev/ghostex-repos
cd ~/dev/ghostex-repos
git clone https://github.com/maddada/ghostex.git ghostex
git clone https://github.com/ghostty-org/ghostty.git ghostty
```

Build Ghostty's native macOS framework first:

```bash
cd ghostty
env DEVELOPER_DIR=/Library/Developer/CommandLineTools \
  SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \
  GHOSTTY_METAL_DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  zig build -Demit-xcframework -Dxcframework-target=native -Demit-macos-app=false
```

Then build or run ghostex:

```bash
cd ../ghostex
bun run build
```

If the Ghostty checkout is not beside `ghostex` or is not named `ghostty`, set
`GHOSTTY_ROOT` explicitly:

```bash
GHOSTTY_ROOT=/path/to/ghostty bun run build
```
