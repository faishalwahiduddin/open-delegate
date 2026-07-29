# Config: model policy, OpenCode server config, and logging

## Model policy env (MCP-level)

| Env | Role |
|-----|------|
| `OPEN_DELEGATE_DEFAULT_MODEL` | Single `provider/model` used when `ode_delegate` omits `model`. Prefer a cheap Zen free pin, e.g. `opencode/deepseek-v4-flash-free`. Subject to allow/deny. |
| `OPEN_DELEGATE_ODE_MODELS` | CSV force-routing catalog (conceptual ODE_MODELS). Soft rule + tool description. Unset → built-in cheap set from `src/data/ode-models.default.json`; empty string → none. |
| `OPEN_DELEGATE_ODE_MODELS_FILE` | Path to a JSON array of strings **or** a CSV file of model ids. Used only when `OPEN_DELEGATE_ODE_MODELS` is unset. |
| `OPEN_DELEGATE_ALLOW_MODELS` | CSV allow list. Unset → implicit `openrouter/*` + `opencode/*`. Empty string → reject all explicit models. |
| `OPEN_DELEGATE_DENY_MODELS` | CSV blacklist applied after allow. Exact id or `provider/*`. |

### ODE_MODELS precedence

| Priority | Source |
|----------|--------|
| 1 (highest) | `OPEN_DELEGATE_ODE_MODELS` (inline CSV; empty string clears the list) |
| 2 | `OPEN_DELEGATE_ODE_MODELS_FILE` (JSON array or CSV file) |
| 3 (lowest) | Built-in catalog (`src/data/ode-models.default.json`) |

### Model resolve precedence (per call)

| Priority | Source |
|----------|--------|
| 1 | Per-call `ode_delegate({ model })` |
| 2 | `OPEN_DELEGATE_DEFAULT_MODEL` |
| 3 | Omit → OpenCode’s own configured default (`OPEN_DELEGATE_OPENCODE_CONFIG*`) |

List entry forms: exact `provider/model` or trailing `provider/*`. Comma-separated, trimmed.

The live `ode_delegate` tool description includes a short summary of the active policy
(so agents see operator overrides without reading env).

Before starting a prompt, open-delegate also checks the live OpenCode
`provider.list()` snapshot (cached ~60s). A model missing from the catalog, or whose
provider is not in `connected`, fails immediately with `MODEL_NOT_AVAILABLE` instead of
hanging for the stuck-startup timeout.

Maintainers can refresh the curated catalog against a live runtime with
`npm run refresh:models` (reports diffs; does not auto-write).

## OpenCode server config (server-level only)

Set once in the plugin's `mcp.json` env block; applies to every call. Backed directly
by opencode's own env vars (opencode.ai/docs/config):

| Env | Maps to |
|-----|---------|
| `OPEN_DELEGATE_OPENCODE_CONFIG` | `OPENCODE_CONFIG` (path to a config file) |
| `OPEN_DELEGATE_OPENCODE_CONFIG_DIR` | `OPENCODE_CONFIG_DIR` |
| `OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT` | `OPENCODE_CONFIG_CONTENT` (inline JSON) |

There is **no** per-call config override. Configure the shared default instead.

## Lifecycle

- The default runtime is **pre-warmed** in the background right after the MCP server
  connects (failure is logged, not fatal — it just falls back to lazy acquire on first
  `ode_delegate`), and stays warm for the life of the MCP server process.
- If an opencode server process crashes mid-session, every session pinned to it is
  marked `"error"` immediately (you'll see it on the next `ode_await`) — see
  [errors.md](errors.md).
- `ode_delegate` itself never blocks past a couple of seconds unless you pass `waitMs`:
  if runtime acquire + session create + prompt start hasn't finished by then, it returns
  `status: "starting"` and keeps going in the background, subject to a soft setup
  deadline (`OPEN_DELEGATE_SETUP_TIMEOUT_MS`, default 25000ms).

## Logging

| Env | Role |
|-----|------|
| `OPEN_DELEGATE_LOG_DIR` | Directory for log files. Default: `<tmpdir>/open-delegate/logs`. |
| `OPEN_DELEGATE_LOG_LEVEL` | `debug \| info \| warn \| error`. Default `info`. `debug` also emits a line per `ode_await` poll. |
| `OPEN_DELEGATE_SETUP_TIMEOUT_MS` | Soft deadline for a `"starting"` session's background setup. Default `25000`. |

Files:

- `mcp-<mcpPid>.jsonl` — every event from the open-delegate MCP server itself.
- `opencode-<opencodePid>-<runtimeKey>.log` — raw output for one `opencode serve` process.

Use `ode_diagnostics` to read the bridge's own `logDir`/`mcpLogPath`, every live
runtime's `opencodePid`/`logPath`, and the last ~50 events without leaving the chat.
