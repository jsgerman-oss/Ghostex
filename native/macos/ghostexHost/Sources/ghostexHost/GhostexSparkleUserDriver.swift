import Sparkle

final class GhostexSparkleUserDriver: SPUStandardUserDriver {
  var onDownloadActiveChanged: ((Bool) -> Void)?

  /**
   CDXC:AutoUpdate 2026-06-08-19:16:
   Ghostex should keep Sparkle's supported release-notes, signature validation,
   install, relaunch, permission, and error handling UI, but it must not show
   the download or extraction status windows because the standard progress text
   exposes the app archive size. Suppress only the middle status callbacks so
   users see the changelog choice first and the install/relaunch choice next.

   CDXC:AutoUpdate 2026-06-13-17:52:
   While Sparkle is downloading the accepted update, the titlebar download
   button should fade in and out instead of opening a separate progress window.
   Emit download-active changes from Sparkle's real download callbacks so React
   animates only during the supported updater download phase.
   */
  override func showDownloadInitiated(cancellation: @escaping () -> Void) {
    onDownloadActiveChanged?(true)
  }

  override func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {}

  override func showDownloadDidReceiveData(ofLength length: UInt64) {}

  override func showDownloadDidStartExtractingUpdate() {
    onDownloadActiveChanged?(false)
  }

  override func showExtractionReceivedProgress(_ progress: Double) {
    onDownloadActiveChanged?(false)
  }
}
