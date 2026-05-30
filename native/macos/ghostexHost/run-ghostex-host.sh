#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="$SCRIPT_DIR/ghostex.xcodeproj"
CONFIGURATION="${CONFIGURATION:-Debug}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
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
GHOSTEX_APP_VARIANT="${GHOSTEX_APP_VARIANT:-prod}"
if [[ "$GHOSTEX_APP_VARIANT" == "dev" ]]; then
	# CDXC:DevAppFlavor 2026-04-28-02:01: Local development needs a separate
	# ghostex-dev app identity so iterative builds can run beside the release app;
	# CDXC:DevAppFlavor 2026-05-11-12:10: dev launches must keep settings,
	# projects, sessions, hooks, browser profiles, and runtime state isolated
	# from the installed app through the ghostex-dev bundle and ~/.ghostex-dev home.
	# CDXC:Branding 2026-05-12-07:35: Public dev builds use the Ghostex name
	# while keeping the internal dev bundle id and ~/.ghostex-dev storage split.
	APP_NAME="Ghostex-dev"
	BUNDLE_ID="com.madda.ghostex-dev.host"
else
	APP_NAME="Ghostex"
	BUNDLE_ID="com.madda.ghostex.host"
fi
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
INSTALLED_APP="$INSTALL_DIR/$APP_NAME.app"
# CDXC:LocalStart 2026-05-15-07:53: `bun run start` must launch the architecture-specific app product that `build-ghostex-host.sh` just produced. Keep the DerivedData default aligned with the build script so arm64 local starts do not copy an older app from build/, while Intel release/dev validation can still set GHOSTEX_MACOS_ARCH=x86_64 and resolve build/x86_64.
DERIVED_DATA="${DERIVED_DATA:-$REPO_ROOT/build/$GHOSTEX_MACOS_ARCH}"
# CDXC:NativeBuild 2026-05-23-13:29: Keep the post-build settings lookup on the same explicit macOS destination as the native build so `bun run start` does not emit destination ambiguity warnings on dual-architecture Macs.
XCODE_DESTINATION="platform=macOS,arch=$GHOSTEX_MACOS_ARCH"

"$SCRIPT_DIR/build-ghostex-host.sh"

APP_PATH="$(
	xcodebuild \
		-project "$PROJECT_PATH" \
		-scheme ghostex \
		-configuration "$CONFIGURATION" \
		-destination "$XCODE_DESTINATION" \
		-derivedDataPath "$DERIVED_DATA" \
		ARCHS="$GHOSTEX_MACOS_ARCH" \
		ONLY_ACTIVE_ARCH=NO \
		-showBuildSettings 2>/dev/null |
	awk -F' = ' '/BUILT_PRODUCTS_DIR/ { print $2; exit }'
)/$APP_NAME.app"

APP_EXECUTABLE="$INSTALLED_APP/Contents/MacOS/$APP_NAME"

find_running_app_pids() {
	pgrep -f "^$APP_EXECUTABLE$" 2>/dev/null || true
}

wait_for_app_exit() {
	local deadline
	deadline=$((SECONDS + 8))
	while [[ $SECONDS -lt $deadline ]]; do
		if [[ -z "$(find_running_app_pids)" ]]; then
			return 0
		fi
		sleep 0.1
	done
	return 1
}

osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
if ! wait_for_app_exit; then
	# CDXC:LocalStart 2026-05-30-17:03: `bun run start` must launch the freshly built app, not activate an old in-memory process. Match only the installed app executable so replacing the UI app never signals zmx attach processes or the gxserver control plane.
	running_app_pids="$(find_running_app_pids)"
	if [[ -n "$running_app_pids" ]]; then
		kill -TERM $running_app_pids
	fi
fi
if ! wait_for_app_exit; then
	echo "$APP_NAME did not exit, refusing to replace $INSTALLED_APP while it is still running." >&2
	exit 1
fi

# CDXC:MacOSPermissions 2026-05-27-07:24: Install dev builds to a stable
# /Applications app path before launching so macOS Accessibility permission
# stays attached to the same signed app identity across rebuilds.
rm -rf "$INSTALLED_APP"
cp -R "$APP_PATH" "$INSTALL_DIR/"
"$SCRIPT_DIR/codesign-ghostex-host.sh" "$INSTALLED_APP"
open "$INSTALLED_APP"
