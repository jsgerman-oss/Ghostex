import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GXSERVER_LOCAL_API_HOST,
  GXSERVER_LOCAL_API_PORT,
  type GxserverServerId,
  type GxserverSessionId,
} from "../protocol/index.js";
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
      "0005_session_tags",
      "0006_expand_session_tags",
      "0007_expand_session_tags_in_progress_and_type",
      "0008_remove_retired_session_type_tags",
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

      assert.equal(migrations?.count, 8);
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

test("session tag expansion migrations allow newly added tag values on existing databases", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-storage-tags-"));
  try {
    const paths = getGxserverPaths(homeDir);
    await mkdir(paths.rootDir, { recursive: true });
    const db = openGxserverDatabase(paths);
    try {
      runGxserverMigrations(db, GxserverStorageMigrations.slice(0, 5));
      const repository = new GxserverDomainRepository(db, "S90" as GxserverServerId, {
        createProjectId: () => "P1tag",
        createSessionId: (() => {
          const ids = ["G1old", "G2new", "G3wip", "G4typ", "G5des"] as const;
          let index = 0;
          return () => ids[index++] ?? "G3extra";
        })(),
        now: () => "2026-06-05T10:45:00.000Z",
      });
      const project = repository.createProject({ name: "Ghostex", path: "/repo/ghostex" });
      repository.createSession({
        projectId: project.projectId,
        sessionTag: "todo",
        title: "Old allowed tag",
      });

      /*
      CDXC:SessionTags 2026-06-05-14:45:
      Databases that already ran the original sessionTag migration have a SQLite CHECK constraint with the old allowed value list. Rebuild that table constraint so Testing and Blocked can be stored without requiring a new database.
      */
      runGxserverMigrations(db, GxserverStorageMigrations.slice(5, 6));

      repository.updateSession({
        projectId: project.projectId,
        sessionId: "G1old" as GxserverSessionId,
        sessionTag: "testing",
      });
      repository.createSession({
        projectId: project.projectId,
        sessionTag: "blocked",
        title: "Blocked tag",
      });

      /*
      CDXC:SessionTags 2026-06-05-15:22:
      In Progress and Type tags were added after Testing and Blocked, so databases
      that already ran migration 0006 need migration 0007 before the runtime can
      store the new values.
      */
      runGxserverMigrations(db, GxserverStorageMigrations.slice(6, 7));
      repository.createSession({
        projectId: project.projectId,
        sessionTag: "in-progress",
        title: "In Progress tag",
      });
      repository.createSession({
        projectId: project.projectId,
        sessionTag: "bug",
        title: "Bug tag",
      });
      repository.createSession({
        projectId: project.projectId,
        sessionTag: "design",
        title: "Design tag",
      });

      /*
      CDXC:SessionTags 2026-06-05-19:12:
      Databases that already reached the prior tag schema can retain values that are no longer in the supported tag registry. Migration 0008 clears unsupported values before rebuilding the CHECK constraint, while retaining the current Type tags.
      */
      db.pragma("ignore_check_constraints = ON");
      db.prepare("UPDATE sessions SET sessionTag = ? WHERE sessionId = ?").run("retired-type", "G4typ");
      db.pragma("ignore_check_constraints = OFF");
      runGxserverMigrations(db, GxserverStorageMigrations.slice(7, 8));

      const rows = db
        .prepare<[], { sessionId: string; sessionTag: string | null }>(
          "SELECT sessionId, sessionTag FROM sessions ORDER BY sessionId",
        )
        .all();
      assert.deepEqual(rows, [
        { sessionId: "G1old", sessionTag: "testing" },
        { sessionId: "G2new", sessionTag: "blocked" },
        { sessionId: "G3wip", sessionTag: "in-progress" },
        { sessionId: "G4typ", sessionTag: null },
        { sessionId: "G5des", sessionTag: "design" },
      ]);
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
        createSessionId: () => "G6extra",
        now: () => "2026-06-04T16:21:00.000Z",
      });
      const project = repository.createProject({ name: "Ghostex", path: "/repo/ghostex" });
      const insertLegacySession = db.prepare<{
        isFavorite: number;
        lifecycleState: string;
        now: string;
        projectId: string;
        runtimeSettingsJson: string;
        sessionId: string;
        title: string;
        zmxName: string;
      }>(`
        INSERT INTO sessions (
          projectId,
          sessionId,
          kind,
          title,
          lifecycleState,
          providerStateJson,
          zmxName,
          isPinned,
          isFavorite,
          launchSettingsJson,
          runtimeSettingsJson,
          completionRulesJson,
          attentionRulesJson,
          notificationRulesJson,
          worktreeJson,
          createdAt,
          updatedAt
        )
        VALUES (
          @projectId,
          @sessionId,
          'terminal',
          @title,
          @lifecycleState,
          '{}',
          @zmxName,
          0,
          @isFavorite,
          '{}',
          @runtimeSettingsJson,
          '{}',
          '{}',
          '{}',
          '{}',
          @now,
          @now
        )
      `);
      const seedLegacySession = (input: {
        isFavorite?: boolean;
        lifecycleState: string;
        runtimeSettings?: Record<string, unknown>;
        sessionId: string;
        title: string;
      }) => {
        insertLegacySession.run({
          isFavorite: input.isFavorite === true ? 1 : 0,
          lifecycleState: input.lifecycleState,
          projectId: project.projectId,
          runtimeSettingsJson: JSON.stringify(input.runtimeSettings ?? {}),
          sessionId: input.sessionId,
          title: input.title,
          now: "2026-06-04T16:21:00.000Z",
          zmxName: `S90-${project.projectId}-${input.sessionId}`,
        });
      };

      /*
      CDXC:SessionTags 2026-06-05-14:45:
      This test intentionally seeds migration-0003 session rows directly. The
      current repository writes sessionTag, which did not exist before migration
      0005 and would stop this migration-0004 fixture from representing an old
      database.
      */
      seedLegacySession({
        lifecycleState: "stopped",
        runtimeSettings: { titleSource: "placeholder" },
        sessionId: "G1noi",
        title: "Terminal Session",
      });
      seedLegacySession({
        lifecycleState: "stopped",
        runtimeSettings: { titleSource: "terminal-auto" },
        sessionId: "G2kee",
        title: "Useful restore row",
      });
      seedLegacySession({
        isFavorite: true,
        lifecycleState: "stopped",
        runtimeSettings: { titleSource: "placeholder" },
        sessionId: "G3fav",
        title: "Codex Session",
      });
      seedLegacySession({
        lifecycleState: "unknown",
        runtimeSettings: { titleSource: "terminal-auto" },
        sessionId: "G4unk",
        title: "Unknown stale row",
      });
      seedLegacySession({
        lifecycleState: "running",
        sessionId: "G5run",
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
