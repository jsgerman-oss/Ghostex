import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  GxserverBeadsAction,
  GxserverBeadsBoardResult,
  GxserverGitAction,
  GxserverProjectDomainState,
  GxserverRunBeadsActionParams,
  GxserverRunGitActionParams,
  GxserverRunWorktreeActionParams,
  GxserverTypedCommand,
  GxserverTypedOperationResult,
  GxserverWorktreeAction,
} from "../protocol/index.js";
import { getBdToolStatus } from "./toolchain.js";

export class GxserverTypedOperationError extends Error {
  readonly code: "badRequest" | "dependencyUnavailable" | "forbidden" | "notFound";
  readonly details?: Record<string, unknown>;

  constructor(
    code: "badRequest" | "dependencyUnavailable" | "forbidden" | "notFound",
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "GxserverTypedOperationError";
  }
}

export interface GxserverTypedOperationContext {
  cwd: string;
  envPath?: string;
  projects: readonly GxserverProjectDomainState[];
}

/*
CDXC:GxserverTypedOperations 2026-05-30-14:53:
gxserver exposes Git, worktree, and Beads through typed allowlisted operations only. Remote clients may request these workflows, but they cannot provide arbitrary executables or arguments; gxserver constructs each command after validating project scope, paths, refs, statuses, and destructive worktree targets.
*/
export function buildGitCommand(params: GxserverRunGitActionParams, cwd: string): GxserverTypedCommand {
  const action = normalizeGitAction(params.action);
  switch (action) {
    case "branch":
      return { args: ["branch", "--show-current"], cwd, executable: "git" };
    case "diff":
      return { args: ["diff", "--", ...optionalRelativeFilePath(params.filePath)], cwd, executable: "git" };
    case "list":
      return {
        args: ["ls-files", "--cached", "--modified", "--others", "--exclude-standard"],
        cwd,
        executable: "git",
      };
    case "status":
      return { args: ["status", "--short", "--branch"], cwd, executable: "git" };
  }
}

export function buildWorktreeCommand(params: GxserverRunWorktreeActionParams, context: GxserverTypedOperationContext): GxserverTypedCommand {
  const action = normalizeWorktreeAction(params.action);
  switch (action) {
    case "create": {
      const worktreePath = normalizeWorktreeTargetPath(params.worktreePath, context);
      const branch = normalizeOptionalGitRef(params.branch, "branch");
      const baseRef = normalizeOptionalGitRef(params.baseRef, "baseRef");
      return {
        args: ["worktree", "add", worktreePath, ...(branch ? ["-b", branch] : []), ...(baseRef ? [baseRef] : [])],
        cwd: context.cwd,
        executable: "git",
      };
    }
    case "list":
      return { args: ["worktree", "list", "--porcelain"], cwd: context.cwd, executable: "git" };
    case "remove": {
      const worktreePath = normalizeExistingWorktreePath(params.worktreePath, context);
      return {
        args: ["worktree", "remove", ...(params.force === true ? ["--force"] : []), "--", worktreePath],
        cwd: context.cwd,
        executable: "git",
      };
    }
    case "switch": {
      const branch = normalizeGitRef(params.branch, "branch");
      return { args: ["switch", branch], cwd: context.cwd, executable: "git" };
    }
  }
}

export async function buildBeadsCommand(
  params: GxserverRunBeadsActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedCommand | undefined> {
  const bd = await requireBd(context.envPath);
  const action = normalizeBeadsAction(params.action);
  switch (action) {
    case "board":
      return undefined;
    case "close":
      return { args: ["close", normalizeIssueId(params.issueId), "--json"], cwd: context.cwd, executable: bd };
    case "comment":
      return {
        args: ["comments", "add", normalizeIssueId(params.issueId), normalizeRequiredText(params.comment, "comment"), "--json"],
        cwd: context.cwd,
        executable: bd,
      };
    case "list":
      return { args: ["list", "--all", "--json"], cwd: context.cwd, executable: bd };
    case "show":
      return { args: ["show", normalizeIssueId(params.issueId), "--json"], cwd: context.cwd, executable: bd };
    case "update":
      return { args: ["update", normalizeIssueId(params.issueId), ...buildBeadsUpdateArgs(params), "--json"], cwd: context.cwd, executable: bd };
  }
}

export async function runGitAction(
  params: GxserverRunGitActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedOperationResult> {
  const command = buildGitCommand(params, context.cwd);
  return { action: normalizeGitAction(params.action), command, ...(await runTypedCommand(command)) };
}

export async function runWorktreeAction(
  params: GxserverRunWorktreeActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedOperationResult> {
  const command = buildWorktreeCommand(params, context);
  return { action: normalizeWorktreeAction(params.action), command, ...(await runTypedCommand(command)) };
}

export async function runBeadsAction(
  params: GxserverRunBeadsActionParams,
  context: GxserverTypedOperationContext,
): Promise<GxserverTypedOperationResult | GxserverBeadsBoardResult> {
  const action = normalizeBeadsAction(params.action);
  const command = await buildBeadsCommand(params, context);
  if (action === "board") {
    const issues = await readBeadsIssuesJsonl(context.cwd);
    return {
      action,
      exitCode: 0,
      issues,
      stderr: "",
      stdout: JSON.stringify(issues),
    };
  }
  if (!command) {
    throw new GxserverTypedOperationError("badRequest", `No command was constructed for Beads action ${action}.`);
  }
  return { action, command, ...(await runTypedCommand(command, { BD_JSON_ENVELOPE: "1" })) };
}

async function runTypedCommand(
  command: GxserverTypedCommand,
  env: Record<string, string> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
      });
    });
  });
}

async function requireBd(envPath?: string): Promise<string> {
  const status = await getBdToolStatus({ envPath: envPath ?? process.env.PATH ?? "" });
  if (status.availability === "available" && status.executablePath) {
    return status.executablePath;
  }
  throw new GxserverTypedOperationError("dependencyUnavailable", status.message, {
    guidance: status.guidance,
    tool: status.tool,
  });
}

async function readBeadsIssuesJsonl(cwd: string): Promise<readonly Record<string, unknown>[]> {
  try {
    const contents = await readFile(path.join(cwd, ".beads", "issues.jsonl"), "utf8");
    const issues: Record<string, unknown>[] = [];
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (isRecord(parsed)) {
          issues.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return issues;
  } catch {
    return [];
  }
}

function buildBeadsUpdateArgs(params: GxserverRunBeadsActionParams): string[] {
  const args: string[] = [];
  if (params.status !== undefined) {
    args.push("--status", normalizeBeadsStatus(params.status));
  }
  if (params.title !== undefined) {
    args.push("--title", normalizeRequiredText(params.title, "title"));
  }
  if (params.description !== undefined) {
    args.push("--description", String(params.description));
  }
  if (params.priority !== undefined) {
    args.push("--priority", normalizeRequiredText(params.priority, "priority"));
  }
  if (params.estimate !== undefined) {
    if (!Number.isInteger(params.estimate) || params.estimate < 0) {
      throw new GxserverTypedOperationError("badRequest", "estimate must be a non-negative integer.");
    }
    args.push("--estimate", String(params.estimate));
  }
  if (params.labels !== undefined) {
    for (const label of params.labels) {
      args.push("--set-labels", normalizeRequiredText(label, "label"));
    }
  }
  if (args.length === 0) {
    throw new GxserverTypedOperationError("badRequest", "Beads update requires at least one typed field.");
  }
  return args;
}

function normalizeWorktreeTargetPath(input: unknown, context: GxserverTypedOperationContext): string {
  const worktreePath = normalizeAbsolutePath(input, "worktreePath");
  const familyRoot = path.dirname(context.cwd);
  if (!isPathInside(familyRoot, worktreePath)) {
    throw new GxserverTypedOperationError("forbidden", "worktreePath must stay inside the source project worktree family directory.");
  }
  if (worktreePath === context.cwd) {
    throw new GxserverTypedOperationError("forbidden", "worktreePath cannot be the source project directory.");
  }
  return worktreePath;
}

function normalizeExistingWorktreePath(input: unknown, context: GxserverTypedOperationContext): string {
  const worktreePath = normalizeWorktreeTargetPath(input, context);
  return normalizeExistingDirectoryPath(worktreePath, "worktreePath");
}

function normalizeAbsolutePath(input: unknown, field: string): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new GxserverTypedOperationError("badRequest", `${field} must be a non-empty absolute path or ~/ path.`);
  }
  const trimmed = input.trim();
  const expanded = trimmed === "~" ? os.homedir() : trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
  if (!path.isAbsolute(expanded)) {
    throw new GxserverTypedOperationError("badRequest", `${field} must be absolute or start with ~/.`);
  }
  return path.resolve(expanded);
}

function normalizeExistingDirectoryPath(input: unknown, field: string): string {
  const directoryPath = normalizeAbsolutePath(input, field);
  try {
    if (!statSync(directoryPath).isDirectory()) {
      throw new GxserverTypedOperationError("badRequest", `${field} is not a directory.`);
    }
  } catch (error) {
    if (error instanceof GxserverTypedOperationError) {
      throw error;
    }
    throw new GxserverTypedOperationError("notFound", `${field} does not exist: ${directoryPath}`);
  }
  return directoryPath;
}

function optionalRelativeFilePath(input: unknown): string[] {
  if (input === undefined || input === null || input === "") {
    return [];
  }
  if (typeof input !== "string" || path.isAbsolute(input) || input.split(/[\\/]/).includes("..")) {
    throw new GxserverTypedOperationError("badRequest", "filePath must be a relative path inside the project.");
  }
  return [input];
}

function normalizeGitRef(input: unknown, field: string): string {
  const value = normalizeRequiredText(input, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes("..") || value.includes("//") || value.endsWith("/")) {
    throw new GxserverTypedOperationError("badRequest", `${field} is not an allowed Git ref.`);
  }
  return value;
}

function normalizeOptionalGitRef(input: unknown, field: string): string | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }
  return normalizeGitRef(input, field);
}

function normalizeIssueId(input: unknown): string {
  const issueId = normalizeRequiredText(input, "issueId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(issueId)) {
    throw new GxserverTypedOperationError("badRequest", "issueId contains unsupported characters.");
  }
  return issueId;
}

function normalizeBeadsStatus(input: unknown): string {
  const status = normalizeRequiredText(input, "status");
  if (!["backlog", "closed", "in_progress", "open", "review", "test"].includes(status)) {
    throw new GxserverTypedOperationError("badRequest", `Unsupported Beads status: ${status}`);
  }
  return status;
}

function normalizeRequiredText(input: unknown, field: string): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new GxserverTypedOperationError("badRequest", `${field} must be a non-empty string.`);
  }
  return input.trim();
}

function normalizeGitAction(action: unknown): GxserverGitAction {
  if (action === "branch" || action === "diff" || action === "list" || action === "status") {
    return action;
  }
  throw new GxserverTypedOperationError("badRequest", `Unsupported Git action: ${String(action)}`);
}

function normalizeWorktreeAction(action: unknown): GxserverWorktreeAction {
  if (action === "create" || action === "list" || action === "remove" || action === "switch") {
    return action;
  }
  throw new GxserverTypedOperationError("badRequest", `Unsupported worktree action: ${String(action)}`);
}

function normalizeBeadsAction(action: unknown): GxserverBeadsAction {
  if (action === "board" || action === "close" || action === "comment" || action === "list" || action === "show" || action === "update") {
    return action;
  }
  throw new GxserverTypedOperationError("badRequest", `Unsupported Beads action: ${String(action)}`);
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
