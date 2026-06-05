import type { GxserverPresentationSession } from "../../shared/gxserver-protocol";

/*
CDXC:GxserverSessionTitle 2026-06-05-12:43:
Native macOS should submit gxserver-staged generated title commands only when the presentation row transitions from an active first-prompt title job to a generated terminal title. This prevents restored or already-applied generated titles from sending an extra Enter while still using the real terminal submit path for the just-staged `/rename <title>` text.
*/
export function shouldSubmitStagedGeneratedFirstPromptTitle(
  wasGeneratingFirstPromptTitle: boolean,
  presentation: Pick<GxserverPresentationSession, "isGeneratingFirstPromptTitle" | "titleSource">,
): boolean {
  return (
    wasGeneratingFirstPromptTitle &&
    !presentation.isGeneratingFirstPromptTitle &&
    presentation.titleSource === "generated"
  );
}
