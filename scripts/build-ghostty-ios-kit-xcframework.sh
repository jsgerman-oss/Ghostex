#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GHOSTTY_DIR="$ROOT_DIR/ghostty"
OUTPUT_DIR="$ROOT_DIR/iOS/xcfs"
BUILD_PREFIX="$OUTPUT_DIR/ghostty-kit-build"

# CDXC:iOSNativeTerminals 2026-05-22-10:23:
# The final iOS terminal renderer must link GhosttyKit, not only the libghostty-vt parser bridge.
# Build Ghostty's universal XCFramework from the vendored checkout and copy it into the iOS framework directory that Xcode links for the native UIKit/Metal surface path.
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
  -Demit-xcframework=true \
  -Demit-macos-app=false \
  -Dxcframework-target=universal \
  -Doptimize=ReleaseSafe \
  --prefix "$BUILD_PREFIX"

if [[ -d "$GHOSTTY_DIR/macos/GhosttyKit.xcframework" ]]; then
  rm -rf "$OUTPUT_DIR/GhosttyKit.xcframework"
  cp -R "$GHOSTTY_DIR/macos/GhosttyKit.xcframework" "$OUTPUT_DIR/GhosttyKit.xcframework"
else
  find "$GHOSTTY_DIR" "$BUILD_PREFIX" -name 'GhosttyKit.xcframework' -maxdepth 5 -print
  echo "GhosttyKit.xcframework was not produced at the expected path." >&2
  exit 1
fi
