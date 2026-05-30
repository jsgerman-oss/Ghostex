import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildBeadsCommand,
  buildGitCommand,
  buildWorktreeCommand,
  GxserverTypedOperationError,
  runBeadsAction,
} from "../src/typed-operations.js";
import { normalizeExistingDirectoryPath } from "../src/project-paths.js";
import type { GxserverProjectDomainState } from "../protocol/index.js";

test("Git command construction is allowlisted and keeps file paths project-relative", () => {
  const status = buildGitCommand({ action: "status", projectPath: "/repo" }, "/repo");
  assert.deepEqual(status, { args: ["status", "--short", "--branch"], cwd: "/repo", executable: "git" });

  const diff = buildGitCommand({ action: "diff", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diff.args, ["diff", "--", "src/index.ts"]);

  assert.throws(
    () => buildGitCommand({ action: "diff", filePath: "../secret", projectPath: "/repo" }, "/repo"),
    /filePath must be a relative path/,
  );
  assert.throws(() => buildGitCommand({ action: "commit" as never, projectPath: "/repo" }, "/repo"), /Unsupported Git action/);
});

test("worktree command construction validates refs and constrains destructive paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-worktree-ops-"));
  try {
    const repo = path.join(root, "repo");
    const existingWorktree = path.join(root, "feature-a");
    await mkdir(repo);
    await mkdir(existingWorktree);
    const context = { cwd: repo, projects: [project("P3a91", repo)] };

    const create = buildWorktreeCommand(
      { action: "create", baseRef: "main", branch: "feature/a", projectPath: repo, worktreePath: path.join(root, "feature-b") },
      context,
    );
    assert.deepEqual(create.args, ["worktree", "add", path.join(root, "feature-b"), "-b", "feature/a", "main"]);

    const remove = buildWorktreeCommand({ action: "remove", projectPath: repo, worktreePath: existingWorktree }, context);
    assert.deepEqual(remove.args, ["worktree", "remove", "--", existingWorktree]);

    assert.throws(
      () => buildWorktreeCommand({ action: "remove", projectPath: repo, worktreePath: repo }, context),
      /cannot be the source project/,
    );
    assert.throws(
      () => buildWorktreeCommand({ action: "switch", branch: "../bad", projectPath: repo }, context),
      /not an allowed Git ref/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Beads command construction uses PATH bd only and preserves current board allowlist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-ops-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    const bd = path.join(bin, "bd");
    await mkdir(repo);
    await makeExecutable(bd);
    const context = { cwd: repo, envPath: bin, projects: [project("P3a91", repo)] };

    const comment = await buildBeadsCommand({ action: "comment", comment: "moved to test", issueId: "gxserver-15" }, context);
    assert.deepEqual(comment, {
      args: ["comments", "add", "gxserver-15", "moved to test", "--json"],
      cwd: repo,
      executable: bd,
    });

    const update = await buildBeadsCommand({ action: "update", issueId: "gxserver-15", status: "backlog" }, context);
    assert.deepEqual(update?.args, ["update", "gxserver-15", "--status", "backlog", "--json"]);

    await assert.rejects(
      () => buildBeadsCommand({ action: "update", issueId: "gxserver-15", status: "todo" as never }, context),
      /Unsupported Beads status/,
    );
    await assert.rejects(
      () => runBeadsAction({ action: "list", projectPath: repo }, { cwd: repo, envPath: "", projects: [project("P3a91", repo)] }),
      (error: unknown) => {
        assert.equal(error instanceof GxserverTypedOperationError, true);
        assert.equal((error as GxserverTypedOperationError).code, "dependencyUnavailable");
        assert.match((error as GxserverTypedOperationError).message, /does not bundle Beads/);
        return true;
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("project path normalization expands tilde and rejects files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-paths-"));
  try {
    await mkdir(path.join(root, "repo"));
    await writeFile(path.join(root, "file.txt"), "not a directory");
    assert.equal(normalizeExistingDirectoryPath("~/repo", "path", root), path.join(root, "repo"));
    assert.throws(() => normalizeExistingDirectoryPath("~/file.txt", "path", root), /not a directory/);
    assert.throws(() => normalizeExistingDirectoryPath("relative", "path", root), /absolute path/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function project(projectId: "P3a91", projectPath: string): GxserverProjectDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-05-30T14:53:00.000Z",
    customAgentOrder: [],
    customAgents: [],
    customCommandOrder: [],
    customCommands: [],
    deletedDefaultCommandIds: [],
    gitConfig: {},
    isFavorite: false,
    isPinned: false,
    launchSettings: {},
    name: "Repo",
    notificationRules: {},
    path: projectPath,
    previousSessionHistory: [],
    projectBoardConfig: {},
    projectId,
    runtimeSettings: {},
    updatedAt: "2026-05-30T14:53:00.000Z",
  };
}

async function makeExecutable(executablePath: string): Promise<void> {
  await mkdir(path.dirname(executablePath), { recursive: true });
  await writeFile(executablePath, "#!/bin/sh\nprintf '{}'\n");
  await chmod(executablePath, 0o755);
}
