# Errors: codes, exact strings, and host-vs-app

Every `isError: true` tool result is JSON shaped like:

```json
{ "ok": false, "code": "SESSION_NOT_FOUND", "message": "...", "hint": "...", "fix": "...", "details": {} }
```

`hint`/`fix`/`details` are omitted when there's nothing useful to add. Match on `code`
(stable) rather than `message` text where possible. Terminal `errorMessage` on
`ode_await` (a `status: "error"` field inside a normal `ok` result, not
`isError`) is unaffected — see the last section.

## Error codes

| Code | Meaning | Surfaces from |
|---|---|---|
| `INVALID_MODEL` | `model` (or `OPEN_DELEGATE_DEFAULT_MODEL`) wasn't `"provider/model"` shaped | `ode_delegate` |
| `MODEL_NOT_ALLOWED` | Resolved model failed the allow gate | `ode_delegate` |
| `MODEL_DENIED` | Resolved model matched `OPEN_DELEGATE_DENY_MODELS` | `ode_delegate` |
| `MODEL_NOT_AVAILABLE` | Model missing from the live OpenCode catalog, or its provider is not connected | `ode_delegate` (setup / resume) |
| `PROMPT_TOO_LARGE` | `prompt` (or the file at `promptPath`) is over the ~512KiB cap | `ode_delegate` |
| `PROMPT_PATH_INVALID` | Neither/both of `prompt`/`promptPath` given, or `promptPath` couldn't be read | `ode_delegate` |
| `BINARY_NOT_FOUND` | `opencode` isn't installed / not on `PATH` | `ode_delegate` |
| `RUNTIME_STARTUP_FAILED` | `opencode serve` didn't report a listening URL in time, or crashed on startup | `ode_delegate` |
| `SESSION_CREATE_FAILED` | The opencode `session.create` HTTP call itself failed | `ode_delegate` |
| `PROMPT_START_FAILED` | The opencode `session.promptAsync` HTTP call itself failed | `ode_delegate` |
| `SESSION_NOT_FOUND` | Typo'd id, or the session is >30 min past finishing (pruned from memory) | any tool except create-path `ode_delegate` |
| `SESSION_NOT_TERMINAL` | `ode_delegate({ sessionId })` called while the session is still `"running"`/`"starting"` | `ode_delegate` (resume) |
| `SESSION_ABORT_FAILED` | The opencode `session.abort` HTTP call itself failed | `ode_cancel` |
| `SESSION_RESUME_FAILED` | The opencode `session.promptAsync` HTTP call itself failed on resume | `ode_delegate` (resume) |
| `TRANSCRIPT_FETCH_FAILED` | The opencode `session.messages` HTTP call itself failed | `ode_transcript` |
| `RUNTIME_UNAVAILABLE` | That session's opencode server process is no longer running | `ode_transcript` |
| `PROVIDER_AUTH` | Provider auth/billing failure mid-run | `ode_await` (`errorCode` field) |
| `PROVIDER_ERROR` | Other mid-run model/provider failure on the assistant message | `ode_await` (`errorCode` field) |
| `UNKNOWN` | An error whose class wasn't one of the above (rare) | any tool |

`INVALID_MODEL`, `MODEL_NOT_ALLOWED`, and `MODEL_NOT_AVAILABLE` include a `hint` field:
up to 5 known-good `provider/model` ids ranked by similarity (preferring currently
connected models when a provider snapshot is cached).

## Terminal `errorMessage` / `errorCode` (seen via `ode_await`, `status: "error"`)

These live inside a normal `ok` result (not `isError`) because the *tool call*
succeeded — it's the delegated session that ended in error. Prefer matching on
`errorCode` when present; `errorMessage` is the human-readable detail.

| `errorCode` | `errorMessage` (pattern) | Meaning |
|---|---|---|
| `PROVIDER_AUTH` | `<ProviderAuthError\|…>: <detail>` | Mid-run provider auth/billing failure |
| `PROVIDER_ERROR` | `<UnknownError\|…>: <detail>` | Other mid-run model/provider failure |
| (often `PROVIDER_AUTH` if log matched) | `The delegated session never started producing a reply…` | Stuck-startup fallback (20s) when fail-fast missed it |
| | `The opencode server for this session is no longer running…` | Runtime died mid-session |
| | `process exited unexpectedly (code=<N\|null>, signal=<name\|null>).` | Crash-detection phrasing |
| | `Could not read the session's final message: <detail>` | Message-list read failed at the finish line |

## `ode_await` timeout (not an error)

`ode_await` returning `{ status: "running" }` after `timeoutMs` elapses is expected,
not a failure — the underlying opencode session keeps running regardless. Call
`ode_await` again (or use `timeoutMs: 0` for a single peek).

## Cursor host-side errors (not from open-delegate)

Strings like `Connection stopped for server plugin-open-delegate-…` or
`Timed out waiting for connection to plugin-open-delegate-…` come from **Cursor's own
MCP host**, not from this server. Reload the window, keep prompts reasonably sized
(use `promptPath` for large docs), and run `ode_diagnostics` after reconnecting.
