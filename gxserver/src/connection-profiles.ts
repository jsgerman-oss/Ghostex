import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  GxserverAuthToken,
  GxserverConnectionProfile,
  GxserverConnectionProfilesFile,
  GxserverConnectionTransport,
  GxserverCredentialSecretRef,
} from "../protocol/index.js";
import type { GxserverCredentialStore } from "./credential-store.js";

export class GxserverConnectionProfileError extends Error {
  readonly code: "badRequest" | "notFound";

  constructor(code: "badRequest" | "notFound", message: string) {
    super(message);
    this.code = code;
    this.name = "GxserverConnectionProfileError";
  }
}

export interface GxserverClientConnectionPaths {
  connectionsFile: string;
  clientsDir: string;
}

export function getGxserverClientConnectionPaths(homeDir = os.homedir()): GxserverClientConnectionPaths {
  const clientsDir = path.join(homeDir, ".ghostex", "clients");
  return {
    clientsDir,
    connectionsFile: path.join(clientsDir, "connections.json"),
  };
}

/*
CDXC:GxserverConnectionProfiles 2026-05-30-15:25:
Remote gxserver connections are client-local profiles under `~/.ghostex/clients/connections.json`, shared by the desktop app and gx CLI on the same machine. The file is metadata-only and is shaped for multiple simultaneous servers from the start; actions later choose a profile by name/id or a global S:P:G ref instead of assuming one daemon.
*/
export async function readConnectionProfiles(
  paths: GxserverClientConnectionPaths = getGxserverClientConnectionPaths(),
): Promise<GxserverConnectionProfilesFile> {
  try {
    const parsed = JSON.parse(await readFile(paths.connectionsFile, "utf8")) as Partial<GxserverConnectionProfilesFile>;
    return normalizeProfilesFile(parsed);
  } catch (caught) {
    if (isMissingFileError(caught)) {
      return { profiles: [], version: 1 };
    }
    throw caught;
  }
}

export async function writeConnectionProfiles(
  file: GxserverConnectionProfilesFile,
  paths: GxserverClientConnectionPaths = getGxserverClientConnectionPaths(),
): Promise<void> {
  await mkdir(paths.clientsDir, { mode: 0o700, recursive: true });
  await writeFile(paths.connectionsFile, `${JSON.stringify(normalizeProfilesFile(file), null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function listConnectionProfiles(
  paths: GxserverClientConnectionPaths = getGxserverClientConnectionPaths(),
): Promise<GxserverConnectionProfile[]> {
  return [...(await readConnectionProfiles(paths)).profiles];
}

export async function getConnectionProfile(
  idOrName: string,
  paths: GxserverClientConnectionPaths = getGxserverClientConnectionPaths(),
): Promise<GxserverConnectionProfile | undefined> {
  const key = idOrName.trim();
  return (await readConnectionProfiles(paths)).profiles.find((profile) => profile.id === key || profile.name === key);
}

export async function upsertConnectionProfile(
  input: Omit<Partial<GxserverConnectionProfile>, "createdAt" | "updatedAt"> & {
    id: string;
    name: string;
    transport: GxserverConnectionTransport;
  },
  paths: GxserverClientConnectionPaths = getGxserverClientConnectionPaths(),
  now = new Date(),
): Promise<GxserverConnectionProfile> {
  const current = await readConnectionProfiles(paths);
  const existing = current.profiles.find((profile) => profile.id === input.id);
  const updatedAt = now.toISOString();
  const profile = normalizeProfile({
    ...existing,
    ...input,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
  });
  const profiles = current.profiles.filter((candidate) => candidate.id !== profile.id);
  profiles.push(profile);
  await writeConnectionProfiles({ profiles, version: 1 }, paths);
  return profile;
}

export async function deleteConnectionProfile(
  idOrName: string,
  paths: GxserverClientConnectionPaths = getGxserverClientConnectionPaths(),
): Promise<boolean> {
  const current = await readConnectionProfiles(paths);
  const before = current.profiles.length;
  const profiles = current.profiles.filter((profile) => profile.id !== idOrName && profile.name !== idOrName);
  if (profiles.length === before) {
    return false;
  }
  await writeConnectionProfiles({ profiles, version: 1 }, paths);
  return true;
}

export function createConnectionTokenSecretRef(profileId: string): GxserverCredentialSecretRef {
  const id = normalizeProfileId(profileId);
  return {
    account: `connection:${id}:authToken`,
    service: "ghostex.gxserver",
  };
}

export async function storeConnectionProfileToken(
  store: GxserverCredentialStore,
  profileId: string,
  token: GxserverAuthToken | string,
): Promise<GxserverCredentialSecretRef> {
  const ref = createConnectionTokenSecretRef(profileId);
  await store.set(ref, String(token));
  return ref;
}

export async function readConnectionProfileToken(
  store: GxserverCredentialStore,
  profile: GxserverConnectionProfile,
): Promise<string> {
  if (!profile.tokenSecretRef) {
    throw new GxserverConnectionProfileError("badRequest", `Connection profile ${profile.id} has no token secret ref.`);
  }
  return store.get(profile.tokenSecretRef);
}

function normalizeProfilesFile(file: Partial<GxserverConnectionProfilesFile>): GxserverConnectionProfilesFile {
  return {
    profiles: Array.isArray(file.profiles) ? file.profiles.map(normalizeProfile) : [],
    version: 1,
  };
}

function normalizeProfile(input: Partial<GxserverConnectionProfile>): GxserverConnectionProfile {
  const id = normalizeProfileId(input.id);
  const name = normalizeNonEmptyString(input.name, "name");
  const transport = normalizeTransport(input.transport);
  if ((transport === "direct" || transport === "tailscale") && !input.baseUrl) {
    throw new GxserverConnectionProfileError("badRequest", `${transport} profiles require baseUrl.`);
  }
  if (transport === "ssh" && !input.sshUrl) {
    throw new GxserverConnectionProfileError("badRequest", "ssh profiles require sshUrl.");
  }
  return {
    ...(input.baseUrl ? { baseUrl: String(input.baseUrl) } : {}),
    createdAt: normalizeNonEmptyString(input.createdAt, "createdAt"),
    id,
    name,
    ...(input.serverId ? { serverId: input.serverId } : {}),
    ...(input.sshUrl ? { sshUrl: String(input.sshUrl) } : {}),
    ...(input.tokenSecretRef ? { tokenSecretRef: input.tokenSecretRef } : {}),
    transport,
    updatedAt: normalizeNonEmptyString(input.updatedAt, "updatedAt"),
  };
}

function normalizeProfileId(value: unknown): string {
  const id = normalizeNonEmptyString(value, "id");
  if (!/^[a-zA-Z0-9._:-]+$/u.test(id)) {
    throw new GxserverConnectionProfileError("badRequest", "Connection profile id may only contain letters, numbers, dot, colon, underscore, and dash.");
  }
  return id;
}

function normalizeNonEmptyString(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new GxserverConnectionProfileError("badRequest", `Connection profile ${field} is required.`);
  }
  return text;
}

function normalizeTransport(value: unknown): GxserverConnectionTransport {
  if (value === "local" || value === "tailscale" || value === "direct" || value === "ssh") {
    return value;
  }
  throw new GxserverConnectionProfileError("badRequest", "Connection profile transport must be local, tailscale, direct, or ssh.");
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
