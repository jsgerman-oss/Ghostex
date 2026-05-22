Discord: https://discord.gg/xYSBPapM

# Ghostex is the Free & Open Source alternative to Codex App

## Ghostty Terminals with Codex App's Awesome Features = Ghostex!<br />

- Fast & Low RAM usage 
- Embedded Chromium Browser w Devtools and profiles
- Embedded Light Code/MD Files Editor
- Access your sessions with any Agent CLI live from the Android/iOS apps.
- SSH support with live session persistence (zmx/tmux/zellij)
- Native Swift macOS app shell for better performance
- Native Ghostty for best cpu/ram use and compatibility
- Auto sleep unused terminals to save ram (auto-restore when clicked)
- Auto session naming
- Reopening the app always resumes your agent cli sessions
- Light embedded VS Code based editor & git manager & managing PRs with github PR extension.
- T3code Support if you prefer GUI
- The best agent CLI rich prompt editor with Image insert/preview support Press ctrl+g to use it.
- Menu bar working & done indicators and notification sounds for almost all agent clis
- Supports Pets so you can see session status at a glance :)
- Works with all Agent CLIs (Claude Code, Codex CLI, OpenCode, Pi Agent, Gemini, Copilot, etc.)
- Schedule sending messages to agents (more automation features coming soon)
- Way more features to fit here
<br/>

#### Install on macOS using brew or dmg in releases page
###### (Looking for help with Windows & Linux ports)

The same Homebrew command installs the correct Apple Silicon or Intel Mac build automatically.

```bash
brew install --cask maddada/tap/ghostex
```

#### Mobile apps

[![iPhone App in Test Flight](https://img.shields.io/badge/iPhone-Test%20Flight-000000?logo=apple&logoColor=white)](https://discord.gg/xYSBPapM)

[![Download Android APK](https://img.shields.io/badge/Android-APK-3DDC84?logo=android&logoColor=white)](https://github.com/maddada/Ghostex/releases/download/ghostex-android-v1.1.0/ghostex-1.1.0.apk)

- iPhone app is in Test Flight. Join the Discord to get it.
- Android app APK is in GitHub Releases: [ghostex-1.1.0.apk](https://github.com/maddada/Ghostex/releases/download/ghostex-android-v1.1.0/ghostex-1.1.0.apk)
<br />

### Work with tens of agents in multiple projects with ease:

<img width="3322" height="2060" alt="ghostex-main" src="https://github.com/user-attachments/assets/49862e2d-1edd-4647-8161-5afb25ed8341" />

### All Agent CLIs supported (please send an issue or PR for integrating any missing agent cli)

<img width="1664" height="1035" alt="Untitled" src="https://github.com/user-attachments/assets/932497a7-8b68-480f-ae05-13df08571e47" />

<br />

Android and iOS apps for remote controlling ANY Agent CLI running on your mac (live remote control that includes all features):

<img width="250" alt="73681" src="https://github.com/user-attachments/assets/848a2475-a1f0-40f4-9313-c00df1893cbf" />

<br />

### Includes Chromium based embedded browser with Devtools, profiles, and MCP access:

<img width="1000" alt="Ghostex sidebar with terminal and browser panes" src="media/readme/ghostex-browser-pane.png" />

<br />

### Includes embedded VSCode for editing files, checking PRs, and working with git<br />(loaded on demand)

<img width="3327" height="2065" alt="2026-05-08_CleanShot_18-38-12@2x" src="https://github.com/user-attachments/assets/f1cc7d00-7098-44fe-bc29-590ae03ea8e9" />

<br />

## Other useful stuff:
- Built in zmx/tmux/zellij support
  - Can continue via ssh then use `ghostex` or `gtx` cli to attach. Beta but working well already with zmx especially.
- Automations and cross agent messages (coming very soon)
- Better worktrees support coming very soon (Want to nail the UX)
- Prompt to find any past thread in your history with just a few keywords
  - Very useful if you want to continue with an agent that already has context about a complex feature
- Auto sync of the terminal title and status with UI
- Allows multiple panes and multiple groups per project, each with different split/tab layouts
- Can be attached to your IDE: Shows a button on the attached IDE (Zed / VScode) to show Ghostex.
  - Follows your IDE size/position.
  - Project in IDE & Ghostex is mirrored.
  - Hotkey to hide/show.
  - Click on your IDE to hide Ghostex
- Can also integrate with Chrome Canary as the default agentic browser (positions it inside Ghostex and adds it to the sidebar)
  - MCP setting to make Chrome Canary always used by your agent:
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
