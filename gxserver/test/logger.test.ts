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

test("log normalization redacts project/session names, paths, command text, urls, and secrets", () => {
  const normalized = normalizeLogEntry({
    details: {
      args: ["comments", "add", "gxserver-1", "private project note"],
      comment: "private project note",
      cwd: "/Users/person/dev/private-project",
      nested: {
        authToken: "secret-token",
        sessionTitle: "Customer deploy",
        url: "https://example.test/path?token=secret",
      },
      projectId: "P3a91",
      sessionId: "G8v20",
      title: "Customer deploy",
      worktreePath: "/Users/person/dev/private-project-feature",
    },
    error: "failed in /Users/person/dev/private-project with token=secret-token",
    event: "https://example.test/private?token=secret-token",
    legacyFile: "/Users/person/dev/private-project/legacy.log",
    level: "warn",
    message: 'legacy {"title":"Customer deploy","workspaceRoot":"/Users/person/dev/private-project"}',
    source: "/Users/person/dev/private-project/source.log",
    ts: "now",
  });

  assert.equal(normalized.projectId, undefined);
  assert.equal(normalized.details?.projectId, "P3a91");
  assert.equal(normalized.details?.sessionId, "G8v20");
  assert.deepEqual(normalized.details?.args, { count: 4, redacted: true });
  assert.equal(normalized.details?.comment, "[redacted]");
  assert.equal(normalized.details?.cwd, "[redacted:path]");
  assert.equal(normalized.details?.title, "[redacted]");
  assert.equal(normalized.details?.worktreePath, "[redacted:path]");
  assert.deepEqual((normalized.details?.nested as Record<string, unknown>)?.url, {
    host: "example.test",
    protocol: "https",
    redacted: true,
    type: "url",
  });
  assert.equal((normalized.details?.nested as Record<string, unknown>)?.authToken, "[redacted:secret]");
  assert.equal((normalized.details?.nested as Record<string, unknown>)?.sessionTitle, "[redacted]");
  assert.equal(normalized.event, "[redacted:url]");
  assert.equal(normalized.legacyFile, "[redacted:path]");
  assert.equal(normalized.source, "[redacted:path]");
  assert.doesNotMatch(JSON.stringify(normalized), /Customer deploy|private-project|secret-token|private project note/);
});

test("typed operation scope rejection logs stay shareable", () => {
  const normalized = normalizeLogEntry({
    details: {
      action: "board",
      commandText: "bd list --repo /Users/person/dev/private-project",
      endpoint: "runBeadsAction",
      errorCode: "notFound",
      errorType: "GxserverProjectPathError",
      hasProjectId: true,
      hasProjectPath: true,
      projectPath: "/Users/person/dev/private-project",
      secretToken: "secret-token",
      url: "https://example.test/repo?token=secret-token",
    },
    event: "typedOperation.scopeRejected",
    level: "warn",
    requestId: "req-1",
    serverId: "S7k",
    ts: "now",
  });

  assert.equal(normalized.event, "typedOperation.scopeRejected");
  assert.equal(normalized.details?.action, "board");
  assert.equal(normalized.details?.endpoint, "runBeadsAction");
  assert.equal(normalized.details?.projectPath, "[redacted:path]");
  assert.equal(normalized.details?.commandText, "[redacted]");
  assert.equal(normalized.details?.secretToken, "[redacted:secret]");
  assert.deepEqual(normalized.details?.url, {
    host: "example.test",
    protocol: "https",
    redacted: true,
    type: "url",
  });
  assert.doesNotMatch(JSON.stringify(normalized), /private-project|secret-token|bd list/);
});
