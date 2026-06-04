You are working in the Ghostex repo. Your goal is to create a separate integration worktree from current `nightly` that can be merged back into `nightly` cleanly, carrying over the useful main-branch work from:

/Users/madda/dev/_active/zmux-set-local-branch-main

Do not run the actual Ghostex app. You may run focused tests/static checks if useful, but do not start the app.

High-level requirement:
Bring over the newly committed `main` work without losing nightly work or reintroducing old architecture. Do not merge `main` wholesale. Do not rebase nightly onto main. Do not copy whole conflicting files from main. Make surgical changes on a new branch/worktree from current `nightly`.

Worktree/branch requirement:
1. Create a new worktree from current `nightly`.
2. Use a clear branch name, for example `integrate-main-carryover-nightly`.
3. Do all edits there.
4. The final result should be mergeable back into `nightly` with minimal/no conflicts.

Main worktree to inspect:
/Users/madda/dev/_active/zmux-set-local-branch-main

Relevant main-only commits to evaluate:
- `85ed74192` Fix mobile CLI session fallback
- `89522ae00` fix(release): verify Sparkle signatures against DMG artifacts
- `dbad91e17` fix(release): use namespace-agnostic Sparkle signature xpath
- `132b89414` feat(native): discover login-shell PATH for native command bridge
- `86697c2a7` feat(sidebar): refresh OpenCode session plugin integration
- README/docs/release metadata commits after the split

Important architecture rule:
Nightly moved ownership toward `gxserver`. Do not put old main-branch OpenCode/plugin/session logic back into the macOS app/sidebar if gxserver should own it.

Specific requirements:
1. Sparkle release verification:
   - Carry over the release-script fix so Sparkle signatures are verified against the DMG artifact/download, not just the appcast.
   - Use namespace-agnostic XPath for `edSignature`.
   - This likely belongs in `scripts/release-ghostex.mjs`.

2. CLI entrypoint/session fallback:
   - Preserve the useful behavior from main:
     - bare terminal `ghostex`/`gx` should route to CLI/TUI intent even if PATH resolves to the app executable,
     - the shell launcher should resolve Homebrew symlinks before locating the bundled Node CLI,
     - JSON error output should stay valid when `--json` is requested,
     - session listing should degrade cleanly if the live bridge is unavailable.
   - Adapt this to nightly’s gxserver architecture.
   - Do not depend on old native-sidebar persisted state if nightly now has a gxserver/presentation state source. Use or add the gxserver-appropriate source/API.

3. OpenCode integration:
   - Do not simply copy the `native/sidebar/native-sidebar.tsx` main changes.
   - Move/reimplement the useful OpenCode plugin behavior in gxserver-owned code:
     - status detection should key off the generated plugin marker rather than requiring old `opencode.json` plugin registration,
     - installer should write/update the Ghostex OpenCode plugin,
     - if old explicit `./plugins/ghostex-session.js` entries exist in `opencode.json`, remove them cleanly when appropriate,
     - plugin should support both the bus/on API and newer event-return API,
     - expose status/install behavior to the sidebar through existing gxserver/native APIs.
   - Keep the sidebar as a caller/view, not the owner of OpenCode plugin script logic.

4. PATH discovery:
   - Carry over the intent of main’s login-shell PATH discovery:
     - GUI-launched commands should find tools installed through shell startup files, NVM/mise/asdf/Homebrew, and `~/.opencode/bin`.
   - Put the implementation in the correct nightly owner:
     - gxserver if gxserver launches agent tools/hook installers,
     - macOS bridge only for commands still launched directly by the native app.
   - Avoid duplicate divergent PATH implementations.

5. README/docs:
   - Bring over README/social-preview improvements only after code changes.
   - Include remote-only README changes from `origin/main` if available locally.
   - Avoid dragging release metadata unless it is clearly appropriate for nightly.

6. Release metadata:
   - Be careful with `package.json`, `project.yml`, `appcast.xml`, and `appcast-x86_64.xml`.
   - Do not blindly make nightly look like released `3.26.2` unless that is explicitly required.
   - If skipped, document that in the final summary.

7. Comments:
   - Follow repo CDXC comment rules.
   - Add/update CDXC comments for important carried-over requirements, using current timestamp format `yyyy-MM-dd-hh:mm`.

8. Safety:
   - Do not modify the original nightly worktree except to create the new worktree.
   - Do not modify `/Users/madda/dev/_active/zmux-set-local-branch-main`.
   - Do not run destructive git/file commands.
   - Preserve unrelated dirty work.
   - Do not push or open a PR.

Verification:
- Do not run the actual app.
- Run focused tests/static checks for edited areas if practical.
- At minimum, inspect diffs and ensure the branch is based on `nightly`.
- Check that merging back into `nightly` should be clean. If you can safely do a no-commit merge test in a temporary check/worktree, do that; otherwise explain why not.

Final deliverable:
- Commit the integration work on the new branch/worktree if changes are complete.
- Report:
  - worktree path,
  - branch name,
  - commit hash,
  - what was carried over directly,
  - what was reimplemented for gxserver,
  - what was intentionally skipped,
  - tests/checks run,
  - any residual risk.