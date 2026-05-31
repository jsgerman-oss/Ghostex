import type {
  GxserverSessionDomainState,
  GxserverSessionTitleProjection,
  GxserverSessionTitleSource,
  GxserverTerminalTitleEventParams,
} from "../../protocol/index.js";

export type {
  GxserverSessionTitleProjection,
  GxserverSessionTitleSource,
  GxserverTerminalTitleEventParams,
} from "../../protocol/index.js";

export type GxserverSessionTitleDecisionReason =
  | "already-synced"
  | "captured-agent-session-id"
  | "invalid-session-kind"
  | "protected-stored-title"
  | "terminal-title-already-ellipsized"
  | "terminal-title-not-trusted"
  | "terminal-title-not-visible"
  | "valid-agent-terminal-title"
  | "zmx-terminal-title"
  | `valid-agent-terminal-title-from-${string}`
  | `zmx-terminal-title-from-${string}`;

export interface GxserverSessionTitleDecision {
  agentSessionId?: string;
  changed: boolean;
  projection: GxserverSessionTitleProjection;
  reason: GxserverSessionTitleDecisionReason;
  runtimeSettings?: Record<string, unknown>;
  session?: GxserverSessionDomainState;
  shouldUpdateSession: boolean;
  title?: string;
  titleSource?: GxserverSessionTitleSource;
  visibleTitle?: string;
}
