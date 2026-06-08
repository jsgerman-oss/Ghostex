import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrateLegacyGxserverLogs, migrateLegacyLogLine } from "../src/log-migration.js";
import { createGxserverLogger } from "../src/logger.js";
import { getGxserverPaths } from "../src/paths.js";

test("legacy log migration writes structured event categories into gxserver JSONL", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-log-migration-"));
  try {
    const paths = getGxserverPaths(homeDir);
    await writeNativeSidebarSettings(homeDir, { debuggingMode: true });
    const legacyLogsDir = path.join(homeDir, "legacy-logs");
    await mkdir(legacyLogsDir, { recursive: true });
    await writeFile(
      path.join(legacyLogsDir, "agent-detection-debug.log"),
      [
        "[2026-05-30 11:00:00.000 +0400] nativeSidebar.agentDetected {\"projectId\":\"P3a91\",\"sessionId\":\"G8v20\"}",
        "[2026-05-30 11:01:00.000 +0400] nativeSidebar.persistedActivity.working {\"sessionId\":\"G8v20\"}",
        "[2026-05-30 11:01:30.000 +0400] nativeSidebar.sessionTitle.changed {\"sessionId\":\"G8v20\",\"title\":\"Private launch\",\"workspaceRoot\":\"/Users/person/dev/private-project\"}",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(legacyLogsDir, "native-terminal-focus-debug.log"),
      [
        "[2026-05-30 11:02:00.000 +0400] {\"event\":\"nativeSidebar.zmxPersistenceFocus.requested\",\"sessionId\":\"G8v20\"}",
        "[2026-05-30 11:03:00.000 +0400] previousSessionRestore.wake.completed {\"sessionId\":\"G8v20\"}",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(legacyLogsDir, "project-board-debug.log"),
      "[2026-05-30 11:04:00.000 +0400] projectBoard.startWork.worktree.start {\"projectId\":\"P3a91\"}\nmalformed\n",
      "utf8",
    );

    const result = await migrateLegacyGxserverLogs({
      legacyLogsDir,
      logger: createGxserverLogger(paths),
      migratedAt: "2026-05-30T07:10:00.000Z",
      serverId: "S7k",
    });

    assert.deepEqual(result, {
      filesRead: 3,
      malformedLineCount: 1,
      migratedLineCount: 6,
    });

    const entries = (await readFile(paths.logFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, any>);

    assert.equal(entries.every((entry) => entry.source === "legacyLogMigration"), true);
    assert.equal(entries.some((entry) => entry.event.startsWith("legacy.agentDetection.")), true);
    assert.equal(entries.some((entry) => entry.event.startsWith("legacy.agentActivity.")), true);
    assert.equal(entries.some((entry) => entry.event.startsWith("legacy.zmx.")), true);
    assert.equal(entries.some((entry) => entry.event.startsWith("legacy.wake.")), true);
    assert.equal(entries.some((entry) => entry.event.startsWith("legacy.worktree.")), true);
    assert.equal(entries.some((entry) => entry.event === "migration.importCompleted"), true);

    const migratedAgent = entries.find((entry) => entry.event.startsWith("legacy.agentDetection."));
    assert.equal(migratedAgent?.serverId, "S7k");
    assert.equal(migratedAgent?.projectId, "P3a91");
    assert.equal(migratedAgent?.sessionId, "G8v20");
    assert.equal(migratedAgent?.legacyFile, "agent-detection-debug.log");
    assert.equal(migratedAgent?.client, "legacy");
    assert.doesNotMatch(JSON.stringify(entries), /Private launch|private-project/);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("oversized legacy logs migrate a bounded tail without materializing the full file", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-log-tail-migration-"));
  try {
    const paths = getGxserverPaths(homeDir);
    await writeNativeSidebarSettings(homeDir, { debuggingMode: true });
    const legacyLogsDir = path.join(homeDir, "legacy-logs");
    await mkdir(legacyLogsDir, { recursive: true });
    await writeFile(
      path.join(legacyLogsDir, "native-terminal-focus-debug.log"),
      `${"x".repeat(16 * 1024 * 1024 + 1024)}\n[2026-05-30 11:02:00.000 +0400] nativeSidebar.zmxPersistenceFocus.requested {"sessionId":"G8v20"}\n`,
      "utf8",
    );

    const result = await migrateLegacyGxserverLogs({
      legacyLogsDir,
      logger: createGxserverLogger(paths),
      migratedAt: "2026-05-30T07:10:00.000Z",
      serverId: "S7k",
    });

    assert.equal(result.filesRead, 1);
    assert.equal(result.migratedLineCount, 1);

    const entries = (await readFile(paths.logFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, any>);
    assert.equal(entries.some((entry) => entry.event === "migration.importFileTail"), true);
    assert.equal(entries.some((entry) => entry.event === "legacy.zmx.nativeSidebar.zmxPersistenceFocus.requested"), true);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

async function writeNativeSidebarSettings(homeDir: string, settings: Record<string, unknown>): Promise<void> {
  const stateDir = path.join(homeDir, ".ghostex", "state");
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, "native-sidebar-settings.json"), JSON.stringify(settings), "utf8");
}

test("legacy log line migration rejects unparseable timestamped lines", () => {
  const migrated = migrateLegacyLogLine({
    fileName: "agent-detection-debug.log",
    line: "not a timestamped legacy log line",
    sourceCategory: "agentDetection",
  });

  assert.equal(migrated, undefined);
});
