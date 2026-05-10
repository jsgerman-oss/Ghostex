## The best parts of Ghostty & Codex App = Zmux!<br />
### Fully-featured Native Agent CLIs Manager<br />Embedded Browser | Advanced Agents Support | Fast & Lower RAM <br /><br />

#### Install on macOS using brew or dmg in releases page
###### (Looking for help with dev/testing for Windows & Linux ports)

```bash
brew install --cask maddada/tap/zmux
```


<br />

### Work with tens of agents in multiple projects easily:

<img width="1295" alt="ZMUX simplified sidebar with agent sessions" src="media/readme/zmux-simplified-sidebar.png" />

<br />

### Includes Chromium based embedded browser with Devtools, profiles, and MCP access:

<img width="1000" alt="ZMUX sidebar with terminal and browser panes" src="media/readme/zmux-browser-pane.png" />

<br />

### Includes embedded VSCode for editing files, checking PRs, and working with git<br />(loaded on demand)

<img width="3327" height="2065" alt="2026-05-08_CleanShot_18-38-12@2x" src="https://github.com/user-attachments/assets/f1cc7d00-7098-44fe-bc29-590ae03ea8e9" />

<br />

## Best features:

- Native swift macOS app for better performance
- Native Ghostty for best cpu/ram use and compatibility
- Inspired by Codex App's UX
- Embedded browser is chromium not webkit (unlike cmux). Includes devtools & profiles!
- Auto sleep unused terminals to save ram (auto-restore when clicked)
- Auto session naming for Codex/Claude/Pi/Gemini/Copilot cli sessions (more soon)
- Reopening the app always resumes your agent cli sessions
- Light embedded VS Code based editor & git manager & managing PRs with github PR extension.
- The best agent CLI rich prompt editor included! Press ctrl+g in Claude Code/Codex CLI to use it!
- Menu bar working & done indicators and notification sounds for almost all agent clis
- Embedded T3code
- Integrations for all the popular Agent CLI 

---

## Other useful stuff:
- Prompt to find any past thread in your history with just a few keywords.
  - Very useful if you want to continue with an agent that already has context about a complex feature
- Auto sync of the terminal title and status with UI
- Allows up to 3x3 split and multiple groups per project each with different split

---

## Even more useful features:

### Can be attached to your IDE: Shows a button on the attached IDE (Zed / VScode) to show zmux.

- Follows your IDE size/position.
- Project in IDE & zmux is mirrored.
- Hotkey to hide/show.
- Click on your IDE to hide zmux

### Can also integrate with Chrome Canary as the default agentic browser (positions it inside zmux and adds it to the sidebar)

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
