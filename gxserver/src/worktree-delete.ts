import path from "node:path";
import type {
  GxserverDeleteWorktreeProjectParams,
  GxserverDeleteWorktreeProjectResult,
  GxserverDeleteWorktreeProjectWarning,
  GxserverProjectDomainState,
  GxserverProjectId,
  GxserverTypedOperationResult,
} from "../protocol/index.js";
import { GxserverDomainStateError } from "./domain-state.js";
import { isGxserverProjectId } from "./ids.js";
import { normalizeExistingDirectoryPath } from "./project-paths.js";
import {
  GxserverTypedOperationError,
  runGitAction,
  runWorktreeAction,
  type GxserverTypedOperationContext,
} from "./typed-operations.js";

export interface GxserverWorktreeDeleteRepository {
  getProject(projectId: GxserverProjectId): GxserverProjectDomainState | undefined;
  listProjects(): GxserverProjectDomainState[];
  removeProject(projectId: GxserverProjectId): GxserverProjectDomainState;
}

type NormalizedWorktreeMetadata = {
  branch?: string;
  parentProjectId: GxserverProjectId;
  parentProjectPath?: string;
};

type DeleteWorktreeContext = Pick<GxserverTypedOperationContext, "abortSignal" | "envPath">;

export async function deleteGxserverWorktreeProject(input: {
  context?: DeleteWorktreeContext;
  params: GxserverDeleteWorktreeProjectParams | Record<string, unknown>;
  repository: GxserverWorktreeDeleteRepository;
}): Promise<GxserverDeleteWorktreeProjectResult> {
  const params = normalizeDeleteWorktreeProjectParams(input.params);
  const projects = input.repository.listProjects();
  const worktreeProject = input.repository.getProject(params.projectId);
  if (!worktreeProject) {
    throw new GxserverDomainStateError("notFound", `Project ${params.projectId} does not exist.`);
  }
  if (!worktreeProject.path) {
    throw new GxserverDomainStateError("badRequest", "Worktree project has no filesystem path.");
  }
  const worktree = normalizeWorktreeMetadata(worktreeProject.worktree);
  if (!worktree) {
    throw new GxserverDomainStateError("badRequest", "Project is not a worktree.");
  }
  const parentProject = resolveWorktreeParentProject(projects, worktree);
  const worktreePath = normalizeExistingDirectoryPath(worktreeProject.path, "project.path");
  const parentPath = normalizeExistingDirectoryPath(parentProject.path, "parentProject.path");
  const worktreeContext = createDeleteOperationContext(input.context, projects, worktreePath);
  const parentContext = createDeleteOperationContext(input.context, projects, parentPath);
  const branchName =
    params.deleteLocalBranch === true || params.deleteRemoteBranch === true
      ? await resolveCurrentWorktreeBranchName(worktreeContext, worktree.branch)
      : undefined;
  const checkoutRemoval = await removeWorktreeCheckout({
    parentContext,
    worktreeContext,
    worktreePath,
  });
  /*
  CDXC:WorktreeDelete 2026-06-10-22:56:
  After Git successfully removes the checkout, gxserver must remove the
  canonical Ghostex project row before optional branch cleanup. Branch cleanup
  failures are returned as warnings so clients stop showing the deleted
  worktree while still surfacing the branch-specific Git error.
  */
  const project = input.repository.removeProject(params.projectId);
  const warnings: GxserverDeleteWorktreeProjectWarning[] = [];
  warnings.push(
    ...(await deleteSelectedBranches({
      branchName,
      deleteLocalBranch: params.deleteLocalBranch,
      deleteRemoteBranch: params.deleteRemoteBranch,
      parentContext,
      remoteName: params.remoteName,
    })),
  );
  const prune = await runWorktreeAction({ action: "prune" }, parentContext);
  if (prune.exitCode !== 0) {
    warnings.push({
      kind: "pruneFailed",
      message: operationFailureMessage(prune, "git worktree prune failed."),
    });
  }
  return {
    checkoutRemoval,
    project,
    warnings,
  };
}

function normalizeDeleteWorktreeProjectParams(
  params: GxserverDeleteWorktreeProjectParams | Record<string, unknown>,
): GxserverDeleteWorktreeProjectParams {
  if (!isGxserverProjectId(params.projectId)) {
    throw new GxserverDomainStateError("badRequest", `Invalid gxserver project ID: ${String(params.projectId)}.`);
  }
  const remoteName = typeof params.remoteName === "string" && params.remoteName.trim()
    ? params.remoteName.trim()
    : "origin";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remoteName)) {
    throw new GxserverDomainStateError("badRequest", "remoteName is not an allowed Git remote name.");
  }
  /*
  CDXC:WorktreeDelete 2026-06-10-22:56:
  Worktree checkout deletion is a gxserver-owned shared project mutation. The
  request carries only user-selected cleanup booleans; gxserver resolves branch,
  checkout, parent, prune, and canonical project removal state for every client.
  */
  return {
    deleteLocalBranch: params.deleteLocalBranch === true,
    deleteRemoteBranch: params.deleteRemoteBranch === true,
    projectId: params.projectId,
    remoteName,
  };
}

function normalizeWorktreeMetadata(candidate: unknown): NormalizedWorktreeMetadata | undefined {
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const worktree = candidate as Partial<{
    branch: unknown;
    parentProjectId: unknown;
    parentProjectPath: unknown;
  }>;
  if (!isGxserverProjectId(worktree.parentProjectId)) {
    return undefined;
  }
  return {
    branch: typeof worktree.branch === "string" ? normalizeBranchName(worktree.branch) : undefined,
    parentProjectId: worktree.parentProjectId,
    parentProjectPath: typeof worktree.parentProjectPath === "string"
      ? worktree.parentProjectPath.trim()
      : undefined,
  };
}

function resolveWorktreeParentProject(
  projects: readonly GxserverProjectDomainState[],
  worktree: NormalizedWorktreeMetadata,
): GxserverProjectDomainState {
  const parentProject = projects.find((project) => project.projectId === worktree.parentProjectId);
  if (!parentProject?.path) {
    throw new GxserverDomainStateError("notFound", `Parent project ${worktree.parentProjectId} does not exist.`);
  }
  if (worktree.parentProjectPath) {
    const expectedParentPath = path.resolve(worktree.parentProjectPath);
    const actualParentPath = path.resolve(parentProject.path);
    if (expectedParentPath !== actualParentPath) {
      throw new GxserverDomainStateError("badRequest", "Worktree parent project path does not match the registered parent project.");
    }
  }
  return parentProject;
}

function createDeleteOperationContext(
  context: DeleteWorktreeContext | undefined,
  projects: readonly GxserverProjectDomainState[],
  cwd: string,
): GxserverTypedOperationContext {
  return {
    abortSignal: context?.abortSignal,
    cwd,
    envPath: context?.envPath,
    projects,
  };
}

async function resolveCurrentWorktreeBranchName(
  context: GxserverTypedOperationContext,
  fallbackBranch: string | undefined,
): Promise<string | undefined> {
  const branch = await runGitAction({ action: "branch" }, context);
  return normalizeBranchName(branch.exitCode === 0 ? branch.stdout : undefined) ??
    normalizeBranchName(fallbackBranch);
}

async function removeWorktreeCheckout(input: {
  parentContext: GxserverTypedOperationContext;
  worktreeContext: GxserverTypedOperationContext;
  worktreePath: string;
}): Promise<{ forced: boolean; retriedForSubmodules: boolean }> {
  /*
  CDXC:WorktreeDelete 2026-06-10-22:56:
  Git refuses plain `git worktree remove <path>` for clean checkouts that
  contain initialized submodules. gxserver rechecks porcelain status, preserves
  dirty-worktree force removal, and retries clean removals with `--force` only
  for Git's initialized-submodule refusal so Git updates worktree metadata.
  */
  const status = await runGitAction({ action: "statusPorcelain" }, input.worktreeContext);
  if (status.exitCode !== 0) {
    throw new GxserverTypedOperationError(
      "badRequest",
      operationFailureMessage(status, "Could not read worktree status."),
    );
  }
  const forceInitialRemove = hasPorcelainStatusChanges(status.stdout);
  let remove = await runWorktreeAction(
    { action: "remove", force: forceInitialRemove, worktreePath: input.worktreePath },
    input.parentContext,
  );
  let retriedForSubmodules = false;
  if (remove.exitCode !== 0 && !forceInitialRemove && isSubmoduleRemovalRefusal(remove)) {
    retriedForSubmodules = true;
    remove = await runWorktreeAction(
      { action: "remove", force: true, worktreePath: input.worktreePath },
      input.parentContext,
    );
  }
  if (remove.exitCode !== 0) {
    throw new GxserverTypedOperationError(
      "badRequest",
      operationFailureMessage(remove, "git worktree remove failed."),
    );
  }
  return {
    forced: forceInitialRemove || retriedForSubmodules,
    retriedForSubmodules,
  };
}

async function deleteSelectedBranches(input: {
  branchName: string | undefined;
  deleteLocalBranch: boolean | undefined;
  deleteRemoteBranch: boolean | undefined;
  parentContext: GxserverTypedOperationContext;
  remoteName: string | undefined;
}): Promise<GxserverDeleteWorktreeProjectWarning[]> {
  const warnings: GxserverDeleteWorktreeProjectWarning[] = [];
  if (input.deleteLocalBranch === true) {
    if (!input.branchName) {
      warnings.push({
        kind: "localBranchNotResolved",
        message: "No local branch could be resolved.",
      });
    } else {
      const localDelete = await runGitAction(
        { action: "deleteLocalBranch", branch: input.branchName },
        input.parentContext,
      );
      if (localDelete.exitCode !== 0) {
        warnings.push({
          kind: "localBranchDeleteFailed",
          message: operationFailureMessage(localDelete, "git branch -d failed."),
        });
      }
    }
  }
  if (input.deleteRemoteBranch === true) {
    if (!input.branchName) {
      warnings.push({
        kind: "remoteBranchNotResolved",
        message: "No branch name could be resolved.",
      });
    } else {
      const remoteDelete = await runGitAction(
        {
          action: "deleteRemoteBranch",
          branch: input.branchName,
          remoteName: input.remoteName ?? "origin",
        },
        input.parentContext,
      );
      if (remoteDelete.exitCode !== 0) {
        warnings.push({
          kind: "remoteBranchDeleteFailed",
          message: operationFailureMessage(remoteDelete, "git push origin --delete failed."),
        });
      }
    }
  }
  return warnings;
}

function normalizeBranchName(branch: string | undefined): string | undefined {
  const value = branch?.trim();
  if (!value || value === "HEAD" || value === "detached") {
    return undefined;
  }
  return value;
}

function hasPorcelainStatusChanges(stdout: string): boolean {
  return stdout
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("##");
    });
}

function isSubmoduleRemovalRefusal(result: GxserverTypedOperationResult): boolean {
  return /working trees containing submodules cannot be moved or removed/iu.test(
    `${result.stderr}\n${result.stdout}`,
  );
}

function operationFailureMessage(result: GxserverTypedOperationResult, fallback: string): string {
  return result.error?.message || result.stderr.trim() || result.stdout.trim() || fallback;
}
