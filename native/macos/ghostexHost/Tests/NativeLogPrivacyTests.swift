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
