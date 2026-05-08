import AppKit
import CoreGraphics

@MainActor
final class SessionStatusIndicatorController {
  private static let defaultScreenMargin: CGFloat = 22

  private let panel: NSPanel
  private let indicatorView: SessionStatusIndicatorView
  private var hasUserPositionedPanel = false

  /**
   CDXC:SessionStatusIndicators 2026-05-05-19:47
   Session counts must be rendered by AppKit, not SwiftUI, so the floating
   status UI can live outside the zmux content view, default to the built-in or
   primary display, and support direct drag repositioning without webview hit
   testing.
   */
  init(onClick: @escaping (NativeSessionStatusIndicatorStatus) -> Void) {
    let view = SessionStatusIndicatorView(
      onClick: { status in
        NSApp.activate(ignoringOtherApps: true)
        onClick(status)
      },
      onDrag: {})
    let panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: view.preferredSize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.indicatorView = view
    self.panel = panel
    panel.backgroundColor = .clear
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.contentView = indicatorView
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.ignoresMouseEvents = false
    panel.isFloatingPanel = true
    panel.isOpaque = false
    panel.isReleasedWhenClosed = false
    panel.level = .floating
    view.onDrag = { [weak self] in
      self?.hasUserPositionedPanel = true
    }
  }

  func apply(_ command: SetSessionStatusIndicators) {
    let items = Self.visibleItems(for: command)
    indicatorView.sizeSetting = command.size
    indicatorView.items = items
    guard !items.isEmpty else {
      panel.orderOut(nil)
      return
    }

    let nextSize = indicatorView.preferredSize
    let nextOrigin =
      hasUserPositionedPanel
      ? Self.clampedOrigin(panel.frame.origin, size: nextSize)
      : Self.defaultOrigin(size: nextSize)
    panel.setFrame(NSRect(origin: nextOrigin, size: nextSize), display: true)
    panel.orderFrontRegardless()
  }

  private static func visibleItems(
    for command: SetSessionStatusIndicators
  ) -> [SessionStatusIndicatorItem] {
    /**
     CDXC:SessionStatusIndicators 2026-05-05-19:47
     Attention and running counts are action states and should suppress the
     gray available-session total whenever either exists. The gray circle is
     only a quiet all-available summary for the fully idle case.
     CDXC:SessionStatusIndicators 2026-05-08-09:09
     Floating status badges should use darker fills for calmer contrast against
     transparent desktop content after the shared capsule backdrop was removed.
     */
    if command.attentionCount > 0 || command.runningCount > 0 {
      return [
        command.attentionCount > 0
          ? SessionStatusIndicatorItem(
            status: .attention,
            count: command.attentionCount,
            color: NSColor(calibratedRed: 0.10, green: 0.42, blue: 0.16, alpha: 1))
          : nil,
        command.runningCount > 0
          ? SessionStatusIndicatorItem(
            status: .running,
            count: command.runningCount,
            color: NSColor(calibratedRed: 0.54, green: 0.27, blue: 0.07, alpha: 1))
          : nil,
      ].compactMap { $0 }
    }

    guard command.availableCount > 0 else {
      return []
    }
    return [
      SessionStatusIndicatorItem(
        status: .available,
        count: command.availableCount,
        color: NSColor(calibratedWhite: 0.25, alpha: 1))
    ]
  }

  private static func defaultOrigin(size: NSSize) -> NSPoint {
    let screen = defaultScreen()
    let frame = screen.visibleFrame
    return NSPoint(
      x: frame.maxX - size.width - defaultScreenMargin,
      y: frame.minY + defaultScreenMargin)
  }

  private static func clampedOrigin(_ origin: NSPoint, size: NSSize) -> NSPoint {
    guard let screen = screen(containing: origin) ?? defaultScreenOptional() else {
      return origin
    }
    /**
     CDXC:SessionStatusIndicators 2026-05-08-10:22
     User-positioned floating indicators must be allowed in bottom screen
     corners beside the Dock. Clamp manual positions to the full screen frame,
     not visibleFrame, so count/size updates do not push them out of the Dock
     strip after the user places them there.
     */
    let frame = screen.frame
    let maxX = max(frame.minX, frame.maxX - size.width)
    let maxY = max(frame.minY, frame.maxY - size.height)
    return NSPoint(
      x: min(max(origin.x, frame.minX), maxX),
      y: min(max(origin.y, frame.minY), maxY))
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
}

private struct SessionStatusIndicatorItem {
  let status: NativeSessionStatusIndicatorStatus
  let count: Int
  let color: NSColor
}

@MainActor
private final class SessionStatusIndicatorView: NSView {
  private struct IndicatorMetrics {
    let scale: CGFloat

    var circleDiameter: CGFloat { 52 * scale }
    var horizontalInset: CGFloat { 11 * scale }
    var verticalInset: CGFloat { 8 * scale }
    var itemGap: CGFloat { 6 * scale }
    var minimumTextPadding: CGFloat { 20 * scale }
    var countFont: NSFont {
      NSFont.monospacedDigitSystemFont(ofSize: 25 * scale, weight: .bold)
    }

    var badgeShadowBlur: CGFloat { 5 * scale }
    var badgeShadowOffset: CGFloat { -1 * scale }
    var badgeFillInset: CGFloat { 3.5 * scale }
    var badgeStrokeWidth: CGFloat { max(0.5, 0.8 * scale) }
    var textBaselineOffset: CGFloat { 0.5 * scale }
  }

  private struct DragState {
    let mouseStart: NSPoint
    let windowOriginStart: NSPoint
    var didMove: Bool = false
  }

  /**
   CDXC:SessionStatusIndicators 2026-05-07-16:42
   Counts should read clearly at default size, and a future user-facing size
   setting should scale a small set of base metrics instead of rewriting draw
   logic. Keep the default number visually dominant inside the indicator.
   CDXC:SessionStatusIndicators 2026-05-07-17:36
   The indicator should use a polished glass capsule with circular status
   badges, matching the approved visual direction while preserving the
   inactive-only-when-no-action-state visibility rule in visibleItems.
   CDXC:SessionStatusIndicators 2026-05-07-18:02
   A single visible status must not collapse the backdrop into a square-looking
   button. Keep a horizontal capsule minimum and draw all shadows inside the
   view so transparent NSPanel edges never create rectangular chrome.
   CDXC:SessionStatusIndicators 2026-05-07-18:20
   The current polished indicator size is X-Large. Medium is the default and
   scales every drawing metric to 50% of X-Large; Large and Small are named
   settings values that reuse the same AppKit drawing path.
   CDXC:SessionStatusIndicators 2026-05-07-18:32
   The capsule should fit the visible badges tightly, including the single
   badge case. Badge fill colors stay darker for text contrast, and numbers
   render as full white rather than tinted text.
   CDXC:SessionStatusIndicators 2026-05-08-09:09
   The floating indicator must not draw a shared background behind the badges.
   Keep the NSPanel and NSView clear so only the circular status pills render.
   CDXC:SessionStatusIndicators 2026-05-08-09:17
   Status buttons should not have a gray outer ring. Use a flatter colored
   badge with subtle lighting and shadow so the control remains polished
   without the heavy 3D button treatment.
   CDXC:SessionStatusIndicators 2026-05-08-10:21
   Indicator numbers should render 2px larger at the base drawing scale while
   preserving the existing Small/Medium/Large/X-Large size scaling behavior.
   CDXC:SessionStatusIndicators 2026-05-08-10:27
   Repositioning must not require a Shift modifier. Track ordinary drags from
   mouse-down and reserve click activation for mouse-up without panel movement.
   */
  private static func metrics(for size: NativeSessionStatusIndicatorSize) -> IndicatorMetrics {
    switch size {
    case .small:
      return IndicatorMetrics(scale: 0.4)
    case .medium:
      return IndicatorMetrics(scale: 0.5)
    case .large:
      return IndicatorMetrics(scale: 0.75)
    case .xLarge:
      return IndicatorMetrics(scale: 1)
    }
  }

  var items: [SessionStatusIndicatorItem] = [] {
    didSet {
      needsDisplay = true
    }
  }

  var sizeSetting: NativeSessionStatusIndicatorSize = .medium {
    didSet {
      needsDisplay = true
    }
  }

  var preferredSize: NSSize {
    let metrics = currentMetrics
    let itemWidths = items.map { diameter(for: $0) }
    let contentWidth =
      itemWidths.reduce(0, +)
      + CGFloat(max(items.count - 1, 0)) * metrics.itemGap
      + metrics.horizontalInset * 2
    let width = contentWidth
    let height = (itemWidths.max() ?? metrics.circleDiameter) + metrics.verticalInset * 2
    return NSSize(width: width, height: height)
  }

  private var currentMetrics: IndicatorMetrics {
    Self.metrics(for: sizeSetting)
  }

  private let onClick: (NativeSessionStatusIndicatorStatus) -> Void
  var onDrag: () -> Void
  private var mouseDownStatus: NativeSessionStatusIndicatorStatus?
  private var dragState: DragState?

  init(
    onClick: @escaping (NativeSessionStatusIndicatorStatus) -> Void,
    onDrag: @escaping () -> Void
  ) {
    self.onClick = onClick
    self.onDrag = onDrag
    super.init(frame: NSRect(origin: .zero, size: .zero))
    wantsLayer = true
    layer?.backgroundColor = NSColor.clear.cgColor
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override var isOpaque: Bool {
    false
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let metrics = currentMetrics
    for (item, rect) in itemRects() {
      drawBadge(item, in: rect, metrics: metrics)

      let label = NSAttributedString(
        string: "\(item.count)",
        attributes: textAttributes(metrics: metrics))
      let labelSize = label.size()
      label.draw(
        at: NSPoint(
          x: rect.midX - labelSize.width / 2,
          y: rect.midY - labelSize.height / 2 + metrics.textBaselineOffset))
    }
  }

  private func drawBadge(
    _ item: SessionStatusIndicatorItem,
    in rect: NSRect,
    metrics: IndicatorMetrics
  ) {
    let badgeRect = rect.insetBy(dx: metrics.badgeFillInset, dy: metrics.badgeFillInset)
    let badgePath = NSBezierPath(ovalIn: badgeRect)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowBlurRadius = metrics.badgeShadowBlur
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.38)
    shadow.shadowOffset = NSSize(width: 0, height: metrics.badgeShadowOffset)
    shadow.set()
    (item.color.shadow(withLevel: 0.20) ?? item.color).withAlphaComponent(0.92).setFill()
    badgePath.fill()
    NSGraphicsContext.restoreGraphicsState()

    NSGradient(colors: [
      item.color.highlight(withLevel: 0.10) ?? item.color,
      item.color,
      item.color.shadow(withLevel: 0.22) ?? item.color,
    ])?.draw(in: badgePath, angle: -90)

    NSColor.black.withAlphaComponent(0.18).setStroke()
    badgePath.lineWidth = metrics.badgeStrokeWidth
    badgePath.stroke()

    item.color.highlight(withLevel: 0.16)?.withAlphaComponent(0.38).setStroke()
    NSBezierPath(ovalIn: badgeRect.insetBy(dx: 1, dy: 1)).stroke()

    let highlightRect = NSRect(
      x: badgeRect.minX + badgeRect.width * 0.20,
      y: badgeRect.midY + badgeRect.height * 0.12,
      width: badgeRect.width * 0.60,
      height: badgeRect.height * 0.28)
    NSGradient(colors: [
      NSColor.white.withAlphaComponent(0.14),
      NSColor.white.withAlphaComponent(0.0),
    ])?.draw(
      in: NSBezierPath(ovalIn: highlightRect),
      angle: -90)
  }

  private func textAttributes(metrics: IndicatorMetrics) -> [NSAttributedString.Key: Any] {
    let shadow = NSShadow()
    shadow.shadowBlurRadius = 2 * metrics.scale
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.58)
    shadow.shadowOffset = NSSize(width: 0, height: -1 * metrics.scale)
    return [
      .font: metrics.countFont,
      .foregroundColor: NSColor.white,
      .shadow: shadow,
    ]
  }

  override func mouseDown(with event: NSEvent) {
    mouseDownStatus = nil
    beginDragTracking()
    mouseDownStatus = status(at: convert(event.locationInWindow, from: nil))
  }

  override func mouseDragged(with event: NSEvent) {
    guard let dragState, let window else {
      return
    }
    if !dragState.didMove {
      self.dragState?.didMove = true
      mouseDownStatus = nil
      onDrag()
    }
    let mouseLocation = NSEvent.mouseLocation
    window.setFrameOrigin(
      NSPoint(
        x: dragState.windowOriginStart.x + mouseLocation.x - dragState.mouseStart.x,
        y: dragState.windowOriginStart.y + mouseLocation.y - dragState.mouseStart.y))
  }

  override func mouseUp(with event: NSEvent) {
    if dragState?.didMove == true {
      dragState = nil
      return
    }
    dragState = nil
    guard let mouseDownStatus else {
      return
    }
    defer {
      self.mouseDownStatus = nil
    }
    if status(at: convert(event.locationInWindow, from: nil)) == mouseDownStatus {
      onClick(mouseDownStatus)
    }
  }

  private func beginDragTracking() {
    guard let window else {
      return
    }
    dragState = DragState(
      mouseStart: NSEvent.mouseLocation,
      windowOriginStart: window.frame.origin)
  }

  private func status(at point: NSPoint) -> NativeSessionStatusIndicatorStatus? {
    itemRects().first { _, rect in rect.contains(point) }?.0.status
  }

  private func itemRects() -> [(SessionStatusIndicatorItem, NSRect)] {
    let metrics = currentMetrics
    let centerY = bounds.midY
    let itemWidths = items.map { diameter(for: $0) }
    let groupWidth =
      itemWidths.reduce(0, +)
      + CGFloat(max(items.count - 1, 0)) * metrics.itemGap
    var x = (bounds.width - groupWidth) / 2
    return items.map { item in
      let diameter = diameter(for: item)
      let rect = NSRect(
        x: x,
        y: centerY - diameter / 2,
        width: diameter,
        height: diameter)
      x += diameter + metrics.itemGap
      return (item, rect)
    }
  }

  private func diameter(for item: SessionStatusIndicatorItem) -> CGFloat {
    let metrics = currentMetrics
    let label = NSAttributedString(
      string: "\(item.count)",
      attributes: [.font: metrics.countFont])
    return max(metrics.circleDiameter, ceil(label.size().width + metrics.minimumTextPadding))
  }
}
