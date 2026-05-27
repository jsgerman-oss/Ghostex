import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  appendCursorCliResumeFlag,
  getCursorChatSessionIdFromIdentity,
  getCursorChatSessionLookupScript,
  isCursorAgentTranscriptPath,
  isCursorChatSessionId,
} from "./cursor-cli-session";

describe("cursor-cli-session", () => {
  test("should validate Cursor chat UUID identities", () => {
    expect(isCursorChatSessionId("c62d8f4d-e93b-4932-817e-1eefd9188de4")).toBe(true);
    expect(isCursorChatSessionId("Cursor and Antigravity CLI Agent Detection")).toBe(false);
    expect(getCursorChatSessionIdFromIdentity("C62D8F4D-E93B-4932-817E-1EEFD9188DE4")).toBe(
      "c62d8f4d-e93b-4932-817e-1eefd9188de4",
    );
    expect(
      getCursorChatSessionIdFromIdentity(
        "/Users/madda/.cursor/projects/Users-madda-dev-active-zmux/agent-transcripts/C62D8F4D-E93B-4932-817E-1EEFD9188DE4/C62D8F4D-E93B-4932-817E-1EEFD9188DE4.jsonl",
      ),
    ).toBe("c62d8f4d-e93b-4932-817e-1eefd9188de4");
  });

  test("should append --resume after the configured launch command", () => {
    expect(appendCursorCliResumeFlag("cursor-agent --yolo", "c62d8f4d-e93b-4932-817e-1eefd9188de4")).toBe(
      'cursor-agent --yolo --resume "c62d8f4d-e93b-4932-817e-1eefd9188de4"',
    );
  });

  test("should identify Cursor transcript paths", () => {
    expect(
      isCursorAgentTranscriptPath(
        "/Users/madda/.cursor/projects/Users-madda-dev-active-zmux/agent-transcripts/9a81fa27-6dcf-49dd-be3f-802169e708e2/9a81fa27-6dcf-49dd-be3f-802169e708e2.jsonl",
      ),
    ).toBe(true);
    expect(
      isCursorAgentTranscriptPath(
        "/Users/madda/.codex/sessions/2026/05/27/rollout-2026-05-27T09-05-02-019e67d2-6482-7461-b1bf-32cb31d27f0d.jsonl",
      ),
    ).toBe(false);
  });

  test("should resolve the latest matching chat id for a project title", () => {
    const projectPath = join(tmpdir(), `ghostex-cursor-chat-${Date.now()}`);
    const projectHash = execFileSync("/usr/bin/python3", [
      "-c",
      "import hashlib,sys; print(hashlib.md5(sys.argv[1].encode()).hexdigest())",
      projectPath,
    ])
      .toString()
      .trim();
    const chatsRoot = join(homedir(), ".cursor", "chats", projectHash);
    const olderChatId = "11111111-1111-4111-8111-111111111111";
    const newerChatId = "22222222-2222-4222-8222-222222222222";
    const title = "Ghostex Cursor Resume Lookup";

    const writeChat = (chatId: string, createdAt: number) => {
      const chatDir = join(chatsRoot, chatId);
      mkdirSync(chatDir, { recursive: true });
      const dbPath = join(chatDir, "store.db");
      const meta = JSON.stringify({
        agentId: chatId,
        createdAt,
        name: title,
      });
      execFileSync("sqlite3", [
        dbPath,
        "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);",
        `INSERT INTO meta VALUES ('0', '${meta.replace(/'/g, "''")}');`,
      ]);
    };

    mkdirSync(chatsRoot, { recursive: true });
    writeChat(olderChatId, 100);
    writeChat(newerChatId, 200);

    try {
      const resolvedChatId = execFileSync("/usr/bin/python3", [
        "-c",
        getCursorChatSessionLookupScript(),
        projectPath,
        title,
      ])
        .toString()
        .trim();
      expect(resolvedChatId).toBe(newerChatId);
    } finally {
      rmSync(join(chatsRoot, olderChatId), { force: true, recursive: true });
      rmSync(join(chatsRoot, newerChatId), { force: true, recursive: true });
    }
  });
});
