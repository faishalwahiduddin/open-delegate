# Tool contracts

All five tools live on the `open-delegate` MCP server. Every response is JSON text in
the tool result's `content[0].text`. `isError: true` marks a failure, and the JSON is a
stable envelope: `{ ok: false, code, message, hint?, fix?, details? }` — see
[errors.md](errors.md) for the full code table.

## `ode_delegate`

Returns within a few seconds by default — never blocks on the agent actually finishing
unless you pass `waitMs`. On a warm runtime, the full acquire → create session →
start-prompt chain usually completes before it returns and you get `status: "running"`
immediately. On a cold `opencode serve` spawn, it returns `status: "starting"` and
finishes setup in the background — poll with `ode_await` using the same `sessionId`.

Pass `sessionId` to **resume** a finished session with a follow-up prompt (former
`ode_resume`).

Input:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | one of `prompt`/`promptPath` | Inline task/instructions (or follow-up when resuming). Hard cap ~512KiB. |
| `promptPath` | string | one of `prompt`/`promptPath` | Absolute path to a UTF-8 text file with the prompt. Mutually exclusive with `prompt`. |
| `sessionId` | string | no | Resume an existing terminal session instead of creating a new one. |
| `model` | string | no | `"provider/model"`; omit → `OPEN_DELEGATE_DEFAULT_MODEL` / OpenCode default. Ignored when resuming. |
| `agent` | string | no | OpenCode agent/mode name. Ignored when resuming. |
| `cwd` | string | no | Working directory for the session |
| `title` | string | no | Shown in opencode's own session list. Ignored when resuming. |
| `waitMs` | number | no | After setup succeeds, block up to this many ms for completion (clamped 0–60000). |

Output, warm path: `{ sessionId, status: "running", previewUrl, runtimeKey, opencodePid, note }`.

Output, cold path: `{ sessionId, status: "starting", note }`.

Output, after `waitMs` finishes: same shape as `ode_await` (includes capped `answer` when available).

`sessionId` is stable from this first response for the whole lifetime of the session
(it's a UUID minted by open-delegate, not opencode's own session id).

Failure modes: invalid `model` string, allow/deny policy rejection, model not in the
live OpenCode catalog / provider not connected (`MODEL_NOT_AVAILABLE`), oversized/invalid
`prompt`/`promptPath`, or a create/prompt call to opencode itself failing — see
[errors.md](errors.md).

## `ode_await`

Blocks until terminal or `timeoutMs` elapses. Pass `timeoutMs: 0` for a single
non-blocking status check (former `ode_status`).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sessionId` | string | yes | From `ode_delegate` |
| `timeoutMs` | number | no | Clamped to 0–120,000ms; default 30,000ms. `0` = instant check. |

Output: `{ sessionId, status, previewUrl?, errorMessage?, errorCode?, hasFinalText?, answer? }`.
`status` is one of `"starting" | "running" | "done" | "error" | "cancelled"`.
`"starting"`/`"running"` on return just means the timeout elapsed first — call again.

`answer` is a capped (~4000 char) extract of the final assistant text when available —
prefer it over a separate `ode_transcript` for single-turn tasks.

`errorCode` is set when `status` is `"error"` and the failure was classified (e.g.
`PROVIDER_AUTH` / `PROVIDER_ERROR` / `MODEL_NOT_AVAILABLE`). Match on `errorCode` when
present; see [errors.md](errors.md).

## `ode_transcript`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sessionId` | string | yes | |
| `tail` | number | no | Last N messages; default 20; `0` for all |
| `includeToolCalls` | boolean | no | Default `false`. When `true`, append truncated one-liners per tool call |

Output: `{ sessionId, status, totalMessages, transcript: string[] }`. Works while the
session is still running (partial transcript so far).

## `ode_cancel`

| Field | Type | Required |
|-------|------|----------|
| `sessionId` | string | yes |

Output: `{ sessionId, status: "cancelled" }`. Calling it on an already-finished session
is a no-op that still returns `ok` with a note, not an error.

## `ode_diagnostics`

No input. Read-only snapshot of the **bridge itself**, not any one session.

Output includes `mcpPid`, `version`, `logDir`/`mcpLogPath`, `runtimes` (with optional
`connectedModelCount` / `connectedProviders` when a provider snapshot is cached),
`sessionCounts`, `recentEvents`, and a short `modelPolicy` summary.
