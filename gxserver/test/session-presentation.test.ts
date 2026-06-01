import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applySessionRenameRequest,
  applySessionStateEvent,
  createAgentTitleDebouncer,
  reconcileAgentMetadataTitle,
} from "../src/session-presentation/index.js";
import type {
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
    providerState: { lifecycleState: "exists", zmxName: "P3lv0-G5tpf" },
    runtimeSettings: {},
    sessionId: "G5tpf",
    surface: "workspace",
    title: "Terminal Session",
    updatedAt: "2026-05-31T21:00:00.000Z",
    zmxName: "P3lv0-G5tpf",
    ...partial,
  };
}
