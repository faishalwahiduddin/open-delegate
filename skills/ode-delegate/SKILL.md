---
name: ode-delegate
description: >-
  Delegate a task to a background OpenCode agent session via the open-delegate MCP
  server (ode_delegate/ode_await/ode_status/ode_transcript/ode_cancel/ode_resume/
  ode_diagnostics). Use when a task should run on a cheaper OpenCode model, run
  unattended in the background, or needs its own isolated OpenCode session instead
  of the native subagent tool.
---

# OpenCode delegate (cost-first)

Bridge to a real `opencode serve` process. Goal: **reduce Cursor spend** by handing
work to cheaper OpenCode alternatives (Zen free, open-weights, mid/cheap OpenRouter).
Not a place to chase Anthropic/OpenAI flagships — see [reference/models.md](reference/models.md).

## When to use this vs native Task

| Need | Use |
|------|-----|
| Model is on **ODE_MODELS** (cheap force catalog) or is already `openrouter/…` | `ode_delegate` + `ode_await` (see soft rule `open-delegate-routing`) |
| Cursor-native model, **not** on ODE_MODELS | Native Task / subagent |
| Unattended background / isolated OpenCode session | `ode_delegate` |

Pass OpenCode `provider/model` ids as-is. Do not invent Cursor-slug remaps.

## Tool selection

| Step | Tool |
|------|------|
| Start | `ode_delegate` → `{ sessionId, status, previewUrl? }` — `status` is `"running"` on a warm runtime, or `"starting"` on a cold spawn (poll with `ode_status`/`ode_await`); returns within a few seconds either way, never blocks on the agent finishing |
| Wait | `ode_await` (1s–120s clamp; `"running"`/`"starting"` = call again) |
| Peek | `ode_status` / `ode_transcript` |
| Stop | `ode_cancel` |
| Continue | `ode_resume` (only when not `"running"`) |
| Diagnose | `ode_diagnostics` (no input; bridge pid/logs, live runtimes, recent events) |

Contracts: [reference/tools.md](reference/tools.md).

## Core loop

1. Pick a cheap OpenCode id (or omit `model` for `OPEN_DELEGATE_DEFAULT_MODEL` / OpenCode default).
2. `ode_delegate({ prompt, model?, agent?, cwd?, title? })`. Prompt is capped at ~512KiB
   inline — for anything larger, write it to a file and pass `promptPath` instead
   (`prompt` and `promptPath` are mutually exclusive).
3. `ode_await({ sessionId, timeoutMs? })` until `"done"` / `"error"` / `"cancelled"` (treat
   `"starting"` the same as `"running"` — just call again).
4. On `"error"`, read `errorMessage` ([reference/errors.md](reference/errors.md)).
5. On `"done"`, check `hasFinalText`; if missing/false when text was expected →
   `ode_transcript({ includeToolCalls: true })`, then `ode_resume` with a “write the answer” nudge.
6. Need the text? `ode_transcript({ sessionId })`.

Never tight-loop `ode_status` — prefer one sized `ode_await`.

## Diagnostics

If a call behaves unexpectedly, or you hit a host-side connection error (see
[reference/errors.md](reference/errors.md)), call `ode_diagnostics` (no input) for the
bridge's own pid/logs, every live opencode runtime's pid/url/log path, and recent
internal events — before guessing.

## Examples

Free scout:

```text
ode_delegate({ model: "opencode/deepseek-v4-flash-free", prompt: "Summarize the failing test and propose a fix." })
→ ode_await({ sessionId })
```

Paid cheap mutate:

```text
ode_delegate({ model: "openrouter/z-ai/glm-5.2", prompt: "Implement the change in src/… only." })
→ ode_await({ sessionId, timeoutMs: 120000 })
```

Server default (omit model — configure `OPEN_DELEGATE_DEFAULT_MODEL`, prefer Zen free):

```text
ode_delegate({ prompt: "List open TODOs in this package." })
→ ode_await({ sessionId })
```

## Model / config

- `model` is `"provider/model"`. Allow/deny: [reference/config.md](reference/config.md).
- Prefer pins from [reference/models.md](reference/models.md). Avoid Opus / Sonnet / Fable / GPT Sol / Terra unless the operator explicitly allow-lists them.
- Pass `config: { path | content }` only for a true one-off OpenCode config (capped runtimes — `RuntimeCapacityError`).

## DoD

1. Every `ode_delegate` has a matching `ode_await`/`ode_status` before you report done
2. `"error"` is read from `errorMessage`, not guessed
3. Surface `previewUrl` when useful for the user to watch the session
4. On `"done"`, check `hasFinalText`; if false/absent when text expected → transcript (+ resume nudge)
5. `ode_cancel` unused long-running sessions before ending a long turn

## Reference index

| File | Topic |
|------|-------|
| [tools.md](reference/tools.md) | Full I/O per tool |
| [models.md](reference/models.md) | Cheap force-set pins / job defaults |
| [config.md](reference/config.md) | `OPEN_DELEGATE_*` env, allow/deny, runtime cap |
| [errors.md](reference/errors.md) | Exact error strings |
