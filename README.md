## The best parts of Ghostty & Codex App = Ghostex!<br />
### Fully-featured Native Agent CLIs Manager<br />Embedded Browser | Advanced Agents Support | Fast & Lower RAM <br /><br />

<!--
CDXC:Branding 2026-05-12-07:35
The public product name is Ghostex. The repository folder, code identifiers,
bundle ids, storage paths, and historical release assets can keep zmux as an
internal implementation name, but user-facing app and CLI copy should say
Ghostex. The public CLI commands are `ghostex` and the short alias `gtx`.
-->

#### Install on macOS using brew or dmg in releases page
###### (Looking for help with dev/testing for Windows & Linux ports)

```bash
brew install --cask maddada/tap/ghostex
# The existing cask name remains accepted too:
brew install --cask maddada/tap/zmux
```
<br />

### Work with tens of agents in multiple projects with ease:

<img width="3324" height="2058" alt="image" src="https://github.com/user-attachments/assets/a65dbb58-b5c8-41c6-94a1-d9ecef370077" />

### All Agent CLIs supported (please send an issue or PR for integrating any missing agent cli)

<img width="1664" height="1035" alt="Untitled" src="https://github.com/user-attachments/assets/932497a7-8b68-480f-ae05-13df08571e47" />

<br />

### Includes Chromium based embedded browser with Devtools, profiles, and MCP access:

<img width="1000" alt="Ghostex sidebar with terminal and browser panes" src="media/readme/zmux-browser-pane.png" />

<br />

### Includes embedded VSCode for editing files, checking PRs, and working with git<br />(loaded on demand)

<img width="3327" height="2065" alt="2026-05-08_CleanShot_18-38-12@2x" src="https://github.com/user-attachments/assets/f1cc7d00-7098-44fe-bc29-590ae03ea8e9" />

<br />

## Best features:

- Native macOS app for better performance
- Ships native Apple Silicon and Intel macOS builds through GitHub Releases, Sparkle updates, and Homebrew.
- Native Ghostty for best cpu/ram use and compatibility
- Inspired by Codex App's UX
- Embedded browser is chromium not webkit (unlike cmux). Includes devtools & profiles!
- Auto sleep unused terminals to save ram (auto-restore when clicked)
- Auto session naming for Codex/Claude/Pi/Gemini/Copilot cli sessions (more soon)
- Reopening the app always resumes your agent cli sessions
- Light embedded VS Code based editor & git manager & managing PRs with github PR extension.
- The best agent CLI rich prompt editor included! Press ctrl+g in Claude Code/Codex CLI to use it!
- Rich Prompt Editing with Zapet can be enabled from Settings and installed from Homebrew inside the app.
- Hotkeys use a recorder UI with direct split controls for creating real sideways and downward panes.
- The installed Ghostex app also proxies terminal CLI commands such as `ghostex sessions`; `gtx sessions` is the short alias.
- The macOS title bar follows the active project, and project headers now separate agent launch from plain terminal creation.
- Combined mode's top row creates a new session in the active context, with chat creation kept in the Chats section.
- The reference sidebar includes a combined-only project layout, searchable settings sections, improved command panel controls, and cleaner Previous Sessions rows.
- Agents Hub loads real local agent files, supports in-place saving, and can open profile/config paths from the app.
- Floating prompt editing uses a resizable Monaco pane with save/cancel handling from Ctrl+G.
- The floating pet overlay shows active session messages and can focus the exact session when clicked.
- Sidebar collapse state persists locally, and project editor rows can hide or show changed-file counts from Settings.
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


## Dev Setup With The zmux Ghostty Fork

Clone both repositories into the same parent directory and keep the Ghostty
folder named `ghostty`:

```bash
mkdir -p ~/dev/ghostex-repos
cd ~/dev/ghostex-repos
git clone https://github.com/maddada/ghostex.git ghostex
git clone https://github.com/maddada/ghostty.git ghostty
```

Build Ghostty's native macOS framework first:

```bash
cd ghostty
env DEVELOPER_DIR=/Library/Developer/CommandLineTools \
  SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \
  GHOSTTY_METAL_DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  zig build -Demit-xcframework -Dxcframework-target=native -Demit-macos-app=false
```

Then build or run zmux:

```bash
cd ../ghostex
bun run build
```

If the Ghostty checkout is not beside `ghostex` or is not named `ghostty`, set
`GHOSTTY_ROOT` explicitly:

```bash
GHOSTTY_ROOT=/path/to/ghostty bun run build
```
