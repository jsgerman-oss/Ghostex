import type {
  GxserverPresentationSearchParams,
  GxserverPresentationSearchResponse,
  GxserverPresentationSearchResult,
  GxserverProjectDomainState,
  GxserverSessionDomainState,
} from "../../protocol/index.js";
import type { GxserverPresentationReadModel } from "./repository.js";
import { isActivePresentationSession } from "./projector.js";
import { projectSessionTitle } from "../session-title/projection.js";
import { getTrustedResumeTitle } from "../session-title/trust.js";

const DEFAULT_SEARCH_LIMIT = 40;
const MAX_SEARCH_LIMIT = 100;

/*
CDXC:GxserverPresentationSearch 2026-06-01-15:08:
Sidebar and Previous Sessions search are metadata-only in this pass. Query gxserver's project/session records on demand with limit/cursor instead of preloading old sessions into React or adding an FTS table before metadata search proves insufficient.
*/
export function searchGxserverPresentationSessions(
  state: GxserverPresentationReadModel,
  params: GxserverPresentationSearchParams,
): GxserverPresentationSearchResponse {
  const limit = normalizeLimit(params.limit);
  const offset = normalizeCursor(params.cursor);
  const includeActive = params.includeActive !== false;
  const includePrevious = params.includePrevious !== false;
  const query = normalizeQuery(params.query);
  const sessionTags = normalizeSessionTags(params.sessionTags);
  const projectsById = new Map(state.projects.map((project) => [project.projectId, project]));
  const candidates = state.sessions
    .filter((session) => !params.projectId || session.projectId === params.projectId)
    .filter((session) => sessionTags.length === 0 || (session.sessionTag && sessionTags.includes(session.sessionTag)))
    .filter((session) => {
      const active = isActivePresentationSession(session);
      return (active && includeActive) || (!active && includePrevious);
    })
    .map((session) => ({ match: matchSession(projectsById.get(session.projectId), session, query), session }))
    .filter((candidate) => !query || candidate.match)
    .sort((left, right) => compareSessionRecency(left.session, right.session));

  const page = candidates.slice(offset, offset + limit);
  return {
    cursor: offset + limit < candidates.length ? String(offset + limit) : undefined,
    results: page.map(({ match, session }) =>
      toSearchResult(projectsById.get(session.projectId), session, match ?? { field: "title" as const }),
    ),
  };
}

export function searchGxserverPreviousSessions(
  state: GxserverPresentationReadModel,
  params: GxserverPresentationSearchParams,
): GxserverPresentationSearchResponse {
  /*
  CDXC:PreviousSessions 2026-06-04-20:21:
  The Previous Sessions modal is a restore surface, not a dump of every inactive gxserver row. Return stopped sessions with trusted resume titles plus explicitly pinned/favorited rows, so placeholder terminals created during migration or startup do not keep reappearing without useful activity metadata.
  */
  return searchGxserverPresentationSessions(
    {
      projects: state.projects,
      sessions: state.sessions.filter(isPreviousSessionHistoryCandidate),
    },
    {
      ...params,
      includeActive: false,
      includePrevious: true,
    },
  );
}

function toSearchResult(
  project: GxserverProjectDomainState | undefined,
  session: GxserverSessionDomainState,
  match: NonNullable<GxserverPresentationSearchResult["match"]>,
): GxserverPresentationSearchResult {
  const titleProjection = projectSessionTitle(session);
  /*
  CDXC:GxserverPresentationSearch 2026-06-01-22:06:
  Previous Sessions uses the same session-card renderer as the live sidebar. Search results must carry gxserver's full title projection, not only `title`, so every client can suppress the unsynced `∗` marker for terminal-synced persisted titles and keep placeholders marked.
  */
  return {
    ...(session.agentId ? { agentId: session.agentId } : {}),
    createdAt: session.createdAt,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    isFavorite: session.sessionTag === "favorite" || session.isFavorite,
    isPinned: session.isPinned,
    isPrimaryTitleTerminalTitle: titleProjection.isPrimaryTitleTerminalTitle,
    isTemporaryTitle: titleProjection.isTemporaryTitle,
    ...(session.lastActiveAt ? { lastActiveAt: session.lastActiveAt } : {}),
    lifecycleState: session.lifecycleState,
    match,
    projectId: session.projectId,
    projectTitle: project?.name ?? session.projectId,
    ...(titleProjection.primaryTitle !== undefined ? { primaryTitle: titleProjection.primaryTitle } : {}),
    sessionId: session.sessionId,
    ...(session.sessionTag ? { sessionTag: session.sessionTag } : {}),
    subtitle: session.cwd ?? project?.path,
    surface: session.surface,
    ...(titleProjection.terminalTitle !== undefined ? { terminalTitle: titleProjection.terminalTitle } : {}),
    title: titleProjection.title,
    titleSource: titleProjection.titleSource,
    ...(titleProjection.trustedResumeTitle !== undefined ? { trustedResumeTitle: titleProjection.trustedResumeTitle } : {}),
    updatedAt: session.updatedAt,
  };
}

function isPreviousSessionHistoryCandidate(session: GxserverSessionDomainState): boolean {
  if (isActivePresentationSession(session)) {
    return false;
  }
  if (session.isPinned || session.isFavorite || session.sessionTag) {
    return true;
  }
  if (session.lifecycleState !== "stopped") {
    return false;
  }
  return getTrustedResumeTitle(session).title !== undefined;
}

function normalizeSessionTags(
  values: GxserverPresentationSearchParams["sessionTags"],
): NonNullable<GxserverPresentationSearchParams["sessionTags"]> {
  return values?.filter((value, index, allValues) => allValues.indexOf(value) === index) ?? [];
}

function matchSession(
  project: GxserverProjectDomainState | undefined,
  session: GxserverSessionDomainState,
  query: string,
): GxserverPresentationSearchResult["match"] | undefined {
  if (!query) {
    return { field: "title" };
  }
  const titleProjection = projectSessionTitle(session);
  const fields: Array<{ field: NonNullable<GxserverPresentationSearchResult["match"]>["field"]; value?: string }> = [
    { field: "title", value: titleProjection.title },
    { field: "title", value: titleProjection.primaryTitle },
    { field: "title", value: titleProjection.terminalTitle },
    { field: "agent", value: session.agentId },
    { field: "agent", value: readText(session.runtimeSettings.agentName) },
    { field: "project", value: project?.name },
    { field: "project", value: project?.path },
    { field: "cwd", value: session.cwd },
    { field: "command", value: session.commandId },
    { field: "id", value: session.sessionId },
    { field: "id", value: session.globalRef },
    { field: "timestamp", value: session.createdAt },
    { field: "timestamp", value: session.updatedAt },
    { field: "timestamp", value: session.lastActiveAt },
  ];
  for (const field of fields) {
    if (field.value?.toLocaleLowerCase().includes(query)) {
      return { field: field.field, snippet: field.value };
    }
  }
  return undefined;
}

function compareSessionRecency(left: GxserverSessionDomainState, right: GxserverSessionDomainState): number {
  const leftTime = left.lastActiveAt ?? left.updatedAt ?? left.createdAt;
  const rightTime = right.lastActiveAt ?? right.updatedAt ?? right.createdAt;
  const byTime = rightTime.localeCompare(leftTime);
  return byTime || left.sessionId.localeCompare(right.sessionId);
}

function normalizeQuery(query: unknown): string {
  return typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(limit)));
}

function normalizeCursor(cursor: unknown): number {
  if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) {
    return 0;
  }
  return Math.max(0, Number.parseInt(cursor, 10));
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
