# Config: default vs. per-call, and the runtime cap

## Two layers

1. **Server default** — set once, in the plugin's `mcp.json` env block, applies to
   every call that doesn't pass `config`. Backed directly by opencode's own env vars
   (opencode.ai/docs/config):
   - `OPEN_DELEGATE_OPENCODE_CONFIG` → `OPENCODE_CONFIG` (path to a config file)
   - `OPEN_DELEGATE_OPENCODE_CONFIG_DIR` → `OPENCODE_CONFIG_DIR`
   - `OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT` → `OPENCODE_CONFIG_CONTENT` (inline JSON)
2. **Per-call override** — `ode_delegate`'s `config: { path?, content? }`. Use only
   when *this one call* needs different config than the default.

## Model policy env (MCP-level)

| Env | Role |
|-----|------|
| `OPEN_DELEGATE_DEFAULT_MODEL` | Single `provider/model` used when `ode_delegate` omits `model`. Prefer a cheap Zen free pin, e.g. `opencode/deepseek-v4-flash-free`. Subject to allow/deny. |
| `OPEN_DELEGATE_ODE_MODELS` | CSV force-routing catalog (conceptual ODE_MODELS). Soft rule + tool description. Unset → built-in cheap set; empty string → none. |
| `OPEN_DELEGATE_ALLOW_MODELS` | CSV allow list. Unset → implicit `openrouter/*` + `opencode/*`. Empty string → reject all explicit models. |
| `OPEN_DELEGATE_DENY_MODELS` | CSV blacklist applied after allow. Exact id or `provider/*`. |

**Model resolve precedence:**

1. Per-call `ode_delegate({ model })`
2. Else `OPEN_DELEGATE_DEFAULT_MODEL`
3. Else omit → OpenCode’s own configured default (`OPEN_DELEGATE_OPENCODE_CONFIG*`)

Prefer `OPEN_DELEGATE_DEFAULT_MODEL` for the common “pin a cheap default” case. Use
`OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT` only when you need a full OpenCode config blob.

List entry forms: exact `provider/model` or trailing `provider/*`. Comma-separated, trimmed.

The live `ode_delegate` tool description includes a short summary of the active policy
(so agents see operator overrides without reading env).

## Why overrides are capped

Each distinct `config` value spawns its own `opencode serve` process (keyed by a hash
of its content, so identical overrides reuse the same one instance). There's a hard
cap of 4 concurrent `opencode serve` processes total (1 shared default + up to 3
overrides). Hitting it returns:

> open-delegate is already running the maximum of 4 opencode server(s) (1 shared
> default + overrides). Wait for an active delegated session to finish, or reuse the
> default config instead of passing a one-off "config" override.

If you need more than a couple of distinct configs in flight at once, that's a signal
to set the *default* config instead of stacking overrides.

## Lifecycle

- The default runtime is **pre-warmed** in the background right after the MCP server
  connects (failure is logged, not fatal — it just falls back to lazy acquire on first
  `ode_delegate`), and stays warm for the life of the MCP server process.
- An override runtime stays warm for 5 minutes after its last session finishes, then
  is disposed automatically. Re-acquiring the same override config within that window
  reuses the still-warm process instead of respawning.
- If an opencode server process crashes mid-session, every session pinned to it is
  marked `"error"` immediately (you'll see it on the next `ode_status`/`ode_await`
  rather than hanging forever) — see [errors.md](errors.md).
- `ode_delegate` itself never blocks past a couple of seconds: if runtime acquire +
  session create + prompt start hasn't finished by then, it returns `status:
  "starting"` and keeps going in the background, subject to a soft setup deadline
  (`OPEN_DELEGATE_SETUP_TIMEOUT_MS`, default 25000ms) after which it's marked
  `"error"` (`RUNTIME_STARTUP_FAILED`) rather than staying `"starting"` forever.

## Logging

Every internal event is a one-line JSON object, always mirrored to the MCP server's
own **stderr** (visible in Cursor's MCP logs) and best-effort appended to a file so it
survives after the terminal scrolls away.

| Env | Role |
|-----|------|
| `OPEN_DELEGATE_LOG_DIR` | Directory for log files. Default: `<tmpdir>/open-delegate/logs`. |
| `OPEN_DELEGATE_LOG_LEVEL` | `debug \| info \| warn \| error`. Default `info`. `debug` also emits a line per `ode_status`/`ode_await` poll. |
| `OPEN_DELEGATE_SETUP_TIMEOUT_MS` | Soft deadline for a `"starting"` session's background setup (acquire + create + prompt-start) before it's force-failed. Default `25000`. |

Files (both named with the PID of the process that produced them, so multiple bridge
restarts / opencode respawns never collide):

- `mcp-<mcpPid>.jsonl` — every event from the open-delegate MCP server itself.
- `opencode-<opencodePid>-<runtimeKey>.log` — raw output for one `opencode serve`
  process (present once that runtime has actually spawned).

Key events: `mcp_start`, `mcp_shutdown`, `stdin_close`, `runtime_spawn`,
`runtime_ready`, `runtime_startup_failed`, `runtime_exit`, `runtime_crash`,
`delegate_accepted`, `delegate_setup_timeout`, `delegate_setup_discarded`,
`delegate_setup_unexpected_error`, `tool_error`, `session_status` (debug),
`await_timeout` (debug).

Use `ode_diagnostics` to read the bridge's own `logDir`/`mcpLogPath`, every live
runtime's `opencodePid`/`logPath`, and the last ~50 events without leaving the chat.
