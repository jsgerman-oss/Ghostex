## zmux 2.3.0

This minor release improves the 2.x workspace with stronger hotkey editing, richer prompt editing, native runtime fixes, and more predictable sidebar behavior.

- Added a hotkey recorder for Command shortcuts plus direct Split More, Split Less, and single-chord split-count defaults.
- Added opt-in Rich Prompt Editing with Zapet, including Settings UI, in-app Homebrew install routing, and terminal environment setup.
- Added installed-app CLI proxying so terminal commands such as `zmux sessions` run from the app bundle.
- Improved native command execution PATH handling for GUI-launched background commands.
- Improved embedded Ghostty search keyboard behavior, visual centering, and neutral styling.
- Added active-project names in the macOS title bar and better native pane diagnostics.
- Separated project agent launch controls from plain terminal creation, and made Combined mode New Session use the active context.
- Added persistent sidebar collapse state and a setting to show or hide project editor changed-file counts.
- Polished sidebar spacing, session-title truncation, and project editor diff rows.

SHA256: aabfea87f042ab59e1eb8aabd371226108df5a980edccbee80f58b26d7a80d70
