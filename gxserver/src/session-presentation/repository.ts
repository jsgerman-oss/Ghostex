import type Database from "better-sqlite3";
import type {
  GxserverPresentationRevision,
  GxserverPresentationSearchParams,
  GxserverPresentationSearchResponse,
  GxserverPresentationSnapshot,
  GxserverProjectDomainState,
  GxserverServerId,
  GxserverSessionDomainState,
} from "../../protocol/index.js";
import { GxserverDomainRepository } from "../domain-state.js";
import { projectGxserverPresentationSnapshot } from "./projector.js";
import { searchGxserverPresentationSessions, searchGxserverPreviousSessions } from "./search.js";

const PRESENTATION_REVISION_KEY = "presentationRevision";

export interface GxserverPresentationReadModel {
  projects: readonly GxserverProjectDomainState[];
  sessions: readonly GxserverSessionDomainState[];
}

/*
CDXC:GxserverPresentation 2026-06-01-15:08:
Presentation revisions live in gxserver state.db metadata so snapshots after restart still carry a server-owned revision. This pass does not keep a durable replay log; reconnects can replace state with a fresh snapshot when the revision gap cannot be proven safe.
*/
export function readGxserverPresentationSnapshot(
  db: Database.Database,
  serverId: GxserverServerId,
  generatedAt?: string,
): GxserverPresentationSnapshot {
  const state = readPresentationState(db, serverId);
  return projectGxserverPresentationSnapshot({
    generatedAt,
    projects: state.projects,
    revision: readPresentationRevision(db),
    sessions: state.sessions,
  });
}

export function searchGxserverPresentation(
  db: Database.Database,
  serverId: GxserverServerId,
  params: GxserverPresentationSearchParams,
): GxserverPresentationSearchResponse {
  return searchGxserverPresentationSessions(readPresentationState(db, serverId), params);
}

export function listGxserverPreviousSessions(
  db: Database.Database,
  serverId: GxserverServerId,
  params: GxserverPresentationSearchParams,
): GxserverPresentationSearchResponse {
  return searchGxserverPreviousSessions(readPresentationState(db, serverId), params);
}

export function readPresentationState(
  db: Database.Database,
  serverId: GxserverServerId,
): GxserverPresentationReadModel {
  const repository = new GxserverDomainRepository(db, serverId);
  return {
    projects: repository.listProjects(),
    sessions: repository.listSessions(),
  };
}

export function readPresentationRevision(db: Database.Database): GxserverPresentationRevision {
  const row = db
    .prepare<[string], { value: string }>("SELECT value FROM metadata WHERE key = ?")
    .get(PRESENTATION_REVISION_KEY);
  const parsed = row ? Number.parseInt(row.value, 10) : 1;
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : 1) as GxserverPresentationRevision;
}

export function incrementPresentationRevision(db: Database.Database): GxserverPresentationRevision {
  const nextRevision = (readPresentationRevision(db) + 1) as GxserverPresentationRevision;
  db.prepare(
    `INSERT INTO metadata (key, value, updatedAt)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
  ).run(PRESENTATION_REVISION_KEY, String(nextRevision), new Date().toISOString());
  return nextRevision;
}
