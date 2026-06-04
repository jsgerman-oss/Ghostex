import test from "node:test";
import assert from "node:assert/strict";
import {
  createGlobalSessionRef,
  createProjectId,
  createServerId,
  createSessionId,
  createUniqueProjectId,
  createUniqueSessionId,
  createZmxSessionName,
  isGxserverProjectId,
  isGxserverServerId,
  isGxserverSessionId,
} from "../src/ids.js";
import type { GxserverProjectId, GxserverSessionId } from "../protocol/index.js";

test("gxserver IDs follow the server/project/session formats", () => {
  for (let index = 0; index < 200; index += 1) {
    const serverId = createServerId();
    const projectId = createProjectId();
    const sessionId = createSessionId();

    assert.match(serverId, /^S[0-9][a-z0-9]$/);
    assert.match(projectId, /^P[0-9][a-z0-9]{3}$/);
    assert.match(sessionId, /^G[0-9][a-z0-9]{3}$/);
    assert.equal(isGxserverServerId(serverId), true);
    assert.equal(isGxserverProjectId(projectId), true);
    assert.equal(isGxserverSessionId(sessionId), true);
  }
});

test("global refs and zmx session names use stable gxserver IDs", () => {
  assert.equal(createGlobalSessionRef("S7k", "P3a91", "G8v20"), "S7k:P3a91:G8v20");
  assert.equal(createZmxSessionName("S7k", "P3a91", "G8v20"), "S7k-P3a91-G8v20");
});

test("project and session ID allocation skips collisions", () => {
  const projectCandidates = ["P3a91", "P4b22"] as GxserverProjectId[];
  const sessionCandidates = ["G8v20", "G1z99"] as GxserverSessionId[];

  assert.equal(
    createUniqueProjectId(new Set(["P3a91"]), () => projectCandidates.shift() ?? "P0aaa"),
    "P4b22",
  );
  assert.equal(
    createUniqueSessionId(new Set(["G8v20"]), () => sessionCandidates.shift() ?? "G0aaa"),
    "G1z99",
  );
});

test("ID allocation rejects invalid generated candidates", () => {
  assert.throws(
    () => createUniqueProjectId(new Set(), () => "Paaaa" as GxserverProjectId),
    /invalid gxserver project ID/,
  );
  assert.throws(
    () => createUniqueSessionId(new Set(), () => "GAAAA" as GxserverSessionId),
    /invalid gxserver session ID/,
  );
});
