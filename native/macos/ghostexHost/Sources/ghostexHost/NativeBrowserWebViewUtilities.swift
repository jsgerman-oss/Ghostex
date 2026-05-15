import AppKit
import WebKit

extension WKWebView {
  func ghostexInspectorObject() -> NSObject? {
    let selector = NSSelectorFromString("_inspector")
    guard responds(to: selector),
      let inspector = perform(selector)?.takeUnretainedValue() as? NSObject
    else {
      return nil
    }
    return inspector
  }
}

extension NSObject {
  func ghostexCallBool(selector: Selector) -> Bool? {
    guard responds(to: selector) else { return nil }
    typealias Fn = @convention(c) (AnyObject, Selector) -> Bool
    let fn = unsafeBitCast(method(for: selector), to: Fn.self)
    return fn(self, selector)
  }

  func ghostexCallVoid(selector: Selector) {
    guard responds(to: selector) else { return }
    typealias Fn = @convention(c) (AnyObject, Selector) -> Void
    let fn = unsafeBitCast(method(for: selector), to: Fn.self)
    fn(self, selector)
  }
}

/**
 CDXC:BrowserPanes 2026-05-02-06:35
 Browser panes expose native WebKit inspector controls from their session card.
 The WebKit inspector API is private, so keep the selector bridge small and
 scoped to browser-pane commands instead of spreading Objective-C calls through
 the workspace controller.
 */
@MainActor
enum NativeBrowserDevTools {
  @discardableResult
  static func toggle(for webView: WKWebView) -> Bool {
    guard let inspector = webView.ghostexInspectorObject() else {
      return false
    }

    let isVisibleSelector = NSSelectorFromString("isVisible")
    let isVisible = inspector.ghostexCallBool(selector: isVisibleSelector) ?? false
    if isVisible {
      for rawSelector in ["hide", "close"] {
        let selector = NSSelectorFromString(rawSelector)
        if inspector.responds(to: selector) {
          inspector.ghostexCallVoid(selector: selector)
          return true
        }
      }
      return true
    }

    let attachSelector = NSSelectorFromString("attach")
    if inspector.responds(to: attachSelector) {
      inspector.ghostexCallVoid(selector: attachSelector)
    }
    let showSelector = NSSelectorFromString("show")
    guard inspector.responds(to: showSelector) else {
      return false
    }
    inspector.ghostexCallVoid(selector: showSelector)
    return true
  }
}
