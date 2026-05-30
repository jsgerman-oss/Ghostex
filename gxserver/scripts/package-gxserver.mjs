#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gxserverRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(gxserverRoot, "..");
const distRoot = path.join(gxserverRoot, "dist");
const defaultPackageDir = path.join(distRoot, "server-package");
const defaultHomebrewDir = path.join(distRoot, "homebrew");
const executableMode = 0o755;

const args = parseArgs(process.argv.slice(2));
const packageDir = path.resolve(args.packageDir ?? defaultPackageDir);
const homebrewDir = path.resolve(args.homebrewDir ?? defaultHomebrewDir);

/*
CDXC:GxserverPackaging 2026-05-30-15:49:
App-bundled gxserver and standalone/server-only gxserver must be the same compiled daemon package. The package stage lives under gxserver/dist, uses system Node through a launcher, bundles pinned zmx/zehn artifacts, and never includes Beads or a private Node runtime.
*/
await assertInsideDist(packageDir, "server package");
if (args.generateHomebrew) {
  await assertInsideDist(homebrewDir, "Homebrew helper");
}

await assertBuilt();
const zmxBin = await resolveToolBin("zmx", args.zmxBin);
const zehnBin = await resolveToolBin("zehn", args.zehnBin);

await rm(packageDir, { force: true, recursive: true });
await mkdir(packageDir, { recursive: true });
await cp(path.join(distRoot, "src"), path.join(packageDir, "dist", "src"), { recursive: true });
await cp(path.join(distRoot, "protocol"), path.join(packageDir, "dist", "protocol"), { recursive: true });
await cp(path.join(gxserverRoot, "package.json"), path.join(packageDir, "package.json"));
await cp(path.join(gxserverRoot, "package-lock.json"), path.join(packageDir, "package-lock.json"));

await mkdir(path.join(packageDir, "bin"), { recursive: true });
await writeLauncher(path.join(packageDir, "bin", "gxserver"));
await cp(zmxBin, path.join(packageDir, "bin", "zmx"));
await cp(zehnBin, path.join(packageDir, "bin", "zehn"));
await chmod(path.join(packageDir, "bin", "gxserver"), executableMode);
await chmod(path.join(packageDir, "bin", "zmx"), executableMode);
await chmod(path.join(packageDir, "bin", "zehn"), executableMode);

await writeFile(path.join(packageDir, "README.md"), serverReadme(), "utf8");

if (args.includeNodeModules) {
  await copyProductionNodeModules(packageDir);
}

const tarballPath = await createTarball(packageDir);
if (args.generateHomebrew) {
  await mkdir(homebrewDir, { recursive: true });
  const sha256 = await sha256File(tarballPath);
  await writeFile(
    path.join(homebrewDir, "gxserver.rb"),
    homebrewFormula({
      sha256,
      url: args.homebrewUrl ?? `file://${tarballPath}`,
      version: await packageVersion(),
    }),
    "utf8",
  );
}

console.log(`Packaged gxserver at ${packageDir}`);

function parseArgs(argv) {
  const parsed = {
    generateHomebrew: false,
    includeNodeModules: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--generate-homebrew") {
      parsed.generateHomebrew = true;
    } else if (arg === "--include-node-modules") {
      parsed.includeNodeModules = true;
    } else if (arg === "--package-dir") {
      parsed.packageDir = requiredValue(argv, ++index, arg);
    } else if (arg === "--homebrew-dir") {
      parsed.homebrewDir = requiredValue(argv, ++index, arg);
    } else if (arg === "--homebrew-url") {
      parsed.homebrewUrl = requiredValue(argv, ++index, arg);
    } else if (arg === "--zmx-bin") {
      parsed.zmxBin = requiredValue(argv, ++index, arg);
    } else if (arg === "--zehn-bin") {
      parsed.zehnBin = requiredValue(argv, ++index, arg);
    } else {
      throw new Error(`Unknown package-gxserver option: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function assertInsideDist(candidatePath, label) {
  const relative = path.relative(distRoot, candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`${label} output must be under ${distRoot}.`);
  }
}

async function assertBuilt() {
  await assertFile(path.join(distRoot, "src", "cli.js"), "Run `npm run build` in gxserver/ before packaging.");
  await assertFile(path.join(distRoot, "protocol", "index.js"), "Run `npm run build` in gxserver/ before packaging.");
}

async function resolveToolBin(toolName, explicitPath) {
  const candidates = [
    explicitPath,
    path.join(repoRoot, toolName, "zig-out", "bin", toolName),
    path.join(distRoot, "bin", toolName),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) {
      return path.resolve(candidate);
    }
  }
  const guidance =
    toolName === "zmx"
      ? "Build the pinned zmx submodule first: `git submodule update --init --recursive zmx && cd zmx && zig build -Doptimize=ReleaseSafe`."
      : "Build the pinned zehn submodule first: `git submodule update --init zehn && cd zehn && zig build -Doptimize=ReleaseFast`.";
  throw new Error(`Missing bundled ${toolName} artifact. ${guidance} PATH ${toolName} is intentionally ignored.`);
}

async function isExecutableFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return false;
    }
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertFile(filePath, guidance) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      return;
    }
  } catch {
    // Handled below.
  }
  throw new Error(`${filePath} is missing. ${guidance}`);
}

async function writeLauncher(launcherPath) {
  await writeFile(
    launcherPath,
    `#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="\${NODE:-node}"
exec "$NODE_BIN" "$HERE/../dist/src/cli.js" "$@"
`,
    "utf8",
  );
}

async function copyProductionNodeModules(targetDir) {
  const source = path.join(gxserverRoot, "node_modules");
  await assertDirectory(source, "Run `npm install` in gxserver/ before packaging app resources.");
  await cp(source, path.join(targetDir, "node_modules"), {
    recursive: true,
    /*
    CDXC:GxserverPackaging 2026-05-30-16:47:
    macOS app signing rejects node_modules/.bin symlinks that point outside the app bundle. The embedded gxserver runtime executes its own launcher and production libraries only, so exclude development command shims from app resources instead of copying invalid bundle links.
    */
    filter: (entry) =>
      !entry.includes(`${path.sep}.cache${path.sep}`) &&
      path.basename(entry) !== ".bin" &&
      !entry.includes(`${path.sep}.bin${path.sep}`),
  });
  const prune = spawnSync("npm", ["prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: targetDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (prune.status !== 0) {
    throw new Error(`Failed to prune gxserver production node_modules:\n${prune.stderr || prune.stdout}`);
  }
}

async function assertDirectory(dirPath, guidance) {
  try {
    const dirStat = await stat(dirPath);
    if (dirStat.isDirectory()) {
      return;
    }
  } catch {
    // Handled below.
  }
  throw new Error(`${dirPath} is missing. ${guidance}`);
}

async function createTarball(sourceDir) {
  const version = await packageVersion();
  const tarballPath = path.join(distRoot, `gxserver-${version}-server.tar.gz`);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gxserver-package-"));
  try {
    const archiveRoot = path.join(tempRoot, `gxserver-${version}`);
    await cp(sourceDir, archiveRoot, { recursive: true });
    const tar = spawnSync("tar", ["-czf", tarballPath, "-C", tempRoot, path.basename(archiveRoot)], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (tar.status !== 0) {
      throw new Error(`Failed to create gxserver tarball:\n${tar.stderr || tar.stdout}`);
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
  return tarballPath;
}

async function packageVersion() {
  const manifest = JSON.parse(await readFile(path.join(gxserverRoot, "package.json"), "utf8"));
  return manifest.version ?? "0.0.0";
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function homebrewFormula({ sha256, url, version }) {
  return `class Gxserver < Formula
  desc "Ghostex gxserver daemon for local and remote/headless project sessions"
  homepage "https://github.com/maddada/Ghostex"
  url "${url}"
  sha256 "${sha256}"
  license "MIT"
  version "${version}"

  depends_on "node@22"

  def install
    libexec.install Dir["*"]
    system Formula["node@22"].opt_bin/"npm", "ci", "--omit=dev", "--no-audit", "--no-fund", chdir: libexec
    (bin/"gxserver").write <<~EOS
      #!/usr/bin/env bash
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/dist/src/cli.js" "$@"
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gxserver --version")
  end
end
`;
}

function serverReadme() {
  return `# gxserver server package

gxserver is the Ghostex daemon used by the desktop app and server-only remote installs.

## Runtime dependency

Install Node.js 22 LTS or newer from https://nodejs.org/en/download or through your system package manager. This package does not bundle, auto-install, or fall back to a private Node runtime.

## Commands

When installing from this tarball without Homebrew, install production JavaScript dependencies first:

\`\`\`sh
npm ci --omit=dev --no-audit --no-fund
\`\`\`

- \`bin/gxserver\`: run gxserver in the foreground.
- \`bin/gxserver start\`: start gxserver in the background.
- \`bin/gxserver status --json\`: check runtime state for health/status automation.
- \`bin/gxserver stop\`: stop only the gxserver control plane; zmx sessions are not killed.

The package includes Ghostex's pinned zmx and zehn artifacts in \`bin/\`. Beads is not bundled; install \`bd\` separately when Project board operations are needed.
`;
}
