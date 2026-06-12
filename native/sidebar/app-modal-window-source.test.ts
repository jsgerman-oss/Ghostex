import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const modalStylesSource = readFileSync(
  new URL("../../sidebar/styles/modals.css", import.meta.url),
  "utf8",
);
const sidebarStylesSource = readFileSync(
  new URL("../../sidebar/styles.css", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native app modal window source", () => {
  test("opens first-launch setup 90px taller than the generic management modals", () => {
    /*
    CDXC:FirstLaunchSetup 2026-06-12-07:13:
    The macOS first-launch setup modal must open 90px taller than its old 1120x760 native child window so onboarding steps with hook status and footer actions are not clipped.
    Keep Agents Hub at the generic management-modal height while firstLaunchSetup and the legacy tipsAndTricks alias use the taller frame.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "agentsHub":');
    expect(defaultSize).toContain("return CGSize(width: 1120, height: 760)");
    expect(defaultSize).toContain('case "firstLaunchSetup", "tipsAndTricks":');
    expect(defaultSize).toContain("return CGSize(width: 1120, height: 850)");
  });

  test("keeps Rename Session fixed at 570x480 in the macOS app", () => {
    /*
    CDXC:SidebarRename 2026-06-12-05:05:
    Rename Session must keep a 540px React dialog cap and 9px side padding so it is 20px wider while reducing left/right content padding by 15px.

    CDXC:SidebarRename 2026-06-12-06:35:
    Rename Session must keep its 570px width but gain 80px of native-window height, opening as 570x480 so the generated-name controls and bottom action area fit.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "renameSession":');
    expect(defaultSize).toContain("return CGSize(width: 570, height: 480)");

    const shouldLockContentSize = sourceBetween(
      appDelegateSource,
      "private func shouldLockContentSize(modal: String) -> Bool",
      "private func minimumContentSize(for modal: String?) -> CGSize",
    );
    expect(shouldLockContentSize).toContain('modal == "previousSessions" || modal == "renameSession"');

    const renameStyles = sourceBetween(
      modalStylesSource,
      ".session-rename-modal-shadcn {",
      ".add-repository-modal-shadcn {",
    );
    expect(renameStyles).toContain("max-width: min(540px, calc(100vw - 2rem));");
    expect(renameStyles).toContain("padding-left: 9px;");
    expect(renameStyles).toContain("padding-right: 9px;");
  });

  test("keeps Delayed Send fixed at 472x269 in the macOS app", () => {
    /*
    CDXC:DelayedSend 2026-06-12-04:07:
    Delayed Send must open as a fixed 472x269 macOS child window, including a matching modal-specific minimum because the shared app-modal minimum is larger than this timer dialog.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "delayedSend":');
    expect(defaultSize).toContain("return CGSize(width: 472, height: 269)");

    const shouldLockContentSize = sourceBetween(
      appDelegateSource,
      "private func shouldLockContentSize(modal: String) -> Bool",
      "private func minimumContentSize(for modal: String?) -> CGSize",
    );
    expect(shouldLockContentSize).toContain(
      'modal == "previousSessions" || modal == "renameSession" || modal == "delayedSend"',
    );

    const minimumContentSize = sourceBetween(
      appDelegateSource,
      "private func minimumContentSize(for modal: String?) -> CGSize",
      "private func appModalStyleMask(for modal: String) -> NSWindow.StyleMask",
    );
    expect(minimumContentSize).toContain('case "delayedSend":');
    expect(minimumContentSize).toContain("return CGSize(width: 472, height: 269)");
  });

  test("sizes the macOS Command Palette to the adjusted native content area", () => {
    /*
    CDXC:CommandPalette 2026-06-12-05:04:
    Command Palette should open 15px narrower on both left and right than the old 720px native frame, while adding 15px of vertical WebView/modal room for the React command list.

    CDXC:CommandPalette 2026-06-12-05:14:
    The extra height must be added at the bottom rather than recentering the modal vertically, so the native placement keeps the previous 520px top edge and extends down to 535px.
    */
    const defaultSize = sourceBetween(
      appDelegateSource,
      "private func defaultSize(for modal: String) -> CGSize",
      "private func constrainedSize(_ size: CGSize, parentWindow: NSWindow) -> CGSize",
    );
    expect(defaultSize).toContain('case "commandPalette":');
    expect(defaultSize).toContain("return CGSize(width: 690, height: 535)");

    const commandPaletteFrame = sourceBetween(
      appDelegateSource,
      "private func commandPaletteContentFrame(size: CGSize, parentWindow: NSWindow) -> CGRect",
      "private func clampFrameToVisibleScreen",
    );
    expect(commandPaletteFrame).toContain("let previousCenteredHeight: CGFloat = 520");
    expect(commandPaletteFrame).toContain(
      "let bottomOnlyHeightIncrease = max(0, size.height - previousCenteredHeight)",
    );

    const constrainedContentFrame = sourceBetween(
      appDelegateSource,
      "private func constrainedContentFrame(",
      "private func shouldLockContentSize(modal: String) -> Bool",
    );
    expect(constrainedContentFrame).toContain('if modal == "commandPalette"');
    expect(constrainedContentFrame).toContain(
      "return commandPaletteContentFrame(size: size, parentWindow: parentWindow)",
    );
  });

  test("keeps the macOS Command Palette React surface inset compact", () => {
    /*
    CDXC:CommandPalette 2026-06-12-05:23:
    Command Palette should reduce the combined search-bar top gap and the whole component's left/right inset by 5px, producing a 3px scoped inset without changing shared CommandInput defaults.
    */
    const commandPaletteStyles = sourceBetween(
      sidebarStylesSource,
      ".ghostex-command-palette-dialog {",
      ".ghostex-command-palette-list {",
    );
    expect(commandPaletteStyles).toContain(
      '.ghostex-command-palette-dialog [data-slot="command"]',
    );
    expect(commandPaletteStyles).toContain("padding: 0 0 4px;");
    expect(commandPaletteStyles).toContain(
      '.ghostex-command-palette-dialog [data-slot="command-input-wrapper"]',
    );
    expect(commandPaletteStyles).toContain("padding: 3px 3px 0;");
    expect(commandPaletteStyles).toContain(
      '.ghostex-command-palette-dialog [data-slot="command-group"]',
    );
    expect(commandPaletteStyles).toContain("padding-left: 3px;");
    expect(commandPaletteStyles).toContain("padding-right: 3px;");
  });

  test("closes the macOS Command Palette from outside clicks and the repeat hotkey", () => {
    /*
    CDXC:CommandPalette 2026-06-12-05:45:
    The native Command Palette is now a child window. AppKit must close it when the user clicks back into the parent Ghostex window, and the openCommandPalette hotkey must toggle the already-open native palette instead of reopening it.
    */
    const dispatchNativeHotkey = sourceBetween(
      appDelegateSource,
      "private func dispatchNativeHotkey(_ actionId: String)",
      "private func shouldHandleHotkeyWhileWebChromeOwnsFocus",
    );
    expect(dispatchNativeHotkey).toContain(
      'if actionId == "openCommandPalette", isCommandPaletteNativeModalOpenOrPending()',
    );
    expect(dispatchNativeHotkey).toContain(
      'closeNativeAppModalWindow(reason: "commandPaletteHotkeyToggle", sendReactClose: true)',
    );
    expect(dispatchNativeHotkey).toContain('activeNativeAppModalKind == "commandPalette"');
    expect(dispatchNativeHotkey).toContain(
      'nativeAppModalWindowController?.currentModalKind == "commandPalette"',
    );

    const webChromeHotkeyGuard = sourceBetween(
      appDelegateSource,
      "private func shouldHandleHotkeyWhileWebChromeOwnsFocus(actionId: String) -> Bool",
      "private func logNativeHotkeyDebug",
    );
    expect(webChromeHotkeyGuard).toContain(
      'if actionId == "openCommandPalette", isCommandPaletteNativeModalOpenOrPending()',
    );
    expect(webChromeHotkeyGuard).toContain("return true");

    const appModalWindowController = sourceBetween(
      appDelegateSource,
      "private final class AppModalWindowController",
      "private final class TitlebarDropdownPanelController",
    );
    expect(appModalWindowController).toContain("private var outsideEventMonitor: Any?");
    expect(appModalWindowController).toContain("installOutsideEventMonitorIfNeeded(for: modal)");
    expect(appModalWindowController).toContain('guard modal == "commandPalette"');
    expect(appModalWindowController).toContain(
      "matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]",
    );
    expect(appModalWindowController).toContain("event.window === panel");
    expect(appModalWindowController).toContain("self.closeFromOutsideMouseDown()");
    expect(appModalWindowController).toContain('onClosed("outsideMouseDown", closedModal)');
    expect(appModalWindowController).toContain("removeOutsideEventMonitor()");
  });
});
