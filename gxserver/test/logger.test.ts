import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGxserverLogger, normalizeLogEntry } from "../src/logger.js";
import { getGxserverPaths } from "../src/paths.js";

test("JSONL logger writes one parseable camelCase entry per line", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-logs-"));
  try {
    const paths = getGxserverPaths(homeDir);
    const logger = createGxserverLogger(paths);

    await logger.log({
      client: "local-cli",
      details: { action: "query", count: 1 },
      durationMs: 12,
      error: new Error("boom"),
      event: "apiRequest",
      legacyFile: "legacy.log",
      level: "warn",
      message: "request failed",
      projectId: "P3a91",
      requestId: "req-1",
      serverId: "S7k",
      sessionId: "G8v20",
      source: "unitTest",
      ts: "2026-05-30T10:16:00.000Z",
    });

    const lines = (await readFile(paths.logFile, "utf8")).trim().split("\n");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

    assert.deepEqual(parsed, {
      ts: "2026-05-30T10:16:00.000Z",
      level: "warn",
      event: "apiRequest",
      serverId: "S7k",
      requestId: "req-1",
      projectId: "P3a91",
      sessionId: "G8v20",
      client: "local-cli",
      durationMs: 12,
      error: "boom",
      details: { action: "query", count: 1 },
      legacyFile: "legacy.log",
      message: "request failed",
      source: "unitTest",
    });
    assert.equal(Object.keys(parsed).some((key) => key.includes("_")), false);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("log normalization keeps optional identity fields absent when unknown", () => {
  assert.deepEqual(normalizeLogEntry({ event: "storageMigrated", level: "info", ts: "now" }), {
    ts: "now",
    level: "info",
    event: "storageMigrated",
  });
});
