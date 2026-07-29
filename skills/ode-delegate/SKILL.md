---
name: ode-delegate
description: >-
  Delegate a task to a background OpenCode agent session via the open-delegate MCP
  server (ode_delegate/ode_await/ode_transcript/ode_cancel/ode_diagnostics). Use when
  a task should run on a cheaper OpenCode model, run unattended in the background,
  or needs its own isolated OpenCode session instead of the native subagent tool.
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
| Start / resume | `ode_delegate` → `{ sessionId, status, previewUrl?, answer? }` — omit `sessionId` to create; pass `sessionId` to resume a finished session. Optional `waitMs` blocks until done (one-call short tasks). |
| Wait / peek | `ode_await` (default 30s; `timeoutMs: 0` = single non-blocking check; `"running"`/`"starting"` = call again) |
| Read history | `ode_transcript` |
| Stop | `ode_cancel` |
| Diagnose | `ode_diagnostics` (no input; bridge pid/logs, live runtimes, recent events) |

Contracts: [reference/tools.md](reference/tools.md).

## Core loop

1. Pick a cheap OpenCode id (or omit `model` for `OPEN_DELEGATE_DEFAULT_MODEL` / OpenCode default).
2. `ode_delegate({ prompt, model?, agent?, cwd?, title?, waitMs? })`. Prompt is capped at ~512KiB
   inline — for anything larger, write it to a file and pass `promptPath` instead
   (`prompt` and `promptPath` are mutually exclusive).
3. If you did not pass `waitMs` (or it timed out still running): `ode_await({ sessionId, timeoutMs? })`
   until `"done"` / `"error"` / `"cancelled"` (treat `"starting"` like `"running"` — just call again).
4. On `"error"`, read `errorMessage` / `errorCode` ([reference/errors.md](reference/errors.md)).
5. On `"done"`, prefer the capped `answer` field; if missing/empty when text was expected →
   `ode_transcript({ includeToolCalls: true })`, then `ode_delegate({ sessionId, prompt })` with a
   “write the answer” nudge.
6. Need full history? `ode_transcript({ sessionId })`.

Never tight-loop `ode_await({ timeoutMs: 0 })` — prefer one sized `ode_await`.

## Diagnostics

If a call behaves unexpectedly, or you hit a host-side connection error (see
[reference/errors.md](reference/errors.md)), call `ode_diagnostics` (no input) for the
bridge's own pid/logs, every live opencode runtime's pid/url/log path, and recent
internal events — before guessing.

## Examples

Free scout (one call if it finishes within waitMs):

```text
ode_delegate({ model: "opencode/deepseek-v4-flash-free", prompt: "Summarize the failing test.", waitMs: 60000 })
```

Paid cheap mutate:

```text
ode_delegate({ model: "openrouter/z-ai/glm-5.2", prompt: "Implement the change in src/… only." })
→ ode_await({ sessionId, timeoutMs: 120000 })
```

Resume a finished session:

```text
ode_delegate({ sessionId, prompt: "Write a short summary of what you changed." })
→ ode_await({ sessionId })
```

## Model / config

- `model` is `"provider/model"`. Allow/deny/default: [reference/config.md](reference/config.md).
- Prefer pins from [reference/models.md](reference/models.md). Avoid Opus / Sonnet / Fable / GPT Sol / Terra unless the operator explicitly allow-lists them.
- Server-level OpenCode config only (`OPEN_DELEGATE_OPENCODE_CONFIG*`) — no per-call config override.

## DoD

1. Every `ode_delegate` has a matching `ode_await` (or finished via `waitMs`) before you report done
2. `"error"` is read from `errorMessage`/`errorCode`, not guessed
3. Surface `previewUrl` when useful for the user to watch the session
4. On `"done"`, prefer `answer`; if false/absent `hasFinalText` when text expected → transcript (+ resume nudge)
5. `ode_cancel` unused long-running sessions before ending a long turn

## Reference index

| File | Topic |
|------|-------|
| [tools.md](reference/tools.md) | Full I/O per tool |
| [models.md](reference/models.md) | Cheap force-set pins / job defaults |
| [config.md](reference/config.md) | `OPEN_DELEGATE_*` env, allow/deny, model list |
| [errors.md](reference/errors.md) | Exact error strings |
