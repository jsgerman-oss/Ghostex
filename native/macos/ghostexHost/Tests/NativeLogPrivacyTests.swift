import Foundation

func assertTrue(_ condition: Bool, _ message: String) {
  if !condition {
    fputs("\(message)\n", stderr)
    exit(1)
  }
}

func serializePrivacyTestPayload(_ payload: [String: Any]) -> String {
  guard
    JSONSerialization.isValidJSONObject(payload),
    let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
    let json = String(data: data, encoding: .utf8)
  else {
    fputs("privacy test payload did not serialize\n", stderr)
    exit(1)
  }
  return json
}

@main
enum NativeLogPrivacyTests {
  static func main() {
    let sanitized = NativeLogPrivacy.sanitizePayload([
      "details": [
        "authToken": "secret-token",
        "command": "codex --dangerously-do-something",
        "missingWorkspaceNativeSessionIds": ["P123:G456"],
        "projectId": "P123",
        "projectName": "Customer Project",
        "projectPath": "/Users/person/dev/customer-project",
        "sessionId": "G456",
        "url": "https://example.test/private?token=secret-token",
      ],
      "event": "nativeSidebar.gxserver.presentationTabReconciliation.mismatch",
    ])
    let json = serializePrivacyTestPayload(sanitized)

    assertTrue(json.contains("nativeSidebar.gxserver.presentationTabReconciliation.mismatch"), "event should remain visible")
    assertTrue(json.contains("P123"), "project id should remain visible")
    assertTrue(json.contains("G456"), "session id should remain visible")
    assertTrue(json.contains("missingWorkspaceNativeSessionIds"), "structured mismatch key should remain visible")
    assertTrue(!json.contains("Customer Project"), "project names must be redacted")
    assertTrue(!json.contains("/Users/person"), "paths must be redacted")
    assertTrue(!json.contains("codex --dangerously-do-something"), "command text must be redacted")
    assertTrue(!json.contains("secret-token"), "secrets must be redacted")
    assertTrue(!json.contains("private?token"), "full URLs and query strings must be redacted")

    let persistenceKillPayload = NativeLogPrivacy.sanitizePayload([
      "details": [
        "provider": "zmx",
        "reason": "sleepSession",
        "sessionId": "S456",
        "stderrBytes": 128,
        "stdoutBytes": 64,
        "terminationStatus": 0,
      ],
      "event": "nativeWorkspace.persistenceSessionKill.completed",
    ])
    let persistenceKillJson = serializePrivacyTestPayload(persistenceKillPayload)

    assertTrue(persistenceKillJson.contains("nativeWorkspace.persistenceSessionKill.completed"), "persistence kill event should remain visible")
    assertTrue(persistenceKillJson.contains("stderrBytes"), "stderr byte count should remain visible")
    assertTrue(persistenceKillJson.contains("stdoutBytes"), "stdout byte count should remain visible")
    assertTrue(!persistenceKillJson.contains("sessionName"), "persistence kill logs must not include provider session-name keys")
    assertTrue(!persistenceKillJson.contains("stderr\":\""), "persistence kill logs must not include stderr text")
    assertTrue(!persistenceKillJson.contains("stdout\":\""), "persistence kill logs must not include stdout text")
    assertTrue(!persistenceKillJson.contains("P1.S2"), "persistence kill logs must not include raw zmx names")

    let hotkeyReproPayload = NativeLogPrivacy.sanitizePayload([
      "actionId": "focusNextSession",
      "commandText": "codex --ask private request",
      "event": "nativeHotkeys.navigationRepro",
      "hotkey": "cmd+shift+]",
      "keyCode": "30",
      "phase": "appKitObserved",
      "projectName": "Private Customer Project",
      "projectPath": "/Users/person/dev/private-customer",
      "secretToken": "secret-token",
      "url": "https://example.test/private?token=secret-token",
    ])
    let hotkeyReproJson = serializePrivacyTestPayload(hotkeyReproPayload)

    assertTrue(hotkeyReproJson.contains("nativeHotkeys.navigationRepro"), "hotkey repro event should remain visible")
    assertTrue(hotkeyReproJson.contains("focusNextSession"), "hotkey repro action id should remain visible")
    assertTrue(hotkeyReproJson.contains("cmd+shift+]"), "hotkey repro shortcut id should remain visible")
    assertTrue(!hotkeyReproJson.contains("Private Customer Project"), "hotkey repro logs must not include project names")
    assertTrue(!hotkeyReproJson.contains("/Users/person"), "hotkey repro logs must not include paths")
    assertTrue(!hotkeyReproJson.contains("codex --ask private request"), "hotkey repro logs must not include command text")
    assertTrue(!hotkeyReproJson.contains("secret-token"), "hotkey repro logs must not include secrets")
    assertTrue(!hotkeyReproJson.contains("private?token"), "hotkey repro logs must not include full URLs or query strings")

    let terminalDropPayload = NativeLogPrivacy.sanitizePayload([
      "activeDropEventNumber": 1,
      "commandText": "codex --ask private request",
      "dragPasteboardChangeCount": 42,
      "event": "nativeWorkspace.terminalDrop.surface.entered",
      "filePath": "/Users/person/Pictures/private image.png",
      "hasRecentReleaseOnlyDragSignal": true,
      "phase": "entered",
      "registeredTypes": [
        "com.apple.finder.node",
        "com.apple.pasteboard.promised-file-url",
        "public.file-url",
        "public.url",
        "public.image",
      ],
      "releaseOnlyDragSignalAgeMs": 14,
      "releaseOnlyDragSignalPasteboardChangeCount": 42,
      "secretToken": "secret-token",
      "surfaceSessionId": "G456",
      "types": ["Apple URL pasteboard type", "NSFilenamesPboardType", "public.file-url", "public.url", "public.png", "public.jpeg"],
      "url": "file:///Users/person/Pictures/private%20image.png",
    ])
    let terminalDropJson = serializePrivacyTestPayload(terminalDropPayload)

    assertTrue(terminalDropJson.contains("nativeWorkspace.terminalDrop.surface.entered"), "terminal drop event should remain visible")
    assertTrue(terminalDropJson.contains("G456"), "terminal drop session id should remain visible")
    assertTrue(terminalDropJson.contains("public.file-url"), "terminal drop pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("public.url"), "terminal drop URL pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("public.jpeg"), "terminal drop image pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("com.apple.finder.node"), "terminal drop Finder pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("NSFilenamesPboardType"), "terminal drop legacy filenames pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("releaseOnlyDragSignalAgeMs"), "terminal drop release-only signal timing should remain visible")
    assertTrue(terminalDropJson.contains("releaseOnlyDragSignalPasteboardChangeCount"), "terminal drop release-only signal pasteboard count should remain visible")
    assertTrue(!terminalDropJson.contains("/Users/person"), "terminal drop logs must not include dropped paths")
    assertTrue(!terminalDropJson.contains("private image.png"), "terminal drop logs must not include dropped filenames")
    assertTrue(!terminalDropJson.contains("codex --ask private request"), "terminal drop logs must not include command text")
    assertTrue(!terminalDropJson.contains("secret-token"), "terminal drop logs must not include secrets")

    assertTrue(
      isNativePersistentTerminalDropReproEvent("nativeWorkspace.terminalDrop.surface.entered", force: true),
      "forced terminal drop events should persist for repros")
    assertTrue(
      !isNativePersistentTerminalDropReproEvent("nativeWorkspace.terminalDrop.surface.updated", force: false),
      "non-forced terminal drop updates should stay quiet unless debugging mode is enabled")
    assertTrue(
      !isNativePersistentTerminalDropReproEvent("nativeWorkspace.unrelated", force: true),
      "unrelated forced events should not use the terminal drop repro gate")

    assertTrue(
      isNativePersistentLogImportantDiagnostic("nativeSidebar.gxserver.sessionTitleEventFailed"),
      "failed native diagnostic events should persist in normal mode")
    assertTrue(
      isNativePersistentLogImportantDiagnostic("nativeWorkspace.runtime.timeout"),
      "timeout native diagnostic events should persist in normal mode")
    assertTrue(
      !isNativePersistentLogImportantDiagnostic("nativeSidebar.gxserver.presentationDelta.applied"),
      "routine native diagnostic events should require debugging mode")
  }
}
