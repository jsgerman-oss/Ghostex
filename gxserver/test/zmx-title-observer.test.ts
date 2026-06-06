import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GxserverZmxTitleObserver } from "../src/zmx-title-observer.js";
import type {
  GxserverAuthToken,
  GxserverRuntimeMetadata,
  GxserverSessionDomainState,
} from "../protocol/index.js";
import type { GxserverLogger } from "../src/logger.js";

test("zmx title observer retries after early watch-title failure", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "gxserver-zmx-title-observer-"));
  const counterPath = path.join(tempDir, "watch-count.txt");
  const fakeZmxPath = path.join(tempDir, "fake-zmx.mjs");
  const changes: string[] = [];
  const logger: GxserverLogger = {
    async log(): Promise<void> {},
  };

  try {
    await writeFile(
      fakeZmxPath,
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const counterPath = ${JSON.stringify(counterPath)};
let count = 0;
try {
  count = Number(readFileSync(counterPath, "utf8")) || 0;
} catch {}
writeFileSync(counterPath, String(count + 1));
if (process.argv[2] !== "watch-title") {
  process.exit(2);
}
if (count === 0) {
  process.exit(1);
}
setInterval(() => {}, 1000);
`,
      "utf8",
    );
    await chmod(fakeZmxPath, 0o755);

    const observer = new GxserverZmxTitleObserver({
      authToken: "test-token" as GxserverAuthToken,
      logger,
      metadata: metadataFixture(),
      onObservationStateChange: (change) => {
        changes.push(change.state.status);
      },
      readyDelayMs: 5,
      requireZmx: async () => ({
        executablePath: fakeZmxPath,
        source: "devSubmodule",
        tool: "zmx",
      }),
      retryDelaysMs: [10, 20],
    });

    try {
      /*
      CDXC:ZmxTitleObservations 2026-06-07-00:30:
      A wake can start title observation before zmx exposes its watch-title socket. The observer must retry early process failure and become active once the watcher stays alive, otherwise working-status detection can remain stale until Auto Sleep incorrectly sleeps the agent.
      */
      await observer.observeSession(sessionFixture(), "wake-session");
      await waitFor(async () =>
        Number(await readFile(counterPath, "utf8").catch(() => "0")) >= 2 &&
        changes.includes("retrying") &&
        changes.filter((status) => status === "starting").length >= 2 &&
        changes.at(-1) === "active"
      );

      const watchCount = Number(await readFile(counterPath, "utf8"));
      assert.ok(watchCount >= 2, "watch-title was retried after the first failure");
      assert.ok(changes.filter((status) => status === "starting").length >= 2);
      assert.ok(changes.includes("retrying"));
      assert.equal(changes.at(-1), "active");
    } finally {
      observer.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("condition was not met before timeout");
}

function metadataFixture(): GxserverRuntimeMetadata {
  return {
    buildIdentity: "test",
    pid: process.pid,
    port: 58744,
    protocolVersion: 1,
    serverId: "S90",
    startedAt: "2026-06-07T00:30:00.000Z",
    version: "0.0.0-test",
  };
}

function sessionFixture(): GxserverSessionDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-06-07T00:29:00.000Z",
    globalRef: "S90:P3lv0:G5tpf",
    hiddenMetadata: {},
    isFavorite: false,
    isPinned: false,
    kind: "agent",
    launchSettings: {},
    lifecycleState: "running",
    notificationRules: {},
    projectId: "P3lv0",
    providerState: { lifecycleState: "exists", zmxName: "S90-P3lv0-G5tpf" },
    runtimeSettings: {},
    sessionId: "G5tpf",
    surface: "workspace",
    title: "Terminal Session",
    updatedAt: "2026-06-07T00:29:00.000Z",
    zmxName: "S90-P3lv0-G5tpf",
  };
}
