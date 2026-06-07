import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GxserverServerId } from "../protocol/index.js";
import type { GxserverLogger } from "../src/logger.js";
import type { GxserverPaths } from "../src/paths.js";
import { GxserverRepositoryCloneJobManager } from "../src/repository-clone/index.js";
import { buildRepositoryCloneGitArgs, previewRepositoryClone } from "../src/repository-clone/input.js";

test("repository clone preview normalizes paste input and reports existing destinations", async () => {
  const parentPath = await mkdtemp(path.join(tmpdir(), "gxserver-repository-clone-"));
  try {
    await mkdir(path.join(parentPath, "opencode"));

    const preview = await previewRepositoryClone({
      folderPath: parentPath,
      repositoryInput: "gh repo clone anomalyco/opencode",
    });

    assert.equal(preview.cloneUrl, "https://github.com/anomalyco/opencode.git");
    assert.equal(preview.defaultFolderName, "opencode");
    assert.equal(preview.destinationFolderName, "opencode");
    assert.equal(preview.destinationExists, true);
    assert.equal(preview.destinationExistsKind, "directory");
    assert.match(preview.warning ?? "", /already exists/);

    const renamed = await previewRepositoryClone({
      folderPath: parentPath,
      newFolderName: "opencode-copy",
      repositoryInput: "gh repo clone anomalyco/opencode",
    });
    assert.equal(renamed.destinationFolderName, "opencode-copy");
    assert.equal(renamed.destinationPath, path.join(parentPath, "opencode-copy"));
    assert.equal(renamed.destinationExists, false);

    const blankNamePreview = await previewRepositoryClone({
      folderPath: parentPath,
      newFolderName: "   ",
      repositoryInput: "gh repo clone anomalyco/opencode",
    });
    assert.equal(blankNamePreview.destinationFolderName, "opencode");
    assert.equal(blankNamePreview.destinationPath, path.join(parentPath, "opencode"));

    const branchPreview = await previewRepositoryClone({
      branchName: " feature/branch-picker ",
      folderPath: parentPath,
      newFolderName: "opencode-branch",
      repositoryInput: "gh repo clone anomalyco/opencode",
    });
    assert.equal(branchPreview.branchName, "feature/branch-picker");

    await assert.rejects(
      () =>
        previewRepositoryClone({
          branchName: "feature branch",
          folderPath: parentPath,
          repositoryInput: "gh repo clone anomalyco/opencode",
        }),
      /branchName must be a valid Git branch name/,
    );
  } finally {
    await rm(parentPath, { force: true, recursive: true });
  }
});

test("repository clone git args apply optional branch selection", () => {
  assert.deepEqual(
    buildRepositoryCloneGitArgs({
      branchName: "feature/branch-picker",
      cloneMainOnly: true,
      cloneUrl: "https://github.com/anomalyco/opencode.git",
      destinationFolderName: "opencode",
      shallowClone: false,
    }),
    [
      "clone",
      "--branch",
      "feature/branch-picker",
      "--single-branch",
      "https://github.com/anomalyco/opencode.git",
      "opencode",
    ],
  );
  assert.deepEqual(
    buildRepositoryCloneGitArgs({
      cloneMainOnly: true,
      cloneUrl: "https://github.com/anomalyco/opencode.git",
      destinationFolderName: "opencode",
      shallowClone: false,
    }),
    ["clone", "--single-branch", "https://github.com/anomalyco/opencode.git", "opencode"],
  );
});

test("repository clone job logs do not persist branch names, paths, urls, or raw git args", async () => {
  const parentPath = await mkdtemp(path.join(tmpdir(), "gxserver-repository-clone-"));
  const logs: Array<{ details?: Record<string, unknown>; event: string }> = [];
  try {
    const manager = new GxserverRepositoryCloneJobManager({
      runGitClone: async (request) => {
        assert.deepEqual(request.args, [
          "clone",
          "--branch",
          "feature/private-branch",
          "--single-branch",
          "https://github.com/private-owner/private-repo.git",
          "private-destination",
        ]);
        return {
          exitCode: 128,
          stderr: `fatal: could not read ${parentPath}/private-destination for feature/private-branch`,
          stdout: "",
        };
      },
    });
    const logger: GxserverLogger = {
      async log(entry) {
        logs.push({ details: entry.details, event: entry.event });
      },
    };
    const job = await manager.start(
      {
        logger,
        paths: {} as GxserverPaths,
        serverId: "GXS_test" as GxserverServerId,
      },
      {
        branchName: "feature/private-branch",
        cloneMainOnly: true,
        folderPath: parentPath,
        newFolderName: "private-destination",
        repositoryInput: "private-owner/private-repo",
      },
    );

    for (let attempt = 0; attempt < 20 && manager.read(job.jobId).state === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(manager.read(job.jobId).state, "failed");
    assert.deepEqual(logs.find((entry) => entry.event === "repositoryClone.started")?.details, {
      branchSpecified: true,
      cloneMainOnly: true,
      jobId: job.jobId,
      shallowClone: false,
    });
    const serializedLogs = JSON.stringify(logs);
    assert.doesNotMatch(serializedLogs, /feature\/private-branch/);
    assert.doesNotMatch(serializedLogs, /private-owner/);
    assert.doesNotMatch(serializedLogs, /private-repo/);
    assert.doesNotMatch(serializedLogs, /private-destination/);
    assert.doesNotMatch(serializedLogs, /https:\/\/github\.com/);
    assert.doesNotMatch(serializedLogs, new RegExp(parentPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(serializedLogs, /"args"/);
  } finally {
    await rm(parentPath, { force: true, recursive: true });
  }
});
