#!/usr/bin/env bash
set -euo pipefail

#
# CDXC:iOSDirectInstall 2026-05-22-06:21:
# Build a production-style Release app locally, install it to Mohamad's paired iPhone over CoreDevice/Wi-Fi, and launch it without waiting for TestFlight processing.
# Keep the device identifiers configurable because Xcode uses the USB UDID for build destinations while devicectl can use the CoreDevice network identifier for wireless install and launch.
#

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${ROOT_DIR}/iOS/a-Shell.xcodeproj"
SCHEME="${GHOSTEX_IOS_SCHEME:-a-Shell-mini}"
CONFIGURATION="${GHOSTEX_IOS_CONFIGURATION:-Release}"
BUNDLE_ID="${GHOSTEX_IOS_BUNDLE_ID:-com.maddada.ghostex.ios}"
BUILD_DEVICE_ID="${GHOSTEX_IOS_BUILD_DEVICE_ID:-00008030-000258C91EEA802E}"
INSTALL_DEVICE_ID="${GHOSTEX_IOS_INSTALL_DEVICE_ID:-A9F1B590-5609-5F6B-9F92-722715CBF6B4}"
DERIVED_DATA_PATH="${GHOSTEX_IOS_DERIVED_DATA_PATH:-/tmp/ghostex-ios-device-release-dd}"
APP_PATH="${DERIVED_DATA_PATH}/Build/Products/${CONFIGURATION}-iphoneos/a-Shell-mini.app"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<EOF
Usage:
  scripts/ghostex-ios-prod-install-iphone.sh

Environment overrides:
  GHOSTEX_IOS_BUILD_DEVICE_ID     Xcode destination UDID. Default: ${BUILD_DEVICE_ID}
  GHOSTEX_IOS_INSTALL_DEVICE_ID   devicectl/CoreDevice ID. Default: ${INSTALL_DEVICE_ID}
  GHOSTEX_IOS_DERIVED_DATA_PATH   Build folder. Default: ${DERIVED_DATA_PATH}
  GHOSTEX_IOS_CONFIGURATION       Xcode configuration. Default: ${CONFIGURATION}
  GHOSTEX_IOS_SCHEME              Xcode scheme. Default: ${SCHEME}
  GHOSTEX_IOS_BUNDLE_ID           App bundle ID. Default: ${BUNDLE_ID}
EOF
  exit 0
fi

echo "Checking paired iOS devices..."
xcrun devicectl list devices

echo
echo "Building ${SCHEME} (${CONFIGURATION}) for iPhone destination ${BUILD_DEVICE_ID}..."
xcodebuild \
  -project "${PROJECT_PATH}" \
  -scheme "${SCHEME}" \
  -configuration "${CONFIGURATION}" \
  -destination "platform=iOS,id=${BUILD_DEVICE_ID}" \
  -derivedDataPath "${DERIVED_DATA_PATH}" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build

if [[ ! -d "${APP_PATH}" ]]; then
  echo "Expected app was not produced: ${APP_PATH}" >&2
  exit 1
fi

echo
echo "Installing ${APP_PATH} to iPhone device ${INSTALL_DEVICE_ID}..."
xcrun devicectl device install app \
  --device "${INSTALL_DEVICE_ID}" \
  "${APP_PATH}"

echo
echo "Launching ${BUNDLE_ID} on iPhone..."
xcrun devicectl device process launch \
  --device "${INSTALL_DEVICE_ID}" \
  "${BUNDLE_ID}"

echo
echo "Done."
