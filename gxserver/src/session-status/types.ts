import type {
  GxserverAgentActivityState,
  GxserverSessionDomainState,
  GxserverUpdateAgentActivityParams,
} from "../../protocol/index.js";

export type GxserverSessionStatusAgentName =
  | "antigravity"
  | "claude"
  | "codex"
  | "copilot"
  | "cursor"
  | "gemini"
  | "opencode"
  | "pi";

export interface GxserverTitleStatusSignal {
  agentName: GxserverSessionStatusAgentName;
  state: "attention" | "idle" | "working";
}

export interface GxserverSessionStatusUpdate {
  activity: GxserverAgentActivityState;
  enteredAttention: boolean;
  lastActiveAt?: string;
  previousActivity: GxserverAgentActivityState["activity"];
  runtimeSettings: Record<string, unknown>;
}

export interface GxserverSessionStatusRepository {
  updateSession(input: {
    lastActiveAt?: string;
    projectId: GxserverSessionDomainState["projectId"];
    runtimeSettings: Record<string, unknown>;
    sessionId: GxserverSessionDomainState["sessionId"];
  }): GxserverSessionDomainState;
}

export type GxserverSessionStatusEventParams = GxserverUpdateAgentActivityParams;
