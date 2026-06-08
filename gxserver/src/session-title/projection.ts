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

const TERMINAL_TITLE_MARKER = "∗";
const UNSYNCED_TITLE_LABEL = "(Unsynced title)";

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
  const isPrimaryTitleTerminalTitle =
    (Boolean(visibleTerminalTitle) && (!visiblePrimaryTitle || shouldPreferTerminalTitle)) ||
    (!visibleTerminalTitle && trustedResumeTitle !== undefined);
  /*
  CDXC:GxserverSessionTitles 2026-06-07-09:33:
  gxserver owns the final human title string for all clients. Publish the visible card title and tooltip title with the unsynced marker already applied so macOS, Electron, CLI, Android, iOS, TUI, Windows, and Linux clients render the same title instead of recomputing title provenance locally.
  */
  const displayTitle = formatDisplaySessionTitle({
    isPrimaryTitleTerminalTitle,
    primaryTitle,
    terminalTitle,
    title: session.title,
  });
  return {
    displayTitle,
    displayTitleTooltip: formatDisplaySessionTitle({
      includeUnsyncedTitleLabel: true,
      isPrimaryTitleTerminalTitle,
      primaryTitle,
      terminalTitle,
      title: session.title,
    }),
    isPrimaryTitleTerminalTitle,
    isTemporaryTitle: titleSource === "placeholder" || isTemporarySessionTitle(session.title),
    primaryTitle,
    terminalTitle,
    title: session.title,
    titleSource,
    trustedResumeTitle,
  };
}

function formatDisplaySessionTitle({
  includeUnsyncedTitleLabel = false,
  isPrimaryTitleTerminalTitle,
  primaryTitle,
  terminalTitle,
  title,
}: {
  includeUnsyncedTitleLabel?: boolean;
  isPrimaryTitleTerminalTitle: boolean;
  primaryTitle?: string;
  terminalTitle?: string;
  title: string;
}): string {
  const normalizedPrimaryTitle = normalizeDisplayTitle(primaryTitle);
  const normalizedTerminalTitle = normalizeDisplayTitle(terminalTitle);
  const normalizedTitle = normalizeDisplayTitle(title);
  const baseTitle = normalizedPrimaryTitle ?? normalizedTitle ?? DEFAULT_TERMINAL_SESSION_TITLE;
  if (
    isPrimaryTitleTerminalTitle ||
    !normalizedPrimaryTitle ||
    normalizedPrimaryTitle === normalizedTerminalTitle
  ) {
    return baseTitle;
  }
  return includeUnsyncedTitleLabel
    ? `${TERMINAL_TITLE_MARKER} ${baseTitle} ${UNSYNCED_TITLE_LABEL}`
    : `${TERMINAL_TITLE_MARKER} ${baseTitle}`;
}

function normalizeDisplayTitle(title: string | undefined): string | undefined {
  const normalized = title?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
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
