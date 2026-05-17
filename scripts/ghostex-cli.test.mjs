import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  isFailedCliResult,
  parseArgs,
  parseCreateSession,
  parseRename,
  readAndroidReadinessSettings,
  usage,
} from "./ghostex-cli.mjs";

const execFileAsync = promisify(execFile);

function strictAndroidReleaseEnv(overrides = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING: "1",
    GHOSTEX_ANDROID_SIGNING_STORE_FILE: "/tmp/ghostex-android-missing-release.jks",
    GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD: "store-password",
    GHOSTEX_ANDROID_SIGNING_KEY_ALIAS: "ghostex-release",
    GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD: "key-password",
    GHOSTEX_ANDROID_HOST: "mac.tailnet.test",
    GHOSTEX_ANDROID_USER: "madda",
    GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA: "1",
    ...overrides,
  };
}

describe("ghostex CLI Android remote-session contract", () => {
  test("runs main when invoked through a symlinked cli script", async () => {
    /**
     * CDXC:CliEntrypoint 2026-05-18-01:17:
     * Android SSH uses the installed `ghostex` wrapper on the Mac. In local
     * development that wrapper may execute a symlinked `ghostex-cli.mjs`; keep
     * the direct-entrypoint guard symlink-aware so JSON commands do not exit
     * zero with empty stdout.
     */
    const tempDir = await mkdtemp(path.join(tmpdir(), "ghostex-cli-symlink-"));
    try {
      const linkPath = path.join(tempDir, "ghostex-cli.mjs");
      await symlink(path.resolve("scripts/ghostex-cli.mjs"), linkPath);
      const result = await execFileAsync(process.execPath, [linkPath, "help"]);

      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("sessions | s | ls [--ungrouped|-u] [--json]");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  test("parses Android action flag form", () => {
    const { flags, rest } = parseArgs(["--session-id", "session-1", "--json"]);

    expect(rest).toEqual([]);
    expect(flags.sessionId).toBe("session-1");
    expect(flags.json).toBe(true);
  });

  test("parses Android rename-session flag form", () => {
    const { flags, rest } = parseArgs([
      "--session-id",
      "session-1",
      "--title=Ship Android's polish",
      "--json",
    ]);

    expect(rest).toEqual([]);
    expect(parseRename(rest, flags)).toMatchObject({
      sessionId: "session-1",
      title: "Ship Android's polish",
    });
    expect(flags.json).toBe(true);
  });

  test("parses Android create-session project and group flags", () => {
    /**
     * CDXC:AndroidRemoteSessions 2026-05-18-02:31:
     * Android's sidebar plus button must create the terminal in the tapped Mac
     * project/group through the Ghostex CLI, not whichever project happens to
     * be active on the Mac.
     */
    const { flags, rest } = parseArgs([
      "--project-id",
      "project-1",
      "--group-id",
      "group-main",
      "--json",
    ]);

    expect(parseCreateSession(rest, flags)).toMatchObject({
      groupId: "group-main",
      projectId: "project-1",
    });
  });

  test("keeps positional rename-session form for human CLI usage", () => {
    const { flags, rest } = parseArgs(["session-1", "Ship", "Android"]);

    expect(parseRename(rest, flags)).toMatchObject({
      sessionId: "session-1",
      title: "Ship Android",
    });
  });

  test("documents JSON action and Android rename forms in help", () => {
    const help = usage();

    expect(help).toContain("android-check [--json]");
    expect(help).toContain("create-session [title] [--input text] [--project-id id] [--group-id id]");
    expect(help).toContain("kill | k <selector|all> [--json]");
    expect(help).toContain("attach | a --session-id <id>");
    expect(help).toContain("sleep <selector|all> [--json]");
    expect(help).toContain("wake <selector|all> [--json]");
    expect(help).toContain("(focus|sleep|wake|kill) --session-id <id> [--json]");
    expect(help).toContain("rename-session --session-id <id> --title <title> [--json]");
  });

  test("treats failed bridge JSON replies as failed CLI results", () => {
    /**
     * CDXC:AndroidRemoteSessions 2026-05-17-14:24:
     * Android relies on SSH process exit status for remote focus and rename.
     * Keep the bridge failure predicate tested so `{ ok: false }` and
     * transport-level failures cannot be reported to Android as successful
     * remote actions.
     */
    expect(isFailedCliResult({ ok: false })).toBe(true);
    expect(isFailedCliResult({ bridgeOk: false })).toBe(true);
    expect(isFailedCliResult({ ok: true })).toBe(false);
    expect(isFailedCliResult({})).toBe(false);
  });

  test("treats bridge transport failures as failed CLI results for lifecycle actions", () => {
    /**
     * CDXC:AndroidRemoteSessions 2026-05-17-20:58:
     * Android wake/sleep/kill actions are routed through JSON CLI lifecycle
     * commands. A bridge transport failure must be non-success even if the
     * payload does not contain an explicit `ok: false` command result.
     */
    expect(isFailedCliResult({ bridgeOk: false, error: "bridge unavailable" })).toBe(true);
  });

  test("android readiness settings require zmx persistence", async () => {
    /**
     * CDXC:AndroidConnectionManagement 2026-05-17-18:20:
     * `ghostex android-check --json` is Android's Mac-side release gate. The
     * CLI must fail before bridge attach when Ghostex settings are not actually
     * set to zmx, because Android only supports zmx persistence in this release.
     */
    const home = await mkdtemp(path.join(tmpdir(), "ghostex-android-check-"));
    try {
      const settingsPath = path.join(home, "state", "native-sidebar-settings.json");
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ sessionPersistenceProvider: "tmux" }));
      const result = await readAndroidReadinessSettings(settingsPath);

      expect(result).toMatchObject({
        ok: false,
        sessionPersistenceProvider: "tmux",
      });
      expect(result.error).toContain("set Session persistence to zmx");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("android readiness settings normalize zmx provider token", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "ghostex-android-check-"));
    try {
      const settingsPath = path.join(home, "state", "native-sidebar-settings.json");
      await mkdir(path.dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify({ sessionPersistenceProvider: " ZMX " }));

      await expect(readAndroidReadinessSettings(settingsPath)).resolves.toMatchObject({
        ok: true,
        sessionPersistenceProvider: "zmx",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test("strict Android release runner refuses to skip Mac readiness", async () => {
    /**
     * CDXC:AndroidReleaseE2E 2026-05-17-20:57:
     * The default Android release runner is final proof, not a source-only
     * convenience command. It must reject `--skip-mac-check` unless `--local`
     * is also present so final release validation always proves the Mac
     * Ghostex/ZMX readiness contract.
     */
    await expect(
      execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
        "--skip-mac-check",
      ], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("--skip-mac-check requires --local"),
    });
  });

  test("strict Android release runner preflights signing target and device safety before work", async () => {
    /**
     * CDXC:AndroidReleaseE2E 2026-05-17-20:59:
     * The default Android release runner should fail before Mac CLI, Gradle, or
     * adb work when final-proof context is missing. Keep this fast preflight
     * test beside the root CLI contract so strict release validation cannot
     * silently fall back to an unsigned local build or an unsafe device clear.
     */
    await expect(
      execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
      ], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Final Ghostex Android release proof requires publish signing"),
    });

    try {
      await execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
      ], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
      });
      throw new Error("strict Android release runner unexpectedly passed without final-proof environment");
    } catch (error) {
      expect(error.stderr).toContain("GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING=1");
      expect(error.stderr).toContain("GHOSTEX_ANDROID_SIGNING_STORE_FILE");
      expect(error.stderr).toContain("GHOSTEX_ANDROID_HOST");
      expect(error.stderr).toContain("GHOSTEX_ANDROID_USER");
      expect(error.stderr).toContain("GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1");
      expect(error.stdout).not.toContain("ghostex-cli.mjs android-check");
      expect(error.stdout).not.toContain("./gradlew");
    }
  });

  test("strict Android release runner preflights external signing keystore before work", async () => {
    /**
     * CDXC:AndroidReleaseSurface 2026-05-17-21:01:
     * Publish signing material has to be an existing external file. The root
     * runner should reject missing or in-checkout keystore paths before it
     * starts Mac readiness, Gradle builds, signature checks, or device work.
     */
    await expect(
      execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
      ], {
        env: strictAndroidReleaseEnv(),
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("GHOSTEX_ANDROID_SIGNING_STORE_FILE does not exist"),
    });

    try {
      await execFileAsync("bash", [
        path.resolve("scripts/ghostex-android-release-readiness.sh"),
      ], {
        env: strictAndroidReleaseEnv({
          GHOSTEX_ANDROID_SIGNING_STORE_FILE: path.resolve("android/termux-app/README.md"),
        }),
      });
      throw new Error("strict Android release runner unexpectedly accepted an in-checkout signing file");
    } catch (error) {
      expect(error.code).toBe(2);
      expect(error.stderr).toContain("must live outside the Android checkout");
      expect(error.stdout).not.toContain("ghostex-cli.mjs android-check");
      expect(error.stdout).not.toContain("./gradlew");
    }
  });
});
