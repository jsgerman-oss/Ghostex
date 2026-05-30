import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureGxserverAuthToken, readGxserverAuthToken } from "../src/auth.js";
import { getGxserverPaths } from "../src/paths.js";

test("auth token is generated once at the gxserver auth path", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-auth-"));
  try {
    const paths = getGxserverPaths(homeDir);
    const first = await ensureGxserverAuthToken(paths);
    const second = await ensureGxserverAuthToken(paths);
    const read = await readGxserverAuthToken(paths);

    assert.equal(first.tokenFile, path.join(homeDir, ".ghostex", "gxserver", "auth", "token"));
    assert.equal(second.token, first.token);
    assert.equal(read?.token, first.token);
    assert.match(first.token, /^[A-Za-z0-9_-]{32,}$/);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("auth token file permissions are strict where chmod modes are supported", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX file modes.");
    return;
  }

  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-auth-mode-"));
  try {
    const paths = getGxserverPaths(homeDir);
    await ensureGxserverAuthToken(paths);
    assert.equal((await stat(paths.authTokenFile)).mode & 0o777, 0o600);

    await chmod(paths.authTokenFile, 0o644);
    await ensureGxserverAuthToken(paths);
    assert.equal((await stat(paths.authTokenFile)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.authDir)).mode & 0o777, 0o700);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});
