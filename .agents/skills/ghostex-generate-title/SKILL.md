---
name: ghostex-generate-title
description: >-
  Generate a concise Ghostex session title for the current thread or
  conversation. Use when the user asks for a thread name, chat title, session
  title, resume title, or any concise label summarizing what was worked on; then
  write `/rename <title>` into the current Ghostex session without pressing
  Enter.
---

# Ghostex Generate Title

Generate one title only.

After generating the title, write the rename command into this same Ghostex
session without submitting it:

```bash
ghostex send-text --session-id "$GHOSTEX_SESSION_ID" --text "/rename <generated title>"
```

Do not press Enter for this rename command. The user or calling workflow can
submit it.

## Rules

- Keep the title under 47 characters.
- Summarize the actual work done, not the whole conversation vibe.
- Prefer 3-8 words.
- Use plain title case or compact phrase case.
- Avoid quotes, punctuation, emojis, and extra explanation.
- Use `GHOSTEX_SESSION_ID` as the self-session selector when available.
- If `GHOSTEX_SESSION_ID` is missing, return the title only and do not guess a
  session.
