import Sparkle

final class GhostexSparkleUserDriver: SPUStandardUserDriver {
  /**
   CDXC:AutoUpdate 2026-06-08-19:16:
   Ghostex should keep Sparkle's supported release-notes, signature validation,
   install, relaunch, permission, and error handling UI, but it must not show
   the download or extraction status windows because the standard progress text
   exposes the app archive size. Suppress only the middle status callbacks so
   users see the changelog choice first and the install/relaunch choice next.
   */
  override func showDownloadInitiated(cancellation: @escaping () -> Void) {}

  override func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {}

  override func showDownloadDidReceiveData(ofLength length: UInt64) {}

  override func showDownloadDidStartExtractingUpdate() {}

  override func showExtractionReceivedProgress(_ progress: Double) {}
}
