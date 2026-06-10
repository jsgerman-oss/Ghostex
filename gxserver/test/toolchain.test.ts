import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  describeTerminalBackendScope,
  getBdToolStatus,
  getZmxToolStatus,
  requireBundledZmx,
  resolveBundledZehn,
} from "../src/toolchain.js";

test("zmx resolves from the pinned dev submodule artifact", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-toolchain-dev-"));
  try {
    const zmxPath = path.join(repoRoot, "zmx", "zig-out", "bin", "zmx");
    await makeExecutable(zmxPath);

    const resolved = await requireBundledZmx({
      envPath: "",
      gxserverRoot: path.join(repoRoot, "gxserver"),
      repoRoot,
    });

    assert.equal(resolved.executablePath, zmxPath);
    assert.equal(resolved.source, "devSubmodule");
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("zmx resolves from app resource-relative packaged layout", async () => {
  const appWebRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-toolchain-app-"));
  try {
    const gxserverRoot = path.join(appWebRoot, "gxserver");
    const zmxPath = path.join(appWebRoot, "bin", "zmx");
    await mkdir(gxserverRoot, { recursive: true });
    await makeExecutable(zmxPath);

    const resolved = await requireBundledZmx({
      envPath: "",
      gxserverRoot,
      repoRoot: path.join(appWebRoot, "repo"),
    });

    assert.equal(resolved.executablePath, zmxPath);
    assert.equal(resolved.source, "appResource");
  } finally {
    await rm(appWebRoot, { force: true, recursive: true });
  }
});

test("zmx never falls back to PATH for Ghostex-managed sessions", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-toolchain-no-path-"));
  try {
    const pathDir = path.join(repoRoot, "path-bin");
    const pathZmx = path.join(pathDir, "zmx");
    await makeExecutable(pathZmx);

    await assert.rejects(
      () =>
        requireBundledZmx({
          envPath: pathDir,
          gxserverRoot: path.join(repoRoot, "gxserver"),
          repoRoot,
        }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.match((error as Error).message, /bundled zmx/);
        assert.doesNotMatch((error as Error).message, /path-bin/);
        return true;
      },
    );
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("zmx reports non-executable bundled artifacts as a hard failure", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-toolchain-nonexec-"));
  try {
    const zmxPath = path.join(repoRoot, "zmx", "zig-out", "bin", "zmx");
    await mkdir(path.dirname(zmxPath), { recursive: true });
    await writeFile(zmxPath, "#!/bin/sh\n");
    await chmod(zmxPath, 0o644);

    const status = await getZmxToolStatus({
      gxserverRoot: path.join(repoRoot, "gxserver"),
      repoRoot,
    });

    assert.equal(status.availability, "notExecutable");
    assert.match(status.message, /not executable/);
    assert.match(status.guidance ?? "", /PATH zmx is intentionally ignored/);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("zehn resolves from bundled artifacts and gives build guidance when missing", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-toolchain-zehn-"));
  try {
    const zehnPath = path.join(repoRoot, "zehn", "zig-out", "bin", "zehn");
    await makeExecutable(zehnPath);

    const available = await resolveBundledZehn({
      envPath: "",
      gxserverRoot: path.join(repoRoot, "gxserver"),
      repoRoot,
    });
    assert.equal(available.availability, "available");
    assert.equal(available.executablePath, zehnPath);
    assert.equal(available.source, "devSubmodule");

    await rm(path.join(repoRoot, "zehn"), { force: true, recursive: true });
    const missing = await resolveBundledZehn({
      envPath: "",
      gxserverRoot: path.join(repoRoot, "gxserver"),
      repoRoot,
    });
    assert.equal(missing.availability, "missing");
    assert.match(missing.guidance ?? "", /git submodule update --init zehn/);
    assert.match(missing.guidance ?? "", /PATH zehn is intentionally ignored/);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("bd resolves from app/source resources and ignores PATH bd", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-toolchain-bd-"));
  try {
    const appWebRoot = path.join(root, "app-web");
    const gxserverRoot = path.join(appWebRoot, "gxserver");
    const bundledBdPath = path.join(appWebRoot, "bin", "bd");
    const sourceStagedBdPath = path.join(root, "repo", "native", "macos", "ghostexHost", "Web", "bin", "bd");
    const pathDir = path.join(root, "path-bin");
    const bdPath = path.join(pathDir, "bd");
    await mkdir(gxserverRoot, { recursive: true });
    await makeExecutable(bundledBdPath);
    await makeExecutable(sourceStagedBdPath);
    await makeExecutable(bdPath);

    const available = await getBdToolStatus({
      envPath: pathDir,
      gxserverRoot,
      repoRoot: path.join(root, "repo"),
    });
    assert.equal(available.availability, "available");
    assert.equal(available.executablePath, bundledBdPath);
    assert.equal(available.source, "appResource");

    await rm(bundledBdPath, { force: true });
    const sourceStaged = await getBdToolStatus({
      envPath: pathDir,
      gxserverRoot: path.join(root, "missing-gxserver"),
      repoRoot: path.join(root, "repo"),
      resourcesPath: path.join(root, "missing-resources"),
    });
    assert.equal(sourceStaged.availability, "available");
    assert.equal(sourceStaged.executablePath, sourceStagedBdPath);
    assert.equal(sourceStaged.source, "appResource");

    const inferredRoot = path.join(root, "inferred");
    const inferredSourceBdPath = path.join(inferredRoot, "native", "macos", "ghostexHost", "Web", "bin", "bd");
    await makeExecutable(inferredSourceBdPath);
    const inferredSourceStaged = await getBdToolStatus({
      envPath: pathDir,
      gxserverRoot: path.join(inferredRoot, "gxserver", "dist"),
      resourcesPath: path.join(root, "missing-resources"),
    });
    assert.equal(inferredSourceStaged.availability, "available");
    assert.equal(inferredSourceStaged.executablePath, inferredSourceBdPath);

    await rm(sourceStagedBdPath, { force: true });
    await rm(inferredSourceBdPath, { force: true });
    const missing = await getBdToolStatus({
      envPath: pathDir,
      gxserverRoot: path.join(root, "missing-gxserver"),
      repoRoot: path.join(root, "repo"),
      resourcesPath: path.join(root, "missing-resources"),
    });
    assert.equal(missing.availability, "missing");
    assert.match(missing.message, /Bundled bd was not found/);
    assert.match(missing.guidance ?? "", /Packaged Ghostex builds include/);
    assert.doesNotMatch(missing.message, /PATH/);
    assert.notEqual(missing.executablePath, bdPath);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("terminal backend scope keeps native Windows deferred and WSL on zmx", async () => {
  const windows = await getZmxToolStatus({ platform: "win32" });
  assert.equal(windows.availability, "unsupported");
  assert.match(windows.message, /Native Windows terminal backend support is deferred/);
  assert.match(describeTerminalBackendScope({ platform: "win32" }), /deferred/);
  assert.match(describeTerminalBackendScope({ platform: "linux", wsl: true }), /WSL uses the bundled Ghostex zmx/);
});

async function makeExecutable(executablePath: string): Promise<void> {
  await mkdir(path.dirname(executablePath), { recursive: true });
  await writeFile(executablePath, "#!/bin/sh\nexit 0\n");
  await chmod(executablePath, 0o755);
}
