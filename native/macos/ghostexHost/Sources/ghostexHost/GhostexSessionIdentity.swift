import Foundation

/*
 CDXC:PromptEditor 2026-06-09-21:50:
 Native AppKit focus state is keyed by project/session ids in P:G form, while
 gxserver and zmx expose canonical global refs as S:P:G. Accept both formats at
 native focus boundaries and normalize global refs to P:G before looking up
 panes, so prompt-editor return focus can use current gxserver identity without
 spreading server ids through local workspace maps.
 */
func ghostexNativeFocusSessionId(from value: String?) -> String? {
  guard let value else {
    return nil
  }
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    return nil
  }
  let parts = trimmed.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
  if parts.count == 3,
    ghostexSessionIdentityPartMatches(parts[0], pattern: #"^S[0-9][a-z0-9]$"#),
    ghostexSessionIdentityPartMatches(parts[1], pattern: #"^P[0-9][a-z0-9]{3}$"#),
    ghostexSessionIdentityPartMatches(parts[2], pattern: #"^G[0-9][a-z0-9]{3}$"#)
  {
    return "\(parts[1]):\(parts[2])"
  }
  return trimmed
}

private func ghostexSessionIdentityPartMatches(_ value: String, pattern: String) -> Bool {
  value.range(of: pattern, options: .regularExpression) != nil
}
