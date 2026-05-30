Verdict: Not deploy-ready yet. The second-round fixes close several earlier server hardening gaps, but there are still deploy-impacting integration risks around stale daemon reuse, unbounded zmx history reads, and a few boundedness/configuration mismatches.

## Critical

None.

## High

### Confirmed: macOS can keep using an old gxserver after an app update

- Severity: High
- Concrete risk: A deployed app update can continue talking to a previously launched gxserver daemon, so server-side fixes from the new build are not guaranteed to take effect until the user manually stops the daemon or the old daemon fails a toolchain check.
- File/line references:
  - `native/macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift:42` to `native/macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift:48` returns early when authenticated health succeeds and only stops an old daemon for `toolchainUnavailable`.
  - `native/macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift:114` to `native/macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift:152` validates product, protocol, and bundled tool availability, but not the gxserver build/package identity.
  - `native/macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift:158` to `native/macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift:171` treats zmx/zehn availability as the restart gate.
  - `gxserver/protocol/index.ts:6` to `gxserver/protocol/index.ts:14` keeps protocol version `1`, so this commit's server behavior changes do not force a protocol mismatch restart.
- Reproduction or failure scenario: Install a build that launches gxserver, leave the daemon running, then install a newer app build containing the post-`ed727b402` gxserver fixes while protocol remains `1`. On launch, `startOrReuse()` accepts the old daemon if `/api/health/server` authenticates and reports required tools, so CORS/PNA, lifecycle, or boundedness fixes from the new packaged server may not be running.
- Recommended fix: Add a gxserver build/package fingerprint to server health/runtime metadata and have the macOS host compare it to the bundled expected value before reuse. Restart the daemon on mismatch. Alternatively, bump protocol for every server/client contract or security behavior change, but a build fingerprint is less disruptive and catches same-protocol patch updates.

### Confirmed: `/api/readSessionText` can buffer unbounded zmx history output

- Severity: High
- Concrete risk: An authenticated local or remote client can make gxserver buffer and serialize a very large session history, causing high memory use, slow responses, or process termination.
- File/line references:
  - `gxserver/src/api.ts:29` marks `readSessionText` as remote-allowed.
  - `gxserver/src/server.ts:831` to `gxserver/src/server.ts:842` returns the full `result.stdout` from the zmx history command.
  - `gxserver/src/zmx-lifecycle.ts:102` to `gxserver/src/zmx-lifecycle.ts:115` builds `zmx history --format json`.
  - `gxserver/src/zmx-lifecycle.ts:387` to `gxserver/src/zmx-lifecycle.ts:423` accumulates all stdout and stderr chunks in arrays without a byte limit before resolving.
- Reproduction or failure scenario: Create a long-running zmx session that has produced a very large scrollback, then call `/api/readSessionText` for that session. The server buffers the full history output in memory and then includes it in a JSON response. This bypasses the newer bounded-output handling used by typed operations.
- Recommended fix: Put zmx history behind explicit byte/line limits with truncation metadata, pagination, or streaming. Reuse the typed-operation output-limit pattern or enforce a stricter history-specific cap before accumulating stdout.

## Medium

### Confirmed: Beads board reads bypass typed-operation output and memory limits

- Severity: Medium
- Concrete risk: An authenticated client can make gxserver read and parse an arbitrarily large `.beads/issues.jsonl` file from a registered project, consuming memory and returning an oversized response.
- File/line references:
  - `gxserver/src/api.ts:45` marks `runBeadsAction` as remote-allowed.
  - `gxserver/src/typed-operations.ts:153` to `gxserver/src/typed-operations.ts:168` special-cases the `board` action and bypasses the bounded subprocess path.
  - `gxserver/src/typed-operations.ts:338` to `gxserver/src/typed-operations.ts:356` reads the entire `.beads/issues.jsonl` file and accumulates every parsed issue object without a file-size, row-count, or response-size cap.
- Reproduction or failure scenario: Register a project whose `.beads/issues.jsonl` is very large, then call `/api/runBeadsAction` with `{ "action": "board" }`. Unlike other typed commands, this path does not apply the 4 MiB stdout/stderr cap and can load the whole file into memory.
- Recommended fix: Bound the board reader by file size and issue count, return truncation metadata, or route the board operation through a bounded command path. Treat oversized bead state as a typed-operation error instead of loading it fully.

### Confirmed: local listener config can break the fixed-port integration contract

- Severity: Medium
- Concrete risk: A config file can move the local server off the fixed local API port while runtime metadata, status checks, CLI code, and the macOS/sidebar clients still assume `127.0.0.1:58744`, making the daemon appear unreachable or inconsistent.
- File/line references:
  - `gxserver/src/storage.ts:291` to `gxserver/src/storage.ts:313` merges `config.listeners.local` over defaults and only forces `kind` and `enabled`, leaving configured `host` and `port` intact.
  - `gxserver/src/server.ts:148` to `gxserver/src/server.ts:155` writes runtime metadata with the fixed `GXSERVER_LOCAL_API_PORT`.
  - `gxserver/src/server.ts:197` to `gxserver/src/server.ts:199` actually listens using the merged local listener host/port.
  - `gxserver/src/http-client.ts:12` hard-codes the local client base URL to `127.0.0.1:58744`.
  - `native/macos/ghostexHost/Sources/ghostexHost/GxserverClient.swift:30` hard-codes the macOS host base URL to `127.0.0.1:58744`.
  - `docs/gxserver-architecture.md:37` to `docs/gxserver-architecture.md:38` documents the local API as a fixed loopback port.
- Reproduction or failure scenario: Put `listeners.local.port` or `listeners.local.host` in `~/.ghostex/gxserver/config.json` and start gxserver. The server binds to the configured address, but health/status/runtime consumers still look at the fixed port, so startup, reuse, stop, and sidebar bootstrap behavior diverge.
- Recommended fix: Make the local listener host/port immutable during config merge, or fail startup with a clear validation error if those fields are configured. If configurability is desired, every consumer and runtime metadata path must become config-aware.

### Confirmed: zmx send payloads can exceed shell argument limits

- Severity: Medium
- Concrete risk: A request body that is valid under gxserver's 1 MiB HTTP cap can still fail at process spawn time because the text is embedded into the `/bin/zsh -lc` command argument.
- File/line references:
  - `gxserver/src/server.ts:121` to `gxserver/src/server.ts:125` sets the JSON body cap at 1 MiB.
  - `gxserver/src/server.ts:844` to `gxserver/src/server.ts:857` sends arbitrary non-empty `text` through `buildZmxSendCommand()`.
  - `gxserver/src/server.ts:873` to `gxserver/src/server.ts:889` does the same for `sendSessionMessage`.
  - `gxserver/src/server.ts:909` to `gxserver/src/server.ts:914` only validates that interaction text is a non-empty string.
  - `gxserver/src/zmx-lifecycle.ts:118` to `gxserver/src/zmx-lifecycle.ts:133` shell-quotes the full payload into the script.
  - `gxserver/src/zmx-lifecycle.ts:387` to `gxserver/src/zmx-lifecycle.ts:390` runs that script through `/bin/zsh -lc`.
- Reproduction or failure scenario: Call `/api/sendSessionText` with a large text value that is below the 1 MiB body limit but above the OS argument-size limit for `spawn("/bin/zsh", ["-lc", script])`. The request can fail with a process-spawn error rather than a deliberate client-facing size error.
- Recommended fix: Pass zmx send payloads via stdin, a temporary file, or a direct child process interface that does not put the whole message in argv. Add an explicit text-size limit and return `413` or a typed `400` error for oversized interaction payloads.

## Low

None.

## Tests Run Or Skipped

- Ran: Static review only. I inspected the gxserver server/client integration, auth/CORS/PNA paths, remote SSH/tunnel CLI bridge, zmx lifecycle/session interaction, typed operations, logs, SQLite domain-state, packaging/runtime assumptions, and macOS/sidebar launch integration.
- Skipped: Automated tests and builds. The task allowed only one write, `SECOND_ROUND_SERVER_REVIEW.md`; the available gxserver tests and packaging checks create build, database, temp, or package artifacts, so I did not run them during this review.
