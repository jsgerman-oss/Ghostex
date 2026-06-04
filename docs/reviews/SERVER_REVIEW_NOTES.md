# gxserver Server Review Notes

Review date: 2026-05-30

Scope reviewed: `gxserver/src`, `gxserver/protocol`, `gxserver/scripts`, `gxserver/test`, `native/sidebar/gxserver-client.ts`, `scripts/ghostex-cli.mjs`, and relevant macOS gxserver launch/bootstrap integration.

## Summary

- Critical: 0
- High: 5
- Medium: 5
- Low: 2

## Findings

### 1. High: zmx probe can classify zmx/list failures as a missing session

`gxserver/src/zmx-lifecycle.ts:100-108` builds the probe as `"$zmx_bin" list --short 2>/dev/null | grep ...` and `gxserver/src/zmx-lifecycle.ts:124-126` maps exit code `1` to `missing`. Because the shell pipeline status is the status of `grep`, a `zmx list` runtime failure with no output is indistinguishable from "session not found". `gxserver/src/server.ts:738-790` then uses that state to decide whether to create/attach a missing provider and queue startup text.

Impact: a transient zmx/list failure during app restart can make gxserver think live terminals are missing, potentially replaying agent startup/resume text into a newly created session or reporting restore state incorrectly. This is directly in the "restart behavior preserving zmx terminals" path.

Evidence to confirm: run the probe with a fake `zmx` whose `list --short` exits nonzero without output. The current probe result should come back `missing` rather than `unknown`.

### 2. High: failed zmx kill still marks sessions stopped/sleeping and provider missing

`gxserver/src/server.ts:832-843` updates the session lifecycle and provider state to `sleeping`/`stopped` plus `missingProviderStatePatch(...)` regardless of whether `killZmxSession(...)` succeeded. `gxserver/src/zmx-lifecycle.ts:146-153` exposes `killed: result.exitCode === 0`, but the caller only uses it for log level at `gxserver/src/server.ts:844-856`.

Impact: if `zmx kill` fails, gxserver persists state saying the provider is gone while the terminal may still be running. Users can lose a reliable route back to a live session, and subsequent wake/attach decisions are based on false state.

Evidence to confirm: make `killZmxSession` return `exitCode: 2, killed: false`, call `/api/sleepSession`, then inspect the session row. It should currently be persisted as `sleeping` with provider lifecycle `missing`.

### 3. High: CLI-consumed session interaction endpoints are advertised but not implemented

The protocol/API catalog exposes `/api/focusSession`, `/api/readSessionText`, `/api/sendSessionText`, `/api/sendSessionMessage`, and `/api/sendSessionEnter` as authenticated remote-allowed endpoints in `gxserver/src/api.ts:29-33`. `scripts/ghostex-cli.mjs:1435-1444` routes user-facing commands to those paths. The server only dispatches domain-state, typed operations, and zmx lifecycle endpoints (`gxserver/src/server.ts:874-903`); anything else falls through to `notImplemented` at `gxserver/src/server.ts:481-485`.

Impact: shipping this cutover breaks `gx focus`, `gx read-text`, `gx send-text`, `gx send-enter`, `gx send-message`, and any agent skills relying on those CLI actions. The endpoint catalog makes them look supported and remote-safe, but production calls return 501.

Evidence to confirm: POST any of those paths with a valid token/protocol. The server should return `notImplemented`.

### 4. High: typed subprocess APIs have no timeout or output cap

`/api/runGitAction`, `/api/runWorktreeAction`, and `/api/runBeadsAction` are remote-allowed in `gxserver/src/api.ts:43-45`. `gxserver/src/typed-operations.ts:158-180` spawns the selected command and buffers all stdout/stderr until process exit, with no timeout, byte limit, or cancellation on client disconnect.

Impact: an authenticated local or remote/Tailscale client can hang a request indefinitely or force unbounded memory growth with large `git diff`, `bd list`, or similar output. This is a server availability risk on a long-running daemon.

Evidence to confirm: run `/api/runGitAction` against a repo with very large diff output, or point Beads at a huge `.beads/issues.jsonl`; memory and response time should grow with full output.

### 5. High: SSH profile resolution builds a tunnel plan but does not establish the tunnel

`scripts/ghostex-cli.mjs:1762-1785` resolves an SSH profile by returning `baseUrl` plus `forwardPlan`, but `requestGxserverRpc` immediately fetches `target.baseUrl` at `scripts/ghostex-cli.mjs:1618-1635`. I did not find code that runs `forwardPlan.checkCommand`, `startCommand`, or `portForwardCommand` before the fetch. Also, `scripts/ghostex-cli.mjs:1837-1851` defaults the local forward port to `58744`, which conflicts with a local gxserver.

Impact: SSH profiles are likely unusable unless the user manually starts an exact port forward first; if a local daemon is running, the default forwarded port cannot bind. This affects the remote/SSH shipping surface.

Evidence to confirm: create an SSH profile with no existing local forward and run a gxserver-backed command. It should attempt `http://127.0.0.1:<localPort>` directly and fail before any SSH process is started.

### 6. Medium: remote listener startup failure can leave a partial local daemon running

`runGxserverForeground` starts the local server at `gxserver/src/server.ts:182-184`, then starts the remote server at `gxserver/src/server.ts:186-190`. If remote `listen(...)` rejects after the local bind succeeded, there is no cleanup path around those awaits. The top-level CLI catches the thrown error, but the already-listening local server can keep the Node process alive without runtime metadata being written at `gxserver/src/server.ts:192`.

Impact: enabling a bad remote listener config or colliding remote port can leave a confusing half-started daemon on the local port. `gxserver status` may report stale/unreachable metadata while the port is actually occupied by this failed startup process.

Evidence to confirm: configure `listeners.remote.enabled = true` with an occupied remote port, start foreground, then check whether `127.0.0.1:58744` remains bound after the startup error.

### 7. Medium: HTTP request bodies are read without a size limit

`gxserver/src/server.ts:1070-1082` reads all POST body chunks into memory and then parses JSON. The body is read after auth for protected endpoints, but remote-enabled deployments intentionally allow authenticated remote clients for many state and operation APIs.

Impact: any client with the bearer token can send a very large JSON body and force memory growth or process termination. This is especially risky once remote/Tailscale access is enabled.

Evidence to confirm: send a multi-hundred-MB authenticated POST to any protected endpoint and observe memory growth before JSON validation.

### 8. Medium: log querying reads and sorts the whole log file

`gxserver/src/logger.ts:20-23` appends indefinitely to one JSONL file. `/api/queryLogs` reads the entire file at `gxserver/src/logs.ts:76-103`, filters all entries, sorts all matches at `gxserver/src/logs.ts:31-33` and `gxserver/src/logs.ts:158-167`, then applies the limit.

Impact: a normal long-running user install can accumulate enough logs for `gx logs` or sidebar diagnostics to spike memory/CPU or time out. The endpoint is local-only, but it is still a production support path.

Evidence to confirm: generate a large `gxserver.jsonl` and call `/api/queryLogs` with a small limit. Runtime should still scale with total file size, not limit.

### 9. Medium: domain-state APIs allow unbounded nested JSON into SQLite

Project/session state accepts many `Record<string, unknown>` and array fields from the API. The normalizers shallow-copy objects/arrays at `gxserver/src/domain-state.ts:651-662`, and persistence stringifies them into SQLite JSON columns at `gxserver/src/domain-state.ts:514-538` and `gxserver/src/domain-state.ts:572-596`. There are no size, depth, or item-count limits for normal API writes.

Impact: an authenticated remote client can bloat `state.db`, make list/read responses huge, and increase parse/stringify memory pressure. This is separate from request-body size because even moderate requests can create durable oversized records.

Evidence to confirm: write a project with a large `runtimeSettings` or `previousSessionHistory`, then call `/api/listProjects` and inspect DB size and response latency.

### 10. Medium: remote CORS/private-network policy is broader than the trusted clients

Every response gets `access-control-allow-origin: *` and `access-control-allow-private-network: true` in `gxserver/src/server.ts:1093-1101`, including remote listener responses. Auth still blocks requests without a bearer token, but the policy allows any website visited by a browser to probe gxserver and, if a token is ever exposed to web content, call the API cross-origin.

Impact: this expands the browser attack surface around a privileged local/private-network daemon. The risk is lower than unauthenticated access, but production should normally restrict CORS/PNA to the native webview origins or explicitly documented remote web clients.

Evidence to confirm: from an arbitrary origin, issue a CORS preflight to gxserver. It should receive wildcard origin and PNA approval.

### 11. Low: credential-store writes put remote tokens in process argv

The macOS credential store writes secrets with `security add-generic-password ... -w <secret>` at `gxserver/src/credential-store.ts:101-111`. The CLI's duplicated reader path also supports one-shot `--token` at `scripts/ghostex-cli.mjs:1800-1818`.

Impact: local same-user process inspection or shell history can expose remote gxserver bearer tokens during setup/use. This is local-only and short-lived, but bearer tokens protect broad remote control.

Evidence to confirm: run token storage while observing process arguments with a local process listing tool.

### 12. Low: corrupted JSON columns are silently replaced with empty state

`gxserver/src/domain-state.ts:713-735` catches JSON parse failures and returns `{}` or `[]`. That prevents a crash, but it also hides corruption and can cause a later update to overwrite formerly valid shared settings/history with empty values.

Impact: persistence corruption or manual edits can become silent data loss instead of a visible repair/error path. This is lower severity because normal SQLite writes should not produce invalid JSON.

Evidence to confirm: manually corrupt one JSON column and call the corresponding list/update endpoint; the response should show empty state without an error.
