import Foundation

func assertDecision(
  _ actual: GxserverBuildIdentityReuseDecision,
  _ expected: GxserverBuildIdentityReuseDecision,
  _ message: String
) {
  if actual != expected {
    fputs("\(message): expected \(expected), got \(actual)\n", stderr)
    exit(1)
  }
}

assertDecision(
  GxserverClient.buildIdentityReuseDecision(
    response: ["buildIdentity": "gxserver:0.1.0:sha256:aaa"],
    expectedBuildIdentity: "gxserver:0.1.0:sha256:aaa"
  ),
  .compatible,
  "same packaged build should be reusable"
)

assertDecision(
  GxserverClient.buildIdentityReuseDecision(
    response: ["buildIdentity": "gxserver:0.1.0:sha256:old"],
    expectedBuildIdentity: "gxserver:0.1.0:sha256:new"
  ),
  .incompatible,
  "different packaged build should force restart"
)

assertDecision(
  GxserverClient.buildIdentityReuseDecision(
    response: [:],
    expectedBuildIdentity: "gxserver:0.1.0:sha256:new"
  ),
  .incompatible,
  "pre-identity daemon health should force restart when the app has an expected identity"
)

assertDecision(
  GxserverClient.buildIdentityReuseDecision(
    response: [:],
    expectedBuildIdentity: nil
  ),
  .unknownExpected,
  "missing local expected identity should not invent a mismatch"
)
