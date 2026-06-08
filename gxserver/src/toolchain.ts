import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GxserverToolAvailability,
  GxserverToolCapabilityStatus,
  GxserverToolName,
  GxserverToolResolutionSource,
} from "../protocol/index.js";

export interface GxserverToolchainLayoutOptions {
  envPath?: string;
  gxserverRoot?: string;
  platform?: NodeJS.Platform;
  repoRoot?: string;
  resourcesPath?: string;
  wsl?: boolean;
}

export interface GxserverResolvedTool {
  executablePath: string;
  source: GxserverToolResolutionSource;
  tool: GxserverToolName;
}

export class GxserverToolResolutionError extends Error {
  readonly status: GxserverToolCapabilityStatus;

  constructor(status: GxserverToolCapabilityStatus) {
    super(status.message);
    this.name = "GxserverToolResolutionError";
    this.status = status;
  }
}

const EXECUTABLE_ACCESS = fsConstants.X_OK;

/*
CDXC:GxserverToolchain 2026-05-30-14:18:
Ghostex-managed zmx sessions must use the pinned Ghostex zmx artifact because the pane refresh protocol lives in that forked binary. gxserver therefore resolves zmx only from submodule/build/app resources and treats a PATH zmx as invisible for managed sessions.

CDXC:GxserverToolchain 2026-05-30-14:18:
Previous-session text search must use Ghostex's reviewed zehn fork from the pinned submodule or packaged resources. Missing zehn can explain how to build/install the artifact, but gxserver must not silently substitute a PATH zehn.

CDXC:GxserverToolchain 2026-05-30-14:18:
Beads is an upstream user tool rather than a Ghostex-bundled fork. Detect bd on PATH and return setup guidance when absent so Project board clients can surface a direct install action without hiding the missing dependency.
*/

export async function requireBundledZmx(options: GxserverToolchainLayoutOptions = {}): Promise<GxserverResolvedTool> {
  const status = await getZmxToolStatus(options);
  if (status.availability === "available" && status.executablePath && status.source) {
    return {
      executablePath: status.executablePath,
      source: status.source,
      tool: "zmx",
    };
  }
  throw new GxserverToolResolutionError(status);
}

export async function resolveBundledZehn(options: GxserverToolchainLayoutOptions = {}): Promise<GxserverToolCapabilityStatus> {
  return resolveBundledToolStatus("zehn", options);
}

export async function getZmxToolStatus(
  options: GxserverToolchainLayoutOptions = {},
): Promise<GxserverToolCapabilityStatus> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return {
      availability: "unsupported",
      capability: "deferred",
      guidance:
        "Native Windows terminal persistence is deferred. Use macOS, Linux, or WSL for gxserver zmx-backed sessions.",
      message:
        "zmx is required for Ghostex-managed sessions on macOS, Linux, and WSL. Native Windows terminal backend support is deferred.",
      tool: "zmx",
    };
  }
  return resolveBundledToolStatus("zmx", options);
}

export async function getBdToolStatus(
  options: GxserverToolchainLayoutOptions = {},
): Promise<GxserverToolCapabilityStatus> {
  const executablePath = await findExecutableOnPath("bd", options.envPath ?? process.env.PATH ?? "");
  if (executablePath) {
    return {
      availability: "available",
      capability: "beadsProjectBoard",
      executablePath,
      message: "bd was found on PATH. gxserver will use the user's installed Beads CLI.",
      source: "path",
      tool: "bd",
    };
  }
  return {
    availability: "missing",
    capability: "beadsProjectBoard",
    guidance:
      "Install the Beads CLI so Ghostex can manage Project board tickets. On macOS, run `brew install beads`; in a repository, run `bd init` if the project has not been initialized.",
    message: "bd was not found on PATH. Ghostex does not bundle Beads.",
    tool: "bd",
  };
}

export async function getGxserverToolStatuses(
  options: GxserverToolchainLayoutOptions = {},
): Promise<readonly GxserverToolCapabilityStatus[]> {
  const [zmx, zehn, bd] = await Promise.all([
    getZmxToolStatus(options),
    resolveBundledZehn(options),
    getBdToolStatus(options),
  ]);
  return [zmx, zehn, bd];
}

export function describeTerminalBackendScope(options: GxserverToolchainLayoutOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return "Native Windows terminal backend support is deferred. macOS, Linux, and WSL use the bundled Ghostex zmx artifact.";
  }
  if (isWsl(options)) {
    return "WSL uses the bundled Ghostex zmx artifact for managed terminal persistence.";
  }
  return "macOS and Linux use the bundled Ghostex zmx artifact for managed terminal persistence.";
}

async function resolveBundledToolStatus(
  tool: Extract<GxserverToolName, "zmx" | "zehn">,
  options: GxserverToolchainLayoutOptions,
): Promise<GxserverToolCapabilityStatus> {
  const candidates = bundledToolCandidates(tool, options);
  const inspected = await Promise.all(candidates.map(inspectCandidate));
  const executable = inspected.find((candidate) => candidate.availability === "available");
  if (executable) {
    return {
      availability: "available",
      capability: tool === "zmx" ? "zmxLifecycle" : "previousSessionHistory",
      executablePath: executable.executablePath,
      message: `${tool} resolved from ${executable.source}.`,
      source: executable.source,
      tool,
    };
  }

  const nonExecutable = inspected.find((candidate) => candidate.availability === "notExecutable");
  const candidatePaths = candidates.map((candidate) => candidate.executablePath);
  if (nonExecutable) {
    return missingBundledToolStatus(tool, "notExecutable", candidatePaths, nonExecutable.executablePath);
  }
  return missingBundledToolStatus(tool, "missing", candidatePaths);
}

interface ToolCandidate {
  executablePath: string;
  source: Exclude<GxserverToolResolutionSource, "path">;
}

function bundledToolCandidates(
  tool: Extract<GxserverToolName, "zmx" | "zehn">,
  options: GxserverToolchainLayoutOptions,
): readonly ToolCandidate[] {
  const gxserverRoot = options.gxserverRoot ?? defaultGxserverRoot();
  const repoRoot = options.repoRoot ?? path.resolve(gxserverRoot, "..");
  const resourcesPath = options.resourcesPath ?? defaultResourcesPath();

  return dedupeCandidates([
    {
      executablePath: path.join(repoRoot, tool, "zig-out", "bin", tool),
      source: "devSubmodule",
    },
    {
      executablePath: path.join(gxserverRoot, "bin", tool),
      source: "gxserverBundle",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "bin", tool),
      source: "appResource",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "Web", "bin", tool),
      source: "appResource",
    },
    {
      executablePath: path.join(gxserverRoot, "..", "..", "Web", "bin", tool),
      source: "appResource",
    },
    ...(resourcesPath
      ? [
          {
            executablePath: path.join(resourcesPath, "Web", "bin", tool),
            source: "appResource" as const,
          },
          {
            executablePath: path.join(resourcesPath, "gxserver", "bin", tool),
            source: "gxserverBundle" as const,
          },
        ]
      : []),
  ]);
}

function dedupeCandidates(candidates: readonly ToolCandidate[]): readonly ToolCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const resolved = path.resolve(candidate.executablePath);
    if (seen.has(resolved)) {
      return false;
    }
    seen.add(resolved);
    return true;
  });
}

async function inspectCandidate(candidate: ToolCandidate): Promise<
  | {
      availability: "available";
      executablePath: string;
      source: Exclude<GxserverToolResolutionSource, "path">;
    }
  | {
      availability: "missing" | "notExecutable";
      executablePath: string;
    }
> {
  try {
    const fileStat = await stat(candidate.executablePath);
    if (!fileStat.isFile()) {
      return { availability: "missing", executablePath: candidate.executablePath };
    }
    await access(candidate.executablePath, EXECUTABLE_ACCESS);
    return {
      availability: "available",
      executablePath: candidate.executablePath,
      source: candidate.source,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { availability: "missing", executablePath: candidate.executablePath };
    }
    return { availability: "notExecutable", executablePath: candidate.executablePath };
  }
}

function missingBundledToolStatus(
  tool: Extract<GxserverToolName, "zmx" | "zehn">,
  availability: Extract<GxserverToolAvailability, "missing" | "notExecutable">,
  candidatePaths: readonly string[],
  failedPath?: string,
): GxserverToolCapabilityStatus {
  const isZmx = tool === "zmx";
  const failure = availability === "notExecutable" ? `exists but is not executable: ${failedPath ?? tool}` : "was not found";
  const guidance = isZmx
    ? [
        "Build the pinned Ghostex zmx submodule before starting managed sessions:",
        "  git submodule update --init --recursive zmx",
        "  cd zmx && zig build -Doptimize=ReleaseSafe",
        "Packaged builds must place zmx in gxserver/app resources. PATH zmx is intentionally ignored.",
      ].join("\n")
    : [
        "Build the pinned Ghostex zehn submodule before using CLI search flows:",
        "  git submodule update --init zehn",
        "  cd zehn && zig build -Doptimize=ReleaseFast",
        "Packaged builds must place zehn in gxserver/app resources. PATH zehn is intentionally ignored.",
      ].join("\n");
  return {
    availability,
    candidatePaths,
    capability: isZmx ? "zmxLifecycle" : "previousSessionHistory",
    guidance,
    message: isZmx
      ? `Ghostex-managed zmx sessions require bundled zmx, but bundled zmx ${failure}.`
      : `Ghostex CLI search requires bundled zehn, but bundled zehn ${failure}.`,
    tool,
  };
}

async function findExecutableOnPath(command: string, envPath: string): Promise<string | undefined> {
  const pathEntries = envPath.split(path.delimiter).filter(Boolean);
  for (const pathEntry of pathEntries) {
    const executablePath = path.join(pathEntry, command);
    try {
      const fileStat = await stat(executablePath);
      if (!fileStat.isFile()) {
        continue;
      }
      await access(executablePath, EXECUTABLE_ACCESS);
      return executablePath;
    } catch {
      continue;
    }
  }
  return undefined;
}

function defaultGxserverRoot(): string {
  return path.resolve(fileURLToPath(import.meta.url), "..", "..");
}

function defaultResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function isWsl(options: GxserverToolchainLayoutOptions): boolean {
  if (typeof options.wsl === "boolean") {
    return options.wsl;
  }
  if ((options.platform ?? process.platform) !== "linux") {
    return false;
  }
  return /microsoft|wsl/i.test(os.release());
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
