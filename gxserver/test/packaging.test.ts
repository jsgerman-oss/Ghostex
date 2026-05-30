import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gxserverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("server package stages compiled daemon, system-Node launcher, and bundled zmx/zehn", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-package-test-"));
  const packageDir = path.join(gxserverRoot, "dist", `test-server-package-${process.pid}`);
  try {
    const zmxBin = path.join(tempRoot, "zmx");
    const zehnBin = path.join(tempRoot, "zehn");
    await makeExecutable(zmxBin);
    await makeExecutable(zehnBin);

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
    await stat(path.join(packageDir, "bin", "zmx"));
    await stat(path.join(packageDir, "bin", "zehn"));
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
      ["scripts/package-gxserver.mjs", "--package-dir", outsideDir, "--zmx-bin", "/bin/sh", "--zehn-bin", "/bin/sh"],
      { cwd: gxserverRoot, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /must be under/);
  } finally {
    await rm(outsideDir, { force: true, recursive: true });
  }
});

async function makeExecutable(executablePath: string): Promise<void> {
  await mkdir(path.dirname(executablePath), { recursive: true });
  await writeFile(executablePath, "#!/bin/sh\nexit 0\n");
  await chmod(executablePath, 0o755);
}
