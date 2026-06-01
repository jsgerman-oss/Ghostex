#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostScriptDir = path.join(repoRoot, "native", "macos", "ghostexHost");
const projectPath = path.join(hostScriptDir, "ghostex.xcodeproj");
const installDir = process.env.INSTALL_DIR || "/Applications";
const configuration = process.env.CONFIGURATION || "Debug";
const protocolVersion = 1;
const gxserverBaseUrl = "http://127.0.0.1:58744";

const variant = parseVariant(process.argv.slice(2), process.env.GHOSTEX_APP_VARIANT);
const buildEnv = {
  ...process.env,
  GHOSTEX_APP_VARIANT: variant,
};
/*
CDXC:DevAppFlavor 2026-05-31-15:52:
The unified local start command preserves the existing production/dev split: default starts install Ghostex with production storage, while the `dev` argument installs Ghostex-dev with the dev bundle id and bundle metadata that points workflow state at ~/.ghostex-dev.
*/
const appName = variant === "dev" ? "Ghostex-dev" : "Ghostex";
const bundleId = variant === "dev" ? "com.madda.ghostex-dev.host" : "com.madda.ghostex.host";
/*
CDXC:LocalStart 2026-05-31-15:52:
Local starts must launch the architecture-specific app product that build-ghostex-host.sh just produced. Keep the DerivedData default aligned with the native build script so arm64 and Intel verification do not copy an older app from another architecture.
*/
const arch = normalizeMacosArch(process.env.GHOSTEX_MACOS_ARCH || runCapture("uname", ["-m"]).trim());
const derivedData = process.env.DERIVED_DATA || path.join(repoRoot, "build", arch);
const xcodeDestination = `platform=macOS,arch=${arch}`;
const installedApp = path.join(installDir, `${appName}.app`);
const installedExecutable = path.join(installedApp, "Contents", "MacOS", appName);

/*
CDXC:LocalStartGxserver 2026-05-31-15:52:
Local start commands must share one orchestrator so `bun run start`, `bun run start dev`, and `bun run start:dev` all build the matching app bundle, close the visible app first, restart gxserver only while the app is closed, then launch the newly installed app.

CDXC:LocalStartGxserver 2026-05-31-15:52:
gxserver implementation changes are detected through the packaged daemon build identity generated from the staged gxserver folder contents. The macOS client protocol version changes only when the HTTP contract changes, while same-protocol gxserver code rebuilds still force a daemon restart before the sidebar connects.

CDXC:LocalStartGxserver 2026-06-01-12:47:
`bun run start` is the local test reset path: after closing the app it must stop the gxserver control plane on every run while preserving existing zmx servers, so the relaunched macOS app starts the freshly built daemon and any later zmx restart uses the newly packaged zmx binary.
*/
run("bun", ["scripts/build-t3code-if-needed.mjs"], { env: buildEnv });
run(path.join(hostScriptDir, "build-ghostex-host.sh"), [], { env: buildEnv });

const builtApp = path.join(readBuiltProductsDir(), `${appName}.app`);
if (!existsSync(builtApp)) {
  throw new Error(`Built app is missing at ${builtApp}.`);
}

await closeInstalledApp();
await stopRunningGxserverControlPlaneBeforeLaunch(builtApp);
installAndOpenApp(builtApp);

function parseVariant(args, envVariant) {
  let selected = envVariant === "dev" ? "dev" : "prod";
  for (const arg of args) {
    if (arg === "dev" || arg === "--dev") {
      selected = "dev";
    } else if (arg === "prod" || arg === "--prod") {
      selected = "prod";
    } else {
      throw new Error(`Unknown start argument: ${arg}. Use "dev" for Ghostex-dev or omit it for Ghostex.`);
    }
  }
  return selected;
}

function normalizeMacosArch(value) {
  const normalized = value.trim();
  if (normalized === "arm64" || normalized === "aarch64") {
    return "arm64";
  }
  if (normalized === "x86_64" || normalized === "x64" || normalized === "amd64") {
    return "x86_64";
  }
  throw new Error(`Unsupported GHOSTEX_MACOS_ARCH: ${value}`);
}

function readBuiltProductsDir() {
  const output = runCapture("xcodebuild", [
    "-project",
    projectPath,
    "-scheme",
    "ghostex",
    "-configuration",
    configuration,
    "-destination",
    xcodeDestination,
    "-derivedDataPath",
    derivedData,
    `ARCHS=${arch}`,
    "ONLY_ACTIVE_ARCH=NO",
    "-showBuildSettings",
  ]);
  const line = output.split(/\r?\n/).find((candidate) => candidate.includes("BUILT_PRODUCTS_DIR = "));
  const builtProductsDir = line?.split(" = ").slice(1).join(" = ").trim();
  if (!builtProductsDir) {
    throw new Error("Could not resolve BUILT_PRODUCTS_DIR from xcodebuild.");
  }
  return builtProductsDir;
}

async function closeInstalledApp() {
  /*
  CDXC:LocalStartGxserver 2026-05-31-15:52:
  Close only the matching installed app executable before replacing the bundle or stopping stale gxserver. This keeps the visible app from watching its backend disappear and avoids signaling zmx attach processes or the gxserver process by broad name.
  */
  run("osascript", ["-e", `tell application id "${bundleId}" to quit`], {
    allowFailure: true,
    stdio: "ignore",
  });
  if (await waitForAppExit(8000)) {
    return;
  }

  const pids = findRunningAppPids();
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
  if (!(await waitForAppExit(8000))) {
    throw new Error(`${appName} did not exit, refusing to replace ${installedApp} while it is still running.`);
  }
}

async function waitForAppExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findRunningAppPids().length === 0) {
      return true;
    }
    await sleep(100);
  }
  return findRunningAppPids().length === 0;
}

function findRunningAppPids() {
  const pattern = `^${escapeRegExp(installedExecutable)}$`;
  const result = spawnSync("pgrep", ["-f", pattern], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  return result.stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

async function stopRunningGxserverControlPlaneBeforeLaunch(appPath) {
  const expectedBuildIdentity = readBundledGxserverBuildIdentity(appPath);
  if (!expectedBuildIdentity) {
    console.warn("The built app has no bundled gxserver build identity; stopping any running control plane anyway.");
  }

  const token = readGxserverToken();
  if (!token) {
    return;
  }

  const health = await fetchGxserverJson("/api/health/server", { method: "GET", token });
  if (!health || health.product !== "gxserver") {
    return;
  }

  const actualBuildIdentity = typeof health.buildIdentity === "string" ? health.buildIdentity.trim() : "";
  const buildIdentitySuffix =
    actualBuildIdentity && expectedBuildIdentity && actualBuildIdentity !== expectedBuildIdentity
      ? ` (build identity ${actualBuildIdentity} -> ${expectedBuildIdentity})`
      : "";

  console.log(`Stopping gxserver control plane before opening ${appName}${buildIdentitySuffix}.`);
  await fetchGxserverJson("/api/control/stop", { method: "POST", token });
  const stopped = await waitForGxserverStop(token, 5000);
  if (!stopped) {
    throw new Error("gxserver stop was requested, but the old control plane is still responding.");
  }
}

function readBundledGxserverBuildIdentity(appPath) {
  const identityPath = path.join(appPath, "Contents", "Resources", "Web", "gxserver", "build-identity.json");
  if (!existsSync(identityPath)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(identityPath, "utf8"));
  const buildIdentity = typeof parsed.buildIdentity === "string" ? parsed.buildIdentity.trim() : "";
  return buildIdentity || undefined;
}

function readGxserverToken() {
  const tokenPath = path.join(homedir(), ".ghostex", "gxserver", "auth", "token");
  if (!existsSync(tokenPath)) {
    return undefined;
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  return token || undefined;
}

async function waitForGxserverStop(token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await fetchGxserverJson("/api/health/server", { method: "GET", token, timeoutMs: 500 });
    if (!health) {
      return true;
    }
    await sleep(100);
  }
  return !(await fetchGxserverJson("/api/health/server", { method: "GET", token, timeoutMs: 500 }));
}

async function fetchGxserverJson(pathname, { method, token, timeoutMs = 1000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${gxserverBaseUrl}${pathname}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-gxserver-protocol-version": String(protocolVersion),
      },
      method,
      signal: controller.signal,
    });
    if (!response.ok) {
      return undefined;
    }
    return await response.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function installAndOpenApp(appPath) {
  /*
  CDXC:MacOSPermissions 2026-05-31-15:52:
  Install local builds to the stable /Applications app path before launching so macOS Accessibility permission remains attached to the same signed app identity across rebuilds.
  */
  rmSync(installedApp, { force: true, recursive: true });
  cpSync(appPath, installedApp, { recursive: true });
  run(path.join(hostScriptDir, "codesign-ghostex-host.sh"), [installedApp]);
  run("open", [installedApp]);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status ?? 1);
  }
  return result;
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: buildEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed with status ${result.status}`);
  }
  return result.stdout;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
