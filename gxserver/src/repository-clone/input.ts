import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  GxserverRepositoryClonePreviewResult,
} from "../../protocol/index.js";
import { GxserverProjectPathError, isPathInside, normalizeExistingDirectoryPath } from "../project-paths.js";
import { GxserverRepositoryCloneError } from "./errors.js";

export type ParsedRepositoryCloneInput = {
  cloneUrl: string;
  repositoryName: string;
};

export type NormalizedRepositoryCloneInput = {
  branchName?: string;
  cloneMainOnly: boolean;
  destinationFolderName: string;
  parentPath: string;
  parsedRepository: ParsedRepositoryCloneInput;
  shallowClone: boolean;
};

const DEFAULT_REPOSITORY_HOST = "github.com";
const MAX_REPOSITORY_BRANCH_NAME_LENGTH = 255;
const REPOSITORY_BROWSER_PATH_STOP_SEGMENTS = new Set([
  "-",
  "branches",
  "commit",
  "commits",
  "issues",
  "pull",
  "pulls",
  "releases",
  "src",
  "tree",
  "wiki",
]);

/*
CDXC:RepositoryClone 2026-06-01-11:18:
Repository clone parsing, destination naming, existing-folder detection, and Git option normalization must live in gxserver because macOS, TUI/CLI, mobile, Windows, and Linux clients all initiate the same clone flow. Clients may render forms and toasts, but gxserver owns the filesystem decision that blocks cloning into an existing default folder.

CDXC:RepositoryClone 2026-06-07-16:06:
Branch selection must also normalize in gxserver. Empty branch names mean Git uses the repository default branch, while typed branch names are validated and passed as argv to `git clone --branch`.
*/
export async function previewRepositoryClone(
  params: Record<string, unknown>,
): Promise<GxserverRepositoryClonePreviewResult> {
  const input = normalizeRepositoryCloneInput(params);
  const defaultFolderName = normalizeRepositoryDestinationFolderName(input.parsedRepository.repositoryName, "repository");
  const destinationPath = path.resolve(input.parentPath, input.destinationFolderName);
  if (!isPathInside(input.parentPath, destinationPath) || destinationPath === input.parentPath) {
    throw new GxserverRepositoryCloneError("badRequest", "destinationFolderName must create a child folder inside parentPath.");
  }

  const destination = await readDestinationStatus(destinationPath);
  return {
    ...(input.branchName ? { branchName: input.branchName } : {}),
    cloneMainOnly: input.cloneMainOnly,
    cloneUrl: input.parsedRepository.cloneUrl,
    defaultFolderName,
    destinationExists: destination.exists,
    ...(destination.kind ? { destinationExistsKind: destination.kind } : {}),
    destinationFolderName: input.destinationFolderName,
    ...(destination.isEmpty !== undefined ? { destinationIsEmpty: destination.isEmpty } : {}),
    destinationPath,
    parentPath: input.parentPath,
    repositoryName: input.parsedRepository.repositoryName,
    shallowClone: input.shallowClone,
    ...(destination.exists
      ? {
          warning: `A ${destination.kind ?? "filesystem item"} already exists at ${destinationPath}. Choose a new folder name before cloning.`,
        }
      : {}),
  };
}

export function normalizeRepositoryCloneInput(params: Record<string, unknown>): NormalizedRepositoryCloneInput {
  const repositoryInput = readRequiredString(params.repositoryInput, "repositoryInput");
  const parsedRepository = parseRepositoryCloneInput(repositoryInput);
  if (!parsedRepository) {
    throw new GxserverRepositoryCloneError("badRequest", "Enter a Git repository to clone.");
  }

  const parentPathValue = params.parentPath ?? params.folderPath;
  let parentPath: string;
  try {
    parentPath = normalizeExistingDirectoryPath(parentPathValue, "parentPath");
  } catch (error) {
    if (error instanceof GxserverProjectPathError) {
      throw new GxserverRepositoryCloneError(error.code, error.message);
    }
    throw error;
  }

  const defaultFolderName = normalizeRepositoryDestinationFolderName(parsedRepository.repositoryName, "repository");
  const requestedFolderName = params.destinationFolderName ?? params.newFolderName;
  return {
    branchName: normalizeRepositoryBranchName(params.branchName),
    cloneMainOnly: params.cloneMainOnly === true,
    destinationFolderName: normalizeRepositoryDestinationFolderName(requestedFolderName, defaultFolderName),
    parentPath,
    parsedRepository,
    shallowClone: params.shallowClone === true,
  };
}

export function buildRepositoryCloneGitArgs(input: {
  branchName?: string;
  cloneMainOnly: boolean;
  cloneUrl: string;
  destinationFolderName: string;
  shallowClone: boolean;
}): string[] {
  const args = ["clone"];
  if (input.branchName) {
    args.push("--branch", input.branchName);
  }
  if (input.cloneMainOnly) {
    args.push("--single-branch");
  }
  if (input.shallowClone) {
    args.push("--depth", "1");
  }
  args.push(input.cloneUrl, input.destinationFolderName);
  return args;
}

export function parseRepositoryCloneInput(input: string): ParsedRepositoryCloneInput | undefined {
  const token = extractRepositoryInputToken(input);
  if (!token) {
    return undefined;
  }

  const sshMatch = token.match(/^git@([^:]+):(.+)$/i);
  if (sshMatch) {
    const host = sshMatch[1]?.trim();
    const repositoryPath = normalizeRepositoryPath(sshMatch[2] ?? "");
    if (!host || !repositoryPath) {
      return undefined;
    }
    return {
      cloneUrl: `git@${host}:${repositoryPath}`,
      repositoryName: repositoryNameFromPath(repositoryPath),
    };
  }

  const sshUrlMatch = token.match(/^ssh:\/\/(?:[^@/\s]+@)?([^/\s]+)\/(.+)$/i);
  if (sshUrlMatch) {
    const host = sshUrlMatch[1]?.trim();
    const repositoryPath = normalizeRepositoryPath(sshUrlMatch[2] ?? "");
    if (!host || !repositoryPath) {
      return undefined;
    }
    return {
      cloneUrl: `ssh://git@${host}/${repositoryPath}`,
      repositoryName: repositoryNameFromPath(repositoryPath),
    };
  }

  const httpMatch = token.match(/^(?:https?:\/\/)?([^/\s]+\.[^/\s]+)\/(.+)$/i);
  if (httpMatch) {
    const host = httpMatch[1]?.trim();
    const repositoryPath = normalizeRepositoryPath(httpMatch[2] ?? "");
    if (!host || !repositoryPath) {
      return undefined;
    }
    return {
      cloneUrl: `https://${host}/${repositoryPath}`,
      repositoryName: repositoryNameFromPath(repositoryPath),
    };
  }

  const shorthandPath = normalizeRepositoryPath(token);
  if (!shorthandPath || shorthandPath.split("/").length < 2) {
    return undefined;
  }
  return {
    cloneUrl: `https://${DEFAULT_REPOSITORY_HOST}/${shorthandPath}`,
    repositoryName: repositoryNameFromPath(shorthandPath),
  };
}

function normalizeRepositoryDestinationFolderName(input: unknown, fallback: string): string {
  const rawName = typeof input === "string" && input.trim() ? input.trim() : fallback;
  const normalizedName = rawName.replace(/[/:\\]+/g, "-").replace(/\s+/g, " ").trim();
  if (!normalizedName || /^\.+$/.test(normalizedName)) {
    throw new GxserverRepositoryCloneError("badRequest", "newFolderName must be a valid folder name.");
  }
  return normalizedName;
}

async function readDestinationStatus(destinationPath: string): Promise<{
  exists: boolean;
  isEmpty?: boolean;
  kind?: "directory" | "file" | "other";
}> {
  try {
    const fileStat = await lstat(destinationPath);
    if (fileStat.isDirectory()) {
      return {
        exists: true,
        isEmpty: (await readdir(destinationPath)).length === 0,
        kind: "directory",
      };
    }
    return {
      exists: true,
      kind: fileStat.isFile() ? "file" : "other",
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GxserverRepositoryCloneError("badRequest", `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeRepositoryBranchName(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input !== "string") {
    throw new GxserverRepositoryCloneError("badRequest", "branchName must be a string.");
  }
  const branchName = input.trim();
  if (!branchName) {
    return undefined;
  }
  if (!isRepositoryBranchNameValid(branchName)) {
    throw new GxserverRepositoryCloneError("badRequest", "branchName must be a valid Git branch name.");
  }
  return branchName;
}

function isRepositoryBranchNameValid(branchName: string): boolean {
  if (
    branchName.length > MAX_REPOSITORY_BRANCH_NAME_LENGTH ||
    branchName === "@" ||
    branchName.startsWith("-") ||
    branchName.startsWith("/") ||
    branchName.endsWith("/") ||
    branchName.endsWith(".") ||
    branchName.includes("..") ||
    branchName.includes("@{") ||
    /[\s~^:?*[\\\x00-\x1F\x7F]/.test(branchName)
  ) {
    return false;
  }
  return branchName.split("/").every((segment) => {
    return Boolean(segment) && !segment.startsWith(".") && !segment.endsWith(".lock");
  });
}

function extractRepositoryInputToken(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const tokens = trimmed
    .split(/\s+/)
    .map(cleanRepositoryInputToken)
    .filter(Boolean);
  const ghCloneIndex = tokens.findIndex((token, index) =>
    token === "clone" && tokens[index - 1] === "repo" && tokens[index - 2] === "gh"
  );
  if (ghCloneIndex >= 0) {
    return tokens.slice(ghCloneIndex + 1).find(isRepositoryLikeToken);
  }

  return tokens.find(isRepositoryLikeToken);
}

function cleanRepositoryInputToken(token: string): string {
  return token
    .trim()
    .replace(/^[<("'`]+/g, "")
    .replace(/[>),."'`]+$/g, "");
}

function isRepositoryLikeToken(token: string): boolean {
  if (!token || token.startsWith("-")) {
    return false;
  }
  return (
    /^git@[^:]+:.+/.test(token) ||
    /^ssh:\/\/.+\/.+/i.test(token) ||
    /^https?:\/\/.+\/.+/i.test(token) ||
    /^[^/\s]+\.[^/\s]+\/.+/.test(token) ||
    /^[^/\s]+\/[^/\s]+/.test(token)
  );
}

function normalizeRepositoryPath(repositoryPath: string): string {
  const beforeHash = repositoryPath.split("#")[0] ?? "";
  const beforeQuery = beforeHash.split("?")[0] ?? "";
  const beforeGitSuffix = beforeQuery.replace(/\.git(?:\/.*)?$/i, ".git");
  const segments = beforeGitSuffix
    .split("/")
    .map((segment) => decodeRepositoryPathSegment(segment))
    .filter(Boolean);
  const stopIndex = segments.findIndex((segment) =>
    REPOSITORY_BROWSER_PATH_STOP_SEGMENTS.has(segment.toLowerCase()),
  );
  const repositorySegments = stopIndex >= 0 ? segments.slice(0, stopIndex) : segments;
  const normalizedPath = repositorySegments.join("/");
  return normalizedPath.endsWith(".git") ? normalizedPath : `${normalizedPath}.git`;
}

function decodeRepositoryPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.trim());
  } catch {
    return segment.trim();
  }
}

function repositoryNameFromPath(repositoryPath: string): string {
  const lastSegment = repositoryPath.split("/").filter(Boolean).at(-1) ?? "repository";
  return lastSegment.replace(/\.git$/i, "") || "repository";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
