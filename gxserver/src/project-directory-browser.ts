import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  GxserverProjectDirectoryBrowseEntry,
  GxserverProjectDirectoryBrowseParams,
  GxserverProjectDirectoryBrowseResult,
} from "../protocol/index.js";
import { GxserverProjectPathError, normalizeAbsolutePath } from "./project-paths.js";

export const GXSERVER_PROJECT_DIRECTORY_BROWSE_DEFAULT_LIMIT = 200;
export const GXSERVER_PROJECT_DIRECTORY_BROWSE_MAX_LIMIT = 500;
export const GXSERVER_PROJECT_DIRECTORY_BROWSE_PATH_LIMIT_CHARS = 1024;

/*
CDXC:RemoteProjectPicker 2026-06-02-23:22:
Remote Add Project uses the T3 Code folder-browse behavior over gxserver instead of a local native folder dialog. Keep this API limited to directory names and full paths, SSH-authenticated, and remote-allowed so the macOS app can browse the remote machine without exposing a generic process or file-content bridge.
*/
export async function browseProjectDirectories(
  params: GxserverProjectDirectoryBrowseParams,
  options: { homeDir?: string } = {},
): Promise<GxserverProjectDirectoryBrowseResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const partialPath = normalizeBrowsePathInput(params.partialPath, "partialPath");
  const limit = normalizeBrowseLimit(params.limit);
  const resolvedInputPath = resolveBrowseTarget({ cwd: params.cwd, partialPath }, homeDir);
  const endsWithSeparator = /[\\/]$/u.test(partialPath) || partialPath === "~";
  const parentPath = endsWithSeparator ? resolvedInputPath : path.dirname(resolvedInputPath);
  const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

  let dirents;
  try {
    dirents = await readdir(parentPath, { withFileTypes: true });
  } catch {
    throw new GxserverProjectPathError("notFound", `Unable to browse directory: ${parentPath}`);
  }

  const showHidden = endsWithSeparator || prefix.startsWith(".");
  const lowerPrefix = prefix.toLowerCase();
  const entries: GxserverProjectDirectoryBrowseEntry[] = dirents
    .filter(
      (dirent) =>
        dirent.isDirectory() &&
        dirent.name.toLowerCase().startsWith(lowerPrefix) &&
        (showHidden || !dirent.name.startsWith(".")),
    )
    .map((dirent) => ({
      fullPath: path.join(parentPath, dirent.name),
      name: dirent.name,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .slice(0, limit);

  return { entries, parentPath };
}

function resolveBrowseTarget(input: { cwd?: string; partialPath: string }, homeDir: string): string {
  if (process.platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
    throw new GxserverProjectPathError("badRequest", "Windows-style paths are only supported on Windows.");
  }

  if (!isExplicitRelativePath(input.partialPath)) {
    return path.resolve(expandHomePath(input.partialPath, homeDir));
  }

  if (!input.cwd) {
    throw new GxserverProjectPathError("badRequest", "Relative filesystem browse paths require cwd.");
  }

  const cwd = normalizeAbsolutePath(input.cwd, "cwd", homeDir);
  return path.resolve(cwd, input.partialPath);
}

function normalizeBrowsePathInput(input: unknown, field: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new GxserverProjectPathError("badRequest", `${field} must be a non-empty path.`);
  }
  if (input.includes("\0")) {
    throw new GxserverProjectPathError("badRequest", `${field} must not contain null bytes.`);
  }
  if (input.length > GXSERVER_PROJECT_DIRECTORY_BROWSE_PATH_LIMIT_CHARS) {
    throw new GxserverProjectPathError(
      "badRequest",
      `${field} exceeds ${GXSERVER_PROJECT_DIRECTORY_BROWSE_PATH_LIMIT_CHARS} characters.`,
    );
  }
  return input;
}

function normalizeBrowseLimit(input: unknown): number {
  if (input === undefined) {
    return GXSERVER_PROJECT_DIRECTORY_BROWSE_DEFAULT_LIMIT;
  }
  if (!Number.isInteger(input) || typeof input !== "number" || input < 1) {
    throw new GxserverProjectPathError("badRequest", "limit must be a positive integer.");
  }
  return Math.min(input, GXSERVER_PROJECT_DIRECTORY_BROWSE_MAX_LIMIT);
}

function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") {
    return homeDir;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

function isExplicitRelativePath(value: string): boolean {
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\")
  );
}

function isWindowsAbsolutePath(value: string): boolean {
  return value.startsWith("\\\\") || /^[a-zA-Z]:([/\\]|$)/u.test(value);
}
