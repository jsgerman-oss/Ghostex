import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GxserverProjectDomainState, GxserverProjectId } from "../protocol/index.js";
import { deleteGxserverWorktreeProject, type GxserverWorktreeDeleteRepository } from "../src/worktree-delete.js";

test("deleteGxserverWorktreeProject removes a clean worktree without force", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-delete-worktree-clean-"));
  try {
    const parentPath = path.join(root, "repo");
    const worktreePath = path.join(root, "repo-feature-clean");
    await createRepository(parentPath);
    runGit(parentPath, ["branch", "feature-clean"]);
    runGit(parentPath, ["worktree", "add", worktreePath, "feature-clean"]);

    const parentProject = project("P1aaa", parentPath);
    const worktreeProject = worktreeProjectState("P2aaa", worktreePath, parentProject, "feature-clean");
    const repository = fakeRepository([parentProject, worktreeProject]);

    const result = await deleteGxserverWorktreeProject({
      params: { projectId: worktreeProject.projectId },
      repository,
    });

    assert.deepEqual(result.checkoutRemoval, { forced: false, retriedForSubmodules: false });
    assert.equal(repository.getProject(worktreeProject.projectId), undefined);
    assert.equal(pathExists(worktreePath), false);
    assert.equal(runGit(parentPath, ["worktree", "list", "--porcelain"]).includes(worktreePath), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("deleteGxserverWorktreeProject retries clean initialized-submodule worktrees with force", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-delete-worktree-submodule-"));
  try {
    const submodulePath = path.join(root, "submodule-source");
    const parentPath = path.join(root, "repo");
    const worktreePath = path.join(root, "repo-feature-submodule");
    await createRepository(submodulePath);
    await createRepository(parentPath);
    runGit(parentPath, ["-c", "protocol.file.allow=always", "submodule", "add", submodulePath, "deps/submodule"]);
    runGit(parentPath, ["commit", "-m", "add submodule"]);
    runGit(parentPath, ["branch", "feature-submodule"]);
    runGit(parentPath, ["worktree", "add", worktreePath, "feature-submodule"]);
    runGit(worktreePath, ["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive"]);

    const parentProject = project("P1aab", parentPath);
    const worktreeProject = worktreeProjectState("P2aab", worktreePath, parentProject, "feature-submodule");
    const repository = fakeRepository([parentProject, worktreeProject]);

    /*
    CDXC:WorktreeDelete 2026-06-10-22:56:
    Clean worktrees with initialized submodules are not dirty, but Git refuses a
    plain `git worktree remove <path>`. The shared gxserver deletion helper must
    retry that specific refusal with `--force` and still remove the canonical
    Ghostex project record.
    */
    const result = await deleteGxserverWorktreeProject({
      params: { projectId: worktreeProject.projectId },
      repository,
    });

    assert.deepEqual(result.checkoutRemoval, { forced: true, retriedForSubmodules: true });
    assert.equal(repository.getProject(worktreeProject.projectId), undefined);
    assert.equal(pathExists(worktreePath), false);
    assert.equal(runGit(parentPath, ["worktree", "list", "--porcelain"]).includes(worktreePath), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("deleteGxserverWorktreeProject force-removes dirty worktrees", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-delete-worktree-dirty-"));
  try {
    const parentPath = path.join(root, "repo");
    const worktreePath = path.join(root, "repo-feature-dirty");
    await createRepository(parentPath);
    runGit(parentPath, ["branch", "feature-dirty"]);
    runGit(parentPath, ["worktree", "add", worktreePath, "feature-dirty"]);
    await writeFile(path.join(worktreePath, "dirty.txt"), "not committed\n");

    const parentProject = project("P1aac", parentPath);
    const worktreeProject = worktreeProjectState("P2aac", worktreePath, parentProject, "feature-dirty");
    const repository = fakeRepository([parentProject, worktreeProject]);

    const result = await deleteGxserverWorktreeProject({
      params: { projectId: worktreeProject.projectId },
      repository,
    });

    assert.deepEqual(result.checkoutRemoval, { forced: true, retriedForSubmodules: false });
    assert.equal(repository.getProject(worktreeProject.projectId), undefined);
    assert.equal(pathExists(worktreePath), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("deleteGxserverWorktreeProject deletes a selected merged local branch after checkout removal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-delete-worktree-local-branch-"));
  try {
    const parentPath = path.join(root, "repo");
    const worktreePath = path.join(root, "repo-feature-local");
    await createRepository(parentPath);
    runGit(parentPath, ["branch", "feature-local"]);
    runGit(parentPath, ["worktree", "add", worktreePath, "feature-local"]);

    const parentProject = project("P1aad", parentPath);
    const worktreeProject = worktreeProjectState("P2aad", worktreePath, parentProject, "feature-local");
    const repository = fakeRepository([parentProject, worktreeProject]);

    const result = await deleteGxserverWorktreeProject({
      params: { deleteLocalBranch: true, projectId: worktreeProject.projectId },
      repository,
    });

    assert.deepEqual(result.warnings, []);
    assert.equal(runGitStatus(parentPath, ["rev-parse", "--verify", "feature-local"]).status, 128);
    assert.equal(repository.getProject(worktreeProject.projectId), undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("deleteGxserverWorktreeProject keeps project removed when selected remote branch deletion fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-delete-worktree-remote-missing-"));
  try {
    const remotePath = path.join(root, "origin.git");
    const parentPath = path.join(root, "repo");
    const worktreePath = path.join(root, "repo-feature-remote");
    runGit(root, ["init", "--bare", remotePath]);
    await createRepository(parentPath);
    runGit(parentPath, ["remote", "add", "origin", remotePath]);
    runGit(parentPath, ["push", "-u", "origin", "HEAD:main"]);
    runGit(parentPath, ["branch", "feature-remote"]);
    runGit(parentPath, ["worktree", "add", worktreePath, "feature-remote"]);

    const parentProject = project("P1aae", parentPath);
    const worktreeProject = worktreeProjectState("P2aae", worktreePath, parentProject, "feature-remote");
    const repository = fakeRepository([parentProject, worktreeProject]);

    const result = await deleteGxserverWorktreeProject({
      params: { deleteRemoteBranch: true, projectId: worktreeProject.projectId },
      repository,
    });

    assert.equal(repository.getProject(worktreeProject.projectId), undefined);
    assert.equal(pathExists(worktreePath), false);
    assert.equal(result.warnings.some((warning) => warning.kind === "remoteBranchDeleteFailed"), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function fakeRepository(
  initialProjects: readonly GxserverProjectDomainState[],
): GxserverWorktreeDeleteRepository {
  const projectsById = new Map<GxserverProjectId, GxserverProjectDomainState>(
    initialProjects.map((project) => [project.projectId, project]),
  );
  return {
    getProject(projectId) {
      return projectsById.get(projectId);
    },
    listProjects() {
      return [...projectsById.values()];
    },
    removeProject(projectId) {
      const project = projectsById.get(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} does not exist.`);
      }
      projectsById.delete(projectId);
      return project;
    },
  };
}

function project(projectId: GxserverProjectId, projectPath: string): GxserverProjectDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-06-10T18:56:00.000Z",
    customAgentOrder: [],
    customAgents: [],
    customCommandOrder: [],
    customCommands: [],
    deletedDefaultCommandIds: [],
    gitConfig: {},
    isFavorite: false,
    isPinned: false,
    launchSettings: {},
    name: path.basename(projectPath),
    notificationRules: {},
    path: projectPath,
    previousSessionHistory: [],
    projectBoardConfig: {},
    projectId,
    runtimeSettings: {},
    updatedAt: "2026-06-10T18:56:00.000Z",
  };
}

function worktreeProjectState(
  projectId: GxserverProjectId,
  worktreePath: string,
  parentProject: GxserverProjectDomainState,
  branch: string,
): GxserverProjectDomainState {
  return {
    ...project(projectId, worktreePath),
    worktree: {
      branch,
      name: path.basename(worktreePath),
      parentProjectId: parentProject.projectId,
      parentProjectPath: parentProject.path,
    },
  };
}

async function createRepository(repositoryPath: string): Promise<void> {
  await mkdir(repositoryPath, { recursive: true });
  runGit(repositoryPath, ["init"]);
  runGit(repositoryPath, ["config", "user.email", "ghostex-tests@example.invalid"]);
  runGit(repositoryPath, ["config", "user.name", "Ghostex Tests"]);
  await writeFile(path.join(repositoryPath, "README.md"), "initial\n");
  runGit(repositoryPath, ["add", "README.md"]);
  runGit(repositoryPath, ["commit", "-m", "initial"]);
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = runGitStatus(cwd, args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function runGitStatus(cwd: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("git", [...args], { cwd, encoding: "utf8" });
}

function pathExists(targetPath: string): boolean {
  return existsSync(targetPath);
}
