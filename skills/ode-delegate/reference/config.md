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

There's no `OPEN_DELEGATE_OPENCODE_CONFIG` field for `model` specifically — just pass
`model: "provider/model"` directly on `ode_delegate`/leave it unset to fall back to
whatever the effective opencode config's own default model is.

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

- The default runtime is spawned lazily on first use and stays warm for the life of
  the MCP server process.
- An override runtime stays warm for 5 minutes after its last session finishes, then
  is disposed automatically. Re-acquiring the same override config within that window
  reuses the still-warm process instead of respawning.
- If an opencode server process crashes mid-session, every session pinned to it is
  marked `"error"` immediately (you'll see it on the next `ode_status`/`ode_await`
  rather than hanging forever) — see [errors.md](errors.md).
