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
  const projectsById = new Map(state.projects.map((project) => [project.projectId, project]));
  const candidates = state.sessions
    .filter((session) => !params.projectId || session.projectId === params.projectId)
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

function toSearchResult(
  project: GxserverProjectDomainState | undefined,
  session: GxserverSessionDomainState,
  match: NonNullable<GxserverPresentationSearchResult["match"]>,
): GxserverPresentationSearchResult {
  const title = projectSessionTitle(session).title;
  return {
    ...(session.agentId ? { agentId: session.agentId } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    isFavorite: session.isFavorite,
    isPinned: session.isPinned,
    ...(session.lastActiveAt ? { lastActiveAt: session.lastActiveAt } : {}),
    lifecycleState: session.lifecycleState,
    match,
    projectId: session.projectId,
    projectTitle: project?.name ?? session.projectId,
    sessionId: session.sessionId,
    subtitle: session.cwd ?? project?.path,
    surface: session.surface,
    title,
  };
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
