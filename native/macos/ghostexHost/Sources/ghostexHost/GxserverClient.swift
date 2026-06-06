import Foundation

struct GxserverClientStatus {
  let alwaysStart: Bool
  let authToken: String?
  let health: [String: Any]?
  let message: String
  let nodeModuleVersion: String?
  let nodePath: String?
  let nodeVersion: String?
  let ok: Bool
  let expectedNodeMajor: Int?
  let expectedNodeModuleVersion: String?
  let state: String

  init(
    alwaysStart: Bool,
    authToken: String?,
    health: [String: Any]?,
    message: String,
    nodeModuleVersion: String? = nil,
    nodePath: String? = nil,
    nodeVersion: String? = nil,
    ok: Bool,
    expectedNodeMajor: Int? = nil,
    expectedNodeModuleVersion: String? = nil,
    state: String
  ) {
    self.alwaysStart = alwaysStart
    self.authToken = authToken
    self.health = health
    self.message = message
    self.nodeModuleVersion = nodeModuleVersion
    self.nodePath = nodePath
    self.nodeVersion = nodeVersion
    self.ok = ok
    self.expectedNodeMajor = expectedNodeMajor
    self.expectedNodeModuleVersion = expectedNodeModuleVersion
    self.state = state
  }

  func payload(baseURL: String, tokenFile: String) -> [String: Any] {
    var payload: [String: Any] = [
      "alwaysStart": alwaysStart,
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
    if let nodeModuleVersion {
      payload["nodeModuleVersion"] = nodeModuleVersion
    }
    if let nodePath {
      payload["nodePath"] = nodePath
    }
    if let nodeVersion {
      payload["nodeVersion"] = nodeVersion
    }
    if let expectedNodeMajor {
      payload["expectedNodeMajor"] = expectedNodeMajor
    }
    if let expectedNodeModuleVersion {
      payload["expectedNodeModuleVersion"] = expectedNodeModuleVersion
    }
    return payload
  }
}

enum GxserverBuildIdentityReuseDecision: Equatable {
  case compatible
  case incompatible
  case unknownExpected
}

struct GxserverNativeNodeRuntime: Equatable {
  let nativeModules: [String]
  let nodeMajor: Int
  let nodeModuleVersion: String
  let nodeRequirement: String?
  let nodeVersion: String?
}

enum GxserverNativeNodeRuntimeLoadResult: Equatable {
  case invalid(String)
  case loaded(GxserverNativeNodeRuntime)
  case unavailable
}

final class GxserverClient {
  static let localBaseURL = "http://127.0.0.1:58744"
  static let protocolVersion = 1

  private static let alwaysStartOnLaunchDefaultsKey = "ghostex.gxserver.alwaysStartOnLaunch"
  private static let expectedProduct = "gxserver"
  private static let minimumNodeMajor = 22
  private static let nodeInstallURL = "https://nodejs.org/en/download"
  private let fileManager = FileManager.default

  /*
   CDXC:GxserverBootstrap 2026-05-30-15:39:
   The macOS app hard-cutover starts or reuses the local gxserver control plane on 127.0.0.1:58744, authenticates with ~/.ghostex/gxserver/auth/token, and never owns daemon shutdown after launch. Missing or old system Node is a user-visible dependency error with install guidance, not an auto-install or bundled fallback.

   CDXC:GxserverBootstrap 2026-05-31-03:56:
   LaunchServices does not inherit the user's interactive shell PATH after a Mac restart. Resolve Node from deterministic system install locations before PATH shims, surface the exact daemon status to React, and let users disable future auto-start without adding sidebar restore fallbacks.
  */
  func startOrReuse(allowStart: Bool? = nil) async -> GxserverClientStatus {
    let shouldStart = allowStart ?? alwaysStartOnLaunch
    let expectedBuildIdentity = expectedBundledBuildIdentity()
    let expectedNativeRuntimeLoadResult = expectedBundledNativeNodeRuntime()
    if let running = await authenticatedHealthStatus(expectedBuildIdentity: expectedBuildIdentity) {
      if !Self.reuseFailureRequiresRestart(running.state) {
        return running
      }
      guard shouldStart else {
        return running
      }
      await stopRunningGxserverControlPlane()
    }

    guard shouldStart else {
      let stoppedMessage = alwaysStartOnLaunch
        ? "gxserver is stopped."
        : "gxserver is stopped. Enable Always start or start it from Resources when you need session restore."
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: readAuthToken(),
        health: nil,
        message: stoppedMessage,
        ok: true,
        state: "stopped"
      )
    }

    let expectedNativeRuntime: GxserverNativeNodeRuntime?
    switch expectedNativeRuntimeLoadResult {
    case .loaded(let runtime):
      expectedNativeRuntime = runtime
    case .unavailable:
      expectedNativeRuntime = nil
    case .invalid(let message):
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: readAuthToken(),
        health: nil,
        message: message,
        ok: false,
        state: "nodeUnavailable"
      )
    }

    let nodeResolution = resolveSystemNode(expectedRuntime: expectedNativeRuntime)
    if let nodeError = systemNodeDependencyError(resolution: nodeResolution, expectedRuntime: expectedNativeRuntime) {
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: readAuthToken(),
        health: nil,
        message: nodeError,
        nodeModuleVersion: nodeResolution.moduleVersion,
        nodePath: nodeResolution.path,
        nodeVersion: nodeResolution.version,
        ok: false,
        expectedNodeMajor: expectedNativeRuntime?.nodeMajor,
        expectedNodeModuleVersion: expectedNativeRuntime?.nodeModuleVersion,
        state: "nodeUnavailable"
      )
    }

    guard let cliURL = resolveGxserverCliURL() else {
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: readAuthToken(),
        health: nil,
        message:
          "gxserver CLI build output is missing. Run `npm run build` in gxserver/ for development, or reinstall Ghostex so gxserver/dist/src/cli.js is present.",
        nodeModuleVersion: nodeResolution.moduleVersion,
        nodePath: nodeResolution.path,
        nodeVersion: nodeResolution.version,
        ok: false,
        expectedNodeMajor: expectedNativeRuntime?.nodeMajor,
        expectedNodeModuleVersion: expectedNativeRuntime?.nodeModuleVersion,
        state: "missingGxserverCli"
      )
    }

    if let launchError = launchGxserverForeground(cliURL: cliURL, nodePath: nodeResolution.path) {
      return GxserverClientStatus(
        alwaysStart: alwaysStartOnLaunch,
        authToken: readAuthToken(),
        health: nil,
        message: launchError,
        nodeModuleVersion: nodeResolution.moduleVersion,
        nodePath: nodeResolution.path,
        nodeVersion: nodeResolution.version,
        ok: false,
        expectedNodeMajor: expectedNativeRuntime?.nodeMajor,
        expectedNodeModuleVersion: expectedNativeRuntime?.nodeModuleVersion,
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
      alwaysStart: alwaysStartOnLaunch,
      authToken: readAuthToken(),
      health: nil,
      message: "gxserver launch completed, but authenticated health did not become ready on 127.0.0.1:58744.",
      nodeModuleVersion: nodeResolution.moduleVersion,
      nodePath: nodeResolution.path,
      nodeVersion: nodeResolution.version,
      ok: false,
      expectedNodeMajor: expectedNativeRuntime?.nodeMajor,
      expectedNodeModuleVersion: expectedNativeRuntime?.nodeModuleVersion,
      state: "starting"
    )
  }

  var alwaysStartOnLaunch: Bool {
    get {
      if UserDefaults.standard.object(forKey: Self.alwaysStartOnLaunchDefaultsKey) == nil {
        return true
      }
      return UserDefaults.standard.bool(forKey: Self.alwaysStartOnLaunchDefaultsKey)
    }
    set {
      UserDefaults.standard.set(newValue, forKey: Self.alwaysStartOnLaunchDefaultsKey)
    }
  }

  func startingStatus(message: String = "Starting gxserver...") -> GxserverClientStatus {
    GxserverClientStatus(
      alwaysStart: alwaysStartOnLaunch,
      authToken: readAuthToken(),
      health: nil,
      message: message,
      ok: true,
      state: "starting"
    )
  }

  func stoppedStatus(message: String = "gxserver is stopped.") -> GxserverClientStatus {
    GxserverClientStatus(
      alwaysStart: alwaysStartOnLaunch,
      authToken: readAuthToken(),
      health: nil,
      message: message,
      ok: true,
      state: "stopped"
    )
  }

  func stopControlPlane() async -> GxserverClientStatus {
    await stopRunningGxserverControlPlane()
    return stoppedStatus()
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

  /*
   CDXC:GxserverMacClient 2026-05-31-01:32:
   Some native sidebar calls still travel through the authenticated Swift bridge instead of direct WebKit fetch so React never reads the bearer token from disk. Keep this bridge path on the same fixed local gxserver endpoint, bearer-token header, and protocol header as the bootstrap client.
   */
  static func request(_ command: GxserverRequest) async -> HostEvent {
    await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .utility).async {
        do {
          let token = try readBridgeAuthToken()
          let response = try performBridgeRequest(command, token: token)
          continuation.resume(returning: .gxserverResponse(
            requestId: command.requestId,
            path: command.path,
            ok: (200..<300).contains(response.statusCode),
            statusCode: response.statusCode,
            bodyJson: response.body,
            error: nil
          ))
        } catch {
          continuation.resume(returning: .gxserverResponse(
            requestId: command.requestId,
            path: command.path,
            ok: false,
            statusCode: nil,
            bodyJson: nil,
            error: error.localizedDescription
          ))
        }
      }
    }
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
        alwaysStart: alwaysStartOnLaunch,
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
        alwaysStart: alwaysStartOnLaunch,
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
      alwaysStart: alwaysStartOnLaunch,
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

  private func launchGxserverForeground(cliURL: URL, nodePath: String) -> String? {
    /*
     CDXC:GxserverBootstrap 2026-05-30-17:06:
     LaunchServices-started macOS apps should create gxserver as an app-independent background daemon by running `nohup node <gxserver> --foreground &` and then polling authenticated health. The UI app must not retain a Swift Process handle as daemon ownership, because gxserver must survive closing the macOS app and continue managing zmx sessions.
     */
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

  private static func readBridgeAuthToken() throws -> String {
    let tokenURL = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".ghostex", isDirectory: true)
      .appendingPathComponent("gxserver", isDirectory: true)
      .appendingPathComponent("auth", isDirectory: true)
      .appendingPathComponent("token", isDirectory: false)
    let token = try String(contentsOf: tokenURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    if token.isEmpty {
      throw NSError(
        domain: "GxserverAuth",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "gxserver auth token file is empty at \(tokenURL.path)."])
    }
    return token
  }

  private static func performBridgeRequest(_ command: GxserverRequest, token: String) throws -> (statusCode: Int, body: String?) {
    guard command.path.hasPrefix("/api/") else {
      throw NSError(
        domain: "GxserverRequest",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid gxserver API path: \(command.path)"])
    }
    guard let url = URL(string: "\(Self.localBaseURL)\(command.path)") else {
      throw NSError(
        domain: "GxserverRequest",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Invalid gxserver API URL for \(command.path)."])
    }
    var request = URLRequest(url: url)
    request.httpMethod = command.method.uppercased()
    /*
     CDXC:ProjectBoard 2026-06-02-13:31:
     Project-board Beads actions now flow through gxserver from the WK bridge. Preserve the board's existing 60-second command window for create/update/delete/search while keeping ordinary sidebar gxserver bridge calls on the shorter timeout.
     */
    request.timeoutInterval = command.path == "/api/runBeadsAction" ? 60 : 10
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(String(Self.protocolVersion), forHTTPHeaderField: "x-gxserver-protocol-version")
    if request.httpMethod == "POST" {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      let paramsJson = command.paramsJson?.trimmingCharacters(in: .whitespacesAndNewlines)
      let params = (paramsJson?.isEmpty == false) ? paramsJson! : "{}"
      request.httpBody = Data(#"{"protocolVersion":\#(protocolVersion),"params":\#(params)}"#.utf8)
    }
    return try sendSynchronousBridgeRequest(request)
  }

  private static func sendSynchronousBridgeRequest(_ request: URLRequest) throws -> (statusCode: Int, body: String?) {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<(statusCode: Int, body: String?), Error>?
    URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      if let error {
        result = .failure(error)
        return
      }
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      result = .success((statusCode, data.flatMap { String(data: $0, encoding: .utf8) }))
    }.resume()
    _ = semaphore.wait(timeout: .now() + 12)
    guard let result else {
      throw NSError(
        domain: "GxserverRequest",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "gxserver request timed out."])
    }
    return try result.get()
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
    let packageRoot = Self.gxserverPackageRoot(for: cliURL)
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

  private func expectedBundledNativeNodeRuntime() -> GxserverNativeNodeRuntimeLoadResult {
    guard let cliURL = resolveGxserverCliURL() else {
      return .unavailable
    }
    let packageRoot = Self.gxserverPackageRoot(for: cliURL)
    let runtimeURL = packageRoot.appendingPathComponent("native-runtime.json", isDirectory: false)
    if !fileManager.fileExists(atPath: runtimeURL.path) {
      let bundledBetterSqliteURL = packageRoot
        .appendingPathComponent("node_modules", isDirectory: true)
        .appendingPathComponent("better-sqlite3", isDirectory: true)
      if Self.isAppBundleResource(cliURL), fileManager.fileExists(atPath: bundledBetterSqliteURL.path) {
        return .invalid(
          "gxserver includes a bundled database module, but its Node runtime metadata is missing. Reinstall Ghostex so the app can verify the required system Node ABI before startup."
        )
      }
      return .unavailable
    }
    guard
      let data = try? Data(contentsOf: runtimeURL),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let nodeMajor = json["nodeMajor"] as? Int,
      let nodeModuleVersion = json["nodeModuleVersion"] as? String,
      !nodeModuleVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return .invalid(
        "gxserver Node runtime metadata is invalid. Reinstall Ghostex so the app can verify the required system Node ABI before startup."
      )
    }
    let nativeModules = (json["nativeModules"] as? [String]) ?? []
    if !nativeModules.contains("better-sqlite3") {
      return .invalid(
        "gxserver Node runtime metadata does not identify the bundled database module. Reinstall Ghostex so the app can verify the required system Node ABI before startup."
      )
    }
    return .loaded(GxserverNativeNodeRuntime(
      nativeModules: nativeModules,
      nodeMajor: nodeMajor,
      nodeModuleVersion: nodeModuleVersion,
      nodeRequirement: json["nodeRequirement"] as? String,
      nodeVersion: json["nodeVersion"] as? String
    ))
  }

  private static func gxserverPackageRoot(for cliURL: URL) -> URL {
    cliURL
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private static func isAppBundleResource(_ url: URL) -> Bool {
    guard let resourceURL = Bundle.main.resourceURL else {
      return false
    }
    let resourcePath = resourceURL.standardizedFileURL.path
    let candidatePath = url.standardizedFileURL.path
    return candidatePath == resourcePath || candidatePath.hasPrefix("\(resourcePath)/")
  }

  private struct SystemNodeResolution {
    let moduleVersion: String
    let path: String
    let source: String
    let version: String
  }

  private func resolveSystemNode(expectedRuntime: GxserverNativeNodeRuntime?) -> SystemNodeResolution {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    var firstVersionedCandidate: SystemNodeResolution?
    let preferredMajor = expectedRuntime?.nodeMajor ?? Self.minimumNodeMajor
    let candidates = systemNodeCandidates(home: home, preferredMajor: preferredMajor)
    var seenPaths = Set<String>()
    for candidate in candidates where fileManager.isExecutableFile(atPath: candidate.path) {
      guard seenPaths.insert(candidate.path).inserted else {
        continue
      }
      if let resolution = probeSystemNode(path: candidate.path, source: candidate.source) {
        if Self.nodeResolution(resolution, satisfies: expectedRuntime) {
          return resolution
        }
        if firstVersionedCandidate == nil {
          firstVersionedCandidate = resolution
        }
      }
    }
    let envPathResult = runProcess(
      executable: "/usr/bin/env",
      arguments: ["node", "-p", "process.execPath"],
      timeoutSeconds: 3
    )
    let envVersionResult = runProcess(
      executable: "/usr/bin/env",
      arguments: ["node", "-v"],
      timeoutSeconds: 3
    )
    let envPath = envPathResult.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    if envPathResult.exitCode == 0,
      envVersionResult.exitCode == 0,
      !envPath.isEmpty,
      seenPaths.insert(envPath).inserted,
      let resolution = probeSystemNode(path: envPath, source: "PATH")
    {
      if Self.nodeResolution(resolution, satisfies: expectedRuntime) {
        return resolution
      }
      if firstVersionedCandidate == nil {
        firstVersionedCandidate = resolution
      }
    }
    if let firstVersionedCandidate {
      return firstVersionedCandidate
    }
    return SystemNodeResolution(moduleVersion: "", path: "", source: "unresolved", version: "")
  }

  private func systemNodeCandidates(home: String, preferredMajor: Int) -> [(path: String, source: String)] {
    /*
     CDXC:GxserverBootstrap 2026-06-06-22:56:
     Users can satisfy the gxserver Node 22 runtime with nodejs.org, nvm, mise, fnm, asdf, nodenv, Volta, or Homebrew. macOS apps launched outside an interactive shell cannot rely on nvm/fnm shell hooks, so scan common direct install folders before using shims or PATH.
     */
    var candidates = [
      (path: "/opt/homebrew/opt/node@\(preferredMajor)/bin/node", source: "Homebrew Apple Silicon node@\(preferredMajor)"),
      (path: "/usr/local/opt/node@\(preferredMajor)/bin/node", source: "Homebrew Intel/usr-local node@\(preferredMajor)"),
      (path: "/opt/homebrew/bin/node", source: "Homebrew Apple Silicon"),
      (path: "/usr/local/bin/node", source: "Homebrew Intel/usr-local"),
      (path: "\(home)/.local/bin/node", source: "user local bin"),
    ]
    candidates.append(contentsOf: versionedNodeCandidates(
      root: "\(home)/.nvm/versions/node",
      source: "nvm",
      preferredMajor: preferredMajor,
      relativeNodePath: "bin/node"
    ))
    candidates.append((path: "\(home)/.nvm/current/bin/node", source: "nvm current"))
    candidates.append(contentsOf: versionedNodeCandidates(
      root: "\(home)/.local/share/mise/installs/node",
      source: "mise install",
      preferredMajor: preferredMajor,
      relativeNodePath: "bin/node"
    ))
    candidates.append(contentsOf: versionedNodeCandidates(
      root: "\(home)/.asdf/installs/nodejs",
      source: "asdf install",
      preferredMajor: preferredMajor,
      relativeNodePath: "bin/node"
    ))
    candidates.append(contentsOf: versionedNodeCandidates(
      root: "\(home)/.nodenv/versions",
      source: "nodenv install",
      preferredMajor: preferredMajor,
      relativeNodePath: "bin/node"
    ))
    for fnmRoot in [
      "\(home)/.fnm/node-versions",
      "\(home)/.local/share/fnm/node-versions",
      "\(home)/Library/Application Support/fnm/node-versions",
    ] {
      candidates.append(contentsOf: versionedNodeCandidates(
        root: fnmRoot,
        source: "fnm install",
        preferredMajor: preferredMajor,
        relativeNodePath: "installation/bin/node"
      ))
    }
    candidates.append(contentsOf: versionedNodeCandidates(
      root: "\(home)/.volta/tools/image/node",
      source: "Volta install",
      preferredMajor: preferredMajor,
      relativeNodePath: "bin/node"
    ))
    candidates.append(contentsOf: [
      (path: "\(home)/.volta/bin/node", source: "Volta shim"),
      (path: "\(home)/.local/share/mise/shims/node", source: "mise shim"),
      (path: "\(home)/.asdf/shims/node", source: "asdf shim"),
      (path: "\(home)/.nodenv/shims/node", source: "nodenv shim"),
    ])
    return candidates
  }

  private func versionedNodeCandidates(
    root: String,
    source: String,
    preferredMajor: Int,
    relativeNodePath: String
  ) -> [(path: String, source: String)] {
    guard
      let entries = try? fileManager.contentsOfDirectory(atPath: root)
    else {
      return []
    }
    return entries
      .filter { Self.nodeDirectoryName($0, matchesMajor: preferredMajor) }
      .sorted { $0.localizedStandardCompare($1) == .orderedDescending }
      .map { entry in
        var nodeURL = URL(fileURLWithPath: root, isDirectory: true)
          .appendingPathComponent(entry, isDirectory: true)
        for component in relativeNodePath.split(separator: "/") {
          nodeURL.appendPathComponent(String(component), isDirectory: false)
        }
        return (path: nodeURL.path, source: source)
      }
  }

  private static func nodeDirectoryName(_ name: String, matchesMajor major: Int) -> Bool {
    let normalized = name.hasPrefix("v") ? String(name.dropFirst()) : name
    return normalized == String(major) || normalized.hasPrefix("\(major).")
  }

  private func probeSystemNode(path: String, source: String) -> SystemNodeResolution? {
    let result = runProcess(
      executable: path,
      arguments: [
        "-p",
        "JSON.stringify({version: process.version, modules: process.versions.modules})",
      ],
      timeoutSeconds: 3
    )
    guard
      result.exitCode == 0,
      let data = result.stdout.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let version = json["version"] as? String,
      let moduleVersion = json["modules"] as? String,
      Self.nodeVersionMajor(version) != nil
    else {
      return nil
    }
    return SystemNodeResolution(
      moduleVersion: moduleVersion.trimmingCharacters(in: .whitespacesAndNewlines),
      path: path,
      source: source,
      version: version.trimmingCharacters(in: .whitespacesAndNewlines)
    )
  }

  private static func nodeResolution(
    _ resolution: SystemNodeResolution,
    satisfies expectedRuntime: GxserverNativeNodeRuntime?
  ) -> Bool {
    guard let major = nodeVersionMajor(resolution.version) else {
      return false
    }
    guard let expectedRuntime else {
      return major >= minimumNodeMajor
    }
    return major == expectedRuntime.nodeMajor && resolution.moduleVersion == expectedRuntime.nodeModuleVersion
  }

  private func systemNodeDependencyError(
    resolution: SystemNodeResolution,
    expectedRuntime: GxserverNativeNodeRuntime?
  ) -> String? {
    /*
     CDXC:GxserverBootstrap 2026-06-06-22:00:
     Ghostex does not bundle Node for gxserver. When the app ships prebuilt better-sqlite3, startup must require the matching user-installed Node ABI and show installation guidance before launch instead of letting the daemon crash and spam auth-token errors.
     */
    if let expectedRuntime {
      let requirement =
        expectedRuntime.nodeRequirement ??
        "Node.js \(expectedRuntime.nodeMajor).x with NODE_MODULE_VERSION \(expectedRuntime.nodeModuleVersion)"
      let installGuidance =
        "Install Node \(expectedRuntime.nodeMajor) LTS from \(Self.nodeInstallURL) or with nvm, mise, fnm, asdf, nodenv, Volta, or Homebrew. Homebrew example: `brew install node@\(expectedRuntime.nodeMajor)`."
      if resolution.path.isEmpty {
        return
          "gxserver requires \(requirement) for this Ghostex build because its bundled database module was compiled for that Node ABI, but no matching system Node was found. \(installGuidance) Ghostex does not bundle, auto-install, or fall back to a private Node runtime for gxserver."
      }
      if !Self.nodeResolution(resolution, satisfies: expectedRuntime) {
        let version = resolution.version.isEmpty ? "an unknown Node version" : resolution.version
        let moduleVersion = resolution.moduleVersion.isEmpty
          ? "unknown NODE_MODULE_VERSION"
          : "NODE_MODULE_VERSION \(resolution.moduleVersion)"
        return
          "gxserver requires \(requirement) for this Ghostex build because its bundled database module was compiled for that Node ABI, but the detected system Node is \(version) (\(moduleVersion)). \(installGuidance) Ghostex does not bundle, auto-install, or fall back to a private Node runtime for gxserver."
      }
      return nil
    }
    if resolution.path.isEmpty {
      return
        "gxserver requires Node.js \(Self.minimumNodeMajor) LTS or newer, but Node was not found. Install Node \(Self.minimumNodeMajor) LTS or newer from \(Self.nodeInstallURL) or with nvm, mise, fnm, asdf, nodenv, Volta, or Homebrew. Ghostex does not bundle, auto-install, or fall back to a private Node runtime for gxserver."
    }
    let major = Self.nodeVersionMajor(resolution.version)
    if major == nil || major! < Self.minimumNodeMajor {
      return
        "gxserver requires Node.js \(Self.minimumNodeMajor) LTS or newer, but found \(resolution.version.isEmpty ? "an unknown Node version" : resolution.version). Install Node \(Self.minimumNodeMajor) LTS or newer from \(Self.nodeInstallURL) or with nvm, mise, fnm, asdf, nodenv, Volta, or Homebrew. Ghostex does not bundle, auto-install, or fall back to a private Node runtime for gxserver."
    }
    return nil
  }

  private static func nodeVersionMajor(_ version: String) -> Int? {
    let normalized = version.hasPrefix("v") ? String(version.dropFirst()) : version
    let majorText = normalized.split(separator: ".").first.map(String.init) ?? ""
    return Int(majorText)
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

     CDXC:GxserverBootstrap 2026-06-06-22:00:
     Node 22 is the supported non-bundled gxserver app runtime for prebuilt native modules. Include Homebrew node@22 keg paths in LaunchServices subprocess PATH so users who installed the required runtime do not also need to patch shell startup files.

     CDXC:GxserverBootstrap 2026-06-06-22:56:
     Version-manager shims from Volta, mise, asdf, and nodenv should remain discoverable for users who do not install Node through Homebrew. Direct nvm/fnm installs are scanned separately because those managers usually depend on interactive shell functions instead of durable shims.
     */
    let defaultEntries = [
      "/opt/homebrew/opt/node@\(Self.minimumNodeMajor)/bin",
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/opt/node@\(Self.minimumNodeMajor)/bin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "\(home)/.volta/bin",
      "\(home)/.local/share/mise/shims",
      "\(home)/.local/bin",
      "\(home)/.asdf/shims",
      "\(home)/.nodenv/shims",
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
