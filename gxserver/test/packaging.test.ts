import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gxserverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("server package stages compiled daemon, system-Node launcher, and bundled zmx/zehn/bd", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-package-test-"));
  const packageDir = path.join(gxserverRoot, "dist", `test-server-package-${process.pid}`);
  try {
    const zmxBin = path.join(tempRoot, "zmx");
    const zehnBin = path.join(tempRoot, "zehn");
    const bdBin = path.join(tempRoot, "bd");
    await makeExecutable(zmxBin);
    await makeExecutable(zehnBin);
    await makeExecutable(bdBin);

    const packageResult = spawnSync(
      "node",
      [
        "scripts/package-gxserver.mjs",
        "--package-dir",
        packageDir,
        "--zmx-bin",
        zmxBin,
        "--zehn-bin",
        zehnBin,
        "--bd-bin",
        bdBin,
        "--generate-homebrew",
      ],
      { cwd: gxserverRoot, encoding: "utf8" },
    );
    assert.equal(packageResult.status, 0, packageResult.stderr || packageResult.stdout);

    const checkResult = spawnSync("node", ["scripts/check-package.mjs", "--package-dir", packageDir], {
      cwd: gxserverRoot,
      encoding: "utf8",
    });
    assert.equal(checkResult.status, 0, checkResult.stderr || checkResult.stdout);

    await stat(path.join(packageDir, "dist", "src", "cli.js"));
    const buildIdentity = JSON.parse(await readFile(path.join(packageDir, "build-identity.json"), "utf8"));
    assert.equal(buildIdentity.packageVersion, "0.1.0");
    assert.equal(buildIdentity.buildIdentity.startsWith("gxserver:0.1.0:sha256:"), true);
    await stat(path.join(packageDir, "bin", "gxserver"));
    assert.match(await readFile(path.join(packageDir, "bin", "gxserver"), "utf8"), /APP_NODE=.*\.\.\/\.\.\/code-server\/lib\/node/);
    await stat(path.join(packageDir, "bin", "zmx"));
    await stat(path.join(packageDir, "bin", "zehn"));
    await stat(path.join(packageDir, "bin", "bd"));
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
    await rm(packageDir, { force: true, recursive: true });
  }
});

test("package script refuses output outside gxserver dist", async () => {
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "gxserver-package-outside-"));
  try {
    const result = spawnSync(
      "node",
      [
        "scripts/package-gxserver.mjs",
        "--package-dir",
        outsideDir,
        "--zmx-bin",
        "/bin/sh",
        "--zehn-bin",
        "/bin/sh",
        "--bd-bin",
        "/bin/sh",
      ],
      { cwd: gxserverRoot, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /must be under/);
  } finally {
    await rm(outsideDir, { force: true, recursive: true });
  }
});

test("app package with bundled native modules requires a native Node runtime identity", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-package-native-node-test-"));
  const packageDir = path.join(gxserverRoot, "dist", `test-native-node-package-${process.pid}`);
  try {
    const zmxBin = path.join(tempRoot, "zmx");
    const zehnBin = path.join(tempRoot, "zehn");
    const bdBin = path.join(tempRoot, "bd");
    await makeExecutable(zmxBin);
    await makeExecutable(zehnBin);
    await makeExecutable(bdBin);

    const result = spawnSync(
      "node",
      [
        "scripts/package-gxserver.mjs",
        "--package-dir",
        packageDir,
        "--zmx-bin",
        zmxBin,
        "--zehn-bin",
        zehnBin,
        "--bd-bin",
        bdBin,
        "--include-node-modules",
      ],
      { cwd: gxserverRoot, encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /requires --native-node/);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
    await rm(packageDir, { force: true, recursive: true });
  }
});

test("package check rejects bundled better-sqlite3 without native runtime metadata", async () => {
  const packageDir = path.join(gxserverRoot, "dist", `test-missing-native-runtime-${process.pid}`);
  try {
    await mkdir(path.join(packageDir, "dist", "src"), { recursive: true });
    await mkdir(path.join(packageDir, "dist", "protocol"), { recursive: true });
    await mkdir(path.join(packageDir, "bin"), { recursive: true });
    await mkdir(path.join(packageDir, "node_modules", "better-sqlite3"), { recursive: true });
    await writeFile(path.join(packageDir, "dist", "src", "cli.js"), "");
    await writeFile(path.join(packageDir, "dist", "protocol", "index.js"), "");
    await writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ engines: { node: ">=22.0.0" }, version: "0.1.0" }),
    );
    await writeFile(path.join(packageDir, "package-lock.json"), "{}");
    await writeFile(
      path.join(packageDir, "build-identity.json"),
      JSON.stringify({
        buildIdentity: "gxserver:0.1.0:sha256:test",
        fingerprint: "sha256:test",
        packageVersion: "0.1.0",
      }),
    );
    await makeExecutable(path.join(packageDir, "bin", "gxserver"));
    await makeExecutable(path.join(packageDir, "bin", "zmx"));
    await makeExecutable(path.join(packageDir, "bin", "zehn"));
    await makeExecutable(path.join(packageDir, "bin", "bd"));

    const result = spawnSync("node", ["scripts/check-package.mjs", "--package-dir", packageDir], {
      cwd: gxserverRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /native-runtime\.json/);
  } finally {
    await rm(packageDir, { force: true, recursive: true });
  }
});

test("package check rejects app native runtime metadata that is not code-server's bundled Node 22", async () => {
  const packageDir = path.join(gxserverRoot, "dist", `test-wrong-native-runtime-${process.pid}`);
  try {
    await writeMinimalPackage(packageDir);
    await mkdir(path.join(packageDir, "node_modules", "better-sqlite3"), { recursive: true });
    await writeFile(
      path.join(packageDir, "native-runtime.json"),
      JSON.stringify({
        nativeModules: ["better-sqlite3"],
        nodeMajor: 24,
        nodeModuleVersion: "137",
        nodeVersion: "v24.14.1",
      }),
    );

    const result = spawnSync("node", ["scripts/check-package.mjs", "--package-dir", packageDir], {
      cwd: gxserverRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /Node 22/);
  } finally {
    await rm(packageDir, { force: true, recursive: true });
  }
});

async function makeExecutable(executablePath: string): Promise<void> {
  await mkdir(path.dirname(executablePath), { recursive: true });
  await writeFile(executablePath, "#!/bin/sh\nexit 0\n");
  await chmod(executablePath, 0o755);
}

async function writeMinimalPackage(packageDir: string): Promise<void> {
  /*
  CDXC:GxserverPackagingChecks 2026-06-08-12:17:
  App-bundled gxserver native modules must target code-server's bundled Node 22 runtime. Keep test packages minimal so package-check failures isolate the runtime metadata contract instead of unrelated staged files.
  */
  await mkdir(path.join(packageDir, "dist", "src"), { recursive: true });
  await mkdir(path.join(packageDir, "dist", "protocol"), { recursive: true });
  await mkdir(path.join(packageDir, "bin"), { recursive: true });
  await writeFile(path.join(packageDir, "dist", "src", "cli.js"), "");
  await writeFile(path.join(packageDir, "dist", "protocol", "index.js"), "");
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ engines: { node: ">=22.0.0" }, version: "0.1.0" }),
  );
  await writeFile(path.join(packageDir, "package-lock.json"), "{}");
  await writeFile(
    path.join(packageDir, "build-identity.json"),
    JSON.stringify({
      buildIdentity: "gxserver:0.1.0:sha256:test",
      fingerprint: "sha256:test",
      packageVersion: "0.1.0",
    }),
  );
  await makeExecutable(path.join(packageDir, "bin", "gxserver"));
  await makeExecutable(path.join(packageDir, "bin", "zmx"));
  await makeExecutable(path.join(packageDir, "bin", "zehn"));
  await makeExecutable(path.join(packageDir, "bin", "bd"));
}
