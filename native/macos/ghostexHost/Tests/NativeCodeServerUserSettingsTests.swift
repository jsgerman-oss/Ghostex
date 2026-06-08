import Foundation

func assertCodeServerSettingsTest(_ condition: Bool, _ message: String) {
  if !condition {
    fputs("\(message)\n", stderr)
    exit(1)
  }
}

func temporaryCodeServerSettingsTestDirectory() -> URL {
  FileManager.default.temporaryDirectory
    .appendingPathComponent("ghostex-code-server-settings-\(UUID().uuidString)", isDirectory: true)
}

@main
enum NativeCodeServerUserSettingsTests {
  static func main() throws {
    let root = temporaryCodeServerSettingsTestDirectory()
    defer {
      try? FileManager.default.removeItem(at: root)
    }

    let userDataDir = root.appendingPathComponent("user-data", isDirectory: true)
    let settingsURL = try NativeCodeServerUserSettings.ensureDefaultTheme(in: userDataDir)
    let settingsData = try Data(contentsOf: settingsURL)
    let settings = try JSONSerialization.jsonObject(with: settingsData) as? [String: Any]

    assertCodeServerSettingsTest(
      settings?[NativeCodeServerUserSettings.colorThemeSettingKey] as? String
        == NativeCodeServerUserSettings.defaultColorTheme,
      "missing code-server settings should be seeded with Dark 2026")

    try "{\"editor.fontSize\": 14}\n".write(to: settingsURL, atomically: true, encoding: .utf8)
    _ = try NativeCodeServerUserSettings.ensureDefaultTheme(in: userDataDir)
    let preservedSettings = try String(contentsOf: settingsURL, encoding: .utf8)
    assertCodeServerSettingsTest(
      preservedSettings == "{\"editor.fontSize\": 14}\n",
      "existing code-server settings must not be overwritten")

    assertCodeServerSettingsTest(
      NativeCodeServerUserSettings.shouldSeedDefaultTheme(linkedVscodeUserConfigDir: nil),
      "missing linked VS Code config should allow bundled default seeding")

    let linkedConfigDir = root.appendingPathComponent("Code/User", isDirectory: true)
    assertCodeServerSettingsTest(
      NativeCodeServerUserSettings.shouldSeedDefaultTheme(linkedVscodeUserConfigDir: linkedConfigDir.path),
      "missing linked VS Code settings.json should allow bundled default seeding")

    try FileManager.default.createDirectory(at: linkedConfigDir, withIntermediateDirectories: true)
    try "{}\n".write(
      to: linkedConfigDir.appendingPathComponent("settings.json"),
      atomically: true,
      encoding: .utf8)
    assertCodeServerSettingsTest(
      !NativeCodeServerUserSettings.shouldSeedDefaultTheme(linkedVscodeUserConfigDir: linkedConfigDir.path),
      "existing linked VS Code settings.json should prevent bundled default seeding")
  }
}
