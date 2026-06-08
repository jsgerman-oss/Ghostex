import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import type { GxserverProjectDomainState } from "../protocol/index.js";

export type GxserverGitWorktreeEntry = {
  bare: boolean;
  branch?: string;
  detached: boolean;
  path: string;
};

export type GxserverRegisteredWorktreeMetadata = {
  branch: string;
  createdAt: string;
  name: string;
  parentProjectId: string;
  parentProjectName: string;
  parentProjectPath: string;
};

/*
CDXC:WorktreeProjectRegistration 2026-06-01-20:59:
Adding a project path must detect when that folder is a linked Git worktree of an already registered main project. Store the parent relationship in gxserver project metadata so macOS, CLI, TUI, and future clients group the worktree under the canonical P-id instead of rebuilding sidebar-local project ids from filesystem paths.
*/
export function detectRegisteredGitWorktreeMetadata(
  projects: readonly GxserverProjectDomainState[],
  projectPath: string,
  projectName: string,
  createdAt = new Date().toISOString(),
): GxserverRegisteredWorktreeMetadata | undefined {
  const insideWorkTree = runGit(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree !== "true") {
    return undefined;
  }

  const worktreeRoot = normalizePathForComparison(
    runGit(projectPath, ["rev-parse", "--show-toplevel"]),
  );
  if (!worktreeRoot) {
    return undefined;
  }

  const entries = parseGitWorktreeListPorcelain(
    runGit(projectPath, ["worktree", "list", "--porcelain"]),
  );
  const currentEntry = entries.find(
    (entry) => normalizePathForComparison(entry.path) === worktreeRoot,
  );
  const mainEntry = entries.find((entry) => !entry.bare);
  if (!currentEntry || !mainEntry) {
    return undefined;
  }

  const mainPath = normalizePathForComparison(mainEntry.path);
  if (!mainPath || worktreeRoot === mainPath) {
    return undefined;
  }

  const parentProject = projects.find((project) => {
    if (!project.path || project.worktree) {
      return false;
    }
    return normalizePathForComparison(project.path) === mainPath;
  });
  if (!parentProject?.path) {
    return undefined;
  }

  const worktreeName = path.basename(worktreeRoot) || projectName;
  return {
    branch: normalizeGitWorktreeBranch(currentEntry.branch),
    createdAt,
    name: worktreeName || projectName,
    parentProjectId: parentProject.projectId,
    parentProjectName: parentProject.name,
    parentProjectPath: parentProject.path,
  };
}

export function parseGitWorktreeListPorcelain(stdout: string): GxserverGitWorktreeEntry[] {
  const entries: GxserverGitWorktreeEntry[] = [];
  let currentEntry: GxserverGitWorktreeEntry | undefined;

  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (currentEntry) {
        entries.push(currentEntry);
      }
      currentEntry = {
        bare: false,
        detached: false,
        path: line.slice("worktree ".length).trim(),
      };
      continue;
    }

    if (!currentEntry) {
      continue;
    }
    if (line === "bare") {
      currentEntry.bare = true;
    } else if (line === "detached") {
      currentEntry.detached = true;
    } else if (line.startsWith("branch ")) {
      currentEntry.branch = line.slice("branch ".length).trim();
    }
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }
  return entries.filter((entry) => entry.path.length > 0);
}

export function normalizeGitWorktreeBranch(branch: string | undefined): string {
  const normalizedBranch = branch?.replace(/^refs\/heads\//u, "").trim();
  return normalizedBranch || "detached";
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function normalizePathForComparison(input: string): string {
  const trimmed = input.trim();
  const withoutTrailingSlash = trimmed.replace(/\/+$/u, "") || trimmed;
  try {
    return realpathSync.native(withoutTrailingSlash);
  } catch {
    return withoutTrailingSlash;
  }
}
