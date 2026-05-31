#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# CDXC:LocalStartGxserver 2026-05-31-15:52: The shell launcher is kept as a compatibility entry point only. Route it through scripts/start-ghostex.mjs so direct local starts use the same app-close-before-gxserver-restart policy as `bun run start` and `bun run start dev`.
ARGS=("$@")
if [[ "${GHOSTEX_APP_VARIANT:-prod}" == "dev" ]]; then
	has_variant_arg=false
	for arg in "${ARGS[@]}"; do
		if [[ "$arg" == "dev" || "$arg" == "--dev" || "$arg" == "prod" || "$arg" == "--prod" ]]; then
			has_variant_arg=true
			break
		fi
	done
	if [[ "$has_variant_arg" == false ]]; then
		ARGS=("dev" "${ARGS[@]}")
	fi
fi

exec bun "$REPO_ROOT/scripts/start-ghostex.mjs" "${ARGS[@]}"
