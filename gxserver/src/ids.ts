import { randomInt } from "node:crypto";
import type {
  GxserverGlobalSessionRef,
  GxserverProjectId,
  GxserverServerId,
  GxserverSessionId,
  GxserverZmxSessionName,
} from "../protocol/index.js";

const DIGITS = "0123456789";
const LOWERCASE_OR_DIGIT = "abcdefghijklmnopqrstuvwxyz0123456789";
const SERVER_ID_PATTERN = /^S[0-9][a-z0-9]$/;
const PROJECT_ID_PATTERN = /^P[0-9][a-z0-9]{3}$/;
const SESSION_ID_PATTERN = /^G[0-9][a-z0-9]{3}$/;
const MAX_ID_GENERATION_ATTEMPTS = 1024;

export type GxserverIdKind = "server" | "project" | "session";
export type GxserverCandidateFactory<T extends string> = () => T;

/*
CDXC:GxserverIds 2026-05-30-14:16:
gxserver, not clients, generates stable short IDs. Server IDs survive daemon restarts via identity.json, project IDs survive rename/move, and session IDs are immutable; zmx session names use hyphen-separated global refs because provider session names should avoid colons.

CDXC:GxserverIds 2026-06-04-01:40:
zmx session names must include server, project, and session identity (`S-P-G`) so every renderer, CLI, remote client, and recreated gxserver asks zmx for one canonical provider name instead of mixing pre-server `g-*` names with project-scoped `P-G` names.
*/
export function createServerId(): GxserverServerId {
  return `S${randomChar(DIGITS)}${randomChar(LOWERCASE_OR_DIGIT)}` as GxserverServerId;
}

export function createProjectId(): GxserverProjectId {
  return `P${randomChar(DIGITS)}${randomBody(3)}` as GxserverProjectId;
}

export function createSessionId(): GxserverSessionId {
  return `G${randomChar(DIGITS)}${randomBody(3)}` as GxserverSessionId;
}

export function createUniqueProjectId(
  existingProjectIds: ReadonlySet<string>,
  createCandidate: GxserverCandidateFactory<GxserverProjectId> = createProjectId,
): GxserverProjectId {
  return createUniqueId("project", existingProjectIds, isGxserverProjectId, createCandidate);
}

export function createUniqueSessionId(
  existingSessionIdsForProject: ReadonlySet<string>,
  createCandidate: GxserverCandidateFactory<GxserverSessionId> = createSessionId,
): GxserverSessionId {
  return createUniqueId("session", existingSessionIdsForProject, isGxserverSessionId, createCandidate);
}

export function createGlobalSessionRef(
  serverId: GxserverServerId,
  projectId: GxserverProjectId,
  sessionId: GxserverSessionId,
): GxserverGlobalSessionRef {
  return `${serverId}:${projectId}:${sessionId}` as GxserverGlobalSessionRef;
}

export function createZmxSessionName(
  serverId: GxserverServerId,
  projectId: GxserverProjectId,
  sessionId: GxserverSessionId,
): GxserverZmxSessionName {
  return `${serverId}-${projectId}-${sessionId}` as GxserverZmxSessionName;
}

export function isGxserverServerId(value: unknown): value is GxserverServerId {
  return typeof value === "string" && SERVER_ID_PATTERN.test(value);
}

export function isGxserverProjectId(value: unknown): value is GxserverProjectId {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
}

export function isGxserverSessionId(value: unknown): value is GxserverSessionId {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function createUniqueId<T extends string>(
  kind: Exclude<GxserverIdKind, "server">,
  existingIds: ReadonlySet<string>,
  isValid: (value: unknown) => value is T,
  createCandidate: GxserverCandidateFactory<T>,
): T {
  for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = createCandidate();
    if (!isValid(candidate)) {
      throw new Error(`Generated invalid gxserver ${kind} ID: ${candidate}`);
    }
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Unable to generate a unique gxserver ${kind} ID after ${MAX_ID_GENERATION_ATTEMPTS} attempts.`);
}

function randomBody(length: number): string {
  let body = "";
  for (let index = 0; index < length; index += 1) {
    body += randomChar(LOWERCASE_OR_DIGIT);
  }
  return body;
}

function randomChar(chars: string): string {
  return chars[randomInt(0, chars.length)] ?? chars[0]!;
}
