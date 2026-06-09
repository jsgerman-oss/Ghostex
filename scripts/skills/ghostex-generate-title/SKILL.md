---
name: ghostex-generate-title
description: >-
  Generate a concise Ghostex session title for the current thread or
  conversation. Use when the user asks for a thread name, chat title, session
  title, resume title, or any concise label summarizing what was worked on; then
  submit `/rename <title>` in the current Ghostex session.
---

# ghostex-generate-title

Generate one title only.

After generating the title, submit the rename command in this same Ghostex
session:

```bash
ghostex rename-command --session-id "$GHOSTEX_SESSION_ID" --title "<generated title>"
```

Use `rename-command` instead of `send-text` alone. It stages `/rename <title>`
and submits Enter through Ghostex's supported session bridge; in the macOS app,
that reaches the same native Enter path used by Delayed Send.

## Rules

- Keep the title under 47 characters.
- Summarize the actual work done, not the whole conversation vibe.
- Prefer 3-8 words.
- Use plain title case or compact phrase case.
- Avoid quotes, punctuation, emojis, and extra explanation.
- Use `GHOSTEX_SESSION_ID` as the self-session selector when it is set. Ghostex
  exports the provider session name (for example `g-0527-090339`), and the CLI
  resolves that id directly.
- If `GHOSTEX_SESSION_ID` is missing, return the title only and do not guess a
  session.
- If `rename-command` fails with no matching session, return the title only. Do
  not retry with a different selector.
