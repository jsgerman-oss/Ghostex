#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

/**
 * CDXC:DevAppFlavor 2026-05-09-16:15
 * `bun run start:dev` is the local development start command. It must launch
 * the `ghostex-dev` app identity so iterative repo runs do not replace or
 * stop the installed release app at /Applications/Ghostex.app.
 * CDXC:Branding 2026-05-12-07:35
 * Public app surfaces use Ghostex while the internal GHOSTEX_APP_VARIANT and
 * ~/.ghostex-dev storage split remain unchanged implementation details.
 * CDXC:DevAppFlavor 2026-05-11-12:10
 * The dev identity must also keep settings, projects, sessions, hooks, browser
 * profiles, and runtime state isolated from the installed app via ~/.ghostex-dev.
 */
const devEnv = {
  ...process.env,
  GHOSTEX_APP_VARIANT: "dev",
};

run("bun", ["scripts/build-t3code-if-needed.mjs"], devEnv);
run("native/macos/ghostexHost/run-ghostex-host.sh", [], devEnv);

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
