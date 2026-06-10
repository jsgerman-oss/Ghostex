import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildBeadsCommand,
  buildGitCommand,
  buildGitHubCommand,
  buildWorktreeCommand,
  GxserverTypedOperationError,
  runBeadsAction,
  runGitAction,
  runProjectSetupCommand,
  runWorktreeAction,
} from "../src/typed-operations.js";
import { normalizeExistingDirectoryPath, resolveProjectOperationDirectory } from "../src/project-paths.js";
import type { GxserverProjectDomainState, GxserverProjectId } from "../protocol/index.js";

test("Git command construction is allowlisted and keeps file paths project-relative", () => {
  const status = buildGitCommand({ action: "status", projectPath: "/repo" }, "/repo");
  assert.deepEqual(status, { args: ["status", "--short", "--branch"], cwd: "/repo", executable: "git" });

  const addAll = buildGitCommand({ action: "addAll", filePaths: ["src/index.ts"], projectPath: "/repo" }, "/repo");
  assert.deepEqual(addAll.args, ["add", "-A", "--", "src/index.ts"]);
  assert.deepEqual(addAll.resultCommand?.args, ["add", "-A", "--", "<1 files>"]);

  const commit = buildGitCommand(
    { action: "commit", messageBody: "Details", messageSubject: "Ship useful change", noVerify: true, projectPath: "/repo" },
    "/repo",
  );
  assert.deepEqual(commit.args, ["commit", "--no-verify", "-F", "-"]);
  assert.deepEqual(commit.resultCommand?.args, ["commit", "--no-verify", "-F", "<stdin>"]);
  assert.equal(commit.stdin, "Ship useful change\n\nDetails\n");

  assert.throws(
    () => buildGitCommand({ action: "countFileLines", filePaths: ["src/index.ts"], projectPath: "/repo" }, "/repo"),
    /handled by gxserver without spawning/,
  );

  const diff = buildGitCommand({ action: "diff", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diff.args, ["diff", "--", "src/index.ts"]);

  const diffCached = buildGitCommand({ action: "diffCached", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffCached.args, ["diff", "--cached"]);

  const diffCachedNoExt = buildGitCommand({ action: "diffCachedNoExt", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffCachedNoExt.args, ["diff", "--cached", "--no-ext-diff", "--", "src/index.ts"]);

  const diffCachedStat = buildGitCommand({ action: "diffCachedStat", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffCachedStat.args, ["diff", "--cached", "--stat"]);

  const diffNoExt = buildGitCommand({ action: "diffNoExt", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffNoExt.args, ["diff", "--no-ext-diff", "--", "src/index.ts"]);

  const diffNoIndexAgainstNull = buildGitCommand(
    { action: "diffNoIndexAgainstNull", filePath: "src/index.ts", projectPath: "/repo" },
    "/repo",
  );
  assert.deepEqual(diffNoIndexAgainstNull.args, ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", "src/index.ts"]);

  const diffNumstat = buildGitCommand({ action: "diffNumstat", projectPath: "/repo" }, "/repo");
  assert.deepEqual(diffNumstat.args, ["diff", "--numstat", "HEAD"]);

  const getOriginRemoteUrl = buildGitCommand({ action: "getOriginRemoteUrl", projectPath: "/repo" }, "/repo");
  assert.deepEqual(getOriginRemoteUrl.args, ["remote", "get-url", "origin"]);

  const isInsideWorkTree = buildGitCommand({ action: "isInsideWorkTree", projectPath: "/repo" }, "/repo");
  assert.deepEqual(isInsideWorkTree.args, ["rev-parse", "--is-inside-work-tree"]);

  const isUntrackedFile = buildGitCommand({ action: "isUntrackedFile", filePath: "src/index.ts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(isUntrackedFile.args, ["ls-files", "--others", "--exclude-standard", "--", "src/index.ts"]);

  const listRemotes = buildGitCommand({ action: "listRemotes", projectPath: "/repo" }, "/repo");
  assert.deepEqual(listRemotes.args, ["remote"]);

  const listUntracked = buildGitCommand({ action: "listUntracked", projectPath: "/repo" }, "/repo");
  assert.deepEqual(listUntracked.args, ["ls-files", "--others", "--exclude-standard", "-z"]);

  const statusPorcelain = buildGitCommand({ action: "statusPorcelain", projectPath: "/repo" }, "/repo");
  assert.deepEqual(statusPorcelain.args, ["status", "--porcelain"]);

  const upstreamCounts = buildGitCommand({ action: "upstreamCounts", projectPath: "/repo" }, "/repo");
  assert.deepEqual(upstreamCounts.args, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);

  const verifyRef = buildGitCommand({ action: "verifyRef", projectPath: "/repo", ref: "main" }, "/repo");
  assert.deepEqual(verifyRef.args, ["rev-parse", "--verify", "main"]);

  const checkout = buildGitCommand({ action: "checkout", branch: "main", projectPath: "/repo" }, "/repo");
  assert.deepEqual(checkout.args, ["checkout", "main"]);

  const checkoutNewBranch = buildGitCommand({ action: "checkoutNewBranch", branch: "feature/a", projectPath: "/repo" }, "/repo");
  assert.deepEqual(checkoutNewBranch.args, ["checkout", "-b", "feature/a"]);

  const merge = buildGitCommand({ action: "merge", branch: "feature/a", projectPath: "/repo" }, "/repo");
  assert.deepEqual(merge.args, ["merge", "feature/a"]);

  assert.throws(
    () => buildGitCommand({ action: "diff", filePath: "../secret", projectPath: "/repo" }, "/repo"),
    /filePath must be a relative path/,
  );
  assert.throws(
    () => buildGitCommand({ action: "addAll", filePaths: ["../secret"], projectPath: "/repo" }, "/repo"),
    /filePath must be a relative path/,
  );
  assert.throws(
    () => buildGitCommand({ action: "commit", messageSubject: "", projectPath: "/repo" }, "/repo"),
    /messageSubject must be a non-empty string/,
  );
  assert.throws(
    () => buildGitCommand({ action: "merge", branch: "../bad", projectPath: "/repo" }, "/repo"),
    /not an allowed Git ref/,
  );
  assert.throws(() => buildGitCommand({ action: "archive" as never, projectPath: "/repo" }, "/repo"), /Unsupported Git action/);
});

test("typed Git countFileLines streams project-relative files without command metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-git-line-count-"));
  try {
    const repo = path.join(root, "repo");
    await mkdir(path.join(repo, "src"), { recursive: true });
    await writeFile(path.join(repo, "src", "a.ts"), "one\ntwo\nthree\n");
    await writeFile(path.join(repo, "src", "b.ts"), "one\n");

    const result = await runGitAction(
      { action: "countFileLines", filePaths: ["src/a.ts", "src/b.ts"], projectPath: repo },
      { cwd: repo, projects: [project("P3a91", repo)] },
    );
    assert.equal(result.action, "countFileLines");
    assert.equal(result.command, undefined);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "4");

    await assert.rejects(
      () =>
        runGitAction(
          { action: "countFileLines", filePaths: ["../secret"], projectPath: repo },
          { cwd: repo, projects: [project("P3a91", repo)] },
        ),
      /filePath must be a relative path/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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

    const prune = buildWorktreeCommand({ action: "prune", projectPath: repo }, context);
    assert.deepEqual(prune.args, ["worktree", "prune"]);

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

test("typed worktree list returns structured entries parsed by gxserver", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-worktree-list-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    await makeExecutable(
      path.join(bin, "git"),
      [
        "#!/bin/sh",
        "if [ \"$1\" = worktree ] && [ \"$2\" = list ] && [ \"$3\" = --porcelain ]; then",
        "  printf 'worktree /tmp/repo\\nbranch refs/heads/main\\n\\nworktree /tmp/repo-feature\\nbranch refs/heads/feature/a\\n\\nworktree /tmp/repo-detached\\ndetached\\n'",
        "  exit 0",
        "fi",
        "exit 1",
      ].join("\n"),
    );

    const result = await runWorktreeAction(
      { action: "list", projectPath: repo },
      {
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    /*
    CDXC:WorktreeProjectRegistration 2026-06-02-13:01:
    Existing-worktree picker data should be structured by gxserver, not parsed by native. This protects the ownership split while leaving native with only UI filtering and selection.
    */
    assert.equal(result.action, "list");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.worktrees, [
      { bare: false, branch: "main", detached: false, path: "/tmp/repo" },
      { bare: false, branch: "feature/a", detached: false, path: "/tmp/repo-feature" },
      { bare: false, branch: "detached", detached: true, path: "/tmp/repo-detached" },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed worktree pathExists checks target availability inside gxserver", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-worktree-path-exists-"));
  try {
    const repo = path.join(root, "repo");
    const existingWorktreeTarget = path.join(root, "repo-feature");
    const missingWorktreeTarget = path.join(root, "repo-missing");
    await mkdir(repo);
    await mkdir(existingWorktreeTarget);

    /*
    CDXC:WorktreeProjectRegistration 2026-06-02-13:16:
    Worktree path availability is a gxserver-owned shared mutation precheck. It should not return shell command metadata because gxserver handles it directly without spawning `/bin/test` from native.
    */
    const existing = await runWorktreeAction(
      { action: "pathExists", projectPath: repo, worktreePath: existingWorktreeTarget },
      { cwd: repo, projects: [project("P3a91", repo)] },
    );
    assert.equal(existing.action, "pathExists");
    assert.equal(existing.command, undefined);
    assert.equal(existing.exitCode, 0);
    assert.equal(existing.stdout, "true");

    const missing = await runWorktreeAction(
      { action: "pathExists", projectPath: repo, worktreePath: missingWorktreeTarget },
      { cwd: repo, projects: [project("P3a91", repo)] },
    );
    assert.equal(missing.action, "pathExists");
    assert.equal(missing.command, undefined);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, "false");

    await assert.rejects(
      () =>
        runWorktreeAction(
          { action: "pathExists", projectPath: repo, worktreePath: path.join(root, "..", "outside") },
          { cwd: repo, projects: [project("P3a91", repo)] },
        ),
      /must stay inside the source project worktree family directory/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed project setup command runs stored worktree command with redacted metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-setup-"));
  try {
    const sourceRepo = path.join(root, "repo");
    const worktreeRepo = path.join(root, "repo-feature");
    await mkdir(sourceRepo);
    await mkdir(worktreeRepo);
    const sourceProject: GxserverProjectDomainState = {
      ...project("P3a91", sourceRepo),
      gitConfig: {
        worktreeCommand: "pwd > setup-ran.txt && printf 'setup ok'",
      },
    };
    const targetProject = project("P4b22" as GxserverProjectId, worktreeRepo);

    const result = await runProjectSetupCommand(
      {
        action: "worktreeSetupCommand",
        projectId: targetProject.projectId,
        setupCommandProjectId: sourceProject.projectId,
      },
      {
        cwd: worktreeRepo,
        projects: [sourceProject, targetProject],
      },
    );

    assert.equal(result.action, "worktreeSetupCommand");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "setup ok");
    assert.deepEqual(result.command?.args, ["-lc", "<worktree setup command>"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed project setup command no-ops when stored worktree command is empty", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-setup-empty-"));
  try {
    const repo = path.join(root, "repo");
    await mkdir(repo);
    const result = await runProjectSetupCommand(
      { action: "worktreeSetupCommand", projectPath: repo },
      {
        cwd: repo,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.action, "worktreeSetupCommand");
    assert.equal(result.command, undefined);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed project setup command rejects unregistered setup command project paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-setup-scope-"));
  try {
    const repo = path.join(root, "repo");
    const outside = path.join(root, "outside");
    await mkdir(repo);
    await mkdir(outside);

    await assert.rejects(
      () =>
        runProjectSetupCommand(
          {
            action: "worktreeSetupCommand",
            projectPath: repo,
            setupCommandProjectPath: outside,
          },
          {
            cwd: repo,
            projects: [project("P3a91", repo)],
          },
        ),
      /setupCommandProjectPath must be a registered gxserver project path/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("GitHub command construction is allowlisted", () => {
  const prView = buildGitHubCommand({ action: "prView", projectPath: "/repo" }, "/repo");
  assert.deepEqual(prView, {
    args: ["pr", "view", "--json", "number,state,title,url"],
    cwd: "/repo",
    executable: "gh",
  });

  const prCreate = buildGitHubCommand({ action: "prCreateFill", projectPath: "/repo" }, "/repo");
  assert.deepEqual(prCreate.args, ["pr", "create", "--fill"]);

  const version = buildGitHubCommand({ action: "version", projectPath: "/repo" }, "/repo");
  assert.deepEqual(version.args, ["--version"]);

  assert.throws(() => buildGitHubCommand({ action: "browse" as never, projectPath: "/repo" }, "/repo"), /Unsupported GitHub action/);
});

test("Beads command construction uses resolved bd and preserves current board allowlist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-ops-"));
  try {
    const repo = path.join(root, "repo");
    const appWebRoot = path.join(root, "app-web");
    const gxserverRoot = path.join(appWebRoot, "gxserver");
    const bd = path.join(appWebRoot, "bin", "bd");
    await mkdir(repo);
    await makeExecutable(bd);
    const context = {
      cwd: repo,
      projects: [project("P3a91", repo)],
      toolchain: { gxserverRoot, repoRoot: path.join(root, "source-root") },
    };

    const comment = await buildBeadsCommand({ action: "comment", comment: "moved to test", issueId: "gxserver-15" }, context);
    assert.deepEqual(comment, {
      args: ["comments", "add", "gxserver-15", "moved to test", "--json"],
      cwd: repo,
      executable: bd,
    });

    const status = await buildBeadsCommand({ action: "status", projectPath: repo }, context);
    assert.deepEqual(status?.args, ["status"]);

    const storageExists = await buildBeadsCommand({ action: "storageExists", projectPath: repo }, context);
    assert.equal(storageExists, undefined);

    const update = await buildBeadsCommand({ action: "update", issueId: "gxserver-15", status: "backlog" }, context);
    assert.deepEqual(update?.args, ["update", "gxserver-15", "--status", "backlog", "--json"]);

    const create = await buildBeadsCommand({
      action: "create",
      dependsOnId: "gxserver-10",
      depType: "blocks",
      description: "Fix it",
      estimate: 60,
      labels: ["ui", "mac"],
      priority: "1",
      title: "Create from board",
    }, context);
    assert.deepEqual(create?.args, [
      "create",
      "--title", "Create from board",
      "--description", "Fix it",
      "--priority", "1",
      "--type", "task",
      "--estimate", "60",
      "--labels", "ui,mac",
      "--deps", "blocks:gxserver-10",
      "--json",
    ]);

    const deleteCommand = await buildBeadsCommand({ action: "delete", issueId: "gxserver-15" }, context);
    assert.deepEqual(deleteCommand?.args, ["delete", "gxserver-15", "--force", "--json"]);

    const setLabels = await buildBeadsCommand({ action: "setLabels", issueId: "gxserver-15", labels: ["test", "review"] }, context);
    assert.deepEqual(setLabels?.args, ["update", "gxserver-15", "--set-labels", "test", "--set-labels", "review", "--json"]);

    const depAdd = await buildBeadsCommand({ action: "depAdd", dependsOnId: "gxserver-10", depType: "blocks", issueId: "gxserver-15" }, context);
    assert.deepEqual(depAdd?.args, ["dep", "add", "gxserver-15", "gxserver-10", "--type", "blocks", "--json"]);

    const labelAdd = await buildBeadsCommand({ action: "addLabel", issueId: "gxserver-15", label: "frontend" }, context);
    assert.deepEqual(labelAdd?.args, ["label", "add", "gxserver-15", "frontend", "--json"]);

    const configSet = await buildBeadsCommand({ action: "configSet", value: "backlog,test,review" }, context);
    assert.deepEqual(configSet?.args, ["config", "set", "status.custom", "backlog,test,review", "--json"]);

    await assert.rejects(
      () => buildBeadsCommand({ action: "update", issueId: "gxserver-15", status: "todo" as never }, context),
      /Unsupported Beads status/,
    );
    await assert.rejects(
      () => buildBeadsCommand({ action: "depAdd", dependsOnId: "gxserver-10", depType: "../bad", issueId: "gxserver-15" }, context),
      /depType contains unsupported characters/,
    );
    await assert.rejects(
      () =>
        runBeadsAction(
          { action: "list", projectPath: repo },
          {
            cwd: repo,
            envPath: "",
            projects: [project("P3a91", repo)],
            toolchain: {
              gxserverRoot: path.join(root, "missing-gxserver"),
              repoRoot: path.join(root, "missing-source-root"),
              resourcesPath: path.join(root, "missing-resources"),
            },
          },
        ),
      (error: unknown) => {
        assert.equal(error instanceof GxserverTypedOperationError, true);
        assert.equal((error as GxserverTypedOperationError).code, "dependencyUnavailable");
        assert.match((error as GxserverTypedOperationError).message, /Bundled bd was not found/);
        return true;
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Beads storageExists inspects project storage without requiring bd", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-storage-"));
  try {
    const repo = path.join(root, "repo");
    await mkdir(repo);
    const missing = await runBeadsAction(
      { action: "storageExists", projectPath: repo },
      { cwd: repo, envPath: "", projects: [project("P3a91", repo)] },
    );
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, "false");
    assert.equal(missing.command, undefined);

    await mkdir(path.join(repo, ".beads"));
    const exists = await runBeadsAction(
      { action: "storageExists", projectPath: repo },
      { cwd: repo, envPath: "", projects: [project("P3a91", repo)] },
    );
    assert.equal(exists.exitCode, 0);
    assert.equal(exists.stdout, "true");
    assert.equal(exists.command, undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Beads board reads preserve normal issues.jsonl output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-board-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(path.join(repo, ".beads"), { recursive: true });
    await makeExecutable(path.join(bin, "bd"));
    await writeFile(
      path.join(repo, ".beads", "issues.jsonl"),
      [
        JSON.stringify({ id: "gxserver-1", status: "open", title: "First" }),
        "",
        "not json",
        JSON.stringify({ id: "gxserver-2", status: "test", title: "Second" }),
      ].join("\n"),
    );

    const result = await runBeadsAction(
      { action: "board", projectPath: repo },
      {
        beadsBoardLimits: { fileLimitBytes: 1024, responseLimitBytes: 1024, rowLimit: 10 },
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    if (!("issues" in result)) {
      assert.fail("board action should return parsed issues");
    }
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.issues, [
      { id: "gxserver-1", status: "open", title: "First" },
      { id: "gxserver-2", status: "test", title: "Second" },
    ]);
    assert.equal(result.stdout, JSON.stringify(result.issues));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Beads board reads reject oversized board state with typed errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-beads-board-limits-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    const issuesPath = path.join(repo, ".beads", "issues.jsonl");
    await mkdir(path.join(repo, ".beads"), { recursive: true });
    await makeExecutable(path.join(bin, "bd"));
    const context = { cwd: repo, envPath: bin, projects: [project("P3a91", repo)] };

    await writeFile(issuesPath, `${JSON.stringify({ id: "gxserver-large" })}\n`);
    await assert.rejects(
      () =>
        runBeadsAction(
          { action: "board", projectPath: repo },
          { ...context, beadsBoardLimits: { fileLimitBytes: 4, responseLimitBytes: 1024, rowLimit: 10 } },
        ),
      (error: unknown) => {
        assert.equal(error instanceof GxserverTypedOperationError, true);
        assert.equal((error as GxserverTypedOperationError).code, "badRequest");
        assert.match((error as GxserverTypedOperationError).message, /file limit/);
        assert.equal((error as GxserverTypedOperationError).details?.fileLimitBytes, 4);
        return true;
      },
    );

    await writeFile(
      issuesPath,
      [
        JSON.stringify({ id: "gxserver-1" }),
        JSON.stringify({ id: "gxserver-2" }),
        JSON.stringify({ id: "gxserver-3" }),
      ].join("\n"),
    );
    await assert.rejects(
      () =>
        runBeadsAction(
          { action: "board", projectPath: repo },
          { ...context, beadsBoardLimits: { fileLimitBytes: 1024, responseLimitBytes: 1024, rowLimit: 2 } },
        ),
      (error: unknown) => {
        assert.equal(error instanceof GxserverTypedOperationError, true);
        assert.equal((error as GxserverTypedOperationError).code, "badRequest");
        assert.match((error as GxserverTypedOperationError).message, /row limit/);
        assert.equal((error as GxserverTypedOperationError).details?.rowLimit, 2);
        return true;
      },
    );

    await writeFile(issuesPath, `${JSON.stringify({ id: "gxserver-1", title: "response body is too large" })}\n`);
    await assert.rejects(
      () =>
        runBeadsAction(
          { action: "board", projectPath: repo },
          { ...context, beadsBoardLimits: { fileLimitBytes: 1024, responseLimitBytes: 16, rowLimit: 10 } },
        ),
      (error: unknown) => {
        assert.equal(error instanceof GxserverTypedOperationError, true);
        assert.equal((error as GxserverTypedOperationError).code, "badRequest");
        assert.match((error as GxserverTypedOperationError).message, /serialized JSON limit/);
        assert.equal((error as GxserverTypedOperationError).details?.responseLimitBytes, 16);
        return true;
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed Git operations time out and return structured failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-typed-timeout-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    /*
    CDXC:GxserverTypedOperations 2026-06-02-08:24:
    This timeout fixture intentionally replaces PATH with a temp bin containing only fake git. Use /bin/sleep so the test exercises typed-operation timeout handling instead of failing early because the stripped PATH cannot resolve sleep.
    */
    await makeExecutable(path.join(bin, "git"), "#!/bin/sh\n/bin/sleep 5\n");

    const startedAt = Date.now();
    const result = await runGitAction(
      { action: "status", projectPath: repo },
      {
        commandLimits: { timeoutMs: 50 },
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.error?.code, "timeout");
    assert.equal(result.error?.timeoutMs, 50);
    assert.match(result.error?.message ?? "", /timed out/);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed Git commit sends stdin while returning redacted command metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-typed-commit-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    await makeExecutable(
      path.join(bin, "git"),
      [
        "#!/bin/sh",
        "printf 'args:%s\\n' \"$*\"",
        "if [ \"$1\" = commit ]; then",
        "  stdin=$(/bin/cat)",
        "  printf 'stdin:%s\\n' \"$stdin\"",
        "fi",
      ].join("\n"),
    );

    const result = await runGitAction(
      {
        action: "commit",
        messageBody: "contains private body",
        messageSubject: "contains private subject",
        projectPath: repo,
      },
      {
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.command?.args, ["commit", "-F", "<stdin>"]);
    assert.match(result.stdout, /contains private subject/);
    assert.match(result.stdout, /contains private body/);
    assert.equal(JSON.stringify(result.command).includes("contains private"), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed Git operations fail explicitly when stdout exceeds the byte cap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-typed-output-cap-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    await makeExecutable(path.join(bin, "git"), "#!/bin/sh\nprintf abcdef\n");

    const result = await runGitAction(
      { action: "status", projectPath: repo },
      {
        commandLimits: { stdoutLimitBytes: 4, timeoutMs: 5_000 },
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.error?.code, "stdoutLimitExceeded");
    assert.equal(result.error?.stream, "stdout");
    assert.equal(result.error?.limitBytes, 4);
    assert.equal(result.error?.capturedBytes, 4);
    assert.equal(result.stdout, "abcd");
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("typed Git operations fail explicitly when stderr exceeds the byte cap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-typed-stderr-cap-"));
  try {
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    await mkdir(repo);
    await makeExecutable(path.join(bin, "git"), "#!/bin/sh\nprintf abcdef >&2\n");

    const result = await runGitAction(
      { action: "status", projectPath: repo },
      {
        commandLimits: { stderrLimitBytes: 4, timeoutMs: 5_000 },
        cwd: repo,
        envPath: bin,
        projects: [project("P3a91", repo)],
      },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.error?.code, "stderrLimitExceeded");
    assert.equal(result.error?.stream, "stderr");
    assert.equal(result.error?.limitBytes, 4);
    assert.equal(result.error?.capturedBytes, 4);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "abcd");
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

test("project path resolution ignores unrelated missing legacy chat projects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gxserver-project-path-resolution-"));
  try {
    const repo = path.join(root, "repo");
    const staleChat = path.join(root, "zmux", "chats", "2026-05-08-140732018-chat");
    await mkdir(repo);

    const result = resolveProjectOperationDirectory(
      [
        project("P4rpp" as GxserverProjectId, staleChat),
        project("P3a91" as GxserverProjectId, repo),
      ],
      { projectPath: repo },
    );

    assert.equal(result.cwd, repo);
    assert.equal(result.project.projectId, "P3a91");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function project(projectId: GxserverProjectId, projectPath: string): GxserverProjectDomainState {
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

async function makeExecutable(executablePath: string, contents = "#!/bin/sh\nprintf '{}'\n"): Promise<void> {
  await mkdir(path.dirname(executablePath), { recursive: true });
  await writeFile(executablePath, contents);
  await chmod(executablePath, 0o755);
}
