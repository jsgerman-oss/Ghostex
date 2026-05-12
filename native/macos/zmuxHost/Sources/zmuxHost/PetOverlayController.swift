import AppKit
import CoreGraphics
import Foundation
import WebKit

final class PetOverlayController: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  private static let defaultScreenMargin: CGFloat = 18
  private static let storageKey = "zmux.petOverlayOrigin"
  private static let panelWidth: CGFloat = 320

  private let encoder = JSONEncoder()
  private let panel: NSPanel
  private let webView: WKWebView
  private var dragStartMouseLocation: NSPoint?
  private var dragStartPanelOrigin: NSPoint?
  private var hasUserPositionedPanel: Bool
  private var isLoaded = false
  private var latestState: SetPetOverlayState?

  override init() {
    let configuration = WKWebViewConfiguration()
    let webView = WKWebView(frame: .zero, configuration: configuration)
    let initialSize = Self.preferredSize(activityCount: 0)
    let panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: initialSize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.panel = panel
    self.webView = webView
    self.hasUserPositionedPanel = Self.readStoredOrigin() != nil
    super.init()

    configuration.userContentController.add(self, name: "zmuxPetOverlay")
    webView.navigationDelegate = self
    webView.autoresizingMask = [.width, .height]
    webView.frame = NSRect(origin: .zero, size: initialSize)
    webView.setValue(false, forKey: "drawsBackground")

    panel.backgroundColor = .clear
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.contentView = webView
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.ignoresMouseEvents = false
    panel.isFloatingPanel = true
    panel.isOpaque = false
    panel.isReleasedWhenClosed = false
    panel.level = .floating
    panel.setFrame(
      NSRect(origin: initialOrigin(size: initialSize), size: initialSize),
      display: false
    )
  }

  deinit {
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "zmuxPetOverlay")
  }

  func load(webAssets: URL) {
    let petHost = webAssets.appendingPathComponent("pet-host.html")
    if FileManager.default.fileExists(atPath: petHost.path) {
      webView.loadFileURL(petHost, allowingReadAccessTo: webAssets)
      return
    }
    webView.loadHTMLString(
      "<!doctype html><html><body style=\"margin:0;background:transparent\"></body></html>",
      baseURL: webAssets
    )
  }

  func apply(_ state: SetPetOverlayState) {
    latestState = state
    guard state.enabled else {
      panel.orderOut(nil)
      sendLatestStateIfLoaded()
      return
    }

    let size = Self.preferredSize(activityCount: state.activities.count)
    let origin =
      hasUserPositionedPanel
      ? Self.clampedOrigin(panel.frame.origin, size: size)
      : Self.defaultOrigin(size: size)
    panel.setFrame(NSRect(origin: origin, size: size), display: true)
    panel.orderFrontRegardless()
    sendLatestStateIfLoaded()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    isLoaded = true
    sendLatestStateIfLoaded()
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard
      message.name == "zmuxPetOverlay",
      let body = message.body as? [String: Any],
      let type = body["type"] as? String
    else {
      return
    }

    switch type {
    case "dragStart":
      dragStartMouseLocation = NSEvent.mouseLocation
      dragStartPanelOrigin = panel.frame.origin
    case "dragMove":
      handleDragMove()
    case "dragEnd":
      finishDrag()
    default:
      break
    }
  }

  private func handleDragMove() {
    guard let dragStartMouseLocation, let dragStartPanelOrigin else {
      return
    }
    hasUserPositionedPanel = true
    let mouseLocation = NSEvent.mouseLocation
    let nextOrigin = NSPoint(
      x: dragStartPanelOrigin.x + mouseLocation.x - dragStartMouseLocation.x,
      y: dragStartPanelOrigin.y + mouseLocation.y - dragStartMouseLocation.y
    )
    panel.setFrameOrigin(Self.clampedOrigin(nextOrigin, size: panel.frame.size))
  }

  private func finishDrag() {
    dragStartMouseLocation = nil
    dragStartPanelOrigin = nil
    Self.storeOrigin(panel.frame.origin)
  }

  private func sendLatestStateIfLoaded() {
    guard isLoaded, let latestState else {
      return
    }
    guard
      let data = try? encoder.encode(latestState),
      let json = String(data: data, encoding: .utf8)
    else {
      return
    }
    webView.evaluateJavaScript(
      """
      window.__zmuxPetOverlayState = \(json);
      window.dispatchEvent(new CustomEvent('zmux-pet-overlay-state', {
        detail: window.__zmuxPetOverlayState
      }));
      undefined;
      """)
  }

  private func initialOrigin(size: NSSize) -> NSPoint {
    if let storedOrigin = Self.readStoredOrigin() {
      return Self.clampedOrigin(storedOrigin, size: size)
    }
    return Self.defaultOrigin(size: size)
  }

  private static func preferredSize(activityCount: Int) -> NSSize {
    let visibleActivityCount = min(max(activityCount, 0), 3)
    return NSSize(width: panelWidth, height: CGFloat(126 + visibleActivityCount * 54))
  }

  private static func defaultOrigin(size: NSSize) -> NSPoint {
    let frame = defaultScreen().visibleFrame
    return NSPoint(
      x: frame.maxX - size.width - defaultScreenMargin,
      y: frame.minY + defaultScreenMargin)
  }

  private static func clampedOrigin(_ origin: NSPoint, size: NSSize) -> NSPoint {
    guard let screen = screen(containing: origin) ?? defaultScreenOptional() else {
      return origin
    }
    let frame = screen.frame
    return NSPoint(
      x: min(max(origin.x, frame.minX), max(frame.minX, frame.maxX - size.width)),
      y: min(max(origin.y, frame.minY), max(frame.minY, frame.maxY - size.height)))
  }

  private static func screen(containing origin: NSPoint) -> NSScreen? {
    NSScreen.screens.first { $0.frame.contains(origin) }
  }

  private static func defaultScreen() -> NSScreen {
    defaultScreenOptional() ?? NSScreen.main ?? NSScreen.screens.first!
  }

  private static func defaultScreenOptional() -> NSScreen? {
    NSScreen.screens.first(where: isBuiltInScreen) ?? NSScreen.main ?? NSScreen.screens.first
  }

  private static func isBuiltInScreen(_ screen: NSScreen) -> Bool {
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    guard let displayNumber = screen.deviceDescription[key] as? NSNumber else {
      return false
    }
    return CGDisplayIsBuiltin(CGDirectDisplayID(displayNumber.uint32Value)) != 0
  }

  private static func readStoredOrigin() -> NSPoint? {
    guard
      let value = UserDefaults.standard.dictionary(forKey: storageKey),
      let x = value["x"] as? Double,
      let y = value["y"] as? Double
    else {
      return nil
    }
    return NSPoint(x: x, y: y)
  }

  private static func storeOrigin(_ origin: NSPoint) {
    UserDefaults.standard.set(["x": origin.x, "y": origin.y], forKey: storageKey)
  }
}
