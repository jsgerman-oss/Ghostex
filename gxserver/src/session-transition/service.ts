import type {
  GxserverSessionDomainState,
  GxserverSessionTransitionParams,
  GxserverSessionTransitionResult,
} from "../../protocol/index.js";

export type ApplySessionTransitionOptions = {
  params: GxserverSessionTransitionParams;
  transitionSession: (params: GxserverSessionTransitionParams) => Promise<Record<string, unknown> & {
    session: GxserverSessionDomainState;
  }>;
};

export async function applySessionTransition({
  params,
  transitionSession,
}: ApplySessionTransitionOptions): Promise<GxserverSessionTransitionResult> {
  /*
  CDXC:ProjectSidebarOwnership 2026-06-02-13:01:
  Session transition stays in gxserver only for the shared close/sleep lifecycle mutation. Native owns local focus and selected-tab decisions, so this service intentionally does not inspect client visual ordering or compute a focus target.
  */
  const transition = await transitionSession(params);

  return {
    action: params.action,
    session: transition.session,
    transition,
  };
}
