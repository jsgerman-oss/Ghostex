import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAgentActivityTransition,
  buildAgentForkPlan,
  buildAgentLaunchPlan,
  buildAgentResumeCommand,
  buildAgentResumeFallbackCommand,
  buildAgentResumePlan,
  buildAgentResumeStartupText,
  createAgentForkSessionParams,
  getEffectiveAgentActivityState,
} from "../src/agents/lifecycle.js";
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

test("Cursor resume uses exact identity before title lookup", () => {
  const project = projectFixture();
  const session = sessionFixture({
    agentId: "cursor",
    runtimeSettings: {
      agentCommand: "cursor-agent",
      agentSessionId: "E10971DA-CBD7-459A-9AC3-B9B0313199A3",
      titleSource: "user",
    },
    title: "∗ Cursor CLI Session",
  });

  const plan = buildAgentResumePlan(project, session);
  assert.equal(plan.primaryCommand, 'cursor-agent --resume "e10971da-cbd7-459a-9ac3-b9b0313199a3"');
  assert.equal(plan.displayCommand, plan.primaryCommand);
  assert.equal(plan.fallbackCommand, undefined);
  assert.doesNotMatch(plan.startupText ?? "", /lookup chat id|Cursor CLI Session/);
});

test("Cursor resume extracts exact identity from stored raw resume commands", () => {
  const project = projectFixture();
  const session = sessionFixture({
    agentId: "cursor",
    runtimeSettings: {
      agentCommand: "cursor-agent",
      resumeCommand: "cd '/repo/ghostex' && cursor-agent --resume \"e10971da-cbd7-459a-9ac3-b9b0313199a3\"",
      titleSource: "user",
    },
    title: "∗ Cursor CLI Session",
  });

  const plan = buildAgentResumePlan(project, session);
  assert.equal(plan.primaryCommand, 'cursor-agent --resume "e10971da-cbd7-459a-9ac3-b9b0313199a3"');
  assert.equal(plan.fallbackCommand, undefined);
  assert.doesNotMatch(plan.startupText ?? "", /lookup chat id|Unable to find Cursor/);
});

test("Cursor placeholder titles are not used for chat-store lookup", () => {
  const project = projectFixture();
  const session = sessionFixture({
    agentId: "cursor",
    runtimeSettings: {
      agentCommand: "cursor-agent",
      titleSource: "user",
    },
    title: "∗ Cursor CLI Session",
  });

  assert.equal(buildAgentResumeCommand(project, session), undefined);
  assert.equal(buildAgentResumeFallbackCommand(project, session), undefined);
  assert.equal(buildAgentResumeStartupText(project, session), undefined);
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

test("resume startup commands apply Accept All at runtime without changing stored command", () => {
  const project = {
    ...projectFixture(),
    launchSettings: { agentAcceptAllEnabled: true },
  };
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
    'codex --yolo resume "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56"',
  );
  assert.equal(buildAgentResumeFallbackCommand(project, session), 'codex --yolo resume "Readable thread title"');
  assert.equal(session.runtimeSettings.agentCommand, "codex");
});

test("fork plan uses gxserver Codex runtime identity and Accept All policy", () => {
  const project = {
    ...projectFixture(),
    launchSettings: { agentAcceptAllEnabled: true },
  };
  const session = sessionFixture({
    agentId: "codex",
    runtimeSettings: {
      agentCommand: "codex",
      agentName: "codex",
      agentSessionId: "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56",
      titleSource: "user",
    },
  });

  const plan = buildAgentForkPlan(project, session);
  assert.equal(plan.primaryCommand, 'codex --yolo fork "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56"');
  assert.equal(plan.startupText, 'codex --yolo fork "6a6c2672-6b45-45fe-a1a8-a73f9a3a9c56"\r');
  assert.equal(plan.startupTextDisposition, "queueAfterTerminalReady");
});

test("fork plan can use trusted Codex title lookup when exact identity is missing", () => {
  const project = projectFixture();
  const session = sessionFixture({
    agentId: "codex",
    runtimeSettings: {
      agentCommand: "codex",
      agentName: "codex",
      titleSource: "user",
    },
    title: "Readable thread title",
  });

  const plan = buildAgentForkPlan(project, session);
  assert.match(plan.primaryCommand ?? "", /CODEX_FORK_SESSION_ID/);
  assert.match(plan.primaryCommand ?? "", /codex fork "\$CODEX_FORK_SESSION_ID"/);
  assert.equal(plan.displayCommand, 'codex fork "Readable thread title"  # lookup Codex session id by title');
});

test("fork session params persist server-owned startup plan for clients", () => {
  const project = projectFixture();
  const sourceSession = sessionFixture({
    agentId: "claude",
    sessionId: "G1src",
    runtimeSettings: {
      agentCommand: "claude",
      agentName: "claude",
      agentSessionId: "claude-thread",
      titleSource: "user",
    },
    title: "Review work",
  });
  const plan = buildAgentForkPlan(project, sourceSession);

  const params = createAgentForkSessionParams(project, sourceSession, plan);
  assert.equal(params.agentId, "claude");
  assert.equal(params.kind, "agent");
  assert.equal(params.providerState?.lifecycleState, "missing");
  assert.equal(params.providerState?.provider, "zmx");
  assert.equal(params.restoredFromSessionId, "G1src");
  assert.equal(params.runtimeSettings?.agentName, "claude");
  assert.equal(params.runtimeSettings?.forkedFromSessionId, "G1src");
  const launchPlan = params.launchSettings?.agentLaunchPlan as Record<string, unknown> | undefined;
  assert.equal(launchPlan?.command, 'claude --resume "claude-thread" --fork-session');
  assert.equal(launchPlan?.startupText, 'claude --resume "claude-thread" --fork-session\r');
});

test("resume plan separates OpenCode lookup command from runtime Accept All command", () => {
  const project = {
    ...projectFixture(),
    launchSettings: { agentAcceptAllEnabled: true },
  };
  const session = sessionFixture({
    agentId: "opencode",
    runtimeSettings: {
      agentCommand: "opencode",
      titleSource: "user",
    },
    title: "Readable thread title",
  });

  const plan = buildAgentResumePlan(project, session);
  assert.equal(plan.runtimeCommand, "opencode --dangerously-skip-permissions");
  assert.equal(plan.lookupCommand, "opencode");
  assert.match(
    plan.primaryCommand ?? "",
    /opencode --dangerously-skip-permissions -s "\$\(opencode session list --format json/,
  );
  assert.doesNotMatch(plan.primaryCommand ?? "", /opencode --dangerously-skip-permissions session list/);
  assert.equal(plan.copyCommand, plan.primaryCommand);
});

test("temporary Search by Text titles are not trusted resume fallbacks", () => {
  const project = projectFixture();
  const searchSession = sessionFixture({
    agentId: "codex",
    runtimeSettings: {
      agentCommand: "codex",
      titleSource: "user",
    },
    title: "Search by Text",
  });

  assert.equal(buildAgentResumeCommand(project, searchSession), undefined);
  assert.equal(buildAgentResumeFallbackCommand(project, searchSession), undefined);
  assert.equal(buildAgentResumeStartupText(project, searchSession), undefined);

  const identifiedSession = sessionFixture({
    agentId: "codex",
    runtimeSettings: {
      agentCommand: "codex",
      agentSessionId: "019e7c39-7ba7-7ac3-b79c-02757e299516",
      titleSource: "placeholder",
    },
    title: "Search by Text",
  });
  assert.equal(
    buildAgentResumeCommand(project, identifiedSession),
    'codex resume "019e7c39-7ba7-7ac3-b79c-02757e299516"',
  );
  assert.equal(buildAgentResumeFallbackCommand(project, identifiedSession), undefined);
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

test("Codex action-required title blink remains one attention transition", () => {
  const working = applyAgentActivityTransition({
    activity: "working",
    agentId: "codex",
    nowIso: "2026-05-30T12:00:14.000Z",
    nowMs: Date.parse("2026-05-30T12:00:14.000Z"),
  });

  const attention = applyAgentActivityTransition({
    agentId: "codex",
    nowIso: "2026-05-30T12:00:20.000Z",
    nowMs: Date.parse("2026-05-30T12:00:20.000Z"),
    previous: working,
    title: "[ ! ] Action Required",
  });
  assert.equal(attention.activity, "attention");
  assert.equal(attention.lastChangedAt, "2026-05-30T12:00:20.000Z");

  const dotFrame = applyAgentActivityTransition({
    agentId: "codex",
    nowIso: "2026-05-30T12:00:21.000Z",
    nowMs: Date.parse("2026-05-30T12:00:21.000Z"),
    previous: attention,
    title: "[ . ] Action Required",
  });
  assert.equal(dotFrame.activity, "attention");
  assert.equal(dotFrame.lastChangedAt, attention.lastChangedAt);

  const middleDotFrame = applyAgentActivityTransition({
    agentId: "codex",
    nowIso: "2026-05-30T12:00:22.000Z",
    nowMs: Date.parse("2026-05-30T12:00:22.000Z"),
    previous: {
      ...attention,
      activity: "idle",
      isAcknowledged: true,
    },
    title: "[ · ] Action Required",
  });
  assert.equal(middleDotFrame.activity, "idle");

  const nonCodex = applyAgentActivityTransition({
    agentId: "claude",
    nowIso: "2026-05-30T12:00:20.000Z",
    nowMs: Date.parse("2026-05-30T12:00:20.000Z"),
    previous: working,
    title: "[ . ] Action Required",
  });
  assert.equal(nonCodex.activity, "idle");
});

test("Codex spinner title working expires when the title frame is stuck", () => {
  const firstFrame = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowIso: "2026-06-01T12:00:00.000Z",
    nowMs: Date.parse("2026-06-01T12:00:00.000Z"),
    title: "⠏ Skip migration issue 2 options",
  });
  assert.equal(firstFrame.activity, "working");
  assert.equal(firstFrame.lastTitle, "⠏ Skip migration issue 2 options");
  assert.equal(firstFrame.lastTitleChangeAt, "2026-06-01T12:00:00.000Z");
  assert.equal(firstFrame.workingSource, "title");

  const sameFrameInsideWindow = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowIso: "2026-06-01T12:00:02.000Z",
    nowMs: Date.parse("2026-06-01T12:00:02.000Z"),
    previous: firstFrame,
    title: "⠏ Skip migration issue 2 options",
  });
  assert.equal(sameFrameInsideWindow.activity, "working");
  assert.equal(sameFrameInsideWindow.lastTitleChangeAt, "2026-06-01T12:00:00.000Z");

  const sameFrameAfterWindow = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowIso: "2026-06-01T12:00:03.025Z",
    nowMs: Date.parse("2026-06-01T12:00:03.025Z"),
    previous: sameFrameInsideWindow,
    title: "⠏ Skip migration issue 2 options",
  });
  assert.equal(sameFrameAfterWindow.activity, "attention");
  assert.equal(sameFrameAfterWindow.workingSource, undefined);

  const refreshedSpinnerFrame = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowIso: "2026-06-01T12:00:04.000Z",
    nowMs: Date.parse("2026-06-01T12:00:04.000Z"),
    previous: sameFrameInsideWindow,
    title: "⠋ Skip migration issue 2 options",
  });
  assert.equal(refreshedSpinnerFrame.activity, "working");
  assert.equal(refreshedSpinnerFrame.lastTitleChangeAt, "2026-06-01T12:00:04.000Z");
});

test("presentation activity expires stale title-derived working without expiring explicit working", () => {
  const titleDerived = getEffectiveAgentActivityState(
    {
      activity: "working",
      agentName: "codex",
      hasSeenWorking: true,
      isAcknowledged: false,
      lastTitle: "⠏ Skip migration issue 2 options",
      lastTitleChangeAt: "2026-06-01T12:00:00.000Z",
      workingSource: "title",
      workingStartedAt: "2026-06-01T12:00:00.000Z",
    },
    { activity: "idle" },
    Date.parse("2026-06-01T12:00:04.000Z"),
  );
  assert.equal(titleDerived.activity, "attention");

  const explicit = getEffectiveAgentActivityState(
    {
      activity: "working",
      agentName: "codex",
      hasSeenWorking: true,
      isAcknowledged: false,
      lastTitle: "⠏ Skip migration issue 2 options",
      lastTitleChangeAt: "2026-06-01T12:00:00.000Z",
      workingSource: "explicit",
      workingStartedAt: "2026-06-01T12:00:00.000Z",
    },
    { activity: "idle" },
    Date.parse("2026-06-01T12:10:00.000Z"),
  );
  assert.equal(explicit.activity, "working");
});

test("title-derived activity preserves macOS agent edge cases", () => {
  const cursor = applyAgentActivityTransition({
    agentId: "claude",
    event: "title",
    nowIso: "2026-06-01T12:00:00.000Z",
    nowMs: Date.parse("2026-06-01T12:00:00.000Z"),
    title: "My Task - ⏳ Working ..·",
  });
  assert.equal(cursor.agentName, "cursor");
  assert.equal(cursor.activity, "working");

  const cursorReady = applyAgentActivityTransition({
    event: "title",
    nowIso: "2026-06-01T12:00:01.000Z",
    nowMs: Date.parse("2026-06-01T12:00:01.000Z"),
    previous: cursor,
    title: "My Task - ✅ Ready",
  });
  assert.equal(cursorReady.agentName, "cursor");
  assert.equal(cursorReady.activity, "idle");

  const antigravityAttention = applyAgentActivityTransition({
    agentId: "codex",
    event: "title",
    nowIso: "2026-06-01T12:00:00.000Z",
    nowMs: Date.parse("2026-06-01T12:00:00.000Z"),
    title: "🔔 agy",
  });
  assert.equal(antigravityAttention.agentName, "antigravity");
  assert.equal(antigravityAttention.activity, "attention");

  const pi = applyAgentActivityTransition({
    event: "title",
    nowIso: "2026-06-01T12:00:00.000Z",
    nowMs: Date.parse("2026-06-01T12:00:00.000Z"),
    title: "π - ghostex",
  });
  assert.equal(pi.agentName, "pi");
  assert.equal(pi.activity, "idle");

  const piWorking = applyAgentActivityTransition({
    event: "title",
    nowIso: "2026-06-01T12:00:01.000Z",
    nowMs: Date.parse("2026-06-01T12:00:01.000Z"),
    previous: pi,
    title: "⠸ π - Restore Pi support - ghostex",
  });
  assert.equal(piWorking.agentName, "pi");
  assert.equal(piWorking.activity, "working");
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
    providerState: { lifecycleState: "missing", zmxName: "S1abcd-P3a91-G8v20" },
    runtimeSettings: {},
    sessionId: "G8v20",
    surface: "workspace",
    title: "Agent task",
    updatedAt: "2026-05-30T12:00:00.000Z",
    zmxName: "S1abcd-P3a91-G8v20",
    ...partial,
  };
}
