export function countRemovableWorkspaceDockProjects(input: {
  localProjectCount: number;
  localQuickProjectIds?: readonly string[];
  hiddenPresentationProjectIds?: ReadonlySet<string>;
  presentationProjectIds?: readonly string[];
}): number {
  /*
  CDXC:WorkspaceDock 2026-06-02-17:06:
  Presentation-backed dock removal must count gxserver project buttons, not only native pane-cache projects. Quick projects remain macOS-local dock rows, so include them with visible gxserver presentation ids when enforcing the "keep one workspace" guard.
  */
  if (!input.presentationProjectIds) {
    return input.localProjectCount;
  }
  const hiddenProjectIds = input.hiddenPresentationProjectIds ?? new Set<string>();
  const visiblePresentationProjectIds = input.presentationProjectIds.filter(
    (projectId) => !hiddenProjectIds.has(projectId),
  );
  return new Set([
    ...visiblePresentationProjectIds,
    ...(input.localQuickProjectIds ?? []),
  ]).size;
}
