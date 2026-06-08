import type {
  GxserverProjectId,
  GxserverSessionDomainState,
  GxserverSessionId,
  GxserverUpdateSessionParams,
} from "../../../protocol/index.js";
import { getTrustedResumeTitle } from "../../session-title/trust.js";
import { normalizeText, resolveSessionIdentity } from "../identity.js";
import { readAgentMetadataTitle } from "./metadata.js";

export interface GxserverAgentTitleRepository {
  getSession(projectId: GxserverProjectId, sessionId: GxserverSessionId): GxserverSessionDomainState | undefined;
  updateSession(input: GxserverUpdateSessionParams): GxserverSessionDomainState;
}

export interface GxserverAgentTitleReconcileResult {
  changed: boolean;
  metadataTitleFound: boolean;
  reason: string;
  session?: GxserverSessionDomainState;
}

export function isAgentAssociatedSession(session: GxserverSessionDomainState): boolean {
  const identity = resolveSessionIdentity({
    agentId: session.agentId,
    agentName: session.runtimeSettings.agentName,
    agentSessionId: session.runtimeSettings.agentSessionId,
    agentSessionPath: session.runtimeSettings.agentSessionPath,
  });
  return Boolean(identity.agentId || identity.agentSessionId || identity.agentSessionPath || session.kind === "agent");
}

export function shouldCheckAgentMetadataTitle(session: GxserverSessionDomainState): boolean {
  if (!isAgentAssociatedSession(session)) {
    return false;
  }
  const pendingStatus = normalizeText(session.runtimeSettings.pendingAgentTitleRequestStatus);
  return (
    pendingStatus === "pending" ||
    (normalizeText(session.runtimeSettings.titleMetadataSource) !== "agent-metadata" &&
      getTrustedResumeTitle(session).title === undefined)
  );
}

export function reconcileAgentMetadataTitle(
  repository: GxserverAgentTitleRepository,
  input: {
    homeDir: string;
    nowIso?: string;
    pendingMismatchStatus?: "metadata-mismatch" | "pending";
    projectId: GxserverProjectId;
    sessionId: GxserverSessionId;
  },
): GxserverAgentTitleReconcileResult {
  const session = repository.getSession(input.projectId, input.sessionId);
  if (!session) {
    return { changed: false, metadataTitleFound: false, reason: "session-missing" };
  }
  if (!isAgentAssociatedSession(session)) {
    return { changed: false, metadataTitleFound: false, reason: "not-agent-associated", session };
  }
  const metadataTitle = readAgentMetadataTitle({ homeDir: input.homeDir, session });
  if (!metadataTitle) {
    return { changed: false, metadataTitleFound: false, reason: "metadata-title-missing", session };
  }

  const pendingTitle = normalizeText(session.runtimeSettings.pendingAgentTitleRequestTitle);
  const pendingStatus =
    pendingTitle === undefined
      ? undefined
      : titlesMatch(pendingTitle, metadataTitle.title)
        ? "confirmed"
        : input.pendingMismatchStatus ?? "metadata-mismatch";
  const runtimeSettings: Record<string, unknown> = {
    ...session.runtimeSettings,
    titleMetadataCheckedAt: input.nowIso ?? new Date().toISOString(),
    titleMetadataProvider: metadataTitle.provider,
    titleMetadataSource: "agent-metadata",
    titleSource: "terminal-auto",
    ...(metadataTitle.updatedAt ? { titleMetadataUpdatedAt: metadataTitle.updatedAt } : {}),
    ...(pendingStatus ? { pendingAgentTitleRequestStatus: pendingStatus } : {}),
  };
  const needsUpdate =
    session.title !== metadataTitle.title ||
    session.runtimeSettings.titleSource !== runtimeSettings.titleSource ||
    session.runtimeSettings.titleMetadataSource !== runtimeSettings.titleMetadataSource ||
    session.runtimeSettings.titleMetadataProvider !== runtimeSettings.titleMetadataProvider ||
    session.runtimeSettings.titleMetadataUpdatedAt !== runtimeSettings.titleMetadataUpdatedAt ||
    session.runtimeSettings.pendingAgentTitleRequestStatus !== runtimeSettings.pendingAgentTitleRequestStatus;

  if (!needsUpdate) {
    return { changed: false, metadataTitleFound: true, reason: "metadata-title-already-current", session };
  }

  /*
  CDXC:GxserverAgentTitles 2026-06-01-09:03:
  Canonical agent titles are reconciled in gxserver from structured metadata, not from per-client rename state. If a UI rename command misses the Agent CLI or the CLI is on the wrong screen, the pending request remains non-canonical and the stored title continues to reflect the real agent thread metadata.
  */
  const updated = repository.updateSession({
    projectId: input.projectId,
    runtimeSettings,
    sessionId: input.sessionId,
    title: metadataTitle.title,
  });
  return {
    changed: true,
    metadataTitleFound: true,
    reason: "metadata-title-applied",
    session: updated,
  };
}

function titlesMatch(left: string, right: string): boolean {
  return left.trim().replace(/\s+/gu, " ") === right.trim().replace(/\s+/gu, " ");
}
