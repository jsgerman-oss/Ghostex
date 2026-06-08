#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const startEnvironment = withoutColorDisablingEnvironment(process.env);

const variant = parseVariant(process.argv.slice(2), process.env.GHOSTEX_APP_VARIANT);
/*
CDXC:LocalStartArchitecture 2026-06-08-08:42:
Apple Silicon local starts must build and launch Apple-native bundled tools even when the invoking shell, Bun, or Terminal is running under Rosetta. Default the architecture from the physical Mac capability and reserve Intel builds for explicit GHOSTEX_MACOS_ARCH=x86_64 requests.
*/
const arch = resolveLocalMacosArch(process.env.GHOSTEX_MACOS_ARCH);
const buildEnv = {
  ...startEnvironment,
  GHOSTEX_APP_VARIANT: variant,
  GHOSTEX_MACOS_ARCH: arch,
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
const derivedData = process.env.DERIVED_DATA || path.join(repoRoot, "build", arch);
const builtAppPathFile = path.join(derivedData, "ghostex-built-app-path.txt");
buildEnv.GHOSTEX_BUILT_APP_PATH_FILE = builtAppPathFile;
const xcodeDestination = `platform=macOS,arch=${arch}`;
const installedApp = path.join(installDir, `${appName}.app`);
const installedExecutable = path.join(installedApp, "Contents", "MacOS", appName);
ensureCodeServerDevelopmentRuntime();

/*
CDXC:LocalStartGxserver 2026-05-31-15:52:
Local start commands must share one orchestrator so `bun run start`, `bun run start dev`, and `bun run start:dev` all build the matching app bundle, close the visible app first, restart gxserver only while the app is closed, then launch the newly installed app.

CDXC:LocalStartGxserver 2026-05-31-15:52:
gxserver implementation changes are detected through the packaged daemon build identity generated from the staged gxserver folder contents. The macOS client protocol version changes only when the HTTP contract changes, while same-protocol gxserver code rebuilds still force a daemon restart before the sidebar connects.

CDXC:LocalStartGxserver 2026-06-01-12:47:
`bun run start` is the local test reset path: after closing the app it must stop the gxserver control plane on every run while preserving existing zmx servers, so the relaunched macOS app starts the freshly built daemon and any later zmx restart uses the newly packaged zmx binary.
*/
/*
CDXC:LocalStart 2026-06-07-12:21:
Local starts must reach the native build script on macOS hosts that kill direct Bun/Node script-path execution before stderr is available. Invoke the script through /bin/bash so `bun run start` follows the same executable path that succeeds in an interactive shell while preserving normal build failures.

CDXC:LocalStartFast 2026-06-07-16:23:
The native build script owns incremental T3 Code and gxserver packaging, so the launcher should not run a separate T3 source scan before invoking the same packaging path. Use one orchestrator and consume its built-app path handoff instead of asking Xcode for the same build setting again.
*/
run("/bin/bash", [path.join(hostScriptDir, "build-ghostex-host.sh")], { env: buildEnv });

const builtApp = readBuiltAppPath();
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

function resolveLocalMacosArch(explicitValue) {
  if (explicitValue && explicitValue.trim()) {
    return normalizeMacosArch(explicitValue);
  }
  if (isAppleSiliconMac()) {
    return "arm64";
  }
  return normalizeMacosArch(runCaptureWithEnvironment("uname", ["-m"], startEnvironment).trim());
}

function isAppleSiliconMac() {
  const result = spawnSync("/usr/sbin/sysctl", ["-in", "hw.optional.arm64"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && result.stdout.trim() === "1";
}

function ensureCodeServerDevelopmentRuntime() {
  /*
  CDXC:EditorPanes 2026-06-08-09:08:
  Local macOS starts publish the root code-server checkout to LaunchServices, so they must also prove the nested VS Code dev payload exists before the app opens. Initialize the reviewed submodule automatically, then stop on missing server-main.js with the exact working build commands instead of letting the Source tab render code-server's raw 500 page.
  */
  const codeServerRoot = path.join(repoRoot, "code-server");
  const codeServerEntrypoint = path.join(codeServerRoot, "out", "node", "entry.js");
  if (!existsSync(codeServerEntrypoint)) {
    throw new Error(
      "Embedded code-server output is missing. Run `npm --prefix code-server install` and `npm --prefix code-server run build` before opening the Source tab.",
    );
  }

  const vscodePackageJson = path.join(codeServerRoot, "lib", "vscode", "package.json");
  if (!existsSync(vscodePackageJson)) {
    run("git", ["-C", codeServerRoot, "submodule", "update", "--init", "lib/vscode"]);
  }
  if (!existsSync(vscodePackageJson)) {
    throw new Error(
      "Embedded code-server VS Code submodule is missing. Run `git -C code-server submodule update --init lib/vscode` from the Ghostex checkout.",
    );
  }

  const vscodeServerMain = path.join(codeServerRoot, "lib", "vscode", "out", "server-main.js");
  if (!existsSync(vscodeServerMain)) {
    throw new Error(
      "Embedded code-server VS Code build output is missing. Run `npm --prefix code-server/lib/vscode install` and `npm --prefix code-server/lib/vscode run compile` before opening the Source tab.",
    );
  }

  /*
  CDXC:EditorPanes 2026-06-08-09:18:
  VS Code's built-in Git extension depends on the macOS @vscode/fs-copyfile native module. Local Source-tab starts should build that package at the writer boundary instead of letting the workbench open and then fail Git activation with a missing vscode_fs.node toast.
  */
  const fsCopyfileRoot = path.join(
    codeServerRoot,
    "lib",
    "vscode",
    "extensions",
    "git",
    "node_modules",
    "@vscode",
    "fs-copyfile",
  );
  const fsCopyfilePackageJson = path.join(fsCopyfileRoot, "package.json");
  if (!existsSync(fsCopyfilePackageJson)) {
    throw new Error(
      "Embedded VS Code Git extension dependencies are missing. Run `npm --prefix code-server/lib/vscode install` before opening the Source tab.",
    );
  }
  const fsCopyfileNativeModule = path.join(fsCopyfileRoot, "build", "Release", "vscode_fs.node");
  if (!existsSync(fsCopyfileNativeModule)) {
    run("npm", ["--prefix", fsCopyfileRoot, "run", "build"]);
  }
  if (!existsSync(fsCopyfileNativeModule)) {
    throw new Error(
      "Embedded VS Code Git extension native module is missing. Run `npm --prefix code-server/lib/vscode/extensions/git/node_modules/@vscode/fs-copyfile run build` before opening the Source tab.",
    );
  }
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

function readBuiltAppPath() {
  if (existsSync(builtAppPathFile)) {
    const appPath = readFileSync(builtAppPathFile, "utf8").trim();
    if (appPath) {
      return appPath;
    }
  }
  return path.join(readBuiltProductsDir(), `${appName}.app`);
}

async function closeInstalledApp() {
  /*
  CDXC:LocalStartGxserver 2026-05-31-15:52:
  Close only the matching installed app executable before replacing the bundle or stopping stale gxserver. This keeps the visible app from watching its backend disappear and avoids signaling zmx attach processes or the gxserver process by broad name.

  CDXC:LocalStart 2026-06-08-05:00:
  AppleScript `tell application id ... to quit` can launch a not-running app just to deliver the quit command, which makes `bun run start` look like the app crashed immediately. Probe the exact installed executable first and only send the quit command when there is a live app process to close.
  */
  let pids = findRunningAppPids();
  if (pids.length === 0) {
    return;
  }
  run("osascript", ["-e", `tell application id "${bundleId}" to quit`], {
    allowFailure: true,
    stdio: "ignore",
  });
  if (await waitForAppExit(8000)) {
    return;
  }

  pids = findRunningAppPids();
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
  const bundlePids = findRunningAppPidsByBundleId();
  if (bundlePids.length > 0) {
    return bundlePids;
  }
  return findRunningAppPidsByExecutablePath();
}

function findRunningAppPidsByBundleId() {
  /*
  CDXC:LocalStart 2026-06-08-07:05:
  Local starts must close the installed macOS app before copying a rebuilt bundle into /Applications. `pgrep` can miss LaunchServices-launched app processes even when `ps` shows the executable path, so use macOS' bundle identifier process table first and reserve executable-path matching for environments where System Events is unavailable.
  */
  const result = spawnSync("osascript", [
    "-e",
    `tell application "System Events" to get the unix id of every process whose bundle identifier is "${bundleId}"`,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  return parsePidList(result.stdout);
}

function findRunningAppPidsByExecutablePath() {
  const result = spawnSync("ps", ["-axo", "pid=,args=", "-ww"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .filter((match) => match && isInstalledAppCommandLine(match[2]))
    .map((match) => match[1]);
}

function isInstalledAppCommandLine(commandLine) {
  return commandLine === installedExecutable || commandLine.startsWith(`${installedExecutable} `);
}

function parsePidList(value) {
  return value
    .split(/[,\s]+/)
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

  CDXC:LocalStartGxserver 2026-06-07-12:02:
  A local start must prove the installed, signed gxserver bundle can load its native database module with the same Node runtime the macOS app will resolve. Run that preflight after codesign and before `open` so a bad native module signature or Node ABI stops the launch instead of letting the sidebar emit misleading health and Git API failures.

  CDXC:CodeServerSubmodule 2026-06-07-11:20:
  Local starts launch Ghostex through LaunchServices from /Applications, which gives the app cwd `/` and drops the invoking shell environment. Publish the repo root and root code-server submodule path through launchd before `open` so the native Source tab resolves the reviewed in-repo code-server checkout instead of probing maintainer-local paths.

  CDXC:T3CodeSubmodule 2026-06-07-13:00:
  Publish the root `t3code` submodule path through launchd with the same local-start environment handoff, so native T3 source fallbacks and diagnostics resolve the parent-pinned fork branch instead of the old sibling t3code-embed checkout.

  CDXC:LocalStartFast 2026-06-07-16:23:
  Local starts should mirror the already signed build product into /Applications incrementally and verify the copied signature before signing. Re-sign only when verification fails so unchanged CEF, gxserver node_modules, and app resources do not get re-copied and re-signed on every relaunch.

  CDXC:LocalStartFast 2026-06-07-17:32:
  Outer app verification is not enough for bundled Node modules: linker-signed `.node` files can verify on disk but fail the runtime load preflight. Refuse the skip path when a preflighted native module is still linker-signed so local starts produce a launchable app instead of stopping after the rebuild.
  */
  syncInstalledAppBundle(appPath);
  ensureInstalledAppCodeSignature(installedApp);
  preflightInstalledGxserverBundle(installedApp);
  publishLaunchServicesDevelopmentEnvironment();
  run("open", [installedApp]);
}

function syncInstalledAppBundle(appPath) {
  run("rsync", ["-a", "--delete", `${appPath}/`, `${installedApp}/`]);
}

function ensureInstalledAppCodeSignature(appPath) {
  if (hasReusableInstalledAppCodeSignature(appPath)) {
    console.log(`Installed ${appName} signature is current; skipping re-sign.`);
    return;
  }
  run(path.join(hostScriptDir, "codesign-ghostex-host.sh"), [appPath]);
}

function hasReusableInstalledAppCodeSignature(appPath) {
  return hasValidInstalledAppCodeSignature(appPath) && !hasLinkerSignedBundledNativeModules(appPath);
}

function hasValidInstalledAppCodeSignature(appPath) {
  const result = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  return result.status === 0;
}

function hasLinkerSignedBundledNativeModules(appPath) {
  const gxserverRoot = path.join(appPath, "Contents", "Resources", "Web", "gxserver");
  if (!existsSync(gxserverRoot)) {
    return false;
  }
  let runtime;
  try {
    runtime = readBundledGxserverNativeRuntime(appPath);
  } catch {
    return false;
  }
  for (const modulePath of bundledNativeModulePreflightPaths(gxserverRoot, runtime)) {
    if (isLinkerSignedCode(modulePath)) {
      return true;
    }
  }
  return false;
}

function isLinkerSignedCode(codePath) {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", codePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  return result.status === 0 && `${result.stderr}\n${result.stdout}`.includes("linker-signed");
}

function publishLaunchServicesDevelopmentEnvironment() {
  run("launchctl", ["setenv", "ghostex_REPO_ROOT", repoRoot], { stdio: "ignore" });
  run("launchctl", ["setenv", "GHOSTEX_CODE_SERVER_ROOT", path.join(repoRoot, "code-server")], {
    stdio: "ignore",
  });
  run("launchctl", ["setenv", "VSMUX_T3CODE_REPO_ROOT", path.join(repoRoot, "t3code")], {
    stdio: "ignore",
  });
}

function preflightInstalledGxserverBundle(appPath) {
  const gxserverRoot = path.join(appPath, "Contents", "Resources", "Web", "gxserver");
  if (!existsSync(gxserverRoot)) {
    throw new Error(`Installed ${appName} is missing the bundled gxserver package.`);
  }
  verifyInstalledAppCodeSignature(appPath);
  const runtime = readBundledGxserverNativeRuntime(appPath);
  const nodeResolution = resolveNodeForGxserverPreflight(runtime);
  const dependencyError = gxserverNodeDependencyError(nodeResolution, runtime);
  if (dependencyError) {
    throw new Error(dependencyError);
  }
  for (const modulePath of bundledNativeModulePreflightPaths(gxserverRoot, runtime)) {
    preflightNativeNodeModuleLoad(modulePath, nodeResolution, appPath);
  }
}

function verifyInstalledAppCodeSignature(appPath) {
  const result = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = sanitizePreflightOutput(`${result.stderr}\n${result.stdout}`, appPath);
    throw new Error(`Installed ${appName} code signature preflight failed.${output ? ` ${output}` : ""}`);
  }
}

function readBundledGxserverNativeRuntime(appPath) {
  const gxserverRoot = path.join(appPath, "Contents", "Resources", "Web", "gxserver");
  const runtimePath = path.join(gxserverRoot, "native-runtime.json");
  const bundledDatabaseModulePath = path.join(
    gxserverRoot,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );
  if (!existsSync(runtimePath)) {
    if (existsSync(bundledDatabaseModulePath)) {
      throw new Error(
        `Installed ${appName} includes a bundled gxserver database module, but native runtime metadata is missing.`,
      );
    }
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(runtimePath, "utf8"));
  const nodeMajor = Number(parsed.nodeMajor);
  const nodeModuleVersion = typeof parsed.nodeModuleVersion === "string"
    ? parsed.nodeModuleVersion.trim()
    : "";
  if (!Number.isInteger(nodeMajor) || nodeMajor <= 0 || !nodeModuleVersion) {
    throw new Error(`Installed ${appName} has invalid gxserver native runtime metadata.`);
  }
  return {
    nativeModules: Array.isArray(parsed.nativeModules)
      ? parsed.nativeModules.filter((value) => typeof value === "string")
      : [],
    nodeMajor,
    nodeModuleVersion,
    nodeRequirement: typeof parsed.nodeRequirement === "string" ? parsed.nodeRequirement : undefined,
  };
}

function bundledNativeModulePreflightPaths(gxserverRoot, runtime) {
  const modulePaths = [];
  const nativeModuleNames = new Set(runtime?.nativeModules ?? []);
  const bundledDatabaseModulePath = path.join(
    gxserverRoot,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );
  if (nativeModuleNames.has("better-sqlite3") || existsSync(bundledDatabaseModulePath)) {
    modulePaths.push(bundledDatabaseModulePath);
  }
  for (const modulePath of modulePaths) {
    if (!existsSync(modulePath)) {
      throw new Error(`Installed ${appName} is missing a required gxserver native module.`);
    }
  }
  return modulePaths;
}

function resolveNodeForGxserverPreflight(runtime) {
  const preferredMajor = runtime?.nodeMajor ?? 22;
  const candidates = systemNodeCandidates(homedir(), preferredMajor);
  const seenPaths = new Set();
  let firstVersionedCandidate;
  for (const candidate of candidates) {
    if (!existsSync(candidate.path) || seenPaths.has(candidate.path)) {
      continue;
    }
    seenPaths.add(candidate.path);
    const resolution = probeNode(candidate.path, candidate.source);
    if (!resolution) {
      continue;
    }
    if (nodeResolutionSatisfies(resolution, runtime)) {
      return resolution;
    }
    firstVersionedCandidate ??= resolution;
  }

  const envPathResult = spawnSync("/usr/bin/env", ["node", "-p", "process.execPath"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const envNodePath = envPathResult.status === 0 ? envPathResult.stdout.trim() : "";
  if (envNodePath && !seenPaths.has(envNodePath)) {
    const resolution = probeNode(envNodePath, "PATH");
    if (resolution && nodeResolutionSatisfies(resolution, runtime)) {
      return resolution;
    }
    firstVersionedCandidate ??= resolution;
  }

  return firstVersionedCandidate ?? { moduleVersion: "", path: "", source: "unresolved", version: "" };
}

function systemNodeCandidates(home, preferredMajor) {
  /*
  CDXC:LocalStartGxserver 2026-06-07-12:02:
  The local-start preflight must resolve Node like the app bootstrap does, because LaunchServices does not inherit the shell that ran `bun run start`. Scan the same common direct-install roots before shims or PATH so the module-load probe validates the runtime Ghostex will actually use.
  */
  const candidates = [
    { path: `/opt/homebrew/opt/node@${preferredMajor}/bin/node`, source: `Homebrew Apple Silicon node@${preferredMajor}` },
    { path: `/usr/local/opt/node@${preferredMajor}/bin/node`, source: `Homebrew Intel/usr-local node@${preferredMajor}` },
    { path: "/opt/homebrew/bin/node", source: "Homebrew Apple Silicon" },
    { path: "/usr/local/bin/node", source: "Homebrew Intel/usr-local" },
    { path: `${home}/.local/bin/node`, source: "user local bin" },
    ...versionedNodeCandidates(`${home}/.nvm/versions/node`, "nvm", preferredMajor, "bin/node"),
    { path: `${home}/.nvm/current/bin/node`, source: "nvm current" },
    ...versionedNodeCandidates(`${home}/.local/share/mise/installs/node`, "mise install", preferredMajor, "bin/node"),
    ...versionedNodeCandidates(`${home}/.asdf/installs/nodejs`, "asdf install", preferredMajor, "bin/node"),
    ...versionedNodeCandidates(`${home}/.nodenv/versions`, "nodenv install", preferredMajor, "bin/node"),
    ...versionedNodeCandidates(`${home}/.fnm/node-versions`, "fnm install", preferredMajor, "installation/bin/node"),
    ...versionedNodeCandidates(`${home}/.local/share/fnm/node-versions`, "fnm install", preferredMajor, "installation/bin/node"),
    ...versionedNodeCandidates(`${home}/Library/Application Support/fnm/node-versions`, "fnm install", preferredMajor, "installation/bin/node"),
    ...versionedNodeCandidates(`${home}/.volta/tools/image/node`, "Volta install", preferredMajor, "bin/node"),
    { path: `${home}/.volta/bin/node`, source: "Volta shim" },
    { path: `${home}/.local/share/mise/shims/node`, source: "mise shim" },
    { path: `${home}/.asdf/shims/node`, source: "asdf shim" },
    { path: `${home}/.nodenv/shims/node`, source: "nodenv shim" },
  ];
  return candidates;
}

function versionedNodeCandidates(root, source, preferredMajor, relativeNodePath) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && nodeDirectoryNameMatchesMajor(entry.name, preferredMajor))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }))
      .map((entry) => ({
        path: path.join(root, entry, ...relativeNodePath.split("/")),
        source,
      }));
  } catch {
    return [];
  }
}

function nodeDirectoryNameMatchesMajor(name, major) {
  const normalized = name.startsWith("v") ? name.slice(1) : name;
  return normalized === String(major) || normalized.startsWith(`${major}.`);
}

function probeNode(nodePath, source) {
  const result = spawnSync(nodePath, [
    "-p",
    "JSON.stringify({version: process.version, modules: process.versions.modules, execPath: process.execPath})",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
    const moduleVersion = typeof parsed.modules === "string" ? parsed.modules.trim() : "";
    const execPath = typeof parsed.execPath === "string" ? parsed.execPath.trim() : nodePath;
    if (!nodeVersionMajor(version)) {
      return undefined;
    }
    return { moduleVersion, path: execPath || nodePath, source, version };
  } catch {
    return undefined;
  }
}

function gxserverNodeDependencyError(resolution, runtime) {
  if (!runtime) {
    if (!resolution.path) {
      return "gxserver requires Node.js 22 LTS or newer, but no system Node was found.";
    }
    const major = nodeVersionMajor(resolution.version);
    return major && major >= 22
      ? undefined
      : `gxserver requires Node.js 22 LTS or newer, but the detected system Node is ${resolution.version || "unknown"}.`;
  }
  const requirement = runtime.nodeRequirement ?? `Node.js ${runtime.nodeMajor}.x with NODE_MODULE_VERSION ${runtime.nodeModuleVersion}`;
  if (!resolution.path) {
    return `gxserver requires ${requirement} for this Ghostex build, but no matching system Node was found.`;
  }
  if (!nodeResolutionSatisfies(resolution, runtime)) {
    const version = resolution.version || "unknown";
    const moduleVersion = resolution.moduleVersion || "unknown";
    return `gxserver requires ${requirement} for this Ghostex build, but the detected system Node is ${version} with NODE_MODULE_VERSION ${moduleVersion}.`;
  }
  return undefined;
}

function nodeResolutionSatisfies(resolution, runtime) {
  const major = nodeVersionMajor(resolution.version);
  if (!major) {
    return false;
  }
  if (!runtime) {
    return major >= 22;
  }
  return major === runtime.nodeMajor && resolution.moduleVersion === runtime.nodeModuleVersion;
}

function nodeVersionMajor(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const major = Number(normalized.split(".")[0]);
  return Number.isInteger(major) ? major : undefined;
}

function preflightNativeNodeModuleLoad(modulePath, nodeResolution, appPath) {
  const probeScript = `
const modulePath = process.argv[1];
try {
  require(modulePath);
} catch (error) {
  const rawMessage = error && typeof error.message === "string" ? error.message : String(error);
  const scrubbedMessage = rawMessage.split(modulePath).join("[native-module]");
  console.error(JSON.stringify({ code: error && error.code, message: scrubbedMessage, name: error && error.name }));
  process.exit(1);
}
`;
  const result = spawnSync(nodeResolution.path, ["-e", probeScript, modulePath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: startEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = sanitizePreflightOutput(`${result.stderr}\n${result.stdout}`, appPath);
    throw new Error(
      `Installed gxserver native-module preflight failed with ${nodeResolution.version} (NODE_MODULE_VERSION ${nodeResolution.moduleVersion}).${output ? ` ${output}` : ""}`,
    );
  }
}

function sanitizePreflightOutput(value, appPath) {
  return String(value)
    .replaceAll(appPath, "[installed-app]")
    .replaceAll(homedir(), "~")
    .replaceAll(repoRoot, "[repo]")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: options.env || startEnvironment,
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
  return runCaptureWithEnvironment(command, args, buildEnv);
}

function runCaptureWithEnvironment(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withoutColorDisablingEnvironment(environment) {
  /*
  CDXC:LocalStartColorEnv 2026-06-07-00:38:
  Local starts can be run from agent terminals that export NO_COLOR. Ghostex app, gxserver, and forked agent sessions must stay color-capable, so strip inherited color-disabling keys before build, install, open, and daemon-control subprocesses.
  */
  const sanitized = { ...environment };
  for (const key of ["ANSI_COLORS_DISABLED", "NO_COLOR", "NODE_DISABLE_COLORS"]) {
    delete sanitized[key];
  }
  return sanitized;
}
