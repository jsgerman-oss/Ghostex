import AppKit
import CryptoKit
import Foundation
import WebKit

enum NativeBrowserReactGrabSettings {
  static let defaultVersion = "0.1.29"
  static let knownHashes = [
    "0.1.29": "4a1e71090e8ad8bb6049de80ccccdc0f5bb147b9f8fb88886d871612ac7ca04b"
  ]

  static func scriptURL(for version: String) -> URL {
    URL(string: "https://unpkg.com/react-grab@\(version)/dist/index.global.js")!
  }
}

/**
 CDXC:BrowserPanes 2026-05-02-06:35
 Browser panes need the same React Grab injection capability as the native
 browser implementation. Keep the loader integrity-checked and cached so the
 action does not silently execute a changed CDN payload.
 */
enum NativeBrowserReactGrabScriptLoader {
  private static var cachedScript: String?
  private static var cachedVersion: String?

  static func fetch() async -> String? {
    let version = NativeBrowserReactGrabSettings.defaultVersion
    if cachedVersion == version, let cachedScript {
      return cachedScript
    }

    let url = NativeBrowserReactGrabSettings.scriptURL(for: version)
    do {
      let (data, _) = try await URLSession.shared.data(from: url)
      if let expectedHash = NativeBrowserReactGrabSettings.knownHashes[version] {
        let hash = SHA256.hash(data: data)
        let hex = hash.compactMap { String(format: "%02x", $0) }.joined()
        guard hex == expectedHash else {
          NSLog("ReactGrab: integrity mismatch for v%@ (got %@)", version, hex)
          return nil
        }
      }
      guard let script = String(data: data, encoding: .utf8) else {
        return nil
      }
      cachedScript = script
      cachedVersion = version
      return script
    } catch {
      NSLog("ReactGrab: fetch failed for v%@: %@", version, error.localizedDescription)
      return nil
    }
  }
}

@MainActor
enum NativeBrowserReactGrabInjector {
  private static func combinedScript(scriptSource: String) -> String {
    """
      (function() {
        if (window.__REACT_GRAB__) {
          window.__REACT_GRAB__.toggle();
          return;
        }
        window.addEventListener('react-grab:init', function(event) {
          var api = event.detail;
          if (!api) return;
          api.activate();
        }, { once: true });
      })();
      \(scriptSource)
      """
  }

  static func toggleOrInject(into webView: WKWebView) async {
    guard let scriptSource = await NativeBrowserReactGrabScriptLoader.fetch() else {
      NSSound.beep()
      return
    }

    let combined = combinedScript(scriptSource: scriptSource)

    do {
      _ = try await webView.evaluateJavaScript(combined)
    } catch {
      NSLog("ReactGrab: injection failed: %@", error.localizedDescription)
      NSSound.beep()
    }
  }

  static func toggleOrInject(into chromiumView: GhostexCEFBrowserView) async {
    guard let scriptSource = await NativeBrowserReactGrabScriptLoader.fetch() else {
      NSSound.beep()
      return
    }

    /**
     CDXC:ChromiumBrowserPanes 2026-05-04-16:51
     Browser-pane tools must operate on the actual Chromium renderer. Execute
     React Grab through CEF JavaScript evaluation instead of keeping a hidden
     WebKit-only injection path for normal browser panes.
     */
    chromiumView.executeJavaScript(combinedScript(scriptSource: scriptSource))
  }
}

enum NativeBrowserAgentationSettings {
  static let defaultVersion = "3.0.2"
  static let reactVersion = "18.2.0"

  static func packageModuleURL(for version: String) -> URL {
    URL(string: "https://esm.sh/agentation@\(version)?bundle&deps=react@\(reactVersion),react-dom@\(reactVersion)")!
  }

  static func reactModuleURL() -> URL {
    URL(string: "https://esm.sh/react@\(reactVersion)")!
  }

  static func reactDOMClientModuleURL() -> URL {
    URL(string: "https://esm.sh/react-dom@\(reactVersion)/client?deps=react@\(reactVersion)")!
  }
}

@MainActor
enum NativeBrowserAgentationInjector {
  private static func combinedScript() -> String {
    let packageURL = NativeBrowserAgentationSettings.packageModuleURL(
      for: NativeBrowserAgentationSettings.defaultVersion
    ).absoluteString
    let reactURL = NativeBrowserAgentationSettings.reactModuleURL().absoluteString
    let reactDOMClientURL = NativeBrowserAgentationSettings.reactDOMClientModuleURL().absoluteString

    /**
     CDXC:BrowserFeedbackTools 2026-05-22-09:18:
     Agentation ships as a React component rather than the global script format
     React Grab provides. Mount it through native JavaScript evaluation with
     pinned ESM module URLs so the CEF browser action starts the selected tool
     directly instead of falling back to React Grab.
     */
    return """
      (function() {
        const existing = window.__GHOSTEX_AGENTATION__;
        if (existing && typeof existing.unmount === 'function') {
          existing.unmount();
          return;
        }

        const state = {
          canceled: false,
          container: null,
          root: null,
          unmount: function() {
            this.canceled = true;
            if (this.root) {
              this.root.unmount();
            }
            if (this.container && this.container.parentNode) {
              this.container.parentNode.removeChild(this.container);
            }
            delete window.__GHOSTEX_AGENTATION__;
          }
        };
        window.__GHOSTEX_AGENTATION__ = state;

        const mount = async function() {
          const modules = await Promise.all([
            import('\(reactURL)'),
            import('\(reactDOMClientURL)'),
            import('\(packageURL)')
          ]);
          if (state.canceled) {
            return;
          }
          const React = modules[0].default || modules[0];
          const ReactDOMClient = modules[1];
          const Agentation = modules[2].Agentation;
          if (!React || typeof React.createElement !== 'function' || !ReactDOMClient.createRoot || !Agentation) {
            throw new Error('Agentation modules did not expose the expected React mounting API.');
          }

          const container = document.createElement('div');
          container.id = 'ghostex-agentation-root';
          container.setAttribute('data-agentation-root', 'true');
          (document.body || document.documentElement).appendChild(container);

          state.container = container;
          state.root = ReactDOMClient.createRoot(container);
          state.root.render(React.createElement(Agentation));
        };

        const start = function() {
          mount().catch(function(error) {
            console.warn('Agentation: injection failed', error);
            state.unmount();
          });
        };

        if (document.body || document.readyState !== 'loading') {
          start();
        } else {
          window.addEventListener('DOMContentLoaded', start, { once: true });
        }
      })();
      """
  }

  static func toggleOrInject(into webView: WKWebView) async {
    do {
      _ = try await webView.evaluateJavaScript(combinedScript())
    } catch {
      NSLog("Agentation: injection failed: %@", error.localizedDescription)
      NSSound.beep()
    }
  }

  static func toggleOrInject(into chromiumView: GhostexCEFBrowserView) async {
    chromiumView.executeJavaScript(combinedScript())
  }
}
