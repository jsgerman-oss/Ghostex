---
name: ghostex-manage-beads
description: >-
  Use this skill when managing Ghostex project board beads with the `bd` CLI:
  creating, updating, commenting on, reviewing, closing, or associating beads
  with the current Ghostex or Codex session. It covers the project swimlane
  workflow, session-link comments, external refs, and safe examples for making
  review beads like the current session association workflow.
---

# ghostex-manage-beads

Use this skill when a user asks to manage project board beads, create or update
review tasks, move work through bead statuses, add bead comments, or associate a
bead with the current Ghostex or Codex session.

## Requirements

- Run bead commands from the repository root so `bd` finds the project
  database and `.beads` JSONL export.
- Prefer `bd --help` and `bd <command> --help` as the source of truth for the
  installed `bd` version.
- Inspect nearby beads before creating a new one so title, labels, status, and
  external-ref style match the project.

## Core Workflow

1. Inspect current work:

   ```bash
   bd list --json
   bd show <id> --json
   bd comments <id> --json
   ```

2. Move the bead through project swimlanes:

   ```bash
   bd update <id> --status in_progress
   bd update <id> --status test
   bd update <id> --status review
   bd close <id>
   ```

3. After each meaningful turn, add a short human-readable comment:

   ```bash
   bd comment <id> "<summary>"
   ```

Keep comments focused on user-facing requirements delivered and high-level
technical approach. Do not require humans to read the agent transcript to know
what changed.

## Create A Review Bead

Use a review bead when the implementation is ready for another pass:

```bash
bd create "Review <specific change>" \
  --type task \
  --priority P2 \
  --labels review,<area> \
  --external-ref "codex-thread:$CODEX_THREAD_ID" \
  --description "<review focus, files or areas, verification, known blockers>" \
  --json
bd update <id> --status review
```

If `CODEX_THREAD_ID` is missing, omit the external ref rather than inventing
one.

## Associate A Bead With The Current Session

Prefer a bead comment for full session association because `external-ref` holds
one stable reference and comments can include both Ghostex and Codex ids:

```bash
bd comment <id> "Associated session: Ghostex ${GHOSTEX_GLOBAL_SESSION_REF:-unknown} / ${GHOSTEX_NATIVE_SESSION_ID:-unknown}, Codex thread ${CODEX_THREAD_ID:-unknown}. <brief work summary and verification status>."
```

Useful environment variables when present:

- `GHOSTEX_GLOBAL_SESSION_REF`: full Ghostex session reference, such as
  `S90:P3lv0:G5jjo`.
- `GHOSTEX_NATIVE_SESSION_ID`: native project/session id, such as
  `P3lv0:G5jjo`.
- `GHOSTEX_SESSION_ID`: provider session id, such as `G5jjo`.
- `CODEX_THREAD_ID`: current Codex thread id.

When creating a new bead for the current agent session, set
`--external-ref "codex-thread:$CODEX_THREAD_ID"` and add the Ghostex session ids
in a comment.

## Example: Session-Associated Review Bead

```bash
bd create "Review companion CEF flicker layout-key fix" \
  --type task \
  --priority P2 \
  --labels cef,native-sidebar,review \
  --external-ref "codex-thread:$CODEX_THREAD_ID" \
  --description "Review the geometry-only native layout-key extraction for companion terminal focus changes. Verify focused tests, typecheck, and any known unrelated blockers." \
  --json
bd update <new-id> --status review
bd comment <new-id> "Associated session: Ghostex ${GHOSTEX_GLOBAL_SESSION_REF:-unknown} / ${GHOSTEX_NATIVE_SESSION_ID:-unknown}, Codex thread ${CODEX_THREAD_ID:-unknown}. Implemented geometry-only native layout-key extraction so companion session clicks no longer classify active-tab focus changes as AppKit layout changes; focused tests and typecheck passed."
```

## Safety

- Do not delete or close beads unless the user explicitly asks or the work is
  genuinely done.
- Do not overwrite unrelated bead descriptions or labels when a comment is
  enough.
- Keep bead comments free of secrets, command output, private file contents, and
  unnecessary paths.
