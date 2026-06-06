import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeT3LogSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/NativeT3CodePaneReproLog.swift", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("T3 runtime packaging", () => {
  test("native runtime launcher resolves the packaged Web/t3code-server entrypoint", () => {
    /*
    CDXC:T3CodePackaging 2026-06-07-02:30:
    The macOS build stages T3 Code under Contents/Resources/Web/t3code-server. Native startup must check that Web path before falling back to legacy probes, or installed apps show the T3 loading pane forever while the packaged runtime is present but unused.
    */
    const resolver = sourceBetween(
      nativeT3LogSource,
      "private static func bundledRuntimeEntrypointPath",
      "private static func expandedPath",
    );
    expect(resolver).toContain('"Web/\\(bundledDirectoryName)/dist/bin.mjs"');
    expect(resolver.indexOf('"Web/\\(bundledDirectoryName)/dist/bin.mjs"')).toBeLessThan(
      resolver.indexOf('"out/\\(bundledDirectoryName)/dist/bin.mjs"'),
    );
  });

  test("native runtime startup retains one in-flight packaged server launch", () => {
    /*
    CDXC:T3CodeStartup 2026-06-07-02:46:
    Opening or restoring a T3 pane can send start requests through both native host surfaces while the packaged server is still migrating and bootstrapping auth. Both callers must share one launch claim and retain young unresponsive processes so the first server finishes instead of being replaced by a duplicate launch.
    */
    const launcher = sourceBetween(
      nativeT3LogSource,
      "enum NativeT3RuntimeLauncher",
      "struct NativeT3ThreadRoute",
    );
    expect(launcher).toContain("static let startupGraceInterval: TimeInterval = 30.0");
    expect(launcher).toContain("private static let launchAttemptLock = NSLock()");
    expect(launcher).toContain("static func claimLaunchStart() -> LaunchStartClaim");
    expect(launcher).toContain("case retained(TimeInterval)");

    expect(appDelegateSource.match(/private var t3CodeRuntimeStartedAt: Date\?/g)).toHaveLength(2);
    expect(appDelegateSource.match(/NativeT3RuntimeLauncher\.claimLaunchStart\(\)/g)).toHaveLength(2);
    expect(appDelegateSource.match(/t3Runtime\.start\.launchInProgressRetained/g)).toHaveLength(2);
    expect(appDelegateSource.match(/t3CodeRuntimeStartedAt = launchStartedAt/g)).toHaveLength(2);
    expect(
      appDelegateSource.match(/NativeT3RuntimeLauncher\.clearLaunchAttempt\(startedAt: launchStartedAt\)/g)
        ?.length,
    ).toBeGreaterThanOrEqual(4);
  });
});
