---
name: ode-delegate
description: >-
  Delegate a task to a background OpenCode agent session via the open-delegate MCP
  server (ode_delegate/ode_await/ode_status/ode_transcript/ode_cancel/ode_resume).
  Use when a task should run with a different model, run unattended in the background,
  or needs its own isolated OpenCode session instead of the native subagent tool.
---

# OpenCode delegate (operate)

Bridges to a real, running `opencode serve` process via the MCP tools below. This is
**not** knowledge about OpenCode itself — for that, use OpenCode's own docs
(opencode.ai/docs). This skill only covers *how to drive the bridge*.

## When to use this vs. the native subagent tool

| Need | Use |
|------|-----|
| Same model family as the current chat, straightforward sub-task | Native delegate/subagent tool |
| A **different model** than the current chat is running on | `ode_delegate` (`model: "provider/model"`) |
| Work that should keep running **unattended** while you do something else | `ode_delegate`, then `ode_status` later |
| A task that needs its **own isolated OpenCode session** (own history, own config) | `ode_delegate` |

## Tool selection

| Step | Tool |
|------|------|
| Start a background task | `ode_delegate` — returns immediately with `sessionId`, never blocks |
| Block until it finishes (bounded) | `ode_await` — polls, clamps `timeoutMs` to 1s–120s, returns `status:"running"` if it times out (call again) |
| One-off non-blocking check | `ode_status` |
| Read what happened so far | `ode_transcript` (works while still running) |
| Stop it early | `ode_cancel` |
| Continue a finished session with a follow-up | `ode_resume` (only once it's no longer `"running"`) |

Full input/output contracts: [reference/tools.md](reference/tools.md).

## Core loop

1. `ode_delegate({ prompt, model?, agent?, cwd?, title? })` → `{ sessionId, status: "running", previewUrl }`.
2. `ode_await({ sessionId, timeoutMs? })` (or a few `ode_status` calls if you want to keep
   working in the meantime) until `status` is `"done"`, `"error"`, or `"cancelled"`.
3. On `"error"`, read `errorMessage` — invalid model/agent ids and provider auth failures
   surface here rather than hanging (see [reference/errors.md](reference/errors.md)).
4. Need the actual output text, not just pass/fail? Call `ode_transcript({ sessionId })`.
5. Need a follow-up on the same history? `ode_resume({ sessionId, prompt })` once terminal.

Never poll `ode_status` in a tight loop — prefer one `ode_await` call with a timeout
sized to the task, and only re-call it (or switch to `ode_status`) if it comes back
`"running"`.

## Model / config

- `model` is `"provider/model"`, e.g. `"opencode/grok-code-fast-1"`. Omit it to use
  whatever the bundled MCP server is configured with by default (see
  [reference/config.md](reference/config.md)).
- Only pass `config: { path | content }` when this one call truly needs different
  opencode config than the default — each distinct override spawns its own extra
  `opencode serve` process, and there's a small hard cap on how many can run at once
  (`RuntimeCapacityError` if you hit it). Prefer changing the server-level default
  config instead of passing overrides repeatedly.

## DoD

1. Every `ode_delegate` has a matching `ode_await`/`ode_status` before you report the
   task as done — never assume a background session finished
2. `"error"` status is read from `errorMessage`, not guessed
3. `previewUrl` is surfaced to the user when it's useful for them to watch/inspect
   (it's the delegated session's own opencode server; there is no other UI for it)
4. `ode_cancel` called for any session you no longer need before ending a long-running
   turn, so it doesn't keep an opencode server warm for no reason

## Reference index

| File | Topic |
|------|-------|
| [tools.md](reference/tools.md) | Full input/output contract per tool |
| [config.md](reference/config.md) | Default vs. per-call config, env vars, runtime cap |
| [errors.md](reference/errors.md) | Exact error/timeout strings and what they mean |
