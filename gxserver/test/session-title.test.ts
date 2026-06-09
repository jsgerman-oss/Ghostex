import test from "node:test";
import assert from "node:assert/strict";
import {
  decideTerminalTitleEvent,
  isRejectedResumeTitle,
  isValidAgentTerminalTitle,
  normalizeSessionTitleRuntimeSettings,
  projectSessionTitle,
} from "../src/session-title/index.js";
import type { GxserverSessionDomainState } from "../protocol/index.js";

test("Search by Text remains temporary until a different real terminal title arrives", () => {
  const session = sessionFixture({
    runtimeSettings: { titleSource: "placeholder" },
    title: "Search by Text",
  });

  const matching = decideTerminalTitleEvent(session, {
    projectId: session.projectId,
    rawTitle: "Search by Text",
    sessionId: session.sessionId,
    sessionPersistenceProvider: "zmx",
  });
  assert.equal(matching.shouldUpdateSession, false);
  assert.equal(matching.projection.isTemporaryTitle, true);
  assert.equal(matching.projection.primaryTitle, "Search by Text");
  assert.equal(matching.projection.terminalTitle, undefined);

  const realTitle = decideTerminalTitleEvent(session, {
    projectId: session.projectId,
    rawTitle: "Find old Codex thread",
    sessionId: session.sessionId,
    sessionPersistenceProvider: "zmx",
  });
  assert.equal(realTitle.shouldUpdateSession, true);
  assert.equal(realTitle.title, "Find old Codex thread");
  assert.equal(realTitle.titleSource, "terminal-auto");
  assert.equal(realTitle.projection.isTemporaryTitle, false);
});

test("Codex UUID terminal titles update agent session identity without becoming visible titles", () => {
  const session = sessionFixture({
    agentId: "codex",
    runtimeSettings: { agentName: "codex", titleSource: "placeholder" },
    title: "Codex Session",
  });

  const decision = decideTerminalTitleEvent(session, {
    agentName: "codex",
    projectId: session.projectId,
    rawTitle: "019e7c39-7ba7-7ac3-b79c-02757e299516",
    sessionId: session.sessionId,
    sessionPersistenceProvider: "zmx",
  });

  assert.equal(decision.shouldUpdateSession, true);
  assert.equal(decision.agentSessionId, "019e7c39-7ba7-7ac3-b79c-02757e299516");
  assert.equal(decision.title, undefined);
  assert.equal(decision.projection.primaryTitle, "Codex Session");
});

test("Codex UUID terminal titles may replace an existing agent session identity", () => {
  const session = sessionFixture({
    agentId: "codex",
    runtimeSettings: {
      agentName: "codex",
      agentSessionId: "019e7af5-c610-7f62-a129-db7bb510b48d",
      titleSource: "terminal-auto",
    },
    title: "Existing Codex Thread",
  });

  const decision = decideTerminalTitleEvent(session, {
    agentName: "codex",
    projectId: session.projectId,
    rawTitle: "019e7c39-7ba7-7ac3-b79c-02757e299516",
    sessionId: session.sessionId,
    sessionPersistenceProvider: "zmx",
  });

  /*
  CDXC:GxserverSessionIdentity 2026-06-09-08:55:
  Users can intentionally move a live terminal from one Codex thread to another. The terminal title is the strong same-PTY signal, so gxserver must still accept a different Codex UUID from the title stream even while passive hook/session-state replacements are guarded.
  */
  assert.equal(decision.shouldUpdateSession, true);
  assert.equal(decision.agentSessionId, "019e7c39-7ba7-7ac3-b79c-02757e299516");
  assert.equal(decision.runtimeSettings?.agentSessionId, "019e7c39-7ba7-7ac3-b79c-02757e299516");
  assert.equal(decision.title, undefined);
  assert.equal(decision.projection.primaryTitle, "Existing Codex Thread");
});

test("Codex terminal titles may start with Codex without being treated as CLI command noise", () => {
  const session = sessionFixture({
    agentId: "codex",
    runtimeSettings: { agentName: "codex" },
    title: "Codex Session",
  });

  const decision = decideTerminalTitleEvent(session, {
    agentName: "codex",
    projectId: session.projectId,
    rawTitle: "⠏ Codex zshrc additions",
    sessionId: session.sessionId,
    sessionPersistenceProvider: "zmx",
  });

  assert.equal(isRejectedResumeTitle("Codex zshrc additions"), false);
  assert.equal(isValidAgentTerminalTitle("Codex zshrc additions", "codex"), true);
  assert.equal(decision.shouldUpdateSession, true);
  assert.equal(decision.reason, "valid-agent-terminal-title-from-user");
  assert.equal(decision.title, "Codex zshrc additions");
  assert.equal(decision.projection.primaryTitle, "Codex zshrc additions");
});

test("agent launch command titles are still rejected as resume/title noise", () => {
  assert.equal(isRejectedResumeTitle("codex"), true);
  assert.equal(isRejectedResumeTitle("codex resume 019e7f01-8243-7aa1-88db-dd84ebcf6aa4"), true);
  assert.equal(isRejectedResumeTitle("codex --search"), true);
});

test("protected trusted titles block automatic terminal retitles", () => {
  const session = sessionFixture({
    runtimeSettings: { titleSource: "user" },
    title: "Known User Title",
  });

  const decision = decideTerminalTitleEvent(session, {
    projectId: session.projectId,
    protectStoredTitleFromAutomation: true,
    rawTitle: "Agent Automatic Title",
    sessionId: session.sessionId,
    sessionPersistenceProvider: "zmx",
  });

  assert.equal(decision.shouldUpdateSession, false);
  assert.equal(decision.reason, "protected-stored-title");
  assert.equal(decision.projection.primaryTitle, "Known User Title");
});

test("title runtime settings default temporary labels to placeholder provenance", () => {
  assert.deepEqual(normalizeSessionTitleRuntimeSettings({}, "Search by Text"), {
    titleSource: "placeholder",
  });
});

test("projection exposes trusted resume title for durable titles", () => {
  const projection = projectSessionTitle(
    sessionFixture({
      runtimeSettings: { titleSource: "terminal-auto" },
      title: "Durable terminal title",
    }),
  );
  assert.equal(projection.primaryTitle, "Durable terminal title");
  assert.equal(projection.trustedResumeTitle, "Durable terminal title");
  assert.equal(projection.isTemporaryTitle, false);
});

test("projection emits final display title strings for all clients", () => {
  const unsynced = projectSessionTitle(
    sessionFixture({
      runtimeSettings: { titleSource: "placeholder" },
      title: "Placeholder work title",
    }),
  );
  assert.equal(unsynced.displayTitle, "∗ Placeholder work title");
  assert.equal(unsynced.displayTitleTooltip, "∗ Placeholder work title (Unsynced title)");

  const synced = projectSessionTitle(
    sessionFixture({
      runtimeSettings: { titleSource: "terminal-auto" },
      title: "Synced work title",
    }),
  );
  assert.equal(synced.displayTitle, "Synced work title");
  assert.equal(synced.displayTitleTooltip, "Synced work title");
});

function sessionFixture(
  partial: Partial<GxserverSessionDomainState>,
): GxserverSessionDomainState {
  return {
    agentId: "codex",
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-31T11:00:00.000Z",
    globalRef: "S7k:P3a91:G8v20",
    hiddenMetadata: {},
    isFavorite: false,
    isPinned: false,
    kind: "terminal",
    launchSettings: {},
    lifecycleState: "running",
    notificationRules: {},
    projectId: "P3a91",
    providerState: { lifecycleState: "exists", zmxName: "S7k-P3a91-G8v20" },
    runtimeSettings: {},
    sessionId: "G8v20",
    surface: "workspace",
    title: "Terminal Session",
    updatedAt: "2026-05-31T11:00:00.000Z",
    zmxName: "S7k-P3a91-G8v20",
    ...partial,
  };
}
