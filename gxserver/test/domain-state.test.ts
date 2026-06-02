import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { GxserverDomainRepository, GxserverDomainStateError } from "../src/domain-state.js";
import { getGxserverPaths } from "../src/paths.js";
import { initializeGxserverStorage, openGxserverDatabase } from "../src/storage.js";
import type { GxserverProjectId, GxserverSessionId } from "../protocol/index.js";

test("domain repository creates, updates, and lists shared project metadata", async () => {
  await withDomainRepository(async (repository) => {
    const project = repository.createProject({
      attentionRules: { doneTitlePattern: "Done" },
      completionRules: { bell: true },
      customAgentOrder: ["codex-pro"],
      customAgents: [{ agentId: "codex-pro", command: "codex --profile pro", name: "Codex Pro" }],
      customCommandOrder: ["setup"],
      customCommands: [{ command: "npm install", commandId: "setup", name: "Setup" }],
      defaultCommand: "npm run dev",
      deletedDefaultCommandIds: ["build"],
      gitConfig: { defaultBranch: "main" },
      identityIcon: { color: "#22c55e", symbol: "terminal" },
      isFavorite: true,
      isPinned: true,
      launchSettings: { acceptAll: true },
      name: "Ghostex",
      notificationRules: { notifyOnAttention: true },
      path: "/repo/ghostex",
      previousSessionHistory: [{ historyId: "hist-1", primaryTitle: "Old run" }],
      projectBoardConfig: { beadPrefix: "gxserver" },
      runtimeSettings: { defaultPromptAgentId: "codex" },
      worktree: { branch: "main", parentProjectId: "P9zzz" },
    });

    assert.equal(project.projectId, "P3a91");
    assert.equal(project.isPinned, true);
    assert.equal(project.isFavorite, true);
    assert.equal(project.customAgents[0]?.agentId, "codex-pro");
    assert.equal(project.customCommands[0]?.commandId, "setup");
    assert.equal(project.runtimeSettings.defaultPromptAgentId, "codex");
    assert.equal(project.previousSessionHistory[0]?.historyId, "hist-1");

    const updated = repository.updateProject({
      projectId: project.projectId,
      isFavorite: false,
      name: "Ghostex Daemon",
      runtimeSettings: { defaultPromptAgentId: "claude" },
    });

    assert.equal(updated.name, "Ghostex Daemon");
    assert.equal(updated.isPinned, true);
    assert.equal(updated.isFavorite, false);
    assert.equal(updated.runtimeSettings.defaultPromptAgentId, "claude");
    assert.deepEqual(repository.listProjects().map((item) => item.projectId), ["P3a91"]);
  });
});

test("sessions use G IDs, zmx names, hidden previous-session metadata, and independent titles", async () => {
  await withDomainRepository(async (repository) => {
    const project = repository.createProject({ name: "Ghostex", path: "/repo/ghostex" });
    const original = repository.createSession({
      agentId: "codex",
      isFavorite: true,
      kind: "agent",
      lifecycleState: "running",
      projectId: project.projectId,
      providerState: { lifecycleState: "exists" },
      runtimeSettings: { acceptAll: true },
      title: "Original agent",
    });
    const restored = repository.createSession({
      isPinned: true,
      projectId: project.projectId,
      restoredFromHistoryId: "hist-1",
      restoredFromSessionId: original.sessionId,
      title: "Follow-up agent",
    });

    assert.equal(original.sessionId, "G8v20");
    assert.equal(restored.sessionId, "G1z99");
    assert.equal(restored.zmxName, "P3a91-G1z99");
    assert.equal(restored.globalRef, "S7k:P3a91:G1z99");
    assert.equal(restored.title, "Follow-up agent");
    assert.equal(restored.hiddenMetadata.restoredFromSessionId, "G8v20");
    assert.equal(restored.hiddenMetadata.restoredFromHistoryId, "hist-1");
    assert.equal(JSON.stringify(restored).includes("restored from"), false);

    const updated = repository.updateSession({
      projectId: project.projectId,
      sessionId: restored.sessionId,
      isFavorite: true,
      lifecycleState: "sleeping",
      providerState: { lifecycleState: "missing", probe: "cached" },
      runtimeSettings: { delayedSendMs: 250 },
    });

    assert.equal(updated.title, "Follow-up agent");
    assert.equal(updated.isPinned, true);
    assert.equal(updated.isFavorite, true);
    assert.equal(updated.lifecycleState, "sleeping");
    assert.equal(updated.providerState.lifecycleState, "missing");
    assert.equal(updated.providerState.zmxName, "P3a91-G1z99");
    assert.equal(updated.runtimeSettings.delayedSendMs, 250);
    assert.deepEqual(
      repository.listSessions(project.projectId).map((session) => session.sessionId),
      ["G1z99", "G8v20"],
    );

    /*
    CDXC:PreviousSessions 2026-06-02-11:24:
    Previous-session delete/restore cleanup must remove the canonical gxserver G-session row. A native-only delete would let stopped history reappear on the next gxserver listPreviousSessions query.
    */
    const removed = repository.removeSession({
      projectId: project.projectId,
      reason: "previous-session-delete",
      sessionId: restored.sessionId,
    });

    assert.equal(removed.sessionId, restored.sessionId);
    assert.deepEqual(
      repository.listSessions(project.projectId).map((session) => session.sessionId),
      ["G8v20"],
    );
    assert.throws(
      () =>
        repository.removeSession({
          projectId: project.projectId,
          sessionId: restored.sessionId,
        }),
      (error) =>
        error instanceof GxserverDomainStateError &&
        error.code === "notFound" &&
        /does not exist/.test(error.message),
    );
  });
});

test("temporary Search by Text session titles default to placeholder provenance", async () => {
  await withDomainRepository(async (repository) => {
    const project = repository.createProject({ name: "Ghostex", path: "/repo/ghostex" });
    const session = repository.createSession({
      kind: "terminal",
      projectId: project.projectId,
      title: "Search by Text",
    });

    assert.equal(session.title, "Search by Text");
    assert.equal(session.runtimeSettings.titleSource, "placeholder");

    const updated = repository.updateSession({
      projectId: project.projectId,
      runtimeSettings: { ...session.runtimeSettings, titleSource: "terminal-auto" },
      sessionId: session.sessionId,
      title: "Session Title From Terminal",
    });
    assert.equal(updated.title, "Session Title From Terminal");
    assert.equal(updated.runtimeSettings.titleSource, "terminal-auto");
  });
});

test("sessions expose command-pane surface without a separate migration column", async () => {
  await withDomainRepository(async (repository) => {
    const project = repository.createProject({ name: "Ghostex", path: "/repo/ghostex" });
    const session = repository.createSession({
      commandId: "bun run start",
      launchSettings: { commandTitle: "bun run start" },
      projectId: project.projectId,
      surface: "commands",
      title: "bun run start",
    });

    assert.equal(session.surface, "commands");
    assert.equal(session.launchSettings.surface, "commands");
    assert.equal(repository.listSessions(project.projectId)[0]?.surface, "commands");
  });
});

test("corrupt project JSON columns throw explicit corrupt-state errors without overwriting the row", async () => {
  await withDomainRepository(async (repository, db) => {
    const project = repository.createProject({
      name: "Ghostex",
      runtimeSettings: { defaultPromptAgentId: "codex" },
    });
    db.prepare("UPDATE projects SET runtimeSettingsJson = ? WHERE projectId = ?").run("{not-json", project.projectId);

    assertCorruptState(() => repository.getProject(project.projectId), /project P3a91 column runtimeSettingsJson/);
    assertCorruptState(() => repository.listProjects(), /project P3a91 column runtimeSettingsJson/);
    assertCorruptState(
      () => repository.updateProject({ name: "Should not persist", projectId: project.projectId }),
      /project P3a91 column runtimeSettingsJson/,
    );

    const stored = db
      .prepare<[string], { name: string; runtimeSettingsJson: string }>(
        "SELECT name, runtimeSettingsJson FROM projects WHERE projectId = ?",
      )
      .get(project.projectId);
    assert.equal(stored?.name, "Ghostex");
    assert.equal(stored?.runtimeSettingsJson, "{not-json");
  });
});

test("corrupt session JSON columns throw explicit corrupt-state errors without overwriting the row", async () => {
  await withDomainRepository(async (repository, db) => {
    const project = repository.createProject({ name: "Ghostex" });
    const session = repository.createSession({
      projectId: project.projectId,
      providerState: { lifecycleState: "exists", marker: "durable" },
      title: "Durable session",
    });
    db.prepare("UPDATE sessions SET providerStateJson = ? WHERE projectId = ? AND sessionId = ?").run(
      JSON.stringify("wrong-shape"),
      project.projectId,
      session.sessionId,
    );

    assertCorruptState(
      () => repository.getSession(project.projectId, session.sessionId),
      /session P3a91\/G8v20 column providerStateJson/,
    );
    assertCorruptState(() => repository.listSessions(project.projectId), /session P3a91\/G8v20 column providerStateJson/);
    assertCorruptState(
      () =>
        repository.updateSession({
          projectId: project.projectId,
          sessionId: session.sessionId,
          title: "Should not persist",
        }),
      /session P3a91\/G8v20 column providerStateJson/,
    );

    const stored = db
      .prepare<[string, string], { providerStateJson: string; title: string }>(
        "SELECT providerStateJson, title FROM sessions WHERE projectId = ? AND sessionId = ?",
      )
      .get(project.projectId, session.sessionId);
    assert.equal(stored?.title, "Durable session");
    assert.equal(stored?.providerStateJson, JSON.stringify("wrong-shape"));
  });
});

async function withDomainRepository(
  run: (repository: GxserverDomainRepository, db: Database.Database) => Promise<void> | void,
): Promise<void> {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-domain-state-"));
  const projectIds = ["P3a91", "P4b22"] as GxserverProjectId[];
  const sessionIds = ["G8v20", "G1z99", "G2abc"] as GxserverSessionId[];
  try {
    const paths = getGxserverPaths(homeDir);
    await initializeGxserverStorage(paths);
    const db = openGxserverDatabase(paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k", {
        createProjectId: () => projectIds.shift() ?? "P0aaa",
        createSessionId: () => sessionIds.shift() ?? "G0aaa",
        now: createTimestampFactory(),
      });
      await run(repository, db);
    } finally {
      db.close();
    }
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

function assertCorruptState(run: () => unknown, messagePattern: RegExp): void {
  assert.throws(run, (error) => {
    assert.equal(error instanceof GxserverDomainStateError, true);
    const domainError = error as GxserverDomainStateError;
    assert.equal(domainError.code, "corruptState");
    assert.match(domainError.message, messagePattern);
    assert.match(domainError.message, /persisted state is not overwritten/);
    return true;
  });
}

function createTimestampFactory(): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `2026-05-30T13:${String(index).padStart(2, "0")}:00.000Z`;
  };
}
