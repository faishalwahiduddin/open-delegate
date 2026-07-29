# Models (cost-first)

Curated OpenCode `provider/model` pins for `ode_delegate`. Goal: **$/task**, not AAA Anthropic/OpenAI quality.

Full research catalog: [`docs/MODELS_GROUND_TRUTH.md`](../../../docs/MODELS_GROUND_TRUTH.md).
Built-in JSON source of truth: [`src/data/ode-models.default.json`](../../../src/data/ode-models.default.json).

## Built-in ODE_MODELS (force-routing)

When unset, `OPEN_DELEGATE_ODE_MODELS` / `OPEN_DELEGATE_ODE_MODELS_FILE` default to this cheap set.
Soft rule: if a Task names one of these (or any `openrouter/…` id), use `ode_delegate` + `ode_await`, not native Task.

| Id | Role |
|----|------|
| `opencode/deepseek-v4-flash-free` | Free workhorse / default recommendation |
| `opencode/nemotron-3-ultra-free` | Free long context |
| `opencode/mimo-v2.5-free` | Free + vision |
| `opencode/laguna-s-2.1-free` | Free terminal / SWE-ish |
| `openrouter/openai/gpt-5.6-luna` | Cheap paid tool loops (not Sol/Terra) |
| `openrouter/qwen/qwen3.7-flash` | Ultra-cheap fan-out |
| `openrouter/qwen/qwen3.7-plus` | Value + vision |
| `openrouter/deepseek/deepseek-v4-pro` | Cheap relative quality |
| `openrouter/z-ai/glm-5.2` | Long-ctx without A/OA lock-in |
| `openrouter/moonshotai/kimi-k3` | Open-weights tip (upgrade before AAA) |
| `openrouter/nex-agi/nex-n2-pro` | SWE / terminal niche |
| `openrouter/google/gemini-3.6-flash` | Google speed/IQ |
| `openrouter/x-ai/grok-4.5` | Competitive mid |

**Out of curated defaults:** `openrouter/anthropic/claude-opus-5`, `…/claude-sonnet-5`, `…/claude-fable-5`, `openrouter/openai/gpt-5.6-sol`, `…/gpt-5.6-terra`. Operators may still pass them if allow list permits.

## Live availability

Curated ≠ available. open-delegate queries the running OpenCode server's `provider.list()`
and fails fast with `MODEL_NOT_AVAILABLE` when a model is missing from the catalog or its
provider is not connected. Suggestions in error hints prefer models that are currently
connected when a snapshot is cached.

Refresh the curated list against a live runtime (report only):

```bash
npm run refresh:models
```

## Suggested by job

| Job | Prefer |
|-----|--------|
| Default / free scout | `opencode/deepseek-v4-flash-free` |
| Free long context | `opencode/nemotron-3-ultra-free` |
| Free multimodal | `opencode/mimo-v2.5-free` |
| Cheap paid mutate | `openrouter/z-ai/glm-5.2` or `openrouter/moonshotai/kimi-k3` |
| Many cheap tool loops | `openrouter/qwen/qwen3.7-flash` or `openrouter/openai/gpt-5.6-luna` |
| SWE / terminal-heavy | `openrouter/nex-agi/nex-n2-pro` or `opencode/laguna-s-2.1-free` |

Server-wide omit-`model` default: set `OPEN_DELEGATE_DEFAULT_MODEL` (see [config.md](config.md)).
