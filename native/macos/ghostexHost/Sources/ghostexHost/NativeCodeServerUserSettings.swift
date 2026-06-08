import Foundation

enum NativeCodeServerUserSettings {
  static let colorThemeSettingKey = "workbench.colorTheme"
  static let defaultColorTheme = "Dark 2026"

  /**
   CDXC:EditorPanes 2026-06-08-20:12:
   Bundled code-server panes should start on VS Code's dark 2026 theme when Ghostex owns the runtime profile.
   Seed only a missing User/settings.json so user-edited or linked local VS Code settings remain explicit preferences.
   */
  @discardableResult
  static func ensureDefaultTheme(in userDataDir: URL) throws -> URL {
    let userDir = userDataDir.appendingPathComponent("User", isDirectory: true)
    let settingsURL = userDir.appendingPathComponent("settings.json")

    try FileManager.default.createDirectory(at: userDir, withIntermediateDirectories: true)
    guard !FileManager.default.fileExists(atPath: settingsURL.path) else {
      return settingsURL
    }

    let payload = [colorThemeSettingKey: defaultColorTheme]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
    guard var json = String(data: data, encoding: .utf8) else {
      throw NSError(
        domain: "NativeCodeServerUserSettings",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Unable to encode default code-server settings."])
    }
    json.append("\n")
    try json.write(to: settingsURL, atomically: true, encoding: .utf8)
    return settingsURL
  }

  static func shouldSeedDefaultTheme(linkedVscodeUserConfigDir: String?) -> Bool {
    let trimmedDirectory = linkedVscodeUserConfigDir?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !trimmedDirectory.isEmpty else {
      return true
    }
    let linkedSettingsURL = URL(fileURLWithPath: trimmedDirectory, isDirectory: true)
      .appendingPathComponent("settings.json")
    return !FileManager.default.fileExists(atPath: linkedSettingsURL.path)
  }
}
