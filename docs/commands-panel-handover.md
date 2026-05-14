# Commands Panel Handover

CDXC:CommandsPanel 2026-05-13-16:25
This document captures the agreed requirements for implementing the project-scoped Commands panel. The goal is to reuse the existing workspace terminal pane, tab, split, drag/drop, and persistence logic while giving command terminals a distinct bottom-panel surface.

## Product Goal

Create a project-scoped Commands panel at the bottom of the app for quick command terminals. It should behave like a separate command surface, but it should not become a separate terminal implementation.

The Commands panel must share as much code as possible with the normal workspace area:

- Same native terminal pane implementation.
- Same session lifecycle where practical.
- Same top tab UI and UX.
- Same pane layout tree model.
- Same tab drag/drop splitting model where applicable.
- Same terminal persistence infrastructure.

## Core Surface Model

Add an explicit surface or role distinction for terminal sessions:

```ts
type TerminalSurface = "workspace" | "commands";
```

Workspace sessions:

- Render in the normal workspace area.
- Appear in the sidebar session list.
- Use the existing workspace pane layout.

Command sessions:

- Render only in the Commands panel.
- Do not appear in the sidebar session list.
- Persist across app restarts.
- Belong to the active project.
- Can be moved from the workspace area by dragging a normal terminal tab down into the Commands panel.

Recommended state shape:

```ts
type CommandsPanelMode = "floating" | "pinned";

type CommandsPanelState = {
  isVisible: boolean;
  mode: CommandsPanelMode;
  heightRatio: number;
  paneLayout?: SessionPaneLayoutNode;
  activeSessionId?: string;
};
```

Store this per project and restore it across restarts.

## Visibility And Mode Rules

`F12` opens the Commands panel for the active project.

If no mode was previously set for that project, default to `pinned`.

The last selected mode must be remembered per project across restarts.

Panel close behavior:

- The panel close button hides the Commands panel.
- Hiding the panel does not kill command terminals.
- Closing individual command tabs kills those terminal sessions.

Important running-terminal rule:

- If the project has running command terminals, keep the command terminal area at the bottom of the screen.
- Running command terminals should push other panels up even if the remembered mode is `floating`.
- In other words, `floating` is for opening/showing the panel without a persistent docked layout, but active command work should remain visible and reserve bottom space.

## Floating Versus Pinned

Pinned mode:

- Commands panel is docked at the bottom.
- It pushes workspace/editor panes up.
- This is the default mode.

Floating mode:

- Commands panel appears from the bottom over the workspace/editor when opened.
- It does not push other panes up when there are no running command terminals requiring persistent visibility.
- If running command terminals exist, the bottom command area still reserves space so output remains watchable.

## Panel Layout And Chrome

Commands panel tabs should stay on top, not on the left.

Use the same tab UI/UX as the normal workspace pane tabs, with only surface-specific tweaks where necessary.

Top-right panel controls:

- Pin/unpin button.
- Close button.

These controls affect the entire Commands panel, not individual command terminal panes.

Do not show the normal per-pane titlebar action cluster in the Commands panel.

The Commands panel should still be visually distinct from the workspace area. Recommended distinctions:

- Stronger top divider/resizer.
- Subtle different panel background.
- Compact panel-level chrome.
- Clear pinned/floating state control.

## Commands Panel Creation

There should be a button for creating a new command terminal in the Commands panel.

Creating a command terminal:

- Creates a normal terminal process/session with `TerminalSurface = "commands"`.
- Adds it to the Commands panel layout.
- Does not add it to the sidebar session list.
- Shows it in the Commands panel tabs.

## Splitting Rules

Commands panel supports vertical-only splitting.

Vertical-only here means left/right splitting inside the Commands panel:

- Drag a command tab to the left side of another command pane/tab to split left.
- Drag a command tab to the right side of another command pane/tab to split right.
- Reuse the same split-drop logic used in the workspace area, constrained to horizontal split direction in the existing `SessionPaneLayoutNode` terminology.

Do not support top/bottom splitting inside the Commands panel for now.

The command pane layout should reuse `SessionPaneLayoutNode`:

```ts
type SessionPaneLayoutNode =
  | { kind: "leaf"; sessionId: string }
  | { kind: "tabs"; sessionIds: string[]; activeSessionId?: string }
  | {
      kind: "split";
      direction: "horizontal" | "vertical";
      children: SessionPaneLayoutNode[];
      ratio?: number;
    };
```

For Commands panel splitting, only allow the direction that creates left/right panes.

## Dragging Between Workspace And Commands

Dragging a workspace terminal tab down into the Commands panel should work.

Expected behavior:

- The session moves from workspace to commands.
- Its surface/role changes from `workspace` to `commands`.
- It is removed from the workspace pane layout.
- It is inserted into the Commands panel layout.
- It stops appearing in the sidebar session list.
- The terminal process should remain the same running terminal when possible.

Dragging from Commands back to workspace can be implemented later, but the model should not block it.

## Editor Interaction

Commands panel should not be closed when the embedded editor opens.

Pinned/running command panel space should remain at the bottom while the editor is visible.

This is a key difference from normal workspace terminals, which can be hidden/replaced by editor surfaces.

## Implementation Guidance

Avoid building a second terminal system.

Preferred approach:

1. Add terminal surface/role metadata.
2. Filter command sessions out of sidebar session-card rendering.
3. Add per-project Commands panel state and persistence.
4. Render a second native terminal layout surface for commands below the workspace/editor.
5. Reuse the existing tab component/metrics/hit testing with a `surface` parameter.
6. Reuse pane layout mutation helpers with command-specific constraints.
7. Route `F12` to open the current project Commands panel in the last remembered mode, defaulting to pinned.

Watch for these likely integration points:

- Session creation path.
- Session restore path.
- Sidebar session filtering.
- Native layout bridge.
- AppKit terminal workspace renderer.
- Tab drag/drop split target calculation.
- Embedded editor layout and bottom reserved-space calculation.

## Non-Goals For First Pass

- No left-side command tabs.
- No separate terminal renderer.
- No sidebar cards for command terminals.
- No top/bottom splitting inside the Commands panel.
- No killing command terminals when hiding the panel.
- No need to implement drag from Commands back to workspace in the first pass, as long as the model allows it later.

