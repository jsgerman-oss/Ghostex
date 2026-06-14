import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const sparkleUserDriverSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/GhostexSparkleUserDriver.swift", import.meta.url),
  "utf8",
);
const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");

describe("titlebar update download animation source", () => {
  test("keeps the download button fade driven by Sparkle download state", () => {
    /*
     * CDXC:AutoUpdate 2026-06-13-17:52:
     * The titlebar download button must fade only while Sparkle is downloading
     * an accepted update. Keep the native callback, bootstrap/bridge boolean,
     * and React data-driven CSS animation connected.
     */
    expect(sparkleUserDriverSource).toContain("var onDownloadActiveChanged: ((Bool) -> Void)?");
    expect(sparkleUserDriverSource).toMatch(
      /override func showDownloadInitiated\(cancellation: @escaping \(\) -> Void\) \{[\s\S]*onDownloadActiveChanged\?\(true\)[\s\S]*\}/,
    );
    expect(sparkleUserDriverSource).toMatch(
      /override func showDownloadDidStartExtractingUpdate\(\) \{[\s\S]*onDownloadActiveChanged\?\(false\)[\s\S]*\}/,
    );

    expect(appDelegateSource).toContain("private var isSparkleUpdateDownloading = false");
    expect(appDelegateSource).toContain("userDriver.onDownloadActiveChanged");
    expect(appDelegateSource).toContain("self?.setSparkleUpdateDownloading(downloading)");
    expect(appDelegateSource).toContain("initialUpdateDownloading: isSparkleUpdateDownloading");
    expect(appDelegateSource).toContain('"updateDownloading": initialUpdateDownloading');
    expect(appDelegateSource).toContain("func setTitlebarUpdateDownloading(_ downloading: Bool)");
    expect(appDelegateSource).toContain('"updateDownloading": downloading');
    expect(appDelegateSource).toContain("__ghostex_PENDING_TITLEBAR_UPDATE_DOWNLOADING__");
    expect(appDelegateSource).toContain("setSparkleUpdateDownloading(false)");

    expect(titlebarHostSource).toContain("updateDownloading: boolean;");
    expect(titlebarHostSource).toContain("__ghostex_PENDING_TITLEBAR_UPDATE_DOWNLOADING__?: boolean;");
    expect(titlebarHostSource).toContain("readInitialTitlebarUpdateDownloading(bootstrap)");
    expect(titlebarHostSource).toContain("state.updateDownloading ?? current.updateDownloading");
    expect(titlebarHostSource).toContain("projectState.updateAvailable || projectState.updateDownloading");
    expect(titlebarHostSource).toContain('data-downloading={projectState.updateDownloading ? "true" : undefined}');
    expect(titlebarHostSource).toContain("titlebar-update-download-fade");
    expect(titlebarHostSource).toContain('content={projectState.updateDownloading ? "Downloading update" : "Download update"}');
  });
});
