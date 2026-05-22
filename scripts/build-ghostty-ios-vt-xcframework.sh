#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GHOSTTY_DIR="$ROOT_DIR/ghostty"
OUTPUT_DIR="$ROOT_DIR/iOS/xcfs"

# CDXC:iOSNativeTerminals 2026-05-22-09:33:
# The iOS app links Ghostty through a native libghostty-vt XCFramework so terminal parsing, scrollback, resize, and render state are not provided by JavaScript.
# Build the artifact from the vendored Ghostty checkout and place it where the iOS Xcode project already looks for native frameworks.
#
# CDXC:iOSNativeTerminals 2026-05-22-11:17:
# Xcode 26's macOS SDK exposes libSystem as arm64e-only in the TBD stub, which Zig 0.15.2 cannot use for native aarch64 build-runner links.
# Redirect only macosx SDK discovery to the newest Command Line Tools SDK that still exports arm64 while leaving iOS SDK and xcodebuild discovery on full Xcode.
mkdir -p "$OUTPUT_DIR"
cd "$GHOSTTY_DIR"

WRAPPER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ghostex-xcrun.XXXXXX")"
trap 'rm -rf "$WRAPPER_DIR"' EXIT
MACOS_SDK="$(
  find /Library/Developer/CommandLineTools/SDKs -maxdepth 1 -type d -name 'MacOSX*.sdk' 2>/dev/null \
    | while IFS= read -r sdk; do
        if grep -q 'arm64-macos' "$sdk/usr/lib/libSystem.tbd" 2>/dev/null; then
          printf '%s\n' "$sdk"
        fi
      done \
    | sort -Vr \
    | head -n 1
)"
if [[ -z "$MACOS_SDK" ]]; then
  echo "No Command Line Tools macOS SDK with arm64 libSystem exports was found." >&2
  exit 1
fi
cat > "$WRAPPER_DIR/xcrun" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--sdk" && "\${2:-}" == "macosx" && "\${3:-}" == "--show-sdk-path" ]]; then
  echo "$MACOS_SDK"
  exit 0
fi
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer /usr/bin/xcrun "\$@"
EOF
chmod +x "$WRAPPER_DIR/xcrun"

PATH="$WRAPPER_DIR:$PATH" zig build \
  -Demit-lib-vt=true \
  -Demit-xcframework=true \
  -Doptimize=ReleaseSafe \
  --prefix "$OUTPUT_DIR/ghostty-vt-build"

if [[ -d "$OUTPUT_DIR/ghostty-vt-build/ghostty-vt.xcframework" ]]; then
  rm -rf "$OUTPUT_DIR/ghostty-vt.xcframework"
  cp -R "$OUTPUT_DIR/ghostty-vt-build/ghostty-vt.xcframework" "$OUTPUT_DIR/ghostty-vt.xcframework"
elif [[ -d "$OUTPUT_DIR/ghostty-vt-build/lib/ghostty-vt.xcframework" ]]; then
  rm -rf "$OUTPUT_DIR/ghostty-vt.xcframework"
  cp -R "$OUTPUT_DIR/ghostty-vt-build/lib/ghostty-vt.xcframework" "$OUTPUT_DIR/ghostty-vt.xcframework"
else
  find "$OUTPUT_DIR/ghostty-vt-build" -name '*.xcframework' -maxdepth 4 -print
  echo "ghostty-vt.xcframework was not produced at the expected path." >&2
  exit 1
fi
