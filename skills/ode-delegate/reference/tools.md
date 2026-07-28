# Tool contracts

All six tools live on the `open-delegate` MCP server. Every response is JSON text in
the tool result's `content[0].text`; `isError: true` marks a failure (message in the
same field).

## `ode_delegate`

Starts a new session and returns immediately — never awaits the agent finishing.

Input:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | yes | The task/instructions |
| `model` | string | no | `"provider/model"`, e.g. `"opencode/grok-code-fast-1"` |
| `agent` | string | no | OpenCode agent/mode name |
| `cwd` | string | no | Working directory for the session |
| `title` | string | no | Shown in opencode's own session list |
| `config` | `{ path?, content? }` | no | One-off config override — see [config.md](config.md) |

Output: `{ sessionId, status: "running", previewUrl, note }`.

Failure modes: invalid `model` string, `RuntimeCapacityError` (too many override
configs in flight), or a create/prompt call to opencode itself failing — all returned
as `isError: true`, never a hang.

## `ode_await`

Blocks until terminal or `timeoutMs` elapses.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sessionId` | string | yes | From `ode_delegate` |
| `timeoutMs` | number | no | Clamped to 1,000–120,000ms; default 30,000ms |

Output: `{ sessionId, status, previewUrl, errorMessage? }`. `status` is one of
`"running" | "done" | "error" | "cancelled"`. `"running"` on return just means the
timeout elapsed first — call again (it does not restart the clock on the underlying
task, which keeps running regardless).

## `ode_status`

Same output shape as `ode_await`, but a single non-blocking check — use this instead
of `ode_await` when you want to keep doing other things and check back later.

## `ode_transcript`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sessionId` | string | yes | |
| `tail` | number | no | Last N messages; default 20; `0` for all |

Output: `{ sessionId, status, totalMessages, transcript: string[] }`. Each line is
`"user: ..."` or `"assistant: ... [ERROR: ...]"`. Works while the session is still
running (partial transcript so far); fails cleanly if the session's opencode server
has already exited (message tells you the last known status instead of hanging).

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
