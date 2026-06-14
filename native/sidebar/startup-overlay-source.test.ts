import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);

function sourceSection(source: string, startNeedle: string, endNeedle: string): string {
  const startIndex = source.indexOf(startNeedle);
  expect(startIndex).toBeGreaterThan(-1);
  const endIndex = source.indexOf(endNeedle, startIndex + startNeedle.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native startup overlay source", () => {
  test("keeps the loading overlay above the titlebar separator layer", () => {
    /*
     * CDXC:StartupOverlay 2026-06-13-18:05:
     * The startup loading overlay must cover the titlebar/workarea separator
     * because that separator is decorative chrome and should not appear in
     * front of the loading mask.
     */
    const rootSource = sourceSection(
      appDelegateSource,
      "final class ghostexRootView",
      "extension ghostexRootView: WKNavigationDelegate",
    );
    const installOverlaySource = sourceSection(
      rootSource,
      "private func installStartupOverlay()",
      "private func fadeOutStartupOverlay()",
    );
    const chromeLayerSource = sourceSection(
      rootSource,
      "private func configureRootChromeLayers()",
      "private func installRootChromeLayers()",
    );

    expect(rootSource).toContain("private static let rootChromeLayerZPosition: CGFloat = 10_500");
    expect(rootSource).toContain("private static let startupOverlayZPosition: CGFloat = 11_000");
    expect(chromeLayerSource).toContain(
      "workareaTitlebarBorderLayer.zPosition = Self.rootChromeLayerZPosition",
    );
    expect(installOverlaySource).toContain(
      "startupOverlayView.layer?.zPosition = Self.startupOverlayZPosition",
    );
  });
});
