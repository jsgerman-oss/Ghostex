# ZMUX - Native Ghostty Fork with an IDE Integrated Agents Manager

<!-- CDXC:ReadmeUX 2026-05-08-15:54 README presents one unified workspace experience only: new screenshots show the simplified Codex-familiar sidebar, and legacy workspace-layout references are intentionally omitted. -->

<img width="1295" alt="ZMUX simplified sidebar with agent sessions" src="media/readme/zmux-simplified-sidebar.png" />

## Install (macOS only for now. Need help with Windows/Linux ports)

```bash
brew install --cask maddada/tap/zmux
```

## Screenshots:

- Auto naming Codex/Claude/Gemini/Copilot terminal sessions (more soon).
- Auto sync of the terminal title and status with UI.
- Show status indicators for running/done.
- Allows up to 3x3 split and multiple groups per project each with different split.
- A simplified sidebar that feels familiar if you are coming from the Codex app: New chat, Plugins, Actions, Search, Chats, Projects, Recent Projects, and Settings stay in predictable places.

<img width="1000" alt="ZMUX sidebar with terminal and browser panes" src="media/readme/zmux-browser-pane.png" />

## Shows a button on the attached IDE to show zmux.

- Follows your IDE size/position.
- Project in IDE & zmux is mirrored.
- Hotkey to hide/show.
- Click on your IDE to hide zmux

## Best features:

- Native Sparkle updates for macOS releases.
- Version 2.1 ships the branded macOS app icon from agent-manager-x while carrying forward the 2.x UI, stability, and performance refresh.
- Version 2.0 refreshes the whole UI around a simplified Codex-style workspace with cleaner top chrome, project groups, action controls, tooltips, session cards, Previous Sessions rows, settings surfaces, and updated screenshots.
- Version 2.0 includes broad stability and performance work across native sidebar sync, AppKit relayouts, shared storage writes, diagnostic logging, and workspace visibility.
- `zmux sessions`, `zmux attach`, `zmux kill`, `zmux sleep`, `zmux wake`, and `zmux focus` manage live terminal sessions from a shell.
- Simplified Codex-style sidebar layout with refined project groups, search, scroll glow, modal, and session-card styling.
- Native terminal title bars expose improved restore and fork actions, including Codex and Claude fork command support.
- First-prompt auto-renaming preserves meaningful terminal-synced titles instead of sending redundant generated rename commands.
- Pi is available as a supported agent with matching sidebar iconography.
- Native T3 Code panes with managed runtime bootstrap, authenticated thread routing, and remote/browser access links.
- Browser panes open browser actions as workspace panes with address navigation, reload, DevTools, React Grab, profiles, and favicon-backed sidebar cards.
- Embedded code-server editor panes open project-scoped code surfaces with diff stats and native CEF hosting.
- Embedded editor panes preserve VS Code workbench layout across app restarts through persistent Chromium storage.
- Embedded editor panes keep VS Code sidebar and panel drag/drop targets responsive while moving views inside code-server.
- Browser and editor pane close actions stay scoped to the pane instead of closing the top-level app window.
- Project headers can create scoped browser panes and open or close project editor panes directly from the group row.
- Chromium CEF browser panes keep native browser storage and cookies across app restarts.
- Shared Ghostty settings keep terminal configuration consistent between the native host and sidebar settings UI.
- Zellij, tmux, and zmx session persistence providers can keep terminal sessions restart-safe, with stable zellij names, direct zmx attach behavior, sidebar provider badges, and copyable attach commands.
- Sidebar Actions and Open In split controls can run the primary command or show React-rendered dropdown menus for Finder, Visual Studio Code, and Zed.
- Configure Actions modal supports readable project-action rows plus create, edit, and delete flows.
- Settings show modified values with reset-to-default tooltips, floating indicator sizing, and left/right sidebar placement.
- Native floating status indicators show running, attention, and available session counts with click-to-focus routing and selectable size.
- Native editor panes keep resize, accessibility-permission, and T3 diagnostics routed through native controls.
- Main window size, position, and display restore across launches, including IDE-attached sessions.
- The sidebar shows one project group per project, with fuzzy project/path search for Recent Projects.
- Previous Sessions can restore archived terminal sessions with agent identity, first-message metadata, title provenance, favorites, and resume inputs.
- Persistent terminal session providers preserve terminal restore metadata across app restarts.
- Workspace theme menus can set preset themes or custom colors that tint the dock, project headers, and active workspace sidebar surfaces.
- Empty project and Chats groups auto-collapse while empty and expand when sessions appear.
- Sparse sidebars stay pinned instead of rubber-banding when collapsed project lists fit the viewport.
- Chats grouping keeps its synthetic group marker through sidebar store normalization.
- Project context menus can set project theme, copy path, open in Finder, open in a specific IDE, or close a project into Recent Projects.
- Native draggable workspace pane resizing for Ghostty and web panes.
- Native pane header drag-to-reorder across terminal, T3, and browser panes.
- Native T3 runtime retention keeps supervised T3 Code panes alive through startup/auth races and syncs thread changes back into the sidebar.
- Codex first-prompt auto-title hooks are installed into profile homes as well as the default Codex home.
- Native IDE attachment controls with an optional hidden title-bar attach button.
- Standard macOS app menu with Settings and Check for Updates.
- Focus-safe native layout sync avoids stealing typing focus during passive terminal status updates.
- Embedded Ghostty terminals strip inherited color-disabling environment keys so agent CLIs keep color output.
- Agent launch diagnostics record inherited color-related environment values for debugging monochrome CLI sessions.
- Workspace dock highlights the active project and dims inactive project icons.
- Rich text popup (ctrl+g) <- in testing
- T3code sessions support <- in testing
- Much more!

## Integrates with Chrome Canary as the dedicated agent browser (instructions below)

Note: Would be really easy to add a browser like cmux does but it would be Safari which I don't like. Let me know if you really need this. 

### MCP setting to make Chrome Canary always used by your agent:

1. Ask the agent to use "Chrome Devtools MCP"
2. Enable remote debugging on Chrome Canary
3. Set your mcp to use canary channel:

#### For Claude Code:

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

#### For Codex:

~/.codex/config.toml

```
[mcp_servers.chrome-devtools]
command = "npx"
enabled = true
args = [ "chrome-devtools-mcp@latest", "--auto-connect", "--channel=canary" ]
```

## Development

```bash
bun install
bun start
bun storybook
```
