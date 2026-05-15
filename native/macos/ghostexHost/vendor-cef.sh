#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CEF_VERSION="${GHOSTEX_CEF_VERSION:-147.0.10+gd58e84d}"
CHROMIUM_VERSION="${GHOSTEX_CHROMIUM_VERSION:-147.0.7727.118}"
CMAKE_BIN="${CMAKE_BIN:-cmake}"
GHOSTEX_MACOS_ARCH="${GHOSTEX_MACOS_ARCH:-$(uname -m)}"
case "$GHOSTEX_MACOS_ARCH" in
	arm64 | aarch64)
		CEF_ARCH="macosarm64"
		CMAKE_ARCH="arm64"
		CLANG_ARCH="arm64"
		;;
	x86_64 | x64 | amd64)
		CEF_ARCH="macosx64"
		CMAKE_ARCH="x86_64"
		CLANG_ARCH="x86_64"
		;;
	*)
		echo "Unsupported GHOSTEX_MACOS_ARCH: $GHOSTEX_MACOS_ARCH" >&2
		exit 1
		;;
esac
EXPECTED_VERSION="${CEF_VERSION}+chromium-${CHROMIUM_VERSION}+${CMAKE_ARCH}"
CEF_ROOT="${CEF_ROOT:-$SCRIPT_DIR/Vendor/cef-$CMAKE_ARCH}"

ensure_cmake() {
	if command -v "$CMAKE_BIN" >/dev/null 2>&1; then
		return
	fi
	local vendored="$SCRIPT_DIR/Vendor/cmake/CMake.app/Contents/bin/cmake"
	if [[ -x "$vendored" ]]; then
		CMAKE_BIN="$vendored"
		return
	fi
	local version="3.30.2"
	local temp="$SCRIPT_DIR/Vendor/cmake-temp.tar.gz"
	mkdir -p "$SCRIPT_DIR/Vendor"
	curl -L "https://github.com/Kitware/CMake/releases/download/v${version}/cmake-${version}-macos-universal.tar.gz" -o "$temp"
	rm -rf "$SCRIPT_DIR/Vendor/cmake" "$SCRIPT_DIR/Vendor/cmake-${version}-macos-universal"
	tar -xzf "$temp" -C "$SCRIPT_DIR/Vendor"
	mv "$SCRIPT_DIR/Vendor/cmake-${version}-macos-universal" "$SCRIPT_DIR/Vendor/cmake"
	rm -f "$temp"
	CMAKE_BIN="$vendored"
}

download_cef() {
	if [[ -d "$CEF_ROOT" && -f "$CEF_ROOT/.cef-version" && "$(cat "$CEF_ROOT/.cef-version")" == "$EXPECTED_VERSION" ]]; then
		return
	fi
	rm -rf "$CEF_ROOT"
	mkdir -p "$(dirname "$CEF_ROOT")" "$CEF_ROOT"
	local temp="$(dirname "$CEF_ROOT")/cef-temp.tar.bz2"
	local url="https://cef-builds.spotifycdn.com/cef_binary_${CEF_VERSION}+chromium-${CHROMIUM_VERSION}_${CEF_ARCH}_minimal.tar.bz2"
	curl -L "$url" -o "$temp"
	local size
	size="$(stat -f%z "$temp")"
	if [[ "$size" -lt 50000000 ]]; then
		rm -f "$temp"
		echo "CEF download was unexpectedly small: $size bytes" >&2
		exit 1
	fi
	tar -xjf "$temp" --strip-components=1 -C "$CEF_ROOT"
	rm -f "$temp"
	echo "$EXPECTED_VERSION" > "$CEF_ROOT/.cef-version"
}

build_cef_wrapper_and_helper() {
	ensure_cmake
	if [[ ! -f "$CEF_ROOT/build/libcef_dll_wrapper/libcef_dll_wrapper.a" ]]; then
		rm -rf "$CEF_ROOT/build"
		mkdir -p "$CEF_ROOT/build"
		(
			cd "$CEF_ROOT/build"
			# CDXC:ChromiumBrowserPanes 2026-05-04-16:57: The host build captures
			# this script's stdout as CEF_ROOT. Keep CMake/make diagnostics on
			# stderr so Xcode header/search paths receive only the final CEF path.
			"$CMAKE_BIN" -DPROJECT_ARCH="$CMAKE_ARCH" -DCMAKE_BUILD_TYPE=Release .. >&2
			make -j8 libcef_dll_wrapper >&2
		)
	fi
	lipo -archs "$CEF_ROOT/Release/Chromium Embedded Framework.framework/Chromium Embedded Framework" | grep -Fx "$CMAKE_ARCH" >&2

	local helper_build="$SCRIPT_DIR/build/cef-$CMAKE_ARCH"
	local helper="$helper_build/ghostex-cef-helper"
	if [[ -x "$helper" ]]; then
		if lipo -archs "$helper" | grep -Fx "$CMAKE_ARCH" >&2; then
			return
		fi
		rm -f "$helper" "$helper_build/GhostexCEFProcessHelper.o"
	fi
	mkdir -p "$helper_build"
	# CDXC:MacRelease 2026-05-14-18:37: Public releases now ship separate
	# Apple Silicon and Intel DMGs. CEF vendoring must use the requested target
	# architecture, not the builder machine architecture, so release automation
	# can produce both app bundles from the same checkout.
	xcrun --sdk macosx clang++ \
		-arch "$CLANG_ARCH" \
		-mmacosx-version-min=13.0 \
		-std=c++20 \
		-ObjC++ \
		-fobjc-arc \
		-I"$CEF_ROOT" \
		-c "$SCRIPT_DIR/CEF/GhostexCEFProcessHelper.cc" \
		-o "$helper_build/GhostexCEFProcessHelper.o"
	xcrun --sdk macosx clang++ \
		-arch "$CLANG_ARCH" \
		-mmacosx-version-min=13.0 \
		-std=c++20 \
		"$helper_build/GhostexCEFProcessHelper.o" \
		-o "$helper" \
		-framework Cocoa \
		-F"$CEF_ROOT/Release" \
		-framework "Chromium Embedded Framework" \
		-L"$CEF_ROOT/build/libcef_dll_wrapper" \
		-lcef_dll_wrapper \
		-stdlib=libc++
	install_name_tool \
		-change "@executable_path/../Frameworks/Chromium Embedded Framework.framework/Chromium Embedded Framework" \
		"@executable_path/../../../../Frameworks/Chromium Embedded Framework.framework/Chromium Embedded Framework" \
		"$helper"
	lipo -archs "$helper" | grep -Fx "$CMAKE_ARCH" >&2
}

download_cef
build_cef_wrapper_and_helper
printf '%s\n' "$CEF_ROOT"
