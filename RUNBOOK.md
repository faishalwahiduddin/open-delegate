# RUNBOOK

Operational playbook for diagnosing a misbehaving `open-delegate` MCP server, plus
the release-gate checks maintainers run before publishing. Agent-facing tool
contracts/errors live under [`skills/ode-delegate/reference/`](skills/ode-delegate/reference/);
this doc is for humans (and agents) firefighting a live session.

## Diagnose "Connection stopped" / "Timed out waiting for connection"

These strings come from **Cursor's own MCP host**, not from open-delegate — grep the
source, they don't exist here. They mean the MCP bridge process died or Cursor
couldn't (re)establish its stdio connection. See
[`skills/ode-delegate/reference/errors.md`](skills/ode-delegate/reference/errors.md#cursor-host-side-errors-not-from-open-delegate)
for the full explanation; the short version:

1. **Reload the window** — Command Palette → `Developer: Reload Window`. This
   restarts the MCP connection cleanly. Any in-flight delegated session keeps
   running server-side (it's a separate `opencode serve` process) and can still be
   reached with `ode_await`/`ode_transcript` afterward, as long as that
   `opencode serve` process itself survived.
2. **Check whether it's still your fault** — before Reload, if the connection is
   still up, run `ode_diagnostics`. It reports the bridge's own pid, every live
   `opencode serve` pid/url/log path, and the last ~50 internal events, with no
   guessing required.
3. **After reloading**, re-run `ode_diagnostics` on the fresh connection. If a
   `runtimeKey` you expect is missing, that `opencode serve` process died along with
   the old bridge process (rare — only the *bridge* is meant to own their lifecycle,
   and it disposes them on clean shutdown, not on a host-side reconnect).
4. If it keeps recurring on the very first `ode_delegate` call in a fresh window,
   suspect a slow/cold `opencode` install (first `npx` resolve, antivirus scan, slow
   disk) racing pre-warm — see "Cold start" below.

## Find the opencode log for a given pid

Every internal event on the bridge itself is one-line JSON, mirrored to **stderr**
(visible in Cursor's own MCP logs for this server) and to a file:

- `<logDir>/mcp-<mcpPid>.jsonl` — every event from the open-delegate MCP server
  process itself (`mcp_start`, `runtime_spawn`, `delegate_accepted`, `tool_error`, …).
- `<logDir>/opencode-<opencodePid>-<runtimeKey>.log` — raw stdout+stderr tee for one
  spawned `opencode serve` process, named by *its own* pid so multiple respawns
  never collide.

`<logDir>` defaults to `<tmpdir>/open-delegate/logs` (override with
`OPEN_DELEGATE_LOG_DIR` — see [`skills/ode-delegate/reference/config.md`](skills/ode-delegate/reference/config.md#logging)).

Fastest path to the right file: call `ode_diagnostics`. Its `mcpLogPath` and each
`runtimes[].logPath` are absolute paths you can open directly — no need to guess a
pid or list the log directory by hand.

## Cold start (first `ode_delegate` call is slow or returns `"starting"`)

The default runtime is pre-warmed in the background right after the MCP server
connects, so most calls hit an already-warm process. If a call still returns
`status: "starting"`:

- This is expected on a genuinely cold spawn (first-ever call in a fresh window
  racing pre-warm, or opencode itself being slow to boot) — it is **not** a hang.
  `ode_delegate` never blocks past a couple of seconds either way.
- Poll with `ode_await` using the same `sessionId` — it flips to
  `"running"` once background setup (acquire → create session → start prompt)
  finishes, or `"error"` if it hits the soft setup deadline
  (`OPEN_DELEGATE_SETUP_TIMEOUT_MS`, default 25s). Use `timeoutMs: 0` for a single peek.
- If it's *always* slow on a warm bridge, check `ode_diagnostics` → `runtimes` for a
  `"default"` entry — if it's absent entirely, pre-warm itself failed (logged as
  `runtime_startup_failed` on connect); check the `opencode` CLI installation
  (`opencode --version` on `PATH`, or `OPEN_DELEGATE_OPENCODE_BIN`).

## `register:local` vs `npx`

Two ways this server ends up running under Cursor:

| Mode | Command | When |
|------|---------|------|
| Marketplace / published | `npx -y @verbalize/open-delegate` | Normal end-user install |
| Local development | `node <checkout>/dist/index.cjs` | Working on this repo itself |

`npm run register:local` (see [README.md](README.md#local-development)) syncs a
plugin into `~/.cursor/plugins/local/open-delegate` pointed at your checkout's
`dist/index.cjs`, avoiding two `npx`-specific footguns during development:

- `npx` re-resolving/downloading on every cold start adds latency that can itself
  trigger the "Connection stopped" cold-start scenario above, purely as a dev-loop
  annoyance (not present for real installs, where the package is already cached).
- Editing `src/` has no effect until you `npm run build` — `register:local` doesn't
  change that, but makes it obvious you're running your own build (no ambiguity
  about which `open-delegate` version Cursor actually loaded).

After any `src/` change: `npm run build`, then **Developer: Reload Window**.

## Release gate (maintainers, before `npm publish`)

Run in order; stop at the first red:

```bash
npm run build            # must produce dist/index.cjs with no errors
npm run test:unit        # fast, no external process — must be green
npm run test:integration # real opencode serve + free hosted model; needs opencode on PATH
npm run e2e               # builds, then drives the real stdio server end to end
npm run validate:skill    # plugin/skill layout + doc links vs reality
```

`test:unit` is the only one wired into a tight dev loop; the other three are
deliberately **not** required for every commit (they need `opencode` installed and
network access to a free hosted model) but are a hard gate before cutting a release.
`test:integration` and `scripts/e2e-smoke.mjs` in particular are what catch
"works against mocks but the shipped server is actually broken" regressions —
notably runtime crash-recovery, oversized-prompt rejection, and the full
delegate → await → transcript → diagnostics round trip against a real `opencode`.

Then bump `version` in `package.json` directly (no dedicated version-bump script
exists yet) and:

```bash
npm run build
npm publish --access public --tag alpha   # 0.1.x-alpha is a prerelease; npm requires an explicit dist-tag
```
