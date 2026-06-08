/*
 * CDXC:PromptAgents 2026-05-31-07:35:
 * Cursor Agent collapses large clipboard pastes into a "[Pasted text #1 +N lines]" chip when a single injection exceeds roughly twenty lines.
 * Kanban Create & Start and Start Work stage bead prompts through Ghostty `writeTerminalText`, so native prompt automation must split prompts into at most fifteen lines per write and preserve original newlines between chunks.
 */

export const AGENT_PROMPT_MAX_LINES_PER_CHUNK = 15;

/**
 * Splits prompt text into chunks of at most `maxLinesPerChunk` lines so agent TUIs
 * treat staged input as typed text instead of one large paste.
 */
export function splitAgentPromptTextIntoLineChunks(
  text: string,
  maxLinesPerChunk = AGENT_PROMPT_MAX_LINES_PER_CHUNK,
): string[] {
  if (!text) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length <= maxLinesPerChunk) {
    return [normalized];
  }
  const chunks: string[] = [];
  for (let index = 0; index < lines.length; index += maxLinesPerChunk) {
    chunks.push(lines.slice(index, index + maxLinesPerChunk).join("\n"));
  }
  return chunks;
}
