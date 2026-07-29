# open-delegate

Delegate a Cursor task to a real, unattended background [OpenCode](https://opencode.ai) agent — cheaper model, isolated history — through seven small MCP tools.

![version](https://img.shields.io/badge/version-0.1.0--alpha-informational?style=flat-square)
![npm](https://img.shields.io/badge/npm-@verbalize%2Fopen--delegate-cb3837?style=flat-square)
![IDE](https://img.shields.io/badge/IDE-Cursor-000000?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)

## Goals

| Goal | Detail |
|------|--------|
| Reduce Cursor spend | Hand work to cheaper OpenCode alternatives (Zen free, open-weights, mid/cheap OpenRouter) |
| Real OpenCode handoff | Cursor "delegates" like the native tool, but OpenCode executes |
| Trivial install | Finds the `opencode` CLI; env-configurable; one-command local register |
| Guarded model policy | MCP-level default / force catalog / allow / deny; soft always-on routing rule |
| Guarded lifecycle | Bounded waits, no leaked background processes, real error text |
| Live preview | Each session returns its own `opencode serve` URL to open directly |

## Non-goals

- Supporting IDEs other than Cursor
- Chasing Anthropic/OpenAI flagship quality (Opus / Sonnet / Fable / GPT Sol / Terra are out of curated defaults)
- Cursor slug → OpenCode remapping
- Task-kind / persona auto-routing beyond configurable force / allow / deny lists
- Replacing the native delegate tool for Cursor-native models not on the force list

## Prerequisites

1. **[Cursor](https://cursor.com)** (this plugin is Cursor-only).
2. **Node.js ≥ 18.17** ([nodejs.org](https://nodejs.org) or your package manager).
3. **OpenCode CLI** on your `PATH` (or set `OPEN_DELEGATE_OPENCODE_BIN` to its full path).

### Install OpenCode

Pick one (package name on npm is `opencode-ai`, not `opencode`):

**macOS / Linux**

```bash
# Recommended one-liner
curl -fsSL https://opencode.ai/install | bash

# Or via npm
npm i -g opencode-ai@latest

# Or Homebrew (tap stays more up to date than the official formula)
brew install anomalyco/tap/opencode
```

**Windows**

```powershell
npm i -g opencode-ai@latest

# Or Scoop / Chocolatey
scoop install opencode
# choco install opencode
```

Verify:

```bash
opencode --version
```

### Configure a model

OpenCode needs at least one usable model. Either:

- Run `opencode auth login` (or `/connect` inside the OpenCode TUI) and add a provider API key, **or**
- Use a free hosted model such as `opencode/deepseek-v4-flash-free` (no API key required for that path).

Docs: [opencode.ai/docs](https://opencode.ai/docs).

## Install

> **Note:** `@verbalize/open-delegate` is not yet published on npm, and the Cursor Marketplace listing is pending. Until then, install from a git clone (below). That registers a local Cursor plugin pointed at your build.

```bash
git clone git@github.com:Verbalize-public/open-delegate.git
cd open-delegate
```

**macOS / Linux**

```bash
./scripts/install.sh
```

**Windows (PowerShell)**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Both scripts run `npm install` → `npm run build` → `npm run register:local`. You can do the same by hand:

```bash
npm install && npm run build && npm run register:local
```

Then **Cursor → Developer: Reload Window**. Customize → MCP Tools should list `open-delegate` with seven tools: `ode_delegate`, `ode_await`, `ode_status`, `ode_transcript`, `ode_cancel`, `ode_resume`, `ode_diagnostics`.

`register:local` syncs into `~/.cursor/plugins/local/open-delegate` with an `mcp.json` that runs `node <absolute>/dist/index.cjs`, and installs a `workspaceOpen` hook so Cursor loads that path. Re-run the install script (or `npm run register:local`) after pulling changes.

<details>
<summary>Pin a default model / policy</summary>

Edit the installed `~/.cursor/plugins/local/open-delegate/mcp.json` (keep the absolute `args` path the sync wrote):

```json
{
  "mcpServers": {
    "open-delegate": {
      "command": "node",
      "args": ["/absolute/path/to/open-delegate/dist/index.cjs"],
      "env": {
        "OPEN_DELEGATE_DEFAULT_MODEL": "opencode/deepseek-v4-flash-free"
      }
    }
  }
}
```

On Windows the `args` path looks like `C:/Users/<you>/…/open-delegate/dist/index.cjs` (forward slashes are fine).

Optional lists (CSV): `OPEN_DELEGATE_ODE_MODELS`, `OPEN_DELEGATE_ALLOW_MODELS`, `OPEN_DELEGATE_DENY_MODELS`.

For a full OpenCode config blob (advanced), use `OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT` instead.

Full env reference: [`skills/ode-delegate/reference/config.md`](skills/ode-delegate/reference/config.md).

</details>

## How it works

```text
Cursor (MCP client)
   │  stdio, JSON-RPC
   ▼
open-delegate MCP server  (this repo → dist/index.cjs)
   │  spawns + owns
   ▼
opencode serve  (1 shared default + up to 3 capped ephemeral overrides)
   │  HTTP via OpenCode's client SDK
   ▼
model / provider
```

- Soft rule `rules/open-delegate-routing.mdc`: if the named model is on ODE_MODELS or is `openrouter/…`, use `ode_delegate` + `ode_await` (not native Task).
- The default `opencode serve` runtime is pre-warmed right after MCP connect, so most `ode_delegate` calls hit an already-warm process.
- `ode_delegate` returns a stable `sessionId` within a few seconds — `status: "running"` if setup already finished, or `status: "starting"` if it's still finishing in the background; poll either with `ode_status`/`ode_await`.
- Prompts are capped at ~512KiB inline; use `promptPath` for anything larger.
- `ode_await` / `ode_status` poll OpenCode's `/session/status` + message list — never the MCP server's own say-so alone.
- If `opencode serve` crashes, every session pinned to it is marked `"error"` immediately (no hang).
- Closing the MCP connection disposes every spawned `opencode serve` process.
- Internal events are logged as one-line JSON; `ode_diagnostics` reads them back live — see [config.md](skills/ode-delegate/reference/config.md#logging) and [errors.md](skills/ode-delegate/reference/errors.md).

## Documentation

| Doc | Topic |
|-----|-------|
| [skills/ode-delegate/SKILL.md](skills/ode-delegate/SKILL.md) | Agent-facing contract: when/how to use the seven tools |
| [skills/ode-delegate/reference/models.md](skills/ode-delegate/reference/models.md) | Cheap force-set pins / job defaults |
| [skills/ode-delegate/reference/tools.md](skills/ode-delegate/reference/tools.md) | Tool-by-tool input/output |
| [skills/ode-delegate/reference/config.md](skills/ode-delegate/reference/config.md) | `OPEN_DELEGATE_*` env vars and per-call overrides |
| [skills/ode-delegate/reference/errors.md](skills/ode-delegate/reference/errors.md) | Error shapes |
| [rules/open-delegate-routing.mdc](rules/open-delegate-routing.mdc) | Soft always-on routing (ODE_MODELS / openrouter → ODE) |
| [docs/MODELS_GROUND_TRUTH.md](docs/MODELS_GROUND_TRUTH.md) | Cost-first catalog research |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local development, testing, troubleshooting, release gate |

## Contributing

Issues and PRs welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for local setup, tests, project layout, troubleshooting, and the maintainer release gate.

## License

[MIT](LICENSE)
