import Foundation

enum TerminalFocusDebugLog {
  private static let noisyEvents = Set([
    "nativeSidebar.postNative",
    "nativeHotkeys.appKitKeyEquivalent",
    "nativeHotkeys.appKitNoAction",
    "nativeHotkeys.appKitNoMatch",
    "nativeHotkeys.domKeyIgnored",
    "nativeWorkspace.focusedResponderIgnored",
    "nativeWorkspace.setActiveTerminalSet.applied",
    "nativeWorkspace.terminalFocused.emitted",
    "nativeSidebar.terminalFocused.applied",
    "nativeSidebar.terminalFocused.duplicateSkipped",
    "nativeWorkspace.terminalResize",
    "nativeWorkspace.focusTerminal.completed",
    "nativeWorkspace.sendTerminalEnter.sent",
    "nativeWorkspace.sendTerminalEnter.start",
    "nativeWorkspace.setActiveTerminalSet.focusSkipped",
    "nativeWorkspace.setTerminalLayout",
    "nativeWorkspace.setTerminalVisibility",
    "nativeWorkspace.windowFirstResponderChanged.nil",
    "nativeWorkspace.windowFirstResponderChanged.programmaticSkipped",
    "nativeWorkspace.writeTerminalText",
  ])
  private static let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS ZZZZ"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    return formatter
  }()
  private static var didCreateLogsDirectory = false

  /**
   CDXC:NativeTerminalFocus 2026-05-08-16:41
   Split Ghostty focus debugging must land in a completely separate
   app storage logs file. These native entries record AppKit first-responder
   state only when debugging mode is enabled, with routine focus/layout/hotkey
   events suppressed so normal terminal use cannot generate oversized logs.

   CDXC:StartupPaneDiagnostics 2026-05-16-09:14:
   Startup pane-layout diagnostics must be available even when a restart-time
   tab/split restore bug happens before Debugging Mode is enabled. Use the
   nativePaneLayoutStartup prefix for those one-shot breadcrumbs while keeping
   the existing forced-repro and Settings-controlled logging paths intact.
   */
  static func append(event: String, details: [String: Any] = [:], force: Bool = false) {
    /**
     CDXC:Diagnostics 2026-05-16-07:23:
     Forced terminal-focus entries may bypass noisy-event suppression during a
     focused repro. Startup pane breadcrumbs use the same forced write path and
     a distinct prefix so they can be found after a restart-time layout restore
     issue without broadening routine focus logging.
     */
    let isStartupPaneLayoutEvent = event.hasPrefix("nativePaneLayoutStartup.")
    guard force || isStartupPaneLayoutEvent || (NativeDebugLogging.isEnabled && !noisyEvents.contains(event)) else {
      return
    }
    let logsDirectory = GhostexAppStorage.logsDirectory
    let logURL = logsDirectory.appendingPathComponent("native-terminal-focus-debug.log")

    var payload = details
    payload["event"] = event
    let serializedPayload = serialize(payload)
    let line = "[\(logDateFormatter.string(from: Date()))] \(serializedPayload)\n"

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
      NSLog("failed to write terminal focus debug log: \(error.localizedDescription)")
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

func nullableLogString(_ value: String?) -> Any {
  value ?? NSNull()
}
