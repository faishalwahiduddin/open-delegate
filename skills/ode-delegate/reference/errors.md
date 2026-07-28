# Exact error/timeout strings

The MCP server never leaves a call hanging on failure — every known failure mode
below returns `isError: true` (or a terminal `errorMessage` field) with one of these
exact messages, so you can pattern-match on them if needed.

## Setup / environment (surfaces on the first `ode_delegate` call)

| Message (exact) | Meaning | Fix |
|---|---|---|
| `Could not find the "opencode" CLI (not on PATH). Install it (npm i -g opencode-ai@latest, or see https://opencode.ai/docs) or set OPEN_DELEGATE_OPENCODE_BIN to its full path.` | `opencode` isn't installed / not on PATH | Install opencode, or set `OPEN_DELEGATE_OPENCODE_BIN` |
| `opencode serve did not report a listening URL within <N>ms.` | opencode started but never printed its "listening on" line in time | Usually a broken opencode install or antivirus/firewall blocking the loopback port; check the appended server output in the message |
| `opencode serve exited with code <N> before it started listening.` | opencode crashed on startup | Read the appended output; often a bad `OPENCODE_CONFIG`/`OPENCODE_CONFIG_CONTENT` |

## Input validation (immediate, before spawning anything)

| Message (exact) | Meaning |
|---|---|
| `Invalid model "<raw>": expected "provider/model" (e.g. "opencode/grok-code-fast-1" or "anthropic/claude-sonnet-4-5").` | `model` wasn't `"provider/model"` shaped |

## Capacity

| Message (exact) | Meaning |
|---|---|
| `open-delegate is already running the maximum of <N> opencode server(s) (1 shared default + overrides). Wait for an active delegated session to finish, or reuse the default config instead of passing a one-off "config" override.` | Too many distinct `config` overrides in flight — see [config.md](config.md) |

## Session-not-found (any tool except `ode_delegate`)

| Message (exact) | Meaning |
|---|---|
| `Unknown sessionId "<id>". It may have already been pruned, or was never created by ode_delegate.` | Typo'd id, or the session is >30 min past finishing (pruned from memory — opencode itself may still have it) |

## Terminal `errorMessage` values (seen via `ode_await`/`ode_status`, `status: "error"`)

| `errorMessage` (pattern) | Meaning |
|---|---|
| `<ProviderAuthError\|UnknownError\|MessageOutputLengthError\|...>: <detail>` | The model/provider itself failed mid-run (auth, output-length limit, etc.) — this is opencode's own `AssistantMessage.error`, forwarded as-is |
| `The delegated session never started producing a reply (invalid model/agent id, or a provider auth failure). Check the opencode server logs for details.` | Nothing ever went "busy" and no assistant reply appeared within 20s of starting — almost always a bad `model`/`agent` id that opencode silently rejected, or a provider needing auth it doesn't have. Note: `model` string shape is validated locally first (see above); this is for ids that are *shaped* correctly but don't exist/aren't authorized |
| `The opencode server for this session is no longer running (it may have crashed or been disposed).` | The runtime died (crash, or an override runtime's grace period expired) after this session started but before it finished |
| `process exited unexpectedly (code=<N|null>, signal=<name|null>).` | Same as above, phrased from the crash-detection side; every session on that runtime gets this at once |
| `Could not read the session's final message: <detail>` | opencode's own `/session/{id}/message` call failed right at the finish line (rare; treated as an error rather than leaving the session stuck "running" forever) |

## `ode_await` timeout (not an error)

`ode_await` returning `{ status: "running" }` after `timeoutMs` elapses is expected,
not a failure — the underlying opencode session keeps running regardless. Call
`ode_await` or `ode_status` again.
