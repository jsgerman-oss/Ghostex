import Foundation
import OSLog

enum PromptEditorDebugLog {
  private static let logger = Logger(
    subsystem: "com.madda.ghostex.host", category: "prompt-editor-debug")
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
   CDXC:PromptEditor 2026-05-19-11:20:
   Prompt-editor caret and click failures need a dedicated app-storage log file
   gated by Settings debugging mode. Record Monaco init, native hit regions,
   modal-host visibility, and prewarm timing so repros can be correlated by
   timestamp without mixing into agent-detection or terminal-focus logs.
   */
  static func append(event: String, details: [String: Any] = [:]) {
    guard NativeDebugLogging.isEnabled else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("native-prompt-editor-debug.log")

    var payload = details
    payload["event"] = event
    payload["source"] = payload["source"] ?? "native"
    let line = "[\(logDateFormatter.string(from: Date()))] \(serialize(payload))\n"

    do {
      if !didCreateLogsDirectory {
        try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
        didCreateLogsDirectory = true
      }
      if FileManager.default.fileExists(atPath: logURL.path) {
        let handle = try FileHandle(forWritingTo: logURL)
        try handle.seekToEnd()
        if let data = line.data(using: .utf8) {
          try handle.write(contentsOf: data)
        }
        try handle.close()
      } else {
        try line.write(to: logURL, atomically: true, encoding: .utf8)
      }
    } catch {
      logger.warning("failed to write prompt editor debug log: \(error.localizedDescription)")
    }
  }

  static func append(event: String, details: String?) {
    if let details, !details.isEmpty {
      append(event: event, details: ["details": details])
    } else {
      append(event: event)
    }
  }

  private static func serialize(_ payload: [String: Any]) -> String {
    guard JSONSerialization.isValidJSONObject(payload),
      let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8)
    else {
      return "{\"event\":\"serializationFailed\"}"
    }
    return json
  }
}
