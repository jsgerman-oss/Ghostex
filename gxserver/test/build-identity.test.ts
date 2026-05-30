import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSourceGxserverBuildIdentity, readGxserverBuildIdentity } from "../src/build-identity.js";

test("source gxserver build identity is deterministic for dev builds", () => {
  assert.equal(createSourceGxserverBuildIdentity("0.1.0-test"), "gxserver:0.1.0-test:source");
});

test("packaged gxserver build identity is read from the CLI package root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gxserver-build-identity-"));
  try {
    const cliDir = path.join(root, "dist", "src");
    await mkdir(cliDir, { recursive: true });
    await writeFile(
      path.join(root, "build-identity.json"),
      JSON.stringify({
        buildIdentity: "gxserver:0.1.0:sha256:abc123",
        fingerprint: "sha256:abc123",
        packageVersion: "0.1.0",
      }),
      "utf8",
    );

    assert.equal(await readGxserverBuildIdentity(cliDir, "0.1.0"), "gxserver:0.1.0:sha256:abc123");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("missing packaged identity falls back only to explicit source identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gxserver-build-identity-source-"));
  try {
    const cliDir = path.join(root, "dist", "src");
    await mkdir(cliDir, { recursive: true });
    assert.equal(await readGxserverBuildIdentity(cliDir, "0.1.0"), "gxserver:0.1.0:source");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
