#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

/*
CDXC:LocalStartGxserver 2026-05-31-15:52:
Keep the old `scripts/start-ghostex-dev.mjs` entry point as a compatibility wrapper, but route it through the unified local-start orchestrator so dev starts also close the app before any stale gxserver restart.
*/
const result = spawnSync("bun", ["scripts/start-ghostex.mjs", "dev", ...process.argv.slice(2)], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    GHOSTEX_APP_VARIANT: "dev",
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
