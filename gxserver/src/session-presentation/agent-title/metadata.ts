import { readFileSync } from "node:fs";
import path from "node:path";
import type { GxserverSessionDomainState } from "../../../protocol/index.js";
import { getVisibleTerminalTitle } from "../../session-title/normalization.js";
import { isRejectedResumeTitle } from "../../session-title/trust.js";
import { normalizeAgentId, normalizeText, resolveSessionIdentity } from "../identity.js";

export interface GxserverAgentMetadataTitle {
  provider: "codex-session-index";
  title: string;
  updatedAt?: string;
}

export function readAgentMetadataTitle(input: {
  homeDir: string;
  session: GxserverSessionDomainState;
}): GxserverAgentMetadataTitle | undefined {
  const identity = resolveSessionIdentity({
    agentId: input.session.agentId,
    agentName: input.session.runtimeSettings.agentName,
    agentSessionId: input.session.runtimeSettings.agentSessionId,
    agentSessionPath: input.session.runtimeSettings.agentSessionPath,
  });
  const agentId = normalizeAgentId(identity.agentId);
  if (agentId !== "codex") {
    return undefined;
  }
  const agentSessionId = normalizeText(identity.agentSessionId);
  if (!agentSessionId) {
    return undefined;
  }
  return readCodexSessionIndexTitle({
    agentSessionId,
    agentSessionPath: identity.agentSessionPath,
    homeDir: input.homeDir,
  });
}

export function readCodexSessionIndexTitle(input: {
  agentSessionId: string;
  agentSessionPath?: string;
  homeDir: string;
}): GxserverAgentMetadataTitle | undefined {
  for (const indexPath of getCodexSessionIndexCandidatePaths(input.homeDir, input.agentSessionPath)) {
    const title = readCodexSessionIndexTitleFromPath(indexPath, input.agentSessionId);
    if (title) {
      return title;
    }
  }
  return undefined;
}

function readCodexSessionIndexTitleFromPath(
  indexPath: string,
  agentSessionId: string,
): GxserverAgentMetadataTitle | undefined {
  let text = "";
  try {
    text = readFileSync(indexPath, "utf8");
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    const entry = parseJsonRecord(line);
    if (entry?.id !== agentSessionId) {
      continue;
    }
    const title = normalizeMetadataTitle(entry.thread_name ?? entry.title ?? entry.name);
    if (!title) {
      return undefined;
    }
    return {
      provider: "codex-session-index",
      title,
      ...(typeof entry.updated_at === "string" && entry.updated_at.trim() ? { updatedAt: entry.updated_at.trim() } : {}),
    };
  }
  return undefined;
}

function getCodexSessionIndexCandidatePaths(homeDir: string, agentSessionPath: string | undefined): string[] {
  const roots = new Set<string>();
  const rootFromSessionPath = getCodexRootFromSessionPath(agentSessionPath);
  if (rootFromSessionPath) {
    roots.add(rootFromSessionPath);
  }
  roots.add(path.join(homeDir, ".codex"));
  return Array.from(roots, (root) => path.join(root, "session_index.jsonl"));
}

function getCodexRootFromSessionPath(agentSessionPath: string | undefined): string | undefined {
  const normalizedPath = normalizeText(agentSessionPath)?.replace(/\\/gu, "/");
  if (!normalizedPath) {
    return undefined;
  }
  const sessionsMarkerIndex = normalizedPath.lastIndexOf("/sessions/");
  return sessionsMarkerIndex > 0 ? normalizedPath.slice(0, sessionsMarkerIndex) : undefined;
}

function normalizeMetadataTitle(value: unknown): string | undefined {
  const title = getVisibleTerminalTitle(normalizeText(value))?.trim();
  return title && !isRejectedResumeTitle(title) ? title : undefined;
}

function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/*
CDXC:GxserverAgentTitles 2026-06-01-09:03:
Agent-associated sessions should not trust a client-provided rename as the durable card title. For Codex, gxserver reads the structured session index by agentSessionId and treats that thread_name as the first source of truth; footer parsing is intentionally absent so every client receives the same canonical title without terminal-screen heuristics.
*/
