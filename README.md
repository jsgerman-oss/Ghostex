### Please join the Discord to support Ghostex 🙏🏻 https://discord.gg/df7b3G92CS

# Native Ghostty Based Open Source Alternative to Codex App
Low Ram Use. Longer Battery. Desktop/Browser use. All Agent CLIs. T3code. Notifications. Pets.<br/>
Light VScode Embed. Embedded Browser. Rich Prompt Editor. Android & iOS Apps.

> Looking for contributers! Please join the discord if interested!

<img width="3322" height="2060" alt="ghostex-main" src="https://github.com/user-attachments/assets/49862e2d-1edd-4647-8161-5afb25ed8341" />

## Highlights:
### 1. Ghostty Terminals for low RAM usage, longer Battery life, great Agent CLIs stability
### 2. Native swift for all the parts that require it to improve performance and UX
### 3. T3code for GUI panes
### 4. Chromium CEF Browser (Devtools & Profiles)
### 5. Light embedded VS Code (for MD files/Reviewing Code & PRs)
### 6. Android & iOS apps for connecting to sessions easily
### 7. TUI mode (ghostex cli) to connect to all your sessions from any other machine.

### Main Features (not full list, see release notes, I'm adding more daily):
- First-launch preferences help new installs set common defaults before opening sessions
- Git workflows include Sync with Main, split Git menus, prompt-agent PR review, and persistent running toasts for long actions
- First-prompt title generation can auto-name new agent sessions from the opening prompt
- Pinned sessions keep important agent terminals at the top of each project and support `ghostex pin-session`
- Auto-sleep policies now cover idle browser and project panes as well as terminals
- Embedded Chromium Browser w Devtools and profiles
- Embedded Light Code/MD Files Editor
- Access your sessions with any Agent CLI live from the Android/iOS apps
- Built in SSH continuation with live session persistence (zmx/tmux/zellij)
- The best agent CLI rich prompt editor with Image insert/preview support. Press ctrl+g to use it.
- Native Swift macOS app shell for better performance
- Auto sleep unused terminals to save ram (auto-restore when clicked)
- Auto session naming for all popular agents 
- Reopening the app always resumes your agent cli sessions
- Light embedded VS Code based editor & git manager & managing PRs with github PR extension.
- Menu bar working & done indicators and notification sounds for almost all agent clis
- Supports Pets so you can see session status at a glance :)
- Works with all Agent CLIs (Claude Code, Codex CLI, OpenCode, Pi Agent, Gemini, Copilot, etc.)
- Schedule sending messages to agents (more automation features coming soon)
- Way more features to fit here
<br/>

# Installation

###### (Looking for help with Windows & Linux ports)

## macOS (ARM & Intel):
The same Homebrew command installs the correct Apple Silicon or Intel Mac build automatically.

```bash
brew install --cask maddada/tap/ghostex --force
```

Or just download the latest dmg from the releases page

<br />

## Android & iOS apps to Live connect to any Agent CLI sessions remotely

- Android app APK is in GitHub Releases:
<!--
CDXC:AndroidReleaseSurface 2026-05-27-01:52:
The README Android APK badge must use a stable GitHub release asset URL so future Android APK releases can replace the release asset without requiring a README edit for every version bump.
-->
[![Download Android APK](https://img.shields.io/badge/Android-APK-3DDC84?logo=android&logoColor=white)](https://github.com/maddada/Ghostex/releases/download/ghostex-android-latest/ghostex-android.apk)

- iPhone app is in Test Flight. Click here to join the Discord to get it: 
[![iPhone App Discord](https://img.shields.io/badge/iPhone-Test%20Flight-000000?logo=apple&logoColor=white)](https://discord.gg/df7b3G92CS)

<br />

<img width="250" alt="74733" src="https://github.com/user-attachments/assets/e7af9c54-e8ef-4e0b-a934-8b2f9ea56c70" /> <img width="250" alt="74068" src="https://github.com/user-attachments/assets/563dbb8a-5a9d-4db7-8946-1dfc383e09c8" />

<br />

### 2 Rich Prompt Editor Modes! Monaco based & TUI based:

<img width="2048" height="1270" alt="74730" src="https://github.com/user-attachments/assets/a94c00ea-d373-4d72-acc9-b6a16318b4b3" />


<br />

### All Agent CLIs supported (please send an issue or PR for integrating any missing agent cli)

<img width="1664" height="1035" alt="Untitled" src="https://github.com/user-attachments/assets/932497a7-8b68-480f-ae05-13df08571e47" />

<br />

### Includes Chromium based embedded browser with Devtools, profiles, and MCP access:

<img width="1000" alt="Ghostex sidebar with terminal and browser panes" src="media/readme/ghostex-browser-pane.png" />

<br />

### Includes embedded VSCode for editing files, checking PRs, and working with git<br />(loaded on demand)

<img width="3327" height="2065" alt="2026-05-08_CleanShot_18-38-12@2x" src="https://github.com/user-attachments/assets/f1cc7d00-7098-44fe-bc29-590ae03ea8e9" />

<br />

### Notifications for All Agent CLIs. Menu bar indicator and minimal floating numbers also supported.

<img width="331" height="309" alt="2026-05-23_CleanShot_14-26-43" src="https://github.com/user-attachments/assets/ad0f7af5-b0e9-4b24-988c-cb6bf02c6c9f" />

<br/>

## Other useful stuff:
- Built in zmx/tmux/zellij support
  - Can continue via ssh then use `ghostex` or `gx` cli to attach.
- Automations and cross agent messages through Ghostex CLI
- Create worktrees and merge them back easily
- Prompt to find any past thread in your history with just a few keywords
  - Very useful if you want to continue with an agent that already has context about a complex feature
- Auto sync the session's title and status with UI
- Allows multiple panes and multiple groups per project, each with different split/tab layouts
