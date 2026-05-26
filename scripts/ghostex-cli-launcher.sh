#!/usr/bin/env bash
set -euo pipefail

# CDXC:CliBranding 2026-05-26-15:11: The installed app bundle exposes `ghostex` plus the shorter `gx` command. Keep both as thin launchers over the same bundled Node implementation so command behavior cannot drift by alias name.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec /usr/bin/env node "$SCRIPT_DIR/ghostex-cli.mjs" "$@"
