import Foundation

struct GxserverClientStatus {
  let authToken: String?
  let health: [String: Any]?
  let message: String
  let ok: Bool
  let state: String

  func payload(baseURL: String, tokenFile: String) -> [String: Any] {
    var payload: [String: Any] = [
      "baseUrl": baseURL,
      "message": message,
      "ok": ok,
      "protocolVersion": GxserverClient.protocolVersion,
      "state": state,
      "tokenFile": tokenFile,
    ]
    if let authToken {
      payload["authToken"] = authToken
    }
    if let health {
      payload["health"] = health
    }
    return payload
  }
}

enum GxserverBuildIdentityReuseDecision: Equatable {
  case compatible
  case incompatible
  case unknownExpected
}

final class GxserverClient {
  static let localBaseURL = "http://127.0.0.1:58744"
  static let protocolVersion = 1

  private static let expectedProduct = "gxserver"
  private static let minimumNodeMajor = 22
  private static let nodeInstallURL = "https://nodejs.org/en/download"
  private let fileManager = FileManager.default

  /*
   CDXC:GxserverBootstrap 2026-05-30-15:39:
   The macOS app hard-cutover starts or reuses the local gxserver control plane on 127.0.0.1:58744, authenticates with ~/.ghostex/gxserver/auth/token, and never owns daemon shutdown after launch. Missing or old system Node is a user-visible dependency error with install guidance, not an auto-install or bundled fallback.
  */
  func startOrReuse() async -> GxserverClientStatus {
    let expectedBuildIdentity = expectedBundledBuildIdentity()
    if let running = await authenticatedHealthStatus(expectedBuildIdentity: expectedBuildIdentity) {
      if !Self.reuseFailureRequiresRestart(running.state) {
        return running
      }
      await stopRunningGxserverControlPlane()
    }

    if let nodeError = systemNodeDependencyError() {
      return GxserverClientStatus(
        authToken: readAuthToken(),
        health: nil,
        message: nodeError,
        ok: false,
        state: "nodeUnavailable"
      )
    }

    guard let cliURL = resolveGxserverCliURL() else {
      return GxserverClientStatus(
        authToken: readAuthToken(),
        health: nil,
        message:
          "gxserver CLI build output is missing. Run `npm run build` in gxserver/ for development, or reinstall Ghostex so gxserver/dist/src/cli.js is present.",
        ok: false,
        state: "missingGxserverCli"
      )
    }

    if let launchError = launchGxserverForeground(cliURL: cliURL) {
      return GxserverClientStatus(
        authToken: readAuthToken(),
        health: nil,
        message: launchError,
        ok: false,
        state: "startFailed"
      )
    }

    let deadline = Date().addingTimeInterval(15)
    while Date() < deadline {
      if let running = await authenticatedHealthStatus(expectedBuildIdentity: expectedBuildIdentity) {
        return running
      }
      try? await Task.sleep(nanoseconds: 150_000_000)
    }

    return GxserverClientStatus(
      authToken: readAuthToken(),
      health: nil,
      message: "gxserver launch completed, but authenticated health did not become ready on 127.0.0.1:58744.",
      ok: false,
      state: "starting"
    )
  }

  func webBootstrap() -> [String: Any] {
    var bootstrap: [String: Any] = [
      "baseUrl": Self.localBaseURL,
      "protocolVersion": Self.protocolVersion,
      "tokenFile": authTokenURL.path,
    ]
    if let authToken = readAuthToken() {
      bootstrap["authToken"] = authToken
    }
    return bootstrap
  }

  func statusPayload(_ status: GxserverClientStatus) -> [String: Any] {
    status.payload(baseURL: Self.localBaseURL, tokenFile: authTokenURL.path)
  }

  private func authenticatedHealthStatus(expectedBuildIdentity: String?) async -> GxserverClientStatus? {
    guard let token = readAuthToken() else {
      return nil
    }
    guard
      let response = await fetchJSON(
        path: "/api/health/server",
        token: token,
        timeoutSeconds: 1
      )
    else {
      return nil
    }
    let product = response["product"] as? String
    let protocolVersion = response["protocolVersion"] as? Int
    guard product == Self.expectedProduct else {
      return nil
    }
    guard protocolVersion == Self.protocolVersion else {
      return GxserverClientStatus(
        authToken: token,
        health: response,
        message:
          "gxserver protocol mismatch. Expected protocol \(Self.protocolVersion), got \(String(describing: response["protocolVersion"])). Update Ghostex and gxserver so their protocol versions match.",
        ok: false,
        state: "protocolMismatch"
      )
    }
    switch Self.buildIdentityReuseDecision(response: response, expectedBuildIdentity: expectedBuildIdentity) {
    case .compatible, .unknownExpected:
      break
    case .incompatible:
      return GxserverClientStatus(
        authToken: token,
        health: response,
        message:
          "gxserver build identity changed. Relaunching gxserver from the current Ghostex bundle before loading the sidebar.",
        ok: false,
        state: "buildIdentityMismatch"
      )
    }
    let usableTools = requiredBundledToolsAvailable(in: response)
    return GxserverClientStatus(
      authToken: token,
      health: response,
      message: usableTools
        ? "gxserver is running and uses the expected protocol."
        : "gxserver is running, but its bundled zmx/zehn tools are unavailable. Relaunching gxserver from the current Ghostex bundle.",
      ok: usableTools,
      state: usableTools ? "running" : "toolchainUnavailable"
    )
  }

  /*
   CDXC:GxserverBootstrap 2026-05-30-23:47:
   A Ghostex app update can keep the gxserver protocol stable while changing server behavior. Compare authenticated daemon health against the build identity bundled beside the current app's gxserver CLI, and restart only on a definite mismatch so same-build daemon reuse still avoids unnecessary zmx control-plane churn.
   */
  static func buildIdentityReuseDecision(
    response: [String: Any],
    expectedBuildIdentity: String?
  ) -> GxserverBuildIdentityReuseDecision {
    guard let expected = expectedBuildIdentity?.trimmingCharacters(in: .whitespacesAndNewlines), !expected.isEmpty else {
      return .unknownExpected
    }
    return (response["buildIdentity"] as? String) == expected ? .compatible : .incompatible
  }

  private static func reuseFailureRequiresRestart(_ state: String) -> Bool {
    state == "toolchainUnavailable" || state == "buildIdentityMismatch"
  }

  /*
   CDXC:GxserverBootstrap 2026-05-30-17:01:
   `bun run start` can replace `/Applications/Ghostex.app` while a previous gxserver control plane still points at an older app bundle. Reusing that daemon breaks zmx persistence because bundled zmx/zehn paths go stale, so macOS startup must restart only the gxserver control plane when required bundled tools are unavailable. The gxserver stop API deliberately does not signal or kill zmx sessions.
   */
  private func requiredBundledToolsAvailable(in response: [String: Any]) -> Bool {
    guard let tools = response["tools"] as? [[String: Any]] else {
      return true
    }
    for requiredTool in ["zmx", "zehn"] {
      guard let tool = tools.first(where: { ($0["tool"] as? String) == requiredTool }) else {
        return false
      }
      if (tool["availability"] as? String) != "available" {
        return false
      }
    }
    return true
  }

  private func stopRunningGxserverControlPlane() async {
    guard let token = readAuthToken(),
      let url = URL(string: "\(Self.localBaseURL)/api/control/stop")
    else {
      return
    }
    var request = URLRequest(url: url, timeoutInterval: 2)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(String(Self.protocolVersion), forHTTPHeaderField: "x-gxserver-protocol-version")
    _ = try? await URLSession.shared.data(for: request)

    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline {
      if await authenticatedHealthStatus(expectedBuildIdentity: nil) == nil {
        return
      }
      try? await Task.sleep(nanoseconds: 100_000_000)
    }
  }

  private func fetchJSON(path: String, token: String, timeoutSeconds: TimeInterval) async -> [String: Any]? {
    guard let url = URL(string: "\(Self.localBaseURL)\(path)") else {
      return nil
    }
    var request = URLRequest(url: url, timeoutInterval: timeoutSeconds)
    request.httpMethod = "GET"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(String(Self.protocolVersion), forHTTPHeaderField: "x-gxserver-protocol-version")
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
        return nil
      }
      return try JSONSerialization.jsonObject(with: data) as? [String: Any]
    } catch {
      return nil
    }
  }

  private func launchGxserverForeground(cliURL: URL) -> String? {
    /*
     CDXC:GxserverBootstrap 2026-05-30-17:06:
     LaunchServices-started macOS apps should create gxserver as an app-independent background daemon by running `nohup node <gxserver> --foreground &` and then polling authenticated health. The UI app must not retain a Swift Process handle as daemon ownership, because gxserver must survive closing the macOS app and continue managing zmx sessions.
     */
    let nodePath = systemNodeExecutablePath() ?? "node"
    let launchLogPath = gxserverLaunchLogURL.path
    try? fileManager.createDirectory(
      at: gxserverLaunchLogURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    let command =
      "nohup \(shellQuote(nodePath)) \(shellQuote(cliURL.path)) --foreground >>\(shellQuote(launchLogPath)) 2>&1 </dev/null &"
    let result = runProcess(
      executable: "/bin/sh",
      arguments: ["-c", command],
      timeoutSeconds: 3
    )
    if result.exitCode != 0 {
      let stderr = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
      let stdout = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
      return stderr.isEmpty ? (stdout.isEmpty ? "gxserver failed to launch." : stdout) : stderr
    }
    return nil
  }

  private func systemNodeExecutablePath() -> String? {
    let result = runProcess(
      executable: "/usr/bin/env",
      arguments: ["node", "-p", "process.execPath"],
      timeoutSeconds: 3
    )
    guard result.exitCode == 0 else {
      return nil
    }
    let path = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    return path.isEmpty ? nil : path
  }

  private func shellQuote(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }

  private var gxserverLaunchLogURL: URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".ghostex", isDirectory: true)
      .appendingPathComponent("gxserver", isDirectory: true)
      .appendingPathComponent("logs", isDirectory: true)
      .appendingPathComponent("macos-launch.log", isDirectory: false)
  }

  private var authTokenURL: URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".ghostex", isDirectory: true)
      .appendingPathComponent("gxserver", isDirectory: true)
      .appendingPathComponent("auth", isDirectory: true)
      .appendingPathComponent("token", isDirectory: false)
  }

  private func readAuthToken() -> String? {
    guard let data = try? Data(contentsOf: authTokenURL),
      let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !token.isEmpty
    else {
      return nil
    }
    return token
  }

  private func resolveGxserverCliURL() -> URL? {
    let cwd = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
    var sourceRoot = URL(fileURLWithPath: #filePath, isDirectory: false)
    for _ in 0..<6 {
      sourceRoot.deleteLastPathComponent()
    }
    let candidates = [
      Bundle.main.resourceURL?.appendingPathComponent("Web/gxserver/dist/src/cli.js"),
      Bundle.main.resourceURL?.appendingPathComponent("gxserver/dist/src/cli.js"),
      cwd.appendingPathComponent("gxserver/dist/src/cli.js"),
      sourceRoot.appendingPathComponent("gxserver/dist/src/cli.js"),
    ].compactMap { $0 }
    return candidates.first { fileManager.fileExists(atPath: $0.path) }
  }

  private func expectedBundledBuildIdentity() -> String? {
    guard let cliURL = resolveGxserverCliURL() else {
      return nil
    }
    let packageRoot = cliURL
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let identityURL = packageRoot.appendingPathComponent("build-identity.json", isDirectory: false)
    if fileManager.fileExists(atPath: identityURL.path) {
      guard
        let data = try? Data(contentsOf: identityURL),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let buildIdentity = json["buildIdentity"] as? String,
        !buildIdentity.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else {
        return "invalid-gxserver-build-identity:\(identityURL.path)"
      }
      return buildIdentity
    }
    let packageJsonURL = packageRoot.appendingPathComponent("package.json", isDirectory: false)
    guard
      let data = try? Data(contentsOf: packageJsonURL),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let version = json["version"] as? String,
      !version.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return nil
    }
    return "gxserver:\(version):source"
  }

  private func systemNodeDependencyError() -> String? {
    let result = runProcess(
      executable: "/usr/bin/env",
      arguments: ["node", "-v"],
      timeoutSeconds: 3
    )
    if result.exitCode != 0 {
      return
        "gxserver requires Node.js \(Self.minimumNodeMajor) LTS or newer, but Node was not found. Install Node \(Self.minimumNodeMajor) LTS or newer from \(Self.nodeInstallURL) or with a system package manager such as Homebrew. Ghostex does not bundle, auto-install, or fall back to a private Node runtime for gxserver."
    }
    let version = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalized = version.hasPrefix("v") ? String(version.dropFirst()) : version
    let majorText = normalized.split(separator: ".").first.map(String.init) ?? ""
    let major = Int(majorText)
    if major == nil || major! < Self.minimumNodeMajor {
      return
        "gxserver requires Node.js \(Self.minimumNodeMajor) LTS or newer, but found \(version.isEmpty ? "an unknown Node version" : version). Install Node \(Self.minimumNodeMajor) LTS or newer from \(Self.nodeInstallURL) or with a system package manager such as Homebrew. Ghostex does not bundle, auto-install, or fall back to a private Node runtime for gxserver."
    }
    return nil
  }

  private func runProcess(
    executable: String,
    arguments: [String],
    timeoutSeconds: TimeInterval
  ) -> (exitCode: Int32, stdout: String, stderr: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = normalizedProcessEnvironment()
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    do {
      try process.run()
    } catch {
      return (127, "", error.localizedDescription)
    }
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while process.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
    if process.isRunning {
      process.terminate()
      return (124, readPipe(stdout), "Timed out running \(executable) \(arguments.joined(separator: " ")).")
    }
    return (process.terminationStatus, readPipe(stdout), readPipe(stderr))
  }

  private func readPipe(_ pipe: Pipe) -> String {
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
  }

  private func normalizedProcessEnvironment() -> [String: String] {
    var environment = ProcessInfo.processInfo.environment
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    /*
     CDXC:GxserverBootstrap 2026-05-30-17:14:
     App-packaged gxserver includes production native modules, so the macOS bootstrap should prefer stable system package-manager Node paths before per-shell version-manager shims. Version-manager shims remain supported, but only after Homebrew/usr-local candidates to avoid loading a different Node ABI than the packaged runtime was built with.
     */
    let defaultEntries = [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "\(home)/.local/share/mise/shims",
      "\(home)/.local/bin",
      "\(home)/.asdf/shims",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ]
    let existingEntries = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
    var seen = Set<String>()
    environment["PATH"] = (defaultEntries + existingEntries)
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { entry in
        guard !entry.isEmpty, !seen.contains(entry) else {
          return false
        }
        seen.insert(entry)
        return true
      }
      .joined(separator: ":")
    return environment
  }
}
