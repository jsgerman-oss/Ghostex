import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { GxserverAuthToken } from "../protocol/index.js";
import type { GxserverPaths } from "./paths.js";

const TOKEN_BYTES = 32;
const TOKEN_FILE_MODE = 0o600;
const AUTH_DIR_MODE = 0o700;

export interface GxserverAuthState {
  token: GxserverAuthToken;
  tokenFile: string;
}

/*
CDXC:GxserverAuth 2026-05-30-14:16:
All non-minimal gxserver APIs require the local server token from `~/.ghostex/gxserver/auth/token`. Desktop and CLI clients read this file directly; remote credential-store/token distribution is intentionally outside this foundation bead.
*/
export async function ensureGxserverAuthToken(paths: GxserverPaths): Promise<GxserverAuthState> {
  await mkdir(paths.authDir, { mode: AUTH_DIR_MODE, recursive: true });
  await chmodIfSupported(paths.authDir, AUTH_DIR_MODE);

  const existing = await readGxserverAuthToken(paths);
  if (existing) {
    await chmodIfSupported(paths.authTokenFile, TOKEN_FILE_MODE);
    return existing;
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url") as GxserverAuthToken;
  await writeFile(paths.authTokenFile, `${token}\n`, { flag: "wx", mode: TOKEN_FILE_MODE });
  await chmodIfSupported(paths.authTokenFile, TOKEN_FILE_MODE);
  return { token, tokenFile: paths.authTokenFile };
}

export async function readGxserverAuthToken(paths: GxserverPaths): Promise<GxserverAuthState | undefined> {
  try {
    const token = (await readFile(paths.authTokenFile, "utf8")).trim();
    if (!isValidAuthToken(token)) {
      throw new Error(`Invalid gxserver auth token file at ${paths.authTokenFile}.`);
    }
    return { token: token as GxserverAuthToken, tokenFile: paths.authTokenFile };
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function getBearerToken(request: http.IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return undefined;
  }
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }
  return token;
}

export function isAuthorizedGxserverRequest(request: http.IncomingMessage, expectedToken: GxserverAuthToken): boolean {
  const providedToken = getBearerToken(request);
  if (!providedToken) {
    return false;
  }
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function isValidAuthToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,}$/.test(token);
}

async function chmodIfSupported(filePath: string, mode: number): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  await chmod(filePath, mode);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
