#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gxserverRoot = path.resolve(scriptDir, "..");
const distRoot = path.join(gxserverRoot, "dist");
const packageDir = path.resolve(process.argv.includes("--package-dir") ? process.argv[process.argv.indexOf("--package-dir") + 1] : path.join(distRoot, "server-package"));
const formulaPath = path.join(distRoot, "homebrew", "gxserver.rb");
const appNativeNodeMajor = 22;

/*
CDXC:GxserverPackagingChecks 2026-05-30-15:49:
Packaging checks must prove the server-only artifact is headless, uses system Node, contains the expected compiled daemon plus pinned zmx/zehn artifacts, and does not accidentally depend on macOS UI bundle resources.
*/
await assertInsideDist(packageDir, "server package");
await assertFile(path.join(packageDir, "dist", "src", "cli.js"));
await assertFile(path.join(packageDir, "dist", "protocol", "index.js"));
await assertFile(path.join(packageDir, "build-identity.json"));
await assertFile(path.join(packageDir, "package.json"));
await assertFile(path.join(packageDir, "package-lock.json"));
await assertExecutable(path.join(packageDir, "bin", "gxserver"));
await assertExecutable(path.join(packageDir, "bin", "zmx"));
await assertExecutable(path.join(packageDir, "bin", "zehn"));
await assertNoBundledNodeRuntime(packageDir);
await assertNoMacosUiDependency(packageDir);
const packageVersion = await assertPackageManifest(path.join(packageDir, "package.json"));
await assertBuildIdentity(path.join(packageDir, "build-identity.json"), packageVersion);
await assertNativeRuntimeContract(packageDir);

if (await exists(formulaPath)) {
  await assertHomebrewFormula(formulaPath);
}

console.log(`gxserver package checks passed for ${packageDir}`);

async function assertInsideDist(candidatePath, label) {
  const relative = path.relative(distRoot, candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`${label} output must be under ${distRoot}.`);
  }
}

async function assertFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Expected file: ${filePath}`);
  }
}

async function assertExecutable(filePath) {
  await assertFile(filePath);
  await access(filePath, fsConstants.X_OK);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertPackageManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.engines?.node || !String(manifest.engines.node).includes(">=22")) {
    throw new Error("gxserver package manifest must declare Node >=22.");
  }
  return manifest.version ?? "0.0.0";
}

async function assertBuildIdentity(identityPath, version) {
  const identity = JSON.parse(await readFile(identityPath, "utf8"));
  if (
    identity.packageVersion !== version ||
    typeof identity.fingerprint !== "string" ||
    !identity.fingerprint.startsWith("sha256:") ||
    identity.buildIdentity !== `gxserver:${version}:${identity.fingerprint}`
  ) {
    throw new Error("gxserver package build identity must match the package version and sha256 fingerprint.");
  }
}

async function assertNativeRuntimeContract(root) {
  const hasBundledBetterSqlite = await exists(path.join(root, "node_modules", "better-sqlite3"));
  if (!hasBundledBetterSqlite) {
    return;
  }
  /*
  CDXC:GxserverPackagingChecks 2026-06-06-22:00:
  App packages include prebuilt better-sqlite3, so package checks must fail when the staged artifact lacks the Node ABI metadata macOS uses to choose a matching user-installed Node runtime.
  */
  const runtimePath = path.join(root, "native-runtime.json");
  await assertFile(runtimePath);
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  if (
    runtime.nodeMajor !== appNativeNodeMajor ||
    typeof runtime.nodeModuleVersion !== "string" ||
    runtime.nodeModuleVersion.length === 0 ||
    typeof runtime.nodeVersion !== "string" ||
    runtime.nodeVersion.length === 0 ||
    !Array.isArray(runtime.nativeModules) ||
    !runtime.nativeModules.includes("better-sqlite3")
  ) {
    throw new Error("App-bundled gxserver native runtime metadata must target Node 22 and include better-sqlite3.");
  }
}

async function assertHomebrewFormula(homebrewFormulaPath) {
  const formula = await readFile(homebrewFormulaPath, "utf8");
  if (!formula.includes('depends_on "node@22"')) {
    throw new Error("Homebrew gxserver formula must declare node@22.");
  }
  if (!formula.includes('"npm", "ci", "--omit=dev"')) {
    throw new Error("Homebrew gxserver formula must install production npm dependencies with system Node.");
  }
  for (const forbidden of ["cask ", ".app", "AppKit", "WebKit", "xcodebuild"]) {
    if (formula.includes(forbidden)) {
      throw new Error(`Homebrew gxserver formula must not depend on macOS UI packaging: ${forbidden}`);
    }
  }
}

async function assertNoBundledNodeRuntime(root) {
  for await (const entry of walk(root)) {
    const base = path.basename(entry);
    if (base === "node" || base === "node.exe") {
      throw new Error(`gxserver server package must use system Node and must not bundle a Node runtime: ${entry}`);
    }
  }
}

async function assertNoMacosUiDependency(root) {
  const forbiddenPathParts = new Set(["Contents", "MacOS", "Frameworks", "native", "ghostexHost"]);
  for await (const entry of walk(root)) {
    const parts = entry.split(path.sep);
    if (parts.some((part) => forbiddenPathParts.has(part)) || entry.endsWith(".app")) {
      throw new Error(`gxserver server-only package must not include macOS UI bundle content: ${entry}`);
    }
  }
}

async function* walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      yield entryPath;
    }
  }
}
