import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAgentActivityTransition,
  buildAgentLaunchPlan,
  buildAgentResumeCommand,
  buildAgentResumeFallbackCommand,
  buildAgentResumeStartupText,
} from "../src/agent-lifecycle.js";
import type { GxserverProjectDomainState, GxserverSessionDomainState } from "../protocol/index.js";

test("agent launch command generation preserves Accept All flags and delayed send metadata", () => {
  const codex = buildAgentLaunchPlan({
    acceptAllMode: "inherit",
    agentId: "codex",
    command: "codex --yolo --yolo",
    delayedSendDeadlineAt: "2026-05-30T16:00:00.000Z",
    firstUserMessage: "ship it",
    globalAcceptAllEnabled: true,
  });
  assert.equal(codex.command, "codex --yolo");
  assert.equal(codex.startupText, "codex --yolo\r");
  assert.equal(codex.startupTextDisposition, "queueAfterTerminalReady");
  assert.deepEqual(codex.delayedSend, {
    deadlineAt: "2026-05-30T16:00:00.000Z",
    disposition: "scheduled",
  });

  const antigravity = buildAgentLaunchPlan({
    agentId: "antigravity",
    command: "agy",
    globalAcceptAllEnabled: true,
  });
  assert.equal(antigravity.command, "agy --dangerously-skip-permissions");

  const disabled = buildAgentLaunchPlan({
    acceptAllMode: "disabled",
    agentId: "codex",
    command: "codex --yolo",
    globalAcceptAllEnabled: true,
  });
  assert.equal(disabled.command, "codex");
});

test("Cursor launch appends resume after runtime Accept All flags when a chat id exists", () => {
  const plan = buildAgentLaunchPlan({
    agentId: "cursor",
    agentSessionId: "8B16E7E6-3CE1-4D0B-9F35-78261B7F0767",
    command: "cursor-agent",
    globalAcceptAllEnabled: true,
  });
  assert.equal(
    plan.command,
    'cursor-agent --yolo --resume "8b16e7e6-3ce1-4d0b-9f35-78261b7f0767"',
  );
});

test("resume and fallback command construction follows current sidebar rules", () => {
  const project = projectFixture();
  const session = sessionFixture({
    agentId: "codex",
    runtimeSettings: {
      agentCommand: "codex",
      agentSessionId: "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56",
      titleSource: "user",
    },
    title: "Readable thread title",
  });

  assert.equal(
    buildAgentResumeCommand(project, session),
    'codex resume "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56"',
  );
  assert.equal(buildAgentResumeFallbackCommand(project, session), 'codex resume "Readable thread title"');
  const startupText = buildAgentResumeStartupText(project, session);
  assert.match(startupText ?? "", /Restoring session/);
  assert.match(startupText ?? "", /Exact resume failed; trying saved fallback resume command/);
  assert.match(startupText ?? "", /__ghostex_restore_resume_primary/);
});

test("agent activity transitions suppress bootstrap noise and require real working before attention", () => {
  const launched = applyAgentActivityTransition({
    event: "launch",
    nowMs: Date.parse("2026-05-30T12:00:01.000Z"),
    nowIso: "2026-05-30T12:00:01.000Z",
  });
  assert.equal(launched.activity, "idle");
  assert.equal(launched.hasSeenWorking, false);
  assert.equal(launched.suppressedUntil, "2026-05-30T12:00:13.000Z");

  const suppressed = applyAgentActivityTransition({
    activity: "working",
    nowMs: Date.parse("2026-05-30T12:00:02.000Z"),
    nowIso: "2026-05-30T12:00:02.000Z",
    previous: launched,
  });
  assert.equal(suppressed.activity, "idle");
  assert.equal(suppressed.hasSeenWorking, false);

  const working = applyAgentActivityTransition({
    activity: "working",
    nowMs: Date.parse("2026-05-30T12:00:14.000Z"),
    nowIso: "2026-05-30T12:00:14.000Z",
    previous: launched,
  });
  assert.equal(working.activity, "working");
  assert.equal(working.workingStartedAt, "2026-05-30T12:00:14.000Z");

  const tooFast = applyAgentActivityTransition({
    activity: "attention",
    nowMs: Date.parse("2026-05-30T12:00:15.000Z"),
    nowIso: "2026-05-30T12:00:15.000Z",
    previous: working,
  });
  assert.equal(tooFast.activity, "idle");

  const attention = applyAgentActivityTransition({
    activity: "attention",
    nowMs: Date.parse("2026-05-30T12:00:20.000Z"),
    nowIso: "2026-05-30T12:00:20.000Z",
    previous: working,
  });
  assert.equal(attention.activity, "attention");
});

function projectFixture(): GxserverProjectDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-30T12:00:00.000Z",
    customAgentOrder: [],
    customAgents: [],
    customCommandOrder: [],
    customCommands: [],
    deletedDefaultCommandIds: [],
    gitConfig: {},
    isFavorite: false,
    isPinned: false,
    launchSettings: {},
    name: "Ghostex",
    notificationRules: {},
    path: "/repo/ghostex",
    previousSessionHistory: [],
    projectBoardConfig: {},
    projectId: "P3a91",
    runtimeSettings: {},
    updatedAt: "2026-05-30T12:00:00.000Z",
  };
}

function sessionFixture(
  partial: Partial<GxserverSessionDomainState>,
): GxserverSessionDomainState {
  return {
    agentId: "codex",
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-30T12:00:00.000Z",
    globalRef: "S1abcd:P3a91:G8v20",
    hiddenMetadata: {},
    isFavorite: false,
    isPinned: false,
    kind: "agent",
    launchSettings: {},
    lifecycleState: "running",
    notificationRules: {},
    projectId: "P3a91",
    providerState: { lifecycleState: "missing", zmxName: "P3a91-G8v20" },
    runtimeSettings: {},
    sessionId: "G8v20",
    title: "Agent task",
    updatedAt: "2026-05-30T12:00:00.000Z",
    zmxName: "P3a91-G8v20",
    ...partial,
  };
}
