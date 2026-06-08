import { getTrustedResumeTitle as getTrustedSessionResumeTitle } from "../session-title/trust.js";

export interface GxserverAgentResumeTitleInput {
  title?: string;
  titleSource?: string;
}

/*
CDXC:AgentResume 2026-06-01-12:59:
Title-based restore is only a last-resort lookup path, so it must reuse gxserver's session-title trust rules. Placeholder/default UI titles such as `Cursor CLI Session`, `Terminal Session`, or attention-prefixed `∗ Cursor CLI Session` must never be sent to agent lookup commands.
*/
export function getTrustedAgentResumeTitle(input: GxserverAgentResumeTitleInput): string | undefined {
  return getTrustedSessionResumeTitle({
    runtimeSettings: input.titleSource ? { titleSource: input.titleSource } : {},
    title: input.title ?? "",
  }).title;
}
