import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface GxserverBuildIdentityFile {
  buildIdentity: string;
  fingerprint: string;
  packageVersion: string;
}

/*
CDXC:GxserverRuntimeIdentity 2026-05-30-23:47:
macOS app updates must not hydrate the sidebar against an older same-protocol gxserver daemon. Packaged builds publish a deterministic package fingerprint, while source/dev runs use an explicit source identity so same-build reuse remains stable without hiding corrupt packaged identity files.
*/
export function createSourceGxserverBuildIdentity(version: string): string {
  return `gxserver:${version}:source`;
}

/*
CDXC:GxserverRuntimeIdentity 2026-06-07-13:32:
All gxserver launch paths must reject reuse of an older same-protocol daemon when the current package has a different build identity. The 3.x to 4.x migration and later repair logic live in the daemon process, so silently reusing an old build can leave upgraded users looking at stale or empty sidebar presentation.
*/
export function isGxserverBuildIdentityReusable(
  runningBuildIdentity: unknown,
  expectedBuildIdentity: string | undefined,
): boolean {
  const expected = expectedBuildIdentity?.trim();
  if (!expected) {
    return true;
  }
  return typeof runningBuildIdentity === "string" && runningBuildIdentity === expected;
}

export async function readGxserverBuildIdentity(cliDir: string, version: string): Promise<string> {
  const packageRoot = resolve(cliDir, "..", "..");
  const identityPath = resolve(packageRoot, "build-identity.json");
  try {
    const parsed = JSON.parse(await readFile(identityPath, "utf8")) as Partial<GxserverBuildIdentityFile>;
    if (
      typeof parsed.buildIdentity === "string" &&
      parsed.buildIdentity.length > 0 &&
      typeof parsed.fingerprint === "string" &&
      parsed.fingerprint.length > 0 &&
      typeof parsed.packageVersion === "string" &&
      parsed.packageVersion.length > 0
    ) {
      return parsed.buildIdentity;
    }
    throw new Error(`Invalid gxserver build identity file at ${identityPath}.`);
  } catch (error) {
    if (isMissingFileError(error)) {
      return createSourceGxserverBuildIdentity(version);
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
