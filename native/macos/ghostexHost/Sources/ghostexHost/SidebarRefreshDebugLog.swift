import Foundation

enum SidebarRefreshDebugLog {
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
   CDXC:SidebarRefreshDiagnostics 2026-05-11-12:32
   Unexpected sidebar refresh repros need a dedicated app-storage log that
   records native action boundaries and React sidebar lifecycle events. Honor
   Settings Debugging Mode here as the final gate so no persistent sidebar
   refresh diagnostics are written during normal app use.
   */
  static func append(event: String, details: String?) {
    guard NativeDebugLogging.isEnabled else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("sidebar-refresh-debug.log")
    let payload: [String: Any] = [
      "details": details ?? NSNull(),
      "event": event,
    ]
    let line = "[\(logDateFormatter.string(from: Date()))] \(serialize(NativeLogPrivacy.sanitizePayload(payload)))\n"

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
      NSLog("failed to write sidebar refresh debug log: \(NativeLogPrivacy.sanitizeLogLine(error.localizedDescription))")
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
