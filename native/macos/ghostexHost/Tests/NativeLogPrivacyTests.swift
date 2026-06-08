import Foundation

func assertTrue(_ condition: Bool, _ message: String) {
  if !condition {
    fputs("\(message)\n", stderr)
    exit(1)
  }
}

func serializePrivacyTestPayload(_ payload: [String: Any]) -> String {
  guard
    JSONSerialization.isValidJSONObject(payload),
    let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
    let json = String(data: data, encoding: .utf8)
  else {
    fputs("privacy test payload did not serialize\n", stderr)
    exit(1)
  }
  return json
}

@main
enum NativeLogPrivacyTests {
  static func main() {
    let sanitized = NativeLogPrivacy.sanitizePayload([
      "details": [
        "authToken": "secret-token",
        "command": "codex --dangerously-do-something",
        "missingWorkspaceNativeSessionIds": ["P123:G456"],
        "projectId": "P123",
        "projectName": "Customer Project",
        "projectPath": "/Users/person/dev/customer-project",
        "sessionId": "G456",
        "url": "https://example.test/private?token=secret-token",
      ],
      "event": "nativeSidebar.gxserver.presentationTabReconciliation.mismatch",
    ])
    let json = serializePrivacyTestPayload(sanitized)

    assertTrue(json.contains("nativeSidebar.gxserver.presentationTabReconciliation.mismatch"), "event should remain visible")
    assertTrue(json.contains("P123"), "project id should remain visible")
    assertTrue(json.contains("G456"), "session id should remain visible")
    assertTrue(json.contains("missingWorkspaceNativeSessionIds"), "structured mismatch key should remain visible")
    assertTrue(!json.contains("Customer Project"), "project names must be redacted")
    assertTrue(!json.contains("/Users/person"), "paths must be redacted")
    assertTrue(!json.contains("codex --dangerously-do-something"), "command text must be redacted")
    assertTrue(!json.contains("secret-token"), "secrets must be redacted")
    assertTrue(!json.contains("private?token"), "full URLs and query strings must be redacted")

    let persistenceKillPayload = NativeLogPrivacy.sanitizePayload([
      "details": [
        "provider": "zmx",
        "reason": "sleepSession",
        "sessionId": "S456",
        "stderrBytes": 128,
        "stdoutBytes": 64,
        "terminationStatus": 0,
      ],
      "event": "nativeWorkspace.persistenceSessionKill.completed",
    ])
    let persistenceKillJson = serializePrivacyTestPayload(persistenceKillPayload)

    assertTrue(persistenceKillJson.contains("nativeWorkspace.persistenceSessionKill.completed"), "persistence kill event should remain visible")
    assertTrue(persistenceKillJson.contains("stderrBytes"), "stderr byte count should remain visible")
    assertTrue(persistenceKillJson.contains("stdoutBytes"), "stdout byte count should remain visible")
    assertTrue(!persistenceKillJson.contains("sessionName"), "persistence kill logs must not include provider session-name keys")
    assertTrue(!persistenceKillJson.contains("stderr\":\""), "persistence kill logs must not include stderr text")
    assertTrue(!persistenceKillJson.contains("stdout\":\""), "persistence kill logs must not include stdout text")
    assertTrue(!persistenceKillJson.contains("P1.S2"), "persistence kill logs must not include raw zmx names")

    let hotkeyReproPayload = NativeLogPrivacy.sanitizePayload([
      "actionId": "focusNextSession",
      "commandText": "codex --ask private request",
      "event": "nativeHotkeys.navigationRepro",
      "hotkey": "cmd+shift+]",
      "keyCode": "30",
      "phase": "appKitObserved",
      "projectName": "Private Customer Project",
      "projectPath": "/Users/person/dev/private-customer",
      "secretToken": "secret-token",
      "url": "https://example.test/private?token=secret-token",
    ])
    let hotkeyReproJson = serializePrivacyTestPayload(hotkeyReproPayload)

    assertTrue(hotkeyReproJson.contains("nativeHotkeys.navigationRepro"), "hotkey repro event should remain visible")
    assertTrue(hotkeyReproJson.contains("focusNextSession"), "hotkey repro action id should remain visible")
    assertTrue(hotkeyReproJson.contains("cmd+shift+]"), "hotkey repro shortcut id should remain visible")
    assertTrue(!hotkeyReproJson.contains("Private Customer Project"), "hotkey repro logs must not include project names")
    assertTrue(!hotkeyReproJson.contains("/Users/person"), "hotkey repro logs must not include paths")
    assertTrue(!hotkeyReproJson.contains("codex --ask private request"), "hotkey repro logs must not include command text")
    assertTrue(!hotkeyReproJson.contains("secret-token"), "hotkey repro logs must not include secrets")
    assertTrue(!hotkeyReproJson.contains("private?token"), "hotkey repro logs must not include full URLs or query strings")

    let terminalDropPayload = NativeLogPrivacy.sanitizePayload([
      "activeDropEventNumber": 1,
      "commandText": "codex --ask private request",
      "dragPasteboardChangeCount": 42,
      "event": "nativeWorkspace.terminalDrop.surface.entered",
      "filePath": "/Users/person/Pictures/private image.png",
      "hasRecentReleaseOnlyDragSignal": true,
      "phase": "entered",
      "registeredTypes": [
        "com.apple.finder.node",
        "com.apple.pasteboard.promised-file-url",
        "public.file-url",
        "public.url",
        "public.image",
      ],
      "releaseOnlyDragSignalAgeMs": 14,
      "releaseOnlyDragSignalPasteboardChangeCount": 42,
      "secretToken": "secret-token",
      "surfaceSessionId": "G456",
      "types": ["Apple URL pasteboard type", "NSFilenamesPboardType", "public.file-url", "public.url", "public.png", "public.jpeg"],
      "url": "file:///Users/person/Pictures/private%20image.png",
    ])
    let terminalDropJson = serializePrivacyTestPayload(terminalDropPayload)

    assertTrue(terminalDropJson.contains("nativeWorkspace.terminalDrop.surface.entered"), "terminal drop event should remain visible")
    assertTrue(terminalDropJson.contains("G456"), "terminal drop session id should remain visible")
    assertTrue(terminalDropJson.contains("public.file-url"), "terminal drop pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("public.url"), "terminal drop URL pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("public.jpeg"), "terminal drop image pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("com.apple.finder.node"), "terminal drop Finder pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("NSFilenamesPboardType"), "terminal drop legacy filenames pasteboard type should remain visible")
    assertTrue(terminalDropJson.contains("releaseOnlyDragSignalAgeMs"), "terminal drop release-only signal timing should remain visible")
    assertTrue(terminalDropJson.contains("releaseOnlyDragSignalPasteboardChangeCount"), "terminal drop release-only signal pasteboard count should remain visible")
    assertTrue(!terminalDropJson.contains("/Users/person"), "terminal drop logs must not include dropped paths")
    assertTrue(!terminalDropJson.contains("private image.png"), "terminal drop logs must not include dropped filenames")
    assertTrue(!terminalDropJson.contains("codex --ask private request"), "terminal drop logs must not include command text")
    assertTrue(!terminalDropJson.contains("secret-token"), "terminal drop logs must not include secrets")

    let overlayGeometryPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.terminalDrop.overlay.hitTest",
      "eventType": "leftMouseDragged",
      "filePath": "/Users/person/Pictures/private image.png",
      "geometryDragPassedThrough": true,
      "hasRelevantPayload": false,
      "overlayDragDestinationRegistered": false,
      "readsGlobalDragPasteboard": false,
      "secretToken": "secret-token",
      "shouldCapture": false,
      "shouldCaptureInactiveGeometryDestination": false,
      "shouldCaptureInactiveGeometryDrag": true,
      "typeCount": 0,
      "types": [],
      "url": "file:///Users/person/Pictures/private%20image.png",
      "windowIsKey": false,
      "windowIsVisible": true,
    ])
    let overlayGeometryJson = serializePrivacyTestPayload(overlayGeometryPayload)

    assertTrue(overlayGeometryJson.contains("nativeWorkspace.terminalDrop.overlay.hitTest"), "overlay hit-test event should remain visible")
    assertTrue(overlayGeometryJson.contains("geometryDragPassedThrough"), "overlay geometry pass-through state should remain visible")
    assertTrue(overlayGeometryJson.contains("overlayDragDestinationRegistered"), "overlay drag-destination registration state should remain visible")
    assertTrue(overlayGeometryJson.contains("readsGlobalDragPasteboard"), "overlay global-pasteboard access state should remain visible")
    assertTrue(overlayGeometryJson.contains("shouldCaptureInactiveGeometryDestination"), "overlay destination-capture state should remain visible")
    assertTrue(overlayGeometryJson.contains("shouldCaptureInactiveGeometryDrag"), "overlay geometry capture state should remain visible")
    assertTrue(overlayGeometryJson.contains("windowIsKey"), "overlay window key state should remain visible")
    assertTrue(!overlayGeometryJson.contains("/Users/person"), "overlay geometry logs must not include dropped paths")
    assertTrue(!overlayGeometryJson.contains("private image.png"), "overlay geometry logs must not include dropped filenames")
    assertTrue(!overlayGeometryJson.contains("codex --ask private request"), "overlay geometry logs must not include command text")
    assertTrue(!overlayGeometryJson.contains("secret-token"), "overlay geometry logs must not include secrets")

    let overlayVisualOnlyPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.terminalDrop.overlay.visualOnly",
      "filePath": "/Users/person/Pictures/private image.png",
      "operationSource": "overlay",
      "registeredTypeCount": 0,
      "registeredTypes": [],
      "secretToken": "secret-token",
      "url": "file:///Users/person/Pictures/private%20image.png",
      "usesGeometryHoverOnly": true,
    ])
    let overlayVisualOnlyJson = serializePrivacyTestPayload(overlayVisualOnlyPayload)

    assertTrue(overlayVisualOnlyJson.contains("nativeWorkspace.terminalDrop.overlay.visualOnly"), "overlay visual-only event should remain visible")
    assertTrue(overlayVisualOnlyJson.contains("usesGeometryHoverOnly"), "overlay visual-only mode should remain visible")
    assertTrue(overlayVisualOnlyJson.contains("registeredTypeCount"), "overlay visual-only registered type count should remain visible")
    assertTrue(!overlayVisualOnlyJson.contains("/Users/person"), "overlay visual-only logs must not include dropped paths")
    assertTrue(!overlayVisualOnlyJson.contains("private image.png"), "overlay visual-only logs must not include dropped filenames")
    assertTrue(!overlayVisualOnlyJson.contains("codex --ask private request"), "overlay visual-only logs must not include command text")
    assertTrue(!overlayVisualOnlyJson.contains("secret-token"), "overlay visual-only logs must not include secrets")

    let registrationDisabledPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.terminalDrop.window.registrationDisabled",
      "filePath": "/Users/person/Pictures/private image.png",
      "operationSource": "window",
      "registeredTypeCount": 0,
      "registeredTypes": [],
      "secretToken": "secret-token",
      "surfaceOnlyDropDestination": true,
      "url": "file:///Users/person/Pictures/private%20image.png",
    ])
    let registrationDisabledJson = serializePrivacyTestPayload(registrationDisabledPayload)

    assertTrue(registrationDisabledJson.contains("nativeWorkspace.terminalDrop.window.registrationDisabled"), "disabled terminal drop registration event should remain visible")
    assertTrue(registrationDisabledJson.contains("surfaceOnlyDropDestination"), "surface-only drop registration state should remain visible")
    assertTrue(registrationDisabledJson.contains("registeredTypeCount"), "disabled registration type count should remain visible")
    assertTrue(!registrationDisabledJson.contains("/Users/person"), "disabled registration logs must not include dropped paths")
    assertTrue(!registrationDisabledJson.contains("private image.png"), "disabled registration logs must not include dropped filenames")
    assertTrue(!registrationDisabledJson.contains("codex --ask private request"), "disabled registration logs must not include command text")
    assertTrue(!registrationDisabledJson.contains("secret-token"), "disabled registration logs must not include secrets")

    let terminalWrapperRegistrationPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.terminalDrop.terminalHost.registeredTypes",
      "filePath": "/Users/person/Pictures/private image.png",
      "operationSource": "terminalHost",
      "preparedContent": "[Image #1](/Users/person/Pictures/private image.png)",
      "registeredTypeCount": 2,
      "registeredTypes": ["public.file-url", "public.utf8-plain-text"],
      "secretToken": "secret-token",
      "surfaceSessionId": "G456",
      "url": "file:///Users/person/Pictures/private%20image.png",
    ])
    let terminalWrapperRegistrationJson = serializePrivacyTestPayload(terminalWrapperRegistrationPayload)

    assertTrue(terminalWrapperRegistrationJson.contains("nativeWorkspace.terminalDrop.terminalHost.registeredTypes"), "terminal wrapper registration event should remain visible")
    assertTrue(terminalWrapperRegistrationJson.contains("terminalHost"), "terminal wrapper operation source should remain visible")
    assertTrue(terminalWrapperRegistrationJson.contains("registeredTypeCount"), "terminal wrapper registered type count should remain visible")
    assertTrue(terminalWrapperRegistrationJson.contains("public.file-url"), "terminal wrapper registered file URL type should remain visible")
    assertTrue(!terminalWrapperRegistrationJson.contains("/Users/person"), "terminal wrapper registration logs must not include dropped paths")
    assertTrue(!terminalWrapperRegistrationJson.contains("private image.png"), "terminal wrapper registration logs must not include dropped filenames")
    assertTrue(!terminalWrapperRegistrationJson.contains("[Image #1]"), "terminal wrapper registration logs must not include prepared terminal text")
    assertTrue(!terminalWrapperRegistrationJson.contains("codex --ask private request"), "terminal wrapper registration logs must not include command text")
    assertTrue(!terminalWrapperRegistrationJson.contains("secret-token"), "terminal wrapper registration logs must not include secrets")

    let titlebarChromeDropPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.terminalDrop.titlebarChrome.entered.routeToRoot",
      "filePath": "/Users/person/Pictures/private image.png",
      "operationSource": "titlebarChrome",
      "pasteboardChangeCount": 42,
      "phase": "entered",
      "preparedContent": "[Image #1](/Users/person/Pictures/private image.png)",
      "registeredTypeMatchCount": 1,
      "registeredTypes": ["public.file-url", "public.utf8-plain-text"],
      "secretToken": "secret-token",
      "typeCount": 4,
      "types": ["Apple URL pasteboard type", "NSFilenamesPboardType", "public.file-url", "public.jpeg"],
      "url": "file:///Users/person/Pictures/private%20image.png",
    ])
    let titlebarChromeDropJson = serializePrivacyTestPayload(titlebarChromeDropPayload)

    assertTrue(titlebarChromeDropJson.contains("nativeWorkspace.terminalDrop.titlebarChrome.entered.routeToRoot"), "titlebar chrome drop forwarding event should remain visible")
    assertTrue(titlebarChromeDropJson.contains("titlebarChrome"), "titlebar chrome drop operation source should remain visible")
    assertTrue(titlebarChromeDropJson.contains("registeredTypeMatchCount"), "titlebar chrome registered type match count should remain visible")
    assertTrue(titlebarChromeDropJson.contains("public.file-url"), "titlebar chrome pasteboard type should remain visible")
    assertTrue(!titlebarChromeDropJson.contains("/Users/person"), "titlebar chrome drop logs must not include dropped paths")
    assertTrue(!titlebarChromeDropJson.contains("private image.png"), "titlebar chrome drop logs must not include dropped filenames")
    assertTrue(!titlebarChromeDropJson.contains("[Image #1]"), "titlebar chrome drop logs must not include prepared terminal text")
    assertTrue(!titlebarChromeDropJson.contains("codex --ask private request"), "titlebar chrome drop logs must not include command text")
    assertTrue(!titlebarChromeDropJson.contains("secret-token"), "titlebar chrome drop logs must not include secrets")

    let titlebarWebViewDisabledPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.terminalDrop.titlebarChromeWebView.registrationDisabled",
      "filePath": "/Users/person/Pictures/private image.png",
      "operationSource": "titlebarChromeWebView",
      "registeredTypeCount": 0,
      "registeredTypes": [],
      "secretToken": "secret-token",
      "usesNativeChromeDropForwarder": true,
      "webViewDropDestination": false,
    ])
    let titlebarWebViewDisabledJson = serializePrivacyTestPayload(titlebarWebViewDisabledPayload)

    assertTrue(titlebarWebViewDisabledJson.contains("nativeWorkspace.terminalDrop.titlebarChromeWebView.registrationDisabled"), "titlebar webview disabled registration event should remain visible")
    assertTrue(titlebarWebViewDisabledJson.contains("webViewDropDestination"), "titlebar webview drop ownership state should remain visible")
    assertTrue(titlebarWebViewDisabledJson.contains("usesNativeChromeDropForwarder"), "titlebar native drop forwarder state should remain visible")
    assertTrue(!titlebarWebViewDisabledJson.contains("/Users/person"), "titlebar webview disabled logs must not include dropped paths")
    assertTrue(!titlebarWebViewDisabledJson.contains("private image.png"), "titlebar webview disabled logs must not include dropped filenames")
    assertTrue(!titlebarWebViewDisabledJson.contains("codex --ask private request"), "titlebar webview disabled logs must not include command text")
    assertTrue(!titlebarWebViewDisabledJson.contains("secret-token"), "titlebar webview disabled logs must not include secrets")

    let titlebarWebViewFootprintPayload = NativeLogPrivacy.sanitizePayload([
      "appIsActive": false,
      "commandText": "codex --ask private request",
      "didChange": true,
      "event": "nativeWorkspace.terminalDrop.titlebarChrome.webViewFootprint",
      "filePath": "/Users/person/Pictures/private image.png",
      "mode": "titlebarStrip",
      "operationSource": "titlebarChrome",
      "projectName": "Private Customer Project",
      "reason": "appDidResignActive",
      "secretToken": "secret-token",
      "terminalPaneDropForwardingActive": false,
      "titlebarHeight": 35,
      "url": "file:///Users/person/Pictures/private%20image.png",
      "webViewFrame": ["height": 35, "minX": 0, "minY": 977, "width": 1440],
      "windowIsKey": false,
      "wrapperBounds": ["height": 1012, "minX": 0, "minY": 0, "width": 1440],
    ])
    let titlebarWebViewFootprintJson = serializePrivacyTestPayload(titlebarWebViewFootprintPayload)

    assertTrue(titlebarWebViewFootprintJson.contains("nativeWorkspace.terminalDrop.titlebarChrome.webViewFootprint"), "titlebar webview footprint event should remain visible")
    assertTrue(titlebarWebViewFootprintJson.contains("titlebarStrip"), "titlebar webview footprint mode should remain visible")
    assertTrue(titlebarWebViewFootprintJson.contains("appDidResignActive"), "titlebar webview footprint reason should remain visible")
    assertTrue(titlebarWebViewFootprintJson.contains("webViewFrame"), "titlebar webview footprint geometry should remain visible")
    assertTrue(!titlebarWebViewFootprintJson.contains("Private Customer Project"), "titlebar webview footprint logs must not include project names")
    assertTrue(!titlebarWebViewFootprintJson.contains("/Users/person"), "titlebar webview footprint logs must not include paths")
    assertTrue(!titlebarWebViewFootprintJson.contains("private image.png"), "titlebar webview footprint logs must not include filenames")
    assertTrue(!titlebarWebViewFootprintJson.contains("codex --ask private request"), "titlebar webview footprint logs must not include command text")
    assertTrue(!titlebarWebViewFootprintJson.contains("secret-token"), "titlebar webview footprint logs must not include secrets")

    let titlebarForwarderHitTestPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.terminalDrop.titlebarChrome.hitTest.forwarder",
      "eventNumber": 29137,
      "eventType": "leftMouseDragged",
      "filePath": "/Users/person/Pictures/private image.png",
      "hitRegionCount": 8,
      "interactiveHitRegion": false,
      "operationSource": "titlebarChrome",
      "point": ["x": 900, "y": 420],
      "projectName": "Private Customer Project",
      "registeredTypeCount": 2,
      "registeredTypes": ["public.file-url", "public.utf8-plain-text"],
      "route": "nativeWrapper",
      "secretToken": "secret-token",
      "titlebarHeight": 35,
      "titlebarStrip": false,
      "url": "file:///Users/person/Pictures/private%20image.png",
      "webViewDropDestination": false,
    ])
    let titlebarForwarderHitTestJson = serializePrivacyTestPayload(titlebarForwarderHitTestPayload)

    assertTrue(titlebarForwarderHitTestJson.contains("nativeWorkspace.terminalDrop.titlebarChrome.hitTest.forwarder"), "titlebar drop-forwarder hit-test event should remain visible")
    assertTrue(titlebarForwarderHitTestJson.contains("nativeWrapper"), "titlebar drop-forwarder route should remain visible")
    assertTrue(titlebarForwarderHitTestJson.contains("webViewDropDestination"), "titlebar drop-forwarder webview ownership state should remain visible")
    assertTrue(titlebarForwarderHitTestJson.contains("registeredTypeCount"), "titlebar drop-forwarder registered type count should remain visible")
    assertTrue(!titlebarForwarderHitTestJson.contains("Private Customer Project"), "titlebar drop-forwarder hit-test logs must not include project names")
    assertTrue(!titlebarForwarderHitTestJson.contains("/Users/person"), "titlebar drop-forwarder hit-test logs must not include paths")
    assertTrue(!titlebarForwarderHitTestJson.contains("private image.png"), "titlebar drop-forwarder hit-test logs must not include filenames")
    assertTrue(!titlebarForwarderHitTestJson.contains("codex --ask private request"), "titlebar drop-forwarder hit-test logs must not include command text")
    assertTrue(!titlebarForwarderHitTestJson.contains("secret-token"), "titlebar drop-forwarder hit-test logs must not include secrets")

    let titlebarHitTestPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.reactTitlebar.hitTest.route",
      "eventNumber": 29136,
      "eventType": "leftMouseDown",
      "filePath": "/Users/person/Pictures/private image.png",
      "hitRegionCount": 8,
      "hitViewFound": true,
      "overlayOpen": false,
      "point": ["x": 900, "y": 979],
      "projectName": "Private Customer Project",
      "route": "webView",
      "secretToken": "secret-token",
      "titlebarHeight": 35,
      "url": "file:///Users/person/Pictures/private%20image.png",
      "webViewFrame": ["height": 1012, "minX": 0, "minY": 0, "width": 1440],
      "wrapperBounds": ["height": 1012, "minX": 0, "minY": 0, "width": 1440],
    ])
    let titlebarHitTestJson = serializePrivacyTestPayload(titlebarHitTestPayload)

    assertTrue(titlebarHitTestJson.contains("nativeWorkspace.reactTitlebar.hitTest.route"), "titlebar hit-test event should remain visible")
    assertTrue(titlebarHitTestJson.contains("webView"), "titlebar hit-test route should remain visible")
    assertTrue(titlebarHitTestJson.contains("webViewFrame"), "titlebar hit-test webview geometry should remain visible")
    assertTrue(titlebarHitTestJson.contains("hitRegionCount"), "titlebar hit-test hit-region count should remain visible")
    assertTrue(!titlebarHitTestJson.contains("Private Customer Project"), "titlebar hit-test logs must not include project names")
    assertTrue(!titlebarHitTestJson.contains("/Users/person"), "titlebar hit-test logs must not include paths")
    assertTrue(!titlebarHitTestJson.contains("private image.png"), "titlebar hit-test logs must not include filenames")
    assertTrue(!titlebarHitTestJson.contains("codex --ask private request"), "titlebar hit-test logs must not include command text")
    assertTrue(!titlebarHitTestJson.contains("secret-token"), "titlebar hit-test logs must not include secrets")

    let forwardedHostDropPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "draggingSourceOperationMaskRaw": "18446744073709551615",
      "event": "nativeWorkspace.terminalDrop.terminalHost.perform.routeToSurface",
      "filePath": "/Users/person/Pictures/private image.png",
      "operationSource": "terminalHost",
      "preparedContent": "[Image #1](/Users/person/Pictures/private image.png)",
      "secretToken": "secret-token",
      "surfaceCanPerformDrop": true,
      "surfaceSessionId": "G456",
      "types": ["Apple URL pasteboard type", "NSFilenamesPboardType", "public.file-url", "public.jpeg"],
      "url": "file:///Users/person/Pictures/private%20image.png",
    ])
    let forwardedHostDropJson = serializePrivacyTestPayload(forwardedHostDropPayload)

    assertTrue(forwardedHostDropJson.contains("nativeWorkspace.terminalDrop.terminalHost.perform.routeToSurface"), "forwarded host drop event should remain visible")
    assertTrue(forwardedHostDropJson.contains("terminalHost"), "forwarded host operation source should remain visible")
    assertTrue(forwardedHostDropJson.contains("draggingSourceOperationMaskRaw"), "forwarded host raw drag mask key should remain visible")
    assertTrue(forwardedHostDropJson.contains("surfaceCanPerformDrop"), "forwarded host surface routing state should remain visible")
    assertTrue(!forwardedHostDropJson.contains("/Users/person"), "forwarded host logs must not include dropped paths")
    assertTrue(!forwardedHostDropJson.contains("private image.png"), "forwarded host logs must not include dropped filenames")
    assertTrue(!forwardedHostDropJson.contains("[Image #1]"), "forwarded host logs must not include prepared terminal text")
    assertTrue(!forwardedHostDropJson.contains("codex --ask private request"), "forwarded host logs must not include command text")
    assertTrue(!forwardedHostDropJson.contains("secret-token"), "forwarded host logs must not include secrets")

    let hoverFeedbackPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "event": "nativeWorkspace.terminalDrop.hoverFeedback.visible",
      "eventNumber": 26923,
      "eventType": "entered",
      "filePath": "/Users/person/Pictures/private image.png",
      "operationSource": "titlebarChrome",
      "preparedContent": "[Image #1](/Users/person/Pictures/private image.png)",
      "secretToken": "secret-token",
      "surfaceSessionId": "G456",
      "targetFrame": ["height": 512, "minX": 0, "minY": 0, "width": 768],
      "url": "file:///Users/person/Pictures/private%20image.png",
      "visualAlpha": 0,
      "workspaceBoundsContainsPoint": true,
    ])
    let hoverFeedbackJson = serializePrivacyTestPayload(hoverFeedbackPayload)

    assertTrue(hoverFeedbackJson.contains("nativeWorkspace.terminalDrop.hoverFeedback.visible"), "hover feedback event should remain visible")
    assertTrue(hoverFeedbackJson.contains("titlebarChrome"), "hover feedback operation source should remain visible")
    assertTrue(hoverFeedbackJson.contains("targetFrame"), "hover feedback geometry should remain visible")
    assertTrue(hoverFeedbackJson.contains("visualAlpha"), "hover feedback visual alpha should remain visible")
    assertTrue(!hoverFeedbackJson.contains("/Users/person"), "hover feedback logs must not include dropped paths")
    assertTrue(!hoverFeedbackJson.contains("private image.png"), "hover feedback logs must not include dropped filenames")
    assertTrue(!hoverFeedbackJson.contains("[Image #1]"), "hover feedback logs must not include prepared terminal text")
    assertTrue(!hoverFeedbackJson.contains("codex --ask private request"), "hover feedback logs must not include command text")
    assertTrue(!hoverFeedbackJson.contains("secret-token"), "hover feedback logs must not include secrets")

    let applicationFileOpenPayload = NativeLogPrivacy.sanitizePayload([
      "commandText": "codex --ask private request",
      "didRouteTerminalDrop": false,
      "event": "nativeWorkspace.terminalDrop.applicationOpenFile.inspect",
      "filePath": "/Users/person/Pictures/private image.png",
      "operationSource": "applicationOpenFile",
      "path": "/Users/person/Pictures/private image.png",
      "pathCount": 1,
      "secretToken": "secret-token",
      "url": "file:///Users/person/Pictures/private%20image.png",
    ])
    let applicationFileOpenJson = serializePrivacyTestPayload(applicationFileOpenPayload)

    assertTrue(applicationFileOpenJson.contains("nativeWorkspace.terminalDrop.applicationOpenFile.inspect"), "application file-open drop event should remain visible")
    assertTrue(applicationFileOpenJson.contains("didRouteTerminalDrop"), "application file-open route state should remain visible")
    assertTrue(!applicationFileOpenJson.contains("/Users/person"), "application file-open logs must not include dropped paths")
    assertTrue(!applicationFileOpenJson.contains("private image.png"), "application file-open logs must not include dropped filenames")
    assertTrue(!applicationFileOpenJson.contains("codex --ask private request"), "application file-open logs must not include command text")
    assertTrue(!applicationFileOpenJson.contains("secret-token"), "application file-open logs must not include secrets")

    assertTrue(
      isNativePersistentTerminalDropReproEvent("nativeWorkspace.terminalDrop.surface.entered", force: true),
      "forced terminal drop events should persist for repros")
    assertTrue(
      !isNativePersistentTerminalDropReproEvent("nativeWorkspace.terminalDrop.surface.updated", force: false),
      "non-forced terminal drop updates should stay quiet unless debugging mode is enabled")
    assertTrue(
      !isNativePersistentTerminalDropReproEvent("nativeWorkspace.unrelated", force: true),
      "unrelated forced events should not use the terminal drop repro gate")

    assertTrue(
      isNativePersistentLogImportantDiagnostic("nativeSidebar.gxserver.sessionTitleEventFailed"),
      "failed native diagnostic events should persist in normal mode")
    assertTrue(
      isNativePersistentLogImportantDiagnostic("nativeWorkspace.runtime.timeout"),
      "timeout native diagnostic events should persist in normal mode")
    assertTrue(
      !isNativePersistentLogImportantDiagnostic("nativeSidebar.gxserver.presentationDelta.applied"),
      "routine native diagnostic events should require debugging mode")
  }
}
