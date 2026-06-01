import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { previewRepositoryClone } from "../src/repository-clone/index.js";

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
  } finally {
    await rm(parentPath, { force: true, recursive: true });
  }
});
