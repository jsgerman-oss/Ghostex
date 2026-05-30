import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GxserverDomainRepository } from "../src/domain-state.js";
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
  });
});

test("client-local layout round-trips separately from shared project and session state", async () => {
  await withDomainRepository(async (repository) => {
    const project = repository.createProject({
      isPinned: true,
      launchSettings: { terminalEngine: "ghostty" },
      name: "Ghostex",
    });
    const session = repository.createSession({ projectId: project.projectId, title: "Shared title" });
    const layout = repository.updateClientLayout({
      clientId: "macos-sidebar",
      layout: {
        browserPanes: ["docs"],
        split: "right",
        tabs: [session.sessionId],
        visibleSessionCount: 1,
      },
      projectId: project.projectId,
    });

    assert.equal(layout.projectId, project.projectId);
    assert.equal(layout.layout.split, "right");
    assert.deepEqual(repository.readClientLayout({ clientId: "macos-sidebar", projectId: project.projectId }), layout);

    const rereadProject = repository.getProject(project.projectId);
    const rereadSession = repository.getSession(project.projectId, session.sessionId);
    assert.equal(rereadProject?.isPinned, true);
    assert.deepEqual(rereadProject?.launchSettings, { terminalEngine: "ghostty" });
    assert.equal(rereadSession?.title, "Shared title");
    assert.equal("layout" in (rereadProject ?? {}), false);
    assert.equal("layout" in (rereadSession ?? {}), false);
  });
});

async function withDomainRepository(
  run: (repository: GxserverDomainRepository) => Promise<void> | void,
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
      await run(repository);
    } finally {
      db.close();
    }
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

function createTimestampFactory(): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `2026-05-30T13:${String(index).padStart(2, "0")}:00.000Z`;
  };
}
