# open-delegate

Delegate a Cursor task to a real, unattended background [OpenCode](https://opencode.ai) agent — different model, isolated history — through six small MCP tools.

![version](https://img.shields.io/badge/version-0.1.0--alpha-informational?style=flat-square)
![OS](https://img.shields.io/badge/OS-Windows%20supported%20%7C%20Linux%2FmacOS%20untested-yellow?style=flat-square)
![IDE](https://img.shields.io/badge/IDE-Cursor-000000?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)

## Goals

| Goal | Detail |
|------|--------|
| Real OpenCode handoff | Cursor "delegates" like the native tool, but OpenCode executes |
| Trivial install | Finds the `opencode` CLI; env-configurable; no manual `~/.cursor/mcp.json` editing |
| Any reachable model | Whatever OpenCode can call, usable from Cursor |
| Guarded lifecycle | Bounded waits, no leaked background processes, real error text |
| Live preview | Each session returns its own `opencode serve` URL to open directly |

## Non-goals

- Supporting IDEs other than Cursor
- Model routing by task kind/persona — callers choose; this tool runs what it's told
- Replacing the native delegate tool — prefer native unless you need a different model or an unattended background run

## Quick start

```powershell
git clone git@github.com:Verbalize-public/open-delegate.git
cd open-delegate
npm install && npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-cursor-plugin.ps1
```

Then **Cursor: Developer → Reload Window**. Customize → MCP Tools should list `open-delegate` with six tools: `ode_delegate`, `ode_await`, `ode_status`, `ode_transcript`, `ode_cancel`, `ode_resume`.

The sync script copies this repo (built `dist/`, `node_modules/`, `.cursor-plugin/`, `skills/`) into `~/.cursor/plugins/local/open-delegate`, writes an **absolute** `node …/dist/index.js` entry into the installed `mcp.json` (Cursor on Windows does not cwd to the plugin dir), and mirrors the skill into `~/.cursor/skills/ode-delegate`. Re-run after pulling changes.

<details>
<summary>Pin a default model/config</summary>

By default, `ode_delegate` uses whatever model OpenCode itself defaults to. To pin a server-wide default, add an `env` block to the installed `~/.cursor/plugins/local/open-delegate/mcp.json` (keep the absolute `args` path the sync script wrote):

```jsonc
{
  "mcpServers": {
    "open-delegate": {
      "command": "node",
      "args": ["C:/Users/<you>/.cursor/plugins/local/open-delegate/dist/index.js"],
      "env": {
        "OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT": "{\"model\":\"opencode/grok-code-fast-1\"}"
      }
    }
  }
}
```

Full list of `OPEN_DELEGATE_*` env vars and per-call overrides:
[`skills/ode-delegate/reference/config.md`](skills/ode-delegate/reference/config.md).

</details>

## How it works

```text
Cursor (MCP client)
   │  stdio, JSON-RPC
   ▼
open-delegate MCP server  (this repo → dist/index.js)
   │  spawns + owns
   ▼
opencode serve  (1 shared default + up to 3 capped ephemeral overrides)
   │  HTTP via OpenCode's client SDK
   ▼
model / provider
```

- `ode_delegate` creates an OpenCode session, fires `promptAsync`, returns immediately with a `sessionId`.
- `ode_await` / `ode_status` poll OpenCode's `/session/status` + message list — never the MCP server's own say-so alone.
- If `opencode serve` crashes, every session pinned to it is marked `"error"` immediately (no hang).
- Closing the MCP connection disposes every spawned `opencode serve` process.

## Documentation

| Doc | Topic |
|-----|-------|
| [skills/ode-delegate/SKILL.md](skills/ode-delegate/SKILL.md) | Agent-facing contract: when/how to use the six tools |
| [skills/ode-delegate/reference/tools.md](skills/ode-delegate/reference/tools.md) | Tool-by-tool input/output |
| [skills/ode-delegate/reference/config.md](skills/ode-delegate/reference/config.md) | `OPEN_DELEGATE_*` env vars and per-call overrides |
| [skills/ode-delegate/reference/errors.md](skills/ode-delegate/reference/errors.md) | Error shapes |

### Project layout

| Path | What |
|------|------|
| `src/binaryResolve.ts` | Finds the `opencode` CLI |
| `src/runtime.ts` | One spawned `opencode serve` + connected client |
| `src/runtimeManager.ts` | Runtime pool, crash/dispose lifecycle |
| `src/sessionRegistry.ts` | In-memory session bookkeeping |
| `src/opencodeHelpers.ts` | Status/transcript polling |
| `src/tools/*.ts` | The six MCP tools |
| `src/index.ts` | MCP bootstrap + cleanup |
| `skills/ode-delegate/` | Agent-facing skill |
| `.cursor-plugin/`, `mcp.json` | Cursor plugin manifest |
| `scripts/sync-cursor-plugin.ps1` | Install into Cursor local plugins |
| `scripts/e2e-smoke.mjs` | Real-server smoke test |
| `scripts/validate-skill.mjs` | Plugin/skill layout checks |

## Requirements

- **OS:** Windows supported. Linux / macOS untested (contributions welcome).
- **IDE:** [Cursor](https://cursor.com) only (plugin + sync path).
- Node.js ≥ 18.17.
- [`opencode`](https://opencode.ai/docs) CLI on `PATH` (`npm i -g opencode-ai@latest`), or set `OPEN_DELEGATE_OPENCODE_BIN`.
- OpenCode configured with at least one usable model (`opencode auth login`, or a free hosted model).

## Development

```powershell
npm install
npm run build             # tsc → dist/
npm run test:unit         # fast, no opencode needed
npm run test:integration  # real opencode + free model; needs PATH
npm run e2e               # build, then drive the real stdio server
npm run validate:skill    # plugin/skill layout vs reality
```

`tests/unit/` covers pure logic with no external process. `tests/integration/` and `scripts/e2e-smoke.mjs` exercise a real `opencode serve` and free hosted model (`opencode/deepseek-v4-flash-free`) — no API key required.

## Contributing

Issues and PRs welcome. Run `npm run test:unit` (and `npm run test:integration` if you have `opencode`) before submitting.

## License

[MIT](LICENSE)
