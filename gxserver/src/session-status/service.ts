import type {
  GxserverSessionDomainState,
  GxserverUpdateAgentActivityParams,
} from "../../protocol/index.js";
import {
  applyAgentActivityTransition,
  normalizeActivity,
  normalizeActivityEvent,
  normalizeAgentActivityState,
  normalizeText,
} from "./transition.js";
import type { GxserverSessionStatusUpdate } from "./types.js";

export function updateSessionActivitySettings(
  session: GxserverSessionDomainState,
  params: GxserverUpdateAgentActivityParams,
): GxserverSessionStatusUpdate {
  const previous = normalizeAgentActivityState(session.runtimeSettings.agentActivity, {
    activity:
      session.runtimeSettings.activity === "working" || session.runtimeSettings.activity === "attention"
        ? session.runtimeSettings.activity
        : "idle",
  });
  const nowMs = params.nowMs ?? Date.now();
  const activity = applyAgentActivityTransition({
    activity: normalizeActivity(params.activity),
    agentId: params.agentName ?? session.agentId ?? previous.agentName,
    event: normalizeActivityEvent(params.event),
    nowIso: new Date(nowMs).toISOString(),
    nowMs,
    previous,
    title: normalizeText(params.title),
  });
  return {
    activity,
    enteredAttention: previous.activity !== "attention" && activity.activity === "attention",
    lastActiveAt: activity.activity === "working" || activity.activity === "attention" ? activity.lastChangedAt : session.lastActiveAt,
    previousActivity: previous.activity,
    runtimeSettings: {
      ...session.runtimeSettings,
      agentActivity: activity,
    },
  };
}
