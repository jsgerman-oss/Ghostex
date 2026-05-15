import Fuse, { type IFuseOptions } from "fuse.js";
import type {
  SidebarPreviousSessionItem,
  SidebarSessionItem,
} from "../shared/session-grid-contract";
import { getSessionHistoryCardTitle } from "./session-history-card-title";

export type PreviousSessionsModalDayGroup = {
  dayLabel: string;
  sessions: SidebarPreviousSessionItem[];
};

export type FilterPreviousSessionsOptions = {
  favoritesOnly?: boolean;
};

type SidebarSearchableSession = Pick<
  SidebarSessionItem,
  "alias" | "detail" | "primaryTitle" | "sessionNumber" | "terminalTitle"
>;

type SidebarSessionSearchRecord<T extends SidebarSearchableSession> = {
  item: T;
  itemIndex: number;
  searchText: string;
};

const SESSION_SEARCH_OPTIONS = {
  ignoreDiacritics: true,
  ignoreLocation: true,
  keys: ["searchText"],
  shouldSort: false,
  threshold: 0.3,
  useTokenSearch: true,
} satisfies IFuseOptions<SidebarSessionSearchRecord<SidebarSearchableSession>>;

export function filterPreviousSessions(
  previousSessions: readonly SidebarPreviousSessionItem[],
  query: string,
  options: FilterPreviousSessionsOptions = {},
): SidebarPreviousSessionItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSessions = options.favoritesOnly
    ? previousSessions.filter((session) => session.isFavorite)
    : [...previousSessions];
  const dedupedSessions = dedupePreviousSessionsByProjectAndTitle(filteredSessions);

  if (!normalizedQuery) {
    return dedupedSessions;
  }

  return filterSidebarSessionItems(dedupedSessions, query);
}

export function filterPreviousSessionsModalItems(
  previousSessions: readonly SidebarPreviousSessionItem[],
): SidebarPreviousSessionItem[] {
  /**
   * CDXC:PreviousSessions 2026-05-15-09:57
   * The Previous Sessions modal is an agent-session restore surface. Browser
   * page history can still exist in shared storage for compatibility, but the
   * modal must hide web pages so the list only presents agent sessions.
   */
  return previousSessions.filter((session) => !isPreviousSessionWebPage(session));
}

export function groupPreviousSessionsByDay(
  previousSessions: readonly SidebarPreviousSessionItem[],
): PreviousSessionsModalDayGroup[] {
  const formatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
  const sessionsByDay = new Map<string, SidebarPreviousSessionItem[]>();

  for (const session of previousSessions) {
    const date = new Date(session.closedAt);
    const key = Number.isNaN(date.getTime()) ? "Unknown day" : formatter.format(date);
    const grouped = sessionsByDay.get(key);
    if (grouped) {
      grouped.push(session);
      continue;
    }

    sessionsByDay.set(key, [session]);
  }

  return [...sessionsByDay.entries()].map(([dayLabel, sessions]) => ({
    dayLabel,
    sessions,
  }));
}

export function filterSidebarSessionItems<T extends SidebarSearchableSession>(
  sessions: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeSessionSearchValue(query);
  if (!normalizedQuery) {
    return [...sessions];
  }

  const searchRecords = sessions.map((session, itemIndex) =>
    createSidebarSessionSearchRecord(session, itemIndex),
  );
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const shouldUseAbbreviationMatching =
    queryTokens.length > 0 && queryTokens.every((token) => token.length <= 3);

  if (shouldUseAbbreviationMatching) {
    return sessions.filter((_, itemIndex) =>
      matchesNormalizedQueryTokens(searchRecords[itemIndex]?.searchText ?? "", queryTokens),
    );
  }

  const fuse = new Fuse(searchRecords, SESSION_SEARCH_OPTIONS);
  const matchedItemIndexes = new Set(
    fuse.search(normalizedQuery).map((result) => result.item.itemIndex),
  );

  return sessions.filter((_, itemIndex) => matchedItemIndexes.has(itemIndex));
}

export function matchesSidebarSessionSearchQuery(
  session: SidebarSearchableSession,
  query: string,
): boolean {
  return filterSidebarSessionItems([session], query).length > 0;
}

function createSidebarSessionSearchRecord<T extends SidebarSearchableSession>(
  session: T,
  itemIndex: number,
): SidebarSessionSearchRecord<T> {
  return {
    item: session,
    itemIndex,
    searchText: [
      session.alias,
      session.primaryTitle,
      session.terminalTitle,
      session.detail,
      session.sessionNumber,
    ]
      .map((part) => normalizeSessionSearchValue(part))
      .filter(Boolean)
      .join(" "),
  };
}

function normalizeSessionSearchValue(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_/\\.]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dedupePreviousSessionsByProjectAndTitle(
  sessions: readonly SidebarPreviousSessionItem[],
): SidebarPreviousSessionItem[] {
  /**
   * CDXC:PreviousSessions 2026-05-11-09:04
   * Previous Sessions must not show duplicate historical cards for the same
   * project and session name. Keep only the latest closed/active item before
   * search so both the modal and sidebar search share the same unique list.
   */
  const dedupedByKey = new Map<
    string,
    {
      item: SidebarPreviousSessionItem;
      itemIndex: number;
      timestamp: number;
    }
  >();

  sessions.forEach((session, itemIndex) => {
    const key = createPreviousSessionDedupeKey(session);
    const timestamp = getPreviousSessionDedupeTimestamp(session);
    const current = dedupedByKey.get(key);
    if (current && current.timestamp >= timestamp) {
      return;
    }

    dedupedByKey.set(key, {
      item: session,
      itemIndex,
      timestamp,
    });
  });

  return [...dedupedByKey.values()]
    .sort((left, right) => left.itemIndex - right.itemIndex)
    .map((entry) => entry.item);
}

function isPreviousSessionWebPage(session: SidebarPreviousSessionItem): boolean {
  return (
    session.sessionKind === "browser" ||
    session.sessionRecord?.kind === "browser" ||
    session.agentIcon === "browser"
  );
}

function createPreviousSessionDedupeKey(session: SidebarPreviousSessionItem): string {
  const projectKey = normalizeSessionSearchValue(
    session.projectPath || session.projectId || session.projectName || "",
  );
  const scopedProjectKey = projectKey || `history:${session.historyId}`;
  const titleKey = normalizeSessionSearchValue(getSessionHistoryCardTitle(session));

  return `${scopedProjectKey}\u0000${titleKey}`;
}

function getPreviousSessionDedupeTimestamp(session: SidebarPreviousSessionItem): number {
  const lastInteractionTimestamp = parsePreviousSessionTimestamp(session.lastInteractionAt);
  const closedTimestamp = parsePreviousSessionTimestamp(session.closedAt);

  return Math.max(lastInteractionTimestamp, closedTimestamp);
}

function parsePreviousSessionTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function matchesNormalizedQueryTokens(searchText: string, queryTokens: readonly string[]): boolean {
  return queryTokens.every((token) => fuzzyIncludes(searchText, token));
}

function fuzzyIncludes(text: string, query: string): boolean {
  let queryIndex = 0;

  for (const character of text) {
    if (character !== query[queryIndex]) {
      continue;
    }

    queryIndex += 1;
    if (queryIndex >= query.length) {
      return true;
    }
  }

  return query.length === 0;
}
