import Foundation

enum NativePaneReorderReproLog {
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
   CDXC:NativePaneReorderDiagnostics 2026-05-10-12:32
   Bottom-edge terminal selection can still be misclassified as pane reordering.
   Keep this issue in a dedicated shared logs file so repro timestamps can be
   isolated from normal focus, sidebar, T3, and browser diagnostics.
   */
  static func append(event: String, details: [String: Any] = [:]) {
    let logsDirectory = ZmuxAppStorage.sharedRootDirectory.appendingPathComponent(
      "logs", isDirectory: true)
    let logURL = logsDirectory.appendingPathComponent("native-pane-reorder-repro.log")

    var payload = details
    payload["event"] = event
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
      NSLog("failed to write native pane reorder repro log: \(error.localizedDescription)")
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
