import type { GxserverPresentationSession } from "../../shared/gxserver-protocol";

/*
CDXC:GxserverSessionTitle 2026-06-05-12:43:
Native macOS should submit gxserver-staged title commands only when the presentation row transitions from an active first-prompt title job to an applied command. This prevents restored or already-applied titles from sending an extra Enter while still using the real terminal submit path for just-staged command text.

CDXC:GxserverSessionTitle 2026-06-12-07:08:
Claude receives a bare `/rename` first-prompt command and generates the title itself. Submit staged first-prompt title commands when gxserver explicitly marks a command for native Enter, while keeping the generated-title source check for older presentation payloads.
*/
export function shouldSubmitStagedFirstPromptTitleCommand(
  wasGeneratingFirstPromptTitle: boolean,
  presentation: Pick<
    GxserverPresentationSession,
    "isGeneratingFirstPromptTitle" | "shouldSubmitStagedFirstPromptTitleCommand" | "titleSource"
  >,
): boolean {
  return (
    wasGeneratingFirstPromptTitle &&
    !presentation.isGeneratingFirstPromptTitle &&
    (presentation.shouldSubmitStagedFirstPromptTitleCommand === true ||
      presentation.titleSource === "generated")
  );
}
