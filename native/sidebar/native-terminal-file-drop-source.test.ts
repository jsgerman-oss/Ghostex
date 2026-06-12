import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);

describe("native terminal file drops", () => {
  test("registers Ghostty terminal surfaces as direct file drop destinations", () => {
    const surfaceClassIndex = terminalWorkspaceSource.indexOf("final class GhostexGhosttySurfaceView: NSView");
    const initIndex = terminalWorkspaceSource.indexOf(
      "init(_ app: ghostty_app_t, baseConfig: GhostexGhosttySurfaceConfiguration? = nil, uuid: UUID? = nil)",
      surfaceClassIndex,
    );
    const dragExtensionIndex = terminalWorkspaceSource.indexOf("extension GhostexGhosttySurfaceView {", initIndex);
    const dragExtensionSource = terminalWorkspaceSource.slice(
      dragExtensionIndex,
      terminalWorkspaceSource.indexOf("extension GhostexGhosttySurfaceView: NSTextInputClient", dragExtensionIndex),
    );

    expect(surfaceClassIndex).toBeGreaterThan(-1);
    expect(initIndex).toBeGreaterThan(surfaceClassIndex);
    expect(terminalWorkspaceSource.indexOf("registerForDraggedTypes([.fileURL, .string])", initIndex)).toBeLessThan(
      dragExtensionIndex,
    );
    expect(dragExtensionSource).toContain("override func draggingEntered(_ sender: NSDraggingInfo)");
    expect(dragExtensionSource).toContain("override func draggingUpdated(_ sender: NSDraggingInfo)");
    expect(dragExtensionSource).toContain("override func performDragOperation(_ sender: NSDraggingInfo) -> Bool");
    expect(dragExtensionSource).toContain("terminalPaneDroppedPaths(in: sender.draggingPasteboard)");
    expect(dragExtensionSource).toContain("self.window?.makeFirstResponder(self)");
    expect(dragExtensionSource).toContain("self.insertText(text, replacementRange: NSRange(location: NSNotFound, length: 0))");
  });

  test("formats image drops as markdown and file drops as raw paths", () => {
    const formatterIndex = terminalWorkspaceSource.indexOf(
      "private func terminalPaneDropInsertionText(paths: [String]) -> String",
    );
    const formatterSource = terminalWorkspaceSource.slice(
      formatterIndex,
      terminalWorkspaceSource.indexOf("private func terminalPaneDroppedPaths(in pasteboard: NSPasteboard)", formatterIndex),
    );

    expect(formatterIndex).toBeGreaterThan(-1);
    expect(formatterSource).toContain("terminalPaneClipboardIsImageFilePath(path)");
    expect(formatterSource).toContain("return path");
    expect(formatterSource).toContain("terminalPaneClipboardMarkdownImageReference(path: path, imageNumber: nextImageNumber)");
    expect(formatterSource).toContain('entries.joined(separator: " ")');
    expect(terminalWorkspaceSource).not.toContain("terminal drop overlay");
  });
});
