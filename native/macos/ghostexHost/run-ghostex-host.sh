#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# CDXC:LocalStartGxserver 2026-05-31-15:52: The shell launcher is kept as a compatibility entry point only. Route it through scripts/start-ghostex.mjs so direct local starts use the same app-close-before-gxserver-restart policy as `bun run start`.
# CDXC:LocalStartSingleApp 2026-06-09-09:27: Ghostex-dev local starts were removed because agents were running the separate app by mistake. Reject dev args and GHOSTEX_APP_VARIANT=dev here too so this compatibility launcher cannot recreate the old path.
if [[ "${GHOSTEX_APP_VARIANT:-prod}" == "dev" ]]; then
	echo "Ghostex-dev local starts were removed. Use: bun run start" >&2
	exit 1
fi

ARGS=()
for arg in "$@"; do
	case "$arg" in
		dev | --dev)
			echo "Ghostex-dev local starts were removed. Use: bun run start" >&2
			exit 1
			;;
		prod | --prod)
			;;
		*)
			ARGS+=("$arg")
			;;
	esac
done

exec bun "$REPO_ROOT/scripts/start-ghostex.mjs" "${ARGS[@]}"
