# Errors: codes, exact strings, and host-vs-app

Every `isError: true` tool result is now JSON (not a bare string) shaped like:

```json
{ "ok": false, "code": "SESSION_NOT_FOUND", "message": "...", "hint": "...", "fix": "...", "details": {} }
```

`hint`/`fix`/`details` are omitted when there's nothing useful to add. Match on `code`
(stable) rather than `message` text where possible. Terminal `errorMessage` on
`ode_await`/`ode_status` (a `status: "error"` field inside a normal `ok` result, not
`isError`) is unaffected — see the last section.

## Error codes

| Code | Meaning | Surfaces from |
|---|---|---|
| `INVALID_MODEL` | `model` (or `OPEN_DELEGATE_DEFAULT_MODEL`) wasn't `"provider/model"` shaped | `ode_delegate` |
| `MODEL_NOT_ALLOWED` | Resolved model failed the allow gate | `ode_delegate` |
| `MODEL_DENIED` | Resolved model matched `OPEN_DELEGATE_DENY_MODELS` | `ode_delegate` |
| `PROMPT_TOO_LARGE` | `prompt` (or the file at `promptPath`) is over the ~512KiB cap | `ode_delegate` |
| `PROMPT_PATH_INVALID` | Neither/both of `prompt`/`promptPath` given, or `promptPath` couldn't be read | `ode_delegate` |
| `RUNTIME_CAPACITY` | Too many distinct `config` overrides in flight (see [config.md](config.md)) | `ode_delegate`, `ode_resume` |
| `BINARY_NOT_FOUND` | `opencode` isn't installed / not on `PATH` | `ode_delegate`, `ode_resume` |
| `RUNTIME_STARTUP_FAILED` | `opencode serve` didn't report a listening URL in time, or crashed on startup | `ode_delegate`, `ode_resume` |
| `SESSION_CREATE_FAILED` | The opencode `session.create` HTTP call itself failed | `ode_delegate` |
| `PROMPT_START_FAILED` | The opencode `session.promptAsync` HTTP call itself failed | `ode_delegate` |
| `SESSION_NOT_FOUND` | Typo'd id, or the session is >30 min past finishing (pruned from memory) | any tool except `ode_delegate` |
| `SESSION_NOT_TERMINAL` | `ode_resume` called while the session is still `"running"` | `ode_resume` |
| `SESSION_ABORT_FAILED` | The opencode `session.abort` HTTP call itself failed | `ode_cancel` |
| `SESSION_RESUME_FAILED` | The opencode `session.promptAsync` HTTP call itself failed on resume | `ode_resume` |
| `TRANSCRIPT_FETCH_FAILED` | The opencode `session.messages` HTTP call itself failed | `ode_transcript` |
| `RUNTIME_UNAVAILABLE` | That session's opencode server process is no longer running | `ode_transcript` |
| `PROVIDER_AUTH` | Provider auth/billing failure mid-run (`ProviderAuthError`, 401/403, out of credits/budget/quota) — or stuck-startup with a matching tee-log line | `ode_await` / `ode_status` (`errorCode` field; also stuck-startup) |
| `PROVIDER_ERROR` | Other mid-run model/provider failure on the assistant message | `ode_await` / `ode_status` (`errorCode` field) |
| `UNKNOWN` | An error whose class wasn't one of the above (rare) | any tool |

`INVALID_MODEL` and `MODEL_NOT_ALLOWED` include a `hint` field: up to 5 known-good
`provider/model` ids ranked by similarity to what you passed (so a bare model name
missing its provider, e.g. `"deepseek-v4-pro"`, surfaces
`"openrouter/deepseek/deepseek-v4-pro"` first).

## Capacity

> open-delegate is already running the maximum of 4 opencode server(s) (1 shared
> default + overrides). Wait for an active delegated session to finish, or reuse the
> default config instead of passing a one-off "config" override.

## Terminal `errorMessage` / `errorCode` (seen via `ode_await`/`ode_status`, `status: "error"`)

These live inside a normal `ok` result (not `isError`) because the *tool call*
succeeded — it's the delegated session that ended in error. Prefer matching on
`errorCode` when present; `errorMessage` is the human-readable detail.

Provider failures are detected even while OpenCode still reports `busy`/`retry`,
as long as the last assistant message carries `.error` (so out-of-budget /
`ProviderAuthError` is not hidden behind a retry loop).

| `errorCode` | `errorMessage` (pattern) | Meaning |
|---|---|---|
| `PROVIDER_AUTH` | `<ProviderAuthError\|…>: <detail>` (auth, 401/403, credits/budget/quota) | Mid-run provider auth/billing failure, forwarded from opencode's `AssistantMessage.error` |
| `PROVIDER_ERROR` | `<UnknownError\|MessageOutputLengthError\|…>: <detail>` | Other mid-run model/provider failure on the assistant message |
| (often `PROVIDER_AUTH` if log matched) | `The delegated session never started producing a reply…` (+ absolute tee log path; optional `Last matching log line: …`) | Nothing ever went "busy" and no assistant reply appeared within 20s — bad `model`/`agent`, or silent provider auth failure. `model` shape is validated locally first; this is for ids that are shaped correctly but don't exist/aren't authorized |
| | `The opencode server for this session is no longer running (it may have crashed or been disposed).` | The runtime died (crash, or an override runtime's grace period expired) after this session started but before it finished |
| | `process exited unexpectedly (code=<N\|null>, signal=<name\|null>).` | Same as above, phrased from the crash-detection side; every session on that runtime gets this at once |
| | `Could not read the session's final message: <detail>` | opencode's own `/session/{id}/message` call failed right at the finish line (rare; treated as an error rather than leaving the session stuck "running" forever) |

## `ode_await` timeout (not an error)

`ode_await` returning `{ status: "running" }` after `timeoutMs` elapses is expected,
not a failure — the underlying opencode session keeps running regardless. Call
`ode_await` or `ode_status` again.

## Cursor host-side errors (not from open-delegate)

Strings like `Connection stopped for server plugin-open-delegate-…` or
`Timed out waiting for connection to plugin-open-delegate-…` come from **Cursor's own
MCP host**, not from this server — open-delegate never returns those strings (grep the
source: they don't exist here). They mean the MCP bridge process itself died or Cursor
couldn't (re)establish its connection, so you get a raw host message instead of one of
the JSON envelopes above.

Historically this was caused by `ode_delegate` blocking on a cold `opencode serve`
spawn plus a full inline-prompt HTTP upload, long enough that Cursor's own tool-call/MCP
timeout fired and dropped the connection before open-delegate could respond. Two
mitigations now ship for this: the default runtime is **pre-warmed** right after the
MCP server connects (so most calls hit an already-warm runtime), and `ode_delegate`
itself never blocks past a couple of seconds — it returns `status: "starting"` and
finishes the real setup in the background if a cold spawn is still in flight. You
should rarely see this anymore, but it's still possible (e.g. a very first call
racing pre-warm, or a genuinely wedged `opencode` install).

Fixes:

- Reload the window (**Cursor: Developer → Reload Window**) — this restarts the MCP
  connection cleanly; any in-flight opencode session keeps running server-side and can
  still be reached with `ode_status`/`ode_await` afterward if the runtime survived.
- Keep `prompt` reasonably sized; use `promptPath` (a file path) instead of pasting
  large documents inline — anything over ~512KiB is rejected locally either way
  (`PROMPT_TOO_LARGE`), before it ever reaches opencode.
- Run `ode_diagnostics` right after reconnecting — it reports the MCP bridge's own pid
  and every live opencode runtime's pid/url/log path, so you can tell whether the
  opencode process survived the Cursor-side hiccup.
- During local development, prefer `npm run register:local` (direct `node dist/index.cjs`)
  over `npx` — see [config.md](config.md).
