import type {
  GxserverProjectDomainState,
  GxserverSessionDomainState,
  GxserverSessionTitleSource,
} from "../../protocol/index.js";
import { getVisibleTerminalTitle } from "../session-title/normalization.js";
import { getTrustedResumeTitle, isRejectedResumeTitle, normalizeTitleSource } from "../session-title/trust.js";
import {
  identitiesMatch,
  normalizeAgentId,
  normalizeText,
  type GxserverResolvedSessionIdentity,
} from "./identity.js";

export interface GxserverTrustedTitleCandidate {
  reason: string;
  title: string;
  titleSource: GxserverSessionTitleSource;
  updatedAt?: string;
}

export function selectTrustedTitleForIdentity(input: {
  currentSession: GxserverSessionDomainState;
  eventTitle?: unknown;
  eventTitleSource?: unknown;
  identity: GxserverResolvedSessionIdentity;
  project: GxserverProjectDomainState;
  sessions: readonly GxserverSessionDomainState[];
}): GxserverTrustedTitleCandidate | undefined {
  const eventCandidate = createTrustedTitleCandidate(
    input.eventTitle,
    input.eventTitleSource,
    "event-title",
  );
  if (eventCandidate) {
    return eventCandidate;
  }

  const liveCandidate = selectNewestCandidate(
    input.sessions
      .filter((session) => session.sessionId !== input.currentSession.sessionId)
      .filter((session) =>
        identitiesMatch(input.identity, {
          agentId: session.agentId ?? normalizeText(session.runtimeSettings.agentName),
          agentSessionId: normalizeText(session.runtimeSettings.agentSessionId),
          agentSessionPath: normalizeText(session.runtimeSettings.agentSessionPath),
        }),
      )
      .map((session) => {
        const trusted = getTrustedResumeTitle(session);
        return trusted.title
          ? {
              reason: `matching-live-session:${session.sessionId}`,
              title: trusted.title,
              titleSource: normalizeTitleSource(session.runtimeSettings.titleSource, session.title),
              updatedAt: session.lastActiveAt ?? session.updatedAt,
            }
          : undefined;
      }),
  );
  if (liveCandidate) {
    return liveCandidate;
  }

  return selectNewestCandidate(
    input.project.previousSessionHistory
      .map((item) => createHistoryTitleCandidate(item, input.identity))
      .filter((item): item is GxserverTrustedTitleCandidate => item !== undefined),
  );
}

function createHistoryTitleCandidate(
  value: Record<string, unknown>,
  identity: GxserverResolvedSessionIdentity,
): GxserverTrustedTitleCandidate | undefined {
  const sessionRecord = isRecord(value.sessionRecord) ? value.sessionRecord : undefined;
  const hidden = isRecord(value.hiddenRestoreMetadata) ? value.hiddenRestoreMetadata : undefined;
  const hiddenRecord = isRecord(hidden?.sessionRecord) ? hidden.sessionRecord : undefined;
  const candidateIdentity: GxserverResolvedSessionIdentity = {
    agentId:
      normalizeAgentId(value.agentId) ??
      normalizeAgentId(value.agentName) ??
      normalizeAgentId(sessionRecord?.agentName) ??
      normalizeAgentId(hiddenRecord?.agentName),
    agentSessionId:
      normalizeText(value.agentSessionId) ??
      normalizeText(sessionRecord?.agentSessionId) ??
      normalizeText(hiddenRecord?.agentSessionId),
    agentSessionPath:
      normalizeText(value.agentSessionPath) ??
      normalizeText(sessionRecord?.agentSessionPath) ??
      normalizeText(hiddenRecord?.agentSessionPath),
  };
  if (!identitiesMatch(identity, candidateIdentity)) {
    return undefined;
  }

  const recordTitle = createTrustedTitleCandidate(
    sessionRecord?.title,
    sessionRecord?.titleSource,
    "previous-session-record-title",
    normalizeText(value.lastInteractionAt) ?? normalizeText(value.closedAt),
  );
  if (recordTitle) {
    return recordTitle;
  }

  return (
    createTrustedTitleCandidate(
      value.primaryTitle,
      value.isPrimaryTitleTerminalTitle === true ? "terminal-auto" : "user",
      "previous-session-primary-title",
      normalizeText(value.lastInteractionAt) ?? normalizeText(value.closedAt),
    ) ??
    createTrustedTitleCandidate(
      value.terminalTitle,
      "terminal-auto",
      "previous-session-terminal-title",
      normalizeText(value.lastInteractionAt) ?? normalizeText(value.closedAt),
    )
  );
}

function createTrustedTitleCandidate(
  title: unknown,
  titleSource: unknown,
  reason: string,
  updatedAt?: string,
): GxserverTrustedTitleCandidate | undefined {
  const normalizedTitle = getVisibleTerminalTitle(normalizeText(title))?.trim();
  if (!normalizedTitle || isRejectedResumeTitle(normalizedTitle)) {
    return undefined;
  }
  const normalizedSource = normalizeTitleSource(titleSource, normalizedTitle);
  if (normalizedSource === "placeholder") {
    return undefined;
  }
  return {
    reason,
    title: normalizedTitle,
    titleSource: normalizedSource,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function selectNewestCandidate(
  candidates: Array<GxserverTrustedTitleCandidate | undefined>,
): GxserverTrustedTitleCandidate | undefined {
  return candidates
    .filter((candidate): candidate is GxserverTrustedTitleCandidate => candidate !== undefined)
    .sort((left, right) => timestampValue(right.updatedAt) - timestampValue(left.updatedAt))[0];
}

function timestampValue(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
