import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GxserverDomainRepository } from "../src/domain-state.js";
import {
  LEGACY_MACOS_STATE_IMPORT_ID,
  migrateLegacyMacosStateIntoGxserver,
} from "../src/legacy-macos-state-migration.js";
import { createGxserverLogger } from "../src/logger.js";
import { getGxserverPaths } from "../src/paths.js";
import { readGxserverPresentationSnapshot } from "../src/session-presentation/repository.js";
import { initializeGxserverStorage, openGxserverDatabase } from "../src/storage.js";
import type { GxserverProjectId, GxserverSessionId } from "../protocol/index.js";

test("first-run import migrates macOS sidebar projects, active and sleeping sessions, metadata, settings, commands, and logs", async () => {
  await withLegacyImportFixture(async (fixture) => {
    await updateNativeSidebarSettings(fixture.sharedSettingsFile, { debuggingMode: true });
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
    assert.equal(rewrittenSharedProjects.projects[0].beadConversationLinks[0].projectId, "P3a91");
    assert.deepEqual(rewrittenSharedProjects.projects[0].beadConversationLinks[0].metadata.sessionIds, ["G1z99"]);
    assert.equal(
      rewrittenSharedProjects.projects[0].beadConversationLinks[1].ghostexSessionId,
      "combined-session:P4b22:G3def",
    );
    assert.equal(rewrittenSharedProjects.projects[0].beadConversationLinks[1].note, "preserve me");
    assert.equal(rewrittenSharedProjects.projects[1].worktree.parentProjectId, "P3a91");
    const rewrittenPreviousSessions = JSON.parse(await readFile(fixture.sharedPreviousSessionsFile, "utf8")) as any[];
    assert.equal(rewrittenPreviousSessions[0].projectId, "P3a91");
    assert.equal(rewrittenPreviousSessions[0].sessionId, "G4hij");
    assert.equal(rewrittenPreviousSessions[0].sessionRecord.projectId, "P3a91");
    assert.equal(rewrittenPreviousSessions[0].sessionRecord.sessionId, "G4hij");
    assert.deepEqual(rewrittenPreviousSessions[0].relatedSessionIds, ["G4hij", "G8v20"]);

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
      assert.equal(mainProject?.previousSessionHistory[0]?.projectId, "P3a91");
      assert.equal(mainProject?.previousSessionHistory[0]?.sessionId, "G4hij");
      assert.equal((mainProject?.previousSessionHistory[0] as any)?.sessionRecord?.projectId, "P3a91");
      assert.equal((mainProject?.previousSessionHistory[0] as any)?.sessionRecord?.sessionId, "G4hij");
      assert.deepEqual((mainProject?.previousSessionHistory[0] as any)?.relatedSessionIds, ["G4hij", "G8v20"]);
      assert.deepEqual((mainProject?.previousSessionHistory[0] as any)?.sessionRecord?.relatedSessionIds, ["G4hij"]);
      assert.equal((mainProject?.previousSessionHistory[0] as any)?.hiddenRestoreMetadata?.legacySessionId, "legacy-prev");
      assert.equal(
        (mainProject?.previousSessionHistory[0] as any)?.hiddenRestoreMetadata?.sessionRecord?.sessionId,
        "legacy-prev",
      );
      assert.equal(JSON.stringify(mainProject?.previousSessionHistory).includes("restored from"), false);
      assert.equal(mainProjectBoardConfig?.beadsDisplayKey, "GX");
      assert.equal(mainProjectBoardConfig?.beadConversationLinks?.[0]?.sessionId, "G8v20");
      assert.equal(mainProjectBoardConfig?.beadConversationLinks?.[0]?.projectId, "P3a91");
      assert.deepEqual(mainProjectBoardConfig?.beadConversationLinks?.[0]?.metadata?.sessionIds, ["G1z99"]);
      assert.equal(
        mainProjectBoardConfig?.beadConversationLinks?.[1]?.ghostexSessionId,
        "combined-session:P4b22:G3def",
      );
      assert.equal(mainProjectBoardConfig?.beadConversationLinks?.[1]?.note, "preserve me");
      assert.equal(mainGitConfig?.primaryAction, "pr");
      const storedProjectRow = db
        .prepare<[string], { previousSessionHistoryJson: string }>(
          "SELECT previousSessionHistoryJson FROM projects WHERE projectId = ?",
        )
        .get("P3a91");
      const storedPreviousSessionHistory = JSON.parse(storedProjectRow?.previousSessionHistoryJson ?? "[]") as any[];
      assert.equal(storedPreviousSessionHistory[0].projectId, "P3a91");
      assert.equal(storedPreviousSessionHistory[0].sessionId, "G4hij");
      assert.equal(storedPreviousSessionHistory[0].sessionRecord.projectId, "P3a91");
      assert.equal(storedPreviousSessionHistory[0].sessionRecord.sessionId, "G4hij");
      assert.deepEqual(storedPreviousSessionHistory[0].relatedSessionIds, ["G4hij", "G8v20"]);
      assert.equal(storedPreviousSessionHistory[0].hiddenRestoreMetadata.legacySessionId, "legacy-prev");
      assert.equal(storedPreviousSessionHistory[0].hiddenRestoreMetadata.sessionRecord.sessionId, "legacy-prev");

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
      assert.equal(live?.zmxName, "S7k-P3a91-G8v20");
      assert.equal(live?.providerState.legacyProvider, "zmx");
      assert.equal(live?.providerState.legacyProviderSessionName, "legacy-zmx-live");
      assert.equal(live?.providerState.zmxName, "S7k-P3a91-G8v20");
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

test("first-run import projects hydrate gxserver presentation groups for existing 3.6 sidebars", async () => {
  await withLegacyImportFixture(async (fixture) => {
    /*
    CDXC:GxserverMigration 2026-06-06-23:16:
    Users upgrading from Ghostex 3.6 already have projects and sessions in the macOS sidebar snapshot. First 4.0 launch must project those imported DB projects into gxserver presentation groups immediately so the native sidebar never depends on a separately initialized `sidebar.groups` store.
    */
    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    assert.equal(result.status.projectsImported, 2);
    assert.equal(result.status.sessionsImported, 4);

    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      const projects = repository.listProjects();
      const presentation = readGxserverPresentationSnapshot(db, "S7k", "2026-06-06T19:16:00.000Z");

      assert.equal(presentation.projects.length, projects.length);
      assert.equal(presentation.groups.length, projects.length);
      for (const project of projects) {
        const presentationProject = presentation.projects.find((candidate) => candidate.projectId === project.projectId);
        const presentationGroup = presentation.groups.find((candidate) => candidate.projectId === project.projectId);
        assert.equal(presentationProject?.projectId, project.projectId);
        assert.deepEqual(presentationProject?.groupIds, [`${project.projectId}:active`]);
        assert.equal(presentationGroup?.groupId, `${project.projectId}:active`);
      }

      const mainGroup = presentation.groups.find((group) => group.projectId === "P3a91");
      const worktreeGroup = presentation.groups.find((group) => group.projectId === "P4b22");
      assert.deepEqual([...(mainGroup?.sessionIds ?? [])].sort(), ["G1z99", "G2abc", "G8v20"].sort());
      assert.deepEqual(worktreeGroup?.sessionIds, ["G3def"]);
    } finally {
      db.close();
    }
  });
});

test("first-run import preserves client-local browser and T3 pane IDs in migrated shared projects", async () => {
  await withLegacyImportFixture(async (fixture) => {
    /*
    CDXC:GxserverVerification 2026-05-30-22:45:
    gxserver migration should canonicalize daemon-owned terminal IDs without taking ownership of browser/T3 panes. Browser and T3 panes remain macOS sidebar-local, so their `g-*` pane IDs must survive the shared-project rewrite and continue to match layout references.
    */
    const sharedProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    const snapshot = sharedProjects.projects[0].workspace.groups[0].snapshot;
    const browserSession = snapshot.sessions.find((session: any) => session.kind === "browser");
    browserSession.sessionId = "g-0530-180140";
    snapshot.sessions.push({
      alias: "T3",
      createdAt: "2026-05-30T09:07:00.000Z",
      displayId: "T3",
      kind: "t3",
      sessionId: "g-0530-180141",
      slotIndex: 3,
      t3: { boundThreadId: "thread-1" },
      title: "T3 Code",
    });
    snapshot.focusedSessionId = "g-0530-180140";
    snapshot.paneLayout = {
      direction: "horizontal",
      first: { kind: "leaf", sessionId: "legacy-live" },
      kind: "split",
      ratio: 0.5,
      second: {
        kind: "tabs",
        selectedSessionId: "g-0530-180140",
        sessionIds: ["g-0530-180140", "g-0530-180141"],
      },
    };
    snapshot.visibleSessionIds = ["legacy-live", "g-0530-180140", "g-0530-180141"];
    await writeFile(fixture.sharedProjectsFile, JSON.stringify(sharedProjects), "utf8");

    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    assert.equal(result.status.sessionsImported, 4);
    const rewrittenSharedProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    const rewrittenSnapshot = rewrittenSharedProjects.projects[0].workspace.groups[0].snapshot;
    assert.deepEqual(
      rewrittenSnapshot.sessions.map((session: any) => session.sessionId),
      ["G8v20", "G1z99", "g-0530-180140", "g-0530-180141"],
    );
    assert.equal(rewrittenSnapshot.focusedSessionId, "g-0530-180140");
    assert.deepEqual(rewrittenSnapshot.visibleSessionIds, ["G8v20", "g-0530-180140", "g-0530-180141"]);
    assert.equal(rewrittenSnapshot.paneLayout.first.sessionId, "G8v20");
    assert.deepEqual(rewrittenSnapshot.paneLayout.second.sessionIds, ["g-0530-180140", "g-0530-180141"]);
    assert.equal(rewrittenSnapshot.paneLayout.second.selectedSessionId, "g-0530-180140");
  });
});

test("first-run import chooses WK projects when command-panel sessions are the fresher state", async () => {
  await withLegacyImportFixture(async (fixture) => {
    /*
    CDXC:GxserverVerification 2026-05-30-22:45:
    Source freshness scoring must count command-panel sessions and the active command-panel reference. WKWebView projects that only differ by command-pane state should beat a larger stale shared JSON file so gxserver imports the user's command-pane terminal.
    */
    const localStorageProjects = await readFile(fixture.sharedProjectsFile, "utf8");
    const staleSharedProjects = JSON.parse(localStorageProjects) as any;
    staleSharedProjects.projects[0].commandsPanel.sessions = [];
    delete staleSharedProjects.projects[0].commandsPanel.activeSessionId;
    staleSharedProjects.projects[0].iconDataUrl = `data:image/png;base64,${"x".repeat(1_100_000)}`;
    await writeFile(fixture.sharedProjectsFile, JSON.stringify(staleSharedProjects), "utf8");
    fixture.legacyStorageValues["ghostex-native-projects"] = localStorageProjects;

    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    assert.equal(result.status.sessionsImported, 4);
    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      const commandPane = repository.listSessions().find((session) => session.sessionId === "G2abc");
      assert.equal(commandPane?.launchSettings.surface, "commands");
      assert.equal(commandPane?.title, "Build pane");
      const staleSharedBackup = JSON.parse(await readFile(`${fixture.sharedProjectsFile}.legacy-before-gxserver`, "utf8")) as any;
      assert.equal(staleSharedBackup.projects[0].commandsPanel.sessions.length, 0);
    } finally {
      db.close();
    }
  });
});

test("first-run import keeps shared settings authoritative over richer WK settings", async () => {
  await withLegacyImportFixture(async (fixture) => {
    /*
    CDXC:GxserverVerification 2026-05-30-23:13:
    Shared sidebar settings are the macOS app's canonical settings source after the shared file exists. Migration must preserve that behavior even when WK localStorage has more keys, because choosing the richer WK blob would silently change terminal provider, notifications, and Auto Sleep on the first gxserver launch.
    */
    fixture.legacyStorageValues["ghostex-native-settings"] = JSON.stringify({
      actionCompletionSound: "ding",
      autoSleepAgentIdleMinutes: 120,
      autoSleepAgentSessionsEnabled: false,
      completionBellEnabled: false,
      completionSound: "ding",
      defaultPromptAgentId: "codex-localstorage",
      sessionPersistenceProvider: "tmux",
      showMacOSAttentionNotifications: false,
      terminalEngine: "xterm",
      workspaceOpenTargetHiddenIds: ["terminal"],
    });

    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      const mainProject = repository.getProject("P3a91");
      const runtimeSettings = mainProject?.runtimeSettings as any;
      const launchSettings = mainProject?.launchSettings as any;
      const completionRules = mainProject?.completionRules as any;
      const attentionRules = mainProject?.attentionRules as any;

      assert.equal(runtimeSettings?.settings?.sessionPersistenceProvider, "zmx");
      assert.equal(runtimeSettings?.settings?.autoSleepAgentSessionsEnabled, true);
      assert.equal(launchSettings?.settings?.terminalEngine, "ghostty-native");
      assert.equal(launchSettings?.settings?.defaultPromptAgentId, "codex-pro");
      assert.equal(completionRules?.completionBellEnabled, true);
      assert.equal(completionRules?.completionSound, "shamisen");
      assert.equal(attentionRules?.showMacOSAttentionNotifications, true);
    } finally {
      db.close();
    }
  });
});

test("first-run import chooses richer WK localStorage projects and previous sessions over stale shared JSON", async () => {
  await withLegacyImportFixture(async (fixture) => {
    const localStorageProjects = await readFile(fixture.sharedProjectsFile, "utf8");
    const localStoragePreviousSessions = await readFile(fixture.sharedPreviousSessionsFile, "utf8");
    const staleSharedProjects = JSON.parse(localStorageProjects) as any;
    staleSharedProjects.projects = [staleSharedProjects.projects[0]];
    staleSharedProjects.projects[0].workspace.groups[0].snapshot.sessions = [];
    staleSharedProjects.projects[0].workspace.groups[0].snapshot.visibleSessionIds = [];
    staleSharedProjects.projects[0].commandsPanel.sessions = [];
    staleSharedProjects.projects[0].commandsPanel.activeSessionId = undefined;
    await writeFile(fixture.sharedProjectsFile, JSON.stringify(staleSharedProjects), "utf8");
    await writeFile(fixture.sharedPreviousSessionsFile, "[]", "utf8");
    fixture.legacyStorageValues["ghostex-native-projects"] = localStorageProjects;
    fixture.legacyStorageValues["ghostex-native-previous-sessions"] = localStoragePreviousSessions;

    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    assert.equal(result.status.projectsImported, 2);
    assert.equal(result.status.sessionsImported, 4);
    const staleSharedBackup = JSON.parse(await readFile(`${fixture.sharedProjectsFile}.legacy-before-gxserver`, "utf8")) as any;
    assert.equal(staleSharedBackup.projects.length, 1);
    assert.equal(staleSharedBackup.projects[0].workspace.groups[0].snapshot.sessions.length, 0);

    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      const projects = repository.listProjects();
      const sessions = repository.listSessions();
      const mainProject = projects.find((project) => project.projectId === "P3a91");
      assert.deepEqual(
        projects.map((project) => project.projectId),
        ["P3a91", "P4b22"],
      );
      assert.deepEqual(
        sessions.map((session) => session.sessionId).sort(),
        ["G1z99", "G2abc", "G3def", "G8v20"],
      );
      assert.equal(mainProject?.previousSessionHistory[0]?.historyId, "hist-1");
    } finally {
      db.close();
    }
  });
});

test("first-run import prefers shared terminal sessions over WK browser-only pane count", async () => {
  await withLegacyImportFixture(async (fixture) => {
    /*
    CDXC:GxserverMigration 2026-06-07-13:32:
    The 3.x to 4.x migration must choose the source with daemon-importable terminal sessions, not the source with the most macOS-local browser/T3 panes. Otherwise a stale WK snapshot can outscore the real shared terminal snapshot and make the gxserver sidebar presentation look empty after upgrade.
    */
    const browserOnlyProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    for (const [projectIndex, project] of browserOnlyProjects.projects.entries()) {
      project.commandsPanel.sessions = [];
      delete project.commandsPanel.activeSessionId;
      const snapshot = project.workspace.groups[0].snapshot;
      snapshot.sessions = Array.from({ length: 8 }, (_, index) => ({
        alias: `B${projectIndex}-${index}`,
        browser: { url: `https://example.com/${projectIndex}/${index}` },
        createdAt: "2026-05-30T09:06:00.000Z",
        displayId: `B${index}`,
        kind: "browser",
        sessionId: `legacy-browser-${projectIndex}-${index}`,
        slotIndex: index,
        title: `Browser ${index}`,
      }));
      snapshot.visibleSessionIds = [snapshot.sessions[0].sessionId];
    }
    const browserOnlyExtraProject = JSON.parse(JSON.stringify(browserOnlyProjects.projects[0])) as any;
    browserOnlyExtraProject.projectId = "legacy-browser-only-extra";
    browserOnlyExtraProject.name = "Browser Only Extra";
    browserOnlyExtraProject.path = path.join(fixture.paths.homeDir, "repo", "browser-only-extra");
    browserOnlyExtraProject.workspace.groups[0].snapshot.sessions =
      browserOnlyExtraProject.workspace.groups[0].snapshot.sessions.map((session: any, index: number) => ({
        ...session,
        sessionId: `legacy-browser-extra-${index}`,
      }));
    browserOnlyExtraProject.workspace.groups[0].snapshot.visibleSessionIds = ["legacy-browser-extra-0"];
    browserOnlyProjects.projects.push(browserOnlyExtraProject);
    fixture.legacyStorageValues["ghostex-native-projects"] = JSON.stringify(browserOnlyProjects);

    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    assert.equal(result.status.projectsImported, 2);
    assert.equal(result.status.sessionsImported, 4);

    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      assert.deepEqual(
        repository.listSessions().map((session) => session.sessionId).sort(),
        ["G1z99", "G2abc", "G3def", "G8v20"],
      );
      const presentation = readGxserverPresentationSnapshot(db, "S7k", "2026-06-07T09:32:00.000Z");
      assert.equal(presentation.sessions.length, 4);
    } finally {
      db.close();
    }
  });
});

test("first-run import chooses richer fresher WK localStorage database over stale-first enumeration", async () => {
  await withLegacyImportFixture(async (fixture) => {
    const freshProjects = await readFile(fixture.sharedProjectsFile, "utf8");
    const freshPreviousSessions = await readFile(fixture.sharedPreviousSessionsFile, "utf8");
    const staleProjects = JSON.parse(freshProjects) as any;
    staleProjects.projects = [staleProjects.projects[0]];
    staleProjects.projects[0].workspace.groups[0].snapshot.sessions = [];
    staleProjects.projects[0].workspace.groups[0].snapshot.visibleSessionIds = [];
    staleProjects.projects[0].commandsPanel.sessions = [];
    staleProjects.projects[0].commandsPanel.activeSessionId = undefined;
    await writeFile(fixture.sharedProjectsFile, JSON.stringify(staleProjects), "utf8");
    await writeFile(fixture.sharedPreviousSessionsFile, "[]", "utf8");

    const localStorageRoot = path.join(fixture.paths.homeDir, "Library", "WebKit", "com.madda.ghostex.host");
    const staleDatabase = path.join(localStorageRoot, "a-stale", "localstorage.sqlite3");
    const freshDatabase = path.join(localStorageRoot, "z-fresh", "localstorage.sqlite3");
    await createLegacyLocalStorageDatabase(staleDatabase, {
      "ghostex-native-previous-sessions": "[]",
      "ghostex-native-projects": JSON.stringify(staleProjects),
    });
    await createLegacyLocalStorageDatabase(freshDatabase, {
      "ghostex-native-previous-sessions": freshPreviousSessions,
      "ghostex-native-projects": freshProjects,
    });
    const staleTime = new Date("2026-05-29T10:00:00.000Z");
    const freshTime = new Date("2026-05-30T10:00:00.000Z");
    await utimes(staleDatabase, staleTime, staleTime);
    await utimes(freshDatabase, freshTime, freshTime);

    const result = await migrateLegacyMacosStateIntoGxserver({
      createProjectId: () => fixture.projectIds.shift() ?? "P9zzz",
      createSessionId: () => fixture.sessionIds.shift() ?? "G9zzz",
      legacyLocalStorageRoot: localStorageRoot,
      legacyLogsDir: fixture.legacyLogsDir,
      logger: createGxserverLogger(fixture.paths),
      now: () => "2026-05-30T11:10:00.000Z",
      paths: fixture.paths,
      serverId: "S7k",
      sharedStateDir: fixture.sharedStateDir,
    });

    assert.equal(result.status.status, "completed");
    assert.equal(result.status.projectsImported, 2);
    assert.equal(result.status.sessionsImported, 4);

    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      assert.deepEqual(
        repository.listProjects().map((project) => project.projectId),
        ["P3a91", "P4b22"],
      );
      assert.deepEqual(
        repository.listSessions().map((session) => session.sessionId).sort(),
        ["G1z99", "G2abc", "G3def", "G8v20"],
      );
      assert.equal(repository.getProject("P3a91")?.previousSessionHistory[0]?.historyId, "hist-1");
    } finally {
      db.close();
    }
  });
});

test("completed zero-project marker recovers 3.x projects when they become readable later", async () => {
  await withLegacyImportFixture(async (fixture) => {
    /*
    CDXC:GxserverMigration 2026-06-07-13:32:
    A release Ghostex profile can briefly expose settings/logs before project localStorage or shared project JSON is readable. A zero-project completed marker must not become permanent; later 4.x launches should import the now-visible 3.x projects and sessions.
    */
    const projectsText = await readFile(fixture.sharedProjectsFile, "utf8");
    const previousSessionsText = await readFile(fixture.sharedPreviousSessionsFile, "utf8");
    await rm(fixture.sharedProjectsFile, { force: true });
    await rm(fixture.sharedPreviousSessionsFile, { force: true });

    const settingsOnly = await runImport(fixture);

    assert.equal(settingsOnly.status.status, "completed");
    assert.equal(settingsOnly.status.projectsImported, 0);
    assert.equal(settingsOnly.status.sessionsImported, 0);

    await writeFile(fixture.sharedProjectsFile, projectsText, "utf8");
    await writeFile(fixture.sharedPreviousSessionsFile, previousSessionsText, "utf8");

    const recovered = await runImport(fixture);

    assert.equal(recovered.status.status, "completed");
    assert.equal(recovered.status.projectsImported, 2);
    assert.equal(recovered.status.sessionsImported, 4);

    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      assert.deepEqual(
        repository.listProjects().map((project) => project.projectId),
        ["P3a91", "P4b22"],
      );
      assert.deepEqual(
        repository.listSessions().map((session) => session.sessionId).sort(),
        ["G1z99", "G2abc", "G3def", "G8v20"],
      );
      const presentation = readGxserverPresentationSnapshot(db, "S7k", "2026-06-07T09:32:00.000Z");
      assert.equal(presentation.projects.length, 2);
      assert.equal(presentation.sessions.length, 4);
    } finally {
      db.close();
    }
  });
});

test("completed browser-only marker recovers later unmapped terminal projects", async () => {
  await withLegacyImportFixture(async (fixture) => {
    /*
    CDXC:GxserverMigration 2026-06-07-13:32:
    Users who already launched a buggy 4.x build can have a completed migration marker with browser-only projects and zero imported terminal sessions. Later launches must import currently readable unmapped 3.x terminal projects instead of treating the nonzero project count as final.
    */
    const projectsText = await readFile(fixture.sharedProjectsFile, "utf8");
    const previousSessionsText = await readFile(fixture.sharedPreviousSessionsFile, "utf8");
    await writeFile(
      fixture.sharedProjectsFile,
      JSON.stringify({
        activeProjectId: "legacy-browser-only-project",
        projects: [
          {
            commandsPanel: { sessions: [] },
            name: "Browser Only",
            path: path.join(fixture.paths.homeDir, "repo", "browser-only"),
            projectId: "legacy-browser-only-project",
            workspace: {
              groups: [
                {
                  snapshot: {
                    sessions: [
                      {
                        browser: { url: "https://example.com" },
                        kind: "browser",
                        sessionId: "legacy-browser-only-session",
                        title: "Browser Only",
                      },
                    ],
                    visibleSessionIds: ["legacy-browser-only-session"],
                  },
                },
              ],
            },
          },
        ],
      }),
      "utf8",
    );
    await writeFile(fixture.sharedPreviousSessionsFile, "[]", "utf8");

    const browserOnly = await runImport(fixture);

    assert.equal(browserOnly.status.status, "completed");
    assert.equal(browserOnly.status.projectsImported, 1);
    assert.equal(browserOnly.status.sessionsImported, 0);

    await writeFile(fixture.sharedProjectsFile, projectsText, "utf8");
    await writeFile(fixture.sharedPreviousSessionsFile, previousSessionsText, "utf8");
    fixture.projectIds.push("P5fix" as GxserverProjectId);

    const recovered = await runImport(fixture);

    assert.equal(recovered.status.status, "completed");
    assert.equal(recovered.status.projectsImported, 2);
    assert.equal(recovered.status.sessionsImported, 4);

    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      assert.equal(repository.listProjects().length, 3);
      assert.deepEqual(
        repository.listSessions().map((session) => session.sessionId).sort(),
        ["G1z99", "G2abc", "G3def", "G8v20"],
      );
      const presentation = readGxserverPresentationSnapshot(db, "S7k", "2026-06-07T09:32:00.000Z");
      assert.equal(presentation.sessions.length, 4);
    } finally {
      db.close();
    }
  });
});

test("completed repair keeps migrated shared empty previous sessions over stale WK history", async () => {
  await withLegacyImportFixture(async (fixture) => {
    /*
    CDXC:GxserverVerification 2026-05-30-22:14:
    A migrated projects snapshot plus shared previous-sessions `[]` must be enough to prove the user has no restorable history. Completed-import repair should keep that empty shared file authoritative even if WKWebView still has older previous-session rows.
    */
    const staleLocalStoragePreviousSessions = await readFile(fixture.sharedPreviousSessionsFile, "utf8");
    await writeFile(fixture.sharedPreviousSessionsFile, "[]", "utf8");

    const result = await runImport(fixture);

    assert.equal(result.status.status, "completed");
    assert.deepEqual(JSON.parse(await readFile(fixture.sharedPreviousSessionsFile, "utf8")), []);
    const db = openGxserverDatabase(fixture.paths);
    try {
      const repository = new GxserverDomainRepository(db, "S7k");
      assert.deepEqual(repository.getProject("P3a91")?.previousSessionHistory, []);
    } finally {
      db.close();
    }

    await rm(fixture.sharedPreviousSessionsFile, { force: true });
    fixture.legacyStorageValues["ghostex-native-previous-sessions"] = staleLocalStoragePreviousSessions;
    const repaired = await runImport(fixture);

    assert.equal(repaired.status.status, "skipped");
    assert.equal(repaired.status.skippedReason, "alreadyCompleted");
    assert.deepEqual(JSON.parse(await readFile(fixture.sharedPreviousSessionsFile, "utf8")), []);
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
    const db = openGxserverDatabase(fixture.paths);
    try {
      db.prepare("UPDATE projects SET projectBoardConfigJson = ? WHERE projectId = ?").run(
        JSON.stringify({
          beadConversationLinks: [
            {
              beadId: "gxserver-11",
              ghostexSessionId: "legacy-live",
              marker: "stale-db-config",
              projectId: "legacy-project-main",
            },
          ],
          beadsDisplayKey: "GX",
        }),
        "P3a91",
      );
      db.prepare("UPDATE projects SET previousSessionHistoryJson = ? WHERE projectId = ?").run(
        JSON.stringify([
          {
            historyId: "hist-raw-db",
            projectId: "legacy-project-main",
            relatedSessionIds: ["legacy-prev", "legacy-live"],
            sessionId: "legacy-prev",
            sessionRecord: {
              projectId: "legacy-project-main",
              relatedSessionIds: ["legacy-prev"],
              sessionId: "legacy-prev",
              title: "Raw DB previous",
            },
            hiddenRestoreMetadata: {
              legacySessionId: "legacy-prev",
              sessionRecord: {
                projectId: "legacy-project-main",
                sessionId: "legacy-prev",
              },
            },
          },
        ]),
        "P3a91",
      );
    } finally {
      db.close();
    }
    fixture.sessionIds.push("G5new" as GxserverSessionId, "G6hij" as GxserverSessionId);
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

    const repairedDb = openGxserverDatabase(fixture.paths);
    try {
      assert.equal(repairedDb.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM projects").get()?.count, 2);
      assert.equal(repairedDb.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM sessions").get()?.count, 5);
      const repairedConfig = repairedDb
        .prepare<[string], { projectBoardConfigJson: string }>(
          "SELECT projectBoardConfigJson FROM projects WHERE projectId = ?",
        )
        .get("P3a91");
      const repairedProjectBoardConfig = JSON.parse(repairedConfig?.projectBoardConfigJson ?? "{}");
      assert.equal(repairedProjectBoardConfig.beadConversationLinks[0].ghostexSessionId, "G8v20");
      assert.equal(repairedProjectBoardConfig.beadConversationLinks[0].projectId, "P3a91");
      assert.equal(repairedProjectBoardConfig.beadConversationLinks[0].marker, "stale-db-config");
      const repairedHistoryRow = repairedDb
        .prepare<[string], { previousSessionHistoryJson: string }>(
          "SELECT previousSessionHistoryJson FROM projects WHERE projectId = ?",
        )
        .get("P3a91");
      const repairedHistory = JSON.parse(repairedHistoryRow?.previousSessionHistoryJson ?? "[]");
      assert.equal(repairedHistory[0].projectId, "P3a91");
      assert.equal(repairedHistory[0].sessionId, "G6hij");
      assert.equal(repairedHistory[0].sessionRecord.projectId, "P3a91");
      assert.equal(repairedHistory[0].sessionRecord.sessionId, "G6hij");
      assert.deepEqual(repairedHistory[0].relatedSessionIds, ["G6hij", "G8v20"]);
      assert.equal(repairedHistory[0].hiddenRestoreMetadata.legacySessionId, "legacy-prev");
      assert.equal(repairedHistory[0].hiddenRestoreMetadata.sessionRecord.sessionId, "legacy-prev");
    } finally {
      repairedDb.close();
    }
  });
});

test("first-run retry after crash reuses partially imported legacy rows before marker", async () => {
  await withLegacyImportFixture(async (fixture) => {
    await runImport(fixture);
    const originalRows = readImportedLegacyRows(fixture);
    await writeFile(
      fixture.sharedProjectsFile,
      await readFile(`${fixture.sharedProjectsFile}.legacy-before-gxserver`, "utf8"),
      "utf8",
    );
    await writeFile(
      fixture.sharedPreviousSessionsFile,
      await readFile(`${fixture.sharedPreviousSessionsFile}.legacy-before-gxserver`, "utf8"),
      "utf8",
    );
    forgetLegacyImportMarker(fixture);
    fixture.projectIds.push("P5dup" as GxserverProjectId, "P6dup" as GxserverProjectId);
    fixture.sessionIds.push(
      "G5dup" as GxserverSessionId,
      "G6dup" as GxserverSessionId,
      "G7dup" as GxserverSessionId,
      "G8dup" as GxserverSessionId,
    );

    const retried = await runImport(fixture);

    assert.equal(retried.status.status, "completed");
    assert.equal(retried.status.projectsImported, 2);
    assert.equal(retried.status.sessionsImported, 4);
    assert.deepEqual(readImportedLegacyRows(fixture), originalRows);

    const rewrittenSharedProjects = JSON.parse(await readFile(fixture.sharedProjectsFile, "utf8")) as any;
    assert.equal(rewrittenSharedProjects.activeProjectId, "P3a91");
    assert.equal(rewrittenSharedProjects.projects[0].projectId, "P3a91");
    assert.equal(rewrittenSharedProjects.projects[0].workspace.groups[0].snapshot.sessions[0].sessionId, "G8v20");
    assert.equal(rewrittenSharedProjects.projects[0].commandsPanel.activeSessionId, "G2abc");
    assert.equal(rewrittenSharedProjects.projects[1].projectId, "P4b22");
    assert.equal(rewrittenSharedProjects.projects[1].workspace.groups[0].snapshot.sessions[0].sessionId, "G3def");
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
          relatedSessionIds: ["legacy-prev", "legacy-live"],
          row: 0,
          sessionId: "legacy-prev",
          sessionRecord: {
            alias: "1",
            createdAt: "2026-05-29T09:00:00.000Z",
            displayId: "1",
            kind: "terminal",
            projectId: "legacy-project-main",
            relatedSessionIds: ["legacy-prev"],
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
      sessionIds: ["G8v20", "G1z99", "G2abc", "G3def", "G4hij"],
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

async function updateNativeSidebarSettings(
  settingsFile: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const settings = JSON.parse(await readFile(settingsFile, "utf8")) as Record<string, unknown>;
  await writeFile(settingsFile, JSON.stringify({ ...settings, ...patch }), "utf8");
}

async function createLegacyLocalStorageDatabase(filePath: string, values: Record<string, string>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
    const insert = db.prepare<[string, string]>("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(values)) {
      insert.run(key, value);
    }
  } finally {
    db.close();
  }
}

function forgetLegacyImportMarker(fixture: LegacyImportFixture): void {
  const db = openGxserverDatabase(fixture.paths);
  try {
    db.prepare("DELETE FROM metadata WHERE key = ?").run(`migration.${LEGACY_MACOS_STATE_IMPORT_ID}`);
  } finally {
    db.close();
  }
}

function readImportedLegacyRows(fixture: LegacyImportFixture): {
  projects: Array<{ legacyProjectId: string; projectId: string }>;
  sessions: Array<{ legacySessionId: string; projectId: string; sessionId: string }>;
} {
  const db = openGxserverDatabase(fixture.paths);
  try {
    const projects = db
      .prepare<[], { projectId: string; runtimeSettingsJson: string }>(
        "SELECT projectId, runtimeSettingsJson FROM projects ORDER BY projectId",
      )
      .all()
      .map((row) => ({
        legacyProjectId: JSON.parse(row.runtimeSettingsJson).legacyProjectId as string,
        projectId: row.projectId,
      }));
    const sessions = db
      .prepare<[], { projectId: string; providerStateJson: string; sessionId: string }>(
        "SELECT projectId, sessionId, providerStateJson FROM sessions ORDER BY projectId, sessionId",
      )
      .all()
      .map((row) => ({
        legacySessionId: JSON.parse(row.providerStateJson).legacySessionId as string,
        projectId: row.projectId,
        sessionId: row.sessionId,
      }));
    return { projects, sessions };
  } finally {
    db.close();
  }
}

function createLegacyProjectFixture(projectId: string, name: string, projectPath: string) {
  return {
    beadsDisplayKey: "GX",
    beadConversationLinks: [
      {
        issueId: "gxserver-9",
        metadata: {
          projectId,
          sessionIds: ["legacy-sleep"],
        },
        projectId,
        sessionId: "legacy-live",
      },
      {
        beadId: "gxserver-10",
        ghostexSessionId: "combined-session:legacy-project-worktree:legacy-worktree-session",
        id: "legacy-link-worktree",
        note: "preserve me",
        projectId,
      },
    ],
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
