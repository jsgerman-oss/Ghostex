import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGxserverLogger } from "../src/logger.js";
import { GXSERVER_LOG_QUERY_FULL_SCAN_MAX_BYTES, queryGxserverLogs } from "../src/logs.js";
import { getGxserverPaths } from "../src/paths.js";

test("log query filters malformed JSONL, identities, timestamps, limit, and order", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-query-"));
  try {
    const paths = getGxserverPaths(homeDir);
    const logger = createGxserverLogger(paths);
    await logger.log({
      client: "cli",
      event: "agent.detected",
      level: "info",
      projectId: "P3a91",
      serverId: "S7k",
      sessionId: "G8v20",
      ts: "2026-05-30T10:00:00.000Z",
    });
    await appendFile(paths.logFile, "not-json\n", "utf8");
    await logger.log({
      client: "api",
      event: "agent.activity.working",
      level: "debug",
      projectId: "P3a91",
      serverId: "S7k",
      sessionId: "G8v20",
      ts: "2026-05-30T10:01:00.000Z",
    });
    await logger.log({
      client: "api",
      event: "zmx.kill.failed",
      level: "error",
      projectId: "P4b12",
      serverId: "S7k",
      sessionId: "G9v21",
      ts: "2026-05-30T10:02:00.000Z",
    });

    const result = await queryGxserverLogs(paths, {
      eventPrefix: "agent.",
      level: ["debug", "info"],
      limit: 1,
      order: "desc",
      projectId: "P3a91",
      since: "2026-05-30T09:59:00.000Z",
      until: "2026-05-30T10:01:30.000Z",
    });

    assert.equal(result.malformedLineCount, 1);
    assert.equal(result.malformedLineCountIsExact, true);
    assert.equal(result.totalMatched, 2);
    assert.equal(result.totalMatchedIsExact, true);
    assert.equal(result.truncated, false);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.event, "agent.activity.working");
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("large descending log query reads a bounded tail window", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-query-large-tail-"));
  try {
    const paths = getGxserverPaths(homeDir);
    const lines: string[] = [];
    let byteLength = 0;
    let lineCount = 0;
    while (byteLength <= GXSERVER_LOG_QUERY_FULL_SCAN_MAX_BYTES + 1024 * 1024) {
      const line = JSON.stringify({
        event: `tail.${lineCount}`,
        level: "info",
        message: "x".repeat(768),
        ts: new Date(Date.UTC(2026, 4, 30, 10, 0, lineCount)).toISOString(),
      });
      const jsonlLine = `${line}\n`;
      lines.push(jsonlLine);
      byteLength += Buffer.byteLength(jsonlLine, "utf8");
      lineCount += 1;
    }
    await mkdir(paths.logsDir, { recursive: true });
    await writeFile(paths.logFile, lines.join(""), "utf8");

    const result = await queryGxserverLogs(paths, {
      eventPrefix: "tail.",
      limit: 3,
      order: "desc",
    });

    assert.equal(result.entries.length, 3);
    assert.deepEqual(
      result.entries.map((entry) => entry.event),
      [`tail.${lineCount - 1}`, `tail.${lineCount - 2}`, `tail.${lineCount - 3}`],
    );
    assert.equal(result.truncated, true);
    assert.equal(result.truncatedReason, "fileWindowExceeded");
    assert.equal(result.totalMatchedIsExact, false);
    assert.equal(result.malformedLineCountIsExact, false);
    assert.ok(result.logFileSizeBytes !== undefined);
    assert.ok(result.scannedBytes !== undefined);
    assert.ok(result.scannedLineCount !== undefined);
    assert.ok(result.scannedBytes < result.logFileSizeBytes);
    assert.ok(result.scannedLineCount < lineCount);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("log query reverse flag maps to descending order", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-query-reverse-"));
  try {
    const paths = getGxserverPaths(homeDir);
    const logger = createGxserverLogger(paths);
    await logger.log({ event: "first", level: "info", ts: "2026-05-30T10:00:00.000Z" });
    await logger.log({ event: "second", level: "info", ts: "2026-05-30T10:01:00.000Z" });

    const result = await queryGxserverLogs(paths, { limit: 2, reverse: true });

    assert.deepEqual(
      result.entries.map((entry) => entry.event),
      ["second", "first"],
    );
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});
