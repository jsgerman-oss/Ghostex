#!/usr/bin/env node
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
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

/*
 CDXC:ReleaseAutomation 2026-05-29-19:12:
 Public releases can spend many minutes in Xcode builds and Apple notarization.
 Use explicit step timeouts and heartbeat logs so release operators see progress
 instead of waiting on a silent shell for twenty-plus minutes.
 */
const releaseTimeouts = {
  typecheckMs: 8 * 60 * 1000,
  testMs: 12 * 60 * 1000,
  buildArchMs: 50 * 60 * 1000,
  notaryArchMs: 45 * 60 * 1000,
  brewFetchMs: 15 * 60 * 1000,
  overallMs: 150 * 60 * 1000,
  heartbeatMs: 60 * 1000,
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
  --no-terminal-delegate
                     Fail instead of handing off to Terminal.app when the agent shell cannot see signing/notary credentials.
  --help             Show this help.

Expected state:
  Run this only after the agent/user has split-committed feature changes,
  updated CHANGELOG.md and AllFeatures.md, and pushed main.

Timeouts and progress:
  Build steps log heartbeat updates about every minute.
  Per-arch build timeout: 50 minutes.
  Per-arch notarization timeout: 45 minutes.
  Overall release timeout: 150 minutes.
`;
}

function parseArgs(argv) {
  const options = {
    withTests: false,
    skipTypecheck: false,
    skipBrewFetch: false,
    noPush: false,
    noTerminalDelegate: false,
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
    } else if (arg === "--no-terminal-delegate") {
      options.noTerminalDelegate = true;
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

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function run(command, options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const env = { ...process.env, ...(options.env ?? {}) };
  const stdio = options.stdio ?? "inherit";
  const timeoutMs = options.timeoutMs;

  console.log(`$ ${command}`);

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio,
    });
    const timeout = timeoutMs
      ? setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill("SIGTERM");
          reject(new ReleaseError(`Command timed out after ${timeoutMs}ms: ${command}`));
        }, timeoutMs)
      : null;

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

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
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

function formatElapsedSeconds(startedAt) {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function runWithHeartbeat(command, options = {}) {
  const {
    label = "command",
    timeoutMs = releaseTimeouts.notaryArchMs,
    heartbeatMs = releaseTimeouts.heartbeatMs,
    cwd = repoRoot,
    env = process.env,
  } = options;
  const startedAt = Date.now();
  const timeoutMinutes = Math.max(1, Math.round(timeoutMs / 60_000));
  console.log(`${label}: starting (timeout ${timeoutMinutes} min)`);

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const heartbeat = setInterval(() => {
      console.log(`${label}: still running (${formatElapsedSeconds(startedAt)} elapsed)...`);
    }, heartbeatMs);
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      clearInterval(heartbeat);
      reject(
        new ReleaseError(
          `${label} timed out after ${formatElapsedSeconds(startedAt)} (${timeoutMinutes} min limit).`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (code === 0) {
        console.log(`${label}: finished in ${formatElapsedSeconds(startedAt)}`);
        resolve(stdout.trim());
      } else {
        const detail = stderr || stdout;
        reject(
          new ReleaseError(
            `${label} failed (${code}) after ${formatElapsedSeconds(startedAt)}: ${command}${detail ? `\n${detail}` : ""}`,
          ),
        );
      }
    });
  });
}

function assertReleaseWithinOverallBudget(startedAt, stepLabel) {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > releaseTimeouts.overallMs) {
    throw new ReleaseError(
      `Release exceeded the overall ${Math.round(releaseTimeouts.overallMs / 60_000)} minute budget during ${stepLabel}.`,
    );
  }
}

function isGitNetworkResolutionError(error) {
  const message = String(error?.message ?? error);
  return /Could not resolve host|unable to access/i.test(message);
}

async function readGitHubHttpsCredentials() {
  const creds = await capture("printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill");
  const username = creds.match(/^username=(.+)$/m)?.[1];
  const password = creds.match(/^password=(.+)$/m)?.[1];
  if (!username || !password) {
    throw new ReleaseError("Could not read GitHub HTTPS credentials for git network commands.");
  }
  return { username, password };
}

/**
 * CDXC:Distribution 2026-05-23-12:55:
 * Some release environments resolve github.com for curl but not for git's libcurl.
 * Retry origin fetch/push/ls-remote through a Host-header HTTPS URL when DNS fails.
 */
async function resolveGitHubAddress() {
  try {
    return (await lookup("github.com", { family: 4 })).address;
  } catch {
    const output = await capture(
      "nslookup github.com 2>/dev/null | awk '/^Address: / { print $2; exit }'",
    );
    if (!output) {
      throw new ReleaseError("Could not resolve github.com for git network commands.");
    }
    return output;
  }
}

async function githubHttpsRemoteUrl(repoPath = config.githubRepo) {
  const { username, password } = await readGitHubHttpsCredentials();
  const address = await resolveGitHubAddress();
  return `https://${username}:${encodeURIComponent(password)}@${address}/${repoPath}.git`;
}

async function runGitNetwork(command, options = {}) {
  try {
    await run(command, options);
    return;
  } catch (error) {
    if (!isGitNetworkResolutionError(error)) {
      throw error;
    }
  }

  const remoteUrl = await githubHttpsRemoteUrl();
  const translated = command.replace(/\borigin\b/g, shellQuote(remoteUrl));
  await run(
    `git -c http.sslVerify=false -c http.extraHeader=${shellQuote("Host: github.com")} ${translated.replace(/^git\s+/, "")}`,
    options,
  );
}

async function ensureGhAuth() {
  const { password } = await readGitHubHttpsCredentials();
  if (!process.env.GH_TOKEN) {
    process.env.GH_TOKEN = password;
  }
  if (!process.env.GITHUB_TOKEN) {
    process.env.GITHUB_TOKEN = password;
  }
}

/**
 * CDXC:Distribution 2026-05-23-13:25:
 * Agent shells often inject stale GH_TOKEN values. Prefer the user's real gh
 * login-session auth before falling back to git credential fill for git push.
 */
async function ensureGhAuthForRelease() {
  try {
    await run("env -u GH_TOKEN -u GITHUB_TOKEN gh auth status -h github.com");
    return;
  } catch {
    await run("env -u GH_TOKEN -u GITHUB_TOKEN gh auth setup-git -h github.com || true");
  }
  await ensureGhAuth();
}

async function recoverKeychainVisibility() {
  logStep("Recover keychain visibility for signing");
  const keychains = await releaseKeychainSearchList();
  if (keychains.length > 0) {
    await run(`security list-keychains -d user -s ${keychains.map(shellQuote).join(" ")} 2>/dev/null || true`);
  }
  const loginKeychain = path.join(process.env.HOME ?? "", "Library/Keychains/login.keychain-db");
  await run(`security default-keychain -d user -s ${shellQuote(loginKeychain)} 2>/dev/null || true`);
  if (existsSync(loginKeychain)) {
    await run(`security unlock-keychain ${shellQuote(loginKeychain)} 2>/dev/null`, { timeoutMs: 3000 }).catch(() => {});
  }
}

async function configuredUserKeychains() {
  try {
    const output = await capture("security list-keychains -d user 2>/dev/null");
    return output
      .split("\n")
      .map((line) => line.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function releaseKeychainSearchList() {
  const home = process.env.HOME ?? "";
  const candidates = [
    ...(await configuredUserKeychains()),
    path.join(home, "Library/Keychains/login.keychain-db"),
    path.join(home, "Library/Keychains/iCloud.keychain-db"),
    "/Library/Keychains/System.keychain",
  ];
  return [...new Set(candidates.filter((keychain) => keychain && existsSync(keychain)))];
}

function releaseSigningIdentity() {
  return process.env.GHOSTEX_CODE_SIGN_IDENTITY?.trim() || config.signingIdentity;
}

/**
 * CDXC:Distribution 2026-05-23-13:10:
 * Release builds must use the Developer ID identity from ghostex-release-to-brew,
 * not ad-hoc detection, and preflight should fail with actionable keychain guidance
 * when the login keychain is locked or the certificate is missing.
 */
async function listCodeSigningIdentities() {
  /*
   CDXC:Distribution 2026-05-23-16:01:
   Developer ID certificates are not guaranteed to live only in login.keychain-db.
   Release preflight must inspect the aggregate keychain view and configured user keychains before deciding signing is unavailable.
   */
  const chunks = [];
  try {
    chunks.push(`== aggregate ==\n${await capture("security find-identity -v -p codesigning 2>/dev/null")}`);
  } catch (error) {
    chunks.push(`== aggregate failed ==\n${String(error.message ?? error)}`);
  }
  for (const keychain of await releaseKeychainSearchList()) {
    try {
      chunks.push(`== ${keychain} ==\n${await capture(`security find-identity -v -p codesigning ${shellQuote(keychain)} 2>/dev/null`)}`);
    } catch (error) {
      chunks.push(`== ${keychain} failed ==\n${String(error.message ?? error)}`);
    }
  }
  return chunks.join("\n");
}

function signingIdentityIsVisible(identities) {
  return Boolean(matchingSigningIdentityLine(identities));
}

function matchingSigningIdentityLine(identities) {
  const identity = releaseSigningIdentity();
  return identities
    .split("\n")
    .find((line) => line.includes(`"${identity}"`) || line.includes(identity));
}

async function ensureSigningIdentity() {
  await recoverKeychainVisibility();
  const identity = releaseSigningIdentity();
  const identities = await listCodeSigningIdentities();
  if (!signingIdentityIsVisible(identities)) {
    throw new ReleaseError(
      [
        `No valid code signing identity found for release: ${identity}`,
        "",
        identities.trim() || "(security find-identity returned no valid identities)",
      ].join("\n"),
    );
  }
  await ensureSigningIdentityCanSign(identity);
}

/**
 * CDXC:Distribution 2026-05-25-18:22:
 * `security find-identity` can see a Developer ID certificate even when the
 * embedded agent shell cannot use the private key. Probe `codesign` directly so
 * the release delegates to Terminal.app before a long build fails on CEF files
 * with errSecInternalComponent.
 */
async function ensureSigningIdentityCanSign(identity) {
  const probeDir = await mkdtemp(path.join(tmpdir(), "ghostex-codesign-probe-"));
  const probePath = path.join(probeDir, "probe.sh");
  try {
    await writeFile(probePath, "#!/bin/sh\nexit 0\n");
    await run(`chmod +x ${shellQuote(probePath)}`);
    await run(`/usr/bin/codesign --force --sign ${shellQuote(identity)} --timestamp=none ${shellQuote(probePath)}`);
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }
}

function terminalReleasePaths(version) {
  return {
    logPath: `/tmp/ghostex-release-${version}.log`,
    runnerPath: `/tmp/ghostex-release-${version}.command`,
    startedPath: `/tmp/ghostex-release-${version}.started`,
    donePath: `/tmp/ghostex-release-${version}.done`,
    exitPath: `/tmp/ghostex-release-${version}.exit`,
  };
}

async function writeTerminalReleaseRunner(version) {
  const { logPath, runnerPath, startedPath, donePath, exitPath } = terminalReleasePaths(version);
  const identity = releaseSigningIdentity();
  await rm(logPath, { force: true });
  await rm(startedPath, { force: true });
  await rm(donePath, { force: true });
  await rm(exitPath, { force: true });
  await writeFile(
    logPath,
    [
      `Ghostex release ${version} prepared for Terminal.app at ${new Date().toISOString()}`,
      `Runner: ${runnerPath}`,
      "",
    ].join("\n"),
  );
  const runner = `#!/bin/zsh -l
set -uo pipefail
cd ${shellQuote(repoRoot)}
unset GH_TOKEN GITHUB_TOKEN
export GHOSTEX_CODE_SIGN_IDENTITY=${shellQuote(identity)}
export GHOSTEX_CODE_SIGN_TIMESTAMP_FLAG=--timestamp
export GHOSTEX_RELEASE_TERMINAL_DELEGATED=1
exec > >(tee -a ${shellQuote(logPath)}) 2>&1
echo "Ghostex release ${version} Terminal runner started at $(date)"
touch ${shellQuote(startedPath)}
release_status=0
{
  security list-keychains -d user -s "$HOME/Library/Keychains/login.keychain-db" "$HOME/Library/Keychains/iCloud.keychain-db" /Library/Keychains/System.keychain 2>/dev/null || true
  security default-keychain -d user -s "$HOME/Library/Keychains/login.keychain-db" 2>/dev/null || true
  perl -e 'alarm 3; exec @ARGV' security unlock-keychain "$HOME/Library/Keychains/login.keychain-db" 2>/dev/null || true
  security find-identity -v -p codesigning | rg ${shellQuote("Developer ID Application: Mohamad Youssef \\(KTKP595G3B\\)")} || true
  xcrun notarytool history --keychain-profile ${shellQuote(config.notaryProfile)} | head -n 8
  gh auth status -h github.com
  bun run release:local -- ${shellQuote(version)} --no-terminal-delegate
} || {
  release_status=$?
}
if [ "$release_status" -eq 0 ]; then
  echo "Ghostex release ${version} finished at $(date)"
else
  echo "Ghostex release ${version} failed with status $release_status at $(date)"
fi
echo "$release_status" > ${shellQuote(exitPath)}
touch ${shellQuote(donePath)}
exit "$release_status"
`;
  await writeFile(runnerPath, runner, { mode: 0o755 });
  return { logPath, runnerPath, startedPath, donePath, exitPath };
}

async function launchTerminalReleaseRunner(runnerPath) {
  logStep("Launch release through login-session Terminal");
  /**
   * CDXC:Distribution 2026-05-23-14:05:
   * AppleScript's `do script` breaks when generated through osascript -e because
   * `script` is reserved. Opening the .command file in Terminal.app is the
   * reliable login-session handoff for release builds.
   */
  const attempts = [
    `open -a /System/Applications/Utilities/Terminal.app ${shellQuote(runnerPath)}`,
    `open -a Terminal ${shellQuote(runnerPath)}`,
    "/Applications/OpenInTerminal.app/Contents/MacOS/OpenInTerminal-Lite",
    "/Applications/OpenInTerminal.app/Contents/MacOS/OpenInTerminal",
  ].map((command) => (command.endsWith("OpenInTerminal-Lite") || command.endsWith("OpenInTerminal")
    ? `${shellQuote(command)} ${shellQuote(runnerPath)}`
    : command));

  let lastError;
  for (const attempt of attempts) {
    if (attempt.includes("OpenInTerminal") && !existsSync(attempt.split(" ")[0].replaceAll("'", ""))) {
      continue;
    }
    try {
      await run(attempt);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.warn(
    "Could not open Terminal.app from this environment; running the login-shell release runner directly.",
  );
  await run(`nohup /bin/zsh -l ${shellQuote(runnerPath)} </dev/null >/dev/null 2>&1 &`);
}

async function waitForReleaseStart(startedPath, logPath, runnerPath, timeoutMs = 60 * 1000) {
  const startedAt = Date.now();
  while (!existsSync(startedPath)) {
    if (Date.now() - startedAt > timeoutMs) {
      const log = existsSync(logPath) ? await readFile(logPath, "utf8") : "(log file was not created)";
      throw new ReleaseError(
        [
          "Timed out waiting for Terminal.app to start the release runner.",
          `Runner: ${runnerPath}`,
          `Log: ${logPath}`,
          "",
          log.trim(),
        ].join("\n"),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function monitorTerminalReleaseLog(version, paths) {
  const { logPath, runnerPath, startedPath, donePath, exitPath } = paths;
  logStep(`Monitor Terminal release log (${logPath})`);
  await waitForReleaseStart(startedPath, logPath, runnerPath);
  let lastLength = 0;
  let stableFor = 0;
  while (true) {
    const log = existsSync(logPath) ? await readFile(logPath, "utf8") : "";
    const nextChunk = log.slice(lastLength);
    if (nextChunk) {
      process.stdout.write(nextChunk);
      lastLength = log.length;
    }
    if (existsSync(donePath)) {
      const exitCode = existsSync(exitPath) ? (await readFile(exitPath, "utf8")).trim() : "unknown";
      if (exitCode === "0") {
        return;
      }
      throw new ReleaseError(log.trim() || `Terminal release failed with status ${exitCode}. See ${logPath}`);
    }
    stableFor = nextChunk ? 0 : stableFor + 1;
    if (stableFor >= 180) {
      throw new ReleaseError(`Terminal release appears stalled. See ${logPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function agentShellCredentialsReady() {
  try {
    await ensureSigningIdentity();
    await ensureNotaryProfile();
  } catch {
    return false;
  }
  return true;
}

async function delegateReleaseToTerminal(version) {
  const paths = await writeTerminalReleaseRunner(version);
  await launchTerminalReleaseRunner(paths.runnerPath);
  await monitorTerminalReleaseLog(version, paths);
}

async function ensureNotaryProfile() {
  try {
    await run(`/bin/zsh -lc ${shellQuote(`set -o pipefail; xcrun notarytool history --keychain-profile ${shellQuote(config.notaryProfile)} | head -n 8`)}`);
  } catch (error) {
    throw new ReleaseError(
      [
        `Notary profile ${config.notaryProfile} is unavailable.`,
        "",
        "Fix:",
        "1. Store Apple notarization credentials:",
        "   xcrun notarytool store-credentials notarytool-profile --key <AuthKey.p8> --key-id <KEY_ID> --issuer <ISSUER_ID>",
        "2. Unlock the login keychain, then re-run bun run release:local -- <version>.",
        "",
        String(error.message ?? error),
      ].join("\n"),
    );
  }
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

  const head = await capture("git rev-parse HEAD");
  const originMain = await capture("git rev-parse origin/main");
  if (head === originMain) {
    console.log("Local main already matches origin/main; skipping git fetch.");
    return;
  }

  try {
    await run(`git merge-base --is-ancestor ${shellQuote(originMain)} ${shellQuote(head)}`);
    console.log("Local main is ahead of origin/main; continuing without fetch.");
    return;
  } catch {
    // Local main is not a simple fast-forward ahead of origin/main.
  }

  await runGitNetwork("git fetch origin main --tags");
  const fetchedOriginMain = await capture("git rev-parse origin/main");
  if (head !== fetchedOriginMain) {
    throw new ReleaseError("Local main must match origin/main before the script creates the release commit.");
  }
}

async function captureGitNetwork(command, options = {}) {
  try {
    return await capture(command, options);
  } catch (error) {
    if (!isGitNetworkResolutionError(error)) {
      throw error;
    }
    const remoteUrl = await githubHttpsRemoteUrl();
    const translated = command.replace(/\borigin\b/g, shellQuote(remoteUrl));
    return await capture(
      `git -c http.sslVerify=false -c http.extraHeader=${shellQuote("Host: github.com")} ${translated.replace(/^git\s+/, "")}`,
      options,
    );
  }
}

async function ensureTagMissing(version) {
  const localTag = await capture(`git tag --list ${shellQuote(`v${version}`)}`);
  const remoteTag = await captureGitNetwork(`git ls-remote --tags origin ${shellQuote(`v${version}*`)}`);
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
  await ensureGhAuthForRelease();
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

  try {
    await run("env -u GH_TOKEN -u GITHUB_TOKEN gh auth status -h github.com");
  } catch (error) {
    console.warn(
      `Warning: gh auth status failed in this shell; Terminal delegation may still succeed.\n${String(error.message ?? error)}`,
    );
  }
  await ensureSigningIdentity();
  await ensureNotaryProfile();

  console.log(
    `Release timeouts: build ${Math.round(releaseTimeouts.buildArchMs / 60_000)}m/arch, notary ${Math.round(releaseTimeouts.notaryArchMs / 60_000)}m/arch, overall ${Math.round(releaseTimeouts.overallMs / 60_000)}m.`,
  );

  if (!options.skipTypecheck) {
    await run("bun run typecheck", { timeoutMs: releaseTimeouts.typecheckMs });
  }
  if (options.withTests) {
    await run("bun run test", { timeoutMs: releaseTimeouts.testMs });
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
    GHOSTEX_CODE_SIGN_IDENTITY: releaseSigningIdentity(),
    GHOSTEX_CODE_SIGN_TIMESTAMP_FLAG: "--timestamp",
  };
  if (entry.arch === "x86_64") {
    env.GHOSTEX_SPARKLE_FEED_URL = entry.feedUrl;
  }

  logStep(`Build ${entry.arch}`);
  await run("native/macos/ghostexHost/build-ghostex-host.sh", {
    env,
    timeoutMs: releaseTimeouts.buildArchMs,
  });

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

  await validateLidSleepHelperSigning(entry);
}

async function validateLidSleepHelperSigning(entry) {
  const helperName = `${config.bundleId}.LidSleepHelper`;
  const launchServicesHelper = path.join(entry.appPath, "Contents/Library/LaunchServices", helperName);
  const resourcesHelper = path.join(entry.appPath, "Contents/Resources", helperName);

  if (existsSync(resourcesHelper)) {
    throw new ReleaseError(
      `${entry.arch} still contains an unsigned Resources copy of ${helperName}. Release builds must ship only Contents/Library/LaunchServices/${helperName}.`,
    );
  }
  if (!existsSync(launchServicesHelper)) {
    throw new ReleaseError(`${entry.arch} is missing bundled lid sleep helper: ${launchServicesHelper}`);
  }

  const signingDetails = await capture(
    `codesign -dv --verbose=4 ${shellQuote(launchServicesHelper)} 2>&1`,
  );
  if (!/Developer ID Application:/.test(signingDetails)) {
    throw new ReleaseError(
      `${entry.arch} lid sleep helper is not Developer ID signed:\n${launchServicesHelper}\n${signingDetails}`,
    );
  }
  if (!/Timestamp=/.test(signingDetails)) {
    throw new ReleaseError(`${entry.arch} lid sleep helper is missing a secure timestamp: ${launchServicesHelper}`);
  }
  if (!/flags=.*runtime/.test(signingDetails)) {
    throw new ReleaseError(`${entry.arch} lid sleep helper is missing hardened runtime: ${launchServicesHelper}`);
  }

  const entitlements = await capture(
    `codesign -d --entitlements :- ${shellQuote(launchServicesHelper)} 2>/dev/null | plutil -p - 2>/dev/null || true`,
  );
  if (/get-task-allow/.test(entitlements)) {
    throw new ReleaseError(
      `${entry.arch} lid sleep helper still has get-task-allow and cannot be notarized: ${launchServicesHelper}`,
    );
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
  const notaryOutput = await runWithHeartbeat(
    `xcrun notarytool submit ${shellQuote(finalDmg)} --keychain-profile ${shellQuote(config.notaryProfile)} --wait | tee ${shellQuote(notaryLogPath)}`,
    {
      label: `${entry.arch} notarization`,
      timeoutMs: releaseTimeouts.notaryArchMs,
    },
  );
  const submissionId = notaryOutput.match(/id:\s*([0-9a-f-]+)/)?.[1] ?? "unknown";
  /*
   CDXC:ReleaseAutomation 2026-05-23-13:58:
   `notarytool --wait` prints repeated `Current status: In Progress` lines
   before the final `status: Accepted`; parse the last status-like token so
   accepted submissions are not rejected after a long notarization wait.
   */
  const statusMatches = [...notaryOutput.matchAll(/(?:Current status:|status:)\s*([A-Za-z ]+)/g)];
  const status = statusMatches.at(-1)?.[1]?.trim() ?? "unknown";
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
  logStep("Build both architectures");
  /*
   CDXC:ReleaseAutomation 2026-05-23-14:02:
   Both architecture builds regenerate the shared native Web asset directory.
   Build sequentially so monaco/native web asset cleanup cannot race, while
   keeping package and notarization parallel after independent app bundles exist.
   */
  const built = [];
  for (const entry of architectures) {
    built.push(await buildArch(version, entry));
  }

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
    await runGitNetwork("git push origin main");
    await run(`git tag -a ${shellQuote(`v${version}`)} -m ${shellQuote(`Release v${version}`)}`);
    await runGitNetwork(`git push origin ${shellQuote(`v${version}`)}`);
  }

  return capture("git rev-parse HEAD");
}

async function extractChangelogSection(version) {
  const changelog = await readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  /*
   CDXC:ReleaseAutomation 2026-05-23-14:03:
   Do not use a multiline regex with `$` here: in JS multiline mode it can stop
   at the blank line after the heading and make valid release notes look empty.
   */
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${version} - `));
  if (start === -1) {
    throw new ReleaseError(`CHANGELOG.md does not contain a top-level section for ${version}.`);
  }
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    section.push(line);
  }
  const notes = section.join("\n").trim();
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

  cask = normalizeGhostexCliCask(cask)
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
  /*
   CDXC:ReleaseAutomation 2026-05-29-19:30:
   Homebrew style can fail on autocorrectable blank-line offenses after the cask
   generator inserts the gx preflight block. Auto-fix those before the strict
   style check so a successful GitHub release is not blocked by formatting.

   CDXC:ReleaseAutomation 2026-05-29-20:59:
   Preserve explicit `depends_on macos: ">= :ventura"` syntax for older
   Homebrew clients that can treat the symbol shorthand as exact Ventura.
   */
  await run(`brew style --fix --except-cops Homebrew/OSDependsOn ${shellQuote(config.caskPath)}`, { cwd: tapDir });
  await run(`brew style --except-cops Homebrew/OSDependsOn ${shellQuote(config.caskPath)}`, { cwd: tapDir });
  cask = await readFile(caskFile, "utf8");
  if (!cask.includes('depends_on macos: ">= :ventura"')) {
    throw new ReleaseError("Ghostex cask must require macOS Ventura or newer with explicit >= syntax.");
  }
  await run(`git diff -- ${shellQuote(config.caskPath)}`, { cwd: tapDir });
  await run(`git add ${shellQuote(config.caskPath)}`, { cwd: tapDir });
  await run(`git commit -m ${shellQuote(`Update ghostex cask to ${version}`)}`, { cwd: tapDir });
  await runGitNetwork("git push origin main", { cwd: tapDir });
  const tapCommit = await capture("git rev-parse HEAD", { cwd: tapDir });

  if (!options.skipBrewFetch) {
    await run("brew update --force", { timeoutMs: releaseTimeouts.brewFetchMs });
    await run("brew info --cask maddada/tap/ghostex", { timeoutMs: releaseTimeouts.brewFetchMs });
    await run("brew fetch --force --cask --arch=arm maddada/tap/ghostex", {
      timeoutMs: releaseTimeouts.brewFetchMs,
    });
    await run("brew fetch --force --cask --arch=intel maddada/tap/ghostex", {
      timeoutMs: releaseTimeouts.brewFetchMs,
    });
  }

  return { tapDir, tapCommit };
}

/**
 * CDXC:CliBranding 2026-05-26-15:11:
 * Homebrew releases should install `ghostex` and the new `gx` short alias, not
 * the older `gtx` alias. Check for an existing non-Ghostex `gx` binary before
 * linking so setup does not silently claim a command name another tool owns.
 *
 * CDXC:MacRelease 2026-05-29-20:59:
 * The cask must require macOS Ventura as a minimum floor, matching the Sparkle
 * 13.0 appcast requirement. Keep the explicit string form because older
 * Homebrew clients can parse the symbol shorthand as exact Ventura and block
 * newer macOS releases such as 26.x before Homebrew can install Ghostex.
 */
function normalizeGhostexCliCask(cask) {
  const ghostexBinary = '  binary "#{appdir}/ghostex.app/Contents/Resources/Web/cli/ghostex"';
  const gxBinary = '  binary "#{appdir}/ghostex.app/Contents/Resources/Web/cli/gx"';
  const cliPreflight = `  # CDXC:CliBranding 2026-05-26-15:11: Install gx only when another tool does not already own that command name.
  preflight do
    gx_candidates = [HOMEBREW_PREFIX/"bin/gx"]
    ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).each do |entry|
      gx_candidates << (Pathname(entry)/"gx") unless entry.empty?
    end

    gx_candidates.uniq.each do |gx_path|
      next if [gx_path.exist?, gx_path.symlink?].none?

      gx_target = gx_path.symlink? ? gx_path.readlink.to_s : gx_path.to_s
      next if gx_target.include?("ghostex.app/Contents/Resources/Web/cli/gx")

      raise "Ghostex cannot install the gx CLI because #{gx_path} already exists. " \\
            "Remove or rename the existing gx command, then reinstall Ghostex."
    end
  end`;

  let next = cask
    .replace(
      /\n  # CDXC:CliBranding 2026-05-26-15:11: Install gx only when another tool does not already own that command name\.\n  preflight do[\s\S]*?\n  end(?=\n\n  zap trash:|\n  binary "#\{appdir\}\/ghostex\.app\/Contents\/Resources\/Web\/cli\/gx")/g,
      "",
    )
    .replace(/^  depends_on macos: :ventura$/m, '  depends_on macos: ">= :ventura"')
    .replace(/^  binary "#\{appdir\}\/ghostex\.app\/Contents\/Resources\/Web\/cli\/gtx"\n/gm, "")
    .replace(/^  binary "#\{appdir\}\/ghostex\.app\/Contents\/Resources\/Web\/cli\/gx"\n/gm, "");

  if (!next.includes(`${ghostexBinary}\n`)) {
    throw new ReleaseError("Ghostex cask is missing the primary ghostex CLI binary stanza.");
  }

  next = next.replace(`${ghostexBinary}\n`, `${ghostexBinary}\n${gxBinary}\n\n${cliPreflight}\n`);
  if (!next.includes(gxBinary) || next.includes("/Web/cli/gtx")) {
    throw new ReleaseError("Failed to normalize Ghostex cask CLI binary aliases.");
  }
  if (!next.includes('depends_on macos: ">= :ventura"')) {
    throw new ReleaseError("Ghostex cask must require macOS Ventura or newer with explicit >= syntax.");
  }
  return next;
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
  const releaseStartedAt = Date.now();

  await ensureCleanWorktree();

  if (!options.noTerminalDelegate && !process.env.GHOSTEX_RELEASE_TERMINAL_DELEGATED && !(await agentShellCredentialsReady())) {
    console.warn(
      "Agent shell cannot access Developer ID signing or notary credentials. Delegating to Terminal.app.",
    );
    await delegateReleaseToTerminal(version);
    return;
  }

  assertReleaseWithinOverallBudget(releaseStartedAt, "preflight");
  await preflight(version, buildVersion, options);
  assertReleaseWithinOverallBudget(releaseStartedAt, "metadata bump");
  await bumpReleaseMetadata(version, buildVersion);
  assertReleaseWithinOverallBudget(releaseStartedAt, "build and notarize");
  const { artifactDir, artifacts } = await buildAndPackage(version, buildVersion);
  assertReleaseWithinOverallBudget(releaseStartedAt, "sparkle feeds");
  const sparkleBinDir = await findAndVerifySparkleBinDir();
  await updateSparkleFeeds(version, buildVersion, sparkleBinDir, artifacts);
  const releaseCommit = await commitReleaseMetadata(version, options);

  let releaseUrl = "(not published; --no-push was used)";
  let tapCommit = "(not updated; --no-push was used)";

  if (!options.noPush) {
    releaseUrl = await createGithubRelease(version, artifacts);
    await validateLiveSparkleAndAssets(version, buildVersion, sparkleBinDir);
    assertReleaseWithinOverallBudget(releaseStartedAt, "homebrew update");
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
