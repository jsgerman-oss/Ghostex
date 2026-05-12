#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="$SCRIPT_DIR/zmux.xcodeproj"
CONFIGURATION="${CONFIGURATION:-Debug}"
ZMUX_APP_VARIANT="${ZMUX_APP_VARIANT:-prod}"
if [[ "$ZMUX_APP_VARIANT" == "dev" ]]; then
	# CDXC:DevAppFlavor 2026-04-28-02:01: Local development needs a separate
	# ghostex-dev app identity so iterative builds can run beside the release app;
	# CDXC:DevAppFlavor 2026-05-11-12:10: dev launches must keep settings,
	# projects, sessions, hooks, browser profiles, and runtime state isolated
	# from the installed app through the ghostex-dev bundle and ~/.zmux-dev home.
	# CDXC:Branding 2026-05-12-07:35: Public dev builds use the Ghostex name
	# while keeping the internal dev bundle id and ~/.zmux-dev storage split.
	APP_NAME="Ghostex-dev"
	BUNDLE_ID="com.madda.zmux-dev.host"
else
	APP_NAME="Ghostex"
	BUNDLE_ID="com.madda.zmux.host"
fi
INSTALL_DIR="${INSTALL_DIR:-/Applications}"
INSTALLED_APP="$INSTALL_DIR/$APP_NAME.app"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DERIVED_DATA="${DERIVED_DATA:-$REPO_ROOT/build}"

"$SCRIPT_DIR/build-zmux-host.sh"

APP_PATH="$(
	xcodebuild \
		-project "$PROJECT_PATH" \
		-scheme zmux \
		-configuration "$CONFIGURATION" \
		-derivedDataPath "$DERIVED_DATA" \
		-showBuildSettings 2>/dev/null |
	awk -F' = ' '/BUILT_PRODUCTS_DIR/ { print $2; exit }'
)/$APP_NAME.app"

osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
pkill -x "$APP_NAME" 2>/dev/null || true
sleep 0.3

# CDXC:ZedOverlay 2026-04-26-04:16: Install dev builds to a stable
# /Applications app path before launching so macOS Accessibility permission
# stays attached to the same signed app identity across rebuilds.
rm -rf "$INSTALLED_APP"
cp -R "$APP_PATH" "$INSTALL_DIR/"
"$SCRIPT_DIR/codesign-zmux-host.sh" "$INSTALLED_APP"
open "$INSTALLED_APP"
