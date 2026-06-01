import type { GxserverSessionSurface } from "../../protocol/index.js";

export function normalizeSessionSurface(value: unknown): GxserverSessionSurface | undefined {
  return value === "commands" || value === "workspace" ? value : undefined;
}

export function resolveSessionSurface(input: {
  launchSettings?: Record<string, unknown>;
  runtimeSettings?: Record<string, unknown>;
  surface?: unknown;
}): GxserverSessionSurface {
  return (
    normalizeSessionSurface(input.surface) ??
    normalizeSessionSurface(input.launchSettings?.surface) ??
    normalizeSessionSurface(input.runtimeSettings?.surface) ??
    "workspace"
  );
}

export function normalizeSessionLaunchSettingsWithSurface(
  launchSettings: Record<string, unknown>,
  surface: unknown,
): Record<string, unknown> {
  const normalizedSurface = normalizeSessionSurface(surface) ?? normalizeSessionSurface(launchSettings.surface);
  if (!normalizedSurface) {
    return launchSettings;
  }
  /*
  CDXC:GxserverSessionSurface 2026-05-31-21:10:
  gxserver is the shared owner for whether a terminal belongs to the workspace or Commands panel. Persist the surface in launchSettings for the current SQLite schema, and project it as a first-class field so macOS can hide command panes from its workspace sidebar while CLI/TUI/mobile clients can still list them as command-pane sessions.
  */
  return { ...launchSettings, surface: normalizedSurface };
}
