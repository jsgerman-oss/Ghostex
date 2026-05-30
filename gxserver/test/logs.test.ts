import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGxserverLogger } from "../src/logger.js";
import { queryGxserverLogs } from "../src/logs.js";
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
    assert.equal(result.totalMatched, 2);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]?.event, "agent.activity.working");
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
