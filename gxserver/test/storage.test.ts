import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GXSERVER_LOCAL_API_HOST, GXSERVER_LOCAL_API_PORT, type GxserverServerId } from "../protocol/index.js";
import { GxserverDomainRepository } from "../src/domain-state.js";
import { getGxserverPaths } from "../src/paths.js";
import {
  GxserverStorageMigrations,
  initializeGxserverStorage,
  openGxserverDatabase,
  readGxserverConfig,
  runGxserverMigrations,
} from "../src/storage.js";

test("gxserver storage paths represent the required root layout", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-storage-paths-"));
  try {
    const paths = getGxserverPaths(homeDir);
    assert.equal(paths.rootDir, path.join(homeDir, ".ghostex", "gxserver"));
    assert.equal(paths.authTokenFile, path.join(paths.rootDir, "auth", "token"));
    assert.equal(paths.configFile, path.join(paths.rootDir, "config.json"));
    assert.equal(paths.stateDbFile, path.join(paths.rootDir, "state.db"));
    assert.equal(paths.logsDir, path.join(homeDir, ".ghostex", "logs"));
    assert.equal(paths.logFile, path.join(homeDir, ".ghostex", "logs", "gxserver.jsonl"));
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

    assert.deepEqual(first.appliedMigrations, [
      "0001_foundation",
      "0002_domain_state",
      "0003_session_sidebar_order",
      "0004_previous_session_history_quality",
    ]);
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

      assert.equal(migrations?.count, 4);
      assert.equal(metadataTable?.name, "metadata");
      assert.equal(idsTable?.name, "id_allocations");
      assert.equal(projectsTable?.name, "projects");
      assert.equal(sessionsTable?.name, "sessions");
    } finally {
      db.close();
    }
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("previous-session quality migration removes placeholder inactive rows and backfills retained timestamps", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-storage-cleanup-"));
  try {
    const paths = getGxserverPaths(homeDir);
    await mkdir(paths.rootDir, { recursive: true });
    const db = openGxserverDatabase(paths);
    try {
      runGxserverMigrations(db, GxserverStorageMigrations.slice(0, 3));
      const repository = new GxserverDomainRepository(db, "S90" as GxserverServerId, {
        createProjectId: () => "P1cle",
        createSessionId: (() => {
          const ids = ["G1noi", "G2kee", "G3fav", "G4unk", "G5run"] as const;
          let index = 0;
          return () => ids[index++] ?? "G6extra";
        })(),
        now: () => "2026-06-04T16:21:00.000Z",
      });
      const project = repository.createProject({ name: "Ghostex", path: "/repo/ghostex" });
      repository.createSession({
        lifecycleState: "stopped",
        projectId: project.projectId,
        runtimeSettings: { titleSource: "placeholder" },
        title: "Terminal Session",
      });
      repository.createSession({
        lifecycleState: "stopped",
        projectId: project.projectId,
        runtimeSettings: { titleSource: "terminal-auto" },
        title: "Useful restore row",
      });
      repository.createSession({
        isFavorite: true,
        lifecycleState: "stopped",
        projectId: project.projectId,
        runtimeSettings: { titleSource: "placeholder" },
        title: "Codex Session",
      });
      repository.createSession({
        lifecycleState: "unknown",
        projectId: project.projectId,
        runtimeSettings: { titleSource: "terminal-auto" },
        title: "Unknown stale row",
      });
      repository.createSession({
        lifecycleState: "running",
        projectId: project.projectId,
        title: "Running row",
      });

      /*
      CDXC:PreviousSessions 2026-06-04-20:21:
      Existing gxserver databases can already contain inactive placeholder rows with no last-active metadata. The cleanup migration removes only low-signal inactive placeholders/unknowns and backfills retained inactive rows from updatedAt so the modal has a stable grouping timestamp.
      */
      runGxserverMigrations(db, GxserverStorageMigrations.slice(3, 4));

      const rows = db
        .prepare<[], { lastActiveAt: string | null; lifecycleState: string; sessionId: string }>(
          "SELECT sessionId, lifecycleState, lastActiveAt FROM sessions ORDER BY sessionId",
        )
        .all();
      assert.deepEqual(
        rows.map((row) => row.sessionId),
        ["G2kee", "G3fav", "G5run"],
      );
      assert.equal(rows.find((row) => row.sessionId === "G3fav")?.lastActiveAt, "2026-06-04T16:21:00.000Z");
      assert.equal(rows.find((row) => row.sessionId === "G2kee")?.lastActiveAt, "2026-06-04T16:21:00.000Z");
      assert.equal(rows.find((row) => row.sessionId === "G5run")?.lastActiveAt, null);
    } finally {
      db.close();
    }
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});
