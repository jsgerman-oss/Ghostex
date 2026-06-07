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

    const eventIdHelpers = sourceBetween(
      "function getNativeGxserverAttentionEventId",
      "function readGxserverFirstPromptTitleGenerationRunning",
    );
    expect(eventIdHelpers).toContain("activity.lastChangedAt");
    expect(eventIdHelpers).toContain("persistedState.statusUpdatedAt");

    const persistedActivity = sourceBetween(
      "function syncNativePersistedAgentActivity",
      "function isNativePersistedWorkingFresh",
    );
    expect(persistedActivity).toContain("const attentionEventId = getNativePersistedAttentionEventId(persistedState)");
    expect(persistedActivity).toContain("isNativePersistedAttentionAcknowledgedForSession(");
    expect(persistedActivity).toContain("markNativeAttentionEventLocallyAcknowledged(sessionId, attentionEventId)");
    expect(persistedActivity).toContain("attentionEventId");

    const acknowledgePath = sourceBetween(
      "function completeNativeTerminalAttentionAcknowledgement",
      "function getGxserverPresentationActivityForSidebarSession",
    );
    expect(acknowledgePath).toContain("markNativeAttentionEventLocallyAcknowledged");
    expect(acknowledgePath).toContain("nativeAttentionEventIdBySessionId.get(sessionId)");
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
