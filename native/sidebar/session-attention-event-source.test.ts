import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = nativeSidebarSource.indexOf(start);
  const endIndex = nativeSidebarSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return nativeSidebarSource.slice(startIndex, endIndex);
}

describe("native sidebar attention event side effects", () => {
  test("deduplicates attention sound and notifications by attentionEventId", () => {
    /*
    CDXC:SessionAttention 2026-06-07-03:40:
    Re-reading the same hook or gxserver attention event after local clear must
    not replay completion sounds. Side effects are keyed by attentionEventId
    while UI state can still reflect a real unacknowledged attention event.
    */
    const cacheState = sourceBetween(
      "const nativeAttentionEventIdBySessionId = new Map<string, string>();",
      "const SIDEBAR_CARD_FOCUS_TRACE_WINDOW_MS",
    );
    expect(cacheState).toContain("NATIVE_ATTENTION_EVENT_CACHE_LIMIT");
    expect(cacheState).toContain("nativeAttentionSideEffectEventKeys");
    expect(cacheState).toContain("nativeLocallyAcknowledgedAttentionEventKeys");

    const attentionHelpers = sourceBetween(
      "function normalizeNativeAttentionEventId",
      "function clearNativeSessionAttentionAcknowledgementTimer",
    );
    expect(attentionHelpers).toContain("shouldRunNativeAttentionSideEffects");
    expect(attentionHelpers).toContain("markNativeAttentionEventLocallyAcknowledged");
    expect(attentionHelpers).toContain("isNativeAttentionEventLocallyAcknowledged");
    expect(attentionHelpers).toContain("playNativeSessionCompletionSound(sessionId, source, normalizedAttentionEventId)");
    expect(attentionHelpers).toContain("showNativeSessionAttentionNotification(sessionId, source)");

    const gxserverActivity = sourceBetween(
      "function applyGxserverSessionActivityResult",
      "async function syncNativeSessionActivityWithGxserver",
    );
    expect(gxserverActivity).toContain("const attentionEventId = getNativeGxserverAttentionEventId(result.activity)");
    expect(gxserverActivity).toContain("reportedActivity");
    expect(gxserverActivity).toContain("isNativeAttentionEventLocallyAcknowledged(sessionId, attentionEventId)");
    expect(gxserverActivity).toContain("handleNativeSessionEnteredAttention(sessionId, source, attentionEventId)");

    const presentationChrome = sourceBetween(
      "function applyGxserverPresentationSessionToNativePaneChrome",
      "function setGxserverPresentationSessionLifecycleLocally",
    );
    expect(presentationChrome).toContain("const previousActivity = terminalState.activity");
    expect(presentationChrome).toContain("getNativeGxserverPresentationAttentionEventId(presentation)");
    expect(presentationChrome).toContain("shouldRunNativeGxserverPresentationAttentionSideEffects(reason)");
    expect(presentationChrome).toContain('previousActivity !== "attention"');
    expect(presentationChrome).toContain('presentation.activity === "attention"');
    expect(presentationChrome).toContain("presentation.attention?.acknowledged !== true");
    expect(presentationChrome).toContain("!isNativeAttentionEventLocallyAcknowledged(presentation.sessionId, attentionEventId)");
    expect(presentationChrome).toContain("handleNativeSessionEnteredAttention(");
    expect(presentationChrome).toContain('"gxserver-presentation"');

    const eventIdHelpers = sourceBetween(
      "function getNativeGxserverAttentionEventId",
      "function readGxserverFirstPromptTitleGenerationRunning",
    );
    expect(eventIdHelpers).toContain("activity.lastChangedAt");
    expect(eventIdHelpers).toContain("persistedState.statusUpdatedAt");
    expect(eventIdHelpers).toContain("function getNativeGxserverPresentationAttentionEventId");
    expect(eventIdHelpers).toContain("presentation.attention?.eventId");
    expect(eventIdHelpers).toContain("presentation.attention?.enteredAt");
    expect(eventIdHelpers).toContain("function shouldRunNativeGxserverPresentationAttentionSideEffects");
    expect(eventIdHelpers).toContain('return reason === "delta:sessionPresentationChanged";');

    const persistedActivity = sourceBetween(
      "function syncNativePersistedAgentActivity",
      "function isNativePersistedWorkingFresh",
    );
    expect(persistedActivity).toContain("nativePersistedAgentHookEventSyncKeyBySessionId");
    expect(persistedActivity).toContain("void syncGxserverAgentHookEvent(sessionId, {");
    expect(persistedActivity).toContain("status: persistedState.status");
    expect(persistedActivity).toContain("statusUpdatedAt: persistedState.statusUpdatedAt ?? persistedState.lastActivityAt");

    const acknowledgePath = sourceBetween(
      "function completeNativeTerminalAttentionAcknowledgement",
      "function getGxserverPresentationActivityForSidebarSession",
    );
    expect(acknowledgePath).toContain("markNativeAttentionEventLocallyAcknowledged");
    expect(acknowledgePath).toContain("nativeAttentionEventIdBySessionId.get(sessionId)");
  });

  test("keeps command-pane action completion sounds on the command path", () => {
    /*
    CDXC:CommandsPanel 2026-06-08-13:19:
    Command-pane completions use the action completion sound, not the session
    attention bell, and their status writer must use unique temp files so the
    idle stamp that triggers sound is not lost to concurrent hook writes.
    */
    const persistedCommandPane = sourceBetween(
      "function syncNativePersistedCommandPaneActivity",
      "function syncNativePersistedAgentActivity",
    );
    expect(persistedCommandPane).toContain('session.surface !== "commands"');
    expect(persistedCommandPane).toContain("const didFail = (persistedState.commandExitCode ?? 0) !== 0");
    expect(persistedCommandPane).toContain("didFail || storedSession.playCompletionSound");
    expect(persistedCommandPane).toContain("playNativeSidebarActionCompletionSound(sessionId)");

    const terminalExitCommandPane = sourceBetween(
      "function handleNativeSidebarCommandSessionExit",
      "/**\n * CDXC:Actions",
    );
    expect(terminalExitCommandPane).toContain("const didFail = (exitCode ?? 0) !== 0");
    expect(terminalExitCommandPane).toContain("didFail || storedSession.playCompletionSound");
    expect(terminalExitCommandPane).toContain("playNativeSidebarActionCompletionSound(sessionId)");

    const actionSound = sourceBetween(
      "function playNativeSidebarActionCompletionSound",
      "function setNativeSidebarCommandSession",
    );
    expect(actionSound).toContain("settings.actionCompletionSound");
    expect(actionSound).not.toContain("completionBellEnabled");

    const commandStatusScript = sourceBetween(
      "function getNativeSidebarCommandStatusStampText",
      "function createNativeSidebarCommandRunId",
    );
    expect(commandStatusScript).toContain("import os");
    expect(commandStatusScript).toContain("state_path.with_name(f'{state_path.name}.{os.getpid()}.command.tmp')");
  });

  test("uses per-process temp files for session-state writes", () => {
    /*
    CDXC:SessionAttention 2026-06-07-03:40:
    Multiple acknowledgement paths can write the same session-state file at
    once, so the Python helpers must not share a fixed `.tmp` filename.
    */
    const stampScript = sourceBetween(
      "function getStampNativeSessionSemanticActivityScript",
      "function getAcknowledgeNativeSessionAttentionScript",
    );
    expect(stampScript).toContain("import os");
    expect(stampScript).toContain('state_path.with_name(f"{state_path.name}.{os.getpid()}.tmp")');

    const acknowledgeScript = sourceBetween(
      "function getAcknowledgeNativeSessionAttentionScript",
      "function parseNativePersistedSessionState",
    );
    expect(acknowledgeScript).toContain("import os");
    expect(acknowledgeScript).toContain('state_path.with_name(f"{state_path.name}.{os.getpid()}.tmp")');
  });
});
