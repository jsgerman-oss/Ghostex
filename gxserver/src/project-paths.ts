import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GxserverProjectDomainState } from "../protocol/index.js";

export class GxserverProjectPathError extends Error {
  readonly code: "badRequest" | "forbidden" | "notFound";

  constructor(code: "badRequest" | "forbidden" | "notFound", message: string) {
    super(message);
    this.code = code;
    this.name = "GxserverProjectPathError";
  }
}

/*
CDXC:GxserverProjectPaths 2026-05-30-14:53:
Remote project add and typed Git/worktree/Beads APIs accept absolute paths plus `~` shortcuts, but gxserver normalizes them server-side and requires filesystem-backed directories. Typed operations are scoped to registered project roots so remote clients cannot turn gxserver into a broad filesystem shell.
*/
export function normalizeExistingDirectoryPath(input: unknown, field: string, homeDir = os.homedir()): string {
  const normalized = normalizeAbsolutePath(input, field, homeDir);
  let fileStat;
  try {
    fileStat = statSync(normalized);
  } catch {
    throw new GxserverProjectPathError("notFound", `${field} does not exist: ${normalized}`);
  }
  if (!fileStat.isDirectory()) {
    throw new GxserverProjectPathError("badRequest", `${field} is not a directory: ${normalized}`);
  }
  return normalized;
}

/*
CDXC:GxserverProjectPaths 2026-06-05-20:07:
Project-path lookup must not stat every registered project because deleted legacy quick/chat projects can poison unrelated active-project operations. Compare candidate paths by syntax only, then validate the selected project at the operation boundary.
*/
export function normalizeAbsolutePath(input: unknown, field: string, homeDir = os.homedir()): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new GxserverProjectPathError("badRequest", `${field} must be a non-empty path.`);
  }
  const expanded = expandUserPath(input.trim(), homeDir);
  if (!path.isAbsolute(expanded)) {
    throw new GxserverProjectPathError("badRequest", `${field} must be an absolute path or start with ~/`);
  }
  return path.resolve(expanded);
}

export function resolveProjectOperationDirectory(
  projects: readonly GxserverProjectDomainState[],
  scope: { projectId?: unknown; projectPath?: unknown },
  homeDir = os.homedir(),
): { project: GxserverProjectDomainState; cwd: string } {
  const project = resolveScopedProject(projects, scope, homeDir);
  if (!project.path) {
    throw new GxserverProjectPathError("badRequest", `Project ${project.projectId} has no filesystem path.`);
  }
  return {
    cwd: normalizeExistingDirectoryPath(project.path, "project.path", homeDir),
    project,
  };
}

/*
CDXC:ProjectBoard 2026-06-13:
A project can pin the directory its Project board's Beads workspace launches from
(projectBoardConfig.beadsDirectory). Unset/blank keeps the project root. When set, it must resolve
to an absolute, existing directory so `bd` runs there; an invalid path raises a
GxserverProjectPathError that surfaces as a board error rather than silently reading the root.
*/
export function resolveProjectBeadsDirectory(
  project: GxserverProjectDomainState,
  homeDir = os.homedir(),
): string | undefined {
  const configured = project.projectBoardConfig?.beadsDirectory;
  if (typeof configured !== "string" || !configured.trim()) {
    return undefined;
  }
  return normalizeExistingDirectoryPath(configured, "beadsDirectory", homeDir);
}

/*
CDXC:ProjectBoard 2026-06-13:
The configurable Beads launch directory must only steer Project Board `bd` operations. The native
Git commit gate calls Beads `storageExists`/`status` on the SAME /api/runBeadsAction endpoint with
the project's own id; those must stay on the project root so a board directory (or a typo in it)
cannot break or alter `git commit`. Board calls opt in via params.projectBoardScope (set by the
macOS Project Board bridge); every other Beads call falls back to the project root (returns
undefined here, so the operation context uses cwd).
*/
export function resolveBeadsCwdForTypedOperation(
  endpointPath: string,
  params: { projectBoardScope?: unknown },
  project: GxserverProjectDomainState,
  homeDir = os.homedir(),
): string | undefined {
  if (endpointPath !== "/api/runBeadsAction" || params.projectBoardScope !== true) {
    return undefined;
  }
  return resolveProjectBeadsDirectory(project, homeDir);
}

export function normalizePathInsideRegisteredRoots(
  input: unknown,
  field: string,
  projects: readonly GxserverProjectDomainState[],
  homeDir = os.homedir(),
): string {
  const normalized = normalizeAbsolutePath(input, field, homeDir);
  const allowedRoots = registeredProjectRoots(projects, homeDir);
  if (!allowedRoots.some((root) => isPathInside(root, normalized))) {
    throw new GxserverProjectPathError("forbidden", `${field} must be inside a registered project root.`);
  }
  return normalized;
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveScopedProject(
  projects: readonly GxserverProjectDomainState[],
  scope: { projectId?: unknown; projectPath?: unknown },
  homeDir: string,
): GxserverProjectDomainState {
  if (typeof scope.projectId === "string" && scope.projectId.trim()) {
    const project = projects.find((candidate) => candidate.projectId === scope.projectId);
    if (!project) {
      throw new GxserverProjectPathError("notFound", `Project ${scope.projectId} does not exist.`);
    }
    if (scope.projectPath !== undefined) {
      const scopedPath = normalizeExistingDirectoryPath(scope.projectPath, "projectPath", homeDir);
      if (!project.path || normalizeProjectPathForLookup(project.path, homeDir) !== scopedPath) {
        throw new GxserverProjectPathError("forbidden", "projectPath does not match the requested projectId.");
      }
    }
    return project;
  }

  const scopedPath = normalizeExistingDirectoryPath(scope.projectPath, "projectPath", homeDir);
  const project = projects.find((candidate) => {
    return normalizeProjectPathForLookup(candidate.path, homeDir) === scopedPath;
  });
  if (!project) {
    throw new GxserverProjectPathError("forbidden", "projectPath must be a registered gxserver project path.");
  }
  return project;
}

function registeredProjectRoots(projects: readonly GxserverProjectDomainState[], homeDir: string): readonly string[] {
  const roots = new Set<string>();
  for (const project of projects) {
    const normalizedPath = normalizeProjectPathForLookup(project.path, homeDir);
    if (normalizedPath) {
      roots.add(normalizedPath);
    }
  }
  return [...roots];
}

function normalizeProjectPathForLookup(input: unknown, homeDir: string): string | undefined {
  try {
    return normalizeAbsolutePath(input, "project.path", homeDir);
  } catch {
    return undefined;
  }
}

function expandUserPath(input: string, homeDir: string): string {
  if (input === "~") {
    return homeDir;
  }
  if (input.startsWith("~/")) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}
