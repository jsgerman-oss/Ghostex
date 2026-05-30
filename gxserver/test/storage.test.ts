import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GXSERVER_LOCAL_API_HOST, GXSERVER_LOCAL_API_PORT } from "../protocol/index.js";
import { getGxserverPaths } from "../src/paths.js";
import { initializeGxserverStorage, openGxserverDatabase, readGxserverConfig } from "../src/storage.js";

test("gxserver storage paths represent the required root layout", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-storage-paths-"));
  try {
    const paths = getGxserverPaths(homeDir);
    assert.equal(paths.rootDir, path.join(homeDir, ".ghostex", "gxserver"));
    assert.equal(paths.authTokenFile, path.join(paths.rootDir, "auth", "token"));
    assert.equal(paths.configFile, path.join(paths.rootDir, "config.json"));
    assert.equal(paths.stateDbFile, path.join(paths.rootDir, "state.db"));
    assert.equal(paths.logFile, path.join(paths.rootDir, "logs", "gxserver.jsonl"));
    assert.equal(paths.runtimeDir, path.join(paths.rootDir, "runtime"));
    assert.equal(paths.zmxDir, path.join(paths.rootDir, "zmx"));
    assert.equal(paths.migrationsDir, path.join(paths.rootDir, "migrations"));
    assert.equal(paths.identityFile, path.join(paths.rootDir, "identity.json"));
    const config = await readGxserverConfig(paths);
    assert.equal(config.listeners.local.enabled, true);
    assert.equal(config.listeners.local.host, GXSERVER_LOCAL_API_HOST);
    assert.equal(config.listeners.local.port, GXSERVER_LOCAL_API_PORT);
    assert.equal(config.listeners.remote.enabled, false);
    assert.deepEqual(config.listeners.remote.auth, { mode: "bearerToken", required: true });
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("gxserver config keeps the local listener fixed while allowing remote listener overrides", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-storage-config-"));
  try {
    const paths = getGxserverPaths(homeDir);
    await initializeGxserverStorage(paths);
    await writeFile(
      paths.configFile,
      `${JSON.stringify({
        listeners: {
          local: {
            enabled: false,
            host: GXSERVER_LOCAL_API_HOST,
            kind: "remote",
            port: GXSERVER_LOCAL_API_PORT,
          },
          remote: {
            enabled: true,
            host: "100.64.0.12",
            port: 59000,
          },
        },
      })}\n`,
    );

    const config = await readGxserverConfig(paths);

    assert.deepEqual(config.listeners.local, {
      enabled: true,
      host: GXSERVER_LOCAL_API_HOST,
      kind: "local",
      port: GXSERVER_LOCAL_API_PORT,
    });
    assert.equal(config.listeners.remote.enabled, true);
    assert.equal(config.listeners.remote.host, "100.64.0.12");
    assert.equal(config.listeners.remote.port, 59000);
    assert.deepEqual(config.listeners.remote.auth, { mode: "bearerToken", required: true });
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("gxserver config rejects attempted local listener host or port overrides", async () => {
  const cases = [
    {
      config: { listeners: { local: { host: "0.0.0.0" } } },
      message: /Local gxserver listener host is fixed at 127\.0\.0\.1/,
      name: "host",
    },
    {
      config: { listeners: { local: { port: 59000 } } },
      message: /Local gxserver listener port is fixed at 58744/,
      name: "port",
    },
  ];

  for (const testCase of cases) {
    const homeDir = await mkdtemp(path.join(tmpdir(), `gxserver-storage-local-${testCase.name}-`));
    try {
      const paths = getGxserverPaths(homeDir);
      await initializeGxserverStorage(paths);
      await writeFile(paths.configFile, `${JSON.stringify(testCase.config)}\n`);

      await assert.rejects(readGxserverConfig(paths), {
        name: "GxserverLocalListenerConfigError",
        message: testCase.message,
      });
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }
  }
});

test("SQLite migrations are idempotent and create foundation schema", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-storage-"));
  try {
    const paths = getGxserverPaths(homeDir);
    const first = await initializeGxserverStorage(paths);
    const second = await initializeGxserverStorage(paths);

    assert.deepEqual(first.appliedMigrations, ["0001_foundation", "0002_domain_state"]);
    assert.deepEqual(second.appliedMigrations, []);
    assert.equal((await stat(paths.stateDbFile)).isFile(), true);

    const db = openGxserverDatabase(paths);
    try {
      const migrations = db
        .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM schema_migrations")
        .get();
      const metadataTable = db
        .prepare<[string], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("metadata");
      const idsTable = db
        .prepare<[string], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("id_allocations");
      const projectsTable = db
        .prepare<[string], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("projects");
      const sessionsTable = db
        .prepare<[string], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("sessions");
      const clientLayoutsTable = db
        .prepare<[string], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("client_layouts");

      assert.equal(migrations?.count, 2);
      assert.equal(metadataTable?.name, "metadata");
      assert.equal(idsTable?.name, "id_allocations");
      assert.equal(projectsTable?.name, "projects");
      assert.equal(sessionsTable?.name, "sessions");
      assert.equal(clientLayoutsTable?.name, "client_layouts");
    } finally {
      db.close();
    }
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});
