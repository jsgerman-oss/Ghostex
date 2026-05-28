import Foundation
import Security

final class LidSleepPrivilegedHelperClient {
  static let shared = LidSleepPrivilegedHelperClient()

  private let helperLabel: String

  init(bundleIdentifier: String? = Bundle.main.bundleIdentifier) {
    helperLabel = "\(bundleIdentifier ?? "com.madda.ghostex.host").LidSleepHelper"
  }

  func setEnabled(
    _ enabled: Bool,
    requestId: String,
    installIfNeeded: Bool,
    sendEvent: @escaping (HostEvent) -> Void
  ) {
    setEnabled(enabled, installIfNeeded: installIfNeeded) { result in
      sendEvent(
        .processResult(
          requestId: requestId,
          exitCode: result.ok ? 0 : 1,
          stdout: result.ok ? "ok" : "",
          stderr: result.error ?? ""
        ))
    }
  }

  func setEnabled(_ enabled: Bool, installIfNeeded: Bool, completion: @escaping ((ok: Bool, error: String?)) -> Void) {
    /**
     CDXC:TitlebarKeepAwake 2026-05-28-19:28:
     Closed-lid keep-awake needs one privileged helper installation, not a
     password prompt for every toggle. Only the enable path may install the
     helper; disabling should use the already-installed helper so Allow Sleep
     Now and app quit do not ask for credentials.
     */
    callSetEnabled(enabled) { [weak self] result in
      guard let self else {
        completion(result)
        return
      }
      if result.ok || !installIfNeeded || !enabled {
        completion(result)
        return
      }
      self.installHelper { installResult in
        if !installResult.ok {
          completion(installResult)
          return
        }
        self.callSetEnabled(enabled, completion: completion)
      }
    }
  }

  func heartbeat(completion: @escaping ((ok: Bool, error: String?)) -> Void) {
    let connection = makeConnection()
    var completed = false
    let finish: ((Bool, String?) -> Void) = { ok, error in
      if completed {
        return
      }
      completed = true
      completion((ok, error))
    }
    connection.remoteObjectInterface = NSXPCInterface(with: GhostexLidSleepHelperProtocol.self)
    connection.invalidationHandler = {
      finish(false, "lid-sleep-helper-connection-invalidated")
    }
    connection.interruptionHandler = {
      finish(false, "lid-sleep-helper-connection-interrupted")
    }
    connection.resume()
    guard let helper = connection.remoteObjectProxyWithErrorHandler({ error in
      finish(false, error.localizedDescription)
      connection.invalidate()
    }) as? GhostexLidSleepHelperProtocol else {
      finish(false, "lid-sleep-helper-proxy-unavailable")
      connection.invalidate()
      return
    }
    helper.heartbeat(ownerPID: ProcessInfo.processInfo.processIdentifier) { ok, error in
      finish(ok, error)
      connection.invalidate()
    }
  }

  private func callSetEnabled(
    _ enabled: Bool,
    completion: @escaping ((ok: Bool, error: String?)) -> Void
  ) {
    let connection = makeConnection()
    var completed = false
    let finish: ((Bool, String?) -> Void) = { ok, error in
      if completed {
        return
      }
      completed = true
      completion((ok, error))
    }
    connection.remoteObjectInterface = NSXPCInterface(with: GhostexLidSleepHelperProtocol.self)
    connection.invalidationHandler = {
      finish(false, "lid-sleep-helper-connection-invalidated")
    }
    connection.interruptionHandler = {
      finish(false, "lid-sleep-helper-connection-interrupted")
    }
    connection.resume()
    guard let helper = connection.remoteObjectProxyWithErrorHandler({ error in
      finish(false, error.localizedDescription)
      connection.invalidate()
    }) as? GhostexLidSleepHelperProtocol else {
      finish(false, "lid-sleep-helper-proxy-unavailable")
      connection.invalidate()
      return
    }
    helper.setLidSleepPreventionEnabled(
      enabled,
      ownerPID: ProcessInfo.processInfo.processIdentifier
    ) { ok, error in
      finish(ok, error)
      connection.invalidate()
    }
  }

  private func makeConnection() -> NSXPCConnection {
    NSXPCConnection(machServiceName: helperLabel, options: .privileged)
  }

  private func installHelper(completion: @escaping ((ok: Bool, error: String?)) -> Void) {
    let appBundleURL = Bundle.main.bundleURL
    guard let appBundleIdentifier = Bundle.main.bundleIdentifier else {
      completion((false, "Ghostex bundle metadata is missing."))
      return
    }
    guard let appRequirement = Self.designatedRequirementString(for: appBundleURL) else {
      completion((false, "Ghostex signing requirement is unavailable."))
      return
    }
    let helperSourceURL = appBundleURL
      .appendingPathComponent("Contents/Library/LaunchServices", isDirectory: true)
      .appendingPathComponent(helperLabel, isDirectory: false)
    guard FileManager.default.isExecutableFile(atPath: helperSourceURL.path) else {
      completion((false, "Bundled lid sleep helper is missing."))
      return
    }
    do {
      let scriptURL = try writeInstallerScript(
        appBundlePath: appBundleURL.path,
        appBundleIdentifier: appBundleIdentifier,
        appRequirement: appRequirement,
        helperSourcePath: helperSourceURL.path
      )
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
      process.arguments = [
        "-e",
        "do shell script \(appleScriptString("/bin/sh \(shellQuote(scriptURL.path))")) with administrator privileges",
      ]
      let pipe = Pipe()
      process.standardInput = FileHandle.nullDevice
      process.standardOutput = pipe
      process.standardError = pipe
      try process.run()
      process.waitUntilExit()
      try? FileManager.default.removeItem(at: scriptURL)
      let data = pipe.fileHandleForReading.readDataToEndOfFile()
      let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      if process.terminationStatus == 0 {
        completion((true, nil))
      } else {
        completion((false, output?.isEmpty == false ? output : "helper installer exited \(process.terminationStatus)"))
      }
    } catch {
      completion((false, error.localizedDescription))
    }
  }

  private func writeInstallerScript(
    appBundlePath: String,
    appBundleIdentifier: String,
    appRequirement: String,
    helperSourcePath: String
  ) throws -> URL {
    let scriptURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("ghostex-lid-sleep-helper-\(UUID().uuidString).sh")
    let helperDestination = "/Library/PrivilegedHelperTools/\(helperLabel)"
    let configDestination = "\(helperDestination).config.plist"
    let plistDestination = "/Library/LaunchDaemons/\(helperLabel).plist"
    let script = """
      #!/bin/sh
      set -eu
      /usr/bin/install -o root -g wheel -m 755 \(shellQuote(helperSourcePath)) \(shellQuote(helperDestination))
      /bin/cat > \(shellQuote(configDestination)) <<'EOF_CONFIG'
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>AuthorizedClientBundleIdentifiers</key>
        <array>
          <string>\(escapePlist(appBundleIdentifier))</string>
        </array>
        <key>AuthorizedClientBundlePath</key>
        <string>\(escapePlist(appBundlePath))</string>
        <key>AuthorizedClientRequirement</key>
        <string>\(escapePlist(appRequirement))</string>
      </dict>
      </plist>
      EOF_CONFIG
      /usr/sbin/chown root:wheel \(shellQuote(configDestination))
      /bin/chmod 644 \(shellQuote(configDestination))
      /bin/cat > \(shellQuote(plistDestination)) <<'EOF_PLIST'
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>\(escapePlist(helperLabel))</string>
        <key>MachServices</key>
        <dict>
          <key>\(escapePlist(helperLabel))</key>
          <true/>
        </dict>
        <key>ProgramArguments</key>
        <array>
          <string>\(escapePlist(helperDestination))</string>
        </array>
        <key>RunAtLoad</key>
        <true/>
      </dict>
      </plist>
      EOF_PLIST
      /usr/sbin/chown root:wheel \(shellQuote(plistDestination))
      /bin/chmod 644 \(shellQuote(plistDestination))
      /bin/launchctl bootout system \(shellQuote(plistDestination)) >/dev/null 2>&1 || true
      /bin/launchctl bootstrap system \(shellQuote(plistDestination))
      /bin/launchctl kickstart -k system/\(shellQuote(helperLabel)) >/dev/null 2>&1 || true
      """
    try script.write(to: scriptURL, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: scriptURL.path)
    return scriptURL
  }

  private func shellQuote(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }

  private func appleScriptString(_ value: String) -> String {
    "\"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
  }

  private func escapePlist(_ value: String) -> String {
    value
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&apos;")
  }

  private static func designatedRequirementString(for appBundleURL: URL) -> String? {
    /**
     CDXC:TitlebarKeepAwake 2026-05-28-20:18:
     The privileged helper should authorize the configured Ghostex app by its
     code-signing requirement, not just by bundle id or filesystem path. The
     installer records the current app requirement in the root-owned helper
     config so the helper can reject unrelated clients with the same identifier.
     */
    var staticCode: SecStaticCode?
    guard SecStaticCodeCreateWithPath(appBundleURL as CFURL, SecCSFlags(), &staticCode) == errSecSuccess,
      let staticCode
    else {
      return nil
    }
    var requirement: SecRequirement?
    guard SecCodeCopyDesignatedRequirement(staticCode, SecCSFlags(), &requirement) == errSecSuccess,
      let requirement
    else {
      return nil
    }
    var requirementText: CFString?
    guard SecRequirementCopyString(requirement, SecCSFlags(), &requirementText) == errSecSuccess else {
      return nil
    }
    return requirementText as String?
  }
}
