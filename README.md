# open-delegate

A Cursor plugin that delegates a task to a real, unattended background [OpenCode](https://opencode.ai) agent session — a different model, its own isolated history — through six small MCP tools.

## Goals

- Let Cursor "delegate" a task to a subagent the same way its native delegate tool
  does, but have OpenCode actually execute it.
- Trivial, flexible install — find the `opencode` CLI itself, configurable via env
  vars, no manual `~/.cursor/mcp.json` editing required.
- Any model OpenCode can reach, usable from Cursor.
- Guardrails around the handoff: never block forever, never leak a background
  process, surface real error text instead of hanging.
- A "preview" of what the subagent is doing: every delegated session's own
  `opencode serve` URL is returned, so it can be opened directly.

## Non-goals

- Supporting IDEs other than Cursor.
- Model routing per task kind/persona — that's the caller's job; this tool just runs
  what it's told.
- Replacing the native delegate tool entirely — prefer it for anything that doesn't
  need a different model or an unattended background run.

## Quick start

```powershell
git clone git@github.com:Verbalize-public/open-delegate.git
cd open-delegate
npm install && npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-cursor-plugin.ps1
```

Then **Cursor: Developer → Reload Window**. Customize → MCP Tools should now list
`open-delegate` with 6 tools (`ode_delegate`, `ode_await`, `ode_status`,
`ode_transcript`, `ode_cancel`, `ode_resume`).

The sync script copies this repo (built `dist/`, `node_modules/`, `mcp.json`,
`.cursor-plugin/`, `skills/`) into `~/.cursor/plugins/local/open-delegate` and mirrors
the skill into `~/.cursor/skills/ode-delegate`. Re-run `npm install && npm run build`
then the sync script after pulling changes.

<details>
<summary>Pin a default model/config</summary>

By default, `ode_delegate` uses whatever model opencode itself defaults to. To pin a
different server-wide default, add an `env` block to the installed
`~/.cursor/plugins/local/open-delegate/mcp.json`:

```jsonc
{
  "mcpServers": {
    "open-delegate": {
      "command": "node",
      "args": ["dist/index.js"],
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

```
Cursor (or any MCP client)
   │  stdio, JSON-RPC
   ▼
open-delegate MCP server (this repo, dist/index.js)
   │  spawns + owns
   ▼
opencode serve  (1 shared "default" process, + up to 3 capped ephemeral overrides)
   │  HTTP, OpenCode's own client SDK
   ▼
the actual model / provider
```

- `ode_delegate` creates an OpenCode session and fires the prompt via OpenCode's own
  `promptAsync` (fire-and-forget), then returns immediately with a `sessionId`.
- `ode_await`/`ode_status` poll OpenCode's own `/session/status` + message list to
  decide when a session is actually done (never on the MCP server's own say-so alone).
- If the `opencode serve` process crashes, every session pinned to it is marked
  `"error"` immediately rather than hanging.
- Closing the MCP connection (end of a Cursor chat, or `Ctrl+C`/`SIGTERM`) disposes
  every spawned `opencode serve` process — nothing is left running in the background.

## Documentation

| Doc | Topic |
|-----|-------|
| [skills/ode-delegate/SKILL.md](skills/ode-delegate/SKILL.md) | Full agent-facing contract: when/how to use the 6 tools |
| [skills/ode-delegate/reference/tools.md](skills/ode-delegate/reference/tools.md) | Tool-by-tool input/output reference |
| [skills/ode-delegate/reference/config.md](skills/ode-delegate/reference/config.md) | `OPEN_DELEGATE_*` env vars and per-call overrides |
| [skills/ode-delegate/reference/errors.md](skills/ode-delegate/reference/errors.md) | Error shapes and what they mean |

### Project layout

| Path | What |
|------|------|
| `src/binaryResolve.ts` | Finds the `opencode` CLI (override env var or PATH scan) |
| `src/runtime.ts` | One spawned `opencode serve` process + connected client |
| `src/runtimeManager.ts` | Pool of runtimes (1 default + capped overrides), crash/dispose lifecycle |
| `src/sessionRegistry.ts` | In-memory session bookkeeping (routing + last known status) |
| `src/opencodeHelpers.ts` | Status/transcript polling logic shared by the tools |
| `src/tools/*.ts` | The six MCP tools |
| `src/index.ts` | MCP server bootstrap, signal/stdio-close cleanup |
| `skills/ode-delegate/` | The agent-facing skill (when/how to use the tools) |
| `.cursor-plugin/plugin.json`, `mcp.json` | Cursor plugin manifest |
| `scripts/sync-cursor-plugin.ps1` | Installs this repo into Cursor's local plugins |
| `scripts/e2e-smoke.mjs` | Standalone real-server smoke test |
| `scripts/validate-skill.mjs` | Checks the plugin/skill layout against reality |

## Requirements

- Node.js ≥ 18.17.
- The [`opencode`](https://opencode.ai/docs) CLI installed and on `PATH`
  (`npm i -g opencode-ai@latest`), or point `OPEN_DELEGATE_OPENCODE_BIN` at it.
- opencode itself already configured with at least one usable model (`opencode auth
  login`, or use one of its free hosted models — no key needed).

## Development

```powershell
npm install
npm run build            # tsc -> dist/
npm run test:unit        # fast, no opencode needed
npm run test:integration  # spawns a real opencode + a free model; needs opencode on PATH
npm run e2e               # builds, then drives the real stdio server end to end
npm run validate:skill     # checks the plugin/skill layout matches reality
```

`tests/unit/` covers pure logic (binary resolution, model/config parsing, the
runtime pool, session bookkeeping) with no external process. `tests/integration/`
and `scripts/e2e-smoke.mjs` both exercise a real `opencode serve` process and a real
free hosted model (`opencode/deepseek-v4-flash-free`) — no API key required.

## Contributing

Issues and PRs welcome. Run `npm run test:unit` (and `npm run test:integration` if
you have `opencode` installed) before submitting.

## License

[MIT](LICENSE)
