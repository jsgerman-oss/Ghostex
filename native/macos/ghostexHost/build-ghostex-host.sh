#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="$SCRIPT_DIR/ghostex.xcodeproj"
CONFIGURATION="${CONFIGURATION:-Debug}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WEB_DIR="$SCRIPT_DIR/Web"
GHOSTTY_ROOT="${GHOSTTY_ROOT:-}"
GHOSTEX_MACOS_ARCH="${GHOSTEX_MACOS_ARCH:-$(uname -m)}"
case "$GHOSTEX_MACOS_ARCH" in
	arm64 | aarch64)
		GHOSTEX_MACOS_ARCH="arm64"
		;;
	x86_64 | x64 | amd64)
		GHOSTEX_MACOS_ARCH="x86_64"
		;;
	*)
		echo "Unsupported GHOSTEX_MACOS_ARCH: $GHOSTEX_MACOS_ARCH" >&2
		exit 1
		;;
esac
DERIVED_DATA="${DERIVED_DATA:-$REPO_ROOT/build/$GHOSTEX_MACOS_ARCH}"
GHOSTEX_APP_VARIANT="${GHOSTEX_APP_VARIANT:-prod}"
if [[ "$GHOSTEX_APP_VARIANT" == "dev" ]]; then
	# CDXC:DevAppFlavor 2026-04-28-02:01: The dev build must generate a
	# distinct macOS app with its own bundle id.
	# CDXC:DevAppFlavor 2026-05-11-12:10: `bun start:dev` must not share
	# settings, projects, sessions, hooks, browser profiles, or runtime state
	# with the installed app, so both diagnostic and workflow homes use
	# ~/.ghostex-dev.
	GHOSTEX_APP_NAME="${GHOSTEX_APP_NAME:-Ghostex-dev}"
	GHOSTEX_APP_DISPLAY_NAME="${GHOSTEX_APP_DISPLAY_NAME:-Ghostex Dev}"
	GHOSTEX_BUNDLE_ID="${GHOSTEX_BUNDLE_ID:-com.madda.ghostex-dev.host}"
	GHOSTEX_HOME_DIRECTORY_NAME="${GHOSTEX_HOME_DIRECTORY_NAME:-.ghostex-dev}"
	GHOSTEX_SHARED_HOME_DIRECTORY_NAME="${GHOSTEX_SHARED_HOME_DIRECTORY_NAME:-.ghostex-dev}"
	GHOSTEX_SPARKLE_FEED_URL="${GHOSTEX_SPARKLE_FEED_URL:-https://raw.githubusercontent.com/maddada/Ghostex/main/appcast.xml}"
	GHOSTEX_SPARKLE_PUBLIC_ED_KEY="${GHOSTEX_SPARKLE_PUBLIC_ED_KEY:-AGWDPeMqfhmbjt8Pbk+VTC9fDfXAYq+cZoLGCYuGn70=}"
else
	GHOSTEX_APP_NAME="${GHOSTEX_APP_NAME:-Ghostex}"
	GHOSTEX_APP_DISPLAY_NAME="${GHOSTEX_APP_DISPLAY_NAME:-Ghostex}"
	GHOSTEX_BUNDLE_ID="${GHOSTEX_BUNDLE_ID:-com.madda.ghostex.host}"
	GHOSTEX_HOME_DIRECTORY_NAME="${GHOSTEX_HOME_DIRECTORY_NAME:-.ghostex}"
	GHOSTEX_SHARED_HOME_DIRECTORY_NAME="${GHOSTEX_SHARED_HOME_DIRECTORY_NAME:-.ghostex}"
	# CDXC:Distribution 2026-05-14-19:06: Ghostex is the public app name.
	# Release builds should publish and self-update from the Ghostex GitHub
	# repository while old ghostex repository URLs can continue to redirect.
	GHOSTEX_SPARKLE_FEED_URL="${GHOSTEX_SPARKLE_FEED_URL:-https://raw.githubusercontent.com/maddada/Ghostex/main/appcast.xml}"
	GHOSTEX_SPARKLE_PUBLIC_ED_KEY="${GHOSTEX_SPARKLE_PUBLIC_ED_KEY:-AGWDPeMqfhmbjt8Pbk+VTC9fDfXAYq+cZoLGCYuGn70=}"
fi

# CDXC:AutoUpdate 2026-05-02-06:51: Sparkle update checks need an appcast URL
# and EdDSA public key in Info.plist. The default public key is read from the
# user's Sparkle keychain account, and release automation can still override
# either value if the appcast host or signing account changes.
export GHOSTEX_SPARKLE_FEED_URL
export GHOSTEX_SPARKLE_PUBLIC_ED_KEY

if [[ -z "$GHOSTTY_ROOT" ]]; then
	# CDXC:NativeHost 2026-04-27-06:06: Local start/build commands should
	# discover the adjacent Ghostty checkout that already contains the required
	# xcframework so `bun start` launches the native host without per-shell setup.
	for candidate in \
		"$REPO_ROOT/../ghostty" \
		"$REPO_ROOT/../ghostty-ghostex-survival" \
		"$REPO_ROOT/../../_forks/ghostty" \
		"$HOME/dev/_active/ghostty"; do
		if [[ -d "$candidate/macos/GhosttyKit.xcframework" ]]; then
			GHOSTTY_ROOT="$(cd "$candidate" && pwd)"
			break
		fi
	done
fi

if [[ -z "$GHOSTTY_ROOT" ]]; then
	cat >&2 <<EOF
Set GHOSTTY_ROOT to your local Ghostty checkout before building ghostexHost.

Expected to find:
  \$GHOSTTY_ROOT/macos/GhosttyKit.xcframework
EOF
	exit 1
fi

GHOSTTY_KIT="$GHOSTTY_ROOT/macos/GhosttyKit.xcframework"
CEF_ROOT="${CEF_ROOT:-}"

if [[ ! -d "$GHOSTTY_KIT" ]]; then
	cat >&2 <<EOF
GhosttyKit.xcframework is missing:
  $GHOSTTY_KIT

Build it first:
  cd "$GHOSTTY_ROOT"
  env DEVELOPER_DIR=/Library/Developer/CommandLineTools \\
    SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk \\
    GHOSTTY_METAL_DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \\
    zig build -Demit-xcframework -Dxcframework-target=universal -Demit-macos-app=false
EOF
	exit 1
fi

if [[ -z "$CEF_ROOT" ]]; then
	# CDXC:ChromiumBrowserPanes 2026-05-04-16:38
	# Browser panes render through embedded Chromium, so the native host build
	# vendors CEF and its helper binary before Xcode resolves ObjC++ headers and
	# link paths. This is a build dependency, not a package-manager install.
	# CDXC:MacRelease 2026-05-14-18:37: Dual-architecture public releases must
	# vendor CEF for the requested target architecture so Intel builds are real
	# x86_64 apps and do not depend on the Apple Silicon host architecture.
	CEF_ROOT="$(GHOSTEX_MACOS_ARCH="$GHOSTEX_MACOS_ARCH" "$SCRIPT_DIR/vendor-cef.sh")"
else
	CEF_ROOT="$CEF_ROOT" GHOSTEX_MACOS_ARCH="$GHOSTEX_MACOS_ARCH" "$SCRIPT_DIR/vendor-cef.sh" >/dev/null
fi

if ! command -v xcodegen >/dev/null 2>&1; then
	cat >&2 <<EOF
xcodegen is required to generate the ghostex project.

Install it, then rerun this script:
  brew install xcodegen
EOF
	exit 1
fi

mkdir -p "$WEB_DIR"
cp "$REPO_ROOT/native/sidebar/index.html" "$WEB_DIR/index.html"
cp "$REPO_ROOT/native/sidebar/floating-monaco-editor.html" "$WEB_DIR/floating-monaco-editor.html"
rm -rf "$WEB_DIR/cli"
mkdir -p "$WEB_DIR/cli"
# CDXC:CliSessions 2026-05-10-03:28: Shells resolve the installed macOS
# executable as a terminal command. Bundle the Node CLI beside the web assets
# so main.swift can proxy command argv before the AppKit app starts.
# CDXC:CliBranding 2026-05-12-07:35: Public CLI commands are now `ghostex`
# and `gtx`; the bundled script filename follows that public CLI name while
# internal GHOSTEX_* environment names and storage paths remain implementation
# details.
cp "$REPO_ROOT/scripts/ghostex-cli.mjs" "$WEB_DIR/cli/ghostex-cli.mjs"
mkdir -p "$WEB_DIR/cli/node_modules"
cp -R "$REPO_ROOT/node_modules/ws" "$WEB_DIR/cli/node_modules/ws"
rm -rf "$WEB_DIR/monaco"
mkdir -p "$WEB_DIR/monaco"
cp -R "$REPO_ROOT/node_modules/monaco-editor/min/vs" "$WEB_DIR/monaco/vs"
rm -rf "$WEB_DIR/sounds"
mkdir -p "$WEB_DIR/sounds"
# CDXC:NativeSound 2026-04-29-16:30: Bundle completion sound assets beside
# the native Web resources so AVFoundation playback works from installed apps
# without relying on repository-relative media paths.
cp "$REPO_ROOT"/media/sounds/*.mp3 "$WEB_DIR/sounds/"
# CDXC:NativeSidebarBuild 2026-04-27-09:32
# The native sidebar is loaded by WKWebView as a classic script, while
# Storybook imports some sidebar components as ES modules. Force the packaged
# native bundle to IIFE so exported Storybook symbols never leave top-level
# `export` syntax in /Applications/Ghostex.app and blank the app at startup.
bun build "$REPO_ROOT/native/sidebar/native-sidebar.tsx" \
	--target browser \
	--format iife \
	--asset-naming "[name].[ext]" \
	--outdir "$WEB_DIR"
bun build "$REPO_ROOT/native/sidebar/modal-host.tsx" \
	--target browser \
	--format iife \
	--asset-naming "[name].[ext]" \
	--outdir "$WEB_DIR"
# CDXC:ReactTitlebar 2026-05-09-17:11: The macOS titlebar chrome is now a
# React WKWebView bundle so future titlebar buttons and workspace dropdowns
# share the same web UI/runtime rather than AppKit button implementations.
bun build "$REPO_ROOT/native/sidebar/titlebar-host.tsx" \
	--target browser \
	--format iife \
	--asset-naming "[name].[ext]" \
	--outdir "$WEB_DIR"
bun build "$REPO_ROOT/native/sidebar/pet-host.tsx" \
	--target browser \
	--format iife \
	--asset-naming "[name].[ext]" \
	--outdir "$WEB_DIR"

WEB_DIR="$WEB_DIR" node <<'JS'
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const webDir = process.env.WEB_DIR;
const css = readFileSync(join(webDir, "native-sidebar.css"), "utf8");
const js = readFileSync(join(webDir, "native-sidebar.js"), "utf8");
const modalJs = readFileSync(join(webDir, "modal-host.js"), "utf8");
// CDXC:ReactTitlebar 2026-05-11-00:22: The titlebar now imports shadcn/sidebar
// CSS for its grouped Open In controls, so inline its generated stylesheet in
// the isolated titlebar WKWebView instead of relying on the sidebar HTML.
const titlebarCssPath = join(webDir, "titlebar-host.css");
const titlebarCss = existsSync(titlebarCssPath) ? readFileSync(titlebarCssPath, "utf8") : "";
const titlebarJs = readFileSync(join(webDir, "titlebar-host.js"), "utf8");
const petCssPath = join(webDir, "pet-host.css");
const petCss = existsSync(petCssPath) ? readFileSync(petCssPath, "utf8") : "";
const petJs = readFileSync(join(webDir, "pet-host.js"), "utf8");
// Inline script bodies must escape HTML script end tags that appear inside bundle strings.
const escapedJs = js.replace(/<\/script/gi, "<\\/script");
const escapedModalJs = modalJs.replace(/<\/script/gi, "<\\/script");
const escapedTitlebarJs = titlebarJs.replace(/<\/script/gi, "<\\/script");
const escapedPetJs = petJs.replace(/<\/script/gi, "<\\/script");
writeFileSync(join(webDir, "index.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=native-sidebar.js
    </script>
  </body>
</html>
`);
writeFileSync(join(webDir, "modal-host.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedModalJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=modal-host.js
    </script>
  </body>
</html>
`);
writeFileSync(join(webDir, "titlebar-host.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${titlebarCss}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedTitlebarJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=titlebar-host.js
    </script>
  </body>
</html>
`);
writeFileSync(join(webDir, "pet-host.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <style>
${petCss}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
(() => {
try {
${escapedPetJs}
} catch (error) {
  window.__ghostex_BOOT_ERROR__ = {
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : ""
  };
  throw error;
}
})();
//# sourceURL=pet-host.js
    </script>
  </body>
</html>
`);
JS

# CDXC:PublicRelease 2026-04-27-05:36: Public builds must not encode a
# maintainer-specific Ghostty checkout path; project.yml reads GHOSTTY_ROOT
# from the caller's environment when XcodeGen resolves native host paths.
export GHOSTTY_ROOT
export GHOSTEX_APP_NAME
export GHOSTEX_APP_DISPLAY_NAME
export GHOSTEX_BUNDLE_ID
export GHOSTEX_HOME_DIRECTORY_NAME
export GHOSTEX_SHARED_HOME_DIRECTORY_NAME
export GHOSTEX_MACOS_ARCH
export CEF_ROOT
mkdir -p "$SCRIPT_DIR/build"
xcodegen generate --spec "$SCRIPT_DIR/project.yml"

STALE_APP_PATH="$DERIVED_DATA/Build/Products/$CONFIGURATION/$GHOSTEX_APP_NAME.app"
if [[ -d "$STALE_APP_PATH/Contents/Frameworks" ]]; then
	# CDXC:ChromiumBrowserPanes 2026-05-04-17:00
	# CEF is copied after Xcode validation because the Spotify minimal framework
	# layout does not satisfy Xcode's generic framework validator. Incremental
	# builds must remove only the generated CEF payload before xcodebuild, then
	# copy and sign the runtime again after the app bundle is produced.
	rm -rf \
		"$STALE_APP_PATH/Contents/Frameworks/Chromium Embedded Framework.framework" \
		"$STALE_APP_PATH"/Contents/Frameworks/ghostex\ Helper*.app
fi

xcodebuild \
	-project "$PROJECT_PATH" \
	-scheme ghostex \
	-configuration "$CONFIGURATION" \
	-derivedDataPath "$DERIVED_DATA" \
	ARCHS="$GHOSTEX_MACOS_ARCH" \
	ONLY_ACTIVE_ARCH=NO \
	build

APP_PATH="$(
	xcodebuild \
		-project "$PROJECT_PATH" \
		-scheme ghostex \
		-configuration "$CONFIGURATION" \
		-derivedDataPath "$DERIVED_DATA" \
		ARCHS="$GHOSTEX_MACOS_ARCH" \
		ONLY_ACTIVE_ARCH=NO \
		-showBuildSettings 2>/dev/null |
		awk -F' = ' '/BUILT_PRODUCTS_DIR/ { print $2; exit }'
)/$GHOSTEX_APP_NAME.app"

copy_cef_runtime() {
	local app_path="$1"
	local frameworks_dir="$app_path/Contents/Frameworks"
	local helper_source="$SCRIPT_DIR/build/cef-$GHOSTEX_MACOS_ARCH/ghostex-cef-helper"
	local helper_version="${MARKETING_VERSION:-1}"
	mkdir -p "$frameworks_dir"
	rsync -a --delete "$CEF_ROOT/Release/Chromium Embedded Framework.framework" "$frameworks_dir/"
	local helper_names=(
		"ghostex Helper"
		"ghostex Helper (Alerts)"
		"ghostex Helper (GPU)"
		"ghostex Helper (Plugin)"
		"ghostex Helper (Renderer)"
	)
	local helper_name
	for helper_name in "${helper_names[@]}"; do
		local helper_app="$frameworks_dir/$helper_name.app"
		local helper_macos="$helper_app/Contents/MacOS"
		mkdir -p "$helper_macos"
		cp "$helper_source" "$helper_macos/$helper_name"
		chmod +x "$helper_macos/$helper_name"
		cat >"$helper_app/Contents/Info.plist" <<EOF_HELPER
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>$helper_name</string>
	<key>CFBundleIdentifier</key>
	<string>$GHOSTEX_BUNDLE_ID.$(printf '%s' "$helper_name" | tr ' ()' '---')</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$helper_name</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
		<key>CFBundleShortVersionString</key>
	<string>$helper_version</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSBackgroundOnly</key>
	<true/>
</dict>
</plist>
EOF_HELPER
	done
}

copy_cef_runtime "$APP_PATH"

"$SCRIPT_DIR/codesign-ghostex-host.sh" "$APP_PATH"

APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist")"
printf '%s\n' "$APP_PATH" >"/tmp/ghostex-$APP_VERSION-$GHOSTEX_MACOS_ARCH-app-path"

cat <<EOF

Built $GHOSTEX_APP_NAME.

Launch it from Xcode or with:
  open "$APP_PATH"
EOF
