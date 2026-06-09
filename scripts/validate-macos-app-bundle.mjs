import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export class MacosAppBundleValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MacosAppBundleValidationError";
  }
}

/**
 * CDXC:LocalStartReleaseParity 2026-06-09-09:07:
 * Local production starts should validate the same bundled runtime shape as release builds without paying notarization or DMG costs. Keep app-bundle resource checks in one module so `bun run start` and release automation reject stale cross-architecture Web resources before the app opens.
 */
export async function validateMacosAppBundle({ appPath, arch, appName = "Ghostex" }) {
  if (!appPath || !arch) {
    throw new MacosAppBundleValidationError("validateMacosAppBundle requires appPath and arch.");
  }
  if (!existsSync(appPath)) {
    throw new MacosAppBundleValidationError(`${arch} app is missing: ${appPath}`);
  }

  const resourcesRoot = path.join(appPath, "Contents", "Resources", "Web");
  const expectedNodePtyPrebuild = expectedNodePtyPrebuildForArch(arch);
  await assertMachOContainsArch(path.join(appPath, "Contents", "MacOS", appName), arch);
  await assertMachOContainsArch(
    path.join(appPath, "Contents", "Frameworks", "Chromium Embedded Framework.framework", "Chromium Embedded Framework"),
    arch,
  );
  const codeServerNode = await validateBundledCodeServerRuntime({ appPath, arch, resourcesRoot });
  await validateBundledResourceShape({ arch, resourcesRoot, expectedNodePtyPrebuild });
  await validateBundledT3Runtime({ arch, codeServerNode, resourcesRoot, expectedNodePtyPrebuild });
}

function expectedNodePtyPrebuildForArch(arch) {
  if (arch === "arm64") {
    return "darwin-arm64";
  }
  if (arch === "x86_64") {
    return "darwin-x64";
  }
  throw new MacosAppBundleValidationError(`Unsupported macOS app architecture: ${arch}`);
}

async function validateBundledCodeServerRuntime({ appPath, arch, resourcesRoot }) {
  const codeServerRoot = path.join(resourcesRoot, "code-server");
  const codeServerNode = path.join(codeServerRoot, "lib", "node");
  const codeServerEntrypoint = path.join(codeServerRoot, "out", "node", "entry.js");
  const codeServerVscodeEntrypoint = path.join(codeServerRoot, "lib", "vscode", "out", "server-main.js");
  const codeServerVscodeRipgrep = path.join(codeServerRoot, "lib", "vscode", "node_modules", "@vscode", "ripgrep", "bin", "rg");
  const obsoleteWebNode = path.join(resourcesRoot, "bin", "node");
  const gxserverRuntimePath = path.join(resourcesRoot, "gxserver", "native-runtime.json");

  /*
   CDXC:CodeServerRuntime 2026-06-09-17:06:
   Embedded VS Code search shells out to @vscode/ripgrep/bin/rg. Treat that binary as a required app resource, not an optional npm postinstall side effect, so local starts and releases fail before users see ENOENT in the search panel.
   */
  await assertRequiredPaths(arch, "bundled code-server runtime resource", [
    codeServerRoot,
    codeServerNode,
    codeServerEntrypoint,
    codeServerVscodeEntrypoint,
    codeServerVscodeRipgrep,
    gxserverRuntimePath,
  ]);
  if (existsSync(obsoleteWebNode)) {
    throw new MacosAppBundleValidationError(
      `${arch} app still bundles duplicate Node at ${obsoleteWebNode}; gxserver must reuse Web/code-server/lib/node.`,
    );
  }
  await assertMachOContainsArch(codeServerNode, arch);
  const nodeMajor = runFile(codeServerNode, ["-p", 'process.versions.node.split(".")[0]']).stdout.trim();
  if (nodeMajor !== "22") {
    throw new MacosAppBundleValidationError(`${arch} bundled code-server Node must be major 22, got ${nodeMajor}.`);
  }
  await assertMachOContainsArch(codeServerVscodeRipgrep, arch);
  runFile(codeServerVscodeRipgrep, ["--version"], { label: "VS Code ripgrep --version smoke test" });

  const nativeRuntime = JSON.parse(await readFile(gxserverRuntimePath, "utf8"));
  if (nativeRuntime.nodeMajor !== 22 || !nativeRuntime.nativeModules?.includes?.("better-sqlite3")) {
    throw new MacosAppBundleValidationError(
      `${arch} gxserver native-runtime.json must target bundled Node 22 and include better-sqlite3.`,
    );
  }
  await assertNativeModuleLoads(
    codeServerNode,
    path.join(resourcesRoot, "gxserver", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    "gxserver better-sqlite3",
  );
  return codeServerNode;
}

async function validateBundledResourceShape({ arch, resourcesRoot, expectedNodePtyPrebuild }) {
  const sharedBd = path.join(resourcesRoot, "bin", "bd");
  const gxserverBd = path.join(resourcesRoot, "gxserver", "bin", "bd");

  await assertRequiredPaths(arch, "shared Beads binary", [sharedBd]);
  await assertMachOContainsArch(sharedBd, arch);
  if (existsSync(gxserverBd)) {
    const gxserverBdStat = await lstat(gxserverBd);
    if (gxserverBdStat.size > 1024 * 1024) {
      throw new MacosAppBundleValidationError(
        `${arch} app duplicates the large Beads binary at Web/gxserver/bin/bd; gxserver should use the shared Web/bin/bd launcher/resource.`,
      );
    }
  }

  await assertOnlyExpectedNodePtyPrebuilds(
    arch,
    path.join(resourcesRoot, "code-server", "lib", "vscode", "node_modules", "node-pty", "prebuilds"),
    expectedNodePtyPrebuild,
  );
}

async function validateBundledT3Runtime({ arch, codeServerNode, resourcesRoot, expectedNodePtyPrebuild }) {
  const t3Root = path.join(resourcesRoot, "t3code-server");
  const t3Entrypoint = path.join(t3Root, "dist", "bin.mjs");
  const t3PackageJson = path.join(t3Root, "package.json");
  const t3NodeModules = path.join(t3Root, "node_modules");
  const t3NodePtyRoot = path.join(t3NodeModules, "node-pty");

  await assertRequiredPaths(arch, "bundled T3 Code runtime resource", [
    t3Root,
    t3Entrypoint,
    t3PackageJson,
    t3NodeModules,
    t3NodePtyRoot,
  ]);
  await assertOnlyExpectedNodePtyPrebuilds(
    arch,
    path.join(t3NodePtyRoot, "prebuilds"),
    expectedNodePtyPrebuild,
  );
  runFile(codeServerNode, [t3Entrypoint, "--help"], { cwd: t3Root, label: "T3 Code --help smoke test" });
  await assertNativeModuleLoads(codeServerNode, t3NodePtyRoot, "T3 Code node-pty");

  const t3SourceMap = findFirstFileWithExtension(t3Root, ".map");
  if (t3SourceMap) {
    throw new MacosAppBundleValidationError(`${arch} app still bundles T3 Code source map: ${t3SourceMap}`);
  }
}

async function assertRequiredPaths(arch, label, requiredPaths) {
  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new MacosAppBundleValidationError(`${arch} app is missing ${label}: ${requiredPath}`);
    }
  }
}

async function assertMachOContainsArch(binaryPath, arch) {
  await assertRequiredPaths(arch, "architecture-checked binary", [binaryPath]);
  const archs = runFile("/usr/bin/lipo", ["-archs", binaryPath], { label: `lipo -archs ${binaryPath}` }).stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!archs.includes(arch)) {
    throw new MacosAppBundleValidationError(`${binaryPath} does not contain required ${arch} slice. Found: ${archs.join(", ") || "none"}.`);
  }
}

async function assertNativeModuleLoads(nodePath, modulePath, label) {
  await assertRequiredPaths("macOS", `${label} native module`, [modulePath]);
  runFile(
    nodePath,
    [
      "-e",
      "try { require(process.argv[1]); } catch (error) { console.error(error && error.stack ? error.stack : String(error)); process.exit(1); }",
      modulePath,
    ],
    { label: `${label} load preflight` },
  );
}

async function assertOnlyExpectedNodePtyPrebuilds(arch, prebuildsRoot, expectedNodePtyPrebuild) {
  if (!existsSync(prebuildsRoot)) {
    throw new MacosAppBundleValidationError(
      `${arch} app is missing node-pty prebuild directory ${expectedNodePtyPrebuild} under ${prebuildsRoot}.`,
    );
  }
  const entries = await readdir(prebuildsRoot, { withFileTypes: true });
  const platformDirs = entries.filter((candidate) => candidate.isDirectory()).map((candidate) => candidate.name);
  const unexpected = platformDirs.filter((platformDir) => platformDir !== expectedNodePtyPrebuild);
  if (unexpected.length > 0) {
    throw new MacosAppBundleValidationError(
      `${arch} app bundles wrong-arch node-pty prebuilds under ${prebuildsRoot}: ${unexpected.join(", ")}. Expected only ${expectedNodePtyPrebuild}.`,
    );
  }
  if (!platformDirs.includes(expectedNodePtyPrebuild)) {
    throw new MacosAppBundleValidationError(
      `${arch} app is missing expected node-pty prebuild ${expectedNodePtyPrebuild} under ${prebuildsRoot}.`,
    );
  }
}

function findFirstFileWithExtension(root, extension) {
  if (!existsSync(root)) {
    return undefined;
  }
  /*
   CDXC:LocalStartReleaseParity 2026-06-09-09:07:
   Local starts validate the installed T3 bundle before opening Ghostex, so source-map checks must stay fast even with a large production node_modules tree. Use the system find implementation instead of JS-recursing every dependency file.
   */
  const result = spawnSync("/usr/bin/find", [root, "-type", "f", "-name", `*${extension}`, "-print", "-quit"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("\n");
    throw new MacosAppBundleValidationError(`T3 Code source-map scan failed.${output ? `\n${output}` : ""}`);
  }
  return result.stdout.split(/\r?\n/).find(Boolean);
}

function runFile(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join("\n");
    throw new MacosAppBundleValidationError(
      `${options.label ?? command} failed with status ${result.status}.${output ? `\n${output}` : ""}`,
    );
  }
  return result;
}
