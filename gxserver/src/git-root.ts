import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { normalizeExistingDirectoryPath } from "./project-paths.js";

/*
CDXC:OSIntegration 2026-06-02-12:14:
CLI/open-file routing may need a repository root before the path is a registered gxserver project. gxserver owns that Git inspection, but this helper is only exposed through a local-only endpoint because arbitrary filesystem probing must not be available to remote clients.
*/
export function resolveGitRootForExistingDirectory(input: unknown): string | undefined {
  const cwd = normalizeExistingDirectoryPath(input, "path");
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const root = result.stdout.trim();
  if (!root) {
    return undefined;
  }
  try {
    return realpathSync.native(root);
  } catch {
    return root.replace(/\/+$/u, "") || root;
  }
}
