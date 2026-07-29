# Models ground truth (OpenCode / open-delegate)

Cost-first pin list for `ode_delegate({ model: "provider/model" })`.

| | |
|--|--|
| **Catalog source** | `opencode models --verbose` (2026-07-28) — 346 reachable IDs |
| **Metric** | [Artificial Analysis Intelligence Index](https://artificialanalysis.ai) v4.1 (max effort when published) |
| **Price** | USD / 1M tokens from OpenCode catalog (Zen free = `$0`) |
| **Audience** | Agentic coding / tool-heavy OpenCode sessions — optimize **$/task**, not AAA Anthropic/OpenAI quality |
| **MCP policy** | Built-in cheap `ODE_MODELS` + optional `OPEN_DELEGATE_ALLOW_MODELS` / `DENY_MODELS` / `DEFAULT_MODEL` — see [`skills/ode-delegate/reference/config.md`](../skills/ode-delegate/reference/config.md) |

Research artifacts (local temp, not in-repo): `AGGREGATE-COMPARISON.md` + batch `*-REPORT.md` under `%TEMP%\opencode-model-batches\`.

---

## Cull rules applied

| Drop | Why |
|------|-----|
| `openrouter/~…-latest` aliases | Moving targets; pin concrete IDs for repro |
| Superseded gens (Opus 4.8, GPT-5.4/5.5, early GLM/DeepSeek R1, …) | Dominated by current tip SKUs |
| Anthropic/OpenAI **flagships** as curated defaults | Out of cost-first path — see [expensive / out of curated defaults](#out-of-curated-defaults-expensive) |
| Pro SKU twins (Sol/Terra/Luna Pro) | Same list price + same AA as base |
| No `toolcall`, RP/uncensored, routers, Lyria/image-only | Useless or hostile for OpenCode agents |
| Near-duplicate mid tiers | One pick per niche (e.g. one Xiaomi = Zen free MiMo) |
| North Mini Code / weak AA (~20) | Free but too weak for mutate |

---

## Curated cheap / value pins (recommended)

Roles are suggestions for open-delegate callers. The MCP server’s built-in `ODE_MODELS` force catalog is this cheap set (overridable via `OPEN_DELEGATE_ODE_MODELS`).

| # | Role | `provider/model` | AA II | $/M in→out | Ctx | Tools | Why it made the cut |
|--:|------|------------------|------:|------------|----:|-------|---------------------|
| 1 | Free Zen workhorse | `opencode/deepseek-v4-flash-free` | 40* | 0 / 0 | 200K | tool · reason | Best default **free** pin (*underlying Flash) |
| 2 | Free Zen 1M ctx | `opencode/nemotron-3-ultra-free` | 38* | 0 / 0 | 1M | tool · reason | Free long-context (*Nemotron Ultra) |
| 3 | Free Zen + vision | `opencode/mimo-v2.5-free` | 37* | 0 / 0 | 200K | tool · reason · vision | Free multimodal (*MiMo V2.5) |
| 4 | Free terminal agent | `opencode/laguna-s-2.1-free` | — | 0 / 0 | 256K | tool · reason | Vendor Terminal-Bench ~70%; no AA yet |
| 5 | Ultra-cheap loops | `openrouter/qwen/qwen3.7-flash` | — | 0.03 / 0.13 | 1M | tool · reason · vision | Massive agent fan-out |
| 6 | Cheap OpenAI agent | `openrouter/openai/gpt-5.6-luna` | 51 | 0.5 / 3 | 1.05M | tool · reason · vision | High-volume tool loops / scout (not Sol/Terra) |
| 7 | Qwen value + vision | `openrouter/qwen/qwen3.7-plus` | 39 | 0.32 / 1.28 | 1M | tool · reason · vision | Strong $/IQ; multimodal |
| 8 | DeepSeek quality | `openrouter/deepseek/deepseek-v4-pro` | 44 | 0.435 / 0.87 | 1M | tool · reason | Cheap relative to AA |
| 9 | Zhipu long-ctx | `openrouter/z-ai/glm-5.2` | 51 | 0.74 / 2.32 | 1M | tool · reason | AA 51 without OpenAI/Anthropic lock-in |
| 10 | Open-weights tip | `openrouter/moonshotai/kimi-k3` | 57 | 3 / 15 | 1M | tool · reason · vision | Best open-weight AA before touching AAA |
| 11 | SWE / terminal | `openrouter/nex-agi/nex-n2-pro` | 41 | 0.25 / 1 | 262K | tool · reason · vision | AA + strong vendor SWE/TB claims |
| 12 | Google speed/IQ | `openrouter/google/gemini-3.6-flash` | 50 | 1.5 / 7.5 | 1M | tool · reason · vision | Best Google keep for agents |
| 13 | xAI mid | `openrouter/x-ai/grok-4.5` | 54 | 2 / 6 | 500K | tool · reason · vision | Strong AA; competitive price |

`*` = Zen free wrapper scored via underlying model on AA.

---

## Suggested `ode_delegate` defaults by job

| Job | Prefer |
|-----|--------|
| Default / free scout | `opencode/deepseek-v4-flash-free` → escalate to Nemotron/MiMo/Laguna free |
| Cheap paid mutate | `openrouter/z-ai/glm-5.2` or `openrouter/moonshotai/kimi-k3` |
| Many cheap tool loops | `openrouter/qwen/qwen3.7-flash` or `openrouter/openai/gpt-5.6-luna` |
| SWE / terminal-heavy | `openrouter/nex-agi/nex-n2-pro` or `opencode/laguna-s-2.1-free` |
| Open-weights preference | `openrouter/moonshotai/kimi-k3` |

Pass `model` on each `ode_delegate` call, or set `OPEN_DELEGATE_DEFAULT_MODEL`. Server config layers: [`skills/ode-delegate/reference/config.md`](../skills/ode-delegate/reference/config.md). Slim agent table: [`skills/ode-delegate/reference/models.md`](../skills/ode-delegate/reference/models.md).

---

## Honorable mentions (still value-oriented)

| Model | Id | Note |
|-------|-----|------|
| Qwen frontier | `openrouter/qwen/qwen3.7-max` | AA 46; pricier than Plus/Flash — use when Plus is not enough |
| Coder specialist | `openrouter/kwaipilot/kat-coder-pro-v2` | Coding-specialist niche |
| MiniMax-M3 | `openrouter/minimax/minimax-m3` | AA 44; overlaps DeepSeek Pro value band |
| Muse Spark 1.1 | `openrouter/meta/muse-spark-1.1` | AA 51 multimodal; less proven in coding agents |
| Qwen3 Coder Next | `openrouter/qwen/qwen3-coder-next` | SWE-ish; overlaps KAT/Nex |
| Gemini 3.1 Pro Preview | `openrouter/google/gemini-3.1-pro-preview` | Prefer if Flash quality insufficient |

---

## Out of curated defaults (expensive)

Still reachable via OpenRouter if allow list permits — **not** recommended, not in built-in `ODE_MODELS`, not in skill examples.

| Model | Id | Note |
|-------|-----|------|
| Claude Opus 5 | `openrouter/anthropic/claude-opus-5` | Highest AA; long-horizon mutate — costly |
| Claude Sonnet 5 | `openrouter/anthropic/claude-sonnet-5` | Default Claude mutate tier — costly vs GLM/Kimi |
| Claude Fable 5 | `openrouter/anthropic/claude-fable-5` | AA ≈ Opus at ~2× token price |
| GPT-5.6 Sol | `openrouter/openai/gpt-5.6-sol` | OpenAI tip — use Luna instead when possible |
| GPT-5.6 Terra | `openrouter/openai/gpt-5.6-terra` | Mid OpenAI — prefer Luna / Qwen flash for cost |
| Fast Anthropic scout | `openrouter/anthropic/claude-haiku-4.5` | Low-latency Claude; still Anthropic lock-in |

Operators who want a hard block can set e.g. `OPEN_DELEGATE_DENY_MODELS=openrouter/anthropic/*,openrouter/openai/gpt-5.6-sol,openrouter/openai/gpt-5.6-terra`.

---

## Explicitly out of scope (examples)

- All Drummer / Magnum / MythoMax / Euryale / Dolphin RP stacks  
- OpenRouter Auto / Free / Fusion routers  
- Models with `toolcall: false` in catalog  
- Image/audio generators (Nano Banana, Lyria, …)  
- `opencode/big-pickle` (rotating underlying — fine for casual use, bad as ground truth)  
- `opencode/north-mini-code-free` / `opencode/ling-3.0-flash-free` until AA/agent evidence improves  

---

## Refresh

```bash
opencode models --refresh
opencode models --verbose   # costs + capabilities
```

Re-check AA leaderboard before treating scores as permanent. Catalog IDs and Zen free mappings can change without a docs bump.
