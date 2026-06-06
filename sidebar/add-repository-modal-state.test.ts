import { describe, expect, test } from "vitest";
import { canSubmitAddRepositoryClone } from "./add-repository-modal-state";

describe("canSubmitAddRepositoryClone", () => {
  test("enables when typed clone fields are valid before preview returns", () => {
    expect(
      canSubmitAddRepositoryClone({
        folderPath: "/Users/madda/dev/_references",
        isCloning: false,
        newFolderName: "macbox",
        repositoryInput: "robzilla1738/macbox",
      }),
    ).toBe(true);
  });

  test("keeps existing-destination preview warnings blocking submit", () => {
    expect(
      canSubmitAddRepositoryClone({
        clonePreview: { destinationExists: true },
        folderPath: "/Users/madda/dev/_references",
        isCloning: false,
        newFolderName: "macbox",
        repositoryInput: "robzilla1738/macbox",
      }),
    ).toBe(false);
  });

  test("rejects incomplete or unparsable clone fields", () => {
    expect(
      canSubmitAddRepositoryClone({
        folderPath: "/Users/madda/dev/_references",
        isCloning: false,
        newFolderName: "macbox",
        repositoryInput: "macbox",
      }),
    ).toBe(false);
    expect(
      canSubmitAddRepositoryClone({
        folderPath: "",
        isCloning: false,
        newFolderName: "macbox",
        repositoryInput: "robzilla1738/macbox",
      }),
    ).toBe(false);
  });
});
