import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { GxserverServerId } from "../protocol/index.js";
import { createServerId, isGxserverServerId } from "./ids.js";
import type { GxserverPaths } from "./paths.js";

export interface GxserverIdentityFile {
  createdAt: string;
  serverId: GxserverServerId;
}

/*
CDXC:GxserverIdentity 2026-05-30-14:16:
The daemon serverId is stable identity, not runtime metadata. Persist it in `~/.ghostex/gxserver/identity.json` so server-scoped refs survive daemon restarts while project/session storage evolves independently in SQLite.
*/
export async function ensureGxserverIdentity(paths: GxserverPaths): Promise<GxserverIdentityFile> {
  const existing = await readGxserverIdentity(paths);
  if (existing) {
    return existing;
  }

  const identity: GxserverIdentityFile = {
    createdAt: new Date().toISOString(),
    serverId: createServerId(),
  };
  await mkdir(paths.rootDir, { recursive: true });
  await writeFile(paths.identityFile, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return identity;
}

async function readGxserverIdentity(paths: GxserverPaths): Promise<GxserverIdentityFile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(paths.identityFile, "utf8")) as Partial<GxserverIdentityFile>;
    if (isGxserverServerId(parsed.serverId)) {
      return {
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
        serverId: parsed.serverId,
      };
    }
    throw new Error(`Invalid gxserver identity file at ${paths.identityFile}. Expected serverId like S7k.`);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
