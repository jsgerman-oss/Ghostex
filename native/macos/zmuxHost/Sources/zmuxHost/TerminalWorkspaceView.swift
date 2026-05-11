import AppKit
import Combine
import Darwin
import GhosttyKit
import QuartzCore
import WebKit

private func nativePaneImage(fromDataUrl dataUrl: String?, isTemplate: Bool = false) -> NSImage? {
  guard let dataUrl,
    let commaIndex = dataUrl.firstIndex(of: ",")
  else {
    return nil
  }
  let metadata = dataUrl[..<commaIndex]
  let payload = String(dataUrl[dataUrl.index(after: commaIndex)...])
  let data: Data?
  if metadata.contains(";base64") {
    data = Data(base64Encoded: payload)
  } else {
    data = payload.removingPercentEncoding?.data(using: .utf8)
  }
  guard let data else {
    return nil
  }
  guard let image = NSImage(data: data) else {
    return nil
  }
  image.isTemplate = isTemplate
  return image
}

private func nativePaneColor(fromHex hex: String?) -> NSColor? {
  guard let hex else {
    return nil
  }
  let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
  guard value.count == 6, let rgb = UInt32(value, radix: 16) else {
    return nil
  }
  return NSColor(
    calibratedRed: CGFloat((rgb >> 16) & 0xff) / 255,
    green: CGFloat((rgb >> 8) & 0xff) / 255,
    blue: CGFloat(rgb & 0xff) / 255,
    alpha: 1
  )
}

private let nativeTerminalColorEnvironmentKeys = [
  "ANSI_COLORS_DISABLED",
  "CI",
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "COLORTERM",
  "FORCE_COLOR",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
]

private let nativeGhosttyTerminalColorDisablingEnvironmentKeys = [
  "ANSI_COLORS_DISABLED",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
]

private func nativePromptEditorCommand(backend: String) -> String {
  if let executablePath = Bundle.main.executableURL?.path,
    !executablePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  {
    if backend == "zpet" {
      return "\(nativeShellQuote(executablePath)) floating-editor -- zpet"
    }
    return "\(nativeShellQuote(executablePath)) floating-monaco-editor"
  }
  if backend == "zpet" {
    return "zmux floating-editor -- zpet"
  }
  return "zmux floating-monaco-editor"
}

private func nativePromptEditorBackend(from environment: [String: String]) -> String? {
  let backend = environment["ZMUX_PROMPT_EDITOR_BACKEND"]?.trimmingCharacters(
    in: .whitespacesAndNewlines)
  if backend == "monaco" || backend == "zpet" {
    return backend
  }
  if environment["ZMUX_RICH_PROMPT_EDITING_WITH_ZAPET"] == "1" {
    return "zpet"
  }
  if environment["ZMUX_PROMPT_EDITING_ENABLED"] == "1" {
    return "monaco"
  }
  return nil
}

private func nativeZapetPromptEditorCommand() -> String {
  nativePromptEditorCommand(backend: "zpet")
}

private func nativeMonacoPromptEditorCommand() -> String {
  nativePromptEditorCommand(backend: "monaco")
}

private func nativeZapetPromptEditorLogURL() -> URL {
  FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library", isDirectory: true)
    .appendingPathComponent("Logs", isDirectory: true)
    .appendingPathComponent("zmux", isDirectory: true)
    .appendingPathComponent("zapet-prompt-editor.log")
}

private func nativeLogZapetPromptEditor(_ event: String, details: [String: String] = [:]) {
  let url = nativeZapetPromptEditorLogURL()
  let directory = url.deletingLastPathComponent()
  try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

  var payload = details
  payload["event"] = event
  payload["source"] = "zmux-native"
  payload["timestamp"] = ISO8601DateFormatter().string(from: Date())

  let json =
    (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]))
    .flatMap { String(data: $0, encoding: .utf8) }
    ?? "\(payload)"
  guard let data = (json + "\n").data(using: .utf8) else {
    return
  }

  if FileManager.default.fileExists(atPath: url.path),
    let handle = try? FileHandle(forWritingTo: url)
  {
    defer { handle.closeFile() }
    _ = try? handle.seekToEnd()
    _ = try? handle.write(contentsOf: data)
  } else {
    try? data.write(to: url, options: .atomic)
  }
}

private enum TerminalPaneRoundedBottomCorner {
  case left
  case none
  case right
}

private func nativeGhosttyTerminalEnvironment(
  _ environment: [String: String]?,
  sessionId: String? = nil
) -> [String: String] {
  /**
   CDXC:GhosttyTerminalColorEnv 2026-05-04-22:46
   Embedded Ghostty terminals are interactive color-capable PTYs. Agent-managed
   launch environments can carry NO_COLOR into zmux; strip color-disabling keys
   at the native Ghostty boundary and set non-forcing color opt-in without
   forcing ANSI output in non-Ghostty child processes.
   */
  var result = environment ?? [:]
  for key in nativeGhosttyTerminalColorDisablingEnvironmentKeys {
    result.removeValue(forKey: key)
  }
  result["CLICOLOR"] = "1"
  if let sessionId, !sessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    result["ZMUX_NATIVE_SESSION_ID"] = sessionId
  }
  nativeApplyZapetPromptEditingEnvironment(&result)
  return result
}

private func nativeGhosttyFloatingEditorEnvironment(
  _ environment: [String: String]?
) -> [String: String] {
  var result = nativeGhosttyTerminalEffectiveProcessEnvironment()
  for (key, value) in environment ?? [:] {
    result[key] = value
  }
  for key in [
    "EDITOR",
    "VISUAL",
    "ZMUX_NATIVE_SESSION_ID",
    "ZDOTDIR",
    "ZMUX_ORIGINAL_ZDOTDIR",
    "ZMUX_PROMPT_EDITOR_BACKEND",
    "ZMUX_PROMPT_EDITING_ENABLED",
    "ZMUX_RICH_PROMPT_EDITING_WITH_ZAPET",
    "ZMUX_ZAPET_PROMPT_EDITOR_LOG",
  ] {
    result.removeValue(forKey: key)
  }
  result["CLICOLOR"] = "1"
  result["ZMUX_FLOATING_EDITOR"] = "1"
  return result
}

private func nativeApplyZapetPromptEditingEnvironment(_ environment: inout [String: String]) {
  guard let promptEditorBackend = nativePromptEditorBackend(from: environment) else {
    return
  }

  /**
   CDXC:ZapetPromptEditing 2026-05-10-11:27
   Zsh startup files can export EDITOR after Ghostty receives the process
   environment. When Zapet is enabled, launch zsh through a zmux-owned ZDOTDIR
   shim that sources the user's real startup files first, then exports the
   Zapet editor command last so Ctrl+G/edit-command-line uses Zapet instead
   of the profile editor.
  */
  let promptEditor = nativePromptEditorCommand(backend: promptEditorBackend)
  environment["EDITOR"] = promptEditor
  environment["VISUAL"] = promptEditor
  environment["ZMUX_ZAPET_PROMPT_EDITOR_LOG"] = nativeZapetPromptEditorLogURL().path
  if let appVariant = ProcessInfo.processInfo.environment["ZMUX_APP_VARIANT"], !appVariant.isEmpty {
    environment["ZMUX_APP_VARIANT"] = appVariant
  }
  let originalZdotdir =
    environment["ZDOTDIR"]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    ? environment["ZDOTDIR"]!
    : ProcessInfo.processInfo.environment["ZDOTDIR"]
  guard let shimZdotdir = nativeEnsureZapetZdotdirShim(promptEditorCommand: promptEditor) else {
    return
  }
  environment["ZMUX_ORIGINAL_ZDOTDIR"] = originalZdotdir ?? ""
  environment["ZDOTDIR"] = shimZdotdir
  nativeLogZapetPromptEditor("environment.applied", details: [
    "editor": promptEditor,
    "promptEditorBackend": promptEditorBackend,
    "logPath": environment["ZMUX_ZAPET_PROMPT_EDITOR_LOG"] ?? "",
    "originalZdotdir": originalZdotdir ?? "",
    "shimZdotdir": shimZdotdir,
    "visual": promptEditor,
  ])
}

private func nativeEnsureZapetZdotdirShim(promptEditorCommand: String) -> String? {
  let directory = ZmuxAppStorage.sharedStateDirectory.appendingPathComponent(
    "zapet-zdotdir",
    isDirectory: true
  )
  do {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    for startupFile in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
      let shouldExportZapet = startupFile != ".zshenv"
      let contents = nativeZapetZshStartupShim(
        fileName: startupFile,
        exportZapet: shouldExportZapet,
        promptEditorCommand: promptEditorCommand
      )
      try contents.write(
        to: directory.appendingPathComponent(startupFile),
        atomically: true,
        encoding: .utf8
      )
    }
    return directory.path
  } catch {
    NSLog("Failed to prepare Zapet zsh startup shim: \(error.localizedDescription)")
    nativeLogZapetPromptEditor("shim.prepare_failed", details: [
      "error": error.localizedDescription
    ])
    return nil
  }
}

private func nativeZapetZshStartupShim(
  fileName: String,
  exportZapet: Bool,
  promptEditorCommand: String
) -> String {
  let originalZdotdirUpdateBlock =
    fileName == ".zshenv"
    ? """

      if [ -n "${ZDOTDIR}" ] && [ "${ZDOTDIR}" != "${_zmux_shim_zdotdir}" ]; then
        export ZMUX_ORIGINAL_ZDOTDIR="${ZDOTDIR}"
      fi
      ZDOTDIR="${_zmux_shim_zdotdir}"
      """
    : ""
  let exportBlock =
    exportZapet
    ? """

      export EDITOR=\(nativeShellQuote(promptEditorCommand))
      export VISUAL=\(nativeShellQuote(promptEditorCommand))
      {
        printf '[%s] zsh-shim.export file=%s pid=%s editor=%s visual=%s pwd=%s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "\(fileName)" "$$" "${EDITOR}" "${VISUAL}" "${PWD}"
      } >> "${_zmux_zapet_log}" 2>/dev/null
      """
    : ""
  return """
    # CDXC:ZapetPromptEditing 2026-05-10-11:27
    # Source the user's real zsh startup file, then let zmux force the Zapet
    # prompt editor command after profile exports that would otherwise override
    # EDITOR.
    _zmux_shim_zdotdir="${ZDOTDIR}"
    _zmux_original_zdotdir="${ZMUX_ORIGINAL_ZDOTDIR:-$HOME}"
    _zmux_zapet_log="${ZMUX_ZAPET_PROMPT_EDITOR_LOG:-$HOME/Library/Logs/zmux/zapet-prompt-editor.log}"
    mkdir -p "$(dirname "${_zmux_zapet_log}")" 2>/dev/null
    {
      printf '[%s] zsh-shim.enter file=%s pid=%s editor_before=%s visual_before=%s zdotdir=%s original_zdotdir=%s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "\(fileName)" "$$" "${EDITOR}" "${VISUAL}" "${ZDOTDIR}" "${_zmux_original_zdotdir}"
    } >> "${_zmux_zapet_log}" 2>/dev/null
    if [ -r "${_zmux_original_zdotdir}/\(fileName)" ]; then
      ZDOTDIR="${_zmux_original_zdotdir}"
      source "${_zmux_original_zdotdir}/\(fileName)"
      ZDOTDIR="${_zmux_shim_zdotdir}"
    fi\(originalZdotdirUpdateBlock)\(exportBlock)
    {
      printf '[%s] zsh-shim.leave file=%s pid=%s editor_after=%s visual_after=%s zdotdir=%s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "\(fileName)" "$$" "${EDITOR}" "${VISUAL}" "${ZDOTDIR}"
    } >> "${_zmux_zapet_log}" 2>/dev/null
    unset _zmux_zapet_log
    unset _zmux_shim_zdotdir
    unset _zmux_original_zdotdir

    """
}

private func nativeShellQuote(_ value: String) -> String {
  "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
}

private func nativeJavaScriptLiteral(_ value: String) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: [value]),
    let arrayLiteral = String(data: data, encoding: .utf8),
    arrayLiteral.first == "[",
    arrayLiteral.last == "]"
  else {
    return "\"\""
  }
  return String(arrayLiteral.dropFirst().dropLast())
}

private func nativeGhosttyTerminalEffectiveProcessEnvironment() -> [String: String] {
  var environment = ProcessInfo.processInfo.environment
  for key in nativeGhosttyTerminalColorDisablingEnvironmentKeys {
    environment.removeValue(forKey: key)
  }
  environment["CLICOLOR"] = "1"
  return environment
}

private func nativeProcessEnvironmentValue(_ key: String) -> String? {
  guard let value = getenv(key) else {
    return nil
  }
  return String(cString: value)
}

private func withNativeGhosttyTerminalProcessEnvironment<T>(_ body: () -> T) -> T {
  /**
   CDXC:GhosttyTerminalColorEnv 2026-05-04-22:46
   Ghostty embedded surfaces snapshot the host process environment when the
   surface is created. Temporarily sanitize only that creation window so spawned
   shells do not inherit NO_COLOR from the app launch context, then restore the
   app process environment for unrelated native work.
   */
  var savedEnvironment: [String: String?] = [:]
  let keysToSave = nativeGhosttyTerminalColorDisablingEnvironmentKeys + ["CLICOLOR"]
  for key in keysToSave {
    savedEnvironment[key] = nativeProcessEnvironmentValue(key)
  }

  for key in nativeGhosttyTerminalColorDisablingEnvironmentKeys {
    unsetenv(key)
  }
  setenv("CLICOLOR", "1", 1)

  defer {
    for key in keysToSave {
      if let value = savedEnvironment[key] ?? nil {
        setenv(key, value, 1)
      } else {
        unsetenv(key)
      }
    }
  }

  return body()
}

private func nativeTerminalColorEnvironmentSnapshot(_ environment: [String: String]) -> [String: Any] {
  /**
   CDXC:AgentCliColorDiagnostics 2026-05-04-15:39
   Agent CLIs can render without color when their PTY process inherits
   color-disabling environment values. Capture both the app process env and the
   sidebar-provided Ghostty env overlay at surface creation without changing
   launch behavior.
   */
  var snapshot: [String: Any] = [:]
  for key in nativeTerminalColorEnvironmentKeys {
    snapshot[key] = environment[key] ?? NSNull()
  }
  return snapshot
}

@MainActor
final class TerminalWorkspaceView: NSView {
  private struct TerminalSession {
    let containerView: TerminalPaneLeafContainerView
    let sessionId: String
    let view: Ghostty.SurfaceView
    let scrollView: SurfaceScrollView
    let searchBarView: TerminalSearchBarView
    let titleBarView: TerminalSessionTitleBarView
    let borderView: TerminalPaneBorderView
    var foregroundPid: Int?
    var sessionPersistenceName: String?
    var sessionPersistenceProvider: NativeSessionPersistenceProvider?
    var ttyName: String?
    var cancellables: Set<AnyCancellable> = []
  }

  private struct WebPaneSession {
    let browserTitleObservation: NSKeyValueObservation?
    let containerView: TerminalPaneLeafContainerView
    let chromiumView: ZmuxCEFBrowserView?
    let diagnosticsBridge: T3CodePaneDiagnosticsBridge
    let hostView: WebPaneHostView
    let isManagedT3Pane: Bool
    let projectId: String?
    let sessionId: String
    let threadId: String?
    let title: String
    let workspaceRoot: String?
    let browserProfileID: UUID?
    let webView: WKWebView?
    let titleBarView: TerminalSessionTitleBarView
    let borderView: TerminalPaneBorderView

    var browserContentView: NSView {
      chromiumView ?? webView ?? hostView
    }

    var currentURLString: String? {
      chromiumView?.currentURLString ?? webView?.url?.absoluteString
    }

    var isLoading: Bool {
      chromiumView?.isLoading ?? webView?.isLoading ?? false
    }

    var canNavigateBack: Bool {
      chromiumView?.canGoBack ?? webView?.canGoBack ?? false
    }

    var canNavigateForward: Bool {
      chromiumView?.canGoForward ?? webView?.canGoForward ?? false
    }
  }

  private struct ProjectEditorPaneSession {
    let chromiumView: ZmuxCEFBrowserView
    let hostView: WebPaneHostView
    let projectId: String
    let title: String
    let url: String
  }

  private struct PaneResizeHit {
    let availableLength: CGFloat
    let boundaryIndex: Int
    let direction: NativeTerminalLayout.SplitDirection
    let path: String
    let rect: CGRect
    let trackCount: Int
  }

  private struct PaneResizeDrag {
    let availableLength: CGFloat
    let boundaryIndex: Int
    let direction: NativeTerminalLayout.SplitDirection
    let minimumAfter: CGFloat
    let minimumBefore: CGFloat
    let path: String
    let startCoordinate: CGFloat
    let startRatios: [CGFloat]
  }

  private struct PaneHeaderDrag {
    var isDragging: Bool
    var lastLoggedMoveAt: TimeInterval
    var moveEventCount: Int
    let sourceSessionId: String
    let startedFromTab: Bool
    let startPoint: CGPoint
    var targetSessionId: String?
  }

  private struct PaneTabReorderDropTarget {
    let lineFrame: CGRect
    let ownerSessionId: String
    let position: PaneTabReorderPosition
    let targetSessionId: String
  }

  private struct CEFNativeDragSourceRelease {
    let chromiumView: ZmuxCEFBrowserView
    let startWindowPoint: CGPoint
    var didDrag: Bool
    var didStartHoverBridge: Bool
    var lastHoverEventTime: TimeInterval
    var lastHoverWindowPoint: CGPoint?
    var lastHoverLogEventTime: TimeInterval
  }

  private static let terminalTitleBarHeight: CGFloat = 33
  private static let defaultPaneGap: CGFloat = 12
  private static let singlePaneInset: CGFloat = 1
  private static let paneResizeMinimumHeight: CGFloat = 160
  private static let paneResizeMinimumWidth: CGFloat = 220
  /**
   CDXC:NativePaneResize 2026-05-11-09:55
   The visible split line is the workspace gap between panes, not the
   transparent grab target. Keep internal split gaps at least 16px so the
   draggable line itself is wider while the resize rail can remain invisible.
   */
  private static let paneResizeMinimumVisibleGap: CGFloat = 16
  private static let paneResizeOuterEdgeExclusion: CGFloat = 8
  /**
   CDXC:NativePaneResize 2026-05-11-07:56
   Splitter grab targets must be easier to acquire than the visual pane gap.
   Keep pane spacing unchanged, but give AppKit a 15px minimum transparent hit
   target centered on the split boundary.
   CDXC:NativePaneResize 2026-05-11-09:45
   Focused pane borders sit just inside pane edges. Extend split hit targets a
   few pixels into both panes so dragging from the focused border side still
   starts the same native splitter rail.
   CDXC:NativePaneResize 2026-05-11-09:55
   The focused-side miss was not caused by the border. Keep the transparent
   target tied to the visible split line/minimum target instead of hiding focus
   chrome.
   CDXC:NativePaneResize 2026-05-11-10:40
   Pane split resizing must match Muxy's model: only the actual split rail owns
   hover cursor and drag events. Do not use a window-local resize monitor,
   because it can compete with the sidebar resize handle.
   */
  private static let paneResizeMinimumHitSize: CGFloat = 15
  private static let paneHeaderDragThreshold: CGFloat = 6
  private static let paneHeaderDragGhostMaxWidth: CGFloat = 230
  private static let cefNativeDragHoverInterval: TimeInterval = 1.0 / 30.0
  private static let cefNativeDragStationaryHoverInterval: TimeInterval = 0.12
  private static let cefNativeDragHoverMinimumDistance: CGFloat = 3
  private static let browserPaneApplicationNameForUserAgent = "Version/18.4 Safari/605.1.15"
  private static let floatingEditorMargin: CGFloat = 24
  private static let floatingEditorMinimumHeight: CGFloat = 260
  private static let floatingEditorMinimumWidth: CGFloat = 420
  private static let floatingEditorFrameDefaultsKey = "zmux.floatingEditor.frame.v1"
  private static let defaultWorkspaceBackgroundColor = NSColor(
    calibratedRed: 0.071, green: 0.071, blue: 0.071, alpha: 1)
  private let ghostty: Ghostty.App
  private let sendEvent: (HostEvent) -> Void
  private var sessions: [String: TerminalSession] = [:]
  private var webPaneSessions: [String: WebPaneSession] = [:]
  private var projectEditorPaneSessions: [String: ProjectEditorPaneSession] = [:]
  private var webPaneFaviconTasksBySessionId: [String: Task<Void, Never>] = [:]
  private var completedWebPaneLoadSessionIds = Set<String>()
  private var pendingAuthenticatedWebPaneLoadSessionIds = Set<String>()
  private var t3ThreadRouteRetryAttemptsBySessionId = [String: Int]()
  private var activeSessionIds = Set<String>()
  private var attentionSessionIds = Set<String>()
  private var poppedOutSessionIds = Set<String>()
  private var poppedOutPaneControllers: [String: PoppedOutPaneWindowController] = [:]
  private var poppedOutPlaceholderViews: [String: PoppedOutPanePlaceholderView] = [:]
  private var sleepingSessionIds = Set<String>()
  private var sessionAgentIconColors = [String: String]()
  private var sessionAgentIconDataUrls = [String: String]()
  private var sessionActivities = [String: NativeTerminalActivity]()
  private var sessionFaviconDataUrls = [String: String]()
  private var sessionTitleBarActions = [String: [TerminalTitleBarAction]]()
  private var sessionTitles = [String: String]()
  private var activeProjectEditorId: String?
  private var focusedSessionId: String?
  private var lastEmittedFocusedSessionId: String?
  private var lastAppliedLayoutFocusRequestId: Int?
  private var workspaceBackgroundColorValue: String?
  private var paneGap = TerminalWorkspaceView.defaultPaneGap
  private var sidebarSide: SidebarSide = .left
  private var programmaticFocusDepth = 0
  private var terminalLayout: NativeTerminalLayout?
  private var paneResizeHits: [PaneResizeHit] = []
  private var paneResizeRatiosByPath: [String: [CGFloat]] = [:]
  private var paneResizeDrag: PaneResizeDrag?
  private var paneResizeHandleViews: [TerminalWorkspacePaneResizeHandleView] = []
  private var paneHeaderDrag: PaneHeaderDrag?
  private var paneHeaderActionPress: (sessionId: String, action: TerminalTitleBarAction)?
  private var hoveredPaneSessionId: String?
  private var paneHeaderEventMonitor: Any?
  private var paneHeaderDragGhostView: TerminalPaneHeaderDragGhostView?
  private var paneHeaderDragTargetView: TerminalPaneHeaderDragTargetView?
  private var paneTabReorderTargetView: TerminalPaneTabReorderTargetView?
  private var cefNativeDragSourceRelease: CEFNativeDragSourceRelease?
  private var cefNativeDragSourceReleaseEventMonitor: Any?
  private var cefNativeDragHoverTimer: Timer?
  private var resizeLogSignatureBySessionId = [String: String]()
  private var exitPollTimer: Timer?
  private var floatingEditorOverlayView: FloatingEditorOverlayView?
  private var floatingEditorExitPollTimer: Timer?
  private var floatingEditorStatusFile: String?
  private var floatingEditorStatusWritten = false

  /**
   CDXC:EditorPanes 2026-05-06-18:51
   Project editor panes embed code-server, whose VS Code workbench owns
   browser-native drag/drop inside the primary sidebar. While an editor pane is
   active, the native pane resize/header-reorder layer must stand down so it
   cannot decorate or inspect the mouse stream before VS Code receives drop.
   CDXC:EditorPanes 2026-05-06-19:05
   The pane-header event monitor is uninstalled while code-server is visible,
   not just gated in the callback, so AppKit does not keep a native drag
   observer in the same window event stream as VS Code's HTML drag/drop.
   CDXC:EditorPanes 2026-05-06-19:19
   Treat a visibly hosted project editor as the source of truth for drag/drop
   ownership. Native state can briefly lag focus/layout updates, but VS Code
   sidebar drops must still receive an unintercepted mouse stream.
   */
  private var isProjectEditorInteractionSurfaceActive: Bool {
    if let activeProjectEditorId, projectEditorPaneSessions[activeProjectEditorId] != nil {
      return true
    }
    return !visibleProjectEditorInteractionSessionIds.isEmpty
  }

  private var visibleProjectEditorInteractionSessionIds: [String] {
    projectEditorPaneSessions.values
      .filter(isProjectEditorInteractionSurfaceVisible)
      .map(\.projectId)
      .sorted()
  }

  private func isProjectEditorInteractionSurfaceVisible(_ session: ProjectEditorPaneSession) -> Bool {
    guard session.hostView.superview === self, !session.hostView.isHidden else {
      return false
    }
    let hostFrame = session.hostView.frame
    guard hostFrame.width > 1, hostFrame.height > 1 else {
      return false
    }
    return bounds.intersects(hostFrame)
  }

  /**
   CDXC:NativeTerminals 2026-04-26-06:44
   Project switching should show only the selected project's terminals.
   Inactive terminal surfaces are moved offscreen, and sidebar/native id
   translation decides which native Ghostty session is active.
   */
  init(ghostty: Ghostty.App, sendEvent: @escaping (HostEvent) -> Void) {
    self.ghostty = ghostty
    self.sendEvent = sendEvent
    super.init(frame: .zero)
    wantsLayer = true
    layer?.backgroundColor = Self.defaultWorkspaceBackgroundColor.cgColor
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    if let paneHeaderEventMonitor {
      NSEvent.removeMonitor(paneHeaderEventMonitor)
    }
    if let cefNativeDragSourceReleaseEventMonitor {
      NSEvent.removeMonitor(cefNativeDragSourceReleaseEventMonitor)
    }
    cefNativeDragHoverTimer?.invalidate()
    floatingEditorExitPollTimer?.invalidate()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    window?.acceptsMouseMovedEvents = true
    uninstallPaneHeaderEventMonitor()
    syncPaneHeaderEventMonitorForCurrentSurface(reason: "viewDidMoveToWindow")
    syncCEFNativeDragSourceReleaseMonitor(reason: "viewDidMoveToWindow")
  }

  func openFloatingEditor(_ command: OpenFloatingEditor) {
    if command.editorKind == "monaco" {
      openFloatingMonacoEditor(command)
      return
    }

    guard let app = ghostty.app else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.floatingEditor.ghosttyMissing",
        details: [
          "requestId": command.requestId ?? "",
          "title": command.title ?? "",
        ])
      return
    }
    guard let editorCommand = command.command?.trimmingCharacters(in: .whitespacesAndNewlines),
      !editorCommand.isEmpty
    else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.floatingEditor.commandMissing",
        details: [
          "requestId": command.requestId ?? "",
          "title": command.title ?? "",
        ])
      return
    }

    closeFloatingEditorOverlay(requestGhosttyClose: true, reason: "replaceFloatingEditor")

    var config = Ghostty.SurfaceConfiguration()
    config.command = editorCommand
    config.environmentVariables = nativeGhosttyFloatingEditorEnvironment(command.env)
    config.waitAfterCommand = false
    if let cwd = command.cwd, !cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      config.workingDirectory = cwd
    }

    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.open",
      details: [
        "command": editorCommand,
        "cwd": command.cwd ?? "",
        "envCount": config.environmentVariables.count,
        "requestId": command.requestId ?? "",
        "title": command.title ?? "",
      ])

    let surfaceView = withNativeGhosttyTerminalProcessEnvironment {
      ZmuxGhosttySurfaceView(app, baseConfig: config)
    }
    surfaceView.translatesAutoresizingMaskIntoConstraints = false
    let returnFocusSessionId =
      command.originatingSessionId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      ? command.originatingSessionId
      : focusedSessionId
    let overlayView = FloatingEditorOverlayView(
      title: command.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        ? command.title!
        : "Floating Editor",
      returnFocusSessionId: returnFocusSessionId,
      surfaceView: surfaceView
    )
    overlayView.translatesAutoresizingMaskIntoConstraints = true
    let storedFrame = storedFloatingEditorFrame()
    overlayView.frame = storedFrame.map(clampedFloatingEditorFrame) ?? defaultFloatingEditorFrame()
    overlayView.isUserPositioned = storedFrame != nil
    overlayView.closeHandler = { [weak self] in
      self?.closeFloatingEditorOverlay(requestGhosttyClose: true, reason: "titlebarClose")
    }
    overlayView.saveHandler = { [weak self, weak overlayView] in
      guard let self, let overlayView else {
        return
      }
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.floatingEditor.saveRequested",
        details: [
          "returnFocusSessionId": overlayView.returnFocusSessionId ?? "",
      ])
      overlayView.setSaving()
      overlayView.surfaceView?.surfaceModel?.sendText("\u{7}")
      if let surfaceView = overlayView.surfaceView {
        self.window?.makeFirstResponder(surfaceView)
      }
    }
    overlayView.dragHandler = { [weak self, weak overlayView] delta in
      guard let self, let overlayView else {
        return
      }
      var frame = overlayView.frame
      frame.origin.x += delta.x
      frame.origin.y += delta.y
      overlayView.frame = self.clampedFloatingEditorFrame(frame)
      overlayView.isUserPositioned = true
      self.persistFloatingEditorFrame(overlayView.frame)
    }
    overlayView.resizeHandler = { [weak self, weak overlayView] delta in
      guard let self, let overlayView else {
        return
      }
      var frame = overlayView.frame
      frame.size.width += delta.x
      frame.size.height -= delta.y
      frame.origin.y += delta.y
      overlayView.frame = self.clampedFloatingEditorFrame(frame)
      overlayView.isUserPositioned = true
      self.persistFloatingEditorFrame(overlayView.frame)
    }
    addSubview(overlayView)
    floatingEditorOverlayView = overlayView
    floatingEditorStatusFile = command.statusFile
    floatingEditorStatusWritten = false
    startFloatingEditorExitPolling()
    needsLayout = true
    orderFloatingEditorOverlayToFront()
    window?.makeFirstResponder(surfaceView)
  }

  private func openFloatingMonacoEditor(_ command: OpenFloatingEditor) {
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.monacoReceived",
      details: [
        "filePath": command.filePath ?? "",
        "language": command.language ?? "",
        "requestId": command.requestId ?? "",
        "statusFile": command.statusFile ?? "",
        "title": command.title ?? "",
      ])
    guard let filePath = command.filePath?.trimmingCharacters(in: .whitespacesAndNewlines),
      !filePath.isEmpty
    else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.floatingEditor.monacoFileMissing",
        details: [
          "requestId": command.requestId ?? "",
          "title": command.title ?? "",
        ])
      return
    }
    guard
      let webAssets = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true),
      FileManager.default.fileExists(
        atPath: webAssets.appendingPathComponent("floating-monaco-editor.html").path)
    else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.floatingEditor.monacoAssetsMissing",
        details: [
          "filePath": filePath,
          "requestId": command.requestId ?? "",
        ])
      writeFloatingEditorStatusFile(command.statusFile, status: "cancelled")
      return
    }
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.monacoAssetsReady",
      details: [
        "requestId": command.requestId ?? "",
        "webAssets": webAssets.path,
      ])

    closeFloatingEditorOverlay(requestGhosttyClose: true, reason: "replaceFloatingEditor")

    let initialText = (try? String(contentsOfFile: filePath, encoding: .utf8)) ?? ""
    let language =
      command.language?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      ? command.language!
      : "markdown"
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.monacoInitialTextRead",
      details: [
        "filePath": filePath,
        "initialTextLength": "\(initialText.count)",
        "language": language,
        "requestId": command.requestId ?? "",
      ])
    let userContentController = WKUserContentController()
    userContentController.addUserScript(
      WKUserScript(
        source:
          "window.__ZMUX_MONACO_INITIAL_TEXT__ = \(nativeJavaScriptLiteral(initialText)); window.__ZMUX_MONACO_LANGUAGE__ = \(nativeJavaScriptLiteral(language));",
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
      ))
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = userContentController
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.monacoWebViewCreateStart",
      details: [
        "requestId": command.requestId ?? ""
      ])
    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.translatesAutoresizingMaskIntoConstraints = false
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.monacoWebViewCreated",
      details: [
        "requestId": command.requestId ?? ""
      ])

    let returnFocusSessionId =
      command.originatingSessionId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      ? command.originatingSessionId
      : focusedSessionId
    let overlayView = FloatingEditorOverlayView(
      title: command.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        ? command.title!
        : "Prompt Editor",
      returnFocusSessionId: returnFocusSessionId,
      webView: webView
    )
    overlayView.translatesAutoresizingMaskIntoConstraints = true
    let storedFrame = storedFloatingEditorFrame()
    overlayView.frame = storedFrame.map(clampedFloatingEditorFrame) ?? defaultFloatingEditorFrame()
    overlayView.isUserPositioned = storedFrame != nil
    overlayView.closeHandler = { [weak self] in
      self?.closeFloatingEditorOverlay(requestGhosttyClose: false, reason: "titlebarClose")
    }
    overlayView.saveHandler = { [weak self, weak overlayView, weak webView] in
      guard let self, let overlayView, let webView else {
        return
      }
      overlayView.setSaving()
      self.saveFloatingMonacoEditor(
        overlayView: overlayView,
        webView: webView,
        filePath: filePath,
        statusFile: command.statusFile
      )
    }
    overlayView.dragHandler = { [weak self, weak overlayView] delta in
      guard let self, let overlayView else {
        return
      }
      var frame = overlayView.frame
      frame.origin.x += delta.x
      frame.origin.y += delta.y
      overlayView.frame = self.clampedFloatingEditorFrame(frame)
      overlayView.isUserPositioned = true
      self.persistFloatingEditorFrame(overlayView.frame)
    }
    overlayView.resizeHandler = { [weak self, weak overlayView] delta in
      guard let self, let overlayView else {
        return
      }
      var frame = overlayView.frame
      frame.size.width += delta.x
      frame.size.height -= delta.y
      frame.origin.y += delta.y
      overlayView.frame = self.clampedFloatingEditorFrame(frame)
      overlayView.isUserPositioned = true
      self.persistFloatingEditorFrame(overlayView.frame)
    }

    addSubview(overlayView)
    floatingEditorOverlayView = overlayView
    floatingEditorStatusFile = command.statusFile
    floatingEditorStatusWritten = false
    needsLayout = true
    orderFloatingEditorOverlayToFront()
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.monacoLoadFileStart",
      details: [
        "htmlPath": webAssets.appendingPathComponent("floating-monaco-editor.html").path,
        "requestId": command.requestId ?? "",
      ])
    webView.loadFileURL(
      webAssets.appendingPathComponent("floating-monaco-editor.html"),
      allowingReadAccessTo: webAssets
    )
    window?.makeFirstResponder(webView)

    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.monacoOpen",
      details: [
        "filePath": filePath,
        "language": language,
        "requestId": command.requestId ?? "",
        "statusFile": command.statusFile ?? "",
      ])
  }

  private func saveFloatingMonacoEditor(
    overlayView: FloatingEditorOverlayView,
    webView: WKWebView,
    filePath: String,
    statusFile: String?
  ) {
    webView.evaluateJavaScript("window.zmuxMonacoGetValue ? window.zmuxMonacoGetValue() : ''") {
      [weak self, weak overlayView] result, error in
      DispatchQueue.main.async {
        guard let self, let overlayView, self.floatingEditorOverlayView === overlayView else {
          return
        }
        if let error {
          TerminalFocusDebugLog.append(
            event: "nativeWorkspace.floatingEditor.monacoSaveFailed",
            details: [
              "error": error.localizedDescription,
              "filePath": filePath,
            ])
          overlayView.resetSaveButton()
          return
        }
        let text = result as? String ?? ""
        do {
          try text.write(toFile: filePath, atomically: true, encoding: .utf8)
          self.writeFloatingEditorStatusFile(statusFile, status: "saved")
          self.closeFloatingEditorOverlay(requestGhosttyClose: false, reason: "monacoSaved")
        } catch {
          TerminalFocusDebugLog.append(
            event: "nativeWorkspace.floatingEditor.monacoSaveFailed",
            details: [
              "error": error.localizedDescription,
              "filePath": filePath,
            ])
          overlayView.resetSaveButton()
        }
      }
    }
  }

  private func writeFloatingEditorStatusFile(_ statusFile: String?, status: String) {
    guard let statusFile = statusFile?.trimmingCharacters(in: .whitespacesAndNewlines),
      !statusFile.isEmpty
    else {
      return
    }
    do {
      let url = URL(fileURLWithPath: statusFile)
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try "\(status)\n".write(to: url, atomically: true, encoding: .utf8)
      floatingEditorStatusWritten = true
    } catch {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.floatingEditor.statusWriteFailed",
        details: [
          "error": error.localizedDescription,
          "status": status,
          "statusFile": statusFile,
        ])
    }
  }

  private func defaultFloatingEditorFrame() -> CGRect {
    let margin = Self.floatingEditorMargin
    let availableWidth = max(Self.floatingEditorMinimumWidth, bounds.width - margin * 2)
    let availableHeight = max(Self.floatingEditorMinimumHeight, bounds.height - margin * 2)
    let width = min(max(Self.floatingEditorMinimumWidth, bounds.width * 0.74), availableWidth)
    let height = min(max(Self.floatingEditorMinimumHeight, bounds.height * 0.44), availableHeight)
    return CGRect(
      x: max(margin, (bounds.width - width) / 2),
      y: margin,
      width: width,
      height: height
    )
  }

  private func storedFloatingEditorFrame() -> CGRect? {
    guard
      let stored = UserDefaults.standard.string(forKey: Self.floatingEditorFrameDefaultsKey)
    else {
      return nil
    }
    let frame = NSRectFromString(stored)
    guard frame.width > 1, frame.height > 1 else {
      return nil
    }
    return frame
  }

  private func persistFloatingEditorFrame(_ frame: CGRect) {
    UserDefaults.standard.set(NSStringFromRect(frame), forKey: Self.floatingEditorFrameDefaultsKey)
  }

  private func clampedFloatingEditorFrame(_ frame: CGRect) -> CGRect {
    guard bounds.width > 1, bounds.height > 1 else {
      return frame
    }
    let margin = min(Self.floatingEditorMargin, max(4, min(bounds.width, bounds.height) / 8))
    let maxWidth = max(240, bounds.width - margin * 2)
    let maxHeight = max(180, bounds.height - margin * 2)
    var next = frame
    next.size.width = min(max(240, next.width), maxWidth)
    next.size.height = min(max(180, next.height), maxHeight)
    next.origin.x = min(max(margin, next.origin.x), max(margin, bounds.width - next.width - margin))
    next.origin.y = min(max(margin, next.origin.y), max(margin, bounds.height - next.height - margin))
    return next
  }

  private func layoutFloatingEditorOverlay() {
    guard let overlayView = floatingEditorOverlayView else {
      return
    }
    if overlayView.frame.isEmpty || !overlayView.isUserPositioned {
      overlayView.frame = defaultFloatingEditorFrame()
    } else {
      let clampedFrame = clampedFloatingEditorFrame(overlayView.frame)
      overlayView.frame = clampedFrame
      persistFloatingEditorFrame(clampedFrame)
    }
    orderFloatingEditorOverlayToFront()
  }

  private func orderFloatingEditorOverlayToFront() {
    guard let overlayView = floatingEditorOverlayView, overlayView.superview === self else {
      return
    }
    overlayView.layer?.zPosition = 10_000
  }

  private func startFloatingEditorExitPolling() {
    floatingEditorExitPollTimer?.invalidate()
    floatingEditorExitPollTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) {
      [weak self] _ in
      Task { @MainActor in
        self?.pollFloatingEditorExit()
      }
    }
  }

  private func pollFloatingEditorExit() {
    guard let overlayView = floatingEditorOverlayView else {
      floatingEditorExitPollTimer?.invalidate()
      floatingEditorExitPollTimer = nil
      return
    }
    if overlayView.surfaceView?.processExited == true {
      closeFloatingEditorOverlay(requestGhosttyClose: false, reason: "processExited")
    }
  }

  private func closeFloatingEditorOverlay(requestGhosttyClose: Bool, reason: String) {
    guard let overlayView = floatingEditorOverlayView else {
      return
    }
    let processExited = overlayView.surfaceView?.processExited ?? true
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.floatingEditor.close",
      details: [
        "processExited": processExited,
        "reason": reason,
        "requestGhosttyClose": requestGhosttyClose,
      ])
    if requestGhosttyClose, !processExited, let surface = overlayView.surfaceView?.surface {
      ghostty.requestClose(surface: surface)
    }
    if let surfaceView = overlayView.surfaceView {
      if !processExited, !floatingEditorStatusWritten, reason != "processExited" {
        writeFloatingEditorStatusFile(floatingEditorStatusFile, status: "cancelled")
      }
      NativeTerminalProcessMonitor.terminateSessionProcesses(
        ttyName: surfaceView.surfaceModel?.ttyName,
        foregroundPid: surfaceView.surfaceModel?.foregroundPID,
        reason: reason)
    } else if !floatingEditorStatusWritten, reason != "monacoSaved" {
      writeFloatingEditorStatusFile(floatingEditorStatusFile, status: "cancelled")
    }
    persistFloatingEditorFrame(overlayView.frame)
    floatingEditorExitPollTimer?.invalidate()
    floatingEditorExitPollTimer = nil
    overlayView.removeFromSuperview()
    floatingEditorOverlayView = nil
    floatingEditorStatusFile = nil
    floatingEditorStatusWritten = false
    if let returnFocusSessionId = overlayView.returnFocusSessionId,
      sessions[returnFocusSessionId] != nil
    {
      focusTerminal(sessionId: returnFocusSessionId, reason: "floatingEditor.\(reason)")
    }
  }

  func createTerminal(_ command: CreateTerminal) {
    let activateOnCreate = command.activateOnCreate ?? true
    /**
     CDXC:CrashDiagnostics 2026-05-04-09:10
     Rapid sidebar agent launches must identify whether the crash happens
     before Ghostty surface allocation, during mount, or after ready events.
     Keep these breadcrumbs in the native focus log alongside layout sync.
     */
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.createTerminal.received",
      details: [
        "activateOnCreate": activateOnCreate,
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "hasInitialInput": command.initialInput?.isEmpty == false,
        "knownSessionIds": Array(sessions.keys).sorted(),
        "requestedSessionId": command.sessionId,
        "title": command.title ?? "",
      ])
    if sessions[command.sessionId] != nil {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.createTerminal.existing",
        details: [
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "requestedSessionId": command.sessionId,
        ])
      focusTerminal(sessionId: command.sessionId, reason: "createTerminalExisting")
      if let initialInput = command.initialInput, !initialInput.isEmpty {
        writeTerminalText(sessionId: command.sessionId, text: initialInput)
      }
      return
    }

    guard let app = ghostty.app else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.createTerminal.ghosttyMissing",
        details: [
          "requestedSessionId": command.sessionId,
          "title": command.title ?? "",
        ])
      sendEvent(
        .terminalError(sessionId: command.sessionId, message: "Ghostty runtime is not ready"))
      return
    }

    let sessionPersistenceProvider = NativeSessionPersistenceProvider.resolve(command)
    let sessionPersistenceName: String?
    if let sessionPersistenceProvider {
      sessionPersistenceName =
        NativeSessionPersistenceMode.normalizedSessionName(
          command.sessionPersistenceName ?? command.tmuxSessionName,
          provider: sessionPersistenceProvider)
        ?? NativeSessionPersistenceMode.sessionName(
          provider: sessionPersistenceProvider,
          sessionId: command.sessionId,
          title: command.title)
    } else {
      sessionPersistenceName = nil
    }
    var config = Ghostty.SurfaceConfiguration()
    config.workingDirectory = command.cwd
    config.environmentVariables = nativeGhosttyTerminalEnvironment(command.env, sessionId: command.sessionId)
    config.initialInput = sessionPersistenceProvider == nil ? command.initialInput : nil
    if let sessionPersistenceProvider, let sessionPersistenceName {
      /**
       CDXC:SessionPersistence 2026-05-05-07:28
       When a persistence provider is selected, each zmux sidebar terminal
       creates or attaches to one named provider session. The app does not
       inspect provider-internal panes/windows/tabs; the sidebar card remains
       mapped to the original attached terminal surface.

       CDXC:SessionPersistence 2026-05-05-07:28
       App restart must reconnect to existing provider sessions without
       replaying agent launch or resume input into the live pane. Move initial
       input into the provider creation script so it is sent only when the named
       session did not already exist.
       */
      config.command = NativeSessionPersistenceMode.attachCommand(
        provider: sessionPersistenceProvider,
        cwd: command.cwd,
        initialInput: command.initialInput,
        sessionName: sessionPersistenceName
      )
    }
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.createTerminal.surfaceInit.start",
      details: [
        "commandColorEnv": nativeTerminalColorEnvironmentSnapshot(config.environmentVariables),
        "envCount": config.environmentVariables.count,
        "hasInitialInput": command.initialInput?.isEmpty == false,
        "processColorEnv": nativeTerminalColorEnvironmentSnapshot(ProcessInfo.processInfo.environment),
        "requestedSessionId": command.sessionId,
        "surfaceProcessColorEnv": nativeTerminalColorEnvironmentSnapshot(
          nativeGhosttyTerminalEffectiveProcessEnvironment()),
        "title": command.title ?? "",
        "sessionPersistenceName": sessionPersistenceName ?? "",
        "sessionPersistenceProvider": sessionPersistenceProvider?.rawValue ?? "off",
        "workingDirectory": command.cwd,
      ])
    let surfaceView = withNativeGhosttyTerminalProcessEnvironment {
      ZmuxGhosttySurfaceView(app, baseConfig: config)
    }
    surfaceView.zmuxSessionId = command.sessionId
    surfaceView.onKeyDownProbe = { [weak self] surfaceView, event, phase in
      self?.logSurfaceKeyDownProbe(surfaceView: surfaceView, event: event, phase: phase)
    }
    surfaceView.onTextInputProbe = { [weak self] surfaceView, text, replacementRange in
      self?.logSurfaceTextInputProbe(
        surfaceView: surfaceView,
        text: text,
        replacementRange: replacementRange)
    }
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.createTerminal.surfaceInit.completed",
      details: [
        "hasSurfaceModel": surfaceView.surfaceModel != nil,
        "requestedSessionId": command.sessionId,
      ])
    surfaceView.translatesAutoresizingMaskIntoConstraints = false
    /**
     CDXC:NativeTerminals 2026-04-28-03:09
     Embedded Ghostty terminals must expose the same visible scrollback
     scrollbar as Ghostty windows. Mount the surface through Ghostty's native
     scroll wrapper so scrollbar state, dragging, and scrollback positioning
     are driven by the terminal core instead of a separate overlay.
    */
    let scrollView = SurfaceScrollView(contentSize: .zero, surfaceView: surfaceView)
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    let searchBarView = TerminalSearchBarView(surfaceView: surfaceView)
    searchBarView.translatesAutoresizingMaskIntoConstraints = false
    let titleBarView = TerminalSessionTitleBarView(
      title: normalizedTerminalSessionTitle(command.title, sessionId: command.sessionId)
    )
    titleBarView.translatesAutoresizingMaskIntoConstraints = false
    titleBarView.onMouseDown = { [weak self] event in
      self?.handlePaneTitleBarMouseDown(
        event,
        sessionId: command.sessionId,
        focusReason: "nativeTitleBarMouseDown")
    }
    titleBarView.resizeCursorForPoint = { [weak self, weak titleBarView] point in
      guard let self, let titleBarView else {
        return nil
      }
      let workspacePoint = self.convert(point, from: titleBarView)
      return self.paneResizeCursor(at: workspacePoint)
    }
    titleBarView.onAction = { [weak self] action in
      guard let self else { return }
      self.focusTerminal(sessionId: command.sessionId, reason: "nativeTitleBarAction")
      self.applyOptimisticPanePopOutAction(
        sessionId: command.sessionId,
        action: action,
        reason: "nativeTitleBarAction")
      self.sendEvent(.terminalTitleBarAction(sessionId: command.sessionId, action: action))
    }
    titleBarView.onTabMouseDown = { [weak self] event, tabSessionId in
      self?.handlePaneTabMouseDown(event, sessionId: tabSessionId)
    }
    titleBarView.onTabMouseDragged = { [weak self] event, tabSessionId in
      self?.handlePaneTitleBarMouseDragged(event, sessionId: tabSessionId)
    }
    titleBarView.onTabMouseUp = { [weak self] event, tabSessionId in
      self?.handlePaneTabMouseUp(event, sessionId: tabSessionId)
    }
    titleBarView.onTabCloseRequested = { [weak self] tabSessionId, scope in
      self?.sendEvent(.paneTabCloseRequested(sessionId: tabSessionId, scope: scope))
    }
    titleBarView.onTabSleepRequested = { [weak self] tabSessionId, scope in
      self?.sendEvent(.paneTabSleepRequested(sessionId: tabSessionId, scope: scope))
    }
    let borderView = TerminalPaneBorderView()
    borderView.translatesAutoresizingMaskIntoConstraints = false
    let containerView = TerminalPaneLeafContainerView()
    containerView.translatesAutoresizingMaskIntoConstraints = true

    var session = TerminalSession(
      containerView: containerView,
      sessionId: command.sessionId,
      view: surfaceView,
      scrollView: scrollView,
      searchBarView: searchBarView,
      titleBarView: titleBarView,
      borderView: borderView,
      foregroundPid: nil,
      sessionPersistenceName: sessionPersistenceName,
      sessionPersistenceProvider: sessionPersistenceProvider,
      ttyName: nil)
    surfaceView.$title
      .removeDuplicates()
      .sink { [weak self] title in
        guard !title.isEmpty else { return }
        /**
         CDXC:NativeTerminals 2026-04-30-03:41
         Ghostty terminal/window titles are still forwarded to the sidebar for
         agent detection, but they must not directly replace the native pane
         title. The pane title comes from setActiveTerminalSet.sessionTitles so
         already-ellipsized OSC/window titles cannot poison AppKit chrome.
         */
        guard let self else { return }
        let sessionPersistenceName = self.updatePersistenceSessionForTerminalTitle(
          sessionId: command.sessionId,
          title: title
        )
        self.sendEvent(
          .terminalTitleChanged(
            sessionId: command.sessionId,
            title: title,
            sessionPersistenceName: sessionPersistenceName
          ))
      }
      .store(in: &session.cancellables)
    surfaceView.$bell
      .removeDuplicates()
      .sink { [weak self] didRing in
        if didRing {
          self?.sendEvent(.terminalBell(sessionId: command.sessionId))
        }
      }
      .store(in: &session.cancellables)
    surfaceView.$searchState
      .receive(on: DispatchQueue.main)
      .sink { [weak searchBarView] searchState in
        searchBarView?.setSearchState(searchState)
      }
      .store(in: &session.cancellables)
    surfaceView.$cellSize
      .removeDuplicates()
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in
        /**
         CDXC:NativeTerminalResize 2026-04-29-07:29
         Cell-stepped embedded terminal layout depends on Ghostty's measured
         cell size. Relayout when the initial measurement arrives or font
         settings change so pane geometry stays aligned to terminal columns.
         */
        self?.needsLayout = true
      }
      .store(in: &session.cancellables)

    sessions[command.sessionId] = session
    mountTerminalPaneContainer(for: session)
    logFocusSurfaceState(
      event: "nativeFocusTrace.createTerminalSurfaceState",
      reason: "createTerminal.registered",
      details: [
        "activateOnCreate": activateOnCreate,
        "requestedSessionId": command.sessionId,
      ])
    if activateOnCreate {
      activeSessionIds.insert(command.sessionId)
      terminalLayout = terminalLayout ?? .leaf(sessionId: command.sessionId)
    } else {
      /**
       CDXC:CrashRootCause 2026-05-04-09:19
       Sidebar-created terminals are mounted inactive because the sidebar sends
       setActiveTerminalSet immediately after creation. This prevents rapid
       launches from transiently laying out and focusing both the previous and
       new Ghostty surfaces before the authoritative visible-session snapshot
       arrives.
       */
      moveOffscreen(scrollView)
      moveOffscreen(searchBarView)
      moveOffscreen(titleBarView)
      moveOffscreen(borderView)
      moveOffscreen(containerView)
      searchBarView.isHidden = true
      titleBarView.isHidden = true
      borderView.isHidden = true
    }
    needsLayout = true
    if activateOnCreate {
      focusTerminal(sessionId: command.sessionId, reason: "createTerminalNew")
    }

    let ttyName = surfaceView.surfaceModel?.ttyName
    let foregroundPid = surfaceView.surfaceModel?.foregroundPID
    sessions[command.sessionId]?.ttyName = ttyName
    sessions[command.sessionId]?.foregroundPid = foregroundPid
    sendEvent(
      .terminalReady(
        sessionId: command.sessionId,
        ttyName: ttyName,
        foregroundPid: foregroundPid,
        sessionPersistenceName: sessionPersistenceName
      ))
    sendEvent(.terminalCwdChanged(sessionId: command.sessionId, cwd: command.cwd))
    startExitPollingIfNeeded()
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.createTerminal.completed",
      details: [
        "activateOnCreate": activateOnCreate,
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "foregroundPid": foregroundPid ?? 0,
        "requestedSessionId": command.sessionId,
        "ttyName": ttyName ?? "",
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
  }

  private func updatePersistenceSessionForTerminalTitle(sessionId: String, title: String) -> String? {
    guard
      let provider = sessions[sessionId]?.sessionPersistenceProvider,
      let currentSessionName = sessions[sessionId]?.sessionPersistenceName
    else {
      return nil
    }
    guard provider == .tmux else {
      /**
       CDXC:SessionPersistence 2026-05-05-07:28
       zmx 0.4 exposes attach/run/list/kill/history but no rename command, and
       zellij session rename is an in-session action rather than a targetable
       external command. Keep non-tmux durable attach identities stable while
       the sidebar still follows Ghostty title events for user-visible card
       names.
       */
      return currentSessionName
    }
    let nextSessionName = NativeSessionPersistenceMode.sessionName(
      provider: provider,
      sessionId: sessionId,
      title: title)
    guard nextSessionName != currentSessionName else {
      return currentSessionName
    }
    /**
     CDXC:SessionPersistence 2026-05-05-07:28
     Agent CLIs reveal useful task names through terminal title changes after
     launch. tmux can rename the backing session from that live title so SSH
     users can find the same session by task-oriented name instead of opaque id.
     */
    sessions[sessionId]?.sessionPersistenceName = nextSessionName
    NativeSessionPersistenceMode.renameTmuxSession(
      from: currentSessionName,
      sessionId: sessionId,
      title: title,
      to: nextSessionName
    )
    return nextSessionName
  }

  func closeTerminal(sessionId: String) {
    closeTerminal(sessionId: sessionId, requestGhosttyClose: true, reason: "closeTerminal")
  }

  private func closeTerminal(sessionId: String, requestGhosttyClose: Bool, reason: String) {
    guard let session = sessions.removeValue(forKey: sessionId) else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.closeTerminal.missing",
        details: [
          "reason": reason,
          "sessionId": sessionId,
        ])
      return
    }
    let processExited = session.view.processExited
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.closeTerminal.start",
      details: [
        "activeProjectEditorId": nullableString(activeProjectEditorId),
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "hasSurface": session.view.surface != nil,
        "processExited": processExited,
        "reason": reason,
        "requestGhosttyClose": requestGhosttyClose,
        "sessionId": sessionId,
      ])
    activeSessionIds.remove(sessionId)
    sessionActivities.removeValue(forKey: sessionId)
    sessionAgentIconDataUrls.removeValue(forKey: sessionId)
    sessionFaviconDataUrls.removeValue(forKey: sessionId)
    sessionTitleBarActions.removeValue(forKey: sessionId)
    sessionTitles.removeValue(forKey: sessionId)
    closePoppedOutPaneWindow(sessionId: sessionId, reason: "closeTerminal")
    resizeLogSignatureBySessionId.removeValue(forKey: sessionId)
    /**
     CDXC:TerminalExitCleanup 2026-05-06-01:01
     Exit polling runs after Ghostty has already marked the PTY surface exited.
     Do not send Ghostty a second close request for that surface; the log at
     2026-05-06 00:52:50 showed the app voluntarily terminating immediately
     after this path handled an already-exited split pane.
     */
    if requestGhosttyClose, !processExited, let surface = session.view.surface {
      ghostty.requestClose(surface: surface)
    }
    NativeTerminalProcessMonitor.terminateSessionProcesses(
      ttyName: session.view.surfaceModel?.ttyName ?? session.ttyName,
      foregroundPid: session.view.surfaceModel?.foregroundPID ?? session.foregroundPid,
      reason: reason)
    session.containerView.removeFromSuperview()
    terminalLayout = prunedLayout(removing: sessionId, from: terminalLayout)
    attentionSessionIds.remove(sessionId)
    if focusedSessionId == sessionId {
      focusedSessionId = nil
    }
    needsLayout = true
    sendEvent(.terminalExited(sessionId: sessionId, exitCode: nil))
    stopExitPollingIfIdle()
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.closeTerminal.completed",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "focusedSessionId": nullableString(focusedSessionId),
        "processExited": processExited,
        "reason": reason,
        "sessionId": sessionId,
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
  }

  /**
   CDXC:T3Code 2026-04-30-02:38
   T3 Code is a web pane in the reference workspace, not a terminal command.
   Native zmux therefore mounts a WKWebView surface in the same pane layout so
   the T3 button embeds the app instead of typing `npx --yes t3` into Ghostty.
   */
  func createWebPane(_ command: CreateWebPane) {
    let initialUrl = URL(string: command.url)
    let isManagedT3Pane = initialUrl.map(NativeT3RuntimeLauncher.isManagedRuntimeURL) ?? false
    if let existingSession = webPaneSessions[command.sessionId] {
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.create.reused", [
        "sessionId": command.sessionId,
        "threadId": command.threadId ?? NSNull(),
        "url": command.url,
      ])
      if existingSession.isManagedT3Pane, isManagedT3Pane {
        webPaneSessions[command.sessionId] = WebPaneSession(
          browserTitleObservation: existingSession.browserTitleObservation,
          containerView: existingSession.containerView,
          chromiumView: existingSession.chromiumView,
          diagnosticsBridge: existingSession.diagnosticsBridge,
          hostView: existingSession.hostView,
          isManagedT3Pane: existingSession.isManagedT3Pane,
          projectId: command.projectId,
          sessionId: existingSession.sessionId,
          threadId: command.threadId,
          title: command.title,
          workspaceRoot: command.cwd ?? existingSession.workspaceRoot,
          browserProfileID: existingSession.browserProfileID,
          webView: existingSession.webView,
          titleBarView: existingSession.titleBarView,
          borderView: existingSession.borderView
        )
        existingSession.titleBarView.setTitle(
          normalizedTerminalSessionTitle(command.title, sessionId: command.sessionId))
        if let url = initialUrl {
          completedWebPaneLoadSessionIds.remove(command.sessionId)
          pendingAuthenticatedWebPaneLoadSessionIds.remove(command.sessionId)
          loadWebPane(sessionId: command.sessionId, url: url, reason: "createWebPaneExistingReroute")
        }
      }
      focusWebPane(sessionId: command.sessionId, reason: "createWebPaneExisting")
      return
    }

    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.create.start", [
      "sessionId": command.sessionId,
      "title": command.title,
      "url": command.url,
      "workspaceRoot": command.cwd ?? NSNull(),
    ])
    let browserProfileID = isManagedT3Pane ? nil : NativeBrowserProfileStore.shared.effectiveLastUsedProfileID
    let diagnosticsBridge = T3CodePaneDiagnosticsBridge(
      sessionId: command.sessionId,
      onThreadChanged: { [weak self] sessionId, threadId, title in
        self?.sendEvent(.t3ThreadChanged(sessionId: sessionId, threadId: threadId, title: title))
      })

    let webView: WKWebView?
    let chromiumView: ZmuxCEFBrowserView?
    if isManagedT3Pane {
      let configuration = WKWebViewConfiguration()
      configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
      configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
      configuration.websiteDataStore = .default()
      configuration.userContentController.add(
        diagnosticsBridge,
        name: T3CodePaneDiagnosticsBridge.messageHandlerName
      )
      configuration.userContentController.addUserScript(
        WKUserScript(
          source: Self.t3WebPaneDiagnosticsScript,
          injectionTime: .atDocumentStart,
          forMainFrameOnly: false
        ))
      configuration.userContentController.addUserScript(
        WKUserScript(
          source: Self.t3WebPaneBridgeScript(
            sessionId: command.sessionId, title: command.title, workspaceRoot: command.cwd),
          injectionTime: .atDocumentStart,
          forMainFrameOnly: true
        ))
      let managedWebView = WKWebView(frame: .zero, configuration: configuration)
      if #available(macOS 13.3, *) {
        managedWebView.isInspectable = true
      }
      managedWebView.translatesAutoresizingMaskIntoConstraints = true
      managedWebView.allowsBackForwardNavigationGestures = true
      managedWebView.navigationDelegate = self
      managedWebView.uiDelegate = self
      /**
       CDXC:T3Code 2026-04-30-19:17
       Native T3 panes must use WKWebView's default opaque drawing path. The
       accessibility tree can report a live T3 DOM even when transparent WebKit
       compositing only shows the workspace's gray backing layer, so do not make
       the embedded app transparent while debugging or rendering production panes.
       */
      managedWebView.wantsLayer = true
      managedWebView.layer?.masksToBounds = true
      managedWebView.underPageBackgroundColor = NSColor(calibratedRed: 0.086, green: 0.086, blue: 0.086, alpha: 1)
      webView = managedWebView
      chromiumView = nil
    } else {
      guard ZmuxCEFIsRuntimeAvailable() else {
        /**
         CDXC:ChromiumBrowserPanes 2026-05-04-16:38
         Normal browser panes must render with Chromium. If the bundled CEF
         runtime is missing, fail visibly instead of opening a WebKit pane that
         looks like the requested workflow but uses the wrong engine.
         */
        sendEvent(
          .terminalError(
            sessionId: command.sessionId,
            message: "Chromium runtime is not bundled for browser panes"))
        return
      }
      let profileIdentifier = browserProfileID?.uuidString ?? "default"
      let browserView = ZmuxCEFBrowserView(
        frame: .zero,
        initialURL: command.url,
        profileIdentifier: profileIdentifier)
      browserView.translatesAutoresizingMaskIntoConstraints = true
      webView = nil
      chromiumView = browserView
    }
    /**
     CDXC:BrowserPanes 2026-05-02-16:58
     Browser panes need in-pane navigation chrome like the embedded browser
     reference: back/forward/reload, a URL field, and browser tooling buttons.
     The chrome is owned by the native pane host, not an overlay, so the pane
     still participates in the same splitter layout as T3 Code and terminals.
     */
    let hostView = WebPaneHostView(
      browserView: chromiumView ?? webView!,
      chromiumView: chromiumView,
      webView: webView,
      showsBrowserToolbar: !isManagedT3Pane,
      initialAddress: command.url,
      onFocus: { [weak self] in
        self?.focusWebPane(sessionId: command.sessionId, reason: "browserToolbar")
      },
      onOpenDevTools: { [weak self] in
        self?.openBrowserDevTools(sessionId: command.sessionId)
      },
      onInjectReactGrab: { [weak self] in
        self?.injectBrowserReactGrab(sessionId: command.sessionId)
      },
      onShowProfilePicker: { [weak self] in
        self?.showBrowserProfilePicker(sessionId: command.sessionId)
      },
      onShowImportSettings: { [weak self] in
        self?.showBrowserImportSettings(sessionId: command.sessionId)
      }
    )
    hostView.translatesAutoresizingMaskIntoConstraints = false
    if let chromiumView {
      chromiumView.titleChangedHandler = { [weak self, weak hostView, weak chromiumView] title in
        self?.updateChromiumWebPaneMetadata(
          sessionId: command.sessionId,
          title: title,
          url: chromiumView?.currentURLString,
          reason: "chromiumTitleChanged")
        hostView?.refreshBrowserToolbar(reason: "chromiumTitleChanged")
      }
      chromiumView.urlChangedHandler = { [weak self, weak hostView, weak chromiumView] url in
        self?.updateChromiumWebPaneMetadata(
          sessionId: command.sessionId,
          title: chromiumView?.pageTitle,
          url: url,
          reason: "chromiumUrlChanged")
        hostView?.refreshBrowserToolbar(reason: "chromiumUrlChanged")
      }
      chromiumView.faviconURLChangedHandler = { [weak self] faviconURL in
        self?.updateChromiumWebPaneFavicon(
          sessionId: command.sessionId,
          faviconURL: URL(string: faviconURL),
          reason: "chromiumFaviconChanged")
      }
      chromiumView.navigationStateChangedHandler = { [weak hostView] _, _, _ in
        hostView?.refreshBrowserToolbar(reason: "chromiumNavigationStateChanged")
      }
    }

    let titleBarView = TerminalSessionTitleBarView(
      title: normalizedTerminalSessionTitle(command.title, sessionId: command.sessionId),
      actions: TerminalSessionTitleBarView.webPaneCreationActions
    )
    titleBarView.translatesAutoresizingMaskIntoConstraints = false
    titleBarView.onMouseDown = { [weak self] event in
      self?.handlePaneTitleBarMouseDown(
        event,
        sessionId: command.sessionId,
        focusReason: "nativeWebTitleBarMouseDown")
    }
    titleBarView.resizeCursorForPoint = { [weak self, weak titleBarView] point in
      guard let self, let titleBarView else {
        return nil
      }
      let workspacePoint = self.convert(point, from: titleBarView)
      return self.paneResizeCursor(at: workspacePoint)
    }
    titleBarView.onAction = { [weak self] action in
      guard let self else { return }
      self.focusWebPane(sessionId: command.sessionId, reason: "nativeWebTitleBarAction")
      self.applyOptimisticPanePopOutAction(
        sessionId: command.sessionId,
        action: action,
        reason: "nativeWebTitleBarAction")
      self.sendEvent(.terminalTitleBarAction(sessionId: command.sessionId, action: action))
    }
    titleBarView.onTabMouseDown = { [weak self] event, tabSessionId in
      self?.handlePaneTabMouseDown(event, sessionId: tabSessionId)
    }
    titleBarView.onTabMouseDragged = { [weak self] event, tabSessionId in
      self?.handlePaneTitleBarMouseDragged(event, sessionId: tabSessionId)
    }
    titleBarView.onTabMouseUp = { [weak self] event, tabSessionId in
      self?.handlePaneTabMouseUp(event, sessionId: tabSessionId)
    }
    titleBarView.onTabCloseRequested = { [weak self] tabSessionId, scope in
      self?.sendEvent(.paneTabCloseRequested(sessionId: tabSessionId, scope: scope))
    }
    titleBarView.onTabSleepRequested = { [weak self] tabSessionId, scope in
      self?.sendEvent(.paneTabSleepRequested(sessionId: tabSessionId, scope: scope))
    }
    let borderView = TerminalPaneBorderView()
    borderView.translatesAutoresizingMaskIntoConstraints = false
    let containerView = TerminalPaneLeafContainerView()
    containerView.translatesAutoresizingMaskIntoConstraints = true
    /**
     CDXC:BrowserPanes 2026-05-03-01:58
     Browser panes should name native chrome from the loaded page, not the
     launch URL or localhost wrapper. Observe WKWebView title changes and feed
     them through the existing session-title sync path so later layout syncs do
     not overwrite the AppKit title bar with the initial browser card title.
     */
    let browserTitleObservation: NSKeyValueObservation? = nil

    webPaneSessions[command.sessionId] = WebPaneSession(
      browserTitleObservation: browserTitleObservation,
      containerView: containerView,
      chromiumView: chromiumView,
      diagnosticsBridge: diagnosticsBridge,
      hostView: hostView,
      isManagedT3Pane: isManagedT3Pane,
      projectId: command.projectId,
      sessionId: command.sessionId,
      threadId: command.threadId,
      title: command.title,
      workspaceRoot: command.cwd,
      browserProfileID: browserProfileID,
      webView: webView,
      titleBarView: titleBarView,
      borderView: borderView
    )
    activeSessionIds.insert(command.sessionId)
    if let session = webPaneSessions[command.sessionId] {
      mountWebPaneContainer(for: session)
      orderWebPaneViewsToFront(session)
    }
    terminalLayout = terminalLayout ?? .leaf(sessionId: command.sessionId)

    if let url = initialUrl {
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.requested", [
        "isManagedT3Pane": isManagedT3Pane,
        "sessionId": command.sessionId,
        "url": url.absoluteString,
        "workspaceRoot": command.cwd ?? NSNull(),
      ])
      loadWebPaneStatus(
        sessionId: command.sessionId,
        title: command.title,
        message: isManagedT3Pane ? "Loading T3 Code…" : "Loading Browser…",
        caption: isManagedT3Pane ? "Preparing the embedded workspace" : url.absoluteString,
        loading: true,
        reason: "createWebPane")
      loadWebPane(sessionId: command.sessionId, url: url, reason: "initial")
    } else {
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.invalidUrl", [
        "sessionId": command.sessionId,
        "url": command.url,
      ])
    }

    needsLayout = true
    scheduleDeferredWebPaneLayout(sessionId: command.sessionId, reason: "createWebPaneNew")
    focusWebPane(sessionId: command.sessionId, reason: "createWebPaneNew")
  }

  func closeWebPane(sessionId: String) {
    guard let session = webPaneSessions.removeValue(forKey: sessionId) else {
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.close.missing", [
        "sessionId": sessionId,
      ])
      return
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.close.start", [
      "currentUrl": session.currentURLString ?? NSNull(),
      "sessionId": sessionId,
    ])
    activeSessionIds.remove(sessionId)
    sessionActivities.removeValue(forKey: sessionId)
    sessionAgentIconDataUrls.removeValue(forKey: sessionId)
    sessionFaviconDataUrls.removeValue(forKey: sessionId)
    sessionTitleBarActions.removeValue(forKey: sessionId)
    sessionTitles.removeValue(forKey: sessionId)
    closePoppedOutPaneWindow(sessionId: sessionId, reason: "closeWebPane")
    completedWebPaneLoadSessionIds.remove(sessionId)
    pendingAuthenticatedWebPaneLoadSessionIds.remove(sessionId)
    t3ThreadRouteRetryAttemptsBySessionId.removeValue(forKey: sessionId)
    webPaneFaviconTasksBySessionId.removeValue(forKey: sessionId)?.cancel()
    if let webView = session.webView {
      webView.navigationDelegate = nil
      webView.uiDelegate = nil
      webView.configuration.userContentController.removeScriptMessageHandler(
        forName: T3CodePaneDiagnosticsBridge.messageHandlerName
      )
      webView.stopLoading()
    }
    /**
     CDXC:ChromiumBrowserPanes 2026-05-07-07:31
     Middle-clicking a browser card must close only that sidebar pane. The
     2026-05-07 07:08 log showed pane close entering Chromium teardown and then
     closing the top-level app window, so keep explicit before/after logs around
     the embedded browser close request.
     */
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.close.browserTeardown.start", [
      "hasChromiumView": session.chromiumView != nil,
      "hasWebView": session.webView != nil,
      "sessionId": sessionId,
    ])
    session.chromiumView?.closeBrowser()
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.close.browserTeardown.completed", [
      "sessionId": sessionId,
    ])
    session.containerView.removeFromSuperview()
    terminalLayout = prunedLayout(removing: sessionId, from: terminalLayout)
    attentionSessionIds.remove(sessionId)
    if focusedSessionId == sessionId {
      focusedSessionId = nil
    }
    needsLayout = true
    sendEvent(.terminalExited(sessionId: sessionId, exitCode: nil))
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.close.completed", [
      "activeSessionIds": Array(activeSessionIds).sorted(),
      "focusedSessionId": nullableString(focusedSessionId),
      "sessionId": sessionId,
      "visibleSessionIds": orderedVisibleSessionIds(),
    ])
  }

  func focusWebPane(sessionId: String, reason: String = "explicitFocusWebPaneCommand") {
    guard let session = webPaneSessions[sessionId] else {
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.focus.missing", [
        "knownSessionIds": Array(webPaneSessions.keys).sorted(),
        "reason": reason,
        "sessionId": sessionId,
      ])
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.focusWebPane.missingSession",
        details: [
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "knownSessionIds": Array(webPaneSessions.keys).sorted(),
          "reason": reason,
          "requestedSessionId": sessionId,
      ])
      return
    }
    let view = session.browserContentView
    let hadActiveProjectEditor = activeProjectEditorId != nil
    activeProjectEditorId = nil
    syncPaneHeaderEventMonitorForCurrentSurface(reason: "focusWebPane")
    if hadActiveProjectEditor {
      needsLayout = true
      layoutSubtreeIfNeeded()
    }
    focusedSessionId = sessionId
    orderWebPaneViewsToFront(session)
    updateAllTerminalBorders()
    if let controller = poppedOutPaneControllers[sessionId] {
      controller.window?.makeKeyAndOrderFront(nil)
      _ = controller.window?.makeFirstResponder(view)
    } else {
      _ = window?.makeFirstResponder(view)
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.focus.applied", [
      "currentUrl": session.currentURLString ?? NSNull(),
      "reason": reason,
      "sessionId": sessionId,
    ])
    sendEvent(.terminalFocused(sessionId: sessionId))
  }

  func createProjectEditorPane(_ command: CreateProjectEditorPane) {
    NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.create.received", [
      "projectId": command.projectId,
      "title": command.title,
      "url": command.url,
    ])
    if let existingSession = projectEditorPaneSessions[command.projectId] {
      let nextSession = ProjectEditorPaneSession(
        chromiumView: existingSession.chromiumView,
        hostView: existingSession.hostView,
        projectId: command.projectId,
        title: command.title,
        url: command.url
      )
      projectEditorPaneSessions[command.projectId] = nextSession
      if existingSession.url != command.url {
        loadProjectEditorPaneWhenReady(
          projectId: command.projectId, url: command.url, reason: "createProjectEditorPaneReroute")
      }
      configureProjectEditorChromiumCallbacks(
        existingSession.chromiumView,
        projectId: command.projectId,
        reason: "createProjectEditorPaneExisting")
      focusProjectEditorPane(projectId: command.projectId, reason: "createProjectEditorPaneExisting")
      return
    }

    guard ZmuxCEFIsRuntimeAvailable() else {
      /**
       CDXC:EditorPanes 2026-05-06-14:21
       Project editors must embed code-server through Chromium without browser
       chrome. If CEF is unavailable, fail visibly instead of creating a WebKit
       substitute that would have different VS Code rendering and websocket
       behavior.
       */
      sendEvent(
        .terminalError(
          sessionId: "project-editor-\(command.projectId)",
          message: "Chromium runtime is not bundled for editor panes"))
      sendEvent(
        .projectEditorLoadState(
          projectId: command.projectId,
          status: "error",
          message: "Chromium runtime is not bundled for editor panes"))
      return
    }

    /**
     CDXC:EditorPanes 2026-05-07-07:53
     Embedded VS Code panel positions must survive app restarts without making
     code-server boot in a fresh browser profile. The VS Code workbench stores
     layout in browser-side origin storage, so project editor CEF views use the
     persistent default Chromium profile; project ownership stays in the native
     editor session and code-server folder URL, not in a separate CEF profile.
     */
    let chromiumView = ZmuxCEFBrowserView(
      frame: .zero,
      initialURL: "about:blank",
      profileIdentifier: "default")
    chromiumView.translatesAutoresizingMaskIntoConstraints = true
    let hostView = WebPaneHostView(
      browserView: chromiumView,
      chromiumView: chromiumView,
      showsBrowserToolbar: false,
      showsInitialLoadingOverlay: true,
      initialAddress: command.url,
      onFocus: { [weak self] in
        self?.focusProjectEditorPane(projectId: command.projectId, reason: "projectEditorHostFocus")
      }
    )
    hostView.translatesAutoresizingMaskIntoConstraints = true
    projectEditorPaneSessions[command.projectId] = ProjectEditorPaneSession(
      chromiumView: chromiumView,
      hostView: hostView,
      projectId: command.projectId,
      title: command.title,
      url: command.url
    )
    configureProjectEditorChromiumCallbacks(
      chromiumView,
      projectId: command.projectId,
      reason: "createProjectEditorPaneNew")
    addSubview(hostView)
    moveOffscreen(hostView)
    loadProjectEditorPaneWhenReady(
      projectId: command.projectId, url: command.url, reason: "createProjectEditorPaneNew")
    focusProjectEditorPane(projectId: command.projectId, reason: "createProjectEditorPaneNew")
  }

  func focusProjectEditorPane(
    projectId: String,
    reason: String = "explicitFocusProjectEditorPaneCommand"
  ) {
    guard let session = projectEditorPaneSessions[projectId] else {
      NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.focus.missing", [
        "knownProjectIds": Array(projectEditorPaneSessions.keys).sorted(),
        "projectId": projectId,
        "reason": reason,
      ])
      return
    }
    /**
     CDXC:EditorPanes 2026-05-06-14:21
     Editor panes are full-workspace project surfaces. Focusing one hides every
     terminal/browser split view and brings the project's Chromium code-server
     view forward without changing the saved terminal split layout.
   */
    activeProjectEditorId = projectId
    syncPaneHeaderEventMonitorForCurrentSurface(reason: "focusProjectEditorPane")
    focusedSessionId = nil
    hideSplitSessionSurfacesForActiveEditor()
    session.hostView.isHidden = false
    layoutProjectEditorPane(session)
    orderProjectEditorPaneToFront(session)
    _ = window?.makeFirstResponder(session.chromiumView)
    needsLayout = true
    NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.focus.applied", [
      "projectId": projectId,
      "reason": reason,
      "title": session.title,
      "url": session.url,
    ])
  }

  func closeProjectEditorPane(projectId: String) {
    guard let session = projectEditorPaneSessions.removeValue(forKey: projectId) else {
      return
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.close", [
      "projectId": projectId,
      "url": session.url,
    ])
    session.chromiumView.closeBrowser()
    session.hostView.removeFromSuperview()
    if activeProjectEditorId == projectId {
      activeProjectEditorId = nil
      syncPaneHeaderEventMonitorForCurrentSurface(reason: "closeProjectEditorPane")
      needsLayout = true
    }
  }

  func closeFocusedSession(reason: String) -> Bool {
    /**
     CDXC:PaneClose 2026-05-10-11:56
     Cmd-W must close the user's focused workspace surface, not the native app
     window. Prefer AppKit's current responder so embedded Chrome/Ghostty focus
     wins over stale sidebar state, then fall back to the last focused session id.
     */
    if let activeProjectEditorId, projectEditorPaneSessions[activeProjectEditorId] != nil {
      closeProjectEditorPane(projectId: activeProjectEditorId)
      return true
    }

    let candidates = [currentResponderSessionId(), focusedSessionId].compactMap { $0 }
    guard let sessionId = candidates.first(where: { activeSessionIds.contains($0) }) else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.closeFocusedSession.missingFocus",
        details: [
          "activeProjectEditorId": nullableString(activeProjectEditorId),
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "focusedSessionId": nullableString(focusedSessionId),
          "reason": reason,
          "responder": responderSnapshot(),
        ])
      return false
    }

    if sessions[sessionId] != nil {
      closeTerminal(sessionId: sessionId, requestGhosttyClose: true, reason: reason)
      return true
    }
    if webPaneSessions[sessionId] != nil {
      closeWebPane(sessionId: sessionId)
      return true
    }

    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.closeFocusedSession.staleFocus",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "focusedSessionId": nullableString(focusedSessionId),
        "reason": reason,
        "sessionId": sessionId,
      ])
    return false
  }

  func openBrowserDevTools(sessionId: String) {
    guard let session = webPaneSessions[sessionId] else {
      return
    }
    focusWebPane(sessionId: sessionId, reason: "browserDevTools")
    if let chromiumView = session.chromiumView {
      chromiumView.toggleDevTools()
    } else if let webView = session.webView, !NativeBrowserDevTools.toggle(for: webView) {
      NSSound.beep()
    }
  }

  func injectBrowserReactGrab(sessionId: String) {
    guard let session = webPaneSessions[sessionId] else {
      return
    }
    focusWebPane(sessionId: sessionId, reason: "browserReactGrab")
    Task { @MainActor in
      if let chromiumView = session.chromiumView {
        await NativeBrowserReactGrabInjector.toggleOrInject(into: chromiumView)
      } else if let webView = session.webView {
        await NativeBrowserReactGrabInjector.toggleOrInject(into: webView)
      }
    }
  }

  func showBrowserProfilePicker(sessionId: String) {
    guard let session = webPaneSessions[sessionId] else {
      return
    }
    focusWebPane(sessionId: sessionId, reason: "browserProfilePicker")
    NativeBrowserProfileUI.showPicker(
      parentWindow: window,
      currentProfileID: session.browserProfileID
    )
  }

  func showBrowserImportSettings(sessionId: String) {
    guard webPaneSessions[sessionId] != nil else {
      return
    }
    focusWebPane(sessionId: sessionId, reason: "browserImportSettings")
    NativeBrowserProfileUI.showImportSettings(parentWindow: window)
  }

  func reloadWebPane(sessionId: String) {
    guard let session = webPaneSessions[sessionId] else {
      return
    }
    focusWebPane(sessionId: sessionId, reason: "browserPaneReload")
    /**
     CDXC:BrowserPanes 2026-05-02-17:39
     Browser-pane title-bar reload must operate on the embedded WKWebView,
     because browser panes are first-class AppKit panes and their title-bar
     controls should not be terminal-only no-ops.
     */
    if session.isLoading {
      if let chromiumView = session.chromiumView {
        chromiumView.stopLoading()
      } else {
        session.webView?.stopLoading()
      }
    } else {
      if let chromiumView = session.chromiumView {
        chromiumView.reload()
      } else {
        session.webView?.reload()
      }
    }
  }

  func focusTerminal(sessionId: String, reason: String = "explicitFocusTerminalCommand") {
    guard let view = sessions[sessionId]?.view else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.focusTerminal.missingSession",
        details: [
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "knownSessionIds": Array(sessions.keys).sorted(),
          "reason": reason,
          "requestedSessionId": sessionId,
          "responderBefore": responderSnapshot(),
      ])
      return
    }
    let hadActiveProjectEditor = activeProjectEditorId != nil
    activeProjectEditorId = nil
    syncPaneHeaderEventMonitorForCurrentSurface(reason: "focusTerminal")
    if hadActiveProjectEditor {
      needsLayout = true
      layoutSubtreeIfNeeded()
    }
    focusedSessionId = sessionId
    updateAllTerminalBorders()
    let targetWindow = poppedOutPaneControllers[sessionId]?.window ?? window
    poppedOutPaneControllers[sessionId]?.window?.makeKeyAndOrderFront(nil)
    let didChangeFocus = targetWindow?.firstResponder !== view
    let responderBefore = responderSnapshot()
    programmaticFocusDepth += 1
    let makeFirstResponderResult = targetWindow?.makeFirstResponder(view) ?? false
    programmaticFocusDepth -= 1
    let responderAfter = responderSnapshot()
    logFocusSurfaceState(
      event: "nativeFocusTrace.focusTerminalSurfaceState",
      reason: reason,
      details: [
        "didChangeFocus": didChangeFocus,
        "makeFirstResponderResult": makeFirstResponderResult,
        "requestedSessionId": sessionId,
        "targetWindowNumber": targetWindow?.windowNumber ?? 0,
      ])
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.focusTerminal.completed",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "didChangeFocus": didChangeFocus,
        "makeFirstResponderResult": makeFirstResponderResult,
        "reason": reason,
        "requestedSessionId": sessionId,
        "responderAfter": responderAfter,
        "responderBefore": responderBefore,
        "viewFrame": describeFrame(view.frame),
        "visibleSessionIds": orderedVisibleSessionIds(),
        "windowIsKey": window?.isKeyWindow ?? false,
      ])
  }

  func windowFirstResponderChanged(_ responder: NSResponder?, reason: String) {
    if programmaticFocusDepth > 0 {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.windowFirstResponderChanged.programmaticSkipped",
        details: [
          "programmaticFocusDepth": programmaticFocusDepth,
          "reason": reason,
          "responder": responder.map { String(describing: type(of: $0)) } ?? "nil",
        ])
      TerminalFocusDebugLog.append(
        event: "nativeFocusTrace.windowFirstResponderChangedProgrammatic",
        details: [
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "focusedSessionId": nullableString(focusedSessionId),
          "programmaticFocusDepth": programmaticFocusDepth,
          "reason": reason,
          "responder": responder.map { String(describing: type(of: $0)) } ?? "nil",
          "responderSessionId": nullableString(responder.flatMap { self.sessionId(containing: $0) }),
          "visibleSessionIds": orderedVisibleSessionIds(),
        ])
      return
    }
    guard let responder else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.windowFirstResponderChanged.nil",
        details: [
          "lastEmittedFocusedSessionId": nullableString(lastEmittedFocusedSessionId),
          "reason": reason,
        ])
      TerminalFocusDebugLog.append(
        event: "nativeFocusTrace.windowFirstResponderChangedNil",
        details: [
          "focusedSessionId": nullableString(focusedSessionId),
          "lastEmittedFocusedSessionId": nullableString(lastEmittedFocusedSessionId),
          "reason": reason,
        ])
      return
    }
    /**
     CDXC:NativeTerminalFocus 2026-05-11-11:48
     Wrong-pane typing reports require the first-responder transition history,
     not just the later terminalFocused event. Persist each AppKit-originated
     responder handoff while debugging so key-route logs can be correlated with
     the exact responder that existed before the user typed.
     */
    TerminalFocusDebugLog.append(
      event: "nativeFocusTrace.windowFirstResponderChanged",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "focusedSessionIdBeforeEmit": nullableString(focusedSessionId),
        "lastEmittedFocusedSessionId": nullableString(lastEmittedFocusedSessionId),
        "reason": reason,
        "responder": String(describing: type(of: responder)),
        "responderSessionId": nullableString(sessionId(containing: responder)),
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
    emitFocusedSessionIfNeeded(for: responder, reason: reason)
  }

  func windowKeyDownDispatch(_ event: NSEvent) {
    guard NativeDebugLogging.isEnabled else {
      return
    }
    guard focusedSessionId != nil || currentResponderSessionId() != nil else {
      return
    }
    var payload = keyboardRouteDebugPayload(surfaceSessionId: nil, event: event)
    payload["phase"] = "windowDispatch"
    /**
     CDXC:NativeTerminalFocus 2026-05-11-11:48
     The focused border is the user's visible input target. Repro logs must
     capture AppKit's keyDown dispatch target before any behavior change, so a
     later fix can be based on whether the first responder, focus ring, or
     Ghostty surface is the component that drifted.
     */
    TerminalFocusDebugLog.append(
      event: "nativeFocusTrace.windowKeyDownDispatch",
      details: payload)
  }

  private func logSurfaceKeyDownProbe(
    surfaceView: ZmuxGhosttySurfaceView,
    event: NSEvent,
    phase: String
  ) {
    guard NativeDebugLogging.isEnabled else {
      return
    }
    var payload = keyboardRouteDebugPayload(surfaceSessionId: surfaceView.zmuxSessionId, event: event)
    payload["firstResponderIsSurface"] = window?.firstResponder === surfaceView
    payload["phase"] = phase
    payload["searchActive"] = surfaceView.searchState != nil
    payload["surfaceFocusedFlag"] = surfaceView.focused
    TerminalFocusDebugLog.append(
      event: "nativeFocusTrace.surfaceKeyDown",
      details: payload)
  }

  private func logSurfaceTextInputProbe(
    surfaceView: ZmuxGhosttySurfaceView,
    text: Any,
    replacementRange: NSRange
  ) {
    guard NativeDebugLogging.isEnabled else {
      return
    }
    var payload = keyboardRouteDebugPayload(surfaceSessionId: surfaceView.zmuxSessionId)
    payload["firstResponderIsSurface"] = window?.firstResponder === surfaceView
    payload["insertTextLength"] = Self.textInputLength(text)
    payload["insertTextType"] = String(describing: type(of: text))
    payload["phase"] = "insertText"
    payload["replacementLength"] = replacementRange.length
    payload["replacementLocation"] =
      replacementRange.location == NSNotFound ? -1 : replacementRange.location
    payload["searchActive"] = surfaceView.searchState != nil
    payload["surfaceFocusedFlag"] = surfaceView.focused
    /**
     CDXC:NativeTerminalFocus 2026-05-11-11:48
     Text input probes intentionally persist only route metadata and lengths.
     Typed terminal content can include secrets, so the repro log must prove
     wrong-pane delivery without storing the characters that were typed.
     */
    TerminalFocusDebugLog.append(
      event: "nativeFocusTrace.surfaceTextInput",
      details: payload)
  }

  func writeTerminalText(sessionId: String, text: String) {
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.writeTerminalText",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "requestedSessionId": sessionId,
        "responderBefore": responderSnapshot(),
        "textLength": text.count,
        "textPreview": summarizeTerminalText(text),
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
    sessions[sessionId]?.view.surfaceModel?.sendText(text)
  }

  /**
   CDXC:SessionTitleSync 2026-04-26-10:04
   The sidebar stages `/rename <title>` as terminal text, then submits it with
   a real Return key event. Ghostty treats text carriage returns differently
   in Codex, so Enter must travel through the same key path as a user press.
   */
  func sendTerminalEnter(sessionId: String) {
    guard let view = sessions[sessionId]?.view else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.sendTerminalEnter.missingSession",
        details: [
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "requestedSessionId": sessionId,
          "responderBefore": responderSnapshot(),
          "visibleSessionIds": orderedVisibleSessionIds(),
        ])
      return
    }
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.sendTerminalEnter.start",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "requestedSessionId": sessionId,
        "responderBefore": responderSnapshot(),
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
    focusTerminal(sessionId: sessionId, reason: "sendTerminalEnter")
    guard
      let event = NSEvent.keyEvent(
        with: .keyDown,
        location: .zero,
        modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: view.window?.windowNumber ?? 0,
        context: nil,
        characters: "\r",
        charactersIgnoringModifiers: "\r",
        isARepeat: false,
        keyCode: 36
      )
    else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.sendTerminalEnter.eventCreationFailed",
        details: [
          "requestedSessionId": sessionId,
          "responderAfterFocus": responderSnapshot(),
        ])
      return
    }
    view.keyDown(with: event)
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.sendTerminalEnter.sent",
      details: [
        "requestedSessionId": sessionId,
        "responderAfter": responderSnapshot(),
      ])
  }

  func setTerminalLayout(_ nextLayout: NativeTerminalLayout) {
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.setTerminalLayout",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "responderBefore": responderSnapshot(),
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
    terminalLayout = nextLayout
    paneResizeRatiosByPath.removeAll()
    paneResizeDrag = nil
    needsLayout = true
  }

  func setTerminalVisibility(sessionId: String, visible: Bool) {
    guard let session = sessions[sessionId] else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.setTerminalVisibility.missingSession",
        details: [
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "requestedSessionId": sessionId,
          "responderBefore": responderSnapshot(),
          "visible": visible,
        ])
      return
    }
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.setTerminalVisibility",
      details: [
        "activeSessionIdsBefore": Array(activeSessionIds).sorted(),
        "requestedSessionId": sessionId,
        "responderBefore": responderSnapshot(),
        "visible": visible,
      ])
    if visible {
      activeSessionIds.insert(sessionId)
      session.containerView.isHidden = false
    } else {
      activeSessionIds.remove(sessionId)
      moveOffscreen(session.containerView)
    }
    session.containerView.isHidden = !visible
    session.scrollView.isHidden = false
    session.searchBarView.isHidden = !visible || session.view.searchState == nil
    session.titleBarView.isHidden = !visible
    session.borderView.isHidden = !visible
    needsLayout = true
    updateTerminalBorder(for: sessionId)
  }

  func setActiveTerminalSet(_ command: SetActiveTerminalSet) {
    let responderBefore = responderSnapshot()
    let nextActiveSessionIds = Set(command.activeSessionIds)
    let nextActiveProjectEditorId = command.activeProjectEditorId
    let nextPoppedOutSessionIds = Set(command.poppedOutSessionIds ?? []).intersection(nextActiveSessionIds)
    let nextPaneGap = Self.clampedPaneGap(command.paneGap)
    let nextLayout = command.layout
    let shouldRelayout =
      command.layoutChanged
      ?? (nativeLayoutSignature(
          activeSessionIds: nextActiveSessionIds,
          activeProjectEditorId: nextActiveProjectEditorId,
          layout: nextLayout,
          paneGap: nextPaneGap,
          poppedOutSessionIds: nextPoppedOutSessionIds
        )
        != nativeLayoutSignature(
          activeSessionIds: activeSessionIds,
          activeProjectEditorId: activeProjectEditorId,
          layout: terminalLayout,
          paneGap: paneGap,
          poppedOutSessionIds: poppedOutSessionIds
        ))
    let previousFocusedSessionId = focusedSessionId
    let responderSessionIdBefore = currentResponderSessionId()
    if command.focusRequestId != nil || previousFocusedSessionId != command.focusedSessionId {
      /**
       CDXC:NativeTerminalFocus 2026-05-09-15:30
       Active-border misses can be caused by a later setActiveTerminalSet
       repainting native focus from sidebar state. Record only focus-changing
       layout commands, including whether they are explicit focus requests or
       passive sync, so reproduction logs show the overwrite boundary.
       */
      TerminalFocusDebugLog.append(
        event: "nativeFocusTrace.setActiveTerminalSetFocusInput",
        details: [
          "activeSessionIdsBefore": Array(activeSessionIds).sorted(),
          "commandFocusedSessionId": nullableString(command.focusedSessionId),
          "focusRequestId": command.focusRequestId ?? 0,
          "previousFocusedSessionId": nullableString(previousFocusedSessionId),
          "responderBefore": responderSnapshot(),
          "responderSessionIdBefore": nullableString(responderSessionIdBefore),
          "shouldRelayout": shouldRelayout,
        ])
    }
    activeSessionIds = nextActiveSessionIds
    attentionSessionIds = Set(command.attentionSessionIds ?? [])
    poppedOutSessionIds = nextPoppedOutSessionIds
    sleepingSessionIds = Set(command.sleepingSessionIds ?? [])
    sessionAgentIconColors = command.sessionAgentIconColors ?? [:]
    sessionAgentIconDataUrls = command.sessionAgentIconDataUrls ?? [:]
    sessionActivities = command.sessionActivities ?? [:]
    sessionFaviconDataUrls = command.sessionFaviconDataUrls ?? [:]
    sessionTitleBarActions = command.sessionTitleBarActions ?? [:]
    sessionTitles = command.sessionTitles ?? [:]
    activeProjectEditorId = nextActiveProjectEditorId
    syncPaneHeaderEventMonitorForCurrentSurface(reason: "setActiveTerminalSet")
    focusedSessionId = command.focusedSessionId
    terminalLayout = nextLayout
    paneGap = nextPaneGap
    /**
     CDXC:WorkspaceLayout 2026-04-28-06:08
     The terminal workspace background is user-configurable from Settings.
     Apply the chosen color directly to the AppKit backing layer so the
     visible space created by Pane Gap uses the user's color.
    */
    applyWorkspaceBackgroundColor(command.backgroundColor)
    let isProjectEditorActive = activeProjectEditorId != nil
    for session in sessions.values {
      if let title = sessionTitles[session.sessionId] {
        session.titleBarView.setTitle(
          normalizedTerminalSessionTitle(title, sessionId: session.sessionId)
        )
      }
      if let actions = sessionTitleBarActions[session.sessionId] {
        session.titleBarView.setActions(actions)
      }
      session.titleBarView.setAgentIconDataUrl(
        sessionAgentIconDataUrls[session.sessionId],
        colorHex: sessionAgentIconColors[session.sessionId])
      if shouldRelayout {
        let isPoppedOut = poppedOutSessionIds.contains(session.sessionId)
        let isActive = !isProjectEditorActive && activeSessionIds.contains(session.sessionId)
        session.containerView.isHidden = !isActive || isPoppedOut
        session.scrollView.isHidden = false
        session.searchBarView.isHidden = !isActive || session.view.searchState == nil
        session.titleBarView.isHidden = !isActive && !isPoppedOut
        session.borderView.isHidden = !isActive
        if !isActive && !isPoppedOut {
          moveOffscreen(session.containerView)
        }
      }
    }
    for session in webPaneSessions.values {
      if let title = sessionTitles[session.sessionId] {
        session.titleBarView.setTitle(
          normalizedTerminalSessionTitle(title, sessionId: session.sessionId)
        )
      }
      if let actions = sessionTitleBarActions[session.sessionId] {
        session.titleBarView.setActions(actions)
      }
      session.titleBarView.setAgentIconDataUrl(
        sessionAgentIconDataUrls[session.sessionId],
        colorHex: sessionAgentIconColors[session.sessionId])
      if shouldRelayout {
        let isPoppedOut = poppedOutSessionIds.contains(session.sessionId)
        let isActive = !isProjectEditorActive && activeSessionIds.contains(session.sessionId)
        session.containerView.isHidden = !isActive || isPoppedOut
        session.hostView.isHidden = !isActive && !isPoppedOut
        session.titleBarView.isHidden = !isActive && !isPoppedOut
        session.borderView.isHidden = !isActive
        if !isActive && !isPoppedOut {
          moveOffscreen(session.containerView)
        }
      }
    }
    syncPoppedOutPaneWindows(reason: "setActiveTerminalSet")
    if shouldRelayout {
      for session in projectEditorPaneSessions.values {
        let isActive = activeProjectEditorId == session.projectId
        session.hostView.isHidden = !isActive
        if isActive {
          layoutProjectEditorPane(session)
          orderProjectEditorPaneToFront(session)
        } else {
          moveOffscreen(session.hostView)
        }
      }
      needsLayout = true
      layoutSubtreeIfNeeded()
      scheduleDeferredWebPaneLayout(sessionId: command.focusedSessionId, reason: "setActiveTerminalSet")
    }
    updateAllTerminalBorders()
    let responderSessionIdAfterBorderApply = currentResponderSessionId()
    let focusedSurfaceSessionIdsAfterActiveSet = focusedSurfaceSessionIds()
    if command.focusRequestId == nil,
      let responderSessionIdAfterBorderApply,
      activeSessionIds.contains(responderSessionIdAfterBorderApply),
      responderSessionIdAfterBorderApply != focusedSessionId
    {
      TerminalFocusDebugLog.append(
        event: "nativeFocusTrace.passiveSyncResponderMismatch",
        details: [
          "commandFocusedSessionId": nullableString(command.focusedSessionId),
          "focusedSessionIdAfterApply": nullableString(focusedSessionId),
          "responderAfterBorderApply": responderSnapshot(),
          "responderSessionIdAfterBorderApply": responderSessionIdAfterBorderApply,
          "visibleSessionIds": orderedVisibleSessionIds(),
        ])
    }
    if command.focusRequestId != nil
      || shouldRelayout
      || previousFocusedSessionId != command.focusedSessionId
      || focusedSurfaceSessionIdsAfterActiveSet.count > 1
      || (responderSessionIdAfterBorderApply != nil
        && responderSessionIdAfterBorderApply != focusedSessionId)
    {
      logFocusSurfaceState(
        event: "nativeFocusTrace.setActiveTerminalSetSurfaceState",
        reason: "setActiveTerminalSet.afterBorderApply",
        details: [
          "commandFocusedSessionId": nullableString(command.focusedSessionId),
          "focusRequestId": command.focusRequestId ?? 0,
          "focusedSurfaceSessionIdsAfterActiveSet": focusedSurfaceSessionIdsAfterActiveSet,
          "layoutChanged": shouldRelayout,
          "previousFocusedSessionId": nullableString(previousFocusedSessionId),
          "responderSessionIdAfterBorderApply": nullableString(responderSessionIdAfterBorderApply),
        ])
    }
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.setActiveTerminalSet.applied",
      details: [
        "activeProjectEditorId": nullableString(activeProjectEditorId),
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "attentionSessionIds": Array(attentionSessionIds).sorted(),
        "backgroundColor": command.backgroundColor ?? "default",
        "focusRequestId": command.focusRequestId ?? 0,
        "focusedSessionId": nullableString(command.focusedSessionId),
        "layoutChanged": shouldRelayout,
        "paneGap": Double(paneGap),
        "poppedOutSessionIds": Array(poppedOutSessionIds).sorted(),
        "responderAfterLayout": responderSnapshot(),
        "responderBefore": responderBefore,
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
    guard let focusRequestId = command.focusRequestId else {
      /**
       CDXC:NativeTerminalFocus 2026-05-04-16:02
       Passive status/layout sync can mark a side pane done/green while the
       user is typing in another terminal. Do not translate focusedSessionId
       into AppKit first-responder focus unless native-sidebar attached a fresh
       explicit focus request id.
       */
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.setActiveTerminalSet.focusSkipped",
        details: [
          "focusedSessionId": nullableString(command.focusedSessionId),
          "reason": "missingFocusRequestId",
          "responder": responderSnapshot(),
        ])
      return
    }
    guard lastAppliedLayoutFocusRequestId != focusRequestId else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.setActiveTerminalSet.focusSkipped",
        details: [
          "focusRequestId": focusRequestId,
          "focusedSessionId": nullableString(command.focusedSessionId),
          "reason": "duplicateFocusRequestId",
        ])
      return
    }
    lastAppliedLayoutFocusRequestId = focusRequestId
    if let focusedSessionId = command.focusedSessionId,
      activeSessionIds.contains(focusedSessionId)
    {
      if shouldPreserveNonTerminalFirstResponder() {
        /**
         CDXC:ScratchPadFocus 2026-04-28-05:35
         Layout focus requests must not steal typing focus from the full-window
         modal host or other WKWebView controls. Explicit terminal focus should
         still preserve non-terminal first responders when a modal owns input.
         */
        TerminalFocusDebugLog.append(
          event: "nativeWorkspace.setActiveTerminalSet.focusPreserved",
          details: [
            "focusedSessionId": focusedSessionId,
            "responder": responderSnapshot(),
          ])
        return
      }
      if sessions[focusedSessionId] != nil {
        focusTerminal(sessionId: focusedSessionId, reason: "setActiveTerminalSet")
      } else if webPaneSessions[focusedSessionId] != nil {
        focusWebPane(sessionId: focusedSessionId, reason: "setActiveTerminalSet")
      }
    } else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.setActiveTerminalSet.focusSkipped",
        details: [
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "focusRequestId": focusRequestId,
          "focusedSessionId": nullableString(command.focusedSessionId),
          "reason": "focusedSessionNotActive",
        ])
    }
  }

  func setSidebarSide(_ side: SidebarSide) {
    /**
     CDXC:NativePaneChrome 2026-05-07-15:13
     The workspace's outer rounded active/done border corner follows sidebar
     placement: left-sidebar layouts round the bottom-right workspace pane,
     while right-sidebar layouts round the bottom-left workspace pane.
     */
    guard sidebarSide != side else {
      return
    }
    sidebarSide = side
    updateOuterBottomPaneBorderCorner()
  }

  override func layout() {
    super.layout()
    defer {
      layoutFloatingEditorOverlay()
    }
    paneResizeHits.removeAll()
    if let activeProjectEditorId,
      let editorSession = projectEditorPaneSessions[activeProjectEditorId]
    {
      /**
       CDXC:EditorPanes 2026-05-08-13:02
       Sidebar resize changes the workspace bounds while VS Code owns the
       visible pane. Log the active editor layout branch before touching hosted
       Chromium so crash reports can be matched to the last AppKit frame.
       */
      NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.layout.active", [
        "activeProjectEditorId": activeProjectEditorId,
        "hostFrameBefore": describeFrame(editorSession.hostView.frame),
        "workspaceBounds": describeFrame(bounds),
        "windowNumber": window?.windowNumber ?? NSNull(),
      ])
      hideSplitSessionSurfacesForActiveEditor()
      editorSession.hostView.isHidden = false
      layoutProjectEditorPane(editorSession)
      orderProjectEditorPaneToFront(editorSession)
      return
    }
    let visibleSessionIds = orderedVisibleSessionIds()
    guard !visibleSessionIds.isEmpty else {
      setHoveredPaneSessionId(nil)
      hidePaneResizeHandleViews()
      discardCursorRects()
      return
    }
    if let terminalLayout {
      layoutTree(terminalLayout, in: layoutBounds(forVisibleCount: visibleSessionIds.count), path: "root")
    } else {
      layoutGrid(visibleSessionIds, in: layoutBounds(forVisibleCount: visibleSessionIds.count))
    }
    updateHoveredPaneFromCurrentMouseLocation()
    updateOuterBottomPaneBorderCorner()
    syncPaneResizeHandleViews()
    window?.invalidateCursorRects(for: self)
  }

  private func hidePaneResizeHandleViews() {
    for handleView in paneResizeHandleViews {
      handleView.resetInteractionState()
      handleView.isHidden = true
      handleView.frame = .zero
    }
  }

  private func syncPaneResizeHandleViews() {
    /**
     CDXC:NativePaneResize 2026-05-04-08:21
     The transparent splitter must own hover cursor feedback from a native
     AppKit handle view, while leaving the existing layout math and drag
     behavior in TerminalWorkspaceView.
     CDXC:NativePaneResize 2026-05-04-08:27
     The resize target must be large enough to acquire intentionally while still
     staying transparent and layout-neutral.
     CDXC:NativePaneResize 2026-05-04-08:41
     AppKit layout must not remove and re-add resize handle views, so layout
     only resizes persistent handles, hides unused ones, and reorders visible
     handles only when another pane view has moved above them.
     CDXC:NativePaneResize 2026-05-11-07:56
     Splitter handles are the topmost AppKit hit-test owner and use a 15px
     minimum transparent target, so hover can settle on the resize cursor
     instead of being overwritten by pane title bars or terminal surfaces.
     CDXC:NativePaneResize 2026-05-11-08:41
     Cursor and drag must share one owner. Bind each handle's mouse-down to the
     exact split hit it represents instead of re-hit-testing the workspace point
     after the cursor has already advertised resize.
     CDXC:NativePaneResize 2026-05-11-09:45
     Rails are interaction chrome, not visual dividers. Keep the rail view
     transparent while preserving its hit target on the visible split line.
     CDXC:NativePaneResize 2026-05-11-09:48
     Split boundaries should be real native rails on every side produced by the
     split tree. The transparent rail owns the visible split-line grab target
     and stays above pane chrome so decorative views cannot obscure drag.
     CDXC:NativePaneResize 2026-05-11-10:40
     Match Muxy's divider behavior in AppKit: every split boundary gets one
     real rail view, and that rail alone owns cursor, mouseDown, mouseDragged,
     and mouseUp for resizing.
     CDXC:NativePaneResize 2026-05-11-14:17
     Resize rails are event chrome, not visual chrome. Keep them fully
     transparent after diagnostics so the wider visible split line comes only
     from pane layout gap, while this native rail still owns hover and drag.
     */
    while paneResizeHandleViews.count < paneResizeHits.count {
      let handleView = TerminalWorkspacePaneResizeHandleView()
      handleView.onMouseDragged = { [weak self] event in
        _ = self?.continuePaneResize(with: event)
      }
      handleView.onMouseUp = { [weak self] event in
        _ = self?.endPaneResize(with: event)
      }
      paneResizeHandleViews.append(handleView)
    }

    for (index, handleView) in paneResizeHandleViews.enumerated() {
      guard index < paneResizeHits.count else {
        handleView.resetInteractionState()
        handleView.isHidden = true
        handleView.frame = .zero
        continue
      }
      let hit = paneResizeHits[index]
      handleView.configure(
        direction: hit.direction,
        cursor: paneResizeCursor(for: hit.direction)
      )
      handleView.onMouseDown = { [weak self, hit] event in
        _ = self?.beginPaneResize(hit: hit, event: event)
      }
      handleView.frame = hit.rect
      handleView.isHidden = false
      handleView.layer?.zPosition = 210
      handleView.layer?.backgroundColor = NSColor.clear.cgColor
      if handleView.superview == nil {
        addSubview(handleView)
      }
      window?.invalidateCursorRects(for: handleView)
    }
    orderPaneResizeHandleViewsToFrontIfNeeded()
  }

  private func bringPaneResizeHandleViewsToFront() {
    orderPaneResizeHandleViewsToFrontIfNeeded()
    for handleView in paneResizeHandleViews where handleView.superview === self {
      handleView.layer?.zPosition = 210
      window?.invalidateCursorRects(for: handleView)
    }
  }

  private func orderPaneResizeHandleViewsToFrontIfNeeded() {
    let visibleHandles = paneResizeHandleViews.filter { $0.superview === self && !$0.isHidden }
    guard !visibleHandles.isEmpty else {
      return
    }
    let topSubviews = Array(subviews.suffix(visibleHandles.count))
    let handlesAreTopmost = topSubviews.count == visibleHandles.count
      && zip(topSubviews, visibleHandles).allSatisfy { $0 === $1 }
    guard !handlesAreTopmost else {
      return
    }
    for handleView in visibleHandles {
      handleView.removeFromSuperview()
    }
    for handleView in visibleHandles {
      addSubview(handleView, positioned: .above, relativeTo: nil)
    }
  }

  private func mountTerminalPaneContainer(for session: TerminalSession) {
    /**
     CDXC:NativePaneResize 2026-05-11-13:38
     Muxy's resize reliability comes from a child/divider/child layout tree,
     not from overlay rails fighting terminal content. Mount each terminal pane
     as one AppKit leaf container so Ghostty, search, title chrome, and borders
     move as a unit while split dividers remain separate sibling views.
     */
    if session.containerView.superview !== self {
      session.containerView.removeFromSuperview()
      addSubview(session.containerView)
    }
    mount(session.titleBarView, in: session.containerView)
    mount(session.scrollView, in: session.containerView)
    mount(session.searchBarView, in: session.containerView)
    mount(session.borderView, in: session.containerView)
  }

  private func mountWebPaneContainer(for session: WebPaneSession) {
    /**
     CDXC:NativePaneResize 2026-05-11-13:38
     Web panes follow the same Muxy-style leaf container model as Ghostty
     panes. The split divider is a sibling of the pane container, so WKWebView
     or CEF cannot own mouse events that belong to the divider gap.
     */
    if session.containerView.superview !== self {
      session.containerView.removeFromSuperview()
      addSubview(session.containerView)
    }
    mount(session.titleBarView, in: session.containerView)
    mount(session.hostView, in: session.containerView)
    mount(session.borderView, in: session.containerView)
  }

  private func mount(_ view: NSView, in containerView: TerminalPaneLeafContainerView) {
    guard view.superview !== containerView else {
      return
    }
    view.removeFromSuperview()
    containerView.addSubview(view)
  }

  private func updateOuterBottomPaneBorderCorner() {
    /**
     CDXC:NativePaneChrome 2026-05-07-15:13
     The pane touching the workspace's visible outside bottom corner should
     preserve a rounded active/done border corner in native AppKit layout.
     Apply this after split/grid frames are assigned so the rule follows pane
     reorders, split resizing, web panes, terminal panes, and sidebar side.
     */
    var visibleBorders: [(sessionId: String, borderView: TerminalPaneBorderView)] = []
    for (sessionId, session) in sessions where activeSessionIds.contains(sessionId) {
      visibleBorders.append((sessionId: sessionId, borderView: session.borderView))
    }
    for (sessionId, session) in webPaneSessions where activeSessionIds.contains(sessionId) {
      visibleBorders.append((sessionId: sessionId, borderView: session.borderView))
    }

    let roundedSessionId = visibleBorders.max { left, right in
      let leftFrame = left.borderView.convert(left.borderView.bounds, to: self)
      let rightFrame = right.borderView.convert(right.borderView.bounds, to: self)
      let leftOuterX = sidebarSide == .left ? leftFrame.maxX : -leftFrame.minX
      let rightOuterX = sidebarSide == .left ? rightFrame.maxX : -rightFrame.minX
      if abs(leftOuterX - rightOuterX) > 0.5 {
        return leftOuterX < rightOuterX
      }
      if abs(leftFrame.minY - rightFrame.minY) > 0.5 {
        return leftFrame.minY > rightFrame.minY
      }
      return left.sessionId < right.sessionId
    }?.sessionId

    let roundedCorner: TerminalPaneRoundedBottomCorner = sidebarSide == .left ? .right : .left
    for (sessionId, borderView) in visibleBorders {
      borderView.setRoundedBottomCorner(sessionId == roundedSessionId ? roundedCorner : .none)
    }
  }

  private func layoutBounds(forVisibleCount visibleCount: Int) -> CGRect {
    let inset = visibleCount <= 1 ? Self.singlePaneInset : paneGap
    return bounds.insetBy(dx: inset, dy: inset)
  }

  private func layoutProjectEditorPane(_ session: ProjectEditorPaneSession) {
    NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.layout.start", [
      "hostFrameBefore": describeFrame(session.hostView.frame),
      "projectId": session.projectId,
      "url": session.url,
      "workspaceBounds": describeFrame(bounds),
      "windowNumber": window?.windowNumber ?? NSNull(),
    ])
    let nextFrame = bounds
    /**
     CDXC:EditorPanes 2026-05-08-13:37
     Sidebar resize must not synchronously refresh or display the hosted VS
     Code CEF view from inside TerminalWorkspaceView.layout(). Resizing only
     moves the host frame; WebPaneHostView.layout owns the child Chromium frame
     on the normal AppKit pass. Do not mark the host as needing layout from
     this layout method, because that self-invalidates and can loop when the
     project editor is the active workspace surface.
     */
    if !rectsMatch(session.hostView.frame, nextFrame) {
      session.hostView.frame = nextFrame
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.layout.end", [
      "hostFrameAfter": describeFrame(session.hostView.frame),
      "projectId": session.projectId,
      "url": session.url,
      "workspaceBounds": describeFrame(bounds),
      "windowNumber": window?.windowNumber ?? NSNull(),
    ])
  }

  private func rectsMatch(_ left: CGRect, _ right: CGRect) -> Bool {
    let epsilon: CGFloat = 0.5
    return abs(left.minX - right.minX) <= epsilon
      && abs(left.minY - right.minY) <= epsilon
      && abs(left.width - right.width) <= epsilon
      && abs(left.height - right.height) <= epsilon
  }

  private func orderProjectEditorPaneToFront(_ session: ProjectEditorPaneSession) {
    if session.hostView.superview !== self {
      addSubview(session.hostView)
      return
    }
    guard subviews.last !== session.hostView else {
      return
    }
    /**
     CDXC:EditorPanes 2026-05-08-13:37
     Reordering the active VS Code host by remove/add invalidates AppKit
     layout. Only move it when another workspace surface is actually above it;
     doing this on every layout pass creates a self-sustaining layout loop.
     */
    session.hostView.removeFromSuperview()
    addSubview(session.hostView, positioned: .above, relativeTo: nil)
  }

  private func hideSplitSessionSurfacesForActiveEditor() {
    paneResizeDrag = nil
    setHoveredPaneSessionId(nil)
    resetPaneHeaderInteractionState()
    for session in sessions.values {
      moveOffscreen(session.containerView)
    }
    for session in webPaneSessions.values {
      moveOffscreen(session.containerView)
    }
    hidePaneResizeHandleViews()
    discardCursorRects()
  }

  private func loadProjectEditorPaneWhenReady(projectId: String, url: String, reason: String) {
    /**
     CDXC:EditorPanes 2026-05-09-17:24
     Report editor startup state to the sidebar. The sidebar keeps the VS Code
     row visible through loading and turns it into a retryable error row if
     code-server does not become responsive within ten seconds.
     */
    sendEvent(.projectEditorLoadState(projectId: projectId, status: "opening", message: nil))
    Task.detached { [weak self] in
      let isReady = NativeCodeServerRuntimeLauncher.waitUntilResponsive(timeout: 10.0)
      await MainActor.run {
        guard let self, let session = self.projectEditorPaneSessions[projectId], session.url == url
        else {
          return
        }
        NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.load", [
          "isRuntimeReady": isReady,
          "projectId": projectId,
          "reason": reason,
          "url": url,
        ])
        if !isReady {
          self.sendEvent(
            .projectEditorLoadState(
              projectId: projectId,
              status: "error",
              message: "VS Code did not finish loading within 10 seconds."))
        }
        session.chromiumView.loadURLString(url)
        session.hostView.refreshHostedWebView(reason: reason)
      }
    }
  }

  private func configureProjectEditorChromiumCallbacks(
    _ chromiumView: ZmuxCEFBrowserView,
    projectId: String,
    reason: String
  ) {
    chromiumView.navigationStateChangedHandler = { [weak self, weak chromiumView] _, _, isLoading in
      guard let self, let chromiumView else {
        return
      }
      self.updateProjectEditorInitialLoadingOverlay(
        projectId: projectId,
        chromiumView: chromiumView,
        isLoading: isLoading,
        reason: "chromiumNavigationStateChanged")
    }
    /**
     CDXC:EditorPanes 2026-05-07-05:18
     VS Code view movement depends on browser drag/drop retargeting for live
     sidebar drop indicators and hold-before-release interactions. CEF Alloy
     panes receive native mouse movement but can miss in-page `dragover`
     retargeting, so zmux keeps code-server free of load-time injected drag
     diagnostics and uses a scoped active-drag hover bridge only while dragging.

     CDXC:EditorPanes 2026-05-07-08:29
     First editor startup should show a native loading spinner immediately while
     the existing code-server readiness wait continues in parallel. The loader is
     dismissed from CEF navigation state after the real editor URL finishes, so
     it never adds startup delay or waits on a separate timer.
     */
    NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.chromiumCallbacksConfigured", [
      "projectId": projectId,
      "reason": reason,
      "url": chromiumView.currentURLString ?? NSNull(),
    ])
  }

  private func updateProjectEditorInitialLoadingOverlay(
    projectId: String,
    chromiumView: ZmuxCEFBrowserView,
    isLoading: Bool,
    reason: String
  ) {
    guard let session = projectEditorPaneSessions[projectId],
      session.chromiumView === chromiumView,
      !isLoading
    else {
      return
    }
    let currentURL = chromiumView.currentURLString?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !currentURL.isEmpty, currentURL != "about:blank" else {
      return
    }
    session.hostView.setInitialLoadingOverlayVisible(false, reason: reason)
    sendEvent(.projectEditorLoadState(projectId: projectId, status: "running", message: nil))
  }

  private func orderedVisibleSessionIds() -> [String] {
    let fromLayout =
      terminalLayout.map(leafSessionIds) ?? Array(sessions.keys) + Array(webPaneSessions.keys)
    return fromLayout.filter { activeSessionIds.contains($0) }
  }

  private func layoutTree(_ node: NativeTerminalLayout, in rect: CGRect, path: String) {
    switch node {
    case .leaf(let sessionId):
      setPaneTabs([sessionId], activeSessionId: sessionId, on: sessionId)
      setFrame(rect, for: sessionId)
    case .tabs(let activeSessionId, let sessionIds):
      let tabSessionIds = sessionIds.filter { activeSessionIds.contains($0) || sleepingSessionIds.contains($0) }
      let activeTabSessionIds = tabSessionIds.filter { activeSessionIds.contains($0) }
      guard !activeTabSessionIds.isEmpty else { return }
      let selectedSessionId =
        activeSessionId.flatMap { activeTabSessionIds.contains($0) ? $0 : nil } ?? activeTabSessionIds[0]
      for sessionId in activeTabSessionIds where sessionId != selectedSessionId {
        movePaneSessionOffscreen(sessionId)
      }
      setPaneTabs(tabSessionIds, activeSessionId: selectedSessionId, on: selectedSessionId)
      setFrame(rect, for: selectedSessionId)
    case .split(let direction, let ratio, let children):
      let visibleChildren = children.filter {
        !leafSessionIds($0).allSatisfy { !activeSessionIds.contains($0) }
      }
      guard !visibleChildren.isEmpty else { return }
      if visibleChildren.count == 1 {
        layoutTree(visibleChildren[0], in: rect, path: "\(path).0")
        return
      }
      /**
       CDXC:WorkspaceLayout 2026-04-28-06:01
       Native split panes must use the same Pane Gap setting as the sidebar
       control. Apply the gap as real AppKit layout space between split
       siblings instead of hardcoded 1px child insets.
       */
      let gap = splitGap(forChildCount: visibleChildren.count)
      let defaultRatios = defaultPaneResizeRatios(
        childCount: visibleChildren.count,
        firstRatio: ratio.map { CGFloat($0) })
      let ratios = normalizedPaneResizeRatios(for: path, defaultRatios: defaultRatios)
      var nextOrigin = direction == .horizontal ? rect.minX : rect.maxY
      let availableLength = max(
        (direction == .horizontal ? rect.width : rect.height)
          - gap * CGFloat(max(visibleChildren.count - 1, 0)),
        CGFloat(visibleChildren.count)
      )
      let ratioTotal = max(ratios.reduce(0, +), 1)
      var childRects: [CGRect] = []
      for (index, child) in visibleChildren.enumerated() {
        let isLast = index == visibleChildren.count - 1
        let childLength: CGFloat
        if isLast {
          childLength =
            direction == .horizontal
            ? max(rect.maxX - nextOrigin, 1)
            : max(nextOrigin - rect.minY, 1)
        } else {
          childLength = max(floor(availableLength * (ratios[index] / ratioTotal)), 1)
        }
        let childRect: CGRect
        if direction == .horizontal {
          childRect = CGRect(
            x: nextOrigin, y: rect.minY, width: childLength, height: rect.height)
          nextOrigin += childLength + gap
        } else {
          childRect = CGRect(
            x: rect.minX, y: nextOrigin - childLength, width: rect.width, height: childLength)
          nextOrigin -= childLength + gap
        }
        childRects.append(childRect)
        layoutTree(child, in: childRect, path: "\(path).\(index)")
      }
      recordPaneResizeHits(
        childRects: childRects,
        direction: direction,
        path: path,
        rect: rect
      )
      if paneResizeRatiosByPath[path]?.count != visibleChildren.count {
        paneResizeRatiosByPath[path] = ratios
      }
    }
  }

  private func layoutGrid(_ sessionIds: [String], in rect: CGRect) {
    let columns = Int(ceil(sqrt(Double(sessionIds.count))))
    let rows = Int(ceil(Double(sessionIds.count) / Double(columns)))
    let gap = splitGap(forChildCount: sessionIds.count)
    let cellWidth = max((rect.width - gap * CGFloat(max(columns - 1, 0))) / CGFloat(columns), 1)
    let cellHeight = max((rect.height - gap * CGFloat(max(rows - 1, 0))) / CGFloat(rows), 1)
    for (index, sessionId) in sessionIds.enumerated() {
      let column = index % columns
      let row = index / columns
      let cell = CGRect(
        x: rect.minX + CGFloat(column) * (cellWidth + gap),
        y: rect.maxY - CGFloat(row + 1) * cellHeight - CGFloat(row) * gap,
        width: cellWidth,
        height: cellHeight
      )
      setPaneTabs([sessionId], activeSessionId: sessionId, on: sessionId)
      setFrame(cell, for: sessionId)
    }
  }

  private func splitGap(forChildCount childCount: Int) -> CGFloat {
    childCount <= 1 ? 0 : max(paneGap, Self.paneResizeMinimumVisibleGap)
  }

  /**
   CDXC:NativePaneResize 2026-05-02-16:44
   Native Ghostty and WKWebView panes sit above the React workspace DOM, so
   split resizing must be owned by AppKit. The workspace view records cursor
   and mouse bands around split boundaries, clamps panes to terminal-usable
   dimensions, and double-click equalizes split groups.
   */
  private func defaultPaneResizeRatios(childCount: Int, firstRatio: CGFloat?) -> [CGFloat] {
    guard childCount > 0 else { return [] }
    guard childCount > 1, let firstRatio else {
      return Array(repeating: 1, count: childCount)
    }
    let first = min(max(firstRatio, 0.05), 0.95)
    let remaining = max(1 - first, 0.05)
    let trailing = remaining / CGFloat(childCount - 1)
    return [first] + Array(repeating: trailing, count: childCount - 1)
  }

  private func normalizedPaneResizeRatios(for path: String, defaultRatios: [CGFloat]) -> [CGFloat] {
    guard let current = paneResizeRatiosByPath[path], current.count == defaultRatios.count,
      current.allSatisfy({ $0 > 0 })
    else {
      return defaultRatios
    }
    return current
  }

  private func recordPaneResizeHits(
    childRects: [CGRect],
    direction: NativeTerminalLayout.SplitDirection,
    path: String,
    rect: CGRect
  ) {
    guard childRects.count > 1 else { return }
    let visualGap = splitGap(forChildCount: childRects.count)
    let hitSize = max(visualGap, Self.paneResizeMinimumHitSize)
    for boundaryIndex in 1..<childRects.count {
      let previous = childRects[boundaryIndex - 1]
      let next = childRects[boundaryIndex]
      guard isInteriorPaneResizeBoundary(
        previous: previous,
        next: next,
        direction: direction,
        container: rect
      ) else {
        continue
      }
      let hitRect: CGRect
      switch direction {
      case .horizontal:
        let centerX = (previous.maxX + next.minX) / 2
        hitRect = CGRect(
          x: centerX - hitSize / 2,
          y: max(previous.minY, next.minY),
          width: hitSize,
          height: min(previous.maxY, next.maxY) - max(previous.minY, next.minY)
        )
      case .vertical:
        let centerY = (previous.minY + next.maxY) / 2
        hitRect = CGRect(
          x: rect.minX,
          y: centerY - hitSize / 2,
          width: rect.width,
          height: hitSize
        )
      }
      if let hitRect = paneResizeHitRectExcludingOuterEdges(
        hitRect,
        direction: direction,
        container: rect
      ) {
        paneResizeHits.append(
          PaneResizeHit(
            availableLength: max(
              (direction == .horizontal ? rect.width : rect.height)
                - visualGap * CGFloat(max(childRects.count - 1, 0)),
              CGFloat(childRects.count)
            ),
            boundaryIndex: boundaryIndex,
            direction: direction,
            path: path,
            rect: hitRect,
            trackCount: childRects.count
          ))
      }
    }
  }

  private func isInteriorPaneResizeBoundary(
    previous: CGRect,
    next: CGRect,
    direction: NativeTerminalLayout.SplitDirection,
    container: CGRect
  ) -> Bool {
    /**
     CDXC:NativePaneResize 2026-05-08-12:38
     Terminal resize handles are only valid where two visible pane siblings
     share an interior boundary. Do not create edge handles along the workspace
     perimeter; the sidebar/workspace boundary is owned by zmuxRootView's
     sidebar resize handle and must not compete with terminal pane hit zones.
     */
    let epsilon: CGFloat = 0.5
    switch direction {
    case .horizontal:
      let boundaryCenter = (previous.maxX + next.minX) / 2
      let overlapHeight = min(previous.maxY, next.maxY) - max(previous.minY, next.minY)
      return boundaryCenter > container.minX + epsilon
        && boundaryCenter < container.maxX - epsilon
        && overlapHeight > epsilon
    case .vertical:
      let boundaryCenter = (previous.minY + next.maxY) / 2
      let overlapWidth = min(previous.maxX, next.maxX) - max(previous.minX, next.minX)
      return boundaryCenter > container.minY + epsilon
        && boundaryCenter < container.maxY - epsilon
        && overlapWidth > epsilon
    }
  }

  private func paneResizeHitRectExcludingOuterEdges(
    _ hitRect: CGRect,
    direction: NativeTerminalLayout.SplitDirection,
    container: CGRect
  ) -> CGRect? {
    /**
     CDXC:NativePaneResize 2026-05-08-12:38
     Interior split handles should not expose draggable caps on pane sides that
     touch no sibling pane. Trim those caps so a terminal split handle cannot
     sit immediately beside the sidebar resize handle at the workspace edge.
     */
    let edgeInset = min(Self.paneResizeOuterEdgeExclusion, max(0, paneGap))
    let trimmed: CGRect
    switch direction {
    case .horizontal:
      trimmed = hitRect.insetBy(dx: 0, dy: edgeInset)
    case .vertical:
      trimmed = hitRect.insetBy(dx: edgeInset, dy: 0)
    }
    let clamped = trimmed.intersection(container)
    guard clamped.width > 0, clamped.height > 0 else {
      return nil
    }
    return clamped
  }

  private func paneResizeCursor(at point: CGPoint) -> NSCursor? {
    guard let hit = paneResizeHit(at: point) else {
      return nil
    }
    return paneResizeCursor(for: hit.direction)
  }

  private func paneResizeCursor(for direction: NativeTerminalLayout.SplitDirection) -> NSCursor {
    direction == .horizontal ? .resizeLeftRight : .resizeUpDown
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  /**
   CDXC:NativePaneReorder 2026-05-06-03:04
   Pane drag-to-reorder must still start from the native title bar only, but
   embedded terminal/WebKit surfaces can sit above the title-bar mouse stream
   during AppKit hit testing. Route only exact title-bar hits to the title-bar
   view before falling back to normal pane hit testing; resize handles keep
   priority so split resizing is not converted into pane dragging.

   CDXC:NativePaneReorder 2026-05-10-14:24
   Repro logs showed a bottom-edge terminal selection hit resolving to a
   TerminalSessionTitleBarView while the registered title-bar frame was at the
   pane top. Treat any title-bar hit outside the current registered draggable
   title-bar band as invalid and reroute it to the pane content so the last
   terminal line remains selectable and cannot start pane reordering.

   CDXC:NativePaneResize 2026-05-11-09:39
   Native splitter rails must win hit testing before title bars, terminal
   surfaces, and focused borders. If the rail shows the resize cursor, that same
   rail must receive mouseDown and mouseDragged for the split.
   */
  override func hitTest(_ point: NSPoint) -> NSView? {
    if let floatingEditorHitView = floatingEditorHitView(at: point) {
      return floatingEditorHitView
    }
    guard !isProjectEditorInteractionSurfaceActive else {
      return super.hitTest(point)
    }
    if let resizeHandleHitView = paneResizeHandleHitView(at: point) {
      return resizeHandleHitView
    }
    if let titleBarHitView = paneTitleBarHitView(at: point) {
      if isPaneBottomEdgeProbePoint(point) {
        logPaneReorderProbe(
          event: "nativePaneReorder.hitTest.titleBarNearBottom",
          at: point,
          details: [
            "returnedHitView": String(describing: type(of: titleBarHitView)),
          ])
      }
      return titleBarHitView
    }
    let hitView = super.hitTest(point)
    if paneTitleBarAncestor(of: hitView) != nil {
      logPaneReorderProbe(
        event: "nativePaneReorder.hitTest.invalidTitleBarRerouted",
        at: point,
        details: [
          "originalHitView": hitView.map { String(describing: type(of: $0)) } ?? "nil",
        ])
      return paneContentHitView(at: point)
    }
    return hitView
  }

  private func paneResizeHandleHitView(at point: CGPoint) -> NSView? {
    for handleView in paneResizeHandleViews.reversed()
      where handleView.superview === self && !handleView.isHidden && handleView.frame.contains(point)
    {
      let handlePoint = convert(point, to: handleView)
      if let hitView = handleView.hitTest(handlePoint) {
        return hitView
      }
    }
    return nil
  }

  private func floatingEditorHitView(at point: NSPoint) -> NSView? {
    guard
      let overlayView = floatingEditorOverlayView,
      !overlayView.isHidden,
      overlayView.alphaValue > 0,
      overlayView.frame.contains(point)
    else {
      return nil
    }
    return overlayView.hitTest(overlayView.convert(point, from: self))
  }

  private func paneTitleBarHitView(at point: CGPoint) -> NSView? {
    guard paneResizeHit(at: point) == nil else {
      return nil
    }
    for sessionId in orderedVisibleSessionIds().reversed() {
      if let session = sessions[sessionId],
        let hitView = paneTitleBarHitView(session.titleBarView, at: point)
      {
        return hitView
      }
      if let session = webPaneSessions[sessionId],
        let hitView = paneTitleBarHitView(session.titleBarView, at: point)
      {
        return hitView
      }
    }
    return nil
  }

  private func paneTitleBarHitView(
    _ titleBarView: TerminalSessionTitleBarView,
    at point: CGPoint
  ) -> NSView? {
    let titleBarPoint = convert(point, to: titleBarView)
    guard !titleBarView.isHidden, titleBarView.bounds.contains(titleBarPoint) else {
      return nil
    }
    return titleBarView.hitTest(titleBarPoint)
  }

  private func paneTitleBarAncestor(of view: NSView?) -> TerminalSessionTitleBarView? {
    var currentView = view
    while let view = currentView {
      if let titleBarView = view as? TerminalSessionTitleBarView {
        return titleBarView
      }
      currentView = view.superview
    }
    return nil
  }

  private func paneContentHitView(at point: CGPoint) -> NSView? {
    for sessionId in orderedVisibleSessionIds().reversed() {
      if let session = sessions[sessionId] {
        let contentPoint = convert(point, to: session.scrollView)
        if session.scrollView.bounds.contains(contentPoint) {
          return session.scrollView.hitTest(contentPoint)
        }
      }
      if let session = webPaneSessions[sessionId] {
        let contentPoint = convert(point, to: session.hostView)
        if session.hostView.bounds.contains(contentPoint) {
          return session.hostView.hitTest(contentPoint)
        }
      }
    }
    return nil
  }

  override func mouseDown(with event: NSEvent) {
    guard !isProjectEditorInteractionSurfaceActive else {
      super.mouseDown(with: event)
      return
    }
    guard beginPaneResize(with: event) else {
      super.mouseDown(with: event)
      return
    }
  }

  @discardableResult
  private func beginPaneResize(with event: NSEvent) -> Bool {
    guard !isProjectEditorInteractionSurfaceActive else {
      return false
    }
    let point = convert(event.locationInWindow, from: nil)
    guard let hit = paneResizeHit(at: point) else {
      return false
    }
    return beginPaneResize(hit: hit, event: event)
  }

  @discardableResult
  private func beginPaneResize(hit: PaneResizeHit, event: NSEvent) -> Bool {
    guard !isProjectEditorInteractionSurfaceActive else {
      return false
    }
    let point = convert(event.locationInWindow, from: nil)

    if event.clickCount >= 2 {
      equalizePaneResizeRatios()
      paneResizeCursor(for: hit.direction).set()
      return true
    }

    let currentRatios =
      paneResizeRatiosByPath[hit.path]
      ?? Array(repeating: 1, count: hit.trackCount)
    paneResizeDrag = PaneResizeDrag(
      availableLength: hit.availableLength,
      boundaryIndex: hit.boundaryIndex,
      direction: hit.direction,
      minimumAfter: paneResizeMinimumLength(direction: hit.direction)
        * CGFloat(hit.trackCount - hit.boundaryIndex),
      minimumBefore: paneResizeMinimumLength(direction: hit.direction) * CGFloat(hit.boundaryIndex),
      path: hit.path,
      startCoordinate: hit.direction == .horizontal ? point.x : point.y,
      startRatios: currentRatios
    )
    paneResizeCursor(for: hit.direction).set()
    return true
  }

  override func mouseDragged(with event: NSEvent) {
    guard !isProjectEditorInteractionSurfaceActive else {
      super.mouseDragged(with: event)
      return
    }
    guard continuePaneResize(with: event) else {
      super.mouseDragged(with: event)
      return
    }
  }

  @discardableResult
  private func continuePaneResize(with event: NSEvent) -> Bool {
    guard !isProjectEditorInteractionSurfaceActive else {
      paneResizeDrag = nil
      return false
    }
    guard let drag = paneResizeDrag else {
      return false
    }

    let point = convert(event.locationInWindow, from: nil)
    paneResizeCursor(for: drag.direction).set()
    let coordinate = drag.direction == .horizontal ? point.x : point.y
    let delta = drag.direction == .horizontal
      ? coordinate - drag.startCoordinate
      : drag.startCoordinate - coordinate
    paneResizeRatiosByPath[drag.path] = resizePaneRatios(
      drag.startRatios,
      boundaryIndex: drag.boundaryIndex,
      delta: delta,
      availableLength: drag.availableLength,
      minimumBefore: drag.minimumBefore,
      minimumAfter: drag.minimumAfter)
    needsLayout = true
    layoutSubtreeIfNeeded()
    return true
  }

  override func mouseUp(with event: NSEvent) {
    guard !isProjectEditorInteractionSurfaceActive else {
      super.mouseUp(with: event)
      return
    }
    if endPaneResize(with: event) {
      return
    }
    paneHeaderDrag = nil
    endPaneHeaderDragFeedback()
    super.mouseUp(with: event)
  }

  @discardableResult
  private func endPaneResize(with event: NSEvent) -> Bool {
    guard !isProjectEditorInteractionSurfaceActive else {
      paneResizeDrag = nil
      return false
    }
    guard paneResizeDrag != nil else {
      return false
    }
    paneResizeDrag = nil
    let point = convert(event.locationInWindow, from: nil)
    paneResizeCursor(at: point)?.set()
    return true
  }

  /**
   CDXC:NativePaneReorder 2026-05-03-02:50
   Pane title bars contain AppKit controls, text fields, Ghostty surfaces, and
   WKWebViews that can consume mouse events before TerminalWorkspaceView sees
   them. Title-bar actions are resolved here because native pane layers can keep
   the title-bar view itself from receiving button mouse events.

   CDXC:NativePaneReorder 2026-05-06-01:57
   Pane drag-to-reorder must start only from TerminalSessionTitleBarView's own
   mouse handlers. The window-local monitor must not promote terminal
   body/bottom-edge drags into pane-header drags by broad frame geometry checks.

   CDXC:NativePaneReorder 2026-05-06-02:36
   The window-local monitor may continue and release an existing
   titlebar-started drag, because AppKit can deliver later drag/up events after
   the pointer has left the title-bar view. This keeps drag startup titlebar-only
   while preserving ghost/drop feedback during the drag.
   */
  private func installPaneHeaderEventMonitor() {
    guard paneHeaderEventMonitor == nil else {
      return
    }
    paneHeaderEventMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp, .mouseMoved]
    ) { [weak self] event in
      guard let self, event.window === self.window else {
        return event
      }
      self.handlePaneHeaderMonitorEvent(event)
      return event
    }
  }

  private func uninstallPaneHeaderEventMonitor() {
    guard let paneHeaderEventMonitor else {
      return
    }
    NSEvent.removeMonitor(paneHeaderEventMonitor)
    self.paneHeaderEventMonitor = nil
  }

  private func syncPaneHeaderEventMonitorForCurrentSurface(reason: String) {
    let shouldMonitor = window != nil && !isProjectEditorInteractionSurfaceActive
    let hadMonitor = paneHeaderEventMonitor != nil
    if shouldMonitor {
      installPaneHeaderEventMonitor()
    } else {
      uninstallPaneHeaderEventMonitor()
    }
    let hasMonitor = paneHeaderEventMonitor != nil
    if hadMonitor != hasMonitor {
      NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.dnd.nativeMonitorSync", [
        "activeProjectEditorId": activeProjectEditorId ?? NSNull(),
        "hasPaneHeaderMonitor": hasMonitor,
        "reason": reason,
        "visibleProjectEditorIds": visibleProjectEditorInteractionSessionIds,
        "windowNumber": window?.windowNumber ?? NSNull(),
      ])
    }
  }

  private func handlePaneHeaderMonitorEvent(_ event: NSEvent) {
    guard !isProjectEditorInteractionSurfaceActive else {
      resetPaneHeaderInteractionState()
      NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.dnd.nativeMonitorBypassed", [
        "activeProjectEditorId": activeProjectEditorId ?? NSNull(),
        "eventType": Self.describeMouseEventType(event.type),
        "visibleProjectEditorIds": visibleProjectEditorInteractionSessionIds,
        "windowNumber": window?.windowNumber ?? NSNull(),
      ])
      return
    }
    updateHoveredPane(for: event)
    switch event.type {
    case .mouseMoved:
      return
    case .leftMouseDown:
      let point = convert(event.locationInWindow, from: nil)
      logPaneTabPointerProbe(event: "nativePaneTabs.monitor.mouseDown", at: point, source: "monitor")
      logPaneFocusMouseDownProbe(at: point)
      acknowledgeClickedAttentionPane(at: point)
      if let titleBarAction = paneTitleBarAction(at: point) {
        /**
         CDXC:BrowserPanes 2026-05-03-11:06
         Browser-pane close uses the same AppKit title-bar buttons as T3 panes.
         The window-level header-drag monitor also tracks action presses
         because WKWebView and layer-backed title bars can keep the underlying
         NSButton from receiving a normal click. Recording the action here makes
         close reliable without turning title-bar button clicks into pane drags.
         */
        paneHeaderActionPress = titleBarAction
        return
      }
    case .leftMouseDragged:
      if paneHeaderActionPress != nil {
        return
      }
      /**
       CDXC:NativePaneResize 2026-05-03-06:11
       Active split resizing shares the same native mouse-drag stream as
       title-bar pane reordering. The resize cursor owns that stream until
       mouse-up, so the header monitor must not briefly restore the grab cursor
       while the pointer is on a transparent resize line.
       */
      if let resizeDrag = paneResizeDrag {
        paneResizeCursor(for: resizeDrag.direction).set()
        return
      }
      if let drag = paneHeaderDrag {
        let point = convert(event.locationInWindow, from: nil)
        logPaneTabPointerProbe(
          event: "nativePaneTabs.monitor.mouseDragged",
          at: point,
          source: "monitor",
          details: [
            "dragIsDragging": drag.isDragging,
            "dragSourceSessionId": drag.sourceSessionId,
            "dragStartedFromTab": drag.startedFromTab,
          ])
        handlePaneTitleBarMouseDragged(event, sessionId: drag.sourceSessionId)
        return
      }
    case .leftMouseUp:
      let point = convert(event.locationInWindow, from: nil)
      logPaneTabPointerProbe(event: "nativePaneTabs.monitor.mouseUp", at: point, source: "monitor")
      if let pressedAction = paneHeaderActionPress {
        paneHeaderActionPress = nil
        guard let releasedAction = paneTitleBarAction(at: point),
          releasedAction.sessionId == pressedAction.sessionId,
          releasedAction.action == pressedAction.action
        else {
          return
        }
        focusSession(sessionId: pressedAction.sessionId, reason: "nativeTitleBarMonitorAction")
        sendEvent(
          .terminalTitleBarAction(
            sessionId: pressedAction.sessionId,
            action: pressedAction.action))
        return
      }
      if let drag = paneHeaderDrag {
        handlePaneTitleBarMouseUp(event, sessionId: drag.sourceSessionId)
        return
      }
    default:
      return
    }
  }

  private func resetPaneHeaderInteractionState() {
    paneHeaderActionPress = nil
    paneHeaderDrag = nil
    endPaneHeaderDragFeedback(restoresCursor: false)
  }

  private func logPaneFocusMouseDownProbe(at point: CGPoint) {
    guard let clickedSessionId = paneSessionId(at: point) else {
      return
    }
    let responderSessionId = currentResponderSessionId()
    guard clickedSessionId != focusedSessionId || clickedSessionId != responderSessionId else {
      return
    }
    /**
     CDXC:NativeTerminalFocus 2026-05-09-15:30
     User-reproduced active-border misses need a low-volume click breadcrumb
     before AppKit first-responder updates. Log only pane clicks that disagree
     with native focus/responder state so the focus handoff can be correlated
     without recording every terminal click.
     */
    TerminalFocusDebugLog.append(
      event: "nativeFocusTrace.mouseDownPaneProbe",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "clickedSessionId": clickedSessionId,
        "focusedSessionIdBefore": nullableString(focusedSessionId),
        "point": describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
        "responderBefore": responderSnapshot(),
        "responderSessionIdBefore": nullableString(responderSessionId),
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
  }

  private func acknowledgeClickedAttentionPane(at point: CGPoint) {
    guard let clickedSessionId = paneSessionId(at: point),
      attentionSessionIds.contains(clickedSessionId)
    else {
      return
    }
    /**
     CDXC:NativeSessionStatus 2026-05-09-15:30
     Clicking a green/done pane is an acknowledgement even when that pane is
     already first responder and AppKit will not emit a focus transition. Send
     the existing terminalFocused event from the mouse-down monitor so the
     sidebar clears attention through the same source-of-truth path as normal
     focus, with a local border update for immediate visual feedback.
     */
    TerminalFocusDebugLog.append(
      event: "nativeFocusTrace.attentionPaneMouseDownAcknowledged",
      details: [
        "clickedSessionId": clickedSessionId,
        "focusedSessionIdBefore": nullableString(focusedSessionId),
        "responderBefore": responderSnapshot(),
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
    attentionSessionIds.remove(clickedSessionId)
    updateTerminalBorder(for: clickedSessionId)
    sendEvent(.terminalFocused(sessionId: clickedSessionId))
  }

  private static func describeMouseEventType(_ type: NSEvent.EventType) -> String {
    switch type {
    case .leftMouseDown:
      return "leftMouseDown"
    case .leftMouseDragged:
      return "leftMouseDragged"
    case .leftMouseUp:
      return "leftMouseUp"
    default:
      return "\(type.rawValue)"
    }
  }

  private func syncCEFNativeDragSourceReleaseMonitor(reason _: String) {
    let shouldMonitor = window != nil
    if shouldMonitor {
      installCEFNativeDragSourceReleaseMonitorIfNeeded()
    } else {
      uninstallCEFNativeDragSourceReleaseMonitor()
    }
  }

  private func installCEFNativeDragSourceReleaseMonitorIfNeeded() {
    guard cefNativeDragSourceReleaseEventMonitor == nil else {
      return
    }
    /**
     CDXC:ChromiumBrowserPanes 2026-05-07-05:18
     CEF's renderer handles real pointer movement during in-page drags. zmux
     observes the native mouse stream and, after a real CEF drag-length
     movement releases, asks CEF to complete its drag source so the renderer
     receives the native end.

     CDXC:ChromiumBrowserPanes 2026-05-07-05:33
     CEF Alloy panes show native mouse movement during HTML drags, but VS Code's
     composite/view drop targets do not always receive browser `dragover`
     retargeting while the pointer moves. Bridge only the in-drag hover/drop
     retargeting into the page; Chromium still owns the original drag source
     and the native source-ended completion.

     CDXC:ChromiumBrowserPanes 2026-05-07-06:32
     Chromium's native drag loop can suppress AppKit's normal
     `leftMouseDragged` delivery to local monitors, so one-shot dragover
     forwarding only reacts at drag start/release. Poll the current mouse
     location in common run-loop modes during an active CEF drag so VS Code
     drop targets keep receiving hover updates while the user holds or moves.

     CDXC:ChromiumBrowserPanes 2026-05-07-07:22
     VS Code drop indicators flicker when bridged hover events retarget every
     small DOM child under the pointer or arrive faster than the workbench's
     drop observer needs. Coalesce native hover dispatch to a stable cadence and
     let the in-page bridge stabilize dragenter/dragleave targets while still
     sending periodic dragover events for hold-to-drop workflows.

     CDXC:ChromiumBrowserPanes 2026-05-07-07:33
     A 07:31 failed editor drag had no CEF hover bridge log entries while the
     07:33 successful drag did. Chromium can start its native HTML drag before
     AppKit delivers a threshold-crossing `leftMouseDragged` event, so arm the
     poller on mouse-down and let the poller detect the drag threshold itself.
     */
    cefNativeDragSourceReleaseEventMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]
    ) { [weak self] event in
      guard let self else {
        return event
      }
      self.handleCEFNativeDragSourceReleaseMonitorEvent(event)
      return event
    }
  }

  private func uninstallCEFNativeDragSourceReleaseMonitor() {
    cefNativeDragSourceRelease = nil
    stopCEFNativeDragHoverTimer()
    guard let cefNativeDragSourceReleaseEventMonitor else {
      return
    }
    NSEvent.removeMonitor(cefNativeDragSourceReleaseEventMonitor)
    self.cefNativeDragSourceReleaseEventMonitor = nil
  }

  private func handleCEFNativeDragSourceReleaseMonitorEvent(_ event: NSEvent) {
    guard let windowPoint = windowPoint(forCEFNativeDragEvent: event) else {
      return
    }
    switch event.type {
    case .leftMouseDown:
      guard let chromiumView = chromiumBrowserView(atWindowPoint: windowPoint) else {
        cefNativeDragSourceRelease = nil
        return
      }
      cefNativeDragSourceRelease = CEFNativeDragSourceRelease(
        chromiumView: chromiumView,
        startWindowPoint: windowPoint,
        didDrag: false,
        didStartHoverBridge: false,
        lastHoverEventTime: 0,
        lastHoverWindowPoint: nil,
        lastHoverLogEventTime: 0)
      startCEFNativeDragHoverTimerIfNeeded()
    case .leftMouseDragged:
      guard var release = cefNativeDragSourceRelease else {
        return
      }
      if !release.didDrag,
        hypot(
          windowPoint.x - release.startWindowPoint.x,
          windowPoint.y - release.startWindowPoint.y) >= Self.paneHeaderDragThreshold
      {
        release.didDrag = true
        startCEFNativeDragHoverTimerIfNeeded()
      }
      guard release.didDrag else {
        cefNativeDragSourceRelease = release
        return
      }
      if !release.didStartHoverBridge {
        dispatchCEFDragHoverUpdate(
          for: &release,
          windowPoint: windowPoint,
          eventTime: event.timestamp,
          phase: "start")
        release.didStartHoverBridge = true
      }
      cefNativeDragSourceRelease = release
    case .leftMouseUp:
      finishCEFNativeDragRelease(windowPoint: windowPoint, eventTime: event.timestamp)
    default:
      return
    }
  }

  private func startCEFNativeDragHoverTimerIfNeeded() {
    guard cefNativeDragHoverTimer == nil else {
      return
    }
    let timer = Timer(timeInterval: Self.cefNativeDragHoverInterval, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.pumpCEFNativeDragHoverTimer()
      }
    }
    cefNativeDragHoverTimer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  private func stopCEFNativeDragHoverTimer() {
    cefNativeDragHoverTimer?.invalidate()
    cefNativeDragHoverTimer = nil
  }

  private func pumpCEFNativeDragHoverTimer() {
    guard var release = cefNativeDragSourceRelease else {
      stopCEFNativeDragHoverTimer()
      return
    }
    guard let windowPoint = currentCEFNativeDragWindowPoint() else {
      return
    }
    guard NSEvent.pressedMouseButtons & 1 == 1 else {
      guard release.didDrag else {
        cefNativeDragSourceRelease = nil
        stopCEFNativeDragHoverTimer()
        return
      }
      finishCEFNativeDragRelease(windowPoint: windowPoint, eventTime: CACurrentMediaTime())
      return
    }
    if !release.didDrag {
      guard hypot(
        windowPoint.x - release.startWindowPoint.x,
        windowPoint.y - release.startWindowPoint.y) >= Self.paneHeaderDragThreshold
      else {
        cefNativeDragSourceRelease = release
        return
      }
      release.didDrag = true
    }
    dispatchCEFDragHoverUpdate(
      for: &release,
      windowPoint: windowPoint,
      eventTime: CACurrentMediaTime(),
      phase: release.didStartHoverBridge ? "over" : "start")
    release.didStartHoverBridge = true
    cefNativeDragSourceRelease = release
  }

  private func finishCEFNativeDragRelease(windowPoint: CGPoint, eventTime: TimeInterval) {
    guard var release = cefNativeDragSourceRelease else {
      return
    }
    cefNativeDragSourceRelease = nil
    stopCEFNativeDragHoverTimer()
    guard release.didDrag else {
      return
    }
    dispatchCEFDragHoverUpdate(
      for: &release,
      windowPoint: windowPoint,
      eventTime: eventTime,
      phase: "drop",
      force: true)
    release.chromiumView.completeCurrentDrag(atWindowPoint: windowPoint)
    NativeT3CodePaneReproLog.append("nativeWorkspace.cef.dnd.nativeSourceReleaseCompleted", [
      "windowNumber": window?.windowNumber ?? NSNull(),
      "x": windowPoint.x,
      "y": windowPoint.y,
    ])
  }

  private func dispatchCEFDragHoverUpdate(
    for release: inout CEFNativeDragSourceRelease,
    windowPoint: CGPoint,
    eventTime: TimeInterval,
    phase: String,
    force: Bool = false
  ) {
    let localPoint = release.chromiumView.convert(windowPoint, from: nil)
    guard release.chromiumView.bounds.contains(localPoint) else {
      guard force || release.didStartHoverBridge else {
        return
      }
      release.chromiumView.executeJavaScript(
        Self.cefDragHoverBridgeScript(
          x: 0,
          y: 0,
          phase: "cancel",
          sourceX: nil,
          sourceY: nil))
      return
    }
    if !force, phase == "over", let lastPoint = release.lastHoverWindowPoint {
      let elapsed = eventTime - release.lastHoverEventTime
      let distance = hypot(windowPoint.x - lastPoint.x, windowPoint.y - lastPoint.y)
      if distance < Self.cefNativeDragHoverMinimumDistance {
        guard elapsed >= Self.cefNativeDragStationaryHoverInterval else {
          return
        }
      } else {
        guard elapsed >= Self.cefNativeDragHoverInterval else {
          return
        }
      }
    }
    release.lastHoverEventTime = eventTime
    release.lastHoverWindowPoint = windowPoint
    release.chromiumView.executeJavaScript(
      Self.cefDragHoverBridgeScript(
        x: localPoint.x,
        y: localPoint.y,
        phase: phase,
        sourceX: release.chromiumView.convert(release.startWindowPoint, from: nil).x,
        sourceY: release.chromiumView.convert(release.startWindowPoint, from: nil).y))
    if phase != "over" || eventTime - release.lastHoverLogEventTime >= 0.25 {
      release.lastHoverLogEventTime = eventTime
      NativeT3CodePaneReproLog.append("nativeWorkspace.cef.dnd.hoverBridgeDispatched", [
        "phase": phase,
        "windowNumber": window?.windowNumber ?? NSNull(),
        "x": windowPoint.x,
        "y": windowPoint.y,
      ])
    }
  }

  private func windowPoint(forCEFNativeDragEvent event: NSEvent) -> CGPoint? {
    if event.window === window {
      return event.locationInWindow
    }
    guard event.window == nil, let window else {
      return nil
    }
    return window.convertPoint(fromScreen: NSEvent.mouseLocation)
  }

  private func currentCEFNativeDragWindowPoint() -> CGPoint? {
    guard let window else {
      return nil
    }
    return window.convertPoint(fromScreen: NSEvent.mouseLocation)
  }

  private func chromiumBrowserView(atWindowPoint windowPoint: CGPoint) -> ZmuxCEFBrowserView? {
    guard let hitView = window?.contentView?.hitTest(windowPoint) else {
      return nil
    }
    var currentView: NSView? = hitView
    while let view = currentView {
      if let chromiumView = view as? ZmuxCEFBrowserView {
        return chromiumView
      }
      currentView = view.superview
    }
    return nil
  }

  private func paneResizeHit(at point: CGPoint) -> PaneResizeHit? {
    paneResizeHitRecord(at: point)?.hit
  }

  private func paneResizeHitRecord(at point: CGPoint) -> (index: Int, hit: PaneResizeHit)? {
    paneResizeHits.enumerated()
      .filter { $0.element.rect.contains(point) }
      .min { left, right in
        let leftDistance = paneResizeDistance(from: point, to: left.element)
        let rightDistance = paneResizeDistance(from: point, to: right.element)
        return leftDistance < rightDistance
      }
      .map { (index: $0.offset, hit: $0.element) }
  }

  private func paneResizeDistance(from point: CGPoint, to hit: PaneResizeHit) -> CGFloat {
    switch hit.direction {
    case .horizontal:
      abs(point.x - hit.rect.midX)
    case .vertical:
      abs(point.y - hit.rect.midY)
    }
  }

  private func paneResizeMinimumLength(direction: NativeTerminalLayout.SplitDirection) -> CGFloat {
    direction == .horizontal ? Self.paneResizeMinimumWidth : Self.paneResizeMinimumHeight
  }

  private func resizePaneRatios(
    _ ratios: [CGFloat],
    boundaryIndex: Int,
    delta: CGFloat,
    availableLength: CGFloat,
    minimumBefore: CGFloat,
    minimumAfter: CGFloat
  ) -> [CGFloat] {
    let ratioTotal = ratios.reduce(0, +)
    guard ratios.count > 1, boundaryIndex > 0, boundaryIndex < ratios.count, ratioTotal > 0,
      availableLength > minimumBefore + minimumAfter
    else {
      return ratios
    }
    let beforeRatio = ratios.prefix(boundaryIndex).reduce(0, +)
    let afterRatio = ratioTotal - beforeRatio
    guard beforeRatio > 0, afterRatio > 0 else { return ratios }
    let beforeLength = beforeRatio / ratioTotal * availableLength
    let nextBeforeLength = min(
      max(beforeLength + delta, minimumBefore),
      availableLength - minimumAfter)
    let nextBeforeRatio = nextBeforeLength / availableLength * ratioTotal
    let nextAfterRatio = ratioTotal - nextBeforeRatio
    let beforeScale = nextBeforeRatio / beforeRatio
    let afterScale = nextAfterRatio / afterRatio
    return ratios.enumerated().map { index, ratio in
      ratio * (index < boundaryIndex ? beforeScale : afterScale)
    }
  }

  private func equalizePaneResizeRatios() {
    /**
     CDXC:NativePaneResize 2026-05-10-18:30
     Double-clicking any split handle is a global "make the visible split areas
     equal" command. Equalize every split group in the persisted layout tree,
     so three columns become 33/33/33 instead of preserving a nested 50/25/25
     ratio from the old auto-grid split shape.
     */
    equalizePaneResizeRatios(in: terminalLayout, path: "root")
    needsLayout = true
    layoutSubtreeIfNeeded()
  }

  private func equalizePaneResizeRatios(
    in node: NativeTerminalLayout?,
    path: String
  ) {
    guard let node else { return }
    switch node {
    case .leaf:
      return
    case .tabs:
      return
    case .split(_, _, let children):
      paneResizeRatiosByPath[path] = Array(repeating: 1, count: children.count)
      for (index, child) in children.enumerated() {
        equalizePaneResizeRatios(in: child, path: "\(path).\(index)")
      }
    }
  }

  /**
   CDXC:NativePaneReorder 2026-05-02-17:33
   Native Ghostty and T3 panes are AppKit/WKWebView surfaces above the React
   workspace DOM, so pane header drag-to-reorder must be detected in AppKit and
   reported to the sidebar state owner. A short movement threshold preserves
   normal title-bar clicks for focus while drags swap the source pane with the
   pane under the release point.
   */
  private func handlePaneTitleBarMouseDown(
    _ event: NSEvent,
    sessionId: String,
    focusReason: String
  ) {
    let startPoint = convert(event.locationInWindow, from: nil)
    guard paneTitleBarFrame(for: sessionId)?.contains(startPoint) == true else {
      /**
       CDXC:NativePaneReorder 2026-05-11-01:16
       A stale or misplaced TerminalSessionTitleBarView can still receive
       AppKit mouseDown before hit-test rerouting has invalidated it. Plain
       title-bar clicks only focus panes now, but they still must match the
       current registered title-bar frame before focus changes.
       */
      logPaneReorderProbe(
        event: "nativePaneReorder.titleBar.mouseDownRejected",
        at: startPoint,
        details: [
          "focusReason": focusReason,
          "sessionId": sessionId,
          "titleBarFrame": describeFrame(paneTitleBarFrame(for: sessionId) ?? .zero),
        ])
      return
    }
    /**
     CDXC:NativePaneReorderDiagnostics 2026-05-11-01:16
     Pane reordering now starts from tabs only. A plain title-bar click still
     focuses the pane, but must not create paneHeaderDrag state; otherwise empty
     title-bar drags compete with tab dragging and terminal text selection.
     */
    TerminalFocusDebugLog.append(
      event: "nativePaneTitleBar.focusMouseDown",
      details: [
        "focusReason": focusReason,
        "sessionId": sessionId,
        "startPoint": describeFrame(
            CGRect(x: startPoint.x, y: startPoint.y, width: 0, height: 0)),
      ])
    logPaneReorderProbe(
      event: "nativePaneReorder.titleBar.mouseDown",
      at: startPoint,
      details: [
        "focusReason": focusReason,
        "sessionId": sessionId,
        "titleBarFrame": describeFrame(paneTitleBarFrame(for: sessionId) ?? .zero),
      ])
    focusSession(sessionId: sessionId, reason: focusReason)
  }

  private func handlePaneTabMouseDown(_ event: NSEvent, sessionId: String) {
    let startPoint = convert(event.locationInWindow, from: nil)
    /**
     CDXC:PaneTabs 2026-05-10-18:30
     Tab buttons can represent inactive sessions whose own title-bar view is
     offscreen. Start a pane drag from the tab's session id without requiring
     the event point to match that hidden title-bar frame; a click without drag
     selects the tab on mouse-up.
     */
    paneHeaderDrag = PaneHeaderDrag(
      isDragging: false,
      lastLoggedMoveAt: 0,
      moveEventCount: 0,
      sourceSessionId: sessionId,
      startedFromTab: true,
      startPoint: startPoint,
      targetSessionId: nil)
    NativePaneTabDragReproLog.append(event: "nativePaneTabDrag.mouseDown", details: [
      "sessionId": sessionId,
      "startPoint": describeFrame(CGRect(x: startPoint.x, y: startPoint.y, width: 0, height: 0)),
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
  }

  private func handlePaneTabMouseUp(_ event: NSEvent, sessionId: String) {
    guard let drag = paneHeaderDrag, drag.sourceSessionId == sessionId else {
      NativePaneTabDragReproLog.append(event: "nativePaneTabDrag.mouseUp.noDragState", details: [
        "sessionId": sessionId,
        "windowNumber": event.window?.windowNumber ?? NSNull(),
      ])
      sendEvent(.paneTabSelected(sessionId: sessionId))
      return
    }
    if !drag.isDragging {
      paneHeaderDrag = nil
      NativePaneTabDragReproLog.append(event: "nativePaneTabDrag.clickSelected", details: [
        "sessionId": sessionId,
        "windowNumber": event.window?.windowNumber ?? NSNull(),
      ])
      NativePaneTabDragReproLog.append(event: "nativePaneTabs.hostEvent.send.paneTabSelected", details: [
        "sessionId": sessionId,
        "source": "tabButtonMouseUp",
      ])
      sendEvent(.paneTabSelected(sessionId: sessionId))
      return
    }
    handlePaneTitleBarMouseUp(event, sessionId: sessionId)
  }

  private func handlePaneTitleBarMouseDragged(_ event: NSEvent, sessionId: String) {
    guard var drag = paneHeaderDrag, drag.sourceSessionId == sessionId else {
      return
    }
    let point = convert(event.locationInWindow, from: nil)
    if !drag.isDragging,
      hypot(point.x - drag.startPoint.x, point.y - drag.startPoint.y)
        < Self.paneHeaderDragThreshold
    {
      return
    }
    if !drag.isDragging {
      drag.isDragging = true
      paneHeaderDrag = drag
      TerminalFocusDebugLog.append(
        event: "nativePaneReorder.dragStarted",
        details: [
          "point": describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
          "sessionId": sessionId,
          "startPoint": describeFrame(
            CGRect(x: drag.startPoint.x, y: drag.startPoint.y, width: 0, height: 0)),
        ])
      logPaneReorderProbe(
        event: "nativePaneReorder.dragStarted",
        at: point,
        details: [
          "sessionId": sessionId,
          "startPoint": describeFrame(
            CGRect(x: drag.startPoint.x, y: drag.startPoint.y, width: 0, height: 0)),
        ])
      beginPaneHeaderDragFeedback(for: drag.sourceSessionId, at: point)
    }
    updatePaneHeaderDragFeedback(
      for: drag.sourceSessionId,
      at: point,
      eventTimestamp: event.timestamp)
  }

  private func handlePaneTitleBarMouseUp(_ event: NSEvent, sessionId: String) {
    guard let drag = paneHeaderDrag, drag.sourceSessionId == sessionId else {
      return
    }
    paneHeaderDrag = nil
    endPaneHeaderDragFeedback()
    guard drag.isDragging else {
      if drag.startedFromTab {
        /**
         CDXC:PaneTabs 2026-05-10-20:03
         The window-local pane monitor sees the same mouse-up stream as native
         tab buttons and can clear paneHeaderDrag before AppKit dispatches
         mouseUp to the tab button. Treat a non-drag tab mouse-up as selection
         here too, so tab activation does not depend on which AppKit receiver
         observes the release first.
         */
        NativePaneTabDragReproLog.append(event: "nativePaneTabDrag.monitorClickSelected", details: [
          "sessionId": drag.sourceSessionId,
          "windowNumber": event.window?.windowNumber ?? NSNull(),
        ])
        NativePaneTabDragReproLog.append(event: "nativePaneTabs.hostEvent.send.paneTabSelected", details: [
          "sessionId": drag.sourceSessionId,
          "source": "windowMonitorMouseUp",
        ])
        sendEvent(.paneTabSelected(sessionId: drag.sourceSessionId))
      }
      return
    }
    let point = convert(event.locationInWindow, from: nil)
    if let tabReorderTarget = paneTabReorderDropTarget(at: point, sourceSessionId: drag.sourceSessionId) {
      TerminalFocusDebugLog.append(
        event: "nativePaneTabReorder.dropRequested",
        details: [
          "ownerSessionId": tabReorderTarget.ownerSessionId,
          "point": describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
          "position": tabReorderTarget.position.rawValue,
          "sourceSessionId": drag.sourceSessionId,
          "targetSessionId": tabReorderTarget.targetSessionId,
        ])
      NativePaneTabDragReproLog.append(event: "nativePaneTabReorder.dropRequested", details: [
        "ownerSessionId": tabReorderTarget.ownerSessionId,
        "position": tabReorderTarget.position.rawValue,
        "sourceSessionId": drag.sourceSessionId,
        "targetSessionId": tabReorderTarget.targetSessionId,
        "windowNumber": event.window?.windowNumber ?? NSNull(),
      ])
      sendEvent(
        .paneTabReorderRequested(
          sourceSessionId: drag.sourceSessionId,
          targetSessionId: tabReorderTarget.targetSessionId,
          position: tabReorderTarget.position))
      return
    }
    if isPointInSourceTabStrip(point, sourceSessionId: drag.sourceSessionId) {
      /**
       CDXC:PaneTabs 2026-05-11-01:43
       Dropping a tab back onto its original insertion slot is a no-op. The drag
       feedback hides the insertion line in that state, and mouse-up must not
       fall through to pane split/drop handling just because the tab strip has no
       effective reorder target.
       */
      NativePaneTabDragReproLog.append(event: "nativePaneTabReorder.dropIgnoredNoop", details: [
        "sourceSessionId": drag.sourceSessionId,
        "windowNumber": event.window?.windowNumber ?? NSNull(),
      ])
      return
    }
    guard let targetSessionId = paneSessionId(at: point), targetSessionId != drag.sourceSessionId
    else {
      TerminalFocusDebugLog.append(
        event: "nativePaneReorder.dropIgnored",
        details: [
          "point": describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
          "sourceSessionId": drag.sourceSessionId,
          "targetSessionId": paneSessionId(at: point) ?? NSNull(),
        ])
      if drag.startedFromTab {
        NativePaneTabDragReproLog.append(event: "nativePaneTabDrag.dropIgnored", details: [
          "point": describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
          "sourceSessionId": drag.sourceSessionId,
          "targetSessionId": paneSessionId(at: point) ?? NSNull(),
          "windowNumber": event.window?.windowNumber ?? NSNull(),
        ])
      }
      return
    }
    let placement = paneDropPlacement(at: point, targetSessionId: targetSessionId)
    TerminalFocusDebugLog.append(
      event: "nativePaneReorder.dropRequested",
      details: [
        "placement": placement.rawValue,
        "point": describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
        "sourceSessionId": drag.sourceSessionId,
        "targetSessionId": targetSessionId,
      ])
    if drag.startedFromTab {
      NativePaneTabDragReproLog.append(event: "nativePaneTabDrag.dropRequested", details: [
        "placement": placement.rawValue,
        "point": describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
        "sourceSessionId": drag.sourceSessionId,
        "targetFrame": paneFrame(for: targetSessionId).map(describeFrame) ?? NSNull(),
        "targetSessionId": targetSessionId,
        "windowNumber": event.window?.windowNumber ?? NSNull(),
      ])
    }
    sendEvent(
      .paneReorderRequested(
        sourceSessionId: drag.sourceSessionId,
        targetSessionId: targetSessionId,
        placement: placement))
    if drag.startedFromTab {
      NativePaneTabDragReproLog.append(event: "nativePaneTabs.hostEvent.sent.paneReorderRequested", details: [
        "placement": placement.rawValue,
        "sourceSessionId": drag.sourceSessionId,
        "targetSessionId": targetSessionId,
      ])
    }
  }

  private func paneDropPlacement(at point: CGPoint, targetSessionId: String) -> PaneDropPlacement {
    /**
     CDXC:PaneTabs 2026-05-10-18:30
     Dragging a terminal over the middle of another pane groups it as a tab;
     dragging onto an edge splits beside that pane. Keep the target bands local
     to the target pane so split intent does not depend on global workspace
     geometry.
     */
    guard let frame = paneBorderFrame(for: targetSessionId), frame.width > 1, frame.height > 1 else {
      return .center
    }
    let localX = (point.x - frame.minX) / frame.width
    let localY = (point.y - frame.minY) / frame.height
    let edgeBand: CGFloat = 0.24
    if localX <= edgeBand {
      return .left
    }
    if localX >= 1 - edgeBand {
      return .right
    }
    if localY <= edgeBand {
      return .bottom
    }
    if localY >= 1 - edgeBand {
      return .top
    }
    return .center
  }

  /**
   CDXC:NativePaneReorder 2026-05-03-03:57
   Reordering panes needs immediate native feedback because AppKit/WKWebView
   pane surfaces do not show the React session-card drag affordances. While a
   title bar is dragged, show a compact header ghost capped at 230px and outline
   the pane that will receive the drop.
   */
  private func beginPaneHeaderDragFeedback(for sessionId: String, at point: CGPoint) {
    let ghostView = paneHeaderDragGhostView ?? TerminalPaneHeaderDragGhostView()
    paneHeaderDragGhostView = ghostView
    if ghostView.superview !== self {
      addSubview(ghostView)
    }
    ghostView.configure(
      title: paneHeaderDisplayTitle(for: sessionId),
      favicon: paneHeaderFavicon(for: sessionId),
      agentIconDataUrl: sessionAgentIconDataUrls[sessionId],
      agentIconColorHex: sessionAgentIconColors[sessionId],
      maxWidth: Self.paneHeaderDragGhostMaxWidth
    )
    ghostView.layer?.zPosition = 230
    ghostView.alphaValue = 0.92
    ghostView.isHidden = false
    updatePaneHeaderDragFeedback(for: sessionId, at: point, eventTimestamp: nil)
  }

  private func updatePaneHeaderDragFeedback(
    for sourceSessionId: String,
    at point: CGPoint,
    eventTimestamp: TimeInterval?
  ) {
    let ghostOrigin = paneHeaderDragGhostOrigin(
      for: paneHeaderDragGhostView?.frame.size ?? .zero,
      cursorPoint: point)
    if let ghostView = paneHeaderDragGhostView {
      setPaneDragFeedbackFrame(
        CGRect(origin: ghostOrigin, size: ghostView.frame.size),
        for: ghostView)
    }
    let tabReorderTarget = paneTabReorderDropTarget(at: point, sourceSessionId: sourceSessionId)
    if let tabReorderTarget {
      updatePaneTabReorderTarget(tabReorderTarget)
      updatePaneHeaderDropTarget(sourceSessionId: sourceSessionId, targetSessionId: nil, placement: nil)
      if var drag = paneHeaderDrag, drag.sourceSessionId == sourceSessionId {
        let targetChanged = drag.targetSessionId != tabReorderTarget.targetSessionId
        drag.targetSessionId = tabReorderTarget.targetSessionId
        logPaneTabDragMoveIfNeeded(
          drag: &drag,
          eventTimestamp: eventTimestamp,
          ghostOrigin: ghostOrigin,
          placement: nil,
          point: point,
          targetChanged: targetChanged,
          targetSessionId: tabReorderTarget.targetSessionId)
        paneHeaderDrag = drag
      }
      return
    }
    if isPointInSourceTabStrip(point, sourceSessionId: sourceSessionId) {
      updatePaneTabReorderTarget(nil)
      updatePaneHeaderDropTarget(sourceSessionId: sourceSessionId, targetSessionId: nil, placement: nil)
      if var drag = paneHeaderDrag, drag.sourceSessionId == sourceSessionId {
        let targetChanged = drag.targetSessionId != nil
        drag.targetSessionId = nil
        logPaneTabDragMoveIfNeeded(
          drag: &drag,
          eventTimestamp: eventTimestamp,
          ghostOrigin: ghostOrigin,
          placement: nil,
          point: point,
          targetChanged: targetChanged,
          targetSessionId: nil)
        paneHeaderDrag = drag
      }
      return
    }
    updatePaneTabReorderTarget(nil)
    let targetSessionId = paneSessionId(at: point)
    let placement = targetSessionId.map { paneDropPlacement(at: point, targetSessionId: $0) }
    updatePaneHeaderDropTarget(
      sourceSessionId: sourceSessionId,
      targetSessionId: targetSessionId,
      placement: placement)
    if var drag = paneHeaderDrag, drag.sourceSessionId == sourceSessionId {
      let nextTargetSessionId = targetSessionId == sourceSessionId ? nil : targetSessionId
      let targetChanged = drag.targetSessionId != nextTargetSessionId
      drag.targetSessionId = nextTargetSessionId
      logPaneTabDragMoveIfNeeded(
        drag: &drag,
        eventTimestamp: eventTimestamp,
        ghostOrigin: ghostOrigin,
        placement: targetSessionId == sourceSessionId ? nil : placement,
        point: point,
        targetChanged: targetChanged,
        targetSessionId: nextTargetSessionId)
      paneHeaderDrag = drag
    }
  }

  private func endPaneHeaderDragFeedback(restoresCursor: Bool = true) {
    paneHeaderDragGhostView?.removeFromSuperview()
    paneHeaderDragGhostView = nil
    paneHeaderDragTargetView?.removeFromSuperview()
    paneHeaderDragTargetView = nil
    paneTabReorderTargetView?.removeFromSuperview()
    paneTabReorderTargetView = nil
    _ = restoresCursor
  }

  private func paneTabReorderDropTarget(
    at point: CGPoint,
    sourceSessionId: String
  ) -> PaneTabReorderDropTarget? {
    for (ownerSessionId, titleBarView) in visiblePaneTitleBarViews() {
      let titleBarPoint = convert(point, to: titleBarView)
      guard let target = titleBarView.tabReorderTarget(
        at: titleBarPoint,
        sourceSessionId: sourceSessionId)
      else {
        continue
      }
      return PaneTabReorderDropTarget(
        lineFrame: titleBarView.convert(target.lineFrame, to: self),
        ownerSessionId: ownerSessionId,
        position: target.position,
        targetSessionId: target.targetSessionId)
    }
    return nil
  }

  private func isPointInSourceTabStrip(_ point: CGPoint, sourceSessionId: String) -> Bool {
    for (_, titleBarView) in visiblePaneTitleBarViews() {
      let titleBarPoint = convert(point, to: titleBarView)
      if titleBarView.containsTab(sourceSessionId) && titleBarView.isTabStripPoint(titleBarPoint) {
        return true
      }
    }
    return false
  }

  private func visiblePaneTitleBarViews() -> [(ownerSessionId: String, titleBarView: TerminalSessionTitleBarView)] {
    let terminalTitleBars = sessions.values
      .filter { !$0.containerView.isHidden && !$0.titleBarView.isHidden && $0.titleBarView.window != nil }
      .map { (ownerSessionId: $0.sessionId, titleBarView: $0.titleBarView) }
    let webPaneTitleBars = webPaneSessions.values
      .filter { !$0.containerView.isHidden && !$0.titleBarView.isHidden && $0.titleBarView.window != nil }
      .map { (ownerSessionId: $0.sessionId, titleBarView: $0.titleBarView) }
    return terminalTitleBars + webPaneTitleBars
  }

  private func updatePaneTabReorderTarget(_ target: PaneTabReorderDropTarget?) {
    guard let target else {
      paneTabReorderTargetView?.removeFromSuperview()
      paneTabReorderTargetView = nil
      return
    }
    let targetView = paneTabReorderTargetView ?? TerminalPaneTabReorderTargetView()
    paneTabReorderTargetView = targetView
    if targetView.superview !== self {
      addSubview(targetView)
    }
    targetView.layer?.zPosition = 225
    setPaneDragFeedbackFrame(target.lineFrame, for: targetView)
    targetView.isHidden = false
  }

  private func updatePaneHeaderDropTarget(
    sourceSessionId: String,
    targetSessionId: String?,
    placement: PaneDropPlacement?
  ) {
    guard let targetSessionId, targetSessionId != sourceSessionId,
      let targetFrame = paneFrame(for: targetSessionId),
      let placement
    else {
      paneHeaderDragTargetView?.removeFromSuperview()
      paneHeaderDragTargetView = nil
      return
    }
    let targetView = paneHeaderDragTargetView ?? TerminalPaneHeaderDragTargetView()
    paneHeaderDragTargetView = targetView
    if targetView.superview !== self {
      addSubview(targetView)
    }
    targetView.layer?.zPosition = 220
    setPaneDragFeedbackFrame(
      paneHeaderDropTargetFrame(targetFrame: targetFrame, placement: placement),
      for: targetView)
    targetView.configure(placement: placement)
    targetView.isHidden = false
  }

  private func paneHeaderDropTargetFrame(
    targetFrame: CGRect,
    placement: PaneDropPlacement
  ) -> CGRect {
    /**
     CDXC:PaneTabs 2026-05-10-20:03
     Tab/pane drag feedback must preview the actual drop operation. Center
     drops group as tabs and fill the whole target pane; edge drops split next
     to the target and therefore fill only the half that will become the new
     split region.
     */
    let frame = targetFrame.insetBy(dx: 2, dy: 2)
    switch placement {
    case .center:
      return frame
    case .left:
      return CGRect(x: frame.minX, y: frame.minY, width: frame.width / 2, height: frame.height)
    case .right:
      return CGRect(x: frame.midX, y: frame.minY, width: frame.width / 2, height: frame.height)
    case .bottom:
      return CGRect(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height / 2)
    case .top:
      return CGRect(x: frame.minX, y: frame.midY, width: frame.width, height: frame.height / 2)
    }
  }

  private func setPaneDragFeedbackFrame(_ frame: CGRect, for view: NSView) {
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0
      context.allowsImplicitAnimation = false
      view.frame = frame
    }
  }

  private func logPaneTabDragMoveIfNeeded(
    drag: inout PaneHeaderDrag,
    eventTimestamp: TimeInterval?,
    ghostOrigin: CGPoint,
    placement: PaneDropPlacement?,
    point: CGPoint,
    targetChanged: Bool,
    targetSessionId: String?
  ) {
    guard drag.startedFromTab else {
      return
    }
    drag.moveEventCount += 1
    let now = ProcessInfo.processInfo.systemUptime
    let shouldLog =
      drag.moveEventCount <= 6
      || now - drag.lastLoggedMoveAt >= 0.08
      || targetChanged
    guard shouldLog else {
      return
    }
    drag.lastLoggedMoveAt = now
    NativePaneTabDragReproLog.append(event: "nativePaneTabDrag.move", details: [
      "dispatchLagMs": eventTimestamp.map { max(0, (now - $0) * 1000) } ?? NSNull(),
      "ghostOrigin": describeFrame(CGRect(x: ghostOrigin.x, y: ghostOrigin.y, width: 0, height: 0)),
      "moveEventCount": drag.moveEventCount,
      "placement": placement?.rawValue ?? NSNull(),
      "point": describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
      "sourceSessionId": drag.sourceSessionId,
      "targetFrame": targetSessionId.flatMap { paneFrame(for: $0).map(describeFrame) } ?? NSNull(),
      "targetSessionId": targetSessionId ?? NSNull(),
    ])
  }

  private func paneHeaderDragGhostOrigin(for size: CGSize, cursorPoint point: CGPoint) -> CGPoint {
    let margin: CGFloat = 8
    let hotSpot = CGPoint(x: 10, y: size.height / 2)
    let maxX = max(margin, bounds.width - size.width - margin)
    let maxY = max(margin, bounds.height - size.height - margin)
    return CGPoint(
      x: min(max(point.x - hotSpot.x, margin), maxX),
      y: min(max(point.y - hotSpot.y, margin), maxY)
    )
  }

  private func paneFrame(for sessionId: String) -> CGRect? {
    if let session = sessions[sessionId] {
      return session.containerView.frame
    }
    if let session = webPaneSessions[sessionId] {
      return session.containerView.frame
    }
    return nil
  }

  private func paneHeaderDisplayTitle(for sessionId: String) -> String {
    if let session = sessions[sessionId] {
      return session.titleBarView.displayTitle
    }
    if let session = webPaneSessions[sessionId] {
      return session.titleBarView.displayTitle
    }
    return normalizedTerminalSessionTitle(sessionTitles[sessionId], sessionId: sessionId)
  }

  private func paneHeaderFavicon(for sessionId: String) -> NSImage? {
    webPaneSessions[sessionId]?.titleBarView.displayFavicon
  }

  private func focusSession(sessionId: String, reason: String) {
    if sessions[sessionId] != nil {
      focusTerminal(sessionId: sessionId, reason: reason)
    } else if webPaneSessions[sessionId] != nil {
      focusWebPane(sessionId: sessionId, reason: reason)
    }
  }

  private func paneSessionId(at point: CGPoint) -> String? {
    for (sessionId, session) in sessions where activeSessionIds.contains(sessionId) {
      if !session.containerView.isHidden && session.containerView.frame.contains(point) {
        return sessionId
      }
    }
    for (sessionId, session) in webPaneSessions where activeSessionIds.contains(sessionId) {
      if !session.containerView.isHidden && session.containerView.frame.contains(point) {
        return sessionId
      }
    }
    return nil
  }

  private func updateHoveredPane(for event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    setHoveredPaneSessionId(bounds.contains(point) ? paneSessionId(at: point) : nil)
  }

  private func updateHoveredPaneFromCurrentMouseLocation() {
    guard let window else {
      setHoveredPaneSessionId(nil)
      return
    }
    let point = convert(window.mouseLocationOutsideOfEventStream, from: nil)
    setHoveredPaneSessionId(bounds.contains(point) ? paneSessionId(at: point) : nil)
  }

  private func setHoveredPaneSessionId(_ sessionId: String?) {
    guard hoveredPaneSessionId != sessionId else {
      return
    }
    /**
     CDXC:PaneTitleBarUX 2026-05-10-17:35
     Title-bar secondary actions reveal when the pointer is anywhere inside the
     pane, not only over the title bar. Track pane hover at the workspace layer
     because Ghostty/WKWebView content views otherwise consume the mouse stream
     before the title-bar view can see it.
     */
    hoveredPaneSessionId = sessionId
    for (id, session) in sessions {
      session.titleBarView.setPaneHovered(activeSessionIds.contains(id) && id == sessionId)
    }
    for (id, session) in webPaneSessions {
      session.titleBarView.setPaneHovered(activeSessionIds.contains(id) && id == sessionId)
    }
  }

  private func paneBorderFrame(for sessionId: String) -> CGRect? {
    if let session = sessions[sessionId] {
      return session.borderView.convert(session.borderView.bounds, to: self)
    }
    if let session = webPaneSessions[sessionId] {
      return session.borderView.convert(session.borderView.bounds, to: self)
    }
    return nil
  }

  private func paneTitleBarFrame(for sessionId: String) -> CGRect? {
    if let session = sessions[sessionId] {
      return session.titleBarView.convert(session.titleBarView.bounds, to: self)
    }
    if let session = webPaneSessions[sessionId] {
      return session.titleBarView.convert(session.titleBarView.bounds, to: self)
    }
    return nil
  }

  private func isPaneBottomEdgeProbePoint(_ point: CGPoint) -> Bool {
    guard let sessionId = paneSessionId(at: point),
      let borderFrame = paneBorderFrame(for: sessionId)
    else {
      return false
    }
    return point.y - borderFrame.minY <= 16
  }

  /**
   CDXC:NativePaneReorderDiagnostics 2026-05-10-12:32
   Bottom-edge pane drags need exact AppKit routing evidence. Log the pane,
   title-bar, resize, and hit-test state at drag lifecycle points only, so the
   repro can distinguish a false title-bar hit from stale paneHeaderDrag state.
   */
  private func logPaneReorderProbe(
    event: String,
    at point: CGPoint,
    details: [String: Any] = [:]
  ) {
    let paneSessionId = paneSessionId(at: point)
    let titleBarSessionId = paneTitleBarSessionId(at: point)
    let resizeHit = paneResizeHit(at: point)
    var payload = details
    payload["activeSessionIds"] = orderedVisibleSessionIds()
    payload["bottomEdgeDistance"] =
      paneSessionId.flatMap { id in paneBorderFrame(for: id).map { Double(point.y - $0.minY) } }
      ?? NSNull()
    payload["paneFrame"] =
      paneSessionId.flatMap { id in paneBorderFrame(for: id).map(describeFrame) } ?? NSNull()
    payload["paneSessionId"] = paneSessionId ?? NSNull()
    payload["point"] = describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0))
    payload["resizeHitDirection"] = resizeHit.map { String(describing: $0.direction) } ?? NSNull()
    payload["resizeHitRect"] = resizeHit.map { describeFrame($0.rect) } ?? NSNull()
    payload["titleBarFrame"] =
      titleBarSessionId.flatMap { id in paneTitleBarFrame(for: id).map(describeFrame) } ?? NSNull()
    payload["titleBarSessionId"] = titleBarSessionId ?? NSNull()
    payload["workspaceBounds"] = describeFrame(bounds)
    NativePaneReorderReproLog.append(event: event, details: payload)
  }

  private func logPaneTabPointerProbe(
    event: String,
    at point: CGPoint,
    source: String,
    details: [String: Any] = [:]
  ) {
    /**
     CDXC:PaneTabs 2026-05-11-08:33
     If native pane tabs do not click or drag, the first question is whether
     AppKit routed the pointer stream to the tab button, title-bar chrome, or
     an overlaid terminal/web surface. Log only monitor lifecycle points while
     debugging mode is enabled so a repro minute can identify the missing link.
     */
    var payload = details
    let tabHit = paneTitleBarTab(at: point)
    let titleBarSessionId = paneTitleBarSessionId(at: point)
    payload["activeSessionIds"] = orderedVisibleSessionIds()
    payload["paneSessionId"] = paneSessionId(at: point) ?? NSNull()
    payload["point"] = describeFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0))
    payload["source"] = source
    payload["tabHitFrame"] = tabHit?.frame.map(describeFrame) ?? NSNull()
    payload["tabHitSessionId"] = tabHit?.tabSessionId ?? NSNull()
    payload["tabHitTitleBarSessionId"] = tabHit?.titleBarSessionId ?? NSNull()
    payload["titleBarFrame"] =
      titleBarSessionId.flatMap { id in paneTitleBarFrame(for: id).map(describeFrame) } ?? NSNull()
    payload["titleBarSessionId"] = titleBarSessionId ?? NSNull()
    payload["windowNumber"] = window?.windowNumber ?? NSNull()
    NativePaneTabDragReproLog.append(event: event, details: payload)
  }

  private func paneTitleBarTab(at point: CGPoint) -> (
    frame: CGRect?,
    tabSessionId: String,
    titleBarSessionId: String
  )? {
    for (sessionId, session) in sessions where activeSessionIds.contains(sessionId) {
      let titleBarPoint = convert(point, to: session.titleBarView)
      guard session.titleBarView.bounds.contains(titleBarPoint) else {
        continue
      }
      if let tabSessionId = session.titleBarView.tabSessionId(at: titleBarPoint) {
        return (
          session.titleBarView.tabFrame(for: tabSessionId).map {
            convert($0, from: session.titleBarView)
          },
          tabSessionId,
          sessionId
        )
      }
    }
    for (sessionId, session) in webPaneSessions where activeSessionIds.contains(sessionId) {
      let titleBarPoint = convert(point, to: session.titleBarView)
      guard session.titleBarView.bounds.contains(titleBarPoint) else {
        continue
      }
      if let tabSessionId = session.titleBarView.tabSessionId(at: titleBarPoint) {
        return (
          session.titleBarView.tabFrame(for: tabSessionId).map {
            convert($0, from: session.titleBarView)
          },
          tabSessionId,
          sessionId
        )
      }
    }
    return nil
  }

  private func paneTitleBarSessionId(at point: CGPoint) -> String? {
    for (sessionId, session) in sessions where activeSessionIds.contains(sessionId) {
      if paneTitleBarView(session.titleBarView, containsDraggablePoint: point) {
        return sessionId
      }
    }
    for (sessionId, session) in webPaneSessions where activeSessionIds.contains(sessionId) {
      if paneTitleBarView(session.titleBarView, containsDraggablePoint: point) {
        return sessionId
      }
    }
    return nil
  }

  private func paneTitleBarAction(at point: CGPoint) -> (
    sessionId: String, action: TerminalTitleBarAction
  )? {
    for (sessionId, session) in sessions where activeSessionIds.contains(sessionId) {
      let titleBarPoint = convert(point, to: session.titleBarView)
      guard session.titleBarView.bounds.contains(titleBarPoint) else {
        continue
      }
      if let action = session.titleBarView.actionButtonAction(at: titleBarPoint) {
        return (sessionId, action)
      }
    }
    for (sessionId, session) in webPaneSessions where activeSessionIds.contains(sessionId) {
      let titleBarPoint = convert(point, to: session.titleBarView)
      guard session.titleBarView.bounds.contains(titleBarPoint) else {
        continue
      }
      if let action = session.titleBarView.actionButtonAction(at: titleBarPoint) {
        return (sessionId, action)
      }
    }
    return nil
  }

  private func paneTitleBarView(
    _ titleBarView: TerminalSessionTitleBarView,
    containsDraggablePoint point: CGPoint
  ) -> Bool {
    let titleBarPoint = convert(point, to: titleBarView)
    guard titleBarView.bounds.contains(titleBarPoint) else {
      return false
    }
    return titleBarView.isDraggableHeaderPoint(titleBarPoint)
  }

  private func syncPoppedOutPaneWindows(reason: String) {
    /**
     CDXC:PanePopOut 2026-05-11-09:35
     Pop-out must move the existing native surface instead of recreating a
     terminal/browser fallback. The sidebar sends presentation state; AppKit
     reparents the live surface into one zmux-owned NSWindow and keeps the
     original split/tab slot available for a reattach placeholder.
     */
    for sessionId in Array(poppedOutPaneControllers.keys) where !poppedOutSessionIds.contains(sessionId) {
      reattachPoppedOutPane(sessionId: sessionId, reason: reason)
    }

    for sessionId in poppedOutSessionIds {
      ensurePoppedOutPaneWindow(sessionId: sessionId, reason: reason)
    }
  }

  private func ensurePoppedOutPaneWindow(sessionId: String, reason: String) {
    guard poppedOutPaneControllers[sessionId] == nil else {
      updatePoppedOutWindowTitle(sessionId: sessionId)
      showPoppedOutPlaceholderImmediately(sessionId: sessionId, reason: reason)
      return
    }
    let title = normalizedTerminalSessionTitle(sessionTitles[sessionId], sessionId: sessionId)
    let contentView: NSView
    let firstResponder: NSView
    let popOutTitleBarView = TerminalSessionTitleBarView(title: title, actions: [.restorePopOut])
    popOutTitleBarView.setAgentIconDataUrl(
      sessionAgentIconDataUrls[sessionId],
      colorHex: sessionAgentIconColors[sessionId])
    popOutTitleBarView.onAction = { [weak self] action in
      guard let self else { return }
      self.applyOptimisticPanePopOutAction(
        sessionId: sessionId,
        action: action,
        reason: "poppedOutWindowTitleBarAction")
      self.sendEvent(.terminalTitleBarAction(sessionId: sessionId, action: action))
    }
    if let session = sessions[sessionId] {
      session.scrollView.removeFromSuperview()
      session.searchBarView.removeFromSuperview()
      contentView = PoppedOutTerminalPaneContentView(
        scrollView: session.scrollView,
        searchBarView: session.searchBarView,
        titleBarView: popOutTitleBarView,
        titleBarHeight: Self.terminalTitleBarHeight)
      firstResponder = session.view
    } else if let session = webPaneSessions[sessionId] {
      session.hostView.removeFromSuperview()
      popOutTitleBarView.setFavicon(nativePaneImage(fromDataUrl: sessionFaviconDataUrls[sessionId]))
      contentView = PoppedOutWebPaneContentView(
        hostView: session.hostView,
        titleBarView: popOutTitleBarView,
        titleBarHeight: Self.terminalTitleBarHeight)
      firstResponder = session.browserContentView
    } else {
      return
    }

    let frame = defaultPoppedOutWindowFrame()
    let popOutWindow = NSWindow(
      contentRect: NSWindow.contentRect(
        forFrameRect: frame,
        styleMask: [.closable, .miniaturizable, .resizable, .titled]),
      styleMask: [.closable, .miniaturizable, .resizable, .titled],
      backing: .buffered,
      defer: false)
    popOutWindow.title = title
    popOutWindow.contentView = contentView
    popOutWindow.isReleasedWhenClosed = false
    let controller = PoppedOutPaneWindowController(
      sessionId: sessionId,
      titleBarView: popOutTitleBarView,
      window: popOutWindow,
      onReattachRequested: { [weak self] sessionId in
        guard let self else { return }
        self.applyOptimisticPanePopOutAction(
          sessionId: sessionId,
          action: .restorePopOut,
          reason: "poppedOutWindowClose")
        self.sendEvent(.terminalTitleBarAction(sessionId: sessionId, action: .restorePopOut))
      })
    poppedOutPaneControllers[sessionId] = controller
    showPoppedOutPlaceholderImmediately(sessionId: sessionId, reason: reason)
    popOutWindow.makeKeyAndOrderFront(nil)
    _ = popOutWindow.makeFirstResponder(firstResponder)
    NativeT3CodePaneReproLog.append("nativeWorkspace.panePopOut.window.opened", [
      "reason": reason,
      "sessionId": sessionId,
      "title": title,
      "windowFrame": describeFrame(popOutWindow.frame),
    ])
  }

  private func reattachPoppedOutPane(sessionId: String, reason: String) {
    guard let controller = poppedOutPaneControllers.removeValue(forKey: sessionId) else {
      removePoppedOutPlaceholder(sessionId: sessionId)
      return
    }
    controller.closeProgrammatically()
    if let session = sessions[sessionId] {
      mountTerminalPaneContainer(for: session)
    } else if let session = webPaneSessions[sessionId] {
      mountWebPaneContainer(for: session)
    }
    removePoppedOutPlaceholder(sessionId: sessionId)
    needsLayout = true
    NativeT3CodePaneReproLog.append("nativeWorkspace.panePopOut.window.reattached", [
      "reason": reason,
      "sessionId": sessionId,
    ])
  }

  private func closePoppedOutPaneWindow(sessionId: String, reason: String) {
    poppedOutSessionIds.remove(sessionId)
    if let controller = poppedOutPaneControllers.removeValue(forKey: sessionId) {
      controller.closeProgrammatically()
    }
    removePoppedOutPlaceholder(sessionId: sessionId)
    NativeT3CodePaneReproLog.append("nativeWorkspace.panePopOut.window.closed", [
      "reason": reason,
      "sessionId": sessionId,
    ])
  }

  private func updatePoppedOutWindowTitle(sessionId: String) {
    guard let controller = poppedOutPaneControllers[sessionId] else {
      return
    }
    let title = normalizedTerminalSessionTitle(sessionTitles[sessionId], sessionId: sessionId)
    controller.window?.title = title
    controller.titleBarView.setTitle(title)
    showPoppedOutPlaceholderImmediately(sessionId: sessionId, reason: "updatePoppedOutWindowTitle")
  }

  private func applyOptimisticPanePopOutAction(
    sessionId: String,
    action: TerminalTitleBarAction,
    reason: String
  ) {
    /**
     CDXC:PanePopOut 2026-05-11-10:24
     Pop-out/restore chrome must react immediately in AppKit. Do the native
     reparenting and placeholder update optimistically before the sidebar's
     persisted workspace sync returns, then let the next sync confirm the same
     presentation state.
     */
    switch action {
    case .popOut:
      guard activeSessionIds.contains(sessionId), !poppedOutSessionIds.contains(sessionId) else {
        return
      }
      poppedOutSessionIds.insert(sessionId)
      showPoppedOutPlaceholderImmediately(sessionId: sessionId, reason: "\(reason).popOut")
      ensurePoppedOutPaneWindow(sessionId: sessionId, reason: "\(reason).popOut")
    case .restorePopOut:
      guard poppedOutSessionIds.contains(sessionId) || poppedOutPaneControllers[sessionId] != nil else {
        return
      }
      poppedOutSessionIds.remove(sessionId)
      reattachPoppedOutPane(sessionId: sessionId, reason: "\(reason).restorePopOut")
      needsLayout = true
      layoutSubtreeIfNeeded()
    default:
      return
    }
  }

  private func showPoppedOutPlaceholderImmediately(sessionId: String, reason: String) {
    guard poppedOutSessionIds.contains(sessionId) else {
      return
    }
    if let rect = currentPaneRectForPlaceholder(sessionId: sessionId) {
      setPoppedOutPlaceholderFrame(rect, for: sessionId)
      poppedOutPlaceholderViews[sessionId]?.needsLayout = true
      poppedOutPlaceholderViews[sessionId]?.layoutSubtreeIfNeeded()
      NativeT3CodePaneReproLog.append("nativeWorkspace.panePopOut.placeholder.immediate", [
        "reason": reason,
        "sessionId": sessionId,
        "rect": describeFrame(rect),
      ])
      return
    }
    needsLayout = true
    layoutSubtreeIfNeeded()
  }

  private func currentPaneRectForPlaceholder(sessionId: String) -> CGRect? {
    if let session = sessions[sessionId] {
      if session.containerView.frame.width > 1, session.containerView.frame.height > 1 {
        return session.containerView.frame
      }
      if session.borderView.frame.width > 1, session.borderView.frame.height > 1 {
        return session.containerView.convert(session.borderView.frame, to: self)
      }
      if session.titleBarView.frame.width > 1, session.scrollView.frame.width > 1 {
        let localRect = session.titleBarView.frame.union(session.scrollView.frame)
        return session.containerView.convert(localRect, to: self)
      }
    }
    if let session = webPaneSessions[sessionId] {
      if session.containerView.frame.width > 1, session.containerView.frame.height > 1 {
        return session.containerView.frame
      }
      if session.borderView.frame.width > 1, session.borderView.frame.height > 1 {
        return session.containerView.convert(session.borderView.frame, to: self)
      }
      if session.titleBarView.frame.width > 1, session.hostView.frame.width > 1 {
        let localRect = session.titleBarView.frame.union(session.hostView.frame)
        return session.containerView.convert(localRect, to: self)
      }
    }
    return nil
  }

  private func defaultPoppedOutWindowFrame() -> CGRect {
    let size = CGSize(width: 980, height: 680)
    guard let sourceFrame = window?.frame else {
      return CGRect(origin: CGPoint(x: 180, y: 180), size: size)
    }
    return CGRect(
      x: sourceFrame.midX - size.width / 2 + 40,
      y: sourceFrame.midY - size.height / 2 - 40,
      width: size.width,
      height: size.height)
  }

  private func setPoppedOutPlaceholderFrame(_ rect: CGRect, for sessionId: String) {
    let title = normalizedTerminalSessionTitle(sessionTitles[sessionId], sessionId: sessionId)
    let titleBarHeight = min(Self.terminalTitleBarHeight, max(rect.height, 0))
    let titleBarRect = CGRect(
      x: rect.minX,
      y: rect.maxY - titleBarHeight,
      width: rect.width,
      height: titleBarHeight
    )
    let placeholderRect = CGRect(
      x: rect.minX,
      y: rect.minY,
      width: rect.width,
      height: max(rect.height - titleBarHeight, 1)
    )
    let placeholderView =
      poppedOutPlaceholderViews[sessionId]
      ?? PoppedOutPanePlaceholderView(title: title) { [weak self] in
        guard let self else { return }
        self.applyOptimisticPanePopOutAction(
          sessionId: sessionId,
          action: .restorePopOut,
          reason: "poppedOutPlaceholderReattach")
        self.sendEvent(.terminalTitleBarAction(sessionId: sessionId, action: .restorePopOut))
      }
    poppedOutPlaceholderViews[sessionId] = placeholderView
    placeholderView.setTitle(title)
    if placeholderView.superview !== self {
      addSubview(placeholderView)
    }
    placeholderView.frame = placeholderRect
    placeholderView.isHidden = false
    if let session = sessions[sessionId] {
      session.containerView.isHidden = true
      session.titleBarView.frame = titleBarRect
      session.titleBarView.isHidden = false
      session.titleBarView.removeFromSuperview()
      addSubview(session.titleBarView)
      session.borderView.frame = rect
      session.borderView.removeFromSuperview()
      addSubview(session.borderView)
      session.borderView.isHidden = false
    } else if let session = webPaneSessions[sessionId] {
      session.containerView.isHidden = true
      session.titleBarView.frame = titleBarRect
      session.titleBarView.isHidden = false
      session.titleBarView.removeFromSuperview()
      addSubview(session.titleBarView)
      session.borderView.frame = rect
      session.borderView.removeFromSuperview()
      addSubview(session.borderView)
      session.borderView.isHidden = false
    }
    updateTerminalBorder(for: sessionId)
    bringPaneResizeHandleViewsToFront()
  }

  private func removePoppedOutPlaceholder(sessionId: String) {
    guard let placeholderView = poppedOutPlaceholderViews.removeValue(forKey: sessionId) else {
      return
    }
    placeholderView.removeFromSuperview()
  }

  private func setFrame(_ rect: CGRect, for sessionId: String) {
    if poppedOutSessionIds.contains(sessionId) {
      setPoppedOutPlaceholderFrame(rect, for: sessionId)
      return
    }
    removePoppedOutPlaceholder(sessionId: sessionId)
    if let webPane = webPaneSessions[sessionId] {
      setWebPaneFrame(rect, for: webPane)
      return
    }

    guard let session = sessions[sessionId] else {
      return
    }
    /**
     CDXC:NativeTerminals 2026-04-28-12:49
     Non-persistent native Ghostty panes must show the same per-session title
     bar that the reference workspace renders in React. The AppKit surface is
     therefore laid out below native chrome instead of covering the full pane.
     */
    let titleBarHeight = min(Self.terminalTitleBarHeight, max(rect.height, 0))
    mountTerminalPaneContainer(for: session)
    session.containerView.frame = rect
    session.containerView.isHidden = false
    let titleBarRect = CGRect(
      x: 0,
      y: rect.height - titleBarHeight,
      width: rect.width,
      height: titleBarHeight
    )
    let availableTerminalRect = CGRect(
      x: 0,
      y: 0,
      width: rect.width,
      height: max(rect.height - titleBarHeight, 1)
    )
    /**
     CDXC:NativeTerminalResize 2026-05-02-17:19
     Pane chrome and the terminal renderer must share the same body width.
     Remove the previous whole-cell stepping here because it created visible
     chrome/body width drift and did not resolve the prior terminal resize bug.
     */
    let terminalRect = availableTerminalRect
    session.titleBarView.frame = titleBarRect
    session.titleBarView.needsLayout = true
    session.titleBarView.layoutSubtreeIfNeeded()
    session.scrollView.frame = availableTerminalRect
    session.scrollView.needsLayout = true
    session.scrollView.layoutSubtreeIfNeeded()
    session.searchBarView.frame = searchBarFrame(in: terminalRect)
    session.borderView.frame = session.containerView.bounds
    logTerminalResizeIfNeeded(
      session: session,
      paneRect: rect,
      titleBarRect: titleBarRect,
      availableTerminalRect: availableTerminalRect,
      terminalRect: terminalRect)
    updateTerminalBorder(for: sessionId)
  }

  private func movePaneSessionOffscreen(_ sessionId: String) {
    if let placeholderView = poppedOutPlaceholderViews[sessionId] {
      moveOffscreen(placeholderView)
    }
    if let session = sessions[sessionId] {
      guard !poppedOutSessionIds.contains(sessionId) else {
        moveOffscreen(session.titleBarView)
        moveOffscreen(session.borderView)
        moveOffscreen(session.containerView)
        return
      }
      moveOffscreen(session.containerView)
      return
    }
    if let session = webPaneSessions[sessionId] {
      guard !poppedOutSessionIds.contains(sessionId) else {
        moveOffscreen(session.titleBarView)
        moveOffscreen(session.borderView)
        moveOffscreen(session.containerView)
        return
      }
      moveOffscreen(session.containerView)
    }
  }

  private func setPaneTabs(
    _ sessionIds: [String],
    activeSessionId: String,
    on ownerSessionId: String
  ) {
    let items = sessionIds.map { sessionId in
      TerminalSessionTitleBarView.TabItem(
        isSleeping: sleepingSessionIds.contains(sessionId),
        sessionId: sessionId,
        title: normalizedTerminalSessionTitle(sessionTitles[sessionId], sessionId: sessionId))
    }
    if let session = sessions[ownerSessionId] {
      session.titleBarView.setTabs(items, activeSessionId: activeSessionId)
      session.titleBarView.setTabActivities(sessionActivities)
      session.titleBarView.setTabIdentityIcons(
        faviconDataUrls: sessionFaviconDataUrls,
        agentIconDataUrls: sessionAgentIconDataUrls,
        agentIconColors: sessionAgentIconColors)
    }
    if let session = webPaneSessions[ownerSessionId] {
      session.titleBarView.setTabs(items, activeSessionId: activeSessionId)
      session.titleBarView.setTabActivities(sessionActivities)
      session.titleBarView.setTabIdentityIcons(
        faviconDataUrls: sessionFaviconDataUrls,
        agentIconDataUrls: sessionAgentIconDataUrls,
        agentIconColors: sessionAgentIconColors)
    }
  }

  private func setWebPaneFrame(_ rect: CGRect, for session: WebPaneSession) {
    let resolvedRect: CGRect
    if rect.width <= 1 || rect.height <= Self.terminalTitleBarHeight + 1 {
      resolvedRect = layoutBounds(forVisibleCount: max(orderedVisibleSessionIds().count, 1))
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.layout.fallbackRect", [
        "inputRect": describeFrame(rect),
        "resolvedRect": describeFrame(resolvedRect),
        "sessionId": session.sessionId,
        "workspaceBounds": describeFrame(bounds),
      ])
    } else {
      resolvedRect = rect
    }
    let titleBarHeight = min(Self.terminalTitleBarHeight, max(resolvedRect.height, 0))
    mountWebPaneContainer(for: session)
    session.containerView.frame = resolvedRect
    session.containerView.isHidden = false
    let titleBarRect = CGRect(
      x: 0,
      y: resolvedRect.height - titleBarHeight,
      width: resolvedRect.width,
      height: titleBarHeight
    )
    let contentRect = CGRect(
      x: 0,
      y: 0,
      width: resolvedRect.width,
      height: max(resolvedRect.height - titleBarHeight, 1)
    )
    session.titleBarView.frame = titleBarRect
    session.titleBarView.needsLayout = true
    session.titleBarView.layoutSubtreeIfNeeded()
    session.hostView.translatesAutoresizingMaskIntoConstraints = true
    session.hostView.frame = contentRect
    session.hostView.refreshHostedWebView(reason: "setWebPaneFrame")
    session.borderView.frame = session.containerView.bounds
    if focusedSessionId == session.sessionId {
      orderWebPaneViewsToFront(session)
    }
    updateTerminalBorder(for: session.sessionId)
  }

  private func scheduleDeferredWebPaneLayout(sessionId: String?, reason: String) {
    guard let sessionId, webPaneSessions[sessionId] != nil else {
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self, self.webPaneSessions[sessionId] != nil else {
        return
      }
      self.superview?.needsLayout = true
      self.superview?.layoutSubtreeIfNeeded()
      self.needsLayout = true
      self.layoutSubtreeIfNeeded()
      if let session = self.webPaneSessions[sessionId] {
        /**
         CDXC:T3Code 2026-05-01-14:10
         WKWebView panes can be created before the native workspace receives
         its final AppKit bounds. If split layout initially gives the web pane a
         zero rect, pin the pane host to the resolved workspace pane during the
         deferred layout pass so the web content is rendered as an inline pane,
         not an accessibility-only webview hidden behind the workspace layer.
         */
        if session.hostView.frame.width <= 1 || session.hostView.frame.height <= 1,
          self.bounds.width > 1, self.bounds.height > Self.terminalTitleBarHeight + 1
        {
          let rect = self.layoutBounds(
            forVisibleCount: max(self.orderedVisibleSessionIds().count, 1))
          NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.layout.deferredPin", [
            "hostFrame": self.describeFrame(session.hostView.frame),
            "reason": reason,
            "resolvedRect": self.describeFrame(rect),
            "sessionId": sessionId,
            "workspaceBounds": self.describeFrame(self.bounds),
          ])
          self.setWebPaneFrame(rect, for: session)
        }
        NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.layout.deferred", [
          "hostFrame": self.describeFrame(session.hostView.frame),
          "reason": reason,
          "sessionId": sessionId,
          "workspaceBounds": self.describeFrame(self.bounds),
        ])
        session.hostView.refreshHostedWebView(reason: "\(reason).deferred")
      }
    }
  }

  /**
   CDXC:T3Code 2026-04-30-19:17
   The T3 Code pane is a native WKWebView, not React DOM inside the sidebar.
   Keep the WebKit surface inside the pane host so it participates in split
   layout and z-order like a browser pane instead of floating over the app.
   */
  private func orderWebPaneViewsToFront(_ optionalSession: WebPaneSession?) {
    guard let session = optionalSession else {
      return
    }
    guard !poppedOutSessionIds.contains(session.sessionId) else {
      return
    }
    mountWebPaneContainer(for: session)
    guard session.containerView.superview === self else {
      return
    }
    if subviews.last !== session.containerView {
      session.containerView.removeFromSuperview()
      addSubview(session.containerView, positioned: .above, relativeTo: nil)
    }
    session.containerView.alphaValue = 1
    session.containerView.layer?.zPosition = 100
    bringPaneResizeHandleViewsToFront()
  }

  private func scheduleWebPaneReload(sessionId: String, url: URL, remainingAttempts: Int) {
    guard remainingAttempts > 0 else {
      return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) { [weak self] in
      guard let self, let session = self.webPaneSessions[sessionId] else {
        return
      }
      guard !self.completedWebPaneLoadSessionIds.contains(sessionId) else {
        return
      }
      guard let webView = session.webView else {
        return
      }
      if webView.isLoading {
        NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.retry.waiting", [
          "remainingAttempts": remainingAttempts,
          "sessionId": sessionId,
          "url": url.absoluteString,
        ])
        self.scheduleWebPaneReload(
          sessionId: sessionId,
          url: url,
          remainingAttempts: remainingAttempts - 1
        )
        return
      }

      /**
       CDXC:T3Code 2026-04-30-03:47
       WKWebView keeps `url` populated after a provisional localhost failure,
       so retrying only when `webView.url == nil` strands T3 Code on a gray
       pane if the first load races provider startup. Retry until navigation
       actually finishes, then stop.
       */
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.retry", [
        "currentUrl": webView.url?.absoluteString ?? NSNull(),
        "remainingAttempts": remainingAttempts,
        "sessionId": sessionId,
        "url": url.absoluteString,
      ])
      self.loadWebPane(sessionId: sessionId, url: url, reason: "retry")
    }
  }

  private func loadWebPane(sessionId: String, url: URL, reason: String) {
    guard webPaneSessions[sessionId] != nil else {
      return
    }
    guard NativeT3RuntimeLauncher.isManagedRuntimeURL(url) else {
      guard let session = webPaneSessions[sessionId] else {
        return
      }
      /**
       CDXC:ChromiumBrowserPanes 2026-05-04-16:38
       Non-T3 browser panes load through embedded Chromium/CEF, not WebKit.
       The T3 authentication/thread-route bootstrap remains gated to managed
       localhost runtime URLs so public web navigation never calls T3-only APIs.
       */
      NativeT3CodePaneReproLog.append("nativeWorkspace.browserWebPane.load.start", [
        "engine": session.chromiumView == nil ? "missing-chromium" : "chromium",
        "reason": reason,
        "sessionId": sessionId,
        "url": url.absoluteString,
      ])
      session.chromiumView?.loadURLString(url.absoluteString)
      return
    }
    guard !pendingAuthenticatedWebPaneLoadSessionIds.contains(sessionId) else {
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.authPending", [
        "reason": reason,
        "sessionId": sessionId,
        "url": url.absoluteString,
      ])
      return
    }
    pendingAuthenticatedWebPaneLoadSessionIds.insert(sessionId)
    NativeT3RuntimeBrowserAuth.prepareManagedWebSession(for: url, sessionId: sessionId) {
      [weak self] in
      guard let self, let session = self.webPaneSessions[sessionId] else {
        return
      }
      self.pendingAuthenticatedWebPaneLoadSessionIds.remove(sessionId)
      self.completedWebPaneLoadSessionIds.remove(sessionId)
      NativeT3RuntimeSessionBootstrap.prepareThreadRoute(
        origin: url,
        projectId: session.projectId,
        sessionId: sessionId,
        threadId: session.threadId,
        title: session.title,
        workspaceRoot: session.workspaceRoot
      ) { [weak self] result in
        guard let self, let session = self.webPaneSessions[sessionId] else {
          return
        }
        switch result {
        case .success(let route):
          self.t3ThreadRouteRetryAttemptsBySessionId.removeValue(forKey: sessionId)
          self.sendEvent(
            .t3ThreadReady(
              sessionId: sessionId,
              projectId: route.projectId,
              threadId: route.threadId,
              serverOrigin: "\(url.scheme ?? "http")://\(url.host ?? "127.0.0.1")\(url.port.map { ":\($0)" } ?? "")",
              workspaceRoot: session.workspaceRoot ?? ""
            )
          )
          NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.start", [
            "reason": reason,
            "routeUrl": route.url.absoluteString,
            "sessionId": sessionId,
            "url": url.absoluteString,
            "workspaceRoot": session.workspaceRoot ?? NSNull(),
          ])
          session.webView?.load(URLRequest(url: route.url))
          self.scheduleWebPaneReload(sessionId: sessionId, url: route.url, remainingAttempts: 16)
        case .failure(let error):
          NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.threadRouteFailed", [
            "error": error.localizedDescription,
            "reason": reason,
            "sessionId": sessionId,
            "url": url.absoluteString,
            "workspaceRoot": session.workspaceRoot ?? NSNull(),
          ])
          if self.retryT3ThreadRouteIfStartupIsStillSettling(
            sessionId: sessionId,
            url: url,
            error: error
          ) {
            return
          }
          self.loadWebPaneError(session: session, message: error.localizedDescription)
        }
      }
    }
  }

  private static func browserPaneURLRequest(url: URL, reason: String) -> URLRequest {
    /**
     CDXC:BrowserPanes 2026-05-03-02:18
     Browser panes set a Safari-compatible WebKit UA, but sites can still get a
     stale disk-cached document from an older bare-WKWebView UA on app restore.
     Bypass only the local cache for initial browser-pane navigations so the
     first visible load receives markup for the current UA; user reloads and
     in-page navigations keep normal browser cache semantics.
     */
    let cachePolicy: URLRequest.CachePolicy =
      reason == "initial" ? .reloadIgnoringLocalCacheData : .useProtocolCachePolicy
    return URLRequest(url: url, cachePolicy: cachePolicy, timeoutInterval: 60)
  }

  private func retryT3ThreadRouteIfStartupIsStillSettling(
    sessionId: String,
    url: URL,
    error: Error
  ) -> Bool {
    guard NativeT3RuntimeLauncher.isManagedRuntimeURL(url) else {
      return false
    }
    let message = error.localizedDescription
    guard Self.isTransientT3ThreadRouteError(message) else {
      return false
    }
    let attempt = (t3ThreadRouteRetryAttemptsBySessionId[sessionId] ?? 0) + 1
    guard attempt <= 80 else {
      t3ThreadRouteRetryAttemptsBySessionId.removeValue(forKey: sessionId)
      NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.threadRouteRetry.exhausted", [
        "attempt": attempt,
        "error": message,
        "sessionId": sessionId,
        "url": url.absoluteString,
      ])
      return false
    }
    t3ThreadRouteRetryAttemptsBySessionId[sessionId] = attempt
    /**
     CDXC:T3Code 2026-05-02-00:55
     The native T3 pane must not paint a permanent error while the forked
     desktop server is still warming its embed API surface. During startup the
     listener can return 404 for auth/environment endpoints before the same
     process becomes ready; retry route resolution so users see the T3 Code app
     once the real APIs are available instead of a blank or white pane.
     */
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.load.threadRouteRetry.scheduled", [
      "attempt": attempt,
      "error": message,
      "sessionId": sessionId,
      "url": url.absoluteString,
    ])
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      guard self?.webPaneSessions[sessionId] != nil else {
        return
      }
      self?.loadWebPane(sessionId: sessionId, url: url, reason: "threadRouteRetry")
    }
    return true
  }

  private static func isTransientT3ThreadRouteError(_ message: String) -> Bool {
    message.contains("Could not connect to the server")
      || message.contains("timed out")
      || message.contains("returned 404")
      || message.contains("returned 503")
  }

  private func loadWebPaneStatus(
    sessionId: String,
    title: String,
    message: String,
    caption: String?,
    loading: Bool,
    reason: String
  ) {
    guard let session = webPaneSessions[sessionId] else {
      return
    }
    /**
     CDXC:T3Code 2026-05-02-03:16
     Native T3 panes spend startup time authenticating and resolving the
     managed thread route before the real app URL can load. Show the same
     embedded-workspace loading surface as the webview implementation so users
     do not see an empty gray WKWebView while startup is still valid work.
     */
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.status.load", [
      "loading": loading,
      "message": message,
      "reason": reason,
      "sessionId": sessionId,
    ])
    session.webView?.loadHTMLString(
      Self.t3WebPaneStatusHtml(title: title, message: message, caption: caption, loading: loading),
      baseURL: nil
    )
  }

  private static func t3WebPaneStatusHtml(
    title: String,
    message: String,
    caption: String?,
    loading: Bool
  ) -> String {
    let escapedTitle = escapeHtmlText(title.isEmpty ? "T3 Code" : title)
    let escapedMessage = escapeHtmlText(message)
    let escapedCaption = caption.map(escapeHtmlText)
    let spinnerHtml = loading ? #"<div class="spinner" aria-hidden="true"></div>"# : ""
    let captionHtml = escapedCaption.map { #"<div class="caption">\#($0)</div>"# } ?? ""

    return """
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>\(escapedTitle)</title>
          <style>
            html, body {
              background: #101722;
              color: #d8e1ee;
              font-family: ui-sans-serif, system-ui, sans-serif;
              height: 100%;
              margin: 0;
            }

            body {
              align-items: center;
              display: flex;
              justify-content: center;
              padding: 24px;
            }

            .status {
              align-items: center;
              color: #d8e1ee;
              display: flex;
              flex-direction: column;
              font-size: 14px;
              gap: 10px;
              letter-spacing: 0.02em;
              opacity: 0.86;
              text-align: center;
            }

            .spinner {
              animation: spin 0.9s linear infinite;
              border: 2px solid rgba(216, 225, 238, 0.18);
              border-radius: 999px;
              border-top-color: rgba(216, 225, 238, 0.95);
              height: 18px;
              width: 18px;
            }

            .caption {
              font-size: 12px;
              opacity: 0.66;
            }

            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="status">
            \(spinnerHtml)
            <div>\(escapedMessage)</div>
            \(captionHtml)
          </div>
        </body>
      </html>
      """
  }

  private func loadWebPaneError(session: WebPaneSession, message: String) {
    let escaped = Self.escapeHtmlText(message)
    session.webView?.loadHTMLString(
      """
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { margin: 0; background: #1f1f1f; color: #f5f5f5; font: 13px -apple-system, BlinkMacSystemFont, sans-serif; }
            main { padding: 24px; }
            pre { white-space: pre-wrap; color: #ffb4ab; }
          </style>
        </head>
        <body><main><h1>T3 Code failed to open</h1><pre>\(escaped)</pre></main></body>
      </html>
      """,
      baseURL: nil
    )
  }

  private static func escapeHtmlText(_ value: String) -> String {
    value
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
  }

  private func sessionId(for webView: WKWebView) -> String? {
    webPaneSessions.first { _, session in
      session.webView.map { $0 === webView } ?? false
    }?.key
  }

  private func updateWebPanePageMetadata(for webView: WKWebView, reason: String) {
    guard let sessionId = sessionId(for: webView),
      let session = webPaneSessions[sessionId],
      !session.isManagedT3Pane
    else {
      return
    }

    let displayTitle = webPaneDisplayTitle(for: webView, fallbackTitle: session.title)
    session.titleBarView.setTitle(normalizedTerminalSessionTitle(displayTitle, sessionId: sessionId))
    sendEvent(
      .terminalTitleChanged(
        sessionId: sessionId,
        title: displayTitle,
        sessionPersistenceName: nil))
    if let url = webView.url?.absoluteString, !url.isEmpty {
      /**
       CDXC:BrowserPanes 2026-05-03-03:41
       Browser pane restore must use the real committed WKWebView URL, not the
       initial local wrapper URL used to create the pane. Persist URL changes
       alongside title metadata so quitting and reopening zmux restores the
       same page the user was viewing.
       */
      sendEvent(.browserUrlChanged(sessionId: sessionId, url: url))
    }
    updateWebPaneFavicon(for: session, pageURL: webView.url, reason: reason)
    NativeT3CodePaneReproLog.append("nativeWorkspace.browserPane.metadata.updated", [
      "reason": reason,
      "sessionId": sessionId,
      "title": displayTitle,
      "url": webView.url?.absoluteString ?? NSNull(),
    ])
  }

  private func webPaneDisplayTitle(for webView: WKWebView, fallbackTitle: String) -> String {
    let title = webView.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !title.isEmpty {
      return title
    }
    if let host = webView.url?.host, !host.isEmpty {
      return host
    }
    let fallback = fallbackTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    return fallback.isEmpty ? "Browser" : fallback
  }

  private func updateWebPaneFavicon(for session: WebPaneSession, pageURL: URL?, reason: String) {
    guard let pageURL,
      pageURL.scheme == "http" || pageURL.scheme == "https"
    else {
      session.titleBarView.setFavicon(nil)
      sendEvent(.browserFaviconChanged(sessionId: session.sessionId, faviconDataUrl: nil))
      return
    }

    let sessionId = session.sessionId
    guard let webView = session.webView else {
      return
    }
    webPaneFaviconTasksBySessionId.removeValue(forKey: sessionId)?.cancel()
    webPaneFaviconTasksBySessionId[sessionId] = Task { @MainActor in
      guard self.webPaneSessions[sessionId]?.webView === webView else { return }
      let faviconURL = await self.faviconURL(for: webView, pageURL: pageURL)
      guard !Task.isCancelled, let faviconURL else {
        session.titleBarView.setFavicon(nil)
        self.sendEvent(.browserFaviconChanged(sessionId: sessionId, faviconDataUrl: nil))
        return
      }
      do {
        let (data, response) = try await URLSession.shared.data(from: faviconURL)
        guard !Task.isCancelled,
          let image = NSImage(data: data),
          self.webPaneSessions[sessionId]?.webView?.url?.host == pageURL.host
        else {
          return
        }
        session.titleBarView.setFavicon(image)
        let mimeType =
          (response as? HTTPURLResponse)?.mimeType
          ?? response.mimeType
          ?? Self.faviconMimeType(for: faviconURL)
        /**
         CDXC:BrowserPanes 2026-05-03-11:28
         The sidebar browser card should show the same tab favicon as the
         native browser pane title bar. Send the resolved favicon as a data URL
         so React can render it without re-fetching from the page origin, and
         so the browser session can persist the icon for app restore.
         */
        self.sendEvent(
          .browserFaviconChanged(
            sessionId: sessionId,
            faviconDataUrl: Self.dataUrl(for: data, mimeType: mimeType)))
        NativeT3CodePaneReproLog.append("nativeWorkspace.browserPane.favicon.updated", [
          "faviconUrl": faviconURL.absoluteString,
          "reason": reason,
          "sessionId": sessionId,
        ])
      } catch {
        session.titleBarView.setFavicon(nil)
        self.sendEvent(.browserFaviconChanged(sessionId: sessionId, faviconDataUrl: nil))
        NativeT3CodePaneReproLog.append("nativeWorkspace.browserPane.favicon.failed", [
          "error": error.localizedDescription,
          "faviconUrl": faviconURL.absoluteString,
          "reason": reason,
          "sessionId": sessionId,
        ])
      }
    }
  }

  private func faviconURL(for webView: WKWebView, pageURL: URL) async -> URL? {
    let script = """
      (() => {
        const links = Array.from(document.querySelectorAll('link[rel]'));
        const icon = links.find((link) => /(^|\\s)(icon|shortcut icon|apple-touch-icon|mask-icon)(\\s|$)/i.test(link.rel || ''));
        return icon?.href || '';
      })()
      """
    if let href = try? await webView.evaluateJavaScript(script) as? String,
      let resolved = resolvedFaviconURL(href: href, pageURL: pageURL)
    {
      return resolved
    }
    return fallbackFaviconURL(for: pageURL)
  }

  private func updateChromiumWebPaneMetadata(
    sessionId: String,
    title: String?,
    url: String?,
    reason: String
  ) {
    guard let session = webPaneSessions[sessionId], !session.isManagedT3Pane else {
      return
    }
    let displayTitle = chromiumWebPaneDisplayTitle(title: title, url: url, fallbackTitle: session.title)
    session.titleBarView.setTitle(normalizedTerminalSessionTitle(displayTitle, sessionId: sessionId))
    /**
     CDXC:BrowserPanes 2026-05-05-19:47
     Chromium browser panes emit title changes through the shared native title
     event, but they do not have terminal persistence names. Pass nil
     explicitly so the typed host event contract stays complete.
     */
    sendEvent(
      .terminalTitleChanged(
        sessionId: sessionId,
        title: displayTitle,
        sessionPersistenceName: nil))
    if let url, !url.isEmpty {
      sendEvent(.browserUrlChanged(sessionId: sessionId, url: url))
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.chromiumBrowserPane.metadata.updated", [
      "reason": reason,
      "sessionId": sessionId,
      "title": displayTitle,
      "url": url ?? NSNull(),
    ])
  }

  private func chromiumWebPaneDisplayTitle(title: String?, url: String?, fallbackTitle: String) -> String {
    let trimmedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !trimmedTitle.isEmpty {
      return trimmedTitle
    }
    if let url, let host = URL(string: url)?.host, !host.isEmpty {
      return host
    }
    let fallback = fallbackTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    return fallback.isEmpty ? "Browser" : fallback
  }

  private func updateChromiumWebPaneFavicon(sessionId: String, faviconURL: URL?, reason: String) {
    guard let session = webPaneSessions[sessionId] else {
      return
    }
    guard let faviconURL, faviconURL.scheme == "http" || faviconURL.scheme == "https" else {
      session.titleBarView.setFavicon(nil)
      sendEvent(.browserFaviconChanged(sessionId: sessionId, faviconDataUrl: nil))
      return
    }
    let expectedHost = URL(string: session.currentURLString ?? "")?.host
    webPaneFaviconTasksBySessionId.removeValue(forKey: sessionId)?.cancel()
    webPaneFaviconTasksBySessionId[sessionId] = Task { @MainActor in
      do {
        let (data, response) = try await URLSession.shared.data(from: faviconURL)
        guard !Task.isCancelled,
          let image = NSImage(data: data),
          self.webPaneSessions[sessionId]?.chromiumView != nil,
          expectedHost == nil || URL(string: self.webPaneSessions[sessionId]?.currentURLString ?? "")?.host == expectedHost
        else {
          return
        }
        session.titleBarView.setFavicon(image)
        let mimeType =
          (response as? HTTPURLResponse)?.mimeType
          ?? response.mimeType
          ?? Self.faviconMimeType(for: faviconURL)
        self.sendEvent(
          .browserFaviconChanged(
            sessionId: sessionId,
            faviconDataUrl: Self.dataUrl(for: data, mimeType: mimeType)))
        NativeT3CodePaneReproLog.append("nativeWorkspace.chromiumBrowserPane.favicon.updated", [
          "faviconUrl": faviconURL.absoluteString,
          "reason": reason,
          "sessionId": sessionId,
        ])
      } catch {
        session.titleBarView.setFavicon(nil)
        self.sendEvent(.browserFaviconChanged(sessionId: sessionId, faviconDataUrl: nil))
        NativeT3CodePaneReproLog.append("nativeWorkspace.chromiumBrowserPane.favicon.failed", [
          "error": error.localizedDescription,
          "faviconUrl": faviconURL.absoluteString,
          "reason": reason,
          "sessionId": sessionId,
        ])
      }
    }
  }

  private func resolvedFaviconURL(href: String, pageURL: URL) -> URL? {
    let trimmedHref = href.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedHref.isEmpty else {
      return nil
    }
    return URL(string: trimmedHref, relativeTo: pageURL)?.absoluteURL
  }

  private func fallbackFaviconURL(for pageURL: URL) -> URL? {
    guard let scheme = pageURL.scheme,
      scheme == "http" || scheme == "https",
      let host = pageURL.host
    else {
      return nil
    }
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.port = pageURL.port
    components.path = "/favicon.ico"
    return components.url
  }

  private static func dataUrl(for data: Data, mimeType: String?) -> String {
    "data:\(mimeType ?? "image/png");base64,\(data.base64EncodedString())"
  }

  private static func faviconMimeType(for url: URL) -> String {
    switch url.pathExtension.lowercased() {
    case "ico":
      return "image/x-icon"
    case "svg":
      return "image/svg+xml"
    case "jpg", "jpeg":
      return "image/jpeg"
    case "webp":
      return "image/webp"
    default:
      return "image/png"
    }
  }

  /**
   CDXC:T3Code 2026-04-30-15:42
   Native T3 panes must install the same desktop bridge contract before the T3
   bundle runs. Directly loading `/{projectId}/{threadId}` without this bridge
   leaves the React route waiting for environment bootstrap and the pane remains
   on the gray boot shell even though WK navigation finishes successfully.
   */
  private static func t3WebPaneBridgeScript(
    sessionId: String, title: String, workspaceRoot: String?
  ) -> String {
    let encodedSessionId = javascriptStringLiteral(sessionId)
    let encodedTitle = javascriptStringLiteral(title.isEmpty ? "T3 Code" : title)
    let encodedWorkspaceRoot = javascriptStringLiteral(workspaceRoot ?? "")
    return """
      (() => {
        const isManagedT3Origin = () => {
          try {
            return location.protocol === "http:" &&
              (location.hostname === "127.0.0.1" || location.hostname === "localhost") &&
              location.port === "3774";
          } catch {
            return false;
          }
        };
        if (!isManagedT3Origin()) {
          return;
        }
        const sessionId = \(encodedSessionId);
        const sessionTitle = \(encodedTitle);
        const workspaceRoot = \(encodedWorkspaceRoot);
        const handler = window.webkit?.messageHandlers?.\(T3CodePaneDiagnosticsBridge.messageHandlerName);
        const threadIdFromPath = () => {
          const parts = location.pathname.split("/").filter(Boolean);
          return parts.length >= 2 ? parts[1] : "";
        };
        const wsUrl = () => `${location.origin.replace(/^http/i, "ws")}/ws`;
        const currentThreadId = () => threadIdFromPath();
        let lastReportedThreadId = "";
        let lastReportedThreadTitle = "";
        const normalizeThreadTitle = (value) =>
          typeof value === "string" ? value.replace(/\\s+/g, " ").trim() : "";
        const isUsableThreadTitle = (value) => {
          const title = normalizeThreadTitle(value);
          if (!title) {
            return false;
          }
          const lower = title.toLowerCase();
          return lower !== "t3 code" &&
            lower !== "t3 code (alpha)" &&
            lower !== "no active thread" &&
            lower !== "pick a thread to continue";
        };
        const visibleThreadTitle = () => {
          const candidates = [
            window.__VSMUX_T3_ACTIVE_THREAD_TITLE__,
            document.querySelector("header h2[title]")?.getAttribute("title"),
            document.querySelector("header h2")?.textContent,
            document.querySelector("header [title]")?.getAttribute("title")
          ];
          for (const candidate of candidates) {
            if (isUsableThreadTitle(candidate)) {
              return normalizeThreadTitle(candidate);
            }
          }
          return "";
        };
        const reportThreadChange = (payload, reason) => {
          const threadId = String(payload?.threadId || "").trim();
          const title =
            (isUsableThreadTitle(payload?.title) ? normalizeThreadTitle(payload?.title) : "") ||
            visibleThreadTitle() ||
            String(document.title || "");
          const normalizedTitle = normalizeThreadTitle(title);
          if (
            !threadId ||
            (threadId === lastReportedThreadId && normalizedTitle === lastReportedThreadTitle)
          ) {
            return;
          }
          lastReportedThreadId = threadId;
          lastReportedThreadTitle = normalizedTitle;
          try {
            handler?.postMessage({
              href: String(location.href || ""),
              reason,
              threadId,
              title,
              type: "thread-changed"
            });
          } catch {}
        };
        /**
         * CDXC:T3Code 2026-05-04-03:06
         * The embedded T3 app performs client-side thread navigation, so native
         * zmux must observe route changes inside the WKWebView and let the
         * sidebar preserve one zmux card per T3 thread instead of silently
         * rebinding the currently visible card.
         *
         * CDXC:T3Code 2026-05-04-04:03
         * T3's own sidebar emits `vsmuxT3ThreadChanged` via postMessage when a
         * user clicks another thread. WKWebView hosts the app as the top-level
         * page, so the bridge listens for that same-window message in addition
         * to URL/history changes; sidebar-thread clicks must create/focus a
         * sibling zmux card just like route changes.
         *
         * CDXC:T3Code 2026-05-04-04:41
         * Thread titles can arrive after the route/thread id event. De-dupe by
         * thread id plus normalized title so later same-thread title updates
         * still reach the sidebar card title sync path.
         *
         * CDXC:T3Code 2026-05-04-06:23
         * The title shown in the T3 header is the user-facing thread title. Use
         * T3's `__VSMUX_T3_ACTIVE_THREAD_TITLE__` bridge value and the visible
         * header `<h2>` as title sources because `document.title` remains the
         * generic app label and early postMessage payloads may omit the title.
         */
        const reportActiveThread = (reason) => {
          const threadId = currentThreadId();
          reportThreadChange({ threadId, title: document.title }, reason);
        };
        window.addEventListener("message", (event) => {
          const data = event?.data;
          if (!data || typeof data !== "object" || data.type !== "vsmuxT3ThreadChanged") {
            return;
          }
          reportThreadChange(data, "vsmux-message");
        });
        const wrapHistoryMethod = (method) => {
          const original = history[method];
          if (typeof original !== "function") {
            return;
          }
          history[method] = function(...args) {
            const result = original.apply(this, args);
            setTimeout(() => reportActiveThread(method), 0);
            return result;
          };
        };
        wrapHistoryMethod("pushState");
        wrapHistoryMethod("replaceState");
        window.addEventListener("popstate", () => setTimeout(() => reportActiveThread("popstate"), 0));
        window.addEventListener("hashchange", () => setTimeout(() => reportActiveThread("hashchange"), 0));
        setTimeout(() => reportActiveThread("bootstrap"), 0);
        setInterval(() => reportActiveThread("poll"), 1000);
        window.__VSMUX_T3_ACTIVE_THREAD_ID__ = currentThreadId();
        window.__VSMUX_T3_COMPOSER_FOCUS_ENABLED__ = false;
        window.__VSMUX_T3_BOOTSTRAP__ = {
          embedMode: "vsmux-mobile",
          httpOrigin: location.origin,
          sessionId,
          threadId: currentThreadId(),
          workspaceRoot,
          wsUrl: wsUrl()
        };
        const serverExposureState = {
          advertisedHost: null,
          endpointUrl: null,
          mode: "local-only"
        };
        const updateState = {
          canRetry: false,
          checkedAt: null,
          checkedVersion: null,
          downloadPercent: null,
          downloadedVersion: null,
          errorContext: null,
          message: null,
          phase: "idle"
        };
        window.desktopBridge = {
          browser: {
            close: async () => null,
            closeTab: async () => null,
            getState: async (input) => ({
              activeTabId: null,
              lastError: null,
              open: false,
              tabs: [],
              threadId: input?.threadId ?? currentThreadId()
            }),
            goBack: async () => null,
            goForward: async () => null,
            hide: async () => undefined,
            navigate: async () => null,
            newTab: async () => null,
            onState: () => () => undefined,
            open: async () => null,
            openDevTools: async () => undefined,
            reload: async () => null,
            selectTab: async () => null,
            setPanelBounds: async () => null
          },
          confirm: async (message) => window.confirm(String(message)),
          getClientSettings: async () => null,
          getLocalEnvironmentBootstrap: () => ({
            bootstrapToken: "",
            httpBaseUrl: location.origin,
            label: sessionTitle || "T3 Code",
            wsBaseUrl: wsUrl()
          }),
          getWsUrl: () => wsUrl(),
          getSavedEnvironmentRegistry: async () => [],
          getSavedEnvironmentSecret: async () => null,
          getServerExposureState: async () => serverExposureState,
          notifications: {
            isSupported: async () => false,
            show: async () => false
          },
          getUpdateState: async () => updateState,
          installUpdate: async () => ({ accepted: false, completed: false, state: updateState }),
          checkForUpdate: async () => ({ checked: false, state: updateState }),
          downloadUpdate: async () => ({ accepted: false, completed: false, state: updateState }),
          onMenuAction: () => () => undefined,
          onUpdateState: () => () => undefined,
          openExternal: async (url) => {
            try {
              window.open(String(url), "_blank", "noopener,noreferrer");
              return true;
            } catch {
              return false;
            }
          },
          pickFolder: async () => null,
          removeSavedEnvironmentSecret: async () => undefined,
          setClientSettings: async () => undefined,
          setSavedEnvironmentRegistry: async () => undefined,
          setSavedEnvironmentSecret: async () => false,
          setServerExposureMode: async () => serverExposureState,
          setTheme: async () => undefined,
          showContextMenu: async () => null
        };
      })();
      """
  }

  private static func javascriptStringLiteral(_ value: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
      let json = String(data: data, encoding: .utf8),
      json.hasPrefix("["),
      json.hasSuffix("]")
    else {
      return "\"\""
    }
    return String(json.dropFirst().dropLast())
  }

  private static func cefDragHoverBridgeScript(
    x: CGFloat,
    y: CGFloat,
    phase: String,
    sourceX: CGFloat?,
    sourceY: CGFloat?
  ) -> String {
    let xLiteral = String(format: "%.2f", Double(x))
    let yLiteral = String(format: "%.2f", Double(y))
    let phaseLiteral = javascriptStringLiteral(phase)
    let sourceXLiteral = sourceX.map { String(format: "%.2f", Double($0)) } ?? "null"
    let sourceYLiteral = sourceY.map { String(format: "%.2f", Double($0)) } ?? "null"
    return """
      (() => {
        const x = \(xLiteral);
        const y = \(yLiteral);
        const phase = \(phaseLiteral);
        const sourceX = \(sourceXLiteral);
        const sourceY = \(sourceYLiteral);
        const bridge = window.__zmuxCEFDragHoverBridge ||= {
          dataTransfer: null,
          lastTarget: null,
          sourceTarget: null
        };
        const stableTargetSelectors = [
          ".pane",
          ".composite",
          ".part.sidebar",
          ".part.activitybar",
          ".monaco-list-row",
          ".monaco-list",
          ".action-item",
          "[role='treeitem']",
          "[draggable='true']"
        ];
        const sourceTargetSelectors = [
          "[draggable='true']",
          ".pane-header",
          ".action-item",
          ".monaco-list-row",
          ".pane"
        ];
        const asElement = (node) => node instanceof Element ? node : node?.parentElement || null;
        const closestByPriority = (element, selectors) => {
          for (const selector of selectors) {
            const match = element.closest(selector);
            if (match) {
              return match;
            }
          }
          return null;
        };
        const stableTargetFor = (rawTarget, selectors = stableTargetSelectors) => {
          const element = asElement(rawTarget);
          if (!element) {
            return null;
          }
          return closestByPriority(element, selectors) || element;
        };
        const makeDataTransfer = () => {
          if (bridge.dataTransfer) {
            return bridge.dataTransfer;
          }
          try {
            bridge.dataTransfer = new DataTransfer();
            try {
              bridge.dataTransfer.effectAllowed = "move";
              bridge.dataTransfer.dropEffect = "move";
            } catch {}
            return bridge.dataTransfer;
          } catch {
            return null;
          }
        };
        const dispatchDragEvent = (target, type) => {
          if (!target) {
            return false;
          }
          const dataTransfer = makeDataTransfer();
          const init = {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            composed: true,
            dataTransfer,
            screenX: window.screenX + x,
            screenY: window.screenY + y,
            view: window
          };
          let event;
          try {
            event = new DragEvent(type, init);
          } catch {
            event = document.createEvent("DragEvent");
            event.initMouseEvent(type, true, true, window, 0, 0, 0, x, y, false, false, false, false, 0, null);
          }
          return target.dispatchEvent(event);
        };
        if (phase === "cancel") {
          dispatchDragEvent(bridge.lastTarget, "dragleave");
          dispatchDragEvent(bridge.sourceTarget || bridge.lastTarget, "dragend");
          bridge.lastTarget = null;
          bridge.sourceTarget = null;
          bridge.dataTransfer = null;
          return;
        }
        const target = document.elementFromPoint(x, y);
        const stableTarget = stableTargetFor(target);
        if (!stableTarget) {
          return;
        }
        if (phase === "start") {
          const sourceTarget = sourceX === null || sourceY === null ? null : document.elementFromPoint(sourceX, sourceY);
          bridge.sourceTarget = stableTargetFor(sourceTarget, sourceTargetSelectors) || stableTarget;
        }
        if (bridge.lastTarget !== stableTarget) {
          dispatchDragEvent(bridge.lastTarget, "dragleave");
          dispatchDragEvent(stableTarget, "dragenter");
          bridge.lastTarget = stableTarget;
        }
        dispatchDragEvent(stableTarget, "dragover");
        if (phase === "drop") {
          dispatchDragEvent(stableTarget, "drop");
          dispatchDragEvent(bridge.sourceTarget || stableTarget, "dragend");
          bridge.lastTarget = null;
          bridge.sourceTarget = null;
          bridge.dataTransfer = null;
        }
      })();
      """
  }

  private static let t3WebPaneDiagnosticsScript = """
    (() => {
      const handler = window.webkit?.messageHandlers?.\(T3CodePaneDiagnosticsBridge.messageHandlerName);
      if (!handler) {
        return;
      }
      const summarize = (value) => {
        try {
          if (value instanceof Error) {
            return value.stack || value.message || String(value);
          }
          if (typeof value === "object" && value !== null) {
            return JSON.stringify(value);
          }
          return String(value);
        } catch {
          return String(value);
        }
      };
      const post = (payload) => {
        try {
          handler.postMessage({
            href: String(location.href || ""),
            readyState: String(document.readyState || ""),
            timestamp: new Date().toISOString(),
            ...payload
          });
        } catch {}
      };
      window.addEventListener("error", (event) => {
        const target = event.target;
        const isResourceError = target && target !== window;
        post({
          column: event.colno || 0,
          line: event.lineno || 0,
          message: String(event.message || ""),
          resourceHref: isResourceError ? String(target.src || target.href || "") : "",
          source: String(event.filename || ""),
          stack: event.error && event.error.stack ? String(event.error.stack) : "",
          type: isResourceError ? "resource-error" : "error"
        });
      }, true);
      window.addEventListener("unhandledrejection", (event) => {
        post({
          message: summarize(event.reason),
          stack: event.reason && event.reason.stack ? String(event.reason.stack) : "",
          type: "unhandledrejection"
        });
      });
      for (const method of ["error", "warn"]) {
        const original = console[method]?.bind(console);
        console[method] = (...args) => {
          post({ message: args.map(summarize).join(" "), type: `console.${method}` });
          original?.(...args);
        };
      }
      post({ type: "diagnostics-ready" });
    })();
    """

  private func searchBarFrame(in terminalRect: CGRect) -> CGRect {
    let width = min(CGFloat(300), max(terminalRect.width - 16, 180))
    let height = CGFloat(34)
    return CGRect(
      x: terminalRect.maxX - width - 8,
      y: terminalRect.maxY - height - 8,
      width: width,
      height: height
    )
  }

  private func logTerminalResizeIfNeeded(
    session: TerminalSession,
    paneRect: CGRect,
    titleBarRect: CGRect,
    availableTerminalRect: CGRect,
    terminalRect: CGRect
  ) {
    /**
     CDXC:NativeTerminalResize 2026-04-29-02:22
     Narrow-pane Claude Code rendering regressions need geometry diagnostics
     from every native resize layer. Log only changed signatures so PTY size,
     Ghostty surface size, scroll content size, and visible pane dimensions can
     be compared without flooding the app log during no-op layout passes.
     */
    let nestedScrollView = firstNestedScrollView(in: session.scrollView)
    let publishedSurfaceSize = session.view.surfaceSize
    let surfaceSize = session.view.surface.map { ghostty_surface_size($0) } ?? publishedSurfaceSize
    let surfacePadding = session.view.surface.map { ghostty_surface_padding($0) }
    let cellSize = session.view.cellSize
    let estimatedColumns =
      cellSize.width > 0 ? Int(floor(terminalRect.width / cellSize.width)) : nil
    let estimatedRows =
      cellSize.height > 0 ? Int(floor(terminalRect.height / cellSize.height)) : nil
    /**
     CDXC:NativeTerminalResize 2026-04-29-07:50
     Claude Code/Ink rerenders from the PTY rows and columns that Ghostty
     reports after subtracting terminal padding. Log synchronous core size,
     published AppKit size, backing-pixel metrics, actual Ghostty padding, and
     residual non-grid space so resize bugs can distinguish stale Swift state
     from Ghostty grid math.
     */
    let coreSurfaceSize = surfaceSize.map { size in
      session.view.convertFromBacking(
        NSSize(width: Double(size.width_px), height: Double(size.height_px)))
    }
    let inferredHorizontalPaddingPx = surfaceSize.map {
      Int($0.width_px) - Int($0.columns) * Int($0.cell_width_px)
    }
    let inferredVerticalPaddingPx = surfaceSize.map {
      Int($0.height_px) - Int($0.rows) * Int($0.cell_height_px)
    }
    let inferredPadding = inferredPaddingPoints(
      view: session.view,
      horizontalPx: inferredHorizontalPaddingPx,
      verticalPx: inferredVerticalPaddingPx)
    let actualPadding = actualPaddingPoints(view: session.view, padding: surfacePadding)
    let paddingAwareEstimatedColumns = paddingAwareEstimatedCellCount(
      available: terminalRect.width,
      padding: actualPadding?.width,
      cell: cellSize.width)
    let paddingAwareEstimatedRows = paddingAwareEstimatedCellCount(
      available: terminalRect.height,
      padding: actualPadding?.height,
      cell: cellSize.height)
    let signature = [
      roundedSignature(paneRect.size.width),
      roundedSignature(paneRect.size.height),
      roundedSignature(terminalRect.size.width),
      roundedSignature(terminalRect.size.height),
      roundedSignature(session.scrollView.bounds.size.width),
      roundedSignature(session.scrollView.bounds.size.height),
      roundedSignature(session.view.frame.size.width),
      roundedSignature(session.view.frame.size.height),
      String(surfaceSize?.columns ?? 0),
      String(surfaceSize?.rows ?? 0),
      String(estimatedColumns ?? 0),
      String(estimatedRows ?? 0),
      String(paddingAwareEstimatedColumns ?? 0),
      String(paddingAwareEstimatedRows ?? 0),
      String(surfaceSize?.width_px ?? 0),
      String(surfaceSize?.height_px ?? 0),
    ].joined(separator: "x")
    if resizeLogSignatureBySessionId[session.sessionId] == signature {
      return
    }
    resizeLogSignatureBySessionId[session.sessionId] = signature
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.terminalResize",
      details: [
        "cellSize": describeSize(cellSize),
        "coreSurfaceSizeLogical": coreSurfaceSize.map { describeSize($0) } ?? NSNull(),
        "coreSurfaceSizePixels": surfaceSize.map {
          ["height": Int($0.height_px), "width": Int($0.width_px)]
        } ?? NSNull(),
        "coreSurfaceCellSizePixels": surfaceSize.map {
          ["height": Int($0.cell_height_px), "width": Int($0.cell_width_px)]
        } ?? NSNull(),
        "coreSurfaceGridSizePixels": surfaceSize.map {
          [
            "height": Int($0.rows) * Int($0.cell_height_px),
            "width": Int($0.columns) * Int($0.cell_width_px),
          ]
        } ?? NSNull(),
        "estimatedColumns": nullableInt(estimatedColumns),
        "estimatedRows": nullableInt(estimatedRows),
        "focusedSessionId": nullableString(focusedSessionId),
        "inferredPaddingPixels": inferredHorizontalPaddingPx.map { horizontal in
          [
            "horizontal": horizontal,
            "vertical": inferredVerticalPaddingPx ?? 0,
          ]
        } ?? NSNull(),
        "inferredPaddingPoints": inferredPadding.map { describeSize($0) } ?? NSNull(),
        "surfacePaddingPixels": surfacePadding.map {
          [
            "bottom": Int($0.bottom_px),
            "left": Int($0.left_px),
            "right": Int($0.right_px),
            "top": Int($0.top_px),
          ]
        } ?? NSNull(),
        "surfacePaddingPoints": actualPadding.map { describeSize($0) } ?? NSNull(),
        "nestedScrollContentSize": nestedScrollView.map { describeSize($0.contentSize) }
          ?? NSNull(),
        "nestedScrollDocumentVisibleRect": nestedScrollView.map {
          describeFrame($0.contentView.documentVisibleRect)
        } ?? NSNull(),
        "paneGap": Double(paneGap),
        "paneRect": describeFrame(paneRect),
        "paddingAwareEstimatedColumns": nullableInt(paddingAwareEstimatedColumns),
        "paddingAwareEstimatedRows": nullableInt(paddingAwareEstimatedRows),
        "publishedSurfaceSizeColumns": publishedSurfaceSize.map { Int($0.columns) } ?? NSNull(),
        "publishedSurfaceSizeRows": publishedSurfaceSize.map { Int($0.rows) } ?? NSNull(),
        "rawTerminalRect": describeFrame(availableTerminalRect),
        "scrollViewBounds": describeFrame(session.scrollView.bounds),
        "scrollViewFrame": describeFrame(session.scrollView.frame),
        "sessionId": session.sessionId,
        "surfaceFrame": describeFrame(session.view.frame),
        "surfaceSizeColumns": surfaceSize.map { Int($0.columns) } ?? NSNull(),
        "surfaceSizeRows": surfaceSize.map { Int($0.rows) } ?? NSNull(),
        "terminalRect": describeFrame(terminalRect),
        "titleBarRect": describeFrame(titleBarRect),
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
  }

  private func inferredPaddingPoints(
    view: NSView,
    horizontalPx: Int?,
    verticalPx: Int?
  ) -> NSSize? {
    guard let horizontalPx, let verticalPx else {
      return nil
    }
    let backingSize = NSSize(width: Double(horizontalPx), height: Double(verticalPx))
    return view.convertFromBacking(backingSize)
  }

  private func actualPaddingPoints(
    view: NSView,
    padding: ghostty_surface_padding_s?
  ) -> NSSize? {
    guard let padding else {
      return nil
    }
    let backingSize = NSSize(
      width: Double(padding.left_px + padding.right_px),
      height: Double(padding.top_px + padding.bottom_px))
    return view.convertFromBacking(backingSize)
  }

  private func paddingAwareEstimatedCellCount(
    available: CGFloat,
    padding: CGFloat?,
    cell: CGFloat
  ) -> Int? {
    guard let padding, cell > 0 else {
      return nil
    }
    return Int(floor(max(available - padding, 0) / cell))
  }

  private func firstNestedScrollView(in view: NSView) -> NSScrollView? {
    if let scrollView = view as? NSScrollView {
      return scrollView
    }
    for subview in view.subviews {
      if let scrollView = firstNestedScrollView(in: subview) {
        return scrollView
      }
    }
    return nil
  }

  private func roundedSignature(_ value: CGFloat) -> String {
    String(Int(value.rounded()))
  }

  private func nativeLayoutSignature(
    activeSessionIds: Set<String>,
    activeProjectEditorId: String?,
    layout: NativeTerminalLayout?,
    paneGap: CGFloat,
    poppedOutSessionIds: Set<String>
  ) -> String {
    [
      "active=\(activeSessionIds.sorted().joined(separator: ","))",
      "editor=\(activeProjectEditorId ?? "")",
      "gap=\(roundedSignature(paneGap * 100))",
      "layout=\(nativeLayoutNodeSignature(layout))",
      "popped=\(poppedOutSessionIds.sorted().joined(separator: ","))",
    ].joined(separator: "|")
  }

  private func nativeLayoutNodeSignature(_ layout: NativeTerminalLayout?) -> String {
    guard let layout else {
      return "none"
    }
    switch layout {
    case .leaf(let sessionId):
      return "leaf:\(sessionId)"
    case .tabs(let activeSessionId, let sessionIds):
      return "tabs:\(activeSessionId ?? "nil"):[\(sessionIds.joined(separator: ","))]"
    case .split(let direction, let ratio, let children):
      let ratioSignature = ratio.map { String(format: "%.5f", $0) } ?? "nil"
      return
        "split:\(direction.rawValue):\(ratioSignature):[\(children.map { nativeLayoutNodeSignature($0) }.joined(separator: ","))]"
    }
  }

  private func moveOffscreen(_ view: NSView) {
    let size =
      view.frame.size.width > 1 && view.frame.size.height > 1
      ? view.frame.size
      : bounds.size
    let nextFrame = CGRect(
      x: bounds.maxX + 10_000,
      y: bounds.maxY + 10_000,
      width: max(size.width, 1),
      height: max(size.height, 1)
    )
    if !rectsMatch(view.frame, nextFrame) {
      view.frame = nextFrame
    }
  }

  private func applyWorkspaceBackgroundColor(_ value: String?) {
    let nextValue = value ?? ""
    guard workspaceBackgroundColorValue != nextValue else {
      return
    }
    /**
     CDXC:NativeGpu 2026-05-08-16:45
     Passive metadata sync can arrive without a visual workspace change.
     Reassign the AppKit backing-layer color only when the configured value
     changes so repeated status updates do not dirty the whole workspace layer.
     */
    workspaceBackgroundColorValue = nextValue
    layer?.backgroundColor = Self.workspaceBackgroundColor(value).cgColor
  }

  private func setHidden(_ hidden: Bool, for view: NSView) {
    guard view.isHidden != hidden else {
      return
    }
    view.isHidden = hidden
  }

  private func updateAllTerminalBorders() {
    for sessionId in sessions.keys {
      updateTerminalBorder(for: sessionId)
    }
    for sessionId in webPaneSessions.keys {
      updateTerminalBorder(for: sessionId)
    }
  }

  private func updateTerminalBorder(for sessionId: String) {
    if let session = webPaneSessions[sessionId] {
      let isActive = activeSessionIds.contains(sessionId)
      setHidden(!isActive, for: session.hostView)
      setHidden(!isActive, for: session.titleBarView)
      setHidden(!isActive, for: session.borderView)
      session.titleBarView.setState(activity: sessionActivities[sessionId])
      session.titleBarView.setTabActivities(sessionActivities)
      session.titleBarView.setTabIdentityIcons(
        faviconDataUrls: sessionFaviconDataUrls,
        agentIconDataUrls: sessionAgentIconDataUrls,
        agentIconColors: sessionAgentIconColors)
      session.titleBarView.setFocusedPane(focusedSessionId == sessionId)
      session.borderView.setState(
        isFocused: shouldShowFocusedPaneBorder(for: sessionId),
        isAttention: attentionSessionIds.contains(sessionId)
      )
      return
    }

    guard let session = sessions[sessionId] else {
      return
    }
    let isActive = activeSessionIds.contains(sessionId)
    setHidden(!isActive, for: session.titleBarView)
    setHidden(!isActive || session.view.searchState == nil, for: session.searchBarView)
    setHidden(!isActive, for: session.borderView)
    session.titleBarView.setState(
      activity: sessionActivities[sessionId]
    )
    session.titleBarView.setTabActivities(sessionActivities)
    session.titleBarView.setTabIdentityIcons(
      faviconDataUrls: sessionFaviconDataUrls,
      agentIconDataUrls: sessionAgentIconDataUrls,
      agentIconColors: sessionAgentIconColors)
    session.titleBarView.setFocusedPane(focusedSessionId == sessionId)
    session.borderView.setState(
      isFocused: shouldShowFocusedPaneBorder(for: sessionId),
      isAttention: attentionSessionIds.contains(sessionId)
    )
  }

  private func shouldShowFocusedPaneBorder(for sessionId: String) -> Bool {
    /**
     CDXC:NativePaneResize 2026-05-11-09:48
     Focused pane borders were temporarily suppressed while diagnosing split
     resize misses from the focused pane side. That test did not change the
     failure, so keep the selected-pane border enabled and fix resize event
     ownership instead of hiding focus chrome.
     */
    focusedSessionId == sessionId && orderedVisibleSessionIds().count > 1
  }

  private func keyboardRouteDebugPayload(
    surfaceSessionId: String?,
    event: NSEvent? = nil
  ) -> [String: Any] {
    let responderSessionId = currentResponderSessionId()
    var mismatchTypes: [String] = []
    if let surfaceSessionId, let focusedSessionId, surfaceSessionId != focusedSessionId {
      mismatchTypes.append("surfaceSessionDiffersFromFocusRing")
    }
    if let responderSessionId, let focusedSessionId, responderSessionId != focusedSessionId {
      mismatchTypes.append("firstResponderDiffersFromFocusRing")
    }
    if let surfaceSessionId, let responderSessionId, surfaceSessionId != responderSessionId {
      mismatchTypes.append("surfaceSessionDiffersFromFirstResponder")
    }

    var payload: [String: Any] = [
      "activeProjectEditorId": nullableString(activeProjectEditorId),
      "activeSessionIds": Array(activeSessionIds).sorted(),
      "focusedSessionId": nullableString(focusedSessionId),
      "lastEmittedFocusedSessionId": nullableString(lastEmittedFocusedSessionId),
      "mismatchTypes": mismatchTypes,
      "poppedOutSessionIds": Array(poppedOutSessionIds).sorted(),
      "responder": responderSnapshot(),
      "responderMatchesFocusedSession": nullableBool(
        responderSessionId.flatMap { responder in focusedSessionId.map { responder == $0 } }),
      "responderSessionId": nullableString(responderSessionId),
      "surfaceMatchesFocusedSession": nullableBool(
        surfaceSessionId.flatMap { surface in focusedSessionId.map { surface == $0 } }),
      "surfaceMatchesResponderSession": nullableBool(
        surfaceSessionId.flatMap { surface in responderSessionId.map { surface == $0 } }),
      "surfaceSessionId": nullableString(surfaceSessionId),
      "visibleSessionIds": orderedVisibleSessionIds(),
      "windowIsKey": window?.isKeyWindow ?? false,
      "windowNumber": window?.windowNumber ?? 0,
    ]

    if let event {
      payload["charactersIgnoringModifiersLength"] = event.charactersIgnoringModifiers?.count ?? 0
      payload["charactersLength"] = event.characters?.count ?? 0
      payload["eventTimestamp"] = event.timestamp
      payload["eventWindowNumber"] = event.window?.windowNumber ?? 0
      payload["isARepeat"] = event.isARepeat
      payload["keyCode"] = Int(event.keyCode)
      payload["modifierFlags"] = Self.keyboardModifierNames(event.modifierFlags)
    }

    return payload
  }

  private func focusedSurfaceSessionIds() -> [String] {
    sessions.keys.sorted().compactMap { sessionId in
      guard sessions[sessionId]?.view.focused == true else {
        return nil
      }
      return sessionId
    }
  }

  private func focusSurfaceStateSnapshot() -> [[String: Any]] {
    sessions.keys.sorted().compactMap { sessionId in
      guard let session = sessions[sessionId] else {
        return nil
      }
      let surfaceWindow = session.view.window
      return [
        "borderFocused": shouldShowFocusedPaneBorder(for: sessionId),
        "frame": describeFrame(session.view.frame),
        "isActive": activeSessionIds.contains(sessionId),
        "isFirstResponder": surfaceWindow?.firstResponder === session.view,
        "isPoppedOut": poppedOutSessionIds.contains(sessionId),
        "scrollViewHidden": session.scrollView.isHidden,
        "sessionId": sessionId,
        "surfaceFocusedFlag": session.view.focused,
        "surfaceWindowIsKey": surfaceWindow?.isKeyWindow ?? false,
        "surfaceWindowNumber": surfaceWindow?.windowNumber ?? 0,
        "titleBarFocused": focusedSessionId == sessionId,
        "titleBarHidden": session.titleBarView.isHidden,
      ]
    }
  }

  private func logFocusSurfaceState(
    event: String,
    reason: String,
    details: [String: Any] = [:]
  ) {
    guard NativeDebugLogging.isEnabled else {
      return
    }
    let surfaceFocusIds = focusedSurfaceSessionIds()
    var payload = details
    /**
     CDXC:NativeTerminalStartupFocus 2026-05-11-12:31
     Startup focus repros need one snapshot that compares the sidebar-selected
     pane, AppKit first responder, and Ghostty's per-surface focused flag. Log
     this only through Debugging Mode so normal terminal startup remains quiet.
    */
    payload["activeSessionIds"] = Array(activeSessionIds).sorted()
    payload["focusedSessionId"] = nullableString(focusedSessionId)
    payload["focusedSurfaceCount"] = surfaceFocusIds.count
    payload["focusedSurfaceSessionIds"] = surfaceFocusIds
    payload["lastEmittedFocusedSessionId"] = nullableString(lastEmittedFocusedSessionId)
    payload["reason"] = reason
    payload["responder"] = responderSnapshot()
    payload["surfaces"] = focusSurfaceStateSnapshot()
    payload["visibleSessionIds"] = orderedVisibleSessionIds()
    payload["workspaceWindowIsKey"] = window?.isKeyWindow ?? false
    payload["workspaceWindowNumber"] = window?.windowNumber ?? 0
    TerminalFocusDebugLog.append(event: event, details: payload)
  }

  private static func keyboardModifierNames(_ flags: NSEvent.ModifierFlags) -> [String] {
    let normalizedFlags = flags.intersection(.deviceIndependentFlagsMask)
    var names: [String] = []
    if normalizedFlags.contains(.capsLock) {
      names.append("capsLock")
    }
    if normalizedFlags.contains(.shift) {
      names.append("shift")
    }
    if normalizedFlags.contains(.control) {
      names.append("control")
    }
    if normalizedFlags.contains(.option) {
      names.append("option")
    }
    if normalizedFlags.contains(.command) {
      names.append("command")
    }
    if normalizedFlags.contains(.numericPad) {
      names.append("numericPad")
    }
    if normalizedFlags.contains(.help) {
      names.append("help")
    }
    if normalizedFlags.contains(.function) {
      names.append("function")
    }
    return names
  }

  private static func textInputLength(_ value: Any) -> Int {
    if let string = value as? String {
      return string.count
    }
    if let attributedString = value as? NSAttributedString {
      return attributedString.string.count
    }
    return 0
  }

  private func responderSnapshot() -> [String: Any] {
    guard let responder = window?.firstResponder else {
      return [
        "className": "nil",
        "sessionId": NSNull(),
      ]
    }
    return [
      "className": String(describing: type(of: responder)),
      "sessionId": nullableString(sessionId(containing: responder)),
    ]
  }

  private func currentResponderSessionId() -> String? {
    guard let responder = window?.firstResponder else {
      return nil
    }
    return sessionId(containing: responder)
  }

  private func shouldPreserveNonTerminalFirstResponder() -> Bool {
    guard let responder = window?.firstResponder else {
      return false
    }
    return sessionId(containing: responder) == nil
  }

  private func sessionId(containing responder: NSResponder) -> String? {
    guard let responderView = responder as? NSView else {
      return sessions.first { _, session in responder === session.view }?.key
    }
    for (sessionId, session) in sessions {
      if responderView === session.containerView || responderView.isDescendant(of: session.containerView)
        || responderView === session.view || responderView.isDescendant(of: session.view)
      {
        return sessionId
      }
    }
    for (sessionId, session) in webPaneSessions {
      let contentView = session.browserContentView
      if responderView === session.containerView || responderView.isDescendant(of: session.containerView)
        || responderView === session.hostView || responderView.isDescendant(of: session.hostView)
        || responderView === contentView || responderView.isDescendant(of: contentView)
      {
        return sessionId
      }
    }
    return nil
  }

  private func emitFocusedSessionIfNeeded(for responder: NSResponder, reason: String) {
    /**
     CDXC:NativeTerminalFocus 2026-04-26-22:22
     Only user/AppKit-originated first-responder changes should update the
     sidebar focus store. Programmatic focus calls from setActiveTerminalSet
     already came from sidebar state; echoing them back creates a feedback
     loop where each layout sync can make another pane active.
     */
    guard let focusedSessionId = sessionId(containing: responder) else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.focusedResponderIgnored",
        details: [
          "reason": reason,
          "responder": String(describing: type(of: responder)),
        ])
      return
    }
    guard activeSessionIds.contains(focusedSessionId) else {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.focusedInactiveSessionIgnored",
        details: [
          "activeSessionIds": Array(activeSessionIds).sorted(),
          "reason": reason,
          "sessionId": focusedSessionId,
        ])
      return
    }
    if lastEmittedFocusedSessionId == focusedSessionId {
      if self.focusedSessionId != focusedSessionId {
        /**
         CDXC:NativeTerminalFocus 2026-05-09-15:30
         Duplicate native focus events can still be diagnostically important
         when local border state was changed by a later layout sync. Preserve a
         breadcrumb without changing behavior so reproduction logs show whether
         duplicate suppression left the active border stale.
         */
        TerminalFocusDebugLog.append(
          event: "nativeFocusTrace.duplicateFocusWithStaleBorderState",
          details: [
            "emittedFocusedSessionId": focusedSessionId,
            "lastEmittedFocusedSessionId": nullableString(lastEmittedFocusedSessionId),
            "localFocusedSessionId": nullableString(self.focusedSessionId),
            "reason": reason,
            "responder": responderSnapshot(),
          ])
      }
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.terminalFocused.duplicateSkipped",
        details: [
          "reason": reason,
          "sessionId": focusedSessionId,
        ])
      return
    }
    lastEmittedFocusedSessionId = focusedSessionId
    self.focusedSessionId = focusedSessionId
    updateAllTerminalBorders()
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.terminalFocused.emitted",
      details: [
        "reason": reason,
        "sessionId": focusedSessionId,
      ])
    TerminalFocusDebugLog.append(
      event: "nativeFocusTrace.terminalFocusedEmitted",
      details: [
        "activeSessionIds": Array(activeSessionIds).sorted(),
        "focusedSessionId": focusedSessionId,
        "reason": reason,
        "responder": responderSnapshot(),
        "visibleSessionIds": orderedVisibleSessionIds(),
      ])
    sendEvent(.terminalFocused(sessionId: focusedSessionId))
  }

  private func describeFrame(_ frame: CGRect) -> [String: Double] {
    [
      "height": Double(frame.height),
      "maxX": Double(frame.maxX),
      "maxY": Double(frame.maxY),
      "minX": Double(frame.minX),
      "minY": Double(frame.minY),
      "width": Double(frame.width),
    ]
  }

  private func describeSize(_ size: CGSize) -> [String: Double] {
    [
      "height": Double(size.height),
      "width": Double(size.width),
    ]
  }

  private func summarizeTerminalText(_ text: String) -> String {
    String(
      text.replacingOccurrences(of: "\r", with: "\\r")
        .replacingOccurrences(of: "\n", with: "\\n")
        .prefix(160))
  }

  private func nullableString(_ value: String?) -> Any {
    value ?? NSNull()
  }

  private func nullableInt(_ value: Int?) -> Any {
    value ?? NSNull()
  }

  private func nullableBool(_ value: Bool?) -> Any {
    value ?? NSNull()
  }

  private static func clampedPaneGap(_ value: Double?) -> CGFloat {
    guard let value, value.isFinite else {
      return defaultPaneGap
    }
    return CGFloat(min(48, max(0, value)))
  }

  private static func workspaceBackgroundColor(_ value: String?) -> NSColor {
    guard let color = parseHexColor(value?.trimmingCharacters(in: .whitespacesAndNewlines)) else {
      return defaultWorkspaceBackgroundColor
    }
    return color
  }

  private static func parseHexColor(_ value: String?) -> NSColor? {
    guard let value else {
      return nil
    }
    let pattern = #"^#?([0-9a-fA-F]{6})$"#
    guard
      let match = value.range(of: pattern, options: .regularExpression),
      match == value.startIndex..<value.endIndex
    else {
      return nil
    }
    let hex = value.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    guard let rawValue = Int(hex, radix: 16) else {
      return nil
    }
    return NSColor(
      calibratedRed: CGFloat((rawValue >> 16) & 0xff) / 255,
      green: CGFloat((rawValue >> 8) & 0xff) / 255,
      blue: CGFloat(rawValue & 0xff) / 255,
      alpha: 1
    )
  }

  private func startExitPollingIfNeeded() {
    guard exitPollTimer == nil else { return }
    exitPollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.pollExitedSurfaces()
      }
    }
  }

  private func stopExitPollingIfIdle() {
    if sessions.isEmpty {
      exitPollTimer?.invalidate()
      exitPollTimer = nil
    }
  }

  private func pollExitedSurfaces() {
    let exitedSessionIds = sessions.compactMap { sessionId, session in
      session.view.processExited ? sessionId : nil
    }
    for sessionId in exitedSessionIds {
      closeTerminal(sessionId: sessionId, requestGhosttyClose: false, reason: "processExitedPoll")
    }
  }

  private func leafSessionIds(_ node: NativeTerminalLayout) -> [String] {
    switch node {
    case .leaf(let sessionId):
      return [sessionId]
    case .tabs(_, let sessionIds):
      return sessionIds
    case .split(_, _, let children):
      return children.flatMap(leafSessionIds)
    }
  }

  private func prunedLayout(removing sessionId: String, from node: NativeTerminalLayout?)
    -> NativeTerminalLayout?
  {
    guard let node else { return nil }
    switch node {
    case .leaf(let existingSessionId):
      return existingSessionId == sessionId ? nil : node
    case .tabs(let activeSessionId, let sessionIds):
      let nextSessionIds = sessionIds.filter { $0 != sessionId }
      if nextSessionIds.isEmpty {
        return nil
      }
      if nextSessionIds.count == 1 {
        return .leaf(sessionId: nextSessionIds[0])
      }
      return .tabs(
        activeSessionId: activeSessionId.flatMap { nextSessionIds.contains($0) ? $0 : nil }
          ?? nextSessionIds[0],
        sessionIds: nextSessionIds)
    case .split(let direction, let ratio, let children):
      let nextChildren = children.compactMap { prunedLayout(removing: sessionId, from: $0) }
      if nextChildren.count == 1 {
        return nextChildren[0]
      }
      return nextChildren.isEmpty
        ? nil : .split(direction: direction, ratio: ratio, children: nextChildren)
    }
  }
}

extension TerminalWorkspaceView: WKNavigationDelegate {
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if let sessionId = sessionId(for: webView) {
      completedWebPaneLoadSessionIds.remove(sessionId)
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.navigation.start", [
      "sessionId": sessionId(for: webView) ?? NSNull(),
      "url": webView.url?.absoluteString ?? NSNull(),
    ])
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.navigation.commit", [
      "sessionId": sessionId(for: webView) ?? NSNull(),
      "url": webView.url?.absoluteString ?? NSNull(),
    ])
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    let sessionId = sessionId(for: webView)
    if let sessionId {
      completedWebPaneLoadSessionIds.insert(sessionId)
    }
    updateWebPanePageMetadata(for: webView, reason: "navigationFinish")
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.navigation.finish", [
      "sessionId": sessionId ?? NSNull(),
      "title": webView.title ?? NSNull(),
      "url": webView.url?.absoluteString ?? NSNull(),
    ])
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    if let sessionId = sessionId(for: webView) {
      completedWebPaneLoadSessionIds.remove(sessionId)
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.navigation.fail", [
      "error": error.localizedDescription,
      "errorCode": (error as NSError).code,
      "errorDomain": (error as NSError).domain,
      "sessionId": sessionId(for: webView) ?? NSNull(),
      "url": webView.url?.absoluteString ?? NSNull(),
    ])
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    if let sessionId = sessionId(for: webView) {
      completedWebPaneLoadSessionIds.remove(sessionId)
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.navigation.provisionalFail", [
      "error": error.localizedDescription,
      "errorCode": (error as NSError).code,
      "errorDomain": (error as NSError).domain,
      "sessionId": sessionId(for: webView) ?? NSNull(),
      "url": webView.url?.absoluteString ?? NSNull(),
    ])
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let requestedUrl = navigationAction.request.url
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.navigation.action", [
      "isMainFrame": navigationAction.targetFrame?.isMainFrame ?? false,
      "method": navigationAction.request.httpMethod ?? NSNull(),
      "navigationType": String(describing: navigationAction.navigationType),
      "sessionId": sessionId(for: webView) ?? NSNull(),
      "targetFrameMissing": navigationAction.targetFrame == nil,
      "url": requestedUrl?.absoluteString ?? NSNull(),
    ])
    if navigationAction.targetFrame == nil,
      let requestedUrl,
      requestedUrl.scheme == "http" || requestedUrl.scheme == "https"
    {
      /**
       CDXC:BrowserPanes 2026-05-03-03:59
       Embedded browser panes are single-pane browsers. Links that ask WebKit
       for a new tab/window, including many search-result links, must retarget
       into the existing WKWebView because zmux does not create overlay windows
       for browser-pane navigation.
       */
      NativeT3CodePaneReproLog.append("nativeWorkspace.browserPane.navigation.retargetBlank", [
        "sessionId": sessionId(for: webView) ?? NSNull(),
        "url": requestedUrl.absoluteString,
      ])
      webView.load(navigationAction.request)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let httpResponse = navigationResponse.response as? HTTPURLResponse
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.navigation.response", [
      "isForMainFrame": navigationResponse.isForMainFrame,
      "mimeType": navigationResponse.response.mimeType ?? NSNull(),
      "sessionId": sessionId(for: webView) ?? NSNull(),
      "statusCode": httpResponse?.statusCode ?? 0,
      "url": navigationResponse.response.url?.absoluteString ?? NSNull(),
    ])
    decisionHandler(.allow)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.process.terminated", [
      "sessionId": sessionId(for: webView) ?? NSNull(),
      "url": webView.url?.absoluteString ?? NSNull(),
    ])
  }
}

extension TerminalWorkspaceView: WKUIDelegate {
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if navigationAction.targetFrame == nil,
      let requestedUrl = navigationAction.request.url,
      requestedUrl.scheme == "http" || requestedUrl.scheme == "https"
    {
      /**
       CDXC:BrowserPanes 2026-05-03-03:59
       JavaScript/window-open navigations use WKUIDelegate instead of the
       normal committed navigation path. Keep them in the same embedded pane so
       user clicks remain in-layout and never require an external overlay.
       */
      NativeT3CodePaneReproLog.append("nativeWorkspace.browserPane.navigation.uiRetargetBlank", [
        "sessionId": sessionId(for: webView) ?? NSNull(),
        "url": requestedUrl.absoluteString,
      ])
      webView.load(navigationAction.request)
    }
    return nil
  }
}

private final class T3CodePaneDiagnosticsBridge: NSObject, WKScriptMessageHandler {
  static let messageHandlerName = "zmuxT3CodePaneDiagnostics"

  private let onThreadChanged: (String, String, String?) -> Void
  private let sessionId: String

  init(sessionId: String, onThreadChanged: @escaping (String, String, String?) -> Void) {
    self.onThreadChanged = onThreadChanged
    self.sessionId = sessionId
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    var details = normalizeBody(message.body)
    let type = (details["type"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    details["frameInfoIsMainFrame"] = message.frameInfo.isMainFrame
    details["sessionId"] = sessionId
    if type == "thread-changed", message.frameInfo.isMainFrame {
      let threadId = (details["threadId"] as? String)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let title = (details["title"] as? String)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
      if !threadId.isEmpty {
        onThreadChanged(sessionId, threadId, title?.isEmpty == false ? title : nil)
      }
    }
    NativeT3CodePaneReproLog.append(
      "nativeWorkspace.t3WebPane.javascript.\(type?.isEmpty == false ? type! : "message")",
      details
    )
  }

  private func normalizeBody(_ body: Any) -> [String: Any] {
    if let dictionary = body as? [String: Any] {
      return dictionary.reduce(into: [String: Any]()) { result, entry in
        result[entry.key] = normalizeValue(entry.value)
      }
    }
    return ["body": String(describing: body)]
  }

  private func normalizeValue(_ value: Any) -> Any {
    if value is NSNull {
      return NSNull()
    }
    if let string = value as? String {
      return string
    }
    if let number = value as? NSNumber {
      return number
    }
    if let bool = value as? Bool {
      return bool
    }
    if let array = value as? [Any] {
      return array.map(normalizeValue)
    }
    if let dictionary = value as? [String: Any] {
      return dictionary.reduce(into: [String: Any]()) { result, entry in
        result[entry.key] = normalizeValue(entry.value)
      }
    }
    return String(describing: value)
  }
}

private enum NativeSessionPersistenceProvider: String {
  case tmux
  case zmx
  case zellij

  static func resolve(_ command: CreateTerminal) -> NativeSessionPersistenceProvider? {
    if let provider = command.sessionPersistenceProvider,
      let resolvedProvider = NativeSessionPersistenceProvider(rawValue: provider)
    {
      return resolvedProvider
    }
    return command.tmuxMode == true ? .tmux : nil
  }
}

private enum NativeSessionPersistenceMode {
  private static let zellijSessionNameMaxLength = 25

  static func attachCommand(
    provider: NativeSessionPersistenceProvider,
    cwd: String,
    initialInput: String?,
    sessionName: String
  ) -> String {
    switch provider {
    case .tmux:
      return tmuxAttachCommand(cwd: cwd, initialInput: initialInput, sessionName: sessionName)
    case .zmx:
      return zmxAttachCommand(cwd: cwd, initialInput: initialInput, sessionName: sessionName)
    case .zellij:
      return zellijAttachCommand(cwd: cwd, initialInput: initialInput, sessionName: sessionName)
    }
  }

  private static func tmuxAttachCommand(
    cwd: String,
    initialInput: String?,
    sessionName: String
  ) -> String {
    let script = """
      tmux_session=\(shellQuote(sessionName))
      tmux_cwd=\(shellQuote(cwd))
      tmux_initial_input=\(shellQuote(initialInput ?? ""))
      tmux_created=0
      if ! command -v tmux >/dev/null 2>&1; then
        printf '%s\\n' 'tmux mode is enabled, but tmux was not found on PATH.'
        exit 127
      fi
      if ! tmux has-session -t "$tmux_session" 2>/dev/null; then
        tmux new-session -d -s "$tmux_session" -c "$tmux_cwd"
        tmux_created=1
      fi
      tmux set-option -t "$tmux_session" set-titles on >/dev/null
      tmux set-option -t "$tmux_session" set-titles-string '#T' >/dev/null
      if [ "$tmux_created" = "1" ] && [ -n "$tmux_initial_input" ]; then
        # CDXC:TmuxMode 2026-05-05-06:31: Target the active pane by session
        # name so user tmux base-index settings do not break first launch.
        tmux send-keys -t "$tmux_session" -l "$tmux_initial_input"
      fi
      exec tmux attach-session -t "$tmux_session"
      """
    /**
     CDXC:TmuxMode 2026-05-05-06:06
     Ghostty accepts one command string. Run a small login-shell script that
     creates exactly one tmux session/pane for the sidebar terminal, configures
     tmux to forward the pane title to Ghostty, then execs attach so remote SSH
     clients can attach to the same named session.

     CDXC:TmuxMode 2026-05-05-06:31
     Initial agent commands belong only to a newly created tmux pane. Do not use
     Ghostty initialInput in tmux mode, because app restart should attach to the
     running tmux pane without injecting a second resume command.
     */
    return "/bin/zsh -lc \(shellQuote(script))"
  }

  private static func zmxAttachCommand(
    cwd: String,
    initialInput: String?,
    sessionName: String
  ) -> String {
    let script = """
      zmx_session=\(shellQuote(sessionName))
      zmx_cwd=\(shellQuote(cwd))
      zmx_initial_command=\(shellQuote(shellCommand(fromInitialInput: initialInput)))
      unset ZMX_SESSION ZMX_SESSION_PREFIX
      if ! command -v zmx >/dev/null 2>&1; then
        printf '%s\\n' 'session persistence is set to zmx, but zmx was not found on PATH.'
        exit 127
      fi
      if [ -z "$zmx_initial_command" ]; then
        cd "$zmx_cwd" || exit
        exec zmx attach "$zmx_session"
      fi
      if zmx list --short 2>/dev/null | grep -F -x -- "$zmx_session" >/dev/null 2>&1; then
        exec zmx attach "$zmx_session"
      fi
      cd "$zmx_cwd" || exit
      exec zmx attach "$zmx_session" /bin/zsh -lc "$zmx_initial_command"
      """
    /**
     CDXC:SessionPersistence 2026-05-05-07:28
     zmx `attach` creates a missing session and attaches to an existing one.
     Empty terminals must use plain attach so the user sees a normal shell
     instead of zmx task wrapper text. Initial agent commands are passed only
     when the named session does not already exist, so app restart attaches
     without replaying resume input into the live session.

     CDXC:SessionPersistence 2026-05-06-23:13
     Empty zmx-backed terminals must never create placeholder tasks such as
     `zmx run <name> /bin/zsh -lc :`. zmx surfaces task wrapper text such as
     `ZMX_TASK_COMPLETED` whenever a command is sent; direct attach creates the
     shell session without rendering a fake command or completion marker.

     CDXC:SessionPersistence 2026-05-06-23:31
     zmux can itself be launched from inside zmx. Inherited ZMX_SESSION makes
     `zmx attach <target>` exit immediately, and inherited ZMX_SESSION_PREFIX
     rewrites app-managed names. Clear only those client/session variables so
     persistence still uses the user's zmx socket directory but attaches the
     exact sidebar session name.
     */
    return "/bin/zsh -lc \(shellQuote(script))"
  }

  private static func zellijAttachCommand(
    cwd: String,
    initialInput: String?,
    sessionName: String
  ) -> String {
    let initialCommand = shellCommand(fromInitialInput: initialInput)
    let layout = zellijLayout(cwd: cwd, initialCommand: initialCommand)
    let script = """
      zellij_session=\(shellQuote(sessionName))
      if ! command -v zellij >/dev/null 2>&1; then
        printf '%s\\n' 'session persistence is set to zellij, but zellij was not found on PATH.'
        exit 127
      fi
      if zellij list-sessions --short --no-formatting 2>/dev/null | grep -F -x -- "$zellij_session" >/dev/null 2>&1; then
        exec zellij attach "$zellij_session"
      fi
      zellij_layout_file="$(mktemp "${TMPDIR:-/tmp}/zmux-zellij-layout.XXXXXX")" || exit 1
      trap 'rm -f "$zellij_layout_file"' EXIT
      cat >"$zellij_layout_file" <<'ZMUX_ZELLIJ_LAYOUT'
      \(layout)
      ZMUX_ZELLIJ_LAYOUT
      zellij --session "$zellij_session" --new-session-with-layout "$zellij_layout_file"
      """
    /**
     CDXC:SessionPersistence 2026-05-06-03:43
     Zellij should match tmux/zmx UX: attach to a live named session when it
     exists, otherwise create the named session and run the pending agent resume
     command inside that first pane. Ghostty initialInput remains disabled for
     persistence providers so app restart never replays resume text into an
     already running session.

     CDXC:SessionPersistence 2026-05-06-22:16
     Zellij `--session --layout` does not create a missing session, and
     `attach --create` with a top-level `--layout` starts a generated-name
     session instead of the requested attach target on zellij 0.44. Write the
     generated layout to a real temporary file, then launch
     `zellij --session <name> --new-session-with-layout <file>` so new sessions
     are created under the same name that restart attach will later target.
     */
    return "/bin/zsh -lc \(shellQuote(script))"
  }

  static func renameTmuxSession(
    from currentName: String,
    sessionId: String,
    title: String,
    to nextName: String
  ) {
    DispatchQueue.global(qos: .utility).async {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
      process.arguments = ["tmux", "rename-session", "-t", currentName, nextName]
      process.standardOutput = Pipe()
      process.standardError = Pipe()
      do {
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus != 0 {
          TerminalFocusDebugLog.append(
            event: "nativeWorkspace.tmux.renameSession.failed",
            details: [
              "currentName": currentName,
              "exitCode": process.terminationStatus,
              "nextName": nextName,
              "requestedSessionId": sessionId,
              "title": title,
            ])
        }
      } catch {
        TerminalFocusDebugLog.append(
          event: "nativeWorkspace.tmux.renameSession.failed",
          details: [
            "currentName": currentName,
            "error": error.localizedDescription,
            "nextName": nextName,
            "requestedSessionId": sessionId,
            "title": title,
          ])
      }
    }
  }

  static func sessionName(
    provider: NativeSessionPersistenceProvider,
    sessionId: String,
    title: String?
  ) -> String {
    guard provider == .zellij else {
      return sessionName(sessionId: sessionId, title: title)
    }

    let identitySlug = slug(sessionId) ?? "session"
    let identitySuffix = String(identitySlug.suffix(10))
    let titleSlug = slug(title) ?? "terminal"
    let maxTitleLength = max(
      1,
      zellijSessionNameMaxLength - "zmux".count - identitySuffix.count - 2)
    let limitedTitleSlug = String(titleSlug.prefix(maxTitleLength)).trimmingCharacters(
      in: CharacterSet(charactersIn: "-_"))
    let visibleTitleSlug = limitedTitleSlug.isEmpty ? "terminal" : limitedTitleSlug
    return "zmux-\(visibleTitleSlug)-\(identitySuffix)"
  }

  static func sessionName(sessionId: String, title: String?) -> String {
    let identitySlug = slug(sessionId) ?? "session"
    let identitySuffix = String(identitySlug.suffix(12))
    let titleSlug = slug(title) ?? "terminal"
    let limitedTitleSlug = String(titleSlug.prefix(48)).trimmingCharacters(
      in: CharacterSet(charactersIn: "-_"))
    let visibleTitleSlug = limitedTitleSlug.isEmpty ? "terminal" : limitedTitleSlug
    return "zmux-\(visibleTitleSlug)-\(identitySuffix)"
  }

  static func normalizedSessionName(
    _ value: String?,
    provider: NativeSessionPersistenceProvider
  ) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !trimmed.isEmpty else {
      return nil
    }
    /**
     CDXC:SessionPersistence 2026-05-05-07:28
     Persisted provider session names are trusted only when they match the
     app-generated target-safe shape. Corrupt or legacy missing names should
     regenerate from the terminal title instead of attaching to an ambiguous
     provider target.
     */
    guard trimmed.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
      return nil
    }
    if provider == .zellij && trimmed.count > zellijSessionNameMaxLength {
      /**
       CDXC:SessionPersistence 2026-05-06-22:30
       Zellij 0.44 rejects names at 29+ characters and launch checks did not
       reliably publish 26-28 character names. Keep zellij backing identities
       at 25 characters or less so create, list, and restart attach all target
       the same provider session instead of falling into generated-name
       sessions.
       */
      return nil
    }
    return trimmed
  }

  private static func slug(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !trimmed.isEmpty else {
      return nil
    }

    var result = ""
    var didAppendSeparator = false
    for scalar in trimmed.lowercased().unicodeScalars {
      if isAsciiAlphaNumeric(scalar) {
        result.unicodeScalars.append(scalar)
        didAppendSeparator = false
      } else if !didAppendSeparator {
        result.append("-")
        didAppendSeparator = true
      }
    }

    let normalized = result.trimmingCharacters(in: CharacterSet(charactersIn: "-_"))
    return normalized.isEmpty ? nil : normalized
  }

  private static func isAsciiAlphaNumeric(_ scalar: UnicodeScalar) -> Bool {
    (scalar.value >= 48 && scalar.value <= 57) ||
      (scalar.value >= 97 && scalar.value <= 122)
  }

  private static func shellCommand(fromInitialInput initialInput: String?) -> String {
    let normalized = (initialInput ?? "")
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized
  }

  private static func shellQuote(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }

  private static func zellijLayout(cwd: String, initialCommand: String) -> String {
    if initialCommand.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return """
        layout {
          cwd \(zellijKdlString(cwd))
          pane
        }
        """
    }
    return """
      layout {
        pane {
          cwd \(zellijKdlString(cwd))
          command "/bin/zsh"
          args "-lc" \(zellijKdlString(initialCommand))
        }
      }
      """
  }

  private static func zellijKdlString(_ value: String) -> String {
    var result = "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\\":
        result += "\\\\"
      case "\"":
        result += "\\\""
      case "\n":
        result += "\\n"
      case "\r":
        result += "\\r"
      case "\t":
        result += "\\t"
      default:
        result.unicodeScalars.append(scalar)
      }
    }
    result += "\""
    return result
  }
}

private func normalizedTerminalSessionTitle(_ title: String?, sessionId: String) -> String {
  let trimmedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  return trimmedTitle.isEmpty ? sessionId : trimmedTitle
}

private enum NativeTerminalProcessMonitor {
  /**
   CDXC:NativeTerminals 2026-04-29-09:16
   Closing a managed Ghostty surface should also clean up processes still bound
   to that terminal tty. This prevents agent helper trees from becoming
   launchd-owned orphans after the user closes or restores terminal sessions.
   */
  static func terminateSessionProcesses(ttyName: String?, foregroundPid: Int?, reason: String) {
    if let normalizedTtyName = normalizedTTYName(ttyName) {
      signalProcesses(attachedToTTY: normalizedTtyName, signal: "TERM", reason: reason)
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
        signalProcesses(attachedToTTY: normalizedTtyName, signal: "KILL", reason: reason)
      }
      return
    }

    guard let foregroundPid, foregroundPid > 1 else {
      return
    }
    _ = kill(pid_t(foregroundPid), SIGHUP)
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      _ = kill(pid_t(foregroundPid), SIGTERM)
    }
  }

  private static func normalizedTTYName(_ ttyName: String?) -> String? {
    let trimmed = ttyName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !trimmed.isEmpty else {
      return nil
    }
    return URL(fileURLWithPath: trimmed).lastPathComponent
  }

  private static func signalProcesses(attachedToTTY ttyName: String, signal: String, reason: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
    process.arguments = ["-\(signal)", "-t", ttyName]
    process.standardOutput = Pipe()
    process.standardError = Pipe()
    do {
      try process.run()
    } catch {
      TerminalFocusDebugLog.append(
        event: "nativeWorkspace.processMonitor.signalFailed",
        details: [
          "error": error.localizedDescription,
          "reason": reason,
          "signal": signal,
          "ttyName": ttyName,
        ])
    }
  }
}

private final class FloatingEditorOverlayView: NSView {
  let surfaceView: Ghostty.SurfaceView?
  let contentView: NSView
  let returnFocusSessionId: String?
  var closeHandler: (() -> Void)?
  var dragHandler: ((CGPoint) -> Void)?
  var resizeHandler: ((CGPoint) -> Void)?
  var saveHandler: (() -> Void)?
  var isUserPositioned = false

  private let titleBarView = FloatingEditorTitleBarView()
  private let titleLabel = NSTextField(labelWithString: "")
  private let closeButton = NSButton(title: "x", target: nil, action: nil)
  private let saveButton = NSButton(title: "Save", target: nil, action: nil)
  private let resizeHandleView = FloatingEditorResizeHandleView()

  init(title: String, returnFocusSessionId: String?, surfaceView: Ghostty.SurfaceView) {
    self.surfaceView = surfaceView
    self.returnFocusSessionId = returnFocusSessionId
    self.contentView = SurfaceScrollView(contentSize: .zero, surfaceView: surfaceView)
    super.init(frame: .zero)
    configure(title: title)
  }

  init(title: String, returnFocusSessionId: String?, webView: WKWebView) {
    self.surfaceView = nil
    self.returnFocusSessionId = returnFocusSessionId
    self.contentView = webView
    super.init(frame: .zero)
    configure(title: title)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  private func configure(title: String) {
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedWhite: 0.09, alpha: 0.98).cgColor
    layer?.cornerRadius = 8
    layer?.borderColor = NSColor(calibratedWhite: 1, alpha: 0.18).cgColor
    layer?.borderWidth = 1
    layer?.shadowColor = NSColor.black.cgColor
    layer?.shadowOpacity = 0.32
    layer?.shadowRadius = 18
    layer?.shadowOffset = CGSize(width: 0, height: -8)

    titleBarView.translatesAutoresizingMaskIntoConstraints = false
    titleBarView.wantsLayer = true
    titleBarView.layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 1).cgColor
    titleBarView.dragHandler = { [weak self] delta in
      self?.dragHandler?(delta)
    }
    resizeHandleView.translatesAutoresizingMaskIntoConstraints = false
    resizeHandleView.resizeHandler = { [weak self] delta in
      self?.resizeHandler?(delta)
    }

    titleLabel.stringValue = title
    titleLabel.font = .systemFont(ofSize: 12, weight: .semibold)
    titleLabel.textColor = NSColor(calibratedWhite: 0.92, alpha: 1)
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.translatesAutoresizingMaskIntoConstraints = false

    closeButton.bezelStyle = .texturedRounded
    closeButton.font = .systemFont(ofSize: 11, weight: .semibold)
    closeButton.target = self
    closeButton.action = #selector(closeButtonPressed)
    closeButton.translatesAutoresizingMaskIntoConstraints = false

    saveButton.bezelStyle = .rounded
    saveButton.font = .systemFont(ofSize: 12, weight: .semibold)
    saveButton.target = self
    saveButton.action = #selector(saveButtonPressed)
    saveButton.translatesAutoresizingMaskIntoConstraints = false

    contentView.translatesAutoresizingMaskIntoConstraints = false

    addSubview(titleBarView)
    titleBarView.addSubview(titleLabel)
    titleBarView.addSubview(closeButton)
    addSubview(contentView)
    addSubview(saveButton)
    addSubview(resizeHandleView)

    NSLayoutConstraint.activate([
      titleBarView.leadingAnchor.constraint(equalTo: leadingAnchor),
      titleBarView.trailingAnchor.constraint(equalTo: trailingAnchor),
      titleBarView.topAnchor.constraint(equalTo: topAnchor),
      titleBarView.heightAnchor.constraint(equalToConstant: 32),

      closeButton.leadingAnchor.constraint(equalTo: titleBarView.leadingAnchor, constant: 8),
      closeButton.centerYAnchor.constraint(equalTo: titleBarView.centerYAnchor),
      closeButton.widthAnchor.constraint(equalToConstant: 24),
      closeButton.heightAnchor.constraint(equalToConstant: 20),

      titleLabel.leadingAnchor.constraint(equalTo: closeButton.trailingAnchor, constant: 8),
      titleLabel.trailingAnchor.constraint(equalTo: titleBarView.trailingAnchor, constant: -12),
      titleLabel.centerYAnchor.constraint(equalTo: titleBarView.centerYAnchor),

      contentView.leadingAnchor.constraint(equalTo: leadingAnchor),
      contentView.trailingAnchor.constraint(equalTo: trailingAnchor),
      contentView.topAnchor.constraint(equalTo: titleBarView.bottomAnchor),
      contentView.bottomAnchor.constraint(equalTo: bottomAnchor),

      saveButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -30),
      saveButton.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
      saveButton.widthAnchor.constraint(equalToConstant: 76),
      saveButton.heightAnchor.constraint(equalToConstant: 28),

      resizeHandleView.trailingAnchor.constraint(equalTo: trailingAnchor),
      resizeHandleView.bottomAnchor.constraint(equalTo: bottomAnchor),
      resizeHandleView.widthAnchor.constraint(equalToConstant: 22),
      resizeHandleView.heightAnchor.constraint(equalToConstant: 22),
    ])
  }

  @objc private func closeButtonPressed() {
    closeHandler?()
  }

  @objc private func saveButtonPressed() {
    saveHandler?()
  }

  func setSaving() {
    saveButton.title = "Saving"
    saveButton.isEnabled = false
  }

  func resetSaveButton() {
    saveButton.title = "Save"
    saveButton.isEnabled = true
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }
}

private final class FloatingEditorTitleBarView: NSView {
  var dragHandler: ((CGPoint) -> Void)?
  private var lastDragWindowPoint: CGPoint?

  override func mouseDown(with event: NSEvent) {
    lastDragWindowPoint = event.locationInWindow
  }

  override func mouseDragged(with event: NSEvent) {
    let point = event.locationInWindow
    if let lastDragWindowPoint {
      dragHandler?(CGPoint(x: point.x - lastDragWindowPoint.x, y: point.y - lastDragWindowPoint.y))
    }
    lastDragWindowPoint = point
  }

  override func mouseUp(with event: NSEvent) {
    lastDragWindowPoint = nil
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .openHand)
  }
}

private final class FloatingEditorResizeHandleView: NSView {
  var resizeHandler: ((CGPoint) -> Void)?
  private var lastDragWindowPoint: CGPoint?

  override var isOpaque: Bool {
    false
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let color = NSColor(calibratedWhite: 1, alpha: 0.34)
    color.setStroke()
    let path = NSBezierPath()
    path.lineWidth = 1
    for offset in stride(from: CGFloat(6), through: CGFloat(14), by: CGFloat(4)) {
      path.move(to: CGPoint(x: bounds.maxX - offset, y: 4))
      path.line(to: CGPoint(x: bounds.maxX - 4, y: offset))
    }
    path.stroke()
  }

  override func mouseDown(with event: NSEvent) {
    lastDragWindowPoint = event.locationInWindow
  }

  override func mouseDragged(with event: NSEvent) {
    let point = event.locationInWindow
    if let lastDragWindowPoint {
      resizeHandler?(CGPoint(x: point.x - lastDragWindowPoint.x, y: point.y - lastDragWindowPoint.y))
    }
    lastDragWindowPoint = point
  }

  override func mouseUp(with event: NSEvent) {
    lastDragWindowPoint = nil
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .resizeLeftRight)
  }
}

private final class ZmuxGhosttySurfaceView: Ghostty.SurfaceView {
  var zmuxSessionId: String?
  var onKeyDownProbe: ((ZmuxGhosttySurfaceView, NSEvent, String) -> Void)?
  var onTextInputProbe: ((ZmuxGhosttySurfaceView, Any, NSRange) -> Void)?

  /**
   CDXC:NativeTerminals 2026-04-29-08:57
   Embedded Ghostty terminals should use the default pointer cursor instead
   of advertising a text-selection I-beam at all times. Keep this scoped to
   zmux's SurfaceView subclass so Ghostty.app cursor behavior is unchanged.
   */
  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .arrow)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if handleZmuxSearchKeyEquivalent(event) {
      return true
    }
    if handleCommandEditingKeyEquivalent(event) {
      return true
    }
    return super.performKeyEquivalent(with: event)
  }

  /**
   CDXC:NativeTerminals 2026-04-29-08:53
   Once Cmd+F opens embedded Ghostty search, Escape should dismiss search
   before terminal programs receive the key. This mirrors normal find panels
   and keeps Escape from leaking into the shell while search is active.
   */
  override func keyDown(with event: NSEvent) {
    /**
     CDXC:NativeTerminalFocus 2026-05-11-11:48
     Wrong-pane typing must be diagnosed before changing focus behavior. Probe
     each terminal keyDown boundary with route metadata only, so the log shows
     whether this surface received a key while another pane owned the visible
     focus ring.
     */
    onKeyDownProbe?(self, event, "received")
    if event.keyCode == 53, searchState != nil {
      onKeyDownProbe?(self, event, "searchEscapeConsumed")
      searchState = nil
      return
    }
    super.keyDown(with: event)
    onKeyDownProbe?(self, event, "forwarded")
  }

  override func insertText(_ insertString: Any, replacementRange: NSRange) {
    onTextInputProbe?(self, insertString, replacementRange)
    super.insertText(insertString, replacementRange: replacementRange)
  }

  /**
   CDXC:NativeTerminals 2026-04-28-03:17
   Embedded Ghostty terminals must not paste text on middle click. Ghostty's
   default selection-clipboard behavior always maps middle-button events to
   paste, so zmux consumes button 2 before the terminal core sees it.
   */
  override func otherMouseDown(with event: NSEvent) {
    if event.buttonNumber == 2 {
      return
    }
    super.otherMouseDown(with: event)
  }

  override func otherMouseUp(with event: NSEvent) {
    if event.buttonNumber == 2 {
      return
    }
    super.otherMouseUp(with: event)
  }

  override func otherMouseDragged(with event: NSEvent) {
    if event.buttonNumber == 2 {
      return
    }
    super.otherMouseDragged(with: event)
  }

  /**
   CDXC:NativeTerminals 2026-04-28-05:13
   Embedded Ghostty surfaces do not use Ghostty's SwiftUI terminal wrapper or
   app main menu, so search shortcuts must be handled at the surface level and
   routed to Ghostty's native search actions.
   */
  private func handleZmuxSearchKeyEquivalent(_ event: NSEvent) -> Bool {
    guard event.type == .keyDown, focused else {
      return false
    }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard flags.contains(.command), flags.isDisjoint(with: [.control, .option]) else {
      return false
    }
    switch event.charactersIgnoringModifiers?.lowercased() {
    case "f":
      find(nil)
      return true
    case "g":
      if flags.contains(.shift) {
        _ = navigateSearchToPrevious()
      } else {
        _ = navigateSearchToNext()
      }
      return true
    default:
      return false
    }
  }

  /**
   CDXC:NativeTerminals 2026-05-11-05:24
   AppKit's Select All menu key equivalent claims Cmd-A before embedded
   Ghostty can encode it for terminal applications. When a terminal pane is
   focused, Cmd-A must reach the child program as Command/Super, while Cmd-Left
   remains on the terminal input path. Keep native search above this handler so
   Cmd-F/Cmd-G continue
   to drive Ghostty search chrome, and leave non-terminal text fields on the
   normal AppKit Edit menu path.
   */
  private func handleCommandEditingKeyEquivalent(_ event: NSEvent) -> Bool {
    guard event.type == .keyDown, focused else {
      return false
    }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard flags.contains(.command), flags.isDisjoint(with: [.control, .option]) else {
      return false
    }

    if flags.isDisjoint(with: [.shift]),
      event.charactersIgnoringModifiers?.lowercased() == "a"
    {
      return sendTerminalInput(Self.commandASequence, label: "cmd-a-as-super")
    }

    return false
  }

  private func sendTerminalInput(_ sequence: String, label: String) -> Bool {
    TerminalFocusDebugLog.append(
      event: "nativeWorkspace.commandEditingSequenceSent",
      details: ["label": label])
    super.insertText(sequence, replacementRange: NSRange(location: NSNotFound, length: 0))
    return true
  }

  private static let commandASequence = "\u{1B}[97;9u"

}

private final class BrowserAddressTextFieldCell: NSTextFieldCell {
  private static let verticalTextOffset: CGFloat = 1.5

  override func drawingRect(forBounds rect: NSRect) -> NSRect {
    adjustedTextFrame(super.drawingRect(forBounds: rect))
  }

  override func edit(
    withFrame rect: NSRect,
    in controlView: NSView,
    editor textObj: NSText,
    delegate: Any?,
    event: NSEvent?
  ) {
    super.edit(
      withFrame: adjustedTextFrame(rect),
      in: controlView,
      editor: textObj,
      delegate: delegate,
      event: event)
  }

  override func select(
    withFrame rect: NSRect,
    in controlView: NSView,
    editor textObj: NSText,
    delegate: Any?,
    start selStart: Int,
    length selLength: Int
  ) {
    super.select(
      withFrame: adjustedTextFrame(rect),
      in: controlView,
      editor: textObj,
      delegate: delegate,
      start: selStart,
      length: selLength)
  }

  private func adjustedTextFrame(_ frame: NSRect) -> NSRect {
    var nextFrame = frame
    /**
     CDXC:BrowserPanes 2026-05-03-02:08
     The browser address field frame aligns with toolbar controls, but AppKit
     draws the text slightly high. Offset only the cell text/edit rect down two
     pixels in AppKit field coordinates so the surrounding toolbar layout
     remains unchanged.
     */
    nextFrame.origin.y += Self.verticalTextOffset
    return nextFrame
  }
}

private final class TerminalSearchTextFieldCell: NSTextFieldCell {
  private static let verticalTextOffset: CGFloat = 3

  override func drawingRect(forBounds rect: NSRect) -> NSRect {
    adjustedTextFrame(super.drawingRect(forBounds: rect))
  }

  override func edit(
    withFrame rect: NSRect,
    in controlView: NSView,
    editor textObj: NSText,
    delegate: Any?,
    event: NSEvent?
  ) {
    super.edit(
      withFrame: adjustedTextFrame(rect),
      in: controlView,
      editor: textObj,
      delegate: delegate,
      event: event)
  }

  override func select(
    withFrame rect: NSRect,
    in controlView: NSView,
    editor textObj: NSText,
    delegate: Any?,
    start selStart: Int,
    length selLength: Int
  ) {
    super.select(
      withFrame: adjustedTextFrame(rect),
      in: controlView,
      editor: textObj,
      delegate: delegate,
      start: selStart,
      length: selLength)
  }

  private func adjustedTextFrame(_ frame: NSRect) -> NSRect {
    var nextFrame = frame
    /**
     CDXC:NativeTerminals 2026-05-10-11:58
     Embedded Ghostty search text and placeholder must be visually centered in
     the search box. Offset only the field cell's text/edit rect down three
     pixels so icon button placement and the surrounding bar layout stay fixed.
     */
    nextFrame.origin.y += Self.verticalTextOffset
    return nextFrame
  }
}

private final class TerminalSearchTextField: NSTextField {
  var onClose: (() -> Void)?
  var onFindNext: (() -> Void)?
  var onFindPrevious: (() -> Void)?

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard event.type == .keyDown else {
      return super.performKeyEquivalent(with: event)
    }
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    if flags.contains(.command),
      flags.isDisjoint(with: [.control, .option]),
      event.charactersIgnoringModifiers?.lowercased() == "g"
    {
      if flags.contains(.shift) {
        onFindPrevious?()
      } else {
        onFindNext?()
      }
      return true
    }
    return super.performKeyEquivalent(with: event)
  }

  override func keyDown(with event: NSEvent) {
    if event.keyCode == 53 {
      onClose?()
      return
    }
    if event.keyCode == 36 || event.keyCode == 76 {
      if event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.shift) {
        onFindPrevious?()
      } else {
        onFindNext?()
      }
      return
    }
    super.keyDown(with: event)
  }

  override func cancelOperation(_ sender: Any?) {
    onClose?()
  }
}

private final class TerminalSearchBarView: NSView, NSTextFieldDelegate {
  /**
   CDXC:NativeTerminals 2026-05-10-12:02
   Embedded Ghostty search should read as a neutral grey utility control, not
   a blue-tinted element. Keep the palette near-equal RGB so the floating find
   box stays visually calm over terminal content.
   */
  private static let backgroundColor = NSColor(
    calibratedRed: 0x19 / 255,
    green: 0x19 / 255,
    blue: 0x1B / 255,
    alpha: 0.96
  ).cgColor
  private static let borderColor = NSColor(
    calibratedRed: 0x83 / 255,
    green: 0x83 / 255,
    blue: 0x88 / 255,
    alpha: 0.42
  ).cgColor

  private weak var surfaceView: Ghostty.SurfaceView?
  private var searchState: Ghostty.SurfaceView.SearchState?
  private var cancellables = Set<AnyCancellable>()
  private let textField = TerminalSearchTextField()
  private let countLabel = NSTextField(labelWithString: "")
  private let previousButton = NSButton()
  private let nextButton = NSButton()
  private let closeButton = NSButton()

  init(surfaceView: Ghostty.SurfaceView) {
    self.surfaceView = surfaceView
    super.init(frame: .zero)
    isHidden = true
    wantsLayer = true
    layer?.backgroundColor = Self.backgroundColor
    layer?.borderColor = Self.borderColor
    layer?.borderWidth = 1
    layer?.cornerRadius = 8
    layer?.masksToBounds = true

    configureTextField()
    configureCountLabel()
    configureButton(previousButton, symbolName: "chevron.up", action: #selector(findPrevious))
    configureButton(nextButton, symbolName: "chevron.down", action: #selector(findNext))
    configureButton(closeButton, symbolName: "xmark", action: #selector(closeSearch))
    addSubview(textField)
    addSubview(countLabel)
    addSubview(previousButton)
    addSubview(nextButton)
    addSubview(closeButton)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layout() {
    super.layout()
    /**
     CDXC:NativeTerminals 2026-04-29-02:00
     Native Ghostty search must stay a compact floating control. Manual
     AppKit frames prevent stack-view expansion from stretching the search
     input across the terminal pane and obscuring terminal content.
     */
    let inset = CGFloat(7)
    let buttonSize = CGFloat(24)
    let gap = CGFloat(4)
    let contentHeight = max(bounds.height - inset * 2, 20)
    var right = bounds.maxX - inset

    closeButton.frame = CGRect(
      x: right - buttonSize, y: inset - 1, width: buttonSize, height: contentHeight + 2)
    right = closeButton.frame.minX - gap
    nextButton.frame = CGRect(
      x: right - buttonSize, y: inset - 1, width: buttonSize, height: contentHeight + 2)
    right = nextButton.frame.minX - gap
    previousButton.frame = CGRect(
      x: right - buttonSize, y: inset - 1, width: buttonSize, height: contentHeight + 2)
    right = previousButton.frame.minX - gap
    countLabel.frame = CGRect(x: right - 50, y: inset, width: 50, height: contentHeight)
    right = countLabel.frame.minX - gap
    textField.frame = CGRect(
      x: inset + 2,
      y: inset,
      width: max(right - inset - 2, 80),
      height: contentHeight
    )
  }

  func setSearchState(_ nextSearchState: Ghostty.SurfaceView.SearchState?) {
    searchState = nextSearchState
    cancellables.removeAll()
    guard let nextSearchState else {
      isHidden = true
      return
    }

    isHidden = false
    updateNeedle(nextSearchState.needle)
    updateCount(selected: nextSearchState.selected, total: nextSearchState.total)
    nextSearchState.$needle
      .receive(on: DispatchQueue.main)
      .sink { [weak self] needle in
        self?.updateNeedle(needle)
      }
      .store(in: &cancellables)
    nextSearchState.$selected
      .combineLatest(nextSearchState.$total)
      .receive(on: DispatchQueue.main)
      .sink { [weak self] selected, total in
        self?.updateCount(selected: selected, total: total)
      }
      .store(in: &cancellables)
    DispatchQueue.main.async { [weak self] in
      guard let self, !self.isHidden else { return }
      self.window?.makeFirstResponder(self.textField)
    }
  }

  func controlTextDidChange(_ notification: Notification) {
    guard notification.object as? NSTextField === textField else {
      return
    }
    searchState?.needle = textField.stringValue
  }

  func control(
    _ control: NSControl,
    textView: NSTextView,
    doCommandBy commandSelector: Selector
  ) -> Bool {
    guard control === textField else {
      return false
    }
    if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
      closeSearch()
      return true
    }
    if commandSelector == #selector(NSResponder.insertNewline(_:)) {
      /**
       CDXC:NativeTerminals 2026-05-10-11:51
       Embedded Ghostty search Return keys must navigate matches from the
       active AppKit field editor. Handling the text command directly prevents
       NSTextField from treating Return as a no-op field action.
       */
      navigateSearchFromReturn(shouldGoPrevious: false)
      return true
    }
    if commandSelector == #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)) {
      navigateSearchFromReturn(shouldGoPrevious: true)
      return true
    }
    return false
  }

  private func configureTextField() {
    textField.delegate = self
    textField.cell = TerminalSearchTextFieldCell(textCell: "")
    textField.placeholderString = "Search"
    textField.focusRingType = .none
    textField.isBezeled = false
    textField.drawsBackground = false
    textField.font = NSFont.systemFont(ofSize: 13)
    textField.textColor = NSColor(calibratedWhite: 0.94, alpha: 1)
    textField.onClose = { [weak self] in self?.closeSearch() }
    textField.onFindNext = { [weak self] in self?.findNext() }
    textField.onFindPrevious = { [weak self] in self?.findPrevious() }
  }

  private func configureCountLabel() {
    countLabel.alignment = .right
    countLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
    countLabel.textColor = NSColor(calibratedWhite: 0.72, alpha: 1)
    countLabel.lineBreakMode = .byTruncatingMiddle
  }

  private func configureButton(_ button: NSButton, symbolName: String, action: Selector) {
    button.bezelStyle = .regularSquare
    button.image = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil)
    button.imagePosition = .imageOnly
    button.isBordered = false
    button.target = self
    button.action = action
  }

  private func updateNeedle(_ needle: String) {
    if textField.stringValue != needle {
      textField.stringValue = needle
    }
  }

  private func updateCount(selected: UInt?, total: UInt?) {
    if let selected {
      countLabel.stringValue = "\(selected + 1)/\(total.map(String.init) ?? "?")"
    } else if let total {
      countLabel.stringValue = "-/\(total)"
    } else {
      countLabel.stringValue = ""
    }
  }

  private func navigateSearchFromReturn(shouldGoPrevious: Bool) {
    let flags = NSApp.currentEvent?.modifierFlags.intersection(.deviceIndependentFlagsMask) ?? []
    if shouldGoPrevious || flags.contains(.shift) {
      findPrevious()
    } else {
      findNext()
    }
  }

  @objc private func findNext() {
    _ = surfaceView?.navigateSearchToNext()
  }

  @objc private func findPrevious() {
    _ = surfaceView?.navigateSearchToPrevious()
  }

  @objc private func closeSearch() {
    surfaceView?.searchState = nil
    if let surfaceView {
      window?.makeFirstResponder(surfaceView)
    }
  }
}

private final class TerminalPaneHeaderDragTargetView: NSView {
  private static let centerBackgroundColor = NSColor(
    calibratedRed: 0.18, green: 0.42, blue: 0.86, alpha: 0.12
  ).cgColor
  private static let edgeBackgroundColor = NSColor(
    calibratedRed: 0.18, green: 0.42, blue: 0.86, alpha: 0.2
  ).cgColor

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.borderWidth = 2
    layer?.cornerRadius = 6
    layer?.borderColor = NSColor(calibratedRed: 0.44, green: 0.68, blue: 1, alpha: 0.95).cgColor
    layer?.backgroundColor = Self.centerBackgroundColor
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func configure(placement: PaneDropPlacement) {
    layer?.backgroundColor =
      placement == .center ? Self.centerBackgroundColor : Self.edgeBackgroundColor
  }
}

private final class TerminalPaneTabReorderTargetView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedRed: 0.44, green: 0.68, blue: 1, alpha: 0.98).cgColor
    layer?.cornerRadius = 1
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }
}

private final class TerminalPaneHeaderDragGhostView: NSView {
  private static let height: CGFloat = 32
  private static let horizontalPadding: CGFloat = 8
  private static let iconSize: CGFloat = 16
  private static let iconGap: CGFloat = 7

  private let iconImageView = NSImageView(frame: .zero)
  private let titleLabel = NSTextField(labelWithString: "")

  override var isFlipped: Bool {
    true
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedRed: 0.08, green: 0.09, blue: 0.11, alpha: 0.96).cgColor
    layer?.borderColor = NSColor(calibratedWhite: 1, alpha: 0.18).cgColor
    layer?.borderWidth = 1
    layer?.cornerRadius = 7
    layer?.shadowColor = NSColor.black.cgColor
    layer?.shadowOpacity = 0.32
    layer?.shadowOffset = CGSize(width: 0, height: -5)
    layer?.shadowRadius = 12

    iconImageView.imageScaling = .scaleProportionallyDown
    iconImageView.wantsLayer = true
    iconImageView.layer?.cornerRadius = 3
    iconImageView.layer?.masksToBounds = true
    addSubview(iconImageView)

    titleLabel.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
    titleLabel.textColor = NSColor(calibratedWhite: 0.94, alpha: 1)
    titleLabel.lineBreakMode = .byTruncatingTail
    addSubview(titleLabel)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func configure(
    title: String,
    favicon: NSImage?,
    agentIconDataUrl: String?,
    agentIconColorHex: String?,
    maxWidth: CGFloat
  ) {
    titleLabel.stringValue = title
    let agentIconImage = nativePaneImage(fromDataUrl: agentIconDataUrl, isTemplate: true)
    iconImageView.image = favicon ?? agentIconImage
    iconImageView.contentTintColor =
      favicon == nil && agentIconImage != nil
      ? nativePaneColor(fromHex: agentIconColorHex) ?? NSColor.white : nil
    let measuredTitleWidth = ceil(
      (title as NSString).size(withAttributes: [
        .font: titleLabel.font ?? NSFont.systemFont(ofSize: 12, weight: .semibold)
      ]).width
    )
    let width = min(
      maxWidth,
      max(96, Self.horizontalPadding * 2 + Self.iconSize + Self.iconGap + measuredTitleWidth)
    )
    frame.size = CGSize(width: width, height: Self.height)
    needsLayout = true
    layoutSubtreeIfNeeded()
  }

  override func layout() {
    super.layout()
    iconImageView.frame = CGRect(
      x: Self.horizontalPadding,
      y: floor((bounds.height - Self.iconSize) / 2),
      width: Self.iconSize,
      height: Self.iconSize
    )
    let titleX = iconImageView.frame.maxX + Self.iconGap
    titleLabel.frame = CGRect(
      x: titleX,
      y: floor((bounds.height - 16) / 2),
      width: max(0, bounds.width - titleX - Self.horizontalPadding),
      height: 16
    )
  }

}

private final class TerminalTitleBarActionButton: NSButton {
  private static let normalTintColor = NSColor(calibratedWhite: 0.88, alpha: 0.72)
  private static let hoverTintColor = NSColor(calibratedWhite: 0.96, alpha: 0.88)
  private static let activeTintColor = NSColor(calibratedWhite: 1.0, alpha: 0.96)
  private static let hoverBackgroundColor = NSColor(calibratedWhite: 1.0, alpha: 0.11).cgColor
  private static let activeBackgroundColor = NSColor(calibratedWhite: 1.0, alpha: 0.18).cgColor

  private var hoverTrackingArea: NSTrackingArea?
  private var isPointerInside = false {
    didSet { updateActionChrome() }
  }

  override var isHighlighted: Bool {
    didSet { updateActionChrome() }
  }

  override var isEnabled: Bool {
    didSet { updateActionChrome() }
  }

  override var mouseDownCanMoveWindow: Bool {
    false
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    configureActionChrome()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configureActionChrome()
  }

  /**
   CDXC:PaneTitleBarUX 2026-05-08-16:02
   Pane title-bar actions across terminal, managed web/editor, and browser
   panes need clear interactivity without adding permanent chrome. A shared
   button subclass provides a subtle circular hover background, a slightly
   stronger pressed state, and the expected pointing-hand cursor everywhere the
   native title-bar action controls are used.

   CDXC:PaneTitleBarUX 2026-05-11-01:09
   Title-bar actions should read as compact rounded-square controls, but must
   not own custom cursor rects. AppKit was jumping between pointer, grab, and
   arrow while crossing tabs/title bars; keep these controls on the default
   cursor and express interactivity through chrome only.
   */
  private func configureActionChrome() {
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
    layer?.masksToBounds = true
    contentTintColor = Self.normalTintColor
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func layout() {
    super.layout()
    layer?.cornerRadius = min(5, min(bounds.width, bounds.height) / 3)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let hoverTrackingArea {
      removeTrackingArea(hoverTrackingArea)
    }
    let trackingArea = NSTrackingArea(
      rect: .zero,
      options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved],
      owner: self,
      userInfo: nil
    )
    hoverTrackingArea = trackingArea
    addTrackingArea(trackingArea)
  }

  override func mouseEntered(with event: NSEvent) {
    isPointerInside = true
  }

  override func mouseMoved(with event: NSEvent) {
    isPointerInside = true
  }

  override func mouseExited(with event: NSEvent) {
    isPointerInside = false
  }

  private func updateActionChrome() {
    guard isEnabled else {
      contentTintColor = Self.normalTintColor.withAlphaComponent(0.4)
      layer?.backgroundColor = NSColor.clear.cgColor
      return
    }
    if isHighlighted {
      contentTintColor = Self.activeTintColor
      layer?.backgroundColor = Self.activeBackgroundColor
    } else if isPointerInside {
      contentTintColor = Self.hoverTintColor
      layer?.backgroundColor = Self.hoverBackgroundColor
    } else {
      contentTintColor = Self.normalTintColor
      layer?.backgroundColor = NSColor.clear.cgColor
    }
  }
}

private func nativePaneTabsDebugFrame(_ frame: CGRect) -> [String: Double] {
  [
    "height": Double(frame.height),
    "maxX": Double(frame.maxX),
    "maxY": Double(frame.maxY),
    "minX": Double(frame.minX),
    "minY": Double(frame.minY),
    "width": Double(frame.width),
  ]
}

private final class TerminalTitleBarDebugOverlayView: NSView {
  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }
}

private final class TerminalTitleBarTabButton: NSButton {
  enum InlineAction {
    case close
    case sleep
  }

  private static let inlineButtonWidth: CGFloat = 22
  private static let inlineButtonHeight: CGFloat = 18
  private static let inlineButtonGap: CGFloat = 0
  private static let inlineButtonTrailingPadding: CGFloat = 4
  private static let inlineButtonBackgroundColor = NSColor(calibratedWhite: 0.16, alpha: 1).cgColor
  private static let inlineButtonHoverBackgroundColor = NSColor(calibratedWhite: 0.24, alpha: 1).cgColor
  private static let inlineButtonDividerColor = NSColor(calibratedWhite: 0.42, alpha: 1).cgColor
  private static let inlineButtonSymbolColor = NSColor(calibratedWhite: 0.94, alpha: 1)
  private static let inlineButtonIconColor = NSColor(calibratedWhite: 0.94, alpha: 1).cgColor
  private static let inlineButtonSymbolFont = NSFont.systemFont(ofSize: 10, weight: .semibold)
  private static let workingIndicatorColor = NSColor(
    calibratedRed: 0xF5 / 255,
    green: 0x9E / 255,
    blue: 0x0B / 255,
    alpha: 1
  ).cgColor
  private static let attentionIndicatorColor = NSColor(
    calibratedRed: 0x65 / 255,
    green: 0xE5 / 255,
    blue: 0x8A / 255,
    alpha: 1
  ).cgColor
  private static let sleepingIconColor = NSColor(calibratedWhite: 0.86, alpha: 0.42)
  private static let sleepingIconSize: CGFloat = 9
  private static let activityIndicatorSize: CGFloat = 8
  private static let activityIndicatorTrailingPadding: CGFloat = 9
  private static let titleLeadingPadding: CGFloat = 8
  private static let identityIconSize: CGFloat = 12
  private static let identityIconGap: CGFloat = 5
  private static let titleInlineActionGap: CGFloat = 4
  private static let titleTextHeight: CGFloat = 18
  private static let titleVerticalOffset: CGFloat = 0

  /**
   CDXC:PaneTabs 2026-05-10-18:30
   Pane tabs are native title-bar controls because Ghostty and WKWebView panes
   sit above the React workspace. Buttons forward mouse-down/drag/up with their
   session id so tab selection and tab drag/drop persist through the same
   paneLayout state as split commands.
   */
  var sessionId = ""
  var onTabMouseDown: ((NSEvent, String) -> Void)?
  var onTabMouseDragged: ((NSEvent, String) -> Void)?
  var onTabMouseUp: ((NSEvent, String) -> Void)?
  var onTabCloseRequested: ((String, PaneTabCloseScope) -> Void)?
  var onTabSleepRequested: ((String, PaneTabSleepScope) -> Void)?
  private var activity: NativeTerminalActivity?
  private var hoveredInlineAction: InlineAction? {
    didSet {
      guard oldValue != hoveredInlineAction else { return }
      needsDisplay = true
    }
  }
  private var isActiveTab = false
  private var identityAgentIconColor: NSColor?
  private var identityAgentIconColorHex: String?
  private var identityAgentIconDataUrl: String?
  private var identityAgentIconImage: NSImage?
  private var identityFaviconDataUrl: String?
  private var identityFaviconImage: NSImage?
  private var isFocusedPane = true
  private var isSleepingTab = false
  private var isTabHovered = false {
    didSet {
      guard oldValue != isTabHovered else { return }
      needsDisplay = true
    }
  }

  override var mouseDownCanMoveWindow: Bool {
    false
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    configure()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configure()
  }

  private func configure() {
    wantsLayer = true
    layer?.cornerRadius = 5
    layer?.masksToBounds = true
    bezelStyle = .texturedRounded
    isBordered = false
    font = NSFont.systemFont(ofSize: 11, weight: .semibold)
    lineBreakMode = .byTruncatingTail
    imagePosition = .noImage
  }

  func setActive(_ isActive: Bool) {
    isActiveTab = isActive
    updateChrome()
  }

  func setSleeping(_ isSleeping: Bool) {
    guard isSleepingTab != isSleeping else {
      return
    }
    isSleepingTab = isSleeping
    updateChrome()
  }

  func setFocusedPane(_ isFocused: Bool) {
    guard isFocusedPane != isFocused else {
      return
    }
    isFocusedPane = isFocused
    updateChrome()
  }

  private func updateChrome() {
    contentTintColor = titleColor
    layer?.backgroundColor = (
      isActiveTab
        ? NSColor(calibratedWhite: 1, alpha: isFocusedPane ? (isSleepingTab ? 0.075 : 0.13) : 0.05)
        : NSColor(calibratedWhite: 1, alpha: isFocusedPane ? (isSleepingTab ? 0.032 : 0.06) : 0.024)
    ).cgColor
    needsDisplay = true
  }

  func setTabHovered(_ hovered: Bool) {
    isTabHovered = hovered
  }

  func setHoveredInlineAction(_ action: InlineAction?) {
    hoveredInlineAction = action
  }

  func setActivity(_ nextActivity: NativeTerminalActivity?) {
    guard activity != nextActivity else {
      return
    }
    activity = nextActivity
    needsDisplay = true
  }

  func setIdentityIconDataUrl(
    faviconDataUrl: String?,
    agentIconDataUrl: String?,
    agentIconColorHex: String?
  ) {
    guard identityFaviconDataUrl != faviconDataUrl
      || identityAgentIconDataUrl != agentIconDataUrl
      || identityAgentIconColorHex != agentIconColorHex
    else {
      return
    }
    identityFaviconDataUrl = faviconDataUrl
    identityAgentIconDataUrl = agentIconDataUrl
    identityAgentIconColorHex = agentIconColorHex
    identityFaviconImage = nativePaneImage(fromDataUrl: faviconDataUrl, isTemplate: false)
    identityAgentIconImage = nativePaneImage(fromDataUrl: agentIconDataUrl, isTemplate: true)
    identityAgentIconColor = nativePaneColor(fromHex: agentIconColorHex)
    needsDisplay = true
  }

  func inlineAction(at point: NSPoint) -> InlineAction? {
    /**
     CDXC:PaneTabs 2026-05-11-11:47
     Inline Sleep/Close hit testing follows the visible tab geometry, not the
     cached hover flag. Narrow panes can receive mouseDown immediately after a
     layout or scroll change, before AppKit has delivered a fresh mouseMoved.
     */
    if closeButtonFrame.contains(point) {
      return .close
    }
    if !isSleepingTab, sleepButtonFrame.contains(point) {
      return .sleep
    }
    return nil
  }

  override func draw(_ dirtyRect: NSRect) {
    /**
     CDXC:PaneTabs 2026-05-11-02:28
     Native tab titles are drawn manually so labels stay left-aligned and
     truncate before hover actions. AppKit's default button title is centered
     and does not reserve space for the inline Sleep/Close controls.

     CDXC:PaneTabs 2026-05-11-03:04
     Reserve the inline action area even before hover so long tab titles do not
     visually resize or shift when Sleep/Close appear. The title baseline is
     nudged up 1px to align with the native title-bar button icons.

     CDXC:PaneTabs 2026-05-11-03:15
     Tabs mirror session-card activity indicators: orange means working and
     green means attention/done. Draw the indicator on the right only while the
     tab is not hovered; hover controls float above the title instead of
     changing the title rect, so text truncation is stable while hovering.

     CDXC:PaneTabs 2026-05-11-08:32
     Main work-area tabs should show the same session identity cue as sidebar
     cards: browser favicon first, otherwise the projected agent/browser mask
     icon tinted with the sidebar's per-agent color. The icon is drawn inside
     the native tab button because these tabs are AppKit controls, not React.

     CDXC:PaneTabs 2026-05-11-03:18
     Sleep/Close tab controls need per-button hover feedback without changing
     layout. Draw them as one opaque segmented control so title text cannot show
     through between the actions, and keep the icons explicitly light on dark
     tab chrome.

     CDXC:PaneTabs 2026-05-11-08:15
     Inline tab actions need opaque split-control chrome, but their symbols
     must preserve glyph alpha. Draw Close as explicit strokes and render the
     preferred SF moon through an isolated alpha mask so icons do not become
     white bounding boxes.

     CDXC:PaneTabs 2026-05-11-08:27
     The masked SF moon must not paint up to the symbol rect's horizontal edge
     because AppKit can leave faint vertical mask-edge artifacts. Keep 2px more
     horizontal padding around inline action icons and widen each action half
     so the icons keep their original usable drawing width. Leave the segmented
     control divider fixed between the two halves.

     CDXC:PaneTabs 2026-05-11-08:51
     Widen only the inline action segments, not their height. The tab title bar
     is 22px high, but the action chrome is intentionally 18px high; making the
     button 22px tall made the padded moon draw into a non-square rect and
     reintroduced SF Symbol edge artifacts.

     CDXC:PaneTabs 2026-05-11-09:14
     Inline Sleep must not use the generic mask-tint helper because its filled
     mask rect can leave a faint square border around SF Symbols. Draw the moon
     with an AppKit symbol color configuration so only the symbol glyph paints.

     CDXC:PaneTabs 2026-05-11-06:57
     Sleeping tabs use the moon itself as the right-side state marker instead
     of drawing both a leading moon and a gray indicator dot. Keep the marker in
     the same reserved right slot as working/attention so tab titles truncate
     before status UI consistently.
     */
    drawIdentityIconIfNeeded()
    drawTitle()
    if !isTabHovered {
      drawActivityIndicatorIfNeeded()
      drawDebugHitBounds()
      return
    }
    /**
     CDXC:PaneTabs 2026-05-11-02:02
     Per-session close and sleep controls live on the hovered tab, not on the
     pane titlebar action cluster. Draw compact inline controls inside the tab
     and keep hit testing in TerminalSessionTitleBarView so tab drag routing
     remains single-sourced.
     */
    drawInlineActionControl()
    drawDebugHitBounds()
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func mouseDown(with event: NSEvent) {
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.mouseDown", details: [
      "buttonBounds": nativePaneTabsDebugFrame(bounds),
      "buttonFrame": nativePaneTabsDebugFrame(frame),
      "sessionId": sessionId,
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
    onTabMouseDown?(event, sessionId)
  }

  override func mouseDragged(with event: NSEvent) {
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.mouseDragged", details: [
      "buttonBounds": nativePaneTabsDebugFrame(bounds),
      "buttonFrame": nativePaneTabsDebugFrame(frame),
      "sessionId": sessionId,
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
    onTabMouseDragged?(event, sessionId)
  }

  override func mouseUp(with event: NSEvent) {
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.mouseUp", details: [
      "buttonBounds": nativePaneTabsDebugFrame(bounds),
      "buttonFrame": nativePaneTabsDebugFrame(frame),
      "sessionId": sessionId,
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
    onTabMouseUp?(event, sessionId)
  }

  override func otherMouseDown(with event: NSEvent) {
    if event.buttonNumber != 2 {
      super.otherMouseDown(with: event)
      return
    }
    /**
     CDXC:PaneTabs 2026-05-11-01:25
     Middle-clicking a native pane tab is a direct tab close gesture. Consume
     button 2 on the tab button so the embedded terminal/web surface never sees
     the middle click, then close via the same scoped tab-close path as the
     context menu's Close action.
     */
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.middleMouseDown", details: [
      "buttonBounds": nativePaneTabsDebugFrame(bounds),
      "buttonFrame": nativePaneTabsDebugFrame(frame),
      "sessionId": sessionId,
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
  }

  override func otherMouseUp(with event: NSEvent) {
    if event.buttonNumber != 2 {
      super.otherMouseUp(with: event)
      return
    }
    let point = convert(event.locationInWindow, from: nil)
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.button.middleMouseUp", details: [
      "buttonBounds": nativePaneTabsDebugFrame(bounds),
      "buttonFrame": nativePaneTabsDebugFrame(frame),
      "isInside": bounds.contains(point),
      "sessionId": sessionId,
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
    if bounds.contains(point) {
      onTabCloseRequested?(sessionId, .close)
    }
  }

  override func otherMouseDragged(with event: NSEvent) {
    if event.buttonNumber == 2 {
      return
    }
    super.otherMouseDragged(with: event)
  }

  override func rightMouseDown(with event: NSEvent) {
    /**
     CDXC:PaneTabs 2026-05-11-00:45
     Native pane tabs need group-scoped sleep and close commands from the tab
     itself. The menu reports only the clicked tab and requested scope; the
     sidebar resolves the containing tab node so scoped actions never affect
     unrelated panes or other tab groups.
     */
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.contextMenu.opened", details: [
      "buttonBounds": nativePaneTabsDebugFrame(bounds),
      "buttonFrame": nativePaneTabsDebugFrame(frame),
      "sessionId": sessionId,
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
    let menu = NSMenu()
    addTabSleepMenuItem("Sleep Right", scope: .sleepRight, to: menu)
    addTabSleepMenuItem("Sleep Left", scope: .sleepLeft, to: menu)
    addTabSleepMenuItem("Sleep Other Tabs", scope: .sleepOthers, to: menu)
    menu.addItem(NSMenuItem.separator())
    addTabCloseMenuItem("Close Right", scope: .closeRight, to: menu)
    addTabCloseMenuItem("Close Left", scope: .closeLeft, to: menu)
    addTabCloseMenuItem("Close Other Tabs", scope: .closeOthers, to: menu)
    NSMenu.popUpContextMenu(menu, with: event, for: self)
  }

  private func addTabSleepMenuItem(_ title: String, scope: PaneTabSleepScope, to menu: NSMenu) {
    let item = NSMenuItem(title: title, action: #selector(performTabSleepMenuItem(_:)), keyEquivalent: "")
    item.representedObject = scope.rawValue
    item.target = self
    menu.addItem(item)
  }

  private func addTabCloseMenuItem(_ title: String, scope: PaneTabCloseScope, to menu: NSMenu) {
    let item = NSMenuItem(title: title, action: #selector(performTabCloseMenuItem(_:)), keyEquivalent: "")
    item.representedObject = scope.rawValue
    item.target = self
    menu.addItem(item)
  }

  @objc private func performTabCloseMenuItem(_ sender: NSMenuItem) {
    guard let rawScope = sender.representedObject as? String,
      let scope = PaneTabCloseScope(rawValue: rawScope)
    else {
      return
    }
    onTabCloseRequested?(sessionId, scope)
  }

  @objc private func performTabSleepMenuItem(_ sender: NSMenuItem) {
    guard let rawScope = sender.representedObject as? String,
      let scope = PaneTabSleepScope(rawValue: rawScope)
    else {
      return
    }
    onTabSleepRequested?(sessionId, scope)
  }

  private var closeButtonFrame: CGRect {
    return CGRect(
      x: bounds.maxX - Self.inlineButtonTrailingPadding - Self.inlineButtonWidth,
      y: floor((bounds.height - Self.inlineButtonHeight) / 2),
      width: Self.inlineButtonWidth,
      height: Self.inlineButtonHeight)
  }

  private var sleepButtonFrame: CGRect {
    return CGRect(
      x: closeButtonFrame.minX - Self.inlineButtonGap - Self.inlineButtonWidth,
      y: floor((bounds.height - Self.inlineButtonHeight) / 2),
      width: Self.inlineButtonWidth,
      height: Self.inlineButtonHeight)
  }

  private var inlineActionControlFrame: CGRect {
    if isSleepingTab {
      return closeButtonFrame
    }
    return sleepButtonFrame.union(closeButtonFrame)
  }

  private var titleColor: NSColor {
    let baseWhite: CGFloat = isActiveTab ? 0.96 : 0.78
    let baseAlpha: CGFloat = isActiveTab ? 0.98 : 0.82
    let sleepAlpha: CGFloat = isSleepingTab ? 0.48 : 1
    return NSColor(calibratedWhite: baseWhite, alpha: baseAlpha * sleepAlpha * (isFocusedPane ? 1 : 0.58))
  }

  private func drawDebugHitBounds() {
    /**
     CDXC:PaneTabs 2026-05-11-12:46
     Magenta marks the exact native NSButton bounds for each pane tab. The
     workspace-level repro compares this against green title-bar viewport and
     yellow splitter rails to identify which AppKit view owns the blocked click.
     */
    NSColor(calibratedRed: 1, green: 0, blue: 0.95, alpha: 0.10).setFill()
    bounds.fill()
    NSColor(calibratedRed: 1, green: 0, blue: 0.95, alpha: 0.84).setStroke()
    let path = NSBezierPath(rect: bounds.insetBy(dx: 0.5, dy: 0.5))
    path.lineWidth = 1
    path.stroke()
  }

  private func drawTitle() {
    let titleLeadingInset = titleLeadingInsetForIdentity()
    let reservedTrailingWidth = titleTrailingReservedWidth()
    let titleRect = CGRect(
      x: titleLeadingInset,
      y: floor((bounds.height - Self.titleTextHeight) / 2) + Self.titleVerticalOffset,
      width: max(bounds.width - titleLeadingInset - reservedTrailingWidth, 0),
      height: Self.titleTextHeight)
    guard titleRect.width > 0 else {
      return
    }

    let paragraphStyle = NSMutableParagraphStyle()
    paragraphStyle.alignment = .left
    paragraphStyle.lineBreakMode = .byTruncatingTail
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font ?? NSFont.systemFont(ofSize: 11, weight: .semibold),
      .foregroundColor: titleColor,
      .paragraphStyle: paragraphStyle,
    ]
    (title as NSString).draw(in: titleRect, withAttributes: attributes)
  }

  private func titleLeadingInsetForIdentity() -> CGFloat {
    guard hasIdentityIcon else {
      return Self.titleLeadingPadding
    }
    return Self.titleLeadingPadding + Self.identityIconSize + Self.identityIconGap
  }

  private var hasIdentityIcon: Bool {
    identityFaviconImage != nil || identityAgentIconImage != nil
  }

  private var identityIconFrame: CGRect {
    CGRect(
      x: Self.titleLeadingPadding,
      y: floor((bounds.height - Self.identityIconSize) / 2),
      width: Self.identityIconSize,
      height: Self.identityIconSize)
  }

  private func drawIdentityIconIfNeeded() {
    if let favicon = identityFaviconImage {
      favicon.draw(
        in: identityIconFrame,
        from: .zero,
        operation: .sourceOver,
        fraction: isFocusedPane ? 1 : 0.62,
        respectFlipped: true,
        hints: nil)
      return
    }
    guard let agentIcon = identityAgentIconImage else {
      return
    }
    drawTintedSymbol(
      agentIcon,
      in: identityIconFrame,
      color: identityAgentIconColor ?? NSColor(calibratedWhite: 0.9, alpha: 1),
      rotateDegrees: 0,
      mirrorX: false)
  }

  private func titleTrailingReservedWidth() -> CGFloat {
    if hasActivityIndicator {
      return bounds.maxX - activityIndicatorFrame.minX + Self.titleInlineActionGap
    }
    return Self.titleLeadingPadding
  }

  private var hasActivityIndicator: Bool {
    isSleepingTab || activity != nil
  }

  private var activityIndicatorFrame: CGRect {
    let size = Self.activityIndicatorSize
    return CGRect(
      x: bounds.maxX - Self.activityIndicatorTrailingPadding - size,
      y: floor((bounds.height - size) / 2),
      width: size,
      height: size)
  }

  private func drawActivityIndicatorIfNeeded() {
    if isSleepingTab || activity == .sleeping {
      drawSleepingIcon()
      return
    }
    let fillColor: CGColor?
    switch activity {
    case .attention:
      fillColor = Self.attentionIndicatorColor
    case .working:
      fillColor = Self.workingIndicatorColor
    case .sleeping, .none:
      fillColor = nil
    }
    guard let fillColor, let context = NSGraphicsContext.current?.cgContext else {
      return
    }
    context.saveGState()
    context.setFillColor(fillColor)
    context.fillEllipse(in: activityIndicatorFrame)
    context.restoreGState()
  }

  private func drawSleepingIcon() {
    let baseRect = activityIndicatorFrame
    let iconRect = CGRect(
      x: baseRect.midX - Self.sleepingIconSize / 2,
      y: floor((bounds.height - Self.sleepingIconSize) / 2) + 1,
      width: Self.sleepingIconSize,
      height: Self.sleepingIconSize)
    guard let image = NSImage(systemSymbolName: "moon.fill", accessibilityDescription: nil) else {
      return
    }
    drawTintedSymbol(
      image,
      in: iconRect,
      color: Self.sleepingIconColor,
      rotateDegrees: 0,
      mirrorX: false)
  }

  private func drawInlineActionControl() {
    guard let context = NSGraphicsContext.current?.cgContext else {
      return
    }
    let controlFrame = inlineActionControlFrame
    let controlPath = CGPath(
      roundedRect: controlFrame,
      cornerWidth: 5,
      cornerHeight: 5,
      transform: nil)

    context.saveGState()
    context.addPath(controlPath)
    context.setFillColor(Self.inlineButtonBackgroundColor)
    context.fillPath()

    context.addPath(controlPath)
    context.clip()
    if hoveredInlineAction == .close {
      context.setFillColor(Self.inlineButtonHoverBackgroundColor)
      context.fill(closeButtonFrame)
    } else if !isSleepingTab, hoveredInlineAction == .sleep {
      context.setFillColor(Self.inlineButtonHoverBackgroundColor)
      context.fill(sleepButtonFrame)
    }
    if !isSleepingTab {
      context.setFillColor(Self.inlineButtonDividerColor)
      context.fill(CGRect(
        x: closeButtonFrame.minX - 0.5,
        y: controlFrame.minY + 4,
        width: 1,
        height: max(controlFrame.height - 8, 1)))
    }
    context.restoreGState()

    if !isSleepingTab {
      drawInlineSleepSymbol(in: sleepButtonFrame)
    }
    drawInlineCloseSymbol(in: closeButtonFrame)
  }

  private func drawInlineCloseSymbol(in frame: CGRect) {
    guard let context = NSGraphicsContext.current?.cgContext else {
      return
    }
    let insetX: CGFloat = 7.8
    let insetY: CGFloat = 5.8
    context.saveGState()
    context.setStrokeColor(Self.inlineButtonIconColor)
    context.setLineWidth(1.5)
    context.setLineCap(.round)
    context.move(to: CGPoint(x: frame.minX + insetX, y: frame.minY + insetY))
    context.addLine(to: CGPoint(x: frame.maxX - insetX, y: frame.maxY - insetY))
    context.move(to: CGPoint(x: frame.maxX - insetX, y: frame.minY + insetY))
    context.addLine(to: CGPoint(x: frame.minX + insetX, y: frame.maxY - insetY))
    context.strokePath()
    context.restoreGState()
  }

  private func drawInlineSleepSymbol(in frame: CGRect) {
    guard let image = NSImage(systemSymbolName: "moon.fill", accessibilityDescription: nil) else {
      return
    }
    let iconSide = min(frame.width - 12.4, frame.height - 8)
    let iconRect = CGRect(
      x: frame.midX - iconSide / 2,
      y: frame.midY - iconSide / 2,
      width: iconSide,
      height: iconSide)
    drawConfiguredSymbol(
      image,
      in: iconRect,
      color: Self.inlineButtonSymbolColor,
      rotateDegrees: 180,
      mirrorX: true)
  }

  private func drawConfiguredSymbol(
    _ image: NSImage,
    in rect: CGRect,
    color: NSColor,
    rotateDegrees: CGFloat,
    mirrorX: Bool
  ) {
    guard let context = NSGraphicsContext.current?.cgContext else {
      return
    }
    let configuration = NSImage.SymbolConfiguration(paletteColors: [color])
    let configuredImage = image.withSymbolConfiguration(configuration) ?? image
    context.saveGState()
    context.translateBy(x: rect.midX, y: rect.midY)
    if mirrorX {
      context.scaleBy(x: -1, y: 1)
    }
    context.rotate(by: rotateDegrees * .pi / 180)
    context.translateBy(x: -rect.midX, y: -rect.midY)
    configuredImage.draw(
      in: rect,
      from: .zero,
      operation: .sourceOver,
      fraction: 1,
      respectFlipped: false,
      hints: nil)
    context.restoreGState()
  }

  private func drawTintedSymbol(
    _ image: NSImage,
    in rect: CGRect,
    color: NSColor,
    rotateDegrees: CGFloat,
    mirrorX: Bool
  ) {
    guard let context = NSGraphicsContext.current?.cgContext else {
      return
    }
    context.saveGState()
    context.translateBy(x: rect.midX, y: rect.midY)
    if mirrorX {
      context.scaleBy(x: -1, y: 1)
    }
    context.rotate(by: rotateDegrees * .pi / 180)
    context.translateBy(x: -rect.midX, y: -rect.midY)
    /**
     CDXC:PaneTabs 2026-05-11-03:04
     AppKit template symbols drawn manually do not reliably pick up button
     tint. Draw the SF Symbol as a mask filled with an explicit light color so
     Sleep/Close stay readable on dark tab chrome.
     */
    let maskRect = rect.insetBy(dx: 0.5, dy: 0)
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    color.setFill()
    maskRect.fill()
    image.draw(
      in: maskRect,
      from: .zero,
      operation: .destinationIn,
      fraction: 1,
      respectFlipped: rotateDegrees == 0,
      hints: nil)
    context.endTransparencyLayer()
    context.restoreGState()
  }
}

private final class TerminalSessionTitleBarView: NSView {
  struct TabItem: Equatable {
    let isSleeping: Bool
    let sessionId: String
    let title: String
  }

  struct TabReorderTarget {
    let lineFrame: CGRect
    let position: PaneTabReorderPosition
    let targetSessionId: String
  }

  private static let borderColor = NSColor(
    calibratedRed: 0x58 / 255,
    green: 0x6F / 255,
    blue: 0x95 / 255,
    alpha: 0.24
  ).cgColor
  private static let backgroundColor = NSColor(
    calibratedRed: 0x05 / 255,
    green: 0x06 / 255,
    blue: 0x08 / 255,
    alpha: 0.96
  ).cgColor
  private static let titleColor = NSColor(
    calibratedRed: 0xE1 / 255,
    green: 0xE1 / 255,
    blue: 0xE1 / 255,
    alpha: 1
  )
  private static let workingIndicatorColor = NSColor(
    calibratedRed: 0xF5 / 255,
    green: 0x9E / 255,
    blue: 0x0B / 255,
    alpha: 1
  ).cgColor
  private static let attentionIndicatorColor = NSColor(
    calibratedRed: 0x65 / 255,
    green: 0xE5 / 255,
    blue: 0x8A / 255,
    alpha: 1
  ).cgColor
  private static let actionSeparatorColor = NSColor(calibratedWhite: 1, alpha: 0.16).cgColor
  private static let minimumVisibleTabViewportWidth: CGFloat = 80
  private static let minimumVisibleTabViewportWidthWithDoubleClickTarget: CGFloat = 56
  private static let preferredDoubleClickNewTerminalTargetWidth: CGFloat = 34
  private static let minimumDoubleClickNewTerminalTargetWidth: CGFloat = 24
  private static let tabViewportTrailingGap: CGFloat = 4

  private let faviconImageView = NSImageView(frame: .zero)
  private let titleLabel = NSTextField(labelWithString: "")
  private let activityIndicatorView = NSView(frame: .zero)
  private let tabClipView = NSView(frame: .zero)
  private let tabContentView = NSView(frame: .zero)
  private let tabViewportDebugOverlayView = TerminalTitleBarDebugOverlayView(frame: .zero)
  private let tabClickBlockerDebugOverlayView = TerminalTitleBarDebugOverlayView(frame: .zero)
  private let doubleClickNewTerminalDebugOverlayView = TerminalTitleBarDebugOverlayView(frame: .zero)
  private let bottomBorderView = NSView(frame: .zero)
  private let actionMenuButton = TerminalTitleBarActionButton(title: "", target: nil, action: nil)
  private var actionButtons: [(action: TerminalTitleBarAction, button: NSButton)]
  private var actionSeparators: [NSView] = []
  private var activeTabSessionId: String?
  private var agentIconColor: NSColor?
  private var agentIconColorHex: String?
  private var agentIconDataUrl: String?
  private var agentIconImage: NSImage?
  private var activity: NativeTerminalActivity?
  private var faviconImage: NSImage?
  private var isFocusedPane = false
  private var layoutHiddenActions = Set<TerminalTitleBarAction>()
  private var collapsedActionMenuActions: [TerminalTitleBarAction] = []
  private var pendingMouseDownAction: TerminalTitleBarAction?
  private var pendingMouseDownCollapsedActionMenu = false
  private var pendingMouseDownTabInlineAction: (
    action: TerminalTitleBarTabButton.InlineAction, sessionId: String
  )?
  private var pendingMouseDownTabSessionId: String?
  private var tabContentWidth: CGFloat = 0
  private var tabScrollOffsetX: CGFloat = 0
  private var tabViewportFrame: CGRect = .zero
  private var doubleClickNewTerminalFrame: CGRect = .zero
  private var tabButtons: [TerminalTitleBarTabButton] = []
  private var tabItems: [TabItem] = []
  private var hoverTrackingArea: NSTrackingArea?
  private var suppressCursorRectInvalidationDuringHitTest = false
  private var isPaneHovered = false {
    didSet {
      updateActionButtonVisibility()
      if oldValue != isPaneHovered, let window, !suppressCursorRectInvalidationDuringHitTest {
        window.invalidateCursorRects(for: self)
      }
    }
  }
  private var isPointerInsideTitleBar = false {
    didSet {
      updateActionButtonVisibility()
      if oldValue != isPointerInsideTitleBar, let window, !suppressCursorRectInvalidationDuringHitTest {
        window.invalidateCursorRects(for: self)
      }
    }
  }
  var onMouseDown: ((NSEvent) -> Void)?
  var onAction: ((TerminalTitleBarAction) -> Void)?
  var onTabMouseDown: ((NSEvent, String) -> Void)?
  var onTabMouseDragged: ((NSEvent, String) -> Void)?
  var onTabMouseUp: ((NSEvent, String) -> Void)?
  var onTabSelected: ((String) -> Void)?
  var onTabCloseRequested: ((String, PaneTabCloseScope) -> Void)?
  var onTabSleepRequested: ((String, PaneTabSleepScope) -> Void)?
  var resizeCursorForPoint: ((NSPoint) -> NSCursor?)?

  override var isFlipped: Bool {
    true
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  var displayTitle: String {
    titleLabel.stringValue
  }

  var displayFavicon: NSImage? {
    faviconImage
  }

  func setPaneHovered(_ isHovered: Bool) {
    isPaneHovered = isHovered
  }

  func setFocusedPane(_ isFocused: Bool) {
    guard isFocusedPane != isFocused else {
      return
    }
    /**
     CDXC:PaneTabs 2026-05-11-02:11
     Tab groups belonging to panes that are not currently focused should be
     slightly dimmed. This makes the active pane's tab group visible without
     changing individual selected-tab styling or pane layout.
     */
    isFocusedPane = isFocused
    updateTabGroupFocusAppearance()
  }

  func setTabs(_ tabs: [TabItem], activeSessionId: String) {
    let nextTabs = tabs
    guard tabItems != nextTabs || activeTabSessionId != activeSessionId else {
      return
    }
    tabItems = nextTabs
    activeTabSessionId = nextTabs.isEmpty ? nil : activeSessionId
    while tabButtons.count > nextTabs.count {
      tabButtons.removeLast().removeFromSuperview()
    }
    while tabButtons.count < nextTabs.count {
      let button = TerminalTitleBarTabButton(title: "", target: nil, action: nil)
      button.onTabMouseDown = { [weak self] event, sessionId in
        self?.onTabMouseDown?(event, sessionId)
      }
      button.onTabMouseDragged = { [weak self] event, sessionId in
        self?.onTabMouseDragged?(event, sessionId)
      }
      button.onTabMouseUp = { [weak self] event, sessionId in
        self?.onTabMouseUp?(event, sessionId)
      }
      button.onTabCloseRequested = { [weak self] sessionId, scope in
        self?.onTabCloseRequested?(sessionId, scope)
      }
      button.onTabSleepRequested = { [weak self] sessionId, scope in
        self?.onTabSleepRequested?(sessionId, scope)
      }
      tabButtons.append(button)
      tabContentView.addSubview(button)
    }
    for (index, tab) in nextTabs.enumerated() {
      let button = tabButtons[index]
      button.sessionId = tab.sessionId
      button.title = tab.title
      button.toolTip = tab.title
      button.setActive(tab.sessionId == activeSessionId)
      button.setSleeping(tab.isSleeping)
    }
    updateTabGroupFocusAppearance()
    needsLayout = true
    window?.invalidateCursorRects(for: self)
  }

  func setTabActivities(_ activities: [String: NativeTerminalActivity]) {
    for button in tabButtons {
      button.setActivity(activities[button.sessionId])
    }
  }

  func setTabIdentityIcons(
    faviconDataUrls: [String: String],
    agentIconDataUrls: [String: String],
    agentIconColors: [String: String]
  ) {
    /**
     CDXC:PaneTabs 2026-05-11-08:32
     Native pane tabs mirror sidebar-card identity icons for every tab in the
     group, including parked and sleeping tabs that do not currently own a
     visible pane titlebar. Browser favicons win over the generic browser SVG;
     terminal/T3 tabs use the projected agent SVG and color.
     */
    for button in tabButtons {
      button.setIdentityIconDataUrl(
        faviconDataUrl: faviconDataUrls[button.sessionId],
        agentIconDataUrl: agentIconDataUrls[button.sessionId],
        agentIconColorHex: agentIconColors[button.sessionId])
    }
  }

  static let defaultActions: [TerminalTitleBarAction] = [
    .newTerminal,
    .openBrowser,
    .splitHorizontal,
    .splitVertical,
    .rename,
    .delayedSend,
    .fork,
    .reload,
    .popOut,
  ]

  /**
   CDXC:PaneTitleBarUX 2026-05-11-11:05
   Browser and T3 Code panes should expose the same creation/split chrome as
   the sidebar sync sends: Terminal, Browser, separator, Split Right, Split
   Down. Keep the initial native titlebar aligned before the first layout sync.
   */
  static let webPaneCreationActions: [TerminalTitleBarAction] = [
    .newTerminal,
    .openBrowser,
    .splitHorizontal,
    .splitVertical,
  ]

  init(title: String, actions: [TerminalTitleBarAction] = TerminalSessionTitleBarView.defaultActions) {
    /**
     CDXC:BrowserPanes 2026-05-11-11:05
     Browser panes keep navigation/tooling controls in their dedicated browser
     toolbar. Their pane title bar exposes only shared pane creation/split
     controls, while terminals keep the full session action set.
     */
    actionButtons = actions.map { action in
      (action, Self.makeActionButton(for: action))
    }
    super.init(frame: .zero)
    wantsLayer = true
    layer?.backgroundColor = Self.backgroundColor
    layer?.borderColor = Self.borderColor
    layer?.borderWidth = 0

    faviconImageView.imageScaling = .scaleProportionallyDown
    faviconImageView.isHidden = true
    faviconImageView.wantsLayer = true
    faviconImageView.layer?.cornerRadius = 3
    faviconImageView.layer?.masksToBounds = true

    titleLabel.stringValue = title
    titleLabel.font = NSFont.systemFont(ofSize: 12, weight: .bold)
    titleLabel.textColor = Self.titleColor
    titleLabel.lineBreakMode = .byTruncatingTail

    activityIndicatorView.wantsLayer = true
    activityIndicatorView.layer?.backgroundColor = NSColor.clear.cgColor
    activityIndicatorView.layer?.cornerRadius = 4
    activityIndicatorView.isHidden = true

    tabClipView.wantsLayer = true
    tabClipView.layer?.masksToBounds = true
    tabClipView.isHidden = true
    tabContentView.wantsLayer = true
    tabClipView.addSubview(tabContentView)

    /**
     CDXC:PaneTabs 2026-05-11-12:46
     The narrow-pane tab-click repro needs to separate title-bar-owned tab
     geometry from workspace-owned blockers. Green marks the tab viewport that
     should accept selection/inline-control clicks; if clicks fail while green
     and magenta are visible, the blocker is above the title bar.
     */
    tabViewportDebugOverlayView.wantsLayer = true
    tabViewportDebugOverlayView.layer?.backgroundColor = NSColor(
      calibratedRed: 0,
      green: 1,
      blue: 0.26,
      alpha: 0.18
    ).cgColor
    tabViewportDebugOverlayView.isHidden = true

    /**
     CDXC:PaneTabs 2026-05-11-12:39
     Narrow-pane tab repros need to distinguish the actual tab viewport from
     right-side title-bar chrome that can appear to block tab clicks. Keep this
     blue 30%-opacity overlay non-interactive and behind the existing red
     double-click target so both diagnostic regions are visible at once.
     */
    tabClickBlockerDebugOverlayView.wantsLayer = true
    tabClickBlockerDebugOverlayView.layer?.backgroundColor = NSColor(
      calibratedRed: 0,
      green: 0.34,
      blue: 1,
      alpha: 0.30
    ).cgColor
    tabClickBlockerDebugOverlayView.isHidden = true

    /**
     CDXC:PaneTabs 2026-05-11-12:23
     Narrow native tab bars need a visible, real empty-titlebar target for the
     user setting that double-clicks blank chrome to create a new terminal in
     the same pane. Keep this diagnostic overlay non-interactive so the same
     red 30%-opacity area is also the actual double-click hit target.
     */
    doubleClickNewTerminalDebugOverlayView.wantsLayer = true
    doubleClickNewTerminalDebugOverlayView.layer?.backgroundColor = NSColor(
      calibratedRed: 1,
      green: 0,
      blue: 0,
      alpha: 0.30
    ).cgColor
    doubleClickNewTerminalDebugOverlayView.isHidden = true

    bottomBorderView.wantsLayer = true
    bottomBorderView.layer?.backgroundColor = Self.borderColor

    addSubview(faviconImageView)
    addSubview(titleLabel)
    addSubview(activityIndicatorView)
    addSubview(tabClipView)
    addSubview(tabViewportDebugOverlayView)
    addSubview(tabClickBlockerDebugOverlayView)
    addSubview(doubleClickNewTerminalDebugOverlayView)
    for item in actionButtons {
      item.button.target = self
      item.button.action = #selector(performTitleBarAction(_:))
      addSubview(item.button)
    }
    configureActionMenuButton()
    syncActionSeparators()
    addSubview(bottomBorderView)
    updateActionButtonVisibility()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    isPointerInsideTitleBar = true
    if isCollapsedActionMenuPoint(point) {
      pendingMouseDownCollapsedActionMenu = true
      logCollapsedActionMenuEvent(
        "nativePaneActionMenu.titleBar.mouseDown",
        point: point,
        details: [
          "windowNumber": event.window?.windowNumber ?? NSNull()
        ])
      return
    }
    if let tabInlineAction = tabInlineAction(at: point) {
      pendingMouseDownTabInlineAction = tabInlineAction
      return
    }
    if let tabSessionId = tabSessionId(at: point) {
      pendingMouseDownTabSessionId = tabSessionId
      NativePaneTabDragReproLog.append(event: "nativePaneTabs.titleBar.mouseDown.tab", details: [
        "hitPoint": nativePaneTabsDebugFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
        "tabSessionId": tabSessionId,
      ])
      onTabMouseDown?(event, tabSessionId)
      return
    }
    if let action = actionButtonAction(at: point) {
      pendingMouseDownAction = action
      return
    }
    if event.clickCount >= 2, !tabItems.isEmpty, isEmptyTitleBarDoubleClickPoint(point) {
      /**
       CDXC:PaneTabs 2026-05-11-11:47
       Double-clicking unoccupied pane title-bar chrome creates a new terminal
       inside this pane's tab group. Real tab/control hits are excluded by
       isEmptyTitleBarDoubleClickPoint so activation, Sleep, Close, and menu
       clicks keep their normal single-click behavior.
       */
      NativePaneTabDragReproLog.append(event: "nativePaneTabs.titleBar.doubleClickNewTerminal", details: [
        "doubleClickFrame": nativePaneTabsDebugFrame(doubleClickNewTerminalFrame),
        "hitPoint": nativePaneTabsDebugFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
        "tabViewportFrame": nativePaneTabsDebugFrame(tabViewportFrame),
        "titleBarBounds": nativePaneTabsDebugFrame(bounds),
      ])
      onAction?(.newTerminal)
      return
    }
    onMouseDown?(event)
  }

  override func mouseDragged(with event: NSEvent) {
    if pendingMouseDownTabInlineAction != nil {
      return
    }
    if let tabSessionId = pendingMouseDownTabSessionId {
      onTabMouseDragged?(event, tabSessionId)
      return
    }
    if pendingMouseDownCollapsedActionMenu {
      return
    }
    if pendingMouseDownAction != nil {
      return
    }
  }

  override func mouseUp(with event: NSEvent) {
    if let pendingInlineAction = pendingMouseDownTabInlineAction {
      pendingMouseDownTabInlineAction = nil
      let point = convert(event.locationInWindow, from: nil)
      guard let currentInlineAction = tabInlineAction(at: point),
        currentInlineAction.action == pendingInlineAction.action,
        currentInlineAction.sessionId == pendingInlineAction.sessionId
      else {
        return
      }
      switch pendingInlineAction.action {
      case .close:
        onTabCloseRequested?(pendingInlineAction.sessionId, .close)
      case .sleep:
        onTabSleepRequested?(pendingInlineAction.sessionId, .sleep)
      }
      return
    }
    if pendingMouseDownCollapsedActionMenu {
      pendingMouseDownCollapsedActionMenu = false
      let point = convert(event.locationInWindow, from: nil)
      let isReleaseInside = isCollapsedActionMenuPoint(point)
      logCollapsedActionMenuEvent(
        "nativePaneActionMenu.titleBar.mouseUp",
        point: point,
        details: [
          "isReleaseInside": isReleaseInside,
          "windowNumber": event.window?.windowNumber ?? NSNull(),
        ])
      guard isReleaseInside else {
        return
      }
      showCollapsedActionMenu(from: actionMenuButton, source: "titleBarMouseUp")
      return
    }
    if let tabSessionId = pendingMouseDownTabSessionId {
      pendingMouseDownTabSessionId = nil
      onTabMouseUp?(event, tabSessionId)
      return
    }
    if let action = pendingMouseDownAction {
      pendingMouseDownAction = nil
      let point = convert(event.locationInWindow, from: nil)
      if actionButtonAction(at: point) == action {
        onAction?(action)
      }
      return
    }
  }

  override func rightMouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    guard let tabSessionId = tabSessionId(at: point) else {
      super.rightMouseDown(with: event)
      return
    }
    showTabContextMenu(for: tabSessionId, event: event)
  }

  override func scrollWheel(with event: NSEvent) {
    guard !tabItems.isEmpty, tabContentWidth > tabViewportFrame.width else {
      super.scrollWheel(with: event)
      return
    }
    let point = convert(event.locationInWindow, from: nil)
    guard tabViewportFrame.contains(point) else {
      super.scrollWheel(with: event)
      return
    }
    let rawDelta = abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY)
      ? event.scrollingDeltaX : event.scrollingDeltaY
    let maxOffset = max(tabContentWidth - tabViewportFrame.width, 0)
    tabScrollOffsetX = min(max(tabScrollOffsetX - rawDelta, 0), maxOffset)
    needsLayout = true
  }

  private func showTabContextMenu(for sessionId: String, event: NSEvent) {
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.titleBar.contextMenu.opened", details: [
      "sessionId": sessionId,
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
    let menu = NSMenu()
    /**
     CDXC:PaneTabs 2026-05-11-02:16
     Tab context menus group scoped sleep actions first and scoped close
     actions second. Single-tab Sleep and Close stay out of this menu because
     hovered tabs already expose direct inline buttons for those actions.
     */
    addTabSleepMenuItem("Sleep Right", scope: .sleepRight, sessionId: sessionId, to: menu)
    addTabSleepMenuItem("Sleep Left", scope: .sleepLeft, sessionId: sessionId, to: menu)
    addTabSleepMenuItem("Sleep Other Tabs", scope: .sleepOthers, sessionId: sessionId, to: menu)
    menu.addItem(NSMenuItem.separator())
    addTabCloseMenuItem("Close Right", scope: .closeRight, sessionId: sessionId, to: menu)
    addTabCloseMenuItem("Close Left", scope: .closeLeft, sessionId: sessionId, to: menu)
    addTabCloseMenuItem("Close Other Tabs", scope: .closeOthers, sessionId: sessionId, to: menu)
    NSMenu.popUpContextMenu(menu, with: event, for: self)
  }

  private func addTabSleepMenuItem(
    _ title: String,
    scope: PaneTabSleepScope,
    sessionId: String,
    to menu: NSMenu
  ) {
    let item = NSMenuItem(
      title: title,
      action: #selector(performTitleBarTabSleepMenuItem(_:)),
      keyEquivalent: "")
    item.representedObject = ["scope": scope.rawValue, "sessionId": sessionId]
    item.target = self
    menu.addItem(item)
  }

  private func addTabCloseMenuItem(
    _ title: String,
    scope: PaneTabCloseScope,
    sessionId: String,
    to menu: NSMenu
  ) {
    let item = NSMenuItem(
      title: title,
      action: #selector(performTitleBarTabCloseMenuItem(_:)),
      keyEquivalent: "")
    item.representedObject = ["scope": scope.rawValue, "sessionId": sessionId]
    item.target = self
    menu.addItem(item)
  }

  @objc private func performTitleBarTabCloseMenuItem(_ sender: NSMenuItem) {
    guard let payload = sender.representedObject as? [String: String],
      let sessionId = payload["sessionId"],
      let rawScope = payload["scope"],
      let scope = PaneTabCloseScope(rawValue: rawScope)
    else {
      return
    }
    onTabCloseRequested?(sessionId, scope)
  }

  @objc private func performTitleBarTabSleepMenuItem(_ sender: NSMenuItem) {
    guard let payload = sender.representedObject as? [String: String],
      let sessionId = payload["sessionId"],
      let rawScope = payload["scope"],
      let scope = PaneTabSleepScope(rawValue: rawScope)
    else {
      return
    }
    onTabSleepRequested?(sessionId, scope)
  }

  func isDraggableHeaderPoint(_ point: NSPoint) -> Bool {
    false
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard bounds.contains(point) else {
      return nil
    }
    /**
     CDXC:NativePaneReorder 2026-05-03-03:42
     Pane headers used to be draggable from visible title and empty title-bar
     chrome, but tab dragging is now the only pane-reorder gesture. Keep action
     buttons as normal controls and route tab hits through this title-bar view
     so hidden/offscreen tab sessions can still be selected and dragged.

     CDXC:NativePaneReorder 2026-05-11-01:16
     Drag-to-reorder starts only from tabs. Non-action subviews such as the
     title label, favicon, and activity dot still should not win hit testing,
     otherwise title-bar focus and tab hit routing can disappear behind labels.

     CDXC:BrowserPanes 2026-05-03-11:06
     Delegate action-button hit testing to AppKit so browser pane close is a
     normal NSButton click, matching T3 Code panes and preserving
     Accessibility activation. Empty title-bar chrome is focus-only.

     CDXC:PaneTitleBarUX 2026-05-11-10:50
     Collapsed pane actions keep a native AppKit menu button for drawing and
     accessibility, but the title-bar hit router owns pointer dispatch so
     narrow-pane clicks cannot fall through to tab focus.

     CDXC:PaneTitleBarUX 2026-05-11-11:55
     Narrow-pane hamburger clicks must still open the pane-action menu when
     AppKit routes the pointer stream to TerminalSessionTitleBarView instead
     of the borderless NSButton. Keep hit testing and the title-bar mouse
     fallback keyed to the same frame. Check the hamburger before tabs so the
     visible menu control wins any narrow-layout edge overlap, and emit repro
     logs only through the Settings debugging-mode gate.

    CDXC:PaneTitleBarUX 2026-05-11-12:23
    Handle hamburger hit streams on TerminalSessionTitleBarView itself. This
    keeps the menu opening path independent from AppKit's hover-dependent
    borderless-button dispatch while still using the same visible frame.

    CDXC:PaneTabs 2026-05-11-12:54
    AppKit can call hitTest while updating structural regions. Do not let that
    probe synchronously invalidate cursor rects through hover/action visibility
    changes, because the window throws when structural-region passes recurse.
     */
    if isCollapsedActionMenuPoint(point) {
      setPointerInsideTitleBarDuringHitTest(true, reason: "collapsedActionMenu")
      logCollapsedActionMenuEvent(
        "nativePaneActionMenu.titleBar.hitTest",
        point: point)
      return self
    }
    let tabSessionId = tabSessionId(at: point)
    if let tabSessionId {
      NativePaneTabDragReproLog.append(event: "nativePaneTabs.titleBar.hitTest.tab", details: [
        "hitPoint": nativePaneTabsDebugFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0)),
        "tabFrames": tabDebugFrames(),
        "tabSessionId": tabSessionId,
        "titleBarBounds": nativePaneTabsDebugFrame(bounds),
      ])
      return self
    }
    if actionButtonAction(at: point) != nil,
      let hitView = super.hitTest(point)
    {
      return hitView
    }
    return self
  }

  private func setPointerInsideTitleBarDuringHitTest(_ isInside: Bool, reason: String) {
    guard isPointerInsideTitleBar != isInside else {
      return
    }
    suppressCursorRectInvalidationDuringHitTest = true
    isPointerInsideTitleBar = isInside
    suppressCursorRectInvalidationDuringHitTest = false
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.titleBar.hitTestPointerState", details: [
      "isPointerInsideTitleBar": isInside,
      "reason": reason,
      "suppressedCursorRectInvalidation": true,
      "titleBarBounds": nativePaneTabsDebugFrame(bounds),
    ])
  }

  func tabSessionId(at point: NSPoint) -> String? {
    guard !tabClipView.isHidden, tabViewportFrame.contains(point) else {
      return nil
    }
    let contentPoint = CGPoint(
      x: point.x - tabViewportFrame.minX + tabScrollOffsetX,
      y: point.y - tabViewportFrame.minY)
    for button in tabButtons where !button.isHidden && button.frame.contains(contentPoint) {
      return button.sessionId
    }
    return nil
  }

  func tabFrame(for sessionId: String) -> CGRect? {
    guard let frame = tabButtons.first(where: { !$0.isHidden && $0.sessionId == sessionId })?.frame
    else {
      return nil
    }
    return CGRect(
      x: tabViewportFrame.minX + frame.minX - tabScrollOffsetX,
      y: tabViewportFrame.minY + frame.minY,
      width: frame.width,
      height: frame.height)
  }

  func tabInlineAction(at point: NSPoint) -> (
    action: TerminalTitleBarTabButton.InlineAction, sessionId: String
  )? {
    guard !tabClipView.isHidden, tabViewportFrame.contains(point) else {
      return nil
    }
    let contentPoint = CGPoint(
      x: point.x - tabViewportFrame.minX + tabScrollOffsetX,
      y: point.y - tabViewportFrame.minY)
    for button in tabButtons where !button.isHidden && button.frame.contains(contentPoint) {
      guard let action = button.inlineAction(
        at: CGPoint(x: contentPoint.x - button.frame.minX, y: contentPoint.y - button.frame.minY))
      else {
        return nil
      }
      return (action, button.sessionId)
    }
    return nil
  }

  func containsTab(_ sessionId: String) -> Bool {
    tabItems.contains { $0.sessionId == sessionId }
  }

  func isTabStripPoint(_ point: NSPoint) -> Bool {
    !tabClipView.isHidden && tabViewportFrame.contains(point)
  }

  func tabReorderTarget(at point: NSPoint, sourceSessionId: String) -> TabReorderTarget? {
    guard isTabStripPoint(point),
      let sourceIndex = tabItems.firstIndex(where: { $0.sessionId == sourceSessionId }),
      tabItems.count > 1
    else {
      return nil
    }
    let contentX = point.x - tabViewportFrame.minX + tabScrollOffsetX
    let insertionIndex = tabInsertionIndex(forContentX: contentX)
    let finalIndex = insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex
    guard finalIndex != sourceIndex else {
      return nil
    }
    let remainingTabs = tabItems.filter { $0.sessionId != sourceSessionId }
    guard !remainingTabs.isEmpty else {
      return nil
    }
    let targetSessionId: String
    let position: PaneTabReorderPosition
    if finalIndex <= 0 {
      targetSessionId = remainingTabs[0].sessionId
      position = .before
    } else if finalIndex >= remainingTabs.count {
      targetSessionId = remainingTabs[remainingTabs.count - 1].sessionId
      position = .after
    } else {
      targetSessionId = remainingTabs[finalIndex].sessionId
      position = .before
    }
    /**
     CDXC:PaneTabs 2026-05-11-01:43
     Tab reorder feedback is an insertion line, not the pane drop overlay. Hide
     the line for source-adjacent no-ops so dragging a tab back to its original
     slot gives no false indication that release will change order.
     */
    let lineX = min(
      max(tabInsertionLineContentX(forInsertionIndex: insertionIndex) - tabScrollOffsetX + tabViewportFrame.minX,
        tabViewportFrame.minX),
      tabViewportFrame.maxX)
    return TabReorderTarget(
      lineFrame: CGRect(
        x: lineX - 1,
        y: tabViewportFrame.minY + 4,
        width: 2,
        height: max(tabViewportFrame.height - 8, 6)),
      position: position,
      targetSessionId: targetSessionId)
  }

  private func tabInsertionIndex(forContentX contentX: CGFloat) -> Int {
    guard !tabButtons.isEmpty else {
      return 0
    }
    for (index, button) in tabButtons.enumerated() where !button.isHidden {
      if contentX < button.frame.midX {
        return index
      }
    }
    return tabButtons.count
  }

  private func tabInsertionLineContentX(forInsertionIndex insertionIndex: Int) -> CGFloat {
    let visibleButtons = tabButtons.filter { !$0.isHidden }
    guard !visibleButtons.isEmpty else {
      return 0
    }
    if insertionIndex <= 0 {
      return visibleButtons[0].frame.minX
    }
    if insertionIndex >= visibleButtons.count {
      return visibleButtons[visibleButtons.count - 1].frame.maxX
    }
    return visibleButtons[insertionIndex].frame.minX
  }

  private func tabDebugFrames() -> [[String: Any]] {
    tabButtons.map { button in
      [
        "frame": nativePaneTabsDebugFrame(button.frame),
        "isHidden": button.isHidden,
        "sessionId": button.sessionId,
        "title": button.title,
      ]
    }
  }

  func actionButtonAction(at point: NSPoint) -> TerminalTitleBarAction? {
    for item in actionButtons where isActionButtonVisible(item.action) && item.button.frame.contains(point) {
      return item.action
    }
    /**
     CDXC:BrowserPanes 2026-05-03-11:06
     Browser title bars currently expose only close. Give that close action a
     forgiving right-edge hit target so users can close browser panes like T3
     panes even when the tiny borderless AppKit button does not receive the
     click through the WKWebView pane stack.
     */
    if actionButtons.count == 1,
      actionButtons.first?.action == .close,
      CGRect(x: max(0, bounds.maxX - 44), y: 0, width: 44, height: bounds.height).contains(point)
    {
      return .close
    }
    return nil
  }

  private func isCollapsedActionMenuPoint(_ point: NSPoint) -> Bool {
    !collapsedActionMenuActions.isEmpty && !actionMenuButton.frame.isEmpty
      && actionMenuButton.frame.contains(point)
  }

  private func isEmptyTitleBarDoubleClickPoint(_ point: NSPoint) -> Bool {
    /**
     CDXC:PaneTabs 2026-05-11-11:47
     Double-clicking unused pane title-bar chrome creates a new terminal in the
     same tab group. Reject real tab, inline Sleep/Close, and action-control
     hits, but allow unoccupied tab-strip space so wide single-tab panes keep
     the fast "new terminal in this pane" gesture.

     CDXC:PaneTabs 2026-05-11-12:23
     Narrow panes can leave no obvious blank title-bar chrome once tabs and the
     collapsed action menu are visible. The reserved red target is explicitly
     empty chrome and must create a terminal even when the tab viewport is
     otherwise tight.
     */
    if doubleClickNewTerminalFrame.contains(point) {
      return true
    }
    if tabInlineAction(at: point) != nil || tabSessionId(at: point) != nil {
      return false
    }
    if isCollapsedActionMenuPoint(point) || actionButtonAction(at: point) != nil {
      return false
    }
    return bounds.contains(point)
  }

  override func resetCursorRects() {
    super.resetCursorRects()
    /**
     CDXC:PaneTitleBarUX 2026-05-11-01:09
     Pane title bars, tabs, and buttons must keep the default cursor. Previous
     pointer/open-hand cursor rects fought with AppKit tracking areas and caused
     visible cursor jumps while moving across title-bar controls.
     */
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let hoverTrackingArea {
      removeTrackingArea(hoverTrackingArea)
    }
    let trackingArea = NSTrackingArea(
      rect: .zero,
      options: [.activeInKeyWindow, .cursorUpdate, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved],
      owner: self,
      userInfo: nil
    )
    hoverTrackingArea = trackingArea
    addTrackingArea(trackingArea)
  }

  override func cursorUpdate(with event: NSEvent) {
    updateCursor(for: event)
  }

  override func mouseEntered(with event: NSEvent) {
    isPointerInsideTitleBar = true
    updateHoveredTab(for: convert(event.locationInWindow, from: nil))
    updateCursor(for: event)
  }

  override func mouseMoved(with event: NSEvent) {
    isPointerInsideTitleBar = true
    updateHoveredTab(for: convert(event.locationInWindow, from: nil))
    updateCursor(for: event)
  }

  override func mouseExited(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if bounds.contains(point) {
      isPointerInsideTitleBar = true
      updateHoveredTab(for: point)
      updateCursor(for: event)
      return
    }
    isPointerInsideTitleBar = false
    updateHoveredTab(for: nil)
    if updateResizeCursorIfNeeded(at: point) {
      return
    }
    NSCursor.arrow.set()
  }

  private func updateCursor(for event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if updateResizeCursorIfNeeded(at: point) {
      return
    }
    NSCursor.arrow.set()
  }

  private func updateResizeCursorIfNeeded(at point: NSPoint) -> Bool {
    /**
     CDXC:NativePaneResize 2026-05-11-10:05
     Title bars sit beside split rails and receive AppKit cursor update/exit
     callbacks near the boundary. They must honor the workspace splitter cursor
     hook before setting the default arrow, otherwise the cursor can settle back
     to arrow while the pointer is paused over a draggable split line.
     */
    guard let cursor = resizeCursorForPoint?(point) else {
      return false
    }
    cursor.set()
    return true
  }

  private func updateHoveredTab(for point: NSPoint?) {
    let hoveredSessionId = point.flatMap { tabSessionId(at: $0) }
    for button in tabButtons {
      button.setTabHovered(button.sessionId == hoveredSessionId)
    }
    let hoveredInlineAction = point.flatMap { tabInlineAction(at: $0) }
    for button in tabButtons {
      button.setHoveredInlineAction(
        button.sessionId == hoveredInlineAction?.sessionId ? hoveredInlineAction?.action : nil)
    }
  }

  private func updateTabGroupFocusAppearance() {
    tabContentView.alphaValue = 1.0
    for button in tabButtons {
      button.setFocusedPane(isFocusedPane)
    }
  }

  override func layout() {
    super.layout()
    let insetX: CGFloat = 8
    let buttonSize: CGFloat = 22
    let buttonGap: CGFloat = 0
    let separatorGap: CGFloat = 6
    let separatorWidth: CGFloat = 1
    let separatorHeight: CGFloat = 14
    let indicatorSize: CGFloat = 8
    let indicatorGap: CGFloat = 6
    let centerY = floor((bounds.height - buttonSize) / 2)
    let separatorY = floor((bounds.height - separatorHeight) / 2)
    var trailingX = bounds.width - insetX

    /**
     CDXC:NativeTerminals 2026-04-28-05:18
     Terminal titles should not truncate before reaching the right-side action
     cluster. Keep title-bar actions compact so pane names use the available
     chrome width while still leaving a non-overlapping hit target per action.

     CDXC:BrowserPanes 2026-05-03-01:58
     Browser pane title bars keep only normal session controls on the right.
     Browser navigation/tooling belongs in the address toolbar, while the
     webpage favicon and title identify the page on the left.

     CDXC:PaneTitleBarUX 2026-05-10-17:35
     Title-bar actions stay on the right with no dead hover gaps between
     buttons. Each button gets extra internal width for icon padding, and the
     layout hides lower-priority actions instead of letting the cluster overflow
     beyond the left edge of narrow panes.
     */
    var nextLayoutHiddenActions = Set<TerminalTitleBarAction>()
    let nonCloseActions = actionButtons.map(\.action).filter { $0 != .close }
    let fullActionClusterWidth = Self.actionClusterWidth(
      for: actionButtons.map(\.action),
      buttonSize: buttonSize,
      separatorGap: separatorGap,
      separatorWidth: separatorWidth)
    /**
     CDXC:PaneTitleBarUX 2026-05-11-11:47
     Narrow tabbed panes must keep native tabs clickable and draggable. Action
     buttons are AppKit subviews above the tab strip, so when the full horizontal
     cluster would leave less than a usable tab viewport, collapse non-close
     actions into a single native hamburger menu. If even that menu would clip
     a one-tab viewport below the tab's own minimum interactive width, hide the
     menu too; tab selection plus inline Sleep/Close are the primary narrow-pane
     controls.
     */
    let shouldCollapseActionMenu =
      !tabItems.isEmpty && !nonCloseActions.isEmpty
      && bounds.width - insetX * 2 - fullActionClusterWidth < 296
    let hasCloseAction = actionButtons.contains { $0.action == .close }
    let canReserveCloseActionInCollapsedLayout =
      hasCloseAction
      && bounds.width - insetX * 2 - buttonSize - Self.tabViewportTrailingGap
        >= Self.minimumVisibleTabViewportWidth
    let reservedCloseActionWidth = canReserveCloseActionInCollapsedLayout ? buttonSize : 0
    let canReserveCollapsedActionMenu =
      bounds.width - insetX * 2 - reservedCloseActionWidth - buttonSize - Self.tabViewportTrailingGap
        >= Self.minimumVisibleTabViewportWidth
    var separatorIndex = 0
    if shouldCollapseActionMenu {
      collapsedActionMenuActions = canReserveCollapsedActionMenu ? nonCloseActions : []
      for item in actionButtons {
        if item.action == .close && canReserveCloseActionInCollapsedLayout {
          trailingX -= buttonSize
          item.button.frame = CGRect(
            x: max(0, trailingX),
            y: centerY,
            width: min(buttonSize, bounds.width),
            height: buttonSize)
          trailingX -= buttonGap
        } else {
          item.button.frame = .zero
          nextLayoutHiddenActions.insert(item.action)
        }
      }
      if canReserveCollapsedActionMenu {
        trailingX -= buttonSize
        actionMenuButton.frame = CGRect(
          x: max(0, trailingX),
          y: centerY,
          width: min(buttonSize, bounds.width),
          height: buttonSize)
        trailingX -= buttonGap
      } else {
        actionMenuButton.frame = .zero
      }
      for separator in actionSeparators {
        separator.frame = .zero
      }
    } else {
      collapsedActionMenuActions = []
      actionMenuButton.frame = .zero
      var rightActionGroup: Int?
      for item in actionButtons.reversed() {
        let actionGroup = Self.actionGroup(for: item.action)
        if let rightActionGroup, rightActionGroup != actionGroup {
          let separatorAndButtonWidth = separatorGap + separatorWidth + separatorGap + buttonSize
          if trailingX - separatorAndButtonWidth < insetX && item.action != .close {
            item.button.frame = .zero
            nextLayoutHiddenActions.insert(item.action)
            continue
          }
          trailingX -= separatorGap
          if separatorIndex < actionSeparators.count {
            let separator = actionSeparators[separatorIndex]
            separator.frame = CGRect(
              x: trailingX - separatorWidth,
              y: separatorY,
              width: separatorWidth,
              height: separatorHeight
            )
          }
          trailingX -= separatorWidth + separatorGap
          separatorIndex += 1
        } else if trailingX - buttonSize < insetX && item.action != .close {
          item.button.frame = .zero
          nextLayoutHiddenActions.insert(item.action)
          continue
        }
        trailingX -= buttonSize
        item.button.frame = CGRect(
          x: max(0, trailingX),
          y: centerY,
          width: min(buttonSize, bounds.width),
          height: buttonSize)
        trailingX -= buttonGap
        rightActionGroup = actionGroup
      }
      if separatorIndex < actionSeparators.count {
        for index in separatorIndex..<actionSeparators.count {
          actionSeparators[index].frame = .zero
        }
      }
    }
    if layoutHiddenActions != nextLayoutHiddenActions {
      layoutHiddenActions = nextLayoutHiddenActions
      updateActionButtonVisibility()
    }

    if !tabItems.isEmpty {
      faviconImageView.isHidden = true
      faviconImageView.frame = .zero
      titleLabel.isHidden = true
      titleLabel.frame = .zero
      activityIndicatorView.isHidden = true
      activityIndicatorView.frame = .zero
      tabClipView.isHidden = false
      let tabViewportMaxX = reserveDoubleClickNewTerminalTarget(
        from: insetX,
        to: max(insetX, trailingX - Self.tabViewportTrailingGap))
      layoutTabButtons(
        from: insetX,
        to: tabViewportMaxX,
        centerY: centerY,
        height: buttonSize)
      updateTitleBarTabDebugOverlays()
      bottomBorderView.frame = CGRect(x: 0, y: bounds.height - 1, width: bounds.width, height: 1)
      window?.invalidateCursorRects(for: self)
      return
    }

    doubleClickNewTerminalFrame = .zero
    updateTitleBarTabDebugOverlays()
    tabClipView.isHidden = true
    tabClipView.frame = .zero
    tabContentView.frame = .zero
    tabViewportFrame = .zero
    tabContentWidth = 0
    tabScrollOffsetX = 0
    for button in tabButtons {
      button.frame = .zero
    }
    titleLabel.isHidden = false

    /**
     CDXC:NativeTerminals 2026-04-28-03:37
     Per-terminal title bars must not show the blue focused-session dot. Keep
     focus state visible through the pane border while preserving a small
     card-matched activity dot immediately after the title for done/working.
     */
    let faviconSize: CGFloat = 16
    let faviconGap: CGFloat = 6
    /**
     CDXC:NativePaneReorder 2026-05-03-04:52
     Pane title bars should identify terminal/T3 sessions with the same agent
     logo shown on the session card, using the existing favicon placement to
     avoid adding new chrome. Browser favicons remain higher priority because
     they identify the loaded page more specifically than the generic browser
     logo. Sidebar agent SVGs are mask assets, so native AppKit renders them as
     template images tinted with the same per-agent color as the session card
     instead of using their black source fill on dark chrome.
     */
    let identityImage = faviconImage ?? agentIconImage
    let hasIdentityImage = identityImage != nil
    faviconImageView.image = identityImage
    faviconImageView.contentTintColor =
      faviconImage == nil && agentIconImage != nil ? agentIconColor ?? Self.titleColor : nil
    if hasIdentityImage {
      faviconImageView.isHidden = false
      faviconImageView.frame = CGRect(
        x: insetX,
        y: floor((bounds.height - faviconSize) / 2),
        width: faviconSize,
        height: faviconSize
      )
    } else {
      faviconImageView.isHidden = true
      faviconImageView.frame = CGRect(
        x: insetX,
        y: floor((bounds.height - faviconSize) / 2),
        width: 0,
        height: 0
      )
    }
    let titleX = hasIdentityImage ? insetX + faviconSize + faviconGap : insetX
    let titleTrailing = trailingX
    let maxTitleWidth = max(
      titleTrailing - titleX - (activity == nil ? 2 : indicatorSize + indicatorGap + 2),
      0
    )
    /**
     CDXC:NativeTerminals 2026-05-01-02:18
     AppKit truncating text fields need a frame as wide as the title's usable
     area. Measuring the raw title is only for placing the activity dot; the
     label itself must span maxTitleWidth so native text drawing does not
     ellipsize against a stale or too-small intrinsic width.
     */
    let measuredTitleWidth = ceil(
      (titleLabel.stringValue as NSString).size(withAttributes: [
        .font: titleLabel.font ?? NSFont.systemFont(ofSize: 12, weight: .bold)
      ]).width
    )
    titleLabel.frame = CGRect(
      x: titleX,
      y: floor((bounds.height - 16) / 2),
      width: maxTitleWidth,
      height: 16
    )
    let visibleTitleWidth = min(measuredTitleWidth, maxTitleWidth)
    activityIndicatorView.frame = CGRect(
      x: titleLabel.frame.minX + visibleTitleWidth + indicatorGap,
      y: floor((bounds.height - indicatorSize) / 2),
      width: indicatorSize,
      height: indicatorSize
    )
    bottomBorderView.frame = CGRect(x: 0, y: bounds.height - 1, width: bounds.width, height: 1)
    /**
     CDXC:NativePaneReorder 2026-05-03-04:42
     Header drag affordance must stay visible after the pointer settles, not
     only during mouse-moved events. AppKit builds cursor rectangles from the
     laid-out action-button frames, so refresh them after layout changes the
     draggable title-bar width.
     */
    window?.invalidateCursorRects(for: self)
  }

  private func reserveDoubleClickNewTerminalTarget(from minX: CGFloat, to maxX: CGFloat) -> CGFloat {
    /**
     CDXC:PaneTabs 2026-05-11-12:23
     The double-click-to-new-terminal setting needs actual blank title-bar
     chrome in narrow panes. Reserve a compact target before the right-side
     action area instead of relying on leftover tab-strip slack that can vanish
     when a single tab expands to fill the viewport.
     */
    doubleClickNewTerminalFrame = .zero
    let availableWidth = max(maxX - minX, 0)
    let maximumTargetWidth =
      availableWidth - Self.minimumVisibleTabViewportWidthWithDoubleClickTarget
    guard maximumTargetWidth >= Self.minimumDoubleClickNewTerminalTargetWidth else {
      return maxX
    }
    let targetWidth = min(Self.preferredDoubleClickNewTerminalTargetWidth, maximumTargetWidth)
    let targetMinX = maxX - targetWidth
    doubleClickNewTerminalFrame = CGRect(
      x: targetMinX,
      y: 0,
      width: targetWidth,
      height: bounds.height)
    return max(minX, targetMinX - Self.tabViewportTrailingGap)
  }

  private func updateTitleBarTabDebugOverlays() {
    tabViewportDebugOverlayView.frame = tabViewportFrame
    tabViewportDebugOverlayView.isHidden = tabItems.isEmpty || tabViewportFrame.isEmpty
    let blockerFrame: CGRect
    if !tabItems.isEmpty, !tabViewportFrame.isEmpty, bounds.maxX > tabViewportFrame.maxX {
      blockerFrame = CGRect(
        x: tabViewportFrame.maxX,
        y: 0,
        width: bounds.maxX - tabViewportFrame.maxX,
        height: bounds.height)
    } else {
      blockerFrame = .zero
    }
    tabClickBlockerDebugOverlayView.frame = blockerFrame
    tabClickBlockerDebugOverlayView.isHidden = blockerFrame.isEmpty
    doubleClickNewTerminalDebugOverlayView.frame = doubleClickNewTerminalFrame
    doubleClickNewTerminalDebugOverlayView.isHidden =
      doubleClickNewTerminalFrame.isEmpty || tabItems.isEmpty
  }

  private func layoutTabButtons(from minX: CGFloat, to maxX: CGFloat, centerY: CGFloat, height: CGFloat) {
    let availableWidth = max(maxX - minX, 0)
    guard availableWidth > 0 else {
      tabClipView.frame = .zero
      tabContentView.frame = .zero
      tabViewportFrame = .zero
      tabContentWidth = 0
      for button in tabButtons {
        button.frame = .zero
      }
      return
    }
    /**
     CDXC:PaneTabs 2026-05-11-01:09
     Native pane tabs should always be visible, including single-pane layouts.
     Use consistent tab widths up to 175px, shrink evenly down to 80px when
     space is tight, then keep 80px tabs inside a clipped strip that scrolls
     horizontally from either vertical or horizontal wheel gestures.

     CDXC:PaneTabs 2026-05-11-11:47
     A single-tab pane should fit the visible viewport instead of forcing an
     80px scrollable tab. Narrow panes need the active terminal tab's inline
     Sleep/Close hit areas to stay inside the pane so activation and lifecycle
     controls remain usable without horizontal scrolling.
     */
    let gap: CGFloat = 2
    let maxTabWidth: CGFloat = 175
    let minTabWidth: CGFloat = 80
    let tabCount = max(tabButtons.count, 1)
    let totalGap = gap * CGFloat(max(tabCount - 1, 0))
    let fittedWidth = (availableWidth - totalGap) / CGFloat(tabCount)
    let tabWidth =
      tabCount == 1
      ? min(maxTabWidth, availableWidth)
      : fittedWidth >= minTabWidth ? min(maxTabWidth, fittedWidth) : minTabWidth
    tabContentWidth = tabWidth * CGFloat(tabCount) + totalGap
    tabViewportFrame = CGRect(x: minX, y: centerY, width: availableWidth, height: height)
    tabScrollOffsetX = min(max(tabScrollOffsetX, 0), max(tabContentWidth - availableWidth, 0))
    tabClipView.frame = tabViewportFrame
    tabContentView.frame = CGRect(
      x: -tabScrollOffsetX,
      y: 0,
      width: tabContentWidth,
      height: height)
    var nextX: CGFloat = 0
    for button in tabButtons {
      button.frame = CGRect(x: nextX, y: 0, width: tabWidth, height: height)
      nextX += tabWidth + gap
    }
  }

  func setTitle(_ title: String) {
    if titleLabel.stringValue != title {
      titleLabel.stringValue = title
      needsLayout = true
    }
  }

  func setActions(_ actions: [TerminalTitleBarAction]) {
    guard actionButtons.map(\.action) != actions else {
      return
    }

    for item in actionButtons {
      item.button.removeFromSuperview()
    }
    actionButtons = actions.map { action in
      (action, Self.makeActionButton(for: action))
    }
    for item in actionButtons {
      item.button.target = self
      item.button.action = #selector(performTitleBarAction(_:))
      addSubview(item.button)
    }
    if actionMenuButton.superview == nil {
      addSubview(actionMenuButton)
    }
    syncActionSeparators()
    updateActionButtonVisibility()
    needsLayout = true
    if let window {
      window.invalidateCursorRects(for: self)
    }
  }

  func setFavicon(_ image: NSImage?) {
    faviconImage = image
    needsLayout = true
  }

  func setAgentIconDataUrl(_ dataUrl: String?, colorHex: String?) {
    guard agentIconDataUrl != dataUrl || agentIconColorHex != colorHex else {
      return
    }
    /**
     CDXC:NativeGpu 2026-05-08-16:45
     Native pane chrome receives frequent sidebar metadata syncs. Decode SVG
     masks and relayout the title bar only when the icon payload actually
     changes, otherwise repeated status updates keep AppKit layers dirty.
     */
    agentIconDataUrl = dataUrl
    agentIconColorHex = colorHex
    agentIconImage = nativePaneImage(fromDataUrl: dataUrl, isTemplate: true)
    agentIconColor = nativePaneColor(fromHex: colorHex)
    needsLayout = true
  }

  func setState(activity nextActivity: NativeTerminalActivity?) {
    guard activity != nextActivity else {
      return
    }
    activity = nextActivity
    switch nextActivity {
    case .attention:
      activityIndicatorView.isHidden = false
      activityIndicatorView.layer?.backgroundColor = Self.attentionIndicatorColor
    case .working:
      activityIndicatorView.isHidden = false
      activityIndicatorView.layer?.backgroundColor = Self.workingIndicatorColor
    case .sleeping:
      activityIndicatorView.isHidden = true
      activityIndicatorView.layer?.backgroundColor = NSColor.clear.cgColor
    case .none:
      activityIndicatorView.isHidden = true
      activityIndicatorView.layer?.backgroundColor = NSColor.clear.cgColor
    }
    needsLayout = true
  }

  @objc private func performTitleBarAction(_ sender: NSButton) {
    guard let item = actionButtons.first(where: { $0.button === sender }),
      isActionButtonVisible(item.action)
    else {
      return
    }
    onAction?(item.action)
  }

  @objc private func performActionMenuButton(_ sender: NSButton) {
    showCollapsedActionMenu(from: sender, source: "buttonAction")
  }

  private func showCollapsedActionMenu(from _: NSButton, source: String) {
    let actions = collapsedActionMenuActions.filter { $0 != .close }
    logCollapsedActionMenuEvent(
      "nativePaneActionMenu.openRequested",
      point: actionMenuButton.frame.origin,
      details: [
        "actionCount": actions.count,
        "source": source,
      ])
    guard !actions.isEmpty else {
      return
    }
    let menu = NSMenu()
    for action in actions {
      let item = NSMenuItem(
        title: Self.actionMenuTitle(for: action),
        action: #selector(performCollapsedActionMenuItem(_:)),
        keyEquivalent: "")
      item.target = self
      item.representedObject = action.rawValue
      item.image = Self.actionMenuImage(for: action)
      menu.addItem(item)
    }
    /**
     CDXC:PaneTitleBarUX 2026-05-11-12:23
     Collapsed hamburger clicks are routed through the title-bar hit target so
     narrow panes do not depend on the borderless NSButton being visible or
     hovered at mouse-down time. Anchor the NSMenu in this title-bar coordinate
     space; using the button itself can fail when the hover state changes while
     the click is being processed.
     */
    let menuOrigin = CGPoint(x: actionMenuButton.frame.minX, y: actionMenuButton.frame.maxY + 2)
    let didOpen = menu.popUp(positioning: nil, at: menuOrigin, in: self)
    logCollapsedActionMenuEvent(
      "nativePaneActionMenu.openFinished",
      point: actionMenuButton.frame.origin,
      details: [
        "actionCount": actions.count,
        "didOpen": didOpen,
        "source": source,
      ])
  }

  @objc private func performCollapsedActionMenuItem(_ sender: NSMenuItem) {
    guard let rawValue = sender.representedObject as? String,
      let action = TerminalTitleBarAction(rawValue: rawValue)
    else {
      return
    }
    NativePaneTabDragReproLog.append(event: "nativePaneActionMenu.itemSelected", details: [
      "action": action.rawValue
    ])
    onAction?(action)
  }

  private func logCollapsedActionMenuEvent(
    _ event: String,
    point: NSPoint,
    details: [String: Any] = [:]
  ) {
    var payload = details
    payload["actions"] = collapsedActionMenuActions.map(\.rawValue)
    payload["buttonFrame"] = nativePaneTabsDebugFrame(actionMenuButton.frame)
    payload["buttonHidden"] = actionMenuButton.isHidden
    payload["buttonEnabled"] = actionMenuButton.isEnabled
    payload["buttonAlpha"] = Double(actionMenuButton.alphaValue)
    payload["hitPoint"] = nativePaneTabsDebugFrame(CGRect(x: point.x, y: point.y, width: 0, height: 0))
    payload["isPaneHovered"] = isPaneHovered
    payload["isPointerInsideTitleBar"] = isPointerInsideTitleBar
    payload["shouldShowCollapsedActionMenu"] = shouldShowCollapsedActionMenu
    payload["tabViewportFrame"] = nativePaneTabsDebugFrame(tabViewportFrame)
    payload["titleBarBounds"] = nativePaneTabsDebugFrame(bounds)
    NativePaneTabDragReproLog.append(event: event, details: payload)
  }

  private func configureActionMenuButton() {
    actionMenuButton.bezelStyle = .texturedRounded
    actionMenuButton.isBordered = false
    actionMenuButton.imagePosition = .imageOnly
    actionMenuButton.toolTip = "Pane Actions"
    actionMenuButton.target = self
    actionMenuButton.action = #selector(performActionMenuButton(_:))
    actionMenuButton.image = NSImage(
      systemSymbolName: "line.3.horizontal",
      accessibilityDescription: "Pane Actions")
    actionMenuButton.isHidden = true
    actionMenuButton.alphaValue = 0
    addSubview(actionMenuButton)
  }

  private func syncActionSeparators() {
    let desiredCount = Self.actionSeparatorCount(for: actionButtons.map(\.action))
    while actionSeparators.count > desiredCount {
      actionSeparators.removeLast().removeFromSuperview()
    }
    while actionSeparators.count < desiredCount {
      let separator = NSView(frame: .zero)
      separator.wantsLayer = true
      separator.layer?.backgroundColor = Self.actionSeparatorColor
      actionSeparators.append(separator)
      addSubview(separator)
    }
  }

  private func updateActionButtonVisibility() {
    /**
     CDXC:PaneTitleBarUX 2026-05-10-18:30
     Keep Close visible at all times, but reveal the rest of the title-bar
     action cluster while the pane is hovered. Layout may also hide actions on
     narrow panes so controls never spill into the pane to the left.
     */
    for item in actionButtons {
      let visible = isActionButtonVisible(item.action)
      item.button.isHidden = !visible
      item.button.alphaValue = visible ? 1 : 0
      item.button.isEnabled = visible
      if let window, !suppressCursorRectInvalidationDuringHitTest {
        window.invalidateCursorRects(for: item.button)
      }
    }
    let shouldShowSeparators = (isPaneHovered || isPointerInsideTitleBar) && actionButtons.count > 1
    for separator in actionSeparators {
      separator.alphaValue = shouldShowSeparators && !separator.frame.isEmpty ? 1 : 0
    }
    let menuVisible = shouldShowCollapsedActionMenu
    actionMenuButton.isHidden = !menuVisible
    actionMenuButton.alphaValue = menuVisible ? 1 : 0
    actionMenuButton.isEnabled = menuVisible
    if let window, !suppressCursorRectInvalidationDuringHitTest {
      window.invalidateCursorRects(for: actionMenuButton)
    }
  }

  private func isActionButtonVisible(_ action: TerminalTitleBarAction) -> Bool {
    !layoutHiddenActions.contains(action) && (action == .close || isPaneHovered || isPointerInsideTitleBar)
  }

  private var shouldShowCollapsedActionMenu: Bool {
    !collapsedActionMenuActions.isEmpty && (isPaneHovered || isPointerInsideTitleBar)
  }

  private static func actionSeparatorCount(for actions: [TerminalTitleBarAction]) -> Int {
    guard actions.count > 1 else {
      return 0
    }
    var count = 0
    var previousGroup = actionGroup(for: actions[0])
    for action in actions.dropFirst() {
      let group = actionGroup(for: action)
      if group != previousGroup {
        count += 1
      }
      previousGroup = group
    }
    return count
  }

  private static func actionClusterWidth(
    for actions: [TerminalTitleBarAction],
    buttonSize: CGFloat,
    separatorGap: CGFloat,
    separatorWidth: CGFloat
  ) -> CGFloat {
    guard !actions.isEmpty else {
      return 0
    }
    return CGFloat(actions.count) * buttonSize
      + CGFloat(actionSeparatorCount(for: actions)) * (separatorGap * 2 + separatorWidth)
  }

  private static func actionGroup(for action: TerminalTitleBarAction) -> Int {
    switch action {
    case .reload, .fork, .rename, .delayedSend:
      return 0
    case .splitHorizontal, .splitVertical:
      return 1
    case .openBrowser, .newTerminal:
      return 2
    case .popOut, .restorePopOut:
      return 3
    case .close, .sleep:
      return 4
    }
  }

  private static func makeActionButton(for action: TerminalTitleBarAction) -> NSButton {
    switch action {
    case .newTerminal:
      return makeActionButton(systemSymbolName: "terminal", fallbackTitle: "T", tooltip: "New Terminal")
    case .openBrowser:
      return makeActionButton(systemSymbolName: "globe", fallbackTitle: "B", tooltip: "Open Browser Pane")
    case .popOut:
      return makeActionButton(systemSymbolName: "arrow.up.right.square", fallbackTitle: "P", tooltip: "Pop Out Pane")
    case .restorePopOut:
      return makeActionButton(systemSymbolName: "arrow.down.left.square", fallbackTitle: "R", tooltip: "Restore Pane")
    case .splitHorizontal:
      return makeActionButton(systemSymbolName: "rectangle.split.2x1", fallbackTitle: "S", tooltip: "Split Sideways")
    case .splitVertical:
      return makeActionButton(systemSymbolName: "rectangle.split.1x2", fallbackTitle: "D", tooltip: "Split Downwards")
    case .rename:
      return makeActionButton(systemSymbolName: "pencil", fallbackTitle: "R", tooltip: "Rename Session")
    case .delayedSend:
      return makeActionButton(systemSymbolName: "clock", fallbackTitle: "D", tooltip: "Delayed Send")
    case .fork:
      return makeActionButton(systemSymbolName: "arrow.triangle.branch", fallbackTitle: "F", tooltip: "Fork Session")
    case .reload:
      return makeActionButton(systemSymbolName: "arrow.clockwise", fallbackTitle: "R", tooltip: "Reload Session")
    case .sleep:
      return makeActionButton(systemSymbolName: "moon", fallbackTitle: "S", tooltip: "Sleep Session")
    case .close:
      return makeActionButton(systemSymbolName: "xmark", fallbackTitle: "X", tooltip: "Close Session")
    }
  }

  private static func actionMenuTitle(for action: TerminalTitleBarAction) -> String {
    switch action {
    case .newTerminal:
      return "New Terminal"
    case .openBrowser:
      return "Open Browser Pane"
    case .popOut:
      return "Pop Out Pane"
    case .restorePopOut:
      return "Restore Pane"
    case .splitHorizontal:
      return "Split Sideways"
    case .splitVertical:
      return "Split Downwards"
    case .rename:
      return "Rename Session"
    case .delayedSend:
      return "Delayed Send"
    case .fork:
      return "Fork Session"
    case .reload:
      return "Reload Session"
    case .sleep:
      return "Sleep Session"
    case .close:
      return "Close Session"
    }
  }

  private static func actionMenuImage(for action: TerminalTitleBarAction) -> NSImage? {
    let symbolName: String
    switch action {
    case .newTerminal:
      symbolName = "terminal"
    case .openBrowser:
      symbolName = "globe"
    case .popOut:
      symbolName = "arrow.up.right.square"
    case .restorePopOut:
      symbolName = "arrow.down.left.square"
    case .splitHorizontal:
      symbolName = "rectangle.split.2x1"
    case .splitVertical:
      symbolName = "rectangle.split.1x2"
    case .rename:
      symbolName = "pencil"
    case .delayedSend:
      symbolName = "clock"
    case .fork:
      symbolName = "arrow.triangle.branch"
    case .reload:
      symbolName = "arrow.clockwise"
    case .sleep:
      symbolName = "moon"
    case .close:
      symbolName = "xmark"
    }
    return NSImage(systemSymbolName: symbolName, accessibilityDescription: actionMenuTitle(for: action))
  }

  private static func makeActionButton(
    systemSymbolName: String,
    fallbackTitle: String,
    tooltip: String
  ) -> NSButton {
    let button = TerminalTitleBarActionButton(title: "", target: nil, action: nil)
    button.bezelStyle = .texturedRounded
    button.isBordered = false
    button.imagePosition = .imageOnly
    button.toolTip = tooltip
    if let image = NSImage(systemSymbolName: systemSymbolName, accessibilityDescription: tooltip) {
      button.image = image
    } else {
      button.title = fallbackTitle
      button.font = NSFont.systemFont(ofSize: 11, weight: .bold)
    }
    return button
  }
}

final class ProjectEditorInitialLoadingOverlayView: NSView {
  private let spinnerContainer = NSView(frame: .zero)
  private let spinner = NSProgressIndicator(frame: .zero)

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    translatesAutoresizingMaskIntoConstraints = true
    autoresizesSubviews = true
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedRed: 0.086, green: 0.086, blue: 0.086, alpha: 1)
      .cgColor

    spinnerContainer.wantsLayer = true
    spinnerContainer.layer?.backgroundColor = NSColor(calibratedWhite: 0.17, alpha: 0.92).cgColor
    spinnerContainer.layer?.cornerRadius = 8
    spinnerContainer.layer?.borderWidth = 1
    spinnerContainer.layer?.borderColor = NSColor(calibratedWhite: 0.42, alpha: 0.24).cgColor
    addSubview(spinnerContainer)

    spinner.style = .spinning
    spinner.isIndeterminate = true
    spinner.controlSize = .regular
    spinner.isDisplayedWhenStopped = false
    spinner.usesThreadedAnimation = true
    spinner.appearance = NSAppearance(named: .darkAqua)
    spinnerContainer.addSubview(spinner)
    startAnimating()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layout() {
    super.layout()
    let containerSize = CGSize(width: 52, height: 52)
    spinnerContainer.frame = CGRect(
      x: floor((bounds.width - containerSize.width) / 2),
      y: floor((bounds.height - containerSize.height) / 2),
      width: containerSize.width,
      height: containerSize.height)
    let spinnerSize: CGFloat = 24
    spinner.frame = CGRect(
      x: floor((spinnerContainer.bounds.width - spinnerSize) / 2),
      y: floor((spinnerContainer.bounds.height - spinnerSize) / 2),
      width: spinnerSize,
      height: spinnerSize)
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }

  func startAnimating() {
    isHidden = false
    spinner.startAnimation(nil)
  }

  func stopAnimating() {
    spinner.stopAnimation(nil)
    isHidden = true
  }
}

final class WebPaneHostView: NSView, NSTextFieldDelegate {
  private enum BrowserPaneThemeMode: String {
    case system
    case light
    case dark

    var title: String {
      switch self {
      case .system:
        return "System"
      case .light:
        return "Light"
      case .dark:
        return "Dark"
      }
    }

    var symbolName: String {
      switch self {
      case .system:
        return "circle.lefthalf.filled"
      case .light:
        return "sun.max"
      case .dark:
        return "moon"
      }
    }
  }

  private static let browserToolbarHeight: CGFloat = 40
  private static let toolbarButtonSize = CGSize(width: 28, height: 28)
  private static let toolbarHorizontalPadding: CGFloat = 12
  private static let toolbarItemGap: CGFloat = 10
  private static let addressMinimumWidth: CGFloat = 180

  private let browserView: NSView
  private weak var chromiumView: ZmuxCEFBrowserView?
  private weak var webView: WKWebView?
  private let showsBrowserToolbar: Bool
  private let initialLoadingOverlayView: ProjectEditorInitialLoadingOverlayView?
  private let onFocus: (() -> Void)?
  private let onOpenDevTools: (() -> Void)?
  private let onInjectReactGrab: (() -> Void)?
  private let onShowProfilePicker: (() -> Void)?
  private let onShowImportSettings: (() -> Void)?
  private let toolbarView = NSView(frame: .zero)
  private let backButton = WebPaneHostView.makeToolbarButton(
    systemSymbolName: "chevron.left",
    fallbackTitle: "<",
    tooltip: "Back"
  )
  private let forwardButton = WebPaneHostView.makeToolbarButton(
    systemSymbolName: "chevron.right",
    fallbackTitle: ">",
    tooltip: "Forward"
  )
  private let reloadButton = WebPaneHostView.makeToolbarButton(
    systemSymbolName: "arrow.clockwise",
    fallbackTitle: "R",
    tooltip: "Reload"
  )
  private let securityIcon = NSImageView(frame: .zero)
  private let addressField = NSTextField(frame: .zero)
  private let devToolsButton = WebPaneHostView.makeToolbarButton(
    systemSymbolName: "wrench.and.screwdriver",
    fallbackTitle: "D",
    tooltip: "Toggle DevTools"
  )
  private let reactGrabButton = WebPaneHostView.makeToolbarButton(
    systemSymbolName: "cursorarrow.click.2",
    fallbackTitle: "RG",
    tooltip: "React Grab"
  )
  private let profileButton = WebPaneHostView.makeToolbarButton(
    systemSymbolName: "person.crop.circle",
    fallbackTitle: "P",
    tooltip: "Browser Profile"
  )
  private let appearanceButton = WebPaneHostView.makeToolbarButton(
    systemSymbolName: "circle.lefthalf.filled",
    fallbackTitle: "A",
    tooltip: "Toggle Page Appearance"
  )
  private var navigationObservations: [NSKeyValueObservation] = []
  private var addressFieldKeyMonitor: Any?
  private var browserThemeMode: BrowserPaneThemeMode = .system
  private var isEditingAddress = false

  init(
    browserView: NSView,
    chromiumView: ZmuxCEFBrowserView? = nil,
    webView: WKWebView? = nil,
    showsBrowserToolbar: Bool = false,
    showsInitialLoadingOverlay: Bool = false,
    initialAddress: String? = nil,
    onFocus: (() -> Void)? = nil,
    onOpenDevTools: (() -> Void)? = nil,
    onInjectReactGrab: (() -> Void)? = nil,
    onShowProfilePicker: (() -> Void)? = nil,
    onShowImportSettings: (() -> Void)? = nil
  ) {
    self.browserView = browserView
    self.chromiumView = chromiumView
    self.webView = webView
    self.showsBrowserToolbar = showsBrowserToolbar
    self.initialLoadingOverlayView =
      showsInitialLoadingOverlay ? ProjectEditorInitialLoadingOverlayView(frame: .zero) : nil
    self.onFocus = onFocus
    self.onOpenDevTools = onOpenDevTools
    self.onInjectReactGrab = onInjectReactGrab
    self.onShowProfilePicker = onShowProfilePicker
    self.onShowImportSettings = onShowImportSettings
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = true
    autoresizesSubviews = true
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedRed: 0.086, green: 0.086, blue: 0.086, alpha: 1)
      .cgColor
    layer?.masksToBounds = true
    browserView.translatesAutoresizingMaskIntoConstraints = true
    browserView.autoresizingMask = [.width, .height]
    browserView.frame = bounds
    if showsBrowserToolbar {
      configureBrowserToolbar(initialAddress: initialAddress)
      addSubview(toolbarView)
    }
    addSubview(browserView)
    if let initialLoadingOverlayView {
      addSubview(initialLoadingOverlayView)
    }
    updateBrowserToolbarState()
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    uninstallAddressFieldKeyMonitor()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    uninstallAddressFieldKeyMonitor()
    if window != nil {
      installAddressFieldKeyMonitor()
    }
  }

  override func layout() {
    super.layout()
    if showsBrowserToolbar, toolbarView.superview !== self {
      toolbarView.removeFromSuperview()
      addSubview(toolbarView)
    }
    if browserView.superview !== self {
      browserView.removeFromSuperview()
      addSubview(browserView)
    }
    let webFrame: CGRect
    if showsBrowserToolbar {
      let toolbarHeight = min(Self.browserToolbarHeight, max(0, bounds.height))
      toolbarView.frame = CGRect(
        x: 0,
        y: bounds.height - toolbarHeight,
        width: bounds.width,
        height: toolbarHeight
      )
      layoutBrowserToolbar()
      webFrame = CGRect(x: 0, y: 0, width: bounds.width, height: max(0, bounds.height - toolbarHeight))
    } else {
      webFrame = bounds
    }
    if browserView.frame != webFrame {
      browserView.frame = webFrame
    }
    layoutInitialLoadingOverlay(webFrame: webFrame)
  }

  func refreshBrowserToolbar(reason: String) {
    updateBrowserToolbarState()
  }

  func refreshHostedWebView(reason: String) {
    /**
     CDXC:EditorPanes 2026-05-08-13:02
     VS Code editor crashes during sidebar resize need before/after logging
     around hosted Chromium frame refresh, including whether refresh forces
     immediate layout/display on the CEF NSView.
     */
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.host.refresh.start", [
      "browserFrameBefore": Self.describeFrame(browserView.frame),
      "hostBounds": Self.describeFrame(bounds),
      "hostFrame": Self.describeFrame(frame),
      "reason": reason,
      "showsBrowserToolbar": showsBrowserToolbar,
      "webUrl": currentURLString() ?? NSNull(),
      "windowNumber": window?.windowNumber ?? NSNull(),
    ])
    if showsBrowserToolbar, toolbarView.superview !== self {
      toolbarView.removeFromSuperview()
      addSubview(toolbarView)
    }
    if browserView.superview !== self {
      browserView.removeFromSuperview()
      addSubview(browserView)
    }
    let toolbarHeight = showsBrowserToolbar ? min(Self.browserToolbarHeight, max(0, bounds.height)) : 0
    if showsBrowserToolbar {
      toolbarView.frame = CGRect(
        x: 0,
        y: bounds.height - toolbarHeight,
        width: bounds.width,
        height: toolbarHeight
      )
      layoutBrowserToolbar()
    }
    browserView.frame = CGRect(x: 0, y: 0, width: bounds.width, height: max(0, bounds.height - toolbarHeight))
    layoutInitialLoadingOverlay(webFrame: browserView.frame)
    updateBrowserToolbarState()
    needsLayout = true
    needsDisplay = true
    browserView.needsLayout = true
    browserView.needsDisplay = true
    /**
     CDXC:EditorPanes 2026-05-08-13:13
     Hosted Chromium frame refresh is a state update, not a synchronous paint
     command. Forcing layout/display here can re-enter CEF while AppKit is
     already processing sidebar or workspace resize, which crashes the visible
     VS Code pane. Mark the views dirty and let the run loop flush them.
     */
    NativeT3CodePaneReproLog.append("nativeWorkspace.t3WebPane.host.refresh.end", [
      "hostFrame": Self.describeFrame(frame),
      "reason": reason,
      "webFrame": Self.describeFrame(browserView.frame),
      "webUrl": currentURLString() ?? NSNull(),
      "windowNumber": window?.windowNumber ?? NSNull(),
    ])
  }

  override func mouseDown(with event: NSEvent) {
    onFocus?()
    super.mouseDown(with: event)
  }

  func setInitialLoadingOverlayVisible(_ visible: Bool, reason: String) {
    guard let initialLoadingOverlayView else {
      return
    }
    if visible {
      initialLoadingOverlayView.startAnimating()
      layoutInitialLoadingOverlay(webFrame: browserView.frame)
    } else {
      initialLoadingOverlayView.stopAnimating()
    }
    NativeT3CodePaneReproLog.append("nativeWorkspace.projectEditor.loadingOverlay.visibilityChanged", [
      "reason": reason,
      "visible": visible,
      "webUrl": currentURLString() ?? NSNull(),
      "windowNumber": window?.windowNumber ?? NSNull(),
    ])
  }

  private func layoutInitialLoadingOverlay(webFrame: CGRect) {
    guard let initialLoadingOverlayView else {
      return
    }
    /**
     CDXC:EditorPanes 2026-05-07-08:29
     The VS Code startup loader is a native overlay above the embedded Chromium
     view. It is created only for project editor panes, does not participate in
     browser layout or code-server startup, and ignores hit testing so it cannot
     add interaction or startup latency.
     */
    if initialLoadingOverlayView.superview !== self {
      addSubview(initialLoadingOverlayView)
    }
    if subviews.last !== initialLoadingOverlayView {
      initialLoadingOverlayView.removeFromSuperview()
      addSubview(initialLoadingOverlayView)
    }
    initialLoadingOverlayView.frame = webFrame
    initialLoadingOverlayView.needsLayout = true
  }

  func controlTextDidBeginEditing(_ obj: Notification) {
    isEditingAddress = true
  }

  func controlTextDidEndEditing(_ obj: Notification) {
    isEditingAddress = false
    if isReturnTextMovement(obj) {
      /**
       CDXC:BrowserPanes 2026-05-03-04:09
       AppKit can finish NSTextField editing on Return without sending the
       target/action first. Commit here too so typed browser URLs navigate
       instead of being overwritten by the previous WKWebView URL.
       */
      commitAddress()
      return
    }
    updateBrowserToolbarState()
  }

  private func isReturnTextMovement(_ notification: Notification) -> Bool {
    guard let movement = notification.userInfo?["NSTextMovement"] as? Int else {
      return false
    }
    return movement == NSReturnTextMovement
  }

  func control(
    _ control: NSControl,
    textView: NSTextView,
    doCommandBy commandSelector: Selector
  ) -> Bool {
    guard control === addressField else {
      return false
    }
    if commandSelector == #selector(NSResponder.insertNewline(_:)) {
      /**
       CDXC:BrowserPanes 2026-05-03-03:59
       Address-bar Return must always drive pane browser navigation. Handling the
       text command directly avoids AppKit swallowing the field action after a
       page focus transition or autocomplete interaction.
       */
      commitAddress()
      window?.makeFirstResponder(browserView)
      return true
    }
    if commandSelector == #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)) {
      commitAddress()
      window?.makeFirstResponder(browserView)
      return true
    }
    if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
      isEditingAddress = false
      updateBrowserToolbarState()
      window?.makeFirstResponder(browserView)
      return true
    }
    return false
  }

  private func installAddressFieldKeyMonitor() {
    guard addressFieldKeyMonitor == nil else {
      return
    }
    addressFieldKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      guard let self else {
        return event
      }
      guard self.shouldCommitAddress(forKeyDown: event) else {
        return event
      }
      /**
       CDXC:BrowserPanes 2026-05-03-04:22
       Embedded browser panes use native AppKit address chrome. Some field
       editor paths consume Return before NSTextField target/action or delegate
       callbacks run, so commit Return/keypad-Enter at the pane level while this
       address field is actively edited. This keeps typed URLs navigating in the
       embedded pane instead of leaving stale page content behind the new text.
       */
      self.commitAddress()
      self.window?.makeFirstResponder(self.browserView)
      return nil
    }
  }

  private func uninstallAddressFieldKeyMonitor() {
    if let addressFieldKeyMonitor {
      NSEvent.removeMonitor(addressFieldKeyMonitor)
    }
    addressFieldKeyMonitor = nil
  }

  private func shouldCommitAddress(forKeyDown event: NSEvent) -> Bool {
    guard showsBrowserToolbar else {
      return false
    }
    guard event.window === window, window?.isKeyWindow == true else {
      return false
    }
    guard addressField.currentEditor() != nil || isEditingAddress else {
      return false
    }
    guard window?.fieldEditor(false, for: addressField) === window?.firstResponder else {
      return false
    }
    if event.keyCode == 36 || event.keyCode == 76 {
      return true
    }
    return event.characters == "\r" || event.characters == "\n"
  }

  private func configureBrowserToolbar(initialAddress: String?) {
    toolbarView.translatesAutoresizingMaskIntoConstraints = true
    toolbarView.autoresizesSubviews = false
    toolbarView.wantsLayer = true
    toolbarView.layer?.backgroundColor = NSColor.black.cgColor

    [backButton, forwardButton, reloadButton, reactGrabButton, profileButton, appearanceButton, devToolsButton].forEach {
      button in
      button.target = self
      toolbarView.addSubview(button)
    }
    backButton.action = #selector(goBack)
    forwardButton.action = #selector(goForward)
    reloadButton.action = #selector(reloadPage)
    devToolsButton.action = #selector(openDevTools)
    reactGrabButton.action = #selector(injectReactGrab)
    profileButton.action = #selector(showProfilePicker)
    appearanceButton.action = #selector(showAppearanceMenu)

    securityIcon.image = NSImage(systemSymbolName: "lock.fill", accessibilityDescription: "Secure connection")
    securityIcon.contentTintColor = NSColor(calibratedWhite: 0.78, alpha: 0.9)
    securityIcon.imageScaling = .scaleProportionallyDown
    toolbarView.addSubview(securityIcon)

    addressField.cell = BrowserAddressTextFieldCell(textCell: "")
    addressField.stringValue = initialAddress ?? ""
    addressField.delegate = self
    addressField.target = self
    addressField.action = #selector(commitAddress)
    addressField.isBordered = false
    addressField.drawsBackground = false
    addressField.isEditable = true
    addressField.isSelectable = true
    addressField.focusRingType = .none
    addressField.font = NSFont.systemFont(ofSize: 13, weight: .medium)
    addressField.textColor = NSColor(calibratedWhite: 0.94, alpha: 0.95)
    addressField.placeholderString = "Search or enter address"
    addressField.lineBreakMode = .byTruncatingMiddle
    addressField.cell?.lineBreakMode = .byTruncatingMiddle
    addressField.cell?.usesSingleLineMode = true
    addressField.cell?.wraps = false
    toolbarView.addSubview(addressField)

    /**
     CDXC:BrowserPanes 2026-05-02-17:03
     The address bar is native AppKit chrome for embedded browser panes. It
     normalizes typed URLs/searches and drives the pane's own browser renderer,
     keeping browser navigation inside the pane instead of opening external overlays.
     */
    if let webView {
      navigationObservations = [
        webView.observe(\.url, options: [.initial, .new]) { [weak self] _, _ in
          Task { @MainActor in self?.updateBrowserToolbarState() }
        },
        webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] _, _ in
          Task { @MainActor in self?.updateBrowserToolbarState() }
        },
        webView.observe(\.canGoForward, options: [.initial, .new]) { [weak self] _, _ in
          Task { @MainActor in self?.updateBrowserToolbarState() }
        },
        webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] _, _ in
          Task { @MainActor in self?.updateBrowserToolbarState() }
        },
      ]
    }
  }

  private func layoutBrowserToolbar() {
    guard showsBrowserToolbar else {
      return
    }
    let height = toolbarView.bounds.height
    var x = Self.toolbarHorizontalPadding
    let buttonY = floor((height - Self.toolbarButtonSize.height) / 2)
    for button in [backButton, forwardButton, reloadButton] {
      button.frame = CGRect(origin: CGPoint(x: x, y: buttonY), size: Self.toolbarButtonSize)
      x += Self.toolbarButtonSize.width + Self.toolbarItemGap
    }

    /**
     CDXC:BrowserPanes 2026-05-02-17:13
     The browser address row should match the reference chrome exactly: React
     Grab, profile, theme, and DevTools live to the right of the URL field.
     Import remains a profile-menu action instead of a fifth always-visible
     toolbar button so the pane chrome does not drift from the expected layout.
     */
    let rightButtons = [reactGrabButton, profileButton, appearanceButton, devToolsButton]
    var rightX = toolbarView.bounds.width - Self.toolbarHorizontalPadding
    for button in rightButtons.reversed() {
      rightX -= Self.toolbarButtonSize.width
      button.frame = CGRect(origin: CGPoint(x: rightX, y: buttonY), size: Self.toolbarButtonSize)
      rightX -= Self.toolbarItemGap
    }

    let addressX = x + 18
    let addressRight = rightX - 14
    let availableAddressWidth = max(0, addressRight - addressX)
    /**
     CDXC:BrowserPanes 2026-05-03-01:58
     The embedded browser URL text must read like toolbar chrome, not a page
     heading. Keep the field compact and vertically centered next to the lock
     icon so long URLs do not dominate the pane.
     */
    let addressHeight: CGFloat = 20
    let addressY = floor((height - addressHeight) / 2)
    securityIcon.frame = CGRect(x: addressX, y: floor((height - 14) / 2), width: 14, height: 14)
    addressField.frame = CGRect(
      x: addressX + 22,
      y: addressY,
      width: max(0, availableAddressWidth - 22),
      height: addressHeight
    )
  }

  private func updateBrowserToolbarState() {
    guard showsBrowserToolbar else {
      return
    }
    backButton.isEnabled = canGoBack()
    forwardButton.isEnabled = canGoForward()
    reloadButton.toolTip = isPageLoading() ? "Stop Loading" : "Reload"
    let lockSymbol = URL(string: currentURLString() ?? "")?.scheme == "https" ? "lock.fill" : "globe"
    securityIcon.image = NSImage(systemSymbolName: lockSymbol, accessibilityDescription: nil)
    if !isEditingAddress {
      addressField.stringValue = currentURLString() ?? addressField.stringValue
    }
  }

  private func currentURLString() -> String? {
    chromiumView?.currentURLString ?? webView?.url?.absoluteString
  }

  private func canGoBack() -> Bool {
    chromiumView?.canGoBack ?? webView?.canGoBack ?? false
  }

  private func canGoForward() -> Bool {
    chromiumView?.canGoForward ?? webView?.canGoForward ?? false
  }

  private func isPageLoading() -> Bool {
    chromiumView?.isLoading ?? webView?.isLoading ?? false
  }

  private static func browserPaneNavigationRequest(url: URL) -> URLRequest {
    /**
     CDXC:BrowserPanes 2026-05-03-02:28
     Address-bar navigations create a fresh top-level page, just like restored
     browser panes. Ignore stale local document cache here too so sites that
     vary HTML by user agent do not display old bare-WKWebView markup until the
     user manually reloads.
     */
    URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
  }

  @objc private func goBack() {
    onFocus?()
    if chromiumView?.canGoBack == true {
      chromiumView?.goBack()
    } else if webView?.canGoBack == true {
      webView?.goBack()
    }
  }

  @objc private func goForward() {
    onFocus?()
    if chromiumView?.canGoForward == true {
      chromiumView?.goForward()
    } else if webView?.canGoForward == true {
      webView?.goForward()
    }
  }

  @objc private func reloadPage() {
    onFocus?()
    if isPageLoading() {
      if let chromiumView {
        chromiumView.stopLoading()
      } else {
        webView?.stopLoading()
      }
    } else {
      if let chromiumView {
        chromiumView.reload()
      } else {
        webView?.reload()
      }
    }
  }

  @objc private func commitAddress() {
    /**
     CDXC:BrowserPanes 2026-05-03-04:36
     Address-bar commits must snapshot the edited text before focusing the pane.
     Focusing can end AppKit field editing and refresh toolbar state from the
     previous WKWebView URL, which made pasted URLs appear accepted but navigate
     back to the old page when Return was pressed.
     */
    let input = addressField.stringValue
    guard let url = Self.url(fromAddressInput: input) else {
      NSSound.beep()
      updateBrowserToolbarState()
      return
    }
    onFocus?()
    NativeT3CodePaneReproLog.append("nativeWorkspace.browserPane.address.commit", [
      "input": input,
      "url": url.absoluteString,
    ])
    addressField.stringValue = url.absoluteString
    if let chromiumView {
      chromiumView.loadURLString(url.absoluteString)
    } else {
      webView?.load(Self.browserPaneNavigationRequest(url: url))
    }
  }

  @objc private func openDevTools() {
    onOpenDevTools?()
  }

  @objc private func injectReactGrab() {
    onInjectReactGrab?()
  }

  @objc private func showProfilePicker() {
    onShowProfilePicker?()
  }

  @objc private func showAppearanceMenu() {
    onFocus?()
    let menu = NSMenu(title: "Browser Theme")
    for mode in [BrowserPaneThemeMode.system, .light, .dark] {
      let item = NSMenuItem(title: mode.title, action: #selector(selectAppearanceMode(_:)), keyEquivalent: "")
      item.identifier = NSUserInterfaceItemIdentifier(mode.rawValue)
      item.target = self
      item.state = mode == browserThemeMode ? .on : .off
      menu.addItem(item)
    }
    NSMenu.popUpContextMenu(
      menu,
      with: syntheticMenuEvent(),
      for: appearanceButton
    )
  }

  @objc private func selectAppearanceMode(_ sender: NSMenuItem) {
    guard let rawValue = sender.identifier?.rawValue,
      let mode = BrowserPaneThemeMode(rawValue: rawValue)
    else {
      return
    }
    /**
     CDXC:BrowserPanes 2026-05-02-17:32
     The browser theme top-bar control mirrors the reference System/Light/Dark
     menu. Apply the choice directly to the embedded WKWebView so compatible
     pages update in place without replacing the browser pane or using overlay UI.
     */
    browserThemeMode = mode
    if let webView {
      switch mode {
      case .system:
        webView.appearance = nil
      case .light:
        webView.appearance = NSAppearance(named: .aqua)
      case .dark:
        webView.appearance = NSAppearance(named: .darkAqua)
      }
    } else {
      /**
       CDXC:ChromiumBrowserPanes 2026-05-04-16:51
       Chromium panes should not fake WebKit's per-view AppKit appearance hook.
       CEF needs explicit page/runtime theme support to do this correctly, so
       the toolbar stores the selected mode but leaves Chromium rendering alone
       until a real Chromium theme implementation is added.
       */
    }
    appearanceButton.image = NSImage(systemSymbolName: mode.symbolName, accessibilityDescription: "Browser Theme")
  }

  @objc private func showImportSettings() {
    onShowImportSettings?()
  }

  private static func url(fromAddressInput value: String) -> URL? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return nil
    }
    if let url = URL(string: trimmed), url.scheme != nil {
      return url
    }
    if trimmed == "localhost" || trimmed.hasPrefix("localhost:") || trimmed.hasPrefix("127.0.0.1") {
      return URL(string: "http://\(trimmed)")
    }
    if trimmed.contains(".") && !trimmed.contains(" ") {
      return URL(string: "https://\(trimmed)")
    }
    var components = URLComponents(string: "https://www.google.com/search")
    components?.queryItems = [URLQueryItem(name: "q", value: trimmed)]
    return components?.url
  }

  private static func makeToolbarButton(
    systemSymbolName: String,
    fallbackTitle: String,
    tooltip: String
  ) -> NSButton {
    let button = NSButton(title: "", target: nil, action: nil)
    button.bezelStyle = .texturedRounded
    button.isBordered = false
    button.imagePosition = .imageOnly
    button.toolTip = tooltip
    button.contentTintColor = NSColor(calibratedWhite: 0.86, alpha: 0.82)
    button.focusRingType = .none
    if let image = NSImage(systemSymbolName: systemSymbolName, accessibilityDescription: tooltip) {
      button.image = image
    } else {
      button.title = fallbackTitle
      button.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
    }
    return button
  }

  private func syntheticMenuEvent() -> NSEvent {
    if let currentEvent = NSApp.currentEvent {
      return currentEvent
    }
    return NSEvent.mouseEvent(
      with: .rightMouseDown,
      location: NSEvent.mouseLocation,
      modifierFlags: [],
      timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window?.windowNumber ?? 0,
      context: nil,
      eventNumber: 0,
      clickCount: 1,
      pressure: 1
    )!
  }

  private static func describeFrame(_ frame: CGRect) -> [String: Double] {
    [
      "height": Double(frame.height),
      "width": Double(frame.width),
      "x": Double(frame.minX),
      "y": Double(frame.minY),
    ]
  }
}

private final class PoppedOutPaneWindowController: NSWindowController, NSWindowDelegate {
  let sessionId: String
  let titleBarView: TerminalSessionTitleBarView
  private let onReattachRequested: (String) -> Void
  private var isClosingProgrammatically = false

  init(
    sessionId: String,
    titleBarView: TerminalSessionTitleBarView,
    window: NSWindow,
    onReattachRequested: @escaping (String) -> Void
  ) {
    self.sessionId = sessionId
    self.titleBarView = titleBarView
    self.onReattachRequested = onReattachRequested
    super.init(window: window)
    window.delegate = self
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func closeProgrammatically() {
    isClosingProgrammatically = true
    window?.delegate = nil
    window?.close()
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard !isClosingProgrammatically else {
      return true
    }
    onReattachRequested(sessionId)
    return false
  }
}

private final class PoppedOutTerminalPaneContentView: NSView {
  private let scrollView: NSView
  private let searchBarView: NSView
  private let titleBarView: NSView
  private let titleBarHeight: CGFloat

  init(
    scrollView: NSView,
    searchBarView: NSView,
    titleBarView: NSView,
    titleBarHeight: CGFloat
  ) {
    self.scrollView = scrollView
    self.searchBarView = searchBarView
    self.titleBarView = titleBarView
    self.titleBarHeight = titleBarHeight
    super.init(frame: .zero)
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedRed: 0.071, green: 0.071, blue: 0.071, alpha: 1).cgColor
    addSubview(scrollView)
    addSubview(searchBarView)
    addSubview(titleBarView)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layout() {
    super.layout()
    let titleHeight = min(titleBarHeight, max(bounds.height, 0))
    titleBarView.frame = CGRect(
      x: 0,
      y: bounds.maxY - titleHeight,
      width: bounds.width,
      height: titleHeight)
    scrollView.frame = CGRect(
      x: 0,
      y: 0,
      width: bounds.width,
      height: max(bounds.height - titleHeight, 1))
    searchBarView.frame = CGRect(
      x: max(12, bounds.width - 332),
      y: max(12, bounds.height - titleHeight - 48),
      width: min(320, max(bounds.width - 24, 1)),
      height: 36)
  }
}

private final class PoppedOutWebPaneContentView: NSView {
  private let hostView: NSView
  private let titleBarView: NSView
  private let titleBarHeight: CGFloat

  init(hostView: NSView, titleBarView: NSView, titleBarHeight: CGFloat) {
    self.hostView = hostView
    self.titleBarView = titleBarView
    self.titleBarHeight = titleBarHeight
    super.init(frame: .zero)
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedRed: 0.086, green: 0.086, blue: 0.086, alpha: 1).cgColor
    addSubview(hostView)
    addSubview(titleBarView)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layout() {
    super.layout()
    let titleHeight = min(titleBarHeight, max(bounds.height, 0))
    titleBarView.frame = CGRect(
      x: 0,
      y: bounds.maxY - titleHeight,
      width: bounds.width,
      height: titleHeight)
    hostView.frame = CGRect(
      x: 0,
      y: 0,
      width: bounds.width,
      height: max(bounds.height - titleHeight, 1))
    hostView.needsLayout = true
  }
}

private final class PoppedOutPanePlaceholderView: NSView {
  private let titleLabel = NSTextField(labelWithString: "")
  private let detailLabel = NSTextField(labelWithString: "This pane is open in a separate zmux window.")
  private let reattachButton = NSButton(title: "Bring Back", target: nil, action: nil)
  private let onReattach: () -> Void

  init(title: String, onReattach: @escaping () -> Void) {
    self.onReattach = onReattach
    super.init(frame: .zero)
    wantsLayer = true
    layer?.backgroundColor = NSColor(calibratedRed: 0.071, green: 0.071, blue: 0.071, alpha: 1).cgColor
    titleLabel.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
    titleLabel.textColor = NSColor(calibratedWhite: 0.92, alpha: 0.96)
    titleLabel.alignment = .center
    titleLabel.lineBreakMode = .byTruncatingTail
    detailLabel.font = NSFont.systemFont(ofSize: 12, weight: .regular)
    detailLabel.textColor = NSColor(calibratedWhite: 0.72, alpha: 0.9)
    detailLabel.alignment = .center
    detailLabel.lineBreakMode = .byTruncatingTail
    reattachButton.target = self
    reattachButton.action = #selector(reattach)
    reattachButton.bezelStyle = .rounded
    addSubview(titleLabel)
    addSubview(detailLabel)
    addSubview(reattachButton)
    setTitle(title)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func setTitle(_ title: String) {
    titleLabel.stringValue = title
  }

  override func layout() {
    super.layout()
    let contentWidth = min(max(bounds.width - 48, 1), 460)
    let centerX = bounds.midX
    let buttonSize = reattachButton.intrinsicContentSize
    let totalHeight: CGFloat = 86
    let startY = max(16, bounds.midY + totalHeight / 2 - 20)
    titleLabel.frame = CGRect(
      x: centerX - contentWidth / 2,
      y: startY,
      width: contentWidth,
      height: 20)
    detailLabel.frame = CGRect(
      x: centerX - contentWidth / 2,
      y: startY - 26,
      width: contentWidth,
      height: 18)
    reattachButton.frame = CGRect(
      x: centerX - max(buttonSize.width, 110) / 2,
      y: startY - 66,
      width: max(buttonSize.width, 110),
      height: 28)
  }

  @objc private func reattach() {
    onReattach()
  }
}

private final class TerminalPaneLeafContainerView: NSView {
  override var isOpaque: Bool {
    false
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }
}

private final class TerminalWorkspacePaneResizeHandleView: NSView {
  var onMouseDown: ((NSEvent) -> Void)?
  var onMouseDragged: ((NSEvent) -> Void)?
  var onMouseUp: ((NSEvent) -> Void)?
  private var cursor: NSCursor = .arrow
  private var hoverTrackingArea: NSTrackingArea?
  private var isDragging = false
  private var isResizeCursorPushed = false
  private var splitDirection = ""

  override var isOpaque: Bool {
    false
  }

  override var mouseDownCanMoveWindow: Bool {
    false
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  deinit {
    popResizeCursorIfNeeded()
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    if newWindow == nil {
      isDragging = false
      popResizeCursorIfNeeded()
    }
    super.viewWillMove(toWindow: newWindow)
  }

  func configure(direction: NativeTerminalLayout.SplitDirection, cursor: NSCursor) {
    /**
     CDXC:NativePaneResize 2026-05-11-09:39
     The splitter rail owns cursor and drag for horizontal and vertical layout
     branches. It remains visually transparent so focused pane borders and the
     workspace gap provide the only visible separation.
     CDXC:NativePaneResize 2026-05-11-10:40
     Mirror Muxy's hover implementation with cursor push/pop on the rail view
     itself. This keeps cursor ownership on the same native object that can
     drag, and avoids a window-local resize monitor competing with sidebar
     resize.
     CDXC:NativePaneResize 2026-05-11-14:17
     The rail must be visually transparent in production. Muxy-style resizing is
     represented by the real pane gap; this view only owns native hit testing,
     cursor push/pop, and drag delivery.
     */
    splitDirection = direction.rawValue
    layer?.backgroundColor = NSColor.clear.cgColor
    if self.cursor !== cursor {
      let wasCursorPushed = isResizeCursorPushed
      if wasCursorPushed {
        popResizeCursorIfNeeded()
      }
      self.cursor = cursor
      if wasCursorPushed {
        pushResizeCursorIfNeeded()
      }
      window?.invalidateCursorRects(for: self)
    }
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  func resetInteractionState() {
    isDragging = false
    popResizeCursorIfNeeded()
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    bounds.contains(point) ? self : nil
  }

  override func resetCursorRects() {
    super.resetCursorRects()
    addCursorRect(bounds, cursor: cursor)
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    /**
     CDXC:NativePaneResize 2026-05-11-09:45
     Splitter rails are visually transparent. The focused pane border and
     workspace gap remain the intended production separation.
     */
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let hoverTrackingArea {
      removeTrackingArea(hoverTrackingArea)
    }
    let trackingArea = NSTrackingArea(
      rect: .zero,
      options: [.activeInKeyWindow, .cursorUpdate, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved],
      owner: self,
      userInfo: nil
    )
    hoverTrackingArea = trackingArea
    addTrackingArea(trackingArea)
  }

  override func cursorUpdate(with event: NSEvent) {
    pushResizeCursorIfNeeded()
  }

  override func mouseEntered(with event: NSEvent) {
    pushResizeCursorIfNeeded()
  }

  override func mouseMoved(with event: NSEvent) {
    pushResizeCursorIfNeeded()
  }

  override func mouseExited(with event: NSEvent) {
    /**
     CDXC:NativePaneResize 2026-05-11-10:40
     Muxy's divider pushes the resize cursor only while hovering the divider.
     Keep the cursor pushed during an active drag, then pop on mouse-up or when
     the pointer leaves without dragging.
     */
    guard !isDragging else {
      cursor.set()
      return
    }
    popResizeCursorIfNeeded()
  }

  override func mouseDown(with event: NSEvent) {
    NativePaneTabDragReproLog.append(event: "nativePaneTabs.resizeRail.mouseDown", details: [
      "bounds": nativePaneTabsDebugFrame(bounds),
      "direction": splitDirection,
      "frame": nativePaneTabsDebugFrame(frame),
      "locationInWindow": nativePaneTabsDebugFrame(CGRect(
        x: event.locationInWindow.x,
        y: event.locationInWindow.y,
        width: 0,
        height: 0)),
      "windowNumber": event.window?.windowNumber ?? NSNull(),
    ])
    if event.clickCount < 2 {
      isDragging = true
    }
    pushResizeCursorIfNeeded()
    onMouseDown?(event)
  }

  override func mouseDragged(with event: NSEvent) {
    isDragging = true
    pushResizeCursorIfNeeded()
    onMouseDragged?(event)
  }

  override func mouseUp(with event: NSEvent) {
    onMouseUp?(event)
    isDragging = false
    if bounds.contains(convert(event.locationInWindow, from: nil)) {
      pushResizeCursorIfNeeded()
    } else {
      popResizeCursorIfNeeded()
    }
  }

  private func pushResizeCursorIfNeeded() {
    guard !isResizeCursorPushed else {
      cursor.set()
      return
    }
    cursor.push()
    isResizeCursorPushed = true
  }

  private func popResizeCursorIfNeeded() {
    guard isResizeCursorPushed else {
      return
    }
    NSCursor.pop()
    isResizeCursorPushed = false
  }
}

final class TerminalPaneBorderView: NSView {
  private enum BorderState: Equatable {
    case attention
    case focused
    case none
  }

  private static let focusedBorderColor = NSColor(
    calibratedRed: 0x73 / 255,
    green: 0x73 / 255,
    blue: 0x73 / 255,
    alpha: 0.95
  ).cgColor
  private static let attentionBorderColor = NSColor(
    calibratedRed: 0x65 / 255,
    green: 0xE5 / 255,
    blue: 0x8A / 255,
    alpha: 1
  ).cgColor
  private static let roundedBottomCornerRadius: CGFloat = 12
  private static let borderWidth: CGFloat = 2

  private var roundedBottomCorner: TerminalPaneRoundedBottomCorner = .none
  private var state: BorderState = .none

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
    layer?.borderWidth = 0
    layer?.cornerRadius = 0
    layer?.masksToBounds = false
    layer?.shadowRadius = 16
    layer?.shadowOffset = .zero
    layer?.shadowOpacity = 0
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    guard let borderColor = currentBorderColor() else {
      return
    }

    let path = borderPath(in: bounds)
    borderColor.setStroke()
    path.lineWidth = Self.borderWidth
    path.stroke()
  }

  fileprivate func setRoundedBottomCorner(_ corner: TerminalPaneRoundedBottomCorner) {
    /**
     CDXC:NativePaneChrome 2026-05-07-15:13
     The active/done pane border must have a real rounded visual bottom corner
     on the workspace side opposite the sidebar. Draw the transparent native
     overlay's border path directly instead of relying on CALayer's single
     corner border masking. In this unflipped AppKit view, visible bottom is
     min-Y, so bottom-left is min-X/min-Y and bottom-right is max-X/min-Y.
     */
    guard roundedBottomCorner != corner else {
      return
    }
    roundedBottomCorner = corner
    needsDisplay = true
  }

  func setState(isFocused: Bool, isAttention: Bool) {
    /**
     CDXC:NativeSessionStatus 2026-04-27-08:02
     Native Ghostty panes are outside the React workspace DOM. Mirror the
     existing workspace UX with a selected border and a green border for
     done/attention sessions, without stealing terminal input.
     */
    let nextState: BorderState = isAttention ? .attention : isFocused ? .focused : .none
    guard nextState != state else {
      return
    }
    state = nextState
    switch nextState {
    case .attention:
      layer?.shadowColor = Self.attentionBorderColor
      layer?.shadowOpacity = 0.28
    case .focused:
      layer?.shadowColor = Self.focusedBorderColor
      layer?.shadowOpacity = 0.18
    case .none:
      layer?.shadowOpacity = 0
    }
    needsDisplay = true
  }

  private func currentBorderColor() -> NSColor? {
    switch state {
    case .attention:
      return NSColor(cgColor: Self.attentionBorderColor)
    case .focused:
      return NSColor(cgColor: Self.focusedBorderColor)
    case .none:
      return nil
    }
  }

  private func borderPath(in bounds: CGRect) -> NSBezierPath {
    let inset = Self.borderWidth / 2
    let rect = bounds.insetBy(dx: inset, dy: inset)
    let radius = roundedBottomCorner == .none
      ? 0
      : min(Self.roundedBottomCornerRadius, rect.width / 2, rect.height / 2)
    switch roundedBottomCorner {
    case .left:
      return bottomLeftRoundedBorderPath(in: rect, radius: radius)
    case .none:
      return NSBezierPath(rect: rect)
    case .right:
      return bottomRightRoundedBorderPath(in: rect, radius: radius)
    }
  }

  private func bottomLeftRoundedBorderPath(in rect: CGRect, radius: CGFloat) -> NSBezierPath {
    let path = NSBezierPath()
    path.move(to: CGPoint(x: rect.minX, y: rect.minY + radius))
    if radius > 0 {
      path.curve(
        to: CGPoint(x: rect.minX + radius, y: rect.minY),
        controlPoint1: CGPoint(x: rect.minX, y: rect.minY + radius * 0.4477),
        controlPoint2: CGPoint(x: rect.minX + radius * 0.4477, y: rect.minY)
      )
    } else {
      path.line(to: CGPoint(x: rect.minX, y: rect.minY))
    }
    path.line(to: CGPoint(x: rect.maxX, y: rect.minY))
    path.line(to: CGPoint(x: rect.maxX, y: rect.maxY))
    path.line(to: CGPoint(x: rect.minX, y: rect.maxY))
    path.close()
    return path
  }

  private func bottomRightRoundedBorderPath(in rect: CGRect, radius: CGFloat) -> NSBezierPath {
    let path = NSBezierPath()
    path.move(to: CGPoint(x: rect.minX, y: rect.minY))
    path.line(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
    if radius > 0 {
      path.curve(
        to: CGPoint(x: rect.maxX, y: rect.minY + radius),
        controlPoint1: CGPoint(x: rect.maxX - radius * 0.4477, y: rect.minY),
        controlPoint2: CGPoint(x: rect.maxX, y: rect.minY + radius * 0.4477)
      )
    }
    path.line(to: CGPoint(x: rect.maxX, y: rect.maxY))
    path.line(to: CGPoint(x: rect.minX, y: rect.maxY))
    path.close()
    return path
  }
}
