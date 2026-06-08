import { GxserverDomainStateError } from "../domain-state.js";
import { isGxserverProjectId, isGxserverSessionId } from "../ids.js";
import type {
  GxserverSessionTransitionParams,
} from "../../protocol/index.js";

/*
CDXC:ProjectSidebarOwnership 2026-06-02-13:01:
Close and sleep transition parameters must describe the shared lifecycle mutation only. Visual order, selected tab, selected pane, and close-focus rules are current-window UI state and stay in the macOS/native client.
*/
export function normalizeSessionTransitionParams(
  params: Record<string, unknown>,
): GxserverSessionTransitionParams {
  if (!isGxserverProjectId(params.projectId)) {
    throw new GxserverDomainStateError("badRequest", `Invalid gxserver project ID: ${String(params.projectId)}.`);
  }
  if (!isGxserverSessionId(params.sessionId)) {
    throw new GxserverDomainStateError("badRequest", `Invalid gxserver session ID: ${String(params.sessionId)}.`);
  }
  if (params.action !== "close" && params.action !== "sleep") {
    throw new GxserverDomainStateError("badRequest", `Invalid session transition action: ${String(params.action)}.`);
  }

  return {
    action: params.action,
    projectId: params.projectId,
    reason: typeof params.reason === "string" ? params.reason : undefined,
    sessionId: params.sessionId,
  };
}
