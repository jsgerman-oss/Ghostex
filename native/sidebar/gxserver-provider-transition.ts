import type { GxserverPresentationSession } from "../../shared/gxserver-protocol";
import type { TerminalSessionPersistenceProvider } from "../../shared/session-grid-contract";

type PresentationRuntime = Pick<GxserverPresentationSession, "surface" | "zmxName"> | undefined;

export function hasGxserverPresentationZmxRuntime(presentation: PresentationRuntime): boolean {
  return presentation?.surface === "workspace" && presentation.zmxName.trim().length > 0;
}

export function shouldUseGxserverProviderTransition({
  localProvider,
  presentation,
}: {
  localProvider?: TerminalSessionPersistenceProvider;
  presentation: PresentationRuntime;
}): boolean {
  /*
  CDXC:SessionSleep 2026-06-06-06:46:
  Sleep actions must kill the backing zmx runtime, not only mark sidebar rows
  sleeping. gxserver presentation owns canonical project/session identity after
  hydration, so a presentation row with a zmxName is authoritative even when
  older macOS-local session records are missing sessionPersistenceProvider.
  */
  return localProvider === "zmx" || hasGxserverPresentationZmxRuntime(presentation);
}
