# Tool contracts

All seven tools live on the `open-delegate` MCP server. Every response is JSON text in
the tool result's `content[0].text`. `isError: true` marks a failure, and the JSON is a
stable envelope: `{ ok: false, code, message, hint?, fix?, details? }` — see
[errors.md](errors.md) for the full code table.

## `ode_delegate`

Returns within a few seconds — never blocks on the agent actually finishing. On a warm
runtime, the full acquire → create session → start-prompt chain usually completes
before it returns and you get `status: "running"` immediately. On a cold `opencode
serve` spawn (or a busy shared runtime), it returns `status: "starting"` instead and
finishes the rest of the setup in the background — poll with `ode_status`/`ode_await`
using the same `sessionId` either way.

Input:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | one of `prompt`/`promptPath` | Inline task/instructions. Hard cap ~512KiB. |
| `promptPath` | string | one of `prompt`/`promptPath` | Absolute path to a UTF-8 text file with the prompt, for anything too large to inline (same ~512KiB cap on the file). Mutually exclusive with `prompt`. |
| `model` | string | no | `"provider/model"`, e.g. `"opencode/deepseek-v4-flash-free"`; omit → `OPEN_DELEGATE_DEFAULT_MODEL` / OpenCode default |
| `agent` | string | no | OpenCode agent/mode name |
| `cwd` | string | no | Working directory for the session |
| `title` | string | no | Shown in opencode's own session list |
| `config` | `{ path?, content? }` | no | One-off config override — see [config.md](config.md) |

Output, warm path: `{ sessionId, status: "running", previewUrl, runtimeKey, opencodePid, note }`.

Output, cold path: `{ sessionId, status: "starting", note }` — `previewUrl`/`runtimeKey`/
`opencodePid` aren't known yet; they appear once `ode_status`/`ode_await` report `"running"`.

`sessionId` is stable from this first response for the whole lifetime of the session
(it's a UUID minted by open-delegate, not opencode's own session id — you never need
to know or handle opencode's internal id).

Failure modes: invalid `model` string, allow/deny policy rejection, oversized/invalid
`prompt`/`promptPath` (`PROMPT_TOO_LARGE`, `PROMPT_PATH_INVALID`), `RuntimeCapacityError`
(too many override configs in flight), or a create/prompt call to opencode itself
failing — all returned as `isError: true` synchronously, or (if the failure happens
during background setup after a `"starting"` return) surfaced as a `status: "error"`
on the next `ode_status`/`ode_await` — see [errors.md](errors.md).

## `ode_await`

Blocks until terminal or `timeoutMs` elapses.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sessionId` | string | yes | From `ode_delegate` |
| `timeoutMs` | number | no | Clamped to 1,000–120,000ms; default 30,000ms |

Output: `{ sessionId, status, previewUrl?, errorMessage?, errorCode?, hasFinalText? }`. `status` is one
of `"starting" | "running" | "done" | "error" | "cancelled"`. `"starting"`/`"running"`
on return just means the timeout elapsed first (or background setup is still in
flight) — call again; it does not restart the clock on the underlying task, which
keeps running regardless.

`errorCode` is set when `status` is `"error"` and the failure was classified (e.g.
`PROVIDER_AUTH` / `PROVIDER_ERROR` for mid-run provider failures, including those
detected while OpenCode still reports `busy`/`retry`). Match on `errorCode` when
present; see [errors.md](errors.md).

`hasFinalText` is set when the session has reached a terminal status: `true` if the
last assistant message had non-empty text parts, `false` when known empty (tool-only
turn, stuck startup, dead runtime), omitted while still `"running"` or when unknown
(e.g. the message list could not be read).

## `ode_status`

Same output shape as `ode_await`, but a single non-blocking check — use this instead
of `ode_await` when you want to keep doing other things and check back later.

## `ode_transcript`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sessionId` | string | yes | |
| `tail` | number | no | Last N messages; default 20; `0` for all |
| `includeToolCalls` | boolean | no | Default `false`. When `true`, append truncated one-liners per tool call under each assistant message |

Output: `{ sessionId, status, totalMessages, transcript: string[] }`. Each line is
`"user: ..."` or `"assistant: ... [ERROR: ...]"`. Assistant turns that used tools but
produced no text render as
`assistant: (no final text — N tool call(s); see ode_transcript with includeToolCalls, or ode_resume to ask for a written summary)`
instead of a blank line. Works while the session is still running (partial transcript
so far); fails cleanly if the session's opencode server has already exited (message
tells you the last known status instead of hanging).

## `ode_cancel`

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | yes |

Output: `{ sessionId, status: "cancelled" }`. Calling it on an already-finished session
is a no-op that still returns `ok` with a note, not an error.

## `ode_resume`

Only valid once a session is no longer `"running"`.

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | yes |
| `prompt` | string | yes — the follow-up |

Output: `{ sessionId, status: "running", previewUrl }`. Always reuses that session's
*original* config (ignores any different config you might want — there is no way to
change config mid-session); respawns its opencode server automatically if it had been
disposed. If the server was respawned, the fresh instance may not have that session's
history anymore — the tool surfaces that as an `isError` rather than silently losing
context.

## `ode_diagnostics`

No input. Read-only snapshot of the **bridge itself**, not any one session — use it
when a call behaved unexpectedly, when you saw a Cursor host-side connection error
(see [errors.md](errors.md)), or to find which opencode process/log backs a
`runtimeKey`.

Output:

```json
{
  "mcpPid": 12345,
  "version": "0.1.0-alpha",
  "logDir": "/tmp/open-delegate/logs",
  "mcpLogPath": "/tmp/open-delegate/logs/mcp-12345.jsonl",
  "logLevel": "info",
  "runtimes": [
    { "key": "default", "state": "ready", "refCount": 1, "opencodePid": 23456, "url": "http://127.0.0.1:4321", "logPath": "…/opencode-23456-default.log" }
  ],
  "sessionCounts": { "running": 1, "done": 3, "error": 0, "cancelled": 0 },
  "recentEvents": [{ "ts": "...", "level": "info", "event": "runtime_ready", "pid": 12345, "key": "default", "opencodePid": 23456 }]
}
```

`recentEvents` is the last ~50 internal events (see [config.md](config.md) for the
full event list and `OPEN_DELEGATE_LOG_LEVEL`). `runtimes[].logPath` is only present
once that runtime has an `opencodePid` (i.e. it has actually spawned).
