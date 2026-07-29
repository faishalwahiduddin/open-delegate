# Contributing

Thanks for looking at `open-delegate`. This doc covers local setup, tests, project
layout, and the maintainer release gate. See [README.md](README.md) for the
end-user install and usage overview, and [RUNBOOK.md](RUNBOOK.md) for diagnosing a
misbehaving MCP server at runtime.

## Local development

See [README.md § Prerequisites](README.md#prerequisites) first (Cursor, Node ≥
18.17, the `opencode` CLI). Then:

```bash
git clone git@github.com:Verbalize-public/open-delegate.git
cd open-delegate
npm install
npm run build
npm run register:local            # sync → ~/.cursor/plugins/local + workspaceOpen hook
```

Then **Cursor: Developer → Reload Window**. Customize → MCP Tools should list
`open-delegate` with five tools.

`npm run register:local` syncs the plugin into `~/.cursor/plugins/local/open-delegate`
with an `mcp.json` that runs `node <checkout>/dist/index.cjs` (avoids the `npx` 404
while the package is unpublished), and registers a `workspaceOpen` hook so Cursor
loads that path. Re-run after moving the repo or changing `skills/`/`rules/`;
rebuild (`npm run build`) and re-register after any `src/` change.

## Tests

```bash
npm run test:unit         # fast, no opencode needed
npm run test:integration  # real opencode + free model; needs opencode on PATH
npm run e2e               # build, then drive the real stdio server
npm run validate:skill    # plugin/skill layout vs reality
```

`tests/unit/` covers pure logic with no external process. `tests/integration/` and
`scripts/e2e-smoke.mjs` exercise a real `opencode serve` and free hosted model
(`opencode/deepseek-v4-flash-free`) — no API key required.

`npm test` / `npm run test:unit` is the fast loop and the only one expected to pass
on every commit. `test:integration`, `e2e`, and `validate:skill` are **release
gates**, not per-commit requirements — see
[RUNBOOK.md § Release gate](RUNBOOK.md#release-gate-maintainers-before-npm-publish)
for the exact sequence and why each one exists (crash-recovery, oversized-prompt
rejection, and a real end-to-end round trip aren't things unit tests with mocks can
catch).

## Project layout

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

## Submitting changes

Issues and PRs welcome. Run `npm run test:unit` (and `npm run test:integration` if
you have `opencode`) before submitting.

## Release gate (maintainers)

To publish a new npm release, run the full
[release gate](RUNBOOK.md#release-gate-maintainers-before-npm-publish) in
RUNBOOK.md, then:

```bash
npm run build
# 0.2.0-alpha is a prerelease — npm requires an explicit dist-tag:
npm publish --access public --tag alpha
```

Then submit / update the plugin at
[cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).
