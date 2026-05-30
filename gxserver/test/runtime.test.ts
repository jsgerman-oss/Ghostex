import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GXSERVER_LOCAL_API_PORT, GXSERVER_PROTOCOL_VERSION } from "../protocol/index.js";
import { getGxserverPaths } from "../src/paths.js";
import { readRuntimeMetadata, removeRuntimeMetadata, writeRuntimeMetadata } from "../src/runtime.js";

test("runtime metadata round trips through the fixed gxserver path shape", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-runtime-"));
  try {
    const paths = getGxserverPaths(homeDir);
    assert.equal(paths.runtimeMetadataFile, path.join(homeDir, ".ghostex", "gxserver", "runtime", "server.json"));

    await writeRuntimeMetadata(paths, {
      pid: 123,
      port: GXSERVER_LOCAL_API_PORT,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      serverId: "S7k",
      startedAt: "2026-05-30T10:04:00.000Z",
      version: "0.1.0",
    });

    assert.deepEqual(await readRuntimeMetadata(paths), {
      pid: 123,
      port: GXSERVER_LOCAL_API_PORT,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      serverId: "S7k",
      startedAt: "2026-05-30T10:04:00.000Z",
      version: "0.1.0",
    });

    await removeRuntimeMetadata(paths);
    assert.equal(await readRuntimeMetadata(paths), undefined);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});
