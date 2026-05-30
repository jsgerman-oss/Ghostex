import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GxserverDomainRepository } from "../src/domain-state.js";
import {
  LEGACY_MACOS_STATE_IMPORT_ID,
  migrateLegacyMacosStateIntoGxserver,
} from "../src/legacy-macos-state-migration.js";
import { createGxserverLogger } from "../src/logger.js";
import { getGxserverPaths } from "../src/paths.js";
import { initializeGxserverStorage, openGxserverDatabase } from "../src/storage.js";
import type { GxserverProjectId, GxserverSessionId } from "../protocol/index.js";

test("first-run import migrates macOS sidebar projects, active and sleeping sessions, metadata, settings, commands, and logs", async () => {
  await withLegacyImportFixture(async (fixture) => {
    const beforeSettingsText = await readFile(fixture.sharedSettingsFile, "utf8");
    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    assert.equal(result.status.id, LEGACY_MACOS_STATE_IMPORT_ID);
    assert.equal(result.status.projectsImported, 2);
    assert.equal(result.status.sessionsImported, 4);
    assert.equal(result.status.logsImported?.migratedLineCount, 2);

    assert.equal(await readFile(fixture.sharedSettingsFile, "utf8"), beforeSettingsText);
    assert.equal((await stat(`${fixture.sharedProjectsFile}.legacy-before-gxserver`)).isFile(), true);
    assert.equal((await stat(`${fixture.sharedPreviousSessionsFile}.legacy-before-gxserver`)).isFile(), true);
    const rewrittenSharedProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    assert.equal(rewrittenSharedProjects.activeProjectId, "P3a91");
    assert.equal(rewrittenSharedProjects.projects[0].projectId, "P3a91");
    assert.equal(rewrittenSharedProjects.projects[0].workspace.groups[0].snapshot.sessions[0].sessionId, "G8v20");
    assert.equal(
      rewrittenSharedProjects.projects[0].workspace.groups[0].snapshot.sessions[0].sessionPersistenceName,
      "legacy-zmx-live",
    );
    assert.deepEqual(rewrittenSharedProjects.projects[0].workspace.groups[0].snapshot.visibleSessionIds, ["G8v20"]);
    assert.equal(rewrittenSharedProjects.projects[0].commandsPanel.activeSessionId, "G2abc");
    assert.equal(rewrittenSharedProjects.projects[0].beadConversationLinks[0].sessionId, "G8v20");
    assert.equal(rewrittenSharedProjects.projects[1].worktree.parentProjectId, "P3a91");
    const rewrittenPreviousSessions = JSON.parse(await readFile(fixture.sharedPreviousSessionsFile, "utf8")) as any[];
    assert.equal(rewrittenPreviousSessions[0].projectId, "P3a91");
    assert.equal(rewrittenPreviousSessions[0].sessionId, "legacy-prev");

    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      const projects = repository.listProjects();
      const sessions = repository.listSessions();

      assert.deepEqual(
        projects.map((project) => project.projectId),
        ["P3a91", "P4b22"],
      );
      const mainProject = projects.find((project) => project.projectId === "P3a91");
      const mainRuntimeSettings = mainProject?.runtimeSettings as any;
      const mainProjectBoardConfig = mainProject?.projectBoardConfig as any;
      const mainGitConfig = mainProject?.gitConfig as any;
      assert.equal(mainProject?.name, "Ghostex");
      assert.equal(mainProject?.path, fixture.projectPath);
      assert.equal(mainProject?.customAgents[0]?.agentId, "codex-pro");
      assert.equal(mainProject?.customAgentOrder[0], "codex-pro");
      assert.equal(mainProject?.customCommands[0]?.commandId, "ship");
      assert.equal(mainProject?.customCommandOrder[0], "ship");
      assert.equal(mainProject?.deletedDefaultCommandIds[0], "build");
      assert.equal(mainRuntimeSettings?.settings?.sessionPersistenceProvider, "zmx");
      assert.equal(mainRuntimeSettings?.settings?.autoSleepAgentSessionsEnabled, true);
      assert.equal(mainProject?.completionRules.completionBellEnabled, true);
      assert.equal(mainProject?.attentionRules.showMacOSAttentionNotifications, true);
      assert.equal(mainProject?.previousSessionHistory[0]?.historyId, "hist-1");
      assert.equal((mainProject?.previousSessionHistory[0] as any)?.hiddenRestoreMetadata?.legacySessionId, "legacy-prev");
      assert.equal(JSON.stringify(mainProject?.previousSessionHistory).includes("restored from"), false);
      assert.equal(mainProjectBoardConfig?.beadsDisplayKey, "GX");
      assert.equal(mainGitConfig?.primaryAction, "pr");

      const importedSessions = sessions.filter((session) => session.projectId === "P3a91");
      assert.deepEqual(
        importedSessions.map((session) => session.sessionId).sort(),
        ["G1z99", "G2abc", "G8v20"],
      );
      const live = importedSessions.find((session) => session.sessionId === "G8v20");
      assert.equal(live?.title, "  Exact Codex Title  ");
      assert.equal(live?.kind, "agent");
      assert.equal(live?.isPinned, true);
      assert.equal(live?.isFavorite, true);
      assert.equal(live?.lifecycleState, "running");
      assert.equal(live?.zmxName, "P3a91-G8v20");
      assert.equal(live?.providerState.legacyProvider, "zmx");
      assert.equal(live?.providerState.legacyProviderSessionName, "legacy-zmx-live");
      assert.equal(live?.providerState.zmxName, "P3a91-G8v20");
      assert.equal(live?.runtimeSettings.agentSessionId, "codex-thread-1");
      assert.equal(live?.launchSettings.firstUserMessage, "Fix the sidebar");

      const sleeping = importedSessions.find((session) => session.sessionId === "G1z99");
      assert.equal(sleeping?.title, "Sleeping Agent");
      assert.equal(sleeping?.lifecycleState, "sleeping");
      assert.equal(sleeping?.providerState.legacyProvider, "tmux");
      assert.equal(sleeping?.providerState.legacyProviderSessionName, "legacy-tmux-sleep");
      assert.equal(sleeping?.commandId, "Dev");

      const commandPane = importedSessions.find((session) => session.sessionId === "G2abc");
      assert.equal(commandPane?.launchSettings.surface, "commands");
      assert.equal(commandPane?.title, "Build pane");

      const logEntries = (await readFile(fixture.paths.logFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, any>);
      assert.equal(logEntries.some((entry) => entry.event.startsWith("legacy.agentDetection.")), true);
      assert.equal(logEntries.some((entry) => entry.event.startsWith("legacy.zmx.")), true);
      assert.equal(logEntries.some((entry) => entry.event === "migration.legacyMacosState.completed"), true);
    } finally {
      db.close();
    }
  });
});

test("already-migrated state skips without importing rows again", async () => {
  await withLegacyImportFixture(async (fixture) => {
    await runImport(fixture);
    await writeFile(
      fixture.sharedProjectsFile,
      await readFile(`${fixture.sharedProjectsFile}.legacy-before-gxserver`, "utf8"),
      "utf8",
    );
    const staleProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    staleProjects.projects[0].workspace.groups[0].snapshot.sessions.push({
      alias: "stale",
      displayId: "stale",
      kind: "terminal",
      sessionId: "legacy-after-import",
      sessionPersistenceName: "legacy-after-import",
      sessionPersistenceProvider: "zmx",
      slotIndex: 9,
      title: "Created after broken import",
    });
    await writeFile(fixture.sharedProjectsFile, JSON.stringify(staleProjects), "utf8");
    await writeFile(
      fixture.sharedPreviousSessionsFile,
      await readFile(`${fixture.sharedPreviousSessionsFile}.legacy-before-gxserver`, "utf8"),
      "utf8",
    );
    fixture.sessionIds.push("G5new" as GxserverSessionId);
    const skipped = await runImport(fixture);

    assert.equal(skipped.status.status, "skipped");
    assert.equal(skipped.status.skippedReason, "alreadyCompleted");
    const repairedProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    assert.equal(repairedProjects.activeProjectId, "P3a91");
    assert.equal(repairedProjects.projects[0].workspace.groups[0].snapshot.sessions[0].sessionId, "G8v20");
    assert.equal(repairedProjects.projects[0].commandsPanel.activeSessionId, "G2abc");
    assert.equal(
      repairedProjects.projects[0].workspace.groups[0].snapshot.sessions.at(-1).sessionId,
      "G5new",
    );

    const db = openGxserverDatabase(fixture.paths);
    try {
      assert.equal(db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM projects").get()?.count, 2);
      assert.equal(db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM sessions").get()?.count, 5);
    } finally {
      db.close();
    }
  });
});

test("already-migrated repair imports legacy-shaped sessions written inside canonical projects", async () => {
  await withLegacyImportFixture(async (fixture) => {
    await runImport(fixture);
    const canonicalProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    canonicalProjects.projects[0].workspace.groups[0].snapshot.sessions.push({
      alias: "stale",
      displayId: "stale",
      kind: "terminal",
      sessionId: "g-0530-180140",
      sessionPersistenceName: "g-0530-180140",
      sessionPersistenceProvider: "zmx",
      slotIndex: 9,
      terminalEngine: "ghostty-native",
      title: "Broken pre-release session",
    });
    canonicalProjects.projects[0].workspace.groups[0].snapshot.focusedSessionId = "g-0530-180140";
    canonicalProjects.projects[0].workspace.groups[0].snapshot.visibleSessionIds = ["g-0530-180140"];
    await writeFile(fixture.sharedProjectsFile, JSON.stringify(canonicalProjects), "utf8");
    fixture.sessionIds.push("G6fix" as GxserverSessionId);

    const skipped = await runImport(fixture);

    assert.equal(skipped.status.status, "skipped");
    const repairedProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    const repairedSnapshot = repairedProjects.projects[0].workspace.groups[0].snapshot;
    assert.equal(repairedSnapshot.sessions.at(-1).sessionId, "G6fix");
    assert.equal(repairedSnapshot.focusedSessionId, "G6fix");
    assert.deepEqual(repairedSnapshot.visibleSessionIds, ["G6fix"]);

    const db = openGxserverDatabase(fixture.paths);
    try {
      const repairedSession = db
        .prepare<[string], { providerStateJson: string; sessionId: string }>(
          "SELECT sessionId, providerStateJson FROM sessions WHERE sessionId = ?",
        )
        .get("G6fix");
      assert.equal(repairedSession?.sessionId, "G6fix");
      assert.equal(JSON.parse(repairedSession?.providerStateJson ?? "{}").legacySessionId, "g-0530-180140");
    } finally {
      db.close();
    }
  });
});

test("oversized client-local legacy blobs are bounded without blocking first-launch import", async () => {
  await withLegacyImportFixture(async (fixture) => {
    const sharedProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as {
      projects: Array<Record<string, unknown>>;
    };
    sharedProjects.projects[0].iconDataUrl = `data:image/png;base64,${"x".repeat(1_100_000)}`;
    await writeFile(fixture.sharedProjectsFile, JSON.stringify(sharedProjects), "utf8");

    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      const mainProject = repository.getProject("P3a91");
      const identityIcon = mainProject?.identityIcon as any;
      assert.match(identityIcon.iconDataUrl, /gxserverMigrationTruncated/);
      assert.equal(identityIcon.iconDataUrl.length < 150_000, true);
    } finally {
      db.close();
    }
  });
});

test("empty legacy state records an idempotent marker and leaves legacy files untouched", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-empty-legacy-import-"));
  try {
    const paths = getGxserverPaths(homeDir);
    await initializeGxserverStorage(paths);
    const sharedStateDir = path.join(homeDir, ".ghostex", "state");
    await mkdir(sharedStateDir, { recursive: true });
    const settingsFile = path.join(sharedStateDir, "native-sidebar-settings.json");
    await writeFile(settingsFile, "{}", "utf8");
    const beforeText = await readFile(settingsFile, "utf8");

    const result = await migrateLegacyMacosStateIntoGxserver({
      createProjectId: () => "P3a91",
      createSessionId: () => "G8v20",
      legacyLogsDir: path.join(homeDir, ".ghostex", "logs"),
      legacyStorageValues: {},
      logger: createGxserverLogger(paths),
      now: () => "2026-05-30T11:20:00.000Z",
      paths,
      serverId: "S7k",
      sharedStateDir,
    });

    assert.equal(result.status.status, "skipped");
    assert.equal(result.status.skippedReason, "noLegacyState");
    assert.equal(await readFile(settingsFile, "utf8"), beforeText);

    const second = await migrateLegacyMacosStateIntoGxserver({
      legacyLogsDir: path.join(homeDir, ".ghostex", "logs"),
      legacyStorageValues: {},
      logger: createGxserverLogger(paths),
      paths,
      serverId: "S7k",
      sharedStateDir,
    });
    assert.equal(second.status.status, "skipped");
    assert.equal(second.status.skippedReason, "alreadyCompleted");
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

interface LegacyImportFixture {
  legacyLogsDir: string;
  legacyStorageValues: Record<string, string>;
  paths: ReturnType<typeof getGxserverPaths>;
  projectPath: string;
  projectIds: GxserverProjectId[];
  sessionIds: GxserverSessionId[];
  sharedProjectsFile: string;
  sharedPreviousSessionsFile: string;
  sharedSettingsFile: string;
  sharedStateDir: string;
}

async function withLegacyImportFixture(run: (fixture: LegacyImportFixture) => Promise<void>): Promise<void> {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-legacy-import-"));
  try {
    const paths = getGxserverPaths(homeDir);
    await initializeGxserverStorage(paths);
    const sharedStateDir = path.join(homeDir, ".ghostex", "state");
    const legacyLogsDir = path.join(homeDir, ".ghostex", "logs");
    await mkdir(sharedStateDir, { recursive: true });
    await mkdir(legacyLogsDir, { recursive: true });
    const projectPath = path.join(homeDir, "repo", "ghostex");
    const worktreePath = path.join(homeDir, "repo", "ghostex-feature");
    const sharedProjectsFile = path.join(sharedStateDir, "native-sidebar-projects.json");
    const sharedPreviousSessionsFile = path.join(sharedStateDir, "native-sidebar-previous-sessions.json");
    const sharedSettingsFile = path.join(sharedStateDir, "native-sidebar-settings.json");

    await writeFile(
      sharedProjectsFile,
      JSON.stringify({
        activeProjectId: "legacy-project-main",
        projects: [
          createLegacyProjectFixture("legacy-project-main", "Ghostex", projectPath),
          createLegacyWorktreeProjectFixture("legacy-project-worktree", worktreePath, projectPath),
        ],
      }),
      "utf8",
    );
    await writeFile(
      sharedPreviousSessionsFile,
      JSON.stringify([
        {
          activity: "idle",
          alias: "1",
          closedAt: "2026-05-29T10:00:00.000Z",
          column: 0,
          historyId: "hist-1",
          isFocused: false,
          isGeneratedName: false,
          isRestorable: true,
          projectId: "legacy-project-main",
          projectName: "Ghostex",
          projectPath,
          primaryTitle: "Previous Exact",
          row: 0,
          sessionId: "legacy-prev",
          sessionRecord: {
            alias: "1",
            createdAt: "2026-05-29T09:00:00.000Z",
            displayId: "1",
            kind: "terminal",
            sessionId: "legacy-prev",
            sessionPersistenceName: "legacy-zmx-prev",
            sessionPersistenceProvider: "zmx",
            slotIndex: 0,
            terminalEngine: "ghostty-native",
            title: "Previous Exact",
          },
          shortcutLabel: "1",
        },
      ]),
      "utf8",
    );
    await writeFile(
      sharedSettingsFile,
      JSON.stringify({
        autoSleepAgentSessionsEnabled: true,
        completionBellEnabled: true,
        completionSound: "shamisen",
        defaultPromptAgentId: "codex-pro",
        sessionPersistenceProvider: "zmx",
        showMacOSAttentionNotifications: true,
        terminalEngine: "ghostty-native",
      }),
      "utf8",
    );
    await writeFile(
      path.join(legacyLogsDir, "agent-detection-debug.log"),
      "[2026-05-30 11:00:00.000 +0400] nativeSidebar.agentDetected {\"sessionId\":\"G8v20\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(legacyLogsDir, "native-terminal-focus-debug.log"),
      "[2026-05-30 11:01:00.000 +0400] nativeSidebar.zmxPersistenceFocus.requested {\"sessionId\":\"G8v20\"}\n",
      "utf8",
    );

    await run({
      legacyLogsDir,
      legacyStorageValues: {
        "ghostex-native-active-sessions-sort-mode": "lastActivity",
        "ghostex-native-agent-order": JSON.stringify(["codex-pro"]),
        "ghostex-native-agents": JSON.stringify([
          { agentId: "codex-pro", command: "codex --profile pro", isDefault: false, name: "Codex Pro" },
        ]),
        "ghostex-native-git-confirm-commit": "true",
        "ghostex-native-git-generate-commit-body": "false",
        "ghostex-native-git-primary-action": "pr",
        "ghostex-native-project-commands": JSON.stringify({
          "legacy-project-main": {
            commands: [
              {
                actionType: "terminal",
                closeTerminalOnExit: false,
                command: "npm run ship",
                commandId: "ship",
                isDefault: false,
                name: "Ship",
                playCompletionSound: true,
              },
            ],
            deletedDefaultCommandIds: ["build"],
            order: ["ship"],
          },
        }),
      },
      paths,
      projectIds: ["P3a91", "P4b22"],
      projectPath,
      sessionIds: ["G8v20", "G1z99", "G2abc", "G3def"],
      sharedProjectsFile,
      sharedPreviousSessionsFile,
      sharedSettingsFile,
      sharedStateDir,
    });
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function runImport(fixture: LegacyImportFixture) {
  return await migrateLegacyMacosStateIntoGxserver({
    createProjectId: () => fixture.projectIds.shift() ?? "P9zzz",
    createSessionId: () => fixture.sessionIds.shift() ?? "G9zzz",
    legacyLogsDir: fixture.legacyLogsDir,
    legacyStorageValues: fixture.legacyStorageValues,
    logger: createGxserverLogger(fixture.paths),
    now: () => "2026-05-30T11:10:00.000Z",
    paths: fixture.paths,
    serverId: "S7k",
    sharedStateDir: fixture.sharedStateDir,
  });
}

function createLegacyProjectFixture(projectId: string, name: string, projectPath: string) {
  return {
    beadsDisplayKey: "GX",
    beadConversationLinks: [{ issueId: "gxserver-9", sessionId: "legacy-live" }],
    commandsPanel: {
      activeSessionId: "legacy-command",
      heightRatio: 0.3,
      isVisible: true,
      mode: "pinned",
      sessions: [
        {
          alias: "3",
          commandTitle: "Build",
          createdAt: "2026-05-30T09:10:00.000Z",
          displayId: "3",
          kind: "terminal",
          sessionId: "legacy-command",
          slotIndex: 0,
          surface: "commands",
          terminalEngine: "ghostty-native",
          title: "Build pane",
        },
      ],
    },
    icon: { kind: "symbol", symbol: "terminal" },
    name,
    path: projectPath,
    projectId,
    themeColor: "#22c55e",
    worktreeCommand: "git worktree add",
    workspace: {
      activeGroupId: "group-1",
      groups: [
        {
          groupId: "group-1",
          snapshot: {
            sessions: [
              {
                agentName: "codex",
                agentSessionId: "codex-thread-1",
                alias: "1",
                createdAt: "2026-05-30T09:00:00.000Z",
                displayId: "1",
                firstUserMessage: "Fix the sidebar",
                isFavorite: true,
                isPinned: true,
                isSleeping: false,
                kind: "terminal",
                lastActivityAt: "2026-05-30T09:30:00.000Z",
                sessionId: "legacy-live",
                sessionPersistenceName: "legacy-zmx-live",
                sessionPersistenceProvider: "zmx",
                slotIndex: 0,
                terminalEngine: "ghostty-native",
                title: "  Exact Codex Title  ",
                titleSource: "user",
              },
              {
                alias: "2",
                commandTitle: "Dev",
                createdAt: "2026-05-30T09:05:00.000Z",
                displayId: "2",
                isSleeping: true,
                kind: "terminal",
                sessionId: "legacy-sleep",
                slotIndex: 1,
                terminalEngine: "ghostty-native",
                title: "Sleeping Agent",
                tmuxSessionName: "legacy-tmux-sleep",
              },
              {
                alias: "B",
                browser: { url: "https://example.com" },
                createdAt: "2026-05-30T09:06:00.000Z",
                displayId: "B",
                kind: "browser",
                sessionId: "legacy-browser",
                slotIndex: 2,
                title: "Browser stays client-local",
              },
            ],
            visibleCount: 1,
            visibleSessionIds: ["legacy-live"],
            viewMode: "grid",
          },
          title: "Main",
        },
      ],
      nextGroupNumber: 2,
      nextSessionDisplayId: 4,
      nextSessionNumber: 4,
    },
  };
}

function createLegacyWorktreeProjectFixture(projectId: string, worktreePath: string, parentProjectPath: string) {
  return {
    commandsPanel: { heightRatio: 0.3, isVisible: false, mode: "pinned", sessions: [] },
    name: "Ghostex Feature",
    path: worktreePath,
    projectId,
    worktree: {
      branch: "feature/gxserver",
      createdAt: "2026-05-30T08:00:00.000Z",
      name: "ghostex-feature",
      parentProjectId: "legacy-project-main",
      parentProjectName: "Ghostex",
      parentProjectPath,
    },
    workspace: {
      activeGroupId: "group-1",
      groups: [
        {
          groupId: "group-1",
          snapshot: {
            sessions: [
              {
                agentName: "claude",
                alias: "1",
                createdAt: "2026-05-30T08:10:00.000Z",
                displayId: "1",
                kind: "terminal",
                sessionId: "legacy-worktree-session",
                sessionPersistenceName: "legacy-worktree-zmx",
                sessionPersistenceProvider: "zmx",
                slotIndex: 0,
                terminalEngine: "ghostty-native",
                title: "Worktree Agent",
              },
            ],
            visibleCount: 1,
            visibleSessionIds: ["legacy-worktree-session"],
            viewMode: "grid",
          },
          title: "Main",
        },
      ],
      nextGroupNumber: 2,
      nextSessionDisplayId: 2,
      nextSessionNumber: 2,
    },
  };
}
