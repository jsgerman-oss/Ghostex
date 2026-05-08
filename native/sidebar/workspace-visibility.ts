/**
 * CDXC:WorkspaceDock 2026-05-08-14:08
 * Separated mode must not show chat-storage workspaces from ~/zmux/chats in
 * the workspace dock. Chats remain restorable/persisted internally; this only
 * controls whether a project is eligible for the separated workspace rail.
 */
export function shouldShowSeparatedWorkspaceDockProject(
  projectPath: string,
  chatsRootDirectory: string,
  homeDirectory: string,
): boolean {
  const normalizedProjectPath = normalizeWorkspaceVisibilityPath(projectPath, homeDirectory);
  const normalizedChatsRoot = normalizeWorkspaceVisibilityPath(chatsRootDirectory, homeDirectory);
  if (!normalizedProjectPath || !normalizedChatsRoot) {
    return true;
  }
  return (
    normalizedProjectPath !== normalizedChatsRoot &&
    !normalizedProjectPath.startsWith(`${normalizedChatsRoot}/`)
  );
}

function normalizeWorkspaceVisibilityPath(path: string, homeDirectory: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "";
  }
  const expandedPath =
    trimmedPath === "~"
      ? homeDirectory
      : trimmedPath.startsWith("~/")
        ? `${homeDirectory}${trimmedPath.slice(1)}`
        : trimmedPath;
  return expandedPath.replace(/\/+$/g, "") || "/";
}
