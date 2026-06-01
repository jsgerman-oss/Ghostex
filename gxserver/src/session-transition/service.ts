import type { GxserverDomainRepository } from "../domain-state.js";
import { resolveSessionTransitionFocusTarget } from "./focus-target.js";
import type {
  GxserverSessionDomainState,
  GxserverSessionTransitionParams,
  GxserverSessionTransitionResult,
} from "../../protocol/index.js";

export type ApplySessionTransitionOptions = {
  isLiveProjectSession: (session: GxserverSessionDomainState) => boolean | Promise<boolean>;
  params: GxserverSessionTransitionParams;
  repository: GxserverDomainRepository;
  transitionSession: (params: GxserverSessionTransitionParams) => Promise<Record<string, unknown> & {
    session: GxserverSessionDomainState;
  }>;
};

export async function applySessionTransition({
  isLiveProjectSession,
  params,
  repository,
  transitionSession,
}: ApplySessionTransitionOptions): Promise<GxserverSessionTransitionResult> {
  const transition = await transitionSession(params);
  const sessions = repository.listSessions(params.projectId);
  const focusTarget = await resolveSessionTransitionFocusTarget({
    isLiveProjectSession,
    params,
    sessions,
  });

  return {
    action: params.action,
    focusTarget,
    session: transition.session,
    transition,
  };
}
