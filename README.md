# agentstats

**Usage & cost analytics for AI coding agents.** Know exactly how many tokens your Claude Code, Codex CLI and Gemini CLI sessions burn — and what they would have cost — with a single offline command.

[![CI](https://github.com/HNUYJJ/agentstats/actions/workflows/ci.yml/badge.svg)](https://github.com/HNUYJJ/agentstats/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agentstats)](https://www.npmjs.com/package/agentstats)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node](https://img.shields.io/node/v/agentstats)](./package.json)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)
[![price refresh](https://github.com/HNUYJJ/agentstats/actions/workflows/update-prices.yml/badge.svg)](https://github.com/HNUYJJ/agentstats/actions/workflows/update-prices.yml)

```text
$ agentstats daily --since 2026-08-01
Date            Input    Output  Cache W      Cache R       Total  Cost (USD)
----------  ---------  --------  ---------  ----------  ----------  ---------
2026-08-03    412,088    38,204         0    5,101,240   5,551,532       $0.61
2026-08-04    655,102   112,470   180,224   11,882,048  12,829,844       $8.42
2026-08-05  1,004,316   187,224         0   27,310,656  28,502,196      $16.90
2026-08-06  1,388,470   201,882         0   24,902,912  26,493,264      $14.02
Total       3,459,976   539,780   180,224   69,196,856  73,376,836      $39.95

312 events  -  9 sessions  -  73,376,836 tokens  -  $39.95
```

## Why

If you run multiple coding agents, you already have the problem: token spend is invisible until the invoice (or the rate limit) hits. Claude Code, Codex CLI and Gemini CLI each record detailed usage in local transcript logs, but:

- the logs are scattered across three different directories in three different formats,
- each tool only shows its own usage, never the combined picture,
- thinking tokens, cache reads and cache writes are priced differently and nobody wants to do that math.

`agentstats` parses all of those logs locally, normalizes them into one model, and answers the questions you actually care about: *which day, which project, which model, which session* — and how much.

## Highlights

- **Zero dependencies** — one static TypeScript bundle on top of the Node standard library. Nothing to audit, instant `npx`.
- **100% local & offline** — reads `~/.claude`, `~/.codex`, `~/.gemini`; no network access, no API keys, no telemetry. Your transcripts never leave the machine.
- **Correct token math** — handles Anthropic cache writes (1.25x/2x input, 5m/1h TTL), OpenAI cached-input discounts, Gemini thinking-token billing, retried-message dedupe, cumulative-vs-delta token counters, and per-session model switching.
- **Budget guardrails** — set a monthly USD budget; `agentstats` warns at 80% and exits with code 2 past 100%, so your CI or shell prompt can react.
- **Machine-readable** — `--json` on every analytical command for scripting and dashboards.

## Install

```bash
npx agentstats              # run once
npm i -g agentstats         # or install globally
```

Requires Node 18.17+. No build, no config, no API keys.

## Commands

| Command | What it shows |
|---|---|
| `agentstats daily` | tokens & estimated cost per day (default command) |
| `agentstats monthly` | same, grouped by month |
| `agentstats daily --breakdown model` | second grouping: `model`, `agent` or `project` |
| `agentstats models` | per-model totals, flags unpriced models with `*` |
| `agentstats session` | per-session totals, top spenders first (`--limit`, `--sort`) |
| `agentstats agents` | per-agent totals (claude / codex / gemini) |
| `agentstats projects` | per-project totals (sessions, events, tokens, cost) |
| `agentstats budget set 50` | track a $50/month budget (`budget`, `budget clear`) |
| `agentstats report --out report.md` | export a standalone markdown report |
| `agentstats pricing` | the bundled price table, with per-model provenance |
| `agentstats doctor` | which sources were found, file/event counts, notes |
| `agentstats daily --watch` | live dashboard, re-renders every few seconds |
| `agentstats mcp` | expose all of this to AI agents via MCP (stdio) |

Common filters work everywhere:

```bash
agentstats daily --since 2026-08-01 --until 2026-08-31
agentstats session --agent claude,codex --project my-app
agentstats models --model opus
agentstats daily --json | jq '.totals'
```

## Let your agents check their own spend

`agentstats mcp` is a zero-dependency [MCP](https://modelcontextprotocol.io) stdio server that exposes your usage data to coding agents as tools: `usage_summary`, `daily_usage`, `model_breakdown`, `top_sessions`, `budget_status` and `price_lookup`.

```bash
# Claude Code
claude mcp add agentstats -- npx agentstats mcp

# Codex CLI (~/.codex/config.toml)
[mcp_servers.agentstats]
command = "agentstats"
args = ["mcp"]

# Any MCP client (JSON)
{ "mcpServers": { "agentstats": { "command": "agentstats", "args": ["mcp"] } } }
```

Then just ask your agent: *"how much did I spend on AI this week?"* Answers come from the same local logs, with the same privacy guarantees as the CLI.

## How costs are estimated

Costs are **estimates**: locally recorded token counts × public API list prices. Subscription plans (Claude Pro/Max, ChatGPT Plus/Pro) are not billed per token — the numbers show what equivalent API usage would have cost, which is exactly what you want for budgeting and comparing models.

Prices live in a single flat table in [`src/pricing.ts`](./src/pricing.ts) and can be overridden without touching the code:

```jsonc
// ~/.agentstats/config.json
{
  "budget": 50,
  "pricingOverrides": {
    "claude-opus-4-8": { "input": 5, "cachedInput": 0.5, "output": 25 }
  }
}
```

Model names are normalized aggressively (`openai/gpt-5.6-luna`, `us.anthropic.claude-sonnet-4-5:beta`, date suffixes), so one key covers the variants. Unpriced models are flagged with `*` and cost $0 rather than being guessed.

**The bundled table refreshes itself, from official sources.** A scheduled GitHub Action runs daily (08:00 UTC): it parses the vendors' own pricing pages — Anthropic's docs markdown, OpenAI's embedded pricing tables (standard tier only), Google's per-model pricing tables — and regenerates `src/prices.generated.ts`. Every model carries a provenance tag (`official` vs `community`), visible via `agentstats pricing`. A community price database (LiteLLM) only fills models the official pages no longer list; if any official page changes layout, the refresh fails loudly rather than silently degrading to third-party data, and the whole run writes nothing unless every validation passes. Values you have verified yourself can be pinned in `MANUAL_PRICES` in [`src/pricing.ts`](./src/pricing.ts) — pins win over the generated table, and user `pricingOverrides` win over everything.

## Supported tools

| Agent | Source | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ full |
| Codex CLI / desktop | `~/.codex/sessions/**/*.jsonl` | ✅ full |
| Gemini CLI (legacy, shut down 2026-06-18) | `~/.gemini/tmp/**/chats/session-*.json` | ✅ historical sessions that recorded usage |
| Antigravity CLI / desktop | — | ❌ Google does not record per-turn token usage in local Antigravity logs; `doctor` says so explicitly when it detects `~/.gemini/antigravity` |

## FAQ

**Is any data uploaded?** No. The CLI performs zero network I/O. Point `doctor` at a fresh machine and you'll see it only ever reads local files.

**Where does it read from?** `~/.claude/projects`, `~/.codex/sessions` (plus `archived_sessions`), `~/.gemini/tmp`. Override the home root with the `AGENTSTATS_HOME` environment variable.

**Does it slow my agent down?** No. It's a read-only CLI you run on demand; agents never touch it.

**Why do my numbers differ from my provider invoice?** Estimates use list prices; enterprise rates, batch discounts, subscriptions and rate-limit windows differ. Use them for relative comparisons and budget tracking.

**Why are there no Antigravity numbers?** Antigravity — the successor to Gemini CLI, which Google shut down on 2026-06-18 — does not write per-turn token usage into any local log file. `agentstats` detects `~/.gemini/antigravity` and tells you this explicitly via `doctor`, rather than showing a silent $0. If Google ever exposes usage in local logs or an API, support lands as an adapter.

## Roadmap

- [x] Scheduled GitHub Action that auto-refreshes the bundled price table daily from official vendor pricing pages (`.github/scripts/update-prices.mjs`)
- [x] `agentstats mcp` — expose your own stats to your agents via MCP
- [x] `--watch` live dashboard mode
- [ ] Cursor & other IDE agents (SQLite-backed logs)
- [ ] Antigravity usage ingestion, if Google ever exposes usage in local logs or an API
- [ ] Non-USD currencies

Contributions are welcome - see [CONTRIBUTING.md](./CONTRIBUTING.md). For price corrections, pin the verified value in `MANUAL_PRICES`: the scheduled refresh only rewrites generated entries, so pins survive.

## Development

```bash
npm install
npm test        # builds and runs the test suite (27 tests, fixture-based)
```

The test suite parses synthetic fixture logs covering dedupe, cache-write splits, cumulative counters and model switching — no real transcripts are needed or used.

## 中文文档

见 [README.zh-CN.md](./README.zh-CN.md)。

## License

[MIT](./LICENSE)
