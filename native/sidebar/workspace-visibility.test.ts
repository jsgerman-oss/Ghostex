import { describe, expect, test } from "vitest";
import { shouldShowSeparatedWorkspaceDockProject } from "./workspace-visibility";

describe("separated workspace dock visibility", () => {
  const homeDirectory = "/Users/madda";
  const chatsRootDirectory = "/Users/madda/zmux/chats";

  test("hides projects at or under the native chats root", () => {
    /**
     * CDXC:WorkspaceDock 2026-05-08-14:08
     * User-created chat directories live under ~/zmux/chats and should not
     * appear as standalone workspaces in Separated mode.
     */
    expect(
      shouldShowSeparatedWorkspaceDockProject(
        "/Users/madda/zmux/chats",
        chatsRootDirectory,
        homeDirectory,
      ),
    ).toBe(false);
    expect(
      shouldShowSeparatedWorkspaceDockProject(
        "/Users/madda/zmux/chats/2026-05-08-chat",
        chatsRootDirectory,
        homeDirectory,
      ),
    ).toBe(false);
    expect(
      shouldShowSeparatedWorkspaceDockProject(
        "~/zmux/chats/2026-05-08-chat",
        chatsRootDirectory,
        homeDirectory,
      ),
    ).toBe(false);
  });

  test("keeps similarly named non-chat workspaces visible", () => {
    expect(
      shouldShowSeparatedWorkspaceDockProject(
        "/Users/madda/zmux/chats-archive",
        chatsRootDirectory,
        homeDirectory,
      ),
    ).toBe(true);
    expect(
      shouldShowSeparatedWorkspaceDockProject(
        "/Users/madda/dev/_active/zmux",
        chatsRootDirectory,
        homeDirectory,
      ),
    ).toBe(true);
  });
});
