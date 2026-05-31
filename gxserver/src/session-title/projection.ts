import type { GxserverSessionDomainState } from "../../protocol/index.js";
import {
  DEFAULT_TERMINAL_SESSION_TITLE,
  getVisiblePrimaryTitle,
  getVisibleTerminalTitle,
  isIgnoredGenericAgentTerminalTitle,
  isPathLikeTerminalTitle,
  isTemporarySessionTitle,
} from "./normalization.js";
import { getSessionTitleSource, getTrustedResumeTitle } from "./trust.js";
import type { GxserverSessionTitleProjection } from "./types.js";

export function projectSessionTitle(
  session: GxserverSessionDomainState,
  rawTerminalTitle?: string,
): GxserverSessionTitleProjection {
  const titleSource = getSessionTitleSource(session);
  const rawVisibleTerminalTitle = getVisibleTerminalTitle(rawTerminalTitle);
  const primaryCandidate = getSessionCardPrimaryTitle(session.title, session.agentId);
  const visibleTerminalTitle =
    titleSource === "placeholder" &&
    rawVisibleTerminalTitle?.trim().replace(/\s+/g, " ") === session.title.trim().replace(/\s+/g, " ")
      ? undefined
      : rawVisibleTerminalTitle;
  const visiblePrimaryTitle = getVisiblePrimaryTitle(primaryCandidate);
  const shouldUseStoredTitleOverEllipsizedTerminalTitle = isEllipsizedTerminalTitleForStoredTitle(
    visibleTerminalTitle,
    visiblePrimaryTitle,
  );
  const shouldPreferTerminalTitle = Boolean(visibleTerminalTitle) && !shouldUseStoredTitleOverEllipsizedTerminalTitle;
  const trustedResumeTitle = getTrustedResumeTitle(session).title;
  const primaryTitle = shouldPreferTerminalTitle
    ? visibleTerminalTitle
    : visiblePrimaryTitle
      ? primaryCandidate
      : (visibleTerminalTitle ?? primaryCandidate);
  const terminalTitle = shouldPreferTerminalTitle
    ? undefined
    : primaryCandidate && !shouldUseStoredTitleOverEllipsizedTerminalTitle
      ? visibleTerminalTitle
      : undefined;
  return {
    isPrimaryTitleTerminalTitle:
      (Boolean(visibleTerminalTitle) && (!visiblePrimaryTitle || shouldPreferTerminalTitle)) ||
      (!visibleTerminalTitle && trustedResumeTitle !== undefined),
    isTemporaryTitle: titleSource === "placeholder" || isTemporarySessionTitle(session.title),
    primaryTitle,
    terminalTitle,
    title: session.title,
    titleSource,
    trustedResumeTitle,
  };
}

function getSessionCardPrimaryTitle(title: string, agentName: string | undefined): string | undefined {
  const normalizedTitle = title.trim().replace(/\s+/g, " ");
  if (
    !normalizedTitle ||
    /^Session \d+$/iu.test(normalizedTitle) ||
    isIgnoredGenericAgentTerminalTitle(normalizedTitle) ||
    isPathLikeTerminalTitle(normalizedTitle)
  ) {
    return createAgentSessionDefaultTitle(agentName);
  }
  return normalizedTitle;
}

function createAgentSessionDefaultTitle(agentName: string | undefined): string {
  const normalized = agentName?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_TERMINAL_SESSION_TITLE;
  }
  const title = normalized
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase())
    .replace(/\bCli\b/gu, "CLI");
  return `${title} Session`;
}

function isEllipsizedTerminalTitleForStoredTitle(
  terminalTitle: string | undefined,
  storedTitle: string | undefined,
): boolean {
  const normalizedTerminalTitle = terminalTitle?.trim().replace(/\s+/g, " ");
  const normalizedStoredTitle = storedTitle?.trim().replace(/\s+/g, " ");
  if (!normalizedTerminalTitle || !normalizedStoredTitle) {
    return false;
  }
  const prefix = normalizedTerminalTitle.replace(/(?:\.\.\.|…)$/u, "").trim();
  return (
    prefix !== normalizedTerminalTitle &&
    prefix.length > 0 &&
    normalizedStoredTitle.length > normalizedTerminalTitle.length &&
    normalizedStoredTitle.toLowerCase().startsWith(prefix.toLowerCase())
  );
}
