#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

const config = {
  githubRepo: "maddada/Ghostex",
  tapRepo: "https://github.com/maddada/homebrew-tap.git",
  caskPath: "Casks/ghostex.rb",
  caskName: "ghostex",
  appName: "Ghostex",
  stagedAppName: "ghostex.app",
  bundleId: "com.madda.ghostex.host",
  signingIdentity: "Developer ID Application: Mohamad Youssef (KTKP595G3B)",
  teamId: "KTKP595G3B",
  notaryProfile: "notarytool-profile",
  sparklePublicKey: "AGWDPeMqfhmbjt8Pbk+VTC9fDfXAYq+cZoLGCYuGn70=",
  armFeed: "appcast.xml",
  intelFeed: "appcast-x86_64.xml",
  installCommand: "brew install --cask maddada/tap/ghostex",
};

const architectures = [
  {
    arch: "arm64",
    brewArch: "arm",
    feed: config.armFeed,
    feedUrl: "https://raw.githubusercontent.com/maddada/Ghostex/main/appcast.xml",
  },
  {
    arch: "x86_64",
    brewArch: "intel",
    feed: config.intelFeed,
    feedUrl: "https://raw.githubusercontent.com/maddada/Ghostex/main/appcast-x86_64.xml",
  },
];

class ReleaseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseError";
  }
}

function usage() {
  return `
Usage:
  bun run release:local -- <version> [options]
  node scripts/release-ghostex.mjs <version> [options]

Options:
  --with-tests        Run bun run test before building.
  --skip-typecheck   Skip bun run typecheck.
  --skip-brew-fetch  Skip final brew fetch checks.
  --no-push          Commit release metadata but do not push, tag, publish GitHub, or update Homebrew.
  --help             Show this help.

Expected state:
  Run this only after the agent/user has split-committed feature changes,
  updated CHANGELOG.md and AllFeatures.md, and pushed main.
`;
}

function parseArgs(argv) {
  const options = {
    withTests: false,
    skipTypecheck: false,
    skipBrewFetch: false,
    noPush: false,
  };
  const positional = [];

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--with-tests") {
      options.withTests = true;
    } else if (arg === "--skip-typecheck") {
      options.skipTypecheck = true;
    } else if (arg === "--skip-brew-fetch") {
      options.skipBrewFetch = true;
    } else if (arg === "--no-push") {
      options.noPush = true;
    } else if (arg.startsWith("-")) {
      throw new ReleaseError(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (options.help) {
    return { ...options, version: null };
  }

  if (positional.length !== 1) {
    throw new ReleaseError("Pass exactly one version, for example 3.9.2.");
  }

  const version = positional[0];
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new ReleaseError(`Version must be semver-like x.y.z. Received: ${version}`);
  }

  return { ...options, version };
}

function releaseBuildVersion(version) {
  const [major, minor, patch] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major * 10000 + minor * 100 + patch;
}

function timestampForComment(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function run(command, options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const env = { ...process.env, ...(options.env ?? {}) };
  const stdio = options.stdio ?? "inherit";

  console.log(`$ ${command}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio,
    });

    let stdout = "";
    let stderr = "";

    if (stdio === "pipe") {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const detail = stderr || stdout;
        reject(new ReleaseError(`Command failed (${code}): ${command}${detail ? `\n${detail}` : ""}`));
      }
    });
  });
}

async function capture(command, options = {}) {
  const result = await run(command, { ...options, stdio: "pipe" });
  return result.stdout.trim();
}

async function ensureCleanWorktree() {
  const status = await capture("git status --porcelain --untracked-files=all");
  if (status) {
    throw new ReleaseError(
      [
        "Working tree is not clean. Commit the agent/user changes before running the release script.",
        "",
        status,
      ].join("\n"),
    );
  }
}

async function ensureMainSynced() {
  const branch = await capture("git branch --show-current");
  if (branch !== "main") {
    throw new ReleaseError(`Release script must run on main. Current branch: ${branch}`);
  }

  await run("git fetch origin main --tags");
  const head = await capture("git rev-parse HEAD");
  const originMain = await capture("git rev-parse origin/main");
  if (head !== originMain) {
    throw new ReleaseError("Local main must match origin/main before the script creates the release commit.");
  }
}

async function ensureTagMissing(version) {
  const localTag = await capture(`git tag --list ${shellQuote(`v${version}`)}`);
  const remoteTag = await capture(`git ls-remote --tags origin ${shellQuote(`v${version}*`)}`);
  if (localTag || remoteTag) {
    throw new ReleaseError(`Tag v${version} already exists locally or remotely.`);
  }
}

async function ensureReleaseMissing(version) {
  const command = `gh release view ${shellQuote(`v${version}`)} --repo ${shellQuote(config.githubRepo)}`;
  try {
    await capture(command);
  } catch {
    return;
  }
  throw new ReleaseError(`GitHub release v${version} already exists.`);
}

async function latestSparkleVersion() {
  let maxVersion = 0;
  for (const feed of [config.armFeed, config.intelFeed]) {
    const xml = await readFile(path.join(repoRoot, feed), "utf8");
    for (const match of xml.matchAll(/<sparkle:version>(\d+)<\/sparkle:version>/g)) {
      maxVersion = Math.max(maxVersion, Number.parseInt(match[1], 10));
    }
  }
  return maxVersion;
}

async function findSparkleBinDir() {
  const command = [
    "find",
    shellQuote(path.join(repoRoot, "build/SourcePackages/artifacts/sparkle")),
    shellQuote("/tmp/ghostex-xcodebuild/SourcePackages/artifacts/sparkle"),
    shellQuote(path.join(process.env.HOME ?? "", "Library/Developer/Xcode/DerivedData")),
    "-path '*/Sparkle/bin/generate_appcast' -print -quit 2>/dev/null | xargs dirname",
  ].join(" ");
  const sparkleBinDir = await capture(command);
  if (!sparkleBinDir) {
    throw new ReleaseError("Could not find Sparkle generate_appcast. Build once so SwiftPM downloads Sparkle.");
  }
  for (const tool of ["generate_appcast", "sign_update", "generate_keys"]) {
    const toolPath = path.join(sparkleBinDir, tool);
    if (!existsSync(toolPath)) {
      throw new ReleaseError(`Missing Sparkle tool: ${toolPath}`);
    }
  }
  return sparkleBinDir;
}

async function findAndVerifySparkleBinDir() {
  const sparkleBinDir = await findSparkleBinDir();
  const publicKey = await capture(`${shellQuote(path.join(sparkleBinDir, "generate_keys"))} -p`);
  if (!publicKey.includes(config.sparklePublicKey)) {
    throw new ReleaseError("Sparkle public key does not match the expected app SUPublicEDKey.");
  }
  return sparkleBinDir;
}

async function preflight(version, buildVersion, options) {
  logStep("Preflight");
  await ensureCleanWorktree();
  await ensureMainSynced();
  await ensureTagMissing(version);
  if (!options.noPush) {
    await ensureReleaseMissing(version);
  }

  const previousBuild = await latestSparkleVersion();
  if (buildVersion <= previousBuild) {
    throw new ReleaseError(
      `Build version ${buildVersion} must be greater than the latest Sparkle build ${previousBuild}.`,
    );
  }

  await run("gh auth status");
  await run(`security find-identity -v -p codesigning | rg ${shellQuote(config.signingIdentity)}`);
  await run(`xcrun notarytool history --keychain-profile ${shellQuote(config.notaryProfile)} | head -n 8`);

  if (!options.skipTypecheck) {
    await run("bun run typecheck");
  }
  if (options.withTests) {
    await run("bun run test");
  }

  return {};
}

async function updatePackageJson(version) {
  const packagePath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.version = version;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function updateProjectYml(version, buildVersion) {
  const projectPath = path.join(repoRoot, "native/macos/ghostexHost/project.yml");
  const timestamp = timestampForComment();
  let text = await readFile(projectPath, "utf8");

  /*
   CDXC:ReleaseAutomation 2026-05-23-03:27:
   The local release script owns only deterministic release metadata after the agent has already split feature commits and written user-facing notes.
   Keep Sparkle's numeric build value monotonic and update the adjacent CDXC release comments so future agents can audit why the version fields changed.
   */
  text = text
    .replace(/# CDXC:AutoUpdate \d{4}-\d{2}-\d{2}-\d{2}:\d{2}:/, `# CDXC:AutoUpdate ${timestamp}:`)
    .replace(/CURRENT_PROJECT_VERSION:\s*\d+/, `CURRENT_PROJECT_VERSION: ${buildVersion}`)
    .replace(
      /# CDXC:Distribution \d{4}-\d{2}-\d{2}-\d{2}:\d{2}: .*release v[\d.]+ must/,
      `# CDXC:Distribution ${timestamp}: GitHub and Sparkle release v${version} must`,
    )
    .replace(/MARKETING_VERSION:\s*"[^"]+"/, `MARKETING_VERSION: "${version}"`);

  await writeFile(projectPath, text);
}

async function bumpReleaseMetadata(version, buildVersion) {
  logStep(`Bump release metadata to ${version} (${buildVersion})`);
  await updatePackageJson(version);
  await updateProjectYml(version, buildVersion);
  await run(`rg 'CURRENT_PROJECT_VERSION: ${buildVersion}|MARKETING_VERSION: "${version}"' native/macos/ghostexHost/project.yml -g '!node_modules/**' -g '!dist/**' -g '!build/**' -g '!coverage/**' -g '!.git/**'`);
}

async function buildArch(version, entry) {
  const derivedData = path.join(repoRoot, "build", entry.arch);
  const env = {
    CONFIGURATION: "Release",
    GHOSTEX_MACOS_ARCH: entry.arch,
    DERIVED_DATA: derivedData,
    GHOSTEX_CODE_SIGN_TIMESTAMP_FLAG: "--timestamp",
  };
  if (entry.arch === "x86_64") {
    env.GHOSTEX_SPARKLE_FEED_URL = entry.feedUrl;
  }

  logStep(`Build ${entry.arch}`);
  await run("native/macos/ghostexHost/build-ghostex-host.sh", { env });

  const appPathFile = `/tmp/ghostex-${version}-${entry.arch}-app-path`;
  const appPath = await readFile(appPathFile, "utf8").then((value) => value.trim());
  if (!existsSync(appPath)) {
    throw new ReleaseError(`Build did not produce app path for ${entry.arch}: ${appPath}`);
  }
  return { ...entry, appPath };
}

async function validateBuiltApp(version, buildVersion, entry) {
  logStep(`Validate built ${entry.arch} app`);
  const infoCommand = [
    `plutil -p ${shellQuote(path.join(entry.appPath, "Contents/Info.plist"))}`,
    "|",
    "rg 'CFBundleShortVersionString|CFBundleVersion|CFBundleIdentifier|SUFeedURL|SUPublicEDKey|GHOSTEX'",
  ].join(" ");
  await run(infoCommand);
  await run(`codesign -dv --verbose=4 ${shellQuote(entry.appPath)} 2>&1 | rg 'Authority|TeamIdentifier|Identifier|Timestamp|Runtime|Format'`);
  await run(`codesign --verify --deep --strict --verbose=2 ${shellQuote(entry.appPath)}`);
  await run(`lipo -archs ${shellQuote(path.join(entry.appPath, "Contents/MacOS", config.appName))} | grep -Fx ${shellQuote(entry.arch)}`);
  await run(`lipo -archs ${shellQuote(path.join(entry.appPath, "Contents/Frameworks/Chromium Embedded Framework.framework/Chromium Embedded Framework"))} | grep -Fx ${shellQuote(entry.arch)}`);

  const info = await capture(`plutil -extract CFBundleShortVersionString raw ${shellQuote(path.join(entry.appPath, "Contents/Info.plist"))}`);
  const bundleVersion = await capture(`plutil -extract CFBundleVersion raw ${shellQuote(path.join(entry.appPath, "Contents/Info.plist"))}`);
  const feedUrl = await capture(`plutil -extract SUFeedURL raw ${shellQuote(path.join(entry.appPath, "Contents/Info.plist"))}`);
  const publicKey = await capture(`plutil -extract SUPublicEDKey raw ${shellQuote(path.join(entry.appPath, "Contents/Info.plist"))}`);

  if (info !== version || bundleVersion !== String(buildVersion)) {
    throw new ReleaseError(`${entry.arch} Info.plist version mismatch: ${info} (${bundleVersion})`);
  }
  if (feedUrl !== entry.feedUrl) {
    throw new ReleaseError(`${entry.arch} SUFeedURL mismatch: ${feedUrl}`);
  }
  if (publicKey !== config.sparklePublicKey) {
    throw new ReleaseError(`${entry.arch} SUPublicEDKey mismatch.`);
  }
}

async function packageAndNotarize(version, artifactDir, entry) {
  logStep(`Package and notarize ${entry.arch}`);
  const stagingDir = await mkdtemp(path.join(tmpdir(), `ghostex-${version}-${entry.arch}-stage-`));
  const finalDmg = path.join(artifactDir, `ghostex-${version}-${entry.arch}.dmg`);
  const stagedApp = path.join(stagingDir, config.stagedAppName);

  await run(`cp -R ${shellQuote(entry.appPath)} ${shellQuote(stagedApp)}`);
  await run(`ln -s /Applications ${shellQuote(path.join(stagingDir, "Applications"))}`);
  await run(`hdiutil create -volname ghostex -srcfolder ${shellQuote(stagingDir)} -format UDZO ${shellQuote(finalDmg)}`);
  const preStapleSha = await capture(`shasum -a 256 ${shellQuote(finalDmg)} | awk '{print $1}'`);

  const notaryLogPath = path.join(artifactDir, `ghostex-${version}-${entry.arch}-notary.log`);
  const notaryOutput = await capture(
    `xcrun notarytool submit ${shellQuote(finalDmg)} --keychain-profile ${shellQuote(config.notaryProfile)} --wait | tee ${shellQuote(notaryLogPath)}`,
  );
  const submissionId = notaryOutput.match(/id:\s*([0-9a-f-]+)/)?.[1] ?? "unknown";
  const status = notaryOutput.match(/status:\s*([A-Za-z]+)/)?.[1] ?? "unknown";
  if (status !== "Accepted") {
    throw new ReleaseError(`${entry.arch} notarization did not finish Accepted. Status: ${status}`);
  }

  await run(`xcrun stapler staple ${shellQuote(finalDmg)}`);
  await run(`xcrun stapler validate ${shellQuote(finalDmg)}`);
  const sha256 = await capture(`shasum -a 256 ${shellQuote(finalDmg)} | awk '{print $1}'`);
  await writeFile(`/tmp/ghostex-${version.replaceAll(".", "")}-${entry.arch}-sha256`, `${sha256}\n`);
  await writeFile(`/tmp/ghostex-${version.replaceAll(".", "")}-${entry.arch}-final-dmg`, `${finalDmg}\n`);
  await rm(stagingDir, { recursive: true, force: true });

  return {
    ...entry,
    finalDmg,
    preStapleSha,
    sha256,
    notaryLogPath,
    notarySubmissionId: submissionId,
    notaryStatus: status,
  };
}

async function validateMountedDmg(version, buildVersion, entry) {
  logStep(`Validate mounted ${entry.arch} DMG`);
  const attachOutput = await capture(`hdiutil attach -nobrowse -readonly ${shellQuote(entry.finalDmg)}`);
  const lines = attachOutput.split("\n").filter(Boolean);
  const mountPoint = lines.at(-1)?.split(/\t+/).at(-1)?.trim();
  if (!mountPoint || !mountPoint.startsWith("/Volumes/")) {
    throw new ReleaseError(`Could not parse mount point for ${entry.finalDmg}:\n${attachOutput}`);
  }

  try {
    const appPath = path.join(mountPoint, config.stagedAppName);
    await run(`spctl --assess --type execute --verbose ${shellQuote(appPath)}`);
    await run(`codesign --verify --deep --strict --verbose=2 ${shellQuote(appPath)}`);
    await run(`lipo -archs ${shellQuote(path.join(appPath, "Contents/MacOS", config.appName))} | grep -Fx ${shellQuote(entry.arch)}`);
    await run(`plutil -p ${shellQuote(path.join(appPath, "Contents/Info.plist"))} | rg 'CFBundleShortVersionString|CFBundleVersion|CFBundleIdentifier|SUFeedURL|SUPublicEDKey'`);
    const shortVersion = await capture(`plutil -extract CFBundleShortVersionString raw ${shellQuote(path.join(appPath, "Contents/Info.plist"))}`);
    const bundleVersion = await capture(`plutil -extract CFBundleVersion raw ${shellQuote(path.join(appPath, "Contents/Info.plist"))}`);
    if (shortVersion !== version || bundleVersion !== String(buildVersion)) {
      throw new ReleaseError(`Mounted ${entry.arch} app version mismatch: ${shortVersion} (${bundleVersion})`);
    }
  } finally {
    await run(`hdiutil detach ${shellQuote(mountPoint)}`);
  }
}

async function buildAndPackage(version, buildVersion) {
  logStep("Build both architectures in parallel");
  const built = await Promise.all(architectures.map((entry) => buildArch(version, entry)));

  for (const entry of built) {
    await validateBuiltApp(version, buildVersion, entry);
  }

  const artifactDir = await mkdtemp(path.join(tmpdir(), `ghostex-${version}-release-`));
  console.log(`Artifact directory: ${artifactDir}`);

  logStep("Package and notarize both architectures in parallel");
  const packaged = await Promise.all(built.map((entry) => packageAndNotarize(version, artifactDir, entry)));

  for (const entry of packaged) {
    await validateMountedDmg(version, buildVersion, entry);
  }

  return { artifactDir, artifacts: packaged };
}

async function generateAppcast(version, buildVersion, sparkleBinDir, artifact) {
  logStep(`Generate Sparkle feed ${artifact.feed}`);
  const workDir = await mkdtemp(path.join(tmpdir(), `ghostex-${version}-${artifact.arch}-appcast-`));
  const appcastPath = path.join(repoRoot, artifact.feed);
  const workAppcast = path.join(workDir, "appcast.xml");
  const workDmg = path.join(workDir, path.basename(artifact.finalDmg));

  await run(`cp ${shellQuote(appcastPath)} ${shellQuote(workAppcast)}`);
  await run(`cp ${shellQuote(artifact.finalDmg)} ${shellQuote(workDmg)}`);
  await run(
    [
      shellQuote(path.join(sparkleBinDir, "generate_appcast")),
      "--download-url-prefix",
      shellQuote(`https://github.com/${config.githubRepo}/releases/download/v${version}/`),
      "--full-release-notes-url",
      shellQuote(`https://github.com/${config.githubRepo}/releases/tag/v${version}`),
      "--maximum-versions 6",
      "-o",
      shellQuote(workAppcast),
      shellQuote(workDir),
    ].join(" "),
  );
  await run(`cp ${shellQuote(workAppcast)} ${shellQuote(appcastPath)}`);
  await run(`xmllint --noout ${shellQuote(appcastPath)}`);
  await run(`${shellQuote(path.join(sparkleBinDir, "sign_update"))} ${shellQuote(appcastPath)}`);
  await run(`${shellQuote(path.join(sparkleBinDir, "sign_update"))} --verify ${shellQuote(appcastPath)}`);
  await run(`xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='version'])[1])" ${shellQuote(appcastPath)} | grep -Fx ${shellQuote(String(buildVersion))}`);
  await run(`xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='shortVersionString'])[1])" ${shellQuote(appcastPath)} | grep -Fx ${shellQuote(version)}`);
  await run(`rg ${shellQuote(`ghostex-${version}-${artifact.arch}.dmg|sparkle:version|sparkle:shortVersionString|sparkle:edSignature|sparkle-signatures`)} ${shellQuote(appcastPath)} -g '!node_modules/**' -g '!dist/**' -g '!build/**' -g '!coverage/**' -g '!.git/**'`);

  await rm(workDir, { recursive: true, force: true });
}

async function updateSparkleFeeds(version, buildVersion, sparkleBinDir, artifacts) {
  for (const artifact of artifacts) {
    await generateAppcast(version, buildVersion, sparkleBinDir, artifact);
  }
}

async function commitReleaseMetadata(version, options) {
  logStep("Commit release metadata");
  await run(`git add package.json native/macos/ghostexHost/project.yml ${config.armFeed} ${config.intelFeed}`);
  await run(`git commit -m ${shellQuote(`chore: release ${version}`)}`);

  if (!options.noPush) {
    await run("git push origin main");
    await run(`git tag -a ${shellQuote(`v${version}`)} -m ${shellQuote(`Release v${version}`)}`);
    await run(`git push origin ${shellQuote(`v${version}`)}`);
  }

  return capture("git rev-parse HEAD");
}

async function extractChangelogSection(version) {
  const changelog = await readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  const escaped = version.replaceAll(".", "\\.");
  const match = changelog.match(new RegExp(`^## ${escaped} - .*\\n([\\s\\S]*?)(?=\\n## |\\n?$)`, "m"));
  if (!match) {
    throw new ReleaseError(`CHANGELOG.md does not contain a top-level section for ${version}.`);
  }
  const notes = match[1].trim();
  if (!notes || notes.includes("CDXC:") || notes.includes("<!--")) {
    throw new ReleaseError(`CHANGELOG.md section for ${version} is empty or contains comments.`);
  }
  return notes;
}

async function createGithubRelease(version, artifacts) {
  logStep("Create GitHub release");
  const notesPath = path.join(await mkdtemp(path.join(tmpdir(), `ghostex-${version}-notes-`)), "notes.md");
  const changelogNotes = await extractChangelogSection(version);
  const arm = artifacts.find((entry) => entry.arch === "arm64");
  const intel = artifacts.find((entry) => entry.arch === "x86_64");
  const notes = [
    "## Changes",
    "",
    changelogNotes,
    "",
    "## Downloads",
    "",
    `- Apple Silicon: ${path.basename(arm.finalDmg)}`,
    `  SHA256: ${arm.sha256}`,
    `- Intel: ${path.basename(intel.finalDmg)}`,
    `  SHA256: ${intel.sha256}`,
    "",
    "## Install",
    "",
    "```sh",
    config.installCommand,
    "```",
    "",
  ].join("\n");

  await writeFile(notesPath, notes);
  const assets = artifacts.map((entry) => shellQuote(entry.finalDmg)).join(" ");
  await run(
    [
      "gh release create",
      shellQuote(`v${version}`),
      assets,
      "--repo",
      shellQuote(config.githubRepo),
      "--title",
      shellQuote(`Ghostex ${version}`),
      "--notes-file",
      shellQuote(notesPath),
    ].join(" "),
  );

  return `https://github.com/${config.githubRepo}/releases/tag/v${version}`;
}

async function validateLiveSparkleAndAssets(version, buildVersion, sparkleBinDir) {
  logStep("Validate live Sparkle feeds and GitHub assets");
  for (const entry of architectures) {
    const output = path.join(tmpdir(), `ghostex-live-${version}-${entry.feed}`);
    await run(`curl -fsSL ${shellQuote(entry.feedUrl)} -o ${shellQuote(output)}`);
    await run(`xmllint --noout ${shellQuote(output)}`);
    await run(`${shellQuote(path.join(sparkleBinDir, "sign_update"))} --verify ${shellQuote(output)}`);
    await run(`xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='version'])[1])" ${shellQuote(output)} | grep -Fx ${shellQuote(String(buildVersion))}`);
    await run(`xmllint --xpath "string((//*[local-name()='item'][1]/*[local-name()='shortVersionString'])[1])" ${shellQuote(output)} | grep -Fx ${shellQuote(version)}`);
    await run(`rg ${shellQuote(`ghostex-${version}-${entry.arch}.dmg|sparkle:version|sparkle:shortVersionString|sparkle-signatures`)} ${shellQuote(output)} -g '!node_modules/**' -g '!dist/**' -g '!build/**' -g '!coverage/**' -g '!.git/**'`);
    await run(`curl -I -L --fail ${shellQuote(`https://github.com/${config.githubRepo}/releases/download/v${version}/ghostex-${version}-${entry.arch}.dmg`)} | sed -n '1,12p'`);
  }
  await run(`gh release view ${shellQuote(`v${version}`)} --repo ${shellQuote(config.githubRepo)} --json tagName,name,url,assets --jq '{tagName,name,url,assets:[.assets[]|{name,size,digest,url}]}'`);
}

async function updateHomebrew(version, artifacts, options) {
  logStep("Update Homebrew tap");
  const tapDir = await mkdtemp(path.join(tmpdir(), `ghostex-${version}-homebrew-tap-`));
  await run(`git clone ${shellQuote(config.tapRepo)} ${shellQuote(tapDir)}`);

  const caskFile = path.join(tapDir, config.caskPath);
  let cask = await readFile(caskFile, "utf8");
  const arm = artifacts.find((entry) => entry.arch === "arm64");
  const intel = artifacts.find((entry) => entry.arch === "x86_64");

  cask = cask
    .replace(/version\s+"[^"]+"/, `version "${version}"`)
    .replace(
      /sha256 arm:\s+"[0-9a-f]+",\s*\n\s*intel:\s+"[0-9a-f]+"/,
      `sha256 arm:   "${arm.sha256}",\n         intel: "${intel.sha256}"`,
    );

  if (!cask.includes(`version "${version}"`) || !cask.includes(arm.sha256) || !cask.includes(intel.sha256)) {
    throw new ReleaseError("Failed to update Homebrew cask version or checksums.");
  }

  await writeFile(caskFile, cask);
  await run(`ruby -c ${shellQuote(config.caskPath)}`, { cwd: tapDir });
  await run(`brew style ${shellQuote(config.caskPath)}`, { cwd: tapDir });
  await run(`git diff -- ${shellQuote(config.caskPath)}`, { cwd: tapDir });
  await run(`git add ${shellQuote(config.caskPath)}`, { cwd: tapDir });
  await run(`git commit -m ${shellQuote(`Update ghostex cask to ${version}`)}`, { cwd: tapDir });
  await run("git push origin main", { cwd: tapDir });
  const tapCommit = await capture("git rev-parse HEAD", { cwd: tapDir });

  if (!options.skipBrewFetch) {
    await run("brew update --force");
    await run("brew info --cask maddada/tap/ghostex");
    await run("brew fetch --force --cask --arch=arm maddada/tap/ghostex");
    await run("brew fetch --force --cask --arch=intel maddada/tap/ghostex");
  }

  return { tapDir, tapCommit };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage().trim());
    return;
  }

  process.chdir(repoRoot);
  const version = options.version;
  const buildVersion = releaseBuildVersion(version);

  console.log(`Ghostex local release: ${version}`);
  console.log(`Sparkle build version: ${buildVersion}`);

  await preflight(version, buildVersion, options);
  await bumpReleaseMetadata(version, buildVersion);
  const { artifactDir, artifacts } = await buildAndPackage(version, buildVersion);
  const sparkleBinDir = await findAndVerifySparkleBinDir();
  await updateSparkleFeeds(version, buildVersion, sparkleBinDir, artifacts);
  const releaseCommit = await commitReleaseMetadata(version, options);

  let releaseUrl = "(not published; --no-push was used)";
  let tapCommit = "(not updated; --no-push was used)";

  if (!options.noPush) {
    releaseUrl = await createGithubRelease(version, artifacts);
    await validateLiveSparkleAndAssets(version, buildVersion, sparkleBinDir);
    const brewResult = await updateHomebrew(version, artifacts, options);
    tapCommit = brewResult.tapCommit;
  }

  logStep("Release complete");
  console.log(`Release URL: ${releaseUrl}`);
  console.log(`Release commit: ${releaseCommit}`);
  console.log(`Homebrew tap commit: ${tapCommit}`);
  console.log(`Artifact directory: ${artifactDir}`);
  for (const artifact of artifacts) {
    console.log(`${artifact.arch}:`);
    console.log(`  DMG: ${artifact.finalDmg}`);
    console.log(`  SHA256: ${artifact.sha256}`);
    console.log(`  Notary: ${artifact.notarySubmissionId} (${artifact.notaryStatus})`);
  }
  console.log(`Install: ${config.installCommand}`);
}

main().catch((error) => {
  console.error("");
  console.error(error instanceof ReleaseError ? error.message : error);
  process.exitCode = 1;
});
