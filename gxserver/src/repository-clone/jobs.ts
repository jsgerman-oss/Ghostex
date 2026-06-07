import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type {
  GxserverProjectDomainState,
  GxserverRepositoryCloneJobStatus,
  GxserverRepositoryClonePreviewResult,
  GxserverServerId,
} from "../../protocol/index.js";
import { GxserverDomainRepository } from "../domain-state.js";
import type { GxserverLogger } from "../logger.js";
import type { GxserverPaths } from "../paths.js";
import { normalizeExistingDirectoryPath } from "../project-paths.js";
import { openGxserverDatabase } from "../storage.js";
import { buildRepositoryCloneGitArgs, previewRepositoryClone } from "./input.js";
import { GxserverRepositoryCloneError } from "./errors.js";

export const GXSERVER_REPOSITORY_CLONE_TIMEOUT_MS = 30 * 60_000;
export const GXSERVER_REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const GXSERVER_REPOSITORY_CLONE_COLOR_DISABLING_ENVIRONMENT_KEYS = [
  "ANSI_COLORS_DISABLED",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
] as const;

export interface GxserverRepositoryCloneJobManagerOptions {
  runGitClone?: GxserverRepositoryCloneRunner;
}

export type GxserverRepositoryCloneRunner = (
  request: {
    args: readonly string[];
    cwd: string;
  },
  options: {
    signal: AbortSignal;
  },
) => Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

export interface GxserverRepositoryCloneRuntime {
  logger: GxserverLogger;
  paths: GxserverPaths;
  serverId: GxserverServerId;
}

type MutableRepositoryCloneJob = GxserverRepositoryCloneJobStatus & {
  abortController: AbortController;
};

/*
CDXC:RepositoryClone 2026-06-01-11:18:
Clone jobs are gxserver-owned background work because every Ghostex client must observe the same lifecycle: preview destination, reject existing folders before Git starts, allow cancellation through a job id, and add the successful clone as a canonical gxserver project. UI clients only poll and render progress.
*/
export class GxserverRepositoryCloneJobManager {
  readonly #jobs = new Map<string, MutableRepositoryCloneJob>();
  readonly #runGitClone: GxserverRepositoryCloneRunner;

  constructor(options: GxserverRepositoryCloneJobManagerOptions = {}) {
    this.#runGitClone = options.runGitClone ?? runGitCloneProcess;
  }

  async preview(params: Record<string, unknown>): Promise<GxserverRepositoryClonePreviewResult> {
    return previewRepositoryClone(params);
  }

  async start(
    runtime: GxserverRepositoryCloneRuntime,
    params: Record<string, unknown>,
  ): Promise<GxserverRepositoryCloneJobStatus> {
    const preview = await previewRepositoryClone(params);
    if (preview.destinationExists) {
      throw new GxserverRepositoryCloneError(
        "badRequest",
        preview.warning ?? `Destination already exists: ${preview.destinationPath}`,
      );
    }

    const job: MutableRepositoryCloneJob = {
      abortController: new AbortController(),
      jobId: randomUUID(),
      message: "Cloning repository.",
      preview,
      startedAt: new Date().toISOString(),
      state: "running",
    };
    this.#jobs.set(job.jobId, job);
    void this.#run(runtime, job);
    return serializeJob(job);
  }

  read(jobId: unknown): GxserverRepositoryCloneJobStatus {
    const job = this.#requireJob(jobId);
    return serializeJob(job);
  }

  cancel(jobId: unknown): GxserverRepositoryCloneJobStatus {
    const job = this.#requireJob(jobId);
    if (job.state === "running") {
      job.message = "Repository clone canceled.";
      job.state = "canceled";
      job.completedAt = new Date().toISOString();
      job.abortController.abort();
    }
    return serializeJob(job);
  }

  async #run(runtime: GxserverRepositoryCloneRuntime, job: MutableRepositoryCloneJob): Promise<void> {
    const args = buildRepositoryCloneGitArgs({
      branchName: job.preview.branchName,
      cloneMainOnly: job.preview.cloneMainOnly,
      cloneUrl: job.preview.cloneUrl,
      destinationFolderName: job.preview.destinationFolderName,
      shallowClone: job.preview.shallowClone,
    });
    await runtime.logger.log({
      details: {
        /*
        CDXC:RepositoryClone 2026-06-07-16:06:
        Clone job logs must stay support-bundle safe. Do not persist clone URLs,
        branch names, destination names, paths, stdout/stderr, or raw argv; keep
        only booleans and stable ids that explain the selected clone mode.
        */
        branchSpecified: Boolean(job.preview.branchName),
        cloneMainOnly: job.preview.cloneMainOnly,
        jobId: job.jobId,
        shallowClone: job.preview.shallowClone,
      },
      event: "repositoryClone.started",
      level: "info",
    });

    try {
      const result = await this.#runGitClone(
        {
          args,
          cwd: job.preview.parentPath,
        },
        {
          signal: job.abortController.signal,
        },
      );
      job.exitCode = result.exitCode;
      job.stderr = result.stderr;
      job.stdout = result.stdout;
      if (job.state === "canceled" || job.abortController.signal.aborted) {
        job.message = "Repository clone canceled.";
        job.state = "canceled";
        job.completedAt ??= new Date().toISOString();
        return;
      }
      if (result.exitCode !== 0) {
        throw new GxserverRepositoryCloneError(
          "dependencyUnavailable",
          result.stderr || result.stdout || `git clone exited ${result.exitCode}.`,
        );
      }

      job.message = "Adding cloned repository.";
      const project = addClonedProjectPath(runtime, job.preview);
      job.completedAt = new Date().toISOString();
      job.message = "Repository cloned.";
      job.project = project;
      job.projectPath = project.path ?? job.preview.destinationPath;
      job.state = "completed";
      await runtime.logger.log({
        details: {
          jobId: job.jobId,
          projectId: project.projectId,
        },
        event: "repositoryClone.completed",
        level: "info",
      });
    } catch (error) {
      if (job.state === "canceled" || job.abortController.signal.aborted) {
        job.message = "Repository clone canceled.";
        job.state = "canceled";
        job.completedAt ??= new Date().toISOString();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      job.completedAt = new Date().toISOString();
      job.error = message;
      job.message = message;
      job.state = "failed";
      await runtime.logger.log({
        details: {
          errorCode: error instanceof GxserverRepositoryCloneError ? error.code : "unknown",
          jobId: job.jobId,
        },
        event: "repositoryClone.failed",
        level: "warn",
      });
    }
  }

  #requireJob(jobId: unknown): MutableRepositoryCloneJob {
    if (typeof jobId !== "string" || !jobId.trim()) {
      throw new GxserverRepositoryCloneError("badRequest", "jobId must be a non-empty string.");
    }
    const job = this.#jobs.get(jobId.trim());
    if (!job) {
      throw new GxserverRepositoryCloneError("notFound", `Repository clone job ${jobId} does not exist.`);
    }
    return job;
  }
}

function addClonedProjectPath(
  runtime: GxserverRepositoryCloneRuntime,
  preview: GxserverRepositoryClonePreviewResult,
): GxserverProjectDomainState {
  const normalizedPath = normalizeExistingDirectoryPath(preview.destinationPath, "destinationPath");
  const db = openGxserverDatabase(runtime.paths);
  try {
    const repository = new GxserverDomainRepository(db, runtime.serverId);
    const existingProject = repository.listProjects().find((project) => project.path === normalizedPath);
    if (existingProject) {
      return existingProject;
    }
    return repository.createProject({
      name: preview.destinationFolderName,
      path: normalizedPath,
    });
  } finally {
    db.close();
  }
}

async function runGitCloneProcess(
  request: {
    args: readonly string[];
    cwd: string;
  },
  options: {
    signal: AbortSignal;
  },
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  return await new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn("git", request.args, {
        cwd: request.cwd,
        env: repositoryCloneProcessEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let limitError: Error | undefined;

    const timeout = setTimeout(() => {
      limitError = new Error(`git clone timed out after ${GXSERVER_REPOSITORY_CLONE_TIMEOUT_MS}ms.`);
      terminateChild(child);
    }, GXSERVER_REPOSITORY_CLONE_TIMEOUT_MS);
    timeout.unref();

    const abort = (): void => {
      terminateChild(child);
    };
    if (options.signal.aborted) {
      abort();
    } else {
      options.signal.addEventListener("abort", abort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const capped = appendCappedChunk(stdoutChunks, stdoutBytes, chunk);
      stdoutBytes = capped.nextBytes;
      if (capped.exceeded) {
        limitError = new Error(`git clone stdout exceeded ${GXSERVER_REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES} bytes.`);
        terminateChild(child);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const capped = appendCappedChunk(stderrChunks, stderrBytes, chunk);
      stderrBytes = capped.nextBytes;
      if (capped.exceeded) {
        limitError = new Error(`git clone stderr exceeded ${GXSERVER_REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES} bytes.`);
        terminateChild(child);
      }
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      if (limitError) {
        reject(limitError);
        return;
      }
      resolve({
        exitCode: code ?? (options.signal.aborted ? 130 : 1),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
      });
    });
  });
}

function repositoryCloneProcessEnvironment(): NodeJS.ProcessEnv {
  /*
  CDXC:RepositoryCloneColorEnv 2026-06-07-00:38:
  Clone jobs are gxserver-owned subprocesses and must not inherit NO_COLOR from daemon launch contexts. Strip color-disabling keys before spawning git so follow-on hooks and tooling stay color-capable.
  */
  const environment = { ...process.env };
  for (const key of GXSERVER_REPOSITORY_CLONE_COLOR_DISABLING_ENVIRONMENT_KEYS) {
    delete environment[key];
  }
  return environment;
}

function appendCappedChunk(
  chunks: Buffer[],
  currentBytes: number,
  chunk: Buffer,
): { exceeded: boolean; nextBytes: number } {
  const nextBytes = currentBytes + chunk.byteLength;
  const remaining = GXSERVER_REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES - currentBytes;
  if (remaining > 0) {
    chunks.push(nextBytes > GXSERVER_REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES ? chunk.subarray(0, remaining) : chunk);
  }
  return {
    exceeded: nextBytes > GXSERVER_REPOSITORY_CLONE_OUTPUT_LIMIT_BYTES,
    nextBytes,
  };
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 1_000).unref();
  }
}

function serializeJob(job: MutableRepositoryCloneJob): GxserverRepositoryCloneJobStatus {
  const { abortController: _abortController, ...serialized } = job;
  return { ...serialized };
}
