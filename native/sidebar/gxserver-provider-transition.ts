import type { GxserverPresentationSession } from "../../shared/gxserver-protocol";
import type { TerminalSessionPersistenceProvider } from "../../shared/session-grid-contract";

type PresentationRuntime = Pick<GxserverPresentationSession, "surface" | "zmxName"> | undefined;
type ProviderTransitionAction = "close" | "sleep";
type ProviderTransitionResult = {
  action: ProviderTransitionAction;
  session: {
    lifecycleState: string;
    providerState: {
      lifecycleState: string;
    };
  };
  transition?: Record<string, unknown>;
};

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

export function shouldSkipNativeSleepRequest({
  isLocalSessionSleeping,
  presentationLifecycleState,
  usesGxserverProviderTransition,
}: {
  isLocalSessionSleeping: boolean;
  presentationLifecycleState?: string;
  usesGxserverProviderTransition: boolean;
}): boolean {
  /*
   * CDXC:SessionSleep 2026-06-10-10:01:
   * A row can be stale-faded as sleeping while its zmx provider is still alive.
   * Treat provider-backed sleep requests as actionable even when local or
   * presentation state already says sleeping; only providerless rows may skip.
   */
  return (
    (isLocalSessionSleeping || presentationLifecycleState === "sleeping") &&
    !usesGxserverProviderTransition
  );
}

export function didGxserverProviderTransitionCommit(result: ProviderTransitionResult): boolean {
  /*
   * CDXC:SessionSleep 2026-06-10-10:01:
   * /api/transitionSession can return HTTP 200 with a failed zmx kill and
   * lifecycle=unknown. Native must inspect the returned provider lifecycle
   * before publishing sleeping/stopped UI state.
  */
  const expectedLifecycleState = result.action === "sleep" ? "sleeping" : "stopped";
  const killSucceeded = readTransitionKillSucceeded(result.transition);
  return (
    result.session.lifecycleState === expectedLifecycleState &&
    result.session.providerState.lifecycleState === "missing" &&
    killSucceeded !== false
  );
}

function readTransitionKillSucceeded(transition: Record<string, unknown> | undefined): boolean | undefined {
  const kill = transition?.kill;
  if (!isObjectRecord(kill)) {
    return undefined;
  }
  return typeof kill.killed === "boolean" ? kill.killed : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
