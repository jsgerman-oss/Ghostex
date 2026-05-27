import { quoteShellDoubleArg } from "./shell-quote";

/**
 * CDXC:CursorCLI 2026-05-20-08:20:
 * Cursor Agent resumes by chat UUID (`cursor-agent --resume <id>`), not by
 * sidebar title. Ghostex-created sessions store the UUID from `create-chat`;
 * externally started sessions resolve the latest matching chat `name` from the
 * project-scoped Cursor SQLite store under `~/.cursor/chats/<md5(projectPath)>`.
 */

export const CURSOR_CHAT_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isCursorChatSessionId(value: string | undefined): value is string {
  const normalizedValue = value?.trim();
  return Boolean(normalizedValue && CURSOR_CHAT_SESSION_ID_PATTERN.test(normalizedValue));
}

export function getCursorChatSessionIdFromIdentity(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return undefined;
  }
  if (CURSOR_CHAT_SESSION_ID_PATTERN.test(normalizedValue)) {
    return normalizedValue.toLowerCase();
  }
  const transcriptMatch = normalizedValue.match(
    /(?:^|[/\\])agent-transcripts(?:[/\\])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/\\])/iu,
  );
  return transcriptMatch?.[1]?.toLowerCase();
}

/**
 * CDXC:CursorCLI 2026-05-27-09:06:
 * Cursor Agent hooks persist transcript paths under Cursor's project-scoped
 * `agent-transcripts` directory. Treat that path shape as authoritative Cursor
 * identity when older records have a stale inherited agent name.
 */
export function isCursorAgentTranscriptPath(value: string | undefined): boolean {
  const normalizedValue = value?.trim();
  return Boolean(
    normalizedValue &&
      /(?:^|[/\\])\.cursor(?:[/\\])projects(?:[/\\]).+(?:[/\\])agent-transcripts(?:[/\\])/iu.test(
        normalizedValue,
      ),
  );
}

/**
 * CDXC:CursorCLI 2026-05-20-08:20:
 * Accept-all and other launch flags stay on the configured base command; append
 * `--resume` after them so Ghostex-owned sessions always attach to the chat id
 * created at launch time.
 */
export function appendCursorCliResumeFlag(agentCommand: string, chatId: string): string {
  const normalizedCommand = agentCommand.trim();
  const normalizedChatId = chatId.trim();
  if (!normalizedCommand || !isCursorChatSessionId(normalizedChatId)) {
    return normalizedCommand;
  }
  return `${normalizedCommand} --resume ${quoteShellDoubleArg(normalizedChatId)}`;
}

/**
 * CDXC:CursorCLI 2026-05-20-08:20:
 * Native full-reload and copy-resume run this script when `agentSessionId` is
 * missing but the persisted terminal title is trusted. It scans the current
 * project's Cursor chat store and returns the newest chat whose `name` matches.
 */
export function getCursorChatSessionLookupScript(): string {
  return `import hashlib
import json
import pathlib
import sqlite3
import sys

project_path = sys.argv[1].strip()
title = sys.argv[2].strip()
if not project_path or not title:
    sys.exit(1)

project_hash = hashlib.md5(project_path.encode()).hexdigest()
chats_dir = pathlib.Path.home() / ".cursor" / "chats" / project_hash
if not chats_dir.is_dir():
    sys.exit(1)

def parse_meta_value(raw):
    raw = raw.strip()
    if raw.startswith("{"):
        return json.loads(raw)
    return json.loads(bytes.fromhex(raw).decode("utf-8"))

matches = []
for chat_dir in chats_dir.iterdir():
    if not chat_dir.is_dir():
        continue
    db_path = chat_dir / "store.db"
    if not db_path.is_file():
        continue
    try:
        connection = sqlite3.connect(db_path)
        rows = connection.execute("select value from meta").fetchall()
        connection.close()
    except Exception:
        continue
    for row in rows:
        try:
            meta = parse_meta_value(str(row[0] or ""))
        except Exception:
            continue
        name = str(meta.get("name") or "").strip()
        if name != title:
            continue
        chat_id = str(meta.get("agentId") or chat_dir.name).strip()
        if not chat_id:
            continue
        created_at = int(meta.get("createdAt") or 0)
        matches.append((created_at, chat_id))

if not matches:
    sys.exit(1)

matches.sort()
sys.stdout.write(matches[-1][1])
`;
}
