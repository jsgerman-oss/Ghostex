const GXSERVER_PROJECT_ID_PATTERN = /^P[0-9][a-z0-9]{3}$/u;
const LEGACY_PROJECT_ID_PATTERN = /^project-/u;
const LEGACY_SESSION_ID_PATTERN = /^g-/u;
const PROJECT_ID_KEY_PATTERN = /ProjectId$|^projectId$/u;
const SESSION_ID_KEY_PATTERN = /SessionId$|SessionIds$|^sessionId$|^sessionIds$/u;

/*
CDXC:GxserverMigration 2026-05-30-19:30:
The macOS sidebar must never persist pre-daemon `project-*`/`g-*` identities over a gxserver-migrated projects snapshot. Keep the project-storage identity checks in a small testable helper so startup reads and later React writes can share the same canonical-state contract without adding fallback state repair paths.
*/
export function isGxserverCanonicalProjectsStoragePayload(payloadJson: string | undefined): boolean {
  const parsed = parseJsonRecord(payloadJson);
  if (!parsed) {
    return false;
  }
  if (typeof parsed.gxserverMigratedAt === "string") {
    return true;
  }
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  if (projects.length === 0) {
    return false;
  }
  return projects.every(
    (project) =>
      isRecord(project) &&
      typeof project.projectId === "string" &&
      GXSERVER_PROJECT_ID_PATTERN.test(project.projectId) &&
      !projectStoragePayloadHasLegacyGxserverIds(project),
  );
}

export function projectStoragePayloadHasLegacyGxserverIds(payload: string | unknown): boolean {
  const parsed = typeof payload === "string" ? parseJson(payload) : payload;
  return valueHasLegacyGxserverIds(parsed, undefined);
}

function valueHasLegacyGxserverIds(value: unknown, key: string | undefined): boolean {
  if (typeof value === "string") {
    if (key && PROJECT_ID_KEY_PATTERN.test(key)) {
      return LEGACY_PROJECT_ID_PATTERN.test(value);
    }
    if (key && SESSION_ID_KEY_PATTERN.test(key)) {
      return LEGACY_SESSION_ID_PATTERN.test(value);
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => valueHasLegacyGxserverIds(item, key));
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(([entryKey, entryValue]) =>
    valueHasLegacyGxserverIds(entryValue, entryKey),
  );
}

function parseJsonRecord(payloadJson: string | undefined): Record<string, unknown> | undefined {
  const parsed = parseJson(payloadJson);
  return isRecord(parsed) ? parsed : undefined;
}

function parseJson(payloadJson: string | undefined): unknown {
  if (!payloadJson) {
    return undefined;
  }
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
