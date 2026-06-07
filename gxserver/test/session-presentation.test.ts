import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applySessionRenameRequest,
  applySessionStateEvent,
  createAgentTitleDebouncer,
  GxserverPresentationDeltaCoalescer,
  projectGxserverPresentationSnapshot,
  reconcileAgentMetadataTitle,
  searchGxserverPreviousSessions,
  searchGxserverPresentationSessions,
} from "../src/session-presentation/index.js";
import type {
  GxserverPresentationDelta,
  GxserverPresentationRevision,
  GxserverProjectDomainState,
  GxserverProjectId,
  GxserverSessionDomainState,
  GxserverSessionId,
  GxserverUpdateSessionParams,
} from "../protocol/index.js";

test("session state events resolve Codex resume identity to previous trusted title", () => {
  const codexSessionId = "019e7af5-c610-7f62-a129-db7bb510b48d";
  const project = projectFixture({
    previousSessionHistory: [
      {
        agentSessionId: codexSessionId,
        closedAt: "2026-05-31T12:04:13.807Z",
        primaryTitle: "Shorter native tabs bar",
        sessionRecord: {
          agentName: "codex",
          agentSessionId: codexSessionId,
          title: "Shorter native tabs bar",
          titleSource: "terminal-auto",
        },
      },
    ],
  });
  const session = sessionFixture({
    runtimeSettings: { titleSource: "placeholder" },
    title: "Terminal Session",
  });
  const repository = new MockPresentationRepository(project, [session]);

  const result = applySessionStateEvent(repository, {
    projectId: session.projectId,
    sessionId: session.sessionId,
    startupText: `cd '/Users/madda/dev/_active/zmux' && codex resume "${codexSessionId}"`,
  });

  assert.equal(result.changed, true);
  assert.equal(result.session.agentId, "codex");
  assert.equal(result.session.kind, "agent");
  assert.equal(result.session.runtimeSettings.agentSessionId, codexSessionId);
  assert.equal(result.session.runtimeSettings.titleSource, "terminal-auto");
  assert.equal(result.session.title, "Shorter native tabs bar");
  assert.equal(result.projection.primaryTitle, "Shorter native tabs bar");
});

test("session state events preserve an already trusted current title", () => {
  const codexSessionId = "019e7af5-c610-7f62-a129-db7bb510b48d";
  const project = projectFixture({
    previousSessionHistory: [
      {
        agentSessionId: codexSessionId,
        primaryTitle: "Older history title",
        sessionRecord: {
          agentName: "codex",
          agentSessionId: codexSessionId,
          title: "Older history title",
          titleSource: "terminal-auto",
        },
      },
    ],
  });
  const session = sessionFixture({
    agentId: "codex",
    runtimeSettings: { titleSource: "user" },
    title: "Current user title",
  });
  const repository = new MockPresentationRepository(project, [session]);

  const result = applySessionStateEvent(repository, {
    agentName: "codex",
    agentSessionId: codexSessionId,
    projectId: session.projectId,
    sessionId: session.sessionId,
  });

  assert.equal(result.changed, true);
  assert.equal(result.session.title, "Current user title");
  assert.equal(result.session.runtimeSettings.agentSessionId, codexSessionId);
  assert.equal(result.projection.trustedResumeTitle, "Current user title");
});

test("session state events persist first-prompt title generation settings", () => {
  const project = projectFixture({});
  const session = sessionFixture({
    runtimeSettings: {
      firstPromptTitleGenerationCommand: "old-title-command",
      titleSource: "placeholder",
    },
  });
  const repository = new MockPresentationRepository(project, [session]);

  const result = applySessionStateEvent(repository, {
    agentName: "codex",
    firstPromptTitleGenerationAgent: "custom",
    firstPromptTitleGenerationCommand: "",
    firstUserMessage: "Please wire the title generator selector",
    projectId: session.projectId,
    sessionId: session.sessionId,
  });

  /*
  CDXC:GxserverSessionTitle 2026-06-04-08:24:
  The first-prompt state event must carry the Settings-selected title generator into gxserver runtime state, including an explicit empty custom command so clearing a custom command cannot reuse stale session metadata.
  */
  assert.equal(result.changed, true);
  assert.equal(result.session.runtimeSettings.firstPromptTitleGenerationAgent, "custom");
  assert.equal(result.session.runtimeSettings.firstPromptTitleGenerationCommand, "");
  assert.equal(result.session.runtimeSettings.firstUserMessage, "Please wire the title generator selector");
});

test("agent rename requests stay pending until Codex metadata supplies the canonical title", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "gxserver-agent-title-home-"));
  const codexSessionId = "019e7af5-c610-7f62-a129-db7bb510b48d";
  try {
    await mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await writeFile(
      path.join(homeDir, ".codex", "session_index.jsonl"),
      `${JSON.stringify({
        id: codexSessionId,
        thread_name: "Real Metadata Title",
        updated_at: "2026-06-01T05:03:00.000Z",
      })}\n`,
      "utf8",
    );
    const project = projectFixture({});
    const session = sessionFixture({
      agentId: "codex",
      kind: "agent",
      runtimeSettings: {
        agentName: "codex",
        agentSessionId: codexSessionId,
        titleSource: "terminal-auto",
      },
      title: "Old Title",
    });
    const repository = new MockPresentationRepository(project, [session]);

    const requested = applySessionRenameRequest(repository, {
      projectId: session.projectId,
      sessionId: session.sessionId,
      title: "Wrong Requested Title",
      titleSource: "user",
    });

    assert.equal(requested.pendingAgentMetadata, true);
    assert.equal(requested.shouldSendAgentRenameCommand, true);
    assert.equal(requested.session.title, "Old Title");
    assert.equal(requested.session.runtimeSettings.pendingAgentTitleRequestStatus, "pending");

    const reconciled = reconcileAgentMetadataTitle(repository, {
      homeDir,
      projectId: session.projectId,
      sessionId: session.sessionId,
      nowIso: "2026-06-01T05:03:00.000Z",
    });

    assert.equal(reconciled.changed, true);
    assert.equal(reconciled.session?.title, "Real Metadata Title");
    assert.equal(reconciled.session?.runtimeSettings.titleMetadataSource, "agent-metadata");
    assert.equal(reconciled.session?.runtimeSettings.pendingAgentTitleRequestStatus, "metadata-mismatch");
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("non-agent rename requests apply the client title immediately", () => {
  const project = projectFixture({});
  const session = sessionFixture({
    runtimeSettings: { titleSource: "terminal-auto" },
    title: "Shell",
  });
  const repository = new MockPresentationRepository(project, [session]);

  const result = applySessionRenameRequest(repository, {
    projectId: session.projectId,
    sessionId: session.sessionId,
    title: "Build Watch",
    titleSource: "user",
  });

  assert.equal(result.pendingAgentMetadata, false);
  assert.equal(result.shouldSendAgentRenameCommand, false);
  assert.equal(result.session.title, "Build Watch");
  assert.equal(result.session.runtimeSettings.titleSource, "user");
});

test("presentation sessions expose gxserver first-prompt title generation state", () => {
  /*
  CDXC:GxserverSessionTitle 2026-06-04-07:11:
  Clients need a server-owned loading signal for first-prompt title generation so the terminal overlay and sidebar "Generating title" text can render during gxserver-owned auto-title jobs and clear from the next presentation delta.
  */
  const project = projectFixture({});
  const snapshot = projectGxserverPresentationSnapshot({
    projects: [project],
    revision: 1 as GxserverPresentationRevision,
    sessions: [
      sessionFixture({
        runtimeSettings: {
          gxserverFirstPromptAutoTitleStatus: "running",
        },
      }),
    ],
  });

  assert.equal(snapshot.sessions[0]?.isGeneratingFirstPromptTitle, true);
});

test("agent title metadata debounce runs leading and trailing checks for a burst", () => {
  let nowMs = 0;
  const timers: Array<{ callback: () => void; dueAt: number }> = [];
  const calls: string[] = [];
  const debouncer = createAgentTitleDebouncer({
    delayMs: 3_000,
    nowMs: () => nowMs,
    setTimeout: (callback, delayMs) => {
      timers.push({ callback, dueAt: nowMs + delayMs });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  });

  debouncer.schedule({
    key: "session",
    run: (decision) => calls.push(`${decision.edge}:${decision.suppressedCount}`),
  });
  nowMs = 1_000;
  debouncer.schedule({
    key: "session",
    run: (decision) => calls.push(`${decision.edge}:${decision.suppressedCount}`),
  });
  nowMs = 2_000;
  debouncer.schedule({
    key: "session",
    run: (decision) => calls.push(`${decision.edge}:${decision.suppressedCount}`),
  });
  assert.deepEqual(calls, ["leading:0"]);

  nowMs = 3_000;
  timers.find((timer) => timer.dueAt === 3_000)?.callback();

  assert.deepEqual(calls, ["leading:0", "trailing:2"]);
});

test("presentation delta coalescer flushes the latest session projection once per cadence", () => {
  const timers: Array<() => void> = [];
  const flushes: Array<{ coalescedCount: number; delta: GxserverPresentationDelta; reason: string }> = [];
  const coalescer = new GxserverPresentationDeltaCoalescer({
    delayMs: 250,
    setTimeout: ((callback: () => void) => {
      timers.push(callback);
      return { unref() {} } as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
  });
  const projectId = "P3lv0" as GxserverProjectId;
  const sessionId = "G5tpf" as GxserverSessionId;

  coalescer.schedule(
    { projectId, sessionId },
    "title-1",
    presentationDeltaFixture("One"),
    (decision) => flushes.push(decision),
  );
  coalescer.schedule(
    { projectId, sessionId },
    "title-2",
    presentationDeltaFixture("Two"),
    (decision) => flushes.push(decision),
  );

  assert.equal(timers.length, 1);
  timers[0]!();
  assert.equal(flushes.length, 1);
  assert.equal(flushes[0]?.coalescedCount, 1);
  assert.equal(flushes[0]?.reason, "title-2");
  assert.equal(flushes[0]?.delta.type, "sessionPresentationChanged");
  assert.equal(flushes[0]?.delta.type === "sessionPresentationChanged" ? flushes[0].delta.session.title : undefined, "Two");
});

test("presentation snapshot marks command sessions without showing them in workspace sidebar by default", () => {
  const project = projectFixture({});
  const workspace = sessionFixture({
    sessionId: "G5tpf",
    title: "Workspace Agent",
  });
  const command = sessionFixture({
    commandId: "lint",
    sessionId: "G6cmd",
    surface: "commands",
    title: "Lint Command",
  });

  const snapshot = projectGxserverPresentationSnapshot({
    generatedAt: "2026-06-01T11:08:00.000Z",
    projects: [project],
    revision: 1 as GxserverPresentationRevision,
    sessions: [workspace, command],
  });

  assert.deepEqual(snapshot.sessions.map((session) => [session.sessionId, session.surface, session.visibleInSidebarByDefault]), [
    ["G5tpf", "workspace", true],
    ["G6cmd", "commands", false],
  ]);
  assert.deepEqual(snapshot.groups[0]?.sessionIds, ["G5tpf", "G6cmd"]);
});

test("presentation snapshot includes empty projects before their first session", () => {
  const project = projectFixture({
    name: "opencode",
    path: "/Users/madda/dev/_references/opencode",
    projectId: "Popen" as GxserverProjectId,
  });

  const snapshot = projectGxserverPresentationSnapshot({
    generatedAt: "2026-06-01T21:14:00.000Z",
    projects: [project],
    revision: 1 as GxserverPresentationRevision,
    sessions: [],
  });

  assert.equal(snapshot.projects[0]?.projectId, "Popen");
  assert.equal(snapshot.projects[0]?.title, "opencode");
  assert.deepEqual(snapshot.projects[0]?.groupIds, ["Popen:active"]);
  assert.deepEqual(snapshot.groups[0]?.sessionIds, []);
  assert.equal(snapshot.sessions.length, 0);
});

test("presentation snapshot carries worktree project metadata", () => {
  const project = projectFixture({
    name: "zmux-feature",
    path: "/Users/madda/dev/_active/zmux-feature",
    projectId: "Pwt01" as GxserverProjectId,
    worktree: {
      branch: "feature",
      name: "feature",
      parentProjectId: "P3lv0",
      parentProjectName: "zmux",
      parentProjectPath: "/Users/madda/dev/_active/zmux",
    },
  });

  const snapshot = projectGxserverPresentationSnapshot({
    generatedAt: "2026-06-02T04:16:00.000Z",
    projects: [project],
    revision: 1 as GxserverPresentationRevision,
    sessions: [],
  });

  assert.deepEqual(snapshot.projects[0]?.worktree, project.worktree);
});

test("presentation snapshot carries gxserver title projection semantics", () => {
  const project = projectFixture({});
  const session = sessionFixture({
    runtimeSettings: { titleSource: "terminal-auto" },
    title: "Missing sidebar sessions",
  });

  const snapshot = projectGxserverPresentationSnapshot({
    generatedAt: "2026-06-01T11:08:00.000Z",
    projects: [project],
    revision: 1 as GxserverPresentationRevision,
    sessions: [session],
  });

  const presentation = snapshot.sessions[0];
  assert.ok(presentation, "presentation session exists");
  assert.equal(presentation.title, "Missing sidebar sessions");
  assert.equal(presentation.primaryTitle, "Missing sidebar sessions");
  assert.equal(presentation.terminalTitle, undefined);
  assert.equal(presentation.isPrimaryTitleTerminalTitle, true);
  assert.equal(presentation.isTemporaryTitle, false);
  assert.equal(presentation.titleSource, "terminal-auto");
  assert.equal(presentation.trustedResumeTitle, "Missing sidebar sessions");
});

test("presentation snapshot resolves missing last-active timestamps from createdAt", () => {
  const project = projectFixture({});
  const missingActivity = sessionFixture({
    createdAt: "2026-06-01T09:00:00.000Z",
    sessionId: "G1old",
    title: "Metadata Refreshed",
    updatedAt: "2026-06-07T05:17:00.000Z",
  });
  const realActivity = sessionFixture({
    createdAt: "2026-06-01T09:30:00.000Z",
    lastActiveAt: "2026-06-02T11:00:00.000Z",
    sessionId: "G2run",
    title: "Actually Active",
    updatedAt: "2026-06-07T05:18:00.000Z",
  });

  const snapshot = projectGxserverPresentationSnapshot({
    projects: [project],
    revision: 2 as GxserverPresentationRevision,
    sessions: [missingActivity, realActivity],
  });

  const projectedMissingActivity = snapshot.sessions.find((session) => session.sessionId === "G1old");
  assert.equal(projectedMissingActivity?.lastActiveAt, missingActivity.createdAt);
  assert.equal(projectedMissingActivity?.updatedAt, missingActivity.updatedAt);
  assert.equal(projectedMissingActivity?.sortKey.includes(missingActivity.createdAt), true);
  assert.equal(projectedMissingActivity?.sortKey.includes(missingActivity.updatedAt), false);
  assert.equal(
    snapshot.sessions.find((session) => session.sessionId === "G2run")?.lastActiveAt,
    realActivity.lastActiveAt,
  );
});

test("presentation snapshot excludes unpinned stopped history but keeps pinned previous sessions", () => {
  const project = projectFixture({});
  const stoppedNoise = sessionFixture({
    lifecycleState: "stopped",
    sessionId: "G1old",
    title: "Old Placeholder",
    updatedAt: "2026-05-01T11:08:00.000Z",
  });
  const pinnedStopped = sessionFixture({
    isPinned: true,
    lifecycleState: "stopped",
    sessionId: "G2pin",
    title: "Pinned History",
    updatedAt: "2026-05-02T11:08:00.000Z",
  });
  const running = sessionFixture({
    lifecycleState: "running",
    sessionId: "G3run",
    title: "Running Shell",
  });

  const snapshot = projectGxserverPresentationSnapshot({
    projects: [project],
    revision: 2 as GxserverPresentationRevision,
    sessions: [stoppedNoise, pinnedStopped, running],
  });

  assert.deepEqual(snapshot.sessions.map((session) => session.sessionId), ["G3run", "G2pin"]);
});

test("presentation snapshot orders pinned project sessions by sidebar order", () => {
  const project = projectFixture({});
  const first = sessionFixture({
    isPinned: true,
    sessionId: "G1aaa",
    sidebarOrder: 1000,
    title: "First",
    updatedAt: "2026-06-02T18:00:00.000Z",
  });
  const second = sessionFixture({
    isPinned: true,
    sessionId: "G2bbb",
    sidebarOrder: 0,
    title: "Second",
    updatedAt: "2026-06-02T17:00:00.000Z",
  });

  const snapshot = projectGxserverPresentationSnapshot({
    projects: [project],
    revision: 2 as GxserverPresentationRevision,
    sessions: [first, second],
  });

  assert.deepEqual(snapshot.sessions.map((session) => session.sessionId), ["G2bbb", "G1aaa"]);
  assert.deepEqual(snapshot.sessions.map((session) => session.sidebarOrder), [0, 1000]);
});

test("presentation snapshot applies stale spinner activity semantics", () => {
  const project = projectFixture({});
  const session = sessionFixture({
    agentId: "codex",
    runtimeSettings: {
      agentActivity: {
        activity: "working",
        agentName: "codex",
        hasSeenWorking: true,
        isAcknowledged: false,
        lastTitle: "⠏ Skip migration issue 2 options",
        lastTitleChangeAt: "2026-06-01T12:00:00.000Z",
        workingSource: "title",
        workingStartedAt: "2026-06-01T12:00:00.000Z",
      },
      agentName: "codex",
      titleSource: "terminal-auto",
    },
    title: "Skip migration issue 2 options",
  });

  const freshSnapshot = projectGxserverPresentationSnapshot({
    generatedAt: "2026-06-01T12:00:02.000Z",
    projects: [project],
    revision: 1 as GxserverPresentationRevision,
    sessions: [session],
  });
  assert.equal(freshSnapshot.sessions[0]?.activity, "working");
  assert.deepEqual(freshSnapshot.sessions[0]?.actions, {
    acknowledgeAttention: false,
    attach: true,
    focus: true,
    kill: true,
    readText: true,
    sendMessage: true,
    sendText: true,
    sleep: true,
    wake: false,
  });

  const oldBoundarySnapshot = projectGxserverPresentationSnapshot({
    generatedAt: "2026-06-01T12:00:04.000Z",
    projects: [project],
    revision: 2 as GxserverPresentationRevision,
    sessions: [session],
  });
  assert.equal(oldBoundarySnapshot.sessions[0]?.activity, "working");
  assert.equal(oldBoundarySnapshot.sessions[0]?.actions.acknowledgeAttention, false);

  const staleSnapshot = projectGxserverPresentationSnapshot({
    generatedAt: "2026-06-01T12:00:06.000Z",
    projects: [project],
    revision: 3 as GxserverPresentationRevision,
    sessions: [session],
  });
  assert.equal(staleSnapshot.sessions[0]?.activity, "attention");
  assert.equal(staleSnapshot.sessions[0]?.actions.acknowledgeAttention, true);
});

test("metadata search can page previous sessions without hydrating them into the active snapshot", () => {
  const project = projectFixture({ name: "Ghostex" });
  const active = sessionFixture({
    lifecycleState: "running",
    sessionId: "G3run",
    title: "Active Build",
  });
  const previous = sessionFixture({
    agentId: "codex",
    cwd: "/Users/madda/dev/_active/zmux",
    lifecycleState: "stopped",
    runtimeSettings: { titleSource: "terminal-auto" },
    sessionId: "G4old",
    title: "Presentation Cutover",
    updatedAt: "2026-06-01T10:08:00.000Z",
  });

  const activeSnapshot = projectGxserverPresentationSnapshot({
    projects: [project],
    revision: 3 as GxserverPresentationRevision,
    sessions: [active, previous],
  });
  assert.deepEqual(activeSnapshot.sessions.map((session) => session.sessionId), ["G3run"]);

  const search = searchGxserverPresentationSessions(
    { projects: [project], sessions: [active, previous] },
    {
      includeActive: false,
      includePrevious: true,
      query: "cutover",
    },
  );

  assert.equal(search.results.length, 1);
  assert.equal(search.results[0]?.sessionId, "G4old");
  assert.equal(search.results[0]?.match?.field, "title");
  assert.equal(search.results[0]?.primaryTitle, "Presentation Cutover");
  assert.equal(search.results[0]?.terminalTitle, undefined);
  assert.equal(search.results[0]?.isPrimaryTitleTerminalTitle, true);
  assert.equal(search.results[0]?.isTemporaryTitle, false);
  assert.equal(search.results[0]?.titleSource, "terminal-auto");
  assert.equal(search.results[0]?.trustedResumeTitle, "Presentation Cutover");
  assert.equal(search.results[0]?.surface, "workspace");
});

test("presentation search resolves missing last-active timestamps before ranking results", () => {
  const project = projectFixture({ name: "Ghostex" });
  const metadataRefreshed = sessionFixture({
    createdAt: "2026-06-01T09:00:00.000Z",
    sessionId: "G1meta",
    title: "Metadata Refreshed",
    updatedAt: "2026-06-07T05:17:00.000Z",
  });
  const actuallyRecent = sessionFixture({
    createdAt: "2026-06-01T09:30:00.000Z",
    lastActiveAt: "2026-06-02T11:00:00.000Z",
    sessionId: "G2real",
    title: "Actually Recent",
    updatedAt: "2026-06-01T09:31:00.000Z",
  });

  const search = searchGxserverPresentationSessions(
    { projects: [project], sessions: [metadataRefreshed, actuallyRecent] },
    {},
  );

  assert.deepEqual(
    search.results.map((result) => result.sessionId),
    ["G2real", "G1meta"],
  );
  assert.equal(search.results.find((result) => result.sessionId === "G1meta")?.lastActiveAt, metadataRefreshed.createdAt);
  assert.equal(search.results.find((result) => result.sessionId === "G1meta")?.updatedAt, metadataRefreshed.updatedAt);
});

test("previous sessions search hides placeholder inactive rows but keeps restorable history", () => {
  const project = projectFixture({ name: "Ghostex" });
  const trusted = sessionFixture({
    agentId: "codex",
    createdAt: "2026-06-01T10:00:00.000Z",
    lifecycleState: "stopped",
    runtimeSettings: { titleSource: "terminal-auto" },
    sessionId: "G1trust",
    title: "Fix previous session list",
    updatedAt: "2026-06-01T10:08:00.000Z",
  });
  const placeholder = sessionFixture({
    lifecycleState: "stopped",
    runtimeSettings: { titleSource: "placeholder" },
    sessionId: "G2noise",
    title: "Terminal Session",
  });
  const unknown = sessionFixture({
    lifecycleState: "unknown",
    runtimeSettings: { titleSource: "terminal-auto" },
    sessionId: "G3unkn",
    title: "Unknown but titled",
  });
  const favoritePlaceholder = sessionFixture({
    isFavorite: true,
    lifecycleState: "stopped",
    runtimeSettings: { titleSource: "placeholder" },
    sessionId: "G4fav",
    title: "Codex Session",
  });
  const commandPane = sessionFixture({
    commandId: "start",
    lifecycleState: "stopped",
    runtimeSettings: { titleSource: "terminal-auto" },
    sessionId: "G5cmd",
    surface: "commands",
    title: "bun run start",
  });
  const pinnedCommandPane = sessionFixture({
    commandId: "test",
    isPinned: true,
    lifecycleState: "stopped",
    runtimeSettings: { titleSource: "terminal-auto" },
    sessionId: "G6pin",
    surface: "commands",
    title: "bun test",
  });

  /*
  CDXC:PreviousSessions 2026-06-04-20:21:
  listPreviousSessions should be a useful restore list, not every inactive gxserver row. Hide unpinned placeholder and unknown rows while preserving trusted stopped rows and rows the user explicitly kept with Favorite/Pin.

  CDXC:PreviousSessions 2026-06-07-05:28:
  Command-pane sessions are not previous workspace sessions. Keep `surface: "commands"` rows out of listPreviousSessions even when they have trusted terminal titles or pinned state, because clients should not show command runs like `bun run start` in the Previous Sessions modal.
  */
  const search = searchGxserverPreviousSessions(
    { projects: [project], sessions: [trusted, placeholder, unknown, favoritePlaceholder, commandPane, pinnedCommandPane] },
    { includeActive: false, includePrevious: true },
  );

  assert.deepEqual(
    search.results.map((result) => result.sessionId),
    ["G1trust", "G4fav"],
  );
  assert.equal(search.results.find((result) => result.sessionId === "G1trust")?.createdAt, trusted.createdAt);
  assert.equal(search.results.find((result) => result.sessionId === "G1trust")?.updatedAt, trusted.updatedAt);
});

test("presentation projects sanitized zmx title-observer health", () => {
  const project = projectFixture({});
  const session = sessionFixture({
    runtimeSettings: {
      zmxTitleObservation: {
        failureCount: 2,
        lastFailedAt: "2026-06-07T00:29:59.000Z",
        lastObservedAt: "2026-06-07T00:29:40.000Z",
        lastStartedAt: "2026-06-07T00:29:58.000Z",
        nextRetryAt: "2026-06-07T00:30:00.000Z",
        rawTitle: "private terminal title",
        status: "retrying",
      },
    },
  });

  const snapshot = projectGxserverPresentationSnapshot({
    projects: [project],
    revision: 4 as GxserverPresentationRevision,
    sessions: [session],
  });

  assert.deepEqual(snapshot.sessions[0]?.titleObservation, {
    failureCount: 2,
    lastFailedAt: "2026-06-07T00:29:59.000Z",
    lastObservedAt: "2026-06-07T00:29:40.000Z",
    lastStartedAt: "2026-06-07T00:29:58.000Z",
    nextRetryAt: "2026-06-07T00:30:00.000Z",
    status: "retrying",
  });
  assert.equal(JSON.stringify(snapshot.sessions[0]).includes("private terminal title"), false);
});

class MockPresentationRepository {
  readonly #project: GxserverProjectDomainState;
  #sessions: GxserverSessionDomainState[];

  constructor(project: GxserverProjectDomainState, sessions: GxserverSessionDomainState[]) {
    this.#project = project;
    this.#sessions = sessions;
  }

  getProject(projectId: GxserverProjectId): GxserverProjectDomainState | undefined {
    return projectId === this.#project.projectId ? this.#project : undefined;
  }

  getSession(projectId: GxserverProjectId, sessionId: GxserverSessionId): GxserverSessionDomainState | undefined {
    return this.#sessions.find((session) => session.projectId === projectId && session.sessionId === sessionId);
  }

  listSessions(projectId?: GxserverProjectId): GxserverSessionDomainState[] {
    return projectId ? this.#sessions.filter((session) => session.projectId === projectId) : this.#sessions;
  }

  updateSession(input: GxserverUpdateSessionParams): GxserverSessionDomainState {
    const current = this.getSession(input.projectId, input.sessionId);
    assert.ok(current, "mock session exists");
    const next: GxserverSessionDomainState = {
      ...current,
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.runtimeSettings !== undefined ? { runtimeSettings: input.runtimeSettings } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      updatedAt: "2026-05-31T21:10:00.000Z",
    };
    this.#sessions = this.#sessions.map((session) =>
      session.projectId === input.projectId && session.sessionId === input.sessionId ? next : session,
    );
    return next;
  }
}

function projectFixture(partial: Partial<GxserverProjectDomainState>): GxserverProjectDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-31T21:00:00.000Z",
    customAgentOrder: [],
    customAgents: [],
    customCommandOrder: [],
    customCommands: [],
    deletedDefaultCommandIds: [],
    gitConfig: {},
    isFavorite: false,
    isPinned: false,
    launchSettings: {},
    name: "zmux",
    notificationRules: {},
    path: "/Users/madda/dev/_active/zmux",
    previousSessionHistory: [],
    projectBoardConfig: {},
    projectId: "P3lv0",
    runtimeSettings: {},
    updatedAt: "2026-05-31T21:00:00.000Z",
    ...partial,
  };
}

function sessionFixture(partial: Partial<GxserverSessionDomainState>): GxserverSessionDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-31T21:00:00.000Z",
    globalRef: "S90:P3lv0:G5tpf",
    hiddenMetadata: {},
    isFavorite: false,
    isPinned: false,
    kind: "terminal",
    launchSettings: {},
    lifecycleState: "running",
    notificationRules: {},
    projectId: "P3lv0",
    providerState: { lifecycleState: "exists", zmxName: "S90-P3lv0-G5tpf" },
    runtimeSettings: {},
    sessionId: "G5tpf",
    surface: "workspace",
    title: "Terminal Session",
    updatedAt: "2026-05-31T21:00:00.000Z",
    zmxName: "S90-P3lv0-G5tpf",
    ...partial,
  };
}

function presentationDeltaFixture(title: string): GxserverPresentationDelta {
  const project = projectFixture({});
  const snapshot = projectGxserverPresentationSnapshot({
    projects: [project],
    revision: 1 as GxserverPresentationRevision,
    sessions: [sessionFixture({ title })],
  });
  const session = snapshot.sessions[0];
  assert.ok(session, "presentation session exists");
  return {
    session,
    type: "sessionPresentationChanged",
  };
}
