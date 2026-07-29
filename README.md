# open-delegate

Delegate a Cursor task to a real, unattended background [OpenCode](https://opencode.ai) agent — cheaper model, isolated history — through five small MCP tools.

![version](https://img.shields.io/badge/version-0.2.0--alpha-informational?style=flat-square)
![npm](https://img.shields.io/badge/npm-@verbalize%2Fopen--delegate-cb3837?style=flat-square)
![IDE](https://img.shields.io/badge/IDE-Cursor-000000?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)

## Goals

| Goal | Detail |
|------|--------|
| Reduce Cursor spend | Hand work to cheaper OpenCode alternatives (Zen free, open-weights, mid/cheap OpenRouter) |
| Real OpenCode handoff | Cursor "delegates" like the native tool, but OpenCode executes |
| Trivial install | Marketplace / `npx`; finds the `opencode` CLI; env-configurable |
| Guarded model policy | MCP-level default / force catalog / allow / deny; soft always-on routing rule |
| Guarded lifecycle | Bounded waits, no leaked background processes, real error text |
| Live preview | Each session returns its own `opencode serve` URL to open directly |

## Non-goals

- Supporting IDEs other than Cursor
- Chasing Anthropic/OpenAI flagship quality (Opus / Sonnet / Fable / GPT Sol / Terra are out of curated defaults)
- Cursor slug → OpenCode remapping
- Task-kind / persona auto-routing beyond configurable force / allow / deny lists
- Replacing the native delegate tool for Cursor-native models not on the force list

## Install

1. Install from the [Cursor Marketplace](https://cursor.com/marketplace) (Customize → Plugins), once listed.
2. Ensure the [`opencode`](https://opencode.ai/docs) CLI is on your `PATH` (`npm i -g opencode-ai@latest`), or set `OPEN_DELEGATE_OPENCODE_BIN`.
3. Configure OpenCode with at least one usable model (`opencode auth login`, or a free hosted model).

The plugin's `mcp.json` runs:

```json
{
  "mcpServers": {
    "open-delegate": {
      "command": "npx",
      "args": ["-y", "@verbalize/open-delegate"]
    }
  }
}
```

After install, Customize → MCP Tools should list `open-delegate` with five tools: `ode_delegate`, `ode_await`, `ode_transcript`, `ode_cancel`, `ode_diagnostics`.

<details>
<summary>Pin a default model / policy</summary>

Prefer a first-class cheap default:

```json
{
  "mcpServers": {
    "open-delegate": {
      "command": "npx",
      "args": ["-y", "@verbalize/open-delegate"],
      "env": {
        "OPEN_DELEGATE_DEFAULT_MODEL": "opencode/deepseek-v4-flash-free"
      }
    }
  }
}
```

Optional lists (CSV): `OPEN_DELEGATE_ODE_MODELS`, `OPEN_DELEGATE_ALLOW_MODELS`, `OPEN_DELEGATE_DENY_MODELS`.
For a large custom force list, prefer `OPEN_DELEGATE_ODE_MODELS_FILE` (JSON array or CSV path) over a giant env CSV.

For a full OpenCode config blob (advanced), use `OPEN_DELEGATE_OPENCODE_CONFIG_CONTENT` instead.

Full env reference: [`skills/ode-delegate/reference/config.md`](skills/ode-delegate/reference/config.md).

</details>

## How it works

```text
Cursor (MCP client)
   │  stdio, JSON-RPC
   ▼
@verbalize/open-delegate  (npx → bundled MCP server)
   │  spawns + owns
   ▼
opencode serve  (1 shared default runtime)
   │  HTTP via OpenCode's client SDK
   ▼
model / provider
```

- Soft rule `rules/open-delegate-routing.mdc`: if the named model is on ODE_MODELS or is `openrouter/…`, use `ode_delegate` + `ode_await` (not native Task).
- The default `opencode serve` runtime is pre-warmed right after MCP connect, so most `ode_delegate` calls hit an already-warm process.
- `ode_delegate` returns a stable `sessionId` within a few seconds — `status: "running"` if setup already finished, or `status: "starting"` if it's still finishing in the background; poll with `ode_await` (use `timeoutMs: 0` for a single peek). Optional `waitMs` can finish short tasks in one call. Pass `sessionId` to resume a finished session.
- Before starting a prompt, models are checked against the live OpenCode `provider.list()` snapshot (fail-fast `MODEL_NOT_AVAILABLE`).
- Prompts are capped at ~512KiB inline; use `promptPath` for anything larger.
- `ode_await` polls OpenCode's `/session/status` + message list and returns a capped `answer` when available.
- If `opencode serve` crashes, every session pinned to it is marked `"error"` immediately (no hang).
- Closing the MCP connection disposes every spawned `opencode serve` process.
- Every internal event is logged as one-line JSON to stderr and to a PID-named file; `ode_diagnostics` reads it back live — see [skills/ode-delegate/reference/config.md](skills/ode-delegate/reference/config.md#logging).
- Failures are a stable `{ code, message, hint?, fix? }` JSON envelope — see [skills/ode-delegate/reference/errors.md](skills/ode-delegate/reference/errors.md).

## Documentation

| Doc | Topic |
|-----|-------|
| [skills/ode-delegate/SKILL.md](skills/ode-delegate/SKILL.md) | Agent-facing contract: when/how to use the five tools |
| [skills/ode-delegate/reference/models.md](skills/ode-delegate/reference/models.md) | Cheap force-set pins / job defaults |
| [skills/ode-delegate/reference/tools.md](skills/ode-delegate/reference/tools.md) | Tool-by-tool input/output |
| [skills/ode-delegate/reference/config.md](skills/ode-delegate/reference/config.md) | `OPEN_DELEGATE_*` env vars |
| [skills/ode-delegate/reference/errors.md](skills/ode-delegate/reference/errors.md) | Error shapes |
| [rules/open-delegate-routing.mdc](rules/open-delegate-routing.mdc) | Soft always-on routing (ODE_MODELS / openrouter → ODE) |
| [docs/MODELS_GROUND_TRUTH.md](docs/MODELS_GROUND_TRUTH.md) | Cost-first catalog research |
| [RUNBOOK.md](RUNBOOK.md) | Diagnose host-side connection errors, find logs by pid, release gate |

### Project layout

| Path | What |
|------|------|
| `src/binaryResolve.ts` | Finds the `opencode` CLI |
| `src/modelPolicy.ts` | Default / ODE_MODELS / allow / deny / model-id suggestions |
| `src/modelAvailability.ts` | Live `provider.list()` snapshot + fail-fast checks |
| `src/data/ode-models.default.json` | Built-in cheap force-routing catalog |
| `src/runtime.ts` | One spawned `opencode serve` + connected client |
| `src/runtimeManager.ts` | Single shared runtime, crash/respawn lifecycle |
| `src/sessionRegistry.ts` | In-memory session bookkeeping |
| `src/opencodeHelpers.ts` | Status/transcript polling |
| `src/log.ts` | Structured event logging (stderr + PID-named files) |
| `src/mcpResult.ts` | `ok`/`fail`/`failError` result shaping and the error-code catalog |
| `src/tools/*.ts` | The five MCP tools |
| `src/index.ts` | MCP bootstrap + cleanup |
| `skills/ode-delegate/` | Agent-facing skill |
| `rules/` | Soft always-on Cursor rules |
| `.cursor-plugin/`, `mcp.json` | Cursor plugin manifest |
| `scripts/build.mjs` | esbuild bundle → `dist/index.cjs` (+ copy `data/`) |
| `scripts/refresh-models.mjs` | Diff curated catalog vs live OpenCode providers |
| `scripts/register-local-plugin.mjs` | Dev: register checkout via `workspaceOpen` hook |
| `scripts/e2e-smoke.mjs` | Real-server smoke test |
| `scripts/validate-skill.mjs` | Plugin/skill layout checks |

## Requirements

- **IDE:** [Cursor](https://cursor.com) only (plugin + MCP).
- Node.js ≥ 18.17 (used by `npx` to run the server).
- [`opencode`](https://opencode.ai/docs) CLI on `PATH` (`npm i -g opencode-ai@latest`), or set `OPEN_DELEGATE_OPENCODE_BIN`.
- OpenCode configured with at least one usable model (`opencode auth login`, or a free hosted model).

## Local development

```bash
git clone git@github.com:Verbalize-public/open-delegate.git
cd open-delegate
npm install
npm run build
npm run register:local            # sync → ~/.cursor/plugins/local + workspaceOpen hook
# (optional) npm link             # only if you want the CLI bin globally; MCP no longer needs it
```

Then **Cursor: Developer → Reload Window**. Customize → MCP Tools should list `open-delegate`.

`npm run register:local` syncs the plugin into `~/.cursor/plugins/local/open-delegate` with an `mcp.json` that runs `node <checkout>/dist/index.cjs` (avoids `npx` 404 while the package is unpublished), and registers a `workspaceOpen` hook so Cursor loads that path. Re-run after moving the repo or changing skills/rules; rebuild + re-register after `src/` changes.

```bash
npm run test:unit         # fast, no opencode needed
npm run test:integration  # real opencode + free model; needs PATH
npm run e2e               # build, then drive the real stdio server
npm run validate:skill    # plugin/skill layout vs reality
```

`tests/unit/` covers pure logic with no external process. `tests/integration/` and `scripts/e2e-smoke.mjs` exercise a real `opencode serve` and free hosted model (`opencode/deepseek-v4-flash-free`) — no API key required.

`npm test`/`npm run test:unit` is the fast loop and the only one expected to pass on every commit. `test:integration`, `e2e`, and `validate:skill` are **release gates**, not per-commit requirements — see [RUNBOOK.md](RUNBOOK.md#release-gate-maintainers-before-npm-publish) for the exact sequence and why each one exists (crash-recovery, oversized-prompt rejection, and a real end-to-end round trip aren't things unit tests with mocks can catch).

## Contributing

Issues and PRs welcome. Run `npm run test:unit` (and `npm run test:integration` if you have `opencode`) before submitting.

To publish a new npm release (maintainers): run the full [release gate](RUNBOOK.md#release-gate-maintainers-before-npm-publish) in RUNBOOK.md, then:

```bash
npm run build
# 0.2.0-alpha is a prerelease — npm requires an explicit dist-tag:
npm publish --access public --tag alpha
```

Then submit / update the plugin at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

## Troubleshooting

Hit a "Connection stopped"/timeout in Cursor, need to find an `opencode` process's log by pid, or unsure whether to use `register:local` vs `npx` during development? See [RUNBOOK.md](RUNBOOK.md).

## License

[MIT](LICENSE)
