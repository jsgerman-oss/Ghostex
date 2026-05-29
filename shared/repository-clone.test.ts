import { describe, expect, test } from "vitest";
import { parseRepositoryCloneInput } from "./repository-clone";

describe("parseRepositoryCloneInput", () => {
  test.each([
    ["gh repo clone maddada/zehn", "https://github.com/maddada/zehn.git", "zehn"],
    ["maddada/zehn", "https://github.com/maddada/zehn.git", "zehn"],
    ["https://github.com/maddada/zehn.git", "https://github.com/maddada/zehn.git", "zehn"],
    ["git@github.com:maddada/zehn.git", "git@github.com:maddada/zehn.git", "zehn"],
    ["https://github.com/maddada/zehn", "https://github.com/maddada/zehn.git", "zehn"],
    ["github.com/maddada/zehn", "https://github.com/maddada/zehn.git", "zehn"],
    [
      "https://codeberg.org/JohnWalkerx/nixConfigs.git",
      "https://codeberg.org/JohnWalkerx/nixConfigs.git",
      "nixConfigs",
    ],
    [
      "codeberg.org/JohnWalkerx/nixConfigs.git",
      "https://codeberg.org/JohnWalkerx/nixConfigs.git",
      "nixConfigs",
    ],
  ])("normalizes %s", (input, cloneUrl, repositoryName) => {
    expect(parseRepositoryCloneInput(input)).toEqual({ cloneUrl, repositoryName });
  });

  test("ignores surrounding command text and browser path suffixes", () => {
    expect(parseRepositoryCloneInput("please clone https://github.com/maddada/zehn/tree/main")).toEqual({
      cloneUrl: "https://github.com/maddada/zehn.git",
      repositoryName: "zehn",
    });
  });
});
